import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { 
  dbRun, 
  dbAll, 
  dbGet, 
  initServerDb, 
  pruneOldEvents 
} from "./src/server_db.js";
import { runServerAgentLoop } from "./src/server_agent.js";

const app = express();
const PORT = 3000;

app.use(express.json());

// In-Memory Global Engine parameters (can be updated live via the client config sidebar!)
const engineSettings = {
  EVENT_INTERVAL: 200,      // standard interval (ms) between simulated normal telemetry events
  WINDOW_SIZE: 60,          //sliding window size (seconds) to measure rate averages
  Z_SCORE_THRESHOLD: 3.0,   //Z-Score trigger limit
};

// Internal engine states
let activeProducerInterval: NodeJS.Timeout | null = null;
let activeDetectorInterval: NodeJS.Timeout | null = null;
let activePruneInterval: NodeJS.Timeout | null = null;

let lastAlarmTime = 0;      // timestamps to manage detector cooldowns and prevent spam
const ALARM_COOLDOWN_MS = 10000; // 10 second minimum interval between separate alarms

// Core server metrics tracking state
let currentEventRate = 0;
let currentMean = 0;
let currentStd = 0;
let currentZScore = 0;

// API Endpoint: Retrieve current dashboard telemetry metrics
app.get("/api/metrics", async (req, res) => {
  try {
    const cutoff = Date.now() / 1000 - 60;
    // Calculate current Events Per Minute (EPM) directly from database
    const countRow = await dbGet<{ total: number }>(
      "SELECT COUNT(*) as total FROM events WHERE timestamp >= ?",
      [cutoff]
    );
    const opm = countRow ? countRow.total : 0;

    // Check if we are currently experiencing a breach or mitigation
    const latestAnomaly = await dbGet<any>(
      "SELECT timestamp, status FROM anomalies ORDER BY id DESC LIMIT 1"
    );

    let statusString = "Steady State";
    if (latestAnomaly) {
      const timeSinceAlarmSec = Date.now() / 1000 - latestAnomaly.timestamp;
      if (timeSinceAlarmSec < 15) {
        statusString = "🚨 BREACH DETECTED";
      } else if (latestAnomaly.status === "Pending Mitigation") {
        statusString = "🛡️ AGENT MITIGATING";
      }
    }

    // Grab running count of active system exceptions/pending mitigations
    const activeThreatsRow = await dbGet<{ total: number }>(
      "SELECT COUNT(*) as total FROM anomalies WHERE status = 'Pending Mitigation'"
    );
    const activeThreats = activeThreatsRow ? activeThreatsRow.total : 0;

    res.json({
      opm: opm,
      currentRate: currentEventRate,
      mean: parseFloat(currentMean.toFixed(2)),
      std: parseFloat(currentStd.toFixed(2)),
      z_score: parseFloat(currentZScore.toFixed(2)),
      status: statusString,
      active_threats: activeThreats,
      timestamp: Date.now() / 1000,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: Serve bucketed second-by-second analytics for chart visualization
app.get("/api/history", async (req, res) => {
  try {
    const cutoff = Date.now() / 1000 - 120; // past 120 seconds of chart resolution
    const rows = await dbAll<any>(
      "SELECT CAST(timestamp as INTEGER) as sec, COUNT(*) as count FROM events WHERE timestamp >= ? GROUP BY sec ORDER BY sec ASC",
      [cutoff]
    );

    // Group real seconds and fill empty indices gracefully to prevent jittery lines
    const currentSec = Math.floor(Date.now() / 1000);
    const timelineData = [];

    for (let s = currentSec - 90; s <= currentSec; s++) {
      const match = rows.find((r) => r.sec === s);
      const timeStr = new Date(s * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      timelineData.push({
        sec: s,
        time: timeStr,
        count: match ? match.count : 0,
      });
    }

    res.json(timelineData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: Fetch detected anomaly ledger
app.get("/api/anomalies", async (req, res) => {
  try {
    const rows = await dbAll("SELECT * FROM anomalies ORDER BY id DESC LIMIT 15");
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: Fetch reasoning logs for a selected anomaly ID
app.get("/api/traces/:id", async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM agent_logs WHERE anomaly_id = ? ORDER BY step ASC, id ASC",
      [req.params.id]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: Get current engine configurations
app.get("/api/settings", (req, res) => {
  res.json(engineSettings);
});

// API Endpoint: Update configurations live from dashboard edits
app.post("/api/settings", (req, res) => {
  const { EVENT_INTERVAL, WINDOW_SIZE, Z_SCORE_THRESHOLD } = req.body;
  if (EVENT_INTERVAL !== undefined) {
    engineSettings.EVENT_INTERVAL = Math.max(50, Math.min(2000, EVENT_INTERVAL));
    restartProducerLoop();
  }
  if (WINDOW_SIZE !== undefined) {
    engineSettings.WINDOW_SIZE = Math.max(10, Math.min(300, WINDOW_SIZE));
  }
  if (Z_SCORE_THRESHOLD !== undefined) {
    engineSettings.Z_SCORE_THRESHOLD = Math.max(1.0, Math.min(8.0, Z_SCORE_THRESHOLD));
  }
  console.log("Updated Engine Parameters:", engineSettings);
  res.json({ success: true, settings: engineSettings });
});

// API Endpoint: Trigger manual surge simulation immediately
app.post("/api/trigger-spike", async (req, res) => {
  try {
    console.log("💥 Manual surge stimulus triggered from Client UI dashboard! Injecting 25 orders...");
    const sources = ["web", "mobile"];
    const activeSource = sources[Math.floor(Math.random() * sources.length)];
    const tNow = Date.now() / 1000;

    for (let i = 0; i < 25; i++) {
      const orderId = "ORD" + Math.floor(100000 + Math.random() * 900000);
      await dbRun(
        "INSERT INTO events (event_type, order_id, timestamp, source) VALUES (?, ?, ?, ?)",
        ["order_placed", orderId, tNow, activeSource]
      );
    }
    res.json({ success: true, count: 25, source: activeSource });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Internal Loop 1: Steady Transaction Generator (Producer)
function startProducerLoop() {
  const triggerTick = async () => {
    try {
      const orderId = "ORD" + Math.floor(100000 + Math.random() * 900000);
      const sources = ["web", "mobile", "api", "mobile", "web"];
      const randSource = sources[Math.floor(Math.random() * sources.length)];
      await dbRun(
        "INSERT INTO events (event_type, order_id, timestamp, source) VALUES (?, ?, ?, ?)",
        ["order_placed", orderId, Date.now() / 1000, randSource]
      );
    } catch (err) {
      console.error("Failed recording normal order:", err);
    }
  };

  activeProducerInterval = setInterval(triggerTick, engineSettings.EVENT_INTERVAL);
}

function restartProducerLoop() {
  if (activeProducerInterval) {
    clearInterval(activeProducerInterval);
  }
  startProducerLoop();
}

// Internal Loop 2: Sliding-Window Statistical Anomaly Detector (Consumer)
function startDetectorLoop() {
  const checkTick = async () => {
    try {
      const tNow = Date.now() / 1000;
      const windowSec = engineSettings.WINDOW_SIZE;

      // Query event rate distribution of past window seconds grouped by 1s interval blocks
      const cutoff = tNow - windowSec - 2;
      const rows = await dbAll<any>(
        "SELECT CAST(timestamp as INTEGER) as sec, COUNT(*) as count FROM events WHERE timestamp >= ? GROUP BY sec ORDER BY sec DESC",
        [cutoff]
      );

      const countsMap: Record<number, number> = {};
      rows.forEach((r) => {
        countsMap[r.sec] = r.count;
      });

      const currentSec = Math.floor(tNow);
      currentEventRate = countsMap[currentSec] || 0;

      // Calculate sliding window historical statistics (excluding the current incomplete second)
      const historicalSamples: number[] = [];
      for (let i = 1; i <= windowSec; i++) {
        const checkSec = currentSec - i;
        historicalSamples.push(countsMap[checkSec] || 0);
      }

      const totalSamples = historicalSamples.length;
      const sum = historicalSamples.reduce((a, b) => a + b, 0);
      const mean = sum / totalSamples;
      currentMean = mean;

      let stdDev = 0;
      if (totalSamples > 1) {
        const sqSum = historicalSamples.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
        stdDev = Math.sqrt(sqSum / (totalSamples - 1));
      }
      currentStd = stdDev;

      // Compute current Z-Score safely
      if (stdDev > 0) {
        currentZScore = (currentEventRate - mean) / stdDev;
      } else {
        currentZScore = 0;
      }

      // If breaches threshold, current rate has met threshold and outside cooldown
      if (
        currentZScore > engineSettings.Z_SCORE_THRESHOLD &&
        currentEventRate > 5 &&
        Date.now() - lastAlarmTime > ALARM_COOLDOWN_MS
      ) {
        lastAlarmTime = Date.now();
        console.log(`\n🚨 Z-SCORE BREACH AT DETECTOR! Current Rate: ${currentEventRate} | Mean: ${mean.toFixed(2)} | StdDev: ${stdDev.toFixed(2)} | Z: ${currentZScore.toFixed(2)}`);

        // Register the anomaly inside local SQLite records
        const anomalyInsert = await dbRun(
          "INSERT INTO anomalies (timestamp, z_score, window_mean, window_std, event_count) VALUES (?, ?, ?, ?, ?)",
          [tNow, currentZScore, mean, stdDev, currentEventRate]
        );
        const anomalyId = anomalyInsert.lastID;
        console.log(`Registered System Anomaly #${anomalyId} in SQLite.`);

        // Dispatch Discord Webhook alarm if configured
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (webhookUrl && webhookUrl.trim() !== "") {
          fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: `📣 **Aegis Node Alarm!** Slid window rate breached thresh (Z-Score: **${currentZScore.toFixed(2)}**). Spawned ReAct agent containment loop for Anomaly ID: **#${anomalyId}**.`
            })
          }).catch((e) => console.error("Discord post fail:", e.message));
        }

        // Trigger autonomous server agent loop as background process
        runServerAgentLoop(anomalyId, currentEventRate);
      }
    } catch (err: any) {
      console.error("Exception checking statistical sliding window deviations:", err.message);
    }
  };

  activeDetectorInterval = setInterval(checkTick, 1000);
}

// Master Server Boot Trigger
async function startServer() {
  // 1. Initialize SQLite Database Schema
  await initServerDb();

  // 2. Clear old order logs periodically to keep DB size compact
  activePruneInterval = setInterval(() => {
    pruneOldEvents();
  }, 60000);

  // 3. Kickoff analytical simulation loops
  startProducerLoop();
  startDetectorLoop();

  // 4. Configure Express & React Frontend Static Build Assets mount
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n======================================================`);
    console.log(`  Aegis Full-Stack Platform Active!`);
    console.log(`  Live UI view running on: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}

startServer();

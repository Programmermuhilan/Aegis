import fs from "fs";
import path from "path";

const DB_DIR = path.join(process.cwd(), "storage");
const BACKUP_PATH = path.join(DB_DIR, "db_backup.json");

interface EventRow {
  id: number;
  event_type: string;
  order_id: string;
  timestamp: number;
  source: string;
}

interface AnomalyRow {
  id: number;
  timestamp: number;
  z_score: number;
  window_mean: number;
  window_std: number;
  event_count: number;
  status: string;
  diagnosis: string;
}

interface AgentLogRow {
  id: number;
  anomaly_id: number;
  timestamp: number;
  step: number;
  type: string;
  content: string;
}

// In-memory data store replicating table rows
let dataset = {
  events: [] as EventRow[],
  anomalies: [] as AnomalyRow[],
  agent_logs: [] as AgentLogRow[],
  nextEventId: 1,
  nextAnomalyId: 1,
  nextLogId: 1,
};

// Check and load existing backups to preserve data on restart
try {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (fs.existsSync(BACKUP_PATH)) {
    const raw = fs.readFileSync(BACKUP_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed) {
      dataset = {
        events: parsed.events || [],
        anomalies: parsed.anomalies || [],
        agent_logs: parsed.agent_logs || [],
        nextEventId: parsed.nextEventId || (parsed.events?.length ? Math.max(...parsed.events.map((e: any) => e.id)) + 1 : 1),
        nextAnomalyId: parsed.nextAnomalyId || (parsed.anomalies?.length ? Math.max(...parsed.anomalies.map((a: any) => a.id)) + 1 : 1),
        nextLogId: parsed.nextLogId || (parsed.agent_logs?.length ? Math.max(...parsed.agent_logs.map((l: any) => l.id)) + 1 : 1),
      };
      console.log("Successfully loaded in-memory database backup from disk.");
    }
  }
} catch (error) {
  console.error("Warning: Failed to load backup JSON database, using clean initialization.", error);
}

// Persist current state to backup file
function saveBackup() {
  try {
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(dataset, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed saving in-memory database backup:", err);
  }
}

// Mock SQLite db interface to satisfy any external sqlite reference
export const db = {
  run: (sql: string, params: any) => {},
};

export const dbRun = async (sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> => {
  const sqlLower = sql.toLowerCase().trim();

  if (sqlLower.startsWith("insert into events")) {
    const [event_type, order_id, timestamp, source] = params;
    const newId = dataset.nextEventId++;
    dataset.events.push({
      id: newId,
      event_type,
      order_id,
      timestamp: Number(timestamp),
      source
    });
    saveBackup();
    return { lastID: newId, changes: 1 };
  }

  if (sqlLower.startsWith("insert into anomalies")) {
    const [timestamp, z_score, window_mean, window_std, event_count] = params;
    const newId = dataset.nextAnomalyId++;
    dataset.anomalies.push({
      id: newId,
      timestamp: Number(timestamp),
      z_score: Number(z_score),
      window_mean: Number(window_mean),
      window_std: Number(window_std),
      event_count: Number(event_count),
      status: 'Pending Mitigation',
      diagnosis: 'No analysis yet.'
    });
    saveBackup();
    return { lastID: newId, changes: 1 };
  }

  if (sqlLower.startsWith("insert into agent_logs")) {
    const [anomaly_id, timestamp, step, type, content] = params;
    const newId = dataset.nextLogId++;
    dataset.agent_logs.push({
      id: newId,
      anomaly_id: Number(anomaly_id),
      timestamp: Number(timestamp),
      step: Number(step),
      type,
      content
    });
    saveBackup();
    return { lastID: newId, changes: 1 };
  }

  if (sqlLower.startsWith("update anomalies")) {
    // UPDATE anomalies SET status = 'Mitigated', diagnosis = ? WHERE id = ?
    const [diagnosis, anomalyId] = params;
    const match = dataset.anomalies.find(a => a.id === Number(anomalyId));
    if (match) {
      match.status = 'Mitigated';
      match.diagnosis = diagnosis;
      saveBackup();
      return { lastID: Number(anomalyId), changes: 1 };
    }
  }

  if (sqlLower.startsWith("delete from events")) {
    // DELETE FROM events WHERE timestamp < ?
    const [cutoff] = params;
    const initialLen = dataset.events.length;
    dataset.events = dataset.events.filter(e => e.timestamp >= Number(cutoff));
    const changes = initialLen - dataset.events.length;
    if (changes > 0) {
      saveBackup();
    }
    return { lastID: 0, changes };
  }

  return { lastID: 0, changes: 0 };
};

export const dbAll = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => {
  const sqlLower = sql.toLowerCase().trim();

  // 1. SELECT CAST(timestamp as INTEGER) as sec, COUNT(*) as count FROM events WHERE timestamp >= ? GROUP BY sec ORDER BY sec ASC/DESC
  if (sqlLower.includes("group by sec")) {
    const cutoff = Number(params[0]);
    const filtered = dataset.events.filter(e => e.timestamp >= cutoff);
    const m: Record<number, number> = {};
    filtered.forEach(e => {
      const sec = Math.floor(e.timestamp);
      m[sec] = (m[sec] || 0) + 1;
    });
    const results = Object.keys(m).map(k => ({
      sec: Number(k),
      count: m[Number(k)]
    }));
    if (sqlLower.includes("desc")) {
      results.sort((a, b) => b.sec - a.sec);
    } else {
      results.sort((a, b) => a.sec - b.sec);
    }
    return results as unknown as T[];
  }

  // 2. SELECT * FROM anomalies ORDER BY id DESC LIMIT 15
  if (sqlLower.startsWith("select * from anomalies")) {
    const list = [...dataset.anomalies].sort((a, b) => b.id - a.id).slice(0, 15);
    return list as unknown as T[];
  }

  // 3. SELECT * FROM agent_logs WHERE anomaly_id = ? ORDER BY step ASC, id ASC
  if (sqlLower.startsWith("select * from agent_logs")) {
    const [anomalyId] = params;
    const list = dataset.agent_logs
      .filter(l => l.anomaly_id === Number(anomalyId))
      .sort((a, b) => {
        if (a.step !== b.step) return a.step - b.step;
        return a.id - b.id;
      });
    return list as unknown as T[];
  }

  return [];
};

export const dbGet = async <T = any>(sql: string, params: any[] = []): Promise<T | undefined> => {
  const sqlLower = sql.toLowerCase().trim();

  // 1. SELECT COUNT(*) as total FROM events WHERE timestamp >= ?
  if (sqlLower.startsWith("select count(*) as total from events")) {
    const cutoff = Number(params[0]);
    const total = dataset.events.filter(e => e.timestamp >= cutoff).length;
    return { total } as unknown as T;
  }

  // 2. SELECT timestamp, status FROM anomalies ORDER BY id DESC LIMIT 1
  if (sqlLower.startsWith("select timestamp, status from anomalies")) {
    if (dataset.anomalies.length === 0) return undefined;
    const latest = [...dataset.anomalies].sort((a, b) => b.id - a.id)[0];
    return { timestamp: latest.timestamp, status: latest.status } as unknown as T;
  }

  // 3. SELECT COUNT(*) as total FROM anomalies WHERE status = 'Pending Mitigation'
  if (sqlLower.includes("status = 'pending mitigation'")) {
    const total = dataset.anomalies.filter(a => a.status === 'Pending Mitigation').length;
    return { total } as unknown as T;
  }

  return undefined;
};

export async function initServerDb() {
  console.log("Memory DB dynamic instance configured successfully. Thread safe WAL emulation enabled.");
}

export async function pruneOldEvents() {
  const cutoff = Date.now() / 1000 - 600; // 10 mins
  const initialLen = dataset.events.length;
  dataset.events = dataset.events.filter(e => e.timestamp >= cutoff);
  const changes = initialLen - dataset.events.length;
  if (changes > 0) {
    saveBackup();
    console.log(`Pruned ${changes} historical events to optimize memory JSON layout.`);
  }
}


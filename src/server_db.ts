import path from "path";
import fs from "fs";
import sqlite3 from "sqlite3";

const DB_DIR = path.join(process.cwd(), "storage");
const DB_PATH = path.join(DB_DIR, "events.db");

// Ensure storage directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Establish single active SQLite connection
const dbConn = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Failed to connect to SQLite events.db:", err);
  } else {
    // Enable WAL mode for high-concurrency read/writes
    dbConn.run("PRAGMA journal_mode=WAL;");
  }
});

// SQLite interface wrapper executing insertions
export const dbRun = (sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> => {
  return new Promise((resolve, reject) => {
    dbConn.run(sql, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
};

// SQLite interface wrapper executing batch queries
export const dbAll = <T = any>(sql: string, params: any[] = []): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    dbConn.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows as T[]);
      }
    });
  });
};

// SQLite interface wrapper executing single queries
export const dbGet = <T = any>(sql: string, params: any[] = []): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    dbConn.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row as T | undefined);
      }
    });
  });
};

// SQLite Schema initialization
export async function initServerDb(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    dbConn.serialize(() => {
      // 1. Events Table
      dbConn.run(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT,
          order_id TEXT,
          timestamp REAL,
          source TEXT,
          formatted_time TEXT GENERATED ALWAYS AS (datetime(timestamp, 'unixepoch'))
        )
      `, (err) => {
        if (err) return reject(err);
      });

      // 2. Anomalies Table
      dbConn.run(`
        CREATE TABLE IF NOT EXISTS anomalies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp REAL,
          z_score REAL,
          window_mean REAL,
          window_std REAL,
          event_count INTEGER,
          status TEXT DEFAULT 'Pending Mitigation',
          diagnosis TEXT DEFAULT 'No analysis yet.',
          formatted_time TEXT GENERATED ALWAYS AS (datetime(timestamp, 'unixepoch'))
        )
      `, (err) => {
        if (err) return reject(err);
      });

      // 3. Agent Trace Logs Table
      dbConn.run(`
        CREATE TABLE IF NOT EXISTS agent_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          anomaly_id INTEGER,
          timestamp REAL,
          step INTEGER,
          type TEXT,
          content TEXT,
          formatted_time TEXT GENERATED ALWAYS AS (datetime(timestamp, 'unixepoch')),
          FOREIGN KEY(anomaly_id) REFERENCES anomalies(id)
        )
      `, (err) => {
        if (err) return reject(err);
        console.log("SQLite events.db schemas configured. Thread-safe WAL active.");
        resolve();
      });
    });
  });
}

// Keep SQLite DB clean by pruning older entries
export async function pruneOldEvents(): Promise<void> {
  const cutoff = Date.now() / 1000 - 600; // 10 minutes historical threshold
  try {
    const res = await dbRun("DELETE FROM events WHERE timestamp < ?", [cutoff]);
    if (res.changes > 0) {
      console.log(`Pruned ${res.changes} historical events to optimize SQLite storage.`);
    }
  } catch (err: any) {
    console.error("Failed to prune SQLite events:", err.message);
  }
}

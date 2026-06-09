import sqlite3
import os
import threading
from datetime import datetime

# Thread-local storage for database connections to avoid concurrency conflicts
_local = threading.local()

def get_db_connection(db_path="storage/events.db"):
    if not hasattr(_local, "conn") or _local.conn is None:
        # Ensure the directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        _local.conn = sqlite3.connect(db_path, timeout=30.0)
        _local.conn.execute("PRAGMA journal_mode=WAL;")  # Enable Write-Ahead Logging for better concurrency
    return _local.conn

def init_db(db_path="storage/events.db"):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create events table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT,
        order_id TEXT,
        timestamp REAL,
        source TEXT
    )
    """)
    
    # Create anomalies table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL,
        z_score REAL,
        window_mean REAL,
        window_std REAL,
        event_count INTEGER,
        status TEXT DEFAULT 'Pending Mitigation',
        diagnosis TEXT DEFAULT 'No analysis yet.'
    )
    """)
    
    # Create agent_logs table for tracking thoughts, actions, observation steps
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS agent_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anomaly_id INTEGER,
        timestamp REAL,
        step INTEGER,
        type TEXT, -- 'Thought', 'Action', 'Observation', 'Final Response'
        content TEXT,
        FOREIGN KEY(anomaly_id) REFERENCES anomalies(id)
    )
    """)
    
    conn.commit()
    conn.close()

def insert_event(event_type, order_id, timestamp, source, db_path="storage/events.db"):
    conn = get_db_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO events (event_type, order_id, timestamp, source) VALUES (?, ?, ?, ?)",
        (event_type, order_id, timestamp, source)
    )
    conn.commit()
    return cursor.lastrowid

def insert_anomaly(timestamp, z_score, window_mean, window_std, event_count, db_path="storage/events.db"):
    conn = get_db_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO anomalies (timestamp, z_score, window_mean, window_std, event_count) VALUES (?, ?, ?, ?, ?)",
        (timestamp, z_score, window_mean, window_std, event_count)
    )
    conn.commit()
    return cursor.lastrowid

def update_anomaly_status(anomaly_id, status, diagnosis, db_path="storage/events.db"):
    conn = get_db_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE anomalies SET status = ?, diagnosis = ? WHERE id = ?",
        (status, diagnosis, anomaly_id)
    )
    conn.commit()

def insert_agent_log(anomaly_id, step, log_type, content, db_path="storage/events.db"):
    conn = get_db_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO agent_logs (anomaly_id, timestamp, step, type, content) VALUES (?, ?, ?, ?, ?)",
        (anomaly_id, datetime.now().timestamp(), step, log_type, content)
    )
    conn.commit()
    return cursor.lastrowid

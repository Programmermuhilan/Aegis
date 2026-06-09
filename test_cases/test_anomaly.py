import unittest
import sys
import os
import sqlite3
import time

# Incorporate root in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from detection.consumer import calculate_stats
from storage.db import init_db, insert_event, insert_anomaly, insert_agent_log, close_db_connection
from mcp_server import MCPServer
from ai.agent_loop import run_react_agent_loop

class TestAnomalyAegis(unittest.TestCase):
    
    def setUp(self):
        self.test_db = "storage/test_events.db"
        # Ensure database is freshly created/reset
        close_db_connection()
        if os.path.exists(self.test_db):
            try:
                os.remove(self.test_db)
            except Exception:
                pass
        init_db(self.test_db)
        
    def tearDown(self):
        close_db_connection()
        if os.path.exists(self.test_db):
            try:
                os.remove(self.test_db)
            except Exception:
                pass

    def test_z_score_calculations_standard(self):
        """
        Verify statistical formulas for rolling averages and standard deviations.
        """
        window = [10, 12, 11, 9, 13]
        mean, std = calculate_stats(window)
        
        self.assertAlmostEqual(mean, 11.0)
        self.assertAlmostEqual(std, 1.5811388300841898) # Sample std dev

    def test_z_score_with_zero_variance(self):
        """
        Z-score must handle situations with 0 variance nicely without dividing by zero.
        """
        window = [10, 10, 10, 10, 10]
        mean, std = calculate_stats(window)
        
        self.assertEqual(mean, 10.0)
        self.assertEqual(std, 0.0)

    def test_database_insertions(self):
        """
        Confirm that SQLite registers stream events and anomalies correctly.
        """
        # Test Event Write
        evt_id = insert_event("order_placed", "ORD_TEST_01", time.time(), "web", db_path=self.test_db)
        self.assertTrue(evt_id > 0)
        
        # Test Anomaly Write
        anom_id = insert_anomaly(time.time(), 4.21, 10.0, 1.5, 25, db_path=self.test_db)
        self.assertTrue(anom_id > 0)
        
        # Verify schema reads
        conn = sqlite3.connect(self.test_db)
        cursor = conn.cursor()
        cursor.execute("SELECT order_id FROM events WHERE id = ?", (evt_id,))
        self.assertEqual(cursor.fetchone()[0], "ORD_TEST_01")
        
        cursor.execute("SELECT z_score FROM anomalies WHERE id = ?", (anom_id,))
        self.assertEqual(cursor.fetchone()[0], 4.21)
        conn.close()

    def test_mcp_server_tools_and_query_database(self):
        """
        Asserts that the Mock MCP engine executes and lists security tools properly.
        """
        mcp = MCPServer(db_path=self.test_db)
        
        # Check tool definitions
        tools = mcp.list_tools()
        self.assertEqual(len(tools), 4)
        tool_names = [t["name"] for t in tools]
        self.assertIn("query_database", tool_names)
        self.assertIn("mitigate_anomaly", tool_names)
        
        # Populate custom dummy data
        insert_event("order_placed", "ORD_BOT_01", time.time(), "mobile", db_path=self.test_db)
        insert_event("order_placed", "ORD_BOT_02", time.time(), "mobile", db_path=self.test_db)
        
        # Run MCP query database tool
        res_json = mcp.query_database("SELECT count(*) as total FROM events WHERE source = 'mobile'")
        import json
        res_data = json.loads(res_json)
        self.assertEqual(res_data[0]["total"], 2)

    def test_mcp_mitigations(self):
        """
        Validate MCP containment calls.
        """
        mcp = MCPServer(db_path=self.test_db)
        res = mcp.mitigate_anomaly(ip_or_source="web", raise_z_threshold=5.0)
        self.assertIn("throttled/blocked source layer 'web'", res)
        self.assertIn("adjusted Z-Score threshold setting to 5.0", res)

    def test_react_agent_deterministic_workflow(self):
        """
        Assert that calling run_react_agent_loop creates standard thoughts, action steps and final answers.
        """
        anom_id = insert_anomaly(time.time(), 5.12, 8.0, 1.2, 35, db_path=self.test_db)
        
        # Execute the Agent Loop
        run_react_agent_loop(anom_id, db_path=self.test_db)
        
        # Fetch trace results from logs
        conn = sqlite3.connect(self.test_db)
        cursor = conn.cursor()
        cursor.execute("SELECT type, content FROM agent_logs WHERE anomaly_id = ? ORDER BY id ASC", (anom_id,))
        logs = cursor.fetchall()
        conn.close()
        
        # Logs should be written for Thought, Action, Observation, Final Response
        self.assertTrue(len(logs) >= 4)
        log_types = [l[0] for l in logs]
        self.assertIn("Thought", log_types)
        self.assertIn("Action", log_types)
        self.assertIn("Observation", log_types)
        self.assertIn("Final Response", log_types)

if __name__ == "__main__":
    unittest.main()

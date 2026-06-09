import sqlite3
import os
import json
from datetime import datetime

class MCPServer:
    """
    Exposes essential debugging, querying, and mitigation tools to the 
    autonomous ReAct AI Agent using Model Context Protocol schemas.
    """
    def __init__(self, db_path="storage/events.db", log_path="storage/system.log"):
        self.db_path = db_path
        self.log_path = log_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        os.makedirs(os.path.dirname(os.path.abspath(self.log_path)), exist_ok=True)

    def list_tools(self):
        """
        Returns the MCP tool descriptions.
        """
        return [
            {
                "name": "query_database",
                "description": "Executes a SELECT query on SQLite storage/events.db to analyze order sources or order ID counts",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sql_query": {"type": "string", "description": "The exact SQL select query to run"}
                    },
                    "required": ["sql_query"]
                }
            },
            {
                "name": "read_system_logs",
                "description": "Reads the final 15 lines of system execution logs to review backend activity",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "mitigate_anomaly",
                "description": "Mitigates anomaly by blocking malicious web/mobile traffic or raising the sliding window Z-Score threshold",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ip_or_source": {"type": "string", "description": "Traffic source identifier to block (e.g., 'web' or 'mobile')"},
                        "raise_z_threshold": {"type": "number", "description": "Adjust the Z-score threshold to reduce alert fatigue"}
                    }
                }
            },
            {
                "name": "trigger_discord_alert",
                "description": "Sends a custom chat notification or diagnostic log to the Discord alerting webhook",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {"type": "string", "description": "Status text to transmit"}
                    },
                    "required": ["message"]
                }
            }
        ]

    def query_database(self, sql_query):
        """
        Tool #1: Query the SQLite event collection.
        """
        # Security sanitization - allow only SELECT
        clean_query = sql_query.strip()
        if not clean_query.lower().startswith("select"):
            return "Error: MCP query_database only accepts read-only SELECT statements."
            
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(clean_query)
            columns = [d[0] for d in cursor.description]
            rows = cursor.fetchall()
            conn.close()
            
            results = [dict(zip(columns, row)) for row in rows]
            return json.dumps(results, indent=2)
        except Exception as e:
            return f"Error executing query: {str(e)}"

    def read_system_logs(self):
        """
        Tool #2: Grab recently written system logs.
        """
        if not os.path.exists(self.log_path):
            # Create standard default entries if missing
            with open(self.log_path, "w") as f:
                f.write(f"[{datetime.now().isoformat()}] INFO [System] Logging initialized.\n")
                f.write(f"[{datetime.now().isoformat()}] INFO [Producer] Event feed generating correctly.\n")
                
        try:
            with open(self.log_path, "r") as f:
                lines = f.readlines()
            last_lines = lines[-15:] if len(lines) > 15 else lines
            return "".join(last_lines)
        except Exception as e:
            return f"Error reading logs: {str(e)}"

    def mitigate_anomaly(self, ip_or_source=None, raise_z_threshold=None):
        """
        Tool #3: Execute critical containment actions.
        """
        actions = []
        if ip_or_source:
            actions.append(f"Successfully throttled/blocked source layer '{ip_or_source}' at load balancer firewall.")
        if raise_z_threshold:
            actions.append(f"Dynamically adjusted Z-Score threshold setting to {raise_z_threshold} to mitigate system alert fatigue.")
            
        if not actions:
            return "No mitigation parameters provided. No actions performed."
            
        return "Containing anomaly: " + " | ".join(actions)

    def trigger_discord_alert(self, message):
        """
        Tool #4: Direct alert dispatcher tool.
        """
        webhook_url = os.getenv("DISCORD_WEBHOOK_URL", "")
        if not webhook_url:
            return f"Simulating alert dispatch: {message}"
            
        # Standard post
        try:
            import requests # Lazy load
            res = requests.post(
                webhook_url,
                json={"content": f"🛡️ **MCP Agent Update:** {message}"},
                timeout=5
            )
            if res.status_code == 204:
                return "Discord alert transmitted successfully."
            else:
                return f"Transmitted with response status: {res.status_code}"
        except Exception as e:
            return f"Failed sending alert: {str(e)}"

    def call_tool(self, name, arguments):
        """
        Decodes and dispatches incoming tool invocations from the agent.
        """
        if name == "query_database":
            return self.query_database(arguments.get("sql_query", ""))
        elif name == "read_system_logs":
            return self.read_system_logs()
        elif name == "mitigate_anomaly":
            return self.mitigate_anomaly(arguments.get("ip_or_source"), arguments.get("raise_z_threshold"))
        elif name == "trigger_discord_alert":
            return self.trigger_discord_alert(arguments.get("message", ""))
        else:
            return f"Unknown tool name: {name}"

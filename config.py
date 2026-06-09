import os
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Event generator settings
EVENT_INTERVAL = float(os.getenv("EVENT_INTERVAL", "0.2"))  # default 200ms
WINDOW_SIZE = int(os.getenv("WINDOW_SIZE", "60"))          # sliding window size (seconds)
Z_SCORE_THRESHOLD = float(os.getenv("Z_SCORE_THRESHOLD", "3.0"))

# Models and Integrations
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")

# SQLite Local Database Configuration
SQLITE_DB = os.getenv("SQLITE_DB", "storage/events.db")

# Agent control
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

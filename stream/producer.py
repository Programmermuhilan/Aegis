import random
import time
import os
import sys
import threading
from datetime import datetime

# Insert parent dir to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from storage.db import insert_event, init_db
from config import EVENT_INTERVAL, SQLITE_DB

# Core running flag
_running = True

def generate_order_event():
    """
    Creates a simulated transaction event record.
    """
    order_id = f"ORD{random.randint(100000, 999999)}"
    source = random.choice(["web", "mobile", "api", "mobile", "web"]) # web & mobile are primary
    return {
        "event": "order_placed",
        "order_id": order_id,
        "timestamp": time.time(),
        "source": source
    }

def producer_worker(queue=None, db_path=SQLITE_DB, interval=EVENT_INTERVAL):
    """
    Runs continuously, generating standard steady state events and occasional heavy traffic surges.
    """
    global _running
    print(f"[Producer] Initiated background order stream using database {db_path}...")
    init_db(db_path)
    
    while _running:
        # 5% probability of initiating a bot/DDoS anomaly surge
        if random.random() < 0.05:
            surge_size = random.randint(15, 30)
            surge_source = random.choice(["mobile", "web"])
            print(f"\n[Producer] ⚠️ SIMULATING TRAFFIC SPIKE: Injecting {surge_size} orders instantly via '{surge_source}'!")
            
            for _ in range(surge_size):
                evt = {
                    "event": "order_placed",
                    "order_id": f"ORD{random.randint(100000, 999999)}",
                    "timestamp": time.time(),
                    "source": surge_source
                }
                # Log to SQL
                insert_event(evt["event"], evt["order_id"], evt["timestamp"], evt["source"], db_path=db_path)
                
                # Push into runtime queue if available
                if queue is not None:
                    queue.put(evt)
                    
            # Cool down after spike
            time.sleep(1.0)
        else:
            # Steady baseline transactions
            evt = generate_order_event()
            insert_event(evt["event"], evt["order_id"], evt["timestamp"], evt["source"], db_path=db_path)
            
            if queue is not None:
                queue.put(evt)
                
            time.sleep(interval)

def stop_producer():
    global _running
    _running = False

if __name__ == "__main__":
    # If run standalone, execute on local thread
    import queue as py_queue
    q = py_queue.Queue()
    try:
        producer_worker(queue=q, db_path="storage/events.db")
    except KeyboardInterrupt:
        print("\n[Producer] Terminating...")
        stop_producer()

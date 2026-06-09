import requests
import json
import os
from datetime import datetime

def send_discord_webhook(webhook_url, message, embed_data=None):
    """
    Sends a rich alert to the designated Discord Webhook URL.
    """
    if not webhook_url:
        print("[Discord Alert] No Webhook URL supplied. Alert logged to console:")
        print(f"[Alert Text]: {message}")
        return False
    
    payload = {
        "content": message
    }
    
    if embed_data:
        payload["embeds"] = [embed_data]
        
    try:
        response = requests.post(
            webhook_url,
            headers={"Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=5
        )
        if response.status_code == 204:
            print("[Discord Alert] Alert successfully sent.")
            return True
        else:
            print(f"[Discord Alert] Failed to trigger alert, status code: {response.status_code}")
            return False
    except Exception as e:
        print(f"[Discord Alert] Exception throwing Discord alert: {e}")
        return False

def trigger_anomaly_discord_alert(webhook_url, anomaly_id, z_score, order_count, mean, std):
    """
    Formulates a structured visual Embed notification for the Discord channel.
    """
    time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")
    
    embed = {
        "title": "🚨 SYSTEM ANOMALY DETECTED (Anomaly Aegis)",
        "color": 15158332, # Vibrant Red
        "fields": [
            {"name": "Anomaly ID", "value": f"#{anomaly_id}", "inline": True},
            {"name": "Current Z-Score", "value": f"**{z_score:.2f}**", "inline": True},
            {"name": "Events in Window", "value": f"{order_count} orders", "inline": True},
            {"name": "Baseline Mean", "value": f"{mean:.2f} orders/sec", "inline": True},
            {"name": "Baseline Std Dev", "value": f"{std:.2f}", "inline": True},
            {"name": "Timestamp", "value": time_str, "inline": False}
        ],
        "description": "The system order rate has breached the Z-Score threshold. The Anomaly Aegis ReAct AI Agent has been spawned to run real-time diagnostic mitigation.",
        "footer": {
            "text": "Anomaly Aegis Streaming Control Loop"
        }
    }
    
    msg_content = f"📣 **Anomaly Alert!** Anomaly Aegis detected a sliding window breach (Z-Score: **{z_score:.2f}**)."
    return send_discord_webhook(webhook_url, msg_content, embed)

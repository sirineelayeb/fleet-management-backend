import json
from collections import defaultdict
import numpy as np


def load_wifi_data(file_path):
    """Load Wi-Fi scan data from JSON or JSONL"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            first_char = f.read(1)
            f.seek(0)
            if first_char == "[":
                return json.load(f)
            else:
                return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        raise FileNotFoundError(f"File {file_path} not found.")
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}")


def process_data(data):
    """Compute GPS points, network detections, and estimated network positions"""
    gps_points = []
    network_detections = defaultdict(list)

    for entry in data:
        if not all(k in entry for k in ["lat", "lon", "networks"]):
            continue

        lat = float(entry["lat"])
        lon = float(entry["lon"])
        timestamp = entry.get("timestamp", "unknown")
        scan_id = entry.get("scan_id", -1)

        gps_points.append({
            "lat": lat, "lon": lon,
            "timestamp": timestamp, "scan_id": scan_id
        })

        for net in entry["networks"]:
            mac = net.get("mac", "unknown")
            ssid = net.get("ssid", "Hidden")
            rssi = net.get("rssi")

            # ✅ fixed: -100 is now valid (was excluded before), 0 is still rejected
            if rssi is None or rssi >= 0 or rssi < -100:
                continue

            network_detections[mac].append({
                "lat": lat, "lon": lon, "rssi": rssi,
                "ssid": ssid, "timestamp": timestamp, "scan_id": scan_id
            })

    # Compute network positions
    network_positions = {}
    for mac, dets in network_detections.items():
        rssi_vals = [d["rssi"] for d in dets]

        # ✅ fixed: use position of STRONGEST detection, not average position
        # Average lat/lon is meaningless — the router is where signal is strongest
        best_det = max(dets, key=lambda d: d["rssi"])

        network_positions[mac] = {
            "lat": best_det["lat"],         # position of strongest RSSI
            "lon": best_det["lon"],
            "ssid": most_common_ssid(dets),
            "avg_rssi": float(np.mean(rssi_vals)),
            "max_rssi": max(rssi_vals),
            "min_rssi": min(rssi_vals),
            "std_rssi": float(np.std(rssi_vals)),
            "detection_count": len(dets),
            "detections": dets
        }

    return gps_points, network_detections, network_positions


def most_common_ssid(dets):
    """Return the most frequent SSID"""
    ssids = [d["ssid"] for d in dets if d["ssid"].upper() != "HIDDEN"]
    return max(ssids, key=ssids.count) if ssids else "Hidden Network"
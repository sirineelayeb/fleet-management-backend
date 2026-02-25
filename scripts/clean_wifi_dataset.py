# scripts/clean_wifi_dataset.py
import json
import re
import csv
from collections import Counter, defaultdict
import math
from pathlib import Path
from config import Config

# -----------------------------
# Ensure output directories exist
# -----------------------------
Config.DATA_PROCESSED.mkdir(parents=True, exist_ok=True)
Config.OUTPUTS.mkdir(parents=True, exist_ok=True)

# -----------------------------
# Configuration
# -----------------------------
INPUT_FILE = Config.DATA_RAW / "mahdia_wifi_scans.txt"
OUTPUT_JSON = Config.DATA_PROCESSED / "wifi_fingerprint_clean.json"
OUTPUT_CSV = Config.DATA_PROCESSED / "wifi_fingerprint_clean.csv"

RSSI_MIN = -90
MIN_MAC_COUNT = 5
MAX_DISTANCE = 500  # meters

# Hotspot keywords
EXCLUDED_KEYWORDS = [
    # Mobile brands (common phones)
    "Android", "Galaxy", "iPhone", "Redmi", "OPPO", "Infinix", 
    "Huawei", "Xiaomi", "Vivo", "Realme", "OnePlus", "Honor", 
    "Motorola", "Nokia", "OnePlus", "☠️☠️💡"
]

# -----------------------------
# Haversine distance
# -----------------------------
def gps_distance(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * \
        math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

# -----------------------------
# STEP 1: Parse raw file
# -----------------------------
def parse_raw_wifi(file: Path):
    if not file.exists():
        raise FileNotFoundError(f"Raw WiFi file not found: {file}")

    with open(file, "r", encoding="utf-8") as f:
        raw = f.read()

    entries = raw.split("━━━━━━━━━━━━━━━━━")
    data = []

    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue

        timestamp_match = re.search(r'⏰\s*([\d\-]+\s[\d:]+)', entry)
        gps_match = re.search(r'GPS:\s*([-\d.]+),\s*([-\d.]+)', entry)
        wifi_match = re.search(r'(\d+)\|(\d+)\|(.*)', entry)

        if not gps_match or not wifi_match:
            continue

        lat = float(gps_match.group(1))
        lon = float(gps_match.group(2))

        # Remove invalid GPS
        if abs(lat) < 0.0001 and abs(lon) < 0.0001:
            continue

        scan_id = int(wifi_match.group(1))
        millis = int(wifi_match.group(2))
        fingerprint = wifi_match.group(3)

        networks = []

        for net in fingerprint.split(";"):
            parts = net.split(",")
            if len(parts) != 3:
                continue

            ssid, mac, rssi = parts
            ssid = ssid.strip()
            mac = mac.strip()

            # ✅ Normalize SSID and filter hotspots
            ssid_clean = ssid.lower()
            if any(keyword.lower() in ssid_clean for keyword in EXCLUDED_KEYWORDS):
                continue

            try:
                rssi = int(rssi)
                if rssi >= RSSI_MIN:
                    networks.append({
                        "ssid": ssid,
                        "mac": mac,
                        "rssi": rssi
                    })
            except ValueError:
                continue

        # Remove empty scans
        if not networks:
            continue

        data.append({
            "timestamp": timestamp_match.group(1) if timestamp_match else None,
            "scan_id": scan_id,
            "millis": millis,
            "lat": lat,
            "lon": lon,
            "networks": networks
        })

    return data

# -----------------------------
# STEP 2: Remove exact duplicates
# -----------------------------
def remove_exact_duplicates(data):
    seen = set()
    cleaned = []

    for entry in data:
        unique_networks = []
        for net in entry["networks"]:
            key = (entry["lat"], entry["lon"], net["mac"], net["rssi"])
            if key not in seen:
                seen.add(key)
                unique_networks.append(net)
        if unique_networks:
            entry["networks"] = unique_networks
            cleaned.append(entry)

    return cleaned

# # -----------------------------
# # STEP 3: Remove rare MACs
# # -----------------------------
# def remove_rare_macs(data):
#     mac_count = Counter()
#     for entry in data:
#         for net in entry["networks"]:
#             mac_count[net["mac"]] += 1

#     filtered = []
#     for entry in data:
#         nets = [n for n in entry["networks"] if mac_count[n["mac"]] >= MIN_MAC_COUNT]
#         if nets:
#             entry["networks"] = nets
#             filtered.append(entry)
#     return filtered

# # -----------------------------
# # STEP 4: Remove moving routers
# # -----------------------------
# def remove_moving_macs(data):
    mac_locations = defaultdict(list)
    for entry in data:
        for net in entry["networks"]:
            mac_locations[net["mac"]].append((entry["lat"], entry["lon"]))

    moving = set()
    for mac, locs in mac_locations.items():
        base = locs[0]
        for loc in locs[1:]:
            if gps_distance(base[0], base[1], loc[0], loc[1]) > MAX_DISTANCE:
                moving.add(mac)
                break

    cleaned = []
    for entry in data:
        nets = [n for n in entry["networks"] if n["mac"] not in moving]
        if nets:
            entry["networks"] = nets
            cleaned.append(entry)
    return cleaned

# -----------------------------
# Save dataset
# -----------------------------
def save_dataset(data):
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp","scan_id","lat","lon","ssid","mac","rssi"])
        for entry in data:
            for net in entry["networks"]:
                writer.writerow([
                    entry["timestamp"],
                    entry["scan_id"],
                    entry["lat"],
                    entry["lon"],
                    net["ssid"],
                    net["mac"],
                    net["rssi"]
                ])

# -----------------------------
# MAIN
# -----------------------------
if __name__ == "__main__":
    print("🔹 Parsing raw data...")
    data = parse_raw_wifi(INPUT_FILE)
    print("Scans after parsing:", len(data))

    print("🔹 Removing exact duplicates...")
    data = remove_exact_duplicates(data)
    print("Scans after duplicate removal:", len(data))

    # print("🔹 Removing rare MACs...")
    # data = remove_rare_macs(data)
    # print("Scans after rare MAC removal:", len(data))

    # print("🔹 Removing moving routers...")
    # data = remove_moving_macs(data)
    # print("Final scans:", len(data))

    save_dataset(data)
    print(f"✅ Cleaning finished! JSON saved to: {OUTPUT_JSON}")
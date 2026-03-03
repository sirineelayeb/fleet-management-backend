# scripts/clean_wifi_dataset.py
#
# WiFi fingerprint cleaner — optimized for TRUCK position estimation.
#
# A truck moves fast, covers large distances, and scans WiFi from the road.
# That changes several assumptions vs. a person walking:
#   - A router seen from a truck can be 200m away easily (strong antenna, open road)
#   - The truck moves fast so consecutive scans can be far apart
#   - We want STABLE routers (fixed infrastructure) not mobile devices
#   - RSSI from a moving truck is noisier → we keep more samples, not fewer

import json
import csv
import math
import re
from pathlib import Path
from collections import defaultdict
from typing import List, Dict

from config import Config

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
INPUT_FILE  = Config.DATA_RAW / "mahdia_wifi_scans.txt"
OUTPUT_JSON = Config.DATA_PROCESSED / "wifi_fingerprint_clean.json"
OUTPUT_CSV  = Config.DATA_PROCESSED / "wifi_fingerprint_clean.csv"

# RSSI thresholds
# Trucks scan from roads — routers can be further away than when walking
# So we accept weaker signals than -90 dBm
RSSI_MIN   = -92   # discard anything weaker than this (pure noise)
RSSI_FLOOR = -95   # hard floor to clamp extreme outliers

# A MAC must appear in at least this many scans to be considered stable
# Your data shows median 5 scans/MAC and avg 2.6 networks/scan
# Lowering to 2 recovers more MACs → more networks per scan → better positioning
MIN_MAC_COUNT = 2

# Max spread of detections for a single MAC before it's flagged as "moving"
MAX_DISTANCE = 1000  # meters

# If a MAC is seen in more than this many scans spread across a huge area
# it's probably a mobile device (e.g. another truck with a hotspot)
MAX_AREA_FOR_MOBILE = 2000  # meters — MACs seen across > 2km are likely mobile

# Keywords that identify mobile hotspots / phones to exclude
EXCLUDED_KEYWORDS = {
    "android", "iphone", "redmi", "oppo", "infinix",
    "huawei", "xiaomi", "vivo", "realme", "oneplus",
    "honor", "motorola", "nokia", "samsung",
    "hotspot", "mobile", "4g", "lte", "mifi",
    "phone", "ipad", "tablet", "tethering"
}

# MAC OUI prefixes of known phone/mobile manufacturers to exclude
# (first 3 bytes of MAC address)
MOBILE_OUI_PREFIXES = {
    "8C:85:90",  # Apple
    "AC:BC:32",  # Apple
    "F0:D1:A9",  # Apple
    "A4:C3:F0",  # Apple
    "40:4D:7F",  # Samsung
    "8C:77:12",  # Samsung
    "50:A4:C8",  # Huawei
    "00:E0:FC",  # Huawei
    "AC:CF:85",  # Xiaomi
    "64:09:80",  # Xiaomi
    "28:6C:07",  # Oppo
    "D4:61:DA",  # Vivo
}


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2):
    """Distance in meters between two GPS coordinates."""
    R = 6_371_000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat/2)**2 +
         math.cos(math.radians(lat1)) *
         math.cos(math.radians(lat2)) *
         math.sin(dlon/2)**2)
    return 2 * R * math.atan2(math.sqrt(min(1, max(0, a))), math.sqrt(1 - min(1, max(0, a))))


def max_spread(locations):
    """
    Return the maximum distance (meters) between any two detections of a MAC.
    We sample up to 100 points to keep it fast on large datasets.
    """
    locs = locations[:100]
    if len(locs) < 2:
        return 0
    return max(
        haversine(locs[i][0], locs[i][1], locs[j][0], locs[j][1])
        for i in range(len(locs))
        for j in range(i + 1, len(locs))
    )


def is_mobile_ssid(ssid: str) -> bool:
    """Return True if the SSID looks like a mobile hotspot."""
    return any(k in ssid.lower() for k in EXCLUDED_KEYWORDS)


def is_mobile_oui(mac: str) -> bool:
    """Return True if the MAC belongs to a known mobile manufacturer."""
    prefix = mac[:8].upper()
    return prefix in MOBILE_OUI_PREFIXES


def rssi_is_stable(rssi_list):
    """
    For truck position estimation, unstable RSSI (huge variance) across
    detections of the same MAC suggests a moving device or reflection noise.
    Returns True if the signal is stable enough to be useful.
    """
    if len(rssi_list) < 3:
        return True  # not enough data to judge
    mean = sum(rssi_list) / len(rssi_list)
    variance = sum((r - mean) ** 2 for r in rssi_list) / len(rssi_list)
    std_dev = math.sqrt(variance)
    # If std deviation > 15 dBm the signal is too noisy to be useful
    return std_dev <= 15


# ─────────────────────────────────────────────
# STEP 1 — PARSE
# ─────────────────────────────────────────────

def parse_raw_wifi(file: Path) -> List[Dict]:
    if not file.exists():
        raise FileNotFoundError(file)

    raw = file.read_text(encoding="utf-8")
    blocks = raw.split("━━━━━━━━━━━━━━━━━")

    dataset = []
    seen_ids = set()  # prevent duplicate scan_ids

    for block in blocks:
        scan_id_match = re.search(r"(\d+)\|(\d+)\|", block)
        scan_id = int(scan_id_match.group(1)) if scan_id_match else None

        # Skip duplicate scans
        if scan_id in seen_ids:
            continue
        seen_ids.add(scan_id)

        gps  = re.search(r"GPS:\s*([-\d.]+),\s*([-\d.]+)", block)
        wifi = re.search(r"\d+\|\d+\|(.*)", block)
        ts   = re.search(r"⏰\s*([\d\-]+\s[\d:]+)", block)

        if not gps or not wifi or scan_id is None:
            continue

        lat, lon = float(gps.group(1)), float(gps.group(2))

        # Skip invalid GPS (0,0 or clearly wrong coordinates)
        if abs(lat) < 0.001 and abs(lon) < 0.001:
            continue

        networks = []
        for net in wifi.group(1).split(";"):
            parts = net.split(",")
            if len(parts) != 3:
                continue

            ssid, mac, rssi_raw = parts
            ssid = ssid.strip()
            mac  = mac.strip().upper()

            # Skip mobile hotspots by SSID or MAC manufacturer
            if is_mobile_ssid(ssid) or is_mobile_oui(mac):
                continue

            try:
                rssi = max(int(rssi_raw), RSSI_FLOOR)
            except ValueError:
                continue  # skip malformed RSSI values

            if rssi >= RSSI_MIN:
                networks.append({"ssid": ssid, "mac": mac, "rssi": rssi})

        if networks:
            dataset.append({
                "scan_id":   scan_id,
                "timestamp": ts.group(1) if ts else None,
                "lat":       lat,
                "lon":       lon,
                "networks":  networks
            })

    return dataset


# ─────────────────────────────────────────────
# STEP 2 — REMOVE RARE MACs
# A MAC seen in fewer than MIN_MAC_COUNT scans is unreliable for positioning
# ─────────────────────────────────────────────

def remove_rare_macs(data: List[Dict]) -> List[Dict]:
    mac_scans = defaultdict(set)
    for i, entry in enumerate(data):
        for net in entry["networks"]:
            mac_scans[net["mac"]].add(i)

    valid = {m for m, s in mac_scans.items() if len(s) >= MIN_MAC_COUNT}

    return [
        {**e, "networks": [n for n in e["networks"] if n["mac"] in valid]}
        for e in data
        if any(n["mac"] in valid for n in e["networks"])
    ]


# ─────────────────────────────────────────────
# STEP 3 — REMOVE MOVING MACs
# If a MAC is detected across a spread > MAX_DISTANCE it's likely mobile
# ─────────────────────────────────────────────

def remove_moving_macs(data: List[Dict]) -> List[Dict]:
    mac_locations = defaultdict(list)
    for entry in data:
        for net in entry["networks"]:
            mac_locations[net["mac"]].append((entry["lat"], entry["lon"]))

    moving = {
        mac for mac, locs in mac_locations.items()
        if max_spread(locs) > MAX_DISTANCE
    }

    print(f"  Removed {len(moving)} moving MACs")

    return [
        {**e, "networks": [n for n in e["networks"] if n["mac"] not in moving]}
        for e in data
        if any(n["mac"] not in moving for n in e["networks"])
    ]


# ─────────────────────────────────────────────
# STEP 4 — REMOVE NOISY MACs (new for trucks)
# A MAC whose RSSI varies wildly (std dev > 15 dBm) across all detections
# is unreliable for position estimation — could be reflection or interference
# ─────────────────────────────────────────────

def remove_noisy_macs(data: List[Dict]) -> List[Dict]:
    mac_rssi = defaultdict(list)
    for entry in data:
        for net in entry["networks"]:
            mac_rssi[net["mac"]].append(net["rssi"])

    noisy = {
        mac for mac, rssi_list in mac_rssi.items()
        if not rssi_is_stable(rssi_list)
    }

    print(f"  Removed {len(noisy)} noisy MACs (high RSSI variance)")

    return [
        {**e, "networks": [n for n in e["networks"] if n["mac"] not in noisy]}
        for e in data
        if any(n["mac"] not in noisy for n in e["networks"])
    ]


# ─────────────────────────────────────────────
# STEP 5 — SMOOTH RSSI (new for trucks)
# For each (mac, GPS position) group, replace individual RSSI values
# with the median of all readings at nearby positions.
# This reduces measurement noise from truck vibration and multipath.
# ─────────────────────────────────────────────

def smooth_rssi(data: List[Dict], radius_m: float = 30.0) -> List[Dict]:
    """
    For each detection, replace its RSSI with the median RSSI of all
    detections of the same MAC within `radius_m` meters.
    This smooths out noisy single readings caused by truck movement.
    """
    # Build index: mac -> list of (lat, lon, rssi, entry_idx, net_idx)
    index = defaultdict(list)
    for i, entry in enumerate(data):
        for j, net in enumerate(entry["networks"]):
            index[net["mac"]].append((entry["lat"], entry["lon"], net["rssi"], i, j))

    # For each detection, find nearby readings of the same MAC and take median
    smoothed = [
        {**e, "networks": [{**n} for n in e["networks"]]}
        for e in data
    ]

    for mac, readings in index.items():
        for lat, lon, rssi, i, j in readings:
            nearby_rssi = [
                r for rlat, rlon, r, _, _ in readings
                if haversine(lat, lon, rlat, rlon) <= radius_m
            ]
            if len(nearby_rssi) >= 2:
                nearby_rssi.sort()
                median = nearby_rssi[len(nearby_rssi) // 2]
                smoothed[i]["networks"][j]["rssi"] = median

    return smoothed


# ─────────────────────────────────────────────
# SAVE
# ─────────────────────────────────────────────

def save(data: List[Dict]):
    OUTPUT_JSON.write_text(json.dumps(data, indent=2))

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["scan_id", "timestamp", "lat", "lon", "ssid", "mac", "rssi"])
        for e in data:
            for n in e["networks"]:
                writer.writerow([
                    e["scan_id"], e["timestamp"],
                    e["lat"], e["lon"],
                    n["ssid"], n["mac"], n["rssi"]
                ])


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

if __name__ == "__main__":
    Config.ensure_dirs()

    print("📂 Parsing raw data...")
    data = parse_raw_wifi(INPUT_FILE)
    print(f"  {len(data)} scans parsed")

    print("🔍 Removing rare MACs...")
    data = remove_rare_macs(data)
    print(f"  {len(data)} scans remaining")

    print("🚗 Removing moving MACs...")
    data = remove_moving_macs(data)
    print(f"  {len(data)} scans remaining")

    print("📉 Removing noisy MACs...")
    data = remove_noisy_macs(data)
    print(f"  {len(data)} scans remaining")

    print("🔧 Smoothing RSSI values...")
    data = smooth_rssi(data)
    print(f"  Done")

    print("💾 Saving...")
    save(data)
    print(f"  Saved → {OUTPUT_JSON}")
    print(f"  Saved → {OUTPUT_CSV}")

    # ── Summary ──────────────────────────────
    all_macs = {n["mac"] for e in data for n in e["networks"]}
    print(f"\n✅ Final dataset: {len(data)} scans, {len(all_macs)} unique MACs")

    # ── Diagnostics — helps you tune the thresholds ──
    print("\n📊 Diagnostics:")

    # How many scans per MAC?
    mac_scan_count = defaultdict(int)
    for e in data:
        for n in e["networks"]:
            mac_scan_count[n["mac"]] += 1
    counts = sorted(mac_scan_count.values())
    print(f"  Scans per MAC  → min:{counts[0]}  max:{counts[-1]}  "
          f"avg:{sum(counts)//len(counts)}  median:{counts[len(counts)//2]}")

    # RSSI std dev per MAC — tells you if 15 dBm threshold is right
    mac_rssi = defaultdict(list)
    for e in data:
        for n in e["networks"]:
            mac_rssi[n["mac"]].append(n["rssi"])

    std_devs = []
    for rssi_list in mac_rssi.values():
        if len(rssi_list) >= 3:
            mean = sum(rssi_list) / len(rssi_list)
            std  = math.sqrt(sum((r - mean)**2 for r in rssi_list) / len(rssi_list))
            std_devs.append(round(std, 1))
    std_devs.sort()
    if std_devs:
        print(f"  RSSI std dev   → min:{std_devs[0]}  max:{std_devs[-1]}  "
              f"avg:{round(sum(std_devs)/len(std_devs),1)}  "
              f"median:{std_devs[len(std_devs)//2]}")
        noisy_count = sum(1 for s in std_devs if s > 15)
        print(f"  MACs with std > 15 dBm: {noisy_count} "
              f"({'already removed' if noisy_count == 0 else 'consider lowering threshold'})")

    # Avg networks per scan — higher = better for positioning
    nets_per_scan = [len(e["networks"]) for e in data]
    print(f"  Networks/scan  → min:{min(nets_per_scan)}  max:{max(nets_per_scan)}  "
          f"avg:{round(sum(nets_per_scan)/len(nets_per_scan), 1)}")
    good_scans = sum(1 for n in nets_per_scan if n >= 3)
    poor_scans = sum(1 for n in nets_per_scan if n == 1)
    print(f"  Scans with ≥3 networks (good for positioning): "
          f"{good_scans}/{len(data)} ({100*good_scans//len(data)}%)")
    print(f"  Scans with only 1 network (not usable): "
          f"{poor_scans}/{len(data)} ({100*poor_scans//len(data)}%)")

    if good_scans / len(data) < 0.5:
        print("  ⚠️  Less than 50% of scans are usable for positioning.")
        print("     → Consider collecting more data in the same area")
        print("     → Or lower MIN_MAC_COUNT further to recover more MACs")

    # RSSI distribution
    all_rssi = [n["rssi"] for e in data for n in e["networks"]]
    print(f"  RSSI range     → min:{min(all_rssi)} dBm  max:{max(all_rssi)} dBm  "
          f"avg:{round(sum(all_rssi)/len(all_rssi), 1)} dBm")
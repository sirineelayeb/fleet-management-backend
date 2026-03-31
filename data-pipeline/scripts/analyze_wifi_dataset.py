import pandas as pd
df = pd.read_csv("data/processed/wifi_fingerprint_clean.csv")

print("Total rows:", len(df))
print("Unique scans:", df['scan_id'].nunique())
print("Unique MACs:", df['mac'].nunique())
print("RSSI stats:\n", df['rssi'].describe())

scan_counts = df.groupby('scan_id')['mac'].count()
print(scan_counts.describe())  # networks per scan

scan_counts = df.groupby('scan_id')['mac'].count()
print(scan_counts.describe())  # networks per scan

import math
from collections import defaultdict

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2)
    a = min(1, max(0, a))
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1-a))

mac_locs = defaultdict(list)
for _, row in df.iterrows():
    mac_locs[row['mac']].append((row['lat'], row['lon']))

moving_macs = []
for mac, locs in mac_locs.items():
    if len(locs) < 2: continue
    lats, lons = zip(*locs)
    spread = haversine(min(lats), min(lons), max(lats), max(lons))
    if spread > 500:
        moving_macs.append(mac)
print("Moving MACs (>500 m):", len(moving_macs))

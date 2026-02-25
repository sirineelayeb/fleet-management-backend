# 📡 NoGPS WiFi Geolocation — Mahdia, Tunisia

> A WiFi fingerprinting data collection and visualization pipeline built for outdoor positioning research without GPS dependency.  
> Collected and developed by **Sirine Elayeb** — PFE Internship Project.

---

## 🗺️ Project Overview

This project is part of a **truck fleet management system** for the city of **Mahdia, Tunisia**. It uses WiFi fingerprinting as an alternative positioning method — allowing trucks to be tracked in areas where GPS is unavailable, unreliable, or too costly.

WiFi scan data was collected across the city (by bicycle), cleaned, and visualized as interactive maps — building the fingerprint dataset that will feed the positioning model.

**The goal:** *Track and manage a fleet of trucks using only the WiFi networks visible around them — without GPS.*

### What the pipeline produces

| Output | Description |
|--------|-------------|
| `wifi_map.html` | Interactive map showing scan points, AP locations, and coverage circles |
| `wifi_heatmap.html` | Signal strength heatmap over the surveyed area |
---

## 📁 Project Structure

```
NoGPSgeolocalisation/
│
├── data/
│   ├── raw/
│   │   └── mahdia_wifi_scans.txt       # Raw scan logs from Android logger
│   └── processed/
│       ├── wifi_fingerprint_clean.json # Cleaned structured data (JSON)
│       └── wifi_fingerprint_clean.csv  # Flat CSV for ML ingestion
│
├── outputs/
│   ├── wifi_map.html                   # Interactive coverage map
│   ├── wifi_heatmap.html               # Signal heatmap
│
├── scripts/
│   ├── clean_wifi_dataset.py           # Stage 1 — Parse and filter raw data
│   ├── data_processing.py              # Stage 2 — Restructure into per-MAC profiles
│   ├── analysis.py                     # Math functions (RSSI→distance, signal quality)
│   ├── visualization.py                # Generate all maps and charts
│   └── report.py                       # Print summary statistics
│
├── config.py                           # All settings, thresholds, and paths
├── main.py                             # Entry point — runs the full pipeline
└── requirements.txt                    # Python dependencies
```

---

## ⚙️ Pipeline Stages

```
raw text file
      │
      ▼
clean_wifi_dataset.py   →   Filter hotspots, weak signals, exact duplicates
      │
      ▼
wifi_fingerprint_clean.json / .csv
      │
      ▼
data_processing.py      →   Flatten + compute per-MAC profiles
      │
      ▼
analysis.py             →   RSSI → distance, signal quality labels
      │
      ▼
visualization.py        →   Interactive HTML maps + PNG charts
      │
      ▼
report.py               →   Terminal statistics summary
```

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/tliliIlyes/NoGPSgeolocalisation.git
cd NoGPSgeolocalisation
```

### 2. Create and activate a virtual environment

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS / Linux
python -m venv venv
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Add your raw data

Place your scan log file at:
```
data/raw/mahdia_wifi_scans.txt
```

The expected format per scan entry (separated by `━━━━━━━━━━━━━━━━━`):
```
⏰ 2024-03-15 14:32:10
📍 GPS: 35.5042, 11.0622
101|45231|Tunisie_Telecom-2.4G,AA:BB:CC:DD:EE:FF,-72;Ooredoo-Home,11:22:33:44:55:66,-81
```

---

## ▶️ Running the Pipeline

### Step 1 — Clean and parse raw data

```bash
python -m scripts.clean_wifi_dataset
```

Expected output:
```
🔹 Parsing raw data...
Scans after parsing: 573
🔹 Removing exact duplicates...
Scans after duplicate removal: 573
✅ Cleaning finished! JSON saved to: data\processed\wifi_fingerprint_clean.json
```

### Step 2 — Generate all visualizations

```bash
python -m main
```

Expected output:
```
===================================
 NoGPS WiFi Geolocation System
 Location: Mahdia - Tunisia
===================================

=== WiFi Fingerprinting Statistics ===
Total scans         : 573
Unique positions    : 475
Total distance      : 35379.0 m
Unique networks     : 943
Total detections    : 2427

✅ Interactive map saved: outputs\wifi_map.html
✅ Heatmap saved: outputs\wifi_heatmap.html
✅ All visualizations generated in: outputs
```

Then open any `.html` file in your browser to explore the interactive maps.

---

## 🔧 Configuration

All tunable parameters live in `config.py` — you never need to touch individual scripts:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `RSSI_MIN` | `-95` | Discard networks weaker than this |
| `RSSI_MAX` | `-30` | Maximum expected RSSI |
| `TX_POWER` | `20` | Transmit power for distance estimation (dBm) |
| `PATH_LOSS_EXPONENT` | `3` | Environment factor (2=free space, 3=urban outdoor) |
| `DEFAULT_ZOOM` | `17` | Initial map zoom level |
| `MAP_TILES` | `OpenStreetMap` | Default map tile layer |

---

## 🗂️ Data Cleaning — What Gets Filtered

The cleaning stage (`clean_wifi_dataset.py`) applies these filters in order:

**1. Mobile hotspot / phone SSIDs removed**
Any network whose SSID contains brand names like `Android`, `iPhone`, `Galaxy`, `Huawei`, `Redmi`, `OPPO`, `Xiaomi`, etc. is discarded as it belongs to a moving device.

---

## 📊 Dataset Statistics (Mahdia Collection)

| Metric | Value |
|--------|-------|
| Total scans | 573 |
| Unique GPS positions | 475 |
| Total route distance | ~35.4 km |
| Unique access points | 943 |
| Total AP detections | 2,427 |
| Avg detections per AP | 2.6 |
| RSSI range | -90 to -54 dBm |
| Average RSSI | -82.9 dBm |

---

## 🗺️ Map Features

The interactive map (`wifi_map.html`) includes:

- **Blue polyline** — your exact data collection route
- **Colored dots** — estimated position of each unique access point
- **Translucent circles** — signal coverage area per AP (size = signal strength)
- **Clickable popups** — SSID, MAC, average RSSI, signal quality, estimated distance
- **Layer switcher** — toggle between OpenStreetMap, Light, Dark, and Satellite views
- **Minimap** — overview navigation panel
- **Fullscreen** button

The heatmap (`wifi_heatmap.html`) shows signal density across the area:

| Color | Signal Range |
|-------|-------------|
| 🔴 Red | Excellent (-40 to -60 dBm) |
| 🟠 Orange | Very Good (-60 to -70 dBm) |
| 🟡 Yellow | Good (-70 to -75 dBm) |
| 🟢 Green | Fair (-75 to -80 dBm) |
| 🔵 Cyan | Weak (-80 to -85 dBm) |
| ⚫ Blue | Very Weak (-85 to -95 dBm) |

---

## 📦 Dependencies

```
folium
numpy
matplotlib
```

Install all at once:
```bash
pip install -r requirements.txt
```

---

## 🔬 Signal-to-Distance Model

Distance is estimated using the **log-distance path loss model**:

```
distance = 10 ^ ((TxPower - RSSI) / (10 × n))
```

Where:
- `TxPower = 20 dBm` (typical router transmit power)  
- `n = 3` (path loss exponent for urban outdoor environments)
- `RSSI` = measured signal strength in dBm

---

## 📌 Known Limitations

- AP map position = mean of detection points, not true router location
- Generic SSIDs (e.g. `SFR-XXXX`) may not be filtered as hotspots
- Single-pass outdoor routes give fewer detections per AP than indoor datasets

---

## 👩‍💻 Author

**Sirine Elayeb**  . PFE Internship  . 2026

---

## 📄 License

This project is for academic and research purposes.

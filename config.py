from enum import Enum
from pathlib import Path


class CircleMode(Enum):
    """Circle display mode on map"""
    UNCERTAINTY = "uncertainty"
    STRENGTH = "strength"


class Config:
    """Global configuration for NoGPS WiFi Geolocation Project"""

    # =========================
    # PROJECT INFO
    # =========================
    PROJECT_NAME = "NoGPS WiFi Geolocation"
    LOCATION = "Mahdia - Tunisia"
    AUTHOR = "Sirine Elayeb"

    # =========================
    # FOLDERS
    # =========================
    BASE_DIR = Path(".")
    DATA_RAW = BASE_DIR / "data/raw"
    DATA_PROCESSED = BASE_DIR / "data/processed"
    OUTPUTS = BASE_DIR / "outputs"

    INPUT_FILE = DATA_PROCESSED / "wifi_fingerprint_clean.json"

    OUTPUT_MAP = OUTPUTS / "wifi_map.html"
    OUTPUT_HEATMAP = OUTPUTS / "wifi_heatmap.html"
    OUTPUT_SIGNAL_PLOT = OUTPUTS / "signal_strength.png"
    OUTPUT_COMPARISON = OUTPUTS / "network_comparison.png"

    # =========================
    # MAP SETTINGS
    # =========================
    DEFAULT_ZOOM = 17
    MAP_TILES = "OpenStreetMap"

    # =========================
    # RSSI / DISTANCE MODEL
    # =========================
    RSSI_MIN = -95
    RSSI_MAX = -30
    TX_POWER = 20
    PATH_LOSS_EXPONENT = 3

    # =========================
    # ML PARAMETERS
    # =========================
    TEST_SIZE = 0.2
    RANDOM_STATE = 42

    # =========================
    # COLORS
    # =========================
    COLOR_PALETTE = [
        "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A",
        "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E2",
        "#F8B739", "#52B788", "#E76F51", "#2A9D8F",
        "#E63946", "#F77F00", "#06FFA5", "#8338EC"
    ]

    # =========================
    # SIGNAL QUALITY THRESHOLDS
    # =========================
    SIGNAL_EXCELLENT = -50
    SIGNAL_VERY_GOOD = -60
    SIGNAL_GOOD = -70
    SIGNAL_FAIR = -80
    SIGNAL_WEAK = -90
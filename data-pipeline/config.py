# config.py
"""
Central configuration for the NoGPS WiFi Geolocation project.
All paths, thresholds, and constants live here — change once, applies everywhere.
"""

from enum import Enum
from pathlib import Path


class CircleMode(Enum):
    """Circle display mode on the visualisation map."""
    UNCERTAINTY = "uncertainty"
    STRENGTH    = "strength"


class Config:
    """Global configuration for the NoGPS WiFi Geolocation project."""

    # =========================================================================
    # PROJECT INFO
    # =========================================================================
    PROJECT_NAME = "NoGPS WiFi Geolocation"
    LOCATION     = "Mahdia - Tunisia"
    AUTHOR       = "Sirine Elayeb"

    # =========================================================================
    # FOLDERS
    # =========================================================================
    ROOT           = Path(__file__).parent
    DATA_RAW       = ROOT / "data" / "raw"
    DATA_PROCESSED = ROOT / "data" / "processed"
    MODELS         = ROOT / "models"
    OUTPUTS        = ROOT / "outputs"

    # =========================================================================
    # FILE PATHS — Raw input
    # =========================================================================
    RAW_WIFI_FILE = DATA_RAW / "mahdia_wifi_scans.txt"

    # =========================================================================
    # FILE PATHS — Processed
    # =========================================================================
    CLEAN_JSON    = DATA_PROCESSED / "wifi_fingerprint_clean.json"
    CLEAN_CSV     = DATA_PROCESSED / "wifi_fingerprint_clean.csv"
    ML_READY_CSV  = DATA_PROCESSED / "wifi_ml_ready.csv"
    ML_META_JSON  = DATA_PROCESSED / "ml_dataset_meta.json"
    MAC_LIST_JSON = DATA_PROCESSED / "mac_columns.json"
    STATS_FILE    = DATA_PROCESSED / "wifi_ml_stats.txt"

    # =========================================================================
    # FILE PATHS — Train/Test splits
    # =========================================================================
    TRAIN_X = DATA_PROCESSED / "train_X.csv"
    TEST_X  = DATA_PROCESSED / "test_X.csv"
    TRAIN_Y = DATA_PROCESSED / "train_y.csv"
    TEST_Y  = DATA_PROCESSED / "test_y.csv"

    # =========================================================================
    # FILE PATHS — Model artifacts
    # =========================================================================
    MODEL_FILE  = MODELS / "wifi_position_model.pkl"
    SCALER_FILE = MODELS / "wifi_scaler.pkl"

    # =========================================================================
    # FILE PATHS — Visualisation outputs
    # =========================================================================
    OUTPUT_MAP         = OUTPUTS / "wifi_map.html"
    OUTPUT_HEATMAP     = OUTPUTS / "wifi_heatmap.html"
    OUTPUT_SIGNAL_PLOT = OUTPUTS / "signal_strength.png"
    OUTPUT_COMPARISON  = OUTPUTS / "network_comparison.png"

    # =========================================================================
    # MAP SETTINGS
    # =========================================================================
    DEFAULT_ZOOM = 17
    MAP_TILES    = "OpenStreetMap"
    CIRCLE_MODE  = CircleMode.UNCERTAINTY

    # =========================================================================
    # RSSI / SIGNAL THRESHOLDS
    # =========================================================================
    RSSI_MIN     = -90   # discard weaker networks
    RSSI_FLOOR   = -95   # clamp extreme values
    RSSI_MISSING = -100  # sentinel for missing MACs
    RSSI_MAX     = -30   # max realistic indoor signal

    # =========================================================================
    # SIGNAL QUALITY THRESHOLDS
    # =========================================================================
    SIGNAL_EXCELLENT = -50
    SIGNAL_VERY_GOOD = -60
    SIGNAL_GOOD      = -70
    SIGNAL_FAIR      = -80
    SIGNAL_WEAK      = -90

    # =========================================================================
    # DISTANCE / PROPAGATION MODEL
    # =========================================================================
    TX_POWER           = 20
    PATH_LOSS_EXPONENT = 3

    # =========================================================================
    # CLEANING THRESHOLDS
    # =========================================================================
    MIN_MAC_SCANS     = 5
    MAX_ROUTER_DIST_M = 500
    MIN_NETS_PER_SCAN = 2

    # =========================================================================
    # HOTSPOT SSID KEYWORDS
    # =========================================================================
    HOTSPOT_KEYWORDS = [
        "android", "galaxy", "iphone", "redmi", "oppo", "infinix",
        "huawei", "xiaomi", "vivo", "realme", "oneplus", "honor",
        "motorola", "nokia", "samsung", "hotspot", "phone", "mobile",
        "4g", "lte", "partage", "shareme", "mifi",
        "\u2620", "\U0001f480", "\U0001f4a1",
    ]

    # =========================================================================
    # VISUALISATION COLOURS
    # =========================================================================
    COLOR_PALETTE = [
        "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A",
        "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E2",
        "#F8B739", "#52B788", "#E76F51", "#2A9D8F",
        "#E63946", "#F77F00", "#06FFA5", "#8338EC",
    ]

    # =========================================================================
    # ML TRAINING
    # =========================================================================
    TEST_SIZE    = 0.2
    RANDOM_STATE = 42

    # =========================================================================
    # DIRECTORY CREATION
    # =========================================================================
    @classmethod
    def ensure_dirs(cls) -> None:
        """Create all project directories if they do not already exist."""
        for d in [cls.DATA_RAW, cls.DATA_PROCESSED, cls.MODELS, cls.OUTPUTS]:
            d.mkdir(parents=True, exist_ok=True)
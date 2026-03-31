"""
scripts/prepare_ml_dataset.py
Prepare WiFi fingerprint dataset for ML training
"""

import pandas as pd
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config

# ─────────────────────────────────────────────
# SETTINGS
# ─────────────────────────────────────────────
TOP_MACS = 300          # keep only most useful routers
CREATE_TRAIN_TEST = True

# ─────────────────────────────────────────────
# PRINT HELPER
# ─────────────────────────────────────────────
def sep(msg):
    print(f"\n{'─'*60}")
    print(f"  {msg}")
    print(f"{'─'*60}")

# ─────────────────────────────────────────────
# LAT/LON → LOCAL METERS
# ─────────────────────────────────────────────
def gps_to_local_xy(df):
    lat0 = df["lat"].min()
    lon0 = df["lon"].min()
    mean_lat = df["lat"].mean()

    df["y_m"] = (df["lat"] - lat0) * 111_000
    df["x_m"] = (df["lon"] - lon0) * 111_000 * math.cos(math.radians(mean_lat))

    return df, lat0, lon0

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    Config.ensure_dirs()
    
    # Define train/test CSV paths (added if missing in config)
    Config.TRAIN_X = Config.DATA_PROCESSED / "train_X.csv"
    Config.TEST_X  = Config.DATA_PROCESSED / "test_X.csv"
    Config.TRAIN_Y = Config.DATA_PROCESSED / "train_y.csv"
    Config.TEST_Y  = Config.DATA_PROCESSED / "test_y.csv"

    sep("STEP 1 — Load cleaned CSV")
    if not Config.CLEAN_CSV.exists():
        print("❌ Clean CSV not found. Run clean_wifi_dataset.py first.")
        sys.exit(1)

    df = pd.read_csv(Config.CLEAN_CSV)
    df.columns = df.columns.str.strip()

    # enforce types
    df["rssi"] = pd.to_numeric(df["rssi"], errors="coerce")
    df["lat"]  = pd.to_numeric(df["lat"], errors="coerce")
    df["lon"]  = pd.to_numeric(df["lon"], errors="coerce")
    df["mac"] = df["mac"].str.upper().str.strip()
    df["scan_id"] = df["scan_id"].astype(int)

    print("Rows:", len(df))
    print("Scans:", df["scan_id"].nunique())
    print("MACs :", df["mac"].nunique())

    sep("STEP 2 — Aggregate duplicate MACs per scan")
    scan_meta = df.groupby("scan_id")[["lat", "lon"]].first().reset_index()
    df_agg = df.groupby(["scan_id", "mac"], as_index=False)["rssi"].mean().round(1)
    df_agg = df_agg.merge(scan_meta, on="scan_id")

    sep("STEP 3 — Keep top useful MACs")
    mac_counts = df_agg.groupby("mac")["scan_id"].nunique()
    top_macs = mac_counts.sort_values(ascending=False).head(TOP_MACS).index
    df_agg = df_agg[df_agg["mac"].isin(top_macs)]
    print("MAC features kept:", len(top_macs))

    sep("STEP 4 — Pivot dataset to wide format")
    pivot = df_agg.pivot_table(index="scan_id", columns="mac", values="rssi", aggfunc="mean")
    pivot.columns.name = None

    # Add latitude & longitude
    coords = df_agg.groupby("scan_id")[["lat", "lon"]].first()
    pivot = pivot.join(coords)

    mac_cols = [c for c in pivot.columns if c not in ["lat", "lon"]]

    # Fill missing RSSI values with sentinel
    pivot[mac_cols] = pivot[mac_cols].fillna(Config.RSSI_MISSING)

    print("Dataset shape:", pivot.shape)

    sep("STEP 5 — Add scan density feature")
    pivot["net_count"] = (pivot[mac_cols] != Config.RSSI_MISSING).sum(axis=1)

    sep("STEP 6 — Convert GPS → Local meters")
    pivot, lat0, lon0 = gps_to_local_xy(pivot)
    print("Reference GPS:", lat0, lon0)

    sep("STEP 7 — Rename columns safely")
    rename_map = {m: f"MAC_{m.replace(':','_')}" for m in mac_cols}
    pivot.rename(columns=rename_map, inplace=True)
    feature_cols = list(rename_map.values()) + ["net_count"]
    print("Total ML features:", len(feature_cols))

    sep("STEP 8 — Save ML dataset")
    pivot.to_csv(Config.ML_READY_CSV, index=False)
    with open(Config.MAC_LIST_JSON, "w") as f:
        json.dump(feature_cols, f, indent=2)
    meta = {"lat0": lat0, "lon0": lon0, "features": feature_cols}
    with open(Config.ML_META_JSON, "w") as f:
        json.dump(meta, f, indent=2)
    print("Saved:", Config.ML_READY_CSV)

    sep("STEP 9 — Train/Test split")
    if CREATE_TRAIN_TEST:
        from sklearn.model_selection import train_test_split

        X = pivot[feature_cols]
        y = pivot[["x_m", "y_m"]]

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=Config.TEST_SIZE, random_state=Config.RANDOM_STATE
        )

        # Save splits
        X_train.to_csv(Config.TRAIN_X, index=False)
        X_test.to_csv(Config.TEST_X, index=False)
        y_train.to_csv(Config.TRAIN_Y, index=False)
        y_test.to_csv(Config.TEST_Y, index=False)
        print("Train/Test saved ✔")

    sep("DONE")
    print("Next step → python -m scripts.train_model")


if __name__ == "__main__":
    main()
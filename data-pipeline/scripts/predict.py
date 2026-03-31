"""
scripts/04_predict.py
======================
STEP 4 of the WiFi Positioning Pipeline

Given a new WiFi scan (MAC -> RSSI dict), predicts the GPS position.

Usage:
    # Uses built-in example scan
    python -m scripts.04_predict

    # Pass your own scan as JSON
    python -m scripts.04_predict --scan '{"10:BE:F5:52:04:F9": -84, "84:D8:1B:19:34:20": -81}'

MAC addresses are accepted in any case (aa:bb:cc or AA:BB:CC) and with
or without colons — they are normalised automatically.

Fixes vs previous version:
  [BUG 1] load_artifacts() always loaded feature_cols from mac_columns.json,
          ignoring the fact that 03_train_model.py now saves feature_cols
          inside the model pickle. The JSON and pickle could be out of sync
          if the model was retrained. Now uses the bundle's feature_cols
          first, falls back to JSON for backwards compatibility.
  [BUG 2] scan_to_feature_vector() silently built an all-RSSI_MISSING vector
          when zero scan MACs matched training MACs — model predicts garbage
          with no warning. Now raises a clear error.
  [BUG 3] Scan display showed raw (possibly lowercase) MAC keys instead of
          the normalised uppercase form actually used for lookup — confusing.
          Now displays the normalised MACs consistently.
  [BUG 4] Config signal quality thresholds (SIGNAL_EXCELLENT etc.) were
          defined but never used in output. Now shown per network in the scan.
  [BUG 5] --scan JSON argument had no error handling — malformed JSON caused
          an ugly traceback. Now caught with a friendly error message.
  [BUG 6] Result dict only showed total visible networks, not how many were
          actually known to the model. Added matched_macs count.
"""

import json
import pickle
import argparse
import sys
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def sep(msg: str) -> None:
    print(f"\n{'─' * 55}")
    print(f"  {msg}")
    print(f"{'─' * 55}")


def signal_label(rssi: int) -> str:
    """Return a human-readable signal quality label for an RSSI value."""
    if rssi >= Config.SIGNAL_EXCELLENT:  return "Excellent"
    if rssi >= Config.SIGNAL_VERY_GOOD:  return "Very Good"
    if rssi >= Config.SIGNAL_GOOD:       return "Good"
    if rssi >= Config.SIGNAL_FAIR:       return "Fair"
    if rssi >= Config.SIGNAL_WEAK:       return "Weak"
    return "Very Weak"


def normalise_scan(scan: dict) -> dict:
    """
    Normalise all MAC addresses in a scan to uppercase with colons.
    Also converts RSSI values to rounded integers.
    e.g. {"a8:31:62:1d:ae:f3": -72.5}  ->  {"A8:31:62:1D:AE:F3": -73}
    """
    return {
        mac.strip().upper(): round(float(rssi))
        for mac, rssi in scan.items()
    }


def col_to_mac(col: str) -> str:
    """
    Convert a feature column name back to a MAC address string.
    "MAC_AA_BB_CC_DD_EE_FF"  ->  "AA:BB:CC:DD:EE:FF"
    """
    return ":".join(col[4:].split("_"))   # strip "MAC_" prefix, split 6 octets


def load_artifacts() -> tuple:
    """
    Load model bundle, scaler, and feature column list.

    BUG 1 FIX: feature_cols is now read from inside the model bundle
    (saved there by 03_train_model.py) to guarantee it matches the model.
    Falls back to mac_columns.json for models saved by older versions.
    """
    if not Config.MODEL_FILE.exists():
        print(f"  ERROR: model not found at {Config.MODEL_FILE}")
        print("  Run:  python -m scripts.03_train_model  first.")
        sys.exit(1)

    if not Config.SCALER_FILE.exists():
        print(f"  ERROR: scaler not found at {Config.SCALER_FILE}")
        print("  Run:  python -m scripts.03_train_model  first.")
        sys.exit(1)

    with open(Config.MODEL_FILE, "rb") as f:
        bundle = pickle.load(f)

    with open(Config.SCALER_FILE, "rb") as f:
        scaler = pickle.load(f)

    # BUG 1 FIX: prefer feature_cols from bundle, fallback to JSON
    if "feature_cols" in bundle:
        feature_cols = bundle["feature_cols"]
    else:
        if not Config.MAC_LIST_JSON.exists():
            print(f"  ERROR: {Config.MAC_LIST_JSON} not found.")
            sys.exit(1)
        with open(Config.MAC_LIST_JSON) as f:
            feature_cols = json.load(f)

    return bundle["model"], bundle["name"], scaler, feature_cols


def scan_to_feature_vector(normalised_scan: dict,
                           feature_cols: list) -> tuple[np.ndarray, int]:
    """
    Convert a normalised scan dict {MAC: rssi} to a fixed-length feature
    vector aligned with the training columns.

    Returns:
        (feature_vector shape (1, n_features),  matched_mac_count)

    BUG 2 FIX: raises ValueError if no scan MACs match the training set,
               instead of silently returning an all-RSSI_MISSING vector.
    """
    row          = {}
    matched_macs = 0

    for col in feature_cols:
        mac = col_to_mac(col)
        if mac in normalised_scan:
            row[col] = normalised_scan[mac]
            matched_macs += 1
        else:
            row[col] = Config.RSSI_MISSING

    # BUG 2 FIX: warn/abort if no overlap with training MACs
    if matched_macs == 0:
        raise ValueError(
            "None of the scan's MAC addresses were seen during training.\n"
            "The model cannot make a meaningful prediction.\n"
            "Make sure you are scanning the same area as the training data."
        )

    return np.array([[row[c] for c in feature_cols]], dtype=np.float32), matched_macs


def predict_position(scan: dict) -> dict:
    """
    Predict GPS position from a raw WiFi scan dict {MAC: rssi}.
    Returns a result dict with lat, lon, model info, and a Google Maps link.
    """
    model, model_name, scaler, feature_cols = load_artifacts()

    # BUG 3 FIX: normalise first, then display — consistent uppercase output
    normalised = normalise_scan(scan)

    # ── Display scan ──────────────────────────────────────────────────────────
    sep("Input WiFi Scan")
    visible = {mac: rssi for mac, rssi in normalised.items()
               if rssi > Config.RSSI_MISSING}

    print(f"  Networks detected : {len(visible)}")
    print(f"  {'MAC':<20}  {'RSSI':>6}  Quality")
    print(f"  {'─'*20}  {'─'*6}  {'─'*12}")
    for mac, rssi in sorted(visible.items(), key=lambda x: -x[1]):
        # BUG 4 FIX: show signal quality label using Config thresholds
        print(f"  {mac:<20}  {rssi:>5} dBm  {signal_label(rssi)}")

    # ── Build feature vector ──────────────────────────────────────────────────
    try:
        X, matched = scan_to_feature_vector(normalised, feature_cols)
    except ValueError as e:
        print(f"\n  ⚠️  {e}")
        sys.exit(1)

    print(f"\n  MACs matched to training set : {matched} / {len(visible)}")
    if matched < 2:
        print("  ⚠️  WARNING: fewer than 2 known MACs — prediction may be inaccurate.")

    # ── Predict ───────────────────────────────────────────────────────────────
    X_scaled = scaler.transform(X)
    pred     = model.predict(X_scaled)[0]
    lat      = round(float(pred[0]), 6)
    lon      = round(float(pred[1]), 6)

    # ── Display result ────────────────────────────────────────────────────────
    sep("Predicted Position")
    print(f"  Latitude   : {lat}")
    print(f"  Longitude  : {lon}")
    print(f"  Model used : {model_name}")
    print(f"  Map link   : https://www.google.com/maps?q={lat},{lon}")

    result = {
        "lat":          lat,
        "lon":          lon,
        "model_used":   model_name,
        "networks_seen": len(visible),
        "matched_macs": matched,           # BUG 6 FIX: was missing
        "google_maps":  f"https://www.google.com/maps?q={lat},{lon}",
    }
    return result


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Predict GPS position from a WiFi scan.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--scan", type=str, default=None,
        help=(
            'JSON dict mapping MAC addresses to RSSI values.\n'
            'Example: \'{"10:BE:F5:52:04:F9": -84, "84:D8:1B:19:34:20": -77}\''
        ),
    )
    args = parser.parse_args()

    if args.scan:
        # BUG 5 FIX: catch malformed JSON with a friendly error
        try:
            scan_input = json.loads(args.scan)
        except json.JSONDecodeError as e:
            print(f"  ERROR: invalid JSON in --scan argument.\n  {e}")
            sys.exit(1)
    else:
        # Default example using MACs from your Mahdia dataset
        print("  No --scan provided — using example scan from Mahdia dataset.")
        scan_input = {
            "10:BE:F5:52:04:F9": -84,   # dlink-04F9
            "84:D8:1B:19:34:20": -81,   # TOPNET_3420
            "98:A9:42:43:FE:1D": -88,   # ooredoo-43FE1C
            "E0:1C:FC:FB:CC:16": -84,   # DIR-612-CC15
        }

    predict_position(scan_input)


if __name__ == "__main__":
    main()
from config import Config
from scripts.data_processing import load_wifi_data
from scripts.visualization import (
    create_full_map,
    create_maps_per_network,
    create_rssi_bubble_map,
    list_available_macs
)
from scripts.report import print_statistics
import os


def prepare_environment():
    """Create necessary folders"""
    os.makedirs(Config.DATA_RAW, exist_ok=True)
    os.makedirs(Config.DATA_PROCESSED, exist_ok=True)
    os.makedirs(Config.OUTPUTS, exist_ok=True)


def main():
    print("===================================")
    print(" NoGPS WiFi Geolocation System")
    print(" Location:", Config.LOCATION)
    print("===================================\n")

    prepare_environment()

    data = load_wifi_data(Config.CLEAN_JSON)
    if not data:
        print("⚠️  No data found.")
        print(f"   Expected file → {Config.CLEAN_JSON}")
        print("   Run cleaning first → python -m scripts.clean_wifi_dataset")
        return

    print_statistics(data)
    list_available_macs(data)

    # MAP 1 — Density map
    print("\n🗺️  Building density map...")
    density_map = os.path.join(Config.OUTPUTS, "wifi_map.html")
    create_full_map(data, output_file=density_map)
    print("✅ Density map     →", density_map)

    # MAP 2 — Checklist heatmap map
    print("\n🗺️  Building checklist map...")
    checklist_map = os.path.join(Config.OUTPUTS, "wifi_checklist_map.html")
    create_maps_per_network(data, output_file=checklist_map)
    print("✅ Checklist map   →", checklist_map)

    # MAP 3 — RSSI bubble map
    print("\n🗺️  Building RSSI bubble map...")
    bubble_map = os.path.join(Config.OUTPUTS, "wifi_rssi_map.html")
    create_rssi_bubble_map(data, output_file=bubble_map)
    print("✅ RSSI bubble map →", bubble_map)

    print("\n🎉 All done! Open the maps in your browser.")


if __name__ == "__main__":
    main()
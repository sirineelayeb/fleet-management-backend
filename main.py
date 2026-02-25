from config import Config, CircleMode
from scripts.data_processing import load_wifi_data
from scripts.visualization import create_interactive_map, create_heatmap
from scripts.report import print_statistics
import os


def prepare_environment():
    """Create necessary folders"""
    os.makedirs(Config.DATA_RAW, exist_ok=True)
    os.makedirs(Config.DATA_PROCESSED, exist_ok=True)
    os.makedirs(Config.OUTPUTS, exist_ok=True)


def main():
    print("===================================")
    print(" NoGPS WiFi Geolocation System ")
    print(" Location:", Config.LOCATION)
    print("===================================\n")

    prepare_environment()

    # Load dataset
    data = load_wifi_data(Config.INPUT_FILE)

    if not data:
        print("⚠️ No data found. Please add wifi dataset first.")
        return

    print_statistics(data)

    # Visualization mode
    circle_mode = CircleMode.STRENGTH
    print("📡 Using Strength Mode (big circle = weak signal)\n")

    create_interactive_map(data, circle_mode=circle_mode)
    create_heatmap(data)
    # create_network_comparison(data)
    # create_signal_strength_plot(data)
    print("\n✅ All visualizations generated in:", Config.OUTPUTS)


if __name__ == "__main__":
    main()
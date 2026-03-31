import numpy as np
import math
from config import Config

def rssi_to_distance(rssi, tx_power=Config.TX_POWER, n=Config.PATH_LOSS_EXPONENT):
    """Log-distance path loss model in meters"""
    return 10 ** ((tx_power - rssi) / (10 * n))

def rssi_to_radius(rssi, mode='uncertainty'):
    """
    Calculate circle radius based on RSSI.
    - 'uncertainty': weak signals = larger circles
    - 'strength': strong signals = larger circles
    """
    if mode == 'strength':
        # Strong signal = bigger circle
        normalized = (rssi + 95) / 55  # scale -95 to -40 → 0 to 1
        return 10 + (normalized * 40)    # 10m to 50m
    else:  # uncertainty mode
        normalized = (-rssi - 40) / 55  # weak signal → larger circle
        return 15 + (normalized * 60)   # 15m to 75m

def get_signal_quality(rssi):
    """Return quality text, emoji, and color"""
    if rssi >= Config.SIGNAL_EXCELLENT: return "Excellent", "🟢", "#00C853"
    if rssi >= Config.SIGNAL_VERY_GOOD: return "Very Good", "🟡", "#64DD17"
    if rssi >= Config.SIGNAL_GOOD: return "Good", "🟠", "#FFD600"
    if rssi >= Config.SIGNAL_FAIR: return "Fair", "🟠", "#FF6D00"
    if rssi >= Config.SIGNAL_WEAK: return "Weak", "🔴", "#DD2C00"
    return "Very Weak", "⚫", "#212121"

def calculate_gps_distance(lat1, lon1, lat2, lon2):
    """Haversine formula in meters"""
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def generate_network_colors(network_positions):
    """Assign unique colors to each network"""
    colors = {}
    for i, mac in enumerate(network_positions.keys()):
        colors[mac] = Config.COLOR_PALETTE[i % len(Config.COLOR_PALETTE)]
    return colors
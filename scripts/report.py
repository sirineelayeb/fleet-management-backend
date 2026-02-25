# report.py
from scripts.data_processing import process_data
from scripts.analysis import get_signal_quality, rssi_to_distance, calculate_gps_distance

def print_statistics(data):
    gps_points, network_detections, network_positions = process_data(data)
    print("\n=== WiFi Fingerprinting Statistics ===")
    print(f"Total scans: {len(data)}")
    print(f"Unique positions: {len(set((p['lat'],p['lon']) for p in gps_points))}")

    total_distance = sum(calculate_gps_distance(
        gps_points[i]['lat'], gps_points[i]['lon'],
        gps_points[i+1]['lat'], gps_points[i+1]['lon']
    ) for i in range(len(gps_points)-1)) if len(gps_points)>1 else 0
    print(f"Total distance: {total_distance:.1f} m")

    print(f"Unique networks: {len(network_positions)}")
    print(f"Total detections: {sum(len(d) for d in network_detections.values())}")
    print(f"Avg detections per network: {sum(len(d) for d in network_detections.values())/len(network_positions):.1f}")

    print("\nTop networks:")
    print(f"{'SSID':<20} {'Quality':<10} {'Count':<6} {'Avg RSSI':<8} {'Dist(m)':<7}")
    for _, info in sorted(network_positions.items(), key=lambda x:x[1]['detection_count'], reverse=True)[:10]:
        qtext, qemoji, _ = get_signal_quality(info['avg_rssi'])
        dist = rssi_to_distance(info['avg_rssi'])
        print(f"{info['ssid'][:20]:<20} {qemoji} {qtext:<10} {info['detection_count']:<6} {info['avg_rssi']:<8.1f} {dist:<7.0f}")

# visualization.py
import folium
from folium import plugins
import matplotlib.pyplot as plt
import numpy as np
from scripts.analysis import rssi_to_distance, rssi_to_radius, get_signal_quality, generate_network_colors
from scripts.data_processing import process_data
from config import Config, CircleMode

def create_interactive_map(data, output_file=Config.OUTPUT_MAP, circle_mode=CircleMode.UNCERTAINTY):
    gps_points, network_detections, network_positions = process_data(data)
    colors = generate_network_colors(network_positions)

    # Compute map center
    center_lat = np.mean([p['lat'] for p in gps_points])
    center_lon = np.mean([p['lon'] for p in gps_points])

    # Initialize map
    m = folium.Map(location=[center_lat, center_lon], zoom_start=Config.DEFAULT_ZOOM, tiles=Config.MAP_TILES)
    
    # Optional alternative tiles
    folium.TileLayer('CartoDB positron', name='Light Map').add_to(m)
    folium.TileLayer('CartoDB dark_matter', name='Dark Map').add_to(m)
    folium.TileLayer(
        tiles='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attr='Esri', name='Satellite', overlay=False, control=True
    ).add_to(m)
    
    # Draw GPS track
    track_coords = [[p['lat'], p['lon']] for p in gps_points]
    if len(track_coords) > 1:
        folium.PolyLine(track_coords, color='#0066FF', weight=4, opacity=0.8, popup="GPS Track").add_to(m)
    
    # Add WiFi networks
    for mac, info in network_positions.items():
        color = colors[mac]
        radius = rssi_to_radius(info['avg_rssi'], mode=circle_mode.value)
        quality_text, quality_emoji, _ = get_signal_quality(info['avg_rssi'])
        est_distance = rssi_to_distance(info['avg_rssi'])
        
        # **Translucent coverage circle (visual only, no popup)**
        folium.Circle(
            location=[info['lat'], info['lon']],
            radius=radius,
            color=color,
            fill=True,
            fillColor=color,
            fillOpacity=0.15
        ).add_to(m)
        
        # **Small clickable marker with popup**
        popup_html = f"""
        <b>{info['ssid']}</b><br>
        MAC: {mac}<br>
        RSSI: {info['avg_rssi']:.1f} dBm<br>
        Quality: {quality_text} {quality_emoji}<br>
        Est. Distance: {est_distance:.1f} m
        """
        folium.CircleMarker(
            location=[info['lat'], info['lon']],
            radius=6,
            color=color,
            fill=True,
            fillColor=color,
            fillOpacity=1.0,
            popup=folium.Popup(popup_html, max_width=300)
        ).add_to(m)
    
    # Map controls
    folium.LayerControl().add_to(m)
    plugins.MiniMap(toggle_display=True).add_to(m)
    plugins.Fullscreen().add_to(m)
    
    # Save map
    m.save(output_file)
    print(f"✅ Interactive map saved: {output_file}")

def create_heatmap(data, output_file=Config.OUTPUT_HEATMAP):
    """Heatmap weighted by RSSI, showing strong and weak signal areas."""
    gps_points, network_detections, _ = process_data(data)
    
    # Handle edge case: no data
    if not gps_points:
        print("⚠️  No GPS points found. Cannot create heatmap.")
        return
    
    center_lat = np.mean([p['lat'] for p in gps_points])
    center_lon = np.mean([p['lon'] for p in gps_points])
    
    # Create map with multiple tile options
    m = folium.Map(
        location=[center_lat, center_lon], 
        zoom_start=Config.DEFAULT_ZOOM, 
        tiles='CartoDB positron'
    )
    
    # Add satellite view option (useful for truck routes)
    folium.TileLayer(
        tiles='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attr='Esri',
        name='Satellite',
        overlay=False,
        control=True
    ).add_to(m)
    
    # Build heatmap data
    heat_data = []
    rssi_values = []  # For statistics
    
    for detections in network_detections.values():
        for d in detections:
            # Stronger RSSI = higher heat
            weight = np.clip((d['rssi'] - Config.RSSI_MIN) / (Config.RSSI_MAX - Config.RSSI_MIN), 0, 1)
            heat_data.append([d['lat'], d['lon'], weight])
            rssi_values.append(d['rssi'])
    
    # Handle edge case: no detections
    if not heat_data:
        print("⚠️  No network detections found. Cannot create heatmap.")
        return
    
    # Add GPS track overlay (helps visualize your route)
    track_coords = [[p['lat'], p['lon']] for p in gps_points]
    if len(track_coords) > 1:
        folium.PolyLine(
            track_coords,
            color='white',
            weight=2,
            opacity=0.6,
            popup="Collection Route"
        ).add_to(m)
    
    # Create heatmap layer
    heat_layer = plugins.HeatMap(
        heat_data,
        radius=25,          # Good balance for street-level detail
        blur=35,            # Smooth but not too blurry
        max_zoom=18,
        min_opacity=0.3,    # Make weak signals visible
        gradient={
            0.0: 'blue',    # Very weak: -95 to -85 dBm
            0.2: 'cyan',    # Weak: -85 to -80 dBm
            0.4: 'lime',    # Fair: -80 to -75 dBm
            0.6: 'yellow',  # Good: -75 to -70 dBm
            0.8: 'orange',  # Very good: -70 to -60 dBm
            1.0: 'red'      # Excellent: -60 to -40 dBm
        }
    )
    heat_layer.add_to(m)
    
    # Add legend with statistics
    avg_rssi = np.mean(rssi_values) if rssi_values else 0
    min_rssi = np.min(rssi_values) if rssi_values else 0
    max_rssi = np.max(rssi_values) if rssi_values else 0
    
    legend_html = f'''
    <div style="position: fixed; 
                bottom: 50px; right: 50px; 
                background-color: white; 
                border: 2px solid grey; 
                border-radius: 5px;
                padding: 10px;
                font-size: 12px;
                z-index: 9999;">
        <h4 style="margin: 0 0 10px 0;">WiFi Signal Heatmap</h4>
        <p style="margin: 5px 0;">🔴 Red: Excellent (-40 to -60 dBm)</p>
        <p style="margin: 5px 0;">🟠 Orange: Very Good (-60 to -70 dBm)</p>
        <p style="margin: 5px 0;">🟡 Yellow: Good (-70 to -75 dBm)</p>
        <p style="margin: 5px 0;">🟢 Green: Fair (-75 to -80 dBm)</p>
        <p style="margin: 5px 0;">🔵 Cyan: Weak (-80 to -85 dBm)</p>
        <p style="margin: 5px 0;">⚫ Blue: Very Weak (-85 to -95 dBm)</p>
        <hr style="margin: 10px 0;">
        <p style="margin: 5px 0;"><b>Statistics:</b></p>
        <p style="margin: 5px 0;">Total points: {len(heat_data)}</p>
        <p style="margin: 5px 0;">Avg RSSI: {avg_rssi:.1f} dBm</p>
        <p style="margin: 5px 0;">Range: {min_rssi:.0f} to {max_rssi:.0f} dBm</p>
    </div>
    '''
    m.get_root().html.add_child(folium.Element(legend_html))
    
    # Add layer control
    folium.LayerControl().add_to(m)
    
    # Add fullscreen option
    plugins.Fullscreen().add_to(m)
    
    # Save map
    m.save(output_file)
    print(f"✅ Heatmap saved: {output_file}")
    print(f"   - Data points: {len(heat_data)}")
    print(f"   - Avg signal: {avg_rssi:.1f} dBm")
    print(f"   - Coverage: {min_rssi:.0f} to {max_rssi:.0f} dBm")
    
# def create_signal_strength_plot(data, output_file=Config.OUTPUT_SIGNAL_PLOT):
#     """Plot RSSI over time for all networks."""
#     _, network_detections, network_positions = process_data(data)
#     colors = generate_network_colors(network_positions)

#     fig, ax = plt.subplots(figsize=(16, 7))
#     ax.set_xlabel("Scan #", fontsize=12)
#     ax.set_ylabel("RSSI (dBm)", fontsize=12)
#     ax.set_title("WiFi Signal Strength Over Time", fontsize=14)

#     # Plot each network
#     for mac, dets in network_detections.items():
#         if len(dets) < 2:
#             continue
#         ssid = network_positions[mac]['ssid']
#         rssi_vals = [d['rssi'] for d in dets]
#         ax.plot(range(len(rssi_vals)), rssi_vals, marker='o', label=ssid, color=colors[mac], linewidth=2)

#     ax.grid(True, linestyle='--', alpha=0.3)
#     ax.set_ylim(-95, -40)
#     ax.legend(fontsize=10)
#     plt.tight_layout()
#     plt.savefig(output_file, dpi=300)
#     plt.close()
#     print(f"✅ Signal plot saved: {output_file}")


# def create_network_comparison(data, output_file=Config.OUTPUT_COMPARISON):
#     """Comparison of detection count, average RSSI, and estimated distance."""
#     _, _, network_positions = process_data(data)
#     sorted_networks = sorted(network_positions.items(), key=lambda x: x[1]['detection_count'], reverse=True)

#     ssids = [info['ssid'][:20] for _, info in sorted_networks]
#     counts = [info['detection_count'] for _, info in sorted_networks]
#     avg_rssi = [info['avg_rssi'] for _, info in sorted_networks]
#     distances = [rssi_to_distance(info['avg_rssi']) for _, info in sorted_networks]

#     fig, axes = plt.subplots(1, 3, figsize=(18, 6))
#     colors_list = plt.cm.Set3(np.linspace(0, 1, len(ssids)))

#     axes[0].barh(ssids, counts, color=colors_list)
#     axes[0].set_title("Detection Count")
#     axes[1].barh(ssids, avg_rssi, color=colors_list)
#     axes[1].set_title("Average RSSI (dBm)")
#     axes[2].barh(ssids, distances, color=colors_list)
#     axes[2].set_title("Estimated Distance (m)")

#     plt.tight_layout()
#     plt.savefig(output_file, dpi=300)
#     plt.close()
#     print(f"✅ Comparison chart saved: {output_file}")

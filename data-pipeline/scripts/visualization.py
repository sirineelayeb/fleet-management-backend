import folium
from folium import plugins
import numpy as np
import os
import json
from scripts.data_processing import process_data
from config import Config

# ─────────────────────────────────────────────
# CONSTANTS — heatmap color gradient & options
# blue = weak signal, red = strong signal
# ─────────────────────────────────────────────
GRADIENT = {0.0:'blue', 0.4:'cyan', 0.6:'lime', 0.8:'yellow', 0.9:'orange', 1.0:'red'}
HEAT_OPTS = dict(radius=40, blur=25, min_opacity=0.3, max_val=1.0, gradient=GRADIENT)


# ─────────────────────────────────────────────
# HELPERS — small reusable functions
# ─────────────────────────────────────────────

def _base_map(lats, lons):
    """Create a blank Leaflet map centered on the average of all coordinates."""
    return folium.Map(
        location=[np.mean(lats), np.mean(lons)],
        zoom_start=Config.DEFAULT_ZOOM,
        tiles='CartoDB positron'
    )

def _heat_data(detections):
    """
    Convert detections to heatmap format: [[lat, lon, weight], ...]
    Weight is normalized 0->1 based on RSSI:
      - 1.0 = strongest signal (closest to router)
      - 0.0 = weakest signal (farthest from router)
    """
    rssi_values = [d['rssi'] for d in detections]
    lo, hi = min(rssi_values), max(rssi_values)
    rng = hi - lo or 1  # avoid division by zero
    return [
        [d['lat'], d['lon'], float(np.clip((d['rssi'] - lo) / rng, 0, 1))]
        for d in detections
    ]

def _signal(rssi):
    """Return a colored emoji based on signal strength."""
    return "🟢" if rssi >= -60 else "🟡" if rssi >= -75 else "🔴"

def _all_coords(network_detections):
    """Collect all lat/lon values across all networks into two flat lists."""
    lats = [d['lat'] for dets in network_detections.values() for d in dets]
    lons = [d['lon'] for dets in network_detections.values() for d in dets]
    return lats, lons

def _add_extras(m):
    """Add fullscreen button and minimap to any map."""
    plugins.Fullscreen().add_to(m)
    plugins.MiniMap(toggle_display=True).add_to(m)


# ─────────────────────────────────────────────
# MAP 1 — Density map
# Shows how many networks were detected at each GPS position
# ─────────────────────────────────────────────

def create_full_map(data, output_file="wifi_map.html"):
    _, network_detections, _ = process_data(data)
    if not network_detections:
        print("No detections found."); return

    lats, lons = _all_coords(network_detections)
    m = _base_map(lats, lons)
    fg = folium.FeatureGroup(name="WiFi Density", show=True)

    # Count how many unique MACs were seen at each GPS position
    counts = {}
    for mac, dets in network_detections.items():
        for d in dets:
            key = (round(d['lat'], 6), round(d['lon'], 6))
            counts.setdefault(key, set()).add(mac)

    # Draw a circle at each position, sized and colored by network count
    for (lat, lon), macs in counts.items():
        n = len(macs)
        color = "red" if n >= 10 else "orange" if n >= 5 else "green" if n >= 3 else "blue"
        folium.CircleMarker(
            [lat, lon], radius=5 + n,
            color=color, fill=True, fill_color=color, fill_opacity=0.7,
            popup=f"{n} WiFi networks here"
        ).add_to(fg)

    fg.add_to(m)
    folium.LayerControl(collapsed=False).add_to(m)
    _add_extras(m)
    m.save(output_file)
    print(f"Density map saved -> {output_file}")


# ─────────────────────────────────────────────
# MAP 2 — Checklist heatmap map
# One map with a checkbox panel on the left.
# Check a network -> its heatmap appears on the map.
# The heatmap data is stored as JSON inside the HTML
# and rendered by Leaflet.heat in the browser —
# this avoids Folium layer bugs with show=False.
# ─────────────────────────────────────────────

def create_maps_per_network(data, output_file="wifi_checklist_map.html"):
    _, network_detections, network_positions = process_data(data)
    if not network_detections:
        print("No detections found."); return

    out_dir = os.path.dirname(output_file)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    lats, lons = _all_coords(network_detections)
    m = _base_map(lats, lons)
    _add_extras(m)

    # Build two dicts:
    #   networks_js -> data embedded in HTML for JS to use
    #   meta        -> info used to build the checkbox rows
    networks_js, meta = {}, {}
    for mac, dets in network_detections.items():
        if not dets:
            continue
        info = network_positions.get(mac, {})
        ssid = info.get('ssid', 'Unknown')
        rssi = info.get('avg_rssi', 0)
        lid  = f"net_{mac.replace(':', '_')}"  # safe JS variable name

        networks_js[lid] = {
            'points': _heat_data(dets),
            'marker': {
                'lat': info['lat'], 'lon': info['lon'],
                'popup': f"<b>{ssid}</b><br>{mac}<br>{rssi:.1f} dBm"
            } if mac in network_positions else None
        }
        meta[mac] = dict(ssid=ssid, lid=lid, rssi=rssi,
                         count=len(dets), signal=_signal(rssi))

    # Build the HTML checkbox rows (one per network, sorted by SSID)
    rows = "".join(
        f'<label class="ci">'
        f'<input type="checkbox" value="{v["lid"]}" onchange="toggle(this)">'
        f'{v["signal"]} <b>{v["ssid"]}</b> <small>{mac}</small>'
        f'</label>\n'
        for mac, v in sorted(meta.items(), key=lambda x: x[1]['ssid'].lower())
    )

    # The full panel HTML + JS injected into the map
    panel = f"""
    <script src="https://leaflet.github.io/Leaflet.heat/dist/leaflet-heat.js"></script>
    <style>
      #wp{{position:fixed;top:10px;left:10px;z-index:9999;background:white;
           padding:10px 14px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);
           font-family:Arial,sans-serif;font-size:13px;max-width:300px}}
      #wp b{{display:block;margin-bottom:6px;color:#333}}
      #sb{{width:100%;box-sizing:border-box;padding:5px 8px;margin-bottom:6px;
           border:1px solid #ccc;border-radius:5px;font-size:12px}}
      #cs{{max-height:200px;overflow-y:auto;margin-bottom:6px}}
      .ci{{display:block;padding:3px 0;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
      .ci:hover{{background:#f5f5f5}}
      small{{color:#999}}
      .btn{{flex:1;padding:4px;font-size:12px;cursor:pointer;border:1px solid #ccc;border-radius:4px;background:#f5f5f5}}
      .btn:hover{{background:#e0e0e0}}
    </style>

    <div id="wp">
      <b>📡 WiFi Networks ({len(meta)})</b>
      <input id="sb" type="text" placeholder="Search SSID or MAC..." oninput="filterList(this.value)">
      <div id="cs">{rows}</div>
      <div style="display:flex;gap:6px">
        <button class="btn" onclick="selAll()">✅ Select All</button>
        <button class="btn" onclick="selNone()">✖ Clear All</button>
      </div>
    </div>

    <script>
    var DATA = {json.dumps(networks_js)};  // all heatmap data from Python
    var layers = {{}};                      // stores built Leaflet layers by lid

    // Find the Leaflet map object in the page
    function getMap() {{
        for (var k in window) {{
            try {{ if (window[k] && window[k]._container && window[k].eachLayer)
                return window[k]; }} catch(e) {{}}
        }}
    }}

    // Called when a checkbox is ticked or unticked
    function toggle(cb) {{
        var m = getMap(), lid = cb.value;
        if (!m) return;
        if (cb.checked) {{
            // Build the layer the first time it is checked
            if (!layers[lid]) {{
                var d = DATA[lid];
                layers[lid] = {{
                    heat: L.heatLayer(d.points, {{
                        radius:40, blur:25, minOpacity:0.3,
                        gradient: {{0.0:'blue',0.4:'cyan',0.6:'lime',0.8:'yellow',0.9:'orange',1.0:'red'}}
                    }}),
                    marker: d.marker
                        ? L.marker([d.marker.lat, d.marker.lon]).bindPopup(d.marker.popup)
                        : null
                }};
            }}
            layers[lid].heat.addTo(m);
            if (layers[lid].marker) layers[lid].marker.addTo(m);
        }} else if (layers[lid]) {{
            m.removeLayer(layers[lid].heat);
            if (layers[lid].marker) m.removeLayer(layers[lid].marker);
        }}
    }}

    function selAll() {{
        document.querySelectorAll('#cs .ci').forEach(function(row) {{
            if (row.style.display === 'none') return;
            var cb = row.querySelector('input');
            if (!cb.checked) {{ cb.checked = true; toggle(cb); }}
        }});
    }}

    function selNone() {{
        document.querySelectorAll('#cs input:checked').forEach(function(cb) {{
            cb.checked = false; toggle(cb);
        }});
    }}

    function filterList(q) {{
        q = q.toLowerCase();
        document.querySelectorAll('#cs .ci').forEach(function(row) {{
            row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        }});
    }}
    </script>
    """

    m.get_root().html.add_child(folium.Element(panel))
    m.save(output_file)
    print(f"Checklist map saved -> {output_file}  ({len(meta)} networks)")


# ─────────────────────────────────────────────
# ALIASES & UTILITIES
# ─────────────────────────────────────────────

def create_wifi_count_map(data, output_file="wifi_count_map.html"):
    create_full_map(data, output_file=output_file)

def create_network_selector_map(data, output_file="wifi_selector_map.html"):
    create_maps_per_network(data, output_file=output_file)

def create_single_network_heatmap(data, target_mac, output_dir="wifi_maps"):
    """Generate a standalone heatmap for one specific MAC address."""
    _, network_detections, network_positions = process_data(data)
    if target_mac not in network_detections:
        print(f"MAC '{target_mac}' not found.")
        list_available_macs(data); return

    dets = network_detections[target_mac]
    if not dets:
        print("No detections for this MAC."); return

    os.makedirs(output_dir, exist_ok=True)
    info = network_positions.get(target_mac, {})
    ssid = info.get('ssid', 'Unknown')
    rssi = info.get('avg_rssi', 0)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in f"{ssid}_{target_mac}")

    m = _base_map([d['lat'] for d in dets], [d['lon'] for d in dets])
    plugins.HeatMap(_heat_data(dets), **HEAT_OPTS).add_to(m)
    if target_mac in network_positions:
        folium.Marker(
            [info['lat'], info['lon']],
            popup=folium.Popup(f"<b>{ssid}</b><br>{target_mac}<br>{rssi:.1f} dBm", max_width=250),
            icon=folium.Icon(color="red", icon="wifi", prefix="fa")
        ).add_to(m)
    _add_extras(m)
    m.save(os.path.join(output_dir, f"{safe}.html"))
    print(f"Heatmap saved -> {output_dir}/{safe}.html  (SSID: {ssid}, detections: {len(dets)})")

def create_rssi_bubble_map(data, output_file="wifi_rssi_map.html"):
    """
    RSSI Bubble map — one circle per detection point, per network.
    - Big circle   = weak signal  (RSSI close to -100 dBm, far from router)
    - Small circle = strong signal (RSSI close to 0 dBm, close to router)
    - Color:  red=weak  orange=medium  green=strong
    Click any circle to see the exact RSSI in dBm.
    Uses a checkbox panel (same as the checklist map) to show/hide networks.
    """
    _, network_detections, network_positions = process_data(data)
    if not network_detections:
        print("No detections found."); return

    out_dir = os.path.dirname(output_file)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    lats, lons = _all_coords(network_detections)
    m = _base_map(lats, lons)
    _add_extras(m)

    # Build JSON data and meta for each network
    networks_js, meta = {}, {}
    for mac, dets in network_detections.items():
        if not dets:
            continue
        info = network_positions.get(mac, {})
        ssid = info.get('ssid', 'Unknown')
        rssi = info.get('avg_rssi', 0)
        lid  = f"net_{mac.replace(':', '_')}"

        # For each detection point store lat, lon, rssi (raw dBm, not normalized)
        # The JS will convert rssi -> radius and color
        networks_js[lid] = {
            'points': [[d['lat'], d['lon'], d['rssi']] for d in dets],
            'ssid': ssid, 'mac': mac
        }
        meta[mac] = dict(ssid=ssid, lid=lid, rssi=rssi,
                         count=len(dets), signal=_signal(rssi))

    # Checkbox rows
    rows = "".join(
        f'<label class="ci">'
        f'<input type="checkbox" value="{v["lid"]}" onchange="toggle(this)">'
        f'{v["signal"]} <b>{v["ssid"]}</b> <small>{mac}</small>'
        f'</label>\n'
        for mac, v in sorted(meta.items(), key=lambda x: x[1]['ssid'].lower())
    )

    panel = f"""
    <style>
      #wp{{position:fixed;top:10px;left:10px;z-index:9999;background:white;
           padding:10px 14px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);
           font-family:Arial,sans-serif;font-size:13px;max-width:300px}}
      #wp b{{display:block;margin-bottom:6px;color:#333}}
      #sb{{width:100%;box-sizing:border-box;padding:5px 8px;margin-bottom:6px;
           border:1px solid #ccc;border-radius:5px;font-size:12px}}
      #cs{{max-height:200px;overflow-y:auto;margin-bottom:6px}}
      .ci{{display:block;padding:3px 0;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
      .ci:hover{{background:#f5f5f5}}
      small{{color:#999}}
      .btn{{flex:1;padding:4px;font-size:12px;cursor:pointer;border:1px solid #ccc;border-radius:4px;background:#f5f5f5}}
      .btn:hover{{background:#e0e0e0}}
      #legend{{margin-top:8px;border-top:1px solid #eee;padding-top:6px;font-size:11px;color:#555}}
      .leg-row{{display:flex;align-items:center;gap:6px;margin:2px 0}}
      .leg-dot{{border-radius:50%;display:inline-block;border:1px solid rgba(0,0,0,0.2)}}
    </style>

    <div id="wp">
      <b>📶 RSSI Bubble Map ({len(meta)} networks)</b>
      <input id="sb" type="text" placeholder="Search SSID or MAC..." oninput="filterList(this.value)">
      <div id="cs">{rows}</div>
      <div style="display:flex;gap:6px">
        <button class="btn" onclick="selAll()">✅ Select All</button>
        <button class="btn" onclick="selNone()">✖ Clear All</button>
      </div>
      <div id="legend">
        <b>Signal strength:</b>
        <div class="leg-row"><span class="leg-dot" style="width:20px;height:20px;background:green"></span> Strong (&gt; -60 dBm)</div>
        <div class="leg-row"><span class="leg-dot" style="width:14px;height:14px;background:orange"></span> Medium (-60 to -75 dBm)</div>
        <div class="leg-row"><span class="leg-dot" style="width:8px;height:8px;background:red"></span> Weak (&lt; -75 dBm) — bigger circle</div>
      </div>
    </div>

    <script>
    var DATA = {json.dumps(networks_js)};
    var layers = {{}};  // lid -> Leaflet LayerGroup of circles

    function getMap() {{
        for (var k in window) {{
            try {{ if (window[k] && window[k]._container && window[k].eachLayer)
                return window[k]; }} catch(e) {{}}
        }}
    }}

    // Convert raw RSSI (dBm) to a circle radius in pixels
    // RSSI ranges roughly from -100 (weakest) to -30 (strongest)
    // We map that to radius 3 (strong) -> 30 (weak)
    function rssiToRadius(rssi) {{
        var clamped = Math.max(-100, Math.min(-30, rssi));
        // linear interpolation: -30 -> 3px,  -100 -> 30px
        return 3 + ((-30 - clamped) / 70) * 27;
    }}

    // Color by RSSI strength
    function rssiToColor(rssi) {{
        if (rssi >= -60) return 'green';
        if (rssi >= -75) return 'orange';
        return 'red';
    }}

    function toggle(cb) {{
        var m = getMap(), lid = cb.value;
        if (!m) return;
        if (cb.checked) {{
            if (!layers[lid]) {{
                var d = DATA[lid];
                var group = L.layerGroup();
                d.points.forEach(function(p) {{
                    var lat = p[0], lon = p[1], rssi = p[2];
                    L.circleMarker([lat, lon], {{
                        radius:      rssiToRadius(rssi),
                        color:       rssiToColor(rssi),
                        fillColor:   rssiToColor(rssi),
                        fillOpacity: 0.5,
                        weight:      1
                    }})
                    .bindPopup(
                        '<b>' + d.ssid + '</b><br>' +
                        d.mac + '<br>' +
                        'RSSI: <b>' + rssi + ' dBm</b>'
                    )
                    .addTo(group);
                }});
                layers[lid] = group;
            }}
            layers[lid].addTo(m);
        }} else if (layers[lid]) {{
            m.removeLayer(layers[lid]);
        }}
    }}

    function selAll() {{
        document.querySelectorAll('#cs .ci').forEach(function(row) {{
            if (row.style.display === 'none') return;
            var cb = row.querySelector('input');
            if (!cb.checked) {{ cb.checked = true; toggle(cb); }}
        }});
    }}

    function selNone() {{
        document.querySelectorAll('#cs input:checked').forEach(function(cb) {{
            cb.checked = false; toggle(cb);
        }});
    }}

    function filterList(q) {{
        q = q.toLowerCase();
        document.querySelectorAll('#cs .ci').forEach(function(row) {{
            row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        }});
    }}
    </script>
    """

    m.get_root().html.add_child(folium.Element(panel))
    m.save(output_file)
    print(f"RSSI bubble map saved -> {output_file}  ({len(meta)} networks)")


def list_available_macs(data):
    """Print a table of all detected networks with their MAC, SSID, and avg RSSI."""
    _, _, network_positions = process_data(data)
    if not network_positions:
        print("No networks found."); return
    print(f"\n  {'MAC Address':<20} {'SSID':<30} {'Avg RSSI':>10}")
    print("  " + "-" * 62)
    for mac, info in network_positions.items():
        print(f"  {mac:<20} {info.get('ssid','Unknown'):<30} {info.get('avg_rssi', float('nan')):>9.1f}")
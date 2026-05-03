const mqtt = require('mqtt');
const readline = require('readline');

// ==========================
// 📱 GPS DEVICE SIMULATOR
// ==========================
class GPSDeviceSimulator {
  constructor(config) {
    this.deviceId = config.deviceId || 'DEV_001';
    this.deviceName = config.deviceName || 'Truck GPS Tracker';
    this.model = config.model || 'GPS303-TN';
    this.firmware = config.firmware || '2.1.0';
    this.batteryLevel = config.batteryLevel || 98;
    this.temperature = config.temperature || 25;
    this.gpsFix = true;
    this.currentLocation = config.initialLocation || { lat: 35.6897, lng: 10.5982 };
    this.currentSpeed = 0;
    this.currentHeading = 0;
    this.lastUpdate = Date.now();
    this.route = [];
    this.currentWaypoint = 0;
    this.isMoving = false;
    this.simulationInterval = null;
    this.publishInterval = null;
    this.totalDistance = 0;
    this.currentOdometer = config.odometer || 12500;
    this.client = null;
    this.isConnected = false;
  }

  // ==========================
  // 🔌 MQTT CONNECTION
  // ==========================
  async connect(brokerUrl, credentials) {
    return new Promise((resolve, reject) => {
      console.log(`\n📡 Connecting device: ${this.deviceId}`);
      console.log(`🔌 Broker: ${brokerUrl}`);

      this.client = mqtt.connect(brokerUrl, {
        username: credentials.username,
        password: credentials.password,
        protocol: 'mqtts',
        rejectUnauthorized: false,
        keepalive: 60,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        clientId: `gps_${this.deviceId}_${Date.now()}`
      });

      this.client.on('connect', () => {
        console.log(`✅ Connected to MQTT`);
        this.isConnected = true;
        this.sendDeviceStatus();
        resolve();
      });

      this.client.on('error', (err) => {
        console.error(`❌ MQTT error:`, err.message);
        reject(err);
      });

      this.client.on('reconnect', () => console.log(`🔄 Reconnecting...`));
      this.client.on('offline', () => {
        this.isConnected = false;
        console.log(`🔌 Offline`);
      });
    });
  }

  // ==========================
  // 📡 GPS DATA GENERATION
  // ==========================
  generateGPSData() {
    const timeSinceUpdate = (Date.now() - this.lastUpdate) / 1000;

    if (this.isMoving && this.currentSpeed > 0) {
      const distance = (this.currentSpeed * 1000 / 3600) * timeSinceUpdate;
      this.currentOdometer += distance / 1000;
      this.totalDistance   += distance / 1000;
      const latChange = (distance * Math.cos(this.currentHeading * Math.PI / 180)) / 111320;
      const lngChange = (distance * Math.sin(this.currentHeading * Math.PI / 180)) / (111320 * Math.cos(this.currentLocation.lat * Math.PI / 180));
      this.currentLocation.lat += latChange;
      this.currentLocation.lng += lngChange;
    }

    this.batteryLevel -= this.isMoving ? 0.001 * timeSinceUpdate : 0.0002 * timeSinceUpdate;
    this.batteryLevel  = Math.max(0, Math.min(100, this.batteryLevel));
    this.temperature   = 25 + (Math.random() - 0.5) * 5;
    this.lastUpdate    = Date.now();

    return {
      deviceId:   this.deviceId,
      deviceName: this.deviceName,
      location: {
        lat: parseFloat(this.currentLocation.lat.toFixed(6)),
        lng: parseFloat(this.currentLocation.lng.toFixed(6))
      },
      speed:       Math.round(this.currentSpeed * 10) / 10,
      heading:     Math.round(this.currentHeading),
      altitude:    50 + Math.random() * 30,
      accuracy:    Math.round(3 + Math.random() * 5),
      satellites:  Math.floor(7 + Math.random() * 4),
      gpsFix:      true,
      batteryLevel: Math.round(this.batteryLevel),
      temperature:  Math.round(this.temperature),
      odometer:     Math.round(this.currentOdometer),
      timestamp:    new Date().toISOString(),
      deviceInfo: {
        model:    this.model,
        firmware: this.firmware,
        status:   this.isMoving ? 'moving' : 'idle'
      }
    };
  }

  // ==========================
  // 🚛 FOLLOW WAYPOINT ROUTE
  // ==========================
  followRoute(routePoints, speed = 60) {
    if (!routePoints || routePoints.length < 2) {
      console.error('❌ Route must have at least 2 points');
      return;
    }
    this.route = routePoints;
    this.currentWaypoint = 0;
    this.currentSpeed = speed;
    this.isMoving = true;
    this.currentLocation = { ...routePoints[0] };
    this._updateHeading();

    console.log(`\n🚛 Route started — ${routePoints.length} waypoints @ ${speed} km/h`);
    console.log(`📍 Start: (${this.currentLocation.lat}, ${this.currentLocation.lng})`);

    this.simulationInterval = setInterval(() => {
      if (this.currentWaypoint >= this.route.length - 1) {
        console.log(`\n🏁 Reached destination!`);
        this.stop();
        return;
      }
      this.currentWaypoint++;
      this.currentLocation = { ...this.route[this.currentWaypoint] };
      this._updateHeading();
      console.log(`📍 Waypoint ${this.currentWaypoint}/${this.route.length - 1} — (${this.currentLocation.lat.toFixed(6)}, ${this.currentLocation.lng.toFixed(6)})`);
    }, 8000);
  }

  _updateHeading() {
    if (this.currentWaypoint < this.route.length - 1) {
      const cur  = this.route[this.currentWaypoint];
      const next = this.route[this.currentWaypoint + 1];
      let h = Math.atan2(next.lng - cur.lng, next.lat - cur.lat) * 180 / Math.PI;
      if (h < 0) h += 360;
      this.currentHeading = h;
    }
  }

  // ==========================
  // 🚛 SMOOTH A→B INTERPOLATION
  // ==========================
  simulateDriving(origin, destination, durationMinutes = 30) {
    this.origin        = origin;
    this.destination   = destination;
    this.tripDuration  = durationMinutes * 60 * 1000;
    this.tripStartTime = Date.now();
    this.isMoving      = true;
    this.currentLocation = { ...origin };

    const dist = this.calculateDistance(origin, destination);
    this.currentSpeed = dist / (durationMinutes / 60);

    console.log(`\n🚛 Smooth journey — ${dist.toFixed(2)} km in ${durationMinutes} min`);

    this.simulationInterval = setInterval(() => {
      const progress = Math.min(1, (Date.now() - this.tripStartTime) / this.tripDuration);

     if (progress >= 1) {
      this.currentLocation = { ...this.destination };   // already exact, but ensure no drift
      this.currentSpeed = 0;
      // Also set any internal moving flag to false
      this.isMoving = false;
      console.log(`\n🏁 Arrived exactly at destination`);
      this.stop();
      return;
    }

      this.currentLocation = {
        lat: origin.lat + (destination.lat - origin.lat) * progress + (Math.random() - 0.5) * 0.001,
        lng: origin.lng + (destination.lng - origin.lng) * progress + (Math.random() - 0.5) * 0.001
      };
      this.currentSpeed = progress < 0.1 || progress > 0.9
        ? 30
        : 65 + (Math.random() - 0.5) * 20;

      let h = Math.atan2(destination.lng - origin.lng, destination.lat - origin.lat) * 180 / Math.PI;
      if (h < 0) h += 360;
      this.currentHeading = h;

      console.log(`📍 ${Math.round(progress * 100)}% — ${this.currentSpeed.toFixed(1)} km/h`);
    }, 4000);
  }

  // ==========================
  // 🚛 RANDOM DRIVING
  // ==========================
  simulateRandomDriving(centerLat, centerLng, radius = 0.015) {
    console.log(`\n🚛 Random driving around (${centerLat}, ${centerLng})`);
    this.isMoving = true;

    this.simulationInterval = setInterval(() => {
      const angle = Math.random() * Math.PI * 2;
      this.currentLocation = {
        lat: centerLat + Math.cos(angle) * Math.random() * radius,
        lng: centerLng + Math.sin(angle) * Math.random() * radius
      };
      this.currentSpeed   = Math.random() * 60;
      this.currentHeading = Math.random() * 360;
      console.log(`📍 Random — ${this.currentSpeed.toFixed(1)} km/h`);
    }, 5000);
  }

  // ==========================
  // 🚛 IDLE AT ZONE
  // ==========================
  simulateLoadingZone(location, durationMinutes = 60) {
    console.log(`\n🅿️  Idle at (${location.lat}, ${location.lng}) for ${durationMinutes} min`);
    this.currentLocation = { ...location };
    this.currentSpeed    = 0;
    this.isMoving        = false;
    let elapsed = 0;

    this.simulationInterval = setInterval(() => {
      elapsed += 10;
      if (Math.random() > 0.7) {
        this.currentLocation = {
          lat: location.lat + (Math.random() - 0.5) * 0.0001,
          lng: location.lng + (Math.random() - 0.5) * 0.0001
        };
        this.currentSpeed = Math.random() * 5;
        console.log(`📍 Slight bay movement`);
      } else {
        this.currentSpeed = 0;
      }
      if (elapsed >= durationMinutes) {
        console.log(`✅ Loading done`);
        clearInterval(this.simulationInterval);
        this.simulationInterval = null;
      }
    }, 10000);
  }

  stop() {
    this.isMoving     = false;
    this.currentSpeed = 0;
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    console.log(`🛑 Stopped`);
  }

  // ==========================
  // 📤 PUBLISH
  // ==========================
  startPublishing(intervalSeconds = 5) {
    if (this.publishInterval) clearInterval(this.publishInterval);
    console.log(`📡 Publishing every ${intervalSeconds}s to fleet/${this.deviceId}/gps`);
    this.sendGPSData();
    this.publishInterval = setInterval(() => this.sendGPSData(), intervalSeconds * 1000);
  }

  sendGPSData() {
    if (!this.isConnected || !this.client) return;
    const data  = this.generateGPSData();
    const topic = `fleet/${this.deviceId}/gps`;
    this.client.publish(topic, JSON.stringify(data), { qos: 1 }, (err) => {
      if (err) {
        console.error(`❌ Publish error:`, err.message);
      } else {
        const icon = data.speed > 0 ? '🚛' : '🅿️';
        console.log(`${icon} lat:${data.location.lat} lng:${data.location.lng} speed:${data.speed}km/h bat:${data.batteryLevel}%`);
      }
    });
  }

  sendDeviceStatus() {
    const status = {
      deviceId: this.deviceId, deviceName: this.deviceName,
      model: this.model, firmware: this.firmware,
      status: 'online', batteryLevel: this.batteryLevel,
      timestamp: new Date().toISOString()
    };
    this.client.publish(`fleet/${this.deviceId}/status`, JSON.stringify(status), { qos: 1 });
    console.log(`💓 Status sent`);
  }

  disconnect() {
    if (this.publishInterval)    clearInterval(this.publishInterval);
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    if (this.client) { this.client.end(); console.log(`🔌 Disconnected`); }
  }

  calculateDistance(p1, p2) {
    const R    = 6371;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

// ==========================
// 🗺️  SHIPMENT DATA (from provided document)
// ==========================
const MQTT_CONFIG = {
  brokerUrl:   'mqtts://66ac42bd29274f318f00711935fb2001.s1.eu.hivemq.cloud:8883',
  credentials: { username: 'simulator', password: 'Sirine**hivemq1' }
};

// ─── Actual shipment coordinates ───
const ORIGIN      = { lat: 48.8534951, lng: 2.3483915 };   // Paris, France
const DESTINATION = { lat: 35.536856,  lng: 11.0274296 };  // Mahdia, zone touristique (Tunisia)

// Device ID (must match the device attached to the truck in your system)
const DEVICE_ID = 'DEV_001';

// ==========================
// 🚛 ROUTE DEFINITIONS (all start at ORIGIN, end at DESTINATION by default)
// ==========================

// 1. Direct – minimal waypoints
const ROUTE_DIRECT = [
  ORIGIN,
  { lat: 46.5, lng: 5.5 },   // roughly mid‑France
  { lat: 42.5, lng: 8.5 },   // near Corsica / Sardinia
  { lat: 38.5, lng: 10.5 },  // north of Tunisia
  DESTINATION
];

// 2. Coastal detour (west side of Italy, then direct)
const ROUTE_COASTAL = [
  ORIGIN,
  { lat: 45.5, lng: 4.5 },   // Lyon area
  { lat: 43.0, lng: 6.0 },   // French Riviera
  { lat: 40.5, lng: 7.5 },   // Sardinia west
  { lat: 37.5, lng: 9.5 },   // north Tunisia
  { lat: 36.5, lng: 10.5 },  // Tunis region
  DESTINATION
];

// 3. City centre (slow, more stops)
const ROUTE_CITY = [
  ORIGIN,
  { lat: 48.0, lng: 2.3 },   // suburbs Paris
  { lat: 46.5, lng: 4.8 },   // near Lyon
  { lat: 44.8, lng: 4.9 },   // Valence
  { lat: 43.3, lng: 5.4 },   // Marseille
  { lat: 41.9, lng: 8.7 },   // between Corsica and Sardinia
  { lat: 39.2, lng: 9.2 },   // east Sardinia
  { lat: 37.0, lng: 10.0 },  // off Bizerte
  DESTINATION
];

// 4. Loop around Paris (for testing loading zone)
const ROUTE_LOOP = [
  ORIGIN,
  { lat: 48.86, lng: 2.35 },
  { lat: 48.85, lng: 2.36 },
  { lat: 48.84, lng: 2.34 },
  ORIGIN
];

// 5. Multi‑stop with dwell (simulate deliveries)
const ROUTE_MULTISTOP = [
  ORIGIN,
  { lat: 47.5, lng: 4.5 },   // Dijon area
  { lat: 47.5, lng: 4.5 },   // dwell
  { lat: 47.5, lng: 4.5 },   // dwell
  { lat: 43.5, lng: 6.5 },   // between Toulon and Nice
  DESTINATION
];

// 6. Return trip (from Mahdia back to Paris)
const ROUTE_RETURN = [
  DESTINATION,
  { lat: 38.5, lng: 10.5 },
  { lat: 42.5, lng: 8.5 },
  { lat: 46.5, lng: 5.5 },
  ORIGIN
];

// ==========================
// 🚀 MENU
// ==========================
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function showMenu() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log(`║  🚛 GPS Simulator — Shipment SHP-1777559392236-FI9Y7M           ║`);
  console.log(`║  Origin: Paris (48.8535, 2.3484)                                ║`);
  console.log(`║  Destination: Mahdia, Tunisia (35.5369, 11.0274)                ║`);
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  1. Route 1 — Direct (4 waypoints, 80 km/h)                    ║');
  console.log('║  2. Route 2 — Coastal detour (6 waypoints, 70 km/h)            ║');
  console.log('║  3. Route 3 — City centre (8 waypoints, 55 km/h)               ║');
  console.log('║  4. Route 4 — Loop around Paris (20 km/h)                      ║');
  console.log('║  5. Route 5 — Multi-stop with dwell (50 km/h)                  ║');
  console.log('║  6. Route 6 — Return trip: Mahdia → Paris (80 km/h)            ║');
  console.log('║  7. Smooth interpolation A→B (35 hours journey)                ║');
  console.log('║  8. Random driving near Paris                                  ║');
  console.log('║  9. Idle at loading zone (Paris)                               ║');
  console.log('║  0. Exit                                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  rl.question('Select option (0-9): ', async (choice) => {
    if (choice === '0') {
      console.log('👋 Goodbye!');
      rl.close();
      process.exit(0);
    }

    const device = new GPSDeviceSimulator({
      deviceId:        DEVICE_ID,
      deviceName:      'Delivery Truck — SHP-1777559392236-FI9Y7M',
      initialLocation: { ...ORIGIN },
      batteryLevel:    95,
      odometer:        12500
    });

    try {
      await device.connect(MQTT_CONFIG.brokerUrl, MQTT_CONFIG.credentials);
      device.startPublishing(5); // 5s interval

      switch (choice) {
        case '1': device.followRoute(ROUTE_DIRECT,    80); break;
        case '2': device.followRoute(ROUTE_COASTAL,   70); break;
        case '3': device.followRoute(ROUTE_CITY,      55); break;
        case '4': device.followRoute(ROUTE_LOOP,      20); break;
        case '5': device.followRoute(ROUTE_MULTISTOP, 50); break;
        case '6': device.followRoute(ROUTE_RETURN,    80); break;
        case '7': device.simulateDriving(ORIGIN, DESTINATION, 35 * 60); break; // 35 hours
        case '8': device.simulateRandomDriving(ORIGIN.lat, ORIGIN.lng, 0.03); break;
        case '9': device.simulateLoadingZone(ORIGIN, 60); break;
        default:
          console.log('❌ Invalid option');
          device.disconnect();
          rl.close();
          return;
      }

      console.log('\n▶ Running — press Ctrl+C to stop\n');
    } catch (err) {
      console.error('❌ Failed to start:', err.message);
      rl.close();
    }
  });
}

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  rl.close();
  process.exit(0);
});

showMenu();
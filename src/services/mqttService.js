const mqtt = require('mqtt');
const trackingService = require('./trackingService');
const Device = require('../models/Device');

class MQTTService {
  constructor() {
    this.client = null;
    this.io = null;
    this.knownDeviceIds = new Set();
    this.cacheTimeout = null;
    this._lastRefresh = 0;                // ← track last refresh time
    this._refreshCooldown = 30000;        // 30 seconds cooldown
  }

  // ─── Refresh the cache (rate‑limited) ──────────────────────────────────
  async refreshDeviceCache(force = false) {
    const now = Date.now();
    if (!force && (now - this._lastRefresh) < this._refreshCooldown) return;

    this._lastRefresh = now;

    try {
      const devices = await Device.find({}, { deviceId: 1 });
      const newSet = new Set(devices.map(d => d.deviceId));

      // Only log if count changed
      if (newSet.size !== this.knownDeviceIds.size) {
        console.log(`[MQTT] Device cache updated: ${this.knownDeviceIds.size} → ${newSet.size} known devices`);
      }

      this.knownDeviceIds = newSet;
    } catch (err) {
      console.error('[MQTT] Failed to refresh device cache:', err.message);
    }
  }

  start(io) {
    this.io = io;

    const brokerUrl = process.env.MQTT_BROKER_URL;
    if (!brokerUrl) {
      console.log('MQTT not configured, skipping...');
      return;
    }

    console.log('Connecting to MQTT broker...');
    console.log(`Broker: ${brokerUrl}`);

    this.client = mqtt.connect(
      'mqtt://broker.hivemq.com:1883',
      {
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        clean: true
      }
    );

    // ──────────────────────────────────────────────────────────────────────
    // CONNECT EVENT
    // ──────────────────────────────────────────────────────────────────────
    this.client.on('connect', async () => {
      console.log('MQTT Connected successfully');

      // Only refresh + start interval on first connect
      if (!this.cacheTimeout) {
        await this.refreshDeviceCache(true);
        this.cacheTimeout = setInterval(() => this.refreshDeviceCache(true), 60000);
      }

      this.client.subscribe('fleet/+/gps', { qos: 1 }, (err) => {
        if (err) console.error('Subscription failed:', err);
        else     console.log('Subscribed to fleet/+/gps');
      });
    });

    // ──────────────────────────────────────────────────────────────────────
    // MESSAGE EVENT – unchanged (whitelist filter remains)
    // ──────────────────────────────────────────────────────────────────────
    this.client.on('message', async (topic, message) => {
      try {
        const messageStr = message.toString();
        // ── Ignore empty retained message clears ──
        if (!messageStr) return;
        const data = JSON.parse(messageStr);

        const parts = topic.split('/');
        let deviceId = null;
        if (parts.length === 3 && parts[0] === 'fleet' && parts[2] === 'gps') {
          deviceId = parts[1];
        }
        if (!deviceId && data.deviceId) {
          deviceId = data.deviceId;
        }
        if (!deviceId) {
          console.log('Missing deviceId');
          return;
        }

        // ★ Whitelist filter (silent drop for unknown devices)
        if (!this.knownDeviceIds.has(deviceId)) {
          // Optional debug: uncomment if needed
          // if (process.env.DEBUG === 'true') {
          //   console.log(`[MQTT] Ignoring unknown device: ${deviceId}`);
          // }
          return;
        }

        if (!data.location?.lat || !data.location?.lng) {
          console.log('Invalid GPS data');
          return;
        }

        // Reject telemetry older than 5 minutes (stale/retained messages)
        if (data.timestamp) {
          const msgTime = new Date(data.timestamp).getTime();
          const now = Date.now();
          const ageMs = now - msgTime;
          const fiveMinMs = 5 * 60 * 1000;
          
          if (ageMs > fiveMinMs) {
            console.log(`[Tracking] Rejected stale telemetry from ${deviceId}: ${Math.round(ageMs / 1000)}s old`);
            return;
          }
        }

        // Log all telemetry details to track source
        const now = new Date().toISOString();
        console.log(`[${now}] Telemetry from ${deviceId} | Battery: ${data.batteryLevel || 'N/A'}% | Speed: ${data.speed || 0} | Payload Timestamp: ${data.timestamp || 'N/A'}`);
        console.log(`  Raw Data:`, JSON.stringify(data));

        await trackingService.processTracking(
          {
            deviceId,
            location: data.location,
            speed: data.speed || 0,
            heading: data.heading || 0,
            batteryLevel: data.batteryLevel,
            timestamp: data.timestamp,
            firmwareVersion: data.firmwareVersion
          },
          this.io,
          'mqtt'
        );

      } catch (err) {
        console.error('MQTT message error:', err.message);
      }
    });

    // ─── Error handling (unchanged) ────────────────────────────────────
    this.client.on('error', (err) => {
      console.error('MQTT error:', err.message);
    });

    this.client.on('reconnect', () => {
      console.log('MQTT reconnecting...');
    });

    this.client.on('offline', () => {
      console.log('MQTT offline');
    });

    this.client.on('close', () => {
      console.log('MQTT connection closed');
    });
  }

  stop() {
    if (this.cacheTimeout) {
      clearInterval(this.cacheTimeout);
      this.cacheTimeout = null;
    }
    if (this.client) {
      this.client.end();
      this.client = null;
      console.log('MQTT service stopped');
    }
  }
}

module.exports = new MQTTService();
const mqtt = require('mqtt');
const trackingService = require('./trackingService');

class MQTTService {
  constructor() {
    this.client = null;
    this.io = null;
  }

  start(io) {
    this.io = io;

    const brokerUrl = process.env.MQTT_BROKER_URL;

    if (!brokerUrl) {
      console.log('⚠️ MQTT not configured, skipping...');
      return;
    }

    console.log('🔌 Connecting to MQTT broker...');
    console.log(`📡 Broker: ${brokerUrl}`);

    // ✅ FIX: assign to this.client (NOT local variable)
    this.client = mqtt.connect(
      'mqtt://broker.hivemq.com:1883',
      {
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        clean: true
      }
    );

    // ─────────────────────────────
    // CONNECT EVENT
    // ─────────────────────────────
    this.client.on('connect', () => {
      console.log('✅ MQTT Connected successfully');

      this.client.subscribe('fleet/+/gps', { qos: 1 }, (err) => {
        if (err) {
          console.error('❌ Subscription failed:', err);
        } else {
          console.log('📡 Subscribed to fleet/+/gps');
        }
      });
    });

    // ─────────────────────────────
    // MESSAGE EVENT
    // ─────────────────────────────
    this.client.on('message', async (topic, message) => {
      try {
        console.log(`📨 MQTT topic: ${topic}`);

        const messageStr = message.toString();
        const data = JSON.parse(messageStr);

        // Extract deviceId from topic
        const parts = topic.split('/');
        let deviceId = null;

        if (parts.length === 3 && parts[0] === 'fleet' && parts[2] === 'gps') {
          deviceId = parts[1];
        }

        if (!deviceId && data.deviceId) {
          deviceId = data.deviceId;
        }

        if (!deviceId) {
          console.log('⚠️ Missing deviceId');
          return;
        }

        if (!data.location?.lat || !data.location?.lng) {
          console.log('⚠️ Invalid GPS data');
          return;
        }

        console.log(
          `📡 Device: ${deviceId} | Speed: ${data.speed || 0}`
        );

        await trackingService.processTracking(
          {
            deviceId,
            location: data.location,
            speed: data.speed || 0,
            heading: data.heading || 0,
            batteryLevel: data.batteryLevel,
            temperature: data.temperature,
            timestamp: data.timestamp
          },
          this.io,
          'mqtt'
        );

      } catch (err) {
        console.error('❌ MQTT message error:', err.message);
      }
    });

    // ─────────────────────────────
    // ERROR HANDLING
    // ─────────────────────────────
    this.client.on('error', (err) => {
      console.error('❌ MQTT error:', err.message);
    });

    this.client.on('reconnect', () => {
      console.log('🔄 MQTT reconnecting...');
    });

    this.client.on('offline', () => {
      console.log('🔌 MQTT offline');
    });

    this.client.on('close', () => {
      console.log('🔴 MQTT connection closed');
    });
  }

  stop() {
    if (this.client) {
      this.client.end();
      this.client = null;
      console.log('🛑 MQTT service stopped');
    }
  }
}

module.exports = new MQTTService();
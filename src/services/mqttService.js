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
    const username = process.env.MQTT_USER;
    const password = process.env.MQTT_PASS;

    if (!brokerUrl) {
      console.log('⚠️ MQTT not configured, skipping...');
      return;
    }

    console.log('🔌 Connecting to MQTT broker...');
    console.log(`📡 Broker: ${brokerUrl}`);
    console.log(`📡 Username: ${username}`);

    this.client = mqtt.connect(brokerUrl, {
      username: username,
      password: password,
      protocol: 'mqtts',
      rejectUnauthorized: false,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 10000
    });

    this.client.on('connect', () => {
      console.log('✅ MQTT Connected successfully');
      
      // Subscribe to the topic pattern
      this.client.subscribe('fleet/+/gps', { qos: 1 }, (err) => {
        if (err) {
          console.error('❌ Subscription failed:', err);
        } else {
          console.log('📡 Subscribed to fleet/+/gps');
        }
      });
    });

    this.client.on('message', async (topic, message) => {
      console.log(`📨 MQTT Message received on topic: ${topic}`);
      
      try {
        const messageStr = message.toString();
        console.log(`📨 Raw message: ${messageStr}`);
        
        const data = JSON.parse(messageStr);
        
        // Extract deviceId from topic (format: fleet/DEVICE_ID/gps)
        const topicParts = topic.split('/');
        let deviceId = null;
        
        if (topicParts.length === 3 && topicParts[0] === 'fleet' && topicParts[2] === 'gps') {
          deviceId = topicParts[1];
        }
        
        // Also check if deviceId is in the message
        if (!deviceId && data.deviceId) {
          deviceId = data.deviceId;
        }
        
        if (!deviceId) {
          console.log('⚠️ No deviceId found in topic or message');
          return;
        }
        
        if (!data.location || typeof data.location.lat !== 'number' || typeof data.location.lng !== 'number') {
          console.log('⚠️ Invalid location data');
          return;
        }
        
        console.log(`📡 Processing GPS for device: ${deviceId}, speed: ${data.speed || 0}km/h`);
        
        // Process the tracking data
        await trackingService.processTracking(
          {
            deviceId: deviceId,
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
        console.error('❌ Error processing MQTT message:', err);
      }
    });

    this.client.on('error', (error) => {
      console.error('❌ MQTT error:', error);
    });

    this.client.on('reconnect', () => {
      console.log('🔄 MQTT reconnecting...');
    });

    this.client.on('offline', () => {
      console.log('🔌 MQTT offline');
    });
  }

  stop() {
    if (this.client) {
      this.client.end();
      console.log('MQTT service stopped');
    }
  }
}

module.exports = new MQTTService();
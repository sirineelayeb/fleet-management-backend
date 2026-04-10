const mqtt = require('mqtt');
const Device = require('../models/Device');
const Truck = require('../models/Truck');
const Mission = require('../models/Mission');
const TripHistory = require('../models/TripHistory');
const Shipment = require('../models/Shipment');
const Driver = require('../models/Driver');
const LocationHistory = require('../models/LocationHistory');
const notificationService = require('./notificationService');
const tripHistoryService = require('./tripHistoryService');
const driverService = require('./driverService');

const CONFIG = {
  AUTO_START_SPEED_THRESHOLD: 5,
  AUTO_COMPLETE_DISTANCE_KM: 0.1,
  AUTO_COMPLETE_DEBOUNCE_COUNT: 1,
  SPEED_LIMIT_ALERT: 80,
};

const autoCompleteDebounce = new Map();

class MqttService {
  constructor() {
    this.client = null;
    this.io = null;
  }

  start(io) {
    this.io = io;
    const mqttUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

    // Build connection options (username, password, TLS)
    const options = {};
    if (process.env.MQTT_USER) options.username = process.env.MQTT_USER;
    if (process.env.MQTT_PASS) options.password = process.env.MQTT_PASS;

    // For TLS (mqtts://) we need to set protocol explicitly and optionally allow self‑signed
    if (mqttUrl.startsWith('mqtts://')) {
      options.protocol = 'mqtts';
      // For self‑signed certificates (like HiveMQ Cloud free tier), set rejectUnauthorized false
      // Remove this line if you have a valid CA certificate
      options.rejectUnauthorized = false;
    }

    this.client = mqtt.connect(mqttUrl, options);

    this.client.on('connect', () => {
      console.log(`MQTT connected to ${mqttUrl}`);
      this.client.subscribe('fleet/gps', (err) => {
        if (err) console.error('MQTT subscription error:', err);
        else console.log('Subscribed to fleet/gps');
      });
    });

    this.client.on('error', (err) => {
      console.error('MQTT client error:', err);
    });

    this.client.on('message', async (topic, message) => {
      if (topic === 'fleet/gps') {
        try {
          const data = JSON.parse(message.toString());
          await this.handleGpsData(data);
        } catch (err) {
          console.error('MQTT message parse error:', err);
        }
      }
    });
  }

  async handleGpsData({ deviceId, location, speed = 0, heading = 0, batteryLevel = 100 }) {
    const device = await Device.findOne({ deviceId });
    if (!device || !device.truck) {
      console.warn(`Device ${deviceId} not found or not assigned`);
      return;
    }
    const truck = await Truck.findById(device.truck);
    if (!truck) {
      console.warn(`Truck for device ${deviceId} not found`);
      return;
    }

    const mission = await Mission.findOne({
      truck: truck._id,
      status: { $in: ['not_started', 'in_progress'] }
    }).populate('shipment');
    const trip = mission ? await TripHistory.findOne({ mission: mission._id }) : null;

    await LocationHistory.create({
      truck: truck._id,
      trip: trip?._id || null,
      mission: mission?._id || null,
      location: { type: 'Point', coordinates: [location.lng, location.lat] },
      speed, heading, batteryLevel,
      timestamp: new Date(),
      source: 'mqtt'
    });

    truck.currentLocation = { lat: location.lat, lng: location.lng };
    truck.currentSpeed = speed;
    truck.lastTelemetryAt = new Date();
    await truck.save();

    if (this.io) {
      this.io.emit('truck_location', {
        truckId: truck._id,
        licensePlate: truck.licensePlate,
        location: { lat: location.lat, lng: location.lng },
        speed,
        timestamp: new Date()
      });
    }

    if (speed > CONFIG.SPEED_LIMIT_ALERT) {
      await notificationService.createNotification('speed_violation', {
        licensePlate: truck.licensePlate,
        speed,
        location: `${location.lat}, ${location.lng}`
      }, this.io);
    }

    if (!mission) return;

    if (mission.status === 'not_started' && speed > CONFIG.AUTO_START_SPEED_THRESHOLD) {
      await this.startMission(mission, trip, truck);
    }

    if (trip && mission.status === 'in_progress' && speed > (trip.maxSpeed || 0)) {
      trip.maxSpeed = speed;
      await trip.save();
    }

    if (mission.status === 'in_progress' && mission.shipment?.destinationCoordinates) {
      await this.autoCompleteMission(mission, trip, truck, location, speed);
    }
  }

  async startMission(mission, trip, truck) {
    mission.status = 'in_progress';
    mission.startTime = new Date();
    await mission.save();

    if (mission.shipment) {
      mission.shipment.actualDepartureDate = new Date();
      mission.shipment.status = 'in_progress';
      await mission.shipment.save();
    }

    if (trip) {
      trip.status = 'in_progress';
      trip.actualStartTime = new Date();
      await trip.save();
    }

    truck.status = 'in_mission';
    await truck.save();

    const driver = await Driver.findById(mission.driver);
    if (driver) {
      driver.status = 'busy';
      await driver.save();
    }

    if (this.io) {
      this.io.emit('mission_started', {
        missionId: mission._id,
        truckId: truck._id,
        shipmentId: mission.shipment?._id,
        startTime: mission.startTime
      });
    }
    console.log(`Mission ${mission._id} started for ${truck.licensePlate}`);
  }

  async autoCompleteMission(mission, trip, truck, location, speed) {
    const dist = this.calculateDistance(location, mission.shipment.destinationCoordinates);
    const isStopped = speed === 0;
    const isNear = dist < CONFIG.AUTO_COMPLETE_DISTANCE_KM;
    const truckId = truck._id.toString();
    let debounce = autoCompleteDebounce.get(truckId) || { count: 0, lastTimestamp: Date.now() };

    if (!isNear || !isStopped) {
      if (debounce.count > 0) autoCompleteDebounce.delete(truckId);
      return;
    }
    debounce.count++;
    autoCompleteDebounce.set(truckId, debounce);
    if (debounce.count < CONFIG.AUTO_COMPLETE_DEBOUNCE_COUNT) return;

    if (!trip) {
      console.error(`No trip for mission ${mission._id}`);
      return;
    }

    await tripHistoryService.completeTrip(trip._id, new Date());

    mission.status = 'completed';
    mission.endTime = new Date();
    await mission.save();

    if (mission.shipment) {
      mission.shipment.actualDeliveryDate = new Date();
      mission.shipment.status = 'completed';
      await mission.shipment.save();
    }

    truck.status = 'available';
    await truck.save();

    const driver = await Driver.findById(mission.driver);
    if (driver) driver.status = 'available', await driver.save();

    try {
      await driverService.updateDriverScoreForMission(mission._id, mission.shipment.actualDeliveryDate);
    } catch (err) {
      console.error('Driver score update failed:', err);
    }

    if (this.io) {
      this.io.emit('mission_completed', {
        missionId: mission._id,
        truckId: truck._id,
        shipmentId: mission.shipment?._id,
        endTime: mission.endTime
      });
    }

    autoCompleteDebounce.delete(truckId);
    console.log(`Mission ${mission._id} completed for ${truck.licensePlate}`);
  }

  calculateDistance(p1, p2) {
    const R = 6371;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLon = toRad(p2.lng - p1.lng);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
}

module.exports = new MqttService();
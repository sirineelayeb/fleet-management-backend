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

// Configuration – same as DeviceController
const CONFIG = {
  AUTO_START_SPEED_THRESHOLD: 5,      // km/h
  AUTO_COMPLETE_DISTANCE_KM: 0.1,     // 100 meters
  AUTO_COMPLETE_DEBOUNCE_COUNT: 1,    // consecutive points required
  SPEED_LIMIT_ALERT: 80,              // km/h
};

// Debounce map for auto‑complete (per truck)
const autoCompleteDebounce = new Map();

class MqttService {
  constructor() {
    this.client = null;
    this.io = null;
  }

  /**
   * Start MQTT client and subscribe to GPS topic.
   * @param {Object} io - Socket.IO instance for real‑time events
   */
  start(io) {
    this.io = io;
    // Connect to Mosquitto (default port 1883). For production, use env variables.
    const mqttUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    this.client = mqtt.connect(mqttUrl);

    this.client.on('connect', () => {
      console.log(`MQTT connected to ${mqttUrl}`);
      this.client.subscribe('fleet/gps', (err) => {
        if (!err) console.log('Subscribed to fleet/gps');
        else console.error('MQTT subscription error:', err);
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

  /**
   * Process incoming GPS data from device.
   * Expected payload: { deviceId, location: { lat, lng }, speed, heading?, batteryLevel? }
   */
  async handleGpsData({ deviceId, location, speed = 0, heading = 0, batteryLevel = 100 }) {
    // 1. Find device & truck
    const device = await Device.findOne({ deviceId });
    if (!device) {
      console.warn(`Device ${deviceId} not found`);
      return;
    }
    if (!device.truck) {
      console.warn(`Device ${deviceId} is not assigned to any truck`);
      return;
    }
    const truck = await Truck.findById(device.truck);
    if (!truck) {
      console.warn(`Truck for device ${deviceId} not found`);
      return;
    }

    // 2. Get active mission and trip
    const mission = await Mission.findOne({
      truck: truck._id,
      status: { $in: ['not_started', 'in_progress'] }
    }).populate('shipment');
    const trip = mission ? await TripHistory.findOne({ mission: mission._id }) : null;

    // 3. Save location point (always)
    await LocationHistory.create({
      truck: truck._id,
      trip: trip?._id || null,
      mission: mission?._id || null,
      location: { type: 'Point', coordinates: [location.lng, location.lat] },
      speed,
      heading,
      batteryLevel,
      timestamp: new Date(),
      source: 'mqtt'
    });

    // 4. Update truck live data
    truck.currentLocation = { lat: location.lat, lng: location.lng };
    truck.currentSpeed = speed;
    truck.lastTelemetryAt = new Date();
    await truck.save();

    // 5. Emit real‑time location for live map
    if (this.io) {
      this.io.emit('truck_location', {
        truckId: truck._id,
        licensePlate: truck.licensePlate,
        location: { lat: location.lat, lng: location.lng },
        speed,
        timestamp: new Date()
      });
    }

    // 6. Speed violation alert (if speed exceeds limit)
    if (speed > CONFIG.SPEED_LIMIT_ALERT) {
      await notificationService.createNotification('speed_violation', {
        licensePlate: truck.licensePlate,
        speed,
        location: `${location.lat}, ${location.lng}`
      }, this.io);
    }

    // 7. If no active mission, stop here
    if (!mission) {
      console.log(`No active mission for truck ${truck.licensePlate}`);
      return;
    }

    // 8. Auto‑start mission if moving
    if (mission.status === 'not_started' && speed > CONFIG.AUTO_START_SPEED_THRESHOLD) {
      await this.startMission(mission, trip, truck);
    }

    // 9. Update max speed for trip (if mission in progress)
    if (trip && mission.status === 'in_progress' && speed > (trip.maxSpeed || 0)) {
      trip.maxSpeed = speed;
      await trip.save();
    }

    // 10. Auto‑complete mission if near destination and stopped
    if (mission.status === 'in_progress' && mission.shipment?.destinationCoordinates) {
      await this.autoCompleteMission(mission, trip, truck, location, speed);
    }
  }

  /**
   * Start the mission (auto‑triggered by first movement).
   */
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
    console.log(`🚀 Mission ${mission._id} auto‑started for truck ${truck.licensePlate}`);
  }

  /**
   * Auto‑complete mission when truck is within distance and stopped (debounced).
   */
  async autoCompleteMission(mission, trip, truck, location, speed) {
    const dist = this.calculateDistance(
      { lat: location.lat, lng: location.lng },
      mission.shipment.destinationCoordinates
    );
    const isStopped = speed === 0;
    const isNear = dist < CONFIG.AUTO_COMPLETE_DISTANCE_KM;

    const truckId = truck._id.toString();
    const now = Date.now();
    let debounce = autoCompleteDebounce.get(truckId) || { count: 0, lastTimestamp: now };

    // Reset debounce if conditions not met
    if (!isNear || !isStopped) {
      if (debounce.count > 0) autoCompleteDebounce.delete(truckId);
      return;
    }

    debounce.count++;
    debounce.lastTimestamp = now;
    autoCompleteDebounce.set(truckId, debounce);

    if (debounce.count >= CONFIG.AUTO_COMPLETE_DEBOUNCE_COUNT) {
      if (mission.status !== 'in_progress') return;
      if (!trip) {
        console.error(`No trip found for mission ${mission._id} – auto‑complete aborted`);
        return;
      }

      // Finalize trip (distance, route, duration, etc.)
      await tripHistoryService.completeTrip(trip._id, new Date());

      // Mark mission as completed
      mission.status = 'completed';
      mission.endTime = new Date();
      await mission.save();

      // Update shipment actual delivery date
      if (mission.shipment) {
        mission.shipment.actualDeliveryDate = new Date();
        mission.shipment.status = 'completed';
        await mission.shipment.save();
      }

      // Free truck and driver
      truck.status = 'available';
      await truck.save();

      const driver = await Driver.findById(mission.driver);
      if (driver) {
        driver.status = 'available';
        await driver.save();
      }

      // Update driver score based on delivery timeliness
      try {
        await driverService.updateDriverScoreForMission(mission._id, mission.shipment.actualDeliveryDate);
      } catch (err) {
        console.error('Failed to update driver score for mission', mission._id, err);
      }

      // Emit WebSocket event
      if (this.io) {
        this.io.emit('mission_completed', {
          missionId: mission._id,
          truckId: truck._id,
          shipmentId: mission.shipment?._id,
          endTime: mission.endTime
        });
      }

      autoCompleteDebounce.delete(truckId);
      console.log(`✅ Mission ${mission._id} auto‑completed for truck ${truck.licensePlate}`);
    }
  }

  /**
   * Haversine distance (km) between two points {lat, lng}.
   */
  calculateDistance(point1, point2) {
    const R = 6371;
    const lat1 = point1.lat * Math.PI / 180;
    const lat2 = point2.lat * Math.PI / 180;
    const deltaLat = (point2.lat - point1.lat) * Math.PI / 180;
    const deltaLon = (point2.lng - point1.lng) * Math.PI / 180;
    const a = Math.sin(deltaLat/2) ** 2 +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

module.exports = new MqttService();
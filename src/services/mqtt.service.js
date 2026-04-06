const mqtt        = require('mqtt');
const Truck       = require('../models/Truck');
const Device      = require('../models/Device');
const TruckLocation = require('../models/TruckLocation');

let io;

function start(socketIo) {
  io = socketIo;
  const client = mqtt.connect('mqtt://localhost:1883');

  client.on('connect', () => {
    console.log('Backend connected to MQTT broker');
    client.subscribe('fleet/truck/+');
  });

  client.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      const { deviceId, location, speed, heading, batteryLevel } = payload;

      console.log('Message received:', deviceId);

      const device = await Device.findOne({ deviceId });
      if (!device?.truck) {
        console.log('Device not found or not linked:', deviceId);
        return;
      }

      // Update device
      device.lastPing = new Date();
      if (batteryLevel != null) device.batteryLevel = batteryLevel;
      await device.save();

      // Update truck snapshot
      await Truck.findByIdAndUpdate(device.truck, {
        currentLocation: location,
        lastTelemetryAt: new Date()
      });

      // Save ping to history
      await TruckLocation.create({
        truck:     device.truck,
        location,
        speed:     speed   ?? 0,
        heading:   heading ?? null,
        timestamp: new Date()
      });

      // Push to frontend via Socket.IO
      io.emit('truck:location', {
        truckId:   device.truck,
        deviceId,
        location:  location.coordinates,
        speed,
        heading,
        timestamp: new Date()
      });

    } catch (err) {
      console.error('MQTT message error:', err);
    }
  });

  client.on('error', err => console.error('MQTT broker error:', err));
}

module.exports = { start };
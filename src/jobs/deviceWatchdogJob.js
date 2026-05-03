// src/jobs/deviceWatchdogJob.js
const cron   = require('node-cron');
const Device = require('../models/Device');
const notificationService = require('../services/notificationService');

const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

function startDeviceWatchdog(io) {
  cron.schedule('* * * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD_MS);

      // Only devices that are still marked 'active' but haven't pinged recently
      // status won't auto-update to 'inactive' until next save() — so we check lastSeen directly
      const staleDevices = await Device.find({
        status:  'active',          // was online
        lastSeen: { $lt: cutoff },  // but hasn't pinged in > 5 min
      });

      for (const device of staleDevices) {
        // Trigger pre('save') hook → sets status to 'inactive' automatically
        device.lastSeen = device.lastSeen; // no-op value, but...
        // ↑ won't mark isModified. Do this instead:
        device.status = 'inactive';        // set directly, skip maintenance devices
        await device.save();

        await notificationService.createNotification('device_offline', {
          deviceId: device.deviceId,
          truckId:  device.truck,
          lastSeen: device.lastSeen,
        }, io);

        console.log(`🔴 Device ${device.deviceId} marked offline`);
      }
    } catch (err) {
      console.error('❌ Watchdog error:', err);
    }
  });

  console.log('🐕 Device watchdog started');
}

module.exports = { startDeviceWatchdog };
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
      lastSeen: { $lt: cutoff },
      status: { $ne: 'maintenance' }
    });

      if (staleDevices.length) {
        for (const device of staleDevices) {
          if (device.status !== 'inactive') {
            device.status = 'inactive';
            await device.save();

            await notificationService.createNotification(
              'device_offline',
              {
                deviceId: device.deviceId,
                truckId: device.truck,
                lastSeen: device.lastSeen,
              },
              io
            );

            console.log(`Device ${device.deviceId} marked offline`);
          }
        }
      }
    } catch (err) {
      console.error('Watchdog error:', err);
    }
  });

  console.log('Device watchdog started');
}

module.exports = { startDeviceWatchdog };
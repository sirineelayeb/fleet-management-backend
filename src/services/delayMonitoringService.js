const cron = require('node-cron');
const Shipment = require('../models/Shipment');
const notificationService = require('./notificationService');

class DelayMonitoringService {
  
  constructor() {
    this.io = null;
  }

  start(io) {
    this.io = io;
    // Run every hour to check for newly delayed shipments
    cron.schedule('0 * * * *', () => {
      this.checkDelayedShipments();
    });
    console.log('✅ Delay monitoring service started (checks every hour)');
  }
  
  async checkDelayedShipments() {
    try {
      console.log('🔍 Checking for newly delayed shipments...');
      const now = new Date();
      
      // Find shipments that:
      // 1. Are not completed or cancelled
      // 2. Have passed delivery date
      // 3. Have NOT been notified yet (sends only once)
      const delayedShipments = await Shipment.find({
        status: { $in: ['assigned', 'in_progress'] },
        plannedDeliveryDate: { $lt: now },
        delayNotified: { $ne: true }
      }).populate('truck', 'licensePlate')
        .populate('assignedTo', 'name email role');
      
      if (delayedShipments.length === 0) {
        console.log('✅ No newly delayed shipments found');
        return;
      }
      
      console.log(`📦 Found ${delayedShipments.length} newly delayed shipment(s)`);
      
      for (const shipment of delayedShipments) {
        // Calculate delay duration
        const plannedDate = new Date(shipment.plannedDeliveryDate);
        const delayMs = now - plannedDate;
        const delayMinutes = Math.floor(delayMs / (1000 * 60));
        const delayHours = Math.floor(delayMinutes / 60);
        const delayDays = Math.floor(delayHours / 24);
        
        console.log(`⏰ Delay detected: ${shipment.shipmentId}`);
        console.log(`   Planned: ${plannedDate.toLocaleString()}`);
        console.log(`   Current: ${now.toLocaleString()}`);
        console.log(`   Delay: ${delayDays}d ${delayHours % 24}h ${delayMinutes % 60}m`);
        
        // ✅ Send notification with io instance
        await notificationService.createNotification('delivery_delayed', {
          shipmentId: shipment._id,
          shipmentNumber: shipment.shipmentId,
          delayMinutes: delayMinutes,
          delayHours: delayHours,
          delayDays: delayDays,
          origin: shipment.origin,
          destination: shipment.destination,
          plannedDeliveryDate: shipment.plannedDeliveryDate,
          truckPlate: shipment.truck?.licensePlate || 'Unknown',
          currentStatus: shipment.status,
          managerId: shipment.assignedTo?._id?.toString(),
          managerName: shipment.assignedTo?.name
        }, this.io);  // ✅ Pass io here
        
        // Mark as notified - this ensures it's sent only ONCE
        shipment.delayNotified = true;
        await shipment.save();
        
        console.log(`✅ Delay notification sent for ${shipment.shipmentId}`);
      }
      
      console.log(`📧 Processed ${delayedShipments.length} delay notification(s)`);
      
    } catch (error) {
      console.error('❌ Error checking delayed shipments:', error);
    }
  }
  
  // For manual testing (call this from an API endpoint)
  async checkNow() {
    console.log('🔧 Manual delay check triggered');
    await this.checkDelayedShipments();
  }
}

module.exports = new DelayMonitoringService();
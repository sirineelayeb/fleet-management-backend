const Shipment = require('../models/Shipment');
const Mission = require('../models/Mission');
const notificationService = require('./notificationService');
const Notification = require('../models/Notification');  
class DelayMonitoringService {
  
  /**
   * Check all active shipments for delays and create notifications.
   * @param {Object} io - Socket.IO instance (optional)
   */
  async checkAllActiveShipments(io = null) {
    const now = new Date();
    
    // Active = not completed, not cancelled
    const shipments = await Shipment.find({
      status: { $in: ['assigned', 'in_progress'] },
      plannedDepartureDate: { $exists: true },
      plannedDeliveryDate: { $exists: true }
    }).populate('truck', 'licensePlate');
    
    for (const shipment of shipments) {
      const mission = await Mission.findOne({ shipment: shipment._id });
      await this.checkDepartureDelay(shipment, mission, now, io);
      await this.checkDeliveryDelay(shipment, mission, now, io);
    }
  }
  
  async checkDepartureDelay(shipment, mission, now, io) {
    let isDelayed = false;
    let delayMinutes = 0;
    let actualDeparture = mission?.startTime;
    
    if (actualDeparture && actualDeparture > shipment.plannedDepartureDate) {
      isDelayed = true;
      delayMinutes = Math.floor((actualDeparture - shipment.plannedDepartureDate) / 60000);
    } else if (!actualDeparture && now > shipment.plannedDepartureDate) {
      isDelayed = true;
      delayMinutes = Math.floor((now - shipment.plannedDepartureDate) / 60000);
    }
    
    if (isDelayed) {
      await this.createOrUpdateDelayNotification(shipment, 'departure', delayMinutes, io);
    }
  }
  
  async checkDeliveryDelay(shipment, mission, now, io) {
    let isDelayed = false;
    let delayMinutes = 0;
    let actualDelivery = mission?.endTime;
    
    if (actualDelivery && actualDelivery > shipment.plannedDeliveryDate) {
      isDelayed = true;
      delayMinutes = Math.floor((actualDelivery - shipment.plannedDeliveryDate) / 60000);
    } else if (!actualDelivery && now > shipment.plannedDeliveryDate) {
      isDelayed = true;
      delayMinutes = Math.floor((now - shipment.plannedDeliveryDate) / 60000);
    }
    
    if (isDelayed) {
      await this.createOrUpdateDelayNotification(shipment, 'delivery', delayMinutes, io);
    }
  }
  
  async createOrUpdateDelayNotification(shipment, delayType, delayMinutes, io) {
    const existing = await Notification.findOne({
      type: 'delivery_delayed',
      'data.shipmentId': shipment._id.toString(),
      'data.delayType': delayType,
      resolved: false
    });
    
    const title = delayType === 'departure' ? '⏰ Departure Delayed' : '⏰ Delivery Delayed';
    const message = `Shipment ${shipment.shipmentId} is delayed (${delayType}) by ${delayMinutes} minutes.`;
    
    if (existing) {
      // Update existing notification with new delay minutes (avoid spam)
      existing.data.delayMinutes = delayMinutes;
      existing.message = message;
      await existing.save();
      if (io) io.emit('notification', existing);
    } else {
      await notificationService.createNotification('delivery_delayed', {
        shipmentId: shipment.shipmentId,
        shipmentNumber: shipment.shipmentId,
        delayType: delayType,
        delayMinutes: delayMinutes,
        plannedDate: delayType === 'departure' ? shipment.plannedDepartureDate : shipment.plannedDeliveryDate,
        currentStatus: shipment.status,
        origin: shipment.origin,
        destination: shipment.destination
      }, io);
    }
  }
  
  /**
   * Manually resolve all delay notifications for a shipment once it's back on track.
   * Called when departure finally happens or delivery completes.
   */
  async resolveDelaysForShipment(shipmentId) {
    await Notification.updateMany(
      { 'data.shipmentId': shipmentId.toString(), type: 'delivery_delayed', resolved: false },
      { resolved: true, resolvedAt: new Date() }
    );
  }
}

module.exports = new DelayMonitoringService();
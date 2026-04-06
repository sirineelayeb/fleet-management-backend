const Notification = require('../models/Notification');
const User = require('../models/User');

class NotificationService {
  
  // Create and send notification
  async createNotification(type, data, io = null) {
    try {
      console.log(`📢 Creating notification: ${type}`);
      
      const notificationConfig = this.getNotificationConfig(type, data);
      
      const notification = new Notification({
        type: type,
        severity: notificationConfig.severity,
        title: notificationConfig.title,
        message: notificationConfig.message,
        data: data,
        targetRoles: notificationConfig.targetRoles || ['admin', 'shipment_manager'],
        sentAt: new Date()
      });
      
      const savedNotification = await notification.save();
      console.log(`✅ Notification saved: ${savedNotification._id}`);
      
      // Emit via WebSocket if io provided
      if (io) {
        io.emit('notification', savedNotification);
        
        // Emit to specific rooms based on severity
        if (savedNotification.severity === 'critical') {
          io.emit('critical-alert', savedNotification);
        }
        console.log(`📡 Notification emitted via WebSocket`);
      }
      
      return savedNotification;
      
    } catch (error) {
      console.error(`❌ Failed to create notification:`, error);
      return null;
    }
  }
  
  // Get notification configuration for each event type
  getNotificationConfig(type, data) {
    const configs = {
      // Gate Events
      access_denied: {
        severity: 'critical',
        title: '🚫 Access Denied',
        message: `Unauthorized truck ${data.licensePlate} attempted to ${data.accessType} at ${data.gateName}`,
        targetRoles: ['admin', 'shipment_manager']
      },
      gate_full: {
        severity: 'warning',
        title: '⚠️ Gate Full',
        message: `${data.gateName} is at full capacity (${data.currentQueue}/${data.queueCapacity})`,
        targetRoles: ['admin', 'shipment_manager']
      },
      after_hours_access: {
        severity: 'warning',
        title: '🕐 After Hours Access',
        message: `Truck ${data.licensePlate} requested ${data.accessType} outside operating hours at ${data.gateName}`,
        targetRoles: ['admin', 'shipment_manager']
      },
      
      // Truck Events
      speed_violation: {
        severity: 'warning',
        title: '🚨 Speed Violation',
        message: `Truck ${data.licensePlate} exceeded speed limit: ${data.speed} km/h at ${data.location}`,
        targetRoles: ['admin', 'shipment_manager']
      },
      maintenance_required: {
        severity: 'info',
        title: '🔧 Maintenance Required',
        message: `Truck ${data.licensePlate} requires maintenance. Status changed to maintenance.`,
        targetRoles: ['admin']
      },
      
      // Driver Events
      driver_score_changed: {
        severity: 'info',
        title: '⭐ Driver Score Updated',
        message: `Driver ${data.driverName} score changed from ${data.oldScore} to ${data.newScore}`,
        targetRoles: ['admin', 'shipment_manager']
      },
      
      // Shipment Events
      shipment_assigned: {  // ✅ ADD THIS
        severity: 'info',
        title: '📦 Shipment Assigned',
        message: `Shipment ${data.shipmentNumber || data.shipmentId} assigned to truck ${data.truckPlate} (Driver: ${data.driverName})`,
        targetRoles: ['admin', 'shipment_manager']
      },
      mission_started: {
        severity: 'info',
        title: '🚚 Mission Started',
        message: `Mission ${data.missionNumber} started for shipment from ${data.origin} to ${data.destination}`,
        targetRoles: ['shipment_manager']
      },
      mission_completed: {
        severity: 'info',
        title: '✅ Mission Completed',
        message: `Mission ${data.missionNumber} completed. Distance: ${data.distance}km, Duration: ${data.duration}h`,
        targetRoles: ['shipment_manager']
      },
      delivery_delayed: {
        severity: 'warning',
        title: '⏰ Delivery Delayed',
        message: `Shipment ${data.shipmentId} is delayed. Delay: ${data.delayMinutes} minutes`,
        targetRoles: ['admin', 'shipment_manager']
      },
      
      // Device Events
      device_offline: {
        severity: 'critical',
        title: '📡 Device Offline',
        message: `Device ${data.deviceId} has been offline for ${data.minutes} minutes. Truck: ${data.licensePlate}`,
        targetRoles: ['admin']
      },
      device_low_battery: {
        severity: 'warning',
        title: '🔋 Low Battery',
        message: `Device ${data.deviceId} battery at ${data.batteryLevel}%. Truck: ${data.licensePlate}`,
        targetRoles: ['admin']
      }
    };
    
    return configs[type] || {
      severity: 'info',
      title: 'Notification',
      message: 'New notification',
      targetRoles: ['admin', 'shipment_manager']
    };
  }
  
  // Get all notifications with filters
  async getNotifications(filters = {}, page = 1, limit = 50) {
    const query = {};
    
    if (filters.read !== undefined) query.read = filters.read === 'true';
    if (filters.severity) query.severity = filters.severity;
    if (filters.type) query.type = filters.type;
    if (filters.startDate) query.sentAt = { $gte: new Date(filters.startDate) };
    if (filters.endDate) query.sentAt = { ...query.sentAt, $lte: new Date(filters.endDate) };
    
    const skip = (page - 1) * limit;
    
    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments(query)
    ]);
    
    return { notifications, total, page, pages: Math.ceil(total / limit), limit };
  }
  
  // Mark notification as read
  async markAsRead(notificationId, userId) {
    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { 
        read: true, 
        readAt: new Date(),
        resolvedBy: userId
      },
      { new: true }
    );
    return notification;
  }
  
  // Mark all as read
  async markAllAsRead() {
    await Notification.updateMany({ read: false }, { read: true, readAt: new Date() });
    return { success: true };
  }
  
  // Get unread count
  async getUnreadCount(userRole = null) {
    const query = { read: false };
    
    // If user is shipment_manager, only show relevant notifications
    if (userRole === 'shipment_manager') {
      query.targetRoles = { $in: ['shipment_manager'] };
    }
    
    return await Notification.countDocuments(query);
  }
  
  // Resolve a notification (for critical alerts)
  async resolveNotification(notificationId, userId) {
    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { 
        resolved: true, 
        resolvedAt: new Date(),
        resolvedBy: userId
      },
      { new: true }
    );
    return notification;
  }
  
  // Delete notification (admin only)
  async deleteNotification(notificationId) {
    const notification = await Notification.findByIdAndDelete(notificationId);
    return notification;
  }
}

module.exports = new NotificationService();
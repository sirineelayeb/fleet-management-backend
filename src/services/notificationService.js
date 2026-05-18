const Notification = require('../models/Notification');

const formatDuration = (minutes) => {
  if (!minutes && minutes !== 0) return '0 min';
  
  // Less than 1 minute - show seconds
  if (minutes < 1) {
    const seconds = Math.round(minutes * 60);
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
  
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  
  if (h === 0) {
    return `${m} minute${m !== 1 ? 's' : ''}`;
  }
  if (m === 0) {
    return `${h} hour${h !== 1 ? 's' : ''}`;
  }
  return `${h} hour${h !== 1 ? 's' : ''} ${m} minute${m !== 1 ? 's' : ''}`;
};
function buildConfig(type, data) {
  const configs = {
    access_denied: {
      severity: 'critical',
      title: 'Access Denied',
      message: `Unauthorized truck ${data.licensePlate || 'Unknown'} attempted to ${data.accessType || 'access'} at ${data.gateName || 'gate'}. Reason: ${data.reason || 'Unknown'}`,
      targetRoles: ['admin'],
    },
    unknown_truck_detected: {
      severity: 'critical',
      title: 'Unknown Truck Detected',
      message: `Unregistered plate "${data.plateNumber || 'Unknown'}" detected at ${data.cameraId || 'gate'} (${data.direction || 'entry'}). No matching truck found.`,
      targetRoles: ['admin'],
    },
    truck_entry_late: {
      severity: 'warning',
      title: 'Truck Arrived Late',
      message: `Truck ${data.licensePlate || 'Unknown'} arrived ${data.minutesLate || 0} minutes late for shipment ${data.shipmentId || 'Unknown'}.`,
      targetRoles: ['admin'],
    },
    truck_wrong_zone: {
    severity: 'warning',
    title: 'Wrong Loading Zone',
    message: `Truck ${data.licensePlate || 'Unknown'} attempted to access ${data.gateName || 'gate'} but is assigned to a different loading zone (${data.assignedZoneName || 'Unknown'}).`,
    targetRoles: ['admin'],
    },
    speed_violation: {
      severity: 'warning',
      title: 'Speed Violation',
      message: `Truck ${data.licensePlate || 'Unknown'} exceeded speed limit (${data.currentSpeed || 0} km/h / limit ${data.speedLimit || 90} km/h).`,
      targetRoles: ['admin'],
    },
    maintenance_required: {
      severity: 'info',
      title: 'Maintenance Required',
      message: `Truck ${data.licensePlate || 'Unknown'} requires maintenance.`,
      targetRoles: ['admin'],
    },
    driver_score_changed: {
      severity: 'info',
      title: 'Driver Score Updated',
      message: `Driver ${data.driverName || 'Unknown'} score changed from ${data.oldScore ?? 0} to ${data.newScore ?? 0}.`,
      targetRoles: ['admin'],
    },
    shipment_assigned: {
      severity: 'info',
      title: 'Shipment Assigned',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} assigned to truck ${data.truckPlate || 'Unknown'} by ${data.assignedByName || 'system'}.`,
      targetRoles: ['admin'],
    },
    shipment_unassigned: {
      severity: 'info',
      title: 'Shipment Unassigned',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} has been unassigned from truck ${data.truckPlate || 'Unknown'}.`,
      targetRoles: ['admin'],
    },
    shipment_cancelled: {
      severity: 'warning',
      title: 'Shipment Cancelled',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} has been cancelled. Reason: ${data.reason || 'Not specified'}.`,
      targetRoles: ['admin'],
    },
    delivery_delayed: {
      severity: 'warning',
      title: 'Delivery Delayed',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} is delayed by ${data.delayMinutes || 0} minutes.`,
      targetRoles: ['admin'],
    },
    // device_offline: {
    //   severity: 'critical',
    //   title: 'Device Offline',
    //   message: `${data.deviceId || 'Unknown'} went offline`,
    //   targetRoles: ['admin'],
    // },
    // device_reconnected: {
    //   severity: 'info',
    //   title: 'Device Reconnected',
    //   message: `${data.deviceId || 'Unknown'} reconnected (offline ${formatDuration(data.gapMinutes || 0)})`,
    //   targetRoles: ['admin'],
    // },
    device_low_battery: {
      severity: 'warning',
      title: 'Low Battery',
      message: `${data.deviceId || 'Unknown'} battery is ${data.batteryLevel ?? 0}%`,
      targetRoles: ['admin'],
    },
    shipment_assigned_to_manager: {
      severity: 'info',
      title: 'New Shipment Assigned',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} assigned to you.`,
      targetRoles: [],
    },
    shipment_unassigned_from_manager: {
      severity: 'info',
      title: 'Shipment Unassigned',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} has been unassigned from you.`,
      targetRoles: [],
    },
    loading_completed: {
      severity: 'info',
      title: 'Loading Completed',
      message: `Loading completed for shipment ${data.shipmentNumber || 'Unknown'} in ${formatDuration(data.duration)}.`,
      targetRoles: ['admin'],
    },
    mission_started: {
      severity: 'info',
      title: 'Mission Started',
      message: `Mission ${data.missionNumber || 'Unknown'} started for truck ${data.truckPlate || 'Unknown'}.`,
      targetRoles: ['admin'],
    },
    mission_completed: {
      severity: 'info',
      title: 'Mission Completed',
      message: `Mission completed for shipment ${data.shipmentNumber || 'Unknown'}. Distance: ${data.distance ?? 0} km.`,
      targetRoles: ['admin'],
    },
  };

  return configs[type] || {
    severity: 'info',
    title: 'Notification',
    message: 'New notification received',
    targetRoles: ['admin'],
  };
}

const ADMIN_EXCLUDE_ACTOR = new Set([
  'shipment_assigned',
  'shipment_unassigned',
  'shipment_cancelled',
]);

const ADMIN_BROADCAST = new Set([
  'access_denied',
  'unknown_truck_detected',
  'truck_entry_late',
  'truck_wrong_zone',
  'speed_violation',
  'maintenance_required',
  'driver_score_changed',
  'delivery_delayed',
  'device_offline',
  'device_reconnected',
  'device_low_battery',
]);

const MANAGER_TARGETED = new Set([
  'shipment_assigned_to_manager',
  'shipment_unassigned_from_manager',
]);

const ADMIN_AND_MANAGER_TARGETED = new Set([
  'mission_started',
  'mission_completed',
  'loading_completed',
]);

class NotificationService {
  async createNotification(type, data, io = null, actorId = null) {
    try {
      const cfg = buildConfig(type, data);
      const saved = await Notification.create({
        type,
        severity: cfg.severity,
        title: cfg.title,
        message: cfg.message,
        data,
        targetRoles: cfg.targetRoles,
        sentAt: new Date(),
      });

      console.log(`✅ Notification saved [${type}] id=${saved._id}`);

      if (!io) {
        console.log('⚠️  No Socket.IO instance — notification persisted to DB only');
        return saved;
      }

      await this._emit(saved, cfg, type, data, io, actorId);
      return saved;
    } catch (err) {
      console.error('❌ createNotification failed:', err);
      return null;
    }
  }

  async _emit(saved, cfg, type, data, io, actorId) {
    const payload = { ...saved.toObject(), message: cfg.message };
    const rooms = io.sockets.adapter.rooms;

    if (MANAGER_TARGETED.has(type)) {
      if (!data.managerId) {
        console.warn(`⚠️  ${type}: data.managerId missing — skipping live emit`);
        return;
      }
      const room = `user_${data.managerId.toString()}`;
      if (rooms.has(room)) {
        io.to(room).emit('new_notification', payload);
        console.log(`[${type}] → manager room ${room}`);
      } else {
        console.log(`⚠️  [${type}] Manager ${room} not connected`);
      }
      return;
    }

    if (ADMIN_EXCLUDE_ACTOR.has(type)) {
      await this._emitToAdmins(io, payload, actorId, type);
      return;
    }

    if (ADMIN_BROADCAST.has(type)) {
      if (rooms.has('admin')) {
        io.to('admin').emit('new_notification', payload);
        console.log(`[${type}] → admin room (broadcast)`);
      }
      return;
    }

    if (ADMIN_AND_MANAGER_TARGETED.has(type)) {
      if (rooms.has('admin')) {
        io.to('admin').emit('new_notification', payload);
        console.log(`[${type}] → admin room`);
      }
      if (data.managerId) {
        const managerRoom = `user_${data.managerId}`;
        if (rooms.has(managerRoom)) {
          io.to(managerRoom).emit('new_notification', payload);
          console.log(`[${type}] → manager room ${managerRoom}`);
        } else {
          console.log(`⚠️  [${type}] Assigned manager ${managerRoom} not connected`);
        }
      } else {
        console.log(`⚠️  [${type}] No managerId — sent to admins only`);
      }
      return;
    }

    console.warn(`⚠️  [${type}] No routing rule matched — notification not emitted live`);
  }

  async _emitToAdmins(io, payload, actorId, type) {
    const adminSockets = await io.in('admin').fetchSockets();
    let sent = 0;
    for (const socket of adminSockets) {
      const socketUserId = socket.user?._id?.toString();
      if (actorId && socketUserId === actorId.toString()) {
        console.log(`🔕 [${type}] Skipping actor socket ${socket.id}`);
        continue;
      }
      socket.emit('new_notification', payload);
      sent++;
    }
    console.log(`[${type}] → ${sent} admin socket(s) (excluded actor: ${actorId || 'none'})`);
  }

  _buildRoleQuery(userRole, userId) {
    if (userRole === 'admin') {
      return { targetRoles: { $in: ['admin'] } };
    }
    if (userRole === 'shipment_manager' && userId) {
      return {
        $or: [
          { targetRoles: 'shipment_manager' },
          { 'data.managerId': userId.toString() },
        ],
      };
    }
    return { _id: null };
  }

  async getNotifications(filters = {}, page = 1, limit = 50, userRole = null, userId = null) {
    try {
      const query = this._buildRoleQuery(userRole, userId);
      if (filters.read !== undefined && filters.read !== '') query.read = filters.read === 'true';
      if (filters.severity) query.severity = filters.severity;
      if (filters.type) query.type = filters.type;
      if (filters.startDate) query.sentAt = { ...query.sentAt, $gte: new Date(filters.startDate) };
      if (filters.endDate) query.sentAt = { ...query.sentAt, $lte: new Date(filters.endDate) };

      const skip = (page - 1) * limit;
      const [notifications, total] = await Promise.all([
        Notification.find(query).sort({ sentAt: -1 }).skip(skip).limit(Number(limit)),
        Notification.countDocuments(query),
      ]);

      return {
        success: true,
        notifications,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
        limit: Number(limit),
      };
    } catch (err) {
      console.error('getNotifications error:', err);
      return { success: false, notifications: [], total: 0, page: 1, pages: 0, limit: 50 };
    }
  }

  async getUnreadCount(userRole = null, userId = null) {
    try {
      const query = { read: false, ...this._buildRoleQuery(userRole, userId) };
      return await Notification.countDocuments(query);
    } catch (err) {
      console.error('getUnreadCount error:', err);
      return 0;
    }
  }

  async markAsRead(notificationId, userId) {
    try {
      return await Notification.findByIdAndUpdate(
        notificationId,
        { read: true, readAt: new Date(), readBy: userId },
        { new: true }
      );
    } catch (err) {
      console.error('markAsRead error:', err);
      return null;
    }
  }

  async markAllAsRead(userRole, userId) {
    try {
      const query = { read: false, ...this._buildRoleQuery(userRole, userId) };
      const result = await Notification.updateMany(query, {
        read: true,
        readAt: new Date(),
        readBy: userId,
      });
      return { success: true, modifiedCount: result.modifiedCount };
    } catch (err) {
      console.error('markAllAsRead error:', err);
      return { success: false, modifiedCount: 0 };
    }
  }

  async resolveNotification(notificationId, userId) {
    try {
      return await Notification.findByIdAndUpdate(
        notificationId,
        { resolved: true, resolvedAt: new Date(), resolvedBy: userId },
        { new: true }
      );
    } catch (err) {
      console.error('resolveNotification error:', err);
      return null;
    }
  }

  async deleteNotification(notificationId, userRole) {
    try {
      if (userRole !== 'admin') throw new Error('Only admins can delete notifications');
      return await Notification.findByIdAndDelete(notificationId);
    } catch (err) {
      console.error('deleteNotification error:', err);
      return null;
    }
  }

  async deleteAllNotifications(userRole) {
    try {
      if (userRole !== 'admin') throw new Error('Only admins can delete all notifications');
      const result = await Notification.deleteMany({});
      return { success: true, deletedCount: result.deletedCount };
    } catch (err) {
      console.error('deleteAllNotifications error:', err);
      return { success: false, deletedCount: 0 };
    }
  }
}

module.exports = new NotificationService();
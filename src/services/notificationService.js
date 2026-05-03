const Notification = require('../models/Notification');

// ─────────────────────────────────────────────────────────────────────────────
// Static config map
// Keys that are absent from this map will fall through to the default handler.
// ─────────────────────────────────────────────────────────────────────────────
function buildConfig(type, data) {
  const configs = {
    // ── ADMIN-ONLY ────────────────────────────────────────────────────────────

    access_denied: {
      severity: 'critical',
      title: '🚫 Access Denied',
      message: `Unauthorised truck ${data.licensePlate || 'Unknown'} attempted to ${data.accessType || 'access'} at ${data.gateName || 'gate'}. Reason: ${data.reason || 'Unknown'}`,
      targetRoles: ['admin'],
    },
    unknown_truck_detected: {
      severity: 'critical',
      title: '🚨 Unknown Truck Detected',
      message: `Unregistered plate "${data.plateNumber || 'Unknown'}" detected at ${data.cameraId || 'gate'} (${data.direction || 'entry'}). No matching truck found.`,
      targetRoles: ['admin'],
    },
    truck_entry_late: {
      severity: 'warning',
      title: '⚠️ Truck Arrived Late',
      message: `Truck ${data.licensePlate || 'Unknown'} arrived ${data.minutesLate || 0} min after the planned departure for shipment ${data.shipmentId || 'Unknown'}.`,
      targetRoles: ['admin'],
    },
    speed_violation: {
      severity: 'warning',
      title: '🚨 Speed Violation',
      message: `Truck ${data.licensePlate || 'Unknown'} exceeded speed limit: ${data.currentSpeed || 0} km/h (limit: ${data.speedLimit || 90} km/h, excess: ${data.excessSpeed || 0} km/h).`,
      targetRoles: ['admin'],
    },
    maintenance_required: {
      severity: 'info',
      title: '🔧 Maintenance Required',
      message: `Truck ${data.licensePlate || 'Unknown'} requires maintenance.`,
      targetRoles: ['admin'],
    },
    driver_score_changed: {
      severity: 'info',
      title: '⭐ Driver Score Updated',
      message: `Driver ${data.driverName || 'Unknown'} score changed from ${data.oldScore ?? 0} to ${data.newScore ?? 0}.`,
      targetRoles: ['admin'],
    },

    // shipment_assigned / unassigned / cancelled → admin room only,
    // with the acting admin excluded at emit time (see _emitToAdmins).
    shipment_assigned: {
      severity: 'info',
      title: '📦 Shipment Assigned to Truck',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} assigned to truck ${data.truckPlate || 'Unknown'} by ${data.assignedByName || 'admin'}.`,
      targetRoles: ['admin'],
    },
    shipment_unassigned: {
      severity: 'info',
      title: '📦 Shipment Unassigned',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} has been unassigned from truck ${data.truckPlate || 'Unknown'}.`,
      targetRoles: ['admin'],
    },
    shipment_cancelled: {
      severity: 'warning',
      title: '❌ Shipment Cancelled',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} has been cancelled. Reason: ${data.reason || 'Not specified'}.`,
      targetRoles: ['admin'],
    },

    // delivery_delayed → ALL admins (no actor exclusion)
    delivery_delayed: {
      severity: 'warning',
      title: '⏰ Delivery Delayed',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} is delayed by ${data.delayMinutes || 0} min. Route: ${data.origin || '?'} → ${data.destination || '?'}.`,
      targetRoles: ['admin'],
    },

    device_offline: {
      severity: 'critical',
      title: '📡 Device Offline',
      message: `Device ${data.deviceId || 'Unknown'} has gone offline.`,
      targetRoles: ['admin'],
    },
    device_reconnected: {
    severity: 'info',
    title: '📡 Device Reconnected',
    message: `Device ${data.deviceId || 'Unknown'} is back online after ${data.gapMinutes || 0} min offline.`,
    targetRoles: ['admin'],
    },
    device_low_battery: {
      severity: 'warning',
      title: '🔋 Low Battery',
      message: `Device ${data.deviceId || 'Unknown'} battery at ${data.batteryLevel ?? 0}%.`,
      targetRoles: ['admin'],
    },

    // ── MANAGER-TARGETED (stored with targetRoles:[], matched via data.managerId) ─

    shipment_assigned_to_manager: {
      severity: 'info',
      title: '📋 New Shipment Assigned to You',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} has been assigned to you. Route: ${data.origin || '?'} → ${data.destination || '?'}. Assigned by: ${data.assignedBy || 'System'}.`,
      targetRoles: [], // manager-specific; matched by data.managerId
    },
    shipment_unassigned_from_manager: {
      severity: 'info',
      title: '📋 Shipment Unassigned from You',
      message: `Shipment ${data.shipmentNumber || 'Unknown'} has been unassigned from you. Route: ${data.origin || '?'} → ${data.destination || '?'}.`,
      targetRoles: [],
    },

    // ── ADMIN + MANAGER ───────────────────────────────────────────────────────

    loading_completed: {
      severity: 'info',
      title: '✅ Loading Completed',
      message: `Loading completed for shipment ${data.shipmentNumber || 'Unknown'} in ${data.duration ?? 0} min.`,
      targetRoles: ['admin'],
    },
    mission_started: {
    severity: 'info',
    title: '🚛 Mission Started',
    message: `Mission ${data.missionNumber || 'Unknown'} started for truck ${data.truckPlate || 'Unknown'}. Route: ${data.origin || '?'} → ${data.destination || '?'}.`,
    targetRoles: ['admin'],
  },
    mission_completed: {
      severity: 'info',
      title: '🏁 Mission Completed',
      message: `Mission completed for shipment ${data.shipmentNumber || 'Unknown'}. Distance: ${data.distance ?? 0} km.`,
      targetRoles: ['admin'],
    },
  };

  const cfg = configs[type];
  if (!cfg) {
    console.warn(`⚠️ Unknown notification type: "${type}" — using fallback config`);
    return {
      severity: 'info',
      title: 'Notification',
      message: 'New notification',
      targetRoles: ['admin'],
    };
  }
  return cfg;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing constants
// ─────────────────────────────────────────────────────────────────────────────

/** Admin-only, with the acting user excluded from the live emit. */
const ADMIN_EXCLUDE_ACTOR = new Set([
  'shipment_assigned',
  'shipment_unassigned',
  'shipment_cancelled',
]);

/** Admin-only, broadcast to ALL admins (no exclusion). */
const ADMIN_BROADCAST = new Set([
  'access_denied',
  'unknown_truck_detected',
  'truck_entry_late',
  'speed_violation',
  'maintenance_required',
  'driver_score_changed',
  'delivery_delayed',
  'device_offline',
  'device_reconnected',
  'device_low_battery',
]);

/** Sent only to the specific manager identified by data.managerId. */
const MANAGER_TARGETED = new Set([
  'shipment_assigned_to_manager',
  'shipment_unassigned_from_manager',
]);

/** Broadcast to all admins AND all shipment_managers. */
const ROLE_BROADCAST = new Set([
  // 'loading_completed',
  // 'mission_started',
  // 'mission_completed',
]);
/** Broadcast to all admins + one specific manager */
const ADMIN_AND_MANAGER_TARGETED = new Set([
  'mission_started',
  'mission_completed',
  'loading_completed',
]);
// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

class NotificationService {

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Create a notification, persist it, and emit it via Socket.IO.
   *
   * @param {string}   type          – must match a key in buildConfig
   * @param {object}   data          – payload embedded in the document
   * @param {object}   [io]          – Socket.IO server instance
   * @param {string}   [actorId]     – user who triggered the action (excluded
   *                                   from live emit for ADMIN_EXCLUDE_ACTOR types)
   */
  async createNotification(type, data, io = null, actorId = null) {
    try {
      const cfg = buildConfig(type, data);

      const saved = await Notification.create({
        type,
        severity:    cfg.severity,
        title:       cfg.title,
        message:     cfg.message,
        data,
        targetRoles: cfg.targetRoles,
        sentAt:      new Date(),
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

  // ── Socket.IO dispatch ─────────────────────────────────────────────────────

  async _emit(saved, cfg, type, data, io, actorId) {
    const payload = { ...saved.toObject(), message: cfg.message };
    const rooms   = io.sockets.adapter.rooms;

    // 1. Manager-targeted (one specific manager)
    if (MANAGER_TARGETED.has(type)) {
      if (!data.managerId) {
        console.warn(`⚠️  ${type}: data.managerId missing — skipping live emit`);
        return;
      }
      const room = `user_${data.managerId.toString()}`;
      if (rooms.has(room)) {
        io.to(room).emit('new_notification', payload);
        console.log(`📡 [${type}] → manager room ${room}`);
      } else {
        console.log(`⚠️  [${type}] Manager ${room} not connected`);
      }
      return;
    }

    // 2. Admin + exclude actor
    if (ADMIN_EXCLUDE_ACTOR.has(type)) {
      await this._emitToAdmins(io, payload, actorId, type);
      return;
    }

    // 3. Admin broadcast (no exclusion)
    if (ADMIN_BROADCAST.has(type)) {
      if (rooms.has('admin')) {
        io.to('admin').emit('new_notification', payload);
        console.log(`📡 [${type}] → admin room (broadcast)`);
      }
      return;
    }

    // 4. Role broadcast (admin + shipment_manager)
    if (ROLE_BROADCAST.has(type)) {
      for (const role of cfg.targetRoles) {
        if (rooms.has(role)) {
          io.to(role).emit('new_notification', payload);
          console.log(`📡 [${type}] → role room "${role}"`);
        }
      }
      return;
    }
    // 5. Admin broadcast + one specific manager
if (ADMIN_AND_MANAGER_TARGETED.has(type)) {
  // Send to all admins
  if (rooms.has('admin')) {
    io.to('admin').emit('new_notification', payload);
    console.log(`📡 [${type}] → admin room`);
  }

  // Send only to the assigned manager
  if (data.managerId) {
    const managerRoom = `user_${data.managerId}`;
    if (rooms.has(managerRoom)) {
      io.to(managerRoom).emit('new_notification', payload);
      console.log(`📡 [${type}] → manager room ${managerRoom}`);
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

  /**
   * Emit to every socket in the 'admin' room, skipping the actor.
   */
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

    console.log(`📡 [${type}] → ${sent} admin socket(s) (excluded actor: ${actorId || 'none'})`);
  }

  // ── DB queries ─────────────────────────────────────────────────────────────

  /**
   * Build the Mongo query that scopes notifications to a specific user.
   *
   *  - admin         : all notifications with targetRoles containing 'admin'
   *  - manager       : notifications targeting 'shipment_manager' role
   *                    OR targeted directly at this manager via data.managerId
   */
  _buildRoleQuery(userRole, userId) {
    if (userRole === 'admin') {
      return { targetRoles: { $in: ['admin'] } };
    }

    if (userRole === 'shipment_manager' && userId) {
      return {
        $or: [
          // Notifications explicitly targeted at all managers (e.g. shipment_assigned_to_manager)
          { targetRoles: 'shipment_manager' },
          // Notifications targeted at this specific manager via managerId
          { 'data.managerId': userId.toString() },
        ],
      };
    }

    return { _id: null };
  }
  async getNotifications(filters = {}, page = 1, limit = 50, userRole = null, userId = null) {
    try {
      const query = this._buildRoleQuery(userRole, userId);

      if (filters.read !== undefined && filters.read !== '')
        query.read = filters.read === 'true';
      if (filters.severity) query.severity = filters.severity;
      if (filters.type)     query.type     = filters.type;
      if (filters.startDate)
        query.sentAt = { ...query.sentAt, $gte: new Date(filters.startDate) };
      if (filters.endDate)
        query.sentAt = { ...query.sentAt, $lte: new Date(filters.endDate) };

      const skip = (page - 1) * limit;

      const [notifications, total] = await Promise.all([
        Notification.find(query).sort({ sentAt: -1 }).skip(skip).limit(Number(limit)),
        Notification.countDocuments(query),
      ]);

      return {
        success: true,
        notifications,
        total,
        page:  Number(page),
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
        read:   true,
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
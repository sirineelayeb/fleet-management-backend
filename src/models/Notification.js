const mongoose = require('mongoose');

/**
 * Notification types, grouped by audience:
 *
 *  ADMIN-ONLY
 *    access_denied             – LPR: unknown/unauthorised truck
 *    unknown_truck_detected    – LPR: plate not in system (camera feed)
 *    truck_entry_late          – LPR: truck arrived > 30 min after planned departure
 *    speed_violation           – real-time GPS
 *    maintenance_required      – manual status change
 *    driver_score_changed      – scoring engine
 *    shipment_assigned         – admin assigned truck to shipment  (excludes actor)
 *    shipment_unassigned       – admin removed truck from shipment (excludes actor)
 *    shipment_cancelled        – shipment cancelled               (excludes actor)
 *    device_offline            – IoT heartbeat
 *    device_low_battery        – IoT heartbeat
 *    delivery_delayed          – tracking engine → ALL admins
 *
 *  MANAGER-ONLY  (targeted by data.managerId, stored with targetRoles:[])
 *    shipment_assigned_to_manager    – a shipment was assigned to this manager
 *    shipment_unassigned_from_manager – a shipment was removed from this manager
 *
 *  ADMIN + MANAGER
 *    loading_completed         – LPR exit event
 *    mission_completed         – tracking engine
 */

const NOTIFICATION_TYPES = [
  // LPR
  'access_denied',
  'unknown_truck_detected',
  'truck_entry_late',
  'loading_completed',
  // Truck
  'speed_violation',
  'maintenance_required',
  // Driver
  'driver_score_changed',
  // Shipment / mission
  'shipment_assigned',
  'shipment_unassigned',
  'shipment_cancelled',
  'shipment_assigned_to_manager',
  'shipment_unassigned_from_manager',
  'mission_started',
  'mission_completed',
  'delivery_delayed',
  // Device
  'device_offline',
  'device_reconnected',
  'device_low_battery',
];

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    severity: {
      type: String,
      enum: ['critical', 'warning', 'info'],
      default: 'info',
    },
    title:   { type: String, required: true },
    message: { type: String, required: true },
    data:    { type: mongoose.Schema.Types.Mixed, default: {} },

    read:    { type: Boolean, default: false },
    readAt:  Date,
    readBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    sentAt:  { type: Date, default: Date.now },

    /**
     * targetRoles drives DB queries (who can *fetch* this notification).
     * For manager-specific notifications this is [] and we filter on
     * data.managerId instead.
     */
    targetRoles: [{ type: String, enum: ['admin', 'shipment_manager'] }],

    resolved:   { type: Boolean, default: false },
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

notificationSchema.index({ sentAt: -1 });
notificationSchema.index({ read: 1 });
notificationSchema.index({ severity: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ targetRoles: 1 });
notificationSchema.index({ 'data.managerId': 1 }); // manager-targeted queries

module.exports = mongoose.model('Notification', notificationSchema);
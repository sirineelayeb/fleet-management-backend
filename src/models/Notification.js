const mongoose = require('mongoose');
const notificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      // Gate events
      'access_denied',
      'gate_full',
      'after_hours_access',
      // Truck events
      'speed_violation',
      'maintenance_required',
      // Driver events
      'driver_score_changed',
      // Shipment events
      'shipment_assigned',
      'mission_started',
      'mission_completed',
      'delivery_delayed',
      // Device events
      'device_offline',
      'device_low_battery',
      // Loading events
      'loading_overtime'   
    ],
    required: true
  },
  severity: {
    type: String,
    enum: ['critical', 'warning', 'info'],
    default: 'info'
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  sentAt: {
    type: Date,
    default: Date.now
  },
  targetRoles: [{
    type: String,
    enum: ['admin', 'shipment_manager']
  }],
  resolved: {
    type: Boolean,
    default: false
  },
  resolvedAt: Date,
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

// Indexes
notificationSchema.index({ sentAt: -1 });
notificationSchema.index({ read: 1 });
notificationSchema.index({ severity: 1 });
notificationSchema.index({ type: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
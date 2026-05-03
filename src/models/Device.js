const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  truck:    { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', default: null },
  assignedAt: { type: Date, default: null },

  batteryLevel:    { type: Number, default: 100, min: 0, max: 100 },
  firmwareVersion: { type: String, default: '1.0.0' },
  lastSeen:        { type: Date, default: Date.now },
  temperature:     { type: Number },

  // Reflects actual connectivity, not just manually set
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance'],
    default: 'active'
  }
}, { timestamps: true });

deviceSchema.index({ deviceId: 1 });
deviceSchema.index({ truck: 1 });
deviceSchema.index({ status: 1 });
deviceSchema.index({ lastSeen: -1 });

deviceSchema.virtual('isOnline').get(function () {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.lastSeen > fiveMinutesAgo;
});

deviceSchema.pre('save', function (next) {
  // Sync status with actual connectivity
  if (this.isModified('lastSeen')) {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (this.status !== 'maintenance') {
      this.status = this.lastSeen > fiveMinutesAgo ? 'active' : 'inactive';
    }
  }

  // Track when truck assignment changes
  if (this.isModified('truck')) {
    this.assignedAt = this.truck ? new Date() : null;
  }

  next();
});

module.exports = mongoose.model('Device', deviceSchema);
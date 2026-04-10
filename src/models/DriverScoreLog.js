// Records every score change for a driver.

const mongoose = require('mongoose');

const driverScoreLogSchema = new mongoose.Schema({
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },
  changeAmount: { type: Number, required: true },   // positive or negative
  newScore: { type: Number, required: true },      // score after change
  reason: { type: String, required: true },        // e.g., 'on_time_delivery', 'late_delivery', 'manual_adjustment'
  remark: { type: String },                        // optional extra text (e.g., admin comment)
  mission: { type: mongoose.Schema.Types.ObjectId, ref: 'Mission' }, // if applicable
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },      // if manual adjustment
  createdAt: { type: Date, default: Date.now }
});

driverScoreLogSchema.index({ driver: 1, createdAt: -1 });

module.exports = mongoose.model('DriverScoreLog', driverScoreLogSchema);
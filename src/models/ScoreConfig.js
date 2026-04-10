// Store the points/penalties as configurable values (admin can change them later).

const mongoose = require('mongoose');

const scoreConfigSchema = new mongoose.Schema({
  onTimePoints: { type: Number, default: 5 },      // delivered exactly on day
  earlyPoints: { type: Number, default: 3 },       // delivered before planned day
  latePenalty: { type: Number, default: -10 },     // delivered after planned day
  // Optional: threshold for "early" (e.g., more than 1 hour before)
  earlyThresholdHours: { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model('ScoreConfig', scoreConfigSchema);
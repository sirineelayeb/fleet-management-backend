const mongoose = require('mongoose');

const scoreConfigSchema = new mongoose.Schema({
  onTimePoints: { type: Number, default: 5 },   // delivered exactly on planned day
  earlyPoints: { type: Number, default: 3 },    // delivered before planned day
  latePenalty: { type: Number, default: -10 },  // delivered after planned day
}, { timestamps: true });

module.exports = mongoose.model('ScoreConfig', scoreConfigSchema);
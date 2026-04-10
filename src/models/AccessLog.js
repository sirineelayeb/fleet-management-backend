const mongoose = require('mongoose');

const accessLogSchema = new mongoose.Schema({
  gate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Gate',
    required: true
  },
  truck: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Truck'
  },
  licensePlate: {
    type: String,
    required: true
  },
  accessType: {
    type: String,
    enum: ['entry', 'exit'],
    required: true
  },
  status: {
    type: String,
    enum: ['authorized', 'denied'],
    required: true
  },
  reason: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Indexes
accessLogSchema.index({ gate: 1, timestamp: -1 });
accessLogSchema.index({ truck: 1, timestamp: -1 });
accessLogSchema.index({ licensePlate: 1 });
accessLogSchema.index({ timestamp: 1 });

module.exports = mongoose.model('AccessLog', accessLogSchema);
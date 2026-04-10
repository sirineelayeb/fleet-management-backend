const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true
  },
  truck: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Truck'
  },
  type: {
    type: String,
    enum: ['gps', 'esp32', 'sim808'],
    default: 'gps'
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance'],
    default: 'active'
  },
  batteryLevel: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  firmwareVersion: {
    type: String,
    default: '1.0.0'
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('Device', deviceSchema);
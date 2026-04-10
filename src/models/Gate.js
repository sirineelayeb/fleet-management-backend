// Gate: The physical entry/exit point
const mongoose = require('mongoose');
const gateSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  type: { type: String, enum: ['entry', 'exit'], default: 'entry' },
  zone: { type: String, enum: ['A', 'B', 'C', 'D'], required: true },
  location: { lat: Number, lng: Number },
  radiusMeters: { type: Number, default: 30 },
  authorizedTrucks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Truck' }],
  queueCapacity: { type: Number, default: 30 },
  currentQueue: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  isLoadingZone: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Gate', gateSchema);
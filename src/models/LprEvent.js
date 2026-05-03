const mongoose = require('mongoose');

const lprEventSchema = new mongoose.Schema({
  plateNumber: {
    type:      String,
    required:  true,
    trim:      true,
    uppercase: true
  },
  direction: {
    type:     String,
    enum:     ['entry', 'exit'],
    required: true
  },
  cameraId: {
    type:    String,
    default: 'manual'
  },
  loadingZone: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'LoadingZone',
    default: null
  },
  confidence: {
    type:    Number,
    min:     0,
    max:     1,
    default: 1.0
  },
  source: {
    type:    String,
    enum:    ['manual', 'camera'],
    default: 'manual'
  },
  truck: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Truck',
    default: null
  },
  matchedShipment: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Shipment',
    default: null
  },
  isAuthorized: {
    type:    Boolean,
    default: null
  },

  // ── Timing analysis ──────────────────────────────────────
  entryStatus: {
    type:    String,
    default: null   // 'on_time' | 'late' | 'early' | null — no enum, allows null
  },
  minutesFromPlanned: {
    type:    Number,
    default: null
  }

}, { timestamps: true });

lprEventSchema.index({ plateNumber: 1, createdAt: -1 });
lprEventSchema.index({ direction: 1 });
lprEventSchema.index({ matchedShipment: 1, direction: 1 });
lprEventSchema.index({ isAuthorized: 1, createdAt: -1 });
lprEventSchema.index({ entryStatus: 1 });

module.exports = mongoose.model('LprEvent', lprEventSchema);
const mongoose = require('mongoose');

// ─── Helper ───────────────────────────────────────────────────────────────────
function normalizePlate(plate) {
  if (!plate) return plate;

  if (plate.includes('تونس')) {
    plate = plate.replace('تونس', 'TN');
  }

  const numbers = plate.replace(/[^0-9]/g, '');

  if (numbers.length >= 4) {
    const half = Math.floor(numbers.length / 2);
    return `${numbers.substring(0, half)} TN ${numbers.substring(half)}`;
  }

  return plate;
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const truckSchema = new mongoose.Schema({
  licensePlate: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },

  plateNumbers: { type: String, index: true },

  vin: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },

  brand: { type: String, required: true },
  model: { type: String, required: true },
  capacity: { type: Number, required: true },

  type: {
    type: String,
    enum: ['normal', 'refrigerated', 'fragile'],
    default: 'normal'
  },

  status: {
    type: String,
    enum: ['available', 'in_mission', 'maintenance'],
    default: 'available'
  },

  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    default: null
  }

}, { timestamps: true });


// ─── INDEXES ──────────────────────────────────────────────────────────────────
truckSchema.index({ licensePlate: 1 }, { unique: true });
truckSchema.index({ vin: 1 }, { unique: true, sparse: true });


// ─── NORMALIZATION ────────────────────────────────────────────────────────────
truckSchema.pre('validate', function (next) {
  if (this.licensePlate) {
    const normalized = normalizePlate(this.licensePlate);

    this.licensePlate = normalized;
    this.plateNumbers = normalized.replace(/[^0-9]/g, '');
  }
  next();
});


// ─── DUPLICATE CHECK (EXTRA SAFETY) ───────────────────────────────────────────
truckSchema.pre('save', async function (next) {
  const existing = await mongoose.models.Truck.findOne({
    licensePlate: this.licensePlate,
    _id: { $ne: this._id }
  });

  if (existing) {
    return next(new Error('License plate already exists'));
  }

  if (this.vin) {
    const vinExists = await mongoose.models.Truck.findOne({
      vin: this.vin,
      _id: { $ne: this._id }
    });

    if (vinExists) {
      return next(new Error('VIN already exists'));
    }
  }

  next();
});


// ─── SEARCH ───────────────────────────────────────────────────────────────────
truckSchema.statics.findByPlate = function (plate) {
  const normalized = normalizePlate(plate);
  const numbers = normalized.replace(/[^0-9]/g, '');

  return this.findOne({
    $or: [
      { licensePlate: normalized },
      { plateNumbers: numbers }
    ]
  });
};


// ─── EXPORT ───────────────────────────────────────────────────────────────────
module.exports = mongoose.model('Truck', truckSchema);
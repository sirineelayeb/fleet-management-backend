const mongoose = require('mongoose');

// Helper: Normalize Tunisian license plates
const normalizePlate = (plate) => {
  if (!plate) return plate;
  const numbers = plate.replace(/[^0-9]/g, '');
  if (numbers.length >= 4) {
    const half = Math.floor(numbers.length / 2);
    return `${numbers.substring(0, half)} TN ${numbers.substring(half)}`;
  }
  return plate;
};

const truckSchema = new mongoose.Schema({
  licensePlate: { type: String, required: true, unique: true },
  brand: { type: String, required: true },
  model: { type: String, required: true },
  year: Number,
  capacity: { type: Number, required: true },
  type: {
    type: String,
    enum: ['normal', 'refrigerated', 'fragile'],
    default: 'normal'
  },
  status: {
    type: String,
    enum: ['available', 'in_mission', 'maintenance', 'inactive'],
    default: 'available'
  },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
  devices: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Device' }],
  
  currentLocation: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  
  currentSpeed: { type: Number, default: 0 },
  speedLimit: { type: Number, default: 90, min: 0, max: 150 },
  lastSpeedUpdate: { type: Date, default: Date.now },
  lastTelemetryAt: { type: Date },
  vin: String
}, { timestamps: true });

// Pre-save middleware
truckSchema.pre('save', function(next) {
  if (this.licensePlate) this.licensePlate = normalizePlate(this.licensePlate);
  if (this.vin) this.vin = this.vin.toUpperCase();
  next();
});

module.exports = mongoose.model('Truck', truckSchema);
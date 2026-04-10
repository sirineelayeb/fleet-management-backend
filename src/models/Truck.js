const mongoose = require('mongoose');

// ─── Helper ───────────────────────────────────────────────────────────────────
function formatTunisianPlate(plate) {
  if (!plate) return plate;
  if (plate.includes(' TN ')) return plate;
  if (plate.includes('تونس')) return plate.replace('تونس', 'TN');

  const numbers = plate.replace(/[^0-9]/g, '');
  if (numbers.length >= 4) {
    const half = Math.floor(numbers.length / 2);
    return `${numbers.substring(0, half)} TN ${numbers.substring(half)}`;
  }
  return plate;
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const truckSchema = new mongoose.Schema({
  // Identity
  licensePlate: { type: String, required: true, unique: true, trim: true },
  displayPlate: { type: String, trim: true },
  plateNumbers: { type: String, index: true },

  // Vehicle info
  brand: { type: String, required: true },
  model: { type: String, required: true },
  year: { type: Number },
  capacity: { type: Number, required: true },
  
  // Truck type
  type: {
    type: String,
    enum: ['normal', 'refrigerated', 'fragile'],
    default: 'normal'
  },

  // Operational state
  status: {
    type: String,
    enum: ['available', 'in_mission', 'maintenance'],
    default: 'available'
  },
  
  // References
  driver: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Driver',
    index: true
  },
  devices: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Device' }],


  // Location & Telemetry
  currentLocation: {
    lat: Number,
    lng: Number
  },
  currentSpeed: {
    type: Number,
    default: 0,
    min: 0
  },
  lastTelemetryAt: Date

}, { timestamps: true });

// ─── Indexes ──────────────────────────────────────────────────────────────────
truckSchema.index({ licensePlate: 1 });
truckSchema.index({ status: 1 });
truckSchema.index({ type: 1 });
truckSchema.index({ driver: 1 });

// ─── Middleware ───────────────────────────────────────────────────────────────
truckSchema.pre('save', function (next) {
  if (this.driver === '') this.driver = null;
  
  if (this.licensePlate) {
    this.displayPlate = formatTunisianPlate(this.licensePlate);
    this.plateNumbers = this.licensePlate.replace(/[^0-9]/g, '');

    if (/^\d+$/.test(this.licensePlate) && this.plateNumbers.length >= 4) {
      const numbers = this.plateNumbers;
      const half = Math.floor(numbers.length / 2);
      this.licensePlate = `${numbers.substring(0, half)} TN ${numbers.substring(half)}`;
    } else if (this.licensePlate.includes(' TN ')) {
      const parts = this.licensePlate.split(' TN ');
      if (parts.length === 2) {
        const left = parts[0].trim().replace(/\s/g, '');
        const right = parts[1].trim().replace(/\s/g, '');
        this.licensePlate = `${left} TN ${right}`;
      }
    }
  }
  
  next();
});

truckSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();
  
  if (update.licensePlate) {
    const numbers = update.licensePlate.replace(/[^0-9]/g, '');
    update.plateNumbers = numbers;
    update.displayPlate = formatTunisianPlate(update.licensePlate);

    if (/^\d+$/.test(update.licensePlate) && numbers.length >= 4) {
      const half = Math.floor(numbers.length / 2);
      update.licensePlate = `${numbers.substring(0, half)} TN ${numbers.substring(half)}`;
    }
  }
  
  next();
});

// ─── Methods ──────────────────────────────────────────────────────────────────
truckSchema.methods.getFormattedPlate = function () {
  return this.displayPlate || formatTunisianPlate(this.licensePlate);
};

truckSchema.methods.isCompatibleWithShipment = function(shipment) {
  if (shipment.weightKg > this.capacity) {
    return { compatible: false, reason: 'Insufficient capacity' };
  }
  
  const compatibleTypes = {
    'normal': ['normal'],
    'refrigerated': ['normal', 'refrigerated'],
    'fragile': ['normal', 'fragile']
  };
  
  if (!compatibleTypes[shipment.shipmentType].includes(this.type)) {
    return { compatible: false, reason: `Truck type '${this.type}' cannot handle '${shipment.shipmentType}' shipments` };
  }
  
  if (this.status !== 'available') {
    return { compatible: false, reason: `Truck is ${this.status}` };
  }
  
  return { compatible: true };
};

truckSchema.statics.findByPlate = function (plate) {
  const numbers = plate.replace(/[^0-9]/g, '');
  return this.findOne({
    $or: [
      { licensePlate: plate },
      { displayPlate: plate },
      { plateNumbers: numbers },
      { licensePlate: { $regex: numbers, $options: 'i' } }
    ]
  });
};

truckSchema.statics.findCompatibleTrucks = async function(shipment) {
  const compatibleTypes = {
    'normal': ['normal'],
    'refrigerated': ['normal', 'refrigerated'],
    'fragile': ['normal', 'fragile']
  };
  
  return await this.find({
    status: 'available',
    capacity: { $gte: shipment.weightKg },
    type: { $in: compatibleTypes[shipment.shipmentType] },
    driver: { $ne: null }
  }).populate('driver', 'name phone score');
};

module.exports = mongoose.model('Truck', truckSchema);
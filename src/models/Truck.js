const mongoose = require('mongoose');

// Helper: Format Tunisian license plate for display
function formatTunisianPlate(plate) {
  if (!plate) return plate;
  if (plate.includes(' TN ') || plate.includes('تونس')) return plate;
  
  const numbers = plate.replace(/[^0-9]/g, '');
  if (numbers.length >= 4) {
    const half = Math.floor(numbers.length / 2);
    return `${numbers.substring(0, half)} TN ${numbers.substring(half)}`;
  }
  return plate;
}

// Schema Definition
const truckSchema = new mongoose.Schema({
  // Identity
  licensePlate: { type: String, required: true, unique: true, trim: true },
  displayPlate: { type: String, trim: true },
  plateNumbers: { type: String, index: true },
  vin: { type: String, unique: true, sparse: true, trim: true, uppercase: true }, 
  
  // Vehicle Information
  brand: { type: String, required: true },
  model: { type: String, required: true },
  year: { type: Number },
  capacity: { type: Number, required: true }, // in kg or tons (your choice)
  
  // Truck Type
  type: {
    type: String,
    enum: ['normal', 'refrigerated', 'fragile'],
    default: 'normal'
  },
  
  // Status
  status: {
    type: String,
    enum: ['available', 'in_mission', 'maintenance', 'inactive'], // Added 'inactive'
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
  currentSpeed: { type: Number, default: 0, min: 0 },
  lastTelemetryAt: Date
  
}, { timestamps: true });

// Indexes
truckSchema.index({ licensePlate: 1 });
truckSchema.index({ status: 1 });
truckSchema.index({ type: 1 });
truckSchema.index({ driver: 1 });
truckSchema.index({ vin: 1 }); 

// Middleware: Before Save
truckSchema.pre('save', function(next) {
  if (this.driver === '') this.driver = null;
  
  if (this.vin) {
    this.vin = this.vin.toUpperCase();
  }
  
  if (this.licensePlate) {
    this.plateNumbers = this.licensePlate.replace(/[^0-9]/g, '');
    this.displayPlate = formatTunisianPlate(this.licensePlate);
  }
  
  next();
});

// Middleware: Before Update
truckSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  if (update.vin) {
    update.vin = update.vin.toUpperCase();
  }
  
  if (update.licensePlate) {
    update.plateNumbers = update.licensePlate.replace(/[^0-9]/g, '');
    update.displayPlate = formatTunisianPlate(update.licensePlate);
  }
  
  next();
});

// Instance Methods
truckSchema.methods.getFormattedPlate = function() {
  return this.displayPlate || formatTunisianPlate(this.licensePlate);
};

truckSchema.methods.isCompatibleWithShipment = function(shipment) {
  // Check capacity
  if (shipment.weightKg > this.capacity) {
    return { compatible: false, reason: `Insufficient capacity (need ${shipment.weightKg}kg, have ${this.capacity}kg)` };
  }
  
  // Check type compatibility
  const typeCompatibility = {
    'normal': ['normal'],
    'refrigerated': ['normal', 'refrigerated'],
    'fragile': ['normal', 'fragile']
  };
  
  if (!typeCompatibility[this.type].includes(shipment.shipmentType)) {
    return { compatible: false, reason: `Truck type '${this.type}' cannot handle '${shipment.shipmentType}' shipments` };
  }
  
  // Check status
  if (this.status !== 'available') {
    return { compatible: false, reason: `Truck is ${this.status}` };
  }
  
  return { compatible: true };
};

// Static Methods
truckSchema.statics.findByPlate = function(plate) {
  const numbers = plate.replace(/[^0-9]/g, '');
  return this.findOne({
    $or: [
      { licensePlate: plate },
      { displayPlate: plate },
      { plateNumbers: numbers }
    ]
  });
};

truckSchema.statics.findCompatibleTrucks = async function(shipment) {
  const typeCompatibility = {
    'normal': ['normal'],
    'refrigerated': ['normal', 'refrigerated'],
    'fragile': ['normal', 'fragile']
  };
  
  return this.find({
    status: 'available',
    capacity: { $gte: shipment.weightKg },
    type: { $in: typeCompatibility[shipment.shipmentType] },
    driver: { $ne: null }
  }).populate('driver', 'name phone score');
};

// Export
module.exports = mongoose.model('Truck', truckSchema);
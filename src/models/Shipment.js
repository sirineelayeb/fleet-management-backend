const mongoose = require('mongoose');

const shipmentSchema = new mongoose.Schema({
  shipmentId: {
    type: String,
    unique: true,
    default: () => `SHP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  },
  description: { type: String, required: true },
  origin: { type: String, required: true },
  destination: { type: String, required: true },
  destinationCoordinates: {
    lat: { type: Number },
    lng: { type: Number }
  },
  originCoordinates: {
  lat: { type: Number },
  lng: { type: Number }
  },
  weightKg: { type: Number, required: true, min: 0 },
  shipmentType: {
    type: String,
    enum: ['normal', 'refrigerated', 'fragile'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  truck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck' },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
  customer: {
    name: String,
    phone: String
  },
  isPriority: { type: Boolean, default: false },

  // ============================================================
  // SCHEDULING FIELDS (added for admin): planned dates for departure and delivery set by shipment manager during assignment or later adjustments
  // ============================================================
  plannedDepartureDate: { type: Date, required: true },
  plannedDeliveryDate: { 
    type: Date, 
    required: true,
    validate: {
      validator: function(value) {
        return this.plannedDepartureDate ? value > this.plannedDepartureDate : true;
      },
      message: 'Planned delivery date must be after planned departure date'
    }
  },
  actualDepartureDate: { type: Date },   // when truck actually leaves origin
  actualDeliveryDate: { type: Date },    // when goods actually reach customer

  // ============================================================
  // LOADING DURATION CONTROL (added for admin)
  // ============================================================
  plannedLoadingDurationMinutes: { type: Number, default: 60 }, 
  actualLoadingDurationMinutes: { type: Number, default: 0 },     // auto-calculated via gate
  loadingStartedAt: { type: Date },                               // when truck enters loading gate
  loadingCompletedAt: { type: Date },
  createdBy: {
  type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }                            
}, { timestamps: true });

// Indexes
shipmentSchema.index({ status: 1 });
shipmentSchema.index({ shipmentType: 1 });
shipmentSchema.index({ plannedDepartureDate: 1, status: 1 });
shipmentSchema.index({ plannedDeliveryDate: 1, status: 1 });
shipmentSchema.index({ createdBy: 1, status: 1 });
module.exports = mongoose.model('Shipment', shipmentSchema);
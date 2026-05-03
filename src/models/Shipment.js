const mongoose = require('mongoose');

const shipmentSchema = new mongoose.Schema({
  shipmentId: {
    type: String,
    unique: true,
    default: () => `SHP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  },
  description: { type: String, required: true },
  goods:       { type: String, required: true },

  origin:      { type: String, required: true },
  destination: { type: String, required: true },
  originCoordinates: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  destinationCoordinates: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  delayNotified: { type: Boolean, default: false },

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

  truck:       { type: mongoose.Schema.Types.ObjectId, ref: 'Truck',        default: null },
  driver:      { type: mongoose.Schema.Types.ObjectId, ref: 'Driver',       default: null },
  customer:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer',     required: true },
  loadingZone: { type: mongoose.Schema.Types.ObjectId, ref: 'LoadingZone',  default: null },

  isPriority: { type: Boolean, default: false },

  plannedDepartureDate: { type: Date, required: true },
  plannedDeliveryDate: {
    type: Date,
    required: true,
    validate: {
      validator: function (value) {
        return this.plannedDepartureDate ? value > this.plannedDepartureDate : true;
      },
      message: 'Planned delivery date must be after planned departure date'
    }
  },
  actualDepartureDate: { type: Date, default: null },
  actualDeliveryDate:  { type: Date, default: null },

  notes: [{
    content:       String,
    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: String,
    createdAt:     { type: Date, default: Date.now }
  }],

  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  cancellationReason: { type: String, default: null }

}, { timestamps: true });

// Indexes
shipmentSchema.index({ status: 1 });
shipmentSchema.index({ customer: 1 });
shipmentSchema.index({ createdBy: 1 });
shipmentSchema.index({ assignedTo: 1 });
shipmentSchema.index({ shipmentType: 1 });
shipmentSchema.index({ plannedDepartureDate: 1 });
shipmentSchema.index({ createdAt: -1 });
shipmentSchema.index({ plannedDeliveryDate: 1, status: 1 });

module.exports = mongoose.model('Shipment', shipmentSchema);
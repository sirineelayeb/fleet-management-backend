const mongoose = require('mongoose');

const tripHistorySchema = new mongoose.Schema({
  mission: { type: mongoose.Schema.Types.ObjectId, ref: 'Mission', required: true },
  shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', required: true },
  truck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', required: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },

  tripNumber: {
    type: String,
    unique: true,
    default: () => `TRIP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  },

  // Human-readable addresses
  origin: { type: String, required: true },
  destination: { type: String, required: true },

  // GeoJSON Points – set only when trip is completed (from first/last GPS point)
  originCoordinates: {
    type: { type: String, enum: ['Point'] },
    coordinates: [Number] // [lng, lat]
  },
  destinationCoordinates: {
    type: { type: String, enum: ['Point'] },
    coordinates: [Number]
  },

  // Planned metrics
  plannedDistanceKm: { type: Number, default: 0 },
  plannedDurationHours: { type: Number, default: 0 },

  // Actual metrics
  actualDistanceKm: { type: Number, default: 0 },
  actualDurationHours: { type: Number, default: 0 },
  averageSpeed: { type: Number, default: 0 },
  maxSpeed: { type: Number, default: 0 },
  fuelConsumption: { type: Number, default: null },
  averageFuelEfficiency: { type: Number, default: null },

  // Timeline
  startTime: { type: Date},      // trip creation / assignment time
  actualStartTime: { type: Date },                  // when truck first moves (speed > 5)
  endTime: { type: Date },

  // Full route as GeoJSON LineString – set only at completion
  routePath: {
    type: { type: String, enum: ['LineString'] },
    coordinates: { type: [[Number]], default: [] }
  },

  status: {
    type: String,
    enum: ['planned', 'in_progress', 'completed', 'cancelled'],
    default: 'planned'
  }
}, { timestamps: true });

// Indexes
tripHistorySchema.index({ truck: 1, startTime: -1 });
tripHistorySchema.index({ driver: 1, startTime: -1 });
tripHistorySchema.index({ status: 1 });
tripHistorySchema.index({ originCoordinates: '2dsphere' }, { sparse: true });
tripHistorySchema.index({ destinationCoordinates: '2dsphere' }, { sparse: true });
tripHistorySchema.index({ routePath: '2dsphere' }, { sparse: true });

module.exports = mongoose.model('TripHistory', tripHistorySchema);
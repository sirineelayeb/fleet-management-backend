/* Real-Time Tracking */
const mongoose = require('mongoose');

const locationHistorySchema = new mongoose.Schema({
  truck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', required: true },
  trip: { type: mongoose.Schema.Types.ObjectId, ref: 'TripHistory' },
  mission: { type: mongoose.Schema.Types.ObjectId, ref: 'Mission' },
  location: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true } // [lng, lat]
  },
  speed: { type: Number, default: 0 },
  heading: { type: Number, default: 0 },
  batteryLevel: { type: Number },
  temperature: { type: Number },
  timestamp: { type: Date, default: Date.now, index: true },
  source: { type: String, default: 'device' }
});

locationHistorySchema.index({ location: '2dsphere' });
locationHistorySchema.index({ truck: 1, timestamp: -1 });
locationHistorySchema.index({ trip: 1, timestamp: 1 });
locationHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

module.exports = mongoose.model('LocationHistory', locationHistorySchema);
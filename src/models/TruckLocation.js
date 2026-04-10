const mongoose = require('mongoose');

const truckLocationSchema = new mongoose.Schema({

  truck: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Truck',
    required: true
  },

  location: {
    type:        { type: String, enum: ['Point'], default: 'Point' }, // default not required — Mongoose needs this
    coordinates: { type: [Number], required: true }
  },

  speed:   { type: Number, default: 0, min: 0 },          // min: 0 — speed can't be negative
  heading: { type: Number, default: null, min: 0, max: 360 }, // degrees, null = not reported

  // Raw WiFi signals — collected now, used later for positioning ML
  wifiSignals: [{
    ssid:  { type: String },                 // optional — hidden networks don't broadcast it
    bssid: { type: String, required: true }, // unique AP identifier
    rssi:  { type: Number, required: true }  // signal strength in dBm (negative number)
  }],

  timestamp: { type: Date, default: Date.now, required: true }

}, { timestamps: false }); // timestamps: false — we manage timestamp ourselves

// ─── Indexes ──────────────────────────────────────────────────────────────────

truckLocationSchema.index({ location: '2dsphere' });
truckLocationSchema.index({ truck: 1, timestamp: -1 }); // fastest query: latest ping per truck

// TTL — auto-delete pings older than 90 days
truckLocationSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 }
);

module.exports = mongoose.model('TruckLocation', truckLocationSchema);
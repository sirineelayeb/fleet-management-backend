const mongoose = require('mongoose');

const loadingZoneSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  location: {
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  placeName: { type: String, default: '' }  // add this
},
  radiusMeters: { type: Number, default: 30, required: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('LoadingZone', loadingZoneSchema);
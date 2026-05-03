const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String },
  email: { type: String },
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    placeName: { type: String, default: '' } // Human-readable address
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Index for geo queries (optional)
customerSchema.index({ 'location.lat': 1, 'location.lng': 1 });

module.exports = mongoose.model('Customer', customerSchema);
const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  licenseNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
  photo: {
  url: String,
  filename: String,
  uploadedAt: Date
},
  
  status: {
    type: String,
    enum: ['available', 'busy', 'off_duty'],
    default: 'available'
  },
  
  score: { type: Number, min: 0, max: 100, default: 100 },
  hireDate: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  
  assignedTruck: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Truck',
    default: null
  }
  
}, { timestamps: true });

// Indexes
driverSchema.index({ status: 1 });
driverSchema.index({ phone: 1 });
driverSchema.index({ licenseNumber: 1 });
driverSchema.index({ score: -1 });
driverSchema.index({ assignedTruck: 1 });

module.exports = mongoose.model('Driver', driverSchema);
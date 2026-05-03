const mongoose = require('mongoose');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

// ============================================
// VALIDATORS
// ============================================

const validatePhone = (v) => {
  if (!v) return false;
  const parsed = parsePhoneNumberFromString(v, { extract: false });
  return parsed ? parsed.isValid() : false;
};

// ============================================
// SCHEMA
// ============================================

const driverSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────
    name: {
      type: String,
      required: [true, 'Driver name is required'],
      trim: true,
    },
    cin: {
      type: String,
      required: [true, 'CIN is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    licenseNumber: {
      type: String,
      required: [true, 'License number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },

    // ── Contact ──────────────────────────────
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      trim: true,
      validate: {
        validator: validatePhone,
        message: 'Invalid phone number. Include country code (e.g. +21623456789).',
      },
    },
    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true,   // allows multiple null/missing emails without unique conflicts
      trim: true,
      lowercase: true,
    },

    // ── Photo ────────────────────────────────
    photo: {
      url:        { type: String },
      filename:   { type: String },
      uploadedAt: { type: Date },
    },

    // ── Status & Performance ─────────────────
    status: {
      type: String,
      enum: ['available', 'busy', 'off_duty'],
      default: 'available',
    },
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },

    // ── Employment ───────────────────────────
    hireDate: { type: Date, default: Date.now },
    isActive:  { type: Boolean, default: true },

    // ── Relations ────────────────────────────
    assignedTruck: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Truck',
      default: null,
    },
  },
  { timestamps: true }
);

// ============================================
// INDEXES
// ============================================

driverSchema.index({ cin: 1 });
driverSchema.index({ phone: 1 });
driverSchema.index({ licenseNumber: 1 });
driverSchema.index({ status: 1 });
driverSchema.index({ score: -1 });
driverSchema.index({ assignedTruck: 1 });

// ============================================
// MIDDLEWARE
// ============================================

driverSchema.pre('save', function (next) {
  // Strip non-digit characters from CIN
  if (this.cin) {
    this.cin = this.cin.replace(/\D/g, '');
  }

  // Normalize license number
  if (this.licenseNumber) {
    this.licenseNumber = this.licenseNumber.toUpperCase().trim();
  }

  // Normalize phone to E.164 format (+21623456789)
  if (this.phone) {
    const parsed = parsePhoneNumberFromString(this.phone, { extract: false });
    if (parsed?.isValid()) {
      this.phone = parsed.format('E.164');
    }
  }

  next();
});

// ============================================
// MODEL
// ============================================

module.exports = mongoose.model('Driver', driverSchema);
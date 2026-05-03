const mongoose = require('mongoose');

const missionSchema = new mongoose.Schema({
  missionNumber: {
    type: String,
    unique: true,
    default: function () {
      const now   = new Date();
      const year  = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const random = Math.random().toString(36).substring(2, 8).toUpperCase();
      return `MSN-${year}${month}-${random}`;
    }
  },
  shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', required: true },
  truck:    { type: mongoose.Schema.Types.ObjectId, ref: 'Truck',    required: true },
  driver:   { type: mongoose.Schema.Types.ObjectId, ref: 'Driver',   required: true },
  startTime: Date,
  endTime:   Date,
  status: {
    type: String,
    enum: ['not_started', 'in_progress', 'completed', 'cancelled'],
    default: 'not_started'
  }
}, { timestamps: true });

missionSchema.index({ status: 1 });
missionSchema.index({ truck: 1, status: 1 });
missionSchema.index({ missionNumber: 1 });
missionSchema.index(
  { shipment: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['not_started', 'in_progress'] }
    }
  }
);

module.exports = mongoose.model('Mission', missionSchema);
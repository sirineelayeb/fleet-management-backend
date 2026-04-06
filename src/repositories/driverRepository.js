const Driver = require('../models/Driver');

class DriverRepository {
  async findAll(filters = {}, options = {}) {
    const { sort = '-createdAt', limit = 100, skip = 0, populate = true } = options;
    
    let query = Driver.find(filters).sort(sort).limit(limit).skip(skip);
    
    if (populate) {
      query = query.populate('assignedTruck', 'licensePlate brand model status');
    }
    
    return await query.exec();
  }

  async findById(id, populate = true) {
    let query = Driver.findById(id);
    if (populate) {
      query = query.populate('assignedTruck', 'licensePlate brand model status');
    }
    return await query.exec();
  }

  async findOne(filter) {
    return await Driver.findOne(filter).exec();
  }

  async create(data) {
    const driver = new Driver(data);
    return await driver.save();
  }

  async update(id, data) {
    return await Driver.findByIdAndUpdate(
      id,
      { ...data, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).populate('assignedTruck', 'licensePlate brand model status');
  }

  async delete(id) {
    return await Driver.findByIdAndDelete(id).exec();
  }

  async count(filters = {}) {
    return await Driver.countDocuments(filters).exec();
  }

  async getStats() {
    const stats = await Driver.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgRating: { $avg: '$performance.rating' },
          totalTrips: { $sum: '$performance.totalTrips' },
          onTimeDeliveries: { $sum: '$performance.onTimeDelivery' }
        }
      }
    ]);
    
    return stats;
  }

  async findExpiringDocuments(daysThreshold = 30) {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
    
    return await Driver.find({
      $or: [
        { 'documents.driverLicense.expiryDate': { $lte: thresholdDate, $gte: new Date() } },
        { 'documents.insurance.expiryDate': { $lte: thresholdDate, $gte: new Date() } },
        { 'documents.vehicleRegistration.expiryDate': { $lte: thresholdDate, $gte: new Date() } },
        { 'documents.medicalCertificate.expiryDate': { $lte: thresholdDate, $gte: new Date() } }
      ]
    }).populate('assignedTruck', 'licensePlate brand model');
  }

  async findAvailableDrivers() {
    return await this.findAll({
      status: 'active',
      assignedTruck: null
    });
  }

  async updatePerformance(id, tripData) {
    const driver = await this.findById(id, false);
    if (!driver) return null;
    
    const totalTrips = driver.performance.totalTrips + 1;
    const onTimeDelivery = driver.performance.onTimeDelivery + (tripData.onTime ? 1 : 0);
    const rating = ((driver.performance.rating * driver.performance.totalTrips) + tripData.rating) / totalTrips;
    
    return await this.update(id, {
      'performance.totalTrips': totalTrips,
      'performance.onTimeDelivery': onTimeDelivery,
      'performance.rating': rating
    });
  }
}

module.exports = new DriverRepository();
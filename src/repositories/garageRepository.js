const Garage = require('../models/Garage');
const AccessLog = require('../models/AccessLog');

class GarageRepository {
  async findAll(filters = {}) {
    return await Garage.find(filters)
      .populate('authorizedTrucks', 'licensePlate displayPlate brand model status')
      .sort({ createdAt: -1 });
  }

  async findById(id) {
    return await Garage.findById(id)
      .populate('authorizedTrucks', 'licensePlate displayPlate brand model status type capacity');
  }

  async findByName(name) {
    return await Garage.findOne({ name });
  }

  async create(garageData) {
    const garage = new Garage(garageData);
    return await garage.save();
  }

  async update(id, garageData) {
    return await Garage.findByIdAndUpdate(
      id,
      garageData,
      { new: true, runValidators: true }
    ).populate('authorizedTrucks', 'licensePlate displayPlate brand model');
  }

  async delete(id) {
    return await Garage.findByIdAndDelete(id);
  }

  async addAuthorizedTruck(garageId, truckId) {
    return await Garage.findByIdAndUpdate(
      garageId,
      { $addToSet: { authorizedTrucks: truckId } },
      { new: true }
    ).populate('authorizedTrucks', 'licensePlate displayPlate brand model');
  }

  async removeAuthorizedTruck(garageId, truckId) {
    return await Garage.findByIdAndUpdate(
      garageId,
      { $pull: { authorizedTrucks: truckId } },
      { new: true }
    ).populate('authorizedTrucks', 'licensePlate displayPlate brand model');
  }

  async updateOccupancy(garageId, change) {
    return await Garage.findByIdAndUpdate(
      garageId,
      { $inc: { currentOccupancy: change } },
      { new: true }
    );
  }

  async findActiveGarages() {
    return await Garage.find({ isActive: true })
      .select('name location coordinates currentOccupancy capacity');
  }

  async getStats() {
    const [total, active, totalCapacity, currentOccupancy] = await Promise.all([
      Garage.countDocuments(),
      Garage.countDocuments({ isActive: true }),
      Garage.aggregate([{ $group: { _id: null, total: { $sum: '$capacity' } } }]),
      Garage.aggregate([{ $group: { _id: null, total: { $sum: '$currentOccupancy' } } }])
    ]);

    return {
      total,
      active,
      totalCapacity: totalCapacity[0]?.total || 0,
      currentOccupancy: currentOccupancy[0]?.total || 0,
      utilizationRate: totalCapacity[0]?.total > 0 
        ? ((currentOccupancy[0]?.total / totalCapacity[0]?.total) * 100).toFixed(1)
        : 0
    };
  }
}

module.exports = new GarageRepository();
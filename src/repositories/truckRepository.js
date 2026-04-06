const Truck = require('../models/Truck');

class TruckRepository {
  async findAll(filters = {}) {
    return await Truck.find(filters)
      .populate('driver', 'name phone status')
      .populate('device', 'deviceId status')
      .sort({ createdAt: -1 });
  }

  async findById(id) {
    return await Truck.findById(id)
      .populate('driver', 'name phone status score')
      .populate('device', 'deviceId status lastSeen');
  }

  async findByLicensePlate(licensePlate) {
    return await Truck.findByPlate(licensePlate);
  }

  async create(truckData) {
    const truck = new Truck(truckData);
    return await truck.save();
  }

  async update(id, truckData) {
    return await Truck.findByIdAndUpdate(
      id,
      truckData,
      { new: true, runValidators: true }
    );
  }

  async delete(id) {
    return await Truck.findByIdAndDelete(id);
  }

  async updateLocation(id, lat, lng, speed = 0) {
    return await Truck.findByIdAndUpdate(
      id,
      {
        currentLocation: { lat, lng },
        currentSpeed: speed
      },
      { new: true }
    );
  }

  async findAvailableTrucks() {
    return await Truck.find({
      status: 'available',
      driver: { $ne: null }
    }).populate('driver', 'name phone status');
  }

  async findByStatus(status) {
    return await Truck.find({ status })
      .populate('driver', 'name phone')
      .populate('device', 'deviceId status');
  }

  async updateDriver(id, driverId) {
    return await Truck.findByIdAndUpdate(
      id,
      { driver: driverId },
      { new: true }
    );
  }

  async updateDevice(id, deviceId) {
    return await Truck.findByIdAndUpdate(
      id,
      { device: deviceId },
      { new: true }
    );
  }

  async getStats() {
    const [total, available, inMission, maintenance, inactive] = await Promise.all([
      Truck.countDocuments(),
      Truck.countDocuments({ status: 'available' }),
      Truck.countDocuments({ status: 'in_mission' }),
      Truck.countDocuments({ status: 'maintenance' }),
      Truck.countDocuments({ status: 'inactive' })
    ]);

    return { total, available, inMission, maintenance, inactive };
  }
}

module.exports = new TruckRepository();
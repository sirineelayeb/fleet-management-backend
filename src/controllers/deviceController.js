const Device = require('../models/Device');
const Truck = require('../models/Truck');
const trackingService = require('../services/trackingService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const PaginatedResponse = require('../utils/pagination');
class DeviceController {

  handleTrackingData = catchAsync(async (req, res) => {
    const io = req.io; 
    await trackingService.processTracking(req.body, io, 'http');

    res.json({ success: true });
  });

  getAllDevices = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, status, search, archived } = req.query;

    const filter = {};

    // Only apply archived filter if the parameter is provided
    if (archived !== undefined) {
      filter.isArchived = archived === 'true';
    }
    // If archived is not provided, show all devices (both active and archived)

    if (status) {
      filter.status = status;
    }

    if (search) {
      filter.deviceId = { $regex: search, $options: 'i' };
    }

    const result = await PaginatedResponse.fromQuery(
      Device,
      filter,
      parseInt(page),
      parseInt(limit),
      [{ path: 'truck', select: 'licensePlate brand model' }]
    );

    res.json({ success: true, ...result });
  });

  getDevice = catchAsync(async (req, res) => {
    const device = await Device.findById(req.params.id).populate('truck');
    if (!device) throw new AppError('Device not found', 404);
    res.json({ success: true, data: device });
  });

  registerDevice = catchAsync(async (req, res) => {
    const { deviceId, firmwareVersion, truckId } = req.body;

    const existing = await Device.findOne({ deviceId });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Device "${deviceId}" is already registered`
      });
    }

    const device = await Device.create({ 
      deviceId, 
      firmwareVersion, 
      truck: truckId || null
    });

    // Keep the Truck side of the relationship in sync
    if (truckId) {
      await Truck.findByIdAndUpdate(truckId, {
        $addToSet: { devices: device._id }
      });
    }

    res.status(201).json({ success: true, data: device });
  });


  updateDevice = catchAsync(async (req, res) => {
    const device = await Device.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!device) throw new AppError('Device not found', 404);
    res.json({ success: true, data: device });
  });

  deleteDevice = catchAsync(async (req, res) => {
    const device = await Device.findByIdAndDelete(req.params.id);
    if (!device) throw new AppError('Device not found', 404);
    res.json({ success: true });
  });
  // PATCH /api/devices/:id/archive
  archiveDevice = catchAsync(async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device) throw new AppError('Device not found', 404);
    if (device.isArchived) throw new AppError('Device is already archived', 400);

    device.isArchived = true;
    device.archivedAt = new Date();
    await device.save();

    res.status(200).json({ success: true, message: 'Device archived successfully' });
  });
  // PATCH /api/devices/:id/unarchive
  unarchiveDevice = catchAsync(async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device) throw new AppError('Device not found', 404);
    if (!device.isArchived) throw new AppError('Device is not archived', 400);

    device.isArchived = false;
    device.archivedAt = null;
    await device.save();

    res.status(200).json({ success: true, message: 'Device restored successfully' });
  });

  assignToTruck = catchAsync(async (req, res) => {
    const { truckId } = req.body;
    
    const [device, truck] = await Promise.all([
      Device.findById(req.params.id),
      Truck.findById(truckId)
    ]);
    
    if (!device) throw new AppError('Device not found', 404);
    if (!truck) throw new AppError('Truck not found', 404);
    
    // Check if device is already assigned to another truck
    if (device.truck && device.truck.toString() !== truckId) {
      throw new AppError('Device is already assigned to another truck', 400);
    }
    
    // Update device with truck reference
    device.truck = truckId;
    await device.save();
    
    // Add device to truck's devices array (if not already there)
    if (!truck.devices.includes(device._id)) {
      truck.devices.push(device._id);
      await truck.save();
    }
    
    // Return populated data
    const updatedTruck = await Truck.findById(truckId)
      .populate('devices', 'deviceId status batteryLevel firmwareVersion lastSeen')
      .populate('driver', 'name phone');
    
    res.json({ 
      success: true, 
      message: 'Device assigned successfully',
      data: updatedTruck 
    });
  });

unassignFromTruck = catchAsync(async (req, res) => {
  const device = await Device.findById(req.params.id);
  if (!device) throw new AppError('Device not found', 404);
  
  // Get the truck this device was assigned to
  const oldTruckId = device.truck;
  
  if (oldTruckId) {
    // Remove device from truck's devices array
    await Truck.findByIdAndUpdate(oldTruckId, { 
      $pull: { devices: device._id }  
    });
  }
  
  // Clear device's truck reference
  device.truck = null;
  await device.save();
  
  res.json({ 
    success: true, 
    message: 'Device unassigned from truck successfully' 
  });
});

}

module.exports = new DeviceController();
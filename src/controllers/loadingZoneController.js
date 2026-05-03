const LoadingZone = require('../models/LoadingZone');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class LoadingZoneController {
  
  // Get all loading zones with pagination, search, and status filter
  getAllLoadingZones = catchAsync(async (req, res) => {
    const { status, page = 1, limit = 10, search } = req.query;
    const filter = {};
    
    if (status) filter.status = status;
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'location.placeName': { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [zones, total] = await Promise.all([
      LoadingZone.find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      LoadingZone.countDocuments(filter)
    ]);
    
    res.status(200).json({
      success: true,
      count: zones.length,
      data: zones,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    });
  });
  
  // Get single loading zone
  getLoadingZone = catchAsync(async (req, res) => {
    const zone = await LoadingZone.findById(req.params.id);
    if (!zone) throw new AppError('Loading zone not found', 404);
    res.status(200).json({ success: true, data: zone });
  });
  
  // Create loading zone (with placeName)
  createLoadingZone = catchAsync(async (req, res) => {
    const { name, description, location, radiusMeters, status } = req.body;
    
    if (!name || !location || !location.lat || !location.lng) {
      throw new AppError('Name, location lat, and location lng are required', 400);
    }
    
    const existingZone = await LoadingZone.findOne({ name });
    if (existingZone) throw new AppError('Loading zone with this name already exists', 400);
    
    const zone = await LoadingZone.create({
      name,
      description: description || '',
      location: {
        lat: location.lat,
        lng: location.lng,
        placeName: location.placeName || ''   // ← allow placeName
      },
      radiusMeters: radiusMeters || 30,
      status: status || 'active'
    });
    
    res.status(201).json({ success: true, message: 'Loading zone created successfully', data: zone });
  });
  
  // Update loading zone (including location.placeName)
  updateLoadingZone = catchAsync(async (req, res) => {
    const zone = await LoadingZone.findById(req.params.id);
    if (!zone) throw new AppError('Loading zone not found', 404);
    
    if (req.body.name && req.body.name !== zone.name) {
      const existingZone = await LoadingZone.findOne({ name: req.body.name });
      if (existingZone) throw new AppError('Loading zone with this name already exists', 400);
    }
    
    // Handle nested location update
    const updateData = { ...req.body };
    if (req.body.location) {
      updateData.location = {
        lat: req.body.location.lat ?? zone.location.lat,
        lng: req.body.location.lng ?? zone.location.lng,
        placeName: req.body.location.placeName ?? zone.location.placeName
      };
    }
    
    const updatedZone = await LoadingZone.findByIdAndUpdate(
      req.params.id, 
      updateData, 
      { new: true, runValidators: true }
    );
    
    res.status(200).json({ success: true, message: 'Loading zone updated successfully', data: updatedZone });
  });
  
  // Delete loading zone
  deleteLoadingZone = catchAsync(async (req, res) => {
    const zone = await LoadingZone.findById(req.params.id);
    if (!zone) throw new AppError('Loading zone not found', 404);
    
    await zone.deleteOne();
    res.status(200).json({ success: true, message: 'Loading zone deleted successfully' });
  });
  
  // Get all active loading zones (simplified, includes placeName)
  getActiveLoadingZones = catchAsync(async (req, res) => {
    const zones = await LoadingZone.find({ status: 'active' })
      .select('name description location');   // location now includes placeName
    res.status(200).json({ success: true, count: zones.length, data: zones });
  });
  
  // Bulk update status
  bulkUpdateStatus = catchAsync(async (req, res) => {
    const { zoneIds, status } = req.body;
    
    if (!zoneIds || !Array.isArray(zoneIds) || zoneIds.length === 0) {
      throw new AppError('Zone IDs array is required', 400);
    }
    
    if (!['active', 'inactive'].includes(status)) {
      throw new AppError('Status must be either "active" or "inactive"', 400);
    }
    
    const result = await LoadingZone.updateMany(
      { _id: { $in: zoneIds } },
      { status }
    );
    
    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} loading zones updated`,
      data: { modifiedCount: result.modifiedCount }
    });
  });
  
  // Get statistics
  getStats = catchAsync(async (req, res) => {
    const [total, active, inactive] = await Promise.all([
      LoadingZone.countDocuments(),
      LoadingZone.countDocuments({ status: 'active' }),
      LoadingZone.countDocuments({ status: 'inactive' })
    ]);
    
    res.status(200).json({
      success: true,
      data: { total, active, inactive }
    });
  });
  
  // Search loading zones (for dropdowns, similar to customer search)
  searchLoadingZones = catchAsync(async (req, res) => {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(200).json({ success: true, data: [] });
    }
    
    const zones = await LoadingZone.find({
      status: 'active',
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { 'location.placeName': { $regex: q, $options: 'i' } }
      ]
    })
    .limit(parseInt(limit))
    .select('name description location');
    
    res.status(200).json({ success: true, data: zones });
  });
}

module.exports = new LoadingZoneController();
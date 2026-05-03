const Customer = require('../models/Customer');
const Shipment = require('../models/Shipment');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class CustomerController {
  
  // Get all customers with pagination and search
  getAllCustomers = catchAsync(async (req, res) => {
    const { isActive, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [customers, total] = await Promise.all([
      Customer.find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Customer.countDocuments(filter)
    ]);
    
    res.status(200).json({
      success: true,
      count: customers.length,
      data: customers,
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
  
  // Get single customer with their shipments
  getCustomer = catchAsync(async (req, res) => {
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw new AppError('Customer not found', 404);
    
    // Get customer's recent shipments
    const shipments = await Shipment.find({ customer: customer._id })
      .select('shipmentId status weightKg plannedDepartureDate plannedDeliveryDate createdAt')
      .populate('truck', 'licensePlate')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get shipment stats for this customer
    const stats = await Shipment.aggregate([
      { $match: { customer: customer._id } },
      { $group: {
        _id: null,
        totalShipments: { $sum: 1 },
        totalWeight: { $sum: '$weightKg' },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } }
      }}
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        ...customer.toObject(),
        recentShipments: shipments,
        stats: stats[0] || { totalShipments: 0, totalWeight: 0, completed: 0, pending: 0, inProgress: 0 }
      }
    });
  });
  
  // Create new customer
  createCustomer = catchAsync(async (req, res) => {
    const { name, phone, address, email, location, isActive } = req.body;
    
    if (email) {
      const existingCustomer = await Customer.findOne({ email });
      if (existingCustomer) throw new AppError('Customer with this email already exists', 400);
    }
    
    const customer = await Customer.create({
      name,
      phone,
      address: address || '',
      email: email || '',
      location: location || { lat: null, lng: null, placeName: '' },
      isActive: isActive !== undefined ? isActive : true
    });
    
    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: customer
    });
  });

  updateCustomer = catchAsync(async (req, res) => {
    const { name, phone, address, email, location, isActive } = req.body;
    
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw new AppError('Customer not found', 404);
    
    if (email && email !== customer.email) {
      const existingCustomer = await Customer.findOne({ email, _id: { $ne: req.params.id } });
      if (existingCustomer) throw new AppError('Customer with this email already exists', 400);
    }
    
    customer.name = name || customer.name;
    customer.phone = phone || customer.phone;
    customer.address = address !== undefined ? address : customer.address;
    customer.email = email !== undefined ? email : customer.email;
    customer.location = location || customer.location;
    customer.isActive = isActive !== undefined ? isActive : customer.isActive;
    
    await customer.save();
    
    res.status(200).json({
      success: true,
      message: 'Customer updated successfully',
      data: customer
    });
  });
  
  // Delete customer (only if no shipments)
  deleteCustomer = catchAsync(async (req, res) => {
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw new AppError('Customer not found', 404);
    
    // Check if customer has any shipments
    const shipmentCount = await Shipment.countDocuments({ customer: customer._id });
    if (shipmentCount > 0) {
      throw new AppError(`Cannot delete customer with ${shipmentCount} existing shipments. Archive instead.`, 400);
    }
    
    await customer.deleteOne();
    
    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully'
    });
  });
  
  // Archive customer (soft delete)
  archiveCustomer = catchAsync(async (req, res) => {
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw new AppError('Customer not found', 404);
    
    customer.isActive = false;
    await customer.save();
    
    res.status(200).json({
      success: true,
      message: 'Customer archived successfully',
      data: customer
    });
  });
  
  // Restore customer
  restoreCustomer = catchAsync(async (req, res) => {
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw new AppError('Customer not found', 404);
    
    customer.isActive = true;
    await customer.save();
    
    res.status(200).json({
      success: true,
      message: 'Customer restored successfully',
      data: customer
    });
  });
  
  // Get customer statistics
  getCustomerStats = catchAsync(async (req, res) => {
    const [total, active, inactive] = await Promise.all([
      Customer.countDocuments(),
      Customer.countDocuments({ isActive: true }),
      Customer.countDocuments({ isActive: false })
    ]);
    
    const topCustomers = await Shipment.aggregate([
      { $match: { status: 'completed' } },
      { $group: {
        _id: '$customer',
        totalShipments: { $sum: 1 },
        totalWeight: { $sum: '$weightKg' }
      }},
      { $sort: { totalShipments: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
      { $unwind: '$customer' }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        total,
        active,
        inactive,
        topCustomers
      }
    });
  });
  
  // Bulk import customers
  bulkImportCustomers = catchAsync(async (req, res) => {
    const { customers } = req.body;
    
    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      throw new AppError('Please provide an array of customers', 400);
    }
    
    const created = [];
    const errors = [];
    
    for (const customerData of customers) {
      try {
        const customer = await Customer.create(customerData);
        created.push(customer);
      } catch (error) {
        errors.push({ data: customerData, error: error.message });
      }
    }
    
    res.status(201).json({
      success: true,
      message: `${created.length} customers imported successfully`,
      data: { created, errors, totalCreated: created.length, totalErrors: errors.length }
    });
  });
  
  // Search customers (quick search for dropdowns)
  searchCustomers = catchAsync(async (req, res) => {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }
    
    const customers = await Customer.find({
      isActive: true,
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    })
    .limit(parseInt(limit))
    .select('name phone email');
    
    res.status(200).json({
      success: true,
      data: customers
    });
  });
}

module.exports = new CustomerController();
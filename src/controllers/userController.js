// backend/src/controllers/userController.js
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

// ─── Admin only ──────────────────────────────────────────────────────────────
exports.getAllUsers = catchAsync(async (req, res) => {
  const users = await User.find().select('-password');
  res.json({ success: true, count: users.length, users });
});

exports.createUser = catchAsync(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    throw new AppError('Please provide name, email and password', 400);
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) throw new AppError('User already exists', 400);

  const user = await User.create({
    name,
    email,
    password,
    role: role || 'shipment_manager',
  });

  res.status(201).json({
    success: true,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    },
  });
});

exports.getUserStats = catchAsync(async (req, res) => {
  const totalUsers = await User.countDocuments();
  const adminCount = await User.countDocuments({ role: 'admin' });
  const shipmentManagerCount = await User.countDocuments({ role: 'shipment_manager' });
  const activeUsers = await User.countDocuments({ isActive: true });
  const inactiveUsers = await User.countDocuments({ isActive: false });

  res.json({
    success: true,
    stats: {
      total: totalUsers,
      admins: adminCount,
      shipmentManagers: shipmentManagerCount,
      active: activeUsers,
      inactive: inactiveUsers,
    },
  });
});

exports.updateUserRole = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!role || !['admin', 'shipment_manager'].includes(role)) {
    throw new AppError('Invalid role. Must be admin or shipment_manager', 400);
  }

  const user = await User.findByIdAndUpdate(id, { role }, { new: true, runValidators: true }).select('-password');
  if (!user) throw new AppError('User not found', 404);

  res.json({ success: true, user, message: 'User role updated successfully' });
});

exports.deleteUser = catchAsync(async (req, res) => {
  const { id } = req.params;

  if (req.user.id === id) {
    throw new AppError('You cannot delete your own account', 400);
  }

  const user = await User.findByIdAndDelete(id);
  if (!user) throw new AppError('User not found', 404);

  res.json({ success: true, message: 'User deleted successfully' });
});

exports.toggleUserStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const user = await User.findById(id);
  if (!user) throw new AppError('User not found', 404);

  user.isActive = !user.isActive;
  await user.save();

  res.json({
    success: true,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
    },
    message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
  });
});

// ─── Admin or self ───────────────────────────────────────────────────────────
exports.getUserById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const user = await User.findById(id).select('-password');
  if (!user) throw new AppError('User not found', 404);
  res.json({ success: true, user });
});

exports.updateUser = catchAsync(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const requestingUser = req.user;

  const user = await User.findById(id).select('+password');
  if (!user) throw new AppError('User not found', 404);

  // Authorization
  if (requestingUser.role !== 'admin' && requestingUser._id.toString() !== id) {
    throw new AppError('Not allowed', 403);
  }

  // Update allowed fields
  if (updates.name) user.name = updates.name;
  if (updates.email && requestingUser.role === 'admin') user.email = updates.email;
  if (updates.role && requestingUser.role === 'admin') user.role = updates.role;
  if (updates.password) user.password = updates.password; // hashed by pre-save
  if (updates.isActive !== undefined && requestingUser.role === 'admin') user.isActive = updates.isActive;

  await user.save();

  const userObj = user.toObject();
  delete userObj.password;

  res.json({ success: true, user: userObj, message: 'User updated successfully' });
});

// ─── Self update (uses token, not ID) ────────────────────────────────────────
exports.updateMe = async (req, res, next) => {
  try {
    const { name, email, currentPassword, password } = req.body;
    const user = req.user; // already includes password field

    if (name) user.name = name;
    if (email) user.email = email;

    if (password) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password required' });
      }
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }
      user.password = password; // will be hashed in pre-save hook
    }

    await user.save();

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
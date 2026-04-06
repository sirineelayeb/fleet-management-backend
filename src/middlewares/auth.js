const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized' });
  }
};

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    next();
  };
};

// Add this missing middleware
exports.checkUserAccess = (req, res, next) => {
  // Admin can access any user
  if (req.user.role === 'admin') {
    return next();
  }
  
  // Regular users can only access themselves
  const userId = req.params.id;
  if (userId && userId !== req.user.id) {
    return res.status(403).json({
      success: false,
      message: 'You can only access your own profile'
    });
  }
  
  next();
};
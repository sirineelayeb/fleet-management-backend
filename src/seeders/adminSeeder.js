const User = require('../models/User');

const createDefaultAdmin = async () => {
  try {
    // Check if admin already exists
    const adminExists = await User.findOne({ role: 'admin' });
    
    if (!adminExists) {
      console.log('Creating default admin user...');
      
      const admin = new User({
        name: process.env.DEFAULT_ADMIN_NAME || 'Admin',
        email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@smartfleet.com',
        password: process.env.DEFAULT_ADMIN_PASSWORD || 'Admin123!',
        role: 'admin',
        isActive: true
      });
      
      await admin.save();
      console.log('Default admin created successfully!');
      console.log(`Email: ${admin.email}`);
      console.log(`Password: ${process.env.DEFAULT_ADMIN_PASSWORD || 'Admin123!'}`);
      console.log('Please change the password after first login!');
    } else {
      console.log('Admin user already exists. Skipping...');
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
    throw error; // Throw error to be caught in server.js
  }
};

module.exports = createDefaultAdmin;
const User = require('../models/User');

const createDefaultAdmin = async () => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });

    if (!adminExists) {
      console.log('Creating default admin user...');

      const admin = new User({
        name: 'Syrine Elayeb',
        email: 'syrine.elayeb@haultrack.tn',
        password: 'Admin@2026!',
        role: 'admin',
        isActive: true,
      });

      await admin.save();
      console.log('Default admin created successfully.');
      console.log('Email: syrine.elayeb@haultrack.tn');
      console.log('Password: Admin@2026!');
      console.log('Please change the password after first login.');
    } else {
      console.log('Admin user already exists. Skipping.');
    }
  } catch (error) {
    console.error('Error creating default admin:', error.message);
    throw error;
  }
};

module.exports = createDefaultAdmin;
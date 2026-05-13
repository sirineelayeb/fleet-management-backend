// reset-admin.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const user = await User.findOne({ role: 'admin' });
  user.password = 'Admin123!';
  await user.save();
  console.log('Password reset to Admin123!');
  process.exit();
});
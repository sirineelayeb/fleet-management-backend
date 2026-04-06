const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { server, io } = require('./app');  
const createDefaultAdmin = require('./seeders/adminSeeder');

dotenv.config();

const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');

    // const mqttService = require('./services/mqtt.service'); 
    // mqttService.start(io);
    
    // Create default admin
    await createDefaultAdmin();
    
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('MongoDB error:', err);
    process.exit(1);
  }
};

startServer();
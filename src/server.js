const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { server, io } = require('./app');  
const createDefaultAdmin = require('./seeders/adminSeeder');
const mqttService = require('./services/mqttService');
const delayMonitoringService = require('./services/delayMonitoringService');
// const { startDeviceWatchdog } = require('./jobs/deviceWatchdogJob'); 

dotenv.config();

const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log('MongoDB connected');

    await createDefaultAdmin();
    mqttService.start(io);
    console.log('MQTT service started, listening to fleet/gps');
    
    delayMonitoringService.start(io);
    // startDeviceWatchdog(io);
    
    const PORT = process.env.PORT || 5000;
    const serverInstance = server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // ============================================================
    // GRACEFUL SHUTDOWN
    // ============================================================
    const shutdown = async (signal) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      
      serverInstance.close(async () => {
        console.log('HTTP server closed');
        
        if (mqttService && mqttService.stop) {
          await mqttService.stop();
          console.log('MQTT service stopped');
        }
        
        await mongoose.connection.close();
        console.log('MongoDB connection closed');
        
        process.exit(0);
      });
      
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (err) {
    console.error('MongoDB error:', err);
    process.exit(1);
  }
};

startServer();
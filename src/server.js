const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cron = require('node-cron');
const { server, io } = require('./app');  
const createDefaultAdmin = require('./seeders/adminSeeder');
const delayMonitoring = require('./services/delayMonitoringService');
const mqttService = require('./services/mqttService');

dotenv.config();

const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log('MongoDB connected');

    await createDefaultAdmin();
    mqttService.start(io);
    console.log('✅ MQTT service started, listening to fleet/gps');
    // Store reference to the cron job
    const delayMonitorJob = cron.schedule('*/30 * * * *', async () => {
      console.log('[DelayMonitor] Running scheduled delay check...');
      try {
        await delayMonitoring.checkAllActiveShipments(io);
      } catch (err) {
        console.error('[DelayMonitor] Error:', err);
      }
    });
    console.log('✅ Delay monitoring scheduler started (every 30 minutes)');

    const PORT = process.env.PORT || 5000;
    const serverInstance = server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // ============================================================
    // GRACEFUL SHUTDOWN – Stop cron job here
    // ============================================================
    const shutdown = async (signal) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      
      // Stop the cron job (prevents new executions)
      delayMonitorJob.stop();
      console.log('⏹️ Cron job stopped');
      
      // Close HTTP server
      serverInstance.close(async () => {
        console.log('HTTP server closed');
        
        // Close database connection
        await mongoose.connection.close();
        console.log('MongoDB connection closed');
        
        process.exit(0);
      });
      
      // Force exit after timeout if something hangs
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };
    
    // Listen for termination signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (err) {
    console.error('MongoDB error:', err);
    process.exit(1);
  }
};

startServer();
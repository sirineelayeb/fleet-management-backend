const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { initSocket } = require('./socket/socketManager');

const app = express();
const server = http.createServer(app);
const io = initSocket(server); 
app.use((req, res, next) => {
  req.io = io;
  next();
});
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://fleet-management-frontend-ebon.vercel.app']
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const truckRoutes = require('./routes/truckRoutes');
const driverRoutes = require('./routes/driverRoutes');
const performanceRoutes = require('./routes/performanceRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const customerRoutes = require('./routes/customerRoutes');
const shipmentRoutes = require('./routes/shipmentRoutes');
const LoadingZoneRoutes = require('./routes/LoadingZoneRoutes');
const tripHistoryRoutes = require('./routes/tripHistoryRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const lprRoutes = require('./routes/lprRoutes');
app.post('/api/test/delay', async (req, res) => {
  const delayMonitoring = require('./services/delayMonitoringService');
  await delayMonitoring.checkNow();
  res.json({ 
    success: true, 
    message: 'Delay check completed',
    timestamp: new Date().toISOString()
  });
});
app.post('/api/test/check-delays', async (req, res) => {
  const delayMonitoring = require('./services/delayMonitoringService');
  await delayMonitoring.checkNow();
  res.json({ message: 'Delay check completed' });
});



app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/trucks', truckRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/loading-zones', LoadingZoneRoutes)
app.use('/api/trips', tripHistoryRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/lpr', lprRoutes);
// ─── Health & root ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));
app.get('/', (req, res) => res.json({ message: 'Fleet Management API', version: '1.0.0' }));

// ─── 404 Handler ────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    message: `Cannot find ${req.originalUrl} on this server` 
  });
});

// ─── Error handler ───────────────────────────────────────────────────────────
const errorHandler = require('./middlewares/errorHandler');
app.use(errorHandler);

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = { app, server, io };
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { initSocket } = require('./socket/socketManager');

const app = express();
const server = http.createServer(app);
const io = initSocket(server); 

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://fleet-management-frontend-ebon.vercel.app"
  ],
  credentials: true
}));
app.use(express.json());

// ─── Static files ────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Routes ──────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const truckRoutes = require('./routes/truckRoutes');
const driverRoutes = require('./routes/driverRoutes');
const performanceRoutes = require('./routes/performanceRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const shipmentRoutes = require('./routes/shipmentRoutes');
const gateRoutes = require('./routes/gateRoutes');
const tripHistoryRoutes = require('./routes/tripHistoryRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/trucks', truckRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/gates', gateRoutes);
app.use('/api/trips', tripHistoryRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/notifications', notificationRoutes);

// ─── Health & root ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));
app.get('/', (req, res) => res.json({ message: 'Fleet Management API', version: '1.0.0' }));

// ─── Error handler ───────────────────────────────────────────────────────────
const errorHandler = require('./middlewares/errorHandler');
app.use(errorHandler);

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = { app, server, io };
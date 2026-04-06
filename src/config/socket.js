const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

class SocketManager {
  constructor(server) {
    this.io = null;
    this.server = server;
    this.connectedClients = new Map();
  }

  initialize() {
    this.io = socketIo(this.server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        credentials: true,
        methods: ['GET', 'POST']
      },
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication error'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        
        if (!user) {
          return next(new Error('User not found'));
        }

        socket.user = user;
        next();
      } catch (error) {
        next(new Error('Authentication error'));
      }
    });

    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    return this.io;
  }

  handleConnection(socket) {
    console.log(`Client connected: ${socket.id} - User: ${socket.user.email}`);
    
    // Store client connection
    this.connectedClients.set(socket.user._id.toString(), socket.id);

    // Join user to their role room
    socket.join(`role:${socket.user.role}`);
    
    // Join user to their personal room
    socket.join(`user:${socket.user._id}`);

    // Handle subscription to truck updates
    socket.on('subscribe:truck', (truckId) => {
      socket.join(`truck:${truckId}`);
      console.log(`User ${socket.user.email} subscribed to truck ${truckId}`);
    });

    socket.on('unsubscribe:truck', (truckId) => {
      socket.leave(`truck:${truckId}`);
    });

    // Handle subscription to alerts
    socket.on('subscribe:alerts', () => {
      socket.join(`alerts:${socket.user.role}`);
    });

    // Handle subscription to garage
    socket.on('subscribe:garage', (garageId) => {
      socket.join(`garage:${garageId}`);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      this.connectedClients.delete(socket.user._id.toString());
    });
  }

  // Emit location update to specific truck subscribers
  emitLocationUpdate(truckId, locationData) {
    this.io.to(`truck:${truckId}`).emit('location:update', {
      truckId,
      ...locationData,
      timestamp: new Date()
    });
  }

  // Emit alert to relevant users
  emitAlert(alertData) {
    // Send to admins and logistics officers
    this.io.to('role:admin').emit('alert:new', alertData);
    this.io.to('role:logistics_officer').emit('alert:new', alertData);
    
    // Send to specific truck if assigned
    if (alertData.truck) {
      this.io.to(`truck:${alertData.truck}`).emit('alert:new', alertData);
    }
  }

  // Emit garage access update
  emitGarageAccess(garageId, accessData) {
    this.io.to(`garage:${garageId}`).emit('garage:access', accessData);
    this.io.to('role:admin').emit('garage:access', accessData);
  }

  // Emit shipment status update
  emitShipmentUpdate(shipmentId, statusData) {
    this.io.to(`shipment:${shipmentId}`).emit('shipment:update', statusData);
    this.io.to('role:logistics_officer').emit('shipment:update', statusData);
  }

  // Emit to specific user
  emitToUser(userId, event, data) {
    const socketId = this.connectedClients.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  // Broadcast to all connected clients
  broadcast(event, data) {
    this.io.emit(event, data);
  }
}

module.exports = SocketManager;
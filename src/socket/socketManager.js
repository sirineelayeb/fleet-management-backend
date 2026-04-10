const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User.js');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // JWT authentication for Socket.IO
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user || !user.isActive) return next(new Error('User not found'));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id} (${socket.user?.name})`);

    // Join role-based rooms
    socket.join(`role:${socket.user.role}`);
    socket.join(`user:${socket.user._id}`);

    // Allow subscribing to specific truck updates
    socket.on('subscribe:truck', (truckId) => {
      socket.join(`truck:${truckId}`);
    });

    socket.on('unsubscribe:truck', (truckId) => {
      socket.leave(`truck:${truckId}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
};

module.exports = { initSocket, getIO };
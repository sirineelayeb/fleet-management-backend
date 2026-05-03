// backend/src/socket/socketManager.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initSocket = (server) => {
  const { Server } = require('socket.io');
  
  io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? ['https://fleet-management-frontend-ebon.vercel.app']
        : ['http://localhost:5173', 'http://localhost:3000'],
      methods: ["GET", "POST"],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("No token"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return next(new Error("User not found"));
      }

      socket.user = user;
      next();
    } catch (err) {
      console.log("❌ Auth error:", err.message);
      next(new Error("Auth error"));
    }
  });

  io.on("connection", (socket) => {
    console.log("🟢 SOCKET CONNECTED:", socket.id);
    console.log("👤 User:", socket.user?.name);
    console.log("👤 Role:", socket.user?.role);
    console.log("👤 User ID:", socket.user?._id?.toString());

    // Join user-specific room
    const userRoom = `user_${socket.user._id.toString()}`;
    socket.join(userRoom);
    console.log(`✅ Joined room: ${userRoom}`);

    // Join role-specific room
    const roleRoom = socket.user.role;
    socket.join(roleRoom);
    console.log(`✅ Joined role room: ${roleRoom}`);

    // For shipment managers, also join a specific room
    if (socket.user.role === 'shipment_manager') {
      socket.join('shipment_manager');
      console.log(`✅ Joined room: shipment_manager`);
    }

    // Log all rooms this socket is in
    console.log(`📡 Socket in rooms:`, Array.from(socket.rooms));

    // Send confirmation back to client
    socket.emit('connection_confirmed', {
      userId: socket.user._id.toString(),
      role: socket.user.role,
      rooms: Array.from(socket.rooms)
    });

    // ✅ Handle join event from client (for reconnection scenarios)
    socket.on('join', ({ userId, role }) => {
      const joinUserRoom = `user_${userId}`;
      socket.join(joinUserRoom);
      console.log(`✅ Client requested join room: ${joinUserRoom}`);
      
      socket.join(role);
      console.log(`✅ Client requested join role room: ${role}`);
      
      socket.emit('joined_rooms', {
        rooms: Array.from(socket.rooms),
        userId,
        role
      });
    });

    // ✅ Handle join room event
    socket.on('joinRoom', (room) => {
      socket.join(room);
      console.log(`✅ Client joined room: ${room}`);
    });

    socket.on("disconnect", () => {
      console.log("🔴 SOCKET DISCONNECTED:", socket.id);
    });
  });

  return io;
};
const logRoomMembers = (io, roomName) => {
  const room = io.sockets.adapter.rooms.get(roomName);
  if (room) {
    console.log(`📊 Room "${roomName}" has ${room.size} members:`, Array.from(room));
  } else {
    console.log(`📊 Room "${roomName}" is empty`);
  }
};

const getIO = () => {
  if (!io) throw new Error("Socket not initialized");
  return io;
};

module.exports = { initSocket, getIO };
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:5173",
        "https://fleet-management-frontend-ebon.vercel.app"
      ],
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  //  Auth middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);

      if (!user) return next(new Error("User not found"));

      socket.user = user;
      next();
    } catch (err) {
      console.log("AUTH ERROR:", err.message);
      next(new Error("Auth error"));
    }
  });

  // 🔌 Connection
  io.on("connection", (socket) => {
    console.log("SOCKET CONNECTED:", socket.id);

    socket.join(`role:${socket.user.role}`);

    socket.on("disconnect", () => {
      console.log("SOCKET DISCONNECTED:", socket.id);
    });
  });

  return io; 
};

const getIO = () => {
  if (!io) throw new Error("Socket not initialized");
  return io;
};

module.exports = { initSocket, getIO };
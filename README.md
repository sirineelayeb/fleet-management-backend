# 🚛 Smart Fleet Management — Backend API

A RESTful Node.js backend powering a smart fleet management platform for Tunisian truck fleets. Handles real-time GPS tracking, license plate recognition events, driver performance scoring, shipment management, and IoT device telemetry.

> 🎓 PFE Internship Project — Syrine Elayeb

---

## ✨ Features

- 🗺️ **Real-time GPS tracking** — live truck positions cached in Redis, pushed via Socket.io
- 📷 **LPR event logging** — receives plate detection events from the LPR microservice
- 👨‍✈️ **Driver management** — profiles, photo uploads, assignments, performance scoring
- 🚚 **Truck & device management** — IoT device registration, truck assignment
- 📦 **Shipment tracking** — full shipment lifecycle management
- 🔔 **Real-time notifications** — Socket.io powered alerts
- 📊 **Performance analytics** — driver score logs and reports
- 🔐 **Role-based access control** — admin and user roles with JWT auth
- 🌍 **Loading zone management** — geo-fenced zone monitoring
- ⏱️ **Device watchdog** — cron job marks devices inactive on missed heartbeat

---

## 🧱 Tech Stack

| Technology | Purpose |
|---|---|
| Node.js + Express | REST API server |
| MongoDB + Mongoose | Primary database (MongoDB Atlas) |
| Redis | Live location cache |
| Socket.io | Real-time communication |
| MQTT | IoT device messaging (HiveMQ Cloud) |
| JWT | Authentication |
| Multer | Driver photo uploads |
| Node-cron | Scheduled background jobs |

---

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── database.js            # MongoDB connection
│   │   ├── redis.js               # Redis client setup
│   │   └── upload.js              # Multer file upload config
│   │
│   ├── controllers/               # Route handlers (thin layer, delegates to services)
│   │   ├── authController.js
│   │   ├── customerController.js
│   │   ├── deviceController.js
│   │   ├── driverController.js
│   │   ├── loadingZoneController.js
│   │   ├── lprController.js
│   │   ├── notificationController.js
│   │   ├── performanceController.js
│   │   ├── shipmentController.js
│   │   ├── trackingController.js
│   │   ├── tripHistoryController.js
│   │   ├── truckController.js
│   │   └── userController.js
│   │
│   ├── services/                  # Business logic layer
│   │   ├── trackingService.js     # GPS processing, Redis cache, Socket.io emit
│   │   ├── lprService.js          # License plate event handling
│   │   ├── driverService.js       # Driver scoring & evaluation
│   │   ├── shipmentService.js     # Shipment lifecycle
│   │   ├── tripHistoryService.js  # Trip recording & history
│   │   ├── truckService.js        # Truck business logic
│   │   ├── notificationService.js # Notification creation & delivery
│   │   ├── mqttService.js         # MQTT broker integration
│   │   └── delayMonitoringService.js # Shipment delay detection
│   │
│   ├── models/                    # Mongoose schemas
│   │   ├── User.js
│   │   ├── Truck.js
│   │   ├── Driver.js
│   │   ├── Device.js
│   │   ├── Shipment.js
│   │   ├── Mission.js
│   │   ├── Customer.js
│   │   ├── LoadingZone.js
│   │   ├── LprEvent.js
│   │   ├── LocationHistory.js
│   │   ├── TripHistory.js
│   │   ├── Notification.js
│   │   ├── DriverScoreLog.js
│   │   └── ScoreConfig.js
│   │
│   ├── routes/                    # Express route definitions
│   │   ├── authRoutes.js
│   │   ├── customerRoutes.js
│   │   ├── deviceRoutes.js
│   │   ├── driverRoutes.js
│   │   ├── LoadingZoneRoutes.js
│   │   ├── lprRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── performanceRoutes.js
│   │   ├── shipmentRoutes.js
│   │   ├── trackingRoutes.js
│   │   ├── tripHistoryRoutes.js
│   │   ├── truckRoutes.js
│   │   ├── userRoutes.js
│   │   └── alertRoutes.js
│   │
│   ├── middlewares/
│   │   ├── auth.js                # JWT verification + role guard
│   │   ├── lprAuth.js             # LPR service API key authentication
│   │   ├── errorHandler.js        # Global error handler
│   │   ├── requestLogger.js       # HTTP request logging
│   │   └── validation.js          # Request body validation
│   │
│   ├── repositories/              # DB query abstraction layer
│   │   ├── driverRepository.js
│   │   ├── truckRepository.js
│   │   └── garageRepository.js
│   │
│   ├── jobs/
│   │   └── deviceWatchdogJob.js   # Cron: marks devices inactive on missed heartbeat
│   │
│   ├── socket/
│   │   └── socketManager.js       # Socket.io event handlers & room management
│   │
│   ├── seeders/
│   │   └── adminSeeder.js         # Seeds default admin account
│   │
│   ├── utils/
│   │   ├── AppError.js            # Custom error class with status code
│   │   ├── catchAsync.js          # Async error wrapper for controllers
│   │   └── pagination.js          # Reusable pagination helper
│   │
│   ├── app.js                     # Express app setup, middleware, routes
│   └── server.js                  # HTTP + Socket.io server entry point
│
├── uploads/
│   └── drivers/photos/            # Uploaded driver profile photos
│
├── .env                           # Environment variables (not in git)
├── .gitignore
├── package.json
└── README.md
```

---

## 🔌 API Endpoints

### Auth `/api/auth`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/login` | ❌ | Login and receive JWT token |
| POST | `/logout` | ✅ | Logout current session |
| GET | `/me` | ✅ | Get current user profile |

### Users `/api/users`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Admin | List all users |
| POST | `/` | Admin | Create user |
| PUT | `/:id` | Admin | Update user |
| DELETE | `/:id` | Admin | Delete user |

### Trucks `/api/trucks`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | ✅ | List all trucks |
| POST | `/` | Admin | Add truck |
| PUT | `/:id` | Admin | Update truck |
| DELETE | `/:id` | Admin | Delete truck |

### Drivers `/api/drivers`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | ✅ | List all drivers |
| POST | `/` | Admin | Add driver (with photo upload) |
| PUT | `/:id` | Admin | Update driver |
| DELETE | `/:id` | Admin | Delete driver |

### Devices `/api/devices`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Admin | List all devices |
| POST | `/register` | Admin | Register device (upsert by deviceId) |
| PUT | `/:id` | Admin | Update device |
| DELETE | `/:id` | Admin | Delete device |
| POST | `/:id/assign-truck` | Admin | Assign device to truck |
| PATCH | `/:id/unassign` | Admin | Unassign device from truck |
| POST | `/tracking` | IoT | Receive GPS telemetry from device |

### Tracking `/api/tracking`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/live` | ✅ | Get all live truck positions |
| GET | `/:truckId` | ✅ | Get location history for a truck |

### LPR `/api/lpr`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/detect` | LPR key | Receive plate detection event from LPR service |
| GET | `/events` | Admin | List all LPR events |

### Shipments `/api/shipments`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | ✅ | List all shipments |
| POST | `/` | Admin | Create shipment |
| PUT | `/:id` | Admin | Update shipment |
| DELETE | `/:id` | Admin | Delete shipment |

### Trip History `/api/trip-history`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | ✅ | List all trips |
| GET | `/:truckId` | ✅ | Trips for a specific truck |

### Performance `/api/performance`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/drivers` | Admin | All driver performance scores |
| GET | `/drivers/:id` | Admin | Single driver score breakdown |

### Notifications `/api/notifications`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | ✅ | Get current user notifications |
| PATCH | `/:id/read` | ✅ | Mark notification as read |

### Loading Zones `/api/loading-zones`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | ✅ | List all loading zones |
| POST | `/` | Admin | Create loading zone |
| DELETE | `/:id` | Admin | Delete loading zone |

### Customers `/api/customers`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | ✅ | List all customers |
| POST | `/` | Admin | Create customer |
| PUT | `/:id` | Admin | Update customer |
| DELETE | `/:id` | Admin | Delete customer |

---

## 🔐 Authentication & Authorization

JWT-based authentication with two roles: `admin` and `user`.

```
Request → auth.js (verify JWT token)
               ↓
         restrictTo('admin')   ← admin-only routes
               ↓
         controller → service
```

The LPR microservice uses a separate API key authenticated by `lprAuth.js`:
```
Authorization: Bearer <LPR_API_SECRET>
```

---

## ⚡ Real-time Architecture

```
GPS Device (MQTT or HTTP POST /api/devices/tracking)
       ↓
trackingService.js
       ├──▶ Redis        (caches latest position per truck)
       ├──▶ MongoDB      (persists to LocationHistory)
       └──▶ socketManager.js ──▶ Socket.io ──▶ Frontend dashboard
```

---

## 🌱 Environment Variables

Create a `.env` file at the project root:

```env
# Server
PORT=5000
NODE_ENV=production

# Database (MongoDB Atlas)
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<dbname>

# Authentication
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d

# Email (Gmail SMTP)
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_FROM=your_email@gmail.com
EMAIL_SECURE=true
EMAIL_PORT=465

# MQTT Broker (HiveMQ Cloud — TLS)
MQTT_BROKER_URL=mqtts://<your-cluster>.s1.eu.hivemq.cloud:8883
MQTT_USER=your_mqtt_username
MQTT_PASS=your_mqtt_password

# LPR Service API Key (must match lpr-service API_SECRET_KEY)
LPR_API_SECRET=your_lpr_secret_key
```

---

## 🚀 Deployment (Render)

The backend is deployed on **Render** as a web service.

### Steps

1. Push your code to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Connect your GitHub repository
4. Set the following:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node src/server.js` |
| Environment | Add all `.env` variables in Render dashboard |

5. Deploy — API will be available at your Render URL:
```
https://your-service.onrender.com
```

### Seed admin account (first deploy only)

Run once via Render shell or locally pointing to the production DB:
```bash
node src/seeders/adminSeeder.js
```

---

## 🔮 Roadmap

- [ ] Fuel consumption tracking
- [ ] Advanced alert rules engine
- [ ] Multi-tenant support
- [ ] API rate limiting

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit your changes
4. Open a Pull Request

---

## 📄 License

MIT License

---

## 👩‍💻 Author

**Syrine Elayeb** — PFE Internship Project
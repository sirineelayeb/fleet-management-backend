// backend/src/seeders/seeder.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

// Import Models
const User = require('../models/User');
const Driver = require('../models/Driver');
const Truck = require('../models/Truck');
const Device = require('../models/Device');
const Garage = require('../models/Garage');
const Shipment = require('../models/Shipment');
const Goods = require('../models/Goods');
const Alert = require('../models/Alert');

// ============================================================
// SAMPLE DATA
// ============================================================

// Users
const users = [
  {
    name: 'Admin User',
    email: 'admin@smartfleet.com',
    password: 'Admin123!',
    role: 'admin',
    isActive: true,
    lastLogin: new Date()
  },
  {
    name: 'Ahmed Ben Ali',
    email: 'ahmed@smartfleet.com',
    password: 'Logistics123!',
    role: 'logistics_officer',
    isActive: true,
    lastLogin: new Date()
  }
];

// Drivers
const drivers = [
  {
    firstName: 'Mohamed',
    lastName: 'Ben Salah',
    phone: '20123456',
    email: 'mohamed@example.com',
    licenseNumber: 'TUN-123456',
    licenseExpiry: new Date('2026-12-31'),
    address: 'Tunis',
    status: 'active'
  },
  {
    firstName: 'Karim',
    lastName: 'Trabelsi',
    phone: '22345678',
    email: 'karim@example.com',
    licenseNumber: 'TUN-789012',
    licenseExpiry: new Date('2026-06-15'),
    address: 'Sfax',
    status: 'active'
  }
];

// ESP32 Devices
const devices = [
  {
    deviceId: 'ESP32-001',
    type: 'esp32',
    status: 'active',
    batteryLevel: 85,
    lastPing: new Date(),
    config: { scanInterval: 30, sendInterval: 60 },
    lastWiFiScan: {
      timestamp: new Date(),
      networks: [{ ssid: 'SmartFleet-HQ', bssid: 'AA:BB:CC:DD:EE:01', rssi: -45 }]
    }
  },
  {
    deviceId: 'ESP32-002',
    type: 'esp32',
    status: 'active',
    batteryLevel: 92,
    lastPing: new Date(),
    config: { scanInterval: 30, sendInterval: 60 }
  }
];

// Trucks
const trucks = [
  {
    licensePlate: '1234 TN 5678',
    brand: 'Volvo',
    model: 'FH16',
    year: 2023,
    capacity: 20,
    status: 'available',
    vin: 'YV2AG20A9PA123456',
    insuranceExpiry: new Date('2026-12-31'),
    nextMaintenanceDate: new Date('2026-06-15'),
    currentLocation: { type: 'Point', coordinates: [10.1815, 36.8065] },
    currentSpeed: 0,
    lastTelemetryAt: new Date()
  },
  {
    licensePlate: '5678 TN 9012',
    brand: 'Mercedes',
    model: 'Actros',
    year: 2024,
    capacity: 25,
    status: 'on_road',
    vin: 'WDB1234567A123456',
    insuranceExpiry: new Date('2026-10-20'),
    nextMaintenanceDate: new Date('2026-07-10'),
    currentLocation: { type: 'Point', coordinates: [10.73, 34.73] },
    currentSpeed: 75,
    lastTelemetryAt: new Date()
  }
];

// Garages
const garages = [
  {
    name: 'Tunis Maintenance Center',
    location: { type: 'Point', coordinates: [10.1815, 36.8065] },
    address: 'Z.I. Charguia, Tunis',
    capacity: 15,
    allowedLicensePlates: [
      { licensePlate: '1234 TN 5678', validUntil: new Date('2026-12-31') }
    ],
    cameras: [
      { cameraId: 'CAM-01', name: 'Main Gate', position: 'Entrance' }
    ]
  },
  {
    name: 'Sfax Auto Center',
    location: { type: 'Point', coordinates: [10.73, 34.73] },
    address: 'Route de Gabès, Sfax',
    capacity: 10,
    allowedLicensePlates: [
      { licensePlate: '5678 TN 9012', validUntil: new Date('2026-07-10') }
    ],
    cameras: [
      { cameraId: 'CAM-02', name: 'Service Bay', position: 'Workshop' }
    ]
  }
];

// Shipments
const shipments = [
  {
    shipmentNumber: 'SHP-001',
    customer: {
      name: 'Carrefour Tunis',
      email: 'contact@carrefour.tn',
      phone: '71123456',
      address: 'Tunis'
    },
    origin: { address: 'Ben Arous', city: 'Ben Arous', coordinates: [10.23, 36.75] },
    destination: { address: 'La Marsa', city: 'La Marsa', coordinates: [10.33, 36.88] },
    status: 'delivered',
    estimatedDeparture: new Date('2026-03-30T08:00:00'),
    estimatedArrival: new Date('2026-03-30T14:00:00'),
    actualArrival: new Date('2026-03-30T13:45:00')
  },
  {
    shipmentNumber: 'SHP-002',
    customer: {
      name: 'Monoprix Sousse',
      email: 'contact@monoprix.tn',
      phone: '73234567',
      address: 'Sousse'
    },
    origin: { address: 'Ben Arous', city: 'Ben Arous', coordinates: [10.19, 36.72] },
    destination: { address: 'Sousse Centre', city: 'Sousse', coordinates: [10.63, 35.83] },
    status: 'in_transit',
    estimatedDeparture: new Date('2026-03-31T07:00:00'),
    estimatedArrival: new Date('2026-03-31T15:00:00')
  }
];

// Goods
const goods = [
  { name: 'Electronics', type: 'fragile', quantity: 50, weight: 15.5, unit: 'kg', description: 'TVs' },
  { name: 'Fresh Produce', type: 'perishable', quantity: 200, weight: 5, unit: 'kg', description: 'Fruits' }
];

// Alerts
const alerts = [
  {
    type: 'device_offline',
    severity: 'high',
    title: 'Device Offline',
    description: 'ESP32-002 has not sent data',
    status: 'active'
  },
  {
    type: 'garage_access',
    severity: 'medium',
    title: 'Maintenance Due',
    description: 'Truck 1234 TN 5678 needs maintenance',
    status: 'active'
  }
];

// ============================================================
// SEED FUNCTION
// ============================================================

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(' Connected to MongoDB');

    // Clear existing data
    console.log(' Clearing data...');
    await Promise.all([
      User.deleteMany(),
      Driver.deleteMany(),
      Truck.deleteMany(),
      Device.deleteMany(),
      Garage.deleteMany(),
      Shipment.deleteMany(),
      Goods.deleteMany(),
      Alert.deleteMany()
    ]);

    // Create Users
    const createdUsers = await User.create(users);
    console.log(`Created ${createdUsers.length} users`);

    // Create Drivers
    const createdDrivers = await Driver.create(drivers);
    console.log(`Created ${createdDrivers.length} drivers`);

    // Create Devices
    const createdDevices = await Device.create(devices);
    console.log(`Created ${createdDevices.length} devices`);

    // Create Garages
    const createdGarages = await Garage.create(garages);
    console.log(`Created ${createdGarages.length} garages`);

    // Create Trucks with assignments
    const trucksWithAssignments = trucks.map((truck, i) => ({
      ...truck,
      driver: createdDrivers[i % createdDrivers.length]._id,
      device: createdDevices[i % createdDevices.length]._id
    }));
    const createdTrucks = await Truck.create(trucksWithAssignments);
    console.log(`Created ${createdTrucks.length} trucks`);

    // Link devices to trucks
    for (let i = 0; i < createdTrucks.length; i++) {
      createdDevices[i].truck = createdTrucks[i]._id;
      await createdDevices[i].save();
    }

    // Create Shipments with truck assignment
    const shipmentsWithTrucks = shipments.map((shipment, i) => ({
      ...shipment,
      truck: createdTrucks[i % createdTrucks.length]._id,
      createdBy: createdUsers[0]._id
    }));
    const createdShipments = await Shipment.create(shipmentsWithTrucks);
    console.log(`Created ${createdShipments.length} shipments`);

    // Create Goods
    let goodsIndex = 0;
    for (const shipment of createdShipments) {
      const shipmentGoods = [];
      for (let i = 0; i < 2 && goodsIndex < goods.length; i++) {
        const good = { ...goods[goodsIndex], shipment: shipment._id };
        const createdGood = await Goods.create(good);
        shipmentGoods.push(createdGood._id);
        goodsIndex++;
      }
      if (shipmentGoods.length) {
        shipment.goods = shipmentGoods;
        await shipment.save();
      }
    }
    console.log(`Created ${goodsIndex} goods`);

    // Create Alerts
    const createdAlerts = await Alert.create(alerts);
    console.log(`Created ${createdAlerts.length} alerts`);

    // Summary
    console.log('\n Database Seeded!\n');
    console.log('Summary:');
    console.log(`   Users: ${createdUsers.length}`);
    console.log(`   Drivers: ${createdDrivers.length}`);
    console.log(`   Trucks: ${createdTrucks.length}`);
    console.log(`   Devices: ${createdDevices.length}`);
    console.log(`   Garages: ${createdGarages.length}`);
    console.log(`   Shipments: ${createdShipments.length}`);
    console.log(`   Goods: ${goodsIndex}`);
    console.log(`   Alerts: ${createdAlerts.length}\n`);
    
    console.log('Login:');
    console.log('   Admin: admin@fleet.com / Admin123!');
    console.log('   Officer: ahmed@fleet.com / Logistics123!\n');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Done');
  }
};

seedDatabase();
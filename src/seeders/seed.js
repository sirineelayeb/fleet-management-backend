const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Truck  = require('../models/Truck');
const Device = require('../models/Device');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected');

const trucks = await Truck.insertMany([
  { licensePlate: '123 TN 4567', brand: 'Mercedes', model: 'Actros', year: 2020, status: 'active', currentLocation: { type: 'Point', coordinates: [0, 0] } },
  { licensePlate: '234 TN 5678', brand: 'Volvo',    model: 'FH16',   year: 2021, status: 'active', currentLocation: { type: 'Point', coordinates: [0, 0] } },
  { licensePlate: '345 TN 6789', brand: 'MAN',      model: 'TGX',    year: 2019, status: 'active', currentLocation: { type: 'Point', coordinates: [0, 0] } },
]);
  console.log('Trucks created:', trucks.map(t => t._id));

  await Device.insertMany([
    { deviceId: 'ESP32-001', type: 'esp32', status: 'active', truck: trucks[0]._id },
    { deviceId: 'ESP32-002', type: 'esp32', status: 'active', truck: trucks[1]._id },
    { deviceId: 'ESP32-003', type: 'esp32', status: 'active', truck: trucks[2]._id },
  ]);
  console.log('Devices created and linked to trucks');

  await mongoose.disconnect();
  console.log('Done');
}

seed().catch(console.error);
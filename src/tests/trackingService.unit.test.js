const trackingService     = require('../services/trackingService');
const Shipment            = require('../models/Shipment');
const notificationService = require('../services/notificationService');

jest.mock('../models/Shipment');
jest.mock('../services/notificationService');

describe('TrackingService._startMission', () => {
  let io;
  let truck;
  let mission;
  let trip;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(trackingService, '_emitMissionEvent').mockImplementation(() => {});

    io = {};

    truck = {
      licensePlate: 'TN-1234',
    };

    mission = {
      status:        'not_started',
      startTime:     null,
      missionNumber: 'M-001',
      shipment: {
        _id:        's1',
        shipmentId: 'SH-001',
        origin:     'Tunis',
        destination: 'Sfax',
        assignedTo: 'mgr123',
      },
      save: jest.fn().mockResolvedValue(true),
    };

    trip = {
      status:    'planned',
      startTime: null,
      save:      jest.fn().mockResolvedValue(true),
    };

    notificationService.createNotification = jest.fn().mockResolvedValue(true);
    Shipment.findByIdAndUpdate             = jest.fn().mockResolvedValue(true);
  });

  // ----------------------------------------------------------------
  it('should set mission status to in_progress and save', async () => {
    await trackingService._startMission(truck, mission, null, io);

    expect(mission.status).toBe('in_progress');
    expect(mission.startTime).toBeInstanceOf(Date);
    expect(mission.save).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------
  it('should update trip status and startTime when trip is provided', async () => {
    await trackingService._startMission(truck, mission, trip, io);

    expect(trip.status).toBe('in_progress');
    expect(trip.startTime).toBeInstanceOf(Date);
    expect(trip.save).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------
  it('should skip trip update when trip is null', async () => {
    await trackingService._startMission(truck, mission, null, io);

    expect(trip.save).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  it('should update shipment status and actualDepartureDate', async () => {
    await trackingService._startMission(truck, mission, trip, io);

    expect(Shipment.findByIdAndUpdate).toHaveBeenCalledWith('s1', {
      status:              'in_progress',
      actualDepartureDate: expect.any(Date),
    });
  });

  // ----------------------------------------------------------------
  it('should skip shipment update when mission has no shipment', async () => {
    mission.shipment = null;
    await trackingService._startMission(truck, mission, null, io);

    expect(Shipment.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  it('should send mission_started notification with correct payload', async () => {
    await trackingService._startMission(truck, mission, trip, io);

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      'mission_started',
      {
        shipmentNumber: 'SH-001',
        origin:         'Tunis',
        destination:    'Sfax',
        truckPlate:     'TN-1234',
        missionNumber:  'M-001',
        managerId:      'mgr123',
      },
      io
    );
  });

  // ----------------------------------------------------------------
  it('should set managerId to null when assignedTo is missing', async () => {
    mission.shipment.assignedTo = undefined;
    await trackingService._startMission(truck, mission, trip, io);

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      'mission_started',
      expect.objectContaining({ managerId: null }),
      io
    );
  });

  // ----------------------------------------------------------------
  it('should emit mission_started socket event', async () => {
    await trackingService._startMission(truck, mission, trip, io);

    expect(trackingService._emitMissionEvent).toHaveBeenCalledWith(
      io,
      'mission_started',
      mission,
      truck
    );
  });
});
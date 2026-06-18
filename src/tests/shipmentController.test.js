jest.mock('../utils/catchAsync', () => fn => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    next(err);
  }
});

jest.mock('../models/Shipment', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn()
}));

jest.mock('../models/Mission', () => ({
  findOne: jest.fn()
}));

jest.mock('../models/TripHistory', () => ({
  deleteMany: jest.fn()
}));

jest.mock('../models/User', () => ({
  findById: jest.fn()
}));

jest.mock('../models/Truck', () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn()
}));

jest.mock('../models/Driver', () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn()
}));

jest.mock('../services/shipmentService', () => ({
  archiveShipment: jest.fn(),
  unarchiveShipment: jest.fn(),
  cancelActiveMission: jest.fn(),
  assignShipment: jest.fn(),
  freeResources: jest.fn(),
  sendCancellationNotification: jest.fn()
}));

jest.mock('../services/notificationService', () => ({
  createNotification: jest.fn()
}));

const shipmentController = require('../controllers/shipmentController');
const Shipment = require('../models/Shipment');
const Mission = require('../models/Mission');
const TripHistory = require('../models/TripHistory');
const User = require('../models/User');
const shipmentService = require('../services/shipmentService');

describe('Shipment Controller', () => {

  let res, next;

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  // ----------------------------------------------------------------
  describe('createShipment', () => {
    it('should create a shipment and return 201', async () => {
      const newShipment = { _id: 's1', origin: 'Tunis', destination: 'Sfax' };

      Shipment.create.mockResolvedValue(newShipment);

      const chainMock = {
        populate: jest.fn().mockReturnThis(),
        select:   jest.fn().mockResolvedValue(newShipment)
      };
      Shipment.findById.mockReturnValue(chainMock);

      const req = {
        body: { origin: 'Tunis', destination: 'Sfax' },
        user: { _id: 'user-1' }
      };

      await shipmentController.createShipment(req, res, next);

      expect(Shipment.create).toHaveBeenCalledWith({
        origin: 'Tunis',
        destination: 'Sfax',
        createdBy: 'user-1'
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Shipment created successfully'
      }));
    });
  });

  // ----------------------------------------------------------------
  describe('getShipment', () => {
    it('should return shipment for admin', async () => {
      const shipment = {
        _id: 's1',
        origin: 'Tunis',
        assignedTo: { _id: 'mgr-1' },
        createdBy:  { _id: 'user-1' },
        driver:     { _id: 'driver-1' }
      };

      const populateMock = jest.fn().mockResolvedValue(shipment);
      Shipment.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        select:   jest.fn().mockReturnValue({ populate: populateMock })
      });

      // chain all populates
      Shipment.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        then: undefined,
        populate: jest.fn().mockReturnThis(),
        [Symbol.iterator]: undefined
      });

      // simpler approach — mock the full chain resolving to shipment
      const chainMock = {
        populate: jest.fn().mockReturnThis(),
        select:   jest.fn().mockResolvedValue(shipment)
      };
      Shipment.findById.mockReturnValue(chainMock);

      const req = {
        params: { id: 's1' },
        user:   { role: 'admin', _id: 'admin-1' }
      };

      await shipmentController.getShipment(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: shipment });
    });

    it('should call next with 404 if shipment not found', async () => {
      const chainMock = {
        populate: jest.fn().mockReturnThis(),
        select:   jest.fn().mockResolvedValue(null)
      };
      Shipment.findById.mockReturnValue(chainMock);

      const req = {
        params: { id: 'nonexistent' },
        user:   { role: 'admin', _id: 'admin-1' }
      };

      await shipmentController.getShipment(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should call next with 403 if user has no access', async () => {
      const shipment = {
        _id:        's1',
        assignedTo: { _id: 'mgr-99' },
        createdBy:  { _id: 'user-99' },
        driver:     { _id: 'driver-99' }
      };

      const chainMock = {
        populate: jest.fn().mockReturnThis(),
        select:   jest.fn().mockResolvedValue(shipment)
      };
      Shipment.findById.mockReturnValue(chainMock);

      const req = {
        params: { id: 's1' },
        user:   { role: 'viewer', _id: 'stranger-1' }
      };

      await shipmentController.getShipment(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  describe('archiveShipment / unarchiveShipment', () => {
    it('should archive a shipment (admin only)', async () => {
      const shipment = { _id: 's1', isArchived: true };
      shipmentService.archiveShipment.mockResolvedValue(shipment);

      const req = {
        params: { id: 's1' },
        user:   { role: 'admin' }
      };

      await shipmentController.archiveShipment(req, res, next);

      expect(shipmentService.archiveShipment).toHaveBeenCalledWith('s1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Shipment archived',
        data: shipment
      });
    });

    it('should call next with 403 if not admin', async () => {
      const req = {
        params: { id: 's1' },
        user:   { role: 'shipment_manager' }
      };

      await shipmentController.archiveShipment(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(shipmentService.archiveShipment).not.toHaveBeenCalled();
    });

    it('should unarchive a shipment (admin only)', async () => {
      const shipment = { _id: 's1', isArchived: false };
      shipmentService.unarchiveShipment.mockResolvedValue(shipment);

      const req = {
        params: { id: 's1' },
        user:   { role: 'admin' }
      };

      await shipmentController.unarchiveShipment(req, res, next);

      expect(shipmentService.unarchiveShipment).toHaveBeenCalledWith('s1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Shipment restored',
        data: shipment
      });
    });
  });

  // ----------------------------------------------------------------
  describe('cancelShipment', () => {
    it('should cancel a shipment successfully', async () => {
      const shipment = {
        _id:         's1',
        status:      'assigned',
        createdBy:   'user-1',
        assignedTo:  null,
        save:        jest.fn().mockResolvedValue(true)
      };

      Shipment.findById.mockResolvedValue(shipment);
      shipmentService.cancelActiveMission.mockResolvedValue(true);

      const req = {
        params: { id: 's1' },
        body:   { reason: 'No longer needed' },
        user:   { role: 'admin', _id: 'admin-1' },
        io:     null
      };

      await shipmentController.cancelShipment(req, res, next);

      expect(shipmentService.cancelActiveMission).toHaveBeenCalledWith('s1', 'No longer needed');
      expect(shipment.status).toBe('cancelled');
      expect(shipment.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Shipment cancelled successfully'
      }));
    });

    it('should call next with 400 if shipment is already completed', async () => {
      const shipment = {
        _id:       's1',
        status:    'completed',
        createdBy: 'user-1'
      };

      Shipment.findById.mockResolvedValue(shipment);

      const req = {
        params: { id: 's1' },
        body:   {},
        user:   { role: 'admin', _id: 'admin-1' }
      };

      await shipmentController.cancelShipment(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  describe('deleteShipment', () => {
    it('should delete a shipment with no mission', async () => {
      const shipment = {
        _id:       's1',
        createdBy: 'user-1',
        deleteOne: jest.fn().mockResolvedValue(true)
      };

      Shipment.findById.mockResolvedValue(shipment);
      Mission.findOne.mockResolvedValue(null);
      TripHistory.deleteMany.mockResolvedValue(true);

      const req = {
        params: { id: 's1' },
        user:   { role: 'admin', _id: 'admin-1' }
      };

      await shipmentController.deleteShipment(req, res, next);

      expect(shipment.deleteOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Shipment deleted successfully'
      });
    });

    it('should call next with 404 if shipment not found', async () => {
      Shipment.findById.mockResolvedValue(null);

      const req = {
        params: { id: 'nonexistent' },
        user:   { role: 'admin', _id: 'admin-1' }
      };

      await shipmentController.deleteShipment(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  describe('assignToShipmentManager', () => {
    it('should assign a shipment to a manager', async () => {
      const shipment = {
        _id:        's1',
        assignedTo: null,
        save:       jest.fn().mockResolvedValue(true)
      };

      const manager = {
        _id:   'mgr-1',
        name:  'Ilyes Tlili',
        email: 'ilyes@quetratech.com',
        role:  'shipment_manager'
      };

      const populatedShipment = { _id: 's1', assignedTo: manager };

      Shipment.findById
        .mockResolvedValueOnce(shipment)
        .mockReturnValueOnce({
          populate: jest.fn().mockResolvedValue(populatedShipment)
        });

      User.findById.mockResolvedValue(manager);

      const req = {
        params: { id: 's1' },
        body:   { managerId: 'mgr-1' },
        user:   { role: 'admin', _id: 'admin-1', name: 'Admin' },
        io:     null
      };

      await shipmentController.assignToShipmentManager(req, res, next);

      expect(shipment.assignedTo).toBe('mgr-1');
      expect(shipment.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: `Shipment successfully assigned to ${manager.name}`
      }));
    });

    it('should call next with 403 if not admin', async () => {
      Shipment.findById.mockResolvedValue({ _id: 's1' });
      User.findById.mockResolvedValue({ role: 'shipment_manager' });

      const req = {
        params: { id: 's1' },
        body:   { managerId: 'mgr-1' },
        user:   { role: 'shipment_manager', _id: 'mgr-1' }
      };

      await shipmentController.assignToShipmentManager(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

});
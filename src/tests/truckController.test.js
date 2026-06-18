jest.mock('../utils/catchAsync', () => fn => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    next(err);
  }
});

jest.mock('../models/Truck', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  create: jest.fn()
}));

jest.mock('../services/truckService', () => ({
  getAvailableTrucks: jest.fn(),
  getTruckStats: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  updateStatus: jest.fn(),
  assignDriver: jest.fn(),
  unassignDriver: jest.fn(),
  assignDevice: jest.fn(),
  getRecentAssignments: jest.fn()
}));

const truckController = require('../controllers/truckController');
const Truck = require('../models/Truck');
const TruckService = require('../services/truckService');

describe('Truck Controller', () => {

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
  describe('getAvailableTrucks', () => {
    it('should return available trucks', async () => {
      const trucks = [
        { _id: '1', name: 'Truck 1' },
        { _id: '2', name: 'Truck 2' }
      ];
      TruckService.getAvailableTrucks.mockResolvedValue(trucks);

      await truckController.getAvailableTrucks({}, res, next);

      expect(TruckService.getAvailableTrucks).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, count: 2, data: trucks });
    });
  });

  // ----------------------------------------------------------------
  describe('archiveTruck / unarchiveTruck', () => {
    it('should archive a truck', async () => {
      const truck = {
        _id: '1',
        isArchived: false,
        status: 'available',
        save: jest.fn().mockResolvedValue(true)
      };
      Truck.findById.mockResolvedValue(truck);

      const req = { params: { id: '1' } };
      await truckController.archiveTruck(req, res, next);

      expect(truck.isArchived).toBe(true);
      expect(truck.status).toBe('inactive');
      expect(truck.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Truck archived successfully'
      });
    });

    it('should unarchive a truck', async () => {
      const truck = {
        _id: '1',
        isArchived: true,
        status: 'inactive',
        save: jest.fn().mockResolvedValue(true)
      };
      Truck.findById.mockResolvedValue(truck);

      const req = { params: { id: '1' } };
      await truckController.unarchiveTruck(req, res, next);

      expect(truck.isArchived).toBe(false);
      expect(truck.status).toBe('available');
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Truck restored successfully'
      });
    });
  });

  // ----------------------------------------------------------------
  describe('getTruck', () => {
    it('should return a single truck by id', async () => {
      const truck = { _id: '1', licensePlate: 'TN-001', brand: 'Mercedes' };
      Truck.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(truck)
        })
      });

      const req = { params: { id: '1' } };
      await truckController.getTruck(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: truck });
    });

    it('should call next with 404 if truck not found', async () => {
      Truck.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null)
        })
      });

      const req = { params: { id: 'nonexistent' } };
      await truckController.getTruck(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  describe('deleteTruck', () => {
    it('should delete a truck and return 200', async () => {
      TruckService.delete.mockResolvedValue(true);

      const req = { params: { id: '1' } };
      await truckController.deleteTruck(req, res, next);

      expect(TruckService.delete).toHaveBeenCalledWith('1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Truck deleted successfully'
      });
    });
  });

});
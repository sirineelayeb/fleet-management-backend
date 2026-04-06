const Driver = require('../models/Driver');
const Mission = require('../models/Mission');
const TripHistory = require('../models/TripHistory');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class PerformanceController {
  
  // GET /api/performance/driver/:driverId?period=month
  getDriverPerformance = catchAsync(async (req, res) => {
    const { driverId } = req.params;
    const { period = 'month' } = req.query;
    
    // Check if driver exists
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError('Driver not found', 404);
    }
    
    // Get date range based on period
    const dateRange = this.getDateRange(period);
    
    // Get completed missions in period
    const missions = await Mission.find({
      driver: driverId,
      status: 'completed',
      startTime: { $gte: dateRange.start, $lte: dateRange.end }
    }).populate('shipment truck');
    
    // Get trip histories for calculations
    const trips = await TripHistory.find({
      driver: driverId,
      status: 'completed',
      startTime: { $gte: dateRange.start, $lte: dateRange.end }
    });
    
    // Calculate metrics
    const metrics = this.calculateMetrics(missions, trips);
    
    // Get recent trips
    const recentTrips = await TripHistory.find({
      driver: driverId,
      status: 'completed'
    })
      .populate('truck', 'licensePlate brand model')
      .populate('shipment', 'origin destination')
      .sort({ endTime: -1 })
      .limit(10);
    
    res.status(200).json({
      success: true,
      data: {
        driver: {
          id: driver._id,
          name: driver.name,
          phone: driver.phone,
          score: driver.score,
          status: driver.status,
          photo: driver.photo
        },
        period: period,
        metrics: metrics,
        recentTrips: recentTrips
      }
    });
  });
  
  // GET /api/performance/leaderboard
  getLeaderboard = catchAsync(async (req, res) => {
    const { limit = 10, period = 'month' } = req.query;
    
    const dateRange = this.getDateRange(period);
    
    // Get all active drivers with their performance
    const drivers = await Driver.find({ isActive: true })
      .select('name phone score photo status');
    
    // Calculate additional metrics for each driver
    const driversWithStats = await Promise.all(drivers.map(async (driver) => {
      const missions = await Mission.find({
        driver: driver._id,
        status: 'completed',
        startTime: { $gte: dateRange.start, $lte: dateRange.end }
      });
      
      const trips = await TripHistory.find({
        driver: driver._id,
        status: 'completed',
        startTime: { $gte: dateRange.start, $lte: dateRange.end }
      });
      
      const totalDistance = trips.reduce((sum, t) => sum + (t.actualDistanceKm || 0), 0);
      const totalTrips = missions.length;
      const onTimeTrips = missions.filter(m => {
        const plannedEnd = new Date(m.startTime);
        plannedEnd.setHours(plannedEnd.getHours() + (m.shipment?.estimatedDuration || 24));
        return m.endTime <= plannedEnd;
      }).length;
      
      const onTimeRate = totalTrips > 0 ? (onTimeTrips / totalTrips) * 100 : 0;
      
      return {
        id: driver._id,
        name: driver.name,
        phone: driver.phone,
        score: driver.score,
        status: driver.status,
        photo: driver.photo,
        stats: {
          totalTrips,
          totalDistance: totalDistance.toFixed(1),
          onTimeRate: onTimeRate.toFixed(1)
        }
      };
    }));
    
    // Sort by score (highest first)
    const sortedDrivers = driversWithStats.sort((a, b) => b.score - a.score);
    
    res.status(200).json({
      success: true,
      data: sortedDrivers.slice(0, parseInt(limit)),
      period: period
    });
  });
  
  // GET /api/performance/driver/:driverId/trends
  getDriverTrends = catchAsync(async (req, res) => {
    const { driverId } = req.params;
    const { weeks = 12 } = req.query;
    
    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new AppError('Driver not found', 404);
    }
    
    const trends = [];
    const now = new Date();
    
    for (let i = 0; i < parseInt(weeks); i++) {
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - (i * 7));
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 7);
      
      const weekTrips = await TripHistory.find({
        driver: driverId,
        status: 'completed',
        endTime: { $gte: weekStart, $lte: weekEnd }
      });
      
      const weekMissions = await Mission.find({
        driver: driverId,
        status: 'completed',
        endTime: { $gte: weekStart, $lte: weekEnd }
      });
      
      const totalDistance = weekTrips.reduce((sum, t) => sum + (t.actualDistanceKm || 0), 0);
      const totalDuration = weekTrips.reduce((sum, t) => sum + (t.actualDurationHours || 0), 0);
      const avgSpeed = totalDuration > 0 ? totalDistance / totalDuration : 0;
      
      // Calculate on-time rate
      const onTimeCount = weekMissions.filter(m => {
        const plannedEnd = new Date(m.startTime);
        plannedEnd.setHours(plannedEnd.getHours() + 24);
        return m.endTime <= plannedEnd;
      }).length;
      
      const onTimeRate = weekMissions.length > 0 ? (onTimeCount / weekMissions.length) * 100 : 0;
      
      trends.unshift({
        week: weekStart.toISOString().split('T')[0],
        trips: weekTrips.length,
        distance: parseFloat(totalDistance.toFixed(1)),
        avgSpeed: parseFloat(avgSpeed.toFixed(1)),
        onTimeRate: parseFloat(onTimeRate.toFixed(1))
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        driver: {
          id: driver._id,
          name: driver.name
        },
        trends: trends.slice(0, parseInt(weeks))
      }
    });
  });
  
  // ============================================================
  // HELPER METHODS
  // ============================================================
  
  getDateRange(period) {
    const now = new Date();
    const start = new Date();
    
    switch(period) {
      case 'week':
        start.setDate(now.getDate() - 7);
        break;
      case 'month':
        start.setMonth(now.getMonth() - 1);
        break;
      case 'quarter':
        start.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        start.setFullYear(now.getFullYear() - 1);
        break;
      default:
        start.setMonth(now.getMonth() - 1);
    }
    
    return { start, end: now };
  }
  
  calculateMetrics(missions, trips) {
    const totalTrips = missions.length;
    
    if (totalTrips === 0) {
      return {
        totalTrips: 0,
        onTimeDeliveryRate: 0,
        averageDeliveryTime: 0,
        totalDistance: 0,
        totalDuration: 0,
        averageSpeed: 0,
        fuelEfficiency: 0,
        utilizationRate: 0,
        score: 0
      };
    }
    
    // On-time deliveries
    const onTimeDeliveries = missions.filter(m => {
      const plannedEnd = new Date(m.startTime);
      plannedEnd.setHours(plannedEnd.getHours() + (m.shipment?.estimatedDuration || 24));
      return m.endTime <= plannedEnd;
    }).length;
    
    // Total distance and duration
    const totalDistance = trips.reduce((sum, t) => sum + (t.actualDistanceKm || 0), 0);
    const totalDuration = trips.reduce((sum, t) => sum + (t.actualDurationHours || 0), 0);
    const totalFuel = trips.reduce((sum, t) => sum + (t.fuelConsumption || 0), 0);
    
    // Average speed
    const avgSpeed = totalDuration > 0 ? totalDistance / totalDuration : 0;
    
    // Fuel efficiency
    const fuelEfficiency = totalFuel > 0 ? totalDistance / totalFuel : 0;
    
    // Utilization rate (assuming 8-hour workday)
    const utilizationRate = totalTrips > 0 ? (totalDuration / (totalTrips * 8)) * 100 : 0;
    
    // Calculate overall score (0-100)
    const onTimeScore = (onTimeDeliveries / totalTrips) * 40;
    const speedScore = Math.min(20, (avgSpeed / 80) * 20);
    const fuelScore = Math.min(20, (fuelEfficiency / 5) * 20);
    const distanceScore = Math.min(10, (totalDistance / 1000) * 10);
    const safetyScore = 10; // Placeholder for safety metrics
    
    const overallScore = Math.min(100, Math.round(
      onTimeScore + speedScore + fuelScore + distanceScore + safetyScore
    ));
    
    return {
      totalTrips,
      onTimeDeliveryRate: parseFloat(((onTimeDeliveries / totalTrips) * 100).toFixed(1)),
      averageDeliveryTime: totalTrips > 0 ? parseFloat((totalDuration / totalTrips).toFixed(1)) : 0,
      totalDistance: parseFloat(totalDistance.toFixed(1)),
      totalDuration: parseFloat(totalDuration.toFixed(1)),
      averageSpeed: parseFloat(avgSpeed.toFixed(1)),
      fuelEfficiency: parseFloat(fuelEfficiency.toFixed(1)),
      utilizationRate: parseFloat(utilizationRate.toFixed(1)),
      score: overallScore
    };
  }
}

module.exports = new PerformanceController();
const LprEvent = require('../models/LprEvent');
const Truck = require('../models/Truck');
const Shipment = require('../models/Shipment');
const AppError = require('../utils/AppError');
const notificationService = require('./notificationService');

class LprService {

  // ── Helpers ──────────────────────────────────────────────────

  normalizePlate(plate) {
    if (!plate) return plate;
    return plate.trim().toUpperCase();
  }

  validateTunisianFormat(plate) {
    const pattern = /^\d{1,3}\s?TN\s?\d{3,4}$/i;
    return pattern.test(plate);
  }

  // ── Core ─────────────────────────────────────────────────────

  async detect({ plateNumber, direction, cameraId, loadingZone, confidence, source }, io = null) {
    const normalized = this.normalizePlate(plateNumber);
    const now = new Date();

    // 1 — Find truck
    const truck = await Truck.findOne({
      licensePlate: { $regex: new RegExp(`^${normalized}$`, 'i') }
    });

    let matchedShipment = null;
    let isAuthorized = false;
    let entryStatus = null; // 'on_time' | 'late' | 'early' | null

    if (truck) {
      // 2 — Find active shipment for this truck
      matchedShipment = await Shipment.findOne({
        truck: truck._id,
        status: { $in: ['pending', 'assigned', 'in_progress'] }
      }).sort({ plannedDepartureDate: 1 });

      if (matchedShipment) {
        isAuthorized = true;

        // 3 — Check timing on ENTRY
        if (direction === 'entry' && matchedShipment.plannedDepartureDate) {
          const planned = new Date(matchedShipment.plannedDepartureDate);
          const diffMins = (now - planned) / 1000 / 60;

          if (diffMins > 30) {
            entryStatus = 'late';    // more than 30min after planned departure
          } else if (diffMins < -120) {
            entryStatus = 'early';   // more than 2h before planned departure
          } else {
            entryStatus = 'on_time';
          }

          // Save loading start time when truck enters
          await Shipment.findByIdAndUpdate(matchedShipment._id, {
            loadingStartedAt: now,
            $unset: { loadingCompletedAt: 1, actualLoadingDurationMinutes: 1 } // Clear exit data if any
          });
        }

        // 4 — Calculate loading duration on EXIT
        if (direction === 'exit') {
          // Find the most recent entry event for this truck and shipment
          const entryEvent = await LprEvent.findOne({
            truck: truck._id,
            direction: 'entry',
            matchedShipment: matchedShipment._id
          }).sort({ createdAt: -1 });

          if (entryEvent) {
            const durationMins = Math.round(
              (now - new Date(entryEvent.createdAt)) / 1000 / 60
            );

            // Update shipment with actual loading times
            await Shipment.findByIdAndUpdate(matchedShipment._id, {
              loadingStartedAt: entryEvent.createdAt,
              loadingCompletedAt: now,
              actualLoadingDurationMinutes: durationMins
            });
          } else {
            // No entry event found - log warning but still save exit
            console.warn(`Exit event for truck ${normalized} but no matching entry event found`);
            await Shipment.findByIdAndUpdate(matchedShipment._id, {
              loadingCompletedAt: now
            });
          }
        }
      }
    }

    // 5 — Save event
    const event = await LprEvent.create({
      plateNumber: normalized,
      direction,
      cameraId: cameraId || 'manual',
      loadingZone: matchedShipment?.loadingZone || loadingZone || null,
      confidence: confidence ?? 1.0,
      source: source || 'manual',
      truck: truck?._id || null,
      matchedShipment: matchedShipment?._id || null,
      isAuthorized,
      entryStatus,
      minutesFromPlanned: direction === 'entry' && matchedShipment?.plannedDepartureDate
        ? Math.round((now - new Date(matchedShipment.plannedDepartureDate)) / 1000 / 60)
        : null
    });

    // 6 — Send notifications
    await this._notifyDetection({
      io, normalized, direction, cameraId,
      truck, matchedShipment, isAuthorized, entryStatus, now
    });

    // 7 — Return populated event
    return await LprEvent.findById(event._id)
      .populate('truck', 'licensePlate brand model status')
      .populate('matchedShipment', 'shipmentId plannedDepartureDate status loadingStartedAt loadingCompletedAt actualLoadingDurationMinutes')
      .populate('loadingZone', 'name location description');
  }

  // ── Notification dispatcher ───────────────────────────────────

  async _notifyDetection({ io, normalized, direction, cameraId, truck, matchedShipment, isAuthorized, entryStatus, now }) {
    try {
      // Unknown truck
      if (!truck) {
        await notificationService.createNotification('access_denied', {
          licensePlate: normalized,
          accessType: direction,
          gateName: cameraId || 'gate',
          reason: 'Truck not registered in system',
        }, io);
        return;
      }

      // Truck registered but no active shipment
      if (!matchedShipment) {
        await notificationService.createNotification('access_denied', {
          licensePlate: normalized,
          accessType: direction,
          gateName: cameraId || 'gate',
          reason: 'No active shipment for this truck',
        }, io);
        return;
      }

      // Entry notifications
      if (direction === 'entry') {
        if (entryStatus === 'on_time') {
          await notificationService.createNotification('truck_entry_authorized', {
            licensePlate: normalized,
            direction,
            shipmentId: matchedShipment.shipmentId,
            plannedDepartureDate: matchedShipment.plannedDepartureDate,
          }, io);
        }

        if (entryStatus === 'late') {
          await notificationService.createNotification('truck_entry_late', {
            licensePlate: normalized,
            shipmentId: matchedShipment.shipmentId,
            minutesLate: Math.round((now - new Date(matchedShipment.plannedDepartureDate)) / 1000 / 60),
            plannedDepartureDate: matchedShipment.plannedDepartureDate,
          }, io);
        }

        // Early — just log, no alert needed
        if (entryStatus === 'early') {
          console.log(`Truck ${normalized} arrived early for shipment ${matchedShipment.shipmentId}`);
        }
      }

      // Exit notification
      if (direction === 'exit') {
        const updatedShipment = await Shipment.findById(matchedShipment._id);
        
        await notificationService.createNotification('loading_completed', {
          shipmentNumber: matchedShipment.shipmentId,
          duration: updatedShipment.actualLoadingDurationMinutes,
          loadingStartedAt: updatedShipment.loadingStartedAt,
          loadingCompletedAt: updatedShipment.loadingCompletedAt,
          managerId: updatedShipment.assignedTo?.toString() || null, // ← add this
        }, io);
      }

    } catch (err) {
      console.error('LPR notification error:', err);
      // Never crash detection because of notification failure
    }
  }

  // ── Validate ──────────────────────────────────────────────────

  async validate(plateNumber) {
    const normalized = this.normalizePlate(plateNumber);
    const now = new Date();

    const truck = await Truck.findOne({
      licensePlate: { $regex: new RegExp(`^${normalized}$`, 'i') }
    });

    if (!truck) {
      return { authorized: false, reason: 'Truck not found in system', truck: null, shipment: null };
    }

    const latestEntry = await LprEvent.findOne({
      plateNumber: normalized,
      direction: 'entry'
    }).sort({ createdAt: -1 });

    // Find active shipment — within 2h window of plannedDepartureDate
    const shipment = await Shipment.findOne({
      truck: truck._id,
      status: { $in: ['pending', 'assigned', 'in_progress'] },
      plannedDepartureDate: { $gte: new Date(now - 2 * 60 * 60 * 1000) }
    }).sort({ plannedDepartureDate: 1 });

    return {
      authorized: !!shipment,
      reason: shipment ? 'Valid shipment found' : 'No active shipment in time window',
      truck,
      shipment,
      latestEntry
    };
  }

  // ── Queries ───────────────────────────────────────────────────

  async getEvents({ plate, direction, from, to, page = 1, limit = 20 }) {
    const filter = {};
    if (plate) filter.plateNumber = { $regex: plate, $options: 'i' };
    if (direction) filter.direction = direction;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const skip = (page - 1) * limit;
    const total = await LprEvent.countDocuments(filter);
    const data = await LprEvent.find(filter)
      .populate('truck', 'licensePlate brand model')
      .populate('matchedShipment', 'shipmentId status plannedDepartureDate loadingStartedAt loadingCompletedAt actualLoadingDurationMinutes')
      .populate('loadingZone', 'name location description')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return { total, page: parseInt(page), limit: parseInt(limit), data };
  }

  async getStats() {
    const [totalEvents, entries, exits, unauthorized, authorizedEntries, lateEntries] = await Promise.all([
      LprEvent.countDocuments(),
      LprEvent.countDocuments({ direction: 'entry' }),
      LprEvent.countDocuments({ direction: 'exit' }),
      LprEvent.countDocuments({ isAuthorized: false }),
      LprEvent.countDocuments({ isAuthorized: true, direction: 'entry' }),
      LprEvent.countDocuments({ entryStatus: 'late' })
    ]);

    return { totalEvents, entries, exits, unauthorized, authorizedEntries, lateEntries };
  }

  async getEventsByShipment(shipmentId) {
    const events = await LprEvent.find({ matchedShipment: shipmentId })
      .populate('truck', 'licensePlate brand model')
      .populate('matchedShipment', 'shipmentId plannedDepartureDate plannedDeliveryDate status loadingStartedAt loadingCompletedAt actualLoadingDurationMinutes')
      .sort({ createdAt: 1 });

    const entryEvent = events.find(e => e.direction === 'entry');
    const exitEvent = events.find(e => e.direction === 'exit');

    let arrivedOnTime = null;
    let minutesFromPlanned = null;

    if (entryEvent && entryEvent.matchedShipment?.plannedDepartureDate) {
      const planned = new Date(entryEvent.matchedShipment.plannedDepartureDate);
      const actual = new Date(entryEvent.createdAt);
      minutesFromPlanned = Math.round((actual - planned) / 1000 / 60);
      // on time = arrived within 30min after planned departure
      // negative = arrived early
      arrivedOnTime = minutesFromPlanned <= 30;
    }

    return {
      shipmentId,
      events,
      summary: {
        entryTime: entryEvent?.createdAt || null,
        exitTime: exitEvent?.createdAt || null,
        arrivedOnTime,
        minutesFromPlanned, // negative = early, positive = late
        totalEvents: events.length
      }
    };
  }

  // ── Delete ────────────────────────────────────────────────────

  async deleteEvent(eventId, userId, userRole) {
    if (userRole !== 'admin') {
      throw new AppError('Only admins can delete LPR events', 403);
    }

    const event = await LprEvent.findById(eventId);
    if (!event) {
      throw new AppError('LPR event not found', 404);
    }

    await event.deleteOne();
    console.log(`LPR event ${eventId} deleted by user ${userId}`);
    return { success: true, message: 'LPR event deleted successfully' };
  }

  async deleteEventsByFilter(filter, userId, userRole) {
    if (userRole !== 'admin') {
      throw new AppError('Only admins can bulk delete LPR events', 403);
    }

    const result = await LprEvent.deleteMany(filter);
    console.log(`Bulk deleted ${result.deletedCount} LPR events by user ${userId}`, filter);
    return {
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} events deleted successfully`
    };
  }
}

module.exports = new LprService();
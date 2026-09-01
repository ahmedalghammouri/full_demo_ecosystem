import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  NotificationType,
  NotificationCategory,
  NotificationSeverity,
  UserRole,
} from '@prisma/client';

import { NotificationsService } from './notifications.service';

/**
 * Bridges domain events (emitted by the production / quality / maintenance /
 * downtime / iot services) into persisted, per-user notifications.
 *
 * For each event we build a normalized "base" notification + a sensible default
 * recipient role set. Custom NotificationRules (configured in the UI) take
 * precedence: if any active rule matches the event, only those rules fire;
 * otherwise the built-in defaults are used so the system works out of the box.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  // Managers/admins that should see most factory-wide operational events.
  private readonly OPS = [
    UserRole.FACTORY_ADMIN,
    UserRole.PLANT_MANAGER,
  ];

  constructor(private readonly notifications: NotificationsService) {}

  private async notify(
    eventType: string,
    factoryId: string | null,
    base: {
      type: NotificationType;
      category: NotificationCategory;
      severity: NotificationSeverity;
      title: string;
      message: string;
      link?: string;
      data?: Record<string, unknown>;
    },
    defaultRoles: UserRole[],
  ): Promise<void> {
    try {
      const matched = await this.notifications.evaluateRules(factoryId, eventType, base.data ?? {}, base);
      if (matched > 0) return; // custom rules handled it

      await this.notifications.dispatch({
        factoryId,
        type: base.type,
        category: base.category,
        severity: base.severity,
        title: base.title,
        message: base.message,
        link: base.link,
        data: base.data,
        roles: [...new Set([...this.OPS, ...defaultRoles])],
      });
    } catch (err) {
      this.logger.error(`Failed to handle ${eventType}`, err as Error);
    }
  }

  // ── PRODUCTION ──────────────────────────────────────────────
  @OnEvent('production.work-order.started')
  onWorkOrderStarted(p: { workOrder: any; factoryId: string }) {
    return this.notify('production.work-order.started', p.factoryId, {
      type: NotificationType.PRODUCTION,
      category: NotificationCategory.PRODUCTION,
      severity: NotificationSeverity.INFO,
      title: 'Work Order Started',
      message: `Work order ${p.workOrder?.orderNumber} started`,
      link: '/production/orders',
      data: { orderNumber: p.workOrder?.orderNumber },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR]);
  }

  @OnEvent('production.work-order.held')
  onWorkOrderHeld(p: { workOrder: any; factoryId: string }) {
    return this.notify('production.work-order.held', p.factoryId, {
      type: NotificationType.PRODUCTION,
      category: NotificationCategory.PRODUCTION,
      severity: NotificationSeverity.WARNING,
      title: 'Work Order On Hold',
      message: `WO ${p.workOrder?.orderNumber} put on hold: ${p.workOrder?.reason ?? '—'}`,
      link: '/production/orders',
      data: { orderNumber: p.workOrder?.orderNumber, reason: p.workOrder?.reason },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR]);
  }

  // ── DOWNTIME ────────────────────────────────────────────────
  @OnEvent('downtime.event.created')
  onDowntimeCreated(p: { event: any; factoryId: string; machineName: string }) {
    if (p.event?.isPlanned) return; // only unplanned downtime notifies
    return this.notify('downtime.event.created', p.factoryId, {
      type: NotificationType.DOWNTIME,
      category: NotificationCategory.DOWNTIME,
      severity: NotificationSeverity.WARNING,
      title: 'Unplanned Downtime',
      message: `${p.machineName} stopped — ${p.event?.category}`,
      link: '/production/downtime',
      data: { machineName: p.machineName, category: p.event?.category },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR, UserRole.MAINTENANCE_MANAGER]);
  }

  @OnEvent('downtime.auto.created')
  onAutoDowntime(p: { machineId: string; machineName: string; factoryId: string }) {
    return this.notify('downtime.auto.created', p.factoryId, {
      type: NotificationType.DOWNTIME,
      category: NotificationCategory.DOWNTIME,
      severity: NotificationSeverity.WARNING,
      title: 'Auto-Detected Downtime',
      message: `${p.machineName} has been idle > 1 minute`,
      link: '/production/downtime',
      data: { machineName: p.machineName },
    }, [UserRole.PRODUCTION_SUPERVISOR, UserRole.MAINTENANCE_MANAGER]);
  }

  // ── QUALITY ─────────────────────────────────────────────────
  @OnEvent('quality.inspection.failed')
  onInspectionFailed(p: { inspection: any; factoryId: string }) {
    return this.notify('quality.inspection.failed', p.factoryId, {
      type: NotificationType.QUALITY,
      category: NotificationCategory.QUALITY,
      severity: NotificationSeverity.ERROR,
      title: 'Inspection Failed',
      message: `Inspection ${p.inspection?.inspectionNumber} failed — ${p.inspection?.failQty} units rejected`,
      link: '/quality/inspections',
      data: { inspectionNumber: p.inspection?.inspectionNumber, failQty: p.inspection?.failQty },
    }, [UserRole.QUALITY_MANAGER, UserRole.QUALITY_ENGINEER]);
  }

  @OnEvent('quality.ncr.created')
  onNcrCreated(p: { ncr: any; factoryId: string }) {
    // Critical NCRs also emit `quality.ncr.critical` — avoid a duplicate notification.
    if (String(p.ncr?.severity).toUpperCase() === 'CRITICAL') return;
    return this.notify('quality.ncr.created', p.factoryId, {
      type: NotificationType.QUALITY,
      category: NotificationCategory.QUALITY,
      severity: NotificationSeverity.WARNING,
      title: 'New NCR Raised',
      message: `NCR ${p.ncr?.ncrNumber}: ${p.ncr?.title}`,
      link: '/quality/ncr',
      data: { ncrNumber: p.ncr?.ncrNumber, title: p.ncr?.title },
    }, [UserRole.QUALITY_MANAGER, UserRole.QUALITY_ENGINEER]);
  }

  @OnEvent('quality.ncr.critical')
  onCriticalNcr(p: { ncr: any; factoryId: string }) {
    return this.notify('quality.ncr.critical', p.factoryId, {
      type: NotificationType.QUALITY,
      category: NotificationCategory.QUALITY,
      severity: NotificationSeverity.CRITICAL,
      title: 'CRITICAL NCR',
      message: `Critical non-conformance: ${p.ncr?.title}`,
      link: '/quality/ncr',
      data: { ncrNumber: p.ncr?.ncrNumber, title: p.ncr?.title },
    }, [UserRole.QUALITY_MANAGER, UserRole.QUALITY_ENGINEER, UserRole.PRODUCTION_MANAGER]);
  }

  // ── MAINTENANCE ─────────────────────────────────────────────
  @OnEvent('maintenance.wo.created')
  onMaintenanceCreated(p: { wo: any; factoryId: string; isEmergency: boolean }) {
    if (!p.isEmergency) return; // only emergency maintenance notifies by default
    return this.notify('maintenance.wo.created', p.factoryId, {
      type: NotificationType.MAINTENANCE,
      category: NotificationCategory.MAINTENANCE,
      severity: NotificationSeverity.ERROR,
      title: 'EMERGENCY Maintenance',
      message: `Emergency WO ${p.wo?.woNumber} — ${p.wo?.title}`,
      link: '/maintenance/work-orders',
      data: { woNumber: p.wo?.woNumber, title: p.wo?.title },
    }, [UserRole.MAINTENANCE_MANAGER, UserRole.MAINTENANCE_TECHNICIAN, UserRole.PRODUCTION_MANAGER]);
  }

  @OnEvent('maintenance.wo.assigned')
  onMaintenanceAssigned(p: { wo: any; technicianId?: string; technicianName: string; factoryId: string }) {
    // Targeted: notify the assigned technician directly.
    if (!p.technicianId) return;
    return this.notifications.dispatch({
      factoryId: p.factoryId,
      type: NotificationType.MAINTENANCE,
      category: NotificationCategory.MAINTENANCE,
      severity: NotificationSeverity.INFO,
      title: 'Maintenance Assigned to You',
      message: `You have been assigned WO ${p.wo?.woNumber}`,
      link: '/maintenance/work-orders',
      data: { woNumber: p.wo?.woNumber },
      userIds: [p.technicianId],
    }).catch((e) => this.logger.error('maintenance.wo.assigned failed', e as Error));
  }

  // ── MACHINE STATE ───────────────────────────────────────────
  @OnEvent('machine.state.changed')
  onMachineStateChanged(p: { machineId: string; machineName: string; factoryId: string; newState: string }) {
    if (p.newState !== 'BREAKDOWN') return;
    return this.notify('machine.state.changed', p.factoryId, {
      type: NotificationType.ALARM,
      category: NotificationCategory.ALARM,
      severity: NotificationSeverity.ERROR,
      title: 'Machine Breakdown',
      message: `${p.machineName} entered BREAKDOWN state`,
      link: '/iot/devices',
      data: { machineName: p.machineName },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.MAINTENANCE_MANAGER, UserRole.MAINTENANCE_TECHNICIAN]);
  }

  // ── PRODUCTION (continued) ──────────────────────────────────
  @OnEvent('production.work-order.completed')
  onWorkOrderCompleted(p: { workOrder: any; factoryId: string }) {
    return this.notify('production.work-order.completed', p.factoryId, {
      type: NotificationType.PRODUCTION,
      category: NotificationCategory.PRODUCTION,
      severity: NotificationSeverity.SUCCESS,
      title: 'Work Order Completed',
      message: `WO ${p.workOrder?.orderNumber} completed (OEE ${Math.round(p.workOrder?.oee ?? 0)}%)`,
      link: '/production/orders',
      data: { orderNumber: p.workOrder?.orderNumber, oee: p.workOrder?.oee },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR]);
  }

  @OnEvent('production.work-order.cancelled')
  onWorkOrderCancelled(p: { workOrder: any; factoryId: string }) {
    return this.notify('production.work-order.cancelled', p.factoryId, {
      type: NotificationType.PRODUCTION,
      category: NotificationCategory.PRODUCTION,
      severity: NotificationSeverity.WARNING,
      title: 'Work Order Cancelled',
      message: `WO ${p.workOrder?.orderNumber} was cancelled`,
      link: '/production/orders',
      data: { orderNumber: p.workOrder?.orderNumber },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR]);
  }

  // ── PLANNING ────────────────────────────────────────────────
  @OnEvent('production.reschedule.requested')
  onRescheduleRequested(p: { workOrderId: string; productionOrderId?: string; source?: string; factoryId: string }) {
    return this.notify('production.reschedule.requested', p.factoryId, {
      type: NotificationType.PRODUCTION,
      category: NotificationCategory.PRODUCTION,
      severity: NotificationSeverity.WARNING,
      title: 'Reschedule Requested',
      message: `A reschedule was requested${p.source ? ` (${p.source.replace(/_/g, ' ').toLowerCase()})` : ''} — review pending`,
      link: '/scheduling/reschedule-requests',
      data: { workOrderId: p.workOrderId, productionOrderId: p.productionOrderId, source: p.source },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR]);
  }

  @OnEvent('production.material-shortage.raised')
  onMaterialShortage(p: { workOrderId: string; shortages?: any[]; factoryId: string }) {
    const n = p.shortages?.length ?? 0;
    return this.notify('production.material-shortage.raised', p.factoryId, {
      type: NotificationType.SYSTEM,
      category: NotificationCategory.INVENTORY,
      severity: NotificationSeverity.ERROR,
      title: 'Material Shortage',
      message: `${n} material shortage${n === 1 ? '' : 's'} raised for a work order`,
      link: '/inventory/material-requests',
      data: { workOrderId: p.workOrderId, count: n },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR]);
  }

  // ── MAINTENANCE (continued) ─────────────────────────────────
  @OnEvent('maintenance.wo.completed')
  onMaintenanceCompleted(p: { wo: any; factoryId: string }) {
    return this.notify('maintenance.wo.completed', p.factoryId, {
      type: NotificationType.MAINTENANCE,
      category: NotificationCategory.MAINTENANCE,
      severity: NotificationSeverity.SUCCESS,
      title: 'Maintenance Completed',
      message: `Maintenance WO ${p.wo?.woNumber ?? ''} completed`,
      link: '/maintenance/work-orders',
      data: { woNumber: p.wo?.woNumber },
    }, [UserRole.MAINTENANCE_MANAGER]);
  }

  // ── QUALITY (continued) ─────────────────────────────────────
  @OnEvent('quality.capa.created')
  onCapaCreated(p: { capa: any; factoryId: string }) {
    return this.notify('quality.capa.created', p.factoryId, {
      type: NotificationType.QUALITY,
      category: NotificationCategory.QUALITY,
      severity: NotificationSeverity.WARNING,
      title: 'New CAPA Opened',
      message: `CAPA ${p.capa?.capaNumber ?? ''} opened${p.capa?.type ? ` (${p.capa.type})` : ''}`,
      link: '/quality/capa',
      data: { capaNumber: p.capa?.capaNumber, type: p.capa?.type },
    }, [UserRole.QUALITY_MANAGER, UserRole.QUALITY_ENGINEER]);
  }

  // ── ENERGY ──────────────────────────────────────────────────
  @OnEvent('energy.anomaly.detected')
  onEnergyAnomaly(p: { readingId: string; machineId?: string; factoryId: string }) {
    return this.notify('energy.anomaly.detected', p.factoryId, {
      type: NotificationType.ENERGY,
      category: NotificationCategory.ENERGY,
      severity: NotificationSeverity.WARNING,
      title: 'Energy Anomaly',
      message: 'Abnormal energy consumption detected',
      link: '/energy',
      data: { readingId: p.readingId, machineId: p.machineId },
    }, [UserRole.ENERGY_MANAGER]);
  }

  // ── ALARMS ──────────────────────────────────────────────────
  @OnEvent('alarm.created')
  onAlarmCreated(p: { alarm: any; factoryId: string }) {
    const sev = String(p.alarm?.severity ?? '').toUpperCase();
    const severity = sev === 'CRITICAL' ? NotificationSeverity.CRITICAL
      : sev === 'HIGH' ? NotificationSeverity.ERROR
      : sev === 'MEDIUM' ? NotificationSeverity.WARNING
      : NotificationSeverity.INFO;
    return this.notify('alarm.created', p.factoryId, {
      type: NotificationType.ALARM,
      category: NotificationCategory.ALARM,
      severity,
      title: `Alarm — ${sev || 'TRIGGERED'}`,
      message: p.alarm?.description ?? 'A shop-floor alarm was raised',
      link: '/alarms',
      data: { severity: sev, description: p.alarm?.description },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR, UserRole.MAINTENANCE_MANAGER]);
  }
}

import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit,
  MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';

import { corsOriginCallback, getCorsOrigins } from '../common/cors.util';

@WebSocketGateway({
  cors: {
    // Same policy as the HTTP API so the real-time feed works from LAN IPs and
    // the industry360 / industry360 domain family, not just CORS_ORIGINS.
    origin: corsOriginCallback(getCorsOrigins(process.env.CORS_ORIGINS)),
    credentials: true,
  },
  namespace: '/',
})
export class MesWebSocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MesWebSocketGateway.name);
  private readonly connectedClients = new Map<string, { userId: string; factoryId: string | null; socket: Socket }>();

  constructor(private readonly jwtService: JwtService) {}

  afterInit(_server: Server) {
    this.logger.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token as string ||
        client.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) { client.disconnect(); return; }

      const payload = this.jwtService.verify<{ sub: string; factoryId: string | null }>(token);
      this.connectedClients.set(client.id, {
        userId: payload.sub,
        factoryId: payload.factoryId,
        socket: client,
      });

      if (payload.factoryId) {
        await client.join(`factory:${payload.factoryId}`);
      } else {
        await client.join('factory:all');
      }
      await client.join(`user:${payload.sub}`);

      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
      client.emit('connected', {
        message: 'Connected to Industry360° real-time feed',
        timestamp: new Date().toISOString(),
      });
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:machines')
  handleMachineSubscription(
    @MessageBody() data: { machineIds: string[] },
    @ConnectedSocket() client: Socket,
  ) {
    data.machineIds.forEach((id) => client.join(`machine:${id}`));
    return { subscribed: data.machineIds };
  }

  @SubscribeMessage('subscribe:alarms')
  handleAlarmSubscription(@ConnectedSocket() client: Socket) {
    client.join('alarms:active');
    return { subscribed: 'alarms' };
  }

  // ────────────────────────────────────────────────────────────
  // PRODUCTION EVENTS
  // ────────────────────────────────────────────────────────────

  @OnEvent('production.work-order.created')
  handleWorkOrderCreated(payload: { workOrder: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'production:work-order:created', {
      workOrderId: payload.workOrder.id,
      orderNumber: payload.workOrder.orderNumber,
      // WO spans every routing machine — surface the derived list, not one header machine.
      machines: payload.workOrder.machines ?? [],
      status: 'PLANNED',
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('production.work-order.started')
  handleWorkOrderStarted(payload: { workOrder: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'production:work-order:started', {
      workOrderId: payload.workOrder.id,
      orderNumber: payload.workOrder.orderNumber,
      machines: payload.workOrder.machines ?? [],
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('production.work-order.completed')
  handleWorkOrderCompleted(payload: { workOrder: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'production:work-order:completed', {
      workOrderId: payload.workOrder.id,
      orderNumber: payload.workOrder.orderNumber,
      oee: payload.workOrder.oee,
      actualQty: payload.workOrder.actualQty,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('production.work-order.held')
  handleWorkOrderHeld(payload: { workOrder: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'production:work-order:held', {
      workOrderId: payload.workOrder.id,
      orderNumber: payload.workOrder.orderNumber,
      reason: payload.workOrder.reason,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('production.work-order.cancelled')
  handleWorkOrderCancelled(payload: { workOrder: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'production:work-order:cancelled', {
      workOrderId: payload.workOrder.id,
      orderNumber: payload.workOrder.orderNumber,
      reason: payload.workOrder.reason,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('production.count.updated')
  handleCountUpdated(payload: { workOrderId: string; factoryId: string; actualQty: number; goodQty: number; progress: number }) {
    this.toFactory(payload.factoryId, 'production:count:updated', {
      workOrderId: payload.workOrderId,
      actualQty: payload.actualQty,
      goodQty: payload.goodQty,
      progress: payload.progress,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('production.kpi.updated')
  handleKpiUpdated(payload: {
    factoryId: string;
    workOrderId: string;
    productionOrderId?: string | null;
    wo: { id: string; oee: number; status: string };
    po: { id: string; oee: number; status: string } | null;
  }) {
    this.toFactory(payload.factoryId, 'production:kpi:updated', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  // ────────────────────────────────────────────────────────────
  // DOWNTIME EVENTS
  // ────────────────────────────────────────────────────────────

  @OnEvent('downtime.event.created')
  handleDowntimeCreated(payload: { event: any; factoryId: string; machineName: string }) {
    this.toFactory(payload.factoryId, 'downtime:started', {
      eventId: payload.event.id,
      machineId: payload.event.machineId,
      machineName: payload.machineName,
      category: payload.event.category,
      isPlanned: payload.event.isPlanned,
      startTime: payload.event.startTime,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('downtime.event.ended')
  handleDowntimeEnded(payload: { eventId: string; machineId: string; factoryId: string; durationMinutes: number }) {
    this.toFactory(payload.factoryId, 'downtime:ended', {
      eventId: payload.eventId,
      machineId: payload.machineId,
      durationMinutes: payload.durationMinutes,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('downtime.auto.created')
  handleAutoDowntime(payload: { machineId: string; machineName: string; factoryId: string }) {
    this.toFactory(payload.factoryId, 'downtime:auto-detected', {
      machineId: payload.machineId,
      machineName: payload.machineName,
      message: `Auto-detected downtime on ${payload.machineName}`,
      timestamp: new Date().toISOString(),
    });
  }

  // ────────────────────────────────────────────────────────────
  // QUALITY EVENTS
  // ────────────────────────────────────────────────────────────

  @OnEvent('quality.inspection.created')
  handleInspectionCreated(payload: { inspection: any; factoryId: string; result: string }) {
    this.toFactory(payload.factoryId, 'quality:inspection:created', {
      inspectionId: payload.inspection.id,
      inspectionNumber: payload.inspection.inspectionNumber,
      result: payload.result,
      type: payload.inspection.type,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('quality.inspection.failed')
  handleInspectionFailed(payload: { inspection: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'quality:inspection:failed', {
      inspectionId: payload.inspection.id,
      inspectionNumber: payload.inspection.inspectionNumber,
      failQty: payload.inspection.failQty,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('quality.ncr.created')
  handleNCRCreated(payload: { ncr: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'quality:ncr:created', {
      ncrId: payload.ncr.id,
      ncrNumber: payload.ncr.ncrNumber,
      severity: payload.ncr.severity,
      title: payload.ncr.title,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('quality.ncr.critical')
  handleCriticalNCR(payload: { ncr: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'quality:ncr:critical', {
      ncrId: payload.ncr.id,
      ncrNumber: payload.ncr.ncrNumber,
      title: payload.ncr.title,
      timestamp: new Date().toISOString(),
    });
    this.server.to('alarms:active').emit('alarm:triggered', {
      severity: 'CRITICAL',
      category: 'QUALITY',
      message: `CRITICAL NCR: ${payload.ncr.title}`,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('quality.ncr.status-changed')
  handleNCRStatusChanged(payload: { ncrId: string; ncrNumber: string; from: string; to: string; factoryId: string }) {
    this.toFactory(payload.factoryId, 'quality:ncr:status-changed', {
      ncrId: payload.ncrId,
      ncrNumber: payload.ncrNumber,
      from: payload.from,
      to: payload.to,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('quality.capa.created')
  handleCAPACreated(payload: { capa: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'quality:capa:created', {
      capaId: payload.capa.id,
      capaNumber: payload.capa.capaNumber,
      type: payload.capa.type,
      title: payload.capa.title,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('quality.capa.verified')
  handleCAPAVerified(payload: { capa: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'quality:capa:verified', {
      capaId: payload.capa.id,
      capaNumber: payload.capa.capaNumber,
      timestamp: new Date().toISOString(),
    });
  }

  // ────────────────────────────────────────────────────────────
  // MAINTENANCE EVENTS
  // ────────────────────────────────────────────────────────────

  @OnEvent('maintenance.wo.created')
  handleMaintenanceCreated(payload: { wo: any; factoryId: string; isEmergency: boolean }) {
    this.toFactory(payload.factoryId, 'maintenance:wo:created', {
      woId: payload.wo.id,
      woNumber: payload.wo.woNumber,
      type: payload.wo.type,
      priority: payload.wo.priority,
      machineName: payload.wo.machine?.name,
      isEmergency: payload.isEmergency,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('maintenance.wo.assigned')
  handleMaintenanceAssigned(payload: { wo: any; technicianName: string; factoryId: string }) {
    this.toFactory(payload.factoryId, 'maintenance:wo:assigned', {
      woId: payload.wo.id,
      woNumber: payload.wo.woNumber,
      technician: payload.technicianName,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('maintenance.wo.started')
  handleMaintenanceStarted(payload: { wo: any; factoryId: string }) {
    this.toFactory(payload.factoryId, 'maintenance:wo:started', {
      woId: payload.wo.id,
      woNumber: payload.wo.woNumber,
      machineId: payload.wo.machineId,
      timestamp: new Date().toISOString(),
    });
  }

  @OnEvent('maintenance.wo.completed')
  handleMaintenanceCompleted(payload: { wo: any; factoryId: string; actualHours: number; totalCost: number }) {
    this.toFactory(payload.factoryId, 'maintenance:wo:completed', {
      woId: payload.wo.id,
      woNumber: payload.wo.woNumber,
      actualHours: payload.actualHours,
      totalCost: payload.totalCost,
      timestamp: new Date().toISOString(),
    });
  }

  // ────────────────────────────────────────────────────────────
  // IOT / MACHINE STATE EVENTS
  // ────────────────────────────────────────────────────────────

  @OnEvent('iot.machine.telemetry')
  handleMachineTelemetry(payload: {
    machineId: string; machineName: string; machineCode: string;
    factoryId: string; state: string; actualSpeed: number;
    goodCount: number; rejectCount: number; timestamp: string;
  }) {
    this.toFactory(payload.factoryId, 'machine:telemetry', payload);
    this.server.to(`machine:${payload.machineId}`).emit('machine:telemetry', payload);
  }

  @OnEvent('machine.state.changed')
  handleMachineStateChanged(payload: {
    machineId: string; machineName: string; factoryId: string;
    previousState: string; newState: string; timestamp: string;
  }) {
    this.toFactory(payload.factoryId, 'machine:state-changed', payload);
    this.server.to(`machine:${payload.machineId}`).emit('machine:state-changed', payload);
  }

  /**
   * Bridge the edge gateways' raw MQTT tag feed to browsers so the Tag Browser /
   * Data Streams update live. Topics: `industry360/<factoryId>/<machineKey>/<tagCode>`
   * (also `.../energy/<meterId>` → energy:reading). Parses factoryId from the topic.
   */
  @OnEvent('iot.tag.value')
  handleTagValue(payload: { topic: string; value: unknown; quality?: string; timestamp?: Date | string }) {
    const parts = (payload.topic || '').split('/');
    if (parts[0] !== 'industry360' || parts.length < 4) return;
    const factoryId = parts[1];
    const seg = parts[2];
    if (seg === 'jo') return; // JO counts handled elsewhere
    if (seg === 'energy') {
      this.toFactory(factoryId, 'energy:reading', { meterId: parts[3], ...(typeof payload.value === 'object' ? payload.value as object : { value: payload.value }) });
      return;
    }
    // tag topic: industry360/<factory>/<machineKey>/<tagCode>
    const v = payload.value as any;
    this.toFactory(factoryId, 'iot:tag:updated', {
      machineKey: seg,
      tagCode: parts[3],
      value: v && typeof v === 'object' ? (v.value ?? v) : v,
      quality: (v && typeof v === 'object' ? v.quality : payload.quality) ?? 'GOOD',
      tagId: v && typeof v === 'object' ? v.tagId : undefined,
      ts: (v && typeof v === 'object' ? v.ts : payload.timestamp) ?? new Date().toISOString(),
    });
  }

  // ────────────────────────────────────────────────────────────
  // BROADCAST HELPERS
  // ────────────────────────────────────────────────────────────

  broadcastKPIs(factoryId: string | null, kpis: Record<string, number>) {
    this.toFactory(factoryId, 'dashboard:kpis', kpis);
  }

  broadcastMachineStatus(factoryId: string | null, machines: unknown[]) {
    this.toFactory(factoryId, 'machines:status', machines);
  }

  broadcastAlarm(factoryId: string | null, alarm: unknown) {
    this.toFactory(factoryId, 'alarm:triggered', alarm);
    this.server.to('alarms:active').emit('alarm:triggered', alarm);
  }

  // ────────────────────────────────────────────────────────────
  // PERSISTED NOTIFICATIONS (per-user, emitted by NotificationsService)
  // ────────────────────────────────────────────────────────────

  /**
   * Pushes a freshly-persisted notification to its target user's socket room so
   * the bell badge + list update live. The record already carries its real DB id,
   * category and severity (lower-cased) — see NotificationsService.serialize().
   */
  @OnEvent('notification.created')
  handleNotificationCreated(payload: { userId: string; factoryId: string | null; notification: unknown }) {
    this.server.to(`user:${payload.userId}`).emit('notification', payload.notification);
  }

  /** Pushes the authoritative unread count after a read/mark-all/delete. */
  @OnEvent('notification.unread-count')
  handleUnreadCount(payload: { userId: string; count: number }) {
    this.server.to(`user:${payload.userId}`).emit('notification:unread-count', { count: payload.count });
  }

  private toFactory(factoryId: string | null, event: string, data: unknown) {
    const room = factoryId ? `factory:${factoryId}` : 'factory:all';
    this.server.to(room).emit(event, data);
  }

  /** Stream every monitored MQTT message to the in-app MQTT client (all sockets). */
  @OnEvent('iot.mqtt.message')
  handleMqttMessage(msg: { topic: string; payload: unknown; quality?: string; receivedAt: string }) {
    this.server.emit('mqtt:message', msg);
  }

  getConnectedCount(): number {
    return this.connectedClients.size;
  }
}

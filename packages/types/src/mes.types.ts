export type MachineState = 'RUNNING' | 'IDLE' | 'FAULT' | 'MAINTENANCE' | 'OFFLINE' | 'SETUP';
export type WorkOrderStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlarmSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IndustrialProtocol = 'MQTT' | 'OPC_UA' | 'MODBUS_TCP' | 'REST' | 'WEBSOCKET';

export interface OEEResult {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

export interface KPIData {
  value: number;
  target: number;
  unit: string;
  trend: number;
  trendDirection: 'up' | 'down' | 'stable';
}

export interface EquipmentStatus {
  equipmentId: string;
  name: string;
  state: MachineState;
  oee: OEEResult;
  currentOrderId?: string;
  lastUpdated: string;
}

export interface AlarmEvent {
  id: string;
  equipmentId: string;
  equipmentName: string;
  severity: AlarmSeverity;
  message: string;
  tag?: string;
  value?: number;
  threshold?: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ProductionKPIs {
  oee: KPIData;
  availability: KPIData;
  performance: KPIData;
  quality: KPIData;
  throughput: KPIData;
  scrapRate: KPIData;
  downtimeMinutes: number;
  completedOrders: number;
  activeOrders: number;
}

export interface ShiftInfo {
  id: string;
  name: string;
  operator: string;
  startTime: string;
  endTime: string;
  elapsed: number;
  target: number;
  actual: number;
  oee: number;
  downtime: number;
  defects: number;
}

export type UserRole =
  | 'SUPER_ADMIN'
  | 'TENANT_ADMIN'
  | 'PLANT_MANAGER'
  | 'SHIFT_SUPERVISOR'
  | 'QUALITY_ENGINEER'
  | 'MAINTENANCE_TECH'
  | 'OPERATOR'
  | 'VIEWER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  permissions: string[];
  mfaEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export type Permission =
  | 'production:read'
  | 'production:write'
  | 'production:delete'
  | 'quality:read'
  | 'quality:write'
  | 'quality:delete'
  | 'maintenance:read'
  | 'maintenance:write'
  | 'maintenance:delete'
  | 'reports:read'
  | 'reports:export'
  | 'iot:read'
  | 'iot:write'
  | 'users:read'
  | 'users:write'
  | 'users:delete'
  | 'settings:read'
  | 'settings:write';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  timestamp: string;
  requestId: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
  timestamp: string;
  requestId: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  requiresMFA: boolean;
  user: UserProfile;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  permissions: string[];
  mfaEnabled: boolean;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

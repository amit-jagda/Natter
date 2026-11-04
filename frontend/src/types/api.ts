/**
 * Standard API Response and Pagination Types.
 */

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface HealthStatusResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  environment: string;
  timestamp: string;
  services: {
    database: { status: string; details: Record<string, string> };
    redis: { status: string; details: Record<string, string> };
  };
}

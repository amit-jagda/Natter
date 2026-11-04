export type UserRole = "admin" | "manager" | "operator" | "viewer";
export type UserStatus = "active" | "inactive" | "suspended";

export interface User {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}


export type UserRole = "admin" | "doctor" | "receptionist" | "operator" | "manager" | "viewer";
export type UserStatus = "active" | "invited" | "inactive" | "suspended";

export interface User {
  id: string;
  tenant_id?: string;
  tenantId?: string;
  email: string;
  full_name: string;
  fullName?: string;
  role: UserRole;
  status: UserStatus;
  is_active?: boolean;
  isActive?: boolean;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface UserInvitePayload {
  full_name: string;
  email: string;
  role?: UserRole;
  password?: string;
}

export interface UserInviteResponse {
  user: User;
  temp_password: string;
  email_sent: boolean;
  message: string;
}

export interface UserUpdatePayload {
  full_name?: string;
  role?: UserRole;
  status?: UserStatus;
  is_active?: boolean;
  password?: string;
}




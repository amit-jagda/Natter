export interface Tenant {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}


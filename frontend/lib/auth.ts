// Authentication utilities

export interface Employee {
  employee_id: number;
  full_name: string;
  email?: string;
  phone?: string;
  designation?: string;
  company_name?: string;
  role_id?: number | null;
  role_name?: string | null;
  permissions?: string[] | null;  // null = no role = full access (admin-level)
  tenant_id?: number | null;
  is_super_admin?: boolean;
}

export function getEmployee(): Employee | null {
  if (typeof window === 'undefined') return null;

  const employeeStr = localStorage.getItem('employee');
  if (!employeeStr) return null;

  try {
    return JSON.parse(employeeStr);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export function isAuthenticated(): boolean {
  return !!getEmployee();
}

/**
 * Returns the current user's permissions array.
 * null = no role assigned = full access (backward compat for existing admin users).
 * Empty array = role exists but grants nothing.
 */
export function getPermissions(): string[] | null {
  const emp = getEmployee();
  if (!emp) return [];
  if (!('permissions' in emp)) return null;  // old session without role info → full access
  return emp.permissions ?? null;
}

/**
 * Returns true if the current user has the given permission.
 * Users with no role (permissions === null) have full access to everything.
 */
export function hasPermission(key: string): boolean {
  const perms = getPermissions();
  if (perms === null) return true;  // no role = full admin access
  return perms.includes(key);
}

export function isSuperAdmin(): boolean {
  return getEmployee()?.is_super_admin === true;
}

export function getTenantId(): number | null | undefined {
  return getEmployee()?.tenant_id;
}

export function requireAuth(): Employee {
  const employee = getEmployee();
  if (!employee) {
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login';
    }
    throw new Error('Not authenticated');
  }
  return employee;
}

export function logout(): void {
  if (typeof window === 'undefined') return;

  localStorage.removeItem('auth_token');
  localStorage.removeItem('employee');
  localStorage.removeItem('chatMessages');

  window.location.href = '/auth/login';
}

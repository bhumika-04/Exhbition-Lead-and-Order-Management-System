namespace ELCS.API.Services;

// ── Role DTOs ──────────────────────────────────────────────────────────────
public record RoleDto(
    int RoleId,
    string RoleName,
    string? Description,
    string Permissions,   // JSON array string e.g. ["view_leads","scan_cards"]
    DateTime CreatedAt,
    string? CompanyName = null   // owning tenant — shown to super admin to disambiguate duplicate names
);

public record CreateRoleRequest(
    string RoleName,
    string? Description,
    List<string> Permissions
);

public record UpdateRoleRequest(
    string RoleName,
    string? Description,
    List<string> Permissions
);

// ── User (Employee) DTOs ───────────────────────────────────────────────────
public record UserDto(
    int EmployeeId,
    string FullName,
    string Email,
    string? Phone,
    string? Designation,
    string? CompanyName,
    int? RoleId,
    string? RoleName,
    bool IsActive,
    DateTime CreatedAt
);

public record CreateUserRequest(
    string FullName,
    string Email,
    string Password,
    string? Phone,
    string? Designation,
    string? CompanyName,
    int? RoleId,
    int? TenantId = null
);

public record UpdateUserRequest(
    string FullName,
    string Email,
    string? Phone,
    string? Designation,
    string? CompanyName,
    int? RoleId,
    string? Password   // null = keep existing password
);

public record ResetPasswordRequest(string NewPassword);

// ── Service Interface ──────────────────────────────────────────────────────
public interface IRoleService
{
    // Roles (tenant-scoped: each company manages its own roles)
    Task<List<RoleDto>> GetRolesAsync(int? tenantId = null, bool isSuperAdmin = false);
    Task<RoleDto?> GetRoleByIdAsync(int roleId, int? tenantId = null, bool isSuperAdmin = false);
    Task<int> CreateRoleAsync(CreateRoleRequest request, int? tenantId = null);
    Task<bool> UpdateRoleAsync(int roleId, UpdateRoleRequest request, int? tenantId = null, bool isSuperAdmin = false);
    Task<bool> DeleteRoleAsync(int roleId, int? tenantId = null, bool isSuperAdmin = false);

    // Users (tenant-scoped: regular admins only manage users in their own company)
    Task<List<UserDto>> GetUsersAsync(int? tenantId = null, bool isSuperAdmin = false);
    Task<UserDto?> GetUserByIdAsync(int employeeId, int? tenantId = null, bool isSuperAdmin = false);
    Task<int> CreateUserAsync(CreateUserRequest request);
    Task<bool> UpdateUserAsync(int employeeId, UpdateUserRequest request, int? tenantId = null, bool isSuperAdmin = false);
    Task<bool> DeleteUserAsync(int employeeId, int? tenantId = null, bool isSuperAdmin = false);
    Task<bool> ResetPasswordAsync(int employeeId, string newPassword, int? tenantId = null, bool isSuperAdmin = false);
}

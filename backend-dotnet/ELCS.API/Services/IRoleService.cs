namespace ELCS.API.Services;

// ── Role DTOs ──────────────────────────────────────────────────────────────
public record RoleDto(
    int RoleId,
    string RoleName,
    string? Description,
    string Permissions,   // JSON array string e.g. ["view_leads","scan_cards"]
    DateTime CreatedAt
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
    int? RoleId
);

public record UpdateUserRequest(
    string FullName,
    string Email,
    string? Phone,
    string? Designation,
    int? RoleId,
    string? Password   // null = keep existing password
);

public record ResetPasswordRequest(string NewPassword);

// ── Service Interface ──────────────────────────────────────────────────────
public interface IRoleService
{
    // Roles
    Task<List<RoleDto>> GetRolesAsync();
    Task<RoleDto?> GetRoleByIdAsync(int roleId);
    Task<int> CreateRoleAsync(CreateRoleRequest request);
    Task<bool> UpdateRoleAsync(int roleId, UpdateRoleRequest request);
    Task<bool> DeleteRoleAsync(int roleId);

    // Users
    Task<List<UserDto>> GetUsersAsync();
    Task<UserDto?> GetUserByIdAsync(int employeeId);
    Task<int> CreateUserAsync(CreateUserRequest request);
    Task<bool> UpdateUserAsync(int employeeId, UpdateUserRequest request);
    Task<bool> DeleteUserAsync(int employeeId);
    Task<bool> ReactivateUserAsync(int employeeId);
    Task<bool> ResetPasswordAsync(int employeeId, string newPassword);
}

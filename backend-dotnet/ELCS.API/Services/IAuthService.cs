using ELCS.API.Models;

namespace ELCS.API.Services;

public interface IAuthService
{
    Task<AuthResult?> AuthenticateAsync(string email, string password);
    Task<Employee?> GetEmployeeByIdAsync(int employeeId);
    Task<bool> UpdateProfileAsync(int employeeId, UpdateProfileRequest request);

    /// <summary>
    /// Whether this caller may delete records — orders, leads and exhibitions.
    ///
    /// True for an employee with NO role, which this system already treats as
    /// full access, and for any role granting "manage_roles". Nothing but an
    /// administrator has that: it is the permission to change permissions, so
    /// anyone holding it can grant themselves the rest anyway.
    ///
    /// Deliberately a positive check on the CALLER rather than a list of who is
    /// blocked, so a new role added later is powerless until granted, not
    /// powerful until forbidden.
    /// </summary>
    Task<bool> CanDeleteRecordsAsync(int? employeeId);
}

public record AuthResult(
    int EmployeeId,
    string FullName,
    string Email,
    string? Phone,
    string? Designation,
    int? RoleId,
    string? RoleName,
    string? Permissions    // JSON array string, null = no role = full access
);

public record UpdateProfileRequest(
    string FullName,
    string? Phone,
    string? Designation
);

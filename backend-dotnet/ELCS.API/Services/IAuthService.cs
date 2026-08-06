using ELCS.API.Models;

namespace ELCS.API.Services;

public interface IAuthService
{
    Task<AuthResult?> AuthenticateAsync(string email, string password);
    Task<Employee?> GetEmployeeByIdAsync(int employeeId);
    Task<bool> UpdateProfileAsync(int employeeId, UpdateProfileRequest request);
}

public record AuthResult(
    int EmployeeId,
    string FullName,
    string Email,
    string? Phone,
    string? Designation,
    string? CompanyName,
    int? RoleId,
    string? RoleName,
    string? Permissions    // JSON array string, null = no role = full access
);

public record UpdateProfileRequest(
    string FullName,
    string? Phone,
    string? Designation,
    string? CompanyName
);

using System.Security.Cryptography;
using System.Text;
using Dapper;
using ELCS.API.Data;
using ELCS.API.Models;

namespace ELCS.API.Services;

public class AuthService : IAuthService
{
    private readonly ILogger<AuthService> _logger;
    private readonly IDbConnection _db;

    public AuthService(ILogger<AuthService> logger, IDbConnection db)
    {
        _logger = logger;
        _db = db;
    }

    public async Task<AuthResult?> AuthenticateAsync(string email, string password)
    {
        using var conn = _db.CreateConnection();

        var employee = await conn.QueryFirstOrDefaultAsync<Employee>(
            "SELECT * FROM Employees WHERE Email = @Email AND IsActive = 1",
            new { Email = email });

        if (employee == null)
        {
            _logger.LogWarning("Login failed: not found - {Email}", email);
            return null;
        }

        var hashedPassword = HashPassword(password);
        if (employee.PasswordHash != hashedPassword)
        {
            _logger.LogWarning("Login failed: wrong password - {Email}", email);
            return null;
        }

        _logger.LogInformation("Employee {EmployeeId} logged in", employee.EmployeeId);

        string? roleName = null;
        string? permissions = null;
        if (employee.RoleId.HasValue)
        {
            var role = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT RoleName, Permissions FROM Roles WHERE RoleId = @RoleId",
                new { RoleId = employee.RoleId.Value });
            if (role != null)
            {
                roleName    = (string?)role.RoleName;
                permissions = (string?)role.Permissions;
            }
        }

        return new AuthResult(
            EmployeeId:  employee.EmployeeId,
            FullName:    employee.FullName,
            Email:       employee.Email,
            Phone:       employee.Phone,
            Designation: employee.Designation,
            RoleId:      employee.RoleId,
            RoleName:    roleName,
            Permissions: permissions
        );
    }

    public async Task<bool> CanDeleteRecordsAsync(int? employeeId)
    {
        // No caller at all is not an administrator. The header is unsigned, so
        // this is a guard against mistakes rather than against an attacker —
        // but an unauthenticated request should still never delete.
        if (employeeId is null or <= 0) return false;

        using var conn = _db.CreateConnection();
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT e.RoleId, r.Permissions
            FROM Employees e
            LEFT JOIN Roles r ON r.RoleId = e.RoleId
            WHERE e.EmployeeId = @Id AND e.IsActive = 1",
            new { Id = employeeId.Value });

        if (row == null) return false;
        if (row.RoleId == null) return true;          // no role = full access

        var permissions = (string?)row.Permissions;
        if (string.IsNullOrWhiteSpace(permissions)) return false;

        try
        {
            var granted = System.Text.Json.JsonSerializer.Deserialize<List<string>>(permissions);
            return granted?.Contains("manage_roles", StringComparer.OrdinalIgnoreCase) == true;
        }
        catch
        {
            // Malformed permissions deny rather than allow.
            _logger.LogWarning("Employee {EmployeeId} has unreadable role permissions", employeeId);
            return false;
        }
    }

    public async Task<Employee?> GetEmployeeByIdAsync(int employeeId)
    {
        using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<Employee>(
            "SELECT * FROM Employees WHERE EmployeeId = @EmployeeId AND IsActive = 1",
            new { EmployeeId = employeeId });
    }

    public async Task<bool> UpdateProfileAsync(int employeeId, UpdateProfileRequest request)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.ExecuteAsync(@"
            UPDATE Employees
            SET FullName    = @FullName,
                Phone       = @Phone,
                Designation = @Designation
            WHERE EmployeeId = @EmployeeId AND IsActive = 1",
            new
            {
                FullName    = request.FullName,
                Phone       = request.Phone,
                Designation = request.Designation,
                EmployeeId  = employeeId,
            });
        return rows > 0;
    }

    private static string HashPassword(string password)
    {
        // Simple SHA256 hash for compatibility with existing Python backend
        using var sha256 = SHA256.Create();
        var bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(password));
        return Convert.ToHexString(bytes).ToLower();
    }
}

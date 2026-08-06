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

    public async Task<AuthResult?> AuthenticateAsync(string email, string password, string? companyName)
    {
        using var conn = _db.CreateConnection();

        Employee? employee;

        if (!string.IsNullOrWhiteSpace(companyName))
        {
            // Normal user: find employee within the specified company
            employee = await conn.QueryFirstOrDefaultAsync<Employee>(@"
                SELECT e.* FROM Employees e
                JOIN Companies c ON c.CompanyId = e.TenantId
                WHERE e.Email = @Email AND e.IsActive = 1
                  AND (c.CompanyName = @CompanyName OR LOWER(c.CompanyName) = LOWER(@CompanyName))",
                new { Email = email, CompanyName = companyName });
        }
        else
        {
            // Super admin login (no company required)
            employee = await conn.QueryFirstOrDefaultAsync<Employee>(
                "SELECT * FROM Employees WHERE Email = @Email AND IsActive = 1 AND IsSuperAdmin = 1",
                new { Email = email });
        }

        if (employee == null)
        {
            _logger.LogWarning("Login failed: not found - {Email} / {Company}", email, companyName);
            return null;
        }

        var hashedPassword = HashPassword(password);
        if (employee.PasswordHash != hashedPassword)
        {
            _logger.LogWarning("Login failed: wrong password - {Email}", email);
            return null;
        }

        _logger.LogInformation("Employee {EmployeeId} logged in (tenant {TenantId})", employee.EmployeeId, employee.TenantId);

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
            EmployeeId:   employee.EmployeeId,
            FullName:     employee.FullName,
            Email:        employee.Email,
            Phone:        employee.Phone,
            Designation:  employee.Designation,
            CompanyName:  employee.CompanyName,
            RoleId:       employee.RoleId,
            RoleName:     roleName,
            Permissions:  permissions,
            TenantId:     employee.TenantId,
            IsSuperAdmin: employee.IsSuperAdmin
        );
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
                Designation = @Designation,
                CompanyName = @CompanyName
            WHERE EmployeeId = @EmployeeId AND IsActive = 1",
            new
            {
                FullName    = request.FullName,
                Phone       = request.Phone,
                Designation = request.Designation,
                CompanyName = request.CompanyName,
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

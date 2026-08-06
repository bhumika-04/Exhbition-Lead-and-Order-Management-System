using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using ELCS.API.Data;

namespace ELCS.API.Services;

public class RoleService : IRoleService
{
    private readonly IDbConnection _db;

    public RoleService(IDbConnection db) => _db = db;

    // ── Roles ──────────────────────────────────────────────────────────────

    public async Task<List<RoleDto>> GetRolesAsync(int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();
        var tenantClause = isSuperAdmin ? "" : " WHERE r.TenantId = @TenantId";
        var rows = await conn.QueryAsync<dynamic>(
            $@"SELECT r.RoleId, r.RoleName, r.Description, r.Permissions, r.CreatedAt, c.CompanyName
               FROM Roles r
               LEFT JOIN Companies c ON c.CompanyId = r.TenantId
               {tenantClause}
               ORDER BY c.CompanyName, r.RoleName",
            new { TenantId = tenantId });
        return rows.Select(r => new RoleDto(
            RoleId:      (int)r.RoleId,
            RoleName:    (string)r.RoleName,
            Description: (string?)r.Description,
            Permissions: (string)r.Permissions,
            CreatedAt:   (DateTime)r.CreatedAt,
            CompanyName: (string?)r.CompanyName
        )).ToList();
    }

    public async Task<RoleDto?> GetRoleByIdAsync(int roleId, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();
        var tenantClause = isSuperAdmin ? "" : " AND r.TenantId = @TenantId";
        var r = await conn.QueryFirstOrDefaultAsync<dynamic>(
            $@"SELECT r.RoleId, r.RoleName, r.Description, r.Permissions, r.CreatedAt, c.CompanyName
               FROM Roles r
               LEFT JOIN Companies c ON c.CompanyId = r.TenantId
               WHERE r.RoleId = @RoleId{tenantClause}",
            new { RoleId = roleId, TenantId = tenantId });
        if (r == null) return null;
        return new RoleDto(
            RoleId:      (int)r.RoleId,
            RoleName:    (string)r.RoleName,
            Description: (string?)r.Description,
            Permissions: (string)r.Permissions,
            CreatedAt:   (DateTime)r.CreatedAt,
            CompanyName: (string?)r.CompanyName
        );
    }

    public async Task<int> CreateRoleAsync(CreateRoleRequest request, int? tenantId = null)
    {
        using var conn = _db.CreateConnection();
        var permJson = JsonSerializer.Serialize(request.Permissions);
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO Roles (RoleName, Description, Permissions, TenantId)
            OUTPUT INSERTED.RoleId
            VALUES (@RoleName, @Description, @Permissions, @TenantId)",
            new { RoleName = request.RoleName, Description = request.Description, Permissions = permJson, TenantId = tenantId });
    }

    public async Task<bool> UpdateRoleAsync(int roleId, UpdateRoleRequest request, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();
        var permJson = JsonSerializer.Serialize(request.Permissions);
        var tenantClause = isSuperAdmin ? "" : " AND TenantId = @TenantId";
        var rows = await conn.ExecuteAsync($@"
            UPDATE Roles SET RoleName = @RoleName, Description = @Description, Permissions = @Permissions
            WHERE RoleId = @RoleId{tenantClause}",
            new { RoleName = request.RoleName, Description = request.Description, Permissions = permJson, RoleId = roleId, TenantId = tenantId });
        return rows > 0;
    }

    public async Task<bool> DeleteRoleAsync(int roleId, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();
        var tenantClause = isSuperAdmin ? "" : " AND TenantId = @TenantId";

        // Verify the role belongs to the caller's tenant before touching anything
        var exists = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM Roles WHERE RoleId = @RoleId{tenantClause}",
            new { RoleId = roleId, TenantId = tenantId });
        if (exists == 0) return false;

        // Unlink employees from this role first
        await conn.ExecuteAsync("UPDATE Employees SET RoleId = NULL WHERE RoleId = @RoleId", new { RoleId = roleId });
        var rows = await conn.ExecuteAsync("DELETE FROM Roles WHERE RoleId = @RoleId", new { RoleId = roleId });
        return rows > 0;
    }

    // ── Users ──────────────────────────────────────────────────────────────

    public async Task<List<UserDto>> GetUsersAsync(int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();
        string where = isSuperAdmin || !tenantId.HasValue
            ? "WHERE e.IsActive = 1 AND e.IsSuperAdmin = 0"
            : "WHERE e.IsActive = 1 AND e.TenantId = @TenantId AND e.IsSuperAdmin = 0";
        var rows = await conn.QueryAsync<dynamic>($@"
            SELECT e.EmployeeId, e.FullName, e.Email, e.Phone, e.Designation, e.CompanyName,
                   e.RoleId, r.RoleName, e.IsActive, e.CreatedAt
            FROM Employees e
            LEFT JOIN Roles r ON r.RoleId = e.RoleId
            {where}
            ORDER BY e.FullName", new { TenantId = tenantId });
        return rows.Select(MapUser).ToList();
    }

    public async Task<UserDto?> GetUserByIdAsync(int employeeId, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();
        var tenantClause = isSuperAdmin ? "" : " AND e.TenantId = @TenantId";
        var r = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT e.EmployeeId, e.FullName, e.Email, e.Phone, e.Designation, e.CompanyName,
                   e.RoleId, r.RoleName, e.IsActive, e.CreatedAt
            FROM Employees e
            LEFT JOIN Roles r ON r.RoleId = e.RoleId
            WHERE e.EmployeeId = @EmployeeId{tenantClause}",
            new { EmployeeId = employeeId, TenantId = tenantId });
        return r == null ? null : MapUser(r);
    }

    public async Task<int> CreateUserAsync(CreateUserRequest request)
    {
        using var conn = _db.CreateConnection();
        var hash = HashPassword(request.Password);
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO Employees (FullName, Email, PasswordHash, Phone, Designation, CompanyName, RoleId, TenantId, IsActive, CreatedAt)
            OUTPUT INSERTED.EmployeeId
            VALUES (@FullName, @Email, @PasswordHash, @Phone, @Designation, @CompanyName, @RoleId, @TenantId, 1, GETUTCDATE())",
            new
            {
                FullName    = request.FullName,
                Email       = request.Email,
                PasswordHash = hash,
                Phone       = request.Phone,
                Designation = request.Designation,
                CompanyName = request.CompanyName,
                RoleId      = request.RoleId,
                TenantId    = request.TenantId,
            });
    }

    public async Task<bool> UpdateUserAsync(int employeeId, UpdateUserRequest request, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();
        // Tenant isolation: regular admins may only update users in their own company.
        // Super admins manage company users only (never other super admins).
        var tenantClause = isSuperAdmin ? " AND IsSuperAdmin = 0" : " AND TenantId = @TenantId";
        if (!string.IsNullOrEmpty(request.Password))
        {
            var hash = HashPassword(request.Password);
            var rows = await conn.ExecuteAsync($@"
                UPDATE Employees
                SET FullName = @FullName, Email = @Email, Phone = @Phone,
                    Designation = @Designation, CompanyName = @CompanyName,
                    RoleId = @RoleId, PasswordHash = @PasswordHash
                WHERE EmployeeId = @EmployeeId AND IsActive = 1{tenantClause}",
                new
                {
                    FullName     = request.FullName,
                    Email        = request.Email,
                    Phone        = request.Phone,
                    Designation  = request.Designation,
                    CompanyName  = request.CompanyName,
                    RoleId       = request.RoleId,
                    PasswordHash = hash,
                    EmployeeId   = employeeId,
                    TenantId     = tenantId,
                });
            return rows > 0;
        }
        else
        {
            var rows = await conn.ExecuteAsync($@"
                UPDATE Employees
                SET FullName = @FullName, Email = @Email, Phone = @Phone,
                    Designation = @Designation, CompanyName = @CompanyName,
                    RoleId = @RoleId
                WHERE EmployeeId = @EmployeeId AND IsActive = 1{tenantClause}",
                new
                {
                    FullName    = request.FullName,
                    Email       = request.Email,
                    Phone       = request.Phone,
                    Designation = request.Designation,
                    CompanyName = request.CompanyName,
                    RoleId      = request.RoleId,
                    EmployeeId  = employeeId,
                    TenantId    = tenantId,
                });
            return rows > 0;
        }
    }

    public async Task<bool> DeleteUserAsync(int employeeId, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();
        var tenantClause = isSuperAdmin ? " AND IsSuperAdmin = 0" : " AND TenantId = @TenantId";
        // Soft delete
        var rows = await conn.ExecuteAsync(
            $"UPDATE Employees SET IsActive = 0 WHERE EmployeeId = @EmployeeId{tenantClause}",
            new { EmployeeId = employeeId, TenantId = tenantId });
        return rows > 0;
    }

    public async Task<bool> ResetPasswordAsync(int employeeId, string newPassword, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();
        var hash = HashPassword(newPassword);
        var tenantClause = isSuperAdmin ? " AND IsSuperAdmin = 0" : " AND TenantId = @TenantId";
        var rows = await conn.ExecuteAsync(
            $"UPDATE Employees SET PasswordHash = @PasswordHash WHERE EmployeeId = @EmployeeId AND IsActive = 1{tenantClause}",
            new { PasswordHash = hash, EmployeeId = employeeId, TenantId = tenantId });
        return rows > 0;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private static UserDto MapUser(dynamic r) => new UserDto(
        EmployeeId:  (int)r.EmployeeId,
        FullName:    (string)r.FullName,
        Email:       (string)r.Email,
        Phone:       (string?)r.Phone,
        Designation: (string?)r.Designation,
        CompanyName: (string?)r.CompanyName,
        RoleId:      (int?)r.RoleId,
        RoleName:    (string?)r.RoleName,
        IsActive:    (bool)r.IsActive,
        CreatedAt:   (DateTime)r.CreatedAt
    );

    private static string HashPassword(string password)
    {
        using var sha256 = SHA256.Create();
        var bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(password));
        return Convert.ToHexString(bytes).ToLower();
    }
}

using Dapper;
using Microsoft.AspNetCore.Mvc;
using ELCS.API.Data;
using ELCS.API.Models;
using System.Security.Cryptography;
using System.Text;

namespace ELCS.API.Controllers;

/// <summary>
/// Super-admin only: manage tenant companies and their admin users.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class CompaniesController : ControllerBase
{
    private readonly ILogger<CompaniesController> _logger;
    private readonly IDbConnection _db;
    private readonly TenantContext _tenant;

    public CompaniesController(ILogger<CompaniesController> logger, IDbConnection db, TenantContext tenant)
    {
        _logger = logger;
        _db = db;
        _tenant = tenant;
    }

    // ── Guard: only super admin may access ──────────────────────────────────

    private IActionResult? RequireSuperAdmin()
    {
        if (!_tenant.IsSuperAdmin)
            return Forbid();
        return null;
    }

    // GET /api/companies
    [HttpGet]
    public async Task<IActionResult> GetCompanies()
    {
        if (RequireSuperAdmin() is { } deny) return deny;

        using var conn = _db.CreateConnection();
        var companies = await conn.QueryAsync<Company>(
            "SELECT * FROM Companies ORDER BY CompanyName");

        // Include user counts per company
        var result = new List<object>();
        foreach (var c in companies)
        {
            var userCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM Employees WHERE TenantId = @TenantId AND IsActive = 1",
                new { TenantId = c.CompanyId });
            result.Add(new
            {
                company_id   = c.CompanyId,
                company_name = c.CompanyName,
                is_active    = c.IsActive,
                created_at   = c.CreatedAt,
                user_count   = userCount
            });
        }

        return Ok(new { companies = result });
    }

    // GET /api/companies/{id}
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetCompany(int id)
    {
        if (RequireSuperAdmin() is { } deny) return deny;

        using var conn = _db.CreateConnection();
        var company = await conn.QueryFirstOrDefaultAsync<Company>(
            "SELECT * FROM Companies WHERE CompanyId = @Id", new { Id = id });

        if (company == null) return NotFound(new { error = "Company not found" });
        return Ok(company);
    }

    // POST /api/companies  — create a new company + its first admin user
    [HttpPost]
    public async Task<IActionResult> CreateCompany([FromBody] CreateCompanyRequest request)
    {
        if (RequireSuperAdmin() is { } deny) return deny;

        if (string.IsNullOrWhiteSpace(request.CompanyName))
            return BadRequest(new { error = "Company name is required" });
        if (string.IsNullOrWhiteSpace(request.AdminEmail))
            return BadRequest(new { error = "Admin email is required" });
        if (string.IsNullOrWhiteSpace(request.AdminPassword))
            return BadRequest(new { error = "Admin password is required" });

        using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        // Check duplicate company name
        var nameExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM Companies WHERE LOWER(CompanyName) = LOWER(@Name)",
            new { Name = request.CompanyName });
        if (nameExists > 0)
            return Conflict(new { error = "A company with this name already exists" });

        // Check duplicate admin email (emails are globally unique across all employees)
        var emailExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM Employees WHERE LOWER(Email) = LOWER(@Email)",
            new { Email = request.AdminEmail });
        if (emailExists > 0)
            return Conflict(new { error = "A user with this email already exists" });

        // Create the company, its roles, and its admin atomically so a failure can't
        // leave an orphaned company behind.
        using var tx = (Microsoft.Data.SqlClient.SqlTransaction)conn.BeginTransaction();
        try
        {
            var companyId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO Companies (CompanyName, IsActive, CreatedAt)
                OUTPUT INSERTED.CompanyId
                VALUES (@Name, 1, GETUTCDATE())",
                new { Name = request.CompanyName }, tx);

            // Seed the standard set of roles for this new tenant (roles are per-tenant)
            await SeedDefaultRolesAsync(conn, companyId, tx);

            // Create the company's admin employee (no role = full access within company)
            var passwordHash = HashPassword(request.AdminPassword);
            var employeeId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO Employees (FullName, Email, PasswordHash, IsActive, TenantId, CompanyName, CreatedAt)
                OUTPUT INSERTED.EmployeeId
                VALUES (@FullName, @Email, @PasswordHash, 1, @TenantId, @CompanyName, GETUTCDATE())",
                new
                {
                    FullName    = request.AdminName ?? request.CompanyName + " Admin",
                    Email       = request.AdminEmail,
                    PasswordHash = passwordHash,
                    TenantId    = companyId,
                    CompanyName = request.CompanyName
                }, tx);

            tx.Commit();

            _logger.LogInformation("Created company {CompanyId} '{Name}' with admin employee {EmployeeId}",
                companyId, request.CompanyName, employeeId);

            return Ok(new { success = true, company_id = companyId, admin_employee_id = employeeId });
        }
        catch (Exception ex)
        {
            tx.Rollback();
            _logger.LogError(ex, "Failed to create company '{Name}'", request.CompanyName);
            if (ex.Message.Contains("UNIQUE") || ex.Message.Contains("duplicate"))
                return Conflict(new { error = "A company or user with these details already exists" });
            return StatusCode(500, new { error = "Failed to create company" });
        }
    }

    // PUT /api/companies/{id}
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateCompany(int id, [FromBody] UpdateCompanyRequest request)
    {
        if (RequireSuperAdmin() is { } deny) return deny;

        using var conn = _db.CreateConnection();
        var rows = await conn.ExecuteAsync(@"
            UPDATE Companies SET CompanyName = @Name, IsActive = @IsActive
            WHERE CompanyId = @Id",
            new { Name = request.CompanyName, IsActive = request.IsActive, Id = id });

        if (rows == 0) return NotFound(new { error = "Company not found" });
        return Ok(new { success = true });
    }

    // DELETE /api/companies/{id}
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteCompany(int id)
    {
        if (RequireSuperAdmin() is { } deny) return deny;

        using var conn = _db.CreateConnection();
        var userCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM Employees WHERE TenantId = @Id AND IsActive = 1", new { Id = id });
        if (userCount > 0)
            return BadRequest(new { error = $"Company has {userCount} active user(s). Deactivate them first." });

        await conn.ExecuteAsync(
            "UPDATE Companies SET IsActive = 0 WHERE CompanyId = @Id", new { Id = id });
        return Ok(new { success = true });
    }

    // GET /api/companies/{id}/users — users of a specific company
    [HttpGet("{id:int}/users")]
    public async Task<IActionResult> GetCompanyUsers(int id)
    {
        if (RequireSuperAdmin() is { } deny) return deny;

        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(@"
            SELECT e.EmployeeId, e.FullName, e.Email, e.Phone, e.Designation,
                   e.IsActive, e.CreatedAt, r.RoleName
            FROM Employees e
            LEFT JOIN Roles r ON r.RoleId = e.RoleId
            WHERE e.TenantId = @TenantId
            ORDER BY e.FullName",
            new { TenantId = id });

        // Project to explicit snake_case (Dapper dynamic keeps PascalCase column names)
        var users = rows.Select(r => new
        {
            employee_id = (int)r.EmployeeId,
            full_name   = (string?)r.FullName,
            email       = (string?)r.Email,
            phone       = (string?)r.Phone,
            designation = (string?)r.Designation,
            is_active   = (bool?)r.IsActive ?? true,
            role_name   = (string?)r.RoleName,
        });

        return Ok(new { users });
    }

    private static string HashPassword(string password)
    {
        using var sha256 = SHA256.Create();
        var bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(password));
        return Convert.ToHexString(bytes).ToLower();
    }

    // Standard roles every new company starts with (roles are per-tenant)
    private static readonly (string Name, string Description, string[] Permissions)[] DefaultRoles =
    {
        ("Admin",           "Full access within the company",
            new[] { "scan_cards", "view_leads", "view_dashboard", "view_exhibitions", "manage_exhibitions", "view_report", "push_to_crm", "manage_users", "manage_roles" }),
        ("Manager",         "Leads, dashboard, reports and CRM",
            new[] { "scan_cards", "view_leads", "view_dashboard", "view_exhibitions", "view_report", "push_to_crm" }),
        ("Sales Executive", "Scan and view leads and reports",
            new[] { "scan_cards", "view_leads", "view_report" }),
        ("Salesperson",     "Scan and view leads",
            new[] { "scan_cards", "view_leads" }),
    };

    private static async Task SeedDefaultRolesAsync(Microsoft.Data.SqlClient.SqlConnection conn, int tenantId, Microsoft.Data.SqlClient.SqlTransaction? tx = null)
    {
        foreach (var (name, description, permissions) in DefaultRoles)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO Roles (RoleName, Description, Permissions, TenantId)
                VALUES (@RoleName, @Description, @Permissions, @TenantId)",
                new
                {
                    RoleName    = name,
                    Description = description,
                    Permissions = System.Text.Json.JsonSerializer.Serialize(permissions),
                    TenantId    = tenantId,
                }, tx);
        }
    }
}

public record CreateCompanyRequest(
    string CompanyName,
    string AdminEmail,
    string AdminPassword,
    string? AdminName = null
);

public record UpdateCompanyRequest(
    string CompanyName,
    bool IsActive
);

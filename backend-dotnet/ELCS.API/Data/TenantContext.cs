using Dapper;

namespace ELCS.API.Data;

/// <summary>
/// Scoped service populated by TenantMiddleware from X-Employee-Id header.
/// Provides tenant isolation for all data queries.
/// </summary>
public class TenantContext
{
    public int? EmployeeId { get; set; }
    public int? TenantId { get; set; }   // null when super admin
    public bool IsSuperAdmin { get; set; }
    public bool IsResolved { get; set; }
}

public class TenantMiddleware
{
    private readonly RequestDelegate _next;

    public TenantMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, TenantContext tenantCtx, IDbConnection db)
    {
        if (context.Request.Headers.TryGetValue("X-Employee-Id", out var empIdStr)
            && int.TryParse(empIdStr, out var empId))
        {
            using var conn = db.CreateConnection();
            var row = await conn.QueryFirstOrDefaultAsync(
                "SELECT TenantId, IsSuperAdmin FROM Employees WHERE EmployeeId = @Id AND IsActive = 1",
                new { Id = empId });

            if (row != null)
            {
                tenantCtx.EmployeeId = empId;
                tenantCtx.TenantId = (int?)row.TenantId;
                tenantCtx.IsSuperAdmin = (bool)row.IsSuperAdmin;
                tenantCtx.IsResolved = true;
            }
        }
        await _next(context);
    }
}

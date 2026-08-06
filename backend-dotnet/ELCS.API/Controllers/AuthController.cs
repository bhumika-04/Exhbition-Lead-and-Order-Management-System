using Microsoft.AspNetCore.Mvc;
using ELCS.API.Data;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly ILogger<AuthController> _logger;
    private readonly IAuthService _authService;
    private readonly TenantContext _tenant;

    public AuthController(ILogger<AuthController> logger, IAuthService authService, TenantContext tenant)
    {
        _logger = logger;
        _authService = authService;
        _tenant = tenant;
    }

    // A profile may only be read/edited by its owner (or the super admin).
    private bool CanAccessProfile(int employeeId) =>
        _tenant.IsSuperAdmin || _tenant.EmployeeId == employeeId;

    [HttpPost("login")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrEmpty(request.Email) || string.IsNullOrEmpty(request.Password))
            return BadRequest(new { error = "Email and password are required" });

        // Super admin can omit company name; everyone else must provide it
        if (string.IsNullOrWhiteSpace(request.CompanyName) && request.Email != "admin@example.com")
            return BadRequest(new { error = "Company name is required" });

        var result = await _authService.AuthenticateAsync(request.Email, request.Password, request.CompanyName);

        if (result == null)
        {
            return Unauthorized(new { error = "Invalid company, email, or password" });
        }

        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";

        return Ok(new
        {
            success        = true,
            employee_id    = result.EmployeeId,
            full_name      = result.FullName,
            email          = result.Email,
            phone          = result.Phone,
            designation    = result.Designation,
            company_name   = result.CompanyName,
            role_id        = result.RoleId,
            role_name      = result.RoleName,
            permissions    = result.Permissions,
            tenant_id      = result.TenantId,
            is_super_admin = result.IsSuperAdmin,
        });
    }

    [HttpGet("profile/{employeeId:int}")]
    public async Task<IActionResult> GetProfile(int employeeId)
    {
        if (!CanAccessProfile(employeeId))
            return Forbid();

        var employee = await _authService.GetEmployeeByIdAsync(employeeId);
        if (employee == null)
            return NotFound(new { error = "Employee not found" });

        return Ok(new
        {
            employee_id  = employee.EmployeeId,
            full_name    = employee.FullName,
            email        = employee.Email,
            phone        = employee.Phone,
            designation  = employee.Designation,
            company_name = employee.CompanyName
        });
    }

    [HttpPut("profile/{employeeId:int}")]
    public async Task<IActionResult> UpdateProfile(int employeeId, [FromBody] UpdateProfileRequest request)
    {
        if (!CanAccessProfile(employeeId))
            return Forbid();

        var ok = await _authService.UpdateProfileAsync(employeeId, request);
        if (!ok)
            return NotFound(new { error = "Employee not found" });

        return Ok(new { success = true, message = "Profile updated" });
    }
}

public record LoginRequest(string Email, string Password, string? CompanyName = null);

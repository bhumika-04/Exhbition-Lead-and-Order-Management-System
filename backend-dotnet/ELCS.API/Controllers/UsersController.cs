using Microsoft.AspNetCore.Mvc;
using ELCS.API.Data;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly IRoleService _roleService;
    private readonly ILogger<UsersController> _logger;
    private readonly TenantContext _tenant;

    public UsersController(IRoleService roleService, ILogger<UsersController> logger, TenantContext tenant)
    {
        _roleService = roleService;
        _logger = logger;
        _tenant = tenant;
    }

    // GET /api/users — scoped to current tenant
    [HttpGet]
    public async Task<IActionResult> GetUsers()
    {
        var users = await _roleService.GetUsersAsync(_tenant.TenantId, _tenant.IsSuperAdmin);
        return Ok(new { users });
    }

    // GET /api/users/{id}
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetUser(int id)
    {
        var user = await _roleService.GetUserByIdAsync(id, _tenant.TenantId, _tenant.IsSuperAdmin);
        if (user == null) return NotFound(new { error = "User not found" });
        return Ok(user);
    }

    // POST /api/users
    [HttpPost]
    public async Task<IActionResult> CreateUser([FromBody] CreateUserRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.FullName))
            return BadRequest(new { error = "FullName is required" });
        if (string.IsNullOrWhiteSpace(request.Email))
            return BadRequest(new { error = "Email is required" });
        if (string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "Password is required" });

        try
        {
            // Stamp the new user with the caller's tenant
            var requestWithTenant = request with { TenantId = _tenant.TenantId };
            var userId = await _roleService.CreateUserAsync(requestWithTenant);
            return Ok(new { success = true, employee_id = userId });
        }
        catch (Exception ex) when (ex.Message.Contains("UNIQUE") || ex.Message.Contains("duplicate") || ex.Message.Contains("PRIMARY"))
        {
            return Conflict(new { error = "A user with this email already exists" });
        }
    }

    // PUT /api/users/{id}
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateUser(int id, [FromBody] UpdateUserRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.FullName))
            return BadRequest(new { error = "FullName is required" });
        if (string.IsNullOrWhiteSpace(request.Email))
            return BadRequest(new { error = "Email is required" });

        var ok = await _roleService.UpdateUserAsync(id, request, _tenant.TenantId, _tenant.IsSuperAdmin);
        if (!ok) return NotFound(new { error = "User not found" });
        return Ok(new { success = true });
    }

    // DELETE /api/users/{id}
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteUser(int id)
    {
        var ok = await _roleService.DeleteUserAsync(id, _tenant.TenantId, _tenant.IsSuperAdmin);
        if (!ok) return NotFound(new { error = "User not found" });
        return Ok(new { success = true });
    }

    // POST /api/users/{id}/reset-password
    [HttpPost("{id:int}/reset-password")]
    public async Task<IActionResult> ResetPassword(int id, [FromBody] ResetPasswordRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword))
            return BadRequest(new { error = "New password is required" });
        if (request.NewPassword.Length < 6)
            return BadRequest(new { error = "Password must be at least 6 characters" });

        var ok = await _roleService.ResetPasswordAsync(id, request.NewPassword, _tenant.TenantId, _tenant.IsSuperAdmin);
        if (!ok) return NotFound(new { error = "User not found" });

        _logger.LogInformation("Password reset for EmployeeId {EmployeeId}", id);
        return Ok(new { success = true, message = "Password reset successfully" });
    }
}

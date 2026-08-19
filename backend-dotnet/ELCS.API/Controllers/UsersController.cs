using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly IRoleService _roleService;
    private readonly ILogger<UsersController> _logger;

    public UsersController(IRoleService roleService, ILogger<UsersController> logger)
    {
        _roleService = roleService;
        _logger = logger;
    }

    // GET /api/users
    [HttpGet]
    public async Task<IActionResult> GetUsers()
    {
        var users = await _roleService.GetUsersAsync();
        return Ok(new { users });
    }

    // GET /api/users/{id}
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetUser(int id)
    {
        var user = await _roleService.GetUserByIdAsync(id);
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
            var userId = await _roleService.CreateUserAsync(request);
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

        var ok = await _roleService.UpdateUserAsync(id, request);
        if (!ok) return NotFound(new { error = "User not found" });
        return Ok(new { success = true });
    }

    // DELETE /api/users/{id}
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteUser(int id)
    {
        var ok = await _roleService.DeleteUserAsync(id);
        if (!ok) return NotFound(new { error = "User not found" });
        return Ok(new { success = true });
    }

    // POST /api/users/{id}/reactivate
    [HttpPost("{id:int}/reactivate")]
    public async Task<IActionResult> ReactivateUser(int id)
    {
        var ok = await _roleService.ReactivateUserAsync(id);
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

        var ok = await _roleService.ResetPasswordAsync(id, request.NewPassword);
        if (!ok) return NotFound(new { error = "User not found" });

        _logger.LogInformation("Password reset for EmployeeId {EmployeeId}", id);
        return Ok(new { success = true, message = "Password reset successfully" });
    }
}

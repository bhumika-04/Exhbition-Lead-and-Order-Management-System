using Microsoft.AspNetCore.Mvc;
using ELCS.API.Data;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class RolesController : ControllerBase
{
    private readonly IRoleService _roleService;
    private readonly ILogger<RolesController> _logger;
    private readonly TenantContext _tenant;

    public RolesController(IRoleService roleService, ILogger<RolesController> logger, TenantContext tenant)
    {
        _roleService = roleService;
        _logger = logger;
        _tenant = tenant;
    }

    // GET /api/roles
    [HttpGet]
    public async Task<IActionResult> GetRoles()
    {
        var roles = await _roleService.GetRolesAsync(_tenant.TenantId, _tenant.IsSuperAdmin);
        return Ok(new { roles });
    }

    // GET /api/roles/{id}
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetRole(int id)
    {
        var role = await _roleService.GetRoleByIdAsync(id, _tenant.TenantId, _tenant.IsSuperAdmin);
        if (role == null) return NotFound(new { error = "Role not found" });
        return Ok(role);
    }

    // POST /api/roles
    [HttpPost]
    public async Task<IActionResult> CreateRole([FromBody] CreateRoleRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.RoleName))
            return BadRequest(new { error = "RoleName is required" });

        try
        {
            var roleId = await _roleService.CreateRoleAsync(request, _tenant.TenantId);
            return Ok(new { success = true, role_id = roleId });
        }
        catch (Exception ex) when (ex.Message.Contains("UNIQUE") || ex.Message.Contains("duplicate"))
        {
            return Conflict(new { error = "A role with this name already exists" });
        }
    }

    // PUT /api/roles/{id}
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateRole(int id, [FromBody] UpdateRoleRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.RoleName))
            return BadRequest(new { error = "RoleName is required" });

        var ok = await _roleService.UpdateRoleAsync(id, request, _tenant.TenantId, _tenant.IsSuperAdmin);
        if (!ok) return NotFound(new { error = "Role not found" });
        return Ok(new { success = true });
    }

    // DELETE /api/roles/{id}
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteRole(int id)
    {
        var ok = await _roleService.DeleteRoleAsync(id, _tenant.TenantId, _tenant.IsSuperAdmin);
        if (!ok) return NotFound(new { error = "Role not found" });
        return Ok(new { success = true });
    }
}

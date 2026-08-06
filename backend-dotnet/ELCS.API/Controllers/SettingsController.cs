using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

/// <summary>
/// Runtime settings: Interakt template names and social links.
/// Held in the database so an approved template name can change without a deploy.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class SettingsController : ControllerBase
{
    private readonly ILogger<SettingsController> _logger;
    private readonly ISettingsService _settings;

    public SettingsController(ILogger<SettingsController> logger, ISettingsService settings)
    {
        _logger = logger;
        _settings = settings;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
        => Ok(new { settings = await _settings.GetAllAsync() });

    [HttpPut]
    public async Task<IActionResult> Save([FromBody] Dictionary<string, string?> values)
    {
        if (values == null || values.Count == 0)
            return BadRequest(new { error = "Nothing to save" });

        await _settings.SaveAsync(values);
        return Ok(new { success = true, settings = await _settings.GetAllAsync() });
    }
}

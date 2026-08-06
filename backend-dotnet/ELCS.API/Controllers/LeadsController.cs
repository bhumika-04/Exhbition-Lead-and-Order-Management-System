using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class LeadsController : ControllerBase
{
    private readonly ILogger<LeadsController> _logger;
    private readonly ILeadService _leadService;

    public LeadsController(
        ILogger<LeadsController> logger,
        ILeadService leadService)
    {
        _logger = logger;
        _leadService = leadService;
    }

    [HttpGet]
    public async Task<IActionResult> GetLeads(
        [FromQuery] int? exhibition_id,
        [FromQuery] string? source_code,
        [FromQuery] string? status_code,
        [FromQuery] int? assigned_employee_id,
        [FromQuery] string? service,
        [FromQuery] int limit = 50,
        [FromQuery] int offset = 0)
    {
        var queryParams = new LeadQueryParams(
            ExhibitionId: exhibition_id,
            SourceCode: source_code,
            StatusCode: status_code,
            Limit: limit,
            Offset: offset,
            AssignedEmployeeId: assigned_employee_id,
            Service: service
        );

        var (leads, count) = await _leadService.GetLeadsAsync(queryParams);

        return Ok(new { leads, count });
    }

    [HttpGet("{leadId:int}")]
    public async Task<IActionResult> GetLead(int leadId)
    {
        var detail = await _leadService.GetLeadDetailAsync(leadId);

        if (detail == null)
            return NotFound(new { error = "Lead not found" });

        return Ok(new
        {
            lead = detail.Lead,
            persons = detail.Persons,
            addresses = detail.Addresses,
            websites = detail.Websites,
            services = detail.Services,
            topics = detail.Topics,
            messages = detail.Messages,
            brands = detail.Brands,
            phones = detail.Phones,
            emails = detail.Emails
        });
    }

    [HttpPost]
    public async Task<IActionResult> CreateLead([FromBody] CreateLeadDto dto)
    {
        var leadId = await _leadService.CreateLeadAsync(dto);
        return Ok(new { lead_id = leadId });
    }

    [HttpPut("{leadId:int}")]
    public async Task<IActionResult> UpdateLead(int leadId, [FromBody] UpdateLeadDto dto)
    {
        try
        {
            await _leadService.UpdateLeadAsync(leadId, dto);
            return Ok(new { success = true, message = "Lead updated" });
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Lead not found" });
        }
    }

    [HttpDelete("{leadId:int}")]
    public async Task<IActionResult> DeleteLead(int leadId)
    {
        try
        {
            await _leadService.DeleteLeadAsync(leadId);
            return Ok(new { success = true, message = "Lead deleted" });
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Lead not found" });
        }
    }
}

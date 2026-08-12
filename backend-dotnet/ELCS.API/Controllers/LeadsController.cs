using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class LeadsController : ControllerBase
{
    private readonly ILogger<LeadsController> _logger;
    private readonly ILeadService _leadService;
    private readonly IAuthService _auth;

    public LeadsController(
        ILogger<LeadsController> logger,
        ILeadService leadService, IAuthService auth)
    {
        _logger = logger;
        _leadService = leadService;
        _auth = auth;
    }

    private int? CallerEmployeeId =>
        Request.Headers.TryGetValue("X-Employee-Id", out var raw) && int.TryParse(raw, out var id)
            ? id
            : null;

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
            topics = detail.Topics,
            messages = detail.Messages,
            brands = detail.Brands,
            phones = detail.Phones,
            emails = detail.Emails,
            order_value = detail.OrderValue,
            order_status = detail.OrderStatus
        });
    }

    [HttpPost]
    public async Task<IActionResult> CreateLead([FromBody] CreateLeadDto dto)
    {
        try
        {
            var leadId = await _leadService.CreateLeadAsync(dto);
            return Ok(new { lead_id = leadId });
        }
        // The mobile number already belongs to another lead. A 409 rather than
        // a 400: the request is well-formed, it conflicts with what exists.
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
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
        // Deleting is administrators only. Enforced HERE and not merely by
        // hiding the button, because the endpoint is reachable directly and a
        // deleted order takes its lines, its Sales Order and the customer's
        // history with it.
        if (!await _auth.CanDeleteRecordsAsync(CallerEmployeeId))
            return StatusCode(StatusCodes.Status403Forbidden,
                new { error = "Only an administrator can delete this." });
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

    /// <summary>
    /// Admin-only: sets or clears a coupon-slab override that REPLACES the
    /// earned-from-advance calculation for this lead — see
    /// AdvanceCalculator.CouponsForSlab and OrderService's coupon queries.
    /// Same "is this caller an administrator" gate as delete, because this is
    /// the same kind of action: it hands out something with real value
    /// (lucky-draw entries) independent of what the customer actually paid.
    /// </summary>
    [HttpPut("{leadId:int}/coupon-override")]
    public async Task<IActionResult> SetCouponOverride(int leadId, [FromBody] SetCouponOverrideRequest request)
    {
        if (!await _auth.CanDeleteRecordsAsync(CallerEmployeeId))
            return StatusCode(StatusCodes.Status403Forbidden,
                new { error = "Only an administrator can grant coupons without an advance." });

        if (request.Slab is < 0)
            return BadRequest(new { error = "Slab cannot be negative" });

        try
        {
            await _leadService.SetCouponOverrideAsync(leadId, request.Slab);
            return Ok(new
            {
                success = true,
                slab = request.Slab,
                // Only meaningful when setting: clearing goes back to whatever
                // the advance actually taken earns, which this endpoint has no
                // reason to recompute — the caller re-reads the lead's summary.
                coupons = request.Slab.HasValue ? AdvanceCalculator.CouponsForSlab(request.Slab.Value) : (int?)null,
            });
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Lead not found" });
        }
    }

    /// <summary>Records the physical coupon numbers handed to this lead.</summary>
    [HttpPut("{leadId:int}/coupon-numbers")]
    public async Task<IActionResult> SetCouponNumbers(int leadId, [FromBody] SetCouponNumbersRequest request)
    {
        try
        {
            var saved = await _leadService.SetCouponNumbersAsync(leadId, request.Numbers ?? new List<string>());
            return Ok(new { success = true, numbers = saved });
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Lead not found" });
        }
        // A number already recorded against a different lead. A 409, same
        // reasoning as the duplicate-phone guard on CreateLead: the request is
        // well-formed, it conflicts with what exists.
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Mints (or rotates) this lead's personal ordering QR token. Any
    /// authenticated employee — this is a convenience for whoever is at the
    /// booth with the customer, not an admin-tier action like deleting or
    /// granting coupons.
    /// </summary>
    [HttpPost("{leadId:int}/self-service-token")]
    public async Task<IActionResult> SetLeadPublicToken(int leadId, [FromBody] SetLeadTokenRequest? request)
    {
        try
        {
            var token = await _leadService.SetLeadPublicTokenAsync(leadId, request?.Rotate ?? false);
            return Ok(new { success = true, public_token = token });
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Lead not found" });
        }
    }
}

public record SetCouponOverrideRequest(int? Slab);
public record SetCouponNumbersRequest(List<string> Numbers);
public record SetLeadTokenRequest(bool Rotate = false);

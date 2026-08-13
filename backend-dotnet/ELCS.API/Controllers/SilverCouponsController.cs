using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/silver-coupons")]
public class SilverCouponsController : ControllerBase
{
    private readonly ISilverCouponService _silverCoupons;

    public SilverCouponsController(ISilverCouponService silverCoupons)
    {
        _silverCoupons = silverCoupons;
    }

    private int? CallerEmployeeId =>
        Request.Headers.TryGetValue("X-Employee-Id", out var raw) && int.TryParse(raw, out var id)
            ? id
            : null;

    /// <summary>Confirms an agent hand-off for the selected customers — see SilverCouponService.CreateAllocationAsync.</summary>
    [HttpPost("allocations")]
    public async Task<IActionResult> CreateAllocation([FromBody] CreateSilverCouponAllocationRequest request)
    {
        try
        {
            var result = await _silverCoupons.CreateAllocationAsync(
                request.AgentName, request.AgentPhone, request.LeadIds, request.CouponNumbers, CallerEmployeeId);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    [HttpGet("agents")]
    public async Task<IActionResult> GetAgents()
    {
        return Ok(await _silverCoupons.GetAgentsAsync());
    }

    [HttpGet("agents/{agentId:int}")]
    public async Task<IActionResult> GetAgentDetail(int agentId)
    {
        var detail = await _silverCoupons.GetAgentDetailAsync(agentId);
        if (detail == null) return NotFound(new { error = "Agent not found" });
        return Ok(detail);
    }
}

public record CreateSilverCouponAllocationRequest(
    string AgentName,
    string AgentPhone,
    List<int> LeadIds,
    List<string> CouponNumbers
);

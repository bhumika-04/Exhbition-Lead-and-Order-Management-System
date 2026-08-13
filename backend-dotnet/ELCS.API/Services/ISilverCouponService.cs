namespace ELCS.API.Services;

public interface ISilverCouponService
{
    /// <summary>
    /// Confirms one agent hand-off: finds-or-creates the agent by phone,
    /// revalidates the combined order value of the given leads server-side,
    /// checks the coupon count matches AdvanceCalculator.SilverCouponsFor of
    /// that combined value, and records the allocation. Rejects (409) if any
    /// of the leads were already allocated to this same agent before, or if
    /// any coupon number is already recorded against another allocation.
    /// </summary>
    Task<SilverCouponAllocationResultDto> CreateAllocationAsync(
        string agentName, string agentPhone, List<int> leadIds, List<string> couponNumbers, int? employeeId);

    /// <summary>All agents, with their totals, ranked by total order value attributed to them.</summary>
    Task<List<SilverCouponAgentSummaryDto>> GetAgentsAsync();

    /// <summary>One agent's totals plus the full list of customers (leads) attributed to them.</summary>
    Task<SilverCouponAgentDetailDto?> GetAgentDetailAsync(int agentId);
}

public record SilverCouponAllocationResultDto(
    int AgentId,
    string AgentName,
    string AgentPhone,
    int AllocationId,
    decimal CombinedValue,
    List<string> CouponNumbers
);

public record SilverCouponAgentSummaryDto(
    int AgentId,
    string Name,
    string Phone,
    int TotalCoupons,
    decimal TotalOrderValue,
    int CustomerCount,
    DateTime? LastAllocationAt
);

public record SilverCouponAgentDetailDto(
    int AgentId,
    string Name,
    string Phone,
    int TotalCoupons,
    decimal TotalOrderValue,
    List<SilverCouponCustomerDto> Customers
);

public record SilverCouponCustomerDto(
    int LeadId,
    string? CompanyName,
    string? PrimaryVisitorName,
    string? PrimaryVisitorPhone,
    decimal LeadValueAtAllocation,
    int AllocationId,
    List<string> CouponNumbers,
    DateTime AllocatedAt,
    List<string> OrderNumbers
);

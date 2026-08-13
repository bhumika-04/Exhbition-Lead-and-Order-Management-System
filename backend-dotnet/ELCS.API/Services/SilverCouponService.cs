using Dapper;
using ELCS.API.Data;
using ELCS.API.Utils;
using System.Text.Json;

namespace ELCS.API.Services;

/// <summary>
/// Silver Coupon Module: an executive selects one or more customers (Leads),
/// confirms who they belong to (an external Agent — name + phone), and
/// records the physical coupon number(s) handed over. Coupons owed follow
/// AdvanceCalculator.SilverCouponsFor applied to the COMBINED value of every
/// selected customer, not each one individually.
/// </summary>
public class SilverCouponService : ISilverCouponService
{
    private readonly ILogger<SilverCouponService> _logger;
    private readonly IDbConnection _db;
    private readonly IOrderService _orderService;

    public SilverCouponService(ILogger<SilverCouponService> logger, IDbConnection db, IOrderService orderService)
    {
        _logger = logger;
        _db = db;
        _orderService = orderService;
    }

    public async Task<SilverCouponAllocationResultDto> CreateAllocationAsync(
        string agentName, string agentPhone, List<int> leadIds, List<string> couponNumbers, int? employeeId)
    {
        agentName = (agentName ?? "").Trim();
        if (agentName.Length == 0) throw new ArgumentException("Agent name is required");

        var normalisedPhone = PhoneValidator.Normalise(agentPhone ?? "");
        if (normalisedPhone == null) throw new ArgumentException("Enter a valid 10-digit agent number");

        var distinctLeadIds = (leadIds ?? new List<int>()).Distinct().ToList();
        if (distinctLeadIds.Count == 0) throw new ArgumentException("Select at least one customer");

        // Re-read each lead's own order total from the DB rather than trust
        // whatever the client last saw — the combined value it's allocated
        // against, and the coupon count it must match, both come from here.
        decimal batchValue = 0m;
        var leadValues = new Dictionary<int, decimal>();
        foreach (var leadId in distinctLeadIds)
        {
            var summary = await _orderService.GetLeadOrderSummaryAsync(leadId);
            leadValues[leadId] = summary.LeadTotal;
            batchValue += summary.LeadTotal;
        }

        var cleanCoupons = (couponNumbers ?? new List<string>())
            .Select(n => n?.Trim() ?? "")
            .Where(n => n.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        // Every coupon number is a physical token — it can be issued once,
        // full stop, regardless of which agent or customer it goes to.
        if (cleanCoupons.Count > 0)
        {
            var existingCoupons = await conn.QueryAsync<string>(
                "SELECT CouponNumbers FROM SilverCouponAllocations");
            var takenNumbers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var json in existingCoupons)
            {
                List<string>? nums;
                try { nums = JsonSerializer.Deserialize<List<string>>(json); } catch { continue; }
                if (nums != null) foreach (var n in nums) takenNumbers.Add(n);
            }
            var clash = cleanCoupons.FirstOrDefault(n => takenNumbers.Contains(n));
            if (clash != null)
                throw new InvalidOperationException($"Coupon {clash} has already been issued");
        }

        using var tx = conn.BeginTransaction();
        try
        {
            var agentId = await conn.ExecuteScalarAsync<int?>(
                "SELECT AgentId FROM SilverCouponAgents WHERE Phone = @Phone", new { Phone = normalisedPhone }, tx);

            // A brand-new agent has nothing tracked yet; an existing one may
            // already be sitting on value and coupons from earlier batches —
            // today's selection tops that up rather than starting over, which
            // is what lets a handful of sub-₹1L customers accumulate toward a
            // coupon across separate visits instead of each being turned away.
            decimal priorValue = 0m;
            int priorCoupons = 0;

            if (agentId == null)
            {
                agentId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO SilverCouponAgents (Name, Phone)
                    OUTPUT INSERTED.AgentId
                    VALUES (@Name, @Phone)",
                    new { Name = agentName, Phone = normalisedPhone }, tx);
            }
            else
            {
                await conn.ExecuteAsync(
                    "UPDATE SilverCouponAgents SET Name = @Name, UpdatedAt = GETUTCDATE() WHERE AgentId = @AgentId",
                    new { Name = agentName, AgentId = agentId }, tx);

                priorValue = await conn.ExecuteScalarAsync<decimal?>(
                    "SELECT SUM(LeadValueAtAllocation) FROM SilverCouponAllocationLeads WHERE AgentId = @AgentId",
                    new { AgentId = agentId }, tx) ?? 0m;
                priorCoupons = await conn.ExecuteScalarAsync<int?>(
                    "SELECT SUM(CouponsCount) FROM SilverCouponAllocations WHERE AgentId = @AgentId",
                    new { AgentId = agentId }, tx) ?? 0;
            }

            // This agent must never be linked to the same customer's order
            // twice — checked here, and guaranteed by a UNIQUE(AgentId, LeadId)
            // index on SilverCouponAllocationLeads as the last line of defence.
            var already = (await conn.QueryAsync<(int LeadId, string? Name, string? CompanyName)>(@"
                SELECT scal.LeadId, l.PrimaryVisitorName AS Name, l.CompanyName
                FROM SilverCouponAllocationLeads scal
                JOIN Leads l ON l.LeadId = scal.LeadId
                WHERE scal.AgentId = @AgentId AND scal.LeadId IN @LeadIds",
                new { AgentId = agentId, LeadIds = distinctLeadIds }, tx)).ToList();
            if (already.Count > 0)
            {
                var who = already.Select(a => a.Name ?? a.CompanyName ?? $"lead #{a.LeadId}");
                throw new InvalidOperationException(
                    $"{agentName} has already been issued a Silver Coupon for: {string.Join(", ", who)}");
            }

            // The batch alone crossing ₹1L is no longer the bar — the agent's
            // running total is. Only the NEW coupons this batch pushes the
            // grand total past are owed here; ones already issued for the
            // same tier on an earlier batch don't get asked for again.
            var grandTotal = priorValue + batchValue;
            var totalOwed = AdvanceCalculator.SilverCouponsFor(grandTotal);
            var newlyOwed = Math.Max(0, totalOwed - priorCoupons);

            if (cleanCoupons.Count != newlyOwed)
                throw new ArgumentException(newlyOwed == 0
                    ? $"No new coupon is owed yet at this agent's running total ({cleanCoupons.Count} entered) — leave the coupon list empty to just track this batch"
                    : $"{agentName}'s running total now earns {newlyOwed} new coupon{(newlyOwed == 1 ? "" : "s")} — {cleanCoupons.Count} entered");

            var couponJson = JsonSerializer.Serialize(cleanCoupons);
            var allocationId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO SilverCouponAllocations (AgentId, CombinedValue, CouponsCount, CouponNumbers, CreatedByEmployeeId)
                OUTPUT INSERTED.AllocationId
                VALUES (@AgentId, @CombinedValue, @CouponsCount, @CouponNumbers, @CreatedByEmployeeId)",
                new { AgentId = agentId, CombinedValue = batchValue, CouponsCount = newlyOwed, CouponNumbers = couponJson, CreatedByEmployeeId = employeeId }, tx);

            foreach (var leadId in distinctLeadIds)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO SilverCouponAllocationLeads (AllocationId, AgentId, LeadId, LeadValueAtAllocation)
                    VALUES (@AllocationId, @AgentId, @LeadId, @LeadValue)",
                    new { AllocationId = allocationId, AgentId = agentId, LeadId = leadId, LeadValue = leadValues[leadId] }, tx);
            }

            tx.Commit();

            _logger.LogInformation("Silver Coupon allocation {AllocationId}: agent {AgentName} ({AgentPhone}), {Count} leads, {Coupons} new coupons, grand total {Grand}",
                allocationId, agentName, normalisedPhone, distinctLeadIds.Count, cleanCoupons.Count, grandTotal);

            return new SilverCouponAllocationResultDto(
                AgentId: agentId.Value,
                AgentName: agentName,
                AgentPhone: normalisedPhone,
                AllocationId: allocationId,
                CombinedValue: batchValue,
                CouponNumbers: cleanCoupons);
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    public async Task<List<SilverCouponAgentSummaryDto>> GetAgentsAsync()
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync<SilverCouponAgentSummaryDto>(@"
            SELECT a.AgentId, a.Name, a.Phone,
                   ISNULL(coup.TotalCoupons, 0)     AS TotalCoupons,
                   ISNULL(cust.TotalOrderValue, 0)  AS TotalOrderValue,
                   ISNULL(cust.CustomerCount, 0)    AS CustomerCount,
                   coup.LastAllocationAt             AS LastAllocationAt
            FROM SilverCouponAgents a
            LEFT JOIN (
                SELECT AgentId, SUM(CouponsCount) AS TotalCoupons, MAX(CreatedAt) AS LastAllocationAt
                FROM SilverCouponAllocations GROUP BY AgentId
            ) coup ON coup.AgentId = a.AgentId
            LEFT JOIN (
                SELECT AgentId, COUNT(*) AS CustomerCount, SUM(LeadValueAtAllocation) AS TotalOrderValue
                FROM SilverCouponAllocationLeads GROUP BY AgentId
            ) cust ON cust.AgentId = a.AgentId
            ORDER BY ISNULL(cust.TotalOrderValue, 0) DESC");
        return rows.ToList();
    }

    public async Task<SilverCouponAgentDetailDto?> GetAgentDetailAsync(int agentId)
    {
        using var conn = _db.CreateConnection();

        var agent = await conn.QueryFirstOrDefaultAsync<(int AgentId, string Name, string Phone)>(
            "SELECT AgentId, Name, Phone FROM SilverCouponAgents WHERE AgentId = @AgentId", new { AgentId = agentId });
        if (agent.AgentId == 0) return null;

        var totalCoupons = await conn.ExecuteScalarAsync<int?>(
            "SELECT SUM(CouponsCount) FROM SilverCouponAllocations WHERE AgentId = @AgentId", new { AgentId = agentId }) ?? 0;

        var rows = await conn.QueryAsync<(int LeadId, string? CompanyName, string? PrimaryVisitorName, string? PrimaryVisitorPhone,
            decimal LeadValueAtAllocation, int AllocationId, string CouponNumbers, DateTime AllocatedAt)>(@"
            SELECT scal.LeadId, l.CompanyName, l.PrimaryVisitorName, l.PrimaryVisitorPhone,
                   scal.LeadValueAtAllocation, a.AllocationId, a.CouponNumbers, a.CreatedAt AS AllocatedAt
            FROM SilverCouponAllocationLeads scal
            JOIN SilverCouponAllocations a ON a.AllocationId = scal.AllocationId
            JOIN Leads l ON l.LeadId = scal.LeadId
            WHERE scal.AgentId = @AgentId
            ORDER BY a.CreatedAt DESC",
            new { AgentId = agentId });

        var leadIds = rows.Select(r => r.LeadId).Distinct().ToList();
        var orderRows = leadIds.Count == 0
            ? Enumerable.Empty<(int LeadId, string OrderNumber)>()
            : await conn.QueryAsync<(int LeadId, string OrderNumber)>(
                "SELECT LeadId, OrderNumber FROM Orders WHERE LeadId IN @LeadIds AND StatusCode <> 'cancelled' ORDER BY CreatedAt",
                new { LeadIds = leadIds });
        var orderNumbersByLead = orderRows
            .GroupBy(o => o.LeadId)
            .ToDictionary(g => g.Key, g => g.Select(o => o.OrderNumber).ToList());

        var customers = rows.Select(r =>
        {
            List<string> coupons;
            try { coupons = JsonSerializer.Deserialize<List<string>>(r.CouponNumbers) ?? new List<string>(); }
            catch { coupons = new List<string>(); }

            return new SilverCouponCustomerDto(
                LeadId: r.LeadId,
                CompanyName: r.CompanyName,
                PrimaryVisitorName: r.PrimaryVisitorName,
                PrimaryVisitorPhone: r.PrimaryVisitorPhone,
                LeadValueAtAllocation: r.LeadValueAtAllocation,
                AllocationId: r.AllocationId,
                CouponNumbers: coupons,
                AllocatedAt: r.AllocatedAt,
                OrderNumbers: orderNumbersByLead.GetValueOrDefault(r.LeadId, new List<string>()));
        }).ToList();

        return new SilverCouponAgentDetailDto(
            AgentId: agent.AgentId,
            Name: agent.Name,
            Phone: agent.Phone,
            TotalCoupons: totalCoupons,
            TotalOrderValue: customers.Sum(c => c.LeadValueAtAllocation),
            Customers: customers);
    }
}

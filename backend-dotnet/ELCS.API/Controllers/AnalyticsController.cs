using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Dapper;
using ELCS.API.Data;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AnalyticsController : ControllerBase
{
    private readonly ILogger<AnalyticsController> _logger;
    private readonly string _connectionString;

    public AnalyticsController(
        ILogger<AnalyticsController> logger,
        IConfiguration config)
    {
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("Connection string not configured");
    }

    [HttpGet("summary")]
    public async Task<IActionResult> GetSummary([FromQuery] int? exhibition_id = null)
    {
        try
        {
            using var conn = new SqlConnection(_connectionString);

            var exhibitionFilter = exhibition_id.HasValue ? " AND ExhibitionId = @ExhibitionId" : "";

            var sql = @"
                SELECT
                    COUNT(*) as TotalLeads,
                    SUM(CASE WHEN StatusCode = 'confirmed' THEN 1 ELSE 0 END) as ConfirmedCount,
                    SUM(CASE WHEN StatusCode = 'pending' OR StatusCode = 'new' THEN 1 ELSE 0 END) as PendingCount,
                    COUNT(DISTINCT ExhibitionId) as TotalExhibitions
                FROM Leads
                WHERE 1=1" + exhibitionFilter;

            var summary = await conn.QueryFirstAsync<AnalyticsSummaryDto>(sql, new { ExhibitionId = exhibition_id });

            _logger.LogInformation("Analytics Summary: TotalLeads={TotalLeads}, Confirmed={Confirmed}, Pending={Pending}, Exhibitions={Exhibitions}",
                summary.TotalLeads, summary.ConfirmedCount, summary.PendingCount, summary.TotalExhibitions);

            // Get lead source breakdown (using SourceCode directly since LeadSources table doesn't exist)
            var sourcesExhibitionFilter = exhibition_id.HasValue ? " AND l.ExhibitionId = @ExhibitionId" : "";
            var sourcesSql = @"
                SELECT
                    COALESCE(l.SourceCode, 'Unknown') as SourceName,
                    COUNT(*) as Count
                FROM Leads l
                WHERE 1=1" + sourcesExhibitionFilter + @"
                GROUP BY l.SourceCode";

            var sources = await conn.QueryAsync<LeadSourceBreakdownDto>(sourcesSql, new { ExhibitionId = exhibition_id });

            return Ok(new
            {
                total_leads = summary.TotalLeads,
                confirmed_count = summary.ConfirmedCount,
                pending_count = summary.PendingCount,
                total_exhibitions = summary.TotalExhibitions,
                conversion_rate = summary.TotalLeads > 0
                    ? (double)summary.ConfirmedCount / summary.TotalLeads * 100
                    : 0,
                lead_sources = sources.ToDictionary(s => s.SourceName, s => s.Count),
                leads_by_source = sources.Select(s => new { source = s.SourceName, count = s.Count }).ToList()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get analytics summary");
            return StatusCode(500, new { error = "Failed to retrieve analytics" });
        }
    }

    [HttpGet("employee-performance")]
    public async Task<IActionResult> GetEmployeePerformance([FromQuery] int? exhibition_id = null)
    {
        try
        {
            using var conn = new SqlConnection(_connectionString);

            var sql = @"
                SELECT
                    e.FullName as EmployeeName,
                    COUNT(l.LeadId) as LeadsCaptured,
                    SUM(CASE WHEN l.StatusCode = 'confirmed' THEN 1 ELSE 0 END) as ConfirmedCount,
                    CAST(
                        CASE
                            WHEN COUNT(l.LeadId) > 0
                            THEN (SUM(CASE WHEN l.StatusCode = 'confirmed' THEN 1 ELSE 0 END) * 100.0 / COUNT(l.LeadId))
                            ELSE 0
                        END AS DECIMAL(5,2)
                    ) as ConversionRate
                FROM Employees e
                LEFT JOIN Leads l ON e.EmployeeId = l.AssignedEmployeeId
                " + (exhibition_id.HasValue ? "AND l.ExhibitionId = @ExhibitionId" : "") + @"
                WHERE e.IsActive = 1
                GROUP BY e.FullName, e.EmployeeId
                HAVING COUNT(l.LeadId) > 0
                ORDER BY LeadsCaptured DESC";

            var performance = await conn.QueryAsync<EmployeePerformanceDto>(sql, new { ExhibitionId = exhibition_id });

            return Ok(new { performance = performance.ToList() });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get employee performance");
            return StatusCode(500, new { error = "Failed to retrieve performance data" });
        }
    }

    [HttpGet("exhibitions")]
    public async Task<IActionResult> GetExhibitionStats()
    {
        try
        {
            using var conn = new SqlConnection(_connectionString);

            var sql = @"
                SELECT
                    e.ExhibitionId as ExhibitionId,
                    e.Name as ExhibitionName,
                    e.Location,
                    e.StartDate as StartDate,
                    e.EndDate as EndDate,
                    COUNT(l.LeadId) as TotalLeads,
                    SUM(CASE WHEN l.StatusCode = 'confirmed' THEN 1 ELSE 0 END) as ConfirmedCount
                FROM Exhibitions e
                LEFT JOIN Leads l ON e.ExhibitionId = l.ExhibitionId
                WHERE e.IsActive = 1
                GROUP BY e.ExhibitionId, e.Name, e.Location, e.StartDate, e.EndDate
                ORDER BY e.StartDate DESC";

            var exhibitions = await conn.QueryAsync(sql);

            return Ok(new { exhibitions = exhibitions.ToList() });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get exhibition stats");
            return StatusCode(500, new { error = "Failed to retrieve exhibition statistics" });
        }
    }
}

// DTOs
public record AnalyticsSummaryDto
{
    public int TotalLeads { get; init; }
    public int ConfirmedCount { get; init; }
    public int PendingCount { get; init; }
    public int TotalExhibitions { get; init; }
}

public record LeadSourceBreakdownDto
{
    public string SourceName { get; init; } = string.Empty;
    public int Count { get; init; }
}

public record EmployeePerformanceDto
{
    public string EmployeeName { get; init; } = string.Empty;
    public int LeadsCaptured { get; init; }
    public int ConfirmedCount { get; init; }
    public decimal ConversionRate { get; init; }
}


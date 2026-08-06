using Dapper;
using Microsoft.AspNetCore.Mvc;
using ELCS.API.Data;
using ELCS.API.Models;
using System.Text.Json.Serialization;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ExhibitionsController : ControllerBase
{
    private readonly ILogger<ExhibitionsController> _logger;
    private readonly IDbConnection _db;
    private readonly TenantContext _tenant;

    public ExhibitionsController(ILogger<ExhibitionsController> logger, IDbConnection db, TenantContext tenant)
    {
        _logger = logger;
        _db = db;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> GetExhibitions()
    {
        using var conn = _db.CreateConnection();
        IEnumerable<Exhibition> exhibitions;
        if (_tenant.IsSuperAdmin || !_tenant.TenantId.HasValue)
        {
            exhibitions = await conn.QueryAsync<Exhibition>(
                "SELECT * FROM Exhibitions WHERE IsActive = 1 ORDER BY StartDate DESC");
        }
        else
        {
            exhibitions = await conn.QueryAsync<Exhibition>(
                "SELECT * FROM Exhibitions WHERE IsActive = 1 AND TenantId = @TenantId ORDER BY StartDate DESC",
                new { _tenant.TenantId });
        }
        return Ok(new { exhibitions });
    }

    [HttpGet("{exhibitionId:int}")]
    public async Task<IActionResult> GetExhibition(int exhibitionId)
    {
        using var conn = _db.CreateConnection();
        var tenantClause = _tenant.IsSuperAdmin ? "" : " AND TenantId = @TenantId";
        var exhibition = await conn.QueryFirstOrDefaultAsync<Exhibition>(
            $"SELECT * FROM Exhibitions WHERE ExhibitionId = @ExhibitionId AND IsActive = 1{tenantClause}",
            new { ExhibitionId = exhibitionId, _tenant.TenantId });

        if (exhibition == null)
            return NotFound(new { error = "Exhibition not found" });

        return Ok(exhibition);
    }

    [HttpPost]
    public async Task<IActionResult> CreateExhibition([FromBody] CreateExhibitionRequest request)
    {
        using var conn = _db.CreateConnection();
        var exhibitionId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO Exhibitions (Name, Location, StartDate, EndDate, Description, IsActive, TenantId, CreatedAt)
            OUTPUT INSERTED.ExhibitionId
            VALUES (@Name, @Location, @StartDate, @EndDate, @Description, 1, @TenantId, GETUTCDATE())",
            new
            {
                request.Name,
                request.Location,
                request.StartDate,
                request.EndDate,
                request.Description,
                TenantId = _tenant.TenantId
            });

        _logger.LogInformation("Created exhibition {ExhibitionId}: {Name}", exhibitionId, request.Name);

        return Ok(new { success = true, exhibition_id = exhibitionId });
    }

    [HttpPut("{exhibitionId:int}")]
    public async Task<IActionResult> UpdateExhibition(int exhibitionId, [FromBody] UpdateExhibitionRequest request)
    {
        using var conn = _db.CreateConnection();

        var tenantClause = _tenant.IsSuperAdmin ? "" : " AND TenantId = @TenantId";
        var exhibition = await conn.QueryFirstOrDefaultAsync<Exhibition>(
            $"SELECT * FROM Exhibitions WHERE ExhibitionId = @ExhibitionId{tenantClause}",
            new { ExhibitionId = exhibitionId, _tenant.TenantId });

        if (exhibition == null)
            return NotFound(new { error = "Exhibition not found" });

        await conn.ExecuteAsync(@"
            UPDATE Exhibitions SET
                Name = COALESCE(@Name, Name),
                Location = COALESCE(@Location, Location),
                StartDate = COALESCE(@StartDate, StartDate),
                EndDate = COALESCE(@EndDate, EndDate),
                Description = COALESCE(@Description, Description)
            WHERE ExhibitionId = @ExhibitionId",
            new
            {
                ExhibitionId = exhibitionId,
                request.Name,
                request.Location,
                request.StartDate,
                request.EndDate,
                request.Description
            });

        return Ok(new { success = true, message = "Exhibition updated" });
    }

    [HttpDelete("{exhibitionId:int}")]
    public async Task<IActionResult> DeleteExhibition(int exhibitionId)
    {
        using var conn = _db.CreateConnection();

        var tenantClause = _tenant.IsSuperAdmin ? "" : " AND TenantId = @TenantId";
        var exhibition = await conn.QueryFirstOrDefaultAsync<Exhibition>(
            $"SELECT * FROM Exhibitions WHERE ExhibitionId = @ExhibitionId{tenantClause}",
            new { ExhibitionId = exhibitionId, _tenant.TenantId });

        if (exhibition == null)
            return NotFound(new { error = "Exhibition not found" });

        // Check if any leads are associated with this exhibition
        var leadCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM Leads WHERE ExhibitionId = @ExhibitionId",
            new { ExhibitionId = exhibitionId });

        if (leadCount > 0)
        {
            return BadRequest(new
            {
                error = "Cannot delete exhibition",
                message = $"This exhibition has {leadCount} lead(s) associated with it. Please delete or reassign the leads before deleting the exhibition.",
                lead_count = leadCount
            });
        }

        // Soft delete - just mark as inactive
        await conn.ExecuteAsync(
            "UPDATE Exhibitions SET IsActive = 0 WHERE ExhibitionId = @ExhibitionId",
            new { ExhibitionId = exhibitionId });

        _logger.LogInformation("Deleted exhibition {ExhibitionId}: {Name}", exhibitionId, exhibition.Name);

        return Ok(new { success = true, message = "Exhibition deleted" });
    }
}

public record CreateExhibitionRequest(
    string Name,
    string? Location,
    DateTime? StartDate,
    DateTime? EndDate,
    string? Description
);

public record UpdateExhibitionRequest(
    string? Name,
    string? Location,
    DateTime? StartDate,
    DateTime? EndDate,
    string? Description
);

using Dapper;
using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;
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
    private readonly IAuthService _auth;

    public ExhibitionsController(ILogger<ExhibitionsController> logger, IDbConnection db, IAuthService auth)
    {
        _logger = logger;
        _db = db;
        _auth = auth;
    }

    private int? CallerEmployeeId =>
        Request.Headers.TryGetValue("X-Employee-Id", out var raw) && int.TryParse(raw, out var id)
            ? id
            : null;

    [HttpGet]
    public async Task<IActionResult> GetExhibitions()
    {
        using var conn = _db.CreateConnection();
        var exhibitions = await conn.QueryAsync<Exhibition>(
            "SELECT * FROM Exhibitions WHERE IsActive = 1 ORDER BY StartDate DESC");
        return Ok(new { exhibitions });
    }

    [HttpGet("{exhibitionId:int}")]
    public async Task<IActionResult> GetExhibition(int exhibitionId)
    {
        using var conn = _db.CreateConnection();
        var exhibition = await conn.QueryFirstOrDefaultAsync<Exhibition>(
            "SELECT * FROM Exhibitions WHERE ExhibitionId = @ExhibitionId AND IsActive = 1",
            new { ExhibitionId = exhibitionId });

        if (exhibition == null)
            return NotFound(new { error = "Exhibition not found" });

        return Ok(exhibition);
    }

    [HttpPost]
    public async Task<IActionResult> CreateExhibition([FromBody] CreateExhibitionRequest request)
    {
        using var conn = _db.CreateConnection();
        var exhibitionId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO Exhibitions (Name, Location, StartDate, EndDate, Description, IsActive, CreatedAt)
            OUTPUT INSERTED.ExhibitionId
            VALUES (@Name, @Location, @StartDate, @EndDate, @Description, 1, GETUTCDATE())",
            new
            {
                request.Name,
                request.Location,
                request.StartDate,
                request.EndDate,
                request.Description
            });

        _logger.LogInformation("Created exhibition {ExhibitionId}: {Name}", exhibitionId, request.Name);

        return Ok(new { success = true, exhibition_id = exhibitionId });
    }

    [HttpPut("{exhibitionId:int}")]
    public async Task<IActionResult> UpdateExhibition(int exhibitionId, [FromBody] UpdateExhibitionRequest request)
    {
        using var conn = _db.CreateConnection();

        var exhibition = await conn.QueryFirstOrDefaultAsync<Exhibition>(
            "SELECT * FROM Exhibitions WHERE ExhibitionId = @ExhibitionId",
            new { ExhibitionId = exhibitionId });

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

    /// <summary>
    /// Turns self-service ordering on or off for an exhibition. Enabling mints an
    /// opaque public token — the payload behind the printed QR code. The token is
    /// random rather than the ExhibitionId so a visitor cannot reach another
    /// exhibition's ordering page by editing the URL.
    /// </summary>
    [HttpPost("{exhibitionId:int}/self-service")]
    public async Task<IActionResult> SetSelfService(
        int exhibitionId,
        [FromBody] SetSelfServiceRequest request)
    {
        using var conn = _db.CreateConnection();

        var exhibition = await conn.QueryFirstOrDefaultAsync<Exhibition>(
            "SELECT * FROM Exhibitions WHERE ExhibitionId = @Id AND IsActive = 1",
            new { Id = exhibitionId });

        if (exhibition == null)
            return NotFound(new { error = "Exhibition not found" });

        string? token = await conn.ExecuteScalarAsync<string?>(
            "SELECT PublicToken FROM Exhibitions WHERE ExhibitionId = @Id", new { Id = exhibitionId });

        // Rotate on request — if a printed QR leaks or a batch is reprinted, the
        // old link must stop working.
        if (request.Enabled && (string.IsNullOrWhiteSpace(token) || request.RotateToken))
            token = Guid.NewGuid().ToString("N");

        await conn.ExecuteAsync(@"
            UPDATE Exhibitions
            SET SelfServiceEnabled = @Enabled,
                PublicToken        = @Token
            WHERE ExhibitionId = @Id",
            new { Enabled = request.Enabled, Token = token, Id = exhibitionId });

        _logger.LogInformation("Self-service {State} for exhibition {ExhibitionId}",
            request.Enabled ? "enabled" : "disabled", exhibitionId);

        return Ok(new
        {
            success              = true,
            self_service_enabled = request.Enabled,
            public_token         = request.Enabled ? token : null,
        });
    }

    [HttpDelete("{exhibitionId:int}")]
    public async Task<IActionResult> DeleteExhibition(int exhibitionId)
    {
        // Deleting is administrators only. Enforced HERE and not merely by
        // hiding the button, because the endpoint is reachable directly and a
        // deleted order takes its lines, its Sales Order and the customer's
        // history with it.
        if (!await _auth.CanDeleteRecordsAsync(CallerEmployeeId))
            return StatusCode(StatusCodes.Status403Forbidden,
                new { error = "Only an administrator can delete this." });
        using var conn = _db.CreateConnection();

        var exhibition = await conn.QueryFirstOrDefaultAsync<Exhibition>(
            "SELECT * FROM Exhibitions WHERE ExhibitionId = @ExhibitionId",
            new { ExhibitionId = exhibitionId });

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

public record SetSelfServiceRequest(bool Enabled, bool RotateToken = false);

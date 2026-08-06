using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using ELCS.API.Data;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

/// <summary>
/// Self-service ordering from a QR code at the booth. Every endpoint here is
/// PUBLIC — no employee header, no login.
///
/// Rules this controller exists to enforce:
///  • Nothing about a lead is returned until an OTP sent to that number is
///    verified. A phone number is a claim, not a credential.
///  • Existence of a lead is never revealed before verification, so the page
///    cannot be used to test which numbers are customers.
///  • Self-service orders are created as drafts flagged 'self_service'. The
///    customer never sets their own advance or coupon count — a CRR confirms
///    and records what was actually collected.
/// </summary>
[ApiController]
[Route("api/public")]
[EnableRateLimiting("public")]
public class PublicOrderController : ControllerBase
{
    private readonly ILogger<PublicOrderController> _logger;
    private readonly IDbConnection _db;
    private readonly IOtpService _otp;
    private readonly IOrderService _orders;

    public PublicOrderController(
        ILogger<PublicOrderController> logger,
        IDbConnection db,
        IOtpService otp,
        IOrderService orders)
    {
        _logger = logger;
        _db = db;
        _otp = otp;
        _orders = orders;
    }

    private const string SessionHeader = "X-Public-Session";

    /// <summary>Resolves the QR token. Returns only the exhibition's public face.</summary>
    [HttpGet("exhibition/{token}")]
    public async Task<IActionResult> GetExhibition(string token)
    {
        var ex = await FindExhibitionAsync(token);
        if (ex == null)
            return NotFound(new { error = "This ordering link is not valid" });

        return Ok(new
        {
            exhibition_id = ex.ExhibitionId,
            name          = ex.Name,
            location      = ex.Location,
            item_types    = OrderItemTypes.All,
        });
    }

    [HttpPost("otp/request")]
    public async Task<IActionResult> RequestOtp([FromBody] PublicOtpRequest request)
    {
        var ex = await FindExhibitionAsync(request.Token);
        if (ex == null) return NotFound(new { error = "This ordering link is not valid" });

        var result = await _otp.RequestAsync(request.Mobile, ex.ExhibitionId);

        // The response is identical whether or not the number belongs to an
        // existing lead — otherwise this endpoint becomes a customer-list oracle.
        if (!result.Sent)
            return BadRequest(new { error = result.Error, retry_after_seconds = result.RetryAfterSeconds });

        return Ok(new { success = true, retry_after_seconds = result.RetryAfterSeconds });
    }

    [HttpPost("otp/verify")]
    public async Task<IActionResult> VerifyOtp([FromBody] PublicOtpVerifyRequest request)
    {
        var ex = await FindExhibitionAsync(request.Token);
        if (ex == null) return NotFound(new { error = "This ordering link is not valid" });

        var result = await _otp.VerifyAsync(request.Mobile, request.Code, ex.ExhibitionId);
        if (!result.Verified)
            return BadRequest(new { error = result.Error, attempts_remaining = result.AttemptsRemaining });

        var session = await _otp.GetSessionAsync(result.SessionToken);
        var mobile = session?.Mobile ?? OtpService.NormaliseMobile(request.Mobile)!;

        // Only now — after proving the number — does any lead data come back.
        // Phone numbers are not unique in this schema (duplicate detection warns
        // but permits saving), so the most recent lead wins and the customer is
        // asked to confirm it is them.
        using var conn = _db.CreateConnection();
        var lead = await conn.QueryFirstOrDefaultAsync<PublicLeadDto>(@"
            SELECT TOP 1 LeadId, PrimaryVisitorName AS Name, CompanyName
            FROM Leads
            WHERE REPLACE(REPLACE(REPLACE(REPLACE(PrimaryVisitorPhone,' ',''),'-',''),'(',''),')','')
                  LIKE '%' + @Mobile
            ORDER BY CreatedAt DESC", new { Mobile = mobile });

        if (lead != null && session != null)
            await _otp.BindLeadAsync(session.PublicSessionId, lead.LeadId);

        return Ok(new
        {
            success       = true,
            session_token = result.SessionToken,
            known_lead    = lead,     // null → the page asks them to register
        });
    }

    /// <summary>Creates a lead from the public page when the number is new to us.</summary>
    [HttpPost("lead")]
    public async Task<IActionResult> SelfRegister([FromBody] PublicRegisterRequest request)
    {
        var session = await RequireSessionAsync();
        if (session == null) return Unauthorized(new { error = "Verify your mobile number first" });

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Please enter your name" });

        using var conn = _db.CreateConnection();

        var leadId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO Leads (ExhibitionId, SourceCode, StatusCode, CompanyName,
                               PrimaryVisitorName, PrimaryVisitorPhone, PrimaryVisitorEmail, CreatedAt)
            OUTPUT INSERTED.LeadId
            VALUES (@ExhibitionId, 'self_service', 'new', @CompanyName,
                    @Name, @Phone, @Email, GETUTCDATE())",
            new
            {
                ExhibitionId = session.ExhibitionId,
                CompanyName  = request.CompanyName,
                Name         = request.Name.Trim(),
                Phone        = session.Mobile,      // from the verified session, never the body
                Email        = request.Email,
            });

        await _otp.BindLeadAsync(session.PublicSessionId, leadId);
        _logger.LogInformation("Self-registered lead {LeadId} at exhibition {ExhibitionId}",
            leadId, session.ExhibitionId);

        return Ok(new { success = true, lead_id = leadId });
    }

    /// <summary>Submits the customer's own order as a pending draft for a CRR.</summary>
    [HttpPost("order")]
    public async Task<IActionResult> SubmitOrder([FromBody] PublicOrderRequest request)
    {
        var session = await RequireSessionAsync();
        if (session == null) return Unauthorized(new { error = "Verify your mobile number first" });
        if (session.LeadId == null)
            return BadRequest(new { error = "Tell us who you are before ordering" });

        if (request.Items == null || request.Items.Count == 0)
            return BadRequest(new { error = "Add at least one item" });

        try
        {
            // Rate is never accepted from the public page — pricing is not the
            // customer's to set. Lines carry item details only; a CRR prices and
            // records the advance at confirmation.
            var items = request.Items.Select(i => new CreateOrderItemRequest(
                ItemType:      i.ItemType,
                Barcode:       i.Barcode,
                Size:          i.Size,
                Colour:        i.Colour,
                Pieces:        i.Pieces,
                Rate:          null,
                Customization: i.Customization)).ToList();

            var orderId = await _orders.CreateOrderAsync(
                new CreateOrderRequest(session.LeadId.Value, items, request.Notes), null);

            using var conn = _db.CreateConnection();
            await conn.ExecuteAsync(
                "UPDATE Orders SET Source = 'self_service' WHERE OrderId = @OrderId",
                new { OrderId = orderId });

            var orderNumber = await conn.ExecuteScalarAsync<string>(
                "SELECT OrderNumber FROM Orders WHERE OrderId = @OrderId", new { OrderId = orderId });

            _logger.LogInformation("Self-service order {OrderNumber} submitted for lead {LeadId}",
                orderNumber, session.LeadId);

            return Ok(new { success = true, order_number = orderNumber, item_count = items.Count });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    private async Task<PublicSession?> RequireSessionAsync()
    {
        var token = Request.Headers.TryGetValue(SessionHeader, out var raw) ? raw.ToString() : null;
        return await _otp.GetSessionAsync(token);
    }

    private async Task<PublicExhibitionRow?> FindExhibitionAsync(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<PublicExhibitionRow>(@"
            SELECT ExhibitionId, Name, Location
            FROM Exhibitions
            WHERE PublicToken = @Token AND IsActive = 1 AND SelfServiceEnabled = 1",
            new { Token = token.Trim() });
    }

    public sealed class PublicExhibitionRow
    {
        public int ExhibitionId { get; set; }
        public string? Name { get; set; }
        public string? Location { get; set; }
    }
}

public record PublicLeadDto(int LeadId, string? Name, string? CompanyName);

public record PublicOtpRequest(string Token, string Mobile);
public record PublicOtpVerifyRequest(string Token, string Mobile, string Code);
public record PublicRegisterRequest(string Name, string? CompanyName, string? Email);

public record PublicOrderItemRequest(
    string ItemType,
    string? Barcode,
    string? Size,
    string? Colour,
    int Pieces,
    string? Customization
);

public record PublicOrderRequest(List<PublicOrderItemRequest> Items, string? Notes);

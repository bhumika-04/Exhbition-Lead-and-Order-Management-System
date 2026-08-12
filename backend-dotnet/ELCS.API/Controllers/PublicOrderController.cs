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
///  • Self-service orders are created as drafts flagged 'self_service'. The
///    customer never sets their own advance or coupon count — a CRR confirms
///    and records what was actually collected. This is the control that makes
///    the rest of the page safe to leave open.
///  • The catalogue and every lead detail sit behind a session token, so none
///    of it is reachable by walking URLs.
///  • A typed mobile number is taken at face value, which is the intended booth
///    behaviour: the QR is printed on the stall and staff are standing there.
///    The number opens a session; it does not prove identity, so nothing more
///    sensitive than the customer's own draft order sits behind it.
/// </summary>
[ApiController]
[Route("api/public")]
[EnableRateLimiting("public")]
public class PublicOrderController : ControllerBase
{
    private readonly ILogger<PublicOrderController> _logger;
    private readonly IDbConnection _db;
    private readonly IPublicSessionService _sessions;
    private readonly IOrderService _orders;
    private readonly IProductService _products;

    public PublicOrderController(
        ILogger<PublicOrderController> logger,
        IDbConnection db,
        IPublicSessionService sessions,
        IOrderService orders,
        IProductService products)
    {
        _logger = logger;
        _db = db;
        _sessions = sessions;
        _orders = orders;
        _products = products;
    }

    private const string SessionHeader = "X-Public-Session";

    /// <summary>
    /// Resolves the QR token — either an exhibition's (customer types their
    /// mobile next) or a specific lead's personal one (customer is already
    /// known, so the page skips straight to a confirmation step instead).
    /// Returns only the exhibition's public face either way.
    /// </summary>
    [HttpGet("exhibition/{token}")]
    public async Task<IActionResult> GetExhibition(string token)
    {
        var ex = await FindExhibitionAsync(token);
        if (ex != null)
            return Ok(new
            {
                exhibition_id = ex.ExhibitionId,
                name          = ex.Name,
                location      = ex.Location,
                is_lead_link  = false,
            });

        var lead = await FindLeadLinkAsync(token);
        if (lead == null)
            return NotFound(new { error = "This ordering link is not valid" });

        return Ok(new
        {
            exhibition_id = lead.ExhibitionId,
            name          = lead.ExhibitionName,
            location      = lead.ExhibitionLocation,
            is_lead_link  = true,
            lead_name     = lead.Name,
        });
    }

    /// <summary>Opens a session from the mobile number the customer typed.</summary>
    [HttpPost("session")]
    public async Task<IActionResult> StartSession([FromBody] PublicSessionRequest request)
    {
        var ex = await FindExhibitionAsync(request.Token);
        if (ex == null) return NotFound(new { error = "This ordering link is not valid" });

        var result = await _sessions.StartSessionAsync(request.Mobile, ex.ExhibitionId);
        if (!result.Success)
            return BadRequest(new { error = result.Error });

        var session = await _sessions.GetSessionAsync(result.SessionToken);
        var mobile = session?.Mobile ?? PublicSessionService.NormaliseMobile(request.Mobile)!;

        return Ok(new
        {
            success       = true,
            session_token = result.SessionToken,
            known_lead    = await MatchLeadAsync(mobile, session),
        });
    }

    /// <summary>
    /// Opens a session for a lead's personal QR — the token already says who
    /// this is, so there is no mobile number to type and no phone match to
    /// run: it goes straight from token to bound session.
    /// </summary>
    [HttpPost("session/lead")]
    public async Task<IActionResult> StartLeadSession([FromBody] PublicLeadSessionRequest request)
    {
        var lead = await FindLeadLinkAsync(request.Token);
        if (lead == null)
            return NotFound(new { error = "This ordering link is not valid" });

        using var conn = _db.CreateConnection();
        var phone = await conn.ExecuteScalarAsync<string?>(
            "SELECT PrimaryVisitorPhone FROM Leads WHERE LeadId = @LeadId", new { lead.LeadId });

        // Every lead is created with a phone, so this is a data problem, not a
        // normal path — but a null here must not reach StartSessionAsync,
        // which expects a real (if possibly invalid) string to normalise.
        if (string.IsNullOrWhiteSpace(phone))
            return BadRequest(new { error = "This lead has no phone number on file — please check with our staff" });

        var result = await _sessions.StartSessionAsync(phone, lead.ExhibitionId);
        if (!result.Success)
            return BadRequest(new { error = result.Error });

        var session = await _sessions.GetSessionAsync(result.SessionToken);
        if (session != null)
            await _sessions.BindLeadAsync(session.PublicSessionId, lead.LeadId);

        return Ok(new
        {
            success       = true,
            session_token = result.SessionToken,
            known_lead    = new PublicLeadDto(lead.LeadId, lead.Name, null),
        });
    }

    /// <summary>
    /// Finds the lead behind a number and binds it to the session.
    /// Phone numbers are not unique in this schema (duplicate detection warns but
    /// permits saving), so the most recent lead wins and the page asks the
    /// customer to confirm it is them. Null → the page asks them to register.
    /// </summary>
    private async Task<PublicLeadDto?> MatchLeadAsync(string mobile, PublicSession? session)
    {
        using var conn = _db.CreateConnection();
        var lead = await conn.QueryFirstOrDefaultAsync<PublicLeadDto>(@"
            SELECT TOP 1 LeadId, PrimaryVisitorName AS Name, CompanyName
            FROM Leads
            WHERE REPLACE(REPLACE(REPLACE(REPLACE(PrimaryVisitorPhone,' ',''),'-',''),'(',''),')','')
                  LIKE '%' + @Mobile
            ORDER BY CreatedAt DESC", new { Mobile = mobile });

        if (lead != null && session != null)
            await _sessions.BindLeadAsync(session.PublicSessionId, lead.LeadId);

        return lead;
    }


    /// <summary>Creates a lead from the public page when the number is new to us.</summary>
    [HttpPost("lead")]
    public async Task<IActionResult> SelfRegister([FromBody] PublicRegisterRequest request)
    {
        var session = await RequireSessionAsync();
        if (session == null) return Unauthorized(new { error = "Your session has ended — please scan the code again" });

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
                Phone        = session.Mobile,      // from the session, never the body
                Email        = request.Email,
            });

        await _sessions.BindLeadAsync(session.PublicSessionId, leadId);
        _logger.LogInformation("Self-registered lead {LeadId} at exhibition {ExhibitionId}",
            leadId, session.ExhibitionId);

        // No welcome message on this path. A visitor registering at the QR is
        // standing at the stall with staff beside them, so a WhatsApp greeting
        // adds nothing — and it would arrive before anyone has met them, which
        // is not what the message says. Staff send it from the lead screen.

        return Ok(new { success = true, lead_id = leadId });
    }

    /// <summary>
    /// Resolves a scanned barcode so the customer sees the garment they are
    /// adding. Session-gated: without it this endpoint is an open price list
    /// that anyone could walk the whole catalogue through.
    /// </summary>
    [HttpGet("product/{barcode}")]
    public async Task<IActionResult> LookupProduct(string barcode)
    {
        var session = await RequireSessionAsync();
        if (session == null) return Unauthorized(new { error = "Your session has ended — please scan the code again" });

        var product = await _products.GetByBarcodeAsync(barcode);
        if (product == null)
            return NotFound(new { error = "We couldn't find that code — please check with our staff" });

        // Only the customer-facing face of a product. No internal id or flags.
        return Ok(new
        {
            product_id   = product.ProductId,
            barcode      = product.Barcode,
            size         = product.Size,
            colour       = product.Colour,
            fabric       = product.Fabric,
            price        = product.Price,
            name         = product.Name,
            image_path   = product.ImagePath,
            image_url    = product.ImageUrl,
            colour_is_set = product.ColourIsSet,
            size_is_set   = product.SizeIsSet,
        });
    }

    /// <summary>
    /// Live search while typing, for when the printed barcode will not scan.
    /// Without this a mistyped or partial code just 404s — which the customer
    /// cannot tell apart from "not in the catalogue" — and there is no way to
    /// find the right item except retyping blind. Same session gate and same
    /// public-safe field shape as LookupProduct; capped short because this is
    /// a type-ahead dropdown, not a catalogue browse.
    /// </summary>
    [HttpGet("products/search")]
    public async Task<IActionResult> SearchProducts([FromQuery] string q)
    {
        var session = await RequireSessionAsync();
        if (session == null) return Unauthorized(new { error = "Your session has ended — please scan the code again" });

        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
            return Ok(new { products = Array.Empty<object>() });

        var (products, _) = await _products.SearchAsync(new ProductSearchParams(Search: q.Trim(), Limit: 8));

        return Ok(new
        {
            products = products.Select(product => new
            {
                product_id   = product.ProductId,
                barcode      = product.Barcode,
                size         = product.Size,
                colour       = product.Colour,
                fabric       = product.Fabric,
                price        = product.Price,
                name         = product.Name,
                image_path   = product.ImagePath,
                image_url    = product.ImageUrl,
                colour_is_set = product.ColourIsSet,
                size_is_set   = product.SizeIsSet,
            }),
        });
    }

    /// <summary>
    /// Orders already placed by the customer behind this session.
    ///
    /// Without this the QR page is a blank slate on every visit: a customer who
    /// ordered an hour ago sees "nothing added yet" and reasonably concludes the
    /// order was lost. Session-gated and scoped to that session's own lead.
    ///
    /// Deliberately narrow. Coupons and the advance are set by a CRR against
    /// what was actually collected, and showing a customer a figure they can
    /// neither verify nor change at the stall invites an argument at the
    /// counter — so this returns what they ordered, not what they owe.
    /// </summary>
    [HttpGet("orders")]
    public async Task<IActionResult> MyOrders()
    {
        var session = await RequireSessionAsync();
        if (session == null) return Unauthorized(new { error = "Your session has ended — please scan the code again" });
        if (session.LeadId == null) return Ok(new { orders = Array.Empty<object>() });

        using var conn = _db.CreateConnection();
        var orders = await conn.QueryAsync(@"
            SELECT o.OrderNumber                       AS order_number,
                   o.StatusCode                        AS status_code,
                   COALESCE(o.OrderValue, o.OrderTotal) AS total,
                   o.CreatedAt                         AS created_at,
                   ISNULL(i.ItemCount, 0)              AS item_count,
                   ISNULL(i.TotalPieces, 0)            AS total_pieces
            FROM Orders o
            OUTER APPLY (
                SELECT COUNT(*) AS ItemCount, SUM(Pieces) AS TotalPieces
                FROM OrderItems WHERE OrderId = o.OrderId
            ) i
            WHERE o.LeadId = @LeadId
            ORDER BY o.CreatedAt DESC",
            new { LeadId = session.LeadId.Value });

        return Ok(new { orders });
    }

    /// <summary>
    /// The lines of one of the customer's own orders — the same picture the
    /// Sales Order PDF shows, so what they read on their phone matches the
    /// document they are handed.
    ///
    /// Looked up by order NUMBER and constrained to the session's lead, so the
    /// id cannot be walked to reach somebody else's order.
    /// </summary>
    [HttpGet("orders/{orderNumber}")]
    public async Task<IActionResult> MyOrder(string orderNumber)
    {
        var session = await RequireSessionAsync();
        if (session == null) return Unauthorized(new { error = "Your session has ended — please scan the code again" });
        if (session.LeadId == null) return NotFound(new { error = "Order not found" });

        using var conn = _db.CreateConnection();

        var order = await conn.QueryFirstOrDefaultAsync(@"
            SELECT o.OrderId, o.OrderNumber, o.StatusCode, o.CreatedAt, o.Notes,
                   COALESCE(o.OrderValue, o.OrderTotal) AS Total
            FROM Orders o
            WHERE o.OrderNumber = @Number AND o.LeadId = @LeadId",
            new { Number = orderNumber, LeadId = session.LeadId.Value });

        if (order == null) return NotFound(new { error = "Order not found" });

        var items = await conn.QueryAsync(@"
            SELECT oi.LineNumber   AS line_number,
                   oi.Barcode      AS barcode,
                   oi.Size         AS size,
                   oi.Colour       AS colour,
                   oi.Fabric       AS fabric,
                   oi.Pieces       AS pieces,
                   oi.Rate         AS rate,
                   oi.Amount       AS amount,
                   oi.Customization AS customization,
                   p.Name          AS name,
                   p.ImagePath     AS image_path,
                   p.ImageUrl      AS image_url
            FROM OrderItems oi
            LEFT JOIN Products p ON p.ProductId = oi.ProductId
            WHERE oi.OrderId = @OrderId
            ORDER BY oi.LineNumber",
            new { OrderId = (int)order.OrderId });

        return Ok(new
        {
            order_number = (string)order.OrderNumber,
            status_code  = (string)order.StatusCode,
            created_at   = (DateTime)order.CreatedAt,
            notes        = (string?)order.Notes,
            total        = (decimal)order.Total,
            items,
        });
    }

    /// <summary>
    /// Lets the customer change an order that is still with our team.
    ///
    /// Only a DRAFT of their OWN lead, and the draft stays a draft — which is
    /// the approval. Nothing they change takes effect commercially until a CRR
    /// confirms it, so no separate review state is needed; staff see the order
    /// as it now stands at the moment they confirm.
    ///
    /// Prices are re-read from the catalogue exactly as on the first submit, so
    /// an edit cannot be used to restate what a garment costs.
    /// </summary>
    [HttpPut("orders/{orderNumber}")]
    public async Task<IActionResult> EditMyOrder(string orderNumber, [FromBody] PublicOrderRequest request)
    {
        var session = await RequireSessionAsync();
        if (session == null) return Unauthorized(new { error = "Your session has ended — please scan the code again" });
        if (session.LeadId == null) return NotFound(new { error = "Order not found" });

        if (request.Items == null || request.Items.Count == 0)
            return BadRequest(new { error = "Keep at least one item, or ask our staff to cancel the order" });

        using var conn = _db.CreateConnection();

        // Matched on lead as well as number, so an order number belonging to
        // somebody else is simply "not found" rather than an error that
        // confirms it exists.
        var row = await conn.QueryFirstOrDefaultAsync(@"
            SELECT OrderId, StatusCode FROM Orders
            WHERE OrderNumber = @Number AND LeadId = @LeadId",
            new { Number = orderNumber, LeadId = session.LeadId.Value });

        if (row == null) return NotFound(new { error = "Order not found" });

        if (!string.Equals((string)row.StatusCode, "draft", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { error = "Our team has already confirmed this order — please speak to us at the counter." });

        try
        {
            var items = request.Items.Select(i => new CreateOrderItemRequest(
                Barcode:       i.Barcode,
                Size:          i.Size,
                Colour:        i.Colour,
                Pieces:        i.Pieces,
                Rate:          null,
                Customization: i.Customization,
                ProductId:     i.ProductId)).ToList();

            await _orders.UpdateOrderAsync((int)row.OrderId, new UpdateOrderRequest(items, request.Notes, null));

            _logger.LogInformation("Customer edited self-service order {OrderNumber} on lead {LeadId}",
                orderNumber, session.LeadId);

            return Ok(new { success = true, order_number = orderNumber, item_count = items.Count });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Submits the customer's own order as a pending draft for a CRR.</summary>
    [HttpPost("order")]
    public async Task<IActionResult> SubmitOrder([FromBody] PublicOrderRequest request)
    {
        var session = await RequireSessionAsync();
        if (session == null) return Unauthorized(new { error = "Your session has ended — please scan the code again" });
        if (session.LeadId == null)
            return BadRequest(new { error = "Tell us who you are before ordering" });

        if (request.Items == null || request.Items.Count == 0)
            return BadRequest(new { error = "Add at least one item" });

        try
        {
            // Rate is never accepted from the public page — pricing is not the
            // customer's to set. Passing ProductId lets the server price the line
            // from the catalogue itself, which is both safer and more useful than
            // leaving it blank for the CRR to fill in.
            var items = request.Items.Select(i => new CreateOrderItemRequest(
                Barcode:       i.Barcode,
                Size:          i.Size,
                Colour:        i.Colour,
                Pieces:        i.Pieces,
                Rate:          null,
                Customization: i.Customization,
                ProductId:     i.ProductId)).ToList();

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
        return await _sessions.GetSessionAsync(token);
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

    /// <summary>
    /// A lead's personal token, resolved to the exhibition it opens onto. Not
    /// gated on Exhibitions.SelfServiceEnabled — a lead's own QR is handed to
    /// them directly by staff, unlike the printed booth code, so it works
    /// even for an exhibition that never turned the general QR on.
    /// </summary>
    private async Task<PublicLeadLinkRow?> FindLeadLinkAsync(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<PublicLeadLinkRow>(@"
            SELECT l.LeadId, l.ExhibitionId, l.PrimaryVisitorName AS Name,
                   e.Name AS ExhibitionName, e.Location AS ExhibitionLocation
            FROM Leads l
            JOIN Exhibitions e ON e.ExhibitionId = l.ExhibitionId
            WHERE l.PublicToken = @Token AND e.IsActive = 1",
            new { Token = token.Trim() });
    }

    public sealed class PublicExhibitionRow
    {
        public int ExhibitionId { get; set; }
        public string? Name { get; set; }
        public string? Location { get; set; }
    }

    public sealed class PublicLeadLinkRow
    {
        public int LeadId { get; set; }
        public int ExhibitionId { get; set; }
        public string? Name { get; set; }
        public string? ExhibitionName { get; set; }
        public string? ExhibitionLocation { get; set; }
    }
}

public record PublicLeadDto(int LeadId, string? Name, string? CompanyName);

public record PublicSessionRequest(string Token, string Mobile);
public record PublicLeadSessionRequest(string Token);
public record PublicRegisterRequest(string Name, string? CompanyName, string? Email);

public record PublicOrderItemRequest(
    string? Barcode,
    string? Size,
    string? Colour,
    int Pieces,
    string? Customization,
    int? ProductId = null
);

public record PublicOrderRequest(List<PublicOrderItemRequest> Items, string? Notes);

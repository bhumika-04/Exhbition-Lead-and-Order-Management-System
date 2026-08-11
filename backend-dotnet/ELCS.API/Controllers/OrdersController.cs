using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;
using ELCS.API.Utils;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly ILogger<OrdersController> _logger;
    private readonly IOrderService _orderService;
    private readonly IAuthService _auth;
    private readonly ISalesOrderPdfService _pdfService;
    private readonly IWhatsAppService _whatsApp;
    private readonly IConfiguration _config;

    public OrdersController(
        ILogger<OrdersController> logger,
        IOrderService orderService, IAuthService auth,
        ISalesOrderPdfService pdfService,
        IWhatsAppService whatsApp,
        IConfiguration config)
    {
        _logger = logger;
        _orderService = orderService;
        _auth = auth;
        _pdfService = pdfService;
        _whatsApp = whatsApp;
        _config = config;
    }

    private int? CallerEmployeeId =>
        Request.Headers.TryGetValue("X-Employee-Id", out var raw) && int.TryParse(raw, out var id)
            ? id
            : null;

    /// <summary>
    /// Slab options for the payment step. Each slab suggests ₹11,000 × slab as the
    /// advance; the operator may then change it, and coupons follow what is taken.
    /// </summary>
    [HttpGet("slabs")]
    public IActionResult GetSlabs([FromQuery] int count = 6)
    {
        var slabs = Enumerable.Range(1, Math.Clamp(count, 1, 20)).Select(n => new
        {
            slab = n,
            from_value = AdvanceCalculator.SlabSize * n,
            to_value = AdvanceCalculator.SlabSize * (n + 1),
            suggested_advance = AdvanceCalculator.SuggestedAdvance(n),
            coupons_if_paid = AdvanceCalculator.CouponsForSlab(n),
        });
        return Ok(new { slabs, slab_size = AdvanceCalculator.SlabSize, advance_per_slab = AdvanceCalculator.AdvancePerSlab });
    }

    /// <summary>Orders page — filters, barcode search and totals.</summary>
    [HttpGet]
    public async Task<IActionResult> SearchOrders(
        [FromQuery] int? exhibition_id,
        [FromQuery] string? status_code,
        [FromQuery] string? search,
        [FromQuery] string? source,
        [FromQuery] DateTime? from_date,
        [FromQuery] DateTime? to_date,
        [FromQuery] int limit = 100,
        [FromQuery] int offset = 0)
    {
        var result = await _orderService.SearchOrdersAsync(new OrderSearchParams(
            ExhibitionId: exhibition_id,
            StatusCode:   status_code,
            Search:       search,
            Source:       source,
            FromDate:     from_date,
            ToDate:       to_date,
            Limit:        Math.Clamp(limit, 1, 500),
            Offset:       Math.Max(offset, 0)));

        return Ok(new { orders = result.Orders, count = result.TotalCount, totals = result.Totals });
    }

    /// <summary>Leads ranked by lucky-draw coupons.</summary>
    [HttpGet("coupons")]
    public async Task<IActionResult> GetCouponHolders([FromQuery] int? exhibition_id)
        => Ok(new { holders = await _orderService.GetCouponHoldersAsync(exhibition_id) });

    [HttpGet("lead/{leadId:int}")]
    public async Task<IActionResult> GetOrdersForLead(int leadId)
    {
        var orders  = await _orderService.GetOrdersForLeadAsync(leadId);
        var summary = await _orderService.GetLeadOrderSummaryAsync(leadId);
        return Ok(new { orders, summary });
    }

    /// <summary>Value / advance / coupon position for a lead across all their orders.</summary>
    [HttpGet("lead/{leadId:int}/summary")]
    public async Task<IActionResult> GetLeadSummary(int leadId)
        => Ok(await _orderService.GetLeadOrderSummaryAsync(leadId));

    /// <summary>Sets the slab, order value and the advance actually taken.</summary>
    [HttpPut("{orderId:int}/payment")]
    public async Task<IActionResult> SetPayment(int orderId, [FromBody] SetOrderPaymentRequest request)
    {
        try
        {
            await _orderService.SetOrderPaymentAsync(orderId, request);
            return Ok(new { success = true, order = await _orderService.GetOrderAsync(orderId) });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Order not found" });
        }
    }

    private static readonly string[] AllowedProofTypes = { ".jpg", ".jpeg", ".png", ".webp", ".pdf" };

    /// <summary>
    /// Uploads the payment-proof image (or PDF) for the advance collected on
    /// this order. One file per order — a re-upload replaces whatever was
    /// there, matching how there is one advance to evidence, not several.
    /// </summary>
    [HttpPost("{orderId:int}/payment-proof")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<IActionResult> UploadPaymentProof(int orderId, IFormFile proof)
    {
        if (proof == null || proof.Length == 0)
            return BadRequest(new { error = "No file supplied" });

        var ext = Path.GetExtension(proof.FileName).ToLowerInvariant();
        if (!AllowedProofTypes.Contains(ext))
            return BadRequest(new { error = "Payment proof must be a JPG, PNG, WebP or PDF" });

        var fileName = $"{Guid.NewGuid():N}{ext}";
        var folder = UploadPaths.OrderPayment(orderId);
        var dir = UploadPaths.EnsureFolder(folder);

        await using (var stream = System.IO.File.Create(Path.Combine(dir, fileName)))
            await proof.CopyToAsync(stream);

        var relative = $"{folder}/{fileName}";

        try
        {
            await _orderService.SetPaymentProofPathAsync(orderId, relative);
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Order not found" });
        }

        return Ok(new { success = true, path = relative });
    }

    [HttpGet("{orderId:int}")]
    public async Task<IActionResult> GetOrder(int orderId)
    {
        var order = await _orderService.GetOrderAsync(orderId);
        if (order == null) return NotFound(new { error = "Order not found" });
        return Ok(order);
    }

    [HttpPost]
    public async Task<IActionResult> CreateOrder([FromBody] CreateOrderRequest request)
    {
        try
        {
            var orderId = await _orderService.CreateOrderAsync(request, CallerEmployeeId);
            var order = await _orderService.GetOrderAsync(orderId);
            return Ok(new { success = true, order_id = orderId, order });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPut("{orderId:int}")]
    public async Task<IActionResult> UpdateOrder(int orderId, [FromBody] UpdateOrderRequest request)
    {
        try
        {
            await _orderService.UpdateOrderAsync(orderId, request);
            return Ok(new { success = true, order = await _orderService.GetOrderAsync(orderId) });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        // Editing the lines of an order that is no longer a draft.
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Order not found" });
        }
    }

    [HttpDelete("{orderId:int}")]
    public async Task<IActionResult> DeleteOrder(int orderId)
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
            await _orderService.DeleteOrderAsync(orderId);
            return Ok(new { success = true });
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Order not found" });
        }
    }

    /// <summary>
    /// Confirms the order, renders the Sales Order PDF, and sends the WhatsApp
    /// confirmation. PDF and WhatsApp are best-effort: the order stays confirmed
    /// even if either fails, and the response reports what actually happened.
    /// </summary>
    [HttpPost("{orderId:int}/confirm")]
    public async Task<IActionResult> ConfirmOrder(int orderId)
    {
        try
        {
            await _orderService.ConfirmOrderAsync(orderId);
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { error = "Order not found or is cancelled" });
        }

        var order = await _orderService.GetOrderAsync(orderId);
        if (order == null) return NotFound(new { error = "Order not found" });

        string? pdfPath = null;
        string? pdfUrl  = null;
        string? pdfError = null;

        try
        {
            pdfPath = await _pdfService.GenerateAsync(order);
            await _orderService.SetSoPdfPathAsync(orderId, pdfPath);
            pdfUrl = BuildPublicUrl(pdfPath);
        }
        catch (Exception ex)
        {
            pdfError = ex.Message;
            _logger.LogError(ex, "Sales Order PDF generation failed for order {OrderId}", orderId);
        }

        var whatsApp = await _whatsApp.SendOrderConfirmationAsync(order, pdfUrl);

        return Ok(new
        {
            success  = true,
            order    = await _orderService.GetOrderAsync(orderId),
            so_pdf   = new { path = pdfPath, url = pdfUrl, error = pdfError },
            whatsapp = new
            {
                sent   = whatsApp.Sent,
                status = whatsApp.StatusCode,
                error  = whatsApp.Error,
            }
        });
    }

    /// <summary>
    /// Absolute URL for an uploaded file. Interakt fetches media by URL, so this
    /// must be publicly reachable — PublicBaseUrl should be the internet-facing
    /// backend origin, not localhost, in any environment that sends WhatsApp.
    /// </summary>
    private string BuildPublicUrl(string relativePath)
    {
        var configured = _config["PublicBaseUrl"];
        var origin = !string.IsNullOrWhiteSpace(configured)
            ? configured.TrimEnd('/')
            : $"{Request.Scheme}://{Request.Host}";
        return $"{origin}/uploads/{relativePath.TrimStart('/')}";
    }
}

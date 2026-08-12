using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

/// <summary>
/// Cross-lead view of WhatsApp delivery, and a way to resend from it.
///
/// LeadMediaController and OrdersController each fire the FIRST attempt at
/// their own touchpoint as part of a bigger action (uploading a photo,
/// confirming an order). This is the other half — finding everyone whose
/// latest attempt did not succeed, across every lead at once, and resending
/// without repeating whatever originally triggered it.
/// </summary>
[ApiController]
[Route("api/whatsapp")]
public class WhatsAppController : ControllerBase
{
    private readonly IWhatsAppService _whatsApp;
    private readonly ILeadService _leads;
    private readonly ILeadMediaService _media;
    private readonly IOrderService _orders;
    private readonly IConfiguration _config;

    public WhatsAppController(
        IWhatsAppService whatsApp,
        ILeadService leads,
        ILeadMediaService media,
        IOrderService orders,
        IConfiguration config)
    {
        _whatsApp = whatsApp;
        _leads = leads;
        _media = media;
        _orders = orders;
        _config = config;
    }

    /// <summary>Same rule as every other controller that hands Interakt a media URL.</summary>
    private string BuildPublicUrl(string relativePath)
    {
        var configured = _config["PublicBaseUrl"];
        var origin = !string.IsNullOrWhiteSpace(configured)
            ? configured.TrimEnd('/')
            : $"{Request.Scheme}://{Request.Host}";
        return $"{origin}/uploads/{relativePath.TrimStart('/')}";
    }

    [HttpGet("issues")]
    public async Task<IActionResult> GetIssues()
    {
        var issues = await _whatsApp.GetDeliveryIssuesAsync();
        return Ok(new { issues });
    }

    /// <summary>
    /// Resends one touchpoint for one lead (and order, for order_confirmation).
    /// Reuses each touchpoint's own normal send path rather than duplicating
    /// it here — welcome picks up whatever team photo exists right now (not
    /// necessarily the one at the time of the original, failed attempt),
    /// order_confirmation reuses the Sales Order already on file rather than
    /// regenerating it.
    /// </summary>
    [HttpPost("resend")]
    public async Task<IActionResult> Resend([FromBody] WhatsAppResendRequest request)
    {
        WhatsAppSendResult result;

        switch (request.Touchpoint)
        {
            case WhatsAppTouchpoints.Welcome:
            {
                var lead = await _leads.GetLeadByIdAsync(request.LeadId);
                if (lead == null) return NotFound(new { error = "Lead not found" });

                // Prefer an uploaded team photo — a Drive link cannot be
                // fetched by Interakt without the file being publicly shared.
                var photos = await _media.GetPhotosAsync(request.LeadId);
                var file = photos.FirstOrDefault(p => p.SourceType == "file" && p.FilePath != null);
                var photoUrl = file?.FilePath != null ? BuildPublicUrl(file.FilePath) : null;

                result = await _whatsApp.SendWelcomeAsync(
                    request.LeadId, lead.PrimaryVisitorName, lead.PrimaryVisitorPhone, photoUrl);
                break;
            }

            case WhatsAppTouchpoints.OrderConfirmation:
            {
                if (request.OrderId == null)
                    return BadRequest(new { error = "order_id is required to resend a confirmation" });

                var order = await _orders.GetOrderAsync(request.OrderId.Value);
                if (order == null) return NotFound(new { error = "Order not found" });
                if (order.StatusCode != "confirmed")
                    return BadRequest(new { error = "Only a confirmed order has a confirmation to resend" });

                var pdfUrl = order.SoPdfPath != null ? BuildPublicUrl(order.SoPdfPath) : null;
                result = await _whatsApp.SendOrderConfirmationAsync(order, pdfUrl);
                break;
            }

            case WhatsAppTouchpoints.ShowroomInvite:
            {
                var lead = await _leads.GetLeadByIdAsync(request.LeadId);
                if (lead == null) return NotFound(new { error = "Lead not found" });

                result = await _whatsApp.SendShowroomInviteAsync(
                    request.LeadId, lead.PrimaryVisitorName, lead.PrimaryVisitorPhone);
                break;
            }

            case WhatsAppTouchpoints.Testimonial:
            {
                var lead = await _leads.GetLeadByIdAsync(request.LeadId);
                if (lead == null) return NotFound(new { error = "Lead not found" });

                var media = await _media.GetMediaAsync(request.LeadId);
                if (string.IsNullOrWhiteSpace(media.TestimonialUrl))
                    return BadRequest(new { error = "No testimonial link on this lead to resend" });

                result = await _whatsApp.SendTestimonialAsync(
                    request.LeadId, lead.PrimaryVisitorName, lead.PrimaryVisitorPhone, media.TestimonialUrl);
                break;
            }

            default:
                return BadRequest(new { error = $"Cannot resend touchpoint '{request.Touchpoint}'" });
        }

        return Ok(new { sent = result.Sent, status = result.StatusCode, error = result.Error });
    }
}

public record WhatsAppResendRequest(int LeadId, int? OrderId, string Touchpoint);

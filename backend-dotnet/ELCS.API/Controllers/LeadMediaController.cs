using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;
using ELCS.API.Utils;
using ELCS.API.Data;
using Dapper;

namespace ELCS.API.Controllers;

/// <summary>
/// Team photos and testimonials for a lead.
/// Photos may be uploaded files or Drive links; testimonials are Drive links only.
/// </summary>
[ApiController]
[Route("api/leads")]
public class LeadMediaController : ControllerBase
{
    private readonly ILogger<LeadMediaController> _logger;
    private readonly ILeadMediaService _media;
    private readonly IWebHostEnvironment _env;
    private readonly ILeadService _leads;
    private readonly IWhatsAppService _whatsApp;
    private readonly IConfiguration _config;
    private readonly IDbConnection _db;

    private static readonly string[] AllowedImageTypes = { ".jpg", ".jpeg", ".png", ".webp" };

    public LeadMediaController(
        ILogger<LeadMediaController> logger,
        ILeadMediaService media,
        IWebHostEnvironment env,
        ILeadService leads,
        IWhatsAppService whatsApp,
        IConfiguration config,
        IDbConnection db)
    {
        _logger = logger;
        _media = media;
        _env = env;
        _leads = leads;
        _whatsApp = whatsApp;
        _config = config;
        _db = db;
    }

    /// <summary>
    /// Absolute URL for an uploaded file. Interakt fetches media by URL, so this
    /// must be publicly reachable when WhatsApp is in use.
    /// </summary>
    private string BuildPublicUrl(string relativePath)
    {
        var configured = _config["PublicBaseUrl"];
        var origin = !string.IsNullOrWhiteSpace(configured)
            ? configured.TrimEnd('/')
            : $"{Request.Scheme}://{Request.Host}";
        return $"{origin}/uploads/{relativePath.TrimStart('/')}";
    }

    private int? CallerEmployeeId =>
        Request.Headers.TryGetValue("X-Employee-Id", out var raw) && int.TryParse(raw, out var id)
            ? id : null;

    /// <summary>Everything visual attached to a lead: card images, team photos, testimonial.</summary>
    [HttpGet("{leadId:int}/media")]
    public async Task<IActionResult> GetMedia(int leadId)
    {
        try { return Ok(await _media.GetMediaAsync(leadId)); }
        catch (KeyNotFoundException) { return NotFound(new { error = "Lead not found" }); }
    }

    [HttpGet("{leadId:int}/photos")]
    public async Task<IActionResult> GetPhotos(int leadId)
        => Ok(new { photos = await _media.GetPhotosAsync(leadId) });

    /// <summary>Uploads a team photo. Multiple photos per lead are allowed.</summary>
    [HttpPost("{leadId:int}/photos")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<IActionResult> UploadPhoto(int leadId, IFormFile photo, [FromForm] string? caption)
    {
        if (photo == null || photo.Length == 0)
            return BadRequest(new { error = "No photo supplied" });

        var ext = Path.GetExtension(photo.FileName).ToLowerInvariant();
        if (!AllowedImageTypes.Contains(ext))
            return BadRequest(new { error = "Photo must be a JPG, PNG or WebP" });

        // GUID filename: /uploads is public so Interakt can fetch media by URL,
        // and a sequential name would make customers' photos enumerable.
        var fileName = $"{Guid.NewGuid():N}{ext}";
        var folder = UploadPaths.LeadTeam(leadId);
        var dir = UploadPaths.EnsureFolder(folder);

        await using (var stream = System.IO.File.Create(Path.Combine(dir, fileName)))
            await photo.CopyToAsync(stream);

        var relative = $"{folder}/{fileName}";

        try
        {
            // The guard is "has this customer already been sent their photo?",
            // not "is this the first photo". Retaking one — which happens
            // constantly at a stall — must not send the same message twice, and
            // WhatsApp has no undo. But a photo added after a FAILED send, or
            // after the earlier one was deleted, should still go out; counting
            // photos would have blocked that forever.
            using var conn = _db.CreateConnection();
            var alreadySent = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM WhatsAppMessages
                WHERE LeadId = @LeadId
                  AND Touchpoint = @Touchpoint
                  AND MediaUrl IS NOT NULL
                  AND StatusCode = 'sent'",
                new { LeadId = leadId, Touchpoint = WhatsAppTouchpoints.Welcome }) > 0;

            var id = await _media.AddPhotoFileAsync(leadId, relative, caption, CallerEmployeeId);

            var sent = false;
            string? sendError = null;

            if (!alreadySent)
            {
                // Best effort. The photo is already saved, and a messaging
                // failure must not turn a successful upload into an error.
                try
                {
                    var lead = await _leads.GetLeadByIdAsync(leadId);
                    if (lead != null)
                    {
                        // SendWelcomeAsync picks the meeting-photo template once
                        // a photo URL is supplied — see InteraktWhatsAppService.
                        var result = await _whatsApp.SendWelcomeAsync(
                            leadId, lead.PrimaryVisitorName, lead.PrimaryVisitorPhone,
                            BuildPublicUrl(relative));

                        sent = result.Sent;
                        sendError = result.Error;
                    }
                }
                catch (Exception ex)
                {
                    sendError = ex.Message;
                    _logger.LogError(ex, "Meeting-photo message failed for lead {LeadId}", leadId);
                }
            }

            return Ok(new
            {
                success = true,
                lead_photo_id = id,
                file_path = relative,
                whatsapp_sent = sent,
                whatsapp_error = sendError,
            });
        }
        catch (KeyNotFoundException) { return NotFound(new { error = "Lead not found" }); }
    }

    /// <summary>Attaches a team photo that lives on Drive rather than being uploaded.</summary>
    [HttpPost("{leadId:int}/photos/link")]
    public async Task<IActionResult> AddPhotoLink(int leadId, [FromBody] AddPhotoLinkRequest request)
    {
        try
        {
            var id = await _media.AddPhotoLinkAsync(leadId, request.Url, request.Caption, CallerEmployeeId);
            return Ok(new { success = true, lead_photo_id = id });
        }
        catch (ArgumentException ex)  { return BadRequest(new { error = ex.Message }); }
        catch (KeyNotFoundException)  { return NotFound(new { error = "Lead not found" }); }
    }

    [HttpDelete("photos/{leadPhotoId:int}")]
    public async Task<IActionResult> DeletePhoto(int leadPhotoId)
    {
        try
        {
            await _media.DeletePhotoAsync(leadPhotoId);
            return Ok(new { success = true });
        }
        catch (KeyNotFoundException) { return NotFound(new { error = "Photo not found" }); }
    }

    /// <summary>Sets or clears the lead's testimonial Drive link.</summary>
    [HttpPut("{leadId:int}/testimonial")]
    public async Task<IActionResult> SetTestimonial(int leadId, [FromBody] SetTestimonialRequest request)
    {
        try
        {
            await _media.SetTestimonialAsync(leadId, request.Url);
            return Ok(new { success = true, testimonial_url = request.Url });
        }
        catch (ArgumentException ex)  { return BadRequest(new { error = ex.Message }); }
        catch (KeyNotFoundException)  { return NotFound(new { error = "Lead not found" }); }
    }

    /// <summary>Touchpoint #1 — welcome. Also fired automatically on lead creation.</summary>
    [HttpPost("{leadId:int}/whatsapp/welcome")]
    public async Task<IActionResult> SendWelcome(int leadId)
    {
        var lead = await _leads.GetLeadByIdAsync(leadId);
        if (lead == null) return NotFound(new { error = "Lead not found" });

        // Prefer an uploaded team photo; a Drive link cannot be fetched by
        // Interakt without the file being publicly shared, so it is skipped.
        var photos = await _media.GetPhotosAsync(leadId);
        var file = photos.FirstOrDefault(p => p.SourceType == "file" && p.FilePath != null);
        var photoUrl = file?.FilePath != null ? BuildPublicUrl(file.FilePath) : null;

        var result = await _whatsApp.SendWelcomeAsync(
            leadId, lead.PrimaryVisitorName, lead.PrimaryVisitorPhone, photoUrl);

        return Ok(new { sent = result.Sent, status = result.StatusCode, error = result.Error });
    }

    /// <summary>Touchpoint #3 — testimonial video with a customised message.</summary>
    [HttpPost("{leadId:int}/whatsapp/testimonial")]
    public async Task<IActionResult> SendTestimonial(int leadId)
    {
        var lead = await _leads.GetLeadByIdAsync(leadId);
        if (lead == null) return NotFound(new { error = "Lead not found" });

        var media = await _media.GetMediaAsync(leadId);
        if (string.IsNullOrWhiteSpace(media.TestimonialUrl))
            return BadRequest(new { error = "Add a testimonial link first" });

        var result = await _whatsApp.SendTestimonialAsync(
            leadId, lead.PrimaryVisitorName, lead.PrimaryVisitorPhone, media.TestimonialUrl);

        return Ok(new { sent = result.Sent, status = result.StatusCode, error = result.Error });
    }

    /// <summary>
    /// Touchpoint #4 — showroom invitation, sent after the exhibition.
    ///
    /// Needs nothing but a phone number: no photo, no order, no testimonial. It
    /// goes to everyone who visited, whether or not they bought anything, which
    /// is the whole point of it.
    /// </summary>
    [HttpPost("{leadId:int}/whatsapp/showroom")]
    public async Task<IActionResult> SendShowroomInvite(int leadId)
    {
        var lead = await _leads.GetLeadByIdAsync(leadId);
        if (lead == null) return NotFound(new { error = "Lead not found" });

        var result = await _whatsApp.SendShowroomInviteAsync(
            leadId, lead.PrimaryVisitorName, lead.PrimaryVisitorPhone);

        return Ok(new { sent = result.Sent, status = result.StatusCode, error = result.Error });
    }
}

using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using ELCS.API.Data;

namespace ELCS.API.Services;

/// <summary>
/// Interakt WhatsApp Business API.
///
/// Interakt sends media by URL — it fetches the file itself — so the Sales
/// Order PDF must be publicly reachable. That is why generated PDFs carry a
/// GUID in the filename (see <see cref="SalesOrderPdfService"/>).
///
/// Sending is best-effort: if Interakt is unconfigured or the call fails, the
/// attempt is logged to WhatsAppMessages and the order still confirms. A
/// messaging outage must not block taking money at an exhibition counter.
/// </summary>
public class InteraktWhatsAppService : IWhatsAppService
{
    private readonly ILogger<InteraktWhatsAppService> _logger;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly IDbConnection _db;
    private readonly ILeadService _leads;


    public InteraktWhatsAppService(
        ILogger<InteraktWhatsAppService> logger,
        IHttpClientFactory httpFactory,
        IConfiguration config,
        IDbConnection db,
        ILeadService leads)
    {
        _logger = logger;
        _httpFactory = httpFactory;
        _config = config;
        _db = db;
        _leads = leads;
    }

    /// <summary>
    /// Every WhatsApp touchpoint. Template names come from appsettings.json —
    /// see Template() below for why they are not editable at runtime.
    /// </summary>
    /// <summary>
    /// The approved template name, from configuration.
    ///
    /// Read only from appsettings, deliberately. These change when Meta approves
    /// a new template — rarely, and never during an exhibition — so a database
    /// row editable from a Settings screen bought nothing but a second place for
    /// the name to be wrong, and an allow-list that silently dropped whichever
    /// key was missing from it.
    /// </summary>
    private string? Template(string configKey) => _config[configKey];


    public async Task<WhatsAppSendResult> SendWelcomeAsync(
        int leadId, string? name, string? phone, string? photoUrl)
    {
        // Two templates, chosen by whether there is a photograph to attach.
        //
        // A WhatsApp template's header is fixed at approval: one declaring an
        // IMAGE header fails outright when no media is supplied. The welcome
        // fires from two places — self-registration at the QR, where there is
        // no photo, and the lead screen after the team photo is taken — so a
        // single template could only ever serve one of them.
        //
        // With a photo it sends the meeting-photo template, which carries the
        // picture in its header; without one, the plain welcome. Both take the
        // lead's name as their only body variable.
        var hasPhoto = !string.IsNullOrWhiteSpace(photoUrl);
        var templateName = hasPhoto
            ? Template("Interakt:Templates:MeetingPhoto")
            : Template("Interakt:Templates:Welcome");
        // tejoo_meeting_photo is approved under a second WhatsApp number, so it
        // sends on that account's key; the plain welcome stays on the main one.
        var apiKey = hasPhoto ? _config["Interakt:AlternateApiKey"] : _config["Interakt:ApiKey"];
        var baseUrl = _config["Interakt:BaseUrl"] ?? "https://api.interakt.ai/v1/public/message/";
        var languageCode = _config["Interakt:LanguageCode"] ?? "en";
        var countryCode  = _config["Interakt:DefaultCountryCode"] ?? "+91";

        var target = NormalisePhone(phone, countryCode);
        WhatsAppSendResult result;

        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(templateName))
            result = WhatsAppSendResult.Skipped(
                hasPhoto ? "Meeting-photo template is not configured"
                         : "Welcome template is not configured");
        else if (target == null)
            result = WhatsAppSendResult.Skipped("Lead has no usable phone number");
        else
        {
            // Off by default — see appsettings.json comment. The template
            // must actually have a second {{2}} body placeholder approved by
            // Meta before a second value can be sent — one short here and
            // Meta rejects the whole message. Split per template rather than
            // one flag for both: Welcome and MeetingPhoto get edited and
            // approved by Meta on their own separate timelines, so a single
            // flag would fix one the moment it flipped true while instantly
            // breaking whichever template had not been approved yet.
            var linkFlagKey = hasPhoto
                ? "Interakt:WelcomeLinkReady:MeetingPhoto"
                : "Interakt:WelcomeLinkReady:Welcome";
            var bodyValues = new List<string> { name ?? "there" };
            if (_config.GetValue<bool>(linkFlagKey))
            {
                var frontendUrl = _config["Frontend:PublicBaseUrl"];
                if (!string.IsNullOrWhiteSpace(frontendUrl))
                {
                    // Get-or-create: never rotates an already-issued link, so a
                    // QR already printed or shared for this lead keeps working.
                    var token = await _leads.SetLeadPublicTokenAsync(leadId, rotate: false);
                    bodyValues.Add($"{frontendUrl.TrimEnd('/')}/o/{token}");
                }
            }

            result = await SendTemplateAsync(
                apiKey, baseUrl, templateName, languageCode,
                target.Value.CountryCode, target.Value.Number,
                headerMediaUrl: photoUrl,
                // Count here must match the template's approved body
                // placeholders exactly or Meta rejects every send.
                bodyValues: bodyValues.ToArray(),
                fileName: null);
        }

        await LogAsync(leadId, null, WhatsAppTouchpoints.Welcome,
            RecipientForLog(target, phone), templateName, photoUrl, result);

        return result;
    }

    /// <summary>
    /// Touchpoint #4 — the showroom invitation.
    ///
    /// No header and one body variable, matching tejoo_showroom_invite. Sent by
    /// hand rather than on a trigger: it is meant to follow the exhibition, and
    /// only a person knows when that is. Approved under, and sent from, the
    /// second WhatsApp number — same as tejoo_meeting_photo.
    /// </summary>
    public async Task<WhatsAppSendResult> SendShowroomInviteAsync(int leadId, string? name, string? phone)
    {
        var apiKey       = _config["Interakt:AlternateApiKey"];
        var baseUrl      = _config["Interakt:BaseUrl"] ?? "https://api.interakt.ai/v1/public/message/";
        var templateName = Template("Interakt:Templates:ShowroomInvite");
        var languageCode = _config["Interakt:LanguageCode"] ?? "en";
        var countryCode  = _config["Interakt:DefaultCountryCode"] ?? "+91";

        var target = NormalisePhone(phone, countryCode);
        WhatsAppSendResult result;

        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(templateName))
            result = WhatsAppSendResult.Skipped("Showroom-invite template is not configured");
        else if (target == null)
            result = WhatsAppSendResult.Skipped("Lead has no usable phone number");
        else
            result = await SendTemplateAsync(
                apiKey, baseUrl, templateName, languageCode,
                target.Value.CountryCode, target.Value.Number,
                headerMediaUrl: null,
                bodyValues: new[] { name ?? "there" },
                fileName: null);

        await LogAsync(leadId, null, WhatsAppTouchpoints.ShowroomInvite,
            RecipientForLog(target, phone), templateName, null, result);

        return result;
    }

    public async Task<WhatsAppSendResult> SendTestimonialAsync(
        int leadId, string? name, string? phone, string testimonialUrl)
    {
        var apiKey       = _config["Interakt:ApiKey"];
        var baseUrl      = _config["Interakt:BaseUrl"] ?? "https://api.interakt.ai/v1/public/message/";
        var templateName = Template("Interakt:Templates:Testimonial");
        var languageCode = _config["Interakt:LanguageCode"] ?? "en";
        var countryCode  = _config["Interakt:DefaultCountryCode"] ?? "+91";

        var target = NormalisePhone(phone, countryCode);
        WhatsAppSendResult result;

        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(templateName))
            result = WhatsAppSendResult.Skipped("Testimonial template is not configured");
        else if (target == null)
            result = WhatsAppSendResult.Skipped("Lead has no usable phone number");
        else
            result = await SendTemplateAsync(
                apiKey, baseUrl, templateName, languageCode,
                target.Value.CountryCode, target.Value.Number,
                headerMediaUrl: null,
                bodyValues: new[] { name ?? "there", testimonialUrl },
                fileName: null);

        await LogAsync(leadId, null, WhatsAppTouchpoints.Testimonial,
            RecipientForLog(target, phone), templateName, testimonialUrl, result);

        return result;
    }

    public async Task<WhatsAppSendResult> SendOrderConfirmationAsync(OrderDetailDto order, string? soPdfUrl)
    {
        var apiKey       = _config["Interakt:ApiKey"];
        var baseUrl      = _config["Interakt:BaseUrl"] ?? "https://api.interakt.ai/v1/public/message/";
        var templateName = Template("Interakt:Templates:OrderConfirmation");
        var languageCode = _config["Interakt:LanguageCode"] ?? "en";
        var countryCode  = _config["Interakt:DefaultCountryCode"] ?? "+91";

        var phone = NormalisePhone(order.LeadPhone, countryCode);

        WhatsAppSendResult result;

        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(templateName))
        {
            result = WhatsAppSendResult.Skipped("Interakt is not configured (ApiKey / template name missing)");
            _logger.LogWarning("WhatsApp order confirmation skipped for order {OrderNumber}: not configured",
                order.OrderNumber);
        }
        else if (phone == null)
        {
            result = WhatsAppSendResult.Skipped("Lead has no usable phone number");
            _logger.LogWarning("WhatsApp order confirmation skipped for order {OrderNumber}: no phone",
                order.OrderNumber);
        }
        else
        {
            result = await SendTemplateAsync(
                apiKey, baseUrl, templateName, languageCode,
                phone.Value.CountryCode, phone.Value.Number,
                headerMediaUrl: soPdfUrl,
                // No body variables: the approved template is fixed copy and
                // carries no placeholders. The figures live in the attached
                // Sales Order instead, and the count sent here must match the
                // template exactly or Meta rejects every send.
                bodyValues: Array.Empty<string>(),
                fileName: $"{order.OrderNumber}.pdf");
        }

        await LogAsync(order.LeadId, order.OrderId, WhatsAppTouchpoints.OrderConfirmation,
            RecipientForLog(phone, order.LeadPhone), templateName, soPdfUrl, result);

        return result;
    }

    private async Task<WhatsAppSendResult> SendTemplateAsync(
        string apiKey, string baseUrl, string templateName, string languageCode,
        string countryCode, string number,
        string? headerMediaUrl, string[] bodyValues, string? fileName,
        string[]? buttonValues = null)
    {
        try
        {
            var template = new Dictionary<string, object?>
            {
                ["name"]         = templateName,
                ["languageCode"] = languageCode,
                ["bodyValues"]   = bodyValues,
            };

            if (!string.IsNullOrWhiteSpace(headerMediaUrl))
            {
                template["headerValues"] = new[] { headerMediaUrl };
                if (!string.IsNullOrWhiteSpace(fileName))
                    template["fileName"] = fileName;
            }

            if (buttonValues is { Length: > 0 })
                template["buttonValues"] = new Dictionary<string, object?> { ["0"] = buttonValues };

            var payload = new Dictionary<string, object?>
            {
                ["countryCode"] = countryCode,
                ["phoneNumber"] = number,
                ["type"]        = "Template",
                ["template"]    = template,
            };

            var client = _httpFactory.CreateClient(nameof(InteraktWhatsAppService));
            client.Timeout = TimeSpan.FromSeconds(20);

            using var request = new HttpRequestMessage(HttpMethod.Post, baseUrl)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", apiKey);

            using var response = await client.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Interakt send failed ({Status}): {Body}", (int)response.StatusCode, body);
                return WhatsAppSendResult.Failed($"HTTP {(int)response.StatusCode}: {Truncate(body, 400)}");
            }

            string? messageId = null;
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("id", out var idProp))
                    messageId = idProp.GetString();
                else if (doc.RootElement.TryGetProperty("message_id", out var midProp))
                    messageId = midProp.GetString();
            }
            catch (JsonException) { /* provider returned non-JSON on success — not fatal */ }

            _logger.LogInformation("Interakt template '{Template}' sent to {Country}{Number}",
                templateName, countryCode, number);
            return WhatsAppSendResult.Success(messageId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Interakt send threw");
            return WhatsAppSendResult.Failed(ex.Message);
        }
    }

    public async Task<List<WhatsAppIssueDto>> GetDeliveryIssuesAsync()
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync<WhatsAppIssueDto>(@"
            ;WITH Latest AS (
                SELECT *,
                       ROW_NUMBER() OVER (
                           PARTITION BY LeadId, ISNULL(OrderId, 0), Touchpoint
                           ORDER BY CreatedAt DESC
                       ) AS rn
                FROM WhatsAppMessages
            )
            SELECT
                w.LeadId, l.PrimaryVisitorName AS LeadName, l.CompanyName,
                w.OrderId, o.OrderNumber,
                w.Touchpoint, w.Recipient, w.StatusCode, w.ErrorMessage, w.CreatedAt,
                l.PrimaryVisitorPhone AS LeadCurrentPhone
            FROM Latest w
            JOIN Leads l ON l.LeadId = w.LeadId
            LEFT JOIN Orders o ON o.OrderId = w.OrderId
            WHERE w.rn = 1 AND w.StatusCode NOT IN ('sent', 'delivered', 'read')
            ORDER BY w.CreatedAt DESC");

        return rows.ToList();
    }

    public async Task<List<WhatsAppMessageDto>> GetLeadMessageHistoryAsync(int leadId)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync<WhatsAppMessageDto>(@"
            SELECT w.OrderId, o.OrderNumber, w.Touchpoint, w.Recipient, w.StatusCode, w.ErrorMessage, w.CreatedAt
            FROM WhatsAppMessages w
            LEFT JOIN Orders o ON o.OrderId = w.OrderId
            WHERE w.LeadId = @LeadId
            ORDER BY w.CreatedAt DESC",
            new { LeadId = leadId });

        return rows.ToList();
    }

    private async Task LogAsync(
        int leadId, int? orderId, string touchpoint, string? recipient,
        string? templateName, string? mediaUrl, WhatsAppSendResult result)
    {
        try
        {
            using var conn = _db.CreateConnection();
            await conn.ExecuteAsync(@"
                INSERT INTO WhatsAppMessages
                    (LeadId, OrderId, Touchpoint, Recipient, TemplateName, MediaUrl,
                     StatusCode, ProviderMessageId, ErrorMessage, CreatedAt)
                VALUES
                    (@LeadId, @OrderId, @Touchpoint, @Recipient, @TemplateName, @MediaUrl,
                     @StatusCode, @ProviderMessageId, @ErrorMessage, GETUTCDATE())",
                new
                {
                    LeadId = leadId,
                    OrderId = orderId,
                    Touchpoint = touchpoint,
                    Recipient = recipient,
                    TemplateName = templateName,
                    MediaUrl = mediaUrl,
                    result.StatusCode,
                    result.ProviderMessageId,
                    ErrorMessage = result.Error,
                });
        }
        catch (Exception ex)
        {
            // Never let logging failure break the caller.
            _logger.LogError(ex, "Failed to log WhatsApp attempt for lead {LeadId}", leadId);
        }
    }

    /// <summary>
    /// Splits a stored phone number into Interakt's countryCode + phoneNumber pair.
    /// Indian numbers are stored inconsistently across the app (with +91, with a
    /// leading 0, or bare 10 digits), so normalise rather than trust the field.
    /// </summary>
    /// <summary>
    /// ITU-T E.164 calling codes for the countries visitors actually come
    /// from — the Gulf, UK/Europe, North America and South-East Asia, on top
    /// of India. Not the full ~240-entry table: an exhibition lead from a
    /// country missing here still falls back to being treated as unusable,
    /// same as before this list existed, so a gap here is a missed
    /// improvement, not a regression.
    ///
    /// Checked longest-prefix-first (3 digits, then 2, then 1) — "91" (India)
    /// and "971" (UAE) both start with "9", so matching the single digit
    /// first would misread a UAE number as a malformed Indian one.
    /// </summary>
    private static readonly string[] CallingCodes3 =
        { "971", "972", "966", "968", "973", "974", "965", "962", "852", "886", "961", "960" };
    private static readonly string[] CallingCodes2 =
        { "91", "44", "49", "33", "39", "34", "31", "32", "41", "43", "46", "47", "45", "48",
          "86", "81", "82", "65", "60", "62", "63", "66", "84", "20", "27", "61", "64" };
    // 1-digit: "1" (US/Canada), "7" (Russia/Kazakhstan) — the only two ITU
    // reserves whole. Every other single leading digit is shared across many
    // 2- or 3-digit codes, so treating it as complete here would misparse.
    private static readonly string[] CallingCodes1 = { "1", "7" };

    /// <summary>
    /// What to log as the recipient: the clean E.164 form when normalisation
    /// succeeded, otherwise the raw value that was actually on file — never
    /// silently null when a phone existed but was just malformed. Distinguishes
    /// "this lead genuinely has no phone" from "this lead has a phone, it's
    /// wrong" for the Delivery page, which offers a different fix for each.
    /// </summary>
    private static string? RecipientForLog((string CountryCode, string Number, string Full)? target, string? raw) =>
        target?.Full ?? (string.IsNullOrWhiteSpace(raw) ? null : raw);

    private static (string CountryCode, string Number, string Full)? NormalisePhone(
        string? raw, string defaultCountryCode)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var hasPlus = raw.TrimStart().StartsWith('+');
        var digits = new string(raw.Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return null;

        // Explicitly international — the visitor's own number already carries
        // a country code (typed with a leading "+"), so it is split on a real
        // calling code and sent as-is rather than forced through the
        // India-only assumption below, which used to reject every one of
        // these outright as "no usable phone number".
        if (hasPlus && digits.Length is >= 8 and <= 15 && !digits.StartsWith("91"))
        {
            var code =
                CallingCodes3.FirstOrDefault(c => digits.StartsWith(c)) ??
                CallingCodes2.FirstOrDefault(c => digits.StartsWith(c)) ??
                CallingCodes1.FirstOrDefault(c => digits.StartsWith(c));

            if (code != null && digits.Length > code.Length)
            {
                var local = digits[code.Length..];
                return ("+" + code, local, "+" + digits);
            }
            // Not a calling code this list knows — falls through to the
            // India-only path below, which will reject it exactly as before.
        }

        if (digits.Length == 12 && digits.StartsWith("91"))
            digits = digits[2..];
        else if (digits.Length == 11 && digits.StartsWith("0"))
            digits = digits[1..];

        if (digits.Length != 10) return null;   // not a number we can trust

        var cc = defaultCountryCode.StartsWith('+') ? defaultCountryCode : "+" + defaultCountryCode;
        return (cc, digits, cc + digits);
    }


    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";
}

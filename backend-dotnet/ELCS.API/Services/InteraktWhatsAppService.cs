using System.Globalization;
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

    private static readonly CultureInfo Inr = CultureInfo.GetCultureInfo("en-IN");

    public InteraktWhatsAppService(
        ILogger<InteraktWhatsAppService> logger,
        IHttpClientFactory httpFactory,
        IConfiguration config,
        IDbConnection db)
    {
        _logger = logger;
        _httpFactory = httpFactory;
        _config = config;
        _db = db;
    }

    public async Task<WhatsAppSendResult> SendOrderConfirmationAsync(OrderDetailDto order, string? soPdfUrl)
    {
        var apiKey       = _config["Interakt:ApiKey"];
        var baseUrl      = _config["Interakt:BaseUrl"] ?? "https://api.interakt.ai/v1/public/message/";
        var templateName = _config["Interakt:Templates:OrderConfirmation"];
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
                bodyValues: new[]
                {
                    order.LeadName ?? "Customer",
                    order.OrderNumber,
                    Money(order.LeadSummary.LeadTotal),
                    Money(order.LeadSummary.TotalAdvance),
                    Money(order.LeadSummary.Balance),
                },
                fileName: $"{order.OrderNumber}.pdf");
        }

        await LogAsync(order.LeadId, order.OrderId, WhatsAppTouchpoints.OrderConfirmation,
            phone?.Full, templateName, soPdfUrl, result);

        return result;
    }

    public async Task<WhatsAppSendResult> SendOtpAsync(string mobile10, string code, int expiryMinutes)
    {
        var apiKey       = _config["Interakt:ApiKey"];
        var baseUrl      = _config["Interakt:BaseUrl"] ?? "https://api.interakt.ai/v1/public/message/";
        var templateName = _config["Interakt:Templates:Otp"];
        var languageCode = _config["Interakt:LanguageCode"] ?? "en";
        var countryCode  = _config["Interakt:DefaultCountryCode"] ?? "+91";

        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(templateName))
            return WhatsAppSendResult.Skipped("Interakt OTP template is not configured");

        var cc = countryCode.StartsWith('+') ? countryCode : "+" + countryCode;

        // Deliberately NOT written to WhatsAppMessages: that table is keyed to a
        // lead by foreign key and an OTP is sent before any lead is known. The
        // attempt is already recorded in OtpChallenges, and logging it twice
        // would mean storing the customer's number in a second place.
        return await SendTemplateAsync(
            apiKey, baseUrl, templateName, languageCode, cc, mobile10,
            headerMediaUrl: null,
            bodyValues: new[] { code, expiryMinutes.ToString() },
            fileName: null,
            buttonValues: new[] { code });   // WhatsApp copy-code button, when the template has one
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
    private static (string CountryCode, string Number, string Full)? NormalisePhone(
        string? raw, string defaultCountryCode)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var digits = new string(raw.Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return null;

        if (digits.Length == 12 && digits.StartsWith("91"))
            digits = digits[2..];
        else if (digits.Length == 11 && digits.StartsWith("0"))
            digits = digits[1..];

        if (digits.Length != 10) return null;   // not a number we can trust

        var cc = defaultCountryCode.StartsWith('+') ? defaultCountryCode : "+" + defaultCountryCode;
        return (cc, digits, cc + digits);
    }

    private static string Money(decimal value) => "₹" + value.ToString("N2", Inr);

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";
}

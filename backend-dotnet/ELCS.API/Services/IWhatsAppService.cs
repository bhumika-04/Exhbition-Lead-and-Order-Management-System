namespace ELCS.API.Services;

/// <summary>
/// Outbound WhatsApp for the three touchpoints in the lead lifecycle.
/// Only order confirmation is implemented so far; welcome and testimonial
/// are declared here because the provider, log table and media-URL plumbing
/// are shared, so adding them is a template name and a call site.
/// </summary>
public interface IWhatsAppService
{
    /// <summary>Touchpoint #2 — order confirmation with the Sales Order PDF attached.</summary>
    Task<WhatsAppSendResult> SendOrderConfirmationAsync(OrderDetailDto order, string? soPdfUrl);

    /// <summary>
    /// Verification code for the public self-service ordering page. Uses an
    /// Interakt authentication template, which is a separate approval from the
    /// marketing templates the other touchpoints use.
    /// </summary>
    Task<WhatsAppSendResult> SendOtpAsync(string mobile10, string code, int expiryMinutes);
}

public static class WhatsAppTouchpoints
{
    public const string Welcome           = "welcome";
    public const string OrderConfirmation = "order_confirmation";
    public const string Testimonial       = "testimonial";
    public const string Otp               = "otp";
}

public record WhatsAppSendResult(
    bool Sent,
    string StatusCode,          // sent | failed | skipped
    string? ProviderMessageId,
    string? Error
)
{
    public static WhatsAppSendResult Skipped(string reason) =>
        new(false, "skipped", null, reason);

    public static WhatsAppSendResult Failed(string error) =>
        new(false, "failed", null, error);

    public static WhatsAppSendResult Success(string? providerMessageId) =>
        new(true, "sent", providerMessageId, null);
}

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
    /// Touchpoint #1 — welcome, sent automatically when a lead is created.
    /// Carries the lead's team photo when one exists, plus the social links
    /// configured in Settings.
    /// </summary>
    Task<WhatsAppSendResult> SendWelcomeAsync(int leadId, string? name, string? phone, string? photoUrl);

    /// <summary>Touchpoint #3 — testimonial, sent manually from the lead page.</summary>
    Task<WhatsAppSendResult> SendTestimonialAsync(int leadId, string? name, string? phone, string testimonialUrl);

    /// <summary>
    /// Touchpoint #4 — invites the visitor to the Chandni Chowk showroom once
    /// the exhibition is over. Sent to everyone, whether or not they ordered.
    /// </summary>
    Task<WhatsAppSendResult> SendShowroomInviteAsync(int leadId, string? name, string? phone);
}

public static class WhatsAppTouchpoints
{
    public const string Welcome           = "welcome";
    public const string OrderConfirmation = "order_confirmation";
    public const string Testimonial       = "testimonial";
    public const string ShowroomInvite    = "showroom_invite";
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

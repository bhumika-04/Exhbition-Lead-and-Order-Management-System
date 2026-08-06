namespace ELCS.API.Services;

/// <summary>
/// Runtime settings held in the database rather than appsettings.json.
///
/// Interakt template names must be approved by Meta before they can send, and
/// an approved name can change without a code release — so they live here,
/// editable from the Settings screen, not in a config file that needs a deploy.
/// </summary>
public interface ISettingsService
{
    Task<Dictionary<string, string?>> GetAllAsync();
    Task<string?> GetAsync(string key);
    Task SaveAsync(Dictionary<string, string?> values);
}

public static class SettingKeys
{
    public const string TemplateWelcome           = "whatsapp.template.welcome";
    public const string TemplateOrderConfirmation = "whatsapp.template.order_confirmation";
    public const string TemplateTestimonial       = "whatsapp.template.testimonial";
    public const string TemplateOtp               = "whatsapp.template.otp";
    public const string WelcomeAutoSend           = "whatsapp.welcome.auto_send";

    public const string SocialInstagram = "social.instagram";
    public const string SocialFacebook  = "social.facebook";
    public const string SocialWebsite   = "social.website";
    public const string SocialYoutube   = "social.youtube";

    /// <summary>Only these keys may be written — the table is not a free-form store.</summary>
    public static readonly HashSet<string> Writable = new()
    {
        TemplateWelcome, TemplateOrderConfirmation, TemplateTestimonial, TemplateOtp,
        WelcomeAutoSend,
        SocialInstagram, SocialFacebook, SocialWebsite, SocialYoutube,
    };
}

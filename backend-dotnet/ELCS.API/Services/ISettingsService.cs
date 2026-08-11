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
    /// <summary>Sent instead of Welcome when the lead has a team photo to attach.</summary>
    /// <summary>Invitation to the Chandni Chowk showroom, sent after the exhibition.</summary>

    /// <summary>
    /// "true" makes the public ordering page verify the mobile by WhatsApp OTP
    /// before showing anything. Defaults to false: at a booth the QR is physical
    /// and staff are present, and requiring OTP means an approved Meta
    /// authentication template — which would otherwise block ordering entirely.
    /// </summary>

    public const string SocialInstagram = "social.instagram";
    public const string SocialFacebook  = "social.facebook";
    public const string SocialWebsite   = "social.website";
    public const string SocialYoutube   = "social.youtube";

    /// <summary>Only these keys may be written — the table is not a free-form store.</summary>
    public static readonly HashSet<string> Writable = new()
    {
        SocialInstagram, SocialFacebook, SocialWebsite, SocialYoutube,
    };
}

using System.Text.RegularExpressions;

namespace ELCS.API.Utils;

/// <summary>
/// Phone number validation — the server-side half of the check.
/// Frontend validation (lib/phone.ts) keeps typos out of the UI; this exists
/// because the API is reachable directly, and client-side validation alone
/// is not validation.
///
/// India is the default and the only format accepted bare (10 digits, no
/// country code) — every other country must be typed with an explicit
/// leading '+', and is returned as "+&lt;digits&gt;" so
/// InteraktWhatsAppService.NormalisePhone (which splits on the same calling
/// codes at send time) can route it correctly.
/// </summary>
public static class PhoneValidator
{
    /// <summary>
    /// Accepts a bare 10-digit Indian mobile number (with or without a
    /// +91/91 prefix), returning the canonical bare 10-digit form; or an
    /// explicitly international number ("+" plus 8-15 digits), returned as
    /// "+&lt;digits&gt;". Null if neither shape matches.
    /// </summary>
    public static string? Normalise(string raw)
    {
        var hasPlus = raw.TrimStart().StartsWith('+');
        var digits = Regex.Replace(raw, @"\D", "");

        var ten = digits;
        if (digits.Length == 12 && digits.StartsWith("91"))
            ten = digits[2..];

        if (ten.Length == 10 && ten[0] >= '6' && ten[0] <= '9')
            return ten;

        if (hasPlus && digits.Length is >= 8 and <= 15 && !digits.StartsWith("91"))
            return "+" + digits;

        return null;
    }

    public static bool IsValid(string raw) => Normalise(raw) != null;
}

using System.Text.RegularExpressions;

namespace ELCS.API.Utils;

/// <summary>
/// Indian mobile number validation — the server-side half of the check.
/// Frontend validation (lib/phone.ts) keeps typos out of the UI; this exists
/// because the API is reachable directly, and client-side validation alone
/// is not validation.
/// </summary>
public static class PhoneValidator
{
    /// <summary>
    /// Accepts a bare 10-digit mobile number, or one prefixed with the
    /// +91/91 country code. Returns the canonical bare 10-digit form, or
    /// null if the input isn't a valid Indian mobile number.
    /// </summary>
    public static string? Normalise(string raw)
    {
        var digits = Regex.Replace(raw, @"\D", "");

        var ten = digits;
        if (digits.Length == 12 && digits.StartsWith("91"))
            ten = digits[2..];

        if (ten.Length != 10) return null;
        if (ten[0] < '6' || ten[0] > '9') return null;

        return ten;
    }

    public static bool IsValid(string raw) => Normalise(raw) != null;
}

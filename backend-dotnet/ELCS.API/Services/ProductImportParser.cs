using System.Text.RegularExpressions;

namespace ELCS.API.Services;

/// <summary>
/// Reads the supplier's catalogue sheet into products.
///
/// Sheet shape: BARCODE | COLOUR | WSP | SIZE | PRODUCT IMAGE LINK
///
/// The notation that matters is the brackets. A bracketed list is a SET the
/// customer must buy whole, not a list of choices:
///
///   COLOUR "(Grey,Mouse)"      -> the two colours ship together: 2 pcs per size
///   SIZE   "(M,L,XL,2XL)"      -> the four sizes ship together: 4 pcs per colour
///   COLOUR "Grey,Mouse"        -> a choice of two colours, no minimum
///   SIZE   "FREE SIZE"         -> a single size, no minimum
///
/// When BOTH axes are bracketed the minimums multiply — the customer takes
/// every colour in every size.
/// </summary>
public static class ProductImportParser
{
    /// <summary>One axis of a product: its values, and whether they form a set.</summary>
    public record Axis(List<string> Values, bool IsSet);

    private static readonly Regex Bracketed = new(@"^\s*\((?<inner>.*)\)\s*$", RegexOptions.Compiled);

    /// <summary>
    /// Splits a cell into values and detects the bracket notation.
    ///
    /// Only OUTER brackets wrapping the whole cell mark a set. "Grey (dark)" is a
    /// colour whose name happens to contain brackets, not a set of one.
    /// </summary>
    public static Axis ParseAxis(string? raw)
    {
        var text = (raw ?? string.Empty).Trim();
        if (text.Length == 0) return new Axis(new List<string>(), false);

        var m = Bracketed.Match(text);
        var isSet = m.Success;
        if (isSet) text = m.Groups["inner"].Value;

        var values = text
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(v => v.Trim())
            .Where(v => v.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        // "(Grey)" is a set of one, which is the same as no set at all. Treating
        // it as a set would impose a meaningless minimum of 1.
        if (values.Count <= 1) isSet = false;

        return new Axis(values, isSet);
    }

    /// <summary>
    /// Pieces the customer must take. Each bracketed axis contributes its own
    /// count and the two multiply, so (Grey,Mouse) x (M,L,XL) is 6 — every
    /// colour in every size. An axis that is not a set contributes 1.
    /// </summary>
    public static int MinimumPieces(Axis colour, Axis size)
    {
        var c = colour.IsSet ? Math.Max(1, colour.Values.Count) : 1;
        var s = size.IsSet   ? Math.Max(1, size.Values.Count)   : 1;
        return c * s;
    }

    private static readonly Regex DriveId = new(
        @"(?:/file/d/|[?&]id=|/d/)(?<id>[A-Za-z0-9_-]{10,})", RegexOptions.Compiled);

    /// <summary>
    /// Rewrites a Google Drive share link into one an &lt;img&gt; can actually load.
    ///
    /// A ".../file/d/ID/view" URL serves an HTML viewer page, not an image, so
    /// storing it verbatim guarantees a broken thumbnail everywhere. Anything
    /// that is not a recognisable Drive link is returned untouched — it may
    /// already be a direct image URL.
    /// </summary>
    public static string? NormaliseImageUrl(string? raw)
    {
        var url = (raw ?? string.Empty).Trim();
        if (url.Length == 0) return null;
        if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return null;

        if (!url.Contains("drive.google.com", StringComparison.OrdinalIgnoreCase)) return url;

        var m = DriveId.Match(url);
        return m.Success
            ? $"https://drive.google.com/uc?export=view&id={m.Groups["id"].Value}"
            : url;
    }

    /// <summary>
    /// Price from the WSP column. Tolerates "6295", "6,295", "₹6295" and
    /// "6295.00"; returns null when there is no number to read, so the caller
    /// can reject the row rather than import it at zero.
    /// </summary>
    public static decimal? ParsePrice(string? raw)
    {
        var text = new string((raw ?? string.Empty).Where(c => char.IsDigit(c) || c == '.').ToArray());
        return decimal.TryParse(text, out var value) && value >= 0 ? value : null;
    }
}

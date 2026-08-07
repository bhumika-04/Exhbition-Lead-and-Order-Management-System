namespace ELCS.API.Utils;

/// <summary>
/// Single source of truth for the uploads layout.
///
/// Everything belonging to a lead lives under one folder, so a lead's media can
/// be found, archived or deleted in one place:
///
///   uploads/
///     leads/{leadId}/
///       card/     front.jpg, back.jpg      visiting card
///       team/     {guid}.jpg               photos with the team
///       orders/   {orderNo}-{guid}.pdf     sales orders
///     products/{productId}/{guid}.jpg
///     temp/cards/{tempId}/                 scanned but not yet confirmed
///
/// Paths returned here are RELATIVE to the uploads root and use forward
/// slashes, because that is what gets stored in the database and appended to a
/// public URL. Storing an absolute path — as the card pipeline previously did —
/// breaks the moment the app moves machine or directory.
/// </summary>
public static class UploadPaths
{
    public const string RootFolder = "uploads";

    public static string LeadCard(int leadId)    => $"leads/{leadId}/card";
    public static string LeadTeam(int leadId)    => $"leads/{leadId}/team";
    public static string LeadOrders(int leadId)  => $"leads/{leadId}/orders";
    public static string Product(int productId)  => $"products/{productId}";

    /// <summary>Scanned images held before the lead exists, moved on confirm.</summary>
    public static string TempCard(string tempId) => $"temp/cards/{tempId}";

    /// <summary>Absolute location on disk for a relative upload path.</summary>
    public static string Absolute(string contentRootPath, string relative) =>
        Path.Combine(contentRootPath, RootFolder,
            relative.Replace('/', Path.DirectorySeparatorChar));

    /// <summary>Creates the folder for a relative path and returns its absolute location.</summary>
    public static string EnsureFolder(string contentRootPath, string relativeFolder)
    {
        var absolute = Absolute(contentRootPath, relativeFolder);
        Directory.CreateDirectory(absolute);
        return absolute;
    }

    /// <summary>
    /// Reduces any stored value to a path relative to the uploads root.
    ///
    /// Tolerates the three forms already in the database: a proper relative
    /// path, a Windows absolute path from whichever machine wrote it, and a
    /// mixture of slash styles. Anything after the last "uploads" segment wins.
    /// </summary>
    public static string? ToRelative(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return null;

        var normalised = stored.Replace('\\', '/').Trim();
        const string marker = "/" + RootFolder + "/";

        var idx = normalised.LastIndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (idx >= 0)
            normalised = normalised[(idx + marker.Length)..];
        else if (normalised.StartsWith(RootFolder + "/", StringComparison.OrdinalIgnoreCase))
            normalised = normalised[(RootFolder.Length + 1)..];

        return normalised.TrimStart('/');
    }
}

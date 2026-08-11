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
///     products/{productId}.jpg             one image per product, named by id
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

    /// <summary>
    /// Absolute location of the uploads tree, set once at startup.
    ///
    /// Configurable, and pointed OUTSIDE the deployment folder in production,
    /// because everything under it is irreplaceable customer data — product
    /// photographs, visiting cards, team photos and issued Sales Orders. Living
    /// beneath the application directory, as it used to, meant a republish that
    /// cleaned the target wiped the lot. Configuration and the database survive
    /// a deploy; these files must too.
    /// </summary>
    private static string _root =
        Path.Combine(AppContext.BaseDirectory, RootFolder);

    /// <summary>Called once from Program.cs before the app serves anything.</summary>
    public static void UseRoot(string absoluteRoot)
    {
        if (string.IsNullOrWhiteSpace(absoluteRoot))
            throw new ArgumentException("The uploads root cannot be empty", nameof(absoluteRoot));
        _root = Path.GetFullPath(absoluteRoot);
        Directory.CreateDirectory(_root);
    }

    /// <summary>Where the uploads tree currently lives.</summary>
    public static string Root => _root;

    public static string LeadCard(int leadId)    => $"leads/{leadId}/card";
    public static string LeadTeam(int leadId)    => $"leads/{leadId}/team";
    public static string LeadOrders(int leadId)  => $"leads/{leadId}/orders";

    /// <summary>Receipt/screenshot for the advance collected on one order. One file — a re-upload replaces it.</summary>
    public static string OrderPayment(int orderId) => $"orders/{orderId}/payment";

    public const string ProductsFolder = "products";

    /// <summary>
    /// A product's image is named after the product, not a GUID — one image per
    /// product, so the id already identifies it and a readable path is worth more
    /// than an opaque one when someone is looking at the folder.
    /// </summary>
    /// <param name="extension">Including the dot, e.g. ".png".</param>
    public static string ProductImage(int productId, string extension) =>
        $"{ProductsFolder}/{productId}{extension}";

    /// <summary>
    /// Every file that could be the given product's image, whatever extension it
    /// was uploaded with. Replacing a PNG with a JPG must not leave the PNG
    /// behind as an orphan that outlives the record pointing at it.
    /// </summary>
    public static IEnumerable<string> ExistingProductImages(int productId)
    {
        var dir = Absolute(ProductsFolder);
        if (!Directory.Exists(dir)) return Enumerable.Empty<string>();

        // Filtered by exact stem rather than trusting the "{id}.*" glob: on
        // Windows a wildcard also matches 8.3 short names, so product 1 could
        // otherwise sweep up a file belonging to product 100.
        return Directory.EnumerateFiles(dir, $"{productId}.*")
            .Where(f => Path.GetFileNameWithoutExtension(f) == productId.ToString());
    }

    /// <summary>Scanned images held before the lead exists, moved on confirm.</summary>
    public static string TempCard(string tempId) => $"temp/cards/{tempId}";

    /// <summary>Absolute location on disk for a relative upload path.</summary>
    public static string Absolute(string relative) =>
        Path.Combine(_root, relative.Replace('/', Path.DirectorySeparatorChar));

    /// <summary>Creates the folder for a relative path and returns its absolute location.</summary>
    public static string EnsureFolder(string relativeFolder)
    {
        var absolute = Absolute(relativeFolder);
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

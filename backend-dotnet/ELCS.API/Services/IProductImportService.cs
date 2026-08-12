namespace ELCS.API.Services;

/// <summary>
/// Bulk load of the supplier's catalogue sheet. See ProductImportParser for the
/// bracket notation that drives the set flags.
/// </summary>
public interface IProductImportService
{
    /// <summary>
    /// Validates every row and, unless <paramref name="dryRun"/>, writes them.
    ///
    /// Always validates the whole sheet rather than stopping at the first bad
    /// row, because the point of the preview is to show the operator everything
    /// wrong at once instead of one problem per attempt.
    /// </summary>
    /// <param name="skipExisting">
    /// A row whose barcode already exists is left completely untouched instead
    /// of updated — for re-importing a supplier sheet without overwriting a
    /// price, image or set flag someone already corrected by hand in the app.
    /// </param>
    Task<ImportReport> ImportAsync(List<ImportRowInput> rows, bool dryRun, bool skipExisting = false);

    /// <summary>
    /// Re-attempts the image download for specific existing products — for
    /// links that failed the first time (private at import, made public
    /// since, or imported before the Drive API key existed) but work now.
    /// Skips a product that already has a stored image rather than
    /// overwriting it — that image may have been uploaded by hand, which
    /// always outranks a re-fetched link. Only ImagePath ever changes; the
    /// rest of the product is untouched.
    /// </summary>
    Task<List<RetryImageResult>> RetryImagesAsync(List<int> productIds);
}

/// <summary>One row of the sheet, as read by the browser. All text — the sheet
/// has no types, and "6,295" must survive the trip to be parsed here.</summary>
public record ImportRowInput(
    int Line,               // 1-based row in the sheet, for error messages
    string? Barcode,
    string? Colour,
    string? Wsp,
    string? Size,
    string? ImageLink,
    string? Fabric = null,
    string? Name = null
);

public record ImportRowResult(
    int Line,
    string? Barcode,
    bool Ok,
    string Action,                  // create | update | ignored | skip
    List<string> Colours,
    List<string> Sizes,
    bool ColourIsSet,
    bool SizeIsSet,
    int MinimumPieces,
    decimal? Price,
    string? ImageUrl,
    bool ImageStored,               // true once the file is in uploads/
    List<string> Errors
);

public record ImportReport(
    int Total,
    int Valid,
    int Invalid,
    int Created,
    int Updated,
    int Ignored,     // matched an existing barcode but skipExisting left it untouched
    bool DryRun,
    List<ImportRowResult> Rows
);

public record RetryImageResult(int ProductId, bool Ok, string? Error);

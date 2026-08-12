using Dapper;
using ELCS.API.Data;
using ELCS.API.Utils;

namespace ELCS.API.Services;

public class ProductImportService : IProductImportService
{
    private readonly ILogger<ProductImportService> _logger;
    private readonly IDbConnection _db;
    private readonly IWebHostEnvironment _env;
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;

    // Matches the single-image upload endpoint, so a picture that arrives by
    // import is subject to the same rules as one a user picked by hand.
    private static readonly string[] AllowedImageTypes = { ".jpg", ".jpeg", ".png", ".webp" };
    private const int MaxImageBytes = 10 * 1024 * 1024;

    public ProductImportService(
        ILogger<ProductImportService> logger,
        IDbConnection db,
        IWebHostEnvironment env,
        IHttpClientFactory http,
        IConfiguration config)
    {
        _logger = logger;
        _db = db;
        _env = env;
        _http = http;
        _config = config;
    }

    public async Task<ImportReport> ImportAsync(List<ImportRowInput> rows, bool dryRun, bool skipExisting = false)
    {
        using var conn = _db.CreateConnection();

        // Barcode is the identity of a design, so an existing one is an update
        // rather than a duplicate. Loaded up front: one query beats one per row.
        var existing = (await conn.QueryAsync<(int ProductId, string Barcode)>(
                "SELECT ProductId, Barcode FROM Products"))
            .ToDictionary(r => r.Barcode.Trim(), r => r.ProductId, StringComparer.OrdinalIgnoreCase);

        // A sheet that lists the same barcode twice would otherwise insert it
        // once and then fail the unique index on the second — caught here so the
        // operator sees which line is the duplicate.
        var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        var results = new List<ImportRowResult>();
        var created = 0;
        var updated = 0;
        var ignored = 0;

        foreach (var row in rows)
        {
            var errors = new List<string>();

            var barcode = row.Barcode?.Trim() ?? string.Empty;
            if (barcode.Length == 0) errors.Add("BARCODE is empty");
            else if (seen.TryGetValue(barcode, out var firstLine))
                errors.Add($"BARCODE repeats line {firstLine}");

            var colour = ProductImportParser.ParseAxis(row.Colour);
            var size   = ProductImportParser.ParseAxis(row.Size);
            var price  = ProductImportParser.ParsePrice(row.Wsp);
            var imageUrl = ProductImportParser.NormaliseImageUrl(row.ImageLink);

            if (price == null) errors.Add("WSP is not a number");
            if (colour.Values.Count == 0) errors.Add("COLOUR is empty");
            // Size is genuinely optional, not merely unfilled: the column is
            // "Readymade only" (see Product.cs) — unstitched material and
            // anything else that doesn't come in sizes has no value to give
            // here, and that is a real product, not a data-entry mistake.

            if (!string.IsNullOrWhiteSpace(row.ImageLink) && imageUrl == null)
                errors.Add("IMAGE LINK is not a URL");

            var isUpdate = barcode.Length > 0 && existing.ContainsKey(barcode);
            var ok = errors.Count == 0;
            // A row that would update an existing product, left alone instead —
            // re-importing a sheet must not silently overwrite a price, image or
            // set flag someone already corrected by hand in the app.
            var ignore = ok && isUpdate && skipExisting;

            if (ok && barcode.Length > 0) seen[barcode] = row.Line;
            if (ignore) ignored++;

            var result = new ImportRowResult(
                Line: row.Line,
                Barcode: barcode.Length > 0 ? barcode : null,
                Ok: ok,
                Action: !ok ? "skip" : ignore ? "ignored" : isUpdate ? "update" : "create",
                Colours: colour.Values,
                Sizes: size.Values,
                ColourIsSet: colour.IsSet,
                SizeIsSet: size.IsSet,
                MinimumPieces: ProductImportParser.MinimumPieces(colour, size),
                Price: price,
                ImageUrl: imageUrl,
                ImageStored: false,
                Errors: errors);

            if (!ok || ignore || dryRun)
            {
                results.Add(result);
                continue;
            }

            var productId = isUpdate ? existing[barcode] : 0;

            var parameters = new
            {
                Barcode = barcode,
                Size = string.Join(", ", size.Values),
                Colour = string.Join(", ", colour.Values),
                row.Fabric,
                Price = price!.Value,
                row.Name,
                ImageUrl = imageUrl,
                ColourIsSet = colour.IsSet,
                SizeIsSet = size.IsSet,
                Id = productId,
            };

            if (isUpdate)
            {
                // ImagePath is deliberately not touched here — a photo someone
                // uploaded by hand outranks a re-imported link, and the download
                // below overwrites it only when it actually succeeds.
                await conn.ExecuteAsync(@"
                    UPDATE Products
                    SET Size = @Size, Colour = @Colour, Fabric = COALESCE(@Fabric, Fabric),
                        Price = @Price, Name = COALESCE(@Name, Name), ImageUrl = @ImageUrl,
                        ColourIsSet = @ColourIsSet, SizeIsSet = @SizeIsSet,
                        IsActive = 1, UpdatedAt = GETUTCDATE()
                    WHERE ProductId = @Id", parameters);
                updated++;
            }
            else
            {
                productId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO Products (Barcode, Size, Colour, Fabric, Price, Name,
                                          ImageUrl, ColourIsSet, SizeIsSet, IsActive, CreatedAt)
                    OUTPUT INSERTED.ProductId
                    VALUES (@Barcode, @Size, @Colour, @Fabric, @Price, @Name,
                            @ImageUrl, @ColourIsSet, @SizeIsSet, 1, GETUTCDATE())", parameters);
                existing[barcode] = productId;
                created++;
            }

            // The Sales Order PDF embeds a local file, never a remote URL, so the
            // link is only half the job — the picture has to be on disk here for
            // the customer's copy to show it.
            var stored = imageUrl != null && await TryStoreImageAsync(productId, imageUrl, conn);

            results.Add(result with { ImageStored = stored });
        }

        var valid = results.Count(r => r.Ok);

        _logger.LogInformation(
            "Product import {Mode}: {Total} rows, {Valid} valid, {Created} created, {Updated} updated",
            dryRun ? "preview" : "commit", rows.Count, valid, created, updated);

        return new ImportReport(
            Total: rows.Count,
            Valid: valid,
            Invalid: results.Count - valid,
            Created: created,
            Updated: updated,
            Ignored: ignored,
            DryRun: dryRun,
            Rows: results);
    }

    /// <summary>
    /// Fetches the sheet's image into uploads/products/{id}.{ext}.
    ///
    /// Never throws. A picture is worth less than the catalogue row it decorates,
    /// so a dead link, a private Drive file or a timeout costs the thumbnail and
    /// nothing else — the row is already saved and the URL is still on it.
    /// </summary>
    private async Task<bool> TryStoreImageAsync(int productId, string url, Microsoft.Data.SqlClient.SqlConnection conn)
    {
        try
        {
            // Drive's public "uc?export=view" link is not a real API — Google
            // increasingly answers it with an interstitial page or a 404 for a
            // non-browser request, sharing settings aside. The real Drive API,
            // called with a key, is what actually serves the bytes reliably.
            // Falls back to fetching the URL as-is when there is no key
            // configured, or it is not a Drive link at all.
            var driveId = url.Contains("drive.google.com", StringComparison.OrdinalIgnoreCase)
                ? ProductImportParser.ExtractDriveId(url)
                : null;
            var driveApiKey = _config["Google:DriveApiKey"];

            var fetchUrl = (driveId != null && !string.IsNullOrWhiteSpace(driveApiKey))
                ? $"https://www.googleapis.com/drive/v3/files/{driveId}?alt=media&key={driveApiKey}"
                : url;

            var client = _http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(20);

            using var response = await client.GetAsync(fetchUrl, HttpCompletionOption.ResponseHeadersRead);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Image for product {ProductId} returned {Status}", productId, response.StatusCode);
                return false;
            }

            // A Drive file that is not shared publicly answers with the sign-in
            // page — HTTP 200, content-type text/html. Saving that would leave a
            // file on disk that is not an image and a thumbnail that never loads.
            var mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
            if (!mediaType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning(
                    "Image for product {ProductId} was {MediaType}, not an image — is the link public?",
                    productId, mediaType.Length > 0 ? mediaType : "untyped");
                return false;
            }

            var extension = mediaType.ToLowerInvariant() switch
            {
                "image/png"  => ".png",
                "image/webp" => ".webp",
                _            => ".jpg",
            };
            if (!AllowedImageTypes.Contains(extension)) return false;

            var bytes = await response.Content.ReadAsByteArrayAsync();
            if (bytes.Length == 0 || bytes.Length > MaxImageBytes)
            {
                _logger.LogWarning("Image for product {ProductId} was {Bytes} bytes — not stored", productId, bytes.Length);
                return false;
            }

            UploadPaths.EnsureFolder(UploadPaths.ProductsFolder);

            // Replacing a PNG with a JPG would otherwise strand the PNG on disk.
            foreach (var stale in UploadPaths.ExistingProductImages(productId))
            {
                try { File.Delete(stale); }
                catch (IOException ex)
                {
                    _logger.LogWarning(ex, "Could not remove previous image {Path}", stale);
                }
            }

            var relative = UploadPaths.ProductImage(productId, extension);
            await File.WriteAllBytesAsync(UploadPaths.Absolute(relative), bytes);

            await conn.ExecuteAsync(
                "UPDATE Products SET ImagePath = @Path WHERE ProductId = @Id",
                new { Path = relative, Id = productId });

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not fetch the image for product {ProductId}", productId);
            return false;
        }
    }
}

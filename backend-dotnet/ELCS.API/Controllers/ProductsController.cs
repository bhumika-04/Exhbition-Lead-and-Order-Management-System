using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;
using ELCS.API.Utils;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    private readonly ILogger<ProductsController> _logger;
    private readonly IProductService _products;
    private readonly IProductImportService _import;
    private readonly IWebHostEnvironment _env;

    private static readonly string[] AllowedImageTypes =
        { ".jpg", ".jpeg", ".png", ".webp" };

    public ProductsController(
        ILogger<ProductsController> logger,
        IProductService products,
        IProductImportService import,
        IWebHostEnvironment env)
    {
        _logger = logger;
        _products = products;
        _import = import;
        _env = env;
    }

    /// <summary>
    /// Bulk load from the supplier's catalogue sheet.
    ///
    /// The browser parses the workbook and posts rows, so the server needs no
    /// spreadsheet library and the operator gets an instant preview. Call once
    /// with dryRun to show what would happen, then again to write it — the
    /// validation is the same code path both times, so the preview cannot
    /// disagree with the result.
    /// </summary>
    [HttpPost("import")]
    public async Task<IActionResult> Import([FromBody] ImportRequest request)
    {
        if (request.Rows == null || request.Rows.Count == 0)
            return BadRequest(new { error = "The sheet has no rows" });

        if (request.Rows.Count > 5000)
            return BadRequest(new { error = "That sheet is too large — split it into files of 5000 rows or fewer" });

        var report = await _import.ImportAsync(request.Rows, request.DryRun);
        return Ok(report);
    }

    /// <summary>
    /// Distinct sizes and colours already in the catalogue, for the order form's
    /// size/colour pickers. Derived rather than hard-coded so the options track
    /// what is actually stocked without anyone maintaining a second list.
    /// </summary>
    [HttpGet("options")]
    public async Task<IActionResult> GetOptions()
    {
        var (sizes, colours) = await _products.GetDistinctOptionsAsync();
        return Ok(new { sizes, colours });
    }

    [HttpGet]
    public async Task<IActionResult> Search(
        [FromQuery] string? search,
        [FromQuery] bool include_inactive = false,
        [FromQuery] int limit = 100,
        [FromQuery] int offset = 0)
    {
        var (products, count) = await _products.SearchAsync(new ProductSearchParams(
            Search: search,
            IncludeInactive: include_inactive,
            Limit: limit,
            Offset: offset));

        return Ok(new { products, count });
    }

    /// <summary>Barcode lookup — the counter's fast path when scanning.</summary>
    [HttpGet("barcode/{barcode}")]
    public async Task<IActionResult> GetByBarcode(string barcode)
    {
        var product = await _products.GetByBarcodeAsync(barcode);
        if (product == null)
            return NotFound(new { error = $"No product found for barcode {barcode}" });
        return Ok(product);
    }

    [HttpGet("{productId:int}")]
    public async Task<IActionResult> Get(int productId)
    {
        var product = await _products.GetAsync(productId);
        if (product == null) return NotFound(new { error = "Product not found" });
        return Ok(product);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SaveProductRequest request)
    {
        try
        {
            var id = await _products.CreateAsync(request);
            return Ok(new { success = true, product_id = id, product = await _products.GetAsync(id) });
        }
        catch (ArgumentException ex)          { return BadRequest(new { error = ex.Message }); }
        catch (InvalidOperationException ex)  { return Conflict(new { error = ex.Message }); }
    }

    [HttpPut("{productId:int}")]
    public async Task<IActionResult> Update(int productId, [FromBody] SaveProductRequest request)
    {
        try
        {
            await _products.UpdateAsync(productId, request);
            return Ok(new { success = true, product = await _products.GetAsync(productId) });
        }
        catch (ArgumentException ex)          { return BadRequest(new { error = ex.Message }); }
        catch (InvalidOperationException ex)  { return Conflict(new { error = ex.Message }); }
        catch (KeyNotFoundException)          { return NotFound(new { error = "Product not found" }); }
    }

    /// <summary>Soft delete — order history references products and must survive.</summary>
    [HttpDelete("{productId:int}")]
    public async Task<IActionResult> Deactivate(int productId)
    {
        try
        {
            await _products.DeactivateAsync(productId);
            return Ok(new { success = true });
        }
        catch (KeyNotFoundException) { return NotFound(new { error = "Product not found" }); }
    }

    [HttpPost("{productId:int}/image")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<IActionResult> UploadImage(int productId, IFormFile image)
    {
        if (image == null || image.Length == 0)
            return BadRequest(new { error = "No image supplied" });

        var ext = Path.GetExtension(image.FileName).ToLowerInvariant();
        if (!AllowedImageTypes.Contains(ext))
            return BadRequest(new { error = "Image must be a JPG, PNG or WebP" });

        if (await _products.GetAsync(productId) == null)
            return NotFound(new { error = "Product not found" });

        // Named after the product rather than a GUID: one image per product, so
        // the id already identifies it and the folder stays readable. These are
        // catalogue photos already shown to any visitor on the public ordering
        // page, so a guessable path costs nothing — unlike lead media, which
        // keeps its GUID names.
        UploadPaths.EnsureFolder(UploadPaths.ProductsFolder);

        // Replacing a PNG with a JPG would otherwise strand the PNG on disk.
        foreach (var stale in UploadPaths.ExistingProductImages(productId))
        {
            try { System.IO.File.Delete(stale); }
            catch (IOException ex)
            {
                // Not fatal — the new file still lands and the record still points
                // at it. Worth knowing about, since it leaves an orphan behind.
                _logger.LogWarning(ex, "Could not remove previous image {Path} for product {ProductId}",
                    stale, productId);
            }
        }

        var relative = UploadPaths.ProductImage(productId, ext);

        await using (var stream = System.IO.File.Create(
            UploadPaths.Absolute(relative)))
            await image.CopyToAsync(stream);

        await _products.SetImageAsync(productId, relative);

        _logger.LogInformation("Uploaded image for product {ProductId}", productId);
        return Ok(new { success = true, image_path = relative });
    }
}

/// <summary>Rows read from the sheet by the browser, plus the preview flag.</summary>
public record ImportRequest(List<ImportRowInput> Rows, bool DryRun = true);

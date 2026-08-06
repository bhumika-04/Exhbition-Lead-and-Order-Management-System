using Microsoft.AspNetCore.Mvc;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    private readonly ILogger<ProductsController> _logger;
    private readonly IProductService _products;
    private readonly IWebHostEnvironment _env;

    private static readonly string[] AllowedImageTypes =
        { ".jpg", ".jpeg", ".png", ".webp" };

    public ProductsController(
        ILogger<ProductsController> logger,
        IProductService products,
        IWebHostEnvironment env)
    {
        _logger = logger;
        _products = products;
        _env = env;
    }

    /// <summary>The type/category/size matrix, so the UI never has to hard-code it.</summary>
    [HttpGet("rules")]
    public IActionResult GetRules() => Ok(new
    {
        types = ProductRules.Types.Select(t => new
        {
            type = t,
            takes_category = ProductRules.TakesCategory(t),
        }),
        categories = ProductRules.Categories,
        // Readymade carries a size; Stitched is made to measure.
        size_required_for = new[] { ProductRules.Readymade },
    });

    [HttpGet]
    public async Task<IActionResult> Search(
        [FromQuery] string? search,
        [FromQuery] string? product_type,
        [FromQuery] string? category,
        [FromQuery] bool include_inactive = false,
        [FromQuery] int limit = 100,
        [FromQuery] int offset = 0)
    {
        var (products, count) = await _products.SearchAsync(new ProductSearchParams(
            Search: search,
            ProductType: product_type,
            Category: category,
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

        // GUID filename: /uploads is served without authentication, and product
        // images are shown to customers on the public ordering page, so the path
        // should not double as a way to enumerate the catalogue.
        var fileName = $"{Guid.NewGuid():N}{ext}";
        var dir = Path.Combine(_env.ContentRootPath, "uploads", "products", productId.ToString());
        Directory.CreateDirectory(dir);

        var absolute = Path.Combine(dir, fileName);
        await using (var stream = System.IO.File.Create(absolute))
            await image.CopyToAsync(stream);

        var relative = $"products/{productId}/{fileName}";
        await _products.SetImageAsync(productId, relative);

        _logger.LogInformation("Uploaded image for product {ProductId}", productId);
        return Ok(new { success = true, image_path = relative });
    }
}

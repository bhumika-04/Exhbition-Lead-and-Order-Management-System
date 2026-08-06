using ELCS.API.Models;

namespace ELCS.API.Services;

public interface IProductService
{
    Task<(List<ProductDto> Products, int TotalCount)> SearchAsync(ProductSearchParams p);
    Task<ProductDto?> GetAsync(int productId);
    Task<ProductDto?> GetByBarcodeAsync(string barcode);
    Task<int> CreateAsync(SaveProductRequest request);
    Task UpdateAsync(int productId, SaveProductRequest request);
    Task DeactivateAsync(int productId);
    Task SetImageAsync(int productId, string relativePath);
}

/// <summary>
/// The three garment types, and which fields each one may carry.
///
///   Saree          → no category, no size
///   Suit / Lehenga → Stitched (no size) or Readymade (size required)
///
/// Mirrored by CK_Products_Shape in the database, so a bad row cannot be
/// written even if a caller bypasses this validation.
/// </summary>
public static class ProductRules
{
    public const string Saree   = "Saree";
    public const string Suit    = "Suit";
    public const string Lehenga = "Lehenga";

    public const string Stitched  = "Stitched";
    public const string Readymade = "Readymade";

    public static readonly string[] Types      = { Saree, Suit, Lehenga };
    public static readonly string[] Categories = { Stitched, Readymade };

    public static bool TakesCategory(string? productType) =>
        productType is Suit or Lehenga;

    public static bool TakesSize(string? productType, string? category) =>
        TakesCategory(productType) && category == Readymade;

    /// <summary>Returns null when valid, otherwise the reason it is not.</summary>
    public static string? Validate(string? productType, string? category, string? size)
    {
        if (string.IsNullOrWhiteSpace(productType) || !Types.Contains(productType))
            return "Choose a product type";

        var hasCategory = !string.IsNullOrWhiteSpace(category);
        var hasSize     = !string.IsNullOrWhiteSpace(size);

        if (!TakesCategory(productType))
            return hasCategory ? $"{productType} does not have a category"
                 : hasSize     ? $"{productType} does not have a size"
                 : null;

        if (!hasCategory)                       return "Choose Stitched or Readymade";
        if (!Categories.Contains(category!))    return "Category must be Stitched or Readymade";

        if (category == Readymade && !hasSize)  return "Readymade items need a size";
        if (category == Stitched  &&  hasSize)  return "Stitched items are made to measure — no size";

        return null;
    }

    /// <summary>Blanks out fields the shape does not allow, so callers cannot smuggle them in.</summary>
    public static (string? Category, string? Size) Normalise(string productType, string? category, string? size)
    {
        if (!TakesCategory(productType)) return (null, null);
        return (category, category == Readymade ? size : null);
    }
}

public record ProductDto(
    int ProductId,
    string Barcode,
    string ProductType,
    string? Category,
    string? Size,
    string? Colour,
    string? Fabric,
    decimal Price,
    string? Name,
    string? ImagePath,
    bool IsActive,
    DateTime CreatedAt
);

public record SaveProductRequest(
    string Barcode,
    string ProductType,
    string? Category,
    string? Size,
    string? Colour,
    string? Fabric,
    decimal Price,
    string? Name
);

public record ProductSearchParams(
    string? Search = null,        // barcode, name or colour
    string? ProductType = null,
    string? Category = null,
    bool IncludeInactive = false,
    int Limit = 100,
    int Offset = 0
);

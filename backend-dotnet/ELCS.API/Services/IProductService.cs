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

    /// <summary>Distinct sizes and colours across live products, for order-form pickers.</summary>
    Task<(List<string> Sizes, List<string> Colours)> GetDistinctOptionsAsync();
}


public record ProductDto(
    int ProductId,
    string Barcode,
    string? Size,
    string? Colour,
    string? Fabric,
    decimal Price,
    string? Name,
    string? ImagePath,
    string? ImageUrl,
    // A bracketed list in the catalogue sheet ships whole rather than offering a
    // choice, so these drive the order form's minimum quantity per combination.
    bool ColourIsSet,
    bool SizeIsSet,
    bool IsActive,
    DateTime CreatedAt
);

public record SaveProductRequest(
    string Barcode,
    string? Size,
    string? Colour,
    string? Fabric,
    decimal Price,
    string? Name,
    string? ImageUrl = null,
    bool ColourIsSet = false,
    bool SizeIsSet = false
);

public record ProductSearchParams(
    string? Search = null,        // barcode, name or colour
    bool IncludeInactive = false,
    int Limit = 100,
    int Offset = 0
);

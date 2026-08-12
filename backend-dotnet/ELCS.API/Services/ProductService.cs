using Dapper;
using ELCS.API.Data;

namespace ELCS.API.Services;

public class ProductService : IProductService
{
    private readonly ILogger<ProductService> _logger;
    private readonly IDbConnection _db;

    public ProductService(ILogger<ProductService> logger, IDbConnection db)
    {
        _logger = logger;
        _db = db;
    }

    private const string Columns = @"
        ProductId, Barcode, Size, Colour, Fabric,
        Price, Name, ImagePath, ImageUrl, ColourIsSet, SizeIsSet, IsActive, CreatedAt";

    public async Task<(List<ProductDto> Products, int TotalCount)> SearchAsync(ProductSearchParams p)
    {
        using var conn = _db.CreateConnection();

        var where = p.IncludeInactive ? "WHERE 1=1" : "WHERE IsActive = 1";
        var args = new DynamicParameters();

        if (!string.IsNullOrWhiteSpace(p.Search))
        {
            where += " AND (Barcode LIKE @Search OR Name LIKE @Search OR Colour LIKE @Search OR Fabric LIKE @Search)";
            args.Add("Search", $"%{p.Search.Trim()}%");
        }

        var total = await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM Products {where}", args);

        args.Add("Offset", Math.Max(0, p.Offset));
        // Was capped at 500 — the catalogue is past that now (523 and
        // growing), and the cap silently truncated the page below what the
        // caller asked for. Matches the frontend's own FETCH_LIMIT.
        args.Add("Limit", Math.Clamp(p.Limit, 1, 2000));

        var rows = (await conn.QueryAsync<ProductDto>($@"
            SELECT {Columns} FROM Products
            {where}
            ORDER BY Barcode
            OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY", args)).ToList();

        return (rows, total);
    }

    public async Task<ProductDto?> GetAsync(int productId)
    {
        using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<ProductDto>(
            $"SELECT {Columns} FROM Products WHERE ProductId = @Id", new { Id = productId });
    }

    public async Task<ProductDto?> GetByBarcodeAsync(string barcode)
    {
        if (string.IsNullOrWhiteSpace(barcode)) return null;

        using var conn = _db.CreateConnection();
        // Only live products resolve — a retired design must not price a new order.
        return await conn.QueryFirstOrDefaultAsync<ProductDto>(
            $"SELECT {Columns} FROM Products WHERE Barcode = @Barcode AND IsActive = 1",
            new { Barcode = barcode.Trim() });
    }

    public async Task<int> CreateAsync(SaveProductRequest request)
    {
        var (size, colour) = ValidateAndNormalise(request);

        using var conn = _db.CreateConnection();

        var clash = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM Products WHERE Barcode = @Barcode AND IsActive = 1",
            new { Barcode = request.Barcode.Trim() });
        if (clash > 0)
            throw new InvalidOperationException($"Barcode {request.Barcode.Trim()} is already in use");

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO Products (Barcode, Size, Colour, Fabric,
                                  Price, Name, ImageUrl, ColourIsSet, SizeIsSet, IsActive, CreatedAt)
            OUTPUT INSERTED.ProductId
            VALUES (@Barcode, @Size, @Colour, @Fabric,
                    @Price, @Name, @ImageUrl, @ColourIsSet, @SizeIsSet, 1, GETUTCDATE())",
            new
            {
                Barcode = request.Barcode.Trim(),
                Size = size,
                Colour = colour,
                request.Fabric,
                request.Price,
                request.Name,
                request.ImageUrl,
                request.ColourIsSet,
                request.SizeIsSet,
            });

        _logger.LogInformation("Created product {ProductId} ({Barcode})", id, request.Barcode);
        return id;
    }

    public async Task UpdateAsync(int productId, SaveProductRequest request)
    {
        var (size, colour) = ValidateAndNormalise(request);

        using var conn = _db.CreateConnection();

        var clash = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM Products WHERE Barcode = @Barcode AND IsActive = 1 AND ProductId <> @Id",
            new { Barcode = request.Barcode.Trim(), Id = productId });
        if (clash > 0)
            throw new InvalidOperationException($"Barcode {request.Barcode.Trim()} is already in use");

        var rows = await conn.ExecuteAsync(@"
            UPDATE Products
            SET Barcode = @Barcode,
                Size = @Size, Colour = @Colour, Fabric = @Fabric,
                Price = @Price, Name = @Name, ImageUrl = @ImageUrl,
                ColourIsSet = @ColourIsSet, SizeIsSet = @SizeIsSet,
                UpdatedAt = GETUTCDATE()
            WHERE ProductId = @Id",
            new
            {
                Barcode = request.Barcode.Trim(),
                Size = size,
                Colour = colour,
                request.Fabric,
                request.Price,
                request.Name,
                request.ImageUrl,
                request.ColourIsSet,
                request.SizeIsSet,
                Id = productId,
            });

        if (rows == 0) throw new KeyNotFoundException($"Product {productId} not found");
    }

    public async Task DeactivateAsync(int productId)
    {
        using var conn = _db.CreateConnection();
        // Soft delete: order lines reference products, and a discontinued design
        // must not erase the history of what was sold.
        var rows = await conn.ExecuteAsync(
            "UPDATE Products SET IsActive = 0, UpdatedAt = GETUTCDATE() WHERE ProductId = @Id",
            new { Id = productId });
        if (rows == 0) throw new KeyNotFoundException($"Product {productId} not found");
    }

    public async Task SetImageAsync(int productId, string relativePath)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE Products SET ImagePath = @Path, UpdatedAt = GETUTCDATE() WHERE ProductId = @Id",
            new { Path = relativePath, Id = productId });
    }

    public async Task<(List<string> Sizes, List<string> Colours)> GetDistinctOptionsAsync()
    {
        using var conn = _db.CreateConnection();

        // Products store these comma-separated, so split before de-duplicating —
        // otherwise the fallback list offers "38, 40, 42" as a single option.
        var rawSizes = await conn.QueryAsync<string>(
            "SELECT Size FROM Products WHERE IsActive = 1 AND Size IS NOT NULL");
        var rawColours = await conn.QueryAsync<string>(
            "SELECT Colour FROM Products WHERE IsActive = 1 AND Colour IS NOT NULL");

        return (SplitDistinct(rawSizes), SplitDistinct(rawColours));
    }

    /// <summary>Splits comma-separated values, trims, de-duplicates case-insensitively, sorts.</summary>
    public static List<string> SplitDistinct(IEnumerable<string?> values) =>
        values
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .SelectMany(v => v!.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(v => v.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(v => v, StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static (string? Size, string? Colour) ValidateAndNormalise(SaveProductRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Barcode))
            throw new ArgumentException("Barcode is required");
        if (r.Price < 0m)
            throw new ArgumentException("Price cannot be negative");

        // Size and colour are comma-separated lists. Canonicalise the spacing so
        // "38,40" and "38, 40" are stored identically — otherwise the same design
        // entered twice yields two different strings and the order-page dropdown
        // shows duplicates.
        return (NormaliseList(r.Size), NormaliseList(r.Colour));
    }

    private static string? NormaliseList(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var parts = SplitDistinct(new[] { raw });
        return parts.Count == 0 ? null : string.Join(", ", parts);
    }
}

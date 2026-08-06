namespace ELCS.API.Models;

public class Product
{
    public int ProductId { get; set; }
    public string Barcode { get; set; } = string.Empty;   // design-level SKU
    public string ProductType { get; set; } = string.Empty; // Saree | Suit | Lehenga
    public string? Category { get; set; }                 // Stitched | Readymade; null for Saree
    public string? Size { get; set; }                     // Readymade only
    public string? Colour { get; set; }
    public string? Fabric { get; set; }
    public decimal Price { get; set; }
    public string? Name { get; set; }
    public string? ImagePath { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

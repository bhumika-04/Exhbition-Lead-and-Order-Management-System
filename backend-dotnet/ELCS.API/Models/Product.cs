namespace ELCS.API.Models;

public class Product
{
    public int ProductId { get; set; }
    public string Barcode { get; set; } = string.Empty;   // design-level SKU
    public string? Size { get; set; }                     // Readymade only
    public string? Colour { get; set; }
    public string? Fabric { get; set; }
    public decimal Price { get; set; }
    public string? Name { get; set; }
    public string? ImagePath { get; set; }          // local file under uploads/
    public string? ImageUrl { get; set; }           // external link from the import sheet

    // A bracketed list in the catalogue sheet: the values ship together rather
    // than being a choice. Both true means every colour in every size.
    public bool ColourIsSet { get; set; }
    public bool SizeIsSet { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

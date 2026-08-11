namespace ELCS.API.Models;

public class Order
{
    public int OrderId { get; set; }
    public string OrderNumber { get; set; } = string.Empty;
    public int LeadId { get; set; }
    public int? ExhibitionId { get; set; }
    public string StatusCode { get; set; } = "draft";
    public decimal OrderTotal { get; set; }      // SUM of priced lines
    public decimal? OrderValue { get; set; }     // exact value when known
    public int SlabBand { get; set; }            // operator-chosen order-value slab
    public decimal AdvanceAmount { get; set; }   // advance actually taken
    public string? Notes { get; set; }
    public string? SoPdfPath { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public int? CreatedByEmployeeId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    // Joined for display
    public string? LeadName { get; set; }
    public string? LeadCompanyName { get; set; }
    public string? LeadPhone { get; set; }
    public string? LeadEmail { get; set; }
    public string? LeadGstNumber { get; set; }
    public string? LeadAddress { get; set; }
    public string? LeadCity { get; set; }
    public string? LeadState { get; set; }
    public string? ExhibitionName { get; set; }
}

public class OrderItem
{
    public int OrderItemId { get; set; }
    public int OrderId { get; set; }
    public int LineNumber { get; set; }   // "LineNo" is a reserved T-SQL keyword
    public string? Barcode { get; set; }
    public string? Size { get; set; }
    public string? Colour { get; set; }
    public int Pieces { get; set; } = 1;
    public decimal? Rate { get; set; }                     // optional
    public decimal? Amount { get; set; }                   // Rate × Pieces when priced
    public string? Customization { get; set; }
}

public class WhatsAppMessage
{
    public int WhatsAppMessageId { get; set; }
    public int LeadId { get; set; }
    public int? OrderId { get; set; }
    public string Touchpoint { get; set; } = string.Empty;
    public string? Recipient { get; set; }
    public string? TemplateName { get; set; }
    public string? MediaUrl { get; set; }
    public string StatusCode { get; set; } = string.Empty;
    public string? ProviderMessageId { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAt { get; set; }
}

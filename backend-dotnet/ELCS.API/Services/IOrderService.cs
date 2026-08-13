using ELCS.API.Models;

namespace ELCS.API.Services;

public interface IOrderService
{
    Task<List<OrderSummaryDto>> GetOrdersForLeadAsync(int leadId);
    Task<OrderDetailDto?> GetOrderAsync(int orderId);
    Task<int> CreateOrderAsync(CreateOrderRequest request, int? employeeId);
    Task UpdateOrderAsync(int orderId, UpdateOrderRequest request);
    Task DeleteOrderAsync(int orderId);
    Task ConfirmOrderAsync(int orderId);

    /// <summary>
    /// Applies ONE payment across several of a lead's draft orders and confirms
    /// them together — for a customer who placed more than one order and pays
    /// once for all of it. Drafts only: the Sales Order and its payment are a
    /// one-time step at confirmation, not something bulk-editable afterwards.
    /// The advance is allocated to each order up to its own value in turn
    /// (oldest first), so no single order ends up recorded with more advance
    /// than its own worth, while the combined total across the selection still
    /// matches what was actually collected. Returns the confirmed order ids.
    /// </summary>
    Task<List<int>> BulkConfirmDraftsAsync(int leadId, List<int> orderIds, int slabBand, decimal advanceAmount);

    /// <summary>Sets the slab, order value and the advance actually taken on an order.</summary>
    Task SetOrderPaymentAsync(int orderId, SetOrderPaymentRequest request);

    /// <summary>Value/advance/coupon position for a lead, across all non-cancelled orders.</summary>
    Task<LeadOrderSummaryDto> GetLeadOrderSummaryAsync(int leadId);

    Task SetSoPdfPathAsync(int orderId, string relativePath);

    /// <summary>Records (or replaces) the payment-proof image path for an order.</summary>
    Task SetPaymentProofPathAsync(int orderId, string relativePath);

    /// <summary>Order list for the Orders page — filters, barcode search and totals.</summary>
    Task<OrderListResultDto> SearchOrdersAsync(OrderSearchParams p);

    /// <summary>Leads ranked by lucky-draw coupons.</summary>
    Task<List<CouponHolderDto>> GetCouponHoldersAsync(int? exhibitionId);
}


public record OrderItemDto(
    int OrderItemId,
    int LineNumber,
    string? Barcode,
    string? Size,
    string? Colour,
    string? Fabric,       // snapshot
    int Pieces,
    decimal? Rate,        // optional — the slab can carry the value instead
    decimal? Amount,      // Rate × Pieces when Rate is given
    string? Customization,
    int? ProductId,       // pointer for traceability; the snapshot above is authoritative
    // Both, because they are not interchangeable: ImagePath is a local file the
    // Sales Order PDF can embed, ImageUrl is only ever a browser thumbnail.
    string? ProductImagePath,
    string? ProductImageUrl
);

public record OrderSummaryDto(
    int OrderId,
    string OrderNumber,
    int LeadId,
    string StatusCode,
    decimal OrderTotal,
    decimal? OrderValue,
    decimal EffectiveValue,
    int SlabBand,
    decimal AdvanceAmount,
    int ItemCount,
    int TotalPieces,
    string? SoPdfPath,
    DateTime? ConfirmedAt,
    DateTime CreatedAt
);

public record OrderDetailDto(
    int OrderId,
    string OrderNumber,
    int LeadId,
    string? LeadName,
    string? LeadCompanyName,
    string? LeadPhone,
    // Buyer block on the Sales Order. A tax document has to identify who it is
    // billed to, so the lead's address, email and GSTIN travel with the order.
    string? LeadEmail,
    string? LeadGstNumber,
    string? LeadAddress,
    string? LeadCity,
    string? LeadState,
    int? ExhibitionId,
    string? ExhibitionName,
    string StatusCode,
    decimal OrderTotal,        // SUM of priced lines; 0 when lines are unpriced
    decimal? OrderValue,       // exact value when known
    decimal EffectiveValue,    // OrderValue ?? OrderTotal — what the money runs on
    int SlabBand,
    decimal AdvanceAmount,     // actually taken
    decimal SuggestedAdvance,  // ₹11,000 × SlabBand
    int OrderCoupons,          // coupons this order's advance alone would earn
    string? Notes,
    string? SoPdfPath,
    string? PaymentProofPath,
    DateTime? ConfirmedAt,
    DateTime CreatedAt,
    List<OrderItemDto> Items,
    LeadOrderSummaryDto LeadSummary
);

/// <summary>
/// Lead-level money position across all non-cancelled orders.
/// Coupons follow the advance actually taken, not the order value.
/// </summary>
public record LeadOrderSummaryDto(
    int LeadId,
    int OrderCount,
    decimal LeadTotal,       // combined order value
    decimal TotalAdvance,    // combined advance taken
    int Slab,                // slab the combined value falls into
    int Coupons,             // 4 × floor(totalAdvance / 11,000)
    decimal Balance,
    bool IsOverpaid
);

public record SetOrderPaymentRequest(
    int SlabBand,
    decimal? OrderValue,
    decimal AdvanceAmount
);


public record OrderSearchParams(
    int? ExhibitionId = null,
    string? StatusCode = null,
    string? Search = null,      // order number, lead name, or barcode
    string? Source = null,      // staff | self_service
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    int Limit = 100,
    int Offset = 0
);

public record OrderListItemDto(
    int OrderId,
    string OrderNumber,
    int LeadId,
    string? LeadName,
    string? LeadCompanyName,
    string? LeadPhone,
    string? ExhibitionName,
    string StatusCode,
    string Source,              // so a customer-submitted order is identifiable
    decimal EffectiveValue,
    decimal AdvanceAmount,
    int ItemCount,
    int TotalPieces,
    string? SoPdfPath,
    DateTime CreatedAt
);

public record OrderListTotalsDto(
    int OrderCount,
    decimal TotalValue,
    decimal TotalAdvance,
    int TotalCoupons,       // summed per lead, not per order
    int PendingSelfService, // customer orders waiting on a CRR — the work queue
    decimal DraftValue,     // TotalValue's draft-status share — not a sale yet
    decimal ConfirmedValue  // TotalValue's confirmed-status share
);

public record OrderListResultDto(
    List<OrderListItemDto> Orders,
    int TotalCount,
    OrderListTotalsDto Totals
);

public record CouponHolderDto(
    int LeadId,
    string? LeadName,
    string? CompanyName,
    string? Phone,
    decimal TotalValue,
    decimal TotalAdvance,
    int Coupons,
    int OrderCount
);

/// <summary>
/// A line as submitted. When ProductId is given the server re-reads the product
/// and snapshots its details, so a client cannot claim a different price than
/// the catalogue holds. Fields left null are filled from the product.
/// </summary>
public record CreateOrderItemRequest(
    string? Barcode,
    string? Size,
    string? Colour,
    int Pieces,
    decimal? Rate,          // optional — leave null when pricing comes from the slab
    string? Customization,
    int? ProductId = null,
    string? Fabric = null
);

public record CreateOrderRequest(
    int LeadId,
    List<CreateOrderItemRequest> Items,
    string? Notes
);

public record UpdateOrderRequest(
    List<CreateOrderItemRequest> Items,
    string? Notes,
    string? StatusCode
);

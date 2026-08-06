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

    /// <summary>Sets the slab, order value and the advance actually taken on an order.</summary>
    Task SetOrderPaymentAsync(int orderId, SetOrderPaymentRequest request);

    /// <summary>Value/advance/coupon position for a lead, across all non-cancelled orders.</summary>
    Task<LeadOrderSummaryDto> GetLeadOrderSummaryAsync(int leadId);

    Task SetSoPdfPathAsync(int orderId, string relativePath);

    /// <summary>Order list for the Orders page — filters, barcode search and totals.</summary>
    Task<OrderListResultDto> SearchOrdersAsync(OrderSearchParams p);

    /// <summary>Leads ranked by lucky-draw coupons.</summary>
    Task<List<CouponHolderDto>> GetCouponHoldersAsync(int? exhibitionId);
}

/// <summary>The three item types the client sells. Free text in the DB so more can be added.</summary>
public static class OrderItemTypes
{
    public const string Suit    = "Suit";
    public const string Lehenga = "Lehenga";
    public const string Saree   = "Saree";

    public static readonly string[] All = { Suit, Lehenga, Saree };
}

public record OrderItemDto(
    int OrderItemId,
    int LineNo,
    string ItemType,
    string? Barcode,
    string? Size,
    string? Colour,
    int Pieces,
    decimal? Rate,        // optional — the slab can carry the value instead
    decimal? Amount,      // Rate × Pieces when Rate is given
    string? Customization
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
    string? ExhibitionName,
    string StatusCode,
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
    int TotalCoupons        // summed per lead, not per order
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

public record CreateOrderItemRequest(
    string ItemType,
    string? Barcode,
    string? Size,
    string? Colour,
    int Pieces,
    decimal? Rate,          // optional — leave null when pricing comes from the slab
    string? Customization
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

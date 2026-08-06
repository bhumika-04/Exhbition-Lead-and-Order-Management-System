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

    /// <summary>Advance/coupon position for a lead, across all their non-cancelled orders.</summary>
    Task<LeadOrderSummaryDto> GetLeadOrderSummaryAsync(int leadId);

    /// <summary>Sets the operator-agreed advance used when the lead's total is below ₹1L.</summary>
    Task SetManualAdvanceAsync(int leadId, decimal? amount);

    Task SetSoPdfPathAsync(int orderId, string relativePath);
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
    decimal Rate,
    decimal Amount,
    string? Customization
);

public record OrderSummaryDto(
    int OrderId,
    string OrderNumber,
    int LeadId,
    string StatusCode,
    decimal OrderTotal,
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
    decimal OrderTotal,
    string? Notes,
    string? SoPdfPath,
    DateTime? ConfirmedAt,
    DateTime CreatedAt,
    List<OrderItemDto> Items,
    LeadOrderSummaryDto LeadSummary
);

/// <summary>
/// Lead-level money position. Advance and coupons are derived here, never stored,
/// so adding an order re-bands the lead automatically.
/// </summary>
public record LeadOrderSummaryDto(
    int LeadId,
    int OrderCount,
    decimal LeadTotal,
    int Band,
    decimal Advance,
    int Coupons,
    decimal Balance,
    bool IsManualAdvance,
    decimal? ManualAdvanceAmount
);

public record CreateOrderItemRequest(
    string ItemType,
    string? Barcode,
    string? Size,
    string? Colour,
    int Pieces,
    decimal Rate,
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

public record SetManualAdvanceRequest(decimal? Amount);

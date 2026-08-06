using Dapper;
using ELCS.API.Data;
using ELCS.API.Models;

namespace ELCS.API.Services;

public class OrderService : IOrderService
{
    private readonly ILogger<OrderService> _logger;
    private readonly IDbConnection _db;

    public OrderService(ILogger<OrderService> logger, IDbConnection db)
    {
        _logger = logger;
        _db = db;
    }

    // Cancelled orders are excluded from the lead's total, so cancelling an
    // order re-bands the lead the same way adding one does.
    private const string ActiveOrderFilter = "StatusCode <> 'cancelled'";

    private sealed class LeadOrderAggregate
    {
        public int OrderCount { get; set; }
        public decimal? Total { get; set; }
    }

    public async Task<List<OrderSummaryDto>> GetOrdersForLeadAsync(int leadId)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync<OrderSummaryDto>(@"
            SELECT o.OrderId, o.OrderNumber, o.LeadId, o.StatusCode, o.OrderTotal,
                   ISNULL(i.ItemCount, 0)  AS ItemCount,
                   ISNULL(i.TotalPieces, 0) AS TotalPieces,
                   o.SoPdfPath, o.ConfirmedAt, o.CreatedAt
            FROM Orders o
            OUTER APPLY (
                SELECT COUNT(*) AS ItemCount, SUM(Pieces) AS TotalPieces
                FROM OrderItems WHERE OrderId = o.OrderId
            ) i
            WHERE o.LeadId = @LeadId
            ORDER BY o.CreatedAt DESC", new { LeadId = leadId });
        return rows.ToList();
    }

    public async Task<OrderDetailDto?> GetOrderAsync(int orderId)
    {
        using var conn = _db.CreateConnection();

        var order = await conn.QueryFirstOrDefaultAsync<Order>(@"
            SELECT o.*,
                   l.PrimaryVisitorName AS LeadName,
                   l.CompanyName        AS LeadCompanyName,
                   e.Name               AS ExhibitionName
            FROM Orders o
            JOIN Leads l            ON l.LeadId = o.LeadId
            LEFT JOIN Exhibitions e ON e.ExhibitionId = o.ExhibitionId
            WHERE o.OrderId = @OrderId", new { OrderId = orderId });

        if (order == null) return null;

        var leadPhone = await conn.ExecuteScalarAsync<string?>(
            "SELECT PrimaryVisitorPhone FROM Leads WHERE LeadId = @LeadId",
            new { order.LeadId });

        var items = (await conn.QueryAsync<OrderItemDto>(@"
            SELECT OrderItemId, LineNo, ItemType, Barcode, Size, Colour,
                   Pieces, Rate, Amount, Customization
            FROM OrderItems
            WHERE OrderId = @OrderId
            ORDER BY LineNo", new { OrderId = orderId })).ToList();

        var summary = await GetLeadOrderSummaryAsync(order.LeadId);

        return new OrderDetailDto(
            OrderId:         order.OrderId,
            OrderNumber:     order.OrderNumber,
            LeadId:          order.LeadId,
            LeadName:        order.LeadName,
            LeadCompanyName: order.LeadCompanyName,
            LeadPhone:       leadPhone,
            ExhibitionId:    order.ExhibitionId,
            ExhibitionName:  order.ExhibitionName,
            StatusCode:      order.StatusCode,
            OrderTotal:      order.OrderTotal,
            Notes:           order.Notes,
            SoPdfPath:       order.SoPdfPath,
            ConfirmedAt:     order.ConfirmedAt,
            CreatedAt:       order.CreatedAt,
            Items:           items,
            LeadSummary:     summary);
    }

    public async Task<int> CreateOrderAsync(CreateOrderRequest request, int? employeeId)
    {
        if (request.Items == null || request.Items.Count == 0)
            throw new ArgumentException("An order needs at least one item");

        using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        var exhibitionId = await conn.ExecuteScalarAsync<int?>(
            "SELECT ExhibitionId FROM Leads WHERE LeadId = @LeadId",
            new { request.LeadId });

        using var tx = conn.BeginTransaction();
        try
        {
            var seq = await conn.ExecuteScalarAsync<int>(
                "SELECT NEXT VALUE FOR dbo.OrderNumberSequence", transaction: tx);
            var orderNumber = $"SO-{DateTime.UtcNow:yyyyMM}-{seq:D5}";

            var orderId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO Orders (OrderNumber, LeadId, ExhibitionId, StatusCode,
                                    OrderTotal, Notes, CreatedByEmployeeId, CreatedAt)
                OUTPUT INSERTED.OrderId
                VALUES (@OrderNumber, @LeadId, @ExhibitionId, 'draft',
                        0, @Notes, @EmployeeId, GETUTCDATE())",
                new
                {
                    OrderNumber = orderNumber,
                    request.LeadId,
                    ExhibitionId = exhibitionId,
                    request.Notes,
                    EmployeeId = employeeId
                }, tx);

            var total = await ReplaceItemsAsync(conn, tx, orderId, request.Items);

            tx.Commit();
            _logger.LogInformation(
                "Created order {OrderNumber} ({OrderId}) for lead {LeadId}, total {Total}",
                orderNumber, orderId, request.LeadId, total);
            return orderId;
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    public async Task UpdateOrderAsync(int orderId, UpdateOrderRequest request)
    {
        using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        var existing = await conn.QueryFirstOrDefaultAsync<Order>(
            "SELECT * FROM Orders WHERE OrderId = @OrderId", new { OrderId = orderId });
        if (existing == null)
            throw new KeyNotFoundException($"Order {orderId} not found");

        using var tx = conn.BeginTransaction();
        try
        {
            if (request.Items is { Count: > 0 })
                await ReplaceItemsAsync(conn, tx, orderId, request.Items);

            await conn.ExecuteAsync(@"
                UPDATE Orders
                SET Notes      = COALESCE(@Notes, Notes),
                    StatusCode = COALESCE(@StatusCode, StatusCode),
                    UpdatedAt  = GETUTCDATE()
                WHERE OrderId = @OrderId",
                new { request.Notes, request.StatusCode, OrderId = orderId }, tx);

            tx.Commit();
            _logger.LogInformation("Updated order {OrderId}", orderId);
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    public async Task DeleteOrderAsync(int orderId)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            "DELETE FROM Orders WHERE OrderId = @OrderId", new { OrderId = orderId });
        if (rows == 0)
            throw new KeyNotFoundException($"Order {orderId} not found");
        _logger.LogInformation("Deleted order {OrderId}", orderId);
    }

    public async Task ConfirmOrderAsync(int orderId)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.ExecuteAsync(@"
            UPDATE Orders
            SET StatusCode  = 'confirmed',
                ConfirmedAt = ISNULL(ConfirmedAt, GETUTCDATE()),
                UpdatedAt   = GETUTCDATE()
            WHERE OrderId = @OrderId AND StatusCode <> 'cancelled'",
            new { OrderId = orderId });

        if (rows == 0)
            throw new KeyNotFoundException($"Order {orderId} not found or is cancelled");

        _logger.LogInformation("Confirmed order {OrderId}", orderId);
    }

    public async Task<LeadOrderSummaryDto> GetLeadOrderSummaryAsync(int leadId)
    {
        using var conn = _db.CreateConnection();

        var agg = await conn.QueryFirstOrDefaultAsync<LeadOrderAggregate>($@"
            SELECT COUNT(*) AS OrderCount, SUM(OrderTotal) AS Total
            FROM Orders
            WHERE LeadId = @LeadId AND {ActiveOrderFilter}", new { LeadId = leadId });

        var manual = await conn.ExecuteScalarAsync<decimal?>(
            "SELECT ManualAdvanceAmount FROM Leads WHERE LeadId = @LeadId",
            new { LeadId = leadId });

        var leadTotal = agg?.Total ?? 0m;
        var breakdown = AdvanceCalculator.Calculate(leadTotal, manual);

        return new LeadOrderSummaryDto(
            LeadId:              leadId,
            OrderCount:          agg?.OrderCount ?? 0,
            LeadTotal:           breakdown.Total,
            Band:                breakdown.Band,
            Advance:             breakdown.Advance,
            Coupons:             breakdown.Coupons,
            Balance:             breakdown.Balance,
            IsManualAdvance:     breakdown.IsManualAdvance,
            ManualAdvanceAmount: manual);
    }

    public async Task SetManualAdvanceAsync(int leadId, decimal? amount)
    {
        if (amount is < 0m)
            throw new ArgumentException("Advance cannot be negative");

        using var conn = _db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            "UPDATE Leads SET ManualAdvanceAmount = @Amount, UpdatedAt = GETUTCDATE() WHERE LeadId = @LeadId",
            new { Amount = amount, LeadId = leadId });
        if (rows == 0)
            throw new KeyNotFoundException($"Lead {leadId} not found");
    }

    public async Task SetSoPdfPathAsync(int orderId, string relativePath)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE Orders SET SoPdfPath = @Path, UpdatedAt = GETUTCDATE() WHERE OrderId = @OrderId",
            new { Path = relativePath, OrderId = orderId });
    }

    /// <summary>
    /// Replaces an order's lines and re-derives the order total.
    /// Amount is always Rate × Pieces — never taken from the client.
    /// </summary>
    private static async Task<decimal> ReplaceItemsAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        int orderId,
        List<CreateOrderItemRequest> items)
    {
        await conn.ExecuteAsync(
            "DELETE FROM OrderItems WHERE OrderId = @OrderId", new { OrderId = orderId }, tx);

        decimal total = 0m;
        var lineNo = 1;

        foreach (var item in items)
        {
            if (item.Pieces <= 0)
                throw new ArgumentException($"Line {lineNo}: pieces must be greater than zero");
            if (item.Rate < 0m)
                throw new ArgumentException($"Line {lineNo}: rate cannot be negative");
            if (string.IsNullOrWhiteSpace(item.ItemType))
                throw new ArgumentException($"Line {lineNo}: item type is required");

            var amount = decimal.Round(item.Rate * item.Pieces, 2, MidpointRounding.AwayFromZero);
            total += amount;

            await conn.ExecuteAsync(@"
                INSERT INTO OrderItems (OrderId, LineNo, ItemType, Barcode, Size, Colour,
                                        Pieces, Rate, Amount, Customization)
                VALUES (@OrderId, @LineNo, @ItemType, @Barcode, @Size, @Colour,
                        @Pieces, @Rate, @Amount, @Customization)",
                new
                {
                    OrderId = orderId,
                    LineNo  = lineNo,
                    ItemType = item.ItemType.Trim(),
                    item.Barcode,
                    item.Size,
                    item.Colour,
                    item.Pieces,
                    item.Rate,
                    Amount = amount,
                    item.Customization
                }, tx);

            lineNo++;
        }

        await conn.ExecuteAsync(
            "UPDATE Orders SET OrderTotal = @Total, UpdatedAt = GETUTCDATE() WHERE OrderId = @OrderId",
            new { Total = total, OrderId = orderId }, tx);

        return total;
    }
}

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

    // Cancelled orders are excluded everywhere money is totalled, so cancelling
    // an order withdraws its value and its advance from the lead's position.
    private const string ActiveOnly = "StatusCode <> 'cancelled'";

    // The value the money runs on: the exact figure when the operator gave one,
    // otherwise the sum of priced lines.
    private const string EffectiveValueSql = "COALESCE(OrderValue, OrderTotal)";

    private sealed class LeadAggregate
    {
        public int OrderCount { get; set; }
        public decimal? TotalValue { get; set; }
        public decimal? TotalAdvance { get; set; }
    }

    public async Task<List<OrderSummaryDto>> GetOrdersForLeadAsync(int leadId)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync<OrderSummaryDto>($@"
            SELECT o.OrderId, o.OrderNumber, o.LeadId, o.StatusCode,
                   o.OrderTotal, o.OrderValue,
                   {EffectiveValueSql} AS EffectiveValue,
                   o.SlabBand, o.AdvanceAmount,
                   ISNULL(i.ItemCount, 0)   AS ItemCount,
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
                   l.PrimaryVisitorName  AS LeadName,
                   l.CompanyName         AS LeadCompanyName,
                   l.PrimaryVisitorPhone AS LeadPhone,
                   e.Name                AS ExhibitionName
            FROM Orders o
            JOIN Leads l            ON l.LeadId = o.LeadId
            LEFT JOIN Exhibitions e ON e.ExhibitionId = o.ExhibitionId
            WHERE o.OrderId = @OrderId", new { OrderId = orderId });

        if (order == null) return null;

        var items = (await conn.QueryAsync<OrderItemDto>(@"
            SELECT oi.OrderItemId, oi.LineNumber, oi.ItemType, oi.Category, oi.Barcode,
                   oi.Size, oi.Colour, oi.Fabric, oi.Pieces, oi.Rate, oi.Amount,
                   oi.Customization, oi.ProductId,
                   p.ImagePath AS ProductImagePath
            FROM OrderItems oi
            LEFT JOIN Products p ON p.ProductId = oi.ProductId
            WHERE oi.OrderId = @OrderId
            ORDER BY oi.LineNumber", new { OrderId = orderId })).ToList();

        var summary = await GetLeadOrderSummaryAsync(order.LeadId);

        return new OrderDetailDto(
            OrderId:          order.OrderId,
            OrderNumber:      order.OrderNumber,
            LeadId:           order.LeadId,
            LeadName:         order.LeadName,
            LeadCompanyName:  order.LeadCompanyName,
            LeadPhone:        order.LeadPhone,
            ExhibitionId:     order.ExhibitionId,
            ExhibitionName:   order.ExhibitionName,
            StatusCode:       order.StatusCode,
            OrderTotal:       order.OrderTotal,
            OrderValue:       order.OrderValue,
            EffectiveValue:   order.OrderValue ?? order.OrderTotal,
            SlabBand:         order.SlabBand,
            AdvanceAmount:    order.AdvanceAmount,
            SuggestedAdvance: AdvanceCalculator.SuggestedAdvance(order.SlabBand),
            OrderCoupons:     AdvanceCalculator.CouponsForAdvance(order.AdvanceAmount),
            Notes:            order.Notes,
            SoPdfPath:        order.SoPdfPath,
            ConfirmedAt:      order.ConfirmedAt,
            CreatedAt:        order.CreatedAt,
            Items:            items,
            LeadSummary:      summary);
    }

    public async Task<int> CreateOrderAsync(CreateOrderRequest request, int? employeeId)
    {
        if (request.Items == null || request.Items.Count == 0)
            throw new ArgumentException("An order needs at least one item");

        using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        var exhibitionId = await conn.ExecuteScalarAsync<int?>(
            "SELECT ExhibitionId FROM Leads WHERE LeadId = @LeadId", new { request.LeadId });

        using var tx = conn.BeginTransaction();
        try
        {
            var seq = await conn.ExecuteScalarAsync<int>(
                "SELECT NEXT VALUE FOR dbo.OrderNumberSequence", transaction: tx);
            var orderNumber = $"SO-{DateTime.UtcNow:yyyyMM}-{seq:D5}";

            var orderId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO Orders (OrderNumber, LeadId, ExhibitionId, StatusCode,
                                    OrderTotal, SlabBand, AdvanceAmount, Notes,
                                    CreatedByEmployeeId, CreatedAt)
                OUTPUT INSERTED.OrderId
                VALUES (@OrderNumber, @LeadId, @ExhibitionId, 'draft',
                        0, 0, 0, @Notes, @EmployeeId, GETUTCDATE())",
                new
                {
                    OrderNumber = orderNumber,
                    request.LeadId,
                    ExhibitionId = exhibitionId,
                    request.Notes,
                    EmployeeId = employeeId
                }, tx);

            await ReplaceItemsAsync(conn, tx, orderId, request.Items);

            tx.Commit();
            _logger.LogInformation("Created order {OrderNumber} ({OrderId}) for lead {LeadId}",
                orderNumber, orderId, request.LeadId);
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

        var exists = await conn.ExecuteScalarAsync<int?>(
            "SELECT OrderId FROM Orders WHERE OrderId = @OrderId", new { OrderId = orderId });
        if (exists == null)
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
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    public async Task SetOrderPaymentAsync(int orderId, SetOrderPaymentRequest request)
    {
        if (request.SlabBand < 0)
            throw new ArgumentException("Slab cannot be negative");
        if (request.AdvanceAmount < 0m)
            throw new ArgumentException("Advance cannot be negative");
        if (request.OrderValue is < 0m)
            throw new ArgumentException("Order value cannot be negative");

        using var conn = _db.CreateConnection();
        var rows = await conn.ExecuteAsync(@"
            UPDATE Orders
            SET SlabBand      = @SlabBand,
                OrderValue    = @OrderValue,
                AdvanceAmount = @AdvanceAmount,
                UpdatedAt     = GETUTCDATE()
            WHERE OrderId = @OrderId",
            new
            {
                request.SlabBand,
                request.OrderValue,
                request.AdvanceAmount,
                OrderId = orderId
            });

        if (rows == 0)
            throw new KeyNotFoundException($"Order {orderId} not found");

        _logger.LogInformation(
            "Order {OrderId} payment set: slab {Slab}, value {Value}, advance {Advance}",
            orderId, request.SlabBand, request.OrderValue, request.AdvanceAmount);
    }

    public async Task DeleteOrderAsync(int orderId)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            "DELETE FROM Orders WHERE OrderId = @OrderId", new { OrderId = orderId });
        if (rows == 0)
            throw new KeyNotFoundException($"Order {orderId} not found");
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
    }

    public async Task<LeadOrderSummaryDto> GetLeadOrderSummaryAsync(int leadId)
    {
        using var conn = _db.CreateConnection();

        var agg = await conn.QueryFirstOrDefaultAsync<LeadAggregate>($@"
            SELECT COUNT(*)                    AS OrderCount,
                   SUM({EffectiveValueSql})    AS TotalValue,
                   SUM(AdvanceAmount)          AS TotalAdvance
            FROM Orders
            WHERE LeadId = @LeadId AND {ActiveOnly}", new { LeadId = leadId });

        var pos = AdvanceCalculator.Calculate(agg?.TotalValue ?? 0m, agg?.TotalAdvance ?? 0m);

        return new LeadOrderSummaryDto(
            LeadId:       leadId,
            OrderCount:   agg?.OrderCount ?? 0,
            LeadTotal:    pos.TotalValue,
            TotalAdvance: pos.TotalAdvance,
            Slab:         pos.Slab,
            Coupons:      pos.Coupons,
            Balance:      pos.Balance,
            IsOverpaid:   pos.IsOverpaid);
    }

    public async Task SetSoPdfPathAsync(int orderId, string relativePath)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE Orders SET SoPdfPath = @Path, UpdatedAt = GETUTCDATE() WHERE OrderId = @OrderId",
            new { Path = relativePath, OrderId = orderId });
    }

    public async Task<OrderListResultDto> SearchOrdersAsync(OrderSearchParams p)
    {
        using var conn = _db.CreateConnection();

        var where = "WHERE 1=1";
        var args = new DynamicParameters();

        if (p.ExhibitionId.HasValue)
        {
            where += " AND o.ExhibitionId = @ExhibitionId";
            args.Add("ExhibitionId", p.ExhibitionId.Value);
        }
        if (!string.IsNullOrWhiteSpace(p.StatusCode))
        {
            where += " AND o.StatusCode = @StatusCode";
            args.Add("StatusCode", p.StatusCode);
        }
        if (p.FromDate.HasValue)
        {
            where += " AND o.CreatedAt >= @FromDate";
            args.Add("FromDate", p.FromDate.Value);
        }
        if (p.ToDate.HasValue)
        {
            where += " AND o.CreatedAt < @ToDate";
            args.Add("ToDate", p.ToDate.Value);
        }

        // One search box covers order number, lead name/company and barcode.
        // Barcode matters most: the ERP holds the catalogue and the cross-check
        // is manual, so "which order has SU-8842" has to be answerable here.
        if (!string.IsNullOrWhiteSpace(p.Search))
        {
            where += @" AND (
                o.OrderNumber LIKE @Search
                OR l.PrimaryVisitorName LIKE @Search
                OR l.CompanyName LIKE @Search
                OR EXISTS (SELECT 1 FROM OrderItems oi
                           WHERE oi.OrderId = o.OrderId AND oi.Barcode LIKE @Search)
            )";
            args.Add("Search", $"%{p.Search.Trim()}%");
        }

        var totalCount = await conn.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM Orders o JOIN Leads l ON l.LeadId = o.LeadId {where}", args);

        args.Add("Offset", p.Offset);
        args.Add("Limit", p.Limit);

        var orders = (await conn.QueryAsync<OrderListItemDto>($@"
            SELECT o.OrderId, o.OrderNumber, o.LeadId,
                   l.PrimaryVisitorName AS LeadName,
                   l.CompanyName        AS LeadCompanyName,
                   e.Name               AS ExhibitionName,
                   o.StatusCode,
                   {EffectiveValueSql}  AS EffectiveValue,
                   o.AdvanceAmount,
                   ISNULL(i.ItemCount, 0)   AS ItemCount,
                   ISNULL(i.TotalPieces, 0) AS TotalPieces,
                   o.SoPdfPath, o.CreatedAt
            FROM Orders o
            JOIN Leads l            ON l.LeadId = o.LeadId
            LEFT JOIN Exhibitions e ON e.ExhibitionId = o.ExhibitionId
            OUTER APPLY (
                SELECT COUNT(*) AS ItemCount, SUM(Pieces) AS TotalPieces
                FROM OrderItems WHERE OrderId = o.OrderId
            ) i
            {where}
            ORDER BY o.CreatedAt DESC
            OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY", args)).ToList();

        // Totals cover every row the filter matches, not just the current page.
        var totals = await conn.QueryFirstOrDefaultAsync<LeadAggregate>($@"
            SELECT COUNT(*)                 AS OrderCount,
                   SUM({EffectiveValueSql}) AS TotalValue,
                   SUM(o.AdvanceAmount)     AS TotalAdvance
            FROM Orders o JOIN Leads l ON l.LeadId = o.LeadId
            {where} AND o.{ActiveOnly}", args);

        // Coupons are a lead-level figure — summing per order would over-count,
        // because two ₹6k advances earn 4 coupons together and 0 apiece.
        var perLead = await conn.QueryAsync<decimal>($@"
            SELECT SUM(o.AdvanceAmount)
            FROM Orders o JOIN Leads l ON l.LeadId = o.LeadId
            {where} AND o.{ActiveOnly}
            GROUP BY o.LeadId", args);

        var couponTotal = perLead.Sum(AdvanceCalculator.CouponsForAdvance);

        return new OrderListResultDto(
            Orders: orders,
            TotalCount: totalCount,
            Totals: new OrderListTotalsDto(
                OrderCount:   totals?.OrderCount ?? 0,
                TotalValue:   totals?.TotalValue ?? 0m,
                TotalAdvance: totals?.TotalAdvance ?? 0m,
                TotalCoupons: couponTotal));
    }

    public async Task<List<CouponHolderDto>> GetCouponHoldersAsync(int? exhibitionId)
    {
        using var conn = _db.CreateConnection();

        var filter = exhibitionId.HasValue ? " AND o.ExhibitionId = @ExhibitionId" : "";

        var rows = (await conn.QueryAsync<CouponHolderRow>($@"
            SELECT o.LeadId,
                   l.PrimaryVisitorName  AS LeadName,
                   l.CompanyName         AS CompanyName,
                   l.PrimaryVisitorPhone AS Phone,
                   SUM({EffectiveValueSql}) AS TotalValue,
                   SUM(o.AdvanceAmount)     AS TotalAdvance,
                   COUNT(*)                 AS OrderCount
            FROM Orders o
            JOIN Leads l ON l.LeadId = o.LeadId
            WHERE o.{ActiveOnly}{filter}
            GROUP BY o.LeadId, l.PrimaryVisitorName, l.CompanyName, l.PrimaryVisitorPhone",
            new { ExhibitionId = exhibitionId })).ToList();

        return rows
            .Select(r => new CouponHolderDto(
                LeadId:       r.LeadId,
                LeadName:     r.LeadName,
                CompanyName:  r.CompanyName,
                Phone:        r.Phone,
                TotalValue:   r.TotalValue,
                TotalAdvance: r.TotalAdvance,
                Coupons:      AdvanceCalculator.CouponsForAdvance(r.TotalAdvance),
                OrderCount:   r.OrderCount))
            .Where(c => c.Coupons > 0)
            .OrderByDescending(c => c.Coupons)
            .ThenByDescending(c => c.TotalAdvance)
            .ToList();
    }

    private sealed class CouponHolderRow
    {
        public int LeadId { get; set; }
        public string? LeadName { get; set; }
        public string? CompanyName { get; set; }
        public string? Phone { get; set; }
        public decimal TotalValue { get; set; }
        public decimal TotalAdvance { get; set; }
        public int OrderCount { get; set; }
    }

    /// <summary>
    /// Replaces an order's lines and re-derives OrderTotal.
    /// Amount is always Rate × Pieces server-side — never taken from the client —
    /// and stays NULL when the line carries no rate.
    /// </summary>
    private static async Task ReplaceItemsAsync(
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
            if (string.IsNullOrWhiteSpace(item.ItemType))
                throw new ArgumentException($"Line {lineNo}: item type is required");
            if (item.Pieces <= 0)
                throw new ArgumentException($"Line {lineNo}: pieces must be greater than zero");
            if (item.Rate is < 0m)
                throw new ArgumentException($"Line {lineNo}: rate cannot be negative");

            // When the line came from a scanned product, the catalogue is the
            // authority: re-read it server-side rather than trusting details the
            // client sent, and snapshot them onto the line so editing the product
            // later cannot rewrite this order's history.
            var line = item;
            if (item.ProductId.HasValue)
            {
                var product = await conn.QueryFirstOrDefaultAsync<Models.Product>(
                    "SELECT * FROM Products WHERE ProductId = @Id",
                    new { Id = item.ProductId.Value }, tx);

                if (product != null)
                {
                    line = item with
                    {
                        ItemType      = product.ProductType,
                        Category      = product.Category,
                        Barcode       = product.Barcode,
                        Size          = product.Size ?? item.Size,
                        Colour        = product.Colour ?? item.Colour,
                        Fabric        = product.Fabric,
                        Rate          = item.Rate ?? product.Price,
                    };
                }
            }

            decimal? amount = line.Rate.HasValue
                ? decimal.Round(line.Rate.Value * line.Pieces, 2, MidpointRounding.AwayFromZero)
                : null;
            total += amount ?? 0m;

            await conn.ExecuteAsync(@"
                INSERT INTO OrderItems (OrderId, LineNumber, ItemType, Category, Barcode, Size,
                                        Colour, Fabric, Pieces, Rate, Amount, Customization, ProductId)
                VALUES (@OrderId, @LineNumber, @ItemType, @Category, @Barcode, @Size,
                        @Colour, @Fabric, @Pieces, @Rate, @Amount, @Customization, @ProductId)",
                new
                {
                    OrderId = orderId,
                    LineNumber = lineNo,
                    ItemType = line.ItemType.Trim(),
                    line.Category,
                    line.Barcode,
                    line.Size,
                    line.Colour,
                    line.Fabric,
                    line.Pieces,
                    line.Rate,
                    Amount = amount,
                    line.Customization,
                    line.ProductId
                }, tx);

            lineNo++;
        }

        await conn.ExecuteAsync(
            "UPDATE Orders SET OrderTotal = @Total, UpdatedAt = GETUTCDATE() WHERE OrderId = @OrderId",
            new { Total = total, OrderId = orderId }, tx);
    }
}

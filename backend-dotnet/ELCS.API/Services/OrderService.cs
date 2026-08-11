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
                   l.PrimaryVisitorEmail AS LeadEmail,
                   l.GstNumber           AS LeadGstNumber,
                   JSON_VALUE(l.Addresses, '$[0].address') AS LeadAddress,
                   JSON_VALUE(l.Addresses, '$[0].city')    AS LeadCity,
                   JSON_VALUE(l.Addresses, '$[0].state')   AS LeadState,
                   e.Name                AS ExhibitionName
            FROM Orders o
            JOIN Leads l            ON l.LeadId = o.LeadId
            LEFT JOIN Exhibitions e ON e.ExhibitionId = o.ExhibitionId
            WHERE o.OrderId = @OrderId", new { OrderId = orderId });

        if (order == null) return null;

        var items = (await conn.QueryAsync<OrderItemDto>(@"
            SELECT oi.OrderItemId, oi.LineNumber, oi.Barcode,
                   oi.Size, oi.Colour, oi.Fabric, oi.Pieces, oi.Rate, oi.Amount,
                   oi.Customization, oi.ProductId,
                   p.ImagePath AS ProductImagePath,
                   p.ImageUrl  AS ProductImageUrl
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
            LeadEmail:        order.LeadEmail,
            LeadGstNumber:    order.LeadGstNumber,
            LeadAddress:      order.LeadAddress,
            LeadCity:         order.LeadCity,
            LeadState:        order.LeadState,
            ExhibitionId:     order.ExhibitionId,
            ExhibitionName:   order.ExhibitionName,
            StatusCode:       order.StatusCode,
            OrderTotal:       order.OrderTotal,
            OrderValue:       order.OrderValue,
            EffectiveValue:   order.OrderValue ?? order.OrderTotal,
            SlabBand:         order.SlabBand,
            AdvanceAmount:    order.AdvanceAmount,
            SuggestedAdvance: AdvanceCalculator.SuggestedAdvance(order.SlabBand),
            OrderCoupons:     AdvanceCalculator.CouponsFor(
                                  order.OrderValue ?? order.OrderTotal, order.AdvanceAmount),
            Notes:            order.Notes,
            SoPdfPath:        order.SoPdfPath,
            PaymentProofPath: order.PaymentProofPath,
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

        var status = await conn.ExecuteScalarAsync<string?>(
            "SELECT StatusCode FROM Orders WHERE OrderId = @OrderId", new { OrderId = orderId });
        if (status == null)
            throw new KeyNotFoundException($"Order {orderId} not found");

        // Lines are only editable while the order is a draft. Once it is
        // confirmed a Sales Order PDF has been issued and very likely handed
        // over, so rewriting the lines would leave the customer holding a
        // document that no longer matches what is recorded — and it would move
        // the order value, hence the slab, hence the coupons they were promised.
        if (request.Items is { Count: > 0 } && !string.Equals(status, "draft", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"This order is {status} — its items can no longer be changed. Cancel it and raise a new one.");

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

        // An advance above the order's value is money the customer does not owe
        // on this order. Checked here rather than only in the browser because it
        // feeds the coupon count, and coupons are an entitlement — an advance
        // typed with an extra zero would hand out lucky-draw entries that were
        // never paid for.
        var storedValue = await conn.ExecuteScalarAsync<decimal?>(
            "SELECT COALESCE(OrderValue, OrderTotal) FROM Orders WHERE OrderId = @OrderId",
            new { OrderId = orderId });

        if (storedValue == null)
            throw new KeyNotFoundException($"Order {orderId} not found");

        // The request may be changing the value in the same call, so judge the
        // advance against whichever value this order is about to have.
        var effectiveValue = request.OrderValue ?? storedValue.Value;
        if (effectiveValue > 0m && request.AdvanceAmount > effectiveValue)
            throw new ArgumentException(
                $"Advance of {request.AdvanceAmount:N2} is more than the order value of {effectiveValue:N2}");

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

        // An admin override REPLACES the earned figure, it does not add to it —
        // see ILeadService.SetCouponOverrideAsync.
        var overrideSlab = await conn.ExecuteScalarAsync<int?>(
            "SELECT CouponOverrideSlab FROM Leads WHERE LeadId = @LeadId", new { LeadId = leadId });
        var coupons = overrideSlab.HasValue ? AdvanceCalculator.CouponsForSlab(overrideSlab.Value) : pos.Coupons;

        return new LeadOrderSummaryDto(
            LeadId:       leadId,
            OrderCount:   agg?.OrderCount ?? 0,
            LeadTotal:    pos.TotalValue,
            TotalAdvance: pos.TotalAdvance,
            Slab:         pos.Slab,
            Coupons:      coupons,
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

    public async Task SetPaymentProofPathAsync(int orderId, string relativePath)
    {
        using var conn = _db.CreateConnection();
        // Unlike SetSoPdfPathAsync (called only with an id this process just
        // created), this is reached directly from an upload endpoint with a
        // caller-supplied id — checked so a bad id 404s instead of writing a
        // file that nothing will ever be able to find again.
        var rows = await conn.ExecuteAsync(
            "UPDATE Orders SET PaymentProofPath = @Path, UpdatedAt = GETUTCDATE() WHERE OrderId = @OrderId",
            new { Path = relativePath, OrderId = orderId });

        if (rows == 0)
            throw new KeyNotFoundException($"Order {orderId} not found");
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
        if (!string.IsNullOrWhiteSpace(p.Source))
        {
            where += " AND o.Source = @Source";
            args.Add("Source", p.Source);
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
                   l.PrimaryVisitorName  AS LeadName,
                   l.CompanyName         AS LeadCompanyName,
                   l.PrimaryVisitorPhone AS LeadPhone,
                   e.Name                AS ExhibitionName,
                   o.StatusCode,
                   o.Source,
                   {EffectiveValueSql}   AS EffectiveValue,
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
        // Value AND advance per lead: coupons need both, so summing advance
        // alone would over-count every lead holding under ₹1L of orders.
        //
        // An override REPLACES the earned figure for its lead (see
        // GetCouponHoldersAsync). Not reflected here for a lead with an
        // override but NO order matching the current filter — this tile is
        // rooted at Orders so it can honour the date/status/source filters,
        // and there is no order row to hang such a lead off. The Coupon
        // Holders list is the source of truth for those; this is a filtered
        // summary tile.
        var perLead = await conn.QueryAsync<(int LeadId, decimal Value, decimal Advance, int? OverrideSlab)>($@"
            SELECT o.LeadId, SUM({EffectiveValueSql}) AS Value, SUM(o.AdvanceAmount) AS Advance,
                   l.CouponOverrideSlab AS OverrideSlab
            FROM Orders o JOIN Leads l ON l.LeadId = o.LeadId
            {where} AND o.{ActiveOnly}
            GROUP BY o.LeadId, l.CouponOverrideSlab", args);

        var couponTotal = perLead.Sum(r => r.OverrideSlab.HasValue
            ? AdvanceCalculator.CouponsForSlab(r.OverrideSlab.Value)
            : AdvanceCalculator.CouponsFor(r.Value, r.Advance));

        // Counted across the whole database, not the current filter: this is the
        // work queue, and it should not disappear because someone filtered by a
        // different exhibition.
        var pendingSelfService = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM Orders WHERE Source = 'self_service' AND StatusCode = 'draft'");

        return new OrderListResultDto(
            Orders: orders,
            TotalCount: totalCount,
            Totals: new OrderListTotalsDto(
                OrderCount:         totals?.OrderCount ?? 0,
                TotalValue:         totals?.TotalValue ?? 0m,
                TotalAdvance:       totals?.TotalAdvance ?? 0m,
                TotalCoupons:       couponTotal,
                PendingSelfService: pendingSelfService));
    }

    public async Task<List<CouponHolderDto>> GetCouponHoldersAsync(int? exhibitionId)
    {
        using var conn = _db.CreateConnection();

        // LEFT JOIN from Leads, not INNER JOIN from Orders: an admin can grant
        // an override to a lead that has placed no order at all, and that lead
        // must still show up here. exhibitionId then has to filter on the
        // LEAD's exhibition (every lead has exactly one), not the order's —
        // an override-only lead has no order row to filter by.
        var filter = exhibitionId.HasValue ? " AND l.ExhibitionId = @ExhibitionId" : "";

        var rows = (await conn.QueryAsync<CouponHolderRow>($@"
            SELECT l.LeadId,
                   l.PrimaryVisitorName  AS LeadName,
                   l.CompanyName         AS CompanyName,
                   l.PrimaryVisitorPhone AS Phone,
                   l.CouponOverrideSlab  AS OverrideSlab,
                   ISNULL(SUM({EffectiveValueSql}), 0) AS TotalValue,
                   ISNULL(SUM(o.AdvanceAmount), 0)     AS TotalAdvance,
                   COUNT(o.OrderId)                    AS OrderCount
            FROM Leads l
            LEFT JOIN Orders o ON o.LeadId = l.LeadId AND o.{ActiveOnly}
            WHERE 1 = 1{filter}
            GROUP BY l.LeadId, l.PrimaryVisitorName, l.CompanyName, l.PrimaryVisitorPhone, l.CouponOverrideSlab",
            new { ExhibitionId = exhibitionId })).ToList();

        return rows
            .Select(r => new CouponHolderDto(
                LeadId:       r.LeadId,
                LeadName:     r.LeadName,
                CompanyName:  r.CompanyName,
                Phone:        r.Phone,
                TotalValue:   r.TotalValue,
                TotalAdvance: r.TotalAdvance,
                Coupons:      r.OverrideSlab.HasValue
                                  ? AdvanceCalculator.CouponsForSlab(r.OverrideSlab.Value)
                                  : AdvanceCalculator.CouponsFor(r.TotalValue, r.TotalAdvance),
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
        public int? OverrideSlab { get; set; }
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
            if (item.Pieces <= 0)
                throw new ArgumentException($"Line {lineNo}: pieces must be greater than zero");
            if (item.Rate is < 0m)
                throw new ArgumentException($"Line {lineNo}: rate cannot be negative");

            // When the line came from a scanned product, the catalogue is the
            // authority for what the DESIGN is — barcode, fabric, price — so
            // those are re-read server-side rather than trusted from the client
            // and snapshotted here, and editing the product later cannot rewrite
            // this order's history.
            //
            // Size and colour are NOT design attributes: they are the choice
            // this line represents. Taking them from the product overwrote every
            // line with the design's whole list, so "one M in Grey" was stored
            // as "M, L, XL, 2XL" in "Grey, Mouse" — identical on every line of
            // the design, unusable for picking or packing, and wrong on the
            // Sales Order. The line's own values win; the product is only a
            // fallback for a line that named neither.
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
                        Barcode       = product.Barcode,
                        Size          = item.Size   ?? product.Size,
                        Colour        = item.Colour ?? product.Colour,
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
                INSERT INTO OrderItems (OrderId, LineNumber, Barcode, Size,
                                        Colour, Fabric, Pieces, Rate, Amount, Customization, ProductId)
                VALUES (@OrderId, @LineNumber, @Barcode, @Size,
                        @Colour, @Fabric, @Pieces, @Rate, @Amount, @Customization, @ProductId)",
                new
                {
                    OrderId = orderId,
                    LineNumber = lineNo,
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

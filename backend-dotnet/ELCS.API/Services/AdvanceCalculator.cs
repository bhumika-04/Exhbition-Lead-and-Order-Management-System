namespace ELCS.API.Services;

/// <summary>
/// Advance payment + lucky-draw coupon rules.
///
/// Coupons follow the money ACTUALLY TAKEN, not the order value. A lead may
/// hold ₹2.5 L of orders and pay only ₹11,000 advance — that earns 4 coupons,
/// not 8. So:
///
///   coupons = 4 × floor(totalAdvance / ₹11,000)
///
/// The order-value slab only SUGGESTS an advance, which the operator may then
/// edit:
///
///   suggestedAdvance = ₹11,000 × slab
///
///   slab 1 (₹1L–₹2L) → suggests ₹11,000 →  4 coupons if paid in full
///   slab 2 (₹2L–₹3L) → suggests ₹22,000 →  8 coupons if paid in full
///   slab 3 (₹3L–₹4L) → suggests ₹33,000 → 12 coupons if paid in full
///
/// and onward without a ceiling. Slab 0 (below ₹1L) suggests nothing; whatever
/// advance is agreed is entered by hand and earns coupons on the same rule —
/// which is why an under-₹1L lead who pays ₹11,000 still gets 4.
///
/// Advance is accumulated across all the lead's non-cancelled orders before
/// the coupon calculation, so two part-payments of ₹6,000 together earn 4
/// coupons rather than nothing.
/// </summary>
public static class AdvanceCalculator
{
    public const decimal SlabSize       = 100_000m;   // order-value band width
    public const decimal AdvancePerSlab =  11_000m;   // suggested advance per slab
    public const int     CouponsPerUnit =       4;    // coupons per AdvancePerSlab paid

    /// <summary>Slab an order value falls into. Exact multiples land in the upper slab.</summary>
    public static int SlabForValue(decimal orderValue) =>
        orderValue <= 0m ? 0 : (int)decimal.Floor(orderValue / SlabSize);

    /// <summary>Advance suggested by a slab. Slab 0 suggests nothing — it is agreed by hand.</summary>
    public static decimal SuggestedAdvance(int slab) =>
        slab <= 0 ? 0m : AdvancePerSlab * slab;

    /// <summary>Coupons earned by an advance actually paid.</summary>
    public static int CouponsForAdvance(decimal totalAdvance) =>
        totalAdvance < AdvancePerSlab
            ? 0
            : (int)decimal.Floor(totalAdvance / AdvancePerSlab) * CouponsPerUnit;

    /// <summary>
    /// A lead's full position.
    /// </summary>
    /// <param name="totalValue">Combined value of the lead's non-cancelled orders.</param>
    /// <param name="totalAdvance">Combined advance actually taken across those orders.</param>
    public static LeadMoneyPosition Calculate(decimal totalValue, decimal totalAdvance)
    {
        if (totalValue < 0m)   totalValue   = 0m;
        if (totalAdvance < 0m) totalAdvance = 0m;

        var coupons = CouponsForAdvance(totalAdvance);

        // An advance larger than the order value is a data-entry error, not a
        // negative balance. Report the balance floored at zero and flag it so
        // the UI can surface the overpayment rather than hide it.
        var overpaid = totalAdvance > totalValue;
        var balance  = overpaid ? 0m : totalValue - totalAdvance;

        return new LeadMoneyPosition(
            TotalValue:   totalValue,
            TotalAdvance: totalAdvance,
            Slab:         SlabForValue(totalValue),
            Coupons:      coupons,
            Balance:      balance,
            IsOverpaid:   overpaid);
    }
}

/// <param name="TotalValue">Combined value of the lead's non-cancelled orders.</param>
/// <param name="TotalAdvance">Combined advance actually taken.</param>
/// <param name="Slab">Slab the combined value falls into — informational.</param>
/// <param name="Coupons">Lucky-draw entries earned. Never shown on the Sales Order.</param>
/// <param name="Balance">Total value − total advance, floored at zero.</param>
/// <param name="IsOverpaid">Advance exceeds the order value — almost certainly a typo.</param>
public record LeadMoneyPosition(
    decimal TotalValue,
    decimal TotalAdvance,
    int     Slab,
    int     Coupons,
    decimal Balance,
    bool    IsOverpaid);

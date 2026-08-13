namespace ELCS.API.Services;

/// <summary>
/// Advance payment + lucky-draw coupon rules.
///
/// A coupon needs BOTH sides of the promotion to be met:
///
///   • order value of at least ₹1,00,000  (one slab), AND
///   • advance of at least ₹11,000
///
///   coupons = 4 × min( floor(value / ₹1,00,000), floor(advance / ₹11,000) )
///
///   ₹1L  order + ₹11,000 advance →  4 coupons
///   ₹2L  order + ₹22,000 advance →  8 coupons
///   ₹4L  order + ₹44,000 advance → 16 coupons
///
/// Both limits matter, and each is there for a reason:
///
///   ₹50,000 order + ₹11,000 advance →  0 — under ₹1L earns nothing, however
///                                       much is paid against it.
///   ₹2.5L   order + ₹11,000 advance →  4 — the advance is the limiter, so a
///                                       big order paid lightly earns one unit.
///   ₹1L     order + ₹44,000 advance →  4 — the VALUE is the limiter, so
///                                       overpaying cannot farm coupons.
///
/// The slab also SUGGESTS an advance, which the operator may edit:
/// suggestedAdvance = ₹11,000 × slab. Slab 0 suggests nothing.
///
/// Value and advance are both accumulated across the lead's non-cancelled
/// orders before this runs, so two ₹6,000 part-payments against a ₹1L order
/// together earn 4 coupons rather than nothing.
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

    /// <summary>
    /// Coupons earned, gated by BOTH the order value and the advance paid.
    /// Whichever side has fewer complete units decides the count.
    /// </summary>
    public static int CouponsFor(decimal totalValue, decimal totalAdvance)
    {
        if (totalValue < SlabSize || totalAdvance < AdvancePerSlab) return 0;

        var valueUnits   = (int)decimal.Floor(totalValue / SlabSize);
        var advanceUnits = (int)decimal.Floor(totalAdvance / AdvancePerSlab);

        return Math.Min(valueUnits, advanceUnits) * CouponsPerUnit;
    }

    /// <summary>
    /// Coupons a slab's suggested advance would earn if paid in full — used to
    /// label the slab options. By construction value and advance units match
    /// here, so the minimum is the slab itself.
    /// </summary>
    public static int CouponsForSlab(int slab) =>
        slab <= 0 ? 0 : slab * CouponsPerUnit;

    /// <summary>
    /// Silver Coupon Module: one coupon per ₹1L of order VALUE, no advance
    /// requirement — separate rule and separate pool from the lucky-draw
    /// coupons above.
    ///
    ///   ₹1L–₹2L  → 1 coupon
    ///   ₹2L–₹3L  → 2 coupons
    ///   ₹99,999  → 0 (under ₹1L earns nothing)
    /// </summary>
    public static int SilverCouponsFor(decimal totalValue) =>
        totalValue < SlabSize ? 0 : (int)decimal.Floor(totalValue / SlabSize);

    /// <summary>
    /// A lead's full position.
    /// </summary>
    /// <param name="totalValue">Combined value of the lead's non-cancelled orders.</param>
    /// <param name="totalAdvance">Combined advance actually taken across those orders.</param>
    public static LeadMoneyPosition Calculate(decimal totalValue, decimal totalAdvance)
    {
        if (totalValue < 0m)   totalValue   = 0m;
        if (totalAdvance < 0m) totalAdvance = 0m;

        var coupons = CouponsFor(totalValue, totalAdvance);

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

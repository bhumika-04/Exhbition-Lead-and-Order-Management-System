namespace ELCS.API.Services;

/// <summary>
/// Advance payment + lucky-draw coupon rules.
///
/// Both are a function of the lead's TOTAL order value across all their
/// non-cancelled orders — not of any single order. Adding a second order
/// re-bands the lead, which is why nothing here is persisted.
///
///   band    = floor(total / 1,00,000)
///   advance = ₹11,000 × band
///   coupons = 4 × band
///
///   ₹1L–₹2L → ₹11,000 /  4 coupons
///   ₹2L–₹3L → ₹22,000 /  8 coupons
///   ₹3L–₹4L → ₹33,000 / 12 coupons
///   and onward without a ceiling: ₹4L–₹5L → ₹44,000 / 16 coupons.
///
/// Below ₹1L there is no band: no coupons, and the advance is whatever the
/// operator agreed with the customer (<paramref name="manualAdvance"/>).
///
/// Exact multiples fall in the UPPER band, which is what floor gives:
/// ₹2,00,000 → band 2 → ₹22,000 / 8 coupons.
/// </summary>
public static class AdvanceCalculator
{
    public const decimal BandSize       = 100_000m;
    public const decimal AdvancePerBand =  11_000m;
    public const int     CouponsPerBand =       4;

    public static AdvanceBreakdown Calculate(decimal leadTotal, decimal? manualAdvance = null)
    {
        if (leadTotal <= 0m)
            return new AdvanceBreakdown(0m, 0, 0m, 0, 0m, false);

        var band = (int)decimal.Floor(leadTotal / BandSize);

        // Below ₹1L — operator-defined advance, no coupons.
        if (band <= 0)
        {
            var manual = manualAdvance ?? 0m;
            if (manual < 0m)        manual = 0m;
            if (manual > leadTotal) manual = leadTotal;   // never advance more than the order
            return new AdvanceBreakdown(leadTotal, 0, manual, 0, leadTotal - manual, true);
        }

        var advance = AdvancePerBand * band;

        // Guard: the banded advance can only exceed the total through a rule
        // change (e.g. a much larger AdvancePerBand). Clamp so balance is never
        // negative rather than emitting a nonsensical Sales Order.
        if (advance > leadTotal) advance = leadTotal;

        return new AdvanceBreakdown(
            Total:          leadTotal,
            Band:           band,
            Advance:        advance,
            Coupons:        CouponsPerBand * band,
            Balance:        leadTotal - advance,
            IsManualAdvance: false);
    }
}

/// <param name="Total">Lead's combined value across all non-cancelled orders.</param>
/// <param name="Band">floor(total / 1L). 0 means below the first band.</param>
/// <param name="Advance">Advance payable.</param>
/// <param name="Coupons">Lucky-draw entries earned. Never shown on the Sales Order.</param>
/// <param name="Balance">Total − advance.</param>
/// <param name="IsManualAdvance">True when the advance came from operator entry rather than the band rule.</param>
public record AdvanceBreakdown(
    decimal Total,
    int     Band,
    decimal Advance,
    int     Coupons,
    decimal Balance,
    bool    IsManualAdvance);

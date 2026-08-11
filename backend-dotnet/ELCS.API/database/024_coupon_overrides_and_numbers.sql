/* ============================================================================
   024_coupon_overrides_and_numbers.sql

   Two additions to dbo.Leads, both nullable so an unrun migration merely means
   "no override / no numbers recorded" rather than breaking existing reads:

     CouponOverrideSlab  Admin-set slab that REPLACES the earned calculation
                          (AdvanceCalculator.CouponsFor) for this lead. NULL
                          means "no override — use advance actually taken",
                          which is every lead until an admin sets one.

     CouponNumbers        JSON array of the physical coupon numbers handed to
                          this lead, e.g. ["A-102","A-103"]. Same shape as the
                          existing PhoneNumbers / Websites columns on this
                          table — a flat JSON list, read and written with
                          System.Text.Json rather than a child table, because
                          nothing here is ever queried by number except the
                          cross-lead duplicate check done in application code.

   Idempotent: safe to run against a database that already has either column.
   ============================================================================ */

SET NOCOUNT ON;

IF OBJECT_ID('dbo.Leads', 'U') IS NULL
BEGIN
    RAISERROR('dbo.Leads does not exist — run the base schema first.', 16, 1);
    RETURN;
END

IF COL_LENGTH('dbo.Leads', 'CouponOverrideSlab') IS NULL
BEGIN
    ALTER TABLE dbo.Leads ADD CouponOverrideSlab INT NULL;
    PRINT 'Added dbo.Leads.CouponOverrideSlab';
END
ELSE
    PRINT 'dbo.Leads.CouponOverrideSlab already present';
GO

IF COL_LENGTH('dbo.Leads', 'CouponNumbers') IS NULL
BEGIN
    ALTER TABLE dbo.Leads ADD CouponNumbers NVARCHAR(MAX) NULL;
    PRINT 'Added dbo.Leads.CouponNumbers';
END
ELSE
    PRINT 'dbo.Leads.CouponNumbers already present';
GO

/* ============================================================================
   016_order_advance_and_media.sql

   Revises the advance/coupon model and adds lead media.

   ADVANCE/COUPON CHANGE
   ---------------------
   015 derived both advance and coupons from the order value. That was wrong:
   a lead may hold ₹2.5 L of orders and pay only ₹11 k advance, and coupons
   follow the money actually taken.

     - Advance is now RECORDED per order (operator-editable), not derived.
     - The order-value slab only SUGGESTS an advance (₹11,000 × slab).
     - Coupons are derived from the lead's TOTAL advance across all
       non-cancelled orders:  coupons = 4 × floor(totalAdvance / 11,000)

   Item rate becomes OPTIONAL — the order value can come from the slab alone,
   so a counter operator need not price every line.

   Run AFTER 015.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

/* ---------------------------------------------------------------------------
   1. Per-order advance + chosen slab
   --------------------------------------------------------------------------- */
IF COL_LENGTH('dbo.Orders', 'AdvanceAmount') IS NULL
    ALTER TABLE dbo.Orders ADD AdvanceAmount DECIMAL(18,2) NOT NULL
        CONSTRAINT DF_Orders_Advance DEFAULT (0);

IF COL_LENGTH('dbo.Orders', 'SlabBand') IS NULL
    ALTER TABLE dbo.Orders ADD SlabBand INT NOT NULL
        CONSTRAINT DF_Orders_SlabBand DEFAULT (0);

-- Exact order value when known (typed, or summed from item rates).
-- NULL means "only the slab is known".
IF COL_LENGTH('dbo.Orders', 'OrderValue') IS NULL
    ALTER TABLE dbo.Orders ADD OrderValue DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Orders_Advance')
    ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_Advance CHECK (AdvanceAmount >= 0);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Orders_SlabBand')
    ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_SlabBand CHECK (SlabBand >= 0);
GO

/* ---------------------------------------------------------------------------
   2. Item rate becomes optional
      Drop the CHECK constraints first — they reject NULL comparisons oddly and
      must be recreated to tolerate an unpriced line.
   --------------------------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrderItems_Rate')
    ALTER TABLE dbo.OrderItems DROP CONSTRAINT CK_OrderItems_Rate;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OrderItems_Amount')
    ALTER TABLE dbo.OrderItems DROP CONSTRAINT CK_OrderItems_Amount;
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_OrderItems_Rate')
    ALTER TABLE dbo.OrderItems DROP CONSTRAINT DF_OrderItems_Rate;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_OrderItems_Amt')
    ALTER TABLE dbo.OrderItems DROP CONSTRAINT DF_OrderItems_Amt;
GO

ALTER TABLE dbo.OrderItems ALTER COLUMN Rate   DECIMAL(18,2) NULL;
ALTER TABLE dbo.OrderItems ALTER COLUMN Amount DECIMAL(18,2) NULL;
GO

ALTER TABLE dbo.OrderItems ADD CONSTRAINT CK_OrderItems_Rate
    CHECK (Rate IS NULL OR Rate >= 0);
ALTER TABLE dbo.OrderItems ADD CONSTRAINT CK_OrderItems_Amount
    CHECK (Amount IS NULL OR Amount >= 0);
GO

/* ---------------------------------------------------------------------------
   3. Leads.ManualAdvanceAmount is superseded by Orders.AdvanceAmount
      Advance is now recorded against the order that collected it. Carry any
      existing value onto the lead's most recent order before dropping it.
   --------------------------------------------------------------------------- */
IF COL_LENGTH('dbo.Leads', 'ManualAdvanceAmount') IS NOT NULL
BEGIN
    UPDATE o
    SET o.AdvanceAmount = l.ManualAdvanceAmount
    FROM dbo.Orders o
    JOIN dbo.Leads  l ON l.LeadId = o.LeadId
    WHERE l.ManualAdvanceAmount IS NOT NULL
      AND o.OrderId = (
          SELECT TOP 1 OrderId FROM dbo.Orders
          WHERE LeadId = l.LeadId AND StatusCode <> 'cancelled'
          ORDER BY CreatedAt DESC);

    DECLARE @df NVARCHAR(200);
    SELECT @df = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.Leads') AND c.name = 'ManualAdvanceAmount';
    IF @df IS NOT NULL
        EXEC('ALTER TABLE dbo.Leads DROP CONSTRAINT ' + @df);

    ALTER TABLE dbo.Leads DROP COLUMN ManualAdvanceAmount;
END
GO

/* ---------------------------------------------------------------------------
   4. Team photos — one or many per lead, each either an uploaded file or a
      Drive link. A table rather than a column because a lead can have several.
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.LeadPhotos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.LeadPhotos
    (
        LeadPhotoId  INT            IDENTITY(1,1) NOT NULL,
        LeadId       INT            NOT NULL,
        SourceType   NVARCHAR(20)   NOT NULL,     -- file | link
        FilePath     NVARCHAR(500)  NULL,         -- relative to uploads/ when SourceType = 'file'
        ExternalUrl  NVARCHAR(1000) NULL,         -- Drive link when SourceType = 'link'
        Caption      NVARCHAR(300)  NULL,
        UploadedByEmployeeId INT    NULL,
        CreatedAt    DATETIME2(3)   NOT NULL
            CONSTRAINT DF_LeadPhotos_Created DEFAULT (GETUTCDATE()),

        CONSTRAINT PK_LeadPhotos      PRIMARY KEY CLUSTERED (LeadPhotoId),
        CONSTRAINT FK_LeadPhotos_Lead FOREIGN KEY (LeadId)
                                      REFERENCES dbo.Leads (LeadId) ON DELETE CASCADE,
        CONSTRAINT CK_LeadPhotos_Source CHECK (SourceType IN ('file','link')),
        -- Exactly one of the two must be populated for the row to mean anything
        CONSTRAINT CK_LeadPhotos_Target CHECK (
            (SourceType = 'file' AND FilePath    IS NOT NULL) OR
            (SourceType = 'link' AND ExternalUrl IS NOT NULL))
    );

    CREATE INDEX IX_LeadPhotos_LeadId ON dbo.LeadPhotos (LeadId);
END
GO

/* ---------------------------------------------------------------------------
   5. Testimonial — Drive link only, one per lead
   --------------------------------------------------------------------------- */
IF COL_LENGTH('dbo.Leads', 'TestimonialUrl') IS NULL
    ALTER TABLE dbo.Leads ADD TestimonialUrl NVARCHAR(1000) NULL;

IF COL_LENGTH('dbo.Leads', 'TestimonialAddedAt') IS NULL
    ALTER TABLE dbo.Leads ADD TestimonialAddedAt DATETIME2(3) NULL;
GO

/* ---------------------------------------------------------------------------
   6. App settings — Interakt template names, social links
      Interakt templates must be approved before they can send, and approved
      names change without a code release, so they live in the database rather
      than appsettings.json.
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppSettings
    (
        SettingKey   NVARCHAR(100)  NOT NULL,
        SettingValue NVARCHAR(MAX)  NULL,
        UpdatedAt    DATETIME2(3)   NOT NULL
            CONSTRAINT DF_AppSettings_Updated DEFAULT (GETUTCDATE()),
        CONSTRAINT PK_AppSettings PRIMARY KEY CLUSTERED (SettingKey)
    );

    INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES
        ('whatsapp.template.welcome',            NULL),
        ('whatsapp.template.order_confirmation', NULL),
        ('whatsapp.template.testimonial',        NULL),
        ('whatsapp.welcome.auto_send',           'true'),
        ('social.instagram',                     NULL),
        ('social.facebook',                      NULL),
        ('social.website',                       NULL),
        ('social.youtube',                       NULL);
END
GO

COMMIT TRANSACTION;
GO

/* ---------------------------------------------------------------------------
   Resulting money model
   ---------------------------------------------------------------------------
     Orders.SlabBand       operator's chosen order-value slab (0 = below ₹1L)
     Orders.OrderValue     exact value when known, else NULL
     Orders.OrderTotal     SUM(OrderItems.Amount) — 0 when lines are unpriced
     Orders.AdvanceAmount  advance actually taken (suggested as ₹11,000 × slab,
                           then editable)

     Per lead, across non-cancelled orders:
       totalAdvance = SUM(AdvanceAmount)
       coupons      = 4 * FLOOR(totalAdvance / 11000)
       totalValue   = SUM(COALESCE(OrderValue, OrderTotal))
       balance      = totalValue - totalAdvance
   --------------------------------------------------------------------------- */

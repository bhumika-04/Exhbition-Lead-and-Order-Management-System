/* ============================================================================
   015_add_order_management.sql

   Adds order placement for leads (spec sections B, C, D):
     B  Orders + line items (Suit / Lehenga / Saree), barcode, size, colour,
        pieces, customization, rate. Multiple orders per lead.
     C  Advance + lucky-draw coupons, derived from the lead's TOTAL order
        value across all their orders. No inventory; barcodes are recorded for
        manual cross-check against the ERP.
     D  Order confirmation: Sales Order PDF + WhatsApp message log.

   Run AFTER 014. Assumes the single-tenant schema (no TenantId).
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

/* ---------------------------------------------------------------------------
   1. Manual advance for sub-band totals
      Advance is derived (₹11,000 × band) once the lead's total reaches ₹1L.
      Below ₹1L there is no band, no coupons, and the advance is whatever the
      operator agrees with the customer — stored here. NULL = none taken.
   --------------------------------------------------------------------------- */
IF COL_LENGTH('dbo.Leads', 'ManualAdvanceAmount') IS NULL
    ALTER TABLE dbo.Leads ADD ManualAdvanceAmount DECIMAL(18,2) NULL;
GO

/* ---------------------------------------------------------------------------
   2. Order number sequence — race-safe, unlike MAX()+1
   --------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'OrderNumberSequence')
    CREATE SEQUENCE dbo.OrderNumberSequence AS INT START WITH 1 INCREMENT BY 1;
GO

/* ---------------------------------------------------------------------------
   3. Orders
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.Orders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Orders
    (
        OrderId         INT             IDENTITY(1,1) NOT NULL,
        OrderNumber     NVARCHAR(40)    NOT NULL,
        LeadId          INT             NOT NULL,
        ExhibitionId    INT             NULL,
        StatusCode      NVARCHAR(20)    NOT NULL CONSTRAINT DF_Orders_Status  DEFAULT ('draft'),
        OrderTotal      DECIMAL(18,2)   NOT NULL CONSTRAINT DF_Orders_Total   DEFAULT (0),
        Notes           NVARCHAR(MAX)   NULL,
        SoPdfPath       NVARCHAR(500)   NULL,
        ConfirmedAt     DATETIME2(3)    NULL,
        CreatedByEmployeeId INT         NULL,
        CreatedAt       DATETIME2(3)    NOT NULL CONSTRAINT DF_Orders_Created DEFAULT (GETUTCDATE()),
        UpdatedAt       DATETIME2(3)    NULL,

        CONSTRAINT PK_Orders          PRIMARY KEY CLUSTERED (OrderId),
        CONSTRAINT UQ_Orders_Number   UNIQUE (OrderNumber),
        CONSTRAINT FK_Orders_Lead     FOREIGN KEY (LeadId)
                                      REFERENCES dbo.Leads (LeadId) ON DELETE CASCADE,
        CONSTRAINT CK_Orders_Status   CHECK (StatusCode IN ('draft','confirmed','cancelled')),
        CONSTRAINT CK_Orders_Total    CHECK (OrderTotal >= 0)
    );

    CREATE INDEX IX_Orders_LeadId       ON dbo.Orders (LeadId);
    CREATE INDEX IX_Orders_ExhibitionId ON dbo.Orders (ExhibitionId);
    CREATE INDEX IX_Orders_CreatedAt    ON dbo.Orders (CreatedAt DESC);
END
GO

/* ---------------------------------------------------------------------------
   4. Order line items
      No inventory table: Barcode is free text, cross-checked manually against
      the ERP which holds the authoritative barcode catalogue.
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.OrderItems', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OrderItems
    (
        OrderItemId     INT             IDENTITY(1,1) NOT NULL,
        OrderId         INT             NOT NULL,
        -- NOT "LineNo": LINENO is a reserved T-SQL keyword and needs bracketing
        -- everywhere it appears, which one forgotten query would break.
        LineNumber      INT             NOT NULL CONSTRAINT DF_OrderItems_Line DEFAULT (1),
        ItemType        NVARCHAR(50)    NOT NULL,          -- Suit / Lehenga / Saree
        Barcode         NVARCHAR(100)   NULL,
        Size            NVARCHAR(50)    NULL,
        Colour          NVARCHAR(50)    NULL,
        Pieces          INT             NOT NULL CONSTRAINT DF_OrderItems_Pcs  DEFAULT (1),
        Rate            DECIMAL(18,2)   NOT NULL CONSTRAINT DF_OrderItems_Rate DEFAULT (0),
        Amount          DECIMAL(18,2)   NOT NULL CONSTRAINT DF_OrderItems_Amt  DEFAULT (0),
        Customization   NVARCHAR(MAX)   NULL,

        CONSTRAINT PK_OrderItems        PRIMARY KEY CLUSTERED (OrderItemId),
        CONSTRAINT FK_OrderItems_Order  FOREIGN KEY (OrderId)
                                        REFERENCES dbo.Orders (OrderId) ON DELETE CASCADE,
        CONSTRAINT CK_OrderItems_Pieces CHECK (Pieces > 0),
        CONSTRAINT CK_OrderItems_Rate   CHECK (Rate   >= 0),
        CONSTRAINT CK_OrderItems_Amount CHECK (Amount >= 0)
    );

    CREATE INDEX IX_OrderItems_OrderId ON dbo.OrderItems (OrderId);
    CREATE INDEX IX_OrderItems_Barcode ON dbo.OrderItems (Barcode);
END
GO

/* ---------------------------------------------------------------------------
   5. WhatsApp send log
      One row per outbound attempt across all three touchpoints (welcome,
      order confirmation, testimonial) so a failed send is visible and can be
      retried rather than silently lost.
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.WhatsAppMessages', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.WhatsAppMessages
    (
        WhatsAppMessageId INT           IDENTITY(1,1) NOT NULL,
        LeadId            INT           NOT NULL,
        OrderId           INT           NULL,
        Touchpoint        NVARCHAR(40)  NOT NULL,   -- welcome | order_confirmation | testimonial
        Recipient         NVARCHAR(30)  NULL,
        TemplateName      NVARCHAR(120) NULL,
        MediaUrl          NVARCHAR(1000) NULL,
        StatusCode        NVARCHAR(20)  NOT NULL,   -- sent | failed | skipped
        ProviderMessageId NVARCHAR(200) NULL,
        ErrorMessage      NVARCHAR(MAX) NULL,
        CreatedAt         DATETIME2(3)  NOT NULL
            CONSTRAINT DF_WhatsAppMessages_Created DEFAULT (GETUTCDATE()),

        CONSTRAINT PK_WhatsAppMessages       PRIMARY KEY CLUSTERED (WhatsAppMessageId),
        CONSTRAINT FK_WhatsAppMessages_Lead  FOREIGN KEY (LeadId)
                                             REFERENCES dbo.Leads (LeadId) ON DELETE CASCADE,
        CONSTRAINT CK_WhatsAppMessages_Status
            CHECK (StatusCode IN ('sent','failed','skipped'))
    );

    CREATE INDEX IX_WhatsAppMessages_LeadId ON dbo.WhatsAppMessages (LeadId);
END
GO

-- Guarded so a rolled-back transaction does not raise a second, misleading
-- "no corresponding BEGIN TRANSACTION" that buries the real failure.
IF @@TRANCOUNT > 0 COMMIT TRANSACTION;
GO

/* ---------------------------------------------------------------------------
   Notes
   - Orders.OrderTotal is maintained by the application as SUM(OrderItems.Amount)
     whenever items change; OrderItems.Amount is Rate × Pieces.
   - Advance and coupons are NOT stored. They are derived from the lead's total
     across all non-cancelled orders, so adding an order re-bands the lead
     automatically and there is no stored value to drift out of date.
       band    = FLOOR(total / 100000)
       advance = 11000 * band      (band 0 → Leads.ManualAdvanceAmount)
       coupons = 4 * band          (band 0 → 0)
   - FK_Orders_Lead cascades: deleting a lead deletes its orders, items and
     WhatsApp log rows.
   --------------------------------------------------------------------------- */

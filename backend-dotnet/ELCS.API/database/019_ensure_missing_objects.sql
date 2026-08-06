/* ============================================================================
   019_ensure_missing_objects.sql

   Repairs a database whose schema was COPIED (SSMS "Generate Scripts", an
   import wizard, or a table-only transfer) rather than built by running
   migrations 015-018.

   Those tools reliably bring across tables, columns, defaults, checks and
   foreign keys — but routinely drop SEQUENCES and FILTERED INDEXES. The result
   looks complete until the first order is placed and the app fails on a
   missing sequence.

   Idempotent: safe to run against a correctly-migrated database, where it does
   nothing.

   Run AFTER 015-018.
   ============================================================================ */

SET NOCOUNT ON;

/* ---------------------------------------------------------------------------
   1. Order number sequence (from 015)
      Without this, CreateOrderAsync fails on
      "SELECT NEXT VALUE FOR dbo.OrderNumberSequence" and NO order can be
      created. A sequence is used rather than MAX()+1 so two operators saving
      at the same counter cannot collide.

      START WITH is set past any order numbers already present, so a repaired
      database cannot reissue a number that is already on a Sales Order.
   --------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'OrderNumberSequence')
BEGIN
    DECLARE @start INT = 1;

    IF OBJECT_ID('dbo.Orders', 'U') IS NOT NULL
        SELECT @start = ISNULL(MAX(TRY_CONVERT(INT, RIGHT(OrderNumber, 5))), 0) + 1
        FROM dbo.Orders
        WHERE OrderNumber LIKE 'SO-%';

    IF @start < 1 SET @start = 1;

    DECLARE @sql NVARCHAR(400) =
        N'CREATE SEQUENCE dbo.OrderNumberSequence AS INT START WITH '
        + CAST(@start AS NVARCHAR(20)) + N' INCREMENT BY 1;';
    EXEC sp_executesql @sql;

    PRINT 'Created dbo.OrderNumberSequence starting at ' + CAST(@start AS NVARCHAR(20));
END
ELSE
    PRINT 'dbo.OrderNumberSequence already present';
GO

/* ---------------------------------------------------------------------------
   2. Filtered indexes (from 017 / 018)
      UQ_Products_Barcode is not just performance — it is the uniqueness
      guarantee behind barcode lookup. Without it two live products can share a
      barcode and the scanner silently resolves to whichever the query returns
      first.
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.Products', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Products_Barcode')
BEGIN
    -- A copied database may already contain duplicates; report them rather than
    -- failing with an opaque index-creation error.
    IF EXISTS (SELECT 1 FROM dbo.Products WHERE IsActive = 1
               GROUP BY Barcode HAVING COUNT(*) > 1)
    BEGIN
        PRINT 'WARNING: duplicate active barcodes exist - UQ_Products_Barcode NOT created.';
        SELECT Barcode, COUNT(*) AS Copies
        FROM dbo.Products WHERE IsActive = 1
        GROUP BY Barcode HAVING COUNT(*) > 1;
    END
    ELSE
    BEGIN
        CREATE UNIQUE INDEX UQ_Products_Barcode
            ON dbo.Products (Barcode) WHERE IsActive = 1;
        PRINT 'Created UQ_Products_Barcode';
    END
END
GO

IF OBJECT_ID('dbo.Products', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Products_Type')
    CREATE INDEX IX_Products_Type ON dbo.Products (ProductType, Category);
GO

IF OBJECT_ID('dbo.Exhibitions', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.Exhibitions', 'PublicToken') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Exhibitions_PublicToken')
    CREATE UNIQUE INDEX UQ_Exhibitions_PublicToken
        ON dbo.Exhibitions (PublicToken) WHERE PublicToken IS NOT NULL;
GO

IF OBJECT_ID('dbo.Orders', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Orders_Source_Status')
    CREATE NONCLUSTERED INDEX IX_Orders_Source_Status
        ON dbo.Orders (Source, StatusCode) INCLUDE (LeadId, CreatedAt);
GO

IF OBJECT_ID('dbo.Orders', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Orders_LeadId')
    CREATE INDEX IX_Orders_LeadId ON dbo.Orders (LeadId);
GO

IF OBJECT_ID('dbo.Orders', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Orders_CreatedAt')
    CREATE INDEX IX_Orders_CreatedAt ON dbo.Orders (CreatedAt DESC);
GO

IF OBJECT_ID('dbo.OrderItems', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrderItems_OrderId')
    CREATE INDEX IX_OrderItems_OrderId ON dbo.OrderItems (OrderId);
GO

IF OBJECT_ID('dbo.OrderItems', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrderItems_Barcode')
    CREATE INDEX IX_OrderItems_Barcode ON dbo.OrderItems (Barcode);
GO

IF OBJECT_ID('dbo.OrderItems', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.OrderItems', 'ProductId') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrderItems_ProductId')
    CREATE INDEX IX_OrderItems_ProductId ON dbo.OrderItems (ProductId);
GO

IF OBJECT_ID('dbo.LeadPhotos', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LeadPhotos_LeadId')
    CREATE INDEX IX_LeadPhotos_LeadId ON dbo.LeadPhotos (LeadId);
GO

IF OBJECT_ID('dbo.WhatsAppMessages', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhatsAppMessages_LeadId')
    CREATE INDEX IX_WhatsAppMessages_LeadId ON dbo.WhatsAppMessages (LeadId);
GO

IF OBJECT_ID('dbo.OtpChallenges', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OtpChallenges_Mobile')
    CREATE INDEX IX_OtpChallenges_Mobile ON dbo.OtpChallenges (Mobile, CreatedAt DESC);
GO

IF OBJECT_ID('dbo.PublicSessions', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PublicSessions_Expires')
    CREATE INDEX IX_PublicSessions_Expires ON dbo.PublicSessions (ExpiresAt);
GO

/* ---------------------------------------------------------------------------
   3. Seed AppSettings (from 016 / 017)
      016 seeds these inside the CREATE TABLE branch, so a copied table arrives
      empty. The app tolerates missing keys, but the Settings screen reads
      better when every key exists.
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.AppSettings', 'U') IS NOT NULL
BEGIN
    INSERT INTO dbo.AppSettings (SettingKey, SettingValue)
    SELECT k, v
    FROM (VALUES
        ('whatsapp.template.welcome',            NULL),
        ('whatsapp.template.order_confirmation', NULL),
        ('whatsapp.template.testimonial',        NULL),
        ('whatsapp.template.otp',                NULL),
        ('whatsapp.welcome.auto_send',           'true'),
        ('social.instagram',                     NULL),
        ('social.facebook',                      NULL),
        ('social.website',                       NULL),
        ('social.youtube',                       NULL)
    ) AS s(k, v)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.AppSettings a WHERE a.SettingKey = s.k);

    PRINT 'AppSettings seeded';
END
GO

/* ---------------------------------------------------------------------------
   Verification — everything below should report OK
   --------------------------------------------------------------------------- */
SELECT
    CASE WHEN EXISTS (SELECT 1 FROM sys.sequences WHERE name='OrderNumberSequence')
         THEN 'OK' ELSE 'MISSING' END                                   AS OrderNumberSequence,
    CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_Products_Barcode')
         THEN 'OK' ELSE 'MISSING' END                                   AS UQ_Products_Barcode,
    (SELECT COUNT(*) FROM dbo.AppSettings)                              AS AppSettingsRows;
GO

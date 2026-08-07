/* ============================================================================
   018_product_master.sql

   Product Master. Barcodes stop being opaque strings for manual ERP lookup and
   become resolvable in-app: scanning one at the counter — or on a customer's
   own phone — fills in type, category, size, colour, fabric, price and image.

   SHAPE RULES (enforced here, not just in the UI)
   -----------------------------------------------
     Saree              → no category, no size
     Suit / Lehenga     → category is Stitched or Readymade
        · Readymade     → size required
        · Stitched      → no size (made to measure)

   A barcode identifies a DESIGN, not a physical piece, so several garments
   share one and scanning the same code twice is legitimate. There is still no
   stock tracking — this is a catalogue, not an inventory.

   Run AFTER 017.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

/* ---------------------------------------------------------------------------
   1. Products
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.Products', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Products
    (
        ProductId    INT            IDENTITY(1,1) NOT NULL,
        Barcode      NVARCHAR(100)  NOT NULL,          -- design-level SKU
        ProductType  NVARCHAR(20)   NOT NULL,          -- Saree | Suit | Lehenga
        Category     NVARCHAR(20)   NULL,              -- Stitched | Readymade; NULL for Saree
        Size         NVARCHAR(50)   NULL,              -- Readymade only
        Colour       NVARCHAR(50)   NULL,
        Fabric       NVARCHAR(100)  NULL,
        Price        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_Products_Price DEFAULT (0),
        Name         NVARCHAR(200)  NULL,              -- optional display name
        ImagePath    NVARCHAR(500)  NULL,              -- relative to uploads/
        IsActive     BIT            NOT NULL CONSTRAINT DF_Products_Active DEFAULT (1),
        CreatedAt    DATETIME2(3)   NOT NULL CONSTRAINT DF_Products_Created DEFAULT (GETUTCDATE()),
        UpdatedAt    DATETIME2(3)   NULL,

        CONSTRAINT PK_Products PRIMARY KEY CLUSTERED (ProductId),

        CONSTRAINT CK_Products_Type
            CHECK (ProductType IN ('Saree','Suit','Lehenga')),

        CONSTRAINT CK_Products_Category
            CHECK (Category IS NULL OR Category IN ('Stitched','Readymade')),

        CONSTRAINT CK_Products_Price CHECK (Price >= 0),

        -- The whole matrix in one constraint. A row that does not match one of
        -- these three shapes is not a product this business sells.
        CONSTRAINT CK_Products_Shape CHECK (
               (ProductType = 'Saree' AND Category IS NULL AND Size IS NULL)
            OR (ProductType IN ('Suit','Lehenga') AND Category = 'Stitched'  AND Size IS NULL)
            OR (ProductType IN ('Suit','Lehenga') AND Category = 'Readymade' AND Size IS NOT NULL)
        )
    );

    -- Barcode is the lookup key, so it must be unique among live products.
    -- Filtered on IsActive so a retired design's code can be reissued.
    CREATE UNIQUE INDEX UQ_Products_Barcode
        ON dbo.Products (Barcode) WHERE IsActive = 1;

    CREATE INDEX IX_Products_Type ON dbo.Products (ProductType, Category);
END
GO

/* ---------------------------------------------------------------------------
   2. Order lines point at a product AND snapshot it
      The pointer gives traceability; the snapshot is what protects history.
      Without it, editing a product's price would silently rewrite the value of
      every past order and every Sales Order PDF already sent to a customer.
   --------------------------------------------------------------------------- */
IF COL_LENGTH('dbo.OrderItems', 'ProductId') IS NULL
    ALTER TABLE dbo.OrderItems ADD ProductId INT NULL;
GO

IF COL_LENGTH('dbo.OrderItems', 'Category') IS NULL
    ALTER TABLE dbo.OrderItems ADD Category NVARCHAR(20) NULL;   -- snapshot
GO

IF COL_LENGTH('dbo.OrderItems', 'Fabric') IS NULL
    ALTER TABLE dbo.OrderItems ADD Fabric NVARCHAR(100) NULL;    -- snapshot
GO

-- SET NULL, never CASCADE: deleting a discontinued product must not delete the
-- orders that referenced it.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_OrderItems_Product')
    ALTER TABLE dbo.OrderItems
        ADD CONSTRAINT FK_OrderItems_Product FOREIGN KEY (ProductId)
            REFERENCES dbo.Products (ProductId) ON DELETE SET NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrderItems_ProductId')
    CREATE NONCLUSTERED INDEX IX_OrderItems_ProductId ON dbo.OrderItems (ProductId);
GO

-- Guarded so a rolled-back transaction does not raise a second, misleading
-- "no corresponding BEGIN TRANSACTION" that buries the real failure.
IF @@TRANCOUNT > 0 COMMIT TRANSACTION;
GO

/* ---------------------------------------------------------------------------
   Worked examples of the shape rule
   ---------------------------------------------------------------------------
     OK     Saree   / NULL      / NULL   / Red    / Silk
     OK     Suit    / Readymade / 40     / Navy   / Cotton
     OK     Lehenga / Stitched  / NULL   / Maroon / Georgette
     REJECT Saree   / Readymade / 38                 (sarees have no category)
     REJECT Suit    / Readymade / NULL               (readymade needs a size)
     REJECT Lehenga / Stitched  / 42                 (stitched is made to measure)
   --------------------------------------------------------------------------- */

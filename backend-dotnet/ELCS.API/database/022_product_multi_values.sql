/* ============================================================================
   022_product_multi_values.sql

   A product now carries the sizes and colours that DESIGN is available in,
   comma-separated:

     Size    "38, 40, 42"
     Colour  "Navy, Black"

   Scanning that barcode on the order page offers exactly those options, rather
   than every value in the catalogue — the operator picks what the customer
   wants from what this design actually comes in.

   The shape rules from 018 are unchanged: a Saree still has no size, and a
   Readymade Suit or Lehenga still requires one. "Required" now means a
   non-empty list rather than a single value, which CK_Products_Shape already
   expresses correctly (it tests IS NULL / IS NOT NULL, not cardinality).

   NVARCHAR(50) held one value. Widening avoids a truncation error the first
   time a design is stocked in four sizes.

   Run AFTER 021. Non-destructive; existing single values remain valid lists.
   ============================================================================ */

SET NOCOUNT ON;

IF COL_LENGTH('dbo.Products', 'Size') IS NOT NULL
    ALTER TABLE dbo.Products ALTER COLUMN Size NVARCHAR(300) NULL;
GO

IF COL_LENGTH('dbo.Products', 'Colour') IS NOT NULL
    ALTER TABLE dbo.Products ALTER COLUMN Colour NVARCHAR(300) NULL;
GO

SELECT name, TYPE_NAME(user_type_id) AS DataType, max_length / 2 AS MaxChars
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.Products') AND name IN ('Size', 'Colour');
GO

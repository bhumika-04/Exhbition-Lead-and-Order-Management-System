/* ============================================================================
   021_order_item_multi_values.sql

   An order line can now carry SEVERAL sizes and colours — a customer ordering
   the same design in 38 and 40, or in navy and black, is one line, not three.
   The values are stored comma-separated in the existing columns.

   NVARCHAR(50) was sized for a single value and overflows quickly once a line
   holds a few ("Maroon, Navy, Bottle Green" is already 26). Widening avoids a
   silent truncation error at the counter.

   Products themselves are unchanged: a product remains one design in one size
   and colour. The multi-value list belongs to the ORDER, not the catalogue.

   Run AFTER 020. Widening is non-destructive; existing values are untouched.
   ============================================================================ */

SET NOCOUNT ON;

IF COL_LENGTH('dbo.OrderItems', 'Size') IS NOT NULL
    ALTER TABLE dbo.OrderItems ALTER COLUMN Size NVARCHAR(300) NULL;
GO

IF COL_LENGTH('dbo.OrderItems', 'Colour') IS NOT NULL
    ALTER TABLE dbo.OrderItems ALTER COLUMN Colour NVARCHAR(300) NULL;
GO

SELECT name, TYPE_NAME(user_type_id) AS DataType, max_length / 2 AS MaxChars
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.OrderItems') AND name IN ('Size', 'Colour');
GO

/* ============================================================================
   025_order_payment_proof.sql

   One payment-proof image per order — a photo or screenshot of the receipt
   for the advance actually collected. Replacing the file on a re-upload is
   simpler than a gallery here: unlike team photos, there is exactly one
   advance payment per order to evidence, not several.

   Idempotent: safe to run against a database that already has the column.
   ============================================================================ */

SET NOCOUNT ON;

IF OBJECT_ID('dbo.Orders', 'U') IS NULL
BEGIN
    RAISERROR('dbo.Orders does not exist — run the base schema first.', 16, 1);
    RETURN;
END

IF COL_LENGTH('dbo.Orders', 'PaymentProofPath') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD PaymentProofPath NVARCHAR(500) NULL;
    PRINT 'Added dbo.Orders.PaymentProofPath';
END
ELSE
    PRINT 'dbo.Orders.PaymentProofPath already present';
GO

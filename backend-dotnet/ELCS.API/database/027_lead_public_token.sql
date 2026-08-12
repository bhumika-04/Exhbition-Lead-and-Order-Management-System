/* ============================================================================
   027_lead_public_token.sql

   A per-LEAD QR, distinct from the per-EXHIBITION one added earlier. Scanning
   it opens a self-service session already bound to that specific customer —
   no mobile number to type, because the token itself is the identity. Same
   opaque-random-string approach as Exhibitions.PublicToken, for the same
   reason: a visitor must not be able to reach another customer's page by
   editing the URL.

   Idempotent: safe to run against a database that already has the column.
   ============================================================================ */

SET NOCOUNT ON;

IF OBJECT_ID('dbo.Leads', 'U') IS NULL
BEGIN
    RAISERROR('dbo.Leads does not exist — run the base schema first.', 16, 1);
    RETURN;
END

IF COL_LENGTH('dbo.Leads', 'PublicToken') IS NULL
BEGIN
    ALTER TABLE dbo.Leads ADD PublicToken NVARCHAR(64) NULL;
    PRINT 'Added dbo.Leads.PublicToken';
END
ELSE
    PRINT 'dbo.Leads.PublicToken already present';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Leads_PublicToken' AND object_id = OBJECT_ID('dbo.Leads'))
BEGIN
    -- Filtered: almost every lead has no token, so indexing only the ones
    -- that do keeps this small and keeps a full scan out of the lookup.
    CREATE UNIQUE INDEX IX_Leads_PublicToken ON dbo.Leads(PublicToken) WHERE PublicToken IS NOT NULL;
    PRINT 'Created IX_Leads_PublicToken';
END
ELSE
    PRINT 'IX_Leads_PublicToken already present';
GO

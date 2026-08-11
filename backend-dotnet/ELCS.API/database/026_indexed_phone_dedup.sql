/* ============================================================================
   026_indexed_phone_dedup.sql

   The duplicate-phone check in LeadService.CreateLeadAsync ran on EVERY lead
   created — the single most frequent write during an exhibition, staff
   scanning card after card — and compared with

       WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                 PrimaryVisitorPhone,' ',''),'-',''),'+',''),'(',''),')',''), 10) = @Last10

   A function wrapped around the COLUMN, not the parameter, so SQL Server can
   never use an index here — every insert scanned the whole table. Fine at a
   few hundred rows, a real cost heading toward 8,000+ and beyond, and worse
   exactly when it matters most: many staff creating leads at once.

   Fix: the same normalisation as a PERSISTED computed column, so it is
   materialised on write rather than recomputed on every read, plus an index
   on it. The application query changes from comparing a function of the
   column to comparing the column itself — an index seek instead of a scan.

   Idempotent: safe to run against a database that already has the column
   and/or the index.
   ============================================================================ */

SET NOCOUNT ON;

IF OBJECT_ID('dbo.Leads', 'U') IS NULL
BEGIN
    RAISERROR('dbo.Leads does not exist — run the base schema first.', 16, 1);
    RETURN;
END

IF COL_LENGTH('dbo.Leads', 'PhoneLast10') IS NULL
BEGIN
    ALTER TABLE dbo.Leads ADD PhoneLast10 AS
        RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            ISNULL(PrimaryVisitorPhone, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), 10)
        PERSISTED;
    PRINT 'Added dbo.Leads.PhoneLast10 (persisted computed column)';
END
ELSE
    PRINT 'dbo.Leads.PhoneLast10 already present';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Leads_PhoneLast10' AND object_id = OBJECT_ID('dbo.Leads'))
BEGIN
    CREATE INDEX IX_Leads_PhoneLast10 ON dbo.Leads(PhoneLast10);
    PRINT 'Created IX_Leads_PhoneLast10';
END
ELSE
    PRINT 'IX_Leads_PhoneLast10 already present';
GO

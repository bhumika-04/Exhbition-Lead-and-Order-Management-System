/* ============================================================================
   014_remove_multitenancy_and_crm.sql

   Reverses migrations 011 (multi-tenancy), 012 (per-tenant roles) and removes
   the CRM/ERP push column.

   Intended target: a RESTORED copy of the previous multi-tenant database.
   Run AFTER deploying the matching application build.

   ⚠️  DESTRUCTIVE AND IRREVERSIBLE.
       - Dropping TenantId permanently discards which company each lead,
         exhibition, employee and role belonged to. If the database currently
         holds more than one company's data, those records become a single
         undifferentiated pool and CANNOT be separated again afterwards.
       - Dropping CrmLedgerId discards the link between a lead and the
         LedgerMaster row already created for it in the ERP database.
       - TAKE A FULL BACKUP FIRST.

   Constraint names are resolved dynamically rather than hard-coded, so this
   runs against a restored database whose 011/012 constraint names may differ
   from any assumed default.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* --- Pre-flight: report what is about to be merged -------------------------
   Run this SELECT on its own first. If DistinctTenants > 1, stop and confirm
   that merging those companies into one pool is genuinely intended.          */
IF COL_LENGTH('dbo.Leads', 'TenantId') IS NOT NULL
BEGIN
    SELECT
        COUNT(DISTINCT TenantId) AS DistinctTenants,
        COUNT(*)                 AS TotalLeads
    FROM dbo.Leads;
END
GO

BEGIN TRANSACTION;

/* ---------------------------------------------------------------------------
   1. Drop every foreign key that points at dbo.Companies
   --------------------------------------------------------------------------- */
DECLARE @sql NVARCHAR(MAX) = N'';

SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(t.schema_id))
            + N'.' + QUOTENAME(t.name)
            + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';' + CHAR(10)
FROM sys.foreign_keys fk
JOIN sys.tables t  ON t.object_id  = fk.parent_object_id
JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
WHERE rt.name = 'Companies';

IF @sql <> N'' EXEC sp_executesql @sql;

/* ---------------------------------------------------------------------------
   2. Drop indexes, unique constraints and defaults that involve TenantId
      (includes the composite UQ on Roles(TenantId, RoleName) from 012)
   --------------------------------------------------------------------------- */
SET @sql = N'';

-- 2a. Unique/regular indexes containing a TenantId column
SELECT @sql = @sql + CASE
         WHEN i.is_unique_constraint = 1
           THEN N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name)
              + N' DROP CONSTRAINT ' + QUOTENAME(i.name) + N';' + CHAR(10)
         ELSE N'DROP INDEX ' + QUOTENAME(i.name) + N' ON '
              + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) + N';' + CHAR(10)
       END
FROM sys.indexes i
JOIN sys.tables t          ON t.object_id  = i.object_id
JOIN sys.index_columns ic  ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c         ON c.object_id  = ic.object_id AND c.column_id = ic.column_id
WHERE c.name = 'TenantId'
  AND i.is_primary_key = 0
  AND t.name IN ('Leads', 'Employees', 'Exhibitions', 'Roles');

IF @sql <> N'' EXEC sp_executesql @sql;

-- 2b. Default constraints on TenantId / IsSuperAdmin / CrmLedgerId
SET @sql = N'';

SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(t.schema_id))
            + N'.' + QUOTENAME(t.name)
            + N' DROP CONSTRAINT ' + QUOTENAME(dc.name) + N';' + CHAR(10)
FROM sys.default_constraints dc
JOIN sys.tables t  ON t.object_id = dc.parent_object_id
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE c.name IN ('TenantId', 'IsSuperAdmin', 'CrmLedgerId');

IF @sql <> N'' EXEC sp_executesql @sql;

/* ---------------------------------------------------------------------------
   3. Drop the tenancy columns
   --------------------------------------------------------------------------- */
IF COL_LENGTH('dbo.Leads',        'TenantId') IS NOT NULL ALTER TABLE dbo.Leads       DROP COLUMN TenantId;
IF COL_LENGTH('dbo.Exhibitions',  'TenantId') IS NOT NULL ALTER TABLE dbo.Exhibitions DROP COLUMN TenantId;
IF COL_LENGTH('dbo.Roles',        'TenantId') IS NOT NULL ALTER TABLE dbo.Roles       DROP COLUMN TenantId;
IF COL_LENGTH('dbo.Employees',    'TenantId') IS NOT NULL ALTER TABLE dbo.Employees   DROP COLUMN TenantId;

IF COL_LENGTH('dbo.Employees', 'IsSuperAdmin') IS NOT NULL ALTER TABLE dbo.Employees DROP COLUMN IsSuperAdmin;

/* ---------------------------------------------------------------------------
   4. Drop the CRM/ERP link column
   --------------------------------------------------------------------------- */
IF COL_LENGTH('dbo.Leads', 'CrmLedgerId') IS NOT NULL ALTER TABLE dbo.Leads DROP COLUMN CrmLedgerId;

/* ---------------------------------------------------------------------------
   5. Restore a single-tenant unique role name
      (012 made this unique per (TenantId, RoleName); with TenantId gone the
       name must be globally unique again). Duplicates across former tenants
       are renamed with a numeric suffix so the index can be created.
   --------------------------------------------------------------------------- */
;WITH dupes AS (
    SELECT RoleId, RoleName,
           ROW_NUMBER() OVER (PARTITION BY RoleName ORDER BY RoleId) AS rn
    FROM dbo.Roles
)
UPDATE dupes
SET RoleName = RoleName + ' (' + CAST(rn AS NVARCHAR(10)) + ')'
WHERE rn > 1;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Roles_RoleName' AND object_id = OBJECT_ID('dbo.Roles'))
    CREATE UNIQUE INDEX UQ_Roles_RoleName ON dbo.Roles (RoleName);

/* ---------------------------------------------------------------------------
   6. Drop the tenant table
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.Companies', 'U') IS NOT NULL DROP TABLE dbo.Companies;

-- Guarded so a rolled-back transaction does not raise a second, misleading
-- "no corresponding BEGIN TRANSACTION" that buries the real failure.
IF @@TRANCOUNT > 0 COMMIT TRANSACTION;
GO

/* ---------------------------------------------------------------------------
   7. OPTIONAL — the former super admin
      With IsSuperAdmin dropped, that account becomes an ordinary user with
      full access (role_id NULL = full access). Review it deliberately:
      it is left in place rather than deleted, because deleting a login is
      not something this migration should decide on your behalf.

      -- SELECT EmployeeId, FullName, Email, RoleId FROM dbo.Employees
      --  WHERE Email = 'admin@example.com';
      -- UPDATE dbo.Employees SET IsActive = 0 WHERE Email = 'admin@example.com';
   --------------------------------------------------------------------------- */

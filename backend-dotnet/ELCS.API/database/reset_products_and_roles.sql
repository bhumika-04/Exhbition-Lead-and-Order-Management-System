/* ===========================================================================
   Clears the product catalogue, and removes the duplicate Administrator role
   ===========================================================================

   *** DESTRUCTIVE AND IRREVERSIBLE. No backup is taken, by design. ***

   Checked before writing this:
     Products                       31 rows
     OrderItems referencing them     0 rows   -> nothing blocks the delete
     Role 'Administrator' (id 2)     0 users  -> nothing blocks the delete
     Role 'Admin '        (id 1)     1 user   -> kept, it owns the admin login

   IMPORTANT — the images do not delete themselves.
   Product images are named after the product id (uploads/products/{id}.jpg).
   Reseeding to 0 means the next import starts again at id 1, which would
   inherit the OLD product 1's photograph. Delete the folder as well:

       E:\ELOMS\backend-dotnet\ELCS.API\uploads\products

   =========================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;      -- any error rolls the whole batch back
GO

BEGIN TRANSACTION;

/* ---- 1. The catalogue ----------------------------------------------------- */
-- Safe only because no order line points at a product. If that ever changes,
-- clear OrderItems first or the foreign key refuses — which is the correct
-- behaviour: a past order must keep the design it was placed against.
DELETE FROM dbo.Products;

/* ---- 2. The duplicate role ------------------------------------------------
   Deleted by NAME rather than by id: ids shift if the seed is ever re-run, and
   deleting role 2 blindly would eventually remove whatever happened to land
   there. Guarded on having no users, so it cannot orphan a login. */
DELETE FROM dbo.Roles
WHERE RoleName = 'Administrator'
  AND NOT EXISTS (SELECT 1 FROM dbo.Employees e WHERE e.RoleId = dbo.Roles.RoleId);

COMMIT TRANSACTION;
GO

/* ---- 3. Restart product ids at 1 ------------------------------------------
   RESEED to 0 means the NEXT row inserted gets 1. Roles are deliberately NOT
   reseeded: role 1 still exists and owns the admin login, so resetting the
   counter would hand the next new role a colliding id. */
DBCC CHECKIDENT ('dbo.Products', RESEED, 0);
GO

/* ---- 4. Confirm ----------------------------------------------------------- */
SELECT 'Products' AS TableName, COUNT(*) AS Rows FROM dbo.Products;

SELECT RoleId, RoleName,
       Users = (SELECT COUNT(*) FROM dbo.Employees e WHERE e.RoleId = r.RoleId)
FROM dbo.Roles r ORDER BY RoleId;
GO


/* ===========================================================================
   OPTIONAL — tidy the trailing space on the kept role
   ===========================================================================
   'Admin ' has a trailing space, which makes it sort oddly and match nothing
   when compared against 'Admin'. Harmless today; annoying later.

UPDATE dbo.Roles SET RoleName = LTRIM(RTRIM(RoleName)) WHERE RoleName <> LTRIM(RTRIM(RoleName));
   =========================================================================== */

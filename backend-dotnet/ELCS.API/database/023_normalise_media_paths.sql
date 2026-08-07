/* ============================================================================
   023_normalise_media_paths.sql

   All of a lead's media now lives under one folder, so it can be found,
   archived or deleted in one place:

     uploads/leads/{leadId}/card/     front.jpg, back.jpg
     uploads/leads/{leadId}/team/     {guid}.jpg
     uploads/leads/{leadId}/orders/   {orderNo}-{guid}.pdf
     uploads/products/{productId}/    {guid}.jpg
     uploads/temp/cards/{tempId}/     scanned, not yet confirmed

   Previously cards sat in uploads/cards/{leadId}/, team photos in
   uploads/leads/{leadId}/photos/ and sales orders in uploads/orders/{leadId}/
   — three roots for one lead.

   This script rewrites the stored PATHS. The FILES must be moved separately;
   see the note at the end. Run the file move first, so a path never points at
   something that is not there yet.

   It also repairs absolute paths. The card pipeline used to store the full
   location from whichever machine wrote it
   (E:\...\ELCS.API\uploads\cards\2\front.jpg), which breaks as soon as the app
   moves directory or server.

   Idempotent: rows already in the new form are left alone.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

/* ---------------------------------------------------------------------------
   1. Visiting cards → leads/{id}/card/
      Takes the file name from whatever is stored — absolute or relative, either
      slash style — and rebuilds the path from the lead id.
   --------------------------------------------------------------------------- */
UPDATE dbo.Leads
SET FrontImagePath =
    'leads/' + CAST(LeadId AS NVARCHAR(20)) + '/card/' +
    REVERSE(LEFT(REVERSE(REPLACE(FrontImagePath, '\', '/')),
                 CHARINDEX('/', REVERSE(REPLACE(FrontImagePath, '\', '/')) + '/') - 1))
WHERE FrontImagePath IS NOT NULL
  AND FrontImagePath NOT LIKE 'leads/%/card/%';

UPDATE dbo.Leads
SET BackImagePath =
    'leads/' + CAST(LeadId AS NVARCHAR(20)) + '/card/' +
    REVERSE(LEFT(REVERSE(REPLACE(BackImagePath, '\', '/')),
                 CHARINDEX('/', REVERSE(REPLACE(BackImagePath, '\', '/')) + '/') - 1))
WHERE BackImagePath IS NOT NULL
  AND BackImagePath NOT LIKE 'leads/%/card/%';
GO

/* ---------------------------------------------------------------------------
   2. Team photos: leads/{id}/photos/ → leads/{id}/team/
   --------------------------------------------------------------------------- */
UPDATE dbo.LeadPhotos
SET FilePath = REPLACE(FilePath,
        'leads/' + CAST(LeadId AS NVARCHAR(20)) + '/photos/',
        'leads/' + CAST(LeadId AS NVARCHAR(20)) + '/team/')
WHERE SourceType = 'file'
  AND FilePath LIKE 'leads/%/photos/%';
GO

/* ---------------------------------------------------------------------------
   3. Sales orders: orders/{leadId}/ → leads/{leadId}/orders/
   --------------------------------------------------------------------------- */
UPDATE o
SET SoPdfPath = 'leads/' + CAST(o.LeadId AS NVARCHAR(20)) + '/orders/' +
    REVERSE(LEFT(REVERSE(REPLACE(o.SoPdfPath, '\', '/')),
                 CHARINDEX('/', REVERSE(REPLACE(o.SoPdfPath, '\', '/')) + '/') - 1))
FROM dbo.Orders o
WHERE o.SoPdfPath IS NOT NULL
  AND o.SoPdfPath NOT LIKE 'leads/%/orders/%';
GO

IF @@TRANCOUNT > 0 COMMIT TRANSACTION;
GO

/* ---------------------------------------------------------------------------
   Verification — every path below should start with leads/{id}/
   --------------------------------------------------------------------------- */
SELECT 'Leads.FrontImagePath' AS Column_, LeadId AS Id, FrontImagePath AS Path
FROM dbo.Leads WHERE FrontImagePath IS NOT NULL
UNION ALL
SELECT 'Leads.BackImagePath', LeadId, BackImagePath
FROM dbo.Leads WHERE BackImagePath IS NOT NULL
UNION ALL
SELECT 'LeadPhotos.FilePath', LeadId, FilePath
FROM dbo.LeadPhotos WHERE FilePath IS NOT NULL
UNION ALL
SELECT 'Orders.SoPdfPath', LeadId, SoPdfPath
FROM dbo.Orders WHERE SoPdfPath IS NOT NULL;
GO

/* ---------------------------------------------------------------------------
   Moving the FILES

   PowerShell, run from the ELCS.API folder. Move first, then run this script.

     $u = ".\uploads"
     Get-ChildItem "$u\cards" -Directory -Exclude temp | ForEach-Object {
         $dest = "$u\leads\$($_.Name)\card"
         New-Item -ItemType Directory -Force $dest | Out-Null
         Get-ChildItem $_.FullName -File | Move-Item -Destination $dest -Force
     }
     Get-ChildItem "$u\leads" -Directory | ForEach-Object {
         $old = Join-Path $_.FullName 'photos'
         if (Test-Path $old) {
             $dest = Join-Path $_.FullName 'team'
             New-Item -ItemType Directory -Force $dest | Out-Null
             Get-ChildItem $old -File | Move-Item -Destination $dest -Force
             Remove-Item $old -Recurse -Force
         }
     }
     Get-ChildItem "$u\orders" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
         $dest = "$u\leads\$($_.Name)\orders"
         New-Item -ItemType Directory -Force $dest | Out-Null
         Get-ChildItem $_.FullName -File | Move-Item -Destination $dest -Force
     }
     if (Test-Path "$u\cards\temp") {
         New-Item -ItemType Directory -Force "$u\temp" | Out-Null
         Move-Item "$u\cards\temp" "$u\temp\cards" -Force
     }

   Folders under uploads/cards/ whose lead id does not exist in this database
   are leftovers from an earlier one. They are harmless but serve nothing —
   delete them once you are satisfied nothing references them.
   --------------------------------------------------------------------------- */

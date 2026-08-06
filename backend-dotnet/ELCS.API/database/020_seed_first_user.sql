/* ============================================================================
   020_seed_first_user.sql

   Creates the first login for an EMPTY database. Without at least one active
   Employee row nobody can sign in, and every screen is unreachable.

   EDIT THE TWO VALUES BELOW, then run.

   The hash must match AuthService.HashPassword, which is
   SHA-256 over the UTF-8 bytes, hex, lowercase. HASHBYTES over a VARCHAR
   reproduces that for ASCII passwords — do NOT change the CAST to NVARCHAR,
   which would hash UTF-16 bytes and silently produce a password that never
   works.

   Keep the password ASCII. If you want non-ASCII, set it through the app's
   user-management screen instead.
   ============================================================================ */

SET NOCOUNT ON;

DECLARE @Email    VARCHAR(200) = 'admin@tejoo.com';      -- <<< EDIT
DECLARE @Password VARCHAR(100) = 'ChangeMe#2026';        -- <<< EDIT
DECLARE @FullName NVARCHAR(200) = 'Administrator';       -- <<< EDIT

IF EXISTS (SELECT 1 FROM dbo.Employees WHERE Email = @Email)
BEGIN
    PRINT 'An employee with that email already exists — nothing inserted.';
END
ELSE
BEGIN
    -- RoleId NULL = full access. Create proper roles from the Roles screen
    -- afterwards and assign this user one.
    INSERT INTO dbo.Employees (FullName, Email, PasswordHash, IsActive, RoleId, CreatedAt)
    VALUES (
        @FullName,
        @Email,
        LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', @Password), 2)),
        1,
        NULL,
        GETUTCDATE()
    );

    PRINT 'Created login: ' + @Email;
    PRINT 'Sign in, then change this password from the Profile screen.';
END
GO

/* ---------------------------------------------------------------------------
   Verify the hash matches what the application will compute.
   Both columns must be identical, otherwise login will fail silently.
   --------------------------------------------------------------------------- */
DECLARE @Check VARCHAR(100) = 'ChangeMe#2026';           -- same password as above
SELECT
    LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', @Check), 2)) AS ComputedHash,
    (SELECT TOP 1 PasswordHash FROM dbo.Employees ORDER BY EmployeeId DESC) AS StoredHash;
GO

/* ---------------------------------------------------------------------------
   You will also need at least one Exhibition before capturing leads — create
   it from the Exhibitions screen once you can log in, so its dates and
   self-service token are set through the app rather than by hand.
   --------------------------------------------------------------------------- */

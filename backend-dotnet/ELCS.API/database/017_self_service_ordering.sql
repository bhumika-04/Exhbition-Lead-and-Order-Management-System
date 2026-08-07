/* ============================================================================
   017_self_service_ordering.sql

   QR self-service ordering. A visitor scans a QR at the booth, opens a public
   page on their own phone, verifies their mobile by WhatsApp OTP, and places
   their own order. The order lands as a pending draft for a CRR to confirm and
   collect payment against.

   SECURITY NOTE
   -------------
   These endpoints are PUBLIC — no employee header, no login. A mobile number
   alone is not proof of identity: phone numbers are guessable, so returning
   lead details on an unverified number would let anyone harvest the customer
   list by typing numbers. Nothing about a lead is returned until an OTP sent
   to that number has been verified, which is what OtpChallenges enforces.

   Run AFTER 016.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

/* ---------------------------------------------------------------------------
   1. Per-exhibition public token — the payload behind the printed QR code.
      Opaque and random, not the ExhibitionId, so a visitor cannot reach another
      exhibition's ordering page by editing the URL.
   --------------------------------------------------------------------------- */
IF COL_LENGTH('dbo.Exhibitions', 'PublicToken') IS NULL
    ALTER TABLE dbo.Exhibitions ADD PublicToken NVARCHAR(64) NULL;
GO

IF COL_LENGTH('dbo.Exhibitions', 'SelfServiceEnabled') IS NULL
    ALTER TABLE dbo.Exhibitions ADD SelfServiceEnabled BIT NOT NULL
        CONSTRAINT DF_Exhibitions_SelfService DEFAULT (0);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Exhibitions_PublicToken')
    CREATE UNIQUE INDEX UQ_Exhibitions_PublicToken
        ON dbo.Exhibitions (PublicToken) WHERE PublicToken IS NOT NULL;
GO

/* ---------------------------------------------------------------------------
   2. OTP challenges
      The code is stored HASHED — a leaked table must not hand out live codes.
      Attempts and expiry are enforced server-side so the endpoint cannot be
      brute-forced (a 6-digit code is only 10^6 wide).
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.OtpChallenges', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OtpChallenges
    (
        OtpChallengeId INT           IDENTITY(1,1) NOT NULL,
        Mobile         NVARCHAR(20)  NOT NULL,      -- normalised to 10 digits
        ExhibitionId   INT           NULL,
        CodeHash       NVARCHAR(128) NOT NULL,      -- SHA-256 of code + per-row salt
        Salt           NVARCHAR(64)  NOT NULL,
        Attempts       INT           NOT NULL CONSTRAINT DF_Otp_Attempts DEFAULT (0),
        ExpiresAt      DATETIME2(3)  NOT NULL,
        ConsumedAt     DATETIME2(3)  NULL,
        CreatedAt      DATETIME2(3)  NOT NULL CONSTRAINT DF_Otp_Created DEFAULT (GETUTCDATE()),

        CONSTRAINT PK_OtpChallenges PRIMARY KEY CLUSTERED (OtpChallengeId)
    );

    CREATE INDEX IX_OtpChallenges_Mobile  ON dbo.OtpChallenges (Mobile, CreatedAt DESC);
    CREATE INDEX IX_OtpChallenges_Expires ON dbo.OtpChallenges (ExpiresAt);
END
GO

/* ---------------------------------------------------------------------------
   3. Public sessions
      Issued only after a successful OTP verification. The visitor's browser
      holds an opaque token; every subsequent public call is authorised against
      this row. Server-side so it can be revoked and cannot be forged.
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.PublicSessions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PublicSessions
    (
        PublicSessionId INT           IDENTITY(1,1) NOT NULL,
        SessionToken    NVARCHAR(128) NOT NULL,
        Mobile          NVARCHAR(20)  NOT NULL,
        ExhibitionId    INT           NULL,
        LeadId          INT           NULL,          -- set once matched or created
        ExpiresAt       DATETIME2(3)  NOT NULL,
        CreatedAt       DATETIME2(3)  NOT NULL CONSTRAINT DF_PublicSessions_Created DEFAULT (GETUTCDATE()),

        CONSTRAINT PK_PublicSessions PRIMARY KEY CLUSTERED (PublicSessionId),
        CONSTRAINT UQ_PublicSessions_Token UNIQUE (SessionToken)
    );

    CREATE INDEX IX_PublicSessions_Expires ON dbo.PublicSessions (ExpiresAt);
END
GO

/* ---------------------------------------------------------------------------
   4. Where an order came from
      Self-service orders stay 'draft' but must be distinguishable so a CRR can
      work a pending queue rather than hunting through every draft.
   --------------------------------------------------------------------------- */
IF COL_LENGTH('dbo.Orders', 'Source') IS NULL
    ALTER TABLE dbo.Orders ADD Source NVARCHAR(20) NOT NULL
        CONSTRAINT DF_Orders_Source DEFAULT ('staff');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Orders_Source')
    ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_Source
        CHECK (Source IN ('staff','self_service'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Orders_Source_Status')
    CREATE NONCLUSTERED INDEX IX_Orders_Source_Status
        ON dbo.Orders (Source, StatusCode) INCLUDE (LeadId, CreatedAt);
GO

/* ---------------------------------------------------------------------------
   5. OTP template name alongside the other WhatsApp templates
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.AppSettings', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = 'whatsapp.template.otp')
    INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES ('whatsapp.template.otp', NULL);
GO

-- Guarded: XACT_ABORT rolls the transaction back on any error above, and an
-- unguarded COMMIT then raises "no corresponding BEGIN TRANSACTION" — a second,
-- misleading message that buries the real failure at the top of the output.
IF @@TRANCOUNT > 0 COMMIT TRANSACTION;
GO

/* ---------------------------------------------------------------------------
   Housekeeping
   ---------------------------------------------------------------------------
   OtpChallenges and PublicSessions accumulate. Neither is business data, so
   purge them on a schedule (SQL Agent job, or run periodically by hand):

     DELETE FROM dbo.OtpChallenges  WHERE ExpiresAt < DATEADD(DAY, -1, GETUTCDATE());
     DELETE FROM dbo.PublicSessions WHERE ExpiresAt < DATEADD(DAY, -1, GETUTCDATE());

   Giving an exhibition its QR link:

     UPDATE dbo.Exhibitions
        SET PublicToken = LOWER(REPLACE(CONVERT(NVARCHAR(36), NEWID()), '-', '')),
            SelfServiceEnabled = 1
      WHERE ExhibitionId = @ExhibitionId;

   The app does this from the Exhibitions screen; the statement above is the
   manual equivalent.
   --------------------------------------------------------------------------- */

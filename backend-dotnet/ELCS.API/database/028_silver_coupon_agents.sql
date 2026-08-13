/* ============================================================================
   028_silver_coupon_agents.sql

   Silver Coupon Module, agent-issuing workflow. An Agent is an external
   referrer — not an Employee — who brought in one or more customers (Leads).
   An executive searches those customers, selects any number of them, and in
   one Confirm action records who they belong to (agent name + phone) and the
   physical coupon number(s) handed over. Coupons owed follow
   AdvanceCalculator.SilverCouponsFor applied to the COMBINED value of the
   selected customers (see SilverCouponService).

   Three tables:

     SilverCouponAgents         One row per distinct agent phone number — the
                                 aggregation key. Name is kept as most-recently
                                 typed, since phone is the stable identity.

     SilverCouponAllocations    One row per Confirm action: which agent, the
                                 combined value at that moment, and the coupon
                                 numbers issued (JSON array — CouponsCount is
                                 stored alongside so aggregate queries don't
                                 need to parse JSON).

     SilverCouponAllocationLeads  Which customers (Leads) a given allocation
                                 covers. AgentId is denormalised onto this
                                 table (not just reachable via AllocationId)
                                 specifically so a UNIQUE(AgentId, LeadId)
                                 constraint can guarantee — at the database
                                 level, not just in application code — that
                                 the same agent can never be issued a coupon
                                 for the same customer's order twice.

   Idempotent: safe to run against a database that already has any of these.
   ============================================================================ */

SET NOCOUNT ON;

IF OBJECT_ID('dbo.Leads', 'U') IS NULL
BEGIN
    RAISERROR('dbo.Leads does not exist — run the base schema first.', 16, 1);
    RETURN;
END

IF OBJECT_ID('dbo.SilverCouponAgents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SilverCouponAgents (
        AgentId   INT IDENTITY(1,1) PRIMARY KEY,
        Name      NVARCHAR(200)   NOT NULL,
        Phone     NVARCHAR(20)    NOT NULL,
        CreatedAt DATETIME2       NOT NULL DEFAULT (GETUTCDATE()),
        UpdatedAt DATETIME2       NULL
    );
    CREATE UNIQUE INDEX UX_SilverCouponAgents_Phone ON dbo.SilverCouponAgents(Phone);
    PRINT 'Created dbo.SilverCouponAgents';
END
ELSE
    PRINT 'dbo.SilverCouponAgents already present';
GO

IF OBJECT_ID('dbo.SilverCouponAllocations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SilverCouponAllocations (
        AllocationId        INT IDENTITY(1,1) PRIMARY KEY,
        AgentId              INT             NOT NULL REFERENCES dbo.SilverCouponAgents(AgentId),
        CombinedValue        DECIMAL(18,2)   NOT NULL,
        CouponsCount         INT             NOT NULL,
        CouponNumbers        NVARCHAR(MAX)   NOT NULL,  -- JSON array, e.g. ["S-101","S-102"]
        CreatedByEmployeeId  INT             NULL,
        CreatedAt            DATETIME2       NOT NULL DEFAULT (GETUTCDATE())
    );
    CREATE INDEX IX_SilverCouponAllocations_AgentId ON dbo.SilverCouponAllocations(AgentId);
    PRINT 'Created dbo.SilverCouponAllocations';
END
ELSE
    PRINT 'dbo.SilverCouponAllocations already present';
GO

IF OBJECT_ID('dbo.SilverCouponAllocationLeads', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SilverCouponAllocationLeads (
        AllocationLeadId       INT IDENTITY(1,1) PRIMARY KEY,
        AllocationId           INT             NOT NULL REFERENCES dbo.SilverCouponAllocations(AllocationId),
        AgentId                 INT             NOT NULL REFERENCES dbo.SilverCouponAgents(AgentId),
        LeadId                  INT             NOT NULL REFERENCES dbo.Leads(LeadId),
        LeadValueAtAllocation   DECIMAL(18,2)   NOT NULL
    );
    -- The hard guarantee: this agent cannot be linked to this customer's
    -- order a second time, across any allocation.
    CREATE UNIQUE INDEX UX_SilverCouponAllocationLeads_Agent_Lead
        ON dbo.SilverCouponAllocationLeads(AgentId, LeadId);
    CREATE INDEX IX_SilverCouponAllocationLeads_AllocationId ON dbo.SilverCouponAllocationLeads(AllocationId);
    PRINT 'Created dbo.SilverCouponAllocationLeads';
END
ELSE
    PRINT 'dbo.SilverCouponAllocationLeads already present';
GO

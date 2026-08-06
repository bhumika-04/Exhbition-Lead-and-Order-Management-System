using Dapper;
using ELCS.API.Data;
using ELCS.API.Models;
using Microsoft.Data.SqlClient;
using System.Text.Json;

namespace ELCS.API.Services;

public class LeadService : ILeadService
{
    private readonly ILogger<LeadService> _logger;
    private readonly IDbConnection _db;
    private readonly IConfiguration _config;

    public LeadService(ILogger<LeadService> logger, IDbConnection db, IConfiguration config)
    {
        _logger = logger;
        _db = db;
        _config = config;
    }

    public async Task<Lead?> GetLeadByIdAsync(int leadId)
    {
        using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<Lead>(
            "SELECT * FROM Leads WHERE LeadId = @LeadId",
            new { LeadId = leadId });
    }

    public async Task<LeadDetailDto?> GetLeadDetailAsync(int leadId, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();

        // Tenant isolation: regular users may only read leads belonging to their own company
        var tenantClause = isSuperAdmin ? "" : " AND l.TenantId = @TenantId";
        var lead = await conn.QueryFirstOrDefaultAsync<Lead>($@"
            SELECT l.*, e.Name AS ExhibitionName
            FROM Leads l
            LEFT JOIN Exhibitions e ON e.ExhibitionId = l.ExhibitionId
            WHERE l.LeadId = @LeadId{tenantClause}",
            new { LeadId = leadId, TenantId = tenantId });

        if (lead == null) return null;

        // Parse JSON columns into lists
        var persons = ParseJsonArray<LeadPerson>(lead.AdditionalPersons) ?? new List<LeadPerson>();
        var phones = ParseJsonPhones(lead.PhoneNumbers) ?? new List<LeadPhone>();
        var emails = ParseJsonEmails(lead.EmailAddresses) ?? new List<LeadEmail>();
        var addresses = ParseJsonAddresses(lead.Addresses) ?? new List<LeadAddress>();
        var websites = ParseJsonWebsites(lead.Websites) ?? new List<LeadWebsite>();
        var services = ParseJsonServices(lead.Services) ?? new List<LeadServiceModel>();
        var brands = ParseJsonBrands(lead.Brands) ?? new List<LeadBrand>();
        var topics = ParseJsonTopics(lead.Topics) ?? new List<LeadTopic>();

        var messages = (await conn.QueryAsync<LeadMessage>(
            "SELECT * FROM LeadMessages WHERE LeadId = @LeadId ORDER BY MessageId ASC",
            new { LeadId = leadId })).ToList();

        return new LeadDetailDto(
            Lead: lead,
            Persons: persons,
            Addresses: addresses,
            Websites: websites,
            Services: services,
            Topics: topics,
            Messages: messages,
            Brands: brands,
            Phones: phones,
            Emails: emails
        );
    }

    // Helper methods to parse JSON columns
    private List<T>? ParseJsonArray<T>(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<List<T>>(json);
        }
        catch
        {
            return null;
        }
    }

    private List<LeadPhone>? ParseJsonPhones(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var items = JsonSerializer.Deserialize<List<JsonElement>>(json);
            return items?.Select((item, index) => new LeadPhone
            {
                LeadPhoneId = index + 1,
                LeadId = 0,
                PhoneNumber = item.TryGetProperty("phone", out var ph) ? ph.GetString() ?? "" :
                              item.TryGetProperty("phone_number", out var pn) ? pn.GetString() ?? "" : "",
                PhoneType = item.TryGetProperty("type", out var type) ? type.GetString() : null
            }).ToList();
        }
        catch
        {
            return null;
        }
    }

    private List<LeadEmail>? ParseJsonEmails(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var items = JsonSerializer.Deserialize<List<JsonElement>>(json);
            return items?.Select((item, index) => new LeadEmail
            {
                LeadEmailId = index + 1,
                LeadId = 0,
                EmailAddress = item.TryGetProperty("email", out var em) ? em.GetString() ?? "" :
                               item.TryGetProperty("email_address", out var ea) ? ea.GetString() ?? "" : "",
                EmailType = item.TryGetProperty("type", out var type) ? type.GetString() : null
            }).ToList();
        }
        catch
        {
            return null;
        }
    }

    private List<LeadAddress>? ParseJsonAddresses(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var items = JsonSerializer.Deserialize<List<JsonElement>>(json);
            return items?.Select((item, index) => new LeadAddress
            {
                LeadAddressId = index + 1,
                LeadId = 0,
                AddressText = item.TryGetProperty("address", out var addr) ? addr.GetString() :
                              item.TryGetProperty("address_text", out var at) ? at.GetString() : null,
                AddressType = item.TryGetProperty("type", out var type) ? type.GetString() :
                              item.TryGetProperty("address_type", out var atype) ? atype.GetString() : null,
                City = item.TryGetProperty("city", out var city) ? city.GetString() : null,
                State = item.TryGetProperty("state", out var state) ? state.GetString() : null,
                Country = item.TryGetProperty("country", out var country) ? country.GetString() : null,
                PinCode = item.TryGetProperty("pincode", out var pincode) ? pincode.GetString() :
                          item.TryGetProperty("pin_code", out var pc) ? pc.GetString() : null
            }).ToList();
        }
        catch
        {
            return null;
        }
    }

    private List<LeadWebsite>? ParseJsonWebsites(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var urls = JsonSerializer.Deserialize<List<string>>(json);
            return urls?.Select((url, index) => new LeadWebsite
            {
                LeadWebsiteId = index + 1,
                LeadId = 0,
                WebsiteUrl = url
            }).ToList();
        }
        catch
        {
            return null;
        }
    }

    private List<LeadServiceModel>? ParseJsonServices(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var services = JsonSerializer.Deserialize<List<string>>(json);
            return services?.Select((service, index) => new LeadServiceModel
            {
                LeadServiceId = index + 1,
                LeadId = 0,
                ServiceText = service
            }).ToList();
        }
        catch
        {
            return null;
        }
    }

    private List<LeadBrand>? ParseJsonBrands(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var items = JsonSerializer.Deserialize<List<JsonElement>>(json);
            return items?.Select((item, index) => new LeadBrand
            {
                LeadBrandId = index + 1,
                LeadId = 0,
                BrandName = item.TryGetProperty("brand", out var b) ? b.GetString() ?? "" :
                            item.TryGetProperty("brand_name", out var bn) ? bn.GetString() ?? "" : "",
                Relationship = item.TryGetProperty("relationship", out var rel) ? rel.GetString() : null
            }).ToList();
        }
        catch
        {
            return null;
        }
    }

    private List<LeadTopic>? ParseJsonTopics(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var topics = JsonSerializer.Deserialize<List<string>>(json);
            return topics?.Select((topic, index) => new LeadTopic
            {
                LeadTopicId = index + 1,
                LeadId = 0,
                TopicText = topic
            }).ToList();
        }
        catch
        {
            return null;
        }
    }

    public async Task<(List<LeadListDto> Leads, int TotalCount)> GetLeadsAsync(LeadQueryParams queryParams)
    {
        using var conn = _db.CreateConnection();

        var whereClause = "WHERE 1=1";
        var parameters = new DynamicParameters();

        if (queryParams.ExhibitionId.HasValue)
        {
            whereClause += " AND l.ExhibitionId = @ExhibitionId";
            parameters.Add("ExhibitionId", queryParams.ExhibitionId.Value);
        }

        if (!string.IsNullOrEmpty(queryParams.SourceCode))
        {
            whereClause += " AND l.SourceCode = @SourceCode";
            parameters.Add("SourceCode", queryParams.SourceCode);
        }

        if (!string.IsNullOrEmpty(queryParams.StatusCode))
        {
            whereClause += " AND l.StatusCode = @StatusCode";
            parameters.Add("StatusCode", queryParams.StatusCode);
        }

        if (queryParams.AssignedEmployeeId.HasValue)
        {
            whereClause += " AND l.AssignedEmployeeId = @AssignedEmployeeId";
            parameters.Add("AssignedEmployeeId", queryParams.AssignedEmployeeId.Value);
        }

        if (!string.IsNullOrEmpty(queryParams.Service))
        {
            whereClause += " AND EXISTS (SELECT 1 FROM OPENJSON(l.Services) WHERE value LIKE @Service)";
            parameters.Add("Service", $"%{queryParams.Service}%");
        }

        // Tenant isolation: super admins see everything; regular users see only their company's data
        if (!queryParams.IsSuperAdmin && queryParams.TenantId.HasValue)
        {
            whereClause += " AND l.TenantId = @TenantId";
            parameters.Add("TenantId", queryParams.TenantId.Value);
        }

        // Get count
        var totalCount = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM Leads l {whereClause}", parameters);

        // Get leads
        parameters.Add("Offset", queryParams.Offset);
        parameters.Add("Limit", queryParams.Limit);

        var sql = $@"
            SELECT l.LeadId, l.ExhibitionId, e.Name as ExhibitionName,
                   l.CompanyName, l.PrimaryVisitorName, l.PrimaryVisitorDesignation,
                   l.PrimaryVisitorPhone, l.Segment, l.Priority, l.StatusCode, l.CreatedAt, l.CrmLedgerId,
                   JSON_VALUE(l.Addresses, '$[0].city') as City,
                   JSON_VALUE(l.Addresses, '$[0].state') as State,
                   l.Services as ServicesJson,
                   l.PrimaryVisitorEmail, l.Category, l.TurnOver, l.TeamSize, l.Vertical,
                   tc.CompanyName as TenantName
            FROM Leads l
            LEFT JOIN Exhibitions e ON l.ExhibitionId = e.ExhibitionId
            LEFT JOIN Companies tc ON tc.CompanyId = l.TenantId
            {whereClause}
            ORDER BY l.CreatedAt DESC
            OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY";

        var leads = (await conn.QueryAsync<LeadListDto>(sql, parameters)).ToList();

        return (leads, totalCount);
    }

    public async Task<int> CreateLeadAsync(CreateLeadDto dto)
    {
        using var conn = _db.CreateConnection();

        // Use 'manual_entry' as default source code if not provided
        var sourceCode = dto.SourceCode ?? "manual_entry";

        var sql = @"
            INSERT INTO Leads (ExhibitionId, SourceCode, StatusCode, AssignedEmployeeId,
                              CompanyName, PrimaryVisitorName, PrimaryVisitorPhone, PrimaryVisitorEmail,
                              PrimaryVisitorDesignation, DiscussionSummary, Segment, Priority, TenantId, CreatedAt)
            OUTPUT INSERTED.LeadId
            VALUES (@ExhibitionId, @SourceCode, 'new', @AssignedEmployeeId,
                   @CompanyName, @PrimaryVisitorName, @PrimaryVisitorPhone, @PrimaryVisitorEmail,
                   @PrimaryVisitorDesignation, @DiscussionSummary, @Segment, @Priority, @TenantId, GETUTCDATE())";

        var parameters = new
        {
            dto.ExhibitionId,
            SourceCode = sourceCode,
            dto.AssignedEmployeeId,
            dto.CompanyName,
            dto.PrimaryVisitorName,
            dto.PrimaryVisitorPhone,
            dto.PrimaryVisitorEmail,
            dto.PrimaryVisitorDesignation,
            dto.DiscussionSummary,
            dto.Segment,
            dto.Priority,
            dto.TenantId
        };

        var leadId = await conn.ExecuteScalarAsync<int>(sql, parameters);
        _logger.LogInformation("Created lead {LeadId} with source code {SourceCode}", leadId, sourceCode);
        return leadId;
    }

    public async Task UpdateLeadAsync(int leadId, UpdateLeadDto dto, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();

        // Tenant isolation: regular users may only update leads in their own company
        if (!isSuperAdmin)
        {
            var ownerTenant = await conn.ExecuteScalarAsync<int?>(
                "SELECT TenantId FROM Leads WHERE LeadId = @LeadId", new { LeadId = leadId });
            if (ownerTenant == null || ownerTenant != tenantId)
                throw new KeyNotFoundException($"Lead {leadId} not found");
        }

        var updates = new List<string>();
        var parameters = new DynamicParameters();
        parameters.Add("LeadId", leadId);

        if (dto.CompanyName != null) { updates.Add("CompanyName = @CompanyName"); parameters.Add("CompanyName", dto.CompanyName); }
        if (dto.PrimaryVisitorName != null) { updates.Add("PrimaryVisitorName = @PrimaryVisitorName"); parameters.Add("PrimaryVisitorName", dto.PrimaryVisitorName); }
        if (dto.PrimaryVisitorDesignation != null) { updates.Add("PrimaryVisitorDesignation = @PrimaryVisitorDesignation"); parameters.Add("PrimaryVisitorDesignation", dto.PrimaryVisitorDesignation); }
        if (dto.PrimaryVisitorPhone != null) { updates.Add("PrimaryVisitorPhone = @PrimaryVisitorPhone"); parameters.Add("PrimaryVisitorPhone", dto.PrimaryVisitorPhone); }
        if (dto.PrimaryVisitorEmail != null) { updates.Add("PrimaryVisitorEmail = @PrimaryVisitorEmail"); parameters.Add("PrimaryVisitorEmail", dto.PrimaryVisitorEmail); }
        if (dto.Segment != null) { updates.Add("Segment = @Segment"); parameters.Add("Segment", dto.Segment); }
        if (dto.Priority != null) { updates.Add("Priority = @Priority"); parameters.Add("Priority", dto.Priority); }
        if (dto.StatusCode != null) { updates.Add("StatusCode = @StatusCode"); parameters.Add("StatusCode", dto.StatusCode); }
        if (dto.DiscussionSummary != null) { updates.Add("DiscussionSummary = @DiscussionSummary"); parameters.Add("DiscussionSummary", dto.DiscussionSummary); }
        if (dto.Services != null)
        {
            var servicesJson = System.Text.Json.JsonSerializer.Serialize(dto.Services);
            updates.Add("Services = @Services");
            parameters.Add("Services", servicesJson);
        }
        if (dto.Category != null) { updates.Add("Category = @Category"); parameters.Add("Category", dto.Category); }
        if (dto.TurnOver != null) { updates.Add("TurnOver = @TurnOver"); parameters.Add("TurnOver", dto.TurnOver); }
        if (dto.TeamSize != null) { updates.Add("TeamSize = @TeamSize"); parameters.Add("TeamSize", dto.TeamSize); }
        if (dto.Vertical != null) { updates.Add("Vertical = @Vertical"); parameters.Add("Vertical", dto.Vertical); }

        if (updates.Count == 0) return;

        updates.Add("UpdatedAt = GETUTCDATE()");

        var sql = $"UPDATE Leads SET {string.Join(", ", updates)} WHERE LeadId = @LeadId";
        await conn.ExecuteAsync(sql, parameters);

        _logger.LogInformation("Updated lead {LeadId}", leadId);
    }

    public async Task DeleteLeadAsync(int leadId, int? tenantId = null, bool isSuperAdmin = false)
    {
        using var conn = _db.CreateConnection();

        // Hard delete - the database will cascade delete all related data (messages, attachments, persons, etc.)
        // because all foreign keys are configured with ON DELETE CASCADE

        // First get the lead to log the deletion (tenant-scoped so users can't delete other companies' leads)
        var tenantClause = isSuperAdmin ? "" : " AND TenantId = @TenantId";
        var lead = await conn.QueryFirstOrDefaultAsync<Lead>(
            $"SELECT * FROM Leads WHERE LeadId = @LeadId{tenantClause}",
            new { LeadId = leadId, TenantId = tenantId });

        if (lead == null)
            throw new KeyNotFoundException($"Lead {leadId} not found");

        // Single delete statement - cascade will handle related data
        await conn.ExecuteAsync("DELETE FROM Leads WHERE LeadId = @LeadId", new { LeadId = leadId });
        
        _logger.LogInformation("Hard deleted lead {LeadId}: {VisitorName} ({Company})", 
            leadId, lead.PrimaryVisitorName, lead.CompanyName);
    }

    public async Task<int> AddMessageAsync(int leadId, string senderType, string text, int? employeeId = null)
    {
        using var conn = _db.CreateConnection();

        var sql = @"
            INSERT INTO LeadMessages (LeadId, SenderType, SenderEmployeeId, MessageText, CreatedAt)
            OUTPUT INSERTED.MessageId
            VALUES (@LeadId, @SenderType, @SenderEmployeeId, @MessageText, GETUTCDATE())";

        return await conn.ExecuteScalarAsync<int>(sql, new
        {
            LeadId = leadId,
            SenderType = senderType,
            SenderEmployeeId = employeeId,
            MessageText = text
        });
    }

    public async Task<List<LeadMessage>> GetMessagesAsync(int leadId)
    {
        using var conn = _db.CreateConnection();
        // Order by MessageId to ensure consistent ordering when timestamps are identical
        return (await conn.QueryAsync<LeadMessage>(
            "SELECT * FROM LeadMessages WHERE LeadId = @LeadId ORDER BY MessageId ASC",
            new { LeadId = leadId })).ToList();
    }

    public async Task<List<LeadListDto>> SearchLeadsByNameAsync(string name)
    {
        using var conn = _db.CreateConnection();
        var sql = @"
            SELECT
                l.LeadId,
                l.ExhibitionId,
                e.Name as ExhibitionName,
                l.CompanyName,
                l.PrimaryVisitorName,
                l.PrimaryVisitorDesignation,
                l.PrimaryVisitorPhone,
                l.Segment,
                l.Priority,
                l.StatusCode,
                l.CreatedAt,
                l.CrmLedgerId,
                JSON_VALUE(l.Addresses, '$[0].city') as City,
                JSON_VALUE(l.Addresses, '$[0].state') as State
            FROM Leads l
            LEFT JOIN Exhibitions e ON l.ExhibitionId = e.ExhibitionId
            WHERE l.PrimaryVisitorName LIKE '%' + @Name + '%'
               OR l.CompanyName LIKE '%' + @Name + '%'
            ORDER BY l.CreatedAt DESC";

        _logger.LogInformation("Searching for leads with name: '{Name}'", name);
        var results = (await conn.QueryAsync<LeadListDto>(sql, new { Name = name })).ToList();
        _logger.LogInformation("Found {Count} leads matching '{Name}': {Leads}",
            results.Count, name, string.Join(", ", results.Select(l => $"{l.PrimaryVisitorName} ({l.LeadId})")));
        return results;
    }

    public async Task<(bool Success, string? Error, long? LedgerId, string? LedgerCode)> PushToCrmAsync(int leadId, int? tenantId = null, bool isSuperAdmin = false)
    {
        // --- Config ---
        var crmConnStr    = _config.GetConnectionString("CRMConnection")
            ?? throw new InvalidOperationException("CRMConnection not configured in appsettings.json");
        var companyId     = _config.GetValue<int>("CRM:CompanyId", 2);
        var ledgerGroupId = _config.GetValue<int>("CRM:LedgerGroupId", 1);
        var prefix        = _config["CRM:LedgerCodePrefix"] ?? "C";
        var ledgerType    = _config["CRM:LedgerType"] ?? "Sundry Debtors";
        var sysUserId     = _config.GetValue<int>("CRM:SystemUserId", 2);

        // --- Load lead detail (tenant-scoped) ---
        var detail = await GetLeadDetailAsync(leadId, tenantId, isSuperAdmin);
        if (detail == null) return (false, "Lead not found", null, null);

        var lead = detail.Lead;
        if (lead.CrmLedgerId.HasValue)
            return (false, $"Already pushed to CRM (LedgerID={lead.CrmLedgerId})", null, null);

        // --- Resolve contact fields ---
        var phone   = detail.Phones.FirstOrDefault()?.PhoneNumber ?? lead.PrimaryVisitorPhone ?? "";
        var email   = detail.Emails.FirstOrDefault()?.EmailAddress ?? lead.PrimaryVisitorEmail ?? "";
        var website = detail.Websites.FirstOrDefault()?.WebsiteUrl ?? "";
        var addr    = detail.Addresses.FirstOrDefault();
        var addr1   = addr?.AddressText ?? "";
        var city    = addr?.City ?? "";
        var state   = addr?.State ?? "";
        var country = addr?.Country ?? "";
        var pincode = addr?.PinCode ?? "";
        var mailingAddress = string.Join(", ",
            new[] { addr1, city, state, country }.Where(p => !string.IsNullOrWhiteSpace(p)));

        var ledgerName   = !string.IsNullOrWhiteSpace(lead.CompanyName) ? lead.CompanyName : (lead.PrimaryVisitorName ?? "Unknown");
        var fYear        = GetCurrentFinancialYear();
        var now          = DateTime.UtcNow;
        var leadStatus   = MapLeadStatus(lead.StatusCode);
        var custCategory = MapSegmentToCategory(lead.Segment);

        // Use a dedicated connection to the CRM/ERP server (different server than ELCS)
        using var crmConn = new SqlConnection(crmConnStr);
        await crmConn.OpenAsync();
        using var crmTx = crmConn.BeginTransaction();

        try
        {
            // --- Generate LedgerCode within transaction to prevent race conditions ---
            var maxNo = await crmConn.ExecuteScalarAsync<long>(
                "SELECT ISNULL(MAX(MaxLedgerNo), 0) FROM LedgerMaster WHERE LedgerCodePrefix = @Prefix",
                new { Prefix = prefix }, crmTx);
            var newMaxNo   = maxNo + 1;
            var ledgerCode = prefix + newMaxNo.ToString("D5");
            var ledgerDesc = $"{ledgerType}:{ledgerName}";

            // --- Insert LedgerMaster ---
            const string insertLmSql = @"
                INSERT INTO LedgerMaster
                (
                    LedgerCode, MaxLedgerNo, LedgerCodePrefix, LedgerName, LedgerDescription,
                    LedgerUnitID, LedgerType, LedgerGroupID, ISLedgerActive,
                    CompanyID, UserID, CreatedDate, ModifiedDate,
                    IsDeleted, IsBlocked, FYear, IsLocked, CreatedBy, ModifiedBy,
                    DeletedBy, IsDeletedTransaction,
                    MailingName, MailingAddress, Address1, Address2,
                    City, District, State, Country, Pincode,
                    MobileNo, Email, Website, Designation,
                    LegalName, TradeName,
                    ContactPersonName, ContactPersonNumber,
                    Remarks, SalesPersonName, CustomerCategory, Source,
                    isLead, isClient, LeadStatus, Status,
                    InventoryEffect, IsTaxType, MaintainBillWise, IsCumulative,
                    IsIntegrated, IsClientApproval, GSTApplicable,
                    DepartmentID, ProductionUnitID, RefLedgerID, RefClientID,
                    RefSalesRepresentativeID, TaxPercentage, TaxRatePer, InAmount,
                    Distance, DeliveredQtyTolerance, expected_revenue,
                    pipeline_stage_id, MaxCreditLimit, MaxCreditPeriod, FixedLimit,
                    DateOfBirth
                )
                OUTPUT INSERTED.LedgerID
                VALUES
                (
                    @LedgerCode, @MaxLedgerNo, @Prefix, @LedgerName, @LedgerDesc,
                    0, @LedgerType, @LedgerGroupId, 1,
                    @CompanyId, @UserId, @Now, @Now,
                    0, 0, @FYear, 0, @UserId, @UserId,
                    0, 0,
                    @LedgerName, @MailingAddress, @Addr1, '',
                    @City, @City, @State, @Country, @Pincode,
                    @Phone, @Email, @Website, @Designation,
                    @LedgerName, @LedgerName,
                    @ContactName, @Phone,
                    @Remarks, '', @CustCategory, @Source,
                    1, 0, @LeadStatus, 'Active',
                    0, 0, 0, 0,
                    0, 1, 0,
                    0, 0, 0, 0,
                    0, 0, 0, 0,
                    0, 0, 0,
                    1, 0, 0, 0,
                    '1900-01-01'
                )";

            var ledgerId = await crmConn.ExecuteScalarAsync<long>(insertLmSql, new
            {
                LedgerCode    = ledgerCode,
                MaxLedgerNo   = newMaxNo,
                Prefix        = prefix,
                LedgerName    = ledgerName,
                LedgerDesc    = ledgerDesc,
                LedgerType    = ledgerType,
                LedgerGroupId = ledgerGroupId,
                CompanyId     = companyId,
                UserId        = sysUserId,
                Now           = now,
                FYear         = fYear,
                MailingAddress = mailingAddress,
                Addr1         = addr1,
                City          = city,
                State         = state,
                Country       = country,
                Pincode       = pincode,
                Phone         = phone,
                Email         = email,
                Website       = website,
                Designation   = lead.PrimaryVisitorDesignation ?? "",
                ContactName   = lead.PrimaryVisitorName ?? "",
                Remarks       = lead.DiscussionSummary ?? "",
                CustCategory  = custCategory,
                Source        = "VistingCard",
                LeadStatus    = leadStatus,
            }, crmTx);

            // --- Insert LedgerMasterDetails ---
            var detailRows = BuildLedgerDetails(ledgerName, mailingAddress, addr1,
                city, state, country, phone, email);

            foreach (var (fieldName, fieldValue, seqNo) in detailRows)
            {
                if (string.IsNullOrWhiteSpace(fieldValue)) continue;
                await crmConn.ExecuteAsync(@"
                    INSERT INTO LedgerMasterDetails
                    (ParentLedgerID, ParentFieldName, ParentFieldValue,
                     LedgerID, FieldID, FieldName, FieldValue, SequenceNo,
                     LedgerGroupID, CompanyID, UserID, CreatedDate, ModifiedDate,
                     IsDeleted, IsBlocked, FYear, IsLocked, CreatedBy, ModifiedBy,
                     DeletedBy, IsActive, IsDeletedTransaction, ProductionUnitID)
                    VALUES
                    (0, @FieldName, @FieldValue,
                     @LedgerId, 0, @FieldName, @FieldValue, @SeqNo,
                     @LedgerGroupId, @CompanyId, @UserId, @Now, @Now,
                     0, 0, @FYear, 0, @UserId, @UserId,
                     0, 0, 0, 0)",
                    new
                    {
                        FieldName     = fieldName,
                        FieldValue    = fieldValue,
                        LedgerId      = ledgerId,
                        SeqNo         = seqNo,
                        LedgerGroupId = ledgerGroupId,
                        CompanyId     = companyId,
                        UserId        = sysUserId,
                        Now           = now,
                        FYear         = fYear,
                    }, crmTx);
            }

            crmTx.Commit();
            _logger.LogInformation("Lead {LeadId} pushed to CRM as LedgerID={LedgerId} Code={LedgerCode}", leadId, ledgerId, ledgerCode);

            // --- Mark lead as pushed in ELCS (separate connection, best-effort) ---
            using var elcsConn = _db.CreateConnection();
            await elcsConn.ExecuteAsync(
                "UPDATE Leads SET CrmLedgerId = @LedgerId, UpdatedAt = GETUTCDATE() WHERE LeadId = @LeadId",
                new { LedgerId = ledgerId, LeadId = leadId });

            return (true, null, ledgerId, ledgerCode);
        }
        catch (Exception ex)
        {
            crmTx.Rollback();
            _logger.LogError(ex, "Failed to push lead {LeadId} to CRM", leadId);
            return (false, ex.Message, null, null);
        }
    }

    private static string GetCurrentFinancialYear()
    {
        var now = DateTime.Now;
        var startYear = now.Month >= 4 ? now.Year : now.Year - 1;
        return $"{startYear}-{startYear + 1}";
    }

    private static string MapLeadStatus(string? statusCode) => statusCode switch
    {
        "confirmed"        => "Won",
        "contacted"        => "Contacted",
        "needs_correction" => "Needs Review",
        _                  => "New Lead"
    };

    private static string MapSegmentToCategory(string? segment) => segment switch
    {
        "decision_maker" => "Decision Maker",
        "influencer"     => "Influencer",
        "researcher"     => "Researcher",
        "general"        => "General",
        _                => ""
    };

    private static IEnumerable<(string FieldName, string FieldValue, byte SeqNo)> BuildLedgerDetails(
        string ledgerName, string mailingAddress,
        string addr1, string city, string state, string country,
        string phone, string email)
    {
        yield return ("LedgerName",         ledgerName,       1);
        yield return ("MailingName",        ledgerName,       2);
        if (!string.IsNullOrWhiteSpace(addr1))
            yield return ("Address1",       addr1,            3);
        if (!string.IsNullOrWhiteSpace(country))
            yield return ("Country",        country,          5);
        if (!string.IsNullOrWhiteSpace(state))
            yield return ("State",          state,            6);
        if (!string.IsNullOrWhiteSpace(city))
            yield return ("City",           city,             7);
        if (!string.IsNullOrWhiteSpace(mailingAddress))
            yield return ("MailingAddress", mailingAddress,   8);
        if (!string.IsNullOrWhiteSpace(phone))
            yield return ("MobileNo",       phone,            10);
        if (!string.IsNullOrWhiteSpace(email))
            yield return ("Email",          email,            11);
        yield return ("LegalName",          ledgerName,       14);
        yield return ("SupplyTypeCode",     "Not Applicable", 15);
        yield return ("CreditDays",         "0",              16);
        yield return ("GSTRegistrationType","Regular",        17);
        yield return ("Source",             "VistingCard",    18);
        yield return ("ISLedgerActive",     "True",           0);
        yield return ("GSTApplicable",      "False",          19);
    }
}


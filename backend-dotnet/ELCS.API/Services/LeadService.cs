using Dapper;
using ELCS.API.Data;
using ELCS.API.Models;
using ELCS.API.Utils;
using System.Text.Json;

namespace ELCS.API.Services;

public class LeadService : ILeadService
{
    private readonly ILogger<LeadService> _logger;
    private readonly IDbConnection _db;

    public LeadService(ILogger<LeadService> logger, IDbConnection db)
    {
        _logger = logger;
        _db = db;
    }

    public async Task<Lead?> GetLeadByIdAsync(int leadId)
    {
        using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<Lead>(
            "SELECT * FROM Leads WHERE LeadId = @LeadId",
            new { LeadId = leadId });
    }

    public async Task<LeadDetailDto?> GetLeadDetailAsync(int leadId)
    {
        using var conn = _db.CreateConnection();

        var lead = await conn.QueryFirstOrDefaultAsync<Lead>(@"
            SELECT l.*, e.Name AS ExhibitionName
            FROM Leads l
            LEFT JOIN Exhibitions e ON e.ExhibitionId = l.ExhibitionId
            WHERE l.LeadId = @LeadId",
            new { LeadId = leadId });

        if (lead == null) return null;

        // Parse JSON columns into lists
        var persons = ParseJsonArray<LeadPerson>(lead.AdditionalPersons) ?? new List<LeadPerson>();
        var phones = ParseJsonPhones(lead.PhoneNumbers) ?? new List<LeadPhone>();
        var emails = ParseJsonEmails(lead.EmailAddresses) ?? new List<LeadEmail>();
        var addresses = ParseJsonAddresses(lead.Addresses) ?? new List<LeadAddress>();
        var websites = ParseJsonWebsites(lead.Websites) ?? new List<LeadWebsite>();
        var brands = ParseJsonBrands(lead.Brands) ?? new List<LeadBrand>();
        var topics = ParseJsonTopics(lead.Topics) ?? new List<LeadTopic>();

        var messages = (await conn.QueryAsync<LeadMessage>(
            "SELECT * FROM LeadMessages WHERE LeadId = @LeadId ORDER BY MessageId ASC",
            new { LeadId = leadId })).ToList();

        var orderValue = await conn.ExecuteScalarAsync<decimal?>(@"
            SELECT SUM(COALESCE(OrderValue, OrderTotal))
            FROM Orders WHERE LeadId = @LeadId AND StatusCode <> 'cancelled'",
            new { LeadId = leadId }) ?? 0m;

        var orderStatus = await conn.ExecuteScalarAsync<string?>(@"
            SELECT TOP 1 StatusCode FROM Orders
            WHERE LeadId = @LeadId ORDER BY CreatedAt DESC",
            new { LeadId = leadId });

        return new LeadDetailDto(
            Lead: lead,
            Persons: persons,
            Addresses: addresses,
            Websites: websites,
            Topics: topics,
            Messages: messages,
            Brands: brands,
            Phones: phones,
            Emails: emails,
            OrderValue: orderValue,
            OrderStatus: orderStatus
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

    /// <summary>
    /// Serialises a list into the shape the Parse* readers above expect, or NULL
    /// when there is nothing to store. NULL rather than "[]" so an empty field
    /// leaves the column untouched-looking and the readers short-circuit.
    /// </summary>
    private static string? JsonListOrNull<T>(List<string>? values, Func<string, T> shape)
    {
        var cleaned = values?
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Select(v => v.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return cleaned is { Count: > 0 }
            ? JsonSerializer.Serialize(cleaned.Select(shape))
            : null;
    }

    /// <summary>
    /// City and State have no columns of their own — the list views read them
    /// back with JSON_VALUE(Addresses, '$[0].city'), so they only exist inside
    /// this object. A lead with a city but no street still gets a row.
    /// </summary>
    private static string? JsonAddressOrNull(string? address, string? city, string? state)
    {
        if (string.IsNullOrWhiteSpace(address) &&
            string.IsNullOrWhiteSpace(city) &&
            string.IsNullOrWhiteSpace(state))
            return null;

        return JsonSerializer.Serialize(new[]
        {
            new
            {
                address = Trimmed(address),
                city    = Trimmed(city),
                state   = Trimmed(state),
                country = (string?)null,
                pincode = (string?)null,
                type    = (string?)null,
            },
        });

        static string? Trimmed(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
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

        // Get count
        var totalCount = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM Leads l {whereClause}", parameters);

        // Get leads
        parameters.Add("Offset", queryParams.Offset);
        parameters.Add("Limit", queryParams.Limit);

        var sql = $@"
            SELECT l.LeadId, l.ExhibitionId, e.Name as ExhibitionName,
                   l.CompanyName, l.PrimaryVisitorName, l.PrimaryVisitorDesignation,
                   l.PrimaryVisitorPhone, l.Priority, l.StatusCode, l.CreatedAt,
                   JSON_VALUE(l.Addresses, '$[0].city') as City,
                   JSON_VALUE(l.Addresses, '$[0].state') as State,
                   l.PrimaryVisitorEmail,
                   ISNULL(agg.OrderValue, 0) AS OrderValue,
                   latest.StatusCode AS OrderStatus
            FROM Leads l
            LEFT JOIN Exhibitions e ON l.ExhibitionId = e.ExhibitionId
            OUTER APPLY (
                SELECT SUM(COALESCE(o.OrderValue, o.OrderTotal)) AS OrderValue
                FROM Orders o WHERE o.LeadId = l.LeadId AND o.StatusCode <> 'cancelled'
            ) agg
            OUTER APPLY (
                SELECT TOP 1 o2.StatusCode
                FROM Orders o2 WHERE o2.LeadId = l.LeadId
                ORDER BY o2.CreatedAt DESC
            ) latest
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

        // Reachable directly, not just through the form that already checks
        // this — a malformed number here breaks WhatsApp sends and the
        // self-service QR match silently, long after entry.
        var allPhones = new List<string?> { dto.PrimaryVisitorPhone }.Concat(dto.Phones ?? new List<string>())
            .Where(p => !string.IsNullOrWhiteSpace(p));
        foreach (var p in allPhones)
        {
            if (!PhoneValidator.IsValid(p!))
                throw new ArgumentException($"\"{p}\" is not a valid mobile number — foreign numbers need a leading +");
        }

        // A mobile number identifies a person, so it may appear on only one
        // lead. Two leads sharing a number split that customer's orders,
        // coupons and WhatsApp history in half — and the self-service page
        // matches on phone, so the QR would reach whichever it found first.
        //
        // Compared on digits only: the same number is stored as "9691139890",
        // "+91 9691139890" and "096911 39890" depending on who typed it.
        var phone = dto.PrimaryVisitorPhone ?? dto.Phones?.FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(phone))
        {
            var digits = new string(phone.Where(char.IsDigit).ToArray());
            if (digits.Length >= 10)
            {
                var last10 = digits[^10..];
                // Compares the PERSISTED, INDEXED column directly — not a
                // function of it — so this is an index seek, not a table
                // scan. See migration 026.
                var clash = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT TOP 1 LeadId, PrimaryVisitorName, CompanyName
                    FROM Leads
                    WHERE PhoneLast10 = @Last10
                    ORDER BY CreatedAt DESC",
                    new { Last10 = last10 });

                if (clash != null)
                {
                    var who = (string?)clash.PrimaryVisitorName ?? (string?)clash.CompanyName ?? "an existing lead";
                    throw new InvalidOperationException(
                        $"{phone} already belongs to {who} (lead #{clash.LeadId}). " +
                        "Open that lead and add the order to it, or use a different number.");
                }
            }
        }

        var sql = @"
            INSERT INTO Leads (ExhibitionId, SourceCode, StatusCode, AssignedEmployeeId,
                              CompanyName, PrimaryVisitorName, PrimaryVisitorPhone, PrimaryVisitorEmail,
                              PrimaryVisitorDesignation, DiscussionSummary, Priority,
                              GstNumber, PhoneNumbers, EmailAddresses, Websites, Addresses, CreatedAt)
            OUTPUT INSERTED.LeadId
            VALUES (@ExhibitionId, @SourceCode, 'new', @AssignedEmployeeId,
                   @CompanyName, @PrimaryVisitorName, @PrimaryVisitorPhone, @PrimaryVisitorEmail,
                   @PrimaryVisitorDesignation, @DiscussionSummary, @Priority,
                   @GstNumber, @PhoneNumbers, @EmailAddresses, @Websites, @Addresses, GETUTCDATE())";

        var parameters = new
        {
            dto.ExhibitionId,
            SourceCode = sourceCode,
            dto.AssignedEmployeeId,
            dto.CompanyName,
            dto.PrimaryVisitorName,
            // The primary falls back to the first of the list, so an operator who
            // typed only into the repeatable field still gets a usable lead.
            PrimaryVisitorPhone = dto.PrimaryVisitorPhone ?? dto.Phones?.FirstOrDefault(),
            PrimaryVisitorEmail = dto.PrimaryVisitorEmail ?? dto.Emails?.FirstOrDefault(),
            dto.PrimaryVisitorDesignation,
            dto.DiscussionSummary,
            dto.Priority,
            dto.GstNumber,
            PhoneNumbers   = JsonListOrNull(dto.Phones, v => new { phone = v, type = (string?)null }),
            EmailAddresses = JsonListOrNull(dto.Emails, v => new { email = v, type = (string?)null }),
            // Websites are a bare string array on read, so they must be written
            // that way too — see ParseJsonWebsites.
            Websites       = JsonListOrNull(dto.Websites, v => v),
            Addresses      = JsonAddressOrNull(dto.Address, dto.City, dto.State),
        };

        var leadId = await conn.ExecuteScalarAsync<int>(sql, parameters);
        _logger.LogInformation("Created lead {LeadId} with source code {SourceCode}", leadId, sourceCode);
        return leadId;
    }

    public async Task UpdateLeadAsync(int leadId, UpdateLeadDto dto)
    {
        using var conn = _db.CreateConnection();

        var exists = await conn.ExecuteScalarAsync<int?>(
            "SELECT LeadId FROM Leads WHERE LeadId = @LeadId", new { LeadId = leadId });
        if (exists == null)
            throw new KeyNotFoundException($"Lead {leadId} not found");

        var updates = new List<string>();
        var parameters = new DynamicParameters();
        parameters.Add("LeadId", leadId);

        if (dto.CompanyName != null) { updates.Add("CompanyName = @CompanyName"); parameters.Add("CompanyName", dto.CompanyName); }
        if (dto.PrimaryVisitorName != null) { updates.Add("PrimaryVisitorName = @PrimaryVisitorName"); parameters.Add("PrimaryVisitorName", dto.PrimaryVisitorName); }
        if (dto.PrimaryVisitorDesignation != null) { updates.Add("PrimaryVisitorDesignation = @PrimaryVisitorDesignation"); parameters.Add("PrimaryVisitorDesignation", dto.PrimaryVisitorDesignation); }
        if (dto.PrimaryVisitorPhone != null)
        {
            // Empty clears the number — only a non-empty value must parse.
            if (dto.PrimaryVisitorPhone.Length > 0 && !PhoneValidator.IsValid(dto.PrimaryVisitorPhone))
                throw new ArgumentException($"\"{dto.PrimaryVisitorPhone}\" is not a valid 10-digit mobile number");
            updates.Add("PrimaryVisitorPhone = @PrimaryVisitorPhone"); parameters.Add("PrimaryVisitorPhone", dto.PrimaryVisitorPhone);
        }
        if (dto.PrimaryVisitorEmail != null) { updates.Add("PrimaryVisitorEmail = @PrimaryVisitorEmail"); parameters.Add("PrimaryVisitorEmail", dto.PrimaryVisitorEmail); }
        if (dto.Priority != null) { updates.Add("Priority = @Priority"); parameters.Add("Priority", dto.Priority); }
        if (dto.StatusCode != null) { updates.Add("StatusCode = @StatusCode"); parameters.Add("StatusCode", dto.StatusCode); }
        if (dto.DiscussionSummary != null) { updates.Add("DiscussionSummary = @DiscussionSummary"); parameters.Add("DiscussionSummary", dto.DiscussionSummary); }
        if (dto.GstNumber != null) { updates.Add("GstNumber = @GstNumber"); parameters.Add("GstNumber", dto.GstNumber); }

        if (updates.Count == 0) return;

        updates.Add("UpdatedAt = GETUTCDATE()");

        var sql = $"UPDATE Leads SET {string.Join(", ", updates)} WHERE LeadId = @LeadId";
        await conn.ExecuteAsync(sql, parameters);

        _logger.LogInformation("Updated lead {LeadId}", leadId);
    }

    public async Task DeleteLeadAsync(int leadId)
    {
        using var conn = _db.CreateConnection();

        // Hard delete - the database will cascade delete all related data (messages, attachments, persons, etc.)
        // because all foreign keys are configured with ON DELETE CASCADE

        // First get the lead to log the deletion
        var lead = await conn.QueryFirstOrDefaultAsync<Lead>(
            "SELECT * FROM Leads WHERE LeadId = @LeadId",
            new { LeadId = leadId });

        if (lead == null)
            throw new KeyNotFoundException($"Lead {leadId} not found");

        // Single delete statement - cascade will handle related data
        await conn.ExecuteAsync("DELETE FROM Leads WHERE LeadId = @LeadId", new { LeadId = leadId });
        
        _logger.LogInformation("Hard deleted lead {LeadId}: {VisitorName} ({Company})", 
            leadId, lead.PrimaryVisitorName, lead.CompanyName);
    }

    private sealed class LeadTokenRow { public string? PublicToken { get; set; } }

    public async Task<string> SetLeadPublicTokenAsync(int leadId, bool rotate)
    {
        using var conn = _db.CreateConnection();

        // A class, not a scalar: QueryFirstOrDefaultAsync returns a real null
        // when no row matches, so a typo'd id 404s instead of quietly minting
        // a token for nothing — a scalar string can't tell "no lead" apart
        // from "lead exists with a NULL token".
        var row = await conn.QueryFirstOrDefaultAsync<LeadTokenRow>(
            "SELECT PublicToken FROM Leads WHERE LeadId = @LeadId", new { LeadId = leadId });
        if (row == null)
            throw new KeyNotFoundException($"Lead {leadId} not found");

        if (!rotate && !string.IsNullOrWhiteSpace(row.PublicToken))
            return row.PublicToken;

        var token = Guid.NewGuid().ToString("N");
        await conn.ExecuteAsync(
            "UPDATE Leads SET PublicToken = @Token WHERE LeadId = @LeadId",
            new { Token = token, LeadId = leadId });

        _logger.LogInformation("Public ordering token {Action} for lead {LeadId}",
            rotate ? "rotated" : "minted", leadId);

        return token;
    }

    public async Task SetCouponOverrideAsync(int leadId, int? slab)
    {
        if (slab is < 0)
            throw new ArgumentException("Slab cannot be negative");

        using var conn = _db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            "UPDATE Leads SET CouponOverrideSlab = @Slab, UpdatedAt = GETUTCDATE() WHERE LeadId = @LeadId",
            new { Slab = slab, LeadId = leadId });

        if (rows == 0)
            throw new KeyNotFoundException($"Lead {leadId} not found");

        _logger.LogInformation("Coupon override for lead {LeadId} set to slab {Slab}",
            leadId, slab.HasValue ? slab.Value.ToString() : "cleared");
    }

    public async Task<List<string>> SetCouponNumbersAsync(int leadId, List<string> numbers)
    {
        using var conn = _db.CreateConnection();

        var exists = await conn.ExecuteScalarAsync<int?>(
            "SELECT LeadId FROM Leads WHERE LeadId = @LeadId", new { LeadId = leadId });
        if (exists == null)
            throw new KeyNotFoundException($"Lead {leadId} not found");

        var clean = (numbers ?? new List<string>())
            .Select(n => n?.Trim() ?? "")
            .Where(n => n.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        // A coupon number identifies one physical coupon, so it may sit against
        // only one lead. Same shape as the phone-number guard in
        // CreateLeadAsync: load what exists elsewhere and compare in memory,
        // since coupon numbers live in a JSON column rather than a queryable
        // table of their own.
        if (clean.Count > 0)
        {
            var others = await conn.QueryAsync<(int LeadId, string? Name, string? CompanyName, string? CouponNumbers)>(@"
                SELECT LeadId, PrimaryVisitorName AS Name, CompanyName, CouponNumbers
                FROM Leads
                WHERE LeadId <> @LeadId AND CouponNumbers IS NOT NULL",
                new { LeadId = leadId });

            foreach (var other in others)
            {
                List<string>? theirNumbers;
                try { theirNumbers = JsonSerializer.Deserialize<List<string>>(other.CouponNumbers!); }
                catch { continue; }
                if (theirNumbers == null) continue;

                var clash = clean.FirstOrDefault(n => theirNumbers.Contains(n, StringComparer.OrdinalIgnoreCase));
                if (clash != null)
                {
                    var who = other.Name ?? other.CompanyName ?? "another lead";
                    throw new InvalidOperationException(
                        $"Coupon {clash} is already recorded against {who} (lead #{other.LeadId}).");
                }
            }
        }

        var json = clean.Count > 0 ? JsonSerializer.Serialize(clean) : null;
        await conn.ExecuteAsync(
            "UPDATE Leads SET CouponNumbers = @Json, UpdatedAt = GETUTCDATE() WHERE LeadId = @LeadId",
            new { Json = json, LeadId = leadId });

        _logger.LogInformation("Lead {LeadId} coupon numbers set to [{Numbers}]", leadId, string.Join(", ", clean));
        return clean;
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
                l.Priority,
                l.StatusCode,
                l.CreatedAt,
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
}

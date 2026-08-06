using Dapper;
using ELCS.API.Data;
using ELCS.API.DTOs;
using ELCS.API.Models;
using System.Text.Json;

namespace ELCS.API.Services;

public class ExtractionService : IExtractionService
{
    private readonly ILogger<ExtractionService> _logger;
    private readonly IDbConnection _db;
    private readonly IOpenAIService _openAIService;
    private readonly string _uploadsRoot;

    public ExtractionService(
        ILogger<ExtractionService> logger,
        IDbConnection db,
        IOpenAIService openAIService,
        IWebHostEnvironment env)
    {
        _logger = logger;
        _db = db;
        _openAIService = openAIService;
        _uploadsRoot = Path.Combine(env.ContentRootPath, "uploads", "cards");
        Directory.CreateDirectory(_uploadsRoot);
    }

    public async Task<CardExtractionResponse> ExtractCardAsync(
        Stream frontImage,
        Stream? backImage,
        string frontFileName,
        string? backFileName,
        int exhibitionId,
        int employeeId)
    {
        using var conn = _db.CreateConnection();

        // Create lead first
        var leadId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO Leads (ExhibitionId, SourceCode, StatusCode, AssignedEmployeeId, CreatedAt)
            OUTPUT INSERTED.LeadId
            VALUES (@ExhibitionId, 'employee_scan', 'new', @EmployeeId, GETUTCDATE())",
            new { ExhibitionId = exhibitionId, EmployeeId = employeeId });

        _logger.LogInformation("Created lead {LeadId} for card extraction", leadId);

        try
        {
            // Save images to disk first, then open fresh streams for OpenAI
            var (frontPath, backPath) = await SaveCardImagesAsync(leadId.ToString(), frontImage, frontFileName, backImage, backFileName);

            CardExtractionData extractionData;
            await using (var frontForOcr = System.IO.File.OpenRead(frontPath))
            {
                Stream? backForOcr = backPath != null ? System.IO.File.OpenRead(backPath) : null;
                _logger.LogInformation("Extracting card with OpenAI Vision for lead {LeadId}", leadId);
                extractionData = await _openAIService.ExtractCardFromImagesAsync(frontForOcr, backForOcr);
                if (backForOcr is IAsyncDisposable ad) await ad.DisposeAsync();
                else backForOcr?.Dispose();
            }

            var duplicateCheck = await CheckForDuplicates(conn, extractionData, exhibitionId);
            var primaryPerson = extractionData.Persons.FirstOrDefault();
            var segmentInfo = SegmentLead(primaryPerson?.Designation);

            await UpdateLeadWithExtraction(conn, leadId, extractionData, segmentInfo, frontPath, backPath);
            await SaveLeadEntities(conn, leadId, extractionData);
            await AddSystemMessage(conn, leadId,
                $"Card scanned. Confidence: {extractionData.Confidence:P0} | Segment: {segmentInfo.Segment} (Priority {segmentInfo.Priority})",
                employeeId);

            _logger.LogInformation("Card extraction completed for lead {LeadId}", leadId);

            return new CardExtractionResponse(
                Success: true,
                LeadId: leadId,
                Extraction: extractionData,
                Segment: segmentInfo.Segment,
                Priority: segmentInfo.Priority,
                DuplicateCheck: duplicateCheck,
                Message: "Card extracted successfully."
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Card extraction failed for lead {LeadId}", leadId);
            throw;
        }
    }

    public async Task<CardExtractionResponse> ExtractCardPreviewAsync(
        Stream frontImage,
        Stream? backImage,
        string frontFileName,
        string? backFileName,
        int exhibitionId)
    {
        using var conn = _db.CreateConnection();

        try
        {
            // Save to temp folder so images survive the preview â†’ confirm round-trip
            var tempId = Guid.NewGuid().ToString("N");
            var (frontPath, backPath) = await SaveCardImagesAsync($"temp/{tempId}", frontImage, frontFileName, backImage, backFileName);

            CardExtractionData extractionData;
            await using (var frontForOcr = System.IO.File.OpenRead(frontPath))
            {
                Stream? backForOcr = backPath != null ? System.IO.File.OpenRead(backPath) : null;
                _logger.LogInformation("Extracting card with OpenAI Vision (preview mode)");
                extractionData = await _openAIService.ExtractCardFromImagesAsync(frontForOcr, backForOcr);
                if (backForOcr is IAsyncDisposable ad) await ad.DisposeAsync();
                else backForOcr?.Dispose();
            }

            var duplicateCheck = await CheckForDuplicates(conn, extractionData, exhibitionId);
            var primaryPerson = extractionData.Persons.FirstOrDefault();
            var segmentInfo = SegmentLead(primaryPerson?.Designation);

            _logger.LogInformation("Card preview extraction completed");

            return new CardExtractionResponse(
                Success: true,
                LeadId: 0,
                Extraction: extractionData,
                Segment: segmentInfo.Segment,
                Priority: segmentInfo.Priority,
                DuplicateCheck: duplicateCheck,
                Message: "Card extracted successfully. Please review and confirm to save.",
                TempId: tempId
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Card preview extraction failed");
            throw;
        }
    }

    /// <summary>
    /// Confirm and save lead from preview extraction data
    /// </summary>
    public async Task<CardExtractionResponse> ConfirmAndSaveLeadAsync(
        CardExtractionData extractionData,
        int exhibitionId,
        int employeeId,
        string? tempId = null)
    {
        using var conn = _db.CreateConnection();

        // Create lead
        var leadId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO Leads (ExhibitionId, SourceCode, StatusCode, AssignedEmployeeId, CreatedAt)
            OUTPUT INSERTED.LeadId
            VALUES (@ExhibitionId, 'employee_scan', 'new', @EmployeeId, GETUTCDATE())",
            new { ExhibitionId = exhibitionId, EmployeeId = employeeId });

        _logger.LogInformation("Created confirmed lead {LeadId}", leadId);

        try
        {
            var primaryPerson = extractionData.Persons.FirstOrDefault();
            var segmentInfo = SegmentLead(primaryPerson?.Designation);

            // Move temp images to permanent lead folder if tempId provided
            var (frontPath, backPath) = MoveTempImages(tempId, leadId.ToString());

            await UpdateLeadWithExtraction(conn, leadId, extractionData, segmentInfo, frontPath, backPath);
            await SaveLeadEntities(conn, leadId, extractionData);
            await AddSystemMessage(conn, leadId,
                $"Card scanned and confirmed. Confidence: {extractionData.Confidence:P0} | Segment: {segmentInfo.Segment} (Priority {segmentInfo.Priority})",
                employeeId);

            _logger.LogInformation("Lead {LeadId} confirmed and saved successfully", leadId);

            return new CardExtractionResponse(
                Success: true,
                LeadId: leadId,
                Extraction: extractionData,
                Segment: segmentInfo.Segment,
                Priority: segmentInfo.Priority,
                DuplicateCheck: null,
                Message: "Lead saved successfully."
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save confirmed lead {LeadId}", leadId);
            throw;
        }
    }

    // â”€â”€â”€ Private helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private async Task<DuplicateCheckResult> CheckForDuplicates(Microsoft.Data.SqlClient.SqlConnection conn, CardExtractionData data, int exhibitionId)
    {
        var primaryPerson = data.Persons.FirstOrDefault();
        var duplicates = new List<DuplicateInfo>();

        var allPhones = data.Phones.Where(p => !string.IsNullOrWhiteSpace(p))
            .Concat(primaryPerson?.Phones ?? Enumerable.Empty<string>())
            .Distinct()
            .ToList();

        var allEmails = data.Emails.Where(e => !string.IsNullOrWhiteSpace(e))
            .Concat(primaryPerson?.Emails ?? Enumerable.Empty<string>())
            .Distinct()
            .ToList();

        var primaryName = primaryPerson?.Name;
        var companyName = data.CompanyName;

        _logger.LogInformation("Checking duplicates in exhibition {ExhibitionId}", exhibitionId);

        var tenDigits = new List<string>();
        foreach (var phone in allPhones)
        {
            if (!string.IsNullOrWhiteSpace(phone))
            {
                var normalizedPhone = NormalizePhoneNumber(phone);
                var tenDigit = normalizedPhone.Length == 12 && normalizedPhone.StartsWith("91")
                    ? normalizedPhone.Substring(2)
                    : normalizedPhone;
                tenDigits.Add(tenDigit);
            }
        }

        var sqlQuery = @"
            SELECT DISTINCT
                LeadId,
                PrimaryVisitorName as VisitorName,
                CompanyName,
                PrimaryVisitorPhone as Phone,
                CASE
                    WHEN @PhoneCount > 0 AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(PrimaryVisitorPhone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '91', '') IN (
                        SELECT value FROM STRING_SPLIT(@TenDigits, ',')
                    ) THEN 100
                    WHEN @EmailCount > 0 AND PrimaryVisitorEmail IN (
                        SELECT value FROM STRING_SPLIT(@AllEmails, '|')
                    ) THEN 95
                    WHEN LOWER(PrimaryVisitorName) = LOWER(@Name) AND LOWER(CompanyName) = LOWER(@Company) THEN 90
                    WHEN LOWER(PrimaryVisitorName) = LOWER(@Name) THEN 70
                    WHEN LOWER(CompanyName) = LOWER(@Company) THEN 60
                    ELSE 0
                END as SimilarityScore
            FROM Leads
            WHERE (
                (@PhoneCount > 0 AND PrimaryVisitorPhone IS NOT NULL AND
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(PrimaryVisitorPhone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '91', '') IN (
                        SELECT value FROM STRING_SPLIT(@TenDigits, ',')
                    )
                )
                OR (@EmailCount > 0 AND PrimaryVisitorEmail IS NOT NULL AND
                    PrimaryVisitorEmail IN (
                        SELECT value FROM STRING_SPLIT(@AllEmails, '|')
                    )
                )
                OR (ExhibitionId = @ExhibitionId AND PrimaryVisitorName IS NOT NULL AND CompanyName IS NOT NULL AND
                    LOWER(PrimaryVisitorName) = LOWER(@Name) AND LOWER(CompanyName) = LOWER(@Company)
                )
                OR (ExhibitionId = @ExhibitionId AND @Company = '' AND PrimaryVisitorName IS NOT NULL AND LOWER(PrimaryVisitorName) = LOWER(@Name))
                OR (ExhibitionId = @ExhibitionId AND @Name = '' AND CompanyName IS NOT NULL AND LOWER(CompanyName) = LOWER(@Company))
            )
            ORDER BY SimilarityScore DESC
        ";

        var matches = (await conn.QueryAsync<DuplicateInfo>(
            sqlQuery,
            new {
                ExhibitionId = exhibitionId,
                TenDigits = string.Join(",", tenDigits),
                PhoneCount = tenDigits.Count,
                AllEmails = string.Join("|", allEmails),
                EmailCount = allEmails.Count,
                Name = primaryName?.Trim() ?? "",
                Company = companyName?.Trim() ?? ""
            })).ToList();

        duplicates = matches.Where(m => m.SimilarityScore > 0).DistinctBy(d => d.LeadId).ToList();

        _logger.LogInformation("Found {Count} duplicate(s) in exhibition {ExhibitionId}",
            duplicates.Count, exhibitionId);

        return new DuplicateCheckResult(duplicates.Any(), duplicates.Count, duplicates.OrderByDescending(d => d.SimilarityScore).ToList());
    }

    private static string NormalizePhoneNumber(string phone)
    {
        if (string.IsNullOrEmpty(phone))
            return string.Empty;

        var digits = new string(phone.Where(char.IsDigit).ToArray());

        if (digits.Length == 10)
            digits = "91" + digits;

        return digits;
    }

    private (string Segment, string Priority) SegmentLead(string? designation)
    {
        if (string.IsNullOrEmpty(designation))
            return ("general", "medium");

        var lower = designation.ToLower();

        if (lower.Contains("director") || lower.Contains("ceo") || lower.Contains("owner") ||
            lower.Contains("managing") || lower.Contains("proprietor") || lower.Contains("chairman"))
            return ("decision_maker", "high");

        if (lower.Contains("manager") || lower.Contains("head") || lower.Contains("lead") ||
            lower.Contains("supervisor") || lower.Contains("executive"))
            return ("influencer", "medium");

        if (lower.Contains("engineer") || lower.Contains("technical") || lower.Contains("analyst"))
            return ("researcher", "medium");

        return ("general", "medium");
    }

    private async Task UpdateLeadWithExtraction(
        Microsoft.Data.SqlClient.SqlConnection conn,
        int leadId,
        CardExtractionData data,
        (string Segment, string Priority) segmentInfo,
        string? frontImagePath = null,
        string? backImagePath = null)
    {
        var primaryPerson = data.Persons.FirstOrDefault();

        await conn.ExecuteAsync(@"
            UPDATE Leads SET
                CompanyName = @CompanyName,
                PrimaryVisitorName = @Name,
                PrimaryVisitorDesignation = @Designation,
                PrimaryVisitorPhone = @Phone,
                PrimaryVisitorEmail = @Email,
                Segment = @Segment,
                Priority = @Priority,
                RawCardJson = @RawJson,
                FrontImagePath = @FrontImagePath,
                BackImagePath = @BackImagePath,
                UpdatedAt = GETUTCDATE()
            WHERE LeadId = @LeadId",
            new
            {
                LeadId = leadId,
                data.CompanyName,
                Name = primaryPerson?.Name,
                Designation = primaryPerson?.Designation,
                Phone = data.Phones.FirstOrDefault() ?? primaryPerson?.Phones.FirstOrDefault(),
                Email = data.Emails.FirstOrDefault() ?? primaryPerson?.Emails.FirstOrDefault(),
                segmentInfo.Segment,
                segmentInfo.Priority,
                RawJson = JsonSerializer.Serialize(data),
                FrontImagePath = frontImagePath,
                BackImagePath = backImagePath
            });
    }

    private async Task<(string frontPath, string? backPath)> SaveCardImagesAsync(
        string folderKey,
        Stream frontStream,
        string frontFileName,
        Stream? backStream,
        string? backFileName)
    {
        var folder = Path.Combine(_uploadsRoot, folderKey);
        Directory.CreateDirectory(folder);

        var frontExt = Path.GetExtension(frontFileName).ToLower().TrimStart('.');
        if (string.IsNullOrEmpty(frontExt)) frontExt = "jpg";
        var frontPath = Path.Combine(folder, $"front.{frontExt}");

        await using (var fs = System.IO.File.Create(frontPath))
            await frontStream.CopyToAsync(fs);

        string? backPath = null;
        if (backStream != null)
        {
            var backExt = Path.GetExtension(backFileName ?? "").ToLower().TrimStart('.');
            if (string.IsNullOrEmpty(backExt)) backExt = "jpg";
            backPath = Path.Combine(folder, $"back.{backExt}");
            await using var fs = System.IO.File.Create(backPath);
            await backStream.CopyToAsync(fs);
        }

        _logger.LogInformation("Card images saved to: {Folder}", folder);
        return (frontPath, backPath);
    }

    private (string? frontPath, string? backPath) MoveTempImages(string? tempId, string leadFolder)
    {
        if (string.IsNullOrEmpty(tempId)) return (null, null);

        var tempFolder = Path.Combine(_uploadsRoot, "temp", tempId);
        if (!Directory.Exists(tempFolder)) return (null, null);

        var destFolder = Path.Combine(_uploadsRoot, leadFolder);
        Directory.CreateDirectory(destFolder);

        string? frontPath = null, backPath = null;

        foreach (var file in Directory.GetFiles(tempFolder))
        {
            var dest = Path.Combine(destFolder, Path.GetFileName(file));
            System.IO.File.Move(file, dest, overwrite: true);
            if (Path.GetFileNameWithoutExtension(file) == "front") frontPath = dest;
            else if (Path.GetFileNameWithoutExtension(file) == "back") backPath = dest;
        }

        Directory.Delete(tempFolder, recursive: true);
        _logger.LogInformation("Moved temp images {TempId} â†’ lead {LeadFolder}", tempId, leadFolder);
        return (frontPath, backPath);
    }

    private async Task SaveLeadEntities(Microsoft.Data.SqlClient.SqlConnection conn, int leadId, CardExtractionData data)
    {
        var additionalPersons = data.Persons.Skip(1).Select(p => new
        {
            name = p.Name,
            designation = p.Designation,
            phone = p.Phones.FirstOrDefault(),
            email = p.Emails.FirstOrDefault()
        }).ToList();

        var additionalPersonsJson = additionalPersons.Any() ? JsonSerializer.Serialize(additionalPersons) : null;
        var phonesJson = data.Phones.Distinct().Select(p => new { phone = p, type = "" }).ToList();
        var phonesJsonString = phonesJson.Any() ? JsonSerializer.Serialize(phonesJson) : null;
        var emailsJson = data.Emails.Distinct().Select(e => new { email = e, type = "" }).ToList();
        var emailsJsonString = emailsJson.Any() ? JsonSerializer.Serialize(emailsJson) : null;
        var addressesJson = data.Addresses.Select(a => new
        {
            address = a.Address,
            type = a.AddressType,
            city = a.City,
            state = a.State,
            country = a.Country,
            pincode = a.PinCode
        }).ToList();
        var addressesJsonString = addressesJson.Any() ? JsonSerializer.Serialize(addressesJson) : null;
        var websitesJsonString = data.Websites.Any() ? JsonSerializer.Serialize(data.Websites) : null;
        var servicesJsonString = data.Services.Any() ? JsonSerializer.Serialize(data.Services) : null;
        var brandsJson = data.Brands.Select(b => new { brand = b.BrandName, relationship = b.Relationship }).ToList();
        var brandsJsonString = brandsJson.Any() ? JsonSerializer.Serialize(brandsJson) : null;

        await conn.ExecuteAsync(@"
            UPDATE Leads SET
                AdditionalPersons = @AdditionalPersons,
                PhoneNumbers = @PhoneNumbers,
                EmailAddresses = @EmailAddresses,
                Addresses = @Addresses,
                Websites = @Websites,
                Services = @Services,
                Brands = @Brands,
                UpdatedAt = GETUTCDATE()
            WHERE LeadId = @LeadId",
            new
            {
                LeadId = leadId,
                AdditionalPersons = additionalPersonsJson,
                PhoneNumbers = phonesJsonString,
                EmailAddresses = emailsJsonString,
                Addresses = addressesJsonString,
                Websites = websitesJsonString,
                Services = servicesJsonString,
                Brands = brandsJsonString
            });
    }

    private async Task AddSystemMessage(Microsoft.Data.SqlClient.SqlConnection conn, int leadId, string text, int? employeeId = null)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO LeadMessages (LeadId, SenderType, SenderEmployeeId, MessageText, CreatedAt)
            VALUES (@LeadId, 'system', @EmployeeId, @Text, GETUTCDATE())",
            new { LeadId = leadId, EmployeeId = employeeId, Text = text });
    }
}

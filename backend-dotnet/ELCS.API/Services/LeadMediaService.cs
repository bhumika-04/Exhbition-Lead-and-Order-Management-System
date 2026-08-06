using Dapper;
using ELCS.API.Data;

namespace ELCS.API.Services;

public class LeadMediaService : ILeadMediaService
{
    private readonly ILogger<LeadMediaService> _logger;
    private readonly IDbConnection _db;

    public LeadMediaService(ILogger<LeadMediaService> logger, IDbConnection db)
    {
        _logger = logger;
        _db = db;
    }

    public async Task<List<LeadPhotoDto>> GetPhotosAsync(int leadId)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync<LeadPhotoDto>(@"
            SELECT LeadPhotoId, LeadId, SourceType, FilePath, ExternalUrl, Caption, CreatedAt
            FROM LeadPhotos
            WHERE LeadId = @LeadId
            ORDER BY CreatedAt DESC", new { LeadId = leadId });
        return rows.ToList();
    }

    public Task<int> AddPhotoFileAsync(int leadId, string relativePath, string? caption, int? employeeId) =>
        InsertPhotoAsync(leadId, "file", relativePath, null, caption, employeeId);

    public Task<int> AddPhotoLinkAsync(int leadId, string externalUrl, string? caption, int? employeeId)
    {
        var url = externalUrl?.Trim();
        if (string.IsNullOrWhiteSpace(url))
            throw new ArgumentException("Enter a link");
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
            throw new ArgumentException("Enter a valid http(s) link");

        return InsertPhotoAsync(leadId, "link", null, url, caption, employeeId);
    }

    private async Task<int> InsertPhotoAsync(
        int leadId, string sourceType, string? filePath, string? externalUrl,
        string? caption, int? employeeId)
    {
        using var conn = _db.CreateConnection();

        var exists = await conn.ExecuteScalarAsync<int?>(
            "SELECT LeadId FROM Leads WHERE LeadId = @LeadId", new { LeadId = leadId });
        if (exists == null) throw new KeyNotFoundException($"Lead {leadId} not found");

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO LeadPhotos (LeadId, SourceType, FilePath, ExternalUrl, Caption,
                                    UploadedByEmployeeId, CreatedAt)
            OUTPUT INSERTED.LeadPhotoId
            VALUES (@LeadId, @SourceType, @FilePath, @ExternalUrl, @Caption,
                    @EmployeeId, GETUTCDATE())",
            new
            {
                LeadId = leadId, SourceType = sourceType, FilePath = filePath,
                ExternalUrl = externalUrl, Caption = caption, EmployeeId = employeeId
            });

        _logger.LogInformation("Added {SourceType} photo {PhotoId} to lead {LeadId}",
            sourceType, id, leadId);
        return id;
    }

    public async Task DeletePhotoAsync(int leadPhotoId)
    {
        using var conn = _db.CreateConnection();
        // The row goes; the file on disk is left alone deliberately. Removing it
        // here would break any WhatsApp message already sent that points at it.
        var rows = await conn.ExecuteAsync(
            "DELETE FROM LeadPhotos WHERE LeadPhotoId = @Id", new { Id = leadPhotoId });
        if (rows == 0) throw new KeyNotFoundException($"Photo {leadPhotoId} not found");
    }

    public async Task SetTestimonialAsync(int leadId, string? driveUrl)
    {
        var url = string.IsNullOrWhiteSpace(driveUrl) ? null : driveUrl.Trim();

        if (url != null &&
            (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) ||
             (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps)))
            throw new ArgumentException("Enter a valid http(s) link");

        using var conn = _db.CreateConnection();
        var rows = await conn.ExecuteAsync(@"
            UPDATE Leads
            SET TestimonialUrl     = @Url,
                TestimonialAddedAt = CASE WHEN @Url IS NULL THEN NULL ELSE GETUTCDATE() END,
                UpdatedAt          = GETUTCDATE()
            WHERE LeadId = @LeadId", new { Url = url, LeadId = leadId });

        if (rows == 0) throw new KeyNotFoundException($"Lead {leadId} not found");
    }

    public async Task<LeadMediaDto> GetMediaAsync(int leadId)
    {
        using var conn = _db.CreateConnection();

        var lead = await conn.QueryFirstOrDefaultAsync<LeadMediaRow>(@"
            SELECT FrontImagePath, BackImagePath, TestimonialUrl, TestimonialAddedAt
            FROM Leads WHERE LeadId = @LeadId", new { LeadId = leadId });

        if (lead == null) throw new KeyNotFoundException($"Lead {leadId} not found");

        return new LeadMediaDto(
            LeadId:             leadId,
            FrontImagePath:     lead.FrontImagePath,
            BackImagePath:      lead.BackImagePath,
            TestimonialUrl:     lead.TestimonialUrl,
            TestimonialAddedAt: lead.TestimonialAddedAt,
            Photos:             await GetPhotosAsync(leadId));
    }

    private sealed class LeadMediaRow
    {
        public string? FrontImagePath { get; set; }
        public string? BackImagePath { get; set; }
        public string? TestimonialUrl { get; set; }
        public DateTime? TestimonialAddedAt { get; set; }
    }
}

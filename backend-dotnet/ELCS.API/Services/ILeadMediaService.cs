namespace ELCS.API.Services;

/// <summary>
/// Team photos and testimonials attached to a lead.
///
/// A team photo is either an uploaded file or a Drive link, and a lead may have
/// several. A testimonial is a Drive link only — videos are large and Drive is
/// where they already live.
/// </summary>
public interface ILeadMediaService
{
    Task<List<LeadPhotoDto>> GetPhotosAsync(int leadId);
    Task<int> AddPhotoFileAsync(int leadId, string relativePath, string? caption, int? employeeId);
    Task<int> AddPhotoLinkAsync(int leadId, string externalUrl, string? caption, int? employeeId);
    Task DeletePhotoAsync(int leadPhotoId);

    Task SetTestimonialAsync(int leadId, string? driveUrl);
    Task<LeadMediaDto> GetMediaAsync(int leadId);
}

public record LeadPhotoDto(
    int LeadPhotoId,
    int LeadId,
    string SourceType,        // file | link
    string? FilePath,         // relative to uploads/ when SourceType = file
    string? ExternalUrl,      // Drive link when SourceType = link
    string? Caption,
    DateTime CreatedAt
);

public record LeadMediaDto(
    int LeadId,
    string? FrontImagePath,
    string? BackImagePath,
    string? TestimonialUrl,
    DateTime? TestimonialAddedAt,
    List<LeadPhotoDto> Photos
);

public record AddPhotoLinkRequest(string Url, string? Caption);
public record SetTestimonialRequest(string? Url);

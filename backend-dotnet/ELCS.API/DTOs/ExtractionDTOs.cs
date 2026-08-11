namespace ELCS.API.DTOs;

// Card Extraction DTOs
public record CardExtractionResponse(
    bool Success,
    int LeadId,
    CardExtractionData? Extraction,
    string? Priority,
    DuplicateCheckResult? DuplicateCheck,
    string Message,
    string? TaskId = null,
    string? TempId = null  // Temp image folder ID for preview → confirm flow
);

public record CardExtractionData(
    string? CompanyName,
    List<PersonData> Persons,
    List<string> Phones,
    List<string> Emails,
    List<string> Websites,
    List<AddressData> Addresses,
    List<BrandData> Brands,
    double Confidence,
    string? RawFrontText,
    string? RawBackText
);

public record PersonData(
    string? Name,
    string? Designation,
    List<string> Phones,
    List<string> Emails,
    bool IsPrimary
);

public record AddressData(
    string? AddressType,
    string? Address,
    string? City,
    string? State,
    string? Country,
    string? PinCode
);

public record BrandData(
    string BrandName,
    string? Relationship
);

public record DuplicateCheckResult(
    bool IsDuplicate,
    int DuplicateCount,
    List<DuplicateInfo>? Duplicates
);

public record DuplicateInfo(
    int LeadId,
    string? VisitorName,
    string? CompanyName,
    string? Phone,
    int SimilarityScore
);

// Confirm Lead Request
public record ConfirmLeadRequest(
    CardExtractionData Extraction,
    int ExhibitionId,
    int EmployeeId,
    string? TempId = null  // Temp image folder ID to move images on confirm
);

// Task Status DTOs
public record TaskStatusResponse(
    string TaskId,
    string TaskType,
    string Status,
    int Progress,
    string? ProgressMessage,
    DateTime CreatedAt,
    DateTime? StartedAt,
    DateTime? CompletedAt,
    object? Result,
    string? Error
);


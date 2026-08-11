using ELCS.API.Models;

namespace ELCS.API.Services;

public interface ILeadService
{
    Task<Lead?> GetLeadByIdAsync(int leadId);
    Task<LeadDetailDto?> GetLeadDetailAsync(int leadId);
    Task<(List<LeadListDto> Leads, int TotalCount)> GetLeadsAsync(LeadQueryParams queryParams);
    Task<int> CreateLeadAsync(CreateLeadDto dto);
    Task UpdateLeadAsync(int leadId, UpdateLeadDto dto);
    Task DeleteLeadAsync(int leadId);
    Task<int> AddMessageAsync(int leadId, string senderType, string text, int? employeeId = null);
    Task<List<LeadMessage>> GetMessagesAsync(int leadId);
    Task<List<LeadListDto>> SearchLeadsByNameAsync(string name);
}

public record LeadQueryParams(
    int? ExhibitionId = null,
    string? SourceCode = null,
    string? StatusCode = null,
    int Limit = 50,
    int Offset = 0,
    int? AssignedEmployeeId = null,
    string? Service = null
);

public record LeadListDto(
    int LeadId,
    int ExhibitionId,
    string? ExhibitionName,
    string? CompanyName,
    string? PrimaryVisitorName,
    string? PrimaryVisitorDesignation,
    string? PrimaryVisitorPhone,
    string? Priority,
    string? StatusCode,
    DateTime CreatedAt,
    string? City,
    string? State,
    string? PrimaryVisitorEmail
);

public record LeadDetailDto(
    Lead Lead,
    List<LeadPerson> Persons,
    List<LeadAddress> Addresses,
    List<LeadWebsite> Websites,
    List<LeadTopic> Topics,
    List<LeadMessage> Messages,
    List<LeadBrand> Brands,
    List<LeadPhone> Phones,
    List<LeadEmail> Emails
);

public record CreateLeadDto(
    int ExhibitionId,
    string? SourceCode,
    int? AssignedEmployeeId,
    string? CompanyName = null,
    string? PrimaryVisitorName = null,
    string? PrimaryVisitorPhone = null,
    string? PrimaryVisitorEmail = null,
    string? PrimaryVisitorDesignation = null,
    string? DiscussionSummary = null,
    string? Priority = null,
    string? GstNumber = null,
    // Everything below lands in the JSON columns on Leads. Without them a lead
    // typed by hand kept only its first phone and first email, and silently
    // dropped the rest along with the address and every website — the card
    // extraction path had always written them, so only manual entry lost data.
    List<string>? Phones = null,
    List<string>? Emails = null,
    List<string>? Websites = null,
    string? Address = null,
    string? City = null,
    string? State = null
);

public record UpdateLeadDto(
    string? CompanyName = null,
    string? PrimaryVisitorName = null,
    string? PrimaryVisitorDesignation = null,
    string? PrimaryVisitorPhone = null,
    string? PrimaryVisitorEmail = null,
    string? Priority = null,
    string? StatusCode = null,
    string? DiscussionSummary = null,
    string? GstNumber = null
);

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
    string? Segment,
    string? Priority,
    string? StatusCode,
    DateTime CreatedAt,
    string? City,
    string? State,
    string? ServicesJson,
    string? PrimaryVisitorEmail,
    string? Category,
    string? TurnOver,
    string? TeamSize,
    string? Vertical
);

public record LeadDetailDto(
    Lead Lead,
    List<LeadPerson> Persons,
    List<LeadAddress> Addresses,
    List<LeadWebsite> Websites,
    List<LeadServiceModel> Services,
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
    string? Segment = null,
    string? Priority = null
);

public record UpdateLeadDto(
    string? CompanyName = null,
    string? PrimaryVisitorName = null,
    string? PrimaryVisitorDesignation = null,
    string? PrimaryVisitorPhone = null,
    string? PrimaryVisitorEmail = null,
    string? Segment = null,
    string? Priority = null,
    string? StatusCode = null,
    string? DiscussionSummary = null,
    List<string>? Services = null,
    string? Category = null,
    string? TurnOver = null,
    string? TeamSize = null,
    string? Vertical = null
);

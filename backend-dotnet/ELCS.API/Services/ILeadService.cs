using ELCS.API.Models;

namespace ELCS.API.Services;

public interface ILeadService
{
    Task<Lead?> GetLeadByIdAsync(int leadId);
    Task<LeadDetailDto?> GetLeadDetailAsync(int leadId, int? tenantId = null, bool isSuperAdmin = false);
    Task<(List<LeadListDto> Leads, int TotalCount)> GetLeadsAsync(LeadQueryParams queryParams);
    Task<int> CreateLeadAsync(CreateLeadDto dto);
    Task UpdateLeadAsync(int leadId, UpdateLeadDto dto, int? tenantId = null, bool isSuperAdmin = false);
    Task DeleteLeadAsync(int leadId, int? tenantId = null, bool isSuperAdmin = false);
    Task<int> AddMessageAsync(int leadId, string senderType, string text, int? employeeId = null);
    Task<List<LeadMessage>> GetMessagesAsync(int leadId);
    Task<List<LeadListDto>> SearchLeadsByNameAsync(string name);
    Task<(bool Success, string? Error, long? LedgerId, string? LedgerCode)> PushToCrmAsync(int leadId, int? tenantId = null, bool isSuperAdmin = false);
}

public record LeadQueryParams(
    int? ExhibitionId = null,
    string? SourceCode = null,
    string? StatusCode = null,
    int Limit = 50,
    int Offset = 0,
    int? AssignedEmployeeId = null,
    string? Service = null,
    int? TenantId = null,      // null = super admin sees all
    bool IsSuperAdmin = false
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
    long? CrmLedgerId,
    string? City,
    string? State,
    string? ServicesJson,
    string? PrimaryVisitorEmail,
    string? Category,
    string? TurnOver,
    string? TeamSize,
    string? Vertical,
    string? TenantName   // owning company — shown to super admin to identify the lead's tenant
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
    string? Priority = null,
    int? TenantId = null
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

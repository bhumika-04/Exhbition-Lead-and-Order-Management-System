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

    /// <summary>
    /// Admin override: REPLACES the earned-coupon calculation for this lead
    /// with AdvanceCalculator.CouponsForSlab(slab), regardless of advance
    /// actually taken. Null clears the override.
    /// </summary>
    Task SetCouponOverrideAsync(int leadId, int? slab);

    /// <summary>
    /// Records the physical coupon numbers handed to this lead. Rejects a
    /// number already recorded against a different lead. Returns the cleaned
    /// (trimmed, deduplicated) list actually stored.
    /// </summary>
    Task<List<string>> SetCouponNumbersAsync(int leadId, List<string> numbers);
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
    string? PrimaryVisitorEmail,
    // Combined value of this lead's non-cancelled orders, and the most
    // recently created order's status — a list-row summary, not the
    // lead-level position GetLeadOrderSummaryAsync computes for one lead.
    decimal OrderValue,
    string? OrderStatus
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
    List<LeadEmail> Emails,
    // Combined value of this lead's non-cancelled orders, and its most
    // recently created order's status — same summary shown per row on the
    // Leads list, surfaced here too.
    decimal OrderValue,
    string? OrderStatus
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

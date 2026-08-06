using System.Text.Json.Serialization;

namespace ELCS.API.Models;

public class Lead
{
    public int LeadId { get; set; }
    public int ExhibitionId { get; set; }
    public string? SourceCode { get; set; }
    public string? StatusCode { get; set; }
    public int? AssignedEmployeeId { get; set; }
    public string? CompanyName { get; set; }
    public string? PrimaryVisitorName { get; set; }
    public string? PrimaryVisitorDesignation { get; set; }
    public string? PrimaryVisitorPhone { get; set; }
    public string? PrimaryVisitorEmail { get; set; }
    public string? Segment { get; set; }
    public string? Priority { get; set; }
    public string? DiscussionSummary { get; set; }
    public string? RawCardJson { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public long? CrmLedgerId { get; set; }  // Set after push to CRM/ERP
    public string? ExhibitionName { get; set; }  // Joined from Exhibitions table

    // JSON columns for additional data (replaces child tables)
    public string? AdditionalPersons { get; set; }  // JSON array of non-primary contacts
    public string? PhoneNumbers { get; set; }       // JSON array of all phone numbers
    public string? EmailAddresses { get; set; }     // JSON array of all email addresses
    public string? Addresses { get; set; }          // JSON array of addresses
    public string? Websites { get; set; }           // JSON array of website URLs
    public string? Services { get; set; }           // JSON array of services/products
    public string? Brands { get; set; }             // JSON array of brands
    public string? Topics { get; set; }             // JSON array of discussion topics
    public string? FrontImagePath { get; set; }
    public string? BackImagePath { get; set; }

    public int? TenantId { get; set; }

    // Additional classification fields
    public string? Category { get; set; }
    public string? TurnOver { get; set; }
    public string? TeamSize { get; set; }
    public string? Vertical { get; set; }
}

public class LeadPerson
{
    public int LeadPersonId { get; set; }
    public int LeadId { get; set; }
    public string? Name { get; set; }
    public string? Designation { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public bool IsPrimary { get; set; }
}

public class LeadPhone
{
    public int LeadPhoneId { get; set; }
    public int LeadId { get; set; }
    public string PhoneNumber { get; set; } = string.Empty;
    public string? PhoneType { get; set; }
}

public class LeadEmail
{
    public int LeadEmailId { get; set; }
    public int LeadId { get; set; }
    public string EmailAddress { get; set; } = string.Empty;
    public string? EmailType { get; set; }
}

public class LeadAddress
{
    public int LeadAddressId { get; set; }
    public int LeadId { get; set; }
    public string? AddressText { get; set; }
    public string? AddressType { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? Country { get; set; }
    public string? PinCode { get; set; }
}

public class LeadWebsite
{
    public int LeadWebsiteId { get; set; }
    public int LeadId { get; set; }
    public string WebsiteUrl { get; set; } = string.Empty;
}

public class LeadServiceModel
{
    public int LeadServiceId { get; set; }
    public int LeadId { get; set; }
    public string ServiceText { get; set; } = string.Empty;
}

public class LeadBrand
{
    public int LeadBrandId { get; set; }
    public int LeadId { get; set; }
    public string BrandName { get; set; } = string.Empty;
    public string? Relationship { get; set; }
}

public class LeadTopic
{
    public int LeadTopicId { get; set; }
    public int LeadId { get; set; }
    public string TopicText { get; set; } = string.Empty;
}

public class LeadMessage
{
    public int MessageId { get; set; }
    public int LeadId { get; set; }
    public string SenderType { get; set; } = string.Empty;
    public int? SenderEmployeeId { get; set; }
    public string MessageText { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

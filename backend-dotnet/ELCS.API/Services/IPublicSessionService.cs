namespace ELCS.API.Services;

/// <summary>
/// Sessions for the self-service ordering page reached through the printed QR.
///
/// A session is opened from the mobile number the customer types. That number
/// is not verified, and this service does not pretend otherwise: the QR is
/// printed on the stall with staff standing beside it, so the booth itself is
/// the check. What the token protects is the customer's own draft order and the
/// catalogue — never a price, an advance or a coupon count, all of which a CRR
/// sets when confirming.
/// </summary>
public interface IPublicSessionService
{
    /// <summary>Opens a session for a typed mobile number.</summary>
    Task<SessionResult> StartSessionAsync(string rawMobile, int? exhibitionId);

    /// <summary>Resolves a session token. Null when unknown or expired.</summary>
    Task<PublicSession?> GetSessionAsync(string? sessionToken);

    /// <summary>Ties a session to the lead it turned out to belong to.</summary>
    Task BindLeadAsync(int publicSessionId, int leadId);
}

public record SessionResult(
    bool Success,
    string? Error,
    string? SessionToken
);

public record PublicSession(
    int PublicSessionId,
    string Mobile,
    int? ExhibitionId,
    int? LeadId,
    DateTime ExpiresAt
);

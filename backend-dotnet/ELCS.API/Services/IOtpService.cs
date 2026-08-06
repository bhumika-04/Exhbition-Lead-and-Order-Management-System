namespace ELCS.API.Services;

/// <summary>
/// Mobile verification for the public self-service ordering page.
///
/// A phone number is not proof of identity — anyone can type one. Nothing about
/// a lead is returned until a code sent to that number has come back, which is
/// what stops a visitor at the booth from harvesting the customer list.
/// </summary>
public interface IOtpService
{
    /// <summary>Generates a code, sends it by WhatsApp, and records the hashed challenge.</summary>
    Task<OtpRequestResult> RequestAsync(string rawMobile, int? exhibitionId);

    /// <summary>Checks a submitted code and, on success, issues a public session token.</summary>
    Task<OtpVerifyResult> VerifyAsync(string rawMobile, string code, int? exhibitionId);

    /// <summary>Resolves a session token to its live session, or null when absent/expired.</summary>
    Task<PublicSession?> GetSessionAsync(string? sessionToken);

    /// <summary>Attaches a lead to a session once it is matched or created.</summary>
    Task BindLeadAsync(int publicSessionId, int leadId);
}

public record OtpRequestResult(
    bool Sent,
    string? Error,
    int RetryAfterSeconds
);

public record OtpVerifyResult(
    bool Verified,
    string? Error,
    string? SessionToken,
    int AttemptsRemaining
);

public record PublicSession(
    int PublicSessionId,
    string Mobile,
    int? ExhibitionId,
    int? LeadId,
    DateTime ExpiresAt
);

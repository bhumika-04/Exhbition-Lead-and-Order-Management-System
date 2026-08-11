using System.Security.Cryptography;
using Dapper;
using ELCS.API.Data;

namespace ELCS.API.Services;

public class PublicSessionService : IPublicSessionService
{
    private readonly ILogger<PublicSessionService> _logger;
    private readonly IDbConnection _db;

    private const int SessionMinutes = 45;   // long enough to place an order

    public PublicSessionService(ILogger<PublicSessionService> logger, IDbConnection db)
    {
        _logger = logger;
        _db = db;
    }

    public async Task<SessionResult> StartSessionAsync(string rawMobile, int? exhibitionId)
    {
        var mobile = NormaliseMobile(rawMobile);
        if (mobile == null)
            return new SessionResult(false, "Enter a valid 10-digit mobile number", null);

        using var conn = _db.CreateConnection();

        // 32 random bytes — the token is the only thing standing between a
        // stranger and this customer's order, so it must not be guessable.
        var sessionToken = Base64Url(RandomNumberGenerator.GetBytes(32));

        await conn.ExecuteAsync(@"
            INSERT INTO PublicSessions (SessionToken, Mobile, ExhibitionId, ExpiresAt, CreatedAt)
            VALUES (@Token, @Mobile, @ExhibitionId, @ExpiresAt, GETUTCDATE())",
            new
            {
                Token = sessionToken,
                Mobile = mobile,
                ExhibitionId = exhibitionId,
                ExpiresAt = DateTime.UtcNow.AddMinutes(SessionMinutes),
            });

        _logger.LogInformation("Public session opened for {Mobile}", Mask(mobile));
        return new SessionResult(true, null, sessionToken);
    }

    /// <summary>
    /// Resolves a session token, and slides its expiry forward.
    ///
    /// A fixed window expires mid-order: a customer scans, walks the stall, and
    /// comes back to a dead session with a full basket that cannot be submitted
    /// and is not saved anywhere. The window now measures inactivity instead —
    /// it only runs out once they have actually stopped, and every request they
    /// make pushes it back.
    ///
    /// The UPDATE is part of the same statement as the read so an active session
    /// cannot expire between the two.
    /// </summary>
    public async Task<PublicSession?> GetSessionAsync(string? sessionToken)
    {
        if (string.IsNullOrWhiteSpace(sessionToken)) return null;

        using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<PublicSession>(@"
            UPDATE PublicSessions
            SET ExpiresAt = DATEADD(MINUTE, @Minutes, GETUTCDATE())
            OUTPUT INSERTED.PublicSessionId, INSERTED.Mobile, INSERTED.ExhibitionId,
                   INSERTED.LeadId, INSERTED.ExpiresAt
            WHERE SessionToken = @Token AND ExpiresAt > GETUTCDATE()",
            new { Token = sessionToken, Minutes = SessionMinutes });
    }

    public async Task BindLeadAsync(int publicSessionId, int leadId)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE PublicSessions SET LeadId = @LeadId WHERE PublicSessionId = @Id",
            new { LeadId = leadId, Id = publicSessionId });
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Reduces any Indian format (+91…, leading 0, bare) to 10 digits.</summary>
    public static string? NormaliseMobile(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var digits = new string(raw.Where(char.IsDigit).ToArray());

        if (digits.Length == 12 && digits.StartsWith("91")) digits = digits[2..];
        else if (digits.Length == 11 && digits.StartsWith('0')) digits = digits[1..];

        return digits.Length == 10 ? digits : null;
    }

    /// <summary>Logs must not carry full customer phone numbers.</summary>
    private static string Mask(string mobile) =>
        mobile.Length == 10 ? $"{mobile[..2]}******{mobile[^2..]}" : "**********";
}

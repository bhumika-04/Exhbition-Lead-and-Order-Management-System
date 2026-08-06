using System.Security.Cryptography;
using System.Text;
using Dapper;
using ELCS.API.Data;

namespace ELCS.API.Services;

public class OtpService : IOtpService
{
    private readonly ILogger<OtpService> _logger;
    private readonly IDbConnection _db;
    private readonly IWhatsAppService _whatsApp;

    // A 6-digit code is only a million wide, so the limits below — not the code
    // length — are what actually make this safe.
    private const int CodeLength         = 6;
    private const int ExpiryMinutes      = 5;
    private const int MaxAttempts        = 5;    // per challenge
    private const int ResendCooldownSecs = 60;   // between sends to one number
    private const int MaxSendsPerHour    = 5;    // per number
    private const int SessionMinutes     = 45;   // long enough to place an order

    public OtpService(ILogger<OtpService> logger, IDbConnection db, IWhatsAppService whatsApp)
    {
        _logger = logger;
        _db = db;
        _whatsApp = whatsApp;
    }

    public async Task<OtpRequestResult> RequestAsync(string rawMobile, int? exhibitionId)
    {
        var mobile = NormaliseMobile(rawMobile);
        if (mobile == null)
            return new OtpRequestResult(false, "Enter a valid 10-digit mobile number", 0);

        using var conn = _db.CreateConnection();

        // Cooldown: stops the button being used as a free SMS/WhatsApp cannon
        // aimed at someone else's number.
        var lastSent = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT MAX(CreatedAt) FROM OtpChallenges WHERE Mobile = @Mobile",
            new { Mobile = mobile });

        if (lastSent.HasValue)
        {
            var elapsed = (DateTime.UtcNow - lastSent.Value).TotalSeconds;
            if (elapsed < ResendCooldownSecs)
                return new OtpRequestResult(false, "Please wait before requesting another code",
                    (int)Math.Ceiling(ResendCooldownSecs - elapsed));
        }

        var sentThisHour = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM OtpChallenges WHERE Mobile = @Mobile AND CreatedAt > @Since",
            new { Mobile = mobile, Since = DateTime.UtcNow.AddHours(-1) });

        if (sentThisHour >= MaxSendsPerHour)
        {
            _logger.LogWarning("OTP hourly cap hit for {Mobile}", Mask(mobile));
            return new OtpRequestResult(false, "Too many codes requested. Try again later.", 3600);
        }

        var code = GenerateCode();
        var salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));

        // Supersede any outstanding challenge so only the newest code works.
        await conn.ExecuteAsync(
            "UPDATE OtpChallenges SET ConsumedAt = GETUTCDATE() WHERE Mobile = @Mobile AND ConsumedAt IS NULL",
            new { Mobile = mobile });

        await conn.ExecuteAsync(@"
            INSERT INTO OtpChallenges (Mobile, ExhibitionId, CodeHash, Salt, ExpiresAt, CreatedAt)
            VALUES (@Mobile, @ExhibitionId, @CodeHash, @Salt, @ExpiresAt, GETUTCDATE())",
            new
            {
                Mobile = mobile,
                ExhibitionId = exhibitionId,
                CodeHash = Hash(code, salt),
                Salt = salt,
                ExpiresAt = DateTime.UtcNow.AddMinutes(ExpiryMinutes),
            });

        var send = await _whatsApp.SendOtpAsync(mobile, code, ExpiryMinutes);

        if (!send.Sent)
        {
            // The challenge is left in place deliberately: if WhatsApp is merely
            // slow the code may still land, and failing the request outright
            // would strand a customer mid-order.
            _logger.LogError("OTP send failed for {Mobile}: {Error}", Mask(mobile), send.Error);
            return new OtpRequestResult(false,
                send.StatusCode == "skipped"
                    ? "WhatsApp is not configured — please see our staff"
                    : "Could not send the code. Please try again.",
                0);
        }

        _logger.LogInformation("OTP sent to {Mobile}", Mask(mobile));
        return new OtpRequestResult(true, null, ResendCooldownSecs);
    }

    public async Task<OtpVerifyResult> VerifyAsync(string rawMobile, string code, int? exhibitionId)
    {
        var mobile = NormaliseMobile(rawMobile);
        if (mobile == null)
            return new OtpVerifyResult(false, "Enter a valid 10-digit mobile number", null, 0);
        if (string.IsNullOrWhiteSpace(code))
            return new OtpVerifyResult(false, "Enter the code", null, 0);

        using var conn = _db.CreateConnection();

        var challenge = await conn.QueryFirstOrDefaultAsync<OtpChallengeRow>(@"
            SELECT TOP 1 OtpChallengeId, CodeHash, Salt, Attempts, ExpiresAt
            FROM OtpChallenges
            WHERE Mobile = @Mobile AND ConsumedAt IS NULL
            ORDER BY CreatedAt DESC", new { Mobile = mobile });

        if (challenge == null)
            return new OtpVerifyResult(false, "Request a code first", null, 0);

        if (challenge.ExpiresAt < DateTime.UtcNow)
        {
            await ConsumeAsync(conn, challenge.OtpChallengeId);
            return new OtpVerifyResult(false, "That code has expired. Request a new one.", null, 0);
        }

        if (challenge.Attempts >= MaxAttempts)
        {
            await ConsumeAsync(conn, challenge.OtpChallengeId);
            return new OtpVerifyResult(false, "Too many incorrect attempts. Request a new code.", null, 0);
        }

        // Count the attempt before checking, so a crash mid-verify cannot be
        // used to retry for free.
        await conn.ExecuteAsync(
            "UPDATE OtpChallenges SET Attempts = Attempts + 1 WHERE OtpChallengeId = @Id",
            new { Id = challenge.OtpChallengeId });

        var submitted = Hash(code.Trim(), challenge.Salt);
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(submitted),
                Encoding.UTF8.GetBytes(challenge.CodeHash)))
        {
            var remaining = MaxAttempts - (challenge.Attempts + 1);
            return new OtpVerifyResult(false, "That code is not correct", null, Math.Max(0, remaining));
        }

        await ConsumeAsync(conn, challenge.OtpChallengeId);

        // 32 random bytes — the session token is the only thing standing between
        // a stranger and this customer's order, so it must not be guessable.
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

        _logger.LogInformation("OTP verified for {Mobile}", Mask(mobile));
        return new OtpVerifyResult(true, null, sessionToken, MaxAttempts);
    }

    public async Task<PublicSession?> GetSessionAsync(string? sessionToken)
    {
        if (string.IsNullOrWhiteSpace(sessionToken)) return null;

        using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<PublicSession>(@"
            SELECT PublicSessionId, Mobile, ExhibitionId, LeadId, ExpiresAt
            FROM PublicSessions
            WHERE SessionToken = @Token AND ExpiresAt > GETUTCDATE()",
            new { Token = sessionToken });
    }

    public async Task BindLeadAsync(int publicSessionId, int leadId)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE PublicSessions SET LeadId = @LeadId WHERE PublicSessionId = @Id",
            new { LeadId = leadId, Id = publicSessionId });
    }

    private static Task ConsumeAsync(Microsoft.Data.SqlClient.SqlConnection conn, int id) =>
        conn.ExecuteAsync(
            "UPDATE OtpChallenges SET ConsumedAt = GETUTCDATE() WHERE OtpChallengeId = @Id",
            new { Id = id });

    private static string GenerateCode() =>
        RandomNumberGenerator.GetInt32(0, (int)Math.Pow(10, CodeLength))
            .ToString(new string('0', CodeLength));

    private static string Hash(string code, string salt)
    {
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(Encoding.UTF8.GetBytes(salt + ':' + code)));
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

    private sealed class OtpChallengeRow
    {
        public int OtpChallengeId { get; set; }
        public string CodeHash { get; set; } = string.Empty;
        public string Salt { get; set; } = string.Empty;
        public int Attempts { get; set; }
        public DateTime ExpiresAt { get; set; }
    }
}

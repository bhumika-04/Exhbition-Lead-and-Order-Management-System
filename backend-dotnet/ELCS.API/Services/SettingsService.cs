using Dapper;
using ELCS.API.Data;

namespace ELCS.API.Services;

public class SettingsService : ISettingsService
{
    private readonly ILogger<SettingsService> _logger;
    private readonly IDbConnection _db;

    public SettingsService(ILogger<SettingsService> logger, IDbConnection db)
    {
        _logger = logger;
        _db = db;
    }

    public async Task<Dictionary<string, string?>> GetAllAsync()
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync<(string SettingKey, string? SettingValue)>(
            "SELECT SettingKey, SettingValue FROM AppSettings");

        var map = rows.ToDictionary(r => r.SettingKey, r => r.SettingValue);

        // Surface every known key even when the row is absent, so the Settings
        // screen renders a complete form rather than a partial one.
        foreach (var key in SettingKeys.Writable)
            map.TryAdd(key, null);

        return map;
    }

    public async Task<string?> GetAsync(string key)
    {
        using var conn = _db.CreateConnection();
        return await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM AppSettings WHERE SettingKey = @Key", new { Key = key });
    }

    public async Task SaveAsync(Dictionary<string, string?> values)
    {
        using var conn = _db.CreateConnection();

        foreach (var (key, value) in values)
        {
            // Ignore unknown keys rather than letting the endpoint become a
            // general-purpose key/value store for whatever a caller invents.
            if (!SettingKeys.Writable.Contains(key)) continue;

            var normalised = string.IsNullOrWhiteSpace(value) ? null : value.Trim();

            await conn.ExecuteAsync(@"
                MERGE AppSettings AS target
                USING (SELECT @Key AS SettingKey) AS source
                   ON target.SettingKey = source.SettingKey
                WHEN MATCHED THEN
                    UPDATE SET SettingValue = @Value, UpdatedAt = GETUTCDATE()
                WHEN NOT MATCHED THEN
                    INSERT (SettingKey, SettingValue, UpdatedAt)
                    VALUES (@Key, @Value, GETUTCDATE());",
                new { Key = key, Value = normalised });
        }

        _logger.LogInformation("Saved {Count} setting(s)", values.Count);
    }
}

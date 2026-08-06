using System.Text.Json;
using System.Text.Json.Serialization;

namespace ELCS.API.Utils;

/// <summary>
/// JSON converter that ensures all DateTime values are serialized as UTC with 'Z' suffix
/// This fixes timezone issues where database UTC times were being interpreted as local time by frontend
/// </summary>
public class UtcDateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var dateTime = reader.GetDateTime();
        // Ensure incoming DateTimes are treated as UTC
        return dateTime.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(dateTime, DateTimeKind.Utc)
            : dateTime.ToUniversalTime();
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        // Convert to UTC if not already, then write in ISO 8601 format with 'Z' suffix
        var utcDateTime = value.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(value, DateTimeKind.Utc)
            : value.ToUniversalTime();

        writer.WriteStringValue(utcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
    }
}

/// <summary>
/// JSON converter for nullable DateTime values
/// </summary>
public class UtcNullableDateTimeConverter : JsonConverter<DateTime?>
{
    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
            return null;

        var dateTime = reader.GetDateTime();
        return dateTime.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(dateTime, DateTimeKind.Utc)
            : dateTime.ToUniversalTime();
    }

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value == null)
        {
            writer.WriteNullValue();
            return;
        }

        var utcDateTime = value.Value.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(value.Value, DateTimeKind.Utc)
            : value.Value.ToUniversalTime();

        writer.WriteStringValue(utcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
    }
}

using System.Text.Json;
using System.Text.Json.Serialization;
using System.ClientModel;
using OpenAI;
using OpenAI.Chat;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;
using SixLabors.ImageSharp.Formats.Jpeg;
using ELCS.API.DTOs;

namespace ELCS.API.Services;

public class OpenAIService : IOpenAIService
{
    private readonly ILogger<OpenAIService> _logger;
    private readonly IConfiguration _config;
    private readonly ChatClient _chatClient;

    public OpenAIService(ILogger<OpenAIService> logger, IConfiguration config)
    {
        _logger = logger;
        _config = config;

        var apiKey = _config["OpenAI:ApiKey"] ?? throw new InvalidOperationException("OpenAI API key not configured");
        var model = _config["OpenAI:Model"] ?? "gpt-4o-mini";

        var credential = new ApiKeyCredential(apiKey);
        var openAIClient = new OpenAIClient(credential);
        _chatClient = openAIClient.GetChatClient(model);
    }

    // One-shot: send image(s) directly to Vision â€” no separate OCR call
    public async Task<CardExtractionData> ExtractCardFromImagesAsync(Stream frontImage, Stream? backImage)
    {
        try
        {
            // Send all 4 rotations so GPT can pick the readable orientation
            var frontRotations = await GenerateRotationsAsync(frontImage);
            var contentParts = new List<ChatMessageContentPart>();

            contentParts.Add(ChatMessageContentPart.CreateTextPart(
                "FRONT of business card â€” sent at 4 rotations (0Â°, 90Â°, 180Â°, 270Â°). " +
                "Identify which rotation is correctly oriented and extract all data from it:"));
            foreach (var rot in frontRotations)
                contentParts.Add(ChatMessageContentPart.CreateImagePart(BinaryData.FromBytes(rot), "image/jpeg", ChatImageDetailLevel.High));

            if (backImage != null)
            {
                var backRotations = await GenerateRotationsAsync(backImage);
                contentParts.Add(ChatMessageContentPart.CreateTextPart(
                    "BACK of business card â€” 4 rotations:"));
                foreach (var rot in backRotations)
                    contentParts.Add(ChatMessageContentPart.CreateImagePart(BinaryData.FromBytes(rot), "image/jpeg", ChatImageDetailLevel.High));
            }

            contentParts.Add(ChatMessageContentPart.CreateTextPart(GetVisionExtractionPrompt()));

            var options = new ChatCompletionOptions
            {
                Temperature = 0.1f,
                MaxOutputTokenCount = int.Parse(_config["OpenAI:MaxTokens"] ?? "2000"),
                ResponseFormat = ChatResponseFormat.CreateJsonObjectFormat()
            };

            var messages = new List<ChatMessage>
            {
                new SystemChatMessage(GetCardExtractionSystemPrompt()),
                new UserChatMessage(contentParts)
            };

            var response = await _chatClient.CompleteChatAsync(messages, options);
            var jsonContent = response.Value.Content[0].Text;

            _logger.LogDebug("OpenAI Vision Card Response: {Response}", jsonContent);

            var result = JsonSerializer.Deserialize<CardExtractionJsonResult>(jsonContent, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            if (result == null)
            {
                _logger.LogWarning("Failed to parse OpenAI Vision response");
                return CreateEmptyCardExtractionData();
            }

            return new CardExtractionData(
                CompanyName: result.CompanyName,
                Persons: result.Persons?.Select(p => new PersonData(
                    Name: p.Name,
                    Designation: p.Designation,
                    Phones: p.Phones ?? new List<string>(),
                    Emails: p.Emails ?? new List<string>(),
                    IsPrimary: p.IsPrimary
                )).ToList() ?? new List<PersonData>(),
                Phones: result.Phones ?? new List<string>(),
                Emails: result.Emails ?? new List<string>(),
                Websites: result.Websites ?? new List<string>(),
                Addresses: result.Addresses?.Select(a => new AddressData(
                    AddressType: a.AddressType,
                    Address: a.Address,
                    City: a.City,
                    State: a.State,
                    Country: a.Country,
                    PinCode: a.PinCode
                )).ToList() ?? new List<AddressData>(),
                Services: result.Services ?? new List<string>(),
                Brands: result.Brands?.Select(b => new BrandData(
                    BrandName: b.BrandName ?? "",
                    Relationship: b.Relationship
                )).ToList() ?? new List<BrandData>(),
                Confidence: result.Confidence,
                RawFrontText: null,
                RawBackText: null
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OpenAI Vision card extraction failed");
            return CreateEmptyCardExtractionData();
        }
    }

    // Generate 4 rotations with contrast boost â€” handles tilted photos and embossed cards
    private static async Task<List<byte[]>> GenerateRotationsAsync(Stream imageStream)
    {
        using var original = await Image.LoadAsync(imageStream);

        // Fix EXIF orientation + boost contrast/brightness for embossed/low-contrast cards
        original.Mutate(x => x
            .AutoOrient()
            .Brightness(1.08f)
            .Contrast(1.15f));

        var results = new List<byte[]>();
        foreach (var angle in new[] { 0f, 90f, 180f, 270f })
        {
            using var variant = original.Clone(ctx =>
            {
                if (angle > 0) ctx.Rotate(angle);
                ctx.Resize(new ResizeOptions { Size = new Size(1200, 1200), Mode = ResizeMode.Max });
            });
            using var ms = new MemoryStream();
            await variant.SaveAsJpegAsync(ms, new JpegEncoder { Quality = 82 });
            results.Add(ms.ToArray());
        }
        return results;
    }


    private static CardExtractionData CreateEmptyCardExtractionData()
    {
        return new CardExtractionData(
            CompanyName: null,
            Persons: new List<PersonData>(),
            Phones: new List<string>(),
            Emails: new List<string>(),
            Websites: new List<string>(),
            Addresses: new List<AddressData>(),
            Services: new List<string>(),
            Brands: new List<BrandData>(),
            Confidence: 0,
            RawFrontText: null,
            RawBackText: null
        );
    }

    private static string GetVisionExtractionPrompt() => @"
Read ALL text visible in the card image(s) above and extract structured data.
Return JSON with fields:
{
  ""company_name"": string|null,
  ""persons"": [{ ""name"": string, ""designation"": string|null, ""phones"": [""with country code e.g. +91XXXXXXXXXX""], ""emails"": [], ""is_primary"": bool }],
  ""phones"": [""ALWAYS with country code e.g. +91XXXXXXXXXX for Indian, +1 for US, etc.""],
  ""emails"": [string],
  ""websites"": [string],
  ""addresses"": [{ ""address_type"": string|null, ""address"": string, ""city"": string|null, ""state"": ""infer from city if not printed"", ""country"": string|null, ""pin_code"": string|null }],
  ""services"": [string],
  ""brands"": [{ ""brand_name"": string, ""relationship"": string|null }],
  ""confidence"": 0.0 - 1.0
}";

    private static string GetCardExtractionSystemPrompt()
    {
        return @"You are an expert Indian Visiting Card Data Extraction Engine.

IMAGE HANDLING:
- The card may be rotated, tilted, or at an angle â€” read text at ANY orientation
- Read text from logos, stylised fonts, embossed text, and watermarks
- If the image is blurry or partially visible, extract what you can confidently read
- NEVER return null just because text is at an angle or in a logo â€” try harder

EXTRACTION RULES:
1. Extract everything visible â€” names, company from logo/header/footer, phones, emails, websites, addresses
2. company_name: Read from the largest/most prominent text, logo text, or header â€” this is almost always present
3. Only set a field to null if it is genuinely absent from the card, not because it was hard to read
4. NEVER invent data that is not on the card
5. Fix common image-to-text errors: 0â†”O, 1â†”I/l, 8â†”B, rnâ†”m

COMPANY NAME â€” LOOK IN THESE PLACES:
- Largest text on the card (usually top or center)
- Logo text / brand name
- Header or footer text
- Domain name in email/website (e.g. john@acmecorp.com â†’ company may be Acme Corp)

MULTIPLE COMPANIES (DEALER CARDS):
- company_name: Main business name only
- brands: Array of associated brands with relationship

PHONE HANDLING â€” ALWAYS INCLUDE COUNTRY CODE:
- Indian mobile (10 digits starting 6-9, or ISD prefix +91/0091/091): normalize to +91XXXXXXXXXX
- Remove spaces, dashes, brackets; strip leading 0 from local Indian numbers
- International numbers: keep country code as-is (e.g. +1, +44, +971, +65)

ADDRESS HANDLING â€” INFER STATE FROM CITY:
- If state is not printed, infer from city:
  Delhi/New Delhi â†’ Delhi, Mumbai/Pune/Nagpur/Nashik/Thane/Navi Mumbai â†’ Maharashtra,
  Bengaluru/Bangalore/Mysuru/Hubli/Mangaluru â†’ Karnataka, Chennai/Coimbatore/Madurai â†’ Tamil Nadu,
  Hyderabad/Secunderabad/Warangal/Vijayawada/Visakhapatnam â†’ Telangana/Andhra Pradesh,
  Kolkata/Howrah/Durgapur â†’ West Bengal, Ahmedabad/Surat/Vadodara/Rajkot â†’ Gujarat,
  Jaipur/Jodhpur/Udaipur/Kota â†’ Rajasthan, Lucknow/Kanpur/Agra/Varanasi/Noida/Ghaziabad â†’ Uttar Pradesh,
  Bhopal/Indore/Jabalpur/Gwalior â†’ Madhya Pradesh, Patna/Muzaffarpur â†’ Bihar,
  Chandigarh â†’ Chandigarh, Ludhiana/Amritsar/Jalandhar â†’ Punjab,
  Bhubaneswar/Cuttack â†’ Odisha, Guwahati â†’ Assam, Dehradun â†’ Uttarakhand,
  Ranchi â†’ Jharkhand, Raipur â†’ Chhattisgarh, Thiruvananthapuram/Kochi/Kozhikode â†’ Kerala,
  Panaji/Goa â†’ Goa
- If state is explicitly printed, always use that value

Return STRICT JSON only.";
    }


    // JSON deserialization classes
    private class CardExtractionJsonResult
    {
        [JsonPropertyName("company_name")]
        public string? CompanyName { get; set; }

        [JsonPropertyName("persons")]
        public List<PersonJsonResult>? Persons { get; set; }

        [JsonPropertyName("phones")]
        public List<string>? Phones { get; set; }

        [JsonPropertyName("emails")]
        public List<string>? Emails { get; set; }

        [JsonPropertyName("websites")]
        public List<string>? Websites { get; set; }

        [JsonPropertyName("addresses")]
        public List<AddressJsonResult>? Addresses { get; set; }

        [JsonPropertyName("services")]
        public List<string>? Services { get; set; }

        [JsonPropertyName("brands")]
        public List<BrandJsonResult>? Brands { get; set; }

        [JsonPropertyName("confidence")]
        public double Confidence { get; set; }
    }

    private class PersonJsonResult
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("designation")]
        public string? Designation { get; set; }

        [JsonPropertyName("phones")]
        public List<string>? Phones { get; set; }

        [JsonPropertyName("emails")]
        public List<string>? Emails { get; set; }

        [JsonPropertyName("is_primary")]
        public bool IsPrimary { get; set; }
    }

    private class AddressJsonResult
    {
        [JsonPropertyName("address_type")]
        public string? AddressType { get; set; }

        [JsonPropertyName("address")]
        public string? Address { get; set; }

        [JsonPropertyName("city")]
        public string? City { get; set; }

        [JsonPropertyName("state")]
        public string? State { get; set; }

        [JsonPropertyName("country")]
        public string? Country { get; set; }

        [JsonPropertyName("pin_code")]
        public string? PinCode { get; set; }
    }

    private class BrandJsonResult
    {
        [JsonPropertyName("brand_name")]
        public string? BrandName { get; set; }

        [JsonPropertyName("relationship")]
        public string? Relationship { get; set; }
    }

}

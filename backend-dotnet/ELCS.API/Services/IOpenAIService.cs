using ELCS.API.DTOs;

namespace ELCS.API.Services;

public interface IOpenAIService
{
    Task<CardExtractionData> ExtractCardFromImagesAsync(Stream frontImage, Stream? backImage);
}

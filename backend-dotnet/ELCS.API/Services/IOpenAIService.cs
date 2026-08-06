
using ELCS.API.DTOs;

namespace ELCS.API.Services;

public interface IOpenAIService
{
    Task<CardExtractionData> ExtractCardFromImagesAsync(Stream frontImage, Stream? backImage);
    Task<VoiceAnalysisResult> AnalyzeVoiceTranscriptAsync(string transcript);
}

public record VoiceAnalysisResult(
    string Transcript,
    string Summary,
    List<string> Topics,
    string Segment,
    string Priority,
    string InterestLevel,
    double Confidence,
    string? LeadName,
    string? CompanyName
);

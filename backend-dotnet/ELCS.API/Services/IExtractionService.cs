using ELCS.API.DTOs;

namespace ELCS.API.Services;

public interface IExtractionService
{
    Task<CardExtractionResponse> ExtractCardAsync(
        Stream frontImage,
        Stream? backImage,
        string frontFileName,
        string? backFileName,
        int exhibitionId,
        int employeeId);

    Task<VoiceExtractionResponse> ExtractVoiceAsync(
        Stream audioStream,
        string fileName,
        int? leadId,
        int employeeId);

    Task<CardExtractionResponse> ExtractCardPreviewAsync(
        Stream frontImage,
        Stream? backImage,
        string frontFileName,
        string? backFileName,
        int exhibitionId);

    Task<CardExtractionResponse> ConfirmAndSaveLeadAsync(
        CardExtractionData extractionData,
        int exhibitionId,
        int employeeId,
        string? tempId = null);
}

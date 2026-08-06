using System.ClientModel;
using OpenAI;
using OpenAI.Audio;

namespace ELCS.API.Services;

public interface ISpeechService
{
    Task<string> TranscribeAudioAsync(Stream audioStream, string fileName);
}

public class WhisperSpeechService : ISpeechService
{
    private readonly ILogger<WhisperSpeechService> _logger;
    private readonly AudioClient _audioClient;

    public WhisperSpeechService(ILogger<WhisperSpeechService> logger, IConfiguration config)
    {
        _logger = logger;
        var apiKey = config["OpenAI:ApiKey"] ?? throw new InvalidOperationException("OpenAI API key not configured");
        _audioClient = new OpenAIClient(new ApiKeyCredential(apiKey)).GetAudioClient("whisper-1");
    }

    public async Task<string> TranscribeAudioAsync(Stream audioStream, string fileName)
    {
        try
        {
            _logger.LogInformation("Starting Whisper transcription for: {FileName}", fileName);

            using var ms = new MemoryStream();
            await audioStream.CopyToAsync(ms);
            ms.Position = 0;

            var options = new AudioTranscriptionOptions
            {
                Language = "hi",   // accepts Hindi + English (Whisper auto-detects mix)
                ResponseFormat = AudioTranscriptionFormat.Text
            };

            var result = await _audioClient.TranscribeAudioAsync(ms, fileName, options);
            var transcript = result.Value.Text ?? string.Empty;

            _logger.LogInformation("Whisper transcription completed. Length: {Length} chars", transcript.Length);
            return transcript;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Whisper transcription failed for: {FileName}", fileName);
            throw;
        }
    }
}

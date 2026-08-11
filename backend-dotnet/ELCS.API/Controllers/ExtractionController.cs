using Microsoft.AspNetCore.Mvc;
using ELCS.API.DTOs;
using ELCS.API.Services;

namespace ELCS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ExtractionController : ControllerBase
{
    private readonly ILogger<ExtractionController> _logger;
    private readonly IExtractionService _extractionService;
    private readonly ILeadService _leadService;
    private readonly IServiceScopeFactory _scopeFactory;

    public ExtractionController(
        ILogger<ExtractionController> logger,
        IExtractionService extractionService,
        ILeadService leadService,
        IServiceScopeFactory scopeFactory)
    {
        _logger = logger;
        _extractionService = extractionService;
        _leadService = leadService;
        _scopeFactory = scopeFactory;
    }

    /// <summary>
    /// Extract visiting card data using OCR + AI (synchronous)
    /// </summary>
    [HttpPost("card")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<ActionResult<CardExtractionResponse>> ExtractCard(
        IFormFile frontImage,
        IFormFile? backImage,
        [FromForm] int exhibitionId,
        [FromForm] int employeeId)
    {
        if (frontImage == null || frontImage.Length == 0)
            return BadRequest(new { error = "Front image is required" });

        _logger.LogInformation(
            "Card extraction request: Exhibition={ExhibitionId}, Employee={EmployeeId}",
            exhibitionId, employeeId);

        try
        {
            using var frontStream = frontImage.OpenReadStream();
            using var backStream = backImage?.OpenReadStream();

            var result = await _extractionService.ExtractCardAsync(
                frontStream,
                backStream,
                frontImage.FileName,
                backImage?.FileName,
                exhibitionId,
                employeeId);

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Card extraction failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Extract card data for preview WITHOUT creating a lead
    /// </summary>
    [HttpPost("card/preview")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<ActionResult<CardExtractionResponse>> ExtractCardPreview(
        IFormFile frontImage,
        IFormFile? backImage,
        [FromForm] int exhibitionId)
    {
        if (frontImage == null || frontImage.Length == 0)
            return BadRequest(new { error = "Front image is required" });

        _logger.LogInformation("Card preview extraction request: Exhibition={ExhibitionId}", exhibitionId);

        try
        {
            using var frontStream = frontImage.OpenReadStream();
            using var backStream = backImage?.OpenReadStream();

            var result = await _extractionService.ExtractCardPreviewAsync(
                frontStream,
                backStream,
                frontImage.FileName,
                backImage?.FileName,
                exhibitionId);

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Card preview extraction failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Confirm and save lead after user reviews extracted data
    /// </summary>
    [HttpPost("card/confirm")]
    public async Task<ActionResult<CardExtractionResponse>> ConfirmAndSaveLead([FromBody] ConfirmLeadRequest request)
    {
        _logger.LogInformation("Lead confirmation request: Exhibition={ExhibitionId}, Employee={EmployeeId}",
            request.ExhibitionId, request.EmployeeId);

        try
        {
            var result = await _extractionService.ConfirmAndSaveLeadAsync(
                request.Extraction,
                request.ExhibitionId,
                request.EmployeeId,
                request.TempId);

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lead confirmation failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

}

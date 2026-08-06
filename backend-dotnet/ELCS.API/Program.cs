using ELCS.API.Data;
using ELCS.API.Services;
using Microsoft.AspNetCore.ResponseCompression;
using Serilog;
using System.IO.Compression;

var builder = WebApplication.CreateBuilder(args);

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .CreateLogger();

builder.Host.UseSerilog();

// Add services to the container
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // Use snake_case for JSON property names (frontend expects this)
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.SnakeCaseLower;
        // Handle DateTime serialization as UTC with 'Z' suffix to fix timezone issues
        options.JsonSerializerOptions.Converters.Add(new ELCS.API.Utils.UtcDateTimeConverter());
        options.JsonSerializerOptions.Converters.Add(new ELCS.API.Utils.UtcNullableDateTimeConverter());
        // Handle enums
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "ELCS API", Version = "v1" });
});

// Database connections
builder.Services.AddSingleton<IDbConnection, DbConnectionFactory>();

// Register Services
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IRoleService, RoleService>();
builder.Services.AddScoped<ILeadService, LeadService>();
builder.Services.AddScoped<IExtractionService, ExtractionService>();
builder.Services.AddScoped<ISpeechService, WhisperSpeechService>();
builder.Services.AddScoped<IOpenAIService, OpenAIService>();

// Order management (spec B/C/D)
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddScoped<ISalesOrderPdfService, SalesOrderPdfService>();
builder.Services.AddScoped<IWhatsAppService, InteraktWhatsAppService>();
builder.Services.AddScoped<IOtpService, OtpService>();
builder.Services.AddScoped<IProductService, ProductService>();
builder.Services.AddHttpClient();

// Rate limiting for the public self-service endpoints. These have no login in
// front of them, so without a cap the OTP endpoint is a free WhatsApp cannon
// and the order endpoint is an open write to the database.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("public", context =>
        System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

// QuestPDF Community licence — free for organisations under USD 1M annual revenue.
// Review https://www.questpdf.com/license/ before shipping to a larger client.
QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

// Response Compression for faster loading
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(new[]
    {
        "application/json",
        "text/plain",
        "image/svg+xml"
    });
});

builder.Services.Configure<BrotliCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.Fastest;
});

builder.Services.Configure<GzipCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.Fastest;
});

// CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins(
            "http://localhost:3000",
            "http://localhost:3001",
            "http://192.168.137.1:3000",
            "http://103.150.136.76:3003",
            "https://exhibitionvistingcard.vercel.app",
            "https://exhibitionvistingcard-git-main-printude-indas.vercel.app",
            "https://exhibitionvistingcard-printude-indas.vercel.app",
            "https://exhibitionvisitingcard.indusanalytics.co.in",
            "https://ksk-vc.indusanalytics.co.in"
        )
        .AllowAnyMethod()
        .AllowAnyHeader()
        .AllowCredentials();
    });
});

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseSerilogRequestLogging();

// Response compression - must be early in pipeline
app.UseResponseCompression();

// Apply CORS before routing
app.UseCors("AllowFrontend");

// Must sit after CORS so a throttled response still carries CORS headers,
// otherwise the browser reports an opaque network error instead of the 429.
app.UseRateLimiter();

// Serve uploaded card images as static files
var uploadsPath = Path.Combine(app.Environment.ContentRootPath, "uploads");
Directory.CreateDirectory(uploadsPath);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(uploadsPath),
    RequestPath = "/uploads"
});

app.MapControllers();

// Health check endpoint
app.MapGet("/health", async (IDbConnection db) =>
{
    try
    {
        using var conn = db.CreateConnection();
        await conn.OpenAsync();
        return Results.Ok(new { status = "healthy", database = "connected" });
    }
    catch
    {
        return Results.Ok(new { status = "degraded", database = "disconnected" });
    }
});

app.Run();

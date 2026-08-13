using ELCS.API.Utils;
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
builder.Services.AddScoped<IOpenAIService, OpenAIService>();

// Order management (spec B/C/D)
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddScoped<ISalesOrderPdfService, SalesOrderPdfService>();
builder.Services.AddScoped<IWhatsAppService, InteraktWhatsAppService>();
builder.Services.AddScoped<IPublicSessionService, PublicSessionService>();
builder.Services.AddScoped<IProductService, ProductService>();
builder.Services.AddScoped<IProductImportService, ProductImportService>();
builder.Services.AddScoped<ISettingsService, SettingsService>();
builder.Services.AddScoped<ILeadMediaService, LeadMediaService>();
builder.Services.AddScoped<ISilverCouponService, SilverCouponService>();
builder.Services.AddHttpClient();

// Rate limiting for the public self-service endpoints. These have no login in
// front of them, so without a cap the OTP endpoint is a free WhatsApp cannon
// and the order endpoint is an open write to the database.
//
// Partitioned by session token when the request carries one, not by IP: an
// exhibition is exactly the case where many genuine customers share one
// venue Wi-Fi's public IP, so an IP-keyed limit throttled all of them
// together as if they were one caller. Before a session exists — the OTP /
// session-start endpoint, the actual abuse target — there is nothing better
// to key on than IP, which is where this still protects what it was for.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("public", context =>
    {
        var sessionToken = context.Request.Headers["X-Public-Session"].FirstOrDefault();
        var partitionKey = !string.IsNullOrEmpty(sessionToken)
            ? $"session:{sessionToken}"
            : $"ip:{context.Connection.RemoteIpAddress}";

        return System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            partitionKey,
            factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            });
    });
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
        // ONE predicate decides, deliberately.
        //
        // WithOrigins() and SetIsOriginAllowed() do not combine: WithOrigins
        // works by installing a default predicate that checks its list, and
        // SetIsOriginAllowed replaces that predicate outright. Using both meant
        // the configured list was silently discarded and only the LAN check ran
        // — so localhost passed (it is loopback) while the Vercel origin was
        // refused however it was configured. Both rules now live in one place.
        //
        // Configured origins, so a new frontend deployment needs a setting
        // rather than a rebuild:
        //   "Cors": { "AllowedOrigins": [ "https://tejoo-eloms.vercel.app" ] }
        //   Cors__AllowedOrigins__0=https://tejoo-eloms.vercel.app
        var allowed = (builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
                       ?? Array.Empty<string>())
            .Where(o => !string.IsNullOrWhiteSpace(o))
            .Select(o => o.TrimEnd('/'))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        policy.SetIsOriginAllowed(origin =>
                   allowed.Contains(origin.TrimEnd('/')) || IsPrivateLanOrigin(origin))
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

// An unhandled exception resets the response and drops the CORS headers with
// it, so the browser reports "No 'Access-Control-Allow-Origin' header" for what
// is actually a server crash — which sends everyone hunting the wrong problem.
// Sitting inside UseCors keeps those headers on the error response, and the
// JSON body makes the real cause visible in the network tab.
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Unhandled exception on {Method} {Path}",
            context.Request.Method, context.Request.Path);

        // Once the response has started the headers are already on the wire and
        // there is nothing safe to write — let it bubble.
        if (context.Response.HasStarted) throw;

        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        context.Response.ContentType = "application/json";

        await context.Response.WriteAsJsonAsync(new
        {
            error = "The server hit an unexpected error.",
            // The message is the whole point of this handler while developing;
            // in production it stays in the log rather than going to the client.
            detail = app.Environment.IsDevelopment() ? ex.Message : null,
        });
    }
});

// ── Uploaded files ────────────────────────────────────────────────────────
//
// Storage:UploadsRoot points the whole uploads tree wherever you like. Set it
// to a path OUTSIDE the deployment folder in production: everything under it is
// irreplaceable — product photographs, visiting cards, team photos and issued
// Sales Orders — and a republish that cleans the target directory would take
// the lot with it. Left unset it falls back to the old in-app location, so a
// development checkout keeps working with no configuration.
var uploadsPath = builder.Configuration["Storage:UploadsRoot"] is { Length: > 0 } configuredRoot
    ? Path.GetFullPath(configuredRoot)
    : Path.Combine(app.Environment.ContentRootPath, UploadPaths.RootFolder);

UploadPaths.UseRoot(uploadsPath);
app.Logger.LogInformation("Uploads root: {UploadsRoot}", UploadPaths.Root);

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(UploadPaths.Root),
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

/// <summary>
/// True when the origin's host is a loopback or RFC1918 private address, on any
/// port. Used by the CORS policy so phones on the same Wi-Fi can reach the API
/// without the machine's current IP being hard-coded.
/// </summary>
static bool IsPrivateLanOrigin(string origin)
{
    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
    if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return false;

    if (uri.IsLoopback) return true;

    if (!System.Net.IPAddress.TryParse(uri.Host, out var ip)) return false;
    if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return false;

    var b = ip.GetAddressBytes();
    return b[0] switch
    {
        10  => true,                              // 10.0.0.0/8
        172 => b[1] >= 16 && b[1] <= 31,           // 172.16.0.0/12
        192 => b[1] == 168,                        // 192.168.0.0/16
        169 => b[1] == 254,                        // link-local, e.g. a direct cable
        _   => false,
    };
}

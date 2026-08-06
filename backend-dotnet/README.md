# ELCS Backend — ASP.NET Core 10 (C#)

Exhibition Lead Capture System — REST API

Single-tenant: one deployment serves one company, and all users share a single lead pool.

## Requirements

- .NET 10 SDK
- SQL Server 2019+
- OpenAI API key (GPT-4o-mini + Whisper)

## Quick Start

### 1. Configure appsettings.json

Copy `ELCS.API/appsettings.example.json` to `ELCS.API/appsettings.json` and fill in values:

```json
{
  "Urls": "http://localhost:5008",
  "ConnectionStrings": {
    "DefaultConnection": "Server=YOUR_SERVER\\SQLEXPRESS;Database=ELCS;Integrated Security=True;TrustServerCertificate=True;MultipleActiveResultSets=True;Encrypt=True"
  },
  "OpenAI": {
    "ApiKey": "sk-your-openai-api-key",
    "Model": "gpt-4o-mini",
    "MaxTokens": 500
  }
}
```

`appsettings.json` is gitignored — it holds live credentials and must never be committed.

### 2. Database Setup

```sql
CREATE DATABASE ELCS;
-- Run SQL migration scripts in order from ELCS.API/database/
```

> **Note:** `database/` currently contains only `014_remove_multitenancy_and_crm.sql`.
> Scripts `001`–`013` are not present in this repository, so the schema cannot be
> provisioned from scratch here; `014` expects a database already created by those
> earlier scripts. Recover them from a backup or script a fresh baseline from a
> running database.

### 3. Build and Run

```bash
cd ELCS.API
dotnet restore
dotnet build
dotnet run
```

Available at:
- API: `http://localhost:5008`
- Swagger: `http://localhost:5008/swagger`
- Health: `http://localhost:5008/health`

## Project Structure

```
ELCS.API/
├── Controllers/
│   ├── AuthController.cs           Login, profile get/update
│   ├── ExtractionController.cs     Card OCR + voice extraction
│   ├── LeadsController.cs          Lead CRUD
│   ├── ExhibitionsController.cs    Exhibition CRUD
│   ├── AnalyticsController.cs      Dashboard metrics
│   ├── UsersController.cs          User management
│   └── RolesController.cs          Role + permission management
├── Services/
│   ├── ExtractionService.cs        Card + voice extraction pipeline
│   ├── LeadService.cs              Lead CRUD, JSON column parsing
│   ├── OpenAIService.cs            GPT-4o-mini card OCR + voice analysis
│   ├── WhisperSpeechService.cs     Whisper voice transcription
│   ├── AuthService.cs              SHA-256 password hashing + login
│   └── RoleService.cs              Role + permission management
├── Data/
│   └── DbConnection.cs             Dapper SQL connection factory
├── Models/                         POCO models
├── DTOs/                           Request/Response records
├── Utils/                          DateTime converters
├── database/                       SQL migration scripts
└── uploads/
    └── cards/                      Visiting card images (per lead: front/back)
```

## API Reference

### Authentication
```
POST /api/auth/login                 Body: { email, password }
GET  /api/auth/profile/{id}
PUT  /api/auth/profile/{id}
```

### Card Extraction
```
POST /api/extraction/card/preview    Extract without saving (returns temp_id + extraction)
POST /api/extraction/card/confirm    Confirm preview and create lead (moves temp images)
POST /api/extraction/card            Direct extract + save (legacy single-step)
POST /api/extraction/voice           Transcribe audio + analyze with GPT
POST /api/extraction/voice/confirm   Persist voice analysis to lead
```

### Leads
```
GET    /api/leads                    ?exhibition_id, source_code, status_code, assigned_employee_id, service, limit, offset
GET    /api/leads/{id}
POST   /api/leads
PUT    /api/leads/{id}
DELETE /api/leads/{id}
```

### Exhibitions
```
GET    /api/exhibitions
POST   /api/exhibitions
PUT    /api/exhibitions/{id}
DELETE /api/exhibitions/{id}
```

### Analytics
```
GET /api/analytics/summary               ?exhibition_id
GET /api/analytics/employee-performance  ?exhibition_id
GET /api/analytics/exhibitions
```

### Users
```
GET    /api/users
POST   /api/users
PUT    /api/users/{id}
DELETE /api/users/{id}
POST   /api/users/{id}/reset-password
```

### Roles
```
GET    /api/roles
POST   /api/roles
PUT    /api/roles/{id}
DELETE /api/roles/{id}
```

### Static Files
```
GET /uploads/cards/{leadId}/front.jpg
GET /uploads/cards/{leadId}/back.jpg
```

### Health
```
GET /health    Returns { status, database }
```

## Key Technical Details

### JSON Serialization
- Uses `SnakeCaseLower` naming policy — all JSON uses `snake_case`
- DateTime values serialized as UTC with `Z` suffix; frontend converts to IST for display

### Authentication
- No JWT — SHA-256 password hash stored in `Employees` table
- Login takes email + password only
- On success the frontend stores `auth_token = emp_{employee_id}` plus the employee profile in `localStorage`
- The API client extracts the id from that token and sends it as the `X-Employee-Id` request header on every call
- `AuthController` reads that header to restrict profile read/update to the profile's own owner

> The header is unsigned and unverified. Any employee id can be supplied by hand to act
> as that user, so this identifies the caller but does not authenticate them.

### Permissions
Roles hold a JSON array of permission keys (`scan_cards`, `view_leads`, `view_dashboard`,
`view_exhibitions`, `manage_exhibitions`, `view_report`, `manage_users`, `manage_roles`).
A user with `RoleId = NULL` has full access.

> **Not enforced server-side.** No controller checks a permission key; the keys gate the
> frontend UI only. Any authenticated caller can reach any endpoint directly.

### Card Extraction Pipeline
1. Front (and optional back) image uploaded as `multipart/form-data`
2. Each image is rendered at 4 rotations (0°, 90°, 180°, 270°) with a contrast boost — all four are attached to a **single** GPT-4o-mini Vision request, which identifies the readable orientation itself
3. Structured JSON extraction returned (name, company, phones, emails, addresses, services, etc.)
4. `preview` endpoint saves images to `uploads/cards/temp/{guid}/` — no lead created yet
5. `confirm` endpoint moves images to `uploads/cards/{leadId}/`, creates lead in DB
6. Duplicate detection runs before save (phone / email / name+company similarity scoring)
7. Lead auto-segmented: `decision_maker`, `influencer`, `researcher`, or `general`

### Voice Extraction Pipeline
1. Audio file uploaded to Whisper (`whisper-1`) for transcription
2. Transcript sent to GPT-4o-mini to extract: segment, priority, summary
3. `voice/confirm` links analysis result to the matched lead

### Data Storage
- Lead child records (additional persons, phones, emails, addresses, websites, services,
  brands, topics) are stored as **JSON columns on the `Leads` table**, not as normalized
  child tables. `LeadService` parses them into the `LeadPhone` / `LeadAddress` / … POCOs
  on read; those types exist only as parsing targets.
- `LeadMessages` is a real table.
- `FrontImagePath` / `BackImagePath` columns on `Leads` store relative paths
- Classification columns on `Leads` — `Category`, `Vertical`, `TurnOver`, `TeamSize` (free text) — are returned by the leads list query and inline-editable on the Report page / Lead Detail. `TurnOver` and `TeamSize` are filtered by parsing their leading number into a Min–Max range
- Static files served by `UseStaticFiles` with `PhysicalFileProvider` at `/uploads`, with
  no authorization check — anything under `uploads/` is publicly readable by URL

### Services Filter
- `Services` is stored as a JSON array column on `Leads`
- Keyword search uses SQL Server `OPENJSON` for efficient JSON array filtering

### Response Compression
- Brotli + Gzip compression enabled for JSON and static text responses

## CORS Configuration

Allowed origins (configured in `Program.cs`):
- `http://localhost:3000`, `http://localhost:3001`
- `http://192.168.137.1:3000`
- `http://103.150.136.76:3003`
- `https://exhibitionvistingcard.vercel.app`
- `https://exhibitionvistingcard-git-main-printude-indas.vercel.app`
- `https://exhibitionvistingcard-printude-indas.vercel.app`
- `https://exhibitionvisitingcard.indusanalytics.co.in`
- `https://ksk-vc.indusanalytics.co.in`

## Troubleshooting

| Error | Fix |
|-------|-----|
| Card extraction fails | Verify `OpenAI:ApiKey` in `appsettings.json` |
| Voice transcription fails | Same OpenAI key — Whisper uses the same credentials |
| Images not loading | Ensure `FrontImagePath`/`BackImagePath` columns exist (run migration) |
| CORS error | Add your frontend domain to the CORS origins list in `Program.cs` |
| Database connection failed | Check connection string; SQL Server must be running |
| OpenAI rate limit | Check quota at platform.openai.com |
| Port conflict | Change `Urls` in `appsettings.json` |

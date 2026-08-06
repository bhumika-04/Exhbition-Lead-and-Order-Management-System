# ELCS Backend — ASP.NET Core 10 (C#)

Exhibition Lead Capture System — REST API

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
    "DefaultConnection": "Server=YOUR_SERVER\\SQLEXPRESS;Database=ELCS;Integrated Security=True;TrustServerCertificate=True;MultipleActiveResultSets=True;Encrypt=True",
    "CRMConnection": "Server=YOUR_CRM_SERVER,1433;Database=YOUR_CRM_DB;User Id=YOUR_USER;Password=YOUR_PASSWORD;TrustServerCertificate=True;MultipleActiveResultSets=True;Encrypt=True"
  },
  "OpenAI": {
    "ApiKey": "sk-your-openai-api-key",
    "Model": "gpt-4o-mini",
    "MaxTokens": 500
  },
  "CRM": {
    "CompanyId": 1,
    "LedgerGroupId": 1,
    "LedgerCodePrefix": "C",
    "LedgerType": "Sundry Debtors",
    "SystemUserId": 1
  }
}
```

### 2. Database Setup

```sql
CREATE DATABASE ELCS;
-- Run SQL migration scripts in order from ELCS.API/database/
```

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
│   ├── LeadsController.cs          Lead CRUD + CRM push
│   ├── ExhibitionsController.cs    Exhibition CRUD
│   ├── AnalyticsController.cs      Dashboard metrics (tenant-scoped)
│   ├── UsersController.cs          User management (tenant-scoped)
│   ├── CompaniesController.cs      Tenant/company management (super admin only)
│   └── RolesController.cs          Role + permission management
├── Services/
│   ├── ExtractionService.cs        Card + voice extraction pipeline
│   ├── LeadService.cs              Lead CRUD, JSON column parsing, CRM push
│   ├── OpenAIService.cs            GPT-4o-mini card OCR + voice analysis
│   ├── WhisperSpeechService.cs     Whisper voice transcription
│   ├── AuthService.cs              SHA-256 password hashing + login
│   └── RoleService.cs              Role + permission management
├── Data/
│   ├── DbConnectionFactory.cs      Dapper SQL connection factory
│   └── TenantContext.cs            Scoped tenant context + TenantMiddleware
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
POST /api/auth/login                 Body: { email, password, company_name }  (company_name required except for super admin)
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
POST   /api/leads/{id}/push-to-crm
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

### Companies (super admin only)
```
GET    /api/companies            List companies + active user counts
GET    /api/companies/{id}
POST   /api/companies            Create company + its first admin user
PUT    /api/companies/{id}
DELETE /api/companies/{id}        Soft delete (blocked if active users exist)
GET    /api/companies/{id}/users
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
- Login requires `company_name` (matched against the `Companies` table) for all users except the super admin
- On success the frontend stores `auth_token = emp_{employee_id}` plus the employee profile in `localStorage`
- The API client extracts the id from that token and sends it as the `X-Employee-Id` request header on every call

### Multi-Tenancy
The system is multi-tenant: each company is a row in the `Companies` table, and `Employees`, `Leads`, and `Exhibitions` carry a nullable `TenantId` FK to it.

- **`TenantMiddleware`** (in `Data/TenantContext.cs`) runs on every request, reads `X-Employee-Id`, looks up the employee's `TenantId` and `IsSuperAdmin` flag, and populates the scoped **`TenantContext`**.
- **Regular users** only ever see/modify rows where `TenantId` matches their company. This is enforced in every by-ID and list operation across leads, exhibitions, users, roles, and analytics — not just the list endpoints.
- **Super admins** (`IsSuperAdmin = 1`, `TenantId = NULL`, e.g. `admin@example.com`) bypass tenant filtering and additionally manage companies via `/api/companies`. They never log in with a company name. The list/detail queries return the owning company's name (`tenant_name` on leads, `company_name` on roles) so the super admin can tell which tenant each record belongs to.
- **Roles are per-tenant** (`Roles.TenantId`): each company manages its own roles (unique name within the company).
- **`POST /api/companies` is atomic** — one transaction inserts the company, seeds the standard roles (Admin, Manager, Sales Executive, Salesperson), and creates the first admin. Emails are globally unique on `Employees`, so a duplicate admin email is rejected with `409` up front (no orphaned company).
- New leads/exhibitions/users/roles inherit the creator's `TenantId` automatically.
- **Duplicate detection is tenant-scoped**: the same contact may exist independently in different companies and is only flagged as a duplicate within the same tenant (the tenant is derived from the scanning exhibition's `TenantId`).

### Card Extraction Pipeline
1. Front (and optional back) image uploaded as `multipart/form-data`
2. Image sent to GPT-4o-mini Vision API at 4 rotations (0°, 90°, 180°, 270°) — best result selected
3. Structured JSON extraction returned (name, company, phones, emails, addresses, services, etc.)
4. `preview` endpoint saves images to `uploads/cards/temp/{guid}/` — no lead created yet
5. `confirm` endpoint moves images to `uploads/cards/{leadId}/`, creates lead in DB
6. Duplicate detection runs before save (phone / email / name+company similarity scoring), scoped to the current tenant only
7. Lead auto-segmented: `decision_maker`, `influencer`, `researcher`, or `general`

### Voice Extraction Pipeline
1. Audio file uploaded to Whisper (`whisper-1`) for transcription
2. Transcript sent to GPT-4o-mini to extract: segment, priority, summary
3. `voice/confirm` links analysis result to the matched lead

### Data Storage
- Lead child records (phones, emails, addresses, websites, services) stored in separate normalized tables
- `FrontImagePath` / `BackImagePath` columns on `Leads` table store relative paths
- Classification columns on `Leads` — `Category`, `Vertical`, `TurnOver`, `TeamSize` (free text) — are returned by the leads list query and inline-editable on the Report page / Lead Detail. `TurnOver` and `TeamSize` are filtered by parsing their leading number into a Min–Max range
- Static files served by `UseStaticFiles` with `PhysicalFileProvider` at `/uploads`

### CRM / ERP Push
- Creates a `LedgerMaster` entry in a second SQL Server database (`CRMConnection`)
- Requires `push_to_crm` permission on the acting user's role
- CRM company/ledger config from `appsettings.json` under the `CRM` section

### Services Filter
- `services` column stored as a JSON array on the `Leads` table
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
| CRM push fails | Verify `CRMConnection` string and `CRM` config section |
| OpenAI rate limit | Check quota at platform.openai.com |
| Port conflict | Change `Urls` in `appsettings.json` |

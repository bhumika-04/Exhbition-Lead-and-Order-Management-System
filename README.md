# Exhibition Lead Capture System (ELCS)

A lead management system for capturing and managing visitor information at exhibitions using visiting card scanning and voice notes.

## Architecture

| Layer | Technology |
|---|---|
| Backend | ASP.NET Core 10 (C#), Dapper, SQL Server |
| Frontend | Next.js 14 (React + TypeScript), Tailwind CSS |
| AI — Card OCR | OpenAI GPT-4o-mini (Vision API, 4 rotations) |
| AI — Voice | OpenAI Whisper (`whisper-1`) |
| Logging | Serilog |
| Hosting | Backend on AWS EC2, Frontend on Vercel |

## Features

- **Multi-Tenancy** — Multiple companies share one deployment with full data isolation; a super admin manages tenants. See [Multi-Tenancy](#multi-tenancy).
- **Visiting Card Scanning** — Upload front and/or back image; GPT-4o-mini extracts all contact fields. Preview before saving.
- **Mandatory Services** — Services/products are required at scan time; prompted if not on the card.
- **Voice Notes** — Record discussion summaries; Whisper transcribes, GPT analyzes (segment, priority, summary).
- **Duplicate Detection** — Phone / email / name+company similarity scoring before lead is saved, scoped to the current company (the same person can exist independently across tenants).
- **Lead Segmentation** — Auto-categorized: `decision_maker`, `influencer`, `researcher`, `general`.
- **Filters** — Leads and Report pages filter by exhibition, status, priority, source, state/city, services, date range, plus **Category** and **Vertical** (dropdowns) and **Turn-over / Team-size** (Min–Max numeric ranges parsed from the free-text values).
- **Classification Fields** — Category, Vertical, Turn-over, Team-size are inline-editable on the Report table and the Lead Detail page, and shown as chips on lead cards.
- **Lead Detail** — View/edit all fields, visiting card images with lightbox, editable services.
- **Share / Save Contact** — Share lead as text or export as `.vcf` contact file.
- **WhatsApp Quick-Open** — Pre-filled WhatsApp message opened in browser.
- **Push to CRM / ERP** — Creates a `LedgerMaster` entry in the connected ERP database.
- **Role Management** — Custom roles with granular permission keys.
- **User Management** — Employee accounts with role assignment.
- **Analytics Dashboard** — Total leads, conversion, sources, daily trend.
- **Webcam Support** — Desktop users can capture card photos via webcam (single or multi-camera).

## Quick Start

### Prerequisites

- .NET 10 SDK
- Node.js 18+
- SQL Server 2019+
- OpenAI API key

### 1. Database Setup

```sql
CREATE DATABASE ELCS;
-- Run migrations in order from backend-dotnet/ELCS.API/database/, including:
-- 009_add_roles_and_permissions.sql
-- 010_add_classification_fields.sql
-- 011_add_multi_tenancy.sql        Companies table + TenantId columns + seed default company / super admin
-- 012_add_role_tenancy.sql         Per-tenant roles (Roles.TenantId + composite unique role name)
-- 013_split_tushardhote_tenant.sql (data) example of moving an exhibition + its leads into a new tenant
-- ALTER TABLE Leads ADD FrontImagePath NVARCHAR(500) NULL, BackImagePath NVARCHAR(500) NULL;
```

### 2. Backend Setup

```bash
cd backend-dotnet/ELCS.API
# Copy appsettings.example.json → appsettings.json and fill in values
dotnet restore
dotnet run
```

Backend: `http://localhost:5008`  
Swagger: `http://localhost:5008/swagger`

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:3000`

## Configuration

### Backend — `appsettings.json`

```json
{
  "Urls": "http://localhost:5008",
  "ConnectionStrings": {
    "DefaultConnection": "Server=...;Database=ELCS;...",
    "CRMConnection": "Server=...;Database=CRM_DB;..."
  },
  "OpenAI": {
    "ApiKey": "sk-...",
    "Model": "gpt-4o-mini",
    "MaxTokens": 2000
  },
  "CRM": {
    "CompanyId": 2,
    "LedgerGroupId": 1,
    "LedgerCodePrefix": "C",
    "LedgerType": "Sundry Debtors",
    "SystemUserId": 2
  }
}
```

### Frontend — `.env.local`

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.com
```

## Project Structure

```
ExhibitionVistingCard/
├── backend-dotnet/
│   └── ELCS.API/
│       ├── Controllers/
│       │   ├── AuthController.cs
│       │   ├── ExtractionController.cs
│       │   ├── LeadsController.cs
│       │   ├── ExhibitionsController.cs
│       │   ├── AnalyticsController.cs
│       │   ├── UsersController.cs
│       │   ├── CompaniesController.cs  Tenant management (super admin)
│       │   └── RolesController.cs
│       ├── Services/
│       │   ├── ExtractionService.cs     Card + voice extraction pipeline
│       │   ├── LeadService.cs           Lead CRUD, JSON column parsing, CRM push
│       │   ├── OpenAIService.cs         GPT-4o-mini card OCR + voice analysis
│       │   ├── WhisperSpeechService.cs  Whisper voice transcription
│       │   ├── AuthService.cs           Password hashing + login
│       │   └── RoleService.cs           Role + permission management
│       ├── Models/                      POCO models (incl. Company)
│       ├── DTOs/                        Request/Response records
│       ├── Data/                        Dapper connection factory + TenantContext/middleware
│       ├── database/                    SQL migration scripts
│       └── uploads/
│           └── cards/                   Visiting card images (front/back per lead)
│
└── frontend/
    ├── app/
    │   ├── chat/page.tsx               Card scanning + voice notes
    │   ├── leads/page.tsx              Lead list with filters
    │   ├── leads/[id]/page.tsx         Lead detail, edit, quick actions
    │   ├── exhibitions/page.tsx        Exhibition CRUD
    │   ├── dashboard/page.tsx          Analytics
    │   ├── report/page.tsx             Reports
    │   ├── users/page.tsx              User management
    │   ├── roles/page.tsx              Role management
    │   └── auth/login/page.tsx         Login
    ├── components/
    │   ├── AppShell.tsx
    │   ├── Sidebar.tsx
    │   └── BottomNav.tsx
    └── lib/
        ├── api.ts                      Axios client + all API methods
        ├── types.ts                    TypeScript interfaces
        ├── auth.ts                     Auth helpers + hasPermission()
        └── usePermissionGuard.ts       Route-level permission hook
```

## Usage Flow

### Scan a Visiting Card
1. Login → Card Scanner tab
2. Select the active exhibition
3. Tap **Take Photo** (opens webcam on desktop, camera on mobile) or **Upload from Gallery**
4. Confirm or skip the back side
5. AI extracts all contact fields — review the preview
6. If services were not on the card, enter at least one (or choose "Other")
7. Correct any fields if needed → **Save Lead**

### Record a Voice Note
1. Tap the microphone icon on the Scanner page
2. Record a discussion summary (mention the person's name)
3. Whisper transcribes → GPT extracts segment, priority, and summary
4. Confirm in the modal — saved to the matched lead

### Manage Leads
- **Leads** tab → filter by exhibition, status, source, employee, or service keyword
- Click a lead → view full details, edit, share, save contact, WhatsApp, Push to CRM

### Push to CRM
- Requires `push_to_crm` permission
- Creates a `LedgerMaster` entry in the ERP database using the configured CRM connection

## Permissions

| Key | Description |
|---|---|
| `scan_cards` | Access card scanner and voice notes |
| `view_leads` | View lead list and detail |
| `view_dashboard` | View analytics dashboard |
| `view_exhibitions` | View exhibitions list |
| `manage_exhibitions` | Create, edit, delete exhibitions |
| `view_report` | View reports page |
| `push_to_crm` | Push leads to CRM / ERP |
| `manage_users` | Create, edit, delete users |
| `manage_roles` | Create, edit, delete roles |

Users with no role assigned (`role_id = NULL`) have full access within their own company.

## Multi-Tenancy

Multiple companies (tenants) share a single deployment with full data isolation.

- The `Companies` table holds tenants; `Employees`, `Leads`, and `Exhibitions` carry a `TenantId` FK (migration `011_add_multi_tenancy.sql`).
- On login a user supplies their **company name** (matched against `Companies`); the issued token is `emp_{employee_id}`, and the frontend sends it as the `X-Employee-Id` header on every request.
- `TenantMiddleware` resolves that header into a scoped `TenantContext` (`TenantId`, `IsSuperAdmin`). Every list **and** by-ID operation (leads, exhibitions, users, roles, analytics) filters by `TenantId`, so users can only read or modify their own company's data.
- A **super admin** (`IsSuperAdmin = 1`, `TenantId = NULL`, e.g. `admin@example.com`) logs in without a company, sees across all tenants, and manages companies via `/api/companies`. To help disambiguate the merged view, the super admin sees an **owning-company badge** on each lead card and a **company label** on each role (regular users don't, since they only ever see their own).
- **Roles are per-tenant** (`Roles.TenantId`, migration `012_add_role_tenancy.sql`): each company has its own role set with a unique role name *within* the company.
- **Creating a company** (`POST /api/companies`) is atomic — in one transaction it inserts the company, seeds the standard roles (Admin, Manager, Sales Executive, Salesperson), and creates the first admin user. Admin emails are globally unique, so a duplicate is rejected with `409` before anything is created.
- New leads/exhibitions/users/roles inherit the creator's tenant; duplicate detection is scoped per-tenant, so the same contact can exist independently in different companies.

## API Endpoints

### Authentication
```
POST /api/auth/login                 Body: { email, password, company_name }  (company_name required except super admin)
GET  /api/auth/profile/{id}
PUT  /api/auth/profile/{id}
```

### Card Extraction
```
POST /api/extraction/card/preview    Extract without creating lead (returns temp_id)
POST /api/extraction/card/confirm    Confirm + save lead (moves temp images)
POST /api/extraction/card            Direct extract + save (legacy)
POST /api/extraction/voice           Transcribe + analyze voice note
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

### Users & Roles
```
GET    /api/users
POST   /api/users
PUT    /api/users/{id}
DELETE /api/users/{id}
POST   /api/users/{id}/reset-password

GET    /api/roles
POST   /api/roles
PUT    /api/roles/{id}
DELETE /api/roles/{id}
```

### Companies (super admin only)
```
GET    /api/companies
GET    /api/companies/{id}
POST   /api/companies            Creates company + its first admin user
PUT    /api/companies/{id}
DELETE /api/companies/{id}
GET    /api/companies/{id}/users
```

### Static Files
```
GET /uploads/cards/{leadId}/front.jpg
GET /uploads/cards/{leadId}/back.jpg
```

## Deployment

| Component | Platform |
|---|---|
| Frontend | Vercel — `exhibitionvistingcard.vercel.app` |
| Backend | AWS EC2 — `exhibitionvisitingcard.indusanalytics.co.in` |
| Database | SQL Server on EC2 |

CORS is configured for all Vercel preview URLs and the production backend domain.

## Security

- No JWT — session stored in `localStorage` as `auth_token = emp_{employee_id}`, sent as the `X-Employee-Id` header
- Tenant isolation enforced server-side on every list and by-ID operation (see [Multi-Tenancy](#multi-tenancy))
- Passwords hashed with SHA-256
- SQL injection protected by Dapper parameterization
- 20 MB limit on card images, 50 MB on audio
- OpenAI API key kept server-side only

## Common Issues

| Issue | Fix |
|---|---|
| Card extraction fails | Check `OpenAI:ApiKey` in `appsettings.json` |
| Voice transcription fails | Same key — Whisper uses the same OpenAI credentials |
| Images not loading | Ensure `FrontImagePath`/`BackImagePath` columns exist (run migration) |
| CORS error | Add your frontend domain to the CORS list in `Program.cs` |
| Database connection failed | Verify connection string and SQL Server service |
| OpenAI rate limit | Check quota at platform.openai.com |

# Exhibition Lead Capture System (ELCS)

A lead management system for capturing and managing visitor information at exhibitions using visiting card scanning and voice notes.

## Architecture

| Layer | Technology |
|---|---|
| Backend | ASP.NET Core 10 (C#), Dapper, SQL Server |
| Frontend | Next.js 14 (React + TypeScript), Tailwind CSS |
| AI — Card OCR | OpenAI GPT-4o-mini (Vision API, 4 rotations) |
| WhatsApp | Interakt (order confirmation, welcome, testimonial, OTP) |
| PDF | QuestPDF (Sales Order) |
| Logging | Serilog |
| Hosting | Backend on AWS EC2, Frontend on Vercel |

Single-tenant: one deployment serves one company. All users of a deployment share the same lead pool.

## Features

- **Visiting Card Scanning** — Upload front and/or back image; GPT-4o-mini extracts all contact fields. Preview before saving.
- **Mandatory Services** — Services/products are required at scan time; prompted if not on the card.
- **Duplicate Detection** — Phone / email / name+company similarity scoring before a lead is saved.
- **Team Photo** — Capture, upload, or link a photo of the lead with the team; one or many per lead.
- **Testimonial** — Drive link against the lead, sent on WhatsApp with a custom message.
- **Lead Segmentation** — Auto-categorized: `decision_maker`, `influencer`, `researcher`, `general`.
- **Filters** — Leads and Report pages filter by exhibition, status, priority, source, state/city, services, date range, plus **Category** and **Vertical** (dropdowns) and **Turn-over / Team-size** (Min–Max numeric ranges parsed from the free-text values).
- **Classification Fields** — Category, Vertical, Turn-over, Team-size are inline-editable on the Report table and the Lead Detail page, and shown as chips on lead cards.
- **Lead Detail** — View/edit all fields, visiting card images with lightbox, editable services.
- **Order Placement** — A lead can place multiple orders; each order holds any number of items (Suit / Lehenga / Saree) with barcode, size, colour, pieces, rate and customization. No in-app inventory — barcodes are recorded for manual cross-check against the ERP.
- **Advance & Lucky-Draw Coupons** — Calculated on the lead's combined value across all their orders. See [Advance & Coupons](#advance--coupons).
- **Sales Order PDF** — Generated on confirmation; itemised with advance and balance due.
- **WhatsApp Order Confirmation** — Sent via Interakt with the Sales Order PDF attached.
- **Share / Save Contact** — Share lead as text or export as `.vcf` contact file.
- **WhatsApp Quick-Open** — Pre-filled WhatsApp message opened in browser.
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

The database is provisioned by **restoring a backup of the previous multi-tenant database**,
then running `014` against the restored copy to collapse it to single-tenant:

```sql
-- 1. Restore the old ELCS backup under a new database name for this project
-- 2. Run against the restored database, in order:
--    014_remove_multitenancy_and_crm.sql   drops Companies, TenantId, IsSuperAdmin, CrmLedgerId
--    015_add_order_management.sql          adds Orders, OrderItems, WhatsAppMessages
```

`014` opens with a pre-flight `SELECT` reporting how many distinct tenants the restored
data contains. **Run that first.** If it returns more than one, the script will merge those
companies' leads into a single pool and the split cannot be recovered afterwards.

Migrations `001`–`013` are intentionally not kept in this repository — the schema they
built lives in the backup instead, so `014` expects an already-restored database rather
than an empty one.

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
    "DefaultConnection": "Server=...;Database=ELCS;..."
  },
  "OpenAI": {
    "ApiKey": "sk-...",
    "Model": "gpt-4o-mini",
    "MaxTokens": 500
  },
  "PublicBaseUrl": "https://your-backend-domain.com",
  "Interakt": {
    "ApiKey": "...",
    "BaseUrl": "https://api.interakt.ai/v1/public/message/",
    "LanguageCode": "en",
    "DefaultCountryCode": "+91",
    "Templates": { "OrderConfirmation": "order_confirmation" }
  },
  "SalesOrder": {
    "SellerName": "...",
    "SellerAddress": "...",
    "SellerPhone": "..."
  }
}
```

**`PublicBaseUrl` matters.** Interakt does not accept a file upload — it fetches media from a
URL you give it. The Sales Order PDF is therefore served from this backend's `/uploads`, and
`PublicBaseUrl` must be the internet-facing origin. Left as `localhost`, the order confirms
and the PDF generates, but Interakt cannot retrieve it and the message fails.

Generated PDFs carry a GUID in the filename (`uploads/orders/{leadId}/SO-…-{guid}.pdf`)
because `/uploads` is served without authentication — a predictable name would make every
customer's order document enumerable.

If `Interakt:ApiKey` or the template name is blank, sends are **skipped** and logged rather
than failing: the app is fully usable without WhatsApp configured.

`appsettings.json` is gitignored because it holds live credentials. Copy
`appsettings.example.json` and fill it in locally.

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
│       │   └── RolesController.cs
│       ├── Services/
│       │   ├── ExtractionService.cs     Card + voice extraction pipeline
│       │   ├── LeadService.cs           Lead CRUD, JSON column parsing
│       │   ├── OpenAIService.cs         GPT-4o-mini card OCR + voice analysis
│       │   ├── WhisperSpeechService.cs  Whisper voice transcription
│       │   ├── AuthService.cs           Password hashing + login
│       │   └── RoleService.cs           Role + permission management
│       ├── Models/                      POCO models
│       ├── DTOs/                        Request/Response records
│       ├── Data/                        Dapper connection factory
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
- Click a lead → view full details, edit, share, save contact, WhatsApp

### Place an Order
1. Open the lead → **Orders** card → **Place Order**
2. Add one row per item: type (Suit / Lehenga / Saree), barcode, size, colour, pieces, rate, customization
3. The running total, advance and coupon count update live — including the lead's existing orders
4. **Create Order** saves it as a *draft*
5. On the order page, **Confirm & Send Sales Order** →
   marks it confirmed, renders the Sales Order PDF, and sends the WhatsApp confirmation with the PDF attached

Confirmation is resilient: if PDF generation or the WhatsApp send fails, the order still confirms
and the failure is reported separately, so a messaging outage never blocks taking an order at the counter.

## Product Master

The catalogue behind every barcode. Scanning a code — at the counter or on a
customer's phone — resolves it to a garment and fills in the rest.

| Type | Category | Size |
|---|---|---|
| Saree | — | — |
| Suit / Lehenga · Readymade | Readymade | required |
| Suit / Lehenga · Stitched | Stitched | — (made to measure) |

A **barcode identifies a design, not a physical piece**, so several garments share
one and scanning the same code twice is legitimate. There is still no stock
tracking — this is a catalogue, not an inventory.

The shape rules above are enforced by `CK_Products_Shape` in the database, not
only in the form, so a bad row cannot be written even by a caller that bypasses
the UI. Barcode uniqueness is filtered on `IsActive`, so a retired design's code
can be reissued. Deleting a product is a **soft delete** — order history points at
products and must survive.

### Order lines snapshot the product

An order line stores `ProductId` *and* a copy of the barcode, category, size,
colour, fabric and rate as they were when the order was placed. The pointer is
for traceability; the snapshot is what protects history. Without it, editing a
product's price would silently rewrite the value of every past order and every
Sales Order PDF already sent to a customer.

When a line carries a `ProductId` the server **re-reads the catalogue** and prices
from it, rather than trusting figures sent by the client. That is what lets the
public ordering page add items without ever being able to name its own price.

## Self-Service Ordering (QR)

At a busy booth the CRR becomes the bottleneck. A visitor can instead scan a QR
at the stall, open a public page on their own phone, and enter their own order.

```
QR  →  /o/{token}  →  mobile  →  WhatsApp OTP  →  identify  →  items  →  pending order
```

1. **QR per exhibition.** Enable self-service on an exhibition to mint an opaque
   `PublicToken`; the QR encodes `/o/{token}`. The token is random rather than the
   exhibition id, so a visitor cannot reach another exhibition by editing the URL.
   It can be rotated if a printed batch leaks.
2. **Mobile + OTP.** The visitor enters their number and Interakt sends a 6-digit
   code over WhatsApp. **Nothing about a lead is returned until that code is
   verified** — see below.
3. **Identify or self-register.** A verified number matches an existing lead
   (newest wins, since phone numbers are not unique in this schema) and greets them
   by name. An unknown number self-registers with just a name, which makes the QR a
   lead-capture channel as well as an order channel.
4. **Items.** Item type, barcode, size, colour, pieces, customization. Barcodes are
   scanned with the phone camera where the browser supports it, typed otherwise.
5. **Pending order.** The submission becomes a `draft` flagged `Source = 'self_service'`.

### Why the OTP is not optional

The page is public: no login, no employee header. A mobile number is a *claim*, not
a credential, and phone numbers are guessable. Without verification, anyone who
scans the QR could type numbers and read back names, companies, emails and order
history — the customer list, one number at a time. The OTP makes the visitor prove
the number is theirs before any lead data is returned, and the endpoint's response
is identical whether or not the number is on file, so it cannot be used to test
which numbers are customers.

Supporting limits, all server-side: codes stored hashed with a per-row salt, 5-minute
expiry, 5 attempts per code, 60-second resend cooldown, 5 sends per number per hour,
and a 30 requests/minute per-IP cap on the whole public surface.

### What the customer cannot do

Set their own price, advance, or coupon count. Self-service captures *what they want*;
a CRR confirms the order and records what was actually collected, which is what drives
the advance and coupons. That keeps the money path under staff control and gives the
counter a review checkpoint before an order becomes real.

## Advance & Coupons

**Coupons follow the advance actually taken, not the order value.** A lead may hold ₹2.5 L of
orders and pay only ₹11,000 — that earns 4 coupons, not 8.

```
coupons = 4 × floor(totalAdvance ÷ ₹11,000)
```

The order-value **slab only suggests** an advance, which the operator then edits on the
payment step:

| Order value slab | Suggested advance | Coupons if paid in full |
|---|---|---|
| Below ₹1 L | none — entered by hand | depends on what is paid |
| ₹1 L – ₹2 L | ₹11,000 | 4 |
| ₹2 L – ₹3 L | ₹22,000 | 8 |
| ₹3 L – ₹4 L | ₹33,000 | 12 |
| ₹4 L – ₹5 L | ₹44,000 | 16 |

The pattern continues without a ceiling, and exact multiples fall in the **upper** slab
(₹2,00,000 → slab 2). Because coupons key off the advance rather than the slab, a sub-₹1 L
customer who pays ₹11,000 still earns 4.

**Advance accumulates across the lead's orders** before the coupon calculation, so two
part-payments of ₹6,000 together earn 4 coupons rather than nothing each.

An advance larger than the order value is treated as a data-entry error: the balance floors
at zero, coupons still follow the advance, and the position is flagged as overpaid rather
than silently corrected.

Coupons are lucky-draw entries (prize: iPhone). They are shown in the app but **never appear
on the Sales Order PDF**, which is the customer's commercial record.

The rule lives in one place — [`AdvanceCalculator.cs`](backend-dotnet/ELCS.API/Services/AdvanceCalculator.cs).
Advance is stored per order (`Orders.AdvanceAmount`); coupons are always derived.

## Permissions

| Key | Description |
|---|---|
| `scan_cards` | Access card scanner and voice notes |
| `view_leads` | View lead list and detail |
| `view_dashboard` | View analytics dashboard |
| `view_exhibitions` | View exhibitions list |
| `manage_exhibitions` | Create, edit, delete exhibitions |
| `view_report` | View reports page |
| `manage_orders` | Place and confirm orders |
| `manage_users` | Create, edit, delete users |
| `manage_roles` | Create, edit, delete roles |

Users with no role assigned (`role_id = NULL`) have full access.

> **Permissions are enforced in the browser only.** `hasPermission()` and `usePermissionGuard`
> gate the UI, but no API endpoint checks a permission key server-side — a user with a
> restricted role can still call any endpoint directly. Treat these as UI affordances, not
> as an access-control boundary.

## API Endpoints

### Authentication
```
POST /api/auth/login                 Body: { email, password }
GET  /api/auth/profile/{id}
PUT  /api/auth/profile/{id}
```

Profile read/update is restricted to the profile's owner (matched on the `X-Employee-Id` header).

### Card Extraction
```
POST /api/extraction/card/preview    Extract without creating lead (returns temp_id)
POST /api/extraction/card/confirm    Confirm + save lead (moves temp images)
POST /api/extraction/card            Direct extract + save (legacy)
```

### Lead media & WhatsApp
```
GET    /api/leads/{id}/media              Card images, team photos, testimonial
GET    /api/leads/{id}/photos
POST   /api/leads/{id}/photos             Upload a team photo (multipart)
POST   /api/leads/{id}/photos/link        Attach a Drive link instead
DELETE /api/leads/photos/{photoId}
PUT    /api/leads/{id}/testimonial        Body: { url }  — Drive link, or null to clear
POST   /api/leads/{id}/whatsapp/welcome       Touchpoint #1
POST   /api/leads/{id}/whatsapp/testimonial   Touchpoint #3
```

### Settings
```
GET /api/settings     Interakt template names + social links
PUT /api/settings     Body: { key: value } — unknown keys are ignored
```

### Leads
```
GET    /api/leads                    ?exhibition_id, source_code, status_code, assigned_employee_id, service, limit, offset
GET    /api/leads/{id}
POST   /api/leads
PUT    /api/leads/{id}
DELETE /api/leads/{id}
```

### Products
```
GET    /api/products                  ?search, product_type, category, include_inactive
GET    /api/products/rules            Type/category/size matrix, so the UI need not hard-code it
GET    /api/products/barcode/{code}   Barcode lookup — the counter's fast path
GET    /api/products/{id}
POST   /api/products
PUT    /api/products/{id}
DELETE /api/products/{id}             Soft delete
POST   /api/products/{id}/image       JPG / PNG / WebP, 10 MB max
```

### Public — self-service ordering (no auth)
```
GET  /api/public/exhibition/{token}   Resolve the QR token
POST /api/public/otp/request          Body: { token, mobile }        → sends WhatsApp code
POST /api/public/otp/verify           Body: { token, mobile, code }  → session + known lead
GET  /api/public/product/{barcode}    Resolve a scanned code (X-Public-Session required)
POST /api/public/lead                 Self-register        (X-Public-Session required)
POST /api/public/order                Submit pending order (X-Public-Session required)

POST /api/exhibitions/{id}/self-service   Body: { enabled, rotate_token }  → mints the QR token
```

### Orders
```
GET    /api/orders/item-types                    Suit / Lehenga / Saree
GET    /api/orders/lead/{leadId}                 Orders + advance/coupon summary for a lead
GET    /api/orders/lead/{leadId}/summary         Advance/coupon position only
PUT    /api/orders/lead/{leadId}/manual-advance  Operator advance (used below ₹1L)
GET    /api/orders/{id}
POST   /api/orders
PUT    /api/orders/{id}
DELETE /api/orders/{id}
POST   /api/orders/{id}/confirm                  Confirm + render SO PDF + send WhatsApp
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
- Passwords hashed with SHA-256 (unsalted)
- SQL injection protected by Dapper parameterization
- 20 MB limit on card images, 50 MB on audio
- OpenAI API key kept server-side only

> **Known weaknesses.** The `X-Employee-Id` header is unsigned and unverified, so any
> employee id can be supplied by hand to act as that user. Uploaded card images under
> `/uploads` are served with no auth check and sequential ids, so they are publicly
> enumerable. Permission keys are not enforced server-side (see [Permissions](#permissions)).
> These predate the single-tenant change and are unaddressed.

## Common Issues

| Issue | Fix |
|---|---|
| Card extraction fails | Check `OpenAI:ApiKey` in `appsettings.json` |
| Voice transcription fails | Same key — Whisper uses the same OpenAI credentials |
| Images not loading | Ensure `FrontImagePath`/`BackImagePath` columns exist (run migration) |
| CORS error | Add your frontend domain to the CORS list in `Program.cs` |
| Database connection failed | Verify connection string and SQL Server service |
| OpenAI rate limit | Check quota at platform.openai.com |

# ELOMS Backend — ASP.NET Core 10 (C#)

Exhibition Lead & Order Management System — REST API.

Single-tenant: one deployment serves one company, and all users share a single lead pool.

For the end-to-end product workflow, see the [root README](../README.md). This file covers the
API surface and the backend's technical decisions.

## Requirements

- .NET 10 SDK
- SQL Server 2019+
- OpenAI API key (GPT-4o-mini, card OCR)
- Interakt account with approved WhatsApp templates (optional — the API runs without it)

## Quick Start

### 1. Configure appsettings.json

Copy `ELCS.API/appsettings.example.json` to `ELCS.API/appsettings.json` and fill it in. It is
gitignored — it holds live credentials and must never be committed.

Full config reference: [root README → Configuration](../README.md#configuration).

### 2. Database

Restore a backup of the previous multi-tenant database under a new name, then run, in order:

| Script | Effect |
|---|---|
| `014_remove_multitenancy_and_crm.sql` | Drops `Companies`, `TenantId`, `IsSuperAdmin`, `CrmLedgerId` |
| `015_add_order_management.sql` | `Orders`, `OrderItems`, `WhatsAppMessages`, order-number sequence |
| `016_order_advance_and_media.sql` | Per-order advance + slab, optional item rate, `LeadPhotos`, testimonial, `AppSettings` |
| `017_self_service_ordering.sql` | Exhibition QR token, `OtpChallenges`, `PublicSessions`, `Orders.Source` |
| `018_product_master.sql` | `Products` + the product link/snapshot on order lines |

> `014` starts with a pre-flight `SELECT` reporting the number of distinct tenants in the restored
> data — run it before the rest. More than one means the script is about to merge those companies
> into one **irreversibly**.

Migrations `001`–`013` are intentionally not kept here; the schema they built comes from the
backup, so `014` expects a restored database rather than an empty one.

### 3. Build and Run

```bash
cd ELCS.API
dotnet restore
dotnet build
dotnet run
```

- API: `http://localhost:5008`
- Swagger: `http://localhost:5008/swagger`
- Health: `http://localhost:5008/health`

> If `dotnet build` fails with a file-lock error, the API is already running. Stop it, or build
> to another output path with `-p:BaseOutputPath=...`.

## Project Structure

```
ELCS.API/
├── Controllers/
│   ├── AuthController.cs           Login, profile get/update
│   ├── ExtractionController.cs     Card OCR (preview / confirm / direct)
│   ├── LeadsController.cs          Lead CRUD
│   ├── LeadMediaController.cs      Team photos, testimonial, WhatsApp #1 and #3
│   ├── OrdersController.cs         Orders, slabs, payment, confirm, coupon holders
│   ├── ProductsController.cs       Product Master + barcode lookup + image upload
│   ├── PublicOrderController.cs    Self-service ordering (PUBLIC, rate-limited)
│   ├── ExhibitionsController.cs    Exhibition CRUD + self-service QR token
│   ├── SettingsController.cs       WhatsApp templates + social links
│   ├── AnalyticsController.cs      Dashboard metrics
│   ├── UsersController.cs
│   └── RolesController.cs
├── Services/
│   ├── AdvanceCalculator.cs        Advance + lucky-draw coupon rules (pure, no I/O)
│   ├── OrderService.cs             Order CRUD, lead totals, numbering, search
│   ├── ProductService.cs           Catalogue + shape validation
│   ├── SalesOrderPdfService.cs     Sales Order PDF (QuestPDF)
│   ├── InteraktWhatsAppService.cs  All four touchpoints + send log
│   ├── OtpService.cs               Hashed codes, expiry, throttling, public sessions
│   ├── LeadMediaService.cs         Team photos (file or link) + testimonial
│   ├── SettingsService.cs          AppSettings key/value
│   ├── ExtractionService.cs        Card pipeline + duplicate detection
│   ├── LeadService.cs              Lead CRUD, JSON column parsing
│   ├── OpenAIService.cs            GPT-4o-mini card OCR
│   ├── AuthService.cs              SHA-256 password hashing + login
│   └── RoleService.cs              Role + permission management
├── Data/
│   └── DbConnection.cs             Dapper SQL connection factory
├── Models/                         POCO models
├── DTOs/                           Request/Response records
├── Utils/                          DateTime converters
├── database/                       SQL migrations 014–018
└── uploads/
    ├── cards/{leadId}/             Visiting card front/back
    ├── leads/{leadId}/photos/      Team photos
    ├── products/{productId}/       Product images
    └── orders/{leadId}/            Sales Order PDFs
```

## API Reference

The complete endpoint list, with parameters, lives in the
[root README → API Reference](../README.md#api-reference). Summary by controller:

| Controller | Route prefix | Purpose |
|---|---|---|
| `AuthController` | `/api/auth` | Login, profile |
| `ExtractionController` | `/api/extraction` | Card OCR: preview, confirm, direct |
| `LeadsController` | `/api/leads` | Lead CRUD |
| `LeadMediaController` | `/api/leads/{id}` | Photos, testimonial, WhatsApp #1/#3 |
| `OrdersController` | `/api/orders` | Orders, slabs, payment, confirm, coupons |
| `ProductsController` | `/api/products` | Catalogue, barcode lookup, images |
| `PublicOrderController` | `/api/public` | Self-service — **no auth**, rate-limited |
| `ExhibitionsController` | `/api/exhibitions` | Exhibitions + QR token |
| `SettingsController` | `/api/settings` | Templates + social links |
| `AnalyticsController` | `/api/analytics` | Dashboard metrics |
| `UsersController` / `RolesController` | `/api/users`, `/api/roles` | Access management |

## Key Technical Details

### JSON Serialization
- `SnakeCaseLower` naming policy — all JSON uses `snake_case`
- DateTimes serialized as UTC with a `Z` suffix; the frontend renders IST

### Authentication
- No JWT — SHA-256 password hash stored in `Employees`
- Login takes email + password only
- The frontend stores `auth_token = emp_{employee_id}` and sends it as the `X-Employee-Id` header
- `AuthController` reads that header to restrict profile read/update to the owner

> The header is unsigned and unverified. Any employee id can be supplied by hand to act as that
> user, so this identifies the caller but does not authenticate them.

### Permissions
Roles hold a JSON array of permission keys. `RoleId = NULL` means full access.

> **Not enforced server-side.** No controller checks a permission key; they gate the frontend UI
> only. Any authenticated caller can reach any endpoint directly.

### Card Extraction Pipeline
1. Front (and optional back) uploaded as `multipart/form-data`
2. Each image is rendered at 4 rotations (0°, 90°, 180°, 270°) with a contrast boost — all four
   are attached to a **single** GPT-4o-mini Vision request, which identifies the readable
   orientation itself
3. Structured JSON extraction returned
4. `preview` writes images to `uploads/cards/temp/{guid}/` — no lead is created yet
5. `confirm` moves them to `uploads/cards/{leadId}/` and creates the lead
6. Duplicate detection runs before save (phone / email / name+company similarity scoring)
7. Lead auto-segmented: `decision_maker`, `influencer`, `researcher`, `general`

### Product Master
Shape rules — enforced by `CK_Products_Shape` in the database, mirrored by `ProductRules` in C#:

```
Saree          → no category, no size
Suit / Lehenga → Stitched (no size) or Readymade (size required)
```

A barcode identifies a **design**, not a physical piece. No stock tracking. Barcode uniqueness is
filtered on `IsActive` so a retired code can be reissued; deletion is a soft delete because order
history points at products.

### Order Management
- `OrderItems.Amount` is **derived server-side** as `Rate × Pieces` — the client's figure is
  ignored. `Orders.OrderTotal` is `SUM(Amount)`, recomputed whenever items change.
- Updating an order **replaces** its whole line set rather than diffing, so the total cannot drift
  from its items.
- Order numbers come from a SQL `SEQUENCE` (`SO-yyyyMM-00001`), not `MAX()+1` — two operators
  saving simultaneously at a counter cannot collide.
- When a line carries a `ProductId` the server re-reads the catalogue, prices from it, and
  **snapshots** barcode/category/size/colour/fabric/rate onto the line. Without the snapshot,
  editing a product's price would rewrite the value of every past order and every PDF already sent.
- Cancelled orders are excluded from every total, so cancelling re-bands the lead automatically.

### Advance & Coupons
See [`AdvanceCalculator.cs`](ELCS.API/Services/AdvanceCalculator.cs).

**Coupons follow the advance actually taken, not the order value.**

```
slab             = floor(orderValue / 100000)      -- suggestion only
suggestedAdvance = 11000 * slab                    -- slab 0 suggests nothing
coupons          = 4 * floor(totalAdvance / 11000)
```

`Orders.AdvanceAmount` is **stored** (operator-editable); coupons are always derived. Advance is
summed across the lead's non-cancelled orders *before* the coupon calculation, so two ₹6,000
part-payments earn 4 coupons together rather than 0 apiece.

An advance exceeding the order value floors the balance at zero and sets `IsOverpaid` — coupons
still follow the advance, because silently reducing an entitlement would hide the data-entry error
rather than surface it.

### Sales Order PDF
QuestPDF, written to `uploads/orders/{leadId}/{orderNumber}-{guid}.pdf`.

- Shows items, size, colour, pieces, customization, rate, amount, advance and balance due
- **Never shows coupons** — the SO is the customer's commercial record; the lucky draw is a
  separate promotion
- Unpriced lines render as a dash, not a misleading ₹0.00
- With more than one order, the totals block distinguishes *this order* from the *total across all
  orders*, since advance and balance are positions on the whole account
- QuestPDF runs under the **Community licence** (set in `Program.cs`), free for organisations under
  USD 1M annual revenue — review <https://www.questpdf.com/license/> before shipping

### WhatsApp (Interakt)
Four templates: welcome, order confirmation, testimonial, OTP.

- Interakt **fetches media by URL**; it accepts no upload. Media URLs are built from
  `PublicBaseUrl` + `/uploads/...`, so that setting must be the internet-facing origin.
- Template names are read from `AppSettings` first, falling back to `appsettings.json`. An
  approved name changes without a code release.
- The **OTP template must be an authentication template** — a separate Meta approval.
- Phone numbers are normalised before sending (`+91…`, leading `0`, bare 10 digits all reduce to
  10 digits + country code); anything unparseable is skipped rather than sent malformed.
- Every attempt is written to `WhatsAppMessages` as `sent` / `failed` / `skipped`. OTP sends are
  excluded: that table is FK-keyed to a lead and an OTP precedes any lead, and `OtpChallenges`
  already records the attempt.
- Missing key or template name → **skipped**, not failed. The API is fully usable without WhatsApp.

### Self-Service Ordering (public endpoints)
`PublicOrderController` has **no authentication**. What protects it:

- No lead data is returned until an OTP sent to that number is verified
- `otp/request` responds identically whether or not the number is on file, so it cannot be used to
  test which numbers are customers
- Codes stored hashed with a per-row salt; 5-minute expiry; 5 attempts, counted *before* the
  comparison so a crash cannot buy a free retry; fixed-time comparison
- 60-second resend cooldown, 5 sends per number per hour
- 30 requests/minute per IP across the whole `public` policy
- Session tokens are 32 random bytes held server-side, 45-minute life
- Exhibition QR tokens are random GUIDs, not the `ExhibitionId`, and are rotatable
- The order endpoint **discards any rate sent to it** — pricing comes from the catalogue
- Phone numbers are masked in logs

### Data Storage
- Lead child records (additional persons, phones, emails, addresses, websites, services, brands,
  topics) are **JSON columns on `Leads`**, not normalized child tables. `LeadService` parses them
  into POCOs on read; those types exist only as parsing targets.
- Real tables: `LeadMessages`, `Orders`, `OrderItems`, `Products`, `LeadPhotos`,
  `WhatsAppMessages`, `OtpChallenges`, `PublicSessions`, `AppSettings`.
- Classification columns on `Leads` — `Category`, `Vertical`, `TurnOver`, `TeamSize` (free text) —
  are inline-editable on Report and Lead Detail. `TurnOver` and `TeamSize` are filtered by parsing
  their leading number into a Min–Max range.
- `Services` is a JSON array column; keyword search uses SQL Server `OPENJSON`.
- Static files are served by `UseStaticFiles` at `/uploads` with **no authorization check** —
  required, since Interakt must fetch media by URL. Generated files use GUID filenames so they are
  not enumerable; visiting-card images still use sequential lead ids and remain guessable.

### Rate Limiting
`AddRateLimiter` with a fixed-window `public` policy, applied via `[EnableRateLimiting("public")]`.
`UseRateLimiter()` sits **after** `UseCors()` so a throttled response still carries CORS headers —
otherwise the browser reports an opaque network error instead of the 429.

### Response Compression
Brotli + Gzip for JSON and static text responses.

## CORS

Allowed origins are listed in `Program.cs`:
`localhost:3000/3001`, `192.168.137.1:3000`, `103.150.136.76:3003`, the Vercel URLs,
`exhibitionvisitingcard.indusanalytics.co.in`, and `ksk-vc.indusanalytics.co.in`.

## Troubleshooting

| Error | Fix |
|-------|-----|
| Card extraction fails | Verify `OpenAI:ApiKey` in `appsettings.json` |
| WhatsApp never sends | Template name blank in `/settings` — sends are skipped; check the logs |
| WhatsApp media error | `PublicBaseUrl` is not internet-reachable, so Interakt cannot fetch the file |
| OTP not delivered | The OTP template must be an **authentication** template in Interakt |
| Barcode does not resolve | Product missing or inactive in Product Master |
| Build fails with a file lock | The API is running; stop it or use `-p:BaseOutputPath=...` |
| Images not loading | Confirm `FrontImagePath`/`BackImagePath` exist and `/uploads` is served |
| CORS error | Add the frontend domain to the CORS list in `Program.cs` |
| Database connection failed | Check the connection string; SQL Server must be running |
| Port conflict | Change `Urls` in `appsettings.json` |

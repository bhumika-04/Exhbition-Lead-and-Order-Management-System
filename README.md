# Exhibition Lead & Order Management System (ELOMS)

Captures visitors at exhibition stalls, turns their visiting card into a structured lead,
takes their garment order, computes the advance and lucky-draw coupons, issues a Sales Order
PDF, and keeps in touch over WhatsApp — including a QR flow that lets busy visitors place
their own order from their phone.

Single-tenant: one deployment serves one company, and every user shares the same lead pool.

## Architecture

| Layer | Technology |
|---|---|
| Backend | ASP.NET Core 10 (C#), Dapper, SQL Server |
| Frontend | Next.js 14 (App Router, React + TypeScript), Tailwind CSS |
| AI — Card OCR | OpenAI GPT-4o-mini (Vision API, 4 rotations in one call) |
| WhatsApp | Interakt (welcome, order confirmation, testimonial, OTP) |
| PDF | QuestPDF (Sales Order) |
| Logging | Serilog |
| Hosting | Backend on AWS EC2, Frontend on Vercel |

---

# The Workflow

The whole system in order. Each stage links to its detailed section below.

```
SETUP        Exhibition  →  Product Master  →  Settings (templates, social links)
                │
                ├── A1. STAFF CAPTURE ─────────────────────────────┐
                │   card scan or manual entry → verify → save      │
                │   → team photo → welcome WhatsApp                │
                │                                                  ▼
                └── A2. SELF-SERVICE ──────────────────────►   LEAD EXISTS
                    QR → mobile → OTP → identify/register          │
                    → items → pending order                        │
                                                                   ▼
                                                        B. ORDER PLACEMENT
                                                        items (barcode → product)
                                                                   │
                                                                   ▼
                                                        C. SLAB + ADVANCE
                                                        coupons follow the advance
                                                                   │
                                                                   ▼
                                                        D. CONFIRMATION
                                                        SO PDF + WhatsApp #2
                                                                   │
                                                                   ▼
                                                        E. POST-SALE
                                                        testimonial + WhatsApp #3
```

## Stage 0 — Setup

Done once per exhibition, then rarely touched.

**Exhibitions** (`/exhibitions`) — create the event with name, location and dates. Every lead
and every order is scoped to one. Selecting an exhibition reveals its **self-service QR panel**
(see [Self-Service Ordering](#self-service-ordering-qr)).

**Product Master** (`/products`) — the garment catalogue behind every barcode. Add each design
with its type, category, size, colour, fabric, price and photo. Scanning a barcode anywhere in
the app resolves against this. See [Product Master](#product-master).

**Settings** (`/settings`) — the four Interakt template names and your social links. Nothing
sends on WhatsApp until the template names are filled in; sends are *skipped and logged*, never
failed, so the app is fully usable before you have them.

## Stage A1 — Staff lead capture

Screen: **Capture** (`/chat`).

The screen is a single manual-entry form. Scanning a visiting card is an *accelerator that
pre-fills it*, not a separate mode — so a failed or skipped extraction degrades into ordinary
manual entry rather than dead-ending, and the operator always looks at the same layout.

1. **Pick the exhibition** — sticks as a chip; it is not re-asked.
2. **Upload Visiting Card** (optional) — take a photo or upload. Front first; back is an
   optional second slot.
3. **Extraction** — the form fields shimmer, then populate. Fields the model was unsure about
   get an **amber left rule** so your eye lands on the two risky values instead of re-reading
   all fifteen.
4. **Verify and correct.** Name, designation, company; phones and emails as add/remove chips;
   address, city, state; websites; services / products. All optional — the only requirement is a
   name or a company, so a rushed counter capture is never blocked. Category / Vertical /
   Turn-over / Team-size are collapsed by default, being rarely known at a counter.
5. **Duplicates.** If the card matches existing leads, a banner lists them with match scores and
   links. It is a warning to overrule, not a blocker.
6. **"Lead has a photo with the team"** — ticking this expands an inline capture block and
   **holds Save until a photo is supplied**; it is a promise the operator made. Leaving it
   unticked saves immediately and the photo can be added later from the lead page.
7. **Save Lead** → the lead is created, the team photo uploads to it, then the **welcome
   WhatsApp** fires (so it can carry the photo). You land on the lead's detail page.

If the photo upload fails the lead still stands and the photo is addable from the lead page —
the same recovery path as leaving the box unticked.

## Stage A2 — Self-service capture

The visitor does A1 themselves from their own phone. Fully covered in
[Self-Service Ordering](#self-service-ordering-qr).

## Stage B — Order placement

Screen: **Lead detail** (`/leads/{id}`) → **Create Order** → `/leads/{id}/orders/new`.

A lead may place **any number of orders**; the money is always computed across all of them.

Per item: **type** (Saree / Suit / Lehenga), **barcode**, size, colour, pieces, customization,
and an optional rate. Scanning or typing a barcode resolves it against Product Master and fills
in the type, size, colour and price — the rate stays editable for counter discounts.

*Add another item* repeats the block. **Continue to payment** saves the order as a **draft** and
takes you to the order page for stage C.

Rate is optional throughout: an unpriced line is legitimate, because the order value can come
from the slab chosen next. Unpriced lines render as a dash on the Sales Order, never as ₹0.00.

## Stage C — Slab, advance and coupons

Screen: **Order detail** (`/orders/{id}`).

1. **Choose the order-value slab.** Picking one pre-fills the suggested advance (₹11,000 × slab).
2. **Edit the advance** to what was actually collected. The coupon count updates live as you type.
3. **Save payment details.**

The rule, in one line: **coupons follow the advance actually taken, not the order value.** Full
detail in [Advance & Coupons](#advance--coupons).

## Stage D — Confirmation

Same screen. **Confirm & Send Sales Order** does three things:

1. Marks the order **confirmed**.
2. Renders the **Sales Order PDF** — items with size, colour, pieces, customization, advance and
   balance due. It deliberately **omits coupons**: the SO is the customer's commercial record,
   the lucky draw is a promotion.
3. Sends **WhatsApp #2** with the PDF attached.

Confirmation is deliberately resilient: **PDF or WhatsApp failure does not roll back the
confirmation.** Each outcome is reported separately, so a messaging outage never blocks taking an
order at a counter. Save is blocked while payment details are unsaved, so an order cannot be
confirmed against a stale advance.

## Stage E — Post-sale

Screen: **Lead detail** → **Testimonial**.

Paste the Drive link to the testimonial video, then **Testimonial** under WhatsApp sends
touchpoint #3 with a custom message.

---

# Screens

| Route | Purpose |
|---|---|
| `/chat` | **Capture** — the manual-entry form with card-scan prefill |
| `/leads` | Lead list with filters |
| `/leads/{id}` | Lead detail — edit, media, actions, orders |
| `/leads/{id}/orders/new` | Place order, step 1 (items) |
| `/orders` | **Orders** — KPIs, filters, barcode search, lucky draw |
| `/orders/{id}` | Order detail — step 2 (slab + advance), confirm, PDF |
| `/products` | **Product Master** |
| `/exhibitions` | Exhibition CRUD + self-service QR |
| `/dashboard` | Analytics |
| `/report` | Reports with inline-editable classification |
| `/users`, `/roles` | User and role management |
| `/settings` | Interakt templates + social links |
| `/profile` | Own profile |
| `/o/{token}` | **Public** self-service ordering (no login) |

## Lead detail

Everything about one lead, plus three primary actions:

| Action | Behaviour |
|---|---|
| **Create Order** | → the order form |
| **Team Photo** | Click, upload, or paste a Drive link. One or many per lead. |
| **Testimonial** | Drive link; enables the testimonial WhatsApp send |

A **media strip** shows card images, team photos and the testimonial together — the only place
all four kinds of media appear at once. Below it, the **Orders card** lists the lead's orders
with their combined value, advance received, balance and coupon count.

## Orders page

**KPI row** — order count, total value, advance received, coupons issued. All computed over the
whole filter, not just the visible page.

**Filters** — exhibition, status (draft / confirmed / cancelled), and one search box covering
order number, customer name **and barcode across line items**. Barcode search is the point: the
ERP holds the catalogue and the cross-check is manual, so *"which order has SU-8842"* has to be
answerable here.

**Lucky draw tab** — leads ranked by coupons with a relative bar, for draw day. Coupons are
summed **per lead, never per order**: two ₹6,000 advances earn 4 coupons together and 0 apiece,
so adding per-order figures would over-count.

Self-service orders arrive as drafts and appear at the top of the count as *awaiting confirmation*.

---

# Product Master

The catalogue behind every barcode. Scanning a code — at the counter or on a customer's phone —
resolves it to a garment and fills in the rest.

| Type | Category | Size |
|---|---|---|
| Saree | — | — |
| Suit / Lehenga · Readymade | Readymade | required |
| Suit / Lehenga · Stitched | Stitched | — (made to measure) |

A **barcode identifies a design, not a physical piece**, so several garments share one and
scanning the same code twice is legitimate. There is no stock tracking — this is a catalogue,
not an inventory.

### Sizes and colours are lists

A design is stocked in several sizes and colours, so both fields are **comma separated**:

```
Size    38, 40, 42
Colour  Navy, Black, Maroon
```

The form shows the parsed values as chips while you type — `38,40 ,42` and `38, 40, 42` store
identically, and seeing how the text actually parses is the only way to catch a stray comma
before it becomes a phantom size on the order screen. Values are canonicalised on save, so the
same design entered twice cannot produce two different strings.

**Scanning that barcode on the order page offers exactly those options** — not every value in
the catalogue. The operator picks what the customer wants from what the design can actually be
supplied in. A design with only one size or colour has it preselected, since there is no
decision to make; one with several leaves it unset, because guessing would silently order the
wrong size.

Items added without a barcode fall back to every distinct value in the catalogue
(`GET /api/products/options`), and anything can be typed in either case.

The shape rules are enforced by `CK_Products_Shape` **in the database**, not only in the form, so
a bad row cannot be written even by a caller that bypasses the UI. The form mirrors them: pick
Saree and category/size disappear; pick Stitched and size disappears with a made-to-measure note.

Barcode uniqueness is filtered on `IsActive`, so a retired design's code can be reissued.
Deleting a product is a **soft delete** — order history points at products and must survive.

### Order lines snapshot the product

An order line stores `ProductId` **and** a copy of the barcode, category, size, colour, fabric and
rate as they were when the order was placed. The pointer is for traceability; the snapshot is what
protects history. Without it, editing a product's price would silently rewrite the value of every
past order and every Sales Order PDF already sent to a customer.

When a line carries a `ProductId` the server **re-reads the catalogue** and prices from it rather
than trusting figures sent by the client. That is what lets the public ordering page add items
without ever being able to name its own price.

---

# Advance & Coupons

**Coupons follow the advance actually taken, not the order value.** A lead may hold ₹2.5 L of
orders and pay only ₹11,000 — that earns 4 coupons, not 8.

```
coupons = 4 × floor(totalAdvance ÷ ₹11,000)
```

The order-value **slab only suggests** an advance, which the operator then edits:

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
part-payments of ₹6,000 together earn 4 coupons rather than nothing each. Cancelling an order
withdraws both its value and its advance, re-banding the lead automatically.

An advance larger than the order value is treated as a data-entry error: the balance floors at
zero, coupons still follow the advance, and the position is flagged **overpaid** rather than
silently corrected — hiding a typo is worse than showing it.

Coupons are lucky-draw entries (prize: iPhone). They are shown throughout the app but **never
appear on the Sales Order PDF**.

The rule lives in exactly one place —
[`AdvanceCalculator.cs`](backend-dotnet/ELCS.API/Services/AdvanceCalculator.cs). `Orders.AdvanceAmount`
is stored (it is a recorded fact, editable); coupons are always derived, so they cannot go stale.

---

# Self-Service Ordering (QR)

At a busy booth the CRR becomes the bottleneck. A visitor instead scans a QR at the stall, opens
a public page on their own phone, and enters their own order.

```
QR  →  /o/{token}  →  mobile  →  WhatsApp OTP  →  identify  →  items  →  pending order
```

### Generating the QR

**Exhibitions page → select the exhibition → Enable.** That mints the token and renders the QR
on the card, with:

- **Print for the stall** — a clean standalone sheet with the code and the four steps a visitor
  follows, rather than printing the admin page around it
- **Copy link / open** — for testing on your own phone
- **New link** — rotates the token behind a confirm, since that kills every QR already printed

The QR is rendered client-side, so it works with no internet at the stall and depends on no
external QR service. It encodes the **frontend** origin, not the API origin. One QR per
exhibition, so self-service orders land in the right event.

### The visitor's flow

1. **Mobile number.** Interakt sends a 6-digit code over WhatsApp.
2. **Verify.** Only now does any lead data come back.
3. **Identify or self-register.** A verified number matches an existing lead (newest wins, since
   phone numbers are not unique in this schema) and greets them by name. An unknown number
   self-registers with just a name — which makes the QR a lead-capture channel as well as an
   order channel, important because the walk-in crowd causing the queue mostly has not handed
   over a card. Self-registered leads get the welcome WhatsApp immediately.
4. **Items.** Scanning a tag resolves the product and shows the **garment — photo, fabric, colour,
   price** — so the customer confirms a picture rather than a code. Unknown codes are surfaced,
   not silently accepted.
5. **Submit.** The order becomes a `draft` flagged `Source = 'self_service'` for a CRR to price
   and collect against.

### Why the OTP is not optional

The page is public: no login, no employee header. A mobile number is a *claim*, not a credential,
and phone numbers are guessable. Without verification, anyone who scans the QR could type numbers
and read back names, companies, emails and order history — the customer list, one number at a
time.

The OTP makes the visitor prove the number is theirs before any lead data is returned, and the
request endpoint's response is **identical whether or not the number is on file**, so it cannot
be used to test which numbers are customers.

Supporting limits, all server-side:

| Control | Value |
|---|---|
| Code storage | SHA-256 with a per-row salt — never plaintext |
| Expiry | 5 minutes |
| Attempts per code | 5, counted *before* the comparison so a crash cannot buy a free retry |
| Comparison | Fixed-time |
| Resend cooldown | 60 seconds |
| Sends per number | 5 per hour |
| Public surface | 30 requests/minute per IP |
| Session token | 32 random bytes, held server-side, 45-minute life |

### What the customer cannot do

Set their own price, advance, or coupon count. The public order endpoint **discards any rate sent
to it**. Self-service captures *what they want*; a CRR confirms and records what was actually
collected. That keeps the money path under staff control and gives the counter a review checkpoint
before an order becomes real.

### Browser support

Camera barcode scanning works on **every** browser, via two decoders chosen at runtime:

1. The native `BarcodeDetector` where it exists (Chrome/Edge, Android and desktop) — fast,
   hardware-accelerated, nothing to download.
2. **ZXing**, lazily imported only when the native API is absent — Safari, Firefox, older
   Chrome. It is a few hundred KB, so it is code-split into its own chunk and never lands in
   the main bundle for the majority who never need it.

A USB scanner at the counter simply types into the same field, so one component covers all
three ways a barcode gets entered. Typing is always available as a fallback.

---

# WhatsApp touchpoints

All four go through Interakt, which **fetches media by URL** — it accepts no upload. That is why
`PublicBaseUrl` must be the internet-facing origin and why generated files live under the public
`/uploads`.

| # | Trigger | Carries |
|---|---|---|
| 1 | **Welcome** — lead created (auto) | Team photo + social links |
| 2 | **Order confirmation** — order confirmed | Sales Order PDF |
| 3 | **Testimonial** — manual, from the lead page | Testimonial link |
| — | **OTP** — self-service verification | The code |

Template names live in **Settings**, not `appsettings.json`, because an approved name changes
without a code release. Settings wins; config is the fallback for a fresh install.

The **OTP template must be an authentication template** in Interakt — a separate Meta approval
from the three marketing templates.

Every send attempt is written to `WhatsAppMessages` with status `sent` / `failed` / `skipped`, so
a failure is visible rather than silently lost. OTP sends are the exception: that table is
FK-keyed to a lead and an OTP precedes any lead, and `OtpChallenges` already records the attempt.

Phone numbers are normalised before sending — the app stores them inconsistently (`+91…`, leading
`0`, bare 10 digits) — and anything unparseable is skipped rather than sent to a malformed number.

---

# Setup

### Prerequisites

- .NET 10 SDK
- Node.js 18+
- SQL Server 2019+
- OpenAI API key
- Interakt account with approved templates (optional — the app runs without it)

### 1. Database

Provisioned by **restoring a backup of the previous multi-tenant database**, then running the
migrations against the restored copy, in order:

| Script | Effect |
|---|---|
| `014_remove_multitenancy_and_crm.sql` | Drops `Companies`, `TenantId`, `IsSuperAdmin`, `CrmLedgerId` |
| `015_add_order_management.sql` | `Orders`, `OrderItems`, `WhatsAppMessages`, order-number sequence |
| `016_order_advance_and_media.sql` | Per-order advance + slab, optional rate, `LeadPhotos`, testimonial, `AppSettings` |
| `017_self_service_ordering.sql` | Exhibition QR token, `OtpChallenges`, `PublicSessions`, order source |
| `018_product_master.sql` | `Products` + the product link/snapshot on order lines |
| `019_ensure_missing_objects.sql` | Repairs a **copied** schema — sequences and filtered indexes that SSMS Generate Scripts drops |
| `020_seed_first_user.sql` | First login for an empty database (edit the credentials at the top) |
| `021_order_item_multi_values.sql` | Widens `OrderItems.Size`/`Colour` for comma-separated lists |
| `022_product_multi_values.sql` | Widens `Products.Size`/`Colour` for comma-separated lists |

> `019` matters if the database was built by copying a schema rather than running these
> scripts. Tables, constraints and foreign keys copy across; **sequences and filtered indexes
> do not** — and a missing `OrderNumberSequence` only surfaces when the first order fails.

> **Run the pre-flight `SELECT` at the top of `014` first.** It reports how many distinct tenants
> the restored data holds. If more than one, the script merges those companies' leads into a
> single pool and the split **cannot be recovered**. Take a full backup before any of this.

Migrations `001`–`013` are intentionally not kept here — the schema they built comes from the
backup, so `014` expects a restored database rather than an empty one.

`017` also notes the housekeeping deletes for expired OTP challenges and public sessions; neither
is business data.

### 2. Backend

```bash
cd backend-dotnet/ELCS.API
# Copy appsettings.example.json → appsettings.json and fill in values
dotnet restore
dotnet run
```

Backend: `http://localhost:5008` · Swagger: `http://localhost:5008/swagger` · Health: `/health`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:3000`

> **Do not run `npm run build` while `next dev` is running.** Both write to `.next/`, and the
> production build corrupts the dev server's module manifest — it then fails with
> `TypeError: __webpack_modules__[moduleId] is not a function`, which looks like a code bug but
> is not. Typecheck with `node node_modules/typescript/bin/tsc --noEmit` instead; it never touches
> `.next/`. To recover: delete `.next/` and restart.

---

# Configuration

### `appsettings.json` (gitignored — holds live credentials)

```json
{
  "Urls": "http://localhost:5008",
  "ConnectionStrings": {
    "DefaultConnection": "Server=...;Database=ELOMS;..."
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
    "Templates": {
      "Welcome": "welcome",
      "OrderConfirmation": "order_confirmation",
      "Testimonial": "testimonial",
      "Otp": "otp"
    }
  },
  "SalesOrder": {
    "SellerName": "...",
    "SellerAddress": "...",
    "SellerPhone": "..."
  }
}
```

**`PublicBaseUrl` matters.** Interakt fetches media from a URL you give it. The Sales Order PDF
and team photos are served from this backend's `/uploads`, so this must be the internet-facing
origin. Left as `localhost`, the order confirms and the PDF generates, but Interakt cannot
retrieve it and the message fails.

### Uploads layout

Everything belonging to a lead lives under one folder, so a lead's media can be found,
archived or deleted in one place:

```
uploads/
  leads/{leadId}/
    card/     front.jpg, back.jpg        visiting card
    team/     {guid}.jpg                 photos with the team
    orders/   {orderNo}-{guid}.pdf       sales orders
  products/{productId}/{guid}.jpg
  temp/cards/{tempId}/                   scanned, not yet confirmed
```

The layout is defined once in
[`UploadPaths.cs`](backend-dotnet/ELCS.API/Utils/UploadPaths.cs) rather than spelled out in
each service, so it cannot drift apart again.

Stored paths are **relative** to the uploads root. An absolute path breaks the moment the app
moves machine or directory — `UploadPaths.ToRelative` still tolerates the older absolute
values, and migration `023` rewrites them.

Generated files carry a **GUID in the filename** because `/uploads` is served without
authentication — a predictable name would make every customer's document enumerable.
Testimonials are Drive links, so nothing is stored for them.

### Runtime settings (`/settings`)

Template names and social links live in the database so an approved template name can change
without a deploy. Blank template name = that message is skipped, not failed.

### `frontend/.env.local`

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.com
```

---

# Permissions

| Key | Grants |
|---|---|
| `scan_cards` | The Capture screen |
| `view_leads` | Lead list and detail |
| `view_dashboard` | Analytics dashboard |
| `view_exhibitions` | Exhibitions list |
| `manage_exhibitions` | Create/edit/delete exhibitions, enable self-service QR |
| `view_report` | Reports page |
| `manage_orders` | Place and confirm orders; the Orders page |
| `manage_products` | Product Master |
| `manage_users` | Create/edit/delete users |
| `manage_roles` | Create/edit/delete roles |
| `manage_settings` | WhatsApp templates and social links |

Users with no role (`role_id = NULL`) have full access.

> **Permissions are enforced in the browser only.** `hasPermission()` and `usePermissionGuard`
> gate the UI, but no API endpoint checks a permission key server-side — a user with a restricted
> role can still call any endpoint directly. Treat these as UI affordances, not as an
> access-control boundary.

---

# API Reference

### Authentication
```
POST /api/auth/login                 Body: { email, password }
GET  /api/auth/profile/{id}
PUT  /api/auth/profile/{id}
```
Profile read/update is restricted to the profile's owner (matched on `X-Employee-Id`).

### Leads
```
GET    /api/leads            ?exhibition_id, source_code, status_code, assigned_employee_id, service, limit, offset
GET    /api/leads/{id}
POST   /api/leads
PUT    /api/leads/{id}
DELETE /api/leads/{id}
```

### Card extraction
```
POST /api/extraction/card/preview    Extract without creating a lead (returns temp_id)
POST /api/extraction/card/confirm    Confirm + save (moves temp images into place)
POST /api/extraction/card            Direct extract + save (legacy single-step)
```

### Lead media & WhatsApp
```
GET    /api/leads/{id}/media                  Card images, team photos, testimonial
GET    /api/leads/{id}/photos
POST   /api/leads/{id}/photos                 Upload a team photo (multipart, 20 MB)
POST   /api/leads/{id}/photos/link            Attach a Drive link instead
DELETE /api/leads/photos/{photoId}
PUT    /api/leads/{id}/testimonial            Body: { url } — Drive link, or null to clear
POST   /api/leads/{id}/whatsapp/welcome       Touchpoint #1
POST   /api/leads/{id}/whatsapp/testimonial   Touchpoint #3
```

### Products
```
GET    /api/products                  ?search, product_type, category, include_inactive, limit, offset
GET    /api/products/rules            Type/category/size matrix, so the UI need not hard-code it
GET    /api/products/barcode/{code}   Barcode lookup — the counter's fast path
GET    /api/products/{id}
POST   /api/products
PUT    /api/products/{id}
DELETE /api/products/{id}             Soft delete
POST   /api/products/{id}/image       JPG / PNG / WebP, 10 MB max
```

### Orders
```
GET    /api/orders                        ?exhibition_id, status_code, search, from_date, to_date, limit, offset
                                           search covers order no., customer, and BARCODE across line items
GET    /api/orders/item-types             Saree / Suit / Lehenga
GET    /api/orders/slabs                  ?count — slab options with suggested advance
GET    /api/orders/coupons                ?exhibition_id — leads ranked by lucky-draw entries
GET    /api/orders/lead/{leadId}          A lead's orders + their money position
GET    /api/orders/lead/{leadId}/summary  Money position only
GET    /api/orders/{id}
POST   /api/orders                        Body: { lead_id, items[], notes }
PUT    /api/orders/{id}                   Replaces all line items
PUT    /api/orders/{id}/payment           Body: { slab_band, order_value, advance_amount }
DELETE /api/orders/{id}
POST   /api/orders/{id}/confirm           Confirm + render SO PDF + send WhatsApp #2
```

### Exhibitions
```
GET    /api/exhibitions
GET    /api/exhibitions/{id}
POST   /api/exhibitions
PUT    /api/exhibitions/{id}
DELETE /api/exhibitions/{id}
POST   /api/exhibitions/{id}/self-service   Body: { enabled, rotate_token } → mints the QR token
```

### Public — self-service ordering (no auth, rate-limited)
```
GET  /api/public/exhibition/{token}   Resolve the QR token
POST /api/public/otp/request          Body: { token, mobile }       → sends the WhatsApp code
POST /api/public/otp/verify           Body: { token, mobile, code } → session token + known lead
GET  /api/public/product/{barcode}    Resolve a scanned code   (X-Public-Session required)
POST /api/public/lead                 Self-register            (X-Public-Session required)
POST /api/public/order                Submit a pending order   (X-Public-Session required)
```

### Settings
```
GET /api/settings     Template names + social links
PUT /api/settings     Body: { key: value } — unknown keys are ignored
```

### Analytics
```
GET /api/analytics/summary               ?exhibition_id
GET /api/analytics/employee-performance  ?exhibition_id
GET /api/analytics/exhibitions
```

### Users & Roles
```
GET/POST/PUT/DELETE /api/users            + POST /api/users/{id}/reset-password
GET/POST/PUT/DELETE /api/roles
```

### Static files & health
```
GET /uploads/leads/{leadId}/card/front.jpg
GET /uploads/leads/{leadId}/card/back.jpg
GET /uploads/leads/{leadId}/team/{guid}.jpg
GET /uploads/leads/{leadId}/orders/{orderNo}-{guid}.pdf
GET /uploads/products/{productId}/{guid}.jpg
GET /health
```

---

# Data model notes

**Lead child records are JSON columns on `Leads`**, not normalized child tables — additional
persons, phones, emails, addresses, websites, services, brands and topics. `LeadService` parses
them into the `LeadPhone` / `LeadAddress` / … POCOs on read; those types exist only as parsing
targets. `LeadMessages`, `Orders`, `OrderItems`, `Products`, `LeadPhotos`, `WhatsAppMessages`,
`OtpChallenges`, `PublicSessions` and `AppSettings` are real tables.

**Order totals are always server-derived.** `OrderItems.Amount` is `Rate × Pieces` computed
server-side — the client's figure is ignored. `Orders.OrderTotal` is `SUM(Amount)`, recomputed
whenever items change, and updating an order **replaces** its whole line set rather than diffing,
so the total cannot drift from its items.

**Order numbers come from a SQL `SEQUENCE`** (`SO-yyyyMM-00001`), not `MAX()+1` — two operators
saving simultaneously at a counter cannot collide.

**JSON is snake_case.** The API serializes with `SnakeCaseLower`, so C# `PrimaryVisitorName`
arrives as `primary_visitor_name`. Dates go out as UTC with a `Z`; the frontend renders IST.

**Card extraction sends four rotations in one call.** Each image is rendered at 0°, 90°, 180° and
270° with a contrast boost (for embossed cards) and all four are attached to a *single* GPT-4o-mini
request, which identifies the readable orientation itself. One call, four images of cost.

---

# Project structure

```
ELOMS/
├── backend-dotnet/ELCS.API/
│   ├── Controllers/
│   │   ├── AuthController.cs           Login, profile
│   │   ├── ExtractionController.cs     Card OCR
│   │   ├── LeadsController.cs          Lead CRUD
│   │   ├── LeadMediaController.cs      Team photos, testimonial, WhatsApp #1/#3
│   │   ├── OrdersController.cs         Orders, slabs, payment, confirm, coupons
│   │   ├── ProductsController.cs       Product Master + barcode lookup
│   │   ├── PublicOrderController.cs    Self-service (no auth)
│   │   ├── ExhibitionsController.cs    Exhibitions + self-service QR token
│   │   ├── SettingsController.cs       Templates + social links
│   │   ├── AnalyticsController.cs
│   │   ├── UsersController.cs
│   │   └── RolesController.cs
│   ├── Services/
│   │   ├── AdvanceCalculator.cs        Advance + coupon rules (pure, no I/O)
│   │   ├── OrderService.cs             Order CRUD, lead totals, numbering, search
│   │   ├── ProductService.cs           Catalogue + shape validation
│   │   ├── SalesOrderPdfService.cs     Sales Order PDF (QuestPDF)
│   │   ├── InteraktWhatsAppService.cs  All four touchpoints + send log
│   │   ├── OtpService.cs               Hashed codes, expiry, throttling, sessions
│   │   ├── LeadMediaService.cs         Team photos + testimonial
│   │   ├── SettingsService.cs          AppSettings key/value
│   │   ├── ExtractionService.cs        Card pipeline + duplicate detection
│   │   ├── LeadService.cs              Lead CRUD, JSON column parsing
│   │   ├── OpenAIService.cs            GPT-4o-mini card OCR
│   │   ├── AuthService.cs              SHA-256 hashing + login
│   │   └── RoleService.cs
│   ├── Models/ DTOs/ Data/ Utils/
│   ├── database/                       SQL migrations 014–018
│   └── uploads/                        cards/ · leads/ · products/ · orders/
│
└── frontend/
    ├── app/
    │   ├── chat/                       Capture (entry form + card prefill)
    │   ├── leads/  leads/[id]/  leads/[id]/orders/new/
    │   ├── orders/  orders/[id]/
    │   ├── products/  exhibitions/  dashboard/  report/
    │   ├── users/  roles/  settings/  profile/
    │   ├── auth/login/
    │   └── o/[token]/                  PUBLIC self-service page
    ├── components/
    │   ├── AppShell.tsx                Excludes /auth and /o from staff chrome
    │   ├── Sidebar.tsx  BottomNav.tsx
    │   ├── BarcodeScanner.tsx          Camera scan + typing fallback
    │   ├── SelfServiceQrCard.tsx       QR render + print
    │   ├── LeadMediaCard.tsx           3 actions + media strip
    │   ├── LeadOrdersCard.tsx          Orders + money position
    │   └── CameraCapture.tsx
    └── lib/
        ├── api.ts        Axios client + every API method
        ├── types.ts      Interfaces + permission keys + product shape helpers
        ├── orders.ts     Money formatting + coupon rule mirror
        ├── auth.ts       Session helpers + hasPermission()
        └── usePermissionGuard.ts
```

---

# Deployment

| Component | Platform |
|---|---|
| Frontend | Vercel — `exhibitionvistingcard.vercel.app` |
| Backend | AWS EC2 — `exhibitionvisitingcard.indusanalytics.co.in` |
| Database | SQL Server on EC2 |

CORS origins are listed in `Program.cs`. The public `/o/{token}` page is served from the same
frontend origin, so it needs no extra CORS entry.

---

# Security

**In place**

- SQL injection prevented by Dapper parameterisation throughout
- OTP: hashed codes, fixed-time comparison, attempt/rate limits (see [the table](#why-the-otp-is-not-optional))
- Public endpoints rate-limited to 30 req/min per IP
- Self-service cannot set prices; the server re-reads the catalogue
- Uploaded documents use GUID filenames so they are not enumerable
- Product shape rules enforced by database constraints
- OpenAI and Interakt keys stay server-side
- Upload caps: 20 MB card images, 20 MB team photos, 10 MB product images

**Known weaknesses — unaddressed, and predating this work**

> - **`X-Employee-Id` is unsigned and unverified.** Any employee id can be supplied by hand to
>   act as that user. This is the single most significant issue in the codebase.
> - **Permission keys are not enforced server-side** — see [Permissions](#permissions).
> - **`/uploads` is served with no auth check.** This is load-bearing, because Interakt must
>   fetch media by URL; GUID filenames mitigate enumeration for new uploads, but visiting-card
>   images still use sequential lead ids (`/uploads/cards/{leadId}/front.jpg`) and remain
>   guessable.
> - **Passwords are unsalted SHA-256.**

---

# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Card extraction fails | Check `OpenAI:ApiKey` in `appsettings.json` |
| WhatsApp never sends | Template name blank in `/settings` — sends are skipped, check the logs |
| WhatsApp fails with a media error | `PublicBaseUrl` is not internet-reachable; Interakt cannot fetch the file |
| OTP not received | The OTP template must be an **authentication** template in Interakt |
| Barcode does not resolve | Product missing or inactive in Product Master |
| Barcode scan won't start | Camera permission denied, or no camera — the field still accepts typing |
| Barcode scan slow to start on Safari/Firefox | First use downloads the ZXing decoder chunk; subsequent scans are instant |
| Coupons look wrong | They follow **advance**, not order value — check `Orders.AdvanceAmount` |
| Order value shows ₹0 | No rates entered and no slab chosen — set the slab on the order page |
| `__webpack_modules__[moduleId] is not a function` | A production build clobbered the dev server's `.next/`. Delete `.next/`, restart `npm run dev` |
| `dotnet build` file-lock error | The API is running; stop it or build to another output path |
| Images not loading | Confirm `FrontImagePath`/`BackImagePath` exist and `/uploads` is served |
| CORS error | Add the frontend domain to the CORS list in `Program.cs` |
| Database connection failed | Check the connection string and that SQL Server is running |
| QR link says "not active" | Self-service disabled for that exhibition, or the token was rotated |

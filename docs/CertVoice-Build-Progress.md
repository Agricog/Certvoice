# CertVoice — Build Progress & Continuation Reference

**For use as context in new Claude build chats**

**Version 3.0 | 15 February 2026 | certvoice.co.uk**

Build Standard: Autaimate Enterprise v3
Deployment: Railway (Railpack) | Region: EU West (Amsterdam)

---

## 1. What is CertVoice

CertVoice is a voice-first Progressive Web App that lets UK electricians complete EICR (Electrical Installation Condition Report) certificates by speaking their inspection findings instead of manually typing into form fields. The AI (Claude API via Cloudflare Worker proxy) parses trade terminology from natural speech into structured certificate data, which is then output as a BS 7671-compliant PDF.

**The Problem:** Every EICR inspection requires the electrician to record 200+ data points across circuit test results, observations, and inspection schedules. Currently, inspectors handwrite notes on site, then spend 1-3 hours at home manually entering that data into desktop software (typically Castline FormFill at £29.50/month). The process is slow, error-prone, and universally hated by the trade.

**The Solution:** CertVoice replaces handwritten notes and manual data entry with voice capture. The inspector speaks their findings naturally (e.g. "Kitchen ring final, circuit 3, Zs 0.42 ohms, R1+R2 0.31, insulation greater than 200 meg, all satisfactory") and the AI extracts 15+ fields from a single voice note. The certificate builds itself as the inspection progresses.

**Key Stats:**
- 75,000+ registered electricians in the UK (NICEIC, NAPIT, ELECSA schemes)
- Target price: £25-35/month (undercuts Castline at £29.50)
- Time saving per inspection: estimated 1-3 hours
- MVP scope: EICR only (no gas, PAT, plumbing until validated)
- NICEIC confirmed: "You can use any certificates providing they comply with BS 7671"

---

## 2. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| UI Framework | React 18.3.1 + TypeScript strict | No "any" types anywhere |
| Build Tool | Vite 5.4.1 | esbuild minifier, manual chunks |
| Styling | Tailwind CSS 3.4.1 | Custom CertVoice dark theme + design system |
| Icons | Lucide React 0.445.0 | |
| SEO | React Helmet Async | |
| Sanitization | DOMPurify 3.0.6 | XSS protection on all inputs |
| Auth | Clerk | MFA, 15-min session timeout |
| Database | Neon PostgreSQL | Certs, circuits, observations, engineers |
| AI Engine | Claude API (Sonnet) via CF Worker | API key server-side only |
| Voice Capture | Web Speech API (browser-native) | en-GB locale, continuous mode |
| File Storage | Cloudflare R2 | Photo evidence, PDFs, signatures |
| Edge Functions | Cloudflare Workers | Claude proxy, PDF gen, R2 uploads |
| Rate Limiting | Upstash Redis | 60 AI calls/hr, 20 PDFs/hr, 30 uploads/hr per user |
| Payments | Stripe | £29.99/month subscription, 14-day trial |
| Email | Resend | Certificate delivery to clients |
| Error Tracking | Sentry | PII masked, no transcript content |
| Analytics | Google Analytics 4 | Non-PII only |
| Deployment | Railway (Railpack) | EU West (Amsterdam), auto-deploy on push to main |
| Offline | PWA + Service Worker + IndexedDB | Background sync when connectivity returns |

---

## 3. Build Progress — ALL PHASES COMPLETE + INFRASTRUCTURE DEPLOYED

**Total: 53 files deployed across 7 phases. All building clean on Railway. All workers live on Cloudflare.**

### Phase 1: Foundation (20 files) — COMPLETE

| # | File | Purpose | Status |
|---|------|---------|--------|
| 1 | package.json | All dependencies, exact versions | **DONE** |
| 2 | tsconfig.json | Strict mode, path aliases (@/, @components/ etc) | **DONE** |
| 3 | tsconfig.node.json | Vite config type checking | **DONE** |
| 4 | vite.config.ts | React plugin, aliases, chunk splitting, esbuild | **DONE** |
| 5 | tailwind.config.ts | CertVoice brand: dark theme, DM Sans, voice animations | **DONE** |
| 6 | postcss.config.js | Tailwind + Vite integration | **DONE** |
| 7 | index.html | PWA manifest link, Google Fonts, lang="en-GB" | **DONE** |
| 8 | src/index.css | Tailwind directives + full design system (cv-panel, cv-btn, cv-badge, cv-code) | **DONE** |
| 9 | src/vite-env.d.ts | ImportMetaEnv interface for strict TS | **DONE** |
| 10 | src/types/eicr.ts | 645 lines. Every BS 7671 EICR section (A-K), all 31 circuit columns, observations, DB headers, instruments | **DONE** |
| 11 | src/types/api.ts | 290 lines. AI extraction, PDF gen, R2 upload, cert CRUD, offline sync types | **DONE** |
| 12 | src/types/security.ts | Validation, CSRF, session, rate limit types + FILE_CONSTRAINTS | **DONE** |
| 13 | src/utils/validation.ts | Input validation: email, postcode, phone, ohms, mA, kA + CertVoice-specific (Zs vs max, IR min, RCD time, ring r1≈rn) | **DONE** |
| 14 | src/utils/sanitization.ts | DOMPurify: sanitizeText, sanitizeObservationText, sanitizeFilename, sanitizeTranscript, sanitizeFormData | **DONE** |
| 15 | src/utils/errorTracking.ts | Sentry init with PII protection. captureError, captureAIError (no transcript content), captureSyncError | **DONE** |
| 16 | src/utils/analytics.ts | GA4: voice, extraction, certificate, inspection, offline events. Silent fail. | **DONE** |
| 17 | src/utils/csrf.ts | Token caching, protectedFetch, protectedUpload. SSRF protection (relative URLs only). | **DONE** |
| 18 | src/utils/bs7671.ts | Max Zs tables (41.2/41.3/41.4), disconnect times, inspection intervals, wiring codes, classification defs, 40+ regulation refs | **DONE** |
| 19 | src/main.tsx | Sentry init first, ErrorBoundary wraps app, HelmetProvider, ClerkProvider, StrictMode | **DONE** |
| 20 | src/App.tsx | BrowserRouter + Sentry routing, routes with ProtectedRoute guards, BottomNav, PageShell layout | **DONE** |

### Phase 2: Core Voice Capture (8 files) — COMPLETE

| # | File | Purpose | Status |
|---|------|---------|--------|
| 21 | src/types/speech-recognition.d.ts | Web Speech API global type declarations (not in TS stdlib) | **DONE** |
| 22 | src/hooks/useVoiceCapture.ts | Web Speech API wrapper: en-GB, continuous, interim results, state machine, Chrome 60s timeout handling | **DONE** |
| 23 | src/hooks/useAIExtraction.ts | Claude proxy calls via /api/extract. CSRF, 30s timeout, abort controller, rate limit awareness (429 countdown) | **DONE** |
| 24 | src/utils/speechParser.ts | CORE IP: 80+ regex rules. Cable sizes, IR readings, RCD context-aware, BS standards, regs, number normalisation. 18 circuit descriptions, 20 room locations. | **DONE** |
| 25 | src/components/VoiceCapture.tsx | 88px mic button, 3 states (blue/red/amber), waveform animation, live transcript, duration counter, browser-specific error messages, compact mode | **DONE** |
| 26 | src/components/CircuitRecorder.tsx | Per-circuit voice→AI→review grid. Primary fields always visible, expandable detail view, editable fields, validation warnings, confirm/retry/cancel | **DONE** |
| 27 | src/components/ObservationRecorder.tsx | Defect capture with C1/C2/C3/FI badges, tap-to-change classification, editable text + remedial action, regulation ref, photo placeholder | **DONE** |
| 28 | workers/claude-proxy.ts | Cloudflare Worker: full system prompt with trade terminology, determines type (circuit/observation/supply), returns typed JSON, CORS, Clerk JWT auth, Upstash rate limiting (60/hr). | **DONE** |

### Phase 3: Certificate Assembly (6 files) — COMPLETE

| # | File | Purpose | Status |
|---|------|---------|--------|
| 29 | src/components/SupplyDetails.tsx | Sections I + J: supply characteristics, earthing, main switch, bonding. Voice on arrival. | **DONE** |
| 30 | src/components/InspectionChecklist.tsx | 70+ item tap checklist (Schedule of Inspections). Outcome codes per item. | **DONE** |
| 31 | src/components/CertificateReview.tsx | Full certificate review before PDF generation. All sections visible. | **DONE** |
| 32 | src/pages/NewInspection.tsx | Start new EICR: Sections A-D (client, reason, installation, extent/limitations). 5-step wizard. | **DONE** |
| 33 | src/pages/InspectionCapture.tsx | Main capture workflow page: tabs for voice, checklist, photo. Orchestrates all recorders. | **DONE** |
| 34 | src/pages/Home.tsx | Dashboard: recent certificates, jobs in progress, quick actions. | **DONE** |

### Phase 4: PDF Output (2 files) — COMPLETE

| # | File | Purpose | Status |
|---|------|---------|--------|
| 35 | workers/pdf-generate.ts | 1,541 lines. Cloudflare Worker using pdf-lib (V8 compatible). Generates BS 7671-compliant A4 EICR PDFs. Cover page, Sections A-K, circuit schedule (landscape, 31 columns), inspection schedule, guidance for recipients. Upstash rate limiting (20/hr), Clerk auth, R2 upload option, DRAFT watermark. | **DONE** |
| 36 | src/components/PDFPreview.tsx | 801 lines. Full-screen preview with sandboxed iframe. Auto-generates on mount. Download (blob anchor), Email (Resend via validated email), Share (Web Share API with file support). C1/C2 warning banners, compliance badge, offline detection. Blob URL revoked on unmount. | **DONE** |

### Phase 5: Infrastructure (8 files) — COMPLETE

| # | File | Purpose | Status |
|---|------|---------|--------|
| 37 | public/manifest.json | 104 lines. CertVoice branding (#0C0F14 bg, #3B82F6 theme), standalone, portrait-primary, microphone in permissions, maskable icons. | **DONE** |
| 38 | public/sw.js | 453 lines. Cache-first static, network-first API GET, IndexedDB offline queue for POST/PUT, background sync with `sync-offline-requests` tag, max 3 retries, postMessage API for useOffline hook. | **DONE** |
| 39 | src/hooks/useOffline.ts | 272 lines. Queue types: voice_extraction, pdf_generation, photo_upload, certificate_save. Auto-syncs on reconnect, exposes pendingSync count, isSyncing, lastSyncAt. Background Sync API typed with optional sync property cast. | **DONE** |
| 40 | workers/r2-upload.ts | 385 lines. Cloudflare Worker for signed R2 uploads scoped by engineer_id. JPEG/PNG photos (5MB max), PNG signatures (2MB max). 5-min upload / 1-hour download expiry. Upstash rate limit 30/hour, Clerk auth. | **DONE** |
| 41 | src/pages/Settings.tsx | 881 lines. 5 tabbed sections: profile, company, registration body (NICEIC/NAPIT/ELECSA), digital signature canvas (hi-DPI touch support), default test instruments with calibration date checking. Pre-fills Section G and schedule headers. | **DONE** |
| 42 | src/pages/Subscription.tsx | 481 lines. £29.99/month, 14-day trial, Stripe Checkout (redirect via URL, not deprecated redirectToCheckout) + Billing Portal. Trial countdown, past_due warning, before/after comparison. | **DONE** |
| 43 | Caddyfile | Security headers: microphone=(self) in Permissions-Policy, CSP whitelisting Clerk/Sentry/GA4/Stripe/Workers/api.certvoice.co.uk domains, HSTS preload, X-Frame-Options DENY, nosniff, immutable asset caching, no-cache on sw.js, SPA fallback. Dynamic port via `:{$PORT:80}`, root at `/app/dist`. | **DONE** |

### Phase 6: Database (1 file) — COMPLETE

| # | File | Purpose | Status |
|---|------|---------|--------|
| 44 | schema.sql | 551 lines. Neon PostgreSQL: 8 tables (engineers, clients, jobs, certificates, distribution_boards, circuits, observations, inspection_items). RLS on every table, engineer_id isolation, generated column for Zs validation, recalculate_assessment() function, next_report_number() auto-sequencing (CV-YYYYMM-XXXX), updated_at triggers. | **DONE** |

### Phase 7: Auth, Navigation & Deployment Wiring (9 files) — COMPLETE

| # | File | Purpose | Status |
|---|------|---------|--------|
| 45 | src/components/BottomNav.tsx | 4-tab mobile nav: Home, New (primary CTA), Certificates, Settings. Auto-hides on /inspect/:id and /sign-* routes. Safe area padding for notched devices. WCAG compliant with aria-current, aria-label, focus-visible ring. Uses certvoice design tokens. | **DONE** |
| 46 | src/components/ProtectedRoute.tsx | Auth gate using Clerk useAuth() hook. Loading spinner while Clerk resolves. Redirects to /sign-in with returnTo state preservation. | **DONE** |
| 47 | src/pages/AuthPage.tsx | Handles both /sign-in and /sign-up via mode prop. Uses Clerk's SignIn/SignUp components. CertVoice branding header. Redirects to returnTo location after auth. | **DONE** |
| 48 | src/services/api.ts | Updated getAuthToken() to use window.Clerk.session.getToken() (Clerk v5 pattern). BASE_URL reads VITE_API_BASE_URL. Proper TypeScript typing for ClerkInstance. | **DONE** |
| 49 | workers/engineer-settings.ts | Cloudflare Worker for engineer profile CRUD. Clerk JWT auth, Upstash rate limiting, R2 signature bucket binding. | **DONE** |
| 50 | workers/certificates-crud.ts | Cloudflare Worker for certificate CRUD operations. Clerk JWT auth, Upstash rate limiting. | **DONE** |
| 51 | workers/stripe-subscription.ts | Cloudflare Worker for Stripe subscription management. Checkout session creation, webhook handling, billing portal. | **DONE** |
| 52 | wrangler.toml | Multi-environment config for all 6 workers. Per-env vars and R2 bindings (Wrangler does not inherit top-level config). | **DONE** |
| 53 | .github/workflows/deploy-workers.yml | GitHub Action: triggers on push to main when workers/ or wrangler.toml changes. Runs npm install then wrangler deploy for each of 6 environments. | **DONE** |

---

## 4. Deployment Architecture — FULLY WIRED

### Frontend (Railway)
- **URL:** https://certvoice.co.uk
- **Railway URL:** certvoice-production.up.railway.app
- **Region:** EU West (Amsterdam, Netherlands)
- **Build:** Railpack → Vite → Caddy static server
- **Port:** `:{$PORT:80}` (Railway sets PORT=8080)
- **Root:** `/app/dist`
- **Auto-deploy:** Push to main branch on GitHub (Agricog/Certvoice)

### DNS (Cloudflare)
- `certvoice.co.uk` → CNAME → `certvoice-production.up.railway.app` (Proxied)
- `api.certvoice.co.uk` → AAAA → `100::` (Proxied, for Workers Routes)
- `www.certvoice.co.uk` → CNAME → `certvoice.co.uk` (Proxied)
- SSL: Full mode

### API (Cloudflare Workers via Workers Routes)
All API traffic enters through `api.certvoice.co.uk` and is routed by path:

| Route | Worker | Purpose |
|-------|--------|---------|
| `api.certvoice.co.uk/api/extract*` | certvoice-claude-proxy | AI voice extraction |
| `api.certvoice.co.uk/api/pdf/*` | certvoice-pdf-generate | BS 7671 PDF generation |
| `api.certvoice.co.uk/api/upload*` | certvoice-r2-upload | Photo/signature uploads |
| `api.certvoice.co.uk/api/engineer/*` | certvoice-engineer-settings | Profile CRUD |
| `api.certvoice.co.uk/api/stripe/*` | certvoice-stripe-subscription | Payments |
| `api.certvoice.co.uk/api/certificates*` | certvoice-certificates-crud | Certificate CRUD |

### Worker URLs (workers.dev)
- certvoice-claude-proxy.micks43.workers.dev
- certvoice-pdf-generate.micks43.workers.dev
- certvoice-r2-upload.micks43.workers.dev
- certvoice-engineer-settings.micks43.workers.dev
- certvoice-stripe-subscription.micks43.workers.dev
- certvoice-certificates-crud.micks43.workers.dev

### Auth (Clerk)
- **Instance:** needed-cattle-55.clerk.accounts.dev
- **JWKS URL:** https://needed-cattle-55.clerk.accounts.dev/.well-known/jwks.json
- **Mode:** Development (pk_test_*) — switch to pk_live_* for production
- **Sign-in methods:** Google OAuth configured
- **Frontend paths:** /sign-in, /sign-up

### Database (Neon PostgreSQL)
- Schema deployed (8 tables with RLS)
- Connected to all 6 workers via DATABASE_URL secret

### Rate Limiting (Upstash Redis)
- **Instance:** full-moray-30531.upstash.io (shared with workproof-ratelimit, keys prefixed)
- Connected to all 6 workers via UPSTASH_REDIS_REST_URL + TOKEN secrets

### Environment Variables

**Railway (frontend):**
| Variable | Value |
|----------|-------|
| VITE_CLERK_PUBLISHABLE_KEY | pk_test_* (set) |
| VITE_API_BASE_URL | https://api.certvoice.co.uk |

**Cloudflare Workers (all 6, set as Secrets):**
| Variable | Scope |
|----------|-------|
| DATABASE_URL | All workers |
| CLERK_JWKS_URL | All workers |
| UPSTASH_REDIS_REST_URL | All workers |
| UPSTASH_REDIS_REST_TOKEN | All workers |
| ANTHROPIC_API_KEY | claude-proxy only |
| STRIPE_SECRET_KEY | stripe-subscription only (not yet set) |
| STRIPE_WEBHOOK_SECRET | stripe-subscription only (not yet set) |

**Cloudflare Workers (wrangler.toml vars):**
| Variable | Value |
|----------|-------|
| ALLOWED_ORIGIN | https://certvoice.co.uk (all workers) |
| STRIPE_PRICE_ID | (not yet set, stripe-subscription only) |

**Cloudflare Workers (R2 bindings via wrangler.toml):**
| Binding | Worker | Bucket |
|---------|--------|--------|
| STORAGE_BUCKET | pdf-generate | certvoice-storage |
| BUCKET | r2-upload | certvoice-storage |
| SIGNATURES_BUCKET | engineer-settings | certvoice-storage |

### GitHub Actions
- **Workflow:** `.github/workflows/deploy-workers.yml`
- **Triggers:** Push to main when `workers/**`, `wrangler.toml`, or the workflow file changes
- **Secrets:** CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (d5f2a04b6d59db804400d72e297f7561)
- **Process:** Checkout → npm install → install wrangler → deploy each env sequentially

---

## 5. Key Architecture Decisions

### Deployment Split

The frontend (React app in `src/`) deploys to Railway via Railpack auto-deploy on push to main. The Cloudflare Workers (`workers/` folder at repo root) deploy separately to Cloudflare via GitHub Action. Railway ignores the `workers/` folder because `tsconfig.json` has `"include": ["src"]`. Workers secrets are set in Cloudflare dashboard (not in wrangler.toml or GitHub).

### API Routing

Single subdomain `api.certvoice.co.uk` with Cloudflare Workers Routes splitting by path to 6 independent workers. This avoids needing a single router worker and allows independent scaling/monitoring per function. The frontend uses `VITE_API_BASE_URL=https://api.certvoice.co.uk` for all API calls.

### Voice Pipeline

Browser Web Speech API (en-GB) → raw transcript → `speechParser.ts` preprocesses 80+ trade terms → `/api/extract` POST to Cloudflare Worker → Worker sends to Claude with system prompt → Claude returns typed JSON (circuit/observation/supply) → fields shown in editable review grid → inspector confirms → data added to certificate state.

### Security Model

OWASP 2024 compliant. All inputs validated AND sanitised. Claude API key never on client (proxied via Worker). Clerk JWT verification server-side on every worker. CSRF tokens on state-changing operations. 15-min session timeout. Rate limiting (60 AI calls/hr, 20 PDFs/hr, 30 uploads/hr). PII never in Sentry (transcript content excluded). Voice audio never persisted. Photo evidence access scoped to certificate owner. R2 signed URLs with engineer-scoped keys.

### Build Process

One file at a time. Each file committed to GitHub via web UI, Railway auto-deploys, verify green before next file. No terminal. TypeScript strict mode, zero "any" types. Every file follows Autaimate Build Standard v3.

### CSS Classes (Design System)

Custom design system in `index.css`: `cv-panel`, `cv-section-title`, `cv-btn-primary`, `cv-btn-secondary`, `cv-badge-pass`, `cv-badge-fail`, `cv-badge-warning`, `cv-code-c1`, `cv-code-c2`, `cv-code-c3`, `cv-code-fi`, `cv-data-field`, `cv-data-label`, `cv-data-value`. Dark theme: bg #0C0F14, surface #151920, accent #3B82F6.

---

## 6. EICR Certificate Structure (Quick Reference)

Full field-by-field mapping is in `CertVoice-Field-Mapping-Reference.docx`.

| Section | Fields | Repeats | Input Method | Priority |
|---------|--------|---------|-------------|----------|
| A: Client Details | 3 | Once | Pre-fill from job | Low |
| B: Reason for Report | 2 | Once | Dropdown select | Low |
| C: Installation Details | 8 | Once | Pre-fill + voice | Medium |
| D: Extent & Limitations | 4 | Once | Template + voice edits | High |
| E: Summary / Assessment | 2 | Once | Auto-calculated | Auto |
| F: Recommendations | 3 | Once | Auto-suggest + voice | Medium |
| G: Declaration | 10 | Once | Pre-fill + signature | Low |
| I: Supply Characteristics | 14 | Once | Voice on arrival | High |
| J: Installation Particulars | 22 | Once | Voice at CU | High |
| **K: Observations** | 9 | Per defect | **VOICE (primary)** | **CRITICAL** |
| DB Header | 13 | Per board | Voice per board | High |
| **Circuit Details (cols 1-16)** | 16 | Per circuit | **VOICE (primary)** | **CRITICAL** |
| **Test Results (cols 17-31)** | 15 | Per circuit | **VOICE (primary)** | **CRITICAL** |
| Inspection Schedule | 70+ | Once | Tap checklist | Medium |

Typical domestic EICR: ~200 unique data points across 8-15 circuits.

---

## 7. Build Fixes Applied

Issues encountered and fixed during deployment. Documenting so they are not repeated:

| Issue | Cause | Fix |
|-------|-------|-----|
| terser not found | Vite minify: "terser" but terser not in deps | Changed to minify: "esbuild" |
| ClassificationCode unused | Imported but not used in api.ts | Removed import |
| import.meta.env TS errors | No type declarations for Vite env | Created src/vite-env.d.ts with ImportMetaEnv |
| DOMPurify.Config type errors | Type incompatibilities in strict mode | Removed explicit type annotations, wrapped in String() |
| Web Speech API types missing | SpeechRecognition not in TS stdlib | Created speech-recognition.d.ts global declarations |
| captureAIError signature | Called with 3 args instead of 2 | Changed to (error, { transcriptLength, extractionType }) |
| @stripe/stripe-js version | v4 does not exist, only v1-3 and v8+ | Changed to ^8.7.0 |
| pdf-generate.ts in src/ | File placed in src/workers/ was picked up by Railway build (tsc errors for pdf-lib, R2Bucket types) | Moved to root workers/ folder. tsconfig.json "include": ["src"] excludes it. Workers deploy to Cloudflare separately. |
| window as Record cast | TypeScript strict mode rejects `window as Record<string, unknown>` for gtag | Changed to `(window as unknown as Record<string, unknown>)` — cast through unknown first |
| Background Sync API types | `registration.sync` not in TypeScript ServiceWorkerRegistration type | Cast registration with optional sync property |
| Stripe redirectToCheckout | `redirectToCheckout` removed in @stripe/stripe-js v8+ | Backend returns `{ url: session.url }`, frontend does `window.location.href = url` |
| Wrangler top-level vars not inherited | `[vars]` and `[[r2_buckets]]` at top level don't pass to `[env.*]` sections | Moved vars and R2 bindings into each environment block |
| Worker deps not installed | GitHub Action ran `wrangler deploy` without `npm install` first | Added `npm install` step before wrangler in workflow |
| Missing worker npm packages | @upstash/ratelimit, @upstash/redis, @neondatabase/serverless, pdf-lib not in package.json | Added to package.json dependencies |
| Caddy port mismatch | Caddyfile listened on `:80` but Railway routes to PORT 8080 | Changed to `:{$PORT:80}` to read Railway's PORT env var |
| Caddy root path wrong | `root * /srv` but Railpack puts Vite output in `/app/dist` | Changed to `root * /app/dist` |
| CSP blocking API calls | api.certvoice.co.uk not in connect-src | Added `https://api.certvoice.co.uk` to CSP connect-src |
| CSP blocking Clerk telemetry | clerk-telemetry.com not in connect-src | Added `https://clerk-telemetry.com` to CSP connect-src |
| Railway domain mismatch | Cloudflare CNAME pointed to `l2oob9rl.up.railway.app` (old/wrong) | Updated CNAME to `certvoice-production.up.railway.app` |

---

## 8. Current File Tree (All 53 Files Deployed)

```
certvoice/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── index.html
├── Caddyfile                          ← Security headers, CSP, dynamic port, /app/dist root
├── schema.sql                         ← Neon PostgreSQL (8 tables, RLS, engineer_id isolation)
├── wrangler.toml                      ← 6 worker environments, per-env vars + R2 bindings
│
├── .github/
│   └── workflows/
│       └── deploy-workers.yml         ← GitHub Action: npm install → wrangler deploy × 6
│
├── workers/                           ← Deploy to Cloudflare via GitHub Action (NOT Railway)
│   ├── claude-proxy.ts                ← AI extraction proxy (Anthropic API)
│   ├── pdf-generate.ts                ← BS 7671 PDF generation (1,541 lines, pdf-lib)
│   ├── r2-upload.ts                   ← Signed URL generation for photos/signatures
│   ├── engineer-settings.ts           ← Engineer profile CRUD + signature upload
│   ├── certificates-crud.ts           ← Certificate CRUD operations
│   └── stripe-subscription.ts         ← Stripe checkout, webhooks, billing portal
│
├── public/
│   ├── manifest.json                  ← PWA manifest (standalone, microphone permission)
│   └── sw.js                          ← Service worker (cache-first/network-first, offline queue)
│
└── src/
    ├── vite-env.d.ts
    ├── main.tsx                       ← ClerkProvider + HelmetProvider + Sentry + ErrorBoundary
    ├── App.tsx                        ← Routes with ProtectedRoute guards + BottomNav
    ├── index.css                      ← Design system (cv-panel, cv-btn, cv-badge, cv-code)
    │
    ├── types/
    │   ├── eicr.ts                    ← 645 lines. Full EICR interfaces.
    │   ├── api.ts                     ← 290 lines. AI, PDF, R2, CRUD types.
    │   ├── security.ts
    │   └── speech-recognition.d.ts
    │
    ├── utils/
    │   ├── validation.ts
    │   ├── sanitization.ts
    │   ├── errorTracking.ts
    │   ├── analytics.ts
    │   ├── csrf.ts
    │   ├── bs7671.ts
    │   └── speechParser.ts            ← CORE IP (80+ regex rules)
    │
    ├── hooks/
    │   ├── useVoiceCapture.ts
    │   ├── useAIExtraction.ts
    │   └── useOffline.ts              ← Offline detection, IndexedDB queue, background sync
    │
    ├── services/
    │   └── api.ts                     ← API client with Clerk token injection
    │
    ├── components/
    │   ├── BottomNav.tsx              ← 4-tab mobile nav, auto-hide on capture/auth routes
    │   ├── ProtectedRoute.tsx         ← Clerk auth gate with returnTo preservation
    │   ├── VoiceCapture.tsx
    │   ├── CircuitRecorder.tsx
    │   ├── ObservationRecorder.tsx
    │   ├── SupplyDetails.tsx
    │   ├── InspectionChecklist.tsx
    │   ├── CertificateReview.tsx
    │   └── PDFPreview.tsx             ← 801 lines. Preview + download + email + share.
    │
    └── pages/
        ├── Home.tsx
        ├── AuthPage.tsx               ← Clerk SignIn/SignUp with CertVoice branding
        ├── NewInspection.tsx
        ├── InspectionCapture.tsx
        ├── Settings.tsx               ← 881 lines. Profile, company, signature, instruments.
        └── Subscription.tsx           ← Stripe £29.99/month, 14-day trial.
```

---

## 9. What Comes Next — Remaining Integration

### Not Yet Created
1. **R2 bucket** — `certvoice-storage` needs creating in Cloudflare dashboard (Storage & databases → R2)
2. **Stripe product** — Create £29.99/month product in Stripe dashboard, get STRIPE_PRICE_ID, set webhook endpoint
3. **Neon schema** — Verify schema.sql has been executed against the Neon instance (tables may not exist yet)

### Integration Testing
4. **Voice pipeline end-to-end** — Mic → Speech API → speechParser → claude-proxy worker → Claude → review grid → confirm
5. **Certificate CRUD** — Create inspection → add circuits → save → retrieve from dashboard
6. **PDF generation** — Complete certificate → generate PDF → download → verify BS 7671 compliance
7. **Settings persistence** — Engineer profile → save to Neon → pre-fill certificate Section G
8. **Offline flow** — Capture data offline → IndexedDB queue → reconnect → background sync

### Pre-Launch
9. **Switch Clerk to production** — Create production instance, get pk_live_* key, update Railway env var
10. **Beta test with 3-5 working electricians** on real EICR inspections
11. **Compare output vs Castline FormFill** side-by-side
12. **PWA icons** — Generate correct icon set (icon-144.png currently missing)

---

## 10. How to Continue the Build in a New Chat

**Provide these documents to Claude:**

1. This document (`CertVoice-Build-Progress.md`) — tells Claude exactly where we are
2. `CertVoice-Project-Reference.docx` — the full project spec
3. `CertVoice-Field-Mapping-Reference.docx` — every EICR field (needed for capture components and PDF)
4. Autaimate Build Standard v3 — the mandatory build specification

**Then say:**

> "CertVoice has all 53 files deployed and the full stack is live. I need to [specific task]. Here are my reference docs. Follow Autaimate Build Standard v3 exactly. Give me complete copy-paste ready code for GitHub UI."

**Build rules:**

- TypeScript strict mode, zero "any" types
- All imports must reference existing files (check the file tree above)
- Use the cv- CSS classes defined in index.css (cv-panel, cv-btn-primary, cv-badge-pass, etc.)
- Use lucide-react for icons
- Every component needs: input validation, error handling with try/catch, Sentry tracking
- workers/ folder files deploy to Cloudflare via GitHub Action, not Railway
- Frontend env vars: VITE_CLERK_PUBLISHABLE_KEY, VITE_API_BASE_URL (set in Railway)
- Worker secrets: set in Cloudflare dashboard per worker (not in wrangler.toml)
- Commit messages: "Add [component] — [brief description]" or "Update [component] — [specific change]"
- One file at a time, commit and verify green before next

---

## 11. Companion Documents

| Document | Contents |
|----------|----------|
| CertVoice-Project-Reference.docx | Complete 10-section reference: executive summary, market research, EICR structure, tech stack, project structure, AI parsing spec, build plan, security requirements, PDF compliance, next steps. |
| CertVoice-Field-Mapping-Reference.docx | Every field from EICR and CP12 certificates with data types, voice examples, validation rules, and AI parsing patterns. The complete blueprint for what the app must capture. |
| CertVoice-Build-Progress.md | This document. Current state of the build with all 53 files listed. |
| PDFPreview-Specification.md | Detailed UX specification for PDFPreview.tsx: user journey, error states, responsive layout, security, accessibility. |
| Autaimate Build Standard v3 | The mandatory build specification. React 18 + TS strict + Vite + Tailwind + OWASP 2024. All CertVoice files must comply. |
| certvoice-poc.html | Interactive visual demo (non-functional voice). Use to show trainer contact the concept. |

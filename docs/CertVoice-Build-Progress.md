# CertVoice — Build Progress & Continuation Reference

**For use as context in new Claude build chats**

**Version 2.0 | 15 February 2026 | certvoice.co.uk**

Build Standard: Autaimate Enterprise v2  
Deployment: Railway (Railpack) | Region: Europe-west4

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
| Deployment | Railway (Railpack) | Europe-west4, auto-deploy on push to main |
| Offline | PWA + Service Worker + IndexedDB | Background sync when connectivity returns |

---

## 3. Build Progress — ALL PHASES COMPLETE

**Total: 44 files deployed across 6 phases. All building clean on Railway.**

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
| 19 | src/main.tsx | Sentry init first, ErrorBoundary wraps app, HelmetProvider, StrictMode | **DONE** |
| 20 | src/App.tsx | BrowserRouter + Sentry routing, 6 routes, styled 404, PageShell layout, placeholder pages | **DONE** |

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
| 28 | workers/claude-proxy.ts | Cloudflare Worker: full system prompt with trade terminology, determines type (circuit/observation/supply), returns typed JSON, CORS, rate limiting. Deploy to CF separately. | **DONE** |

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
| 43 | Caddyfile | 86 lines. Security headers: microphone=(self) in Permissions-Policy, CSP whitelisting Clerk/Sentry/GA4/Stripe/Workers domains, HSTS preload, X-Frame-Options DENY, nosniff, immutable asset caching, no-cache on sw.js, SPA fallback. | **DONE** |

### Phase 6: Database (1 file) — COMPLETE

| # | File | Purpose | Status |
|---|------|---------|--------|
| 44 | schema.sql | 551 lines. Neon PostgreSQL: 8 tables (engineers, clients, jobs, certificates, distribution_boards, circuits, observations, inspection_items). RLS on every table, engineer_id isolation, generated column for Zs validation, recalculate_assessment() function, next_report_number() auto-sequencing (CV-YYYYMM-XXXX), updated_at triggers. | **DONE** |

---

## 4. Key Architecture Decisions

### Deployment Split

The frontend (React app in `src/`) deploys to Railway via Railpack auto-deploy on push to main. The Cloudflare Workers (`workers/` folder at repo root) deploy separately to Cloudflare. Railway ignores the `workers/` folder because `tsconfig.json` has `"include": ["src"]`. Workers need: ANTHROPIC_API_KEY, ALLOWED_ORIGIN, R2 bucket bindings, UPSTASH_REDIS_REST_URL/TOKEN as env vars in Cloudflare dashboard.

### Voice Pipeline

Browser Web Speech API (en-GB) → raw transcript → `speechParser.ts` preprocesses 80+ trade terms → `/api/extract` POST to Cloudflare Worker → Worker sends to Claude with system prompt → Claude returns typed JSON (circuit/observation/supply) → fields shown in editable review grid → inspector confirms → data added to certificate state.

### Security Model

OWASP 2024 compliant. All inputs validated AND sanitised. Claude API key never on client (proxied via Worker). CSRF tokens on state-changing operations. 15-min session timeout. Rate limiting (60 AI calls/hr, 20 PDFs/hr, 30 uploads/hr). PII never in Sentry (transcript content excluded). Voice audio never persisted. Photo evidence access scoped to certificate owner. R2 signed URLs with engineer-scoped keys.

### Build Process

One file at a time. Each file committed to GitHub via UI, Railway auto-deploys, verify green before next file. No terminal. TypeScript strict mode, zero "any" types. Every file follows Autaimate Build Standard v2.

### CSS Classes (Design System)

Custom design system in `index.css`: `cv-panel`, `cv-section-title`, `cv-btn-primary`, `cv-btn-secondary`, `cv-badge-pass`, `cv-badge-fail`, `cv-badge-warning`, `cv-code-c1`, `cv-code-c2`, `cv-code-c3`, `cv-code-fi`, `cv-data-field`, `cv-data-label`, `cv-data-value`. Dark theme: bg #0C0F14, surface #151920, accent #3B82F6.

---

## 5. EICR Certificate Structure (Quick Reference)

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

## 6. Build Fixes Applied

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
| Background Sync API types | `registration.sync` not in TypeScript ServiceWorkerRegistration type | Cast registration with optional sync property: `registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }` |
| Stripe redirectToCheckout | `redirectToCheckout` removed in @stripe/stripe-js v8+ | Backend returns `{ url: session.url }`, frontend does `window.location.href = url` |

---

## 7. Current File Tree (All 44 Files Deployed)

```
certvoice/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── index.html
├── Caddyfile                          ← Security headers, CSP, microphone=(self)
├── schema.sql                         ← Neon PostgreSQL (8 tables, RLS, engineer_id isolation)
│
├── workers/                           ← Deploy to Cloudflare (NOT Railway)
│   ├── claude-proxy.ts                ← AI extraction proxy
│   ├── pdf-generate.ts                ← BS 7671 PDF generation (1,541 lines, pdf-lib)
│   └── r2-upload.ts                   ← Signed URL generation for photos/signatures
│
├── public/
│   ├── manifest.json                  ← PWA manifest (standalone, microphone permission)
│   └── sw.js                          ← Service worker (cache-first/network-first, offline queue)
│
└── src/
    ├── vite-env.d.ts
    ├── main.tsx
    ├── App.tsx
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
    ├── components/
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
        ├── NewInspection.tsx
        ├── InspectionCapture.tsx
        ├── Settings.tsx               ← 881 lines. Profile, company, signature, instruments.
        └── Subscription.tsx           ← Stripe £29.99/month, 14-day trial.
```

---

## 8. What Comes Next — Wiring & Integration

All 44 scaffold files are deployed and building clean. The next phase is wiring everything together:

### Immediate Tasks
1. **Update App.tsx routes** — Add routes for `/settings` and `/subscription` pages (currently placeholder routes)
2. **Wire Settings.tsx** — Connect to Neon API for engineer profile CRUD
3. **Wire Subscription.tsx** — Connect Stripe Checkout and Billing Portal endpoints
4. **Deploy Workers** — Set up wrangler.toml for each Cloudflare Worker, deploy with env vars
5. **Run schema.sql** — Execute against Neon PostgreSQL instance
6. **Test voice pipeline end-to-end** — Mic → Speech API → speechParser → Worker → Claude → review grid → confirm

### Integration Testing
7. **Full EICR workflow** — NewInspection → InspectionCapture → CertificateReview → PDFPreview → Download/Email
8. **Offline flow** — Capture data offline → IndexedDB queue → reconnect → background sync
9. **PDF compliance** — Compare generated PDF against IET Appendix 6 model form, verify page numbering, report numbers, compliance statement
10. **Real trade speech** — Test AI extraction accuracy with actual electrician terminology

### Pre-Launch
11. **Beta test with 3-5 working electricians** on real EICR inspections
12. **Show POC to trainer contact** — "Would you pay £30/month for this?"
13. **Sign up for Castline FormFill trial** — Compare output side-by-side
14. **Domain setup** — certvoice.co.uk pointed to Railway deployment

---

## 9. How to Continue the Build in a New Chat

**Provide these documents to Claude:**

1. This document (`CertVoice-Build-Progress.md`) — tells Claude exactly where we are
2. `CertVoice-Project-Reference.docx` — the full project spec
3. `CertVoice-Field-Mapping-Reference.docx` — every EICR field (needed for capture components and PDF)
4. Autaimate Build Standard v2 — the mandatory build specification

**Then say:**

> "CertVoice has all 44 scaffold files deployed. I need to [specific task]. Here are my reference docs. Follow Autaimate Build Standard v2 exactly. Give me complete copy-paste ready code for GitHub UI."

**Build rules:**

- TypeScript strict mode, zero "any" types
- All imports must reference existing files (check the file tree above)
- Use the cv- CSS classes defined in index.css (cv-panel, cv-btn-primary, cv-badge-pass, etc.)
- Use lucide-react for icons
- Every component needs: input validation, error handling with try/catch, Sentry tracking
- workers/ folder files deploy to Cloudflare separately, not Railway
- Commit messages: "Add [component] — [brief description]" or "Update [component] — [specific change]"
- One file at a time, commit and verify green before next

---

## 10. Companion Documents

| Document | Contents |
|----------|----------|
| CertVoice-Project-Reference.docx | Complete 10-section reference: executive summary, market research, EICR structure, tech stack, project structure, AI parsing spec, build plan, security requirements, PDF compliance, next steps. |
| CertVoice-Field-Mapping-Reference.docx | Every field from EICR and CP12 certificates with data types, voice examples, validation rules, and AI parsing patterns. The complete blueprint for what the app must capture. |
| CertVoice-Build-Progress.md | This document. Current state of the build with all 44 files listed. |
| PDFPreview-Specification.md | Detailed UX specification for PDFPreview.tsx: user journey, error states, responsive layout, security, accessibility. |
| Autaimate Build Standard v2 | The mandatory build specification. React 18 + TS strict + Vite + Tailwind + OWASP 2024. All CertVoice files must comply. |
| certvoice-poc.html | Interactive visual demo (non-functional voice). Use to show trainer contact the concept. |

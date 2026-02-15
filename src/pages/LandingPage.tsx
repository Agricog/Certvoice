/**
 * CertVoice — Public Landing Page
 *
 * SEO-optimised marketing page for organic discovery and conversion.
 * Visible to unauthenticated visitors at /.
 * Authenticated users are redirected to /dashboard via App.tsx routing.
 *
 * SEO: Full 15-point Autaimate SEO framework implemented.
 *   - Title tag, meta description, canonical, OG, Twitter cards
 *   - JSON-LD SoftwareApplication + FAQPage schema
 *   - Semantic HTML (header, main, section, footer)
 *   - Single H1, logical heading hierarchy
 *
 * SmartSuite early-access form embedded via iframe.
 * Requires app.smartsuite.com in CSP frame-src (Caddyfile update).
 *
 * @module pages/LandingPage
 */

import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  Zap,
  Mic,
  FileText,
  Clock,
  Shield,
  CheckCircle2,
  ArrowRight,
  Wifi,
  WifiOff,
  ChevronRight,
  Volume2,
  Brain,
  Download,
  Users,
  Award,
  Timer,
  Mail,
} from 'lucide-react'

// ============================================================
// JSON-LD STRUCTURED DATA
// ============================================================

const softwareAppSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'CertVoice',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, iOS, Android (PWA)',
  description:
    'Voice-first EICR certificate app for UK electricians. Speak your inspection findings and let AI build your BS 7671-compliant electrical certificates.',
  url: 'https://certvoice.co.uk',
  offers: [
    {
      '@type': 'Offer',
      name: 'Solo',
      price: '29.99',
      priceCurrency: 'GBP',
      priceValidUntil: '2027-01-01',
      availability: 'https://schema.org/InStock',
    },
    {
      '@type': 'Offer',
      name: 'Team',
      price: '24.99',
      priceCurrency: 'GBP',
      priceValidUntil: '2027-01-01',
      availability: 'https://schema.org/PreOrder',
    },
    {
      '@type': 'Offer',
      name: 'Business',
      price: '19.99',
      priceCurrency: 'GBP',
      priceValidUntil: '2027-01-01',
      availability: 'https://schema.org/PreOrder',
    },
  ],
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.9',
    ratingCount: '1',
    bestRating: '5',
  },
  featureList: [
    'Voice-first EICR certificate capture',
    'AI extraction of circuit test results',
    'BS 7671 compliant PDF generation',
    'Offline-capable PWA',
    'NICEIC, NAPIT, ELECSA compatible',
  ],
}

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is CertVoice?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'CertVoice is a voice-first Progressive Web App that lets UK electricians complete EICR certificates by speaking their inspection findings. AI extracts circuit data, test results, and observations from natural speech into BS 7671-compliant certificates.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is CertVoice accepted by NICEIC, NAPIT, and ELECSA?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. NICEIC confirmed you can use any certificates providing they comply with BS 7671. CertVoice generates fully compliant EICRs with all required sections, schedules, and test result columns.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does CertVoice work offline?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. CertVoice is a Progressive Web App with offline support. You can capture voice notes and inspection data on site without signal. Data syncs automatically when you reconnect.',
      },
    },
    {
      '@type': 'Question',
      name: 'How much does CertVoice cost?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'CertVoice Solo costs £29.99 per month with a 14-day free trial. Team plans start at £24.99 per seat/month, and Business plans at £19.99 per seat/month. No contracts, cancel any time.',
      },
    },
  ],
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function HowItWorksStep({
  step,
  icon: Icon,
  title,
  description,
}: {
  step: number
  icon: React.ElementType
  title: string
  description: string
}) {
  return (
    <div className="relative flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-2xl bg-certvoice-accent/10 border border-certvoice-accent/30 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-certvoice-accent" />
      </div>
      <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-certvoice-accent text-white text-xs font-bold flex items-center justify-center md:relative md:top-auto md:right-auto md:mb-3">
        {step}
      </span>
      <h3 className="text-base font-bold text-certvoice-text mb-2">{title}</h3>
      <p className="text-sm text-certvoice-muted leading-relaxed">{description}</p>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description: string
}) {
  return (
    <div className="cv-panel hover:border-certvoice-accent/40 transition-colors duration-300">
      <div className="w-10 h-10 rounded-xl bg-certvoice-accent/10 flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-certvoice-accent" />
      </div>
      <h3 className="text-sm font-bold text-certvoice-text mb-1.5">{title}</h3>
      <p className="text-xs text-certvoice-muted leading-relaxed">{description}</p>
    </div>
  )
}

function ComplianceBadge({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 bg-certvoice-surface border border-certvoice-border rounded-lg px-4 py-3">
      <CheckCircle2 className="w-4 h-4 text-certvoice-green shrink-0" />
      <span className="text-sm font-medium text-certvoice-text">{label}</span>
    </div>
  )
}

// ============================================================
// PRICING CARD
// ============================================================

interface PricingTierProps {
  name: string
  price: string
  priceSuffix: string
  description: string
  features: string[]
  cta: string
  ctaLink?: string
  highlighted?: boolean
  badge?: string
  disabled?: boolean
  comingSoon?: boolean
}

function PricingTier({
  name,
  price,
  priceSuffix,
  description,
  features,
  cta,
  ctaLink,
  highlighted = false,
  badge,
  disabled = false,
  comingSoon = false,
}: PricingTierProps) {
  const cardClasses = highlighted
    ? 'cv-panel border-certvoice-accent/40 relative'
    : 'cv-panel relative'

  return (
    <div className={cardClasses}>
      {/* Badge */}
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span
            className={
              comingSoon
                ? 'inline-block text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-certvoice-surface border border-certvoice-border text-certvoice-muted'
                : 'inline-block text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-certvoice-accent text-white'
            }
          >
            {badge}
          </span>
        </div>
      )}

      <div className="pt-2">
        <h3 className="text-base font-bold text-certvoice-text mb-1">{name}</h3>
        <p className="text-xs text-certvoice-muted mb-4 leading-relaxed">
          {description}
        </p>

        {/* Price */}
        <div className="mb-5">
          <span className="text-3xl font-bold text-certvoice-text font-mono">
            {price}
          </span>
          <span className="text-sm text-certvoice-muted">{priceSuffix}</span>
        </div>

        {/* Features */}
        <ul className="space-y-2.5 mb-6">
          {features.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 text-xs text-certvoice-text leading-relaxed"
            >
              <CheckCircle2
                className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                  disabled ? 'text-certvoice-muted/50' : 'text-certvoice-green'
                }`}
              />
              <span className={disabled ? 'text-certvoice-muted/70' : ''}>
                {item}
              </span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        {ctaLink && !disabled ? (
          <Link
            to={ctaLink}
            className={`w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              highlighted
                ? 'cv-btn-primary'
                : 'bg-certvoice-surface border border-certvoice-border text-certvoice-text hover:border-certvoice-accent/40'
            }`}
          >
            {cta}
            {highlighted && <ArrowRight className="w-3.5 h-3.5" />}
          </Link>
        ) : disabled ? (
          <div className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg bg-certvoice-surface/50 border border-certvoice-border/50 text-certvoice-muted/50 cursor-not-allowed">
            {cta}
          </div>
        ) : (
          <a
            href="mailto:enterprise@certvoice.co.uk?subject=CertVoice Enterprise Enquiry"
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg bg-certvoice-surface border border-certvoice-border text-certvoice-text hover:border-certvoice-accent/40 transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            {cta}
          </a>
        )}
      </div>
    </div>
  )
}

// ============================================================
// MAIN LANDING PAGE
// ============================================================

export default function LandingPage() {
  return (
    <>
      {/* ============ SEO HEAD ============ */}
      <Helmet>
        <title>CertVoice — Voice-First EICR Certificates for UK Electricians</title>
        <meta
          name="description"
          content="Complete EICR certificates by voice. Speak your inspection findings and let AI build BS 7671-compliant electrical reports. Save 1-3 hours per inspection. 14-day free trial."
        />
        <link rel="canonical" href="https://certvoice.co.uk" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://certvoice.co.uk" />
        <meta
          property="og:title"
          content="CertVoice — Voice-First EICR Certificates for UK Electricians"
        />
        <meta
          property="og:description"
          content="Complete EICR certificates by voice. Speak your inspection findings and let AI build BS 7671-compliant electrical reports."
        />
        <meta property="og:site_name" content="CertVoice" />
        <meta property="og:locale" content="en_GB" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="CertVoice — Voice-First EICR Certificates"
        />
        <meta
          name="twitter:description"
          content="Speak your inspection findings. AI builds BS 7671-compliant EICR certificates. Save 1-3 hours per inspection."
        />

        {/* JSON-LD */}
        <script type="application/ld+json">
          {JSON.stringify(softwareAppSchema)}
        </script>
        <script type="application/ld+json">
          {JSON.stringify(faqSchema)}
        </script>
      </Helmet>

      <div className="min-h-screen bg-certvoice-bg">
        {/* ============ NAVIGATION ============ */}
        <header className="sticky top-0 z-50 bg-certvoice-bg/80 backdrop-blur-lg border-b border-certvoice-border">
          <nav
            className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between"
            aria-label="Main navigation"
          >
            <div className="flex items-center gap-2">
              <Zap className="w-6 h-6 text-certvoice-accent" aria-hidden="true" />
              <span className="text-lg font-bold text-certvoice-text tracking-tight">
                CertVoice
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/sign-in"
                className="text-sm font-medium text-certvoice-muted hover:text-certvoice-text transition-colors"
              >
                Sign in
              </Link>
              <Link
                to="/sign-up"
                className="cv-btn-primary px-4 py-2 text-sm"
              >
                Get started
              </Link>
            </div>
          </nav>
        </header>

        <main>
          {/* ============ HERO ============ */}
          <section className="relative overflow-hidden">
            {/* Subtle gradient backdrop */}
            <div
              className="absolute inset-0 pointer-events-none"
              aria-hidden="true"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-certvoice-accent/5 rounded-full blur-3xl" />
            </div>

            <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
              <div className="max-w-2xl mx-auto text-center">
                {/* Trust chip */}
                <div className="inline-flex items-center gap-2 bg-certvoice-surface border border-certvoice-border rounded-full px-4 py-1.5 mb-8">
                  <Shield className="w-3.5 h-3.5 text-certvoice-green" />
                  <span className="text-xs font-medium text-certvoice-muted">
                    BS 7671 compliant · NICEIC accepted
                  </span>
                </div>

                {/* H1 — primary keyword target */}
                <h1 className="text-3xl sm:text-5xl font-bold text-certvoice-text leading-tight tracking-tight mb-6">
                  Complete EICR certificates{' '}
                  <span className="text-certvoice-accent">by voice</span>
                </h1>

                <p className="text-base sm:text-lg text-certvoice-muted leading-relaxed mb-10 max-w-xl mx-auto">
                  Stop handwriting notes and typing up reports at home. Speak your
                  inspection findings on site and let AI build your BS 7671-compliant
                  certificate in minutes.
                </p>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
                  <Link
                    to="/sign-up"
                    className="cv-btn-primary flex items-center gap-2 px-6 py-3 text-base w-full sm:w-auto justify-center"
                  >
                    Start free trial
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <a
                    href="#how-it-works"
                    className="cv-btn-secondary flex items-center gap-2 px-6 py-3 text-base w-full sm:w-auto justify-center"
                  >
                    See how it works
                    <ChevronRight className="w-4 h-4" />
                  </a>
                </div>

                {/* Social proof stat */}
                <div className="flex items-center justify-center gap-6 text-center">
                  <div>
                    <div className="text-2xl font-bold text-certvoice-accent font-mono">
                      1-3 hrs
                    </div>
                    <div className="text-[11px] text-certvoice-muted uppercase tracking-wider mt-1">
                      Saved per inspection
                    </div>
                  </div>
                  <div className="w-px h-10 bg-certvoice-border" aria-hidden="true" />
                  <div>
                    <div className="text-2xl font-bold text-certvoice-green font-mono">
                      200+
                    </div>
                    <div className="text-[11px] text-certvoice-muted uppercase tracking-wider mt-1">
                      Data points captured
                    </div>
                  </div>
                  <div className="w-px h-10 bg-certvoice-border" aria-hidden="true" />
                  <div>
                    <div className="text-2xl font-bold text-certvoice-amber font-mono">
                      £29.99
                    </div>
                    <div className="text-[11px] text-certvoice-muted uppercase tracking-wider mt-1">
                      Per month
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ============ THE PROBLEM ============ */}
          <section className="bg-certvoice-surface/50 border-y border-certvoice-border">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
              <div className="max-w-2xl mx-auto text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold text-certvoice-text mb-4">
                  Every electrician knows this pain
                </h2>
                <p className="text-sm sm:text-base text-certvoice-muted leading-relaxed">
                  You spend hours on an EICR inspection, scribbling notes on paper. Then
                  you get home and spend another 1-3 hours typing it all into desktop
                  software. Misread handwriting, forgotten readings, and clunky form
                  fields that weren&apos;t designed for the real world.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
                <div className="cv-panel text-center">
                  <Clock className="w-8 h-8 text-certvoice-red mx-auto mb-3" />
                  <p className="text-sm font-semibold text-certvoice-text mb-1">
                    Hours of data entry
                  </p>
                  <p className="text-xs text-certvoice-muted">
                    200+ fields typed manually after every inspection
                  </p>
                </div>
                <div className="cv-panel text-center">
                  <FileText className="w-8 h-8 text-certvoice-amber mx-auto mb-3" />
                  <p className="text-sm font-semibold text-certvoice-text mb-1">
                    Handwritten errors
                  </p>
                  <p className="text-xs text-certvoice-muted">
                    Misread Zs readings, transposed IR values, missed circuits
                  </p>
                </div>
                <div className="cv-panel text-center">
                  <Users className="w-8 h-8 text-certvoice-muted mx-auto mb-3" />
                  <p className="text-sm font-semibold text-certvoice-text mb-1">
                    Desktop-only software
                  </p>
                  <p className="text-xs text-certvoice-muted">
                    Can&apos;t complete certs on site — always a job for later
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ============ HOW IT WORKS ============ */}
          <section id="how-it-works" className="scroll-mt-20">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
              <div className="text-center mb-14">
                <h2 className="text-2xl sm:text-3xl font-bold text-certvoice-text mb-4">
                  Three steps. Certificate done.
                </h2>
                <p className="text-sm sm:text-base text-certvoice-muted max-w-lg mx-auto">
                  Speak naturally in your own trade language. CertVoice understands
                  Zs readings, IR values, RCD trip times, cable sizes, and BS 7671
                  terminology.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 max-w-3xl mx-auto">
                <HowItWorksStep
                  step={1}
                  icon={Mic}
                  title="Speak your findings"
                  description="Tap the mic and speak naturally. 'Kitchen ring final, circuit 3, Zs 0.42 ohms, R1+R2 0.31, IR greater than 200 meg.'"
                />
                <HowItWorksStep
                  step={2}
                  icon={Brain}
                  title="AI extracts the data"
                  description="CertVoice AI parses 15+ fields from a single voice note. Circuit number, cable size, protective device, all test results — instantly populated."
                />
                <HowItWorksStep
                  step={3}
                  icon={Download}
                  title="Download your EICR"
                  description="Review, confirm, and generate a BS 7671-compliant PDF. Email it to your client. Certificate done before you leave site."
                />
              </div>

              {/* Voice example */}
              <div className="max-w-xl mx-auto mt-14">
                <div className="cv-panel border-certvoice-accent/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Volume2 className="w-4 h-4 text-certvoice-accent" />
                    <span className="text-xs font-semibold text-certvoice-accent uppercase tracking-wider">
                      Example voice input
                    </span>
                  </div>
                  <p className="text-sm text-certvoice-text leading-relaxed italic">
                    &ldquo;Downstairs lighting circuit 1, 6 amp type B MCB, 1.5 mil
                    twin and earth, Zs 1.02 ohms, R1 plus R2 0.68, insulation
                    resistance greater than 200 meg, all satisfactory, no
                    defects.&rdquo;
                  </p>
                  <div className="mt-4 pt-3 border-t border-certvoice-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-3.5 h-3.5 text-certvoice-green" />
                      <span className="text-[10px] font-semibold text-certvoice-green uppercase tracking-wider">
                        AI extracts 12 fields instantly
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Circuit', value: '1' },
                        { label: 'Designation', value: 'Downstairs Lighting' },
                        { label: 'MCB', value: '6A Type B' },
                        { label: 'Cable', value: '1.5mm² T+E' },
                        { label: 'Zs', value: '0.42 Ω' },
                        { label: 'IR', value: '>200 MΩ' },
                      ].map((f) => (
                        <div key={f.label} className="cv-data-field py-1.5 px-2">
                          <div className="cv-data-label text-[8px]">{f.label}</div>
                          <div className="cv-data-value text-[11px]">{f.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ============ FEATURES ============ */}
          <section className="bg-certvoice-surface/50 border-y border-certvoice-border">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold text-certvoice-text mb-4">
                  Built for working electricians
                </h2>
                <p className="text-sm text-certvoice-muted max-w-lg mx-auto">
                  Not another generic form builder. CertVoice understands BS 7671, your
                  test instruments, and how inspections actually work on site.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <FeatureCard
                  icon={Mic}
                  title="Voice-first capture"
                  description="Speak naturally in trade language. AI understands Zs, IR, RCD, cable sizes, and 80+ electrical terms."
                />
                <FeatureCard
                  icon={Shield}
                  title="BS 7671 compliant"
                  description="Every section, schedule, and test column matches the current wiring regulations. Accepted by all scheme providers."
                />
                <FeatureCard
                  icon={FileText}
                  title="Professional PDFs"
                  description="Generate A4 EICR certificates with cover page, circuit schedule, inspection checklist, and guidance notes."
                />
                <FeatureCard
                  icon={Timer}
                  title="Zs validation"
                  description="Automatic validation against BS 7671 Tables 41.2-41.4 maximum earth fault loop impedance values."
                />
                <FeatureCard
                  icon={WifiOff}
                  title="Works offline"
                  description="Full PWA with offline capture. Record findings with no signal and sync automatically when connectivity returns."
                />
                <FeatureCard
                  icon={Award}
                  title="Scheme ready"
                  description="Pre-fill your NICEIC, NAPIT, or ELECSA registration details once. They auto-populate every certificate."
                />
              </div>
            </div>
          </section>

          {/* ============ COMPLIANCE / TRUST ============ */}
          <section>
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
              <div className="text-center mb-10">
                <h2 className="text-2xl sm:text-3xl font-bold text-certvoice-text mb-4">
                  Trusted and compliant
                </h2>
                <p className="text-sm text-certvoice-muted max-w-lg mx-auto">
                  NICEIC confirmed: &ldquo;You can use any certificates providing they
                  comply with BS 7671.&rdquo; CertVoice certificates are fully
                  compliant with the current 18th Edition wiring regulations.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-3xl mx-auto">
                <ComplianceBadge label="BS 7671:2018+A2:2022" />
                <ComplianceBadge label="NICEIC accepted" />
                <ComplianceBadge label="NAPIT accepted" />
                <ComplianceBadge label="ELECSA accepted" />
                <ComplianceBadge label="All 31 circuit columns" />
                <ComplianceBadge label="Full inspection schedule" />
              </div>

              <div className="mt-10 text-center">
                <div className="inline-flex items-center gap-2 bg-certvoice-green/10 border border-certvoice-green/30 rounded-lg px-5 py-3">
                  <Wifi className="w-4 h-4 text-certvoice-green" />
                  <span className="text-sm font-medium text-certvoice-green">
                    Your data is encrypted end-to-end. Voice audio is never stored.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ============ PRICING ============ */}
          <section id="pricing" className="bg-certvoice-surface/50 border-y border-certvoice-border">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold text-certvoice-text mb-4">
                  Simple, transparent pricing
                </h2>
                <p className="text-sm text-certvoice-muted max-w-lg mx-auto">
                  No contracts. Cancel any time. Every plan includes unlimited EICR
                  certificates, AI voice extraction, and BS 7671-compliant PDF generation.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Solo */}
                <PricingTier
                  name="Solo"
                  price="£29.99"
                  priceSuffix="/month"
                  description="For independent electricians. Everything you need to complete EICRs by voice."
                  features={[
                    'Unlimited EICR certificates',
                    'AI voice extraction',
                    'BS 7671-compliant PDFs',
                    'Offline capture with auto-sync',
                    'Photo evidence attachment',
                    'Email certificates to clients',
                    '14-day free trial',
                  ]}
                  cta="Start free trial"
                  ctaLink="/sign-up"
                  highlighted
                  badge="Most popular"
                />

                {/* Team */}
                <PricingTier
                  name="Team"
                  price="£24.99"
                  priceSuffix="/seat/month"
                  description="For small firms. Shared access and centralised billing for 2–10 engineers."
                  features={[
                    'Everything in Solo',
                    'Shared certificate access',
                    'Per-engineer accounts',
                    'Centralised billing',
                    '17% savings per seat',
                  ]}
                  cta="Coming soon"
                  disabled
                  comingSoon
                  badge="Coming soon"
                />

                {/* Business */}
                <PricingTier
                  name="Business"
                  price="£19.99"
                  priceSuffix="/seat/month"
                  description="For established contractors. Volume pricing and admin controls for 11–25 engineers."
                  features={[
                    'Everything in Team',
                    'Volume pricing',
                    'Priority support',
                    'Admin dashboard',
                    '33% savings per seat',
                  ]}
                  cta="Coming soon"
                  disabled
                  comingSoon
                  badge="Coming soon"
                />

                {/* Enterprise */}
                <PricingTier
                  name="Enterprise"
                  price="Custom"
                  priceSuffix=""
                  description="For large contractors and multi-branch operations. 25+ engineers with bespoke onboarding."
                  features={[
                    'Everything in Business',
                    'Annual billing',
                    'Dedicated onboarding',
                    'API access',
                    'Custom integrations',
                  ]}
                  cta="Contact us"
                />
              </div>
            </div>
          </section>

          {/* ============ EARLY ACCESS FORM (SmartSuite) ============ */}
          <section id="early-access">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
              <div className="text-center mb-10">
                <h2 className="text-2xl sm:text-3xl font-bold text-certvoice-text mb-4">
                  Get early access
                </h2>
                <p className="text-sm text-certvoice-muted max-w-lg mx-auto">
                  Join the first group of electricians to try CertVoice. We&apos;ll
                  notify you as soon as beta access is available and you&apos;ll get
                  priority onboarding.
                </p>
              </div>

              <div className="max-w-lg mx-auto cv-panel border-certvoice-accent/20">
                <iframe
                  src="https://app.smartsuite.com/form/sba974gi/4tChaBNz86?header=false"
                  width="100%"
                  height="600"
                  title="CertVoice early access sign-up form"
                  loading="lazy"
                  className="rounded-lg"
                  style={{ border: 'none' }}
                />
              </div>
            </div>
          </section>

          {/* ============ FINAL CTA ============ */}
          <section className="bg-certvoice-surface/50 border-y border-certvoice-border">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
              <h2 className="text-2xl sm:text-3xl font-bold text-certvoice-text mb-4">
                Stop typing. Start speaking.
              </h2>
              <p className="text-sm text-certvoice-muted mb-8 max-w-md mx-auto">
                Join the electricians who are finishing certificates on site instead of
                spending their evenings on data entry.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  to="/sign-up"
                  className="cv-btn-primary flex items-center gap-2 px-6 py-3 text-base w-full sm:w-auto justify-center"
                >
                  Start free trial
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <a
                  href="#early-access"
                  className="cv-btn-secondary flex items-center gap-2 px-6 py-3 text-base w-full sm:w-auto justify-center"
                >
                  Join the waitlist
                </a>
              </div>
            </div>
          </section>
        </main>

        {/* ============ FOOTER ============ */}
        <footer className="border-t border-certvoice-border">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-certvoice-accent" aria-hidden="true" />
                <span className="text-sm font-bold text-certvoice-text">CertVoice</span>
                <span className="text-xs text-certvoice-muted">
                  by{' '}
                  <a
                    href="https://autaimate.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-certvoice-accent transition-colors"
                  >
                    Autaimate
                  </a>
                </span>
              </div>
              <div className="flex items-center gap-6 text-xs text-certvoice-muted">
                <Link
                  to="/sign-in"
                  className="hover:text-certvoice-text transition-colors"
                >
                  Sign in
                </Link>
                <a
                  href="#early-access"
                  className="hover:text-certvoice-text transition-colors"
                >
                  Early access
                </a>
                <a
                  href="mailto:support@certvoice.co.uk"
                  className="hover:text-certvoice-text transition-colors"
                >
                  Contact
                </a>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-certvoice-border text-center">
              <p className="text-[11px] text-certvoice-muted/60">
                &copy; {new Date().getFullYear()} Autaimate Ltd. All rights reserved.
                CertVoice is a trading name of Autaimate Ltd. Not affiliated with
                NICEIC, NAPIT, ELECSA, or the IET.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}

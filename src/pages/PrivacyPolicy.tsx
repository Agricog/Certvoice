/**
 * CertVoice — Privacy Policy
 *
 * UK GDPR-compliant privacy policy covering data collection,
 * processing, storage, and user rights.
 *
 * SEO: Canonical URL, meta tags, semantic HTML.
 * Accessible at /privacy.
 *
 * @module pages/PrivacyPolicy
 */

import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { Zap, ArrowLeft } from 'lucide-react'

export default function PrivacyPolicy() {
  return (
    <>
      <Helmet>
        <title>Privacy Policy — CertVoice</title>
        <meta
          name="description"
          content="CertVoice privacy policy. How we collect, use, and protect your data under UK GDPR."
        />
        <link rel="canonical" href="https://certvoice.co.uk/privacy" />
      </Helmet>

      <div className="min-h-screen bg-certvoice-bg">
        {/* Nav */}
        <header className="sticky top-0 z-50 bg-certvoice-bg/80 backdrop-blur-lg border-b border-certvoice-border">
          <nav className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <Zap className="w-6 h-6 text-certvoice-accent" />
              <span className="text-lg font-bold text-certvoice-text tracking-tight">
                CertVoice
              </span>
            </Link>
            <Link
              to="/"
              className="flex items-center gap-1.5 text-sm text-certvoice-muted hover:text-certvoice-text transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
          </nav>
        </header>

        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h1 className="text-2xl sm:text-3xl font-bold text-certvoice-text mb-2">
            Privacy Policy
          </h1>
          <p className="text-sm text-certvoice-muted mb-10">
            Last updated: 15 February 2026
          </p>

          <div className="space-y-8 text-sm text-certvoice-text leading-relaxed">
            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                1. Who we are
              </h2>
              <p>
                CertVoice is a trading name of Autaimate Ltd, a company registered in
                England and Wales. We are the data controller for personal data
                processed through certvoice.co.uk and our associated services.
              </p>
              <p className="mt-2">
                Contact: <a href="mailto:privacy@certvoice.co.uk" className="text-certvoice-accent hover:underline">privacy@certvoice.co.uk</a>
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                2. What data we collect
              </h2>
              <p className="mb-2">
                We collect the following categories of personal data:
              </p>
              <p>
                <span className="font-semibold">Account data:</span> your name, email
                address, phone number, and company details when you register for an
                account via Clerk authentication.
              </p>
              <p className="mt-2">
                <span className="font-semibold">Professional data:</span> your
                registration body, membership number, qualifications, and test
                instrument details that you provide in your engineer profile.
              </p>
              <p className="mt-2">
                <span className="font-semibold">Certificate data:</span> client names,
                installation addresses, inspection findings, circuit test results,
                observations, and photographs that you enter or capture while creating
                EICR certificates.
              </p>
              <p className="mt-2">
                <span className="font-semibold">Voice data:</span> audio recordings
                made through the voice capture feature. Voice audio is processed in
                real time by our AI provider (Anthropic) to extract structured data
                and is not stored after processing is complete.
              </p>
              <p className="mt-2">
                <span className="font-semibold">Payment data:</span> billing
                information processed by Stripe. We do not store card numbers or
                sensitive payment details on our servers.
              </p>
              <p className="mt-2">
                <span className="font-semibold">Technical data:</span> IP address,
                browser type, device information, and usage analytics collected
                automatically when you use the service.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                3. How we use your data
              </h2>
              <p>
                We process your data for the following purposes and legal bases under
                UK GDPR:
              </p>
              <p className="mt-2">
                <span className="font-semibold">Contract performance (Article 6(1)(b)):</span> to
                provide the CertVoice service, generate EICR certificates, process
                voice input, store your certificates, and manage your subscription.
              </p>
              <p className="mt-2">
                <span className="font-semibold">Legitimate interests (Article 6(1)(f)):</span> to
                improve our service, monitor for abuse, ensure security, and provide
                customer support.
              </p>
              <p className="mt-2">
                <span className="font-semibold">Legal obligation (Article 6(1)(c)):</span> to
                comply with tax, accounting, and regulatory requirements.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                4. Where your data is stored
              </h2>
              <p>
                Your data is stored using the following services: Neon (PostgreSQL
                database, EU region), Cloudflare R2 (file storage, EU region), and
                Clerk (authentication). All data is encrypted in transit (TLS) and at
                rest. Voice audio is processed in real time and is not persisted.
              </p>
              <p className="mt-2">
                Some of our processors may transfer data outside the UK. Where this
                occurs, we ensure appropriate safeguards are in place, including
                standard contractual clauses approved by the ICO.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                5. Data sharing
              </h2>
              <p>
                We share your data only with the following categories of processor,
                solely to provide the service: Stripe (payment processing), Clerk
                (authentication), Anthropic (AI voice processing), Cloudflare
                (hosting and storage), and Neon (database). We do not sell your data
                to third parties. We do not share your data for marketing purposes.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                6. Data retention
              </h2>
              <p>
                Account and certificate data is retained for as long as your account
                is active. If you delete your account, we will delete your personal
                data within 30 days, except where retention is required by law (for
                example, financial records retained for 6 years under HMRC
                requirements). Voice audio is not retained after real-time processing.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                7. Your rights
              </h2>
              <p>
                Under UK GDPR, you have the right to access your personal data,
                rectify inaccurate data, erase your data (right to be forgotten),
                restrict processing, data portability, and object to processing. You
                also have the right to withdraw consent at any time where processing
                is based on consent.
              </p>
              <p className="mt-2">
                To exercise any of these rights, contact us at{' '}
                <a href="mailto:privacy@certvoice.co.uk" className="text-certvoice-accent hover:underline">privacy@certvoice.co.uk</a>.
                We will respond within one month.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                8. Cookies
              </h2>
              <p>
                We use essential cookies required for authentication and service
                functionality. We do not use advertising or tracking cookies. Analytics
                cookies, if used, are anonymised and do not identify individual users.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                9. Children
              </h2>
              <p>
                CertVoice is a professional service for qualified electricians. We do
                not knowingly collect data from anyone under the age of 18. If we
                become aware that we have collected data from a minor, we will delete
                it promptly.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                10. Changes to this policy
              </h2>
              <p>
                We may update this policy from time to time. Material changes will be
                notified via email or an in-app notice. Continued use of the service
                after changes constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                11. Complaints
              </h2>
              <p>
                If you are unhappy with how we handle your data, you have the right to
                lodge a complaint with the Information Commissioner&apos;s Office (ICO)
                at{' '}
                <a
                  href="https://ico.org.uk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-certvoice-accent hover:underline"
                >
                  ico.org.uk
                </a>.
              </p>
            </section>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-certvoice-border">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 text-center">
            <p className="text-[11px] text-certvoice-muted/60">
              &copy; {new Date().getFullYear()} Autaimate Ltd. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}

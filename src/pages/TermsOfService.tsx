/**
 * CertVoice — Terms of Service
 *
 * Terms governing use of the CertVoice platform.
 * UK law, England and Wales jurisdiction.
 *
 * SEO: Canonical URL, meta tags, semantic HTML.
 * Accessible at /terms.
 *
 * @module pages/TermsOfService
 */

import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { Zap, ArrowLeft } from 'lucide-react'

export default function TermsOfService() {
  return (
    <>
      <Helmet>
        <title>Terms of Service — CertVoice</title>
        <meta
          name="description"
          content="CertVoice terms of service. Terms governing use of the CertVoice EICR certificate platform."
        />
        <link rel="canonical" href="https://certvoice.co.uk/terms" />
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
            Terms of Service
          </h1>
          <p className="text-sm text-certvoice-muted mb-10">
            Last updated: 15 February 2026
          </p>

          <div className="space-y-8 text-sm text-certvoice-text leading-relaxed">
            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                1. Agreement
              </h2>
              <p>
                These terms govern your use of the CertVoice platform
                (&ldquo;Service&rdquo;), operated by Autaimate Ltd
                (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;), a company
                registered in England and Wales. By creating an account or using the
                Service, you agree to these terms. If you do not agree, do not use the
                Service.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                2. The Service
              </h2>
              <p>
                CertVoice is a software platform that enables qualified electricians
                to create Electrical Installation Condition Reports (EICRs) using
                voice-first data capture and AI-assisted structuring. The Service
                generates PDF certificates designed to comply with BS 7671.
              </p>
              <p className="mt-2">
                The Service is a tool to assist with certificate creation. It does not
                replace professional judgement. You are solely responsible for the
                accuracy, completeness, and correctness of all data entered into
                certificates, whether by voice, manual input, or any other method.
                AI-extracted data should always be reviewed before issuing any
                certificate.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                3. Eligibility
              </h2>
              <p>
                The Service is intended for use by qualified electricians and
                electrical contractors operating in the United Kingdom. By using the
                Service, you represent that you hold appropriate qualifications and
                are competent to carry out electrical inspections and issue EICR
                certificates.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                4. Accounts
              </h2>
              <p>
                You must provide accurate information when creating an account. You
                are responsible for maintaining the confidentiality of your account
                credentials and for all activity under your account. You must notify
                us immediately at{' '}
                <a href="mailto:support@certvoice.co.uk" className="text-certvoice-accent hover:underline">support@certvoice.co.uk</a>{' '}
                if you suspect unauthorised access.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                5. Subscriptions and payment
              </h2>
              <p>
                Access to the Service requires a paid subscription after the free
                trial period. Subscriptions are billed monthly in advance via Stripe.
                Prices are listed on our website in pounds sterling (GBP) and are
                inclusive of VAT where applicable.
              </p>
              <p className="mt-2">
                Your subscription renews automatically at the end of each billing
                period unless cancelled. You may cancel at any time through the Stripe
                billing portal. Cancellation takes effect at the end of the current
                billing period — no refunds are provided for partial periods.
              </p>
              <p className="mt-2">
                We reserve the right to change pricing with 30 days&apos; written
                notice. Price changes take effect at the next renewal date.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                6. Free trial
              </h2>
              <p>
                New accounts receive a 14-day free trial with full access to the
                Service. No payment is required during the trial period. If you do not
                subscribe before the trial ends, your access to paid features will be
                suspended. Your data will be retained for 90 days after trial
                expiration to allow you to subscribe and resume use.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                7. Your responsibilities
              </h2>
              <p>
                You are responsible for verifying all AI-extracted data before issuing
                any certificate. You must ensure that all certificates you issue
                through the Service are accurate and comply with BS 7671 and any
                requirements of your registration body. You must not use the Service
                for any unlawful purpose. You must not attempt to access other
                users&apos; data or interfere with the operation of the Service.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                8. Intellectual property
              </h2>
              <p>
                The CertVoice platform, including its software, design, and
                documentation, is owned by Autaimate Ltd and protected by copyright
                and other intellectual property laws. Your subscription grants you a
                non-exclusive, non-transferable licence to use the Service for its
                intended purpose.
              </p>
              <p className="mt-2">
                You retain ownership of all data you enter into the Service, including
                certificate data, client information, and photographs. We do not claim
                any intellectual property rights over your content.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                9. Limitation of liability
              </h2>
              <p>
                The Service is provided &ldquo;as is&rdquo; and &ldquo;as
                available&rdquo;. To the fullest extent permitted by law, we exclude
                all warranties, whether express or implied, including implied
                warranties of merchantability, fitness for a particular purpose, and
                non-infringement.
              </p>
              <p className="mt-2">
                We are not liable for any loss, damage, or injury arising from your
                use of the Service, the accuracy of AI-generated content, or
                certificates issued using the Service. This includes but is not
                limited to loss of business, loss of data, personal injury, property
                damage, or regulatory penalties.
              </p>
              <p className="mt-2">
                Our total liability to you in any 12-month period shall not exceed the
                amount you paid for the Service during that period. Nothing in these
                terms excludes liability for death or personal injury caused by
                negligence, fraud, or any other liability that cannot be excluded
                under English law.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                10. Service availability
              </h2>
              <p>
                We aim to maintain high availability but do not guarantee uninterrupted
                access. We may suspend the Service for maintenance, updates, or
                circumstances beyond our control. We will provide reasonable notice of
                planned downtime where possible.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                11. Termination
              </h2>
              <p>
                We may suspend or terminate your account if you breach these terms,
                fail to pay subscription fees, or use the Service in a manner that is
                harmful or unlawful. Upon termination, you may request an export of
                your certificate data within 30 days by contacting{' '}
                <a href="mailto:support@certvoice.co.uk" className="text-certvoice-accent hover:underline">support@certvoice.co.uk</a>.
                After 30 days, your data may be deleted.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                12. Changes to these terms
              </h2>
              <p>
                We may update these terms from time to time. Material changes will be
                notified via email or an in-app notice at least 14 days before they
                take effect. Continued use of the Service after changes take effect
                constitutes acceptance of the updated terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                13. Governing law
              </h2>
              <p>
                These terms are governed by the laws of England and Wales. Any disputes
                will be subject to the exclusive jurisdiction of the courts of England
                and Wales.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-certvoice-text mb-3">
                14. Contact
              </h2>
              <p>
                For questions about these terms, contact us at{' '}
                <a href="mailto:support@certvoice.co.uk" className="text-certvoice-accent hover:underline">support@certvoice.co.uk</a>.
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

/**
 * AuthPage — Clerk sign-in / sign-up page
 *
 * Renders Clerk's hosted UI components with CertVoice branding.
 * Supports both /sign-in and /sign-up paths.
 * After auth, redirects to the returnTo location or dashboard.
 */
import { SignIn, SignUp } from '@clerk/clerk-react'
import { useLocation } from 'react-router-dom'

interface AuthPageProps {
  mode: 'sign-in' | 'sign-up'
}

export default function AuthPage({ mode }: AuthPageProps) {
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string })?.returnTo || '/'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-certvoice-bg px-4 py-8">
      {/* Branding header */}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-certvoice-text tracking-tight">
          Cert<span className="text-certvoice-accent">Voice</span>
        </h1>
        <p className="text-sm text-certvoice-muted mt-1">
          Voice-first EICR certificates
        </p>
      </div>

      {/* Clerk auth component */}
      {mode === 'sign-in' ? (
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          forceRedirectUrl={returnTo}
        />
      ) : (
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          forceRedirectUrl={returnTo}
        />
      )}
    </div>
  )
}

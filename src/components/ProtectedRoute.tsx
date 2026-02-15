/**
 * ProtectedRoute — Clerk auth gate for authenticated pages
 *
 * Wraps any route that requires a signed-in user.
 * Shows a loading spinner while Clerk resolves auth state,
 * then either renders children or redirects to sign-in.
 */
import { useAuth } from '@clerk/clerk-react'
import { Navigate, useLocation } from 'react-router-dom'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isSignedIn, isLoaded } = useAuth()
  const location = useLocation()

  // Clerk still resolving — show branded loading state
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-certvoice-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-certvoice-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-certvoice-muted">Loading…</p>
        </div>
      </div>
    )
  }

  // Not signed in — redirect to Clerk hosted sign-in
  // Preserve the intended destination so we can redirect back after sign-in
  if (!isSignedIn) {
    return (
      <Navigate
        to="/sign-in"
        state={{ returnTo: location.pathname + location.search }}
        replace
      />
    )
  }

  return <>{children}</>
}

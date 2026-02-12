export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="cv-panel text-center space-y-4 max-w-sm">
        <div className="w-12 h-12 bg-certvoice-accent rounded-lg flex items-center justify-center mx-auto text-2xl">
          🎤
        </div>
        <h1 className="text-xl font-bold text-certvoice-text">
          CertVoice
        </h1>
        <p className="text-sm text-certvoice-muted">
          Voice-first EICR certificates for UK electricians
        </p>
        <span className="cv-badge-pass inline-block">
          Build Deployed ✓
        </span>
      </div>
    </div>
  )
}

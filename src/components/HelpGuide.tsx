/**
 * CertVoice — Help Guide Component
 *
 * Floating ? button (bottom-right, above BottomNav) that opens
 * a full-screen overlay with context-aware instructions based
 * on the current route.
 *
 * Pages covered:
 *   /dashboard        — Getting started overview
 *   /new              — Creating a new certificate
 *   /inspect/:id      — EICR capture workflow (voice, circuits, observations)
 *   /minor-works/:id  — Minor Works capture workflow
 *   /eic/:id          — EIC capture workflow
 *   /certificates     — Managing certificates
 *   /settings         — Profile & instrument setup
 *   /subscription     — Billing info
 *   default           — General app overview
 *
 * @module components/HelpGuide
 */

import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  HelpCircle,
  X,
  Mic,
  FileText,
  CheckCircle2,
  Zap,
  WifiOff,
  Camera,
  ChevronDown,
  ChevronUp,
  Settings,
  CreditCard,
  PlusCircle,
  ClipboardList,
  Send,
  AlertTriangle,
} from 'lucide-react'

// ============================================================
// TYPES
// ============================================================

interface HelpSection {
  icon: React.ElementType
  title: string
  steps: string[]
  tip?: string
}

interface PageHelp {
  title: string
  intro: string
  sections: HelpSection[]
}

// ============================================================
// HELP CONTENT PER ROUTE
// ============================================================

const HELP_CONTENT: Record<string, PageHelp> = {
  dashboard: {
    title: 'Dashboard',
    intro: 'Your home base. See certificates in progress, recent completions, and quick actions.',
    sections: [
      {
        icon: PlusCircle,
        title: 'Start a New Certificate',
        steps: [
          'Tap the + button in the bottom nav',
          'Choose certificate type: EICR, Minor Works, or EIC',
          'Fill in client and property details',
          'Start capturing — voice, checklist, and photos',
        ],
      },
      {
        icon: FileText,
        title: 'Resume In-Progress Work',
        steps: [
          'Your unfinished certificates appear on the dashboard',
          'Tap any certificate to continue where you left off',
          'All data is saved automatically as you go',
        ],
      },
      {
        icon: WifiOff,
        title: 'Offline Mode',
        steps: [
          'CertVoice works without signal — capture data on site',
          'Data saves to your phone automatically',
          'When you get signal back, everything syncs to the cloud',
          'Look for the sync indicator in the top bar',
        ],
        tip: 'Install CertVoice as an app on your phone for the best offline experience. Your browser will prompt you, or go to Settings > Add to Home Screen.',
      },
    ],
  },

  new: {
    title: 'New Certificate',
    intro: 'Set up the job details before you start capturing. Most of this pre-fills from your profile.',
    sections: [
      {
        icon: ClipboardList,
        title: 'Filling In the Details',
        steps: [
          'Choose certificate type at the top',
          'Section A: Client name and address — who ordered the report',
          'Section B: Reason — periodic inspection, change of occupancy, etc.',
          'Section C: Property details — the address being inspected',
          'Section D: Extent & limitations — what you can and can\'t access',
        ],
        tip: 'Sections A and B often have the same address. Tap "Same as client" to copy it across.',
      },
      {
        icon: Zap,
        title: 'Quick Start',
        steps: [
          'Only client name and property address are required to start',
          'You can fill in the rest during or after the inspection',
          'Tap "Create & Start Inspection" when ready',
        ],
      },
    ],
  },

  inspect: {
    title: 'EICR Capture',
    intro: 'The main inspection workflow. Use voice to capture circuits and observations, the checklist for visual inspection, and photos for evidence.',
    sections: [
      {
        icon: Mic,
        title: 'Voice Capture — Circuits',
        steps: [
          'Tap the microphone button',
          'Speak naturally: "Kitchen ring final, circuit 3, B32 MCB, Zs 0.42, R1+R2 0.31, insulation greater than 200 meg, RCD trips at 22 milliseconds, all satisfactory"',
          'The AI extracts all fields from your speech — 25+ fields from one sentence',
          'Review the extracted data in the grid',
          'Edit any field by tapping it',
          'Tap Confirm to add it to the certificate',
        ],
        tip: 'Speak at a normal pace. The AI understands trade terms: "mil" for mm², "T and E", "meg" for megohms, "B32" for MCB type and rating.',
      },
      {
        icon: AlertTriangle,
        title: 'Voice Capture — Observations',
        steps: [
          'Switch to the Observations tab',
          'Tap the microphone and describe the defect',
          'Example: "Bathroom shaver unit, cracked faceplate exposing live terminals, C2 potentially dangerous"',
          'The AI classifies the code (C1/C2/C3/FI) and suggests the regulation',
          'You can change the classification by tapping the code badge',
          'Add a photo for evidence',
        ],
        tip: 'Any C1 or C2 automatically sets the overall assessment to Unsatisfactory. C3 is advisory only.',
      },
      {
        icon: CheckCircle2,
        title: 'Inspection Checklist',
        steps: [
          'Switch to the Checklist tab',
          'Work through the BS 7671 inspection schedule',
          'Tap each item: Pass, C1, C2, C3, FI, N/V, LIM, or N/A',
          'Items marked C1/C2/C3/FI auto-create observations',
        ],
      },
      {
        icon: Camera,
        title: 'Photos',
        steps: [
          'Tap the camera icon on any observation',
          'Take a photo or choose from your gallery',
          'Photos are linked to the specific observation',
          'Photos work offline and sync when you get signal',
        ],
      },
      {
        icon: FileText,
        title: 'Generate PDF',
        steps: [
          'Once all circuits and observations are captured, go to Review',
          'Check the summary — the app warns if anything is missing',
          'Tap Generate PDF — BS 7671 compliant, A4 format',
          'Download, email to client, or share directly',
        ],
        tip: 'PDFs generate on your phone — no internet needed. You can generate and email later when you have signal.',
      },
    ],
  },

  'minor-works': {
    title: 'Minor Works Capture',
    intro: 'For smaller jobs: socket additions, light fittings, fuse board changes. Simpler form, same voice capture.',
    sections: [
      {
        icon: Mic,
        title: 'Voice Capture',
        steps: [
          'Works exactly the same as EICR voice capture',
          'Speak your circuit details and test results',
          'The AI fills in the single circuit form',
        ],
      },
      {
        icon: FileText,
        title: 'Completing the Certificate',
        steps: [
          'Fill in the description of work',
          'Capture circuit details and test results (voice or manual)',
          'Add the declaration and sign',
          'Generate the PDF',
        ],
        tip: 'Minor Works certificates require Part P notification for notifiable work. The app tracks this for you.',
      },
    ],
  },

  eic: {
    title: 'EIC Capture',
    intro: 'Electrical Installation Certificate for new installations, rewires, and major alterations. Three signatories required.',
    sections: [
      {
        icon: Mic,
        title: 'Voice Capture',
        steps: [
          'Same voice pipeline as EICR — speak naturally, AI extracts',
          'Capture multiple circuits across multiple boards',
          'Add design and departure information',
        ],
      },
      {
        icon: CheckCircle2,
        title: 'Three Signatures',
        steps: [
          'Designer — who designed the installation',
          'Constructor — who installed it',
          'Inspector — who inspected and tested it',
          'These can be the same person for smaller jobs',
        ],
        tip: 'EICs require Part P notification through your scheme provider (NAPIT/NICEIC).',
      },
    ],
  },

  certificates: {
    title: 'Certificates',
    intro: 'View, search, and manage all your completed and in-progress certificates.',
    sections: [
      {
        icon: FileText,
        title: 'Managing Certificates',
        steps: [
          'Search by client name, address, or reference number',
          'Filter by type (EICR, Minor Works, EIC) or status',
          'Tap any certificate to view, edit, or regenerate the PDF',
          'Email certificates directly to clients from the app',
        ],
      },
      {
        icon: Send,
        title: 'Sharing Certificates',
        steps: [
          'Open a completed certificate',
          'Tap Share/Email to send the PDF to the client',
          'Or tap Download to save to your phone',
          'PDF is BS 7671 compliant and accepted by all scheme providers',
        ],
      },
    ],
  },

  settings: {
    title: 'Settings',
    intro: 'Set up your profile once — it auto-fills across all certificates.',
    sections: [
      {
        icon: Settings,
        title: 'What to Set Up',
        steps: [
          'Your name and qualifications',
          'Company name and address',
          'Registration body (NAPIT/NICEIC/ELECSA) and number',
          'Digital signature — draw it once, reused on every certificate',
          'Test instruments — serial numbers and calibration dates',
        ],
        tip: 'Your instrument details auto-fill the test instrument section on every certificate. Update calibration dates when you get instruments recalibrated.',
      },
    ],
  },

  subscription: {
    title: 'Subscription',
    intro: 'Manage your CertVoice Pro subscription and billing.',
    sections: [
      {
        icon: CreditCard,
        title: 'Billing',
        steps: [
          'View your current plan and trial status',
          'Tap Manage Billing to update your card or cancel',
          'Your subscription renews monthly',
          'Cancel anytime — you keep access until the end of the billing period',
        ],
      },
    ],
  },
}

// General fallback for any route not listed
const DEFAULT_HELP: PageHelp = {
  title: 'CertVoice Help',
  intro: 'Voice-first EICR certificates for UK electricians. Speak your findings, get BS 7671-compliant PDFs.',
  sections: [
    {
      icon: Mic,
      title: 'How Voice Capture Works',
      steps: [
        'Tap the microphone button on any capture screen',
        'Speak your test results naturally — the AI knows trade terminology',
        'Review the extracted fields, edit if needed, then confirm',
        'Each voice note can capture 25+ fields in seconds',
      ],
    },
    {
      icon: WifiOff,
      title: 'Works Offline',
      steps: [
        'Capture data on site even with no signal',
        'Everything saves to your phone',
        'Syncs automatically when connectivity returns',
      ],
    },
    {
      icon: FileText,
      title: 'BS 7671 Compliant PDFs',
      steps: [
        'Generated on your phone — no internet needed',
        'Matches IET Appendix 6 model form layout',
        'Email directly to clients from the app',
      ],
    },
  ],
}

// ============================================================
// ROUTE MATCHING
// ============================================================

function getHelpForRoute(pathname: string): PageHelp {
  if (pathname === '/dashboard' || pathname === '/') return HELP_CONTENT.dashboard
  if (pathname === '/new') return HELP_CONTENT.new
  if (pathname.startsWith('/inspect/')) return HELP_CONTENT.inspect
  if (pathname.startsWith('/minor-works/')) return HELP_CONTENT['minor-works']
  if (pathname.startsWith('/eic/')) return HELP_CONTENT.eic
  if (pathname === '/certificates') return HELP_CONTENT.certificates
  if (pathname === '/settings') return HELP_CONTENT.settings
  if (pathname === '/subscription') return HELP_CONTENT.subscription
  return DEFAULT_HELP
}

// ============================================================
// COMPONENT
// ============================================================

export default function HelpGuide() {
  const location = useLocation()
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [expandedSection, setExpandedSection] = useState<number | null>(null)

  // Close help when route changes
  useEffect(() => {
    setIsOpen(false)
    setExpandedSection(null)
  }, [location.pathname])

  // Don't show on public pages
  const publicPaths = ['/', '/sign-in', '/sign-up', '/privacy', '/terms']
  const isPublicPage = publicPaths.some(
    (p) => location.pathname === p || location.pathname.startsWith('/sign-in') || location.pathname.startsWith('/sign-up')
  )
  const isExportPage = location.pathname.startsWith('/export/')
  if (isPublicPage || isExportPage) return null

  const help = getHelpForRoute(location.pathname)

  const toggleSection = (index: number) => {
    setExpandedSection(expandedSection === index ? null : index)
  }

  return (
    <>
      {/* Floating ? button — above BottomNav (pb-20 = 5rem, so bottom-24 clears it) */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-4 z-40 w-11 h-11 rounded-full
                   bg-certvoice-accent text-white shadow-lg shadow-certvoice-accent/25
                   flex items-center justify-center
                   hover:bg-certvoice-accent/90 active:scale-95 transition-all"
        aria-label="Help and instructions"
      >
        <HelpCircle className="w-5 h-5" />
      </button>

      {/* Full-screen overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-certvoice-bg/95 backdrop-blur-sm overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-certvoice-surface border-b border-certvoice-border px-4 py-3">
            <div className="max-w-lg mx-auto flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-certvoice-accent/15 flex items-center justify-center">
                <HelpCircle className="w-4 h-4 text-certvoice-accent" />
              </div>
              <h2 className="flex-1 text-sm font-bold text-certvoice-text">
                {help.title}
              </h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                           text-certvoice-muted hover:text-certvoice-text transition-colors"
                aria-label="Close help"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
            {/* Intro */}
            <p className="text-sm text-certvoice-muted leading-relaxed">
              {help.intro}
            </p>

            {/* Sections — accordion style */}
            {help.sections.map((section, index) => {
              const Icon = section.icon
              const isExpanded = expandedSection === index

              return (
                <div
                  key={section.title}
                  className="bg-certvoice-surface border border-certvoice-border rounded-xl overflow-hidden"
                >
                  {/* Section header — tap to expand */}
                  <button
                    type="button"
                    onClick={() => toggleSection(index)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left
                               hover:bg-certvoice-surface2 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-certvoice-accent/10 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-certvoice-accent" />
                    </div>
                    <span className="flex-1 text-sm font-semibold text-certvoice-text">
                      {section.title}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-certvoice-muted" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-certvoice-muted" />
                    )}
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3">
                      {/* Steps */}
                      <div className="space-y-2 ml-11">
                        {section.steps.map((step, stepIndex) => (
                          <div key={stepIndex} className="flex items-start gap-2">
                            <span className="text-[10px] font-bold text-certvoice-accent bg-certvoice-accent/10
                                             rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                              {stepIndex + 1}
                            </span>
                            <p className="text-xs text-certvoice-muted leading-relaxed">
                              {step}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Tip */}
                      {section.tip && (
                        <div className="ml-11 bg-certvoice-amber/10 border border-certvoice-amber/20
                                        rounded-lg px-3 py-2">
                          <p className="text-[11px] text-certvoice-amber leading-relaxed">
                            <span className="font-bold">Tip:</span> {section.tip}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Footer */}
            <div className="text-center pt-4 pb-8">
              <p className="text-[10px] text-certvoice-muted/50">
                Need more help? Email support@certvoice.co.uk
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

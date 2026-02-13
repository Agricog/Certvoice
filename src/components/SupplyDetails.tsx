/**
 * CertVoice — SupplyDetails Component
 *
 * Sections I & J of the EICR:
 *   - Section I: Supply Characteristics & Earthing Arrangements
 *   - Section J: Installation Particulars
 *
 * Voice capture enabled for supply parameters.
 */

import { useState, useCallback } from 'react'
import {
  Zap,
  ChevronDown,
  ChevronUp,
  Check,
  AlertTriangle,
  Shield,
  Plug,
  Cable,
} from 'lucide-react'
import type {
  SupplyCharacteristics,
  InstallationParticulars,
  EarthingType,
  ConductorConfig,
  ConductorMaterial,
  RCDType,
  BondingStatus,
} from '../types/eicr'
import { sanitizeText } from '../utils/sanitization'
import { captureError } from '../utils/errorTracking'
import { trackFeatureUsed } from '../utils/analytics'
import VoiceCapture from './VoiceCapture'
import { useAIExtraction, type ExtractionContext } from '../hooks/useAIExtraction'

// ─── Types ──────────────────────────────────────────────────────────────────
interface SupplyDetailsProps {
  supply: SupplyCharacteristics
  particulars: InstallationParticulars
  onSupplyChange: (supply: SupplyCharacteristics) => void
  onParticularsChange: (particulars: InstallationParticulars) => void
}

interface SectionState {
  sectionI: boolean
  sectionJ: boolean
  earthElectrode: boolean
  mainSwitch: boolean
  earthingConductor: boolean
  bonding: boolean
}

// ─── Constants ──────────────────────────────────────────────────────────────
const EARTHING_TYPES: { value: EarthingType; label: string }[] = [
  { value: 'TN_C', label: 'TN-C' },
  { value: 'TN_S', label: 'TN-S' },
  { value: 'TN_C_S', label: 'TN-C-S' },
  { value: 'TT', label: 'TT' },
  { value: 'IT', label: 'IT' },
]

const CONDUCTOR_CONFIGS: { value: ConductorConfig; label: string }[] = [
  { value: '1PH_2WIRE', label: '1-phase 2-wire' },
  { value: '2PH_3WIRE', label: '2-phase 3-wire' },
  { value: '3PH_3WIRE', label: '3-phase 3-wire' },
  { value: '3PH_4WIRE', label: '3-phase 4-wire' },
]

const RCD_TYPES: RCDType[] = ['A', 'AC', 'B', 'F', 'S']

const CONDUCTOR_MATERIALS: { value: ConductorMaterial; label: string }[] = [
  { value: 'COPPER', label: 'Copper' },
  { value: 'ALUMINIUM', label: 'Aluminium' },
]

const BONDING_OPTIONS: { value: BondingStatus; label: string }[] = [
  { value: 'SATISFACTORY', label: '✓' },
  { value: 'NA', label: 'N/A' },
]

// ─── Component ──────────────────────────────────────────────────────────────
export default function SupplyDetails({
  supply,
  particulars,
  onSupplyChange,
  onParticularsChange,
}: SupplyDetailsProps) {
  const { extract, status } = useAIExtraction()
  const isExtracting = status === 'extracting'

  const [expanded, setExpanded] = useState<SectionState>({
    sectionI: true,
    sectionJ: false,
    earthElectrode: false,
    mainSwitch: false,
    earthingConductor: false,
    bonding: false,
  })

  // ─── Voice Transcript Handler ───────────────────────────────────────────
  const handleVoiceTranscript = useCallback(
    async (transcript: string, _durationMs: number) => {
      try {
        const context: ExtractionContext = {
          locationContext: 'Supply intake',
          dbContext: '',
          existingCircuits: [],
          earthingType: supply.earthingType,
        }

        const result = await extract(transcript, context)
        if (!result || result.type !== 'supply' || !result.supply) return

        const data = result.supply

        // Map extracted supply fields to SupplyCharacteristics
        const supplyUpdates: Partial<SupplyCharacteristics> = {}

        // Type-safe field mapping
        if ('earthingType' in data && data.earthingType) {
          supplyUpdates.earthingType = data.earthingType as EarthingType
        }
        if ('supplyType' in data && data.supplyType) {
          supplyUpdates.supplyType = data.supplyType === 'AC' ? 'AC' : 'DC'
        }
        if ('conductorConfig' in data && data.conductorConfig) {
          supplyUpdates.conductorConfig = data.conductorConfig as ConductorConfig
        }
        if ('nominalVoltage' in data && data.nominalVoltage !== undefined) {
          supplyUpdates.nominalVoltage = Number(data.nominalVoltage)
        }
        if ('nominalFrequency' in data && data.nominalFrequency !== undefined) {
          supplyUpdates.nominalFrequency = Number(data.nominalFrequency)
        }
        if ('ipf' in data && data.ipf !== undefined) {
          supplyUpdates.ipf = Number(data.ipf)
        }
        if ('ze' in data && data.ze !== undefined) {
          supplyUpdates.ze = Number(data.ze)
        }
        if ('supplyDeviceBsEn' in data && data.supplyDeviceBsEn) {
          supplyUpdates.supplyDeviceBsEn = sanitizeText(String(data.supplyDeviceBsEn))
        }
        if ('supplyDeviceType' in data && data.supplyDeviceType) {
          supplyUpdates.supplyDeviceType = sanitizeText(String(data.supplyDeviceType))
        }
        if ('supplyDeviceRating' in data && data.supplyDeviceRating !== undefined) {
          supplyUpdates.supplyDeviceRating = Number(data.supplyDeviceRating)
        }

        if (Object.keys(supplyUpdates).length > 0) {
          onSupplyChange({ ...supply, ...supplyUpdates })
        }

        // Map extracted particulars fields to InstallationParticulars
        const partUpdates: Partial<InstallationParticulars> = {}

        if ('mainSwitchLocation' in data && data.mainSwitchLocation) {
          partUpdates.mainSwitchLocation = sanitizeText(String(data.mainSwitchLocation))
        }
        if ('mainSwitchBsEn' in data && data.mainSwitchBsEn) {
          partUpdates.mainSwitchBsEn = sanitizeText(String(data.mainSwitchBsEn))
        }
        if ('mainSwitchPoles' in data && data.mainSwitchPoles !== undefined) {
          partUpdates.mainSwitchPoles = Number(data.mainSwitchPoles)
        }
        if ('mainSwitchCurrentRating' in data && data.mainSwitchCurrentRating !== undefined) {
          partUpdates.mainSwitchCurrentRating = Number(data.mainSwitchCurrentRating)
        }
        if ('earthingConductorCsa' in data && data.earthingConductorCsa !== undefined) {
          partUpdates.earthingConductorCsa = Number(data.earthingConductorCsa)
        }
        if ('bondingConductorCsa' in data && data.bondingConductorCsa !== undefined) {
          partUpdates.bondingConductorCsa = Number(data.bondingConductorCsa)
        }

        if (Object.keys(partUpdates).length > 0) {
          onParticularsChange({ ...particulars, ...partUpdates })
        }

        trackFeatureUsed('voice_capture')
      } catch (error) {
        captureError(error, 'SupplyDetails.handleVoiceTranscript')
      }
    },
    [extract, supply, particulars, onSupplyChange, onParticularsChange]
  )

  // ─── Field Helpers ──────────────────────────────────────────────────────
  const updateSupply = (field: keyof SupplyCharacteristics, value: unknown) => {
    onSupplyChange({ ...supply, [field]: value })
  }

  const updateParticulars = (field: keyof InstallationParticulars, value: unknown) => {
    onParticularsChange({ ...particulars, [field]: value })
  }

  const toggleSection = (section: keyof SectionState) => {
    setExpanded((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // ─── Render Helpers ─────────────────────────────────────────────────────
  const renderSectionHeader = (
    title: string,
    section: keyof SectionState,
    icon: React.ReactNode,
    filledCount?: number,
    totalCount?: number
  ) => (
    <button
      type="button"
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between p-4 hover:bg-certvoice-surface-2/50 transition-colors rounded-lg"
    >
      <div className="flex items-center gap-3">
        <span className="text-certvoice-accent">{icon}</span>
        <span className="cv-section-title !mb-0">{title}</span>
        {filledCount !== undefined && totalCount !== undefined && (
          <span
            className={`text-xs font-mono px-2 py-0.5 rounded-full ${
              filledCount === totalCount
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-certvoice-accent/15 text-certvoice-accent'
            }`}
          >
            {filledCount}/{totalCount}
          </span>
        )}
      </div>
      {expanded[section] ? (
        <ChevronUp className="w-4 h-4 text-certvoice-muted" />
      ) : (
        <ChevronDown className="w-4 h-4 text-certvoice-muted" />
      )}
    </button>
  )

  const renderNumberInput = (
    label: string,
    value: number | null | undefined,
    onChange: (val: number | null) => void,
    unit: string,
    placeholder?: string
  ) => (
    <div className="cv-data-field">
      <label className="cv-data-label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="any"
          value={value ?? ''}
          onChange={(e) => {
            const v = e.target.value
            onChange(v === '' ? null : Number(v))
          }}
          placeholder={placeholder}
          className="w-full bg-transparent text-certvoice-text font-mono text-sm outline-none placeholder:text-certvoice-muted/50"
          aria-label={label}
        />
        <span className="text-xs text-certvoice-muted font-mono shrink-0">{unit}</span>
      </div>
    </div>
  )

  const renderTextInput = (
    label: string,
    value: string | undefined,
    onChange: (val: string) => void,
    placeholder?: string
  ) => (
    <div className="cv-data-field">
      <label className="cv-data-label">{label}</label>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(sanitizeText(e.target.value))}
        placeholder={placeholder}
        className="w-full bg-transparent text-certvoice-text text-sm outline-none placeholder:text-certvoice-muted/50"
        aria-label={label}
      />
    </div>
  )

  const renderSelectChips = <T extends string>(
    label: string,
    options: readonly T[] | { value: T; label: string }[],
    selected: T | null | undefined,
    onChange: (val: T) => void
  ) => {
    const items = (options as readonly unknown[]).map((opt) =>
      typeof opt === 'string' ? { value: opt as T, label: opt as string } : (opt as { value: T; label: string })
    )

    return (
      <div>
        <label className="cv-data-label mb-2 block">{label}</label>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                selected === item.value
                  ? 'bg-certvoice-accent/15 border-certvoice-accent text-certvoice-accent'
                  : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const renderTickField = (
    label: string,
    value: boolean | undefined,
    onChange: (val: boolean) => void
  ) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-certvoice-text">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
          value
            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
            : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
        }`}
        aria-label={`${label}: ${value ? 'verified' : 'not verified'}`}
      >
        {value && <Check className="w-4 h-4" />}
      </button>
    </div>
  )

  const renderBondingItem = (
    label: string,
    currentValue: BondingStatus,
    onChange: (val: BondingStatus) => void
  ) => (
    <div className="flex items-center justify-between py-2 border-b border-certvoice-border/50 last:border-0">
      <span className="text-sm text-certvoice-text">{label}</span>
      <div className="flex gap-1">
        {BONDING_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(currentValue === opt.value ? 'UNSATISFACTORY' : opt.value)}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
              currentValue === opt.value
                ? opt.value === 'SATISFACTORY'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-certvoice-surface-2 text-certvoice-muted'
                : 'bg-certvoice-bg text-certvoice-muted/50 hover:text-certvoice-muted'
            }`}
            aria-label={`${label}: ${opt.label}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )

  // ─── Section I field count ──────────────────────────────────────────────
  const sectionIFilled = [
    supply.earthingType,
    supply.supplyType,
    supply.conductorConfig,
    supply.nominalVoltage,
    supply.nominalFrequency,
    supply.ipf,
    supply.ze,
    supply.supplyDeviceRating,
  ].filter((v) => v !== undefined && v !== null).length

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Voice Capture */}
      <div className="cv-panel">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-certvoice-accent" />
          <span className="text-xs font-semibold text-certvoice-accent uppercase tracking-wider">
            Voice Capture — Supply &amp; Installation
          </span>
        </div>
        <p className="text-xs text-certvoice-muted mb-4">
          Say things like: &quot;TN-C-S supply, 230 volts, Ze 0.28 ohms, PFC 1.6 kA,
          100 amp main fuse BS 1361, copper earth 16 mil, 10 mil bonding&quot;
        </p>
        <VoiceCapture
          onTranscript={handleVoiceTranscript}
          locationContext="Supply intake"
          disabled={isExtracting}
          compact
        />
      </div>

      {/* ═══ SECTION I: Supply Characteristics ═══ */}
      <div className="cv-panel !p-0 overflow-hidden">
        {renderSectionHeader(
          'Section I — Supply Characteristics',
          'sectionI',
          <Shield className="w-4 h-4" />,
          sectionIFilled,
          8
        )}

        {expanded.sectionI && (
          <div className="px-4 pb-4 space-y-4">
            {/* Earthing Arrangements */}
            {renderSelectChips('Earthing Type', EARTHING_TYPES, supply.earthingType, (val) =>
              updateSupply('earthingType', val)
            )}

            {/* Supply Type */}
            <div className="grid grid-cols-2 gap-3">
              {renderSelectChips(
                'Supply Type',
                ['AC', 'DC'] as const,
                supply.supplyType,
                (val) => updateSupply('supplyType', val)
              )}
              {renderSelectChips(
                'Conductor Config',
                CONDUCTOR_CONFIGS,
                supply.conductorConfig,
                (val) => updateSupply('conductorConfig', val)
              )}
            </div>

            {renderTickField('Supply Polarity Confirmed', supply.supplyPolarityConfirmed, (val) =>
              updateSupply('supplyPolarityConfirmed', val)
            )}

            {/* Other Sources */}
            <div className="cv-data-field">
              <label className="cv-data-label">Other Sources of Supply</label>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={supply.otherSourcesPresent}
                  onChange={(e) => updateSupply('otherSourcesPresent', e.target.checked)}
                  className="w-4 h-4 rounded border-certvoice-border"
                  aria-label="Other sources present"
                />
                <span className="text-sm text-certvoice-muted">Present</span>
              </div>
              {supply.otherSourcesPresent && (
                <input
                  type="text"
                  value={supply.otherSourcesDescription ?? ''}
                  onChange={(e) => updateSupply('otherSourcesDescription', sanitizeText(e.target.value))}
                  placeholder="e.g. Solar PV 4kW, Battery storage"
                  className="w-full bg-transparent text-certvoice-text text-sm outline-none placeholder:text-certvoice-muted/50"
                  aria-label="Other sources description"
                />
              )}
            </div>

            {/* Supply Parameters */}
            <div className="grid grid-cols-2 gap-3">
              {renderNumberInput('Nominal Voltage', supply.nominalVoltage, (v) => updateSupply('nominalVoltage', v), 'V', '230')}
              {renderNumberInput('Frequency', supply.nominalFrequency, (v) => updateSupply('nominalFrequency', v ?? 50), 'Hz', '50')}
              {renderNumberInput('PFC (Ipf)', supply.ipf, (v) => updateSupply('ipf', v), 'kA', '1.6')}
              {renderNumberInput('Ze', supply.ze, (v) => updateSupply('ze', v), 'Ω', '0.28')}
            </div>

            {/* Supply Protective Device */}
            <div className="border-t border-certvoice-border/50 pt-3">
              <span className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider">
                Supply Protective Device
              </span>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {renderTextInput('BS (EN)', supply.supplyDeviceBsEn, (v) => updateSupply('supplyDeviceBsEn', v), 'BS 1361')}
                {renderTextInput('Type', supply.supplyDeviceType, (v) => updateSupply('supplyDeviceType', v), 'Type 2')}
              </div>
              {renderNumberInput('Rated Current', supply.supplyDeviceRating, (v) => updateSupply('supplyDeviceRating', v), 'A', '100')}
            </div>

            {/* Ze Warning */}
            {supply.ze !== null && supply.ze !== undefined && supply.ze > 0.8 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">
                  Ze of {supply.ze}Ω is high. Verify earthing arrangement. TT systems typically
                  have Ze &gt;20Ω with earth electrode.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ SECTION J: Installation Particulars ═══ */}
      <div className="cv-panel !p-0 overflow-hidden">
        {renderSectionHeader(
          'Section J — Installation Particulars',
          'sectionJ',
          <Plug className="w-4 h-4" />
        )}

        {expanded.sectionJ && (
          <div className="px-4 pb-4 space-y-4">
            {/* Means of Earthing */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider">
                Means of Earthing
              </span>
              {renderTickField("Distributor's Facility", particulars.distributorFacility, (v) =>
                updateParticulars('distributorFacility', v)
              )}
              {renderTickField('Installation Earth Electrode', particulars.installationElectrode, (v) =>
                updateParticulars('installationElectrode', v)
              )}
            </div>

            {/* Earth Electrode Details (conditional) */}
            {particulars.installationElectrode && (
              <div className="cv-panel !bg-certvoice-bg border border-certvoice-border/50 space-y-3">
                <span className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider">
                  Earth Electrode Details
                </span>
                {renderTextInput('Electrode Type', particulars.electrodeType, (v) => updateParticulars('electrodeType', v), 'Rod / Tape / Plate')}
                {renderTextInput('Electrode Location', particulars.electrodeLocation, (v) => updateParticulars('electrodeLocation', v), 'e.g. Front of property')}
                {renderNumberInput('Electrode Resistance', particulars.electrodeResistance ?? null, (v) => updateParticulars('electrodeResistance', v), 'Ω', '28')}
              </div>
            )}

            {/* Main Switch */}
            <div className="border-t border-certvoice-border/50 pt-3 space-y-3">
              <span className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider">
                Main Switch / Circuit-Breaker / RCD
              </span>
              {renderTextInput('Location', particulars.mainSwitchLocation, (v) => updateParticulars('mainSwitchLocation', v), 'e.g. Hallway cupboard')}
              <div className="grid grid-cols-2 gap-3">
                {renderTextInput('BS (EN)', particulars.mainSwitchBsEn, (v) => updateParticulars('mainSwitchBsEn', v), 'BS 60947')}
                {renderNumberInput('Poles', particulars.mainSwitchPoles, (v) => updateParticulars('mainSwitchPoles', v), '', '2')}
                {renderNumberInput('Current Rating', particulars.mainSwitchCurrentRating, (v) => updateParticulars('mainSwitchCurrentRating', v), 'A', '100')}
                {renderNumberInput('Device Rating', particulars.mainSwitchDeviceRating, (v) => updateParticulars('mainSwitchDeviceRating', v), 'A', '80')}
                {renderNumberInput('Voltage Rating', particulars.mainSwitchVoltageRating, (v) => updateParticulars('mainSwitchVoltageRating', v), 'V', '230')}
              </div>

              {/* RCD on main switch */}
              {renderSelectChips('RCD Type (if main switch is RCD)', RCD_TYPES, particulars.mainSwitchRcdType ?? null, (v) =>
                updateParticulars('mainSwitchRcdType', v)
              )}
              {particulars.mainSwitchRcdType && (
                <div className="grid grid-cols-2 gap-3">
                  {renderNumberInput('RCD IΔn', particulars.mainSwitchRcdRating ?? null, (v) => updateParticulars('mainSwitchRcdRating', v), 'mA', '30')}
                  {renderNumberInput('Time Delay', particulars.mainSwitchRcdTimeDelay ?? null, (v) => updateParticulars('mainSwitchRcdTimeDelay', v), 'ms', '0')}
                  {renderNumberInput('Measured Trip Time', particulars.mainSwitchRcdMeasuredTime ?? null, (v) => updateParticulars('mainSwitchRcdMeasuredTime', v), 'ms', '22')}
                </div>
              )}
            </div>

            {/* Earthing Conductor */}
            <div className="border-t border-certvoice-border/50 pt-3 space-y-3">
              <span className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider flex items-center gap-2">
                <Cable className="w-3 h-3" />
                Earthing Conductor
              </span>
              {renderSelectChips('Material', CONDUCTOR_MATERIALS, particulars.earthingConductorMaterial, (v) =>
                updateParticulars('earthingConductorMaterial', v)
              )}
              <div className="grid grid-cols-2 gap-3">
                {renderNumberInput('CSA', particulars.earthingConductorCsa, (v) => updateParticulars('earthingConductorCsa', v), 'mm²', '16')}
              </div>
              {renderTickField('Connection Verified', particulars.earthingConductorVerified, (v) =>
                updateParticulars('earthingConductorVerified', v)
              )}
            </div>

            {/* Main Protective Bonding */}
            <div className="border-t border-certvoice-border/50 pt-3 space-y-3">
              <span className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider">
                Main Protective Bonding Conductors
              </span>
              {renderSelectChips('Material', CONDUCTOR_MATERIALS, particulars.bondingConductorMaterial, (v) =>
                updateParticulars('bondingConductorMaterial', v)
              )}
              <div className="grid grid-cols-2 gap-3">
                {renderNumberInput('CSA', particulars.bondingConductorCsa, (v) => updateParticulars('bondingConductorCsa', v), 'mm²', '10')}
              </div>
              {renderTickField('Connection Verified', particulars.bondingConductorVerified, (v) =>
                updateParticulars('bondingConductorVerified', v)
              )}
            </div>

            {/* Bonding of Extraneous-Conductive-Parts */}
            <div className="border-t border-certvoice-border/50 pt-3 space-y-1">
              <span className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider">
                Bonding of Extraneous-Conductive-Parts
              </span>
              {renderBondingItem('Water Pipes', particulars.bondingWater, (v) =>
                updateParticulars('bondingWater', v)
              )}
              {renderBondingItem('Gas Pipes', particulars.bondingGas, (v) =>
                updateParticulars('bondingGas', v)
              )}
              {renderBondingItem('Oil Pipes', particulars.bondingOil, (v) =>
                updateParticulars('bondingOil', v)
              )}
              {renderBondingItem('Structural Steel', particulars.bondingSteel, (v) =>
                updateParticulars('bondingSteel', v)
              )}
              {renderBondingItem('Lightning Protection', particulars.bondingLightning, (v) =>
                updateParticulars('bondingLightning', v)
              )}
              {renderBondingItem('Other', particulars.bondingOther, (v) =>
                updateParticulars('bondingOther', v)
              )}
              {particulars.bondingOther === 'SATISFACTORY' && (
                <div className="pt-2">
                  {renderTextInput('Other Description', particulars.bondingOtherDescription, (v) => updateParticulars('bondingOtherDescription', v), 'e.g. Central heating')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

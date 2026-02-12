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
} from '../types/eicr'
import { sanitizeText } from '../utils/sanitization'
import { captureError } from '../utils/errorTracking'
import { trackEvent } from '../utils/analytics'
import VoiceCapture from './VoiceCapture'
import { useAIExtraction } from '../hooks/useAIExtraction'

// ─── Types ──────────────────────────────────────────────────────────────────
interface SupplyDetailsProps {
  supply: SupplyCharacteristics
  particulars: InstallationParticulars
  onSupplyChange: (supply: SupplyCharacteristics) => void
  onParticularsChange: (particulars: InstallationParticulars) => void
}

type BondingTarget =
  | 'waterPipes'
  | 'gasPipes'
  | 'oilPipes'
  | 'structuralSteel'
  | 'lightningProtection'

type TickState = 'yes' | 'no' | 'na'

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
  { value: 'TN-C', label: 'TN-C' },
  { value: 'TN-S', label: 'TN-S' },
  { value: 'TN-C-S', label: 'TN-C-S' },
  { value: 'TT', label: 'TT' },
  { value: 'IT', label: 'IT' },
]

const CONDUCTOR_CONFIGS = [
  '1-phase 2-wire',
  '2-phase 3-wire',
  '3-phase 3-wire',
  '3-phase 4-wire',
] as const

const RCD_TYPES = ['A', 'AC', 'B', 'F', 'S'] as const

const CONDUCTOR_MATERIALS = ['Copper', 'Aluminium'] as const

// ─── Component ──────────────────────────────────────────────────────────────
export default function SupplyDetails({
  supply,
  particulars,
  onSupplyChange,
  onParticularsChange,
}: SupplyDetailsProps) {
  const { extract, isExtracting } = useAIExtraction()

  const [expanded, setExpanded] = useState<SectionState>({
    sectionI: true,
    sectionJ: false,
    earthElectrode: false,
    mainSwitch: false,
    earthingConductor: false,
    bonding: false,
  })

  // ─── Voice Transcript Handler ───────────────────────────────────────────
  const handleVoiceResult = useCallback(
    async (transcript: string) => {
      try {
        const result = await extract(transcript, 'supply')
        if (!result || result.type !== 'supply') return

        const data = result.data as Record<string, unknown>

        // Map extracted supply fields
        const supplyUpdates: Partial<SupplyCharacteristics> = {}
        if (data.earthing) supplyUpdates.earthingType = data.earthing as EarthingType
        if (data.supply_type) supplyUpdates.supplyType = data.supply_type === 'AC' ? 'AC' : 'DC'
        if (data.conductor_config) supplyUpdates.conductorConfig = sanitizeText(String(data.conductor_config))
        if (data.voltage) supplyUpdates.nominalVoltage = Number(data.voltage)
        if (data.frequency) supplyUpdates.nominalFrequency = Number(data.frequency)
        if (data.ipf) supplyUpdates.prospectiveFaultCurrent = Number(data.ipf)
        if (data.ze) supplyUpdates.externalEarthFaultLoop = Number(data.ze)
        if (data.supply_fuse_bs) supplyUpdates.supplyProtectiveDeviceBS = sanitizeText(String(data.supply_fuse_bs))
        if (data.supply_fuse_type) supplyUpdates.supplyProtectiveDeviceType = sanitizeText(String(data.supply_fuse_type))
        if (data.supply_fuse_rating) supplyUpdates.supplyProtectiveDeviceRating = Number(data.supply_fuse_rating)

        onSupplyChange({ ...supply, ...supplyUpdates })

        // Map extracted particulars fields
        const partUpdates: Partial<InstallationParticulars> = {}
        if (data.main_switch_location) partUpdates.mainSwitchLocation = sanitizeText(String(data.main_switch_location))
        if (data.main_switch_bs) partUpdates.mainSwitchBS = sanitizeText(String(data.main_switch_bs))
        if (data.main_switch_poles) partUpdates.mainSwitchPoles = Number(data.main_switch_poles)
        if (data.main_switch_current) partUpdates.mainSwitchCurrentRating = Number(data.main_switch_current)
        if (data.earthing_conductor_csa) partUpdates.earthingConductorCSA = Number(data.earthing_conductor_csa)
        if (data.bonding_conductor_csa) partUpdates.bondingConductorCSA = Number(data.bonding_conductor_csa)

        if (Object.keys(partUpdates).length > 0) {
          onParticularsChange({ ...particulars, ...partUpdates })
        }

        trackEvent('supply_voice_extraction', {
          fields_extracted: Object.keys({ ...supplyUpdates, ...partUpdates }).length,
        })
      } catch (error) {
        captureError(error, 'SupplyDetails.handleVoiceResult')
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
      className="w-full flex items-center justify-between p-4 hover:bg-cv-surface-2/50 transition-colors rounded-lg"
    >
      <div className="flex items-center gap-3">
        <span className="text-cv-accent">{icon}</span>
        <span className="cv-section-title !mb-0">{title}</span>
        {filledCount !== undefined && totalCount !== undefined && (
          <span
            className={`text-xs font-mono px-2 py-0.5 rounded-full ${
              filledCount === totalCount
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-cv-accent/15 text-cv-accent'
            }`}
          >
            {filledCount}/{totalCount}
          </span>
        )}
      </div>
      {expanded[section] ? (
        <ChevronUp className="w-4 h-4 text-cv-text-muted" />
      ) : (
        <ChevronDown className="w-4 h-4 text-cv-text-muted" />
      )}
    </button>
  )

  const renderNumberInput = (
    label: string,
    value: number | undefined,
    onChange: (val: number | undefined) => void,
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
            onChange(v === '' ? undefined : Number(v))
          }}
          placeholder={placeholder}
          className="w-full bg-transparent text-cv-text font-mono text-sm outline-none placeholder:text-cv-text-muted/50"
          aria-label={label}
        />
        <span className="text-xs text-cv-text-muted font-mono shrink-0">{unit}</span>
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
        className="w-full bg-transparent text-cv-text text-sm outline-none placeholder:text-cv-text-muted/50"
        aria-label={label}
      />
    </div>
  )

  const renderSelectChips = <T extends string>(
    label: string,
    options: readonly T[] | { value: T; label: string }[],
    selected: T | undefined,
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
                  ? 'bg-cv-accent/15 border-cv-accent text-cv-accent'
                  : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
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
      <span className="text-sm text-cv-text">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
          value
            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
            : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
        }`}
        aria-label={`${label}: ${value ? 'verified' : 'not verified'}`}
      >
        {value && <Check className="w-4 h-4" />}
      </button>
    </div>
  )

  const renderBondingItem = (
    label: string,
    target: BondingTarget,
    state: TickState,
    onChange: (val: TickState) => void
  ) => (
    <div className="flex items-center justify-between py-2 border-b border-cv-border/50 last:border-0">
      <span className="text-sm text-cv-text">{label}</span>
      <div className="flex gap-1">
        {(['yes', 'na'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt === state ? 'no' : opt)}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
              state === opt
                ? opt === 'yes'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-cv-surface-2 text-cv-text-muted'
                : 'bg-cv-bg text-cv-text-muted/50 hover:text-cv-text-muted'
            }`}
            aria-label={`${label}: ${opt}`}
          >
            {opt === 'yes' ? '✓' : 'N/A'}
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
    supply.prospectiveFaultCurrent,
    supply.externalEarthFaultLoop,
    supply.supplyProtectiveDeviceRating,
  ].filter((v) => v !== undefined && v !== '' && v !== null).length

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Voice Capture */}
      <div className="cv-panel">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-cv-accent" />
          <span className="text-xs font-semibold text-cv-accent uppercase tracking-wider">
            Voice Capture — Supply &amp; Installation
          </span>
        </div>
        <p className="text-xs text-cv-text-muted mb-4">
          Say things like: &quot;TN-C-S supply, 230 volts, Ze 0.28 ohms, PFC 1.6 kA,
          100 amp main fuse BS 1361, copper earth 16 mil, 10 mil bonding&quot;
        </p>
        <VoiceCapture
          onResult={handleVoiceResult}
          isProcessing={isExtracting}
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
                supply.conductorConfig as typeof CONDUCTOR_CONFIGS[number] | undefined,
                (val) => updateSupply('conductorConfig', val)
              )}
            </div>

            {renderTickField('Supply Polarity Confirmed', supply.polarityConfirmed, (val) =>
              updateSupply('polarityConfirmed', val)
            )}

            {/* Other Sources */}
            <div className="cv-data-field">
              <label className="cv-data-label">Other Sources of Supply</label>
              <input
                type="text"
                value={supply.otherSourcesOfSupply ?? ''}
                onChange={(e) => updateSupply('otherSourcesOfSupply', sanitizeText(e.target.value))}
                placeholder="e.g. Solar PV 4kW, Battery storage"
                className="w-full bg-transparent text-cv-text text-sm outline-none placeholder:text-cv-text-muted/50"
                aria-label="Other sources of supply"
              />
            </div>

            {/* Supply Parameters */}
            <div className="grid grid-cols-2 gap-3">
              {renderNumberInput('Nominal Voltage', supply.nominalVoltage, (v) => updateSupply('nominalVoltage', v), 'V', '230')}
              {renderNumberInput('Frequency', supply.nominalFrequency, (v) => updateSupply('nominalFrequency', v), 'Hz', '50')}
              {renderNumberInput('PFC (Ipf)', supply.prospectiveFaultCurrent, (v) => updateSupply('prospectiveFaultCurrent', v), 'kA', '1.6')}
              {renderNumberInput('Ze', supply.externalEarthFaultLoop, (v) => updateSupply('externalEarthFaultLoop', v), 'Ω', '0.28')}
            </div>

            {/* Supply Protective Device */}
            <div className="border-t border-cv-border/50 pt-3">
              <span className="text-xs font-semibold text-cv-text-muted uppercase tracking-wider">
                Supply Protective Device
              </span>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {renderTextInput('BS (EN)', supply.supplyProtectiveDeviceBS, (v) => updateSupply('supplyProtectiveDeviceBS', v), 'BS 1361')}
                {renderTextInput('Type', supply.supplyProtectiveDeviceType, (v) => updateSupply('supplyProtectiveDeviceType', v), 'Type 2')}
              </div>
              {renderNumberInput('Rated Current', supply.supplyProtectiveDeviceRating, (v) => updateSupply('supplyProtectiveDeviceRating', v), 'A', '100')}
            </div>

            {/* Ze Warning */}
            {supply.externalEarthFaultLoop !== undefined && supply.externalEarthFaultLoop > 0.8 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">
                  Ze of {supply.externalEarthFaultLoop}Ω is high. Verify earthing arrangement. TT systems typically
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
              <span className="text-xs font-semibold text-cv-text-muted uppercase tracking-wider">
                Means of Earthing
              </span>
              {renderTickField("Distributor's Facility", particulars.distributorEarthFacility, (v) =>
                updateParticulars('distributorEarthFacility', v)
              )}
              {renderTickField('Installation Earth Electrode', particulars.installationEarthElectrode, (v) =>
                updateParticulars('installationEarthElectrode', v)
              )}
            </div>

            {/* Earth Electrode Details (conditional) */}
            {particulars.installationEarthElectrode && (
              <div className="cv-panel !bg-cv-bg border border-cv-border/50 space-y-3">
                <span className="text-xs font-semibold text-cv-text-muted uppercase tracking-wider">
                  Earth Electrode Details
                </span>
                {renderTextInput('Electrode Type', particulars.electrodeType, (v) => updateParticulars('electrodeType', v), 'Rod / Tape / Plate')}
                {renderTextInput('Electrode Location', particulars.electrodeLocation, (v) => updateParticulars('electrodeLocation', v), 'e.g. Front of property')}
                {renderNumberInput('Electrode Resistance', particulars.electrodeResistance, (v) => updateParticulars('electrodeResistance', v), 'Ω', '28')}
              </div>
            )}

            {/* Main Switch */}
            <div className="border-t border-cv-border/50 pt-3 space-y-3">
              <span className="text-xs font-semibold text-cv-text-muted uppercase tracking-wider">
                Main Switch / Circuit-Breaker / RCD
              </span>
              {renderTextInput('Location', particulars.mainSwitchLocation, (v) => updateParticulars('mainSwitchLocation', v), 'e.g. Hallway cupboard')}
              <div className="grid grid-cols-2 gap-3">
                {renderTextInput('BS (EN)', particulars.mainSwitchBS, (v) => updateParticulars('mainSwitchBS', v), 'BS 60947')}
                {renderNumberInput('Poles', particulars.mainSwitchPoles, (v) => updateParticulars('mainSwitchPoles', v), '', '2')}
                {renderNumberInput('Current Rating', particulars.mainSwitchCurrentRating, (v) => updateParticulars('mainSwitchCurrentRating', v), 'A', '100')}
                {renderNumberInput('Device Rating', particulars.mainSwitchDeviceRating, (v) => updateParticulars('mainSwitchDeviceRating', v), 'A', '80')}
                {renderNumberInput('Voltage Rating', particulars.mainSwitchVoltageRating, (v) => updateParticulars('mainSwitchVoltageRating', v), 'V', '230')}
              </div>

              {/* RCD on main switch */}
              {renderSelectChips('RCD Type (if main switch is RCD)', RCD_TYPES, particulars.mainSwitchRCDType as typeof RCD_TYPES[number] | undefined, (v) =>
                updateParticulars('mainSwitchRCDType', v)
              )}
              {particulars.mainSwitchRCDType && (
                <div className="grid grid-cols-2 gap-3">
                  {renderNumberInput('RCD IΔn', particulars.mainSwitchRCDRating, (v) => updateParticulars('mainSwitchRCDRating', v), 'mA', '30')}
                  {renderNumberInput('Time Delay', particulars.mainSwitchRCDTimeDelay, (v) => updateParticulars('mainSwitchRCDTimeDelay', v), 'ms', '0')}
                  {renderNumberInput('Measured Trip Time', particulars.mainSwitchRCDMeasuredTime, (v) => updateParticulars('mainSwitchRCDMeasuredTime', v), 'ms', '22')}
                </div>
              )}
            </div>

            {/* Earthing Conductor */}
            <div className="border-t border-cv-border/50 pt-3 space-y-3">
              <span className="text-xs font-semibold text-cv-text-muted uppercase tracking-wider flex items-center gap-2">
                <Cable className="w-3 h-3" />
                Earthing Conductor
              </span>
              {renderSelectChips('Material', CONDUCTOR_MATERIALS, particulars.earthingConductorMaterial as typeof CONDUCTOR_MATERIALS[number] | undefined, (v) =>
                updateParticulars('earthingConductorMaterial', v)
              )}
              <div className="grid grid-cols-2 gap-3">
                {renderNumberInput('CSA', particulars.earthingConductorCSA, (v) => updateParticulars('earthingConductorCSA', v), 'mm²', '16')}
              </div>
              {renderTickField('Connection Verified', particulars.earthingConductorVerified, (v) =>
                updateParticulars('earthingConductorVerified', v)
              )}
            </div>

            {/* Main Protective Bonding */}
            <div className="border-t border-cv-border/50 pt-3 space-y-3">
              <span className="text-xs font-semibold text-cv-text-muted uppercase tracking-wider">
                Main Protective Bonding Conductors
              </span>
              {renderSelectChips('Material', CONDUCTOR_MATERIALS, particulars.bondingConductorMaterial as typeof CONDUCTOR_MATERIALS[number] | undefined, (v) =>
                updateParticulars('bondingConductorMaterial', v)
              )}
              <div className="grid grid-cols-2 gap-3">
                {renderNumberInput('CSA', particulars.bondingConductorCSA, (v) => updateParticulars('bondingConductorCSA', v), 'mm²', '10')}
              </div>
              {renderTickField('Connection Verified', particulars.bondingConductorVerified, (v) =>
                updateParticulars('bondingConductorVerified', v)
              )}
            </div>

            {/* Bonding of Extraneous-Conductive-Parts */}
            <div className="border-t border-cv-border/50 pt-3 space-y-1">
              <span className="text-xs font-semibold text-cv-text-muted uppercase tracking-wider">
                Bonding of Extraneous-Conductive-Parts
              </span>
              {renderBondingItem('Water Pipes', 'waterPipes', particulars.bondingWater ?? 'no', (v) =>
                updateParticulars('bondingWater', v)
              )}
              {renderBondingItem('Gas Pipes', 'gasPipes', particulars.bondingGas ?? 'no', (v) =>
                updateParticulars('bondingGas', v)
              )}
              {renderBondingItem('Oil Pipes', 'oilPipes', particulars.bondingOil ?? 'no', (v) =>
                updateParticulars('bondingOil', v)
              )}
              {renderBondingItem('Structural Steel', 'structuralSteel', particulars.bondingSteel ?? 'no', (v) =>
                updateParticulars('bondingSteel', v)
              )}
              {renderBondingItem('Lightning Protection', 'lightningProtection', particulars.bondingLightning ?? 'no', (v) =>
                updateParticulars('bondingLightning', v)
              )}
              {renderTextInput('Other (specify)', particulars.bondingOther, (v) => updateParticulars('bondingOther', v), 'e.g. Central heating')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

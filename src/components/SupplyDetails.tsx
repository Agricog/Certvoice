import { useState, useCallback } from 'react';
import {
  Zap,
  Shield,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Mic,
  Edit3,
  RotateCcw,
} from 'lucide-react';
import VoiceCapture from './VoiceCapture';
import { useAIExtraction } from '../hooks/useAIExtraction';
import { sanitizeText } from '../utils/sanitization';
import { captureError } from '../utils/errorTracking';
import { trackVoiceEvent } from '../utils/analytics';
import type {
  SupplyCharacteristics,
  InstallationParticulars,
  EarthingType,
  SupplyType,
} from '../types/eicr';
import type { AIExtractionResult } from '../types/api';

// ─── Constants ───────────────────────────────────────────────────────────────

const EARTHING_TYPES: { value: EarthingType; label: string }[] = [
  { value: 'TN-C', label: 'TN-C' },
  { value: 'TN-S', label: 'TN-S' },
  { value: 'TN-C-S', label: 'TN-C-S' },
  { value: 'TT', label: 'TT' },
  { value: 'IT', label: 'IT' },
];

const SUPPLY_TYPES: { value: SupplyType; label: string }[] = [
  { value: '1-phase-2-wire', label: '1-phase 2-wire' },
  { value: '2-phase-3-wire', label: '2-phase 3-wire' },
  { value: '3-phase-3-wire', label: '3-phase 3-wire' },
  { value: '3-phase-4-wire', label: '3-phase 4-wire' },
];

const RCD_TYPES = ['A', 'AC', 'B', 'F', 'S'] as const;

const BONDING_SERVICES = [
  { key: 'water', label: 'Water Pipes' },
  { key: 'gas', label: 'Gas Pipes' },
  { key: 'oil', label: 'Oil Pipes' },
  { key: 'structural_steel', label: 'Structural Steel' },
  { key: 'lightning', label: 'Lightning Protection' },
] as const;

const EARTHING_MEANS = [
  { key: 'distributor', label: "Distributor's Facility" },
  { key: 'electrode', label: 'Installation Earth Electrode' },
] as const;

const CONDUCTOR_MATERIALS = ['Copper', 'Aluminium'] as const;

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface SupplyDetailsProps {
  supply: SupplyCharacteristics;
  particulars: InstallationParticulars;
  onSupplyChange: (supply: SupplyCharacteristics) => void;
  onParticularsChange: (particulars: InstallationParticulars) => void;
  readonly?: boolean;
}

type SectionId = 'earthing' | 'supply_params' | 'supply_device' | 'main_switch' | 'earthing_conductor' | 'bonding';

// ─── Component ───────────────────────────────────────────────────────────────

export default function SupplyDetails({
  supply,
  particulars,
  onSupplyChange,
  onParticularsChange,
  readonly = false,
}: SupplyDetailsProps): JSX.Element {
  const [expandedSections, setExpandedSections] = useState<Set<SectionId>>(
    new Set(['earthing', 'supply_params'])
  );
  const [showVoice, setShowVoice] = useState<boolean>(false);
  const [lastTranscript, setLastTranscript] = useState<string>('');

  const { extract, isExtracting, error: extractionError } = useAIExtraction();

  // ─── Section Toggle ──────────────────────────────────────────────────────

  const toggleSection = useCallback((sectionId: SectionId): void => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const isSectionExpanded = useCallback(
    (sectionId: SectionId): boolean => expandedSections.has(sectionId),
    [expandedSections]
  );

  // ─── Voice Handling ──────────────────────────────────────────────────────

  const handleVoiceResult = useCallback(
    async (transcript: string): Promise<void> => {
      try {
        const sanitized = sanitizeText(transcript);
        if (!sanitized || sanitized.length < 3) return;

        setLastTranscript(sanitized);
        trackVoiceEvent('supply_voice_capture', sanitized.length);

        const result: AIExtractionResult = await extract(sanitized, 'supply');

        if (result.type === 'supply' && result.data) {
          const data = result.data as Record<string, unknown>;

          // Map extracted supply data
          const supplyUpdates: Partial<SupplyCharacteristics> = {};

          if (data.earthing && typeof data.earthing === 'string') {
            const earthingMatch = EARTHING_TYPES.find(
              (e) => e.value.toLowerCase() === (data.earthing as string).toLowerCase()
            );
            if (earthingMatch) {
              supplyUpdates.earthingType = earthingMatch.value;
            }
          }

          if (data.voltage !== undefined && typeof data.voltage === 'number') {
            supplyUpdates.nominalVoltage = data.voltage;
          }

          if (data.frequency !== undefined && typeof data.frequency === 'number') {
            supplyUpdates.nominalFrequency = data.frequency;
          }

          if (data.ze !== undefined && typeof data.ze === 'number') {
            supplyUpdates.ze = data.ze;
          }

          if (data.ipf !== undefined && typeof data.ipf === 'number') {
            supplyUpdates.ipf = data.ipf;
          }

          if (data.supply_fuse_rating !== undefined && typeof data.supply_fuse_rating === 'number') {
            supplyUpdates.supplyFuseRating = data.supply_fuse_rating;
          }

          if (data.supply_fuse_type && typeof data.supply_fuse_type === 'string') {
            supplyUpdates.supplyFuseType = sanitizeText(data.supply_fuse_type);
          }

          if (data.supply_fuse_bs && typeof data.supply_fuse_bs === 'string') {
            supplyUpdates.supplyFuseBsEn = sanitizeText(data.supply_fuse_bs);
          }

          if (data.supply_type && typeof data.supply_type === 'string') {
            const supplyTypeMatch = SUPPLY_TYPES.find(
              (s) => s.value.toLowerCase() === (data.supply_type as string).toLowerCase()
            );
            if (supplyTypeMatch) {
              supplyUpdates.conductorConfig = supplyTypeMatch.value;
            }
          }

          if (Object.keys(supplyUpdates).length > 0) {
            onSupplyChange({ ...supply, ...supplyUpdates });
          }

          // Map extracted particulars data
          const partUpdates: Partial<InstallationParticulars> = {};

          if (data.main_switch_rating !== undefined && typeof data.main_switch_rating === 'number') {
            partUpdates.mainSwitchRating = data.main_switch_rating;
          }

          if (data.main_switch_poles !== undefined && typeof data.main_switch_poles === 'number') {
            partUpdates.mainSwitchPoles = data.main_switch_poles;
          }

          if (data.main_switch_location && typeof data.main_switch_location === 'string') {
            partUpdates.mainSwitchLocation = sanitizeText(data.main_switch_location);
          }

          if (data.earthing_conductor_csa !== undefined && typeof data.earthing_conductor_csa === 'number') {
            partUpdates.earthingConductorCsa = data.earthing_conductor_csa;
          }

          if (data.bonding_conductor_csa !== undefined && typeof data.bonding_conductor_csa === 'number') {
            partUpdates.bondingConductorCsa = data.bonding_conductor_csa;
          }

          if (Object.keys(partUpdates).length > 0) {
            onParticularsChange({ ...particulars, ...partUpdates });
          }
        }
      } catch (err) {
        captureError(err, 'SupplyDetails.handleVoiceResult');
      }
    },
    [extract, supply, particulars, onSupplyChange, onParticularsChange]
  );

  // ─── Field Helpers ───────────────────────────────────────────────────────

  const updateSupplyField = useCallback(
    <K extends keyof SupplyCharacteristics>(
      field: K,
      value: SupplyCharacteristics[K]
    ): void => {
      onSupplyChange({ ...supply, [field]: value });
    },
    [supply, onSupplyChange]
  );

  const updateParticularsField = useCallback(
    <K extends keyof InstallationParticulars>(
      field: K,
      value: InstallationParticulars[K]
    ): void => {
      onParticularsChange({ ...particulars, [field]: value });
    },
    [particulars, onParticularsChange]
  );

  const parseNumericInput = (value: string): number | undefined => {
    if (value === '' || value === '-') return undefined;
    const num = parseFloat(value);
    return isNaN(num) ? undefined : num;
  };

  // ─── Completion Stats ────────────────────────────────────────────────────

  const getCompletionCount = (): { filled: number; total: number } => {
    let filled = 0;
    const total = 12;

    if (supply.earthingType) filled++;
    if (supply.conductorConfig) filled++;
    if (supply.nominalVoltage) filled++;
    if (supply.nominalFrequency) filled++;
    if (supply.ze !== undefined) filled++;
    if (supply.ipf !== undefined) filled++;
    if (supply.supplyFuseRating) filled++;
    if (particulars.mainSwitchRating) filled++;
    if (particulars.mainSwitchLocation) filled++;
    if (particulars.earthingConductorCsa) filled++;
    if (particulars.bondingConductorCsa) filled++;
    if (particulars.meansOfEarthing) filled++;

    return { filled, total };
  };

  const completion = getCompletionCount();

  // ─── Section Renderer ────────────────────────────────────────────────────

  const renderSectionHeader = (
    id: SectionId,
    icon: JSX.Element,
    title: string,
    subtitle: string
  ): JSX.Element => (
    <button
      type="button"
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between p-4 text-left hover:bg-cv-surface-2/50 transition-colors rounded-lg"
      aria-expanded={isSectionExpanded(id)}
      aria-controls={`section-${id}`}
    >
      <div className="flex items-center gap-3">
        <div className="text-cv-accent">{icon}</div>
        <div>
          <h3 className="text-sm font-semibold text-cv-text">{title}</h3>
          <p className="text-xs text-cv-text-muted mt-0.5">{subtitle}</p>
        </div>
      </div>
      {isSectionExpanded(id) ? (
        <ChevronUp className="w-4 h-4 text-cv-text-muted" />
      ) : (
        <ChevronDown className="w-4 h-4 text-cv-text-muted" />
      )}
    </button>
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header with completion and voice toggle */}
      <div className="cv-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-cv-text flex items-center gap-2">
              <Zap className="w-5 h-5 text-cv-accent" />
              Supply &amp; Installation Details
            </h2>
            <p className="text-xs text-cv-text-muted mt-1">
              Sections I &amp; J — Captured on arrival at the property
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="cv-badge-pass text-xs">
              {completion.filled}/{completion.total}
            </span>
          </div>
        </div>

        {/* Completion bar */}
        <div className="w-full bg-cv-border rounded-full h-1.5 mb-3">
          <div
            className="bg-cv-accent h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${(completion.filled / completion.total) * 100}%` }}
          />
        </div>

        {/* Voice capture toggle */}
        {!readonly && (
          <button
            type="button"
            onClick={() => setShowVoice(!showVoice)}
            className="cv-btn-secondary w-full flex items-center justify-center gap-2 text-sm"
          >
            <Mic className="w-4 h-4" />
            {showVoice ? 'Hide Voice Capture' : 'Voice Capture — Speak Supply Details'}
          </button>
        )}
      </div>

      {/* Voice Capture Panel */}
      {showVoice && !readonly && (
        <div className="cv-panel p-4">
          <VoiceCapture
            onResult={handleVoiceResult}
            compact
          />
          {isExtracting && (
            <div className="flex items-center gap-2 mt-3 text-cv-amber text-xs">
              <RotateCcw className="w-3 h-3 animate-spin" />
              Extracting supply details from voice...
            </div>
          )}
          {extractionError && (
            <div className="flex items-center gap-2 mt-3 text-cv-red text-xs">
              <AlertTriangle className="w-3 h-3" />
              {extractionError}
            </div>
          )}
          {lastTranscript && !isExtracting && !extractionError && (
            <div className="mt-3 p-3 bg-cv-bg rounded-lg border border-cv-border">
              <p className="text-xs text-cv-text-muted mb-1 uppercase font-semibold tracking-wider">
                Last transcript
              </p>
              <p className="text-xs text-cv-text font-mono leading-relaxed">
                {lastTranscript}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ─── Section I: Supply Characteristics ──────────────────────────── */}

      <div className="cv-panel overflow-hidden">
        {/* Earthing Arrangements */}
        {renderSectionHeader(
          'earthing',
          <Shield className="w-4 h-4" />,
          'Earthing Arrangements',
          'Earthing type and live conductor configuration'
        )}
        {isSectionExpanded('earthing') && (
          <div id="section-earthing" className="px-4 pb-4 space-y-4">
            {/* Earthing Type */}
            <div>
              <label className="cv-data-label">Earthing Type *</label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {EARTHING_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => !readonly && updateSupplyField('earthingType', type.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                      supply.earthingType === type.value
                        ? 'bg-cv-accent/15 border-cv-accent text-cv-accent'
                        : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                    } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                    aria-pressed={supply.earthingType === type.value}
                    disabled={readonly}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* AC/DC */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="cv-data-label">Supply</label>
                <div className="flex gap-2 mt-1.5">
                  {(['AC', 'DC'] as const).map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => !readonly && updateSupplyField('acDc', val)}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                        supply.acDc === val
                          ? 'bg-cv-accent/15 border-cv-accent text-cv-accent'
                          : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                      } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                      aria-pressed={supply.acDc === val}
                      disabled={readonly}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Polarity Confirmed */}
              <div>
                <label className="cv-data-label">Supply Polarity</label>
                <button
                  type="button"
                  onClick={() =>
                    !readonly &&
                    updateSupplyField('supplyPolarityConfirmed', !supply.supplyPolarityConfirmed)
                  }
                  className={`mt-1.5 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    supply.supplyPolarityConfirmed
                      ? 'bg-cv-green/15 border-cv-green text-cv-green'
                      : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                  } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                  aria-pressed={supply.supplyPolarityConfirmed}
                  disabled={readonly}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {supply.supplyPolarityConfirmed ? 'Confirmed' : 'Confirm'}
                </button>
              </div>
            </div>

            {/* Conductor Configuration */}
            <div>
              <label className="cv-data-label">Conductor Configuration</label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {SUPPLY_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => !readonly && updateSupplyField('conductorConfig', type.value)}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                      supply.conductorConfig === type.value
                        ? 'bg-cv-accent/15 border-cv-accent text-cv-accent'
                        : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                    } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                    aria-pressed={supply.conductorConfig === type.value}
                    disabled={readonly}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Other Sources */}
            <div>
              <label className="cv-data-label">Other Sources of Supply</label>
              <input
                type="text"
                value={supply.otherSources ?? ''}
                onChange={(e) =>
                  updateSupplyField('otherSources', sanitizeText(e.target.value))
                }
                placeholder="e.g. Solar PV 4kW, battery storage"
                className="cv-data-field w-full mt-1.5"
                maxLength={200}
                readOnly={readonly}
                aria-label="Other sources of supply"
              />
            </div>
          </div>
        )}

        {/* Supply Parameters */}
        {renderSectionHeader(
          'supply_params',
          <Zap className="w-4 h-4" />,
          'Supply Parameters',
          'Voltage, frequency, PFC, Ze'
        )}
        {isSectionExpanded('supply_params') && (
          <div id="section-supply_params" className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              {/* Nominal Voltage */}
              <div>
                <label className="cv-data-label">Voltage (V)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={supply.nominalVoltage ?? ''}
                  onChange={(e) =>
                    updateSupplyField('nominalVoltage', parseNumericInput(e.target.value))
                  }
                  placeholder="230"
                  className="cv-data-field w-full mt-1.5"
                  min={0}
                  max={1000}
                  step={1}
                  readOnly={readonly}
                  aria-label="Nominal voltage"
                />
              </div>

              {/* Frequency */}
              <div>
                <label className="cv-data-label">Frequency (Hz)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={supply.nominalFrequency ?? ''}
                  onChange={(e) =>
                    updateSupplyField('nominalFrequency', parseNumericInput(e.target.value))
                  }
                  placeholder="50"
                  className="cv-data-field w-full mt-1.5"
                  min={0}
                  max={100}
                  step={1}
                  readOnly={readonly}
                  aria-label="Nominal frequency"
                />
              </div>

              {/* PFC */}
              <div>
                <label className="cv-data-label">PFC Ipf (kA)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={supply.ipf ?? ''}
                  onChange={(e) =>
                    updateSupplyField('ipf', parseNumericInput(e.target.value))
                  }
                  placeholder="1.6"
                  className="cv-data-field w-full mt-1.5"
                  min={0}
                  max={100}
                  step={0.01}
                  readOnly={readonly}
                  aria-label="Prospective fault current"
                />
              </div>

              {/* Ze */}
              <div>
                <label className="cv-data-label">Ze (Ω)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={supply.ze ?? ''}
                  onChange={(e) =>
                    updateSupplyField('ze', parseNumericInput(e.target.value))
                  }
                  placeholder="0.35"
                  className="cv-data-field w-full mt-1.5"
                  min={0}
                  max={100}
                  step={0.01}
                  readOnly={readonly}
                  aria-label="External earth fault loop impedance"
                />
              </div>
            </div>
          </div>
        )}

        {/* Supply Protective Device */}
        {renderSectionHeader(
          'supply_device',
          <Shield className="w-4 h-4" />,
          'Supply Protective Device',
          'Main fuse BS, type, rating'
        )}
        {isSectionExpanded('supply_device') && (
          <div id="section-supply_device" className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="cv-data-label">BS (EN)</label>
                <input
                  type="text"
                  value={supply.supplyFuseBsEn ?? ''}
                  onChange={(e) =>
                    updateSupplyField('supplyFuseBsEn', sanitizeText(e.target.value))
                  }
                  placeholder="BS 1361"
                  className="cv-data-field w-full mt-1.5"
                  maxLength={50}
                  readOnly={readonly}
                  aria-label="Supply fuse BS EN standard"
                />
              </div>
              <div>
                <label className="cv-data-label">Type</label>
                <input
                  type="text"
                  value={supply.supplyFuseType ?? ''}
                  onChange={(e) =>
                    updateSupplyField('supplyFuseType', sanitizeText(e.target.value))
                  }
                  placeholder="Type 2 fuse"
                  className="cv-data-field w-full mt-1.5"
                  maxLength={50}
                  readOnly={readonly}
                  aria-label="Supply fuse type"
                />
              </div>
              <div className="col-span-2">
                <label className="cv-data-label">Rated Current (A)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={supply.supplyFuseRating ?? ''}
                  onChange={(e) =>
                    updateSupplyField('supplyFuseRating', parseNumericInput(e.target.value))
                  }
                  placeholder="100"
                  className="cv-data-field w-full mt-1.5"
                  min={0}
                  max={1000}
                  step={1}
                  readOnly={readonly}
                  aria-label="Supply fuse rated current"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Section J: Installation Particulars ────────────────────────── */}

      <div className="cv-panel overflow-hidden">
        {/* Main Switch */}
        {renderSectionHeader(
          'main_switch',
          <Zap className="w-4 h-4" />,
          'Main Switch / Switch-Fuse',
          'Location, type, rating, RCD details'
        )}
        {isSectionExpanded('main_switch') && (
          <div id="section-main_switch" className="px-4 pb-4 space-y-3">
            {/* Location */}
            <div>
              <label className="cv-data-label">Location</label>
              <input
                type="text"
                value={particulars.mainSwitchLocation ?? ''}
                onChange={(e) =>
                  updateParticularsField(
                    'mainSwitchLocation',
                    sanitizeText(e.target.value)
                  )
                }
                placeholder="e.g. Hallway cupboard under stairs"
                className="cv-data-field w-full mt-1.5"
                maxLength={200}
                readOnly={readonly}
                aria-label="Main switch location"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="cv-data-label">BS (EN)</label>
                <input
                  type="text"
                  value={particulars.mainSwitchBsEn ?? ''}
                  onChange={(e) =>
                    updateParticularsField('mainSwitchBsEn', sanitizeText(e.target.value))
                  }
                  placeholder="BS 60947"
                  className="cv-data-field w-full mt-1.5"
                  maxLength={50}
                  readOnly={readonly}
                  aria-label="Main switch BS EN standard"
                />
              </div>
              <div>
                <label className="cv-data-label">No. of Poles</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={particulars.mainSwitchPoles ?? ''}
                  onChange={(e) =>
                    updateParticularsField('mainSwitchPoles', parseNumericInput(e.target.value))
                  }
                  placeholder="2"
                  className="cv-data-field w-full mt-1.5"
                  min={1}
                  max={4}
                  readOnly={readonly}
                  aria-label="Number of poles"
                />
              </div>
              <div>
                <label className="cv-data-label">Current Rating (A)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={particulars.mainSwitchRating ?? ''}
                  onChange={(e) =>
                    updateParticularsField('mainSwitchRating', parseNumericInput(e.target.value))
                  }
                  placeholder="100"
                  className="cv-data-field w-full mt-1.5"
                  min={0}
                  max={1000}
                  readOnly={readonly}
                  aria-label="Main switch current rating"
                />
              </div>
              <div>
                <label className="cv-data-label">Voltage Rating (V)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={particulars.mainSwitchVoltageRating ?? ''}
                  onChange={(e) =>
                    updateParticularsField(
                      'mainSwitchVoltageRating',
                      parseNumericInput(e.target.value)
                    )
                  }
                  placeholder="230"
                  className="cv-data-field w-full mt-1.5"
                  min={0}
                  max={1000}
                  readOnly={readonly}
                  aria-label="Main switch voltage rating"
                />
              </div>
            </div>

            {/* RCD Details (if main switch is RCD) */}
            <div className="border-t border-cv-border pt-3 mt-3">
              <p className="text-xs text-cv-text-muted mb-2 font-semibold uppercase tracking-wider">
                RCD Details (if main switch incorporates RCD)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="cv-data-label">RCD Type</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {RCD_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => !readonly && updateParticularsField('mainRcdType', type)}
                        className={`px-3 py-1.5 rounded text-xs font-semibold border transition-all ${
                          particulars.mainRcdType === type
                            ? 'bg-cv-accent/15 border-cv-accent text-cv-accent'
                            : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                        } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                        aria-pressed={particulars.mainRcdType === type}
                        disabled={readonly}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="cv-data-label">IΔn (mA)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={particulars.mainRcdRating ?? ''}
                    onChange={(e) =>
                      updateParticularsField('mainRcdRating', parseNumericInput(e.target.value))
                    }
                    placeholder="30"
                    className="cv-data-field w-full mt-1.5"
                    min={0}
                    max={1000}
                    readOnly={readonly}
                    aria-label="RCD rated residual current"
                  />
                </div>
                <div>
                  <label className="cv-data-label">Time Delay (ms)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={particulars.mainRcdTimeDelay ?? ''}
                    onChange={(e) =>
                      updateParticularsField('mainRcdTimeDelay', parseNumericInput(e.target.value))
                    }
                    placeholder="0"
                    className="cv-data-field w-full mt-1.5"
                    min={0}
                    max={1000}
                    readOnly={readonly}
                    aria-label="RCD rated time delay"
                  />
                </div>
                <div>
                  <label className="cv-data-label">Trip Time (ms)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={particulars.mainRcdOperatingTime ?? ''}
                    onChange={(e) =>
                      updateParticularsField(
                        'mainRcdOperatingTime',
                        parseNumericInput(e.target.value)
                      )
                    }
                    placeholder="22"
                    className="cv-data-field w-full mt-1.5"
                    min={0}
                    max={1000}
                    readOnly={readonly}
                    aria-label="RCD measured operating time"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Means of Earthing */}
        {renderSectionHeader(
          'earthing_conductor',
          <Shield className="w-4 h-4" />,
          'Earthing &amp; Protective Conductors',
          'Means of earthing, conductor details, electrode'
        )}
        {isSectionExpanded('earthing_conductor') && (
          <div id="section-earthing_conductor" className="px-4 pb-4 space-y-4">
            {/* Means of Earthing */}
            <div>
              <label className="cv-data-label">Means of Earthing</label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {EARTHING_MEANS.map((means) => (
                  <button
                    key={means.key}
                    type="button"
                    onClick={() => !readonly && updateParticularsField('meansOfEarthing', means.key)}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                      particulars.meansOfEarthing === means.key
                        ? 'bg-cv-accent/15 border-cv-accent text-cv-accent'
                        : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                    } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                    aria-pressed={particulars.meansOfEarthing === means.key}
                    disabled={readonly}
                  >
                    {means.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Earth Electrode Details (TT systems) */}
            {(particulars.meansOfEarthing === 'electrode' || supply.earthingType === 'TT') && (
              <div className="bg-cv-surface-2 rounded-lg p-3 space-y-3">
                <p className="text-xs text-cv-amber font-semibold uppercase tracking-wider">
                  Earth Electrode Details
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="cv-data-label">Type</label>
                    <input
                      type="text"
                      value={particulars.electrodeType ?? ''}
                      onChange={(e) =>
                        updateParticularsField('electrodeType', sanitizeText(e.target.value))
                      }
                      placeholder="Rod electrode"
                      className="cv-data-field w-full mt-1.5"
                      maxLength={100}
                      readOnly={readonly}
                      aria-label="Electrode type"
                    />
                  </div>
                  <div>
                    <label className="cv-data-label">Resistance (Ω)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={particulars.electrodeResistance ?? ''}
                      onChange={(e) =>
                        updateParticularsField(
                          'electrodeResistance',
                          parseNumericInput(e.target.value)
                        )
                      }
                      placeholder="28"
                      className="cv-data-field w-full mt-1.5"
                      min={0}
                      max={10000}
                      step={0.1}
                      readOnly={readonly}
                      aria-label="Electrode resistance"
                    />
                  </div>
                </div>
                <div>
                  <label className="cv-data-label">Location</label>
                  <input
                    type="text"
                    value={particulars.electrodeLocation ?? ''}
                    onChange={(e) =>
                      updateParticularsField('electrodeLocation', sanitizeText(e.target.value))
                    }
                    placeholder="e.g. Next to front door"
                    className="cv-data-field w-full mt-1.5"
                    maxLength={200}
                    readOnly={readonly}
                    aria-label="Electrode location"
                  />
                </div>
              </div>
            )}

            {/* Earthing Conductor */}
            <div>
              <p className="text-xs text-cv-text-muted font-semibold uppercase tracking-wider mb-2">
                Earthing Conductor
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="cv-data-label">Material</label>
                  <div className="flex gap-2 mt-1.5">
                    {CONDUCTOR_MATERIALS.map((mat) => (
                      <button
                        key={mat}
                        type="button"
                        onClick={() =>
                          !readonly && updateParticularsField('earthingConductorMaterial', mat)
                        }
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                          particulars.earthingConductorMaterial === mat
                            ? 'bg-cv-accent/15 border-cv-accent text-cv-accent'
                            : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                        } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                        aria-pressed={particulars.earthingConductorMaterial === mat}
                        disabled={readonly}
                      >
                        {mat}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="cv-data-label">CSA (mm²)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={particulars.earthingConductorCsa ?? ''}
                    onChange={(e) =>
                      updateParticularsField(
                        'earthingConductorCsa',
                        parseNumericInput(e.target.value)
                      )
                    }
                    placeholder="16"
                    className="cv-data-field w-full mt-1.5"
                    min={0}
                    max={100}
                    step={0.5}
                    readOnly={readonly}
                    aria-label="Earthing conductor cross-sectional area"
                  />
                </div>
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() =>
                    !readonly &&
                    updateParticularsField(
                      'earthingConductorVerified',
                      !particulars.earthingConductorVerified
                    )
                  }
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                    particulars.earthingConductorVerified
                      ? 'bg-cv-green/15 border-cv-green text-cv-green'
                      : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                  } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                  aria-pressed={particulars.earthingConductorVerified}
                  disabled={readonly}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connection Verified
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bonding */}
        {renderSectionHeader(
          'bonding',
          <Shield className="w-4 h-4" />,
          'Protective Bonding',
          'Bonding conductors and extraneous parts'
        )}
        {isSectionExpanded('bonding') && (
          <div id="section-bonding" className="px-4 pb-4 space-y-4">
            {/* Main Bonding Conductor */}
            <div>
              <p className="text-xs text-cv-text-muted font-semibold uppercase tracking-wider mb-2">
                Main Protective Bonding Conductors
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="cv-data-label">Material</label>
                  <div className="flex gap-2 mt-1.5">
                    {CONDUCTOR_MATERIALS.map((mat) => (
                      <button
                        key={mat}
                        type="button"
                        onClick={() =>
                          !readonly && updateParticularsField('bondingMaterial', mat)
                        }
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                          particulars.bondingMaterial === mat
                            ? 'bg-cv-accent/15 border-cv-accent text-cv-accent'
                            : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                        } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                        aria-pressed={particulars.bondingMaterial === mat}
                        disabled={readonly}
                      >
                        {mat}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="cv-data-label">CSA (mm²)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={particulars.bondingConductorCsa ?? ''}
                    onChange={(e) =>
                      updateParticularsField(
                        'bondingConductorCsa',
                        parseNumericInput(e.target.value)
                      )
                    }
                    placeholder="10"
                    className="cv-data-field w-full mt-1.5"
                    min={0}
                    max={100}
                    step={0.5}
                    readOnly={readonly}
                    aria-label="Bonding conductor cross-sectional area"
                  />
                </div>
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() =>
                    !readonly &&
                    updateParticularsField(
                      'bondingConnectionVerified',
                      !particulars.bondingConnectionVerified
                    )
                  }
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                    particulars.bondingConnectionVerified
                      ? 'bg-cv-green/15 border-cv-green text-cv-green'
                      : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                  } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                  aria-pressed={particulars.bondingConnectionVerified}
                  disabled={readonly}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connection Verified
                </button>
              </div>
            </div>

            {/* Extraneous-Conductive-Parts */}
            <div>
              <p className="text-xs text-cv-text-muted font-semibold uppercase tracking-wider mb-2">
                Bonding of Extraneous-Conductive-Parts
              </p>
              <div className="space-y-2">
                {BONDING_SERVICES.map((service) => {
                  const currentValue =
                    particulars.bondingServices?.[
                      service.key as keyof typeof particulars.bondingServices
                    ];
                  return (
                    <div
                      key={service.key}
                      className="flex items-center justify-between p-3 bg-cv-bg rounded-lg border border-cv-border"
                    >
                      <span className="text-sm text-cv-text">{service.label}</span>
                      <div className="flex gap-1.5">
                        {(['yes', 'no', 'na'] as const).map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              if (readonly) return;
                              const updated = {
                                ...particulars.bondingServices,
                                [service.key]: val,
                              };
                              onParticularsChange({
                                ...particulars,
                                bondingServices: updated,
                              });
                            }}
                            className={`px-2.5 py-1 rounded text-xs font-semibold border transition-all ${
                              currentValue === val
                                ? val === 'yes'
                                  ? 'bg-cv-green/15 border-cv-green text-cv-green'
                                  : val === 'no'
                                  ? 'bg-cv-red/15 border-cv-red text-cv-red'
                                  : 'bg-cv-surface-2 border-cv-text-muted text-cv-text-muted'
                                : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                            } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                            aria-pressed={currentValue === val}
                            disabled={readonly}
                          >
                            {val === 'yes' ? '✓' : val === 'no' ? '✗' : 'N/A'}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Other bonding */}
                <div className="p-3 bg-cv-bg rounded-lg border border-cv-border">
                  <label className="cv-data-label">Other (specify)</label>
                  <input
                    type="text"
                    value={particulars.bondingOther ?? ''}
                    onChange={(e) =>
                      updateParticularsField('bondingOther', sanitizeText(e.target.value))
                    }
                    placeholder="e.g. Central heating bonded"
                    className="cv-data-field w-full mt-1.5"
                    maxLength={200}
                    readOnly={readonly}
                    aria-label="Other bonding details"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

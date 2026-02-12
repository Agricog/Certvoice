/**
 * CertVoice — Speech Parser (Trade Terminology Preprocessor)
 *
 * Normalises spoken electrical trade terminology before sending
 * transcripts to the Claude API for field extraction.
 *
 * This is PREPROCESSING, not extraction. The goal is to help Claude
 * by converting informal speech patterns into consistent forms:
 *   - "2.5 mil" → "2.5mm²"
 *   - "T and E" → "T&E"
 *   - "greater than 200 meg" → ">200 MΩ"
 *   - "30 mil RCD" → "30mA RCD"
 *   - "B32" already correct → left alone
 *
 * This runs CLIENT-SIDE before the transcript hits the API.
 * Claude still does the heavy lifting of field extraction.
 */

// ============================================================
// REPLACEMENT RULES
// ============================================================

/**
 * Each rule: [pattern (case-insensitive), replacement]
 * Order matters — more specific patterns first to avoid partial matches.
 */
const TERMINOLOGY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // --- Cable sizes: "mil" / "mm" → mm² ---
  // "2.5 mil" → "2.5mm²", "1.5 mil" → "1.5mm²"
  [/(\d+(?:\.\d+)?)\s*mil\b/gi, '$1mm²'],
  [/(\d+(?:\.\d+)?)\s*mm\s+squared/gi, '$1mm²'],
  [/(\d+(?:\.\d+)?)\s*millimetres?\s+squared/gi, '$1mm²'],

  // --- Cable types ---
  [/\bT\s+and\s+E\b/gi, 'T&E'],
  [/\btwin\s+and\s+earth\b/gi, 'T&E'],
  [/\bS\s*\.?\s*W\s*\.?\s*A\b/gi, 'SWA'],
  [/\bsteel\s+wire\s+armou?red\b/gi, 'SWA'],
  [/\bM\s*\.?\s*I\b(?!\s*\w)/gi, 'MI'],
  [/\bmineral\s+insulated\b/gi, 'MI'],

  // --- Insulation resistance ---
  // "greater than 200 meg" → ">200 MΩ"
  [/greater\s+than\s+(\d+)\s*meg(?:ohms?)?\b/gi, '>$1 MΩ'],
  [/more\s+than\s+(\d+)\s*meg(?:ohms?)?\b/gi, '>$1 MΩ'],
  [/over\s+(\d+)\s*meg(?:ohms?)?\b/gi, '>$1 MΩ'],
  [/(\d+)\s*meg(?:ohms?)?\b/gi, '$1 MΩ'],

  // --- RCD ratings: "30 mil RCD" → "30mA RCD" ---
  // Must come AFTER cable size rules. Context: "mil" near "RCD" means milliamps
  [/(\d+)\s*mil(?:li)?\s*(?:amp(?:s|ere)?|a)?\s*(RCD|RCBO)/gi, '$1mA $2'],
  [/(\d+)\s*m\s*a\s*(RCD|RCBO)/gi, '$1mA $2'],
  [/(\d+)\s*milliamps?\b/gi, '$1mA'],

  // --- RCD times ---
  [/trips?\s+(?:at|in)\s+(\d+)\s*(?:milliseconds?|ms)\b/gi, 'trips at $1ms'],
  [/(\d+)\s*milliseconds?\b/gi, '$1ms'],

  // --- Impedance and resistance ---
  [/(\d+(?:\.\d+)?)\s*ohms?\b/gi, '$1Ω'],

  // --- Voltage ---
  [/(\d+)\s*volts?\b/gi, '$1V'],

  // --- Frequency ---
  [/(\d+)\s*hertz\b/gi, '$1Hz'],

  // --- Current ---
  [/(\d+)\s*amps?\b(?!\s*(?:RCD|RCBO))/gi, '$1A'],
  [/(\d+)\s*amperes?\b/gi, '$1A'],
  [/(\d+)\s*kilo\s*amps?\b/gi, '$1kA'],
  [/(\d+(?:\.\d+)?)\s*k\s*a\b/gi, '$1kA'],

  // --- Power ---
  [/(\d+(?:\.\d+)?)\s*kilowatts?\b/gi, '$1kW'],
  [/(\d+(?:\.\d+)?)\s*k\s*w\b/gi, '$1kW'],

  // --- Pressure (gas) ---
  [/(\d+(?:\.\d+)?)\s*milli\s*bars?\b/gi, '$1mbar'],

  // --- Common abbreviations ---
  [/\bC\s*\.?\s*P\s*\.?\s*C\b/gi, 'CPC'],
  [/\bcircuit\s+protective\s+conductor\b/gi, 'CPC'],
  [/\bM\s*\.?\s*C\s*\.?\s*B\b/gi, 'MCB'],
  [/\bminiature\s+circuit\s+breaker\b/gi, 'MCB'],
  [/\bR\s*\.?\s*C\s*\.?\s*D\b/gi, 'RCD'],
  [/\bresidual\s+current\s+device\b/gi, 'RCD'],
  [/\bR\s*\.?\s*C\s*\.?\s*B\s*\.?\s*O\b/gi, 'RCBO'],
  [/\bP\s*\.?\s*F\s*\.?\s*C\b/gi, 'PFC'],
  [/\bprospective\s+fault\s+current\b/gi, 'PFC'],
  [/\bC\s*\.?\s*U\b/gi, 'CU'],
  [/\bconsumer\s+unit\b/gi, 'CU'],
  [/\bD\s*\.?\s*B\b/gi, 'DB'],
  [/\bdistribution\s+board\b/gi, 'DB'],
  [/\bS\s*\.?\s*P\s*\.?\s*D\b/gi, 'SPD'],
  [/\bsurge\s+protect(?:ive|ion)\s+device\b/gi, 'SPD'],

  // --- Earthing types ---
  [/\bT\s*N\s*[-–]\s*C\s*[-–]\s*S\b/gi, 'TN-C-S'],
  [/\bT\s*N\s*[-–]\s*S\b/gi, 'TN-S'],
  [/\bT\s*N\s*[-–]\s*C\b(?![-–]S)/gi, 'TN-C'],
  [/\bT\s*\.?\s*T\b/gi, 'TT'],
  [/\bP\s*\.?\s*M\s*\.?\s*E\b/gi, 'PME'],

  // --- Circuit types ---
  [/\bring\s+final\b/gi, 'ring final'],
  [/\bradial\s+(?:circuit|final)\b/gi, 'radial'],

  // --- Test values ---
  [/\bL\s+to\s+N\b/gi, 'L-N'],
  [/\bL\s+to\s+E\b/gi, 'L-E'],
  [/\blive\s+to\s+neutral\b/gi, 'L-N'],
  [/\blive\s+to\s+earth\b/gi, 'L-E'],
  [/\bR\s*1\s*\+\s*R\s*2\b/gi, 'R1+R2'],
  [/\bR\s+1\s+plus\s+R\s+2\b/gi, 'R1+R2'],
  [/\bZ\s*[eE]\b/gi, 'Ze'],
  [/\bZ\s*[sS]\b/gi, 'Zs'],

  // --- Classification codes ---
  [/\bC\s*1\b/g, 'C1'],
  [/\bC\s*2\b/g, 'C2'],
  [/\bC\s*3\b/g, 'C3'],
  [/\bF\s*\.?\s*I\b/gi, 'FI'],
  [/\bdanger\s+present\b/gi, 'C1'],
  [/\bpotentially\s+dangerous\b/gi, 'C2'],
  [/\bimprovement\s+recommended\b/gi, 'C3'],
  [/\bfurther\s+investigation\b/gi, 'FI'],

  // --- Special values ---
  [/\bnot\s+verified\b/gi, 'N/V'],
  [/\blimitation\b/gi, 'LIM'],
  [/\bnot\s+applicable\b/gi, 'N/A'],
  [/\bnot\s+tested\b/gi, 'LIM'],

  // --- Common fuse standards ---
  [/\bBS\s+60898\b/gi, 'BS 60898'],
  [/\bBS\s+61009\b/gi, 'BS 61009'],
  [/\bBS\s+61008\b/gi, 'BS 61008'],
  [/\bBS\s+1361\b/gi, 'BS 1361'],
  [/\bBS\s+88\b/gi, 'BS 88'],
  [/\bBS\s+3036\b/gi, 'BS 3036'],
  [/\bBS\s+60947\b/gi, 'BS 60947'],

  // --- Regulation references ---
  [/\breg(?:ulation)?\s+(\d{3}(?:\.\d+)*)\b/gi, 'Reg $1'],
]

// ============================================================
// NORMALISATION FUNCTIONS
// ============================================================

/**
 * Normalise whitespace: collapse multiple spaces, trim.
 */
function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Fix common speech-to-text number issues.
 * Web Speech API sometimes spells out numbers or adds spaces.
 */
function normaliseNumbers(text: string): string {
  let result = text

  // "nought point four two" → "0.42"
  result = result.replace(/\bnought\b/gi, '0')
  result = result.replace(/\bpoint\s+/gi, '.')

  // "zero point" → "0."
  result = result.replace(/\bzero\s+point\b/gi, '0.')

  // Ensure decimals don't have spaces: "0. 42" → "0.42"
  result = result.replace(/(\d+)\.\s+(\d+)/g, '$1.$2')

  return result
}

// ============================================================
// MAIN PREPROCESSOR
// ============================================================

/**
 * Preprocess a voice transcript before sending to Claude API.
 *
 * Applies trade terminology normalisation to help the AI extract
 * fields more accurately. Does NOT extract fields — that's Claude's job.
 *
 * @param transcript - Raw transcript from Web Speech API
 * @returns Normalised transcript ready for AI extraction
 */
export function preprocessTranscript(transcript: string): string {
  let result = transcript

  // Step 1: Normalise whitespace
  result = normaliseWhitespace(result)

  // Step 2: Fix number transcription issues
  result = normaliseNumbers(result)

  // Step 3: Apply trade terminology rules
  for (const [pattern, replacement] of TERMINOLOGY_RULES) {
    result = result.replace(pattern, replacement)
  }

  // Step 4: Final whitespace cleanup
  result = normaliseWhitespace(result)

  return result
}

// ============================================================
// TRADE TERM SUGGESTIONS (for UI autocomplete)
// ============================================================

/**
 * Common circuit descriptions for autocomplete in manual entry.
 */
export const CIRCUIT_DESCRIPTIONS: ReadonlyArray<string> = [
  'Ring Final',
  'Radial',
  'Lighting',
  'Cooker',
  'Shower',
  'Immersion Heater',
  'Electric Vehicle Charger',
  'Smoke Alarms',
  'Boiler',
  'Storage Heaters',
  'Outdoor Sockets',
  'Garage Supply',
  'Loft Supply',
  'Extractor Fan',
  'Security Alarm',
  'Doorbell',
  'Towel Rail',
  'Underfloor Heating',
]

/**
 * Common room/location names for the room selector.
 */
export const ROOM_LOCATIONS: ReadonlyArray<string> = [
  'Kitchen',
  'Lounge',
  'Dining Room',
  'Hallway',
  'Landing',
  'Bathroom',
  'En-Suite',
  'Bedroom 1',
  'Bedroom 2',
  'Bedroom 3',
  'Bedroom 4',
  'Garage',
  'Utility Room',
  'Conservatory',
  'Loft',
  'Garden',
  'Outbuilding',
  'Office',
  'WC',
  'Porch',
]

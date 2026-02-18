/**
 * CertVoice — BS 7671:2018+A2:2022 EICR Inspection Schedule
 *
 * Pre-populated inspection items matching the standard EICR
 * inspection schedule (Appendix 6 / Model Forms).
 *
 * Sections:
 *   1  Distribution equipment (consumer units, boards)
 *   2  Earthing and bonding arrangements
 *   3  Wiring system
 *   4  Current-using equipment (permanently connected)
 *   5  Protection against electric shock
 *   6  Isolation and switching
 *   7  Protection against thermal effects
 *   8  Special installations or locations
 *
 * Each item starts with outcome: null (not yet inspected).
 * The InspectionChecklist component renders these with
 * PASS / C1 / C2 / C3 / FI / NV / LIM / NA buttons.
 *
 * @module data/bs7671Schedule
 */

import type { InspectionItem, InspectionOutcome } from '../types/eicr'

// ============================================================
// SECTION LABELS (for UI grouping)
// ============================================================

export const SECTION_LABELS: Record<number, string> = {
  1: 'Distribution Equipment',
  2: 'Earthing & Bonding Arrangements',
  3: 'Wiring System',
  4: 'Current-Using Equipment',
  5: 'Protection Against Electric Shock',
  6: 'Isolation & Switching',
  7: 'Protection Against Thermal Effects',
  8: 'Special Installations or Locations',
}

// ============================================================
// HELPER
// ============================================================

function item(
  section: number,
  ref: string,
  description: string,
  regulationRef = ''
): InspectionItem {
  return {
    id: `sched-${section}-${ref.replace(/\./g, '-')}`,
    itemRef: ref,
    section,
    sectionTitle: SECTION_LABELS[section] ?? '',
    description,
    regulationRef,
    outcome: null as InspectionOutcome | null,
    notes: '',
  }
}

// ============================================================
// SCHEDULE DATA
// ============================================================

/**
 * Returns a fresh copy of the full BS 7671 inspection schedule.
 * Call this when creating a new certificate — each cert gets its own copy.
 */
export function createDefaultSchedule(): InspectionItem[] {
  return [
    // ========================================================
    // SECTION 1 — Distribution Equipment
    // ========================================================
    item(1, '1.1', 'Adequacy of access to and working space around the distribution equipment', '132.12'),
    item(1, '1.2', 'Security of fixing of distribution equipment', '134.1.1'),
    item(1, '1.3', 'Condition of enclosure(s) in terms of IP rating, damage, and deterioration', '416.2'),
    item(1, '1.4', 'Suitability of enclosure for the environment and external influences', '522'),
    item(1, '1.5', 'Presence of danger notices and other required labelling', '514'),
    item(1, '1.6', 'Presence of appropriate circuit charts, schedules, or warning notices', '514.9'),
    item(1, '1.7', 'Selection of protective device(s) for fault current', '434'),
    item(1, '1.8', 'Selection of protective device(s) for overload current', '433'),
    item(1, '1.9', 'Presence of main linked switch or linked circuit-breaker', '537.1'),
    item(1, '1.10', 'Operation of main switch (functional check)', '612.13'),
    item(1, '1.11', 'Manual operation of circuit-breakers and RCDs to prove disconnection', '612.13.2'),
    item(1, '1.12', 'Confirmation that an RCD is not used as the sole means of protection', '415.1'),
    item(1, '1.13', 'Confirmation of supply polarity', '612.6'),
    item(1, '1.14', 'Connections adequately made and mechanically secure', '526'),
    item(1, '1.15', 'Adequacy of conductors for current-carrying capacity', '523'),
    item(1, '1.16', 'Presence of appropriate overcurrent protective devices', '432'),
    item(1, '1.17', 'Co-ordination between conductors and overload protective devices', '433.1'),
    item(1, '1.18', 'Phase sequence (where applicable)', '514.15'),
    item(1, '1.19', 'Correct type and rating of fuses and circuit-breakers', '533'),
    item(1, '1.20', 'Enclosure not excessively filled or cables not adequately supported', '521'),

    // ========================================================
    // SECTION 2 — Earthing & Bonding Arrangements
    // ========================================================
    item(2, '2.1', 'Presence and adequacy of earthing conductor', '542.3'),
    item(2, '2.2', 'Presence and adequacy of circuit protective conductors', '543'),
    item(2, '2.3', 'Presence and adequacy of main protective bonding conductors to water, gas, oil, structural steel, lightning protection', '544.1'),
    item(2, '2.4', 'Presence and adequacy of supplementary bonding conductors (where required)', '544.2'),
    item(2, '2.5', 'Accessibility and condition of earthing conductor connection at MET', '542.4'),
    item(2, '2.6', 'Accessibility and condition of earth electrode connection (where applicable)', '542.2'),
    item(2, '2.7', 'Condition of earth electrode (where applicable)', '542.2'),
    item(2, '2.8', 'Earthing and bonding labels present at point of connection', '514.13'),
    item(2, '2.9', 'Adequacy of earthing arrangements for PME conditions', '544.1'),
    item(2, '2.10', 'Main bonding connections made to within 600mm of entry point', '544.1.2'),
    item(2, '2.11', 'Bonding of extraneous-conductive-parts in bathrooms/shower rooms', '701.415.2'),

    // ========================================================
    // SECTION 3 — Wiring System
    // ========================================================
    item(3, '3.1', 'Identification of conductors (correct colour coding or marking)', '514'),
    item(3, '3.2', 'Cable installation methods and practices comply with regulations', '521'),
    item(3, '3.3', 'Condition of insulation of live conductors', '612.3'),
    item(3, '3.4', 'Non-sheathed cables protected by enclosure in conduit, ducting or trunking', '521.10'),
    item(3, '3.5', 'Suitability of containment systems and support/protection against mechanical damage', '522.6'),
    item(3, '3.6', 'Cables correctly supported throughout their run', '521'),
    item(3, '3.7', 'Cables and conductors correctly terminated in accessories, luminaires and equipment', '526'),
    item(3, '3.8', 'Adequacy of connections, including socket outlets and other accessories', '526'),
    item(3, '3.9', 'Condition of accessories including socket outlets, switches and joint boxes', '621.2'),
    item(3, '3.10', 'Single-pole switching or protective devices in line conductor(s) only', '530.3'),
    item(3, '3.11', 'Adequacy of cables for current-carrying capacity with regard to type and nature of installation', '523'),
    item(3, '3.12', 'Cables concealed under floors, above ceilings, in walls adequately protected', '522.6.6'),
    item(3, '3.13', 'Cables passing through thermal insulation suitably de-rated or protected', '523.9'),
    item(3, '3.14', 'Provision of additional mechanical protection where cables are at risk of damage', '522.6'),
    item(3, '3.15', 'Cables adequately protected at penetrations through walls, floors and ceilings', '527.2'),
    item(3, '3.16', 'Adequacy of cable entry holes in enclosures (appropriately sealed)', '526.3'),
    item(3, '3.17', 'Presence and condition of flexible cables and cord connections', '521.9'),
    item(3, '3.18', 'No signs of damage, deterioration or wear on cables or wiring accessories', '621.2'),

    // ========================================================
    // SECTION 4 — Current-Using Equipment (permanently connected)
    // ========================================================
    item(4, '4.1', 'Suitability of equipment in terms of IP rating for installed conditions', '512.2'),
    item(4, '4.2', 'Enclosure not damaged or deteriorated so as to impair safety', '416.2'),
    item(4, '4.3', 'Suitability for the environment and external influences', '512.2'),
    item(4, '4.4', 'Security of fixing', '134.1.1'),
    item(4, '4.5', 'Cable entry holes in ceiling roses, luminaires, plugs, socket outlets adequately sealed', '526.3'),
    item(4, '4.6', 'Condition of flexible cables and cords including connections', '521.9'),
    item(4, '4.7', 'Equipment does not pose risk of burns or fire to persons or property', '423'),
    item(4, '4.8', 'Equipment does not show signs of overheating or thermal damage', '421'),
    item(4, '4.9', 'Suitability of equipment for its installed function and rating', '512.1'),
    item(4, '4.10', 'Adequacy of ventilation for heat-producing equipment', '421.1'),
    item(4, '4.11', 'Correct operation of equipment (functional check where appropriate)', '612.13'),
    item(4, '4.12', 'Condition of lampholders, luminaires and ceiling roses', '559'),

    // ========================================================
    // SECTION 5 — Protection Against Electric Shock
    // ========================================================
    item(5, '5.1', 'Prevention of access to live parts by barriers or enclosures (basic protection)', '416.2'),
    item(5, '5.2', 'Insulation of live parts adequate and undamaged', '416.1'),
    item(5, '5.3', 'Provision of additional protection by 30mA RCD for socket outlets ≤32A', '411.3.3'),
    item(5, '5.4', 'Provision of additional protection by 30mA RCD for mobile equipment ≤32A outdoors', '411.3.3'),
    item(5, '5.5', 'Provision of additional protection by 30mA RCD for cables concealed in walls at depth <50mm', '522.6.6'),
    item(5, '5.6', 'Exposed-conductive-parts effectively connected to earth (ADS)', '411.3'),
    item(5, '5.7', 'Presence of earthing conductor to all circuits and exposed-conductive-parts', '411.3.1.1'),
    item(5, '5.8', 'Presence of circuit protective conductors', '411.3.1.1'),
    item(5, '5.9', 'Adequacy of main protective bonding', '411.3.1.2'),
    item(5, '5.10', 'Adequacy of supplementary bonding (where required)', '415.2'),
    item(5, '5.11', 'SELV/PELV systems correct where applicable (separation, earthing, voltage)', '414'),
    item(5, '5.12', 'Condition of accessible earthing and bonding connections', '526'),
    item(5, '5.13', 'Adequacy of fault path confirmed by testing', '612.4'),
    item(5, '5.14', 'Disconnection times within the limits specified in BS 7671', '411.3.2'),
    item(5, '5.15', 'No exposed metalwork that could become live through a fault', '411.3'),

    // ========================================================
    // SECTION 6 — Isolation & Switching
    // ========================================================
    item(6, '6.1', 'Presence and condition of main isolation switch', '537.1'),
    item(6, '6.2', 'Capability for isolation of individual circuits', '537.2'),
    item(6, '6.3', 'Provision of local isolation adjacent to equipment', '537.2'),
    item(6, '6.4', 'Presence of appropriate devices for switching off for mechanical maintenance', '537.3'),
    item(6, '6.5', 'Presence of appropriate devices for emergency switching or stopping', '537.4'),
    item(6, '6.6', 'Correct identification and labelling of all switches and protective devices', '514'),
    item(6, '6.7', 'Adequacy of access to switchgear and isolators', '132.12'),
    item(6, '6.8', 'Firefighter\'s switch present where required (e.g. exterior electrical installations, EV charging)', '537.6'),
    item(6, '6.9', 'Isolating devices clearly indicate ON/OFF position', '537.2'),
    item(6, '6.10', 'All means of isolation capable of being secured in the OFF position', '537.2'),

    // ========================================================
    // SECTION 7 — Protection Against Thermal Effects
    // ========================================================
    item(7, '7.1', 'Presence of fire barriers, fire stopping and seals at penetrations of building elements', '527.2'),
    item(7, '7.2', 'Cables not covered by or surrounded by thermally insulating material', '523.9'),
    item(7, '7.3', 'Cables installed in areas susceptible to fire risk comply with requirements', '422'),
    item(7, '7.4', 'No signs of overheating at equipment, accessories or distribution boards', '421'),
    item(7, '7.5', 'Provision of fire detection and alarm systems appropriate to the premises', '421'),
    item(7, '7.6', 'Spotlight/downlighter installations comply with manufacturer\'s thermal requirements', '559'),
    item(7, '7.7', 'Recessed luminaires provided with adequate thermal protection (fire hoods etc.)', '422.3'),
    item(7, '7.8', 'Equipment not mounted on or adjacent to combustible material without appropriate protection', '421.1'),
    item(7, '7.9', 'No accumulation of dust, dirt or other material that could present a fire risk', '421'),

    // ========================================================
    // SECTION 8 — Special Installations or Locations
    // ========================================================
    item(8, '8.1', 'Bathroom/shower room: zones correctly identified and equipment suitable for zone', '701'),
    item(8, '8.2', 'Bathroom/shower room: additional protection by 30mA RCD', '701.411.3.3'),
    item(8, '8.3', 'Bathroom/shower room: supplementary bonding present (where required)', '701.415.2'),
    item(8, '8.4', 'Bathroom/shower room: electric showers suitably rated and correctly connected', '701'),
    item(8, '8.5', 'Swimming pool, hot tub or sauna: equipment suitable for zones', '702/703'),
    item(8, '8.6', 'External installations: equipment has appropriate IP rating', '721'),
    item(8, '8.7', 'External installations: additional protection by 30mA RCD', '721.411.3.3'),
    item(8, '8.8', 'Solar PV installation: DC isolator, labelling, and protection adequate', '712'),
    item(8, '8.9', 'EV charging installation: protective measures, dedicated circuit, labelling', '722'),
    item(8, '8.10', 'Garden buildings/outbuildings: adequacy of wiring and protection', '721'),
    item(8, '8.11', 'Locations with increased risk of fire: appropriate wiring system and protection', '422'),
    item(8, '8.12', 'Temporary installations: adequacy of protection and condition', '740'),
  ]
}

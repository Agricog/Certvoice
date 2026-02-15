-- ============================================================
-- CertVoice — Neon PostgreSQL Schema
--
-- Data isolation: Every query MUST filter by engineer_id.
-- Row-Level Security (RLS) enforced on all tables.
--
-- Tables:
--   1. engineers         — Profile, company, registration, instruments
--   2. clients           — Client details for certificates
--   3. jobs              — Job bookings / inspection assignments
--   4. certificates      — EICR + CP12 certificates (master record)
--   5. distribution_boards — One per DB in a certificate
--   6. circuits          — One per circuit per distribution board
--   7. observations      — Section K observations (C1/C2/C3/FI)
--   8. inspection_items  — Schedule of Inspections checklist (70+ items)
--
-- Naming: snake_case throughout. Matches eicr.ts types.
-- Timestamps: All UTC, auto-managed.
-- Soft delete: deleted_at column on certificates and jobs.
--
-- Run against Neon via: psql $DATABASE_URL -f schema.sql
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. ENGINEERS
-- ============================================================

CREATE TABLE IF NOT EXISTS engineers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id   TEXT NOT NULL UNIQUE,

  -- Profile
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  qualifications  TEXT,

  -- Company
  company_name    TEXT,
  company_address TEXT,
  company_phone   TEXT,
  company_email   TEXT,

  -- Registration
  registration_body   TEXT CHECK (registration_body IN ('NICEIC', 'NAPIT', 'ELECSA', 'STROMA', 'OTHER')),
  registration_number TEXT,

  -- Signature
  signature_r2_key TEXT,

  -- Default test instruments
  mft_serial              TEXT,
  mft_calibration_date    DATE,
  loop_tester_serial      TEXT,
  loop_tester_cal_date    DATE,
  rcd_tester_serial       TEXT,
  rcd_tester_cal_date     DATE,
  ir_tester_serial        TEXT,
  ir_tester_cal_date      DATE,
  continuity_tester_serial    TEXT,
  continuity_tester_cal_date  DATE,

  -- Subscription
  stripe_customer_id      TEXT,
  subscription_status     TEXT DEFAULT 'none' CHECK (subscription_status IN ('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  subscription_plan       TEXT,
  trial_ends_at           TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,

  -- Metadata
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_engineers_clerk ON engineers (clerk_user_id);

-- ============================================================
-- 2. CLIENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  engineer_id  UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,

  client_name  TEXT NOT NULL,
  address      TEXT,
  postcode     TEXT,
  phone        TEXT,
  email        TEXT,
  notes        TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_engineer ON clients (engineer_id);
CREATE INDEX idx_clients_name ON clients (engineer_id, client_name);

-- ============================================================
-- 3. JOBS
-- ============================================================

CREATE TABLE IF NOT EXISTS jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  engineer_id  UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  client_id    UUID REFERENCES clients(id) ON DELETE SET NULL,

  job_reference    TEXT,
  job_type         TEXT NOT NULL CHECK (job_type IN ('EICR', 'CP12', 'EICR_CP12')),
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED')),

  -- Property
  property_address TEXT NOT NULL,
  property_postcode TEXT,
  property_type    TEXT,

  -- Schedule
  scheduled_date   DATE,
  scheduled_time   TIME,
  completed_date   DATE,

  -- Notes
  access_notes     TEXT,
  internal_notes   TEXT,

  -- Soft delete
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_engineer ON jobs (engineer_id);
CREATE INDEX idx_jobs_status ON jobs (engineer_id, status);
CREATE INDEX idx_jobs_date ON jobs (engineer_id, scheduled_date);

-- ============================================================
-- 4. CERTIFICATES
-- ============================================================

CREATE TABLE IF NOT EXISTS certificates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  engineer_id  UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  job_id       UUID REFERENCES jobs(id) ON DELETE SET NULL,
  client_id    UUID REFERENCES clients(id) ON DELETE SET NULL,

  -- Certificate type and status
  certificate_type TEXT NOT NULL CHECK (certificate_type IN ('EICR', 'CP12')),
  status           TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'COMPLETE', 'ISSUED')),
  report_number    TEXT NOT NULL,

  -- Section A: Client Details
  client_name      TEXT,
  client_address   TEXT,

  -- Section B: Report Reason
  purpose          TEXT CHECK (purpose IN ('PERIODIC', 'CHANGE_OF_OCCUPANCY', 'MORTGAGE', 'INSURANCE', 'SAFETY_CONCERN', 'OTHER')),
  inspection_dates TEXT[], -- Array of date strings

  -- Section C: Installation Details
  installation_address  TEXT,
  installation_postcode TEXT,
  description_of_premises TEXT CHECK (description_of_premises IN ('DOMESTIC', 'COMMERCIAL', 'INDUSTRIAL', 'OTHER')),
  estimated_age         TEXT,
  evidence_of_alterations BOOLEAN DEFAULT FALSE,
  alterations_age       TEXT,

  -- Section D: Extent and Limitations
  extent_of_inspection  TEXT,
  agreed_limitations    TEXT,
  operational_limitations TEXT,

  -- Section E: Summary of Condition (auto-calculated)
  overall_assessment    TEXT CHECK (overall_assessment IN ('SATISFACTORY', 'UNSATISFACTORY')),

  -- Section F: Recommendations
  next_inspection_date  DATE,
  recommendations_text  TEXT,

  -- Section G: Declaration
  inspector_name        TEXT,
  inspector_signature_key TEXT,
  inspector_signed_at   TIMESTAMPTZ,
  qs_name               TEXT,
  qs_signature_key      TEXT,
  qs_signed_at          TIMESTAMPTZ,

  -- Section I: Supply Characteristics
  earthing_type         TEXT CHECK (earthing_type IN ('TN_C', 'TN_S', 'TN_C_S', 'TT', 'IT')),
  supply_type           TEXT DEFAULT 'AC' CHECK (supply_type IN ('AC', 'DC')),
  conductor_config      TEXT DEFAULT '1PH_2WIRE' CHECK (conductor_config IN ('1PH_2WIRE', '2PH_3WIRE', '3PH_3WIRE', '3PH_4WIRE')),
  supply_polarity_confirmed BOOLEAN DEFAULT FALSE,
  other_sources_present     BOOLEAN DEFAULT FALSE,
  nominal_voltage       NUMERIC(6,1),
  nominal_frequency     NUMERIC(4,1) DEFAULT 50,
  ipf                   NUMERIC(8,2),
  ze                    NUMERIC(6,3),
  supply_device_bs_en   TEXT,
  supply_device_type    TEXT,
  supply_device_rating  NUMERIC(6,1),

  -- Section J: Installation Particulars
  distributor_facility      BOOLEAN DEFAULT FALSE,
  installation_electrode    BOOLEAN DEFAULT FALSE,
  electrode_type            TEXT,
  electrode_location        TEXT,
  electrode_resistance      NUMERIC(8,3),
  main_switch_location      TEXT,
  main_switch_bs_en         TEXT,
  main_switch_poles         INTEGER,
  main_switch_current_rating NUMERIC(6,1),
  main_switch_device_rating  NUMERIC(6,1),
  main_switch_voltage_rating NUMERIC(6,1),
  earthing_conductor_material TEXT DEFAULT 'COPPER' CHECK (earthing_conductor_material IN ('COPPER', 'ALUMINIUM')),
  earthing_conductor_csa    NUMERIC(6,2),
  earthing_conductor_verified BOOLEAN DEFAULT FALSE,
  bonding_conductor_material  TEXT DEFAULT 'COPPER' CHECK (bonding_conductor_material IN ('COPPER', 'ALUMINIUM')),
  bonding_conductor_csa     NUMERIC(6,2),
  bonding_conductor_verified BOOLEAN DEFAULT FALSE,
  bonding_water     TEXT DEFAULT 'NA' CHECK (bonding_water IN ('SATISFACTORY', 'NA', 'UNSATISFACTORY')),
  bonding_gas       TEXT DEFAULT 'NA' CHECK (bonding_gas IN ('SATISFACTORY', 'NA', 'UNSATISFACTORY')),
  bonding_oil       TEXT DEFAULT 'NA' CHECK (bonding_oil IN ('SATISFACTORY', 'NA', 'UNSATISFACTORY')),
  bonding_steel     TEXT DEFAULT 'NA' CHECK (bonding_steel IN ('SATISFACTORY', 'NA', 'UNSATISFACTORY')),
  bonding_lightning TEXT DEFAULT 'NA' CHECK (bonding_lightning IN ('SATISFACTORY', 'NA', 'UNSATISFACTORY')),
  bonding_other     TEXT DEFAULT 'NA' CHECK (bonding_other IN ('SATISFACTORY', 'NA', 'UNSATISFACTORY')),

  -- Test instruments (per-certificate override of defaults)
  mft_serial              TEXT,
  mft_calibration_date    DATE,
  loop_tester_serial      TEXT,
  loop_tester_cal_date    DATE,
  rcd_tester_serial       TEXT,
  rcd_tester_cal_date     DATE,
  ir_tester_serial        TEXT,
  ir_tester_cal_date      DATE,

  -- PDF
  pdf_r2_key        TEXT,
  pdf_generated_at  TIMESTAMPTZ,
  pdf_page_count    INTEGER,

  -- Soft delete
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_certs_engineer ON certificates (engineer_id);
CREATE INDEX idx_certs_status ON certificates (engineer_id, status);
CREATE INDEX idx_certs_report ON certificates (engineer_id, report_number);
CREATE INDEX idx_certs_job ON certificates (job_id);
CREATE INDEX idx_certs_client ON certificates (client_id);

-- ============================================================
-- 5. DISTRIBUTION BOARDS
-- ============================================================

CREATE TABLE IF NOT EXISTS distribution_boards (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  certificate_id  UUID NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  engineer_id     UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,

  db_reference    TEXT NOT NULL, -- e.g. 'DB1', 'DB2'
  db_designation  TEXT,          -- e.g. 'Main Consumer Unit'
  db_location     TEXT,          -- e.g. 'Under stairs'
  db_make         TEXT,
  db_type         TEXT,

  -- Ze/Zdb at this board
  ze_at_board     NUMERIC(6,3),
  zdb             NUMERIC(6,3),

  -- Phase info
  phase_sequence_confirmed BOOLEAN DEFAULT FALSE,
  supply_polarity_confirmed BOOLEAN DEFAULT FALSE,

  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_db_cert ON distribution_boards (certificate_id);
CREATE INDEX idx_db_engineer ON distribution_boards (engineer_id);

-- ============================================================
-- 6. CIRCUITS
-- ============================================================

CREATE TABLE IF NOT EXISTS circuits (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  certificate_id    UUID NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  board_id          UUID NOT NULL REFERENCES distribution_boards(id) ON DELETE CASCADE,
  engineer_id       UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,

  -- Columns 1-16: Circuit details
  circuit_number        INTEGER NOT NULL,
  circuit_description   TEXT NOT NULL,
  wiring_type           TEXT,       -- e.g. 'T&E', 'SWA', 'FP200'
  reference_method      TEXT,       -- e.g. 'C', 'A', 'B'
  number_of_points      INTEGER,
  live_csa              NUMERIC(6,2), -- mm²
  cpc_csa               NUMERIC(6,2),
  max_disconnect_time   NUMERIC(6,3), -- seconds
  ocpd_type             TEXT,       -- e.g. 'B', 'C', 'D'
  ocpd_rating           NUMERIC(6,1), -- Amps
  ocpd_bs_en            TEXT,       -- e.g. 'BS 60898'
  ocpd_short_circuit    NUMERIC(10,1),
  rcd_type              TEXT,       -- e.g. 'Type A', 'Type AC'
  rcd_rating            NUMERIC(6,1), -- mA
  rcd_operating_current NUMERIC(6,1),

  -- Columns 17-31: Test results
  r1                    NUMERIC(6,3),
  rn                    NUMERIC(6,3),
  r2                    NUMERIC(6,3),
  r1_plus_r2            NUMERIC(6,3),
  r2_live               NUMERIC(6,3),
  ring_r1               NUMERIC(6,3),
  ring_rn               NUMERIC(6,3),
  ring_r2               NUMERIC(6,3),
  insulation_resistance_live_neutral  NUMERIC(8,1),
  insulation_resistance_live_earth    NUMERIC(8,1),
  insulation_resistance_neutral_earth NUMERIC(8,1),
  insulation_test_voltage             INTEGER, -- 250, 500, 1000
  polarity              TEXT DEFAULT 'TICK' CHECK (polarity IN ('TICK', 'CROSS', 'NA')),
  max_permitted_zs      NUMERIC(6,3),
  measured_zs           NUMERIC(6,3),
  rcd_operating_time    NUMERIC(6,1), -- ms
  rcd_test_button       TEXT DEFAULT 'TICK' CHECK (rcd_test_button IN ('TICK', 'CROSS', 'NA')),

  -- Validation
  zs_valid              BOOLEAN GENERATED ALWAYS AS (
                          CASE WHEN measured_zs IS NOT NULL AND max_permitted_zs IS NOT NULL
                               THEN measured_zs <= max_permitted_zs
                               ELSE NULL
                          END
                        ) STORED,

  -- Status
  status                TEXT DEFAULT 'SATISFACTORY' CHECK (status IN ('SATISFACTORY', 'UNSATISFACTORY', 'INCOMPLETE', 'LIM')),
  remarks               TEXT,

  -- Voice capture metadata
  voice_transcript      TEXT,
  voice_confidence      NUMERIC(3,2), -- 0.00 to 1.00
  capture_method        TEXT DEFAULT 'manual' CHECK (capture_method IN ('voice', 'manual')),

  sort_order            INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_circuits_cert ON circuits (certificate_id);
CREATE INDEX idx_circuits_board ON circuits (board_id);
CREATE INDEX idx_circuits_engineer ON circuits (engineer_id);

-- ============================================================
-- 7. OBSERVATIONS (Section K)
-- ============================================================

CREATE TABLE IF NOT EXISTS observations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  certificate_id    UUID NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  engineer_id       UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,

  -- Observation details
  item_number           INTEGER NOT NULL,
  observation_text      TEXT NOT NULL,
  classification_code   TEXT NOT NULL CHECK (classification_code IN ('C1', 'C2', 'C3', 'FI')),
  location              TEXT,
  bs_reference          TEXT, -- e.g. 'Reg 411.3.3'
  recommendation        TEXT,
  photo_r2_keys         TEXT[], -- Array of R2 keys for evidence photos

  -- Voice capture metadata
  voice_transcript      TEXT,
  voice_confidence      NUMERIC(3,2),
  capture_method        TEXT DEFAULT 'manual' CHECK (capture_method IN ('voice', 'manual')),

  sort_order            INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_obs_cert ON observations (certificate_id);
CREATE INDEX idx_obs_engineer ON observations (engineer_id);
CREATE INDEX idx_obs_classification ON observations (certificate_id, classification_code);

-- ============================================================
-- 8. INSPECTION ITEMS (Schedule of Inspections)
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  certificate_id    UUID NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  engineer_id       UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,

  -- Checklist item
  section           TEXT NOT NULL,    -- e.g. '1.0', '2.0'
  item_number       TEXT NOT NULL,    -- e.g. '1.1', '2.3'
  description       TEXT NOT NULL,    -- e.g. 'Service cables/line conductors'
  outcome           TEXT CHECK (outcome IN ('PASS', 'C1', 'C2', 'C3', 'FI', 'NV', 'LIM', 'NA')),
  notes             TEXT,

  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insp_cert ON inspection_items (certificate_id);
CREATE INDEX idx_insp_engineer ON inspection_items (engineer_id);
CREATE INDEX idx_insp_section ON inspection_items (certificate_id, section);

-- ============================================================
-- ROW-LEVEL SECURITY (RLS)
--
-- Every table is protected so that engineers can only
-- access their own data. The Neon API middleware must set
-- the session variable: SET app.current_engineer_id = '...'
-- ============================================================

ALTER TABLE engineers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE circuits ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;

-- Engineers: can only see their own record
CREATE POLICY engineer_isolation ON engineers
  USING (id::TEXT = current_setting('app.current_engineer_id', TRUE));

-- All other tables: filtered by engineer_id
CREATE POLICY client_isolation ON clients
  USING (engineer_id::TEXT = current_setting('app.current_engineer_id', TRUE));

CREATE POLICY job_isolation ON jobs
  USING (engineer_id::TEXT = current_setting('app.current_engineer_id', TRUE));

CREATE POLICY cert_isolation ON certificates
  USING (engineer_id::TEXT = current_setting('app.current_engineer_id', TRUE));

CREATE POLICY db_isolation ON distribution_boards
  USING (engineer_id::TEXT = current_setting('app.current_engineer_id', TRUE));

CREATE POLICY circuit_isolation ON circuits
  USING (engineer_id::TEXT = current_setting('app.current_engineer_id', TRUE));

CREATE POLICY obs_isolation ON observations
  USING (engineer_id::TEXT = current_setting('app.current_engineer_id', TRUE));

CREATE POLICY insp_isolation ON inspection_items
  USING (engineer_id::TEXT = current_setting('app.current_engineer_id', TRUE));

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_engineers_updated BEFORE UPDATE ON engineers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_certs_updated BEFORE UPDATE ON certificates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_db_updated BEFORE UPDATE ON distribution_boards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_circuits_updated BEFORE UPDATE ON circuits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_obs_updated BEFORE UPDATE ON observations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_insp_updated BEFORE UPDATE ON inspection_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- HELPER: Auto-calculate overall assessment
--
-- If any observation has C1 or C2, certificate is UNSATISFACTORY.
-- Called by application layer after observation changes.
-- ============================================================

CREATE OR REPLACE FUNCTION recalculate_assessment(cert_id UUID)
RETURNS TEXT AS $$
DECLARE
  has_c1_c2 BOOLEAN;
  result TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM observations
    WHERE certificate_id = cert_id
      AND classification_code IN ('C1', 'C2')
  ) INTO has_c1_c2;

  IF has_c1_c2 THEN
    result := 'UNSATISFACTORY';
  ELSE
    result := 'SATISFACTORY';
  END IF;

  UPDATE certificates
  SET overall_assessment = result
  WHERE id = cert_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- HELPER: Generate next report number
--
-- Format: CV-YYYYMM-XXXX (e.g. CV-202602-0001)
-- Auto-increments per engineer per month.
-- ============================================================

CREATE OR REPLACE FUNCTION next_report_number(eng_id UUID)
RETURNS TEXT AS $$
DECLARE
  prefix TEXT;
  seq INTEGER;
BEGIN
  prefix := 'CV-' || TO_CHAR(NOW(), 'YYYYMM') || '-';

  SELECT COUNT(*) + 1 INTO seq
  FROM certificates
  WHERE engineer_id = eng_id
    AND report_number LIKE prefix || '%';

  RETURN prefix || LPAD(seq::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

import { Pool } from 'pg';

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://nll:nll_local_dev@localhost:5432/nll_mock',
});

/**
 * Resources are stored as JSONB (the natural shape for FHIR), with a few
 * extracted columns so searches don't need JSON path queries everywhere.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS patients (
  id            TEXT PRIMARY KEY,
  personnummer  TEXT UNIQUE NOT NULL,
  resource      JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS medication_requests (
  id            TEXT PRIMARY KEY,
  patient_id    TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  authored_on   DATE,
  atc_code      TEXT,
  resource      JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medreq_patient ON medication_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_medreq_status  ON medication_requests(status);

CREATE TABLE IF NOT EXISTS medication_dispenses (
  id               TEXT PRIMARY KEY,
  patient_id       TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  prescription_id  TEXT REFERENCES medication_requests(id) ON DELETE SET NULL,
  status           TEXT NOT NULL,
  handed_over_at   TIMESTAMPTZ,
  resource         JSONB NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disp_patient ON medication_dispenses(patient_id);
CREATE INDEX IF NOT EXISTS idx_disp_prescription ON medication_dispenses(prescription_id);

CREATE TABLE IF NOT EXISTS access_tokens (
  token       TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  scope       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);
`;

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

# NLL Mock — Nationella läkemedelslistan, local development mock

A local mock of the Swedish National Medication List (NLL) FHIR R4 API, for developing and testing data-extraction clients without connecting to E-hälsomyndigheten's environments.

**Not affiliated with E-hälsomyndigheten. Contains only synthetic test data.** The real API is specified in the [implementation guide on Simplifier](https://simplifier.net/guide/swedishnationalmedicationlist) and [Handbok för vård- och apotekstjänster](https://samarbetsyta.ehalsomyndigheten.se/handboken/latest).

## Stack

- **Server** — Node 22, TypeScript, Express. Serves a FHIR R4 subset styled after the NLL profiles (NLLPatient, NLLMedicationRequest, NLLMedicationDispense), plus a mock OAuth2 token endpoint.
- **Database** — PostgreSQL 16. Resources stored as JSONB with extracted search columns (the same pattern HAPI FHIR uses).
- **Client** — React 18 + Vite. A browse/extract UI: look up test patients by personnummer, view prescriptions and dispenses, inspect raw FHIR, download an extraction bundle.

## Quick start

```bash
docker compose up --build
```

| Service | URL |
| --- | --- |
| Web UI | http://localhost:5173 |
| FHIR base | http://localhost:8080/fhir |
| Token endpoint | POST http://localhost:8080/auth/token |
| Postgres | localhost:5432 (`nll` / `nll_local_dev` / db `nll_mock`) |

The database is migrated and seeded automatically on first start (`SEED_ON_START=true`).

### Without Docker

```bash
# Terminal 1 — needs a local Postgres, or use the in-memory smoke server:
cd server && npm install
npm run smoke          # full API on :8099 with in-memory Postgres, no Docker needed
# or, against real Postgres:
DATABASE_URL=postgres://... SEED_ON_START=true npm run dev

# Terminal 2
cd client && npm install && npm run dev   # proxies /fhir and /auth to :8080
```

## Authentication flow

Mirrors the token-then-bearer pattern a real integration needs:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/auth/token \
  -d 'grant_type=client_credentials&client_id=nll-mock-client&client_secret=nll-mock-secret' \
  | jq -r .access_token)

curl http://localhost:8080/fhir/Patient?identifier=191212121212 \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-purpose-of-use: TREAT" \
  -H "x-system-id: my-extraction-client"
```

`/fhir/metadata` and `/fhir/$ping` are open; everything else returns a FHIR `OperationOutcome` 401 without a valid bearer token. Missing `x-purpose-of-use` / `x-system-id` headers produce a warning header (`x-nll-mock-warning`) rather than a block, so you can develop incrementally while seeing what production requires.

## API

| Endpoint | Description |
| --- | --- |
| `GET /fhir/metadata` | CapabilityStatement |
| `GET /fhir/$ping` | Liveness operation (styled after NLLPing) |
| `GET /fhir/Patient?identifier=<pnr>` | Look up patient by 12-digit personnummer (Luhn-validated; bad format → `AFF-001` OperationOutcome, unknown patient → `AFF-014`) |
| `GET /fhir/Patient/:id` | Read patient |
| `GET /fhir/MedicationRequest?patient=<id>[&status=active]` | Prescriptions for a patient (`patient` is required, as in real NLL) |
| `GET /fhir/MedicationRequest/:id` | Read prescription |
| `GET /fhir/MedicationDispense?patient=<id>` / `?prescription=<id>` | Dispenses |
| `GET /fhir/Patient/:id/$medication-list` | **Extraction helper** (not in real NLL): one collection Bundle with the patient + all prescriptions + all dispenses |

Search responses are FHIR `searchset` Bundles; errors are `OperationOutcome` with codes styled after NLL's AFF-kontroller.

## Test data

Five synthetic patients are seeded, with structurally valid (Luhn-checked) personnummer in the spirit of Skatteverket's test identities — including the classic `19121212-1212` (Tolvan Testsson). Prescriptions carry ATC codes, NPL pack ids, Swedish dosage texts, validity periods, iterations (uttag), and linked dispenses at named (fictional-context) pharmacies.

Reseed from scratch:

```bash
docker compose down -v && docker compose up --build
```

## Extending toward the real thing

When you point your extraction client at E-hälsomyndigheten's actual environments, expect these differences:

- Real OAuth/certificate-based auth and an agreement with E-hälsomyndigheten to access their test environments.
- Full NLL profiles (validate against the official FHIR packages on Simplifier: `SwedishNationalMedicationList-current`).
- More resources: consents (NLLAccessConsent), data locks/spärrar (NLLDataLock), Provenance, multi-dose dispensing, and custom operations beyond `$ping`.
- Purpose-of-use enforcement rather than warnings.

The mock's route layer (`server/src/routes/fhir.ts`) is deliberately thin so more resources or stricter validation can be added incrementally.

## Legal note

Real NLL data is regulated by lagen (2018:1212) om nationell läkemedelslista, with strict purpose limitation and access control. This mock exists precisely so no real patient data is needed during development.

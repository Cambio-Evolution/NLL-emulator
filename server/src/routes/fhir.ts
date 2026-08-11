import { Request, Response, Router } from 'express';
import { pool } from '../db';
import {
  AFF,
  isValidPersonnummer,
  operationOutcome,
  searchBundle,
} from '../fhir/helpers';
import { Resource, SYSTEMS } from '../fhir/types';

export const fhirRouter = Router();

function baseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}/fhir`;
}

function notFound(res: Response, what: string): void {
  res.status(404).json(operationOutcome('error', 'not-found', `${what} not found.`));
}

/* ------------------------------------------------------------------ */
/* CapabilityStatement                                                  */
/* ------------------------------------------------------------------ */

fhirRouter.get('/metadata', (req: Request, res: Response) => {
  res.json({
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString(),
    publisher: 'NLL Mock (not affiliated with E-hälsomyndigheten)',
    kind: 'instance',
    software: { name: 'nll-mock-server', version: '0.1.0' },
    implementation: {
      description:
        'Local mock of the Swedish National Medication List FHIR R4 API for client development',
      url: baseUrl(req),
    },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json'],
    rest: [
      {
        mode: 'server',
        resource: [
          {
            type: 'Patient',
            interaction: [{ code: 'read' }, { code: 'search-type' }],
            searchParam: [{ name: 'identifier', type: 'token' }],
          },
          {
            type: 'MedicationRequest',
            interaction: [{ code: 'read' }, { code: 'search-type' }],
            searchParam: [
              { name: 'patient', type: 'reference' },
              { name: 'status', type: 'token' },
            ],
          },
          {
            type: 'MedicationDispense',
            interaction: [{ code: 'read' }, { code: 'search-type' }],
            searchParam: [
              { name: 'patient', type: 'reference' },
              { name: 'prescription', type: 'reference' },
            ],
          },
        ],
        operation: [{ name: 'ping', definition: `${baseUrl(req)}/OperationDefinition/NLLPing` }],
      },
    ],
  });
});

/* ------------------------------------------------------------------ */
/* $ping                                                                */
/* ------------------------------------------------------------------ */

fhirRouter.get(/^\/\$ping$/, (_req: Request, res: Response) => {
  res.json({
    resourceType: 'Parameters',
    parameter: [
      { name: 'status', valueString: 'ok' },
      { name: 'timestamp', valueInstant: new Date().toISOString() },
    ],
  });
});

/* ------------------------------------------------------------------ */
/* Patient                                                              */
/* ------------------------------------------------------------------ */

// Search: GET /fhir/Patient?identifier=<system>|<pnr>  or  ?identifier=<pnr>
//         GET /fhir/Patient?_count=20&_offset=0&name=anna&_sort=-birthdate
fhirRouter.get('/Patient', async (req: Request, res: Response) => {
  const identifier = String(req.query.identifier ?? '');
  if (!identifier) {
    const count = Math.min(Math.max(1, Number(req.query._count ?? 20)), 100);
    const offset = Math.max(0, Number(req.query._offset ?? 0));
    const name = String(req.query.name ?? '').trim();
    const sort = String(req.query._sort ?? '');

    // Map _sort values to safe SQL ORDER BY clauses (allowlist — no raw interpolation)
    const orderBy = (() => {
      switch (sort) {
        case 'name':       return "resource->'name'->0->>'text' ASC";
        case '-name':      return "resource->'name'->0->>'text' DESC";
        case '-birthdate':
        case '-age':       return 'personnummer DESC';
        default:           return 'personnummer ASC'; // covers 'birthdate', 'age', ''
      }
    })();

    const buildPageUrl = (o: number): string => {
      const u = new URL(`${req.protocol}://${req.get('host')}/fhir/Patient`);
      u.searchParams.set('_count', String(count));
      u.searchParams.set('_offset', String(o));
      if (name) u.searchParams.set('name', name);
      if (sort) u.searchParams.set('_sort', sort);
      return u.toString();
    };

    let totalResult: { rows: { n: number }[] };
    let dataResult: { rows: { resource: Resource }[] };

    if (name) {
      const pattern = `%${name}%`;
      totalResult = await pool.query(
        `SELECT count(*)::int AS n FROM patients WHERE resource->'name'->0->>'text' ILIKE $1`,
        [pattern],
      );
      dataResult = await pool.query(
        `SELECT resource FROM patients WHERE resource->'name'->0->>'text' ILIKE $1
         ORDER BY ${orderBy} LIMIT $2 OFFSET $3`,
        [pattern, count, offset],
      );
    } else {
      totalResult = await pool.query('SELECT count(*)::int AS n FROM patients');
      dataResult = await pool.query(
        `SELECT resource FROM patients ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
        [count, offset],
      );
    }

    const total = totalResult.rows[0].n;
    const links: Array<{ relation: string; url: string }> = [
      { relation: 'self',  url: buildPageUrl(offset) },
      { relation: 'first', url: buildPageUrl(0) },
    ];
    if (offset > 0) {
      links.push({ relation: 'previous', url: buildPageUrl(Math.max(0, offset - count)) });
    }
    if (offset + count < total) {
      links.push({ relation: 'next', url: buildPageUrl(offset + count) });
    }

    res.json(
      searchBundle(
        dataResult.rows.map((r) => r.resource as Resource),
        baseUrl(req),
        buildPageUrl(offset),
        { total, links },
      ),
    );
    return;
  }

  const pnr = identifier.includes('|') ? identifier.split('|')[1] : identifier;
  const cleaned = pnr.replace(/[-+]/g, '');
  if (!isValidPersonnummer(cleaned)) {
    res.status(400).json(
      operationOutcome(
        'error',
        'invalid',
        `'${pnr}' is not a valid 12-digit Swedish personnummer (YYYYMMDDNNNN).`,
        { system: AFF.system, ...AFF.missingPersonnummer }
      )
    );
    return;
  }

  const { rows } = await pool.query(
    'SELECT resource FROM patients WHERE personnummer = $1',
    [cleaned]
  );
  if (rows.length === 0) {
    res.status(404).json(
      operationOutcome(
        'error',
        'not-found',
        'No patient with that personnummer exists in the register.',
        { system: AFF.system, ...AFF.unknownPatient }
      )
    );
    return;
  }
  res.json(
    searchBundle(
      rows.map((r) => r.resource as Resource),
      baseUrl(req),
      `${baseUrl(req)}/Patient?identifier=${encodeURIComponent(identifier)}`
    )
  );
});

fhirRouter.get('/Patient/:id', async (req: Request, res: Response) => {
  const { rows } = await pool.query('SELECT resource FROM patients WHERE id = $1', [
    req.params.id,
  ]);
  if (rows.length === 0) return notFound(res, 'Patient');
  res.json(rows[0].resource);
});

/* ------------------------------------------------------------------ */
/* MedicationRequest                                                    */
/* ------------------------------------------------------------------ */

// GET /fhir/MedicationRequest?patient=<id>&status=active
fhirRouter.get('/MedicationRequest', async (req: Request, res: Response) => {
  const patient = String(req.query.patient ?? '').replace(/^Patient\//, '');
  const status = req.query.status ? String(req.query.status) : null;
  if (!patient) {
    res
      .status(400)
      .json(
        operationOutcome(
          'error',
          'required',
          "The 'patient' search parameter is required (NLL does not allow unscoped prescription searches)."
        )
      );
    return;
  }
  const params: unknown[] = [patient];
  let sql =
    'SELECT resource FROM medication_requests WHERE patient_id = $1';
  if (status) {
    params.push(status);
    sql += ' AND status = $2';
  }
  sql += ' ORDER BY authored_on DESC';
  const { rows } = await pool.query(sql, params);
  res.json(
    searchBundle(
      rows.map((r) => r.resource as Resource),
      baseUrl(req),
      `${baseUrl(req)}/MedicationRequest?patient=${patient}${status ? `&status=${status}` : ''}`
    )
  );
});

fhirRouter.get('/MedicationRequest/:id', async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    'SELECT resource FROM medication_requests WHERE id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return notFound(res, 'MedicationRequest');
  res.json(rows[0].resource);
});

/* ------------------------------------------------------------------ */
/* MedicationDispense                                                   */
/* ------------------------------------------------------------------ */

// GET /fhir/MedicationDispense?patient=<id>&prescription=<rxId>
fhirRouter.get('/MedicationDispense', async (req: Request, res: Response) => {
  const patient = String(req.query.patient ?? '').replace(/^Patient\//, '');
  const prescription = String(req.query.prescription ?? '').replace(
    /^MedicationRequest\//,
    ''
  );
  if (!patient && !prescription) {
    res
      .status(400)
      .json(
        operationOutcome(
          'error',
          'required',
          "Provide 'patient' and/or 'prescription' search parameters."
        )
      );
    return;
  }
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (patient) {
    params.push(patient);
    clauses.push(`patient_id = $${params.length}`);
  }
  if (prescription) {
    params.push(prescription);
    clauses.push(`prescription_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT resource FROM medication_dispenses WHERE ${clauses.join(' AND ')} ORDER BY handed_over_at DESC`,
    params
  );
  res.json(
    searchBundle(
      rows.map((r) => r.resource as Resource),
      baseUrl(req),
      `${baseUrl(req)}/MedicationDispense`
    )
  );
});

fhirRouter.get('/MedicationDispense/:id', async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    'SELECT resource FROM medication_dispenses WHERE id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return notFound(res, 'MedicationDispense');
  res.json(rows[0].resource);
});

/* ------------------------------------------------------------------ */
/* Convenience: full medication list extraction for one patient        */
/* (Not part of the real NLL API — a helper for extraction clients.)   */
/* ------------------------------------------------------------------ */

fhirRouter.get(
  /^\/Patient\/([^/]+)\/\$medication-list$/,
  async (req: Request, res: Response) => {
    const patientId = req.params[0];
    const p = await pool.query('SELECT resource FROM patients WHERE id = $1', [
      patientId,
    ]);
    if (p.rows.length === 0) return notFound(res, 'Patient');
    const rx = await pool.query(
      'SELECT resource FROM medication_requests WHERE patient_id = $1 ORDER BY authored_on DESC',
      [patientId]
    );
    const disp = await pool.query(
      'SELECT resource FROM medication_dispenses WHERE patient_id = $1 ORDER BY handed_over_at DESC',
      [patientId]
    );
    const all: Resource[] = [
      p.rows[0].resource,
      ...rx.rows.map((r) => r.resource),
      ...disp.rows.map((r) => r.resource),
    ];
    res.json({
      resourceType: 'Bundle',
      type: 'collection',
      total: all.length,
      entry: all.map((r) => ({
        fullUrl: `${baseUrl(req)}/${r.resourceType}/${r.id}`,
        resource: r,
      })),
    });
  }
);

// Ensure identifier system constant is referenced (documented in README).
void SYSTEMS;

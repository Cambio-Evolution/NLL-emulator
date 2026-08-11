import { Bundle, BundleEntry, OperationOutcome, Resource } from './types';

export function operationOutcome(
  severity: 'fatal' | 'error' | 'warning' | 'information',
  code: string,
  diagnostics: string,
  detailsCode?: { system: string; code: string; display?: string }
): OperationOutcome {
  return {
    resourceType: 'OperationOutcome',
    issue: [
      {
        severity,
        code,
        diagnostics,
        ...(detailsCode ? { details: { coding: [detailsCode] } } : {}),
      },
    ],
  };
}

/** Error codes styled after NLL's automatic format/regulatory checks (AFF-kontroller). */
export const AFF = {
  system: 'https://mock.nll.local/fhir/CodeSystem/aff-kontroll',
  missingPersonnummer: {
    code: 'AFF-001',
    display: 'Patientens personnummer saknas eller har fel format',
  },
  unknownPatient: {
    code: 'AFF-014',
    display: 'Patienten finns inte i registret',
  },
  invalidStatus: {
    code: 'AFF-102',
    display: 'Ogiltig status för åtgärden',
  },
} as const;

export function searchBundle(
  resources: Resource[],
  baseUrl: string,
  selfUrl: string,
  opts?: {
    total?: number;
    links?: Array<{ relation: string; url: string }>;
  }
): Bundle {
  const entry: BundleEntry[] = resources.map((r) => ({
    fullUrl: `${baseUrl}/${r.resourceType}/${r.id}`,
    resource: r,
    search: { mode: 'match' },
  }));
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: opts?.total ?? resources.length,
    link: opts?.links ?? [{ relation: 'self', url: selfUrl }],
    entry,
  };
}

/** Validate Swedish personnummer format (12 digits, YYYYMMDDNNNN) incl. Luhn check. */
export function isValidPersonnummer(pnr: string): boolean {
  const cleaned = pnr.replace(/[-+]/g, '');
  if (!/^\d{12}$/.test(cleaned)) return false;
  const tenDigit = cleaned.slice(2);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(tenDigit[i], 10) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === parseInt(tenDigit[9], 10);
}

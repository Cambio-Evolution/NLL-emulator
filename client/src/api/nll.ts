/**
 * Thin client for the NLL mock. Mirrors the flow a real integration uses:
 * 1. Fetch an OAuth2 token (client_credentials)
 * 2. Call the FHIR API with Bearer auth + NLL headers
 */

export interface FhirBundle {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry?: Array<{ fullUrl?: string; resource?: any }>;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.value;
  }
  const res = await fetch('/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'nll-mock-client',
      client_secret: 'nll-mock-secret',
    }),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status})`);
  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

export async function fhir<T = any>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`/fhir${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
      'x-purpose-of-use': 'TREAT',
      'x-system-id': 'nll-mock-client-ui',
    },
  });
  const body = await res.json();
  if (!res.ok) {
    const diag =
      body?.issue?.[0]?.diagnostics || `FHIR request failed (${res.status})`;
    throw new Error(diag);
  }
  return body as T;
}

export const api = {
  listPatients: () => fhir<FhirBundle>('/Patient'),
  findPatientByPnr: (pnr: string) =>
    fhir<FhirBundle>(`/Patient?identifier=${encodeURIComponent(pnr)}`),
  medicationRequests: (patientId: string, status?: string) =>
    fhir<FhirBundle>(
      `/MedicationRequest?patient=${patientId}${status ? `&status=${status}` : ''}`
    ),
  dispensesForPrescription: (rxId: string) =>
    fhir<FhirBundle>(`/MedicationDispense?prescription=${rxId}`),
  medicationList: (patientId: string) =>
    fhir<FhirBundle>(`/Patient/${patientId}/$medication-list`),
};

export function entries(bundle: FhirBundle | null | undefined): any[] {
  return (bundle?.entry ?? []).map((e) => e.resource).filter(Boolean);
}

export function formatPnr(pnr: string): string {
  return pnr.length === 12 ? `${pnr.slice(0, 8)}-${pnr.slice(8)}` : pnr;
}

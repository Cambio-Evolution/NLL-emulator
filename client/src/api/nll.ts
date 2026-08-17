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

// In local dev (Vite proxy) this is empty; on Render set VITE_API_BASE to
// the full server URL, e.g. https://nll-mock-server.onrender.com
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

let cachedToken: { value: string; expiresAt: number } | null = null;

async function readJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      `Empty response body (${res.status} ${res.statusText}) from ${res.url}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    const preview = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Expected JSON but got non-JSON response (${res.status} ${res.statusText}) from ${res.url}${preview ? `: ${preview}` : ''}`
    );
  }
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.value;
  }
  const res = await fetch(`${API_BASE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'nll-mock-client',
      client_secret: 'nll-mock-secret',
    }),
  });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    const detail =
      data?.error_description || data?.error || `Token request failed (${res.status})`;
    throw new Error(detail);
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

export async function fhir<T = any>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/fhir${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
      'x-purpose-of-use': 'TREAT',
      'x-system-id': 'nll-mock-client-ui',
    },
  });
  const body = await readJsonResponse(res);
  if (!res.ok) {
    const diag =
      body?.issue?.[0]?.diagnostics || `FHIR request failed (${res.status})`;
    throw new Error(diag);
  }
  return body as T;
}

export const api = {
  listPatients: (params?: { offset?: number; count?: number; name?: string; sort?: string }) => {
    const qs = new URLSearchParams();
    qs.set('_count', String(params?.count ?? 20));
    qs.set('_offset', String(params?.offset ?? 0));
    if (params?.name) qs.set('name', params.name);
    if (params?.sort) qs.set('_sort', params.sort);
    return fhir<FhirBundle>(`/Patient?${qs}`);
  },
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

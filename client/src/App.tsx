import { useEffect, useMemo, useState } from 'react';
import { api, entries, FhirBundle, formatPnr } from './api/nll';

type AnyResource = Record<string, any>;

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktiv',
  completed: 'Slutexpedierad',
  stopped: 'Avslutad',
  cancelled: 'Makulerad',
  'on-hold': 'Parkerad',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill pill--${status}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function ResourceDrawer({
  resource,
  onClose,
}: {
  resource: AnyResource | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!resource) return null;
  const json = JSON.stringify(resource, null, 2);
  return (
    <div className="drawer" role="dialog" aria-label="FHIR resource inspector">
      <div className="drawer__bar">
        <span className="drawer__title">
          {resource.resourceType}/{resource.id}
        </span>
        <div className="drawer__actions">
          <button
            className="btn btn--ghost"
            onClick={() => {
              navigator.clipboard.writeText(json).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'Kopierad' : 'Kopiera JSON'}
          </button>
          <button className="btn btn--ghost" onClick={onClose}>
            Stäng
          </button>
        </div>
      </div>
      <pre className="drawer__json">{json}</pre>
    </div>
  );
}

function PrescriptionCard({
  rx,
  onInspect,
}: {
  rx: AnyResource;
  onInspect: (r: AnyResource) => void;
}) {
  const [dispenses, setDispenses] = useState<AnyResource[] | null>(null);
  const [open, setOpen] = useState(false);

  const atc = rx.medicationCodeableConcept?.coding?.find(
    (c: any) => c.system?.includes('atc')
  )?.code;
  const validUntil = rx.dispenseRequest?.validityPeriod?.end;

  async function toggleDispenses() {
    const next = !open;
    setOpen(next);
    if (next && dispenses === null) {
      const bundle = await api.dispensesForPrescription(rx.id);
      setDispenses(entries(bundle));
    }
  }

  return (
    <article className="rx">
      <header className="rx__head">
        <div>
          <h3 className="rx__name">{rx.medicationCodeableConcept?.text}</h3>
          <p className="rx__meta">
            {atc && <span className="mono">{atc}</span>}
            {rx.reasonCode?.[0]?.text && (
              <span> · {rx.reasonCode[0].text}</span>
            )}
            {rx.requester?.display && <span> · Förskrivare: {rx.requester.display}</span>}
          </p>
        </div>
        <StatusPill status={rx.status} />
      </header>

      <dl className="rx__facts">
        <div>
          <dt>Dosering</dt>
          <dd>{rx.dosageInstruction?.[0]?.text ?? '—'}</dd>
        </div>
        <div>
          <dt>Förskriven</dt>
          <dd className="mono">{rx.authoredOn ?? '—'}</dd>
        </div>
        <div>
          <dt>Giltig t.o.m.</dt>
          <dd className="mono">{validUntil ?? '—'}</dd>
        </div>
        <div>
          <dt>Uttag kvar</dt>
          <dd>{rx.dispenseRequest?.numberOfRepeatsAllowed ?? 0} iterationer</dd>
        </div>
      </dl>

      <div className="rx__foot">
        <button className="btn btn--ghost" onClick={toggleDispenses}>
          {open ? 'Dölj uttag' : 'Visa uttag'}
        </button>
        <button className="btn btn--ghost" onClick={() => onInspect(rx)}>
          Rå FHIR
        </button>
      </div>

      {open && (
        <div className="dispenses">
          {dispenses === null && <p className="muted">Hämtar uttag…</p>}
          {dispenses?.length === 0 && (
            <p className="muted">Inga uttag registrerade för denna förskrivning.</p>
          )}
          {dispenses?.map((d) => (
            <div className="dispense" key={d.id}>
              <span className="mono">
                {d.whenHandedOver?.slice(0, 10) ?? '—'}
              </span>
              <span>{d.location?.display ?? 'Okänt apotek'}</span>
              <span>
                {d.quantity?.value} × {d.quantity?.unit}
              </span>
              <button className="btn btn--link" onClick={() => onInspect(d)}>
                FHIR
              </button>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [patients, setPatients] = useState<AnyResource[]>([]);
  const [patientTotal, setPatientTotal] = useState(0);
  const [patientOffset, setPatientOffset] = useState(0);
  const [patientNameInput, setPatientNameInput] = useState('');
  const [patientNameFilter, setPatientNameFilter] = useState('');
  const [patientSort, setPatientSort] = useState('');
  const [patientLoading, setPatientLoading] = useState(false);
  const PAGE_SIZE = 20;

  const [selected, setSelected] = useState<AnyResource | null>(null);
  const [rxBundle, setRxBundle] = useState<FhirBundle | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<AnyResource | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounce name filter — reset to page 1 when filter changes
  useEffect(() => {
    const t = setTimeout(() => {
      setPatientOffset(0);
      setPatientNameFilter(patientNameInput);
    }, 350);
    return () => clearTimeout(t);
  }, [patientNameInput]);

  // Reset to page 1 when sort changes
  useEffect(() => {
    setPatientOffset(0);
  }, [patientSort]);

  // Fetch patient page whenever offset, name filter, or sort changes
  useEffect(() => {
    setPatientLoading(true);
    api
      .listPatients({
        offset: patientOffset,
        count: PAGE_SIZE,
        name: patientNameFilter || undefined,
        sort: patientSort || undefined,
      })
      .then((b) => {
        setPatients(entries(b));
        setPatientTotal(b.total ?? 0);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setPatientLoading(false));
  }, [patientOffset, patientNameFilter]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setRxBundle(null);
    api
      .medicationRequests(selected.id, statusFilter || undefined)
      .then((b) => {
        setRxBundle(b);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selected, statusFilter]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    setError(null);
    try {
      const bundle = await api.findPatientByPnr(search.trim());
      const found = entries(bundle)[0];
      if (found) setSelected(found);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function downloadExtract() {
    if (!selected) return;
    const bundle = await api.medicationList(selected.id);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/fhir+json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nll-extract-${selected.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const prescriptions = useMemo(() => entries(rxBundle), [rxBundle]);

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead__brand">
          <span className="masthead__reg">REGISTERUTDRAG</span>
          <h1>Nationella läkemedelslistan</h1>
          <p className="masthead__sub">
            Lokal mocktjänst · FHIR R4 · ej ansluten till E-hälsomyndigheten
          </p>
        </div>
        <span className="stamp" aria-label="Endast testdata">
          TESTDATA
        </span>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <form className="search" onSubmit={onSearch}>
            <label htmlFor="pnr">Slå upp personnummer</label>
            <div className="search__row">
              <input
                id="pnr"
                className="mono"
                placeholder="ÅÅÅÅMMDDNNNN"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="btn btn--primary" type="submit">
                Sök
              </button>
            </div>
          </form>

          <h2 className="sidebar__heading">Testpersoner</h2>

          <div className="patient-filter">
            <input
              placeholder="Filtrera på namn…"
              value={patientNameInput}
              onChange={(e) => setPatientNameInput(e.target.value)}
              aria-label="Filtrera patientlista på namn"
            />
            <select
              value={patientSort}
              onChange={(e) => setPatientSort(e.target.value)}
              aria-label="Sortera patientlista"
              className="patient-sort"
            >
              <option value="">Sortera: standard</option>
              <option value="name">Namn A–Ö</option>
              <option value="-name">Namn Ö–A</option>
              <option value="birthdate">Ålder: äldst först</option>
              <option value="-birthdate">Ålder: yngst först</option>
            </select>
          </div>

          {patientLoading && (
            <p className="muted" style={{ fontSize: '13px', padding: '6px 0' }}>
              Hämtar…
            </p>
          )}

          <ul className="patients">
            {patients.map((p) => {
              const pnr = p.identifier?.[0]?.value ?? '';
              return (
                <li key={p.id}>
                  <button
                    className={`patient ${selected?.id === p.id ? 'patient--active' : ''}`}
                    onClick={() => setSelected(p)}
                  >
                    <span className="patient__name">{p.name?.[0]?.text}</span>
                    <span className="patient__pnr mono">{formatPnr(pnr)}</span>
                  </button>
                </li>
              );
            })}
            {!patientLoading && patients.length === 0 && (
              <li className="muted" style={{ fontSize: '13px', padding: '6px 0' }}>
                Inga patienter matchar.
              </li>
            )}
          </ul>

          <div className="pagination">
            <span className="pagination__info">
              {patientTotal === 0
                ? 'Inga träffar'
                : `${patientOffset + 1}–${Math.min(patientOffset + PAGE_SIZE, patientTotal)} av ${patientTotal}`}
            </span>
            <div className="pagination__controls">
              <button
                className="btn btn--ghost btn--sm"
                disabled={patientOffset === 0}
                onClick={() => setPatientOffset(Math.max(0, patientOffset - PAGE_SIZE))}
                aria-label="Föregående sida"
              >
                ←
              </button>
              <button
                className="btn btn--ghost btn--sm"
                disabled={patientOffset + PAGE_SIZE >= patientTotal}
                onClick={() => setPatientOffset(patientOffset + PAGE_SIZE)}
                aria-label="Nästa sida"
              >
                →
              </button>
            </div>
          </div>
        </aside>

        <main className="content">
          {error && <div className="error">{error}</div>}

          {!selected && !error && (
            <div className="empty">
              <p>
                Välj en testperson eller slå upp ett personnummer för att hämta
                förskrivningar och uttag ur mockregistret.
              </p>
            </div>
          )}

          {selected && (
            <>
              <div className="content__head">
                <div>
                  <h2>{selected.name?.[0]?.text}</h2>
                  <p className="mono muted">
                    {formatPnr(selected.identifier?.[0]?.value ?? '')} ·{' '}
                    {selected.gender === 'female' ? 'Kvinna' : 'Man'} · Född{' '}
                    {selected.birthDate}
                  </p>
                </div>
                <div className="content__tools">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    aria-label="Filtrera på status"
                  >
                    <option value="">Alla statusar</option>
                    <option value="active">Aktiva</option>
                    <option value="completed">Slutexpedierade</option>
                    <option value="stopped">Avslutade</option>
                    <option value="cancelled">Makulerade</option>
                  </select>
                  <button className="btn btn--primary" onClick={downloadExtract}>
                    Ladda ner utdrag (JSON)
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={() => setInspect(selected)}
                  >
                    Rå FHIR
                  </button>
                </div>
              </div>

              {loading && <p className="muted">Hämtar förskrivningar…</p>}
              {!loading && prescriptions.length === 0 && (
                <div className="empty">
                  <p>Inga förskrivningar matchar filtret.</p>
                </div>
              )}
              <div className="rx-list">
                {prescriptions.map((rx) => (
                  <PrescriptionCard key={rx.id} rx={rx} onInspect={setInspect} />
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      <ResourceDrawer resource={inspect} onClose={() => setInspect(null)} />
    </div>
  );
}

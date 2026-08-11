import { randomUUID } from 'crypto';
import { migrate, pool } from './db';
import {
  MedicationDispense,
  MedicationRequest,
  Patient,
  PROFILES,
  SYSTEMS,
} from './fhir/types';

/**
 * All identities below are SYNTHETIC. Personnummer are generated with a valid
 * Luhn check digit from birth dates that make them structurally correct, in
 * the spirit of Skatteverket's published test identities (the real NLL
 * implementation guide uses Skatteverket test numbers in its examples).
 */

function luhnDigit(tenDigitsWithoutCheck: string): number {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(tenDigitsWithoutCheck[i], 10) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

function makePnr(yyyymmdd: string, birthNumber: string): string {
  // birthNumber: 3 digits. Check digit computed over YYMMDD + birthNumber.
  const base = yyyymmdd.slice(2) + birthNumber;
  return yyyymmdd + birthNumber + String(luhnDigit(base));
}

interface SeedPatient {
  pnr: string;
  family: string;
  given: string[];
  gender: 'male' | 'female';
  birthDate: string;
}

const seedPatients: SeedPatient[] = [
  {
    pnr: makePnr('19121212', '121'), // classic Skatteverket-style test date
    family: 'Testsson',
    given: ['Tolvan'],
    gender: 'male',
    birthDate: '1912-12-12',
  },
  {
    pnr: makePnr('19460815', '224'),
    family: 'Lindqvist',
    given: ['Margareta'],
    gender: 'female',
    birthDate: '1946-08-15',
  },
  {
    pnr: makePnr('19781102', '389'),
    family: 'Öberg',
    given: ['Henrik', 'Emil'],
    gender: 'male',
    birthDate: '1978-11-02',
  },
  {
    pnr: makePnr('19950327', '162'),
    family: 'Ahmadi',
    given: ['Sara'],
    gender: 'female',
    birthDate: '1995-03-27',
  },
  {
    pnr: makePnr('20080519', '445'),
    family: 'Nyström',
    given: ['Alva'],
    gender: 'female',
    birthDate: '2008-05-19',
  },
];

interface SeedRx {
  atc: string;
  nplPackId: string;
  name: string;
  form: string;
  status: MedicationRequest['status'];
  reason: string;
  dosageText: string;
  patientInstruction: string;
  repeats: number;
  packSize: string;
  dispenses: Array<{ daysAgo: number; pharmacy: string }>;
}

const catalog: Record<string, SeedRx[]> = {
  Testsson: [
    {
      atc: 'C07AB02',
      nplPackId: '20030101100055',
      name: 'Metoprolol Sandoz 50 mg depottablett',
      form: 'Depottablett',
      status: 'active',
      reason: 'Hypertoni',
      dosageText: '1 tablett 1 gång dagligen',
      patientInstruction: 'Tas på morgonen med ett glas vatten',
      repeats: 3,
      packSize: '100 tabletter',
      dispenses: [
        { daysAgo: 200, pharmacy: 'Apoteket Hjärtat Kista Galleria' },
        { daysAgo: 95, pharmacy: 'Apoteket Hjärtat Kista Galleria' },
      ],
    },
    {
      atc: 'B01AC06',
      nplPackId: '19990201100017',
      name: 'Trombyl 75 mg tablett',
      form: 'Tablett',
      status: 'active',
      reason: 'Trombosprofylax',
      dosageText: '1 tablett dagligen',
      patientInstruction: 'Tas vid samma tidpunkt varje dag',
      repeats: 3,
      packSize: '98 tabletter',
      dispenses: [{ daysAgo: 60, pharmacy: 'Kronans Apotek Solna Centrum' }],
    },
    {
      atc: 'N02BE01',
      nplPackId: '20101115100093',
      name: 'Alvedon 500 mg filmdragerad tablett',
      form: 'Filmdragerad tablett',
      status: 'completed',
      reason: 'Smärta',
      dosageText: '1-2 tabletter vid behov, högst 8 tabletter per dygn',
      patientInstruction: 'Vid behov mot smärta. Överskrid inte maxdosen.',
      repeats: 0,
      packSize: '100 tabletter',
      dispenses: [{ daysAgo: 310, pharmacy: 'Apotek Produktion & Laboratorier' }],
    },
  ],
  Lindqvist: [
    {
      atc: 'A10BA02',
      nplPackId: '20040820100031',
      name: 'Metformin Actavis 850 mg filmdragerad tablett',
      form: 'Filmdragerad tablett',
      status: 'active',
      reason: 'Diabetes mellitus typ 2',
      dosageText: '1 tablett 2 gånger dagligen i samband med måltid',
      patientInstruction: 'Tas med frukost och middag',
      repeats: 3,
      packSize: '100 tabletter',
      dispenses: [
        { daysAgo: 150, pharmacy: 'Apoteket Ekorren Uppsala' },
        { daysAgo: 55, pharmacy: 'Apoteket Ekorren Uppsala' },
      ],
    },
    {
      atc: 'C10AA05',
      nplPackId: '20051212100078',
      name: 'Atorvastatin Krka 20 mg filmdragerad tablett',
      form: 'Filmdragerad tablett',
      status: 'stopped',
      reason: 'Hyperlipidemi',
      dosageText: '1 tablett till natten',
      patientInstruction: 'Tas på kvällen',
      repeats: 3,
      packSize: '100 tabletter',
      dispenses: [{ daysAgo: 400, pharmacy: 'Lloyds Apotek Väsby' }],
    },
  ],
  Öberg: [
    {
      atc: 'R03AC02',
      nplPackId: '20070605100042',
      name: 'Ventoline Evohaler 0,1 mg/dos inhalationsspray',
      form: 'Inhalationsspray, suspension',
      status: 'active',
      reason: 'Astma',
      dosageText: '1-2 inhalationer vid behov',
      patientInstruction: 'Vid andningsbesvär. Skölj munnen efter användning.',
      repeats: 2,
      packSize: '200 doser',
      dispenses: [{ daysAgo: 30, pharmacy: 'Apoteksgruppen Kista Centrum' }],
    },
  ],
  Ahmadi: [
    {
      atc: 'N06AB10',
      nplPackId: '20120301100019',
      name: 'Escitalopram Teva 10 mg filmdragerad tablett',
      form: 'Filmdragerad tablett',
      status: 'active',
      reason: 'Depression',
      dosageText: '1 tablett 1 gång dagligen',
      patientInstruction: 'Tas på morgonen',
      repeats: 3,
      packSize: '98 tabletter',
      dispenses: [
        { daysAgo: 120, pharmacy: 'Apoteket Hjärtat Mall of Scandinavia' },
        { daysAgo: 25, pharmacy: 'Apoteket Hjärtat Mall of Scandinavia' },
      ],
    },
    {
      atc: 'G03AA12',
      nplPackId: '20140908100066',
      name: 'Yasmin 0,03 mg/3 mg filmdragerad tablett',
      form: 'Filmdragerad tablett',
      status: 'cancelled',
      reason: 'Antikonception',
      dosageText: '1 tablett dagligen i 21 dagar, därefter 7 dagars uppehåll',
      patientInstruction: 'Tas vid samma tidpunkt varje dag',
      repeats: 1,
      packSize: '3 x 21 tabletter',
      dispenses: [],
    },
  ],
  Nyström: [
    {
      atc: 'R06AE07',
      nplPackId: '20160222100084',
      name: 'Cetirizin Sandoz 10 mg filmdragerad tablett',
      form: 'Filmdragerad tablett',
      status: 'active',
      reason: 'Allergisk rinit',
      dosageText: '1 tablett dagligen under pollensäsong',
      patientInstruction: 'Kan tas oberoende av måltid',
      repeats: 2,
      packSize: '30 tabletter',
      dispenses: [{ daysAgo: 45, pharmacy: 'Kronans Apotek Kista' }],
    },
  ],
};

const prescribers = [
  { name: 'Anna Bergström', hsaId: 'SE2321000016-1003' },
  { name: 'Lars Ekholm', hsaId: 'SE2321000016-2047' },
  { name: 'Fatima Haddad', hsaId: 'SE2321000016-3391' },
];

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export async function seed(): Promise<void> {
  await migrate();

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM patients');
  if (rows[0].n > 0) {
    console.log('Database already seeded, skipping.');
    return;
  }

  for (const sp of seedPatients) {
    const patientId = randomUUID();
    const patient: Patient = {
      resourceType: 'Patient',
      id: patientId,
      meta: { profile: [PROFILES.patient] },
      identifier: [{ system: SYSTEMS.personnummer, value: sp.pnr }],
      name: [
        {
          family: sp.family,
          given: sp.given,
          text: `${sp.given.join(' ')} ${sp.family}`,
        },
      ],
      gender: sp.gender,
      birthDate: sp.birthDate,
    };
    await pool.query(
      'INSERT INTO patients (id, personnummer, resource) VALUES ($1, $2, $3)',
      [patientId, sp.pnr, JSON.stringify(patient)]
    );

    const rxList = catalog[sp.family] ?? [];
    for (const rx of rxList) {
      const rxId = randomUUID();
      const prescriber =
        prescribers[Math.floor(Math.random() * prescribers.length)];
      const authored = daysAgoIso(
        rx.dispenses.length > 0
          ? Math.max(...rx.dispenses.map((d) => d.daysAgo)) + 14
          : 30
      );
      const validUntil = new Date(authored);
      validUntil.setFullYear(validUntil.getFullYear() + 1);

      const medicationRequest: MedicationRequest = {
        resourceType: 'MedicationRequest',
        id: rxId,
        meta: { profile: [PROFILES.medicationRequest] },
        identifier: [{ system: SYSTEMS.prescriptionId, value: rxId }],
        status: rx.status,
        intent: 'order',
        medicationCodeableConcept: {
          coding: [
            { system: SYSTEMS.nplPackId, code: rx.nplPackId },
            { system: SYSTEMS.atc, code: rx.atc },
          ],
          text: rx.name,
        },
        subject: {
          reference: `Patient/${patientId}`,
          display: `${sp.given.join(' ')} ${sp.family}`,
        },
        authoredOn: dateOnly(authored),
        requester: {
          reference: `Practitioner/${prescriber.hsaId}`,
          display: prescriber.name,
        },
        reasonCode: [{ text: rx.reason }],
        dosageInstruction: [
          {
            sequence: 1,
            text: rx.dosageText,
            patientInstruction: rx.patientInstruction,
          },
        ],
        dispenseRequest: {
          validityPeriod: {
            start: dateOnly(authored),
            end: dateOnly(validUntil.toISOString()),
          },
          numberOfRepeatsAllowed: rx.repeats,
          quantity: { value: 1, unit: rx.packSize },
        },
        substitution: { allowedBoolean: true },
      };

      await pool.query(
        `INSERT INTO medication_requests (id, patient_id, status, authored_on, atc_code, resource)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          rxId,
          patientId,
          rx.status,
          dateOnly(authored),
          rx.atc,
          JSON.stringify(medicationRequest),
        ]
      );

      for (const disp of rx.dispenses) {
        const dispId = randomUUID();
        const when = daysAgoIso(disp.daysAgo);
        const dispense: MedicationDispense = {
          resourceType: 'MedicationDispense',
          id: dispId,
          meta: { profile: [PROFILES.medicationDispense] },
          status: 'completed',
          medicationCodeableConcept:
            medicationRequest.medicationCodeableConcept,
          subject: medicationRequest.subject,
          authorizingPrescription: [
            { reference: `MedicationRequest/${rxId}` },
          ],
          quantity: { value: 1, unit: rx.packSize },
          whenHandedOver: when,
          location: { display: disp.pharmacy },
          dosageInstruction: medicationRequest.dosageInstruction,
        };
        await pool.query(
          `INSERT INTO medication_dispenses (id, patient_id, prescription_id, status, handed_over_at, resource)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [dispId, patientId, rxId, 'completed', when, JSON.stringify(dispense)]
        );
      }
    }
    console.log(`Seeded ${sp.given.join(' ')} ${sp.family} (${sp.pnr})`);
  }
  console.log('Seed complete.');
}

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

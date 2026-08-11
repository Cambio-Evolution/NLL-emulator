/**
 * Bulk seed: generates 1 000 synthetic patients with varied, age-appropriate
 * medication profiles.  Designed to run as a second phase after the five named
 * test patients have been inserted by seed.ts.
 *
 * Standalone:  npm run seed-bulk
 * Automatic:   called from seed() when patient count < 1 005
 */
import { randomUUID } from 'crypto';
import { migrate, pool } from './db';
import {
  MedicationDispense,
  MedicationRequest,
  Patient,
  PROFILES as FHIR_PROFILES,
  SYSTEMS,
} from './fhir/types';

// ── small helpers ─────────────────────────────────────────────────────────────

function luhnDigit(ten: string): number {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(ten[i], 10) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

function makePnr(yyyymmdd: string, birthNum: string): string {
  const base = yyyymmdd.slice(2) + birthNum;
  return yyyymmdd + birthNum + String(luhnDigit(base));
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── name pools ────────────────────────────────────────────────────────────────

const FEMALE_GIVEN = [
  'Anna','Maria','Eva','Karin','Sara','Lena','Emma','Sofia','Ida','Maja',
  'Lisa','Hanna','Ingrid','Britta','Elin','Johanna','Linda','Kristina',
  'Birgitta','Susanne','Helena','Katarina','Monica','Ulrika','Annika',
  'Camilla','Petra','Jenny','Therese','Cecilia','Frida','Jessica','Malin',
  'Åsa','Gunilla','Elisabeth','Marianne','Carina','Agneta','Yvonne',
  'Lovisa','Klara','Nora','Alice','Elsa','Ebba','Saga','Moa','Tilda','Wilma',
] as const;

const MALE_GIVEN = [
  'Erik','Lars','Karl','Per','Johan','Anders','Mikael','Stefan','Peter',
  'Thomas','Daniel','Magnus','Jonas','Henrik','Mattias','Andreas','David',
  'Patrik','Joakim','Martin','Oscar','Gustav','Viktor','Filip','Anton',
  'Simon','Alexander','Marcus','Jakob','Emil','Tobias','Sebastian','Adam',
  'Robin','Christoffer','Niklas','Robert','Björn','Kenneth','Jan','Bengt',
  'Göran','Gunnar','Håkan','Sven','Olof','Nils','Bo','Axel','Hugo',
] as const;

const LAST_NAMES = [
  'Johansson','Andersson','Karlsson','Nilsson','Eriksson','Larsson','Olsson',
  'Persson','Svensson','Gustafsson','Pettersson','Jonsson','Jansson',
  'Hansson','Bengtsson','Jönsson','Lindström','Lindgren','Bergström',
  'Lindberg','Magnusson','Danielsson','Martinsson','Lund','Bergman','Holm',
  'Fransson','Henriksson','Isaksson','Jakobsson','Månsson','Nyman',
  'Sandberg','Sjögren','Wallin','Öhman','Åsberg','Bäckström','Holmberg',
  'Sundström','Engström','Björklund','Söderberg','Wikström','Nordin',
  'Hedlund','Ström','Nordström','Dahlberg','Hellström',
] as const;

// ── prescribers & pharmacies ──────────────────────────────────────────────────

const PRESCRIBERS = [
  { name: 'Anna Bergström',   hsaId: 'SE2321000016-1003' },
  { name: 'Lars Ekholm',      hsaId: 'SE2321000016-2047' },
  { name: 'Fatima Haddad',    hsaId: 'SE2321000016-3391' },
  { name: 'Erik Söderberg',   hsaId: 'SE2321000016-4812' },
  { name: 'Maria Lindqvist',  hsaId: 'SE2321000016-5234' },
  { name: 'Johan Holm',       hsaId: 'SE2321000016-6109' },
  { name: 'Karin Bergman',    hsaId: 'SE2321000016-7756' },
  { name: 'Anders Nordin',    hsaId: 'SE2321000016-8423' },
] as const;

const PHARMACIES = [
  'Apoteket Hjärtat Kista Galleria',
  'Apoteket Hjärtat Mall of Scandinavia',
  'Kronans Apotek Solna Centrum',
  'Kronans Apotek Kista',
  'Apoteket Ekorren Uppsala',
  'Lloyds Apotek Väsby',
  'Apotek Produktion & Laboratorier',
  'Apoteksgruppen Kista Centrum',
  'Apoteket Hjärtat Hötorget',
  'Apoteket Hjärtat Farsta Centrum',
  'Kronans Apotek Flemingsberg',
  'Apoteket Hjärtat Täby Centrum',
  'Apoteket Hjärtat Nacka Forum',
  'Kronans Apotek Haninge',
  'Apoteket Liljeholmen',
] as const;

// ── medication catalog ────────────────────────────────────────────────────────

interface MedTemplate {
  atc: string;
  nplPackId: string;
  name: string;
  form: string;
  reason: string;
  dosageText: string;
  patientInstruction: string;
  packSize: string;
}

const MEDS: Record<string, MedTemplate> = {
  // ── Cardiovascular ──────────────────────────────────────────────────────────
  metoprololLow: {
    atc: 'C07AB02', nplPackId: '20030101100055',
    name: 'Metoprolol Sandoz 50 mg depottablett', form: 'Depottablett',
    reason: 'Hypertoni',
    dosageText: '1 tablett 1 gång dagligen',
    patientInstruction: 'Tas på morgonen med ett glas vatten',
    packSize: '100 tabletter',
  },
  metoprololHigh: {
    atc: 'C07AB02', nplPackId: '20030102100056',
    name: 'Metoprolol Sandoz 100 mg depottablett', form: 'Depottablett',
    reason: 'Hypertoni',
    dosageText: '1 tablett 1 gång dagligen',
    patientInstruction: 'Tas på morgonen',
    packSize: '100 tabletter',
  },
  ramipril: {
    atc: 'C09AA05', nplPackId: '20050315100061',
    name: 'Ramipril Actavis 5 mg kapsel', form: 'Kapsel',
    reason: 'Hypertoni',
    dosageText: '1 kapsel 1 gång dagligen',
    patientInstruction: 'Kan tas med eller utan mat',
    packSize: '98 kapslar',
  },
  amlodipine: {
    atc: 'C08CA01', nplPackId: '20060820100074',
    name: 'Amlodipin Sandoz 5 mg tablett', form: 'Tablett',
    reason: 'Hypertoni',
    dosageText: '1 tablett dagligen',
    patientInstruction: 'Tas vid samma tid varje dag',
    packSize: '100 tabletter',
  },
  lisinopril: {
    atc: 'C09AA03', nplPackId: '20040610100068',
    name: 'Lisinopril Actavis 10 mg tablett', form: 'Tablett',
    reason: 'Hjärtsvikt',
    dosageText: '1 tablett 1 gång dagligen',
    patientInstruction: 'Tas på morgonen',
    packSize: '100 tabletter',
  },
  furosemide: {
    atc: 'C03CA01', nplPackId: '19950507100003',
    name: 'Furosemid Orifarm 40 mg tablett', form: 'Tablett',
    reason: 'Hjärtsvikt',
    dosageText: '1 tablett på morgonen',
    patientInstruction: 'Tas tidigt på morgonen',
    packSize: '100 tabletter',
  },
  atorvastatin: {
    atc: 'C10AA05', nplPackId: '20051212100078',
    name: 'Atorvastatin Krka 20 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Hyperlipidemi',
    dosageText: '1 tablett till natten',
    patientInstruction: 'Tas på kvällen',
    packSize: '100 tabletter',
  },
  simvastatin: {
    atc: 'C10AA01', nplPackId: '19980312100009',
    name: 'Simvastatin Teva 40 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Hyperlipidemi',
    dosageText: '1 tablett till natten',
    patientInstruction: 'Tas på kvällen',
    packSize: '98 tabletter',
  },
  aspirin: {
    atc: 'B01AC06', nplPackId: '19990201100017',
    name: 'Trombyl 75 mg tablett', form: 'Tablett',
    reason: 'Trombosprofylax',
    dosageText: '1 tablett dagligen',
    patientInstruction: 'Tas vid samma tidpunkt varje dag',
    packSize: '98 tabletter',
  },
  warfarin: {
    atc: 'B01AA03', nplPackId: '20020914100047',
    name: 'Waran 2,5 mg tablett', form: 'Tablett',
    reason: 'Förmaksflimmer – trombosprofylax',
    dosageText: 'Doseras individuellt enligt INR',
    patientInstruction: 'Kontrollera INR regelbundet. Ta alltid exakt ordinerad dos.',
    packSize: '100 tabletter',
  },
  apixaban: {
    atc: 'B01AF02', nplPackId: '20131005100091',
    name: 'Eliquis 5 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Förmaksflimmer – trombosprofylax',
    dosageText: '1 tablett 2 gånger dagligen',
    patientInstruction: 'Tas morgon och kväll',
    packSize: '60 tabletter',
  },
  // ── Diabetes ────────────────────────────────────────────────────────────────
  metformin: {
    atc: 'A10BA02', nplPackId: '20040820100031',
    name: 'Metformin Actavis 850 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Diabetes mellitus typ 2',
    dosageText: '1 tablett 2 gånger dagligen i samband med måltid',
    patientInstruction: 'Tas med frukost och middag',
    packSize: '100 tabletter',
  },
  sitagliptin: {
    atc: 'A10BH01', nplPackId: '20080124100083',
    name: 'Januvia 100 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Diabetes mellitus typ 2',
    dosageText: '1 tablett dagligen',
    patientInstruction: 'Kan tas med eller utan mat',
    packSize: '28 tabletter',
  },
  dapagliflozin: {
    atc: 'A10BK01', nplPackId: '20130626100089',
    name: 'Forxiga 10 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Diabetes mellitus typ 2',
    dosageText: '1 tablett dagligen',
    patientInstruction: 'Tas på morgonen',
    packSize: '30 tabletter',
  },
  // ── Respiratory ─────────────────────────────────────────────────────────────
  salbutamol: {
    atc: 'R03AC02', nplPackId: '20070605100042',
    name: 'Ventoline Evohaler 0,1 mg/dos inhalationsspray', form: 'Inhalationsspray, suspension',
    reason: 'Astma',
    dosageText: '1-2 inhalationer vid behov',
    patientInstruction: 'Vid andningsbesvär. Skölj munnen efter användning.',
    packSize: '200 doser',
  },
  budesonide: {
    atc: 'R03BA02', nplPackId: '20000712100025',
    name: 'Pulmicort Turbuhaler 200 mikrogram/dos inhalationspulver', form: 'Inhalationspulver',
    reason: 'Astma',
    dosageText: '1 inhalation 2 gånger dagligen',
    patientInstruction: 'Skölj munnen med vatten efter varje inhalation',
    packSize: '200 doser',
  },
  budesonideFormoterol: {
    atc: 'R03AK07', nplPackId: '20040318100069',
    name: 'Symbicort Turbuhaler 160/4,5 mikrogram/dos inhalationspulver', form: 'Inhalationspulver',
    reason: 'KOL / Astma',
    dosageText: '1-2 inhalationer 2 gånger dagligen',
    patientInstruction: 'Skölj munnen med vatten efter varje inhalation',
    packSize: '120 doser',
  },
  tiotropium: {
    atc: 'R03BB04', nplPackId: '20030801100058',
    name: 'Spiriva Respimat 2,5 mikrogram/dos inhalationslösning', form: 'Inhalationslösning',
    reason: 'KOL',
    dosageText: '2 inhalationer 1 gång dagligen',
    patientInstruction: 'Tas vid samma tid varje dag',
    packSize: '60 doser',
  },
  // ── CNS / Mental health ─────────────────────────────────────────────────────
  escitalopram: {
    atc: 'N06AB10', nplPackId: '20120301100019',
    name: 'Escitalopram Teva 10 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Depression',
    dosageText: '1 tablett 1 gång dagligen',
    patientInstruction: 'Tas på morgonen',
    packSize: '98 tabletter',
  },
  sertraline: {
    atc: 'N06AB06', nplPackId: '20110508100086',
    name: 'Sertralin Pfizer 50 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Depression',
    dosageText: '1 tablett dagligen',
    patientInstruction: 'Tas med mat om magbesvär uppstår',
    packSize: '98 tabletter',
  },
  mirtazapine: {
    atc: 'N06AX11', nplPackId: '20090720100080',
    name: 'Mirtazapin Teva 15 mg tablett', form: 'Tablett',
    reason: 'Depression',
    dosageText: '1-2 tabletter till natten',
    patientInstruction: 'Tas på kvällen strax före sänggåendet',
    packSize: '100 tabletter',
  },
  venlafaxine: {
    atc: 'N06AX16', nplPackId: '20060210100071',
    name: 'Venlafaxin Sandoz 75 mg depotkapsel', form: 'Depotkapsel',
    reason: 'Depression / Ångest',
    dosageText: '1 kapsel 1 gång dagligen',
    patientInstruction: 'Tas på morgonen med mat',
    packSize: '98 kapslar',
  },
  methylphenidateER: {
    atc: 'N06BA04', nplPackId: '20050422100063',
    name: 'Concerta 36 mg depottablett', form: 'Depottablett',
    reason: 'ADHD',
    dosageText: '1 tablett på morgonen',
    patientInstruction: 'Tas på morgonen, svälj hel',
    packSize: '30 tabletter',
  },
  methylphenidate: {
    atc: 'N06BA04', nplPackId: '20010916100038',
    name: 'Ritalin 10 mg tablett', form: 'Tablett',
    reason: 'ADHD',
    dosageText: '1 tablett 2-3 gånger dagligen',
    patientInstruction: 'Tas på morgonen och vid lunchtid. Undvik sen eftermiddag.',
    packSize: '100 tabletter',
  },
  quetiapine: {
    atc: 'N05AH04', nplPackId: '20080915100085',
    name: 'Quetiapin Accord 25 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Bipolär sjukdom',
    dosageText: '1-2 tabletter till natten',
    patientInstruction: 'Tas på kvällen',
    packSize: '100 tabletter',
  },
  lamotrigine: {
    atc: 'N03AX09', nplPackId: '20020808100045',
    name: 'Lamotrigin Actavis 100 mg tablett', form: 'Tablett',
    reason: 'Epilepsi',
    dosageText: '1-2 tabletter 2 gånger dagligen',
    patientInstruction: 'Tas regelbundet vid samma tidpunkter varje dag',
    packSize: '100 tabletter',
  },
  topiramate: {
    atc: 'N03AX11', nplPackId: '20030711100057',
    name: 'Topiramat Sandoz 50 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Epilepsi',
    dosageText: '1 tablett 2 gånger dagligen',
    patientInstruction: 'Drick rikligt med vätska',
    packSize: '60 tabletter',
  },
  pregabalin: {
    atc: 'N03AX16', nplPackId: '20050901100067',
    name: 'Pregabalin Pfizer 75 mg kapsel', form: 'Kapsel',
    reason: 'Neuropatisk smärta',
    dosageText: '1 kapsel 2 gånger dagligen',
    patientInstruction: 'Kan tas med eller utan mat',
    packSize: '56 kapslar',
  },
  sumatriptan: {
    atc: 'N02CC01', nplPackId: '20000614100024',
    name: 'Sumatriptan Teva 50 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Migrän',
    dosageText: '1 tablett vid migränanfall',
    patientInstruction: 'Tas vid attackens start. Max 2 tabletter per dygn.',
    packSize: '6 tabletter',
  },
  paracetamol: {
    atc: 'N02BE01', nplPackId: '20101115100093',
    name: 'Alvedon 500 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Smärta',
    dosageText: '1-2 tabletter vid behov, högst 8 per dygn',
    patientInstruction: 'Vid behov mot smärta. Överskrid inte maxdosen.',
    packSize: '100 tabletter',
  },
  // ── Thyroid / endocrine ─────────────────────────────────────────────────────
  levothyroxine: {
    atc: 'H03AA01', nplPackId: '19970311100001',
    name: 'Levaxin 100 mikrogram tablett', form: 'Tablett',
    reason: 'Hypotyreos',
    dosageText: '1 tablett dagligen på fastande mage',
    patientInstruction: 'Tas på morgonen minst 30 min före frukost',
    packSize: '100 tabletter',
  },
  // ── GI ──────────────────────────────────────────────────────────────────────
  omeprazole: {
    atc: 'A02BC01', nplPackId: '19960104100006',
    name: 'Omeprazol Mylan 20 mg enterokapslar', form: 'Enterokapslar',
    reason: 'Gastroesofageal reflux',
    dosageText: '1 kapsel dagligen',
    patientInstruction: 'Tas på morgonen före frukost',
    packSize: '28 kapslar',
  },
  pantoprazole: {
    atc: 'A02BC02', nplPackId: '20001108100028',
    name: 'Pantoprazol Teva 40 mg enterotablett', form: 'Enterotablett',
    reason: 'Ulcusprofylax',
    dosageText: '1 tablett dagligen',
    patientInstruction: 'Tas 30–60 min före måltid',
    packSize: '28 tabletter',
  },
  // ── MSK / pain ──────────────────────────────────────────────────────────────
  ibuprofen: {
    atc: 'M01AE01', nplPackId: '20000206100026',
    name: 'Ibuprofen Orifarm 400 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Artros',
    dosageText: '1-2 tabletter 3 gånger dagligen vid behov',
    patientInstruction: 'Tas med mat. Undvik vid magsår.',
    packSize: '100 tabletter',
  },
  naproxen: {
    atc: 'M01AE02', nplPackId: '20010319100035',
    name: 'Naproxen Actavis 500 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Reumatoid artrit',
    dosageText: '1 tablett 2 gånger dagligen',
    patientInstruction: 'Tas med mat',
    packSize: '100 tabletter',
  },
  alendronate: {
    atc: 'M05BA04', nplPackId: '20030424100052',
    name: 'Alendronat Teva 70 mg tablett', form: 'Tablett',
    reason: 'Osteoporos',
    dosageText: '1 tablett 1 gång per vecka',
    patientInstruction: 'Tas på fastande mage med fullt glas vatten. Ligg ej ned de första 30 min.',
    packSize: '4 tabletter',
  },
  allopurinol: {
    atc: 'M04AA01', nplPackId: '19890101100002',
    name: 'Allopurinol Sandoz 300 mg tablett', form: 'Tablett',
    reason: 'Gikt',
    dosageText: '1 tablett dagligen',
    patientInstruction: 'Tas efter måltid med riklig vätska',
    packSize: '100 tabletter',
  },
  // ── Allergy ─────────────────────────────────────────────────────────────────
  cetirizine: {
    atc: 'R06AE07', nplPackId: '20160222100084',
    name: 'Cetirizin Sandoz 10 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Allergisk rinit',
    dosageText: '1 tablett dagligen under pollensäsong',
    patientInstruction: 'Kan tas oberoende av måltid',
    packSize: '30 tabletter',
  },
  loratadine: {
    atc: 'R06AX13', nplPackId: '20020517100043',
    name: 'Loratadin Sandoz 10 mg tablett', form: 'Tablett',
    reason: 'Allergisk rinit',
    dosageText: '1 tablett dagligen',
    patientInstruction: 'Kan tas oberoende av måltid',
    packSize: '30 tabletter',
  },
  // ── Hormones / reproduction ─────────────────────────────────────────────────
  contraceptivePill: {
    atc: 'G03AA07', nplPackId: '20140908100066',
    name: 'Yasmin 0,03 mg/3 mg filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Antikonception',
    dosageText: '1 tablett dagligen i 21 dagar, 7 dagars uppehåll',
    patientInstruction: 'Tas vid samma tidpunkt varje dag',
    packSize: '3 x 21 tabletter',
  },
  desogestrel: {
    atc: 'G03AC09', nplPackId: '20090301100079',
    name: 'Desogestrel Sandoz 75 mikrogram filmdragerad tablett', form: 'Filmdragerad tablett',
    reason: 'Antikonception',
    dosageText: '1 tablett dagligen utan uppehåll',
    patientInstruction: 'Tas vid samma tid varje dag',
    packSize: '3 x 28 tabletter',
  },
  // ── Haematology ─────────────────────────────────────────────────────────────
  ironSulfate: {
    atc: 'B03AA07', nplPackId: '19980206100008',
    name: 'Duroferon 100 mg depottablett', form: 'Depottablett',
    reason: 'Järnbristanemi',
    dosageText: '1 tablett dagligen på fastande mage',
    patientInstruction: 'Tas 30 min före frukost med ett glas vatten',
    packSize: '100 tabletter',
  },
  // ── Antibiotics (short course → completed) ──────────────────────────────────
  amoxicillin: {
    atc: 'J01CA04', nplPackId: '20020115100039',
    name: 'Amoxicillin Sandoz 500 mg kapsel', form: 'Kapsel',
    reason: 'Luftvägsinfektion',
    dosageText: '1 kapsel 3 gånger dagligen i 7 dagar',
    patientInstruction: 'Slutför hela kuren',
    packSize: '21 kapslar',
  },
};

// ── profile definitions ───────────────────────────────────────────────────────
// Each profile = a bundle of med keys with their intended status.
// age: 'young' (≤40), 'mid' (41–64), 'elder' (≥65)
// gender: 'any' | 'female'

interface Profile {
  meds: string[];
  statuses: MedicationRequest['status'][];
  age: ('young' | 'mid' | 'elder')[];
  gender: 'any' | 'female';
}

const MEDICATION_PROFILES: Profile[] = [
  // 0  Hypertension uncomplicated
  { meds: ['metoprololLow','ramipril'], statuses: ['active','active'], age: ['mid','elder'], gender: 'any' },
  // 1  Hypertension + statin
  { meds: ['amlodipine','atorvastatin','aspirin'], statuses: ['active','active','active'], age: ['mid','elder'], gender: 'any' },
  // 2  Hypertension + heart failure
  { meds: ['lisinopril','furosemide','metoprololHigh'], statuses: ['active','active','active'], age: ['elder'], gender: 'any' },
  // 3  AF + anticoagulation
  { meds: ['apixaban','metoprololLow','atorvastatin'], statuses: ['active','active','active'], age: ['elder'], gender: 'any' },
  // 4  AF + warfarin (older patients)
  { meds: ['warfarin','furosemide'], statuses: ['active','active'], age: ['elder'], gender: 'any' },
  // 5  Diabetes T2 basic
  { meds: ['metformin','atorvastatin'], statuses: ['active','active'], age: ['mid','elder'], gender: 'any' },
  // 6  Diabetes T2 advanced
  { meds: ['metformin','sitagliptin','dapagliflozin'], statuses: ['active','active','active'], age: ['mid','elder'], gender: 'any' },
  // 7  Polypharmacy (elderly)
  { meds: ['metoprololLow','lisinopril','atorvastatin','metformin','aspirin'], statuses: ['active','active','active','active','active'], age: ['elder'], gender: 'any' },
  // 8  Asthma (young/mid)
  { meds: ['salbutamol','budesonide'], statuses: ['active','active'], age: ['young','mid'], gender: 'any' },
  // 9  COPD
  { meds: ['budesonideFormoterol','tiotropium','salbutamol'], statuses: ['active','active','active'], age: ['mid','elder'], gender: 'any' },
  // 10 Depression basic
  { meds: ['escitalopram'], statuses: ['active'], age: ['young','mid'], gender: 'any' },
  // 11 Depression + GERD
  { meds: ['sertraline','omeprazole'], statuses: ['active','active'], age: ['mid','elder'], gender: 'any' },
  // 12 Depression + sleep (mirtazapine)
  { meds: ['mirtazapine'], statuses: ['active'], age: ['mid','elder'], gender: 'any' },
  // 13 Anxiety / depression (venlafaxine)
  { meds: ['venlafaxine','omeprazole'], statuses: ['active','active'], age: ['mid','elder'], gender: 'any' },
  // 14 Depression stopped (history)
  { meds: ['sertraline','paracetamol'], statuses: ['stopped','completed'], age: ['young','mid','elder'], gender: 'any' },
  // 15 ADHD young
  { meds: ['methylphenidateER'], statuses: ['active'], age: ['young'], gender: 'any' },
  // 16 ADHD adult
  { meds: ['methylphenidate','sertraline'], statuses: ['active','active'], age: ['young','mid'], gender: 'any' },
  // 17 Bipolar
  { meds: ['quetiapine','lamotrigine'], statuses: ['active','active'], age: ['young','mid'], gender: 'any' },
  // 18 Epilepsy
  { meds: ['lamotrigine','topiramate'], statuses: ['active','stopped'], age: ['young','mid'], gender: 'any' },
  // 19 Neuropathic pain
  { meds: ['pregabalin','paracetamol'], statuses: ['active','active'], age: ['mid','elder'], gender: 'any' },
  // 20 Migraine
  { meds: ['sumatriptan','omeprazole'], statuses: ['active','active'], age: ['young','mid'], gender: 'any' },
  // 21 Hypothyroid
  { meds: ['levothyroxine'], statuses: ['active'], age: ['young','mid','elder'], gender: 'any' },
  // 22 Hypothyroid + depression
  { meds: ['levothyroxine','escitalopram'], statuses: ['active','active'], age: ['mid','elder'], gender: 'any' },
  // 23 GERD / reflux only
  { meds: ['omeprazole'], statuses: ['active'], age: ['mid','elder'], gender: 'any' },
  // 24 Arthritis + GI protection
  { meds: ['naproxen','pantoprazole'], statuses: ['active','active'], age: ['mid','elder'], gender: 'any' },
  // 25 Artros pain management
  { meds: ['ibuprofen','pantoprazole'], statuses: ['active','active'], age: ['mid','elder'], gender: 'any' },
  // 26 Osteoporosis (elderly)
  { meds: ['alendronate','ironSulfate'], statuses: ['active','active'], age: ['elder'], gender: 'any' },
  // 27 Gout
  { meds: ['allopurinol','amlodipine'], statuses: ['active','active'], age: ['mid','elder'], gender: 'any' },
  // 28 Allergy only (young)
  { meds: ['cetirizine'], statuses: ['active'], age: ['young','mid'], gender: 'any' },
  // 29 Allergy + asthma
  { meds: ['loratadine','salbutamol'], statuses: ['active','active'], age: ['young','mid'], gender: 'any' },
  // 30 Contraception
  { meds: ['contraceptivePill'], statuses: ['active'], age: ['young'], gender: 'female' },
  // 31 Contraception + depression
  { meds: ['desogestrel','sertraline'], statuses: ['active','active'], age: ['young'], gender: 'female' },
  // 32 Iron deficiency
  { meds: ['ironSulfate'], statuses: ['active'], age: ['young','mid'], gender: 'any' },
  // 33 Completed antibiotic course
  { meds: ['amoxicillin'], statuses: ['completed'], age: ['young','mid','elder'], gender: 'any' },
  // 34 Simvastatin (older switched patients)
  { meds: ['simvastatin','aspirin'], statuses: ['stopped','stopped'], age: ['mid','elder'], gender: 'any' },
];

// ── profile selector ──────────────────────────────────────────────────────────

type AgeGroup = 'young' | 'mid' | 'elder';

function ageGroup(birthYear: number): AgeGroup {
  const age = new Date().getFullYear() - birthYear;
  if (age <= 40) return 'young';
  if (age <= 64) return 'mid';
  return 'elder';
}

function chooseProfile(ag: AgeGroup, gender: 'male' | 'female'): Profile {
  const candidates = MEDICATION_PROFILES.filter(
    (p) =>
      p.age.includes(ag) &&
      (p.gender === 'any' || p.gender === gender),
  );
  return pick(candidates);
}

// ── main function ─────────────────────────────────────────────────────────────

export async function seedBulk(targetTotal = 1005): Promise<void> {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM patients',
  );
  const existing = rows[0].n as number;
  if (existing >= targetTotal) {
    console.log(
      `Bulk seed skipped — ${existing} patients already in database.`,
    );
    return;
  }

  const toGenerate = targetTotal - existing;
  console.log(
    `Bulk seeding ${toGenerate} patients (${existing} already exist)…`,
  );

  // Collect pnrs already in use so we don't collide
  const { rows: pnrRows } = await pool.query(
    'SELECT personnummer FROM patients',
  );
  const usedPnrs = new Set<string>(pnrRows.map((r) => r.personnummer as string));

  let inserted = 0;
  let attempts = 0;

  while (inserted < toGenerate) {
    attempts++;
    if (attempts > toGenerate * 20) {
      console.warn('Bulk seed: too many collisions, stopping early.');
      break;
    }

    // Generate a random birth date between 1935 and 2005
    const year = randInt(1935, 2005);
    const month = randInt(1, 12);
    const maxDay = new Date(year, month, 0).getDate();
    const day = randInt(1, maxDay);
    const yyyymmdd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;

    const gender: 'male' | 'female' = Math.random() < 0.5 ? 'male' : 'female';
    // Swedish: birth number's last digit odd = male, even = female
    const firstTwo = randInt(0, 49); // 00–49 to stay clear of named patients' ranges
    const lastDigit = gender === 'male' ? [1, 3, 5, 7, 9][randInt(0, 4)] : [0, 2, 4, 6, 8][randInt(0, 4)];
    const birthNum = `${String(firstTwo).padStart(2, '0')}${lastDigit}`;

    const pnr = makePnr(yyyymmdd, birthNum);
    if (usedPnrs.has(pnr)) continue;
    usedPnrs.add(pnr);

    const patientId = randomUUID();
    const family = pick(LAST_NAMES);
    const given = [pick(gender === 'female' ? FEMALE_GIVEN : MALE_GIVEN)];

    const patient: Patient = {
      resourceType: 'Patient',
      id: patientId,
      meta: { profile: [FHIR_PROFILES.patient] },
      identifier: [{ system: SYSTEMS.personnummer, value: pnr }],
      name: [{ family, given, text: `${given[0]} ${family}` }],
      gender,
      birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    };

    await pool.query(
      'INSERT INTO patients (id, personnummer, resource) VALUES ($1, $2, $3)',
      [patientId, pnr, JSON.stringify(patient)],
    );

    const ag = ageGroup(year);
    const profile = chooseProfile(ag, gender);

    for (let i = 0; i < profile.meds.length; i++) {
      const medKey = profile.meds[i];
      const med = MEDS[medKey];
      if (!med) continue;
      const status = profile.statuses[i] ?? 'active';

      const rxId = randomUUID();
      const prescriber = pick(PRESCRIBERS);

      // Determine authored date: completed/stopped go further back
      const baseAge = status === 'completed' || status === 'stopped' ? randInt(60, 400) : randInt(14, 180);
      const authored = daysAgoIso(baseAge);
      const validUntil = new Date(authored);
      validUntil.setFullYear(validUntil.getFullYear() + 1);

      const medicationRequest: MedicationRequest = {
        resourceType: 'MedicationRequest',
        id: rxId,
        meta: { profile: [FHIR_PROFILES.medicationRequest] },
        identifier: [{ system: SYSTEMS.prescriptionId, value: rxId }],
        status,
        intent: 'order',
        medicationCodeableConcept: {
          coding: [
            { system: SYSTEMS.nplPackId, code: med.nplPackId },
            { system: SYSTEMS.atc, code: med.atc },
          ],
          text: med.name,
        },
        subject: {
          reference: `Patient/${patientId}`,
          display: `${given[0]} ${family}`,
        },
        authoredOn: dateOnly(authored),
        requester: {
          reference: `Practitioner/${prescriber.hsaId}`,
          display: prescriber.name,
        },
        reasonCode: [{ text: med.reason }],
        dosageInstruction: [
          { sequence: 1, text: med.dosageText, patientInstruction: med.patientInstruction },
        ],
        dispenseRequest: {
          validityPeriod: {
            start: dateOnly(authored),
            end: dateOnly(validUntil.toISOString()),
          },
          numberOfRepeatsAllowed: status === 'active' ? randInt(1, 3) : 0,
          quantity: { value: 1, unit: med.packSize },
        },
        substitution: { allowedBoolean: true },
      };

      await pool.query(
        `INSERT INTO medication_requests (id, patient_id, status, authored_on, atc_code, resource)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [rxId, patientId, status, dateOnly(authored), med.atc, JSON.stringify(medicationRequest)],
      );

      // Dispenses: active → 1–3, completed → 1, stopped → 0–1, cancelled → 0
      const dispenseCount =
        status === 'active' ? randInt(1, 3) :
        status === 'completed' ? 1 :
        status === 'stopped' ? (Math.random() < 0.5 ? 1 : 0) :
        0;

      for (let d = 0; d < dispenseCount; d++) {
        const dispId = randomUUID();
        // Space dispenses out roughly 90 days apart, most recent first
        const handedOverDaysAgo = baseAge - d * randInt(80, 110);
        if (handedOverDaysAgo < 0) continue;
        const when = daysAgoIso(handedOverDaysAgo);

        const dispense: MedicationDispense = {
          resourceType: 'MedicationDispense',
          id: dispId,
          meta: { profile: [FHIR_PROFILES.medicationDispense] },
          status: 'completed',
          medicationCodeableConcept: medicationRequest.medicationCodeableConcept,
          subject: medicationRequest.subject,
          authorizingPrescription: [{ reference: `MedicationRequest/${rxId}` }],
          quantity: { value: 1, unit: med.packSize },
          whenHandedOver: when,
          location: { display: pick(PHARMACIES) },
          dosageInstruction: medicationRequest.dosageInstruction,
        };

        await pool.query(
          `INSERT INTO medication_dispenses (id, patient_id, prescription_id, status, handed_over_at, resource)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [dispId, patientId, rxId, 'completed', when, JSON.stringify(dispense)],
        );
      }
    }

    inserted++;
    if (inserted % 100 === 0) {
      console.log(`  …${inserted}/${toGenerate} patients inserted`);
    }
  }

  console.log(`Bulk seed complete — ${inserted} patients added.`);
}

if (require.main === module) {
  migrate()
    .then(() => seedBulk())
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

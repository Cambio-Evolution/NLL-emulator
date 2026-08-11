/**
 * Pragmatic subset of FHIR R4 typings covering the NLL-profiled resources
 * this mock serves. Field names follow FHIR R4; NLL-specific content is
 * expressed the way the real profiles do (identifier systems, extensions).
 */

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Identifier {
  system?: string;
  value?: string;
}

export interface Reference {
  reference?: string;
  display?: string;
}

export interface Period {
  start?: string;
  end?: string;
}

export interface Quantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface HumanName {
  family?: string;
  given?: string[];
  text?: string;
}

export interface Meta {
  profile?: string[];
  versionId?: string;
  lastUpdated?: string;
}

export interface Resource {
  resourceType: string;
  id?: string;
  meta?: Meta;
}

export interface Patient extends Resource {
  resourceType: 'Patient';
  identifier?: Identifier[];
  name?: HumanName[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  deceasedBoolean?: boolean;
}

export interface Dosage {
  sequence?: number;
  text?: string;
  patientInstruction?: string;
  timing?: {
    repeat?: {
      frequency?: number;
      period?: number;
      periodUnit?: string;
      boundsPeriod?: Period;
    };
  };
  route?: CodeableConcept;
  doseAndRate?: Array<{
    type?: CodeableConcept;
    doseQuantity?: Quantity;
  }>;
  maxDosePerPeriod?: {
    numerator?: Quantity;
    denominator?: Quantity;
  };
}

export interface MedicationRequest extends Resource {
  resourceType: 'MedicationRequest';
  identifier?: Identifier[];
  status:
    | 'active'
    | 'on-hold'
    | 'cancelled'
    | 'completed'
    | 'entered-in-error'
    | 'stopped'
    | 'draft'
    | 'unknown';
  statusReason?: CodeableConcept;
  intent: 'order' | 'original-order' | 'instance-order' | 'proposal';
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  subject: Reference;
  authoredOn?: string;
  requester?: Reference;
  reasonCode?: CodeableConcept[]; // behandlingsorsak
  note?: Array<{ text: string }>;
  dosageInstruction?: Dosage[];
  dispenseRequest?: {
    validityPeriod?: Period;
    numberOfRepeatsAllowed?: number;
    quantity?: Quantity;
    expectedSupplyDuration?: Quantity;
  };
  substitution?: {
    allowedBoolean?: boolean;
  };
  priorPrescription?: Reference; // förskrivningskedja
}

export interface MedicationDispense extends Resource {
  resourceType: 'MedicationDispense';
  identifier?: Identifier[];
  status:
    | 'preparation'
    | 'in-progress'
    | 'cancelled'
    | 'on-hold'
    | 'completed'
    | 'entered-in-error'
    | 'stopped'
    | 'declined'
    | 'unknown';
  medicationCodeableConcept?: CodeableConcept;
  subject: Reference;
  authorizingPrescription?: Reference[];
  quantity?: Quantity;
  daysSupply?: Quantity;
  whenHandedOver?: string;
  location?: Reference;
  note?: Array<{ text: string }>;
  dosageInstruction?: Dosage[];
}

export interface BundleEntry {
  fullUrl?: string;
  resource?: Resource;
  search?: { mode: 'match' | 'include' };
}

export interface Bundle extends Resource {
  resourceType: 'Bundle';
  type: 'searchset' | 'collection' | 'transaction' | 'transaction-response';
  total?: number;
  link?: Array<{ relation: string; url: string }>;
  entry?: BundleEntry[];
}

export interface OperationOutcomeIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  code: string;
  details?: CodeableConcept;
  diagnostics?: string;
}

export interface OperationOutcome extends Resource {
  resourceType: 'OperationOutcome';
  issue: OperationOutcomeIssue[];
}

/** Identifier / coding systems used by the mock (mirroring NLL conventions). */
export const SYSTEMS = {
  personnummer: 'http://electronichealth.se/identifier/personnummer',
  nplPackId: 'http://electronichealth.se/fhir/NamingSystem/nplpackid',
  atc: 'http://www.whocc.no/atc',
  hsaId: 'urn:oid:1.2.752.29.4.19',
  prescriptionId: 'https://mock.nll.local/fhir/NamingSystem/prescription-id',
} as const;

export const PROFILES = {
  patient: 'http://electronichealth.se/fhir/StructureDefinition/NLLPatient',
  medicationRequest:
    'http://electronichealth.se/fhir/StructureDefinition/NLLMedicationRequest',
  medicationDispense:
    'http://electronichealth.se/fhir/StructureDefinition/NLLMedicationDispense',
} as const;

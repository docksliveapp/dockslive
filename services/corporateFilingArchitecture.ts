import {
  CompanyDocument,
  CorporateDocumentStatus,
  CorporateRecipientEntity,
  CorporateRootCategory,
  FranchiseProfile,
  LegalCaseTrack,
  QuotationStatus
} from '../types';

export interface RootCategoryConfig {
  id: CorporateRootCategory;
  numberLabel: string;
  title: CorporateRootCategory;
  displayTitle: string;
  subtitle: string;
  description: string;
}

export const CORPORATE_ROOT_CATEGORIES: RootCategoryConfig[] = [
  {
    id: 'Legal',
    numberLabel: '01',
    title: 'Legal',
    displayTitle: 'Legal',
    subtitle: 'Dynamic Case Dossiers & Litigation',
    description:
      'Shipment, container, customs, and corporate case dossiers with auto-provisioned proceedings sub-folders and hearing countdown alarms.'
  },
  {
    id: 'Tax',
    numberLabel: '02',
    title: 'Tax',
    displayTitle: 'Tax',
    subtitle: 'Regulatory Authorities & Fiscal Years',
    description:
      'FBR, SRB, and Labour Department tax returns, withholding statements, CPRs, and statutory filings organized dynamically by fiscal year.'
  },
  {
    id: 'Assets',
    numberLabel: '03',
    title: 'Assets',
    displayTitle: 'Assets',
    subtitle: 'Security Deposits & Corporate Properties',
    description:
      'Bank guarantees, port and utility security deposits, commercial real estate deeds, office facilities, and commercial fleet titles.'
  },
  {
    id: 'Company Documents',
    numberLabel: '04',
    title: 'Company Documents',
    displayTitle: 'Company Documents',
    subtitle: 'Master Statutory & Compliance Repository',
    description:
      'SECP, Chamber of Commerce, Licence Book, Owners IDs & Passports, Insurance Guarantees, Customs Permissions, Rent Agreements, Secure Vault, Stock Exchange & State Bank.'
  },
  {
    id: 'Quotations',
    numberLabel: '05',
    title: 'Quotations',
    displayTitle: 'Quotations',
    subtitle: 'Outbound Commercial Proposals Archive',
    description:
      'Commercial freight and clearance quotations searchable by client name, issuance date, service type, quoted tariff, and approval status.'
  },
  {
    id: 'Finance',
    numberLabel: '06',
    title: 'Finance',
    displayTitle: 'Finance (Ledgers, Vendors & Franchises)',
    subtitle: 'Ledgers, Vendors & Franchises',
    description:
      'Franchise registration, dry port and city allocation, per-container and monthly fixed billing structures, automated franchise port ledgers, and vendor accounts.'
  }
];

export const LEGAL_LOGISTICS_CRIMINAL_SUBFOLDERS: string[] = [
  'Police FIR & Proceedings',
  'Customs FIR & Enforcement',
  'Transit Trade & ONO',
  'Appeals & Tribunals',
  'High Courts & Constitutional Petitions',
  'Correspondence & Follow-ups',
  'Consignment Documents'
];

export function normalizeLegalSubFolderName(name?: string): string {
  const clean = (name || '').trim();
  if (/police\s+fir\s*&\s*proceedings$/i.test(clean) && clean.toLowerCase() !== 'police fir & proceedings') {
    return 'Police FIR & Proceedings';
  }
  return clean;
}

export const LEGAL_CIVIL_CORPORATE_SUBFOLDERS: string[] = [
  'Original Plaint / Notice',
  'Written Statement / Defense',
  'Evidence & Exhibits',
  'Lower Court Judgments',
  'Appellate Proceedings'
];

export function getProvisionedLegalSubFolders(track: LegalCaseTrack): string[] {
  return track === 'CIVIL_CORPORATE'
    ? [...LEGAL_CIVIL_CORPORATE_SUBFOLDERS]
    : [...LEGAL_LOGISTICS_CRIMINAL_SUBFOLDERS];
}

export interface TaxAuthorityConfig {
  id: 'FBR' | 'SRB' | 'Labour Department';
  title: string;
  fullName: string;
  description: string;
}

export const TAX_AUTHORITIES: TaxAuthorityConfig[] = [
  {
    id: 'FBR',
    title: 'FBR',
    fullName: 'Federal Board of Revenue',
    description: 'Annual income tax returns, monthly withholding statements, sales tax filings, CPR receipts, and statutory audit notices.'
  },
  {
    id: 'SRB',
    title: 'SRB',
    fullName: 'Sindh Revenue Board',
    description: 'Provincial sales tax on logistics and clearing services, monthly SST returns, withholding schedules, and compliance certificates.'
  },
  {
    id: 'Labour Department',
    title: 'Labour Department',
    fullName: 'EOBI, SESSI & Labour Welfare',
    description: 'EOBI contributions, SESSI social security filings, labour inspection clearances, and workforce statutory registrations.'
  }
];

export const DEFAULT_FISCAL_YEARS: string[] = ['2024', '2025', '2026'];

export interface AssetGroupConfig {
  id: 'Security Deposits Tracking' | 'Company Properties & Investments';
  title: string;
  subtitle: string;
  description: string;
  subTypes: string[];
  quickExamples: string[];
}

export const ASSETS_SUBFOLDERS: AssetGroupConfig[] = [
  {
    id: 'Security Deposits Tracking',
    title: 'Security Deposits Tracking',
    subtitle: 'Bank Guarantees, Port Authorities & Utilities',
    description:
      'Refundable cash margins, bank guarantees, port and terminal security deposits, shipping line container deposits, and utility deposits.',
    subTypes: [
      'Bank Guarantee',
      'Port Authority Deposit',
      'Utility Deposit',
      'Shipping Line Deposit',
      'Customs Cash Security',
      'Office Lease Security Deposit'
    ],
    quickExamples: [
      'Bank Guarantees',
      'Port Authority Deposits',
      'Utility Deposits',
      'Customs Cash Security'
    ]
  },
  {
    id: 'Company Properties & Investments',
    title: 'Company Properties & Investments',
    subtitle: 'Real Estate, Office Facilities & Commercial Fleet',
    description:
      'Title deeds, allotment letters, sale agreements, valuation reports, and capital records for real estate properties, corporate offices, and commercial vehicles.',
    subTypes: [
      'Real Estate Property',
      'Office Setup & Infrastructure',
      'Commercial Vehicle Asset',
      'Warehouse / Yard Facility',
      'Long-Term Corporate Investment'
    ],
    quickExamples: [
      'Real Estate Properties',
      'Corporate Office Facilities',
      'Warehouse & Yard Assets',
      'Commercial Fleet Vehicles'
    ]
  }
];

export interface MasterCompanyFolderConfig {
  id: string;
  title: string;
  description: string;
  isSecureVault?: boolean;
}

export const MASTER_COMPANY_DOC_FOLDERS: MasterCompanyFolderConfig[] = [
  {
    id: 'SECP',
    title: 'SECP',
    description: 'Certificate of Incorporation, Form-A, Form-29, Memorandum & Articles of Association, and statutory filings.'
  },
  {
    id: 'Chamber of Commerce',
    title: 'Chamber of Commerce',
    description: 'Chamber membership certificates, annual renewals, recommendation letters, and commercial attestations.'
  },
  {
    id: 'Licence Book',
    title: 'Licence Book',
    description: 'Customs Clearing Agent Licence, Bonded Carrier Licence, TIR admission certificates, and transport permits.'
  },
  {
    id: 'Owners ID Cards & Passports',
    title: 'Owners ID Cards & Passports',
    description: 'Directors and shareholders national ID cards, passports, specimen signatures, and biometric verification slips.'
  },
  {
    id: 'Insurance Guarantees',
    title: 'Insurance Guarantees',
    description: 'Bonded carrier customs insurance guarantees, marine cargo policies, fidelity bonds, and renewal endorsements.'
  },
  {
    id: 'Customs Certificates & Permissions',
    title: 'Customs Certificates & Permissions',
    description: 'WeBOC / PSW registration permissions, Transit Trade authorizations, SRO exemptions, and collectorate NOCs.'
  },
  {
    id: 'Office Rent Agreements & Slips',
    title: 'Office Rent Agreements & Slips',
    description: 'Tenancy contracts, branch office lease renewals, monthly rent payment receipts, and building maintenance slips.'
  },
  {
    id: 'Office ID Passwords (Secure Vault)',
    title: 'Office ID Passwords (Secure Vault)',
    description: 'Protected corporate portal credentials (FBR IRIS, WeBOC, PSW, SECP eServices, SRB, corporate email & banking IDs).',
    isSecureVault: true
  },
  {
    id: 'Stock Exchange Documents',
    title: 'Stock Exchange Documents',
    description: 'Pakistan Stock Exchange (PSX) CDC statements, corporate shareholding records, dividend warrants, and broker filings.'
  },
  {
    id: 'State Bank Documents',
    title: 'State Bank Documents',
    description: 'State Bank of Pakistan (SBP) foreign exchange approvals, FE-25 / E-Form clearances, and cross-border remittance authorizations.'
  }
];

export const RECIPIENT_ENTITIES: { id: CorporateRecipientEntity; label: string }[] = [
  { id: 'Docks', label: 'Docks (Docks Pvt. Ltd.)' },
  { id: 'Truckit', label: 'Truckit (Truckit Pvt. Ltd.)' },
  { id: 'Muhib', label: 'Muhib (Muhib International)' },
  { id: 'Vantage', label: 'Vantage (Vantage Shipping Line)' },
  { id: 'MAK Group', label: 'MAK Group (MAK Group of Companies)' }
];

export const DOCUMENT_STATUS_TAGS: CorporateDocumentStatus[] = [
  'Active',
  'Pending Hearing',
  'Expired',
  'Resolved',
  'Archived'
];

export const QUOTATION_STATUSES: QuotationStatus[] = ['Pending', 'Accepted', 'Rejected'];

export const QUOTATION_SERVICE_TYPES: string[] = [
  'Bonded Carrier',
  'Customs Clearance',
  'Afghan Transit Trade',
  'TIR International Transport',
  'Freight & Container Transport',
  'Warehousing & Terminal Handling',
  'Car Carrier / Heavy Machinery',
  'Multi-Modal Project Logistics'
];

/**
 * Destination City -> Dry Ports & Border Terminals Directory
 * Used by Franchise Registration & Real-Time Automated Container Ledger Engine.
 */
export interface DryPortCityMapping {
  city: string;
  region: string;
  dryPorts: string[];
}

export const PAKISTAN_DRY_PORT_CITIES: DryPortCityMapping[] = [
  {
    city: 'Lahore',
    region: 'Punjab',
    dryPorts: [
      'Lahore Dry Port',
      'Lahore NLC Dry Port',
      'Lahore MICT Dry Port',
      'Lahore DPW Dry Port',
      'Prem Nagar Dry Port Lahore',
      'Wagha Border Terminal'
    ]
  },
  {
    city: 'Karachi',
    region: 'Sindh',
    dryPorts: [
      'Karachi Dry Port',
      'Karachi NLC Dry Port'
    ]
  },
  {
    city: 'Faisalabad',
    region: 'Punjab',
    dryPorts: ['Faisalabad Dry Port']
  },
  {
    city: 'Multan',
    region: 'Punjab',
    dryPorts: ['Multan Dry Port']
  },
  {
    city: 'Sialkot',
    region: 'Punjab',
    dryPorts: ['Sialkot Dry Port']
  },
  {
    city: 'Islamabad',
    region: 'ICT',
    dryPorts: ['Islamabad Dry Port']
  },
  {
    city: 'Rawalpindi',
    region: 'Punjab',
    dryPorts: ['Rawalpindi Dry Port']
  },
  {
    city: 'Peshawar',
    region: 'Khyber Pakhtunkhwa',
    dryPorts: ['Peshawar Dry Port', 'Azakhel Dry Port', 'Jamrud Dry Port']
  },
  {
    city: 'Quetta',
    region: 'Balochistan',
    dryPorts: ['Quetta Railway Dry Port', 'Quetta NLC Dry Port']
  },
  {
    city: 'Havelian',
    region: 'Khyber Pakhtunkhwa',
    dryPorts: ['Havelian Dry Port']
  },
  {
    city: 'Torkham',
    region: 'Khyber Pakhtunkhwa',
    dryPorts: ['Torkham Border Terminal']
  },
  {
    city: 'Chaman',
    region: 'Balochistan',
    dryPorts: ['Chaman Border Terminal']
  },
  {
    city: 'Taftan',
    region: 'Balochistan',
    dryPorts: ['Taftan Border Terminal']
  },
  {
    city: 'Gilgit / Sost',
    region: 'Gilgit-Baltistan',
    dryPorts: ['Gilgit Dry Port', 'Sost Dry Port']
  },
  {
    city: 'Muzaffarabad',
    region: 'AJK',
    dryPorts: ['Muzaffarabad Dry Port']
  }
];

export const ALL_ALLOCATABLE_DRY_PORTS: string[] = Array.from(
  new Set(PAKISTAN_DRY_PORT_CITIES.flatMap((c) => c.dryPorts))
);

export function getDryPortsForCities(cities: string[]): string[] {
  const citySet = new Set((cities || []).map((c) => c.trim().toLowerCase()));
  const matchedPorts: string[] = [];
  for (const entry of PAKISTAN_DRY_PORT_CITIES) {
    if (citySet.has(entry.city.toLowerCase())) {
      matchedPorts.push(...entry.dryPorts);
    }
  }
  return Array.from(new Set(matchedPorts));
}

function normalizePortToken(val: string): string {
  return (val || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Evaluates whether an operational Case destination / POD matches a Franchise's
 * configured City or Specific Dry Port allocation.
 */
export function doesDestinationMatchFranchise(
  podOrDestination: string,
  franchise: Pick<FranchiseProfile, 'allocationMode' | 'allocatedCities' | 'allocatedDryPorts'>
): boolean {
  const normPod = normalizePortToken(podOrDestination);
  if (!normPod) return false;

  if (franchise.allocationMode === 'CITY') {
    const cities = franchise.allocatedCities || [];
    for (const city of cities) {
      const normCity = normalizePortToken(city);
      if (!normCity) continue;
      const cityWords = normCity.split(' ').filter((w) => w.length >= 3);
      if (normPod.includes(normCity) || cityWords.some((w) => normPod.includes(w))) {
        return true;
      }
    }
    const cityPorts = getDryPortsForCities(cities);
    for (const port of cityPorts) {
      const normPort = normalizePortToken(port);
      if (normPort && (normPod === normPort || normPod.includes(normPort) || normPort.includes(normPod))) {
        return true;
      }
    }
    return false;
  }

  // SPECIFIC_PORTS mode: exact / normalized dry port match so multiple franchises in the same city remain strictly separated
  const ports = franchise.allocatedDryPorts || [];
  for (const port of ports) {
    const normPort = normalizePortToken(port);
    if (!normPort) continue;
    if (normPod === normPort || normPod.includes(normPort) || normPort.includes(normPod)) {
      return true;
    }
    // Match distinct terminal code tokens (e.g., NLC, MICT, DPW, Azakhel, Jamrud, Prem Nagar)
    const significantTokens = normPort
      .split(' ')
      .filter((t) => !['dry', 'port', 'terminal', 'border'].includes(t));
    if (significantTokens.length >= 2 && significantTokens.every((t) => normPod.includes(t))) {
      return true;
    }
  }
  return false;
}

export interface ResolvedDocumentHierarchy {
  rootCategory: CorporateRootCategory;
  legalCaseId?: string;
  legalCaseTitle?: string;
  subFolder?: string;
  taxAuthority?: string;
  taxYear?: string;
  assetGroup?: string;
  quotationStatus: QuotationStatus;
  recipientEntity: string;
  senderIssuer: string;
  issuanceDate: string;
  validityStartDate: string;
  validityEndDate: string;
  alarmDaysBefore: number;
}

/**
 * Maps structured documents and legacy flat-category documents into the unified
 * 6-pillar corporate hierarchy without losing historical records.
 */
export function resolveDocumentHierarchy(doc: CompanyDocument): ResolvedDocumentHierarchy {
  const rawRoot = doc.rootCategory;
  const legacyCat = (doc.category || '').trim();
  const docDate =
    doc.issuanceDate ||
    doc.creationDate ||
    doc.documentDate ||
    doc.issueDate ||
    (doc.uploadedAt ? doc.uploadedAt.slice(0, 10) : '');
  const inferredYearMatch = (doc.taxYear || docDate || '').match(/\b(20\d{2})\b/);
  const inferredYear =
    doc.taxYear || (inferredYearMatch ? inferredYearMatch[1] : new Date().getFullYear().toString());

  let rootCategory: CorporateRootCategory = 'Company Documents';
  let subFolder = doc.subFolder || doc.subcategory || '';
  let taxAuthority = doc.taxAuthority || '';
  let taxYear = doc.taxYear || '';
  let assetGroup = doc.assetGroup || '';
  let legalCaseId = doc.legalCaseId;
  let legalCaseTitle = doc.legalCaseTitle;

  if (
    rawRoot === 'Legal' ||
    rawRoot === 'Tax' ||
    rawRoot === 'Assets' ||
    rawRoot === 'Company Documents' ||
    rawRoot === 'Quotations' ||
    rawRoot === 'Finance'
  ) {
    rootCategory = rawRoot;
    if (rootCategory === 'Legal') {
      subFolder = normalizeLegalSubFolderName(subFolder);
    } else if (rootCategory === 'Tax') {
      taxAuthority = taxAuthority || 'FBR';
      taxYear = taxYear || inferredYear;
    } else if (rootCategory === 'Assets') {
      assetGroup = assetGroup || subFolder || 'Company Properties & Investments';
    } else if (rootCategory === 'Company Documents') {
      subFolder = subFolder || 'SECP';
    }
  } else {
    switch (legacyCat) {
      case 'FIRs':
        rootCategory = 'Legal';
        legalCaseId = legalCaseId || 'legacy_general_legal_archive';
        legalCaseTitle = legalCaseTitle || 'General Legal & Enforcement Archive';
        subFolder = subFolder || 'Customs FIR & Enforcement';
        break;
      case 'Petitions':
        rootCategory = 'Legal';
        legalCaseId = legalCaseId || 'legacy_general_legal_archive';
        legalCaseTitle = legalCaseTitle || 'General Legal & Enforcement Archive';
        subFolder = subFolder || 'High Courts & Constitutional Petitions';
        break;
      case 'Showcase/ONOs reply':
        rootCategory = 'Legal';
        legalCaseId = legalCaseId || 'legacy_general_legal_archive';
        legalCaseTitle = legalCaseTitle || 'General Legal & Enforcement Archive';
        subFolder = subFolder || 'Transit Trade & ONO';
        break;
      case 'FBR income tax':
        rootCategory = 'Tax';
        taxAuthority = 'FBR';
        taxYear = inferredYear;
        break;
      case 'SRB':
        rootCategory = 'Tax';
        taxAuthority = 'SRB';
        taxYear = inferredYear;
        break;
      case 'Deposits/Guaranties':
        rootCategory = 'Assets';
        assetGroup = 'Security Deposits Tracking';
        break;
      case 'Assets':
        rootCategory = 'Assets';
        assetGroup = 'Company Properties & Investments';
        break;
      case 'Quotations':
        rootCategory = 'Quotations';
        break;
      case 'SECP':
        rootCategory = 'Company Documents';
        subFolder = 'SECP';
        break;
      case 'Chamber of Commerce':
        rootCategory = 'Company Documents';
        subFolder = 'Chamber of Commerce';
        break;
      case 'PAKISTAN customs':
        rootCategory = 'Company Documents';
        subFolder = 'Customs Certificates & Permissions';
        break;
      case 'State Bank of Pakistan':
      case 'Banks':
        rootCategory = 'Company Documents';
        subFolder = 'State Bank Documents';
        break;
      case 'Stocks Exchange':
        rootCategory = 'Company Documents';
        subFolder = 'Stock Exchange Documents';
        break;
      case "Agreement's":
        rootCategory = 'Company Documents';
        subFolder = 'Office Rent Agreements & Slips';
        break;
      default:
        rootCategory = 'Company Documents';
        subFolder = subFolder || legacyCat || 'SECP';
        break;
    }
  }

  let recipientEntity = (doc.recipientEntity || doc.issuedTo || doc.to || '').trim();
  if (!recipientEntity) {
    const cid = (doc.companyId || '').toLowerCase();
    if (cid.includes('truckit')) recipientEntity = 'Truckit';
    else if (cid.includes('muhib')) recipientEntity = 'Muhib';
    else if (cid.includes('vantage')) recipientEntity = 'Vantage';
    else if (cid.includes('docks')) recipientEntity = 'Docks';
    else recipientEntity = 'MAK Group';
  }

  return {
    rootCategory,
    legalCaseId,
    legalCaseTitle,
    subFolder,
    taxAuthority,
    taxYear,
    assetGroup,
    quotationStatus: doc.quotationStatus || 'Pending',
    recipientEntity,
    senderIssuer: (doc.senderIssuer || doc.sourceOrigin || doc.from || 'Official Issuer').trim(),
    issuanceDate: docDate,
    validityStartDate: doc.validityStartDate || docDate,
    validityEndDate: doc.validityEndDate || doc.expiryDate || '',
    alarmDaysBefore:
      typeof doc.alarmDaysBefore === 'number' && doc.alarmDaysBefore > 0 ? doc.alarmDaysBefore : 15
  };
}

export interface DocumentAlarmEvaluation {
  remainingValidityDays: number | null;
  isExpired: boolean;
  isWithinExpiryAlarm: boolean;
  remainingHearingDays: number | null;
  isHearingDueOrSoon: boolean;
  isHearingOverdue: boolean;
  effectiveStatus: CorporateDocumentStatus;
}

export function evaluateDocumentAlarms(
  doc: CompanyDocument,
  referenceIsoDate?: string
): DocumentAlarmEvaluation {
  const todayIso = referenceIsoDate || new Date().toISOString().split('T')[0];
  const todayMs = new Date(`${todayIso}T00:00:00`).getTime();
  const alarmLeadDays =
    typeof doc.alarmDaysBefore === 'number' && doc.alarmDaysBefore > 0 ? doc.alarmDaysBefore : 15;

  const endDateStr = !doc.unlimitedValidity ? (doc.validityEndDate || doc.expiryDate || '') : '';
  let remainingValidityDays: number | null = null;
  let isExpired = false;
  let isWithinExpiryAlarm = false;

  if (endDateStr) {
    const expMs = new Date(`${endDateStr.slice(0, 10)}T00:00:00`).getTime();
    if (!isNaN(expMs)) {
      remainingValidityDays = Math.ceil((expMs - todayMs) / (24 * 60 * 60 * 1000));
      isExpired = remainingValidityDays <= 0;
      isWithinExpiryAlarm = remainingValidityDays > 0 && remainingValidityDays <= alarmLeadDays;
    }
  }

  let remainingHearingDays: number | null = null;
  let isHearingDueOrSoon = false;
  let isHearingOverdue = false;

  const isClosed = doc.statusTag === 'Resolved' || doc.statusTag === 'Archived';
  if (doc.hearingDate && !isClosed) {
    const hearMs = new Date(`${doc.hearingDate.slice(0, 10)}T00:00:00`).getTime();
    if (!isNaN(hearMs)) {
      remainingHearingDays = Math.ceil((hearMs - todayMs) / (24 * 60 * 60 * 1000));
      isHearingOverdue = remainingHearingDays < 0;
      isHearingDueOrSoon = remainingHearingDays >= 0 && remainingHearingDays <= Math.max(7, alarmLeadDays);
    }
  }

  let effectiveStatus: CorporateDocumentStatus = doc.statusTag || 'Active';
  if (isExpired && effectiveStatus === 'Active') {
    effectiveStatus = 'Expired';
  } else if (doc.hearingDate && !isClosed && doc.statusTag !== 'Expired' && (doc.hearingRequired || doc.hasHearingDate)) {
    effectiveStatus = 'Pending Hearing';
  }

  return {
    remainingValidityDays,
    isExpired,
    isWithinExpiryAlarm,
    remainingHearingDays,
    isHearingDueOrSoon,
    isHearingOverdue,
    effectiveStatus
  };
}

/**
 * Reference Enterprise PostgreSQL DDL + Firebase Firestore Data Model
 * Exposed via the "Schema & API Spec" drawer for enterprise audit and database portability.
 */
export const POSTGRESQL_CORPORATE_DMS_DDL = `-- ============================================================================
-- MAK GROUP OF COMPANIES — ENTERPRISE DMS & FRANCHISE LEDGER SCHEMA (PostgreSQL)
-- Covers 6 Root Categories: Legal, Tax, Assets, Company Documents, Quotations,
-- and Finance (Ledgers, Vendors & Franchises) with Real-Time Container Billing
-- ============================================================================

CREATE TYPE corporate_root_category AS ENUM (
  'Legal', 'Tax', 'Assets', 'Company Documents', 'Quotations', 'Finance'
);

CREATE TYPE legal_case_track AS ENUM (
  'LOGISTICS_CRIMINAL', 'CIVIL_CORPORATE'
);

CREATE TYPE corporate_entity AS ENUM (
  'Docks', 'Truckit', 'Muhib', 'Vantage', 'MAK Group'
);

CREATE TYPE document_status_tag AS ENUM (
  'Active', 'Expired', 'Pending Hearing', 'Resolved', 'Archived'
);

CREATE TYPE quotation_status AS ENUM (
  'Pending', 'Accepted', 'Rejected'
);

CREATE TYPE franchise_billing_type AS ENUM (
  'PER_CONTAINER', 'FIXED_MONTHLY'
);

CREATE TYPE franchise_allocation_mode AS ENUM (
  'CITY', 'SPECIFIC_PORTS'
);

-- 1. Dynamic Legal Case Dossiers (Auto-provisions 7 Logistics/Criminal or 5 Civil Sub-folders)
CREATE TABLE corporate_legal_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(180) NOT NULL UNIQUE,
  case_track legal_case_track NOT NULL,
  recipient_entity corporate_entity NOT NULL DEFAULT 'MAK Group',
  case_reference_no VARCHAR(100),
  court_or_forum VARCHAR(160),
  legal_counsel VARCHAR(140),
  opposing_party VARCHAR(160),
  next_hearing_date DATE,
  status document_status_tag NOT NULL DEFAULT 'Active',
  sub_folders TEXT[] NOT NULL,
  notes TEXT,
  created_by VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Universal Corporate Documents & Smart Alarm Registry
CREATE TABLE corporate_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  root_category corporate_root_category NOT NULL,
  legal_case_id UUID REFERENCES corporate_legal_cases(id) ON DELETE SET NULL,
  sub_folder VARCHAR(160),
  tax_authority VARCHAR(60),
  tax_year VARCHAR(10),
  asset_group VARCHAR(80),
  asset_sub_type VARCHAR(80),
  asset_valuation_pkr NUMERIC(16, 2),
  asset_location_or_bank VARCHAR(180),
  quotation_client_name VARCHAR(160),
  quotation_service_type VARCHAR(100),
  quotation_status quotation_status,
  quotation_amount_pkr NUMERIC(16, 2),

  -- Mandatory Universal Metadata
  title VARCHAR(240) NOT NULL,
  reference_no VARCHAR(120),
  sender_issuer VARCHAR(180) NOT NULL,
  recipient_entity corporate_entity NOT NULL,
  issuance_date DATE NOT NULL,
  validity_start_date DATE,
  validity_end_date DATE,
  unlimited_validity BOOLEAN NOT NULL DEFAULT FALSE,
  alarm_days_before INTEGER NOT NULL DEFAULT 15,
  hearing_required BOOLEAN NOT NULL DEFAULT FALSE,
  hearing_date DATE,
  hearing_time VARCHAR(20),
  hearing_notes TEXT,
  status_tag document_status_tag NOT NULL DEFAULT 'Active',
  subject TEXT,

  -- Storage Pointers
  file_name VARCHAR(255) NOT NULL,
  file_mime_type VARCHAR(100) NOT NULL,
  file_size_bytes BIGINT,
  storage_uri TEXT NOT NULL,
  uploaded_by VARCHAR(128),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Office ID Passwords (Secure Vault)
CREATE TABLE corporate_vault_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_name VARCHAR(160) NOT NULL,
  portal_url TEXT,
  username_or_id VARCHAR(160) NOT NULL,
  encrypted_password TEXT NOT NULL,
  pin_or_2fa_note VARCHAR(200),
  recipient_entity corporate_entity NOT NULL DEFAULT 'MAK Group',
  recovery_contact VARCHAR(160),
  expiry_date DATE,
  alarm_days_before INTEGER NOT NULL DEFAULT 15,
  status_tag document_status_tag NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Franchise Registration & Destination / Dry Port Allocation
CREATE TABLE franchises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(60) NOT NULL DEFAULT 'docks',
  business_title VARCHAR(200) NOT NULL,
  owner_name VARCHAR(160) NOT NULL,
  contact_number VARCHAR(50) NOT NULL,
  id_card_number VARCHAR(40) NOT NULL,
  id_card_doc_uri TEXT,
  ntn_certificate_uri TEXT,
  franchise_agreement_uri TEXT,
  port_staff JSONB NOT NULL DEFAULT '[]'::jsonb,
  billing_type franchise_billing_type NOT NULL,
  per_container_amount NUMERIC(14, 2) DEFAULT 0,
  fixed_monthly_amount NUMERIC(14, 2) DEFAULT 0,
  allocation_mode franchise_allocation_mode NOT NULL,
  allocated_cities TEXT[] NOT NULL DEFAULT '{}',
  allocated_dry_ports TEXT[] NOT NULL DEFAULT '{}',
  recipient_entity corporate_entity NOT NULL DEFAULT 'MAK Group',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Automated Real-Time Franchise Port Ledger Entries
CREATE TABLE franchise_ledger_entries (
  id VARCHAR(160) PRIMARY KEY,
  company_id VARCHAR(60) NOT NULL DEFAULT 'docks',
  franchise_id UUID NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  franchise_name VARCHAR(200) NOT NULL,
  entry_date DATE NOT NULL,
  entry_type VARCHAR(12) NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
  amount NUMERIC(16, 2) NOT NULL,
  description TEXT NOT NULL,
  reference VARCHAR(120),
  case_no VARCHAR(80),
  pod VARCHAR(120),
  container_count INTEGER,
  container_numbers TEXT,
  rate_per_container NUMERIC(14, 2),
  payment_method VARCHAR(20),
  auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_corp_docs_hierarchy ON corporate_documents (root_category, sub_folder, tax_authority, tax_year);
CREATE INDEX idx_corp_docs_expiry_alarm ON corporate_documents (validity_end_date) WHERE unlimited_validity = FALSE;
CREATE INDEX idx_corp_docs_hearing_alarm ON corporate_documents (hearing_date) WHERE hearing_date IS NOT NULL;
CREATE INDEX idx_franchises_allocation ON franchises USING GIN (allocated_cities, allocated_dry_ports);
CREATE INDEX idx_franchise_ledger_lookup ON franchise_ledger_entries (franchise_id, entry_date DESC);`;

export const FIRESTORE_CORPORATE_DMS_SPEC = `// Firebase Firestore Live Collections & Automated API Triggers
// 1. /corporate_legal_cases/{legalCaseId}
//    -> Dynamic Legal Case Dossiers with auto-provisioned Criminal/Logistics (7) or Civil/Corporate (5) subFolders[]
// 2. /company_documents/{docId}
//    -> Universal metadata (senderIssuer, recipientEntity, issuanceDate, taxYear, validityStartDate,
//       validityEndDate, alarmDaysBefore, hearingDate, statusTag) & hierarchy path across all categories
// 3. /corporate_vault_credentials/{vaultId}
//    -> Protected credentials under Company Documents > Office ID Passwords (Secure Vault)
// 4. /franchises/{franchiseId}
//    -> Franchise profile, ID/NTN/Agreement uploads, portStaff[], billingType (PER_CONTAINER | FIXED_MONTHLY),
//       and allocationMode (CITY | SPECIFIC_PORTS)
// 5. /franchise_ledger_entries/{entryId}
//    -> Real-time auto-debited container dispatch/unloading charges (deterministic key frled_<franchiseId>_<caseNo>)
//       and franchise payment credits
// 6. /document_chunks/{chunkId}
//    -> Cloud chunk storage (chunk://<docKey>) for multi-megabyte PDFs and high-resolution document scans
// 7. /notifications/{notificationId}
//    -> Smart Alarm Engine dispatches (DOC_EXPIRY_ALERT & LEGAL_HEARING_ALERT)`;

import {
  CompanyDocument,
  CorporateDocumentStatus,
  CorporateRecipientEntity,
  CorporateRootCategory,
  LegalCaseTrack,
  QuotationStatus
} from '../types';

export interface RootCategoryConfig {
  id: CorporateRootCategory;
  numberLabel: string;
  title: CorporateRootCategory;
  subtitle: string;
  description: string;
}

export const CORPORATE_ROOT_CATEGORIES: RootCategoryConfig[] = [
  {
    id: 'Legal',
    numberLabel: '01',
    title: 'Legal',
    subtitle: 'Dynamic Case Dossiers & Litigation',
    description:
      'Container/shipment criminal & customs proceedings, civil/corporate disputes, court orders, ONOs, and automated hearing countdowns.'
  },
  {
    id: 'Tax',
    numberLabel: '02',
    title: 'Tax',
    subtitle: 'Regulatory Authorities & Fiscal Years',
    description:
      'FBR, SRB, and Labour Department tax returns, withholding statements, CPRs, and audit notices organized dynamically by fiscal year.'
  },
  {
    id: 'Assets',
    numberLabel: '03',
    title: 'Assets',
    subtitle: 'Security Deposits & Corporate Properties',
    description:
      'Bank guarantees, port and utility security deposits, commercial real estate deeds, office facilities, and commercial fleet titles.'
  },
  {
    id: 'Company Documents',
    numberLabel: '04',
    title: 'Company Documents',
    subtitle: 'Master Statutory & Compliance Repository',
    description:
      'SECP, Chamber of Commerce, Licence Book, Owners IDs/Passports, Insurance Guarantees, Customs Permissions, Rent Agreements, Secure Vault, Stock Exchange & State Bank.'
  },
  {
    id: 'Quotations',
    numberLabel: '05',
    title: 'Quotations',
    subtitle: 'Outbound Commercial Proposals Archive',
    description:
      'Commercial freight & clearance quotations searchable by client name, issuance date, service category, quoted tariff, and approval status.'
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
  if (clean.toLowerCase() === 'sahiwal police fir & proceedings') {
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
    description: 'Annual income tax returns, monthly withholding statements, sales tax filings, CPR receipts, and Section 122/177 audit notices.'
  },
  {
    id: 'SRB',
    title: 'SRB',
    fullName: 'Sindh Revenue Board',
    description: 'Provincial sales tax on logistics/clearing services, SST-03 monthly returns, withholding schedules, and SRB compliance certificates.'
  },
  {
    id: 'Labour Department',
    title: 'Labour Department',
    fullName: 'EOBI, SESSI & Labour Welfare',
    description: 'EOBI contributions, SESSI social security filings, labour inspection clearances, and statutory workforce registrations.'
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
      'Refundable cash margins, bank guarantees, port & terminal security deposits, shipping line container deposits, and utility deposits.',
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
    description: 'KCCI / FPCCI membership certificates, annual renewals, visa recommendation letters, and attestations.'
  },
  {
    id: 'Licence Book',
    title: 'Licence Book',
    description: 'Customs Clearing Agent Licence, Bonded Carrier Licence, TIR admission certificates, and transport permits.'
  },
  {
    id: 'Owners ID Cards & Passports',
    title: 'Owners ID Cards & Passports',
    description: 'Directors and shareholders CNICs, passports, specimen signatures, and biometric verification slips.'
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
 * Maps both newly structured documents and legacy flat-category documents
 * into the unified 5-pillar corporate hierarchy so zero historical records are lost.
 */
export function resolveDocumentHierarchy(doc: CompanyDocument): ResolvedDocumentHierarchy {
  const rawRoot = doc.rootCategory;
  const legacyCat = (doc.category || '').trim();
  const docDate = doc.issuanceDate || doc.documentDate || doc.issueDate || (doc.uploadedAt ? doc.uploadedAt.slice(0, 10) : '');
  const inferredYearMatch = (doc.taxYear || docDate || '').match(/\b(20\d{2})\b/);
  const inferredYear = doc.taxYear || (inferredYearMatch ? inferredYearMatch[1] : new Date().getFullYear().toString());

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
    rawRoot === 'Quotations'
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
    // Legacy category automatic mapping
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

  // Normalize recipient entity label
  let recipientEntity = (doc.recipientEntity || doc.to || '').trim();
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
    senderIssuer: (doc.senderIssuer || doc.from || 'Official Issuer').trim(),
    issuanceDate: docDate,
    validityStartDate: doc.validityStartDate || docDate,
    validityEndDate: doc.validityEndDate || doc.expiryDate || '',
    alarmDaysBefore: typeof doc.alarmDaysBefore === 'number' && doc.alarmDaysBefore > 0 ? doc.alarmDaysBefore : 15
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
  } else if (doc.hearingDate && !isClosed && doc.statusTag !== 'Expired' && doc.hearingRequired) {
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
 * (Exposed via the "Schema & API Spec" technical drawer for enterprise audit & DB portability).
 */
export const POSTGRESQL_CORPORATE_DMS_DDL = `-- ============================================================================
-- MAK GROUP OF COMPANIES — ENTERPRISE CORPORATE FILING & DMS SCHEMA (PostgreSQL)
-- Supports 5-Tier Dynamic Folders, Legal Case Provisioning, Tax Fiscal Archiving,
-- Asset/Deposit Tracking, Secure Vault, Quotations, & Smart Alarm Engine
-- ============================================================================

CREATE TYPE corporate_root_category AS ENUM (
  'Legal', 'Tax', 'Assets', 'Company Documents', 'Quotations'
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

-- 1. Dynamic Legal Case Dossiers (Auto-provisions 7 Criminal/Logistics or 5 Civil Sub-folders)
CREATE TABLE corporate_legal_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(180) NOT NULL UNIQUE, -- e.g. 'Container # ABC-12345' or 'Suit # 412/2025'
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

-- 2. Universal Corporate Documents & Metadata Registry
CREATE TABLE corporate_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  root_category corporate_root_category NOT NULL,
  legal_case_id UUID REFERENCES corporate_legal_cases(id) ON DELETE SET NULL,
  sub_folder VARCHAR(160),                 -- Case sub-folder or Master Compliance folder
  tax_authority VARCHAR(60),               -- 'FBR' | 'SRB' | 'Labour Department'
  tax_year VARCHAR(10),                    -- e.g. '2024', '2025', '2026'
  asset_group VARCHAR(80),                 -- 'Security Deposits Tracking' | 'Company Properties & Investments'
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
  sender_issuer VARCHAR(180) NOT NULL,     -- Police, Court, FBR, SRB, Bank, Client
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

CREATE INDEX idx_corp_docs_hierarchy ON corporate_documents (root_category, sub_folder, tax_authority, tax_year);
CREATE INDEX idx_corp_docs_expiry_alarm ON corporate_documents (validity_end_date) WHERE unlimited_validity = FALSE;
CREATE INDEX idx_corp_docs_hearing_alarm ON corporate_documents (hearing_date) WHERE hearing_date IS NOT NULL;
CREATE INDEX idx_corp_docs_quotations ON corporate_documents (quotation_client_name, quotation_status, issuance_date) WHERE root_category = 'Quotations';

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
);`;

export const FIRESTORE_CORPORATE_DMS_SPEC = `// Firebase Firestore Live Collections (Database: ai-studio-dockspvtltd)
// 1. /corporate_legal_cases/{legalCaseId}
//    -> Stores dynamic Legal Case Dossiers & auto-provisioned Criminal/Civil subFolders[]
// 2. /company_documents/{docId}
//    -> Stores universal metadata, hierarchy path (rootCategory, legalCaseId, subFolder,
//       taxAuthority, taxYear, assetGroup, quotationStatus), validity & hearing countdowns
// 3. /document_chunks/{chunkId}
//    -> Multi-megabyte PDF/Image cloud chunk storage (chunk://<docKey>)
// 4. /corporate_vault_credentials/{vaultId}
//    -> Secure Vault records inside Company Documents > Office ID Passwords (Secure Vault)
// 5. /notifications/{notificationId}
//    -> Smart Alarm dispatches (DOC_EXPIRY_ALERT & LEGAL_HEARING_ALERT) to Admin & Doc Manager`;

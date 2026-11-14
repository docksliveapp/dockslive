/**
 * DPL Case Number & Invoice Number Standard Generation Service
 * 
 * Business Rule:
 * Destination-wise case numbering format:
 * DPL-[DEST]-[YY]-[MMM]-[SERIAL]
 * Example for Lahore in September: DPL-LHR-26-SEP-001
 * 
 * DPL    = Docks (Pvt) Ltd.
 * DEST   = Destination Code (e.g. LHR for Lahore, KHI for Karachi, FSD for Faisalabad, etc.)
 * YY     = 2-digit Year (e.g. 26 for 2026)
 * MMM    = 3-letter Month (e.g. SEP, OCT, NOV)
 * SERIAL = Running sequential number (001, 002... up to 100,000+) that continues sequentially until the Year changes.
 * 
 * Invoice Number Rule:
 * The Invoice Number is always identical to the Case Number.
 */

import { getActiveCompanyPrefix } from './companyService';

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

export const DESTINATION_CODES: Record<string, string> = {
  'LAHORE': 'LHR',
  'KARACHI': 'KHI',
  'FAISALABAD': 'FSD',
  'ISLAMABAD': 'ISB',
  'RAWALPINDI': 'RWP',
  'MULTAN': 'MUX',
  'PESHAWAR': 'PEW',
  'SIALKOT': 'SKT',
  'QUETTA': 'QTA',
  'GUJRANWALA': 'GUJ',
  'GWADAR': 'GWD',
  'KABUL': 'KBL',
  'KANDAHAR': 'KDH',
  'JALALABAD': 'JAL',
  'CHAMAN': 'CHM',
  'TORKHAM': 'TKM',
  'HYDERABAD': 'HDD',
  'SUKKUR': 'SKR',
  'SAHIWAL': 'SWL',
  'KASUR': 'KSR',
  'SHEIKHUPURA': 'SKP',
  'GUJRAT': 'GJT',
  'PORT QASIM': 'PQA',
  'KICT': 'KHI',
  'PICTC': 'KHI',
  'SAPT': 'KHI'
};

/**
 * Derives a standard 3-letter destination code from POD / Drop-off location
 */
export function getDestinationCode(destination?: string): string {
  if (!destination || typeof destination !== 'string') {
    return 'LHR';
  }

  const upper = destination.toUpperCase().trim();

  // 1. Prioritize explicit dry port & border station names first (before checking Karachi/KHI so "Karachi to Peshawar" or "Azakhel" always resolves to destination)
  if (upper.includes('PESHAWAR') || upper.includes('AZAKHEL') || upper.includes('JAMRUD') || upper.includes('AMAN GARH') || upper.includes('AMANGARH')) return 'PEW';
  if (upper.includes('TORKHAM') || upper.includes('TOR KHAM')) return 'TKM';
  if (upper.includes('CHAMAN')) return 'CHM';
  if (upper.includes('SPIN BOLDAK')) return 'SPB';
  if (upper.includes('KABUL')) return 'KBL';
  if (upper.includes('KANDAHAR')) return 'KDH';
  if (upper.includes('JALALABAD')) return 'JAL';
  if (upper.includes('LAHORE') || upper.includes('PREM') || upper.includes('MUGHALPURA') || upper.includes('KOT LAKHPAT') || upper.includes('LRDP')) return 'LHR';
  if (upper.includes('FAISALABAD') || upper.includes('GATTI') || upper.includes('CHAK JHUMRA')) return 'FSD';
  if (upper.includes('ISLAMABAD') || upper.includes('CHAKLALA') || upper.includes('MARGALLA')) return 'ISB';
  if (upper.includes('RAWALPINDI')) return 'RWP';
  if (upper.includes('MULTAN') || upper.includes('SHERSHAH')) return 'MUX';
  if (upper.includes('SIALKOT') || upper.includes('SAMBRIAL')) return 'SKT';
  if (upper.includes('QUETTA')) return 'QTA';
  if (upper.includes('GUJRANWALA')) return 'GUJ';
  if (upper.includes('GWADAR')) return 'GWD';
  if (upper.includes('HYDERABAD')) return 'HDD';
  if (upper.includes('SUKKUR')) return 'SKR';
  if (upper.includes('SAHIWAL')) return 'SWL';
  if (upper.includes('KASUR')) return 'KSR';
  if (upper.includes('SHEIKHUPURA')) return 'SKP';
  if (upper.includes('GUJRAT')) return 'GJT';
  if (upper.includes('PORT QASIM') || upper.includes('QICT')) return 'PQA';
  if (upper.includes('KARACHI') || upper.includes('KICT') || upper.includes('PICTC') || upper.includes('SAPT') || upper.includes('KPT')) return 'KHI';

  // 2. Standalone 3-letter destination code match (word-boundary only, never inside another word)
  for (const [city, code] of Object.entries(DESTINATION_CODES)) {
    if (upper.includes(city) || new RegExp(`\\b${code}\\b`).test(upper)) {
      return code;
    }
  }

  // 3. Extract first 3 clean letters if alphanumeric
  const clean = upper.replace(/[^A-Z]/g, '');
  if (clean.length >= 3) {
    return clean.slice(0, 3);
  }

  return 'LHR';
}

export interface ParsedCaseNoParts {
  prefix: string;
  destCode: string;
  year2Digit: string;
  month3Letter: string;
  serial: number;
}

/**
 * Formats a sequential case number: [PREFIX]-[DEST]-[YY]-[MMM]-[SERIAL]
 */
export function buildCaseNo(params: {
  prefix?: string;
  destCode?: string;
  year2Digit?: string;
  month3Letter?: string;
  serial: number;
}): string {
  const now = new Date();
  const prefix = (params.prefix || getActiveCompanyPrefix() || 'DPL').toUpperCase().trim();
  const destCode = (params.destCode || 'LHR').toUpperCase().trim();
  const yy = params.year2Digit || String(now.getFullYear()).slice(-2);
  const mmm = (params.month3Letter || MONTH_NAMES[now.getMonth()]).toUpperCase();
  const serialStr = String(Math.max(1, Math.floor(params.serial))).padStart(3, '0');
  return `${prefix}-${destCode}-${yy}-${mmm}-${serialStr}`;
}

/**
 * Parses a case number string into its structural parts.
 * Supports:
 * - Standard 5-part format: DPL-ISB-26-NOV-132
 * - 3-part format: DPL-26-000132
 * - Legacy 2-part format: DPL-132 (fallbackYear2Digit used when provided)
 */
export function parseCaseNoParts(
  caseNo?: string,
  fallbackDateStr?: string
): ParsedCaseNoParts | null {
  if (!caseNo || typeof caseNo !== 'string') return null;
  const caseStr = caseNo.trim().toUpperCase();
  if (!caseStr) return null;

  // Pattern 1: [PREFIX]-[DEST]-[YY]-[MMM]-[SERIAL]
  const stdMatch = caseStr.match(/^([A-Z]{2,5})-([A-Z0-9]{2,6})-(\d{2})-([A-Z]{3})-(\d+)$/);
  if (stdMatch) {
    const serial = parseInt(stdMatch[5], 10);
    if (!isNaN(serial)) {
      return {
        prefix: stdMatch[1],
        destCode: stdMatch[2],
        year2Digit: stdMatch[3],
        month3Letter: stdMatch[4],
        serial
      };
    }
  }

  // Pattern 2: [PREFIX]-[YY]-(optional MMM-)[SERIAL]
  const yearMatch = caseStr.match(/^([A-Z]{2,5})-(?:([A-Z0-9]+)-)?(\d{2})-(?:([A-Z]{3})-)?(\d+)$/);
  if (yearMatch) {
    const serial = parseInt(yearMatch[5], 10);
    if (!isNaN(serial)) {
      return {
        prefix: yearMatch[1],
        destCode: yearMatch[2] || 'LHR',
        year2Digit: yearMatch[3],
        month3Letter: yearMatch[4] || '',
        serial
      };
    }
  }

  // Pattern 3: [PREFIX]-[SERIAL] legacy format
  const legacyMatch = caseStr.match(/^([A-Z]{2,5})-(\d+)$/);
  if (legacyMatch) {
    const serial = parseInt(legacyMatch[2], 10);
    const derivedYy = fallbackDateStr && /^\d{4}/.test(fallbackDateStr)
      ? fallbackDateStr.slice(2, 4)
      : String(new Date().getFullYear()).slice(-2);
    if (!isNaN(serial)) {
      return {
        prefix: legacyMatch[1],
        destCode: 'LHR',
        year2Digit: derivedYy,
        month3Letter: '',
        serial
      };
    }
  }

  return null;
}

/**
 * Returns the highest serial number used in the given 2-digit year for the given prefix
 * across ALL destinations (LHR, ISB, PEW, KHI, etc.) and ALL months.
 */
export function getMaxCaseSerialForYear(
  existingCases: Array<{ caseNo?: string; createdAt?: string; date?: string }>,
  year2Digit: string,
  customPrefix?: string
): number {
  const targetPrefix = (customPrefix || getActiveCompanyPrefix() || 'DPL').toUpperCase().trim();
  const targetYear = String(year2Digit).slice(-2);
  let maxSeq = 0;

  existingCases.forEach(c => {
    if (!c || !c.caseNo) return;
    const fallbackDate = c.createdAt || c.date || '';
    const parsed = parseCaseNoParts(c.caseNo, fallbackDate);
    if (parsed) {
      if (parsed.prefix === targetPrefix && parsed.year2Digit === targetYear && parsed.serial > maxSeq) {
        maxSeq = parsed.serial;
      }
      return;
    }

    // Fallback for malformed custom case strings matching the target prefix
    const upper = String(c.caseNo).trim().toUpperCase();
    if (upper.startsWith(`${targetPrefix}-`)) {
      const parts = upper.split('-');
      const lastPart = parts[parts.length - 1];
      const seq = parseInt(lastPart, 10);
      const yearPart = parts.find(p => /^\d{2}$/.test(p));
      if (!isNaN(seq) && (!yearPart || yearPart === targetYear) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  });

  return maxSeq;
}

/**
 * Checks whether a given numeric serial is already used by ANY case
 * in the same prefix & year — regardless of destination code (e.g. ISB vs PEW).
 */
export function isCaseSerialTaken(
  existingCases: Array<{ caseNo?: string; createdAt?: string; date?: string }>,
  serial: number,
  year2Digit?: string,
  customPrefix?: string
): boolean {
  if (!serial || isNaN(serial)) return false;
  const targetPrefix = (customPrefix || getActiveCompanyPrefix() || 'DPL').toUpperCase().trim();
  const targetYear = (year2Digit || String(new Date().getFullYear()).slice(-2)).slice(-2);

  return existingCases.some(c => {
    if (!c || !c.caseNo) return false;
    const parsed = parseCaseNoParts(c.caseNo, c.createdAt || c.date || '');
    return Boolean(
      parsed &&
      parsed.prefix === targetPrefix &&
      parsed.year2Digit === targetYear &&
      parsed.serial === serial
    );
  });
}

/**
 * Scans existing cases and generates the next strictly sequential case number
 * format: [PREFIX]-[DEST]-[YY]-[MMM]-[SERIAL] (e.g. DPL-LHR-26-OCT-001, MI-LHR-26-OCT-001, VSL-KHI-26-OCT-001, TRK-LHR-26-OCT-001)
 * Serial resets ONLY when Year changes. Month & destination do NOT reset the serial.
 */
export function generateDplCaseNumber(
  existingCases: Array<{ caseNo?: string; createdAt?: string; date?: string }>,
  destination?: string,
  targetDate: Date = new Date(),
  customPrefix?: string
): string {
  const prefix = (customPrefix || getActiveCompanyPrefix() || 'DPL').toUpperCase().trim();
  const destCode = getDestinationCode(destination);
  const currentYear2Digit = String(targetDate.getFullYear()).slice(-2);
  const currentMonth3Letter = MONTH_NAMES[targetDate.getMonth()];

  const maxSeq = getMaxCaseSerialForYear(existingCases, currentYear2Digit, prefix);
  return buildCaseNo({
    prefix,
    destCode,
    year2Digit: currentYear2Digit,
    month3Letter: currentMonth3Letter,
    serial: maxSeq + 1
  });
}

/**
 * Returns the exact Invoice Number for a case.
 * Business Rule: The Invoice Number is always identical to the Case Number.
 */
export function getCaseInvoiceNumber(caseItem?: { caseNo?: string; id?: string; extractedData?: any }): string {
  const prefix = getActiveCompanyPrefix();
  if (!caseItem) return `${prefix}-INV-PENDING`;
  if (caseItem.caseNo && caseItem.caseNo.trim()) {
    return caseItem.caseNo.trim();
  }
  if (caseItem.extractedData?.invoiceNumber) {
    return String(caseItem.extractedData.invoiceNumber).trim();
  }
  return `${prefix}-${caseItem.id || 'NEW'}`;
}

/**
 * Generates a standardized, deterministic Bill Number linked to a Case Number
 * Format: [LB|DB|TB]-[CASE_NO]-[SEQ] (e.g., LB-DPL-ISB-26-OCT-001 or LB-DPL-ISB-26-OCT-001-02)
 */
export function generateStandardBillNumber(
  billType: 'LB' | 'DB' | 'TB',
  caseNo?: string,
  existingBillsCount: number = 0
): string {
  const prefix = getActiveCompanyPrefix();
  const cleanCase = (caseNo || '').trim().toUpperCase();
  const seqSuffix = existingBillsCount > 0 ? `-${String(existingBillsCount + 1).padStart(2, '0')}` : '';

  if (cleanCase) {
    return `${billType}-${cleanCase}${seqSuffix}`;
  }

  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mmm = MONTH_NAMES[now.getMonth()];
  const serial = String(existingBillsCount + 1).padStart(3, '0');
  return `${prefix}-${billType}-${yy}-${mmm}-${serial}`;
}


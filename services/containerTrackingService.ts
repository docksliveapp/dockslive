import { Case, CaseStatus } from '../types';
import { safeAppStorage } from './storage';
import { restoreCasesFromIndexedDB } from './documentStorage';
import { db } from './firebase';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';

export interface WorkflowProgressSummary {
  category: string;
  totalSteps: number;
  completedStepsCount: number;
  percentage: number;
  isCompleted: boolean;
  currentStep: {
    index: number;
    id: string;
    title: string;
    shortTitle: string;
    description: string;
  } | null;
  incompleteSteps: Array<{
    index: number;
    id: string;
    title: string;
    shortTitle: string;
    description: string;
  }>;
  completedSteps: Array<{
    index: number;
    id: string;
    title: string;
    shortTitle: string;
    description: string;
  }>;
}

/**
 * High-fidelity sample consignments specifically demonstrating:
 * 1. Container WHSU5957558: Arrived 1 year ago (January 2025 - Completed) AND arrived again recently (March 2026 - Active/In-Transit)
 * 2. Container TCLU8492015: Operated by subsidiary Truckit (Pvt.) Ltd (Afghan Transit - Border Clearance Pending)
 * 3. Container MSKU9241852: Operated by subsidiary Vantage Shipping Line (Liner & NVOCC - Port Delivery Order Pending)
 */
export const SEED_TRACKING_CASES: Case[] = [
  // 1A. Container WHSU5957558 - LATEST / CURRENT CONSIGNMENT (2026)
  {
    id: 'case_whsu_2026',
    caseNo: 'DPL-26-0001',
    companyId: 'docks',
    clientName: 'ALFA TEXTILE MILLS (PVT) LTD',
    category: 'Bonded Carrier',
    pol: 'QINGDAO, CHINA',
    pod: 'PORT MUHAMMAD BIN QASIM, KARACHI',
    status: CaseStatus.IN_TRANSIT,
    registrationDate: '2026-03-24',
    createdAt: '2026-03-24T08:30:00.000Z',
    updatedAt: '2026-03-28T14:15:00.000Z',
    blNumber: '027G657324',
    gdNumber: 'KPPI-HC-89210',
    shippingLine: 'WAN HAI LINES',
    shippingAgent: 'RIAZEDA (PVT) LTD',
    documents: [],
    extractedData: {
      shipperName: 'SHANGHAI TEXTILE EXPORT CORP',
      consigneeName: 'ALFA TEXTILE MILLS (PVT) LTD',
      shippingLine: 'WAN HAI LINES',
      shippingAgent: 'RIAZEDA (PVT) LTD',
      blNumber: '027G657324',
      blDate: '2026-03-18',
      pol: 'QINGDAO, CHINA',
      pod: 'PORT MUHAMMAD BIN QASIM, KARACHI',
      vesselName: 'WAN HAI 512',
      voyageNo: 'W042',
      grossWeight: 13410,
      packageCount: 225,
      packagingType: 'ROLLS',
      itemName: 'MICRO VELVET FABRIC (100% POLYESTER)'
    },
    containers: [
      {
        id: 101,
        number: 'WHSU5957558',
        size: '40ft',
        weight: 13410,
        sealNo: 'WHA2024894',
        vehicleNo: 'TLB-892',
        driverName: 'Muhammad Aslam',
        driverContact: '+92-300-8273611',
        driverCnic: '42201-8931201-3',
        status: 'In Transit',
        transporterName: 'Bilal Goods Transport Co.'
      }
    ],
    workflowDetails: {
      [CaseStatus.SHIPPING_LINE_DO]: { status: 'Completed', completed: true, date: '2026-03-24', remarks: 'Shipping Line DO released & verified' },
      [CaseStatus.TP_FILING]: { status: 'Completed', completed: true, date: '2026-03-25', remarks: 'Transit Permit (TP/GD) filed via WeBOC/PSW' },
      [CaseStatus.EXCISE_PAYMENT]: { status: 'Completed', completed: true, date: '2026-03-25', remarks: 'Provincial Excise duty paid & receipt uploaded' },
      [CaseStatus.VEHICLE_ASSIGNMENT]: { status: 'Completed', completed: true, date: '2026-03-26', remarks: 'Bonded Trailer TLB-892 assigned with driver Muhammad Aslam' },
      [CaseStatus.LOADING_PORT_PROCESSING]: { status: 'Completed', completed: true, date: '2026-03-27', remarks: 'Port Qasim gate out with Customs satellite tracking seal' },
      [CaseStatus.IN_TRANSIT]: { status: 'In Progress', completed: false, date: '2026-03-28', remarks: 'Live highway transit monitoring via satellite GPS' }
    }
  },

  // 1B. Container WHSU5957558 - PREVIOUS CONSIGNMENT FROM 1 YEAR AGO (2025)
  // Demonstrates user brief: "1 container 1 sal pahle bhi hamare pass aaya tha same number ka vahi sem container dobara a gaya hai"
  {
    id: 'case_whsu_2025',
    caseNo: 'DPL-25-0142',
    companyId: 'docks',
    clientName: 'ALFA TEXTILE MILLS (PVT) LTD',
    category: 'Bonded Carrier',
    pol: 'NINGBO, CHINA',
    pod: 'KARACHI PORT TRUST (KPT)',
    status: CaseStatus.COMPLETED,
    registrationDate: '2025-01-12',
    createdAt: '2025-01-12T09:10:00.000Z',
    updatedAt: '2025-01-28T16:00:00.000Z',
    blNumber: '027G510892',
    gdNumber: 'KAPE-HC-44019',
    shippingLine: 'WAN HAI LINES',
    shippingAgent: 'RIAZEDA (PVT) LTD',
    documents: [],
    extractedData: {
      shipperName: 'ZHEJIANG TEXTILE FIBER CO.',
      consigneeName: 'ALFA TEXTILE MILLS (PVT) LTD',
      shippingLine: 'WAN HAI LINES',
      shippingAgent: 'RIAZEDA (PVT) LTD',
      blNumber: '027G510892',
      blDate: '2025-01-05',
      pol: 'NINGBO, CHINA',
      pod: 'KARACHI PORT TRUST (KPT)',
      vesselName: 'WAN HAI 505',
      voyageNo: 'E019',
      grossWeight: 12850,
      packageCount: 210,
      packagingType: 'ROLLS',
      itemName: 'DYED POLYESTER YARN'
    },
    containers: [
      {
        id: 102,
        number: 'WHSU5957558',
        size: '40ft',
        weight: 12850,
        sealNo: 'WHA1983021',
        vehicleNo: 'KHI-7721',
        driverName: 'Abdul Sattar',
        driverContact: '+92-321-4455881',
        status: 'Delivered',
        transporterName: 'Al-Makkah Transport Network'
      }
    ]
  },

  // 2. Container TCLU8492015 - OPERATED BY TRUCKIT (PVT.) LTD (AFGHAN TRANSIT / BONDED CARRIER)
  {
    id: 'case_tclu_truckit',
    caseNo: 'TRK-26-0044',
    companyId: 'truckit',
    clientName: 'KABUL CARGO LOGISTICS & TRADING',
    category: 'Afghan Transit',
    pol: 'BANDAR ABBAS / KARACHI',
    pod: 'CHAMAN BORDER TERMINAL',
    status: 'In Transit to Border Terminal',
    registrationDate: '2026-03-25',
    createdAt: '2026-03-25T11:20:00.000Z',
    updatedAt: '2026-03-29T10:00:00.000Z',
    blNumber: 'MEDU8891240',
    gdNumber: 'PSW-ATT-77291',
    shippingLine: 'Mediterranean Shipping Company (MSC)',
    shippingAgent: 'MSC Agency Pakistan',
    documents: [],
    extractedData: {
      shipperName: 'DUBAI AUTO TRADING LLC',
      consigneeName: 'KABUL CARGO LOGISTICS & TRADING',
      shippingLine: 'MSC',
      blNumber: 'MEDU8891240',
      pol: 'JEBEL ALI, UAE',
      pod: 'CHAMAN BORDER TERMINAL',
      vesselName: 'MSC ANNA',
      voyageNo: '2401B',
      grossWeight: 22400,
      packageCount: 450,
      packagingType: 'PACKAGES',
      itemName: 'COMMERCIAL AUTO SPARE PARTS & ACCESSORIES'
    },
    containers: [
      {
        id: 201,
        number: 'TCLU8492015',
        size: '40ft',
        weight: 22400,
        sealNo: 'MSC901844',
        vehicleNo: 'P-9912',
        driverName: 'Gul Khan',
        driverContact: '+92-333-9118822',
        status: 'In Transit',
        transporterName: 'Khyber Bonded Carriers'
      }
    ]
  },

  // 3. Container MSKU9241852 - OPERATED BY VANTAGE SHIPPING LINE (NVOCC)
  {
    id: 'case_msku_vantage',
    caseNo: 'VAN-26-0089',
    companyId: 'vantage',
    clientName: 'CRESCENT INDUSTRIAL CHEMICALS',
    category: 'Import & Export Services',
    pol: 'PORT OF SINGAPORE',
    pod: 'PORT QASIM, KARACHI',
    status: 'Customs Examination & Appraisal',
    registrationDate: '2026-03-27',
    createdAt: '2026-03-27T14:40:00.000Z',
    updatedAt: '2026-03-30T09:20:00.000Z',
    blNumber: 'MSKU0928172',
    gdNumber: 'KPPI-HC-92314',
    shippingLine: 'Maersk Line',
    shippingAgent: 'Maersk Pakistan',
    documents: [],
    extractedData: {
      shipperName: 'SINOPEC CHEMICAL ENTERPRISES',
      consigneeName: 'CRESCENT INDUSTRIAL CHEMICALS',
      shippingLine: 'Maersk Line',
      blNumber: 'MSKU0928172',
      pol: 'SINGAPORE',
      pod: 'PORT QASIM, KARACHI',
      vesselName: 'MAERSK MC-KINNEY MOLLER',
      voyageNo: '2604W',
      grossWeight: 19800,
      packageCount: 80,
      packagingType: 'DRUMS',
      itemName: 'INDUSTRIAL SOLVENT RAW MATERIAL'
    },
    containers: [
      {
        id: 301,
        number: 'MSKU9241852',
        size: '20ft',
        weight: 19800,
        sealNo: 'ML-992144',
        status: 'Loaded'
      }
    ]
  }
];

const COMPANY_STORAGE_KEYS = [
  'dpl_live_cases',
  'dpl_live_cases_docks',
  'dpl_live_cases_truckit',
  'dpl_live_cases_muhib',
  'dpl_live_cases_vantage'
];

/**
 * Gathers all cases across all companies from:
 * 1. LocalStorage across all partitioned keys
 * 2. IndexedDB backups
 * 3. Firestore 'cases' collection
 * 4. High-fidelity demo seeds
 */
export async function fetchAllTrackingCases(): Promise<Case[]> {
  const mergedMap = new Map<string, Case>();

  // 1. Seed with built-in reference cases
  SEED_TRACKING_CASES.forEach((c) => {
    const k = c.caseNo || c.id;
    if (k) mergedMap.set(k, c);
  });

  // 2. Read from all company partitions in localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    COMPANY_STORAGE_KEYS.forEach((key) => {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            parsed.forEach((c: Case) => {
              const k = c.caseNo || c.id;
              if (k) mergedMap.set(k, { ...c, companyId: c.companyId || (key.includes('truckit') ? 'truckit' : key.includes('muhib') ? 'muhib' : key.includes('vantage') ? 'vantage' : 'docks') });
            });
          }
        }
      } catch (_) {}
    });
  }

  // 3. Read from IndexedDB
  try {
    const idbCases = await restoreCasesFromIndexedDB();
    if (Array.isArray(idbCases)) {
      idbCases.forEach((c: Case) => {
        const k = c.caseNo || c.id;
        if (k) {
          const existing = mergedMap.get(k);
          if (!existing) {
            mergedMap.set(k, c);
          } else {
            mergedMap.set(k, { ...existing, ...c });
          }
        }
      });
    }
  } catch (_) {}

  // 4. Read from Firestore
  try {
    const snap = await getDocs(collection(db, 'cases'));
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Case;
      const k = data.caseNo || docSnap.id;
      if (k) {
        const existing = mergedMap.get(k);
        if (!existing) {
          mergedMap.set(k, { ...data, id: docSnap.id });
        } else {
          mergedMap.set(k, { ...existing, ...data, id: docSnap.id });
        }
      }
    });
  } catch (_) {}

  return Array.from(mergedMap.values());
}

/**
 * Parses user input into multiple search tokens (supports 2+ container numbers, comma/space/slash separated).
 */
export function parseTrackingTokens(query: string): string[] {
  if (!query) return [];
  // Split on commas, semicolons, slashes, pipes, newlines, or spaces
  const rawParts = query.split(/[,;\n\r/|]+|\s+/);
  const cleanTokens = rawParts
    .map(p => p.trim())
    .filter(p => p.length >= 2);
  
  if (cleanTokens.length === 0 && query.trim()) {
    return [query.trim()];
  }
  // Return unique tokens up to 10
  return Array.from(new Set(cleanTokens));
}

/**
 * Searches cases by Container Number(s), B/L Number, or Case Reference.
 * Automatically matches all identifiers (containers, BL, Case No, GD No) without requiring manual type selection.
 * Supports multi-container queries (e.g. 2 container numbers entered together).
 * Returns sorted list with most recent consignment first.
 */
export function searchTrackingCases(query: string, allCases: Case[]): Case[] {
  if (!query) return [];
  const tokens = parseTrackingTokens(query);
  if (tokens.length === 0) return [];

  const cleanTokens = tokens.map(t => t.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim()).filter(Boolean);
  if (cleanTokens.length === 0) return [];

  const matched = allCases.filter((c) => {
    // Collect all searchable terms on this case
    const terms: string[] = [];

    // 1. Containers
    (c.containers || []).forEach(cont => {
      const num = (cont.number || (cont as any).containerNo || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (num) terms.push(num);
    });
    if (c.containerNumber) {
      const directNum = c.containerNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (directNum) terms.push(directNum);
    }

    // 2. B/L Number
    const bl = (c.blNumber || c.extractedData?.blNumber || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (bl) terms.push(bl);

    // 3. Case Reference (e.g. DPL-26-0001, TRK-26-0044)
    const caseNo = (c.caseNo || c.caseNumber || c.id || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (caseNo) terms.push(caseNo);

    // 4. GD Number
    const gd = (c.gdNumber || c.extractedData?.gdNo || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (gd) terms.push(gd);

    // 5. Seal numbers & Vehicle numbers
    (c.containers || []).forEach(cont => {
      if (cont.sealNo) terms.push(cont.sealNo.replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
      if (cont.vehicleNo) terms.push(cont.vehicleNo.replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
    });

    // Check if ANY searched token matches any of the case's terms
    return cleanTokens.some(tok => {
      return terms.some(term => term.includes(tok) || tok.includes(term));
    });
  });

  // Sort descending by registration / creation date (newest first)
  return matched.sort((a, b) => {
    const timeA = new Date(a.createdAt || a.registrationDate || a.date || 0).getTime();
    const timeB = new Date(b.createdAt || b.registrationDate || b.date || 0).getTime();
    return timeB - timeA;
  });
}

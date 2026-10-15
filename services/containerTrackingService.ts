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

export const SEED_TRACKING_CASES: Case[] = [];

const COMPANY_STORAGE_KEYS = [
  'dpl_live_cases',
  'dpl_live_cases_docks',
  'dpl_live_cases_truckit',
  'dpl_live_cases_muhib',
  'dpl_live_cases_vantage'
];

/**
 * Gathers all cases across all companies from live Firestore 'cases' collection.
 * Respects app reset state so no stale or dummy cases appear after reset.
 */
export async function fetchAllTrackingCases(): Promise<Case[]> {
  const mergedMap = new Map<string, Case>();

  // 1. Read directly from Firestore 'cases' collection as primary source of truth across all 4 companies
  try {
    const snap = await getDocs(collection(db, 'cases'));
    if (snap.empty) {
      // Firestore is empty (e.g. after database reset) -> ensure local caches are also cleared
      if (typeof window !== 'undefined' && window.localStorage) {
        COMPANY_STORAGE_KEYS.forEach((key) => {
          try {
            window.localStorage.setItem(key, '[]');
          } catch (_) {}
        });
      }
      return [];
    }

    snap.forEach((docSnap) => {
      const data = docSnap.data() as Case;
      const compId = (data.companyId || 'docks').toLowerCase();
      const uniqueKey = `${compId}__${docSnap.id || data.caseNumber || data.caseNo}`;
      mergedMap.set(uniqueKey, {
        ...data,
        id: docSnap.id,
        companyId: compId as any,
        caseNo: data.caseNo || data.caseNumber || docSnap.id
      });
    });
    return Array.from(mergedMap.values());
  } catch (_) {
    // Offline fallback: read from localStorage only if Firestore could not be reached
    if (typeof window !== 'undefined' && window.localStorage) {
      COMPANY_STORAGE_KEYS.forEach((key) => {
        try {
          const raw = window.localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              parsed.forEach((c: Case, idx: number) => {
                const compId = (c.companyId || (key.includes('truckit') ? 'truckit' : key.includes('muhib') ? 'muhib' : key.includes('vantage') ? 'vantage' : 'docks')).toLowerCase();
                const uniqueKey = `${compId}__${c.id || c.caseNumber || c.caseNo || idx}`;
                mergedMap.set(uniqueKey, {
                  ...c,
                  companyId: compId as any,
                  caseNo: c.caseNo || c.caseNumber || String(c.id || '')
                });
              });
            }
          }
        } catch (_) {}
      });
    }
  }

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
 * Searches cases by Container Number(s), B/L Number, or Case Reference across all 4 companies (current & past).
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

    // 1. Containers (from c.containers, c.extractedData.containers, c.containerNumber, c.containerNo)
    (c.containers || []).forEach(cont => {
      const num = (cont.number || (cont as any).containerNo || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (num) terms.push(num);
    });
    const extractedContainers = (c.extractedData as any)?.containers;
    if (Array.isArray(extractedContainers)) {
      extractedContainers.forEach((cont: any) => {
        const num = String(cont?.number || cont?.containerNo || cont || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (num) terms.push(num);
      });
    }
    if (c.containerNumber) {
      const directNum = c.containerNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (directNum) terms.push(directNum);
    }
    if ((c as any).containerNo) {
      const directNo = String((c as any).containerNo).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (directNo) terms.push(directNo);
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
    if ((c as any).vehicleNo) terms.push(String((c as any).vehicleNo).replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
    if ((c as any).truckNumber) terms.push(String((c as any).truckNumber).replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
    if ((c as any).assignedVehiclePlate) terms.push(String((c as any).assignedVehiclePlate).replace(/[^a-zA-Z0-9]/g, '').toLowerCase());

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

export interface MatchedContainerItem {
  id: string | number;
  containerNumber: string;
  size: string;
  sealNo?: string;
  weight?: number;
  vehicleNo?: string;
  driverName?: string;
  driverContact?: string;
  driverCnic?: string;
  transporterName?: string;
  caseNo: string;
  caseId: string;
  blNumber: string;
  companyId: string;
  companyName: string;
  category: string;
  pol: string;
  pod: string;
  status: string;
  currentWorkflowStep: string;
  currentWorkflowDescription: string;
  currentWorkflowStepIndex: number;
  totalWorkflowSteps: number;
  progressPercent: number;
  isCompleted: boolean;
  registrationDate: string;
  caseItem: Case;
}

/**
 * Extracts individual matching container items across all matching cases (across all companies, current and past).
 */
export function extractMatchingContainers(
  query: string,
  matchedCases: Case[],
  getWorkflowFn?: (category?: string) => any,
  getStepIndexFn?: (category?: string, status?: any) => number
): MatchedContainerItem[] {
  if (!matchedCases || matchedCases.length === 0) return [];
  const cleanQ = (query || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim();
  const items: MatchedContainerItem[] = [];

  matchedCases.forEach((c, caseIdx) => {
    const cid = (c.companyId || 'docks').toLowerCase();
    const compName = cid === 'truckit' ? 'Truckit (Pvt.) Ltd.' :
                     cid === 'muhib' ? 'Muhib International (SMC-Pvt.) Ltd.' :
                     cid === 'vantage' ? 'Vantage Shipping Line' :
                     'Docks (Pvt.) Ltd.';

    const effectiveCaseNo = c.caseNo || c.caseNumber || String(c.id || '');
    let workflowTitle = String(c.status || 'Active Operations');
    let workflowDesc = 'Consignment is undergoing authorized operational milestones.';
    let activeStepIdx = 0;
    let totalSteps = 6;
    const isCompleted =
      c.status === CaseStatus.COMPLETED ||
      String(c.status).toLowerCase().includes('completed') ||
      String(c.status).toLowerCase().includes('delivered') ||
      String(c.status).toLowerCase().includes('finished');

    if (getWorkflowFn && getStepIndexFn) {
      try {
        const wf = getWorkflowFn(c.category);
        totalSteps = wf.totalSteps || 6;
        activeStepIdx = getStepIndexFn(c.category, c.status);
        const curStep = wf.steps?.[activeStepIdx];
        if (isCompleted) {
          workflowTitle = 'Completed & Delivered';
          workflowDesc = 'All customs and delivery milestones verified successfully.';
        } else if (curStep) {
          workflowTitle = curStep.title || curStep.shortTitle || String(c.status);
          workflowDesc = curStep.description || '';
        }
      } catch (_) {}
    }

    const progressPercent = isCompleted ? 100 : Math.round((Math.max(activeStepIdx, 0) / Math.max(totalSteps, 1)) * 100);

    let containersList: any[] = [];
    if (c.containers && c.containers.length > 0) {
      containersList = c.containers;
    } else if (Array.isArray((c.extractedData as any)?.containers) && (c.extractedData as any).containers.length > 0) {
      containersList = (c.extractedData as any).containers.map((ec: any, i: number) =>
        typeof ec === 'string' ? { id: i + 1, number: ec, size: '40ft', status: c.status } : ec
      );
    } else if (c.containerNumber || (c as any).containerNo) {
      containersList = [{ id: 1, number: c.containerNumber || (c as any).containerNo, size: '40ft', status: c.status }];
    }

    containersList.forEach((cont: any, idx: number) => {
      const cNum = cont.number || cont.containerNo || `CONT-${idx + 1}`;
      const cNumClean = String(cNum).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      const matchesDirectly = !cleanQ ||
        cNumClean.includes(cleanQ) ||
        cleanQ.includes(cNumClean) ||
        String(c.blNumber || c.extractedData?.blNumber || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().includes(cleanQ) ||
        String(effectiveCaseNo).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().includes(cleanQ) ||
        String(cont.vehicleNo || (c as any).vehicleNo || (c as any).truckNumber || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().includes(cleanQ);

      if (matchesDirectly) {
        items.push({
          id: `${cid}_${c.id || effectiveCaseNo}_${caseIdx}_cont_${cont.id || idx}`,
          containerNumber: cNum,
          size: cont.size || '40ft',
          sealNo: cont.sealNo || '',
          weight: cont.weight || c.extractedData?.grossWeight,
          vehicleNo: cont.vehicleNo || (c as any).vehicleNo || (c as any).truckNumber || (c as any).assignedVehiclePlate,
          driverName: cont.driverName || (c as any).driverName,
          driverContact: cont.driverContact || (c as any).driverContact,
          driverCnic: cont.driverCnic || (c as any).driverCnic,
          transporterName: cont.transporterName || (c as any).transporterName,
          caseNo: effectiveCaseNo,
          caseId: c.id,
          blNumber: c.blNumber || c.extractedData?.blNumber || 'N/A',
          companyId: cid,
          companyName: compName,
          category: c.category || 'Bonded Carrier',
          pol: c.pol || c.extractedData?.pol || 'Port of Loading',
          pod: c.pod || c.extractedData?.pod || 'Port of Discharge',
          status: String(c.status || 'Active'),
          currentWorkflowStep: workflowTitle,
          currentWorkflowDescription: workflowDesc,
          currentWorkflowStepIndex: activeStepIdx,
          totalWorkflowSteps: totalSteps,
          progressPercent,
          isCompleted,
          registrationDate: c.registrationDate || c.date || c.createdAt?.slice(0, 10) || 'N/A',
          caseItem: c
        });
      }
    });
  });

  return items;
}


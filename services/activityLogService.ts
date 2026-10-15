import { safeAppStorage } from './storage';
import { db } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, limit, deleteDoc, doc, getDocs, writeBatch } from 'firebase/firestore';
import { getActiveCompanyId, CompanyId } from './companyService';

const matchesActiveCompany = (recordCompanyId?: string, targetCompanyId?: CompanyId): boolean => {
  const active = targetCompanyId || getActiveCompanyId();
  const normalizedRecord = (recordCompanyId || 'DPL').toUpperCase();
  return normalizedRecord === active.toUpperCase();
};

export interface ActivityLogItem {
  id: string;
  timestamp: string;
  userId: string;
  userRole: string;
  action: string;
  details: string;
  metadata?: any;
  title?: string;
  role?: string;
  description?: string;
  performedBy?: string;
  companyId?: CompanyId;
}

export type ActivityLogRecord = ActivityLogItem;

const STORAGE_KEY = 'dpl_system_activity_logs';

/**
 * Checks whether an activity log record is stale/orphaned (e.g. from before a reset,
 * a legacy Daily Financial History Summary with 0 amounts, or referencing deleted cases/finances/vehicles).
 */
export function isOrphanedActivityLog(log: ActivityLogItem): boolean {
  if (!log) return true;
  const titleText = (log.title || log.action || '').trim();
  const descText = (log.description || log.details || '').trim();
  const combinedLower = `${titleText} ${descText}`.toLowerCase();

  if (!titleText && !descText) return true;

  // 1. Always filter out legacy automated "Daily Financial History Summary" entries
  if (combinedLower.includes('daily financial history summary')) {
    return true;
  }

  // 2. Check against last reset timestamp if present
  const lastResetIso = safeAppStorage.getRawItem('dpl_last_reset_timestamp');
  if (lastResetIso && log.timestamp) {
    const resetTime = new Date(lastResetIso).getTime();
    const logTime = new Date(log.timestamp).getTime();
    if (!isNaN(resetTime) && !isNaN(logTime) && logTime < resetTime) {
      return true;
    }
  }

  // 3. Check if log references a Case when Cases collection is empty or that specific case was deleted
  const liveCases = safeAppStorage.getJSON<any[]>('dpl_live_cases', []) || [];
  const caseMatch = `${titleText} ${descText}`.match(/#(DPL-[A-Z0-9-]+|MI-[A-Z0-9-]+|VSL-[A-Z0-9-]+|TRK-[A-Z0-9-]+)/i);
  const metadataCaseNo = log.metadata?.caseNo || (caseMatch ? caseMatch[1] : undefined);

  const isCaseLog =
    Boolean(metadataCaseNo) ||
    combinedLower.includes('new case registered') ||
    combinedLower.includes('new shipment') ||
    combinedLower.includes('case #') ||
    combinedLower.includes('consignment');

  if (isCaseLog) {
    if (liveCases.length === 0) return true;
    if (metadataCaseNo) {
      const exists = liveCases.some(
        (c) => String(c.caseNo || c.caseNumber || '').toUpperCase() === String(metadataCaseNo).toUpperCase()
      );
      if (!exists) return true;
    }
  }

  // 4. Check if log references Finance when all finance arrays are empty
  const liveFin = safeAppStorage.getJSON<any[]>('dpl_live_finance', []) || [];
  const liveRecv = safeAppStorage.getJSON<any[]>('dpl_live_receivables', []) || [];
  const livePay = safeAppStorage.getJSON<any[]>('dpl_live_payables', []) || [];
  const isFinanceLog =
    log.metadata?.category === 'FINANCE' ||
    String(log.userRole || log.role || '').toUpperCase().includes('FINANCE') ||
    combinedLower.includes('payment paid') ||
    combinedLower.includes('payment received') ||
    combinedLower.includes('payable invoice') ||
    combinedLower.includes('receivable invoice') ||
    combinedLower.includes('monthly fixed expense');

  if (isFinanceLog && liveFin.length === 0 && liveRecv.length === 0 && livePay.length === 0) {
    return true;
  }

  // 5. Check if log references Vehicles when Vehicles collection is empty
  const liveVehicles = safeAppStorage.getJSON<any[]>('dpl_live_vehicles', []) || [];
  const isVehicleLog =
    log.metadata?.category === 'TRANSPORTER' ||
    String(log.userRole || log.role || '').toUpperCase().includes('VEHICLE') ||
    String(log.userRole || log.role || '').toUpperCase().includes('TRANSPORTER') ||
    combinedLower.includes('vehicle registered') ||
    combinedLower.includes('vehicle renewed') ||
    combinedLower.includes('vehicle cancelled') ||
    combinedLower.includes('vehicle expired');

  if (isVehicleLog && liveVehicles.length === 0) {
    return true;
  }

  return false;
}

export const logActivity = async (
  action: string,
  details: string,
  userRole: string = 'System',
  userId: string = 'SYS-01',
  metadata?: any
): Promise<void> => {
  const activeCompany = getActiveCompanyId();
  const newLog: ActivityLogItem = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    userId,
    userRole,
    action,
    details,
    metadata,
    title: action,
    role: userRole,
    description: details,
    performedBy: userId,
    companyId: metadata?.companyId || activeCompany
  };

  if (isOrphanedActivityLog(newLog)) {
    return;
  }

  // 1. Save locally
  try {
    const existing = (safeAppStorage.getJSON<ActivityLogItem[]>(STORAGE_KEY, []) || []).filter(
      (item) => !isOrphanedActivityLog(item)
    );
    const updated = [newLog, ...existing.slice(0, 199)]; // Keep latest 200
    safeAppStorage.setJSON(STORAGE_KEY, updated);
  } catch (err) {
    console.warn('Could not save log to local storage:', err);
  }

  // 2. Save to Firestore if available
  if (db) {
    try {
      await addDoc(collection(db, 'activity_logs'), newLog);
    } catch (err) {
      console.warn('Could not save activity log to Firestore:', err);
    }
  }
};

export const clearAllActivityLogs = async (companyId?: CompanyId): Promise<void> => {
  try {
    if (!companyId) {
      safeAppStorage.setJSON(STORAGE_KEY, []);
      safeAppStorage.removeItem(STORAGE_KEY);
    } else {
      const existing = safeAppStorage.getJSON<ActivityLogItem[]>(STORAGE_KEY, []) || [];
      safeAppStorage.setJSON(
        STORAGE_KEY,
        existing.filter((l) => !matchesActiveCompany(l.companyId, companyId) && !isOrphanedActivityLog(l))
      );
    }
  } catch (_) {}

  if (!db) return;
  try {
    const snap = await getDocs(collection(db, 'activity_logs'));
    if (snap.empty) return;
    const docsToDelete = companyId
      ? snap.docs.filter((d) => matchesActiveCompany(d.data().companyId, companyId) || isOrphanedActivityLog({ id: d.id, ...(d.data() as any) }))
      : snap.docs;
    for (let i = 0; i < docsToDelete.length; i += 400) {
      const chunk = docsToDelete.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (err) {
    console.warn('Failed to clear activity_logs from Firestore:', err);
  }
};

export const subscribeToActivityLogs = (
  callback: (logs: ActivityLogItem[]) => void
): (() => void) => {
  let latestRawLogs: ActivityLogItem[] = [];

  const emitFiltered = (rawList: ActivityLogItem[]) => {
    const valid = rawList.filter((item) => !isOrphanedActivityLog(item));
    safeAppStorage.setJSON(STORAGE_KEY, valid);
    callback(valid);
  };

  // Initial local state (filtered against orphaned/reset state)
  const initialLocal = safeAppStorage.getJSON<ActivityLogItem[]>(STORAGE_KEY, []) || [];
  latestRawLogs = initialLocal;
  emitFiltered(initialLocal);

  const handleStateRevalidate = () => {
    const currentStored = safeAppStorage.getJSON<ActivityLogItem[]>(STORAGE_KEY, []) || [];
    if (currentStored.length === 0) {
      latestRawLogs = [];
      callback([]);
      return;
    }
    emitFiltered(latestRawLogs.length > 0 ? latestRawLogs : currentStored);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('dpl_cases_updated', handleStateRevalidate);
    window.addEventListener('dpl_finance_updated', handleStateRevalidate);
    window.addEventListener('dpl_notification_updated', handleStateRevalidate);
    window.addEventListener('storage', handleStateRevalidate);
  }

  if (!db) {
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('dpl_cases_updated', handleStateRevalidate);
        window.removeEventListener('dpl_finance_updated', handleStateRevalidate);
        window.removeEventListener('dpl_notification_updated', handleStateRevalidate);
        window.removeEventListener('storage', handleStateRevalidate);
      }
    };
  }

  try {
    const q = query(collection(db, 'activity_logs'), orderBy('timestamp', 'desc'), limit(100));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const validLogs: ActivityLogItem[] = [];
        const orphanRefs: any[] = [];

        snapshot.forEach((docSnap) => {
          const item: ActivityLogItem = { id: docSnap.id, ...(docSnap.data() as any) };
          if (isOrphanedActivityLog(item)) {
            orphanRefs.push(docSnap.ref);
          } else {
            validLogs.push(item);
          }
        });

        // Automatically delete orphaned/pre-reset logs from Firestore in the background
        if (orphanRefs.length > 0) {
          (async () => {
            try {
              for (let i = 0; i < orphanRefs.length; i += 400) {
                const chunk = orphanRefs.slice(i, i + 400);
                const batch = writeBatch(db);
                chunk.forEach((r) => batch.delete(r));
                await batch.commit();
              }
            } catch (_) {}
          })();
        }

        latestRawLogs = validLogs;
        safeAppStorage.setJSON(STORAGE_KEY, validLogs);
        callback(validLogs);
      },
      (error) => {
        console.warn('Activity logs snapshot error:', error);
        const fallbackLocal = (safeAppStorage.getJSON<ActivityLogItem[]>(STORAGE_KEY, []) || []).filter(
          (item) => !isOrphanedActivityLog(item)
        );
        callback(fallbackLocal);
      }
    );
    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('dpl_cases_updated', handleStateRevalidate);
        window.removeEventListener('dpl_finance_updated', handleStateRevalidate);
        window.removeEventListener('dpl_notification_updated', handleStateRevalidate);
        window.removeEventListener('storage', handleStateRevalidate);
      }
    };
  } catch (err) {
    console.warn('Could not listen to Firestore activity logs:', err);
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('dpl_cases_updated', handleStateRevalidate);
        window.removeEventListener('dpl_finance_updated', handleStateRevalidate);
        window.removeEventListener('dpl_notification_updated', handleStateRevalidate);
        window.removeEventListener('storage', handleStateRevalidate);
      }
    };
  }
};


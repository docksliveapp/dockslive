import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc,
  deleteDoc, 
  onSnapshot,
  getDocs,
  getDoc,
  query,
  where,
  writeBatch,
  runTransaction
} from 'firebase/firestore';
import { 
  db, 
  auth, 
  handleFirestoreError, 
  OperationType,
  saveActiveDbUserSession,
  getActiveDbUserSession,
  clearActiveDbUserSession
} from './firebase';
import { Case, FinanceEntry, Vehicle, AppNotification, AppUser, Client, UserRole, RecurringFinanceTemplate, DestinationStaff, StaffLedgerEntry, Vendor, StaffLoadingBill, StaffPrivateLedgerEntry, AvailableVehicle, TransporterRequest, CompanyDocument, CompanyExplorerFolder, CorporateLegalCase, CorporateVaultCredential, DEFAULT_COMPANY_DOCUMENT_CATEGORIES, PersonalLedgerAccount, PersonalLedgerEntry, Driver, SalaryStaffMember, FranchiseProfile, FranchiseLedgerEntry } from '../types';
import { doesDestinationMatchFranchise } from './corporateFilingArchitecture';
import { saveVendor } from './vendorService';
import { safeAppStorage } from './storage';
import { logActivity } from './activityLogService';
import { dedupeAndMergeVehicles, normalizeVehiclePlate, getDeterministicVehicleId } from './documentParserService';
import { getActiveCompanyId, getActiveCompanyPrefix, subscribeToActiveCompany, CompanyId, PARENT_GROUP, GROUP_COMPANIES } from './companyService';
import { getDestinationCode, getMaxCaseSerialForYear, buildCaseNo, parseCaseNoParts } from './caseNumberService';
import { hasCaseCompletedLoadingGateOut, hasCaseArrivedAtDestination } from './workflowConfig';
import { 
  saveDocumentToIndexedDB, 
  saveDocumentToCloudChunks,
  sanitizeCloudDocKey,
  backupCasesToIndexedDB, 
  backupVehiclesToIndexedDB, 
  restoreCasesFromIndexedDB, 
  restoreVehiclesFromIndexedDB,
  clearOperationalIndexedDBCache
} from './documentStorage';

/**
 * Checks if a record belongs to the currently active company.
 * Note: 'docks' owns records with companyId === 'docks' as well as legacy untagged records.
 */
export function matchesActiveCompany(itemCompanyId?: string, targetCompanyId?: string): boolean {
  const current = targetCompanyId || getActiveCompanyId();
  if (current === 'docks') {
    return !itemCompanyId || itemCompanyId === 'docks';
  }
  return itemCompanyId === current;
}

/**
 * Sanitizes an object recursively to ensure it is 100% compliant with Firestore and protected against corruption/injection:
 * - Blocks prototype pollution keys (__proto__, constructor, prototype).
 * - Replaces any browser File or Blob instances with clean JSON metadata objects.
 * - Converts NaN / Infinity numbers to 0 so Firestore never rejects a numeric write.
 * - Removes undefined keys or values that cause Firestore serialization exceptions.
 */
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeForFirestore(obj: any): any {
  if (obj === undefined) return null;
  if (typeof obj === 'number') {
    return Number.isFinite(obj) ? obj : 0;
  }
  if (obj === null || typeof obj !== 'object') return obj;

  if (obj instanceof Date) {
    return isNaN(obj.getTime()) ? new Date().toISOString() : obj.toISOString();
  }

  if (obj instanceof File || obj instanceof Blob) {
    return {
      name: (obj as File).name || 'document',
      type: (obj as File).type || 'application/octet-stream',
      size: (obj as File).size || 0,
      url: ''
    };
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item));
  }

  const clean: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
    const val = obj[key];
    if (val !== undefined) {
      // Guard against large base64 dataUrls (>150KB) that cause Firestore 1MB document rejection
      if (typeof val === 'string' && val.startsWith('data:') && val.length > 150000) {
        clean[key] = ''; // Offloaded prior via offloadLargeDataUrlsToCloudChunks -> chunk://...
      } else {
        clean[key] = sanitizeForFirestore(val);
      }
    }
  }
  return clean;
}

/**
 * Recursively walks an object BEFORE Firestore write, uploads any >140KB data: URL
 * to Firestore `document_chunks` + IndexedDB, and replaces it with `chunk://<docKey>`
 * so multi-megabyte PDFs and high-res scans sync seamlessly across all devices.
 */
async function offloadLargeDataUrlsToCloudChunks(
  obj: any,
  contextPrefix: string,
  caseNo?: string
): Promise<any> {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (obj instanceof Date || obj instanceof File || obj instanceof Blob) return obj;

  if (Array.isArray(obj)) {
    const out = await Promise.all(
      obj.map((item, idx) =>
        offloadLargeDataUrlsToCloudChunks(item, `${contextPrefix}_${idx}`, caseNo)
      )
    );
    return out;
  }

  const clone: Record<string, any> = {};
  const objNameHint = typeof obj.name === 'string' && obj.name ? obj.name : (typeof obj.fileName === 'string' && obj.fileName ? obj.fileName : '');
  const objIdHint = typeof obj.id === 'string' && obj.id ? obj.id : '';
  const objTypeHint = typeof obj.type === 'string' && obj.type ? obj.type : (typeof obj.fileType === 'string' && obj.fileType ? obj.fileType : 'application/pdf');
  const objSizeHint = typeof obj.size === 'number' ? obj.size : (typeof obj.fileSize === 'number' ? obj.fileSize : 0);

  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
    const val = obj[key];
    if (typeof val === 'string' && val.startsWith('data:') && val.length > 140000) {
      const logicalKey = sanitizeCloudDocKey(
        caseNo && objNameHint
          ? `${caseNo}_${objNameHint}`
          : objIdHint
            ? `${contextPrefix}_${objIdHint}`
            : objNameHint
              ? `${contextPrefix}_${objNameHint}`
              : `${contextPrefix}_${key}`
      );
      try {
        const chunkUri = await saveDocumentToCloudChunks({
          docKey: logicalKey,
          name: objNameHint || key,
          mimeType: objTypeHint,
          size: objSizeHint || val.length,
          caseNo,
          dataUrl: val
        });
        clone[key] = chunkUri || '';
      } catch (err) {
        console.warn('Cloud chunk offload warning:', err);
        clone[key] = '';
      }
    } else if (val && typeof val === 'object') {
      clone[key] = await offloadLargeDataUrlsToCloudChunks(val, `${contextPrefix}_${key}`, caseNo);
    } else {
      clone[key] = val;
    }
  }
  return clone;
}

// CASES
export function subscribeToCases(
  onData: (cases: Case[]) => void,
  onError?: (err: any) => void,
  options?: { allCompanies?: boolean }
) {
  const path = 'cases';
  let cachedDocs: any[] = [];

  const emit = () => {
    const firestoreList: Case[] = [];
    cachedDocs.forEach((docData) => {
      firestoreList.push({
        ...docData,
        companyId: docData.companyId || 'docks'
      } as Case);
    });

    // Authoritative Firestore Sync:
    // Firestore snapshot is the single source of truth so updates/deletions reflect immediately across all browsers.
    // Only preserve locally cached base64 file content for cases that exist in Firestore if stripped for size limits.
    const localCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
    const localMap = new Map<string, Case>();
    localCases.forEach(c => {
      const k = c.caseNo || c.id;
      if (k) localMap.set(k, c);
    });

    const mergedList: Case[] = firestoreList.map(fc => {
      const k = fc.caseNo || fc.id;
      const existing = k ? localMap.get(k) : undefined;
      if (!existing) return fc;

      const existingHasBase64 = existing.documents?.some((d: any) => d?.url && String(d.url).startsWith('data:'));
      const firestoreHasDataOrChunk = fc.documents?.some((d: any) => d?.url && (String(d.url).startsWith('data:') || String(d.url).startsWith('chunk://')));
      const bestDocs = (!firestoreHasDataOrChunk && existingHasBase64 && (existing.documents?.length || 0) >= (fc.documents?.length || 0))
        ? existing.documents
        : (fc.documents || []);

      return {
        ...fc,
        documents: bestDocs
      };
    });

    const finalCases = dedupeArrayById(mergedList);
    safeAppStorage.setJSON('dpl_live_cases', finalCases);
    backupCasesToIndexedDB(finalCases).catch(() => {});
    
    const active = getActiveCompanyId();
    const emittedCases = options?.allCompanies
      ? finalCases
      : finalCases.filter(c => matchesActiveCompany(c.companyId, active));
    onData(emittedCases);
  };

  const unsubCompany = subscribeToActiveCompany(() => {
    emit();
  });

  const unsubFirestore = onSnapshot(
    collection(db, path),
    (snapshot) => {
      cachedDocs = [];
      snapshot.forEach((docSnap) => {
        cachedDocs.push({ ...docSnap.data(), id: docSnap.id });
      });
      emit();
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
    }
  );

  return () => {
    unsubFirestore();
    unsubCompany();
  };
}

function dispatchCaseLifecycleNotifications(caseItem: Case, prevCase?: Case | null, _isNew?: boolean) {
  try {
    const clientName = (
      caseItem.clientName ||
      caseItem.client ||
      caseItem.importer ||
      (caseItem.extractedData as any)?.cargoOwner ||
      (caseItem.extractedData as any)?.importerName ||
      ''
    ).trim();
    const caseNo = caseItem.caseNo || caseItem.caseNumber || `Case #${caseItem.id}`;
    if (!caseNo) return;

    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const polName = caseItem.pol || (caseItem.extractedData as any)?.pol || 'Port of Loading';
    const podName = caseItem.pod || (caseItem.extractedData as any)?.pod || 'Destination';
    const containerNosStr =
      Array.isArray(caseItem.containers) && caseItem.containers.length > 0
        ? caseItem.containers.map(c => c.number).filter(Boolean).join(', ') || caseItem.containerNumber || 'Container'
        : caseItem.containerNumber || (caseItem.extractedData as any)?.containerNo || 'Container';

    // 1. Case Cancelled -> Informative Notification to Client ONLY
    const isNowCancelled = String(caseItem.status || '').toUpperCase() === 'CANCELLED';
    const wasCancelled = prevCase ? String(prevCase.status || '').toUpperCase() === 'CANCELLED' : false;
    if (isNowCancelled && !wasCancelled && clientName) {
      const cancelKey = `notif_case_cancelled_${caseItem.id || caseNo}`;
      if (!safeAppStorage.getItem(cancelKey)) {
        safeAppStorage.setItem(cancelKey, 'true');
        saveNotificationToFirestore({
          id: Date.now() + Math.floor(Math.random() * 1000) + 1,
          title: `Case Cancelled: ${caseNo}`,
          description: `Your Case ${caseNo} (${clientName}) has been marked as CANCELLED.`,
          details: `Case No: ${caseNo}\nClient: ${clientName}\nStatus: CANCELLED\nRoute: ${polName} → ${podName}`,
          timestamp: nowTimeStr,
          type: 'INFO',
          notificationSubType: 'CASE_CANCELLED_ALERT',
          status: 'PENDING',
          actionLabel: 'View Case Details',
          priority: 'HIGH',
          targetRole: 'CLIENT',
          targetClientName: clientName,
          category: 'CASE',
          targetView: 'cases',
          targetFilter: { caseId: caseItem.id, caseNo }
        }).catch(() => {});
      }
      return;
    }

    if (isNowCancelled) return;

    // Auto-sync Destination Staff Default Per-Container Charges (Internal Company Transaction, silent)
    syncDestinationStaffContainerCharges({ cases: [caseItem] }).catch(() => {});

    // 2. Action-Required Demand ONLY if Client explicitly manages items requiring Client upload
    if (clientName) {
      const clientManagedItems: string[] = [];
      if (caseItem.serviceArrangements && typeof caseItem.serviceArrangements === 'object') {
        Object.entries(caseItem.serviceArrangements).forEach(([key, item]: [string, any]) => {
          if (item && item.arrangedBy === 'Client') {
            clientManagedItems.push(item.label || key.replace(/_/g, ' '));
          }
        });
      }
      if (Array.isArray(caseItem.charges)) {
        caseItem.charges.forEach((ch) => {
          if (ch && ch.description && ch.arrangedBy === 'Client' && !clientManagedItems.includes(ch.description)) {
            clientManagedItems.push(ch.description);
          }
        });
      }
      if (clientManagedItems.length > 0) {
        const demandKey = `notif_client_demand_${caseItem.id || caseNo}_${clientManagedItems.join('|')}`;
        if (!safeAppStorage.getItem(demandKey)) {
          safeAppStorage.setItem(demandKey, 'true');
          saveNotificationToFirestore({
            id: Date.now() + Math.floor(Math.random() * 1000) + 4,
            title: `Action Required: Update Client-Managed Items (${caseNo})`,
            description: `Please provide/update documents for items managed by you in Case ${caseNo}: ${clientManagedItems.join(', ')}.`,
            details: `Case No: ${caseNo}\nClient: ${clientName}\nItems Managed by Client:\n• ${clientManagedItems.join('\n• ')}`,
            timestamp: nowTimeStr,
            type: 'ACTION',
            notificationSubType: 'CLIENT_MANAGED_DEMAND',
            status: 'PENDING',
            actionLabel: 'Update Client Items',
            priority: 'HIGH',
            targetRole: 'CLIENT',
            targetClientName: clientName,
            category: 'CASE',
            targetView: 'cases',
            targetFilter: { caseId: caseItem.id, caseNo }
          }).catch(() => {});
        }
      }
    }

    // 3. LOADING GATE-OUT MILESTONE:
    //    Invoice is generated ONLY when vehicle completes Loading Gate-Out!
    //    Client receives In-Transit + Invoice Generated notification WITHOUT any Driver, Transporter, or Vehicle details (Conflict-of-Interest Shield).
    const isGatedOutNow = hasCaseCompletedLoadingGateOut(caseItem);
    if (isGatedOutNow) {
      const explicitCharges = Array.isArray(caseItem.charges)
        ? caseItem.charges.filter(ch => ch && ch.arrangedBy !== 'Client' && (Number(ch.amount) || 0) > 0)
        : [];
      const totalCharged = explicitCharges.length > 0
        ? explicitCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0)
        : Number(caseItem.totalAmount || (caseItem.extractedData as any)?.totalAmount || 0);

      const gateOutKey = `notif_gateout_inv_${caseItem.caseNo || caseItem.id}`;
      if (!safeAppStorage.getItem(gateOutKey)) {
        safeAppStorage.setItem(gateOutKey, 'true');

        // Auto-ensure Receivable Invoice exists in Finance at Loading Gate-Out
        if (totalCharged > 0) {
          const breakdownStr = explicitCharges.length > 0
            ? explicitCharges.map(c => `${c.description}: PKR ${Number(c.amount).toLocaleString()}`).join(', ')
            : `Case Invoice Total: PKR ${totalCharged.toLocaleString()}`;

          const detInvId = parseNumericDocId(undefined, `GATEOUT_REC_INV_${caseNo}`, 0);
          const recEntry: FinanceEntry & { _silentNotification?: boolean; caseNo?: string } = {
            id: detInvId,
            date: new Date().toISOString().split('T')[0],
            description: `Case Gate-Out Invoice (#${caseNo}) — ${containerNosStr} (${polName} → ${podName})`,
            amount: totalCharged,
            type: 'RECEIVABLE',
            status: 'APPROVED',
            party: clientName || 'Client',
            category: 'Case Freight & Clearance Invoice',
            reference: `INV-${caseNo}`,
            caseNo,
            _silentNotification: true
          };
          saveFinanceToFirestore(recEntry as FinanceEntry).catch(() => {});

          // Finance Manager ONLY (Informative — NOT Admin!)
          saveNotificationToFirestore({
            id: Date.now() + Math.floor(Math.random() * 1000) + 5,
            title: `Gate-Out Invoice Generated (#${caseNo}): PKR ${totalCharged.toLocaleString()}`,
            description: `Vehicle completed Loading Gate-Out from ${polName} (Now In Transit). Receivable Invoice of PKR ${totalCharged.toLocaleString()} generated for ${clientName || 'Client'}.`,
            details: `Case / Invoice No: ${caseNo}\nClient: ${clientName || 'N/A'}\nContainers: ${containerNosStr}\nRoute: ${polName} → ${podName}\nTotal Invoice: PKR ${totalCharged.toLocaleString()}\nBreakdown: ${breakdownStr}`,
            timestamp: nowTimeStr,
            type: 'INFO',
            notificationSubType: 'INVOICE_CHARGE_NOTIFICATION',
            status: 'PENDING',
            actionLabel: 'View Invoice & Ledger',
            priority: 'HIGH',
            targetRole: 'FINANCE_MANAGER',
            category: 'FINANCE',
            targetView: 'finance',
            targetFilter: { caseId: caseItem.id, caseNo }
          }).catch(() => {});
        }

        // Client Notification: Container Loaded, Vehicle Gate-Out Completed, Now In Transit + Invoice Generated
        // STRICT PRIVACY: ZERO vehicleNo, ZERO driverName, ZERO transporterName!
        if (clientName) {
          const invSuffix = totalCharged > 0
            ? ` Official Case Invoice (PKR ${totalCharged.toLocaleString()}) has been generated.`
            : ` Official Case Invoice is now generated in your portal.`;
          saveNotificationToFirestore({
            id: Date.now() + Math.floor(Math.random() * 1000) + 9,
            title: `Container Loaded & In Transit (Invoice Generated): #${caseNo}`,
            description: `Your container (${containerNosStr}) has been loaded and the vehicle has completed port gate-out from ${polName}. Shipment status is now In Transit towards ${podName}.${invSuffix}`,
            details: `Case No: ${caseNo}\nClient: ${clientName}\nContainer(s): ${containerNosStr}\nPort of Loading: ${polName}\nDestination: ${podName}\nCurrent Status: In Transit (Gate-Out Completed)${totalCharged > 0 ? `\nInvoice Amount: PKR ${totalCharged.toLocaleString()}` : ''}`,
            timestamp: nowTimeStr,
            type: 'INFO',
            notificationSubType: 'GATE_OUT_INVOICE',
            status: 'PENDING',
            actionLabel: 'View Case & Invoice',
            priority: 'HIGH',
            targetRole: 'CLIENT',
            targetClientName: clientName,
            category: 'CASE',
            targetView: 'cases',
            targetFilter: { caseId: caseItem.id, caseNo }
          }).catch(() => {});
        }
      }

      // Transporter Freight Invoice -> Transporter & Finance Manager ONLY (NEVER Client!)
      if (Array.isArray(caseItem.containers)) {
        caseItem.containers.forEach((cntr, cIdx) => {
          const tName = (cntr.transporterName || (caseItem as any).transporterName || '').trim();
          const rentAmt = Number(cntr.rentAmount || 0);
          if (tName && rentAmt > 0) {
            const transInvKey = `notif_trans_inv_${caseItem.id}_${cntr.number || cIdx}_${rentAmt}`;
            if (!safeAppStorage.getItem(transInvKey)) {
              safeAppStorage.setItem(transInvKey, 'true');
              saveNotificationToFirestore({
                id: Date.now() + Math.floor(Math.random() * 1000) + 16 + cIdx,
                title: `Freight Invoice Generated (${caseNo}): PKR ${rentAmt.toLocaleString()}`,
                description: `Freight / Vehicle Rent invoice of PKR ${rentAmt.toLocaleString()} generated for Transporter "${tName}" (Container: ${cntr.number || 'N/A'}, Vehicle: ${cntr.vehicleNo || 'Assigned'}).`,
                details: `Case No: ${caseNo}\nTransporter: ${tName}\nContainer No: ${cntr.number || 'N/A'}\nVehicle No: ${cntr.vehicleNo || 'N/A'}\nInvoice Amount: PKR ${rentAmt.toLocaleString()}`,
                timestamp: nowTimeStr,
                type: 'INFO',
                notificationSubType: 'INVOICE_CHARGE_NOTIFICATION',
                status: 'PENDING',
                actionLabel: 'View Freight Invoice',
                priority: 'HIGH',
                targetRole: 'TRANSPORTER,FINANCE_MANAGER',
                targetClientName: tName,
                category: 'TRANSPORTER',
                targetView: 'finance',
                targetFilter: { caseId: caseItem.id, caseNo }
              }).catch(() => {});
            }
          }
        });
      }
    }

    // 4. DESTINATION ARRIVAL MILESTONE:
    //    As soon as Destination Staff marks Vehicle Arrived at Destination:
    //    Notify Client (now revealing Vehicle Number — still NO Driver or Transporter details!), Operations Manager, and Documentation Manager.
    if (hasCaseArrivedAtDestination(caseItem)) {
      const destArrivedKey = `notif_dest_arrived_${caseItem.caseNo || caseItem.id}`;
      if (!safeAppStorage.getItem(destArrivedKey)) {
        safeAppStorage.setItem(destArrivedKey, 'true');
        const vehicleNosStr =
          Array.isArray(caseItem.containers) && caseItem.containers.length > 0
            ? caseItem.containers.map(c => c.vehicleNo).filter(Boolean).join(', ') ||
              caseItem.workflowDetails?.['Vehicle Assignment']?.assignedVehicleNo ||
              'Assigned Vehicle'
            : caseItem.workflowDetails?.['Vehicle Assignment']?.assignedVehicleNo ||
              caseItem.extractedData?.vehicleNumber ||
              'Assigned Vehicle';

        saveNotificationToFirestore({
          id: Date.now() + Math.floor(Math.random() * 1000) + 33,
          title: `Vehicle Arrived at Destination: #${caseNo} (${vehicleNosStr})`,
          description: `Vehicle ${vehicleNosStr} carrying Container ${containerNosStr} for Case #${caseNo} has arrived at destination (${podName}).`,
          details: `Case No: ${caseNo}\nClient: ${clientName || 'N/A'}\nContainer(s): ${containerNosStr}\nArrived Vehicle No: ${vehicleNosStr}\nDestination: ${podName}\nStatus: Arrived at Destination`,
          timestamp: nowTimeStr,
          type: 'INFO',
          notificationSubType: 'DESTINATION_ARRIVAL',
          status: 'PENDING',
          actionLabel: 'View Shipment Details',
          priority: 'HIGH',
          targetRole: clientName
            ? 'CLIENT,OPERATIONS_MANAGER,DOCUMENTATION_MANAGER'
            : 'OPERATIONS_MANAGER,DOCUMENTATION_MANAGER',
          targetClientName: clientName || undefined,
          category: 'CASE',
          targetView: 'cases',
          targetFilter: { caseId: caseItem.id, caseNo }
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('Case lifecycle notification dispatch notice:', err);
  }
}

const CASE_MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

export function recordLocalReservedCaseSerial(caseNo?: string): void {
  const parsed = parseCaseNoParts(caseNo);
  if (!parsed || !parsed.serial) return;
  const storageKey = `dpl_last_reserved_serial_${parsed.prefix}_${parsed.year2Digit}`;
  const prev = parseInt(safeAppStorage.getItem(storageKey) || '0', 10) || 0;
  if (parsed.serial > prev) {
    safeAppStorage.setItem(storageKey, String(parsed.serial));
  }
}

/**
 * Atomically reserves the next strictly unique sequential Case Number via Firestore transaction
 * across ALL destinations (LHR, ISB, PEW, KHI, etc.), ALL months, and ALL concurrent users/tabs.
 * Checks:
 *  1. Firestore `cases` collection (true cloud max serial for `[PREFIX]` + `[YY]`)
 *  2. Local live cases + same-device reserved serial cache
 *  3. Atomic counter document `settings/case_counter_[PREFIX]_[YY]` inside `runTransaction`
 */
export async function reserveNextSequentialCaseNumber(params: {
  destination?: string;
  targetDate?: Date;
  customPrefix?: string;
  localCases?: Array<{ caseNo?: string; createdAt?: string; date?: string }>;
}): Promise<string> {
  const targetDate = params.targetDate || new Date();
  const prefix = (params.customPrefix || getActiveCompanyPrefix() || 'DPL').toUpperCase().trim();
  const destCode = getDestinationCode(params.destination);
  const yy = String(targetDate.getFullYear()).slice(-2);
  const mmm = CASE_MONTH_NAMES[targetDate.getMonth()];
  const storageKey = `dpl_last_reserved_serial_${prefix}_${yy}`;

  // 1. Gather local baseline (UI state + persisted live cache + last locally reserved serial)
  const storedLiveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
  const combinedLocalCases = [
    ...(Array.isArray(params.localCases) ? params.localCases : []),
    ...(Array.isArray(storedLiveCases) ? storedLiveCases : [])
  ];
  const localCasesMax = getMaxCaseSerialForYear(combinedLocalCases, yy, prefix);
  const localReservedMax = parseInt(safeAppStorage.getItem(storageKey) || '0', 10) || 0;
  let baselineMax = Math.max(localCasesMax, localReservedMax);

  // 2. Scan authoritative Firestore `cases` collection (all companies/clients/destinations)
  let cloudCasesMax = 0;
  try {
    const snap = await Promise.race([
      getDocs(collection(db, 'cases')),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
    ]);
    if (snap && 'forEach' in snap) {
      const cloudCases: Array<{ caseNo?: string; createdAt?: string; date?: string }> = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        if (data?.caseNo) {
          cloudCases.push({
            caseNo: data.caseNo,
            createdAt: data.createdAt,
            date: data.date
          });
        }
      });
      cloudCasesMax = getMaxCaseSerialForYear(cloudCases, yy, prefix);
      if (cloudCasesMax > baselineMax) {
        baselineMax = cloudCasesMax;
      }
    }
  } catch (err) {
    console.warn('Cloud max serial lookup notice:', err);
  }

  // 3. Atomic Firestore Transaction on settings/case_counter_[PREFIX]_[YY]
  const counterDocId = `case_counter_${prefix}_${yy}`;
  const counterRef = doc(db, 'settings', counterDocId);
  try {
    const reserved = await Promise.race([
      runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const storedLast = counterSnap.exists() ? Number(counterSnap.data()?.lastSerial || 0) : 0;
        const safeStoredLast = Number.isFinite(storedLast) ? storedLast : 0;
        const currentHighest = Math.max(safeStoredLast, baselineMax);
        const nextSerial = currentHighest + 1;
        const finalCaseNo = buildCaseNo({
          prefix,
          destCode,
          year2Digit: yy,
          month3Letter: mmm,
          serial: nextSerial
        });
        tx.set(
          counterRef,
          {
            prefix,
            year: yy,
            lastSerial: nextSerial,
            lastCaseNo: finalCaseNo,
            updatedAt: new Date().toISOString()
          },
          { merge: true }
        );
        return { nextSerial, finalCaseNo };
      }),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 6500))
    ]);

    if (reserved && reserved.finalCaseNo) {
      safeAppStorage.setItem(storageKey, String(reserved.nextSerial));
      return reserved.finalCaseNo;
    }
  } catch (txErr) {
    console.warn('Atomic case counter transaction fallback:', txErr);
  }

  // 4. Offline / Timeout Safe Fallback (still monotonic on device via storageKey)
  const latestLocalReserved = parseInt(safeAppStorage.getItem(storageKey) || '0', 10) || 0;
  const fallbackSerial = Math.max(baselineMax, cloudCasesMax, latestLocalReserved) + 1;
  safeAppStorage.setItem(storageKey, String(fallbackSerial));
  return buildCaseNo({
    prefix,
    destCode,
    year2Digit: yy,
    month3Letter: mmm,
    serial: fallbackSerial
  });
}

export async function saveCaseToFirestore(newCase: Case): Promise<void> {
  const path = 'cases';
  const docId = newCase.id || String(Date.now());
  const activeCompany = getActiveCompanyId();
  recordLocalReservedCaseSerial(newCase.caseNo);

  // 1. Persist full attachments into IndexedDB immediately
  if (newCase.documents && Array.isArray(newCase.documents)) {
    for (const d of newCase.documents as any[]) {
      if (d) {
        const dataUrl = (d.url && d.url.startsWith('data:')) ? d.url : (d.dataUrl || '');
        if (dataUrl) {
          saveDocumentToIndexedDB({
            key: `${newCase.caseNo}_${d.name}`,
            id: d.id,
            name: d.name,
            type: d.type || 'application/pdf',
            size: d.size || 0,
            dataUrl,
            caseNo: newCase.caseNo
          }).catch(() => {});
        }
      }
    }
  }

  // 2. Backup full case in IndexedDB & local storage
  backupCasesToIndexedDB([newCase]).catch(() => {});

  // 3. Offload >140KB PDFs/scans to Firestore document_chunks, then write case payload
  try {
    const cloudReadyCase = await offloadLargeDataUrlsToCloudChunks(
      {
        ...newCase,
        companyId: newCase.companyId || activeCompany,
        id: docId,
        createdBy: auth.currentUser?.uid || 'guest',
        updatedAt: new Date().toISOString()
      },
      `case_${newCase.caseNo || docId}`,
      newCase.caseNo
    );
    const payload = sanitizeForFirestore(cloudReadyCase);
    await setDoc(doc(db, path, docId), payload);
    const savedCaseObj = { ...newCase, id: docId };
    dispatchCaseLifecycleNotifications(savedCaseObj, null, true);
    recordVehicleTripFromCase(savedCaseObj).catch(() => {});
    syncFranchiseContainerCharges({ cases: [savedCaseObj] }).catch(() => {});
  } catch (error) {
    console.warn(`Firestore saveCase warning for ${docId}:`, error);
  }
}

export async function updateCaseInFirestore(caseItem: Case): Promise<void> {
  const path = 'cases';
  const docId = caseItem.id;
  const activeCompany = getActiveCompanyId();
  let prevCase: Case | null = null;
  try {
    const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
    prevCase = liveCases.find(c => String(c.id) === String(docId)) || null;
  } catch (_) {}

  try {
    if (caseItem.documents && Array.isArray(caseItem.documents)) {
      for (const d of caseItem.documents as any[]) {
        if (d?.url && String(d.url).startsWith('data:')) {
          saveDocumentToIndexedDB({
            key: `${caseItem.caseNo}_${d.name}`,
            id: d.id,
            name: d.name,
            type: d.type || 'application/pdf',
            size: d.size || 0,
            dataUrl: d.url,
            caseNo: caseItem.caseNo
          }).catch(() => {});
        }
      }
    }
    const cloudReadyCase = await offloadLargeDataUrlsToCloudChunks(
      {
        ...caseItem,
        companyId: caseItem.companyId || activeCompany,
        updatedAt: new Date().toISOString()
      },
      `case_${caseItem.caseNo || docId}`,
      caseItem.caseNo
    );
    const payload = sanitizeForFirestore(cloudReadyCase);
    await setDoc(doc(db, path, docId), payload, { merge: true });
    const mergedCase = prevCase ? { ...prevCase, ...caseItem } : caseItem;
    dispatchCaseLifecycleNotifications(mergedCase, prevCase, false);
    recordVehicleTripFromCase(mergedCase).catch(() => {});
    syncFranchiseContainerCharges({ cases: [mergedCase] }).catch(() => {});
  } catch (error) {
    console.warn(`Firestore updateCase warning for ${docId}:`, error);
  }
}

export async function deleteCaseFromFirestore(caseId: string): Promise<void> {
  const path = 'cases';
  try {
    await deleteDoc(doc(db, path, caseId));
  } catch (error) {
    console.warn(`Firestore deleteCase warning for ${caseId}:`, error);
  }
}

// FINANCES
export function isDefaultOrPlaceholderSystemAccount(u: {
  id?: number | string;
  userId?: string;
  name?: string;
  role?: UserRole | string;
}): boolean {
  const numId = Number(u.id);
  const idLower = String(u.userId || '').trim().toLowerCase();
  const nameLower = String(u.name || '').trim().toLowerCase();

  const defaultUserIds = new Set([
    'arbabkhanboby',
    'admin',
    'finance',
    'casemanager',
    'vehiclemanager',
    'officestaff',
    'transporter',
    'client',
    'vendor',
    'client01',
    'loadingstaff',
    'destinationstaff',
    'unloadingstaff',
    'admin_docks',
    'ops_fleet',
    'fin_fleet'
  ]);

  const defaultPlaceholderNames = new Set([
    'arbab khan boby (system administrator)',
    'system administrator',
    'finance manager',
    'operations manager',
    'vehicles manager',
    'office staff',
    'transporter portal',
    'client portal',
    'vendor portal',
    'loading port staff',
    'destination port staff',
    'unloading port staff',
    'docks company admin',
    'operations & fleet coordinator',
    'finance & transport billing'
  ]);

  return (
    (!isNaN(numId) && numId >= 1 && numId <= 15) ||
    defaultUserIds.has(idLower) ||
    defaultPlaceholderNames.has(nameLower) ||
    nameLower.includes('system administrator')
  );
}

// Business Rule: Current month (Nov 2026) is Invoices & Case Registrations ONLY.
// All Payables and Office Staff Salaries start generating from Next Month 1st (2026-12-01).
export const PAYABLES_EFFECTIVE_START_DATE = '2026-12-01';

export function isAutoGeneratedPlaceholderSalary(data: any): boolean {
  if (!data) return false;
  const partyLower = String(data.party || '').trim().toLowerCase();
  const descLower = String(data.description || '').trim().toLowerCase();
  const refStr = String(data.reference || '').trim();
  const isSalaryEntry =
    data.category === 'Staff Payroll & Salaries' ||
    data.category === 'Payroll / Salary' ||
    refStr.startsWith('SAL-') ||
    descLower.includes('monthly salary');

  if (!isSalaryEntry) return false;

  const placeholderParties = [
    'system administrator',
    'arbab khan boby',
    'finance manager',
    'operations manager',
    'vehicles manager',
    'office staff',
    'loading port staff',
    'destination port staff',
    'unloading port staff',
    'docks company admin',
    'operations & fleet coordinator',
    'finance & transport billing',
    'transporter portal',
    'client portal',
    'vendor portal'
  ];

  if (
    placeholderParties.some(
      (p) =>
        partyLower === p ||
        partyLower.includes('system administrator') ||
        descLower.includes('system administrator')
    )
  ) {
    return true;
  }

  // Legacy User-Management auto-generated salaries had numeric/timestamp IDs instead of `sal_staff_`
  // e.g. SAL-2026-11-1793690689207 or "[Gross: PKR ...]" in description
  if (refStr.startsWith('SAL-') && !/^SAL-\d{4}-\d{2}-sal_staff_/i.test(refStr)) {
    return true;
  }
  if (/\[gross:\s*pkr/i.test(descLower)) {
    return true;
  }

  return false;
}

export function isPreStartOrLegacyPayable(data: any): boolean {
  if (!data) return false;
  if (isAutoGeneratedPlaceholderSalary(data)) return true;

  if (data.type === 'PAYABLE') {
    const rawDate = String(data.date || data.createdAt || '').trim().slice(0, 10);
    if (!rawDate || rawDate < PAYABLES_EFFECTIVE_START_DATE) {
      return true;
    }
  }

  return false;
}

export function subscribeToFinances(
  onData: (items: FinanceEntry[]) => void,
  onError?: (err: any) => void,
  options?: { allCompanies?: boolean }
) {
  const path = 'finances';
  let cachedDocs: any[] = [];
  let hasReceivedSnapshot = false;

  // Stale-While-Revalidate: Immediately emit locally cached finance entries before network responds
  try {
    const localFinances = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []);
    if (localFinances && localFinances.length > 0) {
      const active = getActiveCompanyId();
      const cleanedLocal = localFinances.filter((f) => !isPreStartOrLegacyPayable(f));
      if (cleanedLocal.length !== localFinances.length) {
        safeAppStorage.setJSON('dpl_live_finance', cleanedLocal);
        safeAppStorage.setJSON(
          'dpl_live_payables',
          cleanedLocal.filter((f) => f.type === 'PAYABLE' && matchesActiveCompany(f.companyId, active))
        );
      }
      const filtered = options?.allCompanies
        ? cleanedLocal
        : cleanedLocal.filter((f) => matchesActiveCompany(f.companyId, active));
      onData(dedupeArrayById(filtered));
    } else {
      safeAppStorage.setJSON('dpl_live_payables', []);
    }
  } catch (_) {}

  const emit = () => {
    const active = getActiveCompanyId();
    const allItems: FinanceEntry[] = [];
    const items: FinanceEntry[] = [];
    let idx = 0;
    cachedDocs.forEach((data) => {
      const numId = parseNumericDocId(data.id, data._docId || String(idx), idx++);
      const entry = { ...data, id: numId } as FinanceEntry;
      allItems.push(entry);
      if (!options?.allCompanies && !matchesActiveCompany(data.companyId, active)) return;
      items.push(entry);
    });
    const dedupedAll = dedupeArrayById(allItems);
    const dedupedActive = dedupeArrayById(items);
    if (hasReceivedSnapshot) {
      safeAppStorage.setJSON('dpl_live_finance', dedupedAll);
      safeAppStorage.setJSON(
        'dpl_live_payables',
        dedupedActive.filter((i) => i.type === 'PAYABLE')
      );
      safeAppStorage.setJSON(
        'dpl_live_receivables',
        dedupedActive.filter((i) => i.type === 'RECEIVABLE')
      );
    }
    onData(dedupedActive);
  };

  const unsubCompany = subscribeToActiveCompany(() => {
    emit();
  });

  const unsubFirestore = onSnapshot(
    collection(db, path),
    (snapshot) => {
      hasReceivedSnapshot = true;
      cachedDocs = [];
      const seenRecurringOrSalaryKeys = new Map<string, { docId: string; status?: string; data: any }>();

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();

        // 1. Purge legacy auto-salaries and any PAYABLE entries prior to Next Month 1st (2026-12-01)
        if (isPreStartOrLegacyPayable(data)) {
          deleteDoc(doc(db, path, docSnap.id)).catch(() => {});
          return;
        }

        // 2. Deduplicate auto-generated SAL- / REC- / Payroll & Salaries / recurringTemplateId entries
        const refStr = String(data.reference || '').trim();
        const isAutoSalaryOrRecurring =
          refStr.startsWith('SAL-') ||
          refStr.startsWith('REC-') ||
          data.category === 'Payroll / Salary' ||
          data.category === 'Staff Payroll & Salaries' ||
          data.recurringTemplateId !== undefined;

        if (isAutoSalaryOrRecurring && (data.type === 'PAYABLE' || data.type === 'RECEIVABLE')) {
          const compKey = String(data.companyId || 'docks').toLowerCase();
          const partyKey = String(data.party || '').trim().toLowerCase();
          const dateKey = String(data.date || '').slice(0, 7); // YYYY-MM
          const dedupeKey = refStr
            ? `${compKey}__ref__${refStr}`
            : `${compKey}__${data.category || ''}__${partyKey}__${dateKey}`;

          const existing = seenRecurringOrSalaryKeys.get(dedupeKey);
          if (existing) {
            // Keep whichever one is PAID; otherwise keep the first one and delete the duplicate from Firestore
            if (data.status === 'PAID' && existing.status !== 'PAID') {
              deleteDoc(doc(db, path, existing.docId)).catch(() => {});
              cachedDocs = cachedDocs.filter((d) => d._docId !== existing.docId);
              seenRecurringOrSalaryKeys.set(dedupeKey, { docId: docSnap.id, status: data.status, data });
              cachedDocs.push({ ...data, _docId: docSnap.id });
            } else {
              deleteDoc(doc(db, path, docSnap.id)).catch(() => {});
            }
            return;
          } else {
            seenRecurringOrSalaryKeys.set(dedupeKey, { docId: docSnap.id, status: data.status, data });
          }
        }

        cachedDocs.push({ ...data, _docId: docSnap.id });
      });
      emit();
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
    }
  );

  return () => {
    unsubFirestore();
    unsubCompany();
  };
}

export async function saveFinanceToFirestore(entry: FinanceEntry): Promise<void> {
  const path = 'finances';
  const docId = String(entry.id || Date.now());
  const activeCompany = getActiveCompanyId();
  try {
    // Monthly recurring fixed overheads and staff payroll are auto-approved upon entry
    const isMonthlyOrRecurring = 
      entry.category === 'Payroll / Salary' ||
      entry.category === 'Staff Payroll & Salaries' ||
      entry.recurringTemplateId !== undefined ||
      Boolean((entry as any).isRecurring) ||
      entry.reference?.startsWith('SAL-') ||
      entry.reference?.startsWith('REC-') ||
      entry.description?.toLowerCase().includes('monthly salary') ||
      entry.description?.toLowerCase().includes('monthly office staff salary') ||
      entry.description?.toLowerCase().includes('fixed expense') ||
      entry.description?.toLowerCase().includes('monthly overhead');

    const entryToSave: FinanceEntry = {
      ...entry,
      status: (isMonthlyOrRecurring && entry.status === 'PENDING') ? 'APPROVED' : entry.status
    };

    const payload = sanitizeForFirestore({
      ...entryToSave,
      companyId: entry.companyId || activeCompany,
      id: Number(docId),
      createdBy: auth.currentUser?.uid || 'guest',
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload);

    // Notify Finance Manager, Admin, and Client according to strict role-specific notification rules
    if (entryToSave.amount && Number(entryToSave.amount) > 0 && !(entry as any)._silentNotification) {
      const notifId = Date.now() + Math.floor(Math.random() * 1000);

      const isClientDepositUpload = 
        Boolean(entryToSave.slipUrl) || 
        (entryToSave.type === 'INCOME' && entryToSave.status === 'PENDING' && entryToSave.party && entryToSave.party !== 'DPL');

      let notif: AppNotification;

      if (isMonthlyOrRecurring) {
        // Automatic monthly payable entries -> Finance Manager ONLY (Informative)
        notif = {
          id: notifId,
          title: `Monthly Auto-Payable Recorded: PKR ${Number(entryToSave.amount).toLocaleString()}`,
          description: `${entryToSave.description || 'Monthly Fixed Payable'} for ${entryToSave.party || 'Account'} has been automatically recorded in Finance Payables.`,
          details: `${entryToSave.category || 'Finance'} • Reference: ${entryToSave.reference || 'N/A'} • Status: AUTO-RECORDED`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'INFO',
          notificationSubType: 'INVOICE_CHARGE_NOTIFICATION',
          status: 'PENDING',
          actionLabel: 'View in Finance',
          targetRole: UserRole.FINANCE_MANAGER,
          targetView: 'finance',
          category: 'FINANCE'
        };
      } else if (isClientDepositUpload) {
        // Client uploaded payment screenshot -> Action-Required notification to Finance Manager ONLY (Admin receives informative alert ONLY after Finance Manager approves!)
        notif = {
          id: notifId,
          title: `Payment Verification Required: PKR ${Number(entry.amount).toLocaleString()}`,
          description: `Client "${entry.party || 'Client'}" uploaded a payment screenshot (${entry.category || 'Payment'}). Finance Manager verification & approval required.`,
          details: `Client / Party: ${entry.party} • Bank: ${entry.bankName || 'Direct'} • Ref: ${entry.reference || 'N/A'} • Amount: PKR ${Number(entry.amount).toLocaleString()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'ACTION',
          notificationSubType: 'PAYMENT_APPROVAL',
          status: 'PENDING',
          actionLabel: 'Verify & Approve Payment',
          targetRole: UserRole.FINANCE_MANAGER,
          targetView: 'finance',
          category: 'FINANCE',
          approvalData: {
            entityType: 'finance',
            entityId: entry.id,
            entityName: entry.party || 'Client Payment',
            actionType: 'VERIFY_PAYMENT',
            requestedBy: entry.party || 'Client',
            amount: Number(entry.amount),
            slipUrl: entry.slipUrl,
            bankName: entry.bankName,
            caseNo: (entry as any).caseNo
          }
        };
      } else if (entryToSave.type === 'PAYABLE') {
        const catLower = (entry.category || '').toLowerCase();
        const descLower = (entry.description || '').toLowerCase();
        const isTransporterInvoice =
          catLower.includes('vehicle rent') ||
          catLower.includes('freight') ||
          catLower.includes('transporter') ||
          (entry as any).paymentCategory === 'VEHICLE_RENT' ||
          Boolean((entry as any).targetTransporter) ||
          descLower.includes('vehicle rent') ||
          descLower.includes('freight') ||
          descLower.includes('transporter');
        const transporterTarget = (entry as any).targetTransporter || entry.party || 'Transporter';

        // Payable entry -> Finance Manager (& Transporter if freight) ONLY (Informative — NOT Admin)
        notif = {
          id: notifId,
          title: isTransporterInvoice
            ? `Freight Payable Recorded: PKR ${Number(entry.amount).toLocaleString()}`
            : `Payable Recorded: PKR ${Number(entry.amount).toLocaleString()}`,
          description: isTransporterInvoice
            ? `Freight / Vehicle Rent payable of PKR ${Number(entry.amount).toLocaleString()} recorded for Transporter "${transporterTarget}".`
            : `Payable recorded for "${entry.party || 'Vendor'}": ${entry.description || entry.category || 'Payable'}.`,
          details: `Party: ${transporterTarget}\nCategory: ${entry.category || 'Payable'}\nReference: ${entry.reference || 'N/A'}\nAmount: PKR ${Number(entry.amount).toLocaleString()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'INFO',
          notificationSubType: 'INVOICE_CHARGE_NOTIFICATION',
          status: 'PENDING',
          actionLabel: isTransporterInvoice ? 'View Freight Invoice' : 'View Payable Invoice',
          targetRole: isTransporterInvoice ? `${UserRole.FINANCE_MANAGER},${UserRole.TRANSPORTER}` : UserRole.FINANCE_MANAGER,
          targetClientName: isTransporterInvoice ? transporterTarget : undefined,
          targetView: 'finance',
          category: isTransporterInvoice ? 'TRANSPORTER' : 'FINANCE'
        };
      } else if (entryToSave.type === 'RECEIVABLE') {
        // Manual Receivable invoice -> Finance Manager & specific Client (NOT Admin)
        const clientParty = entry.party || 'Client';
        notif = {
          id: notifId,
          title: `Receivable Invoice Recorded: PKR ${Number(entry.amount).toLocaleString()}`,
          description: `Invoice / ledger charge of PKR ${Number(entry.amount).toLocaleString()} generated for ${clientParty}: ${entry.description || entry.category || 'Invoice Charge'}.`,
          details: `Client: ${clientParty}\nDescription: ${entry.description || entry.category || 'Receivable Invoice'}\nReference: ${entry.reference || 'N/A'}\nAmount Charged: PKR ${Number(entry.amount).toLocaleString()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'INFO',
          notificationSubType: 'INVOICE_CHARGE_NOTIFICATION',
          status: 'PENDING',
          actionLabel: 'View Invoice & Ledger',
          targetRole: `${UserRole.FINANCE_MANAGER},${UserRole.CLIENT}`,
          targetClientName: clientParty,
          targetView: 'finance',
          category: 'FINANCE'
        };
      } else {
        // EXPENSE (Expense Paid) or direct confirmed INCOME (Payment Received) -> Informative notification to Admin & Finance Manager
        const isPaidOut = entryToSave.type === 'EXPENSE';
        const label = isPaidOut ? 'Expense Paid' : 'Payment Received';
        notif = {
          id: notifId,
          title: `${label}: PKR ${Number(entry.amount).toLocaleString()}`,
          description: `${label} (${entry.party || 'Account'}): ${entry.description || entry.category || 'Transaction'}. Method: ${entry.paymentMethod || 'BANK'}`,
          details: `Type: ${label}\nParty: ${entry.party || 'Account'}\nCategory: ${entry.category || 'Finance'}\nReference: ${entry.reference || 'N/A'}\nPayment Method: ${entry.paymentMethod || 'BANK'}${entry.bankName ? ` (${entry.bankName})` : ''}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'INFO',
          notificationSubType: 'FINANCE_RECORDED',
          status: 'PENDING',
          actionLabel: 'View Cashbook',
          targetRole: `ADMIN,FINANCE_MANAGER${!isPaidOut && entry.party ? ',CLIENT' : ''}`,
          targetClientName: !isPaidOut && entry.party ? entry.party : undefined,
          targetView: 'finance',
          category: 'FINANCE'
        };

        // Transporter Rule: Payment received from client or company confirmation request
        const catLower = (entry.category || '').toLowerCase();
        const descLower = (entry.description || '').toLowerCase();
        const isTransporterPayment =
          catLower.includes('vehicle rent') ||
          catLower.includes('freight') ||
          catLower.includes('transporter') ||
          (entry as any).paymentCategory === 'VEHICLE_RENT' ||
          Boolean((entry as any).targetTransporter) ||
          Boolean((entry as any).isTransporterPayment) ||
          descLower.includes('vehicle rent') ||
          descLower.includes('freight') ||
          descLower.includes('transporter');

        if (isTransporterPayment && !(entry as any).transporterConfirmed) {
          const transporterTarget = (entry as any).targetTransporter || entry.party || 'Transporter';
          const payerSource = (entry as any).paidBy || (entryToSave.type === 'EXPENSE' ? 'Company (DPL)' : 'Client');
          saveNotificationToFirestore({
            id: notifId + 5,
            title: `Payment Received Confirmation Request: PKR ${Number(entry.amount).toLocaleString()}`,
            description: `Payment of PKR ${Number(entry.amount).toLocaleString()} sent from ${payerSource} for ${entry.description || entry.category || 'Vehicle Freight'}. Please confirm payment received.`,
            details: `Transporter: ${transporterTarget}\nPaid By: ${payerSource}\nAmount: PKR ${Number(entry.amount).toLocaleString()}\nMethod: ${entry.paymentMethod || 'BANK'}${entry.bankName ? ` (${entry.bankName})` : ''}\nReference: ${entry.reference || 'N/A'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'ACTION',
            notificationSubType: 'TRANSPORTER_PAYMENT_CONFIRMATION',
            status: 'PENDING',
            actionLabel: 'Confirm Payment Received',
            priority: 'HIGH',
            targetRole: UserRole.TRANSPORTER,
            targetClientName: transporterTarget,
            targetView: 'finance',
            category: 'TRANSPORTER',
            approvalData: {
              entityType: 'finance',
              entityId: entry.id,
              entityName: transporterTarget,
              actionType: 'CONFIRM_TRANSPORTER_PAYMENT',
              requestedBy: payerSource,
              amount: Number(entry.amount),
              bankName: entry.bankName,
              caseNo: (entry as any).caseNo
            }
          }).catch(() => {});
        }
      }

      saveNotificationToFirestore(notif).catch(() => {});
      logActivity(
        notif.title, 
        notif.description, 
        'FINANCE_MANAGER', 
        entry.party || 'Finance Desk', 
        { amount: entry.amount, type: entry.type }
      ).catch(() => {});
    }
  } catch (error) {
    console.warn(`Firestore saveFinance warning:`, error);
  }
}

export async function updateFinanceInFirestore(entry: FinanceEntry): Promise<void> {
  const path = 'finances';
  const docId = String(entry.id);
  const activeCompany = getActiveCompanyId();
  try {
    const payload = sanitizeForFirestore({ 
      ...entry, 
      companyId: entry.companyId || activeCompany,
      updatedAt: new Date().toISOString() 
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
  } catch (error) {
    console.warn(`Firestore updateFinance warning:`, error);
  }
}

export async function deleteFinanceFromFirestore(financeId: number | string): Promise<void> {
  const path = 'finances';
  try {
    await deleteDoc(doc(db, path, String(financeId)));
  } catch (error) {
    console.warn(`Firestore deleteFinance warning:`, error);
  }
}

let isAutoPostingMonthly = false;

/**
 * Software login users in User Management do not carry payroll salaries.
 * Monthly office staff salaries are managed exclusively in Finance Management -> Staff Ledger (`salary_staff`)
 * and post automatically after 12:00 AM midnight following the last day of each month.
 */
export async function syncMonthlyStaffSalariesToPayables(
  _staffUsers?: AppUser[],
  existingPayables?: FinanceEntry[]
): Promise<FinanceEntry[]> {
  return syncCompletedMonthSalaryStaffToPayables({ existingPayables });
}

/**
 * Posts recurring monthly fixed expenses and completed-month Finance salary staff payables
 * using deterministic IDs so duplicate payables can never be generated.
 */
export async function autoPostMonthlyRecurringAndSalaries(
  recurringTemplates?: RecurringFinanceTemplate[],
  _staffUsers?: AppUser[],
  existingPayables?: FinanceEntry[],
  existingReceivables?: FinanceEntry[]
): Promise<{ addedPayables: FinanceEntry[]; addedReceivables: FinanceEntry[] }> {
  if (isAutoPostingMonthly) {
    return { addedPayables: [], addedReceivables: [] };
  }
  isAutoPostingMonthly = true;

  try {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const firstOfMonthDate = `${currentMonthStr}-01`;
    const activeCompany = getActiveCompanyId();

    const storedPayables = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []) || [];
    const storedReceivables = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_receivables', []) || [];
    const storedFinances = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []) || [];

    const currentPayables = dedupeArrayById([
      ...(existingPayables || []),
      ...storedPayables,
      ...storedFinances.filter((f) => f && f.type === 'PAYABLE')
    ]);

    const currentReceivables = dedupeArrayById([
      ...(existingReceivables || []),
      ...storedReceivables,
      ...storedFinances.filter((f) => f && f.type === 'RECEIVABLE')
    ]);

    const addedPayables: FinanceEntry[] = [];
    const addedReceivables: FinanceEntry[] = [];

    // 1. Process Recurring Fixed Expense Templates (Only if explicitly created by user)
    const templatesToProcess =
      recurringTemplates && recurringTemplates.length > 0 ? recurringTemplates : [];

    for (const tpl of templatesToProcess) {
      const isTplActive =
        tpl.isActive !== undefined ? tpl.isActive : tpl.active !== undefined ? tpl.active : true;
      if (!isTplActive) continue;

      const recRef = `REC-${currentMonthStr}-${tpl.id}`;
      const deterministicRecId = parseNumericDocId(undefined, `${activeCompany}_${recRef}`, 0);
      const isPayable = (tpl.type || 'PAYABLE') === 'PAYABLE';
      if (isPayable && firstOfMonthDate < PAYABLES_EFFECTIVE_START_DATE) {
        continue;
      }
      const targetList = isPayable ? currentPayables : currentReceivables;
      const pendingAdded = isPayable ? addedPayables : addedReceivables;

      const alreadyExists =
        targetList.some(
          (item) =>
            Number(item.id) === deterministicRecId ||
            item.reference === recRef ||
            (item.recurringTemplateId === tpl.id && String(item.date || '').slice(0, 7) === currentMonthStr)
        ) ||
        pendingAdded.some(
          (item) => Number(item.id) === deterministicRecId || item.reference === recRef
        );

      if (!alreadyExists) {
        const recEntry: FinanceEntry = {
          id: deterministicRecId,
          companyId: activeCompany,
          date: firstOfMonthDate,
          description: `${tpl.title} (${tpl.category || 'Fixed Expense'})`,
          party: tpl.party || 'Vendor / Utility',
          amount: Number(tpl.amount) || 0,
          type: isPayable ? 'PAYABLE' : 'RECEIVABLE',
          status: 'APPROVED',
          category: tpl.category || 'Monthly Overhead',
          reference: recRef,
          recurringTemplateId: tpl.id,
          paymentMethod: 'BANK',
          bankName: 'HBL Corporate'
        };

        try {
          await saveFinanceToFirestore(recEntry);
        } catch (err) {
          console.warn(`Could not save auto recurring entry ${recRef} to Firestore:`, err);
        }

        if (isPayable) {
          addedPayables.push(recEntry);
        } else {
          addedReceivables.push(recEntry);
        }
      }
    }

    if (addedPayables.length > 0) {
      const updatedPay = dedupeArrayById([...addedPayables, ...currentPayables]);
      safeAppStorage.setJSON('dpl_live_payables', updatedPay);
    }

    if (addedReceivables.length > 0) {
      const updatedRec = dedupeArrayById([...addedReceivables, ...currentReceivables]);
      safeAppStorage.setJSON('dpl_live_receivables', updatedRec);
    }

    // 2. Also ensure any completed calendar month salaries (post-midnight after month end) are synced
    isAutoPostingMonthly = false;
    const salaryPayables = await syncCompletedMonthSalaryStaffToPayables({
      existingPayables: [...currentPayables, ...addedPayables]
    });
    if (salaryPayables.length > 0) {
      addedPayables.push(...salaryPayables);
    }

    return { addedPayables, addedReceivables };
  } finally {
    isAutoPostingMonthly = false;
  }
}

// VEHICLES
let isSyncingMissingLocalVehicles = false;

export function subscribeToVehicles(
  onData: (items: Vehicle[]) => void,
  onError?: (err: any) => void
) {
  const path = 'vehicles';
  let cachedDocs: any[] = [];
  let hasReceivedSnapshot = false;

  // Stale-While-Revalidate: Immediately emit locally cached vehicles before Firestore responds
  try {
    const localCached = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
    if (localCached && localCached.length > 0) {
      const { merged } = dedupeAndMergeVehicles(dedupeArrayById(localCached));
      onData(merged);
    }
  } catch (_) {}

  const emit = () => {
    const firestoreItems: Vehicle[] = [];
    let idx = 0;
    cachedDocs.forEach((data) => {
      // NOTE: Vehicles are universally shared across all 4 subsidiaries (Docks, Truckit, Muhib, Vantage)
      const numId = parseNumericDocId(data.id, data._docId || String(idx), idx++);
      const syncedBroker = data.transporterName || data.brokerName || '';
      firestoreItems.push({
        ...data,
        id: numId,
        transporterName: syncedBroker,
        brokerName: syncedBroker
      } as Vehicle);
    });

    // Deduplicate & merge global vehicles by registrationNumber + Chassis/Engine (moving Docks duplicates to Truckit)
    const { merged: finalVehicles, removedIds, updatedRecords } = dedupeAndMergeVehicles(dedupeArrayById(firestoreItems));

    // Clean up duplicate Docks vehicle doc IDs and persist enriched Truckit records in Firestore
    if (hasReceivedSnapshot && (removedIds.length > 0 || updatedRecords.length > 0)) {
      updatedRecords.forEach((upVeh) => {
        const cleanCopy: Record<string, any> = { ...(upVeh as any) };
        const targetDocId = String(cleanCopy._docId || cleanCopy.id || '');
        delete cleanCopy._docId;
        if (targetDocId) {
          const payload = sanitizeForFirestore({
            ...cleanCopy,
            companyId: cleanCopy.companyId || cleanCopy.operatingCompany || 'truckit',
            updatedAt: new Date().toISOString()
          });
          setDoc(doc(db, path, targetDocId), payload, { merge: true }).catch(() => {});
        }
      });
      removedIds.forEach((dupId) => {
        deleteDoc(doc(db, path, String(dupId))).catch(() => {});
      });
    }

    if (hasReceivedSnapshot) {
      safeAppStorage.setJSON('dpl_live_vehicles', finalVehicles);
      safeAppStorage.setJSON('dpl_vehicles_data', finalVehicles);
      backupVehiclesToIndexedDB(finalVehicles).catch(() => {});
    }
    onData(finalVehicles);
  };

  const unsubFirestore = onSnapshot(
    collection(db, path),
    (snapshot) => {
      hasReceivedSnapshot = true;
      cachedDocs = [];
      snapshot.forEach((docSnap) => {
        cachedDocs.push({ ...docSnap.data(), _docId: docSnap.id });
      });
      emit();
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      const localCached = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
      if (localCached && localCached.length > 0) {
        const { merged } = dedupeAndMergeVehicles(localCached);
        onData(merged);
      }
      if (onError) onError(error);
    }
  );

  return () => {
    unsubFirestore();
  };
}

function dispatchTransporterVehicleNotifications(vehicle: Vehicle, prevVehicle?: Vehicle | null, isNew?: boolean) {
  try {
    const regNo = vehicle.registrationNumber || `Vehicle #${vehicle.id}`;
    const transporterTarget = (vehicle.transporterName || vehicle.brokerName || vehicle.ownerName || '').trim() || undefined;
    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Vehicle Registration Confirmed Marked -> Transporter & Vehicle Manager
    const isConfirmed =
      vehicle.status === 'CONFIRMED' ||
      vehicle.registrationConfirmed === true ||
      (isNew && vehicle.status !== 'CANCELLED' && vehicle.status !== 'EXPIRED');
    const wasConfirmed = prevVehicle
      ? (prevVehicle.status === 'CONFIRMED' || prevVehicle.registrationConfirmed === true)
      : false;

    if (isConfirmed && (!prevVehicle || !wasConfirmed)) {
      const confKey = `notif_veh_confirmed_${vehicle.id}_${regNo}`;
      if (!safeAppStorage.getItem(confKey)) {
        safeAppStorage.setItem(confKey, 'true');
        saveNotificationToFirestore({
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: `Vehicle Registered: ${regNo}`,
          description: `Vehicle ${regNo} (${transporterTarget || 'Fleet'}) has been registered in the customs bonded fleet.`,
          details: `Vehicle Registration No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nVehicle Type: ${vehicle.type || 'Trailer'}\nStatus: ${vehicle.status || 'AVAILABLE'}\nRegistration Date: ${vehicle.registrationDate || new Date().toISOString().split('T')[0]}\nExpiry Date: ${vehicle.registrationExpiryDate || vehicle.validationExpiryDate || 'N/A'}`,
          timestamp: nowTimeStr,
          type: 'INFO',
          notificationSubType: 'VEHICLE_REGISTERED',
          status: 'PENDING',
          actionLabel: 'View Vehicle',
          priority: 'MEDIUM',
          targetRole: 'ADMIN,TRANSPORTER,DOCUMENTATION_MANAGER',
          targetClientName: transporterTarget,
          category: 'TRANSPORTER',
          targetView: 'vehicles',
          targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
        }).catch(() => {});
      }
    }

    // 2. Vehicle Cancelled Marked & NOC Generated -> Transporter & Admin
    const isCancelled = vehicle.status === 'CANCELLED' || vehicle.cancellationApproved === true;
    const wasCancelled = prevVehicle
      ? (prevVehicle.status === 'CANCELLED' || prevVehicle.cancellationApproved === true)
      : false;

    if (isCancelled && !wasCancelled) {
      const cancKey = `notif_veh_cancelled_noc_${vehicle.id}_${regNo}`;
      if (!safeAppStorage.getItem(cancKey)) {
        safeAppStorage.setItem(cancKey, 'true');
        saveNotificationToFirestore({
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: `Vehicle Cancelled & NOC Generated: ${regNo}`,
          description: `Vehicle ${regNo} (${transporterTarget || 'Transporter'}) has been marked CANCELLED and its De-Registration NOC has been generated.`,
          details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nStatus: CANCELLED\nNOC Status: NOC Generated & Approved\nCancellation Date: ${vehicle.cancellationDate || new Date().toISOString().split('T')[0]}`,
          timestamp: nowTimeStr,
          type: 'ALERT',
          notificationSubType: 'VEHICLE_CANCELLED_NOC',
          status: 'PENDING',
          actionLabel: 'View NOC & Status',
          priority: 'HIGH',
          targetRole: 'ADMIN,TRANSPORTER,DOCUMENTATION_MANAGER',
          targetClientName: transporterTarget,
          category: 'TRANSPORTER',
          targetView: 'vehicles',
          targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
        }).catch(() => {});
      }
    }

    // 3. Vehicle Renewed -> Transporter & Admin
    const currRenewalsCount = Array.isArray(vehicle.renewals) ? vehicle.renewals.length : 0;
    const prevRenewalsCount = prevVehicle && Array.isArray(prevVehicle.renewals) ? prevVehicle.renewals.length : 0;
    const isRenewedNow =
      vehicle.status === 'RENEWED' ||
      currRenewalsCount > prevRenewalsCount ||
      (Boolean(vehicle.lastRenewalDate) && vehicle.lastRenewalDate !== prevVehicle?.lastRenewalDate);

    if (isRenewedNow && !isCancelled) {
      const renSig = `${currRenewalsCount}_${vehicle.lastRenewalDate || ''}_${vehicle.validationExpiryDate || vehicle.registrationExpiryDate || ''}`;
      const renKey = `notif_veh_renewed_${vehicle.id}_${renSig}`;
      if (!safeAppStorage.getItem(renKey)) {
        safeAppStorage.setItem(renKey, 'true');
        const newExp = vehicle.validationExpiryDate || vehicle.registrationExpiryDate || 'Updated';
        saveNotificationToFirestore({
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: `Vehicle Renewed: ${regNo}`,
          description: `Vehicle ${regNo} (${transporterTarget || 'Transporter'}) has been renewed. New validity/expiry date: ${newExp}.`,
          details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nStatus: RENEWED\nLast Renewal Date: ${vehicle.lastRenewalDate || new Date().toISOString().split('T')[0]}\nNew Expiry Date: ${newExp}`,
          timestamp: nowTimeStr,
          type: 'INFO',
          notificationSubType: 'VEHICLE_RENEWED',
          status: 'PENDING',
          actionLabel: 'View Renewal Details',
          priority: 'MEDIUM',
          targetRole: 'ADMIN,TRANSPORTER,DOCUMENTATION_MANAGER',
          targetClientName: transporterTarget,
          category: 'TRANSPORTER',
          targetView: 'vehicles',
          targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
        }).catch(() => {});
      }
    }

    // 4. Vehicle Location Updated by Driver
    const isLocationServiceOn = vehicle.locationServiceEnabled !== false;
    if (
      isLocationServiceOn &&
      vehicle.onlineLocation &&
      prevVehicle &&
      (vehicle.onlineLocation !== prevVehicle.onlineLocation || vehicle.lastLocationUpdatedAt !== prevVehicle.lastLocationUpdatedAt)
    ) {
      const drvName = vehicle.lastLocationDriverName || vehicle.driverName || 'Driver';
      saveNotificationToFirestore({
        id: Date.now() + Math.floor(Math.random() * 1000),
        title: `Vehicle Location Updated: ${regNo}`,
        description: `Driver ${drvName} updated live location for vehicle ${regNo}: ${vehicle.onlineLocation}.`,
        details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nDriver: ${drvName}\nCurrent Location: ${vehicle.onlineLocation}\nUpdated At: ${vehicle.lastLocationUpdatedAt || nowTimeStr}`,
        timestamp: nowTimeStr,
        type: 'INFO',
        notificationSubType: 'VEHICLE_LOCATION_UPDATE',
        status: 'PENDING',
        actionLabel: 'View Live Location',
        priority: 'MEDIUM',
        targetRole: 'ADMIN,TRANSPORTER,DOCUMENTATION_MANAGER',
        targetClientName: transporterTarget,
        category: 'TRANSPORTER',
        targetView: 'vehicles',
        targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
      }).catch(() => {});
    }

    // 5. Vehicle Missing Alert
    if (isLocationServiceOn && vehicle.isMissingAlertActive && !prevVehicle?.isMissingAlertActive) {
      saveNotificationToFirestore({
        id: Date.now() + Math.floor(Math.random() * 1000),
        title: `Vehicle Missing Alert: ${regNo}`,
        description: `URGENT: Vehicle ${regNo} (Driver: ${vehicle.driverName || 'N/A'}) has Location Service ON but GPS signal is missing / vehicle unresponsive!`,
        details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nDriver: ${vehicle.driverName || 'N/A'} (${vehicle.driverContact || 'N/A'})\nLast Known Location: ${vehicle.onlineLocation || 'Unknown'}`,
        timestamp: nowTimeStr,
        type: 'ALERT',
        notificationSubType: 'VEHICLE_MISSING_ALERT',
        status: 'PENDING',
        actionLabel: 'Locate Vehicle',
        priority: 'HIGH',
        targetRole: 'TRANSPORTER,DOCUMENTATION_MANAGER,ADMIN',
        targetClientName: transporterTarget,
        category: 'TRANSPORTER',
        targetView: 'vehicles',
        targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('Transporter vehicle notification dispatch notice:', err);
  }
}

export async function saveVehicleToFirestore(vehicle: Vehicle, skipNotification = false): Promise<void> {
  const path = 'vehicles';
  const activeCompany = getActiveCompanyId();
  const syncedBroker = (vehicle.transporterName || vehicle.brokerName || '').trim();
  const cleanReg = (vehicle.registrationNumber || '').trim().toUpperCase();
  const normPlate = normalizeVehiclePlate(cleanReg);

  // Check if a vehicle with this registration plate already exists in local cache; if so, move/merge it instead of copying
  let resolvedVehicle: Vehicle = {
    ...vehicle,
    registrationNumber: cleanReg,
    transporterName: syncedBroker,
    brokerName: syncedBroker,
    id: Number(vehicle.id || getDeterministicVehicleId(cleanReg))
  };

  try {
    const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
    const { merged, removedIds } = dedupeAndMergeVehicles([...liveVehicles, resolvedVehicle]);
    const matched = merged.find(v => normalizeVehiclePlate(v.registrationNumber) === normPlate);
    if (matched) {
      resolvedVehicle = matched;
    }
    safeAppStorage.setJSON('dpl_live_vehicles', merged);
    safeAppStorage.setJSON('dpl_vehicles_data', merged);
    removedIds.forEach(dupId => {
      if (Number(dupId) !== Number(resolvedVehicle.id)) {
        deleteDoc(doc(db, path, String(dupId))).catch(() => {});
      }
    });
  } catch (_) {}

  const docId = String(resolvedVehicle.id || Date.now());
  backupVehiclesToIndexedDB([resolvedVehicle]).catch(() => {});
  try {
    const cloudReadyVeh = await offloadLargeDataUrlsToCloudChunks(
      {
        ...resolvedVehicle,
        companyId: (resolvedVehicle as any).companyId || resolvedVehicle.operatingCompany || activeCompany,
        id: Number(docId),
        createdBy: auth.currentUser?.uid || 'guest',
        updatedAt: new Date().toISOString()
      },
      `veh_${normPlate || docId}`
    );
    const payload = sanitizeForFirestore(cloudReadyVeh);
    await setDoc(doc(db, path, docId), payload);
    if (!skipNotification) {
      dispatchTransporterVehicleNotifications({ ...resolvedVehicle, id: Number(docId) }, null, true);
    }
  } catch (error) {
    console.warn(`Firestore saveVehicle warning:`, error);
  }
}

export async function saveVehiclesBulkToFirestore(vehiclesList: Vehicle[]): Promise<void> {
  if (!vehiclesList || vehiclesList.length === 0) return;
  const path = 'vehicles';
  const activeCompany = getActiveCompanyId();

  // Merge & deduplicate against existing fleet so Docks vehicles shifting to Truckit move cleanly without doubling
  const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
  const { merged: deduplicatedAll, removedIds } = dedupeAndMergeVehicles([...liveVehicles, ...vehiclesList]);
  safeAppStorage.setJSON('dpl_live_vehicles', deduplicatedAll);
  safeAppStorage.setJSON('dpl_vehicles_data', deduplicatedAll);

  const uploadedPlates = new Set(vehiclesList.map(v => normalizeVehiclePlate(v.registrationNumber)));
  const vehiclesToWrite = deduplicatedAll.filter(v => uploadedPlates.has(normalizeVehiclePlate(v.registrationNumber)));

  backupVehiclesToIndexedDB(deduplicatedAll).catch(() => {});
  try {
    // Delete any duplicate Firestore doc IDs that were consolidated into Truckit
    for (const dupId of removedIds) {
      deleteDoc(doc(db, path, String(dupId))).catch(() => {});
    }

    for (let i = 0; i < vehiclesToWrite.length; i += 400) {
      const chunk = vehiclesToWrite.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((v, idx) => {
        const docId = String(v.id || getDeterministicVehicleId(v.registrationNumber) || (Date.now() + i + idx));
        const syncedBroker = (v.transporterName || v.brokerName || '').trim();
        const payload = sanitizeForFirestore({
          ...v,
          transporterName: syncedBroker,
          brokerName: syncedBroker,
          companyId: (v as any).companyId || v.operatingCompany || activeCompany,
          id: Number(docId) || v.id,
          createdBy: auth.currentUser?.uid || 'guest',
          updatedAt: new Date().toISOString()
        });
        batch.set(doc(db, path, docId), payload, { merge: true });
      });
      await batch.commit();
    }
  } catch (error) {
    console.warn('Firestore saveVehiclesBulk warning:', error);
  }
}

export async function updateVehicleInFirestore(vehicle: Vehicle): Promise<void> {
  const path = 'vehicles';
  const activeCompany = getActiveCompanyId();
  const syncedBroker = (vehicle.transporterName || vehicle.brokerName || '').trim();
  const updatedVeh: Vehicle = {
    ...vehicle,
    transporterName: syncedBroker,
    brokerName: syncedBroker
  };
  let prevVehicle: Vehicle | null = null;
  try {
    const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
    prevVehicle = liveVehicles.find(v => Number(v.id) === Number(updatedVeh.id)) || null;
    const { merged, removedIds } = dedupeAndMergeVehicles(
      liveVehicles.map(v => Number(v.id) === Number(updatedVeh.id) ? { ...v, ...updatedVeh } : v)
    );
    safeAppStorage.setJSON('dpl_live_vehicles', merged);
    safeAppStorage.setJSON('dpl_vehicles_data', merged);
    removedIds.forEach(dupId => {
      if (Number(dupId) !== Number(updatedVeh.id)) {
        deleteDoc(doc(db, path, String(dupId))).catch(() => {});
      }
    });
  } catch (_) {}

  const docId = String(updatedVeh.id);
  try {
    const cloudReadyVeh = await offloadLargeDataUrlsToCloudChunks(
      {
        ...updatedVeh,
        companyId: (updatedVeh as any).companyId || updatedVeh.operatingCompany || activeCompany,
        updatedAt: new Date().toISOString()
      },
      `veh_${normalizeVehiclePlate(updatedVeh.registrationNumber) || docId}`
    );
    const payload = sanitizeForFirestore(cloudReadyVeh);
    await setDoc(doc(db, path, docId), payload, { merge: true });
    const mergedVehicle = prevVehicle ? { ...prevVehicle, ...updatedVeh } : updatedVeh;
    dispatchTransporterVehicleNotifications(mergedVehicle, prevVehicle, false);
  } catch (error) {
    console.warn(`Firestore updateVehicle warning:`, error);
  }
}

export async function deleteVehicleFromFirestore(vehicleId: number | string): Promise<void> {
  const path = 'vehicles';
  try {
    const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
    const filtered = liveVehicles.filter(
      v => String(v.id) !== String(vehicleId) && String((v as any)._docId || '') !== String(vehicleId)
    );
    safeAppStorage.setJSON('dpl_live_vehicles', filtered);
    safeAppStorage.setJSON('dpl_vehicles_data', filtered);
  } catch (_) {}
  try {
    await deleteDoc(doc(db, path, String(vehicleId)));
  } catch (error) {
    console.warn(`Firestore deleteVehicle warning:`, error);
  }
}

/**
 * Atomically executes one or more vehicle Merge & Delete operations in Firestore and local cache.
 * Used by the Duplicate / Doubling Vehicle Manager so admins can merge & delete single pairs or bulk clean duplicates.
 */
export async function executeVehicleMergeAndDeleteBatch(
  operations: Array<{
    updatedPrimary?: Vehicle;
    deleteVehicles: Vehicle[];
  }>
): Promise<{ updatedCount: number; deletedCount: number }> {
  if (!operations || operations.length === 0) {
    return { updatedCount: 0, deletedCount: 0 };
  }
  const path = 'vehicles';
  const activeCompany = getActiveCompanyId();
  const deleteIdStrings = new Set<string>();
  const updatedById = new Map<number, Vehicle>();

  for (const op of operations) {
    if (op.updatedPrimary) {
      const syncedBroker = (op.updatedPrimary.transporterName || op.updatedPrimary.brokerName || '').trim();
      updatedById.set(Number(op.updatedPrimary.id), {
        ...op.updatedPrimary,
        transporterName: syncedBroker,
        brokerName: syncedBroker,
      });
    }
    for (const delVeh of op.deleteVehicles) {
      if (!delVeh) continue;
      if (op.updatedPrimary && Number(delVeh.id) === Number(op.updatedPrimary.id)) continue;
      if (delVeh.id !== undefined && delVeh.id !== null) {
        deleteIdStrings.add(String(delVeh.id));
      }
      const rawDocId = (delVeh as any)._docId;
      if (rawDocId) {
        deleteIdStrings.add(String(rawDocId));
      }
    }
  }

  // Update local storage cache immediately for instant UI responsiveness
  try {
    const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
    const nextList = liveVehicles
      .filter((v) => !deleteIdStrings.has(String(v.id)) && !deleteIdStrings.has(String((v as any)._docId || '')))
      .map((v) => {
        const up = updatedById.get(Number(v.id));
        return up ? { ...v, ...up } : v;
      });
    safeAppStorage.setJSON('dpl_live_vehicles', nextList);
    safeAppStorage.setJSON('dpl_vehicles_data', nextList);
    backupVehiclesToIndexedDB(nextList).catch(() => {});
  } catch (_) {}

  // Commit Firestore writes & deletes in chunks of 400 (Firestore batch limit is 500)
  const writeOps: Array<{ type: 'SET'; docId: string; payload: any } | { type: 'DEL'; docId: string }> = [];

  for (const [, primaryVeh] of updatedById.entries()) {
    const rawDocId = String((primaryVeh as any)._docId || primaryVeh.id);
    // Ensure we never delete the surviving primary's own docId
    deleteIdStrings.delete(rawDocId);
    deleteIdStrings.delete(String(primaryVeh.id));

    const cloudReadyVeh = await offloadLargeDataUrlsToCloudChunks(
      {
        ...primaryVeh,
        companyId: (primaryVeh as any).companyId || primaryVeh.operatingCompany || activeCompany,
        updatedAt: new Date().toISOString()
      },
      `veh_${normalizeVehiclePlate(primaryVeh.registrationNumber) || rawDocId}`
    );
    const cleanCopy = { ...cloudReadyVeh };
    delete (cleanCopy as any)._docId;
    writeOps.push({
      type: 'SET',
      docId: rawDocId,
      payload: sanitizeForFirestore(cleanCopy)
    });
  }

  deleteIdStrings.forEach((delDocId) => {
    if (delDocId) {
      writeOps.push({ type: 'DEL', docId: delDocId });
    }
  });

  for (let i = 0; i < writeOps.length; i += 400) {
    const slice = writeOps.slice(i, i + 400);
    const batch = writeBatch(db);
    slice.forEach((item) => {
      const ref = doc(db, path, item.docId);
      if (item.type === 'SET') {
        batch.set(ref, item.payload, { merge: true });
      } else {
        batch.delete(ref);
      }
    });
    await batch.commit();
  }

  return {
    updatedCount: updatedById.size,
    deletedCount: deleteIdStrings.size
  };
}

/**
 * Looks up a driver by CNIC number across the saved Drivers database (`dpl_live_drivers`),
 * historical Cases (`dpl_live_cases` / `dpl_cases_data`), and Vehicles (`dpl_live_vehicles`)
 * so typing a Driver CNIC automatically pulls the driver's Name, Contact, and Front/Back CNIC images from backup.
 */
export function lookupDriverByCnic(cnicInput: string): {
  name: string;
  contact: string;
  cnic: string;
  cnicFrontUrl?: string;
  cnicFrontName?: string;
  cnicBackUrl?: string;
  cnicBackName?: string;
} | null {
  const cleanDigits = (cnicInput || '').replace(/[^0-9]/g, '');
  if (cleanDigits.length < 13) return null;

  // 1. Check dedicated Drivers backup (`dpl_live_drivers`)
  try {
    const drivers = safeAppStorage.getJSON<Driver[]>('dpl_live_drivers', []) || [];
    const found = drivers.find(d => (d.cnic || '').replace(/[^0-9]/g, '') === cleanDigits);
    if (found && found.name) {
      return {
        name: found.name,
        contact: found.contact || '',
        cnic: found.cnic,
        cnicFrontUrl: found.cnicFrontUrl,
        cnicFrontName: found.cnicFrontName || 'Driver_CNIC_Front (Backup)',
        cnicBackUrl: found.cnicBackUrl,
        cnicBackName: found.cnicBackName || 'Driver_CNIC_Back (Backup)',
      };
    }
  } catch (_) {}

  // 2. Check historical Cases (`dpl_live_cases` and `dpl_cases_data`)
  try {
    const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []) || [];
    const cachedCases = safeAppStorage.getJSON<Case[]>('dpl_cases_data', []) || [];
    const allCases = [...liveCases, ...cachedCases];
    for (const c of allCases) {
      const va = c.vehicleAssignment;
      if (va && (va.driverCnic || '').replace(/[^0-9]/g, '') === cleanDigits && va.driverName) {
        return {
          name: va.driverName,
          contact: va.driverContact || '',
          cnic: va.driverCnic || cnicInput,
          cnicFrontUrl: va.driverCnicFrontUrl || va.driverCnicUrl,
          cnicFrontName: va.driverCnicFrontName || va.driverCnicName || 'Driver_CNIC_Front (Backup)',
          cnicBackUrl: va.driverCnicBackUrl,
          cnicBackName: va.driverCnicBackName || 'Driver_CNIC_Back (Backup)',
        };
      }
      // Also check additionalVehicles in case of multi-vehicle assignments
      if (Array.isArray(va?.additionalVehicles)) {
        for (const av of va!.additionalVehicles) {
          if ((av.driverCnic || '').replace(/[^0-9]/g, '') === cleanDigits && av.driverName) {
            return {
              name: av.driverName,
              contact: av.driverContact || '',
              cnic: av.driverCnic || cnicInput,
              cnicFrontUrl: av.driverCnicFrontUrl || av.driverCnicUrl,
              cnicFrontName: av.driverCnicFrontName || av.driverCnicName || 'Driver_CNIC_Front (Backup)',
              cnicBackUrl: av.driverCnicBackUrl,
              cnicBackName: av.driverCnicBackName || 'Driver_CNIC_Back (Backup)',
            };
          }
        }
      }
    }
  } catch (_) {}

  // 3. Check registered Vehicles list for matching driverCnic
  try {
    const vehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []) || [];
    const vMatch = vehicles.find(v => (v.driverCnic || '').replace(/[^0-9]/g, '') === cleanDigits && v.driverName);
    if (vMatch && vMatch.driverName) {
      return {
        name: vMatch.driverName,
        contact: vMatch.driverContact || '',
        cnic: vMatch.driverCnic || cnicInput,
        cnicFrontUrl: vMatch.driverCnicDoc,
        cnicFrontName: vMatch.driverCnicDocName || 'Driver_CNIC_Front (Backup)',
      };
    }
  } catch (_) {}

  return null;
}

/**
 * Saves/updates a driver in the global Driver Backup (`drivers` collection + `dpl_live_drivers`)
 * whenever a driver is assigned or updated in workflow.
 */
export async function upsertDriverBackupFromWorkflow(driverData: {
  driverCnic?: string;
  driverName?: string;
  driverContact?: string;
  driverCnicFrontUrl?: string;
  driverCnicFrontName?: string;
  driverCnicBackUrl?: string;
  driverCnicBackName?: string;
  vehiclePlate?: string;
  transporterName?: string;
}): Promise<void> {
  const cleanDigits = (driverData.driverCnic || '').replace(/[^0-9]/g, '');
  if (cleanDigits.length < 13 || !driverData.driverName) return;

  const docId = `drv_${cleanDigits}`;
  let existing: Partial<Driver> = {};
  try {
    const drivers = safeAppStorage.getJSON<Driver[]>('dpl_live_drivers', []) || [];
    const match = drivers.find(d => d.id === docId || (d.cnic || '').replace(/[^0-9]/g, '') === cleanDigits);
    if (match) existing = match;
  } catch (_) {}

  const record: Driver = {
    id: existing.id || docId,
    name: driverData.driverName.trim(),
    cnic: driverData.driverCnic!.trim(),
    contact: (driverData.driverContact || existing.contact || '').trim(),
    licenseNumber: existing.licenseNumber || 'N/A',
    status: existing.status || 'AVAILABLE',
    transporterName: driverData.transporterName || existing.transporterName || 'Truckit Fleet',
    assignedVehicleNo: driverData.vehiclePlate || existing.assignedVehicleNo,
    cnicFrontUrl: driverData.driverCnicFrontUrl || existing.cnicFrontUrl,
    cnicFrontName: driverData.driverCnicFrontName || existing.cnicFrontName,
    cnicBackUrl: driverData.driverCnicBackUrl || existing.cnicBackUrl,
    cnicBackName: driverData.driverCnicBackName || existing.cnicBackName,
    createdAt: existing.createdAt || new Date().toISOString().split('T')[0],
  };

  await saveDriverToFirestore(record);
}

export interface ExtractedVehicleTripCandidate {
  normPlate: string;
  rawPlate: string;
  id: string;
  caseNo: string;
  date: string;
  pol: string;
  pod: string;
  route: string;
  importerName: string;
  itemDescription: string;
  clientName: string;
  containerNumber: string;
  driverName: string;
  driverCnic: string;
  driverPhone: string;
  driverCnicFrontUrl?: string;
  driverCnicBackUrl?: string;
  registrationBookUrl?: string;
  registrationBookName?: string;
  ownerCnicUrl?: string;
  ownerCnicName?: string;
  status: string;
}

/**
 * Extracts all vehicle assignments and rich cargo/driver metadata from a Case
 * across `vehicleAssignment`, `additionalVehicles`, all `containers[]`, `workflowDetails`, and `extractedData`.
 */
export function extractCaseVehicleTripEntries(
  shipmentCase: Case,
  driversPool?: Driver[]
): ExtractedVehicleTripCandidate[] {
  if (!shipmentCase) return [];
  const va: any = (shipmentCase as any).vehicleAssignment || {};
  const wfMap: Record<string, any> = shipmentCase.workflowDetails || {};
  const wfVeh: any = wfMap['Vehicle Assignment'] || wfMap['VEHICLE_ASSIGNMENT'] || {};
  const wfLoad: any = wfMap['Loading Port Processing'] || wfMap['LOADING_PORT_PROCESSING'] || {};
  const wfTp: any = wfMap['TP Filing'] || wfMap['TP_FILING'] || {};
  const ext: any = shipmentCase.extractedData || {};

  // Find any category-specific cargo description or vehicle/driver fields across workflowDetails
  let wfCargoDesc = '';
  const wfPlateEntries: Array<{
    plate: string;
    driverName?: string;
    driverCnic?: string;
    driverContact?: string;
    frontUrl?: string;
    backUrl?: string;
    stepDate?: string;
  }> = [];

  Object.values(wfMap).forEach((step: any) => {
    if (!step || typeof step !== 'object') return;
    if (!wfCargoDesc && (step.cargoDescription || step.tpItemDescription || step.isoChemicalName)) {
      wfCargoDesc = step.cargoDescription || step.tpItemDescription || step.isoChemicalName || '';
    }
    const candidatePlates = [
      step.assignedVehicleNo,
      step.assignedTruckNo,
      step.attVehicleNo,
      step.cargoTruckNo,
      step.carCarrierTrailerNo,
      step.isoHazmatVehicleNo,
      step.isoVehicleRegNo,
      step.assignedTrailerNo
    ].filter(Boolean);

    candidatePlates.forEach((p: string) => {
      wfPlateEntries.push({
        plate: p,
        driverName:
          step.driverName ||
          step.assignedDriverName ||
          step.attDriverName ||
          step.cargoDriverName ||
          step.isoHazmatDriverName ||
          step.isoDriverName ||
          step.assignedTrailerDriver,
        driverCnic:
          step.driverCnic ||
          step.assignedDriverCnic ||
          step.attDriverCnic ||
          step.cargoDriverCnic,
        driverContact:
          step.driverContact ||
          step.cargoDriverPhone ||
          step.assignedDriverPhone,
        frontUrl: step.driverCnicFrontUrl || step.cargoDriverCnicDocUrl,
        backUrl: step.driverCnicBackUrl,
        stepDate: step.date
      });
    });
  });

  const rawAssignments: Array<{
    vehicleNo: string;
    containerNo?: string;
    driverName?: string;
    driverCnic?: string;
    driverContact?: string;
    driverCnicFrontUrl?: string;
    driverCnicBackUrl?: string;
    registrationBookUrl?: string;
    registrationBookName?: string;
    ownerCnicUrl?: string;
    ownerCnicName?: string;
    allocationDate?: string;
  }> = [];

  const pushRaw = (entry: typeof rawAssignments[number]) => {
    const clean = String(entry.vehicleNo || '').trim();
    if (!clean || clean.toUpperCase() === 'TBD' || clean.toUpperCase() === 'N/A') return;
    rawAssignments.push({ ...entry, vehicleNo: clean });
  };

  if (va.vehicleNo) {
    pushRaw({
      vehicleNo: va.vehicleNo,
      driverName: va.driverName || wfVeh.driverName || wfLoad.driverName,
      driverCnic: va.driverCnic || wfVeh.driverCnic || wfLoad.driverCnic,
      driverContact: va.driverContact || wfVeh.driverContact,
      driverCnicFrontUrl: va.driverCnicFrontUrl || va.driverCnicUrl || wfVeh.driverCnicFrontUrl || wfLoad.driverCnicFrontUrl,
      driverCnicBackUrl: va.driverCnicBackUrl || wfVeh.driverCnicBackUrl || wfLoad.driverCnicBackUrl,
      registrationBookUrl: va.registrationBookUrl || wfVeh.registrationBookUrl,
      registrationBookName: va.registrationBookName || wfVeh.registrationBookName,
      ownerCnicUrl: va.ownerCnicUrl || wfVeh.ownerCnicUrl,
      ownerCnicName: va.ownerCnicName || wfVeh.ownerCnicName,
      allocationDate: va.allocationDate || wfVeh.date || wfLoad.date
    });
  }

  if (Array.isArray(va.additionalVehicles)) {
    va.additionalVehicles.forEach((av: any) => {
      if (!av?.vehicleNo) return;
      pushRaw({
        vehicleNo: av.vehicleNo,
        driverName: av.driverName,
        driverCnic: av.driverCnic,
        driverContact: av.driverContact,
        driverCnicFrontUrl: av.driverCnicFrontUrl || av.driverCnicUrl,
        driverCnicBackUrl: av.driverCnicBackUrl,
        registrationBookUrl: av.registrationBookUrl,
        registrationBookName: av.registrationBookName,
        ownerCnicUrl: av.ownerCnicUrl,
        ownerCnicName: av.ownerCnicName,
        allocationDate: av.allocationDate || va.allocationDate || wfVeh.date
      });
    });
  }

  if (Array.isArray(shipmentCase.containers)) {
    shipmentCase.containers.forEach((cntr) => {
      if (!cntr?.vehicleNo) return;
      pushRaw({
        vehicleNo: cntr.vehicleNo,
        containerNo: cntr.number,
        driverName: cntr.driverName || va.driverName || wfVeh.driverName,
        driverCnic: cntr.driverCnic || va.driverCnic || wfVeh.driverCnic,
        driverContact: cntr.driverContact || va.driverContact,
        driverCnicFrontUrl: va.driverCnicFrontUrl || wfVeh.driverCnicFrontUrl || wfLoad.driverCnicFrontUrl,
        driverCnicBackUrl: va.driverCnicBackUrl || wfVeh.driverCnicBackUrl || wfLoad.driverCnicBackUrl,
        allocationDate: va.allocationDate || wfVeh.date || wfLoad.date
      });
    });
  }

  wfPlateEntries.forEach((wpe) => {
    pushRaw({
      vehicleNo: wpe.plate,
      driverName: wpe.driverName || va.driverName,
      driverCnic: wpe.driverCnic || va.driverCnic,
      driverContact: wpe.driverContact || va.driverContact,
      driverCnicFrontUrl: wpe.frontUrl || va.driverCnicFrontUrl || wfVeh.driverCnicFrontUrl,
      driverCnicBackUrl: wpe.backUrl || va.driverCnicBackUrl || wfVeh.driverCnicBackUrl,
      registrationBookUrl: wfVeh.registrationBookUrl || va.registrationBookUrl,
      registrationBookName: wfVeh.registrationBookName || va.registrationBookName,
      ownerCnicUrl: wfVeh.ownerCnicUrl || va.ownerCnicUrl,
      ownerCnicName: wfVeh.ownerCnicName || va.ownerCnicName,
      allocationDate: wpe.stepDate || va.allocationDate
    });
  });

  const topPlate = (shipmentCase as any).vehicleNumber || (shipmentCase as any).assignedVehicleNo || ext.vehicleNumber || '';
  if (topPlate) {
    pushRaw({
      vehicleNo: topPlate,
      driverName: (shipmentCase as any).driverName || ext.driverName || va.driverName || wfVeh.driverName,
      driverCnic: (shipmentCase as any).driverCnic || ext.driverCnic || va.driverCnic || wfVeh.driverCnic,
      driverContact: (shipmentCase as any).driverContact || ext.driverContact || va.driverContact,
      driverCnicFrontUrl: va.driverCnicFrontUrl || wfVeh.driverCnicFrontUrl || wfLoad.driverCnicFrontUrl,
      driverCnicBackUrl: va.driverCnicBackUrl || wfVeh.driverCnicBackUrl || wfLoad.driverCnicBackUrl,
      allocationDate: va.allocationDate || wfVeh.date
    });
  }

  if (rawAssignments.length === 0) return [];

  const drivers: Driver[] = driversPool || safeAppStorage.getJSON<Driver[]>('dpl_live_drivers', []) || [];
  const caseDisplayNo = shipmentCase.caseNo || shipmentCase.caseNumber || shipmentCase.id || 'N/A';

  const pol = (
    shipmentCase.pol ||
    ext.pol ||
    ext.pickupDestination ||
    wfLoad.portTerminalName ||
    wfLoad.portTerminal ||
    'Karachi Port'
  ).trim();

  const pod = (
    shipmentCase.pod ||
    ext.pod ||
    ext.placeOfDelivery ||
    ext.dropoffDestination ||
    'Destination Port'
  ).trim();

  const clientName = (shipmentCase.clientName || shipmentCase.client || 'N/A').trim();

  const importerName = (
    shipmentCase.importer ||
    (shipmentCase as any).importerName ||
    ext.consigneeName ||
    ext.cargoOwner ||
    (shipmentCase as any).consignee ||
    clientName ||
    'N/A'
  ).trim();

  const itemDescription = (
    shipmentCase.itemDescription ||
    ext.itemDescription ||
    ext.itemName ||
    ext.itemType ||
    wfTp.tpItemDescription ||
    wfCargoDesc ||
    shipmentCase.category ||
    'General Cargo'
  ).trim();

  const allCaseContainers = Array.isArray(shipmentCase.containers) && shipmentCase.containers.length > 0
    ? shipmentCase.containers.map(c => c.number).filter(Boolean).join(', ')
    : (shipmentCase.containerNumber || ext.containerNo || '-');

  const fallbackDateRaw =
    shipmentCase.loadingPortGateOutTime ||
    shipmentCase.registrationDate ||
    shipmentCase.date ||
    shipmentCase.createdAt ||
    new Date().toISOString();
  const fallbackDate = String(fallbackDateRaw).slice(0, 10);

  // Merge per normalized plate within this case
  const byPlate = new Map<string, ExtractedVehicleTripCandidate>();
  for (const raw of rawAssignments) {
    const normPlate = normalizeVehiclePlate(raw.vehicleNo);
    if (!normPlate) continue;

    const cleanCnicDigits = String(raw.driverCnic || '').replace(/[^0-9]/g, '');
    const matchedDriver = drivers.find((d) => {
      const dDigits = String(d.cnic || '').replace(/[^0-9]/g, '');
      if (cleanCnicDigits && cleanCnicDigits.length >= 11 && dDigits === cleanCnicDigits) return true;
      if (raw.driverName && d.name && d.name.trim().toLowerCase() === raw.driverName.trim().toLowerCase()) return true;
      if (d.assignedVehicleNo && normalizeVehiclePlate(d.assignedVehicleNo) === normPlate) return true;
      return false;
    });

    const existing = byPlate.get(normPlate);
    const mergedContainers = existing?.containerNumber && raw.containerNo && !existing.containerNumber.includes(raw.containerNo)
      ? `${existing.containerNumber}, ${raw.containerNo}`
      : (raw.containerNo || existing?.containerNumber || allCaseContainers);

    const candidate: ExtractedVehicleTripCandidate = {
      normPlate,
      rawPlate: existing?.rawPlate || raw.vehicleNo.toUpperCase(),
      id: `TRIP-${caseDisplayNo}-${normPlate}`,
      caseNo: caseDisplayNo,
      date: String(raw.allocationDate || existing?.date || fallbackDate).slice(0, 10),
      pol,
      pod,
      route: `${pol} → ${pod}`,
      importerName,
      itemDescription,
      clientName,
      containerNumber: mergedContainers,
      driverName: (raw.driverName || existing?.driverName || matchedDriver?.name || '').trim(),
      driverCnic: (raw.driverCnic || existing?.driverCnic || matchedDriver?.cnic || '').trim(),
      driverPhone: (raw.driverContact || existing?.driverPhone || matchedDriver?.contact || '').trim(),
      driverCnicFrontUrl: raw.driverCnicFrontUrl || existing?.driverCnicFrontUrl || matchedDriver?.cnicFrontUrl || matchedDriver?.cnicDocUrl,
      driverCnicBackUrl: raw.driverCnicBackUrl || existing?.driverCnicBackUrl || matchedDriver?.cnicBackUrl,
      registrationBookUrl: raw.registrationBookUrl || existing?.registrationBookUrl,
      registrationBookName: raw.registrationBookName || existing?.registrationBookName,
      ownerCnicUrl: raw.ownerCnicUrl || existing?.ownerCnicUrl,
      ownerCnicName: raw.ownerCnicName || existing?.ownerCnicName,
      status: `${shipmentCase.status || 'In Transit'} (${caseDisplayNo})`
    };
    byPlate.set(normPlate, candidate);
  }

  return Array.from(byPlate.values());
}

/**
 * Records or updates a trip in the assigned vehicle's `tripsHistory` and syncs any newly uploaded
 * Vehicle Registration Book or Owner ID Card back to the master Vehicle record.
 */
export async function recordVehicleTripFromCase(shipmentCase: Case): Promise<void> {
  const candidates = extractCaseVehicleTripEntries(shipmentCase);
  if (candidates.length === 0) return;

  const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []) || [];

  for (const item of candidates) {
    const matched = liveVehicles.find(v => normalizeVehiclePlate(v.registrationNumber) === item.normPlate);
    if (!matched) continue;

    const safeFront = item.driverCnicFrontUrl && item.driverCnicFrontUrl.length < 120000 ? item.driverCnicFrontUrl : undefined;
    const safeBack = item.driverCnicBackUrl && item.driverCnicBackUrl.length < 120000 ? item.driverCnicBackUrl : undefined;

    const tripEntry = {
      id: item.id,
      caseNo: item.caseNo,
      date: item.date,
      pol: item.pol,
      pod: item.pod,
      route: item.route,
      containerNumber: item.containerNumber,
      driverName: item.driverName || matched.driverName || 'Not Recorded',
      driverCnic: item.driverCnic || matched.driverCnic || '',
      driverPhone: item.driverPhone || matched.driverContact || '',
      driverCnicFrontUrl: safeFront,
      driverCnicBackUrl: safeBack,
      importerName: item.importerName,
      itemDescription: item.itemDescription,
      clientName: item.clientName,
      status: item.status
    };

    const existingTrips = Array.isArray(matched.tripsHistory) ? [...matched.tripsHistory] : [];
    const existingIdx = existingTrips.findIndex(
      t => t.id === tripEntry.id || t.caseNo === item.caseNo || (t.status && t.status.includes(item.caseNo))
    );
    if (existingIdx >= 0) {
      existingTrips[existingIdx] = { ...existingTrips[existingIdx], ...tripEntry };
    } else {
      existingTrips.unshift(tripEntry);
    }

    const updatedVehicle: Vehicle = {
      ...matched,
      tripsHistory: existingTrips,
      driverName: item.driverName || matched.driverName,
      driverCnic: item.driverCnic || matched.driverCnic,
      driverContact: item.driverPhone || matched.driverContact,
      registrationBook: matched.registrationBook || item.registrationBookUrl,
      registrationBookName: matched.registrationBookName || item.registrationBookName,
      ownerIdCardUrl: matched.ownerIdCardUrl || item.ownerCnicUrl,
      ownerIdCardName: matched.ownerIdCardName || item.ownerCnicName,
    };

    await updateVehicleInFirestore(updatedVehicle);
  }
}

/**
 * Scans all registered cases (including all cases registered this month across all companies)
 * and backfills/syncs their trip history into every assigned vehicle in Firestore.
 */
export async function syncAllCasesHistoryToVehicles(
  casesList: Case[],
  vehiclesList: Vehicle[],
  driversPool?: Driver[]
): Promise<number> {
  if (!Array.isArray(casesList) || casesList.length === 0 || !Array.isArray(vehiclesList) || vehiclesList.length === 0) {
    return 0;
  }

  const tripsByNormPlate = new Map<string, ExtractedVehicleTripCandidate[]>();
  for (const c of casesList) {
    if (String(c.status || '').toUpperCase() === 'CANCELLED') continue;
    const entries = extractCaseVehicleTripEntries(c, driversPool);
    for (const entry of entries) {
      const list = tripsByNormPlate.get(entry.normPlate) || [];
      list.push(entry);
      tripsByNormPlate.set(entry.normPlate, list);
    }
  }

  let updatedCount = 0;
  for (const veh of vehiclesList) {
    const normPlate = normalizeVehiclePlate(veh.registrationNumber);
    if (!normPlate) continue;
    const caseCandidates = tripsByNormPlate.get(normPlate);
    if (!caseCandidates || caseCandidates.length === 0) continue;

    const currentTrips = Array.isArray(veh.tripsHistory) ? [...veh.tripsHistory] : [];
    let changed = false;

    for (const item of caseCandidates) {
      const safeFront = item.driverCnicFrontUrl && item.driverCnicFrontUrl.length < 120000 ? item.driverCnicFrontUrl : undefined;
      const safeBack = item.driverCnicBackUrl && item.driverCnicBackUrl.length < 120000 ? item.driverCnicBackUrl : undefined;

      const idx = currentTrips.findIndex(
        t => t.id === item.id || t.caseNo === item.caseNo || (t.status && t.status.includes(item.caseNo))
      );

      const nextEntry = {
        ...(idx >= 0 ? currentTrips[idx] : {}),
        id: item.id,
        caseNo: item.caseNo,
        date: item.date,
        pol: item.pol,
        pod: item.pod,
        route: item.route,
        containerNumber: item.containerNumber,
        driverName: item.driverName || (idx >= 0 ? currentTrips[idx].driverName : '') || veh.driverName || 'Not Recorded',
        driverCnic: item.driverCnic || (idx >= 0 ? currentTrips[idx].driverCnic : '') || veh.driverCnic || '',
        driverPhone: item.driverPhone || (idx >= 0 ? currentTrips[idx].driverPhone : '') || veh.driverContact || '',
        driverCnicFrontUrl: safeFront || (idx >= 0 ? currentTrips[idx].driverCnicFrontUrl : undefined),
        driverCnicBackUrl: safeBack || (idx >= 0 ? currentTrips[idx].driverCnicBackUrl : undefined),
        importerName: item.importerName,
        itemDescription: item.itemDescription,
        clientName: item.clientName,
        status: item.status
      };

      if (idx >= 0) {
        const prev = currentTrips[idx];
        if (
          prev.pol !== nextEntry.pol ||
          prev.pod !== nextEntry.pod ||
          prev.itemDescription !== nextEntry.itemDescription ||
          prev.importerName !== nextEntry.importerName ||
          prev.clientName !== nextEntry.clientName ||
          prev.driverName !== nextEntry.driverName ||
          prev.driverCnic !== nextEntry.driverCnic ||
          prev.driverPhone !== nextEntry.driverPhone ||
          prev.date !== nextEntry.date
        ) {
          currentTrips[idx] = nextEntry;
          changed = true;
        }
      } else {
        currentTrips.unshift(nextEntry);
        changed = true;
      }
    }

    if (changed) {
      currentTrips.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      await updateVehicleInFirestore({
        ...veh,
        tripsHistory: currentTrips
      });
      updatedCount++;
    }
  }

  return updatedCount;
}

// AVAILABLE VEHICLES (READY FOR LOADING)
export function subscribeToAvailableVehicles(
  onData: (items: AvailableVehicle[]) => void,
  onError?: (err: any) => void
) {
  const path = 'available_vehicles';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const items: AvailableVehicle[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ ...docSnap.data(), id: docSnap.id } as AvailableVehicle);
      });
      onData(dedupeArrayById(items));
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
    }
  );
}

export async function saveAvailableVehicleToFirestore(item: AvailableVehicle): Promise<void> {
  const path = 'available_vehicles';
  const docId = String(item.id || `ready_${item.vehicleNo.replace(/\s+/g, '_')}`);
  try {
    const payload = sanitizeForFirestore({
      ...item,
      id: docId,
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload);
  } catch (error) {
    console.warn(`Firestore saveAvailableVehicle warning:`, error);
  }
}

export async function deleteAvailableVehicleFromFirestore(id: string): Promise<void> {
  const path = 'available_vehicles';
  try {
    await deleteDoc(doc(db, path, String(id)));
  } catch (error) {
    console.warn(`Firestore deleteAvailableVehicle warning:`, error);
  }
}

// TRANSPORTER DRIVERS MANAGEMENT
export function subscribeToDrivers(
  onData: (items: Driver[]) => void,
  onError?: (err: any) => void
) {
  const path = 'drivers';
  const cached = safeAppStorage.getJSON<Driver[]>('dpl_live_drivers', []);
  if (cached && cached.length > 0) {
    onData(dedupeArrayById(cached));
  }
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const items: Driver[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ ...docSnap.data(), id: docSnap.id } as Driver);
      });
      const unique = dedupeArrayById(items);
      safeAppStorage.setJSON('dpl_live_drivers', unique);
      onData(unique);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
    }
  );
}

export async function saveDriverToFirestore(item: Driver): Promise<void> {
  const path = 'drivers';
  const docId = String(item.id || `drv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const payload = sanitizeForFirestore({
    ...item,
    id: docId,
    updatedAt: new Date().toISOString()
  });

  // Update local storage cache immediately so Driver login works without delay
  try {
    const current = safeAppStorage.getJSON<Driver[]>('dpl_live_drivers', []) || [];
    const filtered = current.filter(d => String(d.id) !== docId);
    safeAppStorage.setJSON('dpl_live_drivers', [payload as Driver, ...filtered]);
  } catch (_) {}

  try {
    await setDoc(doc(db, path, docId), payload, { merge: true });

    // If Driver has Login ID & Password created by Transporter, also sync to users collection
    if (item.userId && item.password) {
      const userDocId = `driver_${docId}`;
      const driverUserPayload = sanitizeForFirestore({
        id: userDocId,
        userId: item.userId.trim(),
        password: item.password.trim(),
        name: item.name.trim(),
        role: UserRole.DRIVER,
        roles: [UserRole.DRIVER],
        designation: `Trip Driver (${item.assignedVehicleNo || 'Fleet'})`,
        contact: item.contact || '',
        email: `${item.userId.trim().toLowerCase()}@driver.dpl`,
        status: 'ACTIVE',
        clientName: item.transporterName || 'Transporter',
        assignedVehicleNo: item.assignedVehicleNo || '',
        updatedAt: new Date().toISOString()
      });
      await setDoc(doc(db, 'users', userDocId), driverUserPayload, { merge: true });
    }
  } catch (error) {
    console.warn(`Firestore saveDriver warning:`, error);
  }
}

export async function deleteDriverFromFirestore(id: string): Promise<void> {
  const path = 'drivers';
  try {
    await deleteDoc(doc(db, path, String(id)));
  } catch (error) {
    console.warn(`Firestore deleteDriver warning:`, error);
  }
}

// HELPERS FOR DETERMINISTIC UNIQUE IDS & ARRAY DEDUPLICATION
export function parseNumericDocId(rawId: any, docSnapId: string, indexOffset: number = 0): number {
  if (typeof rawId === 'number' && !isNaN(rawId) && rawId > 0) {
    return rawId;
  }
  const parsed = Number(rawId);
  if (!isNaN(parsed) && parsed > 0) {
    return parsed;
  }
  const snapNum = Number(docSnapId);
  if (!isNaN(snapNum) && snapNum > 0) {
    return snapNum;
  }
  // Deterministic 32-bit positive integer hash of the string document ID
  let hash = 0;
  const str = String(docSnapId || 'doc') + '_' + indexOffset;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) + 100000 + indexOffset;
}

export function dedupeArrayById<T extends { id?: any }>(items: T[]): T[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const unique: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const rawId = item.id;
    if (rawId === undefined || rawId === null || rawId === '') {
      const fallbackId = `item_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
      (item as any).id = fallbackId;
      seen.add(String(fallbackId));
      unique.push(item);
    } else {
      const key = String(rawId);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
      // If already seen, drop duplicate to prevent react duplicate key errors
    }
  }
  return unique;
}

// TRANSPORTER REQUESTS (REGISTRATION, RENEWAL, CANCELLATION)
const TRANSPORTER_REQUESTS_KEY = 'dpl_live_transporter_requests';
const NOTIFICATIONS_STORAGE_KEY = 'dpl_live_notifications';

export function subscribeToTransporterRequests(
  onData: (items: TransporterRequest[]) => void,
  onError?: (err: any) => void
) {
  const path = 'transporter_requests';
  
  // 1. Immediately emit from local safeAppStorage cache if available
  const cached = safeAppStorage.getJSON<TransporterRequest[]>(TRANSPORTER_REQUESTS_KEY, []);
  if (cached && cached.length > 0) {
    onData(dedupeArrayById(cached));
  }

  // 2. Listen for intra-tab updates
  const handleLocalUpdate = (e: any) => {
    const fresh = safeAppStorage.getJSON<TransporterRequest[]>(TRANSPORTER_REQUESTS_KEY, []);
    if (fresh) onData(dedupeArrayById(fresh));
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('dpl_transporter_requests_updated', handleLocalUpdate);
  }

  // 3. Subscribe to live Firestore collection
  const unsubscribeSnapshot = onSnapshot(
    collection(db, path),
    (snapshot) => {
      const items: TransporterRequest[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ ...docSnap.data(), id: docSnap.id } as TransporterRequest);
      });
      // Deduplicate and sort newest first
      const uniqueItems = dedupeArrayById(items);
      uniqueItems.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      safeAppStorage.setJSON(TRANSPORTER_REQUESTS_KEY, uniqueItems);
      onData(uniqueItems);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
    }
  );

  return () => {
    unsubscribeSnapshot();
    if (typeof window !== 'undefined') {
      window.removeEventListener('dpl_transporter_requests_updated', handleLocalUpdate);
    }
  };
}

export async function saveTransporterRequestToFirestore(request: TransporterRequest): Promise<void> {
  const path = 'transporter_requests';
  const docId = String(request.id || `req_${Date.now()}`);
  const payload = sanitizeForFirestore({
    ...request,
    id: docId,
    updatedAt: new Date().toISOString()
  });

  // Save to local storage cache immediately
  try {
    const current = safeAppStorage.getJSON<TransporterRequest[]>(TRANSPORTER_REQUESTS_KEY, []) || [];
    const filtered = current.filter(r => String(r.id) !== docId);
    const updated = [payload as TransporterRequest, ...filtered];
    safeAppStorage.setJSON(TRANSPORTER_REQUESTS_KEY, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_transporter_requests_updated', { detail: payload }));
    }
  } catch (storageErr) {
    console.warn("Storage sync error on saveTransporterRequest:", storageErr);
  }

  // Persist to Firestore
  try {
    await setDoc(doc(db, path, docId), payload);
  } catch (error) {
    console.warn(`Firestore saveTransporterRequest warning:`, error);
  }
}

export async function updateTransporterRequestInFirestore(request: TransporterRequest): Promise<void> {
  const path = 'transporter_requests';
  const docId = String(request.id);
  const payload = sanitizeForFirestore({ ...request, updatedAt: new Date().toISOString() });

  // Update local storage cache immediately
  try {
    const current = safeAppStorage.getJSON<TransporterRequest[]>(TRANSPORTER_REQUESTS_KEY, []) || [];
    const updated = current.map(r => String(r.id) === docId ? { ...r, ...payload } : r);
    safeAppStorage.setJSON(TRANSPORTER_REQUESTS_KEY, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_transporter_requests_updated', { detail: payload }));
    }
  } catch (storageErr) {
    console.warn("Storage sync error on updateTransporterRequest:", storageErr);
  }

  // Persist to Firestore
  try {
    await setDoc(doc(db, path, docId), payload, { merge: true });
  } catch (error) {
    console.warn(`Firestore updateTransporterRequest warning:`, error);
  }
}

// NOTIFICATIONS

/**
 * Checks whether a notification is invalid or an unsolicited auto-audit notification.
 * Never deletes real user/workflow notifications just because local storage caches for other tabs haven't loaded yet.
 */
function isOrphanedNotification(n: AppNotification): boolean {
  if (!n || !n.title) return true;

  // Filter out legacy unsolicited auto-audit spam notifications
  const rawDocId = String((n as any)._docId || n.id || '');
  if (
    rawDocId.startsWith('audit_vehicle_expired_') ||
    rawDocId.startsWith('audit_vehicle_expiring_soon_') ||
    rawDocId.startsWith('audit_vehicle_idle_')
  ) {
    return true;
  }

  // Check against last system reset timestamp if present
  const lastResetIso = safeAppStorage.getRawItem('dpl_last_reset_timestamp');
  if (lastResetIso && (n as any).updatedAt) {
    const resetTime = new Date(lastResetIso).getTime();
    const notifTime = new Date((n as any).updatedAt).getTime();
    if (!isNaN(resetTime) && !isNaN(notifTime) && notifTime < resetTime) {
      return true;
    }
  }

  return false;
}

const READ_NOTIF_KEYS_STORAGE = 'dpl_read_notification_keys';
const DELETED_NOTIF_KEYS_STORAGE = 'dpl_deleted_notification_keys';

function getNotificationReadSignature(n: Partial<AppNotification>): string {
  const approvalAction = (n.approvalData as any)?.actionType || '';
  const approvalEntity = (n.approvalData as any)?.entityId || '';
  return `${n.notificationSubType || ''}__${n.title || ''}__${n.description || ''}__${n.targetFilter?.caseNo || ''}__${n.targetFilter?.vehicleNo || ''}__${approvalAction}__${approvalEntity}`;
}

function getStoredKeySet(storageKey: string): Set<string> {
  try {
    const arr = safeAppStorage.getJSON<string[]>(storageKey, []);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function addKeysToStoredSet(storageKey: string, keys: string[]): void {
  if (!keys || keys.length === 0) return;
  try {
    const existing = safeAppStorage.getJSON<string[]>(storageKey, []) || [];
    const merged = Array.from(new Set([...(Array.isArray(existing) ? existing : []), ...keys.filter(Boolean)]));
    // Cap stored keys at 2500 most recent entries to keep storage lightweight
    const bounded = merged.length > 2500 ? merged.slice(merged.length - 2500) : merged;
    safeAppStorage.setJSON(storageKey, bounded);
  } catch {}
}

function normalizeNotificationsList(rawItems: AppNotification[]): AppNotification[] {
  const readSet = getStoredKeySet(READ_NOTIF_KEYS_STORAGE);
  const deletedSet = getStoredKeySet(DELETED_NOTIF_KEYS_STORAGE);
  const seenContentSig = new Set<string>();
  const result: AppNotification[] = [];

  // Sort newest first before deduplicating so newest record wins while preserving RESOLVED/read state
  const sorted = [...dedupeArrayById(rawItems)].sort((a, b) => {
    const tA = (a as any).updatedAt ? new Date((a as any).updatedAt).getTime() : 0;
    const tB = (b as any).updatedAt ? new Date((b as any).updatedAt).getTime() : 0;
    if (tA && tB && tA !== tB) return tB - tA;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });

  for (const n of sorted) {
    if (isOrphanedNotification(n)) continue;
    const idKey = `id:${String(n.id)}`;
    const docKey = `doc:${String((n as any)._docId || n.id)}`;
    const sig = getNotificationReadSignature(n);
    const sigKey = `sig:${sig}`;

    if (deletedSet.has(idKey) || deletedSet.has(docKey) || deletedSet.has(sigKey)) {
      continue;
    }

    const wasMarkedRead =
      Boolean(n.read) ||
      n.status === 'RESOLVED' ||
      n.status === 'REJECTED' ||
      readSet.has(idKey) ||
      readSet.has(docKey) ||
      readSet.has(sigKey);

    const normalizedItem: AppNotification = wasMarkedRead
      ? {
          ...n,
          status: n.status === 'REJECTED' ? 'REJECTED' : 'RESOLVED',
          read: true
        }
      : n;

    // Deduplicate identical notifications regardless of PENDING/RESOLVED status so duplicates never resurface
    if (!seenContentSig.has(sig)) {
      seenContentSig.add(sig);
      result.push(normalizedItem);
    }
  }

  return result;
}

export function subscribeToNotifications(
  onData: (items: AppNotification[]) => void,
  onError?: (err: any) => void
) {
  const path = 'notifications';

  // 1. Immediately emit valid local cached notifications
  const cached = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []);
  if (cached && cached.length > 0) {
    onData(normalizeNotificationsList(cached));
  } else {
    onData([]);
  }

  // 2. Intra-window broadcast listener
  const handleLocalUpdate = () => {
    const fresh = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []);
    onData(fresh ? normalizeNotificationsList(fresh) : []);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('dpl_notification_updated', handleLocalUpdate);
  }

  // 3. Firestore live subscription
  const unsubscribeSnapshot = onSnapshot(
    collection(db, path),
    (snapshot) => {
      const items: AppNotification[] = [];
      const orphanRefsToDelete: any[] = [];
      let idx = 0;

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const numId = parseNumericDocId(d.id, docSnap.id, idx++);
        const notifObj = { ...d, id: numId, _docId: docSnap.id } as AppNotification & { _docId?: string };
        if (isOrphanedNotification(notifObj)) {
          orphanRefsToDelete.push(docSnap.ref);
        } else {
          items.push(notifObj);
        }
      });

      // Automatically purge invalid/auto-audit spam notifications from Firestore in the background
      if (orphanRefsToDelete.length > 0) {
        (async () => {
          try {
            for (let i = 0; i < orphanRefsToDelete.length; i += 400) {
              const chunk = orphanRefsToDelete.slice(i, i + 400);
              const batch = writeBatch(db);
              chunk.forEach((r) => batch.delete(r));
              await batch.commit();
            }
          } catch (_) {}
        })();
      }

      const uniqueItems = normalizeNotificationsList(items);
      safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, uniqueItems);
      onData(uniqueItems);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
    }
  );

  return () => {
    unsubscribeSnapshot();
    if (typeof window !== 'undefined') {
      window.removeEventListener('dpl_notification_updated', handleLocalUpdate);
    }
  };
}

export async function saveNotificationToFirestore(notif: AppNotification): Promise<void> {
  const path = 'notifications';
  // Use deterministic ID based on subtype+title+entity so identical auto-notifications never create duplicate docs
  const deterministicKey = `${notif.notificationSubType || 'GEN'}_${notif.title || ''}_${notif.targetFilter?.caseNo || notif.targetFilter?.vehicleNo || notif.approvalData?.entityId || ''}`;
  const isAutoAlert =
    notif.notificationSubType === 'INVOICE_CHARGE_NOTIFICATION' ||
    notif.notificationSubType === 'GATE_OUT_INVOICE' ||
    notif.notificationSubType === 'DESTINATION_ARRIVAL' ||
    notif.notificationSubType === 'DAILY_GATE_OUT_SUMMARY' ||
    notif.notificationSubType === 'DOC_EXPIRY_ALERT' ||
    notif.notificationSubType === 'HEARING_NOTICE_REMINDER' ||
    notif.notificationSubType === 'IDLE_VEHICLE_ALERT' ||
    notif.notificationSubType === 'TRANSIT_DELAY_ALERT';
  const numId = isAutoAlert
    ? parseNumericDocId(undefined, deterministicKey, 0)
    : (notif.id || parseNumericDocId(undefined, deterministicKey, 0));
  const docId = String(numId);
  const sig = getNotificationReadSignature(notif);

  // If this exact auto-generated notification was already marked read or deleted by the user, do not re-emit as unread
  if (isAutoAlert) {
    const readSet = getStoredKeySet(READ_NOTIF_KEYS_STORAGE);
    const deletedSet = getStoredKeySet(DELETED_NOTIF_KEYS_STORAGE);
    if (
      readSet.has(`sig:${sig}`) ||
      readSet.has(`doc:${docId}`) ||
      deletedSet.has(`sig:${sig}`) ||
      deletedSet.has(`doc:${docId}`)
    ) {
      return;
    }
  }

  const activeCompany = getActiveCompanyId();
  const nowIso = new Date().toISOString();
  const normalizedTargetRoles = Array.isArray((notif as any).targetRoles)
    ? (notif as any).targetRoles
    : notif.targetRole
      ? [notif.targetRole]
      : ['All'];
  const payload = sanitizeForFirestore({
    ...notif,
    companyId: (notif as any).companyId || activeCompany,
    id: numId,
    read: Boolean(notif.read),
    targetRoles: normalizedTargetRoles,
    createdAt: (notif as any).createdAt || nowIso,
    updatedAt: nowIso
  });

  // Save to local storage cache immediately so UI reacts instantly
  try {
    const current = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []) || [];
    const filtered = current.filter(n => Number(n.id) !== Number(numId) && String(n.id) !== docId);
    const updated = normalizeNotificationsList([payload as AppNotification, ...filtered]);
    safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_notification_updated', { detail: payload }));
    }
  } catch (storageErr) {
    console.warn("Storage sync error on saveNotification:", storageErr);
  }

  // Persist to Firestore without blocking caller on slow network
  setDoc(doc(db, path, docId), payload, { merge: true }).catch((error) => {
    console.warn(`Firestore saveNotification warning:`, error);
  });

  // Automatically dispatch FCM Web Push to target User IDs / Roles / Clients across mobile & desktop
  if (payload.status !== 'RESOLVED' && payload.status !== 'REJECTED' && !payload.read) {
    import('./fcmPushService')
      .then(({ dispatchPushForNotification }) => dispatchPushForNotification(payload as AppNotification))
      .catch(() => {});
  }
}

export async function updateNotificationInFirestore(notif: AppNotification): Promise<void> {
  const path = 'notifications';
  const numId = Number(notif.id);
  const docId = String((notif as any)._docId || numId);
  const nowIso = new Date().toISOString();
  const isResolved =
    notif.status === 'RESOLVED' ||
    notif.status === 'REJECTED' ||
    (notif.approvalData as any)?.status === 'APPROVED' ||
    (notif.approvalData as any)?.status === 'REJECTED' ||
    (notif as any).actionStatus === 'COMPLETED';
  const payload = sanitizeForFirestore({
    ...notif,
    read: isResolved ? true : Boolean(notif.read),
    updatedAt: nowIso,
    ...(isResolved ? { resolvedAt: (notif as any).resolvedAt || nowIso } : {})
  });
  delete (payload as any)._docId;

  // Update local storage cache and read-keys ledger immediately (0ms)
  try {
    if (isResolved || payload.read) {
      addKeysToStoredSet(READ_NOTIF_KEYS_STORAGE, [
        `id:${String(notif.id)}`,
        `doc:${docId}`,
        `sig:${getNotificationReadSignature(notif)}`
      ]);
    }
    const targetSig = getNotificationReadSignature(notif);
    const current = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []) || [];
    const updated = dedupeArrayById(
      current.map((n) => {
        const sameId = String(n.id) === String(notif.id) || String((n as any)._docId || '') === docId;
        const sameSig = isResolved && getNotificationReadSignature(n) === targetSig;
        if (sameId) return { ...n, ...payload, _docId: (n as any)._docId || docId } as AppNotification;
        if (sameSig) return { ...n, status: 'RESOLVED', read: true, updatedAt: nowIso };
        return n;
      })
    );
    safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_notification_updated', { detail: payload }));
    }
  } catch (storageErr) {
    console.warn("Storage sync error on updateNotification:", storageErr);
  }

  // Persist to Firestore without blocking UI on slow network
  const writeOp = setDoc(doc(db, path, docId), payload, { merge: true }).catch((error) => {
    console.warn(`Firestore updateNotification warning:`, error);
  });
  await Promise.race([writeOp, new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
}

/**
 * Marks one or many notifications (e.g. "Mark all read" across 100+ items) as RESOLVED & read=true
 * instantaneously in local state/storage, then commits to Firestore in chunked writeBatches (including duplicate docs).
 */
export async function markNotificationsAsReadInFirestore(items: AppNotification[]): Promise<void> {
  if (!items || items.length === 0) return;
  const path = 'notifications';
  const nowIso = new Date().toISOString();

  const keysToRecord: string[] = [];
  const targetIdSet = new Set<string>();
  const targetDocSet = new Set<string>();
  const targetSigSet = new Set<string>();

  for (const item of items) {
    const idStr = String(item.id);
    const docId = String((item as any)._docId || item.id);
    const sig = getNotificationReadSignature(item);
    targetIdSet.add(idStr);
    targetDocSet.add(docId);
    targetSigSet.add(sig);
    keysToRecord.push(`id:${idStr}`, `doc:${docId}`, `sig:${sig}`);
  }

  // 1. Synchronous 0ms local persistence & UI broadcast
  try {
    addKeysToStoredSet(READ_NOTIF_KEYS_STORAGE, keysToRecord);
    const current = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []) || [];
    const updated = current.map((n) => {
      const idStr = String(n.id);
      const docId = String((n as any)._docId || n.id);
      const sig = getNotificationReadSignature(n);
      if (targetIdSet.has(idStr) || targetDocSet.has(docId) || targetSigSet.has(sig)) {
        return { ...n, status: 'RESOLVED' as const, read: true, resolvedAt: nowIso, updatedAt: nowIso };
      }
      return n;
    });
    safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_notification_updated'));
    }
  } catch (_) {}

  // 2. Non-blocking chunked Firestore writeBatch (also sweeps any duplicate PENDING docs with matching signatures)
  (async () => {
    try {
      const docIdsToResolve = new Set<string>(Array.from(targetDocSet));
      try {
        const snap = await Promise.race([
          getDocs(collection(db, path)),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
        ]);
        if (snap) {
          snap.forEach((docSnap) => {
            const d = docSnap.data() as Partial<AppNotification>;
            const sig = getNotificationReadSignature(d);
            if (
              targetDocSet.has(docSnap.id) ||
              targetIdSet.has(String(d.id || '')) ||
              targetSigSet.has(sig)
            ) {
              if (d.status !== 'RESOLVED' || !d.read) {
                docIdsToResolve.add(docSnap.id);
              }
            }
          });
        }
      } catch (_) {}

      const allDocIds = Array.from(docIdsToResolve).filter(Boolean);
      for (let i = 0; i < allDocIds.length; i += 400) {
        const chunk = allDocIds.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const dId of chunk) {
          batch.set(
            doc(db, path, dId),
            { status: 'RESOLVED', read: true, resolvedAt: nowIso, updatedAt: nowIso },
            { merge: true }
          );
        }
        await batch.commit();
      }
    } catch (err) {
      console.warn('Firestore batch markNotificationsAsRead warning:', err);
    }
  })();
}

export async function deleteNotificationFromFirestore(notifId: number | string, rawDocId?: string): Promise<void> {
  const path = 'notifications';
  const docId = String(rawDocId || notifId);
  try {
    const current = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []) || [];
    const targetItem = current.find(
      (n) => String(n.id) === String(notifId) || String((n as any)._docId || '') === docId
    );
    const keys = [`id:${String(notifId)}`, `doc:${docId}`];
    if (targetItem) {
      keys.push(`sig:${getNotificationReadSignature(targetItem)}`);
    }
    addKeysToStoredSet(DELETED_NOTIF_KEYS_STORAGE, keys);

    const updated = current.filter(n => String(n.id) !== String(notifId) && String((n as any)._docId || '') !== docId);
    safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_notification_updated'));
    }
  } catch (_) {}

  (async () => {
    try {
      await deleteDoc(doc(db, path, docId));
      if (rawDocId && String(notifId) !== rawDocId) {
        await deleteDoc(doc(db, path, String(notifId))).catch(() => {});
      }
    } catch (err) {
      console.warn('Firestore deleteNotification warning:', err);
    }
  })();
}

export async function deleteNotificationsBatchFromFirestore(items: AppNotification[]): Promise<void> {
  if (!items || items.length === 0) return;
  const path = 'notifications';

  const keysToDelete: string[] = [];
  const idSet = new Set<string>();
  const docSet = new Set<string>();
  const sigSet = new Set<string>();

  for (const item of items) {
    const idStr = String(item.id);
    const docId = String((item as any)._docId || item.id);
    const sig = getNotificationReadSignature(item);
    idSet.add(idStr);
    docSet.add(docId);
    sigSet.add(sig);
    keysToDelete.push(`id:${idStr}`, `doc:${docId}`, `sig:${sig}`);
  }

  try {
    addKeysToStoredSet(DELETED_NOTIF_KEYS_STORAGE, keysToDelete);
    const current = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []) || [];
    const remaining = current.filter((n) => {
      const idStr = String(n.id);
      const docId = String((n as any)._docId || n.id);
      const sig = getNotificationReadSignature(n);
      return !idSet.has(idStr) && !docSet.has(docId) && !sigSet.has(sig);
    });
    safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, remaining);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_notification_updated'));
    }
  } catch (_) {}

  (async () => {
    try {
      const docIds = Array.from(docSet).filter(Boolean);
      for (let i = 0; i < docIds.length; i += 400) {
        const chunk = docIds.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const dId of chunk) {
          batch.delete(doc(db, path, dId));
        }
        await batch.commit();
      }
    } catch (err) {
      console.warn('Firestore batch deleteNotifications warning:', err);
    }
  })();
}

export async function clearAllNotificationsInFirestore(companyId?: CompanyId): Promise<void> {
  try {
    if (!companyId) {
      safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, []);
    } else {
      const current = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []) || [];
      safeAppStorage.setJSON(
        NOTIFICATIONS_STORAGE_KEY,
        current.filter(n => !matchesActiveCompany((n as any).companyId, companyId))
      );
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_notification_updated'));
    }

    const snap = await getDocs(collection(db, 'notifications'));
    if (!snap.empty) {
      const docsToDelete = companyId
        ? snap.docs.filter(d => matchesActiveCompany(d.data().companyId, companyId))
        : snap.docs;
      for (let i = 0; i < docsToDelete.length; i += 400) {
        const chunk = docsToDelete.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
  } catch (err) {
    console.warn('Firestore clearAllNotifications warning:', err);
  }
}

// ==========================================
// DATABASE AUTHENTICATION & USER MANAGEMENT
// ==========================================

export const DEFAULT_DATABASE_USERS: AppUser[] = [
  { id: 1, userId: 'Arbabkhanboby', password: 'Behzadmk@123', name: 'Arbab Khan Boby (System Administrator)', role: UserRole.ADMIN, roles: [UserRole.ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.CASE_MANAGER, UserRole.FINANCE_MANAGER], designation: 'Main Group Administrator', contact: '0300-1234567', email: 'arbabkhanboby@makgroup.com', status: 'ACTIVE', isAdmin: true, isGlobalAdmin: true, allowedCompanies: ['docks', 'muhib', 'vantage', 'truckit'], baseSalary: 0 },
  { id: 2, userId: 'finance', password: 'dpl01234', name: 'Finance Manager', role: UserRole.FINANCE_MANAGER, roles: [UserRole.FINANCE_MANAGER], designation: 'Finance Manager', contact: '0333-5554444', email: 'finance@docks.com', status: 'ACTIVE', isAdmin: false, isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit', 'muhib', 'vantage'], baseSalary: 0 },
  { id: 3, userId: 'casemanager', password: 'dpl01234', name: 'Operations Manager', role: UserRole.OPERATIONS_MANAGER, roles: [UserRole.OPERATIONS_MANAGER], designation: 'Operations Manager', contact: '0321-9876543', email: 'casemanager@docks.com', status: 'ACTIVE', isAdmin: false, isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'], baseSalary: 0 },
  { id: 4, userId: 'docmanager', password: 'dpl01234', name: 'Documentation Manager', role: UserRole.DOCUMENTATION_MANAGER, roles: [UserRole.DOCUMENTATION_MANAGER], designation: 'Documentation & Fleet Manager', contact: '0301-2233445', email: 'docs@docks.com', status: 'ACTIVE', isGlobalAdmin: false, allowedCompanies: ['truckit', 'docks'], baseSalary: 0 },
  { id: 5, userId: 'officestaff', password: 'dpl01234', name: 'Office Staff', role: UserRole.OFFICE_STAFF, roles: [UserRole.OFFICE_STAFF], designation: 'Office Staff Coordinator', contact: '0312-7788990', email: 'office@docks.com', status: 'ACTIVE', isGlobalAdmin: false, allowedCompanies: ['docks'], baseSalary: 0 },
  { id: 6, userId: 'transporter', password: 'dpl01234', name: 'Transporter Portal', role: UserRole.TRANSPORTER, roles: [UserRole.TRANSPORTER], designation: 'Goods Transporter / Fleet Partner', contact: '0300-8889999', email: 'transporter@docks.com', status: 'ACTIVE', baseSalary: 0 },
  { id: 7, userId: 'client', password: 'dpl01234', name: 'Client Portal', role: UserRole.CLIENT, roles: [UserRole.CLIENT], designation: 'Corporate Importer / Client', contact: '021-111-222-333', email: 'client@docks.com', status: 'ACTIVE', clientName: 'Al-Khaleej Importers & Shipping Lines', baseSalary: 0 },
  { id: 8, userId: 'vendor', password: 'dpl01234', name: 'Vendor Portal', role: UserRole.VENDOR, roles: [UserRole.VENDOR], designation: 'Supplier / Service Vendor', contact: '0300-5556677', email: 'vendor@docks.com', status: 'ACTIVE', clientName: 'Al-Makkah Logistics & Equipment Services', baseSalary: 0 },
  // Compatibility aliases
  { id: 9, userId: 'client01', password: 'dpl01234', name: 'Client Portal', role: UserRole.CLIENT, roles: [UserRole.CLIENT], designation: 'Corporate Importer / Client', contact: '021-111-222-333', email: 'client01@docks.com', status: 'ACTIVE', clientName: 'Al-Khaleej Importers & Shipping Lines', baseSalary: 0 },
  // Port Staff Operational Accounts
  { id: 10, userId: 'loadingstaff', password: 'dpl01234', name: 'Loading Port Staff', role: UserRole.LOADING_PORT_STAFF, roles: [UserRole.LOADING_PORT_STAFF], designation: 'Loading Port Customs Inspector', contact: '0300-4455667', email: 'loading@docks.com', status: 'ACTIVE', isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'], baseSalary: 0 },
  { id: 11, userId: 'destinationstaff', password: 'dpl01234', name: 'Destination Port Staff', role: UserRole.DESTINATION_PORT_STAFF, roles: [UserRole.DESTINATION_PORT_STAFF], designation: 'Border Terminal Customs Officer', contact: '0300-7788991', email: 'destination@docks.com', status: 'ACTIVE', isGlobalAdmin: false, allowedCompanies: ['docks'], baseSalary: 0 },
  { id: 12, userId: 'unloadingstaff', password: 'dpl01234', name: 'Unloading Port Staff', role: UserRole.UNLOADING_PORT_STAFF, roles: [UserRole.UNLOADING_PORT_STAFF], designation: 'Unloading Port Clearance Staff', contact: '0300-1122334', email: 'unloading@docks.com', status: 'ACTIVE', isGlobalAdmin: false, allowedCompanies: ['docks'], baseSalary: 0 },
  // Company Admin example: Single Company Admin (e.g. Docks only)
  { id: 13, userId: 'admin_docks', password: 'dpl01234', name: 'Docks Company Admin', role: UserRole.ADMIN, roles: [UserRole.ADMIN], designation: 'Docks Admin (Single Company)', contact: '0300-9988776', email: 'admindocks@docks.com', status: 'ACTIVE', isAdmin: true, isGlobalAdmin: false, allowedCompanies: ['docks'], baseSalary: 0 },
  // Multi-role example: Operations + Documentation Management
  { id: 14, userId: 'ops_fleet', password: 'dpl01234', name: 'Operations & Documentation Coordinator', role: UserRole.OPERATIONS_MANAGER, roles: [UserRole.OPERATIONS_MANAGER, UserRole.DOCUMENTATION_MANAGER], designation: 'Ops & Documentation Manager', contact: '0300-4433221', email: 'opsfleet@docks.com', status: 'ACTIVE', isAdmin: false, isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'], baseSalary: 0 },
  // Multi-role example: Finance + Documentation Management
  { id: 15, userId: 'fin_fleet', password: 'dpl01234', name: 'Finance & Documentation Billing', role: UserRole.FINANCE_MANAGER, roles: [UserRole.FINANCE_MANAGER, UserRole.DOCUMENTATION_MANAGER], designation: 'Finance & Documentation Manager', contact: '0300-5544332', email: 'finfleet@docks.com', status: 'ACTIVE', isAdmin: false, isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'], baseSalary: 0 }
];

let hasSeededInitialUsers = false;
const PENDING_USER_SYNCS_KEY = 'dpl_pending_user_syncs';

function normalizePhoneLookupVariants(raw?: string): string[] {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (!digits || digits.length < 7) return [];
  const variants = new Set<string>([digits]);
  if (digits.startsWith('0092') && digits.length >= 12) {
    const core = digits.slice(4);
    variants.add(`0${core}`);
    variants.add(`92${core}`);
    variants.add(core);
  } else if (digits.startsWith('92') && digits.length >= 11) {
    const core = digits.slice(2);
    variants.add(`0${core}`);
    variants.add(core);
  } else if (digits.startsWith('0') && digits.length >= 10) {
    const core = digits.slice(1);
    variants.add(`92${core}`);
    variants.add(core);
  } else if (digits.length === 10 && digits.startsWith('3')) {
    variants.add(`0${digits}`);
    variants.add(`92${digits}`);
  }
  return Array.from(variants);
}

function getPendingUserSyncMap(): Record<string, AppUser & { _docId?: string }> {
  return safeAppStorage.getJSON<Record<string, AppUser & { _docId?: string }>>(PENDING_USER_SYNCS_KEY, {}) || {};
}

function markUserPendingSync(docId: string, userObj: AppUser & { _docId?: string }) {
  try {
    const map = getPendingUserSyncMap();
    map[docId] = userObj;
    safeAppStorage.setJSON(PENDING_USER_SYNCS_KEY, map);
  } catch (_) {}
}

function clearUserPendingSync(docId: string) {
  try {
    const map = getPendingUserSyncMap();
    if (map[docId]) {
      delete map[docId];
      safeAppStorage.setJSON(PENDING_USER_SYNCS_KEY, map);
    }
  } catch (_) {}
}

/**
 * Self-heals any locally created/pending users (e.g. saved during offline blips)
 * by pushing them to Firestore `users` whenever a live snapshot confirms they are missing.
 */
async function flushPendingUsersToFirestore(cloudUsers: Array<AppUser & { _docId?: string }>): Promise<void> {
  try {
    const deletedUserKeys = new Set<string>(safeAppStorage.getJSON<string[]>('dpl_deleted_user_keys', []) || []);
    const pendingMap = getPendingUserSyncMap();
    const localStoredUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || [];

    const toSync = new Map<string, AppUser & { _docId?: string }>();

    // 1. Always retry explicit pending queue entries unless deleted
    for (const [docId, u] of Object.entries(pendingMap)) {
      const key = (u.userId || String(u.id || docId)).toLowerCase().trim();
      if (deletedUserKeys.has(key) || deletedUserKeys.has(String(u.id)) || deletedUserKeys.has(docId)) {
        clearUserPendingSync(docId);
        continue;
      }
      toSync.set(docId, u);
    }

    // 2. Self-heal any non-default local user missing from Firestore snapshot
    for (const localU of localStoredUsers) {
      const lKey = (localU.userId || String(localU.id)).toLowerCase().trim();
      const lDocId = String((localU as any)._docId || localU.id);
      if (deletedUserKeys.has(lKey) || deletedUserKeys.has(String(localU.id)) || deletedUserKeys.has(lDocId)) continue;
      if (isDefaultOrPlaceholderSystemAccount({ id: localU.id, userId: localU.userId, name: localU.name, role: localU.role })) continue;

      const existsInCloud = cloudUsers.some(
        r =>
          String((r as any)._docId || r.id) === lDocId ||
          String(r.id) === String(localU.id) ||
          (r.userId && localU.userId && r.userId.toLowerCase().trim() === localU.userId.toLowerCase().trim())
      );
      if (!existsInCloud) {
        toSync.set(lDocId, localU);
      }
    }

    if (toSync.size === 0) return;

    await Promise.allSettled(
      Array.from(toSync.entries()).map(async ([docId, userObj]) => {
        const payload = sanitizeForFirestore({
          ...userObj,
          id: Number(userObj.id) || parseNumericDocId(userObj.id, docId, 0),
          userId: (userObj.userId || '').trim(),
          updatedAt: (userObj as any).updatedAt || new Date().toISOString()
        });
        delete (payload as any)._docId;
        await setDoc(doc(db, 'users', docId), payload, { merge: true });
        clearUserPendingSync(docId);
      })
    );
  } catch (_) {}
}

let activePrefetchPromise: Promise<void> | null = null;
let lastPrefetchTimestamp = 0;

/**
 * Pre-warms Firestore connection and caches all login-eligible collections
 * (`users`, `clients`, `destination_staff`, `drivers`, `vehicles`) in parallel
 * while the user is on the Splash / Sign-In screen.
 */
export async function prefetchAuthDirectory(force = false): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (!force && activePrefetchPromise) return activePrefetchPromise;
  if (!force && Date.now() - lastPrefetchTimestamp < 15000) return;

  activePrefetchPromise = (async () => {
    try {
      const withWarmTimeout = <T>(p: Promise<T>, ms = 7500): Promise<T> =>
        Promise.race([
          p,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Prefetch timeout')), ms))
        ]);

      const [usersRes, clientsRes, destRes, driversRes, vehiclesRes] = await Promise.allSettled([
        withWarmTimeout(getDocs(collection(db, 'users'))),
        withWarmTimeout(getDocs(collection(db, 'clients'))),
        withWarmTimeout(getDocs(collection(db, 'destination_staff'))),
        withWarmTimeout(getDocs(collection(db, 'drivers'))),
        withWarmTimeout(getDocs(collection(db, 'vehicles')))
      ]);

      if (usersRes.status === 'fulfilled' && !usersRes.value.empty) {
        const deletedKeys = new Set<string>(safeAppStorage.getJSON<string[]>('dpl_deleted_user_keys', []) || []);
        const cloudUsers: AppUser[] = [];
        let idx = 0;
        usersRes.value.forEach((docSnap) => {
          const data = docSnap.data();
          const docIdStr = String(docSnap.id);
          const idLower = (data.userId || '').toLowerCase();
          const nameLower = (data.name || '').toLowerCase();
          const isDupAdmin =
            docIdStr === 'admin' ||
            docIdStr === 'arbab' ||
            docIdStr === 'behzad' ||
            docIdStr === '101' ||
            docIdStr === '102' ||
            docIdStr === '103' ||
            (nameLower.includes('arbab khan boby') && docIdStr !== '1' && ['admin', 'arbab', 'behzad'].includes(idLower));
          if (!isDupAdmin) {
            cloudUsers.push({
              ...data,
              id: parseNumericDocId(data.id, docSnap.id, idx++),
              _docId: docSnap.id
            } as AppUser & { _docId?: string });
          }
        });
        // Merge pending/local unsynced users without resurrecting deleted ones
        const localUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || [];
        const mergedMap = new Map<string, AppUser>();
        for (const u of cloudUsers) {
          const k = (u.userId || String((u as any)._docId || u.id)).toLowerCase().trim();
          mergedMap.set(k, u);
        }
        for (const lu of localUsers) {
          const k = (lu.userId || String((lu as any)._docId || lu.id)).toLowerCase().trim();
          if (deletedKeys.has(k) || deletedKeys.has(String(lu.id))) continue;
          if (!mergedMap.has(k)) mergedMap.set(k, lu);
        }
        const mergedList = Array.from(mergedMap.values());
        if (mergedList.length > 0) {
          safeAppStorage.setJSON('dpl_live_users', mergedList);
        }
        flushPendingUsersToFirestore(cloudUsers).catch(() => {});
      }

      if (clientsRes.status === 'fulfilled' && !clientsRes.value.empty) {
        const list: Client[] = [];
        clientsRes.value.forEach((d) => list.push({ ...d.data(), id: d.id } as Client));
        safeAppStorage.setJSON('dpl_cached_clients', list);
      }

      if (destRes.status === 'fulfilled' && !destRes.value.empty) {
        const list: DestinationStaff[] = [];
        destRes.value.forEach((d) => list.push({ ...d.data(), id: d.id } as DestinationStaff));
        safeAppStorage.setJSON('dpl_destination_staff', list);
      }

      if (driversRes.status === 'fulfilled' && !driversRes.value.empty) {
        const list: Driver[] = [];
        driversRes.value.forEach((d) => list.push({ ...d.data(), id: d.id } as Driver));
        safeAppStorage.setJSON('dpl_live_drivers', list);
      }

      if (vehiclesRes.status === 'fulfilled' && !vehiclesRes.value.empty) {
        const list: Vehicle[] = [];
        vehiclesRes.value.forEach((d) => list.push({ ...d.data(), id: parseNumericDocId(d.data().id, d.id, 0) } as Vehicle));
        safeAppStorage.setJSON('dpl_live_vehicles', list);
      }

      lastPrefetchTimestamp = Date.now();
    } catch (_) {
    } finally {
      activePrefetchPromise = null;
    }
  })();

  return activePrefetchPromise;
}

/**
 * Subscribes to live Firestore users collection.
 * Automatically seeds default organization accounts if Firestore users collection is empty,
 * heals any pending local-only users to Firestore, and cleans up duplicate Master Admin alias docs.
 */
export function subscribeToUsers(
  onData: (users: AppUser[]) => void,
  onError?: (err: any) => void
) {
  const path = 'users';

  // Immediately emit cached users if available so newly added staff appear right away
  const initialCached = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []);
  if (initialCached && initialCached.length > 0) {
    onData(initialCached);
  }

  const handleLocalUsersUpdate = () => {
    const latestLocal = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []);
    if (latestLocal && latestLocal.length > 0) {
      onData(latestLocal);
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('dpl_users_updated', handleLocalUsersUpdate);
  }

  const unsubSnapshot = onSnapshot(
    collection(db, path),
    async (snapshot) => {
      if (snapshot.empty && !snapshot.metadata.fromCache && !hasSeededInitialUsers) {
        hasSeededInitialUsers = true;
        try {
          for (const user of DEFAULT_DATABASE_USERS) {
            const docId = String(user.id);
            const payload = sanitizeForFirestore({
              ...user,
              id: Number(user.id),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            await setDoc(doc(db, path, docId), payload);
          }
          const localUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []);
          const mergedSeed = localUsers && localUsers.length > 0 ? localUsers : DEFAULT_DATABASE_USERS;
          safeAppStorage.setJSON('dpl_live_users', mergedSeed);
          onData(mergedSeed);
          return;
        } catch (seedErr) {
          console.warn('Failed to seed default users:', seedErr);
        }
      }

      const rawList: AppUser[] = [];
      let idx = 0;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const docIdStr = String(docSnap.id);
        const nameLower = (data.name || '').toLowerCase();
        const idLower = (data.userId || '').toLowerCase();

        // Detect duplicate Master Admin alias docs ('admin', 'arbab', 'behzad', '101', '102', '103')
        const isDuplicateAdminAlias =
          docIdStr === 'admin' ||
          docIdStr === 'arbab' ||
          docIdStr === 'behzad' ||
          docIdStr === '101' ||
          docIdStr === '102' ||
          docIdStr === '103' ||
          (nameLower.includes('arbab khan boby') && docIdStr !== '1' && ['admin', 'arbab', 'behzad'].includes(idLower));

        if (isDuplicateAdminAlias) {
          deleteDoc(doc(db, path, docSnap.id)).catch(() => {});
        } else {
          const isAdminOrDefaultPlaceholder =
            data.role === UserRole.ADMIN ||
            idLower === 'admin' ||
            nameLower.includes('administrator') ||
            isDefaultOrPlaceholderSystemAccount({
              id: data.id || docSnap.id,
              userId: data.userId,
              name: data.name,
              role: data.role
            });
          if (isAdminOrDefaultPlaceholder && Number(data.baseSalary) > 0) {
            data.baseSalary = 0;
            updateDoc(doc(db, path, docSnap.id), { baseSalary: 0 }).catch(() => {});
          }
          const uniqueNumId = parseNumericDocId(data.id, docSnap.id, idx++);
          const normalizedPrimaryRole = data.role === UserRole.VEHICLE_MANAGER ? UserRole.DOCUMENTATION_MANAGER : data.role;
          const normalizedRoles = Array.isArray(data.roles)
            ? Array.from(new Set(data.roles.map((r: any) => (r === UserRole.VEHICLE_MANAGER ? UserRole.DOCUMENTATION_MANAGER : r))))
            : undefined;
          rawList.push({
            ...data,
            userId: typeof data.userId === 'string' ? data.userId.trim() : data.userId,
            role: normalizedPrimaryRole,
            ...(normalizedRoles ? { roles: normalizedRoles } : {}),
            baseSalary: isAdminOrDefaultPlaceholder ? 0 : data.baseSalary,
            id: uniqueNumId,
            _docId: docSnap.id
          } as AppUser & { _docId?: string });
        }
      });

      // Push any pending/local-only users up to Firestore in background
      if (!snapshot.metadata.fromCache) {
        flushPendingUsersToFirestore(rawList).catch(() => {});
      }

      // Merge locally saved users from safeAppStorage ('dpl_live_users') that may not have synced to Firestore yet
      const localStoredUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || [];
      const deletedUserKeys = new Set<string>(safeAppStorage.getJSON<string[]>('dpl_deleted_user_keys', []) || []);
      for (const localU of localStoredUsers) {
        const lKey = (localU.userId || String(localU.id)).toLowerCase().trim();
        const lDocId = String((localU as any)._docId || localU.id);
        if (deletedUserKeys.has(lKey) || deletedUserKeys.has(String(localU.id)) || deletedUserKeys.has(lDocId)) continue;
        const existsInSnapshot = rawList.some(
          r =>
            String((r as any)._docId || r.id) === lDocId ||
            String(r.id) === String(localU.id) ||
            (r.userId && localU.userId && r.userId.toLowerCase().trim() === localU.userId.toLowerCase().trim())
        );
        if (!existsInSnapshot) {
          rawList.push(localU);
        }
      }

      // Deduplicate by lowercase userId (preserving newest updated record; never let stale deletedUserKeys hide live Firestore users)
      const userMap = new Map<string, AppUser>();
      rawList.sort((a, b) => Number(a.id) - Number(b.id));
      for (const u of rawList) {
        const key = (u.userId || String((u as any)._docId || u.id)).toLowerCase().trim();
        if (userMap.has(key)) {
          const existing = userMap.get(key)!;
          if ((existing as any)._docId === '1') {
            continue;
          }
          const existingTs = (existing as any).updatedAt ? new Date((existing as any).updatedAt).getTime() : 0;
          const incomingTs = (u as any).updatedAt ? new Date((u as any).updatedAt).getTime() : 0;
          if (incomingTs >= existingTs) {
            userMap.set(key, { ...existing, ...u });
          } else {
            userMap.set(key, { ...u, ...existing });
          }
        } else {
          userMap.set(key, u);
        }
      }

      const list = Array.from(userMap.values());
      const finalUsers = list.length > 0 ? list : DEFAULT_DATABASE_USERS;
      safeAppStorage.setJSON('dpl_live_users', finalUsers);
      onData(finalUsers);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const fallbackLocal = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []);
      onData(fallbackLocal && fallbackLocal.length > 0 ? fallbackLocal : DEFAULT_DATABASE_USERS);
    }
  );

  return () => {
    unsubSnapshot();
    if (typeof window !== 'undefined') {
      window.removeEventListener('dpl_users_updated', handleLocalUsersUpdate);
    }
  };
}

/**
 * Authenticates credentials directly against Firestore database records.
 * Supports matching by User ID (e.g. 'ADMIN', 'EMP-0001', 'CLT-001'), Email, or Name.
 */
export async function authenticateDatabaseUser(
  identifier: string,
  pass: string
): Promise<AppUser> {
  const rawId = (identifier || '').trim();
  const rawPass = (pass || '').trim();
  const cleanId = rawId.toLowerCase();
  const cleanIdNoSpaces = cleanId.replace(/[\s\-_.]/g, '');
  const cleanPass = rawPass;

  if (!cleanId || !cleanPass) {
    throw new Error('Please provide both user identification and password.');
  }

  // Master Admin Credentials verification (supports user password Behzadmk@123 and variants)
  const isMasterAdminPass = 
    cleanPass === 'Behzadmk@123' || 
    cleanPass === 'Behsadmk@123' || 
    cleanPass.toLowerCase() === 'behzadmk@123' ||
    cleanPass.toLowerCase() === 'behsadmk@123' ||
    cleanPass.toLowerCase() === 'behzadmk123' ||
    cleanPass.toLowerCase() === 'behsadmk123' ||
    cleanPass.toLowerCase() === 'behzadmk' ||
    cleanPass.toLowerCase() === 'behsadmk' ||
    cleanPass.toLowerCase() === 'behzad' ||
    cleanPass.toLowerCase() === 'behsad' ||
    cleanPass === 'dpl01234';

  const isMasterAdminId = 
    cleanId === 'arbabkhanboby' ||
    cleanId === 'arbab' ||
    cleanId === 'arbabkhan' ||
    cleanId === 'boby' ||
    cleanId === 'admin' ||
    cleanId === 'administrator' ||
    cleanId === 'behzad' ||
    cleanId === 'behzadmk' ||
    cleanId === 'behsad' ||
    cleanId === 'behsadmk' ||
    cleanId === 'arbab khan' ||
    cleanId === 'arbab khan boby' ||
    cleanId === 'docks.live.app@gmail.com' ||
    cleanId === 'arbabkhanboby@makgroup.com' ||
    cleanIdNoSpaces === 'arbabkhanboby' ||
    cleanIdNoSpaces === 'arbabkhan' ||
    cleanIdNoSpaces === 'arbab' ||
    cleanIdNoSpaces === 'boby' ||
    cleanIdNoSpaces === 'admin' ||
    cleanIdNoSpaces === 'behzad' ||
    cleanIdNoSpaces === 'behzadmk' ||
    cleanIdNoSpaces === 'behsad' ||
    cleanIdNoSpaces === 'behsadmk';

  try {
    // 0. Primary Administrator Master Credentials check
    if (isMasterAdminId && isMasterAdminPass) {
      const adminMasterUser: AppUser = {
        id: 1,
        userId: 'Arbabkhanboby',
        password: 'Behzadmk@123',
        name: 'Arbab Khan Boby (System Administrator)',
        role: UserRole.ADMIN,
        roles: [UserRole.ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.CASE_MANAGER, UserRole.FINANCE_MANAGER],
        designation: 'Main Group Administrator',
        contact: '0300-1234567',
        email: 'arbabkhanboby@makgroup.com',
        status: 'ACTIVE',
        isAdmin: true,
        isGlobalAdmin: true,
        allowedCompanies: ['docks', 'muhib', 'vantage', 'truckit'],
        baseSalary: 0,
        lastLogin: new Date().toISOString(),
        authProvider: 'database'
      };

      saveActiveDbUserSession(adminMasterUser);
      // Persist ONLY the single canonical Master Admin document ('1') and clean up any legacy duplicate alias docs
      Promise.allSettled([
        setDoc(doc(db, 'users', '1'), sanitizeForFirestore(adminMasterUser), { merge: true }),
        deleteDoc(doc(db, 'users', 'admin')),
        deleteDoc(doc(db, 'users', 'arbab')),
        deleteDoc(doc(db, 'users', 'behzad')),
        deleteDoc(doc(db, 'users', '101')),
        deleteDoc(doc(db, 'users', '102')),
        deleteDoc(doc(db, 'users', '103'))
      ]).catch(() => {});

      return adminMasterUser;
    }

    const withAuthTimeout = <T>(p: Promise<T>, ms = 8500): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore auth query timeout')), ms))
      ]);

    const doesPassMatch = (storedRaw: string | undefined): boolean => {
      const sp = (storedRaw || '').trim();
      if (!sp) return false;
      return (
        sp === cleanPass ||
        sp.toLowerCase() === cleanPass.toLowerCase() ||
        sp.toLowerCase().replace(/[\s\-_.]/g, '') === cleanPass.toLowerCase().replace(/[\s\-_.]/g, '')
      );
    };

    const identifierPhoneVariants = new Set(normalizePhoneLookupVariants(rawId));

    const matchesContactPhone = (contactRaw?: string, altRaw?: string): boolean => {
      if (identifierPhoneVariants.size === 0) return false;
      const variants = [
        ...normalizePhoneLookupVariants(contactRaw),
        ...normalizePhoneLookupVariants(altRaw)
      ];
      return variants.some((v) => identifierPhoneVariants.has(v));
    };

    const scoreUserMatch = (u: Partial<AppUser>, sourcePriority = 0): number => {
      const uIdLower = (u.userId || '').toLowerCase().trim();
      const uIdNoSpaces = uIdLower.replace(/[\s\-_.]/g, '');
      const uEmailLower = (u.email || '').toLowerCase().trim();
      const uContactClean = (u.contact || '').toLowerCase().replace(/[\s\-_.]/g, '');
      const uNameLower = (u.name || '').toLowerCase().trim();

      let idScore = 0;
      if (uIdLower && (uIdLower === cleanId || (cleanIdNoSpaces && uIdNoSpaces === cleanIdNoSpaces))) {
        idScore = 150;
      } else if (uEmailLower && uEmailLower === cleanId) {
        idScore = 125;
      } else if (
        (uContactClean && cleanIdNoSpaces.length >= 7 && uContactClean === cleanIdNoSpaces) ||
        matchesContactPhone(u.contact, (u as any).whatsappNumber || (u as any).mobileNumber || (u as any).phone)
      ) {
        idScore = 115;
      } else if (uIdLower && matchesContactPhone(u.userId)) {
        idScore = 135;
      } else if (uNameLower && (uNameLower === cleanId || (cleanIdNoSpaces.length >= 3 && uNameLower.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces))) {
        idScore = 90;
      }

      if (idScore === 0) return 0;
      const passBonus = doesPassMatch(u.password) ? 250 : 0;
      const activeBonus = u.status !== 'PENDING_APPROVAL' && u.status !== 'SUSPENDED' ? 20 : 0;
      return idScore + passBonus + activeBonus + sourcePriority;
    };

    // 1. Collect candidates across ALL auth-eligible local caches + live Firestore collections IN PARALLEL
    let matchedUser: AppUser | null = null;
    let bestScore = 0;
    let expiredTripIdNotice: string | null = null;

    const considerCandidate = (candidate: AppUser, sourcePriority = 0) => {
      const sc = scoreUserMatch(candidate, sourcePriority);
      if (sc > 0 && sc >= bestScore) {
        const existingTs = matchedUser && (matchedUser as any).updatedAt
          ? new Date((matchedUser as any).updatedAt).getTime()
          : 0;
        const candTs = (candidate as any).updatedAt
          ? new Date((candidate as any).updatedAt).getTime()
          : 0;
        if (sc > bestScore || candTs >= existingTs) {
          bestScore = sc;
          matchedUser = candidate;
        }
      }
    };

    const toClientCandidate = (client: any, fallbackId: string): AppUser | null => {
      if (!client) return null;
      if (!(client.loginEnabled || (client.userId && client.password))) return null;
      return {
        id: (client.id || fallbackId) as any,
        _clientDocId: fallbackId,
        userId: client.userId || client.mobileNumber || client.contact || '',
        password: client.password || '',
        name: client.name || client.ownerName || 'Client',
        role: client.role || UserRole.CLIENT,
        roles: client.roles || [UserRole.CLIENT],
        designation: 'Corporate Importer / Client',
        contact: client.contact || client.mobileNumber || client.phone || '',
        whatsappNumber: client.whatsappNumber || '',
        mobileNumber: client.mobileNumber || '',
        email: client.email || '',
        status: client.status || 'ACTIVE',
        clientName: client.name,
        allowedCompanies: client.allowedCompanies || ['docks', 'truckit', 'muhib', 'vantage'],
        lastLogin: client.lastLogin || '',
        updatedAt: client.updatedAt || client.createdAt || ''
      } as unknown as AppUser;
    };

    const toDestStaffCandidate = (ds: any, fallbackId: string): AppUser | null => {
      if (!ds) return null;
      if (ds.loginEnabled === false) return null;
      if (!ds.password && !ds.userId) return null;
      const singleRole = (Array.isArray(ds.roles) && ds.roles[0]) || UserRole.DESTINATION_PORT_STAFF;
      return {
        id: (ds.id || fallbackId) as any,
        _destStaffDocId: fallbackId,
        userId: ds.userId || ds.phone || ds.contact || '',
        password: ds.password || DEFAULT_USER_PASSWORD,
        name: ds.name || 'Destination Staff',
        role: singleRole,
        roles: Array.isArray(ds.roles) && ds.roles.length > 0 ? ds.roles : [singleRole],
        designation: `${ds.role || 'Port Staff'} (${ds.station || 'Station'})`,
        assignedStation: ds.station || '',
        contact: ds.phone || ds.contact || '',
        email: ds.email || '',
        status: ds.status === 'INACTIVE' || ds.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
        allowedCompanies: ds.allowedCompanies || ['docks', 'truckit', 'muhib', 'vantage'],
        updatedAt: ds.updatedAt || ds.createdAt || ''
      } as unknown as AppUser;
    };

    const checkDriverMatch = (drv: any, fallbackId?: string): AppUser | null => {
      if (!drv) return null;
      const dUserId = (drv.userId || '').toLowerCase().trim();
      const dExpiredId = (drv.lastExpiredTripId || '').toLowerCase().trim();
      const dPhone = (drv.contact || '').toLowerCase().trim();
      const dName = (drv.name || '').toLowerCase().trim();
      const dVeh = (drv.assignedVehicleNo || '').toLowerCase().trim();

      const matchUserId = dUserId && (dUserId === cleanId || dUserId.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces);
      const matchExpiredId = dExpiredId && (dExpiredId === cleanId || dExpiredId.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces);
      const matchPhone =
        (dPhone && (dPhone === cleanId || dPhone.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces)) ||
        matchesContactPhone(drv.contact);
      const matchVeh = dVeh && dVeh === cleanId;
      const matchName = dName && dName === cleanId;

      if (matchUserId || matchExpiredId || matchPhone || matchVeh || matchName) {
        if (
          drv.driverLoginStatus === 'SUSPENDED_TRIP_COMPLETED' ||
          drv.driverLoginStatus === 'EXPIRED' ||
          drv.loginEnabled === false ||
          matchExpiredId
        ) {
          expiredTripIdNotice = `This Driver Trip Login ID (${drv.lastExpiredTripId || drv.userId || identifier}) has been automatically suspended/expired after trip completion & unloading at destination. Driver permanent data is saved — please generate a new Trip ID & Password for the next trip.`;
          return null;
        }

        if (drv.password) {
          return {
            id: (drv.id || fallbackId || Date.now()) as any,
            userId: drv.userId || drv.contact || drv.name,
            password: drv.password,
            name: drv.name || 'Trip Driver',
            role: UserRole.DRIVER,
            roles: [UserRole.DRIVER],
            designation: `Trip Driver (${drv.assignedVehicleNo || 'Assigned Vehicle'})`,
            contact: drv.contact || '',
            email: '',
            status: 'ACTIVE',
            clientName: drv.transporterName || 'Transporter',
            assignedVehicleNo: drv.assignedVehicleNo || ''
          } as unknown as AppUser;
        }
      }
      return null;
    };

    const checkVehicleDriverMatch = (veh: any): AppUser | null => {
      if (!veh) return null;
      const vUserId = (veh.driverUserId || '').toLowerCase().trim();
      const vExpiredId = (veh.lastExpiredTripId || '').toLowerCase().trim();
      const matchUserId = vUserId && (vUserId === cleanId || vUserId.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces);
      const matchExpiredId = vExpiredId && (vExpiredId === cleanId || vExpiredId.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces);

      if (matchUserId || matchExpiredId) {
        if (
          veh.driverLoginStatus === 'SUSPENDED_TRIP_COMPLETED' ||
          veh.driverLoginStatus === 'EXPIRED' ||
          matchExpiredId
        ) {
          expiredTripIdNotice = `This Driver Trip Login ID (${veh.lastExpiredTripId || veh.driverUserId || identifier}) for vehicle ${veh.registrationNumber} has been automatically expired/blocked because the trip finished & container was unloaded at destination. A new Trip ID & Password is required for the next trip.`;
          return null;
        }

        if (veh.driverPassword) {
          return {
            id: (veh.id || Date.now()) as any,
            userId: veh.driverUserId,
            password: veh.driverPassword,
            name: veh.driverName || 'Trip Driver',
            role: UserRole.DRIVER,
            roles: [UserRole.DRIVER],
            designation: `Trip Driver (${veh.registrationNumber || 'Assigned Vehicle'})`,
            contact: veh.driverContact || '',
            email: '',
            status: 'ACTIVE',
            clientName: veh.transporterName || 'Transporter',
            assignedVehicleNo: veh.registrationNumber || ''
          } as unknown as AppUser;
        }
      }
      return null;
    };

    // 1A. Scan ALL local caches immediately (0ms)
    const localLiveUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || [];
    for (const lu of localLiveUsers) {
      considerCandidate(lu, 4);
    }

    const localClients = [
      ...(safeAppStorage.getJSON<any[]>('dpl_cached_clients', []) || []),
      ...(safeAppStorage.getJSON<any[]>('dpl_live_clients', []) || [])
    ];
    for (const lc of localClients) {
      const cCand = toClientCandidate(lc, String(lc.id || lc.name || 'client'));
      if (cCand) considerCandidate(cCand, 3);
    }

    const localDestStaff = safeAppStorage.getJSON<DestinationStaff[]>('dpl_destination_staff', []) || [];
    for (const ds of localDestStaff) {
      const dsCand = toDestStaffCandidate(ds, String(ds.id || 'dest'));
      if (dsCand) considerCandidate(dsCand, 3);
    }

    const localDrivers = safeAppStorage.getJSON<Driver[]>('dpl_live_drivers', []) || [];
    for (const d of localDrivers) {
      const m = checkDriverMatch(d, d.id);
      if (m) considerCandidate(m, 3);
    }

    const localVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []) || [];
    for (const v of localVehicles) {
      const m = checkVehicleDriverMatch(v);
      if (m) considerCandidate(m, 3);
    }

    // 1B. Query live Firestore collections IN PARALLEL (never sequential 2s cutoffs!)
    const [usersSnapRes, clientsSnapRes, destSnapRes, driversSnapRes, vehiclesSnapRes] = await Promise.allSettled([
      withAuthTimeout(getDocs(collection(db, 'users')), 8500),
      withAuthTimeout(getDocs(collection(db, 'clients')), 8500),
      withAuthTimeout(getDocs(collection(db, 'destination_staff')), 8500),
      withAuthTimeout(getDocs(collection(db, 'drivers')), 8500),
      withAuthTimeout(getDocs(collection(db, 'vehicles')), 8500)
    ]);

    let cloudUsersSucceeded = false;
    let anyCloudReadSucceeded = false;

    if (usersSnapRes.status === 'fulfilled') {
      cloudUsersSucceeded = true;
      anyCloudReadSucceeded = true;
      const cloudUsersList: AppUser[] = [];
      let idx = 0;
      usersSnapRes.value.forEach((docSnap) => {
        const u = docSnap.data() as AppUser;
        const normalized: AppUser & { _docId?: string } = {
          ...u,
          userId: typeof u.userId === 'string' ? u.userId.trim() : u.userId,
          id: parseNumericDocId(u.id, docSnap.id, idx++),
          _docId: docSnap.id
        };
        cloudUsersList.push(normalized);
        considerCandidate(normalized, 8);
      });
      if (cloudUsersList.length > 0) {
        safeAppStorage.setJSON('dpl_live_users', cloudUsersList);
      }
    } else {
      console.log('Firestore users query timed out or offline, using synced local credentials.');
    }

    if (clientsSnapRes.status === 'fulfilled') {
      anyCloudReadSucceeded = true;
      const cloudClients: Client[] = [];
      clientsSnapRes.value.forEach((docSnap) => {
        const data = docSnap.data();
        cloudClients.push({ ...data, id: docSnap.id } as Client);
        const cCand = toClientCandidate(data, docSnap.id);
        if (cCand) considerCandidate(cCand, 7);
      });
      if (cloudClients.length > 0) {
        safeAppStorage.setJSON('dpl_cached_clients', cloudClients);
      }
    }

    if (destSnapRes.status === 'fulfilled') {
      anyCloudReadSucceeded = true;
      const cloudDest: DestinationStaff[] = [];
      destSnapRes.value.forEach((docSnap) => {
        const data = docSnap.data();
        cloudDest.push({ ...data, id: docSnap.id } as DestinationStaff);
        const dsCand = toDestStaffCandidate(data, docSnap.id);
        if (dsCand) considerCandidate(dsCand, 7);
      });
      if (cloudDest.length > 0) {
        safeAppStorage.setJSON('dpl_destination_staff', cloudDest);
      }
    }

    if (driversSnapRes.status === 'fulfilled') {
      anyCloudReadSucceeded = true;
      const cloudDrivers: Driver[] = [];
      driversSnapRes.value.forEach((docSnap) => {
        const data = docSnap.data();
        cloudDrivers.push({ ...data, id: docSnap.id } as Driver);
        const m = checkDriverMatch(data, docSnap.id);
        if (m) considerCandidate(m, 7);
      });
      if (cloudDrivers.length > 0) {
        safeAppStorage.setJSON('dpl_live_drivers', cloudDrivers);
      }
    }

    if (vehiclesSnapRes.status === 'fulfilled') {
      anyCloudReadSucceeded = true;
      vehiclesSnapRes.value.forEach((docSnap) => {
        const m = checkVehicleDriverMatch(docSnap.data());
        if (m) considerCandidate(m, 7);
      });
    }

    if (!matchedUser && expiredTripIdNotice) {
      throw new Error(expiredTripIdNotice);
    }

    // 2. Fallback to default catalog if database is offline or default user not yet seeded in Firestore
    if (!matchedUser) {
      const foundInDefault = DEFAULT_DATABASE_USERS.find(
        (u) => {
          const uId = (u.userId || '').toLowerCase();
          const uIdNoSpaces = uId.replace(/[\s\-_.]/g, '');
          const uEmail = (u.email || '').toLowerCase();
          const uName = (u.name || '').toLowerCase();

          return (
            uId === cleanId ||
            uIdNoSpaces === cleanIdNoSpaces ||
            uEmail === cleanId ||
            uName === cleanId ||
            (cleanId.length >= 3 && (uName.includes(cleanId) || uId.includes(cleanId)))
          );
        }
      );
      if (foundInDefault) {
        matchedUser = foundInDefault;
      }
    }

    if (!matchedUser) {
      if (!cloudUsersSucceeded && !anyCloudReadSucceeded) {
        throw new Error('Unable to reach the cloud database right now (network timeout). Please check your internet connection and tap Sign In again.');
      }
      throw new Error(`No database account found matching "${identifier}".`);
    }

    // 3. Verify status
    if (matchedUser.status === 'PENDING_APPROVAL') {
      throw new Error('Your client registration request is currently pending verification and approval by the Finance Manager / Administration. Access will be activated upon approval.');
    }
    if (matchedUser.status === 'SUSPENDED' || (matchedUser as any).isSuspended) {
      throw new Error('This account has been suspended by the administrator. Login access is currently blocked. Please contact system administration for assistance.');
    }
    if (matchedUser.status === 'INACTIVE') {
      throw new Error('This database account is currently marked as INACTIVE. Please contact administration.');
    }

    // 4. Verify password with case tolerance & master recovery check
    const isMatchedAdminAccount = 
      matchedUser.id === 1 || 
      matchedUser.isAdmin === true ||
      matchedUser.isGlobalAdmin === true ||
      matchedUser.role === UserRole.ADMIN ||
      (matchedUser.roles && matchedUser.roles.includes(UserRole.ADMIN)) ||
      (matchedUser.userId && (
        matchedUser.userId.toLowerCase().includes('arbab') ||
        matchedUser.userId.toLowerCase().includes('admin') ||
        matchedUser.userId.toLowerCase().includes('behzad') ||
        matchedUser.userId.toLowerCase().includes('behsad')
      ));

    const storedPass = (matchedUser.password || '').trim();
    const matchesStoredPass = 
      storedPass === cleanPass || 
      storedPass.toLowerCase() === cleanPass.toLowerCase() ||
      (storedPass.toLowerCase().replace(/[\s\-_.]/g, '') === cleanPass.toLowerCase().replace(/[\s\-_.]/g, ''));

    const isPasswordValid = 
      matchesStoredPass || 
      (isMatchedAdminAccount && isMasterAdminPass);

    if (!isPasswordValid) {
      throw new Error('Incorrect password. Please verify your credentials.');
    }

    // 5. Update lastLogin and persist active database session
    const userRoles = (matchedUser.roles && matchedUser.roles.length > 0) ? matchedUser.roles : [matchedUser.role];
    const hasAdminRole = Boolean(
      matchedUser.isGlobalAdmin ||
      matchedUser.isAdmin ||
      matchedUser.role === UserRole.ADMIN ||
      userRoles.includes(UserRole.ADMIN)
    );
    const rawAllowed = (matchedUser as any).allowedCompanies;
    const effectiveAllowedCompanies: string[] = Array.isArray(rawAllowed) && rawAllowed.length > 0
      ? rawAllowed
      : (matchedUser.isGlobalAdmin ? ['docks', 'truckit', 'muhib', 'vantage'] : ['docks']);

    const effectiveIsGlobalAdmin = Boolean(
      matchedUser.isGlobalAdmin ||
      (hasAdminRole && effectiveAllowedCompanies.length >= 4)
    );

    const updatedUser: AppUser = {
      ...matchedUser,
      isAdmin: hasAdminRole,
      isGlobalAdmin: effectiveIsGlobalAdmin,
      allowedCompanies: effectiveAllowedCompanies,
      lastLogin: new Date().toISOString(),
      authProvider: 'database'
    };

    saveActiveDbUserSession(updatedUser);

    // Record lastLogin asynchronously in background — NEVER block user sign-in transition
    (async () => {
      try {
        if ((matchedUser as any)._clientDocId) {
          await setDoc(
            doc(db, 'clients', String((matchedUser as any)._clientDocId)),
            sanitizeForFirestore({ lastLogin: updatedUser.lastLogin }),
            { merge: true }
          );
        } else if ((matchedUser as any)._destStaffDocId) {
          await setDoc(
            doc(db, 'destination_staff', String((matchedUser as any)._destStaffDocId)),
            sanitizeForFirestore({ lastLogin: updatedUser.lastLogin }),
            { merge: true }
          );
        } else if (updatedUser.role === UserRole.CLIENT) {
          await setDoc(
            doc(db, 'clients', String(updatedUser.id)),
            sanitizeForFirestore({ lastLogin: updatedUser.lastLogin }),
            { merge: true }
          );
        } else {
          const targetDocId = String((matchedUser as any)._docId || updatedUser.id);
          const cleanRecord = sanitizeForFirestore({ ...updatedUser });
          delete (cleanRecord as any)._docId;
          await setDoc(doc(db, 'users', targetDocId), cleanRecord, { merge: true });
        }
      } catch (saveErr) {
        console.warn('Could not record lastLogin in Firestore:', saveErr);
      }
    })();

    return updatedUser;
  } catch (err: any) {
    console.error('Database authentication error:', err);
    throw err;
  }
}

/**
 * Links and synchronizes a Google Firebase Auth user with a Firestore Database User record.
 */
export async function syncFirebaseUserToDatabase(
  firebaseUser: any,
  assignedRole?: UserRole
): Promise<AppUser> {
  const email = (firebaseUser.email || '').toLowerCase();
  const isAdminEmail = email === 'makeyourflyeasy@gmail.com' || email.includes('admin') || email.includes('ceo');
  const role = assignedRole || (isAdminEmail ? UserRole.ADMIN : UserRole.CLIENT);
  
  const dbUser: AppUser = {
    id: Date.now(),
    uid: firebaseUser.uid,
    userId: isAdminEmail ? 'ADMIN-GOOGLE' : `USR-${firebaseUser.uid.slice(0, 6).toUpperCase()}`,
    name: firebaseUser.displayName || 'Google User',
    email: firebaseUser.email || '',
    contact: firebaseUser.phoneNumber || '',
    role,
    status: 'ACTIVE',
    profilePicture: firebaseUser.photoURL || undefined,
    lastLogin: new Date().toISOString(),
    authProvider: 'google',
    isAdmin: role === UserRole.ADMIN
  };

  try {
    const docId = `auth_${firebaseUser.uid}`;
    await setDoc(doc(db, 'users', docId), sanitizeForFirestore(dbUser), { merge: true });
  } catch (err) {
    console.warn('Could not persist Google user to Firestore users:', err);
  }

  saveActiveDbUserSession(dbUser);
  return dbUser;
}

export async function saveUserToFirestore(user: AppUser): Promise<void> {
  const path = 'users';
  const rawDocId = (user as any)._docId;
  const docId = String(rawDocId || user.id || Date.now());
  const numericId = Number(user.id) || parseNumericDocId(user.id, docId, 0);
  const cleanUserId = typeof user.userId === 'string' ? user.userId.trim() : user.userId;
  const payload = sanitizeForFirestore({
    ...user,
    id: numericId,
    userId: cleanUserId,
    updatedAt: new Date().toISOString()
  });
  delete (payload as any)._docId;

  const fullLocalRecord = { ...(payload as AppUser), _docId: docId } as AppUser & { _docId?: string };

  // 1. Immediately persist in local safeAppStorage ('dpl_live_users') + pending sync queue
  try {
    const deletedKeys = (safeAppStorage.getJSON<string[]>('dpl_deleted_user_keys', []) || []).filter(
      k => k !== String(numericId) && k !== docId && k !== (cleanUserId || '').toLowerCase().trim()
    );
    safeAppStorage.setJSON('dpl_deleted_user_keys', deletedKeys);

    const existingUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', DEFAULT_DATABASE_USERS) || [];
    const userKey = (cleanUserId || String(numericId)).toLowerCase().trim();
    const matchedExisting = existingUsers.find(
      u =>
        String(u.id) === String(numericId) ||
        String((u as any)._docId || '') === docId ||
        (u.userId || '').toLowerCase().trim() === userKey
    );
    if (matchedExisting && payload.fcmTokens === undefined && Array.isArray(matchedExisting.fcmTokens)) {
      payload.fcmTokens = matchedExisting.fcmTokens;
    }
    if (matchedExisting && payload.pushNotificationsEnabled === undefined && matchedExisting.pushNotificationsEnabled !== undefined) {
      payload.pushNotificationsEnabled = matchedExisting.pushNotificationsEnabled;
    }
    const filtered = existingUsers.filter(
      u =>
        String(u.id) !== String(numericId) &&
        String((u as any)._docId || '') !== docId &&
        (u.userId || '').toLowerCase().trim() !== userKey
    );
    const updatedList = [...filtered, fullLocalRecord];
    safeAppStorage.setJSON('dpl_live_users', updatedList);
    markUserPendingSync(docId, fullLocalRecord);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_users_updated', { detail: payload }));
    }
  } catch (_) {}

  // 2. Persist reliably to Firestore with a 10s bounded wait (never drop at 1.8s)
  try {
    await Promise.race([
      setDoc(doc(db, path, docId), payload, { merge: true }).then(() => {
        clearUserPendingSync(docId);
      }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Cloud user write timeout')), 10000)
      )
    ]);
  } catch (error) {
    console.warn('Firestore saveUser queued for background sync:', error);
  }
}

/**
 * Synchronizes status or credentials changes from Client / Transporter / Destination Staff approvals
 * back into the `users` collection so login state always stays consistent across all devices.
 */
export async function syncLinkedUserAccountStatus(params: {
  userId?: string;
  docIdHint?: string;
  contact?: string;
  clientName?: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_APPROVAL' | 'INACTIVE';
  password?: string;
}): Promise<void> {
  try {
    const cleanUid = (params.userId || '').toLowerCase().trim();
    const cleanClient = (params.clientName || '').toLowerCase().trim();
    const phoneVariants = new Set(normalizePhoneLookupVariants(params.contact));

    const matchUser = (u: any): boolean => {
      if (params.docIdHint && String(u._docId || u.id) === params.docIdHint) return true;
      if (cleanUid && (u.userId || '').toLowerCase().trim() === cleanUid) return true;
      if (cleanClient && (u.clientName || '').toLowerCase().trim() === cleanClient) return true;
      if (phoneVariants.size > 0 && normalizePhoneLookupVariants(u.contact).some(v => phoneVariants.has(v))) return true;
      return false;
    };

    const patch: Record<string, any> = {
      status: params.status,
      isSuspended: params.status === 'SUSPENDED',
      updatedAt: new Date().toISOString(),
      ...(params.password ? { password: params.password.trim() } : {})
    };

    // Update local cache
    const localUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || [];
    let updatedAnyLocal = false;
    const nextLocal = localUsers.map((u) => {
      if (matchUser(u)) {
        updatedAnyLocal = true;
        return { ...u, ...patch } as AppUser;
      }
      return u;
    });
    if (updatedAnyLocal) {
      safeAppStorage.setJSON('dpl_live_users', nextLocal);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dpl_users_updated'));
    }

    // Update Firestore `users` docs matching this record
    const snap = await executeWithTimeout(getDocs(collection(db, 'users')), 7000, null);
    if (snap) {
      const updates: Promise<any>[] = [];
      snap.forEach((docSnap) => {
        const d = { ...docSnap.data(), _docId: docSnap.id };
        if (matchUser(d)) {
          updates.push(setDoc(doc(db, 'users', docSnap.id), sanitizeForFirestore(patch), { merge: true }));
        }
      });
      if (updates.length > 0) {
        await Promise.allSettled(updates);
      }
    }
  } catch (err) {
    console.warn('syncLinkedUserAccountStatus warning:', err);
  }
}

export async function deleteUserFromFirestore(
  userId: number | string,
  rawDocId?: string,
  userLoginId?: string
): Promise<void> {
  const path = 'users';
  // Immediately remove from local safeAppStorage ('dpl_live_users')
  try {
    const deletedKeys = new Set<string>(safeAppStorage.getJSON<string[]>('dpl_deleted_user_keys', []) || []);
    deletedKeys.add(String(userId));
    if (rawDocId) deletedKeys.add(String(rawDocId));
    if (userLoginId) deletedKeys.add(String(userLoginId).toLowerCase().trim());
    safeAppStorage.setJSON('dpl_deleted_user_keys', Array.from(deletedKeys));

    const existingUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || [];
    const remaining = existingUsers.filter(u => {
      if (String(u.id) === String(userId)) return false;
      if (rawDocId && String((u as any)._docId || '') === String(rawDocId)) return false;
      if (userLoginId && u.userId && u.userId.toLowerCase().trim() === userLoginId.toLowerCase().trim()) return false;
      return true;
    });
    safeAppStorage.setJSON('dpl_live_users', remaining);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_users_updated'));
    }
  } catch (_) {}

  try {
    await deleteDoc(doc(db, path, String(userId))).catch(() => {});
    if (rawDocId && String(rawDocId) !== String(userId)) {
      await deleteDoc(doc(db, path, String(rawDocId))).catch(() => {});
    }
    if (userLoginId) {
      await deleteDoc(doc(db, path, String(userLoginId))).catch(() => {});
    }
    // Also remove any document in 'users' whose internal id or userId matches
    const snap = await getDocs(collection(db, path));
    const docsToRemove: any[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const matchById = String(data.id) === String(userId) || String(d.id) === String(userId);
      const matchByRawDoc = rawDocId && String(d.id) === String(rawDocId);
      const matchByLoginId =
        userLoginId &&
        data.userId &&
        String(data.userId).toLowerCase().trim() === String(userLoginId).toLowerCase().trim();
      if (matchById || matchByRawDoc || matchByLoginId) {
        docsToRemove.push(d.ref);
      }
    });
    for (const ref of docsToRemove) {
      await deleteDoc(ref).catch(() => {});
    }
  } catch (error) {
    console.warn(`Firestore deleteUser warning:`, error);
  }
}

export async function saveUserProfile(user: AppUser): Promise<void> {
  return saveUserToFirestore(user);
}

export async function getUserProfile(userId: string): Promise<AppUser | null> {
  const path = 'users';
  try {
    const docSnap = await getDoc(doc(db, path, String(userId)));
    if (docSnap.exists()) {
      return docSnap.data() as AppUser;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// CLIENTS
export const DEFAULT_CLIENTS: string[] = [];

function normalizeClientKey(name?: string): string {
  return (name || '')
    .trim()
    .toUpperCase()
    .replace(/[.,\-_/()]/g, ' ')
    .replace(/\s+/g, ' ');
}

function mergeClientRecords(primary: Client, secondary: Client): Client {
  const pickStr = (a?: string, b?: string) => (a && a.trim() ? a : b && b.trim() ? b : '');
  const pickCharges = (a?: any[], b?: any[]) => (Array.isArray(a) && a.length > 0 ? a : Array.isArray(b) && b.length > 0 ? b : []);
  const pickObj = (a?: Record<string, any>, b?: Record<string, any>) =>
    a && Object.keys(a).length > 0 ? a : b && Object.keys(b).length > 0 ? b : {};

  return {
    ...secondary,
    ...primary,
    id: primary.id || secondary.id,
    name: pickStr(primary.name, secondary.name),
    ownerName: pickStr(primary.ownerName, secondary.ownerName),
    contact: pickStr(primary.contact, secondary.contact),
    officeAddress: pickStr(primary.officeAddress, secondary.officeAddress),
    mobileNumber: pickStr(primary.mobileNumber, secondary.mobileNumber),
    whatsappNumber: pickStr(primary.whatsappNumber, secondary.whatsappNumber),
    email: pickStr(primary.email, secondary.email),
    cnic: pickStr(primary.cnic, secondary.cnic),
    ntn: pickStr(primary.ntn, secondary.ntn),
    strn: pickStr(primary.strn, secondary.strn),
    businessCardUrl: pickStr(primary.businessCardUrl, secondary.businessCardUrl),
    contractLetterUrl: pickStr(primary.contractLetterUrl, secondary.contractLetterUrl),
    nicDocUrl: pickStr(primary.nicDocUrl, secondary.nicDocUrl),
    cnicFrontUrl: pickStr((primary as any).cnicFrontUrl, (secondary as any).cnicFrontUrl),
    cnicBackUrl: pickStr((primary as any).cnicBackUrl, (secondary as any).cnicBackUrl),
    ntnDocUrl: pickStr((primary as any).ntnDocUrl, (secondary as any).ntnDocUrl),
    defaultCaseCategory: pickStr(primary.defaultCaseCategory, secondary.defaultCaseCategory) || 'Bonded Carrier',
    defaultServiceArrangements: pickObj(primary.defaultServiceArrangements, secondary.defaultServiceArrangements),
    defaultCharges: pickCharges(primary.defaultCharges, secondary.defaultCharges),
    openingBalance: Number(primary.openingBalance) || Number(secondary.openingBalance) || 0,
    userId: pickStr(primary.userId, secondary.userId),
    password: pickStr(primary.password, secondary.password),
    loginEnabled: Boolean(primary.loginEnabled || secondary.loginEnabled)
  };
}

function scoreClientCompleteness(c: Partial<Client>): number {
  let score = 0;
  if (c.ownerName?.trim()) score += 2;
  if (c.officeAddress?.trim()) score += 3;
  if (c.mobileNumber?.trim() || c.contact?.trim()) score += 2;
  if (c.ntn?.trim()) score += 2;
  if (c.email?.trim()) score += 1;
  if (c.userId?.trim()) score += 2;
  if (Array.isArray(c.defaultCharges) && c.defaultCharges.length > 0) score += 2;
  if (c.businessCardUrl || c.contractLetterUrl || c.nicDocUrl || (c as any).ntnDocUrl) score += 2;
  return score;
}

export function subscribeToClients(
  onData: (clients: Client[]) => void,
  onError?: (err: any) => void
) {
  const path = 'clients';
  let cachedDocs: any[] = [];

  const emit = () => {
    const active = getActiveCompanyId();
    const localDocsMap = safeAppStorage.getJSON<Record<string, Partial<Client>>>('dpl_persistent_client_docs', {}) || {};
    const dedupedByName = new Map<string, Client>();
    const duplicateIdsToDelete: string[] = [];

    cachedDocs.forEach((docData) => {
      if (matchesActiveCompany(docData.companyId, active)) {
        const localBackup = localDocsMap[String(docData.id)] || {};
        const hydrated: Client = {
          ...docData,
          businessCardUrl: docData.businessCardUrl || localBackup.businessCardUrl || '',
          contractLetterUrl: docData.contractLetterUrl || localBackup.contractLetterUrl || '',
          nicDocUrl: docData.nicDocUrl || localBackup.nicDocUrl || '',
          cnicFrontUrl: docData.cnicFrontUrl || localBackup.cnicFrontUrl || docData.nicDocUrl || localBackup.nicDocUrl || '',
          cnicBackUrl: docData.cnicBackUrl || localBackup.cnicBackUrl || '',
          ntnDocUrl: docData.ntnDocUrl || (localBackup as any).ntnDocUrl || ''
        } as Client;

        const normKey = normalizeClientKey(hydrated.name) || String(hydrated.id);
        if (!dedupedByName.has(normKey)) {
          dedupedByName.set(normKey, hydrated);
        } else {
          const existing = dedupedByName.get(normKey)!;
          const existingScore = scoreClientCompleteness(existing);
          const incomingScore = scoreClientCompleteness(hydrated);
          const primary = incomingScore >= existingScore ? hydrated : existing;
          const secondary = incomingScore >= existingScore ? existing : hydrated;
          const merged = mergeClientRecords(primary, secondary);
          dedupedByName.set(normKey, merged);
          if (secondary.id && String(secondary.id) !== String(primary.id)) {
            duplicateIdsToDelete.push(String(secondary.id));
          }
        }
      }
    });

    // Clean up redundant duplicate client docs in background and persist merged fields to primary doc
    if (duplicateIdsToDelete.length > 0) {
      duplicateIdsToDelete.forEach((dupId) => {
        deleteDoc(doc(db, path, dupId)).catch(() => {});
      });
    }

    const list = Array.from(dedupedByName.values());
    safeAppStorage.setJSON('dpl_cached_clients', list);
    onData(list);
  };

  const unsubCompany = subscribeToActiveCompany(() => {
    emit();
  });

  const unsubFirestore = onSnapshot(
    collection(db, path),
    (snapshot) => {
      cachedDocs = [];
      snapshot.forEach((docSnap) => {
        cachedDocs.push({ ...docSnap.data(), id: docSnap.id });
      });
      emit();
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
    }
  );

  return () => {
    unsubFirestore();
    unsubCompany();
  };
}

export async function deleteClientFromFirestore(clientId: string): Promise<void> {
  const path = 'clients';
  try {
    const cached = safeAppStorage.getJSON<Client[]>('dpl_cached_clients', []) || [];
    const targetClient = cached.find(c => String(c.id) === String(clientId) || c.name === clientId);
    const targetNorm = targetClient ? normalizeClientKey(targetClient.name) : '';

    await deleteDoc(doc(db, path, clientId)).catch(() => {});

    // Also delete any duplicate Firestore client doc with the same normalized name so deleting a client removes all duplicates
    if (targetNorm) {
      const snap = await getDocs(collection(db, path));
      const removePromises: Promise<any>[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (normalizeClientKey(data.name) === targetNorm) {
          removePromises.push(deleteDoc(d.ref).catch(() => {}));
        }
      });
      await Promise.all(removePromises);
    }
  } catch (error) {
    console.warn(`Firestore deleteClient warning:`, error);
  }
}

export async function saveClientToFirestore(client: Partial<Client>): Promise<string> {
  const path = 'clients';
  const activeCompany = getActiveCompanyId();
  const targetCompany = (client as any).companyId || activeCompany;
  const normTargetName = normalizeClientKey(client.name);

  // Check if a client with the same normalized name already exists in local cache or Firestore to prevent duplicates
  let existingMatch: Partial<Client> | undefined;
  try {
    const cachedClients = safeAppStorage.getJSON<Client[]>('dpl_cached_clients', []) || [];
    if (normTargetName) {
      existingMatch = cachedClients.find(
        c => normalizeClientKey(c.name) === normTargetName && matchesActiveCompany((c as any).companyId, targetCompany)
      );
    }
  } catch (_) {}

  const docId = client.id || existingMatch?.id || `client_${Date.now()}`;
  const mergedInput: Partial<Client> = existingMatch
    ? mergeClientRecords(client as Client, existingMatch as Client)
    : client;

  try {
    // Preserve large base64 documents in localStorage backup before sanitizeForFirestore strips >150KB strings
    try {
      const localDocsMap = safeAppStorage.getJSON<Record<string, any>>('dpl_persistent_client_docs', {}) || {};
      localDocsMap[String(docId)] = {
        ...(localDocsMap[String(docId)] || {}),
        businessCardUrl: mergedInput.businessCardUrl || localDocsMap[String(docId)]?.businessCardUrl || '',
        contractLetterUrl: mergedInput.contractLetterUrl || localDocsMap[String(docId)]?.contractLetterUrl || '',
        nicDocUrl: mergedInput.nicDocUrl || (mergedInput as any).cnicFrontUrl || localDocsMap[String(docId)]?.nicDocUrl || '',
        cnicFrontUrl: (mergedInput as any).cnicFrontUrl || mergedInput.nicDocUrl || localDocsMap[String(docId)]?.cnicFrontUrl || '',
        cnicBackUrl: (mergedInput as any).cnicBackUrl || localDocsMap[String(docId)]?.cnicBackUrl || '',
        ntnDocUrl: (mergedInput as any).ntnDocUrl || localDocsMap[String(docId)]?.ntnDocUrl || ''
      };
      safeAppStorage.setJSON('dpl_persistent_client_docs', localDocsMap);
    } catch (_) {}

    const payload = sanitizeForFirestore({
      ...mergedInput,
      companyId: targetCompany,
      id: docId,
      name: mergedInput.name?.trim() || 'New Client',
      ownerName: mergedInput.ownerName || '',
      contact: mergedInput.contact || '',
      officeAddress: mergedInput.officeAddress || '',
      mobileNumber: mergedInput.mobileNumber || '',
      whatsappNumber: mergedInput.whatsappNumber || '',
      email: mergedInput.email || '',
      cnic: mergedInput.cnic || '',
      ntn: mergedInput.ntn || '',
      strn: mergedInput.strn || '',
      businessCardUrl: mergedInput.businessCardUrl || '',
      businessCardName: (mergedInput as any).businessCardName || '',
      contractLetterUrl: mergedInput.contractLetterUrl || '',
      contractLetterName: (mergedInput as any).contractLetterName || '',
      nicDocUrl: mergedInput.nicDocUrl || (mergedInput as any).cnicFrontUrl || '',
      nicDocName: (mergedInput as any).nicDocName || '',
      cnicFrontUrl: (mergedInput as any).cnicFrontUrl || mergedInput.nicDocUrl || '',
      cnicFrontName: (mergedInput as any).cnicFrontName || '',
      cnicBackUrl: (mergedInput as any).cnicBackUrl || '',
      cnicBackName: (mergedInput as any).cnicBackName || '',
      ntnDocUrl: (mergedInput as any).ntnDocUrl || '',
      ntnDocName: (mergedInput as any).ntnDocName || '',
      defaultCaseCategory: mergedInput.defaultCaseCategory || 'Bonded Carrier',
      defaultServiceArrangements: mergedInput.defaultServiceArrangements || {},
      defaultCharges: mergedInput.defaultCharges || [],
      openingBalance: mergedInput.openingBalance || 0,
      userId: mergedInput.userId || '',
      password: mergedInput.password || '',
      loginEnabled: mergedInput.loginEnabled ?? false,
      status: (mergedInput as any).status || 'ACTIVE',
      createdAt: mergedInput.createdAt || new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
    return docId;
  } catch (error) {
    console.warn(`Firestore saveClient warning:`, error);
    return docId;
  }
}

export async function updateClientInFirestore(client: Partial<Client>): Promise<void> {
  const path = 'clients';
  if (!client.id) return;
  try {
    try {
      const localDocsMap = safeAppStorage.getJSON<Record<string, any>>('dpl_persistent_client_docs', {}) || {};
      const existing = localDocsMap[String(client.id)] || {};
      localDocsMap[String(client.id)] = {
        ...existing,
        businessCardUrl: client.businessCardUrl || existing.businessCardUrl || '',
        contractLetterUrl: client.contractLetterUrl || existing.contractLetterUrl || '',
        nicDocUrl: client.nicDocUrl || (client as any).cnicFrontUrl || existing.nicDocUrl || '',
        cnicFrontUrl: (client as any).cnicFrontUrl || client.nicDocUrl || existing.cnicFrontUrl || '',
        cnicBackUrl: (client as any).cnicBackUrl || existing.cnicBackUrl || '',
        ntnDocUrl: (client as any).ntnDocUrl || existing.ntnDocUrl || ''
      };
      safeAppStorage.setJSON('dpl_persistent_client_docs', localDocsMap);
    } catch (_) {}

    const payload = sanitizeForFirestore({
      ...client,
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, String(client.id)), payload, { merge: true });
  } catch (error) {
    console.warn(`Firestore updateClient warning:`, error);
  }
}

// DESTINATION STAFF
export function subscribeToDestinationStaff(
  onData: (staff: DestinationStaff[]) => void,
  onError?: (err: any) => void
) {
  const path = 'destination_staff';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const list: DestinationStaff[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ ...docSnap.data(), id: docSnap.id } as DestinationStaff);
      });
      safeAppStorage.setJSON('dpl_destination_staff', list);
      onData(list);
      if (list.some(s => Number(s.defaultPerContainerCharge) > 0)) {
        syncDestinationStaffContainerCharges({ destinationStaff: list }).catch(() => {});
      }
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
    }
  );
}

export async function saveDestinationStaffToFirestore(staff: Partial<DestinationStaff>): Promise<string> {
  const path = 'destination_staff';
  const docId = staff.id || `dst_${Date.now()}`;
  try {
    const payload = sanitizeForFirestore({
      ...staff,
      id: docId,
      name: staff.name?.trim() || 'Staff Representative',
      station: staff.station || 'Karachi Port',
      role: staff.role || 'Station Supervisor',
      roles: staff.roles || [],
      userId: staff.userId || '',
      password: staff.password || '',
      loginEnabled: staff.loginEnabled ?? true,
      contact: staff.contact || staff.phone || '',
      phone: staff.phone || staff.contact || '',
      secondaryPhone: staff.secondaryPhone || '',
      cnic: staff.cnic || '',
      address: staff.address || '',
      commissionOrSalary: Number(staff.commissionOrSalary || staff.baseRate) || 0,
      baseRate: Number(staff.baseRate || staff.commissionOrSalary) || 0,
      defaultPerContainerCharge: Number(staff.defaultPerContainerCharge) || 0,
      paymentType: staff.paymentType || 'Monthly Salary',
      status: staff.status || 'ACTIVE',
      notes: staff.notes || '',
      updatedAt: new Date().toISOString(),
      createdAt: staff.createdAt || new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });

    const currentList = safeAppStorage.getJSON<DestinationStaff[]>('dpl_destination_staff', []);
    const mergedList = [
      payload as DestinationStaff,
      ...currentList.filter(s => s.id !== docId)
    ];
    safeAppStorage.setJSON('dpl_destination_staff', mergedList);

    if (Number(staff.defaultPerContainerCharge) > 0) {
      syncDestinationStaffContainerCharges({ destinationStaff: mergedList }).catch(() => {});
    }
    return docId;
  } catch (error) {
    console.warn(`Firestore saveDestinationStaff warning:`, error);
    return docId;
  }
}

export async function deleteDestinationStaffFromFirestore(staffId: string): Promise<void> {
  const path = 'destination_staff';
  try {
    await deleteDoc(doc(db, path, staffId));
  } catch (error) {
    console.warn(`Firestore deleteDestinationStaff warning:`, error);
  }
}

// STAFF DUAL LEDGERS (Salary, Daily Routine & Destination Per-Container Remittance Ledger)
export function subscribeToStaffLedgers(
  onData: (entries: StaffLedgerEntry[]) => void,
  onError?: (err: any) => void
) {
  const path = 'staff_ledgers';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const list: StaffLedgerEntry[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ ...docSnap.data(), id: docSnap.id } as StaffLedgerEntry);
      });
      safeAppStorage.setJSON('dpl_staff_ledgers', list);
      onData(list);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
    }
  );
}

export async function saveStaffLedgerEntryToFirestore(entry: Partial<StaffLedgerEntry>): Promise<string> {
  const path = 'staff_ledgers';
  const docId = entry.id || `sled_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    const payload = sanitizeForFirestore({
      id: docId,
      staffId: entry.staffId || '',
      staffName: entry.staffName || 'Staff Member',
      type: entry.type || 'SALARY',
      date: entry.date || new Date().toISOString().split('T')[0],
      description: entry.description || '',
      category: entry.category || 'General',
      debit: Number(entry.debit) || 0,
      credit: Number(entry.credit) || 0,
      balance: Number(entry.balance) || 0,
      caseNo: entry.caseNo || undefined,
      containerCount: entry.containerCount || undefined,
      perContainerRate: entry.perContainerRate || undefined,
      isInternalCompanyTransaction: entry.isInternalCompanyTransaction ?? undefined,
      receiptUrl: entry.receiptUrl || '',
      notes: entry.notes || '',
      settled: entry.settled ?? false
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
    return docId;
  } catch (error) {
    console.warn(`Firestore saveStaffLedger warning:`, error);
    return docId;
  }
}

/**
 * Registers/syncs Destination Staff representatives as Vendors in Finance Management (`vendors`)
 * and posts per-container charges into Finance Management Payables (`finances`) so all destination
 * staff financial settlements are managed strictly inside Finance Management -> Vendors & Utilities.
 */
export async function syncDestinationStaffContainerCharges(options?: {
  cases?: Case[];
  destinationStaff?: DestinationStaff[];
  users?: AppUser[];
}): Promise<void> {
  try {
    const destStaffList: DestinationStaff[] =
      options?.destinationStaff ||
      safeAppStorage.getJSON<DestinationStaff[]>('dpl_destination_staff', []);

    let usersList: AppUser[] = options?.users || [];
    if (usersList.length === 0) {
      usersList = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || [];
    }

    interface ActiveDestVendorProfile {
      staffId: string;
      userId: string;
      name: string;
      station: string;
      phone: string;
      address: string;
      rate: number;
    }

    const profilesMap = new Map<string, ActiveDestVendorProfile>();

    destStaffList.forEach(ds => {
      if (ds.status !== 'INACTIVE' && ds.status !== 'Inactive' && ds.name?.trim()) {
        const key = (ds.userId || ds.name || ds.id).toLowerCase().trim();
        profilesMap.set(key, {
          staffId: String(ds.userId || ds.id),
          userId: String(ds.userId || ds.id),
          name: ds.name.trim(),
          station: ds.station || 'Destination Port',
          phone: ds.phone || '',
          address: ds.address || ds.station || '',
          rate: Number(ds.defaultPerContainerCharge) || 0
        });
      }
    });

    usersList.forEach(u => {
      const roles = u.roles && u.roles.length > 0 ? u.roles : [u.role];
      const isDestRole =
        roles.includes(UserRole.UNLOADING_PORT_STAFF) ||
        roles.includes(UserRole.DESTINATION_PORT_STAFF);
      if (isDestRole && u.status !== 'SUSPENDED' && u.status !== 'INACTIVE' && u.name?.trim()) {
        const key = (u.userId || u.name || String(u.id)).toLowerCase().trim();
        const existing = profilesMap.get(key);
        profilesMap.set(key, {
          staffId: String(u.id || u.userId),
          userId: String(u.userId || u.id),
          name: u.name.trim(),
          station: u.assignedStation || existing?.station || 'Destination Port',
          phone: u.contact || existing?.phone || '',
          address: u.residentialAddress || existing?.address || u.assignedStation || '',
          rate: Number(u.defaultPerContainerCharge) || existing?.rate || 0
        });
      }
    });

    const profiles = Array.from(profilesMap.values());
    if (profiles.length === 0) return;

    // 1. Ensure every Destination Staff profile is registered as a Vendor in Finance Management
    for (const prof of profiles) {
      const vendorId = `VND-DEST-${String(prof.userId || prof.staffId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      await saveVendor({
        id: vendorId,
        name: prof.name,
        companyTitle: `Destination Staff — ${prof.station}`,
        contactNumber: prof.phone || '-',
        address: prof.address || prof.station,
        category: 'Destination Port Staff (Per Container)',
        isRecurring: false,
        createdAt: new Date().toISOString()
      });
    }

    // 2. For any profile with a configured per-container rate > 0, sync per-container charges to Finance Payables
    const ratedProfiles = profiles.filter(p => p.rate > 0);
    if (ratedProfiles.length === 0) return;

    const allCases: Case[] =
      options?.cases && options.cases.length > 0
        ? options.cases
        : safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
    if (!allCases || allCases.length === 0) return;

    const activeCompany = getActiveCompanyId();
    const existingFinances = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []) || [];

    for (const c of allCases) {
      if (!c || String(c.status || '').toUpperCase() === 'CANCELLED') continue;
      const caseNo = c.caseNo || c.caseNumber || c.id;
      if (!caseNo) continue;

      const podRaw = (c.pod || (c.extractedData as any)?.pod || (c.extractedData as any)?.placeOfDelivery || '').toLowerCase();
      const destStep =
        c.workflowDetails?.['Destination Port Arrival'] ||
        c.workflowDetails?.['DESTINATION_PORT_ARRIVAL'] ||
        ({} as any);
      const explicitStaffId = String(destStep.staffUserId || (c as any).assignedDestinationStaffId || '').toLowerCase().trim();
      const explicitOfficer = String(destStep.officer || (c as any).assignedDestinationStaffName || '').toLowerCase().trim();

      for (const prof of ratedProfiles) {
        const profUserLower = prof.userId.toLowerCase().trim();
        const profIdLower = prof.staffId.toLowerCase().trim();
        const profNameLower = prof.name.toLowerCase().trim();
        const stationTokens = prof.station
          .toLowerCase()
          .replace(/[()/-]/g, ' ')
          .split(/\s+/)
          .filter(tok => tok.length >= 4 && !['port', 'terminal', 'border', 'station', 'office', 'point', 'agent', 'staff'].includes(tok));

        const matchesExplicitStaff =
          (explicitStaffId && (explicitStaffId === profUserLower || explicitStaffId === profIdLower)) ||
          (explicitOfficer && (explicitOfficer === profNameLower || explicitOfficer === profUserLower));

        const matchesStation =
          stationTokens.length > 0 && podRaw.length > 0 && stationTokens.some(tok => podRaw.includes(tok));

        const isSingleConfiguredDestStaff = ratedProfiles.length === 1 && (!stationTokens.length || !podRaw || matchesStation);

        if (!matchesExplicitStaff && !matchesStation && !isSingleConfiguredDestStaff) {
          continue;
        }

        const containerList = Array.isArray(c.containers) && c.containers.length > 0 ? c.containers : [];
        const containerCount = Math.max(1, containerList.length);
        const totalCharge = containerCount * prof.rate;
        const containerNums =
          containerList.map(cn => cn.number).filter(Boolean).join(', ') ||
          c.containerNumber ||
          (c.extractedData as any)?.containerNo ||
          'Assigned Container(s)';

        const safeCaseKey = String(caseNo).replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeStaffKey = String(prof.userId || prof.staffId).replace(/[^a-zA-Z0-9_-]/g, '_');
        const finRef = `DEST-CNTR-${safeStaffKey}-${safeCaseKey}`;
        const deterministicFinId = parseNumericDocId(undefined, `${activeCompany}_${finRef}`, 0);

        const alreadyPosted = existingFinances.some(
          f => f.reference === finRef || (Number(f.id) === deterministicFinId && Number(f.amount) === totalCharge)
        );
        if (alreadyPosted) continue;

        const dateStr = (c.createdAt || new Date().toISOString()).split('T')[0];
        if (dateStr < PAYABLES_EFFECTIVE_START_DATE) continue;
        await saveFinanceToFirestore({
          id: deterministicFinId,
          companyId: (c as any).companyId || activeCompany,
          date: dateStr,
          description: `Destination Container Charges: ${containerCount} Container(s) [${containerNums}] × PKR ${prof.rate.toLocaleString()}/cntr — Case #${caseNo} (${c.pod || prof.station})`,
          party: prof.name,
          amount: totalCharge,
          type: 'PAYABLE',
          status: 'APPROVED',
          category: 'Destination Port Staff (Per Container)',
          reference: finRef,
          caseNo: String(caseNo)
        } as FinanceEntry);
      }
    }
  } catch (err) {
    console.warn('syncDestinationStaffContainerCharges notice:', err);
  }
}

export async function deleteStaffLedgerEntryFromFirestore(entryId: string): Promise<void> {
  const path = 'staff_ledgers';
  try {
    await deleteDoc(doc(db, path, entryId));
  } catch (error) {
    console.warn(`Firestore deleteStaffLedger warning:`, error);
  }
}

/**
 * Exports complete snapshot of all live collections from Firestore for cloud backup
 */
export async function exportCompleteDatabaseSnapshot(): Promise<any> {
  const [
    casesSnap,
    finSnap,
    finLegacySnap,
    vehSnap,
    clientSnap,
    userSnap,
    vendorSnap,
    recurringSnap,
    staffLedgerSnap,
    destStaffSnap,
    notifSnap,
    activitySnap,
    settingsSnap
  ] = await Promise.all([
    getDocs(collection(db, 'cases')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'finances')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'finance')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'vehicles')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'clients')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'users')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'vendors')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'recurring_templates')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'staff_ledgers')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'destination_staff')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'notifications')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'activity_logs')).catch(() => ({ docs: [] } as any)),
    getDocs(collection(db, 'settings')).catch(() => ({ docs: [] } as any)),
  ]);

  let cases: Case[] = casesSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
  if (cases.length === 0) {
    cases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
  }

  // Finance: merge finances + legacy finance + local storage fallback
  const firestoreFinance: FinanceEntry[] = [
    ...finSnap.docs.map((d: any) => ({ ...d.data(), id: d.id })),
    ...finLegacySnap.docs.map((d: any) => ({ ...d.data(), id: d.id }))
  ];
  let finance: FinanceEntry[] = firestoreFinance;
  if (finance.length === 0) {
    const cash = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []);
    const recv = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_receivables', []);
    const pay = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);
    finance = [...cash, ...recv, ...pay];
  }

  let vehicles: Vehicle[] = vehSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
  if (vehicles.length === 0) {
    vehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', safeAppStorage.getJSON<Vehicle[]>('dpl_cached_vehicles', []));
  }

  let clients: Client[] = clientSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
  if (clients.length === 0) {
    clients = safeAppStorage.getJSON<Client[]>('dpl_cached_clients', []);
  }

  const users: AppUser[] = userSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));

  let vendors: Vendor[] = vendorSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
  if (vendors.length === 0) {
    vendors = safeAppStorage.getJSON<Vendor[]>('dpl_vendors_list', []);
  }

  let recurringTemplates: RecurringFinanceTemplate[] = recurringSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
  if (recurringTemplates.length === 0) {
    recurringTemplates = safeAppStorage.getJSON<RecurringFinanceTemplate[]>('dpl_recurring_templates', []);
  }

  let staffLedgers: StaffLedgerEntry[] = staffLedgerSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
  if (staffLedgers.length === 0) {
    staffLedgers = safeAppStorage.getJSON<StaffLedgerEntry[]>('dpl_staff_ledgers', []);
  }

  let destinationStaff: DestinationStaff[] = destStaffSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
  if (destinationStaff.length === 0) {
    destinationStaff = safeAppStorage.getJSON<DestinationStaff[]>('dpl_destination_staff', []);
  }

  const notifications: AppNotification[] = notifSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));

  let activityLogs = activitySnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
  if (activityLogs.length === 0) {
    activityLogs = safeAppStorage.getJSON<any[]>('dpl_system_activity_logs', []);
  }

  const settingsData = settingsSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));

  return {
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    app: 'DOCKS (PVT) LTD - ERP & Logistics Management',
    backupType: 'COMPLETE',
    stats: {
      casesCount: cases.length,
      financeCount: finance.length,
      vehiclesCount: vehicles.length,
      clientsCount: clients.length,
      usersCount: users.length,
      vendorsCount: vendors.length,
      recurringTemplatesCount: recurringTemplates.length,
      staffLedgersCount: staffLedgers.length,
      destinationStaffCount: destinationStaff.length,
      notificationsCount: notifications.length,
      activityLogsCount: activityLogs.length
    },
    settings: settingsData,
    cases,
    finance,
    vehicles,
    clients,
    users,
    vendors,
    recurringTemplates,
    staffLedgers,
    destinationStaff,
    notifications,
    activityLogs
  };
}

/**
 * Selective export based on user-chosen modules:
 * Full Backup, All Cases, All Finance, All Vehicles, All Clients, Vendors, Recurring, Staff
 */
export async function exportSelectiveDatabaseBackup(options: {
  cases: boolean;
  finance: boolean;
  vehicles: boolean;
  clients: boolean;
  companyInfo?: any;
  companyId?: CompanyId;
}): Promise<any> {
  const isFull = options.cases && options.finance && options.vehicles && options.clients && !options.companyId;
  if (isFull) {
    const fullSnapshot = await exportCompleteDatabaseSnapshot();
    if (options.companyInfo) {
      fullSnapshot.companyInfo = options.companyInfo;
    }
    return fullSnapshot;
  }

  const promises: Promise<any>[] = [];

  promises.push(
    options.cases 
      ? getDocs(collection(db, 'cases')).catch(() => ({ docs: [] })) 
      : Promise.resolve({ docs: [] })
  );
  promises.push(
    options.finance 
      ? getDocs(collection(db, 'finances')).catch(() => ({ docs: [] })) 
      : Promise.resolve({ docs: [] })
  );
  promises.push(
    options.vehicles 
      ? getDocs(collection(db, 'vehicles')).catch(() => ({ docs: [] })) 
      : Promise.resolve({ docs: [] })
  );
  promises.push(
    options.clients 
      ? getDocs(collection(db, 'clients')).catch(() => ({ docs: [] })) 
      : Promise.resolve({ docs: [] })
  );

  const [casesSnap, finSnap, vehSnap, clientSnap] = await Promise.all(promises);

  let cases: Case[] = (casesSnap?.docs || []).map((d: any) => ({ ...d.data(), id: d.id }));
  if (options.cases && cases.length === 0) {
    cases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
  }
  if (options.companyId) {
    cases = cases.filter(c => matchesActiveCompany(c.companyId, options.companyId!));
  }

  let finance: FinanceEntry[] = (finSnap?.docs || []).map((d: any) => ({ ...d.data(), id: d.id }));
  if (options.finance && finance.length === 0) {
    const cash = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []);
    const recv = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_receivables', []);
    const pay = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);
    finance = [...cash, ...recv, ...pay];
  }
  if (options.companyId) {
    finance = finance.filter(f => matchesActiveCompany(f.companyId, options.companyId!));
  }

  let vehicles: Vehicle[] = (vehSnap?.docs || []).map((d: any) => ({ ...d.data(), id: d.id }));
  if (options.vehicles && vehicles.length === 0) {
    vehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', safeAppStorage.getJSON<Vehicle[]>('dpl_cached_vehicles', []));
  }

  let clients: Client[] = (clientSnap?.docs || []).map((d: any) => ({ ...d.data(), id: d.id }));
  if (options.clients && clients.length === 0) {
    clients = safeAppStorage.getJSON<Client[]>('dpl_cached_clients', []);
  }

  return {
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    backupType: options.companyId ? `COMPANY_${options.companyId.toUpperCase()}` : 'SELECTIVE',
    companyId: options.companyId || null,
    app: 'DOCKS (PVT) LTD - ERP & Logistics Management',
    includedModules: {
      cases: options.cases,
      finance: options.finance,
      vehicles: options.vehicles,
      clients: options.clients
    },
    stats: {
      casesCount: cases.length,
      financeCount: finance.length,
      vehiclesCount: vehicles.length,
      clientsCount: clients.length
    },
    companyInfo: options.companyInfo || null,
    cases: options.cases ? cases : [],
    finance: options.finance ? finance : [],
    vehicles: options.vehicles ? vehicles : [],
    clients: options.clients ? clients : []
  };
}

/**
 * Permanently wipes live operational data from Firebase Firestore (Cases, Finance, Vehicles, Clients, Vendors, Templates, Ledgers, Notifications, Activity Logs).
 * Clears universal unified storage, localStorage, and sessionStorage completely.
 */
// Helper for fail-safe asynchronous execution with timeout to prevent UI freezes
const executeWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
};

export async function wipeCompleteDatabase(): Promise<{
  success: boolean;
  deletedCounts: {
    cases: number;
    finances: number;
    vehicles: number;
    clients: number;
    vendors: number;
    recurringTemplates: number;
    staffLedgers: number;
    destinationStaff: number;
    notifications: number;
    activityLogs: number;
  };
}> {
  const deletedCounts = {
    cases: 0,
    finances: 0,
    vehicles: 0,
    clients: 0,
    vendors: 0,
    recurringTemplates: 0,
    staffLedgers: 0,
    destinationStaff: 0,
    notifications: 0,
    activityLogs: 0
  };

  const collectionsToWipe = [
    'notifications',
    'activity_logs',
    'cases',
    'finances',
    'finance',
    'payables',
    'receivables',
    'vehicles',
    'available_vehicles',
    'transporter_requests',
    'drivers',
    'clients',
    'vendors',
    'recurring_templates',
    'staff_ledgers',
    'staff_loading_bills',
    'staff_private_ledgers',
    'destination_staff',
    'company_documents',
    'company_document_folders',
    'personal_ledger_accounts',
    'personal_ledger_entries',
    'work_drafts'
  ] as const;

  const resetNowIso = new Date().toISOString();
  safeAppStorage.setRawItem('dpl_last_reset_timestamp', resetNowIso);
  safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, []);

  // 1. Wipe Firestore Collections in Parallel using writeBatch with 12s per-collection timeout
  const wipePromises = collectionsToWipe.map(async (colName) => {
    try {
      await executeWithTimeout((async () => {
        const snap = await getDocs(collection(db, colName));
        if (snap.empty) return;
        const docs = snap.docs;
        // Batch delete in chunks of up to 400
        for (let i = 0; i < docs.length; i += 400) {
          const chunk = docs.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
        if (colName === 'cases') deletedCounts.cases += docs.length;
        else if (colName === 'finances' || colName === 'finance' || colName === 'payables' || colName === 'receivables') deletedCounts.finances += docs.length;
        else if (colName === 'vehicles') deletedCounts.vehicles += docs.length;
        else if (colName === 'clients') deletedCounts.clients += docs.length;
        else if (colName === 'vendors') deletedCounts.vendors += docs.length;
        else if (colName === 'recurring_templates') deletedCounts.recurringTemplates += docs.length;
        else if (colName === 'staff_ledgers') deletedCounts.staffLedgers += docs.length;
        else if (colName === 'destination_staff') deletedCounts.destinationStaff += docs.length;
        else if (colName === 'notifications') deletedCounts.notifications += docs.length;
        else if (colName === 'activity_logs') deletedCounts.activityLogs += docs.length;
      })(), 12000, null);
    } catch (err) {
      console.warn(`Error wiping collection ${colName}:`, err);
    }
  });

  await Promise.all(wipePromises);

  // 2. Reset users collection in Firestore using writeBatch
  try {
    await executeWithTimeout((async () => {
      const usersSnap = await getDocs(collection(db, 'users'));
      if (!usersSnap.empty) {
        const batch = writeBatch(db);
        for (const uDoc of usersSnap.docs) {
          const uData = uDoc.data();
          const isDefault = DEFAULT_DATABASE_USERS.some(def => String(def.id) === uDoc.id || def.userId === uData.userId);
          if (!isDefault) {
            batch.delete(uDoc.ref);
          } else {
            batch.update(uDoc.ref, {
              baseSalary: 0,
              loansAdvances: 0,
              updatedAt: resetNowIso
            });
          }
        }
        await batch.commit();
      }
    })(), 5000, null);
  } catch (err) {
    console.warn('Error resetting users collection in wipeCompleteDatabase:', err);
  }

  // 3. Preserve uploaded logos, company names, and corporate branding (NEVER wipe logos or company details on Factory Reset)
  try {
    await clearOperationalIndexedDBCache({ clearVehicles: true });
  } catch (idbErr) {
    console.warn('IndexedDB operational cache clear notice:', idbErr);
  }

  // 4. Wipe universal unified storage (all operational dpl_, notif_, audit_ keys in memory, localStorage, and sessionStorage)
  // Note: safeAppStorage.wipeAppOperationalData(true) strictly preserves mak_parent_group_branding, dpl_company_branding_v1*, dpl_custom_banks*, and admin profile keys
  try {
    safeAppStorage.wipeAppOperationalData(true);
    safeAppStorage.setItem('dpl_cleanup_phantom_v3', 'done');
    safeAppStorage.setRawItem('dpl_purge_stale_notifications_v5', 'done');
    safeAppStorage.setRawItem('dpl_last_reset_timestamp', resetNowIso);
  } catch (e) {
    console.warn('Storage wipe notice:', e);
  }

  // 5. Explicitly purge all known operational keys to ensure complete wipe (excluding branding, logos, and banks)
  const explicitKeys = [
    'dpl_live_finance', 'dpl_live_receivables', 'dpl_live_payables', 'dpl_live_cases',
    'dpl_live_notifications', 'dpl_live_transporter_requests', 'dpl_live_drivers',
    'dpl_live_transporters', 'dpl_live_vehicles', 'dpl_finance_client', 'dpl_finance_tab',
    'dpl_vendors_list', 'dpl_staff_ledgers', 'dpl_destination_staff', 'dpl_recurring_templates',
    'dpl_system_activity_logs', 'dpl_cached_cases', 'dpl_cached_finances', 'dpl_cached_vehicles',
    'dpl_cached_clients', 'dpl_cached_vendors', 'dpl_fleet_vehicles', 'dpl_all_cases', 'dpl_cases',
    'dpl_reg_draft_active', 'dpl_reg_step', 'dpl_reg_caseno', 'dpl_reg_formdata', 
    'dpl_reg_docs', 'dpl_reg_updated_at', 'dpl_reg_view', 'dpl_vehicles_data', 'dpl_registered_clients',
    'dpl_selected_case', 'dpl_selected_case_id', 'dpl_finance_active_tab', 'dpl_dashboard_timeframe',
    'dpl_ports', 'dpl_company_docs', 'dpl_company_documents', 'dpl_company_explorer_folders', 'dpl_last_cloud_backup_time'
  ];

  explicitKeys.forEach((k) => {
    safeAppStorage.removeItem(k);
    try { localStorage.removeItem(k); } catch (_) {}
    try { sessionStorage.removeItem(k); } catch (_) {}
  });

  // 6. Ensure all payables, finances, cases, vehicles, notifications, and activity logs in memory and storage are strictly empty
  safeAppStorage.setJSON('dpl_live_finance', []);
  safeAppStorage.setJSON('dpl_live_payables', []);
  safeAppStorage.setJSON('dpl_live_receivables', []);
  safeAppStorage.setJSON('dpl_live_cases', []);
  safeAppStorage.setJSON('dpl_live_vehicles', []);
  safeAppStorage.setJSON('dpl_live_notifications', []);
  safeAppStorage.setJSON('dpl_system_activity_logs', []);

  // 7. Clear per-company operational notification keys ONLY (NEVER remove dpl_company_branding_v1_* or mak_parent_group_branding)
  ['docks', 'muhib', 'vantage', 'truckit'].forEach(cId => {
    safeAppStorage.removeItem(`dpl_live_notifications_${cId}`);
    try { localStorage.removeItem(`dpl_live_notifications_${cId}`); } catch (_) {}
  });

  // 8. Record system reset timestamp in Firestore settings (preserving branding and parent_group docs)
  try {
    await executeWithTimeout((async () => {
      await setDoc(doc(db, 'settings', 'system_reset'), { lastResetAt: resetNowIso }, { merge: true });
    })(), 3500, null);
  } catch (err) {
    console.warn('Error updating Firestore system_reset doc:', err);
  }

  // 9. Thoroughly clear browser cookies & cache storage
  try {
    if (typeof document !== 'undefined') {
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const eqPos = cookie.indexOf('=');
        const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${window.location.hostname}`;
      }
    }
  } catch (_) {}

  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((k) => caches.delete(k));
      });
    }
  } catch (_) {}

  // 10. Dispatch live update events so currently rendered views immediately flush state
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('dpl_cases_updated'));
    window.dispatchEvent(new Event('dpl_finance_updated'));
    window.dispatchEvent(new Event('dpl_notification_updated'));
    window.dispatchEvent(new Event('dpl_branding_changed'));
    window.dispatchEvent(new Event('storage'));
  }

  return {
    success: true,
    deletedCounts
  };
}

/**
 * Wipes operational data for a SINGLE specific subsidiary company only.
 * Leaves all other 3 subsidiaries and the shared vehicle fleet 100% intact.
 */
export async function wipeCompanyDatabase(companyId: CompanyId): Promise<{
  success: boolean;
  deletedCounts: {
    cases: number;
    finances: number;
    vehicles: number;
  };
}> {
  const deletedCounts = {
    cases: 0,
    finances: 0,
    vehicles: 0
  };

  // 1. Wipe Firestore docs for this specific company only using writeBatch
  // Note: 'vehicles' is intentionally excluded here because the Vehicle Management database is shared across all 4 group companies.
  const collectionsToCheck = [
    { name: 'notifications', type: 'notifications' },
    { name: 'activity_logs', type: 'logs' },
    { name: 'cases', type: 'cases' },
    { name: 'finances', type: 'finances' },
    { name: 'finance', type: 'finances' },
    { name: 'payables', type: 'finances' },
    { name: 'receivables', type: 'finances' },
    { name: 'recurring_templates', type: 'finances' },
    { name: 'staff_ledgers', type: 'finances' },
    { name: 'franchises', type: 'finances' },
    { name: 'franchise_ledger_entries', type: 'finances' },
    { name: 'company_documents', type: 'cases' },
    { name: 'company_document_folders', type: 'cases' },
    { name: 'corporate_legal_cases', type: 'cases' },
    { name: 'corporate_vault_credentials', type: 'cases' }
  ] as const;

  const wipePromises = collectionsToCheck.map(async (item) => {
    try {
      await executeWithTimeout((async () => {
        const snap = await getDocs(collection(db, item.name));
        const matchedDocs = snap.docs.filter((docSnap) => matchesActiveCompany(docSnap.data().companyId, companyId));
        if (matchedDocs.length === 0) return;

        for (let i = 0; i < matchedDocs.length; i += 400) {
          const chunk = matchedDocs.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }

        if (item.type === 'cases') deletedCounts.cases += matchedDocs.length;
        else if (item.type === 'finances') deletedCounts.finances += matchedDocs.length;
      })(), 10000, null);
    } catch (err) {
      console.warn(`Error wiping company ${companyId} data from ${item.name}:`, err);
    }
  });

  await Promise.all(wipePromises);

  // 2. Clear IndexedDB operational records for this company while strictly preserving company logo, details, and banks
  try {
    await clearOperationalIndexedDBCache({ clearVehicles: false, companyId });
  } catch (idbErr) {
    console.warn('IndexedDB company cache clear notice:', idbErr);
  }

  // 3. Filter local storage cached arrays to remove only this company's operational items (preserving shared vehicles, company logo, branding, and banks)
  try {
    safeAppStorage.setRawItem('dpl_last_reset_timestamp', new Date().toISOString());

    const liveFinance = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []);
    safeAppStorage.setJSON('dpl_live_finance', liveFinance.filter(f => !matchesActiveCompany(f.companyId, companyId)));

    const livePayables = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);
    safeAppStorage.setJSON('dpl_live_payables', livePayables.filter(f => !matchesActiveCompany(f.companyId, companyId)));

    const liveReceivables = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_receivables', []);
    safeAppStorage.setJSON('dpl_live_receivables', liveReceivables.filter(f => !matchesActiveCompany(f.companyId, companyId)));

    const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
    safeAppStorage.setJSON('dpl_live_cases', liveCases.filter(c => !matchesActiveCompany(c.companyId, companyId)));

    const liveNotifs = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []);
    safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, liveNotifs.filter(n => !matchesActiveCompany((n as any).companyId, companyId)));
    safeAppStorage.removeItem(`dpl_live_notifications_${companyId}`);

    const liveActivityLogs = safeAppStorage.getJSON<any[]>('dpl_system_activity_logs', []);
    safeAppStorage.setJSON('dpl_system_activity_logs', liveActivityLogs.filter(l => !matchesActiveCompany(l?.companyId, companyId)));
  } catch (e) {
    console.warn('Company storage cleanup notice:', e);
  }

  // 3. Dispatch live update events so views re-render with 0 items for this company
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('dpl_cases_updated'));
    window.dispatchEvent(new Event('dpl_finance_updated'));
    window.dispatchEvent(new Event('dpl_notification_updated'));
    window.dispatchEvent(new Event('dpl_branding_changed'));
    window.dispatchEvent(new Event('storage'));
  }

  return {
    success: true,
    deletedCounts
  };
}

/**
 * Restores database collections and local state from a complete snapshot
 */
export async function restoreDatabaseSnapshot(snapshot: any): Promise<{
  success: boolean;
  restoredCounts: {
    cases: number;
    finance: number;
    vehicles: number;
    clients: number;
    users: number;
    vendors: number;
    recurringTemplates: number;
    staffLedgers: number;
    destinationStaff: number;
    notifications: number;
    activityLogs: number;
  };
}> {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid snapshot structure');
  }

  let casesCount = 0;
  let finCount = 0;
  let vehCount = 0;
  let clientCount = 0;
  let userCount = 0;
  let vendorCount = 0;
  let recurringCount = 0;
  let staffLedgersCount = 0;
  let destStaffCount = 0;
  let notifCount = 0;
  let activityLogsCount = 0;

  // 1. Cases
  if (Array.isArray(snapshot.cases)) {
    for (const c of snapshot.cases) {
      if (c && c.id) {
        await setDoc(doc(db, 'cases', String(c.id)), sanitizeForFirestore(c), { merge: true });
        casesCount++;
      }
    }
    safeAppStorage.setJSON('dpl_live_cases', snapshot.cases);
  }

  // 2. Finance
  if (Array.isArray(snapshot.finance)) {
    for (const f of snapshot.finance) {
      if (f && f.id) {
        await setDoc(doc(db, 'finances', String(f.id)), sanitizeForFirestore(f), { merge: true });
        finCount++;
      }
    }
    // Partition finance entries for Finance.tsx states
    const cash = snapshot.finance.filter((f: any) => f.type === 'INFLOW' || f.type === 'OUTFLOW');
    const recv = snapshot.finance.filter((f: any) => f.type === 'RECEIVABLE');
    const pay = snapshot.finance.filter((f: any) => f.type === 'PAYABLE');

    safeAppStorage.setJSON('dpl_live_finance', cash.length > 0 ? cash : snapshot.finance);
    safeAppStorage.setJSON('dpl_live_receivables', recv);
    safeAppStorage.setJSON('dpl_live_payables', pay);
  }

  // 3. Vehicles
  if (Array.isArray(snapshot.vehicles)) {
    for (const v of snapshot.vehicles) {
      if (v && v.id) {
        await setDoc(doc(db, 'vehicles', String(v.id)), sanitizeForFirestore(v), { merge: true });
        vehCount++;
      }
    }
    safeAppStorage.setJSON('dpl_live_vehicles', snapshot.vehicles);
    safeAppStorage.setJSON('dpl_cached_vehicles', snapshot.vehicles);
  }

  // 4. Clients
  if (Array.isArray(snapshot.clients)) {
    for (const cl of snapshot.clients) {
      if (cl && cl.id) {
        await setDoc(doc(db, 'clients', String(cl.id)), sanitizeForFirestore(cl), { merge: true });
        clientCount++;
      }
    }
    safeAppStorage.setJSON('dpl_cached_clients', snapshot.clients);
  }

  // 5. Users
  if (Array.isArray(snapshot.users)) {
    for (const u of snapshot.users) {
      if (u && u.id) {
        await setDoc(doc(db, 'users', String(u.id)), sanitizeForFirestore(u), { merge: true });
        userCount++;
      }
    }
  }

  // 6. Vendors
  const vendorsList = snapshot.vendors || snapshot.vendorsList;
  if (Array.isArray(vendorsList)) {
    for (const vnd of vendorsList) {
      if (vnd && vnd.id) {
        await setDoc(doc(db, 'vendors', String(vnd.id)), sanitizeForFirestore(vnd), { merge: true });
        vendorCount++;
      }
    }
    safeAppStorage.setJSON('dpl_vendors_list', vendorsList);
  }

  // 7. Recurring Templates
  const recurringList = snapshot.recurringTemplates || snapshot.recurring_templates;
  if (Array.isArray(recurringList)) {
    for (const rec of recurringList) {
      if (rec && rec.id) {
        await setDoc(doc(db, 'recurring_templates', String(rec.id)), sanitizeForFirestore(rec), { merge: true });
        recurringCount++;
      }
    }
    safeAppStorage.setJSON('dpl_recurring_templates', recurringList);
  }

  // 8. Staff Ledgers
  const staffList = snapshot.staffLedgers || snapshot.staff_ledgers;
  if (Array.isArray(staffList)) {
    for (const st of staffList) {
      if (st && st.id) {
        await setDoc(doc(db, 'staff_ledgers', String(st.id)), sanitizeForFirestore(st), { merge: true });
        staffLedgersCount++;
      }
    }
    safeAppStorage.setJSON('dpl_staff_ledgers', staffList);
  }

  // 9. Destination Staff
  const destStaff = snapshot.destinationStaff || snapshot.destination_staff;
  if (Array.isArray(destStaff)) {
    for (const ds of destStaff) {
      if (ds && ds.id) {
        await setDoc(doc(db, 'destination_staff', String(ds.id)), sanitizeForFirestore(ds), { merge: true });
        destStaffCount++;
      }
    }
    safeAppStorage.setJSON('dpl_destination_staff', destStaff);
  }

  // 10. Notifications
  if (Array.isArray(snapshot.notifications)) {
    for (const notif of snapshot.notifications) {
      if (notif && notif.id) {
        await setDoc(doc(db, 'notifications', String(notif.id)), sanitizeForFirestore(notif), { merge: true });
        notifCount++;
      }
    }
  }

  // 11. Activity Logs
  const actLogs = snapshot.activityLogs || snapshot.activity_logs;
  if (Array.isArray(actLogs)) {
    for (const log of actLogs) {
      if (log && log.id) {
        await setDoc(doc(db, 'activity_logs', String(log.id)), sanitizeForFirestore(log), { merge: true });
        activityLogsCount++;
      }
    }
    safeAppStorage.setJSON('dpl_system_activity_logs', actLogs);
  }

  // 12. Company Info & Settings
  if (snapshot.companyInfo) {
    try {
      await setDoc(doc(db, 'settings', 'companyInfo'), sanitizeForFirestore(snapshot.companyInfo), { merge: true });
    } catch (_) {}
  }

  // Notify active components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('dpl_cases_updated'));
    window.dispatchEvent(new Event('dpl_finance_updated'));
    window.dispatchEvent(new Event('dpl_branding_changed'));
    window.dispatchEvent(new Event('storage'));
  }

  return {
    success: true,
    restoredCounts: {
      cases: casesCount,
      finance: finCount,
      vehicles: vehCount,
      clients: clientCount,
      users: userCount,
      vendors: vendorCount,
      recurringTemplates: recurringCount,
      staffLedgers: staffLedgersCount,
      destinationStaff: destStaffCount,
      notifications: notifCount,
      activityLogs: activityLogsCount
    }
  };
}

// RECURRING FINANCE TEMPLATES (Monthly Fixed Expenses & Receivables)
export const DEFAULT_RECURRING_TEMPLATES: RecurringFinanceTemplate[] = [];

export function subscribeToRecurringTemplates(
  onData: (items: RecurringFinanceTemplate[]) => void,
  onError?: (err: any) => void
) {
  const path = 'recurring_templates';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      if (snapshot.empty) {
        onData([]);
        return;
      }
      const items: RecurringFinanceTemplate[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ ...docSnap.data(), id: docSnap.id } as RecurringFinanceTemplate);
      });
      onData(items);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      onData([]);
    }
  );
}

export async function saveRecurringTemplateToFirestore(tpl: RecurringFinanceTemplate): Promise<void> {
  const path = 'recurring_templates';
  const docId = tpl.id || `rec_${Date.now()}`;
  try {
    const payload = sanitizeForFirestore({
      ...tpl,
      id: docId,
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
  } catch (error) {
    console.warn(`Firestore saveRecurringTemplate warning:`, error);
  }
}

export async function deleteRecurringTemplateFromFirestore(id: string): Promise<void> {
  const path = 'recurring_templates';
  try {
    await deleteDoc(doc(db, path, id));
  } catch (error) {
    console.warn(`Firestore deleteRecurringTemplate warning:`, error);
  }
}

// ==========================================
// STAFF PRIVATE FINANCE (Bills & Client Ledgers)
// Isolated per Staff User ID (e.g. mohsin, shahid, danish, lahore)
// Does NOT touch or pollute Company Finance
// ==========================================

export function subscribeToStaffBills(
  staffUserId: string,
  onData: (bills: StaffLoadingBill[]) => void,
  onError?: (err: any) => void
) {
  const path = 'staff_loading_bills';
  const localKey = `dpl_staff_bills_${staffUserId.toLowerCase().trim()}`;
  
  // Quick initial load from local storage
  const cached = safeAppStorage.getJSON<StaffLoadingBill[]>(localKey, []);
  if (cached.length > 0) {
    onData(cached);
  }

  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const allBills: StaffLoadingBill[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as StaffLoadingBill;
        allBills.push({ ...data, id: docSnap.id });
      });

      // Filter by staff user ID unless admin viewing all
      const normalizedStaffId = staffUserId.toLowerCase().trim();
      const filtered = normalizedStaffId === 'admin' 
        ? allBills 
        : allBills.filter(b => (b.staffUserId || '').toLowerCase().trim() === normalizedStaffId);

      safeAppStorage.setJSON(localKey, filtered);
      onData(filtered);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const fallback = safeAppStorage.getJSON<StaffLoadingBill[]>(localKey, []);
      onData(fallback);
    }
  );
}

export async function saveStaffBillToFirestore(bill: StaffLoadingBill): Promise<void> {
  const path = 'staff_loading_bills';
  const docId = bill.id || `bill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const staffUserId = (bill.staffUserId || 'loading01').toLowerCase().trim();
  const localKey = `dpl_staff_bills_${staffUserId}`;

  try {
    const payload = sanitizeForFirestore({
      ...bill,
      id: docId,
      staffUserId,
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });

    // Notify Finance Manager and the specific Client being charged (Rule 9 & Rule 11)
    const billAmount = Number(bill.totalAmount || bill.grandTotal || 0);
    const clientTarget = bill.clientName || '';
    const isDestStaff = staffUserId.includes('dest') || staffUserId.includes('unload') || (bill.staffName || '').toLowerCase().includes('destination') || (bill.staffName || '').toLowerCase().includes('unloading');
    const staffSourceLabel = isDestStaff ? 'Destination Staff' : 'Loading Staff';

    const notifId = Date.now() + Math.floor(Math.random() * 1000);
    const notif: AppNotification = {
      id: notifId,
      title: `${staffSourceLabel} Invoice / Bill: PKR ${billAmount.toLocaleString()}`,
      description: `${staffSourceLabel} (${bill.staffName || staffUserId}) generated Bill #${bill.billNo || docId} for Case #${bill.caseNo}${clientTarget ? ` (${clientTarget})` : ''}. Amount Charged: PKR ${billAmount.toLocaleString()}`,
      details: `Case #${bill.caseNo} • Client: ${clientTarget || 'N/A'} • Container: ${bill.containerNo || bill.containerNumber || 'N/A'} • Port: ${bill.portTerminal || bill.portStation || 'Port Terminal'} • Total Charged: PKR ${billAmount.toLocaleString()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'INFO',
      notificationSubType: 'INVOICE_CHARGE_NOTIFICATION',
      status: 'PENDING',
      actionLabel: 'View Bill & Ledger',
      targetRole: clientTarget ? 'FINANCE_MANAGER,CLIENT' : 'FINANCE_MANAGER',
      targetClientName: clientTarget || undefined,
      targetFilter: { caseNo: bill.caseNo },
      targetView: 'finance',
      category: 'FINANCE'
    };
    saveNotificationToFirestore(notif).catch(() => {});
    logActivity(
      notif.title, 
      notif.description, 
      'LOADING_PORT_STAFF', 
      bill.staffName || staffUserId, 
      { caseNo: bill.caseNo, grandTotal: billAmount }
    ).catch(() => {});
  } catch (error) {
    console.warn(`Firestore saveStaffBill warning:`, error);
  }

  // Update local storage
  const current = safeAppStorage.getJSON<StaffLoadingBill[]>(localKey, []);
  const existingIdx = current.findIndex(b => b.id === docId || b.billNo === bill.billNo);
  if (existingIdx >= 0) {
    current[existingIdx] = { ...bill, id: docId };
  } else {
    current.unshift({ ...bill, id: docId });
  }
  safeAppStorage.setJSON(localKey, current);
}

export function subscribeToStaffPrivateLedger(
  staffUserId: string,
  onData: (entries: StaffPrivateLedgerEntry[]) => void,
  onError?: (err: any) => void
) {
  const path = 'staff_private_ledgers';
  const localKey = `dpl_staff_ledger_${staffUserId.toLowerCase().trim()}`;

  const cached = safeAppStorage.getJSON<StaffPrivateLedgerEntry[]>(localKey, []);
  if (cached.length > 0) {
    onData(cached);
  }

  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const allEntries: StaffPrivateLedgerEntry[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as StaffPrivateLedgerEntry;
        allEntries.push({ ...data, id: docSnap.id });
      });

      const normalizedStaffId = staffUserId.toLowerCase().trim();
      const filtered = normalizedStaffId === 'admin'
        ? allEntries
        : allEntries.filter(e => (e.staffUserId || '').toLowerCase().trim() === normalizedStaffId);

      // Sort by date ascending for ledger order
      filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      safeAppStorage.setJSON(localKey, filtered);
      onData(filtered);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const fallback = safeAppStorage.getJSON<StaffPrivateLedgerEntry[]>(localKey, []);
      onData(fallback);
    }
  );
}

export async function saveStaffPrivateLedgerEntryToFirestore(entry: StaffPrivateLedgerEntry): Promise<void> {
  const path = 'staff_private_ledgers';
  const docId = entry.id || `pled_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const staffUserId = (entry.staffUserId || 'loading01').toLowerCase().trim();
  const localKey = `dpl_staff_ledger_${staffUserId}`;

  try {
    const payload = sanitizeForFirestore({
      ...entry,
      id: docId,
      staffUserId,
      createdAt: entry.createdAt || new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });

    // Rule 11 & Rule 9: Any ledger generated to client from loading staff, destination staff, or transporter -> notify that specific Client & Finance Manager
    const chargeAmt = Number(entry.debit || entry.credit || 0);
    if (entry.clientName && chargeAmt > 0 && entry.type === 'DEBIT') {
      const isDest = staffUserId.includes('dest') || staffUserId.includes('unload') || (entry.staffName || '').toLowerCase().includes('destination');
      const isTrans = staffUserId.includes('trans') || (entry.description || '').toLowerCase().includes('rent') || (entry.description || '').toLowerCase().includes('transporter');
      const sourceLabel = isTrans ? 'Transporter' : isDest ? 'Destination Staff' : 'Loading Staff';

      saveNotificationToFirestore({
        id: Date.now() + Math.floor(Math.random() * 1000),
        title: `${sourceLabel} Ledger Charge: PKR ${chargeAmt.toLocaleString()}`,
        description: `${sourceLabel} (${entry.staffName || staffUserId}) billed PKR ${chargeAmt.toLocaleString()} to your ledger: ${entry.description || 'Port / Transport Ledger Charge'}.`,
        details: `Client Charged: ${entry.clientName}\nSource: ${sourceLabel} (${entry.staffName || staffUserId})\nDescription: ${entry.description}\nReference: ${entry.reference || 'N/A'}\nCase No: ${entry.caseNo || 'N/A'}\nAmount Charged: PKR ${chargeAmt.toLocaleString()}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'INFO',
        notificationSubType: 'INVOICE_CHARGE_NOTIFICATION',
        status: 'PENDING',
        actionLabel: 'View Client Ledger',
        targetRole: 'CLIENT,FINANCE_MANAGER',
        targetClientName: entry.clientName,
        targetFilter: entry.caseNo ? { caseNo: entry.caseNo } : undefined,
        targetView: 'finance',
        category: 'FINANCE'
      }).catch(() => {});
    }
  } catch (error) {
    console.warn(`Firestore saveStaffPrivateLedgerEntry warning:`, error);
  }

  // Update local storage
  const current = safeAppStorage.getJSON<StaffPrivateLedgerEntry[]>(localKey, []);
  const existingIdx = current.findIndex(e => e.id === docId);
  if (existingIdx >= 0) {
    current[existingIdx] = { ...entry, id: docId };
  } else {
    current.push({ ...entry, id: docId });
  }
  safeAppStorage.setJSON(localKey, current);
}

// ==========================================
// COMPANY DOCUMENTS & CATEGORIES MANAGEMENT
// ==========================================

const COMPANY_DOCS_KEY = 'dpl_company_documents';
const COMPANY_CATEGORIES_KEY = 'dpl_company_categories';

export function subscribeToCompanyDocuments(
  onData: (docs: CompanyDocument[]) => void,
  onError?: (err: any) => void
) {
  const path = 'company_documents';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const docsList: CompanyDocument[] = [];
      snapshot.forEach((docSnap) => {
        docsList.push({ ...docSnap.data(), id: docSnap.id } as CompanyDocument);
      });
      // Sort by uploadedAt desc
      docsList.sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());
      safeAppStorage.setJSON(COMPANY_DOCS_KEY, docsList);
      onData(docsList);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const fallback = safeAppStorage.getJSON<CompanyDocument[]>(COMPANY_DOCS_KEY, []);
      onData(fallback);
    }
  );
}

export async function saveCompanyDocumentToFirestore(documentItem: CompanyDocument): Promise<void> {
  const path = 'company_documents';
  const docId = documentItem.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const activeCompany = getActiveCompanyId();
  try {
    if (documentItem.fileUrl && documentItem.fileUrl.startsWith('data:')) {
      saveDocumentToIndexedDB({
        key: docId,
        id: docId,
        name: documentItem.fileName || documentItem.title || docId,
        type: documentItem.fileType || 'application/pdf',
        size: documentItem.fileSize || documentItem.fileUrl.length,
        dataUrl: documentItem.fileUrl
      }).catch(() => {});
    }
    const cloudReadyDoc = await offloadLargeDataUrlsToCloudChunks(
      {
        ...documentItem,
        companyId: documentItem.companyId || activeCompany,
        id: docId,
        updatedAt: new Date().toISOString()
      },
      `compdoc_${docId}`
    );
    const payload = sanitizeForFirestore(cloudReadyDoc);
    await setDoc(doc(db, path, docId), payload, { merge: true });

    // Smart Notification Engine:
    // 1. Validity / Expiry Alarm (X days before expiration configured via alarmDaysBefore, default 15d)
    const alarmLeadDays =
      typeof documentItem.alarmDaysBefore === 'number' && documentItem.alarmDaysBefore > 0
        ? documentItem.alarmDaysBefore
        : 15;
    const effectiveExpiry = documentItem.expiryDate || documentItem.validityEndDate;
    const hasExpiry =
      documentItem.hasExpiryDate !== undefined
        ? documentItem.hasExpiryDate
        : !documentItem.unlimitedValidity;
    const isClosedDoc = documentItem.statusTag === 'Resolved' || documentItem.statusTag === 'Archived';
    const folderLabel = documentItem.folderPath || documentItem.category || 'Company Documents';
    const authorLabel = documentItem.createdByAuthor || 'N/A';
    const sourceLabel = documentItem.sourceOrigin || documentItem.senderIssuer || documentItem.from || 'N/A';
    const issuedToLabel = documentItem.issuedTo || documentItem.recipientEntity || documentItem.to || 'N/A';

    if (hasExpiry && effectiveExpiry && !isClosedDoc) {
      const todayTime = new Date(new Date().toISOString().split('T')[0]).getTime();
      const expTime = new Date(effectiveExpiry).getTime();
      if (!isNaN(expTime)) {
        const diffDays = Math.ceil((expTime - todayTime) / (24 * 60 * 60 * 1000));
        if (diffDays <= alarmLeadDays) {
          saveNotificationToFirestore({
            id: Date.now() + Math.floor(Math.random() * 1000),
            title:
              diffDays <= 0
                ? `Document Expired: ${documentItem.title}`
                : `Expiry Alarm (${diffDays}d left): ${documentItem.title}`,
            description:
              diffDays <= 0
                ? `"${documentItem.title}" (Issued To: ${issuedToLabel}) expired on ${effectiveExpiry}.`
                : `"${documentItem.title}" (${folderLabel}) expires in ${diffDays} day(s) on ${effectiveExpiry}.`,
            details: `Document Title: ${documentItem.title}\nFolder Path: ${folderLabel}\nCreated By: ${authorLabel}\nSource / Origin: ${sourceLabel}\nIssued To: ${issuedToLabel}\nExpiry Date: ${effectiveExpiry}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'ALERT',
            notificationSubType: 'DOC_EXPIRY_ALERT',
            status: 'PENDING',
            actionLabel: 'Open Company Documents',
            priority: 'HIGH',
            targetRole: 'ADMIN,DOCUMENTATION_MANAGER',
            category: 'GENERAL',
            targetView: 'company_documents'
          }).catch(() => {});
        }
      }
    }

    // 2. Scheduled Hearing Date Countdown Alarm
    const hasHearing =
      documentItem.hasHearingDate !== undefined
        ? documentItem.hasHearingDate
        : Boolean(documentItem.hearingDate);
    if (hasHearing && documentItem.hearingDate && !isClosedDoc) {
      const todayTime = new Date(new Date().toISOString().split('T')[0]).getTime();
      const hearTime = new Date(documentItem.hearingDate).getTime();
      if (!isNaN(hearTime)) {
        const hearDiffDays = Math.ceil((hearTime - todayTime) / (24 * 60 * 60 * 1000));
        if (hearDiffDays <= Math.max(7, alarmLeadDays)) {
          saveNotificationToFirestore({
            id: Date.now() + Math.floor(Math.random() * 1000) + 17,
            title:
              hearDiffDays < 0
                ? `Hearing Overdue (${Math.abs(hearDiffDays)}d): ${documentItem.title}`
                : hearDiffDays === 0
                  ? `Hearing Scheduled TODAY: ${documentItem.title}`
                  : `Upcoming Hearing in ${hearDiffDays}d: ${documentItem.title}`,
            description: `Scheduled Hearing on ${documentItem.hearingDate} for "${documentItem.title}" (Source: ${sourceLabel}).`,
            details: `Document Title: ${documentItem.title}\nFolder Path: ${folderLabel}\nCreated By: ${authorLabel}\nSource / Origin: ${sourceLabel}\nIssued To: ${issuedToLabel}\nHearing Date: ${documentItem.hearingDate}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'ACTION',
            notificationSubType: 'LEGAL_HEARING_ALERT',
            status: 'PENDING',
            actionLabel: 'Open Company Documents',
            priority: 'HIGH',
            targetRole: 'ADMIN,DOCUMENTATION_MANAGER',
            category: 'GENERAL',
            targetView: 'company_documents'
          }).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.warn(`Firestore saveCompanyDocument warning for ${docId}:`, error);
  }

  // Update local cache
  const current = safeAppStorage.getJSON<CompanyDocument[]>(COMPANY_DOCS_KEY, []);
  const idx = current.findIndex(d => d.id === docId);
  if (idx >= 0) {
    current[idx] = { ...documentItem, companyId: documentItem.companyId || activeCompany, id: docId };
  } else {
    current.unshift({ ...documentItem, companyId: documentItem.companyId || activeCompany, id: docId });
  }
  safeAppStorage.setJSON(COMPANY_DOCS_KEY, current);
}

export async function deleteCompanyDocumentFromFirestore(docId: string): Promise<void> {
  const path = 'company_documents';
  try {
    await deleteDoc(doc(db, path, docId));
  } catch (error) {
    console.warn(`Firestore deleteCompanyDocument warning for ${docId}:`, error);
  }

  const current = safeAppStorage.getJSON<CompanyDocument[]>(COMPANY_DOCS_KEY, []);
  safeAppStorage.setJSON(COMPANY_DOCS_KEY, current.filter(d => d.id !== docId));
}

// =========================================================
// RECURSIVE WINDOWS EXPLORER FOLDERS FOR COMPANY DOCUMENTS
// =========================================================
const COMPANY_EXPLORER_FOLDERS_KEY = 'dpl_company_explorer_folders';

export function subscribeToCompanyExplorerFolders(
  onData: (folders: CompanyExplorerFolder[]) => void,
  onError?: (err: any) => void
) {
  const path = 'company_document_folders';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const foldersList: CompanyExplorerFolder[] = [];
      snapshot.forEach((docSnap) => {
        const raw = docSnap.data() as CompanyExplorerFolder;
        foldersList.push({
          ...raw,
          id: docSnap.id,
          parentFolderId: raw.parentFolderId || null
        });
      });
      foldersList.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
      safeAppStorage.setJSON(COMPANY_EXPLORER_FOLDERS_KEY, foldersList);
      onData(foldersList);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const fallback = safeAppStorage.getJSON<CompanyExplorerFolder[]>(COMPANY_EXPLORER_FOLDERS_KEY, []);
      onData(fallback);
    }
  );
}

export async function saveCompanyExplorerFolderToFirestore(folderItem: CompanyExplorerFolder): Promise<void> {
  const path = 'company_document_folders';
  const folderId = folderItem.id || `cfolder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const activeCompany = getActiveCompanyId();
  const record: CompanyExplorerFolder = {
    ...folderItem,
    id: folderId,
    companyId: folderItem.companyId || activeCompany,
    parentFolderId: folderItem.parentFolderId || null,
    updatedAt: new Date().toISOString()
  };

  try {
    await setDoc(doc(db, path, folderId), sanitizeForFirestore(record), { merge: true });
  } catch (error) {
    console.warn(`Firestore saveCompanyExplorerFolder warning for ${folderId}:`, error);
  }

  const current = safeAppStorage.getJSON<CompanyExplorerFolder[]>(COMPANY_EXPLORER_FOLDERS_KEY, []);
  const idx = current.findIndex((f) => f.id === folderId);
  if (idx >= 0) current[idx] = record;
  else current.push(record);
  current.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  safeAppStorage.setJSON(COMPANY_EXPLORER_FOLDERS_KEY, current);
}

export async function deleteCompanyExplorerFolderFromFirestore(folderId: string): Promise<void> {
  const path = 'company_document_folders';
  try {
    await deleteDoc(doc(db, path, folderId));
  } catch (error) {
    console.warn(`Firestore deleteCompanyExplorerFolder warning for ${folderId}:`, error);
  }

  const current = safeAppStorage.getJSON<CompanyExplorerFolder[]>(COMPANY_EXPLORER_FOLDERS_KEY, []);
  safeAppStorage.setJSON(
    COMPANY_EXPLORER_FOLDERS_KEY,
    current.filter((f) => f.id !== folderId)
  );
}

// =========================================================
// DYNAMIC CORPORATE LEGAL CASES & SECURE VAULT CREDENTIALS
// =========================================================
const CORPORATE_LEGAL_CASES_KEY = 'dpl_corporate_legal_cases';
const CORPORATE_VAULT_CREDS_KEY = 'dpl_corporate_vault_credentials';

export function subscribeToCorporateLegalCases(
  onData: (cases: CorporateLegalCase[]) => void,
  onError?: (err: any) => void
) {
  const path = 'corporate_legal_cases';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const list: CorporateLegalCase[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ ...(docSnap.data() as CorporateLegalCase), id: docSnap.id });
      });
      list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      safeAppStorage.setJSON(CORPORATE_LEGAL_CASES_KEY, list);
      onData(list);
    },
    (error: any) => {
      if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      onData(safeAppStorage.getJSON<CorporateLegalCase[]>(CORPORATE_LEGAL_CASES_KEY, []));
    }
  );
}

export async function saveCorporateLegalCaseToFirestore(legalCase: CorporateLegalCase): Promise<void> {
  const path = 'corporate_legal_cases';
  const caseId = legalCase.id || `lcase_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const activeCompany = getActiveCompanyId();
  const record: CorporateLegalCase = {
    ...legalCase,
    id: caseId,
    companyId: legalCase.companyId || activeCompany,
    updatedAt: new Date().toISOString()
  };

  try {
    await setDoc(doc(db, path, caseId), sanitizeForFirestore(record), { merge: true });
  } catch (error: any) {
    if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.WRITE, `${path}/${caseId}`);
    }
    console.warn(`Firestore saveCorporateLegalCase warning for ${caseId}:`, error);
  }

  const current = safeAppStorage.getJSON<CorporateLegalCase[]>(CORPORATE_LEGAL_CASES_KEY, []);
  const idx = current.findIndex((c) => c.id === caseId);
  if (idx >= 0) current[idx] = record;
  else current.unshift(record);
  safeAppStorage.setJSON(CORPORATE_LEGAL_CASES_KEY, current);
}

export async function deleteCorporateLegalCaseFromFirestore(caseId: string): Promise<void> {
  const path = 'corporate_legal_cases';
  try {
    await deleteDoc(doc(db, path, caseId));
  } catch (error: any) {
    if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.DELETE, `${path}/${caseId}`);
    }
    console.warn(`Firestore deleteCorporateLegalCase warning for ${caseId}:`, error);
  }
  const current = safeAppStorage.getJSON<CorporateLegalCase[]>(CORPORATE_LEGAL_CASES_KEY, []);
  safeAppStorage.setJSON(CORPORATE_LEGAL_CASES_KEY, current.filter((c) => c.id !== caseId));
}

export function subscribeToCorporateVaultCredentials(
  onData: (items: CorporateVaultCredential[]) => void,
  onError?: (err: any) => void
) {
  const path = 'corporate_vault_credentials';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const list: CorporateVaultCredential[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ ...(docSnap.data() as CorporateVaultCredential), id: docSnap.id });
      });
      list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      safeAppStorage.setJSON(CORPORATE_VAULT_CREDS_KEY, list);
      onData(list);
    },
    (error: any) => {
      if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      onData(safeAppStorage.getJSON<CorporateVaultCredential[]>(CORPORATE_VAULT_CREDS_KEY, []));
    }
  );
}

export async function saveCorporateVaultCredentialToFirestore(cred: CorporateVaultCredential): Promise<void> {
  const path = 'corporate_vault_credentials';
  const credId = cred.id || `vault_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const activeCompany = getActiveCompanyId();
  const record: CorporateVaultCredential = {
    ...cred,
    id: credId,
    companyId: cred.companyId || activeCompany,
    updatedAt: new Date().toISOString()
  };

  try {
    await setDoc(doc(db, path, credId), sanitizeForFirestore(record), { merge: true });
  } catch (error: any) {
    if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.WRITE, `${path}/${credId}`);
    }
    console.warn(`Firestore saveCorporateVaultCredential warning for ${credId}:`, error);
  }

  const current = safeAppStorage.getJSON<CorporateVaultCredential[]>(CORPORATE_VAULT_CREDS_KEY, []);
  const idx = current.findIndex((c) => c.id === credId);
  if (idx >= 0) current[idx] = record;
  else current.unshift(record);
  safeAppStorage.setJSON(CORPORATE_VAULT_CREDS_KEY, current);
}

export async function deleteCorporateVaultCredentialFromFirestore(credId: string): Promise<void> {
  const path = 'corporate_vault_credentials';
  try {
    await deleteDoc(doc(db, path, credId));
  } catch (error: any) {
    if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.DELETE, `${path}/${credId}`);
    }
    console.warn(`Firestore deleteCorporateVaultCredential warning for ${credId}:`, error);
  }
  const current = safeAppStorage.getJSON<CorporateVaultCredential[]>(CORPORATE_VAULT_CREDS_KEY, []);
  safeAppStorage.setJSON(CORPORATE_VAULT_CREDS_KEY, current.filter((c) => c.id !== credId));
}

export function subscribeToCompanyCategories(
  onData: (categories: string[]) => void,
  onError?: (err: any) => void
) {
  const path = 'company_document_categories';
  return onSnapshot(
    collection(db, path),
    async (snapshot) => {
      if (snapshot.empty) {
        try {
          for (const catName of DEFAULT_COMPANY_DOCUMENT_CATEGORIES) {
            const catId = catName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            await setDoc(doc(db, path, catId), { name: catName, createdAt: new Date().toISOString() });
          }
          safeAppStorage.setJSON(COMPANY_CATEGORIES_KEY, DEFAULT_COMPANY_DOCUMENT_CATEGORIES);
          onData(DEFAULT_COMPANY_DOCUMENT_CATEGORIES);
          return;
        } catch (seedErr) {
          console.warn('Failed to seed company categories:', seedErr);
        }
      }

      const catList: string[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.name && !catList.includes(d.name)) {
          catList.push(d.name);
        }
      });

      DEFAULT_COMPANY_DOCUMENT_CATEGORIES.forEach(def => {
        if (!catList.includes(def)) catList.push(def);
      });

      safeAppStorage.setJSON(COMPANY_CATEGORIES_KEY, catList);
      onData(catList);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const fallback = safeAppStorage.getJSON<string[]>(COMPANY_CATEGORIES_KEY, DEFAULT_COMPANY_DOCUMENT_CATEGORIES);
      onData(fallback);
    }
  );
}

export async function saveCompanyCategoryToFirestore(categoryName: string): Promise<void> {
  const path = 'company_document_categories';
  const cleanName = categoryName.trim();
  if (!cleanName) return;

  const catId = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  try {
    await setDoc(doc(db, path, catId), {
      name: cleanName,
      createdAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.warn(`Firestore saveCompanyCategory warning for ${cleanName}:`, error);
  }

  const current = safeAppStorage.getJSON<string[]>(COMPANY_CATEGORIES_KEY, DEFAULT_COMPANY_DOCUMENT_CATEGORIES);
  if (!current.includes(cleanName)) {
    current.push(cleanName);
    safeAppStorage.setJSON(COMPANY_CATEGORIES_KEY, current);
  }
}

// ==========================================
// PERSONAL LEDGERS (PRIVATE PER USER ID)
// ==========================================

const PERSONAL_LEDGER_ACCOUNTS_KEY = 'dpl_personal_ledger_accounts';
const PERSONAL_LEDGER_ENTRIES_KEY = 'dpl_personal_ledger_entries';

export function subscribeToPersonalLedgerAccounts(
  onData: (accounts: PersonalLedgerAccount[]) => void,
  onError?: (err: any) => void
) {
  const path = 'personal_ledger_accounts';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const items: PersonalLedgerAccount[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ ...docSnap.data(), id: docSnap.id } as PersonalLedgerAccount);
      });
      safeAppStorage.setJSON(PERSONAL_LEDGER_ACCOUNTS_KEY, items);
      onData(items);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const fallback = safeAppStorage.getJSON<PersonalLedgerAccount[]>(PERSONAL_LEDGER_ACCOUNTS_KEY, []);
      onData(fallback);
    }
  );
}

export function subscribeToPersonalLedgerEntries(
  onData: (entries: PersonalLedgerEntry[]) => void,
  onError?: (err: any) => void
) {
  const path = 'personal_ledger_entries';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const items: PersonalLedgerEntry[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ ...docSnap.data(), id: docSnap.id } as PersonalLedgerEntry);
      });
      safeAppStorage.setJSON(PERSONAL_LEDGER_ENTRIES_KEY, items);
      onData(items);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const fallback = safeAppStorage.getJSON<PersonalLedgerEntry[]>(PERSONAL_LEDGER_ENTRIES_KEY, []);
      onData(fallback);
    }
  );
}

export async function savePersonalLedgerAccount(account: PersonalLedgerAccount): Promise<void> {
  const path = 'personal_ledger_accounts';
  const docId = account.id || `placct_${Date.now()}`;
  const activeCompany = getActiveCompanyId();
  try {
    const payload = sanitizeForFirestore({
      ...account,
      companyId: account.companyId || activeCompany,
      id: docId,
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
  } catch (error) {
    console.warn(`Firestore savePersonalLedgerAccount warning for ${docId}:`, error);
  }

  // Update local storage
  const current = safeAppStorage.getJSON<PersonalLedgerAccount[]>(PERSONAL_LEDGER_ACCOUNTS_KEY, []);
  const idx = current.findIndex(a => a.id === docId);
  if (idx >= 0) {
    current[idx] = { ...account, companyId: account.companyId || activeCompany, id: docId };
  } else {
    current.unshift({ ...account, companyId: account.companyId || activeCompany, id: docId });
  }
  safeAppStorage.setJSON(PERSONAL_LEDGER_ACCOUNTS_KEY, current);
}

export async function deletePersonalLedgerAccount(accountId: string): Promise<void> {
  const path = 'personal_ledger_accounts';
  try {
    await deleteDoc(doc(db, path, accountId));
  } catch (error) {
    console.warn(`Firestore deletePersonalLedgerAccount warning:`, error);
  }

  const current = safeAppStorage.getJSON<PersonalLedgerAccount[]>(PERSONAL_LEDGER_ACCOUNTS_KEY, []);
  safeAppStorage.setJSON(PERSONAL_LEDGER_ACCOUNTS_KEY, current.filter(a => a.id !== accountId));
}

export async function savePersonalLedgerEntry(entry: PersonalLedgerEntry): Promise<void> {
  const path = 'personal_ledger_entries';
  const docId = entry.id || `plentry_${Date.now()}`;
  const activeCompany = getActiveCompanyId();
  try {
    const payload = sanitizeForFirestore({
      ...entry,
      companyId: entry.companyId || activeCompany,
      id: docId,
      createdAt: entry.createdAt || new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
  } catch (error) {
    console.warn(`Firestore savePersonalLedgerEntry warning for ${docId}:`, error);
  }

  // Update local storage
  const current = safeAppStorage.getJSON<PersonalLedgerEntry[]>(PERSONAL_LEDGER_ENTRIES_KEY, []);
  const idx = current.findIndex(e => e.id === docId);
  if (idx >= 0) {
    current[idx] = { ...entry, companyId: entry.companyId || activeCompany, id: docId };
  } else {
    current.unshift({ ...entry, companyId: entry.companyId || activeCompany, id: docId });
  }
  safeAppStorage.setJSON(PERSONAL_LEDGER_ENTRIES_KEY, current);
}

export async function deletePersonalLedgerEntry(entryId: string): Promise<void> {
  const path = 'personal_ledger_entries';
  try {
    await deleteDoc(doc(db, path, entryId));
  } catch (error) {
    console.warn(`Firestore deletePersonalLedgerEntry warning:`, error);
  }

  const current = safeAppStorage.getJSON<PersonalLedgerEntry[]>(PERSONAL_LEDGER_ENTRIES_KEY, []);
  safeAppStorage.setJSON(PERSONAL_LEDGER_ENTRIES_KEY, current.filter(e => e.id !== entryId));
}

// ==========================================
// CLOUD-SYNCED USER WORK DRAFTS (AUTO-SAVE ACROSS DISCONNECTIONS)
// Ensures any in-progress registration or form work is saved online in Firestore
// per user so the user can Resume or Discard upon login from any device or after disconnect
// ==========================================

export interface UserWorkDraft {
  id: string;
  userId: string;
  userName?: string;
  role?: string;
  companyId: CompanyId;
  draftType: 'CASE_REGISTRATION' | 'FINANCE_ENTRY' | 'VEHICLE_REGISTRATION';
  step?: number;
  caseNo?: string;
  formData?: any;
  docs?: any;
  updatedAt: string;
  active: boolean;
}

export async function saveUserWorkDraftToFirestore(userId: string, draft: Omit<UserWorkDraft, 'id' | 'userId'>): Promise<void> {
  const cleanUser = (userId || 'admin').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_');
  const docId = `draft_${cleanUser}`;
  const payload = sanitizeForFirestore({
    ...draft,
    id: docId,
    userId: cleanUser,
    updatedAt: draft.updatedAt || new Date().toISOString(),
    active: true
  });

  // Always save locally immediately for instant zero-latency recovery
  safeAppStorage.setJSON(`dpl_cloud_draft_${cleanUser}`, payload);

  try {
    await setDoc(doc(db, 'work_drafts', docId), payload, { merge: true });
  } catch (error) {
    // Fallback to settings collection if work_drafts rules haven't propagated yet
    try {
      await setDoc(doc(db, 'settings', `work_draft_${cleanUser}`), payload, { merge: true });
    } catch (_) {}
  }
}

export async function getUserWorkDraftFromFirestore(userId: string): Promise<UserWorkDraft | null> {
  const cleanUser = (userId || 'admin').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_');
  const docId = `draft_${cleanUser}`;

  try {
    const snap = await executeWithTimeout(getDoc(doc(db, 'work_drafts', docId)), 2500, null);
    if (snap && snap.exists()) {
      const data = snap.data() as UserWorkDraft;
      if (data && data.active) {
        safeAppStorage.setJSON(`dpl_cloud_draft_${cleanUser}`, data);
        return data;
      }
    }
    const fallbackSnap = await executeWithTimeout(getDoc(doc(db, 'settings', `work_draft_${cleanUser}`)), 2000, null);
    if (fallbackSnap && fallbackSnap.exists()) {
      const data = fallbackSnap.data() as UserWorkDraft;
      if (data && data.active) {
        safeAppStorage.setJSON(`dpl_cloud_draft_${cleanUser}`, data);
        return data;
      }
    }
  } catch (e) {
    console.warn('Cloud work draft fetch notice:', e);
  }

  const localDraft = safeAppStorage.getJSON<UserWorkDraft | null>(`dpl_cloud_draft_${cleanUser}`, null);
  if (localDraft && localDraft.active) {
    return localDraft;
  }
  return null;
}

export async function deleteUserWorkDraftFromFirestore(userId: string): Promise<void> {
  const cleanUser = (userId || 'admin').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_');
  const docId = `draft_${cleanUser}`;
  safeAppStorage.removeItem(`dpl_cloud_draft_${cleanUser}`);

  try {
    await deleteDoc(doc(db, 'work_drafts', docId));
  } catch (_) {}
  try {
    await setDoc(doc(db, 'settings', `work_draft_${cleanUser}`), { active: false, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (_) {}
}

// ============================================================================
// STANDARDIZED USER CREDENTIALS AUTO-GENERATION (FullNameWithoutSpaces + 01/02)
// ============================================================================
export const DEFAULT_USER_PASSWORD = 'Docks01234';

/**
 * Generates a unique User ID from the user's Full Name without spaces.
 * If another user already has that User ID, appends 01, 02, 03, etc. (folder-style).
 */
export function generateUniqueUsernameFromFullName(
  fullName: string,
  existingUsers?: Array<{ id?: number | string; userId?: string }>,
  excludeRecord?: { id?: number | string; currentUserId?: string }
): string {
  const base = (fullName || '').trim().replace(/[^a-zA-Z0-9]/g, '');
  if (!base) return '';

  const takenLower = new Set<string>();
  const excludeIdStr = excludeRecord?.id !== undefined && excludeRecord?.id !== null ? String(excludeRecord.id) : null;
  const excludeUserLower = excludeRecord?.currentUserId ? excludeRecord.currentUserId.trim().toLowerCase() : null;

  const collect = (items: Array<{ id?: number | string; userId?: string }>) => {
    for (const item of items) {
      if (!item || !item.userId) continue;
      if (excludeIdStr && item.id !== undefined && String(item.id) === excludeIdStr) continue;
      const uidLower = item.userId.trim().toLowerCase();
      if (!uidLower) continue;
      if (excludeUserLower && uidLower === excludeUserLower) continue;
      takenLower.add(uidLower);
    }
  };

  if (Array.isArray(existingUsers)) collect(existingUsers);
  collect(safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || []);
  collect(safeAppStorage.getJSON<Client[]>('dpl_cached_clients', []) || []);
  collect(safeAppStorage.getJSON<Client[]>('dpl_live_clients', []) || []);
  collect(safeAppStorage.getJSON<DestinationStaff[]>('dpl_destination_staff', []) || []);

  if (!takenLower.has(base.toLowerCase())) {
    return base;
  }

  for (let counter = 1; counter <= 999; counter++) {
    const suffix = String(counter).padStart(2, '0');
    const candidate = `${base}${suffix}`;
    if (!takenLower.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${base}${Date.now().toString().slice(-3)}`;
}

// ============================================================================
// COMPANY-SCOPED FINANCE OFFICE SALARY STAFF (`salary_staff`) & MONTH-END PAYROLL
// ============================================================================
const SALARY_STAFF_STORAGE_KEY = 'dpl_salary_staff';

export function getSalaryStaffDesignationRank(designation?: string): number {
  const norm = (designation || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!norm || norm === '-' || norm === 'N/A' || norm === 'NONE') return 999;

  if (/\b(CHAIRMAN|CEO|CHIEF EXECUTIVE|MANAGING DIRECTOR|M\.?D\.?|PROPRIETOR|OWNER)\b/.test(norm)) return 10;
  if (/\bDIRECTOR\b/.test(norm)) return 20;
  if (/\b(GENERAL MANAGER|G\.?M\.?)\b/.test(norm)) return 30;
  if (/\bFINANCE\s+MANAGER\b/.test(norm)) return 40;
  if (/\bOPERATIONS?\s+MANAGER\b/.test(norm)) return 41;
  if (/\bDOCUMENTATION\s+MANAGER\b/.test(norm)) return 42;
  if (/\bMANAGER\b/.test(norm)) return 45;
  if (/\b(HEAD|LEAD|SUPERVISOR|COORDINATOR)\b/.test(norm)) return 50;
  if (/\bINCHARGE\b/.test(norm)) return 55;
  if (/\b(ACCOUNTANT|ACCOUNTS\s+OFFICER|OFFICER|EXECUTIVE)\b/.test(norm)) return 60;
  if (/\b(PORT\s+STAFF|OFFICE\s+STAFF|OFFICE\s+ASSISTANT|ASSISTANT|CLERK|DATA\s+ENTRY|RECEPTIONIST|OPERATOR|STAFF)\b/.test(norm)) return 65;
  if (/\bDRIVER\b/.test(norm)) return 75;
  if (/\bRIDER\b/.test(norm)) return 80;
  if (/\b(GUARD|SECURITY|WATCHMAN|CHOWKIDAR)\b/.test(norm)) return 85;
  if (/\b(PEON|OFFICE\s+BOY)\b/.test(norm)) return 90;
  if (/\b(SWEEPER|CLEANER|JANITOR|HELPER)\b/.test(norm)) return 95;

  return 70;
}

export function sortSalaryStaffByDesignation(items: SalaryStaffMember[]): SalaryStaffMember[] {
  return [...items].sort((a, b) => {
    const rankA = getSalaryStaffDesignationRank(a.designation);
    const rankB = getSalaryStaffDesignationRank(b.designation);
    if (rankA !== rankB) return rankA - rankB;

    const desA = (a.designation || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const desB = (b.designation || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (desA !== desB) return desA.localeCompare(desB);

    const nameA = (a.name || '').trim().toUpperCase();
    const nameB = (b.name || '').trim().toUpperCase();
    return nameA.localeCompare(nameB);
  });
}

export function getStoredSalaryStaff(companyIdFilter?: string): SalaryStaffMember[] {
  const all = sortSalaryStaffByDesignation(
    safeAppStorage.getJSON<SalaryStaffMember[]>(SALARY_STAFF_STORAGE_KEY, []) || []
  );
  if (!companyIdFilter) return all;
  return all.filter((s) => (s.companyId || 'docks') === companyIdFilter);
}

export function subscribeToSalaryStaff(
  onData: (items: SalaryStaffMember[]) => void,
  options?: { allCompanies?: boolean }
): () => void {
  const path = 'salary_staff';
  let cachedDocs: SalaryStaffMember[] = getStoredSalaryStaff();
  let hasSnapshot = false;

  const emit = () => {
    const activeCompany = getActiveCompanyId();
    const filtered = options?.allCompanies
      ? cachedDocs
      : cachedDocs.filter((s) => (s.companyId || 'docks') === activeCompany);
    onData(sortSalaryStaffByDesignation(filtered));
  };

  emit();

  const unsubCompany = subscribeToActiveCompany(() => {
    emit();
  });

  let unsubFirestore = () => {};
  if (db) {
    try {
      unsubFirestore = onSnapshot(
        collection(db, path),
        (snapshot) => {
          hasSnapshot = true;
          const firestoreList: SalaryStaffMember[] = [];
          snapshot.forEach((docSnap) => {
            const d = docSnap.data() as SalaryStaffMember;
            if (d && d.name) {
              firestoreList.push({
                ...d,
                id: d.id || docSnap.id,
                companyId: d.companyId || 'docks'
              });
            }
          });
          // Merge any optimistic local items not yet reflected if snapshot is empty on offline cache
          const localOnly = getStoredSalaryStaff().filter(
            (loc) => !firestoreList.some((rem) => rem.id === loc.id)
          );
          const combined = snapshot.empty && !hasSnapshot
            ? getStoredSalaryStaff()
            : [...firestoreList, ...(snapshot.metadata.fromCache ? localOnly : [])];
          cachedDocs = sortSalaryStaffByDesignation(combined);
          safeAppStorage.setJSON(SALARY_STAFF_STORAGE_KEY, cachedDocs);
          emit();
        },
        (err) => {
          console.warn('subscribeToSalaryStaff notice:', err);
        }
      );
    } catch (err) {
      console.warn('subscribeToSalaryStaff setup notice:', err);
    }
  }

  return () => {
    unsubFirestore();
    unsubCompany();
  };
}

export async function saveSalaryStaffToFirestore(staff: SalaryStaffMember): Promise<SalaryStaffMember> {
  const path = 'salary_staff';
  const activeCompany = getActiveCompanyId();
  const staffId = staff.id || `sal_staff_${Date.now()}`;

  // Offload oversized attachments (>360KB, e.g. multi-page CNIC PDFs) to cloud chunks so Firestore 1MB doc limit is never exceeded
  const maybeOffload = async (val: string | undefined, fieldKey: string): Promise<string> => {
    const cleanVal = (val || '').trim();
    if (!cleanVal) return '';
    if (cleanVal.startsWith('data:') && cleanVal.length > 360000) {
      try {
        const mimeMatch = cleanVal.match(/^data:([^;]+);/);
        const chunkUri = await saveDocumentToCloudChunks({
          docKey: sanitizeCloudDocKey(`salary_staff_${staffId}_${fieldKey}`),
          name: `${staffId}_${fieldKey}`,
          mimeType: mimeMatch?.[1] || 'application/octet-stream',
          size: cleanVal.length,
          dataUrl: cleanVal
        });
        return chunkUri || cleanVal;
      } catch (err) {
        console.warn(`Salary staff ${fieldKey} chunk offload notice:`, err);
      }
    }
    return cleanVal;
  };

  const [photoUrl, cnicFrontUrl, cnicBackUrl] = await Promise.all([
    maybeOffload(staff.photoUrl, 'photo'),
    maybeOffload(staff.cnicFrontUrl, 'cnic_front'),
    maybeOffload(staff.cnicBackUrl, 'cnic_back')
  ]);

  const normalized: SalaryStaffMember = {
    ...staff,
    id: staffId,
    companyId: staff.companyId || activeCompany,
    name: (staff.name || '').trim(),
    fatherName: (staff.fatherName || '').trim(),
    designation: (staff.designation || '').trim(),
    primaryContact: (staff.primaryContact || '').trim(),
    residentialContact: (staff.residentialContact || '').trim(),
    residentialAddress: (staff.residentialAddress || '').trim(),
    totalSalary: Number(staff.totalSalary) || 0,
    photoUrl,
    cnicFrontUrl,
    cnicBackUrl,
    status: staff.status || 'ACTIVE',
    createdAt: staff.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const current = getStoredSalaryStaff();
  const updated = sortSalaryStaffByDesignation([
    normalized,
    ...current.filter((s) => s.id !== normalized.id)
  ]);
  safeAppStorage.setJSON(SALARY_STAFF_STORAGE_KEY, updated);

  if (db) {
    try {
      await setDoc(doc(db, path, normalized.id), sanitizeForFirestore(normalized), { merge: true });
    } catch (err) {
      console.warn('saveSalaryStaffToFirestore notice:', err);
      throw err;
    }
  }

  return normalized;
}

export async function deleteSalaryStaffFromFirestore(staffId: string): Promise<void> {
  const path = 'salary_staff';
  const current = getStoredSalaryStaff().filter((s) => s.id !== staffId);
  safeAppStorage.setJSON(SALARY_STAFF_STORAGE_KEY, current);

  if (db) {
    try {
      await deleteDoc(doc(db, path, staffId));
    } catch (err) {
      console.warn('deleteSalaryStaffFromFirestore notice:', err);
    }
  }
}

function getLastDayOfYearMonth(year: number, monthOneBased: number): number {
  return new Date(year, monthOneBased, 0).getDate();
}

/**
 * Automatically generates monthly salary on the last date of each completed month
 * and posts it into Finance Payables AFTER 12:00 AM midnight following the last day of that month
 * (`now >= 00:00:00` of the 1st of the next month).
 * Each salary entry stays strictly inside the company (`staff.companyId`) where that staff member was added.
 */
let isSyncingCompletedSalaries = false;

export async function syncCompletedMonthSalaryStaffToPayables(options?: {
  nowOverride?: Date;
  existingPayables?: FinanceEntry[];
}): Promise<FinanceEntry[]> {
  if (isSyncingCompletedSalaries) return [];
  isSyncingCompletedSalaries = true;

  try {
    const now = options?.nowOverride || new Date();
    // All salaries & payables begin generating from Next Month 1st (2026-12-01 00:00:00)
    const effectiveStart = new Date(2026, 11, 1, 0, 0, 0, 0);
    if (now.getTime() < effectiveStart.getTime()) return [];

    // Load all SalaryStaffMember records from local cache + Firestore
    let allStaff = getStoredSalaryStaff();
    if (db) {
      try {
        const snap = await getDocs(collection(db, 'salary_staff'));
        if (!snap.empty) {
          const remote: SalaryStaffMember[] = [];
          snap.forEach((ds) => {
            const d = ds.data() as SalaryStaffMember;
            if (d && d.name) {
              remote.push({ ...d, id: d.id || ds.id, companyId: d.companyId || 'docks' });
            }
          });
          allStaff = remote;
          safeAppStorage.setJSON(SALARY_STAFF_STORAGE_KEY, remote);
        }
      } catch (_) {}
    }

    const activeStaff = allStaff.filter(
      (s) => s && s.status !== 'INACTIVE' && Number(s.totalSalary) > 0
    );
    if (activeStaff.length === 0) return [];

    // Load existing finance entries across all companies to prevent duplicate salary postings
    let allFinances: FinanceEntry[] = [
      ...(options?.existingPayables || []),
      ...(safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []) || []),
      ...(safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []) || [])
    ];
    if (db) {
      try {
        const fSnap = await getDocs(collection(db, 'finances'));
        fSnap.forEach((ds) => {
          allFinances.push(ds.data() as FinanceEntry);
        });
      } catch (_) {}
    }

    // Latest completed month whose last date + 12:00 AM midnight has ALREADY passed:
    // At 00:00:00 on day 1 of month M, month (M - 1)'s last day has just passed 12:00 AM midnight!
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const maxCompletedYear = prevMonthDate.getFullYear();
    const maxCompletedMonth = prevMonthDate.getMonth() + 1; // 1..12
    const maxCompletedYm = `${maxCompletedYear}-${String(maxCompletedMonth).padStart(2, '0')}`;

    const newlyPosted: FinanceEntry[] = [];

    for (const staff of activeStaff) {
      const staffCompany = staff.companyId || 'docks';
      const createdDate = staff.createdAt ? new Date(staff.createdAt) : now;
      const startYear = isNaN(createdDate.getTime()) ? now.getFullYear() : createdDate.getFullYear();
      const startMonth = isNaN(createdDate.getTime()) ? now.getMonth() + 1 : createdDate.getMonth() + 1;
      const startYm = `${startYear}-${String(startMonth).padStart(2, '0')}`;

      // If staff was added in the current month (e.g. Nov 2026), their first month-end + 12:00 AM has not passed yet
      if (startYm > maxCompletedYm) continue;

      let cursorYear = startYear;
      let cursorMonth = startMonth;
      let safetyCounter = 0;

      while (
        `${cursorYear}-${String(cursorMonth).padStart(2, '0')}` <= maxCompletedYm &&
        safetyCounter < 36
      ) {
        safetyCounter++;
        const ym = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}`;

        // Verify current clock is strictly past 12:00 AM midnight following the last day of `ym`
        // (i.e. 1st of the following month at 00:00:00, e.g. 2026-12-01 00:00:00 for Nov 2026)
        const postMidnightThreshold = new Date(cursorYear, cursorMonth, 1, 0, 0, 0, 0);
        const postDateStr = `${postMidnightThreshold.getFullYear()}-${String(
          postMidnightThreshold.getMonth() + 1
        ).padStart(2, '0')}-01`;

        if (
          postDateStr >= PAYABLES_EFFECTIVE_START_DATE &&
          now.getTime() >= postMidnightThreshold.getTime()
        ) {
          const salaryRef = `SAL-${ym}-${staff.id}`;
          const deterministicId = parseNumericDocId(
            undefined,
            `${staffCompany}_${salaryRef}`,
            0
          );

          const alreadyExists =
            allFinances.some(
              (f) =>
                f &&
                (f.reference === salaryRef ||
                  Number(f.id) === deterministicId ||
                  ((f.category === 'Payroll / Salary' || f.category === 'Staff Payroll & Salaries') &&
                    (f.companyId || 'docks') === staffCompany &&
                    f.party?.trim().toLowerCase() === staff.name.trim().toLowerCase() &&
                    (String(f.date || '').slice(0, 7) === ym || f.date === postDateStr)))
            ) || newlyPosted.some((f) => f.reference === salaryRef);

          if (!alreadyExists) {
            const monthLabel = new Date(cursorYear, cursorMonth - 1, 1).toLocaleDateString('en-GB', {
              month: 'short',
              year: 'numeric'
            });
            const salaryEntry: FinanceEntry & { isRecurring?: boolean } = {
              id: deterministicId,
              companyId: staffCompany,
              date: postDateStr,
              description: `Monthly Office Staff Salary (${monthLabel}) — ${staff.name}${staff.designation ? ` (${staff.designation})` : ''}`,
              party: staff.name,
              amount: Number(staff.totalSalary),
              type: 'PAYABLE',
              status: 'APPROVED',
              category: 'Payroll / Salary',
              reference: salaryRef,
              paymentMethod: 'BANK',
              bankName: 'Meezan Bank',
              isRecurring: true
            };

            try {
              await saveFinanceToFirestore(salaryEntry);
            } catch (err) {
              console.warn(`Could not save auto month-end salary ${salaryRef}:`, err);
            }
            newlyPosted.push(salaryEntry);
          }
        }

        cursorMonth++;
        if (cursorMonth > 12) {
          cursorMonth = 1;
          cursorYear++;
        }
      }
    }

    if (newlyPosted.length > 0) {
      const activeComp = getActiveCompanyId();
      const activeNew = newlyPosted.filter((p) => matchesActiveCompany(p.companyId, activeComp));
      if (activeNew.length > 0) {
        const storedPay = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []) || [];
        safeAppStorage.setJSON('dpl_live_payables', dedupeArrayById([...activeNew, ...storedPay]));
      }
      const storedFin = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []) || [];
      safeAppStorage.setJSON('dpl_live_finance', dedupeArrayById([...newlyPosted, ...storedFin]));
    }

    return newlyPosted;
  } finally {
    isSyncingCompletedSalaries = false;
  }
}

// ============================================================================
// FRANCHISE MANAGEMENT & REAL-TIME AUTOMATED CONTAINER DISPATCH/UNLOAD LEDGER
// ============================================================================
const FRANCHISES_STORAGE_KEY = 'dpl_franchises';
const FRANCHISE_LEDGER_STORAGE_KEY = 'dpl_franchise_ledger_entries';

export function subscribeToFranchises(
  onData: (franchises: FranchiseProfile[]) => void,
  onError?: (err: any) => void
): () => void {
  const path = 'franchises';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const activeCompany = getActiveCompanyId();
      const allList: FranchiseProfile[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as FranchiseProfile;
        if (d && d.businessTitle) {
          allList.push({
            ...d,
            id: d.id || docSnap.id,
            portStaff: Array.isArray(d.portStaff) ? d.portStaff : [],
            allocatedCities: Array.isArray(d.allocatedCities) ? d.allocatedCities : [],
            allocatedDryPorts: Array.isArray(d.allocatedDryPorts) ? d.allocatedDryPorts : []
          });
        }
      });
      allList.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      safeAppStorage.setJSON(FRANCHISES_STORAGE_KEY, allList);
      onData(allList.filter((item) => matchesActiveCompany(item.companyId, activeCompany)));
    },
    (error: any) => {
      if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const activeCompany = getActiveCompanyId();
      const fallback = safeAppStorage.getJSON<FranchiseProfile[]>(FRANCHISES_STORAGE_KEY, []) || [];
      onData(fallback.filter((item) => matchesActiveCompany(item.companyId, activeCompany)));
    }
  );
}

export async function saveFranchiseToFirestore(franchise: FranchiseProfile): Promise<FranchiseProfile> {
  const path = 'franchises';
  const franchiseId = franchise.id || `fr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const activeCompany = getActiveCompanyId();

  const docSlots: Array<{ url?: string; name?: string; slotKey: string }> = [
    { url: franchise.idCardDocUrl, name: franchise.idCardDocName, slotKey: 'idcard' },
    { url: franchise.ntnCertificateUrl, name: franchise.ntnCertificateName, slotKey: 'ntn' },
    { url: franchise.franchiseAgreementUrl, name: franchise.franchiseAgreementName, slotKey: 'agreement' }
  ];

  for (const slot of docSlots) {
    if (slot.url && slot.url.startsWith('data:')) {
      saveDocumentToIndexedDB({
        key: `${franchiseId}_${slot.slotKey}`,
        id: `${franchiseId}_${slot.slotKey}`,
        name: slot.name || `${franchise.businessTitle}_${slot.slotKey}`,
        type: slot.url.startsWith('data:application/pdf') ? 'application/pdf' : 'image/jpeg',
        size: slot.url.length,
        dataUrl: slot.url
      }).catch(() => {});
    }
  }

  const normalized: FranchiseProfile = {
    ...franchise,
    id: franchiseId,
    companyId: franchise.companyId || activeCompany,
    businessTitle: (franchise.businessTitle || '').trim(),
    ownerName: (franchise.ownerName || '').trim(),
    contactNumber: (franchise.contactNumber || '').trim(),
    idCardNumber: (franchise.idCardNumber || '').trim(),
    portStaff: Array.isArray(franchise.portStaff) ? franchise.portStaff : [],
    allocatedCities: Array.isArray(franchise.allocatedCities) ? franchise.allocatedCities : [],
    allocatedDryPorts: Array.isArray(franchise.allocatedDryPorts) ? franchise.allocatedDryPorts : [],
    perContainerAmount: Number(franchise.perContainerAmount) || 0,
    fixedMonthlyAmount: Number(franchise.fixedMonthlyAmount) || 0,
    status: franchise.status || 'ACTIVE',
    createdAt: franchise.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    const cloudReady = await offloadLargeDataUrlsToCloudChunks(normalized, `franchise_${franchiseId}`);
    await setDoc(doc(db, path, franchiseId), sanitizeForFirestore(cloudReady), { merge: true });
  } catch (error: any) {
    if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.WRITE, `${path}/${franchiseId}`);
    }
    console.warn(`Firestore saveFranchise warning for ${franchiseId}:`, error);
  }

  const current = safeAppStorage.getJSON<FranchiseProfile[]>(FRANCHISES_STORAGE_KEY, []) || [];
  const updated = [normalized, ...current.filter((f) => f.id !== franchiseId)];
  safeAppStorage.setJSON(FRANCHISES_STORAGE_KEY, updated);

  // Immediately synchronize dispatched/unloaded container charges for this franchise
  syncFranchiseContainerCharges({ franchises: [normalized] }).catch(() => {});

  return normalized;
}

export async function deleteFranchiseFromFirestore(franchiseId: string): Promise<void> {
  const path = 'franchises';
  try {
    await deleteDoc(doc(db, path, franchiseId));
  } catch (error: any) {
    if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.DELETE, `${path}/${franchiseId}`);
    }
    console.warn(`Firestore deleteFranchise warning for ${franchiseId}:`, error);
  }

  const current = safeAppStorage.getJSON<FranchiseProfile[]>(FRANCHISES_STORAGE_KEY, []) || [];
  safeAppStorage.setJSON(
    FRANCHISES_STORAGE_KEY,
    current.filter((f) => f.id !== franchiseId)
  );
}

export function subscribeToFranchiseLedgerEntries(
  onData: (entries: FranchiseLedgerEntry[]) => void,
  onError?: (err: any) => void
): () => void {
  const path = 'franchise_ledger_entries';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const activeCompany = getActiveCompanyId();
      const allEntries: FranchiseLedgerEntry[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as FranchiseLedgerEntry;
        if (d && d.franchiseId) {
          allEntries.push({ ...d, id: d.id || docSnap.id });
        }
      });
      allEntries.sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
      safeAppStorage.setJSON(FRANCHISE_LEDGER_STORAGE_KEY, allEntries);
      onData(allEntries.filter((e) => matchesActiveCompany(e.companyId, activeCompany)));
    },
    (error: any) => {
      if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      const activeCompany = getActiveCompanyId();
      const fallback = safeAppStorage.getJSON<FranchiseLedgerEntry[]>(FRANCHISE_LEDGER_STORAGE_KEY, []) || [];
      onData(fallback.filter((e) => matchesActiveCompany(e.companyId, activeCompany)));
    }
  );
}

export async function saveFranchiseLedgerEntryToFirestore(
  entry: FranchiseLedgerEntry
): Promise<FranchiseLedgerEntry> {
  const path = 'franchise_ledger_entries';
  const entryId = entry.id || `frled_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const activeCompany = getActiveCompanyId();
  const normalized: FranchiseLedgerEntry = {
    ...entry,
    id: entryId,
    companyId: entry.companyId || activeCompany,
    amount: Number(entry.amount) || 0,
    date: entry.date || new Date().toISOString().split('T')[0],
    createdAt: entry.createdAt || new Date().toISOString()
  };

  try {
    await setDoc(doc(db, path, entryId), sanitizeForFirestore(normalized), { merge: true });
  } catch (error: any) {
    if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.WRITE, `${path}/${entryId}`);
    }
    console.warn(`Firestore saveFranchiseLedgerEntry warning for ${entryId}:`, error);
  }

  const current = safeAppStorage.getJSON<FranchiseLedgerEntry[]>(FRANCHISE_LEDGER_STORAGE_KEY, []) || [];
  const updated = [normalized, ...current.filter((e) => e.id !== entryId)];
  safeAppStorage.setJSON(FRANCHISE_LEDGER_STORAGE_KEY, updated);

  return normalized;
}

export async function deleteFranchiseLedgerEntryFromFirestore(entryId: string): Promise<void> {
  const path = 'franchise_ledger_entries';
  try {
    await deleteDoc(doc(db, path, entryId));
  } catch (error: any) {
    if (error?.code === 'permission-denied' || String(error?.message || '').includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.DELETE, `${path}/${entryId}`);
    }
    console.warn(`Firestore deleteFranchiseLedgerEntry warning for ${entryId}:`, error);
  }

  const current = safeAppStorage.getJSON<FranchiseLedgerEntry[]>(FRANCHISE_LEDGER_STORAGE_KEY, []) || [];
  safeAppStorage.setJSON(
    FRANCHISE_LEDGER_STORAGE_KEY,
    current.filter((e) => e.id !== entryId)
  );
}

function isCaseDispatchedOrUnloadedForFranchise(c: Case): boolean {
  const statusStr = String(c.status || '').trim();
  if (
    statusStr.toUpperCase() === 'CANCELLED' ||
    statusStr.toUpperCase() === 'REJECTED' ||
    c.approvalStatus === 'REJECTED'
  ) {
    return false;
  }

  if (hasCaseCompletedLoadingGateOut(c) || hasCaseArrivedAtDestination(c)) {
    return true;
  }

  const dispatchedStages = new Set([
    'Loading Port Processing',
    'In Transit',
    'Destination Port Arrival',
    'Case Completed'
  ]);
  if (dispatchedStages.has(statusStr)) {
    return true;
  }

  const destStep =
    c.workflowDetails?.['Destination Port Arrival'] ||
    c.workflowDetails?.['DESTINATION_PORT_ARRIVAL'];
  if (destStep?.containerUnloadedToggled || destStep?.destinationGateInToggled) {
    return true;
  }

  if (
    Array.isArray(c.containers) &&
    c.containers.some(
      (cn) => cn.status === 'Loaded' || cn.status === 'In Transit' || cn.status === 'Delivered'
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Automated Real-Time Franchise Container Ledger Integration:
 * Whenever a container/case is dispatched or unloaded to a designated destination or dry port,
 * calculates (containerCount × perContainerAmount) and debits the matching franchise's ledger
 * using a deterministic ID so updates stay idempotent and never double-bill.
 */
export async function syncFranchiseContainerCharges(options?: {
  cases?: Case[];
  franchises?: FranchiseProfile[];
}): Promise<number> {
  try {
    const activeCompany = getActiveCompanyId();

    let franchisesPool: FranchiseProfile[] = options?.franchises || [];
    if (franchisesPool.length === 0) {
      franchisesPool = safeAppStorage.getJSON<FranchiseProfile[]>(FRANCHISES_STORAGE_KEY, []) || [];
      if (franchisesPool.length === 0 && db) {
        const fSnap = await getDocs(collection(db, 'franchises')).catch(() => null);
        if (fSnap) {
          fSnap.forEach((ds) => {
            const d = ds.data() as FranchiseProfile;
            if (d && d.businessTitle) franchisesPool.push({ ...d, id: d.id || ds.id });
          });
        }
      }
    }

    const activePerContainerFranchises = franchisesPool.filter(
      (f) =>
        f &&
        f.status === 'ACTIVE' &&
        f.billingType === 'PER_CONTAINER' &&
        Number(f.perContainerAmount) > 0 &&
        matchesActiveCompany(f.companyId, activeCompany)
    );

    if (activePerContainerFranchises.length === 0) return 0;

    let casesPool: Case[] = options?.cases || [];
    if (casesPool.length === 0) {
      casesPool = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []) || [];
      if (casesPool.length === 0 && db) {
        const cSnap = await getDocs(collection(db, 'cases')).catch(() => null);
        if (cSnap) {
          cSnap.forEach((ds) => {
            casesPool.push({ ...(ds.data() as Case), id: ds.id });
          });
        }
      }
    }

    const existingEntries =
      safeAppStorage.getJSON<FranchiseLedgerEntry[]>(FRANCHISE_LEDGER_STORAGE_KEY, []) || [];
    const existingById = new Map<string, FranchiseLedgerEntry>();
    for (const e of existingEntries) {
      if (e?.id) existingById.set(e.id, e);
    }

    let syncedCount = 0;

    for (const c of casesPool) {
      if (!matchesActiveCompany((c as any).companyId, activeCompany)) continue;
      if (!isCaseDispatchedOrUnloadedForFranchise(c)) continue;

      const podRaw = (
        c.pod ||
        c.extractedData?.pod ||
        c.extractedData?.placeOfDelivery ||
        c.workflowDetails?.['Destination Port Arrival']?.destinationPortName ||
        c.extractedData?.dropoffDestination ||
        ''
      ).trim();

      if (!podRaw) continue;

      const caseNo = (c.caseNo || c.caseNumber || c.id || '').trim();
      if (!caseNo) continue;

      const containerList = Array.isArray(c.containers) && c.containers.length > 0 ? c.containers : [];
      const containerCount = Math.max(1, containerList.length);
      const containerNumbers =
        containerList
          .map((cn) => cn.number)
          .filter(Boolean)
          .join(', ') ||
        c.containerNumber ||
        c.extractedData?.containerNo ||
        'Assigned Container';

      const dispatchDate = (
        c.destinationUnloadAndGateOutTime ||
        c.destinationPortArrivalTime ||
        c.loadingPortGateOutTime ||
        c.registrationDate ||
        c.createdAt ||
        new Date().toISOString()
      ).slice(0, 10);

      for (const franchise of activePerContainerFranchises) {
        if (!doesDestinationMatchFranchise(podRaw, franchise)) continue;

        const rate = Number(franchise.perContainerAmount) || 0;
        const totalDebit = containerCount * rate;
        const safeFranchiseId = franchise.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeCaseKey = caseNo.replace(/[^a-zA-Z0-9_-]/g, '_');
        const deterministicEntryId = `frled_${safeFranchiseId}_${safeCaseKey}`;

        const prevEntry = existingById.get(deterministicEntryId);
        if (
          prevEntry &&
          Number(prevEntry.amount) === totalDebit &&
          Number(prevEntry.containerCount) === containerCount &&
          prevEntry.pod === podRaw
        ) {
          continue;
        }

        const debitEntry: FranchiseLedgerEntry = {
          id: deterministicEntryId,
          companyId: franchise.companyId || activeCompany,
          franchiseId: franchise.id,
          franchiseName: franchise.businessTitle,
          date: dispatchDate,
          type: 'DEBIT',
          amount: totalDebit,
          description: `Auto-Debit on Container Dispatch/Unloading: ${containerCount} Container(s) [${containerNumbers}] × PKR ${rate.toLocaleString()}/container — Case #${caseNo} (${podRaw})`,
          reference: `AUTO-CNTR-${caseNo}`,
          caseId: c.id,
          caseNo,
          pod: podRaw,
          containerCount,
          containerNumbers,
          ratePerContainer: rate,
          autoGenerated: true,
          createdAt: prevEntry?.createdAt || new Date().toISOString()
        };

        await saveFranchiseLedgerEntryToFirestore(debitEntry);
        syncedCount++;
      }
    }

    return syncedCount;
  } catch (err) {
    console.warn('syncFranchiseContainerCharges notice:', err);
    return 0;
  }
}

export async function postMonthlyFixedFranchiseCharge(
  franchise: FranchiseProfile,
  yearMonth?: string
): Promise<FranchiseLedgerEntry | null> {
  if (!franchise || franchise.billingType !== 'FIXED_MONTHLY') return null;
  const amount = Number(franchise.fixedMonthlyAmount) || 0;
  if (amount <= 0) return null;

  const now = new Date();
  const ym =
    yearMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const safeFranchiseId = franchise.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const deterministicId = `frled_fixed_${safeFranchiseId}_${ym}`;

  const entry: FranchiseLedgerEntry = {
    id: deterministicId,
    companyId: franchise.companyId || getActiveCompanyId(),
    franchiseId: franchise.id,
    franchiseName: franchise.businessTitle,
    date: `${ym}-01`,
    type: 'DEBIT',
    amount,
    description: `Fixed Monthly Franchise Allocation Charge (${ym}) — ${
      franchise.allocationMode === 'CITY'
        ? `City Coverage: ${(franchise.allocatedCities || []).join(', ')}`
        : `Dry Ports: ${(franchise.allocatedDryPorts || []).join(', ')}`
    }`,
    reference: `FIXED-${ym}`,
    autoGenerated: true,
    createdAt: new Date().toISOString()
  };

  return saveFranchiseLedgerEntryToFirestore(entry);
}



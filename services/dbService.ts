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
  writeBatch
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
import { Case, FinanceEntry, Vehicle, AppNotification, AppUser, Client, UserRole, RecurringFinanceTemplate, DestinationStaff, StaffLedgerEntry, Vendor, StaffLoadingBill, StaffPrivateLedgerEntry, AvailableVehicle, TransporterRequest, CompanyDocument, DEFAULT_COMPANY_DOCUMENT_CATEGORIES, PersonalLedgerAccount, PersonalLedgerEntry, Driver } from '../types';
import { safeAppStorage } from './storage';
import { logActivity } from './activityLogService';
import { getActiveCompanyId, subscribeToActiveCompany, CompanyId, PARENT_GROUP, GROUP_COMPANIES } from './companyService';
import { 
  saveDocumentToIndexedDB, 
  backupCasesToIndexedDB, 
  backupVehiclesToIndexedDB, 
  restoreCasesFromIndexedDB, 
  restoreVehiclesFromIndexedDB 
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
        clean[key] = ''; // Kept safely in IndexedDB and safeAppStorage
      } else {
        clean[key] = sanitizeForFirestore(val);
      }
    }
  }
  return clean;
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
      const firestoreHasBase64 = fc.documents?.some((d: any) => d?.url && String(d.url).startsWith('data:'));
      const bestDocs = (!firestoreHasBase64 && existingHasBase64 && (existing.documents?.length || 0) >= (fc.documents?.length || 0))
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

function dispatchCaseLifecycleNotifications(caseItem: Case, prevCase?: Case | null, isNew?: boolean) {
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

    // 1. Case Number Generated (New Case) -> Client
    if (isNew && clientName) {
      const genKey = `notif_case_gen_${caseItem.id || caseNo}`;
      if (!safeAppStorage.getItem(genKey)) {
        safeAppStorage.setItem(genKey, 'true');
        saveNotificationToFirestore({
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: `Case Registered & Number Generated: ${caseNo}`,
          description: `Your consignment Case ${caseNo} (${caseItem.category || 'Transit'}) has been registered for ${clientName}. Route: ${caseItem.pol || 'POL'} → ${caseItem.pod || 'POD'}. You will receive live notifications for every workflow step until completion.`,
          details: `Case Number: ${caseNo}\nClient: ${clientName}\nCategory: ${caseItem.category || 'N/A'}\nRoute: ${caseItem.pol || 'POL'} → ${caseItem.pod || 'POD'}\nCurrent Status: ${caseItem.status || 'Registered'}`,
          timestamp: nowTimeStr,
          type: 'INFO',
          notificationSubType: 'WORKFLOW_UPDATE',
          status: 'PENDING',
          actionLabel: 'Track Case Workflow',
          priority: 'HIGH',
          targetRole: 'CLIENT',
          targetClientName: clientName,
          category: 'CASE',
          targetView: 'cases',
          targetFilter: { caseId: caseItem.id, caseNo }
        }).catch(() => {});
      }
    }

    // 2. Case Cancelled Status Marked -> Client
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
          details: `Case No: ${caseNo}\nClient: ${clientName}\nStatus: CANCELLED\nRoute: ${caseItem.pol || 'N/A'} → ${caseItem.pod || 'N/A'}`,
          timestamp: nowTimeStr,
          type: 'ALERT',
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
    }

    // 3. Workflow Progress / Step Update (From Case Generation to Finish) -> Client
    if (!isNew && !isNowCancelled && clientName) {
      const prevStatus = prevCase?.status || '';
      const prevStep = prevCase?.currentStep ?? -1;
      const currStatus = caseItem.status || '';
      const currStep = caseItem.currentStep ?? -1;
      const prevWfJson = JSON.stringify(prevCase?.workflowDetails || {});
      const currWfJson = JSON.stringify(caseItem.workflowDetails || {});

      if (prevStatus !== currStatus || prevStep !== currStep || prevWfJson !== currWfJson) {
        const wfKey = `notif_case_wf_${caseItem.id}_${currStatus}_${currStep}_${currWfJson.length}`;
        if (!safeAppStorage.getItem(wfKey)) {
          safeAppStorage.setItem(wfKey, 'true');
          const isFinished =
            currStatus.toUpperCase() === 'COMPLETED' ||
            currStatus.toUpperCase() === 'DELIVERED' ||
            currStatus.toUpperCase() === 'FINISHED';

          saveNotificationToFirestore({
            id: Date.now() + Math.floor(Math.random() * 1000) + 2,
            title: isFinished
              ? `Case Completed / Finished: ${caseNo}`
              : `Case Workflow Update (${currStatus || `Step ${Number(currStep) + 1}`}): ${caseNo}`,
            description: isFinished
              ? `All workflows for your Case ${caseNo} (${clientName}) have been completed and finished.`
              : `Workflow updated for Case ${caseNo}: Status is now "${currStatus}" (Step ${Number(currStep) + 1}).`,
            details: `Case No: ${caseNo}\nClient: ${clientName}\nUpdated Status: ${currStatus}\nWorkflow Step: ${Number(currStep) + 1}\nRoute: ${caseItem.pol || 'POL'} → ${caseItem.pod || 'POD'}`,
            timestamp: nowTimeStr,
            type: 'INFO',
            notificationSubType: 'WORKFLOW_UPDATE',
            status: 'PENDING',
            actionLabel: 'View Workflow Status',
            priority: isFinished ? 'HIGH' : 'MEDIUM',
            targetRole: 'CLIENT',
            targetClientName: clientName,
            category: 'CASE',
            targetView: 'cases',
            targetFilter: { caseId: caseItem.id, caseNo }
          }).catch(() => {});
        }
      }
    }

    // 4. Company-Managed vs Client-Managed Arrangements Notification & Demand -> Client
    if (clientName) {
      const companyManagedItems: string[] = [];
      const clientManagedItems: string[] = [];

      if (caseItem.serviceArrangements && typeof caseItem.serviceArrangements === 'object') {
        Object.entries(caseItem.serviceArrangements).forEach(([key, item]: [string, any]) => {
          if (!item) return;
          const label = item.label || key.replace(/_/g, ' ');
          if (item.arrangedBy === 'Client') {
            clientManagedItems.push(label);
          } else if (item.arrangedBy === 'DPL' || item.arrangedBy === 'Company') {
            companyManagedItems.push(label);
          }
        });
      }

      if (Array.isArray(caseItem.charges)) {
        caseItem.charges.forEach((ch) => {
          if (!ch || !ch.description) return;
          if (ch.arrangedBy === 'Client') {
            if (!clientManagedItems.includes(ch.description)) clientManagedItems.push(ch.description);
          } else if ((Number(ch.amount) || 0) > 0) {
            if (!companyManagedItems.includes(ch.description)) companyManagedItems.push(ch.description);
          }
        });
      }

      if (companyManagedItems.length > 0 || clientManagedItems.length > 0) {
        const arrSig = `${companyManagedItems.join('|')}__${clientManagedItems.join('|')}`;
        const arrKey = `notif_case_arr_${caseItem.id}_${arrSig}`;
        if (!safeAppStorage.getItem(arrKey)) {
          safeAppStorage.setItem(arrKey, 'true');

          if (companyManagedItems.length > 0) {
            saveNotificationToFirestore({
              id: Date.now() + Math.floor(Math.random() * 1000) + 3,
              title: `Company Managed Services (${caseNo})`,
              description: `Company is managing the following items in Case ${caseNo}: ${companyManagedItems.join(', ')}.`,
              details: `Case No: ${caseNo}\nClient: ${clientName}\nManaged by Company:\n• ${companyManagedItems.join('\n• ')}`,
              timestamp: nowTimeStr,
              type: 'INFO',
              notificationSubType: 'COMPANY_MANAGED_UPDATE',
              status: 'PENDING',
              actionLabel: 'View Case Services',
              priority: 'MEDIUM',
              targetRole: 'CLIENT',
              targetClientName: clientName,
              category: 'CASE',
              targetView: 'cases',
              targetFilter: { caseId: caseItem.id, caseNo }
            }).catch(() => {});
          }

          if (clientManagedItems.length > 0) {
            saveNotificationToFirestore({
              id: Date.now() + Math.floor(Math.random() * 1000) + 4,
              title: `Action Required: Update Client-Managed Items (${caseNo})`,
              description: `Demand for Update: Please provide/update details & documents for items managed by you in Case ${caseNo}: ${clientManagedItems.join(', ')}.`,
              details: `Case No: ${caseNo}\nClient: ${clientName}\nItems Managed by Client (Update Required):\n• ${clientManagedItems.join('\n• ')}\nPlease update these particulars in your Client Portal.`,
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
    }

    // 5. Case Receivable Invoice / Charges Notification -> Finance Manager & Charged Client ONLY
    const explicitCharges = Array.isArray(caseItem.charges)
      ? caseItem.charges.filter(ch => ch && ch.arrangedBy !== 'Client' && (Number(ch.amount) || 0) > 0)
      : [];
    const totalCharged = explicitCharges.length > 0
      ? explicitCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0)
      : Number(caseItem.totalAmount || (caseItem.extractedData as any)?.totalAmount || 0);

    if (totalCharged > 0 && !isNowCancelled) {
      const chargeKey = `notif_case_charge_${caseItem.id}_${totalCharged}`;
      if (!safeAppStorage.getItem(chargeKey)) {
        safeAppStorage.setItem(chargeKey, 'true');
        const breakdownStr = explicitCharges.length > 0
          ? explicitCharges.map(c => `${c.description}: PKR ${Number(c.amount).toLocaleString()}`).join(', ')
          : `Case Invoice Total: PKR ${totalCharged.toLocaleString()}`;

        saveNotificationToFirestore({
          id: Date.now() + Math.floor(Math.random() * 1000) + 5,
          title: `Case Invoice / Ledger Charge (${caseNo}): PKR ${totalCharged.toLocaleString()}`,
          description: `Invoice & ledger charge of PKR ${totalCharged.toLocaleString()} generated for ${clientName || 'Client'} on Case ${caseNo} (${breakdownStr}).`,
          details: `Case / Invoice No: ${caseNo}\nCharged Client: ${clientName || 'N/A'}\nTotal Amount Charged: PKR ${totalCharged.toLocaleString()}\nBreakdown: ${breakdownStr}`,
          timestamp: nowTimeStr,
          type: 'INFO',
          notificationSubType: 'INVOICE_CHARGE_NOTIFICATION',
          status: 'PENDING',
          actionLabel: 'View Invoice & Ledger',
          priority: 'HIGH',
          targetRole: clientName ? 'FINANCE_MANAGER,CLIENT' : 'FINANCE_MANAGER',
          targetClientName: clientName || undefined,
          category: 'FINANCE',
          targetView: 'finance',
          targetFilter: { caseId: caseItem.id, caseNo }
        }).catch(() => {});
      }
    }

    // 6. Transporter Freight Invoice Generated Notification -> Specific Transporter & Finance Manager (& Client if rentPaymentBy === 'Client')
    if (Array.isArray(caseItem.containers) && !isNowCancelled) {
      caseItem.containers.forEach((cntr, cIdx) => {
        const tName = (cntr.transporterName || (caseItem as any).transporterName || '').trim();
        const rentAmt = Number(cntr.rentAmount || 0);
        if (tName && rentAmt > 0) {
          const transInvKey = `notif_trans_inv_${caseItem.id}_${cntr.number || cIdx}_${rentAmt}`;
          if (!safeAppStorage.getItem(transInvKey)) {
            safeAppStorage.setItem(transInvKey, 'true');
            saveNotificationToFirestore({
              id: Date.now() + Math.floor(Math.random() * 1000) + 16 + cIdx,
              title: `Invoice Generated (${caseNo}): PKR ${rentAmt.toLocaleString()}`,
              description: `Freight / Vehicle Rent invoice of PKR ${rentAmt.toLocaleString()} generated for Transporter "${tName}" (Container: ${cntr.number || 'N/A'}, Vehicle: ${cntr.vehicleNo || 'Assigned'}, Paid By: ${cntr.rentPaymentBy || 'Client'}).`,
              details: `Case No: ${caseNo}\nTransporter: ${tName}\nContainer No: ${cntr.number || 'N/A'}\nVehicle No: ${cntr.vehicleNo || 'N/A'}\nInvoice Amount: PKR ${rentAmt.toLocaleString()}\nPayable By: ${cntr.rentPaymentBy || 'Client'}\nClient: ${clientName || 'N/A'}`,
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

            if (cntr.rentPaymentBy === 'Client' && clientName) {
              saveNotificationToFirestore({
                id: Date.now() + Math.floor(Math.random() * 1000) + 26 + cIdx,
                title: `Transporter Freight Charge (${caseNo}): PKR ${rentAmt.toLocaleString()}`,
                description: `Transporter (${tName}) freight invoice of PKR ${rentAmt.toLocaleString()} generated on your ledger for Container ${cntr.number || 'N/A'} (Vehicle: ${cntr.vehicleNo || 'Assigned'}).`,
                details: `Case No: ${caseNo}\nCharged Client: ${clientName}\nTransporter: ${tName}\nContainer: ${cntr.number || 'N/A'}\nVehicle: ${cntr.vehicleNo || 'N/A'}\nAmount: PKR ${rentAmt.toLocaleString()}`,
                timestamp: nowTimeStr,
                type: 'INFO',
                notificationSubType: 'INVOICE_CHARGE_NOTIFICATION',
                status: 'PENDING',
                actionLabel: 'View Client Ledger',
                priority: 'HIGH',
                targetRole: 'CLIENT,FINANCE_MANAGER',
                targetClientName: clientName,
                category: 'FINANCE',
                targetView: 'finance',
                targetFilter: { caseId: caseItem.id, caseNo }
              }).catch(() => {});
            }
          }
        }
      });
    }
  } catch (err) {
    console.warn('Case lifecycle notification dispatch notice:', err);
  }
}

export async function saveCaseToFirestore(newCase: Case): Promise<void> {
  const path = 'cases';
  const docId = newCase.id || String(Date.now());
  const activeCompany = getActiveCompanyId();

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

  // 3. Write to Firestore with sanitized payload (no >150KB base64 strings to avoid 1MB reject)
  try {
    const payload = sanitizeForFirestore({
      ...newCase,
      companyId: newCase.companyId || activeCompany,
      id: docId,
      createdBy: auth.currentUser?.uid || 'guest',
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload);
    dispatchCaseLifecycleNotifications({ ...newCase, id: docId }, null, true);
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
    const payload = sanitizeForFirestore({
      ...caseItem,
      companyId: caseItem.companyId || activeCompany,
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
    const mergedCase = prevCase ? { ...prevCase, ...caseItem } : caseItem;
    dispatchCaseLifecycleNotifications(mergedCase, prevCase, false);
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
export function subscribeToFinances(
  onData: (items: FinanceEntry[]) => void,
  onError?: (err: any) => void,
  options?: { allCompanies?: boolean }
) {
  const path = 'finances';
  let cachedDocs: any[] = [];

  const emit = () => {
    const active = getActiveCompanyId();
    const items: FinanceEntry[] = [];
    let idx = 0;
    cachedDocs.forEach((data) => {
      if (!options?.allCompanies && !matchesActiveCompany(data.companyId, active)) return;
      const numId = parseNumericDocId(data.id, data._docId || String(idx), idx++);
      items.push({ ...data, id: numId } as FinanceEntry);
    });
    onData(dedupeArrayById(items));
  };

  const unsubCompany = subscribeToActiveCompany(() => {
    emit();
  });

  const unsubFirestore = onSnapshot(
    collection(db, path),
    (snapshot) => {
      cachedDocs = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const partyLower = (data.party || '').toLowerCase();
        const descLower = (data.description || '').toLowerCase();
        const refStr = (data.reference || '');
        const isStaleAdminSalary = 
          (partyLower.includes('system administrator') || descLower.includes('system administrator')) &&
          (data.category === 'Staff Payroll & Salaries' || refStr.startsWith('SAL-') || descLower.includes('monthly salary'));

        if (isStaleAdminSalary) {
          deleteDoc(doc(db, path, docSnap.id)).catch(() => {});
          return;
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
      entry.category === 'Staff Payroll & Salaries' ||
      entry.recurringTemplateId !== undefined ||
      entry.reference?.startsWith('SAL-') ||
      entry.reference?.startsWith('REC-') ||
      entry.description?.toLowerCase().includes('monthly salary') ||
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

    // Notify Finance Manager, Admin, and Client according to strict notification rules
    if (entryToSave.amount && Number(entryToSave.amount) > 0) {
      const notifId = Date.now() + Math.floor(Math.random() * 1000);

      const isClientDepositUpload = 
        Boolean(entryToSave.slipUrl) || 
        (entryToSave.type === 'INCOME' && entryToSave.status === 'PENDING' && entryToSave.party && entryToSave.party !== 'DPL');

      let notif: AppNotification;

      if (isMonthlyOrRecurring) {
        // Monthly fixed amounts and salaries: AUTOMATIC, NO approval required -> Finance Manager
        notif = {
          id: notifId,
          title: `Monthly Fixed Expense: PKR ${Number(entryToSave.amount).toLocaleString()} (Auto-Approved)`,
          description: `${entryToSave.description || 'Monthly Fixed Expense'} for ${entryToSave.party || 'Account'} has been automatically approved and recorded to Finance Payables.`,
          details: `${entryToSave.category || 'Finance'} • Reference: ${entryToSave.reference || 'N/A'} • Status: AUTO-APPROVED • Payment Method: ${entryToSave.paymentMethod || 'BANK'}`,
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
        // Rule 9: Payment submitted from client ID -> Confirmation request coming to Finance Manager Notification Center
        notif = {
          id: notifId,
          title: `Payment Verification Required: PKR ${Number(entry.amount).toLocaleString()}`,
          description: `Payment submitted from Client ID (${entry.party || 'Client'}) for ${entry.category || 'Payment'}. Finance Manager verification & confirmation required before adding to Received Payments, Client Ledger & Cashbook.`,
          details: `Client / Party: ${entry.party} • Bank: ${entry.bankName || 'Direct'} • Ref: ${entry.reference || 'N/A'} • Amount: PKR ${Number(entry.amount).toLocaleString()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'ACTION',
          notificationSubType: 'PAYMENT_APPROVAL',
          status: 'PENDING',
          actionLabel: 'Verify & Confirm Payment',
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

        // Rule 9 & Transporter Rule: Payable invoice by vendor / transporter -> Notification coming in Finance Manager (& Transporter if freight/vehicle rent)
        notif = {
          id: notifId,
          title: isTransporterInvoice
            ? `Invoice Generated: PKR ${Number(entry.amount).toLocaleString()}`
            : `Payable Invoice Charge (Vendor): PKR ${Number(entry.amount).toLocaleString()}`,
          description: isTransporterInvoice
            ? `Freight / Vehicle Rent invoice of PKR ${Number(entry.amount).toLocaleString()} generated for Transporter "${transporterTarget}": ${entry.description || entry.category || 'Freight Invoice'}.`
            : `Payable invoice / charge recorded for Vendor "${entry.party || 'Vendor'}": ${entry.description || entry.category || 'Payable Invoice'}.`,
          details: `Party: ${transporterTarget}\nCategory: ${entry.category || 'Payable'}\nReference: ${entry.reference || 'N/A'}\nAmount: PKR ${Number(entry.amount).toLocaleString()}\nStatus: ${entryToSave.status || 'PENDING'}`,
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
        // Rule 9 & Rule 11: Receivable invoice / company ledger charge -> Finance Manager AND specific Client being charged
        const clientParty = entry.party || 'Client';
        notif = {
          id: notifId,
          title: `Receivable Invoice / Ledger Charge: PKR ${Number(entry.amount).toLocaleString()}`,
          description: `Company invoice / ledger charge of PKR ${Number(entry.amount).toLocaleString()} generated for ${clientParty}: ${entry.description || entry.category || 'Invoice Charge'}.`,
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
        // INCOME (Payment Received) or EXPENSE (Payment Paid) -> Admin & Finance Manager (Rule 7: Any payment paid and received notification)
        const isPaidOut = entryToSave.type === 'EXPENSE';
        const label = isPaidOut ? 'Payment Paid' : 'Payment Received';
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

/**
 * Automatically ensures that all staff members (regardless of their assigned role)
 * have their monthly base salary automatically posted to Payables on the 1st of every month.
 */
export async function syncMonthlyStaffSalariesToPayables(
  staffUsers: AppUser[],
  existingPayables?: FinanceEntry[]
): Promise<FinanceEntry[]> {
  if (!staffUsers || staffUsers.length === 0) return [];
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const firstOfMonthDate = `${currentMonthStr}-01`;

  const currentPayables = existingPayables && existingPayables.length > 0 
    ? existingPayables 
    : safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);

  const newlyCreated: FinanceEntry[] = [];

  for (const user of staffUsers) {
    // Skip external client or transporter entities, admin accounts, and legacy seed test profiles
    const nameLower = (user.name || '').toLowerCase();
    const isLegacyPersonal = nameLower.includes('mohsin') || nameLower.includes('shahid') || nameLower.includes('danish') || nameLower.includes('tariq') || nameLower.includes('rashid') || nameLower.includes('bilal');
    if (
      user.role === UserRole.CLIENT || 
      user.role === UserRole.TRANSPORTER || 
      user.role === UserRole.ADMIN || 
      user.userId === 'admin' || 
      nameLower.includes('administrator') ||
      isLegacyPersonal
    ) continue;
    const salary = Number(user.baseSalary || 0);
    if (salary <= 0) continue;

    const salaryRef = `SAL-${currentMonthStr}-${user.id}`;
    const alreadyExists = currentPayables.some(
      p => p.reference === salaryRef || (p.category === 'Staff Payroll & Salaries' && p.party?.trim().toLowerCase() === user.name?.trim().toLowerCase() && p.date === firstOfMonthDate)
    );

    if (!alreadyExists && !newlyCreated.some(p => p.reference === salaryRef)) {
      const netSalary = Math.max(0, salary - Number(user.loansAdvances || 0));
      const roleLabel = user.designation || (user.role === UserRole.OFFICE_STAFF ? 'Office Staff' : String(user.role).replace(/_/g, ' '));
      const salaryEntry: FinanceEntry = {
        id: Date.now() + Math.floor(Math.random() * 10000) + newlyCreated.length,
        date: firstOfMonthDate,
        description: `Monthly Salary - ${user.name} (${roleLabel}) [Gross: PKR ${salary.toLocaleString()}]`,
        party: user.name,
        amount: netSalary,
        type: 'PAYABLE',
        status: 'APPROVED',
        category: 'Staff Payroll & Salaries',
        reference: salaryRef,
        paymentMethod: 'BANK',
        bankName: 'Meezan Bank'
      };

      try {
        await saveFinanceToFirestore(salaryEntry);
      } catch (err) {
        console.warn('Could not save auto salary payable to Firestore:', err);
      }
      newlyCreated.push(salaryEntry);
    }
  }

  if (newlyCreated.length > 0) {
    const updated = [...newlyCreated, ...currentPayables];
    safeAppStorage.setJSON('dpl_live_payables', updated);
  }

  return newlyCreated;
}

/**
 * Automatically posts recurring monthly fixed expenses (office rent, vehicle loans, internet,
 * security retainer, utilities) and staff salaries on the 1st of every month
 * (and immediately on rollover after 12:00 AM midnight of the last date of the month).
 * Completely automatic without any button click required!
 */
export async function autoPostMonthlyRecurringAndSalaries(
  recurringTemplates?: RecurringFinanceTemplate[],
  staffUsers?: AppUser[],
  existingPayables?: FinanceEntry[],
  existingReceivables?: FinanceEntry[]
): Promise<{ addedPayables: FinanceEntry[]; addedReceivables: FinanceEntry[] }> {
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const firstOfMonthDate = `${currentMonthStr}-01`;

  const currentPayables = existingPayables && existingPayables.length > 0 
    ? existingPayables 
    : safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);

  const currentReceivables = existingReceivables && existingReceivables.length > 0 
    ? existingReceivables 
    : safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_receivables', []);

  const addedPayables: FinanceEntry[] = [];
  const addedReceivables: FinanceEntry[] = [];

  // 1. Process Recurring Fixed Expense Templates (Only if explicitly created by user)
  const templatesToProcess = (recurringTemplates && recurringTemplates.length > 0)
    ? recurringTemplates
    : [];

  for (const tpl of templatesToProcess) {
    const isTplActive = tpl.isActive !== undefined ? tpl.isActive : (tpl.active !== undefined ? tpl.active : true);
    if (!isTplActive) continue;

    const recRef = `REC-${currentMonthStr}-${tpl.id}`;
    const isPayable = (tpl.type || 'PAYABLE') === 'PAYABLE';
    const targetList = isPayable ? currentPayables : currentReceivables;
    const pendingAdded = isPayable ? addedPayables : addedReceivables;

    const alreadyExists = targetList.some(item => item.reference === recRef) || 
                          pendingAdded.some(item => item.reference === recRef);

    if (!alreadyExists) {
      const recEntry: FinanceEntry = {
        id: Date.now() + Math.floor(Math.random() * 100000) + addedPayables.length + addedReceivables.length,
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

  // 2. Process Staff Base Salaries
  if (staffUsers && staffUsers.length > 0) {
    for (const user of staffUsers) {
      const nameLower = (user.name || '').toLowerCase();
      const isLegacyPersonal = nameLower.includes('mohsin') || nameLower.includes('shahid') || nameLower.includes('danish') || nameLower.includes('tariq') || nameLower.includes('rashid') || nameLower.includes('bilal');
      if (
        user.role === UserRole.CLIENT || 
        user.role === UserRole.TRANSPORTER || 
        user.role === UserRole.ADMIN || 
        user.userId === 'admin' || 
        nameLower.includes('administrator') ||
        isLegacyPersonal
      ) continue;
      const salary = Number(user.baseSalary || 0);
      if (salary <= 0) continue;

      const salaryRef = `SAL-${currentMonthStr}-${user.id}`;
      const alreadyExists = currentPayables.some(
        p => p.reference === salaryRef || (p.category === 'Staff Payroll & Salaries' && p.party?.trim().toLowerCase() === user.name?.trim().toLowerCase() && p.date === firstOfMonthDate)
      ) || addedPayables.some(p => p.reference === salaryRef);

      if (!alreadyExists) {
        const netSalary = Math.max(0, salary - Number(user.loansAdvances || 0));
        const roleLabel = user.designation || (user.role === UserRole.OFFICE_STAFF ? 'Office Staff' : String(user.role).replace(/_/g, ' '));
        const salaryEntry: FinanceEntry = {
          id: Date.now() + Math.floor(Math.random() * 100000) + addedPayables.length,
          date: firstOfMonthDate,
          description: `Monthly Salary - ${user.name} (${roleLabel}) [Gross: PKR ${salary.toLocaleString()}]`,
          party: user.name,
          amount: netSalary,
          type: 'PAYABLE',
          status: 'APPROVED',
          category: 'Staff Payroll & Salaries',
          reference: salaryRef,
          paymentMethod: 'BANK',
          bankName: 'Meezan Bank'
        };

        try {
          await saveFinanceToFirestore(salaryEntry);
        } catch (err) {
          console.warn('Could not save auto salary payable to Firestore:', err);
        }
        addedPayables.push(salaryEntry);
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

  return { addedPayables, addedReceivables };
}

// VEHICLES
export function subscribeToVehicles(
  onData: (items: Vehicle[]) => void,
  onError?: (err: any) => void
) {
  const path = 'vehicles';
  let cachedDocs: any[] = [];

  const emit = () => {
    const firestoreItems: Vehicle[] = [];
    let idx = 0;
    cachedDocs.forEach((data) => {
      // NOTE: Vehicles are universally shared across all 4 subsidiaries (Docks, Truckit, Muhib, Vantage)
      const numId = parseNumericDocId(data.id, data._docId || String(idx), idx++);
      firestoreItems.push({ ...data, id: numId } as Vehicle);
    });

    // Authoritative Firestore Sync for Vehicles
    const finalVehicles = dedupeArrayById(firestoreItems);
    safeAppStorage.setJSON('dpl_live_vehicles', finalVehicles);
    backupVehiclesToIndexedDB(finalVehicles).catch(() => {});
    onData(finalVehicles);
  };

  const unsubFirestore = onSnapshot(
    collection(db, path),
    (snapshot) => {
      cachedDocs = [];
      snapshot.forEach((docSnap) => {
        cachedDocs.push({ ...docSnap.data(), _docId: docSnap.id });
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
  };
}

function dispatchTransporterVehicleNotifications(vehicle: Vehicle, prevVehicle?: Vehicle | null, isNew?: boolean) {
  try {
    const regNo = vehicle.registrationNumber || `Vehicle #${vehicle.id}`;
    const transporterTarget = (vehicle.transporterName || vehicle.brokerName || vehicle.ownerName || '').trim() || undefined;
    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Vehicle Registration Confirmed Marked -> Transporter
    const isConfirmed =
      vehicle.status === 'CONFIRMED' ||
      vehicle.registrationConfirmed === true ||
      (isNew && vehicle.status !== 'CANCELLED' && vehicle.status !== 'EXPIRED');
    const wasConfirmed = prevVehicle
      ? (prevVehicle.status === 'CONFIRMED' || prevVehicle.registrationConfirmed === true)
      : false;

    if (isConfirmed && (!prevVehicle || !wasConfirmed)) {
      const confKey = `notif_veh_confirmed_${vehicle.id}_${regNo}`;
      const detId = parseNumericDocId( undefined, confKey, 10 );
      if (!safeAppStorage.getItem(confKey)) {
        safeAppStorage.setItem(confKey, 'true');
        saveNotificationToFirestore({
          id: detId,
          title: `Vehicle Registration Confirmed: ${regNo}`,
          description: `Vehicle ${regNo} (${transporterTarget || 'Transporter'}) registration has been confirmed and marked active in the customs bonded fleet.`,
          details: `Vehicle Registration No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nVehicle Type: ${vehicle.type || 'Trailer'}\nStatus: CONFIRMED\nRegistration Date: ${vehicle.registrationDate || new Date().toISOString().split('T')[0]}\nExpiry Date: ${vehicle.registrationExpiryDate || vehicle.validationExpiryDate || 'N/A'}`,
          timestamp: nowTimeStr,
          type: 'INFO',
          notificationSubType: 'VEHICLE_REGISTERED',
          status: 'PENDING',
          actionLabel: 'View Registered Vehicle',
          priority: 'HIGH',
          targetRole: 'TRANSPORTER,VEHICLE_MANAGER',
          targetClientName: transporterTarget,
          category: 'TRANSPORTER',
          targetView: 'vehicles',
          targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
        }).catch(() => {});
      }
    }

    // 2. Vehicle Cancelled Marked & NOC Generated -> Transporter
    const isCancelled = vehicle.status === 'CANCELLED' || vehicle.cancellationApproved === true;
    const wasCancelled = prevVehicle
      ? (prevVehicle.status === 'CANCELLED' || prevVehicle.cancellationApproved === true)
      : false;

    if (isCancelled && !wasCancelled) {
      const cancKey = `notif_veh_cancelled_noc_${vehicle.id}_${regNo}`;
      const detId = parseNumericDocId(undefined, cancKey, 11);
      if (!safeAppStorage.getItem(cancKey)) {
        safeAppStorage.setItem(cancKey, 'true');
        saveNotificationToFirestore({
          id: detId,
          title: `Vehicle Cancelled & NOC Generated: ${regNo}`,
          description: `Vehicle ${regNo} (${transporterTarget || 'Transporter'}) has been marked CANCELLED and its De-Registration NOC has been generated.`,
          details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nStatus: CANCELLED\nNOC Status: NOC Generated & Approved\nCancellation Date: ${vehicle.cancellationDate || new Date().toISOString().split('T')[0]}`,
          timestamp: nowTimeStr,
          type: 'ALERT',
          notificationSubType: 'VEHICLE_CANCELLED_NOC',
          status: 'PENDING',
          actionLabel: 'View NOC & Status',
          priority: 'HIGH',
          targetRole: 'TRANSPORTER,VEHICLE_MANAGER',
          targetClientName: transporterTarget,
          category: 'TRANSPORTER',
          targetView: 'vehicles',
          targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
        }).catch(() => {});
      }
    }

    // 3. Vehicle Renewed -> Transporter
    const currRenewalsCount = Array.isArray(vehicle.renewals) ? vehicle.renewals.length : 0;
    const prevRenewalsCount = prevVehicle && Array.isArray(prevVehicle.renewals) ? prevVehicle.renewals.length : 0;
    const isRenewedNow =
      vehicle.status === 'RENEWED' ||
      currRenewalsCount > prevRenewalsCount ||
      (Boolean(vehicle.lastRenewalDate) && vehicle.lastRenewalDate !== prevVehicle?.lastRenewalDate);

    if (isRenewedNow && !isCancelled) {
      const renSig = `${currRenewalsCount}_${vehicle.lastRenewalDate || ''}_${vehicle.validationExpiryDate || vehicle.registrationExpiryDate || ''}`;
      const renKey = `notif_veh_renewed_${vehicle.id}_${renSig}`;
      const detId = parseNumericDocId(undefined, renKey, 12);
      if (!safeAppStorage.getItem(renKey)) {
        safeAppStorage.setItem(renKey, 'true');
        const newExp = vehicle.validationExpiryDate || vehicle.registrationExpiryDate || 'Updated';
        saveNotificationToFirestore({
          id: detId,
          title: `Vehicle Renewed: ${regNo}`,
          description: `Vehicle ${regNo} (${transporterTarget || 'Transporter'}) has been renewed. New validity/expiry date: ${newExp}.`,
          details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nStatus: RENEWED\nLast Renewal Date: ${vehicle.lastRenewalDate || new Date().toISOString().split('T')[0]}\nNew Expiry Date: ${newExp}`,
          timestamp: nowTimeStr,
          type: 'INFO',
          notificationSubType: 'VEHICLE_RENEWED',
          status: 'PENDING',
          actionLabel: 'View Renewal Details',
          priority: 'HIGH',
          targetRole: 'TRANSPORTER,VEHICLE_MANAGER',
          targetClientName: transporterTarget,
          category: 'TRANSPORTER',
          targetView: 'vehicles',
          targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
        }).catch(() => {});
      }
    }

    // 4. Check Immediate Expiry / Expire Soon on Save or Update -> Admin, Vehicle Manager & Transporter
    const expDateStr = vehicle.validationExpiryDate || vehicle.registrationExpiryDate || (vehicle as any).taxExpiryDate || (vehicle as any).fitnessExpiryDate;
    if (expDateStr && !isCancelled) {
      const todayStr = new Date().toISOString().split('T')[0];
      const todayTime = new Date(todayStr).getTime();
      const expTime = new Date(expDateStr).getTime();
      if (!isNaN(expTime)) {
        const diffDays = Math.ceil((expTime - todayTime) / (24 * 60 * 60 * 1000));
        if (diffDays <= 0) {
          const expKey = `audit_vehicle_expired_${vehicle.id}_${expDateStr}`;
          const detId = parseNumericDocId(undefined, expKey, 13);
          if (!safeAppStorage.getItem(expKey)) {
            safeAppStorage.setItem(expKey, 'true');
            saveNotificationToFirestore({
              id: detId,
              title: `Vehicle Expired: ${regNo}`,
              description: `Vehicle ${regNo} (${transporterTarget || 'Transporter'}) registration/validation expired on ${expDateStr}.`,
              details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nExpired On: ${expDateStr}\nAction Required: Immediate renewal required.`,
              timestamp: nowTimeStr,
              type: 'ALERT',
              notificationSubType: 'DOC_EXPIRY_ALERT',
              status: 'PENDING',
              actionLabel: 'Renew Vehicle',
              priority: 'HIGH',
              targetRole: 'ADMIN,VEHICLE_MANAGER,TRANSPORTER',
              targetClientName: transporterTarget,
              category: 'TRANSPORTER',
              targetView: 'vehicles',
              targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
            }).catch(() => {});
          }
        } else if (diffDays <= 10) {
          const soonKey = `audit_vehicle_expiring_soon_${vehicle.id}_${expDateStr}`;
          const detId = parseNumericDocId(undefined, soonKey, 14);
          if (!safeAppStorage.getItem(soonKey)) {
            safeAppStorage.setItem(soonKey, 'true');
            saveNotificationToFirestore({
              id: detId,
              title: `Vehicle Expire Soon (${diffDays} Days): ${regNo}`,
              description: `Vehicle ${regNo} (${transporterTarget || 'Transporter'}) will expire in ${diffDays} day(s) on ${expDateStr}.`,
              details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nExpiry Date: ${expDateStr}\nDays Remaining: ${diffDays} days`,
              timestamp: nowTimeStr,
              type: 'INFO',
              notificationSubType: 'DOC_EXPIRY_ALERT',
              status: 'PENDING',
              actionLabel: 'View Vehicle',
              priority: 'MEDIUM',
              targetRole: 'ADMIN,VEHICLE_MANAGER,TRANSPORTER',
              targetClientName: transporterTarget,
              category: 'TRANSPORTER',
              targetView: 'vehicles',
              targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
            }).catch(() => {});
          }
        }
      }
    }

    // 5. Vehicle Location Updated by Driver (if Location Service is ON on this vehicle)
    const isLocationServiceOn = vehicle.locationServiceEnabled !== false;
    if (
      isLocationServiceOn &&
      vehicle.onlineLocation &&
      prevVehicle &&
      (vehicle.onlineLocation !== prevVehicle.onlineLocation || vehicle.lastLocationUpdatedAt !== prevVehicle.lastLocationUpdatedAt)
    ) {
      const locKey = `notif_veh_loc_${vehicle.id}`;
      const detId = parseNumericDocId(undefined, locKey, 15);
      const drvName = vehicle.lastLocationDriverName || vehicle.driverName || 'Driver';
      saveNotificationToFirestore({
        id: detId,
        title: `Vehicle Location Updated by Driver: ${regNo}`,
        description: `Driver ${drvName} updated live location for vehicle ${regNo}: ${vehicle.onlineLocation}.`,
        details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nDriver: ${drvName}\nCurrent Location: ${vehicle.onlineLocation}\nUpdated At: ${vehicle.lastLocationUpdatedAt || nowTimeStr}`,
        timestamp: nowTimeStr,
        type: 'INFO',
        notificationSubType: 'VEHICLE_LOCATION_UPDATE',
        status: 'PENDING',
        actionLabel: 'View Live Location',
        priority: 'HIGH',
        targetRole: 'TRANSPORTER,VEHICLE_MANAGER',
        targetClientName: transporterTarget,
        category: 'TRANSPORTER',
        targetView: 'vehicles',
        targetFilter: { vehicleId: vehicle.id, vehicleNo: regNo }
      }).catch(() => {});
    }

    // 6. Vehicle Missing Alert (if Location Service is ON on this vehicle)
    if (isLocationServiceOn && vehicle.isMissingAlertActive && !prevVehicle?.isMissingAlertActive) {
      const missKey = `notif_veh_missing_${vehicle.id}`;
      const detId = parseNumericDocId(undefined, missKey, 16);
      saveNotificationToFirestore({
        id: detId,
        title: `Vehicle Missing Alert: ${regNo}`,
        description: `URGENT: Vehicle ${regNo} (Driver: ${vehicle.driverName || 'N/A'}) has Location Service ON but GPS signal is missing / vehicle unresponsive!`,
        details: `Vehicle No: ${regNo}\nTransporter: ${transporterTarget || 'N/A'}\nDriver: ${vehicle.driverName || 'N/A'} (${vehicle.driverContact || 'N/A'})\nLast Known Location: ${vehicle.onlineLocation || 'Unknown'}\nAlert: Vehicle Missing / GPS Signal Lost while Location Service is ON.`,
        timestamp: nowTimeStr,
        type: 'ALERT',
        notificationSubType: 'VEHICLE_MISSING_ALERT',
        status: 'PENDING',
        actionLabel: 'Locate Vehicle',
        priority: 'HIGH',
        targetRole: 'TRANSPORTER,VEHICLE_MANAGER,ADMIN',
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

export async function saveVehicleToFirestore(vehicle: Vehicle): Promise<void> {
  const path = 'vehicles';
  const docId = String(vehicle.id || Date.now());
  const activeCompany = getActiveCompanyId();
  backupVehiclesToIndexedDB([vehicle]).catch(() => {});
  try {
    const payload = sanitizeForFirestore({
      ...vehicle,
      companyId: (vehicle as any).companyId || activeCompany,
      id: Number(docId),
      createdBy: auth.currentUser?.uid || 'guest',
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload);
    dispatchTransporterVehicleNotifications({ ...vehicle, id: Number(docId) }, null, true);
  } catch (error) {
    console.warn(`Firestore saveVehicle warning:`, error);
  }
}

export async function updateVehicleInFirestore(vehicle: Vehicle): Promise<void> {
  const path = 'vehicles';
  const docId = String(vehicle.id);
  const activeCompany = getActiveCompanyId();
  let prevVehicle: Vehicle | null = null;
  try {
    const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
    prevVehicle = liveVehicles.find(v => Number(v.id) === Number(vehicle.id)) || null;
  } catch (_) {}

  try {
    const payload = sanitizeForFirestore({ 
      ...vehicle, 
      companyId: (vehicle as any).companyId || activeCompany,
      updatedAt: new Date().toISOString() 
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
    const mergedVehicle = prevVehicle ? { ...prevVehicle, ...vehicle } : vehicle;
    dispatchTransporterVehicleNotifications(mergedVehicle, prevVehicle, false);
  } catch (error) {
    console.warn(`Firestore updateVehicle warning:`, error);
  }
}

export async function deleteVehicleFromFirestore(vehicleId: number | string): Promise<void> {
  const path = 'vehicles';
  try {
    await deleteDoc(doc(db, path, String(vehicleId)));
  } catch (error) {
    console.warn(`Firestore deleteVehicle warning:`, error);
  }
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
let hasPurgedStaleNotificationsV5 = false;

/**
 * Checks whether a notification is an orphaned ghost notification pointing to deleted/reset data.
 */
function isOrphanedNotification(n: AppNotification): boolean {
  if (!n || !n.title) return true;

  // 1. Check against last reset timestamp if present
  const lastResetIso = safeAppStorage.getRawItem('dpl_last_reset_timestamp');
  if (lastResetIso && (n as any).updatedAt) {
    const resetTime = new Date(lastResetIso).getTime();
    const notifTime = new Date((n as any).updatedAt).getTime();
    if (!isNaN(resetTime) && !isNaN(notifTime) && notifTime < resetTime) {
      return true;
    }
  }

  // 2. Check if notification points to a Case when Cases collection is empty or case was deleted
  const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
  const caseNoTarget = n.targetFilter?.caseNo || n.approvalData?.caseNo;
  const caseIdTarget = n.targetFilter?.caseId || (n.approvalData?.entityType === 'case' ? n.approvalData?.entityId : undefined);
  if (n.category === 'CASE' || caseNoTarget || caseIdTarget || n.targetView === 'cases') {
    if (liveCases.length === 0) return true;
    if (caseNoTarget && !liveCases.some(c => (c.caseNo || c.caseNumber) === caseNoTarget)) return true;
    if (caseIdTarget && !liveCases.some(c => String(c.id) === String(caseIdTarget))) return true;
  }

  // 3. Check if notification points to a Vehicle when Vehicles collection is empty or vehicle was deleted
  const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
  const vehNoTarget = n.targetFilter?.vehicleNo;
  const vehIdTarget = n.targetFilter?.vehicleId || (n.approvalData?.entityType === 'vehicle' ? n.approvalData?.entityId : undefined);
  const isVehicleNotif =
    Boolean(vehNoTarget) ||
    Boolean(vehIdTarget) ||
    n.targetView === 'vehicles' ||
    n.notificationSubType === 'VEHICLE_REGISTERED' ||
    n.notificationSubType === 'VEHICLE_RENEWED' ||
    n.notificationSubType === 'VEHICLE_CANCELLED_NOC' ||
    n.notificationSubType === 'IDLE_VEHICLE_ALERT' ||
    (n.notificationSubType === 'DOC_EXPIRY_ALERT' && n.category === 'TRANSPORTER');

  if (isVehicleNotif) {
    if (liveVehicles.length === 0) return true;
    if (vehNoTarget && !liveVehicles.some(v => (v.registrationNumber || '').toLowerCase() === String(vehNoTarget).toLowerCase())) return true;
    if (vehIdTarget && !liveVehicles.some(v => String(v.id) === String(vehIdTarget))) return true;
  }

  // 4. Check if notification points to Company Documents when Company Documents collection is empty
  const liveDocs = safeAppStorage.getJSON<CompanyDocument[]>('dpl_company_documents', []);
  if (
    n.targetView === 'company_documents' ||
    n.notificationSubType === 'HEARING_NOTICE_REMINDER' ||
    (n.notificationSubType === 'DOC_EXPIRY_ALERT' && n.category !== 'TRANSPORTER')
  ) {
    if (liveDocs.length === 0) return true;
  }

  // 5. Check if notification points to Finance when all finance arrays are empty
  const liveFin = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []);
  const liveRecv = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_receivables', []);
  const livePay = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);
  if (
    n.category === 'FINANCE' ||
    n.targetView === 'finance' ||
    n.notificationSubType === 'FINANCE_RECORDED' ||
    n.notificationSubType === 'INVOICE_CHARGE_NOTIFICATION' ||
    n.notificationSubType === 'PAYMENT_APPROVAL' ||
    n.approvalData?.entityType === 'finance'
  ) {
    if (liveFin.length === 0 && liveRecv.length === 0 && livePay.length === 0) return true;
  }

  return false;
}

export function subscribeToNotifications(
  onData: (items: AppNotification[]) => void,
  onError?: (err: any) => void
) {
  const path = 'notifications';

  // One-time cleanup of stale/pre-reset notifications so 99+ ghost notifications from prior resets are wiped immediately
  if (!hasPurgedStaleNotificationsV5 && typeof window !== 'undefined') {
    hasPurgedStaleNotificationsV5 = true;
    if (safeAppStorage.getRawItem('dpl_purge_stale_notifications_v5') !== 'done') {
      safeAppStorage.setRawItem('dpl_purge_stale_notifications_v5', 'done');
      safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, []);
      onData([]);
      clearAllNotificationsInFirestore().catch(() => {});
    }
  }

  // 1. Immediately emit valid local cached notifications
  const cached = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []);
  if (cached && cached.length > 0) {
    const validCached = dedupeArrayById(cached).filter(n => !isOrphanedNotification(n));
    onData(validCached);
  } else {
    onData([]);
  }

  // 2. Intra-window broadcast listener
  const handleLocalUpdate = () => {
    const fresh = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []);
    const validFresh = fresh ? dedupeArrayById(fresh).filter(n => !isOrphanedNotification(n)) : [];
    onData(validFresh);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('dpl_notification_updated', handleLocalUpdate);
    window.addEventListener('dpl_cases_updated', handleLocalUpdate);
    window.addEventListener('dpl_finance_updated', handleLocalUpdate);
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

      // Automatically purge orphaned ghost notifications from Firestore in the background
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

      // Deduplicate by both id and title+description signature so identical spam notifications never stack
      const seenSig = new Set<string>();
      const uniqueItems: AppNotification[] = [];
      for (const item of dedupeArrayById(items)) {
        const sig = `${item.title || ''}__${item.description || ''}__${item.status || ''}`;
        if (!seenSig.has(sig)) {
          seenSig.add(sig);
          uniqueItems.push(item);
        }
      }

      // Sort newest first
      uniqueItems.sort((a, b) => {
        const timeA = a.id || 0;
        const timeB = b.id || 0;
        return timeB - timeA;
      });

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
      window.removeEventListener('dpl_cases_updated', handleLocalUpdate);
      window.removeEventListener('dpl_finance_updated', handleLocalUpdate);
    }
  };
}

export async function saveNotificationToFirestore(notif: AppNotification): Promise<void> {
  const path = 'notifications';
  // Use deterministic ID if not provided or if based on title+entity so identical notifications never duplicate
  const deterministicKey = `${notif.notificationSubType || 'GEN'}_${notif.title || ''}_${notif.targetFilter?.caseNo || notif.targetFilter?.vehicleNo || notif.approvalData?.entityId || ''}`;
  const numId = notif.id || parseNumericDocId(undefined, deterministicKey, 0);
  const docId = String(numId);
  const activeCompany = getActiveCompanyId();
  const payload = sanitizeForFirestore({
    ...notif,
    companyId: (notif as any).companyId || activeCompany,
    id: numId,
    updatedAt: new Date().toISOString()
  });

  // Save to local storage cache immediately so UI reacts instantly
  try {
    const current = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []) || [];
    const filtered = current.filter(n => Number(n.id) !== Number(numId) && String(n.id) !== docId);
    const updated = dedupeArrayById([payload as AppNotification, ...filtered]);
    safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_notification_updated', { detail: payload }));
    }
  } catch (storageErr) {
    console.warn("Storage sync error on saveNotification:", storageErr);
  }

  // Persist to Firestore
  try {
    await setDoc(doc(db, path, docId), payload, { merge: true });
  } catch (error) {
    console.warn(`Firestore saveNotification warning:`, error);
  }
}

export async function updateNotificationInFirestore(notif: AppNotification): Promise<void> {
  const path = 'notifications';
  const numId = Number(notif.id);
  const docId = String((notif as any)._docId || numId);
  const payload = sanitizeForFirestore({ ...notif, updatedAt: new Date().toISOString() });

  // Update local storage cache immediately
  try {
    const current = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []) || [];
    const updated = dedupeArrayById(current.map(n => Number(n.id) === numId ? { ...n, ...payload } : n));
    safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_notification_updated', { detail: payload }));
    }
  } catch (storageErr) {
    console.warn("Storage sync error on updateNotification:", storageErr);
  }

  // Persist to Firestore
  try {
    await setDoc(doc(db, path, docId), payload, { merge: true });
  } catch (error) {
    console.warn(`Firestore updateNotification warning:`, error);
  }
}

export async function deleteNotificationFromFirestore(notifId: number | string, rawDocId?: string): Promise<void> {
  const path = 'notifications';
  const docId = String(rawDocId || notifId);
  try {
    const current = safeAppStorage.getJSON<AppNotification[]>(NOTIFICATIONS_STORAGE_KEY, []) || [];
    const updated = current.filter(n => String(n.id) !== String(notifId) && String((n as any)._docId || '') !== docId);
    safeAppStorage.setJSON(NOTIFICATIONS_STORAGE_KEY, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_notification_updated'));
    }
  } catch (_) {}

  try {
    await deleteDoc(doc(db, path, docId));
    if (rawDocId && String(notifId) !== rawDocId) {
      await deleteDoc(doc(db, path, String(notifId))).catch(() => {});
    }
  } catch (err) {
    console.warn('Firestore deleteNotification warning:', err);
  }
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
  { id: 101, userId: 'arbab', password: 'Behzadmk@123', name: 'Arbab Khan Boby (System Administrator)', role: UserRole.ADMIN, roles: [UserRole.ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.CASE_MANAGER, UserRole.FINANCE_MANAGER], designation: 'Main Group Administrator', contact: '0300-1234567', email: 'arbabkhanboby@makgroup.com', status: 'ACTIVE', isAdmin: true, isGlobalAdmin: true, allowedCompanies: ['docks', 'muhib', 'vantage', 'truckit'], baseSalary: 0 },
  { id: 102, userId: 'admin', password: 'Behzadmk@123', name: 'Arbab Khan Boby (System Administrator)', role: UserRole.ADMIN, roles: [UserRole.ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.CASE_MANAGER, UserRole.FINANCE_MANAGER], designation: 'Main Group Administrator', contact: '0300-1234567', email: 'arbabkhanboby@makgroup.com', status: 'ACTIVE', isAdmin: true, isGlobalAdmin: true, allowedCompanies: ['docks', 'muhib', 'vantage', 'truckit'], baseSalary: 0 },
  { id: 103, userId: 'behzad', password: 'Behzadmk@123', name: 'Arbab Khan Boby (System Administrator)', role: UserRole.ADMIN, roles: [UserRole.ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.CASE_MANAGER, UserRole.FINANCE_MANAGER], designation: 'Main Group Administrator', contact: '0300-1234567', email: 'arbabkhanboby@makgroup.com', status: 'ACTIVE', isAdmin: true, isGlobalAdmin: true, allowedCompanies: ['docks', 'muhib', 'vantage', 'truckit'], baseSalary: 0 },
  { id: 2, userId: 'finance', password: 'dpl01234', name: 'Finance Manager', role: UserRole.FINANCE_MANAGER, roles: [UserRole.FINANCE_MANAGER], designation: 'Finance Manager', contact: '0333-5554444', email: 'finance@docks.com', status: 'ACTIVE', isAdmin: false, isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit', 'muhib', 'vantage'], baseSalary: 0 },
  { id: 3, userId: 'casemanager', password: 'dpl01234', name: 'Operations Manager', role: UserRole.OPERATIONS_MANAGER, roles: [UserRole.OPERATIONS_MANAGER], designation: 'Operations Manager', contact: '0321-9876543', email: 'casemanager@docks.com', status: 'ACTIVE', isAdmin: false, isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'], baseSalary: 0 },
  { id: 4, userId: 'vehiclemanager', password: 'dpl01234', name: 'Vehicles Manager', role: UserRole.VEHICLE_MANAGER, roles: [UserRole.VEHICLE_MANAGER], designation: 'Fleet & Vehicle Manager', contact: '0301-2233445', email: 'transport@docks.com', status: 'ACTIVE', isGlobalAdmin: false, allowedCompanies: ['truckit', 'docks'], baseSalary: 0 },
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
  // Multi-role example: Operations + Vehicle Management
  { id: 14, userId: 'ops_fleet', password: 'dpl01234', name: 'Operations & Fleet Coordinator', role: UserRole.OPERATIONS_MANAGER, roles: [UserRole.OPERATIONS_MANAGER, UserRole.VEHICLE_MANAGER], designation: 'Ops & Fleet Manager', contact: '0300-4433221', email: 'opsfleet@docks.com', status: 'ACTIVE', isAdmin: false, isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'], baseSalary: 0 },
  // Multi-role example: Finance + Vehicle Management
  { id: 15, userId: 'fin_fleet', password: 'dpl01234', name: 'Finance & Transport Billing', role: UserRole.FINANCE_MANAGER, roles: [UserRole.FINANCE_MANAGER, UserRole.VEHICLE_MANAGER], designation: 'Finance & Vehicle Manager', contact: '0300-5544332', email: 'finfleet@docks.com', status: 'ACTIVE', isAdmin: false, isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'], baseSalary: 0 }
];

let hasSeededInitialUsers = false;

/**
 * Subscribes to live Firestore users collection.
 * Automatically seeds default organization accounts if Firestore users collection is empty.
 */
export function subscribeToUsers(
  onData: (users: AppUser[]) => void,
  onError?: (err: any) => void
) {
  const path = 'users';
  return onSnapshot(
    collection(db, path),
    async (snapshot) => {
      if (snapshot.empty && !hasSeededInitialUsers) {
        hasSeededInitialUsers = true;
        console.log('Seeding default organizational accounts to Firestore database...');
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
          onData(DEFAULT_DATABASE_USERS);
          return;
        } catch (seedErr) {
          console.warn('Failed to seed default users:', seedErr);
        }
      }

      const list: AppUser[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const nameLower = (data.name || '').toLowerCase();
        const idLower = (data.userId || '').toLowerCase();
        const isClientOrTransporter = data.role === UserRole.CLIENT || data.role === UserRole.TRANSPORTER || data.status === 'PENDING_APPROVAL';
        const isLegacyPersonal = !isClientOrTransporter && !data.isGlobalAdmin && (
          nameLower.includes('mohsin') || 
          nameLower.includes('shahid') || 
          nameLower.includes('danish') || 
          nameLower.includes('tariq') ||
          nameLower.includes('rashid') ||
          idLower === 'mohsin' || 
          idLower === 'shahid' || 
          idLower === 'danish' || 
          idLower === 'documentmanager' ||
          idLower === 'lahore' ||
          idLower === 'peshawar'
        );

        if (isLegacyPersonal) {
          // Asynchronously clean up legacy document from Firestore
          deleteDoc(doc(db, path, docSnap.id)).catch(() => {});
        } else {
          const isAdminAccount = data.role === UserRole.ADMIN || idLower === 'admin' || nameLower.includes('administrator');
          if (isAdminAccount && Number(data.baseSalary) > 0) {
            data.baseSalary = 0;
            updateDoc(doc(db, path, docSnap.id), { baseSalary: 0 }).catch(() => {});
          }
          list.push({
            ...data,
            baseSalary: isAdminAccount ? 0 : data.baseSalary,
            id: Number(docSnap.id) || Number(data.id) || Date.now()
          } as AppUser);
        }
      });

      // Sort by id
      list.sort((a, b) => Number(a.id) - Number(b.id));
      onData(list.length > 0 ? list : DEFAULT_DATABASE_USERS);
    },
    (error) => {
      console.warn(`Firestore subscription notice on ${path}:`, error);
      if (onError) onError(error);
      onData(DEFAULT_DATABASE_USERS);
    }
  );
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
      // Fire-and-forget sync to Firestore so login is never blocked or hanged
      Promise.allSettled([
        setDoc(doc(db, 'users', '1'), sanitizeForFirestore(adminMasterUser), { merge: true }),
        setDoc(doc(db, 'users', 'admin'), sanitizeForFirestore({ ...adminMasterUser, id: 'admin', userId: 'admin' }), { merge: true }),
        setDoc(doc(db, 'users', 'arbab'), sanitizeForFirestore({ ...adminMasterUser, id: 'arbab', userId: 'arbab' }), { merge: true }),
        setDoc(doc(db, 'users', 'behzad'), sanitizeForFirestore({ ...adminMasterUser, id: 'behzad', userId: 'behzad' }), { merge: true })
      ]).catch(() => {});

      return adminMasterUser;
    }

    // 1. Query Firestore users collection (with safe 3.5s timeout to prevent network hangs)
    let matchedUser: AppUser | null = null;
    try {
      const snapPromise = getDocs(collection(db, 'users'));
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Firestore getDocs timeout')), 3500)
      );
      const snap = await Promise.race([snapPromise, timeoutPromise]);
      snap.forEach((docSnap) => {
        const u = docSnap.data() as AppUser;
        const uIdLower = (u.userId || '').toLowerCase();
        const uIdNoSpaces = uIdLower.replace(/[\s\-_.]/g, '');
        const uEmailLower = (u.email || '').toLowerCase();
        const uNameLower = (u.name || '').toLowerCase();

        const matchUserId = 
          uIdLower === cleanId || 
          uIdNoSpaces === cleanIdNoSpaces ||
          (cleanId.length >= 4 && (uIdLower.includes(cleanId) || cleanId.includes(uIdLower)));
        const matchEmail = uEmailLower === cleanId;
        const matchName = 
          uNameLower === cleanId || 
          (cleanId.length >= 3 && uNameLower.includes(cleanId));

        if (matchUserId || matchEmail || matchName) {
          matchedUser = { ...u, id: Number(docSnap.id) || Number(u.id) || (docSnap.id as any) };
        }
      });
    } catch (dbErr: any) {
      console.log('Firestore offline / unreachable, falling back to local credentials catalog.');
    }

    // 1.5. If not matched, query Firestore clients collection
    if (!matchedUser) {
      try {
        const clientSnap = await getDocs(collection(db, 'clients'));
        clientSnap.forEach((docSnap) => {
          const client = docSnap.data();
          if (client.loginEnabled || (client.userId && client.password)) {
            const cUserId = (client.userId || '').toLowerCase();
            const cEmail = (client.email || '').toLowerCase();
            const cName = (client.name || '').toLowerCase();

            const matchUserId = cUserId === cleanId || cUserId.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces;
            const matchEmail = cEmail === cleanId;
            const matchName = cName === cleanId || (cleanId.length >= 3 && cName.includes(cleanId));

            if (matchUserId || matchEmail || matchName) {
              matchedUser = {
                id: docSnap.id as any,
                userId: client.userId,
                password: client.password,
                name: client.name,
                role: client.role || UserRole.CLIENT,
                roles: client.roles || [UserRole.CLIENT],
                designation: 'Corporate Importer',
                contact: client.contact || client.mobileNumber || '',
                email: client.email || '',
                status: 'ACTIVE',
                clientName: client.name,
                lastLogin: client.lastLogin || ''
              } as unknown as AppUser;
            }
          }
        });
      } catch (dbErr: any) {
        console.log('Error querying clients from Firestore:', dbErr);
      }
    }

    // 1.7. If not matched, query Firestore drivers & vehicles collections and local caches (for Driver Trip Login IDs created by Transporters)
    if (!matchedUser) {
      let expiredTripIdNotice: string | null = null;

      const checkDriverMatch = (drv: any, fallbackId?: string): AppUser | null => {
        if (!drv) return null;
        const dUserId = (drv.userId || '').toLowerCase().trim();
        const dExpiredId = (drv.lastExpiredTripId || '').toLowerCase().trim();
        const dPhone = (drv.contact || '').toLowerCase().trim();
        const dName = (drv.name || '').toLowerCase().trim();
        const dVeh = (drv.assignedVehicleNo || '').toLowerCase().trim();

        const matchUserId = dUserId && (dUserId === cleanId || dUserId.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces);
        const matchExpiredId = dExpiredId && (dExpiredId === cleanId || dExpiredId.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces);
        const matchPhone = dPhone && (dPhone === cleanId || dPhone.replace(/[\s\-_.]/g, '') === cleanIdNoSpaces);
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

      // Check local cached drivers first for instant response
      const localDrivers = safeAppStorage.getJSON<Driver[]>('dpl_live_drivers', []) || [];
      for (const d of localDrivers) {
        const m = checkDriverMatch(d, d.id);
        if (m) {
          matchedUser = m;
          break;
        }
      }

      // Check local cached vehicles for Trip Driver IDs
      if (!matchedUser) {
        const localVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []) || [];
        for (const v of localVehicles) {
          const m = checkVehicleDriverMatch(v);
          if (m) {
            matchedUser = m;
            break;
          }
        }
      }

      // Also check Firestore drivers collection
      if (!matchedUser && !expiredTripIdNotice) {
        try {
          const drvSnap = await getDocs(collection(db, 'drivers'));
          drvSnap.forEach((docSnap) => {
            if (!matchedUser) {
              const m = checkDriverMatch(docSnap.data(), docSnap.id);
              if (m) matchedUser = m;
            }
          });
        } catch (drvErr) {
          console.log('Error querying drivers from Firestore:', drvErr);
        }
      }

      if (!matchedUser && expiredTripIdNotice) {
        throw new Error(expiredTripIdNotice);
      }
    }

    // 2. Fallback to default catalog if database is offline or user not yet in Firestore
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

    try {
      if (updatedUser.role === UserRole.CLIENT) {
        await setDoc(
          doc(db, 'clients', String(updatedUser.id)),
          sanitizeForFirestore({
            lastLogin: updatedUser.lastLogin
          }),
          { merge: true }
        );
      } else {
        await setDoc(
          doc(db, 'users', String(updatedUser.id)),
          sanitizeForFirestore(updatedUser),
          { merge: true }
        );
      }
    } catch (saveErr) {
      console.warn('Could not record lastLogin in Firestore:', saveErr);
    }

    saveActiveDbUserSession(updatedUser);
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
  const docId = String(user.id || Date.now());
  try {
    const payload = sanitizeForFirestore({
      ...user,
      id: Number(docId),
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
  } catch (error) {
    console.warn(`Firestore saveUser warning:`, error);
  }
}

export async function deleteUserFromFirestore(userId: number | string): Promise<void> {
  const path = 'users';
  try {
    await deleteDoc(doc(db, path, String(userId)));
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

export function subscribeToClients(
  onData: (clients: Client[]) => void,
  onError?: (err: any) => void
) {
  const path = 'clients';
  let cachedDocs: any[] = [];

  const emit = () => {
    const active = getActiveCompanyId();
    const localDocsMap = safeAppStorage.getJSON<Record<string, Partial<Client>>>('dpl_persistent_client_docs', {}) || {};
    const list: Client[] = [];
    cachedDocs.forEach((docData) => {
      if (matchesActiveCompany(docData.companyId, active)) {
        const localBackup = localDocsMap[String(docData.id)] || {};
        list.push({
          ...docData,
          businessCardUrl: docData.businessCardUrl || localBackup.businessCardUrl || '',
          contractLetterUrl: docData.contractLetterUrl || localBackup.contractLetterUrl || '',
          nicDocUrl: docData.nicDocUrl || localBackup.nicDocUrl || '',
          cnicFrontUrl: docData.cnicFrontUrl || localBackup.cnicFrontUrl || docData.nicDocUrl || localBackup.nicDocUrl || '',
          cnicBackUrl: docData.cnicBackUrl || localBackup.cnicBackUrl || '',
          ntnDocUrl: docData.ntnDocUrl || (localBackup as any).ntnDocUrl || ''
        } as Client);
      }
    });
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
    await deleteDoc(doc(db, path, clientId));
  } catch (error) {
    console.warn(`Firestore deleteClient warning:`, error);
  }
}

export async function saveClientToFirestore(client: Partial<Client>): Promise<string> {
  const path = 'clients';
  const docId = client.id || `client_${Date.now()}`;
  const activeCompany = getActiveCompanyId();
  try {
    // Preserve large base64 documents in localStorage backup before sanitizeForFirestore strips >150KB strings
    try {
      const localDocsMap = safeAppStorage.getJSON<Record<string, any>>('dpl_persistent_client_docs', {}) || {};
      localDocsMap[String(docId)] = {
        ...(localDocsMap[String(docId)] || {}),
        businessCardUrl: client.businessCardUrl || localDocsMap[String(docId)]?.businessCardUrl || '',
        contractLetterUrl: client.contractLetterUrl || localDocsMap[String(docId)]?.contractLetterUrl || '',
        nicDocUrl: client.nicDocUrl || (client as any).cnicFrontUrl || localDocsMap[String(docId)]?.nicDocUrl || '',
        cnicFrontUrl: (client as any).cnicFrontUrl || client.nicDocUrl || localDocsMap[String(docId)]?.cnicFrontUrl || '',
        cnicBackUrl: (client as any).cnicBackUrl || localDocsMap[String(docId)]?.cnicBackUrl || '',
        ntnDocUrl: (client as any).ntnDocUrl || localDocsMap[String(docId)]?.ntnDocUrl || ''
      };
      safeAppStorage.setJSON('dpl_persistent_client_docs', localDocsMap);
    } catch (_) {}

    const payload = sanitizeForFirestore({
      ...client,
      companyId: (client as any).companyId || activeCompany,
      id: docId,
      name: client.name?.trim() || 'New Client',
      ownerName: client.ownerName || '',
      contact: client.contact || '',
      officeAddress: client.officeAddress || '',
      mobileNumber: client.mobileNumber || '',
      whatsappNumber: client.whatsappNumber || '',
      email: client.email || '',
      cnic: client.cnic || '',
      ntn: client.ntn || '',
      strn: client.strn || '',
      businessCardUrl: client.businessCardUrl || '',
      businessCardName: (client as any).businessCardName || '',
      contractLetterUrl: client.contractLetterUrl || '',
      contractLetterName: (client as any).contractLetterName || '',
      nicDocUrl: client.nicDocUrl || (client as any).cnicFrontUrl || '',
      nicDocName: (client as any).nicDocName || '',
      cnicFrontUrl: (client as any).cnicFrontUrl || client.nicDocUrl || '',
      cnicFrontName: (client as any).cnicFrontName || '',
      cnicBackUrl: (client as any).cnicBackUrl || '',
      cnicBackName: (client as any).cnicBackName || '',
      ntnDocUrl: (client as any).ntnDocUrl || '',
      ntnDocName: (client as any).ntnDocName || '',
      defaultCaseCategory: client.defaultCaseCategory || 'Bonded Carrier',
      defaultServiceArrangements: client.defaultServiceArrangements || {},
      defaultCharges: client.defaultCharges || [],
      openingBalance: client.openingBalance || 0,
      userId: client.userId || '',
      password: client.password || '',
      loginEnabled: client.loginEnabled ?? false,
      status: (client as any).status || 'ACTIVE',
      createdAt: client.createdAt || new Date().toISOString()
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
      onData(list);
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
      id: docId,
      name: staff.name?.trim() || 'Staff Representative',
      station: staff.station || 'Karachi Port',
      role: staff.role || 'Station Supervisor',
      contact: staff.contact || '',
      cnic: staff.cnic || '',
      address: staff.address || '',
      commissionOrSalary: staff.commissionOrSalary || 0,
      paymentType: staff.paymentType || 'Monthly Salary',
      status: staff.status || 'Active',
      notes: staff.notes || '',
      createdAt: staff.createdAt || new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });
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

// STAFF DUAL LEDGERS (Salary & Daily Routine / Petty Cash)
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

  // 3. Reset in-memory logos
  PARENT_GROUP.logo = '';
  Object.keys(GROUP_COMPANIES).forEach((k) => {
    GROUP_COMPANIES[k as CompanyId].logo = '';
  });

  // 4. Wipe universal unified storage (all operational dpl_, notif_, audit_ keys in memory, localStorage, and sessionStorage)
  try {
    safeAppStorage.wipeAppOperationalData(true);
    safeAppStorage.setItem('dpl_cleanup_phantom_v3', 'done');
    safeAppStorage.setRawItem('dpl_purge_stale_notifications_v5', 'done');
    safeAppStorage.setRawItem('dpl_last_reset_timestamp', resetNowIso);
  } catch (e) {
    console.warn('Storage wipe notice:', e);
  }

  // 5. Explicitly purge all known keys to ensure complete wipe
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
    'dpl_ports', 'dpl_company_docs', 'dpl_company_documents', 'dpl_custom_banks', 'dpl_last_cloud_backup_time',
    'dpl_last_location_view', 'dpl_last_location_role', 'dpl_session_active'
  ];

  explicitKeys.forEach((k) => {
    safeAppStorage.removeItem(k);
    try { localStorage.removeItem(k); } catch (_) {}
    try { sessionStorage.removeItem(k); } catch (_) {}
  });

  // 6. Ensure all payables, finances, cases, notifications, and activity logs in memory and storage are strictly empty
  safeAppStorage.setJSON('dpl_live_finance', []);
  safeAppStorage.setJSON('dpl_live_payables', []);
  safeAppStorage.setJSON('dpl_live_receivables', []);
  safeAppStorage.setJSON('dpl_live_cases', []);
  safeAppStorage.setJSON('dpl_live_notifications', []);
  safeAppStorage.setJSON('dpl_system_activity_logs', []);

  // 7. Remove custom branding for all companies and parent group
  ['docks', 'muhib', 'vantage', 'truckit'].forEach(cId => {
    safeAppStorage.removeItem(`dpl_company_branding_v1_${cId}`);
    safeAppStorage.removeItem(`dpl_live_notifications_${cId}`);
    try { localStorage.removeItem(`dpl_company_branding_v1_${cId}`); } catch (_) {}
    try { localStorage.removeItem(`dpl_live_notifications_${cId}`); } catch (_) {}
  });
  safeAppStorage.removeItem('mak_parent_group_branding');
  try { localStorage.removeItem('mak_parent_group_branding'); } catch (_) {}

  // 8. Reset Firestore settings docs
  try {
    await executeWithTimeout((async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'settings', 'branding'), { customLogo: null, updatedAt: resetNowIso }, { merge: true });
      batch.set(doc(db, 'settings', 'parent_group'), { logo: '', updatedAt: resetNowIso }, { merge: true });
      batch.set(doc(db, 'settings', 'system_reset'), { lastResetAt: resetNowIso }, { merge: true });
      for (const cId of ['muhib', 'vantage', 'truckit']) {
        batch.set(doc(db, 'settings', `branding_${cId}`), { customLogo: null, updatedAt: resetNowIso }, { merge: true });
      }
      await batch.commit();
    })(), 3500, null);
  } catch (err) {
    console.warn('Error resetting Firestore settings docs:', err);
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
    { name: 'company_documents', type: 'cases' }
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

  // Reset this company's logo in memory
  if (GROUP_COMPANIES[companyId]) {
    GROUP_COMPANIES[companyId].logo = '';
  }

  // 2. Filter local storage cached arrays to remove only this company's items (preserving shared vehicles)
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

    // Reset this specific company's branding
    safeAppStorage.removeItem(`dpl_company_branding_v1_${companyId}`);
    try { localStorage.removeItem(`dpl_company_branding_v1_${companyId}`); } catch (_) {}
    safeAppStorage.removeItem(`dpl_custom_banks_${companyId}`);
    try { localStorage.removeItem(`dpl_custom_banks_${companyId}`); } catch (_) {}

    // Reset Firestore branding doc for this company
    try {
      const docId = companyId === 'docks' ? 'branding' : `branding_${companyId}`;
      await setDoc(doc(db, 'settings', docId), { customLogo: null, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (err) {
      console.warn('Error resetting Firestore branding doc for company:', err);
    }
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
    const payload = sanitizeForFirestore({
      ...documentItem,
      companyId: documentItem.companyId || activeCompany,
      id: docId,
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(db, path, docId), payload, { merge: true });

    // Rule 7 & 8: Notify Admin immediately if Hearing Notice or Document Expired / Expiring Soon
    const catLower = (documentItem.category || '').toLowerCase();
    const titleLower = (documentItem.title || '').toLowerCase();
    const isHearing =
      catLower.includes('hearing') ||
      catLower.includes('show cause') ||
      catLower.includes('adjudication') ||
      titleLower.includes('hearing') ||
      titleLower.includes('show cause') ||
      titleLower.includes('notice');

    if (isHearing) {
      const hearingDate = (documentItem as any).hearingDate || documentItem.expiryDate || documentItem.issueDate || 'Scheduled';
      saveNotificationToFirestore({
        id: Date.now() + Math.floor(Math.random() * 1000),
        title: `Hearing Notice Reminder: ${documentItem.title}`,
        description: `Legal / Customs Hearing Notice "${documentItem.title}" recorded. Scheduled Date: ${hearingDate}.`,
        details: `Document: ${documentItem.title}\nCategory: ${documentItem.category}\nReference: ${documentItem.referenceNo || 'N/A'}\nDate: ${hearingDate}\nNotes: ${documentItem.notes || 'N/A'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'ALERT',
        notificationSubType: 'HEARING_NOTICE_REMINDER',
        status: 'PENDING',
        actionLabel: 'Open Hearing Notice',
        priority: 'HIGH',
        targetRole: 'ADMIN',
        category: 'GENERAL',
        targetView: 'company_documents'
      }).catch(() => {});
    } else if (documentItem.hasExpiry && documentItem.expiryDate) {
      const todayTime = new Date(new Date().toISOString().split('T')[0]).getTime();
      const expTime = new Date(documentItem.expiryDate).getTime();
      if (!isNaN(expTime)) {
        const diffDays = Math.ceil((expTime - todayTime) / (24 * 60 * 60 * 1000));
        if (diffDays <= 10) {
          saveNotificationToFirestore({
            id: Date.now() + Math.floor(Math.random() * 1000),
            title: diffDays <= 0 ? `Document Expired: ${documentItem.title}` : `Document Expiring Soon (${diffDays} Days): ${documentItem.title}`,
            description: diffDays <= 0
              ? `Company document "${documentItem.title}" expired on ${documentItem.expiryDate}.`
              : `Company document "${documentItem.title}" will expire in ${diffDays} day(s) on ${documentItem.expiryDate}.`,
            details: `Document: ${documentItem.title}\nCategory: ${documentItem.category}\nExpiry Date: ${documentItem.expiryDate}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'ALERT',
            notificationSubType: 'DOC_EXPIRY_ALERT',
            status: 'PENDING',
            actionLabel: 'Open Company Documents',
            priority: 'HIGH',
            targetRole: 'ADMIN',
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

export function subscribeToCompanyCategories(
  onData: (categories: string[]) => void,
  onError?: (err: any) => void
) {
  const path = 'company_document_categories';
  return onSnapshot(
    collection(db, path),
    async (snapshot) => {
      if (snapshot.empty) {
        // Seed default categories
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

      // Ensure all default categories are represented
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

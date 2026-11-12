/**
 * Automated Daily 12:00 PM Gate-Out Report, Company Document Expiry & Monthly Payable Scheduler
 * - Admin Daily 12:00 PM Loading Gate-Out Summary (Yesterday 12:00 PM -> Today 12:00 PM across all ports)
 * - Company Document Expiry Alerts (Expiring Soon / Expired -> Admin & Documentation Manager)
 * - Monthly Recurring Payable Auto-Entries (Notifies Finance Manager ONLY)
 */

import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import {
  saveNotificationToFirestore,
  saveFinanceToFirestore,
  matchesActiveCompany
} from './dbService';
import { getActiveCompanyId } from './companyService';
import { safeAppStorage } from './storage';
import {
  AppNotification,
  Case,
  CompanyDocument,
  DailyGateOutVehicleRow,
  FinanceEntry,
  RecurringFinanceTemplate,
  UserRole
} from '../types';
import { getCaseLoadingGateOutTimestamp, hasCaseCompletedLoadingGateOut } from './workflowConfig';

let schedulerStarted = false;
let schedulerIntervalId: ReturnType<typeof setInterval> | null = null;
let checkInFlight = false;

export async function notifyLiveFinanceTransaction(params: {
  direction: 'PAID' | 'RECEIVED';
  amount: number;
  party: string;
  description: string;
  paymentMethod?: string;
  caseNo?: string;
  reference?: string;
}): Promise<void> {
  try {
    const isPaid = params.direction === 'PAID';
    const amtStr = Number(params.amount || 0).toLocaleString();
    await saveNotificationToFirestore({
      id: Date.now() + Math.floor(Math.random() * 1000),
      title: isPaid
        ? `Expense Paid: PKR ${amtStr} (${params.party || 'Vendor/Staff'})`
        : `Payment Received: PKR ${amtStr} (${params.party || 'Client'})`,
      description: `${params.description || 'Financial transaction recorded'}${params.caseNo ? ` | Case: ${params.caseNo}` : ''}${params.paymentMethod ? ` | Mode: ${params.paymentMethod}` : ''}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'INFO',
      category: 'FINANCE',
      status: 'PENDING',
      targetRole: [UserRole.ADMIN, UserRole.FINANCE_MANAGER],
      notificationSubType: 'FINANCE_RECORDED',
      targetView: 'finance',
      targetFilter: params.caseNo ? { caseNo: params.caseNo } : undefined,
      actionLabel: 'View Cashbook'
    });
  } catch (err) {
    console.warn('notifyLiveFinanceTransaction notice:', err);
  }
}

function formatDateYmdLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatReadableNoon(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }) + ' 12:00 PM';
}

function hashDeterministicNumericId(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 700000000 + (Math.abs(hash) % 200000000);
}

/**
 * Computes the unpaid payable amount associated with a specific Case / Vehicle so far.
 */
function computeCaseAmountPayableSoFar(
  caseItem: Case,
  containerObj: any,
  allFinances: FinanceEntry[]
): number {
  let totalPayable = 0;
  const caseNoClean = String(caseItem.caseNo || caseItem.caseNumber || '').trim().toLowerCase();

  // 1. Explicit unpaid PAYABLE entries in Finance linked to this Case
  if (caseNoClean) {
    for (const f of allFinances) {
      if (f.type !== 'PAYABLE' || f.status === 'PAID' || (f.status as string) === 'CANCELLED') continue;
      const fCase = String((f as any).caseNo || '').trim().toLowerCase();
      const fDesc = String(f.description || '').toLowerCase();
      const fRef = String(f.reference || '').toLowerCase();
      if (fCase === caseNoClean || (caseNoClean.length >= 5 && (fDesc.includes(caseNoClean) || fRef.includes(caseNoClean)))) {
        const remaining =
          typeof f.remainingAmount === 'number' && f.remainingAmount > 0
            ? f.remainingAmount
            : Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0));
        totalPayable += remaining;
      }
    }
  }

  // 2. Unpaid Loading / Destination Bills arranged by Company (DPL)
  const bills = [
    ...(Array.isArray(caseItem.loadingBills) ? caseItem.loadingBills : []),
    ...(Array.isArray(caseItem.destinationBills) ? caseItem.destinationBills : [])
  ];
  for (const b of bills) {
    if (!b || b.status === 'PAID' || b.arrangedBy === 'Client') continue;
    const bal =
      typeof b.balanceDue === 'number'
        ? Math.max(0, b.balanceDue)
        : Math.max(0, Number(b.totalAmount || b.grandTotal || 0) - Number(b.paidAmount || 0));
    totalPayable += bal;
  }

  // 3. Container Vehicle Rent payable by Company (if not already recorded in Finance Payables)
  if (containerObj && Number(containerObj.rentAmount || 0) > 0 && containerObj.rentPaymentBy !== 'Client') {
    const rentAmt = Number(containerObj.rentAmount || 0);
    if (totalPayable === 0) {
      totalPayable += rentAmt;
    }
  }

  return totalPayable;
}

/**
 * 1. Daily 12:00 PM Loading Gate-Out Summary for Admin:
 *    Window: Yesterday 12:00 PM -> Today 12:00 PM (across ALL ports).
 *    Clicking the notification opens the full Vehicle Gate-Out Table in NotificationModal.
 */
export async function runDaily12PmGateOutSummaryCheck(force = false): Promise<void> {
  try {
    const now = new Date();
    const activeCompany = getActiveCompanyId();

    // Determine the most recent completed 12:00 PM cycle
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    let windowEnd: Date;
    if (now.getTime() >= todayNoon.getTime()) {
      windowEnd = todayNoon;
    } else if (force) {
      windowEnd = now;
    } else {
      // Before 12:00 PM today: check if yesterday's 12:00 PM cycle was missed while offline
      windowEnd = new Date(todayNoon.getTime() - 24 * 60 * 60 * 1000);
    }
    const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

    const cycleKeyStr = formatDateYmdLocal(windowEnd);
    const localSentKey = `dpl_daily_12pm_gateout_${activeCompany}_${cycleKeyStr}`;
    if (!force && safeAppStorage.getItem(localSentKey) === 'true') {
      return;
    }

    const deterministicId = hashDeterministicNumericId(`DAILY_GATEOUT_12PM_${activeCompany}_${cycleKeyStr}`);
    if (!force) {
      try {
        const existingSnap = await getDoc(doc(db, 'notifications', String(deterministicId)));
        if (existingSnap.exists()) {
          safeAppStorage.setItem(localSentKey, 'true');
          return;
        }
      } catch (_) {}
    }

    // Fetch live cases & finances to build accurate 24h Gate-Out table
    const [casesSnap, financesSnap] = await Promise.all([
      getDocs(collection(db, 'cases')).catch(() => null),
      getDocs(collection(db, 'finances')).catch(() => null)
    ]);

    const casesList: Case[] = [];
    if (casesSnap) {
      casesSnap.forEach((ds) => {
        const data = ds.data() as Case;
        if (matchesActiveCompany((data as any).companyId, activeCompany)) {
          casesList.push({ ...data, id: ds.id });
        }
      });
    } else {
      const cachedCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []) || [];
      cachedCases.forEach((c) => {
        if (matchesActiveCompany((c as any).companyId, activeCompany)) casesList.push(c);
      });
    }

    const financesList: FinanceEntry[] = [];
    if (financesSnap) {
      financesSnap.forEach((ds) => {
        const data = ds.data() as FinanceEntry;
        if (matchesActiveCompany((data as any).companyId, activeCompany)) {
          financesList.push({ ...data, id: Number(data.id) || Number(ds.id) || 0 });
        }
      });
    }

    const startMs = windowStart.getTime();
    const endMs = windowEnd.getTime();
    const rows: DailyGateOutVehicleRow[] = [];

    for (const c of casesList) {
      if (!hasCaseCompletedLoadingGateOut(c)) continue;

      const gateOutIso =
        getCaseLoadingGateOutTimestamp(c) ||
        (c.updatedAt && !isNaN(new Date(c.updatedAt).getTime()) ? new Date(c.updatedAt).toISOString() : null);
      if (!gateOutIso) continue;

      const gateOutMs = new Date(gateOutIso).getTime();
      if (isNaN(gateOutMs) || gateOutMs < startMs || gateOutMs > endMs) continue;

      const importerName = (
        c.importer ||
        (c.extractedData as any)?.importerName ||
        c.extractedData?.consigneeName ||
        (c.extractedData as any)?.cargoOwner ||
        c.clientName ||
        'N/A'
      ).trim();

      const clientName = (c.clientName || c.client || 'N/A').trim();
      const pol = (c.pol || c.extractedData?.pol || 'Karachi Port').trim();
      const pod = (c.pod || c.extractedData?.pod || 'Destination').trim();
      const containers =
        Array.isArray(c.containers) && c.containers.length > 0
          ? c.containers
          : [
              {
                number: c.containerNumber || c.extractedData?.containerNo || 'N/A',
                vehicleNo: c.extractedData?.vehicleNumber || (c as any).vehicleNo || 'Assigned'
              } as any
            ];

      containers.forEach((cntr: any) => {
        const vehicleNo =
          cntr?.vehicleNo ||
          c.workflowDetails?.['Vehicle Assignment']?.assignedVehicleNo ||
          c.extractedData?.vehicleNumber ||
          'Assigned';
        const containerNo = cntr?.number || c.containerNumber || c.extractedData?.containerNo || 'N/A';
        const amountPayable = computeCaseAmountPayableSoFar(c, cntr, financesList);

        rows.push({
          caseNo: c.caseNo || c.caseNumber || c.id,
          vehicleNo,
          containerNo,
          clientName,
          importerName,
          pol,
          pod,
          amountPayable,
          gateOutTime: new Date(gateOutIso).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
          })
        });
      });
    }

    const totalVehicles = rows.length;
    const totalPayable = rows.reduce((sum, r) => sum + (Number(r.amountPayable) || 0), 0);
    const windowLabel = `${formatReadableNoon(windowStart)} → ${formatReadableNoon(windowEnd)}`;

    const summaryNotif: AppNotification = {
      id: force ? Date.now() : deterministicId,
      title: `12:00 PM Daily Loading Gate-Out Report: ${totalVehicles} Vehicle${totalVehicles === 1 ? '' : 's'}`,
      description: `From ${formatReadableNoon(windowStart)} to ${formatReadableNoon(windowEnd)}, ${totalVehicles} vehicle${totalVehicles === 1 ? '' : 's'} completed Loading Gate-Out across all ports. Total Payable So Far: PKR ${totalPayable.toLocaleString()}. Tap to view full vehicle list.`,
      details: `Reporting Window: ${windowLabel}\nTotal Vehicles Gate-Out: ${totalVehicles}\nTotal Amount Payable So Far: PKR ${totalPayable.toLocaleString()}`,
      timestamp: '12:00 PM',
      type: 'INFO',
      notificationSubType: 'DAILY_GATE_OUT_SUMMARY',
      status: 'PENDING',
      actionLabel: 'Open Gate-Out Vehicle Table',
      priority: 'HIGH',
      targetRole: 'ADMIN',
      category: 'CASE',
      gateOutReport: {
        windowLabel,
        windowStartIso: windowStart.toISOString(),
        windowEndIso: windowEnd.toISOString(),
        totalVehicles,
        totalPayable,
        rows
      }
    };

    safeAppStorage.setItem(localSentKey, 'true');
    await saveNotificationToFirestore(summaryNotif);
  } catch (err) {
    console.warn('[Scheduler] Daily 12:00 PM Gate-Out Summary check notice:', err);
  }
}

/**
 * 2. Daily Company Document Expiry Check:
 *    Notifies Admin & Documentation Manager ONLY when a document in Company Documents is expiring soon (<= 10 days) or expired.
 */
export async function runDailyCompanyDocExpiryCheck(): Promise<void> {
  try {
    const activeCompany = getActiveCompanyId();
    const todayStr = formatDateYmdLocal(new Date());
    const checkKey = `dpl_comp_doc_expiry_check_${activeCompany}_${todayStr}`;
    if (safeAppStorage.getItem(checkKey) === 'true') return;

    const snap = await getDocs(collection(db, 'company_documents')).catch(() => null);
    if (!snap) return;

    const todayMidnight = new Date(todayStr).getTime();
    snap.forEach((ds) => {
      const docItem = ds.data() as CompanyDocument;
      if (docItem.statusTag === 'Resolved' || docItem.statusTag === 'Archived') return;

      const alarmLeadDays =
        typeof docItem.alarmDaysBefore === 'number' && docItem.alarmDaysBefore > 0
          ? docItem.alarmDaysBefore
          : 15;

      // 1. Validity / Expiry Countdown Alarm
      const effectiveExp = docItem.validityEndDate || docItem.expiryDate;
      if (!docItem.unlimitedValidity && effectiveExp) {
        const expTime = new Date(effectiveExp).getTime();
        if (!isNaN(expTime)) {
          const diffDays = Math.ceil((expTime - todayMidnight) / (24 * 60 * 60 * 1000));
          if (diffDays <= alarmLeadDays) {
            const statusBucket = diffDays <= 0 ? 'EXPIRED' : `SOON_${diffDays}`;
            const notifId = hashDeterministicNumericId(`COMP_DOC_EXP_${ds.id}_${effectiveExp}_${statusBucket}`);
            saveNotificationToFirestore({
              id: notifId,
              title:
                diffDays <= 0
                  ? `Company Document Expired: ${docItem.title}`
                  : `Expiry Alarm (${diffDays}d left): ${docItem.title}`,
              description:
                diffDays <= 0
                  ? `Document "${docItem.title}" (${docItem.recipientEntity || docItem.to || 'MAK Group'}) expired on ${effectiveExp}.`
                  : `Document "${docItem.title}" will expire in ${diffDays} day(s) on ${effectiveExp}.`,
              details: `Document: ${docItem.title}\nRoot Category: ${docItem.rootCategory || docItem.category || 'Company Document'}\nFolder: ${docItem.subFolder || docItem.taxAuthority || docItem.assetGroup || 'General'}\nExpiry Date: ${effectiveExp}`,
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

      // 2. Legal Hearing / Action Date Countdown Alarm
      if (docItem.hearingDate) {
        const hearTime = new Date(docItem.hearingDate).getTime();
        if (!isNaN(hearTime)) {
          const hearDiff = Math.ceil((hearTime - todayMidnight) / (24 * 60 * 60 * 1000));
          if (hearDiff <= Math.max(7, alarmLeadDays)) {
            const hearBucket = hearDiff < 0 ? 'OVERDUE' : `DUE_${hearDiff}`;
            const hearNotifId = hashDeterministicNumericId(`COMP_DOC_HEAR_${ds.id}_${docItem.hearingDate}_${hearBucket}`);
            saveNotificationToFirestore({
              id: hearNotifId,
              title:
                hearDiff < 0
                  ? `Hearing Action Overdue (${Math.abs(hearDiff)}d): ${docItem.title}`
                  : hearDiff === 0
                    ? `Hearing / Action TODAY: ${docItem.title}`
                    : `Upcoming Hearing in ${hearDiff}d: ${docItem.title}`,
              description: `Hearing / Action scheduled on ${docItem.hearingDate}${docItem.hearingTime ? ` at ${docItem.hearingTime}` : ''} (${docItem.legalCaseTitle || docItem.senderIssuer || 'Legal Dossier'}).`,
              details: `Case / Document: ${docItem.legalCaseTitle || docItem.title}\nSub-Folder: ${docItem.subFolder || 'Legal'}\nIssuer / Forum: ${docItem.senderIssuer || docItem.from || 'N/A'}\nHearing Date: ${docItem.hearingDate}`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              type: 'ACTION',
              notificationSubType: 'LEGAL_HEARING_ALERT',
              status: 'PENDING',
              actionLabel: 'Review Case Dossier',
              priority: 'HIGH',
              targetRole: 'ADMIN,DOCUMENTATION_MANAGER',
              category: 'GENERAL',
              targetView: 'company_documents'
            }).catch(() => {});
          }
        }
      }
    });

    safeAppStorage.setItem(checkKey, 'true');
  } catch (err) {
    console.warn('[Scheduler] Company document expiry & hearing check notice:', err);
  }
}

/**
 * 3. Monthly Auto-Payable & Post-Midnight Month-End Office Salary Check:
 *    - Automatically posts completed month-end Office Staff Salaries (`salary_staff`) right after 12:00 AM midnight
 *      following the last day of each month (strictly within each staff member's company).
 *    - Automatically posts active user-configured RecurringFinanceTemplates once per month.
 *    - Notifies Finance Manager ONLY (via saveFinanceToFirestore's isMonthlyOrRecurring branch).
 */
export async function runMonthlySalaryRolloverCheck(): Promise<void> {
  try {
    const now = new Date();
    const todayYmd = formatDateYmdLocal(now);
    // Current month (Nov 2026) is Invoices & Case Registrations ONLY; Payables & Salaries start 2026-12-01
    if (todayYmd < '2026-12-01') return;

    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const activeCompany = getActiveCompanyId();

    // 3A. Run post-midnight month-end salary check (guarded once per calendar month rollover + staff count)
    const staffCount = (safeAppStorage.getJSON<any[]>('dpl_salary_staff', []) || []).length;
    const salaryRolloverKey = `dpl_month_end_salary_checked_${currentMonth}_${staffCount}`;
    if (safeAppStorage.getItem(salaryRolloverKey) !== 'true') {
      const { syncCompletedMonthSalaryStaffToPayables } = await import('./dbService');
      await syncCompletedMonthSalaryStaffToPayables({ nowOverride: now });
      safeAppStorage.setItem(salaryRolloverKey, 'true');
    }

    // 3B. Run monthly recurring overhead templates check
    const rolloverKey = `dpl_recurring_payable_checked_${activeCompany}_${currentMonth}`;
    if (safeAppStorage.getItem(rolloverKey) === 'true') return;

    const [recSnap, finSnap] = await Promise.all([
      getDocs(collection(db, 'recurring_templates')).catch(() => null),
      getDocs(collection(db, 'finances')).catch(() => null)
    ]);
    if (!recSnap || recSnap.empty) {
      safeAppStorage.setItem(rolloverKey, 'true');
      return;
    }

    const existingRefs = new Set<string>();
    if (finSnap) {
      finSnap.forEach((ds) => {
        const f = ds.data() as FinanceEntry;
        if (f.reference) existingRefs.add(String(f.reference));
      });
    }

    const todayDay = now.getDate();
    for (const ds of recSnap.docs) {
      const tpl = ds.data() as RecurringFinanceTemplate & { companyId?: string; lastGeneratedMonth?: string };
      if (!tpl || !tpl.active || Number(tpl.amount || 0) <= 0) continue;
      if (!matchesActiveCompany(tpl.companyId, activeCompany)) continue;
      if (tpl.lastGeneratedMonth === currentMonth) continue;
      if (todayDay < (Number(tpl.dayOfMonth) || 1)) continue;

      const refCode = `AUTO-MONTHLY-${ds.id}-${currentMonth}`;
      if (existingRefs.has(refCode)) continue;

      const autoPayable: FinanceEntry & { isRecurring?: boolean } = {
        id: hashDeterministicNumericId(refCode),
        companyId: tpl.companyId || activeCompany,
        date: formatDateYmdLocal(now),
        description: `Monthly Recurring Payable: ${tpl.title}`,
        amount: Number(tpl.amount),
        type: 'PAYABLE',
        status: 'APPROVED',
        party: tpl.party || 'Monthly Vendor / Account',
        category: tpl.category || 'Monthly Fixed Expense',
        reference: refCode,
        isRecurring: true
      };

      await saveFinanceToFirestore(autoPayable);
    }

    safeAppStorage.setItem(rolloverKey, 'true');
  } catch (err) {
    console.warn('[Scheduler] Monthly auto-payable check notice:', err);
  }
}

export async function runDailyAutomatedAudit(force = false): Promise<void> {
  if (checkInFlight && !force) return;
  checkInFlight = true;
  try {
    await runDaily12PmGateOutSummaryCheck(force);
    await runDailyCompanyDocExpiryCheck();
    await runMonthlySalaryRolloverCheck();
  } finally {
    checkInFlight = false;
  }
}

export function initAuditSchedulerService(): void {
  if (typeof window === 'undefined' || schedulerStarted) return;
  schedulerStarted = true;

  // Initial check shortly after workspace boot
  setTimeout(() => {
    runDailyAutomatedAudit(false).catch(() => {});
  }, 3500);

  // Check every 60 seconds so crossing 12:00 PM triggers live without page reload
  if (!schedulerIntervalId) {
    schedulerIntervalId = setInterval(() => {
      runDailyAutomatedAudit(false).catch(() => {});
    }, 60 * 1000);
  }
}

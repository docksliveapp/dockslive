import { 
  AppNotification, 
  Case, 
  Vehicle, 
  FinanceEntry, 
  CompanyDocument, 
  UserRole 
} from '../types';
import { 
  subscribeToNotifications, 
  saveNotificationToFirestore, 
  subscribeToFinances, 
  subscribeToCases, 
  subscribeToVehicles,
  subscribeToCompanyDocuments 
} from './dbService';
import { safeAppStorage } from './storage';
import { sendAppNotification } from './notificationService';

let isSchedulerInitialized = false;

/**
 * Initializes automated corporate compliance, midnight financial auditing,
 * fleet tracking, and document lifecycle alert monitors.
 */
export function initAuditSchedulerService() {
  if (isSchedulerInitialized) return;
  isSchedulerInitialized = true;

  // Run periodic audit checks every 10 minutes and on initial launch
  runFullComplianceAudit();
  setInterval(() => {
    runFullComplianceAudit();
  }, 10 * 60 * 1000);
}

/**
 * Executes full compliance audit across finances, fleet, consignments, and company documents.
 */
export async function runFullComplianceAudit() {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    // Retrieve active cached state
    const cases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []) || [];
    const vehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []) || [];
    const documents = safeAppStorage.getJSON<CompanyDocument[]>('dpl_company_documents', []) || [];

    // 1. Check Company Documents Expiries (10 Days Before & Expired) -> Admin
    if (documents.length > 0) {
      await checkCompanyDocumentExpiries(documents, todayStr);
      await checkHearingNoticeReminders(documents, cases, todayStr);
    }

    // 2. Check Vehicle Fleet Expiries (10 Days Before & Expired Today) -> Admin & Vehicle Manager
    if (vehicles.length > 0) {
      await checkVehicleFleetExpiries(vehicles, todayStr);
      await checkIdleVehicles(vehicles, cases);
    }

    // 3. Check 10-day Loading Gate-Out In-Transit consignments -> Operations Manager
    if (cases.length > 0) {
      await checkTenDayTransitDelay(cases);
    }
  } catch (err) {
    console.warn('Audit scheduler execution notice:', err);
  }
}

/**
 * Triggers an immediate live corporate notification for every payment paid or received.
 * Admin Rule: "Any payment paid and received notification"
 */
export async function notifyLiveFinanceTransaction(entry: FinanceEntry) {
  const isIncome = entry.type === 'INCOME';
  const isExpense = entry.type === 'EXPENSE';
  if (!isIncome && !isExpense) return;
  if (!entry.amount || Number(entry.amount) <= 0) return;

  const typeLabel = isIncome ? 'Payment Received' : 'Payment Paid';
  const roleTarget = 'ADMIN,FINANCE_MANAGER';

  await sendAppNotification({
    title: `${typeLabel}: PKR ${Number(entry.amount || 0).toLocaleString()}`,
    description: `${typeLabel} (${entry.party || 'Account'}) • ${entry.category || entry.description || 'Finance'} • Ref: ${entry.reference || entry.id}`,
    details: `Transaction Type: ${typeLabel} (${entry.type})\nAmount: PKR ${Number(entry.amount || 0).toLocaleString()}\nParty / Account: ${entry.party}\nCategory: ${entry.category}\nDate: ${entry.date}\nPayment Method: ${entry.paymentMethod || 'Cash / Bank'}\nDescription: ${entry.description}`,
    targetRole: roleTarget,
    type: 'INFO',
    notificationSubType: 'FINANCE_RECORDED',
    category: 'FINANCE',
    priority: isIncome ? 'MEDIUM' : 'HIGH',
    targetView: 'finance'
  });
}

/**
 * Checks Legal & Show Cause Notices / Hearing Notices and sends Hearing Notice Reminders to Admin.
 * Admin Rule: "Or hearing notice reminder"
 */
export async function checkHearingNoticeReminders(documents: CompanyDocument[], cases: Case[], todayStr: string) {
  const todayTime = new Date(todayStr).getTime();

  for (const doc of documents) {
    const catLower = (doc.category || '').toLowerCase();
    const titleLower = (doc.title || '').toLowerCase();
    const isHearingDoc =
      catLower.includes('hearing') ||
      catLower.includes('show cause') ||
      catLower.includes('legal') ||
      catLower.includes('adjudication') ||
      titleLower.includes('hearing') ||
      titleLower.includes('show cause') ||
      titleLower.includes('notice');

    if (!isHearingDoc) continue;

    const hearingDateStr = (doc as any).hearingDate || doc.expiryDate || doc.issueDate;
    const reminderKey = `audit_hearing_notice_${doc.id}_${hearingDateStr || todayStr}`;
    if (safeAppStorage.getItem(reminderKey)) continue;

    if (hearingDateStr) {
      const hTime = new Date(hearingDateStr).getTime();
      if (!isNaN(hTime)) {
        const diffDays = Math.ceil((hTime - todayTime) / (24 * 60 * 60 * 1000));
        if (diffDays <= 14 && diffDays >= -1) {
          safeAppStorage.setItem(reminderKey, 'true');
          await sendAppNotification({
            title: `Hearing Notice Reminder: ${doc.title}`,
            description: diffDays === 0
              ? `URGENT: Legal / Customs Hearing for "${doc.title}" is scheduled for TODAY (${hearingDateStr}).`
              : diffDays > 0
                ? `Upcoming Hearing Reminder: "${doc.title}" is scheduled in ${diffDays} day(s) on ${hearingDateStr}.`
                : `Hearing Notice Alert: "${doc.title}" scheduled date ${hearingDateStr}.`,
            details: `Hearing / Notice Title: ${doc.title}\nCategory: ${doc.category || 'Hearings & Adjudication'}\nReference No: ${doc.referenceNo || 'N/A'}\nHearing Date: ${hearingDateStr}\nNotes: ${doc.notes || 'Please prepare legal/customs adjudication dossier.'}`,
            targetRole: 'ADMIN',
            type: 'ALERT',
            notificationSubType: 'HEARING_NOTICE_REMINDER',
            category: 'GENERAL',
            priority: 'HIGH',
            actionLabel: 'Open Hearing Notice',
            targetView: 'company_documents'
          });
        }
      }
    }
  }
}

/**
 * Monitors shipments where vehicle gated out of loading port but has not reached destination
 * within 10 days. Sent to Operations Manager only.
 */
export async function checkTenDayTransitDelay(cases: Case[]) {
  const now = Date.now();
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;

  for (const c of cases) {
    if (c.status === 'Completed' || c.status === 'Delivered' || c.status === 'Cancelled' || c.status === 'CANCELLED') continue;

    const wf: Record<string, any> = c.workflowDetails || {};
    const gateOutStep: any = wf['LOADING_PORT_PROCESSING'] || wf['Step 6: Loading Port Processing'] || wf['Loading Port Processing'] || {};
    const gateOutDateStr = gateOutStep?.gateOutDate || gateOutStep?.date || c.registrationDate;

    if (gateOutDateStr) {
      const gateOutTime = new Date(gateOutDateStr).getTime();
      if (!isNaN(gateOutTime) && (now - gateOutTime) > tenDaysMs) {
        const alertKey = `audit_transit_delay_${c.id}_${Math.floor((now - gateOutTime) / (86400000 * 5))}`;
        if (!safeAppStorage.getItem(alertKey)) {
          safeAppStorage.setItem(alertKey, 'true');

          const daysElapsed = Math.floor((now - gateOutTime) / (24 * 60 * 60 * 1000));
          await sendAppNotification({
            title: `Transit Delay Alert (>10 Days): Case ${c.caseNo}`,
            description: `Vehicle gated out ${daysElapsed} days ago but shipment has not reached destination port (${c.pod}).`,
            details: `Consignment: ${c.caseNo}\nClient: ${c.clientName}\nRoute: ${c.pol} → ${c.pod}\nGate Out Date: ${gateOutDateStr}\nDays in Transit: ${daysElapsed} days\nImmediate inspection recommended.`,
            targetRole: 'OPERATIONS_MANAGER',
            type: 'ALERT',
            notificationSubType: 'TRANSIT_DELAY_ALERT',
            category: 'CASE',
            priority: 'HIGH',
            actionLabel: 'View Case Particulars',
            targetView: 'cases',
            targetFilter: { caseId: c.id }
          });
        }
      }
    }
  }
}

/**
 * Audits company documents validity:
 * 1. 10 days before expiry date: notifies Admin.
 * 2. On/after expiry date: notifies Admin that document has expired.
 */
export async function checkCompanyDocumentExpiries(documents: CompanyDocument[], todayStr: string) {
  const todayTime = new Date(todayStr).getTime();

  for (const doc of documents) {
    if (!doc.hasExpiry || !doc.expiryDate) continue;

    const expiryTime = new Date(doc.expiryDate).getTime();
    if (isNaN(expiryTime)) continue;

    const diffMs = expiryTime - todayTime;
    const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

    // Expired
    if (diffDays <= 0) {
      const expiredKey = `audit_doc_expired_${doc.id}_${todayStr}`;
      if (!safeAppStorage.getItem(expiredKey)) {
        safeAppStorage.setItem(expiredKey, 'true');

        await sendAppNotification({
          title: `Document Expired: ${doc.title}`,
          description: `Company document "${doc.title}" expired on ${doc.expiryDate}. Immediate renewal required.`,
          details: `Document: ${doc.title}\nCategory: ${doc.category || 'General'}\nReference: ${doc.referenceNo || 'N/A'}\nExpired On: ${doc.expiryDate}\nAction: Please upload renewed compliance certificate.`,
          targetRole: 'ADMIN',
          type: 'ALERT',
          notificationSubType: 'DOC_EXPIRY_ALERT',
          category: 'GENERAL',
          priority: 'HIGH',
          actionLabel: 'Open Company Documents',
          targetView: 'company_documents'
        });
      }
    } else if (diffDays <= 10) {
      // 10 days before expiry
      const warningKey = `audit_doc_expiring_soon_${doc.id}_${doc.expiryDate}`;
      if (!safeAppStorage.getItem(warningKey)) {
        safeAppStorage.setItem(warningKey, 'true');

        await sendAppNotification({
          title: `Document Expiring Soon (${diffDays} Days): ${doc.title}`,
          description: `Company document "${doc.title}" will expire in ${diffDays} days on ${doc.expiryDate}.`,
          details: `Document: ${doc.title}\nCategory: ${doc.category || 'General'}\nReference: ${doc.referenceNo || 'N/A'}\nExpiry Date: ${doc.expiryDate}\nDays Remaining: ${diffDays} days\nPrepare renewal application.`,
          targetRole: 'ADMIN',
          type: 'INFO',
          notificationSubType: 'DOC_EXPIRY_ALERT',
          category: 'GENERAL',
          priority: 'HIGH',
          actionLabel: 'Open Company Documents',
          targetView: 'company_documents'
        });
      }
    }
  }
}

/**
 * Checks vehicle fleet validity:
 * 1. 10 days before expiry: notifies Vehicle Manager, Admin, and Transporter.
 * 2. On/after expiry date: notifies Admin, Vehicle Manager, and Transporter that vehicle document/registration expired.
 */
export async function checkVehicleFleetExpiries(vehicles: Vehicle[], todayStr: string) {
  const todayTime = new Date(todayStr).getTime();

  for (const v of vehicles) {
    if (v.status === 'CANCELLED') continue;
    const expDateStr = v.validationExpiryDate || v.registrationExpiryDate || (v as any).taxExpiryDate || (v as any).fitnessExpiryDate;
    if (!expDateStr) continue;

    const expiryTime = new Date(expDateStr).getTime();
    if (isNaN(expiryTime)) continue;

    const diffMs = expiryTime - todayTime;
    const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    const transporterTarget = v.transporterName || v.brokerName || v.ownerName || undefined;

    if (diffDays <= 0) {
      const expiredKey = `audit_vehicle_expired_${v.id}_${todayStr}`;
      if (!safeAppStorage.getItem(expiredKey)) {
        safeAppStorage.setItem(expiredKey, 'true');

        await sendAppNotification({
          title: `Vehicle Expired: ${v.registrationNumber}`,
          description: `Fleet unit ${v.registrationNumber} (${v.transporterName || 'Transporter'}) registration/document expired on ${expDateStr}. Immediate renewal required.`,
          details: `Vehicle No: ${v.registrationNumber}\nTransporter: ${v.transporterName || 'Fleet Operator'}\nType: ${v.type || 'Trailer'}\nExpired On: ${expDateStr}\nStatus: Unit cannot be assigned to customs bonded routes until renewed.`,
          targetRole: 'ADMIN,VEHICLE_MANAGER,TRANSPORTER',
          targetClientName: transporterTarget,
          type: 'ALERT',
          notificationSubType: 'DOC_EXPIRY_ALERT',
          category: 'TRANSPORTER',
          priority: 'HIGH',
          actionLabel: 'Renew Fleet Unit',
          targetView: 'vehicles',
          targetFilter: { vehicleId: v.id, vehicleNo: v.registrationNumber }
        });
      }
    } else if (diffDays <= 10) {
      const warningKey = `audit_vehicle_expiring_soon_${v.id}_${expDateStr}`;
      if (!safeAppStorage.getItem(warningKey)) {
        safeAppStorage.setItem(warningKey, 'true');

        await sendAppNotification({
          title: `Vehicle Expire Soon (${diffDays} Days): ${v.registrationNumber}`,
          description: `Fleet unit ${v.registrationNumber} (${v.transporterName || 'Transporter'}) registration/validation will expire in ${diffDays} days on ${expDateStr}.`,
          details: `Vehicle No: ${v.registrationNumber}\nTransporter: ${v.transporterName || 'Fleet Operator'}\nExpiry Date: ${expDateStr}\nDays Remaining: ${diffDays} days\nPlease process customs bonded route renewal.`,
          targetRole: 'ADMIN,VEHICLE_MANAGER,TRANSPORTER',
          targetClientName: transporterTarget,
          type: 'INFO',
          notificationSubType: 'DOC_EXPIRY_ALERT',
          category: 'TRANSPORTER',
          priority: 'MEDIUM',
          actionLabel: 'View Vehicle',
          targetView: 'vehicles',
          targetFilter: { vehicleId: v.id, vehicleNo: v.registrationNumber }
        });
      }
    }
  }
}

/**
 * Identifies fleet vehicles that have not been assigned a consignment or trip
 * for over 30 days (1 month). Sent to Vehicle & Operations Managers.
 */
export async function checkIdleVehicles(vehicles: Vehicle[], cases: Case[]) {
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const latestTripMap = new Map<string, number>();

  for (const c of cases) {
    const reg = (c.assignedVehicleNo || '').trim().toUpperCase();
    if (!reg) continue;

    const tripTime = new Date(c.registrationDate || c.createdAt || 0).getTime();
    if (!isNaN(tripTime)) {
      const prev = latestTripMap.get(reg) || 0;
      if (tripTime > prev) {
        latestTripMap.set(reg, tripTime);
      }
    }
  }

  for (const v of vehicles) {
    if (v.status === 'CANCELLED' || v.status === 'INACTIVE') continue;

    const cleanReg = (v.registrationNumber || '').trim().toUpperCase();
    const lastTripTime = latestTripMap.get(cleanReg) || new Date(v.registrationDate || v.createdAt || 0).getTime();

    if (!isNaN(lastTripTime) && (now - lastTripTime) > thirtyDaysMs) {
      const idleMonthsKey = `audit_idle_vehicle_${v.id}_${Math.floor((now - lastTripTime) / (thirtyDaysMs))}`;
      if (!safeAppStorage.getItem(idleMonthsKey)) {
        safeAppStorage.setItem(idleMonthsKey, 'true');

        const idleDays = Math.floor((now - lastTripTime) / (24 * 60 * 60 * 1000));
        await sendAppNotification({
          title: `Idle Fleet Unit Alert (>30 Days): ${v.registrationNumber}`,
          description: `Vehicle ${v.registrationNumber} (${v.transporterName || 'Transporter'}) has had no trips assigned for ${idleDays} days.`,
          details: `Fleet Unit: ${v.registrationNumber}\nTransporter: ${v.transporterName || 'Operator'}\nType: ${v.type || 'Trailer'}\nDays Without Consignment: ${idleDays} days\nConsider broadcasting availability or reviewing route allocation.`,
          targetRole: 'OPERATIONS_MANAGER,VEHICLE_MANAGER',
          type: 'INFO',
          notificationSubType: 'IDLE_VEHICLE_ALERT',
          category: 'TRANSPORTER',
          priority: 'MEDIUM',
          actionLabel: 'Assign Consignment',
          targetView: 'vehicles',
          targetFilter: { vehicleId: v.id }
        });
      }
    }
  }
}


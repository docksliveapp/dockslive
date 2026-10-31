import { AppNotification, Case, Vehicle, UserRole, FinanceEntry } from '../types';
import { 
  saveNotificationToFirestore, 
  updateNotificationInFirestore,
  updateCaseInFirestore,
  deleteCaseFromFirestore,
  updateVehicleInFirestore,
  deleteVehicleFromFirestore,
  updateFinanceInFirestore,
  updateClientInFirestore,
  saveFinanceToFirestore,
  saveStaffLedgerEntryToFirestore
} from './dbService';
import { safeAppStorage } from './storage';
import { logActivity } from './activityLogService';

export interface ActionApprovalPayload {
  actionType: 'DELETE' | 'CANCEL' | 'EDIT';
  entityType: 'case' | 'vehicle';
  entityId: string | number;
  entityName: string;
  requestedBy: string;
  requestedByRole: string;
  reason: string;
  proposedChanges?: any;
  originalData?: any;
}

/**
 * Helper to check if requester is external (Client or Transporter)
 * External requests MUST go to Operations Manager / Vehicle Manager FIRST (Step 1),
 * and only after Manager approval do they go to Admin (Step 2).
 */
function isExternalRequesterRole(role?: string): boolean {
  if (!role) return false;
  const norm = role.toUpperCase().replace(/[^A-Z]/g, '');
  return norm.includes('CLIENT') || norm.includes('TRANSPORTER');
}

/**
 * Creates and submits an action approval request for Delete, Cancel, or Edit of a Case.
 * - If requested by Client or Transporter: Step 1 -> routed to Operations Manager & Vehicle Manager.
 * - If requested by Operations Manager, Vehicle Manager, or Staff: routed directly to Admin (Step 2).
 */
export async function submitCaseActionApproval(params: {
  actionType: 'DELETE' | 'CANCEL' | 'EDIT';
  caseItem: Case;
  requestedBy: string;
  requestedByRole?: string;
  reason: string;
  proposedChanges?: any;
}): Promise<{ notification: AppNotification; updatedCase: Case }> {
  const notifId = Date.now() + Math.floor(Math.random() * 1000);
  const caseNo = params.caseItem.caseNumber || params.caseItem.caseNo || `Case #${params.caseItem.id}`;
  const actionLabel = params.actionType === 'DELETE' ? 'Deletion' : params.actionType === 'CANCEL' ? 'Cancellation' : 'Modification / Edit';

  const isExternal = isExternalRequesterRole(params.requestedByRole);
  const approvalStage: 'MANAGER_REVIEW' | 'ADMIN_FINAL' = isExternal ? 'MANAGER_REVIEW' : 'ADMIN_FINAL';
  const targetRole = isExternal ? 'OPERATIONS_MANAGER,VEHICLE_MANAGER' : 'ADMIN';

  const approvalData: AppNotification['approvalData'] = {
    entityType: 'case',
    entityId: params.caseItem.id,
    entityName: caseNo,
    actionType: params.actionType,
    approvalStage,
    originalRequester: params.requestedBy,
    originalRequesterRole: params.requestedByRole || 'Staff',
    requestedBy: params.requestedBy,
    requestedByRole: params.requestedByRole || 'Staff',
    reason: params.reason,
    proposedChanges: params.proposedChanges,
    originalData: params.caseItem,
    caseNo
  };

  const notification: AppNotification = {
    id: notifId,
    title: isExternal
      ? `[Step 1/2 Manager Review] Case ${actionLabel} Request: ${caseNo}`
      : `Case ${actionLabel} Request: ${caseNo}`,
    description: isExternal
      ? `${params.requestedBy} (${params.requestedByRole}) requested ${actionLabel.toLowerCase()} for Case ${caseNo}. Step 1: Operation / Vehicle Manager must review & approve before forwarding to Admin. Reason: "${params.reason}"`
      : `${params.requestedBy} (${params.requestedByRole || 'Operations / Vehicle Manager'}) requested Admin approval to ${params.actionType} Case ${caseNo}. Reason: "${params.reason}"`,
    details: `Entity: Case ${caseNo}\nClient: ${params.caseItem.clientName || 'N/A'}\nAction: ${params.actionType} (${actionLabel})\nApproval Stage: ${isExternal ? 'Step 1 (Operations / Vehicle Manager Review)' : 'Final Admin Approval'}\nRequester: ${params.requestedBy} (${params.requestedByRole || 'Staff'})\nReason: ${params.reason}${params.proposedChanges ? '\nProposed Changes: ' + JSON.stringify(params.proposedChanges, null, 2) : ''}`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'ACTION',
    notificationSubType: params.actionType === 'DELETE' 
      ? 'DELETION_APPROVAL' 
      : params.actionType === 'CANCEL' 
        ? 'CANCELLATION_APPROVAL' 
        : 'EDIT_APPROVAL',
    status: 'PENDING',
    actionLabel: isExternal ? `Approve & Forward to Admin` : `Review ${actionLabel}`,
    priority: 'HIGH',
    targetRole,
    category: 'CASE',
    targetView: 'cases',
    targetFilter: { caseId: params.caseItem.id, caseNo },
    approvalData
  };

  const updatedCase: Case = {
    ...params.caseItem,
    pendingApproval: {
      type: params.actionType,
      reason: params.reason,
      requestedBy: params.requestedBy,
      requestedByRole: params.requestedByRole,
      requestedAt: new Date().toISOString(),
      proposedChanges: params.proposedChanges,
      stage: approvalStage
    }
  };

  // Sync local storage immediately
  try {
    const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
    const nextCases = liveCases.map(c => String(c.id) === String(updatedCase.id) ? updatedCase : c);
    safeAppStorage.setJSON('dpl_live_cases', nextCases);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dpl_cases_updated', { detail: nextCases }));
    }
  } catch (_) {}

  await Promise.all([
    saveNotificationToFirestore(notification),
    updateCaseInFirestore(updatedCase)
  ]);

  return { notification, updatedCase };
}

/**
 * Creates and submits an action approval request for Delete, Cancel, or Edit of a Vehicle.
 * - If requested by Transporter or Client: Step 1 -> routed to Vehicle Manager & Operations Manager.
 * - If requested by Vehicle Manager, Operations Manager, or Staff: routed directly to Admin (Step 2).
 */
export async function submitVehicleActionApproval(params: {
  actionType: 'DELETE' | 'CANCEL' | 'EDIT';
  vehicleItem: Vehicle;
  requestedBy: string;
  requestedByRole?: string;
  reason: string;
  proposedChanges?: any;
}): Promise<{ notification: AppNotification; updatedVehicle: Vehicle }> {
  const notifId = Date.now() + Math.floor(Math.random() * 1000);
  const regNo = params.vehicleItem.registrationNumber || `Vehicle #${params.vehicleItem.id}`;
  const actionLabel = params.actionType === 'DELETE' ? 'Deletion' : params.actionType === 'CANCEL' ? 'Cancellation' : 'Modification / Edit';

  const isExternal = isExternalRequesterRole(params.requestedByRole);
  const approvalStage: 'MANAGER_REVIEW' | 'ADMIN_FINAL' = isExternal ? 'MANAGER_REVIEW' : 'ADMIN_FINAL';
  const targetRole = isExternal ? 'VEHICLE_MANAGER,OPERATIONS_MANAGER' : 'ADMIN';

  const approvalData: AppNotification['approvalData'] = {
    entityType: 'vehicle',
    entityId: params.vehicleItem.id,
    entityName: regNo,
    actionType: params.actionType,
    approvalStage,
    originalRequester: params.requestedBy,
    originalRequesterRole: params.requestedByRole || 'Staff',
    requestedBy: params.requestedBy,
    requestedByRole: params.requestedByRole || 'Staff',
    reason: params.reason,
    proposedChanges: params.proposedChanges,
    originalData: params.vehicleItem
  };

  const notification: AppNotification = {
    id: notifId,
    title: isExternal
      ? `[Step 1/2 Manager Review] Vehicle ${actionLabel} Request: ${regNo}`
      : `Vehicle ${actionLabel} Request: ${regNo}`,
    description: isExternal
      ? `${params.requestedBy} (${params.requestedByRole}) requested ${actionLabel.toLowerCase()} for Vehicle ${regNo}. Step 1: Vehicle / Operation Manager must review & approve before forwarding to Admin. Reason: "${params.reason}"`
      : `${params.requestedBy} (${params.requestedByRole || 'Vehicle / Operations Manager'}) requested Admin approval to ${params.actionType} Vehicle ${regNo}. Reason: "${params.reason}"`,
    details: `Entity: Vehicle ${regNo}\nTransporter: ${params.vehicleItem.transporterName || 'N/A'}\nAction: ${params.actionType} (${actionLabel})\nApproval Stage: ${isExternal ? 'Step 1 (Vehicle / Operations Manager Review)' : 'Final Admin Approval'}\nRequester: ${params.requestedBy} (${params.requestedByRole || 'Staff'})\nReason: ${params.reason}${params.proposedChanges ? '\nProposed Changes: ' + JSON.stringify(params.proposedChanges, null, 2) : ''}`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'ACTION',
    notificationSubType: params.actionType === 'DELETE' 
      ? 'DELETION_APPROVAL' 
      : params.actionType === 'CANCEL' 
        ? 'CANCELLATION_APPROVAL' 
        : 'EDIT_APPROVAL',
    status: 'PENDING',
    actionLabel: isExternal ? `Approve & Forward to Admin` : `Review ${actionLabel}`,
    priority: 'HIGH',
    targetRole,
    category: 'TRANSPORTER',
    targetView: 'vehicles',
    targetFilter: { vehicleId: params.vehicleItem.id, vehicleNo: regNo },
    approvalData
  };

  const updatedVehicle: Vehicle = {
    ...params.vehicleItem,
    pendingApproval: {
      type: params.actionType,
      reason: params.reason,
      requestedBy: params.requestedBy,
      requestedByRole: params.requestedByRole,
      requestedAt: new Date().toISOString(),
      proposedChanges: params.proposedChanges,
      stage: approvalStage
    }
  };

  // Sync local storage immediately
  try {
    const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
    const nextVehicles = liveVehicles.map(v => Number(v.id) === Number(updatedVehicle.id) ? updatedVehicle : v);
    safeAppStorage.setJSON('dpl_live_vehicles', nextVehicles);
  } catch (_) {}

  await Promise.all([
    saveNotificationToFirestore(notification),
    updateVehicleInFirestore(updatedVehicle)
  ]);

  return { notification, updatedVehicle };
}

/**
 * Finance Manager sends an Urgent Payable Expense Payment Request to Admin
 * (after verifying cash is available in hand or bank).
 */
export async function submitUrgentPayableRequest(params: {
  payableEntry: FinanceEntry;
  requestedBy: string;
  paymentSource: 'CASH' | 'BANK';
  bankName?: string;
  availableBalance: number;
  notes?: string;
}): Promise<AppNotification> {
  const notifId = Date.now() + Math.floor(Math.random() * 1000);
  const { payableEntry, requestedBy, paymentSource, bankName, availableBalance, notes } = params;
  const sourceLabel = paymentSource === 'BANK' ? `Bank (${bankName || 'Corporate Bank'})` : 'Cash in Hand (Drawer)';

  const notification: AppNotification = {
    id: notifId,
    title: `Urgent Payable Payment Request: PKR ${Number(payableEntry.amount || 0).toLocaleString()}`,
    description: `Finance Manager (${requestedBy}) requested urgent payment approval for "${payableEntry.description}" to ${payableEntry.party}. Verified Funds Available in ${sourceLabel}: PKR ${Number(availableBalance || 0).toLocaleString()}.`,
    details: `Payee / Vendor: ${payableEntry.party}\nExpense Description: ${payableEntry.description}\nCategory: ${payableEntry.category || 'Payable Expense'}\nReference: ${payableEntry.reference || `PAY-${payableEntry.id}`}\nUrgent Amount: PKR ${Number(payableEntry.amount || 0).toLocaleString()}\nSelected Payment Source: ${sourceLabel}\nVerified Available Balance: PKR ${Number(availableBalance || 0).toLocaleString()}${notes ? '\nFinance Manager Notes: ' + notes : ''}`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'ACTION',
    notificationSubType: 'URGENT_PAYABLE_APPROVAL',
    status: 'PENDING',
    actionLabel: 'Approve Urgent Payment',
    priority: 'HIGH',
    targetRole: 'ADMIN',
    category: 'FINANCE',
    targetView: 'finance',
    approvalData: {
      entityType: 'finance',
      entityId: payableEntry.id,
      entityName: `${payableEntry.party} - ${payableEntry.description}`,
      actionType: 'APPROVE_URGENT_PAYABLE',
      approvalStage: 'ADMIN_FINAL',
      requestedBy,
      requestedByRole: 'FINANCE_MANAGER',
      reason: notes || `Urgent vendor/expense payable settlement. Funds verified available in ${sourceLabel}.`,
      amount: Number(payableEntry.amount || 0),
      paymentSource,
      bankName: paymentSource === 'BANK' ? (bankName || 'HBL Corporate') : 'Cash in Hand',
      originalData: payableEntry
    }
  };

  await saveNotificationToFirestore(notification);
  return notification;
}

/**
 * Executes approval for a pending request (Step 1 Manager Review OR Step 2 Admin Final OR Finance Verification)
 */
export async function approveActionRequest(notification: AppNotification): Promise<void> {
  if (!notification.approvalData) {
    await updateNotificationInFirestore({ ...notification, status: 'RESOLVED' });
    return;
  }

  const { 
    entityType, 
    entityId, 
    actionType, 
    proposedChanges, 
    approvalStage,
    originalRequester,
    originalRequesterRole,
    requestedBy,
    requestedByRole,
    reason,
    entityName
  } = notification.approvalData;

  // =========================================================================
  // STEP 1 OF 2: OPERATIONS MANAGER / VEHICLE MANAGER APPROVES CLIENT/TRANSPORTER REQUEST
  // Forwards request to ADMIN Notification Center for Step 2 (Final Approval)
  // =========================================================================
  if ((entityType === 'case' || entityType === 'vehicle') && approvalStage === 'MANAGER_REVIEW') {
    const actionLabel = actionType === 'DELETE' ? 'Deletion' : actionType === 'CANCEL' ? 'Cancellation' : 'Modification / Edit';
    const managerRoleLabel = entityType === 'case' ? 'Operations Manager' : 'Vehicle Manager';
    const origSender = originalRequester || requestedBy || (entityType === 'case' ? 'Client' : 'Transporter');
    const origRole = originalRequesterRole || requestedByRole || (entityType === 'case' ? 'CLIENT' : 'TRANSPORTER');

    if (entityType === 'case') {
      const updatedPending = {
        type: actionType as 'DELETE' | 'CANCEL' | 'EDIT',
        reason: reason || '',
        requestedBy: origSender,
        requestedByRole: origRole,
        requestedAt: new Date().toISOString(),
        proposedChanges,
        stage: 'ADMIN_FINAL' as const
      };
      await updateCaseInFirestore({
        id: String(entityId),
        pendingApproval: updatedPending
      } as any);

      try {
        const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
        const nextCases = liveCases.map(c => String(c.id) === String(entityId) ? { ...c, pendingApproval: updatedPending } : c);
        safeAppStorage.setJSON('dpl_live_cases', nextCases);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('dpl_cases_updated', { detail: nextCases }));
        }
      } catch (_) {}
    } else {
      const updatedPending = {
        type: actionType as 'DELETE' | 'CANCEL' | 'EDIT',
        reason: reason || '',
        requestedBy: origSender,
        requestedByRole: origRole,
        requestedAt: new Date().toISOString(),
        proposedChanges,
        stage: 'ADMIN_FINAL' as const
      };
      await updateVehicleInFirestore({
        id: Number(entityId),
        pendingApproval: updatedPending
      } as any);

      try {
        const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
        const nextVehicles = liveVehicles.map(v => Number(v.id) === Number(entityId) ? { ...v, pendingApproval: updatedPending } : v);
        safeAppStorage.setJSON('dpl_live_vehicles', nextVehicles);
      } catch (_) {}
    }

    // Create Step 2 Notification for ADMIN
    const adminNotif: AppNotification = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      title: `[Step 2/2 Final Approval] ${entityType === 'case' ? 'Case' : 'Vehicle'} ${actionLabel}: ${entityName || entityId}`,
      description: `1st Approval Granted by ${managerRoleLabel} for ${origSender} (${origRole})'s ${actionLabel.toLowerCase()} request on ${entityName || entityId}. Admin final approval required to execute. Reason: "${reason || 'Operational request'}"`,
      details: `Entity: ${entityType.toUpperCase()} ${entityName || entityId}\nAction: ${actionType} (${actionLabel})\nOriginal Requester: ${origSender} (${origRole})\n1st Approval: Verified & Approved by ${managerRoleLabel}\n2nd Approval: Awaiting Administrator Final Decision\nReason: ${reason || 'N/A'}${proposedChanges ? '\nProposed Changes: ' + JSON.stringify(proposedChanges, null, 2) : ''}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'ACTION',
      notificationSubType: actionType === 'DELETE'
        ? 'DELETION_APPROVAL'
        : actionType === 'CANCEL'
          ? 'CANCELLATION_APPROVAL'
          : 'EDIT_APPROVAL',
      status: 'PENDING',
      actionLabel: `Final Approve ${actionLabel}`,
      priority: 'HIGH',
      targetRole: 'ADMIN',
      category: entityType === 'case' ? 'CASE' : 'TRANSPORTER',
      targetView: entityType === 'case' ? 'cases' : 'vehicles',
      targetFilter: entityType === 'case' ? { caseId: entityId, caseNo: entityName } : { vehicleId: entityId, vehicleNo: entityName },
      approvalData: {
        ...notification.approvalData,
        approvalStage: 'ADMIN_FINAL',
        originalRequester: origSender,
        originalRequesterRole: origRole,
        requestedBy: `${managerRoleLabel} (on behalf of ${origSender})`,
        requestedByRole: entityType === 'case' ? 'OPERATIONS_MANAGER' : 'VEHICLE_MANAGER'
      }
    };

    await saveNotificationToFirestore(adminNotif);
    await updateNotificationInFirestore({ ...notification, status: 'RESOLVED' });
    return;
  }

  // =========================================================================
  // STEP 2 OF 2 (OR DIRECT MANAGER -> ADMIN): ADMIN FINAL APPROVAL FOR CASE / VEHICLE
  // =========================================================================
  if (entityType === 'case') {
    const caseNoLabel = entityName || `Case #${entityId}`;
    if (actionType === 'DELETE') {
      await deleteCaseFromFirestore(String(entityId));
      try {
        const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
        const nextCases = liveCases.filter(c => String(c.id) !== String(entityId));
        safeAppStorage.setJSON('dpl_live_cases', nextCases);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dpl_cases_updated', { detail: nextCases }));
      } catch (_) {}
    } else if (actionType === 'CANCEL') {
      const casePayload = {
        id: String(entityId),
        status: 'CANCELLED',
        pendingApproval: null
      } as any;
      await updateCaseInFirestore(casePayload);
      try {
        const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
        const nextCases = liveCases.map(c => String(c.id) === String(entityId) ? { ...c, status: 'CANCELLED', pendingApproval: undefined } : c);
        safeAppStorage.setJSON('dpl_live_cases', nextCases);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dpl_cases_updated', { detail: nextCases }));
      } catch (_) {}
    } else if (actionType === 'EDIT') {
      const casePayload = {
        ...(proposedChanges || {}),
        id: String(entityId),
        pendingApproval: null
      } as any;
      await updateCaseInFirestore(casePayload);
      try {
        const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
        const nextCases = liveCases.map(c => String(c.id) === String(entityId) ? { ...c, ...(proposedChanges || {}), pendingApproval: undefined } : c);
        safeAppStorage.setJSON('dpl_live_cases', nextCases);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dpl_cases_updated', { detail: nextCases }));
      } catch (_) {}
    }

    // Notify Operations Manager, Vehicle Manager & Client/Transporter of Admin's approval
    const actionLabel = actionType === 'CANCEL' ? 'Cancelled' : actionType === 'EDIT' ? 'Modified / Edited' : 'Deleted';
    await saveNotificationToFirestore({
      id: Date.now() + 25,
      title: `Case ${actionLabel} by Admin: ${caseNoLabel}`,
      description: `Administrator approved the ${actionType.toLowerCase()} request for ${caseNoLabel}. Case status is now updated.`,
      details: `Case: ${caseNoLabel}\nAction Executed: ${actionLabel}\nApproved By: Administrator`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'INFO',
      notificationSubType: 'GENERAL',
      status: 'PENDING',
      targetRole: 'OPERATIONS_MANAGER,VEHICLE_MANAGER,CLIENT,TRANSPORTER',
      targetClientName: originalRequester || requestedBy,
      category: 'CASE',
      targetView: 'cases'
    });
  } else if (entityType === 'vehicle') {
    const vehNoLabel = entityName || `Vehicle #${entityId}`;
    if (actionType === 'DELETE') {
      await deleteVehicleFromFirestore(Number(entityId));
      try {
        const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
        safeAppStorage.setJSON('dpl_live_vehicles', liveVehicles.filter(v => Number(v.id) !== Number(entityId)));
      } catch (_) {}
    } else if (actionType === 'CANCEL') {
      const vehiclePayload = {
        id: Number(entityId),
        status: 'CANCELLED',
        cancellationApproved: true,
        cancellationDate: new Date().toISOString().split('T')[0],
        pendingApproval: null
      } as any;
      await updateVehicleInFirestore(vehiclePayload);
      try {
        const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
        const nextVehicles = liveVehicles.map(v => Number(v.id) === Number(entityId) ? {
          ...v,
          status: 'CANCELLED' as const,
          cancellationApproved: true,
          cancellationDate: new Date().toISOString().split('T')[0],
          pendingApproval: undefined
        } : v);
        safeAppStorage.setJSON('dpl_live_vehicles', nextVehicles);
      } catch (_) {}
    } else if (actionType === 'EDIT') {
      const vehiclePayload = {
        ...(proposedChanges || {}),
        id: Number(entityId),
        pendingApproval: null
      } as any;
      await updateVehicleInFirestore(vehiclePayload);
      try {
        const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
        const nextVehicles = liveVehicles.map(v => Number(v.id) === Number(entityId) ? {
          ...v,
          ...(proposedChanges || {}),
          pendingApproval: undefined
        } : v);
        safeAppStorage.setJSON('dpl_live_vehicles', nextVehicles);
      } catch (_) {}
    }

    // Notify Vehicle Manager, Operations Manager & Transporter of Admin's approval
    const actionLabel = actionType === 'CANCEL' ? 'Cancelled' : actionType === 'EDIT' ? 'Modified / Edited' : 'Deleted';
    await saveNotificationToFirestore({
      id: Date.now() + 26,
      title: `Vehicle ${actionLabel} by Admin: ${vehNoLabel}`,
      description: `Administrator approved the ${actionType.toLowerCase()} request for Vehicle ${vehNoLabel}. Status is now ${actionType === 'CANCEL' ? 'CANCELLED' : 'updated'}.`,
      details: `Vehicle: ${vehNoLabel}\nAction Executed: ${actionLabel}\nApproved By: Administrator`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'INFO',
      notificationSubType: 'GENERAL',
      status: 'PENDING',
      targetRole: 'VEHICLE_MANAGER,OPERATIONS_MANAGER,TRANSPORTER',
      targetClientName: originalRequester || requestedBy,
      category: 'TRANSPORTER',
      targetView: 'vehicles'
    });
  } else if (actionType === 'APPROVE_URGENT_PAYABLE') {
    // =========================================================================
    // ADMIN APPROVES URGENT PAYABLE EXPENSE PAYMENT REQUEST FROM FINANCE MANAGER
    // =========================================================================
    const numId = Number(entityId);
    const amount = Number(notification.approvalData.amount || 0);
    const paymentSource = notification.approvalData.paymentSource || 'CASH';
    const bankName = notification.approvalData.bankName || (paymentSource === 'BANK' ? 'HBL Corporate' : 'Drawer Cash');
    const origPayable: Partial<FinanceEntry> = notification.approvalData.originalData || {};
    const partyName = origPayable.party || entityName || 'Vendor';
    const descText = origPayable.description || 'Urgent Payable Expense';
    const todayStr = new Date().toISOString().split('T')[0];

    try {
      // 1. Update Payable status to PAID (and approved by Admin)
      const updatedPayable: Partial<FinanceEntry> = {
        ...origPayable,
        id: numId,
        status: 'PAID',
        paidAmount: amount,
        remainingAmount: 0,
        paymentMethod: paymentSource,
        bankName
      };
      await updateFinanceInFirestore(updatedPayable as FinanceEntry);

      // 2. Record EXPENSE in Cashbook so Cash/Bank balance reflects the paid urgent payable
      const expenseEntry: FinanceEntry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        date: todayStr,
        description: `Urgent Payable Paid (Admin Approved): ${descText}`,
        party: partyName,
        amount,
        type: 'EXPENSE',
        status: 'PAID',
        category: origPayable.category || 'Urgent Payable Expense',
        reference: origPayable.reference || `URG-PAY-${numId}`,
        paymentMethod: paymentSource,
        bankName
      };
      await saveFinanceToFirestore(expenseEntry);

      // 3. Sync safeAppStorage
      const livePay = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);
      const liveFin = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []);
      safeAppStorage.setJSON('dpl_live_payables', livePay.map(f => Number(f.id) === numId ? { ...f, ...updatedPayable } as FinanceEntry : f));
      safeAppStorage.setJSON('dpl_live_finance', [expenseEntry, ...liveFin]);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dpl_finance_updated'));
      }

      // 4. Send Confirmation Notification back to FINANCE MANAGER Notification Center
      await saveNotificationToFirestore({
        id: Date.now() + 30,
        title: `Urgent Payable APPROVED by Admin: PKR ${amount.toLocaleString()}`,
        description: `Administrator approved your urgent payment request for "${descText}" (${partyName}) via ${paymentSource === 'BANK' ? bankName : 'Cash in Hand'}. Payment has been confirmed and posted to Cashbook.`,
        details: `Payee: ${partyName}\nDescription: ${descText}\nAmount: PKR ${amount.toLocaleString()}\nSource: ${paymentSource === 'BANK' ? bankName : 'Cash in Hand'}\nDecision: APPROVED BY ADMIN`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'INFO',
        notificationSubType: 'FINANCE_RECORDED',
        status: 'PENDING',
        actionLabel: 'View in Payables / Cashbook',
        priority: 'HIGH',
        targetRole: 'FINANCE_MANAGER',
        category: 'FINANCE',
        targetView: 'finance'
      });

      logActivity(
        `Urgent Payable Approved by Admin: PKR ${amount.toLocaleString()}`,
        `Admin approved Finance Manager's urgent payment request for ${partyName} (${descText}).`,
        'ADMIN',
        'Administrator'
      );
    } catch (err) {
      console.warn('Could not process urgent payable approval:', err);
    }
  } else if (actionType === 'CONFIRM_TRANSPORTER_PAYMENT' || notification.notificationSubType === 'TRANSPORTER_PAYMENT_CONFIRMATION') {
    // =========================================================================
    // TRANSPORTER CONFIRMS PAYMENT RECEIVED FROM CLIENT OR COMPANY
    // =========================================================================
    const numId = Number(entityId);
    const amount = Number(notification.approvalData.amount || 0);
    const transporterName = notification.approvalData.entityName || notification.targetClientName || 'Transporter';
    const payerSource = notification.approvalData.requestedBy || 'Company / Client';

    try {
      await updateFinanceInFirestore({
        id: numId,
        status: 'PAID',
        transporterConfirmed: true,
        transporterConfirmedAt: new Date().toISOString(),
        remarks: `Payment receipt confirmed by Transporter (${transporterName}) on ${new Date().toLocaleDateString()}`
      } as any);

      const liveFin = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []);
      const livePay = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);
      safeAppStorage.setJSON('dpl_live_finance', liveFin.map(f => Number(f.id) === numId ? { ...f, status: 'PAID' as const, transporterConfirmed: true } as any : f));
      safeAppStorage.setJSON('dpl_live_payables', livePay.map(f => Number(f.id) === numId ? { ...f, status: 'PAID' as const, transporterConfirmed: true } as any : f));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dpl_finance_updated'));
      }

      await saveNotificationToFirestore({
        id: Date.now() + 36,
        title: `Payment Received Confirmed by Transporter: PKR ${amount.toLocaleString()}`,
        description: `Transporter "${transporterName}" confirmed receipt of payment PKR ${amount.toLocaleString()} from ${payerSource}.`,
        details: `Transporter: ${transporterName}\nPaid By: ${payerSource}\nAmount Confirmed: PKR ${amount.toLocaleString()}\nStatus: Confirmed & Settled`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'INFO',
        notificationSubType: 'FINANCE_RECORDED',
        status: 'PENDING',
        actionLabel: 'View Finance Ledger',
        priority: 'MEDIUM',
        targetRole: 'FINANCE_MANAGER,ADMIN',
        targetClientName: transporterName,
        category: 'FINANCE',
        targetView: 'finance'
      });

      logActivity(
        `Transporter Confirmed Payment Receipt: PKR ${amount.toLocaleString()}`,
        `Transporter "${transporterName}" confirmed receiving PKR ${amount.toLocaleString()} from ${payerSource}.`,
        'TRANSPORTER',
        transporterName
      );
    } catch (err) {
      console.warn('Could not confirm transporter payment:', err);
    }
  } else if (entityType === 'finance' || actionType === 'VERIFY_PAYMENT') {
    // =========================================================================
    // FINANCE MANAGER VERIFIES & CONFIRMS CLIENT PAYMENT
    // Completes notification and adds payment to Received Payments, Client Ledger & Cashbook
    // =========================================================================
    const numId = Number(entityId);
    const amount = Number(notification.approvalData.amount || 0);
    const clientParty = notification.approvalData.requestedBy || notification.approvalData.entityName || 'Client';
    const bankName = notification.approvalData.bankName || 'Meezan Bank';
    const caseNo = notification.approvalData.caseNo || '';
    const slipUrl = notification.approvalData.slipUrl;
    const todayStr = new Date().toISOString().split('T')[0];

    try {
      const confirmedEntry: FinanceEntry = {
        id: numId,
        date: todayStr,
        type: 'INCOME',
        status: 'PAID',
        party: clientParty,
        amount,
        category: 'Client Payment',
        description: `Verified Payment Received from ${clientParty}${caseNo ? ` (Case ${caseNo})` : ''}`,
        paymentMethod: bankName.toLowerCase().includes('cash') ? 'CASH' : 'BANK',
        bankName,
        reference: `REC-${numId.toString().slice(-6)}`,
        caseNo,
        slipUrl
      };

      await updateFinanceInFirestore({
        ...confirmedEntry,
        status: 'PAID',
        remarks: `Payment receipt verified & confirmed by Finance Manager on ${new Date().toLocaleDateString()}`
      } as any);

      // Synchronize safeAppStorage so Received Payments, Client Ledger, and Cashbook update immediately
      const liveFin = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []);
      const existsInFin = liveFin.some(f => Number(f.id) === numId);
      const updatedFin = existsInFin
        ? liveFin.map(f => Number(f.id) === numId ? { ...f, status: 'PAID' as const, type: 'INCOME' as const } : f)
        : [confirmedEntry, ...liveFin];
      safeAppStorage.setJSON('dpl_live_finance', updatedFin);

      const livePay = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);
      const liveRec = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_receivables', []);
      safeAppStorage.setJSON('dpl_live_payables', livePay.map(f => Number(f.id) === numId ? { ...f, status: 'PAID' as const } : f));
      safeAppStorage.setJSON('dpl_live_receivables', liveRec.map(f => Number(f.id) === numId ? { ...f, status: 'PAID' as const } : f));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dpl_finance_updated'));
      }

      // Notify Admin of Payment Received (Admin Rule: Any payment paid and received notification)
      await saveNotificationToFirestore({
        id: Date.now() + 35,
        title: `Payment Received & Verified: PKR ${amount.toLocaleString()}`,
        description: `Finance Manager verified and confirmed payment of PKR ${amount.toLocaleString()} from "${clientParty}". Credited to Received Payments, Client Ledger & Cashbook.`,
        details: `Client: ${clientParty}\nAmount Received: PKR ${amount.toLocaleString()}\nBank / Mode: ${bankName}${caseNo ? `\nCase No: ${caseNo}` : ''}\nStatus: Verified & Posted to Cashbook & Client Ledger`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'INFO',
        notificationSubType: 'FINANCE_RECORDED',
        status: 'PENDING',
        actionLabel: 'View Cashbook',
        priority: 'MEDIUM',
        targetRole: 'ADMIN',
        targetClientName: clientParty,
        category: 'FINANCE',
        targetView: 'finance'
      });

      logActivity(
        `Payment Receipt Verified & Approved: PKR ${amount.toLocaleString()}`,
        `Payment receipt from "${clientParty}" was verified and confirmed by Finance Manager. Added to Received Payments, Client Ledger, and Cashbook.`,
        'FINANCE_MANAGER',
        'Finance Desk',
        { entityId: numId, amount }
      );
    } catch (err) {
      console.warn("Could not verify finance entry:", err);
    }
  } else if (entityType === 'client' || actionType === 'APPROVE_CLIENT') {
    try {
      await updateClientInFirestore({
        id: String(entityId),
        loginEnabled: true,
        status: 'ACTIVE'
      } as any);

      logActivity(
        `Client Registration Approved: ${notification.approvalData.entityName || entityId}`,
        `New client registration request approved. Portal login and tariff access activated.`,
        'ADMIN',
        'System Admin'
      );
    } catch (err) {
      console.warn("Could not approve client registration:", err);
    }
  } else if (actionType === 'COLLECT_SALARY') {
    const numId = Number(entityId);
    const amount = Number(notification.approvalData.amount || 0);
    const staffName = notification.approvalData.requestedBy || 'Staff Member';
    const staffUserId = (notification.approvalData as any).staffUserId || '';

    try {
      await updateFinanceInFirestore({
        id: numId,
        status: 'PAID',
        salaryStatus: 'COLLECTED',
        remarks: `Salary collected and acknowledged by ${staffName} on ${new Date().toLocaleDateString()}`
      } as any);

      const expenseEntry: FinanceEntry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        date: new Date().toISOString().split('T')[0],
        description: `Disbursement: Monthly Salary paid to ${staffName}`,
        amount,
        type: 'EXPENSE',
        status: 'PAID',
        party: staffName,
        category: 'Staff Payroll & Salaries',
        paymentMethod: 'BANK',
        bankName: 'HBL Corporate Payroll',
        reference: `SAL-COLLECTED-${numId}`
      };
      await saveFinanceToFirestore(expenseEntry);

      await saveStaffLedgerEntryToFirestore({
        id: `sal_leg_${Date.now()}`,
        staffId: staffUserId || numId,
        staffName,
        type: 'SALARY',
        date: new Date().toISOString().split('T')[0],
        description: `Salary Received & Acknowledged via Bank / Cash`,
        category: 'Salary Disbursement',
        debit: amount,
        credit: 0,
        balance: 0,
        notes: `Acknowledged via System Action Center`
      });

      logActivity(
        `Staff Salary Collected: PKR ${amount.toLocaleString()}`,
        `Staff member "${staffName}" confirmed receipt of monthly salary. Expense recorded and ledger updated.`,
        'FINANCE_MANAGER',
        staffName
      );
    } catch (err) {
      console.warn("Could not process salary collection:", err);
    }
  } else if (actionType === 'APPROVE_NOC') {
    const numId = Number(entityId);
    const vehicleNo = notification.approvalData.entityName || `Vehicle #${numId}`;
    const transporter = notification.approvalData.requestedBy || 'Transporter';

    try {
      await updateVehicleInFirestore({
        id: numId,
        status: 'CANCELLED',
        cancellationApproved: true,
        cancellationDate: new Date().toISOString().split('T')[0],
        pendingApproval: null
      } as any);

      const nocFee = 6000;
      const payableEntry: FinanceEntry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        date: new Date().toISOString().split('T')[0],
        description: `Vehicle De-Registration NOC Processing Fee for ${vehicleNo}`,
        amount: nocFee,
        type: 'PAYABLE',
        status: 'APPROVED',
        party: transporter,
        category: 'Vehicle NOC & De-Registration Fees',
        reference: `NOC-FEE-${numId}`
      };
      await saveFinanceToFirestore(payableEntry);

      await saveNotificationToFirestore({
        id: Date.now() + 10,
        title: `Vehicle NOC Approved: ${vehicleNo}`,
        description: `Your de-registration NOC request for vehicle ${vehicleNo} has been approved by Administrator. NOC certificate is now generated.`,
        details: `Fleet Unit: ${vehicleNo}\nTransporter: ${transporter}\nStatus: Officially De-Registered / NOC Granted\nNOC Standard Fee (PKR 6,000) posted to account ledger.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'INFO',
        notificationSubType: 'GENERAL',
        status: 'RESOLVED',
        targetClientName: transporter,
        targetRole: 'TRANSPORTER',
        category: 'TRANSPORTER',
        priority: 'HIGH'
      });

      logActivity(
        `Vehicle NOC Approved: ${vehicleNo}`,
        `Administrator approved cancellation NOC for ${vehicleNo} (${transporter}). Vehicle cancelled in customs fleet.`,
        'ADMIN',
        'Administrator'
      );
    } catch (err) {
      console.warn("Could not execute NOC approval:", err);
    }
  } else if (actionType === 'CONFIRM_TRANSPORTER_PAYMENT') {
    const numId = Number(entityId);
    const amount = Number(notification.approvalData.amount || 0);
    const transporterName = notification.targetClientName || notification.approvalData.requestedBy || 'Transporter';
    try {
      await updateFinanceInFirestore({
        id: numId,
        status: 'PAID',
        remarks: `Transporter "${transporterName}" confirmed receipt of PKR ${amount.toLocaleString()} on ${new Date().toLocaleDateString()}`
      } as any);
      logActivity(
        `Transporter Payment Confirmed: PKR ${amount.toLocaleString()}`,
        `Transporter "${transporterName}" confirmed receipt of freight payment PKR ${amount.toLocaleString()}.`,
        'TRANSPORTER',
        transporterName,
        { entityId: numId, amount }
      );
    } catch (err) {
      console.warn("Could not confirm transporter payment:", err);
    }
  } else if (actionType === 'APPROVE_TRANSPORTER') {
    const transporterName = notification.approvalData.entityName || String(entityId);
    logActivity(
      `Transporter Registration Approved: ${transporterName}`,
      `Transporter account "${transporterName}" approved by Administrator.`,
      'ADMIN',
      'System Admin'
    );
  }

  await updateNotificationInFirestore({ ...notification, status: 'RESOLVED' });
}

/**
 * Rejects a pending request, dismissing changes and unlocking the entity
 */
export async function rejectActionRequest(notification: AppNotification, rejectReason?: string): Promise<void> {
  if (!notification.approvalData) {
    await updateNotificationInFirestore({ ...notification, status: 'REJECTED' });
    return;
  }

  const { entityType, entityId, actionType, entityName, originalRequester, requestedBy, approvalStage } = notification.approvalData;
  const rejectedByWho = approvalStage === 'MANAGER_REVIEW'
    ? (entityType === 'case' ? 'Operations Manager' : 'Vehicle Manager')
    : 'Administrator';

  if (entityType === 'case') {
    await updateCaseInFirestore({
      id: String(entityId),
      pendingApproval: null
    } as any);
    try {
      const liveCases = safeAppStorage.getJSON<Case[]>('dpl_live_cases', []);
      const nextCases = liveCases.map(c => String(c.id) === String(entityId) ? { ...c, pendingApproval: undefined } : c);
      safeAppStorage.setJSON('dpl_live_cases', nextCases);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dpl_cases_updated', { detail: nextCases }));
    } catch (_) {}

    await saveNotificationToFirestore({
      id: Date.now() + 40,
      title: `Case ${actionType === 'CANCEL' ? 'Cancellation' : 'Modification'} Rejected: ${entityName || entityId}`,
      description: `The request to ${actionType.toLowerCase()} Case ${entityName || entityId} was rejected by ${rejectedByWho}. Case status remains unchanged.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'ALERT',
      notificationSubType: 'GENERAL',
      status: 'PENDING',
      targetRole: 'OPERATIONS_MANAGER,VEHICLE_MANAGER,CLIENT,TRANSPORTER',
      targetClientName: originalRequester || requestedBy,
      category: 'CASE',
      targetView: 'cases'
    });
  } else if (entityType === 'vehicle') {
    await updateVehicleInFirestore({
      id: Number(entityId),
      pendingApproval: null
    } as any);
    try {
      const liveVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
      const nextVehicles = liveVehicles.map(v => Number(v.id) === Number(entityId) ? { ...v, pendingApproval: undefined } : v);
      safeAppStorage.setJSON('dpl_live_vehicles', nextVehicles);
    } catch (_) {}

    await saveNotificationToFirestore({
      id: Date.now() + 41,
      title: `Vehicle ${actionType === 'CANCEL' ? 'Cancellation' : 'Modification'} Rejected: ${entityName || entityId}`,
      description: `The request to ${actionType.toLowerCase()} Vehicle ${entityName || entityId} was rejected by ${rejectedByWho}. Vehicle status remains unchanged.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'ALERT',
      notificationSubType: 'GENERAL',
      status: 'PENDING',
      targetRole: 'VEHICLE_MANAGER,OPERATIONS_MANAGER,TRANSPORTER',
      targetClientName: originalRequester || requestedBy,
      category: 'TRANSPORTER',
      targetView: 'vehicles'
    });
  } else if (actionType === 'APPROVE_URGENT_PAYABLE') {
    const numId = Number(entityId);
    const amount = Number(notification.approvalData.amount || 0);
    const origPayable: Partial<FinanceEntry> = notification.approvalData.originalData || {};
    const partyName = origPayable.party || entityName || 'Vendor';
    const descText = origPayable.description || 'Urgent Payable Expense';

    try {
      await updateFinanceInFirestore({
        id: numId,
        status: 'PENDING',
        remarks: `Urgent payment request declined by Admin${rejectReason ? ': ' + rejectReason : ''}`
      } as any);

      const livePay = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_payables', []);
      safeAppStorage.setJSON('dpl_live_payables', livePay.map(f => Number(f.id) === numId ? { ...f, status: 'PENDING' as const } : f));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dpl_finance_updated'));
      }

      // Send Rejection Confirmation Notification back to FINANCE MANAGER
      await saveNotificationToFirestore({
        id: Date.now() + 45,
        title: `Urgent Payable REJECTED by Admin: PKR ${amount.toLocaleString()}`,
        description: `Administrator rejected your urgent payment request for "${descText}" (${partyName}).${rejectReason ? ' Reason: ' + rejectReason : ''}`,
        details: `Payee: ${partyName}\nDescription: ${descText}\nAmount: PKR ${amount.toLocaleString()}\nDecision: REJECTED BY ADMIN`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'ALERT',
        notificationSubType: 'GENERAL',
        status: 'PENDING',
        actionLabel: 'View Payables',
        priority: 'HIGH',
        targetRole: 'FINANCE_MANAGER',
        category: 'FINANCE',
        targetView: 'finance'
      });
    } catch (err) {
      console.warn('Could not reject urgent payable:', err);
    }
  } else if (entityType === 'finance' || actionType === 'VERIFY_PAYMENT') {
    const numId = Number(entityId);
    try {
      await updateFinanceInFirestore({
        id: numId,
        status: 'CANCELLED',
        remarks: `Payment deposit declined by Finance Manager: ${rejectReason || 'Funds not verified with bank'}`
      } as any);

      const liveFin = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []);
      safeAppStorage.setJSON('dpl_live_finance', liveFin.map(f => Number(f.id) === numId ? { ...f, status: 'CANCELLED' as any } : f));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dpl_finance_updated'));
      }

      logActivity(
        `Payment Deposit Declined: PKR ${Number(notification.approvalData.amount || 0).toLocaleString()}`,
        `Deposit slip from "${notification.approvalData.requestedBy || 'Client'}" was declined by Finance Manager. Reason: ${rejectReason || 'Funds not verified'}.`,
        'FINANCE_MANAGER',
        'Finance Desk'
      );
    } catch (err) {
      console.warn("Could not decline finance payment:", err);
    }
  } else if (entityType === 'client' || actionType === 'APPROVE_CLIENT') {
    try {
      await updateClientInFirestore({
        id: String(entityId),
        loginEnabled: false,
        status: 'REJECTED'
      } as any);
    } catch (err) {
      console.warn("Could not reject client registration:", err);
    }
  }

  await updateNotificationInFirestore({
    ...notification,
    status: 'REJECTED',
    description: `${notification.description} [REJECTED BY ${rejectedByWho.toUpperCase()}${rejectReason ? ': ' + rejectReason : ''}]`
  });
}


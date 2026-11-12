import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Bell, X, Check, CheckCircle2, Clock, FileText, DollarSign, 
  Truck, ShieldCheck, ArrowRight, AlertTriangle, Info,
  ExternalLink, CheckCheck, Trash2
} from 'lucide-react';
import { AppNotification, UserRole } from '../types';
import { 
  subscribeToNotifications, 
  updateNotificationInFirestore,
  markNotificationsAsReadInFirestore,
  deleteNotificationFromFirestore,
  deleteNotificationsBatchFromFirestore,
  matchesActiveCompany
} from '../services/dbService';
import { useActiveCompany } from '../services/companyService';
import NotificationModal from './NotificationModal';
import { approveActionRequest, rejectActionRequest } from '../services/approvalService';
import { PushNotificationToggle, ForegroundPushToastHost } from './PushNotificationToggle';
import { initForegroundPushListener, triggerForegroundPushAlert } from '../services/fcmPushService';

interface LiveNotificationCenterProps {
  currentRole: UserRole | string;
  currentRoles?: (UserRole | string)[];
  userIdentifier?: string;
  clientName?: string;
  onNavigateToCase?: (caseNoOrId: string, filterData?: any) => void;
  onNavigateToTab?: (tabName: string) => void;
  buttonClassName?: string;
  showBadgeOnly?: boolean;
  theme?: 'pearl' | 'charcoal';
}

export const LiveNotificationCenter: React.FC<LiveNotificationCenterProps> = ({
  currentRole,
  currentRoles = [],
  userIdentifier = '',
  clientName = '',
  onNavigateToCase,
  onNavigateToTab,
  buttonClassName = '',
  theme,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<AppNotification | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'UNREAD' | 'APPROVALS'>('ALL');
  const { activeCompany } = useActiveCompany();

  // Detect active theme
  const isPearl = theme === 'pearl' || (typeof document !== 'undefined' && document.body.classList.contains('theme-pearl'));

  // Real-time Firestore subscription
  useEffect(() => {
    const unsub = subscribeToNotifications((items) => {
      setNotifications(items || []);
    });
    return () => unsub();
  }, []);

  // Normalization helper for roles
  const normalizeRole = (r?: any): string => {
    if (!r) return '';
    return String(r).toUpperCase().replace(/[^A-Z0-9]/g, '');
  };

  // Helper to extract target roles from notification
  const extractTargetRoles = (targetRole?: any, targetRoles?: any[]): string[] => {
    const result: string[] = [];
    if (Array.isArray(targetRoles)) {
      targetRoles.forEach(r => {
        const norm = normalizeRole(r);
        if (norm) result.push(norm);
      });
    }
    if (Array.isArray(targetRole)) {
      targetRole.forEach(r => {
        const norm = normalizeRole(r);
        if (norm) result.push(norm);
      });
    } else if (typeof targetRole === 'string' && targetRole.trim()) {
      targetRole.split(',').forEach(part => {
        const norm = normalizeRole(part.trim());
        if (norm) result.push(norm);
      });
    }
    return result;
  };

  // Filter notifications relevant to current role & user
  const relevantNotifications = useMemo(() => {
    const currentNorm = normalizeRole(currentRole);
    const userRolesNorm = (currentRoles || []).map(r => normalizeRole(r));
    if (currentNorm && !userRolesNorm.includes(currentNorm)) {
      userRolesNorm.push(currentNorm);
    }

    const isAdmin = 
      currentNorm === 'ADMIN' || 
      currentNorm === 'SUPERADMIN' ||
      userRolesNorm.includes('ADMIN') || 
      userRolesNorm.includes('SUPERADMIN');

    const isVehicleManager = 
      currentNorm === 'VEHICLEMANAGER' || 
      currentNorm === 'DOCUMENTATIONMANAGER' ||
      userRolesNorm.includes('VEHICLEMANAGER') ||
      userRolesNorm.includes('DOCUMENTATIONMANAGER') ||
      currentNorm.includes('VEHICLE') ||
      currentNorm.includes('DOCUMENTATION') ||
      userRolesNorm.some(r => r.includes('VEHICLE') || r.includes('DOCUMENTATION'));

    const isOperationsManager = 
      currentNorm === 'OPERATIONSMANAGER' || 
      userRolesNorm.includes('OPERATIONSMANAGER') ||
      currentNorm.includes('OPERATIONS') ||
      userRolesNorm.some(r => r.includes('OPERATIONS'));

    const isFinanceManager = 
      currentNorm === 'FINANCEMANAGER' ||
      currentNorm === 'FINANCE' ||
      userRolesNorm.includes('FINANCEMANAGER') ||
      userRolesNorm.includes('FINANCE') ||
      currentNorm.includes('FINANCE') ||
      userRolesNorm.some(r => r.includes('FINANCE'));

    const isCaseManager = 
      currentNorm === 'CASEMANAGER' || 
      userRolesNorm.includes('CASEMANAGER') ||
      currentNorm.includes('CASE') ||
      userRolesNorm.some(r => r.includes('CASE'));

    const isClient =
      currentNorm === 'CLIENT' ||
      userRolesNorm.includes('CLIENT');

    const isTransporter =
      currentNorm === 'TRANSPORTER' ||
      userRolesNorm.includes('TRANSPORTER');

    const matchesNamedEntity = (targetName?: string): boolean => {
      if (!targetName) return false;
      const targetClean = targetName.toLowerCase().trim();
      const userClean = (userIdentifier || '').toLowerCase().trim();
      const clientClean = (clientName || '').toLowerCase().trim();
      if (userClean && (targetClean === userClean || targetClean.includes(userClean) || userClean.includes(targetClean))) {
        return true;
      }
      if (clientClean && (targetClean === clientClean || targetClean.includes(clientClean) || clientClean.includes(targetClean))) {
        return true;
      }
      return false;
    };

    return notifications.filter(n => {
      // Company isolation check: if notification belongs to a specific company, match activeCompany (unless shared fleet/transporter)
      const notifCompany = (n as any).companyId;
      const isSharedFleetNotif = n.category === 'TRANSPORTER' || n.targetView === 'vehicles';
      if (notifCompany && activeCompany?.id && !isSharedFleetNotif) {
        if (!matchesActiveCompany(notifCompany, activeCompany.id)) {
          return false;
        }
      }

      const subType = (n.notificationSubType || '') as string;
      const actionType = (n.approvalData?.actionType || '') as string;
      const approvalStage = n.approvalData?.approvalStage;
      const titleLower = (n.title || '').toLowerCase();
      const descLower = (n.description || '').toLowerCase();
      const declaredTargetRoles = extractTargetRoles(n.targetRole, (n as any).targetRoles);

      // =======================================================================
      // 1. STRICT ADMIN FILTER:
      //    Admin receives ONLY:
      //    (a) Daily 12:00 PM Loading Gate-Out Summary & Table (DAILY_GATE_OUT_SUMMARY)
      //    (b) Expense Paid & Payment Received (FINANCE_RECORDED targeting ADMIN)
      //    (c) Company Documents Expiring Soon / Expired (DOC_EXPIRY_ALERT for company_documents)
      //    (d) Direct Admin Final Approvals (Case Edit / Cancel / Delete, Urgent Payable, NOC, Client Reg)
      // =======================================================================
      if (isAdmin) {
        if (approvalStage === 'MANAGER_REVIEW') return false;

        const explicitlyTargetsAdmin =
          declaredTargetRoles.includes('ADMIN') ||
          declaredTargetRoles.includes('SUPERADMIN');

        const isDailyGateOutSummary =
          subType === 'DAILY_GATE_OUT_SUMMARY' ||
          Boolean((n as any).gateOutReport);

        const isExpensePaidOrPaymentReceived =
          subType === 'FINANCE_RECORDED' && explicitlyTargetsAdmin;

        const isCompanyDocumentExpiry =
          (subType === 'DOC_EXPIRY_ALERT' || subType === 'LEGAL_HEARING_ALERT') &&
          n.targetView === 'company_documents';

        const isAdminFinalApproval =
          explicitlyTargetsAdmin &&
          (subType === 'CANCELLATION_APPROVAL' ||
            subType === 'EDIT_APPROVAL' ||
            subType === 'DELETION_APPROVAL' ||
            subType === 'CLIENT_REGISTRATION_APPROVAL' ||
            subType === 'URGENT_PAYABLE_APPROVAL' ||
            subType === 'NOC_REQUEST' ||
            actionType === 'CANCEL' ||
            actionType === 'EDIT' ||
            actionType === 'DELETE' ||
            actionType === 'APPROVE_NOC' ||
            actionType === 'APPROVE_CLIENT' ||
            actionType === 'APPROVE_URGENT_PAYABLE');

        return (
          isDailyGateOutSummary ||
          isExpensePaidOrPaymentReceived ||
          isCompanyDocumentExpiry ||
          isAdminFinalApproval
        );
      }

      // =======================================================================
      // 2. STRICT CLIENT FILTER:
      //    - Only notifications explicitly addressed to THIS Client account
      //    - Never show internal manager/admin approval requests
      // =======================================================================
      if (isClient && !isOperationsManager && !isFinanceManager && !isVehicleManager && !isCaseManager) {
        if (
          subType === 'DELETION_APPROVAL' ||
          subType === 'CANCELLATION_APPROVAL' ||
          subType === 'EDIT_APPROVAL' ||
          subType === 'URGENT_PAYABLE_APPROVAL' ||
          subType === 'PAYMENT_APPROVAL' ||
          subType === 'DAILY_GATE_OUT_SUMMARY'
        ) {
          return false;
        }
        if (!n.targetClientName) return false;
        return matchesNamedEntity(n.targetClientName);
      }

      // =======================================================================
      // 3. STRICT TRANSPORTER FILTER:
      //    - Only fleet/transporter notifications for THIS Transporter
      // =======================================================================
      if (isTransporter && !isVehicleManager && !isOperationsManager && !isFinanceManager) {
        if (
          subType === 'DELETION_APPROVAL' ||
          subType === 'CANCELLATION_APPROVAL' ||
          subType === 'EDIT_APPROVAL' ||
          subType === 'URGENT_PAYABLE_APPROVAL' ||
          subType === 'PAYMENT_APPROVAL' ||
          subType === 'CASE_APPROVAL' ||
          subType === 'DAILY_GATE_OUT_SUMMARY'
        ) {
          return false;
        }
        const targetsTransporterRole = declaredTargetRoles.some(tr => tr.includes('TRANSPORTER'));
        if (!targetsTransporterRole && n.category !== 'TRANSPORTER') return false;
        if (n.targetClientName && (userIdentifier || clientName)) {
          return matchesNamedEntity(n.targetClientName);
        }
        return true;
      }

      // =======================================================================
      // 4. GUARD ADMIN-ONLY FINAL APPROVALS FROM LEAKING TO OTHER ROLES
      // =======================================================================
      if (subType === 'DAILY_GATE_OUT_SUMMARY' || Boolean((n as any).gateOutReport)) {
        return false;
      }
      if (
        approvalStage === 'ADMIN_FINAL' &&
        declaredTargetRoles.length > 0 &&
        declaredTargetRoles.every(tr => tr === 'ADMIN' || tr === 'SUPERADMIN')
      ) {
        return false;
      }

      // Named entity direct match (e.g., individual staff payslip / HR alert)
      if (n.targetClientName && !declaredTargetRoles.includes('CLIENT') && matchesNamedEntity(n.targetClientName)) {
        return true;
      }

      // =======================================================================
      // 5. STRICT DIRECT ROLE MATCHING (NO BLANKET 'ALL' SPAM)
      // =======================================================================
      const matchesDirectRole = declaredTargetRoles.some(tr =>
        tr !== 'ALL' && (tr === currentNorm || userRolesNorm.includes(tr))
      );
      if (matchesDirectRole) return true;

      // Loading Port Staff vs Destination Port Staff strict separation
      const isLoadingPortStaff =
        currentNorm === 'LOADINGPORTSTAFF' ||
        userRolesNorm.includes('LOADINGPORTSTAFF');
      const isDestinationPortStaff =
        currentNorm === 'DESTINATIONPORTSTAFF' ||
        currentNorm === 'UNLOADINGSTAFF' ||
        userRolesNorm.includes('DESTINATIONPORTSTAFF') ||
        userRolesNorm.includes('UNLOADINGSTAFF');

      if (isLoadingPortStaff && declaredTargetRoles.includes('LOADINGPORTSTAFF')) {
        return true;
      }
      if (
        isDestinationPortStaff &&
        (declaredTargetRoles.includes('DESTINATIONPORTSTAFF') || declaredTargetRoles.includes('UNLOADINGSTAFF'))
      ) {
        return true;
      }

      // Documentation Manager (handles Documentation & Fleet/Vehicle workflows)
      if (isVehicleManager) {
        if (
          declaredTargetRoles.some(tr => tr === 'DOCUMENTATIONMANAGER' || tr === 'VEHICLEMANAGER' || tr === 'FLEETANDVEHICLEMANAGER') ||
          (n.category === 'TRANSPORTER' && approvalStage !== 'ADMIN_FINAL')
        ) {
          return true;
        }
      }

      // Operations Manager / Case Manager
      if (isOperationsManager || isCaseManager) {
        if (
          declaredTargetRoles.some(tr => tr === 'OPERATIONSMANAGER' || tr === 'CASEMANAGER') ||
          subType === 'TRANSIT_DELAY_ALERT' ||
          subType === 'IDLE_VEHICLE_ALERT'
        ) {
          return true;
        }
      }

      // Finance Manager:
      // - Client payment verification requests (PAYMENT_APPROVAL / VERIFY_PAYMENT) [ACTION]
      // - Monthly automatic payables & Gate-Out receivable invoices (INVOICE_CHARGE_NOTIFICATION) [INFO]
      // - Expense Paid / Payment Received records targeting FINANCE_MANAGER [INFO]
      // - Admin decisions on Finance Manager's requests
      if (isFinanceManager) {
        if (
          subType === 'PAYMENT_APPROVAL' ||
          subType === 'INVOICE_CHARGE_NOTIFICATION' ||
          actionType === 'VERIFY_PAYMENT' ||
          declaredTargetRoles.some(tr => tr === 'FINANCEMANAGER' || tr === 'FINANCE')
        ) {
          return true;
        }
      }

      return false;
    });
  }, [notifications, currentRole, currentRoles, clientName, userIdentifier, activeCompany?.id]);

  const isApprovalNotification = (n: AppNotification): boolean => {
    if (n.status !== 'PENDING') return false;
    const sub = String(n.notificationSubType || '');
    const act = String(n.approvalData?.actionType || '');
    return (
      n.type === 'APPROVAL' ||
      Boolean(act) ||
      sub === 'PAYMENT_APPROVAL' ||
      sub === 'URGENT_PAYABLE_APPROVAL' ||
      sub === 'CLIENT_REGISTRATION_APPROVAL' ||
      sub === 'CASE_APPROVAL' ||
      sub === 'DELETION_APPROVAL' ||
      sub === 'CANCELLATION_APPROVAL' ||
      sub === 'EDIT_APPROVAL' ||
      sub === 'NOC_REQUEST' ||
      sub === 'TRANSPORTER_PAYMENT_CONFIRMATION'
    );
  };

  const isActionRequiredNotification = (n: AppNotification): boolean => {
    if (n.status !== 'PENDING') return false;
    if (isApprovalNotification(n)) return true;
    const sub = String(n.notificationSubType || '');
    return (
      n.type === 'ACTION' ||
      sub === 'WORKFLOW_TASK' ||
      sub === 'CLIENT_MANAGED_DEMAND' ||
      sub === 'SALARY_READY'
    );
  };

  const isNotificationUnread = (n: AppNotification): boolean =>
    n.status === 'PENDING' && (isActionRequiredNotification(n) || !n.read);

  // Unread Count (Action-Required stay unread until action; Informative auto-read on opening Notification Center)
  const unreadCount = useMemo(() => {
    return relevantNotifications.filter(isNotificationUnread).length;
  }, [relevantNotifications]);

  const unreadInformativeCount = useMemo(() => {
    return relevantNotifications.filter(n => isNotificationUnread(n) && !isActionRequiredNotification(n)).length;
  }, [relevantNotifications]);

  // Auto-mark ALL Informative (non-action) notifications as Read upon opening the Notification Center
  useEffect(() => {
    if (!isOpen) return;
    const unreadInformative = relevantNotifications.filter(
      (n) => isNotificationUnread(n) && !isActionRequiredNotification(n)
    );
    if (unreadInformative.length === 0) return;

    const timer = setTimeout(() => {
      const infoIdSet = new Set(unreadInformative.map((i) => String(i.id)));
      const infoDocSet = new Set(unreadInformative.map((i) => String((i as any)._docId || i.id)));
      setNotifications((prev) =>
        prev.map((item) =>
          infoIdSet.has(String(item.id)) || infoDocSet.has(String((item as any)._docId || item.id))
            ? { ...item, status: 'RESOLVED', read: true }
            : item
        )
      );
      markNotificationsAsReadInFirestore(unreadInformative).catch((err) =>
        console.warn('Auto-read informative notifications warning:', err)
      );
    }, 650);

    return () => clearTimeout(timer);
  }, [isOpen, relevantNotifications]);

  // Deep-link: Open NotificationModal directly when launched via Web Push (?openNotificationId=...)
  useEffect(() => {
    if (typeof window === 'undefined' || relevantNotifications.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const openNotifId = params.get('openNotificationId');
    if (!openNotifId) return;

    const found = relevantNotifications.find(
      (n) => String(n.id) === openNotifId || String((n as any)._docId || '') === openNotifId
    );
    if (found) {
      setSelectedNotification(found);
      setIsModalOpen(true);
      params.delete('openNotificationId');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
    }
  }, [relevantNotifications]);

  // Foreground FCM + Real-time targeted notification toast & chime
  const knownPendingIdsRef = useRef<Set<string> | null>(null);
  const initialHydrationDoneRef = useRef<boolean>(false);

  useEffect(() => {
    initForegroundPushListener().catch(() => {});
    const timer = setTimeout(() => {
      initialHydrationDoneRef.current = true;
    }, 1800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const currentPending = relevantNotifications.filter(n => n.status === 'PENDING' && !n.read);
    if (knownPendingIdsRef.current === null || !initialHydrationDoneRef.current) {
      knownPendingIdsRef.current = new Set(currentPending.map(n => String(n.id)));
      return;
    }

    for (const n of currentPending) {
      const idStr = String(n.id);
      if (!knownPendingIdsRef.current.has(idStr)) {
        knownPendingIdsRef.current.add(idStr);
        triggerForegroundPushAlert({
          id: idStr,
          title: n.title || 'MAK Group Notification',
          body: n.description || 'New update requires your attention.',
          caseNo: n.targetFilter?.caseNo ? String(n.targetFilter.caseNo) : undefined,
          targetView: n.targetView,
          priority: n.priority
        }).catch(() => {});
      }
    }
  }, [relevantNotifications]);

  // Pending Approvals Count
  const pendingApprovalsCount = useMemo(() => {
    return relevantNotifications.filter(n => {
      if (n.status !== 'PENDING') return false;
      return (
        n.notificationSubType === 'PAYMENT_APPROVAL' ||
        n.notificationSubType === 'URGENT_PAYABLE_APPROVAL' ||
        n.notificationSubType === 'CLIENT_REGISTRATION_APPROVAL' ||
        n.notificationSubType === 'CASE_APPROVAL' ||
        n.notificationSubType === 'DELETION_APPROVAL' ||
        n.notificationSubType === 'CANCELLATION_APPROVAL' ||
        n.notificationSubType === 'EDIT_APPROVAL' ||
        n.approvalData?.actionType === 'VERIFY_PAYMENT' ||
        n.approvalData?.actionType === 'APPROVE_URGENT_PAYABLE' ||
        n.approvalData?.actionType === 'APPROVE_NOC' ||
        n.approvalData?.actionType === 'APPROVE_CLIENT'
      );
    }).length;
  }, [relevantNotifications]);

  // Filtered Notifications based on selected tab
  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'UNREAD') {
      return relevantNotifications.filter(isNotificationUnread);
    }
    if (activeFilter === 'APPROVALS') {
      return relevantNotifications.filter(n => {
        return (
          n.notificationSubType === 'PAYMENT_APPROVAL' ||
          n.notificationSubType === 'URGENT_PAYABLE_APPROVAL' ||
          n.notificationSubType === 'CLIENT_REGISTRATION_APPROVAL' ||
          n.notificationSubType === 'CASE_APPROVAL' ||
          n.notificationSubType === 'DELETION_APPROVAL' ||
          n.notificationSubType === 'CANCELLATION_APPROVAL' ||
          n.notificationSubType === 'EDIT_APPROVAL' ||
          n.approvalData?.actionType === 'VERIFY_PAYMENT' ||
          n.approvalData?.actionType === 'APPROVE_URGENT_PAYABLE' ||
          n.approvalData?.actionType === 'APPROVE_NOC' ||
          n.approvalData?.actionType === 'APPROVE_CLIENT' ||
          n.approvalData?.actionType === 'APPROVE_TRANSPORTER' ||
          n.approvalData?.actionType === 'CONFIRM_TRANSPORTER_PAYMENT'
        );
      });
    }
    return relevantNotifications;
  }, [relevantNotifications, activeFilter]);

  const handleMarkAsRead = async (n: AppNotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isActionRequiredNotification(n)) return;
    const targetId = String(n.id);
    const targetDocId = String((n as any)._docId || n.id);
    setNotifications(prev =>
      prev.map(item =>
        String(item.id) === targetId || String((item as any)._docId || item.id) === targetDocId
          ? { ...item, status: 'RESOLVED', read: true }
          : item
      )
    );
    try {
      await markNotificationsAsReadInFirestore([n]);
    } catch (err) {
      console.warn("Could not mark as read:", err);
    }
  };

  const handleMarkAllRead = async () => {
    // Only mark Informative notifications as read — Action-Required notifications MUST remain unread until action is completed!
    const pendingItems = relevantNotifications.filter(
      n => (n.status === 'PENDING' || !n.read) && !isActionRequiredNotification(n)
    );
    if (pendingItems.length === 0) return;

    const pendingIdSet = new Set(pendingItems.map(i => String(i.id)));
    const pendingDocSet = new Set(pendingItems.map(i => String((i as any)._docId || i.id)));

    setNotifications(prev =>
      prev.map(item =>
        pendingIdSet.has(String(item.id)) || pendingDocSet.has(String((item as any)._docId || item.id))
          ? { ...item, status: 'RESOLVED', read: true }
          : item
      )
    );

    try {
      await markNotificationsAsReadInFirestore(pendingItems);
    } catch (err) {
      console.warn("Could not mark informative notifications as read:", err);
    }
  };

  const handleDeleteNotification = async (n: AppNotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isActionRequiredNotification(n)) return;
    const targetId = String(n.id);
    const targetDocId = String((n as any)._docId || n.id);
    setNotifications(prev =>
      prev.filter(
        item => String(item.id) !== targetId && String((item as any)._docId || item.id) !== targetDocId
      )
    );
    try {
      await deleteNotificationFromFirestore(n.id, (n as any)._docId);
    } catch (err) {
      console.warn("Could not delete notification:", err);
    }
  };

  const handleClearAllNotifications = async () => {
    // Preserve pending Action-Required notifications until their required action is completed
    const itemsToDelete = relevantNotifications.filter(n => !isActionRequiredNotification(n));
    if (itemsToDelete.length === 0) return;

    const delIdSet = new Set(itemsToDelete.map(i => String(i.id)));
    const delDocSet = new Set(itemsToDelete.map(i => String((i as any)._docId || i.id)));
    setNotifications(prev =>
      prev.filter(
        item => !delIdSet.has(String(item.id)) && !delDocSet.has(String((item as any)._docId || item.id))
      )
    );

    try {
      await deleteNotificationsBatchFromFirestore(itemsToDelete);
    } catch (err) {
      console.warn("Could not clear role notifications:", err);
    }
  };

  const resolveWorkflowTaskOnExecute = async (n: AppNotification) => {
    const targetId = String(n.id);
    const targetDocId = String((n as any)._docId || n.id);
    setNotifications(prev =>
      prev.map(item =>
        String(item.id) === targetId || String((item as any)._docId || item.id) === targetDocId
          ? { ...item, status: 'RESOLVED', read: true }
          : item
      )
    );
    try {
      await markNotificationsAsReadInFirestore([n]);
    } catch (err) {
      console.warn("Could not resolve task notification:", err);
    }
  };

  const handleDirectNavigate = (n: AppNotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    // Approval items stay unread until Accept/Reject; Workflow Task items resolve when user clicks CTA to execute task
    if (n.status === 'PENDING' && !isApprovalNotification(n)) {
      resolveWorkflowTaskOnExecute(n);
    }
    if (n.targetFilter?.caseNo && onNavigateToCase) {
      onNavigateToCase(n.targetFilter.caseNo, n.targetFilter);
      setIsOpen(false);
      return;
    }
    if (n.targetView && onNavigateToTab) {
      onNavigateToTab(n.targetView);
      setIsOpen(false);
      return;
    }
    setSelectedNotification(n);
    setIsModalOpen(true);
  };

  const handleCardClick = async (n: AppNotification) => {
    // 1. Mark ONLY Informative notifications as read on tap; Action-Required notifications remain unread until action is completed!
    if (n.status === 'PENDING' && !isActionRequiredNotification(n)) {
      handleMarkAsRead(n);
    }

    // 2. Open the Notification Detail & Action Modal (shows Gate-Out Table or Accept/Reject buttons)
    setSelectedNotification(n);
    setIsModalOpen(true);
  };

  const handleQuickApprove = async (n: AppNotification, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await approveActionRequest(n);
      await updateNotificationInFirestore({
        ...n,
        status: 'RESOLVED',
        read: true
      });
    } catch (err) {
      console.error("Failed to approve notification action:", err);
    }
  };

  const handleQuickReject = async (n: AppNotification, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await rejectActionRequest(n);
      await updateNotificationInFirestore({
        ...n,
        status: 'RESOLVED',
        read: true
      });
    } catch (err) {
      console.error("Failed to reject notification action:", err);
    }
  };

  const handleNotificationAction = async (action: 'ACCEPT' | 'REJECT' | 'VIEW' | 'MARK_READ' | 'DELETE') => {
    if (!selectedNotification) return;

    if (action === 'DELETE') {
      await handleDeleteNotification(selectedNotification);
      setIsModalOpen(false);
      return;
    }

    if (action === 'VIEW') {
      if (selectedNotification.status === 'PENDING' && !isApprovalNotification(selectedNotification)) {
        resolveWorkflowTaskOnExecute(selectedNotification);
      }
      if (selectedNotification.targetFilter?.caseNo && onNavigateToCase) {
        onNavigateToCase(selectedNotification.targetFilter.caseNo, selectedNotification.targetFilter);
      } else if (selectedNotification.targetView && onNavigateToTab) {
        onNavigateToTab(selectedNotification.targetView);
      }
      setIsModalOpen(false);
      setIsOpen(false);
    } else if (action === 'ACCEPT') {
      try {
        await approveActionRequest(selectedNotification);
        await updateNotificationInFirestore({
          ...selectedNotification,
          status: 'RESOLVED'
        });
      } catch (err) {
        console.error("Failed to approve action request:", err);
      }
      setIsModalOpen(false);
    } else if (action === 'REJECT') {
      try {
        await rejectActionRequest(selectedNotification);
        await updateNotificationInFirestore({
          ...selectedNotification,
          status: 'RESOLVED'
        });
      } catch (err) {
        console.error("Failed to reject action request:", err);
      }
      setIsModalOpen(false);
    } else if (action === 'MARK_READ') {
      try {
        await updateNotificationInFirestore({
          ...selectedNotification,
          status: 'RESOLVED'
        });
      } catch (err) {
        console.warn("Failed to mark as read:", err);
      }
      setIsModalOpen(false);
    }
  };

  const formatRelativeTime = (n: AppNotification): string => {
    const rawTime = (n as any).updatedAt || n.timestamp;
    if (!rawTime) return 'Just now';
    const parsed = new Date(rawTime).getTime();
    if (!isNaN(parsed) && parsed > 0) {
      const diffSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
      if (diffSec < 45) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h`;
      const diffDays = Math.floor(diffHr / 24);
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d`;
      return new Date(parsed).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    }
    return String(n.timestamp || 'Recent');
  };

  const getNotificationAvatarStyle = (n: AppNotification) => {
    const subType = n.notificationSubType || '';
    const text = `${n.title || ''} ${n.description || ''} ${subType}`.toLowerCase();

    if (
      subType === 'VEHICLE_GATE_PASS' ||
      subType === 'TRANSPORTER_ASSIGNED' ||
      text.includes('vehicle') ||
      text.includes('truck') ||
      text.includes('trailer') ||
      text.includes('transporter') ||
      text.includes('fleet') ||
      text.includes('noc') ||
      text.includes('veh_')
    ) {
      return {
        bg: isPearl ? 'bg-amber-100 border-amber-200 text-amber-600' : 'bg-amber-500/20 border-amber-500/30 text-amber-400',
        badgeBg: 'bg-amber-500',
        icon: <Truck size={20} />
      };
    }

    switch (subType) {
      case 'DAILY_GATE_OUT_SUMMARY':
      case 'DESTINATION_ARRIVAL':
        return {
          bg: isPearl ? 'bg-amber-100 border-amber-200 text-amber-600' : 'bg-amber-500/20 border-amber-500/30 text-amber-400',
          badgeBg: 'bg-amber-500',
          icon: <Truck size={20} />
        };
      case 'GATE_OUT_INVOICE':
      case 'PAYMENT_APPROVAL':
      case 'INVOICE_CHARGE_NOTIFICATION':
      case 'BUYING':
        return {
          bg: isPearl ? 'bg-emerald-100 border-emerald-200 text-emerald-600' : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
          badgeBg: 'bg-emerald-500',
          icon: <DollarSign size={20} />
        };
      case 'CLIENT_REGISTRATION_APPROVAL':
        return {
          bg: isPearl ? 'bg-purple-100 border-purple-200 text-purple-600' : 'bg-purple-500/20 border-purple-500/30 text-purple-400',
          badgeBg: 'bg-purple-500',
          icon: <ShieldCheck size={20} />
        };
      case 'WORKFLOW_TASK':
      case 'CASE_APPROVAL':
        return {
          bg: isPearl ? 'bg-blue-100 border-blue-200 text-blue-600' : 'bg-blue-500/20 border-blue-500/30 text-blue-400',
          badgeBg: 'bg-blue-500',
          icon: <FileText size={20} />
        };
      case 'FINANCE_RECORDED':
        return {
          bg: isPearl ? 'bg-teal-100 border-teal-200 text-teal-600' : 'bg-teal-500/20 border-teal-500/30 text-teal-400',
          badgeBg: 'bg-teal-500',
          icon: <CheckCircle2 size={20} />
        };
      case 'DELETION_APPROVAL':
      case 'CANCELLATION_APPROVAL':
        return {
          bg: isPearl ? 'bg-rose-100 border-rose-200 text-rose-600' : 'bg-rose-500/20 border-rose-500/30 text-rose-400',
          badgeBg: 'bg-rose-500',
          icon: <AlertTriangle size={20} />
        };
      case 'EDIT_APPROVAL':
        return {
          bg: isPearl ? 'bg-sky-100 border-sky-200 text-sky-600' : 'bg-sky-500/20 border-sky-500/30 text-sky-400',
          badgeBg: 'bg-sky-500',
          icon: <Info size={20} />
        };
      default:
        return {
          bg: isPearl ? 'bg-blue-100 border-blue-200 text-blue-600' : 'bg-blue-500/20 border-blue-500/30 text-blue-400',
          badgeBg: 'bg-blue-500',
          icon: <Bell size={20} />
        };
    }
  };

  const newNotifications = useMemo(
    () => filteredNotifications.filter(isNotificationUnread),
    [filteredNotifications]
  );

  const earlierNotifications = useMemo(
    () => filteredNotifications.filter(n => !isNotificationUnread(n)),
    [filteredNotifications]
  );

  const renderNotificationRow = (n: AppNotification, idx: number) => {
    const isPending = isNotificationUnread(n);
    const avatarStyle = getNotificationAvatarStyle(n);
    const isPaymentApproval =
      n.notificationSubType === 'PAYMENT_APPROVAL' ||
      n.approvalData?.actionType === 'VERIFY_PAYMENT';

    const isApproval =
      isPaymentApproval ||
      n.notificationSubType === 'URGENT_PAYABLE_APPROVAL' ||
      n.notificationSubType === 'CLIENT_REGISTRATION_APPROVAL' ||
      n.notificationSubType === 'CASE_APPROVAL' ||
      n.notificationSubType === 'DELETION_APPROVAL' ||
      n.notificationSubType === 'CANCELLATION_APPROVAL' ||
      n.notificationSubType === 'EDIT_APPROVAL' ||
      n.approvalData?.actionType === 'APPROVE_URGENT_PAYABLE' ||
      n.approvalData?.actionType === 'APPROVE_NOC' ||
      n.approvalData?.actionType === 'APPROVE_CLIENT' ||
      n.approvalData?.actionType === 'APPROVE_TRANSPORTER' ||
      n.approvalData?.actionType === 'CONFIRM_TRANSPORTER_PAYMENT';

    return (
      <div
        key={`live_notif_${n.id || idx}_${idx}`}
        onClick={() => handleCardClick(n)}
        className={`group relative flex items-start gap-3.5 px-3.5 py-3 rounded-2xl transition-all cursor-pointer select-none ${
          isPearl
            ? isPending
              ? 'bg-blue-50/80 hover:bg-blue-100/70'
              : 'bg-transparent hover:bg-slate-100/90'
            : isPending
              ? 'bg-blue-500/10 hover:bg-blue-500/15'
              : 'bg-transparent hover:bg-white/[0.06]'
        }`}
      >
        {/* Left Avatar Circle with Category Mini-Badge (Facebook/Instagram style) */}
        <div className="relative shrink-0 mt-0.5">
          <div className={`w-12 h-12 rounded-full border flex items-center justify-center shadow-xs ${avatarStyle.bg}`}>
            {avatarStyle.icon}
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full ${avatarStyle.badgeBg} text-white flex items-center justify-center ring-2 ${
              isPearl ? 'ring-white' : 'ring-slate-900'
            }`}
          >
            <Bell size={10} />
          </span>
        </div>

        {/* Center Notification Text + Inline Actions */}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-snug">
            <span className={`font-bold ${isPearl ? 'text-slate-900' : 'text-white'}`}>
              {n.title}
            </span>
            {n.description && (
              <span className={`block mt-0.5 text-xs leading-relaxed line-clamp-2 ${
                isPearl ? 'text-slate-600' : 'text-slate-300'
              }`}>
                {n.description}
              </span>
            )}
          </div>

          {/* Meta Row: Relative Time & Entity Tags */}
          <div className="flex items-center flex-wrap gap-2 mt-1.5">
            <span className={`text-[11px] font-bold ${
              isPending
                ? (isPearl ? 'text-blue-600' : 'text-blue-400')
                : (isPearl ? 'text-slate-400' : 'text-slate-500')
            }`}>
              {formatRelativeTime(n)}
            </span>

            {n.targetFilter?.caseNo && (
              <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border ${
                isPearl ? 'bg-white text-slate-700 border-slate-200' : 'bg-white/5 text-slate-300 border-white/10'
              }`}>
                Case #{n.targetFilter.caseNo}
              </span>
            )}
            {n.targetFilter?.vehicleNo && (
              <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border ${
                isPearl ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
              }`}>
                {n.targetFilter.vehicleNo}
              </span>
            )}
            {isActionRequiredNotification(n) && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                isPearl
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              }`}>
                Action Required
              </span>
            )}
          </div>

          {/* Facebook/Instagram Style Inline Action Buttons */}
          {(isApproval && isPending) || n.targetView || n.targetFilter?.caseNo || (n as any).gateOutReport ? (
            <div className="flex items-center flex-wrap gap-2 mt-2.5">
              {isApproval && isPending && (
                <>
                  <button
                    type="button"
                    onClick={(e) => handleQuickApprove(n, e)}
                    style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <Check size={13} />
                    <span>{isPaymentApproval ? 'Verify Payment' : 'Confirm / Approve'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleQuickReject(n, e)}
                    className={`px-3.5 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1 transition cursor-pointer ${
                      isPearl
                        ? 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                        : 'bg-white/10 hover:bg-white/20 text-slate-200'
                    }`}
                  >
                    <X size={13} />
                    <span>Delete / Reject</span>
                  </button>
                </>
              )}
              {(n as any).gateOutReport && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCardClick(n);
                  }}
                  className="px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition cursor-pointer bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-xs"
                >
                  <span>{n.actionLabel || 'Open Gate-Out Table'}</span>
                  <ArrowRight size={11} />
                </button>
              )}
              {(n.targetView || n.targetFilter?.caseNo) && !(isApproval && isPending) && !(n as any).gateOutReport && (
                <button
                  type="button"
                  onClick={(e) => handleDirectNavigate(n, e)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition cursor-pointer ${
                    isPearl
                      ? 'bg-slate-200/80 hover:bg-slate-300/80 text-slate-800'
                      : 'bg-white/10 hover:bg-white/15 text-slate-200'
                  }`}
                >
                  <span>{n.actionLabel || 'View Details'}</span>
                  <ArrowRight size={11} />
                </button>
              )}
            </div>
          ) : null}
        </div>

        {/* Right Side Unread Dot + Hover Quick Actions */}
        <div className="flex flex-col items-end justify-between gap-2 shrink-0 self-center">
          {isPending ? (
            <span
              className="w-2.5 h-2.5 rounded-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.6)] shrink-0"
              title={isActionRequiredNotification(n) ? "Action required to mark read" : "Unread notification"}
            />
          ) : (
            <span className="w-2.5 h-2.5 shrink-0" />
          )}

          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
            {isPending && !isActionRequiredNotification(n) && (
              <button
                type="button"
                onClick={(e) => handleMarkAsRead(n, e)}
                className={`p-1 rounded-lg transition cursor-pointer ${
                  isPearl
                    ? 'text-slate-400 hover:text-blue-600 hover:bg-white'
                    : 'text-slate-400 hover:text-blue-400 hover:bg-white/10'
                }`}
                title="Mark as Read"
              >
                <Check size={14} />
              </button>
            )}
            {!isActionRequiredNotification(n) && (
              <button
                type="button"
                onClick={(e) => handleDeleteNotification(n, e)}
                className={`p-1 rounded-lg transition cursor-pointer ${
                  isPearl
                    ? 'text-slate-400 hover:text-rose-600 hover:bg-white'
                    : 'text-slate-400 hover:text-rose-400 hover:bg-white/10'
                }`}
                title="Remove notification"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Trigger Button with Properly Anchored Count Badge */}
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)} 
        style={{ position: 'relative', overflow: 'visible' }}
        className={buttonClassName ? `${buttonClassName} relative inline-flex items-center justify-center shrink-0` : "relative h-9 w-9 p-2 rounded-xl text-gray-300 hover:text-white hover:bg-white/10 border border-white/10 transition active:scale-95 shrink-0 inline-flex items-center justify-center cursor-pointer"}
        title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : "Notifications"}
        aria-label="Notifications"
      >
        <Bell size={18} className={unreadCount > 0 ? 'text-amber-500' : ''} />
        {unreadCount > 0 && (
          <span 
            style={{
              position: 'absolute',
              top: '-5px',
              right: '-5px',
              backgroundColor: '#e11d48',
              color: '#ffffff',
              lineHeight: 1,
              zIndex: 30
            }}
            className={`min-w-[18px] h-[18px] px-1 text-[10px] font-extrabold rounded-full flex items-center justify-center shadow-md ring-2 ${
              isPearl ? 'ring-white' : 'ring-slate-900'
            } pointer-events-none`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Facebook / Instagram Style Anchored Notification Popover Drawer */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[99990] flex items-start justify-end pt-14 sm:pt-16 px-2 sm:px-5 pb-4 bg-black/30 backdrop-blur-[2px] animate-fade-in"
          style={{ isolation: 'isolate' }}
          onClick={() => setIsOpen(false)}
        >
          <div 
            className={`w-full sm:w-[420px] md:w-[440px] max-h-[calc(100dvh-4.5rem)] rounded-3xl shadow-2xl border flex flex-col overflow-hidden transition-all duration-200 ${
              isPearl 
                ? 'bg-white text-slate-900 border-slate-200/90 shadow-[0_20px_60px_rgba(15,23,42,0.22)]' 
                : 'bg-[#18191A] text-slate-100 border-white/15 shadow-[0_20px_60px_rgba(0,0,0,0.75)]'
            }`}
            style={{ isolation: 'isolate', marginTop: 0, marginBottom: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Header (Facebook "Notifications" Header) */}
            <div className="px-4 pt-4 pb-2.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <h3 className={`text-xl font-extrabold tracking-tight ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                  Notifications
                </h3>
                {unreadCount > 0 && (
                  <span 
                    style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                    className="text-[11px] font-extrabold px-2 py-0.5 rounded-full"
                  >
                    {unreadCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {unreadInformativeCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className={`text-xs font-bold px-2.5 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1 ${
                      isPearl 
                        ? 'text-blue-600 hover:bg-blue-50' 
                        : 'text-blue-400 hover:bg-white/10'
                    }`}
                    title="Mark informative notifications as read"
                  >
                    <CheckCheck size={15} />
                    <span>Mark all read</span>
                  </button>
                )}
                {relevantNotifications.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllNotifications}
                    className={`p-1.5 rounded-xl transition cursor-pointer ${
                      isPearl 
                        ? 'text-slate-500 hover:text-rose-600 hover:bg-rose-50' 
                        : 'text-slate-400 hover:text-rose-400 hover:bg-white/10'
                    }`}
                    title="Clear all notifications"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className={`p-1.5 rounded-xl transition cursor-pointer ${
                    isPearl 
                      ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100' 
                      : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Push Notification Permission & Device Toggle Bar */}
            <PushNotificationToggle
              variant="banner"
              theme={isPearl ? 'pearl' : 'charcoal'}
              identity={{
                userName: userIdentifier,
                role: currentRole,
                roles: currentRoles,
                clientName
              }}
            />

            {/* Filter Pills (Facebook Style: All | Unread | Approvals) */}
            <div className="px-4 pb-3 flex items-center gap-2 shrink-0 select-none border-b border-slate-200/70 dark:border-white/10">
              <button
                type="button"
                onClick={() => setActiveFilter('ALL')}
                className={`py-1.5 px-3.5 rounded-full text-xs font-bold transition cursor-pointer ${
                  activeFilter === 'ALL'
                    ? (isPearl ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/25 text-blue-300')
                    : (isPearl ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-300 hover:bg-white/15')
                }`}
              >
                All
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter('UNREAD')}
                className={`py-1.5 px-3.5 rounded-full text-xs font-bold transition cursor-pointer ${
                  activeFilter === 'UNREAD'
                    ? (isPearl ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/25 text-blue-300')
                    : (isPearl ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-300 hover:bg-white/15')
                }`}
              >
                Unread {unreadCount > 0 ? `(${unreadCount})` : ''}
              </button>

              {currentRole !== UserRole.CLIENT && (
                <button
                  type="button"
                  onClick={() => setActiveFilter('APPROVALS')}
                  className={`py-1.5 px-3.5 rounded-full text-xs font-bold transition cursor-pointer ${
                    activeFilter === 'APPROVALS'
                      ? (isPearl ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/25 text-blue-300')
                      : (isPearl ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-300 hover:bg-white/15')
                  }`}
                >
                  Approvals {pendingApprovalsCount > 0 ? `(${pendingApprovalsCount})` : ''}
                </button>
              )}
            </div>

            {/* Scrollable Feed Grouped into "New" and "Earlier" */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 custom-scrollbar overscroll-contain">
              {filteredNotifications.length === 0 ? (
                <div className="py-14 flex flex-col items-center justify-center text-center px-6">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${
                    isPearl ? 'bg-slate-100 text-slate-400' : 'bg-white/5 text-slate-500'
                  }`}>
                    <Bell size={26} />
                  </div>
                  <h4 className={`text-sm font-bold ${isPearl ? 'text-slate-800' : 'text-slate-200'}`}>
                    You have no notifications
                  </h4>
                  <p className={`text-xs mt-1 leading-relaxed ${isPearl ? 'text-slate-500' : 'text-slate-400'}`}>
                    {activeFilter === 'UNREAD' 
                      ? 'You are all caught up! No unread notifications.' 
                      : 'Live updates from cases, vehicles, payments, and approvals will appear here automatically.'}
                  </p>
                </div>
              ) : (
                <>
                  {newNotifications.length > 0 && (
                    <div className="space-y-1">
                      <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                        <span className={`text-sm font-extrabold ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                          New
                        </span>
                        <span className={`text-[11px] font-semibold ${isPearl ? 'text-blue-600' : 'text-blue-400'}`}>
                          {newNotifications.length} unread
                        </span>
                      </div>
                      {newNotifications.map((n, idx) => renderNotificationRow(n, idx))}
                    </div>
                  )}

                  {earlierNotifications.length > 0 && (
                    <div className="space-y-1 pt-2">
                      <div className="px-3 pt-1 pb-1 flex items-center justify-between">
                        <span className={`text-sm font-extrabold ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                          Earlier
                        </span>
                      </div>
                      {earlierNotifications.map((n, idx) => renderNotificationRow(n, idx + 1000))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Action / Detail Modal */}
      {isModalOpen && selectedNotification && (
        <NotificationModal 
          isOpen={isModalOpen}
          notification={selectedNotification}
          onClose={() => setIsModalOpen(false)}
          onAction={handleNotificationAction}
        />
      )}

      {/* Foreground Push Toast + Service Worker Click Deep-Link Host */}
      <ForegroundPushToastHost
        theme={isPearl ? 'pearl' : 'charcoal'}
        onNavigate={(payload) => {
          let targetNotifId = payload.notificationId || '';
          if (!targetNotifId && payload.url) {
            try {
              const parsedUrl = new URL(payload.url, window.location.origin);
              targetNotifId = parsedUrl.searchParams.get('openNotificationId') || '';
            } catch {
              // ignore URL parse error
            }
          }

          if (targetNotifId) {
            const matched = relevantNotifications.find(
              (n) => String(n.id) === targetNotifId || String((n as any)._docId || '') === targetNotifId
            );
            if (matched) {
              setSelectedNotification(matched);
              setIsModalOpen(true);
              return;
            }
          }

          if (payload.caseNo && onNavigateToCase) {
            onNavigateToCase(payload.caseNo, { caseNo: payload.caseNo });
          } else if (payload.targetView && onNavigateToTab) {
            onNavigateToTab(payload.targetView);
          }
        }}
      />
    </>
  );
};

export default LiveNotificationCenter;

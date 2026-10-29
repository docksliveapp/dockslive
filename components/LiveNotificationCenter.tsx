import React, { useState, useEffect, useMemo } from 'react';
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
  deleteNotificationFromFirestore,
  clearAllNotificationsInFirestore,
  matchesActiveCompany
} from '../services/dbService';
import { useActiveCompany } from '../services/companyService';
import NotificationModal from './NotificationModal';
import { approveActionRequest, rejectActionRequest } from '../services/approvalService';

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
      userRolesNorm.includes('VEHICLEMANAGER') ||
      currentNorm.includes('VEHICLE') ||
      userRolesNorm.some(r => r.includes('VEHICLE'));

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
      // 1. ADMIN FILTER:
      //    - All Admin-targeted notifications, approvals, finance alerts, document/vehicle expiries, and hearing notices
      //    - Hide Step 1 Manager Review items until Manager approves Step 1
      // =======================================================================
      if (isAdmin) {
        if (approvalStage === 'MANAGER_REVIEW') return false;

        const targetsAdminOrAll =
          declaredTargetRoles.includes('ADMIN') ||
          declaredTargetRoles.includes('SUPERADMIN') ||
          declaredTargetRoles.includes('ALL');

        const isDocOrVehicleExpiry =
          subType === 'DOC_EXPIRY_ALERT' ||
          titleLower.includes('expired') ||
          titleLower.includes('expiring soon') ||
          titleLower.includes('expire soon');

        const isPaymentPaidOrReceived =
          subType === 'FINANCE_RECORDED' ||
          subType === 'PAYMENT_APPROVAL' ||
          subType === 'INVOICE_CHARGE_NOTIFICATION' ||
          titleLower.startsWith('payment paid') ||
          titleLower.startsWith('payment received');

        const isAdminApproval =
          subType === 'CANCELLATION_APPROVAL' ||
          subType === 'EDIT_APPROVAL' ||
          subType === 'DELETION_APPROVAL' ||
          subType === 'CLIENT_REGISTRATION_APPROVAL' ||
          subType === 'CASE_APPROVAL' ||
          subType === 'URGENT_PAYABLE_APPROVAL' ||
          actionType === 'CANCEL' ||
          actionType === 'EDIT' ||
          actionType === 'DELETE' ||
          actionType === 'APPROVE_NOC' ||
          actionType === 'APPROVE_CLIENT' ||
          actionType === 'VERIFY_PAYMENT' ||
          actionType === 'APPROVE_URGENT_PAYABLE';

        const isHearingNoticeReminder =
          subType === 'HEARING_NOTICE_REMINDER' ||
          titleLower.includes('hearing notice') ||
          descLower.includes('hearing notice');

        return (
          targetsAdminOrAll ||
          isDocOrVehicleExpiry ||
          isPaymentPaidOrReceived ||
          isAdminApproval ||
          isHearingNoticeReminder
        );
      }

      // =======================================================================
      // 2. STRICT CLIENT FILTER:
      //    - Only notifications explicitly addressed to THIS Client (jis per paisey charge horahey hain / jis client ka case hai)
      //    - Hide internal approval requests (MANAGER_REVIEW / ADMIN_FINAL)
      // =======================================================================
      if (isClient && !isOperationsManager && !isFinanceManager && !isVehicleManager && !isCaseManager) {
        if (
          subType === 'DELETION_APPROVAL' ||
          subType === 'CANCELLATION_APPROVAL' ||
          subType === 'EDIT_APPROVAL' ||
          subType === 'URGENT_PAYABLE_APPROVAL' ||
          subType === 'PAYMENT_APPROVAL'
        ) {
          return false;
        }
        // Client must ONLY see notifications where targetClientName matches their identity
        if (!n.targetClientName) return false;
        return matchesNamedEntity(n.targetClientName);
      }

      // =======================================================================
      // 3. STRICT TRANSPORTER FILTER:
      //    - Vehicle registration confirmed marked
      //    - Vehicle cancelled marked & NOC generated
      //    - Vehicle expire soon, expired, renewed
      //    - Decisions on transporter requests
      // =======================================================================
      if (isTransporter && !isVehicleManager && !isOperationsManager && !isFinanceManager) {
        if (
          subType === 'DELETION_APPROVAL' ||
          subType === 'CANCELLATION_APPROVAL' ||
          subType === 'EDIT_APPROVAL' ||
          subType === 'URGENT_PAYABLE_APPROVAL' ||
          subType === 'PAYMENT_APPROVAL'
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
      // 4. OPERATIONS MANAGER & VEHICLE MANAGER:
      //    - Step 1 Manager Review requests from Client/Transporter
      //    - Admin approval/rejection outcomes for cases & vehicles
      //    - Fleet expiry, idle vehicle, and transit delay alerts
      // =======================================================================
      if (n.targetClientName && matchesNamedEntity(n.targetClientName)) {
        return true;
      }

      const matchesDirectRole = declaredTargetRoles.some(tr => 
        tr === currentNorm || userRolesNorm.includes(tr)
      );
      if (matchesDirectRole) return true;

      if (isVehicleManager) {
        if (approvalStage === 'ADMIN_FINAL' && !declaredTargetRoles.some(tr => tr.includes('VEHICLE'))) {
          return false;
        }
        if (
          n.category === 'TRANSPORTER' || 
          declaredTargetRoles.some(tr => tr.includes('VEHICLE') || tr.includes('FLEET'))
        ) return true;
      }

      if (isOperationsManager || isCaseManager) {
        if (approvalStage === 'ADMIN_FINAL' && !declaredTargetRoles.some(tr => tr.includes('OPERATION') || tr.includes('CASE'))) {
          return false;
        }
        if (
          declaredTargetRoles.some(tr => tr.includes('OPERATION') || tr.includes('CASE')) ||
          subType === 'TRANSIT_DELAY_ALERT' ||
          subType === 'IDLE_VEHICLE_ALERT'
        ) return true;
      }

      // =======================================================================
      // 5. FINANCE MANAGER:
      //    - Client payment verification requests (PAYMENT_APPROVAL / VERIFY_PAYMENT)
      //    - Any invoice charges anywhere: payable invoice by vendor, receivable invoices in cases (INVOICE_CHARGE_NOTIFICATION)
      //    - Admin decision confirmation on urgent payable requests
      //    - Payment paid / received records
      // =======================================================================
      if (isFinanceManager) {
        if (subType === 'URGENT_PAYABLE_APPROVAL' && declaredTargetRoles.includes('ADMIN') && !declaredTargetRoles.includes('FINANCEMANAGER')) {
          return false;
        }
        if (
          n.category === 'FINANCE' ||
          subType === 'PAYMENT_APPROVAL' ||
          subType === 'INVOICE_CHARGE_NOTIFICATION' ||
          subType === 'FINANCE_RECORDED' ||
          actionType === 'VERIFY_PAYMENT' ||
          declaredTargetRoles.some(tr => tr.includes('FINANCE'))
        ) return true;
      }

      return false;
    });
  }, [notifications, currentRole, currentRoles, clientName, userIdentifier, activeCompany?.id]);

  // Unread Count
  const unreadCount = useMemo(() => {
    return relevantNotifications.filter(n => n.status === 'PENDING').length;
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
      return relevantNotifications.filter(n => n.status === 'PENDING');
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
          n.approvalData?.actionType === 'APPROVE_CLIENT'
        );
      });
    }
    return relevantNotifications;
  }, [relevantNotifications, activeFilter]);

  const handleMarkAsRead = async (n: AppNotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await updateNotificationInFirestore({
        ...n,
        status: 'RESOLVED'
      });
    } catch (err) {
      console.warn("Could not mark as read:", err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const pendingItems = relevantNotifications.filter(n => n.status === 'PENDING');
      for (const item of pendingItems) {
        await updateNotificationInFirestore({
          ...item,
          status: 'RESOLVED'
        });
      }
    } catch (err) {
      console.warn("Could not mark all as read:", err);
    }
  };

  const handleDeleteNotification = async (n: AppNotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await deleteNotificationFromFirestore(n.id, (n as any)._docId);
    } catch (err) {
      console.warn("Could not delete notification:", err);
    }
  };

  const handleClearAllNotifications = async () => {
    try {
      await clearAllNotificationsInFirestore();
      setNotifications([]);
    } catch (err) {
      console.warn("Could not clear all notifications:", err);
    }
  };

  const handleDirectNavigate = (n: AppNotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (n.status === 'PENDING') {
      handleMarkAsRead(n);
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
    // 1. Mark non-approval notifications as read on tap (keep approval notifications pending until decision)
    const isApprovalItem =
      n.notificationSubType === 'PAYMENT_APPROVAL' ||
      n.notificationSubType === 'URGENT_PAYABLE_APPROVAL' ||
      n.notificationSubType === 'CLIENT_REGISTRATION_APPROVAL' ||
      n.notificationSubType === 'CASE_APPROVAL' ||
      n.notificationSubType === 'DELETION_APPROVAL' ||
      n.notificationSubType === 'CANCELLATION_APPROVAL' ||
      n.notificationSubType === 'EDIT_APPROVAL' ||
      Boolean(n.approvalData?.actionType);

    if (n.status === 'PENDING' && !isApprovalItem) {
      handleMarkAsRead(n);
    }

    // 2. Always open the Notification Detail & Action Modal so user can inspect full details, approve/reject, or jump to view
    setSelectedNotification(n);
    setIsModalOpen(true);
  };

  const handleQuickApprove = async (n: AppNotification, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await approveActionRequest(n);
      await updateNotificationInFirestore({
        ...n,
        status: 'RESOLVED'
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
        status: 'RESOLVED'
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
      if (selectedNotification.status === 'PENDING') {
        handleMarkAsRead(selectedNotification);
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
    () => filteredNotifications.filter(n => n.status === 'PENDING'),
    [filteredNotifications]
  );

  const earlierNotifications = useMemo(
    () => filteredNotifications.filter(n => n.status !== 'PENDING'),
    [filteredNotifications]
  );

  const renderNotificationRow = (n: AppNotification, idx: number) => {
    const isPending = n.status === 'PENDING';
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
      n.approvalData?.actionType === 'APPROVE_CLIENT';

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
          </div>

          {/* Facebook/Instagram Style Inline Action Buttons */}
          {(isApproval && isPending) || n.targetView || n.targetFilter?.caseNo ? (
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
              {(n.targetView || n.targetFilter?.caseNo) && !(isApproval && isPending) && (
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
              title="Unread notification"
            />
          ) : (
            <span className="w-2.5 h-2.5 shrink-0" />
          )}

          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
            {isPending && (
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
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className={`text-xs font-bold px-2.5 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1 ${
                      isPearl 
                        ? 'text-blue-600 hover:bg-blue-50' 
                        : 'text-blue-400 hover:bg-white/10'
                    }`}
                    title="Mark all as read"
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
    </>
  );
};

export default LiveNotificationCenter;

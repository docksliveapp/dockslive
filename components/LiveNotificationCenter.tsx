import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Bell, X, Check, CheckCircle2, Clock, FileText, DollarSign, 
  Truck, ShieldCheck, ArrowRight, AlertTriangle, Info,
  ExternalLink, CheckCheck
} from 'lucide-react';
import { AppNotification, UserRole } from '../types';
import { subscribeToNotifications, updateNotificationInFirestore } from '../services/dbService';
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

    return notifications.filter(n => {
      // 1. ADMIN & SUPER ADMIN: See all notifications across the system
      if (isAdmin) return true;

      // 2. Specific client or transporter target check
      if (n.targetClientName) {
        const targetClean = n.targetClientName.toLowerCase().trim();
        const userClean = (userIdentifier || '').toLowerCase().trim();
        const clientClean = (clientName || '').toLowerCase().trim();
        if (userClean && (targetClean.includes(userClean) || userClean.includes(targetClean))) return true;
        if (clientClean && (targetClean.includes(clientClean) || clientClean.includes(targetClean))) return true;
      }

      // 3. Extract all target roles declared on the notification
      const declaredTargetRoles = extractTargetRoles(n.targetRole, (n as any).targetRoles);

      // If targeted to ALL roles, or no target specified
      if (declaredTargetRoles.length === 0 || declaredTargetRoles.includes('ALL')) {
        return true;
      }

      // 4. Role-based matching against current role or any assigned roles
      const matchesDirectRole = declaredTargetRoles.some(tr => 
        tr === currentNorm || userRolesNorm.includes(tr)
      );
      if (matchesDirectRole) return true;

      // 5. Special domain routing:
      if (isVehicleManager) {
        if (
          n.category === 'TRANSPORTER' || 
          declaredTargetRoles.some(tr => tr.includes('VEHICLE') || tr.includes('FLEET') || tr.includes('TRANSPORT')) ||
          (n.targetView && (n.targetView.includes('vehicle') || n.targetView.includes('transporter'))) ||
          (n.title && (n.title.includes('Vehicle') || n.title.includes('Renewal') || n.title.includes('Transporter') || n.title.includes('Trailer') || n.title.includes('Fleet')))
        ) return true;
      }

      if (isOperationsManager) {
        if (
          n.category === 'CASE' ||
          declaredTargetRoles.some(tr => tr.includes('OPERATION') || tr.includes('CASE')) ||
          (n.targetView && n.targetView.includes('case'))
        ) return true;
      }

      if (isFinanceManager) {
        if (
          n.category === 'FINANCE' ||
          declaredTargetRoles.some(tr => tr.includes('FINANCE')) ||
          (n.targetView && n.targetView.includes('finance')) ||
          (n.title && (n.title.includes('Finance') || n.title.includes('Invoice') || n.title.includes('Payment') || n.title.includes('Salary') || n.title.includes('Ledger') || n.title.includes('Bill') || n.title.includes('Expense') || n.title.includes('Charges')))
        ) return true;
      }

      if (isCaseManager) {
        if (
          n.category === 'CASE' ||
          declaredTargetRoles.some(tr => tr.includes('CASE') || tr.includes('OPERATION')) ||
          (n.targetView && n.targetView.includes('case')) ||
          (n.title && (n.title.includes('Case') || n.title.includes('Workflow') || n.title.includes('Registration') || n.title.includes('Shipment') || n.title.includes('Transit')))
        ) return true;
      }

      // 6. If client role, hide internal administrative deletion/cancellation approvals
      if (currentNorm === 'CLIENT' || userRolesNorm.includes('CLIENT')) {
        if (
          n.notificationSubType === 'DELETION_APPROVAL' ||
          n.notificationSubType === 'CANCELLATION_APPROVAL' ||
          n.notificationSubType === 'EDIT_APPROVAL'
        ) return false;
      }

      return false;
    });
  }, [notifications, currentRole, currentRoles, clientName, userIdentifier]);

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
        n.notificationSubType === 'CLIENT_REGISTRATION_APPROVAL' ||
        n.notificationSubType === 'CASE_APPROVAL' ||
        n.notificationSubType === 'DELETION_APPROVAL' ||
        n.notificationSubType === 'CANCELLATION_APPROVAL' ||
        n.notificationSubType === 'EDIT_APPROVAL' ||
        n.approvalData?.actionType === 'VERIFY_PAYMENT' ||
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
          n.notificationSubType === 'CLIENT_REGISTRATION_APPROVAL' ||
          n.notificationSubType === 'CASE_APPROVAL' ||
          n.notificationSubType === 'DELETION_APPROVAL' ||
          n.notificationSubType === 'CANCELLATION_APPROVAL' ||
          n.notificationSubType === 'EDIT_APPROVAL' ||
          n.approvalData?.actionType === 'VERIFY_PAYMENT' ||
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

  const handleCardClick = async (n: AppNotification) => {
    // 1. Mark as read on tap
    if (n.status === 'PENDING') {
      handleMarkAsRead(n);
    }

    // 2. Direct 1-tap navigation for cases
    if (n.targetFilter?.caseNo && onNavigateToCase) {
      onNavigateToCase(n.targetFilter.caseNo, n.targetFilter);
      setIsOpen(false);
      return;
    }

    // 3. Direct navigation for tabs
    if (n.targetView && onNavigateToTab) {
      onNavigateToTab(n.targetView);
      setIsOpen(false);
      return;
    }

    // 4. Otherwise open detail modal
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

  const handleNotificationAction = async (action: 'ACCEPT' | 'REJECT' | 'VIEW' | 'MARK_READ') => {
    if (!selectedNotification) return;

    if (action === 'VIEW') {
      if (selectedNotification.targetView && onNavigateToTab) {
        onNavigateToTab(selectedNotification.targetView);
      }
      if (selectedNotification.targetFilter?.caseNo && onNavigateToCase) {
        onNavigateToCase(selectedNotification.targetFilter.caseNo, selectedNotification.targetFilter);
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

  const getNotificationIcon = (subType?: string) => {
    switch (subType) {
      case 'PAYMENT_APPROVAL':
      case 'BUYING':
        return <DollarSign size={16} className="text-emerald-500" />;
      case 'CLIENT_REGISTRATION_APPROVAL':
        return <ShieldCheck size={16} className="text-purple-500" />;
      case 'WORKFLOW_TASK':
      case 'CASE_APPROVAL':
        return <FileText size={16} className="text-amber-500" />;
      case 'FINANCE_RECORDED':
        return <CheckCircle2 size={16} className="text-teal-500" />;
      case 'DELETION_APPROVAL':
      case 'CANCELLATION_APPROVAL':
        return <AlertTriangle size={16} className="text-rose-500" />;
      case 'EDIT_APPROVAL':
        return <Info size={16} className="text-sky-500" />;
      case 'VEHICLE_GATE_PASS':
      case 'TRANSPORTER_ASSIGNED':
        return <Truck size={16} className="text-amber-500" />;
      default:
        return <Bell size={16} className="text-amber-500" />;
    }
  };

  return (
    <>
      {/* Trigger Button with Clean Badge */}
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)} 
        className={buttonClassName ? `${buttonClassName} relative` : "relative h-9 w-9 p-2 rounded-xl text-gray-300 hover:text-white hover:bg-white/10 border border-white/10 transition active:scale-95 shrink-0 flex items-center justify-center cursor-pointer"}
        title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : "Notifications"}
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span 
            className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[10px] font-black rounded-full flex items-center justify-center shadow ring-2 ${
              isPearl ? 'ring-white' : 'ring-slate-900'
            } pointer-events-none z-30`}
            style={{ lineHeight: 1 }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Slide-Over Notification Drawer */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[99990] overflow-hidden" style={{ isolation: 'isolate' }}>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity animate-fade-in"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <div 
            className={`fixed top-0 right-0 bottom-0 z-[99995] w-full sm:w-[420px] max-w-full h-full h-[100dvh] shadow-2xl flex flex-col transform transition-transform duration-300 animate-slide-left ${
              isPearl 
                ? 'bg-white text-slate-900 border-l border-slate-200' 
                : 'bg-slate-950 text-slate-100 border-l border-slate-800'
            }`}
            style={{ isolation: 'isolate' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: Clean, Uncluttered */}
            <div className={`p-4 sm:p-5 border-b flex items-center justify-between shrink-0 ${
              isPearl ? 'border-slate-200 bg-slate-50/50' : 'border-slate-800 bg-slate-900/50'
            }`}>
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  isPearl 
                    ? 'bg-amber-100 text-amber-700 border border-amber-300/60' 
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                }`}>
                  <Bell size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className={`text-base font-bold ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                      Notifications
                    </h3>
                    {unreadCount > 0 && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  <p className={`text-xs ${isPearl ? 'text-slate-500' : 'text-slate-400'}`}>
                    Stay updated with tasks, alerts & shipments
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
                      isPearl 
                        ? 'text-amber-800 hover:bg-amber-100/70' 
                        : 'text-amber-400 hover:bg-white/10'
                    }`}
                    title="Mark all notifications as read"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className={`p-1.5 rounded-lg transition cursor-pointer ${
                    isPearl 
                      ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100' 
                      : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Filter Tabs: Simple, Clean Pills */}
            <div className={`px-4 py-2.5 border-b flex items-center gap-2 shrink-0 select-none ${
              isPearl ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950'
            }`}>
              <button
                type="button"
                onClick={() => setActiveFilter('ALL')}
                className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeFilter === 'ALL'
                    ? (isPearl ? 'bg-amber-500 text-slate-950 font-bold shadow-xs' : 'bg-amber-500 text-slate-950 font-bold shadow-xs')
                    : (isPearl ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-400 hover:text-white hover:bg-white/5')
                }`}
              >
                All ({relevantNotifications.length})
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter('UNREAD')}
                className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeFilter === 'UNREAD'
                    ? (isPearl ? 'bg-amber-500 text-slate-950 font-bold shadow-xs' : 'bg-amber-500 text-slate-950 font-bold shadow-xs')
                    : (isPearl ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-400 hover:text-white hover:bg-white/5')
                }`}
              >
                Unread ({unreadCount})
              </button>

              {pendingApprovalsCount > 0 && currentRole !== UserRole.CLIENT && (
                <button
                  type="button"
                  onClick={() => setActiveFilter('APPROVALS')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    activeFilter === 'APPROVALS'
                      ? (isPearl ? 'bg-amber-500 text-slate-950 font-bold shadow-xs' : 'bg-amber-500 text-slate-950 font-bold shadow-xs')
                      : (isPearl ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-400 hover:text-white hover:bg-white/5')
                  }`}
                >
                  Approvals ({pendingApprovalsCount})
                </button>
              )}
            </div>

            {/* Notifications List */}
            <div className={`flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 custom-scrollbar ${
              isPearl ? 'bg-slate-50/50' : 'bg-slate-950'
            }`}>
              {filteredNotifications.length === 0 ? (
                <div className={`h-full min-h-[300px] flex flex-col items-center justify-center text-center p-6 space-y-3 rounded-2xl border ${
                  isPearl 
                    ? 'border-slate-200 bg-white text-slate-400' 
                    : 'border-slate-800 bg-slate-900/40 text-slate-500'
                }`}>
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
                    isPearl ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-white/5 border-white/5 text-slate-400'
                  }`}>
                    <CheckCircle2 size={24} className="text-emerald-500" />
                  </div>
                  <div>
                    <h4 className={`text-sm font-semibold ${isPearl ? 'text-slate-700' : 'text-slate-200'}`}>
                      All caught up!
                    </h4>
                    <p className={`text-xs mt-1 ${isPearl ? 'text-slate-400' : 'text-slate-400'}`}>
                      {activeFilter === 'UNREAD' 
                        ? 'No unread notifications at the moment.' 
                        : 'No notifications to display right now.'}
                    </p>
                  </div>
                </div>
              ) : (
                filteredNotifications.map((n, idx) => {
                  const isPending = n.status === 'PENDING';

                  const isPaymentApproval = 
                    n.notificationSubType === 'PAYMENT_APPROVAL' ||
                    n.approvalData?.actionType === 'VERIFY_PAYMENT';

                  const isApproval = 
                    isPaymentApproval ||
                    n.notificationSubType === 'CLIENT_REGISTRATION_APPROVAL' ||
                    n.notificationSubType === 'CASE_APPROVAL' ||
                    n.notificationSubType === 'DELETION_APPROVAL' ||
                    n.notificationSubType === 'CANCELLATION_APPROVAL' ||
                    n.notificationSubType === 'EDIT_APPROVAL' ||
                    n.approvalData?.actionType === 'APPROVE_CLIENT';

                  return (
                    <div 
                      key={`live_notif_${n.id || idx}_${idx}`}
                      onClick={() => handleCardClick(n)}
                      className={`p-3 sm:p-3.5 rounded-xl border transition-all cursor-pointer group space-y-2 relative shadow-xs ${
                        isPearl
                          ? isPending
                            ? 'bg-white border-amber-300/80 hover:border-amber-400 shadow-sm'
                            : 'bg-white/80 border-slate-200 hover:border-slate-300 opacity-80 hover:opacity-100'
                          : isPending
                            ? 'bg-slate-900 border-amber-500/30 hover:border-amber-400/50 shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 opacity-75 hover:opacity-100'
                      }`}
                    >
                      {/* Top Header Row */}
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          {/* Clean Icon Box */}
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border mt-0.5 ${
                            isPearl
                              ? 'bg-slate-100 border-slate-200'
                              : 'bg-white/5 border-white/10'
                          }`}>
                            {getNotificationIcon(n.notificationSubType)}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {isPending && (
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                              )}
                              <h4 className={`text-xs sm:text-sm font-semibold truncate transition ${
                                isPearl 
                                  ? 'text-slate-900 group-hover:text-amber-800' 
                                  : 'text-slate-100 group-hover:text-amber-300'
                              }`}>
                                {n.title}
                              </h4>
                            </div>
                            <span className={`text-[11px] block mt-0.5 font-mono ${
                              isPearl ? 'text-slate-400' : 'text-slate-500'
                            }`}>
                              {n.timestamp || 'Recent'}
                            </span>
                          </div>
                        </div>

                        {/* Status / Quick Read Check */}
                        <div className="flex items-center gap-1 shrink-0">
                          {isPending ? (
                            <button
                              type="button"
                              onClick={(e) => handleMarkAsRead(n, e)}
                              className={`text-xs p-1 rounded-md transition cursor-pointer ${
                                isPearl 
                                  ? 'text-slate-400 hover:text-emerald-600 hover:bg-slate-100' 
                                  : 'text-slate-400 hover:text-emerald-400 hover:bg-white/10'
                              }`}
                              title="Mark as Read"
                            >
                              <Check size={14} />
                            </button>
                          ) : (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              isPearl ? 'text-slate-400 bg-slate-100' : 'text-slate-500 bg-white/5'
                            }`}>
                              Read
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Clean Message Body */}
                      <p className={`text-xs line-clamp-2 leading-relaxed ${
                        isPearl ? 'text-slate-600' : 'text-slate-300'
                      }`}>
                        {n.description}
                      </p>

                      {/* Action Row */}
                      {(isApproval && isPending) || (n.targetFilter?.caseNo && onNavigateToCase) || (onNavigateToTab && n.targetView === 'finance') ? (
                        <div className={`flex items-center justify-between gap-2 pt-2 border-t ${
                          isPearl ? 'border-slate-100' : 'border-white/5'
                        }`}>
                          {isApproval && isPending ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => handleQuickApprove(n, e)}
                                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition shadow-xs active:scale-95 cursor-pointer"
                              >
                                <Check size={13} />
                                <span>{isPaymentApproval ? 'Verify' : 'Approve'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleQuickReject(n, e)}
                                className={`px-2.5 py-1 rounded-lg border font-semibold text-xs flex items-center gap-1 transition active:scale-95 cursor-pointer ${
                                  isPearl 
                                    ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100' 
                                    : 'bg-rose-500/15 border-rose-500/30 text-rose-300 hover:bg-rose-500/25'
                                }`}
                              >
                                <X size={13} />
                                <span>Reject</span>
                              </button>
                            </div>
                          ) : (n.targetFilter?.caseNo && onNavigateToCase) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onNavigateToCase(n.targetFilter.caseNo, n.targetFilter);
                                setIsOpen(false);
                              }}
                              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <span>Open Case</span>
                              <ExternalLink size={12} />
                            </button>
                          ) : onNavigateToTab && n.targetView === 'finance' ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onNavigateToTab('finance');
                                setIsOpen(false);
                              }}
                              className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <span>View Finance</span>
                              <ExternalLink size={12} />
                            </button>
                          ) : null}

                          <span className={`text-[11px] font-medium flex items-center gap-1 ml-auto ${
                            isPearl ? 'text-amber-700' : 'text-amber-400'
                          }`}>
                            <span>Details</span>
                            <ArrowRight size={11} />
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Summary: Clean & Minimal */}
            <div className={`p-3 px-4 border-t text-xs flex items-center justify-between shrink-0 ${
              isPearl 
                ? 'border-slate-200 bg-slate-50 text-slate-500' 
                : 'border-slate-800 bg-slate-900/50 text-slate-400'
            }`}>
              <span>Role: <strong className={isPearl ? 'text-slate-800 capitalize' : 'text-white capitalize'}>{String(currentRole).replace(/_/g, ' ')}</strong></span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Live Cloud Sync
              </span>
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

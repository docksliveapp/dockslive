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

  const getNotificationIcon = (n: AppNotification) => {
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
      return <Truck size={18} className="text-amber-500" />;
    }

    switch (subType) {
      case 'PAYMENT_APPROVAL':
      case 'BUYING':
        return <DollarSign size={18} className="text-emerald-500" />;
      case 'CLIENT_REGISTRATION_APPROVAL':
        return <ShieldCheck size={18} className="text-purple-500" />;
      case 'WORKFLOW_TASK':
      case 'CASE_APPROVAL':
        return <FileText size={18} className="text-sky-500" />;
      case 'FINANCE_RECORDED':
        return <CheckCircle2 size={18} className="text-teal-500" />;
      case 'DELETION_APPROVAL':
      case 'CANCELLATION_APPROVAL':
        return <AlertTriangle size={18} className="text-rose-500" />;
      case 'EDIT_APPROVAL':
        return <Info size={18} className="text-sky-500" />;
      default:
        return <Bell size={18} className="text-amber-500" />;
    }
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

      {/* Clean, Spacious Notification Center Dialog */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[99990] flex items-center justify-center p-3 sm:p-6 bg-black/65 backdrop-blur-xs animate-fade-in"
          style={{ isolation: 'isolate' }}
          onClick={() => setIsOpen(false)}
        >
          <div 
            className={`w-full max-w-2xl max-h-[86vh] rounded-3xl shadow-2xl border flex flex-col overflow-hidden transition-colors duration-200 ${
              isPearl 
                ? 'bg-white text-slate-900 border-slate-200' 
                : 'bg-slate-900 text-slate-100 border-slate-700/80'
            }`}
            style={{ isolation: 'isolate' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Clean Header */}
            <div className={`px-5 py-4 border-b flex items-center justify-between shrink-0 ${
              isPearl ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  isPearl 
                    ? 'bg-amber-100 text-amber-700 border border-amber-300/60' 
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                }`}>
                  <Bell size={20} />
                </div>
                <div className="flex items-center gap-2.5">
                  <h3 className={`text-base sm:text-lg font-bold ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                    Notifications
                  </h3>
                  {unreadCount > 0 && (
                    <span 
                      style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                      className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                    >
                      {unreadCount} New
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition cursor-pointer flex items-center gap-1.5 ${
                      isPearl 
                        ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100' 
                        : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <CheckCheck size={14} className="text-emerald-500" />
                    <span>Mark all read</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className={`p-2 rounded-xl transition cursor-pointer ${
                    isPearl 
                      ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/70' 
                      : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Simple Filter Tabs */}
            <div className={`px-5 py-3 border-b flex items-center gap-2 shrink-0 select-none ${
              isPearl ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900'
            }`}>
              <button
                type="button"
                onClick={() => setActiveFilter('ALL')}
                className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeFilter === 'ALL'
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : (isPearl ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10')
                }`}
              >
                All ({relevantNotifications.length})
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter('UNREAD')}
                className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeFilter === 'UNREAD'
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : (isPearl ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10')
                }`}
              >
                Unread ({unreadCount})
              </button>

              {currentRole !== UserRole.CLIENT && (
                <button
                  type="button"
                  onClick={() => setActiveFilter('APPROVALS')}
                  className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
                    activeFilter === 'APPROVALS'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : (isPearl ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10')
                  }`}
                >
                  Approvals ({pendingApprovalsCount})
                </button>
              )}
            </div>

            {/* Spacious, Uncluttered Notifications List */}
            <div className={`flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 custom-scrollbar ${
              isPearl ? 'bg-slate-50/70' : 'bg-slate-950/60'
            }`}>
              {filteredNotifications.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-center px-4">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border mb-3 ${
                    isPearl ? 'bg-white border-slate-200' : 'bg-white/5 border-white/10'
                  }`}>
                    <CheckCircle2 size={26} className="text-emerald-500" />
                  </div>
                  <h4 className={`text-sm font-bold ${isPearl ? 'text-slate-800' : 'text-slate-200'}`}>
                    No notifications
                  </h4>
                  <p className={`text-xs mt-1 ${isPearl ? 'text-slate-500' : 'text-slate-400'}`}>
                    {activeFilter === 'UNREAD' 
                      ? 'You have no unread notifications.' 
                      : 'Nothing to show right now.'}
                  </p>
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
                      className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                        isPearl
                          ? isPending
                            ? 'bg-white border-amber-300 shadow-xs hover:border-amber-400'
                            : 'bg-white/80 border-slate-200 hover:bg-white opacity-80'
                          : isPending
                            ? 'bg-slate-900 border-amber-500/35 hover:border-amber-400/60'
                            : 'bg-slate-900/50 border-white/10 hover:bg-slate-900 opacity-75'
                      }`}
                    >
                      <div className="flex items-start gap-3.5">
                        {/* Icon */}
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border mt-0.5 ${
                          isPearl
                            ? 'bg-slate-50 border-slate-200'
                            : 'bg-white/5 border-white/10'
                        }`}>
                          {getNotificationIcon(n)}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              {isPending && (
                                <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                              )}
                              <h4 className={`text-sm font-bold leading-snug ${
                                isPearl ? 'text-slate-900' : 'text-white'
                              }`}>
                                {n.title}
                              </h4>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-[11px] whitespace-nowrap ${
                                isPearl ? 'text-slate-500' : 'text-slate-400'
                              }`}>
                                {n.timestamp || 'Recent'}
                              </span>
                              {isPending && (
                                <button
                                  type="button"
                                  onClick={(e) => handleMarkAsRead(n, e)}
                                  className={`p-1 rounded-lg transition cursor-pointer ${
                                    isPearl 
                                      ? 'text-slate-400 hover:text-emerald-600 hover:bg-slate-100' 
                                      : 'text-slate-400 hover:text-emerald-400 hover:bg-white/10'
                                  }`}
                                  title="Mark as Read"
                                >
                                  <Check size={15} />
                                </button>
                              )}
                            </div>
                          </div>

                          {n.description && (
                            <p className={`text-xs mt-1 leading-relaxed line-clamp-2 ${
                              isPearl ? 'text-slate-600' : 'text-slate-300'
                            }`}>
                              {n.description}
                            </p>
                          )}

                          {/* Action Buttons Only When Needed */}
                          {((isApproval && isPending) || n.targetFilter?.caseNo) && (
                            <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-slate-200/60 dark:border-white/10 flex-wrap">
                              {n.targetFilter?.caseNo ? (
                                <span className={`text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-lg border ${
                                  isPearl ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-white/5 text-slate-300 border-white/10'
                                }`}>
                                  Case: {n.targetFilter.caseNo}
                                </span>
                              ) : <span />}

                              {isApproval && isPending ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickApprove(n, e)}
                                    style={{ backgroundColor: '#059669', color: '#ffffff' }}
                                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                                  >
                                    <Check size={13} />
                                    <span>{isPaymentApproval ? 'Verify' : 'Approve'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickReject(n, e)}
                                    style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                                    className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                                  >
                                    <X size={13} />
                                    <span>Reject</span>
                                  </button>
                                </div>
                              ) : (
                                <span className={`text-xs font-semibold flex items-center gap-1 ${
                                  isPearl ? 'text-amber-700' : 'text-amber-400'
                                }`}>
                                  <span>Open</span>
                                  <ArrowRight size={12} />
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
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

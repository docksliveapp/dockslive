import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Bell, X, Check, CheckCircle2, Clock, FileText, DollarSign, 
  Truck, ShieldAlert, ArrowRight, Filter, AlertTriangle, Info,
  Sparkles, ExternalLink
} from 'lucide-react';
import { AppNotification, UserRole } from '../types';
import { subscribeToNotifications, saveNotificationToFirestore, updateNotificationInFirestore } from '../services/dbService';
import NotificationModal from './NotificationModal';
import { approveActionRequest, rejectActionRequest } from '../services/approvalService';

interface LiveNotificationCenterProps {
  currentRole: UserRole | string;
  currentRoles?: (UserRole | string)[];
  userIdentifier?: string;
  clientName?: string;
  onNavigateToCase?: (caseNoOrId: string) => void;
  onNavigateToTab?: (tabName: string) => void;
  buttonClassName?: string;
  showBadgeOnly?: boolean;
}

export const LiveNotificationCenter: React.FC<LiveNotificationCenterProps> = ({
  currentRole,
  currentRoles = [],
  userIdentifier = '',
  clientName = '',
  onNavigateToCase,
  onNavigateToTab,
  buttonClassName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<AppNotification | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'WORKFLOW' | 'FINANCE' | 'APPROVAL'>('ALL');

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

    return notifications.filter(n => {
      // 1. ADMIN & SUPER ADMIN: Must receive and see ALL activities & notifications across the system!
      if (isAdmin) {
        return true;
      }

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
      if (matchesDirectRole) {
        return true;
      }

      // 5. Special domain routing:
      // If notification is for fleet/transporters/renewals, Vehicle Manager MUST see it
      if (isVehicleManager) {
        if (
          n.category === 'TRANSPORTER' || 
          declaredTargetRoles.some(tr => tr.includes('VEHICLE') || tr.includes('FLEET') || tr.includes('TRANSPORT')) ||
          (n.targetView && (n.targetView.includes('vehicle') || n.targetView.includes('transporter'))) ||
          (n.title && (n.title.includes('Vehicle') || n.title.includes('Renewal') || n.title.includes('Transporter') || n.title.includes('Trailer') || n.title.includes('Fleet')))
        ) {
          return true;
        }
      }

      // Operations Manager handles case workflow approvals, driver confirmations, assignments
      if (isOperationsManager) {
        if (
          n.category === 'CASE' ||
          declaredTargetRoles.some(tr => tr.includes('OPERATION') || tr.includes('CASE')) ||
          (n.targetView && n.targetView.includes('case'))
        ) {
          return true;
        }
      }

      // 6. If client role, hide internal approvals
      if (currentNorm === 'CLIENT' || userRolesNorm.includes('CLIENT')) {
        if (
          n.notificationSubType === 'DELETION_APPROVAL' ||
          n.notificationSubType === 'CANCELLATION_APPROVAL' ||
          n.notificationSubType === 'EDIT_APPROVAL'
        ) {
          return false;
        }
      }

      return false;
    });
  }, [notifications, currentRole, currentRoles, clientName, userIdentifier]);

  // Tab filtering
  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'ALL') return relevantNotifications;
    if (activeFilter === 'WORKFLOW') {
      return relevantNotifications.filter(n => 
        n.notificationSubType === 'CASE_APPROVAL' || 
        (n.targetView && n.targetView.includes('case')) ||
        (n.title && (n.title.includes('Case') || n.title.includes('Workflow') || n.title.includes('Shipment')))
      );
    }
    if (activeFilter === 'FINANCE') {
      return relevantNotifications.filter(n => 
        n.notificationSubType === 'BUYING' || 
        (n.targetView && n.targetView.includes('finance')) ||
        (n.title && (n.title.includes('Invoice') || n.title.includes('Payment') || n.title.includes('Bill') || n.title.includes('Tariff')))
      );
    }
    if (activeFilter === 'APPROVAL') {
      return relevantNotifications.filter(n => 
        n.notificationSubType === 'CASE_APPROVAL' ||
        n.notificationSubType === 'DELETION_APPROVAL' ||
        n.notificationSubType === 'CANCELLATION_APPROVAL' ||
        n.notificationSubType === 'EDIT_APPROVAL'
      );
    }
    return relevantNotifications;
  }, [relevantNotifications, activeFilter]);

  const unreadCount = useMemo(() => {
    return relevantNotifications.filter(n => n.status === 'PENDING').length;
  }, [relevantNotifications]);

  const handleOpenNotification = (n: AppNotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (n.status === 'PENDING') {
      handleMarkAsRead(n);
    }
    setSelectedNotification(n);
    setIsModalOpen(true);
  };

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

  const handleCardClick = async (n: AppNotification) => {
    // Instant live mark-as-read on tap like Facebook / Instagram
    if (n.status === 'PENDING') {
      handleMarkAsRead(n);
    }

    // Always open the notification detail & action modal
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

  const handleNotificationAction = async (action: 'ACCEPT' | 'REJECT' | 'VIEW' | 'MARK_READ') => {
    if (!selectedNotification) return;

    if (action === 'VIEW') {
      if (selectedNotification.targetView && onNavigateToTab) {
        onNavigateToTab(selectedNotification.targetView);
      }
      if (selectedNotification.targetFilter?.caseNo && onNavigateToCase) {
        onNavigateToCase(selectedNotification.targetFilter.caseNo);
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

  const getBadgeIcon = (subType?: string) => {
    switch (subType) {
      case 'DELETION_APPROVAL':
        return <AlertTriangle size={15} className="text-red-400" />;
      case 'CANCELLATION_APPROVAL':
        return <AlertTriangle size={15} className="text-amber-400" />;
      case 'EDIT_APPROVAL':
        return <Info size={15} className="text-cyan-400" />;
      case 'CASE_APPROVAL':
        return <FileText size={15} className="text-blue-400" />;
      case 'BUYING':
        return <DollarSign size={15} className="text-emerald-400" />;
      default:
        return <Bell size={15} className="text-amber-400" />;
    }
  };

  return (
    <>
      {/* Trigger Button with Live Pulsing Badge */}
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)} 
        className={buttonClassName || "relative p-2 rounded-xl text-gray-300 hover:text-white hover:bg-white/10 border border-white/10 transition active:scale-95"}
        title="Live Notification & Action Center"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-slate-900 shadow-lg animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Slide-Over Notification Drawer (Rendered via createPortal to body to prevent any overflow or stacking bleed) */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[99990] overflow-hidden" style={{ isolation: 'isolate' }}>
          {/* Backdrop overlay (separate div, does not wrap drawer, so backdrop-filter never bleeds into drawer content) */}
          <div 
            className="fixed inset-0 bg-black/80 transition-opacity animate-fade-in"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Panel: 100% Solid Opaque Background (#020617), high z-index, zero bleed-through */}
          <div 
            className="fixed top-0 right-0 bottom-0 z-[99995] w-full sm:w-[450px] max-w-full h-full h-[100dvh] bg-[#020617] border-l border-slate-800 shadow-2xl flex flex-col transform transition-transform duration-300 animate-slide-left text-gray-100"
            style={{ backgroundColor: '#020617', opacity: 1, isolation: 'isolate' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div 
              className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between shrink-0"
              style={{ backgroundColor: '#020617' }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                  <Bell size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                    <span>Live Notification Center</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  </h3>
                  <p className="text-[10px] text-gray-400">
                    Real-time operational alerts, tasks & invoices
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold px-2 py-1 rounded hover:bg-white/5 transition"
                    title="Mark all notifications as read"
                  >
                    Mark Read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Filter Tabs - Compact Grid Layout with Zero Left/Right Scrolling */}
            <div 
              className="p-2.5 border-b border-slate-800 grid grid-cols-4 gap-1.5 shrink-0 select-none"
              style={{ backgroundColor: '#020617' }}
            >
              <button
                type="button"
                onClick={() => setActiveFilter('ALL')}
                className={`py-1.5 px-1 rounded-xl text-center font-bold text-[10px] sm:text-xs transition truncate ${
                  activeFilter === 'ALL'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                All ({relevantNotifications.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('WORKFLOW')}
                className={`py-1.5 px-1 rounded-xl text-center font-bold text-[10px] sm:text-xs transition truncate ${
                  activeFilter === 'WORKFLOW'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Workflow
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('FINANCE')}
                className={`py-1.5 px-1 rounded-xl text-center font-bold text-[10px] sm:text-xs transition truncate ${
                  activeFilter === 'FINANCE'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Finance
              </button>
              {currentRole !== UserRole.CLIENT ? (
                <button
                  type="button"
                  onClick={() => setActiveFilter('APPROVAL')}
                  className={`py-1.5 px-1 rounded-xl text-center font-bold text-[10px] sm:text-xs transition truncate ${
                    activeFilter === 'APPROVAL'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Approvals
                </button>
              ) : (
                <div />
              )}
            </div>

            {/* Notifications List */}
            <div 
              className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 custom-scrollbar overflow-x-hidden"
              style={{ backgroundColor: '#020617' }}
            >
              {filteredNotifications.length === 0 ? (
                <div 
                  className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-500 space-y-3 rounded-2xl border border-slate-800"
                  style={{ backgroundColor: '#080e1a' }}
                >
                  <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-gray-400 border border-white/5">
                    <CheckCircle2 size={28} className="text-emerald-400/80" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-200">All caught up!</h4>
                    <p className="text-[11px] text-gray-400 max-w-[240px] mt-1 leading-relaxed">
                      No pending notifications or approval requests for {String(currentRole).replace(/_/g, ' ')}.
                    </p>
                  </div>
                </div>
              ) : (
                filteredNotifications.map((n, idx) => {
                  const isPending = n.status === 'PENDING';
                  const isApproval = 
                    n.notificationSubType === 'CASE_APPROVAL' ||
                    n.notificationSubType === 'DELETION_APPROVAL' ||
                    n.notificationSubType === 'CANCELLATION_APPROVAL' ||
                    n.notificationSubType === 'EDIT_APPROVAL' ||
                    n.notificationSubType === 'BUYING';

                  return (
                    <div 
                      key={`live_notif_${n.id || idx}_${idx}`}
                      onClick={() => handleCardClick(n)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer group space-y-2.5 relative select-none ${
                        isPending
                          ? 'bg-slate-900 border-amber-500/50 hover:border-amber-400 shadow-lg shadow-amber-500/5 border-l-4 border-l-amber-400'
                          : 'bg-slate-900/60 border-white/10 hover:border-white/20 opacity-85 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: isPending ? '#0f172a' : '#0c1322' }}
                    >
                      {/* Top Row: Icon, Title, Unread Pulse Dot, Timestamp */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                            isPending 
                              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' 
                              : 'bg-white/5 text-gray-400 border-white/10'
                          }`}>
                            {getBadgeIcon(n.notificationSubType)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs font-bold text-white group-hover:text-amber-300 transition truncate">
                                {n.title}
                              </h4>
                              {isPending && (
                                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping shrink-0" title="Unread" />
                              )}
                            </div>
                            <span className="text-[10px] text-amber-400/90 font-mono uppercase font-semibold">
                              {n.notificationSubType?.replace(/_/g, ' ') || 'SYSTEM ALERT'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-gray-400 font-mono">
                            {n.timestamp || 'Just now'}
                          </span>
                          {isPending && (
                            <button
                              type="button"
                              onClick={(e) => handleMarkAsRead(n, e)}
                              className="text-gray-400 hover:text-emerald-400 p-1 rounded-md hover:bg-white/10 transition"
                              title="Mark as Read"
                            >
                              <Check size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-[11px] text-gray-300 line-clamp-2 leading-relaxed">
                        {n.description}
                      </p>

                      {/* Action Bar (One-Tap Actionable like Facebook / Instagram) */}
                      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-white/10 text-xs">
                        {/* If Approval/Buying: Direct 1-tap Approve & Reject buttons */}
                        {isApproval ? (
                          <div className="flex items-center gap-1.5 w-full sm:w-auto">
                            <button
                              type="button"
                              onClick={(e) => handleQuickApprove(n, e)}
                              className="flex-1 sm:flex-none px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center justify-center gap-1 transition shadow shadow-emerald-600/20 active:scale-95"
                            >
                              <Check size={12} />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleQuickReject(n, e)}
                              className="flex-1 sm:flex-none px-2 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 font-bold text-[11px] flex items-center justify-center gap-1 transition active:scale-95"
                            >
                              <X size={12} />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : n.targetView ? (
                          <div className="flex items-center gap-1">
                            <span className="text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                              <span>Open in {n.targetView.toUpperCase()}</span>
                              <ExternalLink size={11} />
                            </span>
                          </div>
                        ) : (
                          <div />
                        )}

                        {/* Details Modal Trigger Button */}
                        <button
                          type="button"
                          onClick={(e) => handleOpenNotification(n, e)}
                          className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-amber-300 hover:text-white text-[11px] font-semibold flex items-center gap-1 transition ml-auto"
                        >
                          <span>Full Details</span>
                          <ArrowRight size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Summary */}
            <div 
              className="p-3 border-t border-slate-800 text-[11px] text-gray-400 flex items-center justify-between shrink-0"
              style={{ backgroundColor: '#020617' }}
            >
              <span>Workspace: <strong className="text-white capitalize">{String(currentRole).replace(/_/g, ' ')}</strong></span>
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
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

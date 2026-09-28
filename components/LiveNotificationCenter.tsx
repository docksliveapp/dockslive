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

  // Filter notifications relevant to current role & user
  const relevantNotifications = useMemo(() => {
    return notifications.filter(n => {
      // 1. ADMIN & SUPER ADMIN: Must receive and see ALL activities & notifications across the system!
      const isAdmin = 
        currentRole === UserRole.ADMIN || 
        currentRole === UserRole.SUPER_ADMIN || 
        String(currentRole).toUpperCase() === 'ADMIN' || 
        String(currentRole).toUpperCase() === 'SUPER_ADMIN' ||
        currentRoles.some(r => String(r).toUpperCase() === 'ADMIN' || String(r).toUpperCase() === 'SUPER_ADMIN');

      if (isAdmin) {
        return true;
      }

      // 2. Specific client or transporter target check
      if (n.targetClientName) {
        const targetClean = n.targetClientName.toLowerCase().trim();
        if (userIdentifier && targetClean === userIdentifier.toLowerCase().trim()) return true;
        if (clientName && targetClean === clientName.toLowerCase().trim()) return true;
      }

      // 3. If targeted to ALL roles
      if (!n.targetRole || n.targetRole === 'ALL' || n.targetRole === 'all') {
        return true;
      }

      // 4. Role-based matching (case-insensitive for safety)
      const targetRoleStr = String(n.targetRole).toLowerCase();
      const currentRoleStr = String(currentRole).toLowerCase();
      if (targetRoleStr === currentRoleStr) {
        return true;
      }
      if (currentRoles.some(r => String(r).toLowerCase() === targetRoleStr)) {
        return true;
      }

      // 5. If client role, hide internal approvals
      if (currentRole === UserRole.CLIENT || String(currentRole).toUpperCase() === 'CLIENT') {
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

  const handleOpenNotification = (n: AppNotification) => {
    setSelectedNotification(n);
    setIsModalOpen(true);
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

  const handleNotificationAction = async (action: 'ACCEPT' | 'REJECT' | 'VIEW') => {
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
      } catch (err) {
        console.error("Failed to approve action request:", err);
      }
      setIsModalOpen(false);
    } else if (action === 'REJECT') {
      try {
        await rejectActionRequest(selectedNotification);
      } catch (err) {
        console.error("Failed to reject action request:", err);
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
        <div 
          className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md animate-fade-in flex justify-end"
          onClick={() => setIsOpen(false)}
        >
          <div 
            className="w-full sm:w-[440px] max-w-full h-full bg-slate-950 border-l border-white/10 shadow-2xl flex flex-col transform transition-transform duration-300 animate-slide-left text-gray-100 z-[100000]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-slate-950 shrink-0">
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

            {/* Filter Tabs */}
            <div className="p-3 border-b border-white/10 bg-slate-950 flex items-center gap-1.5 overflow-x-auto text-[11px] custom-scrollbar shrink-0">
              <button
                type="button"
                onClick={() => setActiveFilter('ALL')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
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
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  activeFilter === 'WORKFLOW'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Workflows
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('FINANCE')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  activeFilter === 'FINANCE'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Finance & Invoices
              </button>
              {currentRole !== UserRole.CLIENT && (
                <button
                  type="button"
                  onClick={() => setActiveFilter('APPROVAL')}
                  className={`px-3 py-1 rounded-lg font-semibold transition ${
                    activeFilter === 'APPROVAL'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Approvals
                </button>
              )}
            </div>

            {/* Notifications List */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 custom-scrollbar bg-slate-950">
              {filteredNotifications.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-500 space-y-3 bg-slate-950 rounded-2xl">
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
                filteredNotifications.map((n) => (
                  <div 
                    key={n.id}
                    onClick={() => handleOpenNotification(n)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer group space-y-2 ${
                      n.status === 'PENDING'
                        ? 'bg-slate-900 border-amber-500/40 hover:border-amber-400 shadow-md hover:shadow-amber-500/10'
                        : 'bg-slate-900/90 border-white/10 hover:border-white/20 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 border border-amber-500/20">
                          {getBadgeIcon(n.notificationSubType)}
                        </div>
                        <h4 className="text-xs font-bold text-white group-hover:text-amber-300 transition truncate">
                          {n.title}
                        </h4>
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono shrink-0">
                        {n.timestamp || 'Just now'}
                      </span>
                    </div>

                    <p className="text-[11px] text-gray-300 line-clamp-2 leading-relaxed">
                      {n.description}
                    </p>

                    <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px]">
                      <span className="text-amber-400 font-mono uppercase font-semibold">
                        {n.notificationSubType?.replace(/_/g, ' ') || 'SYSTEM ALERT'}
                      </span>
                      <span className="text-amber-400 font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                        <span>Details</span>
                        <ArrowRight size={11} />
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer Summary */}
            <div className="p-3 border-t border-white/10 bg-slate-950 text-[11px] text-gray-400 flex items-center justify-between shrink-0">
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

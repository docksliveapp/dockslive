import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Check, XCircle, FileText, DollarSign, Info, Trash2, 
  AlertTriangle, Edit, ShieldAlert, ExternalLink, CheckCheck, 
  Clock, ArrowRight, ShieldCheck, Truck, Warehouse, CheckCircle2
} from 'lucide-react';
import { AppNotification } from '../types';

interface NotificationModalProps {
  notification: AppNotification | null;
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: 'ACCEPT' | 'REJECT' | 'VIEW' | 'MARK_READ') => void;
}

const NotificationModal: React.FC<NotificationModalProps> = ({ 
  notification, 
  isOpen, 
  onClose, 
  onAction 
}) => {
  const [enlargedSlip, setEnlargedSlip] = useState(false);
  if (!isOpen || !notification) return null;

  const isMonthlyExpense = 
    notification.notificationSubType === 'FINANCE_RECORDED' ||
    notification.description?.toLowerCase().includes('monthly salary') ||
    notification.description?.toLowerCase().includes('fixed expense') ||
    notification.title?.toLowerCase().includes('monthly salary') ||
    notification.title?.toLowerCase().includes('monthly fixed');

  const isPaymentApproval = 
    notification.notificationSubType === 'PAYMENT_APPROVAL' ||
    notification.approvalData?.actionType === 'VERIFY_PAYMENT';

  const isApprovalAction = 
    !isMonthlyExpense && (
      isPaymentApproval ||
      notification.notificationSubType === 'CLIENT_REGISTRATION_APPROVAL' ||
      notification.notificationSubType === 'CASE_APPROVAL' ||
      notification.notificationSubType === 'DELETION_APPROVAL' ||
      notification.notificationSubType === 'CANCELLATION_APPROVAL' ||
      notification.notificationSubType === 'EDIT_APPROVAL' ||
      notification.approvalData?.actionType === 'APPROVE_CLIENT'
    );

  const getIcon = () => {
    switch (notification.notificationSubType as string) {
      case 'PAYMENT_APPROVAL':
        return <DollarSign size={28} className="text-emerald-400" />;
      case 'CLIENT_REGISTRATION_APPROVAL':
        return <ShieldCheck size={28} className="text-purple-400" />;
      case 'WORKFLOW_TASK':
        return <FileText size={28} className="text-amber-400" />;
      case 'FINANCE_RECORDED':
        return <CheckCircle2 size={28} className="text-teal-400" />;
      case 'DELETION_APPROVAL':
        return <Trash2 size={28} className="text-red-400" />;
      case 'CANCELLATION_APPROVAL':
        return <AlertTriangle size={28} className="text-amber-400" />;
      case 'EDIT_APPROVAL':
        return <Edit size={28} className="text-cyan-400" />;
      case 'CASE_APPROVAL':
        return <FileText size={28} className="text-blue-400" />;
      case 'BUYING':
        return <DollarSign size={28} className="text-emerald-400" />;
      case 'VEHICLE_GATE_PASS':
      case 'TRANSPORTER_ASSIGNED':
        return <Truck size={28} className="text-amber-400" />;
      case 'WAREHOUSE_ENTRY':
        return <Warehouse size={28} className="text-indigo-400" />;
      default:
        return <Info size={28} className="text-sky-400" />;
    }
  };

  const getHeaderBadge = () => {
    if (isMonthlyExpense) {
      return { label: 'Monthly Fixed Expense (Auto-Recorded)', bg: 'bg-teal-500/20 text-teal-300 border-teal-500/30' };
    }
    switch (notification.notificationSubType as string) {
      case 'PAYMENT_APPROVAL':
        return { label: 'Payment Receipt Verification Required', bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
      case 'CLIENT_REGISTRATION_APPROVAL':
        return { label: 'Client Registration Approval', bg: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
      case 'WORKFLOW_TASK':
        return { label: 'Workflow Action Required', bg: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
      case 'FINANCE_RECORDED':
        return { label: 'Monthly Fixed Expense (Auto-Recorded)', bg: 'bg-teal-500/20 text-teal-300 border-teal-500/30' };
      case 'DELETION_APPROVAL':
        return { label: 'Deletion Request', bg: 'bg-red-500/20 text-red-300 border-red-500/30' };
      case 'CANCELLATION_APPROVAL':
        return { label: 'Cancellation Request', bg: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
      case 'EDIT_APPROVAL':
        return { label: 'Edit Authorization', bg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' };
      case 'CASE_APPROVAL':
        return { label: 'Case Approval', bg: 'bg-blue-500/20 text-blue-300 border-blue-500/30' };
      case 'BUYING':
        return { label: 'Finance Record', bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
      default:
        return { label: notification.notificationSubType?.replace(/_/g, ' ') || 'SYSTEM ALERT', bg: 'bg-sky-500/20 text-sky-300 border-sky-500/30' };
    }
  };

  const badgeInfo = getHeaderBadge();
  const approval = notification.approvalData;
  const isPending = notification.status === 'PENDING';

  const modalContent = (
    <div 
      className="fixed inset-0 z-[100060] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-fade-in"
      style={{ isolation: 'isolate' }}
      onClick={onClose}
    >
      <div 
        className="bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden transform transition-all flex flex-col max-h-[92vh] select-none"
        style={{ backgroundColor: '#0f172a' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top App-like Header (Facebook / Instagram Style) */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-start justify-between gap-3 bg-slate-950/60">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 shadow-inner">
              {getIcon()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeInfo.bg}`}>
                  {badgeInfo.label}
                </span>
                {isPending ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Pending Action
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <CheckCheck size={11} />
                    Resolved
                  </span>
                )}
              </div>
              <h3 className="text-sm sm:text-base font-bold text-white leading-snug break-words">
                {notification.title}
              </h3>
              <p className="text-gray-400 text-[11px] flex items-center gap-1 mt-0.5 font-mono">
                <Clock size={11} className="text-gray-400" />
                {notification.timestamp || 'Just now'}
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white hover:bg-white/10 p-2 rounded-xl transition-colors shrink-0"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
          {/* Main Description Card */}
          <div className="bg-slate-950/70 rounded-2xl p-4 border border-white/10 space-y-1.5">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert size={14} className="text-amber-400" />
              Notification Message
            </h4>
            <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap break-words">
              {notification.description || 'No description provided.'}
            </p>
          </div>

          {/* Structured Approval Context if present */}
          {approval && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                <span className="text-[11px] text-gray-400 block font-medium">Target Entity</span>
                <span className="text-sm font-bold text-white font-mono mt-0.5 block truncate">
                  {approval.entityName || `${approval.entityType.toUpperCase()} #${approval.entityId}`}
                </span>
                <span className="text-[10px] text-brand-400 uppercase font-semibold">
                  {approval.entityType}
                </span>
              </div>

              <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                <span className="text-[11px] text-gray-400 block font-medium">Action Requested</span>
                <span className={`text-sm font-bold mt-0.5 block ${
                  approval.actionType === 'DELETE' ? 'text-red-400' :
                  approval.actionType === 'CANCEL' ? 'text-amber-400' : 'text-cyan-400'
                }`}>
                  {approval.actionType}
                </span>
                <span className="text-[10px] text-gray-400 truncate block">
                  By {approval.requestedBy || 'Staff Member'}
                </span>
              </div>

              {approval.reason && (
                <div className="col-span-2 bg-amber-500/10 border border-amber-500/20 p-3 rounded-2xl">
                  <span className="text-[11px] text-amber-300 font-semibold block uppercase tracking-wider">
                    Stated Reason:
                  </span>
                  <p className="text-xs text-amber-100 mt-1 italic leading-relaxed break-words">
                    &quot;{approval.reason}&quot;
                  </p>
                </div>
              )}

              {approval.proposedChanges && Object.keys(approval.proposedChanges).length > 0 && (
                <div className="col-span-2 bg-white/5 border border-white/10 p-3 rounded-2xl space-y-1.5">
                  <span className="text-[11px] text-gray-400 font-semibold block uppercase tracking-wider">
                    Proposed Modifications:
                  </span>
                  <div className="max-h-28 overflow-y-auto space-y-1 text-xs font-mono">
                    {Object.entries(approval.proposedChanges).map(([k, v]) => (
                      <div key={k} className="flex justify-between py-1 border-b border-white/5 text-[11px]">
                        <span className="text-gray-400">{k}:</span>
                        <span className="text-emerald-300 font-semibold truncate max-w-[220px]">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Additional Details */}
          {notification.details && !approval && (
            <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Full Details
              </h4>
              <p className="text-gray-300 text-xs whitespace-pre-wrap font-mono leading-relaxed break-words">
                {notification.details}
              </p>
            </div>
          )}

          {/* Bank Deposit Slip Image Preview if available */}
          {approval?.slipUrl && (
            <div className="bg-slate-950/80 rounded-2xl p-4 border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign size={14} />
                  Attached Bank Deposit Slip / Cheque Receipt
                </span>
                <span className="text-[10px] text-gray-400 font-mono">
                  PKR {Number(approval.amount || 0).toLocaleString()}
                </span>
              </div>
              <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40 flex items-center justify-center p-1">
                <img 
                  src={approval.slipUrl} 
                  alt="Bank Deposit Slip Receipt" 
                  className="max-h-64 w-auto rounded-lg object-contain shadow-xl cursor-pointer hover:scale-[1.02] transition"
                  onClick={() => setEnlargedSlip(true)}
                  title="Click to view full image"
                />
              </div>
              <p className="text-[10px] text-gray-400 text-center italic">
                Click image to enlarge. Verify funds in bank statement before approving.
              </p>

              {enlargedSlip && (
                <div 
                  className="fixed inset-0 z-[100099] bg-black/90 flex items-center justify-center p-4 backdrop-blur-md cursor-zoom-out"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnlargedSlip(false);
                  }}
                >
                  <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
                    <button
                      type="button"
                      className="absolute -top-10 right-0 text-white/80 hover:text-white bg-white/10 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 cursor-pointer"
                      onClick={() => setEnlargedSlip(false)}
                    >
                      <X size={14} /> Close Preview
                    </button>
                    <img 
                      src={approval.slipUrl} 
                      alt="Bank Deposit Slip Enlarged" 
                      className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl border border-white/20"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick Case / Vehicle Reference Card if available */}
          {notification.targetFilter?.caseNo && (
            <div className="p-3 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[10px] text-brand-300 font-bold uppercase tracking-wider block">Associated Dossier</span>
                <span className="text-xs font-mono font-bold text-white truncate block">{notification.targetFilter.caseNo}</span>
              </div>
              <button
                type="button"
                onClick={() => onAction('VIEW')}
                className="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-brand-600/30 transition shrink-0 active:scale-95"
              >
                <span>Open Dossier</span>
                <ExternalLink size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Actionable Footer (Direct Action Buttons) */}
        <div className="p-4 border-t border-white/10 bg-slate-950/80 flex flex-col gap-2.5">
          {/* If Approval Required: Show Instant Accept / Reject */}
          {isApprovalAction ? (
            <div className="flex items-center gap-2.5 w-full">
              <button 
                type="button"
                onClick={() => onAction('REJECT')}
                className="flex-1 flex items-center justify-center gap-2 bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 py-3 rounded-2xl transition-all font-bold text-xs sm:text-sm active:scale-95"
              >
                <XCircle size={16} />
                <span>{isPaymentApproval ? 'Decline Payment' : 'Reject'}</span>
              </button>
              <button 
                type="button"
                onClick={() => onAction('ACCEPT')}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-2xl transition-all font-bold text-xs sm:text-sm shadow-lg shadow-emerald-600/25 active:scale-95"
              >
                <Check size={16} />
                <span>
                  {isPaymentApproval 
                    ? 'Confirm Receipt & Credit Ledger' 
                    : notification.notificationSubType === 'CLIENT_REGISTRATION_APPROVAL' 
                    ? 'Approve Client Registration' 
                    : 'Approve & Execute'}
                </span>
              </button>
            </div>
          ) : null}

          {/* Action Row: Open in View / Mark as Read / Close */}
          <div className="flex items-center gap-2 w-full">
            {notification.targetView && (
              <button 
                type="button"
                onClick={() => onAction('VIEW')}
                className="flex-1 py-2.5 px-3 rounded-2xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition shadow-md shadow-brand-600/20 active:scale-95"
              >
                <span>{notification.actionLabel || `Open in ${notification.targetView.toUpperCase()}`}</span>
                <ArrowRight size={13} />
              </button>
            )}

            {isPending && (
              <button 
                type="button"
                onClick={() => onAction('MARK_READ')}
                className="py-2.5 px-4 rounded-2xl bg-white/10 hover:bg-white/15 text-gray-200 hover:text-white font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shrink-0"
              >
                <CheckCheck size={14} className="text-emerald-400" />
                <span>Mark Read</span>
              </button>
            )}

            <button 
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 rounded-2xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white font-semibold text-xs transition active:scale-95 shrink-0"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
};

export default NotificationModal;

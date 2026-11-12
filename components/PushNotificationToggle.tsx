import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, X, ArrowRight } from 'lucide-react';
import {
  PushIdentityContext,
  PushToastPayload,
  isWebPushSupportedInBrowser,
  syncExistingPushSubscriptionOnSessionLoad
} from '../services/fcmPushService';

interface PushNotificationToggleProps {
  variant?: 'header' | 'banner';
  theme?: 'charcoal' | 'pearl';
  identity?: PushIdentityContext;
}

/**
 * Automatic Always-ON Push Notification Background Synchronizer.
 * Per enterprise configuration, push notifications remain automatically active
 * across all sessions without manual ON/OFF toggle controls in the UI.
 */
export const PushNotificationToggle: React.FC<PushNotificationToggleProps> = ({
  identity
}) => {
  useEffect(() => {
    if (isWebPushSupportedInBrowser()) {
      syncExistingPushSubscriptionOnSessionLoad(identity).catch(() => {});
    }
  }, [identity?.userId, identity?.role, identity?.clientName]);

  return null;
};

interface ForegroundPushToastHostProps {
  theme?: 'charcoal' | 'pearl';
  onNavigate?: (payload: { notificationId?: string; caseNo?: string; targetView?: string; url?: string }) => void;
}

export const ForegroundPushToastHost: React.FC<ForegroundPushToastHostProps> = ({
  theme = 'pearl',
  onNavigate
}) => {
  const isPearl = theme === 'pearl';
  const [toasts, setToasts] = useState<PushToastPayload[]>([]);

  useEffect(() => {
    const handleIncomingToast = (event: Event) => {
      const custom = event as CustomEvent<PushToastPayload>;
      const detail = custom.detail;
      if (!detail) return;

      setToasts((prev) => {
        const filtered = prev.filter((t) => t.id !== detail.id);
        return [detail, ...filtered].slice(0, 3);
      });
    };

    const handleSwNavigate = (event: Event) => {
      const custom = event as CustomEvent<{ notificationId?: string; caseNo?: string; targetView?: string; url?: string }>;
      if (custom.detail && onNavigate) {
        onNavigate(custom.detail);
      }
    };

    window.addEventListener('mak_foreground_push_toast', handleIncomingToast);
    window.addEventListener('mak_push_navigate', handleSwNavigate);
    return () => {
      window.removeEventListener('mak_foreground_push_toast', handleIncomingToast);
      window.removeEventListener('mak_push_navigate', handleSwNavigate);
    };
  }, [onNavigate]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.timestamp < 6500));
    }, 1000);
    return () => clearInterval(timer);
  }, [toasts.length]);

  if (toasts.length === 0 || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed top-16 right-3 sm:right-5 z-[99995] flex flex-col gap-2.5 w-[calc(100vw-1.5rem)] sm:w-[380px] pointer-events-none"
      style={{ isolation: 'isolate' }}
    >
      {toasts.map((toast) => (
        <div
          key={`${toast.id}_${toast.timestamp}`}
          onClick={() => {
            if (onNavigate) {
              onNavigate({
                notificationId: toast.id,
                caseNo: toast.caseNo,
                targetView: toast.targetView,
                url: toast.url
              });
            }
            setToasts((prev) => prev.filter((t) => t.id !== toast.id));
          }}
          className={`pointer-events-auto rounded-2xl border p-3.5 shadow-2xl flex items-start gap-3 cursor-pointer transition-all animate-fade-in ${
            isPearl
              ? 'bg-white/98 border-blue-200 text-slate-900 shadow-[0_14px_38px_rgba(15,23,42,0.2)]'
              : 'bg-slate-900/98 border-blue-500/35 text-white shadow-[0_14px_38px_rgba(0,0,0,0.7)]'
          }`}
        >
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
              isPearl ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/20 text-blue-300'
            }`}
          >
            <BellRing size={18} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold truncate">{toast.title}</span>
              <span
                className={`text-[10px] font-bold shrink-0 ${
                  isPearl ? 'text-blue-600' : 'text-blue-400'
                }`}
              >
                Now
              </span>
            </div>
            <p
              className={`text-xs mt-0.5 line-clamp-2 leading-relaxed ${
                isPearl ? 'text-slate-600' : 'text-slate-300'
              }`}
            >
              {toast.body}
            </p>
            {(toast.caseNo || toast.targetView) && (
              <div className="mt-1.5 flex items-center gap-2">
                {toast.caseNo && (
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                      isPearl
                        ? 'bg-slate-50 border-slate-200 text-slate-700'
                        : 'bg-white/5 border-white/10 text-slate-300'
                    }`}
                  >
                    Case #{toast.caseNo}
                  </span>
                )}
                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 inline-flex items-center gap-0.5">
                  <span>Open</span>
                  <ArrowRight size={11} />
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setToasts((prev) => prev.filter((t) => t.id !== toast.id));
            }}
            className={`p-1 rounded-lg transition shrink-0 cursor-pointer ${
              isPearl
                ? 'text-slate-400 hover:text-slate-800 hover:bg-slate-100'
                : 'text-slate-400 hover:text-white hover:bg-white/10'
            }`}
            aria-label="Dismiss notification toast"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
};

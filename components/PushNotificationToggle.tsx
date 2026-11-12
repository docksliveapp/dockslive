import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, BellOff, Volume2, VolumeX, CheckCircle2, Loader2, X, ArrowRight, AlertCircle } from 'lucide-react';
import {
  PushIdentityContext,
  PushToastPayload,
  enablePushNotificationsForCurrentUser,
  disablePushNotificationsForCurrentDevice,
  getBrowserNotificationPermission,
  isPushEnabledLocally,
  isPushSoundEnabled,
  setPushSoundEnabled,
  isWebPushSupportedInBrowser,
  syncExistingPushSubscriptionOnSessionLoad
} from '../services/fcmPushService';

interface PushNotificationToggleProps {
  variant?: 'header' | 'banner';
  theme?: 'charcoal' | 'pearl';
  identity?: PushIdentityContext;
}

export const PushNotificationToggle: React.FC<PushNotificationToggleProps> = ({
  variant = 'header',
  theme = 'pearl',
  identity
}) => {
  const isPearl = theme === 'pearl';
  const [supported, setSupported] = useState<boolean>(true);
  const [enabled, setEnabled] = useState<boolean>(() => isPushEnabledLocally());
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getBrowserNotificationPermission()
  );
  const [soundOn, setSoundOn] = useState<boolean>(() => isPushSoundEnabled());
  const [loading, setLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const ok = isWebPushSupportedInBrowser();
    setSupported(ok);
    setPermission(getBrowserNotificationPermission());
    setEnabled(isPushEnabledLocally());

    if (ok) {
      syncExistingPushSubscriptionOnSessionLoad(identity).catch(() => {});
    }

    const handleStatusChange = () => {
      setPermission(getBrowserNotificationPermission());
      setEnabled(isPushEnabledLocally());
    };

    window.addEventListener('mak_push_status_changed', handleStatusChange);
    return () => {
      window.removeEventListener('mak_push_status_changed', handleStatusChange);
    };
  }, [identity?.userId, identity?.role, identity?.clientName]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const handleTogglePush = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!supported || loading) return;

    setLoading(true);
    setFeedback(null);
    try {
      if (enabled) {
        await disablePushNotificationsForCurrentDevice(identity);
        setEnabled(false);
        setPermission(getBrowserNotificationPermission());
        setFeedback('Push notifications paused on this device.');
      } else {
        const res = await enablePushNotificationsForCurrentUser(identity);
        setEnabled(res.enabled);
        setPermission(res.permission);
        if (res.message) {
          setFeedback(res.message);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSound = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !soundOn;
    setSoundOn(next);
    setPushSoundEnabled(next);
  };

  if (!supported) {
    return null;
  }

  if (variant === 'header') {
    const isDenied = permission === 'denied';
    return (
      <button
        type="button"
        onClick={handleTogglePush}
        disabled={loading}
        title={
          enabled
            ? 'Push Notifications Active on this device (Click to mute this device)'
            : isDenied
              ? 'Notifications blocked in browser site settings'
              : 'Enable Push Notifications for mobile & desktop alerts'
        }
        className={`relative h-9 px-2.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shrink-0 cursor-pointer select-none ${
          enabled
            ? isPearl
              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300'
              : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/35'
            : isDenied
              ? isPearl
                ? 'bg-amber-50 text-amber-700 border-amber-300'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              : isPearl
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                : 'bg-slate-800 hover:bg-slate-700 text-gray-200 hover:text-white border-white/10'
        }`}
      >
        {loading ? (
          <Loader2 size={15} className="animate-spin" />
        ) : enabled ? (
          <BellRing size={15} className="text-emerald-500" />
        ) : (
          <BellOff size={15} className={isDenied ? 'text-amber-500' : 'opacity-75'} />
        )}
        <span className="hidden md:inline">
          {enabled ? 'Push ON' : isDenied ? 'Blocked' : 'Enable Push'}
        </span>
        {enabled && (
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
        )}
      </button>
    );
  }

  // Banner variant inside Notification Center drawer
  const isDenied = permission === 'denied';
  return (
    <div
      className={`mx-4 mb-2.5 px-3 py-2.5 rounded-2xl border transition-all ${
        enabled
          ? isPearl
            ? 'bg-emerald-50/80 border-emerald-200/90 text-slate-900'
            : 'bg-emerald-500/10 border-emerald-500/25 text-slate-100'
          : isPearl
            ? 'bg-slate-50 border-slate-200/90 text-slate-900'
            : 'bg-white/[0.04] border-white/10 text-slate-100'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              enabled
                ? isPearl
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-emerald-500/20 text-emerald-300'
                : isPearl
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-blue-500/20 text-blue-300'
            }`}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : enabled ? (
              <BellRing size={16} />
            ) : (
              <BellOff size={16} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-extrabold truncate">Push Notifications</span>
              {enabled && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                  <CheckCircle2 size={10} />
                  Active
                </span>
              )}
            </div>
            <p
              className={`text-[11px] truncate ${
                isPearl ? 'text-slate-600' : 'text-slate-400'
              }`}
            >
              {isDenied
                ? 'Blocked in browser — allow notifications in site settings'
                : enabled
                  ? 'Mobile & desktop background alerts active'
                  : 'Get instant OS alerts when app is closed'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleToggleSound}
            title={soundOn ? 'Notification Chime ON (Click to mute sound)' : 'Notification Chime Muted'}
            className={`p-1.5 rounded-lg border transition cursor-pointer ${
              isPearl
                ? 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'
            }`}
          >
            {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} className="text-rose-400" />}
          </button>

          <button
            type="button"
            onClick={handleTogglePush}
            disabled={loading}
            style={
              enabled
                ? undefined
                : { backgroundColor: '#2563eb', color: '#ffffff' }
            }
            className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer ${
              enabled
                ? isPearl
                  ? 'bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-600 border border-slate-200'
                  : 'bg-white/10 hover:bg-rose-500/20 text-slate-200 hover:text-rose-300 border border-white/10'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-xs'
            }`}
          >
            {loading ? 'Syncing...' : enabled ? 'Turn Off' : 'Enable Push'}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`mt-2 pt-1.5 border-t text-[11px] flex items-center gap-1.5 ${
            isPearl ? 'border-slate-200/80 text-slate-700' : 'border-white/10 text-slate-300'
          }`}
        >
          <AlertCircle size={12} className="shrink-0 text-blue-500" />
          <span>{feedback}</span>
        </div>
      )}
    </div>
  );
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

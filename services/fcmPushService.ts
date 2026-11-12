import { getMessaging, getToken, deleteToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { app, db } from './firebase';
import { safeAppStorage } from './storage';
import { AppNotification, AppUser, UserRole } from '../types';

/**
 * ============================================================================
 * MAK GROUP — FIREBASE CLOUD MESSAGING (FCM) WEB PUSH CONFIGURATION
 * ============================================================================
 * Read Web Push VAPID public key from environment (`VITE_FIREBASE_VAPID_KEY`)
 * or set the public key string directly in `FALLBACK_FIREBASE_VAPID_KEY` below.
 */
const FALLBACK_FIREBASE_VAPID_KEY =
  'BD47zgOxbdSbVr4nx0j3HVIEnLhotWl2PaSxlQ8R-EsMzzcc9qUH1jH3nUvBbJKGhXxAiS60HdOs5nDm-npzyM0';
export const FIREBASE_VAPID_KEY: string = (
  ((import.meta as any).env?.VITE_FIREBASE_VAPID_KEY as string | undefined) ||
  FALLBACK_FIREBASE_VAPID_KEY ||
  ''
).trim();

export const FIREBASE_VAPID_SUBJECT: string = (
  ((import.meta as any).env?.VITE_FIREBASE_VAPID_SUBJECT as string | undefined) ||
  'mailto:arbab@mak-group.com.pk'
).trim();

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const FCM_SW_URL = '/firebase-messaging-sw.js';
const FCM_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

const LOCAL_FCM_TOKEN_KEY = 'dpl_device_fcm_token';
const LOCAL_VAPID_SIG_KEY = 'dpl_device_vapid_sig';
const LOCAL_PUSH_PREF_KEY = 'dpl_push_notifications_enabled';
const LOCAL_SOUND_PREF_KEY = 'dpl_push_sound_enabled';
const MAX_TOKENS_PER_USER = 20;

export interface PushToastPayload {
  id: string;
  title: string;
  body: string;
  caseNo?: string;
  targetView?: string;
  url?: string;
  priority?: string;
  timestamp: number;
}

export interface PushRegistrationResult {
  enabled: boolean;
  permission: NotificationPermission | 'unsupported';
  token?: string;
  mode?: 'fcm' | 'browser-local';
  message?: string;
}

export interface PushIdentityContext {
  userId?: string;
  userName?: string;
  userEmail?: string;
  role?: UserRole | string;
  roles?: (UserRole | string)[];
  clientName?: string;
}

let messagingInstancePromise: Promise<Messaging | null> | null = null;
let foregroundUnsubscribe: (() => void) | null = null;
let swClickListenerAttached = false;

const seenToastIds = new Map<string, number>();
const dispatchedPushIds = new Map<string, number>();

function pruneMap(map: Map<string, number>, ttlMs = 90000) {
  const now = Date.now();
  for (const [k, ts] of map.entries()) {
    if (now - ts > ttlMs) {
      map.delete(k);
    }
  }
}

export function hasSeenPushToast(notifKey: string): boolean {
  if (!notifKey) return false;
  pruneMap(seenToastIds);
  return seenToastIds.has(notifKey);
}

export function markPushToastSeen(notifKey: string): void {
  if (!notifKey) return;
  pruneMap(seenToastIds);
  seenToastIds.set(notifKey, Date.now());
}

function hashDeviceDocId(token: string): string {
  let h1 = 0xdeadbeef ^ token.length;
  let h2 = 0x41c6ce57 ^ token.length;
  for (let i = 0; i < token.length; i++) {
    const ch = token.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const tail = token.replace(/[^a-zA-Z0-9]/g, '').slice(-24);
  return `dev_${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}_${tail}`.slice(0, 120);
}

function getOrCreateLocalDeviceFallbackToken(): string {
  const existing = safeAppStorage.getItem('dpl_local_browser_device_id');
  if (existing) return existing;
  const generated = `local-browser-perm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  safeAppStorage.setItem('dpl_local_browser_device_id', generated);
  return generated;
}

export function isWebPushSupportedInBrowser(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isWebPushSupportedInBrowser()) return 'unsupported';
  return Notification.permission;
}

export function isPushEnabledLocally(): boolean {
  if (!isWebPushSupportedInBrowser()) return false;
  if (Notification.permission !== 'granted') return false;
  return safeAppStorage.getItem(LOCAL_PUSH_PREF_KEY) === 'true';
}

export function isPushSoundEnabled(): boolean {
  return safeAppStorage.getItem(LOCAL_SOUND_PREF_KEY) !== 'false';
}

export function setPushSoundEnabled(enabled: boolean): void {
  safeAppStorage.setItem(LOCAL_SOUND_PREF_KEY, enabled ? 'true' : 'false');
}

export function getSavedDeviceFcmToken(): string {
  return safeAppStorage.getItem(LOCAL_FCM_TOKEN_KEY) || '';
}

async function getFirebaseMessagingSafe(): Promise<Messaging | null> {
  if (!isWebPushSupportedInBrowser()) return null;
  if (!messagingInstancePromise) {
    messagingInstancePromise = isSupported()
      .then((supported) => (supported ? getMessaging(app) : null))
      .catch(() => null);
  }
  return messagingInstancePromise;
}

async function registerFcmServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return undefined;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration(FCM_SW_SCOPE);
    if (existing) {
      try {
        await existing.update();
      } catch (_) {}
      return existing;
    }
    const reg = await navigator.serviceWorker.register(FCM_SW_URL, {
      scope: FCM_SW_SCOPE,
      updateViaCache: 'none'
    });
    return reg;
  } catch (err) {
    console.warn('[MAK Push] Dedicated scope SW registration fallback:', err);
    try {
      return await navigator.serviceWorker.ready;
    } catch (_) {
      return undefined;
    }
  }
}

export function resolveCurrentIdentity(override?: PushIdentityContext): Required<PushIdentityContext> {
  const storedRoles = safeAppStorage.getJSON<string[]>('dpl_user_roles', []) || [];
  const primaryRole =
    override?.role ||
    safeAppStorage.getItem('dpl_user_role') ||
    safeAppStorage.getItem('dpl_last_location_role') ||
    UserRole.OFFICE_STAFF;

  const mergedRoles = Array.from(
    new Set([
      String(primaryRole),
      ...(override?.roles || []).map(String),
      ...storedRoles.map(String)
    ].filter(Boolean))
  );

  return {
    userId: (override?.userId || safeAppStorage.getItem('dpl_current_user_id') || '').trim(),
    userName: (override?.userName || safeAppStorage.getItem('dpl_current_user_name') || '').trim(),
    userEmail: (override?.userEmail || safeAppStorage.getItem('dpl_current_user_email') || '').trim(),
    role: primaryRole,
    roles: mergedRoles,
    clientName: (override?.clientName || safeAppStorage.getItem('dpl_client_name') || '').trim()
  };
}

function detectDevicePlatform(): string {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  const isStandalone =
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches) ||
    (navigator as any).standalone === true;
  const os = /Android/i.test(ua)
    ? 'Android'
    : /Windows/i.test(ua)
      ? 'Windows'
      : /iPhone|iPad|iPod/i.test(ua)
        ? 'iOS'
        : /Mac/i.test(ua)
          ? 'macOS'
          : 'Desktop';
  return `${os}${isStandalone ? ' PWA/TWA' : ' Browser'}`;
}

async function syncTokenToUserDatabaseRecord(
  token: string,
  identity: Required<PushIdentityContext>,
  action: 'ADD' | 'REMOVE',
  previousTokenToReplace?: string,
  webPushSubscription?: PushSubscriptionJSON | null
): Promise<void> {
  if (!token) return;
  const nowIso = new Date().toISOString();

  // 1. Update dedicated fcm_devices/{deviceId} record for instant multi-device / role targeting
  try {
    const devDocId = hashDeviceDocId(token);
    await setDoc(
      doc(db, 'fcm_devices', devDocId),
      {
        token,
        userId: identity.userId || identity.userEmail || identity.userName || 'user',
        userName: identity.userName || identity.clientName || 'MAK User',
        userEmail: identity.userEmail || '',
        role: String(identity.role || ''),
        roles: identity.roles.map(String),
        clientName: identity.clientName || '',
        platform: detectDevicePlatform(),
        vapidSubject: FIREBASE_VAPID_SUBJECT,
        ...(webPushSubscription && webPushSubscription.endpoint && webPushSubscription.keys
          ? {
              subscription: {
                endpoint: webPushSubscription.endpoint,
                keys: {
                  p256dh: webPushSubscription.keys.p256dh || '',
                  auth: webPushSubscription.keys.auth || ''
                }
              }
            }
          : {}),
        enabled: action === 'ADD',
        updatedAt: nowIso
      },
      { merge: true }
    );

    if (previousTokenToReplace && previousTokenToReplace !== token) {
      const oldDocId = hashDeviceDocId(previousTokenToReplace);
      await setDoc(
        doc(db, 'fcm_devices', oldDocId),
        { token: previousTokenToReplace, enabled: false, updatedAt: nowIso },
        { merge: true }
      ).catch(() => {});
    }
  } catch (err) {
    console.warn('[MAK Push] fcm_devices sync notice:', err);
  }

  // 2. Save/update `fcmTokens` array inside matching logged-in user's Firestore `users` record(s)
  try {
    const uidLower = identity.userId.toLowerCase();
    const emailLower = identity.userEmail.toLowerCase();
    const nameLower = identity.userName.toLowerCase();
    const clientLower = identity.clientName.toLowerCase();

    const matchesLoggedInUser = (u: Partial<AppUser>, docId?: string): boolean => {
      const recordUserId = String(u.userId || '').trim().toLowerCase();
      const recordDocId = String(docId || (u as any)._docId || u.id || '').trim().toLowerCase();
      const recordEmail = String(u.email || '').trim().toLowerCase();
      const recordName = String(u.name || '').trim().toLowerCase();
      const recordClient = String(u.clientName || '').trim().toLowerCase();

      if (uidLower && (recordUserId === uidLower || recordDocId === uidLower || String(u.id || '').toLowerCase() === uidLower)) {
        return true;
      }
      if (emailLower && recordEmail && recordEmail === emailLower) {
        return true;
      }
      if (!uidLower && clientLower && recordClient && recordClient === clientLower) {
        return true;
      }
      if (!uidLower && nameLower && recordName && recordName === nameLower) {
        return true;
      }
      return false;
    };

    const computeNextTokens = (existing: unknown): string[] => {
      const currentList = Array.isArray(existing)
        ? existing.map((t) => String(t || '').trim()).filter(Boolean)
        : [];
      const cleaned = currentList.filter(
        (t) => t !== token && (!previousTokenToReplace || t !== previousTokenToReplace)
      );
      if (action === 'ADD') {
        return [...cleaned, token].slice(-MAX_TOKENS_PER_USER);
      }
      return cleaned;
    };

    // Update local cache `dpl_live_users` first so in-memory lookups see the token immediately
    const localUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || [];
    let updatedLocal = false;
    const nextLocalUsers = localUsers.map((u) => {
      if (!matchesLoggedInUser(u)) return u;
      updatedLocal = true;
      const nextTokens = computeNextTokens(u.fcmTokens);
      return {
        ...u,
        fcmTokens: nextTokens,
        pushNotificationsEnabled: action === 'ADD' ? true : nextTokens.length > 0,
        lastFcmUpdatedAt: nowIso
      };
    });
    if (updatedLocal) {
      safeAppStorage.setJSON('dpl_live_users', nextLocalUsers);
    }

    // Update matching Firestore `users` documents without overwriting any other fields
    const usersSnap = await getDocs(collection(db, 'users'));
    const updatePromises: Promise<any>[] = [];
    usersSnap.forEach((docSnap) => {
      const data = docSnap.data() as Partial<AppUser>;
      if (matchesLoggedInUser(data, docSnap.id)) {
        const nextTokens = computeNextTokens(data.fcmTokens);
        updatePromises.push(
          setDoc(
            doc(db, 'users', docSnap.id),
            {
              fcmTokens: nextTokens,
              pushNotificationsEnabled: action === 'ADD' ? true : nextTokens.length > 0,
              lastFcmUpdatedAt: nowIso
            },
            { merge: true }
          ).catch(() => {})
        );
      }
    });
    await Promise.all(updatePromises);
  } catch (err) {
    console.warn('[MAK Push] User fcmTokens update notice:', err);
  }
}

/**
 * Plays a pleasant, crisp two-note notification chime using Web Audio API (zero external audio file dependencies).
 */
export function playPushNotificationChime(): void {
  if (!isPushSoundEnabled()) return;
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First harmonic note (E5 - 659.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.24);

    // Second harmonic note (A5 - 880 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.11);
    gain2.gain.setValueAtTime(0.0001, now + 0.11);
    gain2.gain.exponentialRampToValueAtTime(0.16, now + 0.13);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.11);
    osc2.stop(now + 0.44);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch (_) {}
}

/**
 * Triggers the in-app foreground toast + notification chime and, if the app tab is minimized/hidden,
 * also shows a native OS notification via the registered Service Worker.
 */
export async function triggerForegroundPushAlert(toast: Omit<PushToastPayload, 'timestamp'>): Promise<void> {
  const dedupeKey = String(toast.id || `${toast.title}_${toast.body}`);
  if (hasSeenPushToast(dedupeKey)) return;
  markPushToastSeen(dedupeKey);

  playPushNotificationChime();

  const fullToast: PushToastPayload = {
    ...toast,
    timestamp: Date.now()
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mak_foreground_push_toast', { detail: fullToast }));
  }

  // If browser/PWA window is minimized or in background tab and permission is granted, also surface native OS banner
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden' &&
    isWebPushSupportedInBrowser() &&
    Notification.permission === 'granted'
  ) {
    try {
      const reg =
        (await navigator.serviceWorker.getRegistration(FCM_SW_SCOPE)) ||
        (await navigator.serviceWorker.ready);
      if (reg && reg.showNotification) {
        await reg.showNotification(toast.title || 'MAK Group of Companies', {
          body: toast.body,
          icon: '/pwa-192x192-v3.png',
          badge: '/pwa-192x192-v3.png',
          tag: `mak-notif-${dedupeKey}`,
          data: {
            url: toast.url || '/',
            caseNo: toast.caseNo || '',
            targetView: toast.targetView || '',
            notificationId: toast.id
          }
        });
      }
    } catch (_) {}
  }
}

/**
 * Attaches Firebase `onMessage(messaging, ...)` for foreground FCM messages
 * plus Service Worker `MAK_PUSH_CLICK` listener for OS notification clicks.
 */
export async function initForegroundPushListener(): Promise<void> {
  if (typeof window === 'undefined') return;

  if (!swClickListenerAttached && 'serviceWorker' in navigator) {
    swClickListenerAttached = true;
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (data && data.type === 'MAK_PUSH_CLICK') {
        window.dispatchEvent(new CustomEvent('mak_push_navigate', { detail: data }));
      }
    });
  }

  if (foregroundUnsubscribe) return;
  const messaging = await getFirebaseMessagingSafe();
  if (!messaging) return;

  foregroundUnsubscribe = onMessage(messaging, (payload) => {
    const notif = payload.notification || {};
    const data = payload.data || {};
    const id = String(data.notificationId || payload.messageId || Date.now());
    const title = notif.title || data.title || 'MAK Group of Companies';
    const body = notif.body || data.body || 'New logistics notification received.';

    triggerForegroundPushAlert({
      id,
      title,
      body,
      caseNo: data.caseNo || undefined,
      targetView: data.targetView || undefined,
      url: data.url || '/',
      priority: data.priority || 'MEDIUM'
    });
  });
}

/**
 * Requests permission, registers `public/firebase-messaging-sw.js`, fetches the FCM token via `getToken`,
 * and stores it inside the logged-in user's `fcmTokens` array in Firestore.
 */
export async function enablePushNotificationsForCurrentUser(
  identityOverride?: PushIdentityContext
): Promise<PushRegistrationResult> {
  if (!isWebPushSupportedInBrowser()) {
    return {
      enabled: false,
      permission: 'unsupported',
      message: 'Push notifications are not supported in this browser environment.'
    };
  }

  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch (_) {
      permission = Notification.permission;
    }
  }

  if (permission !== 'granted') {
    safeAppStorage.setItem(LOCAL_PUSH_PREF_KEY, 'false');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mak_push_status_changed', { detail: { enabled: false, permission } }));
    }
    return {
      enabled: false,
      permission,
      message:
        permission === 'denied'
          ? 'Notifications are blocked in browser settings. Allow notifications for this site to enable alerts.'
          : 'Notification permission was not granted.'
    };
  }

  const swRegistration = await registerFcmServiceWorker();
  await initForegroundPushListener();

  const previousToken = getSavedDeviceFcmToken();
  const previousVapidSig = safeAppStorage.getItem(LOCAL_VAPID_SIG_KEY) || '';
  const currentVapidSig = FIREBASE_VAPID_KEY.slice(0, 24);
  let fcmToken = '';
  let mode: 'fcm' | 'browser-local' = 'fcm';

  try {
    const messaging = await getFirebaseMessagingSafe();
    if (messaging) {
      // If VAPID public key was rotated since last registration, clear old PushSubscription first
      if (previousVapidSig && currentVapidSig && previousVapidSig !== currentVapidSig && swRegistration?.pushManager) {
        try {
          const oldSub = await swRegistration.pushManager.getSubscription();
          if (oldSub) await oldSub.unsubscribe();
          await deleteToken(messaging).catch(() => {});
        } catch (_) {}
      }

      const tokenOptions: { vapidKey?: string; serviceWorkerRegistration?: ServiceWorkerRegistration } = {};
      if (FIREBASE_VAPID_KEY) {
        tokenOptions.vapidKey = FIREBASE_VAPID_KEY;
      }
      if (swRegistration) {
        tokenOptions.serviceWorkerRegistration = swRegistration;
      }

      try {
        fcmToken = await getToken(messaging, tokenOptions);
      } catch (firstErr: any) {
        // Auto-heal if browser had a PushSubscription from a different applicationServerKey
        if (swRegistration?.pushManager) {
          try {
            const staleSub = await swRegistration.pushManager.getSubscription();
            if (staleSub) await staleSub.unsubscribe();
            fcmToken = await getToken(messaging, tokenOptions);
          } catch (retryErr: any) {
            console.warn('[MAK Push] getToken retry notice:', retryErr?.message || firstErr?.message);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[MAK Push] getToken fallback notice:', err?.message || err);
  }

  let webPushSubJson: PushSubscriptionJSON | null = null;
  if (swRegistration?.pushManager) {
    try {
      let pushSub = await swRegistration.pushManager.getSubscription();
      if (!pushSub && FIREBASE_VAPID_KEY) {
        pushSub = await swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(FIREBASE_VAPID_KEY)
        });
      }
      if (pushSub) {
        webPushSubJson = pushSub.toJSON();
      }
    } catch (_) {}
  }

  if (!fcmToken) {
    mode = 'browser-local';
    fcmToken = webPushSubJson?.endpoint
      ? `webpush_${hashDeviceDocId(webPushSubJson.endpoint)}`
      : getOrCreateLocalDeviceFallbackToken();
  } else if (currentVapidSig) {
    safeAppStorage.setItem(LOCAL_VAPID_SIG_KEY, currentVapidSig);
  }

  safeAppStorage.setItem(LOCAL_FCM_TOKEN_KEY, fcmToken);
  safeAppStorage.setItem(LOCAL_PUSH_PREF_KEY, 'true');

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('mak_push_status_changed', {
        detail: { enabled: true, permission: 'granted', token: fcmToken, mode }
      })
    );
  }

  const identity = resolveCurrentIdentity(identityOverride);
  await Promise.race([
    syncTokenToUserDatabaseRecord(fcmToken, identity, 'ADD', previousToken, webPushSubJson),
    new Promise<void>((resolve) => setTimeout(resolve, 1800))
  ]);

  return {
    enabled: true,
    permission: 'granted',
    token: fcmToken,
    mode,
    message: 'Real-time push notifications enabled on this device.'
  };
}

/**
 * Disables push notifications on THIS device only, preserving tokens for the user's other devices (e.g., mobile + desktop).
 */
export async function disablePushNotificationsForCurrentDevice(
  identityOverride?: PushIdentityContext
): Promise<void> {
  const currentToken = getSavedDeviceFcmToken();
  safeAppStorage.setItem(LOCAL_PUSH_PREF_KEY, 'false');
  safeAppStorage.removeItem(LOCAL_FCM_TOKEN_KEY);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('mak_push_status_changed', {
        detail: { enabled: false, permission: getBrowserNotificationPermission() }
      })
    );
  }

  try {
    const messaging = await getFirebaseMessagingSafe();
    if (messaging) {
      await deleteToken(messaging).catch(() => {});
    }
  } catch (_) {}

  if (currentToken) {
    const identity = resolveCurrentIdentity(identityOverride);
    await Promise.race([
      syncTokenToUserDatabaseRecord(currentToken, identity, 'REMOVE'),
      new Promise<void>((resolve) => setTimeout(resolve, 1800))
    ]);
  }
}

/**
 * Silently refreshes and syncs the current device's FCM token to the active logged-in user on app load / login
 * if the user previously enabled push notifications.
 */
export async function syncExistingPushSubscriptionOnSessionLoad(
  identityOverride?: PushIdentityContext
): Promise<void> {
  if (!isWebPushSupportedInBrowser()) return;
  await initForegroundPushListener();

  if (Notification.permission === 'granted' && safeAppStorage.getItem(LOCAL_PUSH_PREF_KEY) === 'true') {
    await enablePushNotificationsForCurrentUser(identityOverride).catch(() => {});
  }
}

function normalizeRoleKey(role: unknown): string {
  return String(role || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function doesUserMatchNotificationTarget(
  candidate: {
    userId?: string | number;
    name?: string;
    role?: string;
    roles?: string[];
    clientName?: string;
    status?: string;
    isSuspended?: boolean;
    isAdmin?: boolean;
  },
  notif: AppNotification
): boolean {
  if (!candidate || candidate.status === 'INACTIVE' || candidate.status === 'SUSPENDED' || candidate.isSuspended) {
    return false;
  }

  const roleSet = new Set(
    [candidate.role, ...(Array.isArray(candidate.roles) ? candidate.roles : [])]
      .filter(Boolean)
      .map(normalizeRoleKey)
  );
  const isAdmin = roleSet.has('ADMIN') || roleSet.has('SUPERADMIN') || Boolean(candidate.isAdmin);
  const subType = String(notif.notificationSubType || '');
  const actionType = String(notif.approvalData?.actionType || '');
  const approvalStage = notif.approvalData?.approvalStage;

  const rawTargets: string[] = [];
  if (Array.isArray((notif as any).targetRoles)) {
    (notif as any).targetRoles.forEach((r: any) => rawTargets.push(String(r)));
  }
  if (Array.isArray(notif.targetRole)) {
    notif.targetRole.forEach((r: any) => rawTargets.push(String(r)));
  } else if (typeof notif.targetRole === 'string' && notif.targetRole.trim()) {
    notif.targetRole.split(',').forEach((part) => rawTargets.push(part.trim()));
  }
  const normalizedTargets = rawTargets.map(normalizeRoleKey).filter(Boolean);

  // 1. Strict Admin Push Discipline: ONLY 12 PM Gate-Out Summary, Expense Paid / Payment Received,
  //    Company Document Expiry, and Direct Admin Final Approvals (Edit/Cancel/Delete/Urgent/NOC/Client Reg)
  if (isAdmin) {
    if (approvalStage === 'MANAGER_REVIEW') return false;

    const explicitlyTargetsAdmin =
      normalizedTargets.includes('ADMIN') || normalizedTargets.includes('SUPERADMIN');

    const isDailyGateOutReport =
      subType === 'DAILY_GATE_OUT_SUMMARY' || Boolean((notif as any).gateOutReport);

    const isFinancePaidOrReceived =
      subType === 'FINANCE_RECORDED' && explicitlyTargetsAdmin;

    const isCompanyDocExpiry =
      subType === 'DOC_EXPIRY_ALERT' && notif.targetView === 'company_documents';

    const isAdminApprovalRequest =
      explicitlyTargetsAdmin &&
      (subType === 'EDIT_APPROVAL' ||
        subType === 'CANCELLATION_APPROVAL' ||
        subType === 'DELETION_APPROVAL' ||
        subType === 'URGENT_PAYABLE_APPROVAL' ||
        subType === 'NOC_REQUEST' ||
        subType === 'CLIENT_REGISTRATION_APPROVAL' ||
        actionType === 'EDIT' ||
        actionType === 'CANCEL' ||
        actionType === 'DELETE' ||
        actionType === 'APPROVE_URGENT_PAYABLE' ||
        actionType === 'APPROVE_NOC' ||
        actionType === 'APPROVE_CLIENT');

    return (
      isDailyGateOutReport ||
      isFinancePaidOrReceived ||
      isCompanyDocExpiry ||
      isAdminApprovalRequest
    );
  }

  // 2. Strict Client Account Push Matching
  if (
    roleSet.has('CLIENT') &&
    !roleSet.has('OPERATIONSMANAGER') &&
    !roleSet.has('DOCUMENTATIONMANAGER') &&
    !roleSet.has('FINANCEMANAGER')
  ) {
    if (
      subType === 'DELETION_APPROVAL' ||
      subType === 'CANCELLATION_APPROVAL' ||
      subType === 'EDIT_APPROVAL' ||
      subType === 'URGENT_PAYABLE_APPROVAL' ||
      subType === 'PAYMENT_APPROVAL'
    ) {
      return false;
    }
    const targetClient = String(notif.targetClientName || '').trim().toLowerCase();
    if (!targetClient) return false;
    const candidateClient = String(candidate.clientName || candidate.name || '').trim().toLowerCase();
    return Boolean(
      candidateClient &&
        (candidateClient === targetClient ||
          candidateClient.includes(targetClient) ||
          targetClient.includes(candidateClient))
    );
  }

  // 3. Strict Transporter Push Matching
  if (
    roleSet.has('TRANSPORTER') &&
    !roleSet.has('DOCUMENTATIONMANAGER') &&
    !roleSet.has('VEHICLEMANAGER') &&
    !roleSet.has('OPERATIONSMANAGER') &&
    !roleSet.has('FINANCEMANAGER')
  ) {
    if (!normalizedTargets.includes('TRANSPORTER') && notif.category !== 'TRANSPORTER') {
      return false;
    }
    const targetClient = String(notif.targetClientName || '').trim().toLowerCase();
    if (targetClient) {
      const candidateClient = String(candidate.clientName || candidate.name || '').trim().toLowerCase();
      return Boolean(
        candidateClient &&
          (candidateClient === targetClient ||
            candidateClient.includes(targetClient) ||
            targetClient.includes(candidateClient))
      );
    }
    return true;
  }

  // 4. Staff User ID Direct Targeting (e.g., Payslip / HR alert)
  const targetStaffId = notif.approvalData?.staffUserId
    ? String(notif.approvalData.staffUserId).trim().toLowerCase()
    : '';
  if (targetStaffId) {
    const candidateUid = String(candidate.userId || '').trim().toLowerCase();
    if (candidateUid && candidateUid === targetStaffId) {
      return true;
    }
  }

  // 5. Strict Role Matching for Internal Managers & Port Staff (No blanket ALL catch-all)
  if (approvalStage === 'ADMIN_FINAL' && normalizedTargets.every((t) => t === 'ADMIN' || t === 'SUPERADMIN')) {
    return false;
  }

  for (const t of normalizedTargets) {
    if (t === 'ALL') continue;
    if (roleSet.has(t)) return true;
    if (
      (t === 'VEHICLEMANAGER' || t === 'FLEETANDVEHICLEMANAGER') &&
      roleSet.has('DOCUMENTATIONMANAGER')
    ) {
      return true;
    }
    if (t === 'CASEMANAGER' && roleSet.has('OPERATIONSMANAGER')) {
      return true;
    }
    if (t === 'UNLOADINGSTAFF' && roleSet.has('DESTINATIONPORTSTAFF')) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves all stored `fcmTokens` for the target User IDs / Roles / Clients of an `AppNotification`
 * and dispatches the Web Push payload via `/api/push/send`.
 */
export async function dispatchPushForNotification(notif: AppNotification): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!notif || notif.status === 'RESOLVED' || notif.status === 'REJECTED' || notif.read) {
    return;
  }

  const notifKey = String(notif.id || `${notif.title}_${notif.timestamp}`);
  pruneMap(dispatchedPushIds, 60000);
  if (dispatchedPushIds.has(notifKey)) return;
  dispatchedPushIds.set(notifKey, Date.now());

  try {
    const tokenSet = new Set<string>();

    // 1. Check cached users first for zero-latency resolution, plus live Firestore `users`
    const localUsers = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []) || [];
    for (const u of localUsers) {
      if (u.pushNotificationsEnabled === false) continue;
      if (Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0 && doesUserMatchNotificationTarget(u, notif)) {
        u.fcmTokens.forEach((tk) => {
          if (tk && tk.length >= 20 && !tk.startsWith('local-browser-perm-')) {
            tokenSet.add(tk);
          }
        });
      }
    }

    const [usersSnap, devicesSnap] = await Promise.all([
      getDocs(collection(db, 'users')).catch(() => null),
      getDocs(collection(db, 'fcm_devices')).catch(() => null)
    ]);

    if (usersSnap) {
      usersSnap.forEach((docSnap) => {
        const u = docSnap.data() as Partial<AppUser>;
        if (u.pushNotificationsEnabled === false) return;
        if (
          Array.isArray(u.fcmTokens) &&
          u.fcmTokens.length > 0 &&
          doesUserMatchNotificationTarget(
            {
              userId: u.userId || u.id || docSnap.id,
              name: u.name,
              role: u.role,
              roles: u.roles as string[] | undefined,
              clientName: u.clientName,
              status: u.status,
              isSuspended: u.isSuspended,
              isAdmin: u.isAdmin
            },
            notif
          )
        ) {
          u.fcmTokens.forEach((tk) => {
            if (typeof tk === 'string' && tk.length >= 20 && !tk.startsWith('local-browser-perm-')) {
              tokenSet.add(tk);
            }
          });
        }
      });
    }

    const subscriptions: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }> = [];

    if (devicesSnap) {
      devicesSnap.forEach((docSnap) => {
        const dev = docSnap.data() as any;
        if (!dev || dev.enabled === false) return;
        if (
          doesUserMatchNotificationTarget(
            {
              userId: dev.userId,
              name: dev.userName,
              role: dev.role,
              roles: dev.roles,
              clientName: dev.clientName,
              status: 'ACTIVE'
            },
            notif
          )
        ) {
          if (dev.token && !String(dev.token).startsWith('local-browser-perm-') && !String(dev.token).startsWith('webpush_')) {
            tokenSet.add(String(dev.token));
          }
          if (dev.subscription?.endpoint && dev.subscription?.keys?.p256dh && dev.subscription?.keys?.auth) {
            subscriptions.push(dev.subscription);
          }
        }
      });
    }

    const tokens = Array.from(tokenSet);
    if (tokens.length === 0 && subscriptions.length === 0) return;

    const caseNo = notif.targetFilter?.caseNo ? String(notif.targetFilter.caseNo) : '';
    const targetView = notif.targetView ? String(notif.targetView) : caseNo ? 'cases' : 'dashboard';
    const notifIdParam = notif.id ? `&openNotificationId=${encodeURIComponent(String(notif.id))}` : '';
    const deepLinkUrl = caseNo
      ? `/?view=cases&caseNo=${encodeURIComponent(caseNo)}${notifIdParam}`
      : `/?view=${encodeURIComponent(targetView)}${notifIdParam}`;

    await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokens,
        subscriptions,
        notificationId: String(notif.id || ''),
        title: notif.title || 'MAK Group of Companies',
        body: notif.description || 'New logistics alert or task assignment.',
        url: deepLinkUrl,
        caseNo,
        targetView,
        priority: notif.priority || (notif.type === 'ALERT' || notif.type === 'APPROVAL' ? 'HIGH' : 'MEDIUM'),
        category: notif.category || 'GENERAL'
      })
    }).catch(() => {});
  } catch (err) {
    console.warn('[MAK Push] Notification push dispatch warning:', err);
  }
}

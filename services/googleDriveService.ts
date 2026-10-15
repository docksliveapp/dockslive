import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  getDocs, 
  deleteDoc, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot 
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { safeAppStorage } from './storage';
import firebaseConfig from '../firebase-applet-config.json';
import { downloadClientLedgerPdf, ClientLedgerExportData } from './pdfExportService';
import { sendAppNotification } from './notificationService';

export const OFFICIAL_WORKSPACE_EMAIL = 'info@mak-group.pk';
export const CORPORATE_WORKSPACE_EMAIL = OFFICIAL_WORKSPACE_EMAIL;

// Complete Google Workspace Scopes: Drive, Profile, Google Calendar, and Gmail
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.acls',
  'https://www.googleapis.com/auth/calendar.acls.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.calendarlist',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.calendars',
  'https://www.googleapis.com/auth/calendar.calendars.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.events.owned.readonly',
  'https://www.googleapis.com/auth/calendar.events.public.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.settings.readonly',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
  'https://www.googleapis.com/auth/gmail.addons.current.message.action',
  'https://www.googleapis.com/auth/gmail.addons.current.message.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing'
];

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  parents?: string[];
  shared?: boolean;
  source?: 'drive' | 'firestore';
}

export interface DriveUserInfo {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
  uid?: string | null;
}

export interface WorkspaceCalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  htmlLink?: string;
  location?: string;
  recurrence?: string[];
}

export interface MonthlyLedgerEmailLog {
  id: string;
  monthKey: string;
  clientName: string;
  clientEmail: string;
  senderEmail: string;
  companyName: string;
  netBalance: number;
  totalDebits: number;
  totalCredits: number;
  sentAt: string;
  status: 'SENT_GMAIL_API' | 'QUEUED_AUTO_DISPATCH';
  messageId?: string;
  filename?: string;
}

const STORAGE_KEY_USER = 'dpl_drive_user_info';
const STORAGE_KEY_STATUS = 'dpl_drive_connected_status';
const STORAGE_KEY_TIMESTAMP = 'dpl_drive_token_timestamp';

// In-memory access token caching ONLY (never stored in localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

let cachedUserInfo: DriveUserInfo | null = (() => {
  try {
    const raw = safeAppStorage.getItem(STORAGE_KEY_USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
})();
let isConnectionActive = safeAppStorage.getItem(STORAGE_KEY_STATUS) === 'CONNECTED';

// Setup Google Auth Provider with Workspace scopes
const driveProvider = new GoogleAuthProvider();
DRIVE_SCOPES.forEach(scope => driveProvider.addScope(scope));
driveProvider.setCustomParameters({
  prompt: 'select_account'
});

// Clear cached access token when user signs out via Firebase Auth
onAuthStateChanged(auth, (user: User | null) => {
  if (!user && !isSigningIn) {
    cachedAccessToken = null;
  }
});

// Real-time Firestore sync for Google Workspace connection metadata
let hasSubscribedToDriveStatus = false;
export function initDriveAuth(
  onStatusChange?: (connected: boolean, user: DriveUserInfo | null) => void
) {
  if (isConnectionActive && onStatusChange) {
    onStatusChange(true, cachedUserInfo);
  }

  if (hasSubscribedToDriveStatus) return () => {};
  hasSubscribedToDriveStatus = true;

  try {
    const driveDocRef = doc(db, 'settings', 'google_drive_connection');
    const unsub = onSnapshot(driveDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.status === 'CONNECTED' && data.manualDisconnect !== true) {
          isConnectionActive = true;
          safeAppStorage.setItem(STORAGE_KEY_STATUS, 'CONNECTED');
          if (data.email) {
            const userObj: DriveUserInfo = {
              email: data.email,
              displayName: data.displayName || data.email,
              photoURL: data.photoURL || null
            };
            cachedUserInfo = userObj;
            safeAppStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userObj));
          }
          if (onStatusChange) onStatusChange(true, cachedUserInfo);
        } else if (data.status === 'DISCONNECTED' || data.manualDisconnect === true) {
          isConnectionActive = false;
          cachedAccessToken = null;
          cachedUserInfo = null;
          safeAppStorage.removeItem(STORAGE_KEY_STATUS);
          safeAppStorage.removeItem(STORAGE_KEY_USER);
          if (onStatusChange) onStatusChange(false, null);
        }
      }
    }, (err) => {
      console.warn('Google Workspace Firestore sync warning:', err);
    });

    return unsub;
  } catch (err) {
    console.warn('Error setting up workspace sync:', err);
    return () => {};
  }
}

/**
 * Sign in using Google Identity Services (GIS) Token Client.
 */
function requestGsiToken(promptSelectAccount: boolean = true): Promise<{ token: string; profile: DriveUserInfo }> {
  return new Promise((resolve, reject) => {
    const oAuthClientId = (firebaseConfig as any).oAuthClientId;
    if (!oAuthClientId) {
      reject(new Error('OAuth Client ID is missing in applet configuration.'));
      return;
    }

    const checkAndTrigger = () => {
      const g = (window as any).google;
      if (!g?.accounts?.oauth2) {
        reject(new Error('Google Identity Services library is not loaded.'));
        return;
      }

      try {
        const tokenClient = g.accounts.oauth2.initTokenClient({
          client_id: oAuthClientId,
          scope: DRIVE_SCOPES.join(' '),
          prompt: promptSelectAccount ? 'select_account' : '',
          callback: async (resp: any) => {
            if (resp.error) {
              reject(new Error(resp.error_description || resp.error || 'Authentication canceled or failed.'));
              return;
            }
            const token = resp.access_token;
            if (!token) {
              reject(new Error('No access token returned from Google.'));
              return;
            }

            let profile: DriveUserInfo = { email: OFFICIAL_WORKSPACE_EMAIL };
            try {
              const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (uRes.ok) {
                const uData = await uRes.json();
                profile = {
                  displayName: uData.name || uData.email,
                  email: uData.email,
                  photoURL: uData.picture || null,
                  uid: uData.sub
                };
              }
            } catch (uErr) {
              console.warn('Failed to fetch userinfo from Google endpoint:', uErr);
            }

            resolve({ token, profile });
          }
        });

        tokenClient.requestAccessToken({ prompt: promptSelectAccount ? 'select_account' : '' });
      } catch (err) {
        reject(err);
      }
    };

    if ((window as any).google?.accounts?.oauth2) {
      checkAndTrigger();
    } else {
      const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
      if (!existing) {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onload = () => setTimeout(checkAndTrigger, 100);
        script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
        document.head.appendChild(script);
      } else {
        setTimeout(checkAndTrigger, 300);
      }
    }
  });
}

/**
 * Connect Google Workspace (Gmail, Calendar, Drive) with Firebase Auth popup / GIS Token Client.
 * Stores access token strictly in memory.
 */
export const signInWithGoogleDrive = async (forceSelectAccount: boolean = true): Promise<{ user: DriveUserInfo; accessToken: string }> => {
  isSigningIn = true;
  try {
    if (forceSelectAccount) {
      try {
        await signOut(auth);
      } catch {
        // ignore
      }
    }

    let token = '';
    let userInfo: DriveUserInfo = { email: OFFICIAL_WORKSPACE_EMAIL };

    try {
      driveProvider.setCustomParameters({
        prompt: 'select_account'
      });
      const result = await signInWithPopup(auth, driveProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Google Workspace access token was not returned.');
      }
      token = credential.accessToken;
      userInfo = {
        displayName: result.user.displayName || result.user.email,
        email: result.user.email || OFFICIAL_WORKSPACE_EMAIL,
        photoURL: result.user.photoURL,
        uid: result.user.uid
      };
    } catch (firebaseErr: any) {
      console.warn('Firebase Auth popup notice, trying GIS Token Client:', firebaseErr?.message || firebaseErr);
      const res = await requestGsiToken(forceSelectAccount);
      token = res.token;
      userInfo = res.profile;
    }

    cachedAccessToken = token;
    cachedUserInfo = userInfo;
    isConnectionActive = true;

    safeAppStorage.setItem(STORAGE_KEY_STATUS, 'CONNECTED');
    safeAppStorage.setItem(STORAGE_KEY_TIMESTAMP, Date.now().toString());
    safeAppStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userInfo));

    try {
      const driveDocRef = doc(db, 'settings', 'google_drive_connection');
      await setDoc(driveDocRef, {
        status: 'CONNECTED',
        manualDisconnect: false,
        email: userInfo.email || OFFICIAL_WORKSPACE_EMAIL,
        displayName: userInfo.displayName || userInfo.email,
        photoURL: userInfo.photoURL || null,
        connectedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.warn('Could not mirror workspace connection metadata to Firestore:', err);
    }

    return { user: userInfo, accessToken: token };
  } finally {
    isSigningIn = false;
  }
};

export const connectDrive = signInWithGoogleDrive;

/**
 * Connect with a designated Google Workspace Account email (e.g. info@mak-group.pk)
 */
export async function connectWithGoogleEmail(
  email: string, 
  displayName?: string
): Promise<DriveUserInfo> {
  const cleanEmail = email.trim().toLowerCase();
  const userInfo: DriveUserInfo = {
    email: cleanEmail,
    displayName: displayName?.trim() || (cleanEmail === OFFICIAL_WORKSPACE_EMAIL ? 'MAK Group Official Workspace' : cleanEmail.split('@')[0]),
    photoURL: `https://www.gravatar.com/avatar/${encodeURIComponent(cleanEmail)}?d=mp`
  };

  cachedUserInfo = userInfo;
  isConnectionActive = true;

  safeAppStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userInfo));
  safeAppStorage.setItem(STORAGE_KEY_STATUS, 'CONNECTED');
  safeAppStorage.setItem(STORAGE_KEY_TIMESTAMP, Date.now().toString());

  try {
    const driveDocRef = doc(db, 'settings', 'google_drive_connection');
    await setDoc(driveDocRef, {
      status: 'CONNECTED',
      manualDisconnect: false,
      email: userInfo.email,
      displayName: userInfo.displayName,
      photoURL: userInfo.photoURL,
      lastUpdated: new Date().toISOString(),
      connectedAt: new Date().toISOString()
    }, { merge: true });
  } catch (fsErr) {
    console.warn('Failed to save manual account to Firestore:', fsErr);
  }

  return userInfo;
}

/**
 * Completely purges and resets any stored account data.
 */
export async function clearDriveAccountCache(): Promise<void> {
  cachedAccessToken = null;
  cachedUserInfo = null;
  isConnectionActive = false;

  safeAppStorage.removeItem(STORAGE_KEY_STATUS);
  safeAppStorage.removeItem(STORAGE_KEY_TIMESTAMP);
  safeAppStorage.removeItem(STORAGE_KEY_USER);

  try {
    await signOut(auth);
  } catch {
    // ignore
  }

  try {
    const driveDocRef = doc(db, 'settings', 'google_drive_connection');
    await setDoc(driveDocRef, {
      status: 'DISCONNECTED',
      manualDisconnect: true,
      disconnectedAt: new Date().toISOString()
    }, { merge: true });
  } catch (fsErr) {
    console.warn('Failed to reset workspace doc in Firestore:', fsErr);
  }
}

export const getDriveAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const isDrivePermanentlyConnected = (): boolean => {
  if (isConnectionActive) return true;
  const status = safeAppStorage.getItem(STORAGE_KEY_STATUS);
  if (status === 'CONNECTED') {
    isConnectionActive = true;
    return true;
  }
  return false;
};

export const getSavedDriveUser = (): DriveUserInfo | null => {
  if (cachedUserInfo) return cachedUserInfo;
  try {
    const data = safeAppStorage.getItem(STORAGE_KEY_USER);
    if (data) {
      cachedUserInfo = JSON.parse(data);
      return cachedUserInfo;
    }
    return null;
  } catch {
    return null;
  }
};

export const disconnectDrive = async () => {
  await clearDriveAccountCache();
};

// =========================================================
// GMAIL REST API: MONTHLY CLIENT LEDGER AUTO-DISPATCH
// Sender: info@mak-group.pk -> Client's Registered Email ID
// =========================================================

function encodeBase64Url(str: string): string {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
    const chunk = utf8Bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return window.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Sends a MIME email with optional PDF attachment via Gmail REST API
 */
export async function sendGmailWithAttachment(params: {
  to: string;
  subject: string;
  htmlBody: string;
  fromName?: string;
  fromEmail?: string;
  attachmentFilename?: string;
  attachmentBase64?: string;
}): Promise<{ id: string; threadId?: string }> {
  let token = getDriveAccessToken();
  if (!token) {
    const authRes = await signInWithGoogleDrive(false);
    token = authRes.accessToken;
  }
  if (!token) {
    throw new Error('Google Workspace (Gmail) authorization token is required to send emails.');
  }

  const senderEmail = params.fromEmail || OFFICIAL_WORKSPACE_EMAIL;
  const senderName = params.fromName || 'MAK Group Finance & Accounts';
  const boundary = `mak_group_mime_${Date.now()}`;

  const mimeLines: string[] = [
    `From: "${senderName}" <${senderEmail}>`,
    `Reply-To: ${OFFICIAL_WORKSPACE_EMAIL}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0'
  ];

  if (params.attachmentBase64 && params.attachmentFilename) {
    mimeLines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '');
    mimeLines.push(`--${boundary}`);
    mimeLines.push('Content-Type: text/html; charset="UTF-8"');
    mimeLines.push('Content-Transfer-Encoding: 7bit', '');
    mimeLines.push(params.htmlBody, '');
    mimeLines.push(`--${boundary}`);
    mimeLines.push(`Content-Type: application/pdf; name="${params.attachmentFilename}"`);
    mimeLines.push('Content-Transfer-Encoding: base64');
    mimeLines.push(`Content-Disposition: attachment; filename="${params.attachmentFilename}"`, '');
    mimeLines.push(params.attachmentBase64, '');
    mimeLines.push(`--${boundary}--`);
  } else {
    mimeLines.push('Content-Type: text/html; charset="UTF-8"', '');
    mimeLines.push(params.htmlBody);
  }

  const rawMessage = encodeBase64Url(mimeLines.join('\r\n'));

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: rawMessage })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) {
      cachedAccessToken = null;
    }
    throw new Error(err.error?.message || `Gmail API dispatch failed (${response.status})`);
  }

  return response.json();
}

/**
 * Generates the official letterhead PDF for a Client's Monthly Ledger and sends it
 * from info@mak-group.pk to the Client's registered email address.
 */
export async function sendMonthlyClientLedgerViaGmail(params: {
  clientName: string;
  clientEmail: string;
  monthLabel: string;
  monthKey?: string;
  ledgerData: ClientLedgerExportData;
  requireInteractiveAuthIfMissingToken?: boolean;
}): Promise<{ success: boolean; log: MonthlyLedgerEmailLog; error?: string }> {
  try {
    const cleanEmail = (params.clientEmail || '').trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error(`Client "${params.clientName}" does not have a valid registered email address.`);
    }
    const resolvedMonthKey = params.monthKey || new Date().toISOString().slice(0, 7);

  // 1. Generate official PDF on company letterhead
  const pdfResult = await downloadClientLedgerPdf({
    ...params.ledgerData,
    returnBase64Only: true
  });

  const companyTitle = params.ledgerData.companyName || 'Docks (Pvt) Ltd. • A Project of MAK Group';
  const { totalDebits, totalCredits, netBalance } = params.ledgerData.summary;

  const recentRowsHtml = params.ledgerData.entries.slice(-15).map(e => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;">${e.date}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#1e293b;font-family:monospace;">${e.reference || '-'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;">${e.description || '-'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#b91c1c;text-align:right;font-weight:bold;">${e.debit > 0 ? `PKR ${Number(e.debit).toLocaleString()}` : '-'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#15803d;text-align:right;font-weight:bold;">${e.credit > 0 ? `PKR ${Number(e.credit).toLocaleString()}` : '-'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#0f172a;text-align:right;font-weight:bold;">PKR ${Number(e.balance).toLocaleString()}</td>
    </tr>
  `).join('');

  const htmlBody = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:0 auto;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">
      <div style="background:#0f172a;color:#ffffff;padding:20px 24px;border-bottom:4px solid #eab308;">
        <h2 style="margin:0;font-size:18px;letter-spacing:0.5px;">${companyTitle}</h2>
        <p style="margin:4px 0 0;font-size:12px;color:#fde047;">MONTHLY CLIENT STATEMENT OF ACCOUNT (${params.monthLabel})</p>
        <p style="margin:2px 0 0;font-size:11px;color:#94a3b8;">Official Workspace Dispatch: ${OFFICIAL_WORKSPACE_EMAIL}</p>
      </div>
      <div style="padding:24px;color:#1e293b;font-size:13px;line-height:1.6;">
        <p>Dear <strong>${params.clientName}</strong>,</p>
        <p>Please find attached your official <strong>Monthly Statement of Account (Client Ledger)</strong> generated on the 1st of the month (${params.monthLabel}) from <strong>${companyTitle}</strong> (${OFFICIAL_WORKSPACE_EMAIL}).</p>
        
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:18px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;color:#64748b;font-size:12px;">Total Billed (Debits):</td>
              <td style="padding:4px 0;text-align:right;font-weight:bold;color:#b91c1c;font-size:13px;">PKR ${Number(totalDebits).toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#64748b;font-size:12px;">Total Received (Credits):</td>
              <td style="padding:4px 0;text-align:right;font-weight:bold;color:#15803d;font-size:13px;">PKR ${Number(totalCredits).toLocaleString()}</td>
            </tr>
            <tr style="border-top:1px solid #cbd5e1;">
              <td style="padding:8px 0 0;font-weight:bold;color:#0f172a;font-size:14px;">Outstanding Closing Balance:</td>
              <td style="padding:8px 0 0;text-align:right;font-weight:bold;color:#0f172a;font-size:15px;">PKR ${Number(netBalance).toLocaleString()}</td>
            </tr>
          </table>
        </div>

        <h4 style="margin:20px 0 8px;font-size:13px;color:#0f172a;text-transform:uppercase;">Ledger Statement Summary</h4>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead>
            <tr style="background:#0f172a;color:#ffffff;font-size:11px;text-align:left;">
              <th style="padding:8px 10px;">Date</th>
              <th style="padding:8px 10px;">Ref / Invoice</th>
              <th style="padding:8px 10px;">Particulars</th>
              <th style="padding:8px 10px;text-align:right;">Debit</th>
              <th style="padding:8px 10px;text-align:right;">Credit</th>
              <th style="padding:8px 10px;text-align:right;">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${recentRowsHtml}
          </tbody>
        </table>

        <p style="margin-top:18px;font-size:12px;color:#475569;">
          The complete official PDF statement printed on our corporate letterhead is attached to this email. For any queries or reconciliation, please reply directly to <strong>${OFFICIAL_WORKSPACE_EMAIL}</strong>.
        </p>
      </div>
      <div style="background:#f1f5f9;padding:12px 24px;font-size:11px;color:#64748b;text-align:center;border-top:1px solid #e2e8f0;">
        Sent automatically via Google Workspace (${OFFICIAL_WORKSPACE_EMAIL}) • A Project of MAK Group
      </div>
    </div>
  `;

  const subject = `Monthly Ledger Statement (${params.monthLabel}) - ${params.clientName} | ${companyTitle}`;

  let status: 'SENT_GMAIL_API' | 'QUEUED_AUTO_DISPATCH' = 'QUEUED_AUTO_DISPATCH';
  let messageId = '';

  const token = getDriveAccessToken();
  if (token || params.requireInteractiveAuthIfMissingToken) {
    const gmailRes = await sendGmailWithAttachment({
      to: cleanEmail,
      subject,
      htmlBody,
      fromName: `${companyTitle} (${OFFICIAL_WORKSPACE_EMAIL})`,
      fromEmail: OFFICIAL_WORKSPACE_EMAIL,
      attachmentFilename: pdfResult.filename,
      attachmentBase64: pdfResult.base64
    });
    status = 'SENT_GMAIL_API';
    messageId = gmailRes.id;
  }

  const logEntry: MonthlyLedgerEmailLog = {
    id: `ledger_mail_${resolvedMonthKey}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    monthKey: resolvedMonthKey,
    clientName: params.clientName,
    clientEmail: cleanEmail,
    senderEmail: OFFICIAL_WORKSPACE_EMAIL,
    companyName: companyTitle,
    netBalance,
    totalDebits,
    totalCredits,
    sentAt: new Date().toISOString(),
    status,
    messageId,
    filename: pdfResult.filename
  };

  // Persist dispatch log to local storage and Firestore
  try {
    const existingLogs = safeAppStorage.getJSON<MonthlyLedgerEmailLog[]>('dpl_monthly_ledger_gmail_logs', []) || [];
    const updatedLogs = [logEntry, ...existingLogs.filter(l => l.id !== logEntry.id)].slice(0, 200);
    safeAppStorage.setJSON('dpl_monthly_ledger_gmail_logs', updatedLogs);
    await setDoc(doc(db, 'monthly_ledger_emails', logEntry.id), logEntry, { merge: true });
  } catch (e) {
    console.warn('Could not persist monthly ledger email log:', e);
  }

  // Send live notification to Admin & Finance Manager
  await sendAppNotification({
    title: `Monthly Ledger Sent via Gmail: ${params.clientName}`,
    description: `Monthly Statement (${params.monthLabel}) dispatched from ${OFFICIAL_WORKSPACE_EMAIL} to ${cleanEmail} (Balance: PKR ${Number(netBalance).toLocaleString()}).`,
    details: `Client: ${params.clientName}\nRecipient Email: ${cleanEmail}\nSender Workspace ID: ${OFFICIAL_WORKSPACE_EMAIL}\nPeriod: ${params.monthLabel}\nTotal Debits: PKR ${Number(totalDebits).toLocaleString()}\nTotal Credits: PKR ${Number(totalCredits).toLocaleString()}\nClosing Balance: PKR ${Number(netBalance).toLocaleString()}`,
    targetRole: 'ADMIN,FINANCE_MANAGER',
    type: 'INFO',
    notificationSubType: 'FINANCE_RECORDED',
    category: 'FINANCE',
    priority: 'HIGH',
    targetView: 'finance'
  }).catch(() => {});

  return { success: true, log: logEntry };
  } catch (err: any) {
    const fallbackLog: MonthlyLedgerEmailLog = {
      id: `ledger_mail_err_${Date.now()}`,
      monthKey: params.monthKey || new Date().toISOString().slice(0, 7),
      clientName: params.clientName,
      clientEmail: params.clientEmail || '',
      senderEmail: OFFICIAL_WORKSPACE_EMAIL,
      companyName: params.ledgerData?.companyName || 'Docks (Pvt) Ltd.',
      netBalance: params.ledgerData?.summary?.netBalance || 0,
      totalDebits: params.ledgerData?.summary?.totalDebits || 0,
      totalCredits: params.ledgerData?.summary?.totalCredits || 0,
      sentAt: new Date().toISOString(),
      status: 'QUEUED_AUTO_DISPATCH'
    };
    return { success: false, log: fallbackLog, error: err?.message || 'Failed to dispatch monthly ledger via Gmail' };
  }
}

export function getMonthlyLedgerEmailLogs(): MonthlyLedgerEmailLog[] {
  return safeAppStorage.getJSON<MonthlyLedgerEmailLog[]>('dpl_monthly_ledger_gmail_logs', []) || [];
}

// =========================================================
// GOOGLE CALENDAR REST API INTEGRATION
// =========================================================

export async function listGoogleCalendarEvents(maxResults: number = 15): Promise<WorkspaceCalendarEvent[]> {
  let token = getDriveAccessToken();
  if (!token) {
    throw new Error('Please sign in with Google Workspace to view Google Calendar events.');
  }

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('timeMin', new Date(Date.now() - 7 * 86400000).toISOString());

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    if (res.status === 401) cachedAccessToken = null;
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to load Google Calendar events (${res.status})`);
  }

  const data = await res.json();
  return data.items || [];
}

export async function createGoogleCalendarEvent(
  event: WorkspaceCalendarEvent | {
    summary: string;
    description?: string;
    startIso?: string;
    endIso?: string;
    attendeesEmails?: string[];
    recurrence?: string[];
  }
): Promise<WorkspaceCalendarEvent> {
  let token = getDriveAccessToken();
  if (!token) {
    const authRes = await signInWithGoogleDrive(false);
    token = authRes.accessToken;
  }
  if (!token) {
    throw new Error('Google Calendar authorization is required.');
  }

  const payload: any = 'start' in event
    ? event
    : {
        summary: event.summary,
        description: event.description || '',
        start: { dateTime: event.startIso, timeZone: 'Asia/Karachi' },
        end: { dateTime: event.endIso, timeZone: 'Asia/Karachi' },
        ...(event.attendeesEmails && event.attendeesEmails.length > 0
          ? { attendees: event.attendeesEmails.filter(e => e && e.includes('@')).map(email => ({ email: email.trim() })) }
          : {}),
        ...(event.recurrence ? { recurrence: event.recurrence } : {})
      };

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    if (res.status === 401) cachedAccessToken = null;
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to create Google Calendar event (${res.status})`);
  }

  return res.json();
}

/**
 * Schedules the recurring 1st-of-Every-Month Automated Client Ledger Dispatch event on Google Calendar
 */
export async function syncFirstOfMonthLedgerScheduleToCalendar(): Promise<WorkspaceCalendarEvent> {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + (now.getDate() === 1 ? 0 : 1), 1);
  const dateStr = nextMonth.toISOString().split('T')[0];

  return createGoogleCalendarEvent({
    summary: `Monthly Client Ledger Auto-Generation & Gmail Dispatch (${OFFICIAL_WORKSPACE_EMAIL})`,
    description: `Automated 1st-of-the-month Client Ledger Statement generation and email dispatch from ${OFFICIAL_WORKSPACE_EMAIL} to all registered client email IDs.`,
    start: { date: dateStr },
    end: { date: dateStr },
    recurrence: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=1']
  });
}

export async function scheduleMonthlyLedgerCalendarEvent(params?: {
  clientName?: string;
  clientEmail?: string;
  companyName?: string;
}): Promise<{ success: boolean; eventId?: string; htmlLink?: string; error?: string }> {
  try {
    const now = new Date();
    const targetYear = now.getDate() === 1 ? now.getFullYear() : (now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear());
    const targetMonth = now.getDate() === 1 ? now.getMonth() : (now.getMonth() + 1) % 12;
    const firstOfMonthStart = new Date(targetYear, targetMonth, 1, 9, 0, 0);
    const firstOfMonthEnd = new Date(targetYear, targetMonth, 1, 10, 0, 0);

    const attendees: string[] = [OFFICIAL_WORKSPACE_EMAIL];
    if (params?.clientEmail && params.clientEmail.includes('@')) {
      attendees.push(params.clientEmail.trim());
    }

    const summary = params?.clientName
      ? `Monthly Client Ledger Dispatch: ${params.clientName} (${OFFICIAL_WORKSPACE_EMAIL})`
      : `Monthly Client Ledger Auto-Generation & Gmail Dispatch (${OFFICIAL_WORKSPACE_EMAIL})`;

    const description = `Automated 1st-of-the-month Client Ledger PDF generation and email dispatch.\nSender: ${OFFICIAL_WORKSPACE_EMAIL}\nCompany: ${params?.companyName || 'Docks (Pvt) Ltd. • A Project of MAK Group'}${params?.clientName ? `\nClient: ${params.clientName} (${params.clientEmail || 'Registered Email'})` : ''}`;

    const created = await createGoogleCalendarEvent({
      summary,
      description,
      startIso: firstOfMonthStart.toISOString(),
      endIso: firstOfMonthEnd.toISOString(),
      attendeesEmails: attendees,
      recurrence: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=1']
    });
    return { success: true, eventId: created.id, htmlLink: created.htmlLink };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to schedule Google Calendar event' };
  }
}

// ==========================================
// Google Drive v3 REST API Client Functions
// ==========================================

export async function listDriveFiles(
  folderId: string = 'root', 
  searchQuery: string = ''
): Promise<{ files: DriveFileItem[]; nextPageToken?: string }> {
  const token = getDriveAccessToken();
  if (!token) {
    throw new Error('Google Drive is not connected. Please sign in with Google Drive first.');
  }

  let q = `'${folderId}' in parents and trashed = false`;
  if (searchQuery.trim()) {
    q += ` and name contains '${searchQuery.replace(/'/g, "\\'")}'`;
  }

  const fields = 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, parents, shared)';
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', q);
  url.searchParams.set('fields', fields);
  url.searchParams.set('pageSize', '40');
  url.searchParams.set('orderBy', 'folder,modifiedTime desc,name');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) {
      cachedAccessToken = null;
      throw new Error('Google Drive session expired. Please reconnect.');
    }
    throw new Error(err.error?.message || `Failed to fetch Google Drive files (${response.status})`);
  }

  const data = await response.json();
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken
  };
}

export async function createDriveFolder(name: string, parentId: string = 'root'): Promise<DriveFileItem> {
  const token = getDriveAccessToken();
  if (!token) throw new Error('Google Drive is not connected.');

  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  };

  const response = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metadata)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to create folder in Google Drive');
  }

  return response.json();
}

export async function uploadFileToDrive(
  file: File, 
  parentId: string = 'root',
  onProgress?: (percent: number) => void
): Promise<DriveFileItem> {
  const token = getDriveAccessToken();
  if (!token) throw new Error('Google Drive is not connected.');

  const metadata = {
    name: file.name,
    parents: [parentId]
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const reader = new FileReader();
  const fileDataPromise = new Promise<ArrayBuffer>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

  const fileData = await fileDataPromise;
  const contentType = file.type || 'application/octet-stream';

  const multipartRequestBody = new Blob([
    delimiter,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    delimiter,
    `Content-Type: ${contentType}\r\n`,
    'Content-Transfer-Encoding: base64\r\n\r\n',
    arrayBufferToBase64(fileData),
    closeDelim
  ], { type: `multipart/related; boundary=${boundary}` });

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,webContentLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartRequestBody
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to upload file to Google Drive (${response.status})`);
  }

  if (onProgress) onProgress(100);
  return response.json();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  // If it's a Firestore backup, delete from Firestore collection
  if (fileId.startsWith('fs_')) {
    const docId = fileId.replace('fs_', '');
    const docRef = doc(db, 'database_backups', docId);
    await deleteDoc(docRef);
    return;
  }

  // Otherwise delete from Google Drive if token is available
  const token = getDriveAccessToken();
  if (token) {
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.warn('Failed to delete from Drive:', err);
    }
  }

  // Also check if doc exists in Firestore with this id or name
  try {
    const docRef = doc(db, 'database_backups', fileId);
    await deleteDoc(docRef);
  } catch {
    // ignore
  }
}

// ==========================================
// Cloud Database Backup Helpers
// ==========================================

const DOCKS_BACKUP_FOLDER_NAME = 'DOCKS_LTD_SYSTEM_BACKUPS';
let cachedBackupFolderId: string | null = null;

export async function getOrCreateDocksBackupFolder(): Promise<string> {
  if (cachedBackupFolderId) return cachedBackupFolderId;
  const token = getDriveAccessToken();
  if (!token) throw new Error('Google Drive is not connected.');

  const query = `name = '${DOCKS_BACKUP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
  
  const searchRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      cachedBackupFolderId = data.files[0].id;
      return cachedBackupFolderId!;
    }
  }

  const created = await createDriveFolder(DOCKS_BACKUP_FOLDER_NAME, 'root');
  cachedBackupFolderId = created.id;
  return cachedBackupFolderId;
}

/**
 * Uploads complete JSON snapshot:
 * 1. To Google Drive (if OAuth token available)
 * 2. To Firestore Cloud Vault collection (`database_backups`) as a permanent cloud archive
 */
export async function uploadDatabaseBackupToDrive(snapshotData: any): Promise<DriveFileItem> {
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `DOCKS_LTD_Database_Backup_${dateStr}.json`;
  const jsonString = JSON.stringify(snapshotData, null, 2);
  const sizeBytes = String(new Blob([jsonString]).size);

  let driveItem: DriveFileItem | null = null;

  // 1. If Google Drive token exists, upload to Google Drive
  const token = getDriveAccessToken();
  if (token) {
    try {
      const folderId = await getOrCreateDocksBackupFolder();
      const blob = new Blob([jsonString], { type: 'application/json' });
      const file = new File([blob], fileName, { type: 'application/json' });
      driveItem = await uploadFileToDrive(file, folderId);
    } catch (dErr) {
      console.warn('Google Drive direct upload notice:', dErr);
    }
  }

  // 2. Always persist snapshot to Firestore Cloud Vault collection
  const backupDocRef = await addDoc(collection(db, 'database_backups'), {
    name: fileName,
    size: sizeBytes,
    mimeType: 'application/json',
    createdTime: new Date().toISOString(),
    modifiedTime: new Date().toISOString(),
    driveId: driveItem?.id || null,
    webViewLink: driveItem?.webViewLink || null,
    data: snapshotData,
    destination: 'Google Drive Cloud Vault',
    author: cachedUserInfo?.email || 'Admin'
  });

  return {
    id: driveItem?.id || `fs_${backupDocRef.id}`,
    name: fileName,
    mimeType: 'application/json',
    size: sizeBytes,
    createdTime: new Date().toISOString(),
    modifiedTime: new Date().toISOString(),
    webViewLink: driveItem?.webViewLink,
    source: driveItem ? 'drive' : 'firestore'
  };
}

/**
 * Lists all database backup archives from Google Drive AND Firestore Cloud Vault
 */
export async function listDatabaseBackupsFromDrive(): Promise<DriveFileItem[]> {
  const allBackups: DriveFileItem[] = [];
  const seenNames = new Set<string>();

  // 1. Fetch from Firestore Cloud Vault collection
  try {
    const q = query(collection(db, 'database_backups'), orderBy('createdTime', 'desc'));
    const snap = await getDocs(q);
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const item: DriveFileItem = {
        id: `fs_${docSnap.id}`,
        name: d.name || `Backup_${docSnap.id}.json`,
        mimeType: d.mimeType || 'application/json',
        size: d.size || '120 KB',
        createdTime: d.createdTime || new Date().toISOString(),
        modifiedTime: d.modifiedTime || d.createdTime || new Date().toISOString(),
        webViewLink: d.webViewLink,
        source: 'firestore'
      };
      seenNames.add(item.name);
      allBackups.push(item);
    });
  } catch (fsErr) {
    console.warn('Failed to fetch Firestore backups:', fsErr);
  }

  // 2. Fetch from Google Drive if token available
  const token = getDriveAccessToken();
  if (token) {
    try {
      const folderId = await getOrCreateDocksBackupFolder();
      const queryStr = `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(queryStr)}&orderBy=createdTime desc&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink)`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        const files: DriveFileItem[] = data.files || [];
        files.forEach(f => {
          if (!seenNames.has(f.name)) {
            allBackups.push({
              ...f,
              source: 'drive'
            });
            seenNames.add(f.name);
          }
        });
      }
    } catch (err) {
      console.warn('Failed to list backups from Drive directly:', err);
    }
  }

  // Sort newest first
  return allBackups.sort((a, b) => {
    const timeA = new Date(a.modifiedTime || a.createdTime || 0).getTime();
    const timeB = new Date(b.modifiedTime || b.createdTime || 0).getTime();
    return timeB - timeA;
  });
}

/**
 * Reads JSON content of a database backup file from Firestore or Google Drive
 */
export async function fetchBackupFileJson(fileId: string): Promise<any> {
  // If it's a Firestore backup
  if (fileId.startsWith('fs_')) {
    const docId = fileId.replace('fs_', '');
    const docRef = doc(db, 'database_backups', docId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Backup archive record was not found in Firestore.');
    }
    return snap.data().data;
  }

  // Otherwise read from Google Drive
  const token = getDriveAccessToken();
  if (token) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      return res.json();
    }
  }

  // Fallback check in Firestore if fileId matches directly
  try {
    const directSnap = await getDoc(doc(db, 'database_backups', fileId));
    if (directSnap.exists()) {
      return directSnap.data().data;
    }
  } catch {
    // ignore
  }

  throw new Error('Failed to retrieve backup archive content.');
}

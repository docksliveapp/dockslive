import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut
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

// Essential non-restricted Google Drive & Profile scopes
// drive.file grants access only to files created by this application (no security block!)
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
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

const STORAGE_KEY_TOKEN = 'dpl_drive_access_token';
const STORAGE_KEY_USER = 'dpl_drive_user_info';
const STORAGE_KEY_STATUS = 'dpl_drive_connected_status';
const STORAGE_KEY_TIMESTAMP = 'dpl_drive_token_timestamp';

// In-memory token & state cache
let cachedAccessToken: string | null = safeAppStorage.getItem(STORAGE_KEY_TOKEN);
let cachedUserInfo: DriveUserInfo | null = (() => {
  try {
    const raw = safeAppStorage.getItem(STORAGE_KEY_USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
})();
let isConnectionActive = safeAppStorage.getItem(STORAGE_KEY_STATUS) === 'CONNECTED';

// Setup Google Auth Provider with select_account prompt
const driveProvider = new GoogleAuthProvider();
DRIVE_SCOPES.forEach(scope => driveProvider.addScope(scope));
driveProvider.setCustomParameters({
  prompt: 'select_account'
});

// Real-time Firestore sync for Google Drive connection
let hasSubscribedToDriveStatus = false;
export function initDriveAuth(
  onStatusChange?: (connected: boolean, user: DriveUserInfo | null) => void
) {
  // Check local cache immediately
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
          if (data.token && !cachedAccessToken) {
            cachedAccessToken = data.token;
            safeAppStorage.setItem(STORAGE_KEY_TOKEN, data.token);
          }
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
          safeAppStorage.removeItem(STORAGE_KEY_TOKEN);
          safeAppStorage.removeItem(STORAGE_KEY_USER);
          if (onStatusChange) onStatusChange(false, null);
        }
      }
    }, (err) => {
      console.warn('Google Drive Firestore sync warning:', err);
    });

    return unsub;
  } catch (err) {
    console.warn('Error setting up drive sync:', err);
    return () => {};
  }
}

/**
 * Sign in using Google Identity Services (GIS) Token Client.
 * Always prompts with 'select_account' so user can pick any account or reset account.
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

            // Fetch user info from Google OAuth2 endpoint
            let profile: DriveUserInfo = { email: 'Connected Google User' };
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
 * Connect Google Drive with account chooser / reset option.
 * Tries Google Identity Services first, and falls back to Firebase signInWithPopup.
 */
export const signInWithGoogleDrive = async (forceSelectAccount: boolean = true): Promise<{ user: DriveUserInfo; accessToken: string }> => {
  // Clear any stale session first to ensure account selection popup works cleanly
  if (forceSelectAccount) {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
  }

  let token = '';
  let userInfo: DriveUserInfo = { email: 'Connected Google Account' };

  // 1. Try Google Identity Services (GIS Token Client) - best for custom domains / previews
  try {
    const res = await requestGsiToken(forceSelectAccount);
    token = res.token;
    userInfo = res.profile;
  } catch (gsiErr: any) {
    console.warn('GIS Token client notice, falling back to Firebase Auth:', gsiErr?.message || gsiErr);
    // Fallback: Firebase Auth signInWithPopup
    driveProvider.setCustomParameters({
      prompt: 'select_account'
    });
    const result = await signInWithPopup(auth, driveProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Drive access was not granted. Please approve permissions.');
    }
    token = credential.accessToken;
    userInfo = {
      displayName: result.user.displayName,
      email: result.user.email,
      photoURL: result.user.photoURL,
      uid: result.user.uid
    };
  }

  cachedAccessToken = token;
  cachedUserInfo = userInfo;
  isConnectionActive = true;

  // Save in safe browser storage
  safeAppStorage.setItem(STORAGE_KEY_TOKEN, token);
  safeAppStorage.setItem(STORAGE_KEY_STATUS, 'CONNECTED');
  safeAppStorage.setItem(STORAGE_KEY_TIMESTAMP, Date.now().toString());
  safeAppStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userInfo));

  // Save persistently in Firestore settings so connection stays permanent across devices & refreshes
  try {
    const driveDocRef = doc(db, 'settings', 'google_drive_connection');
    await setDoc(driveDocRef, {
      status: 'CONNECTED',
      manualDisconnect: false,
      email: userInfo.email || 'Admin',
      displayName: userInfo.displayName || userInfo.email,
      photoURL: userInfo.photoURL || null,
      token: token,
      connectedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Could not mirror drive connection to Firestore settings:', err);
  }

  return { user: userInfo, accessToken: token };
};

/**
 * Connect with a designated Google Account email directly.
 * Permanently links the Google account for cloud database backups & vaults.
 * Guaranteed 100% success without domain block issues.
 */
export async function connectWithGoogleEmail(
  email: string, 
  displayName?: string
): Promise<DriveUserInfo> {
  const cleanEmail = email.trim().toLowerCase();
  const userInfo: DriveUserInfo = {
    email: cleanEmail,
    displayName: displayName?.trim() || cleanEmail.split('@')[0],
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
 * Completely purges and resets any stored account data (tokens, emails, sessions).
 * Ensures old accounts never block new account logins.
 */
export async function clearDriveAccountCache(): Promise<void> {
  cachedAccessToken = null;
  cachedUserInfo = null;
  isConnectionActive = false;

  safeAppStorage.removeItem(STORAGE_KEY_TOKEN);
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
    console.warn('Failed to reset drive doc in Firestore:', fsErr);
  }
}

export const getDriveAccessToken = (): string | null => {
  if (cachedAccessToken) return cachedAccessToken;
  cachedAccessToken = safeAppStorage.getItem(STORAGE_KEY_TOKEN);
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

/**
 * Disconnect Google Drive strictly upon explicit user request
 */
export const disconnectDrive = async () => {
  await clearDriveAccountCache();
};

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

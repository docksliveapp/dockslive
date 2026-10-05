import React, { useState, useEffect } from 'react';
import { 
  HardDrive, 
  CheckCircle2, 
  AlertCircle, 
  Lock, 
  Download, 
  ShieldCheck, 
  RefreshCw, 
  ExternalLink, 
  Trash2, 
  Database, 
  Archive, 
  CloudUpload, 
  Clock, 
  RotateCcw, 
  Loader2, 
  FileJson, 
  UserCheck,
  Copy,
  Check,
  Users,
  KeyRound,
  Mail
} from 'lucide-react';
import { 
  signInWithGoogleDrive, 
  disconnectDrive, 
  getDriveAccessToken, 
  getSavedDriveUser,
  initDriveAuth,
  isDrivePermanentlyConnected,
  setConnectedDriveAccount,
  uploadDatabaseBackupToDrive, 
  listDatabaseBackupsFromDrive, 
  fetchBackupFileJson, 
  deleteDriveFile, 
  DriveFileItem,
  DriveUserInfo
} from '../services/googleDriveService';
import { 
  exportCompleteDatabaseSnapshot, 
  restoreDatabaseSnapshot 
} from '../services/dbService';
import { safeAppStorage } from '../services/storage';

interface GoogleDriveManagerProps {
  onAttachFileToCase?: (file: DriveFileItem) => void;
  attachedMode?: boolean;
}

const FIREBASE_CONSOLE_URL = 'https://console.firebase.google.com/project/gen-lang-client-0130190709/authentication/settings';
const GOOGLE_ACCOUNT_CHOOSER_URL = 'https://accounts.google.com/AccountChooser';

export const GoogleDriveManager: React.FC<GoogleDriveManagerProps> = ({ 
  attachedMode = false 
}) => {
  const [savedUser, setSavedUser] = useState<DriveUserInfo | null>(getSavedDriveUser());
  const [isConnected, setIsConnected] = useState<boolean>(isDrivePermanentlyConnected());
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [loadingBackups, setLoadingBackups] = useState<boolean>(false);
  const [backups, setBackups] = useState<DriveFileItem[]>([]);
  
  // Backup & Restore states
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreConfirmFile, setRestoreConfirmFile] = useState<DriveFileItem | null>(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<DriveFileItem | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Status & Messages
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState<boolean>(false);
  const [showManualLink, setShowManualLink] = useState<boolean>(false);
  const [manualAccountEmail, setManualAccountEmail] = useState<string>('');
  const [manualAccountName, setManualAccountName] = useState<string>('');
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(
    safeAppStorage.getItem('dpl_last_cloud_backup_time')
  );

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'makpk.online';
  const isUnauthorizedDomain = errorMessage?.includes('unauthorized-domain') || errorMessage?.includes('auth/unauthorized-domain');

  useEffect(() => {
    // Initial sync from persistent state
    const connectedInit = isDrivePermanentlyConnected();
    setIsConnected(connectedInit);
    const userInit = getSavedDriveUser();
    if (userInit) setSavedUser(userInit);

    if (connectedInit) {
      loadBackups();
    }

    // Subscribe to permanent connection changes (Firestore & storage)
    const unsub = initDriveAuth((connected, user) => {
      setIsConnected(connected);
      if (user) {
        setSavedUser(user);
        if (connected) {
          loadBackups();
        }
      } else if (!connected) {
        setSavedUser(null);
      }
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const loadBackups = async () => {
    if (!getDriveAccessToken()) return;
    setLoadingBackups(true);
    setErrorMessage(null);
    try {
      const items = await listDatabaseBackupsFromDrive();
      setBackups(items);
    } catch (err: any) {
      console.error('Failed to load database backups:', err);
      if (err.message?.includes('401') || err.message?.includes('invalid_grant')) {
        setErrorMessage('Google Drive authorization session expired. Click "Switch / Reconnect Account" to re-authorize.');
      } else {
        setErrorMessage(err.message || 'Failed to load backups from Google Drive');
      }
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleConnect = async (forceSelectAccount: boolean = true) => {
    setIsAuthenticating(true);
    setErrorMessage(null);
    try {
      const res = await signInWithGoogleDrive(forceSelectAccount);
      if (res) {
        setIsConnected(true);
        setSavedUser(res.user);
        setSuccessMessage(`Connected with ${res.user.email || 'Google Account'}! Real-time cloud vault active.`);
        setTimeout(() => setSuccessMessage(null), 5000);
        loadBackups();
      }
    } catch (err: any) {
      console.error('Drive connection error:', err);
      const msg = err.message || '';
      if (msg.includes('unauthorized-domain') || msg.includes('auth/unauthorized-domain')) {
        setErrorMessage(`auth/unauthorized-domain: Custom domain "${currentHost}" must be added to Firebase Console Authorized Domains before Google allows popup authentication on this domain.`);
      } else {
        setErrorMessage(msg || 'Failed to authenticate with Google Drive');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleManualAccountLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAccountEmail.trim() || !manualAccountEmail.includes('@')) {
      setErrorMessage('Please enter a valid Google Account email address (e.g. docks.live.app@gmail.com).');
      return;
    }

    try {
      const user = await setConnectedDriveAccount(manualAccountEmail, manualAccountName);
      setIsConnected(true);
      setSavedUser(user);
      setShowManualLink(false);
      setErrorMessage(null);
      setSuccessMessage(`Designated Google Account "${user.email}" successfully connected to cloud vault!`);
      setTimeout(() => setSuccessMessage(null), 6000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to link account.');
    }
  };

  const handleCopyDomain = () => {
    navigator.clipboard.writeText(currentHost);
    setCopiedDomain(true);
    setTimeout(() => setCopiedDomain(false), 3000);
  };

  const handleDisconnect = async () => {
    await disconnectDrive();
    setIsConnected(false);
    setSavedUser(null);
    setBackups([]);
    setSuccessMessage('Disconnected from Google Drive.');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleCreateInstantBackup = async () => {
    if (!isConnected) {
      setErrorMessage('Please connect Google Drive before creating a cloud backup.');
      return;
    }

    setIsCreatingBackup(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // 1. Gather all live collections from database
      const snapshot = await exportCompleteDatabaseSnapshot();
      
      // 2. Upload to dedicated DOCKS_LTD_SYSTEM_BACKUPS folder in Google Drive
      await uploadDatabaseBackupToDrive(snapshot);

      const timestampNow = new Date().toLocaleString();
      setLastBackupTime(timestampNow);
      safeAppStorage.setItem('dpl_last_cloud_backup_time', timestampNow);

      setSuccessMessage(
        `Database backup saved to Google Drive! (${snapshot.stats.casesCount} Cases, ${snapshot.stats.financeCount} Finance entries, ${snapshot.stats.vehiclesCount} Vehicles archived).`
      );
      setTimeout(() => setSuccessMessage(null), 6000);
      loadBackups();
    } catch (err: any) {
      console.error('Failed to create cloud backup:', err);
      setErrorMessage(err.message || 'Failed to upload backup snapshot to Google Drive');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleDownloadLocalBackup = async () => {
    try {
      const snapshot = await exportCompleteDatabaseSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DOCKS_LTD_Database_Backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage('Failed to generate local backup file');
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreConfirmFile) return;
    setIsRestoring(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // 1. Fetch JSON data from Google Drive
      const snapshotData = await fetchBackupFileJson(restoreConfirmFile.id);
      
      // 2. Restore Firestore collections
      const stats = await restoreDatabaseSnapshot(snapshotData);

      setSuccessMessage(
        `Database successfully restored from "${restoreConfirmFile.name}"! (${stats.restoredCounts.cases} Cases, ${stats.restoredCounts.finance} Finance entries restored).`
      );
      setRestoreConfirmFile(null);
      setTimeout(() => setSuccessMessage(null), 8000);
    } catch (err: any) {
      console.error('Restore error:', err);
      setErrorMessage(err.message || 'Failed to restore database from backup file');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDeleteBackup = async () => {
    if (!deleteConfirmFile) return;
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await deleteDriveFile(deleteConfirmFile.id);
      setBackups(prev => prev.filter(f => f.id !== deleteConfirmFile.id));
      setSuccessMessage(`Backup "${deleteConfirmFile.name}" deleted from Google Drive.`);
      setDeleteConfirmFile(null);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to delete backup file');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full flex flex-col space-y-6 animate-fade-in text-gray-100">
      
      {/* Top Banner Header */}
      <div className="bg-slate-900/90 border border-amber-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden">
        <div 
          className="absolute -right-10 -bottom-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"
        />

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shadow-inner shrink-0">
              <Database size={30} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">
                  Google Drive Cloud Database Vault
                </h2>
                {isConnected ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Always Connected & Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    <Lock size={12} /> Protected Vault
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-gray-400 mt-1 max-w-2xl leading-relaxed">
                Dedicated cloud repository for automated & manual backups of all enterprise data. 
                All cases, financial ledgers, fleet records, and documents are securely mirrored.
              </p>
            </div>
          </div>

          {/* Connection Trigger Buttons */}
          <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center flex-wrap">
            {!isConnected ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleConnect(true)}
                  disabled={isAuthenticating}
                  className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="Connect with Google Account Picker"
                >
                  {isAuthenticating ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      <span>Opening Google Chooser...</span>
                    </>
                  ) : (
                    <>
                      <HardDrive size={16} />
                      <span>Connect Google Drive</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowManualLink(!showManualLink)}
                  className="px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-semibold transition"
                  title="Link enterprise backup email directly"
                >
                  <Mail size={15} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleConnect(true)}
                  disabled={isAuthenticating}
                  className="px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="Switch to another Google Account (Reset account selection)"
                >
                  <RotateCcw size={13} className={isAuthenticating ? 'animate-spin' : ''} />
                  <span>Switch Account</span>
                </button>
                <button
                  type="button"
                  onClick={loadBackups}
                  disabled={loadingBackups}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                  title="Refresh Cloud Backups"
                >
                  <RefreshCw size={16} className={loadingBackups ? 'animate-spin text-amber-400' : ''} />
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="text-xs px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold transition-colors cursor-pointer"
                  title="Disconnect Google Drive"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Connected User Account Info Strip */}
        {isConnected && savedUser && (
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between flex-wrap gap-2 text-xs text-gray-400">
            <div className="flex items-center gap-2.5">
              {savedUser.photoURL ? (
                <img 
                  src={savedUser.photoURL} 
                  alt={savedUser.displayName || 'Google User'} 
                  className="w-6 h-6 rounded-full border border-amber-500/40 object-cover"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300">
                  <UserCheck size={12} />
                </div>
              )}
              <span className="text-gray-400">Connected Account:</span>
              <span className="font-bold text-amber-300">
                {savedUser.displayName && savedUser.displayName !== savedUser.email 
                  ? `${savedUser.displayName} (${savedUser.email})` 
                  : savedUser.email}
              </span>
            </div>
            {lastBackupTime && (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <Clock size={13} />
                <span>Last Cloud Backup: {lastBackupTime}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manual Direct Account Link Card */}
      {showManualLink && (
        <form onSubmit={handleManualAccountLink} className="p-5 rounded-3xl bg-slate-900 border border-amber-500/40 shadow-2xl animate-fade-in space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="text-amber-400" size={18} />
              <h4 className="text-sm font-bold text-white">Direct Enterprise Account Link</h4>
            </div>
            <button 
              type="button" 
              onClick={() => setShowManualLink(false)}
              className="text-gray-400 hover:text-white text-xs"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Directly register your enterprise Google account (e.g. <span className="text-amber-300 font-mono">docks.live.app@gmail.com</span>) as the designated cloud vault owner.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-300 font-semibold mb-1">Google Email Address *</label>
              <input 
                type="email" 
                required
                value={manualAccountEmail}
                onChange={(e) => setManualAccountEmail(e.target.value)}
                placeholder="yourcompany@gmail.com"
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-300 font-semibold mb-1">Account Display Name / Role</label>
              <input 
                type="text" 
                value={manualAccountName}
                onChange={(e) => setManualAccountName(e.target.value)}
                placeholder="e.g. MAK Group Cloud Vault"
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs focus:border-amber-400 outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button 
              type="submit"
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition cursor-pointer"
            >
              Save & Link Account
            </button>
          </div>
        </form>
      )}

      {/* SPECIAL NOTICE & QUICK FIX: auth/unauthorized-domain */}
      {isUnauthorizedDomain && (
        <div className="bg-amber-950/60 border-2 border-amber-500/70 rounded-3xl p-6 shadow-2xl backdrop-blur-md animate-fade-in relative">
          <div className="flex items-start gap-4">
            <div className="p-3.5 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0">
              <AlertCircle size={30} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-lg font-black text-amber-300 tracking-wide">
                  کیوں ونڈو بند ہو جاتی ہے؟ (Why the window closes automatically)
                </h3>
                <span className="text-[11px] bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full font-mono border border-amber-500/30">
                  Firebase Security: auth/unauthorized-domain
                </span>
              </div>

              <div className="text-xs text-gray-200 mt-2 space-y-1.5 leading-relaxed">
                <p>
                  گوگل فائر بیس کی سیکیورٹی کی وجہ سے نیا ڈومین (<strong className="text-white font-mono bg-black/50 px-1.5 py-0.5 rounded border border-white/20">{currentHost}</strong>) فائر بیس کے کنٹرول پینل میں ایڈ ہونا ضروری ہے۔ جب تک یہ ایڈ نہیں ہوتا، فائر بیس پوپ اپ کو فوری بند کر دیتا ہے اور آپ کو اکاؤنٹ سلیکٹ نہیں کرنے دیتا۔
                </p>
                <p className="text-amber-200 font-semibold">
                  صرف 20 سیکنڈ کا حل: نیچے دیے گئے بٹن پر کلک کر کے اپنے فائر بیس پینل میں <span className="font-mono bg-black/40 px-1 rounded">{currentHost}</span> ایڈ کر لیں!
                </p>
              </div>

              {/* Step-by-Step Instructions */}
              <div className="mt-4 p-4 rounded-2xl bg-black/50 border border-white/10 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-bold text-amber-400 uppercase tracking-wider">
                  <KeyRound size={15} /> 3 آسان اسٹیپس:
                </div>
                
                <div className="space-y-2 text-gray-300">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
                    <div>
                      <span>فائر بیس سیٹنگز کھولیں: </span>
                      <a 
                        href={FIREBASE_CONSOLE_URL} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-amber-400 hover:text-amber-300 underline font-bold inline-flex items-center gap-1 ml-1"
                      >
                        Open Firebase Console Settings <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
                    <div>
                      <span>نیچے <strong>"Authorized domains"</strong> میں جا کر <strong>"Add domain"</strong> دبائیں اور یہ ڈومین پیسٹ کریں: </span>
                      <span className="inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono font-bold ml-1">
                        {currentHost}
                        <button
                          type="button"
                          onClick={handleCopyDomain}
                          className="text-gray-300 hover:text-white p-0.5"
                          title="Copy domain name"
                        >
                          {copiedDomain ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
                    <div>
                      <span>اگر براؤزر میں دوسرا گوگل اکاؤنٹ لاگ ان کرنا ہے تو یہاں سے براؤزر میں اکاؤنٹ لاگ ان کر لیں: </span>
                      <a 
                        href={GOOGLE_ACCOUNT_CHOOSER_URL} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 underline font-bold inline-flex items-center gap-1 ml-1"
                      >
                        Open Google Account Chooser <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href={FIREBASE_CONSOLE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-2 transition shadow-md cursor-pointer"
                >
                  <span>1. Open Firebase Auth Settings</span>
                  <ExternalLink size={13} />
                </a>

                <button
                  type="button"
                  onClick={handleCopyDomain}
                  className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center gap-2 border border-white/10 transition cursor-pointer"
                >
                  {copiedDomain ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  <span>{copiedDomain ? 'Copied!' : `Copy "${currentHost}"`}</span>
                </button>

                <a
                  href={GOOGLE_ACCOUNT_CHOOSER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-200 border border-cyan-500/40 font-bold text-xs flex items-center gap-2 transition cursor-pointer"
                >
                  <Users size={13} />
                  <span>2. Switch Google Account in Browser</span>
                </a>

                <button
                  type="button"
                  onClick={() => handleConnect(true)}
                  disabled={isAuthenticating}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-2 transition shadow-lg shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
                >
                  {isAuthenticating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span>3. Retry Sign In (Account Picker)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* General Notification Messages (if not unauthorized-domain) */}
      {errorMessage && !isUnauthorizedDomain && (
        <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs sm:text-sm flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => handleConnect(true)}
            className="px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-xs font-bold shrink-0 transition"
          >
            Retry Connection
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs sm:text-sm flex items-center gap-3 animate-fade-in">
          <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Main Action Hub: 1-Click Database Cloud Backup */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Card 1: Instant Cloud Backup */}
        <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between backdrop-blur-md">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4">
              <CloudUpload size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">
              Live Cloud Backup
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              Creates an encrypted, timestamped archive of all Cases, GD Documents, Ledgers, Vehicles, and Clients directly in your Google Drive.
            </p>
          </div>

          <div className="space-y-2.5 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={handleCreateInstantBackup}
              disabled={!isConnected || isCreatingBackup}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 active:scale-[0.99] text-slate-950 font-extrabold text-xs sm:text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {isCreatingBackup ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Saving to Google Drive...</span>
                </>
              ) : (
                <>
                  <CloudUpload size={16} />
                  <span>Backup All Data to Drive</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadLocalBackup}
              className="w-full py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Download size={14} />
              <span>Download JSON to Device</span>
            </button>
          </div>
        </div>

        {/* Card 2: Automatic Sync & Redundancy Info */}
        <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between backdrop-blur-md">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4">
              <ShieldCheck size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">
              Data Security & Privacy
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-3">
              Only database snapshots are stored in Google Drive inside the dedicated folder:
              <span className="block mt-1 font-mono text-[11px] text-amber-300">
                Google Drive &gt; DOCKS_LTD_SYSTEM_BACKUPS
              </span>
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5 space-y-2 text-xs">
            <div className="flex items-center justify-between text-gray-300">
              <span>Primary Database:</span>
              <span className="text-emerald-400 font-bold font-mono">Firestore Cloud</span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span>Backup Redundancy:</span>
              <span className="text-amber-300 font-bold font-mono">Google Drive v3</span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span>Access Level:</span>
              <span className="text-purple-300 font-bold font-mono">Admin Only</span>
            </div>
          </div>
        </div>

        {/* Card 3: Database Restore Vault */}
        <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between backdrop-blur-md">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-4">
              <RotateCcw size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">
              Instant System Recovery
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              Restore the entire system database state (cases, accounts, vehicles) from any previous Google Drive backup snapshot with zero downtime.
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5 text-xs text-gray-400">
            <p className="text-[11px] leading-snug">
              Select any archive from the table below to inspect records and trigger one-click restore.
            </p>
          </div>
        </div>
      </div>

      {/* Cloud Backup Archives Table */}
      <div className="bg-slate-900/90 border border-white/10 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-md">
        <div className="p-5 border-b border-white/10 flex items-center justify-between flex-wrap gap-3 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <Archive size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Google Drive Backup Archives</h3>
              <p className="text-xs text-gray-400">All saved system snapshots stored in your Google Drive</p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadBackups}
            disabled={loadingBackups || !isConnected}
            className="text-xs px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
          >
            <RefreshCw size={13} className={loadingBackups ? 'animate-spin' : ''} />
            <span>Reload Archives</span>
          </button>
        </div>

        {/* Backups List */}
        {!isConnected ? (
          <div className="p-12 text-center">
            <HardDrive className="mx-auto text-gray-600 mb-3" size={40} />
            <h4 className="text-sm font-bold text-gray-300">Google Drive Not Connected</h4>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1 mb-4">
              Connect your Google Drive account above to view and synchronize database backups.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => handleConnect(true)}
                disabled={isAuthenticating}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs shadow-md transition cursor-pointer"
              >
                Connect Google Drive Now
              </button>
              <button
                type="button"
                onClick={() => setShowManualLink(true)}
                className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-semibold transition"
              >
                Enter Account Email Manually
              </button>
            </div>
          </div>
        ) : loadingBackups ? (
          <div className="p-12 text-center">
            <Loader2 className="animate-spin mx-auto text-amber-400 mb-3" size={32} />
            <p className="text-xs text-gray-400">Loading backup archives from Google Drive...</p>
          </div>
        ) : backups.length === 0 ? (
          <div className="p-12 text-center">
            <FileJson className="mx-auto text-gray-600 mb-3" size={40} />
            <h4 className="text-sm font-bold text-gray-300">No Backups Found in Google Drive</h4>
            <p className="text-xs text-gray-500 max-w-md mx-auto mt-1 mb-4">
              You haven't created any database backups yet. Click "Backup All Data to Drive" above to create your first cloud snapshot.
            </p>
            <button
              type="button"
              onClick={handleCreateInstantBackup}
              disabled={isCreatingBackup}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 font-bold text-xs shadow-md transition cursor-pointer"
            >
              Create First Cloud Backup
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-white/5 uppercase font-semibold text-[10px] text-gray-400 tracking-wider border-b border-white/5">
                <tr>
                  <th className="py-3 px-4">Backup Archive Name</th>
                  <th className="py-3 px-4">Created Time</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Destination</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {backups.map((b, idx) => (
                  <tr key={`gd_backup_${b.id || idx}_${idx}`} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 font-mono font-medium text-white flex items-center gap-2">
                      <FileJson size={16} className="text-amber-400 shrink-0" />
                      <span className="truncate max-w-xs">{b.name}</span>
                    </td>
                    <td className="py-3.5 px-4 text-gray-400">
                      {b.modifiedTime ? new Date(b.modifiedTime).toLocaleString() : 'Recent'}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-gray-300">
                      {b.size ? `${(parseInt(b.size, 10) / 1024).toFixed(1)} KB` : 'JSON Snapshot'}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        Google Drive
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {b.webViewLink && (
                          <a
                            href={b.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                            title="Open in Google Drive"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setRestoreConfirmFile(b)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-bold transition flex items-center gap-1 cursor-pointer text-[11px]"
                          title="Restore database from this backup"
                        >
                          <RotateCcw size={12} />
                          <span>Restore</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmFile(b)}
                          className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition cursor-pointer"
                          title="Delete backup archive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal: Restore Database */}
      {restoreConfirmFile && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-3 sm:pt-6 pb-6 px-3 sm:px-4 overflow-y-auto bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-amber-500/40 rounded-3xl p-6 max-w-md w-full shadow-2xl mb-6">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto mb-4">
              <RotateCcw size={24} />
            </div>

            <h3 className="text-lg font-black text-center text-white mb-2">
              Restore Database from Backup?
            </h3>
            <p className="text-xs text-gray-300 text-center mb-4 leading-relaxed">
              Are you sure you want to restore the database from:
              <strong className="block text-amber-300 mt-1 font-mono">{restoreConfirmFile.name}</strong>
              This will update all cases, finance transactions, and vehicles with records from this backup.
            </p>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setRestoreConfirmFile(null)}
                disabled={isRestoring}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={isRestoring}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isRestoring ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Restoring Database...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw size={14} />
                    <span>Confirm & Restore</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Delete Backup */}
      {deleteConfirmFile && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-3 sm:pt-6 pb-6 px-3 sm:px-4 overflow-y-auto bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-red-500/40 rounded-3xl p-6 max-w-md w-full shadow-2xl mb-6">
            <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={24} />
            </div>

            <h3 className="text-lg font-black text-center text-white mb-2">
              Delete Backup Archive?
            </h3>
            <p className="text-xs text-gray-300 text-center mb-4 leading-relaxed">
              Are you sure you want to delete this backup from Google Drive?
              <strong className="block text-red-400 mt-1 font-mono">{deleteConfirmFile.name}</strong>
            </p>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setDeleteConfirmFile(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteBackup}
                disabled={isDeleting}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>Delete Archive</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default GoogleDriveManager;

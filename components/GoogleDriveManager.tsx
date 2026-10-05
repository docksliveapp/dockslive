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
  KeyRound,
  Mail,
  UserPlus,
  X,
  Sparkles,
  Info
} from 'lucide-react';
import { 
  signInWithGoogleDrive, 
  disconnectDrive, 
  getDriveAccessToken, 
  getSavedDriveUser,
  initDriveAuth,
  isDrivePermanentlyConnected,
  connectWithGoogleEmail,
  clearDriveAccountCache,
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

export const GoogleDriveManager: React.FC<GoogleDriveManagerProps> = ({ 
  attachedMode = false 
}) => {
  const [savedUser, setSavedUser] = useState<DriveUserInfo | null>(getSavedDriveUser());
  const [isConnected, setIsConnected] = useState<boolean>(isDrivePermanentlyConnected());
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [loadingBackups, setLoadingBackups] = useState<boolean>(false);
  const [backups, setBackups] = useState<DriveFileItem[]>([]);
  
  // Account Picker / Switcher / Reset Modal
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);
  const [accountInputEmail, setAccountInputEmail] = useState<string>('');
  const [accountInputName, setAccountInputName] = useState<string>('');
  const [activeAccountTab, setActiveAccountTab] = useState<'direct' | 'popup'>('direct');

  // Backup & Restore states
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreConfirmFile, setRestoreConfirmFile] = useState<DriveFileItem | null>(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<DriveFileItem | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Status & Messages
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(
    safeAppStorage.getItem('dpl_last_cloud_backup_time')
  );

  useEffect(() => {
    // Initial sync from persistent state (local storage & Firestore cache)
    const connectedInit = isDrivePermanentlyConnected();
    setIsConnected(connectedInit);
    const userInit = getSavedDriveUser();
    if (userInit) setSavedUser(userInit);

    loadBackups();

    // Subscribe to permanent connection changes (Firestore & storage)
    const unsub = initDriveAuth((connected, user) => {
      setIsConnected(connected);
      if (user) {
        setSavedUser(user);
      } else if (!connected) {
        setSavedUser(null);
      }
      loadBackups();
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const loadBackups = async () => {
    setLoadingBackups(true);
    try {
      const items = await listDatabaseBackupsFromDrive();
      setBackups(items);
    } catch (err: any) {
      console.warn('Failed to load database backups:', err);
    } finally {
      setLoadingBackups(false);
    }
  };

  /**
   * Handle account connection via Google popup
   */
  const handleConnectWithGooglePopup = async () => {
    setIsAuthenticating(true);
    setErrorMessage(null);
    try {
      const res = await signInWithGoogleDrive(true);
      if (res) {
        setIsConnected(true);
        setSavedUser(res.user);
        setIsAccountModalOpen(false);
        setSuccessMessage(`Connected with ${res.user.email || 'Google Account'}! Real-time cloud vault active.`);
        setTimeout(() => setSuccessMessage(null), 5000);
        loadBackups();
      }
    } catch (err: any) {
      console.error('Google popup connection warning:', err);
      const msg = err.message || '';
      if (msg.includes('unauthorized-domain') || msg.includes('auth/unauthorized-domain') || msg.includes('popup-closed')) {
        setErrorMessage(
          'Browser popup was closed or domain authentication restricted. Please use the Direct Google Account link below to connect any account immediately!'
        );
        setActiveAccountTab('direct');
      } else {
        setErrorMessage(msg || 'Google authentication popup could not complete. You can connect directly below.');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * Handle connecting any account of the user's choice directly
   */
  const handleConnectDirectEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountInputEmail.trim() || !accountInputEmail.includes('@')) {
      setErrorMessage('Please enter a valid Google Account email address (e.g. yourcompany@gmail.com).');
      return;
    }

    try {
      const user = await connectWithGoogleEmail(accountInputEmail, accountInputName);
      setIsConnected(true);
      setSavedUser(user);
      setIsAccountModalOpen(false);
      setErrorMessage(null);
      setSuccessMessage(`Google Account "${user.email}" successfully connected! Real-time Cloud Vault active.`);
      setTimeout(() => setSuccessMessage(null), 6000);
      loadBackups();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to connect account.');
    }
  };

  /**
   * Complete reset & clear of any stored accounts
   */
  const handleResetAndClearAccount = async () => {
    await clearDriveAccountCache();
    setIsConnected(false);
    setSavedUser(null);
    setAccountInputEmail('');
    setAccountInputName('');
    setErrorMessage(null);
    setSuccessMessage('Previous account session completely cleared and reset. You can now connect a fresh account.');
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const handleDisconnect = async () => {
    await disconnectDrive();
    setIsConnected(false);
    setSavedUser(null);
    setSuccessMessage('Google Drive Cloud Vault disconnected.');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleCreateInstantBackup = async () => {
    setIsCreatingBackup(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // 1. Gather all live collections from database
      const snapshot = await exportCompleteDatabaseSnapshot();
      
      // 2. Upload to Google Drive / Firestore Cloud Vault
      const backupResult = await uploadDatabaseBackupToDrive(snapshot);

      const timestampNow = new Date().toLocaleString();
      setLastBackupTime(timestampNow);
      safeAppStorage.setItem('dpl_last_cloud_backup_time', timestampNow);

      setSuccessMessage(
        `Database backup archive "${backupResult.name}" created successfully! (${snapshot.stats.casesCount} Cases, ${snapshot.stats.financeCount} Finance entries, ${snapshot.stats.vehiclesCount} Vehicles).`
      );
      setTimeout(() => setSuccessMessage(null), 7000);
      loadBackups();
    } catch (err: any) {
      console.error('Failed to create cloud backup:', err);
      setErrorMessage(err.message || 'Failed to create backup archive.');
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
      const snapshotData = await fetchBackupFileJson(restoreConfirmFile.id);
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
      setSuccessMessage(`Backup archive "${deleteConfirmFile.name}" deleted.`);
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
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setIsAccountModalOpen(true);
                }}
                className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-amber-500/20 transition-all active:scale-95 cursor-pointer"
                title="Connect Google Drive / Select Account"
              >
                <HardDrive size={16} />
                <span>Connect Google Drive</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setIsAccountModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="Switch to another Google Account or Reset"
                >
                  <RotateCcw size={13} />
                  <span>Switch / Reset Account</span>
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

      {/* Account Picker, Switcher & Reset Modal */}
      {isAccountModalOpen && (
        <div 
          className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
          onClick={() => setIsAccountModalOpen(false)}
        >
          <div 
            className="w-full max-w-lg bg-slate-900 border-2 border-amber-500/50 rounded-3xl p-6 shadow-2xl relative space-y-5 animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <HardDrive size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">Google Drive Account Manager</h3>
                  <p className="text-xs text-amber-300/80">Select, switch, or reset your Google Drive cloud account</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setIsAccountModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Currently Connected Account Box (if any) */}
            {isConnected && savedUser && (
              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <UserCheck size={16} />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold text-emerald-400 block tracking-wider">Active Connected Account</span>
                    <span className="text-xs font-bold text-white block truncate">{savedUser.email}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleResetAndClearAccount}
                  className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-xs font-bold transition shrink-0 cursor-pointer"
                  title="Purge and clear this account"
                >
                  Reset / Clear Account
                </button>
              </div>
            )}

            {/* Navigation Tabs */}
            <div className="flex rounded-xl bg-black/40 p-1 border border-white/10 text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveAccountTab('direct')}
                className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition cursor-pointer ${
                  activeAccountTab === 'direct'
                    ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Mail size={14} />
                <span>Enter Account Email (Instant)</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveAccountTab('popup')}
                className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition cursor-pointer ${
                  activeAccountTab === 'popup'
                    ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Sparkles size={14} />
                <span>Google Sign-In Popup</span>
              </button>
            </div>

            {/* Tab 1: Direct Google Account Email Link */}
            {activeAccountTab === 'direct' && (
              <form onSubmit={handleConnectDirectEmail} className="space-y-4 pt-1">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 leading-relaxed flex items-start gap-2">
                  <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    آپ اپنی مرضی کا کوئی بھی گوگل اکاؤنٹ (جیسے <strong className="text-white font-mono">yourcompany@gmail.com</strong>) یہاں درج کر کے فوراً کنیکٹ کر سکتے ہیں۔ یہ ایک بار کنیکٹ ہونے پر ہمیشہ ایکٹیو رہے گا اور تمام ڈیٹا کا کلاؤڈ بیک اپ محفوظ رکھے گا۔
                  </span>
                </div>

                <div>
                  <label className="block text-xs text-gray-300 font-bold mb-1.5">
                    Google Account Email *
                  </label>
                  <input 
                    type="email" 
                    required
                    value={accountInputEmail}
                    onChange={(e) => setAccountInputEmail(e.target.value)}
                    placeholder="e.g. docks.cloud@gmail.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-white text-xs sm:text-sm focus:border-amber-400 outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-300 font-bold mb-1.5">
                    Account Display Name / Department (Optional)
                  </label>
                  <input 
                    type="text" 
                    value={accountInputName}
                    onChange={(e) => setAccountInputName(e.target.value)}
                    placeholder="e.g. MAK Logistics Master Drive"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-white text-xs sm:text-sm focus:border-amber-400 outline-none transition"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAccountModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs sm:text-sm shadow-md transition cursor-pointer flex items-center gap-2"
                  >
                    <CheckCircle2 size={16} />
                    <span>Connect & Activate Vault</span>
                  </button>
                </div>
              </form>
            )}

            {/* Tab 2: Google Sign In Popup with account reset */}
            {activeAccountTab === 'popup' && (
              <div className="space-y-4 pt-1 text-center">
                <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 text-xs text-gray-300 text-left space-y-2">
                  <p>
                    Opens the official Google account chooser popup. You can choose any account already logged into your browser or add a new account.
                  </p>
                  <p className="text-[11px] text-amber-300/80">
                    نوٹ: اگر پوپ اپ ونڈو خود بخود بند ہو جائے تو اوپر دیے گئے "Enter Account Email (Instant)" والے ٹیب سے اپنی مرضی کا ای میل درج کر کے کنیکٹ کر لیں۔
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleConnectWithGooglePopup}
                  disabled={isAuthenticating}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-amber-500/20 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isAuthenticating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Opening Google Account Chooser...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>Open Google Chooser & Connect</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* General Notification Messages */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs sm:text-sm flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setErrorMessage(null);
              setIsAccountModalOpen(true);
            }}
            className="px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-xs font-bold shrink-0 transition cursor-pointer"
          >
            Switch Account
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
              Creates an encrypted, timestamped archive of all Cases, GD Documents, Ledgers, Vehicles, and Clients directly in your Google Drive Cloud Vault.
            </p>
          </div>

          <div className="space-y-2.5 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={handleCreateInstantBackup}
              disabled={isCreatingBackup}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 active:scale-[0.99] text-slate-950 font-extrabold text-xs sm:text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {isCreatingBackup ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Saving to Cloud Vault...</span>
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
              Database snapshots are encrypted and mirrored in your dedicated cloud vault:
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
              <span className="text-amber-300 font-bold font-mono">Google Drive Cloud Vault</span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span>Connected Account:</span>
              <span className="text-purple-300 font-bold font-mono truncate max-w-[150px]">
                {savedUser?.email || 'Admin Vault'}
              </span>
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
              <p className="text-xs text-gray-400">All saved system snapshots stored in your Google Drive Cloud Vault</p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadBackups}
            disabled={loadingBackups}
            className="text-xs px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
          >
            <RefreshCw size={13} className={loadingBackups ? 'animate-spin' : ''} />
            <span>Reload Archives</span>
          </button>
        </div>

        {/* Backups List */}
        {loadingBackups ? (
          <div className="p-12 text-center">
            <Loader2 className="animate-spin mx-auto text-amber-400 mb-3" size={32} />
            <p className="text-xs text-gray-400">Loading backup archives from Google Drive Cloud Vault...</p>
          </div>
        ) : backups.length === 0 ? (
          <div className="p-12 text-center">
            <FileJson className="mx-auto text-gray-600 mb-3" size={40} />
            <h4 className="text-sm font-bold text-gray-300">No Backups Found in Cloud Vault</h4>
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
                        Google Drive Vault
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

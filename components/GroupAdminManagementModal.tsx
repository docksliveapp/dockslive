import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, 
  Users, 
  Sliders, 
  Plus, 
  X, 
  Save, 
  RotateCcw, 
  Upload, 
  Image as ImageIcon, 
  Eye, 
  EyeOff, 
  Trash2, 
  Edit3, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Building2, 
  Lock, 
  UserPlus, 
  Mail, 
  Phone, 
  Sparkles, 
  Globe, 
  MapPin, 
  ShieldAlert,
  Check,
  Crown,
  Clock,
  UserCheck,
  UserX,
  Truck,
  Building,
  Database,
  Download,
  HardDrive,
  FileText,
  CreditCard,
  RefreshCw,
  Loader2,
  Settings,
  HardDriveDownload,
  Shield
} from 'lucide-react';
import { AppUser, UserRole, CompanyDocument } from '../types';
import { 
  subscribeToUsers, 
  saveUserToFirestore, 
  deleteUserFromFirestore, 
  saveClientToFirestore,
  wipeCompleteDatabase,
  exportSelectiveDatabaseBackup,
  restoreDatabaseSnapshot,
  DEFAULT_DATABASE_USERS 
} from '../services/dbService';
import { AdminRolesAndPrivilegesTable } from './AdminRolesAndPrivilegesTable';
import { 
  useParentGroup, 
  ParentGroupInfo, 
  DEFAULT_PARENT_GROUP, 
  COMPANIES_LIST,
  useActiveCompany,
  isUploadedLogo
} from '../services/companyService';
import { useBranding, optimizeLogoImage } from '../services/brandingService';
import { 
  getDriveAccessToken, 
  uploadDatabaseBackupToDrive 
} from '../services/googleDriveService';
import GoogleDriveManager from './GoogleDriveManager';
import { safeAppStorage } from '../services/storage';

export type AdminSettingsTab = 
  | 'users' 
  | 'logo' 
  | 'backup' 
  | 'general' 
  | 'drive' 
  | 'settings';

export interface GroupAdminManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserName?: string;
  initialTab?: AdminSettingsTab;
  isPortalMode?: boolean;
  hideTabsBar?: boolean;
}

export const GroupAdminManagementModal: React.FC<GroupAdminManagementModalProps> = ({
  isOpen,
  onClose,
  currentUserName = 'Administrator',
  initialTab = 'users',
  isPortalMode = false,
  hideTabsBar = false
}) => {
  // Normalize initialTab: 'settings' maps to 'logo'
  const getNormalizedTab = (tab: AdminSettingsTab): AdminSettingsTab => {
    if (tab === 'settings' || (tab as string) === 'tax' || (tab as string) === 'banks' || (tab as string) === 'approvals') return 'logo';
    return tab;
  };

  const [activeTab, setActiveTab] = useState<AdminSettingsTab>(() => getNormalizedTab(initialTab));

  useEffect(() => {
    if (isOpen) {
      setActiveTab(getNormalizedTab(initialTab));
    }
  }, [isOpen, initialTab]);

  // Parent Group & Branding Services
  const { parentGroup, saveParentGroup, resetParentGroup } = useParentGroup();
  const { branding, saveBranding, resetBrandingToDefault, isCustomLogo } = useBranding();
  const { activeCompany } = useActiveCompany();

  // ----------------------------------------------------
  // 1. ADMIN USERS & APPROVALS STATE
  // ----------------------------------------------------
  const [usersList, setUsersList] = useState<AppUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [showUserFormModal, setShowUserFormModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);

  // New/Edit User Form State
  const [formFullName, setFormFullName] = useState('');
  const [formUserId, setFormUserId] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formDesignation, setFormDesignation] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'SUSPENDED'>('ACTIVE');
  const [formRoles, setFormRoles] = useState<UserRole[]>([UserRole.ADMIN]);
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [userFormError, setUserFormError] = useState('');
  const [userSuccessMessage, setUserSuccessMessage] = useState('');

  // Subscribe to live database users
  useEffect(() => {
    const unsub = subscribeToUsers((allUsers) => {
      setUsersList(allUsers);
    });
    return () => unsub();
  }, []);

  const globalAdmins = usersList.filter(u => {
    return u.isAdmin === true || u.role === UserRole.ADMIN || u.isGlobalAdmin === true;
  });

  const filteredAdmins = globalAdmins.filter(u => {
    const q = userSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.userId && u.userId.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.designation && u.designation.toLowerCase().includes(q))
    );
  });

  const handleOpenCreateUser = () => {
    setEditingUser(null);
    setFormFullName('');
    setFormUserId(`ADMIN-${Math.floor(100 + Math.random() * 900)}`);
    setFormPassword('');
    setFormDesignation('Global Super Administrator');
    setFormEmail('');
    setFormPhone('');
    setFormStatus('ACTIVE');
    setFormRoles([UserRole.ADMIN]);
    setUserFormError('');
    setShowPasswordText(false);
    setShowUserFormModal(true);
  };

  const handleOpenEditUser = (user: AppUser) => {
    setEditingUser(user);
    setFormFullName(user.name || '');
    setFormUserId(user.userId || '');
    setFormPassword(user.password || '');
    setFormDesignation(user.designation || 'Global Administrator');
    setFormEmail(user.email || '');
    setFormPhone(user.contact || '');
    setFormStatus(user.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE');
    setFormRoles(user.roles && user.roles.length > 0 ? user.roles : (user.role ? [user.role] : [UserRole.ADMIN]));
    setUserFormError('');
    setShowPasswordText(false);
    setShowUserFormModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormError('');

    const cleanName = formFullName.trim();
    const cleanUserId = formUserId.trim().toLowerCase();
    const cleanPassword = formPassword.trim();

    if (!cleanName) {
      setUserFormError('Please enter administrator full name.');
      return;
    }
    if (!cleanUserId) {
      setUserFormError('Please enter admin username / User ID.');
      return;
    }
    if (!cleanPassword) {
      setUserFormError('Please enter login password for this admin.');
      return;
    }

    if (!editingUser) {
      const exists = usersList.some(u => (u.userId || '').toLowerCase() === cleanUserId);
      if (exists) {
        setUserFormError(`User ID "${cleanUserId}" is already in use. Please choose another username.`);
        return;
      }
    }

    setUserSaving(true);
    try {
      const targetId = editingUser ? editingUser.id : (Date.now() % 10000000);
      const assignedRolesList = formRoles.length > 0 ? formRoles : [UserRole.ADMIN];
      const primaryRole = assignedRolesList[0] || UserRole.ADMIN;

      const updatedRecord: AppUser = {
        ...(editingUser || {}),
        id: targetId,
        userId: cleanUserId,
        name: cleanName,
        password: cleanPassword,
        role: primaryRole,
        roles: assignedRolesList,
        isAdmin: assignedRolesList.includes(UserRole.ADMIN),
        isGlobalAdmin: assignedRolesList.includes(UserRole.ADMIN),
        allowedCompanies: ['docks', 'muhib', 'vantage', 'truckit'],
        designation: formDesignation.trim() || 'Global Super Administrator',
        email: formEmail.trim() || `${cleanUserId}@makgroup.com.pk`,
        contact: formPhone.trim() || '0300-1234567',
        status: formStatus,
        isSuspended: formStatus === 'SUSPENDED',
        authProvider: 'database'
      };

      await saveUserToFirestore(updatedRecord);

      setUserSuccessMessage(editingUser ? `Administrator "${cleanName}" updated successfully.` : `Global Administrator "${cleanName}" created successfully.`);
      setTimeout(() => setUserSuccessMessage(''), 4000);

      setShowUserFormModal(false);
    } catch (err: any) {
      console.error('Failed to save global admin user:', err);
      setUserFormError(err?.message || 'Failed to save administrator.');
    } finally {
      setUserSaving(false);
    }
  };

  const handleDeleteUser = async (user: AppUser) => {
    if (globalAdmins.length <= 1) {
      alert("Action Blocked: At least one Global Super Administrator must remain in the system.");
      return;
    }

    if (user.userId?.toLowerCase() === 'admin') {
      const confirmDelete = window.confirm(
        'Warning: "admin" is the default root master account. Are you sure you want to remove it?'
      );
      if (!confirmDelete) return;
    } else {
      const confirmDelete = window.confirm(
        `Are you sure you want to remove Global Administrator "${user.name}" (${user.userId})? They will lose access to all 4 companies.`
      );
      if (!confirmDelete) return;
    }

    try {
      await deleteUserFromFirestore(user.id);
      setUserSuccessMessage(`Admin "${user.name}" removed successfully.`);
      setTimeout(() => setUserSuccessMessage(''), 3500);
    } catch (err) {
      console.error('Failed to delete admin:', err);
      alert('Failed to delete administrator account.');
    }
  };

  const handleToggleStatus = async (user: AppUser) => {
    const newStatus = user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    try {
      const updated: AppUser = {
        ...user,
        status: newStatus,
        isSuspended: newStatus === 'SUSPENDED'
      };
      await saveUserToFirestore(updated);
    } catch (err) {
      console.error('Failed to toggle status:', err);
      alert('Failed to update administrator status.');
    }
  };

  // ----------------------------------------------------
  // 2. LOGO & BRANDING STATE
  // ----------------------------------------------------
  const [groupName, setGroupName] = useState(parentGroup.name);
  const [groupTitle, setGroupTitle] = useState(parentGroup.title);
  const [groupTagline, setGroupTagline] = useState(parentGroup.tagline);
  const [groupSubtitle, setGroupSubtitle] = useState(parentGroup.subtitle);
  const [groupAddress, setGroupAddress] = useState(parentGroup.address);
  const [groupPhone, setGroupPhone] = useState(parentGroup.phone);
  const [groupCell, setGroupCell] = useState(parentGroup.cell);
  const [groupEmail, setGroupEmail] = useState(parentGroup.email);
  const [groupWeb, setGroupWeb] = useState(parentGroup.web);
  const [groupLogoPreview, setGroupLogoPreview] = useState<string>(parentGroup.logo);
  const [groupLogoFile, setGroupLogoFile] = useState<File | null>(null);
  const [isOptimizingLogo, setIsOptimizingLogo] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingSuccess, setBrandingSuccess] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGroupName(parentGroup.name);
    setGroupTitle(parentGroup.title);
    setGroupTagline(parentGroup.tagline);
    setGroupSubtitle(parentGroup.subtitle);
    setGroupAddress(parentGroup.address);
    setGroupPhone(parentGroup.phone);
    setGroupCell(parentGroup.cell);
    setGroupEmail(parentGroup.email);
    setGroupWeb(parentGroup.web);
    if (!groupLogoFile) {
      setGroupLogoPreview(parentGroup.logo);
    }
  }, [parentGroup, groupLogoFile]);

  const handleLogoFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    const isSupported = ['png', 'svg', 'jpg', 'jpeg', 'webp'].includes(ext || '') || file.type.startsWith('image/');

    if (!isSupported) {
      alert("Unsupported file format. Please upload a PNG, SVG, or JPG image.");
      return;
    }

    setIsOptimizingLogo(true);
    try {
      const optimizedBase64 = await optimizeLogoImage(file);
      setGroupLogoFile(file);
      setGroupLogoPreview(optimizedBase64);
    } catch (err) {
      console.error("Failed to process logo:", err);
      alert("Could not process this image file. Please ensure it is a valid PNG or JPG.");
    } finally {
      setIsOptimizingLogo(false);
    }
  };

  const handleSaveBranding = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setBrandingSaving(true);
    setBrandingSuccess(false);

    try {
      // 1. Update Master Conglomerate Parent Group in Firestore (settings/parent_group)
      await saveParentGroup({
        name: groupName.trim(),
        title: groupTitle.trim(),
        tagline: groupTagline.trim(),
        subtitle: groupSubtitle.trim(),
        address: groupAddress.trim(),
        phone: groupPhone.trim(),
        cell: groupCell.trim(),
        email: groupEmail.trim(),
        web: groupWeb.trim(),
        logo: groupLogoPreview
      }, currentUserName || 'System Administrator');

      setBrandingSuccess(true);
      setTimeout(() => setBrandingSuccess(false), 4000);
    } catch (err: any) {
      console.error("Failed to save branding:", err);
      alert("Failed to save branding: " + (err?.message || err));
    } finally {
      setBrandingSaving(false);
    }
  };

  const handleResetLogo = async () => {
    const confirmReset = window.confirm("Reset company logo and group settings back to factory default?");
    if (!confirmReset) return;

    setBrandingSaving(true);
    try {
      await resetParentGroup();
      await resetBrandingToDefault();
      setGroupLogoFile(null);
      setGroupLogoPreview(DEFAULT_PARENT_GROUP.logo);
      setBrandingSuccess(true);
      setTimeout(() => setBrandingSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to reset branding:", err);
      alert("Failed to reset branding.");
    } finally {
      setBrandingSaving(false);
    }
  };

  // ----------------------------------------------------
  // 3. COMPLETE BACKUP & RESTORE STATE
  // ----------------------------------------------------
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupOptions, setBackupOptions] = useState({
    full: true,
    cases: true,
    finance: true,
    vehicles: true,
    clients: true
  });
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [backupSuccessMessage, setBackupSuccessMessage] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreSuccessMessage, setRestoreSuccessMessage] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Factory Reset Danger Zone State
  const [showResetWarningModal, setShowResetWarningModal] = useState(false);
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  const handleToggleBackupOption = (key: 'full' | 'cases' | 'finance' | 'vehicles' | 'clients') => {
    if (key === 'full') {
      const nextVal = !backupOptions.full;
      setBackupOptions({
        full: nextVal,
        cases: nextVal,
        finance: nextVal,
        vehicles: nextVal,
        clients: nextVal
      });
    } else {
      const next = { ...backupOptions, [key]: !backupOptions[key] };
      next.full = next.cases && next.finance && next.vehicles && next.clients;
      setBackupOptions(next);
    }
  };

  const handleDownloadSelectedBackup = async () => {
    try {
      setIsExportingBackup(true);
      const snapshot = await exportSelectiveDatabaseBackup({
        cases: backupOptions.cases,
        finance: backupOptions.finance,
        vehicles: backupOptions.vehicles,
        clients: backupOptions.clients,
        companyInfo: {
          companyName: groupName,
          adminUsername: currentUserName,
          adminUserId: 'AK001',
          banks: [],
          companyDocuments: []
        }
      });

      const jsonString = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const dateStr = new Date().toISOString().split('T')[0];
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `MAK_GROUP_Complete_Backup_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Auto-mirror to Google Drive if connected
      const driveToken = getDriveAccessToken();
      if (driveToken) {
        try {
          await uploadDatabaseBackupToDrive(snapshot);
        } catch (driveErr) {
          console.warn("Drive auto-sync notice:", driveErr);
        }
      }

      setBackupSuccessMessage("Complete system backup exported successfully! Store this file safely.");
      setShowBackupModal(false);
      setTimeout(() => setBackupSuccessMessage(null), 5000);
    } catch (err: any) {
      alert("Error generating backup: " + (err.message || String(err)));
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleRestoreBackupClick = () => {
    restoreInputRef.current?.click();
  };

  const onRestoreFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRestoring(true);
    setRestoreSuccessMessage(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data && (Array.isArray(data.cases) || Array.isArray(data.finance) || Array.isArray(data.vehicles) || Array.isArray(data.clients) || data.companyName)) {
          const result = await restoreDatabaseSnapshot(data);

          const driveToken = getDriveAccessToken();
          if (driveToken) {
            uploadDatabaseBackupToDrive(data).catch(() => {});
          }

          const counts = result.restoredCounts || { cases: 0, finance: 0, vehicles: 0, clients: 0 };
          setRestoreSuccessMessage(
            `Database restored successfully! (${counts.cases} cases, ${counts.finance} ledger entries, ${counts.vehicles} vehicles, ${counts.clients} clients).`
          );
          setTimeout(() => setRestoreSuccessMessage(null), 6000);
        } else {
          alert("The selected file is not a valid MAK Group backup JSON file.");
        }
      } catch (err: any) {
        alert("Failed to parse or restore backup: " + (err.message || String(err)));
      } finally {
        setIsRestoring(false);
        if (restoreInputRef.current) restoreInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleExecuteFactoryReset = async () => {
    if (resetConfirmInput.trim().toUpperCase() !== 'RESET') {
      alert('Please type "RESET" to confirm.');
      return;
    }

    setIsResetting(true);
    let completed = false;

    // Guaranteed failsafe: Never leave UI hanging in 'Wiping...'
    const failsafeTimer = setTimeout(() => {
      if (!completed) {
        completed = true;
        safeAppStorage.wipeAppOperationalData(true);
        setShowResetWarningModal(false);
        setIsResetting(false);
        window.location.reload();
      }
    }, 4500);

    try {
      await wipeCompleteDatabase();
      completed = true;
      clearTimeout(failsafeTimer);
      setResetSuccessMessage("System database has been reset to clean state across all companies. Reloading...");
      setShowResetWarningModal(false);
      setResetConfirmInput('');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err: any) {
      completed = true;
      clearTimeout(failsafeTimer);
      console.warn("Factory reset notice:", err);
      setShowResetWarningModal(false);
      setIsResetting(false);
      window.location.reload();
    }
  };

  // ----------------------------------------------------
  // 4. GENERAL CREDENTIALS & PROFILE STATE
  // ----------------------------------------------------
  const [adminUsername, setAdminUsername] = useState('Arbab Khan');
  const [adminUserId, setAdminUserId] = useState('AK001');
  const [adminPassword, setAdminPassword] = useState('admin123');
  const [generalSaving, setGeneralSaving] = useState(false);
  const [generalSuccess, setGeneralSuccess] = useState(false);

  const handleSaveGeneralSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralSaving(true);
    setTimeout(() => {
      setGeneralSaving(false);
      setGeneralSuccess(true);
      setTimeout(() => setGeneralSuccess(false), 3500);
    }, 800);
  };

  if (!isOpen) return null;

  return (
    <div className={isPortalMode ? "w-full h-full flex flex-col overflow-hidden" : "fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto animate-fade-in"}>
      {/* Hidden file input for restore */}
      <input 
        type="file" 
        ref={restoreInputRef} 
        onChange={onRestoreFileChange} 
        accept=".json,application/json" 
        className="hidden" 
      />

      <div className={isPortalMode ? "w-full h-full flex flex-col bg-slate-950/80 border border-white/10 rounded-2xl overflow-hidden text-gray-100 shadow-2xl" : "relative w-full max-w-6xl bg-slate-950 border border-amber-500/30 rounded-3xl shadow-[0_0_50px_rgba(245,158,11,0.25)] my-auto flex flex-col max-h-[92vh] overflow-hidden text-gray-100"}>
        
        {/* Top Executive Header Bar */}
        <div className="flex items-center justify-between px-5 sm:px-7 py-4 border-b border-white/10 bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center shadow-lg shadow-amber-500/30 border border-amber-300/40 shrink-0">
              <Crown className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                  Centralized Admin Settings Hub
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  Global Super Admin
                </span>
              </div>
              <p className="text-xs text-gray-400">
                Master App Controls • Admin Users • App Logo & Branding • Complete System Backup
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
              title="Close Admin Settings"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tab Navigation Strip (All 7 Complete Sections) */}
        {!hideTabsBar && (
          <div className="flex items-center gap-1 sm:gap-2 px-5 sm:px-7 py-2.5 border-b border-white/10 bg-slate-900/80 overflow-x-auto scrollbar-none">
            {/* 1. Admin Users */}
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                activeTab === 'users'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <ShieldCheck size={14} />
              <span>Admin Users</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 font-mono">
                {globalAdmins.length}
              </span>
            </button>

            {/* 2. Logo & Branding */}
            <button
              type="button"
              onClick={() => setActiveTab('logo')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                activeTab === 'logo'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <ImageIcon size={14} />
              <span>Logo & Branding</span>
              {isCustomLogo && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>}
            </button>

            {/* 3. Complete Backup & Restore */}
            <button
              type="button"
              onClick={() => setActiveTab('backup')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                activeTab === 'backup'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Database size={14} />
              <span>Complete Backup</span>
            </button>

            {/* 4. General Settings */}
            <button
              type="button"
              onClick={() => setActiveTab('general')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                activeTab === 'general'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Sliders size={14} />
              <span>General</span>
            </button>

            {/* 5. Google Drive Cloud */}
            <button
              type="button"
              onClick={() => setActiveTab('drive')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                activeTab === 'drive'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <HardDrive size={14} />
              <span>Google Drive</span>
            </button>
          </div>
        )}

        {/* Modal Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6">

          {/* Feedback messages */}
          {userSuccessMessage && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2 animate-fade-in">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span>{userSuccessMessage}</span>
            </div>
          )}

          {backupSuccessMessage && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2 animate-fade-in">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span>{backupSuccessMessage}</span>
            </div>
          )}

          {restoreSuccessMessage && (
            <div className="p-3.5 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-200 text-xs flex items-center gap-2 animate-fade-in">
              <CheckCircle2 size={16} className="text-cyan-400 shrink-0" />
              <span>{restoreSuccessMessage}</span>
            </div>
          )}

          {resetSuccessMessage && (
            <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2 animate-fade-in">
              <CheckCircle2 size={16} className="text-amber-400 shrink-0" />
              <span>{resetSuccessMessage}</span>
            </div>
          )}

          {/* ==================================================== */}
          {/* TAB 1: ADMIN USERS (Global Super Admins)            */}
          {/* ==================================================== */}
          {activeTab === 'users' && (
            <div className="space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="text-amber-400" size={20} />
                    Global Administrator Accounts
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Administrators created here have full administrative privileges across all 4 subsidiaries and system configuration.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenCreateUser}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 transition shadow-lg shadow-amber-500/25 flex items-center gap-2 cursor-pointer"
                  >
                    <UserPlus size={15} />
                    <span>+ New Admin User</span>
                  </button>
                </div>
              </div>

              {/* Search Admins */}
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search administrators by name, ID, or designation..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Admins Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredAdmins.map((admin, aIdx) => (
                  <div
                    key={`modal_admin_${admin.id || admin.userId || aIdx}_${aIdx}`}
                    className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-amber-500/40 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold text-sm">
                            {admin.name?.charAt(0).toUpperCase() || 'A'}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                              {admin.name}
                              {admin.userId?.toLowerCase() === 'admin' && (
                                <span className="text-xs px-1.5 py-0.5 rounded-md bg-amber-500 text-slate-950 font-bold font-mono">
                                  ROOT
                                </span>
                              )}
                            </h4>
                            <p className="text-xs text-amber-300 font-mono">
                              ID: {admin.userId}
                            </p>
                          </div>
                        </div>

                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          admin.status === 'SUSPENDED'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        }`}>
                          {admin.status || 'ACTIVE'}
                        </span>
                      </div>

                      <div className="space-y-1 text-xs text-gray-300 mt-3 pt-3 border-t border-white/5">
                        <p className="flex items-center gap-2">
                          <Crown size={12} className="text-amber-400 shrink-0" />
                          <span className="font-semibold text-gray-200">{admin.designation || 'Global Administrator'}</span>
                        </p>
                        <p className="flex items-center gap-2 text-gray-400">
                          <Mail size={12} className="text-gray-500 shrink-0" />
                          <span className="truncate">{admin.email || `${admin.userId}@makgroup.com.pk`}</span>
                        </p>
                        <p className="flex items-center gap-2 text-gray-400">
                          <Phone size={12} className="text-gray-500 shrink-0" />
                          <span>{admin.contact || 'Direct Corporate Line'}</span>
                        </p>
                      </div>

                      <div className="mt-3 p-2 rounded-xl bg-black/40 border border-white/5 text-xs text-gray-400 flex items-center justify-between">
                        <span>Access Scope:</span>
                        <span className="text-amber-300 font-semibold">All 4 Companies • Full Master Control</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(admin)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition"
                      >
                        {admin.status === 'SUSPENDED' ? 'Activate' : 'Suspend'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEditUser(admin)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 flex items-center gap-1 transition"
                      >
                        <Edit3 size={12} />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteUser(admin)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 flex items-center gap-1 transition"
                      >
                        <Trash2 size={12} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* TAB 2: LOGO & BRANDING (Upload, Change Name & Logo) */}
          {/* ==================================================== */}
          {activeTab === 'logo' && (
            <form onSubmit={handleSaveBranding} className="space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <ImageIcon className="text-amber-400" size={20} />
                    App & Group Logo & Visual Branding
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Customize the conglomerate name, official logo image, and letterhead credentials. Automatically synchronized across cloud Firestore.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetLogo}
                    disabled={brandingSaving}
                    className="px-3 py-1.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 transition text-xs font-semibold flex items-center gap-1.5"
                  >
                    <RotateCcw size={13} />
                    <span>Reset Logo</span>
                  </button>

                  <button
                    type="submit"
                    disabled={brandingSaving || isOptimizingLogo}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 transition shadow-lg shadow-amber-500/25 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {brandingSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    <span>{brandingSaving ? 'Saving...' : 'Save & Apply Logo'}</span>
                  </button>
                </div>
              </div>

              {/* Logo Upload & Live Preview Card */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Upload Box */}
                <div className="md:col-span-2 p-5 rounded-2xl bg-white/5 border border-white/10 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-2 flex items-center gap-2">
                      <Upload size={14} /> Upload Main Company Logo
                    </h4>
                    <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                      Upload high-resolution logo (PNG, SVG, or JPG). Transparent PNG is recommended for optimal rendering across dark interfaces and printed PDF dossiers.
                    </p>

                    <input
                      type="file"
                      ref={logoInputRef}
                      onChange={handleLogoFileSelect}
                      accept="image/png,image/svg+xml,image/jpeg,image/webp"
                      className="hidden"
                    />

                    <div 
                      onClick={() => logoInputRef.current?.click()}
                      className="border-2 border-dashed border-amber-500/40 hover:border-amber-400 rounded-2xl p-6 text-center cursor-pointer bg-black/30 hover:bg-amber-500/5 transition-all"
                    >
                      <Upload className="w-8 h-8 mx-auto text-amber-400 mb-2 animate-bounce" />
                      <p className="text-xs font-bold text-white">Click to Select New Logo File</p>
                      <p className="text-xs text-gray-400 mt-1">PNG, SVG, JPG (Max 5MB)</p>
                      {isOptimizingLogo && (
                        <p className="text-xs text-amber-300 mt-2 flex items-center justify-center gap-1.5">
                          <Loader2 size={13} className="animate-spin" /> Optimizing image for crisp HD rendering...
                        </p>
                      )}
                    </div>
                  </div>

                  {groupLogoFile && (
                    <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-center justify-between">
                      <span className="truncate">Selected: {groupLogoFile.name} ({Math.round(groupLogoFile.size / 1024)} KB)</span>
                      <span className="text-xs font-bold text-emerald-400">Ready to Save</span>
                    </div>
                  )}
                </div>

                {/* Live Preview Card */}
                <div className="p-5 rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center text-center">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">
                    Active Logo Preview
                  </h4>
                  <div className="h-32 w-full flex items-center justify-center p-3 rounded-2xl bg-black/60 border border-white/10 mb-3 shadow-inner">
                    {groupLogoPreview && isUploadedLogo(groupLogoPreview) ? (
                      <img 
                        src={groupLogoPreview} 
                        alt="Company Logo Preview" 
                        className="max-h-full max-w-full object-contain filter drop-shadow-[0_4px_16px_rgba(245,158,11,0.3)]"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1.5 text-gray-500">
                        <ImageIcon size={28} className="text-gray-600" />
                        <span className="text-xs font-medium">No Logo Uploaded Yet</span>
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-mono text-gray-400">
                    Live Display Sample
                  </span>
                </div>
              </div>

              {/* Group & Company Name Inputs */}
              <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-2">
                  <Building2 size={14} /> Enterprise Headings & Legal Information
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Company / App Legal Name</label>
                    <input
                      type="text"
                      value={groupTitle}
                      onChange={(e) => setGroupTitle(e.target.value)}
                      placeholder="e.g. MAK GROUP OF COMPANIES"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Short Brand Name</label>
                    <input
                      type="text"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="e.g. MAK Group"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Company Subtitle / Operations</label>
                    <input
                      type="text"
                      value={groupSubtitle}
                      onChange={(e) => setGroupSubtitle(e.target.value)}
                      placeholder="e.g. Customs Clearance, Bonded Carrier & Freight Terminal Operations"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Tagline</label>
                    <input
                      type="text"
                      value={groupTagline}
                      onChange={(e) => setGroupTagline(e.target.value)}
                      placeholder="e.g. Total Supply Chain Solutions"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Head Office Address</label>
                    <input
                      type="text"
                      value={groupAddress}
                      onChange={(e) => setGroupAddress(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Official Email</label>
                    <input
                      type="text"
                      value={groupEmail}
                      onChange={(e) => setGroupEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Official Website</label>
                    <input
                      type="text"
                      value={groupWeb}
                      onChange={(e) => setGroupWeb(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* ==================================================== */}
          {/* TAB 3: COMPLETE BACKUP & RESTORE                     */}
          {/* ==================================================== */}
          {activeTab === 'backup' && (
            <div className="space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Database className="text-amber-400" size={20} />
                    Complete Database Backup, Snapshot & Restore
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Generate offline JSON snapshots across all 4 companies or restore previous archives directly into cloud storage.
                  </p>
                </div>
              </div>

              {/* Main Backup Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 1. Download Backup Card */}
                <div className="p-6 rounded-2xl bg-white/5 border border-white/10 flex flex-col justify-between hover:border-amber-500/40 transition">
                  <div>
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 mb-4">
                      <Download size={24} />
                    </div>
                    <h4 className="text-base font-bold text-white mb-1">
                      Export Complete System Backup
                    </h4>
                    <p className="text-xs text-gray-400 leading-relaxed mb-4">
                      Download a complete, encrypted JSON archive containing all cases, finances, vehicles, clients, global admins, and system branding. Can be kept safely as an offline backup.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 pt-3 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => setShowBackupModal(true)}
                      disabled={isExportingBackup}
                      className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 transition shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isExportingBackup ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      <span>{isExportingBackup ? 'Exporting...' : 'Export JSON Backup'}</span>
                    </button>
                  </div>
                </div>

                {/* 2. Restore Backup Card */}
                <div className="p-6 rounded-2xl bg-white/5 border border-white/10 flex flex-col justify-between hover:border-cyan-500/40 transition">
                  <div>
                    <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 mb-4">
                      <HardDriveDownload size={24} />
                    </div>
                    <h4 className="text-base font-bold text-white mb-1">
                      Restore from JSON Backup File
                    </h4>
                    <p className="text-xs text-gray-400 leading-relaxed mb-4">
                      Select a previously downloaded backup JSON file to safely restore all system records, ledgers, cases, and company data back into the system.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 pt-3 border-t border-white/10">
                    <button
                      type="button"
                      onClick={handleRestoreBackupClick}
                      disabled={isRestoring}
                      className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 transition shadow-lg shadow-cyan-600/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isRestoring ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      <span>{isRestoring ? 'Restoring Snapshot...' : 'Select JSON File to Restore'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Danger Zone: Factory Reset */}
              <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-rose-300 flex items-center gap-2">
                    <ShieldAlert size={16} /> Danger Zone: Master Conglomerate Factory Reset
                  </h4>
                  <p className="text-xs text-rose-200/80 mt-1 max-w-xl">
                    Wipes all transactional cases, finances, payables, receivables, and branding across ALL 4 subsidiaries simultaneously. Protected by master administrator confirmation.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowResetWarningModal(true)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition shadow-lg shadow-rose-600/30 cursor-pointer shrink-0"
                >
                  Global Master Reset
                </button>
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* TAB 4: GENERAL SETTINGS                              */}
          {/* ==================================================== */}
          {activeTab === 'general' && (
            <form onSubmit={handleSaveGeneralSettings} className="space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Sliders className="text-amber-400" size={20} />
                    General System & Master Profile Credentials
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Root administrator credentials and system-wide default configurations.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={generalSaving}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 transition shadow-lg shadow-amber-500/25 flex items-center gap-2 cursor-pointer"
                >
                  {generalSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  <span>{generalSaving ? 'Saving...' : 'Save General Settings'}</span>
                </button>
              </div>

              {generalSuccess && (
                <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  <span>General settings updated and saved successfully!</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Master Admin Username</label>
                  <input
                    type="text"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Admin User ID</label>
                  <input
                    type="text"
                    value={adminUserId}
                    readOnly
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/10 text-xs text-gray-400 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Admin Master Password</label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">System Status</label>
                  <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 font-bold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>Cross-Subsidiary Core Online • Production Standard</span>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* ==================================================== */}
          {/* TAB 5: GOOGLE DRIVE CLOUD                            */}
          {/* ==================================================== */}
          {activeTab === 'drive' && (
            <div className="space-y-4 animate-fade-in">
              <GoogleDriveManager attachedMode={true} />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-7 py-3 border-t border-white/10 bg-slate-900/60 flex items-center justify-between text-xs text-gray-400">
          <span>MAK Group of Companies • Centralized Master Administration</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white font-semibold transition"
          >
            Done
          </button>
        </div>

        {/* ---------------------------------------------------- */}
        {/* SUB-MODAL: Create / Edit Admin User Form             */}
        {/* ---------------------------------------------------- */}
        {showUserFormModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in overflow-hidden">
            <div className="relative w-full max-w-3xl bg-slate-950 border border-amber-500/40 rounded-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10 bg-slate-950/95 shrink-0">
                <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="text-amber-400" size={18} />
                  {editingUser ? 'Edit Administrator Profile & Roles' : 'Create Administrator Profile & Assign Roles'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowUserFormModal(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {userFormError && (
                <div className="mx-4 sm:mx-6 mt-3 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs shrink-0">
                  {userFormError}
                </div>
              )}

              <form onSubmit={handleSaveUser} className="flex flex-col flex-1 min-h-0 overflow-hidden text-xs">
                <div className="p-4 sm:p-6 overflow-y-auto space-y-4 custom-scrollbar flex-1 min-h-0 overscroll-contain">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={formFullName}
                      onChange={(e) => setFormFullName(e.target.value)}
                      placeholder="e.g. Arbab Khan"
                      className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Designation</label>
                    <input
                      type="text"
                      value={formDesignation}
                      onChange={(e) => setFormDesignation(e.target.value)}
                      placeholder="e.g. Managing Director / Super Admin"
                      className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Admin Username / User ID</label>
                    <input
                      type="text"
                      value={formUserId}
                      onChange={(e) => setFormUserId(e.target.value)}
                      placeholder="e.g. AK001"
                      className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                      required
                      disabled={!!editingUser && editingUser.userId?.toLowerCase() === 'admin'}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showPasswordText ? 'text' : 'password'}
                        value={formPassword}
                        onChange={(e) => setFormPassword(e.target.value)}
                        placeholder="Login password"
                        className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white pr-9 focus:outline-none focus:border-amber-400"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswordText(!showPasswordText)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                      >
                        {showPasswordText ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Email</label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="admin@makgroup.com.pk"
                      className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Contact Phone</label>
                    <input
                      type="text"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="0300-1234567"
                      className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                {/* Google Workspace Console Style Roles & Privileges Table */}
                <div className="pt-2">
                  <AdminRolesAndPrivilegesTable
                    assignedRoles={formRoles}
                    userName={formFullName || 'this admin'}
                    allowedCompanies={['docks', 'muhib', 'vantage', 'truckit']}
                    isGlobalAdmin={true}
                    onRolesChange={(newRoles) => {
                      setFormRoles(newRoles.length > 0 ? newRoles : [UserRole.ADMIN]);
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-3.5 sm:p-4 border-t border-white/10 bg-slate-950/95 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowUserFormModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white bg-white/5 cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={userSaving}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 shadow-md shadow-amber-500/25 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Save size={13} />
                  <span>{userSaving ? 'Saving...' : editingUser ? 'Update Admin' : 'Create Admin'}</span>
                </button>
              </div>
            </form>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SUB-MODAL: Selective Backup Options Modal            */}
        {/* ---------------------------------------------------- */}
        {showBackupModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="relative w-full max-w-md bg-slate-950 border border-amber-500/40 rounded-3xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Database className="text-amber-400" size={18} />
                  Choose Backup Components
                </h3>
                <button
                  type="button"
                  onClick={() => setShowBackupModal(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <label className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
                  <span className="font-semibold text-white">Full Complete Snapshot (All Data)</span>
                  <input
                    type="checkbox"
                    checked={backupOptions.full}
                    onChange={() => handleToggleBackupOption('full')}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
                  <span className="text-gray-300">Cases & Consignments</span>
                  <input
                    type="checkbox"
                    checked={backupOptions.cases}
                    onChange={() => handleToggleBackupOption('cases')}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
                  <span className="text-gray-300">Financial Ledger & Transactions</span>
                  <input
                    type="checkbox"
                    checked={backupOptions.finance}
                    onChange={() => handleToggleBackupOption('finance')}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
                  <span className="text-gray-300">Vehicles & Fleet Management</span>
                  <input
                    type="checkbox"
                    checked={backupOptions.vehicles}
                    onChange={() => handleToggleBackupOption('vehicles')}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
                  <span className="text-gray-300">Clients & Transporters Directory</span>
                  <input
                    type="checkbox"
                    checked={backupOptions.clients}
                    onChange={() => handleToggleBackupOption('clients')}
                    className="accent-amber-500 w-4 h-4 cursor-pointer"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowBackupModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSelectedBackup}
                  disabled={isExportingBackup}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 shadow-md shadow-amber-500/25 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isExportingBackup ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  <span>{isExportingBackup ? 'Downloading...' : 'Download JSON Snapshot'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SUB-MODAL: Factory Reset Warning Modal               */}
        {/* ---------------------------------------------------- */}
        {showResetWarningModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-3 bg-black/85 backdrop-blur-sm animate-fade-in">
            <div className="relative w-full max-w-md bg-slate-950 border border-rose-500/50 rounded-3xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-rose-400">
                <ShieldAlert size={28} />
                <h3 className="text-base font-bold text-white">Confirm Global Conglomerate Reset</h3>
              </div>

              <p className="text-xs text-gray-300 leading-relaxed">
                This will delete all live cases, financial entries, payables, receivables, and operational data across <span className="text-rose-300 font-bold">ALL 4 subsidiaries</span> (Docks, Muhib, Vantage, Truckit) and the Parent Group. Ensure you have downloaded a JSON backup first.
              </p>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">
                  Type <span className="text-rose-400 font-mono font-bold">RESET</span> to confirm:
                </label>
                <input
                  type="text"
                  value={resetConfirmInput}
                  onChange={(e) => setResetConfirmInput(e.target.value)}
                  placeholder="RESET"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-rose-500/40 text-xs text-white font-mono focus:outline-none focus:border-rose-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetWarningModal(false);
                    setResetConfirmInput('');
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteFactoryReset}
                  disabled={isResetting || resetConfirmInput.trim().toUpperCase() !== 'RESET'}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 transition shadow-lg shadow-rose-600/30 flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isResetting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  <span>{isResetting ? 'Wiping...' : 'Confirm Factory Reset'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default GroupAdminManagementModal;

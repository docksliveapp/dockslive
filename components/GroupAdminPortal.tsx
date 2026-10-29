import React, { useState, useEffect, useMemo } from 'react';
import { 
  Crown, 
  Building2, 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  FolderKanban, 
  Truck, 
  DollarSign, 
  ShieldCheck, 
  Users, 
  Sliders, 
  Image as ImageIcon, 
  Database, 
  FileText, 
  HardDrive, 
  CreditCard, 
  CheckCircle2, 
  LogOut, 
  Menu, 
  X, 
  ChevronRight, 
  ArrowRight, 
  RefreshCw, 
  Download, 
  ExternalLink, 
  ArrowLeft,
  Sparkles,
  Layers,
  Search,
  Filter,
  Boxes,
  MapPin,
  Clock,
  Eye,
  Activity,
  AlertCircle,
  Lock,
  Key,
  EyeOff,
  Save,
  Check,
  UserCheck,
  Package
} from 'lucide-react';
import { Case, Vehicle, FinanceEntry, AppUser, CaseStatus, UserRole } from '../types';
import { 
  subscribeToCases, 
  subscribeToVehicles, 
  subscribeToFinances, 
  subscribeToUsers,
  matchesActiveCompany,
  saveUserToFirestore
} from '../services/dbService';
import { 
  CompanyId, 
  GROUP_COMPANIES, 
  COMPANIES_LIST, 
  useParentGroup, 
  getCompanyLogoUrl,
  isUploadedLogo
} from '../services/companyService';
import { useBranding } from '../services/brandingService';
import { safeAppStorage } from '../services/storage';
import { exportTableToExcel } from '../services/excelExportService';
import GroupAdminManagementModal, { AdminSettingsTab } from './GroupAdminManagementModal';
import Dashboard from './Dashboard';
import { ThemeToggleSwitch } from './ThemeToggleSwitch';
import { LiveNotificationCenter } from './LiveNotificationCenter';
import PublicContainerTrackingPortal from './PublicContainerTrackingPortal';
import PublicVehicleTrackingPortal from './PublicVehicleTrackingPortal';

export interface GroupAdminPortalProps {
  onExitPortal: () => void;
  onSignOut?: () => void;
  onSelectCompanyWorkspace?: (companyId: CompanyId) => void;
  currentUserName?: string;
}

type PortalView = 
  | 'overview'
  | 'company_docks'
  | 'company_muhib'
  | 'company_vantage'
  | 'company_truckit'
  | 'container_status'
  | 'vehicle_status'
  | 'setting_profile'
  | 'setting_logo'
  | 'setting_backup'
  | 'setting_general'
  | 'setting_drive';

export const GroupAdminPortal: React.FC<GroupAdminPortalProps> = ({
  onExitPortal,
  onSignOut,
  onSelectCompanyWorkspace,
  currentUserName = 'Arbab Khan'
}) => {
  const [activeView, setActiveView] = useState<PortalView>('overview');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Main Admin Profile Editing State
  const [profileUserId, setProfileUserId] = useState(() => {
    return safeAppStorage.getItem('dpl_admin_userid') || 'admin';
  });
  const [profileDisplayName, setProfileDisplayName] = useState(() => {
    return safeAppStorage.getItem('dpl_current_user_name') || currentUserName || 'Arbab Khan';
  });
  const [profileEmail, setProfileEmail] = useState(() => {
    return safeAppStorage.getItem('dpl_admin_email') || 'docks.live.app@gmail.com';
  });
  const [profilePhone, setProfilePhone] = useState(() => {
    return safeAppStorage.getItem('dpl_admin_phone') || '+92 300 8221199';
  });
  const [profileCurrentPassword, setProfileCurrentPassword] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [profileConfirmPassword, setProfileConfirmPassword] = useState('');
  const [profilePin, setProfilePin] = useState(() => {
    return safeAppStorage.getItem('dpl_admin_pin') || '9999';
  });
  const [showProfilePasswords, setShowProfilePasswords] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState('');
  const [profileErrorMsg, setProfileErrorMsg] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Parent Group & Branding
  const { parentGroup } = useParentGroup();
  const { branding } = useBranding();
  const mainAdminLogoUrl = (parentGroup?.logo && isUploadedLogo(parentGroup.logo))
    ? parentGroup.logo
    : '/logos/mak_pearl_white_emblem.svg';

  // All Companies Live Data
  const [allCases, setAllCases] = useState<Case[]>([]);
  const [allVehicles, setAllVehicles] = useState<Vehicle[]>([]);
  const [allFinances, setAllFinances] = useState<FinanceEntry[]>([]);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter in Overview Feed
  const [feedSearch, setFeedSearch] = useState('');
  const [feedCompanyFilter, setFeedCompanyFilter] = useState<'ALL' | CompanyId>('ALL');

  useEffect(() => {
    const unsubCases = subscribeToCases(
      (items) => {
        setAllCases(items || []);
        setLoading(false);
      },
      (err) => console.warn('Portal cases error:', err),
      { allCompanies: true }
    );

    const unsubVehicles = subscribeToVehicles(
      (items) => setAllVehicles(items || []),
      (err) => console.warn('Portal vehicles error:', err)
    );

    const unsubFinances = subscribeToFinances(
      (items) => setAllFinances(items || []),
      (err) => console.warn('Portal finances error:', err),
      { allCompanies: true }
    );

    const unsubUsers = subscribeToUsers((items) => {
      setAllUsers(items || []);
    });

    return () => {
      unsubCases();
      unsubVehicles();
      unsubFinances();
      unsubUsers();
    };
  }, []);

  // Calculations per subsidiary and consolidated
  const statsByCompany = useMemo(() => {
    const map: Record<CompanyId, {
      totalCases: number;
      activeCases: number;
      completedCases: number;
      containersCount: number;
      receivables: number;
      payables: number;
      netProfit: number;
    }> = {
      docks: { totalCases: 0, activeCases: 0, completedCases: 0, containersCount: 0, receivables: 0, payables: 0, netProfit: 0 },
      muhib: { totalCases: 0, activeCases: 0, completedCases: 0, containersCount: 0, receivables: 0, payables: 0, netProfit: 0 },
      vantage: { totalCases: 0, activeCases: 0, completedCases: 0, containersCount: 0, receivables: 0, payables: 0, netProfit: 0 },
      truckit: { totalCases: 0, activeCases: 0, completedCases: 0, containersCount: 0, receivables: 0, payables: 0, netProfit: 0 }
    };

    allCases.forEach(c => {
      const cId = (c.companyId || 'docks') as CompanyId;
      if (map[cId]) {
        map[cId].totalCases += 1;
        map[cId].containersCount += (c.containers?.length || 1);
        if (c.status === CaseStatus.COMPLETED) {
          map[cId].completedCases += 1;
        } else {
          map[cId].activeCases += 1;
        }
      }
    });

    allFinances.forEach(f => {
      const cId = (f.companyId || 'docks') as CompanyId;
      const amount = Number(f.amount) || 0;
      if (map[cId]) {
        if (f.type === 'RECEIVABLE' || f.type === 'INCOME') {
          map[cId].receivables += amount;
        } else if (f.type === 'PAYABLE' || f.type === 'EXPENSE') {
          map[cId].payables += amount;
        }
      }
    });

    // Compute Net Profit
    Object.keys(map).forEach(key => {
      const cId = key as CompanyId;
      map[cId].netProfit = map[cId].receivables - map[cId].payables;
    });

    return map;
  }, [allCases, allFinances]);

  // Consolidated Grand Totals
  const grandTotals = useMemo(() => {
    const totalCases = allCases.length;
    const completedCases = allCases.filter(c => c.status === CaseStatus.COMPLETED).length;
    const activeCases = totalCases - completedCases;
    const totalContainers = allCases.reduce((sum, c) => sum + (c.containers?.length || 1), 0);

    const totalReceivables = allFinances
      .filter(f => f.type === 'RECEIVABLE' || f.type === 'INCOME')
      .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

    const totalPayables = allFinances
      .filter(f => f.type === 'PAYABLE' || f.type === 'EXPENSE')
      .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

    const netProfit = totalReceivables - totalPayables;
    const totalVehiclesCount = allVehicles.length;
    const availableFleet = allVehicles.filter(v => v.status === 'AVAILABLE').length;

    const cashInHand = allFinances
      .filter(f => f.paymentMethod === 'CASH')
      .reduce((sum, f) => sum + (f.type === 'INCOME' ? Number(f.amount) || 0 : -(Number(f.amount) || 0)), 0);

    const bankLiquidity = allFinances
      .filter(f => f.paymentMethod === 'BANK')
      .reduce((sum, f) => sum + (f.type === 'INCOME' ? Number(f.amount) || 0 : -(Number(f.amount) || 0)), 0);

    return {
      totalCases,
      activeCases,
      completedCases,
      totalContainers,
      totalVehiclesCount,
      availableFleet,
      totalReceivables,
      totalPayables,
      netProfit,
      cashInHand: Math.max(0, cashInHand),
      bankLiquidity: Math.max(0, bankLiquidity)
    };
  }, [allCases, allVehicles, allFinances]);

  // Filtered recent cases feed
  const recentCasesFeed = useMemo(() => {
    return allCases
      .filter(c => {
        if (feedCompanyFilter !== 'ALL' && (c.companyId || 'docks') !== feedCompanyFilter) {
          return false;
        }
        if (feedSearch.trim()) {
          const q = feedSearch.toLowerCase();
          const matchCase = (c.caseNo || '').toLowerCase().includes(q);
          const matchClient = (c.clientName || '').toLowerCase().includes(q);
          const matchBL = (c.blNo || '').toLowerCase().includes(q);
          const matchContainer = (c.containers || []).some(cn => ((cn.number || (cn as any).containerNumber || '')).toLowerCase().includes(q));
          return matchCase || matchClient || matchBL || matchContainer;
        }
        return true;
      })
      .slice(0, 30);
  }, [allCases, feedCompanyFilter, feedSearch]);

  const handleExportConsolidatedReport = () => {
    const headers = [
      'Subsidiary Company',
      'Short Code',
      'Category',
      'Total Shipments / Cases',
      'Active In-Transit',
      'Delivered / Completed',
      'Containers Handled',
      'Total Receivables (PKR)',
      'Total Payables & Overheads (PKR)',
      'Net Operating Margin (PKR)'
    ];

    const rows = COMPANIES_LIST.map(comp => {
      const s = statsByCompany[comp.id];
      return [
        comp.name,
        comp.shortName,
        comp.category,
        s.totalCases,
        s.activeCases,
        s.completedCases,
        s.containersCount,
        s.receivables,
        s.payables,
        s.netProfit
      ];
    });

    // Add Grand Total row
    rows.push([
      'TOTAL (ALL 4 COMPANIES CONSOLIDATED)',
      'GROUP',
      'MAK Group of Companies Conglomerate',
      grandTotals.totalCases,
      grandTotals.activeCases,
      grandTotals.completedCases,
      grandTotals.totalContainers,
      grandTotals.totalReceivables,
      grandTotals.totalPayables,
      grandTotals.netProfit
    ]);

    const filename = `MAK_Group_Consolidated_Executive_Audit_${new Date().toISOString().split('T')[0]}.xlsx`;
    exportTableToExcel(filename, 'Consolidated Executive Report', headers, rows, [32, 14, 25, 20, 18, 20, 18, 22, 25, 22]);
  };

  // Save Main Admin Profile & Credentials
  const handleSaveAdminProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setProfileErrorMsg('');
    setProfileSuccessMsg('');

    if (!profileUserId.trim()) {
      setProfileErrorMsg('User ID cannot be blank.');
      return;
    }
    if (!profileDisplayName.trim()) {
      setProfileErrorMsg('Display Name cannot be blank.');
      return;
    }
    if (profileNewPassword && profileNewPassword !== profileConfirmPassword) {
      setProfileErrorMsg('New password and confirm password do not match.');
      return;
    }
    if (profileNewPassword && profileNewPassword.length < 4) {
      setProfileErrorMsg('New password must be at least 4 characters long.');
      return;
    }

    setIsSavingProfile(true);
    try {
      safeAppStorage.setItem('dpl_admin_userid', profileUserId.trim());
      safeAppStorage.setItem('dpl_current_user_name', profileDisplayName.trim());
      safeAppStorage.setItem('dpl_user_name', profileDisplayName.trim());
      safeAppStorage.setItem('dpl_admin_email', profileEmail.trim());
      safeAppStorage.setItem('dpl_admin_phone', profilePhone.trim());
      safeAppStorage.setItem('dpl_admin_pin', profilePin.trim());

      if (profileNewPassword) {
        safeAppStorage.setItem('dpl_admin_password', profileNewPassword);
      }

      // Sync with Firestore user record if exists
      const matchedUser = allUsers.find(u => 
        (u.userId && u.userId.toLowerCase() === profileUserId.toLowerCase()) ||
        (u.name && u.name.toLowerCase() === currentUserName.toLowerCase()) ||
        u.isAdmin
      );

      if (matchedUser) {
        await saveUserToFirestore({
          ...matchedUser,
          name: profileDisplayName.trim(),
          userId: profileUserId.trim(),
          email: profileEmail.trim(),
          contact: profilePhone.trim(),
          ...(profileNewPassword ? { password: profileNewPassword } : {})
        });
      }

      setProfileSuccessMsg('Main Admin Profile & Security Credentials successfully updated!');
      setProfileCurrentPassword('');
      setProfileNewPassword('');
      setProfileConfirmPassword('');
      setTimeout(() => setProfileSuccessMsg(''), 5000);
    } catch (err: any) {
      console.error('Error updating admin profile:', err);
      setProfileErrorMsg(err?.message || 'Failed to save admin profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Helper to switch view and close mobile drawer
  const handleSelectView = (view: PortalView) => {
    setActiveView(view);
    setMobileSidebarOpen(false);
  };

  // Convert setting view to setting tab key for remaining tabs
  const getSettingsTabFromView = (view: PortalView): AdminSettingsTab => {
    switch (view) {
      case 'setting_logo': return 'logo';
      case 'setting_backup': return 'backup';
      case 'setting_general': return 'general';
      case 'setting_drive': return 'drive';
      default: return 'logo';
    }
  };

  const isSettingsActive = activeView.startsWith('setting_') && activeView !== 'setting_profile';
  const isCompanyViewActive = activeView.startsWith('company_');

  const selectedCompanyId: CompanyId | null = (() => {
    if (activeView === 'company_docks') return 'docks';
    if (activeView === 'company_muhib') return 'muhib';
    if (activeView === 'company_vantage') return 'vantage';
    if (activeView === 'company_truckit') return 'truckit';
    return null;
  })();

  const currentSelectedCompany = selectedCompanyId ? GROUP_COMPANIES[selectedCompanyId] : null;

  return (
    <div className="flex h-screen h-[100dvh] min-h-[100dvh] max-h-[100dvh] w-full bg-[#0B0E14] text-slate-100 font-sans overflow-hidden relative">
      
      {/* Mobile Drawer Overlay */}
      {mobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden" 
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* ======================================================== */}
      {/* SIDEBAR NAVIGATION                                       */}
      {/* ======================================================== */}
      <aside className={`fixed top-0 left-0 h-full bg-[#0E121B] border-r border-white/10 z-50 flex flex-col transition-all duration-300 w-72 sm:w-80 shadow-2xl ${
        mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:static ${
        sidebarCollapsed ? 'lg:hidden' : 'lg:translate-x-0 lg:w-72'
      }`}>
        
        {/* Header / Conglomerate Branding */}
        <div className="px-3.5 py-3 border-b border-white/10 flex items-center justify-between bg-[#111724] gap-2 shrink-0">
          <div 
            onClick={() => handleSelectView('overview')}
            className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer group"
          >
            <div className="w-11 h-11 rounded-full flex items-center justify-center p-0.5 shrink-0 bg-transparent group-hover:scale-105 transition-transform">
              <img 
                src={mainAdminLogoUrl} 
                alt={parentGroup.name || 'MAK Group of Companies'} 
                className="w-full h-full object-contain drop-shadow" 
              />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-extrabold text-xs sm:text-sm text-white tracking-wide uppercase truncate leading-tight">
                {parentGroup.name || 'MAK Group of Companies'}
              </h1>
              <p className="text-[10px] sm:text-xs font-mono text-amber-400 uppercase tracking-wider truncate mt-0.5">
                Main Admin Panel
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={() => {
              if (window.innerWidth < 1024) {
                setMobileSidebarOpen(false);
              } else {
                setSidebarCollapsed(true);
              }
            }}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition cursor-pointer flex items-center justify-center text-xs font-semibold border border-white/10 shrink-0"
            title="Close / Hide Sidebar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Navigation List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar text-xs">
          
          {/* 4 SUBSIDIARY COMPANIES */}
          <div>
            <div className="space-y-1.5">
              {COMPANIES_LIST.map((comp, cIdx) => {
                const viewKey: PortalView = `company_${comp.id}` as PortalView;
                const isSelected = activeView === viewKey;
                const s = statsByCompany[comp.id];

                return (
                  <button
                    key={`comp_nav_${comp.id}_${cIdx}`}
                    type="button"
                    onClick={() => handleSelectView(viewKey)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2.5 rounded-xl transition-all cursor-pointer text-left ${
                      isSelected
                        ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200 shadow-md font-semibold'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-7 h-7 flex items-center justify-center p-0.5 shrink-0 bg-transparent">
                        <img 
                          src={getCompanyLogoUrl(comp.id)} 
                          alt={comp.name} 
                          className="max-h-full max-w-full object-contain drop-shadow-sm" 
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs leading-snug text-white">{comp.name}</div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-200">
                        {s ? s.totalCases : 0} Cases
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SECTION 2.5: CENTRALIZED STATUS & TRACKING */}
          <div>
            <div className="px-3 py-1 text-xs font-bold text-amber-400/90 uppercase tracking-widest font-mono">
              Central Status & Tracking
            </div>
            <div className="space-y-1.5 mt-1">
              {/* Centralized Container Status */}
              <button
                type="button"
                onClick={() => handleSelectView('container_status')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                  activeView === 'container_status'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm'
                    : 'text-slate-200 hover:bg-white/5 hover:text-white border border-white/5 bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Package size={16} className={activeView === 'container_status' ? 'text-amber-400' : 'text-amber-400/80'} />
                  <span className="text-xs font-semibold">Container Status</span>
                </div>
                <span className="text-[10px] font-mono bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-bold">
                  All Co.
                </span>
              </button>

              {/* Centralized Vehicle Status */}
              <button
                type="button"
                onClick={() => handleSelectView('vehicle_status')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                  activeView === 'vehicle_status'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm'
                    : 'text-slate-200 hover:bg-white/5 hover:text-white border border-white/5 bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Truck size={16} className={activeView === 'vehicle_status' ? 'text-amber-400' : 'text-amber-400/80'} />
                  <span className="text-xs font-semibold">Vehicle Status</span>
                </div>
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-bold">
                  Fleet
                </span>
              </button>
            </div>
          </div>

          {/* SECTION 3: GROUP ADMIN SETTINGS */}
          <div>
            <div className="px-3 py-1 text-xs font-bold text-slate-400 uppercase tracking-widest font-mono">
              Group Admin Settings
            </div>
            <div className="space-y-1 mt-1">
              {/* Profile Editing */}
              <button
                type="button"
                onClick={() => handleSelectView('setting_profile')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_profile'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <UserCheck size={16} className={activeView === 'setting_profile' ? 'text-amber-400' : 'text-slate-400'} />
                  <span className="text-xs font-semibold">Profile Editing</span>
                </div>
                <span className="text-xs font-mono bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-bold">
                  Main ID
                </span>
              </button>

              {/* Logos & Subsidiary Branding */}
              <button
                type="button"
                onClick={() => handleSelectView('setting_logo')}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_logo'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <ImageIcon size={16} className={activeView === 'setting_logo' ? 'text-amber-400' : 'text-slate-400'} />
                <span className="text-xs font-semibold">Logos & Subsidiary Branding</span>
              </button>

              {/* Backup & System Recovery */}
              <button
                type="button"
                onClick={() => handleSelectView('setting_backup')}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_backup'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Database size={16} className={activeView === 'setting_backup' ? 'text-amber-400' : 'text-slate-400'} />
                <span className="text-xs font-semibold">Backup & System Recovery</span>
              </button>

              {/* Conglomerate Legal Details */}
              <button
                type="button"
                onClick={() => handleSelectView('setting_general')}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_general'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Sliders size={16} className={activeView === 'setting_general' ? 'text-amber-400' : 'text-slate-400'} />
                <span className="text-xs font-semibold">Conglomerate Legal Details</span>
              </button>

              {/* Google Drive Storage Sync */}
              <button
                type="button"
                onClick={() => handleSelectView('setting_drive')}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_drive'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <HardDrive size={16} className={activeView === 'setting_drive' ? 'text-amber-400' : 'text-slate-400'} />
                <span className="text-xs font-semibold">Google Drive Storage Sync</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar Footer Controls */}
        <div className="p-3 border-t border-white/10 bg-[#111724] space-y-2 shrink-0">
          {/* Theme Switcher */}
          <div className="flex items-center justify-between px-1 py-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">Theme</span>
            <ThemeToggleSwitch />
          </div>

          {/* Return to Subsidiary Workspace Button */}
          <button
            type="button"
            onClick={onExitPortal}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-xs transition cursor-pointer border border-white/10 shadow-sm"
            title="Return back to operational subsidiary workspace"
          >
            <ArrowLeft size={14} />
            <span>Exit Admin Portal</span>
          </button>

          {/* Logout Button */}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-rose-400 hover:bg-rose-500/10 text-xs font-semibold transition cursor-pointer"
              title="Sign Out"
            >
              <LogOut size={13} />
              <span>Logout</span>
            </button>
          )}
        </div>
      </aside>

      {/* ======================================================== */}
      {/* MAIN CONTENT AREA                                        */}
      {/* ======================================================== */}
      <main className="flex-1 flex flex-col h-full min-h-0 min-w-0 overflow-hidden relative bg-[#090C12]">
        
        {/* Top Navbar */}
        <header className="h-14 sm:h-16 bg-[#0F1420] border-b border-white/10 flex items-center justify-between px-2.5 sm:px-6 shrink-0 z-20 gap-2">
          {/* Left section: Sidebar toggle & Title */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 1024) {
                  setMobileSidebarOpen(!mobileSidebarOpen);
                } else {
                  setSidebarCollapsed(!sidebarCollapsed);
                }
              }}
              className={`h-9 px-2.5 sm:px-3 rounded-xl border cursor-pointer flex items-center gap-1.5 transition active:scale-95 shrink-0 ${
                sidebarCollapsed 
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm hover:bg-amber-500/30' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-white/10'
              }`}
              title={sidebarCollapsed ? "Show / Expand Sidebar" : "Hide / Collapse Sidebar"}
            >
              <Menu size={16} className={sidebarCollapsed ? "text-amber-400" : "text-slate-300"} />
              <span className="text-[11px] sm:text-xs font-semibold whitespace-nowrap">
                {sidebarCollapsed ? "Sidebar" : "Hide"}
              </span>
            </button>

            {/* Main App Logo & Title */}
            <div className="flex items-center gap-2 min-w-0">
              <img 
                src={mainAdminLogoUrl} 
                alt={parentGroup.name || 'MAK Group of Companies'} 
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-contain drop-shadow shrink-0" 
              />
              <div className="min-w-0 truncate hidden xs:block sm:block">
                <h2 className="text-xs sm:text-sm font-semibold text-white tracking-wide truncate">
                  {activeView === 'overview' && 'MAK Group Overview'}
                  {activeView === 'company_docks' && 'Docks (Pvt.) Ltd.'}
                  {activeView === 'company_muhib' && 'Muhib International'}
                  {activeView === 'company_vantage' && 'Vantage Shipping Line'}
                  {activeView === 'company_truckit' && 'Truckit (Pvt.) Ltd.'}
                  {activeView === 'container_status' && 'Centralized Container Status (All Companies)'}
                  {activeView === 'vehicle_status' && 'Unified Fleet & Vehicle Status'}
                  {activeView === 'setting_profile' && 'Admin Profile & Security'}
                  {activeView === 'setting_logo' && 'Logos & Branding'}
                  {activeView === 'setting_backup' && 'Backup & Recovery'}
                  {activeView === 'setting_general' && 'Legal Details'}
                  {activeView === 'setting_drive' && 'Drive Cloud Sync'}
                </h2>
              </div>
            </div>
          </div>

          {/* Center Main Admin / App Logo */}
          <div className="hidden md:flex items-center justify-center px-2 shrink-0">
            <button
              type="button"
              onClick={() => handleSelectView('overview')}
              className="flex items-center gap-2 px-2 py-1 rounded-xl hover:bg-white/5 transition cursor-pointer group"
              title={parentGroup.name || 'MAK Group of Companies'}
            >
              <img 
                src={mainAdminLogoUrl} 
                alt={parentGroup.name || 'MAK Group of Companies'} 
                className="h-10 sm:h-11 w-auto object-contain drop-shadow group-hover:scale-105 transition-transform" 
              />
              <span className="text-xs font-bold tracking-wider uppercase text-slate-200 hidden xl:inline">
                {parentGroup.title || 'MAK GROUP OF COMPANIES'}
              </span>
            </button>
          </div>

          {/* Quick Actions Right */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {activeView === 'overview' && (
              <button
                type="button"
                onClick={handleExportConsolidatedReport}
                className="h-9 px-2.5 sm:px-3 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer active:scale-95"
                title="Export complete 4 companies consolidated Excel report"
              >
                <Download size={14} />
                <span className="hidden md:inline">Export Excel</span>
              </button>
            )}

            {isCompanyViewActive && currentSelectedCompany && onSelectCompanyWorkspace && (
              <button
                type="button"
                onClick={() => onSelectCompanyWorkspace(currentSelectedCompany.id)}
                className="h-9 px-2.5 sm:px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer active:scale-95"
                title={`Open full operational workspace for ${currentSelectedCompany.name}`}
              >
                <ExternalLink size={14} />
                <span className="hidden md:inline">Open Workspace</span>
              </button>
            )}

            <LiveNotificationCenter
              currentRole={UserRole.ADMIN}
              currentRoles={[UserRole.ADMIN]}
              userIdentifier={currentUserName || 'Arbabkhanboby'}
            />

            <ThemeToggleSwitch compact />

            <button
              type="button"
              onClick={onExitPortal}
              className="h-9 px-2.5 sm:px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/10 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-95"
              title="Return to subsidiary workspace"
            >
              <ArrowLeft size={14} />
              <span className="hidden sm:inline">Exit</span>
            </button>
          </div>
        </header>

        {/* Scrollable Main Body */}
        <div className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar ${activeView === 'container_status' || activeView === 'vehicle_status' ? 'p-0' : 'p-3 sm:p-6 space-y-6'}`}>
          
          {/* ======================================================== */}
          {/* VIEW A: CONSOLIDATED GROUP EXECUTIVE DASHBOARD            */}
          {/* ======================================================== */}
          {activeView === 'overview' && (
            <div className="space-y-6 animate-fade-in max-w-7xl mx-auto">
              
              {/* Executive Welcome & Group Headline Banner */}
              <div className="relative rounded-2xl sm:rounded-3xl p-4 sm:p-6 bg-gradient-to-br from-amber-950/30 via-slate-900 to-[#0e1626] border border-amber-500/25 shadow-xl overflow-hidden">
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-3.5">
                  <div className="flex items-center gap-3.5 sm:gap-4">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center shrink-0 bg-transparent">
                      <img 
                        src={mainAdminLogoUrl} 
                        alt={parentGroup.name || 'MAK Group of Companies'} 
                        className="w-full h-full object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.4)]" 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-amber-400/15 border border-amber-400/30 text-amber-300 text-[10px] sm:text-xs font-semibold uppercase tracking-wider">
                          Enterprise Conglomerate Intelligence
                        </span>
                        <span className="text-slate-400 text-[11px] sm:text-xs font-medium">
                          Live Cross-Entity Aggregate
                        </span>
                      </div>
                      <h2 className="text-lg sm:text-2xl font-bold text-white tracking-tight">
                        {parentGroup.name}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
                        Real-time consolidated tracking, financial reconciliation, and fleet oversight aggregating all 4 corporate subsidiaries: <span className="text-amber-300 font-semibold">Docks</span>, <span className="text-blue-300 font-semibold">Muhib International</span>, <span className="text-cyan-300 font-semibold">Vantage Shipping Line</span>, and <span className="text-red-300 font-semibold">Truckit</span>.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pt-1 md:pt-0">
                    <button
                      type="button"
                      onClick={handleExportConsolidatedReport}
                      className="w-full sm:w-auto px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 cursor-pointer active:scale-95 transition"
                    >
                      <Download size={14} />
                      <span>Consolidated Audit Excel</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 1. CONSOLIDATED GRAND TOTAL KPI METRICS */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
                
                {/* Total Consignments */}
                <div className="p-3.5 sm:p-5 rounded-2xl bg-[#111724] border border-white/10 shadow-md flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-slate-400 mb-1.5">
                      <span className="font-semibold uppercase tracking-wider text-[11px] sm:text-xs">Total Consignments</span>
                      <FolderKanban size={15} className="text-amber-400 shrink-0" />
                    </div>
                    <div className="text-xl sm:text-3xl font-bold font-mono text-white">
                      {grandTotals.totalCases}
                    </div>
                  </div>
                  <div className="text-[11px] sm:text-xs text-slate-400 mt-2 pt-2 border-t border-white/5 flex flex-col xs:flex-row xs:items-center justify-between gap-1">
                    <span>{grandTotals.totalContainers} Containers</span>
                    <span className="text-emerald-400 font-semibold">{grandTotals.completedCases} Cleared</span>
                  </div>
                </div>

                {/* Active In-Transit */}
                <div className="p-3.5 sm:p-5 rounded-2xl bg-[#111724] border border-white/10 shadow-md flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-slate-400 mb-1.5">
                      <span className="font-semibold uppercase tracking-wider text-[11px] sm:text-xs">Active In-Transit</span>
                      <Activity size={15} className="text-blue-400 shrink-0" />
                    </div>
                    <div className="text-xl sm:text-3xl font-bold font-mono text-blue-300">
                      {grandTotals.activeCases}
                    </div>
                  </div>
                  <div className="text-[11px] sm:text-xs text-slate-400 mt-2 pt-2 border-t border-white/5 flex flex-col xs:flex-row xs:items-center justify-between gap-1">
                    <span>Port Handling</span>
                    <span className="text-blue-400 font-semibold">Live Flow</span>
                  </div>
                </div>

                {/* Universal Fleet */}
                <div className="p-3.5 sm:p-5 rounded-2xl bg-[#111724] border border-white/10 shadow-md flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-slate-400 mb-1.5">
                      <span className="font-semibold uppercase tracking-wider text-[11px] sm:text-xs">Universal Fleet</span>
                      <Truck size={15} className="text-cyan-400 shrink-0" />
                    </div>
                    <div className="text-xl sm:text-3xl font-bold font-mono text-cyan-300">
                      {grandTotals.totalVehiclesCount}
                    </div>
                  </div>
                  <div className="text-[11px] sm:text-xs text-slate-400 mt-2 pt-2 border-t border-white/5 flex flex-col xs:flex-row xs:items-center justify-between gap-1">
                    <span>Heavy Fleet</span>
                    <span className="text-emerald-400 font-semibold">{grandTotals.availableFleet} Ready</span>
                  </div>
                </div>

                {/* Net Operating Profit */}
                <div className="p-3.5 sm:p-5 rounded-2xl bg-[#111724] border border-white/10 shadow-md flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-slate-400 mb-1.5">
                      <span className="font-semibold uppercase tracking-wider text-[11px] sm:text-xs">Net Operating Profit</span>
                      <DollarSign size={15} className="text-emerald-400 shrink-0" />
                    </div>
                    <div className="text-lg sm:text-2xl font-bold font-mono text-emerald-400 truncate">
                      PKR {grandTotals.netProfit.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-[11px] sm:text-xs text-slate-400 mt-2 pt-2 border-t border-white/5 flex flex-col xs:flex-row xs:items-center justify-between gap-1">
                    <span>Consolidated</span>
                    <span className="text-emerald-400 font-semibold">Group Margin</span>
                  </div>
                </div>
              </div>

              {/* 2. CONSOLIDATED FINANCIAL SUMMARY CARDS */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-950/30 to-[#111724] border border-emerald-500/20">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400 font-semibold uppercase text-xs tracking-wider">Total Group Revenue</span>
                    <TrendingUp size={14} className="text-emerald-400" />
                  </div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-emerald-300">
                    PKR {grandTotals.totalReceivables.toLocaleString()}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Consolidated billings, invoiced freight & client ledger dues across all companies.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-950/30 to-[#111724] border border-rose-500/20">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400 font-semibold uppercase text-xs tracking-wider">Total Group Expenses</span>
                    <TrendingDown size={14} className="text-rose-400" />
                  </div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-rose-300">
                    PKR {grandTotals.totalPayables.toLocaleString()}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Port dues, line demurrage, driver trip bills, staff payroll & overheads.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-950/30 to-[#111724] border border-blue-500/20">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400 font-semibold uppercase text-xs tracking-wider">Total Treasury & Reserves</span>
                    <CreditCard size={14} className="text-blue-400" />
                  </div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-blue-300">
                    PKR {(grandTotals.bankLiquidity + grandTotals.cashInHand).toLocaleString()}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Bank: PKR {grandTotals.bankLiquidity.toLocaleString()} • Office Cash: PKR {grandTotals.cashInHand.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* 3. THE 4 SUBSIDIARIES COMPARATIVE MATRIX */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Building2 size={18} className="text-amber-400" />
                      <span>Corporate Subsidiaries Breakdown (4 Companies)</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Click any subsidiary card to open its full dashboard page with real-time operational data.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {COMPANIES_LIST.map((comp, cIdx) => {
                    const s = statsByCompany[comp.id];
                    const viewKey: PortalView = `company_${comp.id}` as PortalView;

                    return (
                      <div
                        key={`matrix_comp_${comp.id}_${cIdx}`}
                        className="group relative rounded-2xl p-5 bg-[#111724] border border-white/10 hover:border-amber-400/50 transition-all duration-300 shadow-xl flex flex-col justify-between"
                      >
                        <div>
                          {/* Logo & Category */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="h-10 w-24 flex items-center">
                              <img 
                                src={getCompanyLogoUrl(comp.id)} 
                                alt={comp.name} 
                                className="max-h-full max-w-full object-contain filter drop-shadow" 
                              />
                            </div>
                            <span className="text-xs font-mono px-2 py-0.5 rounded bg-white/10 text-amber-300 font-bold uppercase">
                              {comp.shortName}
                            </span>
                          </div>

                          <h4 className="font-bold text-sm text-white group-hover:text-amber-300 transition-colors line-clamp-1">
                            {comp.name}
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                            {comp.category}
                          </p>

                          {/* Key Statistics */}
                          <div className="mt-4 space-y-2 border-t border-white/5 pt-3 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">Total Cases:</span>
                              <span className="font-bold font-mono text-white">{s.totalCases}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">In-Transit:</span>
                              <span className="font-bold font-mono text-blue-400">{s.activeCases}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">Completed:</span>
                              <span className="font-bold font-mono text-emerald-400">{s.completedCases}</span>
                            </div>
                            <div className="flex justify-between items-center border-t border-white/5 pt-1.5">
                              <span className="text-slate-400">Net Profit:</span>
                              <span className={`font-bold font-mono ${s.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                PKR {s.netProfit.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Open Company Dashboard Button */}
                        <div className="mt-4 pt-3 border-t border-white/5">
                          <button
                            type="button"
                            onClick={() => handleSelectView(viewKey)}
                            className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-amber-500 hover:text-slate-950 text-slate-300 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer group-hover:bg-amber-500/20 group-hover:text-amber-300"
                          >
                            <span>Open Company Dashboard</span>
                            <ArrowRight size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 4. CROSS-ENTITY LIVE CONSIGNMENTS FEED */}
              <div className="p-5 sm:p-6 rounded-2xl bg-[#111724] border border-white/10 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Boxes size={16} className="text-amber-400" />
                      <span>Cross-Entity Live Consignment Feed</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Recent cases from all subsidiaries updated in real time.
                    </p>
                  </div>

                  {/* Filters */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={feedSearch}
                        onChange={(e) => setFeedSearch(e.target.value)}
                        placeholder="Search case, client, B/L..."
                        className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 w-44 sm:w-56"
                      />
                    </div>

                    <select
                      value={feedCompanyFilter}
                      onChange={(e) => setFeedCompanyFilter(e.target.value as any)}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-amber-400"
                    >
                      <option value="ALL">All Companies</option>
                      <option value="docks">Docks (Pvt.) Ltd.</option>
                      <option value="muhib">Muhib International</option>
                      <option value="vantage">Vantage Shipping</option>
                      <option value="truckit">Truckit (Pvt.) Ltd.</option>
                    </select>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400 font-mono text-xs uppercase">
                        <th className="py-2.5 px-3">Subsidiary</th>
                        <th className="py-2.5 px-3">Case No.</th>
                        <th className="py-2.5 px-3">Client</th>
                        <th className="py-2.5 px-3">B/L No.</th>
                        <th className="py-2.5 px-3">Containers</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-sans">
                      {recentCasesFeed.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No shipments matching current filters.
                          </td>
                        </tr>
                      ) : (
                        recentCasesFeed.map((c, cIdx) => {
                          const cCompany = GROUP_COMPANIES[(c.companyId || 'docks') as CompanyId] || GROUP_COMPANIES.docks;
                          return (
                            <tr key={`grp_case_feed_${c.companyId || 'co'}_${c.id || c.caseNo || cIdx}_${cIdx}`} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 px-3">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-bold text-xs bg-white/10 text-slate-200">
                                  <span>{cCompany.shortName}</span>
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-bold text-amber-300">
                                {c.caseNo}
                              </td>
                              <td className="py-2.5 px-3 text-slate-200 font-sans font-medium truncate max-w-[150px]">
                                {c.clientName || 'General Client'}
                              </td>
                              <td className="py-2.5 px-3 text-slate-300">
                                {c.blNo || '-'}
                              </td>
                              <td className="py-2.5 px-3 text-slate-400">
                                {c.containers?.length || 1} units
                              </td>
                              <td className="py-2.5 px-3 font-sans">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                  c.status === CaseStatus.COMPLETED
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                }`}>
                                  {c.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-400 text-xs">
                                {c.createdAt ? c.createdAt.split('T')[0] : 'Today'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* VIEW B: INDIVIDUAL SUBSIDIARY DASHBOARD                   */}
          {/* ======================================================== */}
          {isCompanyViewActive && selectedCompanyId && currentSelectedCompany && (
            <div className="space-y-4 animate-fade-in max-w-7xl mx-auto">
              
              {/* Subsidiary Top Identification Card */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-[#111724] to-slate-900 border border-white/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center p-2 shrink-0">
                    <img 
                      src={getCompanyLogoUrl(currentSelectedCompany.id)} 
                      alt={currentSelectedCompany.name} 
                      className="max-h-full max-w-full object-contain" 
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-base sm:text-lg text-white">
                        {currentSelectedCompany.name}
                      </h3>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase border border-amber-500/30">
                        {currentSelectedCompany.shortName}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {currentSelectedCompany.category} • {currentSelectedCompany.tagline}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSelectView('overview')}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowLeft size={13} />
                    <span>Back to Group Overview</span>
                  </button>

                  {onSelectCompanyWorkspace && (
                    <button
                      type="button"
                      onClick={() => onSelectCompanyWorkspace(currentSelectedCompany.id)}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition shadow-lg shadow-amber-500/25 cursor-pointer active:scale-95"
                      title="Switch active company to this subsidiary and manage cases"
                    >
                      <ExternalLink size={13} />
                      <span>Launch Full Workspace</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Subsidiary's Dedicated Dashboard Component */}
              <div className="rounded-2xl overflow-hidden bg-[#0B0E14] border border-white/10 p-2 sm:p-4">
                <Dashboard 
                  targetCompanyId={selectedCompanyId} 
                  onNavigate={(viewId, filterData) => {
                    if (onSelectCompanyWorkspace) {
                      onSelectCompanyWorkspace(selectedCompanyId);
                    }
                  }} 
                />
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* VIEW C: MAIN ADMIN PROFILE EDITING                        */}
          {/* ======================================================== */}
          {activeView === 'setting_profile' && (
            <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
              
              {/* Header Card */}
              <div className="p-6 rounded-3xl bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-950 border border-amber-500/30 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 bg-transparent">
                    <img 
                      src={mainAdminLogoUrl} 
                      alt={parentGroup.name || 'MAK Group of Companies'} 
                      className="w-full h-full object-contain drop-shadow" 
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white">
                        Main Admin Profile & Credentials
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        ROOT MASTER
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Directly manage your Master User ID, Display Name, Password, and Master Security PIN.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectView('overview')}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowLeft size={14} />
                    <span>Back to Overview</span>
                  </button>
                </div>
              </div>

              {/* Success / Error Alerts */}
              {profileSuccessMsg && (
                <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-3 animate-fade-in">
                  <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                  <span className="font-semibold">{profileSuccessMsg}</span>
                </div>
              )}

              {profileErrorMsg && (
                <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-3 animate-fade-in">
                  <AlertCircle size={18} className="text-rose-400 shrink-0" />
                  <span className="font-semibold">{profileErrorMsg}</span>
                </div>
              )}

              {/* Profile Editing Form */}
              <form onSubmit={handleSaveAdminProfile} className="space-y-6">
                
                {/* 1. Identity & Contact Details */}
                <div className="p-6 rounded-2xl bg-[#111724] border border-white/10 shadow-lg space-y-4">
                  <div className="border-b border-white/10 pb-3 flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <UserCheck size={16} className="text-amber-400" />
                        Admin Identification & Contact Details
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Primary authentication credentials and global enterprise identification
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Main User ID / Login Username *
                      </label>
                      <input
                        type="text"
                        value={profileUserId}
                        onChange={(e) => setProfileUserId(e.target.value)}
                        placeholder="e.g. admin"
                        required
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-amber-400 text-xs"
                      />
                      <span className="text-slate-400 text-xs mt-1 block font-mono">
                        Primary login identifier used for executive authentication
                      </span>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Full Name / Display Name *
                      </label>
                      <input
                        type="text"
                        value={profileDisplayName}
                        onChange={(e) => setProfileDisplayName(e.target.value)}
                        placeholder="e.g. Arbab Khan"
                        required
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-xs"
                      />
                      <span className="text-slate-400 text-xs mt-1 block">
                        Displayed across executive documents, legal dossiers, and portals
                      </span>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Official Email Address
                      </label>
                      <input
                        type="email"
                        value={profileEmail}
                        onChange={(e) => setProfileEmail(e.target.value)}
                        placeholder="e.g. docks.live.app@gmail.com"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Direct Phone / WhatsApp
                      </label>
                      <input
                        type="tel"
                        value={profilePhone}
                        onChange={(e) => setProfilePhone(e.target.value)}
                        placeholder="e.g. +92 300 8221199"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Password & Security Credentials */}
                <div className="p-6 rounded-2xl bg-[#111724] border border-white/10 shadow-lg space-y-4">
                  <div className="border-b border-white/10 pb-3 flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Lock size={16} className="text-amber-400" />
                        Password & Security PIN
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Leave blank to maintain current master password
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowProfilePasswords(!showProfilePasswords)}
                      className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      {showProfilePasswords ? <EyeOff size={14} /> : <Eye size={14} />}
                      <span>{showProfilePasswords ? "Hide Passwords" : "Show Passwords"}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        New Password
                      </label>
                      <input
                        type={showProfilePasswords ? "text" : "password"}
                        value={profileNewPassword}
                        onChange={(e) => setProfileNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Confirm New Password
                      </label>
                      <input
                        type={showProfilePasswords ? "text" : "password"}
                        value={profileConfirmPassword}
                        onChange={(e) => setProfileConfirmPassword(e.target.value)}
                        placeholder="Re-type new password"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Master Security PIN
                      </label>
                      <input
                        type={showProfilePasswords ? "text" : "password"}
                        value={profilePin}
                        maxLength={6}
                        onChange={(e) => setProfilePin(e.target.value)}
                        placeholder="4 or 6 digit PIN"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-amber-400 text-xs tracking-widest"
                      />
                      <span className="text-slate-400 text-xs mt-1 block">
                        Required for sensitive system overrides and master authorization
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Privileges Summary */}
                <div className="p-5 rounded-2xl bg-amber-500/5 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-amber-300 uppercase tracking-wider font-mono">
                      Active Role Privileges
                    </span>
                    <p className="text-xs text-slate-300">
                      Unrestricted executive authorization active across all 4 subsidiaries (Docks, Muhib, Vantage, Truckit) including database management and master recovery.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
                      Full Access Active
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-mono font-bold">
                      Root Admin
                    </span>
                  </div>
                </div>

                {/* 4. Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileUserId(safeAppStorage.getItem('dpl_admin_userid') || 'admin');
                      setProfileDisplayName(safeAppStorage.getItem('dpl_current_user_name') || currentUserName || 'Arbab Khan');
                      setProfileEmail(safeAppStorage.getItem('dpl_admin_email') || 'docks.live.app@gmail.com');
                      setProfilePhone(safeAppStorage.getItem('dpl_admin_phone') || '+92 300 8221199');
                      setProfileCurrentPassword('');
                      setProfileNewPassword('');
                      setProfileConfirmPassword('');
                      setProfileErrorMsg('');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
                  >
                    Reset
                  </button>

                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/30 transition cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    {isSavingProfile ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save size={14} />
                        <span>Save Profile & Credentials</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ======================================================== */}
          {/* VIEW D: GROUP ADMIN SETTINGS (EMBEDDED FULLSCREEN)       */}
          {/* ======================================================== */}
          {isSettingsActive && (
            <div className="h-full min-h-[700px] flex flex-col animate-fade-in max-w-7xl mx-auto">
              <GroupAdminManagementModal
                isOpen={true}
                isPortalMode={true}
                hideTabsBar={true}
                onClose={() => handleSelectView('overview')}
                currentUserName={profileDisplayName || currentUserName}
                initialTab={getSettingsTabFromView(activeView)}
              />
            </div>
          )}

          {/* ======================================================== */}
          {/* VIEW E: CENTRALIZED CONTAINER STATUS (ALL 4 COMPANIES)   */}
          {/* ======================================================== */}
          {activeView === 'container_status' && (
            <div className="min-h-full w-full animate-fade-in">
              <PublicContainerTrackingPortal
                onExitPortal={() => handleSelectView('overview')}
                onSwitchToVehicleTracker={() => handleSelectView('vehicle_status')}
              />
            </div>
          )}

          {/* ======================================================== */}
          {/* VIEW F: CENTRALIZED VEHICLE STATUS                       */}
          {/* ======================================================== */}
          {activeView === 'vehicle_status' && (
            <div className="min-h-full w-full animate-fade-in">
              <PublicVehicleTrackingPortal
                onExitPortal={() => handleSelectView('overview')}
                onSwitchToContainerTracker={() => handleSelectView('container_status')}
              />
            </div>
          )}

        </div>
      </main>
    </div>
  );
};

export default GroupAdminPortal;

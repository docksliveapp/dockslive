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
  AlertCircle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid,
  Legend
} from 'recharts';
import { Case, Vehicle, FinanceEntry, AppUser, CaseStatus, UserRole } from '../types';
import { 
  subscribeToCases, 
  subscribeToVehicles, 
  subscribeToFinances, 
  subscribeToUsers,
  matchesActiveCompany 
} from '../services/dbService';
import { 
  CompanyId, 
  GROUP_COMPANIES, 
  COMPANIES_LIST, 
  useParentGroup, 
  getCompanyLogoUrl 
} from '../services/companyService';
import { useBranding } from '../services/brandingService';
import { safeAppStorage } from '../services/storage';
import { exportTableToExcel } from '../services/excelExportService';
import GroupAdminManagementModal, { AdminSettingsTab } from './GroupAdminManagementModal';
import Dashboard from './Dashboard';

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
  | 'setting_users'
  | 'setting_logo'
  | 'setting_backup'
  | 'setting_general'
  | 'setting_tax'
  | 'setting_drive'
  | 'setting_banks'
  | 'setting_approvals';

export const GroupAdminPortal: React.FC<GroupAdminPortalProps> = ({
  onExitPortal,
  onSignOut,
  onSelectCompanyWorkspace,
  currentUserName = 'Arbab Khan'
}) => {
  const [activeView, setActiveView] = useState<PortalView>('overview');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Parent Group & Branding
  const { parentGroup } = useParentGroup();
  const { branding } = useBranding();

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

  // Pending Registrations Count
  const pendingApprovalsCount = useMemo(() => {
    return allUsers.filter(u => u.status === 'PENDING_APPROVAL').length;
  }, [allUsers]);

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

  // Chart Data: Cases & Finance comparison by subsidiary
  const chartData = useMemo(() => {
    return COMPANIES_LIST.map(comp => {
      const s = statsByCompany[comp.id];
      return {
        name: comp.shortName,
        fullName: comp.name,
        Cases: s.totalCases,
        Active: s.activeCases,
        Containers: s.containersCount,
        Revenue: Math.round(s.receivables / 1000), // In thousands
        Expenses: Math.round(s.payables / 1000), // In thousands
        Profit: Math.round(s.netProfit / 1000)
      };
    });
  }, [statsByCompany]);

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

  // Helper to switch view and close mobile drawer
  const handleSelectView = (view: PortalView) => {
    setActiveView(view);
    setMobileSidebarOpen(false);
  };

  // Convert setting view to setting tab key
  const getSettingsTabFromView = (view: PortalView): AdminSettingsTab => {
    switch (view) {
      case 'setting_users': return 'users';
      case 'setting_logo': return 'logo';
      case 'setting_backup': return 'backup';
      case 'setting_general': return 'general';
      case 'setting_tax': return 'tax';
      case 'setting_drive': return 'drive';
      case 'setting_banks': return 'banks';
      case 'setting_approvals': return 'approvals';
      default: return 'users';
    }
  };

  const isSettingsActive = activeView.startsWith('setting_');
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
      <aside className={`fixed top-0 left-0 h-full bg-[#0E121B] border-r border-white/10 z-50 flex flex-col transition-all duration-300 w-72 sm:w-80 lg:static lg:w-72 shadow-2xl ${
        mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        
        {/* Header / Conglomerate Branding */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-[#111724]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center p-1.5 shadow-md shadow-amber-500/20 shrink-0">
              <Crown className="w-5 h-5 text-slate-950" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-extrabold text-xs sm:text-sm text-white tracking-wide uppercase truncate">
                  MAK Group Portal
                </h1>
              </div>
              <p className="text-[10px] font-mono text-amber-400 uppercase tracking-wider truncate">
                Main Admin Control Panel
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Navigation List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar text-xs">
          
          {/* SECTION 1: EXECUTIVE HUB */}
          <div>
            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
              Executive Hub
            </div>
            <button
              type="button"
              onClick={() => handleSelectView('overview')}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl transition-all cursor-pointer font-bold ${
                activeView === 'overview'
                  ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-300 border border-amber-500/40 shadow-lg shadow-amber-500/10'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 truncate">
                <Crown size={16} className={activeView === 'overview' ? 'text-amber-400' : 'text-slate-400'} />
                <span className="truncate">Group Executive Dashboard</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold shrink-0">
                Total
              </span>
            </button>
          </div>

          {/* SECTION 2: 4 SUBSIDIARY COMPANIES */}
          <div>
            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono flex items-center justify-between">
              <span>Subsidiaries (4 Companies)</span>
              <span className="text-[9px] text-amber-400">Live Data</span>
            </div>
            <div className="space-y-1 mt-1">
              {COMPANIES_LIST.map((comp) => {
                const viewKey: PortalView = `company_${comp.id}` as PortalView;
                const isSelected = activeView === viewKey;
                const s = statsByCompany[comp.id];

                return (
                  <button
                    key={comp.id}
                    type="button"
                    onClick={() => handleSelectView(viewKey)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl transition-all cursor-pointer text-left ${
                      isSelected
                        ? 'bg-blue-600/20 border border-blue-500/40 text-white shadow-md'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 truncate">
                      <div className="w-7 h-7 rounded-lg bg-black/50 border border-white/10 flex items-center justify-center p-1 shrink-0">
                        <img 
                          src={getCompanyLogoUrl(comp.id)} 
                          alt={comp.name} 
                          className="max-h-full max-w-full object-contain" 
                        />
                      </div>
                      <div className="min-w-0 flex-1 truncate">
                        <div className="font-bold text-[11px] truncate text-white">{comp.name}</div>
                        <div className="text-[9px] text-slate-400 font-mono truncate">{comp.shortName} • {comp.category}</div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-200">
                        {s ? s.totalCases : 0} Cases
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SECTION 3: GROUP ADMIN SETTINGS (ALL 8 CONTROLS) */}
          <div>
            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
              Group Admin Settings
            </div>
            <div className="space-y-0.5 mt-1">
              <button
                type="button"
                onClick={() => handleSelectView('setting_users')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_users'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck size={15} className="text-slate-400" />
                  <span>Admin Users & Privileges</span>
                </div>
                <span className="text-[9px] font-mono bg-white/10 px-1.5 py-0.5 rounded text-slate-300 font-bold">
                  {allUsers.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectView('setting_logo')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_logo'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <ImageIcon size={15} className="text-slate-400" />
                <span>Logos & Subsidiary Branding</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectView('setting_backup')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_backup'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Database size={15} className="text-slate-400" />
                <span>Backup & System Recovery</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectView('setting_general')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_general'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Sliders size={15} className="text-slate-400" />
                <span>Conglomerate Legal Details</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectView('setting_tax')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_tax'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <FileText size={15} className="text-slate-400" />
                <span>Tax & SRB Withholding</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectView('setting_drive')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_drive'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <HardDrive size={15} className="text-slate-400" />
                <span>Google Drive Storage Sync</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectView('setting_banks')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_banks'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <CreditCard size={15} className="text-slate-400" />
                <span>Corporate Bank Accounts</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectView('setting_approvals')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all cursor-pointer ${
                  activeView === 'setting_approvals'
                    ? 'bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40'
                    : pendingApprovalsCount > 0
                    ? 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 size={15} className={pendingApprovalsCount > 0 ? 'text-rose-400' : 'text-slate-400'} />
                  <span>Pending Staff Approvals</span>
                </div>
                {pendingApprovalsCount > 0 && (
                  <span className="text-[9px] font-mono bg-rose-500 text-white font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                    {pendingApprovalsCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar Footer Controls */}
        <div className="p-3 border-t border-white/10 bg-[#111724] space-y-2 shrink-0">
          {/* Admin User Info */}
          <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <div className="min-w-0 truncate">
                <span className="text-[11px] font-bold text-white block truncate">{currentUserName}</span>
                <span className="text-[9px] font-mono text-amber-300 block truncate">Global Super Admin</span>
              </div>
            </div>
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
        <header className="h-16 sm:h-18 bg-[#0F1420] border-b border-white/10 flex items-center justify-between px-3 sm:px-6 shrink-0 z-20">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
              className="lg:hidden p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white border border-white/10 cursor-pointer"
              title="Toggle Menu"
            >
              <Menu size={18} />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono font-bold text-xs uppercase tracking-wider shrink-0 flex items-center gap-1.5">
                <Crown size={12} className="text-amber-400" />
                Main Admin
              </span>
              <div className="min-w-0 truncate">
                <h2 className="text-xs sm:text-sm font-extrabold text-white uppercase tracking-wider truncate">
                  {activeView === 'overview' && 'MAK Group Executive Overview • Consolidated Multi-Entity Dashboard'}
                  {activeView === 'company_docks' && 'Docks (Pvt.) Ltd. • Subsidiary Dashboard'}
                  {activeView === 'company_muhib' && 'Muhib International (SMC-Pvt.) Ltd. • Subsidiary Dashboard'}
                  {activeView === 'company_vantage' && 'Vintage Shipping Line • Subsidiary Dashboard'}
                  {activeView === 'company_truckit' && 'Truckit (Pvt.) Ltd. • Subsidiary Dashboard'}
                  {activeView === 'setting_users' && 'Admin Users & Privileges'}
                  {activeView === 'setting_logo' && 'Logos & Subsidiary Branding'}
                  {activeView === 'setting_backup' && 'System Backup & Recovery'}
                  {activeView === 'setting_general' && 'Conglomerate Legal Details'}
                  {activeView === 'setting_tax' && 'Tax & SRB Withholding'}
                  {activeView === 'setting_drive' && 'Google Drive Cloud Sync'}
                  {activeView === 'setting_banks' && 'Corporate Bank Accounts'}
                  {activeView === 'setting_approvals' && 'Pending Staff Registration Approvals'}
                </h2>
              </div>
            </div>
          </div>

          {/* Quick Actions Right */}
          <div className="flex items-center gap-2 shrink-0">
            {activeView === 'overview' && (
              <button
                type="button"
                onClick={handleExportConsolidatedReport}
                className="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-md shadow-emerald-600/20 cursor-pointer"
                title="Export complete 4 companies consolidated Excel report"
              >
                <Download size={13} />
                <span className="hidden sm:inline">Export Excel</span>
              </button>
            )}

            {isCompanyViewActive && currentSelectedCompany && onSelectCompanyWorkspace && (
              <button
                type="button"
                onClick={() => onSelectCompanyWorkspace(currentSelectedCompany.id)}
                className="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-md shadow-blue-600/20 cursor-pointer"
                title={`Open full operational workspace for ${currentSelectedCompany.name}`}
              >
                <ExternalLink size={13} />
                <span className="hidden sm:inline">Open Full Workspace</span>
              </button>
            )}

            <button
              type="button"
              onClick={onExitPortal}
              className="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/10 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              title="Return to subsidiary workspace"
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">Exit Portal</span>
            </button>
          </div>
        </header>

        {/* Scrollable Main Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-6 custom-scrollbar space-y-6">
          
          {/* ======================================================== */}
          {/* VIEW A: CONSOLIDATED GROUP EXECUTIVE DASHBOARD            */}
          {/* ======================================================== */}
          {activeView === 'overview' && (
            <div className="space-y-6 animate-fade-in max-w-7xl mx-auto">
              
              {/* Executive Welcome & Group Headline Banner */}
              <div className="relative rounded-3xl p-5 sm:p-7 bg-gradient-to-r from-amber-950/40 via-slate-900 to-blue-950/40 border border-amber-500/30 shadow-2xl overflow-hidden">
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-300 text-[10px] font-mono font-bold uppercase">
                        Enterprise Conglomerate Intelligence
                      </span>
                      <span className="text-slate-400 text-xs font-mono">
                        Live Cross-Entity Aggregate
                      </span>
                    </div>
                    <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">
                      {parentGroup.name}
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-300 max-w-2xl mt-1 leading-relaxed">
                      Real-time consolidated tracking, financial reconciliation, and fleet oversight aggregating all 4 corporate subsidiaries: <span className="text-amber-300 font-semibold">Docks</span>, <span className="text-blue-300 font-semibold">Muhib International</span>, <span className="text-cyan-300 font-semibold">Vintage Shipping Line</span>, and <span className="text-red-300 font-semibold">Truckit</span>.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleExportConsolidatedReport}
                      className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 font-extrabold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 cursor-pointer active:scale-95 transition"
                    >
                      <Download size={15} />
                      <span>Consolidated Audit Excel</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 1. CONSOLIDATED GRAND TOTAL KPI METRICS */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                
                {/* Total Shipments */}
                <div className="p-4 sm:p-5 rounded-2xl bg-[#111724] border border-white/10 shadow-lg">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                    <span className="font-semibold uppercase tracking-wider text-[11px]">Total Consignments</span>
                    <FolderKanban size={16} className="text-amber-400" />
                  </div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-white">
                    {grandTotals.totalCases}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between font-mono">
                    <span>{grandTotals.totalContainers} Total Containers</span>
                    <span className="text-emerald-400 font-bold">{grandTotals.completedCases} Cleared</span>
                  </div>
                </div>

                {/* Active In-Transit */}
                <div className="p-4 sm:p-5 rounded-2xl bg-[#111724] border border-white/10 shadow-lg">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                    <span className="font-semibold uppercase tracking-wider text-[11px]">Active In-Transit</span>
                    <Activity size={16} className="text-blue-400" />
                  </div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-blue-300">
                    {grandTotals.activeCases}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between font-mono">
                    <span>In-transit / Port handling</span>
                    <span className="text-blue-400 font-bold">Live Flow</span>
                  </div>
                </div>

                {/* Universal Fleet */}
                <div className="p-4 sm:p-5 rounded-2xl bg-[#111724] border border-white/10 shadow-lg">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                    <span className="font-semibold uppercase tracking-wider text-[11px]">Universal Fleet</span>
                    <Truck size={16} className="text-cyan-400" />
                  </div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-cyan-300">
                    {grandTotals.totalVehiclesCount}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between font-mono">
                    <span>Prime Movers & Trailers</span>
                    <span className="text-emerald-400 font-bold">{grandTotals.availableFleet} Ready</span>
                  </div>
                </div>

                {/* Net Operating Margin */}
                <div className="p-4 sm:p-5 rounded-2xl bg-[#111724] border border-white/10 shadow-lg">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                    <span className="font-semibold uppercase tracking-wider text-[11px]">Net Operating Profit</span>
                    <DollarSign size={16} className="text-emerald-400" />
                  </div>
                  <div className="text-xl sm:text-2xl font-black font-mono text-emerald-400 truncate">
                    PKR {grandTotals.netProfit.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between font-mono">
                    <span>Revenue - Expenses</span>
                    <span className="text-emerald-400 font-bold">Group Margin</span>
                  </div>
                </div>
              </div>

              {/* 2. CONSOLIDATED FINANCIAL SUMMARY CARDS */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-950/30 to-[#111724] border border-emerald-500/20">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Total Group Revenue (Receivables)</span>
                    <TrendingUp size={14} className="text-emerald-400" />
                  </div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-emerald-300">
                    PKR {grandTotals.totalReceivables.toLocaleString()}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Consolidated billings, invoiced freight & client ledger dues across all companies.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-950/30 to-[#111724] border border-rose-500/20">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Total Group Expenses (Payables)</span>
                    <TrendingDown size={14} className="text-rose-400" />
                  </div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-rose-300">
                    PKR {grandTotals.totalPayables.toLocaleString()}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Port dues, line demurrage, driver trip bills, staff payroll & overheads.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-950/30 to-[#111724] border border-blue-500/20">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Total Treasury & Bank Reserves</span>
                    <CreditCard size={14} className="text-blue-400" />
                  </div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-blue-300">
                    PKR {(grandTotals.bankLiquidity + grandTotals.cashInHand).toLocaleString()}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
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
                  {COMPANIES_LIST.map((comp) => {
                    const s = statsByCompany[comp.id];
                    const viewKey: PortalView = `company_${comp.id}` as PortalView;

                    return (
                      <div
                        key={comp.id}
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
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-amber-300 font-bold uppercase">
                              {comp.shortName}
                            </span>
                          </div>

                          <h4 className="font-extrabold text-sm text-white group-hover:text-amber-300 transition-colors line-clamp-1">
                            {comp.name}
                          </h4>
                          <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
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

              {/* 4. VISUAL COMPARISON CHART: VOLUME BY SUBSIDIARY */}
              <div className="p-5 sm:p-6 rounded-2xl bg-[#111724] border border-white/10 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <BarChart3 size={16} className="text-amber-400" />
                      <span>Consignment Volume by Subsidiary</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Comparison of total cases, active shipments, and containers across the 4 corporate entities.
                    </p>
                  </div>
                </div>

                <div className="h-64 sm:h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                      <YAxis stroke="#94a3b8" fontSize={11} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#0F172A', 
                          borderColor: '#334155', 
                          borderRadius: '12px',
                          color: '#fff',
                          fontSize: '12px' 
                        }} 
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Bar dataKey="Cases" fill="#F59E0B" radius={[4, 4, 0, 0]} name="Total Cases" />
                      <Bar dataKey="Active" fill="#3B82F6" radius={[4, 4, 0, 0]} name="In-Transit" />
                      <Bar dataKey="Containers" fill="#10B981" radius={[4, 4, 0, 0]} name="Containers" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 5. CROSS-ENTITY LIVE CONSIGNMENTS FEED */}
              <div className="p-5 sm:p-6 rounded-2xl bg-[#111724] border border-white/10 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Boxes size={16} className="text-amber-400" />
                      <span>Cross-Entity Live Consignment Feed</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
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
                      <option value="vantage">Vintage Shipping</option>
                      <option value="truckit">Truckit (Pvt.) Ltd.</option>
                    </select>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400 font-mono text-[10px] uppercase">
                        <th className="py-2.5 px-3">Subsidiary</th>
                        <th className="py-2.5 px-3">Case No.</th>
                        <th className="py-2.5 px-3">Client</th>
                        <th className="py-2.5 px-3">B/L No.</th>
                        <th className="py-2.5 px-3">Containers</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono">
                      {recentCasesFeed.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No shipments matching current filters.
                          </td>
                        </tr>
                      ) : (
                        recentCasesFeed.map((c) => {
                          const cCompany = GROUP_COMPANIES[(c.companyId || 'docks') as CompanyId] || GROUP_COMPANIES.docks;
                          return (
                            <tr key={c.id || c.caseNo} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 px-3">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-bold text-[10px] bg-white/10 text-slate-200">
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
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  c.status === CaseStatus.COMPLETED
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                }`}>
                                  {c.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-400 text-[10px]">
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
                  <div className="w-14 h-14 rounded-2xl bg-black/60 border border-white/20 flex items-center justify-center p-2 shrink-0">
                    <img 
                      src={getCompanyLogoUrl(currentSelectedCompany.id)} 
                      alt={currentSelectedCompany.name} 
                      className="max-h-full max-w-full object-contain" 
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-black text-base sm:text-lg text-white">
                        {currentSelectedCompany.name}
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold uppercase">
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
                      className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-lg shadow-blue-600/25 cursor-pointer"
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
          {/* VIEW C: GROUP ADMIN SETTINGS PANELS (EMBEDDED FULLSCREEN) */}
          {/* ======================================================== */}
          {isSettingsActive && (
            <div className="h-full min-h-[700px] flex flex-col animate-fade-in max-w-7xl mx-auto">
              <GroupAdminManagementModal
                isOpen={true}
                isPortalMode={true}
                onClose={() => handleSelectView('overview')}
                currentUserName={currentUserName}
                initialTab={getSettingsTabFromView(activeView)}
              />
            </div>
          )}

        </div>
      </main>
    </div>
  );
};

export default GroupAdminPortal;

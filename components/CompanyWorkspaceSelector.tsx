import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  ArrowRight, 
  CheckCircle2, 
  Sparkles, 
  X, 
  ShieldCheck, 
  Ship, 
  Truck, 
  Globe, 
  Anchor,
  Crown,
  Sliders,
  Users,
  Settings,
  LogOut,
  Database,
  Image as ImageIcon
} from 'lucide-react';
import { 
  CompanyId, 
  CompanyInfo, 
  GROUP_COMPANIES, 
  COMPANIES_LIST, 
  useActiveCompany,
  useParentGroup
} from '../services/companyService';
import { subscribeToUsers } from '../services/dbService';
import { GroupAdminManagementModal, AdminSettingsTab } from './GroupAdminManagementModal';

interface CompanyWorkspaceSelectorProps {
  onSelectCompany: (companyId: CompanyId) => void;
  isModal?: boolean;
  onClose?: () => void;
  userName?: string;
  userRoleTitle?: string;
  onSignOut?: () => void;
}

export const CompanyWorkspaceSelector: React.FC<CompanyWorkspaceSelectorProps> = ({
  onSelectCompany,
  isModal = false,
  onClose,
  userName,
  userRoleTitle,
  onSignOut
}) => {
  const { companyId: currentActiveId } = useActiveCompany();
  const { parentGroup } = useParentGroup();
  const [isAdminManagementOpen, setIsAdminManagementOpen] = useState(false);
  const [adminInitialTab, setAdminInitialTab] = useState<AdminSettingsTab>('users');
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);

  // Subscribe to live user updates to get pending registrations count
  useEffect(() => {
    const unsub = subscribeToUsers((users) => {
      const pending = users.filter(u => u.status === 'PENDING_APPROVAL').length;
      setPendingApprovalsCount(pending);
    });
    return () => unsub();
  }, []);

  const openAdminModal = (tab: AdminSettingsTab = 'users') => {
    setAdminInitialTab(tab);
    setIsAdminManagementOpen(true);
  };

  const getCompanyIcon = (id: CompanyId) => {
    switch (id) {
      case 'docks':
        return <Anchor className="w-4 h-4 text-amber-400" />;
      case 'muhib':
        return <Globe className="w-4 h-4 text-blue-400" />;
      case 'vantage':
        return <Ship className="w-4 h-4 text-cyan-400" />;
      case 'truckit':
        return <Truck className="w-4 h-4 text-red-400" />;
    }
  };

  const content = (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-5 flex flex-col justify-between h-full min-h-full">
      {/* 1. TOP EXECUTIVE ACTION BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-2 sm:mb-3 pb-2.5 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
          <span className="text-[11px] font-mono uppercase tracking-wider text-amber-300 font-bold">
            {parentGroup.name}
          </span>
          <span className="text-gray-600 text-[10px] hidden sm:inline">• Central Gateway</span>
        </div>

        {/* Action pills */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          {/* Main Admin Hub Pill */}
          <button
            type="button"
            onClick={() => openAdminModal('users')}
            className="group relative px-2.5 sm:px-3 py-1 rounded-full text-xs font-bold tracking-wide transition-all duration-300 cursor-pointer overflow-hidden border border-amber-400/50 bg-gradient-to-r from-amber-500/25 via-yellow-500/35 to-amber-500/25 hover:from-amber-500 hover:via-yellow-400 hover:to-amber-500 text-amber-200 hover:text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.25)] hover:shadow-[0_0_25px_rgba(245,158,11,0.5)] transform hover:scale-105 active:scale-95 flex items-center gap-1.5"
            title="Open Central Admin Settings Hub (Admin Users, Branding & Complete Backup)"
          >
            <Crown size={13} className="text-amber-400 group-hover:text-slate-950 animate-pulse shrink-0" />
            <span className="font-sans">Admin Settings</span>
            <span className="text-[9px] px-1 py-0.1 rounded-full bg-amber-500/30 group-hover:bg-slate-900 group-hover:text-amber-300 text-amber-200 font-mono">
              Hub
            </span>
          </button>

          {/* Quick Pill: Logo & Branding */}
          <button
            type="button"
            onClick={() => openAdminModal('logo')}
            className="px-2.5 py-1 rounded-full text-xs font-semibold text-gray-300 hover:text-amber-300 bg-slate-900/90 hover:bg-amber-500/20 border border-white/10 hover:border-amber-400/50 transition-all flex items-center gap-1 cursor-pointer"
            title="Change Company Name, Title & App Logo"
          >
            <ImageIcon size={12} className="text-amber-400" />
            <span className="hidden sm:inline">Branding</span>
          </button>

          {/* Quick Pill: Complete Backup */}
          <button
            type="button"
            onClick={() => openAdminModal('backup')}
            className="px-2.5 py-1 rounded-full text-xs font-semibold text-gray-300 hover:text-amber-300 bg-slate-900/90 hover:bg-amber-500/20 border border-white/10 hover:border-amber-400/50 transition-all flex items-center gap-1 cursor-pointer"
            title="Export / Restore Complete Database Snapshot"
          >
            <Database size={12} className="text-amber-400" />
            <span className="hidden sm:inline">Backup</span>
          </button>

          {/* Quick Pill: Admin Users */}
          <button
            type="button"
            onClick={() => openAdminModal('users')}
            className="px-2.5 py-1 rounded-full text-xs font-semibold text-gray-300 hover:text-amber-300 bg-slate-900/90 hover:bg-amber-500/20 border border-white/10 hover:border-amber-400/50 transition-all flex items-center gap-1 cursor-pointer"
            title="Manage Global Administrator Accounts"
          >
            <Users size={12} className="text-amber-400" />
            <span className="hidden sm:inline">Users</span>
          </button>

          {/* Quick Pill: Pending Approvals with Live Counter */}
          <button
            type="button"
            onClick={() => openAdminModal('approvals')}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer border ${
              pendingApprovalsCount > 0
                ? 'border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 animate-pulse'
                : 'border-white/10 bg-slate-900/90 text-gray-400 hover:text-white hover:border-white/20'
            }`}
            title="Review & Verify Pending Client/Transporter Registrations"
          >
            <CheckCircle2 size={12} className={pendingApprovalsCount > 0 ? 'text-rose-400' : 'text-emerald-400'} />
            <span className="hidden sm:inline">Approvals</span>
            {pendingApprovalsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-500 text-white font-mono">
                {pendingApprovalsCount}
              </span>
            )}
          </button>

          {/* User badge */}
          {userName && (
            <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-900/90 border border-white/10 text-[11px] text-gray-300">
              <ShieldCheck size={12} className="text-emerald-400" />
              <span className="max-w-[100px] truncate">{userName}</span>
            </div>
          )}

          {/* Sign Out */}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="px-2 py-1 rounded-full text-xs font-medium text-gray-400 hover:text-rose-300 bg-white/5 hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/30 transition-all flex items-center gap-1 cursor-pointer"
              title="Sign Out / Switch Account"
            >
              <LogOut size={12} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          )}

          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-xl text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
              title="Close Switcher"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 2. CENTER CONGLOMERATE HEADER (Compact, Zero-Scroll Design) */}
      <div className="text-center my-1 sm:my-2 shrink-0">
        <div className="inline-flex items-center justify-center mb-1.5 transform hover:scale-105 transition-transform duration-300">
          <img 
            src={parentGroup.logo} 
            alt={parentGroup.name} 
            className="h-10 sm:h-12 w-auto max-w-[200px] object-contain drop-shadow-[0_4px_16px_rgba(245,158,11,0.3)]"
          />
        </div>

        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="h-px w-6 sm:w-12 bg-gradient-to-r from-transparent to-amber-400" />
          <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.25em] text-amber-400 font-sans">
            Enterprise Multi-Entity Workspace
          </span>
          <span className="h-px w-6 sm:w-12 bg-gradient-to-l from-transparent to-amber-400" />
        </div>

        <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-wide font-serif mb-0.5">
          {parentGroup.title}
        </h1>

        <p className="text-[11px] sm:text-xs text-amber-400/90 max-w-xl mx-auto font-sans font-semibold tracking-wider uppercase mb-1">
          {parentGroup.subtitle}
        </p>

        <p className="text-[11px] sm:text-xs text-gray-400 max-w-xl mx-auto font-sans line-clamp-1">
          Select an enterprise subsidiary below to launch its isolated workspace or open Admin Settings.
        </p>
      </div>

      {/* 3. 5 COMPACT BUTTONS / CARDS (4 Companies + 1 Admin Settings in ONE ROW, No Scrolling!) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3.5 my-auto w-full">
        
        {/* Company Card 1: DOCKS */}
        {COMPANIES_LIST.map((comp) => {
          const isCurrentActive = comp.id === currentActiveId;

          const getCardStyles = () => {
            switch (comp.id) {
              case 'docks':
                return {
                  border: isCurrentActive ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-amber-500/30 hover:border-amber-400',
                  glow: 'hover:shadow-[0_0_25px_rgba(245,158,11,0.25)]',
                  bgGradient: 'from-amber-950/30 via-slate-900/90 to-slate-950/95',
                  badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
                  buttonBg: 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950',
                };
              case 'muhib':
                return {
                  border: isCurrentActive ? 'border-blue-400 ring-2 ring-blue-400/50' : 'border-blue-500/30 hover:border-blue-400',
                  glow: 'hover:shadow-[0_0_25px_rgba(37,99,235,0.25)]',
                  bgGradient: 'from-blue-950/30 via-slate-900/90 to-slate-950/95',
                  badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
                  buttonBg: 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white',
                };
              case 'vantage':
                return {
                  border: isCurrentActive ? 'border-cyan-400 ring-2 ring-cyan-400/50' : 'border-cyan-500/30 hover:border-cyan-400',
                  glow: 'hover:shadow-[0_0_25px_rgba(14,165,233,0.25)]',
                  bgGradient: 'from-cyan-950/30 via-slate-900/90 to-slate-950/95',
                  badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
                  buttonBg: 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950',
                };
              case 'truckit':
                return {
                  border: isCurrentActive ? 'border-red-400 ring-2 ring-red-400/50' : 'border-red-500/30 hover:border-red-400',
                  glow: 'hover:shadow-[0_0_25px_rgba(239,68,68,0.25)]',
                  bgGradient: 'from-red-950/30 via-slate-900/90 to-slate-950/95',
                  badgeBg: 'bg-red-500/20 text-red-300 border-red-500/40',
                  buttonBg: 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white',
                };
            }
          };

          const styles = getCardStyles();

          return (
            <div
              key={comp.id}
              onClick={() => onSelectCompany(comp.id)}
              className={`group relative rounded-2xl p-3 sm:p-4 flex flex-col justify-between cursor-pointer transition-all duration-300 backdrop-blur-xl bg-gradient-to-b ${styles.bgGradient} border ${styles.border} ${styles.glow} transform hover:-translate-y-1 h-[210px] sm:h-[225px]`}
            >
              {/* Active Indicator Pin */}
              {isCurrentActive && (
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold shadow-md">
                  <CheckCircle2 size={10} className="text-emerald-400" />
                  <span>Active</span>
                </div>
              )}

              {/* Card Header: Short Badge & ID */}
              <div>
                <div className="flex items-center justify-between gap-1 mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${styles.badgeBg} flex items-center gap-1 truncate`}>
                    {getCompanyIcon(comp.id)}
                    <span>{comp.shortName}</span>
                  </span>
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest font-mono">
                    {comp.id.toUpperCase()}
                  </span>
                </div>

                {/* Company Logo in Card (Compact Box) */}
                <div className="h-14 sm:h-16 w-full flex items-center justify-center p-2 rounded-xl bg-black/40 border border-white/5 mb-2.5 group-hover:scale-[1.03] transition-transform duration-300">
                  <img 
                    src={comp.logo} 
                    alt={comp.name} 
                    className="max-h-full max-w-full object-contain filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]" 
                  />
                </div>

                {/* Title & Short Category */}
                <h3 className="text-xs sm:text-sm font-bold text-white group-hover:text-amber-300 transition-colors line-clamp-1">
                  {comp.name}
                </h3>
                <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1 font-medium">
                  {comp.category}
                </p>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCompany(comp.id);
                  }}
                  className={`w-full py-1.5 sm:py-2 px-2.5 rounded-xl font-bold text-[11px] uppercase tracking-wider shadow-md flex items-center justify-center gap-1.5 transition-all cursor-pointer ${styles.buttonBg}`}
                >
                  <span>{isCurrentActive ? 'Continue' : 'Enter'}</span>
                  <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          );
        })}

        {/* 5th CARD / BUTTON: ADMIN SETTINGS (Requested as the last button alongside companies) */}
        <div
          onClick={() => openAdminModal('users')}
          className="group relative rounded-2xl p-3 sm:p-4 flex flex-col justify-between cursor-pointer transition-all duration-300 backdrop-blur-xl bg-gradient-to-b from-amber-950/40 via-slate-900/90 to-slate-950/95 border border-amber-400/50 hover:border-amber-300 hover:shadow-[0_0_30px_rgba(245,158,11,0.35)] transform hover:-translate-y-1 h-[210px] sm:h-[225px]"
        >
          {/* Card Header: Badge & Status */}
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border bg-amber-500/20 text-amber-300 border-amber-500/40 flex items-center gap-1">
                <Crown className="w-3.5 h-3.5 text-amber-400" />
                <span>ADMIN</span>
              </span>
              <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest font-mono">
                SYSTEM
              </span>
            </div>

            {/* Central Icon Box (Shimmering Golden Emblem) */}
            <div className="h-14 sm:h-16 w-full flex items-center justify-center p-2 rounded-xl bg-gradient-to-br from-amber-500/20 via-black/50 to-amber-600/20 border border-amber-500/30 mb-2.5 group-hover:scale-[1.03] transition-transform duration-300">
              <div className="relative flex items-center justify-center">
                <Crown size={28} className="text-amber-400 animate-pulse drop-shadow-[0_0_12px_rgba(245,158,11,0.6)]" />
                <Settings size={14} className="absolute -bottom-1 -right-2 text-yellow-300 group-hover:rotate-90 transition-transform duration-500" />
              </div>
            </div>

            {/* Title & Category */}
            <h3 className="text-xs sm:text-sm font-bold text-amber-300 group-hover:text-white transition-colors line-clamp-1">
              Admin Settings
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1 font-medium">
              Users, Branding & Backup
            </p>
          </div>

          {/* Action Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openAdminModal('users');
              }}
              className="w-full py-1.5 sm:py-2 px-2.5 rounded-xl font-bold text-[11px] uppercase tracking-wider shadow-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 hover:from-amber-400 hover:via-yellow-300 hover:to-amber-400 text-slate-950 font-sans shadow-amber-500/20"
            >
              <Crown size={12} className="text-slate-950" />
              <span>Admin Settings</span>
            </button>
          </div>
        </div>

      </div>

      {/* 4. COMPACT FOOTER (Zero Extra Margin) */}
      <div className="text-center my-1 text-[11px] text-gray-500 font-sans shrink-0">
        MAK Group of Companies • Cross-entity user authentication enabled. Subsidiaries can be switched at any time.
      </div>

      {/* Central Admin Settings Hub Modal (All 8 Sections) */}
      <GroupAdminManagementModal
        isOpen={isAdminManagementOpen}
        onClose={() => setIsAdminManagementOpen(false)}
        currentUserName={userName}
        initialTab={adminInitialTab}
      />
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-hidden">
        <div className="relative w-full max-w-7xl bg-slate-950/95 border border-white/10 rounded-3xl shadow-2xl my-auto max-h-[96vh] flex flex-col overflow-hidden">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen max-h-screen max-h-[100dvh] w-full bg-[#030712] text-gray-100 flex flex-col justify-between overflow-hidden relative">
      {/* Background cyber ambient glow */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 50%, rgba(245, 158, 11, 0.08) 0%, transparent 60%),
            linear-gradient(to right, rgba(56, 189, 248, 0.06) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(56, 189, 248, 0.06) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 48px 48px, 48px 48px'
        }}
      />
      {content}
    </div>
  );
};

export default CompanyWorkspaceSelector;

import React, { useState } from 'react';
import { 
  Building2, 
  ArrowRight, 
  CheckCircle2, 
  Sparkles, 
  X, 
  Ship, 
  Truck, 
  Globe, 
  Anchor,
  Crown,
  LogOut,
  ChevronRight,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';
import { 
  CompanyId, 
  CompanyInfo, 
  COMPANIES_LIST, 
  useActiveCompany,
  useParentGroup,
  isUploadedLogo
} from '../services/companyService';
import { safeAppStorage } from '../services/storage';
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

  const openAdminModal = (tab: AdminSettingsTab = 'users') => {
    setAdminInitialTab(tab);
    setIsAdminManagementOpen(true);
  };

  const getCompanyIcon = (id: CompanyId) => {
    switch (id) {
      case 'docks':
        return <Anchor className="w-5 h-5 text-amber-400" />;
      case 'muhib':
        return <Globe className="w-5 h-5 text-blue-400" />;
      case 'vantage':
        return <Ship className="w-5 h-5 text-cyan-400" />;
      case 'truckit':
        return <Truck className="w-5 h-5 text-rose-400" />;
    }
  };

  const getCompanyCardLogo = (comp: CompanyInfo) => {
    const companyBranding = safeAppStorage.getJSON<any>(`dpl_company_branding_v1_${comp.id}`, {});
    const candLogo = companyBranding?.customLogo || comp.logo;
    return isUploadedLogo(candLogo) ? candLogo : null;
  };

  const content = (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col justify-start">
      {/* 1. TOP EXECUTIVE ACTION BAR (ONLY Admin Settings & Logout as requested) */}
      <div className="flex items-center justify-between gap-3 pb-3 mb-4 sm:mb-6 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
          </span>
          <div>
            <span className="text-xs sm:text-sm font-mono uppercase tracking-wider text-amber-300 font-bold">
              {parentGroup.name || 'MAK Group of Companies'}
            </span>
            <span className="text-gray-500 text-[10px] hidden md:inline ml-2">• Enterprise Central Gateway</span>
          </div>
        </div>

        {/* Right side: strictly Admin Settings & Logout only */}
        <div className="flex items-center gap-2">
          {/* Main Admin Settings Button */}
          <button
            type="button"
            onClick={() => openAdminModal('users')}
            className="group relative px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-bold tracking-wide transition-all duration-300 cursor-pointer overflow-hidden border border-amber-400/50 bg-gradient-to-r from-amber-500/25 via-yellow-500/35 to-amber-500/25 hover:from-amber-500 hover:via-yellow-400 hover:to-amber-500 text-amber-200 hover:text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.25)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] transform hover:scale-105 active:scale-95 flex items-center gap-2"
            title="Open Admin Settings (Users, Logo Branding & Backup)"
          >
            <Crown size={14} className="text-amber-400 group-hover:text-slate-950 animate-pulse shrink-0" />
            <span className="font-sans font-extrabold">Admin Settings</span>
          </button>

          {/* Sign Out Button */}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-bold text-gray-300 hover:text-rose-200 bg-slate-900/90 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 transition-all flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95"
              title="Sign Out / Switch Account"
            >
              <LogOut size={13} className="text-rose-400" />
              <span>Logout</span>
            </button>
          )}

          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
              title="Close Switcher"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 2. CENTER CONGLOMERATE HEADER */}
      <div className="text-center mb-5 sm:mb-7 shrink-0">
        <div className="inline-flex items-center justify-center mb-2 transform hover:scale-105 transition-transform duration-300">
          {isUploadedLogo(parentGroup.logo) ? (
            <img 
              src={parentGroup.logo} 
              alt={parentGroup.name} 
              className="h-12 sm:h-16 w-auto max-w-[240px] object-contain drop-shadow-[0_6px_20px_rgba(245,158,11,0.35)]"
            />
          ) : (
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-amber-500/25 via-slate-900 to-amber-600/30 border border-amber-400/50 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Crown className="w-6 h-6 sm:w-7 sm:h-7 text-amber-400 animate-pulse" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 mb-1.5">
          <span className="h-px w-8 sm:w-16 bg-gradient-to-r from-transparent to-amber-400/80" />
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.25em] text-amber-400 font-sans">
            Enterprise Multi-Entity Workspace
          </span>
          <span className="h-px w-8 sm:w-16 bg-gradient-to-l from-transparent to-amber-400/80" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-wide font-serif mb-1 drop-shadow-md">
          {parentGroup.title || 'MAK GROUP OF COMPANIES'}
        </h1>

        <p className="text-xs sm:text-sm text-amber-300/90 font-medium tracking-wide max-w-xl mx-auto mb-1">
          DOCKS • TRUCKIT • MUHIB • VANTAGE
        </p>
        <p className="text-[11px] sm:text-xs text-gray-400 max-w-lg mx-auto">
          Select an enterprise subsidiary from the list below to launch its dedicated operations and workspaces.
        </p>
      </div>

      {/* 3. COMPANIES LIST FORMAT (Clean Vertical Stack with Uploaded Logos & Animated Buttons) */}
      <div className="space-y-3 sm:space-y-4 mb-6">
        {COMPANIES_LIST.map((comp) => {
          const isCurrentActive = comp.id === currentActiveId;
          const activeLogo = getCompanyCardLogo(comp);

          const getListStyles = () => {
            switch (comp.id) {
              case 'docks':
                return {
                  border: isCurrentActive ? 'border-amber-400 ring-2 ring-amber-400/40' : 'border-amber-500/30 hover:border-amber-400',
                  glow: 'hover:shadow-[0_0_30px_rgba(245,158,11,0.22)]',
                  bgGradient: 'from-amber-950/40 via-slate-900/95 to-slate-950/95',
                  badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
                  buttonGradient: 'from-amber-500 via-yellow-400 to-amber-600 hover:from-amber-400 hover:via-yellow-300 hover:to-amber-500 text-slate-950 shadow-amber-500/30',
                  iconBoxBg: 'bg-amber-500/10 border-amber-500/30',
                };
              case 'muhib':
                return {
                  border: isCurrentActive ? 'border-blue-400 ring-2 ring-blue-400/40' : 'border-blue-500/30 hover:border-blue-400',
                  glow: 'hover:shadow-[0_0_30px_rgba(37,99,235,0.25)]',
                  bgGradient: 'from-blue-950/40 via-slate-900/95 to-slate-950/95',
                  badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
                  buttonGradient: 'from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:via-indigo-500 hover:to-blue-600 text-white shadow-blue-600/30',
                  iconBoxBg: 'bg-blue-500/10 border-blue-500/30',
                };
              case 'vantage':
                return {
                  border: isCurrentActive ? 'border-cyan-400 ring-2 ring-cyan-400/40' : 'border-cyan-500/30 hover:border-cyan-400',
                  glow: 'hover:shadow-[0_0_30px_rgba(14,165,233,0.25)]',
                  bgGradient: 'from-cyan-950/40 via-slate-900/95 to-slate-950/95',
                  badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
                  buttonGradient: 'from-cyan-500 via-sky-400 to-cyan-600 hover:from-cyan-400 hover:via-sky-300 hover:to-cyan-500 text-slate-950 shadow-cyan-500/30',
                  iconBoxBg: 'bg-cyan-500/10 border-cyan-500/30',
                };
              case 'truckit':
                return {
                  border: isCurrentActive ? 'border-rose-400 ring-2 ring-rose-400/40' : 'border-rose-500/30 hover:border-rose-400',
                  glow: 'hover:shadow-[0_0_30px_rgba(244,63,94,0.25)]',
                  bgGradient: 'from-rose-950/40 via-slate-900/95 to-slate-950/95',
                  badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
                  buttonGradient: 'from-rose-600 via-red-600 to-rose-700 hover:from-rose-500 hover:via-red-500 hover:to-rose-600 text-white shadow-rose-600/30',
                  iconBoxBg: 'bg-rose-500/10 border-rose-500/30',
                };
            }
          };

          const styles = getListStyles();

          return (
            <div
              key={comp.id}
              onClick={() => onSelectCompany(comp.id)}
              className={`group relative rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 cursor-pointer transition-all duration-300 backdrop-blur-xl bg-gradient-to-r ${styles.bgGradient} border ${styles.border} ${styles.glow} transform hover:-translate-y-0.5 active:scale-[0.99]`}
            >
              {/* Left / Center Info Box */}
              <div className="flex items-center gap-3.5 sm:gap-5 flex-1 min-w-0">
                {/* Uploaded Logo or Custom Monogram */}
                <div className={`h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-2xl flex items-center justify-center p-2.5 bg-black/50 border ${styles.iconBoxBg} shadow-inner group-hover:scale-105 transition-transform duration-300 overflow-hidden`}>
                  {activeLogo ? (
                    <img 
                      src={activeLogo} 
                      alt={comp.name} 
                      className="max-h-full max-w-full object-contain filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]" 
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1 text-center">
                      {getCompanyIcon(comp.id)}
                      <span className="text-[10px] font-mono font-bold text-gray-300 tracking-wider">
                        {comp.shortName}
                      </span>
                    </div>
                  )}
                </div>

                {/* Company Texts */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${styles.badgeBg} flex items-center gap-1.5`}>
                      {getCompanyIcon(comp.id)}
                      <span>{comp.shortName}</span>
                    </span>

                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest font-mono">
                      ID: {comp.id.toUpperCase()}
                    </span>

                    {isCurrentActive && (
                      <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold shadow-md">
                        <CheckCircle2 size={11} className="text-emerald-400" />
                        <span>Active Workspace</span>
                      </span>
                    )}
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-amber-300 transition-colors truncate">
                    {comp.name}
                  </h3>

                  <p className="text-xs sm:text-sm text-gray-300 line-clamp-1 mt-0.5">
                    {comp.category}
                  </p>

                  <p className="text-[11px] text-gray-400 hidden sm:block mt-1 truncate">
                    {comp.tagline}
                  </p>
                </div>
              </div>

              {/* Right: Prominent Animated Enter Button */}
              <div className="w-full md:w-auto shrink-0 pt-2 md:pt-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCompany(comp.id);
                  }}
                  className={`group/btn w-full md:w-auto px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm uppercase tracking-wider shadow-lg flex items-center justify-center gap-2.5 transition-all duration-300 cursor-pointer bg-gradient-to-r ${styles.buttonGradient} transform group-hover:scale-105 active:scale-95`}
                >
                  <span>Launch Workspace</span>
                  <ArrowRight size={15} className="group-hover/btn:translate-x-1.5 transition-transform duration-300" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. FOOTER NOTE */}
      <div className="text-center pt-2 pb-6 text-xs text-gray-500 font-sans shrink-0">
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
      <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
        <div className="relative w-full max-w-5xl bg-slate-950/95 border border-white/10 rounded-3xl shadow-2xl my-6 flex flex-col overflow-visible">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#030712] text-gray-100 flex flex-col overflow-y-auto relative touch-pan-y">
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

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Building2, 
  CheckCircle2, 
  Sparkles, 
  X, 
  Ship, 
  Truck, 
  Globe, 
  Anchor,
  Crown,
  LogOut,
  ArrowRight,
  Lock,
  ShieldCheck
} from 'lucide-react';
import { 
  CompanyId, 
  CompanyInfo, 
  COMPANIES_LIST, 
  useActiveCompany,
  useParentGroup,
  isUploadedLogo,
  getCompanyUploadedLogo
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
  allowedCompanies?: string[];
  isGlobalAdmin?: boolean;
}

export const CompanyWorkspaceSelector: React.FC<CompanyWorkspaceSelectorProps> = ({
  onSelectCompany,
  isModal = false,
  onClose,
  userName,
  userRoleTitle,
  onSignOut,
  allowedCompanies,
  isGlobalAdmin
}) => {
  const { companyId: currentActiveId } = useActiveCompany();
  const { parentGroup } = useParentGroup();
  const [isAdminManagementOpen, setIsAdminManagementOpen] = useState(false);
  const [adminInitialTab, setAdminInitialTab] = useState<AdminSettingsTab>('users');
  const [, setBrandingVersion] = useState(0);

  const userAllowed = useMemo<string[]>(() => {
    if (allowedCompanies && allowedCompanies.length > 0) return allowedCompanies;
    try {
      const stored = safeAppStorage.getItem('dpl_allowed_companies');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return ['docks', 'muhib', 'vantage', 'truckit'];
  }, [allowedCompanies]);

  const effectiveIsGlobalAdmin = useMemo<boolean>(() => {
    if (typeof isGlobalAdmin === 'boolean') return isGlobalAdmin;
    return safeAppStorage.getItem('dpl_is_global_admin') === 'true';
  }, [isGlobalAdmin]);

  useEffect(() => {
    const handleBrandingChange = () => setBrandingVersion(v => v + 1);
    window.addEventListener('dpl_branding_changed', handleBrandingChange);
    return () => window.removeEventListener('dpl_branding_changed', handleBrandingChange);
  }, []);

  const openAdminModal = (tab: AdminSettingsTab = 'users') => {
    setAdminInitialTab(tab);
    setIsAdminManagementOpen(true);
  };

  const getCompanyIcon = (id: CompanyId) => {
    switch (id) {
      case 'docks':
        return <Anchor className="w-8 h-8 text-slate-200" />;
      case 'muhib':
        return <Globe className="w-8 h-8 text-slate-200" />;
      case 'vantage':
        return <Ship className="w-8 h-8 text-slate-200" />;
      case 'truckit':
        return <Truck className="w-8 h-8 text-slate-200" />;
    }
  };

  const getCompanyCardStyles = (id: CompanyId, isCurrentActive: boolean) => {
    return {
      cardBorder: isCurrentActive 
        ? 'border-slate-200 ring-2 ring-slate-300/50 shadow-[0_0_30px_rgba(255,255,255,0.08)] bg-slate-800/95' 
        : 'border-white/10 hover:border-slate-300/50 hover:shadow-[0_0_25px_rgba(255,255,255,0.05)] bg-[#151922]',
      bgGradient: 'from-slate-900/95 via-[#161A24] to-[#10141D]',
      accentText: isCurrentActive ? 'text-white' : 'text-slate-200',
      badgeBg: 'bg-white/10 text-slate-200 border-white/20',
      glowPulse: 'group-hover:border-slate-300',
    };
  };

  const content = (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col justify-start">
      {/* 1. TOP EXECUTIVE ACTION BAR (Clean Business-Class: Settings & Logout) */}
      <div className="flex items-center justify-end gap-3 pb-3 mb-4 sm:mb-6 border-b border-white/10 shrink-0">
        {/* Right side: strictly Admin Settings & Logout only */}
        <div className="flex items-center gap-2">
          {/* Main Admin Settings Button - Visible ONLY to Main Group Admin */}
          {effectiveIsGlobalAdmin ? (
            <button
              type="button"
              onClick={() => openAdminModal('users')}
              className="group relative px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-bold tracking-wide transition-all duration-300 cursor-pointer overflow-hidden border border-white/20 bg-slate-800/90 hover:bg-slate-700/90 text-slate-100 shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95 flex items-center gap-2"
              title="Open Group Admin Settings (Users, Logo Branding & Backup)"
            >
              <Crown size={14} className="text-slate-300 group-hover:text-white shrink-0" />
              <span className="font-sans font-semibold">Group Admin Settings</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[11px] text-gray-300">
              <ShieldCheck size={13} className="text-emerald-400" />
              <span>Assigned Scope: {userAllowed.length} Company</span>
            </div>
          )}

          {/* Sign Out Button */}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white bg-slate-900/90 hover:bg-slate-800 border border-white/10 hover:border-white/20 transition-all flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95"
              title="Sign Out / Switch Account"
            >
              <LogOut size={13} className="text-slate-400" />
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
      <div className="text-center mb-6 sm:mb-8 shrink-0">
        <div className="inline-flex items-center justify-center mb-2 transform hover:scale-105 transition-transform duration-300">
          {isUploadedLogo(parentGroup.logo) ? (
            <img 
              src={parentGroup.logo} 
              alt={parentGroup.name} 
              className="h-12 sm:h-16 w-auto max-w-[240px] object-contain drop-shadow-[0_6px_20px_rgba(0,0,0,0.7)]"
            />
          ) : (
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-slate-800 border border-white/15 flex items-center justify-center shadow-lg">
              <Crown className="w-6 h-6 sm:w-7 sm:h-7 text-slate-200" />
            </div>
          )}
        </div>

        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-wide font-sans mb-1 drop-shadow-md">
          {parentGroup.title || 'MAK GROUP OF COMPANIES'}
        </h1>
        <p className="text-[11px] sm:text-xs text-slate-400 font-mono tracking-widest uppercase">
          Select Company Workspace
        </p>
      </div>

      {/* 3. FOUR COMPANIES IN 2x2 SQUARE-SHAPED ANIMATED BUTTONS (Only Name & Uploaded Logo) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6">
        {COMPANIES_LIST.map((comp) => {
          const isCurrentActive = comp.id === currentActiveId;
          const isAllowed = effectiveIsGlobalAdmin || userAllowed.includes(comp.id);
          const uploadedLogo = getCompanyUploadedLogo(comp.id);
          const styles = getCompanyCardStyles(comp.id, isCurrentActive);

          if (!isAllowed) {
            return (
              <div
                key={comp.id}
                className="relative rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center text-center opacity-45 bg-slate-950/60 border border-white/5 shadow-inner min-h-[190px] sm:min-h-[220px] select-none"
              >
                <div className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-[10px] font-bold">
                  <Lock size={11} className="text-red-400" />
                  <span>Restricted</span>
                </div>

                <div className="h-20 sm:h-24 w-full flex items-center justify-center p-2 mb-3 grayscale opacity-60">
                  <div className="w-14 h-14 rounded-2xl bg-black/40 border border-white/5 flex items-center justify-center">
                    <Lock className="w-6 h-6 text-gray-500" />
                  </div>
                </div>

                <h3 className="text-base sm:text-lg font-bold text-gray-400 tracking-wide max-w-xs leading-tight">
                  {comp.name}
                </h3>
                <p className="text-[11px] text-gray-500 mt-2 font-mono">
                  Not authorized for this user account
                </p>
              </div>
            );
          }

          return (
            <button
              key={comp.id}
              type="button"
              onClick={() => onSelectCompany(comp.id)}
              className={`group relative rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 backdrop-blur-xl bg-gradient-to-b ${styles.bgGradient} border ${styles.cardBorder} transform hover:-translate-y-1 hover:scale-[1.02] active:scale-[0.98] shadow-xl overflow-hidden min-h-[190px] sm:min-h-[220px]`}
            >
              {/* Animated Background Shimmer Effect on Hover */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out pointer-events-none" />

              {/* Active Badge */}
              {isCurrentActive && (
                <div className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold shadow-md">
                  <CheckCircle2 size={11} className="text-emerald-400" />
                  <span>Active</span>
                </div>
              )}

              {/* Company Logo Display (Strictly uploaded logo from company settings) */}
              <div className="h-20 sm:h-24 w-full flex items-center justify-center p-2 mb-3 transform group-hover:scale-105 transition-transform duration-300">
                {uploadedLogo ? (
                  <img 
                    src={uploadedLogo} 
                    alt={comp.name} 
                    className="max-h-full max-w-[200px] sm:max-w-[240px] object-contain filter drop-shadow-[0_4px_16px_rgba(0,0,0,0.7)]" 
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-black/50 border border-white/10 flex items-center justify-center shadow-inner group-hover:border-white/20 transition-colors">
                      {getCompanyIcon(comp.id)}
                    </div>
                  </div>
                )}
              </div>

              {/* Only Company Name (Clean & Prominent) */}
              <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-slate-100 transition-colors tracking-wide max-w-xs leading-tight">
                {comp.name}
              </h3>

              {/* Subtle Animated Indicator */}
              <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-slate-400 group-hover:text-white transition-colors">
                <span>Enter Workspace</span>
                <ArrowRight size={13} className="transform group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          );
        })}
      </div>

      {/* 4. FOOTER NOTE */}
      <div className="text-center pt-2 pb-4 text-xs text-slate-500 font-sans shrink-0">
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
        <div className="relative w-full max-w-4xl bg-[#11141D] border border-white/10 rounded-3xl shadow-2xl my-6 flex flex-col overflow-visible">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#0B0E14] text-slate-100 flex flex-col overflow-y-auto relative touch-pan-y">
      {/* Background pearl charcoal ambience */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 15%, rgba(255, 255, 255, 0.05) 0%, transparent 60%),
            radial-gradient(circle at 50% 85%, rgba(30, 41, 59, 0.5) 0%, transparent 60%)
          `
        }}
      />
      {content}
    </div>
  );
};

export default CompanyWorkspaceSelector;


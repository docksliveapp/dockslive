import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  ShieldCheck,
  ChevronDown,
  LayoutGrid,
  Check,
  FolderKanban,
  DollarSign,
  Briefcase,
  FileText,
  Users
} from 'lucide-react';
import { 
  CompanyId, 
  CompanyInfo, 
  COMPANIES_LIST, 
  useActiveCompany,
  useParentGroup,
  isUploadedLogo,
  getCompanyUploadedLogo,
  getCompanyLogoUrl
} from '../services/companyService';
import { UserRole } from '../types';
import { safeAppStorage } from '../services/storage';
import { GroupAdminManagementModal, AdminSettingsTab } from './GroupAdminManagementModal';
import { ThemeToggleSwitch, useAppTheme } from './ThemeToggleSwitch';

export interface PortalOption {
  id: string;
  name: string;
  role: UserRole;
  targetView: string;
  badge: string;
  description: string;
  isDedicated?: boolean;
}

export const PORTAL_OPTIONS: PortalOption[] = [
  {
    id: 'admin',
    name: 'Admin Portal',
    role: UserRole.ADMIN,
    targetView: 'dashboard',
    badge: 'ADMIN',
    description: 'Executive Control, Real-Time Analytics & System Controls'
  },
  {
    id: 'operations_manager',
    name: 'Operations Manager Portal',
    role: UserRole.OPERATIONS_MANAGER,
    targetView: 'cases',
    badge: 'OPERATIONS',
    description: 'Cargo Clearing, Terminal Operations & Container Dispatch'
  },
  {
    id: 'case_manager',
    name: 'Case Manager Portal',
    role: UserRole.CASE_MANAGER,
    targetView: 'cases',
    badge: 'CASE MGR',
    description: 'Case Docket, Workflow Auditing & Document Reviews'
  },
  {
    id: 'finance_manager',
    name: 'Finance Manager Portal',
    role: UserRole.FINANCE_MANAGER,
    targetView: 'finance',
    badge: 'FINANCE',
    description: 'Treasury, Customer Ledger, Billing & Port Accounts'
  },
  {
    id: 'vehicle_manager',
    name: 'Fleet & Vehicle Portal',
    role: UserRole.VEHICLE_MANAGER,
    targetView: 'vehicles',
    badge: 'FLEET',
    description: 'Carrier Fleet, Drivers & Vehicle Tracking'
  },
  {
    id: 'loading_port_staff',
    name: 'Loading Port Staff Portal',
    role: UserRole.LOADING_PORT_STAFF,
    targetView: 'loading_port_portal',
    badge: 'LOADING PORT',
    description: 'Port Customs Inspection, Gate In & Terminal Staff',
    isDedicated: true
  },
  {
    id: 'destination_port_staff',
    name: 'Destination Port Staff Portal',
    role: UserRole.DESTINATION_PORT_STAFF,
    targetView: 'destination_port_portal',
    badge: 'DESTINATION PORT',
    description: 'Border Terminal, Unloading & Delivery Port',
    isDedicated: true
  },
  {
    id: 'office_staff',
    name: 'Office Staff Portal',
    role: UserRole.OFFICE_STAFF,
    targetView: 'cases',
    badge: 'OFFICE STAFF',
    description: 'General Case Registration & Documentation'
  },
  {
    id: 'client',
    name: 'Client Portal',
    role: UserRole.CLIENT,
    targetView: 'client_portal',
    badge: 'CLIENT',
    description: 'Corporate Importer Tracking & Shipment Dossiers',
    isDedicated: true
  },
  {
    id: 'transporter',
    name: 'Transporter Portal',
    role: UserRole.TRANSPORTER,
    targetView: 'transporter_portal',
    badge: 'TRANSPORTER',
    description: 'Carrier Vehicles, Builty & Goods Transport',
    isDedicated: true
  },
  {
    id: 'vendor',
    name: 'Vendor Portal',
    role: UserRole.VENDOR,
    targetView: 'vendor_portal',
    badge: 'VENDOR',
    description: 'Logistics Suppliers, Invoices & Service Desk',
    isDedicated: true
  }
];

interface CompanyWorkspaceSelectorProps {
  onSelectCompany: (companyId: CompanyId, targetRole?: UserRole, targetView?: string) => void;
  isModal?: boolean;
  onClose?: () => void;
  userName?: string;
  userRoleTitle?: string;
  onSignOut?: () => void;
  allowedCompanies?: string[];
  isGlobalAdmin?: boolean;
  currentRole?: UserRole;
  onSwitchPortal?: (role: UserRole, targetView: string) => void;
  onOpenGroupAdminPortal?: () => void;
}

export const CompanyWorkspaceSelector: React.FC<CompanyWorkspaceSelectorProps> = ({
  onSelectCompany,
  isModal = false,
  onClose,
  userName,
  userRoleTitle,
  onSignOut,
  allowedCompanies,
  isGlobalAdmin,
  currentRole,
  onSwitchPortal,
  onOpenGroupAdminPortal
}) => {
  const { companyId: currentActiveId } = useActiveCompany();
  const { parentGroup } = useParentGroup();
  const [isAdminManagementOpen, setIsAdminManagementOpen] = useState(false);
  const [adminInitialTab, setAdminInitialTab] = useState<AdminSettingsTab>('users');
  const [, setBrandingVersion] = useState(0);

  // Portal Dropdown Selection State
  const [selectedPortalId, setSelectedPortalId] = useState<string>(() => {
    if (currentRole === UserRole.OPERATIONS_MANAGER) return 'operations_manager';
    if (currentRole === UserRole.CASE_MANAGER) return 'case_manager';
    if (currentRole === UserRole.FINANCE_MANAGER) return 'finance_manager';
    if (currentRole === UserRole.VEHICLE_MANAGER) return 'vehicle_manager';
    if (currentRole === UserRole.LOADING_PORT_STAFF) return 'loading_port_staff';
    if (currentRole === UserRole.DESTINATION_PORT_STAFF) return 'destination_port_staff';
    if (currentRole === UserRole.CLIENT) return 'client';
    if (currentRole === UserRole.TRANSPORTER) return 'transporter';
    if (currentRole === UserRole.VENDOR) return 'vendor';
    return 'admin';
  });
  const [isPortalDropdownOpen, setIsPortalDropdownOpen] = useState(false);
  const portalDropdownRef = useRef<HTMLDivElement>(null);

  const activePortal = useMemo<PortalOption>(() => {
    return PORTAL_OPTIONS.find(p => p.id === selectedPortalId) || PORTAL_OPTIONS[0];
  }, [selectedPortalId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (portalDropdownRef.current && !portalDropdownRef.current.contains(event.target as Node)) {
        setIsPortalDropdownOpen(false);
      }
    };
    if (isPortalDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPortalDropdownOpen]);

  const userAllowed = useMemo<string[]>(() => {
    if (allowedCompanies && allowedCompanies.length > 0) return allowedCompanies;
    try {
      const stored = safeAppStorage.getItem('dpl_allowed_companies');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return ['docks'];
  }, [allowedCompanies]);

  const effectiveIsGlobalAdmin = useMemo<boolean>(() => {
    if (typeof isGlobalAdmin === 'boolean') return isGlobalAdmin;
    return safeAppStorage.getItem('dpl_is_global_admin') === 'true';
  }, [isGlobalAdmin]);

  const isCompanyAdmin = useMemo<boolean>(() => {
    if (effectiveIsGlobalAdmin) return true;
    if (currentRole === UserRole.ADMIN) return true;
    try {
      const storedRoles = safeAppStorage.getItem('dpl_user_roles');
      if (storedRoles) {
        const parsed = JSON.parse(storedRoles);
        if (Array.isArray(parsed) && parsed.includes(UserRole.ADMIN)) return true;
      }
    } catch (_) {}
    return false;
  }, [effectiveIsGlobalAdmin, currentRole]);

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

  const getPortalIcon = (portalId: string) => {
    switch (portalId) {
      case 'admin':
        return Crown;
      case 'operations_manager':
        return Briefcase;
      case 'case_manager':
        return FolderKanban;
      case 'finance_manager':
        return DollarSign;
      case 'vehicle_manager':
        return Truck;
      case 'loading_port_staff':
        return Anchor;
      case 'destination_port_staff':
        return Ship;
      case 'office_staff':
        return Users;
      case 'client':
        return Globe;
      case 'transporter':
        return Truck;
      case 'vendor':
        return FileText;
      default:
        return LayoutGrid;
    }
  };

  const [appTheme] = useAppTheme();
  const isPearl = appTheme === 'pearl';

  const getCompanyCardStyles = (id: CompanyId, isCurrentActive: boolean) => {
    if (isPearl) {
      return {
        cardBorder: isCurrentActive 
          ? 'border-slate-900 ring-2 ring-slate-900/20 shadow-[0_14px_35px_rgba(15,23,42,0.12)] bg-white' 
          : 'border-slate-200 hover:border-slate-400 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)] bg-white',
        bgGradient: 'from-white via-[#F8FAFC] to-[#F1F5F9]',
        accentText: 'text-slate-900',
        badgeBg: 'bg-slate-100 text-slate-800 border-slate-300',
        glowPulse: 'group-hover:border-slate-400',
      };
    }
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

  const handleSelectPortalOption = (portal: PortalOption) => {
    setSelectedPortalId(portal.id);
    setIsPortalDropdownOpen(false);
  };

  const handleLaunchPortalDirectly = (portal: PortalOption) => {
    setSelectedPortalId(portal.id);
    setIsPortalDropdownOpen(false);
    if (onSwitchPortal) {
      onSwitchPortal(portal.role, portal.targetView);
    }
  };

  const content = (
    <div className="w-full max-w-4xl mx-auto px-2 sm:px-6 py-3 sm:py-5 flex flex-col justify-start min-w-0">
      {/* 1. SINGLE-LINE EXECUTIVE ACTION BAR */}
      <div className={`flex flex-nowrap items-center justify-between gap-1 sm:gap-2 pb-2.5 mb-4 sm:mb-5 border-b shrink-0 w-full min-w-0 ${
        isPearl ? 'border-slate-200' : 'border-white/10'
      }`}>
        
        {/* Left Side: Change Portal Dropdown Menu (Strictly for Admins: Main Admin or Company Admin) */}
        {isCompanyAdmin ? (
          <div className="relative shrink-0 min-w-0" ref={portalDropdownRef}>
            <button
              type="button"
              id="btn-change-portal-dropdown"
              onClick={() => setIsPortalDropdownOpen(!isPortalDropdownOpen)}
              className={`group h-7 sm:h-8 px-1.5 sm:px-2.5 rounded-lg text-[9.5px] sm:text-[11px] font-semibold tracking-tight sm:tracking-wide transition-all duration-200 border shadow-xs flex items-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap ${
                isPearl
                  ? 'bg-white hover:bg-slate-100 text-slate-900 border-slate-300'
                  : 'border-white/15 bg-slate-800/95 hover:bg-slate-700 text-white'
              }`}
              title="Change Portal (Admin, Operations, Case Manager, Finance, Port Staff, Client, etc.)"
            >
              <LayoutGrid className={`w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0 ${isPearl ? "text-slate-600" : "text-slate-300"}`} />
              <span className={`${isPearl ? 'text-slate-500' : 'text-slate-400'} font-normal hidden md:inline`}>Change Portal:</span>
              <span className={`${isPearl ? 'text-slate-900' : 'text-white'} font-bold truncate max-w-[74px] xs:max-w-[95px] sm:max-w-[180px]`}>{activePortal.name}</span>
              <ChevronDown className={`w-2.5 h-2.5 sm:w-3 sm:h-3 transition-transform shrink-0 ${isPortalDropdownOpen ? 'rotate-180' : ''} ${isPearl ? 'text-slate-600' : 'text-slate-400'}`} />
            </button>

            {/* Dropdown Menu Popover */}
            {isPortalDropdownOpen && (
              <div className={`absolute left-0 top-full mt-1.5 w-[calc(100vw-2rem)] max-w-[320px] sm:w-88 sm:max-w-none rounded-2xl border shadow-2xl p-2 z-50 backdrop-blur-2xl animate-fade-in max-h-[70vh] overflow-y-auto custom-scrollbar ${
                isPearl ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-white/20 text-white'
              }`}>
                <div className={`p-2 border-b mb-1 flex items-center justify-between ${isPearl ? 'border-slate-200' : 'border-white/10'}`}>
                  <div className="min-w-0 pr-2">
                    <p className={`text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                      <LayoutGrid size={12} className={isPearl ? "text-slate-600 shrink-0" : "text-slate-300 shrink-0"} />
                      <span className="truncate">Select Portal Workspace</span>
                    </p>
                    <p className={`text-[10px] mt-0.5 leading-tight ${isPearl ? 'text-slate-500' : 'text-slate-400'}`}>
                      {effectiveIsGlobalAdmin 
                        ? 'Main Admin: Switch into any portal across any company' 
                        : 'Company Admin: Switch into any portal in your company'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPortalDropdownOpen(false)}
                    className={`p-1 rounded-lg transition-colors cursor-pointer shrink-0 ${
                      isPearl ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <X size={13} />
                  </button>
                </div>

                <div className="space-y-1">
                  {PORTAL_OPTIONS.map((p) => {
                    const isSelected = p.id === selectedPortalId;
                    const IconComp = getPortalIcon(p.id);
                    return (
                      <div
                        key={p.id}
                        className={`p-2 rounded-xl transition-all flex items-center justify-between gap-2 ${
                          isSelected 
                            ? isPearl
                              ? 'bg-slate-100 border border-slate-300 text-slate-900 shadow-xs'
                              : 'bg-white/12 border border-white/25 text-white shadow-xs' 
                            : isPearl
                              ? 'hover:bg-slate-50 border border-transparent text-slate-700 hover:text-slate-900'
                              : 'hover:bg-white/5 border border-transparent text-slate-300 hover:text-white'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectPortalOption(p)}
                          className="flex items-start gap-2 flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            isSelected
                              ? isPearl ? 'bg-slate-900 text-white' : 'bg-white/20 text-white'
                              : isPearl ? 'bg-slate-100 text-slate-600' : 'bg-white/5 text-slate-400'
                          }`}>
                            <IconComp size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-xs font-bold truncate ${isPearl ? 'text-slate-900' : 'text-white'}`}>{p.name}</span>
                              <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold shrink-0 ${
                                isPearl ? 'bg-slate-200 text-slate-700' : 'bg-white/10 text-slate-300'
                              }`}>
                                {p.badge}
                              </span>
                            </div>
                            <p className={`text-[10px] truncate mt-0.5 leading-snug ${isPearl ? 'text-slate-500' : 'text-slate-400'}`}>
                              {p.description}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {isSelected && (
                            <Check size={13} className={`${isPearl ? 'text-slate-900' : 'text-white'} shrink-0 mr-1`} />
                          )}
                          {onSwitchPortal && (
                            <button
                              type="button"
                              onClick={() => handleLaunchPortalDirectly(p)}
                              className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer border ${
                                isPearl
                                  ? 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'
                                  : 'bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white border-white/10'
                              }`}
                              title="Directly launch this portal immediately"
                            >
                              Open
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={`flex items-center gap-1 sm:gap-1.5 h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg border text-[10px] sm:text-[11px] truncate max-w-[130px] sm:max-w-[180px] shrink-0 ${
            isPearl ? 'bg-white border-slate-200 text-slate-700' : 'bg-white/5 border-white/10 text-slate-300'
          }`}>
            <ShieldCheck className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-500 shrink-0" />
            <span className="truncate">{activePortal.name}</span>
          </div>
        )}

        {/* Right side: Main Admin Panel, Logout & Theme Switch strictly on the same single line */}
        <div className="flex flex-nowrap items-center justify-end gap-1 sm:gap-2 ml-auto shrink-0">
          {/* Main Admin Panel Button - Visible ONLY to Main Group Admin */}
          {effectiveIsGlobalAdmin && (
            <button
              type="button"
              onClick={() => {
                if (onOpenGroupAdminPortal) {
                  onOpenGroupAdminPortal();
                } else {
                  openAdminModal('users');
                }
              }}
              className={`h-7 sm:h-8 px-1.5 sm:px-2.5 rounded-lg text-[9.5px] sm:text-[11px] font-bold tracking-tight sm:tracking-wide transition-all duration-200 cursor-pointer border shadow-xs flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0 ${
                isPearl
                  ? 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'
                  : 'border-white/20 bg-slate-800/90 hover:bg-slate-700 text-white'
              }`}
              title="Open Main Admin Panel"
            >
              <Crown className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white shrink-0" />
              <span>Main Admin Panel</span>
            </button>
          )}

          {/* Sign Out Button */}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className={`h-7 sm:h-8 px-1.5 sm:px-2.5 rounded-lg text-[9.5px] sm:text-[11px] font-semibold border transition-all flex items-center gap-1 cursor-pointer shadow-xs whitespace-nowrap shrink-0 ${
                isPearl
                  ? 'bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-300'
                  : 'text-gray-300 hover:text-white bg-slate-900/90 hover:bg-slate-800 border-white/12 hover:border-white/25'
              }`}
              title="Sign Out / Switch Account"
            >
              <LogOut className={`w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0 ${isPearl ? "text-slate-500" : "text-slate-400"}`} />
              <span>Logout</span>
            </button>
          )}

          {/* Unified Theme Switcher (Left = Charcoal Dark, Right = Pearl White) */}
          <ThemeToggleSwitch />

          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`h-7 w-7 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg transition-colors border cursor-pointer shrink-0 ${
                isPearl
                  ? 'text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border-slate-300'
                  : 'text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border-white/10'
              }`}
              title="Close Switcher"
            >
              <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. CENTER CONGLOMERATE HEADER */}
      <div className="text-center mb-4 sm:mb-6 shrink-0 px-2">
        <div className="inline-flex items-center justify-center min-h-[2rem] mb-2 transform hover:scale-105 transition-transform duration-300">
          {parentGroup?.logo && isUploadedLogo(parentGroup.logo) ? (
            <img 
              src={parentGroup.logo} 
              alt={parentGroup.name} 
              className="h-20 sm:h-28 w-auto max-w-[240px] sm:max-w-[400px] object-contain drop-shadow-[0_8px_25px_rgba(0,0,0,0.22)]" 
            />
          ) : null}
        </div>

        <h1 className={`text-lg sm:text-2xl font-bold tracking-wide font-sans mb-1 break-words ${
          isPearl ? 'text-slate-900' : 'text-white drop-shadow-md'
        }`}>
          {parentGroup.title || 'MAK GROUP OF COMPANIES'}
        </h1>
        <p className={`text-[10px] sm:text-xs font-mono tracking-widest uppercase ${
          isPearl ? 'text-slate-500' : 'text-slate-400'
        }`}>
          Select Company Workspace
        </p>
      </div>

      {/* 3. FOUR COMPANIES IN 2x2 SQUARE-SHAPED ANIMATED BUTTONS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-6 mb-5 w-full min-w-0">
        {COMPANIES_LIST.map((comp) => {
          const isCurrentActive = comp.id === currentActiveId;
          const isAllowed = effectiveIsGlobalAdmin || userAllowed.includes(comp.id);
          const styles = getCompanyCardStyles(comp.id, isCurrentActive);

          if (!isAllowed) {
            return (
              <div
                key={comp.id}
                className={`relative rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center text-center opacity-50 border shadow-inner min-h-[175px] sm:min-h-[220px] select-none w-full min-w-0 overflow-hidden ${
                  isPearl ? 'bg-slate-100 border-slate-200' : 'bg-slate-950/60 border-white/5'
                }`}
              >
                <div className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-500 text-[10px] font-bold">
                  <Lock size={11} />
                  <span>Restricted</span>
                </div>

                <div className="h-20 sm:h-24 w-full flex items-center justify-center p-2 mb-3 grayscale opacity-60">
                  <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center ${
                    isPearl ? 'bg-slate-200 border-slate-300' : 'bg-black/40 border-white/5'
                  }`}>
                    <Lock className="w-6 h-6 text-gray-500" />
                  </div>
                </div>

                <h3 className={`text-sm sm:text-lg font-bold tracking-wide max-w-full leading-tight px-2 break-words ${
                  isPearl ? 'text-slate-500' : 'text-gray-400'
                }`}>
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
              onClick={() => onSelectCompany(comp.id, activePortal.role, activePortal.targetView)}
              className={`group relative rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 backdrop-blur-xl bg-gradient-to-b ${styles.bgGradient} border ${styles.cardBorder} transform hover:-translate-y-1 hover:scale-[1.01] active:scale-[0.98] shadow-xl overflow-hidden min-h-[175px] sm:min-h-[220px] w-full min-w-0`}
            >
              {/* Animated Background Shimmer Effect on Hover */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out pointer-events-none" />

              {/* Active Badge */}
              {isCurrentActive && (
                <div className={`absolute top-3 right-3 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm border ${
                  isPearl
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                }`}>
                  <CheckCircle2 size={11} className="text-emerald-500" />
                  <span>Active</span>
                </div>
              )}

              {/* Company Logo Display (Uploaded Logo Only; empty space if none uploaded) */}
              <div className="h-24 sm:h-36 w-full flex items-center justify-center p-2 mb-2 sm:mb-3 transform group-hover:scale-105 transition-transform duration-300">
                {getCompanyLogoUrl(comp.id) ? (
                  <img 
                    src={getCompanyLogoUrl(comp.id)} 
                    alt={comp.name} 
                    className="max-h-full w-auto max-w-[200px] sm:max-w-[300px] object-contain filter drop-shadow-[0_6px_16px_rgba(0,0,0,0.25)]" 
                  />
                ) : null}
              </div>

              {/* Only Company Name (Clean & Prominent) */}
              <h3 className={`text-sm sm:text-lg font-bold transition-colors tracking-wide max-w-full leading-tight px-2 break-words ${
                isPearl ? 'text-slate-900 group-hover:text-slate-700' : 'text-white group-hover:text-slate-100'
              }`}>
                {comp.name}
              </h3>

              {/* Subtle Animated Indicator displaying target portal */}
              <div className={`mt-2.5 flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors max-w-full px-2 ${
                isPearl ? 'text-slate-600 group-hover:text-slate-900' : 'text-slate-400 group-hover:text-white'
              }`}>
                <span className="truncate">Enter Workspace • {activePortal.name}</span>
                <ArrowRight size={13} className="transform group-hover:translate-x-1 transition-transform shrink-0" />
              </div>
            </button>
          );
        })}
      </div>

      {/* 4. FOOTER NOTE */}
      <div className="text-center pt-2 pb-4 px-2 text-[11px] sm:text-xs text-slate-500 font-sans shrink-0">
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
      <div className="fixed inset-0 z-50 flex items-start justify-center p-2.5 sm:p-4 bg-black/75 backdrop-blur-md overflow-y-auto overflow-x-hidden">
        <div className={`relative w-full max-w-4xl border rounded-2xl sm:rounded-3xl shadow-2xl my-2 sm:my-6 flex flex-col overflow-hidden transition-colors duration-300 ${
          isPearl ? 'bg-[#F8FAFC] border-slate-200 text-slate-900' : 'bg-[#11141D] border-white/10 text-slate-100'
        }`}>
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen w-full flex flex-col overflow-y-auto overflow-x-hidden relative touch-pan-y transition-colors duration-300 ${
      isPearl
        ? 'bg-gradient-to-b from-[#FFFFFF] via-[#F8FAFC] to-[#F1F5F9] text-slate-900'
        : 'bg-[#0B0E14] text-slate-100'
    }`}>
      {/* Background pearl charcoal ambience */}
      {!isPearl && (
        <div 
          className="absolute inset-0 pointer-events-none opacity-25"
          style={{
            backgroundImage: `
              radial-gradient(circle at 50% 15%, rgba(255, 255, 255, 0.05) 0%, transparent 60%),
              radial-gradient(circle at 50% 85%, rgba(30, 41, 59, 0.5) 0%, transparent 60%)
            `
          }}
        />
      )}
      {content}
    </div>
  );
};

export default CompanyWorkspaceSelector;

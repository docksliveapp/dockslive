import React, { useState, useRef, useEffect } from 'react';
import { 
  ShieldCheck, DollarSign, Globe, Briefcase, UserPlus, 
  ChevronDown, Check, Info, Lock, LogOut, KeyRound, X, ArrowRight, UserCheck, Truck
} from 'lucide-react';
import { UserRole } from '../types';

export type AppMode = 'admin' | 'finance' | 'client' | 'employee' | 'recruiter' | 'transporter';

export interface ModeOption {
  id: AppMode;
  name: string;
  role: UserRole;
  targetView: string;
  description: string;
  badge: string;
  icon: React.ElementType;
  accentColor: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
}

export const APP_MODES: ModeOption[] = [
  {
    id: 'admin',
    name: 'Admin Portal',
    role: UserRole.ADMIN,
    targetView: 'dashboard',
    description: 'System control, real-time analytics, cases, fleet and settings',
    badge: 'ADMIN',
    icon: ShieldCheck,
    accentColor: 'text-slate-200',
    activeBg: 'bg-slate-800/90',
    activeBorder: 'border-white/20',
    activeText: 'text-white'
  },
  {
    id: 'finance',
    name: 'Financier Portal',
    role: UserRole.FINANCE_MANAGER,
    targetView: 'finance',
    description: 'Customer ledger, billing, payment verification and accounts',
    badge: 'FINANCE',
    icon: DollarSign,
    accentColor: 'text-slate-200',
    activeBg: 'bg-slate-800/90',
    activeBorder: 'border-white/20',
    activeText: 'text-white'
  },
  {
    id: 'client',
    name: 'Client Portal',
    role: UserRole.CLIENT,
    targetView: 'cases',
    description: 'Shipment tracking, in-transit containers and invoices',
    badge: 'CLIENT',
    icon: Globe,
    accentColor: 'text-slate-200',
    activeBg: 'bg-slate-800/90',
    activeBorder: 'border-white/20',
    activeText: 'text-white'
  },
  {
    id: 'employee',
    name: 'Operations Portal',
    role: UserRole.OPERATIONS_MANAGER,
    targetView: 'cases',
    description: 'Cargo clearing, port logistics and container dispatch',
    badge: 'OPERATIONS',
    icon: Briefcase,
    accentColor: 'text-slate-200',
    activeBg: 'bg-slate-800/90',
    activeBorder: 'border-white/20',
    activeText: 'text-white'
  },
  {
    id: 'recruiter',
    name: 'Fleet & HR Portal',
    role: UserRole.VEHICLE_MANAGER,
    targetView: 'vehicles',
    description: 'Fleet carriers, driver validation and vehicle dispatch',
    badge: 'FLEET',
    icon: UserPlus,
    accentColor: 'text-slate-200',
    activeBg: 'bg-slate-800/90',
    activeBorder: 'border-white/20',
    activeText: 'text-white'
  },
  {
    id: 'transporter',
    name: 'Transporter Portal',
    role: UserRole.TRANSPORTER,
    targetView: 'vehicles',
    description: 'Carrier vehicles, driver dispatch and transport ledger',
    badge: 'TRANSPORTER',
    icon: Truck,
    accentColor: 'text-slate-200',
    activeBg: 'bg-slate-800/90',
    activeBorder: 'border-white/20',
    activeText: 'text-white'
  }
];

interface TopModeSwitcherProps {
  currentRole: UserRole;
  onSwitchMode: (mode: ModeOption) => void;
  onSignOut?: () => void;
  onOpenAuthModal?: () => void;
  className?: string;
  isCompact?: boolean;
}

export const TopModeSwitcher: React.FC<TopModeSwitcherProps> = ({
  currentRole,
  onSwitchMode,
  onSignOut,
  onOpenAuthModal,
  className = '',
  isCompact = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Determine current active mode
  const currentMode = APP_MODES.find(m => m.role === currentRole) || 
    (currentRole === UserRole.CLIENT ? APP_MODES[2] : 
     currentRole === UserRole.FINANCE_MANAGER ? APP_MODES[1] :
     currentRole === UserRole.OPERATIONS_MANAGER ? APP_MODES[3] :
     currentRole === UserRole.VEHICLE_MANAGER ? APP_MODES[4] :
     APP_MODES[0]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const CurrentIcon = currentMode.icon;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Switcher Main Trigger Button - Charcoal & Pearl White Business Class */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-xl border border-white/15 bg-slate-900/90 hover:bg-slate-800 text-slate-100 hover:text-white transition-all duration-200 shadow-md focus:outline-none cursor-pointer"
        title="Active Authenticated Session"
      >
        <div className="p-1 sm:p-1.5 rounded-lg bg-black/40 text-slate-200 shadow-inner flex-shrink-0">
          <CurrentIcon size={14} />
        </div>

        <div className="text-left">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider hidden md:inline flex items-center gap-1">
              <UserCheck size={10} className="text-slate-300" /> Active:
            </span>
            <span className="text-xs sm:text-sm font-bold text-white whitespace-nowrap">
              {currentMode.name}
            </span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-slate-400 font-mono hidden xs:block leading-none truncate max-w-[100px]">
            {currentRole}
          </span>
        </div>

        <ChevronDown 
          size={14} 
          className={`text-slate-400 ml-1 transition-transform duration-200 ${isOpen ? 'rotate-180 text-white' : ''}`} 
        />
      </button>

      {/* Dropdown Popup Menu - Charcoal & Pearl White */}
      {isOpen && (
        <div 
          className="absolute right-0 top-full mt-2 w-[300px] sm:w-[340px] bg-slate-900/98 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-3.5 border-b border-white/10 bg-slate-950/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-white/10 text-slate-200">
                <Lock size={15} />
              </div>
              <div>
                <span className="text-xs font-bold text-white uppercase tracking-wider block">
                  Authenticated Session
                </span>
                <span className="text-[10px] text-slate-300 font-medium flex items-center gap-1">
                  <Check size={11} className="text-emerald-400" /> Verified Credentials
                </span>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-white/10 cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>

          {/* Current Role Details */}
          <div className="p-3.5 bg-white/5 border-b border-white/5">
            <div className="text-xs font-bold text-slate-200 mb-1 flex items-center justify-between">
              <span>Role:</span>
              <span className="text-slate-100 font-mono text-[11px]">{currentRole}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              {currentMode.description}
            </p>
          </div>

          {/* Account Actions */}
          <div className="p-2.5 space-y-1.5 bg-slate-950/50">
            {onSignOut && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onSignOut();
                }}
                className="w-full p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer active:scale-95"
              >
                <KeyRound size={14} className="text-slate-400" />
                <span>Switch User / Log In with Another ID</span>
              </button>
            )}

            {onSignOut && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onSignOut();
                }}
                className="w-full p-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer active:scale-95"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TopModeSwitcher;

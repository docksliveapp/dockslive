import React, { useState, useEffect } from 'react';
import { 
  KeyRound,
  Eye,
  EyeOff,
  LogIn,
  Loader2,
  User,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import { UserRole } from '../types';
import { useParentGroup, isUploadedLogo } from '../services/companyService';
import { safeAppStorage } from '../services/storage';
import { authenticateDatabaseUser } from '../services/dbService';
import { NewRegistrationModal } from './NewRegistrationModal';
import { ThemeToggleSwitch, useAppTheme } from './ThemeToggleSwitch';

export interface SelectedModePayload {
  role: UserRole;
  roles?: UserRole[];
  designation?: string;
  clientName?: string;
  targetView: string;
  displayName: string;
  allowedCompanies?: string[];
  isGlobalAdmin?: boolean;
}

interface LoginModeSelectionProps {
  onSelectMode: (payload: SelectedModePayload) => void;
  onOpenPublicTracker?: () => void;
  onOpenVehicleTracker?: () => void;
}

export const LoginModeSelection: React.FC<LoginModeSelectionProps> = ({ 
  onSelectMode,
  onOpenPublicTracker,
  onOpenVehicleTracker
}) => {
  const { parentGroup } = useParentGroup();

  // Credentials Form State
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isRegistrationModalOpen, setIsRegistrationModalOpen] = useState(false);

  const [lastLocationView, setLastLocationView] = useState<string | null>(null);
  const [lastLocationRole, setLastLocationRole] = useState<string | null>(null);

  // Unified App Theme: 'charcoal' (Dark) vs 'pearl' (Pearl White)
  const [appTheme] = useAppTheme();
  const isPearl = appTheme === 'pearl';

  useEffect(() => {
    const lastView = safeAppStorage.getItem('dpl_last_location_view');
    const lastRole = safeAppStorage.getItem('dpl_last_location_role');
    if (lastView && lastView !== 'settings') setLastLocationView(lastView);
    if (lastRole) setLastLocationRole(lastRole);
  }, []);

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) {
      setErrorMessage('Please enter both User ID / Phone and Password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const user = await authenticateDatabaseUser(identifier.trim(), password.trim());
      
      const userRole = (user.role as UserRole) || UserRole.ADMIN;
      const userRoles = (user.roles && user.roles.length > 0) ? user.roles : [userRole];
      safeAppStorage.setItem('dpl_user_roles', JSON.stringify(userRoles));
      if (user.designation) {
        safeAppStorage.setItem('dpl_user_designation', user.designation);
      }
      safeAppStorage.setItem('dpl_current_user_id', user.userId || '');
      safeAppStorage.setItem('dpl_current_user_name', user.name || user.userId || 'Staff');
      if ((user as any).station) {
        safeAppStorage.setItem('dpl_current_user_station', (user as any).station);
      }
      if ((user as any).assignedVehicleNo) {
        safeAppStorage.setItem('dpl_driver_vehicle_no', (user as any).assignedVehicleNo);
      } else {
        safeAppStorage.removeItem('dpl_driver_vehicle_no');
      }

      const userAllowedCompanies: string[] = (user as any).allowedCompanies || (user.isGlobalAdmin ? ['docks', 'truckit', 'muhib', 'vantage'] : ['docks']);
      const isUserGlobalAdmin: boolean = Boolean(user.isGlobalAdmin);

      safeAppStorage.setItem('dpl_allowed_companies', JSON.stringify(userAllowedCompanies));
      safeAppStorage.setItem('dpl_is_global_admin', isUserGlobalAdmin ? 'true' : 'false');

      let targetView = 'dashboard';

      if (userRole === UserRole.DRIVER) {
        targetView = 'driver_location';
      } else if (userRole === UserRole.CLIENT) {
        targetView = 'cases';
      } else if (userRole === UserRole.VENDOR) {
        targetView = 'vendor_portal';
      } else if (userRoles.includes(UserRole.FINANCE_MANAGER)) {
        targetView = 'finance';
      } else if (userRoles.includes(UserRole.VEHICLE_MANAGER) || userRole === UserRole.TRANSPORTER) {
        targetView = 'vehicles';
      } else if (userRoles.includes(UserRole.OPERATIONS_MANAGER) || userRoles.includes(UserRole.OFFICE_STAFF)) {
        targetView = 'cases';
      } else if (lastLocationRole === userRole && lastLocationView) {
        targetView = lastLocationView;
      }

      onSelectMode({
        role: userRole,
        roles: userRoles,
        designation: user.designation,
        clientName: user.clientName || (userRole === UserRole.CLIENT ? user.name : userRole === UserRole.TRANSPORTER ? user.name : 'Client Portal'),
        targetView: targetView,
        displayName: user.name || user.userId || 'Staff User',
        allowedCompanies: userAllowedCompanies,
        isGlobalAdmin: isUserGlobalAdmin
      });
    } catch (err: any) {
      console.error('Login failure:', err);
      setErrorMessage(err?.message || 'Invalid User ID or Password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 overflow-y-auto p-3 sm:p-6 custom-scrollbar overscroll-contain transition-colors duration-300 ${
      isPearl 
        ? 'bg-gradient-to-b from-[#FFFFFF] via-[#F8FAFC] to-[#F1F5F9] text-slate-900' 
        : 'bg-[#0F1115] text-gray-100'
    }`}>
      {/* Single Animated Theme Toggle Switch (Top Right: Left = Charcoal Dark, Right = Pearl White) */}
      <div className="absolute top-3 sm:top-5 right-3 sm:right-6 z-30">
        <ThemeToggleSwitch />
      </div>

      {/* Background Ambience: Luxury Charcoal & Pure Pearl White Sheen */}
      <div 
        className="fixed inset-0 pointer-events-none transition-all duration-500"
        style={{
          backgroundImage: isPearl
            ? `
                radial-gradient(ellipse 90% 55% at 50% 8%, #FFFFFF 0%, rgba(255, 255, 255, 0.98) 40%, #F8FAFC 70%, #F1F5F9 100%)
              `
            : `
                radial-gradient(ellipse 90% 45% at 50% 0%, rgba(255, 255, 255, 0.04) 0%, transparent 60%),
                linear-gradient(180deg, #0F1115 0%, #14171D 50%, #0F1115 100%)
              `,
          opacity: 1
        }}
      />

      <div className="min-h-full w-full max-w-md mx-auto flex flex-col justify-center items-center py-6 sm:py-8 relative z-10">
        {/* Prominent MAK Corporate Logo placed closely above Sign In Card */}
        <div className="w-full flex flex-col items-center text-center mb-4 sm:mb-5">
          <div className="inline-flex items-center justify-center transform hover:scale-105 transition-transform duration-300">
            {parentGroup?.logo && isUploadedLogo(parentGroup.logo) ? (
              <img 
                src={parentGroup.logo} 
                alt={parentGroup.name || "MAK Group"} 
                className="w-44 sm:w-52 md:w-56 h-44 sm:h-52 md:h-56 max-h-44 sm:max-h-52 md:max-h-56 object-contain drop-shadow-[0_12px_36px_rgba(0,0,0,0.25)] select-none" 
              />
            ) : (
              <img 
                src={isPearl ? "/logos/mak_pearl_white_emblem.svg" : "/logos/mak_group_logo.svg"} 
                alt={parentGroup.name || "MAK Group"} 
                className="w-44 sm:w-52 md:w-56 h-44 sm:h-52 md:h-56 max-h-44 sm:max-h-52 md:max-h-56 object-contain drop-shadow-[0_12px_36px_rgba(0,0,0,0.18)] select-none" 
              />
            )}
          </div>
        </div>

        {/* Clean Single Enterprise Sign In Card positioned directly underneath logo */}
        <div className="w-full relative z-10 animate-fade-in">
          <div className={`rounded-3xl p-6 sm:p-7 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
            isPearl
              ? 'bg-white border border-slate-200/90 text-slate-900 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.10)] ring-1 ring-slate-100'
              : 'bg-[#161920]/95 border border-white/12 text-white shadow-[0_24px_60px_rgba(0,0,0,0.65)]'
          }`}>
          
            {/* Card Title */}
            <div className="text-center mb-5">
              <h2 className={`text-lg sm:text-xl font-bold tracking-tight ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                Enterprise Sign In
              </h2>
              <p className={`text-xs mt-1 ${isPearl ? 'text-slate-500' : 'text-zinc-400'}`}>
                Enter your credentials to access your company workspace
              </p>
            </div>

            {/* Success Notice */}
            {successMessage && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs flex items-start gap-2">
                <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                <span className="font-medium">{successMessage}</span>
              </div>
            )}

            {/* Error Notice */}
            {errorMessage && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-start gap-2">
                <span className="shrink-0 mt-0.5">⚠️</span>
                <span className="leading-relaxed font-medium">{errorMessage}</span>
              </div>
            )}

            {/* Sign In Form */}
            <form onSubmit={handleCredentialsLogin} className="space-y-4">
              <div>
                <label className={`block text-[11px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 ${
                  isPearl ? 'text-slate-700' : 'text-zinc-300'
                }`}>
                  <User size={13} className={isPearl ? 'text-slate-500' : 'text-zinc-400'} />
                  <span>User ID / Phone Number</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    id="login-identifier-input"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="e.g. admin, finance, or phone number"
                    className={`w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none transition ${
                      isPearl
                        ? 'bg-slate-50/80 border border-slate-300 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-slate-800 focus:ring-1 focus:ring-slate-800/15'
                        : 'bg-[#111318] border border-white/15 text-white placeholder-zinc-500 focus:border-white/40 focus:ring-1 focus:ring-white/15'
                    }`}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`block text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                    isPearl ? 'text-slate-700' : 'text-zinc-300'
                  }`}>
                    <KeyRound size={13} className={isPearl ? 'text-slate-500' : 'text-zinc-400'} />
                    <span>Password</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`text-[11px] flex items-center gap-1 cursor-pointer transition-colors ${
                      isPearl ? 'text-slate-600 hover:text-slate-900' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    <span>{showPassword ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="login-password-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className={`w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none transition ${
                      isPearl
                        ? 'bg-slate-50/80 border border-slate-300 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-slate-800 focus:ring-1 focus:ring-slate-800/15'
                        : 'bg-[#111318] border border-white/15 text-white placeholder-zinc-500 focus:border-white/40 focus:ring-1 focus:ring-white/15'
                    }`}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              {/* Submit Sign In Button */}
              <button
                type="submit"
                id="btn-submit-credentials"
                disabled={isLoading}
                className={`w-full mt-2 py-2.5 px-4 rounded-xl font-bold text-sm tracking-wide shadow-md flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 select-none ${
                  isPearl
                    ? 'btn-charcoal-primary text-white'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-white border border-white/15'
                }`}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-white shrink-0" />
                    <span className="font-bold text-white">Verifying Credentials...</span>
                  </>
                ) : (
                  <>
                    <LogIn size={16} className="text-white shrink-0" />
                    <span className="font-bold text-white text-sm tracking-wide">Sign In</span>
                  </>
                )}
              </button>

              {/* Clean Professional New Registration Action */}
              <div className={`pt-3 border-t flex justify-center ${isPearl ? 'border-slate-200' : 'border-white/10'}`}>
                <button
                  type="button"
                  onClick={() => setIsRegistrationModalOpen(true)}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold tracking-wide transition cursor-pointer flex items-center justify-center gap-2 ${
                    isPearl
                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                      : 'bg-white/5 hover:bg-white/10 text-zinc-200 hover:text-white border border-white/12'
                  }`}
                >
                  <span>New Registration</span>
                  <ArrowRight size={14} className={isPearl ? 'text-slate-600' : 'text-zinc-400'} />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* New Registration Modal (Client & Transporter) */}
      <NewRegistrationModal
        isOpen={isRegistrationModalOpen}
        onClose={() => setIsRegistrationModalOpen(false)}
      />
    </div>
  );
};

export default LoginModeSelection;


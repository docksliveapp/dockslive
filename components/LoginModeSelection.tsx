import React, { useState, useEffect } from 'react';
import { 
  KeyRound,
  Eye,
  EyeOff,
  LogIn,
  Loader2,
  User,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Lock
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

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30000; // 30 seconds brute-force protection cooldown

export const LoginModeSelection: React.FC<LoginModeSelectionProps> = ({ 
  onSelectMode
}) => {
  const { parentGroup } = useParentGroup();

  // Credentials Form State
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage] = useState<string | null>(null);
  const [isRegistrationModalOpen, setIsRegistrationModalOpen] = useState(false);

  // Brute-force / Rate-limit Security State
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState<number>(0);

  const [lastLocationView, setLastLocationView] = useState<string | null>(null);
  const [lastLocationRole, setLastLocationRole] = useState<string | null>(null);

  // Unified App Theme: 'charcoal' (Dark) vs 'pearl' (Pearl White Glassy)
  const [appTheme] = useAppTheme();
  const isPearl = appTheme === 'pearl';

  useEffect(() => {
    const lastView = safeAppStorage.getItem('dpl_last_location_view');
    const lastRole = safeAppStorage.getItem('dpl_last_location_role');
    if (lastView && lastView !== 'settings') setLastLocationView(lastView);
    if (lastRole) setLastLocationRole(lastRole);
  }, []);

  useEffect(() => {
    if (!lockoutUntil) {
      setLockoutSecondsLeft(0);
      return;
    }
    const tick = () => {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockoutUntil(null);
        setLockoutSecondsLeft(0);
        setFailedAttempts(0);
        setErrorMessage(null);
      } else {
        setLockoutSecondsLeft(remaining);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const sanitizeCredentialInput = (raw: string): string => {
    return raw.replace(/[<>]/g, '').trim();
  };

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lockoutUntil && Date.now() < lockoutUntil) {
      setErrorMessage(`Security protection active: Please wait ${lockoutSecondsLeft}s before attempting to sign in again.`);
      return;
    }

    const cleanIdentifier = sanitizeCredentialInput(identifier);
    const cleanPassword = password.trim();

    if (!cleanIdentifier || !cleanPassword) {
      setErrorMessage('Please enter your authorized User ID / Phone Number and Password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const user = await authenticateDatabaseUser(cleanIdentifier, cleanPassword);

      // Reset brute-force counter on successful authentication
      setFailedAttempts(0);
      setLockoutUntil(null);
      
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
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_DURATION_MS;
        setLockoutUntil(until);
        setErrorMessage('Multiple unsuccessful sign-in attempts detected. Access temporarily locked for 30 seconds for account security.');
      } else {
        setErrorMessage(err?.message || 'Invalid credentials provided. Please verify your User ID and Password.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 overflow-y-auto px-4 py-6 sm:p-8 custom-scrollbar overscroll-contain transition-colors duration-300 ${
      isPearl 
        ? 'bg-gradient-to-b from-[#FAFBFD] via-[#F4F7FB] to-[#EDF2F8] text-slate-900' 
        : 'bg-[#0B0F17] text-gray-100'
    }`}>
      {/* Single Animated Theme Toggle Switch (Top Right: Left = Charcoal Dark, Right = Pearl White Glassy) */}
      <div className="fixed top-3.5 sm:top-5 right-3.5 sm:right-6 z-30">
        <ThemeToggleSwitch />
      </div>

      {/* Background Ambience: Luxury Pearl White Glassy Sheen & Charcoal Depth */}
      <div 
        className="fixed inset-0 pointer-events-none transition-all duration-500"
        style={{
          backgroundImage: isPearl
            ? `
                radial-gradient(ellipse 85% 50% at 50% 6%, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.92) 45%, rgba(237, 242, 248, 0.96) 100%)
              `
            : `
                radial-gradient(ellipse 85% 45% at 50% 0%, rgba(14, 165, 233, 0.06) 0%, transparent 60%),
                linear-gradient(180deg, #0B0F17 0%, #111827 50%, #0B0F17 100%)
              `,
          opacity: 1
        }}
      />

      <div className="min-h-full w-full max-w-[430px] mx-auto flex flex-col justify-center items-center py-4 sm:py-8 relative z-10">
        {/* Prominent Corporate Logo Area placed closely above Sign In Card (Uploaded Logo Only; empty if none uploaded) */}
        <div className="w-full flex flex-col items-center text-center mb-4 sm:mb-5 animate-fade-in">
          <div className="inline-flex items-center justify-center min-h-[3.5rem] transform hover:scale-[1.03] transition-transform duration-300">
            {parentGroup?.logo && isUploadedLogo(parentGroup.logo) ? (
              <img 
                src={parentGroup.logo} 
                alt={parentGroup.name || "MAK Group of Companies"} 
                className="w-40 sm:w-48 md:w-52 h-40 sm:h-48 md:h-52 max-h-40 sm:max-h-48 md:max-h-52 object-contain drop-shadow-[0_12px_32px_rgba(15,23,42,0.16)] select-none" 
              />
            ) : null}
          </div>
        </div>

        {/* Clean Single Enterprise Sign In Card positioned directly underneath logo */}
        <div className="w-full relative z-10 animate-glass-in">
          <div className={`rounded-[1.75rem] p-6 sm:p-8 backdrop-blur-2xl transition-all duration-300 ${
            isPearl
              ? 'bg-white/88 border border-slate-200/95 text-slate-900 shadow-[0_24px_60px_-15px_rgba(15,23,42,0.09),0_4px_16px_-4px_rgba(15,23,42,0.04),inset_0_1px_0_0_rgba(255,255,255,0.95)]'
              : 'bg-[#141C2B]/92 border border-white/12 text-white shadow-[0_24px_60px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.08)]'
          }`}>
          
            {/* Card Title */}
            <div className="text-center mb-6">
              <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-widest mb-2.5 border ${
                isPearl
                  ? 'bg-slate-100/90 text-slate-700 border-slate-200/90'
                  : 'bg-white/5 text-slate-300 border-white/10'
              }`}>
                <ShieldCheck size={12} className="text-emerald-600" />
                <span>Encrypted Corporate Gateway</span>
              </div>
              <h2 className={`text-xl sm:text-2xl font-extrabold tracking-tight ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                Enterprise Sign In
              </h2>
              <p className={`text-xs sm:text-[13px] mt-1 font-medium ${isPearl ? 'text-slate-500' : 'text-slate-400'}`}>
                Enter your authorized credentials to access your workspace
              </p>
            </div>

            {/* Success Notice */}
            {successMessage && (
              <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                <span className="font-semibold">{successMessage}</span>
              </div>
            )}

            {/* Error Notice */}
            {errorMessage && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-500/12 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5 animate-fade-in">
                <Lock size={15} className="text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed font-semibold">{errorMessage}</span>
              </div>
            )}

            {/* Sign In Form */}
            <form onSubmit={handleCredentialsLogin} className="space-y-4">
              <div>
                <label 
                  htmlFor="login-identifier-input"
                  className={`block text-[11px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 ${
                    isPearl ? 'text-slate-700' : 'text-slate-300'
                  }`}
                >
                  <User size={13} className={isPearl ? 'text-slate-500' : 'text-slate-400'} />
                  <span>User ID / Registered Contact</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    id="login-identifier-input"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Enter User ID or Phone Number"
                    disabled={Boolean(lockoutUntil && Date.now() < lockoutUntil)}
                    className={`w-full px-4 py-3 rounded-xl text-sm font-medium focus:outline-none transition-all ${
                      isPearl
                        ? 'bg-white/95 border border-slate-300 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-slate-800 focus:ring-2 focus:ring-slate-900/10'
                        : 'bg-[#0F1623] border border-white/15 text-white placeholder-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/15'
                    }`}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label 
                    htmlFor="login-password-input"
                    className={`block text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                      isPearl ? 'text-slate-700' : 'text-slate-300'
                    }`}
                  >
                    <KeyRound size={13} className={isPearl ? 'text-slate-500' : 'text-slate-400'} />
                    <span>Security Password</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                      isPearl ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'
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
                    disabled={Boolean(lockoutUntil && Date.now() < lockoutUntil)}
                    className={`w-full px-4 py-3 rounded-xl text-sm font-medium focus:outline-none transition-all ${
                      isPearl
                        ? 'bg-white/95 border border-slate-300 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-slate-800 focus:ring-2 focus:ring-slate-900/10'
                        : 'bg-[#0F1623] border border-white/15 text-white placeholder-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/15'
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
                disabled={isLoading || Boolean(lockoutUntil && Date.now() < lockoutUntil)}
                className={`w-full mt-2 py-3 px-4 rounded-xl font-bold text-sm tracking-wide shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 select-none ${
                  isPearl
                    ? 'btn-charcoal-primary text-white'
                    : 'bg-sky-600 hover:bg-sky-500 text-white border border-sky-400/30 shadow-sky-900/30'
                }`}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-white shrink-0" />
                    <span className="font-bold text-white">Authenticating Session...</span>
                  </>
                ) : lockoutSecondsLeft > 0 ? (
                  <>
                    <Lock size={15} className="text-white shrink-0" />
                    <span className="font-bold text-white font-mono">Locked ({lockoutSecondsLeft}s)</span>
                  </>
                ) : (
                  <>
                    <LogIn size={16} className="text-white shrink-0" />
                    <span className="font-bold text-white text-sm tracking-wide">Sign In to Workspace</span>
                  </>
                )}
              </button>

              {/* Clean Corporate New Registration Action */}
              <div className={`pt-3.5 border-t flex justify-center ${isPearl ? 'border-slate-200/90' : 'border-white/10'}`}>
                <button
                  type="button"
                  onClick={() => setIsRegistrationModalOpen(true)}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold tracking-wide transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    isPearl
                      ? 'bg-slate-100/90 hover:bg-slate-200/90 text-slate-800 border border-slate-300/90'
                      : 'bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white border border-white/12'
                  }`}
                >
                  <span>Client & Fleet Partner Registration</span>
                  <ArrowRight size={14} className={isPearl ? 'text-slate-600' : 'text-slate-400'} />
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

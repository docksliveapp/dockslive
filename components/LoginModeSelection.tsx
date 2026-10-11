import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  KeyRound,
  Eye,
  EyeOff,
  LogIn,
  Loader2,
  Clock,
  User,
  CheckCircle2,
  ArrowRight,
  Crown,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { UserRole } from '../types';
import { useParentGroup, isUploadedLogo } from '../services/companyService';
import { safeAppStorage } from '../services/storage';
import { authenticateDatabaseUser } from '../services/dbService';
import { NewRegistrationModal } from './NewRegistrationModal';

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

  // Luxury Theme: Pearl White vs Charcoal (matching MAK Logo)
  const [theme, setTheme] = useState<'pearl' | 'charcoal'>(() => {
    const saved = safeAppStorage.getItem('dpl_app_theme');
    return (saved === 'charcoal' || saved === 'pearl') ? saved : 'charcoal';
  });

  useEffect(() => {
    if (theme === 'pearl') {
      document.body.classList.remove('theme-charcoal');
      document.body.classList.add('theme-pearl');
    } else {
      document.body.classList.remove('theme-pearl');
      document.body.classList.add('theme-charcoal');
    }
    safeAppStorage.setItem('dpl_app_theme', theme);
  }, [theme]);

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

      const userAllowedCompanies: string[] = (user as any).allowedCompanies || (user.isGlobalAdmin ? ['docks', 'truckit', 'muhib', 'vantage'] : ['docks']);
      const isUserGlobalAdmin: boolean = Boolean(user.isGlobalAdmin);

      safeAppStorage.setItem('dpl_allowed_companies', JSON.stringify(userAllowedCompanies));
      safeAppStorage.setItem('dpl_is_global_admin', isUserGlobalAdmin ? 'true' : 'false');

      let targetView = 'dashboard';

      if (userRole === UserRole.CLIENT) {
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
        clientName: user.clientName || (userRole === UserRole.CLIENT ? user.name : 'Client Portal'),
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

  const handleEmergencyReset = async () => {
    if (window.confirm('Clear local app cookies & cache and reload latest version? This resolves any stuck screens after updates.')) {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            await reg.unregister();
          }
        }
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          for (const key of keys) {
            await caches.delete(key);
          }
        }
        safeAppStorage.clear();
        localStorage.clear();
        sessionStorage.clear();
      } catch (_) {}
      window.location.reload();
    }
  };

  return (
    <div className={`fixed inset-0 z-50 overflow-y-auto p-3 sm:p-6 custom-scrollbar overscroll-contain transition-colors duration-300 ${
      theme === 'pearl' ? 'bg-transparent text-slate-900' : 'bg-slate-950 text-gray-100'
    }`}>
      {/* Luxury Theme Switcher Button (Top Right) */}
      <div className="absolute top-3 sm:top-5 right-3 sm:right-6 z-30">
        <button
          type="button"
          onClick={() => setTheme(prev => prev === 'pearl' ? 'charcoal' : 'pearl')}
          className={`btn-animated-luxury px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-md active:scale-95 ${
            theme === 'pearl'
              ? 'bg-gradient-to-r from-amber-100 via-white to-amber-50 text-slate-900 border-amber-300/80 shadow-md ring-1 ring-amber-300/50'
              : 'bg-slate-900/90 hover:bg-slate-800 text-white border-white/20 shadow-black/30'
          }`}
          title={theme === 'pearl' ? "Switch to Charcoal Luxury (Executive Night)" : "Switch to Pearl White (MAK Logo Theme)"}
        >
          <Sparkles size={13} className={theme === 'pearl' ? "text-amber-600" : "text-amber-400"} />
          <span className="font-mono text-[11px] uppercase tracking-wider font-bold">
            {theme === 'pearl' ? 'Pearl White' : 'Charcoal'}
          </span>
        </button>
      </div>

      {/* Background Ambience: Luxury Charcoal & Pearl White Sheen */}
      <div 
        className="fixed inset-0 pointer-events-none transition-all duration-500"
        style={{
          backgroundImage: theme === 'pearl'
            ? `
                radial-gradient(ellipse 90% 55% at 50% 8%, #FFFFFF 0%, rgba(255, 255, 255, 0.95) 28%, #FAF5EC 50%, #EFE7DA 80%, #E3D7C5 100%),
                radial-gradient(circle at 12% 92%, rgba(255, 255, 255, 0.75) 0%, transparent 45%),
                radial-gradient(circle at 88% 92%, rgba(226, 215, 197, 0.45) 0%, transparent 45%)
              `
            : `
                radial-gradient(ellipse 90% 45% at 50% 0%, rgba(241, 245, 249, 0.08) 0%, transparent 60%),
                radial-gradient(ellipse 70% 50% at 50% 50%, rgba(248, 250, 252, 0.04) 0%, transparent 70%),
                linear-gradient(180deg, #0B0F17 0%, #111827 40%, #1A2234 75%, #0B0E17 100%)
              `,
          opacity: theme === 'pearl' ? 1 : 0.25
        }}
      />

      <div className="min-h-full w-full max-w-md mx-auto flex flex-col justify-center items-center py-6 sm:py-8 relative z-10">
        {/* Prominent Large MAK Corporate Logo placed closely above Sign In Card */}
        <div className="w-full flex flex-col items-center text-center mb-3 sm:mb-4">
          <div className="inline-flex items-center justify-center transform hover:scale-105 transition-transform duration-300">
            {parentGroup?.logo && isUploadedLogo(parentGroup.logo) ? (
              <img 
                src={parentGroup.logo} 
                alt={parentGroup.name || "MAK Group"} 
                className="w-56 sm:w-64 md:w-72 h-auto max-h-24 sm:max-h-28 object-contain drop-shadow-[0_10px_35px_rgba(0,0,0,0.8)] filter contrast-125" 
              />
            ) : (
              <img 
                src={theme === 'pearl' ? "/logos/mak_pearl_white_emblem.svg" : "/logos/mak_group_logo.svg"} 
                alt={parentGroup.name || "MAK Group"} 
                className="w-56 sm:w-64 md:w-72 h-auto max-h-24 sm:max-h-28 object-contain drop-shadow-[0_10px_35px_rgba(0,0,0,0.25)]" 
              />
            )}
          </div>
        </div>

        {/* Clean Single Enterprise Sign In Card positioned directly underneath logo */}
        <div className="w-full relative z-10 animate-fade-in">
          <div className={`rounded-3xl p-6 sm:p-7 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
            theme === 'pearl'
              ? 'bg-white/92 border border-[#D5CBB9] text-slate-900 shadow-[0_20px_50px_-10px_rgba(120,105,85,0.16)] ring-1 ring-white/80'
              : 'bg-slate-900/95 border border-white/15 text-white'
          }`}>
          
          {/* Card Title */}
          <div className="text-center mb-5">
            <h2 className={`text-xl font-bold tracking-wide ${theme === 'pearl' ? 'text-slate-900' : 'text-white'}`}>
              Enterprise Sign In
            </h2>
            <p className={`text-xs mt-1 ${theme === 'pearl' ? 'text-slate-600' : 'text-slate-400'}`}>
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
              <label className={`block text-xs font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 ${
                theme === 'pearl' ? 'text-slate-700' : 'text-slate-300'
              }`}>
                <User size={13} className={theme === 'pearl' ? 'text-slate-500' : 'text-slate-400'} />
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
                    theme === 'pearl'
                      ? 'bg-white border border-[#D0C5B0] text-slate-900 placeholder-slate-400 focus:border-slate-800 focus:ring-1 focus:ring-slate-800/20'
                      : 'bg-slate-950 border border-white/15 text-white placeholder-gray-500 focus:border-white/40 focus:ring-1 focus:ring-white/20'
                  }`}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`block text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                  theme === 'pearl' ? 'text-slate-700' : 'text-slate-300'
                }`}>
                  <KeyRound size={13} className={theme === 'pearl' ? 'text-slate-500' : 'text-slate-400'} />
                  <span>Password</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={`text-[11px] flex items-center gap-1 cursor-pointer transition-colors ${
                    theme === 'pearl' ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'
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
                    theme === 'pearl'
                      ? 'bg-white border border-[#D0C5B0] text-slate-900 placeholder-slate-400 focus:border-slate-800 focus:ring-1 focus:ring-slate-800/20'
                      : 'bg-slate-950 border border-white/15 text-white placeholder-gray-500 focus:border-white/40 focus:ring-1 focus:ring-white/20'
                  }`}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            {/* Submit Sign In Button (Animated Luxury Button) */}
            <button
              type="submit"
              id="btn-submit-credentials"
              disabled={isLoading}
              className={`w-full mt-2 py-3 px-4 rounded-xl btn-animated-luxury font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 select-none ${
                theme === 'pearl'
                  ? 'bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 shadow-slate-900/20'
                  : 'bg-slate-800 hover:bg-slate-700 text-white border border-white/20'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 size={17} className="animate-spin text-white shrink-0" />
                  <span className="font-extrabold text-white">Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <LogIn size={17} className="text-white shrink-0" />
                  <span className="font-extrabold text-white text-sm tracking-wide">Sign In</span>
                </>
              )}
            </button>

            {/* Clean Professional New Registration Action */}
            <div className={`pt-3 border-t flex justify-center ${theme === 'pearl' ? 'border-slate-200' : 'border-white/10'}`}>
              <button
                type="button"
                onClick={() => setIsRegistrationModalOpen(true)}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold tracking-wide transition cursor-pointer flex items-center justify-center gap-2 shadow-sm ${
                  theme === 'pearl'
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                    : 'bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white border border-white/15 hover:border-white/30'
                }`}
              >
                <span>New Registration</span>
                <ArrowRight size={14} className={theme === 'pearl' ? 'text-slate-600' : 'text-slate-400'} />
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Footer Info Notice & Emergency Reset */}
      <div className={`w-full max-w-xl mx-auto pt-3 pb-2 text-center text-[11px] relative z-10 flex flex-col sm:flex-row items-center justify-between gap-2 border-t ${
        theme === 'pearl' ? 'text-slate-600 border-slate-300/60' : 'text-gray-500 border-white/5'
      }`}>
        <div className="flex items-center gap-2 text-emerald-600">
          <ShieldCheck size={14} className="text-emerald-600" />
          <span className="font-medium">Authorized Access • 256-bit Encrypted Session</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleEmergencyReset}
            className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition hover:underline cursor-pointer ${
              theme === 'pearl' ? 'text-slate-500 hover:text-slate-800' : 'text-gray-400 hover:text-gray-200'
            }`}
            title="Click if app hangs after updates to clear stale browser cache"
          >
            <RotateCcw size={10} />
            <span>Reset Cache</span>
          </button>
          <div className={`flex items-center gap-2 ${theme === 'pearl' ? 'text-slate-600' : 'text-gray-400'}`}>
            <span>MAK Group Central Operations Cloud</span>
          </div>
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

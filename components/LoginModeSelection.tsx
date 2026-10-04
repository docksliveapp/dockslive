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
  HelpCircle
} from 'lucide-react';
import { UserRole } from '../types';
import { useParentGroup } from '../services/companyService';
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
}

interface LoginModeSelectionProps {
  onSelectMode: (payload: SelectedModePayload) => void;
}

// Clean discrete demo role helper for quick testing (collapsed by default)
const DEMO_TESTING_ACCOUNTS = [
  { id: 'admin', userId: 'admin', password: 'dpl01234', name: 'System Administrator', role: UserRole.ADMIN, designation: 'System Administrator' },
  { id: 'finance', userId: 'finance', password: 'dpl01234', name: 'Finance Manager', role: UserRole.FINANCE_MANAGER, designation: 'Finance Manager' },
  { id: 'casemanager', userId: 'casemanager', password: 'dpl01234', name: 'Operations Manager', role: UserRole.OPERATIONS_MANAGER, designation: 'Operations Manager' },
  { id: 'vehiclemanager', userId: 'vehiclemanager', password: 'dpl01234', name: 'Fleet Manager', role: UserRole.VEHICLE_MANAGER, designation: 'Fleet & Vehicle Manager' },
  { id: 'transporter', userId: 'transporter', password: 'dpl01234', name: 'Transporter Portal', role: UserRole.TRANSPORTER, designation: 'Goods Transporter' },
  { id: 'client', userId: 'client', password: 'dpl01234', name: 'Client Portal', role: UserRole.CLIENT, designation: 'Corporate Importer' }
];

export const LoginModeSelection: React.FC<LoginModeSelectionProps> = ({ onSelectMode }) => {
  const { parentGroup } = useParentGroup();

  // Credentials Form State
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isRegistrationModalOpen, setIsRegistrationModalOpen] = useState(false);
  const [showDemoGuide, setShowDemoGuide] = useState(false);

  // Workflow & Draft Resumption Detection
  const [hasActiveDraft, setHasActiveDraft] = useState(false);
  const [draftCaseNo, setDraftCaseNo] = useState('');
  const [draftStep, setDraftStep] = useState(1);
  const [lastLocationView, setLastLocationView] = useState<string | null>(null);
  const [lastLocationRole, setLastLocationRole] = useState<string | null>(null);

  useEffect(() => {
    const regView = safeAppStorage.getItem('dpl_reg_view');
    const caseNo = safeAppStorage.getItem('dpl_reg_caseno') || '';
    const stepVal = parseInt(safeAppStorage.getItem('dpl_reg_step') || '1', 10);
    const lastView = safeAppStorage.getItem('dpl_last_location_view');
    const lastRole = safeAppStorage.getItem('dpl_last_location_role');

    if (regView === 'register') {
      setHasActiveDraft(true);
      setDraftCaseNo(caseNo);
      setDraftStep(stepVal);
    }
    if (lastView) setLastLocationView(lastView);
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

      let targetView = 'dashboard';

      if (userRole === UserRole.CLIENT) {
        targetView = 'cases';
      } else if (userRole === UserRole.VENDOR) {
        targetView = 'vendor_portal';
      } else if (userRoles.includes(UserRole.FINANCE_MANAGER)) {
        targetView = 'finance';
      } else if (userRoles.includes(UserRole.VEHICLE_MANAGER) || userRole === UserRole.TRANSPORTER) {
        targetView = 'vehicles';
      } else if (hasActiveDraft && (userRoles.includes(UserRole.ADMIN) || userRoles.includes(UserRole.OPERATIONS_MANAGER))) {
        targetView = 'cases';
      } else if (lastLocationRole === userRole && lastLocationView) {
        targetView = lastLocationView;
      } else if (userRoles.includes(UserRole.OPERATIONS_MANAGER) || userRoles.includes(UserRole.OFFICE_STAFF)) {
        targetView = 'cases';
      }

      onSelectMode({
        role: userRole,
        roles: userRoles,
        designation: user.designation,
        clientName: user.clientName || (userRole === UserRole.CLIENT ? user.name : 'Client Portal'),
        targetView: targetView,
        displayName: user.name || user.userId || 'Staff User'
      });
    } catch (err: any) {
      console.error('Login failure:', err);
      setErrorMessage(err?.message || 'Invalid User ID or Password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // 1-Click login helper for testing
  const handleQuickLogin = async (user: typeof DEMO_TESTING_ACCOUNTS[0]) => {
    setIdentifier(user.userId);
    setPassword(user.password);
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const authUser = await authenticateDatabaseUser(user.userId, user.password);
      const userRole = (authUser.role as UserRole) || user.role || UserRole.ADMIN;
      const userRoles = (authUser.roles && authUser.roles.length > 0) ? authUser.roles : [userRole];

      safeAppStorage.setItem('dpl_user_roles', JSON.stringify(userRoles));
      if (authUser.designation) {
        safeAppStorage.setItem('dpl_user_designation', authUser.designation);
      }
      safeAppStorage.setItem('dpl_current_user_id', authUser.userId || user.userId || '');
      safeAppStorage.setItem('dpl_current_user_name', authUser.name || user.name || authUser.userId || 'Staff');

      let targetView = 'dashboard';
      if (userRole === UserRole.CLIENT) {
        targetView = 'cases';
      } else if (userRole === UserRole.TRANSPORTER || userRoles.includes(UserRole.VEHICLE_MANAGER)) {
        targetView = 'vehicles';
      } else if (userRoles.includes(UserRole.FINANCE_MANAGER)) {
        targetView = 'finance';
      } else if (userRoles.includes(UserRole.OPERATIONS_MANAGER) || userRoles.includes(UserRole.OFFICE_STAFF)) {
        targetView = 'cases';
      }

      onSelectMode({
        role: userRole,
        roles: userRoles,
        designation: authUser.designation || user.designation,
        clientName: authUser.clientName || (userRole === UserRole.CLIENT ? authUser.name : 'Client Portal'),
        targetView: targetView,
        displayName: authUser.name || user.name || authUser.userId || 'Staff User'
      });
    } catch (err: any) {
      console.error('Quick login error:', err);
      setErrorMessage(err?.message || 'Quick login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between overflow-y-auto bg-slate-950 text-gray-100 p-4 sm:p-8 custom-scrollbar">
      {/* Background Ambience */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 15%, rgba(245, 158, 11, 0.18) 0%, transparent 55%),
            radial-gradient(circle at 10% 85%, rgba(37, 99, 235, 0.12) 0%, transparent 50%),
            radial-gradient(circle at 90% 85%, rgba(16, 185, 129, 0.12) 0%, transparent 50%)
          `
        }}
      />

      {/* Top Header: Exact MAK Group Corporate Identity */}
      <div className="w-full max-w-md mx-auto flex flex-col items-center text-center pt-4 pb-2 relative z-10">
        <div className="inline-flex items-center justify-center mb-3 transform hover:scale-105 transition-transform duration-300">
          <img 
            src={parentGroup.logo || "/logos/mak_group_logo.svg"} 
            alt={parentGroup.name || "MAK Group of Companies"} 
            className="w-24 h-24 sm:w-28 sm:h-28 object-contain drop-shadow-[0_8px_30px_rgba(245,158,11,0.35)]" 
          />
        </div>

        {/* Corporate Title */}
        <h1 className="text-xl sm:text-2xl font-black tracking-wider text-amber-300 uppercase font-serif px-2">
          {parentGroup.title || 'MAK GROUP OF COMPANIES'}
        </h1>
        <p className="text-xs font-semibold text-amber-400/80 tracking-widest uppercase mt-1">
          Docks • Muhib • Vintage • Truckit
        </p>
      </div>

      {/* Clean Single Enterprise Sign In Card */}
      <div className="w-full max-w-md mx-auto my-auto py-3 relative z-10 animate-fade-in">
        <div className="bg-slate-900/90 border border-white/10 rounded-3xl p-6 sm:p-7 shadow-2xl backdrop-blur-xl">
          
          {/* Card Title */}
          <div className="text-center mb-5">
            <h2 className="text-xl font-bold text-white tracking-wide">
              Enterprise Sign In
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Enter your credentials to access your company workspace
            </p>
          </div>

          {/* Success Notice */}
          {successMessage && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Error Notice */}
          {errorMessage && (
            <div className="mb-4 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* In-Progress Draft Resumption Notice */}
          {hasActiveDraft && (
            <div className="mb-4 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
              <Clock size={14} className="shrink-0 text-amber-400" />
              <span className="truncate">Active case registration draft ({draftCaseNo || `Step ${draftStep}`}) ready to resume.</span>
            </div>
          )}

          {/* Sign In Form */}
          <form onSubmit={handleCredentialsLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <User size={13} className="text-amber-400" />
                <span>User ID / Phone Number</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  id="login-identifier-input"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g. admin, finance, or phone number"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40 transition placeholder-gray-500"
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound size={13} className="text-amber-400" />
                  <span>Password</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
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
                  className="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40 transition placeholder-gray-500"
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
              className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-[0.99] text-slate-950 font-bold text-sm tracking-wide shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 select-none border border-amber-400/40"
            >
              {isLoading ? (
                <>
                  <Loader2 size={17} className="animate-spin text-slate-950 shrink-0" />
                  <span className="font-extrabold text-slate-950">Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <LogIn size={17} className="text-slate-950 shrink-0" />
                  <span className="font-extrabold text-slate-950 text-sm tracking-wide">Sign In</span>
                </>
              )}
            </button>

            {/* Single Clean Professional New Registration Line at Bottom */}
            <div className="pt-4 border-t border-white/10 text-center">
              <p className="text-xs text-gray-400">
                Don't have an enterprise account?{' '}
                <button
                  type="button"
                  onClick={() => setIsRegistrationModalOpen(true)}
                  className="text-amber-400 hover:text-amber-300 font-bold hover:underline transition cursor-pointer inline-flex items-center gap-1.5 ml-1"
                >
                  <span>New Registration</span>
                  <ArrowRight size={13} />
                </button>
              </p>
            </div>
          </form>

          {/* Tiny Discrete Demo Helper (Collapsed by Default) */}
          <div className="mt-4 pt-3 border-t border-white/5 text-center">
            <button
              type="button"
              onClick={() => setShowDemoGuide(!showDemoGuide)}
              className="text-[11px] text-gray-500 hover:text-amber-400 transition cursor-pointer inline-flex items-center gap-1"
            >
              <HelpCircle size={12} />
              <span>{showDemoGuide ? 'Hide Demo Logins' : 'Demo Test Accounts'}</span>
            </button>

            {showDemoGuide && (
              <div className="mt-2.5 p-2 rounded-xl bg-black/40 border border-white/5 grid grid-cols-3 gap-1.5 animate-fade-in text-[10px]">
                {DEMO_TESTING_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => handleQuickLogin(acc)}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-amber-500/20 text-gray-300 hover:text-amber-300 transition text-center truncate border border-white/5"
                  >
                    <span className="font-bold block truncate">{acc.name}</span>
                    <span className="text-gray-500 text-[9px] font-mono">{acc.userId}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Info Notice */}
      <div className="w-full max-w-xl mx-auto pt-3 pb-2 text-center text-[11px] text-gray-500 relative z-10 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-white/5">
        <div className="flex items-center gap-2 text-emerald-400/80">
          <ShieldCheck size={14} className="text-emerald-400" />
          <span>Authorized Access • 256-bit Encrypted Session</span>
        </div>
        <div className="flex items-center gap-2 text-gray-400">
          <span>MAK Group of Companies • Central Operations Cloud</span>
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

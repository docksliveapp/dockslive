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
  HelpCircle,
  Crown
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

// Clean discrete demo role helper for quick testing (collapsed by default)
const DEMO_TESTING_ACCOUNTS = [
  { id: 'admin', userId: 'admin', password: 'dpl01234', name: 'Main Group Administrator', role: UserRole.ADMIN, roles: [UserRole.ADMIN], designation: 'Main Group Admin (All 4 Companies)', isGlobalAdmin: true, allowedCompanies: ['docks', 'muhib', 'vantage', 'truckit'] },
  { id: 'admin_docks', userId: 'admin_docks', password: 'dpl01234', name: 'Docks Company Admin', role: UserRole.ADMIN, roles: [UserRole.ADMIN], designation: 'Company Admin (Docks Only)', isGlobalAdmin: false, allowedCompanies: ['docks'] },
  { id: 'fin_fleet', userId: 'fin_fleet', password: 'dpl01234', name: 'Finance & Vehicle Manager', role: UserRole.FINANCE_MANAGER, roles: [UserRole.FINANCE_MANAGER, UserRole.VEHICLE_MANAGER], designation: 'Multi-Role: Finance + Fleet', isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'] },
  { id: 'ops_fleet', userId: 'ops_fleet', password: 'dpl01234', name: 'Operations & Fleet Manager', role: UserRole.OPERATIONS_MANAGER, roles: [UserRole.OPERATIONS_MANAGER, UserRole.VEHICLE_MANAGER], designation: 'Multi-Role: Ops + Fleet', isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'] },
  { id: 'loadingstaff', userId: 'loadingstaff', password: 'dpl01234', name: 'Loading Port Staff', role: UserRole.LOADING_PORT_STAFF, roles: [UserRole.LOADING_PORT_STAFF], designation: 'Loading Port Customs Inspector', isGlobalAdmin: false, allowedCompanies: ['docks', 'truckit'] },
  { id: 'destinationstaff', userId: 'destinationstaff', password: 'dpl01234', name: 'Destination Port Staff', role: UserRole.DESTINATION_PORT_STAFF, roles: [UserRole.DESTINATION_PORT_STAFF], designation: 'Border Terminal Officer', isGlobalAdmin: false, allowedCompanies: ['docks'] },
  { id: 'transporter', userId: 'transporter', password: 'dpl01234', name: 'Transporter Portal', role: UserRole.TRANSPORTER, roles: [UserRole.TRANSPORTER], designation: 'Goods Transporter' },
  { id: 'client', userId: 'client', password: 'dpl01234', name: 'Client Portal', role: UserRole.CLIENT, roles: [UserRole.CLIENT], designation: 'Corporate Importer' }
];

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

      const userAllowedCompanies: string[] = (authUser as any).allowedCompanies || (user as any).allowedCompanies || (authUser.isGlobalAdmin || (user as any).isGlobalAdmin ? ['docks', 'truckit', 'muhib', 'vantage'] : ['docks']);
      const isUserGlobalAdmin: boolean = Boolean(authUser.isGlobalAdmin ?? (user as any).isGlobalAdmin);

      safeAppStorage.setItem('dpl_user_roles', JSON.stringify(userRoles));
      safeAppStorage.setItem('dpl_allowed_companies', JSON.stringify(userAllowedCompanies));
      safeAppStorage.setItem('dpl_is_global_admin', isUserGlobalAdmin ? 'true' : 'false');
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
        displayName: authUser.name || user.name || authUser.userId || 'Staff User',
        allowedCompanies: userAllowedCompanies,
        isGlobalAdmin: isUserGlobalAdmin
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
      {/* Background Ambience: Luxury Charcoal & Pearl White Sheen */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 90% 45% at 50% 0%, rgba(241, 245, 249, 0.08) 0%, transparent 60%),
            radial-gradient(ellipse 70% 50% at 50% 50%, rgba(248, 250, 252, 0.04) 0%, transparent 70%),
            linear-gradient(180deg, #0B0F17 0%, #111827 40%, #1A2234 75%, #0B0E17 100%)
          `
        }}
      />

      {/* Top Header: Exact MAK Group Corporate Identity (Logo Only) */}
      <div className="w-full max-w-md mx-auto flex flex-col items-center text-center pt-5 pb-2 relative z-10">
        <div className="inline-flex items-center justify-center transform hover:scale-105 transition-transform duration-300">
          {parentGroup?.logo && isUploadedLogo(parentGroup.logo) ? (
            <img 
              src={parentGroup.logo} 
              alt={parentGroup.name || "MAK Group"} 
              className="w-28 h-28 sm:w-32 sm:h-32 object-contain drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)]" 
            />
          ) : (
            <img 
              src="/logos/mak_group_logo.svg" 
              alt={parentGroup.name || "MAK Group"} 
              className="w-28 h-28 sm:w-32 sm:h-32 object-contain drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)]" 
            />
          )}
        </div>
      </div>

      {/* Clean Single Enterprise Sign In Card */}
      <div className="w-full max-w-md mx-auto my-auto py-3 relative z-10 animate-fade-in">
        <div className="bg-slate-900/95 border border-white/15 rounded-3xl p-6 sm:p-7 shadow-2xl backdrop-blur-xl">
          
          {/* Card Title */}
          <div className="text-center mb-5">
            <h2 className="text-xl font-bold text-white tracking-wide">
              Enterprise Sign In
            </h2>
            <p className="text-xs text-slate-400 mt-1">
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
            <div className="mb-4 px-3.5 py-2 rounded-xl bg-white/5 border border-white/20 text-slate-200 text-xs flex items-center gap-2">
              <Clock size={14} className="shrink-0 text-slate-300" />
              <span className="truncate">Active case registration draft ({draftCaseNo || `Step ${draftStep}`}) ready to resume.</span>
            </div>
          )}

          {/* Sign In Form */}
          <form onSubmit={handleCredentialsLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <User size={13} className="text-slate-400" />
                <span>User ID / Phone Number</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  id="login-identifier-input"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g. admin, finance, or phone number"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-white/15 rounded-xl text-white text-sm focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 transition placeholder-gray-500"
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound size={13} className="text-slate-400" />
                  <span>Password</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
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
                  className="w-full px-4 py-2.5 bg-slate-950 border border-white/15 rounded-xl text-white text-sm focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 transition placeholder-gray-500"
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
              className="w-full mt-2 py-3 px-4 rounded-xl btn-animated-luxury bg-slate-800 hover:bg-slate-700 active:scale-[0.99] text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 select-none border border-white/20"
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
            <div className="pt-3 border-t border-white/10 flex justify-center">
              <button
                type="button"
                onClick={() => setIsRegistrationModalOpen(true)}
                className="w-full py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white border border-white/15 hover:border-white/30 text-xs font-semibold tracking-wide transition cursor-pointer flex items-center justify-center gap-2 shadow-sm"
              >
                <span>New Registration</span>
                <ArrowRight size={14} className="text-slate-400 group-hover:text-white" />
              </button>
            </div>
          </form>

          {/* Quick Demo Test Accounts Panel */}
          <div className="mt-4 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <HelpCircle size={13} className="text-slate-400" />
                <span>Quick Demo Accounts</span>
              </span>
              <button
                type="button"
                onClick={() => setShowDemoGuide(!showDemoGuide)}
                className="text-[10px] text-slate-400 hover:text-white font-semibold underline cursor-pointer"
              >
                {showDemoGuide ? 'Collapse All' : 'View All Accounts'}
              </button>
            </div>

            {/* Quick Priority One-Tap Staff Pills */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                type="button"
                onClick={() => handleQuickLogin(DEMO_TESTING_ACCOUNTS[1])}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 hover:text-white transition text-left flex items-center justify-between gap-1 cursor-pointer group"
                title="Sign in as Loading Port Staff (loadingstaff)"
              >
                <div className="min-w-0">
                  <span className="text-[11px] font-bold block truncate text-slate-100 group-hover:text-white">Loading Port Staff</span>
                  <span className="text-[9px] font-mono text-slate-400 block">loadingstaff</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-300 shrink-0">1-Tap</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin(DEMO_TESTING_ACCOUNTS[2])}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 hover:text-white transition text-left flex items-center justify-between gap-1 cursor-pointer group"
                title="Sign in as Destination Port Staff (destinationstaff)"
              >
                <div className="min-w-0">
                  <span className="text-[11px] font-bold block truncate text-slate-100 group-hover:text-white">Destination Staff</span>
                  <span className="text-[9px] font-mono text-slate-400 block">destinationstaff</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-300 shrink-0">1-Tap</span>
              </button>
            </div>

            {showDemoGuide && (
              <div className="mt-2 p-2 rounded-xl bg-black/50 border border-white/10 grid grid-cols-3 gap-1.5 animate-fade-in text-[10px]">
                {DEMO_TESTING_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => handleQuickLogin(acc)}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition text-center truncate border border-white/5 cursor-pointer"
                  >
                    <span className="font-bold block truncate">{acc.name}</span>
                    <span className="text-gray-400 text-[9px] font-mono">{acc.userId}</span>
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

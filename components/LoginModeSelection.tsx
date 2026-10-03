import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  KeyRound,
  Eye,
  EyeOff,
  LogIn,
  Loader2,
  HelpCircle,
  Clock,
  User,
  CheckCircle2,
  Building,
  UserPlus
} from 'lucide-react';
import { UserRole } from '../types';
import Logo from './Logo';
import { useBranding } from '../services/brandingService';
import { safeAppStorage } from '../services/storage';
import { authenticateDatabaseUser, DEFAULT_DATABASE_USERS, saveClientToFirestore } from '../services/dbService';
import { sendAppNotification } from '../services/notificationService';

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

// Dedicated clean role list for testing mode (Strictly roles only, no personal names)
const TESTING_ROLE_ACCOUNTS = [
  { id: 'admin', userId: 'admin', password: 'dpl01234', name: 'System Administrator', role: UserRole.ADMIN, designation: 'System Administrator' },
  { id: 'finance', userId: 'finance', password: 'dpl01234', name: 'Finance Manager', role: UserRole.FINANCE_MANAGER, designation: 'Finance Manager' },
  { id: 'casemanager', userId: 'casemanager', password: 'dpl01234', name: 'Operations Manager', role: UserRole.OPERATIONS_MANAGER, designation: 'Operations Manager' },
  { id: 'vehiclemanager', userId: 'vehiclemanager', password: 'dpl01234', name: 'Vehicles Manager', role: UserRole.VEHICLE_MANAGER, designation: 'Fleet & Vehicle Manager' },
  { id: 'officestaff', userId: 'officestaff', password: 'dpl01234', name: 'Office Staff', role: UserRole.OFFICE_STAFF, designation: 'Office Staff Coordinator' },
  { id: 'transporter', userId: 'transporter', password: 'dpl01234', name: 'Transporter Portal', role: UserRole.TRANSPORTER, designation: 'Goods Transporter' },
  { id: 'client', userId: 'client', password: 'dpl01234', name: 'Client Portal', role: UserRole.CLIENT, designation: 'Corporate Importer' },
  { id: 'vendor', userId: 'vendor', password: 'dpl01234', name: 'Vendor Portal', role: UserRole.VENDOR, designation: 'Supplier / Service Vendor' }
];

export const LoginModeSelection: React.FC<LoginModeSelectionProps> = ({ onSelectMode }) => {
  const { customLogo, companyName, subtitle } = useBranding();

  // Credentials Form State - Blank by default, user enters their credentials
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showCredentialsGuide, setShowCredentialsGuide] = useState(true);

  // Client Registration Form State
  const [clientReg, setClientReg] = useState({
    companyName: '',
    contactPerson: '',
    mobileNumber: '',
    email: '',
    ntn: '',
    officeAddress: '',
    password: ''
  });

  const handleClientRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientReg.companyName.trim() || !clientReg.mobileNumber.trim() || !clientReg.password.trim()) {
      setErrorMessage('Please fill in Company Name, Mobile Number, and Password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const clientId = `CLT-${Date.now().toString().slice(-4)}`;
      const clientName = clientReg.companyName.trim();
      const contactPerson = clientReg.contactPerson.trim() || clientName;
      const phone = clientReg.mobileNumber.trim();

      await saveClientToFirestore({
        id: clientId,
        name: clientName,
        ownerName: contactPerson,
        contact: contactPerson,
        mobileNumber: phone,
        whatsappNumber: phone,
        email: clientReg.email.trim(),
        ntn: clientReg.ntn.trim(),
        officeAddress: clientReg.officeAddress.trim(),
        userId: phone || clientId,
        password: clientReg.password.trim(),
        loginEnabled: false,
        status: 'PENDING_APPROVAL' as any
      });

      // Emit high-priority approval notification to Finance Manager
      await sendAppNotification({
        title: `Client Registration Approval: ${clientName}`,
        description: `New client "${clientName}" (${contactPerson}, Phone: ${phone}) registered via portal. Finance Manager verification and approval required before login access is activated.`,
        details: `Company: ${clientName}\nContact: ${contactPerson}\nPhone: ${phone}\nEmail: ${clientReg.email || 'N/A'}\nNTN: ${clientReg.ntn || 'N/A'}\nAddress: ${clientReg.officeAddress || 'N/A'}`,
        targetRole: UserRole.FINANCE_MANAGER,
        targetView: 'users',
        type: 'ACTION',
        notificationSubType: 'CLIENT_REGISTRATION_APPROVAL',
        status: 'PENDING',
        actionLabel: 'Approve Client',
        category: 'APPROVAL',
        approvalData: {
          entityType: 'client',
          entityId: clientId,
          entityName: clientName,
          actionType: 'APPROVE_CLIENT',
          requestedBy: contactPerson
        }
      });

      setSuccessMessage(`Registration request submitted successfully! Your account is pending verification and approval by the Finance Manager / Administration. Access will be activated upon approval.`);
      setClientReg({
        companyName: '',
        contactPerson: '',
        mobileNumber: '',
        email: '',
        ntn: '',
        officeAddress: '',
        password: ''
      });
      setTimeout(() => {
        setAuthMode('signin');
      }, 3500);
    } catch (err: any) {
      console.error('Registration failed:', err);
      setErrorMessage(err?.message || 'Could not submit registration. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Workflow & Draft Resumption Detection
  const [hasActiveDraft, setHasActiveDraft] = useState(false);
  const [draftCaseNo, setDraftCaseNo] = useState('');
  const [draftStep, setDraftStep] = useState(1);
  const [lastLocationView, setLastLocationView] = useState<string | null>(null);
  const [lastLocationRole, setLastLocationRole] = useState<string | null>(null);

  useEffect(() => {
    // Check if user was in the middle of a case registration
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
      setErrorMessage('Please enter both User ID and Password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const user = await authenticateDatabaseUser(identifier.trim(), password.trim());
      
      // Determine user role and navigation target
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
      } else if (userRoles.includes(UserRole.OPERATIONS_MANAGER) || userRoles.includes(UserRole.LOADING_PORT_STAFF) || userRoles.includes(UserRole.UNLOADING_PORT_STAFF) || userRoles.includes(UserRole.DESTINATION_PORT_STAFF) || userRoles.includes(UserRole.OFFICE_STAFF)) {
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

  // 1-Click Instant Login for testing buttons
  const handleQuickLogin = async (user: { id?: string | number; userId?: string; password?: string; name?: string; role?: UserRole; roles?: UserRole[]; designation?: string; clientName?: string }) => {
    setIsLoading(true);
    setErrorMessage(null);
    setIdentifier(user.userId || '');
    setPassword(user.password || 'dpl01234');

    try {
      const authUser = await authenticateDatabaseUser(user.userId || '', user.password || 'dpl01234');
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
      } else if (userRole === UserRole.VENDOR) {
        targetView = 'vendor_portal';
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
        clientName: authUser.clientName || user.clientName || (userRole === UserRole.CLIENT ? authUser.name : 'Client Portal'),
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
            radial-gradient(circle at 50% 10%, rgba(245, 158, 11, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 10% 90%, rgba(37, 99, 235, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 90% 90%, rgba(16, 185, 129, 0.15) 0%, transparent 50%)
          `
        }}
      />

      {/* Top Header with Corporate Identity */}
      <div className="w-full max-w-xl mx-auto flex flex-col items-center text-center pt-2 pb-1 relative z-10">
        <div className="flex items-center justify-center mb-2 transform hover:scale-105 transition-transform duration-300">
          <img 
            src="/logos/mak_group_logo.svg" 
            alt="MAK Group of Companies" 
            className="w-32 sm:w-40 max-h-28 object-contain drop-shadow-[0_4px_24px_rgba(245,158,11,0.35)]" 
          />
        </div>

        {/* Corporate Company Name */}
        <h1 
          className="text-xl sm:text-2xl font-extrabold tracking-wider text-amber-300 uppercase drop-shadow-[0_2px_14px_rgba(245,158,11,0.65)] font-serif px-2"
          style={{ color: '#FCD34D', textShadow: '0 2px 14px rgba(245, 158, 11, 0.65)' }}
        >
          MAK Group of Companies
        </h1>
        <p 
          className="text-[10px] sm:text-[11px] font-bold text-amber-400 tracking-wider uppercase mt-0.5 px-4 max-w-xl leading-relaxed"
          style={{ color: '#FBBF24' }}
        >
          DOCKS (PVT) LTD • MUHIB INTERNATIONAL • VINTAGE SHIPPING LINE • TRUCKIT (PVT) LTD
        </p>

        {/* 4 Mini Subsidiary Badges in Login Header */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2 px-2">
          <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
            Docks (Pvt.) Ltd.
          </span>
          <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/30">
            Muhib International
          </span>
          <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
            Vintage Shipping Line
          </span>
          <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-red-500/10 text-red-300 border border-red-500/30">
            Truckit (Pvt.) Ltd.
          </span>
        </div>
      </div>

      {/* Main Single Login Form Container */}
      <div className="w-full max-w-md mx-auto my-auto py-2 relative z-10 animate-fade-in">
        <div className="bg-slate-900/95 border border-amber-500/30 rounded-3xl p-5 sm:p-7 shadow-2xl backdrop-blur-xl">
          
          {/* Form Header */}
          <div className="text-center mb-4">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto mb-2 shadow-inner">
              {authMode === 'signin' ? <Lock className="text-amber-300" size={22} /> : <UserPlus className="text-amber-300" size={22} />}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-wide">
              {authMode === 'signin' ? 'Sign In' : 'Register as Client'}
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              {authMode === 'signin' 
                ? 'Please enter your User ID and Password' 
                : 'Enter your business details for Finance Manager approval'}
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex rounded-xl bg-slate-950 p-1 mb-4 border border-white/10">
            <button
              type="button"
              onClick={() => { setAuthMode('signin'); setErrorMessage(null); setSuccessMessage(null); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                authMode === 'signin' 
                  ? 'bg-amber-400 text-slate-950 shadow-md font-black' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <LogIn size={13} />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('register'); setErrorMessage(null); setSuccessMessage(null); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                authMode === 'register' 
                  ? 'bg-amber-400 text-slate-950 shadow-md font-black' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <UserPlus size={13} />
              <span>New Client Registration</span>
            </button>
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
            <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <span>{errorMessage}</span>
            </div>
          )}

          {/* In-Progress Draft Resumption Notice */}
          {hasActiveDraft && authMode === 'signin' && (
            <div className="mb-4 p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
              <Clock size={15} className="flex-shrink-0 text-amber-400" />
              <span>An active case registration draft ({draftCaseNo || `Step ${draftStep}`}) will resume upon login.</span>
            </div>
          )}

          {authMode === 'register' ? (
            <form onSubmit={handleClientRegister} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Building size={12} className="text-amber-400" />
                  <span>Company / Importer Name *</span>
                </label>
                <input
                  type="text"
                  required
                  value={clientReg.companyName}
                  onChange={(e) => setClientReg({ ...clientReg, companyName: e.target.value })}
                  placeholder="e.g. Al-Madina Trading Co."
                  className="w-full px-3.5 py-2.5 bg-slate-950/90 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-amber-400 transition"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={clientReg.contactPerson}
                    onChange={(e) => setClientReg({ ...clientReg, contactPerson: e.target.value })}
                    placeholder="e.g. Tariq Mehmood"
                    className="w-full px-3.5 py-2.5 bg-slate-950/90 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-amber-400 transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                    Mobile / Phone *
                  </label>
                  <input
                    type="tel"
                    required
                    value={clientReg.mobileNumber}
                    onChange={(e) => setClientReg({ ...clientReg, mobileNumber: e.target.value })}
                    placeholder="03001234567"
                    className="w-full px-3.5 py-2.5 bg-slate-950/90 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-amber-400 transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={clientReg.email}
                    onChange={(e) => setClientReg({ ...clientReg, email: e.target.value })}
                    placeholder="importer@company.com"
                    className="w-full px-3.5 py-2.5 bg-slate-950/90 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-amber-400 transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                    NTN / STRN
                  </label>
                  <input
                    type="text"
                    value={clientReg.ntn}
                    onChange={(e) => setClientReg({ ...clientReg, ntn: e.target.value })}
                    placeholder="1234567-8"
                    className="w-full px-3.5 py-2.5 bg-slate-950/90 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-amber-400 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                  Office City / Address
                </label>
                <input
                  type="text"
                  value={clientReg.officeAddress}
                  onChange={(e) => setClientReg({ ...clientReg, officeAddress: e.target.value })}
                  placeholder="e.g. Office #104, I.I. Chundrigar Road, Karachi"
                  className="w-full px-3.5 py-2.5 bg-slate-950/90 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-amber-400 transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                  Create Account Password *
                </label>
                <input
                  type="password"
                  required
                  value={clientReg.password}
                  onChange={(e) => setClientReg({ ...clientReg, password: e.target.value })}
                  placeholder="Choose a strong password"
                  className="w-full px-3.5 py-2.5 bg-slate-950/90 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-amber-400 transition"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 px-4 rounded-xl bg-amber-400 hover:bg-yellow-300 active:bg-amber-500 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/30 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Submitting Registration Request...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus size={16} />
                      <span>Submit for Approval</span>
                    </>
                  )}
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-2">
                  Finance Manager approval is required to verify and activate new client accounts.
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={handleCredentialsLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <User size={13} className="text-amber-400" />
                <span>User ID</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  id="login-identifier-input"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g. admin, finance, casemanager"
                  className="w-full px-4 py-3 bg-slate-950/90 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
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
                  className="w-full px-4 py-3 bg-slate-950/90 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              id="btn-submit-credentials"
              disabled={isLoading}
              className="w-full mt-3 py-3.5 px-4 rounded-xl bg-amber-400 hover:bg-yellow-300 active:bg-amber-500 text-slate-950 font-black text-base shadow-xl shadow-amber-500/30 flex items-center justify-center gap-2.5 transition-all duration-200 cursor-pointer disabled:opacity-50 border border-amber-300 select-none"
              style={{
                backgroundColor: '#fbbf24',
                color: '#020617',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#fde047';
                e.currentTarget.style.color = '#020617';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#fbbf24';
                e.currentTarget.style.color = '#020617';
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={19} className="animate-spin text-slate-950 shrink-0" style={{ color: '#020617' }} />
                  <span className="font-extrabold text-slate-950" style={{ color: '#020617' }}>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <LogIn size={19} className="text-slate-950 stroke-[2.5] shrink-0" style={{ color: '#020617' }} />
                  <span className="font-black text-slate-950 text-base tracking-wide" style={{ color: '#020617' }}>Sign In</span>
                </>
              )}
            </button>
          </form>
          )}

          {/* Quick Staff Credentials Reference Guide */}
          <div className="mt-5 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={() => setShowCredentialsGuide(!showCredentialsGuide)}
              className="w-full flex items-center justify-between text-xs text-amber-400/90 hover:text-amber-300 font-semibold cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <HelpCircle size={14} /> Quick Role Login (Testing Mode - Tap to Sign In)
              </span>
              <span className="text-[10px] uppercase tracking-wider">{showCredentialsGuide ? '▲ Hide' : '▼ View Roles'}</span>
            </button>

            {showCredentialsGuide && (
              <div className="mt-3 space-y-2 text-[11px] animate-fade-in max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1.5">
                  <span>Universal Password: <strong className="text-amber-300 font-mono">dpl01234</strong></span>
                  <span className="text-emerald-400 font-semibold">⚡ Tap Any Role to Login</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {TESTING_ROLE_ACCOUNTS.map((u, idx) => (
                    <button
                      key={`cred_guide_${u.id || u.userId || idx}_${idx}`}
                      type="button"
                      disabled={isLoading}
                      onClick={() => handleQuickLogin(u)}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-amber-500/15 border border-white/10 hover:border-amber-500/40 text-left transition cursor-pointer group flex flex-col justify-between"
                      title={`Instant 1-Click Login as ${u.name}`}
                    >
                      <div className="font-bold text-gray-200 group-hover:text-amber-300 text-xs truncate">
                        {u.name}
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px]">
                        <span className="text-amber-400 font-mono">ID: {u.userId}</span>
                        <span className="text-emerald-400 font-semibold opacity-80 group-hover:opacity-100">Login ➔</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Info Notice */}
      <div className="w-full max-w-xl mx-auto pt-4 pb-2 text-center text-[11px] text-gray-500 relative z-10 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-white/5">
        <div className="flex items-center gap-2 text-emerald-400/80">
          <ShieldCheck size={14} className="text-emerald-400" />
          <span>Authorized Access • Encrypted Session</span>
        </div>
        <div className="flex items-center gap-3 text-gray-400">
          <a
            href="/pwa-512x512-v2.png"
            download="docks-app-icon-512x512.png"
            className="text-amber-400/90 hover:text-amber-300 underline flex items-center gap-1 cursor-pointer transition"
            title="Download high-resolution 512x512 icon for Google Play Store & PWABuilder"
          >
            📥 Download App Icon (512×512)
          </a>
          <span>•</span>
          <span>DOCKS (PVT) LTD. Cloud</span>
        </div>
      </div>
    </div>
  );
};

export default LoginModeSelection;

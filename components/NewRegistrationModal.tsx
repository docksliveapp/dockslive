import React, { useState } from 'react';
import { 
  Building, 
  Truck, 
  ArrowLeft, 
  CheckCircle2, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  X, 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Lock, 
  ShieldCheck, 
  Loader2, 
  Sparkles,
  FileText
} from 'lucide-react';
import { UserRole } from '../types';
import { saveClientToFirestore, saveUserToFirestore } from '../services/dbService';
import { sendAppNotification } from '../services/notificationService';

interface NewRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewRegistrationModal: React.FC<NewRegistrationModalProps> = ({
  isOpen,
  onClose
}) => {
  const [selectedType, setSelectedType] = useState<'client' | 'transporter' | null>(null);

  // Client Form State
  const [clientForm, setClientForm] = useState({
    companyName: '',
    contactPerson: '',
    phone: '',
    email: '',
    ntn: '',
    address: '',
    password: ''
  });

  // Transporter Form State
  const [transporterForm, setTransporterForm] = useState({
    transportName: '',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    fleetType: '20ft & 40ft Trailers / Flatbeds',
    fleetCount: '',
    password: ''
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submittedDetails, setSubmittedDetails] = useState<{
    name: string;
    phone: string;
    type: 'client' | 'transporter';
  } | null>(null);

  if (!isOpen) return null;

  const handleReset = () => {
    setSelectedType(null);
    setIsSuccess(false);
    setErrorMessage(null);
    setSubmittedDetails(null);
    setClientForm({
      companyName: '',
      contactPerson: '',
      phone: '',
      email: '',
      ntn: '',
      address: '',
      password: ''
    });
    setTransporterForm({
      transportName: '',
      ownerName: '',
      phone: '',
      email: '',
      address: '',
      fleetType: '20ft & 40ft Trailers / Flatbeds',
      fleetCount: '',
      password: ''
    });
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  // Submit Client Registration
  const handleSubmitClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanCompany = clientForm.companyName.trim();
    const cleanPerson = clientForm.contactPerson.trim();
    const cleanPhone = clientForm.phone.trim();
    const cleanPass = clientForm.password.trim();

    if (!cleanCompany || !cleanPerson || !cleanPhone || !cleanPass) {
      setErrorMessage('Please fill in all mandatory fields.');
      return;
    }

    setIsSubmitting(true);
    try {
      const clientId = `client_${Date.now()}`;
      const userId = cleanPhone.replace(/[^0-9]/g, '') || cleanPhone;

      // 1. Save Client Record
      await saveClientToFirestore({
        id: clientId,
        name: cleanCompany,
        ownerName: cleanPerson,
        contact: cleanPhone,
        mobileNumber: cleanPhone,
        email: clientForm.email.trim(),
        ntn: clientForm.ntn.trim(),
        officeAddress: clientForm.address.trim(),
        status: 'PENDING_APPROVAL' as any
      });

      // 2. Save User Account for Credentials Login
      const newUserIdNum = Date.now() % 10000000;
      await saveUserToFirestore({
        id: newUserIdNum,
        userId: userId,
        password: cleanPass,
        name: cleanPerson,
        clientName: cleanCompany,
        role: UserRole.CLIENT,
        roles: [UserRole.CLIENT],
        designation: 'Corporate Importer / Client',
        contact: cleanPhone,
        email: clientForm.email.trim(),
        status: 'PENDING_APPROVAL',
        authProvider: 'database'
      });

      // 3. Notify Admins
      await sendAppNotification({
        title: 'New Client Registration Request',
        description: `${cleanCompany} (${cleanPerson}, ${cleanPhone}) has submitted a registration request for approval.`,
        type: 'ALERT',
        targetRole: UserRole.ADMIN,
        priority: 'HIGH',
        approvalData: {
          entityType: 'client',
          entityId: clientId,
          entityName: cleanCompany,
          actionType: 'APPROVE_CLIENT',
          requestedBy: cleanPerson
        }
      });

      setSubmittedDetails({
        name: cleanCompany,
        phone: cleanPhone,
        type: 'client'
      });
      setIsSuccess(true);
    } catch (err: any) {
      console.error('Client registration failed:', err);
      setErrorMessage(err?.message || 'Could not submit registration. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Transporter Registration
  const handleSubmitTransporter = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanTransport = transporterForm.transportName.trim();
    const cleanOwner = transporterForm.ownerName.trim();
    const cleanPhone = transporterForm.phone.trim();
    const cleanPass = transporterForm.password.trim();

    if (!cleanTransport || !cleanOwner || !cleanPhone || !cleanPass) {
      setErrorMessage('Please fill in all mandatory fields.');
      return;
    }

    setIsSubmitting(true);
    try {
      const userId = cleanPhone.replace(/[^0-9]/g, '') || cleanPhone;
      const newUserIdNum = Date.now() % 10000000;

      // Save User Account with Transporter Role and Pending Status
      await saveUserToFirestore({
        id: newUserIdNum,
        userId: userId,
        password: cleanPass,
        name: cleanOwner,
        clientName: cleanTransport,
        role: UserRole.TRANSPORTER,
        roles: [UserRole.TRANSPORTER],
        designation: `Transporter / Fleet Partner (${transporterForm.fleetType})`,
        contact: cleanPhone,
        email: transporterForm.email.trim(),
        status: 'PENDING_APPROVAL',
        authProvider: 'database'
      });

      // Notify Admins
      await sendAppNotification({
        title: 'New Transporter Registration Request',
        description: `${cleanTransport} (${cleanOwner}, ${cleanPhone}) has registered their fleet for approval.`,
        type: 'ALERT',
        targetRole: UserRole.ADMIN,
        priority: 'HIGH',
        approvalData: {
          entityType: 'transporter',
          entityId: String(newUserIdNum),
          entityName: cleanTransport,
          actionType: 'APPROVE_TRANSPORTER',
          requestedBy: cleanOwner
        }
      });

      setSubmittedDetails({
        name: cleanTransport,
        phone: cleanPhone,
        type: 'transporter'
      });
      setIsSuccess(true);
    } catch (err: any) {
      console.error('Transporter registration failed:', err);
      setErrorMessage(err?.message || 'Could not submit registration. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md overflow-y-auto animate-fade-in">
      <div 
        className="relative w-full max-w-xl bg-slate-900 border border-amber-500/40 rounded-3xl shadow-[0_0_50px_rgba(245,158,11,0.2)] overflow-hidden my-auto text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-950/60 via-slate-900 to-slate-950 px-6 py-4 border-b border-amber-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedType && !isSuccess && (
              <button
                type="button"
                onClick={() => { setSelectedType(null); setErrorMessage(null); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition cursor-pointer"
                title="Back to options"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="text-amber-400" size={18} />
                <span>Enterprise Account Registration</span>
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {selectedType === 'client' 
                  ? 'Corporate Client & Importer Account Request'
                  : selectedType === 'transporter'
                  ? 'Transporter & Fleet Operator Account Request'
                  : 'Select your account category to register'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-xl text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
          {errorMessage && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* SUCCESS RECEIPT STATE */}
          {isSuccess && submittedDetails ? (
            <div className="text-center py-6 px-3 space-y-5 animate-scale-up">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
                <CheckCircle2 size={36} />
              </div>

              <div>
                <h4 className="text-xl font-bold text-white">
                  Registration Request Submitted!
                </h4>
                <p className="text-xs text-emerald-400 font-semibold mt-1">
                  Awaiting Central Administration Verification
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-black/40 border border-white/10 text-xs text-left space-y-2 max-w-md mx-auto">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-gray-400">Account Type:</span>
                  <span className="font-bold text-white capitalize">
                    {submittedDetails.type === 'client' ? 'Corporate Client / Importer' : 'Transporter / Fleet Partner'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-gray-400">Company Name:</span>
                  <span className="font-bold text-white">{submittedDetails.name}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-gray-400">Login User ID (Phone):</span>
                  <span className="font-mono font-bold text-amber-300">{submittedDetails.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Status:</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    PENDING ADMIN APPROVAL
                  </span>
                </div>
              </div>

              <p className="text-xs text-gray-300 max-w-md mx-auto leading-relaxed">
                Your registration request has been submitted to the System Administrator for verification. Upon administrative review and approval, your account login will be activated with your registered phone number and chosen password.
              </p>

              <button
                type="button"
                onClick={handleClose}
                className="w-full sm:w-auto px-8 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg transition cursor-pointer"
              >
                Back to Sign In
              </button>
            </div>
          ) : selectedType === null ? (
            /* STEP 1: CHOOSE REGISTRATION TYPE */
            <div className="space-y-4 py-2">
              <p className="text-xs text-gray-300 text-center mb-4">
                Please select how you wish to register with MAK Group of Companies:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Option 1: Transporter */}
                <div
                  onClick={() => setSelectedType('transporter')}
                  className="group relative p-5 rounded-2xl bg-gradient-to-b from-slate-950/90 to-slate-900 border border-amber-500/30 hover:border-amber-400 hover:shadow-[0_0_30px_rgba(245,158,11,0.25)] transition-all cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                      <Truck size={24} />
                    </div>
                    <h4 className="text-base font-bold text-white group-hover:text-amber-300 transition-colors">
                      Transporter / Fleet
                    </h4>
                    <p className="text-xs text-amber-400 font-medium mt-0.5">
                      Commercial Fleet Operator &amp; Haulage Partner
                    </p>
                    <p className="text-xs text-gray-400 mt-2.5 leading-relaxed">
                      For goods transport companies, trailer owners &amp; logistics operators to receive container assignments and diesel/trip vouchers.
                    </p>
                  </div>

                  <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-xs text-amber-400 font-bold">
                    <span>Register Fleet ➔</span>
                  </div>
                </div>

                {/* Option 2: Client */}
                <div
                  onClick={() => setSelectedType('client')}
                  className="group relative p-5 rounded-2xl bg-gradient-to-b from-slate-950/90 to-slate-900 border border-blue-500/30 hover:border-blue-400 hover:shadow-[0_0_30px_rgba(37,99,235,0.25)] transition-all cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="w-12 h-12 rounded-xl bg-blue-500/20 border border-blue-500/40 text-blue-400 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                      <Building size={24} />
                    </div>
                    <h4 className="text-base font-bold text-white group-hover:text-blue-300 transition-colors">
                      Corporate Client / Importer
                    </h4>
                    <p className="text-xs text-blue-400 font-medium mt-0.5">
                      Commercial Importer, Exporter &amp; Clearing Client
                    </p>
                    <p className="text-xs text-gray-400 mt-2.5 leading-relaxed">
                      For importers, exporters &amp; clearing clients to track live customs transit cases, access financial ledgers, and view invoices.
                    </p>
                  </div>

                  <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-xs text-blue-400 font-bold">
                    <span>Register Importer ➔</span>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedType === 'client' ? (
            /* STEP 2A: CLIENT FORM */
            <form onSubmit={handleSubmitClient} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Company / Importer Trade Name *</label>
                <input
                  type="text"
                  required
                  value={clientForm.companyName}
                  onChange={(e) => setClientForm({ ...clientForm, companyName: e.target.value })}
                  placeholder="e.g. Al-Khaleej Importers &amp; Shipping Lines"
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Contact Person Name *</label>
                  <input
                    type="text"
                    required
                    value={clientForm.contactPerson}
                    onChange={(e) => setClientForm({ ...clientForm, contactPerson: e.target.value })}
                    placeholder="e.g. Tariq Mehmood"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Mobile / WhatsApp Number *</label>
                  <input
                    type="tel"
                    required
                    value={clientForm.phone}
                    onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                    placeholder="03001234567"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                  />
                  <span className="text-[10px] text-gray-400">Used as your Login User ID</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={clientForm.email}
                    onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                    placeholder="info@company.com"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">NTN / STRN</label>
                  <input
                    type="text"
                    value={clientForm.ntn}
                    onChange={(e) => setClientForm({ ...clientForm, ntn: e.target.value })}
                    placeholder="1234567-8"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Office / City Address</label>
                <input
                  type="text"
                  value={clientForm.address}
                  onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })}
                  placeholder="e.g. Office #104, I.I. Chundrigar Road, Karachi"
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Create Account Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={clientForm.password}
                    onChange={(e) => setClientForm({ ...clientForm, password: e.target.value })}
                    placeholder="Choose a secure password"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white pr-9 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Sending Registration Request...</span>
                    </>
                  ) : (
                    <span>Submit for Admin Approval</span>
                  )}
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-2">
                  Administrator verification is required before login activation.
                </p>
              </div>
            </form>
          ) : (
            /* STEP 2B: TRANSPORTER FORM */
            <form onSubmit={handleSubmitTransporter} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Goods Transport / Fleet Company Name *</label>
                <input
                  type="text"
                  required
                  value={transporterForm.transportName}
                  onChange={(e) => setTransporterForm({ ...transporterForm, transportName: e.target.value })}
                  placeholder="e.g. Bilal Goods Transport Co."
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Owner / Transporter Name *</label>
                  <input
                    type="text"
                    required
                    value={transporterForm.ownerName}
                    onChange={(e) => setTransporterForm({ ...transporterForm, ownerName: e.target.value })}
                    placeholder="e.g. Haji Muhammad Bilal"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Mobile / WhatsApp Number *</label>
                  <input
                    type="tel"
                    required
                    value={transporterForm.phone}
                    onChange={(e) => setTransporterForm({ ...transporterForm, phone: e.target.value })}
                    placeholder="03008889999"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                  />
                  <span className="text-[10px] text-gray-400">Used as your Login User ID</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Primary Fleet Type</label>
                  <select
                    value={transporterForm.fleetType}
                    onChange={(e) => setTransporterForm({ ...transporterForm, fleetType: e.target.value })}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  >
                    <option value="20ft & 40ft Trailers / Flatbeds">20ft &amp; 40ft Trailers / Flatbeds</option>
                    <option value="Multi-Axle Heavy Trailers">Multi-Axle Heavy Trailers</option>
                    <option value="Container Semi-Trailers">Container Semi-Trailers</option>
                    <option value="Lowbed & Heavy Machinery Carriers">Lowbed &amp; Heavy Machinery Carriers</option>
                    <option value="6-Wheeler Trucks & Mazdas">6-Wheeler Trucks &amp; Mazdas</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Approximate Fleet Size</label>
                  <input
                    type="text"
                    value={transporterForm.fleetCount}
                    onChange={(e) => setTransporterForm({ ...transporterForm, fleetCount: e.target.value })}
                    placeholder="e.g. 15 Trailers"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={transporterForm.email}
                    onChange={(e) => setTransporterForm({ ...transporterForm, email: e.target.value })}
                    placeholder="transport@company.com"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Base Terminal / City Address</label>
                  <input
                    type="text"
                    value={transporterForm.address}
                    onChange={(e) => setTransporterForm({ ...transporterForm, address: e.target.value })}
                    placeholder="e.g. Mauripur Road Truck Stand, Karachi"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Create Account Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={transporterForm.password}
                    onChange={(e) => setTransporterForm({ ...transporterForm, password: e.target.value })}
                    placeholder="Choose a secure password"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white pr-9 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Sending Registration Request...</span>
                    </>
                  ) : (
                    <span>Submit for Admin Approval</span>
                  )}
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-2">
                  Administrator verification is required before fleet assignment activation.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

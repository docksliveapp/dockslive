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
  FileText,
  Upload,
  Trash2,
  Paperclip,
  FileCheck,
  CreditCard,
  Check
} from 'lucide-react';
import { UserRole } from '../types';
import { saveClientToFirestore, saveUserToFirestore } from '../services/dbService';
import { sendAppNotification } from '../services/notificationService';
import { compressAndPrepareFile } from '../services/fileUtils';
import { useAppTheme } from './ThemeToggleSwitch';

interface NewRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewRegistrationModal: React.FC<NewRegistrationModalProps> = ({
  isOpen,
  onClose
}) => {
  const [appTheme] = useAppTheme();
  const isPearl = appTheme === 'pearl';
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

  // Client Documents State
  const [clientDocs, setClientDocs] = useState({
    ntnDocUrl: '',
    ntnDocName: '',
    cnicFrontUrl: '',
    cnicFrontName: '',
    cnicBackUrl: '',
    cnicBackName: '',
    businessCardUrl: '',
    businessCardName: ''
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

  // Transporter Documents State
  const [transporterDocs, setTransporterDocs] = useState({
    cnicFrontUrl: '',
    cnicFrontName: '',
    cnicBackUrl: '',
    cnicBackName: '',
    ntnDocUrl: '',
    ntnDocName: '',
    businessCardUrl: '',
    businessCardName: ''
  });

  const [uploadingDocKey, setUploadingDocKey] = useState<string | null>(null);

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submittedDetails, setSubmittedDetails] = useState<{
    name: string;
    phone: string;
    type: 'client' | 'transporter';
  } | null>(null);

  const handleDocUpload = async (
    file: File,
    formType: 'client' | 'transporter',
    docKey: 'ntn' | 'cnicFront' | 'cnicBack' | 'businessCard'
  ) => {
    const keyId = `${formType}_${docKey}`;
    setUploadingDocKey(keyId);
    try {
      const processed = await compressAndPrepareFile(file);
      const url = processed.dataUrl || (processed.base64 ? `data:${processed.type};base64,${processed.base64}` : '');
      const name = processed.name || file.name;

      if (formType === 'client') {
        setClientDocs(prev => ({
          ...prev,
          ...(docKey === 'ntn' && { ntnDocUrl: url, ntnDocName: name }),
          ...(docKey === 'cnicFront' && { cnicFrontUrl: url, cnicFrontName: name }),
          ...(docKey === 'cnicBack' && { cnicBackUrl: url, cnicBackName: name }),
          ...(docKey === 'businessCard' && { businessCardUrl: url, businessCardName: name }),
        }));
      } else {
        setTransporterDocs(prev => ({
          ...prev,
          ...(docKey === 'ntn' && { ntnDocUrl: url, ntnDocName: name }),
          ...(docKey === 'cnicFront' && { cnicFrontUrl: url, cnicFrontName: name }),
          ...(docKey === 'cnicBack' && { cnicBackUrl: url, cnicBackName: name }),
          ...(docKey === 'businessCard' && { businessCardUrl: url, businessCardName: name }),
        }));
      }
    } catch (err) {
      console.warn('Document processing warning:', err);
    } finally {
      setUploadingDocKey(null);
    }
  };

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
    setClientDocs({
      ntnDocUrl: '',
      ntnDocName: '',
      cnicFrontUrl: '',
      cnicFrontName: '',
      cnicBackUrl: '',
      cnicBackName: '',
      businessCardUrl: '',
      businessCardName: ''
    });
    setTransporterDocs({
      cnicFrontUrl: '',
      cnicFrontName: '',
      cnicBackUrl: '',
      cnicBackName: '',
      ntnDocUrl: '',
      ntnDocName: '',
      businessCardUrl: '',
      businessCardName: ''
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

      // 1. Save Client Record (with persistent verification docs)
      await saveClientToFirestore({
        id: clientId,
        name: cleanCompany,
        ownerName: cleanPerson,
        contact: cleanPhone,
        mobileNumber: cleanPhone,
        email: clientForm.email.trim(),
        ntn: clientForm.ntn.trim(),
        officeAddress: clientForm.address.trim(),
        status: 'PENDING_APPROVAL' as any,
        businessCardUrl: clientDocs.businessCardUrl,
        businessCardName: clientDocs.businessCardName,
        nicDocUrl: clientDocs.cnicFrontUrl,
        nicDocName: clientDocs.cnicFrontName,
        cnicFrontUrl: clientDocs.cnicFrontUrl,
        cnicFrontName: clientDocs.cnicFrontName,
        cnicBackUrl: clientDocs.cnicBackUrl,
        cnicBackName: clientDocs.cnicBackName,
        ntnDocUrl: clientDocs.ntnDocUrl,
        ntnDocName: clientDocs.ntnDocName
      });

      // 2. Save User Account for Credentials Login (Auto-assign CLIENT role + persistent docs)
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
        authProvider: 'database',
        cnicDoc: clientDocs.cnicFrontUrl,
        cnicFront: clientDocs.cnicFrontUrl,
        cnicBack: clientDocs.cnicBackUrl,
        ntnDoc: clientDocs.ntnDocUrl,
        businessCard: clientDocs.businessCardUrl
      });

      // 3. Notify Admins
      await sendAppNotification({
        title: 'New Client Registration Request',
        description: `${cleanCompany} (${cleanPerson}, ${cleanPhone}) has submitted a registration request with verification documents for approval.`,
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

      // Save User Account (Auto-assign TRANSPORTER role + persistent docs)
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
        authProvider: 'database',
        cnicDoc: transporterDocs.cnicFrontUrl,
        cnicFront: transporterDocs.cnicFrontUrl,
        cnicBack: transporterDocs.cnicBackUrl,
        ntnDoc: transporterDocs.ntnDocUrl,
        businessCard: transporterDocs.businessCardUrl
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
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 backdrop-blur-md overflow-hidden animate-fade-in ${
      isPearl ? 'bg-slate-900/45' : 'bg-black/80'
    }`}>
      <div 
        className={`relative w-full max-w-xl rounded-3xl max-h-[92vh] flex flex-col overflow-hidden text-left transition-colors ${
          isPearl
            ? 'bg-white border border-slate-200/90 text-slate-900 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.18)] ring-1 ring-slate-100'
            : 'bg-[#121620] border border-white/12 text-white shadow-[0_24px_60px_rgba(0,0,0,0.75)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 sm:px-6 py-4 border-b flex items-center justify-between shrink-0 ${
          isPearl
            ? 'bg-slate-50/90 border-slate-200/90'
            : 'bg-[#161B26] border-white/10'
        }`}>
          <div className="flex items-center gap-3">
            {selectedType && !isSuccess && (
              <button
                type="button"
                onClick={() => { setSelectedType(null); setErrorMessage(null); }}
                className={`p-1.5 rounded-xl border transition cursor-pointer ${
                  isPearl
                    ? 'text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border-slate-200'
                    : 'text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border-white/10'
                }`}
                title="Back to options"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div className="flex items-center gap-2.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                isPearl
                  ? 'bg-amber-50 border-amber-200 text-amber-600'
                  : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              }`}>
                <Sparkles size={17} />
              </div>
              <div>
                <h3 className={`text-base sm:text-lg font-bold tracking-tight ${
                  isPearl ? 'text-slate-900' : 'text-white'
                }`}>
                  Enterprise Account Registration
                </h3>
                <p className={`text-[11px] mt-0.5 ${
                  isPearl ? 'text-slate-500' : 'text-gray-400'
                }`}>
                  {selectedType === 'client' 
                    ? 'Corporate Client & Importer Account Request'
                    : selectedType === 'transporter'
                    ? 'Transporter & Fleet Operator Account Request'
                    : 'Select your account category to register'}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              isPearl
                ? 'text-slate-500 hover:text-slate-900 bg-white hover:bg-slate-100 border-slate-200'
                : 'text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border-white/10'
            }`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar flex-1 min-h-0 overscroll-contain">
          {errorMessage && (
            <div className={`mb-4 p-3 rounded-xl border text-xs flex items-center gap-2 ${
              isPearl
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-red-500/20 border-red-500/40 text-red-300'
            }`}>
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* SUCCESS RECEIPT STATE */}
          {isSuccess && submittedDetails ? (
            <div className="text-center py-6 px-3 space-y-5 animate-scale-up">
              <div className={`w-16 h-16 rounded-full border-2 flex items-center justify-center mx-auto shadow-md ${
                isPearl
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-600'
                  : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
              }`}>
                <CheckCircle2 size={36} />
              </div>

              <div>
                <h4 className={`text-xl font-bold ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                  Registration Request Submitted!
                </h4>
                <p className={`text-xs font-semibold mt-1 ${isPearl ? 'text-emerald-700' : 'text-emerald-400'}`}>
                  Awaiting Central Administration Verification
                </p>
              </div>

              <div className={`p-4 rounded-2xl border text-xs text-left space-y-2.5 max-w-md mx-auto ${
                isPearl
                  ? 'bg-slate-50 border-slate-200 text-slate-700'
                  : 'bg-black/40 border-white/10 text-gray-300'
              }`}>
                <div className={`flex justify-between border-b pb-2 ${isPearl ? 'border-slate-200' : 'border-white/5'}`}>
                  <span className={isPearl ? 'text-slate-500' : 'text-gray-400'}>Account Type:</span>
                  <span className={`font-bold capitalize ${isPearl ? 'text-slate-900' : 'text-white'}`}>
                    {submittedDetails.type === 'client' ? 'Corporate Client / Importer' : 'Transporter / Fleet Partner'}
                  </span>
                </div>
                <div className={`flex justify-between border-b pb-2 ${isPearl ? 'border-slate-200' : 'border-white/5'}`}>
                  <span className={isPearl ? 'text-slate-500' : 'text-gray-400'}>Company Name:</span>
                  <span className={`font-bold ${isPearl ? 'text-slate-900' : 'text-white'}`}>{submittedDetails.name}</span>
                </div>
                <div className={`flex justify-between border-b pb-2 ${isPearl ? 'border-slate-200' : 'border-white/5'}`}>
                  <span className={isPearl ? 'text-slate-500' : 'text-gray-400'}>Login User ID (Phone):</span>
                  <span className={`font-mono font-bold ${isPearl ? 'text-amber-700' : 'text-amber-300'}`}>{submittedDetails.phone}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={isPearl ? 'text-slate-500' : 'text-gray-400'}>Status:</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                    isPearl
                      ? 'bg-amber-50 text-amber-800 border-amber-300'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}>
                    PENDING ADMIN APPROVAL
                  </span>
                </div>
              </div>

              <p className={`text-xs max-w-md mx-auto leading-relaxed ${
                isPearl ? 'text-slate-600' : 'text-gray-300'
              }`}>
                Your registration request has been submitted to the System Administrator for verification. Upon administrative review and approval, your account login will be activated with your registered phone number and chosen password.
              </p>

              <button
                type="button"
                onClick={handleClose}
                className={`w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-wider shadow-md transition cursor-pointer ${
                  isPearl
                    ? 'btn-charcoal-primary text-white'
                    : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950'
                }`}
              >
                Back to Sign In
              </button>
            </div>
          ) : selectedType === null ? (
            /* STEP 1: CHOOSE REGISTRATION TYPE */
            <div className="space-y-4 py-1">
              <p className={`text-xs text-center mb-3 font-medium ${
                isPearl ? 'text-slate-600' : 'text-gray-300'
              }`}>
                Please select how you wish to register with MAK Group of Companies:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Option 1: Transporter */}
                <div
                  onClick={() => setSelectedType('transporter')}
                  className={`group relative p-5 rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                    isPearl
                      ? 'bg-white hover:bg-amber-50/40 border-slate-200 hover:border-amber-400 shadow-sm hover:shadow-md'
                      : 'bg-[#161B26] hover:bg-[#1B2230] border-amber-500/30 hover:border-amber-400 shadow-lg'
                  }`}
                >
                  <div>
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-3.5 group-hover:scale-105 transition-transform ${
                      isPearl
                        ? 'bg-amber-50 border-amber-200 text-amber-600'
                        : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                    }`}>
                      <Truck size={24} />
                    </div>
                    <h4 className={`text-base font-bold transition-colors ${
                      isPearl
                        ? 'text-slate-900 group-hover:text-amber-800'
                        : 'text-white group-hover:text-amber-300'
                    }`}>
                      Transporter / Fleet
                    </h4>
                    <p className={`text-xs font-semibold mt-0.5 ${
                      isPearl ? 'text-amber-700' : 'text-amber-400'
                    }`}>
                      Commercial Fleet Operator &amp; Haulage Partner
                    </p>
                    <p className={`text-xs mt-2.5 leading-relaxed ${
                      isPearl ? 'text-slate-600' : 'text-gray-400'
                    }`}>
                      For goods transport companies, trailer owners &amp; logistics operators to receive container assignments and diesel/trip vouchers.
                    </p>
                  </div>

                  <div className={`mt-5 pt-3 border-t flex items-center justify-between text-xs font-bold ${
                    isPearl
                      ? 'border-slate-200 text-amber-700 group-hover:text-amber-800'
                      : 'border-white/10 text-amber-400'
                  }`}>
                    <span>Register Fleet ➔</span>
                  </div>
                </div>

                {/* Option 2: Client */}
                <div
                  onClick={() => setSelectedType('client')}
                  className={`group relative p-5 rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                    isPearl
                      ? 'bg-white hover:bg-sky-50/40 border-slate-200 hover:border-sky-400 shadow-sm hover:shadow-md'
                      : 'bg-[#161B26] hover:bg-[#1B2230] border-blue-500/30 hover:border-blue-400 shadow-lg'
                  }`}
                >
                  <div>
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-3.5 group-hover:scale-105 transition-transform ${
                      isPearl
                        ? 'bg-sky-50 border-sky-200 text-sky-600'
                        : 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                    }`}>
                      <Building size={24} />
                    </div>
                    <h4 className={`text-base font-bold transition-colors ${
                      isPearl
                        ? 'text-slate-900 group-hover:text-sky-800'
                        : 'text-white group-hover:text-blue-300'
                    }`}>
                      Corporate Client / Importer
                    </h4>
                    <p className={`text-xs font-semibold mt-0.5 ${
                      isPearl ? 'text-sky-700' : 'text-blue-400'
                    }`}>
                      Commercial Importer, Exporter &amp; Clearing Client
                    </p>
                    <p className={`text-xs mt-2.5 leading-relaxed ${
                      isPearl ? 'text-slate-600' : 'text-gray-400'
                    }`}>
                      For importers, exporters &amp; clearing clients to track live customs transit cases, access financial ledgers, and view invoices.
                    </p>
                  </div>

                  <div className={`mt-5 pt-3 border-t flex items-center justify-between text-xs font-bold ${
                    isPearl
                      ? 'border-slate-200 text-sky-700 group-hover:text-sky-800'
                      : 'border-white/10 text-blue-400'
                  }`}>
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

              {/* Company & Owner Verification Documents */}
              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                    <FileText size={14} className="text-amber-400" />
                    <span>Upload Verification Documents</span>
                  </label>
                  <span className="text-[10px] text-gray-400 font-mono">Images &amp; PDF</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* 1. NTN / STRN Certificate */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1">
                        <FileCheck size={13} className="text-amber-400" /> NTN Certificate
                      </span>
                      {clientDocs.ntnDocUrl && (
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-0.5">
                          <Check size={10} /> Attached
                        </span>
                      )}
                    </div>
                    {clientDocs.ntnDocUrl ? (
                      <div className="flex items-center justify-between gap-1 text-[11px] bg-white/5 p-1.5 rounded-lg border border-white/10">
                        <span className="truncate text-slate-200 font-mono text-[10px]">{clientDocs.ntnDocName || 'ntn_doc'}</span>
                        <button
                          type="button"
                          onClick={() => setClientDocs(prev => ({ ...prev, ntnDocUrl: '', ntnDocName: '' }))}
                          className="text-red-400 hover:text-red-300 p-0.5 cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-dashed border-white/20 hover:border-amber-400 bg-white/5 hover:bg-white/10 cursor-pointer text-[11px] text-gray-300 hover:text-white transition">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocUpload(f, 'client', 'ntn');
                          }}
                        />
                        {uploadingDocKey === 'client_ntn' ? (
                          <Loader2 size={12} className="animate-spin text-amber-400" />
                        ) : (
                          <Upload size={12} className="text-amber-400" />
                        )}
                        <span>Upload NTN</span>
                      </label>
                    )}
                  </div>

                  {/* 2. Business Card / Visiting Card */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1">
                        <CreditCard size={13} className="text-amber-400" /> Business Card
                      </span>
                      {clientDocs.businessCardUrl && (
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-0.5">
                          <Check size={10} /> Attached
                        </span>
                      )}
                    </div>
                    {clientDocs.businessCardUrl ? (
                      <div className="flex items-center justify-between gap-1 text-[11px] bg-white/5 p-1.5 rounded-lg border border-white/10">
                        <span className="truncate text-slate-200 font-mono text-[10px]">{clientDocs.businessCardName || 'business_card'}</span>
                        <button
                          type="button"
                          onClick={() => setClientDocs(prev => ({ ...prev, businessCardUrl: '', businessCardName: '' }))}
                          className="text-red-400 hover:text-red-300 p-0.5 cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-dashed border-white/20 hover:border-amber-400 bg-white/5 hover:bg-white/10 cursor-pointer text-[11px] text-gray-300 hover:text-white transition">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocUpload(f, 'client', 'businessCard');
                          }}
                        />
                        {uploadingDocKey === 'client_businessCard' ? (
                          <Loader2 size={12} className="animate-spin text-amber-400" />
                        ) : (
                          <Upload size={12} className="text-amber-400" />
                        )}
                        <span>Upload Card</span>
                      </label>
                    )}
                  </div>

                  {/* 3. Owner NIC / CNIC Front */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1">
                        <ShieldCheck size={13} className="text-amber-400" /> Owner CNIC Front
                      </span>
                      {clientDocs.cnicFrontUrl && (
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-0.5">
                          <Check size={10} /> Attached
                        </span>
                      )}
                    </div>
                    {clientDocs.cnicFrontUrl ? (
                      <div className="flex items-center justify-between gap-1 text-[11px] bg-white/5 p-1.5 rounded-lg border border-white/10">
                        <span className="truncate text-slate-200 font-mono text-[10px]">{clientDocs.cnicFrontName || 'cnic_front'}</span>
                        <button
                          type="button"
                          onClick={() => setClientDocs(prev => ({ ...prev, cnicFrontUrl: '', cnicFrontName: '' }))}
                          className="text-red-400 hover:text-red-300 p-0.5 cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-dashed border-white/20 hover:border-amber-400 bg-white/5 hover:bg-white/10 cursor-pointer text-[11px] text-gray-300 hover:text-white transition">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocUpload(f, 'client', 'cnicFront');
                          }}
                        />
                        {uploadingDocKey === 'client_cnicFront' ? (
                          <Loader2 size={12} className="animate-spin text-amber-400" />
                        ) : (
                          <Upload size={12} className="text-amber-400" />
                        )}
                        <span>Upload CNIC Front</span>
                      </label>
                    )}
                  </div>

                  {/* 4. Owner NIC / CNIC Back */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1">
                        <ShieldCheck size={13} className="text-amber-400" /> Owner CNIC Back
                      </span>
                      {clientDocs.cnicBackUrl && (
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-0.5">
                          <Check size={10} /> Attached
                        </span>
                      )}
                    </div>
                    {clientDocs.cnicBackUrl ? (
                      <div className="flex items-center justify-between gap-1 text-[11px] bg-white/5 p-1.5 rounded-lg border border-white/10">
                        <span className="truncate text-slate-200 font-mono text-[10px]">{clientDocs.cnicBackName || 'cnic_back'}</span>
                        <button
                          type="button"
                          onClick={() => setClientDocs(prev => ({ ...prev, cnicBackUrl: '', cnicBackName: '' }))}
                          className="text-red-400 hover:text-red-300 p-0.5 cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-dashed border-white/20 hover:border-amber-400 bg-white/5 hover:bg-white/10 cursor-pointer text-[11px] text-gray-300 hover:text-white transition">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocUpload(f, 'client', 'cnicBack');
                          }}
                        />
                        {uploadingDocKey === 'client_cnicBack' ? (
                          <Loader2 size={12} className="animate-spin text-amber-400" />
                        ) : (
                          <Upload size={12} className="text-amber-400" />
                        )}
                        <span>Upload CNIC Back</span>
                      </label>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 ${
                    isPearl
                      ? 'btn-charcoal-primary text-white'
                      : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950'
                  }`}
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

              {/* Fleet & Transporter Verification Documents */}
              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                    <FileText size={14} className="text-amber-400" />
                    <span>Transporter &amp; Fleet Verification Documents</span>
                  </label>
                  <span className="text-[10px] text-gray-400 font-mono">Images &amp; PDF</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* 1. Owner NIC / CNIC Front */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1">
                        <ShieldCheck size={13} className="text-amber-400" /> Owner CNIC Front
                      </span>
                      {transporterDocs.cnicFrontUrl && (
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-0.5">
                          <Check size={10} /> Attached
                        </span>
                      )}
                    </div>
                    {transporterDocs.cnicFrontUrl ? (
                      <div className="flex items-center justify-between gap-1 text-[11px] bg-white/5 p-1.5 rounded-lg border border-white/10">
                        <span className="truncate text-slate-200 font-mono text-[10px]">{transporterDocs.cnicFrontName || 'cnic_front'}</span>
                        <button
                          type="button"
                          onClick={() => setTransporterDocs(prev => ({ ...prev, cnicFrontUrl: '', cnicFrontName: '' }))}
                          className="text-red-400 hover:text-red-300 p-0.5 cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-dashed border-white/20 hover:border-amber-400 bg-white/5 hover:bg-white/10 cursor-pointer text-[11px] text-gray-300 hover:text-white transition">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocUpload(f, 'transporter', 'cnicFront');
                          }}
                        />
                        {uploadingDocKey === 'transporter_cnicFront' ? (
                          <Loader2 size={12} className="animate-spin text-amber-400" />
                        ) : (
                          <Upload size={12} className="text-amber-400" />
                        )}
                        <span>Upload CNIC Front</span>
                      </label>
                    )}
                  </div>

                  {/* 2. Owner NIC / CNIC Back */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1">
                        <ShieldCheck size={13} className="text-amber-400" /> Owner CNIC Back
                      </span>
                      {transporterDocs.cnicBackUrl && (
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-0.5">
                          <Check size={10} /> Attached
                        </span>
                      )}
                    </div>
                    {transporterDocs.cnicBackUrl ? (
                      <div className="flex items-center justify-between gap-1 text-[11px] bg-white/5 p-1.5 rounded-lg border border-white/10">
                        <span className="truncate text-slate-200 font-mono text-[10px]">{transporterDocs.cnicBackName || 'cnic_back'}</span>
                        <button
                          type="button"
                          onClick={() => setTransporterDocs(prev => ({ ...prev, cnicBackUrl: '', cnicBackName: '' }))}
                          className="text-red-400 hover:text-red-300 p-0.5 cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-dashed border-white/20 hover:border-amber-400 bg-white/5 hover:bg-white/10 cursor-pointer text-[11px] text-gray-300 hover:text-white transition">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocUpload(f, 'transporter', 'cnicBack');
                          }}
                        />
                        {uploadingDocKey === 'transporter_cnicBack' ? (
                          <Loader2 size={12} className="animate-spin text-amber-400" />
                        ) : (
                          <Upload size={12} className="text-amber-400" />
                        )}
                        <span>Upload CNIC Back</span>
                      </label>
                    )}
                  </div>

                  {/* 3. NTN / Transport License / STRN */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1">
                        <FileCheck size={13} className="text-amber-400" /> NTN / Fleet License
                      </span>
                      {transporterDocs.ntnDocUrl && (
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-0.5">
                          <Check size={10} /> Attached
                        </span>
                      )}
                    </div>
                    {transporterDocs.ntnDocUrl ? (
                      <div className="flex items-center justify-between gap-1 text-[11px] bg-white/5 p-1.5 rounded-lg border border-white/10">
                        <span className="truncate text-slate-200 font-mono text-[10px]">{transporterDocs.ntnDocName || 'license_doc'}</span>
                        <button
                          type="button"
                          onClick={() => setTransporterDocs(prev => ({ ...prev, ntnDocUrl: '', ntnDocName: '' }))}
                          className="text-red-400 hover:text-red-300 p-0.5 cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-dashed border-white/20 hover:border-amber-400 bg-white/5 hover:bg-white/10 cursor-pointer text-[11px] text-gray-300 hover:text-white transition">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocUpload(f, 'transporter', 'ntn');
                          }}
                        />
                        {uploadingDocKey === 'transporter_ntn' ? (
                          <Loader2 size={12} className="animate-spin text-amber-400" />
                        ) : (
                          <Upload size={12} className="text-amber-400" />
                        )}
                        <span>Upload NTN / License</span>
                      </label>
                    )}
                  </div>

                  {/* 4. Business Card / Fleet Letterhead */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1">
                        <CreditCard size={13} className="text-amber-400" /> Card / Letterhead
                      </span>
                      {transporterDocs.businessCardUrl && (
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-0.5">
                          <Check size={10} /> Attached
                        </span>
                      )}
                    </div>
                    {transporterDocs.businessCardUrl ? (
                      <div className="flex items-center justify-between gap-1 text-[11px] bg-white/5 p-1.5 rounded-lg border border-white/10">
                        <span className="truncate text-slate-200 font-mono text-[10px]">{transporterDocs.businessCardName || 'letterhead'}</span>
                        <button
                          type="button"
                          onClick={() => setTransporterDocs(prev => ({ ...prev, businessCardUrl: '', businessCardName: '' }))}
                          className="text-red-400 hover:text-red-300 p-0.5 cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-dashed border-white/20 hover:border-amber-400 bg-white/5 hover:bg-white/10 cursor-pointer text-[11px] text-gray-300 hover:text-white transition">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleDocUpload(f, 'transporter', 'businessCard');
                          }}
                        />
                        {uploadingDocKey === 'transporter_businessCard' ? (
                          <Loader2 size={12} className="animate-spin text-amber-400" />
                        ) : (
                          <Upload size={12} className="text-amber-400" />
                        )}
                        <span>Upload Card / Slip</span>
                      </label>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 ${
                    isPearl
                      ? 'btn-charcoal-primary text-white'
                      : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950'
                  }`}
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

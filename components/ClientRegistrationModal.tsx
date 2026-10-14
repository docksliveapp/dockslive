import React, { useState, useEffect } from 'react';
import { 
  Building, User, Phone, Mail, MapPin, FileText, DollarSign, Plus, Trash2, 
  Check, X, Upload, Eye, Search, AlertCircle, Shield, CheckCircle2, ChevronRight, 
  CreditCard, Sparkles, Key, Lock, FileCheck, Download
} from 'lucide-react';
import { Client, ClientDefaultCharge, CaseCharge, UNIVERSAL_CHARGE_TYPES, UserRole, AppUser } from '../types';
import { 
  CATEGORY_SERVICE_ARRANGEMENTS, 
  getCategoryArrangements, 
  normalizeCategoryKey 
} from '../services/categoryTariffService';
import { saveClientToFirestore, saveUserToFirestore } from '../services/dbService';
import { compressAndPrepareFile } from '../services/fileUtils';

export const CASE_CATEGORIES_LIST = [
  "Bonded Carrier",
  "Afghan Transit",
  "Import & Export Services",
  "Transportation of Private Cargo",
  "TIR",
  "Customs Clearance",
  "ISO Tank Service",
  "Car Carrier",
  "Liner & NVOCC",
  "Breakbulk/Chartering Services",
  "Warehousing & Distribution"
];

interface ClientRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (client: Client, appliedCharges: CaseCharge[]) => void;
  initialClient?: Client | null;
  defaultCategory?: string;
  isClientView?: boolean;
}

export const ClientRegistrationModal: React.FC<ClientRegistrationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialClient,
  defaultCategory = 'Bonded Carrier',
  isClientView = false
}) => {
  // Section 1: Client / Company Details
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [cnic, setCnic] = useState('');
  const [officeAddress, setOfficeAddress] = useState('');
  const [contact, setContact] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [email, setEmail] = useState('');
  const [ntn, setNtn] = useState('');
  const [strn, setStrn] = useState('');

  // Documents
  const [businessCardUrl, setBusinessCardUrl] = useState('');
  const [businessCardName, setBusinessCardName] = useState('');
  const [contractLetterUrl, setContractLetterUrl] = useState('');
  const [contractLetterName, setContractLetterName] = useState('');
  const [nicDocUrl, setNicDocUrl] = useState('');
  const [nicDocName, setNicDocName] = useState('');
  const [ntnDocUrl, setNtnDocUrl] = useState('');
  const [ntnDocName, setNtnDocName] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  // Section 2: Default Case Category & Service Arrangements
  const [selectedCategory, setSelectedCategory] = useState('Bonded Carrier');
  const [arrangements, setArrangements] = useState<Record<string, 'DPL' | 'Client'>>({});

  // Section 3: Finance & Default Charges
  const [chargesList, setChargesList] = useState<ClientDefaultCharge[]>([]);

  // Optional Portal Login Credentials
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<UserRole[]>([UserRole.CLIENT]);

  // Secondary Modal: Add Charge Picker
  const [showChargePicker, setShowChargePicker] = useState(false);
  const [chargeSearch, setChargeSearch] = useState('');
  const [selectedPickerCharges, setSelectedPickerCharges] = useState<Record<string, boolean>>({});
  const [customChargeInput, setCustomChargeInput] = useState('');
  const [allAvailableCharges, setAllAvailableCharges] = useState<Array<{ id: string; name: string; category: string; defaultAmount: number }>>([]);

  // Preview Doc Modal
  const [previewDoc, setPreviewDoc] = useState<{ url: string; name: string } | null>(null);

  // Initialize or reset form on open
  useEffect(() => {
    if (!isOpen) return;

    if (initialClient) {
      setName(initialClient.name || '');
      setOwnerName(initialClient.ownerName || '');
      setCnic(initialClient.cnic || '');
      setOfficeAddress(initialClient.officeAddress || '');
      setContact(initialClient.contact || '');
      setMobileNumber(initialClient.mobileNumber || '');
      setWhatsappNumber(initialClient.whatsappNumber || initialClient.mobileNumber || '');
      setEmail(initialClient.email || '');
      setNtn(initialClient.ntn || '');
      setStrn(initialClient.strn || '');
      setBusinessCardUrl(initialClient.businessCardUrl || '');
      setContractLetterUrl(initialClient.contractLetterUrl || '');
      setNicDocUrl(initialClient.nicDocUrl || '');
      setNtnDocUrl(initialClient.ntnDocUrl || '');
      setNtnDocName(initialClient.ntnDocName || '');
      
      const cat = initialClient.defaultCaseCategory || defaultCategory;
      setSelectedCategory(cat);
      
      // Load arrangements
      const baseArr = getCategoryArrangements(cat);
      const initialArr: Record<string, 'DPL' | 'Client'> = {};
      Object.entries(baseArr).forEach(([key, item]) => {
        initialArr[key] = (initialClient.defaultServiceArrangements && initialClient.defaultServiceArrangements[key]) 
          ? initialClient.defaultServiceArrangements[key] 
          : (item.isDefaultDpl ? 'DPL' : 'Client');
      });
      setArrangements(initialArr);

      setChargesList(initialClient.defaultCharges || []);
      setLoginEnabled(Boolean(initialClient.loginEnabled));
      setUserId(initialClient.userId || `CLT-${Date.now().toString().slice(-4)}`);
      setPassword(initialClient.password || 'client123');
      setRoles(initialClient.roles && initialClient.roles.length > 0 ? initialClient.roles : [initialClient.role || UserRole.CLIENT]);
    } else {
      // Fresh client creation
      setName('');
      setOwnerName('');
      setCnic('');
      setOfficeAddress('');
      setContact('');
      setMobileNumber('');
      setWhatsappNumber('');
      setEmail('');
      setNtn('');
      setStrn('');
      setBusinessCardUrl('');
      setBusinessCardName('');
      setContractLetterUrl('');
      setContractLetterName('');
      setNicDocUrl('');
      setNicDocName('');
      setNtnDocUrl('');
      setNtnDocName('');

      const cat = defaultCategory;
      setSelectedCategory(cat);

      // Load arrangements for category
      const baseArr = getCategoryArrangements(cat);
      const initialArr: Record<string, 'DPL' | 'Client'> = {};
      Object.entries(baseArr).forEach(([key, item]) => {
        initialArr[key] = item.isDefaultDpl ? 'DPL' : 'Client';
      });
      setArrangements(initialArr);

      // Start with empty charges list for fresh clients (only charges added via Add button will appear)
      setChargesList([]);

      setLoginEnabled(true);
      setUserId(`CLT-${Math.floor(1000 + Math.random() * 9000)}`);
      setPassword(`DPL@${Math.floor(100 + Math.random() * 900)}`);
      setRoles([UserRole.CLIENT]);
    }
  }, [isOpen, initialClient, defaultCategory]);

  // When category dropdown changes
  const handleCategoryChange = (newCat: string) => {
    setSelectedCategory(newCat);
    const baseArr = getCategoryArrangements(newCat);
    const newArr: Record<string, 'DPL' | 'Client'> = {};
    Object.entries(baseArr).forEach(([key, item]) => {
      newArr[key] = item.isDefaultDpl ? 'DPL' : 'Client';
    });
    setArrangements(newArr);
  };

  // Master charge pool for the charge picker
  useEffect(() => {
    const poolMap = new Map<string, { id: string; name: string; category: string; defaultAmount: number }>();

    // Add universal charges
    UNIVERSAL_CHARGE_TYPES.forEach(ch => {
      poolMap.set(ch.name.toLowerCase(), {
        id: ch.id,
        name: ch.name,
        category: 'Universal Charges',
        defaultAmount: ch.defaultAmount
      });
    });

    // Add all category arrangements
    Object.entries(CATEGORY_SERVICE_ARRANGEMENTS).forEach(([catName, arrMap]) => {
      Object.entries(arrMap).forEach(([k, item]) => {
        const lower = item.label.toLowerCase();
        if (!poolMap.has(lower)) {
          poolMap.set(lower, {
            id: `cat_${catName}_${k}`,
            name: item.label,
            category: catName,
            defaultAmount: item.amount
          });
        }
      });
    });

    setAllAvailableCharges(Array.from(poolMap.values()));
  }, []);

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'card' | 'contract' | 'nic' | 'ntn') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingDoc(target);
    try {
      const processed = await compressAndPrepareFile(file);
      if (target === 'card') {
        setBusinessCardUrl(processed.dataUrl);
        setBusinessCardName(processed.name);
      } else if (target === 'contract') {
        setContractLetterUrl(processed.dataUrl);
        setContractLetterName(processed.name);
      } else if (target === 'nic') {
        setNicDocUrl(processed.dataUrl);
        setNicDocName(processed.name);
      } else if (target === 'ntn') {
        setNtnDocUrl(processed.dataUrl);
        setNtnDocName(processed.name);
      }
    } catch (err) {
      console.warn('File upload warning:', err);
    } finally {
      setUploadingDoc(null);
    }
  };

  // Toggle Arrangement for a specific field
  const toggleArrangement = (key: string, value: 'DPL' | 'Client') => {
    setArrangements(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Open Charge Picker Modal
  const handleOpenChargePicker = () => {
    // Pre-tick charges that are already in the list
    const preSelected: Record<string, boolean> = {};
    chargesList.forEach(c => {
      preSelected[c.description.toLowerCase()] = true;
    });
    setSelectedPickerCharges(preSelected);
    setShowChargePicker(true);
  };

  // Add custom charge on the fly inside charge picker
  const handleAddCustomChargeOnFly = () => {
    if (!customChargeInput.trim()) return;
    const nameTrimmed = customChargeInput.trim();
    const newItem = {
      id: `custom_${Date.now()}`,
      name: nameTrimmed,
      category: selectedCategory,
      defaultAmount: 5000
    };

    setAllAvailableCharges(prev => [newItem, ...prev]);
    setSelectedPickerCharges(prev => ({ ...prev, [nameTrimmed.toLowerCase()]: true }));
    setCustomChargeInput('');
  };

  // Apply selected charges from picker
  const handleApplyChargesFromPicker = () => {
    const updatedCharges = [...chargesList];
    const existingDescSet = new Set(chargesList.map(c => c.description.toLowerCase()));

    allAvailableCharges.forEach(item => {
      const isSelected = selectedPickerCharges[item.name.toLowerCase()];
      if (isSelected && !existingDescSet.has(item.name.toLowerCase())) {
        updatedCharges.push({
          id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          category: item.category || selectedCategory,
          description: item.name,
          defaultAmount: item.defaultAmount || 0,
          taxable: true
        });
      }
    });

    setChargesList(updatedCharges);
    setShowChargePicker(false);
  };

  // Save client and tariff
  const handleSave = async () => {
    if (!name.trim()) {
      alert('Please enter Client / Company Title');
      return;
    }

    const clientId = initialClient?.id || `client_${Date.now()}`;
    const trimmedName = name.trim();

    // Only save charges that have a description (charges added by clicking the Add button)
    const validDefaultCharges: ClientDefaultCharge[] = chargesList
      .filter(c => c.description.trim())
      .map(c => ({
        id: c.id,
        category: c.category || selectedCategory,
        description: c.description.trim(),
        defaultAmount: Number(c.defaultAmount) || 0,
        taxable: c.taxable ?? false
      }));

    const clientToSave: Client = {
      id: clientId,
      name: trimmedName,
      ownerName: ownerName.trim(),
      cnic: cnic.trim(),
      officeAddress: officeAddress.trim(),
      contact: contact.trim() || mobileNumber.trim(),
      mobileNumber: mobileNumber.trim(),
      whatsappNumber: whatsappNumber.trim() || mobileNumber.trim(),
      email: email.trim(),
      ntn: ntn.trim(),
      strn: strn.trim(),
      businessCardUrl: businessCardUrl || undefined,
      contractLetterUrl: contractLetterUrl || undefined,
      nicDocUrl: nicDocUrl || undefined,
      ntnDocUrl: ntnDocUrl || undefined,
      ntnDocName: ntnDocName || undefined,
      defaultCaseCategory: selectedCategory,
      defaultServiceArrangements: arrangements,
      defaultCharges: validDefaultCharges,
      loginEnabled: loginEnabled,
      role: roles[0] || UserRole.CLIENT,
      roles: roles.length > 0 ? roles : [UserRole.CLIENT],
      userId: userId || `CLT-${Math.floor(1000 + Math.random() * 9000)}`,
      password: password || `DPL@${Math.floor(100 + Math.random() * 900)}`,
      createdAt: initialClient?.createdAt || new Date().toISOString()
    };

    try {
      await saveClientToFirestore(clientToSave);
      if (loginEnabled && clientToSave.userId && clientToSave.password) {
        const clientAppUser: AppUser = {
          id: Date.now() % 10000000,
          userId: clientToSave.userId,
          password: clientToSave.password,
          name: clientToSave.name,
          clientName: clientToSave.name,
          role: clientToSave.role || UserRole.CLIENT,
          roles: clientToSave.roles || [UserRole.CLIENT],
          designation: 'Corporate Importer / Client',
          contact: clientToSave.contact || clientToSave.mobileNumber || '',
          email: clientToSave.email || '',
          status: 'ACTIVE',
          allowedCompanies: ['docks', 'truckit', 'muhib', 'vantage'],
          baseSalary: 0
        };
        await saveUserToFirestore(clientAppUser);
      }
    } catch (err) {
      console.warn("Could not save client to Firestore:", err);
    }

    // Convert valid default charges to CaseCharge array for instant application
    const appliedCharges: CaseCharge[] = validDefaultCharges.map((ch, idx) => ({
      id: `chg_app_${Date.now()}_${idx}`,
      category: ch.category || selectedCategory,
      description: ch.description,
      amount: Number(ch.defaultAmount) || 0,
      taxable: ch.taxable ?? false,
      arrangedBy: 'DPL'
    }));

    onSave(clientToSave, appliedCharges);
  };

  const [passwordSaveSuccess, setPasswordSaveSuccess] = useState(false);
  const handleSavePasswordOnly = async () => {
    if (!password.trim()) return;
    const clientToSave: Client = {
      id: initialClient?.id || `client_${Date.now()}`,
      name: name.trim() || initialClient?.name || 'Client',
      ownerName: ownerName.trim(),
      cnic: cnic.trim(),
      officeAddress: officeAddress.trim(),
      contact: contact.trim(),
      mobileNumber: mobileNumber.trim(),
      whatsappNumber: whatsappNumber.trim() || mobileNumber.trim(),
      email: email.trim(),
      ntn: ntn.trim(),
      strn: strn.trim(),
      businessCardUrl: businessCardUrl || undefined,
      contractLetterUrl: contractLetterUrl || undefined,
      nicDocUrl: nicDocUrl || undefined,
      ntnDocUrl: ntnDocUrl || undefined,
      ntnDocName: ntnDocName || undefined,
      defaultCaseCategory: selectedCategory,
      defaultServiceArrangements: arrangements,
      defaultCharges: chargesList,
      loginEnabled: true,
      userId: userId || initialClient?.userId || 'CLIENT-DPL',
      password: password.trim(),
      createdAt: initialClient?.createdAt || new Date().toISOString()
    };

    try {
      await saveClientToFirestore(clientToSave);
      setPasswordSaveSuccess(true);
      setTimeout(() => {
        setPasswordSaveSuccess(false);
        onSave(clientToSave, []);
        onClose();
      }, 1000);
    } catch (err) {
      console.warn("Could not save password to Firestore:", err);
      setPasswordSaveSuccess(true);
      setTimeout(() => {
        setPasswordSaveSuccess(false);
        onSave(clientToSave, []);
        onClose();
      }, 1000);
    }
  };

  if (!isOpen) return null;

  const filteredPickerCharges = allAvailableCharges.filter(c => {
    if (!chargeSearch.trim()) return true;
    const q = chargeSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q);
  });

  const activeDefaultChargesCount = chargesList.filter(c => (Number(c.defaultAmount) || 0) > 0).length;
  const totalDefaultAmount = chargesList.reduce((sum, c) => sum + (Number(c.defaultAmount) || 0), 0);

  const currentCategoryArrangements = getCategoryArrangements(selectedCategory);

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-5 overflow-hidden animate-in fade-in duration-200">
      <div className="rounded-2xl w-full max-w-4xl border border-white/15 shadow-2xl bg-slate-900 max-h-[88vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-white/10 flex justify-between items-center bg-slate-950/90 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Building size={20} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>{isClientView ? 'Client Account Profile' : (initialClient ? 'Edit Client Profile & Tariff' : 'Register New Client & Tariff')}</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {isClientView ? 'Verified company particulars & portal security credentials' : 'Configure client details, default service arrangements, and standard tariff'}
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white h-9 w-9 rounded-xl hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 custom-scrollbar flex-1 min-h-0 text-sm scroll-smooth overscroll-contain">
          
          {/* Client View Locked Banner */}
          {isClientView && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3.5 text-amber-200">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                <Lock size={18} />
              </div>
              <div className="space-y-1 text-xs">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <span>Client Profile Locked (Read-Only)</span>
                  <span className="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-md font-mono font-semibold">
                    Security Protected
                  </span>
                </h4>
                <p className="text-slate-300 text-xs leading-relaxed">
                  All company profile particulars and tariff arrangements are securely locked. You may update your portal password below at any time.
                </p>
              </div>
            </div>
          )}
          
          {/* ========================================================================= */}
          {/* SECTION 1: CLIENT / COMPANY DETAILS & DOCUMENTS */}
          {/* ========================================================================= */}
          <div className="space-y-4 bg-slate-950/60 p-5 rounded-xl border border-white/10">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider border-b border-white/10 pb-2.5">
              <User size={15} />
              <span>1. Client Details & KYC Documents</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="sm:col-span-2 lg:col-span-2">
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  Company Title / Business Name <span className="text-red-400">*</span>
                </label>
                <input 
                  type="text"
                  placeholder="e.g. Al-Madina Logistics & Trading Co."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                  autoFocus={!isClientView}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  Owner / CEO Name
                </label>
                <input 
                  type="text"
                  placeholder="e.g. Haji Gul Muhammad"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  Owner NIC / CNIC
                </label>
                <input 
                  type="text"
                  placeholder="e.g. 42101-1234567-1"
                  value={cnic}
                  onChange={(e) => setCnic(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm font-mono border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  Primary Contact / Phone
                </label>
                <input 
                  type="text"
                  placeholder="e.g. 021-32415555"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  Mobile Number
                </label>
                <input 
                  type="text"
                  placeholder="e.g. 0300-1234567"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm font-mono border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  WhatsApp Number
                </label>
                <input 
                  type="text"
                  placeholder="e.g. 0300-1234567"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm font-mono border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  Email Address
                </label>
                <input 
                  type="email"
                  placeholder="e.g. info@company.pk"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  NTN / Tax ID
                </label>
                <input 
                  type="text"
                  placeholder="e.g. 1234567-8"
                  value={ntn}
                  onChange={(e) => setNtn(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm font-mono border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  STRN (Sales Tax Reg)
                </label>
                <input 
                  type="text"
                  placeholder="e.g. 17-00-1234567"
                  value={strn}
                  onChange={(e) => setStrn(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm font-mono border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-2">
                <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                  Office / Business Address
                </label>
                <input 
                  type="text"
                  placeholder="e.g. Suite # 301, Trade Center, I.I. Chundrigar Road, Karachi"
                  value={officeAddress}
                  onChange={(e) => setOfficeAddress(e.target.value)}
                  disabled={isClientView}
                  readOnly={isClientView}
                  className={`w-full h-10 rounded-xl px-3.5 outline-none text-sm border transition-all ${
                    isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 text-white border-white/15 focus:border-amber-400'
                  }`}
                />
              </div>
            </div>

            {/* Document Uploads: Business Card, Contract Letter, CNIC, NTN */}
            <div className="pt-4 border-t border-white/10">
              <label className="text-xs font-bold text-slate-200 block mb-3">
                Attached Documents (Business Card, Contract Letter, CNIC Copy, NTN Certificate)
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {/* Business Card Upload */}
                <div className="p-3.5 bg-slate-900 border border-white/10 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <CreditCard size={14} className="text-sky-400" /> Business Card
                    </span>
                    {businessCardUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewDoc({ url: businessCardUrl, name: businessCardName || 'Business Card' })}
                        className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
                      >
                        <Eye size={13} /> View
                      </button>
                    )}
                  </div>
                  {isClientView ? (
                    <div className="h-9 flex items-center justify-center bg-slate-950 rounded-lg text-xs text-slate-300 border border-white/5">
                      {businessCardUrl ? <span className="text-emerald-400 font-medium">✓ Card on file</span> : <span className="text-slate-500">Not provided</span>}
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 h-9 px-3 border border-dashed border-white/20 hover:border-amber-400 rounded-lg cursor-pointer bg-white/5 hover:bg-white/10 transition text-center">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => handleFileUpload(e, 'card')}
                      />
                      <Upload size={14} className="text-amber-400 shrink-0" />
                      <span className="text-xs text-slate-200 font-medium truncate">
                        {uploadingDoc === 'card' ? 'Processing...' : businessCardName || (businessCardUrl ? 'Replace Card' : 'Upload Card')}
                      </span>
                    </label>
                  )}
                </div>

                {/* Contract Letter Upload */}
                <div className="p-3.5 bg-slate-900 border border-white/10 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <FileText size={14} className="text-emerald-400" /> Contract Letter
                    </span>
                    {contractLetterUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewDoc({ url: contractLetterUrl, name: contractLetterName || 'Contract Letter' })}
                        className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
                      >
                        <Eye size={13} /> View
                      </button>
                    )}
                  </div>
                  {isClientView ? (
                    <div className="h-9 flex items-center justify-center bg-slate-950 rounded-lg text-xs text-slate-300 border border-white/5">
                      {contractLetterUrl ? <span className="text-emerald-400 font-medium">✓ Letter on file</span> : <span className="text-slate-500">Not provided</span>}
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 h-9 px-3 border border-dashed border-white/20 hover:border-amber-400 rounded-lg cursor-pointer bg-white/5 hover:bg-white/10 transition text-center">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => handleFileUpload(e, 'contract')}
                      />
                      <Upload size={14} className="text-amber-400 shrink-0" />
                      <span className="text-xs text-slate-200 font-medium truncate">
                        {uploadingDoc === 'contract' ? 'Processing...' : contractLetterName || (contractLetterUrl ? 'Replace Letter' : 'Upload Letter')}
                      </span>
                    </label>
                  )}
                </div>

                {/* Owner CNIC Upload */}
                <div className="p-3.5 bg-slate-900 border border-white/10 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Shield size={14} className="text-purple-400" /> Owner CNIC
                    </span>
                    {nicDocUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewDoc({ url: nicDocUrl, name: nicDocName || 'CNIC Copy' })}
                        className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
                      >
                        <Eye size={13} /> View
                      </button>
                    )}
                  </div>
                  {isClientView ? (
                    <div className="h-9 flex items-center justify-center bg-slate-950 rounded-lg text-xs text-slate-300 border border-white/5">
                      {nicDocUrl ? <span className="text-emerald-400 font-medium">✓ CNIC on file</span> : <span className="text-slate-500">Not provided</span>}
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 h-9 px-3 border border-dashed border-white/20 hover:border-amber-400 rounded-lg cursor-pointer bg-white/5 hover:bg-white/10 transition text-center">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => handleFileUpload(e, 'nic')}
                      />
                      <Upload size={14} className="text-amber-400 shrink-0" />
                      <span className="text-xs text-slate-200 font-medium truncate">
                        {uploadingDoc === 'nic' ? 'Processing...' : nicDocName || (nicDocUrl ? 'Replace CNIC' : 'Upload CNIC')}
                      </span>
                    </label>
                  )}
                </div>

                {/* NTN Certificate Upload */}
                <div className="p-3.5 bg-slate-900 border border-white/10 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <FileCheck size={14} className="text-cyan-400" /> NTN Certificate
                    </span>
                    {ntnDocUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewDoc({ url: ntnDocUrl, name: ntnDocName || 'NTN Certificate' })}
                        className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
                      >
                        <Eye size={13} /> View
                      </button>
                    )}
                  </div>
                  {isClientView ? (
                    <div className="h-9 flex items-center justify-center bg-slate-950 rounded-lg text-xs text-slate-300 border border-white/5">
                      {ntnDocUrl ? <span className="text-emerald-400 font-medium">✓ NTN on file</span> : <span className="text-slate-500">Not provided</span>}
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 h-9 px-3 border border-dashed border-white/20 hover:border-amber-400 rounded-lg cursor-pointer bg-white/5 hover:bg-white/10 transition text-center">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => handleFileUpload(e, 'ntn')}
                      />
                      <Upload size={14} className="text-amber-400 shrink-0" />
                      <span className="text-xs text-slate-200 font-medium truncate">
                        {uploadingDoc === 'ntn' ? 'Processing...' : ntnDocName || (ntnDocUrl ? 'Replace NTN' : 'Upload NTN')}
                      </span>
                    </label>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* SECTION 2: DEFAULT CASE CATEGORY & SERVICE ARRANGEMENTS (DPL VS CLIENT) */}
          {/* ========================================================================= */}
          <div className="space-y-4 bg-slate-950/60 p-5 rounded-xl border border-white/10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider">
                <Shield size={15} />
                <span>2. Default Case Category & Service Arrangement</span>
              </div>
              <span className="text-xs text-slate-400">
                Primary category & service handling preference
              </span>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                Primary Case Category (Default Selection) <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => handleCategoryChange(e.target.value)}
                disabled={isClientView}
                className={`w-full h-10 rounded-xl px-3.5 outline-none text-white text-sm border transition-all ${
                  isClientView ? 'bg-slate-900 text-slate-400 border-white/10 cursor-not-allowed' : 'bg-slate-900 border-white/15 focus:border-amber-400'
                }`}
              >
                {CASE_CATEGORIES_LIST.map(cat => (
                  <option key={cat} value={cat} className="bg-slate-900">
                    {cat} {cat === 'Bonded Carrier' ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Operational Service Arrangement Toggles */}
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Service Arrangements for {selectedCategory}:
                </span>
                <span className="text-xs text-slate-400">
                  {isClientView ? 'Configured by Administration' : 'Choose Arranged by DPL or Arranged by Client'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                {Object.entries(currentCategoryArrangements).map(([key, item]) => {
                  const currentArrangement = arrangements[key] || (item.isDefaultDpl ? 'DPL' : 'Client');
                  const isDpl = currentArrangement === 'DPL';

                  return (
                    <div 
                      key={key} 
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                        isDpl 
                          ? 'bg-emerald-950/20 border-emerald-500/30' 
                          : 'bg-slate-900 border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${isDpl ? 'bg-emerald-400' : 'bg-sky-400'}`}></span>
                        <p className="text-xs font-semibold text-white truncate">{item.label}</p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 bg-slate-950 p-1 rounded-lg border border-white/10">
                        <button
                          type="button"
                          disabled={isClientView}
                          onClick={() => !isClientView && toggleArrangement(key, 'DPL')}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                            isDpl 
                              ? 'bg-emerald-600 text-white shadow' 
                              : 'text-slate-400 hover:text-white'
                          } ${isClientView ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
                        >
                          <span>DPL</span>
                        </button>
                        <button
                          type="button"
                          disabled={isClientView}
                          onClick={() => !isClientView && toggleArrangement(key, 'Client')}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                            !isDpl 
                              ? 'bg-sky-600 text-white shadow' 
                              : 'text-slate-400 hover:text-white'
                          } ${isClientView ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
                        >
                          <span>Client</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* SECTION 3: FINANCE & BY-DEFAULT CHARGES TARIFF */}
          {/* ========================================================================= */}
          <div className="space-y-4 bg-slate-950/60 p-5 rounded-xl border border-white/10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                <DollarSign size={15} />
                <span>3. Finance & Default Billing Charges Tariff</span>
              </div>
              {!isClientView && (
                <button
                  type="button"
                  onClick={handleOpenChargePicker}
                  className="h-9 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-3.5 rounded-xl shadow transition flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
                >
                  <Plus size={14} /> Add Default Charge
                </button>
              )}
            </div>

            {/* Charges List Table */}
            <div className="space-y-2.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
              {chargesList.length === 0 ? (
                <div className="p-5 text-center text-xs text-slate-400 bg-slate-900 rounded-xl border border-white/5">
                  No default charges added yet. Click &quot;+ Add Default Charge&quot; to configure standard charges for this client.
                </div>
              ) : (
                chargesList.map((ch, idx) => {
                  const hasAmount = (Number(ch.defaultAmount) || 0) > 0;
                  return (
                    <div 
                      key={ch.id || idx} 
                      className="p-3 rounded-xl border bg-slate-900 border-white/10 flex flex-col sm:flex-row sm:items-center gap-3 transition-all"
                    >
                      <div className="flex-1 min-w-0">
                        <input 
                          type="text"
                          value={ch.description}
                          disabled={isClientView}
                          readOnly={isClientView}
                          onChange={(e) => {
                            const updated = [...chargesList];
                            updated[idx].description = e.target.value;
                            setChargesList(updated);
                          }}
                          placeholder="Charge description"
                          className="w-full h-9 rounded-lg px-3 text-xs text-white bg-slate-950 border border-white/10 focus:border-amber-400 outline-none"
                        />
                      </div>

                      <div className="w-full sm:w-40">
                        <select
                          value={ch.category || selectedCategory}
                          disabled={isClientView}
                          onChange={(e) => {
                            const updated = [...chargesList];
                            updated[idx].category = e.target.value;
                            setChargesList(updated);
                          }}
                          className="w-full h-9 rounded-lg px-2.5 text-xs text-white bg-slate-950 border border-white/10 outline-none"
                        >
                          <option value="Freight / Haulage">Freight / Haulage</option>
                          <option value="Documentation">Documentation</option>
                          <option value="Port & Terminal">Port & Terminal</option>
                          <option value="Customs / Transit">Customs / Transit</option>
                          <option value="Agency">Agency</option>
                          <option value="Security / Tracking">Security / Tracking</option>
                          <option value="Miscellaneous">Miscellaneous</option>
                        </select>
                      </div>

                      <div className="w-full sm:w-36 flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 font-mono">PKR</span>
                        <input 
                          type="number"
                          placeholder="0"
                          value={ch.defaultAmount === 0 ? '' : ch.defaultAmount}
                          disabled={isClientView}
                          readOnly={isClientView}
                          onChange={(e) => {
                            const updated = [...chargesList];
                            updated[idx].defaultAmount = e.target.value === '' ? 0 : Number(e.target.value);
                            setChargesList(updated);
                          }}
                          className={`w-full h-9 rounded-lg px-3 text-xs font-mono font-bold outline-none border ${
                            hasAmount 
                              ? 'text-emerald-300 border-emerald-500/40 bg-emerald-950/30' 
                              : 'text-slate-400 bg-slate-950 border-white/10'
                          }`}
                        />
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={ch.taxable ?? false}
                            disabled={isClientView}
                            onChange={(e) => {
                              const updated = [...chargesList];
                              updated[idx].taxable = e.target.checked;
                              setChargesList(updated);
                            }}
                            className="rounded text-amber-500 focus:ring-0"
                          />
                          <span>Taxable</span>
                        </label>

                        {!isClientView && (
                          <button
                            type="button"
                            onClick={() => {
                              setChargesList(chargesList.filter((_, i) => i !== idx));
                            }}
                            className="text-red-400 hover:text-red-300 p-1.5 rounded-lg hover:bg-red-500/10 transition cursor-pointer"
                            title="Remove charge"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Total Default Charges Tally */}
            <div className="flex items-center justify-between p-3.5 bg-emerald-500/10 border border-emerald-500/25 rounded-xl">
              <div>
                <span className="text-xs font-semibold text-emerald-300 block">
                  Active Default Charges ({activeDefaultChargesCount} items):
                </span>
                <span className="text-xs text-slate-400">
                  Automatically applied when registering cases for this client
                </span>
              </div>
              <span className="text-base font-bold font-mono text-emerald-400">
                PKR {totalDefaultAmount.toLocaleString()}
              </span>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* CLIENT PORTAL CREDENTIALS & PASSWORD MANAGEMENT */}
          {/* ========================================================================= */}
          <div className="bg-slate-950/60 p-5 rounded-xl border border-white/10 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-300 uppercase tracking-wider">
                <Key size={15} className="text-purple-400" />
                <span>4. Portal Security & Login Credentials</span>
              </div>
              <span className="text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-md font-semibold flex items-center gap-1">
                <CheckCircle2 size={12} /> Active
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-300 block mb-1.5 font-semibold">Assigned User ID (Login Username)</label>
                <input 
                  type="text"
                  value={userId}
                  readOnly
                  disabled
                  className="w-full h-10 rounded-xl px-3.5 text-sm font-mono font-bold text-amber-300 bg-slate-900 border border-white/10 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-xs text-slate-200 block mb-1.5 font-semibold flex items-center justify-between">
                  <span>Portal Password</span>
                  <span className="text-xs text-emerald-400 font-normal">Editable</span>
                </label>
                <input 
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full h-10 rounded-xl px-3.5 text-sm font-mono font-semibold text-white bg-slate-900 border border-white/15 focus:border-amber-400 outline-none"
                />
              </div>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-5 py-4 border-t border-white/10 flex justify-between items-center bg-slate-950/90 shrink-0">
          <button 
            type="button"
            onClick={onClose}
            className="h-10 bg-white/10 hover:bg-white/15 text-slate-200 px-5 rounded-xl font-semibold text-xs sm:text-sm transition-colors cursor-pointer"
          >
            Cancel
          </button>

          {isClientView ? (
            <button 
              type="button"
              onClick={handleSavePasswordOnly}
              disabled={!password.trim() || passwordSaveSuccess}
              className="h-10 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 px-6 rounded-xl font-bold text-xs sm:text-sm shadow-lg transition-all flex items-center gap-2 cursor-pointer"
            >
              {passwordSaveSuccess ? (
                <>
                  <CheckCircle2 size={16} />
                  <span>Password Updated!</span>
                </>
              ) : (
                <>
                  <Key size={16} />
                  <span>Update Password</span>
                </>
              )}
            </button>
          ) : (
            <button 
              type="button"
              onClick={handleSave}
              disabled={!name.trim()}
              className="h-10 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-6 rounded-xl font-bold text-xs sm:text-sm shadow-lg transition-all flex items-center gap-2 cursor-pointer"
            >
              <CheckCircle2 size={16} /> Save Client & Apply Tariff
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECONDARY POPUP: MASTER CHARGE PICKER & ADD CUSTOM CHARGE */}
      {/* ========================================================================= */}
      {showChargePicker && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-60 flex items-center justify-center p-3 sm:p-4 overflow-hidden animate-in fade-in duration-150">
          <div className="rounded-2xl w-full max-w-xl border border-white/15 shadow-2xl bg-slate-900 max-h-[82vh] flex flex-col overflow-hidden">
            {/* Picker Header */}
            <div className="px-5 py-4 border-b border-white/10 flex justify-between items-center bg-slate-950 shrink-0">
              <div>
                <h4 className="text-base font-bold text-white flex items-center gap-2">
                  <DollarSign size={16} className="text-emerald-400" />
                  <span>Select Default Charges for {name || 'Client'}</span>
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select charges to include in the client&apos;s default tariff
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setShowChargePicker(false)}
                className="text-slate-400 hover:text-white h-8 w-8 rounded-lg flex items-center justify-center hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search and Add Custom Charge bar */}
            <div className="p-4 border-b border-white/10 space-y-3 bg-slate-950/50 shrink-0">
              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Search existing charges..."
                  value={chargeSearch}
                  onChange={(e) => setChargeSearch(e.target.value)}
                  className="w-full h-10 pl-10 pr-3.5 bg-slate-900 border border-white/15 rounded-xl text-sm text-white outline-none focus:border-amber-400"
                />
              </div>

              {/* Add New Charge input if not found in list */}
              <div className="flex gap-2">
                <input 
                  type="text"
                  placeholder="Or type custom charge name..."
                  value={customChargeInput}
                  onChange={(e) => setCustomChargeInput(e.target.value)}
                  className="flex-1 h-10 bg-slate-900 border border-white/15 rounded-xl px-3.5 text-sm text-white outline-none focus:border-amber-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomChargeOnFly();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddCustomChargeOnFly}
                  disabled={!customChargeInput.trim()}
                  className="h-10 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-bold px-4 rounded-xl transition flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Plus size={14} /> Add Custom
                </button>
              </div>
            </div>

            {/* Scrollable Charges Checklist */}
            <div className="p-4 overflow-y-auto space-y-2 custom-scrollbar flex-1 min-h-0">
              {filteredPickerCharges.length === 0 ? (
                <div className="text-center p-6 text-xs text-slate-400">
                  No matching charges found. Type above and click &quot;Add Custom&quot; to create it.
                </div>
              ) : (
                filteredPickerCharges.map((item, idx) => {
                  const isChecked = selectedPickerCharges[item.name.toLowerCase()] ?? false;

                  return (
                    <label 
                      key={`picker_chg_${item.id || idx}_${idx}`}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                        isChecked 
                          ? 'bg-emerald-950/30 border-emerald-500/40 text-white' 
                          : 'bg-slate-950/60 border-white/10 text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input 
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            setSelectedPickerCharges(prev => ({
                              ...prev,
                              [item.name.toLowerCase()]: e.target.checked
                            }));
                          }}
                          className="rounded text-emerald-500 focus:ring-0 w-4 h-4"
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-semibold block truncate">{item.name}</span>
                          <span className="text-[11px] text-slate-400">{item.category}</span>
                        </div>
                      </div>

                      <span className="text-xs font-mono text-emerald-400 font-bold shrink-0">
                        PKR {item.defaultAmount.toLocaleString()}
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            {/* Picker Footer */}
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-between items-center bg-slate-950 shrink-0">
              <span className="text-xs text-slate-400 font-mono">
                {Object.values(selectedPickerCharges).filter(Boolean).length} selected
              </span>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowChargePicker(false)}
                  className="h-9 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyChargesFromPicker}
                  className="h-9 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-5 rounded-xl shadow transition cursor-pointer"
                >
                  Apply Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Quick Preview */}
      {previewDoc && (
        <div className="fixed inset-0 bg-slate-950/95 z-70 flex items-center justify-center p-4 overflow-hidden">
          <div className="rounded-2xl w-full max-w-2xl border border-white/20 p-5 space-y-4 bg-slate-900 flex flex-col max-h-[88vh]">
            <div className="flex justify-between items-center border-b border-white/10 pb-3 shrink-0">
              <h4 className="text-sm font-bold text-white truncate">{previewDoc.name}</h4>
              <button 
                onClick={() => setPreviewDoc(null)} 
                className="text-slate-400 hover:text-white h-8 w-8 rounded-lg flex items-center justify-center hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center min-h-[300px]">
              {previewDoc.url && (previewDoc.url.startsWith('data:application/pdf') || previewDoc.url.endsWith('.pdf')) ? (
                <iframe src={previewDoc.url} className="w-full h-[500px] rounded-xl border border-white/10" title={previewDoc.name} />
              ) : previewDoc.url ? (
                <img src={previewDoc.url} alt={previewDoc.name} className="max-w-full max-h-[500px] object-contain rounded-xl" />
              ) : (
                <div className="p-8 text-center text-slate-400">No preview available</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

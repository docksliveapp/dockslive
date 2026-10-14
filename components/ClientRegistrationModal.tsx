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
  normalizeCategoryKey,
  getChargeCaseCategory,
  isKnownCaseCategory
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

  // Section 2: Default Case Category & Category-Wise Service Arrangements
  const [selectedCategory, setSelectedCategory] = useState('Bonded Carrier');
  const [arrangements, setArrangements] = useState<Record<string, 'DPL' | 'Client'>>({});
  const [categoryArrangementsMap, setCategoryArrangementsMap] = useState<Record<string, Record<string, 'DPL' | 'Client'>>>({});

  // Section 3: Finance & Category-Wise Default Charges
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
  const [pickerAmounts, setPickerAmounts] = useState<Record<string, string>>({});
  const [customChargeInput, setCustomChargeInput] = useState('');
  const [allAvailableCharges, setAllAvailableCharges] = useState<Array<{ id: string; name: string; category: string; chargeHead: string; defaultAmount: number }>>([]);

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
      
      const cat = normalizeCategoryKey(initialClient.defaultCaseCategory || defaultCategory || 'Bonded Carrier');
      setSelectedCategory(cat);
      
      // Load category-wise arrangements map
      const savedCatMap = initialClient.categoryServiceArrangements ? { ...initialClient.categoryServiceArrangements } : {};
      const baseArr = getCategoryArrangements(cat);
      const initialArr: Record<string, 'DPL' | 'Client'> = {};
      Object.entries(baseArr).forEach(([key, item]) => {
        const fromCatMap = savedCatMap[cat]?.[key];
        const fromDefault = initialClient.defaultServiceArrangements?.[key];
        initialArr[key] = fromCatMap || fromDefault || (item.isDefaultDpl ? 'DPL' : 'Client');
      });
      savedCatMap[cat] = initialArr;
      setCategoryArrangementsMap(savedCatMap);
      setArrangements(initialArr);

      // Normalize existing defaultCharges so each charge explicitly knows its Case Category and Charge Head
      const normalizedCharges: ClientDefaultCharge[] = (initialClient.defaultCharges || []).map(ch => {
        const resolvedCaseCat = getChargeCaseCategory(ch, cat);
        const resolvedHead = ch.chargeHead || (!isKnownCaseCategory(ch.category) && ch.category ? ch.category : 'Customs / Transit');
        return {
          ...ch,
          category: resolvedCaseCat,
          caseCategory: resolvedCaseCat,
          chargeHead: resolvedHead
        };
      });
      setChargesList(normalizedCharges);
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

      const cat = normalizeCategoryKey(defaultCategory || 'Bonded Carrier');
      setSelectedCategory(cat);

      // Load arrangements for category
      const baseArr = getCategoryArrangements(cat);
      const initialArr: Record<string, 'DPL' | 'Client'> = {};
      Object.entries(baseArr).forEach(([key, item]) => {
        initialArr[key] = item.isDefaultDpl ? 'DPL' : 'Client';
      });
      setCategoryArrangementsMap({ [cat]: initialArr });
      setArrangements(initialArr);

      // Start with empty charges list for fresh clients (all amounts Nil until selected & entered)
      setChargesList([]);

      setLoginEnabled(true);
      setUserId(`CLT-${Math.floor(1000 + Math.random() * 9000)}`);
      setPassword(`DPL@${Math.floor(100 + Math.random() * 900)}`);
      setRoles([UserRole.CLIENT]);
    }
  }, [isOpen, initialClient, defaultCategory]);

  // When category dropdown changes
  const handleCategoryChange = (newCatRaw: string) => {
    const newCat = normalizeCategoryKey(newCatRaw);
    // Save current category's arrangements before switching
    const updatedMap = {
      ...categoryArrangementsMap,
      [normalizeCategoryKey(selectedCategory)]: arrangements
    };

    const existingForNewCat = updatedMap[newCat];
    let nextArr: Record<string, 'DPL' | 'Client'> = {};
    if (existingForNewCat) {
      nextArr = { ...existingForNewCat };
    } else {
      const baseArr = getCategoryArrangements(newCat);
      Object.entries(baseArr).forEach(([key, item]) => {
        nextArr[key] = item.isDefaultDpl ? 'DPL' : 'Client';
      });
      updatedMap[newCat] = nextArr;
    }

    setCategoryArrangementsMap(updatedMap);
    setSelectedCategory(newCat);
    setArrangements(nextArr);
  };

  // Master charge pool for the charge picker (All defaultAmount strictly 0 / Nil!)
  useEffect(() => {
    const poolMap = new Map<string, { id: string; name: string; category: string; chargeHead: string; defaultAmount: number }>();

    // Add universal charges (all amounts 0 / Nil)
    UNIVERSAL_CHARGE_TYPES.forEach(ch => {
      let head = 'Customs / Transit';
      const lowerName = ch.name.toLowerCase();
      if (lowerName.includes('rent') || lowerName.includes('freight') || lowerName.includes('detention')) head = 'Freight / Haulage';
      else if (lowerName.includes('do') || lowerName.includes('doc') || lowerName.includes('manifest') || lowerName.includes('stamp')) head = 'Documentation';
      else if (lowerName.includes('loading') || lowerName.includes('unloading')) head = 'Port & Terminal';
      else if (lowerName.includes('bank')) head = 'Agency';

      poolMap.set(lowerName, {
        id: ch.id,
        name: ch.name,
        category: 'Standard Charge Head',
        chargeHead: head,
        defaultAmount: 0
      });
    });

    // Add all category arrangements (all amounts 0 / Nil)
    Object.entries(CATEGORY_SERVICE_ARRANGEMENTS).forEach(([catName, arrMap]) => {
      Object.entries(arrMap).forEach(([k, item]) => {
        const lower = item.label.toLowerCase();
        if (!poolMap.has(lower)) {
          let head = 'Customs / Transit';
          if (lower.includes('rent') || lower.includes('freight') || lower.includes('haulage') || lower.includes('detention')) head = 'Freight / Haulage';
          else if (lower.includes('do') || lower.includes('manifest') || lower.includes('builty') || lower.includes('declaration')) head = 'Documentation';
          else if (lower.includes('loading') || lower.includes('unloading') || lower.includes('wharfage') || lower.includes('thc') || lower.includes('stevedoring')) head = 'Port & Terminal';
          else if (lower.includes('service') || lower.includes('agency')) head = 'Agency';
          else if (lower.includes('seal') || lower.includes('tracker') || lower.includes('escort') || lower.includes('insurance')) head = 'Security / Tracking';

          poolMap.set(lower, {
            id: `cat_${catName}_${k}`,
            name: item.label,
            category: catName,
            chargeHead: head,
            defaultAmount: 0
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
    setArrangements(prev => {
      const updated = { ...prev, [key]: value };
      setCategoryArrangementsMap(mapPrev => ({
        ...mapPrev,
        [normalizeCategoryKey(selectedCategory)]: updated
      }));
      return updated;
    });
  };

  const normSelectedCategory = normalizeCategoryKey(selectedCategory);

  // Charges belonging to the currently selected Case Category
  const currentCategoryCharges = chargesList.filter(
    c => getChargeCaseCategory(c, normSelectedCategory) === normSelectedCategory
  );

  // Open Charge Picker Modal for the active category
  const handleOpenChargePicker = () => {
    const preSelected: Record<string, boolean> = {};
    const preAmounts: Record<string, string> = {};
    currentCategoryCharges.forEach(c => {
      const key = c.description.toLowerCase();
      preSelected[key] = true;
      preAmounts[key] = c.defaultAmount && Number(c.defaultAmount) > 0 ? String(c.defaultAmount) : '';
    });
    setSelectedPickerCharges(preSelected);
    setPickerAmounts(preAmounts);
    setShowChargePicker(true);
  };

  // Add custom charge on the fly inside charge picker (Amount strictly Nil / 0!)
  const handleAddCustomChargeOnFly = () => {
    if (!customChargeInput.trim()) return;
    const nameTrimmed = customChargeInput.trim();
    const lowerKey = nameTrimmed.toLowerCase();
    const newItem = {
      id: `custom_${Date.now()}`,
      name: nameTrimmed,
      category: normSelectedCategory,
      chargeHead: 'Customs / Transit',
      defaultAmount: 0
    };

    setAllAvailableCharges(prev => [newItem, ...prev.filter(p => p.name.toLowerCase() !== lowerKey)]);
    setSelectedPickerCharges(prev => ({ ...prev, [lowerKey]: true }));
    setPickerAmounts(prev => ({ ...prev, [lowerKey]: prev[lowerKey] || '' }));
    setCustomChargeInput('');
  };

  // Apply selected charges from picker to the currently selected Case Category
  const handleApplyChargesFromPicker = () => {
    // Keep charges from OTHER categories untouched
    const otherCategoryCharges = chargesList.filter(
      c => getChargeCaseCategory(c, normSelectedCategory) !== normSelectedCategory
    );

    const existingCurrentMap = new Map<string, ClientDefaultCharge>();
    currentCategoryCharges.forEach(c => {
      existingCurrentMap.set(c.description.toLowerCase(), c);
    });

    const updatedCurrentCategoryCharges: ClientDefaultCharge[] = [];

    // Include any custom/existing charges in currentCategoryCharges that remain checked
    currentCategoryCharges.forEach(existingCh => {
      const key = existingCh.description.toLowerCase();
      if (selectedPickerCharges[key]) {
        const enteredAmt = pickerAmounts[key] !== undefined
          ? (pickerAmounts[key] === '' ? 0 : Number(pickerAmounts[key]))
          : existingCh.defaultAmount;
        updatedCurrentCategoryCharges.push({
          ...existingCh,
          category: normSelectedCategory,
          caseCategory: normSelectedCategory,
          defaultAmount: Number(enteredAmt) || 0
        });
      }
    });

    const addedSet = new Set(updatedCurrentCategoryCharges.map(c => c.description.toLowerCase()));

    allAvailableCharges.forEach(item => {
      const key = item.name.toLowerCase();
      const isSelected = selectedPickerCharges[key];
      if (isSelected && !addedSet.has(key)) {
        const enteredAmt = pickerAmounts[key] ? Number(pickerAmounts[key]) || 0 : 0;
        updatedCurrentCategoryCharges.push({
          id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          category: normSelectedCategory,
          caseCategory: normSelectedCategory,
          chargeHead: item.chargeHead || 'Customs / Transit',
          description: item.name,
          defaultAmount: enteredAmt,
          taxable: true
        });
        addedSet.add(key);
      }
    });

    setChargesList([...otherCategoryCharges, ...updatedCurrentCategoryCharges]);
    setShowChargePicker(false);
  };

  // Save client and tariff
  const handleSave = async () => {
    if (!name.trim()) {
      alert('Please enter Client / Company Title');
      return;
    }

    // Validate that every selected default charge has an explicit amount > 0 entered by the user
    const chargeMissingAmount = chargesList.find(
      c => c.description.trim() && (!c.defaultAmount || Number(c.defaultAmount) <= 0)
    );
    if (chargeMissingAmount) {
      const missingCat = getChargeCaseCategory(chargeMissingAmount, normSelectedCategory);
      if (missingCat !== normSelectedCategory) {
        setSelectedCategory(missingCat);
      }
      alert(`Please enter an amount (PKR) for the selected default charge "${chargeMissingAmount.description}" under category "${missingCat}" before saving (default charges cannot be saved with Nil / 0 amount).`);
      return;
    }

    const clientId = initialClient?.id || `client_${Date.now()}`;
    const trimmedName = name.trim();

    // Only save charges that have a description and valid user-entered amount > 0
    const validDefaultCharges: ClientDefaultCharge[] = chargesList
      .filter(c => c.description.trim() && Number(c.defaultAmount) > 0)
      .map(c => {
        const catKey = getChargeCaseCategory(c, normSelectedCategory);
        return {
          id: c.id,
          category: catKey,
          caseCategory: catKey,
          chargeHead: c.chargeHead || 'Customs / Transit',
          description: c.description.trim(),
          defaultAmount: Number(c.defaultAmount) || 0,
          taxable: c.taxable ?? false
        };
      });

    const finalCatArrangementsMap: Record<string, Record<string, 'DPL' | 'Client'>> = {
      ...categoryArrangementsMap,
      [normSelectedCategory]: arrangements
    };

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
      defaultCaseCategory: normSelectedCategory,
      defaultServiceArrangements: arrangements,
      categoryServiceArrangements: finalCatArrangementsMap,
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

    // Convert valid default charges FOR THE SELECTED CATEGORY ONLY to CaseCharge array
    const appliedCharges: CaseCharge[] = validDefaultCharges
      .filter(ch => getChargeCaseCategory(ch, normSelectedCategory) === normSelectedCategory)
      .map((ch, idx) => ({
        id: `chg_app_${Date.now()}_${idx}`,
        category: normSelectedCategory,
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
      categoryServiceArrangements: categoryArrangementsMap,
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
    return c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || c.chargeHead.toLowerCase().includes(q);
  });

  const activeDefaultChargesCount = currentCategoryCharges.filter(c => (Number(c.defaultAmount) || 0) > 0).length;
  const totalDefaultAmount = currentCategoryCharges.reduce((sum, c) => sum + (Number(c.defaultAmount) || 0), 0);

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
          {/* SECTION 3: FINANCE & BY-DEFAULT CHARGES TARIFF (CATEGORY-WISE) */}
          {/* ========================================================================= */}
          <div className="space-y-4 bg-slate-950/60 p-5 rounded-xl border border-white/10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-white/10 pb-2.5">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  <DollarSign size={15} />
                  <span>3. Default Billing Charges Tariff — {normSelectedCategory}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Charges configured here apply automatically ONLY to <strong className="text-amber-300">{normSelectedCategory}</strong> cases for this client.
                </p>
              </div>
              {!isClientView && (
                <button
                  type="button"
                  onClick={handleOpenChargePicker}
                  className="h-9 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-3.5 rounded-xl shadow transition flex items-center gap-1.5 self-start sm:self-auto cursor-pointer shrink-0"
                >
                  <Plus size={14} /> Add Default Charge ({normSelectedCategory})
                </button>
              )}
            </div>

            {/* Charges List Table for Selected Category */}
            <div className="space-y-2.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
              {currentCategoryCharges.length === 0 ? (
                <div className="p-5 text-center text-xs text-slate-400 bg-slate-900 rounded-xl border border-white/5">
                  No default charges configured for <strong className="text-white">{normSelectedCategory}</strong> yet (Amount: Nil). Click &quot;+ Add Default Charge&quot; to select charge heads and enter their amounts for this category.
                </div>
              ) : (
                currentCategoryCharges.map((ch, idx) => {
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
                            const newVal = e.target.value;
                            setChargesList(prev => prev.map(item => item.id === ch.id ? { ...item, description: newVal } : item));
                          }}
                          placeholder="Charge description"
                          className="w-full h-9 rounded-lg px-3 text-xs text-white bg-slate-950 border border-white/10 focus:border-amber-400 outline-none"
                        />
                      </div>

                      <div className="w-full sm:w-44">
                        <select
                          value={ch.chargeHead || 'Customs / Transit'}
                          disabled={isClientView}
                          onChange={(e) => {
                            const newHead = e.target.value;
                            setChargesList(prev => prev.map(item => item.id === ch.id ? { ...item, chargeHead: newHead } : item));
                          }}
                          className="w-full h-9 rounded-lg px-2.5 text-xs text-white bg-slate-950 border border-white/10 outline-none"
                        >
                          <option value="Customs / Transit">Customs / Transit</option>
                          <option value="Freight / Haulage">Freight / Haulage</option>
                          <option value="Documentation">Documentation</option>
                          <option value="Port & Terminal">Port & Terminal</option>
                          <option value="Agency">Agency</option>
                          <option value="Security / Tracking">Security / Tracking</option>
                          <option value="Miscellaneous">Miscellaneous</option>
                        </select>
                      </div>

                      <div className="w-full sm:w-40 flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 font-mono">PKR</span>
                        <input 
                          type="number"
                          placeholder="Enter Amount *"
                          value={ch.defaultAmount === 0 ? '' : ch.defaultAmount}
                          disabled={isClientView}
                          readOnly={isClientView}
                          onChange={(e) => {
                            const newAmt = e.target.value === '' ? 0 : Number(e.target.value);
                            setChargesList(prev => prev.map(item => item.id === ch.id ? { ...item, defaultAmount: newAmt } : item));
                          }}
                          className={`w-full h-9 rounded-lg px-3 text-xs font-mono font-bold outline-none border ${
                            hasAmount 
                              ? 'text-emerald-300 border-emerald-500/40 bg-emerald-950/30' 
                              : 'text-amber-300 bg-slate-950 border-amber-500/50 placeholder:text-amber-400/70'
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
                              const checked = e.target.checked;
                              setChargesList(prev => prev.map(item => item.id === ch.id ? { ...item, taxable: checked } : item));
                            }}
                            className="rounded text-amber-500 focus:ring-0"
                          />
                          <span>Taxable</span>
                        </label>

                        {!isClientView && (
                          <button
                            type="button"
                            onClick={() => {
                              setChargesList(prev => prev.filter(item => item.id !== ch.id));
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
                  Active Default Charges for {normSelectedCategory} ({activeDefaultChargesCount} items):
                </span>
                <span className="text-xs text-slate-400">
                  Automatically applied when registering <strong className="text-slate-200">{normSelectedCategory}</strong> cases for this client
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
                  <span>Select Default Charges — {normSelectedCategory}</span>
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  All charges start at Nil (0). Select charges and enter the amount for <strong className="text-amber-300">{normSelectedCategory}</strong>.
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
                  const lowerKey = item.name.toLowerCase();
                  const isChecked = selectedPickerCharges[lowerKey] ?? false;
                  const amtValue = pickerAmounts[lowerKey] ?? '';

                  return (
                    <div 
                      key={`picker_chg_${item.id || idx}_${idx}`}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                        isChecked 
                          ? 'bg-emerald-950/30 border-emerald-500/40 text-white' 
                          : 'bg-slate-950/60 border-white/10 text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <label className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                        <input 
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSelectedPickerCharges(prev => ({
                              ...prev,
                              [lowerKey]: checked
                            }));
                            if (!checked) {
                              setPickerAmounts(prev => ({ ...prev, [lowerKey]: '' }));
                            }
                          }}
                          className="rounded text-emerald-500 focus:ring-0 w-4 h-4 shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-semibold block truncate">{item.name}</span>
                          <span className="text-[11px] text-slate-400">{item.chargeHead}</span>
                        </div>
                      </label>

                      {isChecked ? (
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <span className="text-xs font-mono text-emerald-400 font-bold">PKR</span>
                          <input
                            type="number"
                            placeholder="Enter Amount *"
                            value={amtValue}
                            onChange={(e) => {
                              setPickerAmounts(prev => ({
                                ...prev,
                                [lowerKey]: e.target.value
                              }));
                            }}
                            className="w-36 h-8 px-2.5 rounded-lg bg-slate-950 border border-emerald-500/50 text-xs font-mono font-bold text-emerald-300 outline-none focus:border-amber-400 placeholder:text-amber-400/70"
                          />
                        </div>
                      ) : (
                        <span className="text-[11px] font-mono text-slate-500 shrink-0">
                          Nil (Select to enter amount)
                        </span>
                      )}
                    </div>
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

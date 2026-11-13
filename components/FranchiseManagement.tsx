import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus,
  Search,
  MapPin,
  Building2,
  User,
  Phone,
  CreditCard,
  FileText,
  Upload,
  Eye,
  Edit,
  Trash2,
  BookOpen,
  ArrowLeft,
  Check,
  X,
  RefreshCw,
  Users,
  Container as ContainerIcon,
  Calendar,
  Download,
  AlertTriangle,
  Wallet,
  CheckCircle2
} from 'lucide-react';
import {
  Case,
  CorporateRecipientEntity,
  FranchiseAllocationMode,
  FranchiseBillingType,
  FranchiseLedgerEntry,
  FranchisePortStaffMember,
  FranchiseProfile,
  PortItem
} from '../types';
import {
  ALL_ALLOCATABLE_DRY_PORTS,
  PAKISTAN_DRY_PORT_CITIES,
  RECIPIENT_ENTITIES,
  getDryPortsForCities
} from '../services/corporateFilingArchitecture';
import {
  subscribeToFranchises,
  saveFranchiseToFirestore,
  deleteFranchiseFromFirestore,
  subscribeToFranchiseLedgerEntries,
  saveFranchiseLedgerEntryToFirestore,
  deleteFranchiseLedgerEntryFromFirestore,
  subscribeToCases,
  syncFranchiseContainerCharges,
  postMonthlyFixedFranchiseCharge,
  saveFinanceToFirestore
} from '../services/dbService';
import { resolveStoredDocumentDataUrl } from '../services/documentStorage';
import { downloadClientLedgerPdf } from '../services/pdfExportService';
import { safeAppStorage } from '../services/storage';
import { useActiveCompany } from '../services/companyService';
import { UniversalDocumentPreviewModal } from './UniversalDocumentPreviewModal';

export type FranchiseSubView = 'LIST' | 'FORM' | 'LEDGER';

export interface FranchiseManagementProps {
  externalSubView?: FranchiseSubView;
  onSubViewChange?: (
    subView: FranchiseSubView,
    contextTitle?: string,
    isEditing?: boolean
  ) => void;
}

function readUploadAsDataUrl(file: File): Promise<{ name: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      resolve({
        name: file.name,
        dataUrl: String(ev.target?.result || '')
      });
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

export const FranchiseManagement: React.FC<FranchiseManagementProps> = ({
  externalSubView,
  onSubViewChange
}) => {
  const { activeCompany } = useActiveCompany();
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);
  const currentYearMonth = useMemo(() => todayIso.slice(0, 7), [todayIso]);

  const [franchises, setFranchises] = useState<FranchiseProfile[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<FranchiseLedgerEntry[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncingCases, setIsSyncingCases] = useState<boolean>(false);

  const [subView, setSubView] = useState<FranchiseSubView>('LIST');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [billingFilter, setBillingFilter] = useState<'ALL' | FranchiseBillingType>('ALL');

  // Add / Edit Form State
  const [editingFranchise, setEditingFranchise] = useState<FranchiseProfile | null>(null);
  const [businessTitle, setBusinessTitle] = useState<string>('');
  const [ownerName, setOwnerName] = useState<string>('');
  const [contactNumber, setContactNumber] = useState<string>('');
  const [idCardNumber, setIdCardNumber] = useState<string>('');
  const [recipientEntity, setRecipientEntity] = useState<CorporateRecipientEntity | string>('Docks');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  // 3 Document Uploads
  const [idCardDocUrl, setIdCardDocUrl] = useState<string>('');
  const [idCardDocName, setIdCardDocName] = useState<string>('');
  const [ntnCertificateUrl, setNtnCertificateUrl] = useState<string>('');
  const [ntnCertificateName, setNtnCertificateName] = useState<string>('');
  const [franchiseAgreementUrl, setFranchiseAgreementUrl] = useState<string>('');
  const [franchiseAgreementName, setFranchiseAgreementName] = useState<string>('');

  const idCardInputRef = useRef<HTMLInputElement>(null);
  const ntnInputRef = useRef<HTMLInputElement>(null);
  const agreementInputRef = useRef<HTMLInputElement>(null);

  // Port Staff Dynamic Repeater
  const [portStaff, setPortStaff] = useState<FranchisePortStaffMember[]>([]);

  // Billing & Pricing Structure
  const [billingType, setBillingType] = useState<FranchiseBillingType>('PER_CONTAINER');
  const [perContainerAmount, setPerContainerAmount] = useState<string>('');
  const [fixedMonthlyAmount, setFixedMonthlyAmount] = useState<string>('');

  // Destination & Dry Port Allocation
  const [allocationMode, setAllocationMode] = useState<FranchiseAllocationMode>('CITY');
  const [allocatedCities, setAllocatedCities] = useState<string[]>([]);
  const [allocatedDryPorts, setAllocatedDryPorts] = useState<string[]>([]);
  const [dryPortSearch, setDryPortSearch] = useState<string>('');
  const [customDryPortInput, setCustomDryPortInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Active Franchise for Ledger View
  const [selectedFranchiseId, setSelectedFranchiseId] = useState<string | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState<string>('');

  // Payment / Manual Entry Modal inside Ledger View
  const [isEntryModalOpen, setIsEntryModalOpen] = useState<boolean>(false);
  const [entryModalMode, setEntryModalMode] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [entryAmount, setEntryAmount] = useState<string>('');
  const [entryDate, setEntryDate] = useState<string>(todayIso);
  const [entryPaymentMethod, setEntryPaymentMethod] = useState<'CASH' | 'BANK'>('BANK');
  const [entryReference, setEntryReference] = useState<string>('');
  const [entryDescription, setEntryDescription] = useState<string>('');
  const [syncPaymentToCashbook, setSyncPaymentToCashbook] = useState<boolean>(true);
  const [isSavingEntry, setIsSavingEntry] = useState<boolean>(false);
  const [entryError, setEntryError] = useState<string | null>(null);

  // Delete Confirmation Modals
  const [franchisePendingDelete, setFranchisePendingDelete] = useState<FranchiseProfile | null>(null);
  const [ledgerEntryPendingDelete, setLedgerEntryPendingDelete] = useState<FranchiseLedgerEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Document Preview Modal
  const [previewDocTitle, setPreviewDocTitle] = useState<string>('');
  const [previewDocFile, setPreviewDocFile] = useState<string | null>(null);

  // Sync external breadcrumb navigation (e.g., clicking "Franchise Management" in parent breadcrumb returns to LIST)
  useEffect(() => {
    if (externalSubView && externalSubView !== subView) {
      setSubView(externalSubView);
    }
  }, [externalSubView, subView]);

  const changeSubView = (
    next: FranchiseSubView,
    contextTitle?: string,
    editingFlag?: boolean
  ) => {
    setSubView(next);
    if (onSubViewChange) {
      onSubViewChange(next, contextTitle, editingFlag);
    }
  };

  // Merge official dry ports with any custom dry ports configured in Case Management (`dpl_ports`)
  const availableDryPorts = useMemo(() => {
    const customPorts = safeAppStorage.getJSON<PortItem[]>('dpl_ports', []) || [];
    const customNames = customPorts
      .filter((p) => p && p.name && p.type !== 'Sea Port')
      .map((p) => p.name.trim());
    return Array.from(new Set([...ALL_ALLOCATABLE_DRY_PORTS, ...customNames])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, []);

  // Subscribe to Franchises, Franchise Ledgers, and Operational Cases in Real Time
  useEffect(() => {
    setIsLoading(true);
    let frLoaded = false;
    let ledLoaded = false;

    const unsubFranchises = subscribeToFranchises((items) => {
      setFranchises(items || []);
      frLoaded = true;
      if (ledLoaded) setIsLoading(false);
    });

    const unsubLedger = subscribeToFranchiseLedgerEntries((items) => {
      setLedgerEntries(items || []);
      ledLoaded = true;
      if (frLoaded) setIsLoading(false);
    });

    const unsubCases = subscribeToCases((caseItems) => {
      setCases(caseItems || []);
    });

    return () => {
      unsubFranchises();
      unsubLedger();
      unsubCases();
    };
  }, []);

  // Real-Time Automated Container Dispatch/Unloading Sync whenever cases or franchises update
  useEffect(() => {
    if (franchises.length === 0 || cases.length === 0) return;
    const hasPerContainerFranchise = franchises.some(
      (f) => f.status === 'ACTIVE' && f.billingType === 'PER_CONTAINER' && Number(f.perContainerAmount) > 0
    );
    if (!hasPerContainerFranchise) return;

    syncFranchiseContainerCharges({ cases, franchises }).catch(() => {});
  }, [cases, franchises]);

  // Financial summaries per Franchise
  const statsByFranchise = useMemo(() => {
    const map = new Map<
      string,
      { totalDebit: number; totalCredit: number; balance: number; containerCount: number; entryCount: number }
    >();
    for (const f of franchises) {
      map.set(f.id, { totalDebit: 0, totalCredit: 0, balance: 0, containerCount: 0, entryCount: 0 });
    }
    for (const entry of ledgerEntries) {
      const curr = map.get(entry.franchiseId) || {
        totalDebit: 0,
        totalCredit: 0,
        balance: 0,
        containerCount: 0,
        entryCount: 0
      };
      const amt = Number(entry.amount) || 0;
      if (entry.type === 'DEBIT') {
        curr.totalDebit += amt;
        curr.containerCount += Number(entry.containerCount) || 0;
      } else {
        curr.totalCredit += amt;
      }
      curr.balance = curr.totalDebit - curr.totalCredit;
      curr.entryCount += 1;
      map.set(entry.franchiseId, curr);
    }
    return map;
  }, [franchises, ledgerEntries]);

  const globalSummary = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    let totalContainers = 0;
    for (const [, st] of statsByFranchise) {
      totalDebit += st.totalDebit;
      totalCredit += st.totalCredit;
      totalContainers += st.containerCount;
    }
    return {
      activeCount: franchises.filter((f) => f.status === 'ACTIVE').length,
      totalCount: franchises.length,
      totalDebit,
      totalCredit,
      netPayable: totalDebit - totalCredit,
      totalContainers
    };
  }, [franchises, statsByFranchise]);

  const filteredFranchises = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return franchises.filter((f) => {
      if (billingFilter !== 'ALL' && f.billingType !== billingFilter) return false;
      if (!q) return true;
      const haystack = [
        f.businessTitle,
        f.ownerName,
        f.contactNumber,
        f.idCardNumber,
        f.recipientEntity,
        ...(f.allocatedCities || []),
        ...(f.allocatedDryPorts || []),
        ...(f.portStaff || []).map((s) => `${s.name} ${s.contactNumber}`)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [franchises, searchQuery, billingFilter]);

  const selectedFranchise = useMemo(
    () => franchises.find((f) => f.id === selectedFranchiseId) || null,
    [franchises, selectedFranchiseId]
  );

  // Ordered running-balance rows for Selected Franchise Ledger
  const selectedFranchiseLedgerRows = useMemo(() => {
    if (!selectedFranchise) return [];
    const raw = ledgerEntries
      .filter((e) => e.franchiseId === selectedFranchise.id)
      .slice()
      .sort((a, b) => {
        const dComp = String(a.date || '').localeCompare(String(b.date || ''));
        if (dComp !== 0) return dComp;
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      });

    let running = 0;
    const withBalance = raw.map((e) => {
      const amt = Number(e.amount) || 0;
      if (e.type === 'DEBIT') running += amt;
      else running -= amt;
      return { ...e, runningBalance: running };
    });

    const q = ledgerSearch.trim().toLowerCase();
    const reversed = withBalance.reverse();
    if (!q) return reversed;
    return reversed.filter((r) =>
      [r.caseNo, r.pod, r.description, r.reference, r.containerNumbers, r.date]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [selectedFranchise, ledgerEntries, ledgerSearch]);

  // Open Registration Form
  const handleOpenCreateForm = () => {
    setEditingFranchise(null);
    setBusinessTitle('');
    setOwnerName('');
    setContactNumber('');
    setIdCardNumber('');
    setRecipientEntity(
      activeCompany?.id === 'truckit'
        ? 'Truckit'
        : activeCompany?.id === 'muhib'
          ? 'Muhib'
          : activeCompany?.id === 'vantage'
            ? 'Vantage'
            : 'Docks'
    );
    setStatus('ACTIVE');
    setIdCardDocUrl('');
    setIdCardDocName('');
    setNtnCertificateUrl('');
    setNtnCertificateName('');
    setFranchiseAgreementUrl('');
    setFranchiseAgreementName('');
    setPortStaff([]);
    setBillingType('PER_CONTAINER');
    setPerContainerAmount('');
    setFixedMonthlyAmount('');
    setAllocationMode('CITY');
    setAllocatedCities([]);
    setAllocatedDryPorts([]);
    setDryPortSearch('');
    setCustomDryPortInput('');
    setNotes('');
    setFormError(null);
    changeSubView('FORM', 'Add Franchise', false);
  };

  const handleOpenEditForm = (f: FranchiseProfile) => {
    setEditingFranchise(f);
    setBusinessTitle(f.businessTitle || '');
    setOwnerName(f.ownerName || '');
    setContactNumber(f.contactNumber || '');
    setIdCardNumber(f.idCardNumber || '');
    setRecipientEntity(f.recipientEntity || 'Docks');
    setStatus(f.status || 'ACTIVE');
    setIdCardDocUrl(f.idCardDocUrl || '');
    setIdCardDocName(f.idCardDocName || '');
    setNtnCertificateUrl(f.ntnCertificateUrl || '');
    setNtnCertificateName(f.ntnCertificateName || '');
    setFranchiseAgreementUrl(f.franchiseAgreementUrl || '');
    setFranchiseAgreementName(f.franchiseAgreementName || '');
    setPortStaff(Array.isArray(f.portStaff) ? f.portStaff : []);
    setBillingType(f.billingType || 'PER_CONTAINER');
    setPerContainerAmount(f.perContainerAmount ? String(f.perContainerAmount) : '');
    setFixedMonthlyAmount(f.fixedMonthlyAmount ? String(f.fixedMonthlyAmount) : '');
    setAllocationMode(f.allocationMode || 'CITY');
    setAllocatedCities(Array.isArray(f.allocatedCities) ? f.allocatedCities : []);
    setAllocatedDryPorts(Array.isArray(f.allocatedDryPorts) ? f.allocatedDryPorts : []);
    setDryPortSearch('');
    setCustomDryPortInput('');
    setNotes(f.notes || '');
    setFormError(null);
    changeSubView('FORM', `Edit ${f.businessTitle}`, true);
  };

  const handleOpenLedger = (f: FranchiseProfile) => {
    setSelectedFranchiseId(f.id);
    setLedgerSearch('');
    changeSubView('LEDGER', `${f.businessTitle} Ledger`, false);
  };

  const handleUploadSlot = async (
    file: File | undefined,
    slot: 'ID_CARD' | 'NTN' | 'AGREEMENT'
  ) => {
    if (!file) return;
    try {
      const { name, dataUrl } = await readUploadAsDataUrl(file);
      if (slot === 'ID_CARD') {
        setIdCardDocUrl(dataUrl);
        setIdCardDocName(name);
      } else if (slot === 'NTN') {
        setNtnCertificateUrl(dataUrl);
        setNtnCertificateName(name);
      } else {
        setFranchiseAgreementUrl(dataUrl);
        setFranchiseAgreementName(name);
      }
    } catch (err: any) {
      setFormError(err?.message || 'Unable to read uploaded document.');
    }
  };

  const handlePreviewStoredDoc = async (
    rawUrl: string | undefined,
    docIdHint: string,
    titleLabel: string
  ) => {
    if (!rawUrl) return;
    setPreviewDocTitle(titleLabel);
    const resolved = await resolveStoredDocumentDataUrl({
      url: rawUrl,
      id: docIdHint,
      name: titleLabel
    });
    setPreviewDocFile(resolved || rawUrl);
  };

  const handleAddStaffRow = () => {
    setPortStaff((prev) => [
      ...prev,
      {
        id: `pstaff_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: '',
        contactNumber: '',
        designation: ''
      }
    ]);
  };

  const handleUpdateStaffRow = (
    id: string,
    field: keyof FranchisePortStaffMember,
    value: string
  ) => {
    setPortStaff((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const handleRemoveStaffRow = (id: string) => {
    setPortStaff((prev) => prev.filter((row) => row.id !== id));
  };

  const toggleCitySelection = (city: string) => {
    setAllocatedCities((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]
    );
  };

  const toggleDryPortSelection = (portName: string) => {
    setAllocatedDryPorts((prev) =>
      prev.includes(portName) ? prev.filter((p) => p !== portName) : [...prev, portName]
    );
  };

  const handleAddCustomDryPort = () => {
    const clean = customDryPortInput.trim();
    if (!clean) return;
    if (!allocatedDryPorts.includes(clean)) {
      setAllocatedDryPorts((prev) => [...prev, clean]);
    }
    setCustomDryPortInput('');
  };

  const handleSaveFranchise = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!businessTitle.trim()) {
      setFormError('Please enter the Franchise Business Title.');
      return;
    }
    if (!ownerName.trim()) {
      setFormError("Please enter the Franchise Owner's Name.");
      return;
    }
    if (!contactNumber.trim()) {
      setFormError('Please enter the Contact Number.');
      return;
    }
    if (!idCardNumber.trim()) {
      setFormError('Please enter the Owner ID Card Number.');
      return;
    }

    if (billingType === 'PER_CONTAINER') {
      const rate = Number(perContainerAmount);
      if (!rate || rate <= 0) {
        setFormError('Please enter a valid Per-Container Charge amount greater than 0.');
        return;
      }
    } else {
      const fixed = Number(fixedMonthlyAmount);
      if (!fixed || fixed <= 0) {
        setFormError('Please enter a valid Fixed Monthly Amount greater than 0.');
        return;
      }
    }

    if (allocationMode === 'CITY' && allocatedCities.length === 0) {
      setFormError('Please select at least one City for City-wide Dry Port allocation.');
      return;
    }
    if (allocationMode === 'SPECIFIC_PORTS' && allocatedDryPorts.length === 0) {
      setFormError('Please select at least one Dry Port or Terminal.');
      return;
    }

    const cleanedStaff = portStaff
      .map((s) => ({
        id: s.id,
        name: s.name.trim(),
        contactNumber: s.contactNumber.trim(),
        designation: (s.designation || '').trim() || undefined
      }))
      .filter((s) => s.name || s.contactNumber);

    setIsSaving(true);
    try {
      const derivedPorts =
        allocationMode === 'CITY'
          ? getDryPortsForCities(allocatedCities)
          : allocatedDryPorts;

      const record: FranchiseProfile = {
        id:
          editingFranchise?.id ||
          `fr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        companyId: editingFranchise?.companyId || activeCompany?.id,
        businessTitle: businessTitle.trim(),
        ownerName: ownerName.trim(),
        contactNumber: contactNumber.trim(),
        idCardNumber: idCardNumber.trim(),
        idCardDocUrl: idCardDocUrl || undefined,
        idCardDocName: idCardDocName || undefined,
        ntnCertificateUrl: ntnCertificateUrl || undefined,
        ntnCertificateName: ntnCertificateName || undefined,
        franchiseAgreementUrl: franchiseAgreementUrl || undefined,
        franchiseAgreementName: franchiseAgreementName || undefined,
        portStaff: cleanedStaff,
        billingType,
        perContainerAmount: billingType === 'PER_CONTAINER' ? Number(perContainerAmount) : 0,
        fixedMonthlyAmount: billingType === 'FIXED_MONTHLY' ? Number(fixedMonthlyAmount) : 0,
        allocationMode,
        allocatedCities: allocationMode === 'CITY' ? allocatedCities : [],
        allocatedDryPorts: derivedPorts,
        recipientEntity,
        status,
        notes: notes.trim() || undefined,
        createdAt: editingFranchise?.createdAt || new Date().toISOString()
      };

      await saveFranchiseToFirestore(record);
      changeSubView('LIST');
    } catch (err: any) {
      setFormError(err?.message || 'Unable to save franchise profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualSyncContainers = async () => {
    setIsSyncingCases(true);
    try {
      await syncFranchiseContainerCharges({
        cases: cases.length > 0 ? cases : undefined,
        franchises: franchises.length > 0 ? franchises : undefined
      });
    } finally {
      setIsSyncingCases(false);
    }
  };

  const handleOpenLedgerEntryModal = (mode: 'CREDIT' | 'DEBIT') => {
    setEntryModalMode(mode);
    setEntryAmount('');
    setEntryDate(todayIso);
    setEntryPaymentMethod('BANK');
    setEntryReference('');
    setEntryDescription('');
    setSyncPaymentToCashbook(mode === 'CREDIT');
    setEntryError(null);
    setIsEntryModalOpen(true);
  };

  const handleSaveLedgerEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFranchise) return;
    setEntryError(null);

    const amt = Number(entryAmount);
    if (!amt || amt <= 0) {
      setEntryError('Please enter a valid amount greater than 0.');
      return;
    }

    setIsSavingEntry(true);
    try {
      const desc =
        entryDescription.trim() ||
        (entryModalMode === 'CREDIT'
          ? `Franchise Settlement Payment (${entryPaymentMethod}) — ${selectedFranchise.businessTitle}`
          : `Franchise Port Operations Charge — ${selectedFranchise.businessTitle}`);

      const entry: FranchiseLedgerEntry = {
        id: `frled_manual_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        companyId: selectedFranchise.companyId || activeCompany?.id,
        franchiseId: selectedFranchise.id,
        franchiseName: selectedFranchise.businessTitle,
        date: entryDate || todayIso,
        type: entryModalMode,
        amount: amt,
        description: desc,
        reference: entryReference.trim() || undefined,
        paymentMethod: entryModalMode === 'CREDIT' ? entryPaymentMethod : undefined,
        autoGenerated: false,
        createdAt: new Date().toISOString()
      };

      await saveFranchiseLedgerEntryToFirestore(entry);

      if (entryModalMode === 'CREDIT' && syncPaymentToCashbook) {
        await saveFinanceToFirestore({
          id: Date.now(),
          companyId: selectedFranchise.companyId || activeCompany?.id,
          date: entryDate || todayIso,
          description: `Franchise Payment: ${selectedFranchise.businessTitle} — ${desc}`,
          amount: amt,
          type: 'EXPENSE',
          status: 'PAID',
          party: selectedFranchise.businessTitle,
          category: 'Franchise Port Settlement',
          reference: entryReference.trim() || entry.id,
          paymentMethod: entryPaymentMethod
        });
      }

      setIsEntryModalOpen(false);
    } catch (err: any) {
      setEntryError(err?.message || 'Unable to save ledger entry.');
    } finally {
      setIsSavingEntry(false);
    }
  };

  const handlePostFixedMonthlyFee = async () => {
    if (!selectedFranchise) return;
    setIsSyncingCases(true);
    try {
      await postMonthlyFixedFranchiseCharge(selectedFranchise, currentYearMonth);
    } finally {
      setIsSyncingCases(false);
    }
  };

  const handleExportFranchiseStatementPdf = () => {
    if (!selectedFranchise) return;
    const chronological = [...selectedFranchiseLedgerRows].reverse();
    const mappedEntries = chronological.map((row) => ({
      date: row.date,
      reference: row.reference || row.caseNo || '-',
      description: row.pod ? `${row.description} (${row.pod})` : row.description,
      debit: row.type === 'DEBIT' ? row.amount : 0,
      credit: row.type === 'CREDIT' ? row.amount : 0,
      balance: row.runningBalance
    }));

    const st = statsByFranchise.get(selectedFranchise.id) || {
      totalDebit: 0,
      totalCredit: 0,
      balance: 0,
      containerCount: 0,
      entryCount: 0
    };

    void downloadClientLedgerPdf({
      clientName: `${selectedFranchise.businessTitle} (${selectedFranchise.ownerName})`,
      statementDate: new Date().toISOString().split('T')[0],
      summary: {
        totalDebits: st.totalDebit,
        totalCredits: st.totalCredit,
        netBalance: st.balance,
        totalContainers: st.containerCount
      },
      entries: mappedEntries
    });
  };

  const handleConfirmDeleteFranchise = async () => {
    if (!franchisePendingDelete) return;
    setIsDeleting(true);
    try {
      const targetId = franchisePendingDelete.id;
      const associatedEntries = ledgerEntries.filter((e) => e.franchiseId === targetId);
      await Promise.all([
        deleteFranchiseFromFirestore(targetId),
        ...associatedEntries.map((e) => deleteFranchiseLedgerEntryFromFirestore(e.id))
      ]);
      if (selectedFranchiseId === targetId) {
        setSelectedFranchiseId(null);
        changeSubView('LIST');
      }
      setFranchisePendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteLedgerEntry = async () => {
    if (!ledgerEntryPendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteFranchiseLedgerEntryFromFirestore(ledgerEntryPendingDelete.id);
      setLedgerEntryPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // ============================================================================
  // SUB-VIEW 1: ADD / EDIT FRANCHISE REGISTRATION & ALLOCATION FORM
  // ============================================================================
  if (subView === 'FORM') {
    const visiblePorts = availableDryPorts.filter((p) =>
      !dryPortSearch.trim()
        ? true
        : p.toLowerCase().includes(dryPortSearch.trim().toLowerCase())
    );

    const previewCoveredCityPorts = getDryPortsForCities(allocatedCities);

    return (
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => changeSubView('LIST')}
              className="mak-btn-secondary p-2 rounded-xl text-gray-300 hover:text-white cursor-pointer shrink-0"
              title="Back to Franchise Directory"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-white truncate">
                {editingFranchise ? `Edit Franchise — ${editingFranchise.businessTitle}` : 'Register New Franchise'}
              </h3>
              <p className="text-xs text-gray-400 truncate">
                Configure business profile, statutory documents, port staff, billing structure, and city or dry port allocation.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => changeSubView('LIST')}
            className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
        </div>

        {formError && (
          <div className="px-4 sm:px-6 py-3 bg-rose-500/15 border-b border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle size={15} className="text-rose-400 shrink-0" />
            <span className="font-semibold">{formError}</span>
          </div>
        )}

        <form onSubmit={handleSaveFranchise} className="p-4 sm:p-6 space-y-6">
          {/* Section 1: Franchise Business & Owner Details */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h4 className="text-sm font-bold text-white">
                01. Business Profile & Owner Identification
              </h4>
              <div
                data-custom-control="true"
                className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-950 border border-white/10"
              >
                <button
                  type="button"
                  onClick={() => setStatus('ACTIVE')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    status === 'ACTIVE' ? 'bg-emerald-500 text-slate-950' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('INACTIVE')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    status === 'INACTIVE' ? 'bg-rose-500 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Inactive
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  Business Title *
                </label>
                <input
                  type="text"
                  value={businessTitle}
                  onChange={(e) => setBusinessTitle(e.target.value)}
                  placeholder="Enter registered franchise business title"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  Owner&apos;s Full Name *
                </label>
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Enter owner's full legal name"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  Contracting Group Entity *
                </label>
                <select
                  value={recipientEntity}
                  onChange={(e) => setRecipientEntity(e.target.value)}
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                >
                  {RECIPIENT_ENTITIES.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  Contact Number *
                </label>
                <input
                  type="text"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  placeholder="Enter mobile or office contact number"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-mono tabular-nums outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  Owner ID Card Number *
                </label>
                <input
                  type="text"
                  value={idCardNumber}
                  onChange={(e) => setIdCardNumber(e.target.value)}
                  placeholder="00000-0000000-0"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-mono tabular-nums outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  Operational Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional contract reference or clearance scope"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Mandatory / Statutory Document Uploads */}
          <div className="space-y-4">
            <div className="border-b border-white/10 pb-2">
              <h4 className="text-sm font-bold text-white">
                02. Compliance & Agreement Document Uploads
              </h4>
              <p className="text-xs text-gray-400 mt-0.5">
                Attach PDF or image copies of the Owner ID Card, Business NTN Certificate, and Signed Franchise Agreement.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Slot 1: ID Card Copy */}
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">Owner ID Card Copy</span>
                    <span className="text-[11px] text-gray-400">
                      {idCardDocUrl ? 'Attached' : 'PDF / Image'}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1 truncate">
                    {idCardDocName || (idCardDocUrl ? 'ID Card document uploaded' : 'No file selected')}
                  </p>
                </div>

                <input
                  ref={idCardInputRef}
                  type="file"
                  accept=".pdf,application/pdf,image/*"
                  onChange={(e) => handleUploadSlot(e.target.files?.[0], 'ID_CARD')}
                  className="hidden"
                />

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => idCardInputRef.current?.click()}
                    className="mak-btn-secondary flex-1 px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Upload size={13} className="text-sky-400" />
                    <span>{idCardDocUrl ? 'Replace File' : 'Upload ID Card'}</span>
                  </button>
                  {idCardDocUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        handlePreviewStoredDoc(
                          idCardDocUrl,
                          `${editingFranchise?.id || 'draft'}_idcard`,
                          `${businessTitle || 'Franchise'} — ID Card Copy`
                        )
                      }
                      className="mak-btn-secondary p-2 rounded-lg text-sky-400 hover:text-white cursor-pointer"
                      title="Preview ID Card Copy"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Slot 2: Business NTN Certificate */}
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">Business NTN Certificate</span>
                    <span className="text-[11px] text-gray-400">
                      {ntnCertificateUrl ? 'Attached' : 'PDF / Image'}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1 truncate">
                    {ntnCertificateName ||
                      (ntnCertificateUrl ? 'NTN Certificate uploaded' : 'No file selected')}
                  </p>
                </div>

                <input
                  ref={ntnInputRef}
                  type="file"
                  accept=".pdf,application/pdf,image/*"
                  onChange={(e) => handleUploadSlot(e.target.files?.[0], 'NTN')}
                  className="hidden"
                />

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => ntnInputRef.current?.click()}
                    className="mak-btn-secondary flex-1 px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Upload size={13} className="text-sky-400" />
                    <span>{ntnCertificateUrl ? 'Replace File' : 'Upload NTN'}</span>
                  </button>
                  {ntnCertificateUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        handlePreviewStoredDoc(
                          ntnCertificateUrl,
                          `${editingFranchise?.id || 'draft'}_ntn`,
                          `${businessTitle || 'Franchise'} — Business NTN Certificate`
                        )
                      }
                      className="mak-btn-secondary p-2 rounded-lg text-sky-400 hover:text-white cursor-pointer"
                      title="Preview Business NTN Certificate"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Slot 3: Signed Franchise Agreement */}
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">Signed Franchise Agreement</span>
                    <span className="text-[11px] text-gray-400">
                      {franchiseAgreementUrl ? 'Attached' : 'PDF / Image'}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1 truncate">
                    {franchiseAgreementName ||
                      (franchiseAgreementUrl ? 'Signed Agreement uploaded' : 'No file selected')}
                  </p>
                </div>

                <input
                  ref={agreementInputRef}
                  type="file"
                  accept=".pdf,application/pdf,image/*"
                  onChange={(e) => handleUploadSlot(e.target.files?.[0], 'AGREEMENT')}
                  className="hidden"
                />

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => agreementInputRef.current?.click()}
                    className="mak-btn-secondary flex-1 px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Upload size={13} className="text-sky-400" />
                    <span>{franchiseAgreementUrl ? 'Replace File' : 'Upload Agreement'}</span>
                  </button>
                  {franchiseAgreementUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        handlePreviewStoredDoc(
                          franchiseAgreementUrl,
                          `${editingFranchise?.id || 'draft'}_agreement`,
                          `${businessTitle || 'Franchise'} — Signed Franchise Agreement`
                        )
                      }
                      className="mak-btn-secondary p-2 rounded-lg text-sky-400 hover:text-white cursor-pointer"
                      title="Preview Signed Franchise Agreement"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Flexible Billing & Pricing Structure */}
          <div className="space-y-4">
            <div className="border-b border-white/10 pb-2">
              <h4 className="text-sm font-bold text-white">
                03. Flexible Billing & Pricing Structure
              </h4>
              <p className="text-xs text-gray-400 mt-0.5">
                Choose Per-Container Charge for automatic real-time ledger debits on container dispatch/unloading, or Fixed Monthly Amount.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div
                data-custom-control="true"
                className="grid grid-cols-2 gap-2 p-1.5 rounded-xl bg-slate-950 border border-white/10"
              >
                <button
                  type="button"
                  onClick={() => setBillingType('PER_CONTAINER')}
                  className={`px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    billingType === 'PER_CONTAINER'
                      ? 'bg-sky-500 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Per-Container Charge
                </button>
                <button
                  type="button"
                  onClick={() => setBillingType('FIXED_MONTHLY')}
                  className={`px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    billingType === 'FIXED_MONTHLY'
                      ? 'bg-sky-500 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Fixed Monthly Amount
                </button>
              </div>

              {billingType === 'PER_CONTAINER' ? (
                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                    Agreed Per-Container Charge (PKR) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={perContainerAmount}
                    onChange={(e) => setPerContainerAmount(e.target.value)}
                    placeholder="Enter per-container rate in PKR (e.g., 600)"
                    className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-mono tabular-nums outline-none"
                    required
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Automatically multiplied by container count and debited to this franchise&apos;s ledger whenever a case is dispatched or unloaded at an allocated port.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                    Agreed Fixed Monthly Retainer (PKR) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={fixedMonthlyAmount}
                    onChange={(e) => setFixedMonthlyAmount(e.target.value)}
                    placeholder="Enter fixed monthly fee in PKR"
                    className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-mono tabular-nums outline-none"
                    required
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Billed as a flat monthly franchise fee independent of container volume.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Destination & Dry Port Allocation Logic */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-2">
              <div>
                <h4 className="text-sm font-bold text-white">
                  04. Destination & Dry Port Allocation
                </h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  Allocate an entire City (covering all dry ports in that city automatically) or select Specific Dry Ports / Terminals.
                </p>
              </div>

              <div
                data-custom-control="true"
                className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-white/10 self-start"
              >
                <button
                  type="button"
                  onClick={() => setAllocationMode('CITY')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    allocationMode === 'CITY'
                      ? 'bg-sky-500 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Allocate by City
                </button>
                <button
                  type="button"
                  onClick={() => setAllocationMode('SPECIFIC_PORTS')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    allocationMode === 'SPECIFIC_PORTS'
                      ? 'bg-sky-500 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Specific Dry Ports
                </button>
              </div>
            </div>

            {allocationMode === 'CITY' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {PAKISTAN_DRY_PORT_CITIES.map((entry) => {
                    const isChecked = allocatedCities.includes(entry.city);
                    return (
                      <div
                        key={entry.city}
                        onClick={() => toggleCitySelection(entry.city)}
                        className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-sky-500/15 border-sky-400/50 text-white'
                            : 'bg-slate-950/50 border-white/10 text-gray-300 hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold">
                            {entry.city} · <span className="font-normal text-gray-400">{entry.region}</span>
                          </span>
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center border ${
                              isChecked
                                ? 'bg-sky-500 border-sky-400 text-white'
                                : 'border-white/20 bg-slate-900'
                            }`}
                          >
                            {isChecked && <Check size={11} />}
                          </div>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">
                          {entry.dryPorts.join(' · ')}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {previewCoveredCityPorts.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-white/10 text-xs text-gray-300">
                    <span className="font-semibold text-white">
                      Automatically Covered Terminals ({previewCoveredCityPorts.length}):{' '}
                    </span>
                    <span className="text-gray-400">{previewCoveredCityPorts.join(' · ')}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                    />
                    <input
                      type="text"
                      value={dryPortSearch}
                      onChange={(e) => setDryPortSearch(e.target.value)}
                      placeholder="Filter dry ports or border terminals..."
                      className="glass-input w-full pl-8 pr-3 py-2 rounded-xl text-xs outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customDryPortInput}
                      onChange={(e) => setCustomDryPortInput(e.target.value)}
                      placeholder="Add custom dry port / terminal"
                      className="glass-input w-full sm:w-56 px-3 py-2 rounded-xl text-xs outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomDryPort}
                      className="mak-btn-secondary px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                    >
                      + Add Terminal
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-1">
                  {visiblePorts.map((portName) => {
                    const isChecked = allocatedDryPorts.includes(portName);
                    return (
                      <div
                        key={portName}
                        onClick={() => toggleDryPortSelection(portName)}
                        className={`px-3 py-2.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-sky-500/15 border-sky-400/50 text-white'
                            : 'bg-slate-950/50 border-white/10 text-gray-300 hover:border-white/25'
                        }`}
                      >
                        <span className="text-xs font-medium truncate">{portName}</span>
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                            isChecked
                              ? 'bg-sky-500 border-sky-400 text-white'
                              : 'border-white/20 bg-slate-900'
                          }`}
                        >
                          {isChecked && <Check size={11} />}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {allocatedDryPorts.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-white/10 text-xs text-gray-300">
                    <span className="font-semibold text-white">
                      Selected Dry Ports ({allocatedDryPorts.length}):{' '}
                    </span>
                    <span className="text-gray-400">{allocatedDryPorts.join(' · ')}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 5: Optional Local Port Staff Directory */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
              <div>
                <h4 className="text-sm font-bold text-white">
                  05. Local Port Staff Details (Optional)
                </h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  Add one or multiple local port clearance representatives along with their contact numbers.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddStaffRow}
                className="mak-btn-secondary px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus size={14} className="text-sky-400" />
                <span>Add Port Staff</span>
              </button>
            </div>

            {portStaff.length === 0 ? (
              <p className="text-xs text-gray-500 py-2">
                No local port staff members added. Click &ldquo;Add Port Staff&rdquo; to include terminal representatives.
              </p>
            ) : (
              <div className="space-y-2.5">
                {portStaff.map((staff, idx) => (
                  <div
                    key={staff.id}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center p-3 rounded-xl bg-slate-950/50 border border-white/10"
                  >
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        value={staff.name}
                        onChange={(e) => handleUpdateStaffRow(staff.id, 'name', e.target.value)}
                        placeholder={`Staff Member #${idx + 1} Full Name`}
                        className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        value={staff.contactNumber}
                        onChange={(e) =>
                          handleUpdateStaffRow(staff.id, 'contactNumber', e.target.value)
                        }
                        placeholder="Contact Number"
                        className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <input
                        type="text"
                        value={staff.designation || ''}
                        onChange={(e) =>
                          handleUpdateStaffRow(staff.id, 'designation', e.target.value)
                        }
                        placeholder="Role / Terminal (Optional)"
                        className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleRemoveStaffRow(staff.id)}
                        className="p-2 rounded-lg text-gray-400 hover:text-rose-400 cursor-pointer"
                        title="Remove staff member"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit Footer */}
          <div className="pt-4 border-t border-white/10 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => changeSubView('LIST')}
              disabled={isSaving}
              className="mak-btn-secondary px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="mak-btn px-5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Check size={15} />
              <span>
                {isSaving
                  ? 'Saving Franchise...'
                  : editingFranchise
                    ? 'Update Franchise Profile'
                    : 'Register Franchise'}
              </span>
            </button>
          </div>
        </form>

        <UniversalDocumentPreviewModal
          isOpen={Boolean(previewDocFile)}
          onClose={() => setPreviewDocFile(null)}
          title={previewDocTitle}
          file={previewDocFile}
          filename={previewDocTitle || 'Franchise Document'}
        />
      </div>
    );
  }

  // ============================================================================
  // SUB-VIEW 2: REAL-TIME FRANCHISE PORT LEDGER ACCOUNT
  // ============================================================================
  if (subView === 'LEDGER' && selectedFranchise) {
    const fStats = statsByFranchise.get(selectedFranchise.id) || {
      totalDebit: 0,
      totalCredit: 0,
      balance: 0,
      containerCount: 0,
      entryCount: 0
    };

    const allocationSummary =
      selectedFranchise.allocationMode === 'CITY'
        ? `City Allocation: ${(selectedFranchise.allocatedCities || []).join(', ')}`
        : `Specific Dry Ports: ${(selectedFranchise.allocatedDryPorts || []).join(', ')}`;

    return (
      <div className="space-y-4">
        <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => changeSubView('LIST')}
                className="mak-btn-secondary p-2 rounded-xl text-gray-300 hover:text-white cursor-pointer shrink-0"
                title="Back to Franchise Directory"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-white truncate">
                  {selectedFranchise.businessTitle} — Real-Time Franchise Ledger
                </h3>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  Owner: {selectedFranchise.ownerName} · {selectedFranchise.contactNumber} ·{' '}
                  {selectedFranchise.billingType === 'PER_CONTAINER'
                    ? `PKR ${Number(selectedFranchise.perContainerAmount || 0).toLocaleString()} / Container`
                    : `PKR ${Number(selectedFranchise.fixedMonthlyAmount || 0).toLocaleString()} / Month`}{' '}
                  · {allocationSummary}
                </p>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-2 shrink-0">
              {selectedFranchise.billingType === 'PER_CONTAINER' ? (
                <button
                  type="button"
                  onClick={handleManualSyncContainers}
                  disabled={isSyncingCases}
                  className="mak-btn-secondary px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw size={14} className={isSyncingCases ? 'animate-spin text-sky-400' : 'text-sky-400'} />
                  <span>Sync Dispatched Containers</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePostFixedMonthlyFee}
                  disabled={isSyncingCases}
                  className="mak-btn-secondary px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Calendar size={14} className="text-amber-400" />
                  <span>Post {currentYearMonth} Monthly Fee</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleOpenLedgerEntryModal('DEBIT')}
                className="mak-btn-secondary px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus size={14} className="text-amber-400" />
                <span>Add Charge (Debit)</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenLedgerEntryModal('CREDIT')}
                className="mak-btn px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Wallet size={14} />
                <span>Record Payment (Credit)</span>
              </button>

              <button
                type="button"
                onClick={handleExportFranchiseStatementPdf}
                className="mak-btn-secondary px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Download size={14} className="text-emerald-400" />
                <span>Download PDF Statement</span>
              </button>
            </div>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/10 bg-slate-950/50 border-b border-white/10">
            <div className="p-4">
              <div className="text-xs text-gray-400">Containers Billed</div>
              <div className="text-lg font-bold font-mono tabular-nums text-white mt-0.5">
                {fStats.containerCount.toLocaleString()}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-gray-400">Total Accrued (Debited)</div>
              <div className="text-lg font-bold font-mono tabular-nums text-amber-400 mt-0.5">
                PKR {fStats.totalDebit.toLocaleString()}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-gray-400">Total Paid (Credited)</div>
              <div className="text-lg font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
                PKR {fStats.totalCredit.toLocaleString()}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-gray-400">Net Balance Payable</div>
              <div
                className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${
                  fStats.balance > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                PKR {fStats.balance.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="px-4 sm:px-6 py-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs text-gray-400">
              Showing {selectedFranchiseLedgerRows.length} ledger transaction
              {selectedFranchiseLedgerRows.length === 1 ? '' : 's'}
            </div>
            <div className="relative w-full sm:w-72">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                type="text"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="Search case #, container, port, or reference..."
                className="glass-input w-full pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none"
              />
            </div>
          </div>

          {/* Ledger Table */}
          {selectedFranchiseLedgerRows.length === 0 ? (
            <div className="py-16 px-4 text-center space-y-2">
              <BookOpen size={28} className="mx-auto text-gray-500" />
              <h4 className="text-sm font-bold text-white">No ledger entries recorded yet</h4>
              <p className="text-xs text-gray-400 max-w-md mx-auto">
                {selectedFranchise.billingType === 'PER_CONTAINER'
                  ? 'Whenever operational cases or containers are dispatched or unloaded at this franchise’s allocated destinations, per-container charges are automatically debited here in real time.'
                  : 'Post the monthly fixed retainer or record payments using the controls above.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-slate-950/60 text-[11px] font-semibold text-gray-400">
                    <th className="py-3 px-4 whitespace-nowrap">Date</th>
                    <th className="py-3 px-4 whitespace-nowrap">Case / Reference</th>
                    <th className="py-3 px-4 whitespace-nowrap">Destination / Dry Port</th>
                    <th className="py-3 px-4">Description & Container Breakdown</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Debit (PKR)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Credit (PKR)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Balance (PKR)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs">
                  {selectedFranchiseLedgerRows.map((row) => (
                    <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 font-mono tabular-nums text-gray-300 whitespace-nowrap">
                        {row.date}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-white whitespace-nowrap">
                        {row.caseNo || row.reference || '—'}
                        {row.autoGenerated && (
                          <span className="text-[10px] text-sky-400 block">Auto-Synced</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-300 whitespace-nowrap">
                        {row.pod || '—'}
                      </td>
                      <td className="py-3 px-4 text-gray-200 max-w-md">
                        <div>{row.description}</div>
                        {row.containerNumbers && (
                          <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                            Containers: {row.containerNumbers}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-400 whitespace-nowrap">
                        {row.type === 'DEBIT' ? row.amount.toLocaleString() : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-400 whitespace-nowrap">
                        {row.type === 'CREDIT' ? row.amount.toLocaleString() : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-white whitespace-nowrap">
                        {row.runningBalance.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setLedgerEntryPendingDelete(row)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 cursor-pointer"
                          title="Delete ledger entry"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Record Payment / Manual Charge Modal */}
        {isEntryModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
              <div className="px-5 py-4 bg-slate-900 border-b border-white/10 flex items-center justify-between">
                <h4 className="text-sm font-bold text-white">
                  {entryModalMode === 'CREDIT'
                    ? `Record Payment to ${selectedFranchise.businessTitle}`
                    : `Add Charge for ${selectedFranchise.businessTitle}`}
                </h4>
                <button
                  type="button"
                  onClick={() => setIsEntryModalOpen(false)}
                  className="text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {entryError && (
                <div className="px-5 py-2.5 bg-rose-500/15 border-b border-rose-500/30 text-xs text-rose-300">
                  {entryError}
                </div>
              )}

              <form onSubmit={handleSaveLedgerEntry} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Amount (PKR) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      value={entryAmount}
                      onChange={(e) => setEntryAmount(e.target.value)}
                      placeholder="0"
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Date *
                    </label>
                    <input
                      type="date"
                      value={entryDate}
                      onChange={(e) => setEntryDate(e.target.value)}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                      required
                    />
                  </div>
                </div>

                {entryModalMode === 'CREDIT' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-200 mb-1">
                        Payment Mode
                      </label>
                      <select
                        value={entryPaymentMethod}
                        onChange={(e) => setEntryPaymentMethod(e.target.value as 'CASH' | 'BANK')}
                        className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                      >
                        <option value="BANK">Bank Transfer</option>
                        <option value="CASH">Cash</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-200 mb-1">
                        Voucher / Cheque Ref
                      </label>
                      <input
                        type="text"
                        value={entryReference}
                        onChange={(e) => setEntryReference(e.target.value)}
                        placeholder="Optional reference"
                        className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Description / Remarks
                  </label>
                  <input
                    type="text"
                    value={entryDescription}
                    onChange={(e) => setEntryDescription(e.target.value)}
                    placeholder={
                      entryModalMode === 'CREDIT'
                        ? 'Settlement against port container clearance'
                        : 'Port handling or supplementary debit'
                    }
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                  />
                </div>

                {entryModalMode === 'CREDIT' && (
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncPaymentToCashbook}
                      onChange={(e) => setSyncPaymentToCashbook(e.target.checked)}
                      className="rounded border-white/20"
                    />
                    <span>Also record paid expense in Finance Cashbook</span>
                  </label>
                )}

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEntryModalOpen(false)}
                    className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEntry}
                    className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    {isSavingEntry ? 'Saving...' : 'Save Entry'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Ledger Entry Confirmation Modal */}
        {ledgerEntryPendingDelete && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl p-5 space-y-4">
              <h4 className="text-sm font-bold text-white">Delete Ledger Entry?</h4>
              <p className="text-xs text-gray-300">
                Remove ledger entry of{' '}
                <span className="font-mono font-bold text-white">
                  PKR {Number(ledgerEntryPendingDelete.amount || 0).toLocaleString()}
                </span>{' '}
                ({ledgerEntryPendingDelete.description})?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setLedgerEntryPendingDelete(null)}
                  className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDeleteLedgerEntry}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
                >
                  {isDeleting ? 'Deleting...' : 'Delete Entry'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // SUB-VIEW 3: FRANCHISE DIRECTORY & AUTOMATED PORT ALLOCATION OVERVIEW
  // ============================================================================
  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white">
              Franchise Management & Automated Dry Port Ledgers
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Register regional city or dry port franchises, attach agreements, and track real-time per-container or monthly fixed ledgers.
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={handleManualSyncContainers}
              disabled={isSyncingCases}
              className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              title="Reconcile all dispatched and unloaded operational cases against active per-container franchises"
            >
              <RefreshCw
                size={14}
                className={isSyncingCases ? 'animate-spin text-sky-400' : 'text-sky-400'}
              />
              <span>{isSyncingCases ? 'Syncing Cases...' : 'Sync Dispatched Containers'}</span>
            </button>

            <button
              type="button"
              onClick={handleOpenCreateForm}
              className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus size={15} />
              <span>Add Franchise</span>
            </button>
          </div>
        </div>

        {/* Summary Metrics Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/10 bg-slate-950/40 border-b border-white/10">
          <div className="p-4">
            <div className="text-xs text-gray-400">Active Franchises</div>
            <div className="text-lg font-bold font-mono tabular-nums text-white mt-0.5">
              {globalSummary.activeCount} <span className="text-xs font-normal text-gray-500">/ {globalSummary.totalCount}</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-gray-400">Containers Auto-Billed</div>
            <div className="text-lg font-bold font-mono tabular-nums text-sky-400 mt-0.5">
              {globalSummary.totalContainers.toLocaleString()}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-gray-400">Total Accrued (Debited)</div>
            <div className="text-lg font-bold font-mono tabular-nums text-amber-400 mt-0.5">
              PKR {globalSummary.totalDebit.toLocaleString()}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-gray-400">Net Franchise Payable</div>
            <div
              className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${
                globalSummary.netPayable > 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              PKR {globalSummary.netPayable.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="px-4 sm:px-6 py-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div
            data-custom-control="true"
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-950 border border-white/10 self-start"
          >
            <button
              type="button"
              onClick={() => setBillingFilter('ALL')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                billingFilter === 'ALL' ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              All Franchises
            </button>
            <button
              type="button"
              onClick={() => setBillingFilter('PER_CONTAINER')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                billingFilter === 'PER_CONTAINER'
                  ? 'bg-sky-500 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Per-Container
            </button>
            <button
              type="button"
              onClick={() => setBillingFilter('FIXED_MONTHLY')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                billingFilter === 'FIXED_MONTHLY'
                  ? 'bg-sky-500 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Fixed Monthly
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search franchise, owner, city, or dry port..."
              className="glass-input w-full pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none"
            />
          </div>
        </div>

        {/* Directory List */}
        {isLoading ? (
          <div className="py-16 text-center text-xs text-gray-400">
            Loading franchise directory and port ledgers...
          </div>
        ) : filteredFranchises.length === 0 ? (
          <div className="py-16 px-4 text-center max-w-md mx-auto space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-center mx-auto text-sky-400">
              <Building2 size={24} />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-white">
                {searchQuery || billingFilter !== 'ALL'
                  ? 'No matching franchises found'
                  : 'No franchises registered yet'}
              </h4>
              <p className="text-xs text-gray-400 leading-relaxed">
                Register a destination franchise with City-wide or Specific Dry Port allocation to automate per-container and monthly port ledger accounting.
              </p>
            </div>
            {!searchQuery && billingFilter === 'ALL' && (
              <button
                type="button"
                onClick={handleOpenCreateForm}
                className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus size={15} />
                <span>Register First Franchise</span>
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {filteredFranchises.map((f) => {
              const st = statsByFranchise.get(f.id) || {
                totalDebit: 0,
                totalCredit: 0,
                balance: 0,
                containerCount: 0,
                entryCount: 0
              };

              const allocationText =
                f.allocationMode === 'CITY'
                  ? `City Coverage: ${(f.allocatedCities || []).join(', ')}`
                  : `Dry Ports: ${(f.allocatedDryPorts || []).join(', ')}`;

              const docsCount = [
                f.idCardDocUrl,
                f.ntnCertificateUrl,
                f.franchiseAgreementUrl
              ].filter(Boolean).length;

              return (
                <div
                  key={f.id}
                  className="p-4 sm:p-5 hover:bg-white/[0.02] transition-colors flex flex-col xl:flex-row xl:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center flex-wrap gap-2">
                      <h4 className="text-sm sm:text-base font-bold text-white">
                        {f.businessTitle}
                      </h4>
                      <span className="text-xs text-gray-400">
                        · {f.recipientEntity || 'Docks'} ·{' '}
                        <span
                          className={
                            f.status === 'ACTIVE' ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {f.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-300">
                      <span>Owner: {f.ownerName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{f.contactNumber}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">ID: {f.idCardNumber}</span>
                      <span aria-hidden="true">·</span>
                      <span>{docsCount}/3 Compliance Docs</span>
                      {f.portStaff && f.portStaff.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {f.portStaff.length} Port Staff ({f.portStaff.map((s) => s.name).join(', ')})
                          </span>
                        </>
                      )}
                    </div>

                    <div className="text-xs text-sky-300/90 flex items-center gap-1.5">
                      <MapPin size={13} className="text-sky-400 shrink-0" />
                      <span className="truncate" title={allocationText}>
                        {allocationText}
                      </span>
                    </div>

                    {/* Quick Document Preview Links */}
                    {docsCount > 0 && (
                      <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px]">
                        {f.idCardDocUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              handlePreviewStoredDoc(
                                f.idCardDocUrl,
                                `${f.id}_idcard`,
                                `${f.businessTitle} — ID Card Copy`
                              )
                            }
                            className="text-gray-400 hover:text-sky-400 underline cursor-pointer"
                          >
                            View ID Card
                          </button>
                        )}
                        {f.ntnCertificateUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              handlePreviewStoredDoc(
                                f.ntnCertificateUrl,
                                `${f.id}_ntn`,
                                `${f.businessTitle} — Business NTN Certificate`
                              )
                            }
                            className="text-gray-400 hover:text-sky-400 underline cursor-pointer"
                          >
                            View NTN Certificate
                          </button>
                        )}
                        {f.franchiseAgreementUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              handlePreviewStoredDoc(
                                f.franchiseAgreementUrl,
                                `${f.id}_agreement`,
                                `${f.businessTitle} — Signed Agreement`
                              )
                            }
                            className="text-gray-400 hover:text-sky-400 underline cursor-pointer"
                          >
                            View Signed Agreement
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right Side Billing & Ledger Controls */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center justify-between xl:justify-end gap-4 pt-2 xl:pt-0 border-t xl:border-t-0 border-white/10 shrink-0">
                    <div className="text-left sm:text-right">
                      <div className="text-[11px] text-gray-400">
                        {f.billingType === 'PER_CONTAINER'
                          ? `PKR ${Number(f.perContainerAmount || 0).toLocaleString()} / Container (${st.containerCount} cntr)`
                          : `PKR ${Number(f.fixedMonthlyAmount || 0).toLocaleString()} / Month Fixed`}
                      </div>
                      <div
                        className={`text-sm font-bold font-mono tabular-nums ${
                          st.balance > 0 ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        Balance: PKR {st.balance.toLocaleString()}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenLedger(f)}
                        className="mak-btn px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <BookOpen size={14} />
                        <span>Open Ledger</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEditForm(f)}
                        className="mak-btn-secondary p-2 rounded-xl text-gray-300 hover:text-white cursor-pointer"
                        title="Edit Franchise"
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setFranchisePendingDelete(f)}
                        className="mak-btn-secondary p-2 rounded-xl text-gray-300 hover:text-rose-400 cursor-pointer"
                        title="Delete Franchise"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Franchise Confirmation Modal */}
      {franchisePendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-bold text-white">Delete Franchise Profile?</h4>
            <p className="text-xs text-gray-300 leading-relaxed">
              Permanently remove{' '}
              <span className="font-bold text-white">{franchisePendingDelete.businessTitle}</span>{' '}
              and its associated franchise ledger entries?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFranchisePendingDelete(null)}
                className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDeleteFranchise}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Delete Franchise'}
              </button>
            </div>
          </div>
        </div>
      )}

      <UniversalDocumentPreviewModal
        isOpen={Boolean(previewDocFile)}
        onClose={() => setPreviewDocFile(null)}
        title={previewDocTitle}
        file={previewDocFile}
        filename={previewDocTitle || 'Franchise Document'}
      />
    </div>
  );
};

export default FranchiseManagement;

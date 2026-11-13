import React, { useState, useEffect, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  Upload,
  FileText,
  Search,
  ChevronRight,
  Eye,
  Edit,
  Trash2,
  Download,
  Plus,
  X,
  Check,
  Loader2,
  Scale,
  Landmark,
  Building2,
  ShieldCheck,
  FileSpreadsheet,
  Wallet,
  Bell,
  Gavel,
  Calendar,
  KeyRound,
  Copy,
  EyeOff,
  Database,
  Home,
  ExternalLink,
  MapPin
} from 'lucide-react';
import {
  CompanyDocument,
  CompanyExplorerFolder,
  CorporateDocumentStatus,
  CorporateLegalCase,
  CorporateRecipientEntity,
  CorporateRootCategory,
  CorporateVaultCredential,
  FranchiseProfile,
  LegalCaseTrack,
  QuotationStatus,
  Vendor
} from '../types';
import {
  ASSETS_SUBFOLDERS,
  CORPORATE_ROOT_CATEGORIES,
  DEFAULT_FISCAL_YEARS,
  DOCUMENT_STATUS_TAGS,
  FIRESTORE_CORPORATE_DMS_SPEC,
  MASTER_COMPANY_DOC_FOLDERS,
  POSTGRESQL_CORPORATE_DMS_DDL,
  QUOTATION_SERVICE_TYPES,
  QUOTATION_STATUSES,
  RECIPIENT_ENTITIES,
  TAX_AUTHORITIES,
  evaluateDocumentAlarms,
  getProvisionedLegalSubFolders,
  resolveDocumentHierarchy
} from '../services/corporateFilingArchitecture';
import {
  subscribeToCompanyDocuments,
  saveCompanyDocumentToFirestore,
  deleteCompanyDocumentFromFirestore,
  subscribeToCorporateLegalCases,
  saveCorporateLegalCaseToFirestore,
  deleteCorporateLegalCaseFromFirestore,
  subscribeToCorporateVaultCredentials,
  saveCorporateVaultCredentialToFirestore,
  deleteCorporateVaultCredentialFromFirestore,
  subscribeToCompanyExplorerFolders,
  saveCompanyExplorerFolderToFirestore,
  subscribeToFranchises,
  matchesActiveCompany
} from '../services/dbService';
import { subscribeToVendors, saveVendor, VENDOR_CATEGORIES } from '../services/vendorService';
import { resolveStoredDocumentDataUrl } from '../services/documentStorage';
import { downloadFile } from '../services/geminiService';
import { safeAppStorage } from '../services/storage';
import { useActiveCompany } from '../services/companyService';
import { ThemeToggleSwitch } from './ThemeToggleSwitch';
import {
  UniversalDocumentPreviewModal,
  DataMappingCheckItem
} from './UniversalDocumentPreviewModal';
import { CompanyDocumentUploadModal } from './CompanyDocumentUploadModal';
import { FranchiseManagement, FranchiseSubView } from './FranchiseManagement';

export interface CompanyDocumentsProps {
  onNavigateToFinance?: (tabId?: string) => void;
}

function getCategoryIcon(cat: CorporateRootCategory) {
  switch (cat) {
    case 'Legal':
      return Scale;
    case 'Tax':
      return Landmark;
    case 'Assets':
      return Building2;
    case 'Company Documents':
      return ShieldCheck;
    case 'Quotations':
      return FileSpreadsheet;
    case 'Finance':
      return Wallet;
  }
}

export const CompanyDocuments: React.FC<CompanyDocumentsProps> = ({
  onNavigateToFinance
}) => {
  const { activeCompany } = useActiveCompany();
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Firestore Collections
  const [rawDocuments, setRawDocuments] = useState<CompanyDocument[]>([]);
  const [legalCases, setLegalCases] = useState<CorporateLegalCase[]>([]);
  const [vaultCredentials, setVaultCredentials] = useState<CorporateVaultCredential[]>([]);
  const [customFolders, setCustomFolders] = useState<CompanyExplorerFolder[]>([]);
  const [franchises, setFranchises] = useState<FranchiseProfile[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Navigation Hierarchy State (null = Root 6-Category Dashboard)
  const [activeRootCategory, setActiveRootCategory] = useState<CorporateRootCategory | null>(null);
  const [selectedLegalCaseId, setSelectedLegalCaseId] = useState<string | null>(null);
  const [selectedLegalSubFolder, setSelectedLegalSubFolder] = useState<string | null>(null);

  const [selectedTaxAuthority, setSelectedTaxAuthority] = useState<string | null>(null);
  const [selectedTaxYear, setSelectedTaxYear] = useState<string | null>(null);
  const [customFiscalYearInput, setCustomFiscalYearInput] = useState<string>('');
  const [extraFiscalYears, setExtraFiscalYears] = useState<string[]>([]);

  const [selectedAssetGroup, setSelectedAssetGroup] = useState<string | null>(null);
  const [selectedMasterFolder, setSelectedMasterFolder] = useState<string | null>(null);

  // Category 6 (Finance) Sub-Navigation & Breadcrumb Context
  const [financeSection, setFinanceSection] = useState<'FRANCHISES' | 'VENDORS' | 'LEDGERS'>(
    'FRANCHISES'
  );
  const [franchiseSubView, setFranchiseSubView] = useState<FranchiseSubView>('LIST');
  const [franchiseContextCrumb, setFranchiseContextCrumb] = useState<string>('');

  // Filters & Global Search
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [alarmFilter, setAlarmFilter] = useState<'ALL' | 'EXPIRY_ALARM' | 'HEARING_ALARM'>('ALL');

  // Quotations Archive Dedicated Filters
  const [quoteClientSearch, setQuoteClientSearch] = useState<string>('');
  const [quoteServiceFilter, setQuoteServiceFilter] = useState<string>('ALL');
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<'ALL' | QuotationStatus>('ALL');
  const [quoteDateFrom, setQuoteDateFrom] = useState<string>('');
  const [quoteDateTo, setQuoteDateTo] = useState<string>('');

  // Upload / Edit Document Modal
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [editingDocument, setEditingDocument] = useState<CompanyDocument | null>(null);
  const [preDroppedFiles, setPreDroppedFiles] = useState<File[] | undefined>(undefined);
  const [isDragOverCanvas, setIsDragOverCanvas] = useState<boolean>(false);

  // Dynamic Legal Case Generator Modal
  const [isLegalCaseModalOpen, setIsLegalCaseModalOpen] = useState<boolean>(false);
  const [editingLegalCase, setEditingLegalCase] = useState<CorporateLegalCase | null>(null);
  const [caseIdentifier, setCaseIdentifier] = useState<string>('');
  const [caseTrack, setCaseTrack] = useState<LegalCaseTrack>('LOGISTICS_CRIMINAL');
  const [caseEntity, setCaseEntity] = useState<CorporateRecipientEntity | string>('Docks');
  const [caseCourtOrForum, setCaseCourtOrForum] = useState<string>('');
  const [caseNextHearing, setCaseNextHearing] = useState<string>('');
  const [caseNotes, setCaseNotes] = useState<string>('');
  const [caseFormError, setCaseFormError] = useState<string | null>(null);
  const [isSavingCase, setIsSavingCase] = useState<boolean>(false);

  // Add / Rename Custom Sub-Folder Modal (for Legal Cases & Company Documents)
  const [isSubFolderModalOpen, setIsSubFolderModalOpen] = useState<boolean>(false);
  const [subFolderModalMode, setSubFolderModalMode] = useState<'ADD_LEGAL' | 'RENAME_LEGAL' | 'ADD_COMPANY'>('ADD_LEGAL');
  const [targetOldSubFolderName, setTargetOldSubFolderName] = useState<string>('');
  const [subFolderTitleInput, setSubFolderTitleInput] = useState<string>('');
  const [subFolderError, setSubFolderError] = useState<string | null>(null);

  // Secure Vault Credential Modal
  const [isVaultModalOpen, setIsVaultModalOpen] = useState<boolean>(false);
  const [editingVaultItem, setEditingVaultItem] = useState<CorporateVaultCredential | null>(null);
  const [vaultPortalName, setVaultPortalName] = useState<string>('');
  const [vaultPortalUrl, setVaultPortalUrl] = useState<string>('');
  const [vaultUsername, setVaultUsername] = useState<string>('');
  const [vaultPassword, setVaultPassword] = useState<string>('');
  const [vaultPinNote, setVaultPinNote] = useState<string>('');
  const [vaultEntity, setVaultEntity] = useState<CorporateRecipientEntity | string>('MAK Group');
  const [vaultExpiryDate, setVaultExpiryDate] = useState<string>('');
  const [revealedVaultIds, setRevealedVaultIds] = useState<Set<string>>(new Set());
  const [copiedVaultId, setCopiedVaultId] = useState<string | null>(null);

  // Quick Add Vendor Modal (under Finance > Vendors)
  const [isVendorModalOpen, setIsVendorModalOpen] = useState<boolean>(false);
  const [vendorName, setVendorName] = useState<string>('');
  const [vendorCategory, setVendorCategory] = useState<string>(VENDOR_CATEGORIES[0] || 'Office Maintenance');
  const [vendorPhone, setVendorPhone] = useState<string>('');
  const [vendorAddress, setVendorAddress] = useState<string>('');

  // Document Preview & Schema Spec Drawer
  const [previewDoc, setPreviewDoc] = useState<CompanyDocument | null>(null);
  const [previewResolvedUrl, setPreviewResolvedUrl] = useState<string | null>(null);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState<boolean>(false);

  // Delete Confirmation Modals
  const [docPendingDelete, setDocPendingDelete] = useState<CompanyDocument | null>(null);
  const [casePendingDelete, setCasePendingDelete] = useState<CorporateLegalCase | null>(null);
  const [vaultPendingDelete, setVaultPendingDelete] = useState<CorporateVaultCredential | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Subscribe to all Firestore corporate & finance collections
  useEffect(() => {
    setIsLoading(true);
    const unsubDocs = subscribeToCompanyDocuments((items) => {
      setRawDocuments(items || []);
      setIsLoading(false);
    });
    const unsubCases = subscribeToCorporateLegalCases((items) => {
      setLegalCases(items || []);
    });
    const unsubVault = subscribeToCorporateVaultCredentials((items) => {
      setVaultCredentials(items || []);
    });
    const unsubCustomFolders = subscribeToCompanyExplorerFolders((items) => {
      setCustomFolders(items || []);
    });
    const unsubFranchises = subscribeToFranchises((items) => {
      setFranchises(items || []);
    });
    const unsubVendors = subscribeToVendors((items) => {
      setVendors(items || []);
    });

    return () => {
      unsubDocs();
      unsubCases();
      unsubVault();
      unsubCustomFolders();
      unsubFranchises();
      unsubVendors();
    };
  }, []);

  // Filter documents for active company workspace & enrich with hierarchy + alarm evaluation
  const companyScopedDocuments = useMemo(() => {
    const activeId = activeCompany?.id || 'docks';
    return rawDocuments.filter((d) => matchesActiveCompany(d.companyId, activeId));
  }, [rawDocuments, activeCompany]);

  const companyScopedLegalCases = useMemo(() => {
    const activeId = activeCompany?.id || 'docks';
    return legalCases.filter((c) => matchesActiveCompany(c.companyId, activeId));
  }, [legalCases, activeCompany]);

  const companyScopedVault = useMemo(() => {
    const activeId = activeCompany?.id || 'docks';
    return vaultCredentials.filter((v) => matchesActiveCompany(v.companyId, activeId));
  }, [vaultCredentials, activeCompany]);

  const enrichedDocuments = useMemo(() => {
    return companyScopedDocuments.map((doc) => ({
      doc,
      hierarchy: resolveDocumentHierarchy(doc),
      alarms: evaluateDocumentAlarms(doc, todayIso)
    }));
  }, [companyScopedDocuments, todayIso]);

  // Global Smart Alarm Counts
  const alarmSummary = useMemo(() => {
    let expiryAlerts = 0;
    let hearingAlerts = 0;
    for (const item of enrichedDocuments) {
      if (item.alarms.isExpired || item.alarms.isWithinExpiryAlarm) expiryAlerts++;
      if (item.alarms.isHearingDueOrSoon || item.alarms.isHearingOverdue) hearingAlerts++;
    }
    return { expiryAlerts, hearingAlerts };
  }, [enrichedDocuments]);

  // Custom Master Folders created by user under Company Documents
  const customMasterFolderNames = useMemo(() => {
    const activeId = activeCompany?.id || 'docks';
    return customFolders
      .filter((f) => !f.parentFolderId && matchesActiveCompany(f.companyId, activeId))
      .map((f) => f.title);
  }, [customFolders, activeCompany]);

  const allMasterFolders = useMemo(() => {
    const builtInIds = new Set(MASTER_COMPANY_DOC_FOLDERS.map((f) => f.title.toLowerCase()));
    const extra = customMasterFolderNames
      .filter((name) => !builtInIds.has(name.toLowerCase()))
      .map((name) => ({
        id: name,
        title: name,
        description: 'Custom corporate compliance folder.',
        isSecureVault: false
      }));
    return [...MASTER_COMPANY_DOC_FOLDERS, ...extra];
  }, [customMasterFolderNames]);

  const selectedLegalCase = useMemo(
    () => companyScopedLegalCases.find((c) => c.id === selectedLegalCaseId) || null,
    [companyScopedLegalCases, selectedLegalCaseId]
  );

  // Dynamic Fiscal Years for selected Tax Authority
  const availableTaxYears = useMemo(() => {
    const yrs = new Set<string>([...DEFAULT_FISCAL_YEARS, ...extraFiscalYears]);
    for (const item of enrichedDocuments) {
      if (item.hierarchy.rootCategory === 'Tax' && item.hierarchy.taxYear) {
        if (!selectedTaxAuthority || item.hierarchy.taxAuthority === selectedTaxAuthority) {
          yrs.add(item.hierarchy.taxYear);
        }
      }
    }
    return Array.from(yrs).sort((a, b) => b.localeCompare(a));
  }, [enrichedDocuments, selectedTaxAuthority, extraFiscalYears]);

  // Filtered Documents for Current View / Search / Alarms
  const filteredDocuments = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();

    return enrichedDocuments.filter(({ doc, hierarchy, alarms }) => {
      if (entityFilter !== 'ALL' && hierarchy.recipientEntity !== entityFilter) {
        return false;
      }
      if (alarmFilter === 'EXPIRY_ALARM' && !(alarms.isExpired || alarms.isWithinExpiryAlarm)) {
        return false;
      }
      if (
        alarmFilter === 'HEARING_ALARM' &&
        !(alarms.isHearingDueOrSoon || alarms.isHearingOverdue)
      ) {
        return false;
      }

      // Root Category & Sub-Folder Scoping (unless global alarm filter is active at Root)
      if (activeRootCategory && activeRootCategory !== 'Finance') {
        if (hierarchy.rootCategory !== activeRootCategory) return false;

        if (activeRootCategory === 'Legal') {
          if (selectedLegalCaseId && hierarchy.legalCaseId !== selectedLegalCaseId) return false;
          if (selectedLegalSubFolder && hierarchy.subFolder !== selectedLegalSubFolder) return false;
        } else if (activeRootCategory === 'Tax') {
          if (selectedTaxAuthority && hierarchy.taxAuthority !== selectedTaxAuthority) return false;
          if (selectedTaxYear && hierarchy.taxYear !== selectedTaxYear) return false;
        } else if (activeRootCategory === 'Assets') {
          if (selectedAssetGroup && hierarchy.assetGroup !== selectedAssetGroup) return false;
        } else if (activeRootCategory === 'Company Documents') {
          if (selectedMasterFolder && hierarchy.subFolder !== selectedMasterFolder) return false;
        } else if (activeRootCategory === 'Quotations') {
          if (
            quoteClientSearch.trim() &&
            !(doc.quotationClientName || '')
              .toLowerCase()
              .includes(quoteClientSearch.trim().toLowerCase()) &&
            !doc.title.toLowerCase().includes(quoteClientSearch.trim().toLowerCase())
          ) {
            return false;
          }
          if (
            quoteServiceFilter !== 'ALL' &&
            doc.quotationServiceType !== quoteServiceFilter
          ) {
            return false;
          }
          if (quoteStatusFilter !== 'ALL' && hierarchy.quotationStatus !== quoteStatusFilter) {
            return false;
          }
          if (quoteDateFrom && hierarchy.issuanceDate && hierarchy.issuanceDate < quoteDateFrom) {
            return false;
          }
          if (quoteDateTo && hierarchy.issuanceDate && hierarchy.issuanceDate > quoteDateTo) {
            return false;
          }
        }
      }

      if (!q) return true;
      const haystack = [
        doc.title,
        doc.referenceNo,
        hierarchy.senderIssuer,
        hierarchy.recipientEntity,
        hierarchy.subFolder,
        hierarchy.legalCaseTitle,
        hierarchy.taxAuthority,
        hierarchy.taxYear,
        hierarchy.assetGroup,
        doc.quotationClientName,
        doc.quotationServiceType,
        doc.fileName
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [
    enrichedDocuments,
    entityFilter,
    alarmFilter,
    activeRootCategory,
    selectedLegalCaseId,
    selectedLegalSubFolder,
    selectedTaxAuthority,
    selectedTaxYear,
    selectedAssetGroup,
    selectedMasterFolder,
    quoteClientSearch,
    quoteServiceFilter,
    quoteStatusFilter,
    quoteDateFrom,
    quoteDateTo,
    globalSearch
  ]);

  // Category Card Counts for Root Dashboard
  const categoryStats = useMemo(() => {
    const counts: Record<CorporateRootCategory, number> = {
      Legal: 0,
      Tax: 0,
      Assets: 0,
      'Company Documents': 0,
      Quotations: 0,
      Finance: franchises.length + vendors.length
    };
    for (const item of enrichedDocuments) {
      counts[item.hierarchy.rootCategory] = (counts[item.hierarchy.rootCategory] || 0) + 1;
    }
    return counts;
  }, [enrichedDocuments, franchises.length, vendors.length]);

  // Reset Sub-Navigation When Selecting a Root Category
  const handleSelectRootCategory = (cat: CorporateRootCategory | null) => {
    setActiveRootCategory(cat);
    setSelectedLegalCaseId(null);
    setSelectedLegalSubFolder(null);
    setSelectedTaxAuthority(null);
    setSelectedTaxYear(null);
    setSelectedAssetGroup(null);
    setSelectedMasterFolder(null);
    setAlarmFilter('ALL');
    if (cat === 'Finance') {
      setFinanceSection('FRANCHISES');
      setFranchiseSubView('LIST');
      setFranchiseContextCrumb('');
    }
  };

  // Interactive Breadcrumb Segments (e.g. Dashboard > Finance > Franchise Management > Add Franchise)
  const breadcrumbs = useMemo(() => {
    const items: Array<{ label: string; onClick: () => void }> = [
      {
        label: 'Dashboard',
        onClick: () => handleSelectRootCategory(null)
      }
    ];

    if (!activeRootCategory) return items;

    items.push({
      label: activeRootCategory,
      onClick: () => handleSelectRootCategory(activeRootCategory)
    });

    if (activeRootCategory === 'Legal' && selectedLegalCase) {
      items.push({
        label: selectedLegalCase.identifier,
        onClick: () => setSelectedLegalSubFolder(null)
      });
      if (selectedLegalSubFolder) {
        items.push({
          label: selectedLegalSubFolder,
          onClick: () => {}
        });
      }
    } else if (activeRootCategory === 'Tax' && selectedTaxAuthority) {
      items.push({
        label: selectedTaxAuthority,
        onClick: () => setSelectedTaxYear(null)
      });
      if (selectedTaxYear) {
        items.push({
          label: `Year ${selectedTaxYear}`,
          onClick: () => {}
        });
      }
    } else if (activeRootCategory === 'Assets' && selectedAssetGroup) {
      items.push({
        label: selectedAssetGroup,
        onClick: () => {}
      });
    } else if (activeRootCategory === 'Company Documents' && selectedMasterFolder) {
      items.push({
        label: selectedMasterFolder,
        onClick: () => {}
      });
    } else if (activeRootCategory === 'Finance') {
      const sectionLabel =
        financeSection === 'FRANCHISES'
          ? 'Franchise Management'
          : financeSection === 'VENDORS'
            ? 'Vendors & Utilities'
            : 'Corporate Ledgers';
      items.push({
        label: sectionLabel,
        onClick: () => {
          if (financeSection === 'FRANCHISES') {
            setFranchiseSubView('LIST');
            setFranchiseContextCrumb('');
          }
        }
      });

      if (financeSection === 'FRANCHISES' && franchiseSubView !== 'LIST' && franchiseContextCrumb) {
        items.push({
          label: franchiseContextCrumb,
          onClick: () => {}
        });
      }
    }

    return items;
  }, [
    activeRootCategory,
    selectedLegalCase,
    selectedLegalSubFolder,
    selectedTaxAuthority,
    selectedTaxYear,
    selectedAssetGroup,
    selectedMasterFolder,
    financeSection,
    franchiseSubView,
    franchiseContextCrumb
  ]);

  // ============================================================================
  // LEGAL CASE GENERATOR & CUSTOM SUB-FOLDERS
  // ============================================================================
  const openCreateLegalCaseModal = () => {
    setEditingLegalCase(null);
    setCaseIdentifier('');
    setCaseTrack('LOGISTICS_CRIMINAL');
    setCaseEntity('Docks');
    setCaseCourtOrForum('');
    setCaseNextHearing('');
    setCaseNotes('');
    setCaseFormError(null);
    setIsLegalCaseModalOpen(true);
  };

  const openEditLegalCaseModal = (c: CorporateLegalCase) => {
    setEditingLegalCase(c);
    setCaseIdentifier(c.identifier);
    setCaseTrack(c.caseTrack);
    setCaseEntity(c.recipientEntity || 'Docks');
    setCaseCourtOrForum(c.courtOrForum || '');
    setCaseNextHearing(c.nextHearingDate || '');
    setCaseNotes(c.notes || '');
    setCaseFormError(null);
    setIsLegalCaseModalOpen(true);
  };

  const handleSaveLegalCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setCaseFormError(null);
    const cleanId = caseIdentifier.trim();
    if (!cleanId) {
      setCaseFormError('Please enter a Unique Case Identifier or Title.');
      return;
    }

    const duplicate = companyScopedLegalCases.some(
      (c) =>
        c.id !== editingLegalCase?.id &&
        c.identifier.trim().toLowerCase() === cleanId.toLowerCase()
    );
    if (duplicate) {
      setCaseFormError('A Legal Case with this identifier already exists.');
      return;
    }

    setIsSavingCase(true);
    try {
      const subFolders =
        editingLegalCase && editingLegalCase.caseTrack === caseTrack
          ? editingLegalCase.subFolders
          : getProvisionedLegalSubFolders(caseTrack);

      const record: CorporateLegalCase = {
        id:
          editingLegalCase?.id ||
          `lcase_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        companyId: activeCompany?.id,
        identifier: cleanId,
        caseTrack,
        recipientEntity: caseEntity,
        courtOrForum: caseCourtOrForum.trim() || undefined,
        nextHearingDate: caseNextHearing || undefined,
        status: caseNextHearing ? 'Pending Hearing' : editingLegalCase?.status || 'Active',
        subFolders,
        notes: caseNotes.trim() || undefined,
        createdAt: editingLegalCase?.createdAt || new Date().toISOString(),
        createdBy: safeAppStorage.getItem('dpl_current_user_name') || 'Admin'
      };

      await saveCorporateLegalCaseToFirestore(record);
      setIsLegalCaseModalOpen(false);
      setSelectedLegalCaseId(record.id);
    } catch (err: any) {
      setCaseFormError(err?.message || 'Unable to save legal case.');
    } finally {
      setIsSavingCase(false);
    }
  };

  const handleSaveCustomSubFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubFolderError(null);
    const cleanName = subFolderTitleInput.trim();
    if (!cleanName) {
      setSubFolderError('Please enter a folder title.');
      return;
    }

    if (subFolderModalMode === 'ADD_COMPANY') {
      await saveCompanyExplorerFolderToFirestore({
        id: `cfolder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        companyId: activeCompany?.id,
        title: cleanName,
        parentFolderId: null,
        createdAt: new Date().toISOString()
      });
      setIsSubFolderModalOpen(false);
      setSelectedMasterFolder(cleanName);
      return;
    }

    if (!selectedLegalCase) return;
    const existingFolders = selectedLegalCase.subFolders || [];

    if (subFolderModalMode === 'ADD_LEGAL') {
      if (existingFolders.some((f) => f.toLowerCase() === cleanName.toLowerCase())) {
        setSubFolderError('This sub-folder already exists in the selected case.');
        return;
      }
      const updatedCase: CorporateLegalCase = {
        ...selectedLegalCase,
        subFolders: [...existingFolders, cleanName]
      };
      await saveCorporateLegalCaseToFirestore(updatedCase);
      setSelectedLegalSubFolder(cleanName);
    } else if (subFolderModalMode === 'RENAME_LEGAL') {
      const updatedFolders = existingFolders.map((f) =>
        f === targetOldSubFolderName ? cleanName : f
      );
      await saveCorporateLegalCaseToFirestore({
        ...selectedLegalCase,
        subFolders: updatedFolders
      });
      // Update any documents inside the renamed sub-folder
      const docsInFolder = companyScopedDocuments.filter(
        (d) => d.legalCaseId === selectedLegalCase.id && d.subFolder === targetOldSubFolderName
      );
      await Promise.all(
        docsInFolder.map((d) =>
          saveCompanyDocumentToFirestore({
            ...d,
            subFolder: cleanName,
            folderPath: `Dashboard > Legal > ${selectedLegalCase.identifier} > ${cleanName}`
          })
        )
      );
      if (selectedLegalSubFolder === targetOldSubFolderName) {
        setSelectedLegalSubFolder(cleanName);
      }
    }

    setIsSubFolderModalOpen(false);
  };

  // ============================================================================
  // SECURE VAULT CREDENTIAL HANDLERS
  // ============================================================================
  const openVaultCredentialModal = (item?: CorporateVaultCredential) => {
    if (item) {
      setEditingVaultItem(item);
      setVaultPortalName(item.portalName);
      setVaultPortalUrl(item.portalUrl || '');
      setVaultUsername(item.usernameOrId);
      setVaultPassword(item.passwordSecret);
      setVaultPinNote(item.pinOr2faNote || '');
      setVaultEntity(item.recipientEntity || 'MAK Group');
      setVaultExpiryDate(item.expiryDate || '');
    } else {
      setEditingVaultItem(null);
      setVaultPortalName('');
      setVaultPortalUrl('');
      setVaultUsername('');
      setVaultPassword('');
      setVaultPinNote('');
      setVaultEntity('MAK Group');
      setVaultExpiryDate('');
    }
    setIsVaultModalOpen(true);
  };

  const handleSaveVaultCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultPortalName.trim() || !vaultUsername.trim() || !vaultPassword.trim()) return;
    const record: CorporateVaultCredential = {
      id:
        editingVaultItem?.id ||
        `vault_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      companyId: activeCompany?.id,
      portalName: vaultPortalName.trim(),
      portalUrl: vaultPortalUrl.trim() || undefined,
      usernameOrId: vaultUsername.trim(),
      passwordSecret: vaultPassword,
      pinOr2faNote: vaultPinNote.trim() || undefined,
      recipientEntity: vaultEntity,
      expiryDate: vaultExpiryDate || undefined,
      statusTag: 'Active',
      createdAt: editingVaultItem?.createdAt || new Date().toISOString()
    };
    await saveCorporateVaultCredentialToFirestore(record);
    setIsVaultModalOpen(false);
  };

  const handleCopySecret = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedVaultId(id);
    setTimeout(() => setCopiedVaultId((curr) => (curr === id ? null : curr)), 1800);
  };

  // ============================================================================
  // DOCUMENT PREVIEW, DOWNLOAD, QUOTATION STATUS UPDATE, & DELETE
  // ============================================================================
  const openUploadModalWithDefaults = (droppedFiles?: File[]) => {
    setEditingDocument(null);
    setPreDroppedFiles(droppedFiles);
    setIsUploadModalOpen(true);
  };

  const handleOpenPreview = async (docItem: CompanyDocument) => {
    setPreviewDoc(docItem);
    const resolved = await resolveStoredDocumentDataUrl({
      url: docItem.fileUrl || null,
      id: docItem.id,
      name: docItem.fileName || docItem.title
    });
    setPreviewResolvedUrl(resolved || docItem.fileUrl || null);
  };

  const handleDownloadDoc = async (docItem: CompanyDocument) => {
    const resolved = await resolveStoredDocumentDataUrl({
      url: docItem.fileUrl || null,
      id: docItem.id,
      name: docItem.fileName || docItem.title
    });
    if (resolved) {
      const ext = (docItem.fileType || '').startsWith('image/') ? '.jpg' : '.pdf';
      const cleanName =
        docItem.fileName || `${docItem.title.replace(/[^a-zA-Z0-9_-]+/g, '_')}${ext}`;
      downloadFile(resolved, cleanName);
    }
  };

  const handleUpdateQuotationStatus = async (
    docItem: CompanyDocument,
    nextStatus: QuotationStatus
  ) => {
    await saveCompanyDocumentToFirestore({
      ...docItem,
      quotationStatus: nextStatus
    });
  };

  const handleSaveVendorQuick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorName.trim()) return;
    await saveVendor({
      id: `vnd_${Date.now()}`,
      name: vendorName.trim(),
      category: vendorCategory,
      contactNumber: vendorPhone.trim() || undefined,
      address: vendorAddress.trim() || undefined,
      createdAt: new Date().toISOString()
    });
    setVendorName('');
    setVendorPhone('');
    setVendorAddress('');
    setIsVendorModalOpen(false);
  };

  const previewVerificationItems: DataMappingCheckItem[] = useMemo(() => {
    if (!previewDoc) return [];
    const h = resolveDocumentHierarchy(previewDoc);
    const al = evaluateDocumentAlarms(previewDoc, todayIso);

    return [
      { label: 'Document Title', value: previewDoc.title, status: 'verified' },
      { label: 'Root Category', value: h.rootCategory, status: 'info' },
      { label: 'Sender / Issuer', value: h.senderIssuer, status: 'verified' },
      { label: 'Recipient Entity', value: h.recipientEntity, status: 'verified' },
      { label: 'Issuance Date', value: h.issuanceDate || 'N/A', status: 'info' },
      {
        label: 'Validity / Expiry',
        value: h.validityEndDate
          ? `${h.validityEndDate} (${
              al.remainingValidityDays !== null && al.remainingValidityDays <= 0
                ? 'Expired'
                : `${al.remainingValidityDays}d left`
            })`
          : 'Perpetual / No Expiry',
        status: al.isExpired || al.isWithinExpiryAlarm ? 'warning' : 'verified'
      },
      {
        label: 'Scheduled Hearing',
        value: previewDoc.hearingDate || 'None',
        status: al.isHearingDueOrSoon || al.isHearingOverdue ? 'warning' : 'info'
      },
      { label: 'Status Tag', value: al.effectiveStatus, status: 'verified' }
    ];
  }, [previewDoc, todayIso]);

  // Shared Document Table Renderer across Legal, Tax, Assets, Company Documents, & Quotations
  const renderDocumentsTable = (
    items: typeof filteredDocuments,
    emptyTitle: string,
    emptySubtitle: string
  ) => {
    if (items.length === 0) {
      return (
        <div className="py-16 px-4 text-center max-w-md mx-auto space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-center mx-auto text-sky-400">
            <FileText size={24} />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-white">{emptyTitle}</h4>
            <p className="text-xs text-gray-400 leading-relaxed">{emptySubtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => openUploadModalWithDefaults()}
            className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Upload size={14} />
            <span>Upload Document</span>
          </button>
        </div>
      );
    }

    const isQuotationsView = activeRootCategory === 'Quotations';

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/10 bg-slate-950/60 text-[11px] font-semibold text-gray-400">
              <th className="py-3 px-4">Document Title & Location</th>
              <th className="py-3 px-4 whitespace-nowrap">
                {isQuotationsView ? 'Client & Service' : 'Sender / Issuer'}
              </th>
              <th className="py-3 px-4 whitespace-nowrap">Entity</th>
              <th className="py-3 px-4 whitespace-nowrap">Issuance Date</th>
              <th className="py-3 px-4 whitespace-nowrap">Validity & Alarms</th>
              <th className="py-3 px-4 whitespace-nowrap">
                {isQuotationsView ? 'Proposal Status' : 'Status Tag'}
              </th>
              <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-xs">
            {items.map(({ doc, hierarchy, alarms }) => (
              <tr key={doc.id} className="hover:bg-white/[0.02] transition-colors">
                <td className="py-3 px-4 max-w-xs">
                  <button
                    type="button"
                    onClick={() => handleOpenPreview(doc)}
                    className="font-bold text-white hover:text-sky-400 text-left truncate block max-w-full cursor-pointer"
                    title={doc.title}
                  >
                    {doc.title}
                  </button>
                  <div className="text-[11px] text-gray-400 truncate mt-0.5">
                    {[
                      hierarchy.rootCategory,
                      hierarchy.legalCaseTitle,
                      hierarchy.taxAuthority,
                      hierarchy.taxYear ? `Year ${hierarchy.taxYear}` : '',
                      hierarchy.subFolder || hierarchy.assetGroup
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </td>

                <td className="py-3 px-4 text-gray-300 whitespace-nowrap">
                  {isQuotationsView ? (
                    <div>
                      <div className="font-semibold text-white">
                        {doc.quotationClientName || hierarchy.senderIssuer}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {doc.quotationServiceType || 'Commercial Proposal'}
                        {doc.quotationAmountPkr
                          ? ` · PKR ${Number(doc.quotationAmountPkr).toLocaleString()}`
                          : ''}
                      </div>
                    </div>
                  ) : (
                    <span>{hierarchy.senderIssuer}</span>
                  )}
                </td>

                <td className="py-3 px-4 text-gray-300 whitespace-nowrap">
                  {hierarchy.recipientEntity}
                </td>

                <td className="py-3 px-4 font-mono tabular-nums text-gray-300 whitespace-nowrap">
                  {hierarchy.issuanceDate || '—'}
                </td>

                <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                  {hierarchy.validityEndDate ? (
                    <div
                      className={
                        alarms.isExpired
                          ? 'text-rose-400 font-semibold'
                          : alarms.isWithinExpiryAlarm
                            ? 'text-amber-400 font-semibold'
                            : 'text-emerald-400'
                      }
                    >
                      Exp: {hierarchy.validityEndDate}{' '}
                      {alarms.remainingValidityDays !== null &&
                        (alarms.remainingValidityDays <= 0
                          ? '(Expired)'
                          : `(${alarms.remainingValidityDays}d)`)}
                    </div>
                  ) : (
                    <span className="text-gray-500">Perpetual</span>
                  )}

                  {doc.hearingDate && (
                    <div
                      className={`text-[11px] mt-0.5 ${
                        alarms.isHearingOverdue
                          ? 'text-rose-400 font-semibold'
                          : alarms.isHearingDueOrSoon
                            ? 'text-amber-400 font-semibold'
                            : 'text-sky-400'
                      }`}
                    >
                      Hearing: {doc.hearingDate}{' '}
                      {alarms.remainingHearingDays !== null &&
                        (alarms.remainingHearingDays < 0
                          ? `(${Math.abs(alarms.remainingHearingDays)}d ago)`
                          : alarms.remainingHearingDays === 0
                            ? '(Today)'
                            : `(in ${alarms.remainingHearingDays}d)`)}
                    </div>
                  )}
                </td>

                <td className="py-3 px-4 whitespace-nowrap">
                  {isQuotationsView ? (
                    <select
                      value={hierarchy.quotationStatus}
                      onChange={(e) =>
                        handleUpdateQuotationStatus(doc, e.target.value as QuotationStatus)
                      }
                      className="glass-input rounded-lg px-2.5 py-1 text-xs font-semibold outline-none cursor-pointer"
                    >
                      {QUOTATION_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`font-semibold ${
                        alarms.effectiveStatus === 'Expired'
                          ? 'text-rose-400'
                          : alarms.effectiveStatus === 'Pending Hearing'
                            ? 'text-amber-400'
                            : alarms.effectiveStatus === 'Resolved'
                              ? 'text-sky-400'
                              : 'text-emerald-400'
                      }`}
                    >
                      {alarms.effectiveStatus}
                    </span>
                  )}
                </td>

                <td className="py-3 px-4 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenPreview(doc)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-sky-400 cursor-pointer"
                      title="Preview Document"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadDoc(doc)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-emerald-400 cursor-pointer"
                      title="Download File"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDocument(doc);
                        setPreDroppedFiles(undefined);
                        setIsUploadModalOpen(true);
                      }}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-white cursor-pointer"
                      title="Edit Metadata"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocPendingDelete(doc)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 cursor-pointer"
                      title="Delete Document"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div
      onDragOver={(e) => {
        if (activeRootCategory === 'Finance') return;
        e.preventDefault();
        setIsDragOverCanvas(true);
      }}
      onDragLeave={() => setIsDragOverCanvas(false)}
      onDrop={(e) => {
        if (activeRootCategory === 'Finance') return;
        e.preventDefault();
        setIsDragOverCanvas(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          openUploadModalWithDefaults(Array.from(e.dataTransfer.files));
        }
      }}
      className={`space-y-5 transition-colors ${
        isDragOverCanvas ? 'ring-2 ring-sky-400/60 rounded-2xl' : ''
      }`}
    >
      {/* Top Bar: Breadcrumb Trail + Global Controls + Dark/Pearl Mode Switch */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Interactive Breadcrumb Navigation */}
          <div className="min-w-0 space-y-1">
            <nav
              aria-label="Breadcrumb"
              className="flex items-center flex-wrap gap-1 text-xs text-gray-400"
            >
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <React.Fragment key={`${crumb.label}_${idx}`}>
                    {idx > 0 && <ChevronRight size={13} className="text-gray-500 shrink-0" />}
                    <button
                      type="button"
                      onClick={crumb.onClick}
                      className={`inline-flex items-center gap-1.5 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap ${
                        isLast
                          ? 'text-white font-bold'
                          : 'text-gray-400 hover:text-sky-400 font-medium'
                      }`}
                    >
                      {idx === 0 && <Home size={13} className="text-sky-400 shrink-0" />}
                      <span>{crumb.label}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </nav>

            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
              {activeRootCategory
                ? CORPORATE_ROOT_CATEGORIES.find((c) => c.id === activeRootCategory)?.displayTitle ||
                  activeRootCategory
                : 'Corporate Document Management & Franchise Hub'}
            </h2>
          </div>

          {/* Action Controls */}
          <div className="flex items-center flex-wrap gap-2 shrink-0">
            {activeRootCategory === 'Legal' && (
              <button
                type="button"
                onClick={openCreateLegalCaseModal}
                className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus size={15} className="text-amber-400" />
                <span>Create New Case</span>
              </button>
            )}

            {activeRootCategory === 'Company Documents' && !selectedMasterFolder && (
              <button
                type="button"
                onClick={() => {
                  setSubFolderModalMode('ADD_COMPANY');
                  setSubFolderTitleInput('');
                  setSubFolderError(null);
                  setIsSubFolderModalOpen(true);
                }}
                className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <FolderPlus size={15} className="text-amber-400" />
                <span>Create Folder</span>
              </button>
            )}

            {activeRootCategory !== 'Finance' && (
              <button
                type="button"
                onClick={() => openUploadModalWithDefaults()}
                className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Upload size={15} />
                <span>Upload Document</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsSchemaModalOpen(true)}
              className="mak-btn-secondary px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              title="View PostgreSQL & Firestore Database Schema"
            >
              <Database size={14} className="text-sky-400" />
              <span>Schema Spec</span>
            </button>

            <ThemeToggleSwitch compact />
          </div>
        </div>

        {/* Filter, Entity Selector & Smart Alarm Strip (Shown on all Document Categories & Root) */}
        {activeRootCategory !== 'Finance' && (
          <div className="px-4 sm:px-6 py-3 bg-slate-950/50 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Entity Filter */}
              <select
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
                className="glass-input rounded-lg px-3 py-1.5 text-xs outline-none"
              >
                <option value="ALL">All Group Entities</option>
                {RECIPIENT_ENTITIES.map((ent) => (
                  <option key={ent.id} value={ent.id}>
                    {ent.id}
                  </option>
                ))}
              </select>

              {/* Smart Notification / Alarm Filter Buttons */}
              <div
                data-custom-control="true"
                className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-white/10"
              >
                <button
                  type="button"
                  onClick={() => setAlarmFilter('ALL')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    alarmFilter === 'ALL'
                      ? 'bg-sky-500 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  All Filings ({enrichedDocuments.length})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAlarmFilter(alarmFilter === 'EXPIRY_ALARM' ? 'ALL' : 'EXPIRY_ALARM')
                  }
                  className={`px-2.5 py-1 rounded text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 ${
                    alarmFilter === 'EXPIRY_ALARM'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Bell size={12} />
                  <span>Expiry Alarms ({alarmSummary.expiryAlerts})</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAlarmFilter(alarmFilter === 'HEARING_ALARM' ? 'ALL' : 'HEARING_ALARM')
                  }
                  className={`px-2.5 py-1 rounded text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 ${
                    alarmFilter === 'HEARING_ALARM'
                      ? 'bg-sky-500 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Gavel size={12} />
                  <span>Hearing Alarms ({alarmSummary.hearingAlerts})</span>
                </button>
              </div>
            </div>

            {/* Global Document Search */}
            <div className="relative w-full xl:w-80">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search title, issuer, case ID, fiscal year, or client..."
                className="glass-input w-full pl-8 pr-7 py-1.5 rounded-lg text-xs outline-none"
              />
              {globalSearch && (
                <button
                  type="button"
                  onClick={() => setGlobalSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================
          ROOT DASHBOARD: 6 PRIMARY CATEGORY CARDS
          ======================================================================== */}
      {isLoading ? (
        <div className="py-20 text-center space-y-2 bg-slate-900 border border-white/10 rounded-2xl">
          <Loader2 size={28} className="animate-spin text-sky-400 mx-auto" />
          <p className="text-xs text-gray-400">Loading corporate repository and franchise ledgers...</p>
        </div>
      ) : !activeRootCategory ? (
        <div className="space-y-5">
          {/* 6 Root Category Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {CORPORATE_ROOT_CATEGORIES.map((cat) => {
              const IconComp = getCategoryIcon(cat.id);
              const itemCount = categoryStats[cat.id] || 0;

              return (
                <div
                  key={cat.id}
                  onClick={() => handleSelectRootCategory(cat.id)}
                  className="group bg-slate-900 border border-white/10 hover:border-sky-400/50 rounded-2xl p-5 cursor-pointer transition-colors flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-slate-950 border border-white/10 text-sky-400 flex items-center justify-center shrink-0">
                          <IconComp size={20} />
                        </div>
                        <div>
                          <div className="text-[11px] font-mono text-gray-400">
                            {cat.numberLabel}. {cat.subtitle}
                          </div>
                          <h3 className="text-base font-bold text-white group-hover:text-sky-400 transition-colors">
                            {cat.displayTitle}
                          </h3>
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-gray-400 leading-relaxed">{cat.description}</p>
                  </div>

                  <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                    <span className="font-mono tabular-nums text-gray-300">
                      {cat.id === 'Legal'
                        ? `${companyScopedLegalCases.length} Case Dossier${companyScopedLegalCases.length === 1 ? '' : 's'} · ${itemCount} Filing${itemCount === 1 ? '' : 's'}`
                        : cat.id === 'Finance'
                          ? `${franchises.length} Franchise${franchises.length === 1 ? '' : 's'} · ${vendors.length} Vendor${vendors.length === 1 ? '' : 's'}`
                          : `${itemCount} Record${itemCount === 1 ? '' : 's'}`}
                    </span>
                    <span className="text-sky-400 font-semibold inline-flex items-center gap-1">
                      <span>Open Module</span>
                      <ChevronRight size={14} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Search or Active Smart Alarm Results on Root */}
          {(globalSearch.trim() !== '' || alarmFilter !== 'ALL') && (
            <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">
                  {alarmFilter === 'EXPIRY_ALARM'
                    ? 'Active Document Expiry Alarms'
                    : alarmFilter === 'HEARING_ALARM'
                      ? 'Scheduled Legal & Regulatory Hearing Alarms'
                      : `Search Results (${filteredDocuments.length})`}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setGlobalSearch('');
                    setAlarmFilter('ALL');
                  }}
                  className="text-xs text-gray-400 hover:text-white cursor-pointer"
                >
                  Clear Filter
                </button>
              </div>
              {renderDocumentsTable(
                filteredDocuments,
                'No matching documents found',
                'Adjust your search query or alarm filter.'
              )}
            </div>
          )}
        </div>
      ) : activeRootCategory === 'Legal' ? (
        /* ======================================================================
           1. LEGAL — DYNAMIC CASE GENERATOR & AUTO-PROVISIONED SUB-FOLDERS
           ====================================================================== */
        !selectedLegalCase ? (
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Dynamic Legal Case Dossiers
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Create a case dynamically for any shipment, container, customs proceeding, or civil/corporate dispute.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateLegalCaseModal}
                className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus size={15} />
                <span>Create New Case</span>
              </button>
            </div>

            {companyScopedLegalCases.length === 0 ? (
              <div className="py-16 px-4 text-center max-w-md mx-auto space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-center mx-auto text-amber-400">
                  <Scale size={24} />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white">No legal cases created yet</h4>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Click &ldquo;Create New Case&rdquo; to enter a unique case identifier and automatically provision standardized Logistics/Criminal or Civil/Corporate sub-folders.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateLegalCaseModal}
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus size={15} />
                  <span>Create First Legal Case</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
                {companyScopedLegalCases.map((lCase) => {
                  const caseDocsCount = enrichedDocuments.filter(
                    (d) => d.hierarchy.legalCaseId === lCase.id
                  ).length;
                  return (
                    <div
                      key={lCase.id}
                      onClick={() => {
                        setSelectedLegalCaseId(lCase.id);
                        setSelectedLegalSubFolder(null);
                      }}
                      className="bg-slate-950/60 border border-white/10 hover:border-sky-400/50 rounded-xl p-4 cursor-pointer transition-colors flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Folder size={18} className="text-amber-400 shrink-0" />
                            <h4 className="text-sm font-bold text-white truncate">
                              {lCase.identifier}
                            </h4>
                          </div>
                          <div
                            onClick={(ev) => ev.stopPropagation()}
                            className="flex items-center gap-1 shrink-0"
                          >
                            <button
                              type="button"
                              onClick={() => openEditLegalCaseModal(lCase)}
                              className="p-1 text-gray-400 hover:text-white cursor-pointer"
                              title="Edit Case Details"
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setCasePendingDelete(lCase)}
                              className="p-1 text-gray-400 hover:text-rose-400 cursor-pointer"
                              title="Delete Case Dossier"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        <div className="text-xs text-gray-400">
                          {lCase.recipientEntity} ·{' '}
                          {lCase.caseTrack === 'CIVIL_CORPORATE'
                            ? 'Civil / Corporate Track'
                            : 'Logistics / Customs / Criminal Track'}
                        </div>

                        {lCase.courtOrForum && (
                          <div className="text-[11px] text-gray-400 truncate">
                            Forum: {lCase.courtOrForum}
                          </div>
                        )}
                      </div>

                      <div className="pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-400 font-mono tabular-nums">
                        <span>
                          {(lCase.subFolders || []).length} Sub-Folders · {caseDocsCount} Docs
                        </span>
                        {lCase.nextHearingDate && (
                          <span className="text-amber-400">Hearing: {lCase.nextHearingDate}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : !selectedLegalSubFolder ? (
          /* Sub-Folders Inside Selected Legal Case */
          <div className="space-y-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    {selectedLegalCase.identifier} — Case Sub-Folders
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {selectedLegalCase.recipientEntity} ·{' '}
                    {selectedLegalCase.caseTrack === 'CIVIL_CORPORATE'
                      ? 'Civil / Corporate Proceedings'
                      : 'Logistics / Customs / Criminal / Transit Proceedings'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSubFolderModalMode('ADD_LEGAL');
                    setSubFolderTitleInput('');
                    setSubFolderError(null);
                    setIsSubFolderModalOpen(true);
                  }}
                  className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <FolderPlus size={14} className="text-amber-400" />
                  <span>Add Custom Sub-Folder</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 p-5">
                {(selectedLegalCase.subFolders || []).map((sf) => {
                  const sfCount = enrichedDocuments.filter(
                    (d) =>
                      d.hierarchy.legalCaseId === selectedLegalCase.id &&
                      d.hierarchy.subFolder === sf
                  ).length;

                  return (
                    <div
                      key={sf}
                      onClick={() => setSelectedLegalSubFolder(sf)}
                      className="bg-slate-950/60 border border-white/10 hover:border-sky-400/50 rounded-xl p-4 cursor-pointer transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FolderOpen size={18} className="text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs sm:text-sm font-bold text-white truncate">
                            {sf}
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-gray-400">
                            {sfCount} Document{sfCount === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setSubFolderModalMode('RENAME_LEGAL');
                          setTargetOldSubFolderName(sf);
                          setSubFolderTitleInput(sf);
                          setSubFolderError(null);
                          setIsSubFolderModalOpen(true);
                        }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-white cursor-pointer shrink-0"
                        title="Rename Sub-Folder"
                      >
                        <Edit size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/10">
                <h4 className="text-xs font-bold text-gray-300">
                  All Documents Filed in {selectedLegalCase.identifier} ({filteredDocuments.length})
                </h4>
              </div>
              {renderDocumentsTable(
                filteredDocuments,
                'No documents uploaded in this case yet',
                'Select any sub-folder above or click Upload Document to file orders, notices, or correspondence.'
              )}
            </div>
          </div>
        ) : (
          /* Inside Specific Legal Sub-Folder */
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">
                  {selectedLegalSubFolder}
                </h3>
                <p className="text-xs text-gray-400">
                  Case Dossier: {selectedLegalCase.identifier} ({selectedLegalCase.recipientEntity})
                </p>
              </div>
            </div>
            {renderDocumentsTable(
              filteredDocuments,
              `No documents in "${selectedLegalSubFolder}"`,
              'Click Upload Document or drag and drop a PDF or image file here.'
            )}
          </div>
        )
      ) : activeRootCategory === 'Tax' ? (
        /* ======================================================================
           2. TAX — REGULATORY AUTHORITIES (FBR, SRB, LABOUR DEPT) & FISCAL YEARS
           ====================================================================== */
        !selectedTaxAuthority ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TAX_AUTHORITIES.map((auth) => {
              const authCount = enrichedDocuments.filter(
                (d) =>
                  d.hierarchy.rootCategory === 'Tax' && d.hierarchy.taxAuthority === auth.id
              ).length;
              return (
                <div
                  key={auth.id}
                  onClick={() => setSelectedTaxAuthority(auth.id)}
                  className="bg-slate-900 border border-white/10 hover:border-sky-400/50 rounded-2xl p-5 cursor-pointer transition-colors flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-slate-950 border border-white/10 text-amber-400 flex items-center justify-center">
                        <Landmark size={18} />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">{auth.title}</h3>
                        <p className="text-xs text-gray-400">{auth.fullName}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{auth.description}</p>
                  </div>
                  <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                    <span className="font-mono tabular-nums text-gray-300">
                      {authCount} Filing{authCount === 1 ? '' : 's'}
                    </span>
                    <span className="text-sky-400 font-semibold inline-flex items-center gap-1">
                      <span>Browse Fiscal Years</span>
                      <ChevronRight size={14} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : !selectedTaxYear ? (
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">
                  {selectedTaxAuthority} — Fiscal & Tax Year Archives
                </h3>
                <p className="text-xs text-gray-400">
                  Select a fiscal year folder to view returns, withholding statements, and compliance filings.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customFiscalYearInput}
                  onChange={(e) => setCustomFiscalYearInput(e.target.value)}
                  placeholder="Add Fiscal Year (e.g., 2027)"
                  className="glass-input w-44 px-3 py-1.5 rounded-xl text-xs font-mono outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const cleanYr = customFiscalYearInput.trim();
                    if (!cleanYr) return;
                    if (!extraFiscalYears.includes(cleanYr)) {
                      setExtraFiscalYears((prev) => [...prev, cleanYr]);
                    }
                    setCustomFiscalYearInput('');
                    setSelectedTaxYear(cleanYr);
                  }}
                  className="mak-btn-secondary px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  + Add Year
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-5">
              {availableTaxYears.map((yr) => {
                const yrCount = enrichedDocuments.filter(
                  (d) =>
                    d.hierarchy.rootCategory === 'Tax' &&
                    d.hierarchy.taxAuthority === selectedTaxAuthority &&
                    d.hierarchy.taxYear === yr
                ).length;

                return (
                  <div
                    key={yr}
                    onClick={() => setSelectedTaxYear(yr)}
                    className="bg-slate-950/60 border border-white/10 hover:border-sky-400/50 rounded-xl p-4 cursor-pointer transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar size={18} className="text-sky-400" />
                      <div>
                        <div className="text-sm font-bold font-mono text-white">Year {yr}</div>
                        <div className="text-[11px] font-mono tabular-nums text-gray-400">
                          {yrCount} Report{yrCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={15} className="text-gray-400" />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h3 className="text-sm sm:text-base font-bold text-white">
                {selectedTaxAuthority} — Fiscal Year {selectedTaxYear} Filings
              </h3>
            </div>
            {renderDocumentsTable(
              filteredDocuments,
              `No ${selectedTaxAuthority} filings for Year ${selectedTaxYear}`,
              'Upload tax returns, CPR payment slips, or regulatory notices for this fiscal year.'
            )}
          </div>
        )
      ) : activeRootCategory === 'Assets' ? (
        /* ======================================================================
           3. ASSETS — SECURITY DEPOSITS & COMPANY PROPERTIES / INVESTMENTS
           ====================================================================== */
        !selectedAssetGroup ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ASSETS_SUBFOLDERS.map((group) => {
              const groupDocs = enrichedDocuments.filter(
                (d) =>
                  d.hierarchy.rootCategory === 'Assets' &&
                  d.hierarchy.assetGroup === group.id
              );
              const totalValuation = groupDocs.reduce(
                (sum, item) => sum + (Number(item.doc.assetValuationPkr) || 0),
                0
              );

              return (
                <div
                  key={group.id}
                  onClick={() => setSelectedAssetGroup(group.id)}
                  className="bg-slate-900 border border-white/10 hover:border-sky-400/50 rounded-2xl p-5 cursor-pointer transition-colors flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-950 border border-white/10 text-emerald-400 flex items-center justify-center">
                        <Building2 size={18} />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">{group.title}</h3>
                        <p className="text-xs text-gray-400">{group.subtitle}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{group.description}</p>
                  </div>

                  <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs font-mono tabular-nums">
                    <span className="text-gray-300">
                      {groupDocs.length} Record{groupDocs.length === 1 ? '' : 's'}
                      {totalValuation > 0 ? ` · PKR ${totalValuation.toLocaleString()}` : ''}
                    </span>
                    <span className="text-sky-400 font-sans font-semibold inline-flex items-center gap-1">
                      <span>Open Catalog</span>
                      <ChevronRight size={14} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h3 className="text-sm sm:text-base font-bold text-white">{selectedAssetGroup}</h3>
            </div>
            {renderDocumentsTable(
              filteredDocuments,
              `No records in ${selectedAssetGroup}`,
              'Upload bank guarantees, port deposit receipts, property deeds, or vehicle titles.'
            )}
          </div>
        )
      ) : activeRootCategory === 'Company Documents' ? (
        /* ======================================================================
           4. COMPANY DOCUMENTS — 10 MASTER REPOSITORY FOLDERS + SECURE VAULT
           ====================================================================== */
        !selectedMasterFolder ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allMasterFolders.map((folder) => {
              const count = folder.isSecureVault
                ? companyScopedVault.length
                : enrichedDocuments.filter(
                    (d) =>
                      d.hierarchy.rootCategory === 'Company Documents' &&
                      d.hierarchy.subFolder === folder.title
                  ).length;

              return (
                <div
                  key={folder.id}
                  onClick={() => setSelectedMasterFolder(folder.title)}
                  className="bg-slate-900 border border-white/10 hover:border-sky-400/50 rounded-2xl p-4 sm:p-5 cursor-pointer transition-colors flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                      {folder.isSecureVault ? (
                        <KeyRound size={18} className="text-amber-400 shrink-0" />
                      ) : (
                        <Folder size={18} className="text-sky-400 shrink-0" />
                      )}
                      <h4 className="text-sm font-bold text-white truncate">{folder.title}</h4>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{folder.description}</p>
                  </div>

                  <div className="pt-2.5 border-t border-white/10 flex items-center justify-between text-xs">
                    <span className="font-mono tabular-nums text-gray-300">
                      {count} {folder.isSecureVault ? 'Credential' : 'Document'}
                      {count === 1 ? '' : 's'}
                    </span>
                    <ChevronRight size={14} className="text-sky-400" />
                  </div>
                </div>
              );
            })}
          </div>
        ) : selectedMasterFolder === 'Office ID Passwords (Secure Vault)' ? (
          /* Protected Corporate Portal Credentials Vault */
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Office ID Passwords (Secure Vault)
                </h3>
                <p className="text-xs text-gray-400">
                  Protected corporate portal logins, user IDs, passwords, and credential rotation schedules.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openVaultCredentialModal()}
                className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus size={14} />
                <span>Add Portal Credential</span>
              </button>
            </div>

            {companyScopedVault.length === 0 ? (
              <div className="py-16 px-4 text-center max-w-md mx-auto space-y-3">
                <KeyRound size={28} className="mx-auto text-amber-400" />
                <h4 className="text-sm font-bold text-white">No portal credentials stored yet</h4>
                <p className="text-xs text-gray-400">
                  Store FBR IRIS, WeBOC, PSW, SECP eServices, SRB, or corporate portal logins securely.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-950/60 text-[11px] font-semibold text-gray-400">
                      <th className="py-3 px-4">Portal / System</th>
                      <th className="py-3 px-4">Entity</th>
                      <th className="py-3 px-4">Username / ID</th>
                      <th className="py-3 px-4">Password / Secret</th>
                      <th className="py-3 px-4">Rotation / Expiry</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs">
                    {companyScopedVault.map((cred) => {
                      const isShown = revealedVaultIds.has(cred.id);
                      return (
                        <tr key={cred.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-4 font-bold text-white">
                            {cred.portalName}
                            {cred.pinOr2faNote && (
                              <div className="text-[11px] font-normal text-gray-400">
                                2FA / PIN: {cred.pinOr2faNote}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-gray-300">{cred.recipientEntity}</td>
                          <td className="py-3 px-4 font-mono text-gray-200">{cred.usernameOrId}</td>
                          <td className="py-3 px-4 font-mono">
                            <div className="inline-flex items-center gap-2">
                              <span className="text-sky-300">
                                {isShown ? cred.passwordSecret : '••••••••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedVaultIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(cred.id)) next.delete(cred.id);
                                    else next.add(cred.id);
                                    return next;
                                  })
                                }
                                className="text-gray-400 hover:text-white cursor-pointer"
                                title={isShown ? 'Hide Password' : 'Show Password'}
                              >
                                {isShown ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopySecret(cred.id, cred.passwordSecret)}
                                className="text-gray-400 hover:text-emerald-400 cursor-pointer"
                                title="Copy Password"
                              >
                                {copiedVaultId === cred.id ? (
                                  <Check size={13} className="text-emerald-400" />
                                ) : (
                                  <Copy size={13} />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-gray-300">
                            {cred.expiryDate || 'No Expiry'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openVaultCredentialModal(cred)}
                                className="p-1.5 text-gray-300 hover:text-white cursor-pointer"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setVaultPendingDelete(cred)}
                                className="p-1.5 text-gray-400 hover:text-rose-400 cursor-pointer"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h3 className="text-sm sm:text-base font-bold text-white">{selectedMasterFolder}</h3>
            </div>
            {renderDocumentsTable(
              filteredDocuments,
              `No documents filed in ${selectedMasterFolder}`,
              'Upload PDF certificates, licences, guarantees, or statutory records to this folder.'
            )}
          </div>
        )
      ) : activeRootCategory === 'Quotations' ? (
        /* ======================================================================
           5. QUOTATIONS — OUTBOUND COMMERCIAL ARCHIVE (SEARCHABLE BY CLIENT, DATE, SERVICE, STATUS)
           ====================================================================== */
        <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-white/10 space-y-3">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white">
                Outbound Commercial Quotations Archive
              </h3>
              <p className="text-xs text-gray-400">
                Filter commercial proposals by Client Name, Issuance Date range, Service Type, and Approval Status.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <input
                type="text"
                value={quoteClientSearch}
                onChange={(e) => setQuoteClientSearch(e.target.value)}
                placeholder="Filter by Client Name..."
                className="glass-input rounded-xl px-3 py-2 text-xs outline-none"
              />

              <select
                value={quoteServiceFilter}
                onChange={(e) => setQuoteServiceFilter(e.target.value)}
                className="glass-input rounded-xl px-3 py-2 text-xs outline-none"
              >
                <option value="ALL">All Service Types</option>
                {QUOTATION_SERVICE_TYPES.map((srv) => (
                  <option key={srv} value={srv}>
                    {srv}
                  </option>
                ))}
              </select>

              <select
                value={quoteStatusFilter}
                onChange={(e) =>
                  setQuoteStatusFilter(e.target.value as 'ALL' | QuotationStatus)
                }
                className="glass-input rounded-xl px-3 py-2 text-xs outline-none"
              >
                <option value="ALL">All Statuses</option>
                {QUOTATION_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>

              <input
                type="date"
                value={quoteDateFrom}
                onChange={(e) => setQuoteDateFrom(e.target.value)}
                title="From Issuance Date"
                className="glass-input rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
              />

              <input
                type="date"
                value={quoteDateTo}
                onChange={(e) => setQuoteDateTo(e.target.value)}
                title="To Issuance Date"
                className="glass-input rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
              />
            </div>
          </div>

          {renderDocumentsTable(
            filteredDocuments,
            'No commercial quotations found',
            'Upload outbound commercial tariff proposals and track Pending, Accepted, or Rejected status.'
          )}
        </div>
      ) : (
        /* ======================================================================
           6. FINANCE (LEDGERS, VENDORS & FRANCHISES)
           ====================================================================== */
        <div className="space-y-4">
          {/* Sub-Navigation Bar for Finance Category */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-white/10 rounded-2xl px-4 py-3">
            <div
              data-custom-control="true"
              className="inline-flex items-center flex-wrap gap-1 p-1 rounded-xl bg-slate-950 border border-white/10"
            >
              <button
                type="button"
                onClick={() => {
                  setFinanceSection('FRANCHISES');
                  setFranchiseSubView('LIST');
                  setFranchiseContextCrumb('');
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  financeSection === 'FRANCHISES'
                    ? 'bg-sky-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <MapPin size={14} />
                <span>Franchise Management ({franchises.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setFinanceSection('VENDORS')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  financeSection === 'VENDORS'
                    ? 'bg-sky-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Building2 size={14} />
                <span>Vendors Directory ({vendors.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setFinanceSection('LEDGERS')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  financeSection === 'LEDGERS'
                    ? 'bg-sky-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Wallet size={14} />
                <span>Corporate Ledgers</span>
              </button>
            </div>

            {onNavigateToFinance && (
              <button
                type="button"
                onClick={() => onNavigateToFinance('franchises')}
                className="mak-btn-secondary px-3.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Open Full Finance Workspace</span>
                <ExternalLink size={13} className="text-sky-400" />
              </button>
            )}
          </div>

          {financeSection === 'FRANCHISES' ? (
            <FranchiseManagement
              externalSubView={franchiseSubView}
              onSubViewChange={(nextSubView, contextTitle) => {
                setFranchiseSubView(nextSubView);
                setFranchiseContextCrumb(contextTitle || '');
              }}
            />
          ) : financeSection === 'VENDORS' ? (
            <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Approved Corporate Vendors & Utility Accounts
                  </h3>
                  <p className="text-xs text-gray-400">
                    Registered terminal, maintenance, facility, and utility vendors across MAK Group operations.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsVendorModalOpen(true)}
                    className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Plus size={14} />
                    <span>Register Vendor</span>
                  </button>
                  {onNavigateToFinance && (
                    <button
                      type="button"
                      onClick={() => onNavigateToFinance('vendor_ledger')}
                      className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Open Vendor Ledger
                    </button>
                  )}
                </div>
              </div>

              {vendors.length === 0 ? (
                <div className="py-16 text-center text-xs text-gray-400">
                  No vendors registered yet. Click &ldquo;Register Vendor&rdquo; above to add a vendor profile.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-950/60 text-[11px] font-semibold text-gray-400">
                        <th className="py-3 px-4">Vendor Name</th>
                        <th className="py-3 px-4">Category</th>
                        <th className="py-3 px-4">Contact Number</th>
                        <th className="py-3 px-4">Address / Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs">
                      {vendors.map((v) => (
                        <tr key={v.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-4 font-bold text-white">{v.name}</td>
                          <td className="py-3 px-4 text-gray-300">{v.category}</td>
                          <td className="py-3 px-4 font-mono tabular-nums text-gray-300">
                            {v.contactNumber || '—'}
                          </td>
                          <td className="py-3 px-4 text-gray-400">{v.address || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  tab: 'cashbook',
                  title: 'Master Cashbook',
                  desc: 'Daily reconciled cash and bank inflows, outflows, and voucher records.'
                },
                {
                  tab: 'client_ledger',
                  title: 'Client Statements & Ledgers',
                  desc: 'Case-wise invoiced receivables, client receipts, and downloadable PDF statements.'
                },
                {
                  tab: 'general_ledger',
                  title: 'General Ledger',
                  desc: 'Consolidated double-entry accounting across shipments, containers, and accounts.'
                },
                {
                  tab: 'receivables',
                  title: 'Accounts Receivable',
                  desc: 'Pending and partial client invoices across active logistics categories.'
                },
                {
                  tab: 'payables',
                  title: 'Accounts Payable',
                  desc: 'Approved port, transporter, vendor, and monthly recurring obligations.'
                },
                {
                  tab: 'franchises',
                  title: 'Franchise Port Ledgers',
                  desc: 'Open the dedicated Franchises tab inside the main Finance accounting module.'
                }
              ].map((card) => (
                <div
                  key={card.tab}
                  onClick={() =>
                    onNavigateToFinance
                      ? onNavigateToFinance(card.tab)
                      : setFinanceSection('FRANCHISES')
                  }
                  className="bg-slate-900 border border-white/10 hover:border-sky-400/50 rounded-2xl p-5 cursor-pointer transition-colors flex flex-col justify-between gap-3"
                >
                  <div>
                    <h4 className="text-sm font-bold text-white">{card.title}</h4>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{card.desc}</p>
                  </div>
                  <div className="text-xs font-semibold text-sky-400 inline-flex items-center gap-1">
                    <span>Open Ledger</span>
                    <ChevronRight size={14} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================
          MODALS: UPLOAD DOCUMENT, CREATE LEGAL CASE, CUSTOM SUB-FOLDER, VAULT, SCHEMA
          ======================================================================== */}
      <CompanyDocumentUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          setEditingDocument(null);
          setPreDroppedFiles(undefined);
        }}
        onSave={saveCompanyDocumentToFirestore}
        defaultRootCategory={activeRootCategory || 'Company Documents'}
        legalCases={companyScopedLegalCases}
        defaultLegalCaseId={selectedLegalCaseId || undefined}
        defaultSubFolder={selectedLegalSubFolder || selectedMasterFolder || undefined}
        defaultTaxAuthority={selectedTaxAuthority || undefined}
        defaultTaxYear={selectedTaxYear || undefined}
        defaultAssetGroup={selectedAssetGroup || undefined}
        customMasterFolders={customMasterFolderNames}
        editingDocument={editingDocument}
        preDroppedFiles={preDroppedFiles}
      />

      {/* Dynamic Legal Case Generator Modal */}
      {isLegalCaseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-slate-950 border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-slate-900 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-white">
                {editingLegalCase ? 'Edit Legal Case Dossier' : 'Create New Legal Case'}
              </h3>
              <button
                type="button"
                onClick={() => setIsLegalCaseModalOpen(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {caseFormError && (
              <div className="px-5 py-2.5 bg-rose-500/15 border-b border-rose-500/30 text-xs text-rose-300">
                {caseFormError}
              </div>
            )}

            <form onSubmit={handleSaveLegalCase} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Unique Case Identifier / Title *
                </label>
                <input
                  type="text"
                  value={caseIdentifier}
                  onChange={(e) => setCaseIdentifier(e.target.value)}
                  placeholder="Enter container number, shipment ID, or corporate case title"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Internal Group Entity *
                  </label>
                  <select
                    value={caseEntity}
                    onChange={(e) => setCaseEntity(e.target.value)}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                  >
                    {RECIPIENT_ENTITIES.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Next Hearing Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={caseNextHearing}
                    onChange={(e) => setCaseNextHearing(e.target.value)}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  Sub-Folder Provisioning Template *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div
                    onClick={() => setCaseTrack('LOGISTICS_CRIMINAL')}
                    className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                      caseTrack === 'LOGISTICS_CRIMINAL'
                        ? 'bg-sky-500/15 border-sky-400/50 text-white'
                        : 'bg-slate-900 border-white/10 text-gray-300'
                    }`}
                  >
                    <div className="text-xs font-bold">Logistics / Customs / Criminal / Transit</div>
                    <div className="text-[11px] text-gray-400 mt-1">
                      Auto-provisions 7 proceedings sub-folders (Police FIR, Customs FIR, Transit & ONO, Appeals, High Courts, Correspondence, Consignment).
                    </div>
                  </div>

                  <div
                    onClick={() => setCaseTrack('CIVIL_CORPORATE')}
                    className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                      caseTrack === 'CIVIL_CORPORATE'
                        ? 'bg-sky-500/15 border-sky-400/50 text-white'
                        : 'bg-slate-900 border-white/10 text-gray-300'
                    }`}
                  >
                    <div className="text-xs font-bold">Civil / Corporate Case</div>
                    <div className="text-[11px] text-gray-400 mt-1">
                      Auto-provisions 5 sub-folders (Original Plaint, Written Statement, Evidence & Exhibits, Lower Court Judgments, Appellate).
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Court / Collectorate / Authority (Optional)
                </label>
                <input
                  type="text"
                  value={caseCourtOrForum}
                  onChange={(e) => setCaseCourtOrForum(e.target.value)}
                  placeholder="Enter court, tribunal, or customs collectorate"
                  className="glass-input w-full rounded-xl px-3.5 py-2 text-xs outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsLegalCaseModalOpen(false)}
                  className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingCase}
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  {isSavingCase
                    ? 'Saving...'
                    : editingLegalCase
                      ? 'Save Changes'
                      : 'Create Case & Provision Sub-Folders'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Sub-Folder Modal */}
      {isSubFolderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-slate-900 border-b border-white/10 flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">
                {subFolderModalMode === 'RENAME_LEGAL'
                  ? 'Rename Sub-Folder'
                  : subFolderModalMode === 'ADD_COMPANY'
                    ? 'Create Compliance Folder'
                    : 'Add Custom Sub-Folder'}
              </h4>
              <button
                type="button"
                onClick={() => setIsSubFolderModalOpen(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {subFolderError && (
              <div className="px-5 py-2 bg-rose-500/15 text-xs text-rose-300">{subFolderError}</div>
            )}

            <form onSubmit={handleSaveCustomSubFolder} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Folder Title *
                </label>
                <input
                  type="text"
                  value={subFolderTitleInput}
                  onChange={(e) => setSubFolderTitleInput(e.target.value)}
                  placeholder="Enter custom folder title"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                  autoFocus
                  required
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSubFolderModalOpen(false)}
                  className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Save Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Secure Vault Credential Modal */}
      {isVaultModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-slate-900 border-b border-white/10 flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">
                {editingVaultItem ? 'Edit Portal Credential' : 'Add Portal Credential'}
              </h4>
              <button
                type="button"
                onClick={() => setIsVaultModalOpen(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveVaultCredential} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Portal / System Name *
                </label>
                <input
                  type="text"
                  value={vaultPortalName}
                  onChange={(e) => setVaultPortalName(e.target.value)}
                  placeholder="e.g., FBR IRIS, WeBOC, PSW, SECP eServices"
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Owning Entity
                  </label>
                  <select
                    value={vaultEntity}
                    onChange={(e) => setVaultEntity(e.target.value)}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                  >
                    {RECIPIENT_ENTITIES.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Expiry / Rotation Date
                  </label>
                  <input
                    type="date"
                    value={vaultExpiryDate}
                    onChange={(e) => setVaultExpiryDate(e.target.value)}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Username / Login ID *
                </label>
                <input
                  type="text"
                  value={vaultUsername}
                  onChange={(e) => setVaultUsername(e.target.value)}
                  placeholder="Enter user ID or registration number"
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Password / Secret *
                </label>
                <input
                  type="text"
                  value={vaultPassword}
                  onChange={(e) => setVaultPassword(e.target.value)}
                  placeholder="Enter portal password"
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  PIN / 2FA Recovery Note (Optional)
                </label>
                <input
                  type="text"
                  value={vaultPinNote}
                  onChange={(e) => setVaultPinNote(e.target.value)}
                  placeholder="Optional PIN or registered recovery contact"
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsVaultModalOpen(false)}
                  className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Save Credential
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Register Vendor Modal */}
      {isVendorModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-slate-900 border-b border-white/10 flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">Register Vendor Profile</h4>
              <button
                type="button"
                onClick={() => setIsVendorModalOpen(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSaveVendorQuick} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Vendor Business Name *
                </label>
                <input
                  type="text"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Enter vendor title"
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Service Category
                </label>
                <select
                  value={vendorCategory}
                  onChange={(e) => setVendorCategory(e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                >
                  {VENDOR_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Contact Number
                </label>
                <input
                  type="text"
                  value={vendorPhone}
                  onChange={(e) => setVendorPhone(e.target.value)}
                  placeholder="Contact number"
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Office / Terminal Location
                </label>
                <input
                  type="text"
                  value={vendorAddress}
                  onChange={(e) => setVendorAddress(e.target.value)}
                  placeholder="City or terminal address"
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsVendorModalOpen(false)}
                  className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Save Vendor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PostgreSQL & Firebase Firestore Schema Specification Modal */}
      {isSchemaModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-4xl max-h-[90vh] bg-slate-950 border border-white/15 rounded-2xl overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 bg-slate-900 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Enterprise Database Schema & Real-Time API Specification
                </h3>
                <p className="text-xs text-gray-400">
                  PostgreSQL DDL & Live Firebase Firestore Collections for Corporate DMS & Automated Franchise Port Ledgers
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSchemaModalOpen(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4 text-xs font-mono text-gray-300">
              <pre className="p-4 rounded-xl bg-slate-900 border border-white/10 overflow-x-auto whitespace-pre">
                {FIRESTORE_CORPORATE_DMS_SPEC}
              </pre>
              <pre className="p-4 rounded-xl bg-slate-900 border border-white/10 overflow-x-auto whitespace-pre">
                {POSTGRESQL_CORPORATE_DMS_DDL}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmations */}
      {docPendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-bold text-white">Delete Document?</h4>
            <p className="text-xs text-gray-300">
              Permanently delete <span className="font-bold text-white">{docPendingDelete.title}</span>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDocPendingDelete(null)}
                className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await deleteCompanyDocumentFromFirestore(docPendingDelete.id);
                    setDocPendingDelete(null);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {casePendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-bold text-white">Delete Legal Case Dossier?</h4>
            <p className="text-xs text-gray-300">
              Permanently remove case dossier{' '}
              <span className="font-bold text-white">{casePendingDelete.identifier}</span>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCasePendingDelete(null)}
                className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await deleteCorporateLegalCaseFromFirestore(casePendingDelete.id);
                    setCasePendingDelete(null);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Delete Case'}
              </button>
            </div>
          </div>
        </div>
      )}

      {vaultPendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-bold text-white">Delete Vault Credential?</h4>
            <p className="text-xs text-gray-300">
              Remove stored credential for{' '}
              <span className="font-bold text-white">{vaultPendingDelete.portalName}</span>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVaultPendingDelete(null)}
                className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await deleteCorporateVaultCredentialFromFirestore(vaultPendingDelete.id);
                    setVaultPendingDelete(null);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <UniversalDocumentPreviewModal
        isOpen={Boolean(previewDoc)}
        onClose={() => {
          setPreviewDoc(null);
          setPreviewResolvedUrl(null);
        }}
        title={previewDoc?.title || 'Document Preview'}
        file={previewResolvedUrl}
        filename={previewDoc?.fileName || previewDoc?.title || 'Document'}
        verificationItems={previewVerificationItems}
      />
    </div>
  );
};

export default CompanyDocuments;

import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderArchive,
  FolderOpen,
  FolderPlus,
  Scale,
  Landmark,
  Building2,
  ShieldCheck,
  FileText,
  Tag,
  Search,
  Upload,
  Plus,
  Download,
  Eye,
  Edit,
  Trash2,
  ChevronRight,
  Calendar,
  Clock,
  Gavel,
  Bell,
  AlertTriangle,
  CheckCircle2,
  Lock,
  KeyRound,
  EyeOff,
  Copy,
  Check,
  Database,
  X,
  Loader2,
  Filter,
  HardDrive,
  Award,
  CreditCard,
  TrendingUp,
  FileSignature,
  Users
} from 'lucide-react';
import {
  CompanyDocument,
  CorporateDocumentStatus,
  CorporateLegalCase,
  CorporateRecipientEntity,
  CorporateRootCategory,
  CorporateVaultCredential,
  LegalCaseTrack,
  QuotationStatus
} from '../types';
import {
  subscribeToCompanyDocuments,
  saveCompanyDocumentToFirestore,
  deleteCompanyDocumentFromFirestore,
  subscribeToCorporateLegalCases,
  saveCorporateLegalCaseToFirestore,
  deleteCorporateLegalCaseFromFirestore,
  subscribeToCorporateVaultCredentials,
  saveCorporateVaultCredentialToFirestore,
  deleteCorporateVaultCredentialFromFirestore
} from '../services/dbService';
import {
  CORPORATE_ROOT_CATEGORIES,
  LEGAL_LOGISTICS_CRIMINAL_SUBFOLDERS,
  LEGAL_CIVIL_CORPORATE_SUBFOLDERS,
  getProvisionedLegalSubFolders,
  normalizeLegalSubFolderName,
  TAX_AUTHORITIES,
  DEFAULT_FISCAL_YEARS,
  ASSETS_SUBFOLDERS,
  MASTER_COMPANY_DOC_FOLDERS,
  RECIPIENT_ENTITIES,
  DOCUMENT_STATUS_TAGS,
  QUOTATION_STATUSES,
  QUOTATION_SERVICE_TYPES,
  resolveDocumentHierarchy,
  evaluateDocumentAlarms,
  POSTGRESQL_CORPORATE_DMS_DDL,
  FIRESTORE_CORPORATE_DMS_SPEC
} from '../services/corporateFilingArchitecture';
import { resolveStoredDocumentDataUrl } from '../services/documentStorage';
import { downloadFile } from '../services/geminiService';
import { safeAppStorage } from '../services/storage';
import { useActiveCompany } from '../services/companyService';
import { ThemeToggleSwitch } from './ThemeToggleSwitch';
import { UniversalDocumentPreviewModal, DataMappingCheckItem } from './UniversalDocumentPreviewModal';
import { CompanyDocumentUploadModal, UploadHierarchyPreset } from './CompanyDocumentUploadModal';
import { jsPDF } from 'jspdf';
import {
  drawPdfCorporateHeader,
  drawPdfCorporateFooter,
  drawOfficialCompanyStampOnly,
  cleanPdfText
} from '../services/pdfExportService';

const CUSTOM_FISCAL_YEARS_KEY = 'mak_corp_dms_fiscal_years';

function mapActiveCompanyToEntity(companyId?: string): CorporateRecipientEntity {
  const clean = String(companyId || '').toLowerCase();
  if (clean.includes('truckit')) return 'Truckit';
  if (clean.includes('muhib')) return 'Muhib';
  if (clean.includes('vantage')) return 'Vantage';
  if (clean.includes('docks')) return 'Docks';
  return 'MAK Group';
}

function getRootCategoryIcon(cat: CorporateRootCategory) {
  switch (cat) {
    case 'Legal':
      return Scale;
    case 'Tax':
      return Landmark;
    case 'Assets':
      return HardDrive;
    case 'Company Documents':
      return ShieldCheck;
    case 'Quotations':
      return Tag;
  }
}

function getMasterFolderIcon(folderId: string) {
  switch (folderId) {
    case 'SECP':
      return Building2;
    case 'Chamber of Commerce':
      return Award;
    case 'Licence Book':
      return ShieldCheck;
    case 'Owners ID Cards & Passports':
      return Users;
    case 'Insurance Guarantees':
      return CreditCard;
    case 'Customs Certificates & Permissions':
      return FolderArchive;
    case 'Office Rent Agreements & Slips':
      return FileSignature;
    case 'Office ID Passwords (Secure Vault)':
      return Lock;
    case 'Stock Exchange Documents':
      return TrendingUp;
    case 'State Bank Documents':
      return Landmark;
    default:
      return FolderOpen;
  }
}

function getStatusBadgeClasses(status: CorporateDocumentStatus): string {
  switch (status) {
    case 'Active':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'Pending Hearing':
      return 'bg-sky-500/15 text-sky-300 border-sky-400/30';
    case 'Expired':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    case 'Resolved':
      return 'bg-teal-500/15 text-teal-300 border-teal-500/30';
    case 'Archived':
      return 'bg-white/10 text-gray-300 border-white/15';
    default:
      return 'bg-white/10 text-gray-300 border-white/15';
  }
}

function getQuotationBadgeClasses(status: QuotationStatus): string {
  switch (status) {
    case 'Accepted':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'Rejected':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    default:
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  }
}

export const CompanyDocuments: React.FC = () => {
  const { activeCompany } = useActiveCompany();
  const defaultEntity = useMemo(
    () => mapActiveCompanyToEntity(activeCompany?.id),
    [activeCompany?.id]
  );

  // Real-time Firestore Collections
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [legalCases, setLegalCases] = useState<CorporateLegalCase[]>([]);
  const [vaultCredentials, setVaultCredentials] = useState<CorporateVaultCredential[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Multi-Tier Navigation State (Drives Breadcrumbs & Active View)
  const [activeRoot, setActiveRoot] = useState<CorporateRootCategory | null>(null);
  const [activeLegalCaseId, setActiveLegalCaseId] = useState<string | null>(null);
  const [activeSubFolder, setActiveSubFolder] = useState<string | null>(null);
  const [activeTaxAuthority, setActiveTaxAuthority] = useState<string | null>(null);
  const [activeTaxYear, setActiveTaxYear] = useState<string | null>(null);
  const [activeAssetGroup, setActiveAssetGroup] = useState<string | null>(null);

  // Global & Watchlist Filters
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [alarmWatchFilter, setAlarmWatchFilter] = useState<'NONE' | 'HEARINGS' | 'EXPIRING_SOON' | 'EXPIRED'>('NONE');

  // Asset & Quotation Specific Filters
  const [assetSubTypeFilter, setAssetSubTypeFilter] = useState<string>('ALL');
  const [quoteClientSearch, setQuoteClientSearch] = useState<string>('');
  const [quoteServiceFilter, setQuoteServiceFilter] = useState<string>('ALL');
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<string>('ALL');
  const [quoteDateFrom, setQuoteDateFrom] = useState<string>('');
  const [quoteDateTo, setQuoteDateTo] = useState<string>('');

  // Custom Fiscal Years State
  const [customFiscalYears, setCustomFiscalYears] = useState<string[]>(() =>
    safeAppStorage.getJSON<string[]>(CUSTOM_FISCAL_YEARS_KEY, [])
  );
  const [showAddYearModal, setShowAddYearModal] = useState<boolean>(false);
  const [newFiscalYearInput, setNewFiscalYearInput] = useState<string>('');

  // Upload / Edit Document Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [uploadPreset, setUploadPreset] = useState<UploadHierarchyPreset | undefined>(undefined);
  const [editingDocument, setEditingDocument] = useState<CompanyDocument | null>(null);

  // Universal Document Preview Modal State
  const [previewDoc, setPreviewDoc] = useState<CompanyDocument | null>(null);
  const [previewResolvedFile, setPreviewResolvedFile] = useState<string | null>(null);

  // Dynamic Legal Case Creation, Editing & Custom Sub-Folder State
  const [showNewLegalCaseModal, setShowNewLegalCaseModal] = useState<boolean>(false);
  const [editingLegalCase, setEditingLegalCase] = useState<CorporateLegalCase | null>(null);
  const [newCaseIdentifier, setNewCaseIdentifier] = useState<string>('');
  const [newCaseTrack, setNewCaseTrack] = useState<LegalCaseTrack>('LOGISTICS_CRIMINAL');
  const [newCaseEntity, setNewCaseEntity] = useState<string>(defaultEntity);
  const [newCaseRefNo, setNewCaseRefNo] = useState<string>('');
  const [newCaseCourt, setNewCaseCourt] = useState<string>('');
  const [newCaseCounsel, setNewCaseCounsel] = useState<string>('');
  const [newCaseOpposing, setNewCaseOpposing] = useState<string>('');
  const [newCaseHearingDate, setNewCaseHearingDate] = useState<string>('');
  const [newCaseNotes, setNewCaseNotes] = useState<string>('');
  const [modalDraftSubFolders, setModalDraftSubFolders] = useState<string[]>(() =>
    getProvisionedLegalSubFolders('LOGISTICS_CRIMINAL')
  );
  const [modalCustomFolderInput, setModalCustomFolderInput] = useState<string>('');
  const [newCaseError, setNewCaseError] = useState<string | null>(null);
  const [addingCustomSubFolder, setAddingCustomSubFolder] = useState<boolean>(false);
  const [customSubFolderName, setCustomSubFolderName] = useState<string>('');
  const [renamingSubFolderOriginal, setRenamingSubFolderOriginal] = useState<string | null>(null);
  const [renamingSubFolderValue, setRenamingSubFolderValue] = useState<string>('');

  // Secure Vault Credential State
  const [showVaultModal, setShowVaultModal] = useState<boolean>(false);
  const [editingVaultItem, setEditingVaultItem] = useState<CorporateVaultCredential | null>(null);
  const [vaultPortalName, setVaultPortalName] = useState<string>('');
  const [vaultPortalUrl, setVaultPortalUrl] = useState<string>('');
  const [vaultUsername, setVaultUsername] = useState<string>('');
  const [vaultPassword, setVaultPassword] = useState<string>('');
  const [vaultPinNote, setVaultPinNote] = useState<string>('');
  const [vaultEntity, setVaultEntity] = useState<string>(defaultEntity);
  const [vaultRecovery, setVaultRecovery] = useState<string>('');
  const [vaultExpiryDate, setVaultExpiryDate] = useState<string>('');
  const [revealedVaultIds, setRevealedVaultIds] = useState<Set<string>>(new Set());
  const [copiedVaultField, setCopiedVaultField] = useState<string | null>(null);

  // Inline Delete Confirmation IDs (No window.confirm)
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState<string | null>(null);
  const [confirmDeleteCaseId, setConfirmDeleteCaseId] = useState<string | null>(null);
  const [confirmDeleteVaultId, setConfirmDeleteVaultId] = useState<string | null>(null);

  // Database Schema & Architecture Modal
  const [showSchemaModal, setShowSchemaModal] = useState<boolean>(false);
  const [schemaTab, setSchemaTab] = useState<'POSTGRES' | 'FIRESTORE'>('POSTGRES');
  const [copiedSchema, setCopiedSchema] = useState<boolean>(false);

  // Subscribe to Firestore collections
  useEffect(() => {
    setIsLoading(true);
    const unsubDocs = subscribeToCompanyDocuments((items) => {
      setDocuments(items || []);
      setIsLoading(false);
    });
    const unsubCases = subscribeToCorporateLegalCases((items) => {
      setLegalCases(items || []);
    });
    const unsubVault = subscribeToCorporateVaultCredentials((items) => {
      setVaultCredentials(items || []);
    });

    return () => {
      unsubDocs();
      unsubCases();
      unsubVault();
    };
  }, []);

  // Enrich every document with resolved hierarchy + live alarm evaluation
  const enrichedDocuments = useMemo(() => {
    return documents.map((doc) => {
      const hierarchy = resolveDocumentHierarchy(doc);
      const alarms = evaluateDocumentAlarms(doc);
      return {
        doc,
        hierarchy,
        alarms
      };
    });
  }, [documents]);

  // Include virtual Legal Case if legacy FIR/Petition/ONO documents exist without a created case dossier
  const effectiveLegalCases = useMemo(() => {
    const normalizedCases = legalCases.map((lc) => ({
      ...lc,
      subFolders:
        lc.subFolders && lc.subFolders.length > 0
          ? lc.subFolders.map((sf) => normalizeLegalSubFolderName(sf))
          : getProvisionedLegalSubFolders(lc.caseTrack)
    }));

    const hasLegacyLegalDocs = enrichedDocuments.some(
      (item) =>
        item.hierarchy.rootCategory === 'Legal' &&
        item.hierarchy.legalCaseId === 'legacy_general_legal_archive'
    );
    const existsInDb = normalizedCases.some((c) => c.id === 'legacy_general_legal_archive');
    if (hasLegacyLegalDocs && !existsInDb) {
      const virtualArchive: CorporateLegalCase = {
        id: 'legacy_general_legal_archive',
        identifier: 'General Legal & Enforcement Archive',
        caseTrack: 'LOGISTICS_CRIMINAL',
        recipientEntity: 'MAK Group',
        courtOrForum: 'Customs / High Court / Enforcement',
        status: 'Active',
        subFolders: [...LEGAL_LOGISTICS_CRIMINAL_SUBFOLDERS],
        createdAt: new Date(0).toISOString()
      };
      return [...normalizedCases, virtualArchive];
    }
    return normalizedCases;
  }, [legalCases, enrichedDocuments]);

  const activeLegalCase = useMemo(
    () => effectiveLegalCases.find((c) => c.id === activeLegalCaseId) || null,
    [effectiveLegalCases, activeLegalCaseId]
  );

  // Global Alarm Metrics
  const alarmMetrics = useMemo(() => {
    let hearingsCount = 0;
    let expiringSoonCount = 0;
    let expiredCount = 0;

    for (const item of enrichedDocuments) {
      if (entityFilter !== 'ALL' && item.hierarchy.recipientEntity !== entityFilter) continue;
      if (item.alarms.isHearingDueOrSoon || item.alarms.isHearingOverdue) hearingsCount++;
      if (item.alarms.isWithinExpiryAlarm) expiringSoonCount++;
      if (item.alarms.isExpired) expiredCount++;
    }

    return {
      total: enrichedDocuments.filter(
        (i) => entityFilter === 'ALL' || i.hierarchy.recipientEntity === entityFilter
      ).length,
      hearingsCount,
      expiringSoonCount,
      expiredCount
    };
  }, [enrichedDocuments, entityFilter]);

  // Reset navigation to Root Dashboard
  const navigateToRoot = () => {
    setActiveRoot(null);
    setActiveLegalCaseId(null);
    setActiveSubFolder(null);
    setActiveTaxAuthority(null);
    setActiveTaxYear(null);
    setActiveAssetGroup(null);
    setAlarmWatchFilter('NONE');
  };

  // Select Root Category Card
  const openRootCategory = (cat: CorporateRootCategory) => {
    setActiveRoot(cat);
    setActiveLegalCaseId(null);
    setActiveSubFolder(null);
    setActiveTaxAuthority(null);
    setActiveTaxYear(null);
    setActiveAssetGroup(null);
    setAlarmWatchFilter('NONE');
    setAssetSubTypeFilter('ALL');
  };

  // Open Upload Modal with current Breadcrumb Context Pre-Selected
  const handleOpenUploadModal = (overridePreset?: UploadHierarchyPreset) => {
    setEditingDocument(null);
    if (overridePreset) {
      setUploadPreset(overridePreset);
    } else {
      setUploadPreset({
        rootCategory: activeRoot || 'Company Documents',
        legalCaseId: activeLegalCaseId || effectiveLegalCases[0]?.id,
        subFolder: activeSubFolder || undefined,
        taxAuthority: activeTaxAuthority || 'FBR',
        taxYear: activeTaxYear || new Date().getFullYear().toString(),
        assetGroup: activeAssetGroup || 'Security Deposits Tracking'
      });
    }
    setIsUploadModalOpen(true);
  };

  // Open Preview Modal
  const handleOpenPreview = async (docItem: CompanyDocument) => {
    setPreviewDoc(docItem);
    const resolved = await resolveStoredDocumentDataUrl({
      url: docItem.fileUrl || null,
      id: docItem.id || null,
      name: docItem.fileName || docItem.title || null
    });
    setPreviewResolvedFile(resolved || docItem.fileUrl || null);
  };

  // Download Original File or Official Compliance Summary PDF
  const handleDownloadDocument = async (docItem: CompanyDocument) => {
    const resolvedUrl = await resolveStoredDocumentDataUrl({
      url: docItem.fileUrl || null,
      id: docItem.id || null,
      name: docItem.fileName || docItem.title || null
    });
    if (resolvedUrl) {
      downloadFile(resolvedUrl, docItem.fileName || `${docItem.title.replace(/\s+/g, '_')}.pdf`);
      return;
    }

    const hierarchy = resolveDocumentHierarchy(docItem);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 14;

    let currentY = await drawPdfCorporateHeader(pdf, {
      title: 'CORPORATE COMPLIANCE & FILING RECORD',
      refNo: docItem.referenceNo || `DMS-${docItem.id.slice(-8).toUpperCase()}`,
      date: hierarchy.issuanceDate || new Date().toISOString().split('T')[0],
      subject: docItem.subject || docItem.title
    });

    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(margin, currentY, pageWidth - margin * 2, 10, 1.5, 1.5, 'FD');
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(10.5);
    pdf.setFont('helvetica', 'bold');
    pdf.text(cleanPdfText(docItem.title), margin + 4, currentY + 6.5, {
      maxWidth: pageWidth - margin * 2 - 8
    });
    currentY += 15;

    const addRow = (label: string, val?: string | number) => {
      if (val === undefined || val === null || val === '') return;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(100, 116, 139);
      pdf.text(label, margin + 2, currentY);

      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(15, 23, 42);
      pdf.text(cleanPdfText(String(val)), margin + 48, currentY, {
        maxWidth: pageWidth - margin - 52
      });
      currentY += 6.5;
    };

    addRow('Primary Category:', hierarchy.rootCategory);
    if (hierarchy.legalCaseTitle) addRow('Legal Case Dossier:', hierarchy.legalCaseTitle);
    if (hierarchy.subFolder) addRow('Sub-Folder:', hierarchy.subFolder);
    if (hierarchy.taxAuthority) addRow('Tax Authority / Year:', `${hierarchy.taxAuthority} — FY ${hierarchy.taxYear}`);
    if (hierarchy.assetGroup) addRow('Asset Repository:', hierarchy.assetGroup);
    addRow('Sender / Issuer:', hierarchy.senderIssuer);
    addRow('Recipient Entity:', hierarchy.recipientEntity);
    addRow('Issuance Date:', hierarchy.issuanceDate);
    addRow('Validity Period:', docItem.unlimitedValidity ? 'Perpetual / Unlimited' : `${hierarchy.validityStartDate || '-'} to ${hierarchy.validityEndDate || '-'}`);
    if (docItem.hearingDate) addRow('Hearing / Action Date:', `${docItem.hearingDate} ${docItem.hearingTime || ''}`);
    addRow('Status Tag:', docItem.statusTag || 'Active');
    if (docItem.subject) addRow('Summary / Notes:', docItem.subject);

    const stampY = Math.max(currentY + 8, 228);
    drawOfficialCompanyStampOnly(pdf, pageWidth - margin - 60, stampY, 'CORPORATE FILING SEAL', activeCompany?.id);
    drawPdfCorporateFooter(pdf, 'Page 1 of 1');
    pdf.save(`${docItem.title.replace(/\s+/g, '_')}_record.pdf`);
  };

  // Open Clean Modal for Creating or Editing a Legal Case
  const openCreateNewCaseModal = () => {
    setEditingLegalCase(null);
    setNewCaseError(null);
    setNewCaseIdentifier('');
    setNewCaseTrack('LOGISTICS_CRIMINAL');
    setNewCaseEntity(defaultEntity);
    setNewCaseRefNo('');
    setNewCaseCourt('');
    setNewCaseCounsel('');
    setNewCaseOpposing('');
    setNewCaseHearingDate('');
    setNewCaseNotes('');
    setModalDraftSubFolders(getProvisionedLegalSubFolders('LOGISTICS_CRIMINAL'));
    setModalCustomFolderInput('');
    setShowNewLegalCaseModal(true);
  };

  const openEditCaseModal = (targetCase: CorporateLegalCase) => {
    setEditingLegalCase(targetCase);
    setNewCaseError(null);
    setNewCaseIdentifier(targetCase.identifier);
    setNewCaseTrack(targetCase.caseTrack);
    setNewCaseEntity(targetCase.recipientEntity || defaultEntity);
    setNewCaseRefNo(targetCase.caseReferenceNo || '');
    setNewCaseCourt(targetCase.courtOrForum || '');
    setNewCaseCounsel(targetCase.legalCounsel || '');
    setNewCaseOpposing(targetCase.opposingParty || '');
    setNewCaseHearingDate(targetCase.nextHearingDate || '');
    setNewCaseNotes(targetCase.notes || '');
    setModalDraftSubFolders(
      targetCase.subFolders && targetCase.subFolders.length > 0
        ? targetCase.subFolders.map((sf) => normalizeLegalSubFolderName(sf))
        : getProvisionedLegalSubFolders(targetCase.caseTrack)
    );
    setModalCustomFolderInput('');
    setShowNewLegalCaseModal(true);
  };

  // Dynamic Legal Case Creation / Update Handler
  const handleCreateLegalCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewCaseError(null);
    const cleanId = newCaseIdentifier.trim();
    if (!cleanId) {
      setNewCaseError('Please enter a Unique Case Identifier or Title (e.g., Container # ABC-12345 or Suit # 412/2025).');
      return;
    }
    const duplicate = legalCases.some(
      (c) =>
        c.id !== editingLegalCase?.id &&
        c.identifier.trim().toLowerCase() === cleanId.toLowerCase()
    );
    if (duplicate) {
      setNewCaseError('A legal case folder with this identifier already exists.');
      return;
    }

    const cleanedSubFolders = Array.from(
      new Set(modalDraftSubFolders.map((sf) => sf.trim()).filter(Boolean))
    );
    const finalSubFolders =
      cleanedSubFolders.length > 0
        ? cleanedSubFolders
        : getProvisionedLegalSubFolders(newCaseTrack);

    const caseId =
      editingLegalCase?.id ||
      `lcase_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const savedCase: CorporateLegalCase = {
      ...(editingLegalCase || {}),
      id: caseId,
      identifier: cleanId,
      caseTrack: newCaseTrack,
      recipientEntity: newCaseEntity || defaultEntity,
      caseReferenceNo: newCaseRefNo.trim() || undefined,
      courtOrForum: newCaseCourt.trim() || undefined,
      legalCounsel: newCaseCounsel.trim() || undefined,
      opposingParty: newCaseOpposing.trim() || undefined,
      nextHearingDate: newCaseHearingDate || undefined,
      status: newCaseHearingDate ? 'Pending Hearing' : editingLegalCase?.status || 'Active',
      subFolders: finalSubFolders,
      notes: newCaseNotes.trim() || undefined,
      createdAt: editingLegalCase?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy:
        editingLegalCase?.createdBy ||
        safeAppStorage.getItem('dpl_current_user_name') ||
        'Documentation Manager'
    };

    await saveCorporateLegalCaseToFirestore(savedCase);

    // If editing an existing case and its identifier changed, update linked documents' case title
    if (editingLegalCase && editingLegalCase.identifier !== cleanId) {
      const linkedDocs = documents.filter((d) => d.legalCaseId === editingLegalCase.id);
      await Promise.all(
        linkedDocs.map((d) =>
          saveCompanyDocumentToFirestore({
            ...d,
            legalCaseTitle: cleanId,
            subcategory: cleanId
          })
        )
      );
    }

    setShowNewLegalCaseModal(false);
    setEditingLegalCase(null);
    setNewCaseIdentifier('');
    setNewCaseRefNo('');
    setNewCaseCourt('');
    setNewCaseCounsel('');
    setNewCaseOpposing('');
    setNewCaseHearingDate('');
    setNewCaseNotes('');
    setActiveRoot('Legal');
    setActiveLegalCaseId(savedCase.id);
    if (!editingLegalCase) {
      setActiveSubFolder(null);
    }
  };

  // Add Custom Sub-Folder inside an existing Legal Case
  const handleAddCustomSubFolderToCase = async () => {
    const trimmed = customSubFolderName.trim();
    if (!trimmed || !activeLegalCase) return;
    const existing =
      activeLegalCase.subFolders && activeLegalCase.subFolders.length > 0
        ? activeLegalCase.subFolders.map((sf) => normalizeLegalSubFolderName(sf))
        : getProvisionedLegalSubFolders(activeLegalCase.caseTrack);
    if (!existing.some((sf) => sf.toLowerCase() === trimmed.toLowerCase())) {
      await saveCorporateLegalCaseToFirestore({
        ...activeLegalCase,
        subFolders: [...existing, trimmed],
        updatedAt: new Date().toISOString()
      });
    }
    setCustomSubFolderName('');
    setAddingCustomSubFolder(false);
  };

  // Rename an existing Sub-Folder inside a Legal Case & migrate any filed documents
  const handleRenameCaseSubFolder = async (originalName: string) => {
    const nextName = renamingSubFolderValue.trim();
    if (!activeLegalCase || !nextName || nextName === originalName) {
      setRenamingSubFolderOriginal(null);
      setRenamingSubFolderValue('');
      return;
    }

    const existing =
      activeLegalCase.subFolders && activeLegalCase.subFolders.length > 0
        ? activeLegalCase.subFolders.map((sf) => normalizeLegalSubFolderName(sf))
        : getProvisionedLegalSubFolders(activeLegalCase.caseTrack);

    const updatedSubFolders = Array.from(
      new Set(existing.map((sf) => (sf === originalName ? nextName : sf)))
    );

    await saveCorporateLegalCaseToFirestore({
      ...activeLegalCase,
      subFolders: updatedSubFolders,
      updatedAt: new Date().toISOString()
    });

    // Migrate any documents filed under originalName in this case
    const affectedDocs = documents.filter(
      (d) =>
        d.legalCaseId === activeLegalCase.id &&
        normalizeLegalSubFolderName(d.subFolder || d.category) === originalName
    );
    if (affectedDocs.length > 0) {
      await Promise.all(
        affectedDocs.map((d) =>
          saveCompanyDocumentToFirestore({
            ...d,
            subFolder: nextName,
            category: nextName
          })
        )
      );
    }

    if (activeSubFolder === originalName) {
      setActiveSubFolder(nextName);
    }
    setRenamingSubFolderOriginal(null);
    setRenamingSubFolderValue('');
  };

  // Remove an empty Sub-Folder from a Legal Case
  const handleRemoveEmptyCaseSubFolder = async (folderName: string) => {
    if (!activeLegalCase) return;
    const existing =
      activeLegalCase.subFolders && activeLegalCase.subFolders.length > 0
        ? activeLegalCase.subFolders.map((sf) => normalizeLegalSubFolderName(sf))
        : getProvisionedLegalSubFolders(activeLegalCase.caseTrack);
    if (existing.length <= 1) return;
    await saveCorporateLegalCaseToFirestore({
      ...activeLegalCase,
      subFolders: existing.filter((sf) => sf !== folderName),
      updatedAt: new Date().toISOString()
    });
  };

  // Add Custom Fiscal Year in Tax
  const handleAddFiscalYear = (e: React.FormEvent) => {
    e.preventDefault();
    const yr = newFiscalYearInput.trim().replace(/[^0-9-]/g, '');
    if (yr.length < 4) return;
    const next = Array.from(new Set([...customFiscalYears, yr]));
    setCustomFiscalYears(next);
    safeAppStorage.setJSON(CUSTOM_FISCAL_YEARS_KEY, next);
    setNewFiscalYearInput('');
    setShowAddYearModal(false);
    setActiveTaxYear(yr);
  };

  // Save Vault Credential
  const handleSaveVaultCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultPortalName.trim() || !vaultUsername.trim() || !vaultPassword.trim()) return;

    const record: CorporateVaultCredential = {
      id: editingVaultItem?.id || `vault_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      portalName: vaultPortalName.trim(),
      portalUrl: vaultPortalUrl.trim() || undefined,
      usernameOrId: vaultUsername.trim(),
      passwordSecret: vaultPassword,
      pinOr2faNote: vaultPinNote.trim() || undefined,
      recipientEntity: vaultEntity || defaultEntity,
      recoveryContact: vaultRecovery.trim() || undefined,
      expiryDate: vaultExpiryDate || undefined,
      alarmDaysBefore: 15,
      statusTag: 'Active',
      createdAt: editingVaultItem?.createdAt || new Date().toISOString(),
      createdBy: safeAppStorage.getItem('dpl_current_user_name') || 'Documentation Manager'
    };

    await saveCorporateVaultCredentialToFirestore(record);
    setShowVaultModal(false);
    setEditingVaultItem(null);
    setVaultPortalName('');
    setVaultPortalUrl('');
    setVaultUsername('');
    setVaultPassword('');
    setVaultPinNote('');
    setVaultRecovery('');
    setVaultExpiryDate('');
  };

  const handleCopyText = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedVaultField(key);
    setTimeout(() => setCopiedVaultField(null), 2000);
  };

  // Inline Quotation Status Update
  const handleUpdateQuotationStatus = async (docItem: CompanyDocument, nextStatus: QuotationStatus) => {
    await saveCompanyDocumentToFirestore({
      ...docItem,
      quotationStatus: nextStatus
    });
  };

  // Filtered Documents for the Active Folder / Search / Alarm Watch View
  const visibleDocuments = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();

    return enrichedDocuments.filter(({ doc, hierarchy, alarms }) => {
      // 1. Entity Filter
      if (entityFilter !== 'ALL' && hierarchy.recipientEntity !== entityFilter) {
        return false;
      }

      // 2. Status Tag Filter
      if (statusFilter !== 'ALL' && alarms.effectiveStatus !== statusFilter) {
        return false;
      }

      // 3. Smart Alarm Watchbar Override
      if (alarmWatchFilter === 'HEARINGS') {
        if (!alarms.isHearingDueOrSoon && !alarms.isHearingOverdue && !doc.hearingDate) return false;
      } else if (alarmWatchFilter === 'EXPIRING_SOON') {
        if (!alarms.isWithinExpiryAlarm) return false;
      } else if (alarmWatchFilter === 'EXPIRED') {
        if (!alarms.isExpired) return false;
      } else if (!q) {
        // 4. Strict Folder Hierarchy Scoping when not running a global search or alarm filter
        if (!activeRoot) return false;
        if (hierarchy.rootCategory !== activeRoot) return false;

        if (activeRoot === 'Legal') {
          if (activeLegalCaseId && hierarchy.legalCaseId !== activeLegalCaseId) return false;
          if (activeSubFolder && hierarchy.subFolder !== activeSubFolder) return false;
        } else if (activeRoot === 'Tax') {
          if (activeTaxAuthority && hierarchy.taxAuthority !== activeTaxAuthority) return false;
          if (activeTaxYear && hierarchy.taxYear !== activeTaxYear) return false;
        } else if (activeRoot === 'Assets') {
          if (activeAssetGroup && hierarchy.assetGroup !== activeAssetGroup) return false;
          if (assetSubTypeFilter !== 'ALL' && doc.assetSubType !== assetSubTypeFilter) return false;
        } else if (activeRoot === 'Company Documents') {
          if (activeSubFolder && hierarchy.subFolder !== activeSubFolder) return false;
        } else if (activeRoot === 'Quotations') {
          if (
            quoteClientSearch.trim() &&
            !(doc.quotationClientName || hierarchy.senderIssuer || '')
              .toLowerCase()
              .includes(quoteClientSearch.trim().toLowerCase())
          ) {
            return false;
          }
          if (quoteServiceFilter !== 'ALL' && doc.quotationServiceType !== quoteServiceFilter) {
            return false;
          }
          if (quoteStatusFilter !== 'ALL' && hierarchy.quotationStatus !== quoteStatusFilter) {
            return false;
          }
          if (quoteDateFrom && hierarchy.issuanceDate < quoteDateFrom) return false;
          if (quoteDateTo && hierarchy.issuanceDate > quoteDateTo) return false;
        }
      }

      // 5. Global Search Query
      if (q) {
        if (activeRoot && hierarchy.rootCategory !== activeRoot) return false;
        const searchable = [
          doc.title,
          doc.referenceNo,
          doc.subject,
          hierarchy.senderIssuer,
          hierarchy.recipientEntity,
          hierarchy.legalCaseTitle,
          hierarchy.subFolder,
          hierarchy.taxAuthority,
          hierarchy.taxYear,
          hierarchy.assetGroup,
          doc.assetLocationOrBank,
          doc.quotationClientName,
          doc.quotationServiceType
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!searchable.includes(q)) return false;
      }

      return true;
    });
  }, [
    enrichedDocuments,
    entityFilter,
    statusFilter,
    alarmWatchFilter,
    globalSearch,
    activeRoot,
    activeLegalCaseId,
    activeSubFolder,
    activeTaxAuthority,
    activeTaxYear,
    activeAssetGroup,
    assetSubTypeFilter,
    quoteClientSearch,
    quoteServiceFilter,
    quoteStatusFilter,
    quoteDateFrom,
    quoteDateTo
  ]);

  // Dynamic Fiscal Years for Selected Tax Authority
  const authorityFiscalYears = useMemo(() => {
    const years = new Set<string>([...DEFAULT_FISCAL_YEARS, ...customFiscalYears]);
    enrichedDocuments.forEach(({ hierarchy }) => {
      if (hierarchy.rootCategory === 'Tax' && (!activeTaxAuthority || hierarchy.taxAuthority === activeTaxAuthority)) {
        if (hierarchy.taxYear) years.add(hierarchy.taxYear);
      }
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [enrichedDocuments, activeTaxAuthority, customFiscalYears]);

  // Build Breadcrumb Trail Segments
  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; onClick: () => void; isCurrent?: boolean }[] = [
      {
        label: 'Dashboard',
        onClick: navigateToRoot,
        isCurrent: !activeRoot && alarmWatchFilter === 'NONE'
      }
    ];

    if (alarmWatchFilter !== 'NONE') {
      const watchLabel =
        alarmWatchFilter === 'HEARINGS'
          ? 'Upcoming Legal Hearings'
          : alarmWatchFilter === 'EXPIRING_SOON'
            ? 'Expiring Within Alarm Window'
            : 'Expired Compliance Records';
      crumbs.push({ label: watchLabel, onClick: () => {}, isCurrent: true });
      return crumbs;
    }

    if (activeRoot) {
      crumbs.push({
        label: activeRoot,
        onClick: () => openRootCategory(activeRoot),
        isCurrent:
          !activeLegalCaseId && !activeSubFolder && !activeTaxAuthority && !activeAssetGroup
      });
    }

    if (activeRoot === 'Legal' && activeLegalCase) {
      crumbs.push({
        label: activeLegalCase.identifier,
        onClick: () => setActiveSubFolder(null),
        isCurrent: !activeSubFolder
      });
      if (activeSubFolder) {
        crumbs.push({
          label: activeSubFolder,
          onClick: () => {},
          isCurrent: true
        });
      }
    } else if (activeRoot === 'Tax' && activeTaxAuthority) {
      crumbs.push({
        label: activeTaxAuthority,
        onClick: () => setActiveTaxYear(null),
        isCurrent: !activeTaxYear
      });
      if (activeTaxYear) {
        crumbs.push({
          label: `Year ${activeTaxYear}`,
          onClick: () => {},
          isCurrent: true
        });
      }
    } else if (activeRoot === 'Assets' && activeAssetGroup) {
      crumbs.push({
        label: activeAssetGroup,
        onClick: () => {},
        isCurrent: true
      });
    } else if (activeRoot === 'Company Documents' && activeSubFolder) {
      crumbs.push({
        label: activeSubFolder,
        onClick: () => {},
        isCurrent: true
      });
    }

    return crumbs;
  }, [
    activeRoot,
    activeLegalCase,
    activeSubFolder,
    activeTaxAuthority,
    activeTaxYear,
    activeAssetGroup,
    alarmWatchFilter
  ]);

  // Verification metadata items for UniversalDocumentPreviewModal
  const previewVerificationItems: DataMappingCheckItem[] = useMemo(() => {
    if (!previewDoc) return [];
    const h = resolveDocumentHierarchy(previewDoc);
    const a = evaluateDocumentAlarms(previewDoc);
    const items: DataMappingCheckItem[] = [
      { label: 'Root Category', value: h.rootCategory, status: 'verified' },
      { label: 'Sub-Folder / Authority', value: h.subFolder || h.taxAuthority || h.assetGroup || 'Archive', status: 'info' },
      { label: 'Sender / Issuer', value: h.senderIssuer, status: 'verified' },
      { label: 'Recipient Entity', value: h.recipientEntity, status: 'verified' },
      { label: 'Issuance Date', value: h.issuanceDate || 'N/A', status: 'info' },
      {
        label: 'Validity End Date',
        value: previewDoc.unlimitedValidity ? 'Perpetual' : h.validityEndDate || 'Not Set',
        status: a.isExpired ? 'warning' : 'verified'
      },
      { label: 'Status Tag', value: a.effectiveStatus, status: a.isExpired ? 'warning' : 'verified' }
    ];
    if (previewDoc.hearingDate) {
      items.push({
        label: 'Hearing / Action Date',
        value: `${previewDoc.hearingDate} ${previewDoc.hearingTime || ''}`.trim(),
        status: 'warning'
      });
    }
    return items;
  }, [previewDoc]);

  // Reusable Document Table Renderer
  const renderDocumentRegistryTable = (emptyLabel: string) => {
    if (isLoading) {
      return (
        <div className="py-16 text-center space-y-2 bg-slate-900/60 border border-white/10 rounded-2xl">
          <Loader2 size={28} className="animate-spin text-sky-400 mx-auto" />
          <p className="text-xs text-gray-400">Synchronizing corporate filings from cloud repository...</p>
        </div>
      );
    }

    if (visibleDocuments.length === 0) {
      return (
        <div className="py-14 px-6 text-center bg-slate-900/60 border border-white/10 rounded-2xl space-y-3">
          <FolderOpen size={34} className="mx-auto text-gray-500" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-white">{emptyLabel}</h4>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Drag and drop PDFs or scanned images with mandatory sender, recipient, validity, and alarm metadata.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleOpenUploadModal()}
            className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload size={14} />
            <span>Upload Filing Here</span>
          </button>
        </div>
      );
    }

    const isQuotationsView = activeRoot === 'Quotations' && alarmWatchFilter === 'NONE';
    const isAssetsView = activeRoot === 'Assets' && alarmWatchFilter === 'NONE';

    return (
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-950/70 text-[11px] text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-4 font-semibold">Filing Title &amp; Path</th>
                <th className="py-3 px-3 font-semibold">
                  {isQuotationsView ? 'Client & Service' : 'Sender / Issuer'}
                </th>
                <th className="py-3 px-3 font-semibold">Recipient</th>
                <th className="py-3 px-3 font-semibold">Issuance / FY</th>
                {isAssetsView && <th className="py-3 px-3 font-semibold text-right">Valuation (PKR)</th>}
                {isQuotationsView && <th className="py-3 px-3 font-semibold text-right">Tariff (PKR)</th>}
                <th className="py-3 px-3 font-semibold">Validity &amp; Hearing Alarm</th>
                <th className="py-3 px-3 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleDocuments.map(({ doc, hierarchy, alarms }) => {
                const pathSummary =
                  hierarchy.rootCategory === 'Legal'
                    ? `${hierarchy.legalCaseTitle || 'Legal'} › ${hierarchy.subFolder || ''}`
                    : hierarchy.rootCategory === 'Tax'
                      ? `${hierarchy.taxAuthority} › Year ${hierarchy.taxYear}`
                      : hierarchy.rootCategory === 'Assets'
                        ? `${hierarchy.assetGroup}${doc.assetSubType ? ` › ${doc.assetSubType}` : ''}`
                        : hierarchy.rootCategory === 'Company Documents'
                          ? hierarchy.subFolder
                          : 'Outbound Quotation';

                return (
                  <tr key={doc.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="py-3 px-4 max-w-[280px]">
                      <div className="font-bold text-white truncate" title={doc.title}>
                        {doc.title}
                      </div>
                      <div className="flex items-center flex-wrap gap-1.5 mt-0.5 text-[11px] text-gray-400">
                        <span className="truncate max-w-[220px]">{pathSummary}</span>
                        {doc.referenceNo && (
                          <span className="font-mono text-sky-400 tabular-nums">
                            · #{doc.referenceNo}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3 max-w-[200px]">
                      {isQuotationsView ? (
                        <div>
                          <div className="font-semibold text-white truncate">
                            {doc.quotationClientName || hierarchy.senderIssuer}
                          </div>
                          <div className="text-[11px] text-gray-400 truncate">
                            {doc.quotationServiceType || 'Commercial Proposal'}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="font-medium text-gray-200 truncate">
                            {hierarchy.senderIssuer}
                          </div>
                          {doc.assetLocationOrBank && (
                            <div className="text-[11px] text-gray-400 truncate">
                              {doc.assetLocationOrBank}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-semibold text-[11px] text-gray-200">
                        {hierarchy.recipientEntity}
                      </span>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap font-mono tabular-nums text-gray-300">
                      <div>{hierarchy.issuanceDate || '-'}</div>
                      {hierarchy.taxYear && (
                        <div className="text-[10px] text-gray-400">FY {hierarchy.taxYear}</div>
                      )}
                    </td>

                    {isAssetsView && (
                      <td className="py-3 px-3 text-right whitespace-nowrap font-mono font-semibold tabular-nums text-emerald-300">
                        {typeof doc.assetValuationPkr === 'number'
                          ? doc.assetValuationPkr.toLocaleString()
                          : '-'}
                      </td>
                    )}

                    {isQuotationsView && (
                      <td className="py-3 px-3 text-right whitespace-nowrap font-mono font-semibold tabular-nums text-sky-300">
                        {typeof doc.quotationAmountPkr === 'number'
                          ? doc.quotationAmountPkr.toLocaleString()
                          : '-'}
                      </td>
                    )}

                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="space-y-1">
                        {doc.unlimitedValidity ? (
                          <span className="text-[11px] text-gray-400">Perpetual Validity</span>
                        ) : hierarchy.validityEndDate ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-gray-300 tabular-nums">
                              Exp: {hierarchy.validityEndDate}
                            </span>
                            {alarms.remainingValidityDays !== null && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tabular-nums border ${
                                  alarms.isExpired
                                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                    : alarms.isWithinExpiryAlarm
                                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                                }`}
                              >
                                {alarms.remainingValidityDays <= 0
                                  ? `${Math.abs(alarms.remainingValidityDays)}d exp`
                                  : `${alarms.remainingValidityDays}d left`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-500">No Expiry Set</span>
                        )}

                        {doc.hearingDate && (
                          <div className="flex items-center gap-1 text-[11px] text-amber-300 font-mono tabular-nums">
                            <Gavel size={11} className="shrink-0" />
                            <span>{doc.hearingDate}</span>
                            {alarms.remainingHearingDays !== null && (
                              <span className="text-[10px] font-bold">
                                ({alarms.remainingHearingDays < 0
                                  ? `${Math.abs(alarms.remainingHearingDays)}d ago`
                                  : alarms.remainingHearingDays === 0
                                    ? 'Today'
                                    : `in ${alarms.remainingHearingDays}d`})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      {isQuotationsView ? (
                        <select
                          aria-label="Update Quotation Status"
                          value={hierarchy.quotationStatus}
                          onChange={(e) =>
                            handleUpdateQuotationStatus(doc, e.target.value as QuotationStatus)
                          }
                          className={`px-2 py-1 rounded-md text-[11px] font-bold border outline-none cursor-pointer bg-slate-900 ${getQuotationBadgeClasses(
                            hierarchy.quotationStatus
                          )}`}
                        >
                          {QUOTATION_STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${getStatusBadgeClasses(
                            alarms.effectiveStatus
                          )}`}
                        >
                          {alarms.effectiveStatus}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {confirmDeleteDocId === doc.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteCompanyDocumentFromFirestore(doc.id);
                              setConfirmDeleteDocId(null);
                            }}
                            className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteDocId(null)}
                            className="px-2 py-1 rounded bg-white/10 text-gray-300 text-[10px] font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenPreview(doc)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition cursor-pointer"
                            title="Inspect Document & Metadata"
                          >
                            <Eye size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadDocument(doc)}
                            className="p-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-400/30 transition cursor-pointer"
                            title="Download Filing / PDF"
                          >
                            <Download size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDocument(doc);
                              setIsUploadModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition cursor-pointer"
                            title="Edit Metadata & Alarm Window"
                          >
                            <Edit size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteDocId(doc.id)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 border border-white/10 transition cursor-pointer"
                            title="Delete Record"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Top Corporate Filing Header */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center shrink-0">
            <FolderArchive size={22} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-2">
              <h1 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
                Corporate Filing &amp; Document Repository
              </h1>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold tabular-nums bg-white/5 border border-white/10 text-sky-300">
                {alarmMetrics.total} Filings
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              MAK Group Multi-Tier Legal, Tax, Assets, Statutory Compliance &amp; Commercial Quotations Architecture
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <ThemeToggleSwitch compact />

          <button
            type="button"
            onClick={() => setShowSchemaModal(true)}
            className="mak-btn-secondary px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            title="Inspect PostgreSQL DDL & Firebase Firestore Schema"
          >
            <Database size={14} className="text-sky-400" />
            <span>DB Schema</span>
          </button>

          {activeRoot === 'Legal' && (
            <button
              type="button"
              onClick={openCreateNewCaseModal}
              className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FolderPlus size={14} className="text-amber-400" />
              <span>Create New Case</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleOpenUploadModal()}
            className="mak-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload size={14} />
            <span>Upload Document</span>
          </button>
        </div>
      </div>

      {/* Interactive Breadcrumb Trail + Global Search + Entity/Status Filter Bar */}
      <div className="bg-slate-900 border border-white/10 rounded-xl px-4 py-3 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Filing Breadcrumb" className="flex items-center flex-wrap gap-1.5 text-xs min-w-0">
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={`${crumb.label}_${idx}`}>
              {idx > 0 && <ChevronRight size={13} className="text-gray-500 shrink-0" />}
              <button
                type="button"
                onClick={crumb.onClick}
                className={`px-2 py-1 rounded-md transition-colors cursor-pointer truncate max-w-[260px] ${
                  crumb.isCurrent
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-400/30 font-bold'
                    : 'text-gray-300 hover:text-white hover:bg-white/5 font-medium'
                }`}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {/* Search & Entity Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search case, title, issuer, ref #..."
              className="glass-input w-full rounded-lg pl-8 pr-7 py-1.5 text-xs outline-none"
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

          <select
            aria-label="Filter by Recipient Entity"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="glass-input rounded-lg px-2.5 py-1.5 text-xs bg-slate-900 text-gray-200 border border-white/15 outline-none"
          >
            <option value="ALL">All Entities (MAK Group)</option>
            {RECIPIENT_ENTITIES.map((ent) => (
              <option key={ent.id} value={ent.id}>
                {ent.id}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by Status Tag"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="glass-input rounded-lg px-2.5 py-1.5 text-xs bg-slate-900 text-gray-200 border border-white/15 outline-none"
          >
            <option value="ALL">All Statuses</option>
            {DOCUMENT_STATUS_TAGS.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 4-Column Smart Notification & Compliance Alarm Watchbar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={navigateToRoot}
          data-custom-control="true"
          className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
            !activeRoot && alarmWatchFilter === 'NONE'
              ? 'bg-sky-500/15 border-sky-400/50'
              : 'bg-slate-900 border-white/10 hover:bg-slate-800/70'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] text-gray-400 font-semibold">
            <span>Primary Filing Categories</span>
            <FolderArchive size={14} className="text-sky-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono tabular-nums text-white">5</span>
            <span className="text-[11px] text-gray-400 font-mono tabular-nums">
              {alarmMetrics.total} Total Records
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            setAlarmWatchFilter((prev) => (prev === 'HEARINGS' ? 'NONE' : 'HEARINGS'))
          }
          data-custom-control="true"
          className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
            alarmWatchFilter === 'HEARINGS'
              ? 'bg-amber-500/15 border-amber-400/50'
              : 'bg-slate-900 border-white/10 hover:bg-slate-800/70'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] text-gray-400 font-semibold">
            <span>Hearing / Action Countdown</span>
            <Gavel size={14} className="text-amber-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono tabular-nums text-amber-300">
              {alarmMetrics.hearingsCount}
            </span>
            <span className="text-[11px] text-gray-400">Court &amp; ONO Dates</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            setAlarmWatchFilter((prev) => (prev === 'EXPIRING_SOON' ? 'NONE' : 'EXPIRING_SOON'))
          }
          data-custom-control="true"
          className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
            alarmWatchFilter === 'EXPIRING_SOON'
              ? 'bg-amber-500/15 border-amber-400/50'
              : 'bg-slate-900 border-white/10 hover:bg-slate-800/70'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] text-gray-400 font-semibold">
            <span>Expiring Within Alarm Window</span>
            <Bell size={14} className="text-amber-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono tabular-nums text-amber-300">
              {alarmMetrics.expiringSoonCount}
            </span>
            <span className="text-[11px] text-gray-400">Renewal Alert Active</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            setAlarmWatchFilter((prev) => (prev === 'EXPIRED' ? 'NONE' : 'EXPIRED'))
          }
          data-custom-control="true"
          className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
            alarmWatchFilter === 'EXPIRED'
              ? 'bg-rose-500/15 border-rose-400/50'
              : 'bg-slate-900 border-white/10 hover:bg-slate-800/70'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] text-gray-400 font-semibold">
            <span>Expired Documents</span>
            <AlertTriangle size={14} className="text-rose-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono tabular-nums text-rose-400">
              {alarmMetrics.expiredCount}
            </span>
            <span className="text-[11px] text-gray-400">Action Required</span>
          </div>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* VIEW 0: GLOBAL SEARCH OR ALARM WATCHLIST OVERRIDE                     */}
      {/* ===================================================================== */}
      {alarmWatchFilter !== 'NONE' || (globalSearch.trim() && !activeRoot) ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">
              {alarmWatchFilter !== 'NONE'
                ? `Compliance Alarm Watchlist (${visibleDocuments.length} Records)`
                : `Search Results Across All Repositories (${visibleDocuments.length})`}
            </h2>
            <button
              type="button"
              onClick={() => {
                setAlarmWatchFilter('NONE');
                setGlobalSearch('');
              }}
              className="text-xs font-semibold text-sky-400 hover:underline cursor-pointer"
            >
              Return to Folder Hierarchy
            </button>
          </div>
          {renderDocumentRegistryTable('No matching compliance records found.')}
        </div>
      ) : !activeRoot ? (
        /* =================================================================== */
        /* VIEW 1: ROOT DASHBOARD — 5 PRIMARY CATEGORY CARDS                   */
        /* =================================================================== */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Primary Corporate Repositories (5 Root Modules)
            </span>
            <span className="text-xs text-gray-400">
              Select a category card to drill into dynamic sub-folders
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            {CORPORATE_ROOT_CATEGORIES.map((cat) => {
              const Icon = getRootCategoryIcon(cat.id);
              const catItems = enrichedDocuments.filter(
                (i) =>
                  i.hierarchy.rootCategory === cat.id &&
                  (entityFilter === 'ALL' || i.hierarchy.recipientEntity === entityFilter)
              );
              const alertCount = catItems.filter(
                (i) =>
                  i.alarms.isExpired ||
                  i.alarms.isWithinExpiryAlarm ||
                  i.alarms.isHearingDueOrSoon
              ).length;

              const subSummary =
                cat.id === 'Legal'
                  ? `${effectiveLegalCases.length} Case Dossiers`
                  : cat.id === 'Tax'
                    ? 'FBR · SRB · Labour Dept'
                    : cat.id === 'Assets'
                      ? 'Deposits & Properties'
                      : cat.id === 'Company Documents'
                        ? '10 Master Folders + Vault'
                        : 'Pending · Accepted · Rejected';

              return (
                <div
                  key={cat.id}
                  onClick={() => openRootCategory(cat.id)}
                  className="bg-slate-900 hover:bg-slate-800/80 border border-white/10 hover:border-sky-400/40 rounded-2xl p-5 flex flex-col justify-between gap-4 cursor-pointer transition-colors group"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center">
                        <Icon size={21} />
                      </div>
                      <span className="font-mono text-xs font-bold text-gray-400 tabular-nums">
                        {cat.numberLabel}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-extrabold text-white group-hover:text-sky-300 transition-colors">
                        {cat.title}
                      </h3>
                      <p className="text-[11px] font-semibold text-sky-400 mt-0.5">
                        {cat.subtitle}
                      </p>
                      <p className="text-xs text-gray-400 mt-2 leading-relaxed line-clamp-3">
                        {cat.description}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/10 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-400 truncate">{subSummary}</span>
                      <span className="font-mono font-bold text-white tabular-nums">
                        {catItems.length} Files
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      {alertCount > 0 ? (
                        <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono font-bold text-amber-300 tabular-nums">
                          {alertCount} Active Alert(s)
                        </span>
                      ) : (
                        <span className="text-[11px] text-emerald-400 font-medium">
                          Compliant
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-400">
                        <span>Open</span>
                        <ChevronRight size={13} />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeRoot === 'Legal' ? (
        /* =================================================================== */
        /* VIEW 2: LEGAL — DYNAMIC CASE FOLDERS & AUTO-PROVISIONED SUB-FOLDERS */
        /* =================================================================== */
        !activeLegalCase ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">
                  Legal Case Dossiers ({effectiveLegalCases.length})
                </h2>
                <p className="text-xs text-gray-400">
                  Create dynamic case folders by Container #, Shipment ID, or Corporate Dispute Title with auto-provisioned and customizable sub-folders.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateNewCaseModal}
                className="mak-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus size={14} />
                <span>Create New Case</span>
              </button>
            </div>

            {effectiveLegalCases.length === 0 ? (
              <div className="py-14 px-6 text-center bg-slate-900 border border-white/10 rounded-2xl space-y-3">
                <Scale size={34} className="mx-auto text-sky-400" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white">No Legal Case Folders Created Yet</h3>
                  <p className="text-xs text-gray-400 max-w-lg mx-auto">
                    Click &ldquo;Create New Case&rdquo; to enter a Unique Case Identifier (e.g., Container # ABC-12345 or Suit # 412/2025), select the internal entity, and dynamically provision Logistics/Criminal or Civil/Corporate sub-folders.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateNewCaseModal}
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderPlus size={14} />
                  <span>Create New Case</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {effectiveLegalCases.map((lc) => {
                  const caseDocs = enrichedDocuments.filter(
                    (i) => i.hierarchy.rootCategory === 'Legal' && i.hierarchy.legalCaseId === lc.id
                  );
                  const subList =
                    lc.subFolders && lc.subFolders.length > 0
                      ? lc.subFolders
                      : getProvisionedLegalSubFolders(lc.caseTrack);
                  const isLegacy = lc.id === 'legacy_general_legal_archive';

                  return (
                    <div
                      key={lc.id}
                      onClick={() => {
                        setActiveLegalCaseId(lc.id);
                        setActiveSubFolder(null);
                      }}
                      className="bg-slate-900 hover:bg-slate-800/80 border border-white/10 hover:border-sky-400/40 rounded-2xl p-4 flex flex-col justify-between gap-3.5 cursor-pointer transition-colors"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-sky-500/15 text-sky-300 border border-sky-400/30">
                            {lc.caseTrack === 'CIVIL_CORPORATE'
                              ? 'Civil / Corporate Case'
                              : 'Logistics / Customs / Criminal'}
                          </span>

                          {!isLegacy && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1"
                            >
                              {confirmDeleteCaseId === lc.id ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await deleteCorporateLegalCaseFromFirestore(lc.id);
                                      setConfirmDeleteCaseId(null);
                                    }}
                                    className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold cursor-pointer"
                                  >
                                    Delete
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteCaseId(null)}
                                    className="px-2 py-0.5 rounded bg-white/10 text-gray-300 text-[10px] cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditCaseModal(lc)}
                                    className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
                                    title="Edit Case Details & Sub-Folders"
                                  >
                                    <Edit size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteCaseId(lc.id)}
                                    className="p-1 rounded hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 cursor-pointer"
                                    title="Remove Case Folder"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        <h3 className="text-sm sm:text-base font-bold text-white leading-snug">
                          {lc.identifier}
                        </h3>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-200 font-semibold">
                            {lc.recipientEntity}
                          </span>
                          {lc.courtOrForum && <span>· {lc.courtOrForum}</span>}
                          {lc.caseReferenceNo && (
                            <span className="font-mono text-sky-400">· {lc.caseReferenceNo}</span>
                          )}
                        </div>
                      </div>

                      <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 font-mono tabular-nums text-gray-300">
                          <span>{subList.length} Sub-Folders</span>
                          <span>·</span>
                          <span className="font-bold text-white">{caseDocs.length} Filings</span>
                        </div>
                        {lc.nextHearingDate ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-amber-300 tabular-nums">
                            <Gavel size={12} />
                            <span>{lc.nextHearingDate}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sky-400 font-semibold">
                            <span>Open Case</span>
                            <ChevronRight size={13} />
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : !activeSubFolder ? (
          /* Inside a Specific Legal Case: Provisioned & Customizable Sub-Folders Grid */
          <div className="space-y-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center flex-wrap gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-sky-500/15 text-sky-300 border border-sky-400/30">
                    {activeLegalCase.caseTrack === 'CIVIL_CORPORATE'
                      ? 'Civil / Corporate Track'
                      : 'Logistics / Customs / Criminal Track'}
                  </span>
                  <h2 className="text-base font-extrabold text-white">
                    {activeLegalCase.identifier}
                  </h2>
                </div>
                <p className="text-xs text-gray-400">
                  Entity: <strong className="text-gray-200">{activeLegalCase.recipientEntity}</strong>
                  {activeLegalCase.courtOrForum ? ` · Forum: ${activeLegalCase.courtOrForum}` : ''}
                  {activeLegalCase.nextHearingDate ? ` · Next Hearing: ${activeLegalCase.nextHearingDate}` : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {activeLegalCase.id !== 'legacy_general_legal_archive' && (
                  <button
                    type="button"
                    onClick={() => openEditCaseModal(activeLegalCase)}
                    className="mak-btn-secondary px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Edit size={13} className="text-sky-400" />
                    <span>Edit Case</span>
                  </button>
                )}

                {addingCustomSubFolder ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={customSubFolderName}
                      onChange={(e) => setCustomSubFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomSubFolderToCase();
                        }
                      }}
                      placeholder="e.g. Bail Proceedings..."
                      className="glass-input rounded-lg px-2.5 py-1.5 text-xs outline-none w-44"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomSubFolderToCase}
                      className="mak-btn px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingCustomSubFolder(false)}
                      className="mak-btn-secondary px-2.5 py-1.5 rounded-lg text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingCustomSubFolder(true)}
                    className="mak-btn-secondary px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <FolderPlus size={14} className="text-sky-400" />
                    <span>Add Sub-Folder</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    handleOpenUploadModal({
                      rootCategory: 'Legal',
                      legalCaseId: activeLegalCase.id,
                      subFolder: activeLegalCase.subFolders?.[0]
                    })
                  }
                  className="mak-btn px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Upload size={14} />
                  <span>Upload to Case</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {(activeLegalCase.subFolders && activeLegalCase.subFolders.length > 0
                ? activeLegalCase.subFolders
                : getProvisionedLegalSubFolders(activeLegalCase.caseTrack)
              ).map((sf, idx, allFolders) => {
                const sfDocs = enrichedDocuments.filter(
                  (i) =>
                    i.hierarchy.rootCategory === 'Legal' &&
                    i.hierarchy.legalCaseId === activeLegalCase.id &&
                    i.hierarchy.subFolder === sf
                );
                const isRenaming = renamingSubFolderOriginal === sf;
                const isEditableCase = activeLegalCase.id !== 'legacy_general_legal_archive';

                return (
                  <div
                    key={`${sf}_${idx}`}
                    onClick={() => {
                      if (!isRenaming) setActiveSubFolder(sf);
                    }}
                    className="bg-slate-900 hover:bg-slate-800/80 border border-white/10 hover:border-sky-400/40 rounded-xl p-4 flex flex-col justify-between gap-3 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center shrink-0">
                        <FolderOpen size={17} />
                      </div>
                      <div
                        className="inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="font-mono text-[11px] text-gray-500 tabular-nums mr-1">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        {isEditableCase && !isRenaming && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingSubFolderOriginal(sf);
                                setRenamingSubFolderValue(sf);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
                              title="Rename Sub-Folder"
                            >
                              <Edit size={12} />
                            </button>
                            {sfDocs.length === 0 && allFolders.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveEmptyCaseSubFolder(sf)}
                                className="p-1 rounded hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 cursor-pointer"
                                title="Remove Empty Sub-Folder"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {isRenaming ? (
                      <div
                        className="space-y-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={renamingSubFolderValue}
                          onChange={(e) => setRenamingSubFolderValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleRenameCaseSubFolder(sf);
                            } else if (e.key === 'Escape') {
                              setRenamingSubFolderOriginal(null);
                              setRenamingSubFolderValue('');
                            }
                          }}
                          className="glass-input w-full rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none"
                          autoFocus
                        />
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleRenameCaseSubFolder(sf)}
                            className="mak-btn px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingSubFolderOriginal(null);
                              setRenamingSubFolderValue('');
                            }}
                            className="mak-btn-secondary px-2.5 py-1 rounded text-[11px] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <h4 className="text-sm font-bold text-white leading-snug">{sf}</h4>
                        <p className="text-[11px] text-gray-400 mt-1 font-mono tabular-nums">
                          {sfDocs.length} {sfDocs.length === 1 ? 'Document' : 'Documents'}
                        </p>
                      </div>
                    )}

                    <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenUploadModal({
                            rootCategory: 'Legal',
                            legalCaseId: activeLegalCase.id,
                            subFolder: sf
                          });
                        }}
                        className="text-sky-400 hover:underline font-semibold cursor-pointer"
                      >
                        + Upload Here
                      </button>
                      <ChevronRight size={14} className="text-gray-400" />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                All Case Proceedings &amp; Filings ({visibleDocuments.length})
              </h3>
              {renderDocumentRegistryTable('No proceedings uploaded in this legal case yet.')}
            </div>
          </div>
        ) : (
          /* Specific Legal Case Sub-Folder View */
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-white">{activeSubFolder}</h2>
                <p className="text-xs text-gray-400">
                  Case Dossier: <span className="text-gray-200 font-semibold">{activeLegalCase.identifier}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleOpenUploadModal({
                    rootCategory: 'Legal',
                    legalCaseId: activeLegalCase.id,
                    subFolder: activeSubFolder
                  })
                }
                className="mak-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Upload size={14} />
                <span>Upload to {activeSubFolder}</span>
              </button>
            </div>
            {renderDocumentRegistryTable(`No filings recorded in "${activeSubFolder}" yet.`)}
          </div>
        )
      ) : activeRoot === 'Tax' ? (
        /* =================================================================== */
        /* VIEW 3: TAX — AUTHORITY (FBR / SRB / LABOUR) & FISCAL YEAR ARCHIVE  */
        /* =================================================================== */
        !activeTaxAuthority ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-white">
                Tax &amp; Statutory Authorities (FBR · SRB · Labour Department)
              </h2>
              <p className="text-xs text-gray-400">
                Select a regulatory authority to browse returns, audit notices, and challans dynamically grouped by Fiscal Year.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {TAX_AUTHORITIES.map((auth) => {
                const authDocs = enrichedDocuments.filter(
                  (i) =>
                    i.hierarchy.rootCategory === 'Tax' &&
                    i.hierarchy.taxAuthority === auth.id &&
                    (entityFilter === 'ALL' || i.hierarchy.recipientEntity === entityFilter)
                );
                const distinctYears = Array.from(
                  new Set([...DEFAULT_FISCAL_YEARS, ...authDocs.map((d) => d.hierarchy.taxYear).filter(Boolean)])
                )
                  .sort((a, b) => String(b).localeCompare(String(a)))
                  .slice(0, 4);

                return (
                  <div
                    key={auth.id}
                    onClick={() => {
                      setActiveTaxAuthority(auth.id);
                      setActiveTaxYear(null);
                    }}
                    className="bg-slate-900 hover:bg-slate-800/80 border border-white/10 hover:border-sky-400/40 rounded-2xl p-5 flex flex-col justify-between gap-4 cursor-pointer transition-colors"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center">
                          <Landmark size={20} />
                        </div>
                        <span className="px-2.5 py-0.5 rounded-md bg-white/5 border border-white/10 font-mono text-xs font-bold text-white tabular-nums">
                          {authDocs.length} Filings
                        </span>
                      </div>

                      <div>
                        <h3 className="text-base font-extrabold text-white">{auth.title}</h3>
                        <p className="text-xs font-semibold text-sky-400">{auth.fullName}</p>
                        <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                          {auth.description}
                        </p>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {distinctYears.map((yr) => (
                          <span
                            key={yr}
                            className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-gray-300 tabular-nums"
                          >
                            FY {yr}
                          </span>
                        ))}
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-400 shrink-0">
                        <span>Years</span>
                        <ChevronRight size={13} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : !activeTaxYear ? (
          /* Fiscal Year Folders inside Selected Tax Authority */
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">
                  {activeTaxAuthority} — Fiscal Year Archives
                </h2>
                <p className="text-xs text-gray-400">
                  Filed tax returns, withholding statements, and compliance reports grouped by Tax / Fiscal Year.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddYearModal(true)}
                  className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FolderPlus size={14} className="text-sky-400" />
                  <span>Add Fiscal Year</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenUploadModal({
                      rootCategory: 'Tax',
                      taxAuthority: activeTaxAuthority,
                      taxYear: authorityFiscalYears[0]
                    })
                  }
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Upload size={14} />
                  <span>Upload {activeTaxAuthority} Filing</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
              {authorityFiscalYears.map((yr) => {
                const yrDocs = enrichedDocuments.filter(
                  (i) =>
                    i.hierarchy.rootCategory === 'Tax' &&
                    i.hierarchy.taxAuthority === activeTaxAuthority &&
                    i.hierarchy.taxYear === yr &&
                    (entityFilter === 'ALL' || i.hierarchy.recipientEntity === entityFilter)
                );
                return (
                  <div
                    key={yr}
                    onClick={() => setActiveTaxYear(yr)}
                    className="bg-slate-900 hover:bg-slate-800/80 border border-white/10 hover:border-sky-400/40 rounded-2xl p-4 flex flex-col justify-between gap-3 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center">
                        <Calendar size={17} />
                      </div>
                      <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-[11px] font-bold text-white tabular-nums">
                        {yrDocs.length}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-extrabold font-mono text-white tabular-nums">
                        Year {yr}
                      </h3>
                      <p className="text-[11px] text-gray-400">
                        {activeTaxAuthority} Fiscal Archive
                      </p>
                    </div>

                    <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-sky-400 font-semibold">
                      <span>Open Year</span>
                      <ChevronRight size={13} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Specific Authority + Specific Fiscal Year Table */
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-white">
                  {activeTaxAuthority} — Year {activeTaxYear} Filings ({visibleDocuments.length})
                </h2>
                <p className="text-xs text-gray-400">
                  Returns, CPR payment receipts, audit proceedings, and statutory certificates for FY {activeTaxYear}.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleOpenUploadModal({
                    rootCategory: 'Tax',
                    taxAuthority: activeTaxAuthority,
                    taxYear: activeTaxYear
                  })
                }
                className="mak-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Upload size={14} />
                <span>Upload Year {activeTaxYear} Filing</span>
              </button>
            </div>
            {renderDocumentRegistryTable(
              `No ${activeTaxAuthority} reports uploaded for Year ${activeTaxYear} yet.`
            )}
          </div>
        )
      ) : activeRoot === 'Assets' ? (
        /* =================================================================== */
        /* VIEW 4: ASSETS — SECURITY DEPOSITS & COMPANY PROPERTIES             */
        /* =================================================================== */
        !activeAssetGroup ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-white">
                Corporate Assets, Guarantees &amp; Property Investments
              </h2>
              <p className="text-xs text-gray-400">
                Track bank guarantees, port/utility security deposits, and real estate &amp; fleet capital investments.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {ASSETS_SUBFOLDERS.map((ag) => {
                const agDocs = enrichedDocuments.filter(
                  (i) =>
                    i.hierarchy.rootCategory === 'Assets' &&
                    i.hierarchy.assetGroup === ag.id &&
                    (entityFilter === 'ALL' || i.hierarchy.recipientEntity === entityFilter)
                );
                const totalValuation = agDocs.reduce(
                  (acc, item) => acc + (Number(item.doc.assetValuationPkr) || 0),
                  0
                );

                return (
                  <div
                    key={ag.id}
                    onClick={() => setActiveAssetGroup(ag.id)}
                    className="bg-slate-900 hover:bg-slate-800/80 border border-white/10 hover:border-sky-400/40 rounded-2xl p-5 flex flex-col justify-between gap-4 cursor-pointer transition-colors"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center">
                          <HardDrive size={20} />
                        </div>
                        <div className="text-right">
                          <span className="block font-mono text-xs font-bold text-white tabular-nums">
                            {agDocs.length} Records
                          </span>
                          {totalValuation > 0 && (
                            <span className="block font-mono text-[11px] text-emerald-400 font-semibold tabular-nums">
                              PKR {totalValuation.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <h3 className="text-base font-extrabold text-white">{ag.title}</h3>
                        <p className="text-xs font-semibold text-sky-400">{ag.subtitle}</p>
                        <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                          {ag.description}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {ag.quickExamples.map((ex) => (
                          <span
                            key={ex}
                            className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[11px] text-gray-300"
                          >
                            {ex}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenUploadModal({
                            rootCategory: 'Assets',
                            assetGroup: ag.id
                          });
                        }}
                        className="text-sky-400 hover:underline font-semibold cursor-pointer"
                      >
                        + Add Asset / Deposit Record
                      </button>
                      <span className="inline-flex items-center gap-1 font-bold text-sky-400">
                        <span>Open Catalog</span>
                        <ChevronRight size={14} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Specific Asset Catalog View */
          <div className="space-y-4">
            {(() => {
              const cfg = ASSETS_SUBFOLDERS.find((a) => a.id === activeAssetGroup) || ASSETS_SUBFOLDERS[0];
              const totalPkr = visibleDocuments.reduce(
                (sum, i) => sum + (Number(i.doc.assetValuationPkr) || 0),
                0
              );
              return (
                <>
                  <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-white">{cfg.title}</h2>
                      <p className="text-xs text-gray-400">{cfg.subtitle}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      {totalPkr > 0 && (
                        <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs">
                          <span className="text-gray-400 mr-1.5">Recorded Value:</span>
                          <span className="font-mono font-bold text-emerald-300 tabular-nums">
                            PKR {totalPkr.toLocaleString()}
                          </span>
                        </div>
                      )}

                      <select
                        aria-label="Filter Asset Sub-Type"
                        value={assetSubTypeFilter}
                        onChange={(e) => setAssetSubTypeFilter(e.target.value)}
                        className="glass-input rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                      >
                        <option value="ALL">All Classifications</option>
                        {cfg.subTypes.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() =>
                          handleOpenUploadModal({
                            rootCategory: 'Assets',
                            assetGroup: cfg.id
                          })
                        }
                        className="mak-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Upload size={14} />
                        <span>Add Record</span>
                      </button>
                    </div>
                  </div>

                  {renderDocumentRegistryTable(`No records filed in "${cfg.title}" yet.`)}
                </>
              );
            })()}
          </div>
        )
      ) : activeRoot === 'Company Documents' ? (
        /* =================================================================== */
        /* VIEW 5: COMPANY DOCUMENTS — 10 COMPLIANCE FOLDERS & SECURE VAULT    */
        /* =================================================================== */
        !activeSubFolder ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-white">
                Master Corporate Compliance Repository (10 Statutory Folders)
              </h2>
              <p className="text-xs text-gray-400">
                Pre-configured statutory, licensing, identity, banking, PSX, SBP, and encrypted portal credential folders.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
              {MASTER_COMPANY_DOC_FOLDERS.map((folder) => {
                const FolderIcon = getMasterFolderIcon(folder.id);
                const folderDocs = enrichedDocuments.filter(
                  (i) =>
                    i.hierarchy.rootCategory === 'Company Documents' &&
                    i.hierarchy.subFolder === folder.id &&
                    (entityFilter === 'ALL' || i.hierarchy.recipientEntity === entityFilter)
                );
                const vaultCount = folder.isSecureVault
                  ? vaultCredentials.filter(
                      (v) => entityFilter === 'ALL' || v.recipientEntity === entityFilter
                    ).length
                  : 0;

                return (
                  <div
                    key={folder.id}
                    onClick={() => setActiveSubFolder(folder.id)}
                    className="bg-slate-900 hover:bg-slate-800/80 border border-white/10 hover:border-sky-400/40 rounded-2xl p-4 flex flex-col justify-between gap-3.5 cursor-pointer transition-colors"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div
                          className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
                            folder.isSecureVault
                              ? 'bg-amber-500/15 border-amber-400/30 text-amber-300'
                              : 'bg-sky-500/15 border-sky-400/30 text-sky-400'
                          }`}
                        >
                          <FolderIcon size={19} />
                        </div>
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-[11px] font-bold text-white tabular-nums">
                          {folder.isSecureVault
                            ? `${vaultCount} IDs · ${folderDocs.length} Docs`
                            : `${folderDocs.length} Docs`}
                        </span>
                      </div>

                      <div>
                        <h3 className="text-sm font-bold text-white leading-snug">
                          {folder.title}
                        </h3>
                        <p className="text-[11px] text-gray-400 mt-1 line-clamp-3 leading-relaxed">
                          {folder.description}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-white/10 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenUploadModal({
                            rootCategory: 'Company Documents',
                            subFolder: folder.id
                          });
                        }}
                        className="text-sky-400 hover:underline font-semibold cursor-pointer"
                      >
                        + Upload
                      </button>
                      <span className="inline-flex items-center gap-1 text-gray-300 font-semibold">
                        <span>Open</span>
                        <ChevronRight size={13} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Inside One of the 10 Master Compliance Folders */
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">{activeSubFolder}</h2>
                <p className="text-xs text-gray-400">
                  {MASTER_COMPANY_DOC_FOLDERS.find((f) => f.id === activeSubFolder)?.description}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {activeSubFolder === 'Office ID Passwords (Secure Vault)' && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingVaultItem(null);
                      setVaultPortalName('');
                      setVaultPortalUrl('');
                      setVaultUsername('');
                      setVaultPassword('');
                      setVaultPinNote('');
                      setVaultEntity(defaultEntity);
                      setVaultRecovery('');
                      setVaultExpiryDate('');
                      setShowVaultModal(true);
                    }}
                    className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <KeyRound size={14} className="text-amber-400" />
                    <span>Add Portal Credential</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    handleOpenUploadModal({
                      rootCategory: 'Company Documents',
                      subFolder: activeSubFolder
                    })
                  }
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Upload size={14} />
                  <span>Upload Document</span>
                </button>
              </div>
            </div>

            {/* Interactive Encrypted Credential Vault when inside Office ID Passwords (Secure Vault) */}
            {activeSubFolder === 'Office ID Passwords (Secure Vault)' && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-950/70 border-b border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock size={15} className="text-amber-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Protected Office ID &amp; Portal Credentials Vault
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-gray-400 tabular-nums">
                    {vaultCredentials.length} Saved Logins
                  </span>
                </div>

                {vaultCredentials.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <KeyRound size={26} className="mx-auto text-gray-500" />
                    <p className="text-xs text-gray-400">
                      Store FBR IRIS, WeBOC, PSW, SECP eServices, SRB, and corporate portal IDs with masked password protection.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-[11px] text-gray-400 uppercase">
                          <th className="py-2.5 px-4 font-semibold">Portal / System</th>
                          <th className="py-2.5 px-3 font-semibold">Entity</th>
                          <th className="py-2.5 px-3 font-semibold">Login ID / Username</th>
                          <th className="py-2.5 px-3 font-semibold">Password</th>
                          <th className="py-2.5 px-3 font-semibold">PIN / 2FA / Recovery</th>
                          <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {vaultCredentials
                          .filter(
                            (v) => entityFilter === 'ALL' || v.recipientEntity === entityFilter
                          )
                          .map((cred) => {
                            const isRevealed = revealedVaultIds.has(cred.id);
                            return (
                              <tr key={cred.id} className="hover:bg-white/[0.03]">
                                <td className="py-2.5 px-4">
                                  <div className="font-bold text-white">{cred.portalName}</div>
                                  {cred.portalUrl && (
                                    <div className="text-[11px] font-mono text-sky-400 truncate max-w-[200px]">
                                      {cred.portalUrl}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[11px] font-semibold text-gray-200">
                                    {cred.recipientEntity}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-gray-200 whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5">
                                    <span>{cred.usernameOrId}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(cred.usernameOrId, `u_${cred.id}`)}
                                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
                                      title="Copy Username"
                                    >
                                      {copiedVaultField === `u_${cred.id}` ? (
                                        <Check size={12} className="text-emerald-400" />
                                      ) : (
                                        <Copy size={12} />
                                      )}
                                    </button>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5">
                                    <span className="text-amber-300">
                                      {isRevealed ? cred.passwordSecret : '••••••••••••'}
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
                                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
                                      title={isRevealed ? 'Hide Password' : 'Reveal Password'}
                                    >
                                      {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(cred.passwordSecret, `p_${cred.id}`)}
                                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
                                      title="Copy Password"
                                    >
                                      {copiedVaultField === `p_${cred.id}` ? (
                                        <Check size={12} className="text-emerald-400" />
                                      ) : (
                                        <Copy size={12} />
                                      )}
                                    </button>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-gray-400 max-w-[200px] truncate">
                                  {[cred.pinOr2faNote, cred.recoveryContact].filter(Boolean).join(' · ') || '-'}
                                </td>
                                <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                  {confirmDeleteVaultId === cred.id ? (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          await deleteCorporateVaultCredentialFromFirestore(cred.id);
                                          setConfirmDeleteVaultId(null);
                                        }}
                                        className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold cursor-pointer"
                                      >
                                        Confirm
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteVaultId(null)}
                                        className="px-2 py-0.5 rounded bg-white/10 text-gray-300 text-[10px] cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingVaultItem(cred);
                                          setVaultPortalName(cred.portalName);
                                          setVaultPortalUrl(cred.portalUrl || '');
                                          setVaultUsername(cred.usernameOrId);
                                          setVaultPassword(cred.passwordSecret);
                                          setVaultPinNote(cred.pinOr2faNote || '');
                                          setVaultEntity(cred.recipientEntity);
                                          setVaultRecovery(cred.recoveryContact || '');
                                          setVaultExpiryDate(cred.expiryDate || '');
                                          setShowVaultModal(true);
                                        }}
                                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 cursor-pointer"
                                        title="Edit Credential"
                                      >
                                        <Edit size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteVaultId(cred.id)}
                                        className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 cursor-pointer"
                                        title="Delete Credential"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {renderDocumentRegistryTable(`No compliance documents uploaded in "${activeSubFolder}" yet.`)}
          </div>
        )
      ) : (
        /* =================================================================== */
        /* VIEW 6: QUOTATIONS — COMMERCIAL PROPOSALS ARCHIVE & MULTI-FILTER    */
        /* =================================================================== */
        <div className="space-y-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-white">
                  Outbound Commercial Quotations Archive ({visibleDocuments.length})
                </h2>
                <p className="text-xs text-gray-400">
                  Search and filter outbound rate proposals by Client Name, Issuance Date, Service Type, and Approval Status.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleOpenUploadModal({ rootCategory: 'Quotations' })}
                className="mak-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Upload size={14} />
                <span>Upload Quotation</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-2 border-t border-white/10">
              <input
                type="text"
                value={quoteClientSearch}
                onChange={(e) => setQuoteClientSearch(e.target.value)}
                placeholder="Filter by Client Name..."
                className="glass-input rounded-lg px-3 py-2 text-xs outline-none"
              />

              <select
                aria-label="Filter Quotation Service Type"
                value={quoteServiceFilter}
                onChange={(e) => setQuoteServiceFilter(e.target.value)}
                className="glass-input rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
              >
                <option value="ALL">All Service Types</option>
                {QUOTATION_SERVICE_TYPES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter Quotation Status"
                value={quoteStatusFilter}
                onChange={(e) => setQuoteStatusFilter(e.target.value)}
                className="glass-input rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
              >
                <option value="ALL">All Quotation Statuses</option>
                {QUOTATION_STATUSES.map((qs) => (
                  <option key={qs} value={qs}>
                    {qs}
                  </option>
                ))}
              </select>

              <input
                type="date"
                aria-label="Quotation Date From"
                value={quoteDateFrom}
                onChange={(e) => setQuoteDateFrom(e.target.value)}
                className="glass-input rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
              />

              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="Quotation Date To"
                  value={quoteDateTo}
                  onChange={(e) => setQuoteDateTo(e.target.value)}
                  className="glass-input flex-1 rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                />
                {(quoteClientSearch || quoteServiceFilter !== 'ALL' || quoteStatusFilter !== 'ALL' || quoteDateFrom || quoteDateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuoteClientSearch('');
                      setQuoteServiceFilter('ALL');
                      setQuoteStatusFilter('ALL');
                      setQuoteDateFrom('');
                      setQuoteDateTo('');
                    }}
                    className="mak-btn-secondary px-2.5 py-2 rounded-lg text-xs cursor-pointer"
                    title="Reset Quotation Filters"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {renderDocumentRegistryTable('No outbound commercial quotations match the current filters.')}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: UNIVERSAL DRAG-AND-DROP UPLOAD & MANDATORY METADATA MODAL    */}
      {/* ===================================================================== */}
      <CompanyDocumentUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          setEditingDocument(null);
        }}
        onSave={async (docRecord) => {
          await saveCompanyDocumentToFirestore(docRecord);
        }}
        onEnsureCustomSubFolder={async (targetCaseId, subFolderName) => {
          const targetCase = legalCases.find((c) => c.id === targetCaseId);
          if (!targetCase) return;
          const existing =
            targetCase.subFolders && targetCase.subFolders.length > 0
              ? targetCase.subFolders.map((sf) => normalizeLegalSubFolderName(sf))
              : getProvisionedLegalSubFolders(targetCase.caseTrack);
          if (!existing.some((sf) => sf.toLowerCase() === subFolderName.trim().toLowerCase())) {
            await saveCorporateLegalCaseToFirestore({
              ...targetCase,
              subFolders: [...existing, subFolderName.trim()],
              updatedAt: new Date().toISOString()
            });
          }
        }}
        legalCases={effectiveLegalCases.filter((c) => c.id !== 'legacy_general_legal_archive')}
        preset={uploadPreset}
        editingDocument={editingDocument}
        defaultRecipientEntity={defaultEntity}
        customFiscalYears={customFiscalYears}
      />

      {/* ===================================================================== */}
      {/* MODAL 2: UNIVERSAL DOCUMENT PREVIEW MODAL                             */}
      {/* ===================================================================== */}
      {previewDoc && (
        <UniversalDocumentPreviewModal
          isOpen={Boolean(previewDoc)}
          onClose={() => {
            setPreviewDoc(null);
            setPreviewResolvedFile(null);
          }}
          file={previewResolvedFile}
          filename={previewDoc.fileName || `${previewDoc.title}.pdf`}
          title={previewDoc.title}
          verificationItems={previewVerificationItems}
          onDownload={() => handleDownloadDocument(previewDoc)}
        />
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: CREATE / EDIT DYNAMIC LEGAL CASE DOSSIER                     */}
      {/* ===================================================================== */}
      {showNewLegalCaseModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-950 border border-white/15 rounded-2xl shadow-2xl overflow-hidden my-auto">
            <div className="px-5 py-3.5 bg-slate-900 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Scale size={18} className="text-sky-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">
                  {editingLegalCase ? 'Edit Legal Case & Sub-Folders' : 'Create New Case'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowNewLegalCaseModal(false);
                  setEditingLegalCase(null);
                }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateLegalCase} className="p-5 space-y-4 max-h-[84vh] overflow-y-auto">
              {newCaseError && (
                <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
                  {newCaseError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Unique Case Identifier / Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCaseIdentifier}
                    onChange={(e) => setNewCaseIdentifier(e.target.value)}
                    placeholder="e.g. Container # ABC-12345 or Suit # 412/2025"
                    className="glass-input w-full rounded-lg px-3 py-2.5 text-xs outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Internal Entity *
                  </label>
                  <select
                    value={newCaseEntity}
                    onChange={(e) => setNewCaseEntity(e.target.value)}
                    className="glass-input w-full rounded-lg px-3 py-2.5 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                  >
                    {RECIPIENT_ENTITIES.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Template Selection */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1.5">
                  Case Template Selection *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setNewCaseTrack('LOGISTICS_CRIMINAL');
                      if (!editingLegalCase) {
                        setModalDraftSubFolders(getProvisionedLegalSubFolders('LOGISTICS_CRIMINAL'));
                      }
                    }}
                    data-custom-control="true"
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                      newCaseTrack === 'LOGISTICS_CRIMINAL'
                        ? 'bg-sky-500/15 border-sky-400/50'
                        : 'bg-slate-900 border-white/10'
                    }`}
                  >
                    <div className="text-xs font-bold text-white">
                      Logistics / Customs / Criminal Case
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Provisions 7 sub-folders: Police FIR &amp; Proceedings, Customs FIR &amp; Enforcement, Transit Trade &amp; ONO, Appeals &amp; Tribunals, High Courts, Follow-ups, Consignment Docs
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setNewCaseTrack('CIVIL_CORPORATE');
                      if (!editingLegalCase) {
                        setModalDraftSubFolders(getProvisionedLegalSubFolders('CIVIL_CORPORATE'));
                      }
                    }}
                    data-custom-control="true"
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                      newCaseTrack === 'CIVIL_CORPORATE'
                        ? 'bg-sky-500/15 border-sky-400/50'
                        : 'bg-slate-900 border-white/10'
                    }`}
                  >
                    <div className="text-xs font-bold text-white">Civil / Corporate Case</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Provisions 5 sub-folders: Original Plaint / Notice, Written Statement / Defense, Evidence &amp; Exhibits, Lower Court Judgments, Appellate Proceedings
                    </div>
                  </button>
                </div>
              </div>

              {/* Editable & Customizable Sub-Folders List */}
              <div className="p-3.5 rounded-xl bg-slate-900/80 border border-white/10 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                    Provisioned Case Sub-Folders ({modalDraftSubFolders.length}) — Rename or Add Custom
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setModalDraftSubFolders(getProvisionedLegalSubFolders(newCaseTrack))
                    }
                    className="text-[10px] font-semibold text-gray-400 hover:text-sky-400 cursor-pointer"
                  >
                    Reset to Standard Template
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {modalDraftSubFolders.map((folderVal, fIdx) => (
                    <div key={`draft_sf_${fIdx}`} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={folderVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          setModalDraftSubFolders((prev) =>
                            prev.map((item, idx) => (idx === fIdx ? val : item))
                          );
                        }}
                        className="glass-input flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                      />
                      {modalDraftSubFolders.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setModalDraftSubFolders((prev) => prev.filter((_, idx) => idx !== fIdx))
                          }
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 cursor-pointer"
                          title="Remove sub-folder"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={modalCustomFolderInput}
                    onChange={(e) => setModalCustomFolderInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const clean = modalCustomFolderInput.trim();
                        if (clean) {
                          setModalDraftSubFolders((prev) => [...prev, clean]);
                          setModalCustomFolderInput('');
                        }
                      }
                    }}
                    placeholder="Add custom sub-folder (e.g. Bail Proceedings / Lab Reports)..."
                    className="glass-input flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = modalCustomFolderInput.trim();
                      if (!clean) return;
                      setModalDraftSubFolders((prev) => [...prev, clean]);
                      setModalCustomFolderInput('');
                    }}
                    className="mak-btn-secondary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Plus size={12} />
                    <span>Add Folder</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    FIR / Suit / Reference #
                  </label>
                  <input
                    type="text"
                    value={newCaseRefNo}
                    onChange={(e) => setNewCaseRefNo(e.target.value)}
                    placeholder="e.g. Suit # 412/2025"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Court / Collectorate / Forum
                  </label>
                  <input
                    type="text"
                    value={newCaseCourt}
                    onChange={(e) => setNewCaseCourt(e.target.value)}
                    placeholder="e.g. High Court / Customs Tribunal"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Next Hearing Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={newCaseHearingDate}
                    onChange={(e) => setNewCaseHearingDate(e.target.value)}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewLegalCaseModal(false);
                    setEditingLegalCase(null);
                  }}
                  className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderPlus size={14} />
                  <span>{editingLegalCase ? 'Save Case Changes' : 'Create Case & Sub-Folders'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 4: ADD CUSTOM FISCAL YEAR                                       */}
      {/* ===================================================================== */}
      {showAddYearModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddFiscalYear}
            className="w-full max-w-sm bg-slate-950 border border-white/15 rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Add Tax / Fiscal Year Folder</h3>
              <button
                type="button"
                onClick={() => setShowAddYearModal(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>
            <input
              type="text"
              required
              value={newFiscalYearInput}
              onChange={(e) => setNewFiscalYearInput(e.target.value)}
              placeholder="e.g. 2023 or 2027"
              className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddYearModal(false)}
                className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="mak-btn px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
              >
                Add Year
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 5: SECURE VAULT CREDENTIAL MODAL                                */}
      {/* ===================================================================== */}
      {showVaultModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveVaultCredential}
            className="w-full max-w-lg bg-slate-950 border border-white/15 rounded-2xl overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-3.5 bg-slate-900 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-amber-400" />
                <h3 className="text-sm font-bold text-white">
                  {editingVaultItem ? 'Update Portal Credential' : 'Save Office ID / Portal Credential'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowVaultModal(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Portal / Regulatory System *
                  </label>
                  <input
                    type="text"
                    required
                    value={vaultPortalName}
                    onChange={(e) => setVaultPortalName(e.target.value)}
                    placeholder="e.g. FBR IRIS / WeBOC / PSW / SECP"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Internal Entity *
                  </label>
                  <select
                    value={vaultEntity}
                    onChange={(e) => setVaultEntity(e.target.value)}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                  >
                    {RECIPIENT_ENTITIES.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    User ID / NTN / Login *
                  </label>
                  <input
                    type="text"
                    required
                    value={vaultUsername}
                    onChange={(e) => setVaultUsername(e.target.value)}
                    placeholder="Login username or NTN"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Password *
                  </label>
                  <input
                    type="text"
                    required
                    value={vaultPassword}
                    onChange={(e) => setVaultPassword(e.target.value)}
                    placeholder="Portal password"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    PIN / 2FA Note
                  </label>
                  <input
                    type="text"
                    value={vaultPinNote}
                    onChange={(e) => setVaultPinNote(e.target.value)}
                    placeholder="e.g. FBR 4-digit PIN"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Portal URL (Optional)
                  </label>
                  <input
                    type="text"
                    value={vaultPortalUrl}
                    onChange={(e) => setVaultPortalUrl(e.target.value)}
                    placeholder="https://iris.fbr.gov.pk"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Registered Recovery Email / Mobile
                  </label>
                  <input
                    type="text"
                    value={vaultRecovery}
                    onChange={(e) => setVaultRecovery(e.target.value)}
                    placeholder="Registered phone or email"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Password / Token Expiry Date
                  </label>
                  <input
                    type="date"
                    value={vaultExpiryDate}
                    onChange={(e) => setVaultExpiryDate(e.target.value)}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowVaultModal(false)}
                  className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Save to Secure Vault
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 6: DATABASE SCHEMA & API ARCHITECTURE SPEC (POSTGRES + FIREBASE)*/}
      {/* ===================================================================== */}
      {showSchemaModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[88vh] bg-slate-950 border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-900 border-b border-white/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Database size={18} className="text-sky-400" />
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Enterprise Corporate DMS Schema &amp; Live Cloud Collections
                  </h3>
                  <p className="text-[11px] text-gray-400">
                    PostgreSQL Relational DDL &amp; Live Firebase Firestore Multi-Tier Collection Architecture
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const text =
                      schemaTab === 'POSTGRES'
                        ? POSTGRESQL_CORPORATE_DMS_DDL
                        : FIRESTORE_CORPORATE_DMS_SPEC;
                    navigator.clipboard?.writeText(text).catch(() => {});
                    setCopiedSchema(true);
                    setTimeout(() => setCopiedSchema(false), 2000);
                  }}
                  className="mak-btn-secondary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedSchema ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  <span>{copiedSchema ? 'Copied' : 'Copy Schema'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSchemaModal(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="px-5 py-2.5 bg-slate-900/60 border-b border-white/10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSchemaTab('POSTGRES')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  schemaTab === 'POSTGRES'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                PostgreSQL DDL (Relational Spec)
              </button>
              <button
                type="button"
                onClick={() => setSchemaTab('FIRESTORE')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  schemaTab === 'FIRESTORE'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Firebase Firestore (Live Active Backend)
              </button>
            </div>

            <pre className="flex-1 overflow-auto p-5 text-[11.5px] font-mono leading-relaxed text-gray-200 bg-slate-950">
              {schemaTab === 'POSTGRES' ? POSTGRESQL_CORPORATE_DMS_DDL : FIRESTORE_CORPORATE_DMS_SPEC}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyDocuments;

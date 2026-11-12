import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Upload,
  FileText,
  Sparkles,
  Loader2,
  Calendar,
  Gavel,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Paperclip,
  Trash2,
  Building2,
  Eye
} from 'lucide-react';
import {
  CompanyDocument,
  CorporateDocumentStatus,
  CorporateLegalCase,
  CorporateRecipientEntity,
  CorporateRootCategory,
  QuotationStatus
} from '../types';
import {
  CORPORATE_ROOT_CATEGORIES,
  TAX_AUTHORITIES,
  DEFAULT_FISCAL_YEARS,
  ASSETS_SUBFOLDERS,
  MASTER_COMPANY_DOC_FOLDERS,
  RECIPIENT_ENTITIES,
  DOCUMENT_STATUS_TAGS,
  QUOTATION_STATUSES,
  QUOTATION_SERVICE_TYPES,
  LEGAL_LOGISTICS_CRIMINAL_SUBFOLDERS,
  getProvisionedLegalSubFolders,
  normalizeLegalSubFolderName,
  resolveDocumentHierarchy
} from '../services/corporateFilingArchitecture';
import { analyzeCompanyDocumentWithAI } from '../services/geminiService';
import { resolveStoredDocumentDataUrl } from '../services/documentStorage';
import { safeAppStorage } from '../services/storage';

export interface UploadHierarchyPreset {
  rootCategory?: CorporateRootCategory;
  legalCaseId?: string;
  subFolder?: string;
  taxAuthority?: string;
  taxYear?: string;
  assetGroup?: string;
}

interface CompanyDocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (doc: CompanyDocument) => Promise<void>;
  onEnsureCustomSubFolder?: (caseId: string, subFolderName: string) => Promise<void>;
  legalCases: CorporateLegalCase[];
  preset?: UploadHierarchyPreset;
  editingDocument?: CompanyDocument | null;
  defaultRecipientEntity?: CorporateRecipientEntity;
  customFiscalYears?: string[];
}

interface UploadFileEntry {
  name: string;
  dataUrl: string;
  type: string;
  size: number;
}

const ISSUER_QUICK_PRESETS: Record<CorporateRootCategory, string[]> = {
  Legal: [
    'Police Department',
    'Customs Enforcement',
    'Customs Appellate Tribunal',
    'High Court',
    'Civil / District Court',
    'Legal Counsel'
  ],
  Tax: [
    'Federal Board of Revenue (FBR)',
    'Sindh Revenue Board (SRB)',
    'Labour Department',
    'Withholding Agent'
  ],
  Assets: [
    'Commercial Bank',
    'Port Authority',
    'Terminal Operator',
    'Utility Provider',
    'Property Registrar'
  ],
  'Company Documents': [
    'SECP',
    'Chamber of Commerce',
    'Customs Licensing Authority',
    'State Bank of Pakistan',
    'Stock Exchange'
  ],
  Quotations: [
    'Docks Pvt. Ltd.',
    'Truckit Pvt. Ltd.',
    'Muhib International',
    'Vantage Shipping Line',
    'MAK Group Commercial Desk'
  ]
};

export const CompanyDocumentUploadModal: React.FC<CompanyDocumentUploadModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onEnsureCustomSubFolder,
  legalCases,
  preset,
  editingDocument,
  defaultRecipientEntity = 'MAK Group',
  customFiscalYears = []
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);
  const currentYear = useMemo(() => new Date().getFullYear().toString(), []);

  // Drag & Drop + File Preview State
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadFileEntry[]>([]);
  const [activePreviewIdx, setActivePreviewIdx] = useState(0);
  const [existingResolvedUrl, setExistingResolvedUrl] = useState<string>('');
  const [aiScanning, setAiScanning] = useState(false);
  const [aiBanner, setAiBanner] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Hierarchy Coordinates
  const [rootCategory, setRootCategory] = useState<CorporateRootCategory>('Company Documents');
  const [legalCaseId, setLegalCaseId] = useState<string>('');
  const [subFolder, setSubFolder] = useState<string>('SECP');
  const [taxAuthority, setTaxAuthority] = useState<string>('FBR');
  const [taxYear, setTaxYear] = useState<string>(currentYear);
  const [assetGroup, setAssetGroup] = useState<string>('Security Deposits Tracking');
  const [assetSubType, setAssetSubType] = useState<string>('Bank Guarantee');
  const [assetValuationPkr, setAssetValuationPkr] = useState<string>('');
  const [assetLocationOrBank, setAssetLocationOrBank] = useState<string>('');

  // Quotations Coordinates
  const [quotationClientName, setQuotationClientName] = useState<string>('');
  const [quotationServiceType, setQuotationServiceType] = useState<string>(QUOTATION_SERVICE_TYPES[0]);
  const [quotationStatus, setQuotationStatus] = useState<QuotationStatus>('Pending');
  const [quotationAmountPkr, setQuotationAmountPkr] = useState<string>('');

  // Mandatory Universal Metadata
  const [title, setTitle] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [senderIssuer, setSenderIssuer] = useState<string>('');
  const [recipientEntity, setRecipientEntity] = useState<string>(defaultRecipientEntity);
  const [issuanceDate, setIssuanceDate] = useState<string>(todayIso);
  const [validityStartDate, setValidityStartDate] = useState<string>(todayIso);
  const [validityEndDate, setValidityEndDate] = useState<string>('');
  const [unlimitedValidity, setUnlimitedValidity] = useState<boolean>(false);
  const [alarmDaysBefore, setAlarmDaysBefore] = useState<number>(15);
  const [hearingDate, setHearingDate] = useState<string>('');
  const [hearingTime, setHearingTime] = useState<string>('');
  const [hearingNotes, setHearingNotes] = useState<string>('');
  const [statusTag, setStatusTag] = useState<CorporateDocumentStatus>('Active');
  const [subject, setSubject] = useState<string>('');

  const availableFiscalYears = useMemo(() => {
    const merged = new Set<string>([...DEFAULT_FISCAL_YEARS, currentYear, ...customFiscalYears]);
    if (taxYear) merged.add(taxYear);
    return Array.from(merged).sort((a, b) => b.localeCompare(a));
  }, [currentYear, customFiscalYears, taxYear]);

  const selectedLegalCase = useMemo(
    () => legalCases.find((c) => c.id === legalCaseId) || null,
    [legalCases, legalCaseId]
  );

  const [useCustomLegalSubFolder, setUseCustomLegalSubFolder] = useState<boolean>(false);
  const [customLegalSubFolderInput, setCustomLegalSubFolderInput] = useState<string>('');

  const legalSubFolders = useMemo(() => {
    if (selectedLegalCase && Array.isArray(selectedLegalCase.subFolders) && selectedLegalCase.subFolders.length > 0) {
      return selectedLegalCase.subFolders.map((sf) => normalizeLegalSubFolderName(sf));
    }
    if (selectedLegalCase) {
      return getProvisionedLegalSubFolders(selectedLegalCase.caseTrack);
    }
    return LEGAL_LOGISTICS_CRIMINAL_SUBFOLDERS;
  }, [selectedLegalCase]);

  const activeAssetConfig = useMemo(
    () => ASSETS_SUBFOLDERS.find((a) => a.id === assetGroup) || ASSETS_SUBFOLDERS[0],
    [assetGroup]
  );

  // Hydrate initial values when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setValidationError(null);
    setAiBanner(null);
    setActivePreviewIdx(0);
    setUseCustomLegalSubFolder(false);
    setCustomLegalSubFolderInput('');

    if (editingDocument) {
      const resolved = resolveDocumentHierarchy(editingDocument);
      setRootCategory(resolved.rootCategory);
      setLegalCaseId(resolved.legalCaseId || legalCases[0]?.id || '');
      setSubFolder(
        resolved.subFolder ||
          (resolved.rootCategory === 'Legal'
            ? LEGAL_LOGISTICS_CRIMINAL_SUBFOLDERS[0]
            : MASTER_COMPANY_DOC_FOLDERS[0].id)
      );
      setTaxAuthority(resolved.taxAuthority || 'FBR');
      setTaxYear(resolved.taxYear || currentYear);
      setAssetGroup(resolved.assetGroup || 'Security Deposits Tracking');
      setAssetSubType(editingDocument.assetSubType || 'Bank Guarantee');
      setAssetValuationPkr(
        typeof editingDocument.assetValuationPkr === 'number' ? String(editingDocument.assetValuationPkr) : ''
      );
      setAssetLocationOrBank(editingDocument.assetLocationOrBank || '');
      setQuotationClientName(editingDocument.quotationClientName || '');
      setQuotationServiceType(editingDocument.quotationServiceType || QUOTATION_SERVICE_TYPES[0]);
      setQuotationStatus(resolved.quotationStatus || 'Pending');
      setQuotationAmountPkr(
        typeof editingDocument.quotationAmountPkr === 'number' ? String(editingDocument.quotationAmountPkr) : ''
      );

      setTitle(editingDocument.title || '');
      setReferenceNo(editingDocument.referenceNo || '');
      setSenderIssuer(resolved.senderIssuer || '');
      setRecipientEntity(resolved.recipientEntity || defaultRecipientEntity);
      setIssuanceDate(resolved.issuanceDate || todayIso);
      setValidityStartDate(resolved.validityStartDate || resolved.issuanceDate || todayIso);
      setValidityEndDate(resolved.validityEndDate || '');
      setUnlimitedValidity(Boolean(editingDocument.unlimitedValidity));
      setAlarmDaysBefore(resolved.alarmDaysBefore || 15);
      setHearingDate(editingDocument.hearingDate || '');
      setHearingTime(editingDocument.hearingTime || '');
      setHearingNotes(editingDocument.hearingNotes || '');
      setStatusTag(editingDocument.statusTag || 'Active');
      setSubject(editingDocument.subject || editingDocument.notes || '');
      setUploadedFiles([]);

      if (editingDocument.fileUrl || editingDocument.id) {
        resolveStoredDocumentDataUrl({
          url: editingDocument.fileUrl || null,
          id: editingDocument.id,
          name: editingDocument.fileName || editingDocument.title
        })
          .then((res) => setExistingResolvedUrl(res || ''))
          .catch(() => setExistingResolvedUrl(''));
      } else {
        setExistingResolvedUrl('');
      }
      return;
    }

    // Fresh upload mode with preset from active folder breadcrumb
    const initRoot = preset?.rootCategory || 'Company Documents';
    setRootCategory(initRoot);
    const initCaseId = preset?.legalCaseId || legalCases[0]?.id || '';
    setLegalCaseId(initCaseId);

    if (initRoot === 'Legal') {
      const foundCase = legalCases.find((c) => c.id === initCaseId);
      const defaultLegFolder = normalizeLegalSubFolderName(
        preset?.subFolder ||
          foundCase?.subFolders?.[0] ||
          LEGAL_LOGISTICS_CRIMINAL_SUBFOLDERS[0]
      );
      setSubFolder(defaultLegFolder);
      if (foundCase?.recipientEntity) {
        setRecipientEntity(foundCase.recipientEntity);
      } else {
        setRecipientEntity(defaultRecipientEntity);
      }
    } else if (initRoot === 'Company Documents') {
      setSubFolder(preset?.subFolder || MASTER_COMPANY_DOC_FOLDERS[0].id);
      setRecipientEntity(defaultRecipientEntity);
    } else {
      setSubFolder(preset?.subFolder || 'SECP');
      setRecipientEntity(defaultRecipientEntity);
    }

    setTaxAuthority(preset?.taxAuthority || 'FBR');
    setTaxYear(preset?.taxYear || currentYear);
    const initAssetGroup = preset?.assetGroup || 'Security Deposits Tracking';
    setAssetGroup(initAssetGroup);
    const matchedAssetGroup = ASSETS_SUBFOLDERS.find((a) => a.id === initAssetGroup) || ASSETS_SUBFOLDERS[0];
    setAssetSubType(matchedAssetGroup.subTypes[0]);
    setAssetValuationPkr('');
    setAssetLocationOrBank('');

    setQuotationClientName('');
    setQuotationServiceType(QUOTATION_SERVICE_TYPES[0]);
    setQuotationStatus('Pending');
    setQuotationAmountPkr('');

    setTitle('');
    setReferenceNo('');
    setSenderIssuer(initRoot === 'Tax' ? (preset?.taxAuthority || 'FBR') : '');
    setIssuanceDate(todayIso);
    setValidityStartDate(todayIso);
    setValidityEndDate('');
    setUnlimitedValidity(initRoot === 'Tax');
    setAlarmDaysBefore(15);
    setHearingDate('');
    setHearingTime('');
    setHearingNotes('');
    setStatusTag('Active');
    setSubject('');
    setUploadedFiles([]);
    setExistingResolvedUrl('');
  }, [isOpen, editingDocument, preset, legalCases, defaultRecipientEntity, currentYear, todayIso]);

  // Keep subFolder valid when switching root category or legal case
  useEffect(() => {
    if (!isOpen || editingDocument) return;
    if (rootCategory === 'Legal') {
      if (!legalSubFolders.includes(subFolder)) {
        setSubFolder(legalSubFolders[0] || LEGAL_LOGISTICS_CRIMINAL_SUBFOLDERS[0]);
      }
    } else if (rootCategory === 'Company Documents') {
      const validIds = MASTER_COMPANY_DOC_FOLDERS.map((f) => f.id);
      if (!validIds.includes(subFolder)) {
        setSubFolder(MASTER_COMPANY_DOC_FOLDERS[0].id);
      }
    }
  }, [rootCategory, legalCaseId, legalSubFolders, isOpen, editingDocument, subFolder]);

  // Calculate live remaining validity & hearing countdowns
  const remainingValidityDays = useMemo(() => {
    if (unlimitedValidity || !validityEndDate) return null;
    const endMs = new Date(`${validityEndDate}T00:00:00`).getTime();
    const todayMs = new Date(`${todayIso}T00:00:00`).getTime();
    if (isNaN(endMs)) return null;
    return Math.ceil((endMs - todayMs) / (24 * 60 * 60 * 1000));
  }, [unlimitedValidity, validityEndDate, todayIso]);

  const remainingHearingDays = useMemo(() => {
    if (!hearingDate) return null;
    const hearMs = new Date(`${hearingDate}T00:00:00`).getTime();
    const todayMs = new Date(`${todayIso}T00:00:00`).getTime();
    if (isNaN(hearMs)) return null;
    return Math.ceil((hearMs - todayMs) / (24 * 60 * 60 * 1000));
  }, [hearingDate, todayIso]);

  const readFilesIntoState = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setValidationError(null);

    const parsed: UploadFileEntry[] = [];
    for (const file of arr) {
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          parsed.push({
            name: file.name,
            dataUrl: String(ev.target?.result || ''),
            type: file.type || 'application/pdf',
            size: file.size
          });
          resolve();
        };
        reader.onerror = () => resolve();
        reader.readAsDataURL(file);
      });
    }

    setUploadedFiles((prev) => [...prev, ...parsed]);
    if (!title.trim() && parsed[0]?.name) {
      const cleanBase = parsed[0].name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
      setTitle(cleanBase);
    }
  };

  const handleRunAiExtract = async () => {
    const primary = uploadedFiles[activePreviewIdx] || uploadedFiles[0];
    if (!primary) return;
    setAiScanning(true);
    setAiBanner(null);
    try {
      const aiRes = await analyzeCompanyDocumentWithAI({
        name: primary.name,
        dataUrl: primary.dataUrl,
        type: primary.type
      });
      if (aiRes.title) setTitle(aiRes.title);
      if (aiRes.documentDate) {
        setIssuanceDate(aiRes.documentDate);
        setValidityStartDate(aiRes.documentDate);
      }
      if (aiRes.from) setSenderIssuer(aiRes.from);
      if (aiRes.subject) setSubject(aiRes.subject);
      if (aiRes.referenceNo) setReferenceNo(aiRes.referenceNo);
      if (aiRes.hearingDate) {
        setHearingDate(aiRes.hearingDate);
        setStatusTag('Pending Hearing');
      }
      if (aiRes.hearingTime) setHearingTime(aiRes.hearingTime);
      setAiBanner(
        aiRes.unreadFieldsNote
          ? `Document scanned: ${aiRes.unreadFieldsNote}`
          : 'Metadata fields extracted from uploaded file. Verify mandatory tags below before saving.'
      );
    } catch {
      setAiBanner('Could not auto-extract text from this scan. Please complete the metadata fields manually.');
    } finally {
      setAiScanning(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await readFilesIntoState(e.dataTransfer.files);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const hasAttachment = uploadedFiles.length > 0 || Boolean(editingDocument?.fileUrl || existingResolvedUrl);
    if (!hasAttachment) {
      setValidationError('Please attach a PDF or Image document before saving.');
      return;
    }
    if (!title.trim()) {
      setValidationError('Document Title is required.');
      return;
    }
    if (!senderIssuer.trim()) {
      setValidationError('Sender / Issuer is mandatory (e.g., Police, Court, FBR, Bank, or Client).');
      return;
    }
    if (!recipientEntity.trim()) {
      setValidationError('Recipient Entity is mandatory (Docks, Truckit, Muhib, Vantage, or MAK Group).');
      return;
    }
    if (!issuanceDate) {
      setValidationError('Issuance Date is mandatory.');
      return;
    }
    if (rootCategory === 'Legal' && !legalCaseId) {
      setValidationError('Please select a Legal Case folder first (or create a new Legal Case).');
      return;
    }
    const effectiveLegalSubFolder =
      rootCategory === 'Legal' && useCustomLegalSubFolder
        ? customLegalSubFolderInput.trim()
        : subFolder;
    if (rootCategory === 'Legal' && !effectiveLegalSubFolder) {
      setValidationError('Please select or enter a Case Proceeding Sub-Folder.');
      return;
    }
    if (rootCategory === 'Quotations' && !quotationClientName.trim()) {
      setValidationError('Client Name is required for commercial quotations.');
      return;
    }

    setIsSaving(true);
    try {
      if (
        rootCategory === 'Legal' &&
        useCustomLegalSubFolder &&
        effectiveLegalSubFolder &&
        legalCaseId &&
        onEnsureCustomSubFolder
      ) {
        await onEnsureCustomSubFolder(legalCaseId, effectiveLegalSubFolder);
      }

      const primaryUpload = uploadedFiles[0];
      const extraUploads = uploadedFiles.slice(1).map((f) => ({
        name: f.name,
        url: f.dataUrl,
        type: f.type,
        size: f.size
      }));

      const computedCategoryLabel =
        rootCategory === 'Legal'
          ? effectiveLegalSubFolder
          : rootCategory === 'Tax'
            ? `${taxAuthority} (${taxYear})`
            : rootCategory === 'Assets'
              ? assetGroup
              : rootCategory === 'Company Documents'
                ? subFolder
                : 'Quotations';

      const finalStatusTag: CorporateDocumentStatus =
        !unlimitedValidity && remainingValidityDays !== null && remainingValidityDays <= 0 && statusTag === 'Active'
          ? 'Expired'
          : statusTag;

      const docRecord: CompanyDocument = {
        ...(editingDocument || {}),
        id:
          editingDocument?.id ||
          `corpdoc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: title.trim(),
        rootCategory,
        category: computedCategoryLabel,
        subcategory:
          rootCategory === 'Legal'
            ? selectedLegalCase?.identifier || ''
            : rootCategory === 'Tax'
              ? `Year ${taxYear}`
              : rootCategory === 'Assets'
                ? assetSubType
                : rootCategory === 'Quotations'
                  ? quotationServiceType
                  : subFolder,
        subFolder:
          rootCategory === 'Legal'
            ? effectiveLegalSubFolder
            : rootCategory === 'Company Documents'
              ? subFolder
              : rootCategory === 'Assets'
                ? assetGroup
                : undefined,
        legalCaseId: rootCategory === 'Legal' ? legalCaseId : undefined,
        legalCaseTitle: rootCategory === 'Legal' ? selectedLegalCase?.identifier : undefined,
        legalCaseTrack: rootCategory === 'Legal' ? selectedLegalCase?.caseTrack : undefined,
        taxAuthority: rootCategory === 'Tax' ? taxAuthority : undefined,
        taxYear: taxYear.trim() || undefined,
        assetGroup: rootCategory === 'Assets' ? assetGroup : undefined,
        assetSubType: rootCategory === 'Assets' ? assetSubType : undefined,
        assetValuationPkr:
          rootCategory === 'Assets' && assetValuationPkr
            ? Number(assetValuationPkr)
            : undefined,
        assetLocationOrBank:
          rootCategory === 'Assets' && assetLocationOrBank.trim()
            ? assetLocationOrBank.trim()
            : undefined,
        quotationClientName:
          rootCategory === 'Quotations' ? quotationClientName.trim() : undefined,
        quotationServiceType:
          rootCategory === 'Quotations' ? quotationServiceType : undefined,
        quotationStatus:
          rootCategory === 'Quotations' ? quotationStatus : undefined,
        quotationAmountPkr:
          rootCategory === 'Quotations' && quotationAmountPkr
            ? Number(quotationAmountPkr)
            : undefined,
        // Mandatory Universal Metadata
        senderIssuer: senderIssuer.trim(),
        from: senderIssuer.trim(),
        recipientEntity,
        to: recipientEntity,
        issuanceDate,
        documentDate: issuanceDate,
        issueDate: issuanceDate,
        referenceNo: referenceNo.trim() || undefined,
        subject: subject.trim() || undefined,
        notes: subject.trim() || undefined,
        validityStartDate: unlimitedValidity ? undefined : validityStartDate || issuanceDate,
        validityEndDate: unlimitedValidity ? undefined : validityEndDate || undefined,
        unlimitedValidity,
        hasExpiry: !unlimitedValidity && Boolean(validityEndDate),
        expiryDate: !unlimitedValidity && validityEndDate ? validityEndDate : undefined,
        alarmDaysBefore: Number(alarmDaysBefore) > 0 ? Number(alarmDaysBefore) : 15,
        hearingRequired: Boolean(hearingDate),
        hearingDate: hearingDate || undefined,
        hearingTime: hearingDate && hearingTime ? hearingTime : undefined,
        hearingNotes: hearingNotes.trim() || undefined,
        statusTag: finalStatusTag,
        // File Storage
        fileUrl: primaryUpload ? primaryUpload.dataUrl : editingDocument?.fileUrl,
        fileName: primaryUpload ? primaryUpload.name : editingDocument?.fileName,
        fileType: primaryUpload ? primaryUpload.type : editingDocument?.fileType,
        fileSize: primaryUpload ? primaryUpload.size : editingDocument?.fileSize,
        additionalFiles:
          extraUploads.length > 0
            ? [...(editingDocument?.additionalFiles || []), ...extraUploads]
            : editingDocument?.additionalFiles,
        uploadedAt: editingDocument?.uploadedAt || new Date().toISOString(),
        uploadedBy:
          editingDocument?.uploadedBy ||
          safeAppStorage.getItem('dpl_current_user_name') ||
          'Documentation Manager'
      };

      await onSave(docRecord);
      onClose();
    } catch (err: any) {
      setValidationError(err?.message || 'Failed to save document metadata. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const activeFile = uploadedFiles[activePreviewIdx] || uploadedFiles[0] || null;
  const previewSrc = activeFile?.dataUrl || existingResolvedUrl || '';
  const previewMime = (activeFile?.type || editingDocument?.fileType || '').toLowerCase();
  const previewName = (activeFile?.name || editingDocument?.fileName || '').toLowerCase();
  const isImagePreview =
    previewMime.startsWith('image/') ||
    previewSrc.startsWith('data:image/') ||
    /\.(jpg|jpeg|png|webp|gif)$/i.test(previewName);
  const isPdfPreview =
    previewMime.includes('pdf') ||
    previewSrc.startsWith('data:application/pdf') ||
    previewName.endsWith('.pdf');

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-6xl max-h-[94vh] bg-slate-950 border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-900 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center shrink-0">
              <Upload size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-white truncate">
                {editingDocument ? 'Update Corporate Filing & Metadata' : 'Upload Corporate Document & Mandatory Metadata'}
              </h3>
              <p className="text-xs text-gray-400 truncate">
                MAK Group Universal Document Tagging &amp; Automated Expiry / Hearing Alarm Engine
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mak-btn-secondary p-2 rounded-lg text-gray-300 hover:text-white cursor-pointer"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {validationError && (
          <div className="px-4 sm:px-6 py-2.5 bg-rose-500/15 border-b border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 shrink-0">
            <AlertTriangle size={15} className="shrink-0 text-rose-400" />
            <span className="font-semibold">{validationError}</span>
          </div>
        )}

        {/* Two-Column Split Body: Left = Drag & Drop + Instant Preview | Right = Mandatory Metadata Form */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left Column: Drag-and-Drop Zone + Instant Document Preview */}
          <div className="w-full lg:w-[40%] border-b lg:border-b-0 lg:border-r border-white/10 p-4 sm:p-5 flex flex-col gap-3.5 overflow-y-auto bg-slate-900/40">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
              }}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-sky-400 bg-sky-500/10'
                  : 'border-white/15 hover:border-sky-400/50 bg-slate-900/70'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
                multiple
                onChange={(e) => {
                  if (e.target.files) readFilesIntoState(e.target.files);
                }}
                className="hidden"
              />
              <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center mx-auto mb-2">
                <Upload size={18} />
              </div>
              <p className="text-xs font-bold text-white">
                Drag &amp; Drop PDF or Image Here, or Click to Browse
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Supports multi-page PDFs, scanned notices, FIRs, tax returns, deeds &amp; high-res images
              </p>
            </div>

            {/* Attached Files List + Optional AI Smart Scan */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Attached Files ({uploadedFiles.length})
                  </span>
                  <button
                    type="button"
                    disabled={aiScanning}
                    onClick={handleRunAiExtract}
                    className="mak-btn-secondary px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {aiScanning ? (
                      <Loader2 size={12} className="animate-spin text-sky-400" />
                    ) : (
                      <Sparkles size={12} className="text-sky-400" />
                    )}
                    <span>{aiScanning ? 'Scanning Document...' : 'Auto-Extract Metadata'}</span>
                  </button>
                </div>

                <div className="space-y-1.5 max-h-28 overflow-y-auto">
                  {uploadedFiles.map((file, idx) => (
                    <div
                      key={`${file.name}_${idx}`}
                      onClick={() => setActivePreviewIdx(idx)}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center justify-between gap-2 cursor-pointer ${
                        idx === activePreviewIdx
                          ? 'bg-sky-500/15 border-sky-400/40 text-white'
                          : 'bg-slate-900/80 border-white/10 text-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip size={12} className="text-sky-400 shrink-0" />
                        <span className="truncate font-medium">{file.name}</span>
                        <span className="text-[10px] font-mono text-gray-400 tabular-nums shrink-0">
                          {(file.size / 1024).toFixed(0)} KB
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setUploadedFiles((prev) => prev.filter((_, i) => i !== idx));
                          setActivePreviewIdx(0);
                        }}
                        className="text-gray-400 hover:text-rose-400 p-0.5 cursor-pointer"
                        title="Remove attachment"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {aiBanner && (
              <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-400/25 text-[11px] text-sky-300 leading-relaxed">
                {aiBanner}
              </div>
            )}

            {/* Instant Embedded Preview Pane */}
            <div className="flex-1 min-h-[240px] rounded-xl border border-white/10 bg-slate-950 overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b border-white/10 bg-slate-900/80 flex items-center justify-between text-[11px] text-gray-400">
                <div className="flex items-center gap-1.5 font-semibold text-gray-300">
                  <Eye size={13} className="text-sky-400" />
                  <span>Instant Document Preview</span>
                </div>
                <span className="font-mono truncate max-w-[180px]">
                  {activeFile?.name || editingDocument?.fileName || 'No file selected'}
                </span>
              </div>

              <div className="flex-1 flex items-center justify-center p-2 bg-slate-950 overflow-auto">
                {!previewSrc ? (
                  <div className="text-center p-6 space-y-1.5">
                    <FileText size={28} className="mx-auto text-gray-600" />
                    <p className="text-xs text-gray-400 font-medium">No document selected yet</p>
                    <p className="text-[11px] text-gray-500">
                      Drop a PDF or image above to inspect it while entering compliance metadata.
                    </p>
                  </div>
                ) : isImagePreview ? (
                  <img
                    src={previewSrc}
                    alt="Uploaded document preview"
                    className="max-h-[340px] w-auto object-contain rounded-lg border border-white/10"
                  />
                ) : isPdfPreview ? (
                  <iframe
                    src={previewSrc}
                    title="Uploaded PDF Preview"
                    className="w-full h-[340px] rounded-lg border border-white/10 bg-white"
                  />
                ) : (
                  <div className="text-center p-6 space-y-1.5">
                    <CheckCircle2 size={28} className="mx-auto text-emerald-400" />
                    <p className="text-xs font-semibold text-white">
                      {activeFile?.name || editingDocument?.fileName || 'Document Attached'}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      Ready to store in encrypted cloud repository.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Multi-Tier Folder Target + Mandatory Universal Metadata */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-5">
            {/* Section 1: Filing Destination Hierarchy */}
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                  1. Target Filing Hierarchy
                </span>
                <span className="text-[11px] font-mono text-gray-400">
                  Root &rarr; Sub-Folder
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Primary Category *
                  </label>
                  <select
                    value={rootCategory}
                    onChange={(e) => setRootCategory(e.target.value as CorporateRootCategory)}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                  >
                    {CORPORATE_ROOT_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.numberLabel}. {c.title} — {c.subtitle}
                      </option>
                    ))}
                  </select>
                </div>

                {rootCategory === 'Legal' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Legal Case Dossier *
                    </label>
                    <select
                      value={legalCaseId}
                      onChange={(e) => setLegalCaseId(e.target.value)}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                    >
                      {legalCases.length === 0 ? (
                        <option value="">-- Create a Legal Case folder first --</option>
                      ) : (
                        legalCases.map((lc) => (
                          <option key={lc.id} value={lc.id}>
                            {lc.identifier} ({lc.caseTrack === 'CIVIL_CORPORATE' ? 'Civil/Corporate' : 'Logistics/Criminal'})
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                )}

                {rootCategory === 'Tax' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Regulatory Authority *
                    </label>
                    <select
                      value={taxAuthority}
                      onChange={(e) => {
                        setTaxAuthority(e.target.value);
                        if (!senderIssuer || senderIssuer === taxAuthority) {
                          setSenderIssuer(e.target.value);
                        }
                      }}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                    >
                      {TAX_AUTHORITIES.map((auth) => (
                        <option key={auth.id} value={auth.id}>
                          {auth.title} — {auth.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {rootCategory === 'Assets' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Asset Repository Sub-Folder *
                    </label>
                    <select
                      value={assetGroup}
                      onChange={(e) => {
                        const nextGroup = e.target.value;
                        setAssetGroup(nextGroup);
                        const cfg = ASSETS_SUBFOLDERS.find((a) => a.id === nextGroup);
                        if (cfg?.subTypes?.[0]) setAssetSubType(cfg.subTypes[0]);
                      }}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                    >
                      {ASSETS_SUBFOLDERS.map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {rootCategory === 'Company Documents' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Master Compliance Folder *
                    </label>
                    <select
                      value={subFolder}
                      onChange={(e) => setSubFolder(e.target.value)}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                    >
                      {MASTER_COMPANY_DOC_FOLDERS.map((mf) => (
                        <option key={mf.id} value={mf.id}>
                          {mf.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {rootCategory === 'Quotations' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Quotation Status *
                    </label>
                    <select
                      value={quotationStatus}
                      onChange={(e) => setQuotationStatus(e.target.value as QuotationStatus)}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                    >
                      {QUOTATION_STATUSES.map((qs) => (
                        <option key={qs} value={qs}>
                          {qs}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Tier-3 Sub-Folder / Specific Context Row */}
              {rootCategory === 'Legal' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-gray-300">
                      Case Proceeding Sub-Folder *
                    </label>
                    <button
                      type="button"
                      onClick={() => setUseCustomLegalSubFolder((prev) => !prev)}
                      className="text-[11px] font-semibold text-sky-400 hover:underline cursor-pointer"
                    >
                      {useCustomLegalSubFolder ? 'Select Standard Sub-Folder' : '+ Enter Custom Sub-Folder'}
                    </button>
                  </div>
                  {useCustomLegalSubFolder ? (
                    <input
                      type="text"
                      value={customLegalSubFolderInput}
                      onChange={(e) => setCustomLegalSubFolderInput(e.target.value)}
                      placeholder="e.g. Bail Proceedings / Forensic Lab Reports"
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                    />
                  ) : (
                    <select
                      value={subFolder}
                      onChange={(e) => setSubFolder(e.target.value)}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                    >
                      {legalSubFolders.map((sf) => (
                        <option key={sf} value={sf}>
                          {sf}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {rootCategory === 'Assets' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Asset / Deposit Classification
                    </label>
                    <select
                      value={assetSubType}
                      onChange={(e) => setAssetSubType(e.target.value)}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                    >
                      {activeAssetConfig.subTypes.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Amount / Valuation (PKR)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={assetValuationPkr}
                      onChange={(e) => setAssetValuationPkr(e.target.value)}
                      placeholder="e.g. 5000000"
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Bank / Authority / Property Reference
                    </label>
                    <input
                      type="text"
                      value={assetLocationOrBank}
                      onChange={(e) => setAssetLocationOrBank(e.target.value)}
                      placeholder="e.g. Commercial Bank / Port Terminal / Plot #"
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                    />
                  </div>
                </div>
              )}

              {rootCategory === 'Quotations' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Client Name *
                    </label>
                    <input
                      type="text"
                      value={quotationClientName}
                      onChange={(e) => setQuotationClientName(e.target.value)}
                      placeholder="Enter prospective or registered client"
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Service Type *
                    </label>
                    <select
                      value={quotationServiceType}
                      onChange={(e) => setQuotationServiceType(e.target.value)}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                    >
                      {QUOTATION_SERVICE_TYPES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Quoted Tariff / Amount (PKR)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={quotationAmountPkr}
                      onChange={(e) => setQuotationAmountPkr(e.target.value)}
                      placeholder="e.g. 285000"
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Section 2: Mandatory Universal Metadata */}
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                  2. Mandatory Universal Document Metadata
                </span>
                <span className="text-[11px] text-gray-400">Required on every corporate filing</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Document Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Certified Filing / Annual Return / Official Notice"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Reference / Order / Policy #
                  </label>
                  <input
                    type="text"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder="e.g. Ref # 104/2025"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Sender / Issuer (Issuing Authority, Court, Bank, or Client) *
                  </label>
                  <input
                    type="text"
                    required
                    value={senderIssuer}
                    onChange={(e) => setSenderIssuer(e.target.value)}
                    placeholder="e.g. Issuing Authority, Police Station, Court, Bank, or Client"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {ISSUER_QUICK_PRESETS[rootCategory].slice(0, 4).map((presetIssuer) => (
                      <button
                        key={presetIssuer}
                        type="button"
                        onClick={() => setSenderIssuer(presetIssuer)}
                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] text-gray-300 cursor-pointer transition-colors"
                      >
                        {presetIssuer}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Internal Recipient Entity *
                  </label>
                  <select
                    value={recipientEntity}
                    onChange={(e) => setRecipientEntity(e.target.value)}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                  >
                    {RECIPIENT_ENTITIES.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                    <Building2 size={11} className="text-sky-400" />
                    <span>Binds compliance record to selected MAK Group entity</span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Issuance Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={issuanceDate}
                    onChange={(e) => setIssuanceDate(e.target.value)}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Tax / Report Fiscal Year {rootCategory === 'Tax' ? '*' : ''}
                  </label>
                  <select
                    value={taxYear}
                    onChange={(e) => setTaxYear(e.target.value)}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono bg-slate-900 text-white border border-white/15 outline-none"
                  >
                    <option value="">Not Applicable</option>
                    {availableFiscalYears.map((yr) => (
                      <option key={yr} value={yr}>
                        Year {yr} (FY {Number(yr) - 1}-{yr.slice(-2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Status Tag *
                  </label>
                  <select
                    value={statusTag}
                    onChange={(e) => setStatusTag(e.target.value as CorporateDocumentStatus)}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                  >
                    {DOCUMENT_STATUS_TAGS.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                  Executive Summary / Remarks
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Concise summary of filing, conditions, or compliance scope..."
                  className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
            </div>

            {/* Section 3: Validity Period, Expiry Alarm & Legal Hearing Countdown */}
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-white/10 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Bell size={13} className="text-amber-400" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    3. Validity Period, Expiry Alarm &amp; Hearing Countdown
                  </span>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={unlimitedValidity}
                    onChange={(e) => setUnlimitedValidity(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-sky-500"
                  />
                  <span>Perpetual / No Expiration Date</span>
                </label>
              </div>

              {!unlimitedValidity && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Validity Start Date
                    </label>
                    <input
                      type="date"
                      value={validityStartDate}
                      onChange={(e) => setValidityStartDate(e.target.value)}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Expiry / Validity End Date
                    </label>
                    <input
                      type="date"
                      value={validityEndDate}
                      onChange={(e) => setValidityEndDate(e.target.value)}
                      className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      Alert Lead Window (Days Before)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={alarmDaysBefore}
                        onChange={(e) => setAlarmDaysBefore(Math.max(1, Number(e.target.value) || 15))}
                        className="glass-input w-20 rounded-lg px-2.5 py-2 text-xs font-mono tabular-nums outline-none"
                      />
                      <div className="flex items-center gap-1">
                        {[7, 15, 30, 60].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setAlarmDaysBefore(d)}
                            className={`px-2 py-1.5 rounded text-[10px] font-mono font-semibold border cursor-pointer ${
                              alarmDaysBefore === d
                                ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                                : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                            }`}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {remainingValidityDays !== null && (
                <div
                  className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between ${
                    remainingValidityDays <= 0
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      : remainingValidityDays <= alarmDaysBefore
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                  }`}
                >
                  <span className="font-semibold flex items-center gap-1.5">
                    <Calendar size={13} />
                    <span>
                      {remainingValidityDays <= 0
                        ? 'Document validity has expired — immediate dashboard & push alert will trigger'
                        : remainingValidityDays <= alarmDaysBefore
                          ? `Within ${alarmDaysBefore}-day alarm window — dashboard & push alert active`
                          : `Active compliance validity (Alert scheduled ${alarmDaysBefore} days before expiry)`}
                    </span>
                  </span>
                  <span className="font-mono font-bold tabular-nums">
                    {remainingValidityDays <= 0
                      ? `${Math.abs(remainingValidityDays)}d Overdue`
                      : `${remainingValidityDays}d Remaining`}
                  </span>
                </div>
              )}

              {/* Legal Hearing / Action Date Row */}
              <div className="pt-2 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1 flex items-center gap-1">
                    <Gavel size={12} className="text-amber-400" />
                    <span>Hearing / Action Date</span>
                  </label>
                  <input
                    type="date"
                    value={hearingDate}
                    onChange={(e) => {
                      setHearingDate(e.target.value);
                      if (e.target.value && statusTag === 'Active') {
                        setStatusTag('Pending Hearing');
                      }
                    }}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Hearing Time (Optional)
                  </label>
                  <input
                    type="time"
                    value={hearingTime}
                    onChange={(e) => setHearingTime(e.target.value)}
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs font-mono tabular-nums outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Court / Forum / Action Directive
                  </label>
                  <input
                    type="text"
                    value={hearingNotes}
                    onChange={(e) => setHearingNotes(e.target.value)}
                    placeholder="e.g. Courtroom # / File Written Reply"
                    className="glass-input w-full rounded-lg px-3 py-2 text-xs outline-none"
                  />
                </div>
              </div>

              {remainingHearingDays !== null && (
                <div
                  className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between ${
                    remainingHearingDays < 0
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      : 'bg-sky-500/15 border-sky-400/30 text-sky-300'
                  }`}
                >
                  <span className="font-semibold flex items-center gap-1.5">
                    <Gavel size={13} />
                    <span>Automated Legal Hearing / Action Countdown Alarm</span>
                  </span>
                  <span className="font-mono font-bold tabular-nums">
                    {remainingHearingDays < 0
                      ? `${Math.abs(remainingHearingDays)}d Past Hearing`
                      : remainingHearingDays === 0
                        ? 'Hearing Today'
                        : `In ${remainingHearingDays} Day(s)`}
                  </span>
                </div>
              )}
            </div>

            {/* Footer Submit Controls */}
            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="mak-btn-secondary px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="mak-btn px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                <span>{editingDocument ? 'Save Updated Record' : 'Save & Archive Filing'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

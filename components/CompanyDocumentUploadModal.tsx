import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Upload,
  FileText,
  Image as ImageIcon,
  Calendar,
  Gavel,
  AlertTriangle,
  Paperclip,
  Trash2,
  Eye,
  FolderOpen,
  Check,
  Bell
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
  ASSETS_SUBFOLDERS,
  DEFAULT_FISCAL_YEARS,
  DOCUMENT_STATUS_TAGS,
  MASTER_COMPANY_DOC_FOLDERS,
  QUOTATION_SERVICE_TYPES,
  QUOTATION_STATUSES,
  RECIPIENT_ENTITIES,
  TAX_AUTHORITIES,
  getProvisionedLegalSubFolders
} from '../services/corporateFilingArchitecture';
import { resolveStoredDocumentDataUrl } from '../services/documentStorage';
import { safeAppStorage } from '../services/storage';

export interface CompanyDocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (doc: CompanyDocument) => Promise<void>;
  defaultRootCategory: CorporateRootCategory;
  legalCases: CorporateLegalCase[];
  defaultLegalCaseId?: string;
  defaultSubFolder?: string;
  defaultTaxAuthority?: 'FBR' | 'SRB' | 'Labour Department' | string;
  defaultTaxYear?: string;
  defaultAssetGroup?: 'Security Deposits Tracking' | 'Company Properties & Investments' | string;
  customMasterFolders?: string[];
  editingDocument?: CompanyDocument | null;
  preDroppedFiles?: File[];
}

interface UploadFileEntry {
  name: string;
  dataUrl: string;
  type: string;
  size: number;
}

function isAllowedPdfOrImageFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const lowerName = (file.name || '').toLowerCase();
  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) return true;
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(lowerName)) return true;
  return false;
}

export const CompanyDocumentUploadModal: React.FC<CompanyDocumentUploadModalProps> = ({
  isOpen,
  onClose,
  onSave,
  defaultRootCategory,
  legalCases,
  defaultLegalCaseId,
  defaultSubFolder,
  defaultTaxAuthority,
  defaultTaxYear,
  defaultAssetGroup,
  customMasterFolders = [],
  editingDocument,
  preDroppedFiles
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);
  const currentYearStr = useMemo(() => String(new Date().getFullYear()), []);

  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadFileEntry[]>([]);
  const [activePreviewIdx, setActivePreviewIdx] = useState(0);
  const [existingResolvedUrl, setExistingResolvedUrl] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Target Category & Folder Coordinates
  const [rootCategory, setRootCategory] = useState<CorporateRootCategory>('Company Documents');
  const [legalCaseId, setLegalCaseId] = useState<string>('');
  const [subFolder, setSubFolder] = useState<string>('');
  const [taxAuthority, setTaxAuthority] = useState<string>('FBR');
  const [taxYear, setTaxYear] = useState<string>(currentYearStr);
  const [assetGroup, setAssetGroup] = useState<string>('Security Deposits Tracking');
  const [assetSubType, setAssetSubType] = useState<string>('Bank Guarantee');
  const [assetValuationPkr, setAssetValuationPkr] = useState<string>('');
  const [assetLocationOrBank, setAssetLocationOrBank] = useState<string>('');
  const [quotationClientName, setQuotationClientName] = useState<string>('');
  const [quotationServiceType, setQuotationServiceType] = useState<string>('Bonded Carrier');
  const [quotationStatus, setQuotationStatus] = useState<QuotationStatus>('Pending');
  const [quotationAmountPkr, setQuotationAmountPkr] = useState<string>('');

  // Universal Mandatory Metadata & Smart Alarm Fields
  const [title, setTitle] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [senderIssuer, setSenderIssuer] = useState<string>('');
  const [recipientEntity, setRecipientEntity] = useState<CorporateRecipientEntity | string>('MAK Group');
  const [issuanceDate, setIssuanceDate] = useState<string>(todayIso);
  const [unlimitedValidity, setUnlimitedValidity] = useState<boolean>(true);
  const [validityStartDate, setValidityStartDate] = useState<string>(todayIso);
  const [validityEndDate, setValidityEndDate] = useState<string>('');
  const [alarmDaysBefore, setAlarmDaysBefore] = useState<number>(15);
  const [hearingRequired, setHearingRequired] = useState<boolean>(false);
  const [hearingDate, setHearingDate] = useState<string>('');
  const [hearingTime, setHearingTime] = useState<string>('');
  const [hearingNotes, setHearingNotes] = useState<string>('');
  const [statusTag, setStatusTag] = useState<CorporateDocumentStatus>('Active');
  const [notes, setNotes] = useState<string>('');

  const selectedLegalCase = useMemo(
    () => legalCases.find((c) => c.id === legalCaseId) || null,
    [legalCases, legalCaseId]
  );

  const availableLegalSubFolders = useMemo(() => {
    if (selectedLegalCase && Array.isArray(selectedLegalCase.subFolders) && selectedLegalCase.subFolders.length > 0) {
      return selectedLegalCase.subFolders;
    }
    return getProvisionedLegalSubFolders('LOGISTICS_CRIMINAL');
  }, [selectedLegalCase]);

  const availableCompanyFolders = useMemo(() => {
    const base = MASTER_COMPANY_DOC_FOLDERS.filter((f) => !f.isSecureVault).map((f) => f.title);
    return Array.from(new Set([...base, ...customMasterFolders]));
  }, [customMasterFolders]);

  const selectedAssetConfig = useMemo(
    () => ASSETS_SUBFOLDERS.find((g) => g.id === assetGroup) || ASSETS_SUBFOLDERS[0],
    [assetGroup]
  );

  const readFilesIntoState = async (fileList: FileList | File[]) => {
    const rawArray = Array.from(fileList);
    if (rawArray.length === 0) return;

    const allowed = rawArray.filter(isAllowedPdfOrImageFile);
    if (allowed.length === 0) {
      setValidationError('Only PDF and Image files (JPG, PNG, WEBP) can be uploaded.');
      return;
    }
    if (allowed.length < rawArray.length) {
      setValidationError('Unsupported files were skipped. Only PDF and Image formats are allowed.');
    } else {
      setValidationError(null);
    }

    const parsed: UploadFileEntry[] = [];
    for (const file of allowed) {
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const fallbackMime = file.name.toLowerCase().endsWith('.pdf')
            ? 'application/pdf'
            : 'image/jpeg';
          parsed.push({
            name: file.name,
            dataUrl: String(ev.target?.result || ''),
            type: file.type || fallbackMime,
            size: file.size
          });
          resolve();
        };
        reader.onerror = () => resolve();
        reader.readAsDataURL(file);
      });
    }

    setUploadedFiles((prev) => [...prev, ...parsed]);
    setTitle((prevTitle) => {
      if (prevTitle.trim()) return prevTitle;
      const firstFileName = parsed[0]?.name || '';
      return firstFileName.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    setValidationError(null);
    setActivePreviewIdx(0);

    if (editingDocument) {
      const cat: CorporateRootCategory =
        editingDocument.rootCategory && editingDocument.rootCategory !== 'Finance'
          ? editingDocument.rootCategory
          : defaultRootCategory !== 'Finance'
            ? defaultRootCategory
            : 'Company Documents';

      setRootCategory(cat);
      setLegalCaseId(editingDocument.legalCaseId || defaultLegalCaseId || legalCases[0]?.id || '');
      setSubFolder(editingDocument.subFolder || defaultSubFolder || 'SECP');
      setTaxAuthority(editingDocument.taxAuthority || defaultTaxAuthority || 'FBR');
      setTaxYear(editingDocument.taxYear || defaultTaxYear || currentYearStr);
      setAssetGroup(editingDocument.assetGroup || defaultAssetGroup || 'Security Deposits Tracking');
      setAssetSubType(editingDocument.assetSubType || 'Bank Guarantee');
      setAssetValuationPkr(
        editingDocument.assetValuationPkr ? String(editingDocument.assetValuationPkr) : ''
      );
      setAssetLocationOrBank(editingDocument.assetLocationOrBank || '');
      setQuotationClientName(editingDocument.quotationClientName || '');
      setQuotationServiceType(editingDocument.quotationServiceType || 'Bonded Carrier');
      setQuotationStatus(editingDocument.quotationStatus || 'Pending');
      setQuotationAmountPkr(
        editingDocument.quotationAmountPkr ? String(editingDocument.quotationAmountPkr) : ''
      );

      setTitle(editingDocument.title || '');
      setReferenceNo(editingDocument.referenceNo || '');
      setSenderIssuer(
        editingDocument.senderIssuer || editingDocument.sourceOrigin || editingDocument.from || ''
      );
      setRecipientEntity(
        editingDocument.recipientEntity || editingDocument.issuedTo || editingDocument.to || 'MAK Group'
      );
      const docIso =
        editingDocument.issuanceDate ||
        editingDocument.creationDate ||
        editingDocument.documentDate ||
        todayIso;
      setIssuanceDate(docIso);

      const expStr = editingDocument.validityEndDate || editingDocument.expiryDate || '';
      const hasExp =
        editingDocument.unlimitedValidity !== undefined
          ? !editingDocument.unlimitedValidity
          : Boolean(expStr);
      setUnlimitedValidity(!hasExp);
      setValidityStartDate(editingDocument.validityStartDate || docIso);
      setValidityEndDate(hasExp ? expStr : '');
      setAlarmDaysBefore(
        typeof editingDocument.alarmDaysBefore === 'number' && editingDocument.alarmDaysBefore > 0
          ? editingDocument.alarmDaysBefore
          : 15
      );

      const hearStr = editingDocument.hearingDate || '';
      const hasHear = Boolean(editingDocument.hearingRequired || editingDocument.hasHearingDate || hearStr);
      setHearingRequired(hasHear);
      setHearingDate(hasHear ? hearStr : '');
      setHearingTime(editingDocument.hearingTime || '');
      setHearingNotes(editingDocument.hearingNotes || '');
      setStatusTag(editingDocument.statusTag || 'Active');
      setNotes(editingDocument.notes || '');
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

    // Fresh Upload Initialization
    const initialRoot: CorporateRootCategory =
      defaultRootCategory === 'Finance' ? 'Company Documents' : defaultRootCategory;
    setRootCategory(initialRoot);
    const initialCaseId = defaultLegalCaseId || legalCases[0]?.id || '';
    setLegalCaseId(initialCaseId);

    if (initialRoot === 'Legal') {
      const targetCase = legalCases.find((c) => c.id === initialCaseId);
      setSubFolder(
        defaultSubFolder ||
          targetCase?.subFolders?.[0] ||
          getProvisionedLegalSubFolders('LOGISTICS_CRIMINAL')[0]
      );
    } else if (initialRoot === 'Company Documents') {
      setSubFolder(defaultSubFolder || 'SECP');
    } else {
      setSubFolder(defaultSubFolder || '');
    }

    setTaxAuthority(defaultTaxAuthority || 'FBR');
    setTaxYear(defaultTaxYear || currentYearStr);
    const initAssetGroup = defaultAssetGroup || 'Security Deposits Tracking';
    setAssetGroup(initAssetGroup);
    const foundAsset = ASSETS_SUBFOLDERS.find((g) => g.id === initAssetGroup) || ASSETS_SUBFOLDERS[0];
    setAssetSubType(foundAsset.subTypes[0]);
    setAssetValuationPkr('');
    setAssetLocationOrBank('');
    setQuotationClientName('');
    setQuotationServiceType('Bonded Carrier');
    setQuotationStatus('Pending');
    setQuotationAmountPkr('');

    setTitle('');
    setReferenceNo('');
    setSenderIssuer(initialRoot === 'Tax' ? (defaultTaxAuthority || 'FBR') : '');
    setRecipientEntity('MAK Group');
    setIssuanceDate(todayIso);
    setUnlimitedValidity(true);
    setValidityStartDate(todayIso);
    setValidityEndDate('');
    setAlarmDaysBefore(15);
    setHearingRequired(false);
    setHearingDate('');
    setHearingTime('');
    setHearingNotes('');
    setStatusTag('Active');
    setNotes('');
    setUploadedFiles([]);
    setExistingResolvedUrl('');

    if (preDroppedFiles && preDroppedFiles.length > 0) {
      readFilesIntoState(preDroppedFiles);
    }
  }, [
    isOpen,
    editingDocument,
    defaultRootCategory,
    defaultLegalCaseId,
    defaultSubFolder,
    defaultTaxAuthority,
    defaultTaxYear,
    defaultAssetGroup,
    legalCases,
    preDroppedFiles,
    todayIso,
    currentYearStr
  ]);

  const remainingExpiryDays = useMemo(() => {
    if (unlimitedValidity || !validityEndDate) return null;
    const endMs = new Date(`${validityEndDate}T00:00:00`).getTime();
    const todayMs = new Date(`${todayIso}T00:00:00`).getTime();
    if (isNaN(endMs)) return null;
    return Math.ceil((endMs - todayMs) / (24 * 60 * 60 * 1000));
  }, [unlimitedValidity, validityEndDate, todayIso]);

  const remainingHearingDays = useMemo(() => {
    if (!hearingRequired || !hearingDate) return null;
    const hearMs = new Date(`${hearingDate}T00:00:00`).getTime();
    const todayMs = new Date(`${todayIso}T00:00:00`).getTime();
    if (isNaN(hearMs)) return null;
    return Math.ceil((hearMs - todayMs) / (24 * 60 * 60 * 1000));
  }, [hearingRequired, hearingDate, todayIso]);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await readFilesIntoState(e.dataTransfer.files);
    }
  };

  const computedHierarchyPath = useMemo(() => {
    if (rootCategory === 'Legal') {
      const cTitle = selectedLegalCase?.identifier || 'Unassigned Legal Dossier';
      return `Dashboard > Legal > ${cTitle} > ${subFolder || 'Proceedings'}`;
    }
    if (rootCategory === 'Tax') {
      return `Dashboard > Tax > ${taxAuthority} > Year ${taxYear}`;
    }
    if (rootCategory === 'Assets') {
      return `Dashboard > Assets > ${assetGroup}`;
    }
    if (rootCategory === 'Quotations') {
      return `Dashboard > Quotations > ${quotationStatus}`;
    }
    return `Dashboard > Company Documents > ${subFolder || 'SECP'}`;
  }, [
    rootCategory,
    selectedLegalCase,
    subFolder,
    taxAuthority,
    taxYear,
    assetGroup,
    quotationStatus
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const hasAttachment =
      uploadedFiles.length > 0 || Boolean(editingDocument?.fileUrl || existingResolvedUrl);
    if (!hasAttachment) {
      setValidationError('Please attach or drop a PDF or Image document to upload.');
      return;
    }
    if (!title.trim()) {
      setValidationError('Please enter the Document Title.');
      return;
    }
    if (rootCategory === 'Legal' && !legalCaseId) {
      setValidationError('Please create or select a Legal Case Dossier before uploading a Legal document.');
      return;
    }
    if (rootCategory === 'Quotations' && !quotationClientName.trim()) {
      setValidationError('Please enter the Client Name for this Quotation.');
      return;
    }
    if (!senderIssuer.trim()) {
      setValidationError('Please enter the Sender / Issuing Authority.');
      return;
    }
    if (!recipientEntity) {
      setValidationError('Please select the Recipient Entity.');
      return;
    }
    if (!issuanceDate) {
      setValidationError('Please select the Issuance Date.');
      return;
    }
    if (!unlimitedValidity && !validityEndDate) {
      setValidationError('Please select the Validity End / Expiry Date, or set Validity to No Expiry.');
      return;
    }
    if (hearingRequired && !hearingDate) {
      setValidationError('Please select the Hearing / Action Date, or set Hearing Required to No.');
      return;
    }

    setIsSaving(true);
    try {
      const primaryUpload = uploadedFiles[0];
      const extraUploads = uploadedFiles.slice(1).map((f) => ({
        name: f.name,
        url: f.dataUrl,
        type: f.type,
        size: f.size
      }));

      const isExpiredNow =
        !unlimitedValidity && remainingExpiryDays !== null && remainingExpiryDays <= 0;

      const resolvedStatus: CorporateDocumentStatus =
        statusTag === 'Resolved' || statusTag === 'Archived'
          ? statusTag
          : isExpiredNow
            ? 'Expired'
            : hearingRequired
              ? 'Pending Hearing'
              : statusTag;

      const docRecord: CompanyDocument = {
        ...(editingDocument || {}),
        id:
          editingDocument?.id ||
          `cdoc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        rootCategory,
        category: rootCategory,
        folderPath: computedHierarchyPath,
        legalCaseId: rootCategory === 'Legal' ? legalCaseId : undefined,
        legalCaseTitle: rootCategory === 'Legal' ? selectedLegalCase?.identifier : undefined,
        legalCaseTrack: rootCategory === 'Legal' ? selectedLegalCase?.caseTrack : undefined,
        subFolder:
          rootCategory === 'Legal' || rootCategory === 'Company Documents'
            ? subFolder
            : undefined,
        taxAuthority: rootCategory === 'Tax' ? taxAuthority : undefined,
        taxYear: rootCategory === 'Tax' ? taxYear.trim() : editSafeTaxYear(rootCategory, taxYear),
        assetGroup: rootCategory === 'Assets' ? assetGroup : undefined,
        assetSubType: rootCategory === 'Assets' ? assetSubType : undefined,
        assetValuationPkr:
          rootCategory === 'Assets' && Number(assetValuationPkr) > 0
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
        quotationStatus: rootCategory === 'Quotations' ? quotationStatus : undefined,
        quotationAmountPkr:
          rootCategory === 'Quotations' && Number(quotationAmountPkr) > 0
            ? Number(quotationAmountPkr)
            : undefined,

        // Universal Document Metadata
        title: title.trim(),
        referenceNo: referenceNo.trim() || undefined,
        senderIssuer: senderIssuer.trim(),
        sourceOrigin: senderIssuer.trim(),
        from: senderIssuer.trim(),
        recipientEntity,
        issuedTo: String(recipientEntity),
        to: String(recipientEntity),
        issuanceDate,
        creationDate: issuanceDate,
        documentDate: issuanceDate,
        issueDate: issuanceDate,
        unlimitedValidity,
        hasExpiryDate: !unlimitedValidity,
        hasExpiry: !unlimitedValidity,
        validityStartDate: !unlimitedValidity ? validityStartDate || issuanceDate : issuanceDate,
        validityEndDate: !unlimitedValidity ? validityEndDate : undefined,
        expiryDate: !unlimitedValidity ? validityEndDate : undefined,
        alarmDaysBefore: Number(alarmDaysBefore) > 0 ? Number(alarmDaysBefore) : 15,
        hearingRequired,
        hasHearingDate: hearingRequired,
        hearingDate: hearingRequired ? hearingDate : undefined,
        hearingTime: hearingRequired && hearingTime ? hearingTime : undefined,
        hearingNotes: hearingRequired && hearingNotes.trim() ? hearingNotes.trim() : undefined,
        statusTag: resolvedStatus,
        notes: notes.trim() || undefined,

        // File Attachment Pointers
        fileUrl: primaryUpload ? primaryUpload.dataUrl : editingDocument?.fileUrl,
        fileName: primaryUpload ? primaryUpload.name : editingDocument?.fileName,
        fileType: primaryUpload ? primaryUpload.type : editingDocument?.fileType,
        fileSize: primaryUpload ? primaryUpload.size : editingDocument?.fileSize,
        additionalFiles:
          extraUploads.length > 0
            ? [...(editingDocument?.additionalFiles || []), ...extraUploads]
            : editingDocument?.additionalFiles,
        uploadedAt: editingDocument?.uploadedAt || new Date().toISOString(),
        createdByAuthor:
          editingDocument?.createdByAuthor ||
          safeAppStorage.getItem('dpl_current_user_name') ||
          'Authorized User',
        uploadedBy:
          editingDocument?.uploadedBy ||
          safeAppStorage.getItem('dpl_current_user_name') ||
          'Authorized User'
      };

      await onSave(docRecord);
      onClose();
    } catch (err: any) {
      setValidationError(err?.message || 'Unable to save document. Please try again.');
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
    /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(previewName);
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
                {editingDocument ? 'Edit Corporate Document & Metadata' : 'Upload Corporate Document & Metadata'}
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 truncate">
                <FolderOpen size={12} className="text-amber-400 shrink-0" />
                <span className="truncate" title={computedHierarchyPath}>
                  {computedHierarchyPath}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mak-btn-secondary p-2 rounded-lg text-gray-300 hover:text-white cursor-pointer shrink-0"
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

        {/* Two-Column Body: Left = Drag-and-Drop Zone + Instant Live Preview | Right = Universal Metadata Form */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left Column */}
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
                accept=".pdf,application/pdf,image/*"
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
                Drag & Drop PDF or Image File Here, or Click to Browse
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Supports multi-page PDFs and high-resolution scanned images (JPG, PNG, WEBP)
              </p>
            </div>

            {uploadedFiles.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-gray-400">
                  Selected Files ({uploadedFiles.length})
                </div>
                <div className="space-y-1.5 max-h-28 overflow-y-auto">
                  {uploadedFiles.map((file, idx) => {
                    const isImg = file.type.startsWith('image/');
                    return (
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
                          {isImg ? (
                            <ImageIcon size={13} className="text-emerald-400 shrink-0" />
                          ) : (
                            <Paperclip size={13} className="text-sky-400 shrink-0" />
                          )}
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
                          className="text-gray-400 hover:text-rose-400 p-0.5 cursor-pointer shrink-0"
                          title="Remove file"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Live Instant Preview */}
            <div className="flex-1 min-h-[260px] rounded-xl border border-white/10 bg-slate-950 overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b border-white/10 bg-slate-900/80 flex items-center justify-between text-[11px] text-gray-400">
                <div className="flex items-center gap-1.5 font-semibold text-gray-300">
                  <Eye size={13} className="text-sky-400" />
                  <span>Instant Document Preview</span>
                </div>
                <span className="font-mono truncate max-w-[180px]">
                  {activeFile?.name || editingDocument?.fileName || 'No file attached'}
                </span>
              </div>

              <div className="flex-1 flex items-center justify-center p-2 bg-slate-950 overflow-auto">
                {!previewSrc ? (
                  <div className="text-center p-6 space-y-1.5">
                    <FileText size={28} className="mx-auto text-gray-600" />
                    <p className="text-xs text-gray-400 font-medium">No file selected yet</p>
                    <p className="text-[11px] text-gray-500">
                      Drop or select a PDF or image above to inspect it while tagging metadata.
                    </p>
                  </div>
                ) : isImagePreview ? (
                  <img
                    src={previewSrc}
                    alt="Document preview"
                    referrerPolicy="no-referrer"
                    className="max-h-[340px] w-auto object-contain rounded-lg border border-white/10"
                  />
                ) : isPdfPreview ? (
                  <iframe
                    src={previewSrc}
                    title="PDF Document Preview"
                    className="w-full h-[340px] rounded-lg border border-white/10 bg-white"
                  />
                ) : (
                  <div className="text-center p-6 space-y-1.5">
                    <FileText size={28} className="mx-auto text-sky-400" />
                    <p className="text-xs font-semibold text-white">
                      {activeFile?.name || editingDocument?.fileName || 'Document Attached'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Category Coordinates + Mandatory Universal Metadata */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4">
            {/* Target Root Category & Dynamic Sub-Folder Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-3 border-b border-white/10">
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Primary Category *
                </label>
                <select
                  value={rootCategory}
                  onChange={(e) => {
                    const nextCat = e.target.value as CorporateRootCategory;
                    setRootCategory(nextCat);
                    if (nextCat === 'Legal') {
                      const cObj = legalCases.find((c) => c.id === legalCaseId) || legalCases[0];
                      if (cObj) {
                        setLegalCaseId(cObj.id);
                        setSubFolder(cObj.subFolders?.[0] || 'Police FIR & Proceedings');
                      }
                    } else if (nextCat === 'Company Documents') {
                      setSubFolder('SECP');
                    }
                  }}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                >
                  <option value="Legal">Legal</option>
                  <option value="Tax">Tax</option>
                  <option value="Assets">Assets</option>
                  <option value="Company Documents">Company Documents</option>
                  <option value="Quotations">Quotations</option>
                </select>
              </div>

              {rootCategory === 'Legal' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Legal Case Dossier *
                    </label>
                    <select
                      value={legalCaseId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setLegalCaseId(nextId);
                        const nextCase = legalCases.find((c) => c.id === nextId);
                        if (nextCase?.subFolders?.[0]) setSubFolder(nextCase.subFolders[0]);
                      }}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      {legalCases.length === 0 ? (
                        <option value="">Create a Legal Case first</option>
                      ) : (
                        legalCases.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.identifier}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Proceedings Sub-Folder *
                    </label>
                    <select
                      value={subFolder}
                      onChange={(e) => setSubFolder(e.target.value)}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      {availableLegalSubFolders.map((sf) => (
                        <option key={sf} value={sf}>
                          {sf}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {rootCategory === 'Tax' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Regulatory Authority *
                    </label>
                    <select
                      value={taxAuthority}
                      onChange={(e) => {
                        setTaxAuthority(e.target.value);
                        if (!senderIssuer || ['FBR', 'SRB', 'Labour Department'].includes(senderIssuer)) {
                          setSenderIssuer(e.target.value);
                        }
                      }}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      {TAX_AUTHORITIES.map((auth) => (
                        <option key={auth.id} value={auth.id}>
                          {auth.title} — {auth.fullName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Tax / Fiscal Year *
                    </label>
                    <input
                      type="text"
                      list="corporate-fiscal-years"
                      value={taxYear}
                      onChange={(e) => setTaxYear(e.target.value)}
                      placeholder="e.g., 2026"
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                    />
                    <datalist id="corporate-fiscal-years">
                      {DEFAULT_FISCAL_YEARS.map((y) => (
                        <option key={y} value={y} />
                      ))}
                    </datalist>
                  </div>
                </>
              )}

              {rootCategory === 'Assets' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Asset Catalog Group *
                    </label>
                    <select
                      value={assetGroup}
                      onChange={(e) => {
                        const nextGroup = e.target.value;
                        setAssetGroup(nextGroup);
                        const cfg = ASSETS_SUBFOLDERS.find((g) => g.id === nextGroup);
                        if (cfg?.subTypes?.[0]) setAssetSubType(cfg.subTypes[0]);
                      }}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      {ASSETS_SUBFOLDERS.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Asset Classification
                    </label>
                    <select
                      value={assetSubType}
                      onChange={(e) => setAssetSubType(e.target.value)}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      {selectedAssetConfig.subTypes.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {rootCategory === 'Company Documents' && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Master Compliance Folder *
                  </label>
                  <select
                    value={subFolder}
                    onChange={(e) => setSubFolder(e.target.value)}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                  >
                    {availableCompanyFolders.map((folderName) => (
                      <option key={folderName} value={folderName}>
                        {folderName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {rootCategory === 'Quotations' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Client Name *
                    </label>
                    <input
                      type="text"
                      value={quotationClientName}
                      onChange={(e) => setQuotationClientName(e.target.value)}
                      placeholder="Client or organization name"
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-200 mb-1">
                      Quotation Status *
                    </label>
                    <select
                      value={quotationStatus}
                      onChange={(e) => setQuotationStatus(e.target.value as QuotationStatus)}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                    >
                      {QUOTATION_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            {/* Extra Asset / Quotation Financial Row */}
            {rootCategory === 'Assets' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Deposit / Asset Valuation (PKR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={assetValuationPkr}
                    onChange={(e) => setAssetValuationPkr(e.target.value)}
                    placeholder="Optional value in PKR"
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Bank / Port Authority / Property Location
                  </label>
                  <input
                    type="text"
                    value={assetLocationOrBank}
                    onChange={(e) => setAssetLocationOrBank(e.target.value)}
                    placeholder="Bank branch, port authority, or address"
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                  />
                </div>
              </div>
            )}

            {rootCategory === 'Quotations' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Service Type *
                  </label>
                  <select
                    value={quotationServiceType}
                    onChange={(e) => setQuotationServiceType(e.target.value)}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                  >
                    {QUOTATION_SERVICE_TYPES.map((srv) => (
                      <option key={srv} value={srv}>
                        {srv}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-200 mb-1">
                    Quoted Commercial Tariff (PKR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quotationAmountPkr}
                    onChange={(e) => setQuotationAmountPkr(e.target.value)}
                    placeholder="Quoted tariff amount in PKR"
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                  />
                </div>
              </div>
            )}

            {/* Document Title & Reference Number */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Document Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Official document title or filing subject"
                  className="glass-input w-full rounded-xl px-3.5 py-2 text-xs sm:text-sm outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Reference / Order No.
                </label>
                <input
                  type="text"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  placeholder="Optional reference number"
                  className="glass-input w-full rounded-xl px-3.5 py-2 text-xs sm:text-sm font-mono outline-none"
                />
              </div>
            </div>

            {/* Universal Metadata: Sender / Issuer & Recipient Entity */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Sender / Issuing Authority *
                </label>
                <input
                  type="text"
                  value={senderIssuer}
                  onChange={(e) => setSenderIssuer(e.target.value)}
                  placeholder="Issuing authority, court, regulator, bank, or client"
                  className="glass-input w-full rounded-xl px-3.5 py-2 text-xs sm:text-sm outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Recipient Entity *
                </label>
                <select
                  value={recipientEntity}
                  onChange={(e) => setRecipientEntity(e.target.value)}
                  className="glass-input w-full rounded-xl px-3.5 py-2 text-xs sm:text-sm outline-none"
                >
                  {RECIPIENT_ENTITIES.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Issuance Date, Tax/Report Year (optional outside Tax), & Status Tag */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Issuance Date *
                </label>
                <input
                  type="date"
                  value={issuanceDate}
                  onChange={(e) => setIssuanceDate(e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Tax / Report Year
                </label>
                <input
                  type="text"
                  value={taxYear}
                  onChange={(e) => setTaxYear(e.target.value)}
                  placeholder="e.g., 2026"
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1">
                  Status Tag *
                </label>
                <select
                  value={statusTag}
                  onChange={(e) => setStatusTag(e.target.value as CorporateDocumentStatus)}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                >
                  {DOCUMENT_STATUS_TAGS.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Validity Period & Smart Expiry Alarm */}
            <div className="pt-2.5 border-t border-white/10 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                  <Calendar size={14} className="text-amber-400 shrink-0" />
                  <span>Validity Period & Smart Expiry Alarm</span>
                </label>
                <div
                  data-custom-control="true"
                  className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-white/10 self-start"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setUnlimitedValidity(true);
                      setValidityEndDate('');
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      unlimitedValidity
                        ? 'bg-sky-500 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Perpetual / No Expiry
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnlimitedValidity(false)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      !unlimitedValidity
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Has Validity / Expiry
                  </button>
                </div>
              </div>

              {!unlimitedValidity && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">
                      Validity Start Date
                    </label>
                    <input
                      type="date"
                      value={validityStartDate}
                      onChange={(e) => setValidityStartDate(e.target.value)}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">
                      Validity End / Expiry Date *
                    </label>
                    <input
                      type="date"
                      value={validityEndDate}
                      onChange={(e) => setValidityEndDate(e.target.value)}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                      required={!unlimitedValidity}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1 flex items-center gap-1">
                      <Bell size={11} className="text-amber-400" />
                      <span>Alarm Lead Days Before Expiry</span>
                    </label>
                    <select
                      value={alarmDaysBefore}
                      onChange={(e) => setAlarmDaysBefore(Number(e.target.value))}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                    >
                      <option value={7}>7 Days Before Expiry</option>
                      <option value={15}>15 Days Before Expiry</option>
                      <option value={30}>30 Days Before Expiry</option>
                      <option value={60}>60 Days Before Expiry</option>
                    </select>
                  </div>

                  {remainingExpiryDays !== null && (
                    <div className="sm:col-span-3 text-xs font-mono tabular-nums">
                      {remainingExpiryDays < 0 ? (
                        <span className="text-rose-400 font-semibold">
                          Document expired {Math.abs(remainingExpiryDays)} day(s) ago — Expiry alert active
                        </span>
                      ) : remainingExpiryDays === 0 ? (
                        <span className="text-rose-400 font-semibold">
                          Document expires today — Urgent renewal alert active
                        </span>
                      ) : (
                        <span
                          className={
                            remainingExpiryDays <= alarmDaysBefore
                              ? 'text-amber-400 font-semibold'
                              : 'text-emerald-400 font-semibold'
                          }
                        >
                          {remainingExpiryDays} day(s) remaining until expiration
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Hearing / Action Date Countdown Alarm */}
            <div className="pt-2.5 border-t border-white/10 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                  <Gavel size={14} className="text-sky-400 shrink-0" />
                  <span>Scheduled Hearing / Legal Action Date</span>
                </label>
                <div
                  data-custom-control="true"
                  className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-white/10 self-start"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setHearingRequired(false);
                      setHearingDate('');
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      !hearingRequired
                        ? 'bg-sky-500 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    No Hearing
                  </button>
                  <button
                    type="button"
                    onClick={() => setHearingRequired(true)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      hearingRequired
                        ? 'bg-sky-500 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Scheduled Hearing
                  </button>
                </div>
              </div>

              {hearingRequired && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">
                      Hearing / Action Date *
                    </label>
                    <input
                      type="date"
                      value={hearingDate}
                      onChange={(e) => setHearingDate(e.target.value)}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                      required={hearingRequired}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">
                      Hearing Time (Optional)
                    </label>
                    <input
                      type="time"
                      value={hearingTime}
                      onChange={(e) => setHearingTime(e.target.value)}
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">
                      Court / Authority Action Note
                    </label>
                    <input
                      type="text"
                      value={hearingNotes}
                      onChange={(e) => setHearingNotes(e.target.value)}
                      placeholder="Bench, collectorate, or counsel note"
                      className="glass-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                    />
                  </div>

                  {remainingHearingDays !== null && (
                    <div className="sm:col-span-3 text-xs font-mono tabular-nums">
                      {remainingHearingDays < 0 ? (
                        <span className="text-rose-400 font-semibold">
                          Scheduled hearing date passed {Math.abs(remainingHearingDays)} day(s) ago
                        </span>
                      ) : remainingHearingDays === 0 ? (
                        <span className="text-amber-400 font-semibold">
                          Hearing scheduled TODAY
                        </span>
                      ) : (
                        <span className="text-sky-400 font-semibold">
                          Countdown: {remainingHearingDays} day(s) remaining until hearing
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Action Buttons */}
            <div className="pt-4 border-t border-white/10 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
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
                    ? 'Saving Document...'
                    : editingDocument
                      ? 'Update Document'
                      : 'Upload & Save Document'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

function editSafeTaxYear(rootCat: CorporateRootCategory, rawYear: string): string | undefined {
  const clean = (rawYear || '').trim();
  if (rootCat === 'Tax') return clean || String(new Date().getFullYear());
  return clean || undefined;
}

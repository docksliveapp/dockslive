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
  Check
} from 'lucide-react';
import { CompanyDocument } from '../types';
import { resolveStoredDocumentDataUrl } from '../services/documentStorage';
import { safeAppStorage } from '../services/storage';

export interface CompanyDocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (doc: CompanyDocument) => Promise<void>;
  currentFolderId: string | null;
  currentFolderPathLabel: string;
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
  currentFolderId,
  currentFolderPathLabel,
  editingDocument,
  preDroppedFiles
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);

  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadFileEntry[]>([]);
  const [activePreviewIdx, setActivePreviewIdx] = useState(0);
  const [existingResolvedUrl, setExistingResolvedUrl] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // The Exact 7 Document Metadata Fields
  const [title, setTitle] = useState<string>('');
  const [createdByAuthor, setCreatedByAuthor] = useState<string>('');
  const [sourceOrigin, setSourceOrigin] = useState<string>('');
  const [creationDate, setCreationDate] = useState<string>(todayIso);
  const [hasExpiryDate, setHasExpiryDate] = useState<boolean>(false);
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [hasHearingDate, setHasHearingDate] = useState<boolean>(false);
  const [hearingDate, setHearingDate] = useState<string>('');
  const [issuedTo, setIssuedTo] = useState<string>('');

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
      setTitle(editingDocument.title || '');
      setCreatedByAuthor(editingDocument.createdByAuthor || editingDocument.uploadedBy || '');
      setSourceOrigin(editingDocument.sourceOrigin || editingDocument.senderIssuer || editingDocument.from || '');
      setCreationDate(
        editingDocument.creationDate ||
          editingDocument.issuanceDate ||
          editingDocument.documentDate ||
          todayIso
      );

      const effectiveExp = editingDocument.expiryDate || editingDocument.validityEndDate || '';
      const hasExp =
        editingDocument.hasExpiryDate !== undefined
          ? editingDocument.hasExpiryDate
          : Boolean(effectiveExp) && !editingDocument.unlimitedValidity;
      setHasExpiryDate(hasExp);
      setExpiryDate(hasExp ? effectiveExp : '');

      const effectiveHear = editingDocument.hearingDate || '';
      const hasHear =
        editingDocument.hasHearingDate !== undefined
          ? editingDocument.hasHearingDate
          : Boolean(effectiveHear);
      setHasHearingDate(hasHear);
      setHearingDate(hasHear ? effectiveHear : '');

      setIssuedTo(editingDocument.issuedTo || editingDocument.recipientEntity || editingDocument.to || '');
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

    // Fresh upload state
    setTitle('');
    setCreatedByAuthor('');
    setSourceOrigin('');
    setCreationDate(todayIso);
    setHasExpiryDate(false);
    setExpiryDate('');
    setHasHearingDate(false);
    setHearingDate('');
    setIssuedTo('');
    setUploadedFiles([]);
    setExistingResolvedUrl('');

    if (preDroppedFiles && preDroppedFiles.length > 0) {
      readFilesIntoState(preDroppedFiles);
    }
  }, [isOpen, editingDocument, preDroppedFiles, todayIso]);

  const remainingExpiryDays = useMemo(() => {
    if (!hasExpiryDate || !expiryDate) return null;
    const endMs = new Date(`${expiryDate}T00:00:00`).getTime();
    const todayMs = new Date(`${todayIso}T00:00:00`).getTime();
    if (isNaN(endMs)) return null;
    return Math.ceil((endMs - todayMs) / (24 * 60 * 60 * 1000));
  }, [hasExpiryDate, expiryDate, todayIso]);

  const remainingHearingDays = useMemo(() => {
    if (!hasHearingDate || !hearingDate) return null;
    const hearMs = new Date(`${hearingDate}T00:00:00`).getTime();
    const todayMs = new Date(`${todayIso}T00:00:00`).getTime();
    if (isNaN(hearMs)) return null;
    return Math.ceil((hearMs - todayMs) / (24 * 60 * 60 * 1000));
  }, [hasHearingDate, hearingDate, todayIso]);

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

    const hasAttachment =
      uploadedFiles.length > 0 || Boolean(editingDocument?.fileUrl || existingResolvedUrl);
    if (!hasAttachment) {
      setValidationError('Please select or drop a PDF or Image document to upload.');
      return;
    }
    if (!title.trim()) {
      setValidationError('Please enter the Document Title.');
      return;
    }
    if (!createdByAuthor.trim()) {
      setValidationError('Please enter who created or prepared this document.');
      return;
    }
    if (!sourceOrigin.trim()) {
      setValidationError('Please enter the source or origin where this document came from.');
      return;
    }
    if (!creationDate) {
      setValidationError('Please select the Document Creation Date.');
      return;
    }
    if (hasExpiryDate && !expiryDate) {
      setValidationError('Please select the Valid Until / Expiry Date, or mark the document as No Expiry.');
      return;
    }
    if (hasHearingDate && !hearingDate) {
      setValidationError('Please select the Scheduled Hearing Date, or switch Scheduled Hearing to No.');
      return;
    }
    if (!issuedTo.trim()) {
      setValidationError('Please enter to whom this document was issued or in whose name it stands.');
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

      const targetFolderId =
        editingDocument && editingDocument.parentFolderId !== undefined
          ? editingDocument.parentFolderId
          : currentFolderId;

      const targetPathLabel =
        editingDocument && editingDocument.folderPath
          ? editingDocument.folderPath
          : currentFolderPathLabel;

      const isExpiredNow =
        hasExpiryDate && remainingExpiryDays !== null && remainingExpiryDays <= 0;

      const docRecord: CompanyDocument = {
        ...(editingDocument || {}),
        id:
          editingDocument?.id ||
          `expdoc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        isExplorerDocument: true,
        parentFolderId: targetFolderId || null,
        folderPath: targetPathLabel || 'Company Documents',
        category: targetPathLabel || 'Company Documents',
        // Exact 7 Document Metadata Fields
        title: title.trim(),
        createdByAuthor: createdByAuthor.trim(),
        sourceOrigin: sourceOrigin.trim(),
        creationDate,
        hasExpiryDate,
        expiryDate: hasExpiryDate ? expiryDate : undefined,
        hasHearingDate,
        hearingDate: hasHearingDate ? hearingDate : undefined,
        issuedTo: issuedTo.trim(),
        // Synced compatibility & smart notification fields
        senderIssuer: sourceOrigin.trim(),
        from: sourceOrigin.trim(),
        recipientEntity: issuedTo.trim(),
        to: issuedTo.trim(),
        issuanceDate: creationDate,
        documentDate: creationDate,
        issueDate: creationDate,
        unlimitedValidity: !hasExpiryDate,
        hasExpiry: hasExpiryDate,
        validityStartDate: creationDate,
        validityEndDate: hasExpiryDate ? expiryDate : undefined,
        hearingRequired: hasHearingDate,
        alarmDaysBefore: 15,
        statusTag: isExpiredNow
          ? 'Expired'
          : hasHearingDate
            ? 'Pending Hearing'
            : 'Active',
        // Attachment storage
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
          createdByAuthor.trim()
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

  const displayTargetFolder =
    editingDocument?.folderPath || currentFolderPathLabel || 'Company Documents';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-5xl max-h-[94vh] bg-slate-950 border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-900 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center shrink-0">
              <Upload size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-white truncate">
                {editingDocument ? 'Edit Document Details' : 'Upload File'}
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 truncate">
                <FolderOpen size={12} className="text-amber-400 shrink-0" />
                <span className="truncate" title={displayTargetFolder}>
                  Location: {displayTargetFolder}
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

        {/* Split Body: Left = PDF / Picture Upload & Live Preview | Right = Exact 7 Document Fields */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left Column: File Picker & Live Document Preview */}
          <div className="w-full lg:w-[42%] border-b lg:border-b-0 lg:border-r border-white/10 p-4 sm:p-5 flex flex-col gap-3.5 overflow-y-auto bg-slate-900/40">
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
                Select or Drop PDF / Image Document
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Accepted formats: PDF (.pdf) and Images (JPG, PNG, WEBP)
              </p>
            </div>

            {uploadedFiles.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-gray-400">
                  Selected Document Files ({uploadedFiles.length})
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

            {/* Live Document Preview */}
            <div className="flex-1 min-h-[250px] rounded-xl border border-white/10 bg-slate-950 overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b border-white/10 bg-slate-900/80 flex items-center justify-between text-[11px] text-gray-400">
                <div className="flex items-center gap-1.5 font-semibold text-gray-300">
                  <Eye size={13} className="text-sky-400" />
                  <span>Document Preview</span>
                </div>
                <span className="font-mono truncate max-w-[180px]">
                  {activeFile?.name || editingDocument?.fileName || 'No file attached'}
                </span>
              </div>

              <div className="flex-1 flex items-center justify-center p-2 bg-slate-950 overflow-auto">
                {!previewSrc ? (
                  <div className="text-center p-6 space-y-1.5">
                    <FileText size={28} className="mx-auto text-gray-600" />
                    <p className="text-xs text-gray-400 font-medium">No document attached yet</p>
                    <p className="text-[11px] text-gray-500">
                      Attach a PDF or picture file above to preview it while entering document details.
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

          {/* Right Column: Exact 7 Document Metadata Fields */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4">
            {/* 1. Document Title */}
            <div>
              <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                1. Document Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter any custom title for this document"
                className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                required
              />
            </div>

            {/* 2. Created / Prepared By & 3. Source / Origin */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  2. Created / Prepared By *
                </label>
                <input
                  type="text"
                  value={createdByAuthor}
                  onChange={(e) => setCreatedByAuthor(e.target.value)}
                  placeholder="Who created or prepared this document"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  3. Document Source / Origin *
                </label>
                <input
                  type="text"
                  value={sourceOrigin}
                  onChange={(e) => setSourceOrigin(e.target.value)}
                  placeholder="Where this document came from (authority, office, or party)"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                  required
                />
              </div>
            </div>

            {/* 4. Document Creation Date */}
            <div>
              <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                4. Document Creation Date *
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={creationDate}
                  onChange={(e) => setCreationDate(e.target.value)}
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-mono tabular-nums outline-none"
                  required
                />
              </div>
            </div>

            {/* 5. Document Validity / Expiry */}
            <div className="pt-2 border-t border-white/10 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                  <Calendar size={14} className="text-amber-400 shrink-0" />
                  <span>5. Document Validity / Expiration</span>
                </label>
                <div
                  data-custom-control="true"
                  className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-white/10 self-start"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setHasExpiryDate(false);
                      setExpiryDate('');
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      !hasExpiryDate
                        ? 'bg-sky-500 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    No Expiry
                  </button>
                  <button
                    type="button"
                    onClick={() => setHasExpiryDate(true)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      hasExpiryDate
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Expires on Date
                  </button>
                </div>
              </div>

              {hasExpiryDate && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">
                      Valid Until / Expiry Date *
                    </label>
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className="glass-input w-full rounded-xl px-3.5 py-2 text-xs sm:text-sm font-mono tabular-nums outline-none"
                      required={hasExpiryDate}
                    />
                  </div>
                  <div className="text-xs text-gray-300 font-mono tabular-nums pt-2 sm:pt-5">
                    {remainingExpiryDays === null ? (
                      <span className="text-gray-400">Select the expiration date</span>
                    ) : remainingExpiryDays < 0 ? (
                      <span className="text-rose-400 font-semibold">
                        Expired {Math.abs(remainingExpiryDays)} day(s) ago
                      </span>
                    ) : remainingExpiryDays === 0 ? (
                      <span className="text-rose-400 font-semibold">Expires today</span>
                    ) : (
                      <span className="text-emerald-400 font-semibold">
                        Valid for {remainingExpiryDays} more day(s)
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 6. Scheduled Hearing According to Document */}
            <div className="pt-2 border-t border-white/10 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                  <Gavel size={14} className="text-sky-400 shrink-0" />
                  <span>6. Scheduled Hearing Date</span>
                </label>
                <div
                  data-custom-control="true"
                  className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-white/10 self-start"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setHasHearingDate(false);
                      setHearingDate('');
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      !hasHearingDate
                        ? 'bg-sky-500 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    No Hearing
                  </button>
                  <button
                    type="button"
                    onClick={() => setHasHearingDate(true)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      hasHearingDate
                        ? 'bg-sky-500 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Yes — Has Hearing
                  </button>
                </div>
              </div>

              {hasHearingDate && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">
                      Hearing Date *
                    </label>
                    <input
                      type="date"
                      value={hearingDate}
                      onChange={(e) => setHearingDate(e.target.value)}
                      className="glass-input w-full rounded-xl px-3.5 py-2 text-xs sm:text-sm font-mono tabular-nums outline-none"
                      required={hasHearingDate}
                    />
                  </div>
                  <div className="text-xs text-gray-300 font-mono tabular-nums pt-2 sm:pt-5">
                    {remainingHearingDays === null ? (
                      <span className="text-gray-400">Select the scheduled hearing date</span>
                    ) : remainingHearingDays < 0 ? (
                      <span className="text-rose-400 font-semibold">
                        Hearing passed {Math.abs(remainingHearingDays)} day(s) ago
                      </span>
                    ) : remainingHearingDays === 0 ? (
                      <span className="text-amber-400 font-semibold">Hearing scheduled today</span>
                    ) : (
                      <span className="text-sky-400 font-semibold">
                        Scheduled in {remainingHearingDays} day(s)
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 7. Issued To / In Name Of */}
            <div className="pt-2 border-t border-white/10">
              <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                7. Issued To / Addressed To / In Name Of *
              </label>
              <input
                type="text"
                value={issuedTo}
                onChange={(e) => setIssuedTo(e.target.value)}
                placeholder="Person(s), company, or party to whom this document was given or in whose name it is issued"
                className="glass-input w-full rounded-xl px-3.5 py-2.5 text-xs sm:text-sm outline-none"
                required
              />
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
                <span>{isSaving ? 'Saving Document...' : editingDocument ? 'Save Changes' : 'Save & Upload File'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

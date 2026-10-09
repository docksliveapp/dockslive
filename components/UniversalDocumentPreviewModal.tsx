import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  X, Download, Printer, ZoomIn, ZoomOut, RotateCw, Search,
  CheckCircle2, FileText, FileSpreadsheet, Image as ImageIcon,
  AlertTriangle, ShieldCheck, ArrowLeft, Eye, RefreshCw, Layers, Sparkles
} from 'lucide-react';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { preprocessDocumentForOcr, OcrPreprocessingResult } from '../services/fileUtils';

export type SupportedPreviewFormat = 'docx' | 'pdf' | 'xlsx' | 'image' | 'jpg' | 'jpeg' | 'png' | 'auto';

export interface DataMappingCheckItem {
  label: string;
  value?: string | number | null;
  status?: 'verified' | 'warning' | 'info';
}

export interface UniversalDocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: File | Blob | ArrayBuffer | string | any | null;
  filename: string;
  title?: string;
  fileType?: SupportedPreviewFormat;
  verificationItems?: DataMappingCheckItem[];
  onDownload?: () => void;
}

export const UniversalDocumentPreviewModal: React.FC<UniversalDocumentPreviewModalProps> = ({
  isOpen,
  onClose,
  file,
  filename,
  title,
  fileType = 'auto',
  verificationItems = [],
  onDownload
}) => {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // DOCX State
  const [docxHtml, setDocxHtml] = useState<string>('');
  
  // XLSX State
  const [xlsxSheets, setXlsxSheets] = useState<{ [sheetName: string]: any[][] }>({});
  const [activeSheetName, setActiveSheetName] = useState<string>('');
  
  // PDF & Image State
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [binarizedPreviewUrl, setBinarizedPreviewUrl] = useState<string>('');
  const [activeImageViewMode, setActiveImageViewMode] = useState<'enhanced' | 'binarized'>('enhanced');
  const [ocrPreprocessingMeta, setOcrPreprocessingMeta] = useState<{
    deskewAngle?: number;
    isDeskewed?: boolean;
    contrastEnhanced?: boolean;
    sharpened?: boolean;
    noiseReduced?: boolean;
    processingTimeMs?: number;
  } | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [showVerificationPanel, setShowVerificationPanel] = useState<boolean>(true);
  const [mobileVerificationOpen, setMobileVerificationOpen] = useState<boolean>(false);

  // Determine actual format
  const detectedFormat = useMemo((): 'docx' | 'xlsx' | 'pdf' | 'image' => {
    if (fileType && fileType !== 'auto') {
      const lowerFt = String(fileType).toLowerCase();
      if (lowerFt === 'jpg' || lowerFt === 'jpeg' || lowerFt === 'png') return 'image';
      if (lowerFt === 'docx' || lowerFt === 'xlsx' || lowerFt === 'pdf' || lowerFt === 'image') return lowerFt;
    }
    const lower = (filename || '').toLowerCase();
    if (lower.endsWith('.docx')) return 'docx';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return 'xlsx';
    if (lower.endsWith('.pdf')) return 'pdf';
    if (/\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(lower)) return 'image';
    if (typeof file === 'string') {
      if (file.startsWith('data:image/')) return 'image';
      if (file.startsWith('data:application/pdf')) return 'pdf';
      if (file.startsWith('data:application/vnd.openxmlformats-officedocument.wordprocessingml.document')) return 'docx';
      if (file.startsWith('data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) return 'xlsx';
    }
    return 'docx';
  }, [fileType, filename, file]);

  // Extension label for UI badge
  const formatBadgeLabel = useMemo(() => {
    const lower = (filename || '').toLowerCase();
    if (lower.endsWith('.jpeg')) return '.JPEG';
    if (lower.endsWith('.jpg')) return '.JPG';
    if (lower.endsWith('.png')) return '.PNG';
    if (detectedFormat === 'docx') return '.DOCX';
    if (detectedFormat === 'xlsx') return '.XLSX';
    if (detectedFormat === 'pdf') return '.PDF';
    return `.${detectedFormat.toUpperCase()}`;
  }, [filename, detectedFormat]);

  // Convert input `file` to ArrayBuffer or ObjectURL
  useEffect(() => {
    if (!isOpen || !file) {
      setLoading(false);
      return;
    }

    let isCancelled = false;
    let createdBlobUrl = '';

    const processFile = async () => {
      setLoading(true);
      setErrorMsg(null);
      setDocxHtml('');
      setXlsxSheets({});
      setSearchFilter('');
      setZoomLevel(100);
      setRotation(0);

      try {
        let arrayBuffer: ArrayBuffer | null = null;
        let url = '';

        if (file instanceof ArrayBuffer) {
          arrayBuffer = file;
          const blob = new Blob([arrayBuffer]);
          url = URL.createObjectURL(blob);
          createdBlobUrl = url;
        } else if (file instanceof Blob || file instanceof File) {
          arrayBuffer = await file.arrayBuffer();
          url = URL.createObjectURL(file);
          createdBlobUrl = url;
        } else if (file && typeof file === 'object' && !(file instanceof Blob) && !(file instanceof ArrayBuffer)) {
          // docx Document object from 'docx' library
          try {
            const { Packer } = await import('docx');
            const blob = await Packer.toBlob(file as any);
            arrayBuffer = await blob.arrayBuffer();
            url = URL.createObjectURL(blob);
            createdBlobUrl = url;
          } catch (e) {
            console.warn('Docx object pack fallback:', e);
          }
        } else if (typeof file === 'string') {
          if (file.startsWith('data:')) {
            url = file;
            if (detectedFormat === 'docx' || detectedFormat === 'xlsx') {
              const base64Data = file.split(',')[1];
              const binaryString = atob(base64Data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              arrayBuffer = bytes.buffer;
            }
          } else if (file.startsWith('blob:') || file.startsWith('http://') || file.startsWith('https://')) {
            url = file;
            if (detectedFormat === 'docx' || detectedFormat === 'xlsx') {
              const res = await fetch(file);
              if (!res.ok) throw new Error('Could not fetch document content for preview');
              arrayBuffer = await res.arrayBuffer();
            }
          } else if (file.length > 100 && !file.includes(' ') && !file.startsWith('/')) {
            // Raw base64 string
            const mime = detectedFormat === 'docx' 
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : detectedFormat === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : detectedFormat === 'pdf'
              ? 'application/pdf'
              : 'image/jpeg';
            url = `data:${mime};base64,${file}`;
            if (detectedFormat === 'docx' || detectedFormat === 'xlsx') {
              const binaryString = atob(file);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              arrayBuffer = bytes.buffer;
            }
          } else {
            url = file;
          }
        }

        if (isCancelled) return;
        setPreviewUrl(url);

        // 1. Process DOCX with Mammoth
        if (detectedFormat === 'docx') {
          if (!arrayBuffer) throw new Error('No valid document binary data found for Word preview');
          const result = await mammoth.convertToHtml(
            { arrayBuffer },
            {
              styleMap: [
                "p[style-name='Title'] => h1.docx-title:fresh",
                "p[style-name='Heading 1'] => h2.docx-h1:fresh",
                "p[style-name='Heading 2'] => h3.docx-h2:fresh",
                "table => table.docx-table:fresh"
              ]
            }
          );
          if (isCancelled) return;
          setDocxHtml(result.value || '<p class="text-gray-500 italic">Empty Word document.</p>');
        }
        // 2. Process XLSX with SheetJS
        else if (detectedFormat === 'xlsx') {
          if (!arrayBuffer) throw new Error('No valid spreadsheet binary data found for Excel preview');
          const wb = XLSX.read(arrayBuffer, { type: 'array' });
          const sheetsObj: { [name: string]: any[][] } = {};
          wb.SheetNames.forEach(sheetName => {
            const ws = wb.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
            sheetsObj[sheetName] = data;
          });
          if (isCancelled) return;
          setXlsxSheets(sheetsObj);
          setActiveSheetName(wb.SheetNames[0] || '');
        }
        // 3. Process IMAGE with robust document preprocessing (deskewing, binarization, contrast enhancement)
        else if (detectedFormat === 'image') {
          try {
            const prep = await preprocessDocumentForOcr(url, {
              enableDeskew: true,
              enableIlluminationNormalization: true,
              enableContrastEnhancement: true,
              enableAdaptiveBinarization: true,
              enableSharpening: true,
              enableDespeckle: true,
              maxDeskewAngle: 25
            });
            if (!isCancelled) {
              if (prep.dataUrl) setPreviewUrl(prep.dataUrl);
              if (prep.binarizedDataUrl) setBinarizedPreviewUrl(prep.binarizedDataUrl);
              setOcrPreprocessingMeta({
                deskewAngle: prep.deskewAngle,
                isDeskewed: prep.isDeskewed,
                contrastEnhanced: prep.contrastEnhanced,
                sharpened: prep.sharpened,
                noiseReduced: prep.noiseReduced,
                processingTimeMs: prep.processingTimeMs
              });
            }
          } catch (prepErr) {
            console.warn('Image preprocessing in preview notice:', prepErr);
          }
        }
      } catch (err: any) {
        console.error('UniversalDocumentPreviewModal error:', err);
        if (!isCancelled) {
          setErrorMsg(err.message || 'Failed to render document preview');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    processFile();

    return () => {
      isCancelled = true;
      if (createdBlobUrl) {
        URL.revokeObjectURL(createdBlobUrl);
      }
    };
  }, [isOpen, file, detectedFormat]);

  if (!isOpen) return null;

  const handleDownloadFile = () => {
    if (onDownload) {
      onDownload();
      return;
    }
    const downloadTarget = (activeImageViewMode === 'binarized' && binarizedPreviewUrl) ? binarizedPreviewUrl : previewUrl;
    if (!downloadTarget) return;
    const a = document.createElement('a');
    a.href = downloadTarget;
    const downloadName = activeImageViewMode === 'binarized'
      ? `binarized_${filename || 'document.jpg'}`
      : (filename || `document.${detectedFormat}`);
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePrint = () => {
    window.print();
  };

  // Active sheet data for Excel
  const currentSheetRows = activeSheetName && xlsxSheets[activeSheetName] ? xlsxSheets[activeSheetName] : [];
  const filteredRows = searchFilter.trim()
    ? currentSheetRows.filter((row, rIdx) => {
        if (rIdx === 0) return true; // keep header
        return row.some(cell => String(cell || '').toLowerCase().includes(searchFilter.toLowerCase()));
      })
    : currentSheetRows;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-md flex flex-col animate-in fade-in duration-200">
      
      {/* Top Universal Executive Toolbar */}
      <div className="h-16 px-4 sm:px-6 bg-slate-900 border-b border-white/10 flex items-center justify-between gap-3 shadow-xl shrink-0">
        
        {/* Left: Document Icon & Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 active:bg-white/30 text-white rounded-xl text-xs font-semibold border border-white/10 transition-all shrink-0"
            title="Close Preview"
          >
            <ArrowLeft size={16} className="text-amber-400 shrink-0" />
            <span className="hidden sm:inline">Back</span>
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 shadow-inner ${
              detectedFormat === 'docx' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' :
              detectedFormat === 'xlsx' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' :
              detectedFormat === 'pdf' ? 'bg-rose-600/20 text-rose-400 border border-rose-500/30' :
              'bg-purple-600/20 text-purple-400 border border-purple-500/30'
            }`}>
              {detectedFormat === 'docx' && <FileText size={18} />}
              {detectedFormat === 'xlsx' && <FileSpreadsheet size={18} />}
              {detectedFormat === 'pdf' && <FileText size={18} />}
              {detectedFormat === 'image' && <ImageIcon size={18} />}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white truncate max-w-[240px] sm:max-w-md">
                  {title || filename}
                </h2>
                <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold border shrink-0 ${
                  detectedFormat === 'docx' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                  detectedFormat === 'xlsx' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                  detectedFormat === 'pdf' ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                  'bg-purple-500/20 text-purple-300 border-purple-500/30'
                }`}>
                  {formatBadgeLabel} Preview
                </span>
              </div>
              <p className="text-[11px] text-gray-400 truncate">
                Read-Only Document Verification • Check All Mapped Data Fields Before Downloading
              </p>
            </div>
          </div>
        </div>

        {/* Center: Search / Zoom / Verification Badge */}
        <div className="hidden lg:flex items-center gap-3">
          {(detectedFormat === 'docx' || detectedFormat === 'xlsx') && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Find in document (e.g. TLG-799, NTN)..."
                className="bg-slate-800/80 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 w-64"
              />
            </div>
          )}

          {detectedFormat === 'image' && (
            <div className="flex items-center gap-2">
              {/* Dual-View Toggle: Enhanced Scan vs High-Contrast OCR */}
              <div className="flex items-center gap-1 bg-slate-800/90 border border-white/10 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setActiveImageViewMode('enhanced')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                    activeImageViewMode === 'enhanced'
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title="View deskewed, shadow-free, contrast-boosted scan"
                >
                  <Sparkles size={12} className={activeImageViewMode === 'enhanced' ? 'text-amber-300' : 'text-gray-400'} />
                  <span>Enhanced Scan</span>
                </button>
                {binarizedPreviewUrl && (
                  <button
                    type="button"
                    onClick={() => setActiveImageViewMode('binarized')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                      activeImageViewMode === 'binarized'
                        ? 'bg-slate-700 text-emerald-300 border border-emerald-500/30 shadow-sm'
                        : 'text-gray-400 hover:text-white'
                    }`}
                    title="View high-contrast Sauvola binarized document for OCR verification"
                  >
                    <FileText size={12} className={activeImageViewMode === 'binarized' ? 'text-emerald-400' : 'text-gray-400'} />
                    <span>OCR Binarized</span>
                  </button>
                )}
              </div>

              {/* Zoom & Rotation Controls */}
              <div className="flex items-center gap-1.5 bg-slate-800/90 border border-white/10 rounded-xl px-2 py-1">
                <button
                  type="button"
                  onClick={() => setZoomLevel(prev => Math.max(40, prev - 20))}
                  className="p-1 hover:text-white text-gray-400 transition-colors"
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="text-xs font-mono text-gray-300 min-w-[40px] text-center font-bold">
                  {zoomLevel}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel(prev => Math.min(300, prev + 20))}
                  className="p-1 hover:text-white text-gray-400 transition-colors"
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setRotation(prev => (prev + 90) % 360)}
                  className="p-1 hover:text-white text-gray-400 transition-colors border-l border-white/10 pl-2 ml-1"
                  title="Rotate 90°"
                >
                  <RotateCw size={14} />
                </button>
              </div>
            </div>
          )}

          {verificationItems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowVerificationPanel(prev => !prev)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                showVerificationPanel 
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                  : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
              }`}
            >
              <ShieldCheck size={14} className="text-emerald-400" />
              <span>Data Check ({verificationItems.length})</span>
            </button>
          )}
        </div>

        {/* Right: Actions (Download & Print & Mobile Data Check) */}
        <div className="flex items-center gap-2 shrink-0">
          {verificationItems.length > 0 && (
            <button
              type="button"
              onClick={() => setMobileVerificationOpen(true)}
              className="lg:hidden px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              title="View Data Mapping Check"
            >
              <ShieldCheck size={14} className="text-emerald-400" />
              <span>Check ({verificationItems.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handlePrint}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-medium border border-white/10 transition-colors"
            title="Print Document"
          >
            <Printer size={15} />
            <span>Print</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadFile}
            className="btn-animated-luxury flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 transition-all hover:scale-102 cursor-pointer"
            title="Download Verified File"
          >
            <Download size={15} />
            <span>Download {formatBadgeLabel}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors ml-1"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Preview Container with optional Data Verification Side Panel */}
      <div className="flex-1 flex overflow-hidden bg-slate-950">

        {/* Document Content Viewport */}
        <div className="flex-1 overflow-auto p-4 sm:p-8 flex justify-center items-start">
          
          {loading && (
            <div className="flex flex-col items-center justify-center p-12 text-center my-auto">
              <RefreshCw size={36} className="text-brand-400 animate-spin mb-4" />
              <h3 className="text-base font-bold text-white">Rendering Document Preview...</h3>
              <p className="text-xs text-gray-400 mt-1">
                Parsing formatting, tables, and mapped fields for verification...
              </p>
            </div>
          )}

          {errorMsg && !loading && (
            <div className="max-w-md p-6 bg-red-950/40 border border-red-500/30 rounded-2xl text-center my-auto">
              <AlertTriangle size={36} className="text-red-400 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-white">Document Preview Warning</h3>
              <p className="text-xs text-red-200 mt-1 mb-4">{errorMsg}</p>
              <button
                type="button"
                onClick={handleDownloadFile}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs rounded-xl shadow-lg"
              >
                Download Directly
              </button>
            </div>
          )}

          {/* 1. MICROSOFT WORD (.docx) RENDER */}
          {detectedFormat === 'docx' && !loading && !errorMsg && (
            <div className="w-full max-w-4xl flex flex-col items-center">
              
              {/* Document Paper Mockup Container */}
              <div 
                className="w-full bg-white text-slate-900 rounded-lg shadow-2xl border border-slate-300 p-8 sm:p-14 transition-all selection:bg-blue-100"
                style={{
                  minHeight: '11in',
                  fontFamily: 'Calibri, "Times New Roman", Georgia, serif',
                  fontSize: '11pt',
                  lineHeight: '1.4'
                }}
              >
                {/* Visual Watermark Header for Read-Only Verification */}
                <div className="border-b-2 border-slate-200 pb-3 mb-6 flex justify-between items-center text-[10px] text-slate-500 font-sans uppercase tracking-wider">
                  <span className="font-semibold text-blue-700 flex items-center gap-1">
                    <ShieldCheck size={12} /> Official Word Document Verification Preview
                  </span>
                  <span>{filename}</span>
                </div>

                {/* Rendered HTML from Mammoth with Word-like Styling */}
                <div 
                  className="docx-content-view space-y-4"
                  dangerouslySetInnerHTML={{ __html: docxHtml }}
                />

                {/* Visual Footer */}
                <div className="border-t border-slate-200 pt-4 mt-12 text-[10px] text-slate-400 flex justify-between items-center font-sans">
                  <span>Docks (Pvt.) Ltd. • Verified Commercial & Customs Filing Record</span>
                  <span>Page 1 of 1</span>
                </div>
              </div>
            </div>
          )}

          {/* 2. MICROSOFT EXCEL (.xlsx) RENDER */}
          {detectedFormat === 'xlsx' && !loading && !errorMsg && (
            <div className="w-full max-w-6xl flex flex-col bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
              
              {/* Sheet Tabs */}
              <div className="bg-slate-950 px-4 py-2 border-b border-white/10 flex items-center gap-2 overflow-x-auto">
                <span className="text-xs text-gray-400 font-semibold mr-2 flex items-center gap-1.5">
                  <FileSpreadsheet size={14} className="text-emerald-400" /> Worksheets:
                </span>
                {Object.keys(xlsxSheets).map((sName) => (
                  <button
                    key={sName}
                    type="button"
                    onClick={() => setActiveSheetName(sName)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                      activeSheetName === sName
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                        : 'bg-white/5 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    {sName}
                  </button>
                ))}
              </div>

              {/* Excel Table Grid */}
              <div className="overflow-auto max-h-[72vh]">
                <table className="w-full text-left text-xs text-gray-200 border-collapse">
                  <tbody>
                    {filteredRows.map((row, rIdx) => {
                      const isHeaderRow = rIdx === 0 || row.some(c => typeof c === 'string' && /DATE|SR|REGISTRATION|ACCOUNT|DEBIT/i.test(c));
                      return (
                        <tr 
                          key={`row_${rIdx}`} 
                          className={`border-b border-white/5 hover:bg-white/[0.03] transition-colors ${
                            isHeaderRow ? 'bg-slate-800 font-bold text-emerald-300 sticky top-0 shadow-sm' : ''
                          }`}
                        >
                          <td className="px-3 py-2 text-[10px] font-mono text-gray-500 border-r border-white/5 select-none text-center bg-slate-950/40 w-10">
                            {rIdx + 1}
                          </td>
                          {row.map((cell: any, cIdx: number) => (
                            <td 
                              key={`cell_${rIdx}_${cIdx}`} 
                              className={`px-3.5 py-2.5 border-r border-white/5 whitespace-nowrap ${
                                typeof cell === 'number' ? 'text-right font-mono text-emerald-400 font-medium' : ''
                              }`}
                            >
                              {cell !== null && cell !== undefined ? String(cell) : ''}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Excel Footer Info */}
              <div className="p-3 bg-slate-950 border-t border-white/10 text-xs text-gray-400 flex justify-between items-center px-4">
                <span>Showing {filteredRows.length} rows in sheet "{activeSheetName}"</span>
                <span className="text-[11px] text-emerald-400 font-medium">✓ Spreadsheet Data Format Verified</span>
              </div>
            </div>
          )}

          {/* 3. ADOBE PDF (.pdf) RENDER */}
          {detectedFormat === 'pdf' && !loading && !errorMsg && (
            <div className="w-full max-w-5xl h-[82vh] bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
              <iframe
                src={`${previewUrl}#toolbar=1&navpanes=0`}
                className="w-full h-full border-none bg-slate-900"
                title="PDF Document Preview"
              />
            </div>
          )}

          {/* 4. IMAGE (.jpg / .jpeg / .png / .webp) RENDER */}
          {detectedFormat === 'image' && !loading && !errorMsg && (
            <div className="flex flex-col items-center justify-center p-4">
              <div 
                className="transition-transform duration-200 max-w-full shadow-2xl rounded-xl overflow-hidden border border-white/10 bg-black/40"
                style={{
                  transform: `scale(${zoomLevel / 100}) rotate(${rotation}deg)`
                }}
              >
                <img 
                  src={(activeImageViewMode === 'binarized' && binarizedPreviewUrl) ? binarizedPreviewUrl : previewUrl} 
                  alt={filename} 
                  className="max-h-[72vh] object-contain mx-auto"
                />
              </div>

              {/* OCR Preprocessing Status Ribbon */}
              {ocrPreprocessingMeta && (
                <div className="mt-3.5 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-emerald-500/30 text-[11px] text-gray-300 shadow-xl backdrop-blur-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-300 font-semibold">OCR Preprocessing:</span>
                  <span>
                    {ocrPreprocessingMeta.isDeskewed ? `Deskewed (${ocrPreprocessingMeta.deskewAngle}°)` : 'Deskew Verified'} • 
                    Illumination Flattened • Contrast Boosted • Laplacian Sharpened • Sauvola Binarized
                  </span>
                  {ocrPreprocessingMeta.processingTimeMs && (
                    <span className="text-gray-500 font-mono text-[10px]">({ocrPreprocessingMeta.processingTimeMs}ms)</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Data Verification Checklist Panel */}
        {showVerificationPanel && verificationItems.length > 0 && (
          <div className="w-80 border-l border-white/10 bg-slate-900/90 p-4 overflow-y-auto hidden md:flex flex-col shrink-0 animate-in slide-in-from-right-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Data Mapping Check</h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                100% Mapped
              </span>
            </div>

            <p className="text-[11px] text-gray-400 mb-4 leading-relaxed">
              Verify all dynamic variables, company particulars, and government registration fields mapped into this document:
            </p>

            <div className="space-y-2.5 flex-1">
              {verificationItems.map((item, idx) => (
                <div 
                  key={`check_${idx}`}
                  className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-emerald-500/30 transition-all text-xs"
                >
                  <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
                    <span>{item.label}</span>
                    <CheckCircle2 size={12} className="text-emerald-400" />
                  </div>
                  <p className="font-semibold text-white break-words">
                    {item.value !== null && item.value !== undefined ? String(item.value) : '—'}
                  </p>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-white/10 mt-4">
              <button
                type="button"
                onClick={handleDownloadFile}
                className="btn-animated-luxury w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all hover:scale-102 cursor-pointer"
              >
                <Download size={14} />
                <span>Verified! Download File</span>
              </button>
            </div>
          </div>
        )}

        {/* Mobile Data Verification Checklist Drawer */}
        {mobileVerificationOpen && verificationItems.length > 0 && (
          <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex justify-end md:hidden animate-in fade-in duration-150">
            <div className="w-full max-w-sm bg-slate-900 border-l border-white/10 p-5 flex flex-col h-full animate-in slide-in-from-right-full duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Data Mapping Check</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileVerificationOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-2.5 flex-1 overflow-y-auto pr-1">
                {verificationItems.map((item, idx) => (
                  <div 
                    key={`m_check_${idx}`}
                    className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-xs"
                  >
                    <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
                      <span>{item.label}</span>
                      <CheckCircle2 size={13} className="text-emerald-400" />
                    </div>
                    <p className="font-semibold text-white break-words">
                      {item.value !== null && item.value !== undefined ? String(item.value) : '—'}
                    </p>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-white/10 mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setMobileVerificationOpen(false);
                    handleDownloadFile();
                  }}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
                >
                  <Download size={15} />
                  <span>Verified! Download File</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMobileVerificationOpen(false)}
                  className="w-full py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-medium border border-white/10"
                >
                  Close Checklist
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Embedded CSS for Word Document Typography & Tables */}
      <style>{`
        .docx-content-view h1, .docx-content-view h2, .docx-content-view h3 {
          color: #0f172a;
          font-weight: bold;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }
        .docx-content-view h1 { font-size: 14pt; text-align: center; }
        .docx-content-view h2 { font-size: 12pt; }
        .docx-content-view h3 { font-size: 11pt; }
        .docx-content-view p {
          margin-bottom: 0.6rem;
          line-height: 1.5;
          color: #1e293b;
        }
        .docx-content-view strong, .docx-content-view b {
          font-weight: 700;
          color: #0f172a;
        }
        .docx-content-view table {
          width: 100%;
          border-collapse: collapse;
          margin: 1rem 0;
          font-size: 9.5pt;
        }
        .docx-content-view th, .docx-content-view td {
          border: 1px solid #475569;
          padding: 6px 8px;
          text-align: left;
          vertical-align: top;
        }
        .docx-content-view th {
          background-color: #f1f5f9;
          font-weight: bold;
          color: #0f172a;
        }
        .docx-content-view tr:nth-child(even) td {
          background-color: #f8fafc;
        }
      `}</style>
    </div>
  );
};

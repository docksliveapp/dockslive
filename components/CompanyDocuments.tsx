import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  FolderArchive, 
  Search, 
  Filter, 
  Plus, 
  Upload, 
  Download, 
  Trash2, 
  Calendar, 
  Clock, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  Loader2, 
  X, 
  Eye, 
  Building, 
  Scale, 
  Gavel, 
  ChevronRight,
  Send,
  User,
  MapPin,
  Tag,
  Paperclip,
  Check,
  FileCheck
} from 'lucide-react';
import { CompanyDocument, DEFAULT_COMPANY_DOCUMENT_CATEGORIES } from '../types';
import { 
  subscribeToCompanyDocuments, 
  saveCompanyDocumentToFirestore, 
  deleteCompanyDocumentFromFirestore,
  subscribeToCompanyCategories,
  saveCompanyCategoryToFirestore
} from '../services/dbService';
import { analyzeCompanyDocumentWithAI } from '../services/geminiService';
import { useBranding } from '../services/brandingService';
import { useActiveCompany } from '../services/companyService';
import { sendAppNotification } from '../services/notificationService';
import { jsPDF } from 'jspdf';
import { drawPdfCorporateHeader, drawPdfCorporateFooter, drawOfficialCompanyStampOnly, cleanPdfText } from '../services/pdfExportService';
import {
  Building2,
  Landmark,
  Shield,
  ShieldCheck,
  Coins,
  TrendingUp,
  Award,
  AlertTriangle,
  Siren,
  FileSignature,
  CreditCard,
  HardDrive,
  FolderOpen,
  FolderPlus,
  Layers,
  FileDown,
  ArrowRight,
  LayoutGrid
} from 'lucide-react';

// Category color badges & rich metadata
export interface CategoryMeta {
  icon: React.ElementType;
  description: string;
  gradient: string;
  badgeBg: string;
  textColor: string;
  borderColor: string;
  iconBg: string;
  glowColor: string;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  'SECP': {
    icon: Building2,
    description: 'Corporate filings, Form 29, incorporation & statutory compliance',
    gradient: 'from-blue-950/60 to-slate-900/90 hover:from-blue-900/40 hover:to-slate-850',
    badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    textColor: 'text-blue-400',
    borderColor: 'border-blue-500/30 hover:border-blue-400/70',
    iconBg: 'bg-blue-500/20 text-blue-400',
    glowColor: 'group-hover:shadow-blue-500/20'
  },
  'SRB': {
    icon: Landmark,
    description: 'Sindh Revenue Board, provincial sales tax & withholding filings',
    gradient: 'from-emerald-950/60 to-slate-900/90 hover:from-emerald-900/40 hover:to-slate-850',
    badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/30 hover:border-emerald-400/70',
    iconBg: 'bg-emerald-500/20 text-emerald-400',
    glowColor: 'group-hover:shadow-emerald-500/20'
  },
  'FBR income tax': {
    icon: Coins,
    description: 'Federal Board of Revenue, income tax returns, CPRs & audit notices',
    gradient: 'from-amber-950/60 to-slate-900/90 hover:from-amber-900/40 hover:to-slate-850',
    badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-500/30 hover:border-amber-400/70',
    iconBg: 'bg-amber-500/20 text-amber-400',
    glowColor: 'group-hover:shadow-amber-500/20'
  },
  'PAKISTAN customs': {
    icon: Shield,
    description: 'Customs Collectorates, WeBOC, GDs, port clearance & orders',
    gradient: 'from-red-950/60 to-slate-900/90 hover:from-red-900/40 hover:to-slate-850',
    badgeBg: 'bg-red-500/20 text-red-300 border-red-500/30',
    textColor: 'text-red-400',
    borderColor: 'border-red-500/30 hover:border-red-400/70',
    iconBg: 'bg-red-500/20 text-red-400',
    glowColor: 'group-hover:shadow-red-500/20'
  },
  'State Bank of Pakistan': {
    icon: Landmark,
    description: 'Central bank foreign exchange, E-forms, remittance & approvals',
    gradient: 'from-teal-950/60 to-slate-900/90 hover:from-teal-900/40 hover:to-slate-850',
    badgeBg: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
    textColor: 'text-teal-400',
    borderColor: 'border-teal-500/30 hover:border-teal-400/70',
    iconBg: 'bg-teal-500/20 text-teal-400',
    glowColor: 'group-hover:shadow-teal-500/20'
  },
  'Stocks Exchange': {
    icon: TrendingUp,
    description: 'Pakistan Stock Exchange (PSX), corporate shares & equity records',
    gradient: 'from-purple-950/60 to-slate-900/90 hover:from-purple-900/40 hover:to-slate-850',
    badgeBg: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    textColor: 'text-purple-400',
    borderColor: 'border-purple-500/30 hover:border-purple-400/70',
    iconBg: 'bg-purple-500/20 text-purple-400',
    glowColor: 'group-hover:shadow-purple-500/20'
  },
  'Deposits/Guaranties': {
    icon: ShieldCheck,
    description: 'Port authority security deposits, bank guarantees & cash bonds',
    gradient: 'from-cyan-950/60 to-slate-900/90 hover:from-cyan-900/40 hover:to-slate-850',
    badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    textColor: 'text-cyan-400',
    borderColor: 'border-cyan-500/30 hover:border-cyan-400/70',
    iconBg: 'bg-cyan-500/20 text-cyan-400',
    glowColor: 'group-hover:shadow-cyan-500/20'
  },
  'Chamber of Commerce': {
    icon: Award,
    description: 'KCCI / FPCCI membership, certificates of origin & attestations',
    gradient: 'from-indigo-950/60 to-slate-900/90 hover:from-indigo-900/40 hover:to-slate-850',
    badgeBg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    textColor: 'text-indigo-400',
    borderColor: 'border-indigo-500/30 hover:border-indigo-400/70',
    iconBg: 'bg-indigo-500/20 text-indigo-400',
    glowColor: 'group-hover:shadow-indigo-500/20'
  },
  'Showcase/ONOs reply': {
    icon: AlertTriangle,
    description: 'Show Cause Notices, Order in Originals, hearings & formal replies',
    gradient: 'from-orange-950/60 to-slate-900/90 hover:from-orange-900/40 hover:to-slate-850',
    badgeBg: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    textColor: 'text-orange-400',
    borderColor: 'border-orange-500/30 hover:border-orange-400/70',
    iconBg: 'bg-orange-500/20 text-orange-400',
    glowColor: 'group-hover:shadow-orange-500/20'
  },
  'FIRs': {
    icon: Siren,
    description: 'First Information Reports, police notices & regulatory citations',
    gradient: 'from-rose-950/60 to-slate-900/90 hover:from-rose-900/40 hover:to-slate-850',
    badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    textColor: 'text-rose-400',
    borderColor: 'border-rose-500/30 hover:border-rose-400/70',
    iconBg: 'bg-rose-500/20 text-rose-400',
    glowColor: 'group-hover:shadow-rose-500/20'
  },
  'Petitions': {
    icon: Scale,
    description: 'High Court, Supreme Court & Customs Appellate Tribunal petitions',
    gradient: 'from-violet-950/60 to-slate-900/90 hover:from-violet-900/40 hover:to-slate-850',
    badgeBg: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    textColor: 'text-violet-400',
    borderColor: 'border-violet-500/30 hover:border-violet-400/70',
    iconBg: 'bg-violet-500/20 text-violet-400',
    glowColor: 'group-hover:shadow-violet-500/20'
  },
  "Agreement's": {
    icon: FileSignature,
    description: 'Vendor, client, warehouse, lease agreements & corporate contracts',
    gradient: 'from-sky-950/60 to-slate-900/90 hover:from-sky-900/40 hover:to-slate-850',
    badgeBg: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    textColor: 'text-sky-400',
    borderColor: 'border-sky-500/30 hover:border-sky-400/70',
    iconBg: 'bg-sky-500/20 text-sky-400',
    glowColor: 'group-hover:shadow-sky-500/20'
  },
  'Quotations': {
    icon: Tag,
    description: 'Commercial quotes, freight proposals & tariff rate cards',
    gradient: 'from-lime-950/60 to-slate-900/90 hover:from-lime-900/40 hover:to-slate-850',
    badgeBg: 'bg-lime-500/20 text-lime-300 border-lime-500/30',
    textColor: 'text-lime-400',
    borderColor: 'border-lime-500/30 hover:border-lime-400/70',
    iconBg: 'bg-lime-500/20 text-lime-400',
    glowColor: 'group-hover:shadow-lime-500/20'
  },
  'Banks': {
    icon: CreditCard,
    description: 'Bank statements, sanction letters, LC facilities & signatory cards',
    gradient: 'from-emerald-950/60 to-slate-900/90 hover:from-emerald-900/40 hover:to-slate-850',
    badgeBg: 'bg-emerald-600/20 text-emerald-300 border-emerald-600/30',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-600/30 hover:border-emerald-500/70',
    iconBg: 'bg-emerald-600/20 text-emerald-400',
    glowColor: 'group-hover:shadow-emerald-500/20'
  },
  'Assets': {
    icon: HardDrive,
    description: 'Vehicle ownership books, warehouse titles, office machinery deeds',
    gradient: 'from-yellow-950/60 to-slate-900/90 hover:from-yellow-900/40 hover:to-slate-850',
    badgeBg: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    textColor: 'text-yellow-400',
    borderColor: 'border-yellow-500/30 hover:border-yellow-400/70',
    iconBg: 'bg-yellow-500/20 text-yellow-400',
    glowColor: 'group-hover:shadow-yellow-500/20'
  }
};

export const getCategoryMeta = (cat: string): CategoryMeta => {
  if (CATEGORY_META[cat]) return CATEGORY_META[cat];
  return {
    icon: FolderArchive,
    description: 'Corporate archive & official regulatory records folder',
    gradient: 'from-slate-900 to-slate-950 hover:from-slate-850 hover:to-slate-900',
    badgeBg: 'bg-white/10 text-gray-200 border-white/20',
    textColor: 'text-amber-400',
    borderColor: 'border-white/10 hover:border-amber-500/50',
    iconBg: 'bg-white/10 text-amber-400',
    glowColor: 'group-hover:shadow-amber-500/20'
  };
};

const getCategoryStyle = (cat: string) => {
  const meta = getCategoryMeta(cat);
  const parts = meta.badgeBg.split(' ');
  return { bg: parts[0] || 'bg-white/10', text: meta.textColor, border: parts[2] || 'border-white/20' };
};

export const CompanyDocuments: React.FC = () => {
  const { customLogo, companyName } = useBranding();
  const { activeCompany } = useActiveCompany();

  // State
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_COMPANY_DOCUMENT_CATEGORIES);
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modals & Category Window View
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAdvanceSearchModal, setShowAdvanceSearchModal] = useState(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [selectedDocForPreview, setSelectedDocForPreview] = useState<CompanyDocument | null>(null);
  const [activeCategoryModal, setActiveCategoryModal] = useState<string | null>(null);
  const [categoryModalSearch, setCategoryModalSearch] = useState<string>('');
  const [viewMode, setViewMode] = useState<'categories' | 'documents'>('categories');

  // New Category Form
  const [newCategoryName, setNewCategoryName] = useState('');

  // Advance Search Filters
  const [advCategory, setAdvCategory] = useState('ALL');
  const [advSubcategory, setAdvSubcategory] = useState('');
  const [advDateFrom, setAdvDateFrom] = useState('');
  const [advDateTo, setAdvDateTo] = useState('');
  const [advTitle, setAdvTitle] = useState('');
  const [advFrom, setAdvFrom] = useState('');
  const [advTo, setAdvTo] = useState('');
  const [advHearingFilter, setAdvHearingFilter] = useState<'ALL' | 'YES' | 'NO'>('ALL');
  const [isAdvActive, setIsAdvActive] = useState(false);

  // Add Document Form State
  const [docCategory, setDocCategory] = useState(DEFAULT_COMPANY_DOCUMENT_CATEGORIES[0]);
  const [docDate, setDocDate] = useState(new Date().toISOString().split('T')[0]);
  const [docTitle, setDocTitle] = useState('');
  const [docFrom, setDocFrom] = useState('');
  const [docTo, setDocTo] = useState(() => `${activeCompany?.legalTitle || activeCompany?.name || 'Company Operations'}, Karachi`);
  const [docSubject, setDocSubject] = useState('');

  useEffect(() => {
    setDocTo(`${activeCompany?.legalTitle || activeCompany?.name || 'Company Operations'}, Karachi`);
  }, [activeCompany?.id]);
  const [docRefNo, setDocRefNo] = useState('');
  const [hearingRequired, setHearingRequired] = useState(false);
  const [hearingDate, setHearingDate] = useState('');
  const [hearingTime, setHearingTime] = useState('');
  const [hearingNotes, setHearingNotes] = useState('');
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');

  // Uploaded Files for Add Modal (Supports Multiple!)
  interface UploadItem {
    name: string;
    dataUrl: string;
    type: string;
    size: number;
    status: 'idle' | 'analyzing' | 'done';
  }
  const [uploadedFiles, setUploadedFiles] = useState<UploadItem[]>([]);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to live Firestore data
  useEffect(() => {
    setIsLoading(true);
    const unsubDocs = subscribeToCompanyDocuments((docs) => {
      setDocuments(docs);
      setIsLoading(false);
    });

    const unsubCats = subscribeToCompanyCategories((cats) => {
      if (cats && cats.length > 0) {
        setCategories(cats);
      }
    });

    return () => {
      unsubDocs();
      unsubCats();
    };
  }, []);

  // Filtered documents
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Category Tab
      if (selectedCategoryTab !== 'ALL' && doc.category !== selectedCategoryTab) {
        return false;
      }

      // Quick Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesQuery = 
          (doc.title && doc.title.toLowerCase().includes(q)) ||
          (doc.subject && doc.subject.toLowerCase().includes(q)) ||
          (doc.from && doc.from.toLowerCase().includes(q)) ||
          (doc.to && doc.to.toLowerCase().includes(q)) ||
          (doc.category && doc.category.toLowerCase().includes(q)) ||
          (doc.referenceNo && doc.referenceNo.toLowerCase().includes(q)) ||
          (doc.documentDate && doc.documentDate.includes(q));

        if (!matchesQuery) return false;
      }

      // Advance Search Filters
      if (isAdvActive) {
        if (advCategory !== 'ALL' && doc.category !== advCategory) return false;
        if (advSubcategory.trim() && !doc.subcategory?.toLowerCase().includes(advSubcategory.toLowerCase().trim())) return false;
        if (advTitle.trim() && !doc.title.toLowerCase().includes(advTitle.toLowerCase().trim())) return false;
        if (advFrom.trim() && !doc.from.toLowerCase().includes(advFrom.toLowerCase().trim())) return false;
        if (advTo.trim() && !doc.to.toLowerCase().includes(advTo.toLowerCase().trim())) return false;
        if (advDateFrom && doc.documentDate < advDateFrom) return false;
        if (advDateTo && doc.documentDate > advDateTo) return false;
        if (advHearingFilter === 'YES' && !doc.hearingRequired) return false;
        if (advHearingFilter === 'NO' && doc.hearingRequired) return false;
      }

      return true;
    });
  }, [documents, selectedCategoryTab, searchQuery, isAdvActive, advCategory, advSubcategory, advTitle, advFrom, advTo, advDateFrom, advDateTo, advHearingFilter]);

  // Documents for the currently opened category modal window
  const activeCategoryDocuments = useMemo(() => {
    if (!activeCategoryModal) return [];
    return documents.filter((doc) => {
      if (doc.category !== activeCategoryModal) return false;
      if (!categoryModalSearch.trim()) return true;
      const q = categoryModalSearch.toLowerCase().trim();
      return (
        (doc.title && doc.title.toLowerCase().includes(q)) ||
        (doc.subject && doc.subject.toLowerCase().includes(q)) ||
        (doc.from && doc.from.toLowerCase().includes(q)) ||
        (doc.to && doc.to.toLowerCase().includes(q)) ||
        (doc.referenceNo && doc.referenceNo.toLowerCase().includes(q)) ||
        (doc.documentDate && doc.documentDate.includes(q))
      );
    });
  }, [documents, activeCategoryModal, categoryModalSearch]);

  // Unique Lists for Advance Search Autocomplete/Dropdowns
  const uniqueFromList = useMemo(() => {
    const set = new Set<string>();
    documents.forEach(d => { if (d.from) set.add(d.from); });
    return Array.from(set).sort();
  }, [documents]);

  const uniqueToList = useMemo(() => {
    const set = new Set<string>();
    documents.forEach(d => { if (d.to) set.add(d.to); });
    return Array.from(set).sort();
  }, [documents]);

  // Handle Multi-File Upload & AI OCR Trigger
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newUploads: UploadItem[] = [];
    const filesArray = Array.from(files);

    for (const file of filesArray) {
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          newUploads.push({
            name: file.name,
            dataUrl: ev.target?.result as string,
            type: file.type,
            size: file.size,
            status: 'idle'
          });
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }

    setUploadedFiles(prev => [...prev, ...newUploads]);

    // Run AI OCR on the primary/first file to automatically extract fields
    const primaryFile = newUploads[0];
    if (primaryFile) {
      setAiAnalyzing(true);
      setAiNotice(null);
      try {
        const aiResult = await analyzeCompanyDocumentWithAI(primaryFile);

        if (aiResult.title) setDocTitle(aiResult.title);
        if (aiResult.category && categories.includes(aiResult.category)) {
          setDocCategory(aiResult.category);
        }
        if (aiResult.documentDate) setDocDate(aiResult.documentDate);
        if (aiResult.from) setDocFrom(aiResult.from);
        if (aiResult.to) setDocTo(aiResult.to);
        if (aiResult.subject) setDocSubject(aiResult.subject);
        if (aiResult.referenceNo) setDocRefNo(aiResult.referenceNo);
        if (aiResult.hearingRequired !== undefined) {
          setHearingRequired(aiResult.hearingRequired);
          if (aiResult.hearingDate) setHearingDate(aiResult.hearingDate);
          if (aiResult.hearingTime) setHearingTime(aiResult.hearingTime);
        }

        if (aiResult.unreadFieldsNote) {
          setAiNotice(`AI Notice: ${aiResult.unreadFieldsNote}`);
        } else {
          setAiNotice('✨ AI has successfully analyzed and filled document fields. Review below.');
        }
      } catch (err) {
        console.warn('AI analysis notice:', err);
        setAiNotice('Document attached. Fill in any fields manually if needed.');
      } finally {
        setAiAnalyzing(false);
      }
    }
  };

  // Save Document
  const handleSaveDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docTitle.trim() || !docCategory) return;

    const primaryFile = uploadedFiles[0];

    const newDoc: CompanyDocument = {
      id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: docTitle.trim(),
      category: docCategory,
      documentDate: docDate || new Date().toISOString().split('T')[0],
      from: docFrom.trim(),
      to: docTo.trim(),
      subject: docSubject.trim(),
      referenceNo: docRefNo.trim(),
      hearingRequired: hearingRequired,
      hearingDate: hearingRequired ? hearingDate : undefined,
      hearingTime: hearingRequired ? hearingTime : undefined,
      hearingNotes: hearingRequired ? hearingNotes.trim() : undefined,
      hasExpiry,
      expiryDate: hasExpiry ? expiryDate : undefined,
      fileUrl: primaryFile?.dataUrl || undefined,
      fileName: primaryFile?.name || (uploadedFiles.length > 1 ? `${uploadedFiles.length} files attached` : undefined),
      fileType: primaryFile?.type || undefined,
      fileSize: primaryFile?.size || undefined,
      uploadedAt: new Date().toISOString(),
      uploadedBy: 'Office Staff / Admin'
    };

    await saveCompanyDocumentToFirestore(newDoc);

    // If document has expiry, check if expiring soon (<= 10 days) or expired, and notify Admin, Finance Manager, Operations Manager
    if (hasExpiry && expiryDate) {
      const today = new Date().toISOString().split('T')[0];
      const diffDays = Math.ceil((new Date(expiryDate).getTime() - new Date(today).getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays <= 0) {
        await sendAppNotification({
          title: `Document Expired: ${docTitle.trim()}`,
          description: `Company document "${docTitle.trim()}" expired on ${expiryDate}.`,
          details: `Document: ${docTitle.trim()}\nCategory: ${docCategory}\nExpired On: ${expiryDate}\nAction: Please upload renewal certificate.`,
          targetRole: 'ADMIN,FINANCE_MANAGER,OPERATIONS_MANAGER',
          type: 'ALERT',
          notificationSubType: 'DOC_EXPIRY_ALERT',
          category: 'GENERAL',
          priority: 'HIGH'
        });
      } else if (diffDays <= 10) {
        await sendAppNotification({
          title: `Document Expiring Soon (${diffDays} Days): ${docTitle.trim()}`,
          description: `Company document "${docTitle.trim()}" will expire in ${diffDays} days on ${expiryDate}.`,
          details: `Document: ${docTitle.trim()}\nCategory: ${docCategory}\nExpiry Date: ${expiryDate}\nDays Remaining: ${diffDays} days\nPrepare renewal paperwork.`,
          targetRole: 'ADMIN,FINANCE_MANAGER,OPERATIONS_MANAGER',
          type: 'INFO',
          notificationSubType: 'DOC_EXPIRY_ALERT',
          category: 'GENERAL',
          priority: 'HIGH'
        });
      }
    }

    // Reset Form
    setShowAddModal(false);
    setDocTitle('');
    setDocFrom('');
    setDocTo(`${activeCompany?.legalTitle || activeCompany?.name || 'Company Operations'}, Karachi`);
    setDocSubject('');
    setDocRefNo('');
    setHearingRequired(false);
    setHearingDate('');
    setHearingTime('');
    setHearingNotes('');
    setHasExpiry(false);
    setExpiryDate('');
    setUploadedFiles([]);
    setAiNotice(null);
  };

  // Add Custom Category
  const handleSaveCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;

    await saveCompanyCategoryToFirestore(trimmed);
    if (!categories.includes(trimmed)) {
      setCategories(prev => [...prev, trimmed]);
    }
    setDocCategory(trimmed);
    setNewCategoryName('');
    setShowAddCategoryModal(false);
  };

  // Delete Document
  const handleDeleteDocument = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this company document record?')) {
      await deleteCompanyDocumentFromFirestore(id);
    }
  };

  // Download PDF Handler (Downloads original attachment or creates official generated PDF)
  const handleDownloadPdf = async (docItem: CompanyDocument) => {
    if (docItem.fileUrl && docItem.fileUrl.startsWith('data:')) {
      const link = document.createElement('a');
      link.href = docItem.fileUrl;
      link.download = docItem.fileName || `${docItem.title.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Generate formatted official PDF with jsPDF using MAK Group official letterhead
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 14;

    // 1. Draw unified MAK GROUP OF COMPANIES letterhead
    let currentY = await drawPdfCorporateHeader(pdf, {
      title: 'LEGAL & COMPLIANCE RECORD',
      refNo: docItem.referenceNo || `DOC-${docItem.id}`,
      date: docItem.documentDate || new Date().toISOString().split('T')[0],
      subject: docItem.subject || docItem.title
    });

    // 2. Document Title Box
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(margin, currentY, pageWidth - (margin * 2), 10, 1.5, 1.5, 'FD');
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text(cleanPdfText(docItem.title), margin + 4, currentY + 6.5, { maxWidth: pageWidth - (margin * 2) - 8 });
    currentY += 14;

    const addRow = (label: string, val: string, isAlert = false) => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(100, 116, 139);
      pdf.text(label, margin + 4, currentY);

      pdf.setFont('helvetica', isAlert ? 'bold' : 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(isAlert ? 180 : 15, isAlert ? 83 : 23, isAlert ? 9 : 42);
      pdf.text(cleanPdfText(val) || 'N/A', margin + 45, currentY, { maxWidth: pageWidth - margin - 50 });
      currentY += 6.5;
    };

    addRow('Category:', docItem.category);
    addRow('Document Date:', docItem.documentDate);
    if (docItem.referenceNo) addRow('Reference #:', docItem.referenceNo);
    addRow('Sender (From):', docItem.from);
    addRow('Recipient (To):', docItem.to);
    addRow('Subject:', docItem.subject);

    if (docItem.hearingRequired) {
      currentY += 3;
      pdf.setFillColor(254, 243, 199);
      pdf.rect(margin, currentY - 4, pageWidth - (margin * 2), 16, 'F');
      pdf.setDrawColor(245, 158, 11);
      pdf.rect(margin, currentY - 4, pageWidth - (margin * 2), 16, 'S');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(180, 83, 9);
      pdf.text(`LEGAL HEARING SCHEDULED: ${docItem.hearingDate || 'TBD'} ${docItem.hearingTime ? 'at ' + docItem.hearingTime : ''}`, margin + 4, currentY + 3);
      if (docItem.hearingNotes) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.text(`Notes: ${cleanPdfText(docItem.hearingNotes)}`, margin + 4, currentY + 9);
      }
      currentY += 18;
    }

    // 3. Issuing Company Signature & Official Seal at bottom
    const stampY = Math.max(currentY + 5, 230);
    drawOfficialCompanyStampOnly(pdf, pageWidth - margin - 60, stampY, 'COMPLIANCE RECORD SEAL', activeCompany?.id);

    // Left signature line
    pdf.setDrawColor(148, 163, 184);
    pdf.setLineWidth(0.3);
    pdf.line(margin, stampY + 12, margin + 55, stampY + 12);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(51, 65, 85);
    pdf.text('AUTHORIZED COMPLIANCE OFFICER', margin, stampY + 16);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.2);
    pdf.setTextColor(100, 116, 139);
    pdf.text(activeCompany?.legalTitle || activeCompany?.name || 'Operating Entity', margin, stampY + 19.5);

    // 4. Draw unified corporate footer
    drawPdfCorporateFooter(pdf, 'Page 1 of 1');

    pdf.save(`${docItem.title.replace(/\s+/g, '_')}_record.pdf`);
  };

  // Reset Advance Search
  const handleResetAdvSearch = () => {
    setAdvCategory('ALL');
    setAdvSubcategory('');
    setAdvDateFrom('');
    setAdvDateTo('');
    setAdvTitle('');
    setAdvFrom('');
    setAdvTo('');
    setAdvHearingFilter('ALL');
    setIsAdvActive(false);
    setShowAdvanceSearchModal(false);
  };

  const handleApplyAdvSearch = () => {
    setIsAdvActive(true);
    setShowAdvanceSearchModal(false);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12 text-gray-100">
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 backdrop-blur-md p-5 rounded-2xl border border-white/10 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 shadow-lg shadow-amber-500/10">
            <FolderArchive size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide">Company Documents</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                {filteredDocuments.length} Records
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Legal, regulatory, customs, taxation, agreements, and official corporate archives with AI scanning.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 transition-all transform active:scale-95 cursor-pointer"
          >
            <Plus size={16} className="stroke-[3]" />
            <span>Add Document</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddCategoryModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 hover:border-amber-500/30 text-xs font-semibold transition cursor-pointer"
          >
            <FolderPlus size={14} className="text-amber-400" />
            <span>New Category</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAdvanceSearchModal(true)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              isAdvActive 
                ? 'bg-amber-500 text-slate-950 font-bold border-amber-400 shadow-lg shadow-amber-500/20' 
                : 'bg-white/5 hover:bg-white/10 text-gray-200 border-white/10 hover:border-amber-500/30'
            }`}
          >
            <Filter size={14} className={isAdvActive ? 'text-slate-950' : 'text-amber-400'} />
            <span>Advance Search</span>
            {isAdvActive && <span className="w-2 h-2 rounded-full bg-slate-950 ml-1"></span>}
          </button>
        </div>
      </div>

      {/* Main Search Input & Active Filter Bar & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Quick Search */}
        <div className="relative flex-1 max-w-xl">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search document title, subject, sender, recipient, reference #..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50 shadow-inner"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* View Switcher: Square Category Folders vs All Documents List */}
        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-white/10 shadow-inner">
            <button
              type="button"
              onClick={() => setViewMode('categories')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'categories'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <LayoutGrid size={13} />
              <span>Category Folders ({categories.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('documents')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'documents'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <FileText size={13} />
              <span>All Documents ({filteredDocuments.length})</span>
            </button>
          </div>

          {/* Active Filter Chips */}
          {isAdvActive && (
            <div className="flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-xl text-amber-300">
              <Filter size={13} />
              <span>Filtered</span>
              <button
                type="button"
                onClick={handleResetAdvSearch}
                className="ml-1 underline text-amber-400 hover:text-white font-bold cursor-pointer"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* When in Category View and user typed a search query, show prompt banner */}
      {viewMode === 'categories' && searchQuery && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-amber-400" />
            <span>Search query "{searchQuery}" matches <strong>{filteredDocuments.length}</strong> document(s) across archives.</span>
          </div>
          <button
            type="button"
            onClick={() => setViewMode('documents')}
            className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow transition cursor-pointer flex items-center gap-1"
          >
            <span>View Matching Documents</span>
            <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MAIN VIEW: SQUARE CATEGORY ICONS GRID (Default View)                     */}
      {/* ========================================================================= */}
      {viewMode === 'categories' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider font-bold text-gray-400">Company Document Folders</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/10 text-gray-300">
                {categories.length} Categories
              </span>
            </div>
            <span className="text-xs text-amber-400/80">Click any folder to view documents & download PDF</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4.5">
            {categories.map((cat) => {
              const meta = getCategoryMeta(cat);
              const CategoryIcon = meta.icon;
              const catDocs = documents.filter(d => d.category === cat);
              const count = catDocs.length;

              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setActiveCategoryModal(cat);
                    setCategoryModalSearch('');
                  }}
                  className={`aspect-square p-4 sm:p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between items-center text-center cursor-pointer group shadow-lg hover:shadow-2xl hover:scale-[1.03] active:scale-[0.98] bg-gradient-to-br ${meta.gradient} ${meta.borderColor} ${meta.glowColor}`}
                >
                  {/* Top Square Icon Badge */}
                  <div className={`w-13 h-13 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 ${meta.iconBg}`}>
                    <CategoryIcon size={26} className={meta.textColor} />
                  </div>

                  {/* Category Title & Badge */}
                  <div className="space-y-1.5 w-full px-1">
                    <h3 className="text-xs sm:text-sm font-black text-white group-hover:text-amber-300 transition-colors line-clamp-2 leading-tight">
                      {cat}
                    </h3>
                    <div className="flex justify-center">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono border ${
                        count > 0 
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30 font-bold' 
                          : 'bg-white/5 text-gray-400 border-white/10'
                      }`}>
                        {count} {count === 1 ? 'Document' : 'Documents'}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Action Prompt */}
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 group-hover:text-amber-400 transition-colors">
                    <span>Open Folder</span>
                    <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* ========================================================================= */
        /* ALL DOCUMENTS FLAT VIEW                                                   */
        /* ========================================================================= */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMode('categories')}
              className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-bold cursor-pointer"
            >
              <span>← Back to Category Folders</span>
            </button>
            <span className="text-xs text-gray-400 font-mono">Showing {filteredDocuments.length} Records</span>
          </div>

          {isLoading ? (
            <div className="py-20 text-center space-y-3">
              <Loader2 size={32} className="animate-spin text-amber-400 mx-auto" />
              <p className="text-xs text-gray-400">Loading company document archives...</p>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="py-16 text-center space-y-3 bg-slate-900/40 rounded-2xl border border-white/5 p-8">
              <FolderArchive size={40} className="text-gray-600 mx-auto" />
              <h3 className="text-sm font-bold text-gray-300">No Documents Found</h3>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                {isAdvActive || searchQuery
                  ? 'No documents match the specified filters. Try clearing your search criteria.'
                  : 'No documents have been recorded in this category yet. Click "Add Document" to upload a new record.'}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md transition cursor-pointer"
                >
                  <Plus size={14} /> Add Document Now
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocuments.map((doc) => {
                const catStyle = getCategoryStyle(doc.category);
                return (
                  <div
                    key={doc.id}
                    onClick={() => handleDownloadPdf(doc)}
                    className="bg-slate-900/70 hover:bg-slate-900 border border-white/10 hover:border-amber-500/30 rounded-2xl p-4.5 transition-all shadow-lg hover:shadow-amber-500/5 flex flex-col justify-between cursor-pointer group space-y-3"
                    title="Click to download PDF document"
                  >
                    {/* Top Badge & Action */}
                    <div className="flex items-start justify-between gap-2">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${catStyle.bg} ${catStyle.text} ${catStyle.border}`}>
                        <Tag size={10} /> {doc.category}
                      </span>

                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(doc)}
                          className="p-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/30 transition cursor-pointer"
                          title="Download PDF"
                        >
                          <Download size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedDocForPreview(doc)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition cursor-pointer"
                          title="View Details"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteDocument(doc.id, e)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-300 border border-white/10 transition cursor-pointer"
                          title="Delete Record"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Document Title & Reference */}
                    <div>
                      <h3 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors line-clamp-2">
                        {doc.title}
                      </h3>
                      {doc.referenceNo && (
                        <div className="text-[10px] font-mono text-amber-400/90 mt-0.5">
                          Ref #: {doc.referenceNo}
                        </div>
                      )}
                    </div>

                    {/* Subject & Summary */}
                    {doc.subject && (
                      <p className="text-xs text-gray-400 line-clamp-2 bg-black/25 p-2 rounded-xl border border-white/5">
                        {doc.subject}
                      </p>
                    )}

                    {/* Hearing Alert Box if applicable */}
                    {doc.hearingRequired && (
                      <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300">
                        <div className="flex items-center gap-1.5">
                          <Gavel size={14} className="text-amber-400 shrink-0" />
                          <span className="font-bold">Hearing Scheduled:</span>
                        </div>
                        <span className="font-mono font-bold text-[11px] text-white">
                          {doc.hearingDate || 'Scheduled'} {doc.hearingTime ? `@ ${doc.hearingTime}` : ''}
                        </span>
                      </div>
                    )}

                    {/* Expiry Badge if applicable */}
                    {doc.hasExpiry && doc.expiryDate && (() => {
                      const today = new Date().toISOString().split('T')[0];
                      const diffDays = Math.ceil((new Date(doc.expiryDate).getTime() - new Date(today).getTime()) / (24 * 60 * 60 * 1000));
                      const isExpired = diffDays <= 0;
                      const isExpiringSoon = diffDays > 0 && diffDays <= 10;
                      return (
                        <div className={`p-2 rounded-xl border flex items-center justify-between text-xs ${
                          isExpired 
                            ? 'bg-red-500/10 border-red-500/30 text-red-300' 
                            : isExpiringSoon 
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' 
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        }`}>
                          <div className="flex items-center gap-1.5 font-bold">
                            <Clock size={13} />
                            <span>{isExpired ? 'Expired:' : isExpiringSoon ? 'Expiring Soon:' : 'Valid Until:'}</span>
                          </div>
                          <span className="font-mono font-bold text-[11px]">
                            {doc.expiryDate} {isExpiringSoon ? `(${diffDays}d left)` : ''}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Bottom Meta Info (From, To, Date) */}
                    <div className="pt-2 border-t border-white/5 text-[11px] text-gray-400 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate max-w-[150px]">
                          <strong className="text-gray-300">From:</strong> {doc.from || 'Not specified'}
                        </span>
                        <span className="flex items-center gap-1 text-gray-400 shrink-0 font-mono text-[10px]">
                          <Calendar size={11} /> {doc.documentDate}
                        </span>
                      </div>
                      <div className="truncate">
                        <strong className="text-gray-300">To:</strong> {doc.to || activeCompany?.legalTitle || activeCompany?.name || 'Company'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* DEDICATED CATEGORY DOCUMENTS MODAL WINDOW (OPENS ON CATEGORY CLICK)       */}
      {/* ========================================================================= */}
      {activeCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto custom-scrollbar">
          <div className="bg-slate-900 border border-white/15 rounded-3xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5 sm:p-7 space-y-5 shadow-2xl custom-scrollbar my-auto flex flex-col">
            {/* Modal Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div className="flex items-center gap-3.5">
                {(() => {
                  const meta = getCategoryMeta(activeCategoryModal);
                  const IconComp = meta.icon;
                  return (
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg ${meta.iconBg}`}>
                      <IconComp size={24} className={meta.textColor} />
                    </div>
                  );
                })()}
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg sm:text-xl font-black text-white tracking-wide">
                      {activeCategoryModal}
                    </h2>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {activeCategoryDocuments.length} Documents
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {getCategoryMeta(activeCategoryModal).description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => {
                    setDocCategory(activeCategoryModal);
                    setShowAddModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition cursor-pointer"
                >
                  <Plus size={14} className="stroke-[3]" />
                  <span>Add Document</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveCategoryModal(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition cursor-pointer"
                  title="Close Window"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* In-Modal Search Bar */}
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={categoryModalSearch}
                onChange={(e) => setCategoryModalSearch(e.target.value)}
                placeholder={`Search within ${activeCategoryModal} (title, subject, reference #, date)...`}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50"
              />
              {categoryModalSearch && (
                <button
                  type="button"
                  onClick={() => setCategoryModalSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Documents List inside Category Modal */}
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1 min-h-[220px]">
              {activeCategoryDocuments.length === 0 ? (
                <div className="py-12 text-center space-y-3 bg-black/25 rounded-2xl border border-white/5 p-6">
                  {(() => {
                    const meta = getCategoryMeta(activeCategoryModal);
                    const EmptyIcon = meta.icon;
                    return (
                      <div className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center opacity-80 ${meta.iconBg}`}>
                        <EmptyIcon size={24} className={meta.textColor} />
                      </div>
                    );
                  })()}
                  <h4 className="text-sm font-bold text-gray-300">
                    {categoryModalSearch ? 'No Matching Documents' : `No Documents Recorded in ${activeCategoryModal}`}
                  </h4>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto">
                    {categoryModalSearch 
                      ? 'No documents match your keyword. Try clearing the search query.'
                      : `No files or notices have been uploaded under ${activeCategoryModal} yet. Click below to add the first document.`}
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDocCategory(activeCategoryModal);
                        setShowAddModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md transition cursor-pointer"
                    >
                      <Plus size={14} /> Upload First Document to {activeCategoryModal}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-[11px] text-gray-400 font-semibold flex items-center justify-between px-1">
                    <span>Click any document to download PDF directly</span>
                    <span>{activeCategoryDocuments.length} Record(s)</span>
                  </div>

                  {activeCategoryDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => handleDownloadPdf(doc)}
                      className="bg-slate-800/60 hover:bg-slate-800/90 border border-white/10 hover:border-amber-500/40 rounded-2xl p-4 transition-all shadow-md hover:shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer group"
                      title="Click to Download PDF"
                    >
                      {/* Document Details */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
                            {doc.title}
                          </h4>
                          {doc.referenceNo && (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              Ref: {doc.referenceNo}
                            </span>
                          )}
                          {doc.fileName && (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono text-gray-300 bg-white/5 border border-white/10 flex items-center gap-1">
                              <Paperclip size={10} className="text-amber-400" />
                              <span className="truncate max-w-[140px]">{doc.fileName}</span>
                            </span>
                          )}
                        </div>

                        {doc.subject && (
                          <p className="text-xs text-gray-300 line-clamp-1">
                            {doc.subject}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-400 font-mono">
                          <span className="flex items-center gap-1">
                            <Calendar size={11} className="text-amber-400" /> {doc.documentDate}
                          </span>
                          {doc.from && (
                            <span><strong>From:</strong> {doc.from}</span>
                          )}
                          {doc.to && (
                            <span><strong>To:</strong> {doc.to}</span>
                          )}
                        </div>

                        {doc.hearingRequired && (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] font-bold text-amber-300 mt-1">
                            <Gavel size={12} className="text-amber-400" />
                            <span>Hearing Scheduled: {doc.hearingDate || 'TBD'} {doc.hearingTime ? `@ ${doc.hearingTime}` : ''}</span>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(doc)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow transition cursor-pointer"
                          title="Download PDF"
                        >
                          <Download size={13} />
                          <span>Download PDF</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSelectedDocForPreview(doc)}
                          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition cursor-pointer"
                          title="View Details"
                        >
                          <Eye size={14} />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => handleDeleteDocument(doc.id, e)}
                          className="p-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-300 border border-white/10 transition cursor-pointer"
                          title="Delete Record"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Bottom Bar */}
            <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs text-gray-400">
              <span>Folder: <strong className="text-white">{activeCategoryModal}</strong></span>
              <button
                type="button"
                onClick={() => setActiveCategoryModal(null)}
                className="px-4 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-semibold cursor-pointer"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. ADD DOCUMENT MODAL (WITH AI OCR & CUSTOM CATEGORY) */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto custom-scrollbar">
          <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-5 shadow-2xl custom-scrollbar my-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                  <Plus size={18} />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-white">Add Company Document</h2>
                  <p className="text-[11px] text-gray-400">Upload letter/notice for AI reading or enter details manually</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            {/* Step 1: Upload Document Button (AI Auto-Reading) */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-slate-800/80 to-blue-500/10 border border-amber-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                  <Sparkles size={15} className="text-amber-400" />
                  <span>AI Document Scanner & Auto-Fill</span>
                </div>
                {aiAnalyzing && (
                  <span className="flex items-center gap-1.5 text-[11px] text-amber-300 font-semibold animate-pulse">
                    <Loader2 size={12} className="animate-spin" /> AI Reading document...
                  </span>
                )}
              </div>

              <p className="text-[11px] text-gray-300 leading-relaxed">
                Upload image or PDF document. AI will automatically scan and read the date, sender, recipient, subject, reference number, and legal hearing status!
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFilesSelected}
                  multiple
                  accept="image/*,application/pdf"
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={aiAnalyzing}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition cursor-pointer"
                >
                  <Upload size={14} />
                  <span>{uploadedFiles.length > 0 ? 'Upload More Documents' : 'Upload Document (PDF / Image)'}</span>
                </button>

                {uploadedFiles.length > 0 && (
                  <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 size={14} /> {uploadedFiles.length} file(s) attached
                  </span>
                )}
              </div>

              {/* Uploaded Files Chips */}
              {uploadedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {uploadedFiles.map((f, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 text-[10px] text-gray-200 border border-white/10 font-mono">
                      <Paperclip size={11} className="text-amber-400" />
                      <span className="truncate max-w-[180px]">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setUploadedFiles(uploadedFiles.filter((_, i) => i !== idx))}
                        className="text-red-400 hover:text-red-300 ml-1"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* AI Notice Banner */}
              {aiNotice && (
                <div className="p-2.5 rounded-lg bg-black/40 border border-amber-500/20 text-[11px] text-amber-200 flex items-start gap-2">
                  <Sparkles size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>{aiNotice}</span>
                </div>
              )}
            </div>

            {/* Document Form */}
            <form onSubmit={handleSaveDocument} className="space-y-4">
              {/* Category Dropdown with "+ Add New Category" button */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-300">Category *</label>
                  <button
                    type="button"
                    onClick={() => setShowAddCategoryModal(true)}
                    className="text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 underline cursor-pointer"
                  >
                    <Plus size={12} /> Add New Category
                  </button>
                </div>
                <select
                  value={docCategory}
                  onChange={(e) => setDocCategory(e.target.value)}
                  className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Grid: Document Date & Reference No */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Document Date *</label>
                  <input
                    type="date"
                    required
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                    className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Reference / Notice #</label>
                  <input
                    type="text"
                    value={docRefNo}
                    onChange={(e) => setDocRefNo(e.target.value)}
                    placeholder="e.g. FBR/2026/0991, SECP-REG-44"
                    className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                  />
                </div>
              </div>

              {/* Document Title */}
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Document Title *</label>
                <input
                  type="text"
                  required
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="e.g. Annual Tax Return Acknowledgment, Sindh Revenue Board Show-Cause Notice"
                  className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Grid: From & To */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">From (Sender & Address) *</label>
                  <input
                    type="text"
                    required
                    value={docFrom}
                    onChange={(e) => setDocFrom(e.target.value)}
                    placeholder="e.g. Commissioner Inland Revenue, RTO-II Karachi"
                    className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">To (Recipient & Address) *</label>
                  <input
                    type="text"
                    required
                    value={docTo}
                    onChange={(e) => setDocTo(e.target.value)}
                    placeholder={`e.g. ${activeCompany?.legalTitle || activeCompany?.name || 'Company'}, Executive Office, Karachi`}
                    className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Subject / Summary</label>
                <textarea
                  rows={2}
                  value={docSubject}
                  onChange={(e) => setDocSubject(e.target.value)}
                  placeholder="Subject of the letter or brief description..."
                  className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:outline-none focus:border-amber-400 resize-none"
                />
              </div>

              {/* Official Hearing Scheduled Option */}
              <div className="p-3.5 rounded-xl bg-black/30 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-white block">Official Hearing / Appearance Scheduled?</label>
                    <p className="text-[11px] text-gray-400">Select whether personal appearance or hearing date is scheduled.</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setHearingRequired(true)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        hearingRequired 
                          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20' 
                          : 'bg-white/5 text-gray-400 hover:text-white'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setHearingRequired(false)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        !hearingRequired 
                          ? 'bg-slate-700 text-white' 
                          : 'bg-white/5 text-gray-400 hover:text-white'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                {/* If Hearing Required = True, show Date & Time inputs */}
                {hearingRequired && (
                  <div className="pt-2 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in">
                    <div>
                      <label className="text-[11px] text-amber-300 font-semibold block mb-1">Hearing Date *</label>
                      <input
                        type="date"
                        required={hearingRequired}
                        value={hearingDate}
                        onChange={(e) => setHearingDate(e.target.value)}
                        className="w-full rounded-xl bg-black/50 border border-amber-500/30 p-2 text-xs text-white font-mono focus:border-amber-400"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-amber-300 font-semibold block mb-1">Hearing Time</label>
                      <input
                        type="time"
                        value={hearingTime}
                        onChange={(e) => setHearingTime(e.target.value)}
                        className="w-full rounded-xl bg-black/50 border border-amber-500/30 p-2 text-xs text-white font-mono focus:border-amber-400"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] text-gray-300 block mb-1">Hearing Bench / Court / Officer Notes</label>
                      <input
                        type="text"
                        value={hearingNotes}
                        onChange={(e) => setHearingNotes(e.target.value)}
                        placeholder="e.g. Before Honorable Collector Appeals, Custom House, Karachi"
                        className="w-full rounded-xl bg-black/50 border border-white/10 p-2 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Document Expiry Option */}
              <div className="p-3.5 rounded-xl bg-black/30 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-white block">Does this document have an expiry date?</label>
                    <p className="text-[11px] text-gray-400">If enabled, automated expiration notices are dispatched 10 days prior to expiry to Admin, Finance, and Operations.</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setHasExpiry(true)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        hasExpiry 
                          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20' 
                          : 'bg-white/5 text-gray-400 hover:text-white'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => { setHasExpiry(false); setExpiryDate(''); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        !hasExpiry 
                          ? 'bg-slate-700 text-white' 
                          : 'bg-white/5 text-gray-400 hover:text-white'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                {hasExpiry && (
                  <div className="pt-2 border-t border-white/10 animate-fade-in">
                    <label className="text-[11px] text-amber-300 font-semibold block mb-1">Document Expiry Date *</label>
                    <input
                      type="date"
                      required={hasExpiry}
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className="w-full rounded-xl bg-black/50 border border-amber-500/30 p-2 text-xs text-white font-mono focus:border-amber-400"
                    />
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-gray-400 hover:text-white transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 transition cursor-pointer"
                >
                  Save Document
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ADVANCE SEARCH MODAL */}
      {/* ========================================================================= */}
      {showAdvanceSearchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto custom-scrollbar">
          <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-4 shadow-2xl custom-scrollbar my-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Filter size={18} className="text-amber-400" />
                <h2 className="text-sm sm:text-base font-bold text-white">Advance Document Search</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvanceSearchModal(false)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Category Dropdown */}
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Category</label>
                <select
                  value={advCategory}
                  onChange={(e) => setAdvCategory(e.target.value)}
                  className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white"
                >
                  <option value="ALL">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Subcategory */}
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Subcategory / Document Type</label>
                <input
                  type="text"
                  value={advSubcategory}
                  onChange={(e) => setAdvSubcategory(e.target.value)}
                  placeholder="e.g. Notice, Order, Reply, Return, Challan"
                  className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white"
                />
              </div>

              {/* Date Selection (From & To) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-300 font-semibold block mb-1">Date From</label>
                  <input
                    type="date"
                    value={advDateFrom}
                    onChange={(e) => setAdvDateFrom(e.target.value)}
                    className="w-full rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-gray-300 font-semibold block mb-1">Date To</label>
                  <input
                    type="date"
                    value={advDateTo}
                    onChange={(e) => setAdvDateTo(e.target.value)}
                    className="w-full rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-white font-mono"
                  />
                </div>
              </div>

              {/* Document Title */}
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Document Title</label>
                <input
                  type="text"
                  value={advTitle}
                  onChange={(e) => setAdvTitle(e.target.value)}
                  placeholder="Filter by title..."
                  className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white"
                />
              </div>

              {/* Recipient / Addressee Filter */}
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Recipient / Addressee</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={advTo}
                    onChange={(e) => setAdvTo(e.target.value)}
                    placeholder="Recipient name..."
                    className="flex-1 rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-white"
                  />
                  {uniqueToList.length > 0 && (
                    <select
                      onChange={(e) => setAdvTo(e.target.value)}
                      className="w-32 rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-gray-300"
                    >
                      <option value="">Pick From List...</option>
                      {uniqueToList.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* From (Kisse Aaya) */}
              <div>
                <label className="text-gray-300 font-semibold block mb-1">From (Kisse document aaya list)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={advFrom}
                    onChange={(e) => setAdvFrom(e.target.value)}
                    placeholder="Sender name..."
                    className="flex-1 rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-white"
                  />
                  {uniqueFromList.length > 0 && (
                    <select
                      onChange={(e) => setAdvFrom(e.target.value)}
                      className="w-32 rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-gray-300"
                    >
                      <option value="">Pick From List...</option>
                      {uniqueFromList.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Hearing Filter */}
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Hearing Scheduled?</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdvHearingFilter('ALL')}
                    className={`p-2 rounded-xl border text-center transition cursor-pointer ${
                      advHearingFilter === 'ALL' ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold' : 'bg-black/30 border-white/10 text-gray-400'
                    }`}
                  >
                    All Documents
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvHearingFilter('YES')}
                    className={`p-2 rounded-xl border text-center transition cursor-pointer ${
                      advHearingFilter === 'YES' ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold' : 'bg-black/30 border-white/10 text-gray-400'
                    }`}
                  >
                    ⚖️ Hearing Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvHearingFilter('NO')}
                    className={`p-2 rounded-xl border text-center transition cursor-pointer ${
                      advHearingFilter === 'NO' ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold' : 'bg-black/30 border-white/10 text-gray-400'
                    }`}
                  >
                    No Hearing
                  </button>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-3 border-t border-white/10 flex items-center justify-between">
              <button
                type="button"
                onClick={handleResetAdvSearch}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-gray-400 hover:text-white"
              >
                Reset Filters
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanceSearchModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-gray-400"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyAdvSearch}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md cursor-pointer"
                >
                  Search Documents
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. ADD NEW CATEGORY SUB-MODAL */}
      {/* ========================================================================= */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-white/20 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Tag size={16} className="text-amber-400" /> Add New Category
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(false)}
                className="text-gray-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="text-xs text-gray-300 block mb-1">Category Name *</label>
              <input
                type="text"
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Legal Notices, Customs Port Clearances"
                className="w-full rounded-xl bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveCategory();
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(false)}
                className="px-3 py-1.5 rounded-xl bg-white/5 text-xs text-gray-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCategory}
                className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer shadow-md"
              >
                Save Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. DOCUMENT PREVIEW MODAL */}
      {/* ========================================================================= */}
      {selectedDocForPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-fade-in overflow-y-auto custom-scrollbar">
          <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-4 shadow-2xl custom-scrollbar my-auto">
            <div className="flex items-start justify-between border-b border-white/10 pb-3 gap-2">
              <div>
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border mb-1.5 ${getCategoryStyle(selectedDocForPreview.category).bg} ${getCategoryStyle(selectedDocForPreview.category).text} ${getCategoryStyle(selectedDocForPreview.category).border}`}>
                  {selectedDocForPreview.category}
                </span>
                <h2 className="text-base sm:text-lg font-bold text-white leading-snug">
                  {selectedDocForPreview.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDocForPreview(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Hearing Card if scheduled */}
            {selectedDocForPreview.hearingRequired && (
              <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-xs text-amber-300">
                  <Gavel size={15} />
                  <span>COURT / LEGAL HEARING SCHEDULED</span>
                </div>
                <div className="font-mono text-sm font-bold text-white">
                  Date: {selectedDocForPreview.hearingDate || 'Scheduled'} {selectedDocForPreview.hearingTime ? `@ ${selectedDocForPreview.hearingTime}` : ''}
                </div>
                {selectedDocForPreview.hearingNotes && (
                  <p className="text-[11px] text-gray-300 mt-1">{selectedDocForPreview.hearingNotes}</p>
                )}
              </div>
            )}

            {/* Document Details Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                <span className="text-gray-400 block text-[10px]">DOCUMENT DATE</span>
                <span className="text-white font-mono font-semibold">{selectedDocForPreview.documentDate}</span>
              </div>
              <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                <span className="text-gray-400 block text-[10px]">REFERENCE #</span>
                <span className="text-amber-300 font-mono font-semibold">{selectedDocForPreview.referenceNo || 'None'}</span>
              </div>
              <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                <span className="text-gray-400 block text-[10px]">SENDER (FROM)</span>
                <span className="text-white font-medium">{selectedDocForPreview.from || 'N/A'}</span>
              </div>
              <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                <span className="text-gray-400 block text-[10px]">RECIPIENT (TO)</span>
                <span className="text-white font-medium">{selectedDocForPreview.to || activeCompany?.legalTitle || activeCompany?.name || 'Company'}</span>
              </div>
            </div>

            {/* Subject */}
            {selectedDocForPreview.subject && (
              <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-xs">
                <span className="text-gray-400 block text-[10px] mb-1">SUBJECT / DESCRIPTION</span>
                <p className="text-gray-200 leading-relaxed whitespace-pre-wrap">{selectedDocForPreview.subject}</p>
              </div>
            )}

            {/* Attached File Preview if available */}
            {selectedDocForPreview.fileUrl && (
              <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-300 font-semibold flex items-center gap-1.5">
                    <Paperclip size={14} className="text-amber-400" />
                    <span>Attached Document: {selectedDocForPreview.fileName || 'document.pdf'}</span>
                  </span>
                </div>
                {selectedDocForPreview.fileUrl.startsWith('data:image/') && (
                  <div className="max-h-60 overflow-hidden rounded-lg border border-white/10">
                    <img 
                      src={selectedDocForPreview.fileUrl} 
                      alt="Preview" 
                      className="w-full h-auto object-contain max-h-60" 
                    />
                  </div>
                )}
              </div>
            )}

            {/* Modal Actions */}
            <div className="pt-3 border-t border-white/10 flex items-center justify-between">
              <button
                type="button"
                onClick={(e) => {
                  handleDeleteDocument(selectedDocForPreview.id, e);
                  setSelectedDocForPreview(null);
                }}
                className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold border border-red-500/20 flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 size={13} /> Delete Document
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDocForPreview(null)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-gray-300 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadPdf(selectedDocForPreview)}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md cursor-pointer"
                >
                  <Download size={14} /> Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyDocuments;

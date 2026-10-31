import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  ChevronRight, ChevronDown, CheckCircle2, Upload, FileText, CheckCircle, Loader2, Save, 
  MapPin, Anchor, Box, User, AlertCircle, Calendar, Camera, X, Truck, Briefcase, 
  Search, Eye, Share2, AlertTriangle, ArrowLeft, Download, Trash2, Edit, Plus, ListFilter, Filter,
  Sparkles, Scan, FileCheck, Globe, Receipt, Scale, Ship, UploadCloud, Play, Clock, ArrowRight, RefreshCw, Layers,
  Building, Phone, Mail, DollarSign, Tag, Package, ShieldCheck, XCircle, Copy, Check, ExternalLink
} from 'lucide-react';
import Logo from './Logo';
import { LegalDocumentHeader, LegalDocumentFooter } from './LegalDocumentHeader';
import { useBranding } from '../services/brandingService';
import { autoFillCaseData, downloadFile, docDataCache, detectShippingDocumentType, analyzeReceiptWithAI } from '../services/geminiService';
import { downloadCasePdf, sharePdfFile, downloadCustomsDeliveryOrderPdf, downloadLoadingBillPdf } from '../services/pdfExportService';
import { exportTableToExcel } from '../services/excelExportService';
import { PdfViewerModal } from './PdfViewerModal';
import { detectMimeType, compressAndPrepareFile, convertImageToPdf } from '../services/fileUtils';
import { Container, ExtractedData, CaseStatus, Case, MockDocument, UserRole, CaseCharge, Client, ClientDefaultCharge, CaseStepDetail, WORKFLOW_8_STEPS, Vehicle } from '../types';
import { WorkflowStepModal } from './WorkflowStepModal';
import { CompletedCaseDossier } from './CompletedCaseDossier';
import { CaseTransitHistoryCard } from './CaseTransitHistoryCard';
import { VirtualizedList, VirtualizedTable } from './VirtualizedList';
import { submitCaseActionApproval } from '../services/approvalService';
import { saveDocumentToIndexedDB, getDocumentFromIndexedDB } from '../services/documentStorage';

/**
 * Auto-approving internal management roles:
 * - Admin (ADMIN)
 * - Operations Manager (OPERATIONS_MANAGER)
 * - Case Manager (CASE_MANAGER)
 * - Finance Manager (FINANCE_MANAGER)
 * Cases registered by these roles are automatically APPROVED without triggering any approval notifications.
 * Only Client Portal registrations require approval and notify Operations Manager, Admin, and Case Manager.
 */
function isInternalStaffAutoApproving(role?: string | UserRole, roles?: UserRole[]): boolean {
  const norm = (r?: any) => String(r || '').toUpperCase().trim();
  const check = (r?: any) => {
    const s = norm(r);
    if (!s) return false;
    if (s === UserRole.CLIENT || s === UserRole.TRANSPORTER || s === UserRole.VENDOR) {
      return false;
    }
    return (
      s === UserRole.ADMIN ||
      s === UserRole.OPERATIONS_MANAGER ||
      s === UserRole.CASE_MANAGER ||
      s === UserRole.FINANCE_MANAGER ||
      s === UserRole.OFFICE_STAFF ||
      s === UserRole.VEHICLE_MANAGER ||
      s.includes('ADMIN') ||
      s.includes('OPERATION') ||
      s.includes('CASE_MAN') ||
      s.includes('FINANCE') ||
      s.includes('OFFICE')
    );
  };

  if (check(role)) return true;
  if (roles && Array.isArray(roles) && roles.some(check)) return true;
  return false;
}

function isOfficeStaffRole(role?: string | UserRole): boolean {
  if (!role) return true;
  const r = String(role).toUpperCase();
  if (r === UserRole.CLIENT || r === UserRole.TRANSPORTER || r === UserRole.VENDOR) {
    return false;
  }
  return true;
}
import { 
  PAKISTAN_CUSTOMS_COMPLIANCE, 
  getStandardChargesForCategory, 
  validateCustomsCompliance,
  CategoryComplianceDetail
} from '../services/customsComplianceService';
import { safeSessionStorage, safeLocalStorage, safeAppStorage } from '../services/storage';
import { appLifecycle } from '../services/lifecycle';
import { 
  PRIMARY_SERVICE_CATEGORIES, 
  SUB_CATEGORY_OPTIONS, 
  supportsSubCategories, 
  getCategoryWorkflow, 
  getWorkflowStepIndex,
  isDestinationUnloadedAndGateOut 
} from '../services/workflowConfig';
import {
  getCategoryArrangements,
  getArrangementCharges,
  resolveCaseCharges,
  saveChargeAsClientDefault,
  scaleBondedCarrierChargesByContainers,
  CATEGORY_SERVICE_ARRANGEMENTS,
  ServiceArrangementItem,
  normalizeCategoryKey
} from '../services/categoryTariffService';
import { ClientRegistrationModal } from './ClientRegistrationModal';
import { SmartCaseSearchModal } from './SmartCaseSearchModal';
import { logActivity } from '../services/activityLogService';
import { generateDplCaseNumber, getDestinationCode, getCaseInvoiceNumber } from '../services/caseNumberService';
import { useActiveCompany, getActiveCompanyPrefix } from '../services/companyService';
import { CameraDocumentScannerModal } from './CameraDocumentScannerModal';
import { jsPDF } from 'jspdf';

export interface UploadedDocRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  docCategory?: 'BL' | 'INVOICE' | 'PACKING_LIST' | 'CLIENT_REQUEST' | 'DELIVERY_ORDER' | 'GOODS_DECLARATION' | 'ALL_IN_ONE' | 'GENERAL';
}

export const TOP_SHIPPING_LINES_SHOWCASE = [
  { name: 'Maersk Line', prefix: 'MSKU / MRKU', flag: '🇩🇰' },
  { name: 'MSC', prefix: 'MEDU / MSCU', flag: '🇨🇭' },
  { name: 'CMA CGM', prefix: 'CMAU / APZU', flag: '🇫🇷' },
  { name: 'COSCO Shipping', prefix: 'COSU / CBHU', flag: '🇨🇳' },
  { name: 'Hapag-Lloyd', prefix: 'HLCU / HLXU', flag: '🇩🇪' },
  { name: 'ONE (Ocean Network)', prefix: 'ONEY / NYKU', flag: '🇯🇵' },
  { name: 'Evergreen Marine', prefix: 'EMCU / EGLV', flag: '🇹🇼' },
  { name: 'HMM', prefix: 'HDMU', flag: '🇰🇷' },
  { name: 'Yang Ming', prefix: 'YMLU', flag: '🇹🇼' },
  { name: 'OOCL / PIL / Wan Hai', prefix: 'OOLU / PCIU', flag: '🌏' }
];
import { 
  subscribeToCases, 
  saveCaseToFirestore, 
  updateCaseInFirestore, 
  deleteCaseFromFirestore,
  subscribeToClients,
  saveClientToFirestore,
  DEFAULT_CLIENTS,
  saveUserWorkDraftToFirestore,
  getUserWorkDraftFromFirestore,
  deleteUserWorkDraftFromFirestore
} from '../services/dbService';
import { sendAppNotification } from '../services/notificationService';

export interface PortItem {
  name: string;
  code: string;
  type?: 'Sea Port' | 'Dry Port' | 'Border Terminal' | string;
  containerInquiryLink?: string;
}

const INITIAL_PORTS: PortItem[] = [
  // Sea Ports / Terminal
  { name: "Karachi Port Trust", code: "KPT", type: "Sea Port", containerInquiryLink: "https://kpt.gov.pk" },
  { name: "Port Qasim", code: "QICT", type: "Sea Port", containerInquiryLink: "https://www.dpworld.com/karachi" },
  { name: "South Asia Pakistan Terminals", code: "SAPT", type: "Sea Port", containerInquiryLink: "https://www.sapt.com.pk" },
  { name: "Karachi International Container Terminal", code: "KICT", type: "Sea Port", containerInquiryLink: "https://www.kictl.com" },
  { name: "Karachi Gateway Terminal", code: "KGTL", type: "Sea Port", containerInquiryLink: "https://kpt.gov.pk" },
  { name: "Karachi Gateway Terminal Multipurpose", code: "KGTML", type: "Sea Port", containerInquiryLink: "https://kpt.gov.pk" },
  { name: "Al-Hamd International Container Terminal", code: "AICT", type: "Sea Port", containerInquiryLink: "https://www.kictl.com" },
  { name: "Pakistan International Container Terminal", code: "PICT", type: "Sea Port", containerInquiryLink: "https://pict.com.pk" },
  { name: "Gwadar Port", code: "GWADAR", type: "Sea Port", containerInquiryLink: "https://gpa.gov.pk" },
  { name: "NLC Sultanabad", code: "NLC Sultanabad", type: "Sea Port", containerInquiryLink: "https://nlc.com.pk" },

  // Dry Ports
  { name: "Faisalabad Dry Port", code: "Faisalabad Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Lahore Dry Port", code: "Lahore Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Lahore NLC Dry Port", code: "Lahore NLC", type: "Dry Port", containerInquiryLink: "https://nlc.com.pk" },
  { name: "Lahore MICT Dry Port", code: "Lahore MICT", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Lahore DPW Dry Port", code: "Lahore DPW", type: "Dry Port", containerInquiryLink: "https://dpworld.com" },
  { name: "Rawalpindi Dry Port", code: "Rawalpindi Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Multan Dry Port", code: "Multan Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Sialkot Dry Port", code: "SICT", type: "Dry Port", containerInquiryLink: "https://sict.com.pk" },
  { name: "Islamabad Dry Port", code: "Islamabad Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Azakhel Dry Port", code: "Azakhel Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Havelian Dry Port", code: "Havelian Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Peshawar Dry Port", code: "Peshawar Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Jamrud Dry Port", code: "Jamrud Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Quetta Railway Dry Port", code: "Quetta Railway", type: "Dry Port", containerInquiryLink: "https://pakrail.gov.pk" },
  { name: "Quetta NLC Dry Port", code: "Quetta NLC", type: "Dry Port", containerInquiryLink: "https://nlc.com.pk" },
  { name: "Gilgit Dry Port", code: "Gilgit Dry Port", type: "Dry Port", containerInquiryLink: "https://customs.gov.pk" },
  { name: "Sost Dry Port", code: "Sost Dry Port", type: "Dry Port" },
  { name: "Muzaffarabad Dry Port", code: "Muzaffarabad", type: "Dry Port" },
  { name: "Karachi Dry Port", code: "Karachi Dry Port", type: "Dry Port" },
  { name: "Karachi NLC Dry Port", code: "Karachi NLC", type: "Dry Port" },

  // Border Terminals & Crossings
  { name: "Wagha Border Terminal", code: "Wagha Border", type: "Border Terminal" },
  { name: "Torkham Border Terminal", code: "Torkham Border", type: "Border Terminal" },
  { name: "Chaman Border Terminal", code: "Chaman Border", type: "Border Terminal" },
  { name: "Taftan Border Terminal", code: "Taftan Border", type: "Border Terminal" },
  { name: "Angur Ada", code: "Angur Ada", type: "Border Terminal" },
  { name: "Badini", code: "Badini", type: "Border Terminal" },
  { name: "Ghulam Khan", code: "Ghulam Khan", type: "Border Terminal" },
  { name: "Kharlachi", code: "Kharlachi", type: "Border Terminal" },
  { name: "Mand", code: "Mand", type: "Border Terminal" }
];

/**
 * Autocomplete Searchable Port Input Component
 * Allows user to type letters to filter ports, see suggestions below,
 * clear, toggle list, and click "+ Add Port" without leaving the page.
 */
interface PortSearchableInputProps {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (val: string) => void;
  ports: PortItem[];
  targetField: 'pol' | 'pod';
  placeholder?: string;
  onOpenAddPort: (targetField: 'pol' | 'pod', initialName?: string) => void;
}

const PortSearchableInput: React.FC<PortSearchableInputProps> = ({
  label,
  icon,
  value,
  onChange,
  ports,
  targetField,
  placeholder = 'Type port name or code...',
  onOpenAddPort
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(value || '');
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync internal search term when parent value changes
  useEffect(() => {
    setSearchTerm(value || '');
  }, [value]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter ports based on search term
  const filteredPorts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return ports;
    return ports.filter(p => 
      p.name.toLowerCase().includes(term) || 
      (p.code && p.code.toLowerCase().includes(term))
    );
  }, [ports, searchTerm]);

  const handleSelectPort = (portName: string) => {
    onChange(portName);
    setSearchTerm(portName);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setSearchTerm('');
    setIsOpen(true);
  };

  const isExactMatch = ports.some(p => p.name.toLowerCase() === searchTerm.trim().toLowerCase());

  return (
    <div ref={containerRef} className={`space-y-1.5 relative ${isOpen ? 'z-50' : 'z-20'}`}>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs text-brand-300 font-medium">
          {icon} {label}
        </label>
      </div>

      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full glass-input rounded-xl p-3 sm:p-3.5 outline-none text-sm text-white bg-black/60 border border-white/15 focus:border-brand-400 pr-16"
        />

        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchTerm && (
            <button
              type="button"
              onClick={handleClear}
              className="text-gray-400 hover:text-white p-1 rounded-md"
              title="Clear port"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(prev => !prev)}
            className="text-gray-400 hover:text-white p-1 rounded-md"
            title="Toggle port list"
          >
            <ChevronDown size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-brand-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Autocomplete Suggestion Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-[9999] bg-slate-900/98 backdrop-blur-2xl border border-brand-500/30 rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto">
          {filteredPorts.length > 0 ? (
            <div className="py-1 divide-y divide-white/5">
              {filteredPorts.map((p, idx) => {
                const isSelected = p.name.toLowerCase() === value.toLowerCase();
                return (
                  <button
                    key={`${targetField}-${p.code || p.name}-${idx}`}
                    type="button"
                    onClick={() => handleSelectPort(p.name)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between text-xs sm:text-sm hover:bg-brand-500/20 transition-colors ${
                      isSelected ? 'bg-brand-500/30 text-white font-semibold' : 'text-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate pr-2">
                      <Anchor size={13} className="text-brand-400 shrink-0" />
                      <span className="truncate">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {p.code && p.code !== p.name && (
                        <span className="font-mono text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-gray-300">
                          {p.code}
                        </span>
                      )}
                      {p.type && (
                        <span className="text-[9px] bg-brand-500/20 text-brand-300 border border-brand-500/30 px-1.5 py-0.5 rounded uppercase font-medium">
                          {p.type}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-3 text-center text-xs text-gray-400">
              No matching port found for "{searchTerm}"
            </div>
          )}

          {/* Quick Add Option inside Dropdown */}
          {searchTerm.trim() && !isExactMatch && (
            <div className="p-1.5 bg-black/40 border-t border-white/10">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenAddPort(targetField, searchTerm.trim());
                }}
                className="w-full text-left p-2 rounded-lg bg-brand-600/30 hover:bg-brand-600/50 text-brand-300 text-xs flex items-center gap-2 transition-colors font-medium"
              >
                <Plus size={14} className="text-brand-400 shrink-0" />
                <span>Add "<strong>{searchTerm.trim()}</strong>" as New Port</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const CATEGORIES = PRIMARY_SERVICE_CATEGORIES;

const MOCK_CLIENTS = [
  "Trial Client"
];

// Clean Initial Cases for Live Operation
const INITIAL_CASES: Case[] = [];

// Operational Services Arrangement Definitions (Arranged by DPL vs Client)
export const INITIAL_REGISTRATION_ARRANGEMENTS: Record<string, { label: string; arrangedBy: 'DPL' | 'Client'; amount: number }> = getCategoryArrangements('Bonded Carrier');

export const getArrangementInitialCharges = (arrangements: Record<string, { label: string; arrangedBy: 'DPL' | 'Client'; amount: number }>): CaseCharge[] => {
  return getArrangementCharges(arrangements as any);
};

// Configuration for Report Columns (Optimized for zero-horizontal-scrolling)
const REPORT_COLUMNS = [
  { key: 'caseNo', label: 'CASE NO' },
  { key: 'createdAt', label: 'DATE' },
  { key: 'clientName', label: 'CLIENT' },
  { key: 'category', label: 'CATEGORY' },
  { key: 'status', label: 'STATUS' },
  { key: 'pol', label: 'PORT OF LOADING' },
  { key: 'pod', label: 'PORT OF DELIVERY' },
];

interface CaseManagementProps {
    initialFilter?: any;
    clearFilter?: () => void;
    onActionComplete?: (notificationId: number) => void;
    customLogo?: string | null;
    userRole?: UserRole;
    userRoles?: UserRole[];
    currentClientName?: string;
}

const CaseManagement: React.FC<CaseManagementProps> = ({ 
  initialFilter, 
  clearFilter, 
  onActionComplete, 
  customLogo,
  userRole: propUserRole,
  userRoles: propUserRoles,
  currentClientName: propClientName
}) => {
  const branding = useBranding();
  const { activeCompany } = useActiveCompany();
  const { companyName, subtitle } = branding;
  const activeLogo = customLogo || branding.customLogo || activeCompany?.logo;
  const [view, setView] = useState<'list' | 'register' | 'details'>('list');
  const [activeNotificationId, setActiveNotificationId] = useState<number | null>(null);
  const [showSmartSearchModal, setShowSmartSearchModal] = useState(false);
  const [cases, setCases] = useState<Case[]>(() => {
    return safeAppStorage.getJSON<Case[]>('dpl_live_cases', INITIAL_CASES);
  });
  const [selectedCase, setSelectedCase] = useState<any>(() => {
    return safeAppStorage.getJSON<any>('dpl_selected_case', null);
  });

  // Preserve selectedCase across app switching & tab freezing
  useEffect(() => {
    if (selectedCase) {
      safeAppStorage.setJSON('dpl_selected_case', selectedCase);
      safeAppStorage.setItem('dpl_selected_case_id', selectedCase.id || '');
    } else if (view !== 'details') {
      safeAppStorage.removeItem('dpl_selected_case');
      safeAppStorage.removeItem('dpl_selected_case_id');
    }
  }, [selectedCase, view]);

  // Persist active view in safeAppStorage
  useEffect(() => {
    safeAppStorage.setItem('dpl_reg_view', view);
  }, [view]);

  // Restore selectedCase from cases list if returning from background/gallery
  useEffect(() => {
    if (view === 'details' && !selectedCase && cases.length > 0) {
      const savedId = safeAppStorage.getItem('dpl_selected_case_id');
      if (savedId) {
        const found = cases.find(c => c.id === savedId || c.caseNo === savedId);
        if (found) {
          setSelectedCase(found);
        }
      }
    }
  }, [view, selectedCase, cases]);

  // Synchronize cases with Firestore
  useEffect(() => {
    const unsubscribe = subscribeToCases(
      (firestoreCases) => {
        if (firestoreCases) {
          setCases(firestoreCases);
          safeAppStorage.setJSON('dpl_live_cases', firestoreCases);
          // If viewing details, update selectedCase with live Firestore changes
          if (view === 'details' && selectedCase) {
            const updated = firestoreCases.find(c => c.id === selectedCase.id || c.caseNo === selectedCase.caseNo);
            if (updated) setSelectedCase(updated);
          }
        }
      },
      (err) => {
        console.warn("Firestore case subscription note:", err);
      }
    );

    const handleCasesUpdated = (e: any) => {
      if (e.detail && Array.isArray(e.detail)) {
        setCases(e.detail);
      }
    };
    window.addEventListener('dpl_cases_updated', handleCasesUpdated);

    return () => {
      unsubscribe();
      window.removeEventListener('dpl_cases_updated', handleCasesUpdated);
    };
  }, [view, selectedCase?.id]);

  // Synchronize Registered Clients with Firestore & Cases
  const [clientsData, setClientsData] = useState<Client[]>([]);
  const [registeredClients, setRegisteredClients] = useState<string[]>(DEFAULT_CLIENTS);
  const [isOtherClient, setIsOtherClient] = useState(false);
  const [otherClientName, setOtherClientName] = useState('');

  useEffect(() => {
    const unsubscribeClients = subscribeToClients((clientsList) => {
      // Identify consignee names from cases so we don't confuse B/L consignees with Registered Clients
      const consigneeNamesSet = new Set(
        cases
          .map(c => (c.extractedData?.consigneeName || '').trim().toLowerCase())
          .filter(Boolean)
      );

      // Real registered clients: clients explicitly created with details or whose name is not merely an auto-saved consignee
      const realClientsList = clientsList.filter(c => {
        const cName = (c.name || '').trim().toLowerCase();
        if (!cName) return false;
        const hasClientDetails = Boolean(
          c.ownerName || c.contact || c.mobileNumber || c.email || c.ntn || c.officeAddress || (c.defaultCharges && c.defaultCharges.length > 0)
        );
        if (hasClientDetails) return true;
        return !consigneeNamesSet.has(cName);
      });

      const effectiveClientsList = realClientsList.length > 0 ? realClientsList : clientsList;
      setClientsData(effectiveClientsList);

      const dbNames = effectiveClientsList.map(c => c.name).filter(Boolean);
      const validCaseClientNames = cases
        .filter(c => {
          const cName = (c.clientName || '').trim().toLowerCase();
          const consName = (c.extractedData?.consigneeName || '').trim().toLowerCase();
          return Boolean(cName) && cName !== consName;
        })
        .map(c => c.clientName)
        .filter(Boolean);

      const combined = Array.from(new Set([...DEFAULT_CLIENTS, ...dbNames, ...validCaseClientNames]));
      setRegisteredClients(combined);

      // Auto-repair any existing case where clientName was mistakenly overwritten by extractedData.consigneeName
      if (dbNames.length > 0) {
        const primaryRegisteredClient = dbNames[0];
        let anyRepaired = false;
        const repairedCases = cases.map(c => {
          const cClient = (c.clientName || '').trim();
          const cConsignee = (c.extractedData?.consigneeName || '').trim();
          if (cClient && cConsignee && cClient.toLowerCase() === cConsignee.toLowerCase() && !dbNames.some(n => n.toLowerCase() === cClient.toLowerCase())) {
            anyRepaired = true;
            const fixedCase = { ...c, clientName: primaryRegisteredClient };
            updateCaseInFirestore(fixedCase).catch(() => {});
            return fixedCase;
          }
          return c;
        });

        if (anyRepaired) {
          setCases(repairedCases);
          safeAppStorage.setJSON('dpl_live_cases', repairedCases);
          if (selectedCase) {
            const matchFixed = repairedCases.find(rc => rc.id === selectedCase.id || rc.caseNo === selectedCase.caseNo);
            if (matchFixed && matchFixed.clientName !== selectedCase.clientName) {
              setSelectedCase(matchFixed);
              safeAppStorage.setJSON('dpl_selected_case', matchFixed);
            }
          }
        }
      }
    });
    return () => unsubscribeClients();
  }, [cases, selectedCase?.id]);

  // User role state
  const [mockUserRole, setMockUserRole] = useState(UserRole.ADMIN);

  // Determine effective user role and multi-roles
  const effectiveRole = propUserRole || (safeAppStorage.getItem('dpl_user_role') as UserRole) || mockUserRole || UserRole.ADMIN;
  const effectiveRoles: UserRole[] = useMemo(() => {
    if (propUserRoles && propUserRoles.length > 0) return propUserRoles;
    const stored = safeAppStorage.getItem('dpl_user_roles');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.warn("Could not parse dpl_user_roles:", e);
      }
    }
    return [effectiveRole];
  }, [propUserRoles, effectiveRole]);

  const hasAdminRole = effectiveRoles.includes(UserRole.ADMIN);
  const hasOpsRole = hasAdminRole || effectiveRoles.includes(UserRole.OPERATIONS_MANAGER);
  const hasFinanceRole = hasAdminRole || effectiveRoles.includes(UserRole.FINANCE_MANAGER);
  const hasLoadingRole = hasAdminRole || effectiveRoles.includes(UserRole.LOADING_PORT_STAFF);
  const hasUnloadingRole = hasAdminRole || effectiveRoles.includes(UserRole.UNLOADING_PORT_STAFF) || effectiveRoles.includes(UserRole.DESTINATION_PORT_STAFF);

  // Approval request state for finished cases
  const [showApprovalPromptModal, setShowApprovalPromptModal] = useState(false);
  const [approvalTargetAction, setApprovalTargetAction] = useState<'DELETE' | 'CANCEL' | 'EDIT'>('EDIT');
  const [approvalReason, setApprovalReason] = useState('');
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);

  const effectiveClientName = propClientName || safeAppStorage.getItem('dpl_client_name') || 'Global Traders Ltd';
  const isClientUser = effectiveRole === UserRole.CLIENT;

  // Retrieve client's default category from profile or previous cases
  const getClientDefaultCategory = (clientName: string): string => {
    if (!clientName) return 'Bonded Carrier';
    const foundClient = clientsData.find(c => c.name?.toLowerCase() === clientName.toLowerCase());
    if (foundClient?.defaultCaseCategory) return foundClient.defaultCaseCategory;
    const prevCase = cases.find(c => c.clientName?.toLowerCase() === clientName.toLowerCase() && c.category);
    return prevCase?.category || 'Bonded Carrier';
  };

  const handleClientSelect = (clientName: string) => {
    if (clientName === '__ADD_NEW_CLIENT__' || clientName === '__OTHERS__') {
      setIsOtherClient(false);
      setShowAddClientModal(true);
    } else {
      setIsOtherClient(false);
      const foundClient = clientsData.find(c => c.name?.toLowerCase() === clientName.toLowerCase());
      const defaultCat = foundClient?.defaultCaseCategory || getClientDefaultCategory(clientName) || formData.category || 'Bonded Carrier';
      
      // Resolve charges & arrangements based on category & client default rules (scaled by containers for Bonded Carrier)
      const resolved = resolveCaseCharges(foundClient, defaultCat, undefined, formData.containers);

      setFormData(prev => ({
        ...prev,
        client: clientName,
        category: defaultCat,
        serviceArrangements: resolved.arrangements as any,
        charges: scaleBondedCarrierChargesByContainers(resolved.charges, defaultCat, prev.containers)
      }));

      if (resolved.isClientCustomDefault) {
        setDraftToast(`✓ Loaded ${resolved.charges.length} default charges configured for ${clientName}`);
      } else {
        setDraftToast(`✓ Applied ${defaultCat} operational service arrangements`);
      }
    }
  };

  const handleOtherClientChange = (val: string) => {
    setOtherClientName(val);
    setFormData(prev => ({ ...prev, client: val.trim() }));
  };

  // Dynamic Ports State with persistence
  const [ports, setPorts] = useState<PortItem[]>(() => {
    return safeAppStorage.getJSON('dpl_ports', INITIAL_PORTS);
  });
  const [showPortModal, setShowPortModal] = useState(false);
  const [portTargetField, setPortTargetField] = useState<'pol' | 'pod' | null>(null);
  const [newPortName, setNewPortName] = useState('');
  const [newPortCode, setNewPortCode] = useState('');
  const [newPortType, setNewPortType] = useState('Dry Port');
  const [newPortInquiryLink, setNewPortInquiryLink] = useState('');

  // Edit Port Modal State
  const [showEditPortModal, setShowEditPortModal] = useState(false);
  const [selectedPortToEdit, setSelectedPortToEdit] = useState<string>('');
  const [editPortName, setEditPortName] = useState('');
  const [editPortCode, setEditPortCode] = useState('');
  const [editPortType, setEditPortType] = useState('Sea Port');
  const [editPortInquiryLink, setEditPortInquiryLink] = useState('');

  // Client Modal State & Default Charges State
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [newClientForm, setNewClientForm] = useState({
    name: '',
    ownerName: '',
    contact: '',
    mobileNumber: '',
    whatsappNumber: '',
    email: '',
    ntn: '',
    strn: '',
    officeAddress: '',
    defaultCaseCategory: 'Bonded Carrier'
  });

  const [clientChargesList, setClientChargesList] = useState<ClientDefaultCharge[]>([]);

  const handleSaveNewClientWithCharges = async () => {
    if (!newClientForm.name.trim()) {
      alert('Please enter Client / Company Name');
      return;
    }
    const clientNameTrimmed = newClientForm.name.trim();
    const clientId = `client_${Date.now()}`;

    const clientToSave: Client = {
      id: clientId,
      name: clientNameTrimmed,
      ownerName: newClientForm.ownerName.trim(),
      contact: newClientForm.contact.trim(),
      mobileNumber: newClientForm.mobileNumber.trim(),
      whatsappNumber: newClientForm.whatsappNumber.trim() || newClientForm.mobileNumber.trim(),
      email: newClientForm.email.trim(),
      ntn: newClientForm.ntn.trim(),
      strn: newClientForm.strn.trim(),
      officeAddress: newClientForm.officeAddress.trim(),
      defaultCaseCategory: newClientForm.defaultCaseCategory || 'Bonded Carrier',
      defaultCharges: clientChargesList,
      createdAt: new Date().toISOString()
    };

    try {
      await saveClientToFirestore(clientToSave);
    } catch (err) {
      console.warn("Could not save client to Firestore:", err);
    }

    setClientsData(prev => [clientToSave, ...prev.filter(c => c.name.toLowerCase() !== clientNameTrimmed.toLowerCase())]);
    setRegisteredClients(prev => Array.from(new Set([clientNameTrimmed, ...prev])));

    const appliedCharges: CaseCharge[] = clientChargesList.map((ch, idx) => ({
      id: `chg_${Date.now()}_${idx}`,
      category: ch.category || clientToSave.defaultCaseCategory || 'Bonded Carrier',
      description: ch.description,
      amount: Number(ch.defaultAmount) || 0,
      taxable: ch.taxable ?? false
    }));

    setFormData(prev => ({
      ...prev,
      client: clientNameTrimmed,
      category: clientToSave.defaultCaseCategory || 'Bonded Carrier',
      charges: appliedCharges
    }));

    setIsOtherClient(false);
    setOtherClientName('');
    setShowAddClientModal(false);
    setDraftToast(`✓ Client "${clientNameTrimmed}" registered with ${appliedCharges.length} default charges applied!`);
  };

  const handleAddPort = (targetField?: 'pol' | 'pod' | null) => {
    if (!newPortName.trim()) return;
    const trimmed = newPortName.trim();
    const code = newPortCode.trim() || (trimmed.length <= 4 ? trimmed.toUpperCase() : trimmed.substring(0, 4).toUpperCase());
    const newPortObj: PortItem = { 
      name: trimmed, 
      code, 
      type: newPortType,
      containerInquiryLink: newPortInquiryLink.trim()
    };
    const updatedPorts = [...ports.filter(p => p.name.toLowerCase() !== trimmed.toLowerCase()), newPortObj];
    setPorts(updatedPorts);
    safeAppStorage.setJSON('dpl_ports', updatedPorts);

    const fieldToUpdate = targetField !== undefined ? targetField : portTargetField;
    if (fieldToUpdate === 'pol') {
      setFormData(prev => ({ 
        ...prev, 
        pol: trimmed,
        extractedData: { ...prev.extractedData, pickupDestination: trimmed }
      }));
    } else if (fieldToUpdate === 'pod') {
      setFormData(prev => ({ 
        ...prev, 
        pod: trimmed,
        extractedData: { ...prev.extractedData, dropoffDestination: trimmed }
      }));
    }

    setNewPortName('');
    setNewPortCode('');
    setNewPortType('Dry Port');
    setNewPortInquiryLink('');
    setShowPortModal(false);
    setPortTargetField(null);
    setDraftToast(`✓ Port "${trimmed}" added to all port lists!`);
  };

  const handleOpenEditPort = (portNameToSelect?: string) => {
    if (ports.length === 0) return;
    const portName = portNameToSelect || ports[0].name;
    setSelectedPortToEdit(portName);
    const found = ports.find(p => p.name === portName) || ports[0];
    setEditPortName(found.name);
    setEditPortCode(found.code);
    setEditPortType(found.type || 'Sea Port');
    setEditPortInquiryLink(found.containerInquiryLink || '');
    setShowEditPortModal(true);
  };

  const handleSelectPortToEdit = (portName: string) => {
    setSelectedPortToEdit(portName);
    const found = ports.find(p => p.name === portName);
    if (found) {
      setEditPortName(found.name);
      setEditPortCode(found.code);
      setEditPortType(found.type || 'Sea Port');
      setEditPortInquiryLink(found.containerInquiryLink || '');
    }
  };

  const handleSaveEditedPort = () => {
    if (!editPortName.trim()) {
      alert('Please enter a Port / Terminal name');
      return;
    }
    const trimmedName = editPortName.trim();
    const trimmedCode = editPortCode.trim() || (trimmedName.length <= 4 ? trimmedName.toUpperCase() : trimmedName.substring(0, 4).toUpperCase());
    const updatedPortObj: PortItem = {
      name: trimmedName,
      code: trimmedCode,
      type: editPortType,
      containerInquiryLink: editPortInquiryLink.trim()
    };

    const updatedPorts = ports.map(p => p.name === selectedPortToEdit ? updatedPortObj : p);
    setPorts(updatedPorts);
    safeAppStorage.setJSON('dpl_ports', updatedPorts);
    setShowEditPortModal(false);
    setDraftToast(`✓ Port "${trimmedName}" updated successfully!`);
  };

  const handleOpenAddPort = (targetField?: 'pol' | 'pod' | null, initialName?: string) => {
    setPortTargetField(targetField || null);
    setNewPortName(initialName || '');
    setNewPortCode(initialName ? (initialName.length <= 4 ? initialName.toUpperCase() : initialName.substring(0, 4).toUpperCase()) : '');
    setNewPortType('Dry Port');
    setShowPortModal(true);
  };

  // Filtering State
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filterDates, setFilterDates] = useState({ start: '', end: '' });
  const [activeDateFilter, setActiveDateFilter] = useState<{start: string, end: string} | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Advanced Reporting State
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportSearchTerm, setReportSearchTerm] = useState('');
  const [reportFilters, setReportFilters] = useState<Record<string, string>>({});
  const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
  const [reportSelectedCase, setReportSelectedCase] = useState<Case | null>(null);
  const [copiedCaseNo, setCopiedCaseNo] = useState(false);

  // Detail View Edit State
  const [isEditingCase, setIsEditingCase] = useState(false);
  const [editedCase, setEditedCase] = useState<any>(null);

  // New features state
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printOptions, setPrintOptions] = useState({ withAttachments: false, withInvoice: false, onlyInvoice: false });
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfDownloadSuccess, setPdfDownloadSuccess] = useState<string | null>(null);
  const [pdfDownloadError, setPdfDownloadError] = useState<string | null>(null);
  const [directDownloadUrl, setDirectDownloadUrl] = useState<string | null>(null);
  const [directDownloadFilename, setDirectDownloadFilename] = useState<string>('');
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState(false);

  // Download Documents Modal state
  const [showDownloadDocsModal, setShowDownloadDocsModal] = useState(false);
  const [selectedDownloadType, setSelectedDownloadType] = useState<'caseDetails' | 'invoice' | 'attachments' | 'all'>('caseDetails');

  // Add/Edit Charges state
  const STANDARD_CHARGE_CATEGORIES = [
    'Transhipment Permit (TP) Filing & EDI Fee',
    'Port Wharfage & Terminal Handling (THC)',
    'Delivery Order (DO) Charges',
    'DO Security Deposit',
    'Excise & Taxation Payment',
    'Customs Examination & Surcharge',
    'Weighbridge Scale Charges',
    'Detention / Demurrage Payment',
    'Container Damage / Repair Payment',
    'FBR Satellite Tracking Device & E-Seal Monitoring',
    'Inland Freight & Vehicle Rent',
    'Customs Duty & Regulatory Taxes',
    'Additional Customs Duty (ACD)',
    'Labor & Offloading Charges',
    'Customs Agency / Clearing Commission',
    'Bank Charges & Stamp Paper',
    'Empty Container Return & Gate-in Fee',
    'Manifest / WeBOC Electronic Processing',
    'Cross-Border Transit / TIR Surcharge',
    'Direct Client Disbursement',
    'Cash Payment / Miscellaneous Handling'
  ];

  const [customChargeCategories, setCustomChargeCategories] = useState<string[]>(() => {
    try {
      const stored = safeLocalStorage.getItem('custom_billing_categories');
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.warn("Failed reading custom categories:", e);
    }
    return [];
  });

  const [showAddChargeModal, setShowAddChargeModal] = useState(false);
  const [selectedChargeCategory, setSelectedChargeCategory] = useState('');
  const [newChargeDesc, setNewChargeDesc] = useState('');
  const [newChargeAmount, setNewChargeAmount] = useState('');
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [newChargeReceipt, setNewChargeReceipt] = useState<{ url: string; name: string } | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  // 8-Step Workflow Interactive Modal state
  const [showStepModal, setShowStepModal] = useState(false);
  const [selectedStepStatus, setSelectedStepStatus] = useState<CaseStatus | null>(null);
  const [stepModalIndex, setStepModalIndex] = useState<number>(0);

  const handleOpenStepModal = (status: CaseStatus, index: number, target: Case) => {
    setSelectedStepStatus(status);
    setStepModalIndex(index);
    setShowStepModal(true);
  };

  const handleDownloadPdfFile = async (caseToExport?: Case, overrideOpts?: { onlyInvoice?: boolean; withInvoice?: boolean; withAttachments?: boolean; onlyCaseDetails?: boolean }) => {
    const activeCase = caseToExport || selectedCase;
    if (!activeCase) {
      setPdfDownloadError("No case found to generate PDF.");
      return;
    }
    setIsDownloadingPdf(true);
    setPdfDownloadError(null);
    setPdfDownloadSuccess(null);
    try {
      const opts = overrideOpts || printOptions;
      const result = await downloadCasePdf(
        activeCase,
        { companyName, subtitle, customLogo: activeLogo, ...branding },
        opts
      );
      setPdfDownloadSuccess(result.filename);
      if (result.blobUrl) {
        setDirectDownloadUrl(result.blobUrl);
        setDirectDownloadFilename(result.filename);
      }
    } catch (err: any) {
      console.error("PDF generation/download error:", err);
      setPdfDownloadError("Unable to download PDF. Please try again.");
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleDownloadDeliveryOrder = async (caseToPrint?: Case) => {
    const activeCase = caseToPrint || selectedCase;
    if (!activeCase) return;
    try {
      await downloadCustomsDeliveryOrderPdf({
        targetCase: activeCase,
        branding: { companyName, subtitle, customLogo: activeLogo, ...branding }
      });
    } catch (err: any) {
      console.error("DO PDF generation error:", err);
    }
  };

  /**
   * Resilient Document Data Resolver:
   * Retrieves data URL from memory cache, IndexedDB, or blob object.
   */
  const resolveDocumentUrl = async (doc: any, caseItem?: Case | null): Promise<string> => {
    if (!doc) return '';
    if (doc.url && (doc.url.startsWith('data:') || doc.url.startsWith('blob:') || doc.url.startsWith('http'))) {
      return doc.url;
    }
    if (doc.dataUrl && (doc.dataUrl.startsWith('data:') || doc.dataUrl.startsWith('blob:') || doc.dataUrl.startsWith('http'))) {
      return doc.dataUrl;
    }
    const docName = doc.name || 'document';
    const cached = docDataCache.get(docName) || (doc.id ? docDataCache.get(doc.id) : null);
    if (cached?.base64) {
      return `data:${cached.mimeType || 'application/pdf'};base64,${cached.base64}`;
    }
    const cNo = caseItem?.caseNo || selectedCase?.caseNo;
    const searchKeys = [
      cNo ? `${cNo}_${docName}` : null,
      docName,
      doc.id || null,
      cNo && doc.id ? `${cNo}_${doc.id}` : null
    ].filter(Boolean) as string[];

    for (const key of searchKeys) {
      try {
        const idbData = await getDocumentFromIndexedDB(key);
        if (idbData) {
          if (idbData.startsWith('data:')) {
            const parts = idbData.split(',');
            const mime = parts[0]?.split(';')[0]?.replace('data:', '') || 'application/pdf';
            docDataCache.set(docName, { base64: parts[1] || '', mimeType: mime, name: docName });
          }
          return idbData;
        }
      } catch (_) {}
    }

    if (doc instanceof File || doc instanceof Blob) {
      try {
        return URL.createObjectURL(doc);
      } catch (_) {}
    }

    try {
      const docPdf = new jsPDF();
      docPdf.setFillColor(15, 23, 42);
      docPdf.rect(0, 0, 210, 297, 'F');
      docPdf.setTextColor(245, 158, 11);
      docPdf.setFontSize(16);
      docPdf.text('MAK GROUP OF COMPANIES', 105, 25, { align: 'center' });
      docPdf.setTextColor(255, 255, 255);
      docPdf.setFontSize(11);
      docPdf.text('Official Shipping Dossier Document', 105, 34, { align: 'center' });
      docPdf.setFontSize(10);
      docPdf.setTextColor(200, 200, 200);
      if (cNo) docPdf.text(`Case No: #${cNo}`, 20, 50);
      docPdf.text(`Document Name: ${docName}`, 20, 58);
      docPdf.text(`Category: ${doc.docCategory || doc.type || 'Customs Paperwork'}`, 20, 66);
      docPdf.text(`Client: ${caseItem?.clientName || 'Consignment Client'}`, 20, 74);
      docPdf.text(`Verified: ${new Date().toLocaleDateString()}`, 20, 82);
      return docPdf.output('datauristring');
    } catch (_) {
      return '';
    }
  };

  const handlePreviewAttachedDoc = async (doc: any, caseItem?: Case | null) => {
    const docName = doc?.name || 'document.pdf';
    const resolved = await resolveDocumentUrl(doc, caseItem);
    if (!resolved) {
      alert("Document data is currently unavailable.");
      return;
    }
    const isPdf = docName.toLowerCase().endsWith('.pdf') || resolved.startsWith('data:application/pdf') || Boolean(doc?.type && doc.type.includes('pdf'));
    if (isPdf) {
      setDirectDownloadUrl(resolved);
      setDirectDownloadFilename(docName.endsWith('.pdf') ? docName : `${docName}.pdf`);
      setIsPdfViewerOpen(true);
    } else {
      setLightboxImage(resolved);
    }
  };

  const handleDownloadAttachedDoc = async (doc: any, caseItem?: Case | null) => {
    const docName = doc?.name || `Document_${Date.now()}.pdf`;
    const resolved = await resolveDocumentUrl(doc, caseItem);
    if (!resolved) {
      alert("Unable to download document data.");
      return;
    }
    downloadFile(resolved, docName.includes('.') ? docName : `${docName}.pdf`);
    setDraftToast(`✓ Downloading ${docName}...`);
  };

  const handleOpenDocInNewTab = async (doc: any, caseItem?: Case | null) => {
    const resolved = await resolveDocumentUrl(doc, caseItem);
    if (!resolved) return;
    if (resolved.startsWith('data:')) {
      try {
        const parts = resolved.split(',');
        const mime = parts[0]?.split(';')[0]?.replace('data:', '') || 'application/pdf';
        const byteCharacters = atob(parts[1]);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        return;
      } catch (_) {}
    }
    window.open(resolved, '_blank');
  };

  // Registration State (Bulletproof persistence across app switching, backgrounding & reloads)
  const [step, setStep] = useState<number>(() => {
    const saved = safeAppStorage.getItem('dpl_reg_step');
    return saved ? Math.max(1, parseInt(saved, 10)) : 1;
  });
  const [loading, setLoading] = useState(false);
  const [isReadingDocuments, setIsReadingDocuments] = useState(false);
  const [readingPhase, setReadingPhase] = useState('Reading Documents...');
  const [readingProgress, setReadingProgress] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocRecord[]>(() => {
    return safeAppStorage.getJSON<UploadedDocRecord[]>('dpl_reg_docs', []);
  });
  const [isAttachingFiles, setIsAttachingFiles] = useState(false);
  const documentsSectionRef = useRef<HTMLDivElement>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showCaseDocScanner, setShowCaseDocScanner] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [generatedCaseNo, setGeneratedCaseNo] = useState<string>(() => {
    return safeAppStorage.getItem('dpl_reg_caseno') || '';
  });
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [showCustomsGuideModal, setShowCustomsGuideModal] = useState(false);
  const [activeGuideCategory, setActiveGuideCategory] = useState<string>('Bonded Carrier');
  
  const [formData, setFormData] = useState<{
    client: string;
    category: string;
    subCategory?: string;
    pol: string;
    pod: string;
    containers: Container[];
    extractedData: ExtractedData;
    charges?: CaseCharge[];
    serviceArrangements?: Record<string, { label: string; arrangedBy: 'DPL' | 'Client'; amount: number }>;
  }>(() => {
    const saved = safeAppStorage.getJSON<any>('dpl_reg_formdata', null);
    if (saved) {
      return {
        ...saved,
        serviceArrangements: saved.serviceArrangements || { ...INITIAL_REGISTRATION_ARRANGEMENTS },
        charges: (saved.charges && saved.charges.length > 0) ? saved.charges : getArrangementInitialCharges(saved.serviceArrangements || INITIAL_REGISTRATION_ARRANGEMENTS)
      };
    }
    return {
      client: '',
      category: 'Bonded Carrier',
      subCategory: 'Standard Container / General Cargo',
      pol: '',
      pod: '',
      containers: [],
      extractedData: {},
      serviceArrangements: { ...INITIAL_REGISTRATION_ARRANGEMENTS },
      charges: getArrangementInitialCharges(INITIAL_REGISTRATION_ARRANGEMENTS)
    };
  });

  // Toggle Service Arrangement: Arranged by DPL (Auto-added to Invoice) vs Arranged by Client (Excluded from Invoice)
  const handleToggleServiceArrangement = (key: string, targetArrangedBy: 'DPL' | 'Client') => {
    setFormData(prev => {
      const catArr = getCategoryArrangements(prev.category || 'Bonded Carrier');
      const currentArrangements = { ...catArr, ...(prev.serviceArrangements || {}) };
      const currentItem = currentArrangements[key] || catArr[key];
      if (!currentItem) return prev;

      const updatedArrangements = {
        ...currentArrangements,
        [key]: {
          ...currentItem,
          arrangedBy: targetArrangedBy,
          ...(targetArrangedBy === 'Client' ? { amount: 0 } : {})
        }
      };

      let updatedCharges = [...(prev.charges || [])];
      if (targetArrangedBy === 'DPL') {
        // User marked as Arranged by DPL -> AUTOMATICALLY ADD TO INVOICE CHARGES
        updatedCharges = updatedCharges.filter(c => c.syncKey !== key);
        if (Number(currentItem.amount) > 0) {
          updatedCharges.push({
            id: `ch_arr_${key}_${Date.now()}`,
            syncKey: key,
            description: currentItem.label,
            unitRate: Number(currentItem.amount),
            amount: Number(currentItem.amount),
            arrangedBy: 'DPL',
            taxable: true
          });
        }
      } else {
        // User marked as Arranged by Client -> AUTOMATICALLY REMOVE FROM INVOICE CHARGES
        updatedCharges = updatedCharges.filter(c => c.syncKey !== key);
      }

      const scaledCharges = scaleBondedCarrierChargesByContainers(
        updatedCharges,
        prev.category || 'Bonded Carrier',
        prev.containers
      );

      const updatedFormData = {
        ...prev,
        serviceArrangements: updatedArrangements,
        charges: scaledCharges
      };
      safeAppStorage.setJSON('dpl_reg_formdata', updatedFormData);
      return updatedFormData;
    });
  };

  // Update Estimated Amount for Service Arrangement (Per Container Rate in Bonded Carrier)
  const handleUpdateArrangementAmount = (key: string, newAmount: number) => {
    setFormData(prev => {
      const catArr = getCategoryArrangements(prev.category || 'Bonded Carrier');
      const currentArrangements = { ...catArr, ...(prev.serviceArrangements || {}) };
      const currentItem = currentArrangements[key] || catArr[key];
      if (!currentItem) return prev;

      const updatedArrangements = {
        ...currentArrangements,
        [key]: {
          ...currentItem,
          amount: newAmount
        }
      };

      let updatedCharges = [...(prev.charges || [])];
      if (currentItem.arrangedBy === 'DPL') {
        const exists = updatedCharges.some(c => c.syncKey === key);
        if (exists) {
          updatedCharges = updatedCharges.map(c => c.syncKey === key ? { ...c, unitRate: newAmount, amount: newAmount } : c);
        } else if (newAmount > 0) {
          updatedCharges.push({
            id: `ch_arr_${key}_${Date.now()}`,
            syncKey: key,
            description: currentItem.label,
            unitRate: newAmount,
            amount: newAmount,
            arrangedBy: 'DPL',
            taxable: true
          });
        }
      }

      const scaledCharges = scaleBondedCarrierChargesByContainers(
        updatedCharges,
        prev.category || 'Bonded Carrier',
        prev.containers
      );

      const updatedFormData = {
        ...prev,
        serviceArrangements: updatedArrangements,
        charges: scaledCharges
      };
      safeAppStorage.setJSON('dpl_reg_formdata', updatedFormData);
      return updatedFormData;
    });
  };

  // Step 4 Review & Submission States
  const [isCaseSubmitted, setIsCaseSubmitted] = useState<boolean>(false);
  const [submittedCaseData, setSubmittedCaseData] = useState<Case | null>(null);
  const [showRegistrationChargeModal, setShowRegistrationChargeModal] = useState<boolean>(false);
  const [newRegChargeDesc, setNewRegChargeDesc] = useState<string>('');
  const [newRegChargeAmount, setNewRegChargeAmount] = useState<string>('');
  const [isSaveAsClientDefault, setIsSaveAsClientDefault] = useState<boolean>(false);
  const [saveAsClientDefaultInModal, setSaveAsClientDefaultInModal] = useState<boolean>(false);

  const handleAddRegistrationChargeItem = async (desc: string, amount: number) => {
    if (!desc.trim() || amount <= 0) return;
    const baseCharge: CaseCharge = {
      id: `ch_${Date.now()}`,
      category: formData.category,
      description: desc.trim(),
      unitRate: amount,
      amount: amount,
      taxable: true
    };
    const [newCharge] = scaleBondedCarrierChargesByContainers(
      [baseCharge],
      formData.category || 'Bonded Carrier',
      formData.containers
    );

    if (isCaseSubmitted && submittedCaseData) {
      const updatedCharges = scaleBondedCarrierChargesByContainers(
        [...(submittedCaseData.charges || []), newCharge],
        submittedCaseData.category || 'Bonded Carrier',
        submittedCaseData.containers
      );
      const updatedCase: Case = { ...submittedCaseData, charges: updatedCharges };
      setSubmittedCaseData(updatedCase);
      setCases(prev => prev.map(c => c.id === updatedCase.id ? updatedCase : c));
      updateCaseInFirestore(updatedCase).catch(e => console.warn("Firestore charge update error:", e));
    } else {
      const existing = formData.charges || [];
      setFormData(prev => ({
        ...prev,
        charges: scaleBondedCarrierChargesByContainers(
          [...existing, newCharge],
          prev.category || 'Bonded Carrier',
          prev.containers
        )
      }));
    }

    // If marked as Client Default Charge (strictly scoped to the current Case Category)
    if (isSaveAsClientDefault && formData.client) {
      const clientObj = clientsData.find(c => c.name?.toLowerCase() === formData.client?.toLowerCase());
      if (clientObj) {
        try {
          const updatedClient = await saveChargeAsClientDefault(clientObj, {
            description: desc.trim(),
            amount: amount,
            category: formData.category || 'Bonded Carrier',
            caseCategory: formData.category || 'Bonded Carrier',
            taxable: true
          });
          setClientsData(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
          setDraftToast(`✓ Saved "${desc.trim()}" (PKR ${amount.toLocaleString()}) as default charge for ${formData.client} in ${formData.category}!`);
        } catch (err) {
          console.warn("Could not save default charge to client:", err);
        }
      }
    }

    setNewRegChargeDesc('');
    setNewRegChargeAmount('');
    setIsSaveAsClientDefault(false);
    setShowRegistrationChargeModal(false);
  };

  // Draft Persistence and Detection with 24-hour Auto-Expiry
  const checkHasDraft = () => {
    try {
      const active = safeAppStorage.getItem('dpl_reg_draft_active') === 'true';
      if (!active) return false;

      // Auto-expire drafts older than 24 hours to prevent phantom drafts from hanging users
      const savedTime = safeAppStorage.getItem('dpl_reg_timestamp');
      if (savedTime && Date.now() - parseInt(savedTime, 10) > 24 * 60 * 60 * 1000) {
        safeAppStorage.removeItem('dpl_reg_draft_active');
        safeAppStorage.removeItem('dpl_reg_step');
        safeAppStorage.removeItem('dpl_reg_caseno');
        safeAppStorage.removeItem('dpl_reg_formdata');
        safeAppStorage.removeItem('dpl_reg_docs');
        safeAppStorage.removeItem('dpl_reg_updated_at');
        safeAppStorage.removeItem('dpl_reg_timestamp');
        return false;
      }

      const savedStep = parseInt(safeAppStorage.getItem('dpl_reg_step') || '1', 10);
      const savedFormData = safeAppStorage.getJSON<any>('dpl_reg_formdata', null);
      const savedDocs = safeAppStorage.getJSON<any[]>('dpl_reg_docs', []);
      if (savedStep > 1 || (savedDocs && savedDocs.length > 0) || (savedFormData && Boolean(savedFormData.client?.trim()))) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const [hasDraft, setHasDraft] = useState<boolean>(() => checkHasDraft());
  const [showDiscardModal, setShowDiscardModal] = useState<boolean>(false);
  const [showStartNewDraftPrompt, setShowStartNewDraftPrompt] = useState<boolean>(false);
  const [draftToast, setDraftToast] = useState<string | null>(null);

  useEffect(() => {
    if (draftToast) {
      const timer = setTimeout(() => setDraftToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [draftToast]);

  const draftInfo = React.useMemo(() => {
    if (!hasDraft) return null;
    const savedStep = parseInt(safeAppStorage.getItem('dpl_reg_step') || '1', 10);
    const savedCaseNo = safeAppStorage.getItem('dpl_reg_caseno') || '';
    const savedFormData = safeAppStorage.getJSON<any>('dpl_reg_formdata', formData);
    const savedDocs = safeAppStorage.getJSON<any[]>('dpl_reg_docs', uploadedDocs);
    const savedTime = safeAppStorage.getItem('dpl_reg_updated_at') || '';

    let stepName = 'Basic Details & Shipping Documents';
    if (savedStep === 2) stepName = 'Extracted Data & Route Verification';
    if (savedStep === 3) stepName = 'Container Allocation & Charges Review';

    return {
      step: savedStep,
      stepName,
      caseNo: savedCaseNo,
      client: savedFormData?.client || '',
      category: savedFormData?.category || 'Bonded Carrier',
      docsCount: (savedDocs && savedDocs.length) || 0,
      containersCount: (savedFormData?.containers && savedFormData.containers.length) || 0,
      updatedAt: savedTime
    };
  }, [hasDraft, formData, uploadedDocs]);

  // Determine unique user key for cloud-synced work draft persistence
  const activeDraftUserKey = useMemo(() => {
    return (
      safeAppStorage.getItem('dpl_current_user_id') ||
      safeAppStorage.getItem('dpl_client_name') ||
      String(effectiveRole || 'admin')
    ).toLowerCase().trim();
  }, [effectiveRole]);

  // Restore cloud-synced work draft from Firestore on mount or reconnect
  useEffect(() => {
    let mounted = true;
    getUserWorkDraftFromFirestore(activeDraftUserKey).then((cloudDraft) => {
      if (!mounted || !cloudDraft || !cloudDraft.active) return;
      const localActive = safeAppStorage.getItem('dpl_reg_draft_active') === 'true';
      if (!localActive && cloudDraft.formData) {
        safeAppStorage.setItem('dpl_reg_draft_active', 'true');
        safeAppStorage.setItem('dpl_reg_step', String(cloudDraft.step || 1));
        if (cloudDraft.caseNo) safeAppStorage.setItem('dpl_reg_caseno', cloudDraft.caseNo);
        safeAppStorage.setJSON('dpl_reg_formdata', cloudDraft.formData);
        if (Array.isArray(cloudDraft.docs)) {
          safeAppStorage.setJSON('dpl_reg_docs', cloudDraft.docs);
        }
        safeAppStorage.setItem('dpl_reg_updated_at', new Date(cloudDraft.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        safeAppStorage.setItem('dpl_reg_timestamp', String(new Date(cloudDraft.updatedAt || Date.now()).getTime()));
        setHasDraft(true);
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, [activeDraftUserKey]);

  // Preserve registration draft in safeAppStorage AND online in Firestore with debouncing
  useEffect(() => {
    if (view === 'register' && step < 4) {
      const hasContent = Boolean(formData.client?.trim()) || uploadedDocs.length > 0 || step > 1 || (formData.containers && formData.containers.length > 0);
      const timer = setTimeout(() => {
        if (hasContent) {
          const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          safeAppStorage.setItem('dpl_reg_draft_active', 'true');
          safeAppStorage.setItem('dpl_reg_step', String(step));
          if (generatedCaseNo) {
            safeAppStorage.setItem('dpl_reg_caseno', generatedCaseNo);
          } else {
            safeAppStorage.removeItem('dpl_reg_caseno');
          }
          safeAppStorage.setJSON('dpl_reg_formdata', formData);
          safeAppStorage.setJSON('dpl_reg_docs', uploadedDocs);
          safeAppStorage.setItem('dpl_reg_updated_at', timeStr);
          safeAppStorage.setItem('dpl_reg_timestamp', String(Date.now()));
          setHasDraft(true);

          // Sync draft online to Firestore (stripping heavy base64 URLs from docs metadata if needed to stay under 1MB)
          const lightDocs = uploadedDocs.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            size: d.size,
            docCategory: d.docCategory,
            url: (d.url && d.url.length < 180000) ? d.url : ''
          }));
          saveUserWorkDraftToFirestore(activeDraftUserKey, {
            role: String(effectiveRole),
            companyId: activeCompany?.id || 'docks',
            draftType: 'CASE_REGISTRATION',
            step,
            caseNo: generatedCaseNo || '',
            formData,
            docs: lightDocs,
            updatedAt: new Date().toISOString(),
            active: true
          }).catch(() => {});
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [view, step, generatedCaseNo, formData, uploadedDocs, activeDraftUserKey, effectiveRole, activeCompany?.id]);

  // Safely release camera hardware when the user switches to gallery or another app
  useEffect(() => {
    const unsubscribe = appLifecycle.subscribe((lifecycleState) => {
      if (lifecycleState === 'background' && showCamera) {
        stopCamera();
      }
    });
    return () => {
      unsubscribe();
      stopCamera();
    };
  }, [showCamera]);

  // Effect to apply initial filter from props (Notification click / Dashboard drill-down)
  useEffect(() => {
    if (!initialFilter) {
      setStatusFilter(null);
      return;
    }

    if (initialFilter.status) {
      setStatusFilter(initialFilter.status);
    }
    if (initialFilter.notificationId) {
      setActiveNotificationId(initialFilter.notificationId);
    }

    // Extract target caseNo or caseId from initialFilter
    const targetCaseNo = typeof initialFilter === 'string' 
      ? initialFilter 
      : (initialFilter.caseNo || initialFilter.caseNumber || initialFilter.caseId || initialFilter.id);

    if (targetCaseNo && cases.length > 0) {
      const targetClean = String(targetCaseNo).trim().toLowerCase();
      const matchedCase = cases.find(c => 
        (c.caseNo && c.caseNo.trim().toLowerCase() === targetClean) ||
        (c.caseNumber && c.caseNumber.trim().toLowerCase() === targetClean) ||
        String(c.id).trim().toLowerCase() === targetClean
      );

      if (matchedCase) {
        setSelectedCase(matchedCase);
        setView('details');

        // If stepId or stepIndex specified, automatically open the step workflow modal so user can update immediately
        if (initialFilter.stepId !== undefined || initialFilter.stepIndex !== undefined) {
          const stepIdx = initialFilter.stepIndex !== undefined ? Number(initialFilter.stepIndex) : 0;
          const stepStatus = initialFilter.stepId || CaseStatus.SHIPPING_LINE_DO;
          handleOpenStepModal(stepStatus as any, stepIdx, matchedCase);
        }

        // Smooth scroll to top of details
        setTimeout(() => {
          const container = document.getElementById('main-scroll-container');
          if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);

        if (clearFilter) clearFilter();
      }
    }
  }, [initialFilter, cases, clearFilter]);

  const getNestedValue = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  // Generate strictly sequential case number: [PREFIX]-[DEST]-[YY]-[MMM]-[SERIAL]
  // Serial resets ONLY on Year change. Month changes dynamically.
  // Invoice Number is identical to Case Number.
  const generateCaseNumber = (customList?: Case[], destination?: string) => {
    const dest = destination || formData.pod || formData.extractedData?.dropoffDestination;
    const currentPrefix = activeCompany?.prefix || getActiveCompanyPrefix();
    return generateDplCaseNumber(customList || cases, dest, new Date(), currentPrefix);
  };

  // Keep generatedCaseNo synchronized with chosen POD / destination and active subsidiary prefix during registration
  useEffect(() => {
    if (view === 'register') {
      const dest = formData.pod || formData.extractedData?.dropoffDestination;
      const currentPrefix = activeCompany?.prefix || getActiveCompanyPrefix();
      if (dest) {
        const destCode = getDestinationCode(dest);
        setGeneratedCaseNo(prev => {
          if (!prev) {
            const fresh = generateDplCaseNumber(cases, dest, new Date(), currentPrefix);
            safeAppStorage.setItem('dpl_reg_caseno', fresh);
            return fresh;
          }
          const parts = prev.split('-');
          if (parts.length === 5) {
            if (parts[1] !== destCode || parts[0] !== currentPrefix) {
              const updated = `${currentPrefix}-${destCode}-${parts[2]}-${parts[3]}-${parts[4]}`;
              safeAppStorage.setItem('dpl_reg_caseno', updated);
              return updated;
            }
          } else {
            const fresh = generateDplCaseNumber(cases, dest, new Date(), currentPrefix);
            safeAppStorage.setItem('dpl_reg_caseno', fresh);
            return fresh;
          }
          return prev;
        });
      } else {
        setGeneratedCaseNo(prev => {
          if (prev) {
            const parts = prev.split('-');
            if (parts.length === 5 && parts[0] !== currentPrefix) {
              const updated = `${currentPrefix}-${parts.slice(1).join('-')}`;
              safeAppStorage.setItem('dpl_reg_caseno', updated);
              return updated;
            }
          }
          return prev;
        });
      }
    }
  }, [formData.pod, formData.extractedData?.dropoffDestination, view, cases, activeCompany?.id, activeCompany?.prefix]);

  const handleResumeDraft = () => {
    const savedStep = parseInt(safeAppStorage.getItem('dpl_reg_step') || '1', 10);
    const savedCaseNo = safeAppStorage.getItem('dpl_reg_caseno') || '';
    const savedFormData = safeAppStorage.getJSON<any>('dpl_reg_formdata', null);
    const savedDocs = safeAppStorage.getJSON<UploadedDocRecord[]>('dpl_reg_docs', []);

    if (savedFormData) {
      setFormData(savedFormData);
    }
    if (savedDocs && savedDocs.length > 0) {
      setUploadedDocs(savedDocs);
    }
    setGeneratedCaseNo(savedCaseNo);
    setStep(Math.max(1, Math.min(savedStep, 3)));
    setView('register');
    setDraftToast('⚡ Resumed incomplete case draft');
  };

  const handleDiscardDraft = () => {
    safeAppStorage.removeItem('dpl_reg_draft_active');
    safeAppStorage.removeItem('dpl_reg_step');
    safeAppStorage.removeItem('dpl_reg_caseno');
    safeAppStorage.removeItem('dpl_reg_formdata');
    safeAppStorage.removeItem('dpl_reg_docs');
    safeAppStorage.removeItem('dpl_reg_updated_at');
    safeAppStorage.removeItem('dpl_reg_timestamp');
    safeAppStorage.removeItem('dpl_reg_view');
    deleteUserWorkDraftFromFirestore(activeDraftUserKey).catch(() => {});
    setHasDraft(false);
    setGeneratedCaseNo('');
    setStep(1);
    setIsCaseSubmitted(false);
    setSubmittedCaseData(null);
    setShowRegistrationChargeModal(false);
    setNewRegChargeDesc('');
    setNewRegChargeAmount('');
    setFiles([]);
    setUploadedDocs([]);
    const clientNameInit = isClientUser ? (effectiveClientName || 'Global Traders Ltd') : '';
    const categoryInit = isClientUser ? getClientDefaultCategory(effectiveClientName || '') : 'Bonded Carrier';
    const clientObj = clientsData.find(c => c.name?.toLowerCase() === clientNameInit.toLowerCase());
    const resolvedInit = resolveCaseCharges(clientObj, categoryInit);

    setFormData({
      client: clientNameInit,
      category: categoryInit,
      pol: '',
      pod: '',
      containers: [],
      extractedData: {},
      serviceArrangements: resolvedInit.arrangements as any,
      charges: resolvedInit.charges
    });
    setShowDiscardModal(false);
    setDraftToast('🗑️ Incomplete case draft discarded');
  };

  const handleStartRegistration = () => {
    if (hasDraft) {
      setShowStartNewDraftPrompt(true);
      return;
    }
    startFreshRegistration();
  };

  const startFreshRegistration = () => {
    // Clear any previous draft residue
    safeAppStorage.removeItem('dpl_reg_draft_active');
    safeAppStorage.removeItem('dpl_reg_step');
    safeAppStorage.removeItem('dpl_reg_caseno');
    safeAppStorage.removeItem('dpl_reg_formdata');
    safeAppStorage.removeItem('dpl_reg_docs');
    safeAppStorage.removeItem('dpl_reg_updated_at');
    safeAppStorage.removeItem('dpl_reg_timestamp');
    deleteUserWorkDraftFromFirestore(activeDraftUserKey).catch(() => {});
    setHasDraft(false);
    setIsCaseSubmitted(false);
    setSubmittedCaseData(null);
    setShowRegistrationChargeModal(false);
    setNewRegChargeDesc('');
    setNewRegChargeAmount('');

    // CRITICAL USER DIRECTIVE:
    // Do NOT reserve or assign a serial case number in Step 1!
    // Case number will be generated strictly when progressing to Step 2.
    setGeneratedCaseNo('');
    setStep(1);

    const initialClient = isClientUser ? (effectiveClientName || 'Global Traders Ltd') : '';
    const initialCategory = initialClient ? getClientDefaultCategory(initialClient) : 'Bonded Carrier';
    const foundClient = clientsData.find(c => c.name?.toLowerCase() === initialClient.toLowerCase());
    const resolved = resolveCaseCharges(foundClient, initialCategory);

    const initialFormData = {
      client: initialClient,
      category: initialCategory || 'Bonded Carrier',
      pol: '',
      pod: '',
      containers: [],
      extractedData: {},
      serviceArrangements: resolved.arrangements as any,
      charges: resolved.charges
    };

    setFormData(initialFormData);
    setFiles([]);
    setUploadedDocs([]);
    setCategoryDropdownOpen(false);
    setCategorySearch('');
    setIsOtherClient(false);
    setOtherClientName('');
    setView('register');
  };

  // Keep client account synced if registering as a Client user
  useEffect(() => {
    if (view === 'register' && isClientUser && effectiveClientName) {
      if (!formData.client || formData.client !== effectiveClientName) {
        const cat = getClientDefaultCategory(effectiveClientName);
        setFormData(prev => ({
          ...prev,
          client: effectiveClientName,
          category: prev.category || cat || 'Bonded Carrier'
        }));
      }
    }
  }, [view, isClientUser, effectiveClientName, clientsData]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, replaceExisting: boolean = false) => {
    const inputEl = e.target;
    try {
      if (inputEl && inputEl.files && inputEl.files.length > 0) {
        const selected: File[] = Array.from(inputEl.files);
        // Clear input value so selecting the same file again triggers change event
        inputEl.value = '';
        setIsAttachingFiles(true);
        // Defer processing to next frame so the mobile browser can smoothly finish returning from OS Activity
        setTimeout(() => {
          processFiles(selected, undefined, replaceExisting).finally(() => {
            setIsAttachingFiles(false);
          });
        }, 40);
      }
    } catch (err) {
      console.warn("File upload error caught:", err);
      setIsAttachingFiles(false);
    }
  };

  const processFiles = async (
    newFiles: File[],
    categoryHint?: 'BL' | 'INVOICE' | 'PACKING_LIST' | 'ALL_IN_ONE',
    replaceExisting: boolean = false
  ) => {
    if (!newFiles || newFiles.length === 0) return;
    try {
      const newDocRecords: UploadedDocRecord[] = [];

      for (const f of newFiles) {
        let objectUrl = '';
        try {
          objectUrl = URL.createObjectURL(f);
        } catch (_) {}

        // Read real data URL immediately to guarantee offline, OCR & preview durability
        let docDataUrl = '';
        try {
          docDataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve((e.target?.result as string) || '');
            reader.onerror = () => resolve('');
            reader.readAsDataURL(f);
          });
        } catch (_) {}

        const docType = f.type || detectMimeType(f).mimeType;
        const recId = `${f.name.replace(/[^a-zA-Z0-9.-]/g, '_')}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const detectedCategory = categoryHint || detectShippingDocumentType(f.name);

        if (docDataUrl && docDataUrl.includes(',')) {
          const b64 = docDataUrl.split(',')[1];
          docDataCache.set(f.name, { base64: b64, mimeType: docType, name: f.name });
          docDataCache.set(recId, { base64: b64, mimeType: docType, name: f.name });
          saveDocumentToIndexedDB({
            id: recId,
            name: f.name,
            type: docType,
            size: f.size,
            dataUrl: docDataUrl
          }).catch(() => {});
        }

        newDocRecords.push({
          id: recId,
          name: f.name,
          type: docType,
          size: f.size,
          url: docDataUrl || objectUrl,
          docCategory: detectedCategory
        });
      }

      setFiles(prev => (replaceExisting ? [...newFiles] : [...prev, ...newFiles]));
      setUploadedDocs(prev => {
        const combined = replaceExisting ? [...newDocRecords] : [...prev, ...newDocRecords];
        try {
          const safeRecords = combined.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            size: d.size,
            url: d.url,
            docCategory: d.docCategory
          }));
          safeAppStorage.setJSON('dpl_reg_docs', safeRecords);
        } catch (e) {
          console.warn("Doc storage notice:", e);
        }
        return combined;
      });

      // Automatically read and extract fields immediately when files are uploaded in Step 1 or re-uploaded in Step 2
      if (newDocRecords.length > 0) {
        setTimeout(() => {
          triggerDocumentReading(newDocRecords, true);
        }, 120);
      }
    } catch (error) {
      console.warn("Processing notice:", error);
    }
  };

  const triggerDocumentReading = async (overrideNewDocs?: UploadedDocRecord[], forceOverwrite: boolean = true) => {
    setIsReadingDocuments(true);
    setReadingProgress(12);
    setReadingPhase('Enhancing scan contrast & analyzing shipping line format...');

    const timer1 = setTimeout(() => {
      setReadingProgress(35);
      setReadingPhase('Reading B/L header, Maersk/MSC/COSCO/Evergreen line & B/L Number...');
    }, 400);

    const timer2 = setTimeout(() => {
      setReadingProgress(60);
      setReadingPhase('Extracting ISO containers (MSKU/CMAU...), 20ft/40ft/45ft & seals...');
    }, 900);

    const timer3 = setTimeout(() => {
      setReadingProgress(82);
      setReadingPhase('Parsing Commercial Invoice values (USD/PKR) & Incoterms...');
    }, 1500);

    const timer4 = setTimeout(() => {
      setReadingProgress(94);
      setReadingPhase('Extracting Packing List carton counts, weights & volume (CBM)...');
    }, 2100);

    try {
      // Gather documents to read: if overrideNewDocs is provided, prioritize reading the newly uploaded document(s) cleanly
      const combinedDocs: any[] = [];
      const seenNames = new Set<string>();

      if (overrideNewDocs && Array.isArray(overrideNewDocs) && overrideNewDocs.length > 0) {
        for (const d of overrideNewDocs) {
          if (d && d.name && !seenNames.has(d.name)) {
            seenNames.add(d.name);
            combinedDocs.push(d);
          }
        }
      } else {
        for (const d of uploadedDocs) {
          if (d && d.name && !seenNames.has(d.name)) {
            seenNames.add(d.name);
            combinedDocs.push(d);
          }
        }
        for (const f of files) {
          if (f && f.name && !seenNames.has(f.name)) {
            seenNames.add(f.name);
            combinedDocs.push(f);
          }
        }
      }

      let data: any = {};
      if (combinedDocs.length > 0) {
        data = await autoFillCaseData(combinedDocs);
      } else {
        await new Promise(r => setTimeout(r, 1200));
      }

      setReadingProgress(100);
      setReadingPhase('All International Shipping Fields Read! Opening Form...');

      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        setFormData(prev => {
          const merged = forceOverwrite ? { ...data } : { ...prev.extractedData, ...data };
          let updatedContainers = forceOverwrite ? [] : [...prev.containers];

          if (data.containers && Array.isArray(data.containers) && data.containers.length > 0) {
            updatedContainers = data.containers.map((c: any, idx: number) => ({
              id: Date.now() + idx,
              number: c.number || data.containerNo || `CNTR-${Math.floor(1000 + Math.random() * 9000)}`,
              size: c.size === '20ft' || c.size === '45ft' ? c.size : (data.containerSize === '20ft' || data.containerSize === '45ft' ? data.containerSize : '40ft'),
              weight: c.weight || data.totalWeight || data.grossWeight || 0,
              tareWeight: c.tareWeight || data.tareWeight || undefined,
              sealNo: c.sealNo || data.sealNo || data.ccsuSealNo || '',
              shipperSealNo: c.shipperSealNo || data.shipperSealNo || '',
              vehicleNo: c.vehicleNo || data.vehicleNumber || '',
              driverName: c.driverName || data.driverName || '',
              driverCnic: c.driverCnic || data.driverCnic || '',
              driverContact: c.driverContact || data.driverContact || '',
              status: 'Pending'
            }));
          } else if ((data.containerNo || data.totalWeight || data.grossWeight) && updatedContainers.length === 0) {
            updatedContainers = [
              {
                id: Date.now(),
                number: data.containerNo || `CNTR-${Math.floor(1000 + Math.random() * 9000)}`,
                size: data.containerSize === '20ft' || data.containerSize === '45ft' ? data.containerSize : '40ft',
                weight: data.totalWeight || data.grossWeight || 0,
                tareWeight: data.tareWeight || undefined,
                sealNo: data.sealNo || data.ccsuSealNo || '',
                shipperSealNo: data.shipperSealNo || '',
                vehicleNo: data.vehicleNumber || '',
                driverName: data.driverName || '',
                driverCnic: data.driverCnic || '',
                driverContact: data.driverContact || '',
                status: 'Pending'
              }
            ];
          }

          // Keep Registered Client strictly separate from Consignee Name (never overwrite formData.client with consigneeName)
          const candidateClient = prev.client || '';

          // Auto-fill category if empty or detected
          let candidateCategory = prev.category;
          if (!candidateCategory) {
            if (data.builtyNumber && !data.blNumber && !data.gdNo) {
              candidateCategory = 'Transportation of Private Cargo';
            } else if (data.tpNumber || (data.gdNo && /TP/i.test(data.gdNo)) || data.carrierName || data.serialNo) {
              candidateCategory = 'Bonded Carrier';
            } else {
              candidateCategory = data.suggestedCategory || (
                (data.consigneeAddress && (data.consigneeAddress.toUpperCase().includes('BARA') || data.consigneeAddress.toUpperCase().includes('AFGHAN') || data.consigneeAddress.toUpperCase().includes('KHYBER')))
                  ? 'Bonded Carrier'
                  : 'Bonded Carrier'
              );
            }
          }

          const matchPortName = (rawPort?: string): string => {
            if (!rawPort) return '';
            const rawLower = rawPort.toLowerCase();
            const rawUpper = rawPort.toUpperCase();
            if (rawUpper.includes('LRDP') || (rawUpper.includes('LAHORE') && rawUpper.includes('RAILWAY'))) {
              const ldp = ports.find(p => p.name.toLowerCase().includes('lahore dry port'));
              return ldp ? ldp.name : 'Lahore Dry Port';
            }
            if (rawUpper.includes('NLC') && rawUpper.includes('LAHORE')) {
              const lnlc = ports.find(p => p.name.toLowerCase().includes('lahore nlc'));
              return lnlc ? lnlc.name : 'Lahore NLC Dry Port';
            }
            const matchedPort = ports.find(p => 
              p.name.toLowerCase().includes(rawLower) || 
              rawLower.includes(p.name.toLowerCase()) || 
              (p.code && p.code.length >= 3 && rawUpper.includes(p.code.toUpperCase()))
            );
            return matchedPort ? matchedPort.name : rawPort;
          };

          // For Bonded Carrier / TP cases, the domestic transit route is from Pakistan Entry Sea Port (pod/pickupDestination) to Exit Dry Port (placeOfDelivery/dropoffDestination)
          const isBondedOrTp = candidateCategory === 'Bonded Carrier' || Boolean(data.tpNumber || (data.gdNo && /TP/i.test(data.gdNo)));
          let candidatePol = forceOverwrite ? '' : (prev.pol || '');
          if (!candidatePol) {
            if (isBondedOrTp && (data.pickupDestination || (data.pod && /SAPT|KICT|QICT|KPT|KARACHI|GWADAR|PICT/i.test(data.pod)))) {
              candidatePol = matchPortName(data.pickupDestination || data.pod);
            } else {
              candidatePol = matchPortName(data.pickupDestination || data.pol);
            }
          }

          let candidatePod = forceOverwrite ? '' : (prev.pod || '');
          if (!candidatePod) {
            if (isBondedOrTp && (data.dropoffDestination || data.placeOfDelivery)) {
              candidatePod = matchPortName(data.dropoffDestination || data.placeOfDelivery);
            } else {
              candidatePod = matchPortName(data.dropoffDestination || data.placeOfDelivery || data.pod);
            }
          }

          const foundClient = clientsData.find(c => c.name?.toLowerCase() === candidateClient.toLowerCase());
          const resolved = resolveCaseCharges(foundClient, candidateCategory, prev.serviceArrangements as any, updatedContainers);
          const nextCharges = prev.charges && prev.charges.length > 0
            ? scaleBondedCarrierChargesByContainers(prev.charges, candidateCategory, updatedContainers)
            : resolved.charges;

          return {
            ...prev,
            client: candidateClient,
            category: candidateCategory,
            pol: candidatePol,
            pod: candidatePod,
            containers: updatedContainers,
            extractedData: merged,
            serviceArrangements: resolved.arrangements as any,
            charges: nextCharges
          };
        });
      }

      // Allow animated 100% completion to display nicely
      await new Promise(r => setTimeout(r, 650));
    } catch (err) {
      console.warn("Document reading notice:", err);
    } finally {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
      setIsReadingDocuments(false);
      let activeNo = generatedCaseNo;
      if (!activeNo) {
        activeNo = generateCaseNumber();
        setGeneratedCaseNo(activeNo);
        safeAppStorage.setItem('dpl_reg_caseno', activeNo);
      }
      setStep(2);
    }
  };

  const startCamera = async () => {
    try {
      setShowCamera(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: { ideal: 'environment' } } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.warn("Camera getUserMedia fallback:", err);
      setShowCamera(false);
      // Fallback smoothly to device image capture
      cameraInputRef.current?.click();
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setShowCamera(false);
  };

  const captureImage = async () => {
    if (videoRef.current) {
      try {
        const canvas = document.createElement('canvas');
        const maxDim = 1920;
        let w = videoRef.current.videoWidth || 1280;
        let h = videoRef.current.videoHeight || 720;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, w, h);
          const rawDataUrl = canvas.toDataURL('image/jpeg', 0.92);
          const baseName = `Camera_Scan_${Date.now()}`;
          const converted = await convertImageToPdf(rawDataUrl, `${baseName}.pdf`, true);
          processFiles([converted.file]);
          stopCamera();
        }
      } catch (camErr) {
        console.warn("Camera capture error:", camErr);
        stopCamera();
      }
    }
  };

  const handleCameraFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    try {
      if (inputEl && inputEl.files && inputEl.files.length > 0) {
        const selected = Array.from(inputEl.files);
        inputEl.value = '';
        setIsAttachingFiles(true);
        const pdfFiles: File[] = [];
        for (const file of selected) {
          try {
            const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
            if (!isPdf) {
              const converted = await convertImageToPdf(file, file.name || `Scanned_Doc_${Date.now()}.pdf`, true);
              pdfFiles.push(converted.file);
            } else {
              pdfFiles.push(file);
            }
          } catch (err) {
            console.warn("Camera scan to PDF conversion fallback:", err);
            pdfFiles.push(file);
          }
        }
        processFiles(pdfFiles).finally(() => {
          setIsAttachingFiles(false);
        });
      }
    } catch (err) {
      console.warn("Camera file upload error:", err);
      setIsAttachingFiles(false);
    }
  };

  const addContainer = () => {
    setFormData((prev) => {
      const nextContainers = [
        ...prev.containers, 
        { 
          id: Date.now(), 
          number: `CNTR-${Math.floor(Math.random()*10000)}`, 
          size: '40ft' as const, 
          weight: 0,
          status: 'Pending' as const
        }
      ];
      return {
        ...prev,
        containers: nextContainers,
        charges: scaleBondedCarrierChargesByContainers(
          prev.charges || [],
          prev.category || 'Bonded Carrier',
          nextContainers
        )
      };
    });
  };

  const updateContainer = (id: number, field: string, value: any) => {
    setFormData(prev => {
      const nextContainers = prev.containers.map((c, idx) => {
        if (c.id !== id) return c;
        const updated: any = { ...c, [field]: value };
        if (field === 'seal' || field === 'sealNo') {
          updated.seal = value;
          updated.sealNo = value;
        }
        return updated;
      });
      const first = nextContainers[0];
      const nextExtracted = { ...prev.extractedData };
      if (first && first.id === id) {
        if (field === 'number') nextExtracted.containerNo = value;
        if (field === 'size') nextExtracted.containerSize = value;
        if (field === 'weight') {
          nextExtracted.grossWeight = value;
          nextExtracted.totalWeight = value;
        }
        if (field === 'seal' || field === 'sealNo') {
          nextExtracted.sealNo = value;
          nextExtracted.ccsuSealNo = value;
        }
        if (field === 'shipperSealNo') nextExtracted.shipperSealNo = value;
        if (field === 'vehicleNo') nextExtracted.vehicleNumber = value;
        if (field === 'driverName') nextExtracted.driverName = value;
        if (field === 'driverCnic') nextExtracted.driverCnic = value;
      }
      return {
        ...prev,
        containers: nextContainers,
        extractedData: nextExtracted,
        charges: scaleBondedCarrierChargesByContainers(
          prev.charges || [],
          prev.category || 'Bonded Carrier',
          nextContainers
        )
      };
    });
  };

  const removeContainer = (id: number) => {
    if (window.confirm("Are you sure you want to remove this container?")) {
      setFormData(prev => {
        const nextContainers = prev.containers.filter(c => c.id !== id);
        return {
          ...prev,
          containers: nextContainers,
          charges: scaleBondedCarrierChargesByContainers(
            prev.charges || [],
            prev.category || 'Bonded Carrier',
            nextContainers
          )
        };
      });
    }
  }

  const updateExtractedData = (field: string, value: any) => {
    setFormData(prev => {
      const nextExtracted: any = { ...prev.extractedData, [field]: value };
      if (field === 'sealNo' || field === 'ccsuSealNo') {
        nextExtracted.sealNo = value;
        nextExtracted.ccsuSealNo = value;
      }
      let nextContainers = prev.containers;
      if (prev.containers.length > 0) {
        const first = { ...prev.containers[0] };
        let touched = false;
        if (field === 'containerNo') { first.number = value; touched = true; }
        if (field === 'containerSize') { first.size = value; touched = true; }
        if (field === 'grossWeight' || field === 'totalWeight') { first.weight = Number(value) || 0; touched = true; }
        if (field === 'tareWeight') { first.tareWeight = Number(value) || 0; touched = true; }
        if (field === 'sealNo' || field === 'ccsuSealNo') { first.seal = value; first.sealNo = value; touched = true; }
        if (field === 'shipperSealNo') { first.shipperSealNo = value; touched = true; }
        if (field === 'vehicleNumber') { first.vehicleNo = value; touched = true; }
        if (field === 'driverName') { first.driverName = value; touched = true; }
        if (field === 'driverCnic') { first.driverCnic = value; touched = true; }
        if (touched) {
          nextContainers = [first, ...prev.containers.slice(1)];
        }
      }
      return {
        ...prev,
        extractedData: nextExtracted,
        containers: nextContainers
      };
    });
  };

  const handleFinalSubmit = () => {
      const serializableDocs = uploadedDocs.length > 0 
        ? uploadedDocs.map(d => {
            const cached = docDataCache.get(d.name) || (d.id ? docDataCache.get(d.id) : null);
            const resolvedUrl = d.url && d.url.startsWith('data:') 
              ? d.url 
              : cached?.base64 
                ? `data:${cached.mimeType || 'application/pdf'};base64,${cached.base64}` 
                : d.url || '';
            return {
              id: d.id,
              name: d.name || 'document',
              type: d.type || (d.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
              size: d.size || 0,
              url: resolvedUrl,
              docCategory: d.docCategory || 'GENERAL'
            };
          })
        : files.map((f: any) => {
            const cached = docDataCache.get((f as any).name);
            const resolvedUrl = cached?.base64 
              ? `data:${cached.mimeType || 'application/pdf'};base64,${cached.base64}` 
              : '';
            return {
              name: (f as any).name || 'document',
              type: (f as any).type || ((f as any).name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
              size: (f as any).size || 0,
              url: resolvedUrl,
              docCategory: 'GENERAL'
            };
          });

      const finalCharges = (formData.charges && formData.charges.length > 0)
        ? formData.charges
        : [];

      // Final sequential verification: ensure case number is strictly unique & sequential
      let finalCaseNo = generatedCaseNo;
      const isTaken = !finalCaseNo || cases.some(c => c.caseNo === finalCaseNo);
      if (isTaken) {
        finalCaseNo = generateCaseNumber();
        setGeneratedCaseNo(finalCaseNo);
      }

      const initialWorkflow = getCategoryWorkflow(formData.category);
      const initialStepStatus = initialWorkflow.steps[0]?.id || CaseStatus.SHIPPING_LINE_DO;

      // Auto-approval determination:
      // When Operation Manager, Case Manager, Admin, or Finance Manager registers a case:
      // It is AUTO-APPROVED immediately without needing any approval notification.
      // ONLY when registered by Client from Client Portal does it require approval.
      const isAutoApprovedStaff = isInternalStaffAutoApproving(effectiveRole, effectiveRoles);
      const isExplicitClient = !isAutoApprovedStaff && (
        isClientUser ||
        String(effectiveRole).toUpperCase() === UserRole.CLIENT ||
        String(effectiveRole).toUpperCase().includes('CLIENT') ||
        safeAppStorage.getItem('dpl_user_role') === UserRole.CLIENT
      );

      const requiresApproval = isExplicitClient;

      // Save document data in IndexedDB and memory cache under multiple keys to guarantee viewing/downloading
      serializableDocs.forEach((d: any) => {
        const dataUrl = d.url;
        if (dataUrl && dataUrl.startsWith('data:')) {
          const parts = dataUrl.split(',');
          const mime = parts[0]?.split(';')[0]?.replace('data:', '') || d.type || 'application/pdf';
          const b64 = parts[1] || '';
          docDataCache.set(d.name, { base64: b64, mimeType: mime, name: d.name });
          docDataCache.set(`${finalCaseNo}_${d.name}`, { base64: b64, mimeType: mime, name: d.name });
          if (d.id) {
            docDataCache.set(d.id, { base64: b64, mimeType: mime, name: d.name });
          }
          saveDocumentToIndexedDB({
            key: `${finalCaseNo}_${d.name}`,
            id: d.id,
            name: d.name,
            type: mime,
            size: d.size,
            dataUrl,
            caseNo: finalCaseNo
          }).catch(() => {});
          saveDocumentToIndexedDB({
            key: d.name,
            id: d.id,
            name: d.name,
            type: mime,
            size: d.size,
            dataUrl,
            caseNo: finalCaseNo
          }).catch(() => {});
        }
      });

      const ext = formData.extractedData || {};
      const primaryContainer = formData.containers?.[0];
      const prefilledWorkflowDetails: Record<string, any> = {};
      if (ext.shippingLine || ext.shippingAgent) {
        prefilledWorkflowDetails[CaseStatus.SHIPPING_LINE_DO] = {
          status: CaseStatus.SHIPPING_LINE_DO,
          shippingLine: ext.shippingLine || '',
          shippingAgent: ext.shippingAgent || '',
          clientDoShippingLine: ext.shippingLine || '',
          clientDoFavorOf: ext.clearingAgent || ext.consigneeName || formData.client || ''
        };
      }
      if (ext.gdNo || ext.gdDate || ext.itemName) {
        prefilledWorkflowDetails[CaseStatus.TP_FILING] = {
          status: CaseStatus.TP_FILING,
          tpGdNumber: ext.gdNo || '',
          tpFilingDate: ext.gdDate || '',
          tpItemDescription: ext.itemDescription || ext.itemName || ''
        };
      }
      if (ext.vehicleNumber || primaryContainer?.vehicleNo || ext.driverName || primaryContainer?.driverName) {
        prefilledWorkflowDetails[CaseStatus.VEHICLE_ASSIGNMENT] = {
          status: CaseStatus.VEHICLE_ASSIGNMENT,
          assignedVehicleNo: ext.vehicleNumber || primaryContainer?.vehicleNo || '',
          driverName: ext.driverName || primaryContainer?.driverName || '',
          driverCnic: ext.driverCnic || primaryContainer?.driverCnic || ''
        };
      }
      if (ext.sealNo || ext.ccsuSealNo || primaryContainer?.seal) {
        prefilledWorkflowDetails[CaseStatus.LOADING_PORT_PROCESS] = {
          status: CaseStatus.LOADING_PORT_PROCESS,
          customsSealNumber: ext.sealNo || ext.ccsuSealNo || primaryContainer?.seal || '',
          officer: ext.pccssOfficer || ''
        };
      }

      const resolvedClientName = (formData.client || '').trim() || registeredClients[0] || '';
      if (!resolvedClientName) {
        alert('Please select the Client Name before registering the case.');
        setStep(1);
        return;
      }

      const newCase: Case = {
          id: Date.now().toString(),
          caseNo: finalCaseNo,
          clientName: resolvedClientName,
          category: formData.category,
          subCategory: supportsSubCategories(formData.category) ? (formData.subCategory || 'Standard Container / General Cargo') : undefined,
          status: requiresApproval ? 'Pending Approval' : initialStepStatus, 
          approvalStatus: requiresApproval ? 'PENDING' : 'APPROVED',
          registeredByRole: String(effectiveRole),
          approvedBy: requiresApproval ? undefined : String(effectiveRole),
          approvedAt: requiresApproval ? undefined : new Date().toISOString(),
          createdAt: new Date().toISOString(),
          pol: formData.pol,
          pod: formData.pod,
          containerNumber: primaryContainer?.number || ext.containerNo || '',
          blNumber: ext.blNumber || '',
          igmNo: ext.igmNo || '',
          invoiceNo: finalCaseNo,
          containers: formData.containers,
          extractedData: formData.extractedData,
          documents: serializableDocs,
          charges: finalCharges,
          serviceArrangements: formData.serviceArrangements,
          workflowDetails: prefilledWorkflowDetails
      };
      const updatedCases = [newCase, ...cases.filter(c => c.caseNo !== newCase.caseNo)];
      setCases(updatedCases);
      setSubmittedCaseData(newCase);
      safeAppStorage.setJSON('dpl_live_cases', updatedCases);
      window.dispatchEvent(new CustomEvent('dpl_cases_updated', { detail: updatedCases }));
      saveCaseToFirestore(newCase).catch((e) => console.warn("Firestore saveCase error:", e));

      // Dispatch notification ONLY for Client registrations (target: Admin, Operations Manager, Case Manager)
      // When registered by Operation Manager, Case Manager, Admin, or Finance Manager: NO notification is sent! ("Koi notification ki zarurat nhy")
      if (requiresApproval) {
        sendAppNotification({
          title: `Client Case Approval Required: #${newCase.caseNo}`,
          description: `Client "${newCase.clientName}" registered new case #${newCase.caseNo}. Needs Operation Manager, Case Manager, or Admin approval to activate.`,
          targetRole: 'ADMIN, OPERATIONS_MANAGER, CASE_MANAGER',
          targetView: 'cases',
          targetFilter: { caseNo: newCase.caseNo },
          type: 'ACTION',
          notificationSubType: 'CASE_APPROVAL',
          actionLabel: 'Review & Approve',
          performedBy: effectiveRole,
          performedByRole: String(effectiveRole),
          category: 'CASE',
          priority: 'HIGH'
        }).catch(e => console.warn("Could not dispatch case notif:", e));
      }

      if (resolvedClientName && !clientsData.some(c => c.name?.trim().toLowerCase() === resolvedClientName.toLowerCase())) {
        saveClientToFirestore({ name: resolvedClientName }).catch(() => {});
      }

      // Registration is complete! Clean up draft keys from storage and online Firestore
      safeAppStorage.removeItem('dpl_reg_draft_active');
      safeAppStorage.removeItem('dpl_reg_step');
      safeAppStorage.removeItem('dpl_reg_caseno');
      safeAppStorage.removeItem('dpl_reg_formdata');
      safeAppStorage.removeItem('dpl_reg_docs');
      safeAppStorage.removeItem('dpl_reg_updated_at');
      safeAppStorage.removeItem('dpl_reg_timestamp');
      safeAppStorage.removeItem('dpl_reg_view');
      deleteUserWorkDraftFromFirestore(activeDraftUserKey).catch(() => {});
      setHasDraft(false);

      setIsCaseSubmitted(true);
      setStep(4); 
  };

  // --- Filter Logic ---
  const handleSearchRecords = () => {
    if (filterDates.start && filterDates.end) {
        setActiveDateFilter(filterDates);
    } else {
        setActiveDateFilter(null);
    }
    setShowFilterModal(false);
  };

  const handleOpenReport = () => {
    setShowReportModal(true);
    setShowFilterModal(false);
  };

  // Workflow Tab Filter (All Active, In Progress, Completed, Incident Vault)
  const [activeWorkflowTab, setActiveWorkflowTab] = useState<'all' | 'in_progress' | 'completed' | 'incident_vault'>('all');

  const incidentCasesCount = cases.filter(c => c.status === CaseStatus.INCIDENT_STOPPAGE || c.isIncidentVault).length;
  const completedCasesCount = cases.filter(c => c.status === CaseStatus.COMPLETED && !c.isIncidentVault).length;
  const inProgressCasesCount = cases.filter(c => c.status !== CaseStatus.COMPLETED && c.status !== CaseStatus.INCIDENT_STOPPAGE && !c.isIncidentVault).length;

  // Filtering Logic Combined
  const filteredCases = cases.filter(c => {
      // Incident Vault separation
      if (activeWorkflowTab === 'incident_vault') {
        return c.status === CaseStatus.INCIDENT_STOPPAGE || c.isIncidentVault === true;
      }
      // Hide incident stoppage cases from normal lists
      if (c.status === CaseStatus.INCIDENT_STOPPAGE || c.isIncidentVault === true) {
        return false;
      }

      // Workflow Status Tabs
      if (activeWorkflowTab === 'in_progress' && c.status === CaseStatus.COMPLETED) return false;
      if (activeWorkflowTab === 'completed' && c.status !== CaseStatus.COMPLETED) return false;

      // Date Filter
      if (activeDateFilter) {
          if (c.createdAt < activeDateFilter.start || c.createdAt > activeDateFilter.end) return false;
      }
      // Status Filter (from Dashboard)
      if (statusFilter) {
          if (c.status !== statusFilter) return false;
      }
      return true;
  });

  const clearStatusFilter = () => {
      setStatusFilter(null);
      if(clearFilter) clearFilter();
  };

  const handleResolveIncident = (caseToResume: Case) => {
    const updated: Case = {
      ...caseToResume,
      status: CaseStatus.IN_TRANSIT,
      isIncidentVault: false,
      incidentDetails: undefined
    };
    setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
    if (selectedCase?.id === updated.id) setSelectedCase(updated);
    updateCaseInFirestore(updated).catch(e => console.warn("Firestore error resolving incident:", e));
  };

  // --- Detail View Logic ---

  const handleEditCaseToggle = () => {
     if (isEditingCase) {
         // Cancel
         setIsEditingCase(false);
         setEditedCase(selectedCase);
     } else {
         // Start Edit
         const caseCopy = JSON.parse(JSON.stringify(selectedCase));
         caseCopy.documents = selectedCase.documents; // Preserve File objects
         setEditedCase(caseCopy); 
         setIsEditingCase(true);
     }
  };

  const handleSaveEditedCase = () => {
      if (!selectedCase || !editedCase) return;

      const isOverOneHour = (() => {
        const createdTime = new Date(selectedCase.createdAt || selectedCase.registrationDate || 0).getTime();
        if (isNaN(createdTime) || createdTime === 0) return false;
        return (Date.now() - createdTime) > 60 * 60 * 1000;
      })();

      let finalToSave = editedCase;

      // 1-Hour Compliance Lock: Non-admin can only fill in empty fields, cannot overwrite or delete previously entered data
      if (isOverOneHour && !hasAdminRole) {
        const merged: any = { ...editedCase };
        const coreKeys: (keyof Case)[] = ['clientName', 'category', 'pol', 'pod', 'blNumber', 'containerNumber', 'igmNo'];
        for (const k of coreKeys) {
          if (selectedCase[k] && selectedCase[k] !== editedCase[k]) {
            merged[k] = selectedCase[k]; // Revert populated field
          }
        }
        if (selectedCase.documents && selectedCase.documents.length > 0) {
          const currentDocNames = new Set((editedCase.documents || []).map((d: any) => d.name || d.id));
          const missingDocs = selectedCase.documents.filter((d: any) => !currentDocNames.has(d.name || d.id));
          if (missingDocs.length > 0) {
            merged.documents = [...(editedCase.documents || []), ...missingDocs];
          }
        }
        finalToSave = merged;
      }

      // Update local state and Firestore
      const updatedCases = cases.map(c => c.id === finalToSave.id ? finalToSave : c);
      setCases(updatedCases);
      setSelectedCase(finalToSave);
      setIsEditingCase(false);
      updateCaseInFirestore(finalToSave).catch((e) => console.warn("Firestore updateCase error:", e));
  };

  const handleInitiateFinishedCaseAction = (action: 'DELETE' | 'CANCEL' | 'EDIT') => {
    const target = isEditingCase ? editedCase : selectedCase;
    if (!target) return;

    const isOverOneHour = (() => {
      const createdTime = new Date(target.createdAt || target.registrationDate || 0).getTime();
      if (isNaN(createdTime) || createdTime === 0) return false;
      return (Date.now() - createdTime) > 60 * 60 * 1000;
    })();

    // 1-Hour Compliance Lock: Only Admin can delete or cancel after 1 hour
    if (isOverOneHour && !hasAdminRole) {
      if (action === 'DELETE' || action === 'CANCEL') {
        alert("Compliance Policy: This consignment was registered more than 1 hour ago and is locked. Only Corporate Administrators have authorization to delete or cancel locked records.");
        return;
      }
    }

    const isCaseFinished = target.status === CaseStatus.COMPLETED || target.status === ('Delivered' as any) || target.status === ('Completed' as any);

    if (!isCaseFinished || hasAdminRole) {
      if (action === 'EDIT') {
        handleEditCaseToggle();
      } else if (action === 'DELETE') {
        if (window.confirm("Are you sure you want to delete this case?")) {
          if (target?.id) {
            deleteCaseFromFirestore(target.id).catch(() => {});
          }
          setCases(cases.filter(c => c.id !== target?.id));
          setView('list');
        }
      } else if (action === 'CANCEL') {
        if (window.confirm("Are you sure you want to cancel this case?")) {
          const cancelledCase = { ...target, status: 'Cancelled' as any };
          setCases(cases.map(c => c.id === target.id ? cancelledCase : c));
          setSelectedCase(cancelledCase);
          updateCaseInFirestore(cancelledCase).catch(() => {});
        }
      }
      return;
    }

    // Finished case & non-admin -> requires Admin approval notification!
    setApprovalTargetAction(action);
    setApprovalReason('');
    setShowApprovalPromptModal(true);
  };

  const handleSubmitFinishedCaseApproval = async () => {
    const target = isEditingCase ? editedCase : selectedCase;
    if (!target) return;
    if (!approvalReason.trim()) {
      alert("Please enter a reason or justification for this action.");
      return;
    }
    setIsSubmittingApproval(true);
    try {
      const requesterName = safeAppStorage.getItem('dpl_user_name') || 'Staff User';
      const requesterRole = effectiveRoles.map(r => r.replace(/_/g, ' ')).join(', ');
      const res = await submitCaseActionApproval({
        actionType: approvalTargetAction,
        caseItem: target,
        requestedBy: requesterName,
        requestedByRole: requesterRole,
        reason: approvalReason.trim()
      });

      setCases(prev => prev.map(c => c.id === res.updatedCase.id ? res.updatedCase : c));
      setSelectedCase(res.updatedCase);
      setShowApprovalPromptModal(false);
      alert(`Your request to ${approvalTargetAction} this finished case has been submitted to Super Admin for approval.`);
    } catch (err) {
      console.error("Failed to submit approval request:", err);
      alert("Could not submit approval request. Please try again.");
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const handleApproveCase = () => {
    const target = isEditingCase ? editedCase : selectedCase;
    if (!target) return;
    
    // Logic to move to next status
    let newStatus = target.status;
    if (target.status === 'Pending Approval' || target.approvalStatus === 'PENDING') {
      const initialWorkflow = getCategoryWorkflow(target.category);
      newStatus = initialWorkflow.steps[0]?.id || CaseStatus.SHIPPING_LINE_DO;
    } else if (target.status === CaseStatus.SHIPPING_LINE_DO) {
        newStatus = CaseStatus.LOADING_PORT_PROCESSING;
    } else if (target.status === CaseStatus.LOADING_PORT_PROCESSING) {
        newStatus = CaseStatus.IN_TRANSIT;
    }

    const updatedCase = { 
      ...target, 
      status: newStatus,
      approvalStatus: 'APPROVED' as const,
      approvedBy: effectiveRole,
      approvedAt: new Date().toISOString()
    };
    const updatedCases = cases.map(c => c.id === target.id ? updatedCase : c);
    setCases(updatedCases);
    setSelectedCase(updatedCase);
    updateCaseInFirestore(updatedCase).catch((e) => console.warn("Firestore approveCase error:", e));

    // Dispatch real-time workflow notification to related roles
    if (newStatus === CaseStatus.LOADING_PORT_PROCESSING) {
      sendAppNotification({
        title: `Shipment Ready for Port Loading: #${target.caseNo}`,
        description: `Case #${target.caseNo} (${target.clientName}) has reached Port Loading Stage at ${target.portOfLoading || 'Loading Port'}. Ready for Gate Pass and Loading Operations.`,
        targetRole: UserRole.LOADING_PORT_STAFF,
        targetView: 'cases',
        targetFilter: { caseNo: target.caseNo },
        type: 'ACTION',
        notificationSubType: 'CASE_APPROVAL',
        actionLabel: 'View Case',
        performedBy: effectiveRole,
        performedByRole: String(effectiveRole),
        category: 'CASE'
      }).catch(e => console.warn(e));
    } else if (newStatus === CaseStatus.IN_TRANSIT) {
      sendAppNotification({
        title: `Shipment In Transit to Destination: #${target.caseNo}`,
        description: `Case #${target.caseNo} has cleared loading port and is in transit towards ${target.portOfDischarge || target.destinationCity || 'Destination Terminal'}.`,
        targetRole: UserRole.DESTINATION_PORT_STAFF,
        targetView: 'cases',
        targetFilter: { caseNo: target.caseNo },
        type: 'INFO',
        performedBy: effectiveRole,
        performedByRole: String(effectiveRole),
        category: 'CASE'
      }).catch(e => console.warn(e));
    }

    logActivity(
      `Case Approved: ${target.caseNo}`,
      `Case ${target.caseNo} (${target.clientName}) was officially approved by ${effectiveRole}. Status advanced to ${newStatus}.`,
      effectiveRole,
      'OPERATIONS',
      { caseNo: target.caseNo, client: target.clientName }
    );
    
    if (activeNotificationId && onActionComplete) {
        onActionComplete(activeNotificationId);
        setActiveNotificationId(null);
    }
  };

  const handleRejectCase = () => {
    const target = isEditingCase ? editedCase : selectedCase;
    if (!target) return;
    const updatedCase = {
      ...target,
      approvalStatus: 'REJECTED' as const,
      approvedBy: effectiveRole,
      approvedAt: new Date().toISOString()
    };
    const updatedCases = cases.map(c => c.id === target.id ? updatedCase : c);
    setCases(updatedCases);
    setSelectedCase(updatedCase);
    updateCaseInFirestore(updatedCase).catch((e) => console.warn("Firestore rejectCase error:", e));
    logActivity(
      `Case Rejected: ${target.caseNo}`,
      `Case ${target.caseNo} (${target.clientName}) was rejected by ${effectiveRole}.`,
      effectiveRole,
      'OPERATIONS',
      { caseNo: target.caseNo, client: target.clientName }
    );
  };

  // --- Advanced Report Logic ---
  const getFilteredReportData = () => {
    return cases.filter(c => {
      // 1. Global Search (Deep Search)
      if (reportSearchTerm) {
        const rowString = JSON.stringify(c).toLowerCase();
        if (!rowString.includes(reportSearchTerm.toLowerCase())) return false;
      }

      // 2. Column Filters
      for (const col of REPORT_COLUMNS) {
        const filterVal = reportFilters[col.key];
        if (filterVal) {
          const cellVal = String(getNestedValue(c, col.key) || '').toLowerCase();
          if (!cellVal.includes(filterVal.toLowerCase())) return false;
        }
      }

      return true;
    });
  };

  const handleColumnFilterChange = (key: string, value: string) => {
    setReportFilters(prev => ({ ...prev, [key]: value }));
  };

  // Dedicated Popup Modal for Full Case Details & Complete Documents Download
  const renderReportCaseDetailModal = () => {
    if (!reportSelectedCase) return null;
    const c = reportSelectedCase;
    const caseNo = c.caseNo || c.caseNumber || 'N/A';
    const clientName = c.clientName || c.client || c.extractedData?.consigneeName || 'N/A';
    const status = c.status || 'Active';
    const pol = c.pol || c.extractedData?.pol || 'Karachi Port / Terminal';
    const pod = c.pod || c.extractedData?.pod || c.extractedData?.placeOfDelivery || 'Upcountry Dry Port';
    const dateStr = c.createdAt ? c.createdAt.split('T')[0] : (c.registrationDate || c.date || 'N/A');
    const ext = c.extractedData || ({} as ExtractedData);
    const docs = c.documents || [];
    const charges = c.charges || [];
    const containers = c.containers || [];

    const handleDownloadAllFilesBatch = () => {
      // 1. Download Unified Complete Dossier PDF
      handleDownloadPdfFile(c, { withInvoice: true, withAttachments: true });
      // 2. Trigger download of any attached document files
      if (docs.length > 0) {
        docs.forEach((doc: any, i: number) => {
          setTimeout(async () => {
            try {
              const docName = doc.name || `Document_${caseNo}_${i + 1}`;
              let url = doc.url;
              if ((!url || !url.startsWith('data:')) && docDataCache.get(docName)?.base64) {
                const cached = docDataCache.get(docName)!;
                url = `data:${cached.mimeType || 'application/pdf'};base64,${cached.base64}`;
              }
              if (!url) {
                const idbData = await getDocumentFromIndexedDB(`${caseNo}_${docName}`) || await getDocumentFromIndexedDB(docName);
                if (idbData) url = idbData;
              }
              if (!url && doc instanceof File) {
                try { url = URL.createObjectURL(doc); } catch (_) {}
              }
              if (url) {
                downloadFile(url, docName.includes('.') ? docName : `${docName}.pdf`);
              }
            } catch (err) {
              console.warn("File download notice:", err);
            }
          }, (i + 1) * 350);
        });
      }
    };

    return (
      <div 
        className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-md flex items-start justify-center pt-6 sm:pt-10 p-3 sm:p-6 no-print overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) setReportSelectedCase(null);
        }}
      >
        <div className="bg-slate-900 border border-white/15 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
          
          {/* Modal Header */}
          <div className="p-5 sm:p-6 border-b border-white/10 bg-slate-950/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
            <div className="space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xl sm:text-2xl font-black font-mono text-amber-300 tracking-wider">
                  {caseNo}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(caseNo);
                    setCopiedCaseNo(true);
                    setTimeout(() => setCopiedCaseNo(false), 2000);
                  }}
                  className="text-gray-400 hover:text-white p-1 rounded transition-colors text-xs flex items-center gap-1 bg-white/5 px-2 py-0.5 border border-white/10 cursor-pointer"
                  title="Copy Case Number"
                >
                  {copiedCaseNo ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copiedCaseNo ? 'Copied' : 'Copy'}</span>
                </button>
                <span className="px-3 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-brand-500/20 text-brand-300 border border-brand-500/30">
                  {status}
                </span>
              </div>
              <p className="text-xs text-gray-300">
                <span className="font-semibold text-white">{clientName}</span> • <span className="text-gray-400">{c.category || 'Bonded Carrier'}</span>
                {c.subCategory && c.subCategory !== 'Standard Container / General Cargo' && ` (${c.subCategory})`}
                {' '}• Registered on {dateStr}
              </p>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <button
                type="button"
                onClick={handleDownloadAllFilesBatch}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                title="Download all case documents, dossier PDF and attachments"
              >
                <Download size={15} />
                <span>Download All Documents</span>
              </button>

              <button 
                type="button"
                onClick={() => setReportSelectedCase(null)}
                className="text-gray-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Modal Scrollable Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6 space-y-6 text-gray-200">
            
            {/* 1. Quick Document Downloads Center */}
            <div className="bg-gradient-to-r from-brand-950/60 via-slate-900 to-amber-950/40 p-4 sm:p-5 rounded-2xl border border-white/10 shadow-lg space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Download size={16} className="text-emerald-400" />
                    <span>Download Case Documents & Official PDFs</span>
                  </h4>
                  <p className="text-[11px] text-gray-400">
                    One-click access to complete case dossier, single-page summary, commercial invoice, DO, and shipping documents.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCase(c);
                      setShowDownloadDocsModal(true);
                    }}
                    className="text-[11px] text-brand-300 hover:text-white font-medium underline flex items-center gap-1"
                  >
                    <span>Full Download Center</span>
                    <ExternalLink size={11} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                {/* Button A: Complete Dossier */}
                <button
                  type="button"
                  onClick={() => handleDownloadPdfFile(c, { withInvoice: true, withAttachments: true })}
                  disabled={isDownloadingPdf}
                  className="bg-emerald-700/80 hover:bg-emerald-600 border border-emerald-500/40 text-white p-3 rounded-xl text-xs font-semibold flex flex-col items-center justify-center text-center gap-1 shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="Download unified PDF with all case particulars, invoices, and paperwork"
                >
                  <Download size={16} className="text-emerald-200" />
                  <span>Complete Dossier (PDF)</span>
                  <span className="text-[9px] text-emerald-200/80 font-normal">All details + attachments</span>
                </button>

                {/* Button B: Case Summary */}
                <button
                  type="button"
                  onClick={() => handleDownloadPdfFile(c, { onlyCaseDetails: true })}
                  disabled={isDownloadingPdf}
                  className="bg-brand-700/80 hover:bg-brand-600 border border-brand-500/40 text-white p-3 rounded-xl text-xs font-semibold flex flex-col items-center justify-center text-center gap-1 shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="Download clean single-page official case summary"
                >
                  <FileText size={16} className="text-brand-200" />
                  <span>Case Summary (PDF)</span>
                  <span className="text-[9px] text-brand-200/80 font-normal">Single-page metadata</span>
                </button>

                {/* Button C: Commercial Invoice */}
                <button
                  type="button"
                  onClick={() => handleDownloadPdfFile(c, { onlyInvoice: true })}
                  disabled={isDownloadingPdf}
                  className="bg-amber-700/80 hover:bg-amber-600 border border-amber-500/40 text-white p-3 rounded-xl text-xs font-semibold flex flex-col items-center justify-center text-center gap-1 shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="Download official commercial invoice voucher"
                >
                  <Receipt size={16} className="text-amber-200" />
                  <span>Commercial Invoice</span>
                  <span className="text-[9px] text-amber-200/80 font-normal">Itemized bill breakdown</span>
                </button>

                {/* Button D: Customs Delivery Order (DO) */}
                {isDestinationUnloadedAndGateOut(c) && (
                  <button
                    type="button"
                    onClick={() => handleDownloadDeliveryOrder(c)}
                    className="bg-purple-700/80 hover:bg-purple-600 border border-purple-500/40 text-white p-3 rounded-xl text-xs font-semibold flex flex-col items-center justify-center text-center gap-1 shadow-md transition-all active:scale-95 cursor-pointer"
                    title="Print customs delivery order document"
                  >
                    <FileCheck size={16} className="text-purple-200" />
                    <span>Print DO Document</span>
                    <span className="text-[9px] text-purple-200/80 font-normal">Port/Terminal Delivery Order</span>
                  </button>
                )}
              </div>
            </div>

            {/* 2. Attached Shipping Files & Documents */}
            {docs.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                    <Package size={15} className="text-brand-400" />
                    <span>Attached Shipping Documents ({docs.length})</span>
                  </h4>
                  <button
                    type="button"
                    onClick={handleDownloadAllFilesBatch}
                    className="text-[11px] text-brand-300 hover:text-white flex items-center gap-1 font-medium underline"
                  >
                    <Download size={12} />
                    <span>Download All Files</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {docs.map((doc: any, idx: number) => {
                    const docName = doc.name || `Attached_Document_${idx + 1}`;
                    const docCategory = doc.docCategory || doc.type || 'Customs Paperwork';
                    let docUrl = doc.url;
                    const cached = docDataCache.get(docName) || docDataCache.get(doc.name);
                    if ((!docUrl || !docUrl.startsWith('data:')) && cached?.base64) {
                      docUrl = `data:${cached.mimeType || 'application/pdf'};base64,${cached.base64}`;
                    }
                    if (!docUrl && doc instanceof File) {
                      try { docUrl = URL.createObjectURL(doc); } catch (_) {}
                    }

                    const resolveActiveDocUrl = async (): Promise<string> => {
                      if (docUrl && (docUrl.startsWith('data:') || docUrl.startsWith('http'))) {
                        return docUrl;
                      }
                      const cached = docDataCache.get(docName) || docDataCache.get(doc.name);
                      if (cached?.base64) {
                        return `data:${cached.mimeType || 'application/pdf'};base64,${cached.base64}`;
                      }
                      const idbData = await getDocumentFromIndexedDB(`${c.caseNo}_${docName}`) || await getDocumentFromIndexedDB(docName) || (doc.id ? await getDocumentFromIndexedDB(doc.id) : null);
                      if (idbData) return idbData;
                      return docUrl || '';
                    };

                    const handlePreview = async () => {
                      let activeUrl = await resolveActiveDocUrl();
                      if (!activeUrl) {
                        try {
                          const docPdf = new jsPDF();
                          docPdf.setFillColor(15, 23, 42);
                          docPdf.rect(0, 0, 210, 297, 'F');
                          docPdf.setTextColor(245, 158, 11);
                          docPdf.setFontSize(16);
                          docPdf.text('MAK GROUP OF COMPANIES', 105, 25, { align: 'center' });
                          docPdf.setTextColor(255, 255, 255);
                          docPdf.setFontSize(11);
                          docPdf.text('Case Dossier Attached Document', 105, 34, { align: 'center' });
                          docPdf.setFontSize(10);
                          docPdf.setTextColor(200, 200, 200);
                          docPdf.text(`Case No: #${c.caseNo}`, 20, 50);
                          docPdf.text(`File: ${docName}`, 20, 58);
                          docPdf.text(`Category: ${docCategory}`, 20, 66);
                          docPdf.text(`Client: ${c.clientName || 'N/A'}`, 20, 74);
                          docPdf.text(`Routing: ${c.pol || 'N/A'} -> ${c.pod || 'N/A'}`, 20, 82);
                          activeUrl = docPdf.output('datauristring');
                        } catch (_) {}
                      }
                      if (activeUrl) {
                        const isPdf = docName.toLowerCase().endsWith('.pdf') || activeUrl.startsWith('data:application/pdf');
                        if (isPdf) {
                          setDirectDownloadUrl(activeUrl);
                          setDirectDownloadFilename(docName.endsWith('.pdf') ? docName : `${docName}.pdf`);
                          setIsPdfViewerOpen(true);
                        } else {
                          setLightboxImage(activeUrl);
                        }
                      }
                    };

                    const handleDownload = async () => {
                      let activeUrl = await resolveActiveDocUrl();
                      if (!activeUrl) {
                        try {
                          const docPdf = new jsPDF();
                          docPdf.setFillColor(15, 23, 42);
                          docPdf.rect(0, 0, 210, 297, 'F');
                          docPdf.setTextColor(245, 158, 11);
                          docPdf.setFontSize(16);
                          docPdf.text('MAK GROUP OF COMPANIES', 105, 25, { align: 'center' });
                          docPdf.setTextColor(255, 255, 255);
                          docPdf.setFontSize(11);
                          docPdf.text('Case Dossier Attached Document', 105, 34, { align: 'center' });
                          docPdf.setFontSize(10);
                          docPdf.setTextColor(200, 200, 200);
                          docPdf.text(`Case No: #${c.caseNo}`, 20, 50);
                          docPdf.text(`File: ${docName}`, 20, 58);
                          docPdf.text(`Category: ${docCategory}`, 20, 66);
                          docPdf.text(`Client: ${c.clientName || 'N/A'}`, 20, 74);
                          activeUrl = docPdf.output('datauristring');
                        } catch (_) {}
                      }
                      if (activeUrl) {
                        downloadFile(activeUrl, docName.includes('.') ? docName : `${docName}.pdf`);
                      }
                    };

                    return (
                      <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-white/10 hover:border-white/20 transition-all text-xs">
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <div className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-400 flex items-center justify-center shrink-0">
                            <FileText size={16} />
                          </div>
                          <div className="truncate">
                            <p className="font-semibold text-white truncate">{docName}</p>
                            <span className="text-[10px] text-gray-400">{docCategory}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={handlePreview}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition-colors cursor-pointer"
                            title="Preview Document"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={handleDownload}
                            className="p-1.5 rounded-lg bg-brand-600/30 hover:bg-brand-600 text-brand-300 hover:text-white transition-colors flex items-center gap-1 font-medium text-[11px] px-2.5 cursor-pointer"
                            title="Download File"
                          >
                            <Download size={13} />
                            <span>Save</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Comprehensive Shipping Particulars Grid */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                <Ship size={15} className="text-brand-400" />
                <span>Shipping, Routing & Commodity Particulars</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                
                {/* Card A: Bill of Lading & Vessel */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-brand-400 font-bold block">
                    B/L, Vessel & Port Calls
                  </span>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">B/L Number:</span>
                      <span className="font-mono font-semibold text-white">{ext.blNumber || c.blNumber || '-'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">B/L Date:</span>
                      <span className="text-gray-200">{ext.blDate || '-'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Vessel Name:</span>
                      <span className="text-gray-200">{ext.vesselName || '-'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Shipping Line:</span>
                      <span className="text-gray-200">{ext.shippingLine || '-'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">IGM / Index:</span>
                      <span className="font-mono text-gray-200">
                        {ext.igmNo ? `IGM: ${ext.igmNo}` : ''} {ext.indexNo ? `Idx: ${ext.indexNo}` : ''} {!ext.igmNo && !ext.indexNo && '-'}
                      </span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span className="text-gray-400">Arrival Date:</span>
                      <span className="text-gray-200">{ext.arrivalDate || '-'}</span>
                    </div>
                  </div>
                </div>

                {/* Card B: Port Routing & Status */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold block">
                    Routing & Service Category
                  </span>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Port of Loading (POL):</span>
                      <span className="text-white font-medium text-right truncate max-w-[160px]">{pol}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Port of Delivery (POD):</span>
                      <span className="text-white font-medium text-right truncate max-w-[160px]">{pod}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Category:</span>
                      <span className="text-gray-200">{c.category || 'Bonded Carrier'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Sub-Category:</span>
                      <span className="text-gray-200">{c.subCategory || 'Standard'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 items-center">
                      <span className="text-gray-400">DO Arranged By:</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCase(c);
                          handleOpenStepModal(CaseStatus.SHIPPING_LINE_DO, 0, c);
                        }}
                        className="font-semibold text-amber-300 hover:text-amber-200 underline decoration-dotted flex items-center gap-1 cursor-pointer transition-colors"
                        title="Click to view/update Shipping Line DO step"
                      >
                        <span>{c.serviceArrangements?.shippingLineDO?.arrangedBy === 'DPL' ? `${activeCompany?.shortName || 'Company'} (${activeCompany?.name || 'In-House'})` : 'Client Arranged'}</span>
                        <ExternalLink size={11} className="text-amber-400" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Card C: Cargo & Value */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold block">
                    Cargo Description & Weight
                  </span>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Item Name:</span>
                      <span className="text-white font-medium truncate max-w-[160px]">{ext.itemName || ext.itemType || '-'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Packaging Type:</span>
                      <span className="text-gray-200">{ext.packagingType || '-'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Package Count:</span>
                      <span className="font-mono text-gray-200">{ext.packageCount ? `${ext.packageCount} Units` : '-'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Total Gross Weight:</span>
                      <span className="font-mono font-semibold text-white">{ext.totalWeight ? `${ext.totalWeight.toLocaleString()} Kg` : '-'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-white/5">
                      <span className="text-gray-400">Invoice Value:</span>
                      <span className="font-mono text-emerald-300">{ext.invoiceValue ? `PKR ${ext.invoiceValue.toLocaleString()}` : '-'}</span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span className="text-gray-400">HS Code:</span>
                      <span className="font-mono text-gray-200">{ext.hsCode || '-'}</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* 4. Shipper & Consignee */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-1.5 text-xs">
                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold block">
                  Consignee / Importer
                </span>
                <p className="font-bold text-white text-sm">{ext.consigneeName || clientName}</p>
                <p className="text-gray-400 leading-relaxed">{ext.consigneeAddress || 'Address on file'}</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-1.5 text-xs">
                <span className="text-[10px] font-mono uppercase tracking-wider text-purple-400 font-bold block">
                  Shipper / Supplier
                </span>
                <p className="font-bold text-white text-sm">{ext.shipperName || 'International Supplier'}</p>
                <p className="text-gray-400 leading-relaxed">{ext.shipperAddress || 'Overseas Port / Location'}</p>
              </div>
            </div>

            {/* 5. Containers & Transport Vehicles */}
            {containers.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                  <Truck size={15} className="text-brand-400" />
                  <span>Assigned Containers & Transport Fleet ({containers.length})</span>
                </h4>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-gray-400 font-mono uppercase border-b border-white/10">
                      <tr>
                        <th className="p-3">#</th>
                        <th className="p-3">Container No</th>
                        <th className="p-3">Size / Type</th>
                        <th className="p-3">Seal No</th>
                        <th className="p-3">Vehicle No</th>
                        <th className="p-3">Driver Name & Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 bg-slate-900/50">
                      {containers.map((cn: Container, cIdx: number) => (
                        <tr key={cIdx} className="hover:bg-white/5">
                          <td className="p-3 text-gray-500 font-mono">{cIdx + 1}</td>
                          <td className="p-3 font-mono font-bold text-amber-300">{cn.number || '-'}</td>
                          <td className="p-3 text-gray-300 font-mono">{cn.size || '40ft'}</td>
                          <td className="p-3 font-mono text-cyan-300">{cn.sealNo || '-'}</td>
                          <td className="p-3 font-mono font-semibold text-white">{cn.vehicleNo || '-'}</td>
                          <td className="p-3 text-gray-300">
                            {cn.driverName ? `${cn.driverName} (${cn.driverContact || 'No Phone'})` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 6. Itemized Financial Charges */}
            {charges.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <DollarSign size={15} className="text-emerald-400" />
                    <span>Itemized Charges & Billing</span>
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">
                    Total: PKR {charges.reduce((sum, ch) => sum + (Number(ch.amount) || 0), 0).toLocaleString()}
                  </span>
                </h4>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-gray-400 font-mono uppercase border-b border-white/10">
                      <tr>
                        <th className="p-3">Charge Description</th>
                        <th className="p-3">Category</th>
                        <th className="p-3 text-right">Amount (PKR)</th>
                        <th className="p-3 text-center">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 bg-slate-900/50">
                      {charges.map((ch: CaseCharge, chIdx: number) => (
                        <tr key={chIdx} className="hover:bg-white/5">
                          <td className="p-3 font-medium text-white">{ch.description}</td>
                          <td className="p-3 text-gray-400">{ch.category || 'Port / Logistics'}</td>
                          <td className="p-3 text-right">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              <span className="text-[10px] font-mono text-emerald-500 font-bold">PKR</span>
                              <input
                                type="number"
                                value={ch.amount ?? ''}
                                onChange={(e) => {
                                  const newAmt = Number(e.target.value) || 0;
                                  const currentCharges = c.charges ? [...c.charges] : [];
                                  currentCharges[chIdx] = { ...currentCharges[chIdx], amount: newAmt };
                                  const updatedCase = { ...c, charges: currentCharges };
                                  setCases(prev => prev.map(item => item.id === updatedCase.id ? updatedCase : item));
                                  setReportSelectedCase(updatedCase);
                                  if (selectedCase?.id === updatedCase.id) setSelectedCase(updatedCase);
                                  updateCaseInFirestore(updatedCase).catch(err => console.warn("Update amount err:", err));
                                }}
                                className="w-24 sm:w-28 bg-slate-950/80 border border-emerald-500/40 hover:border-emerald-400 focus:border-emerald-400 rounded-lg px-2 py-1 text-right font-mono font-bold text-emerald-300 text-xs outline-none transition-colors"
                                placeholder="0"
                                title="Editable Amount in PKR"
                              />
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            {ch.receiptUrl ? (
                              <a
                                href={ch.receiptUrl}
                                download={`Receipt_${(ch.description || 'Charge').replace(/\s+/g, '_')}`}
                                className="text-[10px] text-brand-300 hover:text-white underline inline-flex items-center gap-1"
                              >
                                <Download size={10} />
                                <span>Receipt</span>
                              </a>
                            ) : (
                              <span className="text-gray-600">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>

          {/* Modal Footer */}
          <div className="p-4 sm:p-5 border-t border-white/10 bg-slate-950/80 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            <span className="text-xs text-gray-400">
              {activeCompany?.name || 'Company'} Operations Audit &amp; Clearance Record
            </span>
            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => {
                  const target = c;
                  setReportSelectedCase(null);
                  setShowReportModal(false);
                  setSelectedCase(target);
                  setView('details');
                }}
                className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-brand-600/30 cursor-pointer"
              >
                <ExternalLink size={14} />
                <span>Open in Full Case Editor</span>
              </button>
              <button
                type="button"
                onClick={() => setReportSelectedCase(null)}
                className="bg-slate-800 hover:bg-slate-700 text-gray-200 px-4 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>

        </div>
      </div>
    );
  };

  const renderReportModal = () => {
    const reportData = getFilteredReportData();

    return (
      <div className="fixed inset-0 bg-slate-950 z-50 flex flex-col animate-in fade-in slide-in-from-bottom-4 print-sheet" data-printable-modal="true">
        {/* Top Bar - Hidden during Print */}
        <div className="bg-slate-900 border-b border-white/10 p-4 flex flex-col md:flex-row justify-between items-center gap-4 shadow-lg z-20 no-print shrink-0">
           <div className="flex items-center gap-4 w-full md:w-auto">
              <button onClick={() => setShowReportModal(false)} className="text-gray-400 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
                 <ArrowLeft size={24} />
              </button>
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><ListFilter size={24} className="text-brand-400"/> Full Case Report</h2>
           </div>

           {/* Global Search Bar */}
           <div className="w-full md:w-96 relative">
              <Search className="absolute left-3 top-2.5 text-brand-400" size={20} />
              <input 
                type="text" 
                placeholder="Search anything (Client, BL, item, etc)..." 
                className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 outline-none text-white focus:border-brand-500 transition-colors shadow-inner text-sm"
                value={reportSearchTerm}
                onChange={(e) => setReportSearchTerm(e.target.value)}
                autoFocus
              />
           </div>
           
           <div className="flex items-center gap-3">
              <div className="text-sm text-gray-400 font-mono hidden md:block">
                 {reportData.length} Records Found
              </div>
              <button
                onClick={() => {
                  const headers = ['#', 'Case No', 'Date', 'Client', 'Category', 'Status', 'Port of Loading', 'Port of Delivery'];
                  const rows = reportData.map((c, i) => [
                    i + 1,
                    c.caseNo,
                    c.createdAt ? c.createdAt.split('T')[0] : (c.registrationDate || ''),
                    c.clientName || c.client || '',
                    c.category,
                    c.status,
                    c.pol || c.extractedData?.pol || '',
                    c.pod || c.extractedData?.pod || '',
                  ]);
                  const filename = `Case_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
                  exportTableToExcel(filename, 'Case Report', headers, rows, [8, 22, 16, 28, 22, 18, 20, 20]);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                title="Download Case Report as Excel (.xlsx) spreadsheet"
              >
                <Download size={15} />
                <span>Download Report (Excel .xlsx)</span>
              </button>
           </div>
        </div>

        {/* Official Legal Document Header for Print (Unified across all 4 companies) */}
        <div className="hidden print:block">
          <LegalDocumentHeader 
            title="COMPREHENSIVE CASE AUDIT & LOGISTICS REPORT"
            subRef={`Total Records: ${reportData.length} ${reportSearchTerm ? `• Filter: "${reportSearchTerm}"` : ''}`}
            subject="OFFICIAL LOGISTICS DOSSIER AUDIT & CASE MASTER RECORD"
          />
        </div>

        {/* Report Table Viewport with Reduced Side Margins & Natural Up/Down Scroll */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950 p-4 sm:p-6 lg:p-8">
           <div className="max-w-[1360px] mx-auto w-full space-y-3">
             
             {/* Sub-header instruction */}
             <div className="flex items-center justify-between text-xs text-gray-400 px-1 no-print">
               <span className="flex items-center gap-1.5 text-brand-300">
                 <Sparkles size={14} className="text-amber-400" />
                 Click on any row to view complete case particulars and download all paperwork
               </span>
               <span className="font-mono text-gray-400">{reportData.length} cases</span>
             </div>

             <div className="border border-white/10 rounded-2xl overflow-hidden shadow-2xl bg-slate-900/60 print:border-none">
               <div className="w-full">
                 <table className="w-full text-left text-sm text-gray-200 print:text-black">
                    <thead className="bg-slate-900 text-xs uppercase font-bold text-gray-400 sticky top-0 z-10 shadow-md print:bg-gray-100 print:text-black">
                      <tr>
                        <th className="p-3.5 border-b border-white/10 bg-slate-900 w-12 text-center print:bg-transparent print:border-gray-300">#</th>
                        {REPORT_COLUMNS.map((col) => (
                          <th key={col.key} className="p-3.5 border-b border-white/10 bg-slate-900 group relative print:bg-transparent print:border-gray-300 text-xs tracking-wider">
                             <div className="flex items-center justify-between gap-1.5">
                                <span>{col.label}</span>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === col.key ? null : col.key); }}
                                  className={`p-1 rounded hover:bg-white/10 transition-colors no-print ${reportFilters[col.key] ? 'text-brand-400' : 'text-gray-600 group-hover:text-gray-400'}`}
                                  title={`Filter by ${col.label}`}
                                >
                                   <Filter size={13} fill={reportFilters[col.key] ? 'currentColor' : 'none'} />
                                </button>
                             </div>

                             {/* Column Filter Popup */}
                             {activeFilterColumn === col.key && (
                                <div className="absolute top-full left-0 mt-2 w-52 bg-slate-800 border border-white/20 rounded-xl shadow-2xl p-2.5 z-30 animate-in fade-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
                                   <input 
                                     type="text" 
                                     placeholder={`Filter ${col.label}...`}
                                     className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs text-white outline-none focus:border-brand-500"
                                     value={reportFilters[col.key] || ''}
                                     onChange={(e) => handleColumnFilterChange(col.key, e.target.value)}
                                     autoFocus
                                   />
                                   <div className="flex justify-between items-center mt-2 pt-1 border-t border-white/10">
                                      {reportFilters[col.key] ? (
                                        <button
                                          onClick={() => handleColumnFilterChange(col.key, '')}
                                          className="text-[10px] text-red-400 hover:text-red-300"
                                        >
                                          Clear
                                        </button>
                                      ) : <span />}
                                      <button 
                                        onClick={() => setActiveFilterColumn(null)}
                                        className="text-[10px] text-brand-400 hover:text-white uppercase font-bold"
                                      >
                                        Close
                                      </button>
                                   </div>
                                </div>
                             )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                       {reportData.map((row, idx) => (
                          <tr 
                            key={`rep_row_${row.id || idx}_${idx}`} 
                            onClick={() => setReportSelectedCase(row)}
                            className="hover:bg-brand-500/10 transition-colors cursor-pointer group"
                            title="Click row to open case details & download documents"
                          >
                             <td className="p-3.5 border-r border-white/5 bg-slate-900/30 text-center text-gray-500 font-mono text-xs w-12">
                                {idx + 1}
                             </td>
                             {REPORT_COLUMNS.map((col) => {
                                let val = getNestedValue(row, col.key);
                                if (col.key === 'createdAt' && val) {
                                  val = String(val).split('T')[0];
                                } else if (col.key === 'pol' && !val) {
                                  val = row.extractedData?.pol || '-';
                                } else if (col.key === 'pod' && !val) {
                                  val = row.extractedData?.pod || row.extractedData?.placeOfDelivery || '-';
                                } else if (col.key === 'clientName' && !val) {
                                  val = row.client || '-';
                                }

                                if (col.key === 'caseNo') {
                                  return (
                                    <td key={col.key} className="p-3.5 font-mono font-bold text-amber-300 border-r border-white/5 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5">
                                        <span>{val || '-'}</span>
                                        <ExternalLink size={12} className="opacity-0 group-hover:opacity-80 transition-opacity text-brand-400 shrink-0" />
                                      </div>
                                    </td>
                                  );
                                }

                                if (col.key === 'createdAt') {
                                  return (
                                    <td key={col.key} className="p-3.5 font-mono text-gray-300 border-r border-white/5 whitespace-nowrap text-xs">
                                      {val || '-'}
                                    </td>
                                  );
                                }

                                if (col.key === 'clientName') {
                                  return (
                                    <td key={col.key} className="p-3.5 font-semibold text-white border-r border-white/5 truncate max-w-[200px]" title={String(val || '')}>
                                      {val || '-'}
                                    </td>
                                  );
                                }

                                if (col.key === 'category') {
                                  return (
                                    <td key={col.key} className="p-3.5 text-gray-300 border-r border-white/5 whitespace-nowrap text-xs">
                                      {val || '-'}
                                    </td>
                                  );
                                }

                                if (col.key === 'status') {
                                  return (
                                    <td key={col.key} className="p-3.5 border-r border-white/5 whitespace-nowrap">
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-300 border border-brand-500/30">
                                        {val || 'Active'}
                                      </span>
                                    </td>
                                  );
                                }

                                return (
                                  <td key={col.key} className="p-3.5 text-gray-300 border-r border-white/5 last:border-0 truncate max-w-[180px] text-xs" title={String(val || '')}>
                                     {val || '-'}
                                  </td>
                                );
                             })}
                          </tr>
                       ))}
                       {reportData.length === 0 && (
                          <tr>
                             <td colSpan={REPORT_COLUMNS.length + 1} className="p-12 text-center text-gray-500">
                                No records found matching your search.
                             </td>
                          </tr>
                       )}
                    </tbody>
                 </table>
               </div>
             </div>
           </div>
        </div>

        {/* Case Detail & Document Download Popup Modal */}
        {reportSelectedCase && renderReportCaseDetailModal()}
      </div>
    );
  };

  // --- Views ---

  const renderCaseList = () => (
    <div className={`space-y-6 animate-fade-in ${showReportModal ? 'print:hidden' : ''} w-full max-w-full min-w-0 overflow-x-hidden`}>
       {/* Incomplete Case Draft Alert Banner */}
       {hasDraft && draftInfo && (
         <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-950/50 via-slate-900/95 to-amber-950/50 border border-amber-500/40 shadow-xl shadow-amber-950/20 space-y-3 animate-in fade-in slide-in-from-top-2">
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
             <div className="flex items-start sm:items-center gap-3.5">
               <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 text-amber-400 shadow-inner">
                 <AlertTriangle size={22} className="animate-pulse" />
               </div>
               <div>
                 <div className="flex flex-wrap items-center gap-2">
                   <h3 className="text-base font-bold text-white flex items-center gap-2">
                     Incomplete Case Registration
                   </h3>
                   <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                     Step {draftInfo.step} of 4: {draftInfo.stepName}
                   </span>
                   {draftInfo.caseNo ? (
                     <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                       {draftInfo.caseNo}
                     </span>
                   ) : (
                     <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-white/10 text-gray-300 border border-white/10">
                       Serial: Assigned on Progression
                     </span>
                   )}
                 </div>
                 <p className="text-xs text-amber-200/90 mt-1">
                   <span className="font-semibold text-white">{draftInfo.client || 'Draft Client'}</span> &bull; {draftInfo.category} &bull; {draftInfo.docsCount} document(s) attached {draftInfo.updatedAt ? `&bull; Auto-saved at ${draftInfo.updatedAt}` : ''}
                 </p>
               </div>
             </div>

             {/* Action Buttons */}
             <div className="flex items-center gap-2.5 shrink-0 self-end md:self-auto">
               <button
                 onClick={handleResumeDraft}
                 className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 shadow-lg shadow-brand-600/30 transition-all hover:scale-105 active:scale-95"
                 title="Resume case registration from where you left off"
               >
                 <Play size={14} className="fill-current" />
                 <span>Continue Registration</span>
               </button>
               <button
                 onClick={() => setShowDiscardModal(true)}
                 className="bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-all hover:text-white"
                 title="Discard this incomplete draft"
               >
                 <Trash2 size={14} />
                 <span>Discard Draft</span>
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Toolbar */}
       <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
         <div className="flex flex-wrap gap-2 items-center">
           <button onClick={handleStartRegistration} className="bg-brand-600 hover:bg-brand-500 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 font-medium shadow-lg shadow-brand-600/30 transition-all hover:scale-105">
             <Upload size={18} /> New Case Registration
           </button>
           <button onClick={() => setShowPortModal(true)} className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-4 py-2.5 rounded-lg flex items-center gap-2 font-medium transition-colors">
             <Anchor size={18} className="text-brand-400" /> Add Port
           </button>
           <button onClick={() => handleOpenEditPort()} className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-4 py-2.5 rounded-lg flex items-center gap-2 font-medium transition-colors" title="Edit Port & Container Inquiry Link">
             <Edit size={18} className="text-amber-400" /> Edit Port
           </button>
           <button onClick={() => setShowFilterModal(true)} className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-4 py-2.5 rounded-lg flex items-center gap-2 font-medium transition-colors">
             <ListFilter size={18} className="text-brand-400" /> View List / Reports
           </button>
         </div>
         <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <button
              type="button"
              onClick={() => setShowSmartSearchModal(true)}
              className="bg-brand-600 hover:bg-brand-500 text-white px-3.5 py-2.5 rounded-lg flex items-center gap-2 font-medium text-xs sm:text-sm shadow-md shadow-brand-600/20 transition-all active:scale-95 shrink-0"
              title="Smart Case Search & Advanced Query"
            >
              <Search size={16} />
              <span>Smart Search</span>
            </button>
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-2.5 text-gray-500" size={18} />
              <input 
                type="text" 
                onClick={() => setShowSmartSearchModal(true)}
                placeholder="Search Importer, BL, Item, Client..." 
                className="w-full glass-input rounded-lg pl-10 pr-4 py-2.5 outline-none text-sm text-white cursor-pointer placeholder-gray-400" 
                readOnly
              />
            </div>
         </div>
       </div>

        {/* Active Filter Indicators */}
        <div className="flex flex-wrap gap-2">
            {activeDateFilter && (
                <div className="flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 px-3 py-1.5 rounded-lg w-fit">
                    <span className="text-xs text-brand-300">Date Filter: {activeDateFilter.start} to {activeDateFilter.end}</span>
                    <button onClick={() => setActiveDateFilter(null)} className="text-gray-400 hover:text-white"><X size={14} /></button>
                </div>
            )}
            {statusFilter && (
                <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 px-3 py-1.5 rounded-lg w-fit animate-in fade-in">
                    <span className="text-xs text-yellow-300">Status: {statusFilter}</span>
                    <button onClick={clearStatusFilter} className="text-gray-400 hover:text-white"><X size={14} /></button>
                </div>
            )}
        </div>

        {/* Workflow & Incident Vault Filtering Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
          <button
            type="button"
            onClick={() => setActiveWorkflowTab('all')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
              activeWorkflowTab === 'all'
                ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5'
            }`}
          >
            <span>All Active Cases</span>
            <span className="px-1.5 py-0.5 rounded-md bg-black/30 text-[10px] font-mono">
              {cases.length - incidentCasesCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveWorkflowTab('in_progress')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
              activeWorkflowTab === 'in_progress'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20'
                : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5'
            }`}
          >
            <span>In Progress (8 Steps)</span>
            <span className="px-1.5 py-0.5 rounded-md bg-black/30 text-[10px] font-mono">
              {inProgressCasesCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveWorkflowTab('completed')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
              activeWorkflowTab === 'completed'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5'
            }`}
          >
            <span>Completed Dossiers</span>
            <span className="px-1.5 py-0.5 rounded-md bg-black/30 text-[10px] font-mono">
              {completedCasesCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveWorkflowTab('incident_vault')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeWorkflowTab === 'incident_vault'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                : incidentCasesCount > 0
                ? 'bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 animate-pulse'
                : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5'
            }`}
          >
            <AlertTriangle size={14} className={incidentCasesCount > 0 ? 'text-rose-400' : 'text-gray-400'} />
            <span>Incident / Disputed Vault</span>
            <span className="px-1.5 py-0.5 rounded-md bg-black/30 text-[10px] font-mono">
              {incidentCasesCount}
            </span>
          </button>
        </div>

        {/* If in Incident Vault, show emergency banner */}
        {activeWorkflowTab === 'incident_vault' && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-start gap-3">
              <AlertCircle size={22} className="text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-white text-sm">Incident & Disputed Exception Vault</h4>
                <p className="text-gray-300 text-xs mt-0.5">
                  These cases experienced en-route stoppages, breakdowns, customs holds, or accidents. Normal workflow execution is halted until resolved.
                </p>
              </div>
            </div>
          </div>
        )}

       {/* Case List - Full-Height Open Layout for Mobile & Desktop */}
       <div className="glass-card rounded-2xl overflow-hidden min-h-[calc(100dvh-220px)] flex flex-col">
         {/* Mobile View: Full-Screen Open List, Clean Date & Full Case No Visibility */}
         <div className="block sm:hidden flex-1">
           <VirtualizedList
             items={filteredCases}
             itemHeight={106}
             minHeight={420}
             getItemKey={(c, idx) => `case_mob_${c.id || idx}_${idx}`}
             emptyPlaceholder={
               <div className="p-10 text-center text-gray-400 text-xs">
                 No cases found matching the criteria.
               </div>
             }
             renderItem={(c) => {
               const formattedDate = c.createdAt
                 ? (() => {
                     const d = new Date(c.createdAt);
                     return !isNaN(d.getTime())
                       ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                       : String(c.createdAt).split('T')[0];
                   })()
                 : '';
               return (
                 <div 
                   className="p-3.5 hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer space-y-2 border-b border-white/5"
                   onClick={() => { setSelectedCase(c); setView('details'); }}
                 >
                   {/* Top Row: Case No, Clean Date & Status */}
                   <div className="flex items-center justify-between gap-2">
                     <div className="flex items-center gap-2 min-w-0 flex-1">
                       <span className="font-mono font-bold text-xs text-brand-400 truncate">{c.caseNo}</span>
                       {formattedDate && (
                         <span className="text-[10px] text-gray-400 shrink-0">{formattedDate}</span>
                       )}
                     </div>
                     <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border border-white/10 shrink-0 ${
                       c.status === CaseStatus.COMPLETED ? 'bg-green-500/20 text-green-400' : 
                       c.status === CaseStatus.IN_TRANSIT ? 'bg-blue-500/20 text-blue-400' : 'bg-yellow-500/20 text-yellow-400'
                     }`}>
                       {c.status}
                     </span>
                   </div>

                   {/* Middle Row: Client & Category */}
                   <div className="flex items-center justify-between gap-2">
                     <p className="font-semibold text-white text-xs truncate">{c.clientName}</p>
                     <span className="text-[10px] text-brand-300 bg-brand-500/10 px-1.5 py-0.5 rounded border border-brand-500/20 shrink-0">
                       {c.category}
                     </span>
                   </div>

                   {/* Bottom Row: Route (POL -> POD) & View Button */}
                   <div className="flex items-center justify-between pt-1.5 border-t border-white/5 text-[11px] gap-2">
                     <span className="font-mono text-gray-300 truncate">
                       {c.pol && c.pod ? `${c.pol} → ${c.pod}` : 'Customs Clearance'}
                     </span>
                     <span className="text-brand-400 flex items-center gap-1 font-medium text-[11px] shrink-0">
                       <Eye size={12} />
                       <span>Details</span>
                     </span>
                   </div>
                 </div>
               );
             }}
           />
         </div>

         {/* Desktop View: Open Full-Height Table */}
         <div className="hidden sm:block flex-1">
           <VirtualizedTable<Case>
             items={filteredCases}
             rowHeight={64}
             minHeight={520}
             minTableWidth={1000}
             getItemKey={(c, idx) => `case_row_${c.id || idx}_${idx}`}
             onRowClick={(c) => { setSelectedCase(c); setView('details'); }}
             columns={[
               { header: 'Case No', width: '18%' },
               { header: 'Client', width: '22%' },
               { header: 'Category', width: '16%' },
               { header: 'Route', width: '18%' },
               { header: 'Date', width: '10%' },
               { header: 'Status', width: '10%' },
               { header: 'Action', width: '6%', className: 'text-center' }
             ]}
             renderRow={(c) => {
               const formattedDate = c.createdAt
                 ? (() => {
                     const d = new Date(c.createdAt);
                     return !isNaN(d.getTime())
                       ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                       : String(c.createdAt).split('T')[0];
                   })()
                 : '-';
               return (
                 <>
                   <div className="p-4 font-mono font-bold text-white group-hover:text-brand-400 transition-colors truncate" style={{ width: '18%', flexShrink: 0 }}>
                     {c.caseNo}
                   </div>
                   <div className="p-4 font-medium text-white truncate" style={{ width: '22%', flexShrink: 0 }}>
                     {c.clientName}
                   </div>
                   <div className="p-4 text-gray-200 truncate" style={{ width: '16%', flexShrink: 0 }}>
                     {c.category}
                   </div>
                   <div className="p-4 text-xs font-mono text-gray-300 truncate" style={{ width: '18%', flexShrink: 0 }}>
                     {c.pol && c.pod ? `${c.pol} → ${c.pod}` : '-'}
                   </div>
                   <div className="p-4 text-gray-300 text-xs truncate" style={{ width: '10%', flexShrink: 0 }}>
                     {formattedDate}
                   </div>
                   <div className="p-4" style={{ width: '10%', flexShrink: 0 }}>
                     <div className="flex flex-col gap-1 items-start">
                       <span className={`px-2 py-0.5 rounded text-xs font-medium border border-white/10 ${
                         c.status === CaseStatus.COMPLETED ? 'bg-green-500/20 text-green-400' : 
                         c.status === CaseStatus.IN_TRANSIT ? 'bg-blue-500/20 text-blue-400' : 'bg-yellow-500/20 text-yellow-400'
                       }`}>
                         {c.status}
                       </span>
                       {c.approvalStatus === 'PENDING' && (
                         <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/25 text-amber-300 border border-amber-500/40 animate-pulse">
                           Pending Approval
                         </span>
                       )}
                     </div>
                   </div>
                   <div className="p-4 text-center" style={{ width: '6%', flexShrink: 0 }}>
                     <button className="p-2 hover:bg-white/10 rounded-full text-brand-400 transition-colors">
                       <Eye size={18} />
                     </button>
                   </div>
                 </>
               );
             }}
             emptyPlaceholder={
               <div className="p-12 text-center text-gray-400 text-sm">
                 No cases found matching the criteria.
               </div>
             }
           />
         </div>
       </div>

       {/* View List / Filter Modal */}
       {showFilterModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center pt-8 sm:pt-14 p-4 overflow-y-auto animate-in fade-in duration-200">
            <div className="glass-card p-6 rounded-2xl w-full max-w-sm border border-white/10">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2"><ListFilter size={20} className="text-brand-400"/> Filter Case List</h3>
                    <button onClick={() => setShowFilterModal(false)} className="text-gray-400 hover:text-white"><X size={20}/></button>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Start Date</label>
                        <input 
                            type="date" 
                            value={filterDates.start}
                            onChange={(e) => setFilterDates({...filterDates, start: e.target.value})}
                            className="w-full glass-input rounded-lg p-3 outline-none text-white"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">End Date</label>
                        <input 
                            type="date" 
                            value={filterDates.end}
                            onChange={(e) => setFilterDates({...filterDates, end: e.target.value})}
                            className="w-full glass-input rounded-lg p-3 outline-none text-white"
                        />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <button 
                            onClick={handleSearchRecords}
                            className="w-full bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg font-medium border border-white/10 flex items-center justify-center gap-1 text-xs"
                        >
                            <Search size={14} /> Search Records
                        </button>
                        <button 
                            onClick={handleOpenReport}
                            className="w-full bg-brand-600 hover:bg-brand-500 text-white py-2 rounded-lg font-medium shadow-lg shadow-brand-600/20 flex items-center justify-center gap-1 text-xs"
                        >
                            <Eye size={14} /> View Full List
                        </button>
                    </div>
                </div>
            </div>
        </div>
       )}

       {/* Full Screen Report Modal */}
       {showReportModal && renderReportModal()}

       {/* Confirm Discard Incomplete Draft Modal */}
       {showDiscardModal && (
         <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center pt-8 sm:pt-14 p-4 overflow-y-auto animate-in fade-in duration-200">
           <div className="glass-card p-6 rounded-2xl w-full max-w-md border border-red-500/30 shadow-2xl space-y-4">
             <div className="flex items-center gap-3 text-red-400">
               <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0">
                 <Trash2 size={20} />
               </div>
               <div>
                 <h3 className="text-lg font-bold text-white">Discard Incomplete Case?</h3>
                 <p className="text-xs text-gray-400">This action will permanently delete the draft</p>
               </div>
             </div>

             <p className="text-sm text-gray-300 leading-relaxed">
               Are you sure you want to discard this incomplete case draft? All uploaded documents and entered details will be cleared permanently.
             </p>

             {draftInfo && (
               <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 text-xs space-y-1.5 text-gray-300">
                 <div className="flex justify-between">
                   <span className="text-gray-400">Client:</span>
                   <span className="font-semibold text-white">{draftInfo.client || 'None'}</span>
                 </div>
                 <div className="flex justify-between">
                   <span className="text-gray-400">Category:</span>
                   <span className="text-white">{draftInfo.category}</span>
                 </div>
                 <div className="flex justify-between">
                   <span className="text-gray-400">Progress:</span>
                   <span className="text-amber-300 font-medium">Step {draftInfo.step} of 4 ({draftInfo.stepName})</span>
                 </div>
                 {draftInfo.caseNo && (
                   <div className="flex justify-between">
                     <span className="text-gray-400">Reserved Serial:</span>
                     <span className="text-cyan-300 font-mono">{draftInfo.caseNo}</span>
                   </div>
                 )}
               </div>
             )}

             <div className="grid grid-cols-2 gap-3 pt-2">
               <button
                 type="button"
                 onClick={() => setShowDiscardModal(false)}
                 className="bg-white/10 hover:bg-white/15 text-white py-2.5 rounded-xl font-medium text-sm transition-colors"
               >
                 Cancel
               </button>
               <button
                 type="button"
                 onClick={handleDiscardDraft}
                 className="bg-red-600 hover:bg-red-500 text-white py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-red-600/30"
               >
                 Yes, Discard Draft
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Existing Incomplete Draft Prompt (When clicking New Registration) */}
       {showStartNewDraftPrompt && (
         <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center pt-8 sm:pt-14 p-4 overflow-y-auto animate-in fade-in duration-200">
           <div className="glass-card p-6 rounded-2xl w-full max-w-md border border-amber-500/30 shadow-2xl space-y-4">
             <div className="flex items-center gap-3 text-amber-400">
               <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                 <AlertCircle size={20} />
               </div>
               <div>
                 <h3 className="text-lg font-bold text-white">Incomplete Draft Found</h3>
                 <p className="text-xs text-gray-400">You already have a case registration in progress</p>
               </div>
             </div>

             <p className="text-sm text-gray-300 leading-relaxed">
               An incomplete registration draft {draftInfo?.client ? `for "${draftInfo.client}"` : ''} is currently paused at Step {draftInfo?.step || 1}. Would you like to resume this draft or discard it and start fresh?
             </p>

             <div className="flex flex-col gap-2.5 pt-2">
               <button
                 type="button"
                 onClick={() => {
                   setShowStartNewDraftPrompt(false);
                   handleResumeDraft();
                 }}
                 className="w-full bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-brand-600/30 transition-all"
               >
                 <Play size={15} className="fill-current" />
                 <span>Resume Incomplete Draft</span>
               </button>
               <button
                 type="button"
                 onClick={() => {
                   setShowStartNewDraftPrompt(false);
                   startFreshRegistration();
                 }}
                 className="w-full bg-white/10 hover:bg-white/15 text-gray-300 hover:text-white py-2.5 rounded-xl font-medium text-sm transition-colors"
               >
                 Discard & Start Fresh Case
               </button>
               <button
                 type="button"
                 onClick={() => setShowStartNewDraftPrompt(false)}
                 className="w-full py-2 text-xs text-gray-400 hover:text-white transition-colors"
               >
                 Cancel
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Draft notification toast */}
       {draftToast && (
         <div className="fixed bottom-6 right-6 z-50 bg-slate-900/95 border border-white/20 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4">
           <span className="text-sm font-medium">{draftToast}</span>
         </div>
       )}

    </div>
  );

  const renderCaseDetails = () => {
    // Helper to render input or text based on edit mode
    const Field = ({ label, value, onChange }: { label: string, value: any, onChange?: (val: string) => void }) => {
       if (isEditingCase && onChange) {
          return (
             <div className="mb-3">
                <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1 block">{label}</label>
                <input 
                   type="text" 
                   value={value || ''} 
                   onChange={(e) => onChange(e.target.value)} 
                   className="w-full border-b border-brand-500 bg-brand-500/10 text-white px-1 py-0.5 focus:outline-none text-sm font-medium"
                />
             </div>
          );
       }
       return (
         <div className="mb-3">
             <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-0.5">{label}</p>
             <p className="text-sm font-medium text-white border-b border-transparent">{value || '-'}</p>
         </div>
       );
    };

    const targetCase = isEditingCase ? editedCase : selectedCase;

    if (!targetCase) {
      return (
        <div className="glass-card rounded-2xl p-8 text-center border border-white/10 space-y-4 max-w-lg mx-auto my-12 animate-fade-in">
          <div className="w-14 h-14 bg-brand-500/10 border border-brand-500/20 text-brand-400 rounded-2xl flex items-center justify-center mx-auto">
            <Loader2 className="animate-spin" size={28} />
          </div>
          <h3 className="text-lg font-bold text-white">Restoring Case Details</h3>
          <p className="text-xs text-gray-300">Synchronizing your case documents and shipment files...</p>
          <div className="pt-2">
            <button 
              type="button"
              onClick={() => {
                safeAppStorage.removeItem('dpl_selected_case');
                safeAppStorage.removeItem('dpl_selected_case_id');
                setView('list');
              }}
              className="text-xs bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-xl transition-colors font-medium shadow-md shadow-brand-600/30"
            >
              Return to Cases List
            </button>
          </div>
        </div>
      );
    }

    // Helper to get image source from File or MockDocument
    const getDocSource = (doc: any) => {
      if (!doc) return '';
      if (doc.url) {
        return doc.url;
      }
      try {
        if (doc instanceof File || doc instanceof Blob || doc instanceof MediaSource) {
          return URL.createObjectURL(doc);
        }
      } catch (err) {
        console.error("Failed to create object URL for doc", doc, err);
      }
      return '';
    };

    return (
      <div className="space-y-6 animate-fade-in printable-content">
         <div className="flex flex-wrap justify-between items-center gap-3 mb-4 no-print">
            <button onClick={() => setView('list')} className="text-gray-300 hover:text-white flex items-center gap-2 font-medium text-xs sm:text-sm">
                <ArrowLeft size={16} /> Back to List
            </button>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {isEditingCase ? (
                   <>
                      <button onClick={handleEditCaseToggle} className="text-gray-300 hover:text-white px-3 py-1.5 text-xs sm:text-sm">Cancel</button>
                      <button onClick={handleSaveEditedCase} className="bg-green-600 hover:bg-green-500 text-white px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 text-xs sm:text-sm shadow-lg font-medium">
                         <Save size={15} /> Save Changes
                      </button>
                   </>
                ) : (
                   <>
                      {/* Print Delivery Order (DO) button for Destination Staff, Case Manager, and Admin */}
                      {(effectiveRole === UserRole.UNLOADING_PORT_STAFF || effectiveRole === UserRole.DESTINATION_PORT_STAFF || effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.OPERATIONS_MANAGER) && isDestinationUnloadedAndGateOut(targetCase) && (
                        <button 
                          onClick={() => handleDownloadDeliveryOrder(targetCase)} 
                          className="bg-amber-600 hover:bg-amber-500 active:scale-95 text-white px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 text-xs sm:text-sm shadow-lg shadow-amber-600/20 transition-all font-medium"
                          title="Print Customs / Terminal Delivery Order (DO) Document"
                        >
                          <FileText size={15} />
                          <span>Print DO (Delivery Order)</span>
                        </button>
                      )}

                      {(targetCase?.approvalStatus === 'PENDING' || (targetCase?.status as any) === 'Pending Approval') && isOfficeStaffRole(effectiveRole) && (
                          <button onClick={handleApproveCase} className="bg-green-600 hover:bg-green-500 text-white px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 text-xs sm:text-sm shadow-lg shadow-green-600/20 animate-pulse font-medium">
                              <CheckCircle size={15} /> Approve & Process (Client Case)
                          </button>
                      )}
                      
                      {(hasOpsRole || hasAdminRole) && (
                        <>
                          {targetCase?.pendingApproval ? (
                            <div className="bg-amber-500/20 border border-amber-500/40 text-amber-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold">
                              <Clock size={14} className="animate-spin text-amber-400" />
                              <span>Pending Admin Approval ({targetCase.pendingApproval.action})</span>
                            </div>
                          ) : (
                            <>
                              <button 
                                onClick={() => handleInitiateFinishedCaseAction('EDIT')} 
                                className="bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 border border-brand-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs sm:text-sm font-medium"
                              >
                                <Edit size={15} /> Edit Case
                              </button>
                              <button 
                                onClick={() => handleInitiateFinishedCaseAction('CANCEL')} 
                                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs sm:text-sm font-medium"
                              >
                                <XCircle size={15} /> Cancel
                              </button>
                              <button 
                                onClick={() => handleInitiateFinishedCaseAction('DELETE')} 
                                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs sm:text-sm font-medium"
                              >
                                <Trash2 size={15} /> Delete
                              </button>
                            </>
                          )}
                        </>
                      )}
                      <button 
                        onClick={() => setShowDownloadDocsModal(true)} 
                        className="bg-brand-600 hover:bg-brand-500 active:scale-95 text-white px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 text-xs sm:text-sm shadow-lg shadow-brand-600/20 transition-all font-medium"
                        title="Download Documents (Case Details, Invoice, Attachments, All)"
                      >
                        <Download size={15} />
                        <span>Download Documents</span>
                      </button>
                   </>
                )}
            </div>
         </div>

         {/* Pending Approval Banner on Detail View */}
         {targetCase?.pendingApproval && (
           <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start sm:items-center justify-between gap-3 text-amber-200 text-xs sm:text-sm shadow-xl">
             <div className="flex items-center gap-2.5">
               <AlertTriangle size={18} className="text-amber-400 shrink-0" />
               <div>
                 <span className="font-bold text-amber-300">Approval Pending from Super Admin: </span>
                 <span>
                   A request to <strong>{targetCase.pendingApproval.action}</strong> this completed case was submitted by <strong>{targetCase.pendingApproval.requestedBy}</strong>. Reason: &quot;{targetCase.pendingApproval.reason}&quot;.
                 </span>
               </div>
             </div>
             <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
               Awaiting Admin
             </span>
           </div>
         )}

         {/* Mobile-Friendly PDF Download Alert / Notification Banner */}
         {(isDownloadingPdf || pdfDownloadSuccess || pdfDownloadError) && (
           <div className="mb-4 print:hidden animate-fade-in">
             {isDownloadingPdf && (
               <div className="p-3.5 bg-brand-500/15 border border-brand-500/40 rounded-xl flex items-center gap-3 text-brand-300 text-xs sm:text-sm shadow-lg">
                 <Loader2 size={18} className="animate-spin text-brand-400 shrink-0" />
                 <span>Generating & downloading PDF...</span>
               </div>
             )}
             {pdfDownloadSuccess && (
               <div className="p-4 bg-emerald-950/80 border border-emerald-500/40 rounded-xl space-y-2 shadow-2xl backdrop-blur-md">
                 <div className="flex flex-wrap items-center justify-between gap-2">
                   <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                     <CheckCircle2 size={18} className="shrink-0" />
                     <span>PDF Ready: {pdfDownloadSuccess}</span>
                   </div>
                   <button
                     type="button"
                     onClick={() => setPdfDownloadSuccess(null)}
                     className="text-xs text-gray-400 hover:text-white px-2 py-1"
                   >
                     ✕ Close
                   </button>
                 </div>
                 <p className="text-xs text-gray-300">
                   If the file did not download automatically, click the button below:
                 </p>
                 <div className="flex flex-wrap items-center gap-3 pt-1">
                   {directDownloadUrl && (
                     <>
                       <a
                         href={directDownloadUrl}
                         download={directDownloadFilename}
                         className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow active:scale-95 transition-all"
                       >
                         <Download size={14} /> Download File
                       </a>
                       <button
                         type="button"
                         onClick={() => setIsPdfViewerOpen(true)}
                         className="bg-white/10 hover:bg-white/20 text-white font-medium text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 border border-white/20 active:scale-95 transition-all"
                       >
                         <Eye size={14} /> View PDF
                       </button>
                       {typeof navigator !== 'undefined' && 'share' in navigator && (
                         <button
                           type="button"
                           onClick={() => sharePdfFile(directDownloadUrl, directDownloadFilename, targetCase?.caseNo)}
                           className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow active:scale-95 transition-all"
                         >
                           <Share2 size={14} /> Save to Mobile
                         </button>
                       )}
                     </>
                   )}
                 </div>
               </div>
             )}
             {pdfDownloadError && (
               <div className="p-3.5 bg-red-500/20 border border-red-500/40 rounded-xl flex items-center justify-between gap-2 text-red-300 text-xs sm:text-sm">
                 <div className="flex items-center gap-2">
                   <AlertCircle size={18} className="text-red-400 shrink-0" />
                   <span>{pdfDownloadError}</span>
                 </div>
                 <button
                   type="button"
                   onClick={() => setPdfDownloadError(null)}
                   className="text-xs text-gray-400 hover:text-white px-2 py-1"
                 >
                   ✕
                 </button>
               </div>
             )}
           </div>
         )}
  
          {/* Client Case Approval Banner */}
          {targetCase?.approvalStatus === 'PENDING' && (
            <div className="mb-4 p-4 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-200 shadow-lg no-print">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    Client Case Registration: Approval Pending
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/30 text-amber-300 text-[10px] uppercase font-bold">
                      Awaiting Admin / Case Manager
                    </span>
                  </h4>
                  <p className="text-xs text-amber-300/90 mt-0.5">
                    This case was registered via Client Portal by <strong>{targetCase.clientName}</strong> and requires authorization.
                  </p>
                </div>
              </div>
              {(effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.OPERATIONS_MANAGER) && (
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={handleApproveCase}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-emerald-600/30 transition-all active:scale-95"
                  >
                    <CheckCircle size={15} />
                    <span>Approve Case</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRejectCase}
                    className="bg-red-600/80 hover:bg-red-600 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 border border-red-500/30 transition-all active:scale-95"
                  >
                    <X size={15} />
                    <span>Reject</span>
                  </button>
                </div>
              )}
            </div>
          )}

         <div id="printable-area" className="glass-card rounded-2xl overflow-hidden border border-white/10 print:border-none print:shadow-none">
            {/* Official Legal Corporate Header for Print (Unified across all 4 companies) */}
            <div className="hidden print:block p-4 bg-white">
              <LegalDocumentHeader 
                title="CASE DOSSIER & PARTICULARS"
                refNo={targetCase?.caseNo}
                date={targetCase?.createdAt}
                clientName={targetCase?.clientName}
                subRef={`Status: ${targetCase?.status || 'Active'}`}
                subject={`OFFICIAL CARGO CASE RECORD: ${targetCase?.caseNo || ''}`}
              />
            </div>

            {/* Header / Title Section */}
            <div className="bg-black/20 p-6 border-b border-white/10 print:bg-gray-100 print:border-b print:border-gray-300">
               <div className="flex flex-wrap justify-between items-center gap-4">
                  <div className="flex items-center gap-4">
                     <div className="flex flex-col justify-center">
                        <h2 className="text-2xl sm:text-3xl font-bold text-white print:text-black leading-tight mb-1">{targetCase?.caseNo}</h2>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs uppercase tracking-wider font-bold text-slate-400 print:text-gray-600">Client:</span>
                          <p className="text-brand-300 print:text-black text-base sm:text-lg font-semibold">
                            {targetCase?.clientName || 'Select Client'}
                          </p>
                          {!isClientUser && registeredClients.length > 0 && (
                            <select
                              value={registeredClients.includes(targetCase?.clientName) ? targetCase?.clientName : ''}
                              onChange={(e) => {
                                const newClientName = e.target.value;
                                if (!newClientName) return;
                                const updated = { ...targetCase, clientName: newClientName };
                                setSelectedCase(updated);
                                if (isEditingCase) setEditedCase(updated);
                                const updatedList = cases.map(c => c.id === updated.id ? updated : c);
                                setCases(updatedList);
                                safeAppStorage.setJSON('dpl_live_cases', updatedList);
                                safeAppStorage.setJSON('dpl_selected_case', updated);
                                updateCaseInFirestore(updated).catch(() => {});
                                setDraftToast(`✓ Client updated to "${newClientName}"`);
                              }}
                              className="no-print ml-1 bg-slate-900/90 hover:bg-slate-800 text-xs text-amber-300 border border-amber-500/30 rounded-lg px-2.5 py-1 outline-none focus:border-amber-400 cursor-pointer font-medium transition-colors"
                              title="Change Registered Client for this Case"
                            >
                              <option value="" disabled>Change Client...</option>
                              {registeredClients.map(cl => (
                                <option key={cl} value={cl} className="bg-slate-900 text-white">{cl}</option>
                              ))}
                            </select>
                          )}
                        </div>
                     </div>
                  </div>
                  <div className="text-right">
                     <span className={`inline-block px-3 py-1 rounded text-sm font-medium border border-white/10 mb-2 print:border-black
                        ${targetCase?.status === CaseStatus.COMPLETED ? 'bg-green-500/20 text-green-400 print:bg-transparent print:text-black' : 
                          'bg-blue-500/20 text-blue-400 print:bg-transparent print:text-black'}`}>
                        {targetCase?.status}
                     </span>
                     <p className="text-gray-300 text-sm print:text-black">
                         {targetCase?.createdAt}
                     </p>
                  </div>
               </div>
            </div>
                       <div className={`p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 print:grid-cols-2 print:gap-4 ${printOptions.onlyInvoice ? 'print:hidden' : ''}`}>
               {/* Client & Route Info */}
               <div className="bg-white/5 rounded-xl p-5 border border-white/5 print:bg-transparent print:border print:border-gray-300">
                  <h3 className="text-brand-300 print:text-black font-bold uppercase text-xs mb-4 border-b border-white/10 pb-2 print:border-gray-300">Case Info</h3>
                  <Field label="Client Name" value={targetCase?.clientName} onChange={(v) => setEditedCase({...targetCase, clientName: v})} />
                  <Field label="Category" value={targetCase?.category} onChange={(v) => setEditedCase({...targetCase, category: v})} />
                  <Field label="Port of Loading" value={targetCase?.pol} onChange={(v) => setEditedCase({...targetCase, pol: v})} />
                  <Field label="Port of Destination" value={targetCase?.pod} onChange={(v) => setEditedCase({...targetCase, pod: v})} />
               </div>

               {/* Shipping Details */}
               <div className="bg-white/5 rounded-xl p-5 border border-white/5 print:bg-transparent print:border print:border-gray-300">
                  <h3 className="text-brand-300 print:text-black font-bold uppercase text-xs mb-4 border-b border-white/10 pb-2 print:border-gray-300">Shipping Details</h3>
                   <Field 
                     label="BL Number" 
                     value={targetCase?.extractedData?.blNumber} 
                     onChange={(v) => setEditedCase({...targetCase, extractedData: {...targetCase.extractedData, blNumber: v}})} 
                  />
                   <Field 
                     label="Vessel Name" 
                     value={targetCase?.extractedData?.vesselName} 
                     onChange={(v) => setEditedCase({...targetCase, extractedData: {...targetCase.extractedData, vesselName: v}})} 
                  />
                   <Field 
                     label="Arrival Date" 
                     value={targetCase?.extractedData?.arrivalDate} 
                     onChange={(v) => setEditedCase({...targetCase, extractedData: {...targetCase.extractedData, arrivalDate: v}})} 
                  />
               </div>

               {/* Cargo Specs */}
               <div className="bg-white/5 rounded-xl p-5 border border-white/5 print:bg-transparent print:border print:border-gray-300">
                  <h3 className="text-brand-300 print:text-black font-bold uppercase text-xs mb-4 border-b border-white/10 pb-2 print:border-gray-300">Cargo Specs</h3>
                  <Field 
                     label="Shipper" 
                     value={targetCase?.extractedData?.shipperName} 
                     onChange={(v) => setEditedCase({...targetCase, extractedData: {...targetCase.extractedData, shipperName: v}})} 
                  />
                  <Field 
                     label="Consignee" 
                     value={targetCase?.extractedData?.consigneeName} 
                     onChange={(v) => setEditedCase({...targetCase, extractedData: {...targetCase.extractedData, consigneeName: v}})} 
                  />
                  <Field 
                     label="Total Weight" 
                     value={targetCase?.extractedData?.totalWeight ? `${targetCase?.extractedData?.totalWeight} Kg` : ''} 
                     onChange={(v) => setEditedCase({...targetCase, extractedData: {...targetCase.extractedData, totalWeight: parseFloat(v) || 0}})} 
                  />
               </div>
            </div>

            {/* Containers List */}
            <div className={`p-6 border-t border-white/10 print:border-gray-300 ${printOptions.onlyInvoice ? 'print:hidden' : ''}`}>
                <div className="flex justify-between items-center mb-4">
                   <h3 className="text-white print:text-black font-bold text-lg">Containers</h3>
                   {isEditingCase && (
                       <button className="text-xs bg-brand-600 text-white px-2 py-1 rounded">Add Container</button>
                   )}
                </div>
                {/* Mobile View (Cards) - Optimized for vertical thumb scrolling */}
                <div className="block sm:hidden divide-y divide-white/10 touch-pan-y">
                    {targetCase?.containers?.length > 0 ? (
                        targetCase.containers.map((c: any, idx: number) => (
                            <div key={idx} className="py-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="font-mono font-bold text-white text-sm">
                                        {isEditingCase ? (
                                            <input 
                                                className="bg-transparent border-b border-brand-400 w-36 text-white font-mono" 
                                                value={c.number} 
                                                onChange={(e) => {
                                                    const newContainers = [...targetCase.containers];
                                                    newContainers[idx].number = e.target.value;
                                                    setEditedCase({...targetCase, containers: newContainers});
                                                }} 
                                            />
                                        ) : c.number}
                                    </span>
                                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-brand-500/20 text-brand-300 border border-brand-500/30">
                                        {c.status || 'Active'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs text-gray-300 bg-white/5 p-2 rounded-lg">
                                    <div>
                                        <span className="text-[10px] text-gray-500 uppercase block">Size</span>
                                        <span className="font-medium text-white">{c.size || '20ft'}</span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-gray-500 uppercase block">Weight</span>
                                        <span className="font-medium text-white">{c.weight ? `${c.weight} Kg` : '-'}</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="p-4 text-center text-gray-400 italic text-xs">No containers assigned.</div>
                    )}
                </div>

                {/* Desktop View (Table) */}
                <div className="hidden sm:block overflow-x-auto touch-pan-y custom-scrollbar">
                    <table className="w-full text-left text-sm text-gray-200 print:text-black">
                        <thead className="bg-white/5 uppercase text-xs font-semibold text-gray-300 print:text-black border-b border-white/5 print:border-gray-300 print:bg-gray-100">
                            <tr>
                                <th className="p-3">Container No</th>
                                <th className="p-3">Size</th>
                                <th className="p-3">Weight (Kg)</th>
                                <th className="p-3">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 print:divide-gray-300">
                            {targetCase?.containers?.length > 0 ? (
                                targetCase.containers.map((c: any, idx: number) => (
                                    <tr key={idx}>
                                        <td className="p-3 font-mono font-medium text-white print:text-black">
                                            {isEditingCase ? (
                                                <input className="bg-transparent border-b border-white/20 w-32 text-white" value={c.number} onChange={(e) => {
                                                    const newContainers = [...targetCase.containers];
                                                    newContainers[idx].number = e.target.value;
                                                    setEditedCase({...targetCase, containers: newContainers});
                                                }} />
                                            ) : c.number}
                                        </td>
                                        <td className="p-3 text-white print:text-black">{c.size}</td>
                                        <td className="p-3 text-white print:text-black">{c.weight}</td>
                                        <td className="p-3 text-white print:text-black">{c.status}</td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={4} className="p-4 text-center text-gray-400 italic">No containers assigned.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Billing Details (On-Screen Interactive Card) */}
            <div className="p-6 border-t border-white/10 no-print space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-white font-bold text-lg flex items-center gap-2">
                    <FileText className="text-amber-400" size={20} />
                    <span>Billing Details</span>
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {(effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.FINANCE_MANAGER) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNewChargeDesc('');
                        setNewChargeAmount('');
                        setShowAddChargeModal(true);
                      }}
                      className="bg-brand-600/20 hover:bg-brand-600/30 text-brand-300 border border-brand-500/30 text-xs px-3 py-1.5 rounded-xl flex items-center gap-1.5 font-medium transition-all hover:scale-105"
                      title="Add additional charge or fee"
                    >
                      <Plus size={14} />
                      <span>Add Charge</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 text-xs">
                      <ShieldCheck size={14} className="text-amber-400" />
                      <span>Finance Manager / Admin Managed</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Charges Breakdown Table */}
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-900/60">
                <table className="w-full text-left text-sm text-gray-200">
                  <thead className="bg-white/5 uppercase text-xs font-semibold text-gray-300 border-b border-white/10">
                    <tr>
                      <th className="p-3 w-10 text-center">#</th>
                      <th className="p-3">Service Description</th>
                      <th className="p-3 text-right">Amount (PKR)</th>
                      <th className="p-3 text-center">Payment Receipt</th>
                      <th className="p-3 text-center w-14">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(!targetCase.charges || targetCase.charges.length === 0) ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-gray-400 text-xs italic">
                          No charges added yet. Click "+ Add Charge" above to add TP charges, transport, or customs fees.
                        </td>
                      </tr>
                    ) : (
                      targetCase.charges.map((charge: any, idx: number) => (
                      <tr key={idx} className="hover:bg-white/5 transition-colors group">
                        <td className="p-3 text-gray-400 text-xs text-center">{idx + 1}</td>
                        <td className="p-3 text-white font-medium text-xs sm:text-sm">
                          {isEditingCase ? (
                            <input
                              type="text"
                              value={charge.description || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                const currentCharges = targetCase.charges ? [...targetCase.charges] : [];
                                currentCharges[idx] = { ...currentCharges[idx], description: val };
                                const updatedCase = { ...targetCase, charges: currentCharges };
                                setCases(prev => prev.map(c => c.id === updatedCase.id ? updatedCase : c));
                                setSelectedCase(updatedCase);
                                setEditedCase(updatedCase);
                                updateCaseInFirestore(updatedCase).catch(err => console.warn("Update desc err:", err));
                              }}
                              className="w-full bg-slate-950/80 border border-white/20 focus:border-brand-400 rounded-lg px-2.5 py-1 text-white text-xs sm:text-sm outline-none"
                              placeholder="Charge Description"
                            />
                          ) : (
                            <span>{charge.description}</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <span className="text-[11px] font-mono text-emerald-500 font-bold">PKR</span>
                            <input
                              type="number"
                              value={charge.amount ?? ''}
                              onChange={(e) => {
                                const newAmount = Number(e.target.value) || 0;
                                const currentCharges = targetCase.charges ? [...targetCase.charges] : [];
                                currentCharges[idx] = { ...currentCharges[idx], amount: newAmount };
                                const updatedCase = { ...targetCase, charges: currentCharges };
                                setCases(prev => prev.map(c => c.id === updatedCase.id ? updatedCase : c));
                                setSelectedCase(updatedCase);
                                if (isEditingCase) setEditedCase(updatedCase);
                                updateCaseInFirestore(updatedCase).catch(err => console.warn("Update amount err:", err));
                              }}
                              className="w-28 sm:w-36 bg-slate-950/90 border border-emerald-500/40 hover:border-emerald-400 focus:border-emerald-400 rounded-lg px-2.5 py-1 text-right font-mono font-bold text-emerald-300 text-xs sm:text-sm outline-none transition-colors"
                              placeholder="0"
                              title="Editable Amount in PKR"
                            />
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          {charge.receiptUrl ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setLightboxImage(charge.receiptUrl)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-medium flex items-center gap-1 transition-colors"
                                title="View Receipt"
                              >
                                <Eye size={12} />
                                <span>View Receipt</span>
                              </button>
                              <a
                                href={charge.receiptUrl}
                                download={charge.receiptName || `Receipt_${(charge.description || 'charge').replace(/\s+/g, '_')}.png`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 rounded-lg bg-brand-500/15 hover:bg-brand-500/25 text-brand-300 border border-brand-500/30 transition-colors"
                                title="Download Receipt"
                              >
                                <Download size={13} />
                              </a>
                            </div>
                          ) : (
                            <label className="cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-white/20 hover:border-brand-400 text-gray-400 hover:text-white text-xs transition-colors">
                              <Upload size={12} />
                              <span>+ Attach Receipt</span>
                              <input
                                type="file"
                                accept="image/*,.pdf"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  try {
                                    const proc = await compressAndPrepareFile(file);
                                    const dataUrl = proc?.dataUrl || proc?.base64 || '';
                                    const currentCharges = targetCase.charges ? [...targetCase.charges] : [];
                                    currentCharges[idx] = {
                                      ...currentCharges[idx],
                                      receiptUrl: dataUrl,
                                      receiptName: file.name
                                    };
                                    const updatedCase = { ...targetCase, charges: currentCharges };
                                    setCases(prev => prev.map(c => c.id === updatedCase.id ? updatedCase : c));
                                    setSelectedCase(updatedCase);
                                    if (isEditingCase) setEditedCase(updatedCase);
                                    updateCaseInFirestore(updatedCase).catch(e => console.warn("Attach receipt err:", e));
                                  } catch (err) {
                                    console.error("Failed to attach receipt:", err);
                                  }
                                }}
                              />
                            </label>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {(effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.FINANCE_MANAGER) ? (
                            <button
                              type="button"
                              onClick={() => {
                                const currentCharges = targetCase.charges ? [...targetCase.charges] : [];
                                const updatedCharges = currentCharges.filter((_, i) => i !== idx);
                                const updatedCase = { ...targetCase, charges: updatedCharges };
                                setCases(prev => prev.map(c => c.id === updatedCase.id ? updatedCase : c));
                                setSelectedCase(updatedCase);
                                if (isEditingCase) setEditedCase(updatedCase);
                                updateCaseInFirestore(updatedCase).catch(e => console.warn("Firestore charge delete err:", e));
                              }}
                              className="text-gray-500 hover:text-red-400 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                              title="Remove Charge"
                            >
                              <Trash2 size={13} />
                            </button>
                          ) : (
                            <span className="text-gray-600 text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    )))}
                    <tr className="bg-white/5 font-bold border-t-2 border-white/10">
                      <td colSpan={2} className="p-3 text-gray-300 uppercase text-xs">Total Amount Due:</td>
                      <td className="p-3 text-right text-amber-400 font-mono text-base">
                        PKR {(targetCase.charges || []).reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0).toLocaleString()}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Attached Documents Section */}
            {targetCase?.documents && targetCase.documents.length > 0 && (
                <div className={`p-6 border-t border-white/10 print:border-gray-300 break-before-page ${(!printOptions.withAttachments || printOptions.onlyInvoice) ? 'print:hidden' : ''}`}>
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <FileCheck className="text-emerald-400" size={20} />
                        <h3 className="text-white print:text-black font-bold text-lg">
                          Attached Documents ({targetCase.documents.length})
                        </h3>
                      </div>
                      <span className="text-xs text-gray-400 print:hidden">
                        Official customs, terminal & shipping paperwork
                      </span>
                    </div>

                    <div className="space-y-6">
                        {targetCase.documents.map((doc: any, idx: number) => {
                          const docName = doc?.name || `Document ${idx + 1}`;
                          const isPdf = Boolean(
                            docName.toLowerCase().endsWith('.pdf') || 
                            doc?.type?.toLowerCase().includes('pdf') ||
                            (doc?.url && doc.url.startsWith('data:application/pdf'))
                          );
                          const isImage = Boolean(
                            docName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/) ||
                            (doc?.type && doc.type.toLowerCase().startsWith('image/'))
                          );
                          const docSrc = getDocSource(doc);

                          return (
                            <div key={idx} className="bg-slate-900/90 border border-white/15 rounded-2xl overflow-hidden shadow-lg print:bg-white print:border-gray-300 print:p-0">
                                {/* Document Header */}
                                <div className="p-4 bg-slate-950/80 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 print:bg-gray-100 print:border-gray-300">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                                      isPdf ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 
                                      isImage ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30' : 
                                      'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                    }`}>
                                      {isPdf ? 'PDF' : isImage ? 'IMG' : 'DOC'}
                                    </div>
                                    <div>
                                      <p className="text-white print:text-black font-bold text-sm truncate max-w-xs sm:max-w-md">
                                        {docName}
                                      </p>
                                      <p className="text-[11px] text-gray-400">
                                        {doc?.docCategory || doc?.type || 'Shipping Document'}
                                        {doc?.size ? ` • ${(doc.size / 1024).toFixed(0)} KB` : ''}
                                      </p>
                                    </div>
                                  </div>

                                  {/* Executive Action Buttons */}
                                  <div className="flex items-center gap-2 flex-wrap no-print">
                                    <button 
                                      type="button"
                                      onClick={() => handlePreviewAttachedDoc(doc, targetCase)}
                                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 border border-white/15 transition cursor-pointer hover:border-amber-400/50"
                                      title="Open high-fidelity preview"
                                    >
                                      <Eye size={13} className="text-amber-400" /> View Document
                                    </button>

                                    <button 
                                      type="button"
                                      onClick={() => handleDownloadAttachedDoc(doc, targetCase)}
                                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 border border-white/15 transition cursor-pointer hover:border-emerald-400/50"
                                      title="Download file to device"
                                    >
                                      <Download size={13} className="text-emerald-400" /> Download
                                    </button>

                                    <button 
                                      type="button"
                                      onClick={() => handleOpenDocInNewTab(doc, targetCase)}
                                      className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-gray-300 hover:text-white text-xs border border-white/15 transition cursor-pointer"
                                      title="Open in new window"
                                    >
                                      <ExternalLink size={14} />
                                    </button>

                                    {isEditingCase && (
                                      <button 
                                        type="button"
                                        onClick={() => {
                                          if (window.confirm("Are you sure you want to remove this document?")) {
                                            const updatedDocs = targetCase.documents.filter((_: any, dIdx: number) => dIdx !== idx);
                                            setEditedCase({ ...targetCase, documents: updatedDocs });
                                          }
                                        }}
                                        className="text-red-400 hover:text-red-300 text-xs font-semibold flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1.5 rounded-xl border border-red-500/20 transition cursor-pointer"
                                      >
                                        <Trash2 size={13} /> Remove
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Document Body Preview */}
                                <div className="p-4 bg-black/40">
                                  {isPdf ? (
                                    <div className="rounded-xl overflow-hidden border border-white/10 bg-slate-950/60 p-4 text-center">
                                      {docSrc && (docSrc.startsWith('data:application/pdf') || docSrc.startsWith('blob:')) ? (
                                        <div className="space-y-3">
                                          <iframe 
                                            src={docSrc} 
                                            title={docName} 
                                            className="w-full h-[450px] rounded-lg border border-white/10 bg-white" 
                                          />
                                          <div className="flex items-center justify-center gap-3 pt-2 no-print">
                                            <button
                                              type="button"
                                              onClick={() => handlePreviewAttachedDoc(doc, targetCase)}
                                              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold border border-white/15 flex items-center gap-2 cursor-pointer"
                                            >
                                              <Eye size={14} className="text-amber-400" /> Fullscreen Document Viewer
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleDownloadAttachedDoc(doc, targetCase)}
                                              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-lg shadow-amber-500/20"
                                            >
                                              <Download size={14} /> Download PDF File
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="py-8 flex flex-col items-center justify-center gap-3">
                                          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                                            <FileText size={28} />
                                          </div>
                                          <div className="text-center">
                                            <h4 className="text-sm font-bold text-white mb-0.5">{docName}</h4>
                                            <p className="text-xs text-gray-400">Customs & Shipping PDF Attachment</p>
                                          </div>
                                          <div className="flex items-center gap-3 mt-2 no-print">
                                            <button
                                              type="button"
                                              onClick={() => handlePreviewAttachedDoc(doc, targetCase)}
                                              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold border border-white/15 flex items-center gap-2 cursor-pointer"
                                            >
                                              <Eye size={14} className="text-amber-400" /> View PDF
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleDownloadAttachedDoc(doc, targetCase)}
                                              className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer"
                                            >
                                              <Download size={14} /> Download File
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ) : isImage && docSrc ? (
                                    <div 
                                      className="border border-white/10 rounded-xl overflow-hidden cursor-pointer bg-black/60 flex items-center justify-center"
                                      onClick={() => handlePreviewAttachedDoc(doc, targetCase)}
                                    >
                                      <img 
                                        src={docSrc} 
                                        alt={docName} 
                                        className="w-full h-auto object-contain max-h-[700px] mx-auto hover:scale-[1.01] transition-transform"
                                      />
                                    </div>
                                  ) : (
                                    <div className="p-8 text-center text-gray-400 bg-slate-950/40 rounded-xl border border-white/10 flex flex-col items-center justify-center gap-3">
                                      <FileText size={36} className="text-gray-400" />
                                      <div>
                                        <p className="text-sm font-semibold text-white">{docName}</p>
                                        <p className="text-xs text-gray-400 mt-0.5">Attached shipment paperwork</p>
                                      </div>
                                      <div className="flex items-center gap-2 mt-1 no-print">
                                        <button
                                          type="button"
                                          onClick={() => handlePreviewAttachedDoc(doc, targetCase)}
                                          className="px-3 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg border border-white/15 flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <Eye size={13} className="text-amber-400" /> View
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDownloadAttachedDoc(doc, targetCase)}
                                          className="px-3 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg border border-white/15 flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <Download size={13} className="text-emerald-400" /> Download
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                            </div>
                          );
                        })}
                    </div>
                </div>
            )}
            
            {/* Invoice Section */}
            {(printOptions.withInvoice || printOptions.onlyInvoice) && targetCase?.charges && targetCase.charges.length > 0 && (
                <div className="p-6 border-t border-white/10 print:border-gray-300 break-before-page hidden print:block bg-white text-black">
                    <LegalDocumentHeader 
                      title="COMMERCIAL INVOICE"
                      refNo={targetCase.caseNo}
                      date={targetCase.createdAt}
                      clientName={targetCase.clientName}
                      subject={`OFFICIAL BILLING & INVOICE RECORD: ${targetCase.caseNo}`}
                    />

                    <table className="w-full text-left text-sm text-gray-200 print:text-black mb-6 border border-gray-200">
                        <thead className="bg-white/5 print:bg-gray-100 uppercase text-xs font-semibold print:text-black border-b border-gray-200">
                            <tr>
                                <th className="p-4 border-r border-gray-200">Description</th>
                                <th className="p-4 text-right">Amount (PKR)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {targetCase.charges.map((charge: any, idx: number) => (
                                <tr key={idx}>
                                    <td className="p-4 border-r border-gray-200">{charge.description}</td>
                                    <td className="p-4 text-right font-medium font-mono">{charge.amount.toLocaleString()}</td>
                                </tr>
                            ))}
                            <tr className="bg-white/5 print:bg-gray-50 border-t-2 border-gray-300">
                                <td className="p-4 border-r border-gray-200 font-bold text-right uppercase">Total Amount Due:</td>
                                <td className="p-4 text-right font-bold text-brand-500 font-mono text-lg">
                                    PKR {targetCase.charges.reduce((sum: number, c: any) => sum + c.amount, 0).toLocaleString()}
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    {/* Legal Document Footer with Official Subsidiary Seal */}
                    <LegalDocumentFooter companyId={targetCase?.companyId as any} />
                </div>
            )}

            {/* Print Footer for Case Dossier */}
            <div className="hidden print:block p-4 mt-6">
              <LegalDocumentFooter companyId={targetCase?.companyId as any} />
            </div>
         </div>
  
         {/* If Case is Fully Completed, show the Completed Case Dossier View */}
         {targetCase?.status === CaseStatus.COMPLETED ? (
           <CompletedCaseDossier
             targetCase={targetCase}
             customLogo={activeLogo}
             userRole={mockUserRole}
             onUpdateCase={(updated) => {
               setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
               setSelectedCase(updated);
               updateCaseInFirestore(updated).catch(e => console.warn("Firestore error:", e));
             }}
             onOpenDownloadAllModal={() => setShowDownloadDocsModal(true)}
           />
         ) : (
           /* Workflow Visualization (Hidden on Print) - Dynamic Workflow Process */
           <div className="glass-card p-6 rounded-2xl no-print">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <Layers className="text-brand-400" size={20} />
                      <span>{getCategoryWorkflow(targetCase?.category).category} Workflow ({getCategoryWorkflow(targetCase?.category).totalSteps} Steps)</span>
                    </h3>
                    {targetCase?.subCategory && targetCase.subCategory !== 'Standard Container / General Cargo' && (
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {targetCase.subCategory}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Tap any of the {getCategoryWorkflow(targetCase?.category).totalSteps} workflow steps to view details, update mandatory compliance fields, or advance the case.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-brand-300 bg-brand-500/10 border border-brand-500/20 px-2.5 py-1 rounded-full shrink-0">
                    {targetCase?.status === CaseStatus.COMPLETED ? (
                      <span className="text-emerald-300 font-bold">✓ Workflow Completed</span>
                    ) : (
                      `Step ${Math.min(getCategoryWorkflow(targetCase?.category).totalSteps, getWorkflowStepIndex(targetCase?.category, targetCase?.status as string) + 1)} of ${getCategoryWorkflow(targetCase?.category).totalSteps} Active`
                    )}
                  </span>
                </div>
              </div>

              {/* If Case has an Active Incident Stoppage */}
              {(targetCase?.isIncidentVault || targetCase?.status === CaseStatus.INCIDENT_STOPPAGE) && (
                <div className="mb-6 p-4 rounded-xl bg-rose-500/15 border border-rose-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-pulse">
                  <div className="flex items-center gap-3">
                    <AlertTriangle size={24} className="text-rose-400 shrink-0" />
                    <div>
                      <h4 className="font-bold text-rose-300 text-sm">Case Stoppage / Incident Active</h4>
                      <p className="text-xs text-gray-300 mt-0.5">
                        Reason: {targetCase?.incidentDetails?.reason || 'Route Stoppage'} | Location: {targetCase?.incidentDetails?.location || 'Unknown'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleResolveIncident(targetCase)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 shrink-0"
                  >
                    Resolve & Resume Workflow
                  </button>
                </div>
              )}

              <div className="relative">
                 <div className="absolute left-6 top-6 bottom-6 w-0.5 bg-white/10"></div>
                 {(() => {
                   const categoryWorkflow = getCategoryWorkflow(targetCase?.category);
                   const activeIndex = getWorkflowStepIndex(targetCase?.category, targetCase?.status as string);
                   const isCaseCompleted = targetCase?.status === CaseStatus.COMPLETED;

                   return categoryWorkflow.steps.map((stepConfig, index) => {
                     const isCompleted = isCaseCompleted || index < activeIndex;
                     const isCurrent = !isCaseCompleted && index === activeIndex;
                     const isPending = !isCaseCompleted && index > activeIndex;
                     const stepDetail = targetCase?.workflowDetails?.[stepConfig.id];

                     return (
                       <div 
                         key={`cm_step_${stepConfig.id || index}_${index}`} 
                         onClick={() => handleOpenStepModal(stepConfig.id as any, index, targetCase)}
                         className="relative flex gap-4 sm:gap-6 mb-6 last:mb-0 cursor-pointer group"
                         title="Tap to update or view step details"
                       >
                          <div className={`w-12 h-12 rounded-full border-4 shrink-0 flex items-center justify-center z-10 font-bold text-sm transition-all group-hover:scale-110 shadow-md ${
                             isCompleted ? 'bg-emerald-600 border-emerald-950 text-white shadow-emerald-600/30' : 
                             isCurrent ? 'bg-amber-500 border-amber-950 text-white animate-pulse shadow-amber-500/40 ring-4 ring-amber-500/20' : 
                             'bg-slate-900 border-white/10 text-gray-500'
                          }`}>
                             {isCompleted ? <CheckCircle2 size={20} /> : index + 1}
                          </div>
                          <div className={`flex-1 p-4 rounded-xl border transition-all group-hover:border-brand-500/60 group-hover:bg-white/[0.07] ${
                             isCurrent ? 'bg-amber-500/10 border-amber-500/40 shadow-lg shadow-amber-500/5' : 
                             isCompleted ? 'bg-emerald-500/5 border-emerald-500/20' : 
                             'bg-white/[0.02] border-white/5'
                          }`}>
                             <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                               <div className="flex items-center gap-2.5">
                                 <h4 className={`font-semibold text-sm sm:text-base ${isCompleted ? 'text-white' : isCurrent ? 'text-amber-300 font-bold' : 'text-gray-400'}`}>
                                   Step {index + 1}: {stepConfig.title}
                                 </h4>
                                 {isCompleted && (
                                   <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                                     <CheckCircle2 size={10} /> Completed
                                   </span>
                                 )}
                                 {isCurrent && (
                                   <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                                     <Clock size={10} className="animate-spin" /> In Progress
                                   </span>
                                 )}
                                 {isPending && (
                                   <span className="text-[10px] bg-white/5 text-gray-400 border border-white/10 px-2 py-0.5 rounded-full">
                                     Pending
                                   </span>
                                 )}
                               </div>
                               <span className="text-xs text-brand-400 group-hover:text-brand-300 font-medium flex items-center gap-1 shrink-0">
                                 <span>Update / Details</span>
                                 <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                               </span>
                             </div>

                             {/* Render step details if recorded */}
                             {stepDetail && (stepDetail.remarks || stepDetail.referenceNo || stepDetail.officer || stepDetail.date) && (
                               <div className="mt-2.5 pt-2.5 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-300">
                                 {stepDetail.date && (
                                   <div>
                                     <span className="text-gray-400">Date: </span>
                                     <span className="font-mono text-white">{stepDetail.date}</span>
                                   </div>
                                 )}
                                 {stepDetail.officer && (
                                   <div>
                                     <span className="text-gray-400">Officer: </span>
                                     <span className="text-white">{stepDetail.officer}</span>
                                   </div>
                                 )}
                                 {stepDetail.referenceNo && (
                                   <div>
                                     <span className="text-gray-400">Ref/Challan: </span>
                                     <span className="font-mono text-amber-300">{stepDetail.referenceNo}</span>
                                   </div>
                                 )}
                                 {stepDetail.remarks && (
                                   <div className="sm:col-span-3 text-gray-300 text-xs italic bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/5 mt-1">
                                     "{stepDetail.remarks}"
                                   </div>
                                 )}
                               </div>
                             )}

                             {/* Live Transit Road / Nearby Area Locations inside Transit Workflow Step */}
                             {(() => {
                               const isTransitStage =
                                 String(stepConfig.id).toLowerCase().includes('transit') ||
                                 String(stepConfig.title).toLowerCase().includes('transit') ||
                                 String(stepConfig.title).toLowerCase().includes('en-route') ||
                                 (stepDetail?.transitLocationsLog && stepDetail.transitLocationsLog.length > 0);
                               if (!isTransitStage) return null;

                               const stepLocs =
                                 (stepDetail?.transitLocationsLog && stepDetail.transitLocationsLog.length > 0)
                                   ? stepDetail.transitLocationsLog
                                   : (targetCase?.transitLocationsHistory || []);

                               if (!stepLocs || stepLocs.length === 0) return null;

                               return (
                                 <div className="mt-3 pt-2.5 border-t border-cyan-500/20 space-y-1.5">
                                   <div className="flex items-center justify-between text-[11px] font-bold text-cyan-300">
                                     <span className="flex items-center gap-1.5">
                                       <MapPin size={12} className="text-cyan-400" />
                                       <span>Live Transit Route Checkpoints (Road / Nearby Area):</span>
                                     </span>
                                     <span className="font-mono text-[10px] text-cyan-400">
                                       {stepLocs.length} {stepLocs.length === 1 ? 'Location' : 'Locations'}
                                     </span>
                                   </div>
                                   <div className="flex flex-wrap gap-1.5">
                                     {stepLocs.map((loc: any, lIdx: number) => (
                                       <span
                                         key={loc.id || lIdx}
                                         className="px-2.5 py-1 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-cyan-200 text-[11px] font-medium flex items-center gap-1.5"
                                       >
                                         <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-300 font-mono text-[9px] font-bold flex items-center justify-center">
                                           {lIdx + 1}
                                         </span>
                                         <strong className="text-white">{loc.roadOrAreaName}</strong>
                                         <span className="text-[10px] text-cyan-400/80 font-mono">({loc.formattedTime})</span>
                                       </span>
                                     ))}
                                   </div>
                                 </div>
                               );
                             })()}
                          </div>
                       </div>
                     );
                   });
                 })()}
              </div>

              {/* Permanent Transit Route Locations & Port Gate-Out / Unloading Duration Calculation History */}
              <div className="mt-6 pt-6 border-t border-white/10">
                <CaseTransitHistoryCard targetCase={targetCase} />
              </div>
           </div>
         )}

         {/* Bottom Action Section: Download Documents */}
         <div className="glass-card p-6 rounded-2xl no-print border border-brand-500/30 bg-gradient-to-r from-slate-900 via-brand-950/40 to-slate-900 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
           <div>
             <h4 className="text-white font-bold text-lg flex items-center gap-2">
               <Download className="text-brand-400" size={22} />
               <span>Download Documents</span>
             </h4>
             <p className="text-xs sm:text-sm text-gray-300 mt-1">
               Download single-page Case Details, itemized Billing Invoice, Attached Shipping Documents, or Complete Dossier.
             </p>
           </div>
           <button
             type="button"
             onClick={() => setShowDownloadDocsModal(true)}
             className="bg-brand-600 hover:bg-brand-500 active:scale-95 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-brand-600/30 flex items-center gap-2.5 text-sm transition-all shrink-0 hover:scale-105"
             id="btn-bottom-download-docs"
           >
             <Download size={18} />
             <span>Download Documents</span>
           </button>
         </div>
      </div>
    );
  };

  // --- Registration Wizard Steps ---
  
  // --- Registration Step 1: Merged Case Particulars & Documents (Single-Screen) ---
  const renderStep1_Merged = () => {
    const isPrivateCargo = formData.category === 'Transportation of Private Cargo' || formData.category?.toLowerCase().includes('private');

    return (
      <div className="space-y-5 animate-in fade-in pb-2">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          
          {/* LEFT COLUMN (7 Cols): Client, Category & Route */}
          <div className="lg:col-span-7 bg-slate-900/95 p-5 sm:p-6 rounded-2xl border border-white/10 space-y-5 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <Briefcase size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">1. Consignment Particulars & Route</h3>
                  <p className="text-xs text-slate-400">Select client account, service category, and ports</p>
                </div>
              </div>
              <span className="text-xs font-mono font-semibold text-amber-300 bg-amber-500/15 px-2.5 py-1 rounded-lg border border-amber-500/30 shrink-0">
                Step 1 of 4
              </span>
            </div>

            {/* 1. Client Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <User size={14} className="text-amber-400" />
                  <span>Registered Client Name <span className="text-red-400">*</span></span>
                </label>
                {isClientUser && (
                  <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-md flex items-center gap-1">
                    <CheckCircle2 size={12} /> Verified Account
                  </span>
                )}
              </div>

              {isClientUser ? (
                <div className="flex items-center justify-between h-11 px-4 rounded-xl bg-slate-950 border border-emerald-500/30">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <User size={16} className="text-emerald-400 shrink-0" />
                    <span className="text-sm font-bold text-white truncate">
                      {formData.client || effectiveClientName}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono hidden sm:block">
                    Client Portal
                  </span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <div className="relative flex-1">
                      <select 
                        className="w-full h-10 rounded-xl px-3.5 outline-none appearance-none cursor-pointer text-sm text-white bg-slate-950 border border-white/15 focus:border-amber-400 pr-9 transition-all"
                        value={formData.client}
                        onChange={(e) => {
                          if (e.target.value === '__ADD_NEW_CLIENT__') {
                            setShowAddClientModal(true);
                          } else {
                            handleClientSelect(e.target.value);
                          }
                        }}
                      >
                        <option value="" className="bg-slate-900 text-slate-400">-- Select Registered Client --</option>
                        {registeredClients.map(c => (
                          <option key={c} value={c} className="bg-slate-900 text-white">{c}</option>
                        ))}
                        <option value="__ADD_NEW_CLIENT__" className="bg-slate-900 text-amber-300 font-semibold">
                          + Add New Client & Configure Default Tariff...
                        </option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAddClientModal(true)}
                      className="h-10 bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold transition-all shadow shrink-0 cursor-pointer"
                      title="Register New Client & Set Default Tariff"
                    >
                      <Plus size={15} />
                      <span>+ New Client</span>
                    </button>
                  </div>

                  {formData.client && (
                    formData.charges && formData.charges.length > 0 ? (
                      <div className="flex items-center justify-between px-3 py-2 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-xs text-emerald-300">
                        <div className="flex items-center gap-2 truncate pr-2">
                          <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                          <span className="truncate">
                            <strong>{formData.charges.length}</strong> default charges loaded for <strong>{formData.client}</strong> in <strong>{formData.category}</strong> (PKR {formData.charges.reduce((s, c) => s + (Number(c.amount) || 0), 0).toLocaleString()})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAddClientModal(true)}
                          className="text-xs text-amber-300 hover:text-amber-200 font-semibold shrink-0 underline cursor-pointer"
                        >
                          Edit Tariff
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 border border-amber-500/25 rounded-xl text-xs text-amber-200">
                        <div className="flex items-center gap-2 truncate pr-2">
                          <AlertCircle size={14} className="text-amber-400 shrink-0" />
                          <span className="truncate">
                            No default charges saved for <strong>{formData.client}</strong> in <strong>{formData.category}</strong> (Amount: Nil). Enter charges for this category or click Configure Tariff.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAddClientModal(true)}
                          className="text-xs text-amber-300 hover:text-amber-200 font-semibold shrink-0 underline cursor-pointer"
                        >
                          Configure Tariff
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            {/* 2. Case Category & Equipment Sub-Category */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div className={supportsSubCategories(formData.category) ? '' : 'sm:col-span-2'}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Briefcase size={13} className="text-amber-400" />
                    <span>Service Category <span className="text-red-400">*</span></span>
                  </label>
                </div>
                <div className="relative">
                  <select
                    className="w-full h-10 rounded-xl px-3.5 outline-none appearance-none cursor-pointer text-sm text-white bg-slate-950 border border-white/15 focus:border-amber-400 pr-9 transition-all"
                    value={formData.category}
                    onChange={(e) => {
                      const newCat = e.target.value;
                      const foundClient = clientsData.find(c => c.name?.toLowerCase() === formData.client?.toLowerCase());
                      const resolved = resolveCaseCharges(foundClient, newCat, undefined, formData.containers);
                      setFormData({ 
                        ...formData, 
                        category: newCat,
                        subCategory: supportsSubCategories(newCat) ? (formData.subCategory || 'Standard Container / General Cargo') : undefined,
                        serviceArrangements: resolved.arrangements as any,
                        charges: resolved.charges
                      });
                      if (formData.client) {
                        if (resolved.charges.length > 0) {
                          setDraftToast(`✓ Loaded ${resolved.charges.length} default charges for ${formData.client} (${newCat})`);
                        } else {
                          setDraftToast(`Category changed to ${newCat}: Previous category charges cleared. Please enter charges for ${newCat}.`);
                        }
                      }
                    }}
                  >
                    <option value="" className="bg-slate-900 text-slate-400">-- Select Category --</option>
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat} className="bg-slate-900 text-white">
                        {cat}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                </div>
              </div>

              {supportsSubCategories(formData.category) && (
                <div>
                  <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 mb-1.5">
                    <Truck size={13} className="text-indigo-400" />
                    <span>Equipment / Cargo Sub-Category</span>
                  </label>
                  <div className="relative">
                    <select
                      className="w-full h-10 rounded-xl px-3.5 outline-none appearance-none cursor-pointer text-sm text-white bg-slate-950 border border-white/15 focus:border-amber-400 pr-9 transition-all"
                      value={formData.subCategory || 'Standard Container / General Cargo'}
                      onChange={(e) => setFormData({ ...formData, subCategory: e.target.value })}
                    >
                      {SUB_CATEGORY_OPTIONS.map(sub => (
                        <option key={sub} value={sub} className="bg-slate-900 text-white">
                          {sub}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                  </div>
                </div>
              )}
            </div>

            {/* 3. Port of Loading & Port of Destination */}
            <div className="space-y-3 pt-2 border-t border-white/10 relative z-30">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  {isPrivateCargo ? (
                    <>
                      <Truck size={14} className="text-amber-400" />
                      <span>Transport Route (Pickup & Drop-off Locations)</span>
                    </>
                  ) : (
                    <>
                      <Ship size={14} className="text-sky-400" />
                      <span>Maritime / Transit Route (POL & POD)</span>
                    </>
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => handleOpenAddPort(null)}
                  className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                >
                  <Plus size={12} /> {isPrivateCargo ? 'Add Location' : 'Add New Port'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PortSearchableInput
                  label={isPrivateCargo ? "Pickup Location (Origin)" : "Port of Loading (POL)"}
                  icon={isPrivateCargo ? <MapPin size={14} className="text-amber-400" /> : <Anchor size={14} className="text-sky-400" />}
                  value={formData.pol}
                  onChange={(val) => {
                    setFormData(prev => ({ 
                      ...prev, 
                      pol: val,
                      extractedData: { ...prev.extractedData, pickupDestination: val }
                    }));
                  }}
                  ports={ports}
                  targetField="pol"
                  placeholder={isPrivateCargo ? "e.g. Karachi Factory, Hub..." : "e.g. KPT, Port Qasim..."}
                  onOpenAddPort={handleOpenAddPort}
                />

                <PortSearchableInput
                  label={isPrivateCargo ? "Drop-off Location (Destination)" : "Port of Destination (POD)"}
                  icon={<MapPin size={14} className="text-emerald-400" />}
                  value={formData.pod}
                  onChange={(val) => {
                    setFormData(prev => ({ 
                      ...prev, 
                      pod: val,
                      extractedData: { ...prev.extractedData, dropoffDestination: val }
                    }));
                  }}
                  ports={ports}
                  targetField="pod"
                  placeholder={isPrivateCargo ? "e.g. Faisalabad, Lahore..." : "e.g. Lahore Dry Port, Torkham..."}
                  onOpenAddPort={handleOpenAddPort}
                />
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN (5 Cols): Shipping Documents Upload & Camera Scanner */}
          <div ref={documentsSectionRef} className="lg:col-span-5 bg-slate-900/95 p-5 sm:p-6 rounded-2xl border border-white/10 space-y-4 shadow-md flex flex-col justify-between relative z-10">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">2. Shipping Documents</h3>
                    <p className="text-xs text-slate-400">Upload B/L, Invoice & Packing List</p>
                  </div>
                </div>
                {uploadedDocs.length > 0 && (
                  <span className="text-xs text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 rounded-lg font-mono font-bold flex items-center gap-1">
                    <CheckCircle2 size={12} /> {uploadedDocs.length} Attached
                  </span>
                )}
              </div>

              {isAttachingFiles && (
                <div className="flex items-center justify-center gap-2 py-2.5 px-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs font-medium">
                  <Loader2 size={15} className="animate-spin text-amber-400" />
                  <span>Attaching & verifying document...</span>
                </div>
              )}

              <input 
                ref={multiFileInputRef}
                type="file"
                accept=".pdf,image/*,application/pdf"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={handleFileUpload}
              />
              <input 
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={handleCameraFileUpload}
              />

              {/* Dropzone & Primary Upload Buttons */}
              <div 
                data-dropzone="true"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                    await processFiles(Array.from(e.dataTransfer.files));
                  }
                }}
                className="border border-dashed border-white/20 hover:border-amber-400/60 rounded-xl p-4 bg-slate-950/70 transition-all text-center space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => multiFileInputRef.current?.click()}
                    className="h-11 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 shadow transition-all text-xs cursor-pointer"
                  >
                    <UploadCloud size={17} />
                    <span>Upload PDF / Images</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCaseDocScanner(true)}
                    className="h-11 px-4 bg-slate-800 hover:bg-slate-700 text-white border border-white/15 font-semibold rounded-xl flex items-center justify-center gap-2 transition-all text-xs cursor-pointer"
                  >
                    <Camera size={17} className="text-amber-400" />
                    <span>Camera Scanner</span>
                  </button>
                </div>

                <p className="text-xs text-slate-400">
                  Drag & drop B/L, Commercial Invoice, or Packing List files here
                </p>
              </div>

              {/* Uploaded Documents List */}
              {uploadedDocs.length > 0 ? (
                <div className="space-y-2.5 pt-2 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">
                      Attached Files ({uploadedDocs.length})
                    </span>
                    {uploadedDocs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setUploadedDocs([]);
                          setFiles([]);
                          safeAppStorage.removeItem('dpl_reg_docs');
                        }}
                        className="text-xs text-red-400 hover:text-red-300 font-semibold cursor-pointer"
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  <div className="max-h-44 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {uploadedDocs.map((doc, idx) => {
                      const isImage = (doc.type && doc.type.startsWith('image/')) || /\.(jpg|jpeg|png|webp|gif)$/i.test(doc.name);
                      const fileSizeFormatted = doc.size > 1024 * 1024 
                        ? `${(doc.size / (1024 * 1024)).toFixed(1)} MB`
                        : `${Math.max(1, Math.round(doc.size / 1024))} KB`;

                      return (
                        <div 
                          key={doc.id || `${doc.name}-${idx}`}
                          className="bg-slate-950 border border-white/10 rounded-xl p-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-400 shrink-0">
                              <FileText size={15} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-white truncate" title={doc.name}>
                                {doc.name}
                              </p>
                              <p className="text-[11px] text-slate-400 font-mono">
                                {fileSizeFormatted}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {isImage && doc.url && (
                              <button
                                type="button"
                                onClick={() => setLightboxImage(doc.url)}
                                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer"
                                title="Preview"
                              >
                                <Eye size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setUploadedDocs(prev => {
                                  const updated = prev.filter((_, i) => i !== idx);
                                  safeAppStorage.setJSON('dpl_reg_docs', updated);
                                  return updated;
                                });
                                setFiles(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="p-1.5 text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 cursor-pointer"
                              title="Remove"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Quick Scan & Auto-Extract Bar */}
                  <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between gap-3">
                    <div className="text-xs text-emerald-200 font-medium">
                      Ready to auto-extract B/L, Containers & Invoice fields
                    </div>
                    <button
                      type="button"
                      onClick={() => triggerDocumentReading()}
                      className="h-9 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow shrink-0 cursor-pointer"
                    >
                      <Sparkles size={14} />
                      <span>Auto-Extract</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-slate-950/50 border border-white/5 text-xs text-slate-400 text-center">
                  Attach shipping documents to auto-fill B/L, Vessel, Containers, and Invoice data, or proceed to enter details manually.
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    );
  };


  const renderDocumentReadingView = () => (
    <div className="w-full max-w-xl mx-auto px-4 py-8 space-y-6 text-center bg-slate-900/95 rounded-2xl border border-white/10 shadow-xl my-2">
      <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-amber-500/20 border-t-amber-400 animate-spin" />
        <div className="w-16 h-16 rounded-2xl bg-slate-950 border border-white/15 flex flex-col items-center justify-center">
          {readingProgress >= 100 ? (
            <CheckCircle2 className="text-emerald-400" size={28} />
          ) : (
            <>
              <Scan className="text-amber-400 animate-pulse w-5 h-5" />
              <span className="text-xs font-mono font-bold text-amber-300 mt-0.5">
                {readingProgress}%
              </span>
            </>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <h2 className="text-lg sm:text-xl font-bold text-white">
          Reading Shipping Documents...
        </h2>
        <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto">
          {readingPhase}
        </p>
      </div>

      <div className="bg-slate-950 p-4 rounded-xl border border-white/10 space-y-3 text-left">
        <div className="flex justify-between items-center text-xs font-medium gap-2">
          <span className="text-amber-300 flex items-center gap-1.5 truncate">
            <Loader2 size={13} className="animate-spin text-amber-400 shrink-0" />
            <span className="truncate">{readingPhase}</span>
          </span>
          <span className="text-white font-mono bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30 shrink-0 font-bold text-xs">
            {readingProgress}%
          </span>
        </div>

        <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
          <div 
            className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full rounded-full transition-all duration-300"
            style={{ width: `${Math.max(8, readingProgress)}%` }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-white/10 text-xs">
          <div className={`flex items-center gap-2 ${readingProgress >= 25 ? 'text-emerald-400 font-medium' : 'text-slate-400'}`}>
            <CheckCircle size={13} className="shrink-0" />
            <span className="truncate">Shipping Line & B/L Number</span>
          </div>
          <div className={`flex items-center gap-2 ${readingProgress >= 50 ? 'text-emerald-400 font-medium' : 'text-slate-400'}`}>
            <CheckCircle size={13} className="shrink-0" />
            <span className="truncate">Vessel, Voyage, POL & POD</span>
          </div>
          <div className={`flex items-center gap-2 ${readingProgress >= 75 ? 'text-emerald-400 font-medium' : 'text-slate-400'}`}>
            <CheckCircle size={13} className="shrink-0" />
            <span className="truncate">Commercial Invoice & Terms</span>
          </div>
          <div className={`flex items-center gap-2 ${readingProgress >= 95 ? 'text-emerald-400 font-medium' : 'text-slate-400'}`}>
            <CheckCircle size={13} className="shrink-0" />
            <span className="truncate">Containers, Weights & Seals</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderServiceArrangementsSection = (isStep4Review: boolean = false) => {
    const arrangements = formData.serviceArrangements || INITIAL_REGISTRATION_ARRANGEMENTS;
    const dplArrangedCount = Object.values(arrangements).filter(a => a.arrangedBy === 'DPL').length;
    const clientArrangedCount = Object.values(arrangements).filter(a => a.arrangedBy === 'Client').length;
    const compShort = activeCompany?.shortName || 'Company';

    return (
      <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 sm:p-6 space-y-5 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h4 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <Layers size={18} className="text-amber-400 shrink-0" />
              <span>Operational Logistics Services & Charges (Arranged by {compShort} vs Client)</span>
            </h4>
            <p className="text-xs text-slate-300 mt-1">
              Services marked <span className="text-emerald-400 font-semibold">Arranged by {compShort}</span> are included in the client invoice. Services marked <span className="text-sky-400 font-semibold">Arranged by Client</span> are settled directly by the client.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto text-xs shrink-0">
            <span className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5">
              <CheckCircle size={13} className="text-emerald-400" />
              <span>{dplArrangedCount} {compShort} Arranged</span>
            </span>
            <span className="bg-sky-500/15 text-sky-300 border border-sky-500/30 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5">
              <User size={13} className="text-sky-400" />
              <span>{clientArrangedCount} Client Direct</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {Object.entries(arrangements).map(([key, item]) => {
            const isDpl = item.arrangedBy === 'DPL';
            return (
              <div 
                key={key} 
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                  isDpl 
                    ? 'bg-emerald-950/20 border-emerald-500/30' 
                    : 'bg-slate-950/70 border-white/10'
                }`}
              >
                <div className="flex items-start sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-white block truncate">{item.label}</span>
                    <span className={`text-xs font-medium block mt-0.5 ${isDpl ? 'text-emerald-300/90' : 'text-slate-400'}`}>
                      {isDpl ? `Included in ${compShort} Client Invoice` : 'Client Settles Directly (Excluded from Invoice)'}
                    </span>
                  </div>

                  {/* Standard Toggle Selector Buttons */}
                  <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-white/15 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleServiceArrangement(key, 'DPL')}
                      className={`h-8 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                        isDpl 
                          ? 'bg-emerald-600 text-white shadow-sm' 
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title={`Arranged by ${compShort}: adds to client invoice`}
                    >
                      <CheckCircle size={12} />
                      <span>{compShort}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleServiceArrangement(key, 'Client')}
                      className={`h-8 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                        !isDpl 
                          ? 'bg-sky-600 text-white shadow-sm' 
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Arranged by Client: excluded from client invoice"
                    >
                      <User size={12} />
                      <span>Client</span>
                    </button>
                  </div>
                </div>

                {/* Amount Field or Client Direct Settlement Notice */}
                {isDpl ? (
                  <div className="flex flex-col gap-2 pt-2.5 border-t border-emerald-500/20">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-emerald-300 font-semibold flex items-center gap-1">
                          <DollarSign size={13} className="text-emerald-400" />
                          <span>{normalizeCategoryKey(formData.category) === 'Bonded Carrier' ? 'Per Container Rate:' : 'Charge Amount:'}</span>
                        </span>
                        <div className="relative w-36">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-emerald-400 font-bold">PKR</span>
                          <input
                            type="number"
                            value={item.amount || ''}
                            onChange={(e) => handleUpdateArrangementAmount(key, Number(e.target.value) || 0)}
                            placeholder="0"
                            className="w-full h-9 pl-11 pr-3 bg-slate-950 border border-emerald-500/40 rounded-lg text-sm font-mono font-bold text-emerald-300 focus:border-emerald-400 outline-none transition-all"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-emerald-300 font-mono font-semibold bg-emerald-500/15 px-2.5 py-1 rounded-lg border border-emerald-500/30 whitespace-nowrap flex items-center gap-1.5">
                          <CheckCircle size={12} className="text-emerald-400" />
                          <span>
                            {normalizeCategoryKey(formData.category) === 'Bonded Carrier' && formData.containers.length > 1
                              ? `PKR ${(Number(item.amount || 0) * formData.containers.length).toLocaleString()} (${formData.containers.length} × ${Number(item.amount || 0).toLocaleString()})`
                              : `PKR ${Number(item.amount || 0).toLocaleString()}`}
                          </span>
                        </span>
                        {formData.client && Number(item.amount) > 0 && (
                          <button
                            type="button"
                            onClick={async () => {
                              const clientObj = clientsData.find(c => c.name?.toLowerCase() === formData.client?.toLowerCase());
                              if (!clientObj) return;
                              try {
                                const updatedClient = await saveChargeAsClientDefault(clientObj, {
                                  description: item.label,
                                  amount: Number(item.amount),
                                  category: formData.category || 'Bonded Carrier',
                                  caseCategory: formData.category || 'Bonded Carrier',
                                  taxable: true
                                });
                                setClientsData(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
                                setDraftToast(`✓ Saved "${item.label}" (PKR ${Number(item.amount).toLocaleString()} per container) as default for ${formData.client} in ${formData.category}!`);
                              } catch (err) {
                                console.warn("Could not save default arrangement charge:", err);
                              }
                            }}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-semibold transition cursor-pointer whitespace-nowrap"
                            title={`Save per-container default charge for ${formData.client} under ${formData.category}`}
                          >
                            Save as Default ({formData.category})
                          </button>
                        )}
                      </div>
                    </div>
                    {normalizeCategoryKey(formData.category) === 'Bonded Carrier' && Number(item.amount) > 0 && formData.containers.length > 0 && (
                      <div className="text-[11px] text-amber-300/90 font-mono bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1">
                        {formData.containers.map((c, idx) => `${c.number || `Container #${idx + 1}`}: PKR ${Number(item.amount).toLocaleString()}`).join('  •  ')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-white/10">
                    <div className="flex items-center gap-1.5 text-sky-300">
                      <User size={13} className="text-sky-400 shrink-0" />
                      <span className="text-xs font-medium">Direct settlement by Client</span>
                    </div>
                    <span className="text-xs text-slate-400 font-medium bg-white/5 px-2.5 py-1 rounded-lg border border-white/10 whitespace-nowrap">
                      Excluded from Invoice
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderPrivateCargoRegistrationReview = (extracted: any, autoFilledCount: number) => {
    const compShort = activeCompany?.shortName || 'Company';
    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
        {/* Category Header Banner */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0">
              <Truck size={22} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white">Private Cargo Transport Details</h3>
                <span className="text-xs font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-lg">
                  Step 2 of 4 • Domestic Freight
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Verify pickup/drop-off route, cargo owner, waybill details, and service charge arrangements ({compShort} vs Client).
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-xs font-mono font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <CheckCircle size={14} className="text-emerald-400" /> {autoFilledCount} Fields Ready
            </span>
            {(uploadedDocs.length > 0 || files.length > 0) && (
              <button
                type="button"
                onClick={() => triggerDocumentReading(undefined, true)}
                disabled={isReadingDocuments}
                className="h-9 px-3.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={14} className={isReadingDocuments ? 'animate-spin text-amber-400' : 'text-amber-400'} />
                <span>{isReadingDocuments ? 'Reading...' : 'Read Again'}</span>
              </button>
            )}
            <label className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/30 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm">
              <UploadCloud size={14} className="text-white" />
              <span>{isReadingDocuments || isAttachingFiles ? 'Reading File...' : 'Upload Again & Read'}</span>
              <input
                type="file"
                multiple
                accept="*/*"
                onChange={(e) => handleFileUpload(e, true)}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Grid of Private Cargo Registration Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Card 1: Route & Locations */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-4 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <MapPin size={15} /> Pickup & Drop-off Route
              </h4>
              <span className="text-xs text-slate-400">Domestic</span>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">
                  Pickup Location (Loading Point) <span className="text-red-400">*</span>
                </label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.pickupDestination || formData.pol || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateExtractedData('pickupDestination', val);
                    setFormData(prev => ({ ...prev, pol: val }));
                  }}
                  placeholder="e.g. Karachi Port / Industrial Area"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">
                  Drop-off Location (Delivery Point) <span className="text-red-400">*</span>
                </label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.dropoffDestination || formData.pod || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateExtractedData('dropoffDestination', val);
                    setFormData(prev => ({ ...prev, pod: val }));
                  }}
                  placeholder="e.g. Faisalabad Mills / Lahore Warehouse"
                />
              </div>
            </div>
          </div>

          {/* Card 2: Cargo Owner Details */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-4 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <User size={15} /> Cargo Owner / Consignor
              </h4>
              <span className="text-xs text-slate-400">Shipper</span>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">
                  Cargo Owner Name <span className="text-red-400">*</span>
                </label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.cargoOwner || extracted.shipperName || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateExtractedData('cargoOwner', val);
                    updateExtractedData('shipperName', val);
                  }}
                  placeholder="e.g. Haji Muhammad Textile Trading"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1.5">Contact No</label>
                  <input 
                    type="text"
                    className="w-full h-10 rounded-xl px-3 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none font-mono"
                    value={extracted.cargoOwnerContact || extracted.shipperContact || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateExtractedData('cargoOwnerContact', val);
                      updateExtractedData('shipperContact', val);
                    }}
                    placeholder="0300-1234567"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1.5">CNIC / NTN</label>
                  <input 
                    type="text"
                    className="w-full h-10 rounded-xl px-3 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none font-mono"
                    value={extracted.cargoOwnerCnic || ''}
                    onChange={(e) => updateExtractedData('cargoOwnerCnic', e.target.value)}
                    placeholder="42101-xxxxxxx-x"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Consignment Note & Waybill Details */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-4 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <FileText size={15} /> Waybill & Terms
              </h4>
              <span className="text-xs text-slate-400">Builty Info</span>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">
                  Waybill / Builty Number <span className="text-red-400">*</span>
                </label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm font-mono font-bold text-amber-300 border border-amber-500/30 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.builtyNumber || extracted.blNumber || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateExtractedData('builtyNumber', val);
                    updateExtractedData('blNumber', val);
                  }}
                  placeholder="e.g. BLT-2025-9821"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1.5">Builty Date</label>
                  <input 
                    type="date"
                    className="w-full h-10 rounded-xl px-3 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                    value={extracted.builtyDate || extracted.blDate || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateExtractedData('builtyDate', val);
                      updateExtractedData('blDate', val);
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1.5">Payment Terms</label>
                  <select 
                    className="w-full h-10 rounded-xl px-2.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                    value={extracted.paymentTerms || 'To-Pay'}
                    onChange={(e) => updateExtractedData('paymentTerms', e.target.value)}
                  >
                    <option value="To-Pay">To-Pay</option>
                    <option value="Paid">Paid (Prepaid)</option>
                    <option value="Advance">Advance Paid</option>
                    <option value="COD">Cash on Delivery</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Container & Security Seal */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-4 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Box size={15} /> Container & Seal
              </h4>
              <span className="text-xs text-slate-400">Optional</span>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Container Number</label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm font-mono text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none uppercase"
                  value={extracted.containerNo || formData.containers?.[0]?.number || ''}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    updateExtractedData('containerNo', val);
                    if (formData.containers.length > 0) {
                      setFormData(prev => ({
                        ...prev,
                        containers: prev.containers.map((c, idx) => idx === 0 ? { ...c, number: val } : c)
                      }));
                    } else if (val) {
                      setFormData(prev => ({
                        ...prev,
                        containers: [{ id: Date.now(), number: val, size: '40ft', weight: extracted.grossWeight || 0, sealNo: extracted.sealNo || '', status: 'Pending' }]
                      }));
                    }
                  }}
                  placeholder="e.g. MSKU1234567 or Open Truck"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Seal Number</label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm font-mono text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.sealNo || formData.containers?.[0]?.sealNo || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateExtractedData('sealNo', val);
                    if (formData.containers.length > 0) {
                      setFormData(prev => ({
                        ...prev,
                        containers: prev.containers.map((c, idx) => idx === 0 ? { ...c, sealNo: val } : c)
                      }));
                    }
                  }}
                  placeholder="e.g. SL-984120"
                />
              </div>
            </div>
          </div>

          {/* Card 5: Vehicle & Driver Information */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-4 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Truck size={15} /> Vehicle & Driver
              </h4>
              <span className="text-xs text-slate-400">Carrier Info</span>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Vehicle / Truck Registration No</label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm font-mono text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none uppercase"
                  value={extracted.vehicleNumber || ''}
                  onChange={(e) => updateExtractedData('vehicleNumber', e.target.value.toUpperCase())}
                  placeholder="e.g. TLA-492"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1.5">Driver Name</label>
                  <input 
                    type="text"
                    className="w-full h-10 rounded-xl px-2.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                    value={extracted.driverName || ''}
                    onChange={(e) => updateExtractedData('driverName', e.target.value)}
                    placeholder="Name"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1.5">Mobile</label>
                  <input 
                    type="text"
                    className="w-full h-10 rounded-xl px-2.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none font-mono"
                    value={extracted.driverContact || ''}
                    onChange={(e) => updateExtractedData('driverContact', e.target.value)}
                    placeholder="03xx-xxxxxxx"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1.5">CNIC</label>
                  <input 
                    type="text"
                    className="w-full h-10 rounded-xl px-2.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none font-mono"
                    value={extracted.driverCnic || ''}
                    onChange={(e) => updateExtractedData('driverCnic', e.target.value)}
                    placeholder="CNIC No"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 6: Consignee / Receiver Information */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-4 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Building size={15} /> Consignee / Receiver
              </h4>
              <span className="text-xs text-slate-400">Recipient</span>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Consignee Name</label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.consigneeName || ''}
                  onChange={(e) => updateExtractedData('consigneeName', e.target.value)}
                  placeholder="e.g. Al-Madina Weaving Mills Ltd"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1.5">Receiver Contact</label>
                  <input 
                    type="text"
                    className="w-full h-10 rounded-xl px-3 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none font-mono"
                    value={extracted.consigneeContact || ''}
                    onChange={(e) => updateExtractedData('consigneeContact', e.target.value)}
                    placeholder="03xx-xxxxxxx"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1.5">Delivery Address</label>
                  <input 
                    type="text"
                    className="w-full h-10 rounded-xl px-3 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                    value={extracted.consigneeAddress || ''}
                    onChange={(e) => updateExtractedData('consigneeAddress', e.target.value)}
                    placeholder="City / Zone"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 7: Cargo Specifications & Commodities */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-4 lg:col-span-3 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Package size={15} /> Cargo Specifications & Weight
              </h4>
              <span className="text-xs text-slate-400">Packaging & Weight</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
              <div className="lg:col-span-2">
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Commodity Description</label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.itemName || ''}
                  onChange={(e) => updateExtractedData('itemName', e.target.value)}
                  placeholder="e.g. Cotton Yarn Cones / Steel Coils"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Packaging Type</label>
                <input 
                  type="text"
                  className="w-full h-10 rounded-xl px-3.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.packagingType || 'Bags / Bundles'}
                  onChange={(e) => updateExtractedData('packagingType', e.target.value)}
                  placeholder="Bags, Cartons, Crates"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Total Packages</label>
                <input 
                  type="number"
                  className="w-full h-10 rounded-xl px-3.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none font-mono"
                  value={extracted.packageCount || ''}
                  onChange={(e) => updateExtractedData('packageCount', parseFloat(e.target.value))}
                  placeholder="e.g. 400"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Gross Weight (KG)</label>
                <input 
                  type="number"
                  className="w-full h-10 rounded-xl px-3.5 text-sm font-mono text-emerald-400 font-bold border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.grossWeight || extracted.totalWeight || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateExtractedData('grossWeight', val);
                    updateExtractedData('totalWeight', val);
                  }}
                  placeholder="e.g. 24000"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Cargo Document Upload Section */}
        <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <UploadCloud size={16} /> Attached Cargo Documents (Consignment Waybill, Weighbridge Slip, Delivery Note)
            </h4>
            <span className="text-xs text-slate-400 font-mono">
              {uploadedDocs.length} {uploadedDocs.length === 1 ? 'file' : 'files'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {uploadedDocs.map((doc, docIdx) => (
              <div key={`up_doc_${doc.id || docIdx}_${docIdx}`} className="p-3 bg-slate-950 border border-white/10 rounded-xl flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20">
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{doc.name}</p>
                    <p className="text-[11px] text-slate-400">{(doc.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setLightboxImage(doc.url)}
                    className="h-8 w-8 flex items-center justify-center text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                    title="View Document"
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedDocs(prev => {
                        const updated = prev.filter(d => d.id !== doc.id);
                        safeAppStorage.setJSON('dpl_reg_docs', updated);
                        return updated;
                      });
                      setFiles(prev => prev.filter(f => f.name !== doc.name));
                    }}
                    className="h-8 w-8 flex items-center justify-center text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer"
                    title="Remove File"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            {/* Quick Upload Button */}
            <label className="h-14 px-4 border border-dashed border-amber-500/40 hover:border-amber-400 bg-amber-500/5 hover:bg-amber-500/10 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors text-amber-300 text-xs font-semibold">
              <Plus size={16} />
              <span>Attach Document</span>
              <input 
                type="file" 
                multiple 
                className="hidden" 
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    processFiles(Array.from(e.target.files));
                  }
                }}
              />
            </label>
          </div>
        </div>

        {/* Operational Logistics Services & Charges */}
        {renderServiceArrangementsSection(false)}
      </div>
    );
  };

  const renderStep5_DataReview = () => {
    const extracted = formData.extractedData || {};
    const autoFilledCount = Object.entries(extracted).filter(([k, v]) => k !== 'containers' && v !== undefined && v !== null && String(v).trim() !== '').length;

    const isPrivateCargo = formData.category === 'Transportation of Private Cargo' || formData.category?.toLowerCase().includes('private');
    if (isPrivateCargo) {
      return renderPrivateCargoRegistrationReview(extracted, autoFilledCount);
    }

    const firstContainer = formData.containers?.[0];

    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
        {/* Step 2 Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-white/15 shadow-md">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
              <FileCheck size={20} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white">Step 2: Review Extracted Shipment & Cargo Details</h3>
                <span className="text-xs font-mono font-semibold text-emerald-300 bg-emerald-500/15 px-2.5 py-0.5 rounded-lg border border-emerald-500/30">
                  {autoFilledCount} Fields Populated
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                All fields extracted from B/L, GD-I/TP, Commercial Invoice, Packing List, PCCSS Form &quot;A&quot;, Transport Note, and WeBOC are populated below.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {(uploadedDocs.length > 0 || files.length > 0) && (
              <button
                type="button"
                onClick={() => triggerDocumentReading(undefined, true)}
                disabled={isReadingDocuments}
                className="h-9 px-3.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                title="Re-read the currently uploaded document and refresh all fields"
              >
                <RefreshCw size={14} className={isReadingDocuments ? 'animate-spin text-amber-400' : 'text-amber-400'} />
                <span>{isReadingDocuments ? 'Reading...' : 'Read Again'}</span>
              </button>
            )}
            <label
              className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/30 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
              title="Upload the file again directly here to re-read and populate all fields"
            >
              <UploadCloud size={14} className="text-white" />
              <span>{isReadingDocuments || isAttachingFiles ? 'Reading File...' : 'Upload Again & Read'}</span>
              <input
                type="file"
                multiple
                accept="*/*"
                onChange={(e) => handleFileUpload(e, true)}
                className="hidden"
              />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Group 1: Parties Involved */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-4 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <User size={15} /> 1. Parties Involved
              </h4>
              <span className="text-xs text-slate-400">Client, Shipper, Consignee & Agent</span>
            </div>

            {/* Registered Client Selector (Strictly separate from B/L Consignee) */}
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-amber-300 font-bold flex items-center gap-1.5">
                  <User size={13} className="text-amber-400" />
                  <span>Registered Client Name <span className="text-red-400">*</span></span>
                </label>
                <span className="text-[11px] text-slate-300">Billing Client</span>
              </div>
              {isClientUser ? (
                <div className="text-sm font-bold text-white px-3 py-2 rounded-lg bg-slate-950 border border-emerald-500/30">
                  {formData.client || effectiveClientName}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 h-10 rounded-xl px-3 text-sm text-white bg-slate-950 border border-amber-500/40 focus:border-amber-400 outline-none cursor-pointer"
                    value={formData.client}
                    onChange={(e) => {
                      if (e.target.value === '__ADD_NEW_CLIENT__') {
                        setShowAddClientModal(true);
                      } else {
                        handleClientSelect(e.target.value);
                      }
                    }}
                  >
                    <option value="" className="bg-slate-900 text-slate-400">-- Select Registered Client --</option>
                    {registeredClients.map(c => (
                      <option key={c} value={c} className="bg-slate-900 text-white">{c}</option>
                    ))}
                    <option value="__ADD_NEW_CLIENT__" className="bg-slate-900 text-amber-300 font-semibold">
                      + Add New Client...
                    </option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddClientModal(true)}
                    className="h-10 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 cursor-pointer"
                    title="Add New Client"
                  >
                    + New
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-slate-300 font-semibold">Shipper Name</label>
                  {extracted.shipperName && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-0.5"><CheckCircle size={10} /> Auto-filled</span>
                  )}
                </div>
                <input 
                  className={`w-full h-10 rounded-xl px-3.5 text-sm text-white transition-colors outline-none border ${
                    extracted.shipperName ? 'border-emerald-500/40 bg-emerald-950/15 focus:border-emerald-400' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.shipperName || ''} 
                  onChange={(e) => updateExtractedData('shipperName', e.target.value)} 
                  placeholder="Enter Shipper Name..." 
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Shipper Address</label>
                <textarea 
                  className={`w-full rounded-xl p-3 text-sm h-16 text-white transition-colors outline-none border resize-none ${
                    extracted.shipperAddress ? 'border-emerald-500/40 bg-emerald-950/15 focus:border-emerald-400' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.shipperAddress || ''} 
                  onChange={(e) => updateExtractedData('shipperAddress', e.target.value)} 
                  placeholder="Enter Shipper Address..." 
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">Shipper Contact</label>
                  <input 
                    className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                      extracted.shipperContact ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                    }`} 
                    value={extracted.shipperContact || ''} 
                    onChange={(e) => updateExtractedData('shipperContact', e.target.value)} 
                    placeholder="Phone No." 
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">Shipper Email</label>
                  <input 
                    className="w-full h-10 rounded-xl px-3 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none" 
                    value={extracted.shipperEmail || ''} 
                    onChange={(e) => updateExtractedData('shipperEmail', e.target.value)} 
                    placeholder="Email" 
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-white/10">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-slate-300 font-semibold">Consignee / Importer Name</label>
                  {extracted.consigneeName && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-0.5"><CheckCircle size={10} /> Auto-filled</span>
                  )}
                </div>
                <input 
                  className={`w-full h-10 rounded-xl px-3.5 text-sm text-white transition-colors outline-none border ${
                    extracted.consigneeName ? 'border-emerald-500/40 bg-emerald-950/15 focus:border-emerald-400' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.consigneeName || ''} 
                  onChange={(e) => updateExtractedData('consigneeName', e.target.value)} 
                  placeholder="Enter Consignee Name..." 
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Consignee Address</label>
                <textarea 
                  className={`w-full rounded-xl p-3 text-sm h-16 text-white transition-colors outline-none border resize-none ${
                    extracted.consigneeAddress ? 'border-emerald-500/40 bg-emerald-950/15 focus:border-emerald-400' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.consigneeAddress || ''} 
                  onChange={(e) => updateExtractedData('consigneeAddress', e.target.value)} 
                  placeholder="Enter Consignee Address..." 
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">Consignee Contact</label>
                  <input 
                    className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                      extracted.consigneeContact ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                    }`} 
                    value={extracted.consigneeContact || ''} 
                    onChange={(e) => updateExtractedData('consigneeContact', e.target.value)} 
                    placeholder="Phone No." 
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">Consignee Email</label>
                  <input 
                    className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                      extracted.consigneeEmail ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                    }`} 
                    value={extracted.consigneeEmail || ''} 
                    onChange={(e) => updateExtractedData('consigneeEmail', e.target.value)} 
                    placeholder="Email" 
                  />
                </div>
              </div>

              {/* NTN, STRN & Clearing Agent */}
              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-white/10">
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">Importer NTN No.</label>
                  <input 
                    className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                      extracted.ntnNumber ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                    }`} 
                    value={extracted.ntnNumber || ''} 
                    onChange={(e) => updateExtractedData('ntnNumber', e.target.value)} 
                    placeholder="NTN Number" 
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">STRN Number</label>
                  <input 
                    className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                      extracted.strnNumber ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                    }`} 
                    value={extracted.strnNumber || ''} 
                    onChange={(e) => updateExtractedData('strnNumber', e.target.value)} 
                    placeholder="STRN Number" 
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-slate-300 font-semibold">Clearing / Forwarding Agent</label>
                  {extracted.clearingAgent && <span className="text-[11px] text-emerald-400">✓</span>}
                </div>
                <input 
                  className={`w-full h-10 rounded-xl px-3.5 text-sm text-white outline-none border ${
                    extracted.clearingAgent ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.clearingAgent || ''} 
                  onChange={(e) => updateExtractedData('clearingAgent', e.target.value)} 
                  placeholder="Clearing Agent & License No." 
                />
              </div>
            </div>
          </div>

          {/* Group 2: Shipping Line & B/L Details */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-3.5 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Ship size={15} /> 2. Bill of Lading & Route
              </h4>
              <span className="text-xs text-sky-300 font-mono bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">
                B/L & GD-I
              </span>
            </div>

            {/* Bill of Lading */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-slate-300 font-semibold">B/L Number</label>
                  {extracted.blNumber && <span className="text-[11px] text-emerald-400">✓</span>}
                </div>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                    extracted.blNumber ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.blNumber || ''} 
                  onChange={(e) => updateExtractedData('blNumber', e.target.value)} 
                  placeholder="SWA0463766"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">B/L Date</label>
                <input 
                  type="date" 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.blDate ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.blDate || ''} 
                  onChange={(e) => updateExtractedData('blDate', e.target.value)} 
                />
              </div>
            </div>

            {/* Shipping Line & Agent */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Shipping Line</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.shippingLine ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.shippingLine || ''} 
                  onChange={(e) => updateExtractedData('shippingLine', e.target.value)} 
                  placeholder="Shipping Line"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Shipping Agent</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.shippingAgent ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.shippingAgent || ''} 
                  onChange={(e) => updateExtractedData('shippingAgent', e.target.value)} 
                  placeholder="Agent Name"
                />
              </div>
            </div>

            {/* Vessel Name & Voyage No */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Vessel Name</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.vesselName ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.vesselName || ''} 
                  onChange={(e) => updateExtractedData('vesselName', e.target.value)} 
                  placeholder="e.g. XIN LONG YUN 86"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Voyage No.</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                    extracted.voyageNo ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.voyageNo || ''} 
                  onChange={(e) => updateExtractedData('voyageNo', e.target.value)} 
                  placeholder="e.g. 2627W"
                />
              </div>
            </div>

            {/* POL & POD */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Port of Loading (POL)</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.pol ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.pol || ''} 
                  onChange={(e) => updateExtractedData('pol', e.target.value)} 
                  placeholder="Port of Loading"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Port of Discharge (POD)</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.pod ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.pod || ''} 
                  onChange={(e) => updateExtractedData('pod', e.target.value)} 
                  placeholder="Port of Discharge"
                />
              </div>
            </div>

            {/* Place of Delivery / Final Dry Port */}
            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Place of Delivery / Destination Dry Port</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                  extracted.placeOfDelivery ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.placeOfDelivery || ''} 
                onChange={(e) => updateExtractedData('placeOfDelivery', e.target.value)} 
                placeholder="e.g. LAHORE DRY PORT / MUGHALPURA"
              />
            </div>

            {/* Free Days & Freight Terms */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Demurrage Free Days</label>
                <input 
                  type="number"
                  className="w-full h-10 rounded-xl px-3 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none font-mono" 
                  value={extracted.freeDays || ''} 
                  onChange={(e) => updateExtractedData('freeDays', parseInt(e.target.value) || 0)} 
                  placeholder="14"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Freight Terms</label>
                <select
                  className="w-full h-10 rounded-xl px-3 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.freightTerms || 'Prepaid'}
                  onChange={(e) => updateExtractedData('freightTerms', e.target.value)}
                >
                  <option value="Prepaid">Prepaid</option>
                  <option value="Collect">Collect</option>
                  <option value="Payable at Destination">Payable at Destination</option>
                </select>
              </div>
            </div>

            {/* Goods Declaration (GD/TP) & IGM */}
            <div className="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-white/10">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">GD / TP Number</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                    extracted.gdNo ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.gdNo || ''} 
                  onChange={(e) => updateExtractedData('gdNo', e.target.value)} 
                  placeholder="KAPS-TP-52611-24-09-2026"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">GD / TP Date</label>
                <input 
                  type="date" 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.gdDate ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.gdDate || ''} 
                  onChange={(e) => updateExtractedData('gdDate', e.target.value)} 
                />
              </div>
            </div>

            {/* IGM No, IGM Date & Index No */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">IGM No</label>
                <input 
                  className={`w-full h-10 rounded-xl px-2.5 text-sm text-white font-mono outline-none border ${
                    extracted.igmNo ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.igmNo || ''} 
                  onChange={(e) => updateExtractedData('igmNo', e.target.value)} 
                  placeholder="IGM No"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">IGM Date</label>
                <input 
                  type="date"
                  className={`w-full h-10 rounded-xl px-2 text-xs text-white outline-none border ${
                    extracted.igmDate ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.igmDate || ''} 
                  onChange={(e) => updateExtractedData('igmDate', e.target.value)} 
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Index No</label>
                <input 
                  className={`w-full h-10 rounded-xl px-2.5 text-sm text-white font-mono outline-none border ${
                    extracted.indexNo ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.indexNo || ''} 
                  onChange={(e) => updateExtractedData('indexNo', e.target.value)} 
                  placeholder="Index"
                />
              </div>
            </div>
          </div>

          {/* Group 3: Commercial Invoice & Packing Specifications */}
          <div className="rounded-2xl border border-white/15 bg-slate-900/90 p-5 space-y-3.5 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h4 className="text-amber-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Receipt size={15} /> 3. Commercial Invoice & Cargo
              </h4>
              <span className="text-xs text-amber-300 font-mono bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                Manifest & GD
              </span>
            </div>

            {/* Commercial Invoice No & Date */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Commercial Invoice No.</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border font-mono ${
                    extracted.invoiceNo ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.invoiceNo || ''} 
                  onChange={(e) => updateExtractedData('invoiceNo', e.target.value)} 
                  placeholder="SP260807AZ03"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Invoice Date</label>
                <input 
                  type="date" 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.invoiceDate ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.invoiceDate || ''} 
                  onChange={(e) => updateExtractedData('invoiceDate', e.target.value)} 
                />
              </div>
            </div>

            {/* Invoice Value & Currency */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="col-span-2">
                <label className="text-xs text-slate-300 font-semibold block mb-1">Invoice Value</label>
                <input 
                  type="number" 
                  step="0.01"
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                    extracted.invoiceValue ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.invoiceValue || ''} 
                  onChange={(e) => updateExtractedData('invoiceValue', parseFloat(e.target.value))} 
                  placeholder="Total amount"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Currency</label>
                <select
                  className="w-full h-10 rounded-xl px-2.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.invoiceCurrency || 'USD'}
                  onChange={(e) => updateExtractedData('invoiceCurrency', e.target.value)}
                >
                  <option value="USD">USD ($)</option>
                  <option value="PKR">PKR (Rs)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="CNY">CNY (¥)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="AED">AED</option>
                </select>
              </div>
            </div>

            {/* Payment Terms & Endorsing Bank */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Payment Terms</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.paymentTerms ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.paymentTerms || ''} 
                  onChange={(e) => updateExtractedData('paymentTerms', e.target.value)} 
                  placeholder="e.g. D/P (Documents against Payment)"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Bank Name</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.bankName ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.bankName || ''} 
                  onChange={(e) => updateExtractedData('bankName', e.target.value)} 
                  placeholder="e.g. HabibMetro Bank"
                />
              </div>
            </div>

            {/* Incoterms & HS Code */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Incoterms</label>
                <select
                  className="w-full h-10 rounded-xl px-2.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.incoTerms || 'CFR'}
                  onChange={(e) => updateExtractedData('incoTerms', e.target.value)}
                >
                  <option value="CFR">CFR — Cost & Freight</option>
                  <option value="CIF">CIF — Cost, Insurance & Freight</option>
                  <option value="FOB">FOB — Free on Board</option>
                  <option value="EXW">EXW — Ex Works</option>
                  <option value="DDP">DDP — Delivered Duty Paid</option>
                  <option value="CIP">CIP — Carriage & Insurance</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">HS / PCT Code</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                    extracted.hsCode ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.hsCode || ''} 
                  onChange={(e) => updateExtractedData('hsCode', e.target.value)} 
                  placeholder="e.g. 9503.0090"
                />
              </div>
            </div>

            {/* Item Name / Description */}
            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Cargo Description</label>
              <input 
                className={`w-full h-10 rounded-xl px-3.5 text-sm text-white outline-none border ${
                  extracted.itemName ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`}
                value={extracted.itemName || ''} 
                onChange={(e) => updateExtractedData('itemName', e.target.value)} 
                placeholder="Description of goods..."
              />
            </div>

            {/* Packing List: Packaging & Count */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Packaging Type</label>
                <input 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                    extracted.packagingType ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.packagingType || ''} 
                  onChange={(e) => updateExtractedData('packagingType', e.target.value)} 
                  placeholder="Cartons, Pallets, Drums"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">No. of Packages</label>
                <input 
                  type="number" 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                    extracted.packageCount ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.packageCount || ''} 
                  onChange={(e) => updateExtractedData('packageCount', parseFloat(e.target.value))} 
                  placeholder="e.g. 649"
                />
              </div>
            </div>

            {/* Packing List: Gross Weight, Net Weight & Volume CBM */}
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1 truncate">Gross Wt (KG)</label>
                <input 
                  type="number" 
                  className={`w-full h-10 rounded-xl px-2.5 text-sm text-emerald-400 font-mono font-bold outline-none border ${
                    (extracted.grossWeight || extracted.totalWeight) ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`}
                  value={extracted.grossWeight || extracted.totalWeight || ''} 
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateExtractedData('grossWeight', val);
                    updateExtractedData('totalWeight', val);
                  }} 
                  placeholder="Gross KG"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1 truncate">Net Wt (KG)</label>
                <input 
                  type="number" 
                  className={`w-full h-10 rounded-xl px-2.5 text-sm text-white font-mono outline-none border ${
                    extracted.netWeight ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.netWeight || ''} 
                  onChange={(e) => updateExtractedData('netWeight', parseFloat(e.target.value))} 
                  placeholder="Net KG"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1 truncate">Volume (CBM)</label>
                <input 
                  type="number" 
                  step="0.01"
                  className={`w-full h-10 rounded-xl px-2.5 text-sm text-white font-mono outline-none border ${
                    extracted.volumeCBM ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.volumeCBM || ''} 
                  onChange={(e) => updateExtractedData('volumeCBM', parseFloat(e.target.value))} 
                  placeholder="68.0"
                />
              </div>
            </div>

            {/* GD-I Assessed Value & Customs Duty/Taxes (PKR) */}
            <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-white/10">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1 truncate">Assessed Value (PKR)</label>
                <input 
                  type="number" 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                    extracted.assessedValuePkr ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.assessedValuePkr || ''} 
                  onChange={(e) => updateExtractedData('assessedValuePkr', parseFloat(e.target.value))} 
                  placeholder="Assessed Value PKR"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1 truncate">Duty & Taxes (PKR)</label>
                <input 
                  type="number" 
                  className={`w-full h-10 rounded-xl px-3 text-sm text-amber-300 font-mono font-bold outline-none border ${
                    extracted.totalDutyTaxesPkr ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.totalDutyTaxesPkr || ''} 
                  onChange={(e) => updateExtractedData('totalDutyTaxesPkr', parseFloat(e.target.value))} 
                  placeholder="Total Duty/Taxes PKR"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Group 4: Bonded Carrier, Vehicle, Driver & PCCSS Customs Sealing (Form "A" / Transport Note / WeBOC) */}
        <div className="rounded-2xl border border-emerald-500/30 bg-slate-900/90 p-5 space-y-4 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-2.5">
            <h4 className="text-emerald-400 text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <Truck size={16} /> 4. Bonded Carrier, Vehicle, Driver & Customs Sealing (PCCSS Form &quot;A&quot; / Transport Note / WeBOC)
            </h4>
            <span className="text-xs text-emerald-300 font-mono bg-emerald-500/15 px-2.5 py-0.5 rounded border border-emerald-500/30 self-start sm:self-auto">
              Auto-Synced with Container Manifest
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Bonded Carrier Name</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                  extracted.carrierName ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.carrierName || ''} 
                onChange={(e) => updateExtractedData('carrierName', e.target.value)} 
                placeholder="DYNAMIC PRIVATE LIMITED"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Container Number</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono font-bold outline-none border ${
                  (extracted.containerNo || firstContainer?.number) ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.containerNo || firstContainer?.number || ''} 
                onChange={(e) => updateExtractedData('containerNo', e.target.value)} 
                placeholder="TEMU8045938"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Container Size & Tare Wt</label>
              <div className="grid grid-cols-2 gap-2">
                <select 
                  className="h-10 rounded-xl px-2.5 text-sm text-white border border-white/15 bg-slate-950 focus:border-amber-400 outline-none"
                  value={extracted.containerSize || firstContainer?.size || '40ft'}
                  onChange={(e) => updateExtractedData('containerSize', e.target.value)}
                >
                  <option value="20ft">20ft</option>
                  <option value="40ft">40ft</option>
                  <option value="45ft">45ft</option>
                </select>
                <input 
                  type="number"
                  className={`h-10 rounded-xl px-2.5 text-sm text-white font-mono outline-none border ${
                    extracted.tareWeight ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                  }`} 
                  value={extracted.tareWeight || firstContainer?.tareWeight || ''} 
                  onChange={(e) => updateExtractedData('tareWeight', parseFloat(e.target.value))} 
                  placeholder="Tare KG"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Vehicle / Truck Reg No.</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-amber-300 font-mono font-bold outline-none border ${
                  (extracted.vehicleNumber || firstContainer?.vehicleNo) ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.vehicleNumber || firstContainer?.vehicleNo || ''} 
                onChange={(e) => updateExtractedData('vehicleNumber', e.target.value)} 
                placeholder="TMT400"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Driver Name (Form-A)</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                  (extracted.driverName || firstContainer?.driverName) ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.driverName || firstContainer?.driverName || ''} 
                onChange={(e) => updateExtractedData('driverName', e.target.value)} 
                placeholder="IMRAN KHAN"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Driver CNIC No.</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                  (extracted.driverCnic || firstContainer?.driverCnic) ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.driverCnic || firstContainer?.driverCnic || ''} 
                onChange={(e) => updateExtractedData('driverCnic', e.target.value)} 
                placeholder="2120358707593"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">CCSU / Customs Seal No.</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-emerald-300 font-mono font-bold outline-none border ${
                  (extracted.sealNo || extracted.ccsuSealNo || firstContainer?.seal) ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.sealNo || extracted.ccsuSealNo || firstContainer?.seal || ''} 
                onChange={(e) => updateExtractedData('sealNo', e.target.value)} 
                placeholder="N9622854"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Shipper / Line Seal No.</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                  (extracted.shipperSealNo || firstContainer?.shipperSealNo) ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.shipperSealNo || firstContainer?.shipperSealNo || ''} 
                onChange={(e) => updateExtractedData('shipperSealNo', e.target.value)} 
                placeholder="SN26973873"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">PCCSS Form &quot;A&quot; Serial No.</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                  extracted.serialNo ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.serialNo || ''} 
                onChange={(e) => updateExtractedData('serialNo', e.target.value)} 
                placeholder="SAPT/103497"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Sealing Date & Time</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                  extracted.sealingDate ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.sealingDate || ''} 
                onChange={(e) => updateExtractedData('sealingDate', e.target.value)} 
                placeholder="2026-09-26"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">PCCSS / CCSU Officer</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white outline-none border ${
                  extracted.pccssOfficer ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.pccssOfficer || ''} 
                onChange={(e) => updateExtractedData('pccssOfficer', e.target.value)} 
                placeholder="ZULFIQAR ALI ZARDARI"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1">Terminal CFD No.</label>
              <input 
                className={`w-full h-10 rounded-xl px-3 text-sm text-white font-mono outline-none border ${
                  extracted.cfdNo ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-white/15 bg-slate-950 focus:border-amber-400'
                }`} 
                value={extracted.cfdNo || ''} 
                onChange={(e) => updateExtractedData('cfdNo', e.target.value)} 
                placeholder="SAPT-CFD-10644-26-09-2026"
              />
            </div>
          </div>
        </div>

        {/* Operational Logistics Services & Charges (Arranged by Company vs Client) */}
        {renderServiceArrangementsSection(false)}
      </div>
    );
  };

  const renderStep6_Containers = () => (
    <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-white/15 shadow-md">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
            <Box size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-bold text-white">Step 3: Containers, Vehicle & Sealing Manifest</h3>
              <span className="text-xs font-mono font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-lg">
                {formData.containers.length} {formData.containers.length === 1 ? 'Container' : 'Containers'}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Verify container numbers, equipment sizes, cargo weights, customs/shipper seal numbers, assigned vehicle, and driver particulars.
            </p>
          </div>
        </div>
        <button 
          type="button"
          onClick={addContainer}
          className="h-10 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-md transition-all self-start sm:self-auto cursor-pointer"
        >
          <Plus size={16} />
          <span>Add Container</span>
        </button>
      </div>
      
      {/* Mobile View (Cards) */}
      <div className="block sm:hidden space-y-3.5">
        {formData.containers.map((c: any, index: number) => (
          <div key={`cntr_card_${c.id || index}_${index}`} className="rounded-2xl border border-white/15 bg-slate-900/90 p-4 space-y-3.5 shadow-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <span className="text-xs font-mono font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 rounded-lg">
                Container #{index + 1}
              </span>
              <button 
                type="button"
                onClick={() => removeContainer(c.id)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/15 transition-colors cursor-pointer"
                title="Remove container"
              >
                <Trash2 size={15} />
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-300 font-semibold block mb-1.5">Container Number</label>
              <input 
                type="text" 
                placeholder="e.g. TEMU8045938"
                value={c.number} 
                onChange={(e) => updateContainer(c.id, 'number', e.target.value)}
                className="w-full h-10 rounded-xl px-3.5 bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Size</label>
                <select 
                  value={c.size} 
                  onChange={(e) => updateContainer(c.id, 'size', e.target.value)}
                  className="w-full h-10 rounded-xl px-3 bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white"
                >
                  <option value="20ft">20ft Standard</option>
                  <option value="40ft">40ft High Cube</option>
                  <option value="45ft">45ft</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Weight (KG)</label>
                <input 
                  type="number" 
                  placeholder="0"
                  value={c.weight} 
                  onChange={(e) => updateContainer(c.id, 'weight', parseFloat(e.target.value) || 0)}
                  className="w-full h-10 rounded-xl px-3 bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-emerald-400 font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">CCSU / Customs Seal</label>
                <input 
                  type="text" 
                  placeholder="e.g. N9622854"
                  value={c.seal || c.sealNo || ''} 
                  onChange={(e) => updateContainer(c.id, 'seal', e.target.value)}
                  className="w-full h-10 rounded-xl px-3 bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-emerald-300 font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Shipper Seal No</label>
                <input 
                  type="text" 
                  placeholder="e.g. SN26973873"
                  value={c.shipperSealNo || ''} 
                  onChange={(e) => updateContainer(c.id, 'shipperSealNo', e.target.value)}
                  className="w-full h-10 rounded-xl px-3 bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Vehicle No</label>
                <input 
                  type="text" 
                  placeholder="TMT400"
                  value={c.vehicleNo || ''} 
                  onChange={(e) => updateContainer(c.id, 'vehicleNo', e.target.value)}
                  className="w-full h-10 rounded-xl px-2.5 bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-amber-300 font-mono font-bold"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Driver Name</label>
                <input 
                  type="text" 
                  placeholder="IMRAN KHAN"
                  value={c.driverName || ''} 
                  onChange={(e) => updateContainer(c.id, 'driverName', e.target.value)}
                  className="w-full h-10 rounded-xl px-2.5 bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Driver CNIC</label>
                <input 
                  type="text" 
                  placeholder="2120358707593"
                  value={c.driverCnic || ''} 
                  onChange={(e) => updateContainer(c.id, 'driverCnic', e.target.value)}
                  className="w-full h-10 rounded-xl px-2.5 bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white font-mono"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop View (Table) */}
      <div className="hidden sm:block rounded-2xl border border-white/15 bg-slate-900/90 overflow-hidden overflow-x-auto custom-scrollbar shadow-md">
        <table className="w-full text-left text-sm text-slate-200 min-w-[960px]"> 
          <thead className="bg-slate-950 uppercase text-xs font-bold text-slate-300 border-b border-white/10">
            <tr>
              <th className="py-3.5 px-3 w-12 text-center">#</th>
              <th className="py-3.5 px-3">Container No</th>
              <th className="py-3.5 px-3 w-28">Size</th>
              <th className="py-3.5 px-3 w-36">Gross Wt (KG)</th>
              <th className="py-3.5 px-3 w-36">Customs Seal</th>
              <th className="py-3.5 px-3 w-36">Shipper Seal</th>
              <th className="py-3.5 px-3 w-32">Vehicle No</th>
              <th className="py-3.5 px-3 w-40">Driver Name</th>
              <th className="py-3.5 px-3 w-40">Driver CNIC</th>
              <th className="py-3.5 px-3 w-16 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {formData.containers.map((c: any, index: number) => (
              <tr key={`cntr_row_${c.id || index}_${index}`} className="hover:bg-white/[0.03] transition-colors">
                <td className="p-3 text-center text-slate-400 font-mono text-xs font-bold">{index + 1}</td>
                <td className="p-3">
                  <input 
                    type="text" 
                    placeholder="e.g. TEMU8045938"
                    value={c.number} 
                    onChange={(e) => updateContainer(c.id, 'number', e.target.value)}
                    className="h-10 rounded-xl px-3 w-full bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white font-mono font-semibold"
                  />
                </td>
                <td className="p-3">
                  <select 
                    value={c.size} 
                    onChange={(e) => updateContainer(c.id, 'size', e.target.value)}
                    className="h-10 rounded-xl px-2.5 w-full bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white"
                  >
                    <option value="20ft">20ft</option>
                    <option value="40ft">40ft</option>
                    <option value="45ft">45ft</option>
                  </select>
                </td>
                <td className="p-3">
                  <input 
                    type="number" 
                    placeholder="0"
                    value={c.weight} 
                    onChange={(e) => updateContainer(c.id, 'weight', parseFloat(e.target.value) || 0)}
                    className="h-10 rounded-xl px-3 w-full bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-emerald-400 font-mono font-bold"
                  />
                </td>
                <td className="p-3">
                  <input 
                    type="text" 
                    placeholder="Customs Seal"
                    value={c.seal || c.sealNo || ''} 
                    onChange={(e) => updateContainer(c.id, 'seal', e.target.value)}
                    className="h-10 rounded-xl px-3 w-full bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-emerald-300 font-mono font-semibold"
                  />
                </td>
                <td className="p-3">
                  <input 
                    type="text" 
                    placeholder="Shipper Seal"
                    value={c.shipperSealNo || ''} 
                    onChange={(e) => updateContainer(c.id, 'shipperSealNo', e.target.value)}
                    className="h-10 rounded-xl px-3 w-full bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white font-mono"
                  />
                </td>
                <td className="p-3">
                  <input 
                    type="text" 
                    placeholder="Vehicle No"
                    value={c.vehicleNo || ''} 
                    onChange={(e) => updateContainer(c.id, 'vehicleNo', e.target.value)}
                    className="h-10 rounded-xl px-3 w-full bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-amber-300 font-mono font-bold"
                  />
                </td>
                <td className="p-3">
                  <input 
                    type="text" 
                    placeholder="Driver Name"
                    value={c.driverName || ''} 
                    onChange={(e) => updateContainer(c.id, 'driverName', e.target.value)}
                    className="h-10 rounded-xl px-3 w-full bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white"
                  />
                </td>
                <td className="p-3">
                  <input 
                    type="text" 
                    placeholder="Driver CNIC"
                    value={c.driverCnic || ''} 
                    onChange={(e) => updateContainer(c.id, 'driverCnic', e.target.value)}
                    className="h-10 rounded-xl px-3 w-full bg-slate-950 border border-white/15 focus:border-amber-400 outline-none text-sm text-white font-mono"
                  />
                </td>
                <td className="p-3 text-center">
                  <button 
                    type="button"
                    onClick={() => removeContainer(c.id)}
                    className="h-9 w-9 mx-auto flex items-center justify-center rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/15 transition-colors cursor-pointer"
                    title="Remove container"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-4 rounded-2xl bg-slate-900/90 border border-white/15 text-xs sm:text-sm text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0">
            <Box size={15} />
          </div>
          <span>
            <strong className="text-white">{formData.containers.length}</strong> container{formData.containers.length === 1 ? '' : 's'} listed in manifest.
          </span>
        </div>
        <span className="font-mono text-sm text-emerald-400 font-bold">
          Total Cargo Weight: {formData.containers.reduce((sum: number, c: any) => sum + (Number(c.weight) || 0), 0).toLocaleString()} KG
        </span>
      </div>
    </div>
  );

  const renderStep7_Submit = () => {
    if (isCaseSubmitted) {
      return (
        <div className="text-center py-10 px-4 animate-in zoom-in duration-300 max-w-2xl mx-auto space-y-6">
          <div className="bg-emerald-500/15 rounded-full w-20 h-20 flex items-center justify-center mx-auto border-2 border-emerald-500/40 shadow-lg">
            <CheckCircle className="text-emerald-400" size={42} />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">Case Registered Successfully!</h2>
            <p className="text-slate-300 text-sm max-w-lg mx-auto">
              The shipment case has been registered and synchronized across all operational portals, manifests, and financial ledgers.
            </p>
          </div>
          
          <div className="rounded-2xl p-6 border border-amber-500/30 bg-slate-900/90 shadow-xl max-w-md mx-auto">
            <p className="text-xs text-slate-400 uppercase mb-1 tracking-wider font-semibold">Registered Case Number</p>
            <p className="text-2xl sm:text-3xl font-mono text-amber-400 font-bold tracking-wider">{submittedCaseData?.caseNo || generatedCaseNo}</p>
            <p className="text-xs text-emerald-400 mt-2 flex items-center justify-center gap-1.5 font-semibold">
              <CheckCircle size={14} /> Status: {submittedCaseData?.status || 'Active'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto pt-2">
            <button 
              type="button"
              onClick={() => {
                if (submittedCaseData) {
                  setSelectedCase(submittedCaseData);
                  setView('details');
                } else {
                  setView('list');
                }
                setIsCaseSubmitted(false);
              }} 
              className="h-11 bg-amber-500 hover:bg-amber-400 text-slate-950 px-5 rounded-xl text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Eye size={16} />
              <span>Open Case Details</span>
            </button>

            <button 
              type="button"
              onClick={handleStartRegistration} 
              className="h-11 bg-emerald-600 hover:bg-emerald-500 text-white px-5 rounded-xl text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus size={16} />
              <span>Register Another Case</span>
            </button>

            <button 
              type="button"
              onClick={() => setShowRegistrationChargeModal(true)} 
              className="h-11 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 px-5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <DollarSign size={16} />
              <span>Add Extra Charges</span>
            </button>

            <button 
              type="button"
              onClick={() => { setView('list'); setStep(1); setIsCaseSubmitted(false); }} 
              className="h-11 bg-slate-800 hover:bg-slate-700 text-slate-200 px-5 rounded-xl text-sm font-semibold transition-colors border border-white/10 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Return to Case List</span>
            </button>
          </div>
        </div>
      );
    }

    // Step 4: Pre-submission Full Case Review
    const currentCharges = formData.charges || [];
    const totalChargesAmount = currentCharges.reduce((sum, ch) => sum + (Number(ch.amount) || 0), 0);
    const compShort = activeCompany?.shortName || 'Company';

    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
        {/* Step 4 Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-white/15 shadow-md">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-xs font-mono uppercase bg-amber-500/15 text-amber-300 px-2.5 py-0.5 rounded-lg border border-amber-500/30 font-semibold">
                Step 4 of 4 • Final Review
              </span>
              <span className="text-xs font-mono text-emerald-300 bg-emerald-500/15 px-2.5 py-0.5 rounded-lg border border-emerald-500/30 font-semibold">
                Ready for Registration
              </span>
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-white">Review Case Summary & Confirm Registration</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Verify route, B/L, GD-I/TP, Bonded Carrier, vehicle/driver, containers, and invoice charges before registering.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setShowRegistrationChargeModal(true)}
              className="h-10 px-4 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 rounded-xl text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus size={15} />
              <span>Add Charge</span>
            </button>
            <button
              type="button"
              onClick={handleFinalSubmit}
              className="h-10 px-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <CheckCircle size={16} />
              <span>Finish & Register</span>
            </button>
          </div>
        </div>

        {/* Section 1: Route & Client Overview */}
        <div className="rounded-2xl p-5 border border-white/15 bg-slate-900/90 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Briefcase size={16} className="text-amber-400" />
              <span>1. Client & Service Route</span>
            </h4>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="h-8 px-3 rounded-lg text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 border border-white/10 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Edit size={12} />
              <span>Edit Route</span>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-1">Registered Client Name</span>
              <span className="text-white font-bold text-sm block truncate">{formData.client || 'Not Selected'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-1">Service Category</span>
              <span className="text-amber-300 font-semibold text-sm block truncate">
                {formData.category}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-1">Port of Loading (POL)</span>
              <span className="text-white font-semibold text-sm flex items-center gap-1.5 truncate">
                <MapPin size={13} className="text-amber-400 shrink-0" /> {formData.pol || 'Karachi Port Trust'}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-1">Port of Destination (POD)</span>
              <span className="text-white font-semibold text-sm flex items-center gap-1.5 truncate">
                <Anchor size={13} className="text-emerald-400 shrink-0" /> {formData.pod || formData.extractedData.placeOfDelivery || 'Not Specified'}
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: Cargo, B/L, GD-I & Bonded Carrier Particulars */}
        <div className="rounded-2xl p-5 border border-white/15 bg-slate-900/90 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <FileText size={16} className="text-amber-400" />
              <span>2. Cargo, B/L, GD-I & Bonded Carrier Particulars</span>
            </h4>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="h-8 px-3 rounded-lg text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 border border-white/10 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Edit size={12} />
              <span>Edit Cargo & Docs</span>
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">B/L or Waybill No</span>
              <span className="text-white font-mono font-bold text-sm">{formData.extractedData.blNumber || 'Pending'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">GD / TP Number</span>
              <span className="text-amber-300 font-mono font-bold text-sm block truncate">{formData.extractedData.gdNo || 'N/A'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">Consignee & NTN</span>
              <span className="text-white font-semibold text-sm block truncate">
                {formData.extractedData.consigneeName || 'Same as Client'}
                {formData.extractedData.ntnNumber ? ` (NTN: ${formData.extractedData.ntnNumber})` : ''}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">Clearing Agent</span>
              <span className="text-white font-semibold text-sm block truncate">{formData.extractedData.clearingAgent || 'N/A'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">Commodity / Cargo</span>
              <span className="text-white font-semibold text-sm block truncate">{formData.extractedData.itemDescription || formData.extractedData.itemName || 'Commercial Freight'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">Total Gross / Net Weight</span>
              <span className="text-emerald-400 font-mono font-bold text-sm">
                {formData.extractedData.totalWeight ? `${formData.extractedData.totalWeight.toLocaleString()} KG` : 'N/A'}
                {formData.extractedData.netWeight ? ` / ${formData.extractedData.netWeight.toLocaleString()} KG` : ''}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">Packages & Volume</span>
              <span className="text-white font-mono text-sm">
                {formData.extractedData.packageCount ? `${formData.extractedData.packageCount} ${formData.extractedData.packagingType || 'Pkgs'}` : 'N/A'}
                {formData.extractedData.volumeCBM ? ` • ${formData.extractedData.volumeCBM} CBM` : ''}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">Vessel / Voyage</span>
              <span className="text-white font-semibold text-sm block truncate">
                {formData.extractedData.vesselName || 'N/A'}
                {formData.extractedData.voyageNo ? ` (${formData.extractedData.voyageNo})` : ''}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">IGM & Index No</span>
              <span className="text-white font-mono text-sm">
                {formData.extractedData.igmNo ? `IGM ${formData.extractedData.igmNo}` : 'N/A'}
                {formData.extractedData.indexNo ? ` / Idx ${formData.extractedData.indexNo}` : ''}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">Commercial Invoice</span>
              <span className="text-white font-mono text-sm block truncate">
                {formData.extractedData.invoiceNo || 'N/A'}
                {formData.extractedData.invoiceValue ? ` (${formData.extractedData.invoiceCurrency || 'USD'} ${formData.extractedData.invoiceValue.toLocaleString()})` : ''}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">Vehicle & Driver (Form-A)</span>
              <span className="text-amber-300 font-mono font-bold text-sm block truncate">
                {formData.extractedData.vehicleNumber || formData.containers?.[0]?.vehicleNo || 'N/A'}
                {formData.extractedData.driverName ? ` • ${formData.extractedData.driverName}` : ''}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5">
              <span className="text-slate-400 block mb-0.5">Customs & Shipper Seal</span>
              <span className="text-emerald-300 font-mono font-bold text-sm block truncate">
                {formData.extractedData.sealNo || formData.extractedData.ccsuSealNo || 'N/A'}
                {formData.extractedData.shipperSealNo ? ` / ${formData.extractedData.shipperSealNo}` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Section 3: Containers Manifest */}
        <div className="rounded-2xl p-5 border border-white/15 bg-slate-900/90 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Box size={16} className="text-amber-400" />
                <span>3. Containers Manifest</span>
              </h4>
              <span className="text-xs font-mono font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-lg">
                {formData.containers.length} {formData.containers.length === 1 ? 'Container' : 'Containers'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="h-8 px-3 rounded-lg text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 border border-white/10 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Edit size={12} />
              <span>Edit Containers</span>
            </button>
          </div>

          {formData.containers.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-2">No containers added yet. Click Edit Containers to add.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-950 border-b border-white/10 text-slate-400 text-xs uppercase font-bold">
                    <th className="py-2.5 px-3.5">#</th>
                    <th className="py-2.5 px-3.5">Container Number</th>
                    <th className="py-2.5 px-3.5">Size</th>
                    <th className="py-2.5 px-3.5">Gross Weight (KG)</th>
                    <th className="py-2.5 px-3.5">Customs Seal</th>
                    <th className="py-2.5 px-3.5">Shipper Seal</th>
                    <th className="py-2.5 px-3.5">Vehicle / Driver</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono bg-slate-950/40">
                  {formData.containers.map((c: any, idx: number) => (
                    <tr key={c.id || idx} className="hover:bg-white/[0.03]">
                      <td className="py-2.5 px-3.5 text-slate-400">{idx + 1}</td>
                      <td className="py-2.5 px-3.5 text-white font-bold">{c.number || 'Pending'}</td>
                      <td className="py-2.5 px-3.5 text-amber-300">{c.size || '40ft'}</td>
                      <td className="py-2.5 px-3.5 text-emerald-400 font-bold">{c.weight ? Number(c.weight).toLocaleString() : '0'}</td>
                      <td className="py-2.5 px-3.5 text-emerald-300 font-semibold">{c.seal || c.sealNo || '—'}</td>
                      <td className="py-2.5 px-3.5 text-slate-300">{c.shipperSealNo || '—'}</td>
                      <td className="py-2.5 px-3.5 text-amber-300">
                        {c.vehicleNo || '—'}{c.driverName ? ` (${c.driverName})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Section 4: Operational Services Arrangement */}
        {renderServiceArrangementsSection(true)}

        {/* Section 4.1: Charges & Invoicing Breakdown */}
        <div className="rounded-2xl p-5 sm:p-6 border border-amber-500/30 bg-slate-900/90 space-y-4 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-white/10 pb-3">
            <div>
              <h4 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <Receipt size={18} className="text-amber-400" />
                <span>Invoice Charges & Estimated Billing Summary</span>
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                Charges synced from {compShort}-arranged services above plus any custom charges. Client-arranged items are excluded.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRegistrationChargeModal(true)}
              className="h-9 px-3.5 text-xs text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-xl transition-colors flex items-center gap-1.5 font-bold shadow-sm self-start sm:self-auto cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Custom Charge</span>
            </button>
          </div>

          {currentCharges.length === 0 ? (
            <div className="p-5 text-center rounded-xl bg-slate-950/70 border border-dashed border-white/15 text-slate-300 text-xs space-y-2.5">
              <p>No invoice charges added yet. Switch any service above to "{compShort}" or add a custom charge item.</p>
              <button
                type="button"
                onClick={() => setShowRegistrationChargeModal(true)}
                className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Plus size={14} />
                <span>Add TP / Service Charge</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {currentCharges.map((ch, cIdx) => {
                const isBonded = normalizeCategoryKey(formData.category) === 'Bonded Carrier';
                const cCount = Math.max(1, formData.containers?.length || 1);
                const unitRate = ch.unitRate !== undefined && ch.unitRate > 0 ? Number(ch.unitRate) : Math.round((Number(ch.amount) || 0) / cCount);
                return (
                <div key={cIdx} className="flex flex-col gap-2 p-3 bg-slate-950/80 border border-white/10 rounded-xl text-xs sm:text-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="w-6 h-6 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center justify-center font-mono text-xs font-bold shrink-0">
                        {cIdx + 1}
                      </span>
                      <span className="text-white font-semibold">{ch.description}</span>
                      {ch.syncKey && (
                        <span className="text-[11px] text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-md border border-emerald-500/30 font-mono">
                          {compShort} Arranged
                        </span>
                      )}
                      {isBonded && (
                        <span className="text-[11px] text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-md border border-amber-500/30 font-mono">
                          PKR {unitRate.toLocaleString()} × {cCount} Container{cCount === 1 ? '' : 's'} = PKR {(Number(ch.amount) || 0).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3">
                      <div className="inline-flex items-center gap-2">
                        <span className="text-xs font-mono text-emerald-400 font-bold">
                          {isBonded ? 'Per Cntr PKR' : 'PKR'}
                        </span>
                        <input
                          type="number"
                          value={isBonded ? (unitRate || '') : (ch.amount ?? '')}
                          onChange={(e) => {
                            const enteredVal = Number(e.target.value) || 0;
                            setFormData(prev => {
                              const updated = [...(prev.charges || [])];
                              if (normalizeCategoryKey(prev.category) === 'Bonded Carrier') {
                                updated[cIdx] = { ...updated[cIdx], unitRate: enteredVal, amount: enteredVal };
                              } else {
                                updated[cIdx] = { ...updated[cIdx], amount: enteredVal };
                              }
                              const scaled = scaleBondedCarrierChargesByContainers(
                                updated,
                                prev.category || 'Bonded Carrier',
                                prev.containers
                              );
                              const syncKey = ch.syncKey;
                              let updatedArr = prev.serviceArrangements;
                              if (syncKey && updatedArr && updatedArr[syncKey]) {
                                updatedArr = {
                                  ...updatedArr,
                                  [syncKey]: { ...updatedArr[syncKey], amount: enteredVal }
                                };
                              }
                              const nextState = { ...prev, charges: scaled, serviceArrangements: updatedArr };
                              safeAppStorage.setJSON('dpl_reg_formdata', nextState);
                              return nextState;
                            });
                          }}
                          className="w-32 h-9 bg-slate-900 border border-emerald-500/40 focus:border-emerald-400 rounded-lg px-3 text-right font-mono font-bold text-emerald-300 text-sm outline-none transition-colors"
                          placeholder="0"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (ch.syncKey) {
                            handleToggleServiceArrangement(ch.syncKey, 'Client');
                          } else {
                            const updated = currentCharges.filter((_, idx) => idx !== cIdx);
                            setFormData(prev => ({ ...prev, charges: updated }));
                          }
                        }}
                        className="h-8 w-8 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/15 rounded-lg transition-colors cursor-pointer"
                        title={ch.syncKey ? "Exclude from invoice (set to Client arranged)" : "Remove charge"}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {isBonded && ch.perContainerBreakdown && (
                    <div className="text-[11px] font-mono text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                      Container Breakdown: {ch.perContainerBreakdown}
                    </div>
                  )}
                </div>
              );
              })}
            </div>
          )}

          <div className="pt-3.5 border-t border-white/10 flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-300">
              Total Estimated Invoice Amount:
            </span>
            <span className="text-lg sm:text-xl font-bold text-amber-400 font-mono">
              PKR {totalChargesAmount.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Section 5: Attached Documents */}
        {uploadedDocs.length > 0 && (
          <div className="rounded-2xl p-4 border border-white/15 bg-slate-900/90 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FileCheck size={18} className="text-emerald-400 shrink-0" />
              <span className="text-xs sm:text-sm text-slate-200 font-medium">
                <strong>{uploadedDocs.length}</strong> Shipping Document{uploadedDocs.length === 1 ? '' : 's'} attached and linked to this case.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white border border-white/10 flex items-center gap-1.5 cursor-pointer"
            >
              <Edit size={12} />
              <span>Manage Docs</span>
            </button>
          </div>
        )}

        {/* Step 4 Action Buttons */}
        <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="h-11 bg-slate-800 hover:bg-slate-700 text-white px-4 rounded-xl text-xs sm:text-sm font-semibold transition-colors border border-white/15 flex items-center gap-2 cursor-pointer"
            >
              <ArrowLeft size={16} />
              <span>Back to Containers</span>
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="h-11 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white px-4 rounded-xl text-xs sm:text-sm font-semibold transition-colors border border-white/10 flex items-center gap-1.5 cursor-pointer"
            >
              <Edit size={14} />
              <span>Edit Case Details</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowRegistrationChargeModal(true)}
              className="h-11 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/35 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus size={15} />
              <span>Add Charge</span>
            </button>
            <button
              type="button"
              onClick={handleFinalSubmit}
              className="h-11 bg-emerald-600 hover:bg-emerald-500 text-white px-6 sm:px-8 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/25 transition-all cursor-pointer"
            >
              <CheckCircle size={17} />
              <span>Finish & Register Case</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {view === 'list' && renderCaseList()}
      {view === 'details' && renderCaseDetails()}
      {view === 'register' && (
        <div className="max-w-6xl mx-auto pb-10 w-full">
          {/* Top Navigation Bar */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <button
              type="button"
              onClick={() => setView('list')}
              className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-slate-200 hover:text-white flex items-center gap-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
            >
              <ArrowLeft size={16} />
              <span>Back to Case List</span>
            </button>
            {generatedCaseNo && (
              <span className="text-xs font-mono font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-xl">
                Case ID: {generatedCaseNo}
              </span>
            )}
          </div>
           
          <div className="rounded-2xl border border-white/15 bg-slate-950/90 shadow-2xl flex flex-col relative w-full overflow-hidden">
            {/* Clean 4-Step Progress Header (hidden during document reading) */}
            {!isReadingDocuments && (
              <div className="bg-slate-900/95 px-4 sm:px-6 py-4 border-b border-white/10">
                <div className="grid grid-cols-4 gap-2 max-w-3xl mx-auto">
                  {[
                    { s: 1, label: 'Case & Documents', shortLabel: '1. Setup' },
                    { s: 2, label: 'Data Review', shortLabel: '2. Review' },
                    { s: 3, label: 'Containers', shortLabel: '3. Containers' },
                    { s: 4, label: 'Confirm & Submit', shortLabel: '4. Confirm' }
                  ].map(({ s, label, shortLabel }) => {
                    const isActive = step === s;
                    const isCompleted = step > s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          if (step === 1 && s > 1 && (files.length > 0 || uploadedDocs.length > 0) && Object.keys(formData.extractedData || {}).length === 0) {
                            triggerDocumentReading();
                          } else if (s < step || (formData.client && formData.category) || uploadedDocs.length > 0) {
                            setStep(s);
                          }
                        }}
                        className={`flex items-center justify-center sm:justify-start gap-2.5 p-2 sm:px-3.5 sm:py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          isActive
                            ? 'bg-amber-500/15 border-amber-500/50 text-white shadow-sm'
                            : isCompleted
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15'
                            : 'bg-slate-950/60 border-white/10 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                            isActive
                              ? 'bg-amber-500 text-slate-950'
                              : isCompleted
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {isCompleted ? <Check size={14} /> : s}
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-bold block truncate sm:hidden">{shortLabel}</span>
                          <span className="text-xs font-bold hidden sm:block truncate">{label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Main Step Content Area */}
            <div className="p-4 sm:p-6 flex-1 w-full">
              {isReadingDocuments ? (
                <div className="min-h-[360px] flex flex-col justify-center items-center w-full">
                  {renderDocumentReadingView()}
                </div>
              ) : (
                <div>
                  {step === 1 && renderStep1_Merged()}
                  {step === 2 && renderStep5_DataReview()}
                  {step === 3 && renderStep6_Containers()}
                  {step === 4 && renderStep7_Submit()}
                </div>
              )}
            </div>

            {/* Clean Sticky Footer Navigation Bar */}
            {step < 4 && !isReadingDocuments && (
              <div className="px-4 sm:px-6 py-4 bg-slate-900/95 border-t border-white/10 flex justify-between items-center backdrop-blur-md z-20 sticky bottom-0">
                <button 
                  type="button"
                  disabled={step === 1}
                  onClick={() => setStep(s => s - 1)}
                  className={`h-11 px-5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                    step === 1 
                      ? 'opacity-0 pointer-events-none' 
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-white/15'
                  }`}
                >
                  <ArrowLeft size={16} />
                  <span>Previous Step</span>
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    if (step === 1) {
                      if (!generatedCaseNo) {
                        const freshCaseNo = generateCaseNumber();
                        setGeneratedCaseNo(freshCaseNo);
                        safeAppStorage.setItem('dpl_reg_caseno', freshCaseNo);
                      }
                      if (isOtherClient && otherClientName.trim()) {
                        const trimmed = otherClientName.trim();
                        saveClientToFirestore({ name: trimmed }).catch(() => {});
                        if (!registeredClients.includes(trimmed)) {
                          setRegisteredClients(prev => [...prev, trimmed]);
                        }
                      }
                      if (files.length > 0 || uploadedDocs.length > 0) {
                        triggerDocumentReading();
                        return;
                      }
                      setStep(2);
                      return;
                    }
                    if (step === 2) {
                      if (formData.containers.length === 0) {
                        const totalWeight = formData.extractedData.totalWeight || 0;
                        const extractedCntr = formData.extractedData.containerNo || `CNTR-${Math.floor(Math.random()*10000)}`;
                        const extractedSize = formData.extractedData.containerSize || '40ft';
                        setFormData(prev => ({
                          ...prev,
                          containers: [
                            { 
                              id: Date.now(), 
                              number: extractedCntr, 
                              size: (extractedSize === '20ft' || extractedSize === '45ft') ? extractedSize : '40ft', 
                              weight: totalWeight,
                              sealNo: prev.extractedData.sealNo || '',
                              status: 'Pending'
                            }
                          ]
                        }));
                      }
                      setStep(3);
                      return;
                    }
                    if (step === 3) {
                      setStep(4);
                      return;
                    }
                    setStep(s => s + 1);
                  }}
                  disabled={
                    step === 1 && (files.length === 0 && uploadedDocs.length === 0) && (!formData.client || !formData.client.trim() || !formData.category)
                  }
                  className="h-11 bg-amber-500 hover:bg-amber-400 text-slate-950 px-6 sm:px-8 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span>
                    {step === 3
                      ? 'Review & Confirm Case' 
                      : step === 1 && (files.length > 0 || uploadedDocs.length > 0)
                        ? 'Scan Documents & Continue'
                        : step === 2
                          ? 'Next: Containers Manifest'
                          : 'Continue to Data Review'}
                  </span>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add More Charges Modal */}
      {showRegistrationChargeModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[95] flex items-center justify-center p-4 overflow-hidden">
          <div className="max-w-md w-full rounded-2xl border border-white/15 bg-slate-900 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-slate-950/60 shrink-0">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Receipt size={18} className="text-amber-400" />
                <span>Add Invoice Charge Item</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowRegistrationChargeModal(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-2">Select Charge Head (Amount is Nil — enter below)</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { desc: 'TP Charges' },
                    { desc: 'Loading / Unloading Charges' },
                    { desc: 'Delivery Order (DO) Charges' },
                    { desc: 'DO Deposit' },
                    { desc: 'Excise Payment' },
                    { desc: 'Vehicle Rent / Freight' },
                    { desc: 'Customs Duty / Taxes' }
                  ].map((preset, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => {
                        setNewRegChargeDesc(preset.desc);
                        setNewRegChargeAmount('');
                      }}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-1 cursor-pointer ${
                        newRegChargeDesc === preset.desc
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold'
                          : 'bg-slate-950 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 border-white/10 hover:border-amber-500/30'
                      }`}
                    >
                      <Plus size={12} /> {preset.desc}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Charge Description</label>
                <input
                  type="text"
                  placeholder="e.g. TP Charges, Demurrage Surcharge, Port Lift Off"
                  value={newRegChargeDesc}
                  onChange={(e) => setNewRegChargeDesc(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-xl text-sm text-white bg-slate-950 outline-none border border-white/15 focus:border-amber-400"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">Amount (PKR) <span className="text-red-400">*</span></label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400 font-bold">PKR</span>
                  <input
                    type="number"
                    placeholder="Enter charge amount (Required)"
                    value={newRegChargeAmount}
                    onChange={(e) => setNewRegChargeAmount(e.target.value)}
                    className="w-full h-10 pl-12 pr-3.5 rounded-xl text-sm text-emerald-400 font-mono font-bold bg-slate-950 outline-none border border-white/15 focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Set as Default for Client & Category Checkbox */}
              {formData.client && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-xl">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSaveAsClientDefault}
                      onChange={(e) => setIsSaveAsClientDefault(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-white/20 accent-amber-500 cursor-pointer"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-amber-300 block">
                        Save as Default Charge for {formData.client} ({formData.category})
                      </span>
                      <span className="text-slate-300 leading-relaxed block mt-0.5">
                        Automatically apply this charge &amp; amount on all future <strong>{formData.category}</strong> cases and invoices for {formData.client}.
                      </span>
                    </div>
                  </label>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-white/10 bg-slate-950/60 flex justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowRegistrationChargeModal(false)}
                className="h-10 px-4 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newRegChargeDesc.trim() || !newRegChargeAmount || Number(newRegChargeAmount) <= 0}
                onClick={() => handleAddRegistrationChargeItem(newRegChargeDesc, Number(newRegChargeAmount) || 0)}
                className="h-10 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 px-5 rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={14} />
                <span>Save Charge</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Camera Modal */}
      {showCamera && (
        <div className="fixed inset-0 bg-black/90 z-[100] flex items-start justify-center pt-3 sm:pt-6 pb-6 px-3 sm:px-4 overflow-y-auto no-print">
           <div className="bg-slate-900 rounded-2xl overflow-hidden max-w-2xl w-full border border-white/10 shadow-2xl mb-6">
              <div className="relative">
                 <video ref={videoRef} autoPlay playsInline className="w-full bg-black h-96 object-cover" />
                 <button onClick={stopCamera} className="absolute top-4 right-4 bg-black/50 text-white p-2 rounded-full hover:bg-red-500 transition-colors">
                    <X size={24} />
                 </button>
              </div>
              <div className="p-6 flex flex-col items-center">
                 <p className="text-gray-400 mb-4 text-sm">Align document within the frame</p>
                 <button onClick={captureImage} className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center hover:bg-white/20 transition-all">
                    <div className="w-12 h-12 bg-white rounded-full"></div>
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Global Document Lightbox & Preview Modal */}
      {lightboxImage && (
         <div 
           className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 no-print"
           onClick={() => setLightboxImage(null)}
         >
           <div 
             className="relative max-w-5xl w-full max-h-[94vh] flex flex-col bg-slate-900 border border-white/15 rounded-2xl overflow-hidden shadow-2xl animate-fade-in"
             onClick={(e) => e.stopPropagation()}
           >
             <div className="p-3 sm:p-4 bg-slate-950 flex items-center justify-between border-b border-white/10 shrink-0">
               <div className="flex items-center gap-2">
                 <FileText className="text-amber-400" size={18} />
                 <span className="text-sm font-bold text-white tracking-wide">Document Preview</span>
               </div>
               <div className="flex items-center gap-2">
                 <button
                   type="button"
                   onClick={() => downloadFile(lightboxImage, 'document.pdf')}
                   className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-white/15 flex items-center gap-1.5 font-medium transition cursor-pointer"
                   title="Download File"
                 >
                   <Download size={13} className="text-amber-400" /> Download
                 </button>
                 <button
                   type="button"
                   onClick={() => window.open(lightboxImage, '_blank')}
                   className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-white/15 flex items-center gap-1.5 font-medium transition cursor-pointer"
                   title="Open in new window"
                 >
                   <ExternalLink size={13} /> Open
                 </button>
                 <button 
                   type="button"
                   onClick={() => setLightboxImage(null)}
                   className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
                   title="Close"
                 >
                   <X size={20} />
                 </button>
               </div>
             </div>
             <div className="flex-1 overflow-auto flex items-center justify-center p-2 bg-black/80 min-h-[450px]">
               {lightboxImage.startsWith('data:application/pdf') || lightboxImage.toLowerCase().includes('.pdf') ? (
                 <iframe 
                   src={lightboxImage} 
                   title="PDF Preview" 
                   className="w-full h-[82vh] border-0 rounded-lg bg-white" 
                 />
               ) : (
                 <img 
                   src={lightboxImage} 
                   alt="Document Preview" 
                   className="max-w-full max-h-[85vh] object-contain shadow-2xl rounded" 
                 />
               )}
             </div>
           </div>
         </div>
      )}

      {/* Add Custom Charge Modal */}
      {showAddChargeModal && (
        <div 
          className="fixed inset-0 bg-black/70 z-[100] flex items-start justify-center pt-3 sm:pt-6 pb-6 px-3 sm:px-4 backdrop-blur-sm no-print overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddChargeModal(false);
              setIsAddingNewCategory(false);
            }
          }}
        >
          <div className="bg-slate-900 rounded-2xl overflow-hidden max-w-lg w-full border border-white/15 shadow-2xl animate-fade-in mb-6">
            <div className="p-5 border-b border-white/10 flex justify-between items-center bg-slate-950/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-brand-500/10 text-brand-400 flex items-center justify-center border border-brand-500/20">
                  <Receipt size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Add Billing Charge</h3>
                  <p className="text-xs text-gray-400">Select charge category, amount and attach payment receipt</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowAddChargeModal(false);
                  setIsAddingNewCategory(false);
                }}
                className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Charge Category Selection */}
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                  Select Charge Category
                </label>
                <select
                  value={selectedChargeCategory}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedChargeCategory(val);
                    if (val && val !== '__CUSTOM__') {
                      setNewChargeDesc(val);
                      // Check if client has a saved default amount for this charge in this case's category; otherwise Nil ('')
                      const clientObj = clientsData.find(c => c.name?.toLowerCase() === selectedCase?.clientName?.toLowerCase());
                      const resolved = resolveCaseCharges(clientObj, selectedCase?.category || 'Bonded Carrier');
                      const matchedDefault = resolved.charges.find(ch => ch.description.toLowerCase() === val.toLowerCase());
                      setNewChargeAmount(matchedDefault && matchedDefault.amount > 0 ? String(matchedDefault.amount) : '');
                    } else if (val === '__CUSTOM__') {
                      setNewChargeDesc('');
                      setNewChargeAmount('');
                    }
                  }}
                  className="w-full bg-slate-800 border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
                >
                  <option value="">-- Select Category --</option>
                  <optgroup label="Standard Customs & Shipping Charges">
                    {STANDARD_CHARGE_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </optgroup>
                  {customChargeCategories.length > 0 && (
                    <optgroup label="Custom Created Categories">
                      {customChargeCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </optgroup>
                  )}
                  <option value="__CUSTOM__">✍ Custom Category...</option>
                </select>

                {/* Button to Add New Category */}
                <div className="mt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setIsAddingNewCategory(prev => !prev)}
                    className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-medium transition-colors"
                  >
                    <Plus size={13} />
                    <span>+ Add New Charge Category</span>
                  </button>
                  {customChargeCategories.length > 0 && (
                    <span className="text-[11px] text-gray-500">
                      {customChargeCategories.length} custom {customChargeCategories.length === 1 ? 'category' : 'categories'} available
                    </span>
                  )}
                </div>

                {/* Inline New Category Creation Box */}
                {isAddingNewCategory && (
                  <div className="mt-2.5 p-3 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-2">
                    <p className="text-xs text-gray-300 font-medium">
                      Enter new charge category name (will be saved across all cases):
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newCategoryInput}
                        onChange={(e) => setNewCategoryInput(e.target.value)}
                        placeholder="e.g. Scanning Surcharge, Security Escort Fee..."
                        className="flex-1 bg-slate-900 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-400"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (newCategoryInput.trim()) {
                              const trimmed = newCategoryInput.trim();
                              const updatedCats = Array.from(new Set([...customChargeCategories, trimmed]));
                              setCustomChargeCategories(updatedCats);
                              safeLocalStorage.setItem('custom_billing_categories', JSON.stringify(updatedCats));
                              setSelectedChargeCategory(trimmed);
                              setNewChargeDesc(trimmed);
                              setNewCategoryInput('');
                              setIsAddingNewCategory(false);
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newCategoryInput.trim()) {
                            const trimmed = newCategoryInput.trim();
                            const updatedCats = Array.from(new Set([...customChargeCategories, trimmed]));
                            setCustomChargeCategories(updatedCats);
                            safeLocalStorage.setItem('custom_billing_categories', JSON.stringify(updatedCats));
                            setSelectedChargeCategory(trimmed);
                            setNewChargeDesc(trimmed);
                            setNewCategoryInput('');
                            setIsAddingNewCategory(false);
                          }
                        }}
                        disabled={!newCategoryInput.trim()}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-semibold text-xs transition-colors"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingNewCategory(false);
                          setNewCategoryInput('');
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Service / Item Description */}
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                  Service / Item Description
                </label>
                <input 
                  type="text"
                  value={newChargeDesc}
                  onChange={(e) => setNewChargeDesc(e.target.value)}
                  placeholder="e.g. Weighbridge charges, Terminal detention, Wharfage surcharge"
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>

              {/* Amount (PKR) */}
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                  Amount in PKR
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-gray-400 font-bold">
                    PKR
                  </span>
                  <input 
                    type="number"
                    value={newChargeAmount}
                    onChange={(e) => setNewChargeAmount(e.target.value)}
                    placeholder="e.g. 15000"
                    className="w-full bg-slate-800 border border-white/10 rounded-xl pl-14 pr-3.5 py-2.5 text-sm font-mono font-semibold text-emerald-400 placeholder-gray-500 focus:outline-none focus:border-brand-500 transition-colors"
                  />
                </div>
              </div>

              {/* Receipt Upload Option */}
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                  Upload Payment Receipt / Voucher
                </label>
                
                {newChargeReceipt ? (
                  <div className="p-3 rounded-xl bg-slate-800 border border-emerald-500/30 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
                        {newChargeReceipt.name.toLowerCase().endsWith('.pdf') ? (
                          <FileText size={18} />
                        ) : (
                          <Receipt size={18} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">{newChargeReceipt.name}</p>
                        <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 size={10} /> Receipt Attached
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setLightboxImage(newChargeReceipt.url)}
                        className="p-1.5 text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg text-xs transition-colors"
                        title="Preview"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewChargeReceipt(null)}
                        className="p-1.5 text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-xs transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="border-2 border-dashed border-white/15 hover:border-brand-400/50 rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 cursor-pointer bg-slate-800/40 hover:bg-slate-800/80 transition-all text-center">
                    {isUploadingReceipt ? (
                      <Loader2 size={22} className="text-brand-400 animate-spin" />
                    ) : (
                      <UploadCloud size={22} className="text-gray-400" />
                    )}
                    <span className="text-xs font-medium text-gray-300">
                      {isUploadingReceipt ? 'Processing receipt...' : 'Click to browse or drop payment receipt / voucher'}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      Supports JPG, PNG, WEBP or PDF receipt document
                    </span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      disabled={isUploadingReceipt}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setIsUploadingReceipt(true);
                        try {
                          const proc = await compressAndPrepareFile(file);
                          const dataUrl = proc?.dataUrl || proc?.base64 || '';
                          setNewChargeReceipt({ url: dataUrl, name: file.name });

                          // High-precision intelligent receipt OCR
                          const receiptData = await analyzeReceiptWithAI(file);
                          if (receiptData && receiptData.success) {
                            if (receiptData.amount && (!newChargeAmount || Number(newChargeAmount) === 0)) {
                              setNewChargeAmount(String(receiptData.amount));
                            }
                            if (receiptData.description && !newChargeDesc) {
                              setNewChargeDesc(receiptData.description);
                            }
                          }
                        } catch (err) {
                          console.warn("Failed compression, fallback to FileReader:", err);
                          const reader = new FileReader();
                          reader.onload = () => {
                            setNewChargeReceipt({ url: reader.result as string, name: file.name });
                          };
                          reader.readAsDataURL(file);
                        } finally {
                          setIsUploadingReceipt(false);
                        }
                      }}
                    />
                  </label>
                )}
              </div>

              {/* Set as Default for Client Checkbox */}
              {selectedCase?.clientName && (
                <div className="p-3 bg-brand-500/10 border border-brand-500/20 rounded-xl">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveAsClientDefaultInModal}
                      onChange={(e) => setSaveAsClientDefaultInModal(e.target.checked)}
                      className="mt-0.5 rounded border-white/20 text-brand-500 focus:ring-brand-400 cursor-pointer"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-brand-300 block">
                        Set as Default Charge for {selectedCase.clientName} ({selectedCase.category || 'Bonded Carrier'})
                      </span>
                      <span className="text-[11px] text-gray-300 leading-tight">
                        This charge &amp; amount will automatically apply as default tariff on all future <strong>{selectedCase.category || 'Bonded Carrier'}</strong> cases and invoices for this client.
                      </span>
                    </div>
                  </label>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-white/10 bg-slate-950/50 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowAddChargeModal(false);
                  setIsAddingNewCategory(false);
                  setNewChargeReceipt(null);
                  setSaveAsClientDefaultInModal(false);
                }}
                className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!newChargeDesc.trim() || !newChargeAmount) return;
                  const active = selectedCase;
                  if (!active) return;
                  const currentCharges = (active.charges && active.charges.length > 0)
                    ? [...active.charges]
                    : [];
                  
                  const updatedCharges = [
                    ...currentCharges,
                    {
                      id: `chg_${Date.now()}`,
                      category: active.category || 'Bonded Carrier',
                      description: newChargeDesc.trim(),
                      amount: parseFloat(newChargeAmount) || 0,
                      receiptUrl: newChargeReceipt?.url,
                      receiptName: newChargeReceipt?.name,
                    }
                  ];

                  const updatedCase = { ...active, charges: updatedCharges };
                  setCases(prev => prev.map(c => c.id === updatedCase.id ? updatedCase : c));
                  setSelectedCase(updatedCase);
                  if (isEditingCase) setEditedCase(updatedCase);
                  updateCaseInFirestore(updatedCase).catch(e => console.warn("Firestore charge error:", e));

                  // If checked, persist as client default strictly for this case's category
                  if (saveAsClientDefaultInModal && active.clientName) {
                    const clientObj = clientsData.find(c => c.name?.toLowerCase() === active.clientName?.toLowerCase());
                    if (clientObj) {
                      const targetCat = active.category || clientObj.defaultCaseCategory || 'Bonded Carrier';
                      saveChargeAsClientDefault(clientObj, {
                        description: newChargeDesc.trim(),
                        amount: parseFloat(newChargeAmount) || 0,
                        category: targetCat,
                        caseCategory: targetCat,
                        chargeHead: selectedChargeCategory || 'Customs / Transit',
                        taxable: true
                      }).then(updatedClient => {
                        setClientsData(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
                        setDraftToast(`✓ Saved "${newChargeDesc.trim()}" as permanent default charge for ${active.clientName} (${targetCat})!`);
                      }).catch(err => console.warn("Could not save client default:", err));
                    }
                  }

                  setShowAddChargeModal(false);
                  setSelectedChargeCategory('');
                  setNewChargeDesc('');
                  setNewChargeAmount('');
                  setNewChargeReceipt(null);
                  setIsAddingNewCategory(false);
                  setSaveAsClientDefaultInModal(false);
                }}
                disabled={!newChargeDesc.trim() || !newChargeAmount || isUploadingReceipt}
                className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-brand-600/30 flex items-center gap-1.5"
              >
                <Save size={15} />
                <span>Save Charge</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8-Step Streamlined Workflow Interactive Modal */}
      {showStepModal && selectedStepStatus && selectedCase && (
        <WorkflowStepModal
          isOpen={showStepModal}
          onClose={() => setShowStepModal(false)}
          targetCase={selectedCase}
          stepStatus={selectedStepStatus}
          stepIndex={stepModalIndex}
          userRole={effectiveRole}
          userRoles={effectiveRoles}
          onSaveCase={(updatedCase) => {
            setCases(prev => prev.map(c => c.id === updatedCase.id ? updatedCase : c));
            setSelectedCase(updatedCase);
            if (isEditingCase) setEditedCase(updatedCase);
            updateCaseInFirestore(updatedCase).catch(e => console.warn("Firestore step update error:", e));
          }}
          onReportIncident={(caseWithIncident) => {
            setCases(prev => prev.map(c => c.id === caseWithIncident.id ? caseWithIncident : c));
            setSelectedCase(caseWithIncident);
            if (isEditingCase) setEditedCase(caseWithIncident);
            updateCaseInFirestore(caseWithIncident).catch(e => console.warn("Firestore incident error:", e));
            setActiveWorkflowTab('incident_vault');
          }}
        />
      )}

      {/* Download Documents Modal - Clean List Format */}
      {showDownloadDocsModal && selectedCase && (
        <div 
          className="fixed inset-0 bg-black/80 z-[100] flex items-start justify-center pt-6 sm:pt-10 p-3 sm:p-5 backdrop-blur-sm no-print overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDownloadDocsModal(false);
          }}
        >
          <div className="bg-slate-900 rounded-2xl overflow-hidden max-w-2xl w-full border border-white/15 shadow-2xl animate-fade-in max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-white/10 flex justify-between items-center bg-slate-950/70 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-500/15 text-brand-400 flex items-center justify-center border border-brand-500/30">
                  <Download size={20} />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <span>Download Case Documents</span>
                  </h3>
                  <p className="text-xs text-gray-400 font-mono">
                    Case No: <span className="text-amber-300 font-semibold">{selectedCase.caseNo}</span>
                    {selectedCase.clientName && <span> • Client: <span className="text-white font-medium">{selectedCase.clientName}</span></span>}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowDownloadDocsModal(false)}
                className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* List Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  Available Documents List:
                </p>
                {isDownloadingPdf && (
                  <div className="flex items-center gap-1.5 text-xs text-brand-300 font-medium">
                    <Loader2 size={13} className="animate-spin text-brand-400" />
                    <span>Preparing download...</span>
                  </div>
                )}
              </div>

              {/* Status / Notice Banner */}
              {pdfDownloadSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between gap-3 text-xs text-emerald-300 animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
                    <span>Downloaded: <strong className="font-mono text-white">{pdfDownloadSuccess}</strong></span>
                  </div>
                  <span className="text-[11px] text-gray-400">Saved to Downloads</span>
                </div>
              )}

              {pdfDownloadError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-xs text-red-300">
                  <AlertCircle size={16} className="shrink-0 text-red-400" />
                  <span>{pdfDownloadError}</span>
                </div>
              )}

              {/* Clean List of Documents */}
              <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-slate-950/50 overflow-hidden shadow-sm">
                
                {/* 1. Sabse upar Hoga: Case Detail */}
                <div className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-brand-500/15 text-brand-400 border border-brand-500/25 flex items-center justify-center shrink-0">
                      <FileText size={18} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">Case Detail</h4>
                      <p className="text-[11px] text-gray-400 truncate">Official Single-Page Case Summary, Dropdowns Form & Invoice Breakdown</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isDownloadingPdf}
                    onClick={() => handleDownloadPdfFile(selectedCase, { onlyCaseDetails: true, withInvoice: false, withAttachments: false })}
                    className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-brand-600/20 transition-all shrink-0 cursor-pointer active:scale-95"
                    title="Download Case Detail PDF"
                  >
                    <Download size={13} />
                    <span>Download</span>
                  </button>
                </div>

                {/* 2. Usse niche Hoga: Invoice */}
                <div className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/25 flex items-center justify-center shrink-0">
                      <Receipt size={18} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">Invoice</h4>
                      <p className="text-[11px] text-gray-400 truncate">Official Commercial Invoice & Itemized Service Charges</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isDownloadingPdf}
                    onClick={() => handleDownloadPdfFile(selectedCase, { onlyInvoice: true, withInvoice: true, withAttachments: false })}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-amber-600/20 transition-all shrink-0 cursor-pointer active:scale-95"
                    title="Download Commercial Invoice PDF"
                  >
                    <Download size={13} />
                    <span>Download</span>
                  </button>
                </div>

                {/* 2.5 Port Loading Bill / Unloading Bill Section (Permanent Case Record) */}
                {(() => {
                  const portBills: Array<{
                    id: string;
                    name: string;
                    type: string;
                    url?: string;
                    billNo?: string;
                    amount?: number;
                    officer?: string;
                    containerNo?: string;
                    billData?: any;
                  }> = [];

                  // Check selectedCase.loadingBills
                  if (Array.isArray((selectedCase as any).loadingBills)) {
                    (selectedCase as any).loadingBills.forEach((b: any, bIdx: number) => {
                      portBills.push({
                        id: b.id || `lb_${bIdx}`,
                        name: `Loading Bill - ${b.billNo || b.id}.pdf`,
                        type: 'Port Loading Bill',
                        url: b.pdfUrl,
                        billNo: b.billNo,
                        amount: b.totalAmount,
                        officer: b.staffName,
                        containerNo: b.containerNo,
                        billData: b
                      });
                    });
                  }

                  // Also check selectedCase.documents for Loading Bill or Unloading Bill
                  if (Array.isArray(selectedCase.documents)) {
                    selectedCase.documents.forEach((d: any, dIdx: number) => {
                      const dType = (d.type || '').toLowerCase();
                      const dName = (d.name || '').toLowerCase();
                      if (dType.includes('loading bill') || dType.includes('unloading bill') || dName.includes('loading bill') || dName.includes('loading_bill') || dName.includes('unloading bill')) {
                        const billNo = d.billNo || (d.name ? d.name.replace(/\.pdf$/i, '').replace(/^Loading_Bill_/i, '').replace(/^Loading Bill - /i, '') : `LB-${dIdx + 1}`);
                        if (!portBills.some(pb => pb.billNo === billNo || pb.name === d.name)) {
                          portBills.push({
                            id: d.id || `doc_lb_${dIdx}`,
                            name: d.name || `Loading Bill - ${billNo}.pdf`,
                            type: dType.includes('unloading') ? 'Port Unloading Bill' : 'Port Loading Bill',
                            url: d.url,
                            billNo,
                            amount: d.totalAmount,
                            officer: d.officer,
                            containerNo: d.containerNo || selectedCase.containerNumber,
                            billData: d.billData
                          });
                        }
                      }
                    });
                  }

                  return portBills.map((pb, pbIdx) => {
                    const handleDownloadPortBill = async () => {
                      if (pb.url) {
                        const a = document.createElement('a');
                        a.href = pb.url;
                        a.download = pb.name;
                        a.rel = 'noopener noreferrer';
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(() => {
                          if (document.body.contains(a)) document.body.removeChild(a);
                        }, 400);
                        return;
                      }

                      // Dynamic generation if url is missing
                      try {
                        setIsDownloadingPdf(true);
                        const bData = pb.billData || {
                          billNo: pb.billNo || `LB-${Date.now()}`,
                          caseNo: selectedCase.caseNo,
                          clientName: selectedCase.clientName,
                          containerNo: pb.containerNo || selectedCase.containerNumber || '',
                          portTerminal: selectedCase.pol || 'Port Terminal',
                          date: new Date().toISOString().slice(0, 10),
                          items: (selectedCase.charges || []).map((c: any) => ({
                            head: c.description || 'Port Charge',
                            amount: Number(c.amount) || 0,
                            receiptUrl: c.receiptUrl
                          })),
                          totalAmount: pb.amount || (selectedCase.charges || []).reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0),
                          officerName: pb.officer || 'Port Staff Desk',
                          branding: { companyName, customLogo: activeLogo }
                        };
                        await downloadLoadingBillPdf(bData);
                      } catch (err) {
                        console.error('Failed to download port bill:', err);
                        alert('Could not download bill PDF.');
                      } finally {
                        setIsDownloadingPdf(false);
                      }
                    };

                    return (
                      <div key={'pb-' + pbIdx} className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors bg-emerald-500/[0.03]">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center justify-center shrink-0">
                            <Receipt size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-white truncate">{pb.name}</h4>
                              <span className="text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                                {pb.type}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-400 truncate">
                              {pb.containerNo ? `Container: ${pb.containerNo} • ` : ''}
                              {pb.amount ? `Total: PKR ${Number(pb.amount).toLocaleString()} • ` : ''}
                              {pb.officer ? `Staff: ${pb.officer} • ` : ''}
                              Permanent Case Record (Protected from ID Deletion)
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isDownloadingPdf}
                          onClick={handleDownloadPortBill}
                          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all shrink-0 cursor-pointer active:scale-95"
                          title="Download Port Bill PDF"
                        >
                          <Download size={13} />
                          <span>Download</span>
                        </button>
                      </div>
                    );
                  });
                })()}

                {/* 2.6 Customs Delivery Order (DO / NOC) */}
                {(() => {
                  const hasDoDoc = (selectedCase.documents || []).find((d: any) => 
                    (d.type || '').toLowerCase().includes('delivery order') || 
                    (d.name || '').toLowerCase().includes('delivery_order') ||
                    (d.name || '').toLowerCase().includes('delivery order')
                  );
                  const doUrl = hasDoDoc?.url || selectedCase.autoGeneratedDoUrl;
                  const isDestinationDone = isDestinationUnloadedAndGateOut(selectedCase) || selectedCase.status === CaseStatus.COMPLETED || selectedCase.status === CaseStatus.DESTINATION_PORT_ARRIVAL;

                  if (!doUrl && !isDestinationDone) return null;

                  const handleDownloadDO = async () => {
                    if (doUrl) {
                      const a = document.createElement('a');
                      a.href = doUrl;
                      a.download = hasDoDoc?.name || `Customs_Delivery_Order_${selectedCase.caseNo}.pdf`;
                      a.rel = 'noopener noreferrer';
                      document.body.appendChild(a);
                      a.click();
                      setTimeout(() => {
                        if (document.body.contains(a)) document.body.removeChild(a);
                      }, 400);
                      return;
                    }

                    try {
                      setIsDownloadingPdf(true);
                      await downloadCustomsDeliveryOrderPdf({
                        targetCase: selectedCase,
                        branding: { companyName, customLogo: activeLogo }
                      });
                    } catch (err) {
                      console.error('Failed to generate DO:', err);
                      alert('Could not generate Delivery Order PDF.');
                    } finally {
                      setIsDownloadingPdf(false);
                    }
                  };

                  return (
                    <div className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors bg-teal-500/[0.03]">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-teal-500/15 text-teal-300 border border-teal-500/25 flex items-center justify-center shrink-0">
                          <FileCheck size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-white truncate">Customs Delivery Order (DO / NOC)</h4>
                            <span className="text-[10px] font-mono font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded-full">
                              Official DO
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-400 truncate">
                            Port Destination Container Release & Offloading NOC • Case #{selectedCase.caseNo}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isDownloadingPdf}
                        onClick={handleDownloadDO}
                        className="bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-teal-600/20 transition-all shrink-0 cursor-pointer active:scale-95"
                        title="Download Customs Delivery Order PDF"
                      >
                        <Download size={13} />
                        <span>Download</span>
                      </button>
                    </div>
                  );
                })()}

                {/* 3. Usse niche: Sare uploaded document honge jinke naam likhe a rahe honge aur aage download ka button hoga */}
                {selectedCase.documents && selectedCase.documents.length > 0 ? (
                  selectedCase.documents.map((doc: any, idx: number) => {
                    const docName = doc.name || ('Document_' + (idx + 1));
                    const docCategory = doc.docCategory || doc.type || 'Customs Document';
                    const docSrc = doc.url || (doc instanceof File ? URL.createObjectURL(doc) : '');

                    const handleDownloadUploadedDoc = () => {
                      if (!docSrc) return;
                      const a = document.createElement('a');
                      a.href = docSrc;
                      a.download = docName;
                      a.rel = 'noopener noreferrer';
                      document.body.appendChild(a);
                      a.click();
                      setTimeout(() => {
                        if (document.body.contains(a)) document.body.removeChild(a);
                      }, 400);
                    };

                    return (
                      <div key={idx} className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/25 flex items-center justify-center shrink-0">
                            <FileCheck size={18} />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-white truncate" title={docName}>{docName}</h4>
                            <p className="text-[11px] text-gray-400 truncate">{docCategory}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleDownloadUploadedDoc}
                          disabled={!docSrc}
                          className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-cyan-600/20 transition-all shrink-0 cursor-pointer active:scale-95"
                          title={'Download ' + docName}
                        >
                          <Download size={13} />
                          <span>Download</span>
                        </button>
                      </div>
                    );
                  })
                ) : null}

                {/* Attached Payment Receipts if any */}
                {selectedCase.charges && selectedCase.charges.some((c: any) => c.receiptUrl) && (
                  selectedCase.charges.filter((c: any) => c.receiptUrl).map((ch: any, rIdx: number) => {
                    const rName = ch.receiptName || ('Receipt_' + (ch.description || 'Charge').replace(/\s+/g, '_') + '.png');
                    const handleDownloadReceipt = () => {
                      const a = document.createElement('a');
                      a.href = ch.receiptUrl;
                      a.download = rName;
                      a.rel = 'noopener noreferrer';
                      document.body.appendChild(a);
                      a.click();
                      setTimeout(() => {
                        if (document.body.contains(a)) document.body.removeChild(a);
                      }, 400);
                    };

                    return (
                      <div key={'rcp-' + rIdx} className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center justify-center shrink-0">
                            <Receipt size={18} />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-white truncate">{ch.description} (Receipt)</h4>
                            <p className="text-[11px] text-emerald-400 font-mono">PKR {Number(ch.amount || 0).toLocaleString()}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleDownloadReceipt}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all shrink-0 cursor-pointer active:scale-95"
                          title="Download Receipt"
                        >
                          <Download size={13} />
                          <span>Download</span>
                        </button>
                      </div>
                    );
                  })
                )}

                {/* Complete Unified Dossier */}
                <div className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors bg-brand-500/[0.04]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-purple-500/15 text-purple-300 border border-purple-500/25 flex items-center justify-center shrink-0">
                      <Layers size={18} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">Complete Unified Dossier</h4>
                      <p className="text-[11px] text-gray-400 truncate">Combined dossier containing Case Details, Invoice & all paperwork in 1 PDF</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isDownloadingPdf}
                    onClick={() => handleDownloadPdfFile(selectedCase, { withInvoice: true, withAttachments: true })}
                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-600/20 transition-all shrink-0 cursor-pointer active:scale-95"
                    title="Download Complete Unified Dossier PDF"
                  >
                    <Download size={13} />
                    <span>Download</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 sm:p-5 border-t border-white/10 bg-slate-950/70 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowDownloadDocsModal(false)}
                className="px-5 py-2 rounded-xl text-xs sm:text-sm font-medium text-gray-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Print Options Modal (Universally available in Case Details & Management) */}
      {showPrintModal && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-start justify-center pt-3 sm:pt-6 pb-6 px-3 sm:px-4 backdrop-blur-sm no-print overflow-y-auto" onClick={(e) => {
          if (e.target === e.currentTarget) setShowPrintModal(false);
        }}>
          <div className="bg-slate-900 rounded-2xl overflow-hidden max-w-md w-full border border-white/15 shadow-2xl animate-fade-in mb-6">
            <div className="p-5 sm:p-6 border-b border-white/10 flex justify-between items-center bg-slate-950/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-brand-500/10 text-brand-400 flex items-center justify-center border border-brand-500/20">
                  <Download size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Export Dossier (PDF)</h3>
                  <p className="text-xs text-gray-400">Select components for official PDF document export</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPrintModal(false)} 
                className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-3">
               <label className="flex items-start gap-3 p-3.5 rounded-xl border border-white/10 hover:border-brand-500/40 hover:bg-white/5 cursor-pointer transition-all bg-white/[0.02]">
                  <input 
                    type="checkbox" 
                    checked={printOptions.withAttachments} 
                    onChange={(e) => setPrintOptions({...printOptions, withAttachments: e.target.checked})} 
                    className="w-5 h-5 accent-brand-500 rounded mt-0.5" 
                  />
                  <div>
                    <p className="text-white font-medium text-sm">Include Attached Files & Documents</p>
                    <p className="text-gray-400 text-xs mt-0.5">Attach copies of scanned BL, GD, and custom documents</p>
                  </div>
               </label>
               
               <label className="flex items-start gap-3 p-3.5 rounded-xl border border-white/10 hover:border-brand-500/40 hover:bg-white/5 cursor-pointer transition-all bg-white/[0.02]">
                  <input 
                    type="checkbox" 
                    checked={printOptions.withInvoice} 
                    onChange={(e) => setPrintOptions({...printOptions, withInvoice: e.target.checked, onlyInvoice: false})} 
                    className="w-5 h-5 accent-brand-500 rounded mt-0.5" 
                  />
                  <div>
                    <p className="text-white font-medium text-sm">Include Commercial Invoice</p>
                    <p className="text-gray-400 text-xs mt-0.5">Append freight terminal charges and official payment voucher</p>
                  </div>
               </label>

               <label className="flex items-start gap-3 p-3.5 rounded-xl border border-white/10 hover:border-brand-500/40 hover:bg-white/5 cursor-pointer transition-all bg-white/[0.02]">
                  <input 
                    type="checkbox" 
                    checked={printOptions.onlyInvoice} 
                    onChange={(e) => {
                        setPrintOptions({ withAttachments: false, withInvoice: false, onlyInvoice: e.target.checked });
                    }} 
                    className="w-5 h-5 accent-brand-500 rounded mt-0.5" 
                  />
                  <div>
                    <p className="text-white font-medium text-sm">Invoice Only</p>
                    <p className="text-gray-400 text-xs mt-0.5">Print only the commercial freight invoice without case details</p>
                  </div>
               </label>

               {/* In-progress status banner */}
               {isDownloadingPdf && (
                 <div className="p-3 bg-brand-500/10 border border-brand-500/30 rounded-xl flex items-center gap-3 text-brand-300 text-xs animate-pulse">
                    <Loader2 size={18} className="animate-spin text-brand-400 shrink-0" />
                    <span>Generating & downloading PDF...</span>
                 </div>
               )}

               {/* Success notification banner */}
               {pdfDownloadSuccess && (
                 <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl space-y-1.5 text-xs text-emerald-300 animate-fade-in">
                    <div className="flex items-center gap-2">
                       <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                       <span className="font-semibold text-white">File successfully downloaded! ({pdfDownloadSuccess})</span>
                    </div>
                    <p className="text-gray-300 text-[11px] pl-6">
                      The PDF is saved in your mobile Downloads folder.
                    </p>
                    {directDownloadUrl && (
                      <div className="pl-6 pt-1">
                        <a 
                          href={directDownloadUrl} 
                          download={directDownloadFilename}
                          className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 underline font-bold"
                        >
                          <Download size={13} /> Tap here to download again
                        </a>
                      </div>
                    )}
                 </div>
               )}

               {/* Error notification banner */}
               {pdfDownloadError && (
                 <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-300 text-xs">
                    <AlertCircle size={18} className="text-red-400 shrink-0" />
                    <span>{pdfDownloadError}</span>
                 </div>
               )}
            </div>

            <div className="p-4 sm:p-5 bg-black/40 border-t border-white/10 flex flex-wrap justify-between items-center gap-3">
              <button 
                type="button"
                onClick={() => {
                  setShowPrintModal(false);
                  setPdfDownloadSuccess(null);
                  setPdfDownloadError(null);
                }} 
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Close
              </button>
              
              <div className="flex items-center gap-2">
                {/* Primary: Real PDF File Download */}
                <button 
                  type="button"
                  disabled={isDownloadingPdf}
                  onClick={() => handleDownloadPdfFile(selectedCase)} 
                  className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-semibold shadow-lg shadow-emerald-600/30 flex items-center gap-2 text-sm transition-all"
                  id="btn-download-pdf-dossier"
                >
                   {isDownloadingPdf ? (
                     <>
                       <Loader2 size={16} className="animate-spin" />
                       <span>Downloading...</span>
                     </>
                   ) : (
                     <>
                       <Download size={16} />
                       <span>Download & Save PDF</span>
                     </>
                   )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pakistan Customs & International Logistics Statutory Compliance Guide Modal */}
      {showCustomsGuideModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center pt-6 sm:pt-10 p-3 sm:p-6 overflow-y-auto animate-in fade-in">
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-white/10 bg-black/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <FileCheck size={22} />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <span>Pakistan Customs Act & Regulatory Compliance Guide</span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 font-mono px-2 py-0.5 rounded border border-amber-500/30">
                      FBR / WeBOC / PSW
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400">
                    Statutory acts, required documents, procedures & standard tariffs for all 10 logistics services
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setShowCustomsGuideModal(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content Body: Left Categories List, Right Details */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
              {/* Categories Sidebar */}
              <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/10 overflow-y-auto bg-black/20 p-2 space-y-1 shrink-0">
                {CATEGORIES.map(cat => {
                  const isSelected = activeGuideCategory === cat;
                  const item = PAKISTAN_CUSTOMS_COMPLIANCE[cat];
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveGuideCategory(cat)}
                      className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-center justify-between ${
                        isSelected 
                          ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200 font-semibold shadow-sm' 
                          : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className="truncate min-w-0 pr-2">
                        <p className="truncate">{cat}</p>
                        {item && (
                          <p className="text-[10px] text-gray-500 font-mono truncate">
                            {item.id.toUpperCase()}
                          </p>
                        )}
                      </div>
                      {isSelected && <ChevronRight size={14} className="text-amber-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Selected Service Compliance Breakdown */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-900/40">
                {PAKISTAN_CUSTOMS_COMPLIANCE[activeGuideCategory] ? (
                  (() => {
                    const detail = PAKISTAN_CUSTOMS_COMPLIANCE[activeGuideCategory];
                    return (
                      <div className="space-y-5">
                        {/* Title & Acts Badge */}
                        <div className="space-y-2 border-b border-white/10 pb-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="text-lg font-bold text-white flex items-center gap-2">
                              <span>{detail.name}</span>
                            </h4>
                            <span className="text-xs bg-amber-500/20 text-amber-300 font-mono px-2.5 py-1 rounded-full border border-amber-500/30">
                              {detail.legalAct}
                            </span>
                          </div>
                          <p className="text-xs text-brand-300 font-medium font-mono">
                            Statutory Reference: {detail.customsRulesRef}
                          </p>
                        </div>

                        {/* Procedure Summary */}
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-1.5">
                          <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider">Customs & Regulatory Procedure</p>
                          <p className="text-xs sm:text-sm text-gray-200 leading-relaxed">
                            {detail.procedureSummary}
                          </p>
                        </div>

                        {/* Mandatory Fields & Compliance Checklist */}
                        <div className="space-y-2">
                          <p className="text-xs text-gray-300 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                            <FileCheck size={14} className="text-emerald-400" />
                            <span>Mandatory Documents & Data Required by Law:</span>
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {detail.mandatoryFields.map((field, idx) => (
                              <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-black/40 border border-white/5 text-xs text-gray-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                                <span>{field}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Standard Tariff & Billing Heads */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-300 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                              <FileText size={14} className="text-amber-400" />
                              <span>Statutory & Standard Tariff Heads (PKR):</span>
                            </p>
                            <span className="text-xs font-mono font-bold text-amber-400">
                              Total: PKR {detail.standardTariff.reduce((sum, ch) => sum + ch.amount, 0).toLocaleString()}
                            </span>
                          </div>
                          <div className="rounded-xl border border-white/10 overflow-hidden bg-black/30">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-white/5 text-gray-400 font-semibold uppercase border-b border-white/10">
                                <tr>
                                  <th className="p-2.5">Billing Description</th>
                                  <th className="p-2.5 text-right">Standard Rate (PKR)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {detail.standardTariff.map((ch, idx) => (
                                  <tr key={idx} className="hover:bg-white/5">
                                    <td className="p-2.5 text-gray-200">{ch.description}</td>
                                    <td className="p-2.5 text-right font-mono font-semibold text-emerald-400">
                                      PKR {ch.amount.toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="p-8 text-center text-gray-400 text-sm">
                    Select a category to view its Pakistan Customs statutory compliance specifications.
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 sm:p-4 border-t border-white/10 bg-black/40 flex justify-between items-center text-xs text-gray-400">
              <span className="font-mono">Pakistan Customs Act 1969 & Customs Rules 2001 (SROs 450(I)/2001)</span>
              <button 
                type="button"
                onClick={() => setShowCustomsGuideModal(false)}
                className="bg-white/10 hover:bg-white/20 text-white px-4 py-1.5 rounded-lg transition-colors font-medium"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Port Modal (In-flow without leaving page) */}
      {showPortModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-hidden animate-in fade-in duration-200">
          <div className="rounded-2xl w-full max-w-md border border-white/15 shadow-2xl bg-slate-900 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex justify-between items-center bg-slate-950/60 shrink-0">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Anchor size={18} className="text-amber-400" />
                <span>Add Port / Terminal</span>
              </h3>
              <button 
                type="button"
                onClick={() => { setShowPortModal(false); setPortTargetField(null); }}
                className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
              <p className="text-xs text-slate-400">
                Add a new port or terminal to the global port directory for POL and POD selection.
              </p>

              <div className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Port / Terminal Name <span className="text-red-400">*</span>
                  </label>
                  <input 
                    type="text" 
                    placeholder="e.g. Gwadar Deep Sea Port / Sialkot Dry Port" 
                    value={newPortName}
                    onChange={(e) => setNewPortName(e.target.value)}
                    className="w-full h-10 rounded-xl px-3.5 outline-none text-white text-sm bg-slate-950 border border-white/15 focus:border-amber-400"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Port Code / Acronym
                    </label>
                    <input 
                      type="text" 
                      placeholder="e.g. GWD, SKT" 
                      value={newPortCode}
                      onChange={(e) => setNewPortCode(e.target.value.toUpperCase())}
                      className="w-full h-10 rounded-xl px-3.5 outline-none text-white text-sm bg-slate-950 border border-white/15 focus:border-amber-400 uppercase font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Port Type
                    </label>
                    <select
                      value={newPortType}
                      onChange={(e) => setNewPortType(e.target.value)}
                      className="w-full h-10 rounded-xl px-3 outline-none text-white text-sm bg-slate-950 border border-white/15 focus:border-amber-400 cursor-pointer"
                    >
                      <option value="Dry Port" className="bg-slate-900">Dry Port (Inland)</option>
                      <option value="Sea Port" className="bg-slate-900">Sea Port (Coastal)</option>
                      <option value="Border Terminal" className="bg-slate-900">Border Terminal</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Container Inquiry Link (Official Website URL)
                  </label>
                  <div className="relative">
                    <ExternalLink size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="url" 
                      placeholder="e.g. https://www.kictl.com" 
                      value={newPortInquiryLink}
                      onChange={(e) => setNewPortInquiryLink(e.target.value)}
                      className="w-full h-10 rounded-xl pl-9 pr-3.5 outline-none text-white text-xs bg-slate-950 border border-white/15 focus:border-amber-400 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Destination Selection
                  </label>
                  <select
                    value={portTargetField || 'all'}
                    onChange={(e) => setPortTargetField(e.target.value === 'all' ? null : (e.target.value as 'pol' | 'pod'))}
                    className="w-full h-10 rounded-xl px-3.5 outline-none text-white text-xs sm:text-sm bg-slate-950 border border-white/15 focus:border-amber-400 cursor-pointer"
                  >
                    <option value="all" className="bg-slate-900">Add to All Port Lists (POL & POD)</option>
                    <option value="pol" className="bg-slate-900">Add & Select as Port of Loading (POL)</option>
                    <option value="pod" className="bg-slate-900">Add & Select as Port of Destination (POD)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-white/10 bg-slate-950/60 flex justify-end gap-2.5 shrink-0">
              <button 
                type="button"
                onClick={() => { setShowPortModal(false); setPortTargetField(null); }}
                className="h-10 px-4 bg-white/10 hover:bg-white/15 text-slate-300 rounded-xl font-semibold text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={() => handleAddPort()}
                disabled={!newPortName.trim()}
                className="h-10 px-5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus size={15} /> {portTargetField ? 'Add & Select Port' : 'Save Port'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Port Modal with Container Inquiry Link */}
      {showEditPortModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-hidden animate-in fade-in duration-200">
          <div className="rounded-2xl w-full max-w-md border border-white/15 shadow-2xl bg-slate-900 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex justify-between items-center bg-slate-950/60 shrink-0">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit size={18} className="text-amber-400" />
                <span>Edit Port & Wharfage Inquiry</span>
              </h3>
              <button 
                type="button"
                onClick={() => setShowEditPortModal(false)}
                className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
              <p className="text-xs text-slate-400">
                Select a port to modify its particulars, type, or official container inquiry link.
              </p>

              <div className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Select Port to Edit <span className="text-amber-400">*</span>
                  </label>
                  <select
                    value={selectedPortToEdit}
                    onChange={(e) => handleSelectPortToEdit(e.target.value)}
                    className="w-full h-10 rounded-xl px-3.5 outline-none text-white text-sm bg-slate-950 border border-white/15 focus:border-amber-400 cursor-pointer"
                  >
                    {ports.map((p) => (
                      <option key={p.name} value={p.name} className="bg-slate-900">
                        {p.name} ({p.code || 'PORT'}) {p.type ? `• ${p.type}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Port / Terminal Name <span className="text-red-400">*</span>
                  </label>
                  <input 
                    type="text" 
                    value={editPortName}
                    onChange={(e) => setEditPortName(e.target.value)}
                    placeholder="Port Name"
                    className="w-full h-10 rounded-xl px-3.5 outline-none text-white text-sm bg-slate-950 border border-white/15 focus:border-amber-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Port Code / Acronym
                    </label>
                    <input 
                      type="text" 
                      value={editPortCode}
                      onChange={(e) => setEditPortCode(e.target.value.toUpperCase())}
                      placeholder="e.g. KICT, QICT"
                      className="w-full h-10 rounded-xl px-3.5 outline-none text-white text-sm bg-slate-950 border border-white/15 focus:border-amber-400 uppercase font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Port Type
                    </label>
                    <select
                      value={editPortType}
                      onChange={(e) => setEditPortType(e.target.value)}
                      className="w-full h-10 rounded-xl px-3 outline-none text-white text-sm bg-slate-950 border border-white/15 focus:border-amber-400 cursor-pointer"
                    >
                      <option value="Dry Port" className="bg-slate-900">Dry Port (Inland)</option>
                      <option value="Sea Port" className="bg-slate-900">Sea Port (Coastal)</option>
                      <option value="Border Terminal" className="bg-slate-900">Border Terminal</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Container Inquiry Link (Wharfage Official Website)
                  </label>
                  <div className="relative">
                    <ExternalLink size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="url" 
                      placeholder="https://www.kictl.com or official port link" 
                      value={editPortInquiryLink}
                      onChange={(e) => setEditPortInquiryLink(e.target.value)}
                      className="w-full h-10 rounded-xl pl-9 pr-3.5 outline-none text-white text-xs bg-slate-950 border border-white/15 focus:border-amber-400 font-mono"
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-xs">
                    <span className="text-slate-400">Opens when clicking 'Check Wharfage'</span>
                    {editPortInquiryLink && (
                      <button
                        type="button"
                        onClick={() => window.open(editPortInquiryLink, '_blank', 'noopener,noreferrer')}
                        className="text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold underline cursor-pointer"
                      >
                        <ExternalLink size={12} /> Test Link
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-white/10 bg-slate-950/60 flex justify-end gap-2.5 shrink-0">
              <button 
                type="button"
                onClick={() => setShowEditPortModal(false)}
                className="h-10 px-4 bg-white/10 hover:bg-white/15 text-slate-300 rounded-xl font-semibold text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={handleSaveEditedPort}
                disabled={!editPortName.trim()}
                className="h-10 px-5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Save size={15} /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-Featured Client Registration & Default Tariff Modal */}
      <ClientRegistrationModal
        isOpen={showAddClientModal}
        onClose={() => setShowAddClientModal(false)}
        initialClient={clientsData.find(c => c.name?.toLowerCase() === formData.client?.toLowerCase()) || null}
        defaultCategory={formData.category || 'Bonded Carrier'}
        onSave={(client) => {
          setClientsData(prev => [client, ...prev.filter(c => c.name.toLowerCase() !== client.name.toLowerCase())]);
          setRegisteredClients(prev => Array.from(new Set([client.name, ...prev])));

          const targetCat = client.defaultCaseCategory || formData.category || 'Bonded Carrier';
          const resolved = resolveCaseCharges(client, targetCat);

          setFormData(prev => ({
            ...prev,
            client: client.name,
            category: targetCat,
            serviceArrangements: resolved.arrangements as any,
            charges: resolved.charges
          }));

          setIsOtherClient(false);
          setOtherClientName('');
          setShowAddClientModal(false);
          setDraftToast(`✓ Client "${client.name}" saved with ${resolved.charges.length} default charges for ${targetCat}!`);
        }}
      />

      {/* Smart Case Search & Advanced Query Modal */}
      <SmartCaseSearchModal
        isOpen={showSmartSearchModal}
        onClose={() => setShowSmartSearchModal(false)}
        cases={cases}
        clients={clientsData}
        onSelectCase={(caseItem) => {
          setSelectedCase(caseItem);
          setView('details');
        }}
      />

      {/* Live Camera Document Scanner Modal */}
      <CameraDocumentScannerModal
        isOpen={showCaseDocScanner}
        onClose={() => setShowCaseDocScanner(false)}
        documentTitle="Shipping Document (B/L, Commercial Invoice, Packing List, GD)"
        suggestedFileName={`Scanned_Shipping_Doc_${Date.now()}`}
        onScanComplete={(result) => {
          setShowCaseDocScanner(false);
          processFiles([result.file]);
        }}
      />

      {/* Dedicated In-App PDF Viewer Modal */}
      <PdfViewerModal
        isOpen={isPdfViewerOpen}
        onClose={() => setIsPdfViewerOpen(false)}
        pdfUrl={directDownloadUrl}
        filename={directDownloadFilename}
        title={printOptions.onlyInvoice ? "Invoice" : "Case Details"}
      />

      {/* Admin Approval Request Modal for Finished Cases */}
      {showApprovalPromptModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center pt-8 sm:pt-14 p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="glass-card p-6 rounded-2xl w-full max-w-lg border border-amber-500/30 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-amber-400 font-bold text-base">
                <ShieldCheck size={20} className="text-amber-400" />
                <span>Admin Approval Required</span>
              </div>
              <button onClick={() => setShowApprovalPromptModal(false)} className="text-gray-400 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200 space-y-1">
              <p className="font-semibold text-white">This case has finished its operational lifecycle.</p>
              <p className="text-gray-300 leading-relaxed">
                Under company operating rules, any <span className="text-amber-300 font-bold uppercase">{approvalTargetAction}</span> action on a completed case requires Super Admin review and authorization.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300 block">
                Reason / Justification for {approvalTargetAction} *
              </label>
              <textarea
                rows={3}
                placeholder={`Explain why this completed case needs to be ${approvalTargetAction.toLowerCase()}ed...`}
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
                className="w-full bg-black/40 border border-white/15 rounded-xl p-3 text-white text-xs sm:text-sm outline-none focus:border-amber-400 placeholder:text-gray-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowApprovalPromptModal(false)}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm text-gray-300 hover:text-white hover:bg-white/5 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!approvalReason.trim() || isSubmittingApproval}
                onClick={handleSubmitFinishedCaseApproval}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition shadow-lg shadow-amber-600/30 flex items-center gap-1.5"
              >
                {isSubmittingApproval ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                <span>Submit for Approval</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CaseManagement;
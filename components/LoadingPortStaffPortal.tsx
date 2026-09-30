import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Ship, FolderKanban, Clock, FileText, Search, Download, 
  CheckCircle2, Plus, LogOut, MapPin, Truck, AlertTriangle, 
  User, CreditCard, ChevronRight, RefreshCw, Filter, Layers, 
  ShieldCheck, ArrowUpRight, ArrowDownLeft, FileCheck, Receipt, Eye,
  Calendar, Box, DollarSign, X, Menu, ChevronDown, Check, Anchor
} from 'lucide-react';
import { Case, CaseStatus, UserRole, StaffLoadingBill, StaffPrivateLedgerEntry, Container } from '../types';
import { subscribeToCases, subscribeToStaffBills, subscribeToStaffPrivateLedger, saveCaseToFirestore } from '../services/dbService';
import { useBranding } from '../services/brandingService';
import Logo from './Logo';
import { FullCaseDetailModal } from './FullCaseDetailModal';
import { WorkflowStepModal } from './WorkflowStepModal';
import { PortSearchCaseModal } from './PortSearchCaseModal';
import { DownloadLoadingBillSearchModal, DownloadClientLedgerModal, AddStaffPaymentModal } from './PortFinanceModals';
import { downloadLoadingBillPdf } from '../services/pdfExportService';
import { LiveNotificationCenter } from './LiveNotificationCenter';
import { PWAInstallButton } from './PWAInstallButton';

interface LoadingPortStaffPortalProps {
  onSignOut: () => void;
  userRole?: UserRole;
  userRoles?: UserRole[];
  staffUserId?: string;
  staffUserName?: string;
}

interface DueBillItem {
  bill: StaffLoadingBill;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  containerNo: string;
  port: string;
  date: string;
  clientName: string;
  caseNo: string;
}

export const LoadingPortStaffPortal: React.FC<LoadingPortStaffPortalProps> = ({
  onSignOut,
  userRole = UserRole.LOADING_PORT_STAFF,
  userRoles = [],
  staffUserId = 'mohsin',
  staffUserName = 'Mohsin Khan'
}) => {
  const { customLogo, companyName } = useBranding();
  
  // Navigation State: 'cases' | 'pending' | 'finance'
  const [activeTab, setActiveTab] = useState<'cases' | 'pending' | 'finance'>('cases');

  const [cases, setCases] = useState<Case[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [staffBills, setStaffBills] = useState<StaffLoadingBill[]>([]);
  const [staffLedger, setStaffLedger] = useState<StaffPrivateLedgerEntry[]>([]);

  // Modals state
  const [selectedCaseForDetail, setSelectedCaseForDetail] = useState<Case | null>(null);
  const [selectedCaseForWorkflow, setSelectedCaseForWorkflow] = useState<Case | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showDownloadBillModal, setShowDownloadBillModal] = useState(false);
  const [showDownloadLedgerModal, setShowDownloadLedgerModal] = useState(false);
  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);
  const [selectedDueBill, setSelectedDueBill] = useState<DueBillItem | null>(null);

  // Search in cases list
  const [casesSearchQuery, setCasesSearchQuery] = useState('');

  // Dynamic feedback toast
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Mobile navigation drawer state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Check if destination staff
  const isDestinationStaff = 
    userRole === UserRole.DESTINATION_PORT_STAFF || 
    userRole === UserRole.UNLOADING_PORT_STAFF || 
    userRoles.includes(UserRole.DESTINATION_PORT_STAFF) || 
    userRoles.includes(UserRole.UNLOADING_PORT_STAFF);

  const staffStation = isDestinationStaff ? 'Destination / Offloading Station' : 'Karachi Port Terminals Node';

  // Dynamic Port filtering for Pending Cases
  const [activePortFilter, setActivePortFilter] = useState<string>('ALL');
  const [isPortDropdownOpen, setIsPortDropdownOpen] = useState(false);
  const portDropdownRef = useRef<HTMLDivElement>(null);

  // Close port dropdown on outside click or Escape key
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (portDropdownRef.current && !portDropdownRef.current.contains(e.target as Node)) {
        setIsPortDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPortDropdownOpen(false);
      }
    };
    if (isPortDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPortDropdownOpen]);

  // Subscribe to live cases
  useEffect(() => {
    setLoadingCases(true);
    const unsubCases = subscribeToCases((items) => {
      setCases(items || []);
      setLoadingCases(false);
    });
    return () => unsubCases();
  }, []);

  // Subscribe to staff private bills & ledgers isolated by staffUserId
  useEffect(() => {
    const unsubBills = subscribeToStaffBills(staffUserId, (billsList) => {
      setStaffBills(billsList || []);
    });

    const unsubLedger = subscribeToStaffPrivateLedger(staffUserId, (entries) => {
      setStaffLedger(entries || []);
    });

    return () => {
      unsubBills();
      unsubLedger();
    };
  }, [staffUserId]);

  const showToast = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => {
      setFeedbackMessage(null);
    }, 6000);
  };

  // ============================================================
  // 1. PENDING CASES: Only cases whose workflow is CURRENTLY at loading
  // and gate out has NOT been completed.
  // When loading completes and vehicle gates out, case disappears!
  // ============================================================
  const pendingCases = useMemo(() => {
    return cases.filter(c => {
      if (isDestinationStaff) {
        const destStep = c.workflowDetails?.[CaseStatus.DESTINATION_PORT_ARRIVAL];
        const isDestDone = destStep?.unloaded === true || destStep?.gateOutVehicle === true || c.status === CaseStatus.COMPLETED;
        return !isDestDone && (c.status === CaseStatus.IN_TRANSIT || c.status === CaseStatus.DESTINATION_PORT_ARRIVAL);
      }

      // Loading staff:
      // The case has reached loading workflow (or is an active case prior to departure)
      // AND loading is NOT complete / vehicle has NOT gated out
      const loadingStep = c.workflowDetails?.[CaseStatus.LOADING_PORT_PROCESSING];
      const isGateOut = 
        loadingStep?.gateOutToggled === true || 
        loadingStep?.gateOutVehicle === true || 
        loadingStep?.status === 'COMPLETED' ||
        loadingStep?.status === 'GATE_OUT';

      const isDeparted = 
        c.status === CaseStatus.IN_TRANSIT || 
        c.status === CaseStatus.DESTINATION_PORT_ARRIVAL || 
        c.status === CaseStatus.COMPLETED;

      if (isGateOut || isDeparted) {
        return false;
      }

      // Active pending loading case
      return true;
    });
  }, [cases, isDestinationStaff]);

  // ============================================================
  // Dynamic Port Pills: Derived ONLY from CURRENT pending loading cases!
  // If KICT has pending cases, KICT pill shows. When all cases complete & gate out, KICT disappears!
  // ============================================================
  const availablePendingPorts = useMemo(() => {
    const portMap = new Map<string, number>();
    pendingCases.forEach(c => {
      const portRaw = isDestinationStaff ? c.pod : c.pol;
      const portName = (portRaw || 'Other').trim();
      if (portName) {
        portMap.set(portName, (portMap.get(portName) || 0) + 1);
      }
    });

    const list: Array<{ id: string; label: string; count: number }> = [];
    list.push({ id: 'ALL', label: 'All Ports', count: pendingCases.length });

    portMap.forEach((count, port) => {
      list.push({
        id: port,
        label: port,
        count
      });
    });

    return list;
  }, [pendingCases, isDestinationStaff]);

  // Auto reset activePortFilter if the selected port has disappeared
  useEffect(() => {
    if (activePortFilter !== 'ALL' && !availablePendingPorts.some(p => p.id.toUpperCase() === activePortFilter.toUpperCase())) {
      setActivePortFilter('ALL');
    }
  }, [availablePendingPorts, activePortFilter]);

  // Current Filtered Pending Cases by Selected Port
  const currentFilteredCases = useMemo(() => {
    if (activePortFilter === 'ALL') return pendingCases;
    const target = activePortFilter.toUpperCase().trim();
    return pendingCases.filter(c => {
      const port = ((isDestinationStaff ? c.pod : c.pol) || '').toUpperCase().trim();
      return port === target || port.includes(target) || target.includes(port);
    });
  }, [pendingCases, activePortFilter, isDestinationStaff]);

  // ============================================================
  // Cases Tab Filtered List (Search Query)
  // ============================================================
  const filteredAllCases = useMemo(() => {
    if (!casesSearchQuery.trim()) return cases;
    const q = casesSearchQuery.toLowerCase().trim();
    return cases.filter(c => {
      const matchNo = (c.caseNo || '').toLowerCase().includes(q);
      const matchClient = (c.clientName || '').toLowerCase().includes(q);
      const matchCntr = (c.containers || []).some(cn => (cn.number || '').toLowerCase().includes(q));
      const matchPol = (c.pol || '').toLowerCase().includes(q);
      const matchPod = (c.pod || '').toLowerCase().includes(q);
      return matchNo || matchClient || matchCntr || matchPol || matchPod;
    });
  }, [cases, casesSearchQuery]);

  // ============================================================
  // 4. Finance: Bill Payment Dues (FIFO cleared by client payments)
  // Example: Client has 4 bills of 2500 (total 10,000) and paid 9,000.
  // Chronological FIFO clears the first 3 bills completely (2500 x 3 = 7500).
  // Fourth bill has 1500 paid, 1000 balance remaining.
  // ONLY this fourth bill appears in "Bill Payment Dues" showing 1500 paid, 1000 balance!
  // ============================================================
  const dueBills = useMemo(() => {
    // 1. Group all staff bills by clientName
    const clientBillsMap: Record<string, StaffLoadingBill[]> = {};
    staffBills.forEach(b => {
      const client = (b.clientName || 'General Client').trim();
      if (!clientBillsMap[client]) clientBillsMap[client] = [];
      clientBillsMap[client].push(b);
    });

    // 2. Sum total payments received per client from staffLedger (credit entries)
    const clientPaymentsMap: Record<string, number> = {};
    staffLedger.forEach(e => {
      const client = (e.clientName || '').trim();
      if (client && Number(e.credit || 0) > 0) {
        clientPaymentsMap[client] = (clientPaymentsMap[client] || 0) + Number(e.credit);
      }
    });

    const result: DueBillItem[] = [];

    // 3. For each client, sort bills chronologically (FIFO order by date / case registration)
    Object.keys(clientBillsMap).forEach(client => {
      const bills = [...clientBillsMap[client]].sort((a, b) => {
        const timeA = new Date(a.date || a.createdAt || 0).getTime();
        const timeB = new Date(b.date || b.createdAt || 0).getTime();
        return timeA - timeB;
      });

      let remainingPayment = clientPaymentsMap[client] || 0;

      bills.forEach(b => {
        const billTotal = Number(b.totalAmount) || 0;
        let billPaid = 0;
        let billBalance = billTotal;

        if (remainingPayment >= billTotal) {
          billPaid = billTotal;
          billBalance = 0;
          remainingPayment -= billTotal;
        } else if (remainingPayment > 0) {
          billPaid = remainingPayment;
          billBalance = billTotal - remainingPayment;
          remainingPayment = 0;
        } else {
          billPaid = 0;
          billBalance = billTotal;
        }

        // Only bills with remaining unpaid balance > 0 appear in Bill Payment Dues
        if (billBalance > 0) {
          const matchingCase = cases.find(c => c.caseNo === b.caseNo || c.id === b.caseNo);
          const port = b.portTerminal || matchingCase?.pol || matchingCase?.pod || 'Karachi Port';

          result.push({
            bill: b,
            totalAmount: billTotal,
            paidAmount: billPaid,
            balanceDue: billBalance,
            containerNo: b.containerNo || matchingCase?.containers?.[0]?.number || 'Container',
            port,
            date: b.date || b.createdAt?.split('T')[0] || new Date().toISOString().split('T')[0],
            clientName: client,
            caseNo: b.caseNo || '-'
          });
        }
      });
    });

    // Sort due bills with newest date first
    return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [staffBills, staffLedger, cases]);

  // Unique clients list for Add Payment modal
  const uniqueClients = useMemo(() => {
    const set = new Set<string>();
    cases.forEach(c => { if (c.clientName) set.add(c.clientName); });
    staffBills.forEach(b => { if (b.clientName) set.add(b.clientName); });
    staffLedger.forEach(e => { if (e.clientName) set.add(e.clientName); });
    return Array.from(set).sort();
  }, [cases, staffBills, staffLedger]);

  return (
    <div className="flex h-screen h-[100dvh] w-full bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* ============================================================ */}
      {/* SIDEBAR: Dedicated Loading & Offloading Staff Navigation */}
      {/* ============================================================ */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-slate-900/98 backdrop-blur-xl border-r border-white/10 flex flex-col justify-between shrink-0 shadow-2xl transition-transform duration-300 lg:static lg:w-64 lg:translate-x-0 ${
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-4 space-y-6">
          {/* Logo & Portal Identity */}
          <div className="px-2 pt-1 flex items-start justify-between">
            <div>
              <Logo className="h-9 w-auto max-w-[150px] mb-2" />
              <div className="space-y-0.5">
                <span className="text-xs font-black text-white tracking-wider uppercase block">
                  {isDestinationStaff ? 'Destination Staff Portal' : 'Loading Staff Portal'}
                </span>
                <span className="text-[10px] text-amber-400 font-mono tracking-wider block">
                  {staffStation}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden text-gray-400 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition"
              title="Close Navigation"
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigation Links (Cases, Pending Cases, Finance) */}
          <nav className="space-y-1.5">
            {/* 1. Cases */}
            <button
              type="button"
              onClick={() => {
                setActiveTab('cases');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl font-bold text-xs transition-all ${
                activeTab === 'cases'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <FolderKanban size={17} />
                <span>Cases</span>
              </div>
              <span className={`px-2 py-0.5 text-[10px] rounded-full font-mono font-bold ${
                activeTab === 'cases' ? 'bg-black/20 text-slate-950' : 'bg-white/10 text-gray-400'
              }`}>
                {cases.length}
              </span>
            </button>

            {/* 2. Pending Cases */}
            <button
              type="button"
              onClick={() => {
                setActiveTab('pending');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl font-bold text-xs transition-all ${
                activeTab === 'pending'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <Clock size={17} />
                <span>Pending Cases</span>
              </div>
              <span className={`px-2 py-0.5 text-[10px] rounded-full font-mono font-bold ${
                activeTab === 'pending' ? 'bg-black/20 text-slate-950' : 'bg-amber-500/20 text-amber-300'
              }`}>
                {pendingCases.length}
              </span>
            </button>

            {/* 3. Finance */}
            <button
              type="button"
              onClick={() => {
                setActiveTab('finance');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl font-bold text-xs transition-all ${
                activeTab === 'finance'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <CreditCard size={17} />
                <span>Finance</span>
              </div>
              <span className={`px-2 py-0.5 text-[10px] rounded-full font-mono font-bold ${
                activeTab === 'finance' ? 'bg-black/20 text-slate-950' : dueBills.length > 0 ? 'bg-red-500/20 text-red-300' : 'bg-white/10 text-gray-400'
              }`}>
                {dueBills.length}
              </span>
            </button>
          </nav>
        </div>

        {/* Staff User Card & Sign Out */}
        <div className="p-4 border-t border-white/10 bg-slate-950/40 space-y-3">
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="w-8 h-8 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 flex items-center justify-center font-bold text-xs shrink-0">
              {staffUserName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-white block truncate">{staffUserName}</span>
              <span className="text-[10px] text-gray-400 block font-mono">ID: {staffUserId}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 hover:text-red-300 rounded-xl text-xs font-bold transition"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ============================================================ */}
      {/* MAIN VIEW CONTENT CONTAINER */}
      {/* ============================================================ */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scrollbar">
        
        {/* Desktop Header Bar */}
        <header className="hidden lg:flex h-16 bg-slate-900/60 backdrop-blur-md border-b border-white/10 px-6 items-center justify-between shrink-0 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white tracking-wide">
              {isDestinationStaff ? 'Destination Staff Operations' : 'Loading Port Staff Operations'}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {activeTab === 'cases' ? 'All Cases' : activeTab === 'pending' ? 'Pending Loading' : 'Port Finance'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <PWAInstallButton variant="header" />
            <LiveNotificationCenter
              currentRole={userRole}
              currentRoles={userRoles}
              userIdentifier={staffUserId}
              onNavigateToCase={(caseNo) => {
                setActiveTab('cases');
                setCasesSearchQuery(caseNo);
              }}
              onNavigateToTab={(tab) => {
                if (tab === 'finance') setActiveTab('finance');
                else if (tab === 'pending') setActiveTab('pending');
                else setActiveTab('cases');
              }}
            />
          </div>
        </header>

        {/* Mobile Header Bar */}
        <header className="lg:hidden h-14 bg-slate-900/95 backdrop-blur-md border-b border-white/10 px-3 sm:px-4 flex items-center justify-between shrink-0 z-30 sticky top-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition active:scale-95"
              title="Open Navigation Menu"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <Logo variant="icon" className="h-7 w-auto shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-bold text-white block truncate">
                  {isDestinationStaff ? 'Destination Staff' : 'Loading Staff'}
                </span>
                <span className="text-[10px] text-amber-400 block font-mono truncate">
                  {activeTab === 'cases' ? 'Cases Directory' : activeTab === 'pending' ? 'Pending Loading' : 'Port Finance'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <LiveNotificationCenter
              currentRole={userRole}
              currentRoles={userRoles}
              userIdentifier={staffUserId}
              onNavigateToCase={(caseNo) => {
                setActiveTab('cases');
                setCasesSearchQuery(caseNo);
              }}
              onNavigateToTab={(tab) => {
                if (tab === 'finance') setActiveTab('finance');
                else if (tab === 'pending') setActiveTab('pending');
                else setActiveTab('cases');
              }}
            />
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase">
              {activeTab}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition active:scale-95"
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {/* Dynamic Toast Feedback Notification */}
        {feedbackMessage && (
          <div className="fixed top-5 right-5 z-50 bg-gradient-to-r from-slate-900 to-slate-950 border-l-4 border-amber-400 text-amber-200 p-4 rounded-2xl shadow-2xl flex items-start gap-3 max-w-md animate-in slide-in-from-top-3">
            <CheckCircle2 className="text-amber-400 shrink-0 mt-0.5" size={18} />
            <div className="text-xs font-medium leading-relaxed flex-1">{feedbackMessage}</div>
            <button onClick={() => setFeedbackMessage(null)} className="text-gray-400 hover:text-white font-bold text-xs">✕</button>
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEW 1: CASES (Clean List / Table Format - NOT Big Button Cards) */}
        {/* ============================================================ */}
        {activeTab === 'cases' && (
          <div className="p-3.5 sm:p-6 max-w-7xl w-full mx-auto space-y-4 sm:space-y-6">
            
            {/* Top Bar with Search & Filter */}
            <div className="bg-slate-900/60 p-4 sm:p-5 rounded-3xl border border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 shadow-xl">
              <div>
                <h2 className="text-base font-bold text-white tracking-wide">Cases & Shipments Registry</h2>
                <p className="text-xs text-gray-400">Complete itemized directory of all registered cases and containers</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Search Input in Cases */}
                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Filter by case, client, container..."
                    value={casesSearchQuery}
                    onChange={(e) => setCasesSearchQuery(e.target.value)}
                    className="w-full bg-slate-950/80 border border-white/10 rounded-2xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-400 outline-none focus:border-amber-400"
                  />
                  {casesSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCasesSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Big Search Modal Button */}
                <button
                  type="button"
                  onClick={() => setShowSearchModal(true)}
                  className="bg-brand-600 hover:bg-brand-500 text-white font-bold px-4 py-2 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-brand-600/25 transition active:scale-95 shrink-0"
                >
                  <Search size={14} />
                  <span>Advanced Search</span>
                </button>
              </div>
            </div>

            {/* List / Table Format of Cases */}
            <div className="bg-slate-900/70 border border-white/10 rounded-3xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-white/10 flex items-center justify-between text-xs">
                <span className="font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <FolderKanban size={15} className="text-amber-400" />
                  <span>Cases List ({filteredAllCases.length})</span>
                </span>
                <span className="text-[11px] text-gray-400">Click any row to open full case details & download documents</span>
              </div>

              {loadingCases ? (
                <div className="text-center py-16 text-gray-400 flex flex-col items-center gap-2">
                  <RefreshCw size={24} className="animate-spin text-amber-400" />
                  <span className="text-xs">Loading cases directory...</span>
                </div>
              ) : filteredAllCases.length === 0 ? (
                <div className="p-12 text-center text-gray-400 text-xs italic">
                  No cases found matching your search.
                </div>
              ) : (
                <>
                  {/* Mobile Cards View */}
                  <div className="block md:hidden divide-y divide-white/5">
                    {filteredAllCases.map((c, cIdx) => {
                      const cntr = c.containers?.[0];
                      return (
                        <div
                          key={`port_case_mob_${c.id || cIdx}_${cIdx}`}
                          onClick={() => setSelectedCaseForDetail(c)}
                          className="p-3.5 hover:bg-white/[0.04] transition-colors cursor-pointer space-y-2 active:bg-white/[0.08]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-bold text-xs text-amber-400">{c.caseNo}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              c.status === CaseStatus.COMPLETED ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                              c.status === CaseStatus.IN_TRANSIT ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                              'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            }`}>
                              {c.status}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-mono text-gray-200 font-bold">{cntr?.number || 'Container TBD'}</span>
                            <span className="text-gray-400 font-medium truncate max-w-[150px]">{c.clientName}</span>
                          </div>
                          <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] text-gray-400">
                            <span className="truncate max-w-[200px]">{c.pol && c.pod ? `${c.pol} → ${c.pod}` : 'Karachi Port'}</span>
                            <span className="text-brand-300 font-bold flex items-center gap-1 shrink-0">
                              <Eye size={12} /> Inspect
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop Full Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 text-gray-400 uppercase text-[10px] font-bold border-b border-white/10">
                        <tr>
                          <th className="p-3.5">Case No</th>
                          <th className="p-3.5">Container No</th>
                          <th className="p-3.5">Client Name</th>
                          <th className="p-3.5">Route</th>
                          <th className="p-3.5">Assigned Truck</th>
                          <th className="p-3.5">Date</th>
                          <th className="p-3.5">Status</th>
                          <th className="p-3.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredAllCases.map((c, cIdx) => {
                          const cntr = c.containers?.[0];
                          return (
                            <tr
                              key={`port_case_row_${c.id || cIdx}_${cIdx}`}
                              onClick={() => setSelectedCaseForDetail(c)}
                              className="hover:bg-white/[0.03] transition-colors cursor-pointer group"
                            >
                              <td className="p-3.5 font-mono font-bold text-white group-hover:text-amber-400 transition-colors">
                                {c.caseNo}
                              </td>
                              <td className="p-3.5 font-mono text-gray-200">
                                <span className="font-bold">{cntr?.number || 'TBD'}</span>
                                {cntr?.size && <span className="text-[10px] text-gray-400 ml-1">({cntr.size})</span>}
                              </td>
                              <td className="p-3.5 text-gray-200 font-medium">
                                {c.clientName}
                              </td>
                              <td className="p-3.5 text-gray-300 font-mono text-[11px]">
                                {c.pol && c.pod ? `${c.pol} → ${c.pod}` : 'Karachi Port'}
                              </td>
                              <td className="p-3.5 font-mono text-amber-300">
                                {cntr?.vehicleNo || 'Awaiting'}
                              </td>
                              <td className="p-3.5 text-gray-400">
                                {c.createdAt || '-'}
                              </td>
                              <td className="p-3.5">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                  c.status === CaseStatus.COMPLETED ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                  c.status === CaseStatus.IN_TRANSIT ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                  'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                }`}>
                                  {c.status}
                                </span>
                              </td>
                              <td className="p-3.5 text-center">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedCaseForDetail(c);
                                  }}
                                  className="px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-brand-300 border border-white/10 text-[11px] font-bold inline-flex items-center gap-1 transition"
                                >
                                  <Eye size={12} />
                                  <span>Inspect</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

          </div>
        )}

        {/* ============================================================ */}
        {/* VIEW 2: PENDING CASES (Dynamic Port Pills + Opens Loading Workflow Popup) */}
        {/* ============================================================ */}
        {activeTab === 'pending' && (
          <div className="p-3.5 sm:p-6 max-w-7xl w-full mx-auto space-y-4 sm:space-y-6">
            
            {/* Header & Dynamic Port Filter Dropdown */}
            <div className="bg-slate-900/60 p-4 sm:p-5 rounded-3xl border border-white/10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 shadow-xl relative">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                    <Ship size={18} />
                  </span>
                  <h2 className="text-base font-bold text-white tracking-wide">
                    Pending Loading Cases ({pendingCases.length})
                  </h2>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Select a port from the dropdown below to see pending loading cases for that terminal.
                </p>
              </div>

              {/* Dynamic Port Dropdown: Clicking / pressing opens the list of ports with pending loading */}
              <div className="relative shrink-0" ref={portDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsPortDropdownOpen(!isPortDropdownOpen)}
                  className={`w-full md:w-auto px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center justify-between gap-3.5 border shadow-lg ${
                    isPortDropdownOpen
                      ? 'bg-slate-800 border-amber-400 ring-2 ring-amber-400/20 text-white'
                      : 'bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border-amber-500/30 hover:border-amber-500/60 text-white hover:bg-slate-850'
                  }`}
                  title="Click to view ports with pending loading"
                >
                  <div className="flex items-center gap-2.5 text-left min-w-0">
                    <div className="p-1.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                      <Anchor size={15} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] text-gray-400 block uppercase tracking-wider font-semibold">
                        Port Filter
                      </span>
                      <span className="text-xs font-black text-amber-300 truncate block max-w-[140px] xs:max-w-[170px] sm:max-w-[200px]">
                        {availablePendingPorts.find(p => p.id.toUpperCase() === activePortFilter.toUpperCase())?.label || 'All Ports'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-amber-500 text-slate-950 shadow-sm">
                      {availablePendingPorts.find(p => p.id.toUpperCase() === activePortFilter.toUpperCase())?.count || 0} Pending
                    </span>
                    <ChevronDown 
                      size={17} 
                      className={`text-gray-400 transition-transform duration-200 ${
                        isPortDropdownOpen ? 'rotate-180 text-amber-400' : ''
                      }`} 
                    />
                  </div>
                </button>

                {/* Dropdown Menu List: Shows which ports have pending loading */}
                {isPortDropdownOpen && (
                  <div className="absolute right-0 left-0 md:left-auto md:w-80 mt-2 bg-slate-900/95 backdrop-blur-xl border border-amber-500/30 rounded-2xl shadow-2xl z-50 p-2 overflow-hidden animate-fade-in divide-y divide-white/10">
                    <div className="px-3 py-2 bg-slate-950/40 rounded-xl mb-1.5 border border-white/5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                          <MapPin size={13} className="text-amber-400" />
                          Pending Loading Ports
                        </span>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {availablePendingPorts.filter(p => p.id !== 'ALL').length} Active
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Select a port to filter pending loading operations
                      </p>
                    </div>

                    <div className="py-1 max-h-64 overflow-y-auto custom-scrollbar space-y-1">
                      {availablePendingPorts.map((p, pIdx) => {
                        const isSelected = activePortFilter.toUpperCase() === p.id.toUpperCase();
                        const isAll = p.id === 'ALL';
                        return (
                          <button
                            key={`port_btn_${p.id || pIdx}_${pIdx}`}
                            type="button"
                            onClick={() => {
                              setActivePortFilter(p.id);
                              setIsPortDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs transition text-left group ${
                              isSelected
                                ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                                : 'text-gray-300 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className={`p-1.5 rounded-lg shrink-0 ${
                                isSelected 
                                  ? 'bg-black/20 text-slate-950' 
                                  : 'bg-white/5 text-amber-400 group-hover:bg-amber-500/20'
                              }`}>
                                {isAll ? <Layers size={14} /> : <Ship size={14} />}
                              </span>
                              <div className="min-w-0">
                                <span className="block truncate font-bold text-xs">
                                  {p.label}
                                </span>
                                <span className={`text-[10px] block ${
                                  isSelected ? 'text-slate-950/80 font-semibold' : 'text-gray-400'
                                }`}>
                                  {isAll ? 'All Active Terminals' : 'Pending Loading Operations'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                                isSelected 
                                  ? 'bg-black/20 text-slate-950' 
                                  : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              }`}>
                                {p.count} {p.count === 1 ? 'case' : 'cases'}
                              </span>
                              {isSelected && <Check size={14} className="text-slate-950 font-bold" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* List of Pending Containers for Updating */}
            {currentFilteredCases.length === 0 ? (
              <div className="p-12 text-center bg-slate-900/30 rounded-3xl border border-dashed border-white/10 space-y-2">
                <Ship size={36} className="mx-auto text-gray-500 opacity-60" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">No pending cases under this terminal</h3>
                <p className="text-xs text-gray-400 max-w-sm mx-auto">
                  All containers under this terminal have finished loading and vehicle gate out.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  <span>Pending Container Shipments ({currentFilteredCases.length})</span>
                  <span>Click case to open loading workflow & bill</span>
                </div>

                {currentFilteredCases.map((c, cIdx) => {
                  const mainCntr = c.containers?.[0];
                  return (
                    <div
                      key={`port_wf_case_${c.id || cIdx}_${cIdx}`}
                      onClick={() => setSelectedCaseForWorkflow(c)}
                      className="p-4 sm:p-5 bg-slate-900/80 hover:bg-slate-900 border border-white/10 hover:border-amber-500/50 rounded-3xl cursor-pointer transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group shadow-md"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20 font-bold">
                          <Ship size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-white font-mono">{mainCntr?.number || 'Container TBD'}</span>
                            <span className="bg-white/5 border border-white/10 text-[10px] text-gray-400 font-bold px-2 py-0.5 rounded">
                              {mainCntr?.size || '40ft'}
                            </span>
                            <span className="font-mono text-amber-400 text-xs font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                              {c.caseNo}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-[11px] text-gray-400 font-medium">
                            <span className="text-gray-300 font-semibold">{c.clientName}</span>
                            <span className="text-slate-600">•</span>
                            <span className="flex items-center gap-1"><MapPin size={11} className="text-brand-400" /> {c.pol} → {c.pod}</span>
                            <span className="text-slate-600">•</span>
                            <span>Assigned Truck: <span className="text-amber-300 font-mono font-bold">{mainCntr?.vehicleNo || 'Awaiting'}</span></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-3 sm:pt-0 border-white/10">
                        <span className="bg-amber-400/10 text-amber-300 border border-amber-400/20 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1">
                          <Clock size={12} /> Loading Workflow
                        </span>
                        <ChevronRight size={18} className="text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* ============================================================ */}
        {/* VIEW 3: FINANCE (Download Bill + Download Ledger + Add Payment + Bill Payment Dues) */}
        {/* ============================================================ */}
        {activeTab === 'finance' && (
          <div className="p-3.5 sm:p-6 max-w-7xl w-full mx-auto space-y-4 sm:space-y-6">
            
            {/* Top Bar with 3 Main Actions: Download Loading Bill, Download Client Ledger, Add Payment */}
            <div className="bg-slate-900/60 p-4 sm:p-5 rounded-3xl border border-white/10 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 shadow-xl">
              <div>
                <h2 className="text-base font-bold text-white tracking-wide">Port Operations Private Finance Desk</h2>
                <p className="text-xs text-gray-400">
                  Manage port loading bills, client ledgers, and disbursement payments for ID <span className="text-amber-400 font-mono font-bold">{staffUserId}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                {/* 1. Download Loading Bill Button */}
                <button
                  type="button"
                  onClick={() => setShowDownloadBillModal(true)}
                  className="flex-1 sm:flex-none justify-center bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3.5 sm:px-4 py-2.5 rounded-2xl text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition active:scale-95"
                >
                  <Download size={14} />
                  <span>Download Loading Bill</span>
                </button>

                {/* 2. Download Client Ledger Button */}
                <button
                  type="button"
                  onClick={() => setShowDownloadLedgerModal(true)}
                  className="flex-1 sm:flex-none justify-center bg-brand-600 hover:bg-brand-500 text-white font-bold px-3.5 sm:px-4 py-2.5 rounded-2xl text-xs flex items-center gap-1.5 shadow-lg shadow-brand-600/20 transition active:scale-95"
                >
                  <FileText size={14} />
                  <span>Download Client Ledger</span>
                </button>

                {/* 3. Add Payment Button */}
                <button
                  type="button"
                  onClick={() => setShowAddPaymentModal(true)}
                  className="w-full sm:w-auto justify-center bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 sm:px-4 py-2.5 rounded-2xl text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 transition active:scale-95"
                >
                  <Plus size={14} />
                  <span>Add Payment</span>
                </button>
              </div>
            </div>

            {/* ============================================================ */}
            {/* BILL PAYMENT DUES SECTION (Replaces old Container with Pending Payments) */}
            {/* ============================================================ */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <CreditCard size={17} className="text-red-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Bill Payment Dues ({dueBills.length})
                  </h3>
                </div>
                <span className="text-[11px] text-gray-400">
                  Chronological FIFO settled bills; displaying bills with outstanding balances
                </span>
              </div>

              {dueBills.length === 0 ? (
                <div className="p-10 text-center bg-slate-900/40 rounded-3xl border border-dashed border-white/10 space-y-2">
                  <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
                  <h4 className="text-sm font-bold text-white">All Bills Cleared & Settled!</h4>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto">
                    There are no outstanding bill dues. All client payments have fully covered and cleared the generated bills.
                  </p>
                </div>
              ) : (
                <div className="bg-slate-900/80 border border-white/10 rounded-3xl overflow-hidden shadow-xl">
                  {/* Mobile Cards for Due Bills */}
                  <div className="block md:hidden divide-y divide-white/5">
                    {dueBills.map((item, idx) => (
                      <div
                        key={item.bill.id || item.bill.billNo || idx}
                        onClick={() => setSelectedDueBill(item)}
                        className="p-3.5 hover:bg-white/[0.04] transition-colors cursor-pointer space-y-2 active:bg-white/[0.08]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-xs text-amber-400">{item.containerNo}</span>
                          <span className="font-mono text-red-400 font-bold text-xs">
                            Due: PKR {item.balanceDue.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-gray-200 font-medium truncate max-w-[150px]">{item.clientName}</span>
                          <span className="text-[10px] text-gray-400 font-mono">{item.port}</span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] text-gray-400">
                          <span className="font-mono text-[10px]">Total: PKR {item.totalAmount.toLocaleString()} &bull; Paid: {item.paidAmount.toLocaleString()}</span>
                          <span className="text-red-300 font-bold flex items-center gap-1 shrink-0">
                            <Eye size={12} /> Inspect
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop Full Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 text-gray-400 uppercase text-[10px] font-bold border-b border-white/10">
                        <tr>
                          <th className="p-3.5">Date</th>
                          <th className="p-3.5">Container Number</th>
                          <th className="p-3.5">Port / Terminal</th>
                          <th className="p-3.5">Client Name</th>
                          <th className="p-3.5">Bill / Case No</th>
                          <th className="p-3.5 text-right">Total Amount</th>
                          <th className="p-3.5 text-right">Paid Amount</th>
                          <th className="p-3.5 text-right">Balance Due</th>
                          <th className="p-3.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {dueBills.map((item, idx) => (
                          <tr
                            key={item.bill.id || item.bill.billNo || idx}
                            onClick={() => setSelectedDueBill(item)}
                            className="hover:bg-white/[0.03] transition-colors cursor-pointer group"
                          >
                            <td className="p-3.5 font-mono text-gray-300">
                              {item.date}
                            </td>
                            <td className="p-3.5 font-mono font-bold text-white group-hover:text-amber-400 transition-colors">
                              {item.containerNo}
                            </td>
                            <td className="p-3.5 text-gray-300">
                              {item.port}
                            </td>
                            <td className="p-3.5 text-gray-200 font-medium">
                              {item.clientName}
                            </td>
                            <td className="p-3.5 font-mono text-amber-300">
                              {item.bill.billNo || item.caseNo}
                            </td>
                            <td className="p-3.5 text-right font-mono text-gray-300">
                              PKR {item.totalAmount.toLocaleString()}
                            </td>
                            <td className="p-3.5 text-right font-mono font-semibold text-emerald-400">
                              PKR {item.paidAmount.toLocaleString()}
                            </td>
                            <td className="p-3.5 text-right font-mono font-bold text-red-400">
                              PKR {item.balanceDue.toLocaleString()}
                            </td>
                            <td className="p-3.5 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDueBill(item);
                                }}
                                className="px-3 py-1 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 text-[11px] font-bold inline-flex items-center gap-1 transition"
                              >
                                <Eye size={12} />
                                <span>Inspect Due</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* ============================================================ */}
      {/* MODAL 1: FULL CASE DETAIL MODAL (Complete Case Management Experience) */}
      {/* ============================================================ */}
      {selectedCaseForDetail && (
        <FullCaseDetailModal
          isOpen={!!selectedCaseForDetail}
          onClose={() => setSelectedCaseForDetail(null)}
          targetCase={selectedCaseForDetail}
          userRole={userRole}
          userRoles={userRoles}
          staffName={staffUserName}
          onOpenWorkflowStep={(stepStatus, stepIndex, c) => {
            setSelectedCaseForDetail(null);
            setSelectedCaseForWorkflow(c);
          }}
        />
      )}

      {/* ============================================================ */}
      {/* MODAL 2: LOADING WORKFLOW MODAL (Exact same as Case Management) */}
      {/* ============================================================ */}
      {selectedCaseForWorkflow && (
        <WorkflowStepModal
          isOpen={!!selectedCaseForWorkflow}
          onClose={() => setSelectedCaseForWorkflow(null)}
          targetCase={selectedCaseForWorkflow}
          stepStatus={CaseStatus.LOADING_PORT_PROCESSING}
          stepIndex={4}
          userRole={userRole}
          userRoles={userRoles}
          onSaveCase={async (updatedCase) => {
            setCases(prev => prev.map(c => c.id === updatedCase.id ? updatedCase : c));
            setSelectedCaseForWorkflow(updatedCase);
            await saveCaseToFirestore(updatedCase);
            showToast(`✓ Case ${updatedCase.caseNo} loading workflow updated successfully!`);
          }}
        />
      )}

      {/* ============================================================ */}
      {/* MODAL 3: DUE BILL BREAKDOWN INSPECT MODAL */}
      {/* ============================================================ */}
      {selectedDueBill && (
        <div 
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm pt-8 p-4 overflow-y-auto"
          onClick={() => setSelectedDueBill(null)}
        >
          <div 
            className="relative w-full max-w-md bg-slate-900 border border-white/15 rounded-3xl shadow-2xl overflow-hidden p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center font-bold">
                  <CreditCard size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Bill Payment Dues Breakdown</h3>
                  <p className="text-[11px] text-gray-400 font-mono">{selectedDueBill.bill.billNo}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedDueBill(null)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2.5 rounded-xl bg-white/[0.02]">
                <span className="text-gray-400">Client:</span>
                <span className="text-white font-semibold">{selectedDueBill.clientName}</span>
              </div>
              <div className="flex justify-between p-2.5 rounded-xl bg-white/[0.02]">
                <span className="text-gray-400">Container:</span>
                <span className="text-white font-mono font-bold">{selectedDueBill.containerNo}</span>
              </div>
              <div className="flex justify-between p-2.5 rounded-xl bg-white/[0.02]">
                <span className="text-gray-400">Port / Terminal:</span>
                <span className="text-gray-200">{selectedDueBill.port}</span>
              </div>
              <div className="flex justify-between p-2.5 rounded-xl bg-white/[0.02]">
                <span className="text-gray-400">Bill Date:</span>
                <span className="text-gray-200 font-mono">{selectedDueBill.date}</span>
              </div>
            </div>

            {/* Financial Totals Pill */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-white/10 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Total Bill Amount:</span>
                <span className="text-white font-mono font-bold">PKR {selectedDueBill.totalAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-emerald-400 font-semibold">Total Paid (Allocated):</span>
                <span className="text-emerald-400 font-mono font-bold">PKR {selectedDueBill.paidAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-white/10">
                <span className="text-red-400 font-black">Remaining Balance Due:</span>
                <span className="text-red-400 font-mono font-black">PKR {selectedDueBill.balanceDue.toLocaleString()}</span>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  const b = selectedDueBill.bill;
                  downloadLoadingBillPdf({
                    billNo: b.billNo,
                    caseNo: selectedDueBill.caseNo,
                    clientName: selectedDueBill.clientName,
                    containerNo: selectedDueBill.containerNo,
                    vehicleNo: b.vehicleNo || '',
                    driverName: b.driverName || '',
                    portTerminal: selectedDueBill.port,
                    date: selectedDueBill.date,
                    items: (b.charges || []).map(ch => ({
                      head: ch.head,
                      amount: ch.amount,
                      receiptName: ch.receiptName,
                      receiptUrl: ch.receiptUrl
                    })),
                    totalAmount: selectedDueBill.totalAmount,
                    remarks: b.remarks || '',
                    officerName: staffUserName,
                    branding: { companyName, customLogo }
                  }).catch(console.error);
                }}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition border border-white/10"
              >
                <Download size={13} />
                <span>Download Bill PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedDueBill(null);
                  setShowAddPaymentModal(true);
                }}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-600/20"
              >
                <Plus size={13} />
                <span>Record Payment</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: ADVANCED SEARCH CASE MODAL */}
      <PortSearchCaseModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        cases={cases}
        onSelectCase={(c) => {
          setSelectedCaseForDetail(c);
          setShowSearchModal(false);
        }}
      />

      {/* MODAL 5: DOWNLOAD LOADING BILL SEARCH MODAL */}
      <DownloadLoadingBillSearchModal
        isOpen={showDownloadBillModal}
        onClose={() => setShowDownloadBillModal(false)}
        bills={staffBills}
        staffName={staffUserName}
      />

      {/* MODAL 6: DOWNLOAD CLIENT LEDGER MODAL */}
      <DownloadClientLedgerModal
        isOpen={showDownloadLedgerModal}
        onClose={() => setShowDownloadLedgerModal(false)}
        ledgerEntries={staffLedger}
        bills={staffBills}
        staffUserId={staffUserId}
        staffName={staffUserName}
      />

      {/* MODAL 7: ADD PAYMENT MODAL */}
      <AddStaffPaymentModal
        isOpen={showAddPaymentModal}
        onClose={() => setShowAddPaymentModal(false)}
        staffUserId={staffUserId}
        staffName={staffUserName}
        clients={uniqueClients}
        onPaymentAdded={(entry) => {
          setStaffLedger(prev => [entry, ...prev]);
          showToast(`✓ Payment of PKR ${entry.credit?.toLocaleString()} recorded for ${entry.clientName}!`);
        }}
      />

    </div>
  );
};

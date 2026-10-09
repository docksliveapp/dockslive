import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, CartesianGrid
} from 'recharts';
import { 
  AlertTriangle, Truck, Anchor, DollarSign, Activity, 
  FileText, CheckCircle, Clock, Sparkles, RefreshCw, AlertCircle, Calendar, TrendingUp, TrendingDown, Crosshair, ArrowRight, BarChart2, Filter, X,
  Building2, MapPin, Search, Download, ShieldCheck, Globe, ChevronDown, ChevronUp,
  Layers, CheckCircle2, Boxes
} from 'lucide-react';
import { LogEntry, CaseStatus, Case, Vehicle, FinanceEntry } from '../types';
import { subscribeToCases, subscribeToVehicles, subscribeToFinances } from '../services/dbService';
import { subscribeToActivityLogs, ActivityLogRecord } from '../services/activityLogService';
import { safeAppStorage } from '../services/storage';
import { 
  calculateStationMovements, 
  StationMovementDetail, 
  StationAnalyticsSummary 
} from '../services/stationAnalytics';
import { exportTableToExcel } from '../services/excelExportService';

// Data Generator based on real cases per date
const generateGraphData = (startStr: string, endStr: string, casesList: Case[] = []) => {
  const data = [];
  const end = new Date(endStr);
  const start = new Date(startStr);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays > 90) diffDays = 90; // Cap at 90 days for performance/looks
  const totalDays = diffDays + 1; // Inclusive

  let prevVal = 0; 

  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    
    // Count real containers/cases for this date
    const dayCases = casesList.filter(c => {
      const cDate = c.createdAt ? c.createdAt.split('T')[0] : '';
      return cDate === dateStr;
    });

    const val = dayCases.reduce((sum, c) => sum + (c.containers?.length || 1), 0);

    // Determine Trend
    const isBullish = val >= prevVal;

    // Format Day Label
    const dayNumeric = d.getDate();
    const isFirstOfMonth = dayNumeric === 1;
    const dayLabelStr = isFirstOfMonth 
      ? d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toUpperCase()
      : `${dayNumeric}`;

    data.push({
      id: totalDays - i,
      dayLabel: dayLabelStr,
      fullDate: d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }),
      containers: val,
      prevVal: prevVal,
      trend: isBullish ? 'UP' : 'DOWN',
      isToday: i === 0,
      isCritical: val > 100
    });

    prevVal = val;
  }
  return data;
};

// Fixed Y-Axis scale constraints
const yAxisMax = 120;
const yAxisTicks = [0, 20, 40, 60, 80, 100, 120];

// Full Ports List Extracted
const INTERN_SEAPORTS = [
  "Karachi Port Trust (KPT)", "Port Qasim (QICT)", "South Asia Pakistan Terminals (SAPT)", 
  "Karachi International Container Terminal (KICT)", "Karachi Gateway Terminal (KGTL)", 
  "Karachi Gateway Terminal Multipurpose (KGTML)", "Al-Hamd International Container Terminal (AICT)", "Gwadar Port"
];
const DRY_PORTS = [
  "Faisalabad Dry Port", "Lahore Dry Port", "Lahore NLC Dry Port", "Lahore MICT Dry Port", 
  "Lahore DPW Dry Port", "Rawalpindi Dry Port", "Multan Dry Port", "Sialkot Dry Port (SICT)", 
  "Islamabad Dry Port", "Azakhel Dry Port", "Havelian Dry Port", "Peshawar Dry Port", 
  "Jamrud Dry Port", "Quetta Railway Dry Port", "Quetta NLC Dry Port", "Gilgit Dry Port", 
  "Sost Dry Port", "Muzaffarabad Dry Port", "Karachi Dry Port", "Karachi NLC Dry Port", 
  "NLC Sultanabad"
];
const BORDER_TERMINALS = [
  "Wagha Border Terminal", "Torkham Border Terminal", "Chaman Border Terminal", "Taftan Border Terminal", 
  "Angur Ada", "Badini", "Ghulam Khan", "Kharlachi", "Mand"
];
// Mock Activity Log (Empty for fresh production start)
const INITIAL_LOGS: LogEntry[] = [];

const FULL_LOGS: LogEntry[] = [];

const SectionHeader = ({ title, icon: Icon }: any) => (
  <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
    <div className="p-1.5 rounded-lg bg-brand-500/10 text-brand-400">
        <Icon size={16} />
    </div>
    <h3 className="text-gray-100 font-semibold text-base">{title}</h3>
  </div>
);

const StatusRow = ({ label, count, color = "text-white", onClick }: any) => (
  <div 
    onClick={onClick}
    className={`flex justify-between items-center py-2 border-b border-white/5 last:border-0 hover:bg-white/10 px-2 rounded transition-colors group ${onClick ? 'cursor-pointer' : ''}`}
  >
    <div className="flex items-center gap-2">
        <span className="text-gray-400 text-sm group-hover:text-gray-200 transition-colors">{label}</span>
        {onClick && <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 text-gray-500 -ml-1 transition-all" />}
    </div>
    <span className={`font-bold font-mono ${color}`}>{count}</span>
  </div>
);

interface DashboardProps {
    onNavigate: (viewId: string, filterData: any) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Activity Log State
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
  const [liveLogs, setLiveLogs] = useState<ActivityLogRecord[]>([]);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [activityRoleFilter, setActivityRoleFilter] = useState<string>('ALL');
  const [activitySearchQuery, setActivitySearchQuery] = useState<string>('');

  // Live Data from Firestore
  const [liveCases, setLiveCases] = useState<Case[]>([]);
  const [liveVehicles, setLiveVehicles] = useState<Vehicle[]>([]);
  const [liveFinances, setLiveFinances] = useState<FinanceEntry[]>([]);

  useEffect(() => {
    const unsubCases = subscribeToCases(
      (cases) => setLiveCases(cases || []),
      (err) => console.warn("Dashboard case subscription warning:", err)
    );
    const unsubVehicles = subscribeToVehicles(
      (vehicles) => setLiveVehicles(vehicles || []),
      (err) => console.warn("Dashboard vehicle subscription warning:", err)
    );
    const unsubFinances = subscribeToFinances(
      (finances) => setLiveFinances(finances || []),
      (err) => console.warn("Dashboard finance subscription warning:", err)
    );
    const unsubLogs = subscribeToActivityLogs(
      (records) => setLiveLogs(records || [])
    );

    return () => {
      unsubCases();
      unsubVehicles();
      unsubFinances();
      unsubLogs();
    };
  }, []);

  const filteredLiveLogs = useMemo(() => {
    return liveLogs.filter((item) => {
      if (activityRoleFilter !== 'ALL') {
        const itemRole = String(item.role || item.userRole || '').toUpperCase();
        if (activityRoleFilter === 'TRANSPORTER' && !itemRole.includes('TRANSPORTER')) return false;
        if (activityRoleFilter === 'VEHICLE_MANAGER' && !itemRole.includes('VEHICLE') && !itemRole.includes('FLEET') && !itemRole.includes('TRANSPORT')) return false;
        if (activityRoleFilter === 'LOADING_PORT_STAFF' && !itemRole.includes('LOADING')) return false;
        if (activityRoleFilter === 'DESTINATION_PORT_STAFF' && !itemRole.includes('DESTINATION') && !itemRole.includes('UNLOADING')) return false;
        if (activityRoleFilter === 'FINANCE' && !itemRole.includes('FINANCE')) return false;
        if (activityRoleFilter === 'OPERATIONS' && !itemRole.includes('OPERATIONS') && !itemRole.includes('CASE')) return false;
        if (activityRoleFilter === 'CLIENT' && !itemRole.includes('CLIENT')) return false;
        if (activityRoleFilter === 'ADMIN' && !itemRole.includes('ADMIN')) return false;
      }
      if (activitySearchQuery.trim()) {
        const q = activitySearchQuery.toLowerCase();
        const matchTitle = (item.title || item.action || '').toLowerCase().includes(q);
        const matchDesc = (item.description || item.details || '').toLowerCase().includes(q);
        const matchUser = (item.performedBy || item.userId || '').toLowerCase().includes(q);
        return matchTitle || matchDesc || matchUser;
      }
      return true;
    });
  }, [liveLogs, activityRoleFilter, activitySearchQuery]);

  // Compute Live Metrics from real Firestore data
  const casePendingApproval = liveCases.filter(c => c.status === CaseStatus.SHIPPING_LINE_DO).length;
  const loadingPortProcessing = liveCases.filter(c => c.status === CaseStatus.LOADING_PORT_PROCESSING).length;
  const inTransitCases = liveCases.filter(c => c.status === CaseStatus.IN_TRANSIT).length;
  const completedCases = liveCases.filter(c => c.status === CaseStatus.COMPLETED).length;

  const vehiclesExpiringSoon = liveVehicles.filter(v => v.status === 'EXPIRE_SOON').length;
  const vehiclesExpired = liveVehicles.filter(v => v.status === 'EXPIRED').length;
  const vehiclesAvailable = liveVehicles.filter(v => v.status === 'AVAILABLE').length;
  const vehiclesOnTrip = liveVehicles.filter(v => v.status === 'ON_TRIP').length;

  const companyDocs = safeAppStorage.getJSON<any[]>('dpl_company_docs', []);
  const docExpiringSoon = companyDocs.filter(d => {
    if (d.unlimitedValidity || !d.expiryDate) return false;
    const diffDays = Math.ceil((new Date(d.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 30 && diffDays > 0;
  }).length;
  const docExpired = companyDocs.filter(d => {
    if (d.unlimitedValidity || !d.expiryDate) return false;
    const diffDays = Math.ceil((new Date(d.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 0;
  }).length;
  const docValid = companyDocs.filter(d => {
    if (d.unlimitedValidity) return true;
    if (!d.expiryDate) return false;
    const diffDays = Math.ceil((new Date(d.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return diffDays > 30;
  }).length;
  const docPendingRenewal = companyDocs.filter(d => d.pendingRenewal).length;

  const cashInHand = liveFinances
    .filter(f => f.paymentMethod === 'CASH')
    .reduce((sum, f) => sum + (f.type === 'INCOME' ? Number(f.amount) || 0 : -(Number(f.amount) || 0)), 0);

  const totalReceivables = liveFinances
    .filter(f => f.type === 'RECEIVABLE' && f.status !== 'PAID')
    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

  const todayStr = new Date().toISOString().split('T')[0];
  const expensesToday = liveFinances
    .filter(f => f.type === 'EXPENSE' && f.date === todayStr)
    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

  const totalPayables = liveFinances
    .filter(f => f.type === 'PAYABLE' && f.status !== 'PAID')
    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

  const officeCash = Math.max(0, cashInHand);
  const hblCorporate = liveFinances
    .filter(f => (f.bankId === '1' || f.bankId === 'HBL Corporate') && f.paymentMethod === 'BANK')
    .reduce((sum, f) => sum + (f.type === 'INCOME' ? Number(f.amount) || 0 : -(Number(f.amount) || 0)), 0);
  const meezanActive = liveFinances
    .filter(f => (f.bankId === '2' || f.bankId === 'Meezan Active') && f.paymentMethod === 'BANK')
    .reduce((sum, f) => sum + (f.type === 'INCOME' ? Number(f.amount) || 0 : -(Number(f.amount) || 0)), 0);

  // Drag to Scroll State for Graph (used in modal)
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftState, setScrollLeftState] = useState(0);
  const [selectedData, setSelectedData] = useState<any>(null);

  // Stats Modal State
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [dateRangePreset, setDateRangePreset] = useState<'all_time' | 'last_30' | 'last_90' | 'custom'>('last_30');
  const [statsFilter, setStatsFilter] = useState({
      fromDate: new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0],
      toDate: new Date().toISOString().split('T')[0],
      portOfLoading: 'ALL',
      portOfUnloading: 'ALL',
      selectedPort: 'ALL',
      category: 'ALL'
  });
  const [generatedGraphData, setGeneratedGraphData] = useState<any[]>([]);
  const [stationMovements, setStationMovements] = useState<StationMovementDetail[]>([]);
  const [stationSummary, setStationSummary] = useState<StationAnalyticsSummary | null>(null);

  // View tabs & filters inside Modal
  const [activeReportTab, setActiveReportTab] = useState<'details' | 'graph'>('details');
  const [stationSearchQuery, setStationSearchQuery] = useState('');
  const [stationCategoryFilter, setStationCategoryFilter] = useState<'ALL' | 'CLEARANCE' | 'AFGHAN_TRANSIT' | 'BONDED' | 'TIR' | 'PRIVATE'>('ALL');
  const [stationTypeFilter, setStationTypeFilter] = useState<'ALL' | 'Sea Port' | 'Border Terminal' | 'Dry Port'>('ALL');
  const [expandedStationId, setExpandedStationId] = useState<string | null>(null);

  const handleOpenStats = () => {
    setIsStatsModalOpen(true);
    setGeneratedGraphData([]);
    setStationMovements([]);
    setStationSummary(null);
    setActiveReportTab('details');
    setStationSearchQuery('');
    setStationCategoryFilter('ALL');
    setStationTypeFilter('ALL');
    setExpandedStationId(null);
  };

  // Helper to update date presets
  const handleDatePresetChange = (preset: 'all_time' | 'last_30' | 'last_90' | 'custom') => {
    setDateRangePreset(preset);
    const today = new Date().toISOString().split('T')[0];
    if (preset === 'all_time') {
      setStatsFilter(prev => ({
        ...prev,
        fromDate: '2020-01-01',
        toDate: today
      }));
    } else if (preset === 'last_30') {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      setStatsFilter(prev => ({
        ...prev,
        fromDate: d.toISOString().split('T')[0],
        toDate: today
      }));
    } else if (preset === 'last_90') {
      const d = new Date();
      d.setMonth(d.getMonth() - 3);
      setStatsFilter(prev => ({
        ...prev,
        fromDate: d.toISOString().split('T')[0],
        toDate: today
      }));
    }
  };

  const handleGenerateStats = (e: React.FormEvent) => {
    e.preventDefault();
    const data = generateGraphData(statsFilter.fromDate, statsFilter.toDate, liveCases);
    setGeneratedGraphData(data);

    const { movements, summary } = calculateStationMovements(
      statsFilter.fromDate,
      statsFilter.toDate,
      statsFilter.portOfLoading,
      statsFilter.portOfUnloading,
      liveCases,
      statsFilter.selectedPort,
      statsFilter.category
    );
    setStationMovements(movements);
    setStationSummary(summary);
    // Sync the internal quick-filter pill with the form category if selected
    if (statsFilter.category !== 'ALL') {
      setStationCategoryFilter(statsFilter.category as any);
    }
    setActiveReportTab('details'); // Directly present the station detail report!
    
    // Auto-scroll to end after slight delay for render if switching to graph
    setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
        }
    }, 100);
  };


  const handleViewAllLogs = () => {
      if (showAllLogs) {
          setLogs(INITIAL_LOGS);
          setShowAllLogs(false);
      } else {
          setLogs(FULL_LOGS);
          setShowAllLogs(true);
      }
  };

  // Drag Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setScrollLeftState(scrollContainerRef.current.scrollLeft);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startX) * 2; // Scroll speed multiplier
    scrollContainerRef.current.scrollLeft = scrollLeftState - walk;
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10 w-full max-w-full min-w-0 overflow-x-hidden">
      


      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* 2. Company Documents Status */}
        <div className="glass-card rounded-2xl p-5 hover:bg-white/5 transition-colors">
          <SectionHeader title="Company Documents" icon={FileText} />
          <div className="space-y-1">
            <StatusRow label="Expiring Soon (30 Days)" count={docExpiringSoon} color="text-yellow-400" onClick={() => onNavigate('settings', { section: 'general' })} />
            <StatusRow label="Already Expired" count={docExpired} color="text-red-400" onClick={() => onNavigate('settings', { section: 'general' })}/>
            <StatusRow label="Valid Documents" count={docValid} color="text-green-400" onClick={() => onNavigate('settings', { section: 'general' })}/>
            <StatusRow label="Pending Renewal" count={docPendingRenewal} onClick={() => onNavigate('settings', { section: 'general' })}/>
          </div>
        </div>

        {/* 3. Case Overview */}
        <div className="glass-card rounded-2xl p-5 hover:bg-white/5 transition-colors">
          <SectionHeader title="Case Overview" icon={CheckCircle} />
          <div className="space-y-1">
            <StatusRow label="Case Approval Pending" count={casePendingApproval} color="text-brand-accent" onClick={() => onNavigate('cases', { status: CaseStatus.SHIPPING_LINE_DO })} />
            <StatusRow label="Loading Port Processing" count={loadingPortProcessing} color="text-yellow-400" onClick={() => onNavigate('cases', { status: CaseStatus.LOADING_PORT_PROCESSING })} />
            <StatusRow label="In Transit" count={inTransitCases} color="text-blue-400" onClick={() => onNavigate('cases', { status: CaseStatus.IN_TRANSIT })} />
            <StatusRow label="Completed" count={completedCases} color="text-green-400" onClick={() => onNavigate('cases', { status: CaseStatus.COMPLETED })} />
          </div>
        </div>

        {/* 4. Vehicles Status Overview */}
        <div className="glass-card rounded-2xl p-5 hover:bg-white/5 transition-colors">
          <SectionHeader title="Vehicles Status" icon={Truck} />
          <div className="space-y-1">
            <StatusRow label="Expiring Soon (5 days)" count={vehiclesExpiringSoon} color="text-yellow-400" onClick={() => onNavigate('vehicles', { filter: 'expiring' })} />
            <StatusRow label="Expired" count={vehiclesExpired} color="text-red-400" onClick={() => onNavigate('vehicles', { filter: 'expired' })} />
            <StatusRow label="Available" count={vehiclesAvailable} color="text-blue-400" onClick={() => onNavigate('vehicles', { status: 'AVAILABLE' })} />
            <StatusRow label="On Trip" count={vehiclesOnTrip} color="text-orange-400" onClick={() => onNavigate('vehicles', { status: 'ON_TRIP' })} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 5. Finance Overview */}
        <div className="glass-card rounded-2xl p-6">
          <div className="flex justify-between items-center mb-4">
             <SectionHeader title="Finance Overview" icon={DollarSign} />
             <button onClick={() => onNavigate('finance', {})} className="text-xs text-brand-400 hover:text-white flex items-center gap-1">View Details <ArrowRight size={12}/></button>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div 
                onClick={() => onNavigate('finance', { tab: 'cashbook' })}
                className="glass-panel p-4 rounded-xl border-none bg-gradient-to-br from-white/5 to-white/0 hover:bg-white/10 transition-colors cursor-pointer group"
            >
              <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold group-hover:text-gray-200">Cash in Hand</p>
              <h4 className="text-2xl font-bold text-green-400 mt-2 font-mono drop-shadow">PKR {cashInHand.toLocaleString()}</h4>
            </div>
            <div 
                onClick={() => onNavigate('finance', { tab: 'receivables' })}
                className="glass-panel p-4 rounded-xl border-none bg-gradient-to-br from-white/5 to-white/0 hover:bg-white/10 transition-colors cursor-pointer group"
            >
              <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold group-hover:text-gray-200">Total Receivables</p>
              <h4 className="text-2xl font-bold text-blue-400 mt-2 font-mono drop-shadow">PKR {totalReceivables.toLocaleString()}</h4>
            </div>
            <div 
                onClick={() => onNavigate('finance', { tab: 'payables' })}
                className="glass-panel p-4 rounded-xl border-none bg-gradient-to-br from-white/5 to-white/0 hover:bg-white/10 transition-colors cursor-pointer group"
            >
              <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold group-hover:text-gray-200">Expenses Today</p>
              <h4 className="text-2xl font-bold text-red-400 mt-2 font-mono drop-shadow">PKR {expensesToday.toLocaleString()}</h4>
            </div>
            <div 
                onClick={() => onNavigate('finance', { tab: 'payables' })}
                className="glass-panel p-4 rounded-xl border-none bg-gradient-to-br from-white/5 to-white/0 hover:bg-white/10 transition-colors cursor-pointer group"
            >
              <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold group-hover:text-gray-200">Total Payables</p>
              <h4 className="text-2xl font-bold text-orange-400 mt-2 font-mono drop-shadow">PKR {totalPayables.toLocaleString()}</h4>
            </div>
          </div>

          <div className="bg-black/20 rounded-xl p-4 border border-white/5">
             <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Cash Breakdown</h4>
             <div className="space-y-3">
               <div className="flex justify-between text-sm items-center">
                 <span className="text-gray-300 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-gray-500"></div> Office Cash</span>
                 <span className="text-white font-mono">PKR {officeCash.toLocaleString()}</span>
               </div>
               <div className="flex justify-between text-sm items-center">
                 <span className="text-gray-300 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-brand-500"></div> HBL Corporate</span>
                 <span className="text-white font-mono">PKR {hblCorporate.toLocaleString()}</span>
               </div>
               <div className="flex justify-between text-sm items-center">
                 <span className="text-gray-300 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div> Meezan Active</span>
                 <span className="text-white font-mono">PKR {meezanActive.toLocaleString()}</span>
               </div>
             </div>
          </div>
        </div>

        {/* 5b. Operations & Approvals Radar */}
        <div className="glass-card rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <SectionHeader title="Operational Action Radar" icon={Activity} />
              <span className="text-xs text-emerald-400 font-mono flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Live Network Active
              </span>
            </div>

            {liveCases.filter(c => c.approvalStatus === 'PENDING').length > 0 && (
              <div 
                onClick={() => onNavigate('cases', {})}
                className="mb-4 p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-between cursor-pointer hover:bg-amber-500/25 transition-all text-xs text-amber-300 shadow-lg shadow-amber-500/5"
              >
                <div className="flex items-center gap-2.5">
                  <AlertTriangle size={18} className="text-amber-400 shrink-0" />
                  <div>
                    <strong className="text-white font-bold">{liveCases.filter(c => c.approvalStatus === 'PENDING').length}</strong> Client Case(s) awaiting approval
                    <p className="text-[10px] text-amber-400/80">Case Management authorization required to dispatch</p>
                  </div>
                </div>
                <span className="text-xs font-bold bg-amber-500/30 px-3 py-1 rounded-xl text-amber-200 flex items-center gap-1">Review <ArrowRight size={13} /></span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div 
                onClick={() => onNavigate('cases', { status: 'LOADING' })}
                className="p-3.5 rounded-xl bg-slate-900/80 border border-white/5 hover:border-amber-500/30 transition cursor-pointer"
              >
                <span className="text-[10px] uppercase font-bold text-gray-400 block">Port Loading Queue</span>
                <span className="text-xl font-bold font-mono text-cyan-400 mt-1 block">{loadingPortProcessing} Cases</span>
                <span className="text-[10px] text-gray-400">Loading Port Staff active</span>
              </div>
              <div 
                onClick={() => onNavigate('vehicles', { filter: 'ready' })}
                className="p-3.5 rounded-xl bg-slate-900/80 border border-white/5 hover:border-amber-500/30 transition cursor-pointer"
              >
                <span className="text-[10px] uppercase font-bold text-gray-400 block">Available / Ready Fleet</span>
                <span className="text-xl font-bold font-mono text-emerald-400 mt-1 block">{vehiclesAvailable} Ready</span>
                <span className="text-[10px] text-gray-400">Broadcasting for dispatch</span>
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs">
            <span className="text-gray-400">Transit Deliveries in Progress:</span>
            <span className="font-bold text-white font-mono">{inTransitCases} Shipments Active</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 6. DEDICATED FULL-WIDTH SECTION: ALL USERS & ROLES LIVE ACTIVITY STREAM */}
      {/* ========================================================================= */}
      <div className="glass-card rounded-3xl p-6 sm:p-7 border border-white/10 shadow-2xl space-y-5 bg-slate-900/90 backdrop-blur-xl">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/10 border border-white/15 text-slate-200 flex items-center justify-center font-bold text-xl shadow-lg">
              <Activity size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base sm:text-lg font-extrabold text-white tracking-wide">
                  All Users & Roles Live Activity Stream
                </h3>
                <span className="text-[10px] font-mono font-bold bg-white/10 text-slate-200 border border-white/15 px-2 py-0.5 rounded-full">
                  {filteredLiveLogs.length} Records
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time operational audit log tracking Transporters, Port Staff, Finance, Operations, and Clients
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end md:self-auto">
            <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-xl">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live Firestore Feed
            </span>

            <button
              type="button"
              onClick={() => setShowAllLogs(!showAllLogs)}
              className="text-xs text-slate-200 hover:text-white font-semibold px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 transition active:scale-95 flex items-center gap-1"
            >
              <span>{showAllLogs ? 'Show Latest 10' : 'View All Activities'}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Role Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 text-xs">
            {[
              { id: 'ALL', label: 'All Roles' },
              { id: 'TRANSPORTER', label: '🚛 Transporters' },
              { id: 'VEHICLE_MANAGER', label: '🚚 Fleet & Vehicles' },
              { id: 'LOADING_PORT_STAFF', label: '⚓ Port Loading' },
              { id: 'DESTINATION_PORT_STAFF', label: '🏁 Destination' },
              { id: 'FINANCE', label: '💰 Finance' },
              { id: 'OPERATIONS', label: '📦 Operations' },
              { id: 'CLIENT', label: '🏢 Clients' },
              { id: 'ADMIN', label: '⚡ Admin' }
            ].map((tab, tIdx) => (
              <button
                key={`act_role_tab_${tab.id}_${tIdx}`}
                type="button"
                onClick={() => setActivityRoleFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap transition text-[11px] ${
                  activityRoleFilter === tab.id
                    ? 'bg-slate-700 text-white font-bold shadow-md border border-white/20'
                    : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/5'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[200px] sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search user, action, case #..."
              value={activitySearchQuery}
              onChange={(e) => setActivitySearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:border-amber-500/50 outline-none"
            />
          </div>
        </div>

        {/* Live Activity Stream List */}
        <div className="space-y-2.5 max-h-[500px] overflow-y-auto custom-scrollbar pr-1">
          {filteredLiveLogs.length === 0 ? (
            <div className="p-8 text-center bg-slate-950/60 rounded-2xl border border-white/5 text-gray-500 space-y-2">
              <Clock size={32} className="mx-auto text-gray-600 opacity-60" />
              <h4 className="text-xs font-semibold text-gray-400">No activities recorded for this filter</h4>
              <p className="text-[11px] text-gray-500">
                New user transactions, workflow advancements, and vehicle requests will automatically appear here live.
              </p>
            </div>
          ) : (
            (showAllLogs ? filteredLiveLogs : filteredLiveLogs.slice(0, 10)).map((item, idx) => {
              const roleUpper = String(item.role || item.userRole || '').toUpperCase();
              const isTransporter = roleUpper.includes('TRANSPORTER');
              const isPort = roleUpper.includes('LOADING') || roleUpper.includes('DESTINATION') || roleUpper.includes('PORT');
              const isFinance = roleUpper.includes('FINANCE');
              const isClient = roleUpper.includes('CLIENT');
              const isAdmin = roleUpper.includes('ADMIN');

              return (
                <div 
                  key={`live_log_${item.id || idx}_${idx}`} 
                  className="p-3.5 rounded-2xl bg-slate-950/70 border border-white/5 hover:border-white/15 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                      isTransporter ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' :
                      isPort ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' :
                      isFinance ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' :
                      isClient ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30' :
                      isAdmin ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' :
                      'bg-gray-500/15 text-gray-300 border border-gray-500/30'
                    }`}>
                      {isTransporter ? '🚛' : isPort ? '⚓' : isFinance ? '💰' : isClient ? '🏢' : '⚡'}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-md ${
                          isTransporter ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30' :
                          isPort ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30' :
                          isFinance ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' :
                          isClient ? 'bg-blue-500/10 text-blue-300 border border-blue-500/30' :
                          'bg-purple-500/10 text-purple-300 border border-purple-500/30'
                        }`}>
                          {item.role || item.userRole || 'System'}
                        </span>
                        <strong className="text-xs text-white font-semibold truncate">
                          {item.performedBy || item.userId || 'Operations'}
                        </strong>
                      </div>

                      <h4 className="text-xs sm:text-sm font-bold text-gray-100 mt-1 leading-snug group-hover:text-amber-300 transition-colors">
                        {item.title || item.action}
                      </h4>

                      {(item.description || item.details) && (
                        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed line-clamp-2">
                          {item.description || item.details}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-1.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5">
                    <span className="text-[11px] text-gray-400 font-mono">
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
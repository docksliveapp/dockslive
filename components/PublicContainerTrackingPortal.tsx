import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Package, Truck, Ship, MapPin, Calendar, Clock, CheckCircle2, 
  AlertCircle, Download, Share2, Copy, Check, ArrowRight, ArrowLeft, ShieldCheck, 
  FileText, ExternalLink, Anchor, Sparkles, RefreshCw, Box, AlertTriangle,
  QrCode, Printer, Layers, ArrowUpRight, ChevronRight, User
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Case, CaseStatus, Container } from '../types';
import { getCategoryWorkflow, getWorkflowStepIndex } from '../services/workflowConfig';
import { 
  fetchAllTrackingCases, 
  searchTrackingCases, 
  parseTrackingTokens, 
  extractMatchingContainers,
  MatchedContainerItem
} from '../services/containerTrackingService';
import { subscribeToCases } from '../services/dbService';
import { useParentGroup, isUploadedLogo, getCompanyLogoUrl, CompanyId } from '../services/companyService';
import { useBranding } from '../services/brandingService';

interface PublicContainerTrackingPortalProps {
  initialQuery?: string;
  onExitPortal?: () => void;
  onSwitchToVehicleTracker?: () => void;
}

export const PublicContainerTrackingPortal: React.FC<PublicContainerTrackingPortalProps> = ({
  initialQuery = '',
  onExitPortal,
  onSwitchToVehicleTracker
}) => {
  // Read query from props or URL parameter (?q=, ?container=, ?container1=, ?container2=, ?bl=, ?truck=, ?caseno=, ?case=)
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (initialQuery) return initialQuery;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('q') || params.get('container') || params.get('container1') || params.get('bl') || params.get('truck') || params.get('caseno') || params.get('case') || '';
    }
    return '';
  });

  const { parentGroup } = useParentGroup();
  const { customLogo: globalLogo } = useBranding();
  const mainAppLogo = (parentGroup?.logo && isUploadedLogo(parentGroup.logo))
    ? parentGroup.logo
    : (globalLogo && isUploadedLogo(globalLogo))
    ? globalLogo
    : '/logos/mak_pearl_white_emblem.svg';

  const [activeSearch, setActiveSearch] = useState<string>('');
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [isLoadingCases, setIsLoadingCases] = useState<boolean>(true);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>('');

  useEffect(() => {
    document.title = activeSearch 
      ? `${activeSearch} - Container Status • status.makpk.online`
      : 'Shipment & Container Status • status.makpk.online';
  }, [activeSearch]);

  // Synchronize cases across all subsidiary company databases (Docks, Truckit, Muhib, Vantage)
  useEffect(() => {
    let isMounted = true;

    const loadAllCases = async () => {
      try {
        const allFetched = await fetchAllTrackingCases();
        if (isMounted) {
          setCases(Array.isArray(allFetched) ? allFetched : []);
          setLastSyncedTime(new Date().toLocaleTimeString());
        }
      } catch (err) {
        console.warn('Could not fetch all tracking cases:', err);
      } finally {
        if (isMounted) setIsLoadingCases(false);
      }
    };

    loadAllCases();

    // Subscribe to live updates across all companies (including empty array after reset)
    const unsubscribe = subscribeToCases(
      (liveCases) => {
        if (!isMounted) return;
        const cleanCases = Array.isArray(liveCases) ? liveCases : [];
        setCases(cleanCases);
        if (cleanCases.length === 0) {
          setSelectedContainerId(null);
        }
        setLastSyncedTime(new Date().toLocaleTimeString());
      },
      () => {},
      { allCompanies: true }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Trigger search on mount if initial query exists
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      setSearchQuery(initialQuery.trim());
      setActiveSearch(initialQuery.trim());
      setSelectedContainerId(null);
    } else if (searchQuery.trim() && !activeSearch) {
      setActiveSearch(searchQuery.trim());
    }
  }, [initialQuery, searchQuery]);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = searchQuery.trim();
    if (!clean) return;
    setActiveSearch(clean);
    setSelectedContainerId(null);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('q', clean);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleQuickExample = (exampleQuery: string) => {
    setSearchQuery(exampleQuery);
    setActiveSearch(exampleQuery);
    setSelectedContainerId(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('q', exampleQuery);
      window.history.replaceState({}, '', url.toString());
    }
  };

  // Perform multi-company database matching
  const matchingCases = useMemo(() => {
    if (!activeSearch) return [];
    return searchTrackingCases(activeSearch, cases);
  }, [cases, activeSearch]);

  // Extract individual matching containers
  const matchingContainers = useMemo(() => {
    if (!activeSearch) return [];
    return extractMatchingContainers(activeSearch, matchingCases, getCategoryWorkflow, getWorkflowStepIndex);
  }, [activeSearch, matchingCases]);

  // Determine active displayed container if drilling into details
  const activeContainerItem = useMemo(() => {
    if (matchingContainers.length === 1) return matchingContainers[0];
    if (selectedContainerId) {
      return matchingContainers.find(c => String(c.id) === String(selectedContainerId)) || null;
    }
    return null;
  }, [matchingContainers, selectedContainerId]);

  // Helper to format operating company badge
  const getOperatingCompany = (cid?: string) => {
    const c = (cid || 'docks').toLowerCase();
    if (c === 'truckit') return { name: 'Truckit (Pvt.) Ltd.', short: 'TRUCKIT', color: 'text-amber-800 bg-amber-50 border-amber-300' };
    if (c === 'muhib') return { name: 'Muhib International', short: 'MUHIB', color: 'text-emerald-800 bg-emerald-50 border-emerald-300' };
    if (c === 'vantage') return { name: 'Vantage Shipping Line', short: 'VANTAGE', color: 'text-cyan-800 bg-cyan-50 border-cyan-300' };
    return { name: 'Docks (Pvt.) Ltd.', short: 'DOCKS', color: 'text-blue-800 bg-blue-50 border-blue-300' };
  };

  // Generate Official Public Container Tracking Slip PDF
  const handleDownloadTrackingSlip = (targetContainer: MatchedContainerItem) => {
    setIsGeneratingPdf(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 16;
      let y = 16;

      // 1. Header Banner
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, pageWidth, 40, 'F');

      doc.setTextColor(245, 158, 11); // amber-500
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('MAK GROUP OF COMPANIES', pageWidth / 2, y, { align: 'center' });

      y += 6;
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(203, 213, 225); // slate-300
      doc.text('DOCKS (PVT) LTD • TRUCKIT • MUHIB INTERNATIONAL • VANTAGE SHIPPING LINE', pageWidth / 2, y, { align: 'center' });

      y += 5;
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text('Public Container Status & Workflow Milestone Verification Slip • status.makpk.online', pageWidth / 2, y, { align: 'center' });

      y += 18;

      // 2. Slip Title & Verification Tag
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('OFFICIAL CONTAINER STATUS & WORKFLOW DOSSIER', margin, y);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      const generatedAt = new Date().toLocaleString('en-GB');
      doc.text(`Generated: ${generatedAt} PKT`, pageWidth - margin, y, { align: 'right' });

      y += 5;
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, pageWidth - margin, y);
      y += 5;

      // 3. Primary Shipment Metadata Box
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, pageWidth - (margin * 2), 48, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, pageWidth - (margin * 2), 48, 'S');

      const col1 = margin + 4;
      const col2 = margin + 65;
      const col3 = margin + 125;
      let boxY = y + 7;

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('CONTAINER NUMBER', col1, boxY);
      doc.text('BILL OF LADING (B/L)', col2, boxY);
      doc.text('CASE REFERENCE', col3, boxY);

      boxY += 4.5;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(targetContainer.containerNumber, col1, boxY);
      doc.text(targetContainer.blNumber || 'N/A', col2, boxY);
      doc.text(targetContainer.caseNo || 'N/A', col3, boxY);

      boxY += 8;
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('CONTAINER SIZE & SEAL', col1, boxY);
      doc.text('PORT OF LOADING (POL)', col2, boxY);
      doc.text('PORT OF DISCHARGE (POD)', col3, boxY);

      boxY += 4.5;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      const sealStr = targetContainer.sealNo ? ` (Seal: ${targetContainer.sealNo})` : '';
      doc.text(`${targetContainer.size || '40ft'}${sealStr}`, col1, boxY);
      doc.text(targetContainer.pol || 'Port of Loading', col2, boxY);
      doc.text(targetContainer.pod || 'Port of Discharge', col3, boxY);

      boxY += 8;
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('ASSIGNED TRUCK / TRAILER', col1, boxY);
      doc.text('DRIVER & TRANSPORTER', col2, boxY);
      doc.text('OPERATING SUBSIDIARY', col3, boxY);

      boxY += 4.5;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(targetContainer.vehicleNo || 'Awaiting Haulage', col1, boxY);
      doc.text(`${targetContainer.driverName || 'Designated Driver'} (${targetContainer.transporterName || 'Fleet Network'})`, col2, boxY);
      doc.text(targetContainer.companyName, col3, boxY);

      y += 54;

      // 4. Current Status Field
      doc.setFillColor(targetContainer.isCompleted ? 240 : 254, targetContainer.isCompleted ? 253 : 243, targetContainer.isCompleted ? 244 : 199);
      doc.rect(margin, y, pageWidth - (margin * 2), 16, 'F');
      doc.setDrawColor(targetContainer.isCompleted ? 34 : 245, targetContainer.isCompleted ? 197 : 158, targetContainer.isCompleted ? 94 : 11);
      doc.rect(margin, y, pageWidth - (margin * 2), 16, 'S');

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(targetContainer.isCompleted ? 21 : 180, targetContainer.isCompleted ? 128 : 83, targetContainer.isCompleted ? 61 : 9);
      doc.text('CURRENT OPERATIONAL WORKFLOW STATUS:', margin + 4, y + 5);

      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(targetContainer.currentWorkflowStep, margin + 4, y + 11.5);

      y += 22;

      // 5. Workflow Stage Description
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`Active Milestone: ${targetContainer.currentWorkflowDescription}`, margin, y);

      y += 10;

      // 6. Security Notice
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, pageWidth - (margin * 2), 16, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, pageWidth - (margin * 2), 16, 'S');

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('PUBLIC VERIFICATION & FINANCIAL PRIVACY DECLARATION', margin + 4, y + 4.5);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text('1. Public Verification: This status document is live verifiable through status.makpk.online.', margin + 4, y + 8.5);
      doc.text('2. Pure Operational Record: Financial accounts, invoicing, and tariffs are strictly confidential.', margin + 4, y + 12.5);

      // Footer
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(`MAK Group of Companies | status.makpk.online | Container ${targetContainer.containerNumber}`, pageWidth / 2, 287, { align: 'center' });

      const safeFilename = `Container_${targetContainer.containerNumber}_Status.pdf`;
      doc.save(safeFilename);
    } catch (err) {
      console.error('Error generating PDF:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleCopyShareLink = () => {
    if (typeof window === 'undefined') return;
    const query = encodeURIComponent(activeSearch);
    const host = (window.location.hostname || '').toLowerCase();
    const isCustom = host.includes('makpk.online') || host.includes('status.mak-group.com');
    const shareUrl = isCustom
      ? `https://status.makpk.online?q=${query}`
      : `${window.location.origin}/?mode=status&q=${query}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }).catch(() => {});
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#FAF9F5] text-slate-800 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-950">
      {/* Main Body Container with docks.com.pk luxury branding */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8 min-w-0">
        
        {/* Hero Section matching Screenshot_20261012_060549_Edge.jpg */}
        <section className="space-y-4 max-w-2xl mx-auto text-center pt-1">
          
          {/* Welcome Pill */}
          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-amber-300/80 bg-gradient-to-r from-amber-50/80 via-white to-amber-50/80 text-slate-800 text-xs font-semibold shadow-xs">
            <span className="text-amber-600">✨</span>
            <span className="tracking-wide">WELCOME TO MAK - GROUP OF COMPANIES</span>
          </div>

          {/* Golden Subheading */}
          <p className="text-xs sm:text-sm font-bold text-amber-700 uppercase tracking-widest leading-relaxed">
            CONNECTING PORTS • CROSS-BORDER TRANSIT • OCEAN LINER FREIGHT
          </p>

          {/* Main App Official Logo */}
          <div className="flex justify-center pt-2 pb-1">
            <img
              src={mainAppLogo}
              alt={parentGroup?.name || 'MAK Group of Companies'}
              className="w-36 sm:w-44 md:w-48 h-36 sm:h-44 md:h-48 max-h-36 sm:max-h-44 md:max-h-48 object-contain drop-shadow-[0_12px_36px_rgba(0,0,0,0.18)] select-none"
            />
          </div>

          {/* Main Title */}
          <div className="space-y-1.5">
            <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-serif">
              UNIFIED CONTAINER STATUS &amp; TRACKING
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto">
              Search by Container Number, Assigned Truck Number, Bill of Lading (B/L), or MAK Case ID to check active workflows.
            </p>
          </div>

          {/* Search Form: Searchable by Container No, Truck No, BL No, Case No */}
          <form onSubmit={handleSearchSubmit} className="pt-2">
            <div className="relative flex flex-col sm:flex-row items-stretch gap-2 bg-white p-2 rounded-2xl border-2 border-slate-200 shadow-lg focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-300/40 transition-all">
              <div className="relative flex-1 flex items-center">
                <Search size={18} className="absolute left-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Enter Container No, Truck No, B/L No, or Case Ref..."
                  className="w-full bg-transparent pl-11 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none font-mono tracking-wide font-bold"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setActiveSearch(''); setSelectedContainerId(null); }}
                    className="pr-3 text-slate-400 hover:text-slate-800 text-sm cursor-pointer font-bold"
                  >
                    ×
                  </button>
                )}
              </div>

              <button
                type="submit"
                className="py-2.5 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 transition-all active:scale-98 cursor-pointer shrink-0"
              >
                <Search size={15} />
                <span>Search</span>
              </button>
            </div>
          </form>
        </section>

        {/* 4. Results Presentation Area */}
        {activeSearch && (
          <section className="space-y-6 animate-in fade-in duration-300">
            
            {/* Search Header Strip */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium">Search results for:</span>
                <span className="font-mono font-bold text-slate-900 bg-white px-2.5 py-0.5 rounded border border-slate-300 shadow-xs">
                  {activeSearch}
                </span>
                <span className="text-slate-300">·</span>
                <span className="text-emerald-700 font-bold">
                  {matchingContainers.length} {matchingContainers.length === 1 ? 'Container Record' : 'Containers Listed'}
                </span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-500">Searched across all 4 subsidiaries</span>
              </div>

              {matchingContainers.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    className="text-xs text-slate-700 hover:text-slate-950 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs font-semibold"
                    title="Copy direct verification link"
                  >
                    {copiedLink ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    <span>{copiedLink ? 'Link Copied' : 'Share Status Link'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* A. If NO record found: "no record found likha jaega" */}
            {matchingContainers.length === 0 && (
              <div className="p-8 sm:p-12 rounded-3xl bg-white border-2 border-rose-200 text-center space-y-4 max-w-lg mx-auto shadow-xl">
                <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-300 flex items-center justify-center text-rose-600 mx-auto">
                  <AlertCircle size={32} />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">
                    No Record Found
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    No container or consignment record found matching <code className="text-slate-900 font-mono font-bold px-2 py-0.5 rounded bg-slate-100 border border-slate-300">{activeSearch}</code> in the MAK Group database.
                  </p>
                </div>
                <div className="text-left text-xs text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5">
                  <p className="font-bold text-slate-800">Search Help:</p>
                  <p>• <strong>Container Number</strong>: Check format (e.g. <code>WHSU5957558</code> or <code>HLXU8821094</code>).</p>
                  <p>• <strong>Truck / Vehicle Number</strong>: Enter plate number (e.g. <code>TLB-892</code> or <code>P-9912</code>).</p>
                  <p>• <strong>Bill of Lading</strong>: Enter B/L number (e.g. <code>027G657324</code> or <code>HLCU9201840</code>).</p>
                  <p>• <strong>Case Reference</strong>: Enter MAK job number (e.g. <code>DPL-26-0001</code>).</p>
                </div>
              </div>
            )}

            {/* B. If EXACTLY 1 Container (or user drilled into 1 container from the list): "uska status samne a jaega" */}
            {activeContainerItem && (
              <div className="space-y-4">
                {/* Back to multiple containers list if user clicked from list */}
                {matchingContainers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSelectedContainerId(null)}
                    className="text-xs text-slate-700 hover:text-slate-950 px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 flex items-center gap-2 transition-colors cursor-pointer w-fit shadow-xs font-semibold"
                  >
                    <ArrowLeft size={14} />
                    <span>Back to Containers List ({matchingContainers.length} Containers)</span>
                  </button>
                )}

                {/* Single Container Detailed Dossier Card */}
                <SingleContainerDossierCard
                  item={activeContainerItem}
                  onDownloadPdf={() => handleDownloadTrackingSlip(activeContainerItem)}
                  isGeneratingPdf={isGeneratingPdf}
                />
              </div>
            )}

            {/* C. If MORE THAN 1 Container Entry across companies or current/past history: Show list and open detail page on click */}
            {!activeContainerItem && matchingContainers.length > 1 && (
              <div className="space-y-4">
                {/* Header Summary Banner */}
                <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-300 text-amber-700 flex items-center justify-center shrink-0">
                      <Package size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                        Centralized Multi-Company Container Records ({matchingContainers.length} Entries Found)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Showing all current and past entries across Docks, Muhib, Vantage &amp; Truckit. Click any entry below to open its full detail &amp; workflow status page.
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-800 border border-slate-300 shrink-0 font-mono">
                    Total: {matchingContainers.length} Entries
                  </span>
                </div>

                {/* Responsive Containers List with Prominent Company & Workflow Status Field */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
                  <div className="divide-y divide-slate-100">
                    {matchingContainers.map((cItem, idx) => {
                      const opBadge = getOperatingCompany(cItem.companyId);
                      const compLogo = getCompanyLogoUrl((cItem.companyId || 'docks') as CompanyId);

                      return (
                        <div 
                          key={cItem.id || idx}
                          onClick={() => setSelectedContainerId(String(cItem.id))}
                          className="p-4 sm:p-5 hover:bg-amber-50/40 transition-colors cursor-pointer group flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                        >
                          {/* Container Specs, Company & Identifiers */}
                          <div className="space-y-2.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-mono font-bold shrink-0">
                                {idx + 1}
                              </span>
                              <span className="font-mono text-lg sm:text-xl font-black text-slate-900 tracking-wider group-hover:text-amber-800 transition-colors">
                                {cItem.containerNumber}
                              </span>
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 shrink-0">
                                {cItem.size || '40ft'}
                              </span>
                              {cItem.sealNo && (
                                <span className="text-xs font-mono text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200 shrink-0">
                                  Seal: {cItem.sealNo}
                                </span>
                              )}
                              {/* Company Badge with Logo */}
                              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-md border ${opBadge.color} shrink-0`}>
                                <img src={compLogo} alt={opBadge.name} className="w-4 h-4 object-contain shrink-0" />
                                <span>{opBadge.name}</span>
                              </span>
                              {/* Current vs Past Record Badge */}
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                                cItem.isCompleted
                                  ? 'bg-slate-100 text-slate-700 border-slate-300'
                                  : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              }`}>
                                {cItem.isCompleted ? 'Past / Completed Record' : 'Current / Active Record'}
                              </span>
                            </div>

                            {/* Truck & Consignment Metadata */}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                              <div>
                                <span>Company: <strong className="text-slate-900">{opBadge.name}</strong></span>
                              </div>
                              <div>
                                <span>Case: <strong className="text-slate-900 font-mono">{cItem.caseNo}</strong></span>
                              </div>
                              <div>
                                <span>B/L: <strong className="text-slate-900 font-mono">{cItem.blNumber || 'N/A'}</strong></span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Truck size={13} className="text-emerald-700" />
                                <span>Truck: <strong className="text-slate-900 font-mono">{cItem.vehicleNo || 'Awaiting Haulage'}</strong></span>
                                {cItem.driverName && <span className="text-slate-500 font-normal">({cItem.driverName})</span>}
                              </div>
                              <div>
                                <span>Date: <strong className="text-slate-800 font-mono">{cItem.registrationDate}</strong></span>
                              </div>
                              <div>
                                <span>Category: <strong className="text-amber-800">{cItem.category}</strong></span>
                              </div>
                            </div>
                          </div>

                          {/* DEDICATED STATUS FIELD (Showing current active workflow) */}
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0 lg:max-w-md">
                            <div className={`p-3 rounded-xl border-2 flex-1 min-w-[260px] ${
                              cItem.isCompleted
                                ? 'bg-emerald-50 border-emerald-400 text-emerald-950 shadow-xs'
                                : 'bg-amber-50 border-amber-400 text-amber-950 shadow-xs'
                            }`}>
                              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider mb-1">
                                <span className="font-mono text-slate-600">CURRENT WORKFLOW STATUS</span>
                                <span className={`flex items-center gap-1 font-bold ${cItem.isCompleted ? 'text-emerald-700' : 'text-amber-700'}`}>
                                  <span className={`w-2 h-2 rounded-full ${cItem.isCompleted ? 'bg-emerald-600' : 'bg-amber-600 animate-ping'}`} />
                                  {cItem.isCompleted ? 'Completed' : 'In Progress'}
                                </span>
                              </div>
                              <p className="text-xs sm:text-sm font-black text-slate-900 line-clamp-1">
                                {cItem.currentWorkflowStep}
                              </p>
                              <p className="text-[11px] text-slate-600 line-clamp-1 mt-0.5">
                                {cItem.currentWorkflowDescription}
                              </p>
                            </div>

                            {/* View Full Status Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedContainerId(String(cItem.id));
                              }}
                              className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-amber-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs shrink-0 cursor-pointer"
                            >
                              <span>View Status</span>
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

          </section>
        )}

      </main>

      {/* 5. Corporate Footer matching docks.com.pk */}
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-xs text-slate-600 space-y-3 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-left">
            <p className="font-bold text-slate-900">MAK Group of Companies — Public Container Tracking Service</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Office No 13 1st Floor State Life Building No 7 G-Allana Road Tower Karachi
            </p>
          </div>
          <div className="text-right text-[11px] text-slate-500">
            <p>Direct Support: +92-21-32330103 • info@makgroup.com.pk</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

interface SingleContainerDossierCardProps {
  item: MatchedContainerItem;
  onDownloadPdf: () => void;
  isGeneratingPdf: boolean;
}

const SingleContainerDossierCard: React.FC<SingleContainerDossierCardProps> = ({
  item,
  onDownloadPdf,
  isGeneratingPdf
}) => {
  const caseItem = item.caseItem;
  const workflowConfig = getCategoryWorkflow(caseItem.category);
  const activeStepIdx = getWorkflowStepIndex(caseItem.category, caseItem.status);
  const isCompletedCase = caseItem.status === CaseStatus.COMPLETED || item.isCompleted;

  const completedSteps = workflowConfig.steps.filter((_, idx) => idx < activeStepIdx || isCompletedCase);
  const currentStep = !isCompletedCase ? workflowConfig.steps[activeStepIdx] : null;
  const incompleteSteps = !isCompletedCase ? workflowConfig.steps.filter((_, idx) => idx > activeStepIdx) : [];
  const progressPercent = isCompletedCase ? 100 : Math.round((completedSteps.length / workflowConfig.totalSteps) * 100);

  const cid = (item.companyId || 'docks').toLowerCase();
  const opComp = (() => {
    if (cid === 'truckit') return { name: 'Truckit (Pvt.) Ltd.', badge: 'TRUCKIT', border: 'border-amber-300 text-amber-800 bg-amber-50' };
    if (cid === 'muhib') return { name: 'Muhib International', badge: 'MUHIB', border: 'border-emerald-300 text-emerald-800 bg-emerald-50' };
    if (cid === 'vantage') return { name: 'Vantage Shipping Line', badge: 'VANTAGE', border: 'border-cyan-300 text-cyan-800 bg-cyan-50' };
    return { name: 'Docks (Pvt.) Ltd.', badge: 'DOCKS', border: 'border-blue-300 text-blue-800 bg-blue-50' };
  })();

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-xl overflow-hidden space-y-0">
      
      {/* 1. TOP SECTION: CONTAINER SPECIFICATIONS HEADER */}
      <div className="p-5 sm:p-7 border-b border-slate-800 bg-[#0F172A] text-white flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
        <div className="space-y-3 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${opComp.border} shrink-0`}>
              {opComp.badge}
            </span>
            <span className="font-mono text-2xl sm:text-4xl font-black text-white tracking-wider truncate">
              {item.containerNumber}
            </span>
            <span className="text-xs font-semibold text-slate-300 bg-white/10 border border-white/20 px-2.5 py-0.5 rounded shrink-0">
              {item.size || '40ft'} Equipment
            </span>
            {item.sealNo && (
              <span className="text-xs font-mono text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 rounded shrink-0">
                Seal: {item.sealNo}
              </span>
            )}
          </div>

          {/* Quick Specifications Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-900/90 p-3.5 rounded-2xl border border-white/10">
            <div>
              <span className="text-slate-400 block text-[11px]">Bill of Lading (B/L):</span>
              <strong className="text-white text-xs truncate block font-mono">{item.blNumber}</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">MAK Case Reference:</span>
              <strong className="text-white text-xs truncate block font-mono">{item.caseNo}</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Operating Subsidiary:</span>
              <strong className="text-amber-300 text-xs truncate block">{item.companyName}</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Logistics Category:</span>
              <strong className="text-slate-200 text-xs truncate block">{item.category}</strong>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] sm:text-xs text-slate-400">
            <span>Routing: <strong className="text-white">{item.pol}</strong> → <strong className="text-white">{item.pod}</strong></span>
            <span>·</span>
            <span>Registered On: <strong className="text-slate-200">{item.registrationDate}</strong></span>
            {item.vehicleNo && (
              <>
                <span>·</span>
                <span>Assigned Truck: <strong className="text-amber-300 font-mono">{item.vehicleNo}</strong></span>
                {item.driverName && <span>({item.driverName})</span>}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 pt-1 md:pt-0">
          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={isGeneratingPdf}
            className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 transition-all cursor-pointer active:scale-95"
            title="Download official PDF container status certificate"
          >
            <Download size={14} />
            <span>{isGeneratingPdf ? 'Generating PDF...' : 'Download Status Slip (PDF)'}</span>
          </button>
        </div>
      </div>

      {/* 2. DEDICATED PROMINENT STATUS FIELD (Active Workflow Stage) */}
      <div className="p-5 sm:p-7 bg-[#FCFAF5] border-b border-slate-200">
        <div className={`p-5 sm:p-6 rounded-2xl border-2 transition-all shadow-md ${
          isCompletedCase
            ? 'bg-emerald-50 border-emerald-500 text-emerald-950 shadow-emerald-100'
            : 'bg-amber-50 border-amber-500 text-amber-950 shadow-amber-100'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block font-mono">
                CURRENT WORKFLOW STAGE
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`text-2xl sm:text-3xl font-black font-mono tracking-tight ${
                  isCompletedCase ? 'text-emerald-700' : 'text-amber-800'
                }`}>
                  {item.currentWorkflowStep}
                </span>

                <span className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                  isCompletedCase
                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                    : 'bg-amber-100 text-amber-900 border-amber-300'
                }`}>
                  {isCompletedCase ? (
                    <>
                      <CheckCircle2 size={14} className="text-emerald-600" />
                      <span>Consignment Completed &amp; Delivered</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-600 animate-ping" />
                      <span>In Progress • Active Milestone Stage</span>
                    </>
                  )}
                </span>
              </div>
              <p className="text-xs text-slate-700 pt-1 leading-relaxed font-medium">
                {item.currentWorkflowDescription}
              </p>
            </div>

            {/* Gauge Percentage */}
            <div className="text-right sm:border-l sm:border-amber-300/60 sm:pl-6 shrink-0">
              <span className="text-xs font-semibold text-slate-500 block">Milestone Progress</span>
              <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                {progressPercent}%
              </span>
              <span className="text-[10px] text-slate-600 block">
                {completedSteps.length} of {workflowConfig.totalSteps} Steps Complete
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dossier Content */}
      <div className="p-6 space-y-6 bg-white">
        
        {/* Core Shipment Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Anchor size={13} className="text-blue-600" />
              <span>Routing Origin / POL</span>
            </span>
            <p className="text-sm font-bold text-slate-900 truncate" title={item.pol}>
              {item.pol || 'Port of Loading'}
            </p>
            <p className="text-[11px] text-slate-500">
              Loading Port
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <MapPin size={13} className="text-emerald-600" />
              <span>Destination POD / Terminal</span>
            </span>
            <p className="text-sm font-bold text-slate-900 truncate" title={item.pod}>
              {item.pod || 'Port of Discharge'}
            </p>
            <p className="text-[11px] text-slate-500">
              Delivery Destination
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Truck size={13} className="text-amber-600" />
              <span>Assigned Haulage Truck</span>
            </span>
            <p className="text-sm font-bold text-slate-900 font-mono">
              {item.vehicleNo || 'Awaiting Haulage'}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {item.transporterName || 'Fleet Network'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Ship size={13} className="text-cyan-600" />
              <span>Ocean Carrier &amp; Line</span>
            </span>
            <p className="text-sm font-bold text-slate-900 truncate" title={caseItem.shippingLine}>
              {caseItem.extractedData?.shippingLine || caseItem.shippingLine || 'Shipping Line'}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {caseItem.extractedData?.vesselName ? `Vessel: ${caseItem.extractedData.vesselName}` : 'Vessel Voyage'}
            </p>
          </div>
        </div>

        {/* INCOMPLETE WORKFLOWS CARD */}
        {!isCompletedCase && (incompleteSteps.length > 0 || currentStep) && (
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-amber-300 text-xs space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
                <AlertTriangle size={17} className="text-amber-600 shrink-0" />
                <span>Pending Workflow Stages ({incompleteSteps.length + (currentStep ? 1 : 0)} Remaining)</span>
              </div>
              <span className="text-[11px] text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                Action Pending
              </span>
            </div>

            <p className="text-slate-700 leading-relaxed text-xs">
              The following operational milestones are currently underway or awaiting completion for this consignment:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
              {currentStep && (
                <div className="p-3 rounded-xl bg-white border border-amber-400 space-y-1 shadow-xs">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-amber-900 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-600 animate-ping" />
                      Step {activeStepIdx + 1}: {currentStep.title}
                    </span>
                    <span className="text-[10px] font-bold text-amber-800 uppercase bg-amber-100 px-1.5 py-0.5 rounded">
                      In Progress
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {currentStep.description}
                  </p>
                </div>
              )}

              {incompleteSteps.map((s, sIdx) => (
                <div key={s.id || sIdx} className="p-3 rounded-xl bg-white border border-slate-200 space-y-1 shadow-xs">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-800">
                      Step {activeStepIdx + 2 + sIdx}: {s.title}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase bg-slate-100 px-1.5 py-0.5 rounded">
                      Awaiting Completion
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {s.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP-BY-STEP WORKFLOW STATUS TIMELINE */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Layers size={14} className="text-amber-600" />
              <span>Full Operational Milestones Timeline ({workflowConfig.totalSteps} Total Steps)</span>
            </h4>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                <CheckCircle2 size={13} /> {completedSteps.length} Completed
              </span>
              {!isCompletedCase && (
                <span className="text-amber-700 font-semibold flex items-center gap-1">
                  <Clock size={13} /> {incompleteSteps.length + (currentStep ? 1 : 0)} Incomplete
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5 min-w-0">
            {workflowConfig.steps.map((step, idx) => {
              const isCompleted = idx < activeStepIdx || isCompletedCase;
              const isActive = idx === activeStepIdx && !isCompletedCase;

              return (
                <div 
                  key={step.id || idx}
                  className={`p-3.5 rounded-xl border text-xs transition-all ${
                    isCompleted
                      ? 'bg-emerald-50/60 border-emerald-300 text-emerald-950 shadow-xs'
                      : isActive
                        ? 'bg-amber-50 border-2 border-amber-500 text-amber-950 ring-2 ring-amber-200 shadow-md'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white text-slate-700 border border-slate-200">
                      Step {idx + 1}
                    </span>

                    {isCompleted ? (
                      <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Complete
                      </span>
                    ) : isActive ? (
                      <span className="text-[10px] font-bold text-amber-800 flex items-center gap-1 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-600" /> Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                        <Clock size={12} /> Incomplete
                      </span>
                    )}
                  </div>

                  <p className="font-bold text-slate-900 mb-1">
                    {step.title}
                  </p>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};

export default PublicContainerTrackingPortal;

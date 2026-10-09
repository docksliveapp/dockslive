import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Package, Truck, Ship, MapPin, Calendar, Clock, CheckCircle2, 
  AlertCircle, Download, Share2, Copy, Check, ArrowRight, ShieldCheck, 
  FileText, ExternalLink, Anchor, Sparkles, RefreshCw, Box, AlertTriangle,
  QrCode, Printer, Layers, ArrowUpRight
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Case, CaseStatus, Container } from '../types';
import { getCategoryWorkflow, getWorkflowStepIndex } from '../services/workflowConfig';
import { fetchAllTrackingCases, searchTrackingCases, parseTrackingTokens, SEED_TRACKING_CASES } from '../services/containerTrackingService';
import { subscribeToCases } from '../services/dbService';

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
  // Read query from props or URL parameter (?q=, ?container=, ?container1=, ?container2=, ?bl=, ?caseno=, ?case=)
  const [containerInput1, setContainerInput1] = useState<string>(() => {
    if (initialQuery) {
      const parts = initialQuery.split(/[,;\s]+/);
      return parts[0] || initialQuery;
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('container1') || params.get('q') || params.get('container') || params.get('bl') || params.get('caseno') || params.get('case') || '';
    }
    return '';
  });

  const [containerInput2, setContainerInput2] = useState<string>(() => {
    if (initialQuery && initialQuery.includes(',')) {
      const parts = initialQuery.split(/[,;\s]+/);
      return parts[1] || '';
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('container2') || '';
    }
    return '';
  });

  const [isDualMode, setIsDualMode] = useState<boolean>(() => {
    if (initialQuery && (initialQuery.includes(',') || initialQuery.includes(' '))) return true;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.has('container2') || (params.get('q') || '').includes(',');
    }
    return false;
  });

  const [activeSearch, setActiveSearch] = useState<string>('');
  const [cases, setCases] = useState<Case[]>(SEED_TRACKING_CASES);
  const [isLoadingCases, setIsLoadingCases] = useState<boolean>(true);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>('');

  // Synchronize cases across all subsidiary company databases (Docks, Truckit, Muhib, Vantage)
  useEffect(() => {
    let isMounted = true;

    const loadAllCases = async () => {
      try {
        const allFetched = await fetchAllTrackingCases();
        if (isMounted && allFetched && allFetched.length > 0) {
          setCases(allFetched);
          setLastSyncedTime(new Date().toLocaleTimeString());
        }
      } catch (err) {
        console.warn('Could not fetch all tracking cases:', err);
      } finally {
        if (isMounted) setIsLoadingCases(false);
      }
    };

    loadAllCases();

    // Subscribe to live updates across all companies
    const unsubscribe = subscribeToCases(
      (liveCases) => {
        if (!isMounted) return;
        if (liveCases && Array.isArray(liveCases) && liveCases.length > 0) {
          setCases((prev) => {
            const map = new Map<string, Case>();
            prev.forEach((c) => { if (c.caseNo || c.id) map.set(c.caseNo || c.id, c); });
            liveCases.forEach((c) => { if (c.caseNo || c.id) map.set(c.caseNo || c.id, c); });
            return Array.from(map.values());
          });
          setLastSyncedTime(new Date().toLocaleTimeString());
        }
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
    const raw = [containerInput1, containerInput2].filter(Boolean).map(s => s.trim()).filter(Boolean);
    if (raw.length > 0 && !activeSearch) {
      setActiveSearch(raw.join(', '));
    }
  }, [containerInput1, containerInput2]);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parts = [containerInput1.trim()];
    if (isDualMode && containerInput2.trim()) {
      parts.push(containerInput2.trim());
    }
    const clean = parts.filter(Boolean).join(', ');
    if (!clean) return;
    setActiveSearch(clean);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('q', clean);
      if (containerInput1.trim()) url.searchParams.set('container1', containerInput1.trim());
      if (isDualMode && containerInput2.trim()) url.searchParams.set('container2', containerInput2.trim());
      else url.searchParams.delete('container2');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleQuickExample = (example1: string, example2?: string) => {
    setContainerInput1(example1);
    if (example2) {
      setContainerInput2(example2);
      setIsDualMode(true);
    } else {
      setContainerInput2('');
      setIsDualMode(false);
    }
    const combined = [example1, example2].filter(Boolean).join(', ');
    setActiveSearch(combined);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('q', combined);
      url.searchParams.set('container1', example1);
      if (example2) url.searchParams.set('container2', example2);
      else url.searchParams.delete('container2');
      window.history.replaceState({}, '', url.toString());
    }
  };

  // Parse searched tokens (e.g. 1 or 2 container numbers)
  const searchedTokens = useMemo(() => {
    return parseTrackingTokens(activeSearch);
  }, [activeSearch]);

  // Map each token to its matching cases
  const tokenResults = useMemo(() => {
    if (searchedTokens.length === 0) return [];
    return searchedTokens.map(tok => {
      const matched = searchTrackingCases(tok, cases);
      return {
        token: tok,
        cases: matched,
        latest: matched[0] || null,
        history: matched.slice(1),
        count: matched.length
      };
    });
  }, [searchedTokens, cases]);

  // Perform multi-company database matching
  const matchingCases = useMemo(() => {
    if (!activeSearch) return [];
    return searchTrackingCases(activeSearch, cases);
  }, [cases, activeSearch]);

  const latestCase = matchingCases[0] || null;
  const historicCases = matchingCases.slice(1);

  // Helper to format operating company badge
  const getOperatingCompany = (c: Case) => {
    const cid = (c.companyId || 'docks').toLowerCase();
    if (cid === 'truckit') return { name: 'Truckit (Pvt.) Ltd.', short: 'TRUCKIT', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
    if (cid === 'muhib') return { name: 'Muhib International', short: 'MUHIB', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
    if (cid === 'vantage') return { name: 'Vantage Shipping Line', short: 'VANTAGE', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' };
    return { name: 'Docks (Pvt.) Ltd.', short: 'DOCKS', color: 'text-brand-400 bg-brand-500/10 border-brand-500/30' };
  };

  // Generate Official Public Container Tracking Slip PDF
  const handleDownloadTrackingSlip = (targetCase: Case, isLatestVoyage: boolean = true) => {
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
      const titlePrefix = isLatestVoyage ? 'CURRENT CONSIGNMENT STATUS REPORT' : 'PREVIOUS CONSIGNMENT HISTORICAL SLIP';
      doc.text(titlePrefix, margin, y);

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
      const opComp = getOperatingCompany(targetCase);
      const containers = targetCase.containers || [];
      const primaryContainer: Container = containers.find(c => {
        const num = (c.number || (c as any).containerNo || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const q = activeSearch.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        return num.includes(q) || q.includes(num);
      }) || containers[0] || ({ id: 0, number: activeSearch, size: '40ft', weight: 0, status: 'Pending' } as unknown as Container);

      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, pageWidth - (margin * 2), 48, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, pageWidth - (margin * 2), 48, 'S');

      const col1 = margin + 4;
      const col2 = margin + 65;
      const col3 = margin + 125;
      let boxY = y + 7;

      // Row 1
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('CONTAINER NUMBER', col1, boxY);
      doc.text('BILL OF LADING (B/L)', col2, boxY);
      doc.text('CASE REFERENCE', col3, boxY);

      boxY += 4.5;
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(primaryContainer.number || activeSearch, col1, boxY);
      doc.text(targetCase.blNumber || targetCase.extractedData?.blNumber || 'N/A', col2, boxY);
      doc.text(targetCase.caseNo || targetCase.id || 'N/A', col3, boxY);

      boxY += 8;
      // Row 2
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
      const sealStr = primaryContainer.sealNo ? ` (Seal: ${primaryContainer.sealNo})` : '';
      doc.text(`${primaryContainer.size || '40ft'}${sealStr}`, col1, boxY);
      doc.text(targetCase.pol || 'Port of Loading', col2, boxY);
      doc.text(targetCase.pod || 'Port of Discharge', col3, boxY);

      boxY += 8;
      // Row 3
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('OPERATING SUBSIDIARY', col1, boxY);
      doc.text('SHIPPING LINE & VESSEL', col2, boxY);
      doc.text('CURRENT OPERATIONAL STAGE', col3, boxY);

      boxY += 4.5;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(opComp.name, col1, boxY);
      const vesselStr = targetCase.extractedData?.vesselName ? ` • ${targetCase.extractedData.vesselName}` : '';
      doc.text(`${targetCase.extractedData?.shippingLine || targetCase.shippingLine || 'Carrier'}${vesselStr}`, col2, boxY);
      doc.setTextColor(217, 119, 6); // amber-600
      doc.text(String(targetCase.status || 'Active Stage'), col3, boxY);

      y += 54;

      // 4. Workflow Milestones Section
      const workflowConfig = getCategoryWorkflow(targetCase.category);
      const activeStepIdx = getWorkflowStepIndex(targetCase.category, targetCase.status);
      const isCompleted = targetCase.status === CaseStatus.COMPLETED;

      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('OPERATIONAL WORKFLOW & MILESTONE BREAKDOWN', margin, y);
      y += 4.5;

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`Service: ${targetCase.category || 'General Freight'} (Total ${workflowConfig.totalSteps} Milestones)`, margin, y);
      y += 5.5;

      // Table Header
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, pageWidth - (margin * 2), 6, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('STEP', margin + 3, y + 4.2);
      doc.text('MILESTONE TITLE', margin + 18, y + 4.2);
      doc.text('STAGE DESCRIPTION', margin + 70, y + 4.2);
      doc.text('STATUS', pageWidth - margin - 3, y + 4.2, { align: 'right' });
      y += 7;

      const incompleteStepsList: string[] = [];

      // Steps Rows
      workflowConfig.steps.forEach((step, idx) => {
        const stepDone = idx < activeStepIdx || isCompleted;
        const stepActive = idx === activeStepIdx && !isCompleted;
        const stepPending = idx > activeStepIdx && !isCompleted;

        if (stepPending || stepActive) {
          incompleteStepsList.push(`Step ${idx + 1}: ${step.shortTitle || step.title}`);
        }

        doc.setFillColor(idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 250);
        doc.rect(margin, y, pageWidth - (margin * 2), 7.5, 'F');

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(String(idx + 1), margin + 4, y + 5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(step.shortTitle || step.title, margin + 18, y + 5);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        const descSnippet = step.description.length > 58 ? `${step.description.substring(0, 55)}...` : step.description;
        doc.text(descSnippet, margin + 70, y + 5);

        // Status Badge
        if (stepDone) {
          doc.setTextColor(22, 163, 74); // green-600
          doc.setFont('helvetica', 'bold');
          doc.text('COMPLETED', pageWidth - margin - 3, y + 5, { align: 'right' });
        } else if (stepActive) {
          doc.setTextColor(217, 119, 6); // amber-600
          doc.setFont('helvetica', 'bold');
          doc.text('IN PROGRESS', pageWidth - margin - 3, y + 5, { align: 'right' });
        } else {
          doc.setTextColor(148, 163, 184); // slate-400
          doc.setFont('helvetica', 'normal');
          doc.text('INCOMPLETE', pageWidth - margin - 3, y + 5, { align: 'right' });
        }

        y += 7.5;
      });

      y += 6;

      // 5. Incomplete Workflows Highlight Box (if incomplete)
      if (!isCompleted && incompleteStepsList.length > 0) {
        doc.setFillColor(254, 243, 199); // amber-100
        doc.rect(margin, y, pageWidth - (margin * 2), 16, 'F');
        doc.setDrawColor(245, 158, 11);
        doc.rect(margin, y, pageWidth - (margin * 2), 16, 'S');

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(180, 83, 9); // amber-700
        doc.text('WORKFLOW STAGES AWAITING COMPLETION:', margin + 4, y + 4.5);

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(146, 64, 14);
        const summaryText = incompleteStepsList.join('  •  ');
        const splitSummary = doc.splitTextToSize(summaryText, pageWidth - (margin * 2) - 8);
        doc.text(splitSummary, margin + 4, y + 9);

        y += 20;
      }

      // 6. Security & Verification Notice
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, pageWidth - (margin * 2), 20, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, pageWidth - (margin * 2), 20, 'S');

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('PUBLIC VERIFICATION & FINANCIAL PRIVACY DECLARATION', margin + 4, y + 4.5);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text('1. Public Verification: This status document is live verifiable through status.makpk.online.', margin + 4, y + 9);
      doc.text('2. Financial Privacy: Invoicing, tariffs, and accounts are strictly excluded from public verification.', margin + 4, y + 13);
      doc.text('3. Central Helpline: For delivery arrangements and port gate passes, call: +92-21-32330103.', margin + 4, y + 17);

      y += 24;

      // 7. Footer
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(`MAK Group of Companies • status.makpk.online • Container ${primaryContainer.number || activeSearch}`, pageWidth / 2, 287, { align: 'center' });

      const safeFilename = `Tracking_${(primaryContainer.number || targetCase.caseNo || 'Container').replace(/[^a-zA-Z0-9_-]/g, '_')}_${isLatestVoyage ? 'Current' : 'History'}.pdf`;
      doc.save(safeFilename);
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Could not generate PDF. Please try again.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleCopyShareLink = () => {
    if (typeof window === 'undefined') return;
    const query = encodeURIComponent(activeSearch);
    const shareUrl = window.location.hostname.includes('status.makpk.online')
      ? `https://status.makpk.online?q=${query}`
      : `${window.location.origin}/?mode=status&q=${query}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }).catch(() => {});
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      
      {/* Top Header Strip */}
      <header className="border-b border-white/10 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40 shadow-xl w-full max-w-full overflow-hidden">
        <div className="max-w-6xl w-full mx-auto px-3 sm:px-6 min-h-16 py-2.5 flex items-center justify-between gap-2 sm:gap-4">
          
          {/* Brand Logo & Title */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-brand-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
              <Package size={20} className="sm:w-[22px] sm:h-[22px]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-xs sm:text-base font-bold text-white tracking-wide truncate max-w-[130px] sm:max-w-none">
                  MAK GROUP
                </h1>
                <span className="text-[9px] sm:text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 sm:px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                  Container Status
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 hidden sm:block truncate">
                Docks (Pvt.) Ltd. • Truckit • Muhib International • Vantage Shipping Line
              </p>
            </div>
          </div>

          {/* Subdomain & Controls */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <div className="text-right hidden md:block">
              <span className="text-xs text-amber-400 font-mono font-bold block">
                status.makpk.online
              </span>
              <span className="text-[10px] text-slate-400 block">
                {lastSyncedTime ? `Live synced at ${lastSyncedTime}` : 'Multi-entity real-time sync'}
              </span>
            </div>

            {/* Switch to Vehicle Tracker (vehicle.makpk.online) */}
            {onSwitchToVehicleTracker && (
              <button
                type="button"
                onClick={onSwitchToVehicleTracker}
                className="text-[11px] sm:text-xs text-cyan-300 hover:text-white px-2.5 sm:px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors flex items-center gap-1 sm:gap-1.5 cursor-pointer shrink-0 shadow-sm"
                title="Switch to Fleet & Vehicle Verification (vehicle.makpk.online)"
              >
                <Truck size={13} className="text-cyan-400 shrink-0" />
                <span>Vehicle Status</span>
              </button>
            )}

            {/* Exit to Internal Workspace (Only if accessed from internal app) */}
            {onExitPortal && (
              <button
                type="button"
                onClick={onExitPortal}
                className="text-[11px] sm:text-xs text-slate-300 hover:text-white px-2.5 sm:px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                title="Return to Internal Workspace"
              >
                Staff Portal
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container Tracking Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6 sm:space-y-8 min-w-0">
        
        {/* Hero Search Section */}
        <section className="text-center space-y-4 max-w-3xl mx-auto pt-2">
          
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 bg-slate-900 border border-white/10 px-3.5 py-1.5 rounded-full shadow-sm">
            <ShieldCheck size={14} className="text-emerald-400" />
            <span>Universal Status & Customs Clearance Portal • status.makpk.online</span>
          </div>

          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight">
            Check Container & Shipment Status
          </h2>
          
          <p className="text-xs sm:text-sm text-slate-300 max-w-xl mx-auto leading-relaxed">
            Enter your <strong>Container Number</strong>, <strong>Bill of Lading (B/L)</strong>, or <strong>Case Reference</strong> to view real-time operations, gate passes, and incomplete workflows.
          </p>

          <p className="text-[12px] text-amber-300/90 font-medium">
            (Displays real-time container status, cargo milestones, and pending operations — internal financial data is securely excluded)
          </p>

          {/* Dual / Single Container Input Search Controls */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setIsDualMode(false)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                !isDualMode 
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md' 
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              Single Identifier Search
            </button>
            <button
              type="button"
              onClick={() => setIsDualMode(true)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                isDualMode 
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md' 
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              <Package size={13} />
              <span>Track 2 Containers (Dual Search)</span>
            </button>
          </div>

          {/* Unified Automatic Identifier Search Input */}
          <form onSubmit={handleSearchSubmit} className="pt-1">
            <div className="bg-slate-900/90 p-2.5 rounded-2xl border border-white/15 shadow-2xl focus-within:border-amber-400/60 focus-within:ring-2 focus-within:ring-amber-400/20 transition-all space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {/* Input 1 */}
                <div className="relative flex items-center bg-slate-950/70 rounded-xl border border-white/10">
                  <Search size={18} className="absolute left-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={containerInput1}
                    onChange={(e) => setContainerInput1(e.target.value)}
                    placeholder={isDualMode ? "Container #1 (e.g. WHSU5957558)..." : "Enter Container No, B/L, or Case Ref (Auto-Detect)..."}
                    className="w-full bg-transparent pl-11 pr-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none font-mono tracking-wide"
                  />
                  {containerInput1 && (
                    <button
                      type="button"
                      onClick={() => setContainerInput1('')}
                      className="pr-3 text-slate-500 hover:text-white text-xs cursor-pointer"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Input 2 (Active in Dual Mode or quick expandable) */}
                {isDualMode ? (
                  <div className="relative flex items-center bg-slate-950/70 rounded-xl border border-amber-500/30">
                    <Package size={18} className="absolute left-3.5 text-amber-400 shrink-0" />
                    <input
                      type="text"
                      value={containerInput2}
                      onChange={(e) => setContainerInput2(e.target.value)}
                      placeholder="Container #2 (e.g. TCLU8492015)..."
                      className="w-full bg-transparent pl-11 pr-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none font-mono tracking-wide"
                    />
                    {containerInput2 && (
                      <button
                        type="button"
                        onClick={() => setContainerInput2('')}
                        className="pr-3 text-slate-500 hover:text-white text-xs cursor-pointer"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsDualMode(true)}
                    className="hidden md:flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border border-dashed border-white/20 text-slate-400 hover:text-amber-300 hover:border-amber-400/40 text-xs transition cursor-pointer"
                  >
                    <span>+ Add 2nd Container Number</span>
                  </button>
                )}
              </div>

              {/* Submit Button */}
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="w-full sm:w-auto py-2.5 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all active:scale-98 cursor-pointer shrink-0"
                >
                  <span>Check Status</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </form>

          {/* Quick Examples */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-slate-400">
            <span className="text-[11px] text-slate-500">Quick Test Samples:</span>
            
            {/* Dual Container Track sample */}
            <button
              type="button"
              onClick={() => handleQuickExample('WHSU5957558', 'TCLU8492015')}
              className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 transition-colors font-mono text-[11px] flex items-center gap-1 cursor-pointer"
              title="Track 2 Containers together (Dual Search)"
            >
              <Package size={12} className="text-amber-400" />
              <span>Track 2 Containers (WHSU5957558 & TCLU8492015)</span>
            </button>

            {/* Repeat container example */}
            <button
              type="button"
              onClick={() => handleQuickExample('WHSU5957558')}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-amber-300 border border-white/10 transition-colors font-mono text-[11px] flex items-center gap-1 cursor-pointer"
              title="Container with 2 visits (1 year ago + Current 2026 shipment)"
            >
              <span>WHSU5957558 (2 Voyages)</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickExample('TCLU8492015')}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-amber-300 border border-white/10 transition-colors font-mono text-[11px] cursor-pointer"
              title="Operated by Truckit (Pvt.) Ltd"
            >
              TCLU8492015 (Truckit)
            </button>

            <button
              type="button"
              onClick={() => handleQuickExample('027G657324')}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-amber-300 border border-white/10 transition-colors font-mono text-[11px] cursor-pointer"
            >
              027G657324 (B/L)
            </button>

            <button
              type="button"
              onClick={() => handleQuickExample('DPL-26-0001')}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-amber-300 border border-white/10 transition-colors font-mono text-[11px] cursor-pointer"
            >
              DPL-26-0001 (Case)
            </button>
          </div>
        </section>

        {/* Results Presentation Area */}
        {activeSearch && (
          <section className="space-y-8 animate-in fade-in duration-300">
            
            {/* Search Header Bar with Match Count & Action Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400">Search results for:</span>
                <span className="font-mono font-bold text-white bg-slate-800 px-2.5 py-0.5 rounded border border-white/10">
                  {activeSearch}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-emerald-400 font-semibold">
                  {matchingCases.length} {matchingCases.length === 1 ? 'operation record found' : 'operation records found'}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-400">Searched across all subsidiary databases</span>
              </div>

              {matchingCases.length > 0 && (
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 bg-slate-900 hover:bg-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Copy direct link to this status"
                  >
                    {copiedLink ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{copiedLink ? 'Link Copied' : 'Copy Direct Link'}</span>
                  </button>

                  {latestCase && (
                    <button
                      type="button"
                      onClick={() => handleDownloadTrackingSlip(latestCase, true)}
                      disabled={isGeneratingPdf}
                      className="text-xs text-amber-300 hover:text-amber-200 px-3.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 flex items-center gap-1.5 font-semibold transition-colors cursor-pointer"
                      title="Download official PDF tracking slip"
                    >
                      <Download size={14} />
                      <span>{isGeneratingPdf ? 'Generating PDF...' : 'Download PDF Slip'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* No Match State */}
            {matchingCases.length === 0 && (
              <div className="p-10 rounded-2xl bg-slate-900/50 border border-white/10 text-center space-y-4 max-w-lg mx-auto">
                <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-white/10 flex items-center justify-center text-slate-400 mx-auto">
                  <AlertCircle size={28} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">No Shipment Record Found</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    No active or historical records matched <code className="text-amber-300 font-mono">{activeSearch}</code> in the database.
                  </p>
                </div>
                <div className="text-left text-xs text-slate-400 bg-slate-950 p-4 rounded-xl border border-white/5 space-y-1.5">
                  <p className="font-semibold text-slate-300">Suggestions:</p>
                  <p>• Make sure the Container Number format is correct (e.g. <code>WHSU5957558</code> or <code>TCLU8492015</code>).</p>
                  <p>• You can also search by your <strong>Bill of Lading (B/L)</strong> number or <strong>Case Reference</strong>.</p>
                  <p>• If newly registered, please allow a short interval for central synchronization.</p>
                </div>
              </div>
            )}

            {/* MULTI-CONTAINER SPECIFIC PRESENTATION (WHEN 2 CONTAINERS ARE SEARCHED) */}
            {tokenResults.length > 1 && (
              <div className="space-y-8">
                <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-amber-400 shrink-0" />
                    <div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                        Dual Container Status Tracking ({tokenResults.length} Containers Monitored)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Operational milestones, vessel bookings, and customs releases displayed per container.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tokenResults.map((t, idx) => (
                      <span key={`tok_pill_${idx}`} className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Container #{idx + 1}: {t.token}
                      </span>
                    ))}
                  </div>
                </div>

                {tokenResults.map((tRes, tIdx) => (
                  <div key={`tok_section_${tRes.token}_${tIdx}`} className="space-y-4 pt-2">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-amber-400 flex items-center justify-center text-[8px] font-bold text-slate-950">
                          {tIdx + 1}
                        </span>
                        <h4 className="text-base font-bold text-white font-mono flex items-center gap-2">
                          <span>Container #{tIdx + 1}:</span>
                          <span className="text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/30">{tRes.token}</span>
                        </h4>
                        <span className="text-xs text-slate-400">
                          ({tRes.count} {tRes.count === 1 ? 'consignments found' : 'consignments found'})
                        </span>
                      </div>
                    </div>

                    {tRes.count === 0 ? (
                      <div className="p-6 rounded-xl bg-slate-900/50 border border-white/10 text-center">
                        <p className="text-xs text-slate-400">
                          No active or historic records found for container <strong className="text-amber-300 font-mono">{tRes.token}</strong>.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {tRes.latest && (
                          <ConsignmentCard 
                            caseItem={tRes.latest} 
                            searchedQuery={tRes.token}
                            onDownloadPdf={() => handleDownloadTrackingSlip(tRes.latest, true)}
                            isLatest={true}
                          />
                        )}

                        {tRes.history.length > 0 && (
                          <div className="space-y-3 pt-2 pl-2 sm:pl-4 border-l-2 border-amber-500/30">
                            <h5 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                              <Clock size={13} className="text-amber-400" />
                              <span>Earlier Voyages for Container {tRes.token} ({tRes.history.length} Previous Consignments)</span>
                            </h5>
                            {tRes.history.map((pastCase, pIdx) => (
                              <ConsignmentCard
                                key={`past_${tRes.token}_${pIdx}`}
                                caseItem={pastCase}
                                searchedQuery={tRes.token}
                                onDownloadPdf={() => handleDownloadTrackingSlip(pastCase, false)}
                                isLatest={false}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* SINGLE CONTAINER / IDENTIFIER PRESENTATION (WHEN 1 CONTAINER IS SEARCHED) */}
            {tokenResults.length <= 1 && latestCase && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      Current / Latest Consignment
                    </h3>
                  </div>
                  {historicCases.length > 0 && (
                    <span className="text-xs text-amber-300 font-medium bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
                      Note: Earlier voyage records for this container are archived below ({historicCases.length} Past Voyages)
                    </span>
                  )}
                </div>

                <ConsignmentCard 
                  caseItem={latestCase} 
                  searchedQuery={activeSearch}
                  onDownloadPdf={() => handleDownloadTrackingSlip(latestCase, true)}
                  isLatest={true}
                />
              </div>
            )}

            {/* PAST / HISTORIC CONSIGNMENTS FOR SINGLE CONTAINER SEARCH */}
            {tokenResults.length <= 1 && historicCases.length > 0 && (
              <div className="space-y-4 pt-6 border-t border-white/10">
                <div className="p-4 rounded-xl bg-slate-900/80 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                      <Clock size={16} className="text-amber-400" />
                      <span>Previous Consignment History (Earlier Voyages &amp; Operations)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      This container previously operated under our logistics network. Historical records are archived below:
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-white/10 shrink-0">
                    {historicCases.length} Previous {historicCases.length === 1 ? 'Record' : 'Records'}
                  </span>
                </div>

                <div className="space-y-4">
                  {historicCases.map((pastCase, pIdx) => (
                    <ConsignmentCard
                      key={`past_${pastCase.id || pastCase.caseNo}_${pIdx}`}
                      caseItem={pastCase}
                      searchedQuery={activeSearch}
                      onDownloadPdf={() => handleDownloadTrackingSlip(pastCase, false)}
                      isLatest={false}
                    />
                  ))}
                </div>
              </div>
            )}

          </section>
        )}

      </main>

      {/* Public Footer */}
      <footer className="border-t border-white/10 bg-slate-950 py-8 text-center text-xs text-slate-400 space-y-3">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-left">
            <p className="font-semibold text-white">MAK Group of Companies — Public Container Tracking Service</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Tower Office: State Life Building No. 7, G-Allana Road, Tower, Karachi, Pakistan.
            </p>
          </div>
          <div className="text-right text-[11px] text-slate-400">
            <p>Central Operations: +92-21-32330103 • info@makgroup.com.pk</p>
            <p className="text-amber-400/90 mt-0.5 font-medium">Zero Financial Disclosures • Pure Milestone Verification</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ConsignmentCardProps {
  caseItem: Case;
  searchedQuery: string;
  onDownloadPdf: () => void;
  isLatest: boolean;
}

const ConsignmentCard: React.FC<ConsignmentCardProps> = ({
  caseItem,
  searchedQuery,
  onDownloadPdf,
  isLatest
}) => {
  const containers = caseItem.containers || [];
  const primaryContainer: Container = containers.find(c => {
    const num = (c.number || (c as any).containerNo || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const q = searchedQuery.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return num.includes(q) || q.includes(num);
  }) || containers[0] || ({ id: 0, number: searchedQuery, size: '40ft', weight: 0, status: 'Pending' } as unknown as Container);

  const cid = (caseItem.companyId || 'docks').toLowerCase();
  const opComp = (() => {
    if (cid === 'truckit') return { name: 'Truckit (Pvt.) Ltd.', badge: 'TRUCKIT', border: 'border-amber-500/30 text-amber-400 bg-amber-500/10' };
    if (cid === 'muhib') return { name: 'Muhib International', badge: 'MUHIB', border: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' };
    if (cid === 'vantage') return { name: 'Vantage Shipping Line', badge: 'VANTAGE', border: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10' };
    return { name: 'Docks (Pvt.) Ltd.', badge: 'DOCKS', border: 'border-blue-500/30 text-blue-400 bg-blue-500/10' };
  })();

  const workflowConfig = getCategoryWorkflow(caseItem.category);
  const activeStepIdx = getWorkflowStepIndex(caseItem.category, caseItem.status);
  const isCompletedCase = caseItem.status === CaseStatus.COMPLETED;

  // Separate completed, current, and incomplete/pending steps
  const completedSteps = workflowConfig.steps.filter((_, idx) => idx < activeStepIdx || isCompletedCase);
  const currentStep = !isCompletedCase ? workflowConfig.steps[activeStepIdx] : null;
  const incompleteSteps = !isCompletedCase ? workflowConfig.steps.filter((_, idx) => idx > activeStepIdx) : [];

  const registrationDate = caseItem.registrationDate || caseItem.createdAt || 'N/A';
  const progressPercent = isCompletedCase ? 100 : Math.round((completedSteps.length / workflowConfig.totalSteps) * 100);

  return (
    <div className={`rounded-2xl border transition-all ${
      isLatest 
        ? 'bg-slate-900/90 border-white/20 shadow-2xl ring-1 ring-white/10' 
        : 'bg-slate-900/50 border-white/10 opacity-95'
    } overflow-hidden`}>
      
      {/* Consignment Header Strip */}
      <div className="p-4 sm:p-6 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 bg-slate-950/60 min-w-0">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${opComp.border} shrink-0`}>
              {opComp.badge}
            </span>
            <span className="font-mono text-base sm:text-xl font-bold text-white tracking-wide truncate">
              {primaryContainer.number || searchedQuery}
            </span>
            <span className="text-xs font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-md flex items-center gap-1 shrink-0">
              <ShieldCheck size={12} className="text-amber-400" />
              <span>Category: {workflowConfig.category}</span>
            </span>
            <span className="text-xs font-semibold text-slate-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded shrink-0">
              {primaryContainer.size || '40ft'} Equipment
            </span>
            {primaryContainer.sealNo && (
              <span className="text-xs text-slate-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded font-mono shrink-0">
                Seal: {primaryContainer.sealNo}
              </span>
            )}
            {isLatest ? (
              <span className="text-xs font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Current Consignment</span>
              </span>
            ) : (
              <span className="text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                <Clock size={11} />
                <span>Previous Voyage (Historical Record)</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-slate-400">
            <span>Case Ref: <strong className="text-white font-mono">{caseItem.caseNo || caseItem.id}</strong></span>
            <span>·</span>
            <span>B/L No: <strong className="text-white font-mono">{caseItem.blNumber || caseItem.extractedData?.blNumber || 'N/A'}</strong></span>
            <span>·</span>
            <span>Category: <strong className="text-amber-300">{workflowConfig.category}</strong></span>
            <span>·</span>
            <span>Date: <strong className="text-slate-300">{registrationDate}</strong></span>
            <span>·</span>
            <span>Operating Entity: <strong className="text-slate-300">{opComp.name}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 pt-1 md:pt-0">
          <button
            type="button"
            onClick={onDownloadPdf}
            className="w-full sm:w-auto px-3.5 sm:px-4 py-2 bg-gradient-to-r from-amber-500/20 to-amber-600/20 hover:from-amber-500/30 hover:to-amber-600/30 text-amber-300 hover:text-amber-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-amber-500/30 transition-all cursor-pointer shadow-sm"
          >
            <Download size={14} />
            <span>Download Status Slip (PDF)</span>
          </button>
        </div>
      </div>

      {/* Consignment Body */}
      <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 min-w-0">
        
        {/* Overall Progress Gauge */}
        <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950/70 border border-white/10 space-y-2 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
            <span className="font-semibold text-slate-300 flex items-center gap-2">
              <Layers size={14} className="text-amber-400" />
              <span>{workflowConfig.category} Milestone Progress</span>
            </span>
            <span className="font-mono font-bold text-amber-300">
              {progressPercent}% Completed ({completedSteps.length} of {workflowConfig.totalSteps} Milestones)
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${isCompletedCase ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-500 to-emerald-500'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Core Shipment Metrics Grid (Strictly Operational - Zero Financials) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 min-w-0">
          
          {/* POL & POD Routing */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/10 space-y-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Anchor size={12} className="text-brand-400 shrink-0" />
              <span className="truncate">Routing (Origin → Destination)</span>
            </span>
            <p className="text-xs font-bold text-white truncate" title={caseItem.pol}>
              {caseItem.pol || 'Port of Loading'}
            </p>
            <div className="flex items-center gap-1 text-[11px] text-slate-400 min-w-0">
              <ArrowRight size={11} className="text-amber-400 shrink-0" />
              <span className="truncate text-slate-300 font-medium" title={caseItem.pod}>
                {caseItem.pod || 'Port of Discharge'}
              </span>
            </div>
          </div>

          {/* Current Milestone / Status */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/10 space-y-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-amber-400 shrink-0" />
              <span className="truncate">Current Status Stage</span>
            </span>
            <p className="text-xs font-bold text-amber-300 truncate" title={String(caseItem.status)}>
              {caseItem.status || 'Active Operations'}
            </p>
            <p className="text-[11px] text-slate-400 truncate">
              {isCompletedCase ? 'Shipment Completed & Delivered' : `Active: ${currentStep?.shortTitle || activeStepIdx + 1}`}
            </p>
          </div>

          {/* Shipping Line & Vessel */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/10 space-y-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Ship size={12} className="text-cyan-400 shrink-0" />
              <span className="truncate">Ocean Line & Vessel</span>
            </span>
            <p className="text-xs font-bold text-white truncate" title={caseItem.extractedData?.shippingLine || caseItem.shippingLine}>
              {caseItem.extractedData?.shippingLine || caseItem.shippingLine || 'Carrier Assigned'}
            </p>
            <p className="text-[11px] text-slate-400 truncate">
              {caseItem.extractedData?.vesselName ? `Vessel: ${caseItem.extractedData.vesselName}` : 'Vessel Voyage'}
              {caseItem.extractedData?.voyageNo ? ` (${caseItem.extractedData.voyageNo})` : ''}
            </p>
          </div>

          {/* Cargo Classification */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/10 space-y-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Box size={12} className="text-purple-400 shrink-0" />
              <span className="truncate">Category & Cargo</span>
            </span>
            <p className="text-xs font-bold text-amber-300 truncate" title={workflowConfig.category}>
              {workflowConfig.category}
            </p>
            <p className="text-[11px] text-slate-400 truncate" title={caseItem.extractedData?.itemName || 'General Cargo'}>
              {caseItem.extractedData?.itemName || (caseItem.extractedData?.grossWeight ? `${caseItem.extractedData.grossWeight.toLocaleString()} KG Gross` : `${primaryContainer.size || '40ft'} Equipment`)}
            </p>
          </div>

        </div>

        {/* Assigned Inland Vehicle Dispatch (If assigned) */}
        {primaryContainer.vehicleNo && (
          <div className="p-3.5 rounded-xl bg-slate-950/50 border border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Truck size={16} />
              </div>
              <div>
                <span className="text-slate-400">Inland Fleet Trailer: </span>
                <strong className="text-white font-mono">{primaryContainer.vehicleNo}</strong>
                {primaryContainer.transporterName && (
                  <span className="text-slate-400"> ({primaryContainer.transporterName})</span>
                )}
              </div>
            </div>
            {primaryContainer.driverName && (
              <div className="text-slate-400 text-[11px]">
                Driver: <strong className="text-slate-200">{primaryContainer.driverName}</strong>
                {primaryContainer.driverContact && ` • ${primaryContainer.driverContact}`}
              </div>
            )}
          </div>
        )}

        {/* INCOMPLETE WORKFLOWS CARD (User brief: "likha Hoga ki is waqt kon kon se workflow incomplete hain") */}
        {!isCompletedCase && (incompleteSteps.length > 0 || currentStep) && (
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-3 shadow-lg shadow-amber-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                <AlertTriangle size={17} className="text-amber-400 shrink-0" />
                <span>Incomplete Workflow Milestones ({incompleteSteps.length + (currentStep ? 1 : 0)} Remaining)</span>
              </div>
              <span className="text-[11px] text-amber-400 font-semibold bg-amber-500/20 px-2 py-0.5 rounded">
                Pending Actions
              </span>
            </div>

            <p className="text-slate-300 leading-relaxed text-xs">
              The following operational milestones are currently pending completion for this consignment:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
              {/* Currently Active Step (In Progress) */}
              {currentStep && (
                <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-amber-300 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      Step {activeStepIdx + 1}: {currentStep.title}
                    </span>
                    <span className="text-[10px] font-bold text-amber-400 uppercase bg-amber-400/20 px-1.5 py-0.5 rounded">
                      In Progress
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {currentStep.description}
                  </p>
                </div>
              )}

              {/* Subsequent Pending Steps */}
              {incompleteSteps.map((s, sIdx) => (
                <div key={s.id || sIdx} className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-300">
                      Step {activeStepIdx + 2 + sIdx}: {s.title}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase bg-white/5 px-1.5 py-0.5 rounded">
                      Awaiting Completion
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {s.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP-BY-STEP WORKFLOW STATUS BREAKDOWN */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>Full Workflow Milestones Breakdown ({workflowConfig.totalSteps} Total Steps)</span>
            </h4>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 size={13} /> {completedSteps.length} Completed
              </span>
              {!isCompletedCase && (
                <span className="text-amber-400 font-semibold flex items-center gap-1">
                  <Clock size={13} /> {incompleteSteps.length + (currentStep ? 1 : 0)} Incomplete
                </span>
              )}
            </div>
          </div>

          {/* Stepper Timeline Visualizer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5 min-w-0">
            {workflowConfig.steps.map((step, idx) => {
              const isCompleted = idx < activeStepIdx || isCompletedCase;
              const isActive = idx === activeStepIdx && !isCompletedCase;
              const isPending = idx > activeStepIdx && !isCompletedCase;

              return (
                <div 
                  key={step.id || idx}
                  className={`p-3 rounded-xl border text-xs transition-all relative min-w-0 break-words ${
                    isCompleted
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                      : isActive
                        ? 'bg-amber-950/40 border-amber-500/50 text-amber-200 ring-1 ring-amber-500/30 shadow-lg'
                        : 'bg-slate-950/50 border-white/5 text-slate-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/40 text-slate-300">
                      Step {idx + 1}
                    </span>

                    {isCompleted ? (
                      <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Complete
                      </span>
                    ) : isActive ? (
                      <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> In Progress
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                        <Clock size={12} /> Incomplete
                      </span>
                    )}
                  </div>

                  <p className={`font-bold leading-snug ${isCompleted ? 'text-white' : isActive ? 'text-amber-200' : 'text-slate-300'}`}>
                    {step.shortTitle || step.title}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Completed Shipment Banner */}
        {isCompletedCase && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-200 flex items-center gap-2.5">
            <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
            <p>
              <strong>Consignment Successfully Concluded:</strong> All operational steps, terminal gate movements, and destination delivery procedures have been fully completed for this container.
            </p>
          </div>
        )}

      </div>
    </div>
  );
};

export default PublicContainerTrackingPortal;

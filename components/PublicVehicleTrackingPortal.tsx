import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Truck, Calendar, Clock, CheckCircle2, AlertCircle, AlertTriangle,
  Download, Share2, Copy, Check, ArrowRight, ShieldCheck, FileText, 
  MapPin, X, ArrowLeft, RefreshCw, Layers, Award, FileCheck, Phone, User,
  Building2, ExternalLink, Package
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Vehicle, VehicleCategory } from '../types';
import { fetchAllTrackingVehicles, searchTrackingVehicles, SEED_TRACKING_VEHICLES } from '../services/vehicleTrackingService';
import { subscribeToVehicles } from '../services/dbService';

interface PublicVehicleTrackingPortalProps {
  initialQuery?: string;
  onExitPortal?: () => void;
  onSwitchToContainerTracker?: () => void;
}

export const PublicVehicleTrackingPortal: React.FC<PublicVehicleTrackingPortalProps> = ({
  initialQuery = '',
  onExitPortal,
  onSwitchToContainerTracker
}) => {
  // Read query from props or URL parameter (?v=, ?vehicle=, ?reg=, ?plate=, ?q=)
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (initialQuery) return initialQuery;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('vehicle') || params.get('v') || params.get('reg') || params.get('plate') || params.get('q') || '';
    }
    return '';
  });

  const [activeSearch, setActiveSearch] = useState<string>('');
  const [vehicles, setVehicles] = useState<Vehicle[]>(SEED_TRACKING_VEHICLES);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>('');

  // Fetch all vehicles across all company databases
  useEffect(() => {
    let isMounted = true;

    const loadAllVehicles = async () => {
      try {
        const allFetched = await fetchAllTrackingVehicles();
        if (isMounted && allFetched && allFetched.length > 0) {
          setVehicles(allFetched);
          setLastSyncedTime(new Date().toLocaleTimeString());
        }
      } catch (err) {
        console.warn('Could not fetch all tracking vehicles:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadAllVehicles();

    // Subscribe to live vehicles updates
    const unsubscribe = subscribeToVehicles(
      (liveVehicles) => {
        if (!isMounted) return;
        if (liveVehicles && Array.isArray(liveVehicles) && liveVehicles.length > 0) {
          setVehicles((prev) => {
            const map = new Map<string, Vehicle>();
            prev.forEach((v) => {
              const reg = v.registrationNumber?.trim().toUpperCase();
              if (reg) map.set(reg, v);
            });
            liveVehicles.forEach((v) => {
              const reg = v.registrationNumber?.trim().toUpperCase();
              if (reg) map.set(reg, v);
            });
            return Array.from(map.values());
          });
          setLastSyncedTime(new Date().toLocaleTimeString());
        }
      },
      () => {}
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Trigger search on mount if initial query exists or when initialQuery changes
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      setSearchQuery(initialQuery.trim());
      setActiveSearch(initialQuery.trim());
      setSelectedVehicle(null);
    } else if (searchQuery.trim() && !activeSearch) {
      setActiveSearch(searchQuery.trim());
    }
  }, [initialQuery, searchQuery]);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = searchQuery.trim();
    if (!clean) return;
    setActiveSearch(clean);
    setSelectedVehicle(null);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('vehicle', clean);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleQuickExample = (examplePlate: string) => {
    setSearchQuery(examplePlate);
    setActiveSearch(examplePlate);
    setSelectedVehicle(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('vehicle', examplePlate);
      window.history.replaceState({}, '', url.toString());
    }
  };

  // Matching vehicles list based on query
  const matchingVehicles = useMemo(() => {
    if (!activeSearch) return [];
    return searchTrackingVehicles(activeSearch, vehicles);
  }, [vehicles, activeSearch]);

  // If exactly 1 match and not explicitly dismissed, auto-select it
  useEffect(() => {
    if (matchingVehicles.length === 1 && !selectedVehicle) {
      setSelectedVehicle(matchingVehicles[0]);
    }
  }, [matchingVehicles]);

  // Calculate validity and status for a vehicle
  const getVehicleStatusAnalysis = (v: Vehicle) => {
    const isCancelled = v.status === 'CANCELLED' || v.cancellationApproved || !!v.nocReference;
    const expiryDateStr = v.validationExpiryDate || '';
    const isExpiredDate = expiryDateStr ? new Date(expiryDateStr).getTime() < Date.now() : false;
    const isExpired = isCancelled ? false : (v.status === 'EXPIRED' || isExpiredDate);

    let statusType: 'CANCELLED_NOC' | 'EXPIRED' | 'ACTIVE_VALID' | 'ON_TRIP' = 'ACTIVE_VALID';
    if (isCancelled) statusType = 'CANCELLED_NOC';
    else if (isExpired) statusType = 'EXPIRED';
    else if (v.status === 'ON_TRIP') statusType = 'ON_TRIP';

    const renewals = (v.history || []).filter(h => 
      h.description?.toLowerCase().includes('renewal') || 
      h.description?.toLowerCase().includes('renew')
    );
    const renewalCount = renewals.length;
    const tripsCount = v.tripsHistory?.length || 0;

    return {
      statusType,
      isCancelled,
      isExpired,
      renewalCount,
      renewals,
      tripsCount,
      expiryDateStr
    };
  };

  // Helper to get operating company badge
  const getOperatingCompany = (v: Vehicle) => {
    const cid = (v.operatingCompany || 'docks').toLowerCase();
    if (cid === 'truckit') return { name: 'Truckit (Pvt.) Ltd.', short: 'TRUCKIT', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
    if (cid === 'muhib') return { name: 'Muhib International', short: 'MUHIB', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
    if (cid === 'vantage') return { name: 'Vantage Shipping Line', short: 'VANTAGE', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' };
    return { name: 'Docks (Pvt.) Ltd.', short: 'DOCKS', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' };
  };

  // Generate Official Vehicle Status & NOC Clearance Slip (PDF)
  const handleDownloadVehicleCertificate = (targetVehicle: Vehicle) => {
    setIsGeneratingPdf(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 16;
      let y = 16;

      const analysis = getVehicleStatusAnalysis(targetVehicle);
      const opComp = getOperatingCompany(targetVehicle);

      // Header Banner
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
      doc.text('CENTRAL FLEET VERIFICATION & REGISTRATION PORTAL', pageWidth / 2, y, { align: 'center' });

      y += 5;
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text('Official Fleet Verification & Status Certificate • vehicle.makpk.online', pageWidth / 2, y, { align: 'center' });

      y += 18;

      // Certificate Title
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('OFFICIAL VEHICLE STATUS & FLEET DOSSIER', margin, y);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      const generatedAt = new Date().toLocaleString('en-GB');
      doc.text(`Generated: ${generatedAt} PKT`, pageWidth - margin, y, { align: 'right' });

      y += 5;
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;

      // Status Badge Box
      if (analysis.statusType === 'CANCELLED_NOC') {
        doc.setFillColor(254, 242, 242); // red-50
        doc.setDrawColor(239, 68, 68);
        doc.rect(margin, y, pageWidth - (margin * 2), 16, 'FD');
        doc.setTextColor(185, 28, 28);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('STATUS: DEREGISTERED / NOC ISSUED', margin + 4, y + 6);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`NOC Ref: ${targetVehicle.nocReference || 'NOC-MAK-ISSUED'}  •  Date: ${targetVehicle.nocDate || targetVehicle.cancellationDate || 'N/A'}`, margin + 4, y + 11.5);
      } else if (analysis.statusType === 'EXPIRED') {
        doc.setFillColor(254, 242, 242); // red-50
        doc.setDrawColor(239, 68, 68);
        doc.rect(margin, y, pageWidth - (margin * 2), 16, 'FD');
        doc.setTextColor(185, 28, 28);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('STATUS: PERMIT EXPIRED (Renewal Required)', margin + 4, y + 6);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`Validity Expired On: ${targetVehicle.validationExpiryDate || 'Overdue'}  •  Renewal Required`, margin + 4, y + 11.5);
      } else {
        doc.setFillColor(240, 253, 244); // green-50
        doc.setDrawColor(34, 197, 94);
        doc.rect(margin, y, pageWidth - (margin * 2), 16, 'FD');
        doc.setTextColor(21, 128, 61);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('STATUS: ACTIVE & ENROLLED FLEET', margin + 4, y + 6);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`Valid Until: ${targetVehicle.validationExpiryDate || 'Active'}  •  Operational in ${opComp.name}`, margin + 4, y + 11.5);
      }

      y += 22;

      // Primary Vehicle Specifications Table
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, pageWidth - (margin * 2), 44, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, pageWidth - (margin * 2), 44, 'S');

      const col1 = margin + 4;
      const col2 = margin + 65;
      const col3 = margin + 125;
      let boxY = y + 7;

      // Row 1
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('VEHICLE REGISTRATION NO', col1, boxY);
      doc.text('MAK SERIAL REFERENCE', col2, boxY);
      doc.text('FLEET CATEGORY', col3, boxY);

      boxY += 4.5;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(targetVehicle.registrationNumber || 'N/A', col1, boxY);
      doc.text(targetVehicle.dplSerial || 'N/A', col2, boxY);
      doc.text(String(targetVehicle.category || 'Bonded Carrier'), col3, boxY);

      boxY += 8;
      // Row 2
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('REGISTRATION DATE', col1, boxY);
      doc.text('MAKE & MODEL', col2, boxY);
      doc.text('MRA (REGISTERING AUTHORITY)', col3, boxY);

      boxY += 4.5;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(targetVehicle.registrationDate || 'N/A', col1, boxY);
      doc.text(`${targetVehicle.make || targetVehicle.maker || 'Commercial Mover'} (${targetVehicle.model || 'N/A'})`, col2, boxY);
      doc.text(targetVehicle.mra || 'PAKISTAN', col3, boxY);

      boxY += 8;
      // Row 3
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('REGISTERED TRANSPORTER / BROKER', col1, boxY);
      doc.text('ASSIGNED DRIVER & CONTACT', col2, boxY);
      doc.text('OPERATING SUBSIDIARY', col3, boxY);

      boxY += 4.5;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(targetVehicle.transporterName || 'Fleet Operator', col1, boxY);
      doc.text(`${targetVehicle.driverName || 'Designated Driver'} (${targetVehicle.driverContact || 'N/A'})`, col2, boxY);
      doc.text(opComp.name, col3, boxY);

      y += 50;

      // Renewals History Section ("renewal kab kab hui kitni bar ho chuki hai")
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`RENEWAL HISTORY (${analysis.renewalCount} RENEWALS COMPLETED)`, margin, y);
      y += 5;

      // Table Header for Renewals
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, pageWidth - (margin * 2), 6, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('#', margin + 3, y + 4.2);
      doc.text('RENEWAL DATE', margin + 12, y + 4.2);
      doc.text('CYCLE & VALIDITY EXTENSION', margin + 45, y + 4.2);
      doc.text('RECORD DESCRIPTION', margin + 105, y + 4.2);
      y += 7;

      if (analysis.renewals.length === 0) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text('Initial registration period active. No renewal cycles logged yet.', margin + 4, y + 4);
        y += 8;
      } else {
        analysis.renewals.forEach((r, idx) => {
          doc.setFillColor(idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 250);
          doc.rect(margin, y, pageWidth - (margin * 2), 7, 'F');

          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(100, 116, 139);
          doc.text(String(idx + 1), margin + 4, y + 4.8);

          doc.setTextColor(15, 23, 42);
          doc.text(r.date || 'N/A', margin + 12, y + 4.8);

          doc.setTextColor(30, 41, 59);
          doc.text(`Bi-Annual Fleet Renewal`, margin + 45, y + 4.8);

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(71, 85, 105);
          const desc = r.description.length > 50 ? `${r.description.substring(0, 47)}...` : r.description;
          doc.text(desc, margin + 105, y + 4.8);

          y += 7;
        });
      }

      y += 6;

      // Trips Completed Section ("kitne trip lagakar a chuki hai")
      const trips = targetVehicle.tripsHistory || [];
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`CARGO TRIPS LOG (${trips.length} TOTAL TRIPS COMPLETED)`, margin, y);
      y += 5;

      // Table Header for Trips
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, pageWidth - (margin * 2), 6, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('DATE', margin + 3, y + 4.2);
      doc.text('CASE REF', margin + 25, y + 4.2);
      doc.text('CONTAINER NO', margin + 50, y + 4.2);
      doc.text('ROUTE (ORIGIN → DESTINATION)', margin + 85, y + 4.2);
      doc.text('STATUS', pageWidth - margin - 3, y + 4.2, { align: 'right' });
      y += 7;

      if (trips.length === 0) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text('No active trip logs recorded under this vehicle.', margin + 4, y + 4);
        y += 8;
      } else {
        trips.slice(0, 5).forEach((t, idx) => {
          doc.setFillColor(idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 250);
          doc.rect(margin, y, pageWidth - (margin * 2), 7, 'F');

          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 116, 139);
          doc.text(t.date || 'N/A', margin + 3, y + 4.8);

          doc.setFont('helvetica', 'bold');
          doc.setTextColor(15, 23, 42);
          doc.text(t.caseNo || 'N/A', margin + 25, y + 4.8);

          doc.setTextColor(30, 41, 59);
          doc.text(t.containerNumber || 'N/A', margin + 50, y + 4.8);

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(71, 85, 105);
          const rText = t.route.length > 40 ? `${t.route.substring(0, 38)}...` : t.route;
          doc.text(rText, margin + 85, y + 4.8);

          doc.setFont('helvetica', 'bold');
          if (t.status === 'In Transit') {
            doc.setTextColor(217, 119, 6);
            doc.text('IN TRANSIT', pageWidth - margin - 3, y + 4.8, { align: 'right' });
          } else {
            doc.setTextColor(22, 163, 74);
            doc.text('DELIVERED', pageWidth - margin - 3, y + 4.8, { align: 'right' });
          }

          y += 7;
        });
      }

      y += 10;

      // Verification Notice & Disclaimer
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, pageWidth - (margin * 2), 18, 'F');
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, pageWidth - (margin * 2), 18, 'S');

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('PUBLIC VERIFICATION & FLEET AUTHORITY NOTICE', margin + 4, y + 4.5);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text('1. Verification: This vehicle registration status is verified online via vehicle.makpk.online.', margin + 4, y + 8.5);
      doc.text('2. Pure Operational Record: Financial accounts, haulage rates, and driver ledger are strictly confidential.', margin + 4, y + 12.5);
      doc.text('3. NOC Clearance: If deregistered, the vehicle is no longer authorized for Bonded / Afghan Transit operations.', margin + 4, y + 16);

      y += 24;

      // Footer
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(`MAK Group of Companies • vehicle.makpk.online • Plate ${targetVehicle.registrationNumber || ''}`, pageWidth / 2, 287, { align: 'center' });

      const safeFilename = `Vehicle_${(targetVehicle.registrationNumber || 'Plate').replace(/[^a-zA-Z0-9_-]/g, '_')}_Status.pdf`;
      doc.save(safeFilename);
    } catch (err) {
      console.error('Error generating vehicle PDF:', err);
      alert('Could not generate PDF. Please try again.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleCopyShareLink = () => {
    if (typeof window === 'undefined') return;
    const plate = encodeURIComponent(activeSearch);
    const shareUrl = window.location.hostname.includes('vehicle.makpk.online')
      ? `https://vehicle.makpk.online?vehicle=${plate}`
      : `${window.location.origin}/?mode=vehicle&plate=${plate}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }).catch(() => {});
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      
      {/* Top Header Strip (Clean, Standalone, No Sidebar) */}
      <header className="border-b border-white/10 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40 shadow-xl w-full max-w-full overflow-hidden">
        <div className="max-w-6xl w-full mx-auto px-3 sm:px-6 min-h-16 py-2.5 flex items-center justify-between gap-2 sm:gap-4">
          
          {/* Brand Logo & Title */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-brand-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
              <Truck size={20} className="sm:w-[22px] sm:h-[22px]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-xs sm:text-base font-bold text-white tracking-wide truncate max-w-[130px] sm:max-w-none">
                  MAK GROUP
                </h1>
                <span className="text-[9px] sm:text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 sm:px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                  Vehicle Status
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 hidden sm:block truncate">
                Fleet Status, Renewal Cycles, Completed Trips & NOC Verification
              </p>
            </div>
          </div>

          {/* Subdomain & Switcher to Container Status */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <div className="text-right hidden md:block">
              <span className="text-xs text-amber-400 font-mono font-bold block">
                vehicle.makpk.online
              </span>
              <span className="text-[10px] text-slate-400 block">
                {lastSyncedTime ? `Live synced at ${lastSyncedTime}` : 'Multi-entity real-time sync'}
              </span>
            </div>

            {/* Link to Container Tracking (status.makpk.online) */}
            <button
              type="button"
              onClick={onSwitchToContainerTracker || (() => { window.location.href = 'https://status.makpk.online'; })}
              className="text-[11px] sm:text-xs text-amber-300 hover:text-white px-2.5 sm:px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-colors flex items-center gap-1 sm:gap-1.5 cursor-pointer shadow-sm shrink-0"
              title="Open Container & Shipment Status Tracking (status.makpk.online)"
            >
              <Package size={13} className="text-amber-400 shrink-0" />
              <span>Container Status</span>
            </button>

            {/* Exit / Close Button (Only if invoked from inside the workspace) */}
            {onExitPortal && (
              <button
                type="button"
                onClick={onExitPortal}
                className="text-[11px] sm:text-xs text-slate-300 hover:text-white px-2.5 sm:px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                title="Close and return to Internal Workspace"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Vehicle Verification Portal View */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6 sm:space-y-8 min-w-0">
        
        {/* Hero Search Section */}
        <section className="text-center space-y-4 max-w-3xl mx-auto pt-2">
          
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 bg-slate-900 border border-white/10 px-3.5 py-1.5 rounded-full shadow-sm">
            <ShieldCheck size={14} className="text-emerald-400" />
            <span>Public Fleet & Transporter Vehicle Verification Portal • vehicle.makpk.online</span>
          </div>

          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight">
            Check Vehicle Status & Fleet History
          </h2>
          
          <p className="text-xs sm:text-sm text-slate-300 max-w-xl mx-auto leading-relaxed">
            Enter any <strong>Vehicle Registration Number</strong> to verify registration date, bi-annual renewals, trip count, validity status, and NOC de-registration certificate.
          </p>

          <p className="text-[12px] text-amber-300/90 font-medium">
            (Complete fleet dossier for transporters, brokers, and clients — registration, renewals, trips, expiry, and NOC status)
          </p>

          {/* Search Form */}
          <form onSubmit={handleSearchSubmit} className="pt-2">
            <div className="relative flex flex-col sm:flex-row items-stretch gap-2 bg-slate-900/90 p-2 rounded-2xl border border-white/15 shadow-2xl focus-within:border-amber-400/60 focus-within:ring-2 focus-within:ring-amber-400/20 transition-all">
              <div className="relative flex-1 flex items-center">
                <Search size={20} className="absolute left-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Enter Vehicle Plate (e.g. TLB-892, P-9912, KHI-7721, JU-4412)..."
                  className="w-full bg-transparent pl-12 pr-4 py-3 text-sm text-white placeholder-slate-500 outline-none font-mono tracking-wide"
                />
              </div>

              <button
                type="submit"
                className="py-3 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all active:scale-98 cursor-pointer shrink-0"
              >
                <span>Search Fleet</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </form>

          {/* Quick Examples */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-slate-400">
            <span className="text-[11px] text-slate-500">Quick Test Samples:</span>
            
            <button
              type="button"
              onClick={() => handleQuickExample('TLB-892')}
              className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-colors font-mono text-[11px] flex items-center gap-1 cursor-pointer"
              title="Active Bonded Vehicle with 4 renewals & 24 trips"
            >
              <span>TLB-892 (Active • 24 Trips)</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickExample('P-9912')}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-amber-300 border border-white/10 transition-colors font-mono text-[11px] cursor-pointer"
              title="Afghan Transit Carrier under Truckit"
            >
              P-9912 (Truckit)
            </button>

            <button
              type="button"
              onClick={() => handleQuickExample('KHI-7721')}
              className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 transition-colors font-mono text-[11px] flex items-center gap-1 cursor-pointer"
              title="Demonstrates Deregistered / NOC Issued Vehicle"
            >
              <span>KHI-7721 (NOC Issued)</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickExample('JU-4412')}
              className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-colors font-mono text-[11px] flex items-center gap-1 cursor-pointer"
              title="Demonstrates Expired Vehicle"
            >
              <span>JU-4412 (Expired)</span>
            </button>
          </div>
        </section>

        {/* Results Area */}
        {activeSearch && (
          <section className="space-y-6 animate-in fade-in duration-300">
            
            {/* Search Header Bar with Count */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400">Search results for:</span>
                <span className="font-mono font-bold text-white bg-slate-800 px-2.5 py-0.5 rounded border border-white/10">
                  {activeSearch}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-emerald-400 font-semibold">
                  {matchingVehicles.length} {matchingVehicles.length === 1 ? 'vehicle record found' : 'vehicle records found'}
                </span>
              </div>

              {matchingVehicles.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 bg-slate-900 hover:bg-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Copy direct link to this vehicle status"
                  >
                    {copiedLink ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{copiedLink ? 'Link Copied' : 'Copy Direct Link'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* No Match State */}
            {matchingVehicles.length === 0 && (
              <div className="p-10 rounded-2xl bg-slate-900/50 border border-white/10 text-center space-y-4 max-w-lg mx-auto">
                <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-white/10 flex items-center justify-center text-slate-400 mx-auto">
                  <AlertCircle size={28} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">No Vehicle Found</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    No fleet record matched <code className="text-amber-300 font-mono">{activeSearch}</code> in the database.
                  </p>
                </div>
                <div className="text-left text-xs text-slate-400 bg-slate-950 p-4 rounded-xl border border-white/5 space-y-1.5">
                  <p className="font-semibold text-slate-300">Tips:</p>
                  <p>• Make sure the plate number includes letters and digits (e.g. <code>TLB-892</code> or <code>P-9912</code>).</p>
                  <p>• You can also search by partial registration number or the transporter name.</p>
                </div>
              </div>
            )}

            {/* Matching Vehicles Grid (User brief: "Jo bhi vehicle number likha jaega use number se kitne ki vehicles hongi woh neeche a jaayengi") */}
            {matchingVehicles.length > 0 && !selectedVehicle && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400 font-medium">
                  Select a vehicle below to view its complete registration, renewal history, trips and NOC status:
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {matchingVehicles.map((v) => {
                    const analysis = getVehicleStatusAnalysis(v);
                    const opComp = getOperatingCompany(v);

                    return (
                      <div
                        key={v.id || v.registrationNumber}
                        onClick={() => setSelectedVehicle(v)}
                        className="p-5 rounded-2xl bg-slate-900/90 hover:bg-slate-900 border border-white/10 hover:border-amber-400/50 transition-all cursor-pointer group shadow-xl hover:shadow-2xl hover:scale-[1.01] flex flex-col justify-between gap-4"
                      >
                        <div className="space-y-3">
                          {/* Plate Strip */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${opComp.color}`}>
                                {opComp.short}
                              </span>
                              <span className="font-mono text-lg font-bold text-white tracking-wider group-hover:text-amber-300 transition-colors">
                                {v.registrationNumber}
                              </span>
                            </div>

                            {/* Status Badge */}
                            {analysis.statusType === 'CANCELLED_NOC' ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
                                NOC Issued
                              </span>
                            ) : analysis.statusType === 'EXPIRED' ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
                                Expired
                              </span>
                            ) : analysis.statusType === 'ON_TRIP' ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                On Trip
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                Active / Valid
                              </span>
                            )}
                          </div>

                          {/* Quick Specs */}
                          <div className="text-xs text-slate-300 space-y-1">
                            <p className="truncate">
                              <span className="text-slate-400">Category: </span>
                              <strong>{v.category || 'Bonded Carrier'}</strong>
                            </p>
                            <p className="truncate">
                              <span className="text-slate-400">Transporter: </span>
                              <strong>{v.transporterName || 'Fleet Operator'}</strong>
                            </p>
                            <p className="truncate">
                              <span className="text-slate-400">Registered: </span>
                              <span>{v.registrationDate || 'N/A'}</span>
                            </p>
                          </div>
                        </div>

                        {/* Quick Stats Footer */}
                        <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
                          <span className="text-amber-300 font-semibold">
                            {analysis.renewalCount} Renewals
                          </span>
                          <span className="text-emerald-300 font-semibold">
                            {analysis.tripsCount} Completed Trips
                          </span>
                          <span className="text-slate-400 group-hover:text-white transition-colors flex items-center gap-1 font-bold">
                            View Dossier →
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* FULL VEHICLE STATUS DOSSIER (User brief: "vah apni vehicle per click kar kar use vehicle ka status Dekh sakega") */}
            {selectedVehicle && (
              <div className="space-y-6">
                
                {/* Back to Results / Switch Vehicle */}
                {matchingVehicles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSelectedVehicle(null)}
                    className="text-xs text-slate-300 hover:text-white px-3.5 py-1.5 rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 flex items-center gap-2 transition-colors cursor-pointer w-fit"
                  >
                    <ArrowLeft size={14} />
                    <span>Back to matching vehicles ({matchingVehicles.length})</span>
                  </button>
                )}

                <VehicleDossierCard
                  vehicle={selectedVehicle}
                  onDownloadPdf={() => handleDownloadVehicleCertificate(selectedVehicle)}
                />
              </div>
            )}

          </section>
        )}

      </main>

      {/* Public Footer */}
      <footer className="border-t border-white/10 bg-slate-950 py-8 text-center text-xs text-slate-400 space-y-3">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-left">
            <p className="font-semibold text-white">MAK Group of Companies — Central Vehicle Verification Service</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Tower Office: State Life Building No. 7, G-Allana Road, Tower, Karachi, Pakistan.
            </p>
          </div>
          <div className="text-right text-[11px] text-slate-400">
            <p>Direct Support: +92-21-32330103 • fleet@makgroup.com.pk</p>
            <p className="text-amber-400/90 mt-0.5 font-medium">Read-Only Verification • Zero Financial Data Disclosed</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

interface VehicleDossierCardProps {
  vehicle: Vehicle;
  onDownloadPdf: () => void;
}

const VehicleDossierCard: React.FC<VehicleDossierCardProps> = ({
  vehicle,
  onDownloadPdf
}) => {
  const cid = (vehicle.operatingCompany || 'docks').toLowerCase();
  const opComp = (() => {
    if (cid === 'truckit') return { name: 'Truckit (Pvt.) Ltd.', badge: 'TRUCKIT', border: 'border-amber-500/30 text-amber-400 bg-amber-500/10' };
    if (cid === 'muhib') return { name: 'Muhib International', badge: 'MUHIB', border: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' };
    if (cid === 'vantage') return { name: 'Vantage Shipping Line', badge: 'VANTAGE', border: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10' };
    return { name: 'Docks (Pvt.) Ltd.', badge: 'DOCKS', border: 'border-blue-500/30 text-blue-400 bg-blue-500/10' };
  })();

  const isCancelled = vehicle.status === 'CANCELLED' || vehicle.cancellationApproved || !!vehicle.nocReference;
  const expiryDateStr = vehicle.validationExpiryDate || '';
  const isExpiredDate = expiryDateStr ? new Date(expiryDateStr).getTime() < Date.now() : false;
  const isExpired = isCancelled ? false : (vehicle.status === 'EXPIRED' || isExpiredDate);

  const renewals = (vehicle.history || []).filter(h => 
    h.description?.toLowerCase().includes('renewal') || 
    h.description?.toLowerCase().includes('renew')
  );
  const trips = vehicle.tripsHistory || [];

  return (
    <div className="rounded-3xl border border-white/20 bg-slate-900/95 shadow-2xl overflow-hidden ring-1 ring-white/10">
      
      {/* Top Banner Strip */}
      <div className="p-4 sm:p-6 border-b border-white/10 bg-slate-950/80 flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 min-w-0">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${opComp.border} shrink-0`}>
              {opComp.badge}
            </span>
            <span className="font-mono text-xl sm:text-3xl font-extrabold text-white tracking-wider truncate">
              {vehicle.registrationNumber}
            </span>
            <span className="text-xs font-semibold text-slate-300 bg-white/5 border border-white/10 px-2.5 py-0.5 rounded shrink-0">
              {vehicle.category || 'Bonded Carrier'}
            </span>

            {/* Status Pills */}
            {isCancelled ? (
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 flex items-center gap-1.5 animate-pulse shrink-0">
                <AlertTriangle size={13} />
                <span>NOC Issued / Cancelled</span>
              </span>
            ) : isExpired ? (
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 flex items-center gap-1.5 shrink-0">
                <Clock size={13} />
                <span>Expired</span>
              </span>
            ) : vehicle.status === 'ON_TRIP' ? (
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40 flex items-center gap-1.5 shrink-0">
                <Truck size={13} />
                <span>On Active Trip</span>
              </span>
            ) : (
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 shrink-0">
                <CheckCircle2 size={13} />
                <span>Active &amp; Valid</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-slate-400">
            <span>DPL Serial: <strong className="text-white font-mono">{vehicle.dplSerial || 'N/A'}</strong></span>
            <span>·</span>
            <span>Registered On: <strong className="text-slate-200">{vehicle.registrationDate || 'N/A'}</strong></span>
            <span>·</span>
            <span>Operating Entity: <strong className="text-slate-200">{opComp.name}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 pt-1 md:pt-0">
          <button
            type="button"
            onClick={onDownloadPdf}
            className="w-full sm:w-auto px-3.5 sm:px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer active:scale-95"
            title="Download official PDF vehicle status certificate"
          >
            <Download size={14} />
            <span>Download Certificate (PDF)</span>
          </button>
        </div>
      </div>

      {/* Main Dossier Content */}
      <div className="p-6 space-y-6">
        
        {/* CRITICAL STATUS NOTICE CARDS */}
        {isCancelled && (
          <div className="p-4 sm:p-5 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs space-y-2">
            <div className="flex items-center gap-2 text-red-300 font-bold text-sm">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <span>De-registration / No Objection Certificate (NOC) Issued</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              This vehicle is officially deregistered from the MAK Group bonded fleet and an official NOC certificate has been issued.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-slate-300 bg-black/30 p-3 rounded-xl border border-white/5">
              <div>
                <span className="text-slate-400 block text-[11px]">NOC Reference:</span>
                <strong className="text-amber-300 font-mono text-xs">{vehicle.nocReference || 'NOC-MAK-2025-0419'}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">NOC Issue Date:</span>
                <strong className="text-white text-xs">{vehicle.nocDate || vehicle.cancellationDate || 'N/A'}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Reason:</span>
                <span className="text-slate-300 text-xs">{vehicle.cancellationReason || 'Transferred / Sold to General Haulage'}</span>
              </div>
            </div>
          </div>
        )}

        {isExpired && !isCancelled && (
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-2">
            <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
              <Clock size={18} className="text-amber-400 shrink-0" />
              <span>Fleet Validation Overdue / Expired</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              Bonded fleet registration expired on <strong>{vehicle.validationExpiryDate}</strong>. Renewal required prior to dispatch authorization.
            </p>
          </div>
        )}

        {/* 4 HIGHLIGHT METRICS (Registered Date, Renewals Count, Completed Trips, Expiry) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* Registered Date ("register kab hui thi") */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/10 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Calendar size={13} className="text-amber-400" />
              <span>Registration Date</span>
            </span>
            <p className="text-sm font-bold text-white">
              {vehicle.registrationDate || 'N/A'}
            </p>
            <p className="text-[11px] text-slate-400">
              MAK Serial: {vehicle.dplSerial || 'Registered'}
            </p>
          </div>

          {/* Renewals Count ("kitni bar renewal ho chuki hai") */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/10 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <RefreshCw size={13} className="text-cyan-400" />
              <span>Renewals Count</span>
            </span>
            <p className="text-sm font-bold text-cyan-300 font-mono">
              {renewals.length} {renewals.length === 1 ? 'Renewal' : 'Renewals Completed'}
            </p>
            <p className="text-[11px] text-slate-400">
              Bi-Annual Verification Cycles
            </p>
          </div>

          {/* Completed Trips Count ("kitne trip lagakar a chuki hai") */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/10 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Award size={13} className="text-emerald-400" />
              <span>Trips Completed</span>
            </span>
            <p className="text-sm font-bold text-emerald-300 font-mono">
              {trips.length} {trips.length === 1 ? 'Trip' : 'Trips Logged'}
            </p>
            <p className="text-[11px] text-slate-400">
              Containerized & Bonded Haulage
            </p>
          </div>

          {/* Expiry Date ("yeah expire hai") */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/10 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Clock size={13} className={isExpired ? 'text-red-400' : 'text-emerald-400'} />
              <span>Validity Expiry</span>
            </span>
            <p className={`text-sm font-bold ${isExpired ? 'text-red-400' : 'text-white'}`}>
              {vehicle.validationExpiryDate || 'Active'}
            </p>
            <p className="text-[11px] text-slate-400">
              {isCancelled ? 'NOC Released' : isExpired ? 'Renewal Overdue' : 'Valid & Authorized'}
            </p>
          </div>

        </div>

        {/* VEHICLE TECHNICAL & TRANSPORTER SPECIFICATIONS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Vehicle Tech Specs */}
          <div className="p-5 rounded-2xl bg-slate-950/60 border border-white/10 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Truck size={15} className="text-amber-400" />
              <span>Vehicle Specifications</span>
            </h4>
            
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block text-[11px]">Make & Model:</span>
                <strong className="text-white">{vehicle.make || vehicle.maker || 'Commercial'} ({vehicle.model || 'N/A'})</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Body Type:</span>
                <strong className="text-white">{vehicle.type || 'Flatbed Trailer'}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Chassis No:</span>
                <span className="font-mono text-slate-300 text-[11px]">{vehicle.chassisNo || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Engine No:</span>
                <span className="font-mono text-slate-300 text-[11px]">{vehicle.engineNo || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">MRA Location:</span>
                <span className="text-white">{vehicle.mra || 'Karachi'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Capacity / Weight:</span>
                <span className="text-white">{vehicle.weightCapacity || '40 Tons'}</span>
              </div>
            </div>
          </div>

          {/* Transporter & Driver Specs */}
          <div className="p-5 rounded-2xl bg-slate-950/60 border border-white/10 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Building2 size={15} className="text-cyan-400" />
              <span>Transporter & Driver Details</span>
            </h4>
            
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="col-span-2">
                <span className="text-slate-400 block text-[11px]">Transporter / Company:</span>
                <strong className="text-white text-sm">{vehicle.transporterName || 'Fleet Operator'}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Broker / Agent:</span>
                <span className="text-slate-300">{vehicle.brokerName || 'Direct Transporter'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Owner Title:</span>
                <span className="text-slate-300">{vehicle.ownerName || 'Company Fleet'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Driver Name:</span>
                <strong className="text-white">{vehicle.driverName || 'Designated Driver'}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Driver Contact:</span>
                <span className="font-mono text-slate-300">{vehicle.driverContact || 'N/A'}</span>
              </div>
            </div>
          </div>

        </div>

        {/* SECTION: RENEWAL HISTORY TIMELINE ("renewal kab kab hui kitni bar ho chuki hai") */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <RefreshCw size={15} className="text-cyan-400" />
              <span>Renewal Timeline & History ({renewals.length} Cycles)</span>
            </h4>
            <span className="text-xs text-slate-400">
              Complete renewal history and validity cycles
            </span>
          </div>

          {renewals.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-950/40 border border-white/5 text-xs text-slate-400">
              Initial registration period active. No subsequent renewal records logged yet.
            </div>
          ) : (
            <div className="space-y-2">
              {renewals.map((r, idx) => (
                <div 
                  key={r.id || idx}
                  className="p-3.5 rounded-xl bg-slate-950/70 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center font-mono font-bold text-xs shrink-0">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="font-bold text-white">
                        {r.description}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Renewal Date: <strong className="text-slate-300">{r.date}</strong>
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 w-fit">
                    Verified Bi-Annual Renewal
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SECTION: COMPLETED TRIPS BREAKDOWN ("kitne trip lagakar a chuki hai") */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Award size={15} className="text-emerald-400" />
              <span>Completed Cargo Trips & Route Log ({trips.length} Total Trips)</span>
            </h4>
            <span className="text-xs text-slate-400">
              Completed cargo trips and container manifest records
            </span>
          </div>

          {trips.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-950/40 border border-white/5 text-xs text-slate-400">
              No cargo trip history recorded yet for this vehicle registration.
            </div>
          ) : (
            <div className="w-full max-w-full overflow-x-auto custom-scrollbar rounded-xl border border-white/10 bg-slate-950/60">
              <table className="w-full text-left text-xs text-slate-300 min-w-[620px]">
                <thead className="bg-slate-950 text-slate-400 font-bold uppercase text-[10px] border-b border-white/10">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Case Ref</th>
                    <th className="py-2.5 px-3">Container No</th>
                    <th className="py-2.5 px-3">Route (Origin → Destination)</th>
                    <th className="py-2.5 px-3">Consignee</th>
                    <th className="py-2.5 px-3 text-right">Trip Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {trips.map((t, tIdx) => (
                    <tr key={t.id || tIdx} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">{t.date}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-white">{t.caseNo}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-amber-300">{t.containerNumber || 'N/A'}</td>
                      <td className="py-2.5 px-3 text-slate-200">{t.route}</td>
                      <td className="py-2.5 px-3 text-slate-400 truncate max-w-[150px]">{t.clientName}</td>
                      <td className="py-2.5 px-3 text-right">
                        {t.status === 'In Transit' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            In Transit
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            Delivered
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default PublicVehicleTrackingPortal;

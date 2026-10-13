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
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE_VALID' | 'ON_TRIP' | 'EXPIRED' | 'CANCELLED_NOC'>('ALL');
  const [vehicles, setVehicles] = useState<Vehicle[]>(SEED_TRACKING_VEHICLES);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>('');

  useEffect(() => {
    if (selectedVehicle) {
      document.title = `${selectedVehicle.registrationNumber} - Fleet Status & Verification • vehicle.makpk.online`;
    } else if (activeSearch) {
      document.title = `${activeSearch} - Vehicle Status • vehicle.makpk.online`;
    } else {
      document.title = 'Vehicle Status & Fleet Verification • vehicle.makpk.online';
    }
  }, [selectedVehicle, activeSearch]);

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
  }, [matchingVehicles, selectedVehicle]);

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
    if (cid === 'truckit') return { name: 'Truckit (Pvt.) Ltd.', short: 'TRUCKIT', color: 'text-amber-800 bg-amber-50 border-amber-300' };
    if (cid === 'muhib') return { name: 'Muhib International', short: 'MUHIB', color: 'text-emerald-800 bg-emerald-50 border-emerald-300' };
    if (cid === 'vantage') return { name: 'Vantage Shipping Line', short: 'VANTAGE', color: 'text-cyan-800 bg-cyan-50 border-cyan-300' };
    return { name: 'Docks (Pvt.) Ltd.', short: 'DOCKS', color: 'text-blue-800 bg-blue-50 border-blue-300' };
  };

  // Filtered vehicles when browsing full fleet (no search query)
  const browsableVehicles = useMemo(() => {
    if (activeSearch) return matchingVehicles;
    if (statusFilter === 'ALL') return vehicles;
    return vehicles.filter(v => {
      const a = getVehicleStatusAnalysis(v);
      return a.statusType === statusFilter;
    });
  }, [vehicles, activeSearch, matchingVehicles, statusFilter]);

  const fleetCounts = useMemo(() => {
    let active = 0, onTrip = 0, expired = 0, noc = 0;
    vehicles.forEach(v => {
      const a = getVehicleStatusAnalysis(v);
      if (a.statusType === 'ACTIVE_VALID') active++;
      else if (a.statusType === 'ON_TRIP') onTrip++;
      else if (a.statusType === 'EXPIRED') expired++;
      else if (a.statusType === 'CANCELLED_NOC') noc++;
    });
    return { all: vehicles.length, active, onTrip, expired, noc };
  }, [vehicles]);

  const handleSelectVehicle = (v: Vehicle) => {
    setSelectedVehicle(v);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('vehicle', v.registrationNumber || '');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleBackToFleetList = () => {
    setSelectedVehicle(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (activeSearch) {
        url.searchParams.set('vehicle', activeSearch);
      } else {
        url.searchParams.delete('vehicle');
      }
      window.history.replaceState({}, '', url.toString());
    }
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
        doc.setFillColor(254, 242, 242);
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
        doc.setFillColor(254, 242, 242);
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
        doc.setFillColor(240, 253, 244);
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

      // Renewals History Section
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`RENEWAL HISTORY (${analysis.renewalCount} RENEWALS COMPLETED)`, margin, y);
      y += 5;

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
          doc.text('Bi-Annual Fleet Renewal', margin + 45, y + 4.8);

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(71, 85, 105);
          const desc = r.description.length > 50 ? `${r.description.substring(0, 47)}...` : r.description;
          doc.text(desc, margin + 105, y + 4.8);

          y += 7;
        });
      }

      y += 6;

      // Trips Section
      const trips = targetVehicle.tripsHistory || [];
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`CARGO TRIPS LOG (${trips.length} TOTAL TRIPS COMPLETED)`, margin, y);
      y += 5;

      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, pageWidth - (margin * 2), 6, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('#', margin + 3, y + 4.2);
      doc.text('CASE NO', margin + 12, y + 4.2);
      doc.text('CONTAINER NO', margin + 45, y + 4.2);
      doc.text('CLIENT & DESTINATION', margin + 90, y + 4.2);
      doc.text('DATE', margin + 150, y + 4.2);
      y += 7;

      if (trips.length === 0) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text('No individual cargo trips recorded yet for this vehicle.', margin + 4, y + 4);
      } else {
        trips.slice(0, 6).forEach((t, idx) => {
          doc.setFillColor(idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 250);
          doc.rect(margin, y, pageWidth - (margin * 2), 7, 'F');

          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(100, 116, 139);
          doc.text(String(idx + 1), margin + 4, y + 4.8);

          doc.setTextColor(15, 23, 42);
          doc.text(t.caseNo || 'N/A', margin + 12, y + 4.8);
          doc.text(t.containerNumber || (t as any).containerNo || 'N/A', margin + 45, y + 4.8);
          doc.text(`${t.clientName || 'General'} (${t.route || (t as any).destination || 'Inland'})`.substring(0, 35), margin + 90, y + 4.8);
          doc.text(t.date || (t as any).tripDate || 'N/A', margin + 150, y + 4.8);

          y += 7;
        });
      }

      // Footer
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(`MAK Group of Companies | vehicle.makpk.online | Plate ${targetVehicle.registrationNumber || ''}`, pageWidth / 2, 287, { align: 'center' });

      const safeFilename = `Vehicle_${(targetVehicle.registrationNumber || 'Plate').replace(/[^a-zA-Z0-9_-]/g, '_')}_Status.pdf`;
      doc.save(safeFilename);
    } catch (err) {
      console.error('Error generating vehicle PDF:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleCopyShareLink = (targetPlate?: string) => {
    if (typeof window === 'undefined') return;
    const plate = encodeURIComponent(targetPlate || activeSearch || (selectedVehicle?.registrationNumber || ''));
    const host = (window.location.hostname || '').toLowerCase();
    const isCustom = host.includes('makpk.online') || host.includes('vehicle.mak-group.com');
    const shareUrl = isCustom
      ? `https://vehicle.makpk.online?vehicle=${plate}`
      : `${window.location.origin}/?mode=vehicle&plate=${plate}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }).catch(() => {});
  };

  const handleSwitchToContainer = () => {
    const host = (window.location.hostname || '').toLowerCase();
    if (host.includes('makpk.online') || host.includes('mak-group.com')) {
      window.location.href = 'https://status.makpk.online';
      return;
    }
    if (onSwitchToContainerTracker) onSwitchToContainerTracker();
    else window.location.href = 'https://status.makpk.online';
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#FAF9F5] text-slate-800 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-950">
      
      {/* 1. Top Corporate Announcement Strip (Matching docks.com.pk) */}
      <div className="w-full bg-[#0F172A] text-slate-200 text-center py-2 px-3 text-[11px] sm:text-xs font-semibold tracking-wide border-b border-slate-800 flex items-center justify-center gap-2">
        <span>MAK - GROUP OF COMPANIES</span>
        <span className="text-amber-400">|</span>
        <span className="text-slate-300 font-normal">Pakistan's Premier Multimodal Logistics Network</span>
      </div>

      {/* 2. Top Header Navigation Bar (Clean Ivory & Gold matching docks.com.pk) */}
      <header className="border-b border-slate-200/90 bg-white/95 backdrop-blur-md sticky top-0 z-40 shadow-xs w-full max-w-full overflow-hidden">
        <div className="max-w-6xl w-full mx-auto px-3 sm:px-6 min-h-16 py-2.5 flex items-center justify-between gap-2 sm:gap-4">
          
          {/* Left: Brand Logo & Title (docks.com.pk corporate logo) */}
          <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
            <a
              href="https://mak-group.com.pk"
              className="px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-xs"
              title="Back to mak-group.com.pk"
            >
              <ArrowLeft size={14} className="text-amber-600 shrink-0" />
              <span>Back</span>
            </a>

            {/* MAK GROUP OF COMPANIES Brand Typography */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex flex-col">
                <span className="text-base sm:text-lg font-black tracking-tight text-slate-900 font-serif leading-none">
                  MAK - GROUP
                </span>
                <span className="text-[9px] sm:text-[10px] font-extrabold tracking-[0.2em] text-amber-600 uppercase leading-tight mt-0.5">
                  GROUP OF COMPANIES
                </span>
              </div>
              <span className="hidden sm:inline-flex text-[10px] font-bold text-amber-700 bg-amber-100/80 border border-amber-300 px-2 py-0.5 rounded-full uppercase tracking-wider ml-1">
                Vehicle Status
              </span>
            </div>
          </div>

          {/* Right: Domain indicator & Switcher to Container Status */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <div className="text-right hidden md:block">
              <span className="text-xs text-amber-700 font-mono font-bold block">
                vehicle.makpk.online
              </span>
              <span className="text-[10px] text-slate-500 block">
                {lastSyncedTime ? `Live synced at ${lastSyncedTime}` : 'Multi-entity real-time sync'}
              </span>
            </div>

            {/* Link to Container Tracking (Status.makpk.online) */}
            <button
              type="button"
              onClick={handleSwitchToContainer}
              className="text-[11px] sm:text-xs text-slate-800 hover:text-amber-800 px-2.5 sm:px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors flex items-center gap-1.5 font-semibold cursor-pointer shadow-xs shrink-0"
              title="Open Container & Shipment Status Tracking (Status.makpk.online)"
            >
              <Package size={13} className="text-amber-600 shrink-0" />
              <span>Container Status</span>
            </button>

            {/* Exit / Close Button (Only if invoked from inside the workspace) */}
            {onExitPortal && (
              <button
                type="button"
                onClick={onExitPortal}
                className="text-[11px] sm:text-xs text-slate-600 hover:text-slate-900 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors cursor-pointer shrink-0"
                title="Close and return to Internal Workspace"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 3. Main Body Container with docks.com.pk luxury branding */}
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

          {/* Circular Emblem matching docks.com.pk */}
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full p-1 bg-gradient-to-br from-amber-200 via-slate-800 to-amber-300 shadow-xl flex items-center justify-center">
              <div className="w-full h-full rounded-full bg-white border-2 border-slate-900 flex flex-col items-center justify-center text-center p-2 relative overflow-hidden">
                <span className="font-serif font-black text-xl sm:text-2xl text-slate-900 tracking-tighter leading-none">
                  MAK
                </span>
                <span className="text-[7px] sm:text-[8px] font-extrabold text-amber-700 tracking-wider uppercase leading-tight mt-0.5">
                  GROUP OF COMPANIES
                </span>
                <div className="w-16 h-[1px] bg-slate-200 my-1" />
                <div className="grid grid-cols-4 gap-1 text-[7px] font-bold text-slate-600 tracking-tight">
                  <span className="text-blue-700">DPL</span>
                  <span className="text-amber-700">Truckit</span>
                  <span className="text-emerald-700">Muhib</span>
                  <span className="text-cyan-700">Vantage</span>
                </div>
              </div>
            </div>
          </div>

          {/* Main Title */}
          <div className="space-y-1.5">
            <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-serif">
              UNIFIED FLEET &amp; VEHICLE STATUS
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto">
              Enter vehicle registration plate to check customs bond status, validity, and bi-annual renewals.
            </p>
          </div>

          {/* Search Form (Clean Pearl White Card) */}
          <form onSubmit={handleSearchSubmit} className="pt-2">
            <div className="relative flex flex-col sm:flex-row items-stretch gap-2 bg-white p-2 rounded-2xl border-2 border-slate-200 shadow-lg focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-300/40 transition-all">
              <div className="relative flex-1 flex items-center">
                <Search size={18} className="absolute left-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Enter Vehicle Plate (e.g. TLB-892, P-9912)..."
                  className="w-full bg-transparent pl-11 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none font-mono tracking-wide font-bold"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setActiveSearch(''); setSelectedVehicle(null); }}
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

          {/* Minimal Examples */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-slate-500">
            <span className="font-semibold text-slate-600">Sample Plates:</span>
            {['TLB-892', 'P-9912', 'KHI-7721', 'JU-4412'].map((ex, idx) => (
              <React.Fragment key={ex}>
                {idx > 0 && <span>·</span>}
                <button
                  type="button"
                  onClick={() => handleQuickExample(ex)}
                  className="text-amber-700 hover:text-amber-900 font-mono font-bold hover:underline transition cursor-pointer"
                >
                  {ex}
                </button>
              </React.Fragment>
            ))}
          </div>
        </section>

        {/* 4. Results Section: Vehicle Details on Top, Dedicated Status Field Below */}
        <section className="space-y-6 animate-in fade-in duration-300">
          
          {/* If a vehicle is selected (or exact single match): Show Complete Dossier Card */}
          {selectedVehicle ? (
            <div className="space-y-6">
              {/* Back to Results / Switch Vehicle */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleBackToFleetList}
                  className="text-xs text-slate-700 hover:text-slate-950 px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 flex items-center gap-2 transition-colors cursor-pointer w-fit shadow-xs font-semibold"
                >
                  <ArrowLeft size={14} />
                  <span>{activeSearch ? `Back to Search Results (${matchingVehicles.length})` : `Back to Fleet Directory (${vehicles.length})`}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyShareLink(selectedVehicle.registrationNumber)}
                    className="text-xs text-slate-700 hover:text-slate-950 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs font-semibold"
                    title="Copy direct verification link for this vehicle"
                  >
                    {copiedLink ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    <span>{copiedLink ? 'Link Copied' : 'Share Verification Link'}</span>
                  </button>
                </div>
              </div>

              {/* Vehicle Dossier Card (Vehicle Details on Top, Status Field Below) */}
              <VehicleDossierCard 
                vehicle={selectedVehicle} 
                onDownloadPdf={() => handleDownloadVehicleCertificate(selectedVehicle)}
              />
            </div>
          ) : (
            <>
              {/* If search query entered and NO match found: "no record found likha jaega" */}
              {activeSearch && matchingVehicles.length === 0 && (
                <div className="p-8 sm:p-12 rounded-3xl bg-white border-2 border-rose-200 text-center space-y-4 max-w-lg mx-auto shadow-xl">
                  <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-300 flex items-center justify-center text-rose-600 mx-auto">
                    <AlertCircle size={32} />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">
                      No Record Found
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                      No vehicle record found matching <code className="text-slate-900 font-mono font-bold px-2 py-0.5 rounded bg-slate-100 border border-slate-300">{activeSearch}</code> in the MAK Group fleet registry.
                    </p>
                  </div>
                  <div className="text-left text-xs text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5">
                    <p className="font-bold text-slate-800">Search Help:</p>
                    <p>• Make sure the plate number includes letters and digits (e.g. <code>TLB-892</code> or <code>P-9912</code>).</p>
                    <p>• You can also search by partial registration number or transporter name.</p>
                  </div>
                </div>
              )}

              {/* If multiple vehicles match or browsing all fleet */}
              {browsableVehicles.length > 0 && (
                <div className="space-y-4">
                  {/* Status Filter Badges */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-amber-600" />
                      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                        {activeSearch ? `Matching Fleet Units (${browsableVehicles.length})` : `Registered Fleet Directory (${vehicles.length})`}
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setStatusFilter('ALL')}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition ${
                          statusFilter === 'ALL'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        All ({fleetCounts.all})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('ACTIVE_VALID')}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition ${
                          statusFilter === 'ACTIVE_VALID'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        Online ({fleetCounts.active})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('EXPIRED')}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition ${
                          statusFilter === 'EXPIRED'
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                        }`}
                      >
                        Expired ({fleetCounts.expired})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('CANCELLED_NOC')}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition ${
                          statusFilter === 'CANCELLED_NOC'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100'
                        }`}
                      >
                        NOC Issued ({fleetCounts.noc})
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 font-medium">
                    Click any vehicle below to view complete details, official status (online, expire, renewal), and download PDF slip:
                  </p>

                  {/* Grid of Vehicles */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {browsableVehicles.map((v) => {
                      const analysis = getVehicleStatusAnalysis(v);
                      const opComp = getOperatingCompany(v);
                      const isExpired = analysis.statusType === 'EXPIRED';
                      const isNoc = analysis.statusType === 'CANCELLED_NOC';
                      const isRenewal = !isExpired && !isNoc && analysis.expiryDateStr && (
                        (new Date(analysis.expiryDateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 30
                      );

                      const displayLabel = isNoc ? 'NOC' : isExpired ? 'EXPIRE' : isRenewal ? 'RENEWAL' : 'ONLINE';

                      return (
                        <div
                          key={v.id || v.registrationNumber}
                          onClick={() => handleSelectVehicle(v)}
                          className="p-5 rounded-2xl bg-white hover:bg-amber-50/40 border border-slate-200 hover:border-amber-400 transition-all cursor-pointer group shadow-md hover:shadow-xl hover:scale-[1.01] flex flex-col justify-between gap-4"
                        >
                          <div className="space-y-3">
                            {/* Plate Strip */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${opComp.color}`}>
                                  {opComp.short}
                                </span>
                                <span className="font-mono text-xl font-black text-slate-900 tracking-wider group-hover:text-amber-800 transition-colors">
                                  {v.registrationNumber}
                                </span>
                              </div>

                              {/* Status Badge: ONLINE / EXPIRE / RENEWAL */}
                              <span className={`text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full border ${
                                displayLabel === 'ONLINE'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : displayLabel === 'EXPIRE'
                                  ? 'bg-rose-100 text-rose-800 border-rose-300'
                                  : displayLabel === 'RENEWAL'
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-purple-100 text-purple-800 border-purple-300'
                              }`}>
                                {displayLabel}
                              </span>
                            </div>

                            {/* Quick Specs */}
                            <div className="text-xs text-slate-700 space-y-1">
                              <p className="truncate">
                                <span className="text-slate-500">Category: </span>
                                <strong className="text-slate-900">{v.category || 'Bonded Carrier'}</strong>
                              </p>
                              <p className="truncate">
                                <span className="text-slate-500">Transporter: </span>
                                <strong className="text-slate-900">{v.transporterName || 'Fleet Operator'}</strong>
                              </p>
                              <p className="truncate">
                                <span className="text-slate-500">Registered: </span>
                                <span>{v.registrationDate || 'N/A'}</span>
                              </p>
                            </div>
                          </div>

                          {/* Quick Stats Footer */}
                          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                            <span className="text-amber-800 font-bold">
                              {analysis.renewalCount} Renewals
                            </span>
                            <span className="text-emerald-800 font-bold">
                              {analysis.tripsCount} Completed Trips
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

        </section>

      </main>

      {/* 5. Corporate Footer matching docks.com.pk */}
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-xs text-slate-600 space-y-3 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-left">
            <p className="font-bold text-slate-900">MAK Group of Companies — Central Fleet &amp; Vehicle Verification Service</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Tower Office: State Life Building No. 7, G-Allana Road, Tower, Karachi, Pakistan.
            </p>
          </div>
          <div className="text-right text-[11px] text-slate-500">
            <p>Support: +92-21-32330103 • fleet@makgroup.com.pk</p>
            <p className="text-amber-700 mt-0.5 font-bold">Read-Only Verification • Zero Financial Data Disclosed</p>
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
    if (cid === 'truckit') return { name: 'Truckit (Pvt.) Ltd.', badge: 'TRUCKIT', border: 'border-amber-300 text-amber-800 bg-amber-50' };
    if (cid === 'muhib') return { name: 'Muhib International', badge: 'MUHIB', border: 'border-emerald-300 text-emerald-800 bg-emerald-50' };
    if (cid === 'vantage') return { name: 'Vantage Shipping Line', badge: 'VANTAGE', border: 'border-cyan-300 text-cyan-800 bg-cyan-50' };
    return { name: 'Docks (Pvt.) Ltd.', badge: 'DOCKS', border: 'border-blue-300 text-blue-800 bg-blue-50' };
  })();

  const isCancelled = vehicle.status === 'CANCELLED' || vehicle.cancellationApproved || !!vehicle.nocReference;
  const expiryDateStr = vehicle.validationExpiryDate || (vehicle as any).taxExpiryDate || (vehicle as any).fitnessExpiryDate || '';
  
  let daysRemaining = 999;
  let isExpired = false;
  let isRenewal = false;

  if (expiryDateStr) {
    const expTime = new Date(expiryDateStr).getTime();
    if (!isNaN(expTime)) {
      daysRemaining = Math.ceil((expTime - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysRemaining <= 0) {
        isExpired = true;
      } else if (daysRemaining <= 30) {
        isRenewal = true;
      }
    }
  }

  if (vehicle.status === 'EXPIRED') isExpired = true;
  if ((vehicle.status as string) === 'PENDING_RENEWAL' || (vehicle as any).status === 'RENEWAL') isRenewal = true;

  // Primary Status strictly per user specification: "renewal ya expire ya online"
  const displayStatus: 'ONLINE' | 'EXPIRE' | 'RENEWAL' | 'NOC' = (() => {
    if (isCancelled) return 'NOC';
    if (isExpired) return 'EXPIRE';
    if (isRenewal) return 'RENEWAL';
    return 'ONLINE';
  })();

  const renewals = (vehicle.history || []).filter(h => 
    h.description?.toLowerCase().includes('renewal') || 
    h.description?.toLowerCase().includes('renew')
  );
  const trips = vehicle.tripsHistory || [];

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-xl overflow-hidden space-y-0">
      
      {/* 1. TOP SECTION: VEHICLE DETAILS HEADER */}
      <div className="p-5 sm:p-7 border-b border-slate-800 bg-[#0F172A] text-white flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
        <div className="space-y-3 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${opComp.border} shrink-0`}>
              {opComp.badge}
            </span>
            <span className="font-mono text-2xl sm:text-4xl font-black text-white tracking-wider truncate">
              {vehicle.registrationNumber}
            </span>
            <span className="text-xs font-semibold text-slate-300 bg-white/10 border border-white/20 px-2.5 py-0.5 rounded shrink-0">
              {vehicle.type || 'Prime Mover / Trailer'}
            </span>
          </div>

          {/* Quick Specifications Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-900/90 p-3.5 rounded-2xl border border-white/10">
            <div>
              <span className="text-slate-400 block text-[11px]">Transporter / Fleet:</span>
              <strong className="text-white text-xs truncate block">{vehicle.transporterName || 'Fleet Operator'}</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Make &amp; Model:</span>
              <strong className="text-white text-xs truncate block">{vehicle.make || 'Commercial'} ({vehicle.model || 'N/A'})</strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Chassis No:</span>
              <span className="font-mono text-slate-300 text-[11px] truncate block">{vehicle.chassisNo || 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Engine No:</span>
              <span className="font-mono text-slate-300 text-[11px] truncate block">{vehicle.engineNo || 'N/A'}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] sm:text-xs text-slate-400">
            <span>DPL Serial: <strong className="text-white font-mono">{vehicle.dplSerial || 'Registered'}</strong></span>
            <span>·</span>
            <span>Registered On: <strong className="text-slate-200">{vehicle.registrationDate || 'N/A'}</strong></span>
            <span>·</span>
            <span>Operating Entity: <strong className="text-slate-200">{opComp.name}</strong></span>
            {vehicle.driverName && (
              <>
                <span>·</span>
                <span>Driver: <strong className="text-amber-300">{vehicle.driverName}</strong> {vehicle.driverContact && <a href={`tel:${vehicle.driverContact}`} className="text-cyan-400 hover:underline">({vehicle.driverContact})</a>}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 pt-1 md:pt-0">
          <button
            type="button"
            onClick={onDownloadPdf}
            className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 transition-all cursor-pointer active:scale-95"
            title="Download official PDF vehicle status certificate"
          >
            <Download size={14} />
            <span>Download Certificate (PDF)</span>
          </button>
        </div>
      </div>

      {/* 2. DEDICATED PROMINENT STATUS FIELD (ONLINE / EXPIRE / RENEWAL) */}
      <div className="p-5 sm:p-7 bg-[#FCFAF5] border-b border-slate-200">
        <div className={`p-5 sm:p-6 rounded-2xl border-2 transition-all shadow-md ${
          displayStatus === 'ONLINE'
            ? 'bg-emerald-50 border-emerald-500 text-emerald-950 shadow-emerald-100'
            : displayStatus === 'EXPIRE'
            ? 'bg-rose-50 border-rose-500 text-rose-950 shadow-rose-100'
            : displayStatus === 'RENEWAL'
            ? 'bg-amber-50 border-amber-500 text-amber-950 shadow-amber-100'
            : 'bg-purple-50 border-purple-500 text-purple-950 shadow-purple-100'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block font-mono">
                VEHICLE STATUS
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`text-3xl sm:text-4xl font-black font-mono tracking-tight ${
                  displayStatus === 'ONLINE'
                    ? 'text-emerald-700'
                    : displayStatus === 'EXPIRE'
                    ? 'text-rose-700'
                    : displayStatus === 'RENEWAL'
                    ? 'text-amber-700'
                    : 'text-purple-700'
                }`}>
                  {displayStatus}
                </span>

                <span className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                  displayStatus === 'ONLINE'
                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                    : displayStatus === 'EXPIRE'
                    ? 'bg-rose-100 text-rose-900 border-rose-300'
                    : displayStatus === 'RENEWAL'
                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                    : 'bg-purple-100 text-purple-900 border-purple-300'
                }`}>
                  {displayStatus === 'ONLINE' && <CheckCircle2 size={14} className="text-emerald-600" />}
                  {displayStatus === 'EXPIRE' && <Clock size={14} className="text-rose-600" />}
                  {displayStatus === 'RENEWAL' && <RefreshCw size={14} className="text-amber-600" />}
                  {displayStatus === 'NOC' && <AlertTriangle size={14} className="text-purple-600" />}
                  <span>
                    {displayStatus === 'ONLINE' && 'Active Bonded Unit • Valid & Authorized for Operation'}
                    {displayStatus === 'EXPIRE' && `Validation Expired on ${vehicle.validationExpiryDate || 'Scheduled Date'} • Operation Restricted`}
                    {displayStatus === 'RENEWAL' && `Renewal Required • Due on ${vehicle.validationExpiryDate || 'Scheduled Date'} (${daysRemaining} Days Remaining)`}
                    {displayStatus === 'NOC' && 'De-registered from Fleet • NOC Clearance Issued'}
                  </span>
                </span>
              </div>
              <p className="text-xs text-slate-700 pt-1 leading-relaxed font-medium">
                {displayStatus === 'ONLINE' && `Fleet unit ${vehicle.registrationNumber} is actively registered under ${opComp.name} with all customs bond permissions verified.`}
                {displayStatus === 'EXPIRE' && `Vehicle validation expired on ${vehicle.validationExpiryDate}. Mandatory bi-annual customs renewal documentation required prior to next container assignment.`}
                {displayStatus === 'RENEWAL' && `Vehicle documentation is approaching validity expiry in ${daysRemaining} days. Bi-annual renewal submission is pending.`}
                {displayStatus === 'NOC' && `Official No Objection Certificate (Ref: ${vehicle.nocReference || 'NOC-MAK'}) has been issued.`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dossier Content */}
      <div className="p-6 space-y-6 bg-white">
        
        {/* CRITICAL STATUS NOTICE CARDS */}
        {isCancelled && (
          <div className="p-4 sm:p-5 rounded-2xl bg-purple-50 border border-purple-200 text-xs space-y-2">
            <div className="flex items-center gap-2 text-purple-900 font-bold text-sm">
              <AlertTriangle size={18} className="text-purple-600 shrink-0" />
              <span>De-registration / No Objection Certificate (NOC) Issued</span>
            </div>
            <p className="text-slate-700 leading-relaxed">
              This vehicle is officially deregistered from the MAK Group bonded fleet and an official NOC certificate has been issued.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-slate-700 bg-white p-3 rounded-xl border border-purple-200">
              <div>
                <span className="text-slate-500 block text-[11px]">NOC Reference:</span>
                <strong className="text-purple-900 font-mono text-xs">{vehicle.nocReference || 'NOC-MAK-2025-0419'}</strong>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">NOC Issue Date:</span>
                <strong className="text-slate-900 text-xs">{vehicle.nocDate || vehicle.cancellationDate || 'N/A'}</strong>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Reason:</span>
                <span className="text-slate-700 text-xs">{vehicle.cancellationReason || 'Transferred / Sold to General Haulage'}</span>
              </div>
            </div>
          </div>
        )}

        {isExpired && !isCancelled && (
          <div className="p-4 sm:p-5 rounded-2xl bg-rose-50 border border-rose-200 text-xs space-y-2">
            <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
              <Clock size={18} className="text-rose-600 shrink-0" />
              <span>Fleet Validation Overdue / Expired</span>
            </div>
            <p className="text-slate-700 leading-relaxed">
              Bonded fleet registration expired on <strong className="text-rose-900">{vehicle.validationExpiryDate}</strong>. Renewal required prior to dispatch authorization.
            </p>
          </div>
        )}

        {/* 4 HIGHLIGHT METRICS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Calendar size={13} className="text-amber-600" />
              <span>Registration Date</span>
            </span>
            <p className="text-sm font-bold text-slate-900">
              {vehicle.registrationDate || 'N/A'}
            </p>
            <p className="text-[11px] text-slate-500 font-mono">
              MAK Serial: {vehicle.dplSerial || 'Registered'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <RefreshCw size={13} className="text-amber-600" />
              <span>Renewals Completed</span>
            </span>
            <p className="text-sm font-bold text-slate-900 font-mono">
              {renewals.length} Cycles
            </p>
            <p className="text-[11px] text-slate-500">
              Bi-Annual Verification
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Truck size={13} className="text-emerald-600" />
              <span>Completed Cargo Trips</span>
            </span>
            <p className="text-sm font-bold text-slate-900 font-mono">
              {trips.length} Trips
            </p>
            <p className="text-[11px] text-slate-500">
              Logged Port &amp; Inland Hauls
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Clock size={13} className="text-cyan-600" />
              <span>Permit Expiry Date</span>
            </span>
            <p className={`text-sm font-bold ${isExpired ? 'text-rose-600' : 'text-slate-900'}`}>
              {vehicle.validationExpiryDate || 'Active'}
            </p>
            <p className="text-[11px] text-slate-500">
              {daysRemaining <= 0 ? 'Validation Expired' : `${daysRemaining} Days Remaining`}
            </p>
          </div>
        </div>

        {/* Renewals History Table */}
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <RefreshCw size={14} className="text-amber-600" />
            <span>Bi-Annual Renewal Cycles History ({renewals.length} Records)</span>
          </h4>

          {renewals.length === 0 ? (
            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
              Initial registration period active. No renewal cycles logged yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-100 text-slate-800 uppercase font-bold text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Cycle</th>
                    <th className="p-3">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {renewals.map((r, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-slate-500">{idx + 1}</td>
                      <td className="p-3 font-mono text-slate-900 font-semibold">{r.date || 'N/A'}</td>
                      <td className="p-3 text-amber-800 font-semibold">Bi-Annual Fleet Renewal</td>
                      <td className="p-3 text-slate-600">{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Trips Completed History */}
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <Truck size={14} className="text-emerald-600" />
            <span>Completed Cargo Trips Log ({trips.length} Total Trips)</span>
          </h4>

          {trips.length === 0 ? (
            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
              No individual cargo trip dossiers logged yet for this fleet unit.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-100 text-slate-800 uppercase font-bold text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">Case No</th>
                    <th className="p-3">Container No</th>
                    <th className="p-3">Client</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {trips.map((t, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-slate-500">{idx + 1}</td>
                      <td className="p-3 font-mono text-slate-900 font-semibold">{t.caseNo || 'N/A'}</td>
                      <td className="p-3 font-mono text-amber-800 font-bold">{t.containerNumber || (t as any).containerNo || 'N/A'}</td>
                      <td className="p-3 font-semibold text-slate-800">{t.clientName || 'General Cargo'}</td>
                      <td className="p-3 text-slate-600">{t.route || (t as any).destination || 'Port to Inland'}</td>
                      <td className="p-3 text-slate-500">{t.date || (t as any).tripDate || 'N/A'}</td>
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

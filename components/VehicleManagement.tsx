import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Truck, Plus, Search, FileText, User, Settings, Save, MapPin, Calendar, Clock, AlertTriangle, Trash2, CheckCircle, X, ChevronRight, ChevronDown, Eye, Activity, CreditCard, Filter, AlertCircle, Download, Loader2, Ban, FileCheck, ShieldCheck, UploadCloud, CheckSquare, Square, Layers, Camera, Building, Globe, ExternalLink, Copy } from 'lucide-react';
import { Vehicle, Transporter, VehicleCategory, VehicleType, TrackerInfo, VehicleHistory, UserRole, Case, Driver, TransporterRequest } from '../types';
import { submitVehicleActionApproval } from '../services/approvalService';
import { autoFillVehicleData } from '../services/geminiService';
import { safeAppStorage } from '../services/storage';
import { downloadVehicleDetailsPdf, downloadVehicleNocPdf, downloadDriverIdCardPdf } from '../services/pdfExportService';
import { PdfViewerModal } from './PdfViewerModal';
import { UniversalDocumentPreviewModal, DataMappingCheckItem } from './UniversalDocumentPreviewModal';
import { 
  subscribeToVehicles, 
  saveVehicleToFirestore, 
  saveVehiclesBulkToFirestore,
  updateVehicleInFirestore, 
  deleteVehicleFromFirestore,
  subscribeToTransporterRequests,
  updateTransporterRequestInFirestore,
  dedupeArrayById,
  subscribeToCases,
  subscribeToDrivers,
  extractCaseVehicleTripEntries,
  syncAllCasesHistoryToVehicles
} from '../services/dbService';
import { restoreCasesFromIndexedDB, getDocumentFromIndexedDB } from '../services/documentStorage';
import { 
  BulkVehicleImportModal, 
  VehicleOnlineModal, 
  VehicleRenewalModal 
} from './VehicleManagementModals';
import { AvailableVehiclesView } from './AvailableVehiclesView';
import { VirtualizedList, VirtualizedTable } from './VirtualizedList';
import { sendAppNotification } from '../services/notificationService';
import { exportVehiclesToExcel, exportVehicleTripsToExcel, generateVehiclesExcelBuffer } from '../services/excelExportService';
import { 
  parseVehicleFile, 
  isCorruptedVehicleRecord, 
  evaluateVehicleRegistrationValidity, 
  dedupeAndMergeVehicles, 
  resolveVehicleCompany, 
  getDeterministicVehicleId, 
  normalizeVehiclePlate 
} from '../services/documentParserService';
import { OfficialDocumentsModal, DocumentType } from './OfficialDocumentsModal';
import { 
  generateRegistrationRenewalLetterDocx,
  generateLeaseAgreementDocx,
  generateLeaseTerminationAgreementDocx, 
  generateCancellationLetterLetterheadDocx,
  generateVehicleNocDocx,
  generateDocxBlob,
  downloadDocxBlob,
  formatDashDate
} from '../services/vehicleDocxService';
import { downloadCustomsVehicleListPdf } from '../services/pdfExportService';
import { compressAndPrepareFile } from '../services/fileUtils';
import { useActiveCompany, getActiveCompanyPrefix } from '../services/companyService';
import { CameraDocumentScannerModal } from './CameraDocumentScannerModal';

// --- Clean Live Data ---

const INITIAL_TRANSPORTERS: Transporter[] = [];

const INITIAL_VEHICLES: Vehicle[] = [];

interface ResolvedVehicleTrip {
  id: string;
  caseNo: string;
  date: string;
  pol: string;
  pod: string;
  route: string;
  importerName: string;
  itemDescription: string;
  clientName: string;
  containerNumber: string;
  driverName: string;
  driverPhone: string;
  driverCnic: string;
  driverCnicFrontUrl?: string;
  driverCnicBackUrl?: string;
  frontDocIdbKey?: string;
  backDocIdbKey?: string;
  status: string;
}

function resolveVehicleCompleteTrips(
  registrationNumber: string,
  persistedTrips: Vehicle['tripsHistory'],
  fallbackDriver: { name?: string; cnic?: string; phone?: string },
  allCases: Case[],
  allDrivers: Driver[]
): ResolvedVehicleTrip[] {
  const cleanReg = normalizeVehiclePlate(registrationNumber || '');
  if (!cleanReg) return [];

  const tripsMap = new Map<string, ResolvedVehicleTrip>();

  const findMatchingDriverRecord = (name?: string, cnic?: string) => {
    const cleanDigits = String(cnic || '').replace(/[^0-9]/g, '');
    return (allDrivers || []).find((d) => {
      const dDigits = String(d.cnic || '').replace(/[^0-9]/g, '');
      if (cleanDigits && cleanDigits.length >= 11 && dDigits === cleanDigits) return true;
      if (name && d.name && d.name.trim().toLowerCase() === name.trim().toLowerCase()) return true;
      if (d.assignedVehicleNo && normalizeVehiclePlate(d.assignedVehicleNo) === cleanReg) return true;
      return false;
    });
  };

  // 1. Extract trips from all registered cases (authoritative case details + driver scans)
  const combinedCases: Case[] = Array.isArray(allCases) && allCases.length > 0
    ? allCases
    : [
        ...(safeAppStorage.getJSON<Case[]>('dpl_live_cases', []) || []),
        ...(safeAppStorage.getJSON<Case[]>('dpl_cases_data', []) || [])
      ];

  for (const c of combinedCases) {
    if (!c || String(c.status || '').toUpperCase() === 'CANCELLED') continue;
    const extracted = extractCaseVehicleTripEntries(c, allDrivers);
    for (const item of extracted) {
      if (item.normPlate !== cleanReg) continue;

      let frontUrl = item.driverCnicFrontUrl;
      let backUrl = item.driverCnicBackUrl;
      let frontDocIdbKey: string | undefined;
      let backDocIdbKey: string | undefined;

      // Also inspect case.documents[] for uploaded Driver CNIC / ID Card attachments
      if (Array.isArray(c.documents)) {
        for (const docItem of c.documents) {
          const label = `${docItem?.name || ''} ${docItem?.type || ''}`.toLowerCase();
          const isDriverDoc =
            label.includes('driver') &&
            (label.includes('cnic') || label.includes('id') || label.includes('nic') || label.includes('card') || label.includes('license'));
          if (isDriverDoc) {
            const docKey = c.caseNo && docItem?.name ? `${c.caseNo}_${docItem.name}` : docItem?.name;
            const docUrl = docItem && 'url' in docItem && typeof docItem.url === 'string' ? docItem.url : undefined;
            if (label.includes('back')) {
              if (!backUrl && docUrl) backUrl = docUrl;
              if (!backDocIdbKey && docKey) backDocIdbKey = docKey;
            } else {
              if (!frontUrl && docUrl) frontUrl = docUrl;
              if (!frontDocIdbKey && docKey) frontDocIdbKey = docKey;
            }
          }
        }
      }

      const driverRec = findMatchingDriverRecord(item.driverName, item.driverCnic);
      const resolvedName = (item.driverName || driverRec?.name || fallbackDriver.name || 'Not Recorded').trim();
      const resolvedCnic = (item.driverCnic || driverRec?.cnic || fallbackDriver.cnic || 'Not Recorded').trim();
      const resolvedPhone = (item.driverPhone || driverRec?.contact || fallbackDriver.phone || 'Not Recorded').trim();

      const key = item.caseNo && item.caseNo !== 'N/A' ? `CASE_${item.caseNo}` : item.id;
      tripsMap.set(key, {
        id: item.id,
        caseNo: item.caseNo || 'N/A',
        date: item.date || '-',
        pol: item.pol || 'Karachi Port',
        pod: item.pod || 'Destination Port',
        route: item.route || `${item.pol || 'Karachi Port'} → ${item.pod || 'Destination Port'}`,
        importerName: item.importerName || 'N/A',
        itemDescription: item.itemDescription || 'General Cargo',
        clientName: item.clientName || 'N/A',
        containerNumber: item.containerNumber || '-',
        driverName: resolvedName,
        driverPhone: resolvedPhone,
        driverCnic: resolvedCnic,
        driverCnicFrontUrl: frontUrl || driverRec?.cnicFrontUrl || driverRec?.cnicDocUrl,
        driverCnicBackUrl: backUrl || driverRec?.cnicBackUrl,
        frontDocIdbKey,
        backDocIdbKey,
        status: item.status || 'Dispatched'
      });
    }
  }

  // 2. Merge persisted vehicle.tripsHistory entries (for historical records or archived cases)
  if (Array.isArray(persistedTrips)) {
    persistedTrips.forEach((t, idx) => {
      if (!t) return;
      const parsedCaseMatch = t.status ? t.status.match(/\(([^)]+)\)/) : null;
      const resolvedCaseNo = (t.caseNo || (parsedCaseMatch ? parsedCaseMatch[1] : '') || '').trim();
      const mapKey = resolvedCaseNo && resolvedCaseNo !== 'N/A'
        ? `CASE_${resolvedCaseNo}`
        : `PERSIST_${t.date || ''}_${t.containerNumber || idx}`;

      const routeParts = String(t.route || '').split(/\s*(?:→|->)\s*/);
      const polFromRoute = routeParts[0]?.trim() || '';
      const podFromRoute = routeParts[1]?.trim() || '';

      const driverRec = findMatchingDriverRecord(t.driverName, t.driverCnic);
      const existing = tripsMap.get(mapKey);

      if (existing) {
        tripsMap.set(mapKey, {
          ...existing,
          pol: existing.pol || t.pol || polFromRoute || 'Karachi Port',
          pod: existing.pod || t.pod || podFromRoute || 'Destination Port',
          importerName: existing.importerName !== 'N/A' ? existing.importerName : (t.importerName || 'N/A'),
          itemDescription: existing.itemDescription || t.itemDescription || 'General Cargo',
          clientName: existing.clientName !== 'N/A' ? existing.clientName : (t.clientName || 'N/A'),
          containerNumber: existing.containerNumber !== '-' ? existing.containerNumber : (t.containerNumber || '-'),
          driverName: existing.driverName !== 'Not Recorded' ? existing.driverName : (t.driverName || driverRec?.name || fallbackDriver.name || 'Not Recorded'),
          driverPhone: existing.driverPhone !== 'Not Recorded' ? existing.driverPhone : (t.driverPhone || driverRec?.contact || fallbackDriver.phone || 'Not Recorded'),
          driverCnic: existing.driverCnic !== 'Not Recorded' ? existing.driverCnic : (t.driverCnic || driverRec?.cnic || fallbackDriver.cnic || 'Not Recorded'),
          driverCnicFrontUrl: existing.driverCnicFrontUrl || t.driverCnicFrontUrl || driverRec?.cnicFrontUrl || driverRec?.cnicDocUrl,
          driverCnicBackUrl: existing.driverCnicBackUrl || t.driverCnicBackUrl || driverRec?.cnicBackUrl
        });
      } else {
        const pol = (t.pol || polFromRoute || 'Karachi Port').trim();
        const pod = (t.pod || podFromRoute || 'Destination Port').trim();
        tripsMap.set(mapKey, {
          id: t.id || `PERSIST-${idx}`,
          caseNo: resolvedCaseNo || '-',
          date: t.date || '-',
          pol,
          pod,
          route: t.route || `${pol} → ${pod}`,
          importerName: t.importerName || 'N/A',
          itemDescription: t.itemDescription || 'General Cargo',
          clientName: t.clientName || 'N/A',
          containerNumber: t.containerNumber || '-',
          driverName: (t.driverName || driverRec?.name || fallbackDriver.name || 'Not Recorded').trim(),
          driverPhone: (t.driverPhone || driverRec?.contact || fallbackDriver.phone || 'Not Recorded').trim(),
          driverCnic: (t.driverCnic || driverRec?.cnic || fallbackDriver.cnic || 'Not Recorded').trim(),
          driverCnicFrontUrl: t.driverCnicFrontUrl || driverRec?.cnicFrontUrl || driverRec?.cnicDocUrl,
          driverCnicBackUrl: t.driverCnicBackUrl || driverRec?.cnicBackUrl,
          status: t.status || 'Completed'
        });
      }
    });
  }

  return Array.from(tripsMap.values()).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

interface VehicleManagementProps {
  initialFilter?: any;
  clearFilter?: () => void;
  userRole?: UserRole;
  userRoles?: UserRole[];
  onOpenPublicTracker?: (plate?: string) => void;
}

const VehicleManagement: React.FC<VehicleManagementProps> = ({ 
  initialFilter, 
  clearFilter,
  userRole: propUserRole,
  userRoles: propUserRoles,
  onOpenPublicTracker
}) => {
  const { activeCompany } = useActiveCompany();
  const [activeTab, setActiveTab] = useState<'transporters' | 'vehicles' | 'ready_vehicles'>(() => {
    const saved = safeAppStorage.getItem('dpl_vehicle_tab');
    return (saved === 'transporters' || saved === 'ready_vehicles') ? saved : 'vehicles';
  });

  const [transporterRequests, setTransporterRequests] = useState<TransporterRequest[]>([]);
  useEffect(() => {
    const unsub = subscribeToTransporterRequests((reqs) => setTransporterRequests(reqs || []));
    return () => unsub();
  }, []);

  const handleApproveTransporterRequest = async (req: TransporterRequest) => {
    if (req.type === 'NEW_REGISTRATION' && req.vehicleData) {
      const newVeh: Vehicle = {
        id: Date.now(),
        dplSerial: `${getActiveCompanyPrefix()}-V-${String(vehicles.length + 1).padStart(4, '0')}`,
        registrationNumber: req.vehicleNo || 'TL-NEW',
        transporterId: Number(req.transporterId) || 1,
        transporterName: req.transporterName,
        driverName: req.vehicleData.driverName || 'Designated Driver',
        driverContact: req.vehicleData.driverContact || 'N/A',
        driverCnic: req.vehicleData.driverCnic || '',
        make: req.vehicleData.make || 'Prime Mover',
        model: req.vehicleData.model || '2022',
        type: req.vehicleData.type || 'Flatbed Trailer' as any,
        size: '40ft',
        engineNo: (req.vehicleData as any).engineNo || 'ENG-DEFAULT',
        chassisNo: (req.vehicleData as any).chassisNo || 'CHS-DEFAULT',
        category: VehicleCategory.BONDED_CARRIER,
        status: 'AVAILABLE',
        history: [],
        createdAt: new Date().toISOString()
      };
      await saveVehicleToFirestore(newVeh);
      setVehicles(prev => dedupeArrayById([newVeh, ...prev]));
    } else if (req.type === 'RENEWAL') {
      const existing = vehicles.find(v => v.registrationNumber?.toLowerCase() === req.vehicleNo?.toLowerCase());
      if (existing) {
        const nextYear = new Date();
        nextYear.setMonth(nextYear.getMonth() + 6);
        const updated = {
          ...existing,
          validationExpiryDate: nextYear.toISOString().slice(0, 10),
          status: 'AVAILABLE' as const
        };
        await updateVehicleInFirestore(updated);
      }
    } else if (req.type === 'CANCELLATION') {
      const existing = vehicles.find(v => v.registrationNumber?.toLowerCase() === req.vehicleNo?.toLowerCase());
      if (existing) {
        const updated = {
          ...existing,
          status: 'CANCELLED' as const,
          cancellationApproved: true
        };
        await updateVehicleInFirestore(updated);
      }
    }

    const updatedReq: TransporterRequest = {
      ...req,
      status: 'APPROVED',
      reviewedBy: 'Vehicle Manager',
      reviewedAt: new Date().toISOString()
    };
    await updateTransporterRequestInFirestore(updatedReq);

    // Dispatch real-time notification to Transporter & Admin
    await sendAppNotification({
      title: `Vehicle Request APPROVED: ${req.vehicleNo}`,
      description: `Your ${req.type.replace('_', ' ').toLowerCase()} request for vehicle ${req.vehicleNo} has been verified and approved by Vehicle Management.`,
      targetRole: UserRole.TRANSPORTER,
      targetClientName: req.transporterName,
      targetView: 'vehicles',
      targetFilter: { vehicleNo: req.vehicleNo },
      type: 'INFO',
      notificationSubType: 'GENERAL',
      actionLabel: 'View Vehicle',
      performedBy: 'Vehicle Manager',
      performedByRole: 'VEHICLE_MANAGER',
      category: 'TRANSPORTER'
    });

    setStatusBanner({ type: 'success', message: `Transporter request for ${req.vehicleNo} has been approved.` });
  };

  const handleRejectTransporterRequest = async (req: TransporterRequest) => {
    const updatedReq: TransporterRequest = {
      ...req,
      status: 'REJECTED',
      reviewedBy: 'Vehicle Manager',
      reviewedAt: new Date().toISOString()
    };
    await updateTransporterRequestInFirestore(updatedReq);

    // Dispatch real-time notification to Transporter & Admin
    await sendAppNotification({
      title: `Vehicle Request Declined: ${req.vehicleNo}`,
      description: `Your ${req.type.replace('_', ' ').toLowerCase()} request for vehicle ${req.vehicleNo} was declined by Vehicle Management. Please contact transport desk for details.`,
      targetRole: UserRole.TRANSPORTER,
      targetClientName: req.transporterName,
      targetView: 'vehicles',
      targetFilter: { vehicleNo: req.vehicleNo },
      type: 'ALERT',
      notificationSubType: 'GENERAL',
      actionLabel: 'Check Status',
      performedBy: 'Vehicle Manager',
      performedByRole: 'VEHICLE_MANAGER',
      category: 'TRANSPORTER'
    });

    setStatusBanner({ type: 'info', message: `Transporter request for ${req.vehicleNo} has been declined.` });
  };

  const effectiveRole = propUserRole || (safeAppStorage.getItem('dpl_user_role') as UserRole) || UserRole.ADMIN;
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
  const hasVehicleMgrRole = hasAdminRole || effectiveRoles.includes(UserRole.VEHICLE_MANAGER) || effectiveRoles.includes(UserRole.LOADING_PORT_STAFF);

  // Approval request state for vehicle actions (delete, cancel, edit)
  const [showVehicleApprovalModal, setShowVehicleApprovalModal] = useState(false);
  const [approvalTargetVehicle, setApprovalTargetVehicle] = useState<Vehicle | null>(null);
  const [approvalVehicleAction, setApprovalVehicleAction] = useState<'DELETE' | 'CANCEL' | 'EDIT'>('DELETE');
  const [approvalVehicleReason, setApprovalVehicleReason] = useState('');
  const [approvalModalError, setApprovalModalError] = useState<string | null>(null);
  const [isSubmittingVehicleApproval, setIsSubmittingVehicleApproval] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    safeAppStorage.setItem('dpl_vehicle_tab', activeTab);
  }, [activeTab]);

  type VehicleStatusSubTab = 'ALL' | 'ACTIVE' | 'IN_TRANSIT' | 'EXPIRED' | 'EXPIRY_SOON' | 'TIR' | 'AFGHAN_TRANSIT' | 'BLACKLIST' | 'UPDATE_PENDING';
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState<VehicleStatusSubTab>('ALL');
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
  const [renewalModalVehicle, setRenewalModalVehicle] = useState<Vehicle | null>(null);
  const [onlineModalVehicle, setOnlineModalVehicle] = useState<Vehicle | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const getVehicleValidity = (v: Vehicle): { text: 'Valid' | 'Expired' | 'Expiry Soon'; badgeClass: string } => {
    if (v.status === 'EXPIRED') {
      return { text: 'Expired', badgeClass: 'bg-red-500/20 text-red-400 border border-red-500/30' };
    }
    if (v.status === 'EXPIRE_SOON') {
      return { text: 'Expiry Soon', badgeClass: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' };
    }
    const evalResult = evaluateVehicleRegistrationValidity(
      v.lastRenewalDate || v.registrationDate,
      v.validationExpiryDate || v.registrationExpiryDate
    );
    if (evalResult.isExpired) {
      return { text: 'Expired', badgeClass: 'bg-red-500/20 text-red-400 border border-red-500/30' };
    }
    if (evalResult.expiryDate) {
      const expDate = new Date(evalResult.expiryDate).getTime();
      const now = Date.now();
      const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        return { text: 'Expired', badgeClass: 'bg-red-500/20 text-red-400 border border-red-500/30' };
      }
      if (diffDays <= 30) {
        return { text: 'Expiry Soon', badgeClass: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' };
      }
    }
    return { text: 'Valid', badgeClass: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' };
  };
  const [transporters, setTransporters] = useState<Transporter[]>(() => {
    return safeAppStorage.getJSON<Transporter[]>('dpl_live_transporters', INITIAL_TRANSPORTERS);
  });
  const sanitizeFleetVehicle = (v: Vehicle): Vehicle => {
    const dName = (v.driverName || '').trim();
    const tName = (v.transporterName || '').trim();
    const bName = (v.brokerName || '').trim();
    // If driverName is identical to transporter or broker or 'N/A', clean it up
    if (dName && (dName.toLowerCase() === tName.toLowerCase() || dName.toLowerCase() === bName.toLowerCase() || dName.toLowerCase() === 'n/a' || dName.toLowerCase() === 'none')) {
      return { ...v, driverName: '', driverCnic: '', driverContact: '' };
    }
    return v;
  };

  const [vehicles, setVehicles] = useState<Vehicle[]>(() => {
    const stored = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', INITIAL_VEHICLES);
    return Array.isArray(stored) 
      ? stored.filter(v => !isCorruptedVehicleRecord(v)).map(sanitizeFleetVehicle)
      : INITIAL_VEHICLES;
  });

  const [copiedStatusPlate, setCopiedStatusPlate] = useState<string | null>(null);
  const [allCases, setAllCases] = useState<Case[]>(() => {
    return safeAppStorage.getJSON<Case[]>('dpl_live_cases', []) || [];
  });
  const [allDrivers, setAllDrivers] = useState<Driver[]>(() => {
    return safeAppStorage.getJSON<Driver[]>('dpl_live_drivers', []) || [];
  });
  const syncedCasesSignatureRef = useRef<string>('');

  // Real-time synchronization with Firestore (Vehicles, All-Company Cases + IndexedDB Backups, and Drivers)
  useEffect(() => {
    const unsub = subscribeToVehicles(
      (firestoreVehicles) => {
        if (firestoreVehicles) {
          const cleanVehicles = firestoreVehicles
            .filter(v => !isCorruptedVehicleRecord(v))
            .map(sanitizeFleetVehicle);
          setVehicles(cleanVehicles);
          safeAppStorage.setJSON('dpl_live_vehicles', cleanVehicles);
        }
      },
      (err) => console.warn('Vehicle subscription warning:', err)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    let isMounted = true;
    const unsubCases = subscribeToCases(
      async (firestoreCases) => {
        if (!isMounted) return;
        try {
          const idbCases = await restoreCasesFromIndexedDB();
          const idbByKey = new Map<string, any>();
          (idbCases || []).forEach((ic: any) => {
            const k = ic?.caseNo || ic?.id;
            if (k) idbByKey.set(k, ic);
          });

          const merged = (firestoreCases || []).map((fc) => {
            const k = fc.caseNo || fc.id;
            const localBackup = k ? idbByKey.get(k) : null;
            if (!localBackup) return fc;

            const fcVa: any = fc.vehicleAssignment || {};
            const lbVa: any = localBackup.vehicleAssignment || {};
            return {
              ...fc,
              vehicleAssignment: (fc.vehicleAssignment || localBackup.vehicleAssignment)
                ? {
                    ...lbVa,
                    ...fcVa,
                    driverCnicFrontUrl: fcVa.driverCnicFrontUrl || lbVa.driverCnicFrontUrl || lbVa.driverCnicUrl,
                    driverCnicBackUrl: fcVa.driverCnicBackUrl || lbVa.driverCnicBackUrl
                  }
                : undefined
            } as Case;
          });

          if (isMounted) setAllCases(merged);
        } catch (_) {
          if (isMounted) setAllCases(firestoreCases || []);
        }
      },
      (err) => console.warn('Cases subscription warning in VehicleManagement:', err),
      { allCompanies: true }
    );

    const unsubDrivers = subscribeToDrivers(
      (driversList) => {
        if (isMounted && driversList) setAllDrivers(driversList);
      },
      (err) => console.warn('Drivers subscription warning in VehicleManagement:', err)
    );

    return () => {
      isMounted = false;
      unsubCases();
      unsubDrivers();
    };
  }, []);

  // Automatically backfill and sync all registered cases (including all cases registered this month) into their assigned vehicles in Firestore
  useEffect(() => {
    if (!allCases.length || !vehicles.length) return;
    const assignmentSig = allCases
      .map((c) => {
        const va: any = c.vehicleAssignment || {};
        const cntrPlates = Array.isArray(c.containers) ? c.containers.map((cn) => cn.vehicleNo || '').join(',') : '';
        return `${c.caseNo || c.id}:${va.vehicleNo || ''}:${va.driverName || ''}:${cntrPlates}:${c.pol || ''}:${c.pod || ''}`;
      })
      .join('|');
    const fullSig = `${vehicles.length}__${allDrivers.length}__${assignmentSig}`;
    if (syncedCasesSignatureRef.current === fullSig) return;
    syncedCasesSignatureRef.current = fullSig;

    syncAllCasesHistoryToVehicles(allCases, vehicles, allDrivers).catch((err) => {
      console.warn('Case-to-vehicle history sync notice:', err);
    });
  }, [allCases, vehicles, allDrivers]);

  useEffect(() => {
    safeAppStorage.setJSON('dpl_live_transporters', transporters);
  }, [transporters]);

  useEffect(() => {
    safeAppStorage.setJSON('dpl_live_vehicles', vehicles);
  }, [vehicles]);

  // Synchronize transporters list with vehicles transporterName & brokerName automatically
  useEffect(() => {
    if (!vehicles || vehicles.length === 0) return;
    const existingNames = new Set(transporters.map(t => t.name.toLowerCase().trim()));
    const newTransportersToAdd: Transporter[] = [];
    let maxId = transporters.reduce((max, t) => t.id > max ? t.id : max, 0);

    vehicles.forEach(v => {
      if (v.transporterName && v.transporterName.trim()) {
        const cleanName = v.transporterName.trim();
        const lowerName = cleanName.toLowerCase();
        if (!existingNames.has(lowerName) && !newTransportersToAdd.some(t => t.name.toLowerCase().trim() === lowerName)) {
          maxId += 1;
          newTransportersToAdd.push({
            id: maxId,
            name: cleanName,
            contact: v.driverContact || 'On File',
            status: 'Active',
            activeCasesCount: 0,
            email: 'fleet@docks.com',
            createdAt: new Date().toISOString()
          });
          existingNames.add(lowerName);
        }
      }
      if (v.brokerName && v.brokerName.trim() && v.brokerName !== 'Direct Transporter') {
        const cleanName = v.brokerName.trim();
        const lowerName = cleanName.toLowerCase();
        if (!existingNames.has(lowerName) && !newTransportersToAdd.some(t => t.name.toLowerCase().trim() === lowerName)) {
          maxId += 1;
          newTransportersToAdd.push({
            id: maxId,
            name: cleanName,
            contact: 'Broker Entity',
            status: 'Active',
            activeCasesCount: 0,
            email: 'fleet@docks.com',
            createdAt: new Date().toISOString()
          });
          existingNames.add(lowerName);
        }
      }
    });

    if (newTransportersToAdd.length > 0) {
      setTransporters(prev => [...prev, ...newTransportersToAdd]);
    }
  }, [vehicles, transporters]);

  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals
  const [showAddTransporter, setShowAddTransporter] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null); // For Profile
  const [preSelectedTransporterId, setPreSelectedTransporterId] = useState<number | null>(null);

  // Cancellation & Automated NOC Workflow (SRS Mandate)
  const [vehicleToCancel, setVehicleToCancel] = useState<Vehicle | null>(null);
  const [cancellationReason, setCancellationReason] = useState('Contract Concluded & Operational De-Registration');
  const [isCancellingVehicle, setIsCancellingVehicle] = useState(false);
  const [nocSuccessNotice, setNocSuccessNotice] = useState<{ vehicleNo: string; nocRef: string; downloadUrl?: string; filename?: string; cancelledVehicle?: Vehicle } | null>(null);
  const [isNocViewerOpen, setIsNocViewerOpen] = useState(false);

  // Official Customs & Legal Documents (.docx) state
  const [showDocsModal, setShowDocsModal] = useState(false);
  const [docsModalType, setDocsModalType] = useState<DocumentType>('REG_LETTER');
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<number[]>([]);

  // --- Helper Functions ---

  const handleConfirmCancelVehicle = async () => {
    if (!vehicleToCancel) return;
    setIsCancellingVehicle(true);
    const today = new Date().toLocaleDateString('en-GB');
    const nocRef = `NOC-${getActiveCompanyPrefix()}-${Date.now().toString().slice(-6)}`;

    // Update vehicle status in state
    const cancelledVehicle: Vehicle = {
      ...vehicleToCancel,
      status: 'CANCELLED' as const,
      cancellationRequested: true,
      cancellationApproved: true,
      cancellationDate: today,
      cancellationReason: cancellationReason,
      nocReference: nocRef,
      nocDate: today
    };

    const updatedVehicles = vehicles.map(v => {
      if (v.id === vehicleToCancel.id) {
        return cancelledVehicle;
      }
      return v;
    });
    setVehicles(updatedVehicles);
    updateVehicleInFirestore(cancelledVehicle);

    // Automatically generate and download official NOC PDF
    try {
      const res = await downloadVehicleNocPdf({
        vehicle: {
          ...vehicleToCancel,
          cancellationReason,
          nocReference: nocRef,
          cancellationDate: today
        },
        nocNo: nocRef,
        reason: cancellationReason,
        date: today
      });

      // Also generate and download official NOC in Word (.docx) format
      try {
        await handleDownloadNocDocx(cancelledVehicle);
      } catch (docxErr) {
        console.warn("Auto docx download note:", docxErr);
      }

      setNocSuccessNotice({
        vehicleNo: vehicleToCancel.registrationNumber,
        nocRef,
        downloadUrl: res.blobUrl,
        filename: res.filename,
        cancelledVehicle
      });
    } catch (err) {
      console.error('Error generating vehicle NOC:', err);
    } finally {
      setIsCancellingVehicle(false);
      setVehicleToCancel(null);
    }
  };

  const handleDirectDownloadNoc = async (v: Vehicle) => {
    const prefix = getActiveCompanyPrefix();
    try {
      const res = await downloadVehicleNocPdf({
        vehicle: v,
        nocNo: v.nocReference || `NOC-${prefix}-${v.id}`,
        reason: v.cancellationReason || 'Fleet Release',
        date: v.cancellationDate || new Date().toLocaleDateString('en-GB')
      });
      setNocSuccessNotice({
        vehicleNo: v.registrationNumber,
        nocRef: v.nocReference || `NOC-${prefix}-${v.id}`,
        downloadUrl: res.blobUrl,
        filename: res.filename
      });
    } catch (err) {
      console.error('Failed to download NOC:', err);
    }
  };

  // Download official NOC in Word (.docx) format for pre-printed letterhead / stamp paper (NO company logo on top)
  const handleDownloadNocDocx = async (v: Vehicle) => {
    const prefix = getActiveCompanyPrefix();
    try {
      const doc = await generateVehicleNocDocx(v, {
        nocReference: v.nocReference || `NOC-${prefix}-${v.id}`,
        nocDate: v.cancellationDate || new Date().toISOString().split('T')[0],
        reason: v.cancellationReason || 'Fleet Release & Operational De-Registration',
        leaveLetterheadSpace: true
      });
      const filename = `Vehicle_NOC_${v.registrationNumber.replace(/\s+/g, '_')}_Letterhead.docx`;
      await downloadDocxBlob(doc, filename);
    } catch (err) {
      console.error('Failed to download NOC DOCX:', err);
    }
  };

  // Download official Pakistan Customs Directorate General of Transit Trade Vehicle List (PDF)
  const handleDownloadCustomsListPdf = async () => {
    try {
      const activeList = vehicles.filter(v => v.status !== 'CANCELLED');
      await downloadCustomsVehicleListPdf({
        vehicles: activeList.length > 0 ? activeList : vehicles
      });
    } catch (err) {
      console.error('Failed to download Customs List PDF:', err);
    }
  };

  // Universal Read-Only Document Preview State (.docx / .pdf / .xlsx / .image)
  const [universalPreviewState, setUniversalPreviewState] = useState<{
    isOpen: boolean;
    file: File | Blob | ArrayBuffer | string | any | null;
    filename: string;
    title: string;
    fileType?: 'docx' | 'pdf' | 'xlsx' | 'image' | 'auto';
    verificationItems: DataMappingCheckItem[];
    onDownload?: () => void;
  }>({
    isOpen: false,
    file: null,
    filename: '',
    title: '',
    fileType: 'auto',
    verificationItems: []
  });

  const handlePreviewNocDocx = async (v: Vehicle) => {
    const prefix = getActiveCompanyPrefix();
    try {
      const doc = await generateVehicleNocDocx(v, {
        nocReference: v.nocReference || `NOC-${prefix}-${v.id}`,
        nocDate: v.cancellationDate || new Date().toISOString().split('T')[0],
        reason: v.cancellationReason || 'Fleet Release & Operational De-Registration',
        leaveLetterheadSpace: true
      });
      const blob = await generateDocxBlob(doc);
      const filename = `Vehicle_NOC_${v.registrationNumber.replace(/\s+/g, '_')}_Letterhead.docx`;
      const verificationItems: DataMappingCheckItem[] = [
        { label: 'Vehicle Reg Number', value: v.registrationNumber, status: 'verified' },
        { label: 'Make / Model', value: v.makeModel || `${v.maker || ''} ${v.model || ''}`.trim() || 'HINO / BEDFORD', status: 'verified' },
        { label: 'Engine Number', value: v.engineNo || 'Verified', status: 'verified' },
        { label: 'Chassis Number', value: v.chassisNo || 'Verified', status: 'verified' },
        { label: 'NOC Reference', value: v.nocReference || `NOC-${prefix}-${v.id}`, status: 'verified' },
        { label: 'Cancellation Reason', value: v.cancellationReason || 'Fleet Release & Operational De-Registration', status: 'verified' },
        { label: 'Registered Transporter', value: v.transporterName || 'Fleet Operator', status: 'verified' },
        { label: 'Carrier NTN', value: activeCompany?.id === 'docks' ? '5064083-8 / 3997968' : '3997968', status: 'verified' }
      ];

      setUniversalPreviewState({
        isOpen: true,
        file: blob,
        filename,
        title: `Official De-Registration NOC (.docx) • ${v.registrationNumber}`,
        fileType: 'docx',
        verificationItems,
        onDownload: () => handleDownloadNocDocx(v)
      });
    } catch (err: any) {
      console.error('Failed to preview NOC DOCX:', err);
    }
  };

  const handlePreviewNocPdf = async (v: Vehicle) => {
    const prefix = getActiveCompanyPrefix();
    try {
      const res = await downloadVehicleNocPdf({
        vehicle: v,
        nocNo: v.nocReference || `NOC-${prefix}-${v.id}`,
        reason: v.cancellationReason || 'Fleet Release',
        date: v.cancellationDate || new Date().toLocaleDateString('en-GB')
      });
      const verificationItems: DataMappingCheckItem[] = [
        { label: 'Vehicle Reg Number', value: v.registrationNumber, status: 'verified' },
        { label: 'Chassis Number', value: v.chassisNo || 'Verified', status: 'verified' },
        { label: 'Engine Number', value: v.engineNo || 'Verified', status: 'verified' },
        { label: 'NOC Reference', value: v.nocReference || `NOC-${prefix}-${v.id}`, status: 'verified' },
        { label: 'Cancellation Date', value: v.cancellationDate || new Date().toLocaleDateString('en-GB'), status: 'verified' }
      ];

      setUniversalPreviewState({
        isOpen: true,
        file: res.blobUrl,
        filename: res.filename,
        title: `Official Vehicle NOC PDF • ${v.registrationNumber}`,
        fileType: 'pdf',
        verificationItems,
        onDownload: () => handleDirectDownloadNoc(v)
      });
    } catch (err) {
      console.error('Failed to preview NOC PDF:', err);
    }
  };

  const handlePreviewCustomsListPdf = async () => {
    try {
      const activeList = vehicles.filter(v => v.status !== 'CANCELLED');
      const targetVehicles = activeList.length > 0 ? activeList : vehicles;
      const res = await downloadCustomsVehicleListPdf({
        vehicles: targetVehicles
      });
      const verificationItems: DataMappingCheckItem[] = [
        { label: 'Issuing Authority', value: 'Directorate General of Transit Trade Karachi', status: 'verified' },
        { label: 'Licensed Carrier', value: activeCompany?.legalTitle || activeCompany?.name || 'Docks (Pvt) Ltd', status: 'verified' },
        { label: 'Total Permitted Fleet', value: `${targetVehicles.length} Vehicles in Registry`, status: 'verified' },
        { label: 'Customs License NTN', value: activeCompany?.id === 'docks' ? '5064083-8 / 3997968' : '3997968', status: 'verified' }
      ];

      setUniversalPreviewState({
        isOpen: true,
        file: res.blobUrl,
        filename: res.filename,
        title: `Customs Directorate Transit Vehicle List (${targetVehicles.length} vehicles)`,
        fileType: 'pdf',
        verificationItems,
        onDownload: handleDownloadCustomsListPdf
      });
    } catch (err: any) {
      console.error('Failed to preview Customs list PDF:', err);
    }
  };

  const handlePreviewVehicleDetailsPdf = async (v: Vehicle) => {
    try {
      const res = await downloadVehicleDetailsPdf(v);
      const verificationItems: DataMappingCheckItem[] = [
        { label: 'Vehicle Number', value: v.registrationNumber, status: 'verified' },
        { label: 'DPL Serial No', value: v.dplSerial || `DPL-${v.id}`, status: 'verified' },
        { label: 'Category & Type', value: `${v.category} - ${v.type}`, status: 'verified' },
        { label: 'Chassis No', value: v.chassisNo || 'Verified', status: 'verified' },
        { label: 'Engine No', value: v.engineNo || 'Verified', status: 'verified' },
        { label: 'Transporter', value: v.transporterName || 'Fleet Operator', status: 'verified' },
        { label: 'Driver Assigned', value: v.driverName || 'Verified Driver', status: 'verified' },
        { label: 'Tracker Status', value: v.tracker ? `${v.tracker.provider} (${v.tracker.paymentStatus})` : 'Unassigned', status: 'verified' }
      ];

      setUniversalPreviewState({
        isOpen: true,
        file: res.blobUrl,
        filename: res.filename,
        title: `Vehicle Dossier Record • ${v.registrationNumber}`,
        fileType: 'pdf',
        verificationItems,
        onDownload: () => downloadVehicleDetailsPdf(v)
      });
    } catch (err) {
      console.error('Failed to preview vehicle dossier PDF:', err);
    }
  };

  const handlePreviewVehiclesExcel = () => {
    try {
      const { buffer, filename } = generateVehiclesExcelBuffer(vehicles);
      const verificationItems: DataMappingCheckItem[] = [
        { label: 'Workbook Format', value: 'Master Fleet Registry (.xlsx)', status: 'verified' },
        { label: 'Company Entity', value: activeCompany?.legalTitle || activeCompany?.name || 'Docks (Pvt) Ltd', status: 'verified' },
        { label: 'Total Fleet Records', value: `${vehicles.length} Vehicles Mapped`, status: 'verified' },
        { label: 'Active On Trips', value: `${vehicles.filter(v => v.status === 'ON_TRIP').length} Vehicles`, status: 'verified' },
        { label: 'Customs License NTN', value: activeCompany?.id === 'docks' ? '5064083-8 / 3997968' : '3997968', status: 'verified' }
      ];

      setUniversalPreviewState({
        isOpen: true,
        file: buffer,
        filename,
        title: `Master Vehicles Fleet Registry (${vehicles.length} vehicles)`,
        fileType: 'xlsx',
        verificationItems,
        onDownload: () => exportVehiclesToExcel(vehicles)
      });
    } catch (err: any) {
      console.error('Failed to preview vehicles Excel:', err);
    }
  };

  const generateDPLSerial = (customList?: Vehicle[]) => {
    const list = customList || vehicles;
    const prefix = getActiveCompanyPrefix();
    let maxSeq = 0;
    const regex = new RegExp(`^(?:DPL|MI|VSL|TRK|${prefix})-(\\d+)`, 'i');
    list.forEach(v => {
      if (v.dplSerial) {
        const match = v.dplSerial.match(regex);
        if (match) {
          const seq = parseInt(match[1], 10);
          if (seq > maxSeq) maxSeq = seq;
        }
      }
    });
    const nextSeq = maxSeq + 1;
    return `${prefix}-${String(nextSeq).padStart(4, '0')}`;
  };

  const calculateExpiryDate = (startDate: string) => {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + 6);
    return date.toISOString().split('T')[0];
  };

  const checkExpiryStatus = (expiryDate?: string, registrationDate?: string) => {
    const evalRes = evaluateVehicleRegistrationValidity(registrationDate, expiryDate);
    if (evalRes.isExpired) return 'Expired';
    if (!evalRes.expiryDate) return 'Expired';
    const today = new Date();
    const expiry = new Date(evalRes.expiryDate);
    const monthsDiff = (expiry.getTime() - today.getTime()) / (1000 * 3600 * 24 * 30);
    
    if (monthsDiff < 0) return 'Expired';
    if (monthsDiff <= 1) return 'Expiring Soon';
    return 'Valid';
  };

  // --- Derived State ---

  const sortedTransporters = useMemo(() => {
    return [...transporters].sort((a, b) => b.activeCasesCount - a.activeCasesCount);
  }, [transporters]);

  const vehiclesOnWay = vehicles.filter(v => v.status === 'ON_TRIP');
  const vehiclesExpired = vehicles.filter(v => v.status === 'EXPIRED' || getVehicleValidity(v).text === 'Expired');
  const vehiclesExpiringSoon = vehicles.filter(v => v.status === 'EXPIRE_SOON' || getVehicleValidity(v).text === 'Expiry Soon');
  const vehiclesActiveValid = vehicles.filter(
    v =>
      !v.isBlacklisted &&
      v.status !== 'CANCELLED' &&
      v.status !== 'INACTIVE' &&
      v.status !== 'EXPIRED' &&
      getVehicleValidity(v).text !== 'Expired'
  );
  
  const statusCounts = useMemo(() => {
    return {
      ALL: vehicles.length,
      ACTIVE: vehicles.filter(
        v =>
          !v.isBlacklisted &&
          v.status !== 'CANCELLED' &&
          v.status !== 'INACTIVE' &&
          v.status !== 'EXPIRED' &&
          getVehicleValidity(v).text !== 'Expired'
      ).length,
      IN_TRANSIT: vehicles.filter(v => v.status === 'ON_TRIP' || v.status === 'IN_LINE').length,
      EXPIRED: vehicles.filter(v => v.status === 'EXPIRED' || getVehicleValidity(v).text === 'Expired').length,
      EXPIRY_SOON: vehicles.filter(v => v.status === 'EXPIRE_SOON' || getVehicleValidity(v).text === 'Expiry Soon').length,
      TIR: vehicles.filter(v => (v.category as string)?.toUpperCase() === 'TIR' || (v.type as string)?.toUpperCase().includes('TIR')).length,
      AFGHAN_TRANSIT: vehicles.filter(v => (v.category as string)?.toLowerCase().includes('afghan') || (v.type as string)?.toLowerCase().includes('afghan')).length,
      BLACKLIST: vehicles.filter(v => Boolean(v.isBlacklisted || v.status === 'CANCELLED' || v.status === 'INACTIVE')).length,
      UPDATE_PENDING: vehicles.filter(v => Boolean(v.isUpdatePending || !v.chassisNo || !v.engineNo || !v.registrationBook || !v.ownerIdCardUrl)).length,
    };
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || (
        v.registrationNumber.toLowerCase().includes(q) ||
        (v.brokerName && v.brokerName.toLowerCase().includes(q)) ||
        v.transporterName.toLowerCase().includes(q) ||
        (v.chassisNo && v.chassisNo.toLowerCase().includes(q)) ||
        (v.engineNo && v.engineNo.toLowerCase().includes(q)) ||
        (v.make && v.make.toLowerCase().includes(q)) ||
        (v.model && v.model.toLowerCase().includes(q)) ||
        (v.companyName && v.companyName.toLowerCase().includes(q)) ||
        (v.driverName && v.driverName.toLowerCase().includes(q)) ||
        (v.dplSerial && v.dplSerial.toLowerCase().includes(q))
      );

      if (!matchesSearch) return false;

      const validity = getVehicleValidity(v);
      switch (vehicleStatusFilter) {
        case 'ACTIVE':
          return (
            !v.isBlacklisted &&
            v.status !== 'CANCELLED' &&
            v.status !== 'INACTIVE' &&
            v.status !== 'EXPIRED' &&
            validity.text !== 'Expired'
          );
        case 'IN_TRANSIT':
          return v.status === 'ON_TRIP' || v.status === 'IN_LINE';
        case 'EXPIRED':
          return v.status === 'EXPIRED' || validity.text === 'Expired';
        case 'EXPIRY_SOON':
          return v.status === 'EXPIRE_SOON' || validity.text === 'Expiry Soon';
        case 'TIR':
          return (v.category as string)?.toUpperCase() === 'TIR' || (v.type as string)?.toUpperCase().includes('TIR');
        case 'AFGHAN_TRANSIT':
          return (v.category as string)?.toLowerCase().includes('afghan') || (v.type as string)?.toLowerCase().includes('afghan');
        case 'BLACKLIST':
          return Boolean(v.isBlacklisted || v.status === 'CANCELLED' || v.status === 'INACTIVE');
        case 'UPDATE_PENDING':
          return Boolean(v.isUpdatePending || !v.chassisNo || !v.engineNo || !v.registrationBook || !v.ownerIdCardUrl);
        case 'ALL':
        default:
          return true;
      }
    });
  }, [vehicles, searchQuery, vehicleStatusFilter]);

  const isAllFilteredSelected = filteredVehicles.length > 0 && filteredVehicles.every(v => selectedVehicleIds.includes(v.id));

  const toggleSelectAllFiltered = () => {
    if (isAllFilteredSelected) {
      const filteredIdSet = new Set(filteredVehicles.map(v => v.id));
      setSelectedVehicleIds(prev => prev.filter(id => !filteredIdSet.has(id)));
    } else {
      const filteredIds = filteredVehicles.map(v => v.id);
      setSelectedVehicleIds(prev => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const toggleSelectVehicle = (id: number) => {
    setSelectedVehicleIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleOpenOfficialDocs = (docType: DocumentType, preset?: 'EXPIRED' | 'RENEWAL' | 'ALL') => {
    setDocsModalType(docType);
    if (preset === 'EXPIRED' || preset === 'RENEWAL') {
      const expiredIds = vehicles.filter(v => v.status === 'EXPIRED' || v.status === 'EXPIRE_SOON' || getVehicleValidity(v).text === 'Expired').map(v => v.id);
      setSelectedVehicleIds(expiredIds.length > 0 ? expiredIds : vehicles.slice(0, 10).map(v => v.id));
    } else if (preset === 'ALL' && selectedVehicleIds.length === 0) {
      setSelectedVehicleIds(vehicles.slice(0, 10).map(v => v.id));
    }
    setShowDocsModal(true);
  };

  const handleSelectAllExpiredVehicles = () => {
    const expiredIds = vehicles.filter(v => v.status === 'EXPIRED' || getVehicleValidity(v).text === 'Expired').map(v => v.id);
    setSelectedVehicleIds(expiredIds.length > 0 ? expiredIds : vehicles.slice(0, 10).map(v => v.id));
    setDocsModalType('REG_LETTER');
    setShowDocsModal(true);
  };

  const handleDownloadStampPaperTerminationDocx = async (v: Vehicle) => {
    try {
      const doc = await generateLeaseTerminationAgreementDocx(v, {
        terminationDate: new Date(),
        leaveStampPaperSpace: true
      });
      await downloadDocxBlob(doc, `Lease_Termination_${v.registrationNumber}_Stamp_Paper.docx`);
    } catch (err) {
      console.error('Failed to generate termination docx:', err);
    }
  };

  const handleDownloadLetterheadCancellationDocx = async (v: Vehicle) => {
    try {
      const doc = await generateCancellationLetterLetterheadDocx(v, {
        letterDate: new Date(),
        leaveLetterheadSpace: true
      });
      await downloadDocxBlob(doc, `Customs_Panel_Cancellation_${v.registrationNumber}_Letterhead.docx`);
    } catch (err) {
      console.error('Failed to generate cancellation letter docx:', err);
    }
  };

  const handleExportAllVehiclesList = () => {
    // Complete formatted export of all vehicles into professional Excel workbook (.xlsx)
    exportVehiclesToExcel(vehicles);
  };

  const trackersOnWay = vehicles.filter(v => v.tracker && v.status === 'ON_TRIP');
  const pendingTrackerPayments = vehicles.filter(v => v.tracker?.provider === 'Us' && v.tracker.paymentStatus === 'Pending');

  // --- Handlers ---

  const handleAddTransporter = (data: any, extractedVehicles: any[]) => {
    const newTransporterId = Date.now();
    const newTransporter: Transporter = {
      id: newTransporterId,
      ...data,
      activeCasesCount: 0,
      createdAt: new Date().toISOString().split('T')[0],
      status: 'Active'
    };
    setTransporters([...transporters, newTransporter]);

    if (extractedVehicles && extractedVehicles.length > 0) {
      const tempVehiclesList = [...vehicles];
      const newVehicles = extractedVehicles.map((v, index) => {
        const serial = generateDPLSerial(tempVehiclesList);
        const vehicleRecord = {
          id: Date.now() + index + 1,
          dplSerial: serial,
          createdAt: new Date().toISOString().split('T')[0],
          history: [],
          status: 'AVAILABLE' as const,
          transporterId: newTransporterId,
          transporterName: data.name,
          driverName: 'N/A',
          driverCnic: 'N/A',
          driverContact: 'N/A',
          ...v
        };
        tempVehiclesList.push(vehicleRecord);
        return vehicleRecord;
      });
      setVehicles(prev => [...prev, ...newVehicles]);
      newVehicles.forEach(nv => saveVehicleToFirestore(nv));
    }
    
    setShowAddTransporter(false);
  };

  const handleAddVehicle = (data: any) => {
    const resolvedComp = resolveVehicleCompany(data.companyName || data.operatingCompany || activeCompany.id || 'truckit');
    const syncedTransporter = (data.transporterName || data.brokerName || 'Direct Transporter').trim();
    const validity = evaluateVehicleRegistrationValidity(data.registrationDate || data.validationStartDate, data.validationExpiryDate);
    const cleanReg = (data.registrationNumber || '').trim().toUpperCase();
    const normPlate = normalizeVehiclePlate(cleanReg);
    const existingMatch = vehicles.find(v => normalizeVehiclePlate(v.registrationNumber) === normPlate);

    const newOrUpdatedVehicle: Vehicle = {
      ...(existingMatch || {}),
      id: existingMatch?.id || data.id || getDeterministicVehicleId(cleanReg),
      dplSerial: existingMatch?.dplSerial || data.dplSerial || generateDPLSerial(),
      createdAt: existingMatch?.createdAt || new Date().toISOString().split('T')[0],
      history: existingMatch?.history || [],
      tripsHistory: existingMatch?.tripsHistory || [],
      ...data,
      registrationNumber: cleanReg,
      transporterName: syncedTransporter,
      brokerName: syncedTransporter,
      make: data.make || existingMatch?.make || '',
      maker: data.make || data.maker || existingMatch?.maker || existingMatch?.make || '',
      model: data.model || existingMatch?.model || '',
      mra: (data.mra !== undefined ? String(data.mra) : (existingMatch?.mra || '')).trim(),
      makeModel: [data.make || existingMatch?.make || '', data.model || existingMatch?.model || ''].filter(Boolean).join(' ') || data.makeModel || existingMatch?.makeModel || '',
      registrationDate: validity.registrationDate || data.registrationDate || '',
      validationExpiryDate: validity.expiryDate || data.validationExpiryDate || '',
      status: data.status === 'CANCELLED' ? 'CANCELLED' : validity.status,
      operatingCompany: resolvedComp.operatingCompany,
      companyName: resolvedComp.companyName,
    };

    const { merged, removedIds } = dedupeAndMergeVehicles([...vehicles, newOrUpdatedVehicle]);
    setVehicles(merged);
    const finalSaved = merged.find(v => normalizeVehiclePlate(v.registrationNumber) === normPlate) || newOrUpdatedVehicle;
    saveVehicleToFirestore(finalSaved);
    removedIds.forEach(dupId => {
      if (Number(dupId) !== Number(finalSaved.id)) {
        deleteVehicleFromFirestore(dupId);
      }
    });
    if (selectedVehicle && normalizeVehiclePlate(selectedVehicle.registrationNumber) === normPlate) {
      setSelectedVehicle(finalSaved);
    }
    setShowAddVehicle(false);
    setEditingVehicle(null);
  };

  const handleDeleteVehicle = (id: number) => {
    const targetVehicle = vehicles.find(v => v.id === id);
    if (!targetVehicle) return;

    const isOfficeStaff = hasAdminRole || hasVehicleMgrRole || effectiveRoles.some(r => 
      r === UserRole.OPERATIONS_MANAGER || 
      r === UserRole.OFFICE_STAFF || 
      r === UserRole.LOADING_PORT_STAFF || 
      r === UserRole.DESTINATION_PORT_STAFF || 
      r === UserRole.FINANCE_MANAGER
    ) || !effectiveRoles.includes(UserRole.TRANSPORTER);

    if (isOfficeStaff) {
      if (window.confirm("Are you sure you want to delete this vehicle?")) {
        setVehicles(vehicles.filter(v => v.id !== id));
        deleteVehicleFromFirestore(id);
      }
      return;
    }

    // Non-admin deleting vehicle requires Admin approval notification
    setApprovalTargetVehicle(targetVehicle);
    setApprovalVehicleAction('DELETE');
    setApprovalVehicleReason('');
    setShowVehicleApprovalModal(true);
  };

  const handleSubmitVehicleApproval = async () => {
    if (!approvalTargetVehicle) return;
    if (!approvalVehicleReason.trim()) {
      setApprovalModalError('Please provide a reason for this action request.');
      return;
    }

    setApprovalModalError(null);
    setIsSubmittingVehicleApproval(true);
    try {
      const requesterName = safeAppStorage.getItem('dpl_user_name') || 'Vehicle Staff';
      const requesterRole = effectiveRoles.map(r => r.replace(/_/g, ' ')).join(', ');
      const res = await submitVehicleActionApproval({
        actionType: approvalVehicleAction,
        vehicleItem: approvalTargetVehicle,
        requestedBy: requesterName,
        requestedByRole: requesterRole,
        reason: approvalVehicleReason.trim()
      });

      setVehicles(prev => prev.map(v => v.id === res.updatedVehicle.id ? res.updatedVehicle : v));
      if (selectedVehicle?.id === res.updatedVehicle.id) {
        setSelectedVehicle(res.updatedVehicle);
      }
      setShowVehicleApprovalModal(false);
      setStatusBanner({
        type: 'success',
        message: `Approval request submitted to Super Admin to ${approvalVehicleAction.toLowerCase()} vehicle ${approvalTargetVehicle.registrationNumber}.`
      });
    } catch (err) {
      console.error("Failed to submit vehicle approval request:", err);
      setApprovalModalError('Failed to submit approval request. Please try again.');
    } finally {
      setIsSubmittingVehicleApproval(false);
    }
  };

  const handleDeleteTransporter = (id: number) => {
    if (window.confirm("Are you sure you want to delete this transporter?")) {
      setTransporters(transporters.filter(t => t.id !== id));
    }
  };

  const handleImportParsedVehicles = (parsedList: Partial<Vehicle>[]) => {
    const cleanList = parsedList.filter(item => !isCorruptedVehicleRecord(item));
    const tempVehiclesList = [...vehicles];
    const newVehicles: Vehicle[] = cleanList.map((item, idx) => {
      const cleanReg = (item.registrationNumber || `REG-${Date.now() + idx}`).trim().toUpperCase();
      const serial = item.dplSerial || generateDPLSerial(tempVehiclesList);
      const syncedTransporter = (item.transporterName || item.brokerName || 'Direct Transporter').trim();
      const rawDriver = (item.driverName || '').trim();
      const isVendorDriver = !rawDriver || 
        rawDriver.toLowerCase() === syncedTransporter.toLowerCase() || 
        rawDriver.toLowerCase() === 'n/a' ||
        rawDriver.toLowerCase() === 'none';
      const cleanDriver = isVendorDriver ? '' : rawDriver;

      const resolvedComp = resolveVehicleCompany(item.companyName || item.operatingCompany);
      const validity = evaluateVehicleRegistrationValidity(item.registrationDate, item.validationExpiryDate);

      const vehicleRecord: Vehicle = {
        id: item.id || getDeterministicVehicleId(cleanReg),
        registrationNumber: cleanReg,
        category: (item.category as VehicleCategory) || VehicleCategory.BONDED_CARRIER,
        type: (item.type as VehicleType) || VehicleType.FLATBED,
        size: (item.size as '20ft' | '40ft' | '45ft' | 'Loose') || '40ft',
        weightCapacity: item.weightCapacity || '',
        engineNo: item.engineNo || 'N/A',
        chassisNo: item.chassisNo || 'N/A',
        make: item.make || '',
        model: item.model || '',
        makeModel: item.makeModel || [item.make, item.model].filter(Boolean).join(' '),
        transporterId: 0,
        transporterName: syncedTransporter,
        brokerName: syncedTransporter,
        driverName: cleanDriver,
        driverCnic: cleanDriver ? (item.driverCnic || '') : '',
        driverContact: cleanDriver ? (item.driverContact || '') : '',
        registrationDate: validity.registrationDate,
        validationExpiryDate: validity.expiryDate,
        operatingCompany: resolvedComp.operatingCompany,
        companyName: resolvedComp.companyName,
        dplSerial: serial,
        createdAt: new Date().toISOString().split('T')[0],
        history: [],
        tripsHistory: item.tripsHistory || [],
        status: validity.status,
        isOnline: false
      };
      tempVehiclesList.push(vehicleRecord);
      return vehicleRecord;
    });

    // Deduplicate & merge with existing global vehicles (moving Docks duplicates to Truckit)
    const { merged, removedIds } = dedupeAndMergeVehicles([...vehicles, ...newVehicles]);
    setVehicles(merged);
    removedIds.forEach(dupId => {
      deleteVehicleFromFirestore(dupId);
    });
    saveVehiclesBulkToFirestore(newVehicles);
    setShowBulkUploadModal(false);
  };

  const handleConfirmOnline = (vehicleId: number, station: string, destination: string) => {
    setVehicles(prev => prev.map(v => {
      if (v.id === vehicleId) {
        const updated = {
          ...v,
          isOnline: true,
          onlineLocation: station,
          onlineDestination: destination,
          status: 'AVAILABLE' as const
        };
        updateVehicleInFirestore(updated);
        return updated;
      }
      return v;
    }));
    setOnlineModalVehicle(null);
  };

  const handleToggleOffline = (vehicleId: number) => {
    setVehicles(prev => prev.map(v => {
      if (v.id === vehicleId) {
        const updated = {
          ...v,
          isOnline: false,
          onlineLocation: undefined,
          onlineDestination: undefined
        };
        updateVehicleInFirestore(updated);
        return updated;
      }
      return v;
    }));
  };

  const handleConfirmRenewal = (vehicleId: number, newExpiryDate: string, docUrl?: string) => {
    const todayIso = new Date().toISOString().split('T')[0];
    setVehicles(prev => prev.map(v => {
      if (v.id === vehicleId) {
        const updated: Vehicle = {
          ...v,
          registrationDate: todayIso,
          lastRenewalDate: todayIso,
          validationExpiryDate: newExpiryDate,
          status: 'AVAILABLE',
          isUpdatePending: false,
          history: [
            ...(v.history || []),
            {
              id: Date.now(),
              date: todayIso,
              description: `6-Month Customs Validity Renewed until ${newExpiryDate}`,
              type: 'STATUS_CHANGE' as const
            }
          ]
        };
        updateVehicleInFirestore(updated);
        return updated;
      }
      return v;
    }));
    setRenewalModalVehicle(null);
  };

  // --- Render Sections ---

  const renderTransportersSection = () => (
    <div className="space-y-6 animate-fade-in">
      {/* Action Bar */}
      <div className="flex flex-wrap justify-between items-center gap-4 bg-white/5 p-4 rounded-xl border border-white/10">
        <div className="flex gap-3">
          <button onClick={() => setShowAddTransporter(true)} className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors">
            <Plus size={16} /> Add Transporter
          </button>
          <button onClick={() => { setPreSelectedTransporterId(null); setShowAddVehicle(true); }} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors">
            <Truck size={16} /> Add Vehicle
          </button>
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
          <input 
            type="text" 
            placeholder="Search transporters..." 
            className="w-full glass-input rounded-lg pl-9 pr-4 py-2 text-sm outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Transporters List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedTransporters.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase())).map((t, tIdx) => (
          <div key={`trans_card_${t.id || tIdx}_${tIdx}`} className="glass-card p-5 rounded-xl border border-white/10 hover:bg-white/5 transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 font-bold">
                  {t.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-white font-semibold">{t.name}</h3>
                  <p className="text-xs text-gray-400">{t.contact}</p>
                </div>
              </div>
              <span className={`px-2 py-1 rounded text-[10px] font-medium ${t.status === 'Active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {t.status}
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-300 mb-4">
              <div className="bg-white/5 p-2 rounded flex flex-col items-center">
                <span className="text-xs text-gray-500">Active Cases</span>
                <span className="font-bold text-white">
                  {vehicles.filter(v => (v.transporterId === t.id || v.transporterName?.toLowerCase().trim() === t.name.toLowerCase().trim() || v.brokerName?.toLowerCase().trim() === t.name.toLowerCase().trim()) && v.status === 'ON_TRIP').length}
                </span>
              </div>
              <div className="bg-white/5 p-2 rounded flex flex-col items-center">
                <span className="text-xs text-gray-500">Vehicles</span>
                <span className="font-bold text-white">
                  {vehicles.filter(v => v.transporterId === t.id || v.transporterName?.toLowerCase().trim() === t.name.toLowerCase().trim() || v.brokerName?.toLowerCase().trim() === t.name.toLowerCase().trim()).length}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => { setPreSelectedTransporterId(t.id); setShowAddVehicle(true); }}
                className="flex-1 bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 py-2 rounded-lg text-xs font-medium transition-colors"
              >
                + Add Vehicle
              </button>
              <button 
                onClick={() => handleDeleteTransporter(t.id)}
                className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                title="Delete Transporter"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderVehiclesSection = () => (
    <div className="space-y-3 animate-fade-in w-full max-w-full min-w-0 overflow-x-hidden">
      {/* Unified Compact Action & Customs Document Toolbar */}
      <div className="w-full bg-slate-900/75 border border-white/10 rounded-xl p-3 space-y-2.5">
        {/* Tier 1: Fleet Operations & Export Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button 
              onClick={() => { setPreSelectedTransporterId(null); setShowAddVehicle(true); }}
              className="bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold shadow-sm transition-colors whitespace-nowrap shrink-0"
            >
              <Plus size={14} /> Add Vehicle
            </button>
            <button 
              onClick={() => setShowAddTransporter(true)} 
              className="bg-purple-600/20 hover:bg-purple-600 border border-purple-500/30 text-purple-300 hover:text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <User size={14} /> Add Transporter
            </button>
            <button 
              onClick={() => setShowBulkUploadModal(true)}
              className="bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/30 text-emerald-300 hover:text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              title="Import multiple vehicles using Excel (.xlsx), Word (.docx), or CSV files"
            >
              <UploadCloud size={14} /> Bulk Upload (.xlsx / .csv)
            </button>
            <button 
              type="button"
              onClick={() => {
                const host = (window.location.hostname || '').toLowerCase();
                if (host.includes('makpk.online') || host.includes('mak-group.com')) {
                  window.location.href = 'https://vehicle.makpk.online';
                  return;
                }
                if (onOpenPublicTracker) onOpenPublicTracker();
                else window.open('/?mode=vehicle', '_blank');
              }}
              className="bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 hover:text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Open Live Public Vehicle Status Portal (vehicle.makpk.online)"
            >
              <Globe size={14} className="text-amber-400" />
              <span>Status Portal</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-0.5 bg-red-950/40 p-0.5 rounded-lg border border-red-500/30">
              <button 
                onClick={handlePreviewCustomsListPdf}
                className="hover:bg-red-600/40 text-red-300 hover:text-white px-2 py-1 rounded flex items-center gap-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0"
                title="Preview official Pakistan Customs Vehicle List (PDF)"
              >
                <Eye size={12} className="text-amber-300" /> Customs PDF
              </button>
              <button 
                onClick={handleDownloadCustomsListPdf}
                className="bg-red-600/30 hover:bg-red-600 text-red-200 hover:text-white px-2 py-1 rounded flex items-center gap-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0"
                title="Download official Pakistan Customs Vehicle List (PDF)"
              >
                <Download size={12} /> PDF
              </button>
            </div>
            <div className="flex items-center gap-0.5 bg-emerald-950/40 p-0.5 rounded-lg border border-emerald-500/30">
              <button 
                onClick={handlePreviewVehiclesExcel}
                className="hover:bg-emerald-600/40 text-emerald-300 hover:text-white px-2 py-1 rounded flex items-center gap-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0"
                title="Preview Master Fleet Excel (.xlsx)"
              >
                <Eye size={12} className="text-emerald-300" /> Fleet Excel
              </button>
              <button 
                onClick={handleExportAllVehiclesList}
                className="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white px-2 py-1 rounded flex items-center gap-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0"
                title="Download formatted Excel (.xlsx) workbook"
              >
                <Download size={12} /> .xlsx
              </button>
            </div>
          </div>
        </div>

        {/* Tier 2: Compact Customs & FBR Word (.docx) Templates Strip */}
        <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1 mr-1 whitespace-nowrap">
              <FileText size={13} className="text-blue-400" />
              <span>Customs (.docx):</span>
            </span>
            <button
              type="button"
              onClick={() => handleOpenOfficialDocs('REG_LETTER', 'ALL')}
              className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
              title="Generate complete registration file for Pakistan Customs House"
            >
              <span>Registration Docs</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenOfficialDocs('CUSTOMS_PERMIT', 'RENEWAL')}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
              title="Generate renewal permits for expired or due vehicles"
            >
              <span>Renewal Docs</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenOfficialDocs('CANCELLATION_NOC')}
              className="bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
              title="Generate cancellation & NOC docs for Customs panel de-registration"
            >
              <span>Cancellation Docs</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => handleOpenOfficialDocs('REG_LETTER')}
              className="bg-white/5 hover:bg-blue-600/20 border border-white/10 text-gray-300 hover:text-blue-300 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
              title="Letter 10 Vehicles registration letter"
            >
              Letter 10 Vehicles
            </button>
            <button
              type="button"
              onClick={() => handleOpenOfficialDocs('CUSTOMS_PERMIT')}
              className="bg-white/5 hover:bg-emerald-600/20 border border-white/10 text-gray-300 hover:text-emerald-300 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
              title="Custom Vehicle List (Customs Directorate Format)"
            >
              Custom List
            </button>
            <button
              type="button"
              onClick={() => handleOpenOfficialDocs('LEASE_AGREEMENT')}
              className="bg-white/5 hover:bg-amber-600/20 border border-white/10 text-gray-300 hover:text-amber-300 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
              title="Lease Agreement TAS-582 on Legal Stamp Paper"
            >
              Lease TAS-582
            </button>
            <button
              type="button"
              onClick={() => handleOpenOfficialDocs('AFFIDAVIT')}
              className="bg-white/5 hover:bg-indigo-600/20 border border-white/10 text-gray-300 hover:text-indigo-300 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
              title="Affidavit (Stamp Paper - SRO 450(I)/2001)"
            >
              Affidavit SRO 450
            </button>
            <button
              type="button"
              onClick={() => handleOpenOfficialDocs('LEASE_TERMINATION')}
              className="bg-white/5 hover:bg-rose-600/20 border border-white/10 text-gray-300 hover:text-rose-300 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
              title="Lease Termination of NOC on Stamp Paper"
            >
              Lease Termination
            </button>
            <button
              type="button"
              onClick={() => handleOpenOfficialDocs('CANCELLATION_NOC')}
              className="bg-white/5 hover:bg-purple-600/20 border border-white/10 text-gray-300 hover:text-purple-300 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
              title="NOC on Letterhead (Panel De-registration)"
            >
              NOC Letterhead
            </button>
          </div>
        </div>
      </div>

      {/* Compact 5-Column Summary Strip (Including Active / Valid Vehicles Counter) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <div
          onClick={() => setVehicleStatusFilter('ACTIVE')}
          className="bg-slate-900/75 hover:bg-slate-800/80 px-3 py-2 rounded-xl border border-emerald-500/25 flex items-center justify-between gap-2 cursor-pointer transition-colors"
        >
          <div className="min-w-0">
            <span className="text-emerald-300/90 text-[11px] font-semibold block truncate">Active (Valid)</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-emerald-400 font-mono tabular-nums">{vehiclesActiveValid.length}</span>
              <span className="text-[10.5px] text-emerald-300/80 hover:underline whitespace-nowrap">Filter Valid</span>
            </div>
          </div>
          <CheckCircle className="text-emerald-400 shrink-0" size={17} />
        </div>

        <div
          onClick={() => setVehicleStatusFilter('IN_TRANSIT')}
          className="bg-slate-900/75 hover:bg-slate-800/80 px-3 py-2 rounded-xl border border-white/10 flex items-center justify-between gap-2 cursor-pointer transition-colors"
        >
          <div className="min-w-0">
            <span className="text-gray-400 text-[11px] font-medium block truncate">In Transit</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-white font-mono tabular-nums">{vehiclesOnWay.length}</span>
              <span className="text-[10.5px] text-blue-400 hover:underline whitespace-nowrap">Active Routes</span>
            </div>
          </div>
          <Truck className="text-blue-400 shrink-0" size={17} />
        </div>

        <div
          onClick={() => setVehicleStatusFilter('EXPIRY_SOON')}
          className="bg-slate-900/75 hover:bg-slate-800/80 px-3 py-2 rounded-xl border border-white/10 flex items-center justify-between gap-2 cursor-pointer transition-colors"
        >
          <div className="min-w-0">
            <span className="text-gray-400 text-[11px] font-medium block truncate">Expiry Soon (30d)</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-amber-400 font-mono tabular-nums">{vehiclesExpiringSoon.length}</span>
              <span className="text-[10.5px] text-amber-300 hover:underline whitespace-nowrap">Filter Due</span>
            </div>
          </div>
          <Clock className="text-amber-400 shrink-0" size={17} />
        </div>

        <div className="bg-slate-900/75 px-3 py-2 rounded-xl border border-white/10 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-gray-400 text-[11px] font-medium block truncate">Expired (6M Rule)</span>
            <div className="flex items-baseline gap-1.5 mt-0.5 flex-wrap">
              <span className="text-lg font-bold text-rose-400 font-mono tabular-nums">{vehiclesExpired.length}</span>
              <button onClick={() => setVehicleStatusFilter('EXPIRED')} className="text-[10.5px] text-rose-300 hover:underline whitespace-nowrap">
                Filter
              </button>
              <span className="text-gray-600 text-[10px]">·</span>
              <button 
                onClick={handleSelectAllExpiredVehicles} 
                className="text-[10.5px] text-blue-400 hover:underline whitespace-nowrap font-medium"
                title="Select all expired vehicles and open Renewal Letter generator"
              >
                Renewal
              </button>
            </div>
          </div>
          <AlertTriangle className="text-rose-400 shrink-0" size={17} />
        </div>

        <div
          onClick={() => setVehicleStatusFilter('ALL')}
          className="bg-slate-900/75 hover:bg-slate-800/80 px-3 py-2 rounded-xl border border-white/10 flex items-center justify-between gap-2 cursor-pointer transition-colors"
        >
          <div className="min-w-0">
            <span className="text-gray-400 text-[11px] font-medium block truncate">Total Registered</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-brand-400 font-mono tabular-nums">{vehicles.length}</span>
              <span className="text-[10.5px] text-gray-400 whitespace-nowrap">View All</span>
            </div>
          </div>
          <Search className="text-brand-400 shrink-0" size={17} />
        </div>
      </div>

      {/* Unified Fleet Vehicles Workspace Card (Single-Line Rows, Tight Columns, Zero Horizontal Scroll) */}
      <div className="glass-card rounded-xl border border-white/10 overflow-hidden w-full max-w-full min-w-0">
        {/* Card Header: Title + Search + Integrated Filter Bar */}
        <div className="px-3 py-2 border-b border-white/10 space-y-1.5 bg-slate-900/85">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <h3 className="text-white text-sm font-semibold flex items-center gap-1.5">
              <Truck size={15} className="text-brand-400 shrink-0" /> 
              <span>Fleet Vehicles</span>
              <span className="text-xs font-mono tabular-nums text-gray-400">({filteredVehicles.length})</span>
              {vehicleStatusFilter !== 'ALL' && (
                <span className="text-[11px] text-brand-300 font-medium">
                  · {vehicleStatusFilter.replace('_', ' ')}
                </span>
              )}
            </h3>
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
                <input
                  type="text"
                  placeholder="Search plate, chassis, transporter..."
                  className="glass-input rounded-lg pl-8 pr-7 py-1 text-xs outline-none w-full"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    title="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setVehicleStatusFilter('ALL');
                  setSearchQuery('');
                }}
                className="px-2 py-1 bg-white/5 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
                title="Reset Filters"
              >
                <Filter size={12} />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Integrated Compact Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1">
            {[
              { id: 'ALL', label: 'All', count: statusCounts.ALL },
              { id: 'ACTIVE', label: 'Active (Valid)', count: statusCounts.ACTIVE },
              { id: 'IN_TRANSIT', label: 'In Transit', count: statusCounts.IN_TRANSIT },
              { id: 'EXPIRED', label: 'Expired', count: statusCounts.EXPIRED },
              { id: 'EXPIRY_SOON', label: 'Expiry Soon', count: statusCounts.EXPIRY_SOON },
              { id: 'TIR', label: 'TIR', count: statusCounts.TIR },
              { id: 'AFGHAN_TRANSIT', label: 'Afghan Transit', count: statusCounts.AFGHAN_TRANSIT },
              { id: 'BLACKLIST', label: 'Blacklist', count: statusCounts.BLACKLIST },
              { id: 'UPDATE_PENDING', label: 'Docs Pending', count: statusCounts.UPDATE_PENDING },
            ].map((tab, tIdx) => {
              const isActive = vehicleStatusFilter === tab.id;
              return (
                <button
                  key={`veh_subtab_${tab.id}_${tIdx}`}
                  type="button"
                  onClick={() => setVehicleStatusFilter(tab.id as VehicleStatusSubTab)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    isActive 
                      ? 'bg-brand-600 text-white shadow-sm' 
                      : 'text-gray-400 hover:text-white hover:bg-white/5 bg-white/[0.02]'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`font-mono tabular-nums text-[10px] ${
                    isActive ? 'text-white/90 font-bold' : tab.id === 'ACTIVE' ? 'text-emerald-400 font-semibold' : 'text-gray-500'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bulk Selection Action Bar */}
        {selectedVehicleIds.length > 0 && (
          <div className="bg-slate-900 border-b border-blue-500/30 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono tabular-nums font-bold text-xs border border-blue-500/30">
                {selectedVehicleIds.length}
              </span>
              <span className="text-xs font-semibold text-white">
                Selected — Generate Word (.docx):
              </span>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setDocsModalType('REG_LETTER');
                  setShowDocsModal(true);
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
              >
                Letter 10
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocsModalType('CUSTOMS_PERMIT');
                  setShowDocsModal(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
              >
                Custom List
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocsModalType('LEASE_AGREEMENT');
                  setShowDocsModal(true);
                }}
                className="bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
              >
                Lease TAS-582
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocsModalType('AFFIDAVIT');
                  setShowDocsModal(true);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
              >
                Affidavit
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocsModalType('LEASE_TERMINATION');
                  setShowDocsModal(true);
                }}
                className="bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
              >
                Termination
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocsModalType('CANCELLATION_NOC');
                  setShowDocsModal(true);
                }}
                className="bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
              >
                NOC
              </button>
              <button
                type="button"
                onClick={() => setShowDocsModal(true)}
                className="bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium px-2 py-0.5 rounded whitespace-nowrap"
              >
                All Docs
              </button>
              <button
                type="button"
                onClick={() => setSelectedVehicleIds([])}
                className="text-gray-400 hover:text-white text-[11px] px-2 py-0.5 rounded hover:bg-white/5 whitespace-nowrap"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Mobile View (Compact Single-Row Cards) */}
        <div className="block md:hidden touch-pan-y">
          <VirtualizedList
            items={filteredVehicles}
            itemHeight={64}
            maxHeight={650}
            getItemKey={(v, idx) => `veh_mob_${v.id || idx}_${idx}`}
            emptyPlaceholder={
              <div className="p-8 text-center text-gray-500 text-xs">No vehicles found in {vehicleStatusFilter} category.</div>
            }
            renderItem={(v) => {
              const validity = getVehicleValidity(v);
              const isTruckit = v.operatingCompany === 'truckit' || (v.companyName || '').toUpperCase().includes('TRUCKIT');
              const compLabel = isTruckit ? 'TRUCKIT' : v.operatingCompany === 'muhib' ? 'MUHIB' : v.operatingCompany === 'vantage' ? 'VANTAGE' : 'DOCKS';
              return (
                <div
                  onClick={() => setSelectedVehicle(v)}
                  className="px-2.5 py-1.5 hover:bg-white/5 transition-colors border-b border-white/5 cursor-pointer flex flex-col justify-center h-full"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectVehicle(v.id);
                        }}
                        className="text-gray-400 hover:text-white shrink-0"
                      >
                        {selectedVehicleIds.includes(v.id) ? (
                          <CheckSquare size={14} className="text-blue-400" />
                        ) : (
                          <Square size={14} className="text-gray-600" />
                        )}
                      </button>
                      <span className="font-mono font-bold text-white text-xs tabular-nums shrink-0">{v.registrationNumber}</span>
                      <span className={`text-[10px] font-semibold uppercase shrink-0 ${isTruckit ? 'text-cyan-300' : 'text-amber-300'}`}>
                        {compLabel}
                      </span>
                      <span className="text-[11px] text-gray-400 truncate">
                        · {v.transporterName || v.brokerName || 'Direct'}
                      </span>
                    </div>
                    <span className={`text-[10.5px] font-semibold shrink-0 ${
                      v.status === 'CANCELLED' ? 'text-gray-400' : validity.text === 'Expired' ? 'text-rose-400' : validity.text === 'Expiry Soon' ? 'text-amber-400' : 'text-emerald-400'
                    }`}>
                      {v.status === 'CANCELLED' ? 'Cancelled' : validity.text}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[10px] font-mono text-gray-400 truncate">
                      {v.registrationDate || 'No Reg Date'} · {v.registrationBook ? '✓RB' : '✗RB'} {v.ownerIdCardUrl ? '✓ID' : '✗ID'}
                    </span>
                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVehicle(v);
                          setShowAddVehicle(true);
                        }}
                        className="bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/30 text-cyan-300 hover:text-white px-2 py-0.5 rounded text-[10.5px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <Settings size={10} />
                        <span>Edit / Docs</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            }}
          />
        </div>

        {/* Desktop View: Single-Line 34px Rows (Matching Vehicle No Font Height) & Tightly Packed Adjacent Columns */}
        <div className="hidden md:block w-full max-w-full min-w-0 overflow-x-hidden">
          <VirtualizedTable<Vehicle>
            items={filteredVehicles}
            rowHeight={34}
            maxHeight={700}
            disableHorizontalScroll={true}
            headerCellClassName="px-1.5"
            onRowClick={(v) => setSelectedVehicle(v)}
            getItemKey={(v, idx) => `veh_row_${v.id || idx}_${idx}`}
            columns={[
              {
                header: (
                  <button
                    type="button"
                    onClick={toggleSelectAllFiltered}
                    className="text-gray-400 hover:text-white transition-colors flex items-center justify-center mx-auto"
                    title={isAllFilteredSelected ? "Deselect all in view" : "Select all in view"}
                  >
                    {isAllFilteredSelected ? (
                      <CheckSquare size={14} className="text-blue-400" />
                    ) : (
                      <Square size={14} className="text-gray-500 hover:text-gray-300" />
                    )}
                  </button>
                ),
                width: '3%',
                className: 'text-center'
              },
              { header: 'Vehicle No', width: '11.5%' },
              { header: 'Company', width: '9.5%' },
              { header: 'Make / Model', width: '12%' },
              { header: 'Chassis / Engine', width: '17%' },
              { header: 'Transporter', width: '17%' },
              { header: 'Docs', width: '8%' },
              { header: 'Validity (6M)', width: '13%' },
              { header: 'Action', width: '9%', className: 'text-right' }
            ]}
            emptyPlaceholder={
              <div className="p-8 text-center text-gray-500 text-xs">
                No vehicles found matching current filter ({vehicleStatusFilter}).
              </div>
            }
            renderRow={(v) => {
              const validity = getVehicleValidity(v);
              const isTruckit = v.operatingCompany === 'truckit' || (v.companyName || '').toUpperCase().includes('TRUCKIT');
              const compactComp = isTruckit
                ? 'TRUCKIT'
                : v.operatingCompany === 'muhib'
                ? 'MUHIB'
                : v.operatingCompany === 'vantage'
                ? 'VANTAGE'
                : 'DOCKS';
              const fullComp = v.companyName || (isTruckit ? 'TRUCKIT PVT LTD' : 'DOCKS PVT LTD');
              const makeModelStr = [v.make, v.model].filter(Boolean).join(' ') || v.makeModel || v.category || 'Bonded';
              const tripsCount = v.tripsHistory?.length || 0;
              const isExpiredOrDue = v.status !== 'CANCELLED' && (validity.text === 'Expired' || validity.text === 'Expiry Soon');

              return (
                <>
                  {/* Col 1: Checkbox (3%) */}
                  <div
                    className="px-1 flex items-center justify-center"
                    style={{ width: '3%', flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelectVehicle(v.id)}
                      className="text-gray-400 hover:text-white transition-colors flex items-center justify-center"
                      title={selectedVehicleIds.includes(v.id) ? "Deselect vehicle" : "Select vehicle"}
                    >
                      {selectedVehicleIds.includes(v.id) ? (
                        <CheckSquare size={14} className="text-blue-400" />
                      ) : (
                        <Square size={14} className="text-gray-600 hover:text-gray-400" />
                      )}
                    </button>
                  </div>

                  {/* Col 2: Vehicle Registration No (11.5%) */}
                  <div
                    className="px-1.5 min-w-0 truncate font-mono font-bold text-[13px] leading-none text-white tabular-nums"
                    style={{ width: '11.5%', flexShrink: 0 }}
                    title={`${v.registrationNumber}${tripsCount > 0 ? ` (${tripsCount} Trips)` : ''}`}
                  >
                    {v.registrationNumber}
                  </div>

                  {/* Col 3: Company (9.5%) */}
                  <div
                    className={`px-1.5 min-w-0 truncate text-[11px] font-semibold uppercase leading-none ${
                      isTruckit ? 'text-cyan-300' : 'text-amber-300'
                    }`}
                    style={{ width: '9.5%', flexShrink: 0 }}
                    title={fullComp}
                  >
                    {compactComp}
                  </div>

                  {/* Col 4: Make / Model (12%) */}
                  <div
                    className="px-1.5 min-w-0 truncate text-xs font-medium text-gray-200 leading-none"
                    style={{ width: '12%', flexShrink: 0 }}
                    title={makeModelStr}
                  >
                    {makeModelStr}
                  </div>

                  {/* Col 5: Chassis / Engine (17%) */}
                  <div
                    className="px-1.5 min-w-0 truncate font-mono tabular-nums text-[11px] text-gray-300 leading-none"
                    style={{ width: '17%', flexShrink: 0 }}
                    title={`Chassis: ${v.chassisNo || 'N/A'} | Engine: ${v.engineNo || 'N/A'}`}
                  >
                    {v.chassisNo || '-'} <span className="text-gray-600">/</span> {v.engineNo || '-'}
                  </div>

                  {/* Col 6: Transporter / Broker (17%) */}
                  <div
                    className="px-1.5 min-w-0 truncate text-xs font-medium text-gray-100 leading-none"
                    style={{ width: '17%', flexShrink: 0 }}
                    title={`Transporter / Broker: ${v.transporterName || v.brokerName || 'Direct Transporter'}${v.driverName ? ` | Driver: ${v.driverName}` : ''}`}
                  >
                    {v.transporterName || v.brokerName || 'Direct'}
                  </div>

                  {/* Col 7: Compliance Docs (8%) */}
                  <div
                    className="px-1.5 min-w-0 truncate font-mono text-[10.5px] leading-none whitespace-nowrap"
                    style={{ width: '8%', flexShrink: 0 }}
                    title={`Reg Book: ${v.registrationBook ? 'Uploaded' : 'Missing'} | Owner ID: ${v.ownerIdCardUrl ? 'Uploaded' : 'Missing'}${tripsCount > 0 ? ` | Trips: ${tripsCount}` : ''}`}
                  >
                    <span className={v.registrationBook ? 'text-emerald-400 font-semibold' : 'text-rose-400'}>
                      {v.registrationBook ? '✓RB' : '✗RB'}
                    </span>
                    <span className="text-gray-600 mx-0.5">·</span>
                    <span className={v.ownerIdCardUrl ? 'text-emerald-400 font-semibold' : 'text-rose-400'}>
                      {v.ownerIdCardUrl ? '✓ID' : '✗ID'}
                    </span>
                  </div>

                  {/* Col 8: Validity & Date (13%) */}
                  <div
                    className="px-1.5 min-w-0 truncate leading-none flex items-center gap-1 whitespace-nowrap"
                    style={{ width: '13%', flexShrink: 0 }}
                    onClick={(e) => {
                      if (isExpiredOrDue) {
                        e.stopPropagation();
                        setRenewalModalVehicle(v);
                      }
                    }}
                    title={
                      isExpiredOrDue
                        ? `Click to Renew 6-Month Validity | Reg: ${v.registrationDate || 'None'} | Exp: ${v.validationExpiryDate || 'Expired'}`
                        : `Reg: ${v.registrationDate || 'N/A'} | Exp: ${v.validationExpiryDate || 'N/A'}`
                    }
                  >
                    <span
                      className={`text-[11px] font-semibold shrink-0 ${
                        v.status === 'CANCELLED'
                          ? 'text-gray-400'
                          : validity.text === 'Expired'
                          ? 'text-rose-400 hover:underline'
                          : validity.text === 'Expiry Soon'
                          ? 'text-amber-400 hover:underline'
                          : 'text-emerald-400'
                      }`}
                    >
                      {v.status === 'CANCELLED' ? 'Canc' : validity.text === 'Expiry Soon' ? 'Soon' : validity.text}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-gray-400 truncate">
                      {v.registrationDate ? v.registrationDate.slice(2) : 'No Date'}
                    </span>
                  </div>

                  {/* Col 9: Single Action Button — Edit / Docs (9%) */}
                  <div
                    className="px-1.5 flex items-center justify-end whitespace-nowrap min-w-0"
                    style={{ width: '9%', flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setEditingVehicle(v);
                        setShowAddVehicle(true);
                      }}
                      className="bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/30 text-cyan-300 hover:text-white transition-colors px-2 h-[22px] rounded text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      title="Update Vehicle & Documents"
                    >
                      <Settings size={11} />
                      <span>Edit / Docs</span>
                    </button>
                  </div>
                </>
              );
            }}
          />
        </div>
      </div>
    </div>
  );

  // --- Main Render ---

  return (
    <div className="space-y-4 pb-10 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* Compact Single-Row Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Truck className="text-brand-400" size={20} /> Vehicle Management System
        </h2>
        
        <div className="flex flex-wrap gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
          <button 
            onClick={() => setActiveTab('vehicles')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${activeTab === 'vehicles' ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
          >
            <Truck size={14} /> Fleet & Vehicles
          </button>
          <button 
            onClick={() => setActiveTab('transporters')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${activeTab === 'transporters' ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
          >
            <User size={14} /> Transporters & Brokers
          </button>
          <button 
            onClick={() => setActiveTab('ready_vehicles')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${activeTab === 'ready_vehicles' ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
          >
            <MapPin size={14} /> Available Fleet
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className={`px-4 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
          statusBanner.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : statusBanner.type === 'error'
            ? 'bg-red-500/10 border-red-500/30 text-red-300'
            : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200'
        }`}>
          <div className="flex items-center gap-2">
            {statusBanner.type === 'success' ? <CheckCircle size={15} className="shrink-0" /> : <AlertCircle size={15} className="shrink-0" />}
            <span>{statusBanner.message}</span>
          </div>
          <button type="button" onClick={() => setStatusBanner(null)} className="text-gray-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Transporter Incoming Requests Desk */}
      {transporterRequests.filter(r => r.status === 'PENDING').length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Clock size={18} className="animate-spin" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Transporter Requests Desk</span>
                  <span className="bg-amber-500/20 text-amber-300 text-xs px-2 py-0.5 rounded-full font-mono">
                    {transporterRequests.filter(r => r.status === 'PENDING').length} Pending
                  </span>
                </h4>
                <p className="text-xs text-gray-400">
                  New vehicle registrations, renewals, and cancellation requests submitted by transporters
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {transporterRequests.filter(r => r.status === 'PENDING').map((req, idx) => (
              <div key={`req_card_${req.id || idx}_${idx}`} className="bg-slate-900 p-3.5 rounded-xl border border-white/10 space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-mono font-bold text-white text-sm">{req.vehicleNo}</span>
                  <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold">
                    {req.type.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-gray-400 text-[11px] space-y-0.5">
                  <p>🏢 Transporter: <span className="text-gray-200">{req.transporterName}</span></p>
                  {req.reason && <p>💬 Reason: <span className="text-gray-300">{req.reason}</span></p>}
                  {req.vehicleData && (
                    <p>🚚 Make/Model: <span className="text-gray-300">{req.vehicleData.make} ({req.vehicleData.model})</span></p>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => handleRejectTransporterRequest(req)}
                    className="px-2.5 py-1 text-red-400 hover:bg-red-500/10 rounded border border-red-500/30"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApproveTransporterRequest(req)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold shadow"
                  >
                    Approve Request
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Area */}
      {activeTab === 'vehicles' && renderVehiclesSection()}
      {activeTab === 'transporters' && renderTransportersSection()}
      {activeTab === 'ready_vehicles' && <AvailableVehiclesView userRole="VEHICLE_MANAGER" />}

      {/* Add Transporter Modal */}
      {showAddTransporter && (
        <AddTransporterModal onClose={() => setShowAddTransporter(false)} onSave={handleAddTransporter} />
      )}

      {/* Add / Edit Vehicle Modal */}
      {showAddVehicle && (
        <AddVehicleModal 
          transporters={transporters} 
          preSelectedTransporterId={preSelectedTransporterId}
          initialVehicle={editingVehicle}
          existingMraList={Array.from(new Set(vehicles.map(v => (v.mra || '').trim()).filter(Boolean)))}
          allCases={allCases}
          allDrivers={allDrivers}
          onClose={() => {
            setShowAddVehicle(false);
            setEditingVehicle(null);
          }} 
          onSave={handleAddVehicle} 
        />
      )}

      {/* Vehicle Profile Modal */}
      {selectedVehicle && (
        <VehicleProfileModal 
          vehicle={selectedVehicle} 
          allCases={allCases}
          allDrivers={allDrivers}
          onClose={() => setSelectedVehicle(null)} 
          onEditVehicle={(v) => {
            setEditingVehicle(v);
            setShowAddVehicle(true);
          }}
          onRenewVehicle={(v) => {
            setRenewalModalVehicle(v);
          }}
          onCancelVehicle={(v) => {
            setSelectedVehicle(null);
            setVehicleToCancel(v);
            setCancellationReason('Operational De-Registration & Contract Release');
          }}
        />
      )}

      {/* ========================================================= */}
      {/* VEHICLE CANCELLATION CONFIRMATION & AUTO NOC MODAL (SRS) */}
      {/* ========================================================= */}
      {vehicleToCancel && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-start justify-center pt-8 sm:pt-14 p-4 overflow-y-auto z-50 animate-in fade-in duration-200">
          <div className="glass-card p-6 sm:p-7 rounded-3xl w-full max-w-lg border border-red-500/30 shadow-2xl space-y-5 bg-slate-950/95">
            {/* Modal Header */}
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                <AlertTriangle size={26} />
              </div>
              <div>
                <span className="text-[11px] font-mono uppercase tracking-widest text-red-400 font-bold">Action Required</span>
                <h3 className="text-xl font-bold text-white mt-0.5">Cancel Vehicle</h3>
                <p className="text-xs text-gray-400 mt-1">
                  Are you sure you want to cancel and de-register this vehicle from the active customs bonded fleet?
                </p>
              </div>
            </div>

            {/* Vehicle Summary Card */}
            <div className="bg-white/5 p-4 rounded-2xl border border-white/10 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Registration Number:</span>
                <span className="font-mono font-bold text-white text-sm bg-white/10 px-2 py-0.5 rounded">{vehicleToCancel.registrationNumber}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">{activeCompany?.shortName || getActiveCompanyPrefix()} Fleet Serial:</span>
                <span className="font-mono text-brand-400">{vehicleToCancel.dplSerial}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Transporter:</span>
                <span className="text-white font-medium">{vehicleToCancel.transporterName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Category:</span>
                <span className="text-gray-200">{vehicleToCancel.category} • {vehicleToCancel.type}</span>
              </div>
            </div>

            {/* Reason for Cancellation Input */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                Reason for De-registration / NOC
              </label>
              <input
                type="text"
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="e.g. Contract completed, sold, or maintenance retirement"
                className="w-full bg-black/50 border border-white/20 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-red-500"
              />
            </div>

            {/* Automatic NOC Generation Notice */}
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2.5 text-xs text-red-200">
              <ShieldCheck size={18} className="text-red-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Automatic NOC Generation:</strong> Upon confirmation, this vehicle will be immediately de-registered and the official No Objection Certificate (NOC) document will be generated and downloaded.
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setVehicleToCancel(null)}
                disabled={isCancellingVehicle}
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
              >
                Abort
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelVehicle}
                disabled={isCancellingVehicle}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/30 flex items-center gap-2 transition-all hover:scale-102"
              >
                {isCancellingVehicle ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    <span>Generating NOC...</span>
                  </>
                ) : (
                  <>
                    <Ban size={15} />
                    <span>Confirm & Generate NOC</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOC Notification Banner */}
      {nocSuccessNotice && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md bg-slate-900 border border-emerald-500/40 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle size={20} />
            </div>
            <div className="flex-1 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-bold text-white">Vehicle Cancelled & NOC Ready!</span>
                <button onClick={() => setNocSuccessNotice(null)} className="text-gray-400 hover:text-white">
                  <X size={15} />
                </button>
              </div>
              <p className="text-gray-300 mt-1">
                Vehicle <strong className="text-white font-mono">{nocSuccessNotice.vehicleNo}</strong> de-registered. NOC Ref: <strong className="text-emerald-400 font-mono">{nocSuccessNotice.nocRef}</strong>
              </p>
              <div className="flex flex-wrap gap-2 mt-2.5">
                {nocSuccessNotice.downloadUrl && (
                  <>
                    <a
                      href={nocSuccessNotice.downloadUrl}
                      download={nocSuccessNotice.filename || 'Vehicle_NOC.pdf'}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 text-[11px]"
                    >
                      <Download size={13} /> NOC PDF
                    </a>
                    <button
                      type="button"
                      onClick={() => setIsNocViewerOpen(true)}
                      className="bg-white/10 hover:bg-white/20 text-white font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 text-[11px]"
                    >
                      <Eye size={13} /> View PDF
                    </button>
                  </>
                )}
                {nocSuccessNotice.cancelledVehicle && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDownloadNocDocx(nocSuccessNotice.cancelledVehicle!)}
                      className="bg-sky-600 hover:bg-sky-500 text-white font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-[11px]"
                      title="Download Official Vehicle NOC in Word format (.docx)"
                    >
                      <FileText size={13} /> NOC (.docx)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadStampPaperTerminationDocx(nocSuccessNotice.cancelledVehicle!)}
                      className="bg-amber-600 hover:bg-amber-500 text-white font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-[11px]"
                      title="Download Lease Termination on Legal Stamp Paper (.docx)"
                    >
                      <FileText size={13} /> Stamp Paper (.docx)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadLetterheadCancellationDocx(nocSuccessNotice.cancelledVehicle!)}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-[11px]"
                      title="Download Customs Cancellation Notice on Company Letterhead (.docx)"
                    >
                      <FileText size={13} /> Customs Notice (.docx)
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NOC PDF Viewer Modal */}
      {nocSuccessNotice?.downloadUrl && (
        <PdfViewerModal
          isOpen={isNocViewerOpen}
          onClose={() => setIsNocViewerOpen(false)}
          pdfUrl={nocSuccessNotice.downloadUrl}
          filename={nocSuccessNotice.filename || 'Vehicle_NOC.pdf'}
          title="Vehicle De-registration NOC"
        />
      )}

      {/* Bulk Excel / CSV Import Modal */}
      <BulkVehicleImportModal
        isOpen={showBulkUploadModal}
        onClose={() => setShowBulkUploadModal(false)}
        onImport={handleImportParsedVehicles}
        transporters={transporters}
      />

      {/* Vehicle Online at Station Modal */}
      <VehicleOnlineModal
        isOpen={Boolean(onlineModalVehicle)}
        vehicle={onlineModalVehicle}
        onClose={() => setOnlineModalVehicle(null)}
        onConfirm={handleConfirmOnline}
      />

      {/* Vehicle 6-Month Renewal Modal */}
      <VehicleRenewalModal
        isOpen={Boolean(renewalModalVehicle)}
        vehicle={renewalModalVehicle}
        onClose={() => setRenewalModalVehicle(null)}
        onConfirmRenewal={handleConfirmRenewal}
      />

      {/* Official Customs & Legal Word Documents (.docx) Modal */}
      <OfficialDocumentsModal
        isOpen={showDocsModal}
        onClose={() => setShowDocsModal(false)}
        vehicles={vehicles}
        preSelectedIds={selectedVehicleIds}
        initialDocType={docsModalType}
      />

      {/* Admin Approval Request Modal for Vehicle Deletion / Cancellation */}
      {showVehicleApprovalModal && approvalTargetVehicle && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center pt-8 sm:pt-14 p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="glass-card p-6 rounded-2xl w-full max-w-lg border border-amber-500/30 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-amber-400 font-bold text-base">
                <ShieldCheck size={20} className="text-amber-400" />
                <span>Super Admin Approval Required</span>
              </div>
              <button onClick={() => setShowVehicleApprovalModal(false)} className="text-gray-400 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200 space-y-1">
              <p className="font-semibold text-white">Vehicle: {approvalTargetVehicle.registrationNumber} ({approvalTargetVehicle.brokerName || 'Direct'})</p>
              <p className="text-gray-300 leading-relaxed">
                Modifying, canceling or deleting active fleet records requires authorization from the Administrator. An approval notification will be dispatched to the Super Admin.
              </p>
            </div>

            {approvalModalError && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>{approvalModalError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300 block">
                Reason for {approvalVehicleAction} *
              </label>
              <textarea
                rows={3}
                placeholder={`Explain why you need to ${approvalVehicleAction.toLowerCase()} vehicle ${approvalTargetVehicle.registrationNumber}...`}
                value={approvalVehicleReason}
                onChange={(e) => setApprovalVehicleReason(e.target.value)}
                className="w-full bg-black/40 border border-white/15 rounded-xl p-3 text-white text-xs sm:text-sm outline-none focus:border-amber-400 placeholder:text-gray-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowVehicleApprovalModal(false)}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm text-gray-300 hover:text-white hover:bg-white/5 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!approvalVehicleReason.trim() || isSubmittingVehicleApproval}
                onClick={handleSubmitVehicleApproval}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition shadow-lg shadow-amber-600/30 flex items-center gap-1.5"
              >
                {isSubmittingVehicleApproval ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                <span>Submit for Approval</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Universal Read-Only Document Preview Modal (.docx / .pdf / .jpg / .jpeg / .xlsx) */}
      <UniversalDocumentPreviewModal
        isOpen={universalPreviewState.isOpen}
        onClose={() => setUniversalPreviewState(prev => ({ ...prev, isOpen: false }))}
        file={universalPreviewState.file}
        filename={universalPreviewState.filename}
        title={universalPreviewState.title}
        fileType={universalPreviewState.fileType || 'auto'}
        verificationItems={universalPreviewState.verificationItems}
        onDownload={universalPreviewState.onDownload}
      />
    </div>
  );
};

// --- Sub-Components (Modals) ---

const AddTransporterModal = ({ onClose, onSave }: any) => {
  const [formData, setFormData] = useState({
    name: '',
    representativeName: '',
    accountantName: '',
    contact: '',
    landline: '',
    email: '',
    address: '',
    cnicDoc: '',
    ntnDoc: '',
    vehicleListDoc: ''
  });
  const [extractedVehicles, setExtractedVehicles] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleVehicleListUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsProcessing(true);
      // Data Extraction
      setTimeout(() => {
        const mockExtractedVehicles = [
          {
            registrationNumber: 'KHI-1234',
            engineNo: 'ENG-SCAN-001',
            chassisNo: 'CH-SCAN-001',
            registrationDate: '2023-01-15',
            ownerName: 'Abdul Rehman',
            ownerCnic: '42101-1234567-1',
            ownerAddress: 'House 123, Street 4, Karachi',
            type: VehicleType.FLATBED,
            size: '40ft',
            weightCapacity: '20-25 Ton',
            category: VehicleCategory.DOMESTIC
          },
          {
            registrationNumber: 'LHR-5678',
            engineNo: 'ENG-SCAN-002',
            chassisNo: 'CH-SCAN-002',
            registrationDate: '2023-02-20',
            ownerName: 'Muhammad Ali',
            ownerCnic: '42201-7654321-9',
            ownerAddress: 'Flat 5, Block A, Lahore',
            type: VehicleType.MAZDA,
            size: 'Loose',
            weightCapacity: '5-10 Ton',
            category: VehicleCategory.DOMESTIC
          }
        ];
        setExtractedVehicles(mockExtractedVehicles);
        setFormData(prev => ({ ...prev, vehicleListDoc: 'uploaded' }));
        setIsProcessing(false);
      }, 800);
      try { e.target.value = ''; } catch (_) {}
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-8 sm:pt-14 p-4 overflow-y-auto z-50">
      <div className="glass-card p-6 rounded-2xl w-full max-w-2xl border border-white/10 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <h3 className="text-xl font-bold text-white mb-4 sticky top-0 bg-slate-900/95 pb-4 border-b border-white/10 z-10 backdrop-blur-md">Add New Transporter</h3>
        
        <div className="flex flex-col gap-4 mb-6 mt-2">
          <input type="text" placeholder="Company Name" className="glass-input rounded p-2 text-white outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          <input type="text" placeholder="Representative Name" className="glass-input rounded p-2 text-white outline-none" value={formData.representativeName} onChange={e => setFormData({...formData, representativeName: e.target.value})} />
          <input type="text" placeholder="Accountant Name" className="glass-input rounded p-2 text-white outline-none" value={formData.accountantName} onChange={e => setFormData({...formData, accountantName: e.target.value})} />
          <input type="text" placeholder="Mobile Number" className="glass-input rounded p-2 text-white outline-none" value={formData.contact} onChange={e => setFormData({...formData, contact: e.target.value})} />
          <input type="text" placeholder="Landline Number" className="glass-input rounded p-2 text-white outline-none" value={formData.landline} onChange={e => setFormData({...formData, landline: e.target.value})} />
          <input type="email" placeholder="Email Address" className="glass-input rounded p-2 text-white outline-none" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
          <input type="text" placeholder="Office Address" className="w-full glass-input rounded p-2 text-white outline-none" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
           <div className="border border-dashed border-white/20 rounded p-4 text-center cursor-pointer hover:bg-white/5 relative">
              <input 
                type="file" 
                className="absolute inset-0 opacity-0 cursor-pointer" 
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      const processed = await compressAndPrepareFile(file);
                      if (processed.dataUrl) {
                        setFormData({...formData, cnicDoc: processed.dataUrl});
                      }
                    } catch (err) {
                      console.warn(err);
                    }
                  }
                  try { e.target.value = ''; } catch (_) {}
                }} 
              />
              <p className="text-sm text-brand-400 font-medium">{formData.cnicDoc ? 'CNIC Uploaded' : 'Upload ID Card'}</p>
           </div>
           <div className="border border-dashed border-white/20 rounded p-4 text-center cursor-pointer hover:bg-white/5 relative">
              <input 
                type="file" 
                className="absolute inset-0 opacity-0 cursor-pointer" 
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      const processed = await compressAndPrepareFile(file);
                      if (processed.dataUrl) {
                        setFormData({...formData, ntnDoc: processed.dataUrl});
                      }
                    } catch (err) {
                      console.warn(err);
                    }
                  }
                  try { e.target.value = ''; } catch (_) {}
                }} 
              />
              <p className="text-sm text-brand-400 font-medium">{formData.ntnDoc ? 'NTN Uploaded' : 'Upload NTN'}</p>
           </div>
           <div className="border border-dashed border-white/20 rounded p-4 text-center cursor-pointer hover:bg-white/5 relative">
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleVehicleListUpload} />
              <p className="text-sm text-brand-400 font-medium">
                {isProcessing ? 'Processing...' : formData.vehicleListDoc ? 'List Uploaded' : 'Upload Vehicle List'}
              </p>
           </div>
        </div>

        {/* Uploaded Files Ledger & Download links */}
        {(formData.cnicDoc || formData.ntnDoc) && (
          <div className="mb-6 p-4 bg-slate-900/90 rounded-xl border border-white/10 space-y-2">
            <h5 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
              <Download size={13} className="text-brand-400" />
              Uploaded Transporter Files Ledger
            </h5>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {formData.cnicDoc && formData.cnicDoc.startsWith('data:') && (
                <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-black/40 border border-white/5">
                  <span className="text-gray-200 font-medium">Transporter CNIC / ID Copy</span>
                  <button
                    type="button"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = formData.cnicDoc;
                      const ext = formData.cnicDoc.startsWith('data:application/pdf') ? '.pdf' : '.jpg';
                      link.download = `Transporter_CNIC${ext}`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="text-brand-400 hover:text-brand-300 font-bold hover:underline flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 px-2.5 py-1 rounded text-[10px]"
                  >
                    <Download size={11} /> Download
                  </button>
                </div>
              )}
              {formData.ntnDoc && formData.ntnDoc.startsWith('data:') && (
                <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-black/40 border border-white/5">
                  <span className="text-gray-200 font-medium">Transporter NTN Certificate</span>
                  <button
                    type="button"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = formData.ntnDoc;
                      const ext = formData.ntnDoc.startsWith('data:application/pdf') ? '.pdf' : '.jpg';
                      link.download = `Transporter_NTN${ext}`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="text-brand-400 hover:text-brand-300 font-bold hover:underline flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 px-2.5 py-1 rounded text-[10px]"
                  >
                    <Download size={11} /> Download
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {extractedVehicles.length > 0 && (
          <div className="mb-6 bg-white/5 rounded-xl p-4 border border-white/10">
            <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <CheckCircle size={14} className="text-green-400"/> Data Extracted Vehicles ({extractedVehicles.length})
            </h4>
            <div className="max-h-40 overflow-y-auto space-y-2 custom-scrollbar pr-2">
              {extractedVehicles.map((v, i) => (
                <div key={i} className="text-xs text-gray-300 bg-black/20 p-2 rounded flex justify-between">
                  <span>{v.registrationNumber} ({v.type})</span>
                  <span className="text-gray-500">Owner: {v.ownerName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
          <button 
            onClick={() => onSave(formData, extractedVehicles)} 
            className="bg-brand-600 text-white px-4 py-2 rounded-lg disabled:opacity-50"
            disabled={isProcessing}
          >
            Save Transporter & Vehicles
          </button>
        </div>
      </div>
    </div>
  );
};

const DEFAULT_VEHICLE_REGIONS = [
  'Balochistan',
  'Sindh',
  'Punjab',
  'Khyber Pakhtunkhwa (KPK)',
  'Islamabad (ICT)',
  'Gilgit-Baltistan',
  'Azad Jammu & Kashmir (AJK)',
  'Lasbela (Balochistan)',
  'Quetta (Balochistan)',
  'Karachi (Sindh)',
  'Lahore (Punjab)',
  'Peshawar (KPK)',
  'Haripur (KPK)'
];

const CUSTOM_REGIONS_STORAGE_KEY = 'dpl_custom_vehicle_regions_v1';

const AddVehicleModal = ({ transporters, preSelectedTransporterId, initialVehicle, existingMraList = [], allCases = [], allDrivers = [], onClose, onSave }: any) => {
  const [showDocScanner, setShowDocScanner] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<'SPEC' | 'REG_BOOK' | 'OWNER_ID'>('SPEC');
  const [showRegionDropdown, setShowRegionDropdown] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [generatingDocType, setGeneratingDocType] = useState<'REG_RENEWAL' | 'LEASE' | 'NOC' | null>(null);
  const [downloadingTripId, setDownloadingTripId] = useState<string | null>(null);
  const [docFeedback, setDocFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const todayIso = new Date().toISOString().split('T')[0];

  const [savedCustomRegions, setSavedCustomRegions] = useState<string[]>(() => {
    try {
      const raw = safeAppStorage.getItem(CUSTOM_REGIONS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((item: any) => String(item || '').trim()).filter(Boolean);
        }
      }
    } catch (_) {}
    return [];
  });

  const allRegionOptions = useMemo(() => {
    const seen = new Set<string>();
    const combined: string[] = [];
    [...DEFAULT_VEHICLE_REGIONS, ...savedCustomRegions, ...(Array.isArray(existingMraList) ? existingMraList : [])].forEach(item => {
      const clean = String(item || '').trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        combined.push(clean);
      }
    });
    return combined;
  }, [savedCustomRegions, existingMraList]);

  const persistCustomRegion = (rawVal: string) => {
    const clean = String(rawVal || '').trim();
    if (!clean) return;
    const existsInDefaults = DEFAULT_VEHICLE_REGIONS.some(r => r.toLowerCase() === clean.toLowerCase());
    const existsInCustom = savedCustomRegions.some(r => r.toLowerCase() === clean.toLowerCase());
    if (!existsInDefaults && !existsInCustom) {
      const updated = [...savedCustomRegions, clean];
      setSavedCustomRegions(updated);
      try {
        safeAppStorage.setItem(CUSTOM_REGIONS_STORAGE_KEY, JSON.stringify(updated));
      } catch (_) {}
    }
  };

  const [formData, setFormData] = useState<any>(() => {
    if (initialVehicle) {
      const syncedTrans = initialVehicle.transporterName || initialVehicle.brokerName || '';
      const initType = initialVehicle.type || VehicleType.FLATBED;
      const isSizedType = initType === VehicleType.FLATBED || initType === VehicleType.CONTAINER;
      const initSize = isSizedType
        ? (['20ft', '40ft', '45ft'].includes(initialVehicle.size) ? initialVehicle.size : '40ft')
        : (initialVehicle.size || 'Loose');
      return {
        ...initialVehicle,
        transporterId: initialVehicle.transporterId || preSelectedTransporterId || '',
        operatingCompany: initialVehicle.operatingCompany || 'truckit',
        companyName: initialVehicle.companyName || (initialVehicle.operatingCompany === 'docks' ? 'DOCKS PVT LTD' : 'TRUCKIT PVT LTD'),
        category: initialVehicle.category || VehicleCategory.BONDED_CARRIER,
        type: initType,
        size: initSize,
        registrationNumber: initialVehicle.registrationNumber || '',
        engineNo: initialVehicle.engineNo || '',
        chassisNo: initialVehicle.chassisNo || '',
        make: initialVehicle.make || initialVehicle.maker || '',
        model: initialVehicle.model || '',
        mra: initialVehicle.mra || '',
        transporterName: syncedTrans,
        brokerName: syncedTrans,
        ownerName: initialVehicle.ownerName || '',
        ownerCnic: initialVehicle.ownerCnic || '',
        ownerIdCardUrl: initialVehicle.ownerIdCardUrl || '',
        ownerIdCardName: initialVehicle.ownerIdCardName || '',
        registrationBook: initialVehicle.registrationBook || '',
        registrationBookName: initialVehicle.registrationBookName || '',
        registrationDate: initialVehicle.registrationDate || '',
        validationExpiryDate: initialVehicle.validationExpiryDate || '',
        driverName: initialVehicle.driverName || '',
        driverCnic: initialVehicle.driverCnic || '',
        driverContact: initialVehicle.driverContact || '',
        weightCapacity: initialVehicle.weightCapacity || ''
      };
    }
    return {
      transporterId: preSelectedTransporterId || '',
      operatingCompany: 'truckit',
      companyName: 'TRUCKIT PVT LTD',
      category: VehicleCategory.BONDED_CARRIER,
      type: VehicleType.FLATBED,
      size: '40ft',
      registrationNumber: '',
      engineNo: '',
      chassisNo: '',
      make: '',
      model: '',
      mra: '',
      transporterName: '',
      brokerName: '',
      ownerName: '',
      ownerCnic: '',
      ownerIdCardUrl: '',
      ownerIdCardName: '',
      registrationBook: '',
      registrationBookName: '',
      registrationDate: todayIso,
      validationExpiryDate: evaluateVehicleRegistrationValidity(todayIso).expiryDate,
      driverName: '',
      driverCnic: '',
      driverContact: '',
      validationStartDate: todayIso,
      weightCapacity: ''
    };
  });

  const [isExtracting, setIsExtracting] = useState(false);

  const handleOwnerIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev: any) => ({
          ...prev,
          ownerIdCardUrl: reader.result as string,
          ownerIdCardName: file.name
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRegBookUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev: any) => ({
          ...prev,
          registrationBook: reader.result as string,
          registrationBookName: file.name
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsExtracting(true);
      try {
        const ext = file.name.toLowerCase().split('.').pop() || '';
        if (['xlsx', 'xls', 'docx', 'csv', 'txt'].includes(ext)) {
          const result = await parseVehicleFile(file);
          if (result.rows.length > 0) {
            const first = result.rows[0];
            const syncedTrans = first.transporterName || first.brokerName || '';
            setFormData((prev: any) => ({
              ...prev,
              registrationNumber: first.registrationNumber || prev.registrationNumber,
              category: first.category || prev.category,
              type: first.type || prev.type,
              size: first.size || prev.size,
              make: first.make || prev.make,
              model: first.model || prev.model,
              mra: (first as any).mra || prev.mra,
              engineNo: first.engineNo !== 'N/A' ? (first.engineNo || prev.engineNo) : prev.engineNo,
              chassisNo: first.chassisNo !== 'N/A' ? (first.chassisNo || prev.chassisNo) : prev.chassisNo,
              registrationDate: first.registrationDate || prev.registrationDate,
              validationExpiryDate: first.validationExpiryDate || prev.validationExpiryDate,
              transporterName: syncedTrans || prev.transporterName,
              brokerName: syncedTrans || prev.brokerName,
              operatingCompany: first.operatingCompany || prev.operatingCompany,
              companyName: first.companyName || prev.companyName
            }));
            return;
          }
        }

        const extracted = await autoFillVehicleData(file);
        if (extracted && Object.keys(extracted).length > 0) {
          setFormData((prev: any) => ({
            ...prev,
            registrationNumber: extracted.registrationNumber || prev.registrationNumber,
            engineNo: extracted.engineNo || prev.engineNo,
            chassisNo: extracted.chassisNo || prev.chassisNo,
            driverName: extracted.driverName || prev.driverName,
            driverCnic: extracted.driverCnic || prev.driverCnic,
            weightCapacity: extracted.weightCapacity || prev.weightCapacity,
            category: extracted.category || prev.category
          }));
        }
      } catch (err) {
        console.warn("Vehicle document OCR notice:", err);
      } finally {
        setIsExtracting(false);
        try { e.target.value = ''; } catch (_) {}
      }
    }
  };

  const validityPreview = evaluateVehicleRegistrationValidity(formData.registrationDate, formData.validationExpiryDate);
  const resolvedExpiryDate = validityPreview.expiryDate || formData.validationExpiryDate || '';
  const requiresContainerOrTrailerSize =
    formData.type === VehicleType.FLATBED || formData.type === VehicleType.CONTAINER;

  const buildLiveVehicleRecord = (): Vehicle => {
    const cleanPlate = (formData.registrationNumber || '').trim().toUpperCase();
    const syncedTransporter = (formData.transporterName || formData.brokerName || 'Direct Transporter').trim();
    return {
      ...(initialVehicle || {}),
      id: initialVehicle?.id || getDeterministicVehicleId(cleanPlate || 'TEMP'),
      dplSerial: initialVehicle?.dplSerial || `${getActiveCompanyPrefix()}-0001`,
      registrationNumber: cleanPlate,
      category: formData.category || VehicleCategory.BONDED_CARRIER,
      type: formData.type || VehicleType.FLATBED,
      size: requiresContainerOrTrailerSize
        ? (['20ft', '40ft', '45ft'].includes(formData.size) ? formData.size : '40ft')
        : 'Loose',
      weightCapacity: formData.weightCapacity || '',
      engineNo: (formData.engineNo || '').trim().toUpperCase(),
      chassisNo: (formData.chassisNo || '').trim().toUpperCase(),
      make: (formData.make || '').trim().toUpperCase(),
      maker: (formData.make || formData.maker || '').trim().toUpperCase(),
      model: (formData.model || '').trim(),
      makeModel: [formData.make, formData.model].filter(Boolean).join(' '),
      mra: (formData.mra || '').trim(),
      ownerName: (formData.ownerName || '').trim() || undefined,
      ownerCnic: (formData.ownerCnic || '').trim() || undefined,
      registrationDate: formData.registrationDate || '',
      validationExpiryDate: resolvedExpiryDate,
      driverName: formData.driverName || 'Designated Driver',
      driverCnic: formData.driverCnic || '',
      driverContact: formData.driverContact || '',
      transporterId: Number(formData.transporterId) || 0,
      transporterName: syncedTransporter,
      brokerName: syncedTransporter,
      operatingCompany: formData.operatingCompany || 'truckit',
      companyName: formData.companyName || 'TRUCKIT PVT LTD',
      status: validityPreview.status,
      history: initialVehicle?.history || [],
      createdAt: initialVehicle?.createdAt || todayIso
    };
  };

  const handleGenerateModalDoc = async (docKind: 'REG_RENEWAL' | 'LEASE' | 'NOC') => {
    const cleanPlate = (formData.registrationNumber || '').trim().toUpperCase();
    if (!cleanPlate) {
      setDocFeedback({
        type: 'error',
        message: 'Please enter the Vehicle Registration Number first to generate official documents.'
      });
      return;
    }

    setGeneratingDocType(docKind);
    setDocFeedback(null);
    try {
      const liveVehicle = buildLiveVehicleRecord();
      const safePlateSlug = cleanPlate.replace(/\s+/g, '_');
      const effectiveDocDate = formData.registrationDate || todayIso;

      if (docKind === 'REG_RENEWAL') {
        const doc = await generateRegistrationRenewalLetterDocx([liveVehicle], {
          letterDate: effectiveDocDate,
          leaveLetterheadSpace: true
        });
        const filename = `Registration_Renewal_Letter_${safePlateSlug}_${formatDashDate(new Date())}.docx`;
        await downloadDocxBlob(doc, filename);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Registration / Renewal Letter (${cleanPlate}) in Word (.docx) format.`
        });
      } else if (docKind === 'LEASE') {
        const doc = await generateLeaseAgreementDocx([liveVehicle], {
          agreementDate: effectiveDocDate,
          leaveStampPaperSpace: true,
          customLessorName: formData.ownerName?.trim() || undefined,
          customCnic: formData.ownerCnic?.trim() || undefined
        });
        const filename = `Lease_Agreement_${safePlateSlug}_${formatDashDate(new Date())}.docx`;
        await downloadDocxBlob(doc, filename);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Lease Agreement (${cleanPlate}) for Stamp Paper in Word (.docx) format.`
        });
      } else if (docKind === 'NOC') {
        const doc = await generateVehicleNocDocx(liveVehicle, {
          nocDate: todayIso,
          leaveLetterheadSpace: true
        });
        const filename = `Vehicle_NOC_Letter_${safePlateSlug}_${formatDashDate(new Date())}.docx`;
        await downloadDocxBlob(doc, filename);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Official NOC Letter (${cleanPlate}) in Word (.docx) format.`
        });
      }
    } catch (err: any) {
      console.error('Document generation error inside modal:', err);
      setDocFeedback({
        type: 'error',
        message: `Failed to generate document: ${err?.message || 'Unexpected error'}`
      });
    } finally {
      setGeneratingDocType(null);
    }
  };

  const typedMraTrimmed = String(formData.mra || '').trim();
  const isCustomUnsavedMra =
    Boolean(typedMraTrimmed) &&
    !allRegionOptions.some(opt => opt.toLowerCase() === typedMraTrimmed.toLowerCase());

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-6 sm:pt-10 p-4 overflow-y-auto z-50">
      <div className="glass-card p-6 rounded-2xl w-full max-w-3xl border border-white/10 max-h-[92vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between sticky top-0 bg-slate-900/95 pb-4 border-b border-white/10 z-10 backdrop-blur-md">
          <div>
            <h3 className="text-xl font-bold text-white">
              {initialVehicle ? `Update Vehicle & Documents: ${initialVehicle.registrationNumber}` : 'Register New Fleet Vehicle'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Shared Vehicle Database across all companies • Transporter & Broker automatically synced • 6-Month Customs Validity
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5">
            <X size={20} />
          </button>
        </div>

        {formError && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0 text-rose-400" />
            <span>{formError}</span>
          </div>
        )}
        
        <div className="flex flex-col gap-4 mb-4 mt-4">
          {/* Row 1: Registered Company & Vehicle Registration Number */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-cyan-300 block mb-1 font-semibold">Registered Company *</label>
              <select 
                className="w-full glass-input rounded p-2 text-white outline-none bg-slate-900 border border-cyan-500/40 text-sm font-semibold"
                value={formData.operatingCompany || 'truckit'}
                onChange={e => {
                  const resolved = resolveVehicleCompany(e.target.value);
                  setFormData({
                    ...formData,
                    operatingCompany: resolved.operatingCompany,
                    companyName: resolved.companyName
                  });
                }}
              >
                <option value="truckit">TRUCKIT PVT LTD (Primary Active Fleet)</option>
                <option value="docks">DOCKS PVT LTD</option>
                <option value="muhib">MUHIB INTERNATIONAL</option>
                <option value="vantage">VANTAGE SHIPPING LINE</option>
              </select>
              <span className="text-[10px] text-gray-400 mt-0.5 block">
                Moving a Docks vehicle to Truckit updates the existing record (no duplicate).
              </span>
            </div>
            <div>
              <label className="text-xs text-gray-300 block mb-1 font-semibold">Vehicle No. (Registration Plate) *</label>
              <input 
                type="text" 
                placeholder="e.g. TMA-133 or JU-1929" 
                className="w-full glass-input rounded p-2 text-white font-mono font-bold uppercase tracking-wider" 
                value={formData.registrationNumber} 
                onChange={e => {
                  setFormError(null);
                  setFormData({...formData, registrationNumber: e.target.value.toUpperCase()});
                }} 
                required
              />
            </div>
          </div>

          {/* Row 2: Transporter Name & Broker Name (Automatically Identical) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/5 p-3 rounded-xl border border-white/10">
            <div>
              <label className="text-xs text-emerald-300 block mb-1 font-semibold">Transporter Name *</label>
              <input 
                type="text" 
                list="fleet-transporters-list"
                placeholder="e.g. TRUCKIT CARGO / AL-MADINA TRANSPORT" 
                className="w-full glass-input rounded p-2 text-white text-sm font-semibold" 
                value={formData.transporterName || formData.brokerName || ''} 
                onChange={e => {
                  const val = e.target.value;
                  setFormData({
                    ...formData,
                    transporterName: val,
                    brokerName: val
                  });
                }} 
              />
              <datalist id="fleet-transporters-list">
                {transporters.map((t: Transporter, tIdx: number) => (
                  <option key={`dl_trans_${t.id || tIdx}`} value={t.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Broker Name (Auto-Synced with Transporter)</label>
              <input 
                type="text" 
                readOnly
                placeholder="Auto-filled from Transporter Name" 
                className="w-full glass-input rounded p-2 text-emerald-300 text-sm bg-black/40 cursor-not-allowed font-semibold" 
                value={formData.transporterName || formData.brokerName || ''} 
              />
              <span className="text-[10px] text-gray-400 mt-0.5 block">Transporter and Broker names remain synchronized automatically.</span>
            </div>
          </div>

          {/* Row 3: Chassis No, Engine No, Maker, Model, & Registered In (Province / MRA) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Chassis No. *</label>
              <input 
                type="text" 
                placeholder="e.g. CV450BN-50039" 
                className="w-full glass-input rounded p-2 text-white font-mono text-xs uppercase" 
                value={formData.chassisNo} 
                onChange={e => setFormData({...formData, chassisNo: e.target.value.toUpperCase()})} 
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Engine No. *</label>
              <input 
                type="text" 
                placeholder="e.g. PE6-070941" 
                className="w-full glass-input rounded p-2 text-white font-mono text-xs uppercase" 
                value={formData.engineNo} 
                onChange={e => setFormData({...formData, engineNo: e.target.value.toUpperCase()})} 
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Maker (Make)</label>
              <input 
                type="text" 
                placeholder="e.g. NISSAN / HINO" 
                className="w-full glass-input rounded p-2 text-white text-xs uppercase font-semibold" 
                value={formData.make || ''} 
                onChange={e => setFormData({...formData, make: e.target.value.toUpperCase()})} 
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Model (Year)</label>
              <input 
                type="text" 
                placeholder="e.g. 1995 / 2018" 
                className="w-full glass-input rounded p-2 text-white font-mono text-xs" 
                value={formData.model || ''} 
                onChange={e => setFormData({...formData, model: e.target.value})} 
              />
            </div>
            <div className="relative">
              <label className="text-xs text-cyan-300 block mb-1 font-semibold">Registered In (MRA)</label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Select or type e.g. Balochistan"
                  className="w-full glass-input rounded p-2 pr-7 text-white text-xs font-semibold"
                  value={formData.mra || ''}
                  onFocus={() => setShowRegionDropdown(true)}
                  onBlur={() => {
                    if (formData.mra?.trim()) {
                      persistCustomRegion(formData.mra.trim());
                    }
                    setTimeout(() => setShowRegionDropdown(false), 180);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && formData.mra?.trim()) {
                      e.preventDefault();
                      persistCustomRegion(formData.mra.trim());
                      setShowRegionDropdown(false);
                    }
                  }}
                  onChange={e => {
                    setFormData({...formData, mra: e.target.value});
                    setShowRegionDropdown(true);
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={e => {
                    e.preventDefault();
                    setShowRegionDropdown(prev => !prev);
                  }}
                  className="absolute right-1.5 text-gray-400 hover:text-white p-0.5"
                  title="Select Registration Province / Authority"
                >
                  <ChevronDown size={14} />
                </button>
              </div>

              {showRegionDropdown && (
                <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl bg-slate-900 border border-white/15 shadow-2xl z-30 py-1 custom-scrollbar">
                  {isCustomUnsavedMra && (
                    <button
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        persistCustomRegion(typedMraTrimmed);
                        setFormData({...formData, mra: typedMraTrimmed});
                        setShowRegionDropdown(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/15 flex items-center gap-1.5 border-b border-white/10"
                    >
                      <Plus size={12} className="shrink-0" />
                      <span className="truncate">Save "{typedMraTrimmed}" to list</span>
                    </button>
                  )}
                  {allRegionOptions.map(regionOpt => (
                    <button
                      key={`reg_opt_${regionOpt}`}
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        setFormData({...formData, mra: regionOpt});
                        setShowRegionDropdown(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors flex items-center justify-between ${
                        (formData.mra || '').toLowerCase() === regionOpt.toLowerCase()
                          ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                          : 'text-gray-200 hover:bg-white/10'
                      }`}
                    >
                      <span className="truncate">{regionOpt}</span>
                      {(formData.mra || '').toLowerCase() === regionOpt.toLowerCase() && (
                        <CheckCircle size={11} className="text-cyan-400 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Row 4: Registration Section (Dates, Status & Official Document Generation) */}
          <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-amber-300 flex items-center gap-1.5">
                <Calendar size={15} /> Registration Section
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded text-[11px] font-semibold tabular-nums ${
                  validityPreview.isExpired
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                }`}>
                  {validityPreview.isExpired
                    ? (resolvedExpiryDate ? `Expired on ${resolvedExpiryDate}` : 'Expired (No Registration Date)')
                    : `Active — Expires on ${resolvedExpiryDate}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const evalNow = evaluateVehicleRegistrationValidity(todayIso);
                    setFormData({
                      ...formData,
                      registrationDate: todayIso,
                      lastRenewalDate: todayIso,
                      validationExpiryDate: evalNow.expiryDate
                    });
                  }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg shadow whitespace-nowrap shrink-0"
                >
                  Renew / Set Today (+6 Months)
                </button>
              </div>
            </div>

            {/* Explicit Registration & Expiry Dates Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-400">Registered Date:</span>
                <span className="font-mono font-semibold text-white tabular-nums">
                  {formData.registrationDate || 'Not Recorded'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-400">
                  {validityPreview.isExpired ? 'Expired Date:' : 'Will Expire On:'}
                </span>
                <span className={`font-mono font-semibold tabular-nums ${
                  validityPreview.isExpired ? 'text-rose-300' : 'text-emerald-300'
                }`}>
                  {resolvedExpiryDate
                    ? (validityPreview.isExpired ? `Expired on ${resolvedExpiryDate}` : `Expires on ${resolvedExpiryDate}`)
                    : 'Not Recorded (Expired)'}
                </span>
              </div>
            </div>

            {/* Date Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-gray-300 block mb-1">Registration / Last Renewal Date (Blank = Expired)</label>
                <input
                  type="date"
                  className="w-full glass-input rounded p-2 text-white text-xs font-mono tabular-nums"
                  value={formData.registrationDate || ''}
                  onChange={e => {
                    const regDate = e.target.value;
                    const evalRes = evaluateVehicleRegistrationValidity(regDate);
                    setFormData({
                      ...formData,
                      registrationDate: regDate,
                      validationExpiryDate: evalRes.expiryDate
                    });
                  }}
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-300 block mb-1">6-Month Customs Expiry Date (Auto-Calculated)</label>
                <input
                  type="date"
                  className="w-full glass-input rounded p-2 text-gray-300 text-xs font-mono tabular-nums bg-black/30"
                  value={resolvedExpiryDate}
                  onChange={e => setFormData({...formData, validationExpiryDate: e.target.value})}
                />
              </div>
            </div>

            {/* Integrated Official Document Generation */}
            <div className="pt-2.5 border-t border-white/10 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-xs font-semibold text-white">Generate Official Vehicle Documents (.docx)</span>
                <span className="text-[10.5px] text-gray-300">
                  New registration and 6-month renewal use the same official letter & documentation.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('REG_RENEWAL')}
                  className="bg-blue-600/25 hover:bg-blue-600/40 disabled:opacity-50 border border-blue-500/40 text-blue-200 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                >
                  {generatingDocType === 'REG_RENEWAL' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <FileText size={13} className="shrink-0" />}
                  <span>Generate Registration / Renewal Letter</span>
                </button>

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('LEASE')}
                  className="bg-amber-600/25 hover:bg-amber-600/40 disabled:opacity-50 border border-amber-500/40 text-amber-200 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                >
                  {generatingDocType === 'LEASE' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <FileCheck size={13} className="shrink-0" />}
                  <span>Generate Lease Agreement</span>
                </button>

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('NOC')}
                  className="bg-purple-600/25 hover:bg-purple-600/40 disabled:opacity-50 border border-purple-500/40 text-purple-200 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                >
                  {generatingDocType === 'NOC' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <Building size={13} className="shrink-0" />}
                  <span>Generate NOC Letter</span>
                </button>
              </div>

              {docFeedback && (
                <div className={`px-3 py-1.5 rounded-lg text-[11px] flex items-center gap-1.5 ${
                  docFeedback.type === 'success'
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                }`}>
                  {docFeedback.type === 'success' ? <CheckCircle size={13} className="shrink-0" /> : <AlertCircle size={13} className="shrink-0" />}
                  <span>{docFeedback.message}</span>
                </div>
              )}
            </div>
          </div>

          {/* Row 5: Mandatory Pre-Uploaded Vehicle Documents (Vehicle Registration Book & Owner ID Card) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-900/90 p-4 rounded-xl border border-brand-500/30">
            <div className="sm:col-span-2 flex items-center justify-between border-b border-white/10 pb-2">
              <div>
                <h4 className="text-xs font-bold text-brand-300">
                  Mandatory Vehicle Compliance Documents (Pre-Requisite for Workflow Assignment)
                </h4>
                <p className="text-[11px] text-gray-400">
                  Vehicle Registration Book and Vehicle Owner ID Card (uploaded by Vehicle Manager) are mandatory before a case workflow can be completed.
                </p>
              </div>
            </div>

            {/* 1. Vehicle Registration Book Upload */}
            <div className="space-y-2 bg-white/5 p-3 rounded-xl border border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">1. Vehicle Registration Book *</span>
                {formData.registrationBook ? (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                    ✓ Uploaded
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                    Missing
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <label htmlFor="veh-reg-book-upload" className="flex-1 cursor-pointer border border-dashed border-brand-500/40 hover:border-brand-400 bg-brand-500/5 hover:bg-brand-500/10 rounded-xl p-2.5 text-center transition-all">
                  <input
                    type="file"
                    id="veh-reg-book-upload"
                    className="hidden"
                    accept="image/*,application/pdf"
                    onChange={handleRegBookUpload}
                  />
                  <div className="flex items-center justify-center gap-1.5 text-brand-300 text-xs font-semibold">
                    <UploadCloud size={15} />
                    <span>{formData.registrationBook ? 'Replace Reg Book' : 'Upload Reg Book'}</span>
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setScannerTarget('REG_BOOK');
                    setShowDocScanner(true);
                  }}
                  className="px-3 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                  title="Scan Registration Book Document"
                >
                  <Camera size={14} /> Scan Doc
                </button>
              </div>
              {formData.registrationBook && (
                <div className="flex items-center justify-between text-[11px] bg-black/40 p-2 rounded-lg border border-white/10">
                  <span className="text-gray-300 truncate">{formData.registrationBookName || 'Vehicle_Reg_Book'}</span>
                  <a
                    href={formData.registrationBook}
                    download={formData.registrationBookName || `RegBook_${formData.registrationNumber || 'Vehicle'}.jpg`}
                    className="text-emerald-400 hover:underline font-bold flex items-center gap-1 shrink-0"
                  >
                    <Download size={11} /> Download
                  </a>
                </div>
              )}
            </div>

            {/* 2. Vehicle Owner ID Card Upload */}
            <div className="space-y-2 bg-white/5 p-3 rounded-xl border border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">2. Vehicle Owner ID Card (CNIC) *</span>
                {formData.ownerIdCardUrl ? (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                    ✓ Uploaded
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                    Missing
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <label htmlFor="owner-id-upload" className="flex-1 cursor-pointer border border-dashed border-brand-500/40 hover:border-brand-400 bg-brand-500/5 hover:bg-brand-500/10 rounded-xl p-2.5 text-center transition-all">
                  <input 
                    type="file" 
                    id="owner-id-upload" 
                    className="hidden" 
                    accept="image/*,application/pdf"
                    onChange={handleOwnerIdUpload} 
                  />
                  <div className="flex items-center justify-center gap-1.5 text-brand-300 text-xs font-semibold">
                    <UploadCloud size={15} />
                    <span>{formData.ownerIdCardUrl ? 'Replace Owner ID' : 'Upload Owner ID'}</span>
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setScannerTarget('OWNER_ID');
                    setShowDocScanner(true);
                  }}
                  className="px-3 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                  title="Scan Owner ID Card Document"
                >
                  <Camera size={14} /> Scan Doc
                </button>
              </div>
              {formData.ownerIdCardUrl && (
                <div className="flex items-center justify-between text-[11px] bg-black/40 p-2 rounded-lg border border-white/10">
                  <span className="text-gray-300 truncate">{formData.ownerIdCardName || 'Owner_CNIC'}</span>
                  <a
                    href={formData.ownerIdCardUrl}
                    download={formData.ownerIdCardName || `OwnerID_${formData.registrationNumber || 'Vehicle'}.jpg`}
                    className="text-emerald-400 hover:underline font-bold flex items-center gap-1 shrink-0"
                  >
                    <Download size={11} /> Download
                  </a>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Vehicle Owner Name (Optional)</label>
              <input 
                type="text" 
                placeholder="Owner Full Name" 
                className="w-full glass-input rounded p-2 text-white text-xs" 
                value={formData.ownerName || ''} 
                onChange={e => setFormData({...formData, ownerName: e.target.value})} 
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Owner CNIC / ID Number (Optional)</label>
              <input 
                type="text" 
                placeholder="e.g. 42101-1234567-1" 
                className="w-full glass-input rounded p-2 text-white font-mono text-xs" 
                value={formData.ownerCnic || ''} 
                onChange={e => setFormData({...formData, ownerCnic: e.target.value})} 
              />
            </div>
          </div>

          {/* Row 6: Category, Type, Conditional Size (20ft / 40ft / 45ft) & Weight Capacity */}
          <div className={`grid grid-cols-1 ${requiresContainerOrTrailerSize ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-3`}>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Category</label>
              <select
                className="w-full glass-input rounded p-2 text-white outline-none bg-slate-900 text-xs"
                value={formData.category}
                onChange={e => setFormData({...formData, category: e.target.value})}
              >
                {Object.values(VehicleCategory).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select
                className="w-full glass-input rounded p-2 text-white outline-none bg-slate-900 text-xs"
                value={formData.type}
                onChange={e => {
                  const nextType = e.target.value;
                  const needsSize = nextType === VehicleType.FLATBED || nextType === VehicleType.CONTAINER;
                  setFormData({
                    ...formData,
                    type: nextType,
                    size: needsSize
                      ? (['20ft', '40ft', '45ft'].includes(formData.size) ? formData.size : '40ft')
                      : 'Loose'
                  });
                }}
              >
                {Object.values(VehicleType).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {requiresContainerOrTrailerSize && (
              <div>
                <label className="text-xs text-cyan-300 block mb-1 font-semibold">Size *</label>
                <select
                  className="w-full glass-input rounded p-2 text-white outline-none bg-slate-900 border border-cyan-500/40 text-xs font-semibold"
                  value={['20ft', '40ft', '45ft'].includes(formData.size) ? formData.size : '40ft'}
                  onChange={e => setFormData({...formData, size: e.target.value})}
                >
                  <option value="20ft">20ft</option>
                  <option value="40ft">40ft</option>
                  <option value="45ft">45ft</option>
                </select>
              </div>
            )}

            <div>
              <label className="text-xs text-gray-400 block mb-1">Weight Capacity</label>
              <select
                className="w-full glass-input rounded p-2 text-white outline-none bg-slate-900 text-xs"
                value={formData.weightCapacity}
                onChange={e => setFormData({...formData, weightCapacity: e.target.value})}
              >
                <option value="">Select Weight Range</option>
                <option value="20-25 Ton">20-25 Ton</option>
                <option value="25-30 Ton">25-30 Ton</option>
                <option value="30-35 Ton">30-35 Ton</option>
                <option value="35-40 Ton">35-40 Ton</option>
                <option value="40-45 Ton">40-45 Ton</option>
                <option value="45-50 Ton">45-50 Ton</option>
              </select>
            </div>
          </div>

          {/* Row 7: Vehicle Trips History Section */}
          {(() => {
            const vehicleTrips = resolveVehicleCompleteTrips(
              formData.registrationNumber || initialVehicle?.registrationNumber || '',
              initialVehicle?.tripsHistory || formData.tripsHistory,
              {
                name: formData.driverName || initialVehicle?.driverName,
                cnic: formData.driverCnic || initialVehicle?.driverCnic,
                phone: formData.driverContact || initialVehicle?.driverContact
              },
              allCases,
              allDrivers
            );

            const handleDownloadTripDriverPdf = async (trip: ResolvedVehicleTrip) => {
              setDownloadingTripId(trip.id);
              setDocFeedback(null);
              try {
                let frontUrl = trip.driverCnicFrontUrl;
                let backUrl = trip.driverCnicBackUrl;
                if (!frontUrl && trip.frontDocIdbKey) {
                  frontUrl = (await getDocumentFromIndexedDB(trip.frontDocIdbKey)) || undefined;
                }
                if (!backUrl && trip.backDocIdbKey) {
                  backUrl = (await getDocumentFromIndexedDB(trip.backDocIdbKey)) || undefined;
                }

                const res = await downloadDriverIdCardPdf({
                  driverName: trip.driverName,
                  driverCnic: trip.driverCnic,
                  driverPhone: trip.driverPhone,
                  vehicleNo: formData.registrationNumber || initialVehicle?.registrationNumber || 'N/A',
                  caseNo: trip.caseNo,
                  date: trip.date,
                  pol: trip.pol,
                  pod: trip.pod,
                  clientName: trip.clientName,
                  importerName: trip.importerName,
                  itemDescription: trip.itemDescription,
                  cnicFrontUrl: frontUrl,
                  cnicBackUrl: backUrl
                });
                setDocFeedback({
                  type: 'success',
                  message: `Driver ID Card PDF downloaded: ${res.filename}`
                });
              } catch (err) {
                console.error('Failed to download Driver ID Card PDF:', err);
                setDocFeedback({
                  type: 'error',
                  message: 'Failed to generate Driver ID Card PDF. Please try again.'
                });
              } finally {
                setDownloadingTripId(null);
              }
            };

            return (
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                  <div className="flex items-center gap-2">
                    <MapPin size={15} className="text-brand-400 shrink-0" />
                    <span className="text-xs font-bold text-white">Vehicle Trips History</span>
                  </div>
                  <span className="text-xs text-gray-400 tabular-nums">
                    {vehicleTrips.length === 0
                      ? 'Empty'
                      : `${vehicleTrips.length} ${vehicleTrips.length === 1 ? 'Trip' : 'Trips'} Recorded`}
                  </span>
                </div>

                {vehicleTrips.length === 0 ? (
                  <div className="py-6 px-4 text-center rounded-lg bg-black/30 border border-white/5 space-y-1">
                    <p className="text-sm font-semibold text-gray-300">Empty</p>
                    <p className="text-xs text-gray-500">
                      No trip history recorded for this vehicle yet.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                    {vehicleTrips.map((trip, idx) => (
                      <div
                        key={trip.id || idx}
                        className="p-3 rounded-lg bg-black/35 border border-white/10 hover:border-white/20 transition-colors space-y-2.5 text-xs"
                      >
                        {/* Top strip: Date, Case No, Departure Port -> Destination Port */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-gray-300">
                            <span className="font-mono font-semibold text-white tabular-nums">{trip.date}</span>
                            <span aria-hidden="true" className="text-gray-600">·</span>
                            <span>
                              Case No: <strong className="font-mono text-cyan-300 tabular-nums">{trip.caseNo}</strong>
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-gray-200 font-medium">
                            <span className="text-gray-400">From:</span>
                            <span className="text-white font-semibold">{trip.pol}</span>
                            <span className="text-brand-400 font-bold">→</span>
                            <span className="text-gray-400">To:</span>
                            <span className="text-emerald-300 font-semibold">{trip.pod}</span>
                          </div>
                        </div>

                        {/* Middle strip: Client, Importer, Cargo Item */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <span className="text-[11px] text-gray-500 block">Client</span>
                            <span className="text-gray-200 font-semibold break-words">{trip.clientName || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-[11px] text-gray-500 block">Importer</span>
                            <span className="text-gray-200 font-medium break-words">{trip.importerName || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-[11px] text-gray-500 block">Cargo Item</span>
                            <span className="text-gray-200 font-medium break-words">{trip.itemDescription || 'General Cargo'}</span>
                          </div>
                        </div>

                        {/* Bottom strip: Driver Name, Mobile No, ID Card (CNIC) No + PDF Download */}
                        <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-300">
                            <span>
                              Driver: <strong className="text-white">{trip.driverName || 'Not Recorded'}</strong>
                            </span>
                            <span aria-hidden="true" className="text-gray-600">·</span>
                            <span>
                              Mobile: <strong className="font-mono text-gray-200 tabular-nums">{trip.driverPhone || 'Not Recorded'}</strong>
                            </span>
                            <span aria-hidden="true" className="text-gray-600">·</span>
                            <span>
                              ID Card (CNIC): <strong className="font-mono text-gray-200 tabular-nums">{trip.driverCnic || 'Not Recorded'}</strong>
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={downloadingTripId === trip.id}
                            onClick={() => handleDownloadTripDriverPdf(trip)}
                            className="px-2.5 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-200 font-semibold text-[11px] flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 disabled:opacity-50"
                          >
                            {downloadingTripId === trip.id ? (
                              <Loader2 size={12} className="animate-spin shrink-0" />
                            ) : (
                              <Download size={12} className="shrink-0" />
                            )}
                            <span>Download Driver ID Card (PDF)</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
          <button onClick={() => {
             if (!formData.registrationNumber?.trim()) {
               setFormError('Please enter Vehicle Registration Number (Vehicle No.).');
               return;
             }
             if (formData.mra?.trim()) {
               persistCustomRegion(formData.mra.trim());
             }
             const selectedTransporter = transporters.find((t: Transporter) => t.id === formData.transporterId);
             const syncedTransporter = (formData.transporterName || formData.brokerName || selectedTransporter?.name || 'Direct Transporter').trim();
             onSave({ 
               ...formData, 
               size: requiresContainerOrTrailerSize
                 ? (['20ft', '40ft', '45ft'].includes(formData.size) ? formData.size : '40ft')
                 : 'Loose',
               transporterName: syncedTransporter,
               brokerName: syncedTransporter
             });
          }} className="bg-brand-600 hover:bg-brand-500 text-white px-5 py-2 rounded-xl font-semibold text-sm shadow-lg shadow-brand-600/30">
            {initialVehicle ? 'Save Vehicle Updates' : 'Register Vehicle'}
          </button>
        </div>

        <CameraDocumentScannerModal
          isOpen={showDocScanner}
          onClose={() => setShowDocScanner(false)}
          documentTitle={scannerTarget === 'REG_BOOK' ? 'Vehicle Registration Book' : scannerTarget === 'OWNER_ID' ? 'Vehicle Owner ID Card' : 'Vehicle Registration & Specifications'}
          suggestedFileName={`Scanned_Vehicle_${scannerTarget}_${Date.now()}`}
          onScanComplete={async (result) => {
            setShowDocScanner(false);
            if (scannerTarget === 'REG_BOOK') {
              setFormData((prev: any) => ({
                ...prev,
                registrationBook: (result as any).dataUrl || result.pdfDataUrl,
                registrationBookName: result.file.name
              }));
            } else if (scannerTarget === 'OWNER_ID') {
              setFormData((prev: any) => ({
                ...prev,
                ownerIdCardUrl: (result as any).dataUrl || result.pdfDataUrl,
                ownerIdCardName: result.file.name
              }));
            } else {
              await handleFileUpload({ target: { files: [result.file] } } as any);
            }
          }}
        />
      </div>
    </div>
  );
};

const VehicleProfileModal = ({ 
  vehicle, 
  allCases = [],
  allDrivers = [],
  onClose,
  onEditVehicle,
  onRenewVehicle,
  onCancelVehicle
}: { 
  vehicle: Vehicle; 
  allCases?: Case[];
  allDrivers?: Driver[];
  onClose: () => void;
  onEditVehicle?: (v: Vehicle) => void;
  onRenewVehicle?: (v: Vehicle) => void;
  onCancelVehicle?: (v: Vehicle) => void;
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingTripReport, setIsExportingTripReport] = useState(false);
  const [downloadingDriverTripId, setDownloadingDriverTripId] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [directDownloadUrl, setDirectDownloadUrl] = useState<string | null>(null);
  const [directDownloadFilename, setDirectDownloadFilename] = useState<string>('');
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState(false);

  const trips = useMemo(() => {
    return resolveVehicleCompleteTrips(
      vehicle.registrationNumber,
      vehicle.tripsHistory,
      {
        name: vehicle.driverName,
        cnic: vehicle.driverCnic,
        phone: vehicle.driverContact
      },
      allCases,
      allDrivers
    );
  }, [vehicle, allCases, allDrivers]);

  const handleDownloadTripDriverIdPdf = async (trip: ResolvedVehicleTrip) => {
    setDownloadingDriverTripId(trip.id);
    setDownloadError(null);
    setDownloadSuccess(null);
    try {
      let frontUrl = trip.driverCnicFrontUrl;
      let backUrl = trip.driverCnicBackUrl;
      if (!frontUrl && trip.frontDocIdbKey) {
        frontUrl = (await getDocumentFromIndexedDB(trip.frontDocIdbKey)) || undefined;
      }
      if (!backUrl && trip.backDocIdbKey) {
        backUrl = (await getDocumentFromIndexedDB(trip.backDocIdbKey)) || undefined;
      }

      const res = await downloadDriverIdCardPdf({
        driverName: trip.driverName,
        driverCnic: trip.driverCnic,
        driverPhone: trip.driverPhone,
        vehicleNo: vehicle.registrationNumber,
        caseNo: trip.caseNo,
        date: trip.date,
        pol: trip.pol,
        pod: trip.pod,
        clientName: trip.clientName,
        importerName: trip.importerName,
        itemDescription: trip.itemDescription,
        cnicFrontUrl: frontUrl,
        cnicBackUrl: backUrl
      });
      setDownloadSuccess(`Driver ID Card PDF downloaded: ${res.filename}`);
    } catch (err) {
      console.error(err);
      setDownloadError('Failed to generate Driver ID Card PDF.');
    } finally {
      setDownloadingDriverTripId(null);
    }
  };

  const handleDownloadPdf = async () => {
    setIsExporting(true);
    setDownloadSuccess(null);
    setDownloadError(null);
    try {
      const res = await downloadVehicleDetailsPdf({
        ...vehicle,
        tripsHistory: trips
      });
      setDownloadSuccess(`Vehicle dossier downloaded: ${res.filename}`);
      setDirectDownloadFilename(res.filename);
      setDirectDownloadUrl(res.blobUrl);
    } catch (err) {
      console.error(err);
      setDownloadError('Failed to generate vehicle profile PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadTripAndFleetReport = () => {
    setIsExportingTripReport(true);
    setDownloadSuccess(null);
    setDownloadError(null);
    try {
      exportVehicleTripsToExcel(vehicle.registrationNumber, trips);
      setDownloadSuccess(`Trip report (Excel .xlsx) downloaded for ${vehicle.registrationNumber}`);
    } catch (err) {
      console.error(err);
      setDownloadError('Failed to generate vehicle trip report.');
    } finally {
      setIsExportingTripReport(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-start justify-center pt-6 sm:pt-10 p-3 sm:p-5 overflow-y-auto z-50 animate-in fade-in">
      <div className="glass-card w-full max-w-4xl h-[85vh] flex flex-col rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
        <div className="bg-slate-900/90 p-5 md:p-6 border-b border-white/10 flex flex-wrap justify-between items-center gap-3">
           <div>
             <h2 className="text-2xl font-bold text-white flex items-center gap-3 flex-wrap">
               <span>{vehicle.registrationNumber}</span>
               <span className="text-xs font-bold uppercase px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                 {vehicle.companyName || (vehicle.operatingCompany === 'truckit' ? 'TRUCKIT PVT LTD' : 'DOCKS PVT LTD')}
               </span>
               <span className="text-sm font-normal bg-white/10 px-2 py-1 rounded text-gray-300">{vehicle.type}</span>
             </h2>
             <p className="text-gray-400 text-sm mt-1">
               Transporter & Broker: <strong className="text-white">{vehicle.transporterName || vehicle.brokerName || 'Direct Transporter'}</strong> • {vehicle.category}
             </p>
           </div>
           
           <div className="flex items-center gap-2 flex-wrap">
             {onEditVehicle && (
               <button
                 type="button"
                 onClick={() => onEditVehicle(vehicle)}
                 className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition-all shadow"
               >
                 <Settings size={14} />
                 <span>Edit / Upload Docs</span>
               </button>
             )}
             {onRenewVehicle && (
               <button
                 type="button"
                 onClick={() => onRenewVehicle(vehicle)}
                 className="bg-amber-600/25 hover:bg-amber-600 border border-amber-500/40 text-amber-300 hover:text-white text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition-all"
               >
                 <Clock size={14} />
                 <span>Renew 6M</span>
               </button>
             )}
             {vehicle.status === 'CANCELLED' ? (
                <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5">
                  <Ban size={13} /> De-registered / Cancelled
                </span>
             ) : onCancelVehicle ? (
                <button
                  onClick={() => onCancelVehicle(vehicle)}
                  className="bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition-all"
                  title="Cancel Vehicle and Generate NOC"
                >
                  <Ban size={14} />
                  <span>Cancel Vehicle (NOC)</span>
                </button>
             ) : null}

             <button
               onClick={handleDownloadTripAndFleetReport}
               disabled={isExportingTripReport}
               className="bg-blue-600/25 hover:bg-blue-600 border border-blue-500/30 text-blue-300 hover:text-white text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-all shadow-sm"
               title={`Download complete Trip & Fleet Report for vehicle ${vehicle.registrationNumber} (Excel / CSV)`}
             >
               {isExportingTripReport ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
               <span>Trip Report ({trips.length})</span>
             </button>

             <button
               onClick={handleDownloadPdf}
               disabled={isExporting}
               className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
               title="Download complete vehicle profile dossier as PDF"
             >
               {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
               <span>Download PDF</span>
             </button>
             <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 ml-2"><X size={22}/></button>
           </div>
        </div>

        {/* Status notifications */}
        {isExporting && (
          <div className="bg-brand-500/10 border-b border-brand-500/20 px-6 py-2.5 flex items-center gap-3 text-brand-300 text-xs animate-pulse">
            <Loader2 size={16} className="animate-spin text-brand-400 shrink-0" />
            <span>Generating and downloading Vehicle Dossier PDF...</span>
          </div>
        )}

        {downloadSuccess && (
          <div className="bg-emerald-500/15 border-b border-emerald-500/20 px-6 py-2.5 text-xs text-emerald-300 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-emerald-400 shrink-0" />
              <span>{downloadSuccess} — Saved to your device!</span>
            </div>
            {directDownloadUrl && (
              <div className="flex items-center gap-3">
                <a 
                  href={directDownloadUrl} 
                  download={directDownloadFilename}
                  className="inline-flex items-center gap-1 text-emerald-300 underline font-bold"
                >
                  <Download size={12} /> Tap here to download again
                </a>
                <button
                  type="button"
                  onClick={() => setIsPdfViewerOpen(true)}
                  className="inline-flex items-center gap-1 text-white bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded text-[11px] font-semibold border border-white/20 transition-all active:scale-95"
                >
                  <Eye size={12} /> View PDF
                </button>
              </div>
            )}
          </div>
        )}

        {downloadError && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-2.5 text-xs text-red-300 flex items-center gap-2">
            <AlertCircle size={16} className="text-red-400 shrink-0" />
            <span>{downloadError}</span>
          </div>
        )}
        
        <div className="flex-1 overflow-y-auto p-6">
           {/* Status Cards */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="glass-panel p-4 rounded-xl border border-white/10">
                 <h4 className="text-brand-400 text-xs uppercase font-bold mb-3">Current Status</h4>
                 <div className="text-2xl font-bold text-white mb-1">{vehicle.status.replace('_', ' ')}</div>
                 <div className="text-xs text-gray-500">Last updated: Today</div>
              </div>
              <div className="glass-panel p-4 rounded-xl border border-white/10">
                 <h4 className="text-brand-400 text-xs uppercase font-bold mb-3">Validation Expiry</h4>
                 <div className="text-2xl font-bold text-white mb-1">{vehicle.validationExpiryDate || 'Active'}</div>
                 <div className="text-xs text-gray-500">
                    {vehicle.validationExpiryDate ? 'Customs authorization validity' : 'No strict expiry bound'}
                 </div>
              </div>
           </div>

           {/* Redesigned Unified Vehicle Details Section */}
           <div className="glass-panel p-6 rounded-xl border border-white/10 mb-8">
             <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
               <Settings size={18} className="text-brand-400" /> Vehicle Details
             </h3>
             
             <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
               {/* Technical specifications */}
               <div className="space-y-3">
                 <h4 className="text-xs font-bold text-brand-400 uppercase tracking-wider border-b border-white/5 pb-1">Technical Specs</h4>
                  <div className="flex justify-between text-sm py-1 bg-amber-500/10 px-2 rounded-lg border border-amber-500/20">
                    <span className="text-gray-300 font-medium">Operating Entity</span>
                    <span className="text-amber-300 font-bold">
                      {vehicle.companyName || (
                        vehicle.operatingCompany === 'truckit' ? 'Truckit (Pvt.) Ltd.' :
                        vehicle.operatingCompany === 'muhib' ? 'Muhib International' :
                        vehicle.operatingCompany === 'vantage' ? 'Vantage Shipping Line' :
                        'Docks (Pvt.) Ltd.'
                      )}
                    </span>
                  </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Registration No</span>
                   <span className="text-white font-mono font-bold">{vehicle.registrationNumber}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Engine No</span>
                   <span className="text-white font-mono">{vehicle.engineNo || '-'}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Chassis No</span>
                   <span className="text-white font-mono">{vehicle.chassisNo || '-'}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Make/Model</span>
                   <span className="text-white">{vehicle.makeModel || '-'}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Weight Capacity</span>
                   <span className="text-white">{vehicle.weightCapacity || '-'}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Category & Type</span>
                   <span className="text-white">{vehicle.category} • {vehicle.type}</span>
                 </div>
               </div>

               {/* Driver & tracking specifications */}
               <div className="space-y-3">
                 <h4 className="text-xs font-bold text-brand-400 uppercase tracking-wider border-b border-white/5 pb-1">Driver & Tracker</h4>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Driver Assignment</span>
                   <span className="text-white font-medium">
                     {vehicle.driverName && vehicle.driverName !== vehicle.brokerName && vehicle.driverName !== vehicle.transporterName && vehicle.driverName.toLowerCase() !== 'n/a'
                       ? vehicle.driverName
                       : 'Dynamic (Assigned per-trip on Case Workflow)'}
                   </span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Driver CNIC</span>
                   <span className="text-white font-mono">{vehicle.driverCnic || '-'}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Driver Contact</span>
                   <span className="text-white font-mono">{vehicle.driverContact || '-'}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Tracker Provider</span>
                   <span className="text-white">{vehicle.tracker?.provider || 'None'}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Tracker Device ID</span>
                   <span className="text-white font-mono">{vehicle.tracker?.id || '-'}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Carrier Affiliation</span>
                   <span className="text-white">{vehicle.brokerName || vehicle.transporterName || 'Direct Transporter'}</span>
                 </div>
               </div>

               {/* Owner specifications */}
               <div className="space-y-3">
                 <h4 className="text-xs font-bold text-brand-400 uppercase tracking-wider border-b border-white/5 pb-1">Legal Owner</h4>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Owner Name</span>
                   <span className="text-white font-medium">{vehicle.ownerName || '-'}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-400">Owner CNIC</span>
                   <span className="text-white font-mono">{vehicle.ownerCnic || '-'}</span>
                 </div>
                 <div className="flex justify-between text-sm flex-col">
                   <span className="text-gray-400 mb-1">Owner Address</span>
                   <span className="text-white text-xs bg-white/5 p-1.5 rounded border border-white/5 break-words line-clamp-2" title={vehicle.ownerAddress}>
                     {vehicle.ownerAddress || '-'}
                   </span>
                 </div>
                 {vehicle.ownerIdCardUrl && (
                   <div className="flex justify-end pt-2">
                     <a 
                       href={vehicle.ownerIdCardUrl} 
                       download={`Owner_CNIC_${vehicle.registrationNumber}.png`} 
                       className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold flex items-center gap-1 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20"
                     >
                       <Download size={12} /> Download Owner ID Card
                     </a>
                   </div>
                 )}
               </div>
             </div>
           </div>

           {/* Redesigned Registration and Cancellation History */}
           <div className="glass-panel p-6 rounded-xl border border-white/10 mb-8">
             <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
               <Calendar size={18} className="text-brand-400" /> Registration & Cancellation History
             </h3>
             
             <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
               <table className="w-full text-left text-xs">
                 <thead className="bg-white/5 text-gray-400 uppercase font-semibold border-b border-white/10">
                   <tr>
                     <th className="p-3">Event / Action</th>
                     <th className="p-3">Date</th>
                     <th className="p-3">Status</th>
                     <th className="p-3">Remarks / Details</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-white/5 text-gray-300">
                   <tr className="hover:bg-white/5">
                     <td className="p-3 font-semibold text-white flex items-center gap-2">
                       <CheckCircle size={14} className="text-green-400" /> Initial Fleet Enrollment
                     </td>
                     <td className="p-3 font-mono">{vehicle.registrationDate || vehicle.createdAt?.slice(0, 10) || 'Verified'}</td>
                     <td className="p-3"><span className="px-2 py-0.5 rounded bg-green-500/10 text-green-400 text-[10px] font-bold">REGISTERED</span></td>
                     <td className="p-3 text-gray-400">Successfully enrolled in DPL fleet database</td>
                   </tr>
                   
                   {vehicle.validationStartDate && (
                     <tr className="hover:bg-white/5">
                       <td className="p-3 font-semibold text-white flex items-center gap-2">
                         <Activity size={14} className="text-blue-400" /> Customs Validation Start
                       </td>
                       <td className="p-3 font-mono">{vehicle.validationStartDate}</td>
                       <td className="p-3"><span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-bold">BONDED ACTIVE</span></td>
                       <td className="p-3 text-gray-400">Customs bonded transit permit authorized</td>
                     </tr>
                   )}

                   {vehicle.validationExpiryDate && (
                     <tr className="hover:bg-white/5">
                       <td className="p-3 font-semibold text-white flex items-center gap-2">
                         <Clock size={14} className="text-yellow-400" /> Customs Bonded Expiry / Renewal
                       </td>
                       <td className="p-3 font-mono">{vehicle.validationExpiryDate}</td>
                       <td className="p-3">
                         <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                           vehicle.status === 'EXPIRED' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'
                         }`}>
                           {vehicle.status === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE'}
                         </span>
                       </td>
                       <td className="p-3 text-gray-400">
                         {vehicle.status === 'EXPIRED' 
                           ? 'Permit validity expired. Renewal required immediately.' 
                           : 'Validity period is currently active.'}
                       </td>
                     </tr>
                   )}

                   {vehicle.status === 'CANCELLED' ? (
                     <tr className="hover:bg-white/5 bg-red-500/5">
                       <td className="p-3 font-semibold text-red-300 flex items-center gap-2">
                         <Ban size={14} className="text-red-400" /> Fleet De-Registration / NOC
                       </td>
                       <td className="p-3 font-mono text-red-300">{vehicle.cancellationDate || vehicle.nocDate || 'Cancelled'}</td>
                       <td className="p-3">
                         <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-bold">
                           CANCELLED / NOC ISSUED
                         </span>
                       </td>
                       <td className="p-3 text-red-200">
                         NOC Ref: {vehicle.nocReference || 'N/A'}. Reason: {vehicle.cancellationReason || 'Contract Concluded'}
                       </td>
                     </tr>
                   ) : (
                     <tr className="hover:bg-white/5">
                       <td className="p-3 font-semibold text-gray-400 flex items-center gap-2">
                         <Ban size={14} className="text-gray-600" /> Fleet De-Registration / NOC
                       </td>
                       <td className="p-3 font-mono text-gray-500">-</td>
                       <td className="p-3"><span className="px-2 py-0.5 rounded bg-gray-500/10 text-gray-500 text-[10px] font-bold">NOT CANCELLED</span></td>
                       <td className="p-3 text-gray-500">Vehicle is currently active; no NOC has been requested or generated</td>
                     </tr>
                   )}
                 </tbody>
               </table>
             </div>
           </div>

           {/* Bottom Section: Vehicle Trips History */}
           <div className="mb-8" id="vehicle-trips-section">
             <div className="flex items-center justify-between mb-4">
               <h3 className="text-lg font-bold text-white flex items-center gap-2">
                 <MapPin size={18} className="text-brand-400"/> Vehicle Trips History
               </h3>
               <button
                 type="button"
                 onClick={handleDownloadTripAndFleetReport}
                 className="text-xs text-brand-300 hover:text-white flex items-center gap-1 bg-brand-500/10 hover:bg-brand-500/20 px-2.5 py-1 rounded-lg border border-brand-500/20 transition-all whitespace-nowrap shrink-0"
                 title="Download Trip Report for this vehicle as Excel (.xlsx)"
               >
                 <Download size={12} /> Export Vehicle Trips (Excel .xlsx)
               </button>
             </div>

             {trips.length === 0 ? (
               <div className="p-6 text-center text-gray-500 text-xs bg-black/20 rounded-xl border border-white/5 space-y-1">
                 <p className="font-semibold text-sm text-gray-300">Empty</p>
                 <p className="text-xs text-gray-500">
                   No trip history recorded for this vehicle yet.
                 </p>
               </div>
             ) : (
               <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                 <table className="w-full text-left text-xs">
                   <thead className="bg-white/5 text-gray-400 font-semibold border-b border-white/10">
                     <tr>
                       <th className="p-3">Date & Case No.</th>
                       <th className="p-3">Route (From → To)</th>
                       <th className="p-3">Client, Importer & Item</th>
                       <th className="p-3">Driver Details</th>
                       <th className="p-3 text-right">Driver ID Card</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5 text-gray-300">
                     {trips.map((trip, idx) => (
                       <tr key={trip.id || idx} className="hover:bg-white/5">
                         <td className="p-3 align-top">
                           <div className="font-mono font-semibold text-white tabular-nums">{trip.date}</div>
                           <div className="font-mono text-cyan-300 text-[11px] tabular-nums mt-0.5">{trip.caseNo}</div>
                         </td>
                         <td className="p-3 align-top">
                           <div className="text-white font-medium">{trip.pol}</div>
                           <div className="text-emerald-300 text-[11px] mt-0.5">→ {trip.pod}</div>
                         </td>
                         <td className="p-3 align-top space-y-0.5">
                           <div className="text-white font-semibold">{trip.clientName}</div>
                           <div className="text-gray-300 text-[11px]">Importer: {trip.importerName || 'N/A'}</div>
                           <div className="text-gray-400 text-[11px]">Item: {trip.itemDescription || 'General Cargo'}</div>
                         </td>
                         <td className="p-3 align-top space-y-0.5">
                           <div className="text-white font-semibold">{trip.driverName || 'Not Recorded'}</div>
                           <div className="font-mono text-gray-300 text-[11px] tabular-nums">Mobile: {trip.driverPhone || 'Not Recorded'}</div>
                           <div className="font-mono text-gray-400 text-[11px] tabular-nums">CNIC: {trip.driverCnic || 'Not Recorded'}</div>
                         </td>
                         <td className="p-3 align-top text-right">
                           <button
                             type="button"
                             disabled={downloadingDriverTripId === trip.id}
                             onClick={() => handleDownloadTripDriverIdPdf(trip)}
                             className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-200 font-semibold text-[11px] transition-all whitespace-nowrap shrink-0 disabled:opacity-50"
                           >
                             {downloadingDriverTripId === trip.id ? (
                               <Loader2 size={12} className="animate-spin shrink-0" />
                             ) : (
                               <Download size={12} className="shrink-0" />
                             )}
                             <span>ID Card PDF</span>
                           </button>
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

      <PdfViewerModal
        isOpen={isPdfViewerOpen}
        onClose={() => setIsPdfViewerOpen(false)}
        pdfUrl={directDownloadUrl}
        filename={directDownloadFilename}
        title="Vehicle Dossier"
      />
    </div>
  );
};

export default VehicleManagement;

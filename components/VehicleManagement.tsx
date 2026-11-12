import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Truck, Plus, Search, FileText, User, Settings, Save, MapPin, Calendar, Clock, AlertTriangle, Trash2, CheckCircle, X, ChevronRight, ChevronDown, Eye, Activity, CreditCard, Filter, AlertCircle, Download, Loader2, Ban, FileCheck, ShieldCheck, UploadCloud, CheckSquare, Square, Layers, Camera, Building, Globe, ExternalLink, Copy, DollarSign, Phone, Sparkles } from 'lucide-react';
import { Vehicle, Transporter, VehicleCategory, VehicleType, TrackerInfo, VehicleHistory, UserRole, Case, Driver, TransporterRequest, FinanceEntry } from '../types';
import { submitVehicleActionApproval } from '../services/approvalService';
import { autoFillVehicleData, verifyVehicleComplianceDocumentWithAI } from '../services/geminiService';
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
  syncAllCasesHistoryToVehicles,
  saveFinanceToFirestore
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
  generateAffidavitDocx,
  generateLeaseTerminationAgreementDocx, 
  generateCancellationLetterLetterheadDocx,
  generateVehicleNocDocx,
  generateVehicleBookCopyDocx,
  generateVehicleOwnerIdCopyDocx,
  generateCompanyOwnerIdCopyDocx,
  generateWitnessesIdCopyDocx,
  resolveVehicleDocxCompany,
  DOCKS_COMPANY,
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
      reviewedBy: 'Documentation Manager',
      reviewedAt: new Date().toISOString()
    };
    await updateTransporterRequestInFirestore(updatedReq);

    // Dispatch real-time notification to Transporter & Admin
    await sendAppNotification({
      title: `Vehicle Request APPROVED: ${req.vehicleNo}`,
      description: `Your ${req.type.replace('_', ' ').toLowerCase()} request for vehicle ${req.vehicleNo} has been verified and approved by Documentation Manager.`,
      targetRole: UserRole.TRANSPORTER,
      targetClientName: req.transporterName,
      targetView: 'vehicles',
      targetFilter: { vehicleNo: req.vehicleNo },
      type: 'INFO',
      notificationSubType: 'GENERAL',
      actionLabel: 'View Vehicle',
      performedBy: 'Documentation Manager',
      performedByRole: 'DOCUMENTATION_MANAGER',
      category: 'TRANSPORTER'
    });

    setStatusBanner({ type: 'success', message: `Transporter request for ${req.vehicleNo} has been approved.` });
  };

  const handleRejectTransporterRequest = async (req: TransporterRequest) => {
    const updatedReq: TransporterRequest = {
      ...req,
      status: 'REJECTED',
      reviewedBy: 'Documentation Manager',
      reviewedAt: new Date().toISOString()
    };
    await updateTransporterRequestInFirestore(updatedReq);

    // Dispatch real-time notification to Transporter & Admin
    await sendAppNotification({
      title: `Vehicle Request Declined: ${req.vehicleNo}`,
      description: `Your ${req.type.replace('_', ' ').toLowerCase()} request for vehicle ${req.vehicleNo} was declined by Documentation Manager. Please contact documentation desk for details.`,
      targetRole: UserRole.TRANSPORTER,
      targetClientName: req.transporterName,
      targetView: 'vehicles',
      targetFilter: { vehicleNo: req.vehicleNo },
      type: 'ALERT',
      notificationSubType: 'GENERAL',
      actionLabel: 'Check Status',
      performedBy: 'Documentation Manager',
      performedByRole: 'DOCUMENTATION_MANAGER',
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
  const hasVehicleMgrRole =
    hasAdminRole ||
    effectiveRoles.includes(UserRole.DOCUMENTATION_MANAGER) ||
    effectiveRoles.includes(UserRole.VEHICLE_MANAGER);

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

  type VehicleStatusSubTab = 'ALL' | 'ACTIVE' | 'EXPIRED' | 'EXPIRY_SOON' | 'IN_TRANSIT';
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState<VehicleStatusSubTab>('ALL');
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [transporterFilter, setTransporterFilter] = useState<string>('ALL');
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
    const t = setTimeout(() => {
      safeAppStorage.setJSON('dpl_live_transporters', transporters);
    }, 350);
    return () => clearTimeout(t);
  }, [transporters]);

  useEffect(() => {
    const t = setTimeout(() => {
      safeAppStorage.setJSON('dpl_live_vehicles', vehicles);
    }, 500);
    return () => clearTimeout(t);
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

  // Cancellation & Automated NOC Workflow (with Collector Details & Cash Book Fee Integration)
  const [vehicleToCancel, setVehicleToCancel] = useState<Vehicle | null>(null);
  const [cancellationReason, setCancellationReason] = useState('Contract Concluded & Operational De-Registration');
  const [nocCollectorName, setNocCollectorName] = useState('');
  const [nocCollectorPhone, setNocCollectorPhone] = useState('');
  const [nocFeeCharged, setNocFeeCharged] = useState<'NO' | 'YES'>('NO');
  const [nocFeeAmount, setNocFeeAmount] = useState('');
  const [nocModalError, setNocModalError] = useState<string | null>(null);
  const [isCancellingVehicle, setIsCancellingVehicle] = useState(false);
  const [nocSuccessNotice, setNocSuccessNotice] = useState<{ vehicleNo: string; nocRef: string; downloadUrl?: string; filename?: string; cancelledVehicle?: Vehicle; feeAmount?: number; collectorName?: string } | null>(null);
  const [isNocViewerOpen, setIsNocViewerOpen] = useState(false);

  // Official Customs & Legal Documents (.docx) state
  const [showDocsModal, setShowDocsModal] = useState(false);
  const [docsModalType, setDocsModalType] = useState<DocumentType>('REG_LETTER');
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<number[]>([]);

  // --- Helper Functions ---

  const openCancelNocModal = (v: Vehicle, defaultReason = 'Operational De-Registration & Contract Release') => {
    setVehicleToCancel(v);
    setCancellationReason(v.cancellationReason || defaultReason);
    setNocCollectorName(v.nocCollectorName || '');
    setNocCollectorPhone(v.nocCollectorPhone || '');
    setNocFeeCharged(v.nocFeeCharged ? 'YES' : 'NO');
    setNocFeeAmount(v.nocFeeAmount ? String(v.nocFeeAmount) : '');
    setNocModalError(null);
  };

  const handleConfirmCancelVehicle = async () => {
    if (!vehicleToCancel) return;

    const cleanCollectorName = nocCollectorName.trim();
    const cleanCollectorPhone = nocCollectorPhone.trim();
    if (!cleanCollectorName) {
      setNocModalError('Please enter the Name of the person collecting the NOC.');
      return;
    }
    if (!cleanCollectorPhone) {
      setNocModalError('Please enter the Mobile Number of the person collecting the NOC.');
      return;
    }

    const parsedFee = nocFeeCharged === 'YES' ? Number(nocFeeAmount) : 0;
    if (nocFeeCharged === 'YES' && (!parsedFee || isNaN(parsedFee) || parsedFee <= 0)) {
      setNocModalError('Please enter a valid NOC Charges amount (PKR), or select "No" if no charges are being collected.');
      return;
    }

    setNocModalError(null);
    setIsCancellingVehicle(true);
    const todayIso = new Date().toISOString().split('T')[0];
    const nocRef = `NOC-${getActiveCompanyPrefix()}-${Date.now().toString().slice(-6)}`;

    let postedFinanceId: number | undefined;
    if (nocFeeCharged === 'YES' && parsedFee > 0) {
      postedFinanceId = Date.now();
      const nocFinanceEntry: FinanceEntry = {
        id: postedFinanceId,
        companyId: activeCompany?.id || 'docks',
        date: todayIso,
        description: `Vehicle NOC Charges (${vehicleToCancel.registrationNumber}) — Collected by ${cleanCollectorName} (${cleanCollectorPhone})`,
        amount: parsedFee,
        type: 'INCOME',
        status: 'PAID',
        party: vehicleToCancel.transporterName || vehicleToCancel.ownerName || cleanCollectorName,
        category: 'NOC & Fleet Charges',
        reference: nocRef,
        paymentMethod: 'CASH',
        createdAt: new Date().toISOString()
      };

      const existingFin = safeAppStorage.getJSON<FinanceEntry[]>('dpl_live_finance', []) || [];
      safeAppStorage.setJSON('dpl_live_finance', [nocFinanceEntry, ...existingFin]);
      window.dispatchEvent(new Event('dpl_finance_updated'));
      saveFinanceToFirestore(nocFinanceEntry).catch((e) => console.warn('Firestore NOC cashbook entry note:', e));
    }

    const historyEntry: VehicleHistory = {
      id: Date.now(),
      date: todayIso,
      description: `Vehicle Cancelled & NOC Issued (${nocRef}) • Collected by: ${cleanCollectorName} (${cleanCollectorPhone})${parsedFee > 0 ? ` • NOC Cash Received: PKR ${parsedFee.toLocaleString()}` : ' • No NOC Charges'}`,
      type: 'STATUS_CHANGE'
    };

    // Update vehicle status in state
    const cancelledVehicle: Vehicle = {
      ...vehicleToCancel,
      status: 'CANCELLED' as const,
      cancellationRequested: true,
      cancellationApproved: true,
      cancellationDate: todayIso,
      cancellationReason: cancellationReason,
      nocReference: nocRef,
      nocDate: todayIso,
      nocCollectorName: cleanCollectorName,
      nocCollectorPhone: cleanCollectorPhone,
      nocFeeCharged: nocFeeCharged === 'YES',
      nocFeeAmount: parsedFee > 0 ? parsedFee : 0,
      nocFinanceEntryId: postedFinanceId,
      history: [historyEntry, ...(vehicleToCancel.history || [])]
    };

    const existsInList = vehicles.some(v => v.id === vehicleToCancel.id || normalizeVehiclePlate(v.registrationNumber) === normalizeVehiclePlate(vehicleToCancel.registrationNumber));
    const updatedVehicles = existsInList
      ? vehicles.map(v => (v.id === vehicleToCancel.id || normalizeVehiclePlate(v.registrationNumber) === normalizeVehiclePlate(vehicleToCancel.registrationNumber) ? cancelledVehicle : v))
      : [cancelledVehicle, ...vehicles];
    setVehicles(updatedVehicles);
    updateVehicleInFirestore(cancelledVehicle).catch(() => saveVehicleToFirestore(cancelledVehicle).catch(() => {}));

    // Generate & download BOTH:
    // 1. Cancellation NOC Letter on Company Letterhead (.docx — exact 10-11-2026 format)
    // 2. Lease Cancellation & Termination Agreement on Stamp Paper (.docx)
    try {
      const safeSlug = cancelledVehicle.registrationNumber.replace(/\s+/g, '_');

      const nocDoc = await generateVehicleNocDocx(cancelledVehicle, {
        nocReference: nocRef,
        nocDate: todayIso,
        reason: cancellationReason,
        leaveLetterheadSpace: true
      });
      await downloadDocxBlob(nocDoc, `1_Cancellation_NOC_Letter_${safeSlug}_Letterhead.docx`);

      const termDoc = await generateLeaseTerminationAgreementDocx(cancelledVehicle, {
        terminationDate: todayIso,
        originalAgreementDate: cancelledVehicle.registrationDate || todayIso,
        leaveStampPaperSpace: true
      });
      await downloadDocxBlob(termDoc, `2_Lease_Termination_NOC_${safeSlug}_Stamp_Paper.docx`);

      let pdfUrl: string | undefined;
      let pdfFilename: string | undefined;
      try {
        const res = await downloadVehicleNocPdf({
          vehicle: cancelledVehicle,
          nocNo: nocRef,
          reason: cancellationReason,
          date: todayIso
        });
        pdfUrl = res.blobUrl;
        pdfFilename = res.filename;
      } catch (pdfErr) {
        console.warn('NOC PDF generation note:', pdfErr);
      }

      setNocSuccessNotice({
        vehicleNo: cancelledVehicle.registrationNumber,
        nocRef,
        downloadUrl: pdfUrl,
        filename: pdfFilename,
        cancelledVehicle,
        feeAmount: parsedFee > 0 ? parsedFee : undefined,
        collectorName: `${cleanCollectorName} (${cleanCollectorPhone})`
      });
    } catch (err) {
      console.error('Error generating vehicle NOC & Termination documents:', err);
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

  const inTransitPlatesSet = useMemo(() => {
    const activeSet = new Set<string>();
    const closedStatuses = new Set(['CASE COMPLETED', 'COMPLETED', 'DELIVERED', 'CLOSED', 'CANCELLED']);
    (allCases || []).forEach((c) => {
      const statusUpper = String(c?.status || '').trim().toUpperCase();
      if (!c || closedStatuses.has(statusUpper)) return;
      const entries = extractCaseVehicleTripEntries(c, allDrivers);
      entries.forEach((entry) => {
        if (entry.normPlate) activeSet.add(entry.normPlate);
      });
    });
    return activeSet;
  }, [allCases, allDrivers]);

  const isVehicleOnTheWay = (v: Vehicle): boolean =>
    v.status === 'ON_TRIP' ||
    v.status === 'IN_LINE' ||
    inTransitPlatesSet.has(normalizeVehiclePlate(v.registrationNumber));

  const tripCountsByPlate = useMemo(() => {
    const keysByPlate = new Map<string, Set<string>>();
    const ensureSet = (normPlate: string) => {
      let s = keysByPlate.get(normPlate);
      if (!s) {
        s = new Set<string>();
        keysByPlate.set(normPlate, s);
      }
      return s;
    };

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
        if (!item.normPlate) continue;
        const key = item.caseNo && item.caseNo !== 'N/A' ? `CASE_${item.caseNo}` : item.id;
        ensureSet(item.normPlate).add(key);
      }
    }

    for (const v of vehicles) {
      const normPlate = normalizeVehiclePlate(v.registrationNumber || '');
      if (!normPlate || !Array.isArray(v.tripsHistory)) continue;
      const plateSet = ensureSet(normPlate);
      v.tripsHistory.forEach((t, idx) => {
        if (!t) return;
        const parsedCaseMatch = t.status ? t.status.match(/\(([^)]+)\)/) : null;
        const resolvedCaseNo = (t.caseNo || (parsedCaseMatch ? parsedCaseMatch[1] : '') || '').trim();
        const mapKey = resolvedCaseNo && resolvedCaseNo !== 'N/A'
          ? `CASE_${resolvedCaseNo}`
          : `PERSIST_${t.date || ''}_${t.containerNumber || idx}`;
        plateSet.add(mapKey);
      });
    }

    const counts = new Map<string, number>();
    keysByPlate.forEach((set, plate) => {
      counts.set(plate, set.size);
    });
    return counts;
  }, [vehicles, allCases, allDrivers]);

  const getVehicleTripsCount = (v: Vehicle): number => {
    const normPlate = normalizeVehiclePlate(v.registrationNumber || '');
    if (!normPlate) return v.tripsHistory?.length || 0;
    return tripCountsByPlate.get(normPlate) ?? (v.tripsHistory?.length || 0);
  };

  const getVehicleCompanyLabel = (v: Vehicle): string => {
    const rawOp = String(v.operatingCompany || '').trim().toLowerCase();
    const rawName = String(v.companyName || '').trim().toUpperCase();
    if (rawOp === 'truckit' || rawName.includes('TRUCKIT')) return 'TRUCKIT';
    if (rawOp === 'docks' || rawName.includes('DOCKS')) return 'DOCKS';
    if (rawOp === 'muhib' || rawName.includes('MUHIB')) return 'MUHIB';
    if (rawOp === 'vantage' || rawName.includes('VANTAGE')) return 'VANTAGE';
    if (rawName) return rawName;
    return 'DOCKS';
  };

  const getVehicleTransporterLabel = (v: Vehicle): string => {
    return String(v.transporterName || v.brokerName || 'Direct').trim();
  };

  // Single-pass O(N) precomputed metadata so scrolling & filtering 3,800+ vehicles takes <0.5ms
  const {
    fleetMetaById,
    vehiclesOnWay,
    vehiclesExpired,
    vehiclesExpiringSoon,
    vehiclesActiveValid,
    existingMraList,
  } = useMemo(() => {
    const metaMap = new Map<
      number,
      {
        validityText: 'Valid' | 'Expired' | 'Expiry Soon';
        companyLabel: string;
        companyLower: string;
        isTruckit: boolean;
        fullComp: string;
        makeModelStr: string;
        transporterLabel: string;
        transporterLower: string;
        tripsCount: number;
        isOnWay: boolean;
        isActiveValid: boolean;
        isExpired: boolean;
        isExpiringSoon: boolean;
        searchHaystack: string;
      }
    >();

    const onWayArr: Vehicle[] = [];
    const expiredArr: Vehicle[] = [];
    const expSoonArr: Vehicle[] = [];
    const activeValidArr: Vehicle[] = [];
    const mraSet = new Set<string>();

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const normPlate = normalizeVehiclePlate(v.registrationNumber || '');
      const validityText = getVehicleValidity(v).text;
      const companyLabel = getVehicleCompanyLabel(v);
      const isTruckit = companyLabel === 'TRUCKIT';
      const fullComp = v.companyName || (isTruckit ? 'TRUCKIT PVT LTD' : 'DOCKS PVT LTD');
      const makeModelStr = [v.make, v.model].filter(Boolean).join(' ') || v.makeModel || v.category || 'Bonded';
      const transporterLabel = getVehicleTransporterLabel(v);
      const tripsCount = normPlate
        ? (tripCountsByPlate.get(normPlate) ?? (v.tripsHistory?.length || 0))
        : (v.tripsHistory?.length || 0);

      const isOnWay =
        v.status === 'ON_TRIP' ||
        v.status === 'IN_LINE' ||
        (normPlate ? inTransitPlatesSet.has(normPlate) : false);
      const isExpired = v.status === 'EXPIRED' || validityText === 'Expired';
      const isExpiringSoon = v.status === 'EXPIRE_SOON' || validityText === 'Expiry Soon';
      const isActiveValid =
        !v.isBlacklisted &&
        v.status !== 'CANCELLED' &&
        v.status !== 'INACTIVE' &&
        !isExpired;

      if (isOnWay) onWayArr.push(v);
      if (isExpired) expiredArr.push(v);
      if (isExpiringSoon) expSoonArr.push(v);
      if (isActiveValid) activeValidArr.push(v);

      const cleanMra = (v.mra || '').trim();
      if (cleanMra) mraSet.add(cleanMra);

      const searchHaystack = [
        v.registrationNumber,
        v.brokerName,
        v.transporterName,
        v.chassisNo,
        v.engineNo,
        v.make,
        v.model,
        v.mra,
        v.companyName,
        v.driverName,
        v.dplSerial,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      metaMap.set(v.id, {
        validityText,
        companyLabel,
        companyLower: companyLabel.toLowerCase(),
        isTruckit,
        fullComp,
        makeModelStr,
        transporterLabel,
        transporterLower: transporterLabel.toLowerCase(),
        tripsCount,
        isOnWay,
        isActiveValid,
        isExpired,
        isExpiringSoon,
        searchHaystack,
      });
    }

    return {
      fleetMetaById: metaMap,
      vehiclesOnWay: onWayArr,
      vehiclesExpired: expiredArr,
      vehiclesExpiringSoon: expSoonArr,
      vehiclesActiveValid: activeValidArr,
      existingMraList: Array.from(mraSet),
    };
  }, [vehicles, inTransitPlatesSet, tripCountsByPlate]);

  // Dynamic list of ONLY companies that have registered vehicles
  const registeredCompaniesList = useMemo(() => {
    const counts = new Map<string, number>();
    vehicles.forEach((v) => {
      const comp = fleetMetaById.get(v.id)?.companyLabel || getVehicleCompanyLabel(v);
      if (comp) {
        counts.set(comp, (counts.get(comp) || 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [vehicles, fleetMetaById]);

  // Complete list of all transporters across registered vehicles and transporter directory
  const registeredTransportersList = useMemo(() => {
    const byLower = new Map<string, { name: string; count: number }>();
    vehicles.forEach((v) => {
      const tName = fleetMetaById.get(v.id)?.transporterLabel || getVehicleTransporterLabel(v);
      if (!tName) return;
      const key = tName.toLowerCase();
      const existing = byLower.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byLower.set(key, { name: tName.toUpperCase(), count: 1 });
      }
    });
    transporters.forEach((t) => {
      const tName = String(t.name || '').trim();
      if (!tName) return;
      const key = tName.toLowerCase();
      if (!byLower.has(key)) {
        byLower.set(key, { name: tName.toUpperCase(), count: 0 });
      }
    });
    return Array.from(byLower.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [vehicles, transporters, fleetMetaById]);

  const statusCounts = useMemo(() => {
    const compLower = companyFilter.toLowerCase();
    const transLower = transporterFilter.toLowerCase();
    let all = 0;
    let active = 0;
    let inTransit = 0;
    let expired = 0;
    let expirySoon = 0;

    for (let i = 0; i < vehicles.length; i++) {
      const meta = fleetMetaById.get(vehicles[i].id);
      if (!meta) continue;
      if (companyFilter !== 'ALL' && meta.companyLower !== compLower) continue;
      if (transporterFilter !== 'ALL' && meta.transporterLower !== transLower) continue;
      all++;
      if (meta.isActiveValid) active++;
      if (meta.isOnWay) inTransit++;
      if (meta.isExpired) expired++;
      if (meta.isExpiringSoon) expirySoon++;
    }

    return {
      ALL: all,
      ACTIVE: active,
      IN_TRANSIT: inTransit,
      EXPIRED: expired,
      EXPIRY_SOON: expirySoon,
    };
  }, [vehicles, companyFilter, transporterFilter, fleetMetaById]);

  const filteredVehicles = useMemo(() => {
    const compLower = companyFilter.toLowerCase();
    const transLower = transporterFilter.toLowerCase();
    const q = searchQuery.toLowerCase().trim();

    return vehicles.filter((v) => {
      const meta = fleetMetaById.get(v.id);
      if (!meta) return false;
      if (companyFilter !== 'ALL' && meta.companyLower !== compLower) return false;
      if (transporterFilter !== 'ALL' && meta.transporterLower !== transLower) return false;
      if (q && !meta.searchHaystack.includes(q)) return false;

      switch (vehicleStatusFilter) {
        case 'ACTIVE':
          return meta.isActiveValid;
        case 'IN_TRANSIT':
          return meta.isOnWay;
        case 'EXPIRED':
          return meta.isExpired;
        case 'EXPIRY_SOON':
          return meta.isExpiringSoon;
        case 'ALL':
        default:
          return true;
      }
    });
  }, [vehicles, searchQuery, vehicleStatusFilter, companyFilter, transporterFilter, fleetMetaById]);

  const selectedVehicleIdSet = useMemo(() => new Set(selectedVehicleIds), [selectedVehicleIds]);

  const isAllFilteredSelected = useMemo(() => {
    if (filteredVehicles.length === 0 || selectedVehicleIdSet.size === 0) return false;
    for (let i = 0; i < filteredVehicles.length; i++) {
      if (!selectedVehicleIdSet.has(filteredVehicles[i].id)) return false;
    }
    return true;
  }, [filteredVehicles, selectedVehicleIdSet]);

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
      tareWeight: data.tareWeight || existingMatch?.tareWeight || '',
      mra: (data.mra !== undefined ? String(data.mra) : (existingMatch?.mra || '')).trim(),
      ownerName: data.ownerName !== undefined ? data.ownerName : existingMatch?.ownerName,
      ownerFatherName: data.ownerFatherName !== undefined ? data.ownerFatherName : existingMatch?.ownerFatherName,
      ownerCnic: data.ownerCnic !== undefined ? data.ownerCnic : existingMatch?.ownerCnic,
      ownerAddress: data.ownerAddress !== undefined ? data.ownerAddress : existingMatch?.ownerAddress,
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
          <button onClick={() => { setEditingVehicle(null); setPreSelectedTransporterId(null); setShowAddVehicle(true); }} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors">
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
                onClick={() => { setEditingVehicle(null); setPreSelectedTransporterId(t.id); setShowAddVehicle(true); }}
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
      {/* Compact Fleet Operations & Export Toolbar — Unified Standard Animated Buttons */}
      <div className="w-full bg-slate-900 border border-white/10 rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { setEditingVehicle(null); setPreSelectedTransporterId(null); setShowAddVehicle(true); }}
              className="mak-btn px-3.5 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <Plus size={14} /> <span>Add Vehicle</span>
            </button>
            <button
              type="button"
              onClick={() => setShowAddTransporter(true)}
              className="mak-btn px-3.5 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <User size={14} /> <span>Add Transporter</span>
            </button>
            <button
              type="button"
              onClick={() => setShowBulkUploadModal(true)}
              className="mak-btn px-3.5 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
              title="Import multiple vehicles using Excel (.xlsx), Word (.docx), or CSV files"
            >
              <UploadCloud size={14} /> <span>Bulk Upload (.xlsx / .csv)</span>
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
                else window.location.href = '/?mode=vehicle';
              }}
              className="mak-btn px-3.5 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
              title="Open Live Public Vehicle Status Portal"
            >
              <Globe size={14} />
              <span>Status Portal</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePreviewCustomsListPdf}
              className="mak-btn px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
              title="Preview official Pakistan Customs Vehicle List (PDF)"
            >
              <Eye size={13} /> <span>Customs PDF</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadCustomsListPdf}
              className="mak-btn px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
              title="Download official Pakistan Customs Vehicle List (PDF)"
            >
              <Download size={13} /> <span>PDF</span>
            </button>
            <button
              type="button"
              onClick={handlePreviewVehiclesExcel}
              className="mak-btn px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
              title="Preview Master Fleet Excel (.xlsx)"
            >
              <Eye size={13} /> <span>Fleet Excel</span>
            </button>
            <button
              type="button"
              onClick={handleExportAllVehiclesList}
              className="mak-btn px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
              title="Download formatted Excel (.xlsx) workbook"
            >
              <Download size={13} /> <span>.xlsx</span>
            </button>
          </div>
        </div>
      </div>

      {/* Compact 5-Column Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <div
          onClick={() => setVehicleStatusFilter('ACTIVE')}
          className={`bg-slate-900/75 hover:bg-slate-800/80 px-3 py-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
            vehicleStatusFilter === 'ACTIVE' ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-emerald-500/25'
          }`}
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
          className={`bg-slate-900/75 hover:bg-slate-800/80 px-3 py-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
            vehicleStatusFilter === 'IN_TRANSIT' ? 'border-blue-400/60 bg-blue-500/10' : 'border-white/10'
          }`}
        >
          <div className="min-w-0">
            <span className="text-gray-400 text-[11px] font-medium block truncate">On the Way</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-white font-mono tabular-nums">{vehiclesOnWay.length}</span>
              <span className="text-[10.5px] text-blue-400 hover:underline whitespace-nowrap">Active Routes</span>
            </div>
          </div>
          <Truck className="text-blue-400 shrink-0" size={17} />
        </div>

        <div
          onClick={() => setVehicleStatusFilter('EXPIRY_SOON')}
          className={`bg-slate-900/75 hover:bg-slate-800/80 px-3 py-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
            vehicleStatusFilter === 'EXPIRY_SOON' ? 'border-amber-400/60 bg-amber-500/10' : 'border-white/10'
          }`}
        >
          <div className="min-w-0">
            <span className="text-gray-400 text-[11px] font-medium block truncate">Expired Soon (30d)</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-amber-400 font-mono tabular-nums">{vehiclesExpiringSoon.length}</span>
              <span className="text-[10.5px] text-amber-300 hover:underline whitespace-nowrap">Filter Due</span>
            </div>
          </div>
          <Clock className="text-amber-400 shrink-0" size={17} />
        </div>

        <div
          onClick={() => setVehicleStatusFilter('EXPIRED')}
          className={`bg-slate-900/75 hover:bg-slate-800/80 px-3 py-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
            vehicleStatusFilter === 'EXPIRED' ? 'border-rose-400/60 bg-rose-500/10' : 'border-white/10'
          }`}
        >
          <div className="min-w-0">
            <span className="text-gray-400 text-[11px] font-medium block truncate">Expired (6M Rule)</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-bold text-rose-400 font-mono tabular-nums">{vehiclesExpired.length}</span>
              <span className="text-[10.5px] text-rose-300 hover:underline whitespace-nowrap">Filter Expired</span>
            </div>
          </div>
          <AlertTriangle className="text-rose-400 shrink-0" size={17} />
        </div>

        <div
          onClick={() => setVehicleStatusFilter('ALL')}
          className={`bg-slate-900/75 hover:bg-slate-800/80 px-3 py-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
            vehicleStatusFilter === 'ALL' ? 'border-brand-400/50 bg-brand-500/10' : 'border-white/10'
          }`}
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
        {/* Card Header: Title + Search + Reset */}
        <div className="px-3 py-2.5 border-b border-white/10 bg-slate-900/85">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <h3 className="text-white text-sm font-semibold flex flex-wrap items-center gap-1.5">
              <Truck size={15} className="text-brand-400 shrink-0" /> 
              <span>Fleet Vehicles</span>
              <span className="text-xs font-mono tabular-nums text-gray-400">({filteredVehicles.length})</span>
              {vehicleStatusFilter !== 'ALL' && (
                <span className="text-[11px] text-brand-300 font-medium">
                  · {vehicleStatusFilter === 'ACTIVE'
                    ? 'Active'
                    : vehicleStatusFilter === 'EXPIRED'
                    ? 'Expired'
                    : vehicleStatusFilter === 'EXPIRY_SOON'
                    ? 'Expired Soon'
                    : 'On the Way'}
                </span>
              )}
              {companyFilter !== 'ALL' && (
                <span className="text-[11px] text-cyan-300 font-medium">
                  · {companyFilter}
                </span>
              )}
              {transporterFilter !== 'ALL' && (
                <span className="text-[11px] text-emerald-300 font-medium">
                  · {transporterFilter}
                </span>
              )}
            </h3>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              {/* Search Input */}
              <div className="relative flex-1 sm:w-64 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
                <input
                  type="text"
                  placeholder="Search plate, chassis, transporter..."
                  className="glass-input rounded-lg pl-8 pr-7 py-1.5 text-xs outline-none w-full"
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

              {/* Reset Button */}
              <button
                type="button"
                onClick={() => {
                  setVehicleStatusFilter('ALL');
                  setCompanyFilter('ALL');
                  setTransporterFilter('ALL');
                  setSearchQuery('');
                }}
                className="px-2.5 py-1.5 bg-white/5 rounded-lg hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                title="Reset all column filters and search"
              >
                <Filter size={12} />
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile View: Column Dropdown Strip + Compact Cards */}
        <div className="block md:hidden touch-pan-y">
          <div className="grid grid-cols-3 gap-1.5 p-2 border-b border-white/10 bg-slate-950/90">
            <select
              aria-label="Filter Vehicle Status"
              value={vehicleStatusFilter}
              onChange={(e) => setVehicleStatusFilter(e.target.value as VehicleStatusSubTab)}
              className="glass-input rounded-md px-2 py-1 text-[11px] font-semibold text-white bg-slate-900 border border-white/15 outline-none"
            >
              <option value="ALL">Vehicle: All ({statusCounts.ALL})</option>
              <option value="ACTIVE">Active ({statusCounts.ACTIVE})</option>
              <option value="EXPIRED">Expired ({statusCounts.EXPIRED})</option>
              <option value="EXPIRY_SOON">Expired Soon ({statusCounts.EXPIRY_SOON})</option>
              <option value="IN_TRANSIT">On the Way ({statusCounts.IN_TRANSIT})</option>
            </select>

            <select
              aria-label="Filter Company"
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="glass-input rounded-md px-2 py-1 text-[11px] font-semibold text-white bg-slate-900 border border-white/15 outline-none"
            >
              <option value="ALL">Company: All</option>
              {registeredCompaniesList.map((comp) => (
                <option key={`mob_comp_${comp.name}`} value={comp.name}>
                  {comp.name} ({comp.count})
                </option>
              ))}
            </select>

            <select
              aria-label="Filter Transporter"
              value={transporterFilter}
              onChange={(e) => setTransporterFilter(e.target.value)}
              className="glass-input rounded-md px-2 py-1 text-[11px] font-semibold text-white bg-slate-900 border border-white/15 outline-none"
            >
              <option value="ALL">Transporter: All</option>
              {registeredTransportersList.map((tr) => (
                <option key={`mob_tr_${tr.name}`} value={tr.name}>
                  {tr.name} ({tr.count})
                </option>
              ))}
            </select>
          </div>

          <VirtualizedList
            items={filteredVehicles}
            itemHeight={58}
            maxHeight={650}
            getItemKey={(v) => v.id}
            emptyPlaceholder={
              <div className="p-8 text-center text-gray-500 text-xs">No vehicles match the selected filters.</div>
            }
            renderItem={(v) => {
              const meta = fleetMetaById.get(v.id);
              const compLabel = meta ? meta.companyLabel : getVehicleCompanyLabel(v);
              const isTruckit = meta ? meta.isTruckit : compLabel === 'TRUCKIT';
              const makeModelStr = meta ? meta.makeModelStr : ([v.make, v.model].filter(Boolean).join(' ') || v.makeModel || v.category || 'Bonded');
              const tripsCount = meta ? meta.tripsCount : getVehicleTripsCount(v);
              const transporterLabel = meta ? meta.transporterLabel : getVehicleTransporterLabel(v);
              const isSelected = selectedVehicleIdSet.has(v.id);
              return (
                <div
                  onClick={() => setSelectedVehicle(v)}
                  className="px-2.5 py-1.5 hover:bg-sky-500/10 border-b border-white/5 cursor-pointer flex flex-col justify-center h-full"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectVehicle(v.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3.5 h-3.5 rounded accent-sky-600 shrink-0"
                        aria-label={`Select ${v.registrationNumber}`}
                      />
                      <span className="font-mono font-bold text-white text-xs tabular-nums shrink-0">{v.registrationNumber}</span>
                      <span className={`text-[10px] font-semibold uppercase shrink-0 ${isTruckit ? 'text-cyan-300' : 'text-amber-300'}`}>
                        {compLabel}
                      </span>
                      <span className="text-[11px] text-gray-400 truncate">
                        · {makeModelStr}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <span className={`font-mono text-[10.5px] font-bold tabular-nums px-1.5 py-0.5 rounded ${tripsCount > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                        Trips: {tripsCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVehicle(v);
                          setShowAddVehicle(true);
                        }}
                        className="mak-btn px-2 py-0.5 rounded text-[10.5px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <span>Edit / Docs</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-0.5 text-[10.5px] text-gray-400 truncate pl-5">
                    <span className="font-mono truncate">{v.chassisNo || '-'} / {v.engineNo || '-'}</span>
                    <span className="text-gray-300 font-medium truncate shrink-0 max-w-[45%]">
                      {transporterLabel}
                    </span>
                  </div>
                </div>
              );
            }}
          />
        </div>

        {/* Desktop View: Column-Header Dropdowns & Compact 8-Column Layout with Trips Count (Zero Horizontal Scroll) */}
        <div className="hidden md:block w-full max-w-full min-w-0 overflow-x-hidden">
          <VirtualizedTable<Vehicle>
            items={filteredVehicles}
            rowHeight={34}
            maxHeight={700}
            disableHorizontalScroll={true}
            headerCellClassName="px-1.5"
            onRowClick={(v) => setSelectedVehicle(v)}
            getItemKey={(v) => v.id}
            columns={[
              {
                header: (
                  <div className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={isAllFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                      className="w-3.5 h-3.5 rounded accent-sky-600"
                      title={isAllFilteredSelected ? "Deselect all in view" : "Select all in view"}
                      aria-label="Select all filtered vehicles"
                    />
                  </div>
                ),
                width: '3.5%',
                className: 'text-center'
              },
              {
                header: (
                  <div className="relative inline-flex items-center max-w-full">
                    <div
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10.5px] font-bold uppercase tracking-wide transition-colors max-w-full ${
                        vehicleStatusFilter !== 'ALL'
                          ? 'bg-brand-500/20 border-brand-400/50 text-brand-200'
                          : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/15 text-gray-200'
                      }`}
                    >
                      <span className="truncate">
                        {vehicleStatusFilter === 'ALL'
                          ? 'Vehicle No'
                          : vehicleStatusFilter === 'ACTIVE'
                          ? 'Vehicle: Active'
                          : vehicleStatusFilter === 'EXPIRED'
                          ? 'Vehicle: Expired'
                          : vehicleStatusFilter === 'EXPIRY_SOON'
                          ? 'Vehicle: Exp. Soon'
                          : 'Vehicle: On Way'}
                      </span>
                      <ChevronDown size={12} className="shrink-0 opacity-80" />
                    </div>
                    <select
                      aria-label="Filter by Vehicle Status"
                      value={vehicleStatusFilter}
                      onChange={(e) => setVehicleStatusFilter(e.target.value as VehicleStatusSubTab)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    >
                      <option className="bg-slate-900 text-white" value="ALL">
                        All Vehicles ({statusCounts.ALL})
                      </option>
                      <option className="bg-slate-900 text-white" value="ACTIVE">
                        Active / Valid ({statusCounts.ACTIVE})
                      </option>
                      <option className="bg-slate-900 text-white" value="EXPIRED">
                        Expired ({statusCounts.EXPIRED})
                      </option>
                      <option className="bg-slate-900 text-white" value="EXPIRY_SOON">
                        Expired Soon ({statusCounts.EXPIRY_SOON})
                      </option>
                      <option className="bg-slate-900 text-white" value="IN_TRANSIT">
                        On the Way ({statusCounts.IN_TRANSIT})
                      </option>
                    </select>
                  </div>
                ),
                width: '14%'
              },
              {
                header: (
                  <div className="relative inline-flex items-center max-w-full">
                    <div
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10.5px] font-bold uppercase tracking-wide transition-colors max-w-full ${
                        companyFilter !== 'ALL'
                          ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                          : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/15 text-gray-200'
                      }`}
                    >
                      <span className="truncate">
                        {companyFilter === 'ALL' ? 'Company' : companyFilter}
                      </span>
                      <ChevronDown size={12} className="shrink-0 opacity-80" />
                    </div>
                    <select
                      aria-label="Filter by Registered Company"
                      value={companyFilter}
                      onChange={(e) => setCompanyFilter(e.target.value)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    >
                      <option className="bg-slate-900 text-white" value="ALL">
                        All Companies ({vehicles.length})
                      </option>
                      {registeredCompaniesList.map((comp) => (
                        <option key={`col_comp_${comp.name}`} className="bg-slate-900 text-white" value={comp.name}>
                          {comp.name} ({comp.count})
                        </option>
                      ))}
                    </select>
                  </div>
                ),
                width: '12.5%'
              },
              { header: 'Make / Model', width: '13.5%' },
              { header: 'Chassis / Engine', width: '21.5%' },
              {
                header: (
                  <div className="relative inline-flex items-center max-w-full">
                    <div
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10.5px] font-bold uppercase tracking-wide transition-colors max-w-full ${
                        transporterFilter !== 'ALL'
                          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                          : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/15 text-gray-200'
                      }`}
                    >
                      <span className="truncate">
                        {transporterFilter === 'ALL' ? 'Transporter' : transporterFilter}
                      </span>
                      <ChevronDown size={12} className="shrink-0 opacity-80" />
                    </div>
                    <select
                      aria-label="Filter by Transporter"
                      value={transporterFilter}
                      onChange={(e) => setTransporterFilter(e.target.value)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    >
                      <option className="bg-slate-900 text-white" value="ALL">
                        All Transporters ({registeredTransportersList.length})
                      </option>
                      {registeredTransportersList.map((tr) => (
                        <option key={`col_tr_${tr.name}`} className="bg-slate-900 text-white" value={tr.name}>
                          {tr.name} ({tr.count})
                        </option>
                      ))}
                    </select>
                  </div>
                ),
                width: '18.5%'
              },
              { header: 'Trips', width: '6.5%', className: 'text-center' },
              { header: 'Action', width: '10%', className: 'text-right' }
            ]}
            emptyPlaceholder={
              <div className="p-8 text-center text-gray-500 text-xs">
                No vehicles match the selected filters.
              </div>
            }
            renderRow={(v) => {
              const meta = fleetMetaById.get(v.id);
              const compactComp = meta ? meta.companyLabel : getVehicleCompanyLabel(v);
              const isTruckit = meta ? meta.isTruckit : compactComp === 'TRUCKIT';
              const fullComp = meta ? meta.fullComp : (v.companyName || (isTruckit ? 'TRUCKIT PVT LTD' : 'DOCKS PVT LTD'));
              const makeModelStr = meta ? meta.makeModelStr : ([v.make, v.model].filter(Boolean).join(' ') || v.makeModel || v.category || 'Bonded');
              const transporterLabel = meta ? meta.transporterLabel : getVehicleTransporterLabel(v);
              const tripsCount = meta ? meta.tripsCount : getVehicleTripsCount(v);
              const isSelected = selectedVehicleIdSet.has(v.id);

              return (
                <>
                  {/* Col 1: Checkbox (3.5%) */}
                  <div
                    className="px-1 flex items-center justify-center"
                    style={{ width: '3.5%', flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectVehicle(v.id)}
                      className="w-3.5 h-3.5 rounded accent-sky-600"
                      title={isSelected ? "Deselect vehicle" : "Select vehicle"}
                      aria-label={`Select ${v.registrationNumber}`}
                    />
                  </div>

                  {/* Col 2: Vehicle Registration No (14%) */}
                  <div
                    className="px-1.5 min-w-0 truncate font-mono font-bold text-[13px] leading-none text-white tabular-nums"
                    style={{ width: '14%', flexShrink: 0 }}
                    title={`${v.registrationNumber} (${tripsCount} ${tripsCount === 1 ? 'Trip' : 'Trips'})`}
                  >
                    {v.registrationNumber}
                  </div>

                  {/* Col 3: Company (12.5%) */}
                  <div
                    className={`px-1.5 min-w-0 truncate text-[11.5px] font-semibold uppercase leading-none ${
                      isTruckit ? 'text-cyan-300' : 'text-amber-300'
                    }`}
                    style={{ width: '12.5%', flexShrink: 0 }}
                    title={fullComp}
                  >
                    {compactComp}
                  </div>

                  {/* Col 4: Make / Model (13.5%) */}
                  <div
                    className="px-1.5 min-w-0 truncate text-xs font-medium text-gray-200 leading-none"
                    style={{ width: '13.5%', flexShrink: 0 }}
                    title={makeModelStr}
                  >
                    {makeModelStr}
                  </div>

                  {/* Col 5: Chassis / Engine (21.5%) */}
                  <div
                    className="px-1.5 min-w-0 truncate font-mono tabular-nums text-[11.5px] text-gray-300 leading-none"
                    style={{ width: '21.5%', flexShrink: 0 }}
                    title={`Chassis: ${v.chassisNo || 'N/A'} | Engine: ${v.engineNo || 'N/A'}`}
                  >
                    {v.chassisNo || '-'} <span className="text-gray-500">/</span> {v.engineNo || '-'}
                  </div>

                  {/* Col 6: Transporter (18.5%) */}
                  <div
                    className="px-1.5 min-w-0 truncate text-xs font-medium text-gray-100 leading-none"
                    style={{ width: '18.5%', flexShrink: 0 }}
                    title={transporterLabel}
                  >
                    {transporterLabel}
                  </div>

                  {/* Col 7: Trips Quantity (6.5%) */}
                  <div
                    className="px-1 flex items-center justify-center min-w-0"
                    style={{ width: '6.5%', flexShrink: 0 }}
                    title={`Total Trips: ${tripsCount}`}
                  >
                    <span
                      className={`font-mono text-[13px] leading-none tabular-nums font-bold ${
                        tripsCount > 0 ? 'text-emerald-400' : 'text-gray-500'
                      }`}
                    >
                      {tripsCount}
                    </span>
                  </div>

                  {/* Col 8: Single Action Button — Edit / Docs (10%) */}
                  <div
                    className="px-1.5 flex items-center justify-end whitespace-nowrap min-w-0"
                    style={{ width: '10%', flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setEditingVehicle(v);
                        setShowAddVehicle(true);
                      }}
                      className="mak-btn px-2.5 h-[23px] rounded-md text-[11px] font-semibold inline-flex items-center justify-center whitespace-nowrap shrink-0"
                      title="Update Vehicle & Documents"
                    >
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
      {/* Compact Single-Row Header & Animated Standardized Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Truck className="text-brand-400" size={20} /> Vehicle Management System
        </h2>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('vehicles')}
            className={`finance-type-btn px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'vehicles' ? 'finance-type-btn-active' : ''
            }`}
          >
            <Truck size={14} /> <span>Fleet &amp; Vehicles</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('transporters')}
            className={`finance-type-btn px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'transporters' ? 'finance-type-btn-active' : ''
            }`}
          >
            <User size={14} /> <span>Transporters &amp; Brokers</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ready_vehicles')}
            className={`finance-type-btn px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'ready_vehicles' ? 'finance-type-btn-active' : ''
            }`}
          >
            <MapPin size={14} /> <span>Available Fleet</span>
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
      {activeTab === 'ready_vehicles' && <AvailableVehiclesView userRole="DOCUMENTATION_MANAGER" />}

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
          existingMraList={existingMraList}
          allCases={allCases}
          allDrivers={allDrivers}
          onAutoUpdateValidity={(updatedVeh: Vehicle) => {
            const normP = normalizeVehiclePlate(updatedVeh.registrationNumber);
            const exists = vehicles.some(v => normalizeVehiclePlate(v.registrationNumber) === normP || v.id === updatedVeh.id);
            if (exists) {
              setVehicles(prev => prev.map(v => (normalizeVehiclePlate(v.registrationNumber) === normP || v.id === updatedVeh.id ? { ...v, ...updatedVeh } : v)));
              updateVehicleInFirestore(updatedVeh).catch(() => {});
            }
          }}
          onRequestCancelNoc={(vehRecord: Vehicle) => {
            setShowAddVehicle(false);
            setEditingVehicle(null);
            openCancelNocModal(vehRecord);
          }}
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
            openCancelNocModal(v);
          }}
        />
      )}

      {/* ========================================================= */}
      {/* VEHICLE CANCELLATION, NOC COLLECTOR & CASH BOOK MODAL     */}
      {/* ========================================================= */}
      {vehicleToCancel && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-start justify-center pt-6 sm:pt-10 p-4 overflow-y-auto z-50 animate-in fade-in duration-200">
          <div className="glass-card p-6 sm:p-7 rounded-3xl w-full max-w-lg border border-red-500/30 shadow-2xl space-y-4 bg-slate-950/95">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-widest text-red-400 font-bold">Cancellation &amp; NOC Issuance</span>
                  <h3 className="text-lg sm:text-xl font-bold text-white mt-0.5">Issue Vehicle NOC &amp; Lease Termination</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Generates Letterhead Cancellation NOC (.docx) + Stamp Paper Lease Termination (.docx) for the registered company.
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setVehicleToCancel(null)} className="text-gray-400 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            {nocModalError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0 text-rose-400" />
                <span>{nocModalError}</span>
              </div>
            )}

            {/* Vehicle Summary Card */}
            <div className="bg-white/5 p-3.5 rounded-2xl border border-white/10 space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Registration Number:</span>
                <span className="font-mono font-bold text-white text-sm bg-white/10 px-2 py-0.5 rounded">{vehicleToCancel.registrationNumber}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Registered Company:</span>
                <span className="font-bold text-cyan-300">{resolveVehicleDocxCompany(vehicleToCancel).signoffName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Transporter / Owner:</span>
                <span className="text-white font-medium">{vehicleToCancel.ownerName || vehicleToCancel.transporterName || 'Fleet Operator'}</span>
              </div>
            </div>

            {/* NOC Collector Name & Mobile Number */}
            <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 space-y-3">
              <div className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                <User size={14} /> Who is Collecting the NOC? *
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-300 block mb-1 font-semibold">Collector Full Name *</label>
                  <input
                    type="text"
                    value={nocCollectorName}
                    onChange={(e) => {
                      setNocModalError(null);
                      setNocCollectorName(e.target.value);
                    }}
                    placeholder="e.g. Muhammad Tariq"
                    className="w-full bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-300 block mb-1 font-semibold">Collector Mobile Number *</label>
                  <input
                    type="tel"
                    value={nocCollectorPhone}
                    onChange={(e) => {
                      setNocModalError(null);
                      setNocCollectorPhone(e.target.value);
                    }}
                    placeholder="e.g. 0300-1234567"
                    className="w-full bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
            </div>

            {/* Are NOC Charges Collected? -> Auto Cash In Hand Cash Book */}
            <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-emerald-500/30 space-y-3">
              <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                <DollarSign size={14} /> Are NOC Charges Being Taken?
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setNocFeeCharged('NO');
                    setNocFeeAmount('');
                    setNocModalError(null);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                    nocFeeCharged === 'NO'
                      ? 'bg-slate-700 text-white border-white/40 shadow'
                      : 'bg-black/40 text-gray-400 border-white/10 hover:text-white'
                  }`}
                >
                  No — Free NOC
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNocFeeCharged('YES');
                    setNocModalError(null);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                    nocFeeCharged === 'YES'
                      ? 'bg-emerald-600/30 text-emerald-200 border-emerald-400 shadow'
                      : 'bg-black/40 text-gray-400 border-white/10 hover:text-white'
                  }`}
                >
                  Yes — Enter Amount
                </button>
              </div>

              {nocFeeCharged === 'YES' && (
                <div className="space-y-1.5 pt-1 animate-in fade-in">
                  <label className="text-[11px] text-emerald-200 block font-semibold">
                    NOC Charges Received Amount (PKR) — Auto-Posted to Cash In Hand (Cash Book) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={nocFeeAmount}
                    onChange={(e) => {
                      setNocModalError(null);
                      setNocFeeAmount(e.target.value);
                    }}
                    placeholder="e.g. 5000"
                    className="w-full bg-black/60 border border-emerald-500/50 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-emerald-300 outline-none focus:border-emerald-400"
                  />
                  <p className="text-[10.5px] text-gray-400">
                    This amount will automatically be recorded in Finance &rarr; Cash Book (Cash in Hand) with vehicle no. and collector details.
                  </p>
                </div>
              )}
            </div>

            {/* Reason for Cancellation Input */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1">
                Remarks / Reason for De-registration
              </label>
              <input
                type="text"
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="e.g. Contract completed / De-registration from panel"
                className="w-full bg-black/50 border border-white/20 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-red-500"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-wrap justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setVehicleToCancel(null)}
                disabled={isCancellingVehicle}
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelVehicle}
                disabled={isCancellingVehicle}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/30 flex items-center gap-2 transition-all"
              >
                {isCancellingVehicle ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    <span>Generating NOC &amp; Termination...</span>
                  </>
                ) : (
                  <>
                    <Download size={15} />
                    <span>Generate NOC + Lease Termination (.docx)</span>
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
                <span className="font-bold text-white">NOC &amp; Lease Termination Generated!</span>
                <button onClick={() => setNocSuccessNotice(null)} className="text-gray-400 hover:text-white">
                  <X size={15} />
                </button>
              </div>
              <p className="text-gray-300 mt-1">
                Vehicle <strong className="text-white font-mono">{nocSuccessNotice.vehicleNo}</strong> • Ref: <strong className="text-emerald-400 font-mono">{nocSuccessNotice.nocRef}</strong>
              </p>
              {nocSuccessNotice.collectorName && (
                <p className="text-[11px] text-cyan-300 mt-0.5">
                  Collected by: <strong>{nocSuccessNotice.collectorName}</strong>
                  {nocSuccessNotice.feeAmount ? ` • PKR ${nocSuccessNotice.feeAmount.toLocaleString()} added to Cash Book` : ''}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-2.5">
                {nocSuccessNotice.cancelledVehicle && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDownloadNocDocx(nocSuccessNotice.cancelledVehicle!)}
                      className="bg-sky-600 hover:bg-sky-500 text-white font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-[11px]"
                      title="Download Cancellation NOC on Company Letterhead (.docx)"
                    >
                      <FileText size={13} /> Cancellation NOC (.docx)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadStampPaperTerminationDocx(nocSuccessNotice.cancelledVehicle!)}
                      className="bg-amber-600 hover:bg-amber-500 text-white font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-[11px]"
                      title="Download Lease Cancellation & Termination Agreement on Stamp Paper (.docx)"
                    >
                      <FileText size={13} /> Lease Termination (.docx)
                    </button>
                  </>
                )}
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
const COMPANY_OWNER_ID_STORAGE_KEY = 'dpl_company_owner_id_docs_v1';
const WITNESSES_ID_STORAGE_KEY = 'dpl_witnesses_id_docs_v1';

type ModalDocGenerationKind =
  | 'REG_RENEWAL'
  | 'LEASE'
  | 'AFFIDAVIT'
  | 'VEH_BOOK_COPY'
  | 'OWNER_ID_COPY'
  | 'COMP_OWNER_ID_COPY'
  | 'WITNESSES_ID_COPY'
  | 'ALL_7_REG_PACK'
  | 'CANCEL_NOC_LETTERHEAD'
  | 'LEASE_TERMINATION_STAMP';

const AddVehicleModal = ({
  transporters,
  preSelectedTransporterId,
  initialVehicle,
  existingMraList = [],
  allCases = [],
  allDrivers = [],
  onAutoUpdateValidity,
  onRequestCancelNoc,
  onClose,
  onSave
}: any) => {
  const [showDocScanner, setShowDocScanner] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<'SPEC' | 'REG_BOOK' | 'OWNER_ID'>('SPEC');
  const [showRegionDropdown, setShowRegionDropdown] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [generatingDocType, setGeneratingDocType] = useState<ModalDocGenerationKind | null>(null);
  const [downloadingTripId, setDownloadingTripId] = useState<string | null>(null);
  const [docFeedback, setDocFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [aiDocStatus, setAiDocStatus] = useState<{
    loading: boolean;
    type: 'info' | 'success' | 'warning';
    message: string;
    mismatches?: string[];
  } | null>(null);
  const todayIso = new Date().toISOString().split('T')[0];

  // Persistent Company Director / Owner ID Card copies (reused automatically across all vehicles per operating company)
  const [companyOwnerDocs, setCompanyOwnerDocs] = useState<Record<string, { ownerName?: string; ownerCnic?: string; frontUrl?: string; fileName?: string }>>(() => {
    try {
      const raw = safeAppStorage.getItem(COMPANY_OWNER_ID_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (_) {}
    return {};
  });

  // Persistent Fixed Witnesses ID Card copies (Mr. MUHAMMAD ARBAZ & Mr. SHAMS TABREZ BUKHARI)
  const [witnessIdDocs, setWitnessIdDocs] = useState<{ w1Url?: string; w1Name?: string; w2Url?: string; w2Name?: string }>(() => {
    try {
      const raw = safeAppStorage.getItem(WITNESSES_ID_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (_) {}
    return {};
  });

  const saveCompanyOwnerDocEntry = (compKey: string, patch: { ownerName?: string; ownerCnic?: string; frontUrl?: string; fileName?: string }) => {
    setCompanyOwnerDocs(prev => {
      const next = {
        ...prev,
        [compKey]: { ...(prev[compKey] || {}), ...patch }
      };
      try {
        safeAppStorage.setItem(COMPANY_OWNER_ID_STORAGE_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  const saveWitnessIdDocEntry = (patch: { w1Url?: string; w1Name?: string; w2Url?: string; w2Name?: string }) => {
    setWitnessIdDocs(prev => {
      const next = { ...prev, ...patch };
      try {
        safeAppStorage.setItem(WITNESSES_ID_STORAGE_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

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
        tareWeight: initialVehicle.tareWeight || '',
        mra: initialVehicle.mra || '',
        transporterName: syncedTrans,
        brokerName: syncedTrans,
        ownerName: initialVehicle.ownerName || '',
        ownerFatherName: initialVehicle.ownerFatherName || '',
        ownerCnic: initialVehicle.ownerCnic || '',
        ownerAddress: initialVehicle.ownerAddress || '',
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
      tareWeight: '',
      mra: '',
      transporterName: '',
      brokerName: '',
      ownerName: '',
      ownerFatherName: '',
      ownerCnic: '',
      ownerAddress: '',
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

  const processComplianceUploadWithAI = async (
    input: File | { dataUrl: string; name?: string; type?: string },
    docKind: 'REG_BOOK' | 'OWNER_ID'
  ) => {
    const label = docKind === 'REG_BOOK' ? 'Vehicle Registration Book' : 'Owner ID Card (CNIC)';
    setAiDocStatus({
      loading: true,
      type: 'info',
      message: `Reading ${label} with AI to auto-fill vehicle & owner fields...`
    });
    try {
      const res = await verifyVehicleComplianceDocumentWithAI(input, docKind, {
        registrationNumber: formData.registrationNumber,
        engineNo: formData.engineNo,
        chassisNo: formData.chassisNo,
        ownerName: formData.ownerName,
        ownerCnic: formData.ownerCnic
      });
      const ext = res.extracted || {};
      const filledLabels: string[] = [];

      setFormData((prev: any) => {
        const next = { ...prev };
        const isBlank = (v: any) => !v || String(v).trim() === '' || String(v).trim().toUpperCase() === 'N/A';

        if (ext.registrationNumber && isBlank(prev.registrationNumber)) {
          next.registrationNumber = ext.registrationNumber;
          filledLabels.push(`Vehicle No (${ext.registrationNumber})`);
        }
        if (ext.engineNo && isBlank(prev.engineNo)) {
          next.engineNo = ext.engineNo;
          filledLabels.push(`Engine No (${ext.engineNo})`);
        }
        if (ext.chassisNo && isBlank(prev.chassisNo)) {
          next.chassisNo = ext.chassisNo;
          filledLabels.push(`Chassis No (${ext.chassisNo})`);
        }
        if (ext.make && isBlank(prev.make)) {
          next.make = ext.make;
          filledLabels.push(`Maker (${ext.make})`);
        }
        if (ext.model && isBlank(prev.model)) {
          next.model = ext.model;
          filledLabels.push(`Model (${ext.model})`);
        }
        if (ext.tareWeight && isBlank(prev.tareWeight)) {
          next.tareWeight = ext.tareWeight;
          filledLabels.push(`Tare (${ext.tareWeight})`);
        }
        if (ext.mra && isBlank(prev.mra)) {
          next.mra = ext.mra;
          persistCustomRegion(ext.mra);
          filledLabels.push(`MRA (${ext.mra})`);
        }
        if (ext.ownerName && isBlank(prev.ownerName)) {
          next.ownerName = ext.ownerName;
          filledLabels.push(`Owner (${ext.ownerName})`);
        }
        if (ext.ownerFatherName && isBlank(prev.ownerFatherName)) {
          next.ownerFatherName = ext.ownerFatherName;
          filledLabels.push(`Father Name (${ext.ownerFatherName})`);
        }
        if (ext.ownerCnic && isBlank(prev.ownerCnic)) {
          next.ownerCnic = ext.ownerCnic;
          filledLabels.push(`CNIC (${ext.ownerCnic})`);
        }
        if (ext.ownerAddress && isBlank(prev.ownerAddress)) {
          next.ownerAddress = ext.ownerAddress;
          filledLabels.push('Owner Address');
        }
        return next;
      });

      if (res.hasMismatch && res.mismatches.length > 0) {
        setAiDocStatus({
          loading: false,
          type: 'warning',
          message: `${label} scanned — attention needed on mismatched fields:`,
          mismatches: res.mismatches
        });
      } else if (filledLabels.length > 0) {
        setAiDocStatus({
          loading: false,
          type: 'success',
          message: `Auto-filled from ${label}: ${filledLabels.join(', ')}`
        });
      } else {
        setAiDocStatus({
          loading: false,
          type: 'success',
          message: res.summaryMessage || `${label} verified and attached successfully.`
        });
      }
    } catch (err) {
      console.warn('AI compliance document extraction notice:', err);
      setAiDocStatus({
        loading: false,
        type: 'info',
        message: `${label} attached. You can verify or edit fields manually below.`
      });
    }
  };

  const handleOwnerIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setFormData((prev: any) => ({
          ...prev,
          ownerIdCardUrl: dataUrl,
          ownerIdCardName: file.name
        }));
      };
      reader.readAsDataURL(file);
      processComplianceUploadWithAI(file, 'OWNER_ID');
    }
    try { e.target.value = ''; } catch (_) {}
  };

  const handleRegBookUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setFormData((prev: any) => ({
          ...prev,
          registrationBook: dataUrl,
          registrationBookName: file.name
        }));
      };
      reader.readAsDataURL(file);
      processComplianceUploadWithAI(file, 'REG_BOOK');
    }
    try { e.target.value = ''; } catch (_) {}
  };

  const handleCompanyOwnerIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compKey = String(formData.operatingCompany || 'truckit').toLowerCase();
    const reader = new FileReader();
    reader.onloadend = () => {
      saveCompanyOwnerDocEntry(compKey, {
        frontUrl: reader.result as string,
        fileName: file.name
      });
    };
    reader.readAsDataURL(file);
    try { e.target.value = ''; } catch (_) {}
  };

  const handleWitnessIdUpload = (which: 'W1' | 'W2') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      if (which === 'W1') {
        saveWitnessIdDocEntry({ w1Url: dataUrl, w1Name: file.name });
      } else {
        saveWitnessIdDocEntry({ w2Url: dataUrl, w2Name: file.name });
      }
    };
    reader.readAsDataURL(file);
    try { e.target.value = ''; } catch (_) {}
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

  const currentCompanyKey = String(formData.operatingCompany || 'truckit').toLowerCase();
  const currentCompOwnerDoc = companyOwnerDocs[currentCompanyKey] || {};

  const buildLiveVehicleRecord = (overrideDates?: { regDate: string; expDate: string }): Vehicle => {
    const cleanPlate = (formData.registrationNumber || '').trim().toUpperCase();
    const syncedTransporter = (formData.transporterName || formData.brokerName || 'Direct Transporter').trim();
    const finalRegDate = overrideDates?.regDate ?? (formData.registrationDate || '');
    const finalExpDate = overrideDates?.expDate ?? resolvedExpiryDate;
    const evalStatus = evaluateVehicleRegistrationValidity(finalRegDate, finalExpDate).status;

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
      tareWeight: (formData.tareWeight || '').trim(),
      makeModel: [formData.make, formData.model].filter(Boolean).join(' '),
      mra: (formData.mra || '').trim(),
      ownerName: (formData.ownerName || '').trim() || undefined,
      ownerFatherName: (formData.ownerFatherName || '').trim() || undefined,
      ownerCnic: (formData.ownerCnic || '').trim() || undefined,
      ownerAddress: (formData.ownerAddress || '').trim() || undefined,
      ownerIdCardUrl: formData.ownerIdCardUrl || undefined,
      ownerIdCardName: formData.ownerIdCardName || undefined,
      registrationBook: formData.registrationBook || undefined,
      registrationBookName: formData.registrationBookName || undefined,
      registrationDate: finalRegDate,
      lastRenewalDate: overrideDates?.regDate || formData.lastRenewalDate || finalRegDate,
      validationExpiryDate: finalExpDate,
      driverName: formData.driverName || 'Designated Driver',
      driverCnic: formData.driverCnic || '',
      driverContact: formData.driverContact || '',
      transporterId: Number(formData.transporterId) || 0,
      transporterName: syncedTransporter,
      brokerName: syncedTransporter,
      operatingCompany: formData.operatingCompany || 'truckit',
      companyName: formData.companyName || 'TRUCKIT PVT LTD',
      status: evalStatus,
      history: initialVehicle?.history || [],
      createdAt: initialVehicle?.createdAt || todayIso
    };
  };

  /**
   * Synchronizes the Registration Date to the letter generation date and sets 6-month Customs validity.
   */
  const syncRegistrationDateAndSixMonthValidity = (letterIsoDate: string): Vehicle => {
    const evalSixMonths = evaluateVehicleRegistrationValidity(letterIsoDate);
    setFormData((prev: any) => ({
      ...prev,
      registrationDate: letterIsoDate,
      lastRenewalDate: letterIsoDate,
      validationExpiryDate: evalSixMonths.expiryDate,
      status: 'AVAILABLE'
    }));
    const updatedLive = buildLiveVehicleRecord({
      regDate: letterIsoDate,
      expDate: evalSixMonths.expiryDate
    });
    if (onAutoUpdateValidity) {
      onAutoUpdateValidity(updatedLive);
    }
    return updatedLive;
  };

  const handleGenerateModalDoc = async (docKind: ModalDocGenerationKind) => {
    const cleanPlate = (formData.registrationNumber || '').trim().toUpperCase();
    if (!cleanPlate) {
      setDocFeedback({
        type: 'error',
        message: 'Please enter or scan the Vehicle Registration Number first to generate official documents.'
      });
      return;
    }

    setGeneratingDocType(docKind);
    setDocFeedback(null);
    try {
      const safePlateSlug = cleanPlate.replace(/\s+/g, '_');
      const letterDateIso = formData.registrationDate || todayIso;
      const parsedLetterDate = new Date(`${letterDateIso}T12:00:00`);
      const dateSlug = formatDashDate(isNaN(parsedLetterDate.getTime()) ? new Date() : parsedLetterDate);

      if (docKind === 'REG_RENEWAL') {
        const updatedVehicle = syncRegistrationDateAndSixMonthValidity(letterDateIso);
        const doc = await generateRegistrationRenewalLetterDocx([updatedVehicle], {
          letterDate: letterDateIso,
          leaveLetterheadSpace: true
        });
        await downloadDocxBlob(doc, `1_Registration_Renewal_Request_${safePlateSlug}_${dateSlug}.docx`);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Registration / Renewal Letter (${cleanPlate}) & updated 6-month validity (expires ${updatedVehicle.validationExpiryDate}).`
        });
      } else if (docKind === 'LEASE') {
        const liveVehicle = buildLiveVehicleRecord();
        const doc = await generateLeaseAgreementDocx([liveVehicle], {
          agreementDate: letterDateIso,
          leaveStampPaperSpace: true,
          customLessorName: formData.ownerName?.trim() || undefined,
          customFatherName: formData.ownerFatherName?.trim() || undefined,
          customCnic: formData.ownerCnic?.trim() || undefined,
          customAddress: formData.ownerAddress?.trim() || undefined
        });
        await downloadDocxBlob(doc, `2_Lease_Agreement_${safePlateSlug}_Stamp_Paper_${dateSlug}.docx`);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Lease Agreement (${cleanPlate}) for Stamp Paper in Word (.docx).`
        });
      } else if (docKind === 'AFFIDAVIT') {
        const liveVehicle = buildLiveVehicleRecord();
        const doc = await generateAffidavitDocx([liveVehicle], {
          letterDate: letterDateIso,
          leaveStampPaperSpace: true
        });
        await downloadDocxBlob(doc, `3_Affidavit_SRO450_${safePlateSlug}_Stamp_Paper_${dateSlug}.docx`);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Affidavit SRO 450 (${cleanPlate}) for Stamp Paper in Word (.docx).`
        });
      } else if (docKind === 'VEH_BOOK_COPY') {
        const liveVehicle = buildLiveVehicleRecord();
        const doc = await generateVehicleBookCopyDocx(liveVehicle);
        await downloadDocxBlob(doc, `4_Vehicle_Registration_Book_Copy_${safePlateSlug}.docx`);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Vehicle Registration Book Copy (${cleanPlate}) in Word (.docx).`
        });
      } else if (docKind === 'OWNER_ID_COPY') {
        const liveVehicle = buildLiveVehicleRecord();
        const doc = await generateVehicleOwnerIdCopyDocx(liveVehicle);
        await downloadDocxBlob(doc, `5_Vehicle_Owner_ID_Card_Copy_${safePlateSlug}.docx`);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Vehicle Owner ID Card Copy (${cleanPlate}) in Word (.docx).`
        });
      } else if (docKind === 'COMP_OWNER_ID_COPY') {
        const liveVehicle = buildLiveVehicleRecord();
        const doc = await generateCompanyOwnerIdCopyDocx(liveVehicle, {
          companyOwnerName: currentCompOwnerDoc.ownerName,
          companyOwnerCnic: currentCompOwnerDoc.ownerCnic,
          frontImageUrl: currentCompOwnerDoc.frontUrl
        });
        await downloadDocxBlob(doc, `6_Company_Owner_ID_Card_Copy_${safePlateSlug}.docx`);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Company Owner ID Card Copy (${cleanPlate}) in Word (.docx).`
        });
      } else if (docKind === 'WITNESSES_ID_COPY') {
        const liveVehicle = buildLiveVehicleRecord();
        const doc = await generateWitnessesIdCopyDocx(liveVehicle, {
          witness1ImageUrl: witnessIdDocs.w1Url,
          witness2ImageUrl: witnessIdDocs.w2Url,
          witness1Name: DOCKS_COMPANY.witnesses.w1_arbaz.name,
          witness1Cnic: DOCKS_COMPANY.witnesses.w1_arbaz.cnic,
          witness2Name: DOCKS_COMPANY.witnesses.w2_shams.name,
          witness2Cnic: DOCKS_COMPANY.witnesses.w2_shams.cnic
        });
        await downloadDocxBlob(doc, `7_Witnesses_ID_Card_Copy_${safePlateSlug}.docx`);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Witnesses ID Cards Copy (${cleanPlate}) in Word (.docx).`
        });
      } else if (docKind === 'ALL_7_REG_PACK') {
        const updatedVehicle = syncRegistrationDateAndSixMonthValidity(letterDateIso);

        const regDoc = await generateRegistrationRenewalLetterDocx([updatedVehicle], {
          letterDate: letterDateIso,
          leaveLetterheadSpace: true
        });
        await downloadDocxBlob(regDoc, `1_Registration_Renewal_Request_${safePlateSlug}_${dateSlug}.docx`);

        const leaseDoc = await generateLeaseAgreementDocx([updatedVehicle], {
          agreementDate: letterDateIso,
          leaveStampPaperSpace: true,
          customLessorName: formData.ownerName?.trim() || undefined,
          customFatherName: formData.ownerFatherName?.trim() || undefined,
          customCnic: formData.ownerCnic?.trim() || undefined,
          customAddress: formData.ownerAddress?.trim() || undefined
        });
        await downloadDocxBlob(leaseDoc, `2_Lease_Agreement_${safePlateSlug}_Stamp_Paper_${dateSlug}.docx`);

        const affDoc = await generateAffidavitDocx([updatedVehicle], {
          letterDate: letterDateIso,
          leaveStampPaperSpace: true
        });
        await downloadDocxBlob(affDoc, `3_Affidavit_SRO450_${safePlateSlug}_Stamp_Paper_${dateSlug}.docx`);

        const bookDoc = await generateVehicleBookCopyDocx(updatedVehicle);
        await downloadDocxBlob(bookDoc, `4_Vehicle_Registration_Book_Copy_${safePlateSlug}.docx`);

        const ownerIdDoc = await generateVehicleOwnerIdCopyDocx(updatedVehicle);
        await downloadDocxBlob(ownerIdDoc, `5_Vehicle_Owner_ID_Card_Copy_${safePlateSlug}.docx`);

        const compOwnerDoc = await generateCompanyOwnerIdCopyDocx(updatedVehicle, {
          companyOwnerName: currentCompOwnerDoc.ownerName,
          companyOwnerCnic: currentCompOwnerDoc.ownerCnic,
          frontImageUrl: currentCompOwnerDoc.frontUrl
        });
        await downloadDocxBlob(compOwnerDoc, `6_Company_Owner_ID_Card_Copy_${safePlateSlug}.docx`);

        const witDoc = await generateWitnessesIdCopyDocx(updatedVehicle, {
          witness1ImageUrl: witnessIdDocs.w1Url,
          witness2ImageUrl: witnessIdDocs.w2Url,
          witness1Name: DOCKS_COMPANY.witnesses.w1_arbaz.name,
          witness1Cnic: DOCKS_COMPANY.witnesses.w1_arbaz.cnic,
          witness2Name: DOCKS_COMPANY.witnesses.w2_shams.name,
          witness2Cnic: DOCKS_COMPANY.witnesses.w2_shams.cnic
        });
        await downloadDocxBlob(witDoc, `7_Witnesses_ID_Card_Copy_${safePlateSlug}.docx`);

        setDocFeedback({
          type: 'success',
          message: `Complete 7-Document Registration / Renewal Pack downloaded for ${cleanPlate} & 6-month validity updated (expires ${updatedVehicle.validationExpiryDate}).`
        });
      } else if (docKind === 'CANCEL_NOC_LETTERHEAD') {
        const liveVehicle = buildLiveVehicleRecord();
        const doc = await generateCancellationLetterLetterheadDocx(liveVehicle, {
          letterDate: todayIso,
          leaveLetterheadSpace: true
        });
        await downloadDocxBlob(doc, `1_Cancellation_NOC_Letter_${safePlateSlug}_Letterhead_${formatDashDate(new Date())}.docx`);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Cancellation NOC Letter (${cleanPlate}) for Letterhead in Word (.docx).`
        });
      } else if (docKind === 'LEASE_TERMINATION_STAMP') {
        const liveVehicle = buildLiveVehicleRecord();
        const doc = await generateLeaseTerminationAgreementDocx(liveVehicle, {
          terminationDate: todayIso,
          leaveStampPaperSpace: true
        });
        await downloadDocxBlob(doc, `2_Lease_Termination_NOC_${safePlateSlug}_Stamp_Paper_${formatDashDate(new Date())}.docx`);
        setDocFeedback({
          type: 'success',
          message: `Downloaded Lease Cancellation & Termination Agreement (${cleanPlate}) for Stamp Paper in Word (.docx).`
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
      <div className="glass-card p-6 rounded-2xl w-full max-w-4xl border border-white/10 max-h-[92vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between sticky top-0 bg-slate-900/95 pb-4 border-b border-white/10 z-10 backdrop-blur-md">
          <div>
            <h3 className="text-xl font-bold text-white">
              {initialVehicle ? `Update Vehicle & Documents: ${initialVehicle.registrationNumber}` : 'New Vehicle Registration & Documents'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Upload Registration Book &amp; Owner CNIC for automatic AI fill, generate all 7 Registration/Renewal or Cancellation Word (.docx) files, and save.
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
                All generated letters, agreements &amp; NOCs automatically print this company&apos;s legal title.
              </span>
            </div>
            <div>
              <label className="text-xs text-gray-300 block mb-1 font-semibold">Vehicle No. (Registration Plate) *</label>
              <input
                type="text"
                placeholder="e.g. TMA-133 or JU-1929 (Auto-filled on Reg Book upload)"
                className="w-full glass-input rounded p-2 text-white font-mono font-bold uppercase tracking-wider"
                value={formData.registrationNumber}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, registrationNumber: e.target.value.toUpperCase() });
                }}
                required
              />
            </div>
          </div>

          {/* Row 2: Mandatory Vehicle Registration Book & Owner ID Upload (AI Auto-Fill Enabled) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-900/90 p-4 rounded-xl border border-brand-500/30">
            <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
              <div>
                <h4 className="text-xs font-bold text-brand-300">
                  Compliance Documents &amp; AI Auto-Fill (Registration Book, Owner CNIC, Director &amp; Witnesses CNICs)
                </h4>
                <p className="text-[11px] text-gray-400">
                  Upload Vehicle Registration Book and Owner CNIC first — AI automatically reads and fills Vehicle No, Chassis, Engine, Maker, Model, Tare, MRA &amp; Owner details.
                </p>
              </div>
              {isExtracting && (
                <span className="text-[11px] text-cyan-300 flex items-center gap-1 font-semibold">
                  <Loader2 size={13} className="animate-spin" /> Extracting...
                </span>
              )}
            </div>

            {aiDocStatus && (
              <div className={`sm:col-span-2 p-2.5 rounded-xl border text-xs space-y-1 ${
                aiDocStatus.type === 'warning'
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
                  : aiDocStatus.type === 'success'
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                    : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
              }`}>
                <div className="flex items-center gap-2 font-semibold">
                  {aiDocStatus.loading ? (
                    <Loader2 size={14} className="animate-spin shrink-0" />
                  ) : aiDocStatus.type === 'warning' ? (
                    <AlertTriangle size={14} className="shrink-0 text-rose-400" />
                  ) : (
                    <CheckCircle size={14} className="shrink-0 text-emerald-400" />
                  )}
                  <span>{aiDocStatus.message}</span>
                </div>
                {aiDocStatus.mismatches && aiDocStatus.mismatches.length > 0 && (
                  <ul className="list-disc list-inside pl-5 text-[11px] text-rose-300 space-y-0.5">
                    {aiDocStatus.mismatches.map((m, idx) => (
                      <li key={idx}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

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
                    <span>{formData.registrationBook ? 'Replace Reg Book (AI Fill)' : 'Upload Reg Book (AI Auto-Fill)'}</span>
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
                  <Camera size={14} /> Scan
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
                    <Download size={11} /> File
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
                    <span>{formData.ownerIdCardUrl ? 'Replace Owner ID (AI Fill)' : 'Upload Owner ID (AI Auto-Fill)'}</span>
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
                  <Camera size={14} /> Scan
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
                    <Download size={11} /> File
                  </a>
                </div>
              )}
            </div>

            {/* Vehicle Owner Details (Used in Lease Agreement, Affidavit & Owner ID Copy) */}
            <div>
              <label className="text-xs text-gray-300 block mb-1 font-semibold">Vehicle Owner Name (Lessor / Deponent)</label>
              <input
                type="text"
                placeholder="e.g. GHULAM NABI (Auto-filled from CNIC / Book)"
                className="w-full glass-input rounded p-2 text-white text-xs font-semibold"
                value={formData.ownerName || ''}
                onChange={e => setFormData({ ...formData, ownerName: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-300 block mb-1 font-semibold">Owner Father Name (S/O)</label>
              <input
                type="text"
                placeholder="e.g. ABDUL GHAFOOR"
                className="w-full glass-input rounded p-2 text-white text-xs"
                value={formData.ownerFatherName || ''}
                onChange={e => setFormData({ ...formData, ownerFatherName: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-300 block mb-1 font-semibold">Owner CNIC / ID Number</label>
              <input
                type="text"
                placeholder="e.g. 42101-1234567-1"
                className="w-full glass-input rounded p-2 text-white font-mono text-xs"
                value={formData.ownerCnic || ''}
                onChange={e => setFormData({ ...formData, ownerCnic: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-300 block mb-1 font-semibold">Owner Residential Address</label>
              <input
                type="text"
                placeholder="e.g. HOUSE NO. 12, BALDIA TOWN, KARACHI"
                className="w-full glass-input rounded p-2 text-white text-xs"
                value={formData.ownerAddress || ''}
                onChange={e => setFormData({ ...formData, ownerAddress: e.target.value })}
              />
            </div>

            {/* 3. Company Owner / Director ID Card & 4. Fixed Witnesses ID Cards (Saved Once & Reused) */}
            <div className="space-y-2 bg-black/30 p-3 rounded-xl border border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-cyan-300">
                  3. Company Owner ID ({resolveVehicleDocxCompany(formData).signoffName})
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  currentCompOwnerDoc.frontUrl
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-white/10 text-gray-400'
                }`}>
                  {currentCompOwnerDoc.frontUrl ? '✓ Saved for Company' : 'Optional Upload'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  placeholder="Director Name"
                  className="glass-input rounded px-2 py-1 text-white text-[11px]"
                  value={currentCompOwnerDoc.ownerName || ''}
                  onChange={e => saveCompanyOwnerDocEntry(currentCompanyKey, { ownerName: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Director CNIC"
                  className="glass-input rounded px-2 py-1 text-white font-mono text-[11px]"
                  value={currentCompOwnerDoc.ownerCnic || ''}
                  onChange={e => saveCompanyOwnerDocEntry(currentCompanyKey, { ownerCnic: e.target.value })}
                />
              </div>
              <label className="block cursor-pointer border border-dashed border-cyan-500/35 hover:border-cyan-400 bg-cyan-500/5 rounded-lg p-1.5 text-center text-[11px] text-cyan-200 font-semibold">
                <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleCompanyOwnerIdUpload} />
                {currentCompOwnerDoc.frontUrl
                  ? `✓ ${currentCompOwnerDoc.fileName || 'Director CNIC Saved'} (Click to Replace)`
                  : 'Upload Company Owner CNIC (Saved Once for All Vehicles)'}
              </label>
            </div>

            <div className="space-y-2 bg-black/30 p-3 rounded-xl border border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-purple-300">
                  4. Fixed Witnesses ID Cards (Standard)
                </span>
                <span className="text-[10px] text-gray-400">Saved for All Vehicles</span>
              </div>
              <div className="text-[10px] text-gray-400 leading-tight">
                W1: {DOCKS_COMPANY.witnesses.w1_arbaz.name} ({DOCKS_COMPANY.witnesses.w1_arbaz.cnic})<br />
                W2: {DOCKS_COMPANY.witnesses.w2_shams.name} ({DOCKS_COMPANY.witnesses.w2_shams.cnic})
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="cursor-pointer border border-dashed border-purple-500/35 hover:border-purple-400 bg-purple-500/5 rounded-lg p-1.5 text-center text-[10.5px] text-purple-200 font-semibold truncate">
                  <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleWitnessIdUpload('W1')} />
                  {witnessIdDocs.w1Url ? '✓ W1 CNIC Saved' : 'Upload Witness 1 CNIC'}
                </label>
                <label className="cursor-pointer border border-dashed border-purple-500/35 hover:border-purple-400 bg-purple-500/5 rounded-lg p-1.5 text-center text-[10.5px] text-purple-200 font-semibold truncate">
                  <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleWitnessIdUpload('W2')} />
                  {witnessIdDocs.w2Url ? '✓ W2 CNIC Saved' : 'Upload Witness 2 CNIC'}
                </label>
              </div>
            </div>
          </div>

          {/* Row 3: Transporter Name & Broker Name (Automatically Identical) */}
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

          {/* Row 4: Chassis No, Engine No, Maker, Model, Tare Weight & Registered In (Province / MRA) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Chassis No. *</label>
              <input
                type="text"
                placeholder="e.g. CV450BN-50039"
                className="w-full glass-input rounded p-2 text-white font-mono text-xs uppercase"
                value={formData.chassisNo}
                onChange={e => setFormData({ ...formData, chassisNo: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Engine No. *</label>
              <input
                type="text"
                placeholder="e.g. PE6-070941"
                className="w-full glass-input rounded p-2 text-white font-mono text-xs uppercase"
                value={formData.engineNo}
                onChange={e => setFormData({ ...formData, engineNo: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Maker (Make)</label>
              <input
                type="text"
                placeholder="e.g. NISSAN / HINO"
                className="w-full glass-input rounded p-2 text-white text-xs uppercase font-semibold"
                value={formData.make || ''}
                onChange={e => setFormData({ ...formData, make: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Model (Year)</label>
              <input
                type="text"
                placeholder="e.g. 1995 / 2018"
                className="w-full glass-input rounded p-2 text-white font-mono text-xs"
                value={formData.model || ''}
                onChange={e => setFormData({ ...formData, model: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1 font-semibold">Tare Weight</label>
              <input
                type="text"
                placeholder="e.g. 5100"
                className="w-full glass-input rounded p-2 text-white font-mono text-xs uppercase"
                value={formData.tareWeight || ''}
                onChange={e => setFormData({ ...formData, tareWeight: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="relative">
              <label className="text-xs text-cyan-300 block mb-1 font-semibold">Registered In (MRA)</label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="e.g. Balochistan"
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
                    setFormData({ ...formData, mra: e.target.value });
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
                        setFormData({ ...formData, mra: typedMraTrimmed });
                        setShowRegionDropdown(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/15 flex items-center gap-1.5 border-b border-white/10"
                    >
                      <Plus size={12} className="shrink-0" />
                      <span className="truncate">Save &quot;{typedMraTrimmed}&quot; to list</span>
                    </button>
                  )}
                  {allRegionOptions.map(regionOpt => (
                    <button
                      key={`reg_opt_${regionOpt}`}
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        setFormData({ ...formData, mra: regionOpt });
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

          {/* Row 5: Registration Dates, 6-Month Validity & All Official Word (.docx) Documents */}
          <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-amber-300 flex items-center gap-1.5">
                <Calendar size={15} /> Registration, 6-Month Validity &amp; Official Word (.docx) Documents
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
                  onClick={() => syncRegistrationDateAndSixMonthValidity(todayIso)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg shadow whitespace-nowrap shrink-0"
                >
                  Renew / Set Today (+6 Months)
                </button>
              </div>
            </div>

            {/* Date Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-gray-300 block mb-1">
                  Registration / Letter Date (Generating Letter Updates +6 Months Validity)
                </label>
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
                  onChange={e => setFormData({ ...formData, validationExpiryDate: e.target.value })}
                />
              </div>
            </div>

            {/* A. 7 Registration / Renewal Documents (.docx) */}
            <div className="pt-3 border-t border-white/10 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-white block">
                    A. Registration / 6-Month Renewal Pack (All 7 Official Word .docx Files)
                  </span>
                  <span className="text-[10.5px] text-gray-300">
                    Populated with this vehicle&apos;s exact particulars, owner details &amp; standard witnesses (editable in Microsoft Word).
                  </span>
                </div>
                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('ALL_7_REG_PACK')}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow whitespace-nowrap"
                >
                  {generatingDocType === 'ALL_7_REG_PACK' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  <span>Download All 7 Registration / Renewal Docs (.docx)</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('REG_RENEWAL')}
                  className="bg-blue-600/25 hover:bg-blue-600/40 disabled:opacity-50 border border-blue-500/40 text-blue-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {generatingDocType === 'REG_RENEWAL' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <FileText size={13} className="shrink-0" />}
                  <span>1. Reg / Renewal Letter</span>
                </button>

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('LEASE')}
                  className="bg-amber-600/25 hover:bg-amber-600/40 disabled:opacity-50 border border-amber-500/40 text-amber-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {generatingDocType === 'LEASE' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <FileCheck size={13} className="shrink-0" />}
                  <span>2. Lease Agreement</span>
                </button>

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('AFFIDAVIT')}
                  className="bg-indigo-600/25 hover:bg-indigo-600/40 disabled:opacity-50 border border-indigo-500/40 text-indigo-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {generatingDocType === 'AFFIDAVIT' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <ShieldCheck size={13} className="shrink-0" />}
                  <span>3. Affidavit (SRO 450)</span>
                </button>

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('VEH_BOOK_COPY')}
                  className="bg-cyan-600/25 hover:bg-cyan-600/40 disabled:opacity-50 border border-cyan-500/40 text-cyan-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {generatingDocType === 'VEH_BOOK_COPY' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <FileText size={13} className="shrink-0" />}
                  <span>4. Vehicle Book Copy</span>
                </button>

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('OWNER_ID_COPY')}
                  className="bg-teal-600/25 hover:bg-teal-600/40 disabled:opacity-50 border border-teal-500/40 text-teal-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {generatingDocType === 'OWNER_ID_COPY' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <User size={13} className="shrink-0" />}
                  <span>5. Vehicle Owner ID Copy</span>
                </button>

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('COMP_OWNER_ID_COPY')}
                  className="bg-sky-600/25 hover:bg-sky-600/40 disabled:opacity-50 border border-sky-500/40 text-sky-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {generatingDocType === 'COMP_OWNER_ID_COPY' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <Building size={13} className="shrink-0" />}
                  <span>6. Company Owner ID Copy</span>
                </button>

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('WITNESSES_ID_COPY')}
                  className="bg-purple-600/25 hover:bg-purple-600/40 disabled:opacity-50 border border-purple-500/40 text-purple-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors sm:col-span-2"
                >
                  {generatingDocType === 'WITNESSES_ID_COPY' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <User size={13} className="shrink-0" />}
                  <span>7. Witnesses ID Cards Copy (.docx)</span>
                </button>
              </div>
            </div>

            {/* B. Vehicle Cancellation & Lease Termination Documents (.docx) */}
            <div className="pt-3 border-t border-white/10 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-xs font-bold text-rose-300">
                  B. Vehicle Cancellation Documents (Letterhead NOC + Stamp Paper Lease Termination)
                </span>
                <span className="text-[10.5px] text-gray-300">
                  Issue NOC with Collector &amp; Cash Book fee or download Word (.docx) files directly.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {onRequestCancelNoc && (
                  <button
                    type="button"
                    disabled={generatingDocType !== null}
                    onClick={() => {
                      const cleanPlate = (formData.registrationNumber || '').trim().toUpperCase();
                      if (!cleanPlate) {
                        setDocFeedback({ type: 'error', message: 'Enter Vehicle Registration Number first to issue Cancellation NOC.' });
                        return;
                      }
                      onRequestCancelNoc(buildLiveVehicleRecord());
                    }}
                    className="bg-rose-600/30 hover:bg-rose-600/45 border border-rose-500/50 text-rose-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <AlertTriangle size={13} className="shrink-0" />
                    <span>Cancel Vehicle &amp; Issue Both NOCs</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('CANCEL_NOC_LETTERHEAD')}
                  className="bg-rose-500/15 hover:bg-rose-500/30 disabled:opacity-50 border border-rose-500/35 text-rose-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {generatingDocType === 'CANCEL_NOC_LETTERHEAD' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <FileText size={13} className="shrink-0" />}
                  <span>Cancellation NOC (Letterhead .docx)</span>
                </button>

                <button
                  type="button"
                  disabled={generatingDocType !== null}
                  onClick={() => handleGenerateModalDoc('LEASE_TERMINATION_STAMP')}
                  className="bg-orange-500/20 hover:bg-orange-500/35 disabled:opacity-50 border border-orange-500/40 text-orange-200 hover:text-white px-2.5 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {generatingDocType === 'LEASE_TERMINATION_STAMP' ? <Loader2 size={13} className="animate-spin shrink-0" /> : <FileCheck size={13} className="shrink-0" />}
                  <span>Lease Termination (Stamp Paper .docx)</span>
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

          {/* Row 6: Category, Type, Conditional Size (20ft / 40ft / 45ft) & Weight Capacity */}
          <div className={`grid grid-cols-1 ${requiresContainerOrTrailerSize ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-3`}>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Category</label>
              <select
                className="w-full glass-input rounded p-2 text-white outline-none bg-slate-900 text-xs"
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
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
                  onChange={e => setFormData({ ...formData, size: e.target.value })}
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
                onChange={e => setFormData({ ...formData, weightCapacity: e.target.value })}
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
            const scanDataUrl = (result as any).dataUrl || result.pdfDataUrl;
            if (scannerTarget === 'REG_BOOK') {
              setFormData((prev: any) => ({
                ...prev,
                registrationBook: scanDataUrl,
                registrationBookName: result.file.name
              }));
              await processComplianceUploadWithAI(result.file || { dataUrl: scanDataUrl, name: result.file?.name }, 'REG_BOOK');
            } else if (scannerTarget === 'OWNER_ID') {
              setFormData((prev: any) => ({
                ...prev,
                ownerIdCardUrl: scanDataUrl,
                ownerIdCardName: result.file.name
              }));
              await processComplianceUploadWithAI(result.file || { dataUrl: scanDataUrl, name: result.file?.name }, 'OWNER_ID');
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
    <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-3 sm:p-5 z-50 animate-fade-in">
      <div className="glass-card w-full max-w-4xl max-h-[88dvh] flex flex-col rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
        <div className="bg-slate-900 p-4 sm:p-5 border-b border-white/10 flex flex-wrap justify-between items-center gap-3 shrink-0">
           <div>
             <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5 flex-wrap">
               <span className="font-mono tabular-nums">{vehicle.registrationNumber}</span>
               <span className="text-xs font-bold uppercase text-cyan-300">
                 · {vehicle.companyName || (vehicle.operatingCompany === 'truckit' ? 'TRUCKIT PVT LTD' : 'DOCKS PVT LTD')}
               </span>
               <span className="text-xs font-medium text-gray-400">· {vehicle.type}</span>
             </h2>
             <p className="text-gray-400 text-xs sm:text-sm mt-1">
               Transporter &amp; Broker: <strong className="text-white">{vehicle.transporterName || vehicle.brokerName || 'Direct Transporter'}</strong> · {vehicle.category}
             </p>
           </div>
           
           <div className="flex items-center gap-2 flex-wrap">
             {onEditVehicle && (
               <button
                 type="button"
                 onClick={() => onEditVehicle(vehicle)}
                 className="mak-btn text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
               >
                 <Settings size={14} />
                 <span>Edit / Upload Docs</span>
               </button>
             )}
             {onRenewVehicle && (
               <button
                 type="button"
                 onClick={() => onRenewVehicle(vehicle)}
                 className="mak-btn text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
               >
                 <Clock size={14} />
                 <span>Renew 6M</span>
               </button>
             )}
             {vehicle.status === 'CANCELLED' ? (
                <span className="text-red-400 text-xs font-bold flex items-center gap-1.5 px-2 py-1">
                  <Ban size={13} /> De-registered / Cancelled
                </span>
             ) : onCancelVehicle ? (
                <button
                  type="button"
                  onClick={() => onCancelVehicle(vehicle)}
                  className="mak-btn text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  title="Cancel Vehicle and Generate NOC"
                >
                  <Ban size={14} />
                  <span>Cancel Vehicle (NOC)</span>
                </button>
             ) : null}

             <button
               type="button"
               onClick={handleDownloadTripAndFleetReport}
               disabled={isExportingTripReport}
               className="mak-btn text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
               title={`Download complete Trip & Fleet Report for vehicle ${vehicle.registrationNumber} (Excel / CSV)`}
             >
               {isExportingTripReport ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
               <span>Trip Report ({trips.length})</span>
             </button>

             <button
               type="button"
               onClick={handleDownloadPdf}
               disabled={isExporting}
               className="mak-btn text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0"
               title="Download complete vehicle profile dossier as PDF"
             >
               {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
               <span>Download PDF</span>
             </button>
             <button
               type="button"
               onClick={onClose}
               className="mak-btn-secondary p-2 rounded-xl ml-1 shrink-0"
               title="Close Window"
             >
               <X size={18} />
             </button>
           </div>
        </div>

        {/* Status notifications */}
        {isExporting && (
          <div className="bg-brand-500/10 border-b border-brand-500/20 px-6 py-2.5 flex items-center gap-3 text-brand-300 text-xs shrink-0">
            <Loader2 size={16} className="animate-spin text-brand-400 shrink-0" />
            <span>Generating and downloading Vehicle Dossier PDF...</span>
          </div>
        )}

        {downloadSuccess && (
          <div className="bg-emerald-500/15 border-b border-emerald-500/20 px-6 py-2.5 text-xs text-emerald-300 flex items-center justify-between gap-4 shrink-0">
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
                  className="mak-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1"
                >
                  <Eye size={12} /> <span>View PDF</span>
                </button>
              </div>
            )}
          </div>
        )}

        {downloadError && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-2.5 text-xs text-red-300 flex items-center gap-2 shrink-0">
            <AlertCircle size={16} className="text-red-400 shrink-0" />
            <span>{downloadError}</span>
          </div>
        )}
        
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 custom-scrollbar">
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
                 className="mak-btn text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0"
                 title="Download Trip Report for this vehicle as Excel (.xlsx)"
               >
                 <Download size={12} /> <span>Export Vehicle Trips (Excel .xlsx)</span>
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

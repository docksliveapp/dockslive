import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  X, 
  Save, 
  Upload, 
  Download, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  Eye, 
  Truck, 
  ShieldCheck, 
  Clock, 
  MapPin, 
  Camera, 
  DollarSign, 
  FileCheck, 
  Check, 
  Lock, 
  Info,
  ChevronRight,
  RotateCcw,
  Sparkles,
  AlertCircle,
  User,
  Search,
  Receipt
} from 'lucide-react';
import { 
  Case, 
  CaseStatus, 
  CaseStepDetail, 
  CaseCharge, 
  WORKFLOW_8_STEPS, 
  PAKISTAN_REGIONS, 
  Vehicle, 
  UserRole 
} from '../types';
import { safeAppStorage } from '../services/storage';
import { 
  getCategoryWorkflow, 
  getWorkflowStepIndex, 
  normalizeCategoryName, 
  supportsSubCategories,
  isDestinationUnloadedAndGateOut,
  getStepTargetRole,
  getStepArrangedBy
} from '../services/workflowConfig';
import { sendAppNotification } from '../services/notificationService';
import { PdfViewerModal } from './PdfViewerModal';
import { WorkflowMultiUploader } from './WorkflowMultiUploader';
import { downloadCasePdf, downloadCustomsDeliveryOrderPdf } from '../services/pdfExportService';
import { LoadingBillModal } from './LoadingBillModal';
import { CustomsClearanceSteps } from './workflowSteps/CustomsClearanceSteps';
import { AfghanTransitSteps } from './workflowSteps/AfghanTransitSteps';
import { TirSteps } from './workflowSteps/TirSteps';
import { PrivateCargoSteps } from './workflowSteps/PrivateCargoSteps';
import { WarehousingSteps } from './workflowSteps/WarehousingSteps';
import { CargoEquipmentSubCategoryFields } from './CargoEquipmentSubCategoryFields';
import { CarCarrierSteps } from './workflowSteps/CarCarrierSteps';
import { IsoTankSteps } from './workflowSteps/IsoTankSteps';
import { BreakbulkSteps } from './workflowSteps/BreakbulkSteps';
import { LinerNvoccSteps } from './workflowSteps/LinerNvoccSteps';
import { ImportExportSteps } from './workflowSteps/ImportExportSteps';
import { enrichCaseWithTripTimings, expireDriverTripCredentialsOnGateOut } from '../services/tripLifecycleService';
import { CaseTransitHistoryCard } from './CaseTransitHistoryCard';
import { 
  subscribeToVehicles, 
  updateVehicleInFirestore, 
  lookupDriverByCnic, 
  upsertDriverBackupFromWorkflow, 
  recordVehicleTripFromCase 
} from '../services/dbService';
import { 
  normalizeVehiclePlate, 
  evaluateVehicleRegistrationValidity, 
  checkVehicleWorkflowReadiness 
} from '../services/documentParserService';

interface WorkflowStepModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetCase: Case;
  stepStatus: CaseStatus | string;
  stepIndex: number;
  onSaveCase: (updatedCase: Case) => void;
  userRole?: UserRole;
  userRoles?: UserRole[];
  availableVehicles?: Vehicle[];
  onReportIncident?: (updatedCase: Case) => void;
}

export const WorkflowStepModal: React.FC<WorkflowStepModalProps> = ({
  isOpen,
  onClose,
  targetCase,
  stepStatus,
  stepIndex,
  onSaveCase,
  userRole = UserRole.ADMIN,
  userRoles,
  availableVehicles = [],
  onReportIncident
}) => {
  if (!isOpen || !targetCase) return null;

  const rolesList = useMemo(() => {
    if (userRoles && userRoles.length > 0) return userRoles;
    return [userRole];
  }, [userRole, userRoles]);

  const categoryWorkflow = useMemo(() => getCategoryWorkflow(targetCase.category), [targetCase.category]);
  const normCategory = useMemo(() => normalizeCategoryName(targetCase.category), [targetCase.category]);
  const activeStepIdx = useMemo(() => getWorkflowStepIndex(targetCase.category, targetCase.status as string), [targetCase.category, targetCase.status]);
  const canEditStep = useMemo(() => {
    if (targetCase.status === CaseStatus.COMPLETED) return false;

    const stepStr = String(stepStatus).toLowerCase();
    const isLoadingWorkflowStep =
      stepStatus === CaseStatus.LOADING_PORT_PROCESSING ||
      (normCategory === 'Bonded Carrier' && stepIndex === 4) ||
      stepStr.includes('loading port');
    const isDestinationWorkflowStep =
      stepStatus === CaseStatus.DESTINATION_PORT_ARRIVAL ||
      (normCategory === 'Bonded Carrier' && (stepIndex === 6 || stepIndex === 7)) ||
      stepStr.includes('destination port');

    // Loading workflow and Loading bill can be updated by Loading Port Staff, Admin, or Operations Manager
    if (isLoadingWorkflowStep) {
      return (
        rolesList.includes(UserRole.LOADING_PORT_STAFF) ||
        rolesList.includes(UserRole.ADMIN) ||
        rolesList.includes(UserRole.OPERATIONS_MANAGER)
      );
    }

    // Destination unloading workflow and Destination bill can be updated by Destination Port Staff, Admin, or Operations Manager
    if (isDestinationWorkflowStep) {
      return (
        rolesList.includes(UserRole.DESTINATION_PORT_STAFF) ||
        rolesList.includes(UserRole.UNLOADING_PORT_STAFF) ||
        rolesList.includes(UserRole.ADMIN) ||
        rolesList.includes(UserRole.OPERATIONS_MANAGER)
      );
    }

    // In Transit can be updated by Destination Port Staff (to receive vehicle & complete transit), Transporter, Documentation Manager, Operations Manager, or Admin
    if (stepStatus === CaseStatus.IN_TRANSIT || (normCategory === 'Bonded Carrier' && stepIndex === 5)) {
      if (
        rolesList.includes(UserRole.DESTINATION_PORT_STAFF) ||
        rolesList.includes(UserRole.UNLOADING_PORT_STAFF) ||
        rolesList.includes(UserRole.TRANSPORTER) ||
        rolesList.includes(UserRole.DOCUMENTATION_MANAGER) ||
        rolesList.includes(UserRole.VEHICLE_MANAGER)
      ) {
        return true;
      }
    }

    // Admin, Documentation Manager, Operations Manager & Case Manager can update all Documentation Processing workflows (DO, TP Filing, Excise Payment, Vehicle Assignment)
    if (
      rolesList.includes(UserRole.ADMIN) ||
      rolesList.includes(UserRole.DOCUMENTATION_MANAGER) ||
      rolesList.includes(UserRole.VEHICLE_MANAGER) ||
      rolesList.includes(UserRole.OPERATIONS_MANAGER) ||
      rolesList.includes(UserRole.CASE_MANAGER)
    ) {
      return true;
    }

    const arrangedBy = getStepArrangedBy(targetCase, String(stepStatus), stepIndex);

    // Client can edit if the step is arranged/managed by Client (including DO, Customs, or Vehicle Assignment if arranged by Client)
    if (rolesList.includes(UserRole.CLIENT) && rolesList.length === 1) {
      if (arrangedBy === 'Client') return true;
      if (stepIndex === 0 || stepStatus === CaseStatus.SHIPPING_LINE_DO) {
        const isClientDo = targetCase.serviceArrangements?.['delivery_order']?.arrangedBy === 'Client' ||
                           targetCase.serviceArrangements?.shippingLineDO?.arrangedBy === 'Client' ||
                           targetCase.workflowDetails?.[CaseStatus.SHIPPING_LINE_DO]?.doDueChargesArrangedBy === 'Client' ||
                           !targetCase.workflowDetails?.[CaseStatus.SHIPPING_LINE_DO]?.doDueChargesArrangedBy;
        if (isClientDo) return true;
      }
      if (
        stepStatus === CaseStatus.VEHICLE_ASSIGNMENT ||
        stepStr.includes('vehicle') ||
        stepStr.includes('transport')
      ) {
        const isClientVeh =
          targetCase.serviceArrangements?.['transportation']?.arrangedBy === 'Client' ||
          targetCase.workflowDetails?.[stepStatus]?.vehicleRentArrangedBy === 'Client';
        if (isClientVeh) return true;
      }
      return false;
    }

    let canEdit = false;

    // Loading Port Staff: Loading Port Processing only
    if (rolesList.includes(UserRole.LOADING_PORT_STAFF)) {
      if (
        stepIndex === 4 ||
        stepStatus === CaseStatus.LOADING_PORT_PROCESSING ||
        stepStr.includes('loading') ||
        stepStr.includes('dispatch') ||
        stepStr.includes('wharfage') ||
        stepStr.includes('stuff') ||
        stepStr.includes('vessel')
      ) {
        canEdit = true;
      }
    }

    // Unloading Port Staff / Destination Officers: Unloading, Gate-in, Gate-out, Terminal DO, Empty Return
    if (rolesList.includes(UserRole.UNLOADING_PORT_STAFF) || rolesList.includes(UserRole.DESTINATION_PORT_STAFF)) {
      if (stepIndex >= 5 || stepStr.includes('destination') || stepStr.includes('unload') || stepStr.includes('arrival') || stepStr.includes('gate') || stepStr.includes('return') || stepStr.includes('empty') || stepStr.includes('delivery')) {
        canEdit = true;
      }
    }

    return canEdit;
  }, [rolesList, targetCase, stepIndex, stepStatus, normCategory]);

  const isReadOnly = !canEditStep || targetCase.status === CaseStatus.COMPLETED;

  // Existing step detail or defaults
  const existingDetail = targetCase.workflowDetails?.[stepStatus] || ({} as CaseStepDetail);

  // Form State
  const [formData, setFormData] = useState<CaseStepDetail>({
    status: stepStatus,
    completed: existingDetail.completed || false,
    date: existingDetail.date || new Date().toISOString().split('T')[0],
    officer: existingDetail.officer || '',
    referenceNo: existingDetail.referenceNo || '',
    remarks: existingDetail.remarks || '',
    updatedAt: existingDetail.updatedAt || '',

    // Step 1: Shipping Line DO
    doReceiptUrl: existingDetail.doReceiptUrl || '',
    doReceiptName: existingDetail.doReceiptName || '',
    doReferenceNo: existingDetail.doReferenceNo || existingDetail.referenceNo || '',
    doIssueDate: existingDetail.doIssueDate || existingDetail.date || new Date().toISOString().split('T')[0],
    shippingLine: existingDetail.shippingLine || targetCase.shippingLine || targetCase.extractedData?.shippingLine || '',
    shippingAgent: existingDetail.shippingAgent || '',
    containerRentalPeriod: existingDetail.containerRentalPeriod || '14 Days',
    shippingLinePaidByDpl: existingDetail.shippingLinePaidByDpl ?? true,
    shippingAgentPaidByDpl: existingDetail.shippingAgentPaidByDpl ?? true,
    doDepositPaidByDpl: existingDetail.doDepositPaidByDpl ?? (existingDetail.doDepositArrangedBy === 'DPL'),
    doChargesPaidByDpl: existingDetail.doChargesPaidByDpl ?? (existingDetail.doDueChargesArrangedBy === 'DPL'),
    containerRentalPaidByDpl: existingDetail.containerRentalPaidByDpl ?? true,
    doDueChargesArrangedBy: existingDetail.doDueChargesArrangedBy || (targetCase.serviceArrangements?.['delivery_order']?.arrangedBy || 'Client'),
    doDueChargesAmount: existingDetail.doDueChargesAmount || (targetCase.serviceArrangements?.['delivery_order']?.arrangedBy === 'DPL' ? (targetCase.serviceArrangements['delivery_order'].amount || 0) : 0),
    doDueChargesCommission: 0,
    doDepositArrangedBy: existingDetail.doDepositArrangedBy || (targetCase.serviceArrangements?.['security_deposit']?.arrangedBy || 'Client'),
    doDepositAmount: existingDetail.doDepositAmount || (targetCase.serviceArrangements?.['security_deposit']?.arrangedBy === 'DPL' ? (targetCase.serviceArrangements['security_deposit'].amount || 0) : 0),
    doDepositCommission: 0,

    // Step 2
    tpGdPrintUrl: existingDetail.tpGdPrintUrl || '',
    tpGdPrintName: existingDetail.tpGdPrintName || '',
    tpGdNumber: existingDetail.tpGdNumber || existingDetail.referenceNo || targetCase.extractedData?.tpNumber || targetCase.extractedData?.gdNumber || '',
    tpFilingDate: existingDetail.tpFilingDate || existingDetail.date || '',
    tpItemDescription: existingDetail.tpItemDescription || targetCase.extractedData?.itemDescription || '',
    tpFilingEntity: existingDetail.tpFilingEntity || (targetCase.serviceArrangements?.['customs_clearance']?.arrangedBy || 'Client'),

    // Step 3
    exciseReceiptUrl: existingDetail.exciseReceiptUrl || '',
    exciseReceiptName: existingDetail.exciseReceiptName || '',
    exciseAmount: existingDetail.exciseAmount || (targetCase.serviceArrangements?.['customs_clearance']?.arrangedBy === 'DPL' ? (targetCase.serviceArrangements['customs_clearance'].amount || 0) : 0),
    exciseReferenceNo: existingDetail.exciseReferenceNo || existingDetail.referenceNo || '',
    exciseRegion: existingDetail.exciseRegion || 'Sindh',
    excisePaymentDate: existingDetail.excisePaymentDate || existingDetail.date || '',
    exciseHandledBy: existingDetail.exciseHandledBy || (targetCase.serviceArrangements?.['customs_clearance']?.arrangedBy || 'Client'),

    // Step 4 (Wharfage integrated into Loading Bill)
    wharfageReceiptUrl: existingDetail.wharfageReceiptUrl || '',
    wharfageReceiptName: existingDetail.wharfageReceiptName || '',
    wharfageReceiptDate: existingDetail.wharfageReceiptDate || existingDetail.date || '',
    wharfageAmount: existingDetail.wharfageAmount || (targetCase.serviceArrangements?.['terminal_handling']?.arrangedBy === 'DPL' ? (targetCase.serviceArrangements['terminal_handling'].amount || 0) : 0),
    wharfagePaymentEntity: existingDetail.wharfagePaymentEntity || (targetCase.serviceArrangements?.['terminal_handling']?.arrangedBy || 'Client'),
    wharfageCommission: 0,

    // Step 5: Vehicle Assignment
    assignedVehicleNo: existingDetail.assignedVehicleNo || targetCase.containers?.[0]?.vehicleNo || '',
    vehicleVerifiedInDb: existingDetail.vehicleVerifiedInDb || false,
    registrationBookUrl: existingDetail.registrationBookUrl || '',
    registrationBookName: existingDetail.registrationBookName || '',
    ownerCnicUrl: existingDetail.ownerCnicUrl || '',
    ownerCnicName: existingDetail.ownerCnicName || '',
    taxRenewalDate: existingDetail.taxRenewalDate || '',
    taxExpiryDate: existingDetail.taxExpiryDate || '',
    driverName: existingDetail.driverName || targetCase.vehicleAssignment?.driverName || targetCase.containers?.[0]?.driverName || '',
    driverContact: existingDetail.driverContact || targetCase.vehicleAssignment?.driverContact || (targetCase.containers?.[0] as any)?.driverContact || '',
    driverCnic: existingDetail.driverCnic || targetCase.vehicleAssignment?.driverCnic || targetCase.containers?.[0]?.driverCnic || '',
    driverCnicFrontUrl: existingDetail.driverCnicFrontUrl || '',
    driverCnicFrontName: existingDetail.driverCnicFrontName || '',
    driverCnicBackUrl: existingDetail.driverCnicBackUrl || '',
    driverCnicBackName: existingDetail.driverCnicBackName || '',
    driverLicenseUrl: existingDetail.driverLicenseUrl || '',
    driverLicenseName: existingDetail.driverLicenseName || '',
    vehicleRentAmount: existingDetail.vehicleRentAmount || (targetCase.serviceArrangements?.['transportation']?.arrangedBy === 'DPL' ? (targetCase.serviceArrangements['transportation'].amount || 0) : 0),
    vehicleRentArrangedBy: existingDetail.vehicleRentArrangedBy || (targetCase.serviceArrangements?.['transportation']?.arrangedBy || 'Client'),
    vehicleRentCommission: 0,

    // Step 6: Loading Port Processing
    vehiclePhotoUrl: existingDetail.vehiclePhotoUrl || '',
    vehiclePhotoName: existingDetail.vehiclePhotoName || '',
    portGatePassUrl: existingDetail.portGatePassUrl || '',
    portGatePassName: existingDetail.portGatePassName || '',
    trackerStatus: existingDetail.trackerStatus || 'Not Installed',
    trackerArrangedBy: existingDetail.trackerArrangedBy || (targetCase.serviceArrangements?.['tracker_security']?.arrangedBy || 'Client'),
    trackerAmount: existingDetail.trackerAmount || (targetCase.serviceArrangements?.['tracker_security']?.arrangedBy === 'DPL' ? (targetCase.serviceArrangements['tracker_security'].amount || 0) : 0),
    trackerCommission: 0,
    loadingChargesArrangedBy: existingDetail.loadingChargesArrangedBy || (targetCase.serviceArrangements?.['loading_unloading']?.arrangedBy || targetCase.serviceArrangements?.loadingUnloading?.arrangedBy || 'Client'),
    loadingChargesAmount: existingDetail.loadingChargesAmount || (targetCase.serviceArrangements?.['loading_unloading']?.arrangedBy === 'DPL' ? (targetCase.serviceArrangements['loading_unloading'].amount || 0) : 0),
    loadingChargesCommission: 0,
    weightSlipUrl: existingDetail.weightSlipUrl || '',
    weightSlipName: existingDetail.weightSlipName || '',
    sealSlipUrl: existingDetail.sealSlipUrl || '',
    sealSlipName: existingDetail.sealSlipName || '',
    customsSealPhotoUrl: existingDetail.customsSealPhotoUrl || '',
    customsSealPhotoName: existingDetail.customsSealPhotoName || '',
    customsSealNumber: existingDetail.customsSealNumber || '',
    gateOutToggled: existingDetail.gateOutToggled || false,
    driverGateOutPhotoUrl: existingDetail.driverGateOutPhotoUrl || '',
    driverGateOutPhotoName: existingDetail.driverGateOutPhotoName || '',

    // Client-Arranged DO at Loading
    clientDoPhotoUrl: existingDetail.clientDoPhotoUrl || '',
    clientDoPhotoName: existingDetail.clientDoPhotoName || '',
    clientDoFavorOf: existingDetail.clientDoFavorOf || '',
    clientDoShippingLine: existingDetail.clientDoShippingLine || '',
    clientDoNumber: existingDetail.clientDoNumber || '',
    clientDoDate: existingDetail.clientDoDate || '',

    // Step 7: In Transit
    inTransitActive: existingDetail.inTransitActive || false,
    incidentReported: existingDetail.incidentReported || false,
    incidentReason: existingDetail.incidentReason || '',
    incidentDate: existingDetail.incidentDate || '',
    incidentLocation: existingDetail.incidentLocation || '',
    incidentRemarks: existingDetail.incidentRemarks || '',

    // Step 8: Destination Port Arrival & Unloading
    portGateArrivalPhotoUrl: existingDetail.portGateArrivalPhotoUrl || targetCase.workflowDetails?.[CaseStatus.DESTINATION_PORT_ARRIVAL]?.portGateArrivalPhotoUrl || '',
    portGateArrivalPhotoName: existingDetail.portGateArrivalPhotoName || targetCase.workflowDetails?.[CaseStatus.DESTINATION_PORT_ARRIVAL]?.portGateArrivalPhotoName || '',
    destinationGateInToggled: existingDetail.destinationGateInToggled || targetCase.workflowDetails?.[CaseStatus.DESTINATION_PORT_ARRIVAL]?.destinationGateInToggled || false,
    secondaryCustomsSealPhotoUrl: existingDetail.secondaryCustomsSealPhotoUrl || '',
    secondaryCustomsSealPhotoName: existingDetail.secondaryCustomsSealPhotoName || '',
    secondaryCustomsSealNumber: existingDetail.secondaryCustomsSealNumber || '',
    destinationWeightSlipUrl: existingDetail.destinationWeightSlipUrl || '',
    destinationWeightSlipName: existingDetail.destinationWeightSlipName || '',
    finalSignedTransportNoteUrl: existingDetail.finalSignedTransportNoteUrl || '',
    finalSignedTransportNoteName: existingDetail.finalSignedTransportNoteName || '',
    dryPortGatePassUrl: existingDetail.dryPortGatePassUrl || '',
    dryPortGatePassName: existingDetail.dryPortGatePassName || '',
    destinationDoDocUrl: existingDetail.destinationDoDocUrl || '',
    destinationDoDocName: existingDetail.destinationDoDocName || '',
    containerUnloadedToggled: existingDetail.containerUnloadedToggled || false,
    vehicleGateOutToggled: existingDetail.vehicleGateOutToggled || false,
    destinationChargesArrangedBy: existingDetail.destinationChargesArrangedBy || (targetCase.serviceArrangements?.['destination_unloading']?.arrangedBy || targetCase.serviceArrangements?.['loading_unloading']?.arrangedBy || targetCase.serviceArrangements?.loadingUnloading?.arrangedBy || 'Client'),
    destinationChargesAmount: existingDetail.destinationChargesAmount || 0
  });

  const [activePdfPreview, setActivePdfPreview] = useState<{ url: string; title: string } | null>(null);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [incidentForm, setIncidentForm] = useState({
    reason: '',
    location: '',
    date: new Date().toISOString().split('T')[0],
    contact: ''
  });

  // Vehicle Assignment modal states
  const [showVehicleValidateModal, setShowVehicleValidateModal] = useState(false);
  const [vehicleValidationResult, setVehicleValidationResult] = useState<{
    valid: boolean;
    reason: string;
    vehicle?: Vehicle;
  } | null>(null);
  const [showVehicleSearchModal, setShowVehicleSearchModal] = useState(false);
  const [vehicleSearchQuery, setVehicleSearchQuery] = useState('');

  // Loading & Destination Bill modal state
  const [showLoadingBillModal, setShowLoadingBillModal] = useState(false);
  const [billModalType, setBillModalType] = useState<'LOADING' | 'DESTINATION'>('LOADING');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Subscribe to live global vehicles so recently imported / updated vehicles are always available
  const [liveFleetVehicles, setLiveFleetVehicles] = useState<Vehicle[]>([]);
  const [driverBackupNotice, setDriverBackupNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToVehicles((items) => {
      if (Array.isArray(items) && items.length > 0) {
        setLiveFleetVehicles(items);
      }
    });
    return () => unsub();
  }, []);

  // Load vehicles from live subscription, props, or local storage
  const allVehicles = useMemo(() => {
    if (liveFleetVehicles.length > 0) return liveFleetVehicles;
    if (availableVehicles && availableVehicles.length > 0) return availableVehicles;
    const liveLocal = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []);
    if (liveLocal && liveLocal.length > 0) return liveLocal;
    return safeAppStorage.getJSON<Vehicle[]>('dpl_vehicles_data', []);
  }, [liveFleetVehicles, availableVehicles]);

  // Check vehicle database match when assignedVehicleNo changes
  const matchedVehicle = useMemo(() => {
    if (!formData.assignedVehicleNo) return null;
    const cleanInput = normalizeVehiclePlate(formData.assignedVehicleNo);
    return allVehicles.find(v => 
      normalizeVehiclePlate(v.registrationNumber) === cleanInput
    ) || null;
  }, [formData.assignedVehicleNo, allVehicles]);

  // Sync vehicle DB verification & pre-uploaded Vehicle Registration Book + Owner ID Card
  useEffect(() => {
    if (matchedVehicle) {
      setFormData(prev => ({
        ...prev,
        vehicleVerifiedInDb: true,
        registrationBookUrl: prev.registrationBookUrl || matchedVehicle.registrationBook || '',
        registrationBookName: prev.registrationBookName || matchedVehicle.registrationBookName || (matchedVehicle.registrationBook ? 'Vehicle Registration Book (Fleet DB)' : ''),
        ownerCnicUrl: prev.ownerCnicUrl || matchedVehicle.ownerIdCardUrl || '',
        ownerCnicName: prev.ownerCnicName || matchedVehicle.ownerIdCardName || (matchedVehicle.ownerIdCardUrl ? 'Vehicle Owner ID Card (Fleet DB)' : ''),
        taxRenewalDate: prev.taxRenewalDate || matchedVehicle.registrationDate || matchedVehicle.validationStartDate || '',
        taxExpiryDate: prev.taxExpiryDate || matchedVehicle.validationExpiryDate || '',
        driverName: prev.driverName || matchedVehicle.driverName || '',
        driverContact: prev.driverContact || matchedVehicle.driverContact || '',
        driverCnic: prev.driverCnic || matchedVehicle.driverCnic || ''
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        vehicleVerifiedInDb: false
      }));
    }
  }, [matchedVehicle]);

  // Driver CNIC Backup Auto-Lookup: when user types Driver CNIC, auto-fill Name, Mobile & Front/Back CNIC from backup if found
  const handleDriverCnicChange = (cnicValue: string) => {
    setFormData(prev => ({ ...prev, driverCnic: cnicValue }));
    const cleanDigits = cnicValue.replace(/[^0-9]/g, '');
    if (cleanDigits.length >= 13) {
      const backupDriver = lookupDriverByCnic(cnicValue);
      if (backupDriver) {
        setFormData(prev => ({
          ...prev,
          driverCnic: cnicValue,
          driverName: prev.driverName?.trim() ? prev.driverName : (backupDriver.name || prev.driverName),
          driverContact: prev.driverContact?.trim() ? prev.driverContact : (backupDriver.contact || prev.driverContact),
          driverCnicFrontUrl: prev.driverCnicFrontUrl || backupDriver.cnicFrontUrl || '',
          driverCnicFrontName: prev.driverCnicFrontName || backupDriver.cnicFrontName || '',
          driverCnicBackUrl: prev.driverCnicBackUrl || backupDriver.cnicBackUrl || '',
          driverCnicBackName: prev.driverCnicBackName || backupDriver.cnicBackName || '',
        }));
        setDriverBackupNotice(
          `Driver "${backupDriver.name}" found in backup!${backupDriver.cnicFrontUrl && backupDriver.cnicBackUrl ? ' Mobile & Front/Back CNIC auto-loaded from backup.' : ' Driver details auto-filled from backup.'}`
        );
      } else {
        setDriverBackupNotice(null);
      }
    } else {
      setDriverBackupNotice(null);
    }
  };

  // Validate vehicle registration against database (including 6-month Customs rule)
  const handleValidateVehicle = (vehNoToCheck?: string) => {
    const rawNo = (vehNoToCheck || formData.assignedVehicleNo || '').trim();
    if (!rawNo) {
      setValidationError('Please enter a vehicle registration number to validate.');
      return;
    }

    const cleanInput = normalizeVehiclePlate(rawNo);
    const found = allVehicles.find(v => 
      normalizeVehiclePlate(v.registrationNumber) === cleanInput
    );

    if (!found) {
      setVehicleValidationResult({
        valid: false,
        reason: `Vehicle "${rawNo}" is NOT registered in our Fleet List. Only vehicles added in the Fleet List can be assigned to a case workflow.`
      });
      setShowVehicleValidateModal(true);
      return;
    }

    const validity = evaluateVehicleRegistrationValidity(
      found.lastRenewalDate || found.registrationDate,
      found.validationExpiryDate || found.registrationExpiryDate
    );
    const stat = (found.status || 'AVAILABLE').toUpperCase();
    if (stat === 'EXPIRED' || stat === 'CANCELLED' || stat === 'SUSPENDED' || stat === 'INACTIVE' || validity.isExpired) {
      setVehicleValidationResult({
        valid: false,
        reason: `Vehicle ${found.registrationNumber} (${found.companyName || 'Fleet'}) is EXPIRED or ${stat}. Registration Date: ${found.registrationDate || 'Blank (Missing)'}. Under Customs rules, registration is valid for 6 months and must be renewed before assigning.`,
        vehicle: found
      });
      setShowVehicleValidateModal(true);
      return;
    }

    setVehicleValidationResult({
      valid: true,
      reason: `Vehicle ${found.registrationNumber} (${found.companyName || 'TRUCKIT PVT LTD'}) is VALID & ACTIVE in registered fleet (Expires: ${validity.expiryDate || found.validationExpiryDate}).`,
      vehicle: found
    });
    setShowVehicleValidateModal(true);
  };

  const handleApplyValidatedVehicle = (veh: Vehicle) => {
    setFormData(prev => ({
      ...prev,
      assignedVehicleNo: veh.registrationNumber,
      registrationBookUrl: prev.registrationBookUrl || veh.registrationBook || '',
      registrationBookName: prev.registrationBookName || veh.registrationBookName || (veh.registrationBook ? 'Vehicle Registration Book (Fleet DB)' : ''),
      ownerCnicUrl: prev.ownerCnicUrl || veh.ownerIdCardUrl || '',
      ownerCnicName: prev.ownerCnicName || veh.ownerIdCardName || (veh.ownerIdCardUrl ? 'Vehicle Owner ID Card (Fleet DB)' : ''),
      driverName: prev.driverName || veh.driverName || '',
      driverCnic: prev.driverCnic || veh.driverCnic || '',
      vehicleVerifiedInDb: true
    }));
    setShowVehicleValidateModal(false);
  };

  const filteredVehiclesList = useMemo(() => {
    if (!vehicleSearchQuery.trim()) return allVehicles;
    const q = vehicleSearchQuery.toLowerCase().trim();
    return allVehicles.filter(v => 
      (v.registrationNumber && v.registrationNumber.toLowerCase().includes(q)) ||
      (v.transporterName && v.transporterName.toLowerCase().includes(q)) ||
      (v.brokerName && v.brokerName.toLowerCase().includes(q)) ||
      (v.companyName && v.companyName.toLowerCase().includes(q)) ||
      (v.driverName && v.driverName.toLowerCase().includes(q)) ||
      (v.category && v.category.toLowerCase().includes(q))
    );
  }, [allVehicles, vehicleSearchQuery]);

  const handleSelectVehicleFromList = (veh: Vehicle) => {
    const validity = evaluateVehicleRegistrationValidity(
      veh.lastRenewalDate || veh.registrationDate,
      veh.validationExpiryDate || veh.registrationExpiryDate
    );
    const stat = (veh.status || 'AVAILABLE').toUpperCase();
    if (stat === 'EXPIRED' || stat === 'CANCELLED' || stat === 'SUSPENDED' || stat === 'INACTIVE' || validity.isExpired) {
      setValidationError(`Cannot assign vehicle ${veh.registrationNumber}: Customs 6-month validity is EXPIRED (Reg Date: ${veh.registrationDate || 'Blank'}). Please renew the vehicle first.`);
      return;
    }
    setFormData(prev => ({
      ...prev,
      assignedVehicleNo: veh.registrationNumber,
      registrationBookUrl: prev.registrationBookUrl || veh.registrationBook || '',
      registrationBookName: prev.registrationBookName || veh.registrationBookName || (veh.registrationBook ? 'Vehicle Registration Book (Fleet DB)' : ''),
      ownerCnicUrl: prev.ownerCnicUrl || veh.ownerIdCardUrl || '',
      ownerCnicName: prev.ownerCnicName || veh.ownerIdCardName || (veh.ownerIdCardUrl ? 'Vehicle Owner ID Card (Fleet DB)' : ''),
      driverName: prev.driverName || veh.driverName || '',
      driverCnic: prev.driverCnic || veh.driverCnic || '',
      vehicleVerifiedInDb: true
    }));
    setShowVehicleSearchModal(false);
  };

  // Helper: Extract all uploaded files/receipts from step detail
  const extractDocsFromStep = (detail: CaseStepDetail): any[] => {
    const docs: any[] = [];
    const addDoc = (url?: string, name?: string, type?: string) => {
      if (url && url.trim()) {
        docs.push({
          id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          name: name || 'Document',
          url: url,
          type: type || 'Workflow Document',
          uploadedAt: new Date().toISOString()
        });
      }
    };

    addDoc(detail.doReceiptUrl, detail.doReceiptName, 'Delivery Order (DO) Document');
    addDoc(detail.tpGdPrintUrl, detail.tpGdPrintName, 'Customs TP / GD Print');
    addDoc(detail.exciseReceiptUrl, detail.exciseReceiptName, 'Excise Payment Voucher');
    addDoc(detail.wharfageReceiptUrl, detail.wharfageReceiptName, 'Wharfage Terminal Receipt');
    addDoc(detail.registrationBookUrl, detail.registrationBookName, 'Vehicle Registration Book');
    addDoc(detail.ownerCnicUrl, detail.ownerCnicName, 'Vehicle Owner CNIC');
    addDoc(detail.driverCnicFrontUrl, detail.driverCnicFrontName, 'Driver CNIC Front');
    addDoc(detail.driverCnicBackUrl, detail.driverCnicBackName, 'Driver CNIC Back');
    addDoc(detail.driverLicenseUrl, detail.driverLicenseName, 'Driver Heavy License');
    addDoc(detail.vehiclePhotoUrl, detail.vehiclePhotoName, 'Vehicle Photo at Port');
    addDoc(detail.portGatePassUrl, detail.portGatePassName, 'Port Gate Pass Slip');
    addDoc(detail.weightSlipUrl, detail.weightSlipName, 'Port Weight Slip');
    addDoc(detail.sealSlipUrl, detail.sealSlipName, 'Customs Seal Slip');
    addDoc(detail.customsSealPhotoUrl, detail.customsSealPhotoName, 'Customs Seal Photo');
    addDoc(detail.driverGateOutPhotoUrl, detail.driverGateOutPhotoName, 'Driver Live Gate-Out Photo');
    addDoc(detail.clientDoPhotoUrl, detail.clientDoPhotoName, 'Shipping Line DO Photo');
    addDoc(detail.portGateArrivalPhotoUrl, detail.portGateArrivalPhotoName, 'Port Gate Arrival Photo');
    addDoc(detail.secondaryCustomsSealPhotoUrl, detail.secondaryCustomsSealPhotoName, 'Secondary Customs Seal Photo');
    addDoc(detail.destinationWeightSlipUrl, detail.destinationWeightSlipName, 'Port Weight Slip (Destination)');
    addDoc(detail.finalSignedTransportNoteUrl, detail.finalSignedTransportNoteName, 'Transport Note');
    addDoc(detail.dryPortGatePassUrl, detail.dryPortGatePassName, 'Dry Port Gate Pass');
    addDoc(detail.destinationDoDocUrl, detail.destinationDoDocName, 'Destination Delivery Order (DO)');

    if (detail.multiFiles) {
      Object.entries(detail.multiFiles).forEach(([fieldKey, files]) => {
        if (Array.isArray(files)) {
          files.forEach(f => {
            if (f.url) {
              docs.push({
                id: f.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                name: f.name || fieldKey,
                url: f.url,
                type: 'Workflow Upload',
                uploadedAt: f.uploadedAt || new Date().toISOString()
              });
            }
          });
        }
      });
    }

    return docs;
  };

  // Strict validation rules when clicking [Completed]
  const validateStepStrict = (): { valid: boolean; error?: string } => {
    if (normCategory === 'Bonded Carrier') {
      if (stepIndex === 0) { // Step 1: Shipping Line DO
        if (formData.doDueChargesArrangedBy === 'DPL') {
          if (!formData.doReceiptUrl && (!formData.multiFiles || Object.keys(formData.multiFiles).length === 0)) {
            return { valid: false, error: 'Document Required: Please upload the Delivery Order document or receipt before marking this step as completed.' };
          }
          if (!formData.shippingLine?.trim()) {
            return { valid: false, error: 'Field Required: Please enter the Shipping Line name.' };
          }
        }
      }

      if (stepIndex === 1) { // Step 2: TP Filing
        if (!formData.tpGdPrintUrl) {
          return { valid: false, error: 'Document Required: Please upload Customs TP / GD Print document.' };
        }
        if (!formData.tpGdNumber?.trim()) {
          return { valid: false, error: 'Field Required: Please enter the TP / GD Reference Number.' };
        }
      }

      if (stepIndex === 2) { // Step 3: Excise Payment
        if (!formData.exciseRegion) {
          return { valid: false, error: 'Excise Region is mandatory. Please select a Pakistan administrative region.' };
        }
        if (!formData.exciseReceiptUrl) {
          return { valid: false, error: 'Receipt Required: Please upload the Provincial Excise Duty Payment voucher.' };
        }
      }

      if (stepIndex === 3 || stepStatus === CaseStatus.VEHICLE_ASSIGNMENT) { // Step 4: Vehicle Assignment (Documentation Manager)
        if (!formData.assignedVehicleNo?.trim()) {
          return { valid: false, error: 'Vehicle Required: Please select and validate a registered vehicle from the Fleet List.' };
        }
        if (!formData.driverName?.trim()) {
          return { valid: false, error: 'Driver Full Name is required in Vehicle Assignment.' };
        }
        if (!formData.driverContact?.trim()) {
          return { valid: false, error: 'Driver Mobile Number is required in Vehicle Assignment.' };
        }
        if (!formData.driverCnic?.trim()) {
          return { valid: false, error: 'Driver ID Card (CNIC) Number is required in Vehicle Assignment.' };
        }
        const readiness = checkVehicleWorkflowReadiness({
          vehicleNo: formData.assignedVehicleNo,
          registeredVehicles: allVehicles,
          caseRegistrationBookUrl: formData.registrationBookUrl || matchedVehicle?.registrationBook,
          caseOwnerCnicUrl: formData.ownerCnicUrl || matchedVehicle?.ownerIdCardUrl,
          driverName: formData.driverName,
          driverCnic: formData.driverCnic,
          driverCnicFrontUrl: formData.driverCnicFrontUrl,
          driverCnicBackUrl: formData.driverCnicBackUrl,
        });
        if (readiness.errors.length > 0) {
          return {
            valid: false,
            error: `Vehicle & Driver Assignment Incomplete:\n• ${readiness.errors.join('\n• ')}`
          };
        }
        if (formData.vehicleRentArrangedBy === 'DPL' && (!formData.vehicleRentAmount || Number(formData.vehicleRentAmount) <= 0)) {
          return { valid: false, error: 'Vehicle Rent Amount (PKR) is required when arranged by DPL.' };
        }
      }

      if (stepIndex === 4 || stepStatus === CaseStatus.LOADING_PORT_PROCESSING) { // Step 5: Loading Port Processing
        if (!formData.portGatePassUrl) {
          return { valid: false, error: 'Port Gate Pass upload is required before completing loading step.' };
        }
        if (!formData.customsSealNumber?.trim()) {
          return { valid: false, error: 'Customs Seal Verification Required: Customs Seal Number is mandatory.' };
        }
        if (!formData.gateOutToggled) {
          return { valid: false, error: 'Completion Criteria: Step requires Port Gate Out status to be confirmed.' };
        }
      }

      if (stepIndex === 6 || stepIndex === 7 || stepStatus === CaseStatus.DESTINATION_PORT_ARRIVAL) { // Step 7: Destination Port Arrival
        if (!formData.destinationGateInToggled) {
          return { valid: false, error: 'Please mark Vehicle Received.' };
        }
        if (!formData.containerUnloadedToggled) {
          return { valid: false, error: 'Please mark Container Unloaded from Vehicle.' };
        }
        if (!formData.vehicleGateOutToggled) {
          return { valid: false, error: 'Please mark Vehicle Gate Out.' };
        }
      }
    }

    if (normCategory === 'Import & Export Services') {
      if (stepIndex === 0 && !formData.croBookingNumber?.trim()) {
        return { valid: false, error: 'Container Booking (CRO) reference number is required before completing.' };
      }
      if (stepIndex === 1 && (!formData.vesselName?.trim() || !formData.shippingLineName?.trim())) {
        return { valid: false, error: 'Vessel Name and Ocean Shipping Line are required before completing.' };
      }
      if (stepIndex === 2 && !formData.assignedTrailerNo?.trim()) {
        return { valid: false, error: 'Inland Trailer Registration Number is required before completing.' };
      }
      if (stepIndex === 3 && (!formData.vgmWeightKg || formData.vgmWeightKg <= 0)) {
        return { valid: false, error: 'SOLAS Verified Gross Mass (VGM Weight in Kg) is required before completing.' };
      }
      if (stepIndex === 4 && !formData.exportCustomsGdNo?.trim()) {
        return { valid: false, error: 'Port Customs Goods Declaration (GD) Number is required before completing.' };
      }
      if (stepIndex === 5 && !formData.billOfLadingNo?.trim()) {
        return { valid: false, error: 'Ocean Bill of Lading (B/L) Number is required before completing.' };
      }
    }

    return { valid: true };
  };

  // Helper: Synchronize all DPL expenses to targetCase.charges (Zero commission per user mandate)
  const syncDplExpensesToInvoice = (currentCase: Case, updatedDetail: CaseStepDetail): CaseCharge[] => {
    const existingCharges = [...(currentCase.charges || [])];
    
    // Key-value pairs of DPL items for this step
    const dplItemsToSync: Array<{ key: string; label: string; amount: number; receiptUrl?: string; receiptName?: string }> = [];

    const activeStepId = categoryWorkflow.steps[stepIndex]?.id || String(stepStatus);
    const isDoStep = stepIndex === 0 || activeStepId === 'DELIVERY_ORDER' || activeStepId === CaseStatus.SHIPPING_LINE_DO;
    const isExciseStep = stepIndex === 2 || activeStepId === 'SINDH_EXCISE' || activeStepId === CaseStatus.EXCISE_PAYMENT;
    const isVehicleStep = stepIndex === 3 || activeStepId === 'TRANSPORTER' || activeStepId === CaseStatus.VEHICLE_ASSIGNMENT;
    const isLoadingStep = stepIndex === 4 || activeStepId === 'CUSTOMS_GATE' || activeStepId === CaseStatus.LOADING_PORT_PROCESSING;

    if (isDoStep) {
      if ((updatedDetail.doDueChargesArrangedBy === 'DPL' || updatedDetail.doChargesPaidByDpl) && Number(updatedDetail.doDueChargesAmount) > 0) {
        dplItemsToSync.push({
          key: 'dpl_do_due_charges',
          label: 'DO Due Charges (DPL Arranged)',
          amount: Number(updatedDetail.doDueChargesAmount),
          receiptUrl: updatedDetail.doReceiptUrl,
          receiptName: updatedDetail.doReceiptName
        });
      }
      if ((updatedDetail.doDepositArrangedBy === 'DPL' || updatedDetail.doDepositPaidByDpl) && Number(updatedDetail.doDepositAmount) > 0) {
        dplItemsToSync.push({
          key: 'dpl_do_deposit',
          label: 'DO Security Deposit (DPL Arranged)',
          amount: Number(updatedDetail.doDepositAmount),
          receiptUrl: updatedDetail.doReceiptUrl,
          receiptName: updatedDetail.doReceiptName
        });
      }
    }

    if (isExciseStep) {
      if (updatedDetail.exciseHandledBy === 'DPL' && Number(updatedDetail.exciseAmount) > 0) {
        dplItemsToSync.push({
          key: 'dpl_excise',
          label: `Excise Duty Payment (${updatedDetail.exciseRegion || 'Sindh'}) (DPL Arranged)`,
          amount: Number(updatedDetail.exciseAmount),
          receiptUrl: updatedDetail.exciseReceiptUrl,
          receiptName: updatedDetail.exciseReceiptName
        });
      }
    }

    if (isVehicleStep) {
      if (updatedDetail.vehicleRentArrangedBy === 'DPL' && Number(updatedDetail.vehicleRentAmount) > 0) {
        dplItemsToSync.push({
          key: 'dpl_vehicle_rent',
          label: 'Vehicle Freight / Rent (DPL Arranged)',
          amount: Number(updatedDetail.vehicleRentAmount)
        });
      }
    }

    if (isLoadingStep) {
      if (updatedDetail.trackerArrangedBy === 'DPL' && Number(updatedDetail.trackerAmount) > 0) {
        dplItemsToSync.push({
          key: 'dpl_tracker',
          label: 'Tracking Device Fee (DPL Arranged)',
          amount: Number(updatedDetail.trackerAmount)
        });
      }
      if (updatedDetail.loadingChargesArrangedBy === 'DPL' && Number(updatedDetail.loadingChargesAmount) > 0) {
        dplItemsToSync.push({
          key: 'dpl_loading',
          label: 'Port Loading Charges (DPL Arranged)',
          amount: Number(updatedDetail.loadingChargesAmount)
        });
      }
    }

    // Import & Export Services charges sync
    if (updatedDetail.truckingArrangedBy === 'DPL' && Number(updatedDetail.truckingChargesAmount) > 0) {
      dplItemsToSync.push({
        key: 'dpl_ie_trucking',
        label: 'Inland Drayage / Haulage (DPL Arranged)',
        amount: Number(updatedDetail.truckingChargesAmount),
        receiptUrl: updatedDetail.truckingWaybillUrl,
        receiptName: updatedDetail.truckingWaybillName
      });
    }
    if (updatedDetail.destinationChargesArrangedBy === 'DPL' && Number(updatedDetail.destinationChargesAmount) > 0) {
      dplItemsToSync.push({
        key: 'dpl_ie_dest_charges',
        label: 'Destination Ocean & Port Charges (DPL Arranged)',
        amount: Number(updatedDetail.destinationChargesAmount),
        receiptUrl: updatedDetail.destinationDoDocUrl,
        receiptName: updatedDetail.destinationDoDocName
      });
    }

    // Clean up old items for this step
    const keysToClean: string[] = [];
    if (isDoStep) keysToClean.push('dpl_do_due_charges', 'dpl_do_deposit');
    if (isExciseStep) keysToClean.push('dpl_excise');
    if (isVehicleStep) keysToClean.push('dpl_vehicle_rent');
    if (isLoadingStep) keysToClean.push('dpl_tracker', 'dpl_loading');
    if (updatedDetail.truckingArrangedBy === 'Client') keysToClean.push('dpl_ie_trucking');
    if (updatedDetail.destinationChargesArrangedBy === 'Client') keysToClean.push('dpl_ie_dest_charges');
    
    let filtered = existingCharges.filter(c => {
      const matchKey = keysToClean.some(k => (c as any).syncKey === k || (c as any).syncKey === `${k}_comm`);
      return !matchKey;
    });

    // Append newly active items (zero commission)
    dplItemsToSync.forEach(item => {
      filtered.push({
        id: `chg_${item.key}_${Date.now()}`,
        description: item.label,
        category: 'DPL Disbursed Expense',
        amount: item.amount,
        receiptUrl: item.receiptUrl,
        receiptName: item.receiptName,
        taxable: false,
        arrangedBy: 'DPL',
        ...({ syncKey: item.key } as any)
      });
    });

    return filtered;
  };

  const handleSave = (isCompleting: boolean, forceGateOutComplete?: boolean) => {
    const effectiveCompleting = isCompleting || Boolean(forceGateOutComplete);
    if (effectiveCompleting) {
      const validation = validateStepStrict();
      if (!validation.valid) {
        setValidationError(validation.error || 'Please fill all required fields before finishing.');
        return;
      }
    }

    const currentWorkflow = targetCase.workflowDetails || {};
    let finalStatus = targetCase.status;
    let isCompleted = false;

    if (effectiveCompleting) {
      isCompleted = true;
      const totalSteps = categoryWorkflow.totalSteps;
      if (stepStatus === CaseStatus.LOADING_PORT_PROCESSING || (normCategory === 'Bonded Carrier' && stepIndex === 4)) {
        finalStatus = CaseStatus.IN_TRANSIT;
      } else if (stepStatus === CaseStatus.DESTINATION_PORT_ARRIVAL || (normCategory === 'Bonded Carrier' && (stepIndex === 6 || stepIndex === 7))) {
        finalStatus = CaseStatus.COMPLETED;
      } else if (stepIndex < totalSteps - 1) {
        finalStatus = categoryWorkflow.steps[stepIndex + 1].id as any;
      } else {
        finalStatus = CaseStatus.COMPLETED;
      }
    } else {
      isCompleted = false;
    }

    // Loading Gate-Out auto-completion trigger:
    // Once Gate-Out is confirmed at the loading port, the Loading Port workflow completes automatically and transitions the case to In Transit.
    if (
      (stepStatus === CaseStatus.LOADING_PORT_PROCESSING || (normCategory === 'Bonded Carrier' && stepIndex === 4)) &&
      (formData.gateOutToggled || forceGateOutComplete) &&
      formData.portGatePassUrl &&
      formData.customsSealNumber?.trim()
    ) {
      isCompleted = true;
      finalStatus = CaseStatus.IN_TRANSIT;
    }

    // Final step completion trigger (Destination Port Arrival -> Case Finish)
    if (
      (stepIndex === categoryWorkflow.totalSteps - 1 || stepStatus === CaseStatus.DESTINATION_PORT_ARRIVAL || (normCategory === 'Bonded Carrier' && (stepIndex === 6 || stepIndex === 7))) &&
      (effectiveCompleting || (formData.destinationGateInToggled && formData.containerUnloadedToggled && formData.vehicleGateOutToggled) || formData.outOfChargeCleared)
    ) {
      finalStatus = CaseStatus.COMPLETED;
      isCompleted = true;
    }

    const updatedStepDetail: CaseStepDetail = {
      ...formData,
      gateOutToggled: forceGateOutComplete ? true : formData.gateOutToggled,
      status: stepStatus,
      completed: isCompleted,
      updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Calculate updated billable charges
    const updatedCharges = syncDplExpensesToInvoice(targetCase, updatedStepDetail);

    // Update container with vehicle & driver if assigned in Vehicle Assignment
    let updatedContainers = targetCase.containers ? [...targetCase.containers] : [];
    if ((stepIndex === 3 || stepStatus === CaseStatus.VEHICLE_ASSIGNMENT) && formData.assignedVehicleNo) {
      updatedContainers = updatedContainers.map(c => ({
        ...c,
        vehicleNo: formData.assignedVehicleNo,
        driverName: formData.driverName || c.driverName,
        driverContact: formData.driverContact || (c as any).driverContact,
        driverCnic: formData.driverCnic || c.driverCnic
      }));
    }

    // Extract all uploaded step files/receipts across current step AND all workflow steps when archiving/saving
    const mergedWorkflowDetails: Record<string, CaseStepDetail> = {
      ...currentWorkflow,
      [stepStatus]: updatedStepDetail
    };

    // When Loading completes and transitions to IN_TRANSIT, also activate IN_TRANSIT step detail
    if (
      (stepStatus === CaseStatus.LOADING_PORT_PROCESSING || (normCategory === 'Bonded Carrier' && stepIndex === 4)) &&
      isCompleted &&
      finalStatus === CaseStatus.IN_TRANSIT
    ) {
      const existingTransit = mergedWorkflowDetails[CaseStatus.IN_TRANSIT] || ({} as CaseStepDetail);
      mergedWorkflowDetails[CaseStatus.IN_TRANSIT] = {
        ...existingTransit,
        status: CaseStatus.IN_TRANSIT,
        inTransitActive: true,
        date: existingTransit.date || new Date().toISOString().split('T')[0],
        updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
    }

    const existingDocs = [...(targetCase.documents || [])];
    Object.values(mergedWorkflowDetails).forEach(detailObj => {
      if (!detailObj) return;
      const docsFromDetail = extractDocsFromStep(detailObj);
      docsFromDetail.forEach(newDoc => {
        if (!existingDocs.some((d: any) => d.url === newDoc.url || (d.name === newDoc.name && d.name !== 'Document'))) {
          existingDocs.push(newDoc);
        }
      });
    });

    // If Loading Port Staff updated driver CNIC / name / front & back in Step 5, sync it to VEHICLE_ASSIGNMENT step as well
    if (
      (stepIndex === 4 || stepStatus === CaseStatus.LOADING_PORT_PROCESSING) &&
      (formData.driverCnic || formData.driverName || formData.driverCnicFrontUrl || formData.driverCnicBackUrl)
    ) {
      const existingVehStep = mergedWorkflowDetails[CaseStatus.VEHICLE_ASSIGNMENT] || ({ status: CaseStatus.VEHICLE_ASSIGNMENT } as CaseStepDetail);
      mergedWorkflowDetails[CaseStatus.VEHICLE_ASSIGNMENT] = {
        ...existingVehStep,
        assignedVehicleNo: existingVehStep.assignedVehicleNo || formData.assignedVehicleNo || targetCase.containers?.[0]?.vehicleNo,
        driverName: formData.driverName || existingVehStep.driverName,
        driverCnic: formData.driverCnic || existingVehStep.driverCnic,
        driverCnicFrontUrl: formData.driverCnicFrontUrl || existingVehStep.driverCnicFrontUrl,
        driverCnicFrontName: formData.driverCnicFrontName || existingVehStep.driverCnicFrontName,
        driverCnicBackUrl: formData.driverCnicBackUrl || existingVehStep.driverCnicBackUrl,
        driverCnicBackName: formData.driverCnicBackName || existingVehStep.driverCnicBackName,
      };
    }

    const vehStep = mergedWorkflowDetails[CaseStatus.VEHICLE_ASSIGNMENT] || ((stepIndex === 3 || stepStatus === CaseStatus.VEHICLE_ASSIGNMENT) ? updatedStepDetail : undefined);
    const loadingStepForSync = mergedWorkflowDetails[CaseStatus.LOADING_PORT_PROCESSING];
    const resolvedPlate = vehStep?.assignedVehicleNo || loadingStepForSync?.assignedVehicleNo || targetCase.vehicleAssignment?.vehicleNo || targetCase.containers?.[0]?.vehicleNo;
    const syncedVehicleAssignment = resolvedPlate ? {
      ...(targetCase.vehicleAssignment || {}),
      vehicleId: matchedVehicle ? String(matchedVehicle.id) : targetCase.vehicleAssignment?.vehicleId,
      vehicleNo: resolvedPlate,
      driverName: formData.driverName || vehStep?.driverName || loadingStepForSync?.driverName || targetCase.vehicleAssignment?.driverName || '',
      driverCnic: formData.driverCnic || vehStep?.driverCnic || loadingStepForSync?.driverCnic || targetCase.vehicleAssignment?.driverCnic || '',
      driverContact: formData.driverContact || vehStep?.driverContact || matchedVehicle?.driverContact || targetCase.vehicleAssignment?.driverContact || '',
      transporterName: matchedVehicle?.transporterName || matchedVehicle?.brokerName || targetCase.vehicleAssignment?.transporterName || '',
      brokerName: matchedVehicle?.brokerName || matchedVehicle?.transporterName || targetCase.vehicleAssignment?.brokerName || '',
      allocationDate: vehStep?.date || targetCase.vehicleAssignment?.allocationDate || new Date().toISOString().split('T')[0],
      registrationBookUrl: vehStep?.registrationBookUrl || matchedVehicle?.registrationBook || targetCase.vehicleAssignment?.registrationBookUrl,
      registrationBookName: vehStep?.registrationBookName || matchedVehicle?.registrationBookName || targetCase.vehicleAssignment?.registrationBookName,
      ownerCnicUrl: vehStep?.ownerCnicUrl || matchedVehicle?.ownerIdCardUrl || targetCase.vehicleAssignment?.ownerCnicUrl,
      ownerCnicName: vehStep?.ownerCnicName || matchedVehicle?.ownerIdCardName || targetCase.vehicleAssignment?.ownerCnicName,
      driverCnicFrontUrl: formData.driverCnicFrontUrl || vehStep?.driverCnicFrontUrl || loadingStepForSync?.driverCnicFrontUrl || targetCase.vehicleAssignment?.driverCnicFrontUrl,
      driverCnicFrontName: formData.driverCnicFrontName || vehStep?.driverCnicFrontName || loadingStepForSync?.driverCnicFrontName || targetCase.vehicleAssignment?.driverCnicFrontName,
      driverCnicBackUrl: formData.driverCnicBackUrl || vehStep?.driverCnicBackUrl || loadingStepForSync?.driverCnicBackUrl || targetCase.vehicleAssignment?.driverCnicBackUrl,
      driverCnicBackName: formData.driverCnicBackName || vehStep?.driverCnicBackName || loadingStepForSync?.driverCnicBackName || targetCase.vehicleAssignment?.driverCnicBackName,
    } : targetCase.vehicleAssignment;

    let updatedCase: Case = {
      ...targetCase,
      status: finalStatus,
      vehicleNumber: syncedVehicleAssignment?.vehicleNo || targetCase.vehicleNumber,
      driverName: syncedVehicleAssignment?.driverName || targetCase.driverName,
      vehicleAssignment: syncedVehicleAssignment,
      charges: updatedCharges,
      containers: updatedContainers,
      documents: existingDocs,
      workflowDetails: mergedWorkflowDetails,
      ...(finalStatus === CaseStatus.COMPLETED
        ? {
            completedAt: (targetCase as any).completedAt || new Date().toISOString(),
            permanentlyArchived: true
          }
        : {})
    };

    // Enrich with loading port gate-out duration, transit duration, and destination unloading & gate-out duration across all categories
    updatedCase = enrichCaseWithTripTimings(updatedCase, String(stepStatus), updatedStepDetail);

    // Sync Vehicle Registration Book & Owner ID Card back to the master Vehicle record if uploaded here
    if (matchedVehicle && (formData.registrationBookUrl || formData.ownerCnicUrl)) {
      const updatedVeh: Vehicle = {
        ...matchedVehicle,
        registrationBook: formData.registrationBookUrl || matchedVehicle.registrationBook,
        registrationBookName: formData.registrationBookName || matchedVehicle.registrationBookName || 'Vehicle_Reg_Book',
        ownerIdCardUrl: formData.ownerCnicUrl || matchedVehicle.ownerIdCardUrl,
        ownerIdCardName: formData.ownerCnicName || matchedVehicle.ownerIdCardName || 'Owner_CNIC',
      };
      updateVehicleInFirestore(updatedVeh).catch(() => {});
    }

    // Persist Driver to Global Driver Backup (so future CNIC lookups auto-fill Name & Front/Back CNIC)
    if (formData.driverCnic && formData.driverName) {
      upsertDriverBackupFromWorkflow({
        driverCnic: formData.driverCnic,
        driverName: formData.driverName,
        driverContact: formData.driverContact || matchedVehicle?.driverContact || targetCase.vehicleAssignment?.driverContact || '',
        driverCnicFrontUrl: formData.driverCnicFrontUrl,
        driverCnicFrontName: formData.driverCnicFrontName,
        driverCnicBackUrl: formData.driverCnicBackUrl,
        driverCnicBackName: formData.driverCnicBackName,
        vehiclePlate: formData.assignedVehicleNo,
        transporterName: matchedVehicle?.transporterName || matchedVehicle?.brokerName
      }).catch(() => {});
    }

    // Record / update this case in the assigned vehicle's Trips History
    if (updatedCase.vehicleAssignment?.vehicleNo) {
      recordVehicleTripFromCase(updatedCase).catch(() => {});
    }

    // If container is unloaded & vehicle gates out at destination (or final step completes), automatically expire/block Driver Trip Login ID
    const isDestGateOutDone =
      updatedStepDetail.vehicleGateOutToggled === true ||
      updatedStepDetail.gateOutVehicle === true ||
      updatedStepDetail.outOfChargeCleared === true ||
      finalStatus === CaseStatus.COMPLETED ||
      isDestinationUnloadedAndGateOut(updatedCase);

    if (isDestGateOutDone && !updatedCase.driverTripIdExpiredOnGateOut) {
      updatedCase = {
        ...updatedCase,
        driverTripIdExpiredOnGateOut: true
      };
      expireDriverTripCredentialsOnGateOut(updatedCase).catch(err =>
        console.warn('Could not auto-expire driver trip credentials:', err)
      );
    }

    onSaveCase(updatedCase);

    // Dispatch ONLY actionable next-step task notifications to the specific responsible role (NO step-by-step spam or vehicle leaks to Client/Admin)
    if (isCompleted && finalStatus !== CaseStatus.COMPLETED && stepIndex < categoryWorkflow.totalSteps - 1) {
      const nextStep = categoryWorkflow.steps[stepIndex + 1];
      const nextArrangedBy = getStepArrangedBy(updatedCase, nextStep.id, stepIndex + 1);
      const primaryTargetRole = getStepTargetRole(targetCase.category, nextStep.id, stepIndex + 1, updatedCase);

      if (nextArrangedBy === 'Client' && updatedCase.clientName) {
        sendAppNotification({
          title: `Action Required: #${updatedCase.caseNo} — ${nextStep.title}`,
          description: `Case #${updatedCase.caseNo} requires Client update for Step ${stepIndex + 2}: ${nextStep.title}.`,
          details: `Case No: ${updatedCase.caseNo}\nClient: ${updatedCase.clientName}\nStep Required: ${nextStep.title}`,
          targetRole: 'CLIENT',
          targetClientName: updatedCase.clientName,
          targetView: 'cases',
          targetFilter: {
            caseNo: updatedCase.caseNo,
            stepId: nextStep.id,
            stepIndex: stepIndex + 1,
            action: 'UPDATE_STEP'
          },
          type: 'ACTION',
          notificationSubType: 'CLIENT_MANAGED_DEMAND',
          actionLabel: 'Update Step',
          category: 'CASE',
          performedBy: String(userRole)
        }).catch(() => {});
      } else if (primaryTargetRole && String(primaryTargetRole) !== 'ADMIN' && String(primaryTargetRole) !== 'CLIENT') {
        sendAppNotification({
          title: `Workflow Task Assigned: #${updatedCase.caseNo} — ${nextStep.title}`,
          description: `Case #${updatedCase.caseNo} (${updatedCase.clientName || 'Client'}) is ready for ${nextStep.title}.`,
          details: `Case No: ${updatedCase.caseNo}\nClient: ${updatedCase.clientName || 'N/A'}\nAssigned Step: ${nextStep.title}\nAssigned Role: ${String(primaryTargetRole).replace(/_/g, ' ')}`,
          targetRole: String(primaryTargetRole),
          targetView: 'cases',
          targetFilter: {
            caseNo: updatedCase.caseNo,
            stepId: nextStep.id,
            stepIndex: stepIndex + 1,
            action: 'UPDATE_STEP'
          },
          type: 'ACTION',
          notificationSubType: 'WORKFLOW_TASK',
          actionLabel: 'Open Step Workflow',
          category: 'CASE',
          performedBy: String(userRole)
        }).catch(() => {});
      }
    }

    onClose();
  };

  // Destination Staff Vehicle Reception Trigger (Completes Transit & Starts Destination Unloading; triggers Destination Arrival notification via saveCaseToFirestore)
  const handleDestinationArrivalPhotoUploaded = (photoUrl?: string) => {
    const nowDate = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const nowIso = new Date().toISOString();

    setFormData(prev => ({
      ...prev,
      ...(photoUrl ? { portGateArrivalPhotoUrl: photoUrl, portGateArrivalPhotoName: 'Destination Vehicle Reception' } : {}),
      destinationGateInToggled: true
    }));

    // Auto-mark In Transit as completed in targetCase AND transition case status to DESTINATION_PORT_ARRIVAL
    const sTransit = targetCase.workflowDetails?.[CaseStatus.IN_TRANSIT] || ({} as CaseStepDetail);
    const updatedTransit: CaseStepDetail = {
      ...sTransit,
      status: CaseStatus.IN_TRANSIT,
      completed: true,
      inTransitActive: false,
      date: nowDate,
      updatedAt: nowTime,
      remarks: (sTransit.remarks || '') + ' (Vehicle Received by Destination Staff — Transit Completed)'
    };

    const sDest = targetCase.workflowDetails?.[CaseStatus.DESTINATION_PORT_ARRIVAL] || ({} as CaseStepDetail);
    const updatedDest: CaseStepDetail = {
      ...sDest,
      ...(stepStatus === CaseStatus.DESTINATION_PORT_ARRIVAL ? formData : {}),
      status: CaseStatus.DESTINATION_PORT_ARRIVAL,
      ...(photoUrl ? { portGateArrivalPhotoUrl: photoUrl, portGateArrivalPhotoName: 'Destination Vehicle Reception' } : {}),
      destinationGateInToggled: true,
      date: sDest.date || nowDate,
      updatedAt: nowTime
    };

    const existingDocs = [...(targetCase.documents || [])];
    if (photoUrl && !existingDocs.some((d: any) => d.url === photoUrl)) {
      existingDocs.push({
        id: `doc_dest_arrival_${Date.now()}`,
        name: `Destination_Vehicle_Reception_${targetCase.caseNo}.pdf`,
        url: photoUrl,
        type: 'Destination Vehicle Reception',
        uploadedAt: nowIso
      });
    }

    const nextCaseStatus =
      targetCase.status === CaseStatus.COMPLETED
        ? CaseStatus.COMPLETED
        : CaseStatus.DESTINATION_PORT_ARRIVAL;

    let updatedCase: Case = {
      ...targetCase,
      status: nextCaseStatus,
      destinationPortArrivalTime: targetCase.destinationPortArrivalTime || nowIso,
      destinationGateInToggled: true,
      documents: existingDocs,
      workflowDetails: {
        ...(targetCase.workflowDetails || {}),
        [CaseStatus.IN_TRANSIT]: updatedTransit,
        [CaseStatus.DESTINATION_PORT_ARRIVAL]: updatedDest
      }
    };

    updatedCase = enrichCaseWithTripTimings(updatedCase, CaseStatus.DESTINATION_PORT_ARRIVAL, updatedDest);
    onSaveCase(updatedCase);
  };

  const handleTriggerIncident = () => {
    if (!incidentForm.reason.trim()) {
      alert('Please specify the incident / stoppage reason.');
      return;
    }

    const updatedCase: Case = {
      ...targetCase,
      status: CaseStatus.INCIDENT_STOPPAGE,
      isIncidentVault: true,
      incidentDetails: {
        reportedAt: new Date().toISOString(),
        reportedBy: userRole,
        reason: incidentForm.reason,
        location: incidentForm.location || 'En-route',
        emergencyContact: incidentForm.contact
      }
    };

    if (onReportIncident) {
      onReportIncident(updatedCase);
    } else {
      onSaveCase(updatedCase);
    }

    setShowIncidentModal(false);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 z-[110] flex items-start justify-center pt-4 sm:pt-8 p-3 sm:p-5 backdrop-blur-md overflow-y-auto no-print"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-900 rounded-2xl overflow-hidden max-w-3xl w-full border border-white/15 shadow-2xl animate-fade-in max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/10 flex justify-between items-center bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-500/20 text-brand-400 font-mono font-bold flex items-center justify-center border border-brand-500/40 text-sm">
              {stepIndex + 1}
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="text-brand-400 font-semibold">
                  Step {stepIndex + 1} of {categoryWorkflow.totalSteps}
                </span>
                <span aria-hidden="true">·</span>
                <span>{targetCase.category}</span>
                {stepIndex < activeStepIdx && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-400 font-semibold">Completed</span>
                  </>
                )}
              </div>
              <h3 className="text-base font-bold text-white leading-tight">{stepStatus}</h3>
            </div>
          </div>

          <button 
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto custom-scrollbar flex-1 text-xs">
          {/* Read-Only Dossier Lock Banner */}
          {targetCase.status === CaseStatus.COMPLETED && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h4 className="font-bold text-white text-sm">Finalized & Permanently Archived Case Dossier</h4>
                  <p className="text-gray-300 text-[11px]">
                    All operational steps, bills, ledgers, and compliance documents are permanently saved and available for download anytime.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isDestinationUnloadedAndGateOut(targetCase) && (
                  <button
                    type="button"
                    onClick={() => downloadCustomsDeliveryOrderPdf({ targetCase })}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold text-xs border border-amber-500/30 flex items-center gap-1.5 transition-colors"
                  >
                    <FileCheck size={14} />
                    <span>Delivery Order (PDF)</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => downloadCasePdf(targetCase)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 font-semibold text-xs border border-emerald-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Download size={14} />
                  <span>Download Full Dossier (PDF)</span>
                </button>
              </div>
            </div>
          )}

          {/* Role Access Restriction Banner */}
          {!canEditStep && targetCase.status !== CaseStatus.COMPLETED && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3 text-amber-200">
              <div className="flex items-center gap-2.5">
                <Lock size={18} className="text-amber-400 shrink-0" />
                <span className="text-xs">
                  {(stepStatus === CaseStatus.LOADING_PORT_PROCESSING || (normCategory === 'Bonded Carrier' && stepIndex === 4)) ? (
                    <>
                      <strong>Exclusive Loading Staff Stage:</strong> Only <strong>Loading Port Staff</strong> can update the Loading workflow or generate the Loading Bill. (Current Role: <strong>{userRole}</strong> — View Only)
                    </>
                  ) : (stepStatus === CaseStatus.DESTINATION_PORT_ARRIVAL || (normCategory === 'Bonded Carrier' && (stepIndex === 6 || stepIndex === 7))) ? (
                    <>
                      <strong>Exclusive Destination Staff Stage:</strong> Only <strong>Destination Port Staff</strong> can update the Destination Unloading workflow or generate the Destination Bill. (Current Role: <strong>{userRole}</strong> — View Only)
                    </>
                  ) : (
                    <>
                      <strong>Restricted Operational Stage:</strong> You are logged in as <strong>{userRole}</strong>. This stage is editable only by its designated role personnel.
                    </>
                  )}
                </span>
              </div>
              {isDestinationUnloadedAndGateOut(targetCase) && (userRole === UserRole.UNLOADING_PORT_STAFF || userRole === UserRole.DESTINATION_PORT_STAFF || userRole === UserRole.ADMIN || userRole === UserRole.OPERATIONS_MANAGER) && (
                <button
                  type="button"
                  onClick={() => downloadCustomsDeliveryOrderPdf({ targetCase })}
                  className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center gap-1.5 shrink-0 shadow transition-colors"
                >
                  <FileText size={14} />
                  <span>Print Delivery Order (DO)</span>
                </button>
              )}
            </div>
          )}

          {/* DYNAMIC CATEGORY STEP RENDERERS */}
          {normCategory === 'Import & Export Services' && (
            <div className="space-y-4">
              {targetCase.subCategory && targetCase.subCategory !== 'Standard Container / General Cargo' && (
                <CargoEquipmentSubCategoryFields
                  subCategory={targetCase.subCategory}
                  formData={formData}
                  setFormData={setFormData}
                  targetCase={targetCase}
                  setActivePdfPreview={setActivePdfPreview}
                  isReadOnly={isReadOnly}
                />
              )}
              <ImportExportSteps
                stepIndex={stepIndex}
                formData={formData}
                setFormData={setFormData}
                targetCase={targetCase}
                setActivePdfPreview={setActivePdfPreview}
                isReadOnly={isReadOnly}
                availableVehicles={availableVehicles}
              />
            </div>
          )}

          {normCategory === 'Customs Clearance' && (
            <CustomsClearanceSteps
              stepIndex={stepIndex}
              formData={formData}
              setFormData={setFormData}
              targetCase={targetCase}
              setActivePdfPreview={setActivePdfPreview}
              isReadOnly={isReadOnly}
              availableVehicles={availableVehicles}
            />
          )}

          {normCategory === 'Afghan Transit' && (
            <div className="space-y-4">
              {targetCase.subCategory && targetCase.subCategory !== 'Standard Container / General Cargo' && (
                <CargoEquipmentSubCategoryFields
                  subCategory={targetCase.subCategory}
                  formData={formData}
                  setFormData={setFormData}
                  targetCase={targetCase}
                  setActivePdfPreview={setActivePdfPreview}
                  isReadOnly={isReadOnly}
                />
              )}
              <AfghanTransitSteps
                stepIndex={stepIndex}
                formData={formData}
                setFormData={setFormData}
                targetCase={targetCase}
                setActivePdfPreview={setActivePdfPreview}
                isReadOnly={isReadOnly}
                availableVehicles={availableVehicles}
                onTriggerIncident={() => setShowIncidentModal(true)}
                onDestinationArrivalPhotoUploaded={handleDestinationArrivalPhotoUploaded}
              />
            </div>
          )}

          {normCategory === 'TIR' && (
            <TirSteps
              stepIndex={stepIndex}
              formData={formData}
              setFormData={setFormData}
              targetCase={targetCase}
              setActivePdfPreview={setActivePdfPreview}
              isReadOnly={isReadOnly}
              availableVehicles={availableVehicles}
            />
          )}

          {normCategory === 'Transportation of Private Cargo' && (
            <div className="space-y-4">
              {targetCase.subCategory && targetCase.subCategory !== 'Standard Container / General Cargo' && (
                <CargoEquipmentSubCategoryFields
                  subCategory={targetCase.subCategory}
                  formData={formData}
                  setFormData={setFormData}
                  targetCase={targetCase}
                  setActivePdfPreview={setActivePdfPreview}
                  isReadOnly={isReadOnly}
                />
              )}
              <PrivateCargoSteps
                stepIndex={stepIndex}
                formData={formData}
                setFormData={setFormData}
                targetCase={targetCase}
                setActivePdfPreview={setActivePdfPreview}
                isReadOnly={isReadOnly}
                availableVehicles={availableVehicles}
              />
            </div>
          )}

          {normCategory === 'Warehousing & Distribution' && (
            <WarehousingSteps
              stepIndex={stepIndex}
              formData={formData}
              setFormData={setFormData}
              targetCase={targetCase}
              setActivePdfPreview={setActivePdfPreview}
              isReadOnly={isReadOnly}
              availableVehicles={availableVehicles}
            />
          )}

          {normCategory === 'Car Carrier' && (
            <CarCarrierSteps
              stepIndex={stepIndex}
              formData={formData}
              setFormData={setFormData}
              targetCase={targetCase}
              setActivePdfPreview={setActivePdfPreview}
              isReadOnly={isReadOnly}
              availableVehicles={availableVehicles}
            />
          )}

          {normCategory === 'ISO Tank Service' && (
            <IsoTankSteps
              stepIndex={stepIndex}
              formData={formData}
              setFormData={setFormData}
              targetCase={targetCase}
              setActivePdfPreview={setActivePdfPreview}
              isReadOnly={isReadOnly}
              availableVehicles={availableVehicles}
            />
          )}

          {normCategory === 'Breakbulk / Chartering Services' && (
            <BreakbulkSteps
              stepIndex={stepIndex}
              formData={formData}
              setFormData={setFormData}
              targetCase={targetCase}
              setActivePdfPreview={setActivePdfPreview}
              isReadOnly={isReadOnly}
              availableVehicles={availableVehicles}
            />
          )}

          {normCategory === 'Liner & NVOCC' && (
            <LinerNvoccSteps
              stepIndex={stepIndex}
              formData={formData}
              setFormData={setFormData}
              targetCase={targetCase}
              setActivePdfPreview={setActivePdfPreview}
              isReadOnly={isReadOnly}
              availableVehicles={availableVehicles}
            />
          )}

          {/* BONDED CARRIER (CORE 8-STEP WORKFLOW) */}
          {(normCategory === 'Bonded Carrier' || !['Customs Clearance', 'Afghan Transit', 'TIR', 'Transportation of Private Cargo', 'Warehousing & Distribution', 'Car Carrier', 'ISO Tank Service', 'Breakbulk / Chartering Services', 'Liner & NVOCC'].includes(normCategory)) && (
            <div className="space-y-6">
              {targetCase.subCategory && targetCase.subCategory !== 'Standard Container / General Cargo' && (
                <CargoEquipmentSubCategoryFields
                  subCategory={targetCase.subCategory}
                  formData={formData}
                  setFormData={setFormData}
                  targetCase={targetCase}
                  setActivePdfPreview={setActivePdfPreview}
                  isReadOnly={isReadOnly}
                />
              )}
          {/* STEP 1: SHIPPING LINE DO */}
          {stepIndex === 0 && (
            <div className="space-y-4">
              {/* Top Choice: Arrange by DPL vs Arrange by Client */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <span className="font-bold text-white text-sm block">Shipping Line DO Arrangement</span>
                    <span className="text-gray-400 text-xs">Select whether Delivery Order is arranged by DPL or directly by client</span>
                  </div>
                  <div className="flex rounded-xl bg-slate-800 p-1 border border-white/10">
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, doDueChargesArrangedBy: 'DPL' }))}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        formData.doDueChargesArrangedBy === 'DPL' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Arrange by DPL
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, doDueChargesArrangedBy: 'Client' }))}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        formData.doDueChargesArrangedBy === 'Client' ? 'bg-brand-600 text-white shadow' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Arrange by Client
                    </button>
                  </div>
                </div>
              </div>

              {formData.doDueChargesArrangedBy === 'Client' ? (
                /* Arranged by Client view */
                <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
                      <User size={16} />
                      <span>Arranged by Client</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                      Client / Loading Staff Updatable
                    </span>
                  </div>
                  <p className="text-xs text-sky-200/90 leading-relaxed">
                    Client has been notified to provide and settle DO documents directly with the shipping line.
                  </p>
                  <div className="p-3 rounded-xl bg-black/40 border border-sky-500/20 text-xs text-gray-300">
                    <p className="text-[11px] text-gray-300">
                      <strong>Port Operations Handover:</strong> Loading port staff can also open this container and update the DO workflow when receiving physical documents at port.
                    </p>
                  </div>

                  <WorkflowMultiUploader
                    label="Delivery Order Document (Optional / If received)"
                    sublabel="Upload or take photo of DO document received from client"
                    urlField="doReceiptUrl"
                    nameField="doReceiptName"
                    allowCamera={true}
                    formData={formData}
                    setFormData={setFormData}
                    onPreview={setActivePdfPreview}
                  />
                </div>
              ) : (
                /* Arranged by DPL view */
                <div className="space-y-4">
                  {/* DO Document Upload Button right AT THE TOP */}
                  <WorkflowMultiUploader
                    label="Delivery Order Document(s) *"
                    sublabel="Upload physical DO document / payment receipt (Supports multiple files, camera capture & PDF)"
                    urlField="doReceiptUrl"
                    nameField="doReceiptName"
                    allowCamera={true}
                    formData={formData}
                    setFormData={(updater: any) => {
                      setFormData(prev => {
                        const updated = typeof updater === 'function' ? updater(prev) : updater;
                        if (!updated.doIssueDate) {
                          updated.doIssueDate = new Date().toISOString().split('T')[0];
                        }
                        const docName = (updated.doReceiptName || '').toLowerCase();
                        if (docName.includes('maersk') && !updated.shippingLine) updated.shippingLine = 'Maersk Line';
                        else if (docName.includes('msc') && !updated.shippingLine) updated.shippingLine = 'MSC';
                        else if (docName.includes('hapag') && !updated.shippingLine) updated.shippingLine = 'Hapag-Lloyd';
                        else if (docName.includes('cosco') && !updated.shippingLine) updated.shippingLine = 'COSCO Shipping';
                        else if (docName.includes('cma') && !updated.shippingLine) updated.shippingLine = 'CMA CGM';
                        else if (docName.includes('one') && !updated.shippingLine) updated.shippingLine = 'ONE';
                        return updated;
                      });
                    }}
                    onPreview={setActivePdfPreview}
                  />

                  {/* The 6 clean simple fields with Paid by DPL checkboxes */}
                  <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-4">
                    <span className="font-bold text-white text-xs uppercase tracking-wider block">
                      Delivery Order Particulars:
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* 1. Shipping Line */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="font-semibold text-gray-300 text-xs">Shipping Line</label>
                          <label className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.shippingLinePaidByDpl ?? true}
                              onChange={(e) => setFormData({ ...formData, shippingLinePaidByDpl: e.target.checked })}
                              className="accent-emerald-500 rounded"
                            />
                            <span>Paid by DPL</span>
                          </label>
                        </div>
                        <input
                          type="text"
                          list="shippingLineOptionsList"
                          value={formData.shippingLine || ''}
                          onChange={(e) => setFormData({ ...formData, shippingLine: e.target.value })}
                          placeholder="e.g. Maersk Line, MSC, Hapag-Lloyd"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-xs font-medium"
                        />
                        <datalist id="shippingLineOptionsList">
                          <option value="Maersk Line" />
                          <option value="MSC (Mediterranean Shipping Company)" />
                          <option value="CMA CGM" />
                          <option value="COSCO Shipping Lines" />
                          <option value="Hapag-Lloyd" />
                          <option value="ONE (Ocean Network Express)" />
                          <option value="Evergreen Marine" />
                          <option value="OOCL" />
                          <option value="Yang Ming" />
                          <option value="Wan Hai Lines" />
                          <option value="Hyundai Merchant Marine (HMM)" />
                          <option value="PIL (Pacific International Lines)" />
                        </datalist>
                      </div>

                      {/* 2. Shipping Agent */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="font-semibold text-gray-300 text-xs">Shipping Agent</label>
                          <label className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.shippingAgentPaidByDpl ?? true}
                              onChange={(e) => setFormData({ ...formData, shippingAgentPaidByDpl: e.target.checked })}
                              className="accent-emerald-500 rounded"
                            />
                            <span>Paid by DPL</span>
                          </label>
                        </div>
                        <input
                          type="text"
                          value={formData.shippingAgent || ''}
                          onChange={(e) => setFormData({ ...formData, shippingAgent: e.target.value })}
                          placeholder="e.g. Marine Services / Greenpak"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-xs font-medium"
                        />
                      </div>

                      {/* 3. DO Deposit */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="font-semibold text-gray-300 text-xs">DO Deposit (PKR)</label>
                          <label className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.doDepositPaidByDpl ?? (formData.doDepositArrangedBy === 'DPL')}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setFormData({ 
                                  ...formData, 
                                  doDepositPaidByDpl: checked,
                                  doDepositArrangedBy: checked ? 'DPL' : 'Client' 
                                });
                              }}
                              className="accent-emerald-500 rounded"
                            />
                            <span>Paid by DPL</span>
                          </label>
                        </div>
                        <input
                          type="number"
                          value={formData.doDepositAmount || ''}
                          onChange={(e) => setFormData({ ...formData, doDepositAmount: Number(e.target.value) })}
                          placeholder="0"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-xs"
                        />
                        <span className="text-[10px] text-gray-500 block">Refundable container security guarantee</span>
                      </div>

                      {/* 4. DO Charges */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="font-semibold text-gray-300 text-xs">DO Charges (PKR)</label>
                          <label className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.doChargesPaidByDpl ?? (formData.doDueChargesArrangedBy === 'DPL')}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setFormData({ 
                                  ...formData, 
                                  doChargesPaidByDpl: checked,
                                  doDueChargesArrangedBy: checked ? 'DPL' : 'Client'
                                });
                              }}
                              className="accent-emerald-500 rounded"
                            />
                            <span>Paid by DPL</span>
                          </label>
                        </div>
                        <input
                          type="number"
                          value={formData.doDueChargesAmount || ''}
                          onChange={(e) => setFormData({ ...formData, doDueChargesAmount: Number(e.target.value) })}
                          placeholder="0"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-xs"
                        />
                        <span className="text-[10px] text-gray-500 block">Shipping line document & release charges</span>
                      </div>

                      {/* 5. Container Rental Period */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="font-semibold text-gray-300 text-xs">Container Rental Period (Days)</label>
                          <label className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.containerRentalPaidByDpl ?? true}
                              onChange={(e) => setFormData({ ...formData, containerRentalPaidByDpl: e.target.checked })}
                              className="accent-emerald-500 rounded"
                            />
                            <span>Paid by DPL</span>
                          </label>
                        </div>
                        <input
                          type="text"
                          value={formData.containerRentalPeriod || ''}
                          onChange={(e) => setFormData({ ...formData, containerRentalPeriod: e.target.value })}
                          placeholder="e.g. 14 Days"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-xs font-medium"
                        />
                        <span className="text-[10px] text-gray-500 block">Free detention & allowable rental period</span>
                      </div>

                      {/* 6. DO Date */}
                      <div className="space-y-1.5">
                        <label className="font-semibold text-gray-300 text-xs block">DO Date</label>
                        <input
                          type="date"
                          value={formData.doIssueDate || new Date().toISOString().split('T')[0]}
                          onChange={(e) => setFormData({ ...formData, doIssueDate: e.target.value, date: e.target.value })}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-xs"
                        />
                        <span className="text-[10px] text-emerald-400 block">Auto-filled with today's date</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: TP FILING */}
          {stepIndex === 1 && (
            <div className="space-y-4">
              {/* TP/GD Print Document Upload */}
              <WorkflowMultiUploader
                label="Customs TP / GD Print Document"
                sublabel="Upload customs transit permit or goods declaration (Supports multi-page, camera capture, replace & remove)"
                urlField="tpGdPrintUrl"
                nameField="tpGdPrintName"
                formData={formData}
                setFormData={setFormData}
                onPreview={setActivePdfPreview}
              />

              {/* Number & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-gray-300 block mb-1.5">TP / GD Reference Number</label>
                  <input 
                    type="text"
                    value={formData.tpGdNumber}
                    onChange={(e) => setFormData({ ...formData, tpGdNumber: e.target.value, referenceNo: e.target.value })}
                    placeholder="e.g. KPT-TP-2024-998"
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-gray-300 block mb-1.5">TP Filing Date</label>
                  <input 
                    type="date"
                    value={formData.tpFilingDate}
                    onChange={(e) => setFormData({ ...formData, tpFilingDate: e.target.value, date: e.target.value })}
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              {/* Item Description */}
              <div>
                <label className="font-semibold text-gray-300 block mb-1.5">Item Description as per TP/GD</label>
                <textarea 
                  value={formData.tpItemDescription}
                  onChange={(e) => setFormData({ ...formData, tpItemDescription: e.target.value })}
                  placeholder="Enter goods description, packaging count, HS codes, or cargo specifications as stated on the TP/GD document..."
                  rows={3}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl p-3 text-white placeholder-gray-500"
                />
              </div>

              {/* Filing Entity Toggle */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 flex items-center justify-between">
                <div>
                  <span className="font-bold text-white text-sm block">Filing Entity</span>
                  <span className="text-gray-400 text-[11px]">Select whether TP was filed by the client or DPL customs brokerage</span>
                </div>
                <div className="flex rounded-xl bg-slate-800 p-1 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, tpFilingEntity: 'Client' })}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      formData.tpFilingEntity === 'Client' ? 'bg-brand-600 text-white shadow' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Filed by Client
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, tpFilingEntity: 'DPL' })}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      formData.tpFilingEntity === 'DPL' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Filed by DPL
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: EXCISE PAYMENT */}
          {stepIndex === 2 && (
            <div className="space-y-4">
              {/* Payment Entity Handled By (Client vs DPL) */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 flex items-center justify-between">
                <div>
                  <span className="font-bold text-white text-sm block">Excise Payment Handled By</span>
                  <span className="text-[11px] text-gray-400">
                    {formData.exciseHandledBy === 'DPL' 
                      ? 'Arranged by DPL: Auto-appends excise amount to final client invoice' 
                      : 'Arranged by Client: Expense not billed to invoice'}
                  </span>
                </div>
                <div className="flex rounded-xl bg-slate-800 p-1 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, exciseHandledBy: 'Client' })}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      (formData.exciseHandledBy || 'Client') === 'Client' ? 'bg-brand-600 text-white shadow' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Paid by Client
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, exciseHandledBy: 'DPL' })}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      formData.exciseHandledBy === 'DPL' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Paid by DPL
                  </button>
                </div>
              </div>

              {/* Payment Receipt */}
              <WorkflowMultiUploader
                label="Excise Payment Receipt"
                sublabel="Upload bank challan / provincial excise receipt (Supports multi-page, camera capture, replace & remove)"
                urlField="exciseReceiptUrl"
                nameField="exciseReceiptName"
                formData={formData}
                setFormData={setFormData}
                onPreview={setActivePdfPreview}
              />

              {/* Excise Amount & Reference */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-gray-300 block mb-1.5">Excise Paid Amount (PKR)</label>
                  <input 
                    type="number"
                    value={formData.exciseAmount || ''}
                    onChange={(e) => setFormData({ ...formData, exciseAmount: Number(e.target.value) })}
                    placeholder="e.g. 4500"
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-gray-300 block mb-1.5">Excise Challan / Reference No.</label>
                  <input 
                    type="text"
                    value={formData.exciseReferenceNo}
                    onChange={(e) => setFormData({ ...formData, exciseReferenceNo: e.target.value, referenceNo: e.target.value })}
                    placeholder="e.g. EXC-SND-99210"
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              {/* Mandatory Pakistan Administrative Region */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-amber-400 block mb-1.5 flex items-center gap-1.5">
                    <MapPin size={13} /> Excise Administrative Region (Mandatory)
                  </label>
                  <select 
                    value={formData.exciseRegion}
                    onChange={(e) => setFormData({ ...formData, exciseRegion: e.target.value })}
                    className="w-full bg-slate-800 border border-amber-500/40 rounded-xl px-3 py-2 text-white font-semibold focus:border-amber-400 focus:outline-none"
                  >
                    {PAKISTAN_REGIONS.map(reg => (
                      <option key={reg} value={reg} className="bg-slate-900 text-white">
                        {reg}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-gray-300 block mb-1.5">Excise Payment Date</label>
                  <input 
                    type="date"
                    value={formData.excisePaymentDate}
                    onChange={(e) => setFormData({ ...formData, excisePaymentDate: e.target.value, date: e.target.value })}
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: VEHICLE ASSIGNMENT (STEP INDEX 3) */}
          {(stepIndex === 3 || stepStatus === CaseStatus.VEHICLE_ASSIGNMENT) && (
            <div className="space-y-4">
              {/* Vehicle Registration & DB Verification */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-white text-sm flex items-center gap-2">
                    <Truck size={16} className="text-brand-400" />
                    <span>Vehicle Registration & Database Validation</span>
                  </label>
                  {matchedVehicle ? (
                    <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                      <CheckCircle2 size={12} /> Database Verified Profile
                    </span>
                  ) : (
                    <span className="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full font-medium">
                      Pending Validation
                    </span>
                  )}
                </div>

                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input 
                      type="text"
                      value={formData.assignedVehicleNo}
                      onChange={(e) => setFormData({ ...formData, assignedVehicleNo: e.target.value.toUpperCase() })}
                      placeholder="Enter Registration Number (e.g. KLA-992 / TLX-334)..."
                      className="flex-1 bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono font-bold uppercase tracking-wider text-xs"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleValidateVehicle()}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow transition-all active:scale-95"
                        title="Validate vehicle in registered fleet"
                      >
                        <CheckCircle2 size={14} />
                        <span>Validate</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowVehicleSearchModal(true)}
                        className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center gap-1.5 shadow transition-all active:scale-95"
                        title="Search vehicle from registered list"
                      >
                        <Search size={14} />
                        <span>Search Vehicle in List</span>
                      </button>
                    </div>
                  </div>

                  {/* Suggest existing vehicles */}
                  {allVehicles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] text-gray-500">Quick Select:</span>
                      {allVehicles.slice(0, 5).map((v, vIdx) => (
                        <button
                          key={`quick_veh_${v.id || vIdx}_${vIdx}`}
                          type="button"
                          onClick={() => {
                            setFormData(prev => ({ 
                              ...prev, 
                              assignedVehicleNo: v.registrationNumber,
                              driverName: prev.driverName || v.driverName || '',
                              driverCnic: prev.driverCnic || v.driverCnic || '',
                              vehicleVerifiedInDb: true
                            }));
                          }}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 font-mono border border-white/5"
                        >
                          {v.registrationNumber}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* If matched in DB, show verified particulars */}
                {matchedVehicle ? (
                  <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                    <div>
                      <span className="text-gray-400 block text-[10px]">Registered Company:</span>
                      <span className="text-cyan-300 font-bold">
                        {matchedVehicle.companyName || (matchedVehicle.operatingCompany === 'truckit' ? 'TRUCKIT PVT LTD' : 'DOCKS PVT LTD')}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[10px]">Transporter / Broker:</span>
                      <span className="text-white font-semibold">{matchedVehicle.transporterName || matchedVehicle.brokerName || 'Self'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[10px]">Maker / Model:</span>
                      <span className="text-white font-semibold">{[matchedVehicle.make, matchedVehicle.model].filter(Boolean).join(' ') || matchedVehicle.makeModel || 'Carrier'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[10px]">6M Customs Status:</span>
                      <span className={matchedVehicle.status === 'EXPIRED' ? 'text-rose-400 font-bold' : 'text-emerald-300 font-bold'}>
                        {matchedVehicle.status || 'AVAILABLE'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[10px]">6M Validity Expiry:</span>
                      <span className="text-amber-300 font-mono">{matchedVehicle.validationExpiryDate || 'N/A'}</span>
                    </div>
                  </div>
                ) : formData.assignedVehicleNo ? (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <AlertTriangle size={15} className="shrink-0" />
                    <span>
                      Vehicle <strong>{formData.assignedVehicleNo}</strong> is not in the registered Fleet List. Only vehicles registered in the Fleet List can be assigned.
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Mandatory Pre-Uploaded Vehicle Documents: Registration Book & Owner ID Card (Managed by Documentation Manager) */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="font-bold text-white text-sm">
                        Vehicle Registration Book &amp; Vehicle Owner ID Card
                      </label>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                        Documentation Manager
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 block mt-0.5">
                      Vehicle Registration Book and Vehicle Owner ID Card are managed by the Documentation Manager. Once uploaded on the vehicle record, they are automatically attached here.
                    </span>
                  </div>
                  {(formData.registrationBookUrl || matchedVehicle?.registrationBook) && (formData.ownerCnicUrl || matchedVehicle?.ownerIdCardUrl) ? (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                      ✓ Vehicle Docs Complete
                    </span>
                  ) : (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                      Upload Required
                    </span>
                  )}
                </div>

                {!isReadOnly ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <WorkflowMultiUploader
                      label="1. Vehicle Registration Book *"
                      sublabel={matchedVehicle?.registrationBook ? '✓ Pre-uploaded in Fleet Database (Can view or replace)' : 'Upload or scan Vehicle Registration Book'}
                      urlField="registrationBookUrl"
                      nameField="registrationBookName"
                      required={true}
                      allowCamera={true}
                      compact={true}
                      formData={formData}
                      setFormData={setFormData}
                      onPreview={setActivePdfPreview}
                    />

                    <WorkflowMultiUploader
                      label="2. Vehicle Owner ID Card / CNIC *"
                      sublabel={matchedVehicle?.ownerIdCardUrl ? '✓ Pre-uploaded in Fleet Database (Can view or replace)' : 'Upload or scan Vehicle Owner ID Card'}
                      urlField="ownerCnicUrl"
                      nameField="ownerCnicName"
                      required={true}
                      allowCamera={true}
                      compact={true}
                      formData={formData}
                      setFormData={setFormData}
                      onPreview={setActivePdfPreview}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className={`p-3 rounded-xl border flex items-center justify-between ${
                      (formData.registrationBookUrl || matchedVehicle?.registrationBook)
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}>
                      <div>
                        <span className="font-bold block">1. Vehicle Registration Book</span>
                        <span className="text-[10px] opacity-80">
                          {(formData.registrationBookUrl || matchedVehicle?.registrationBook)
                            ? '✓ Uploaded by Documentation Manager'
                            : '✕ Pending upload by Documentation Manager'}
                        </span>
                      </div>
                      {(formData.registrationBookUrl || matchedVehicle?.registrationBook) && (
                        <button
                          type="button"
                          onClick={() => setActivePdfPreview({
                            url: formData.registrationBookUrl || matchedVehicle?.registrationBook || '',
                            title: formData.registrationBookName || matchedVehicle?.registrationBookName || 'Vehicle Registration Book'
                          })}
                          className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold"
                        >
                          View
                        </button>
                      )}
                    </div>
                    <div className={`p-3 rounded-xl border flex items-center justify-between ${
                      (formData.ownerCnicUrl || matchedVehicle?.ownerIdCardUrl)
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}>
                      <div>
                        <span className="font-bold block">2. Vehicle Owner ID Card (CNIC)</span>
                        <span className="text-[10px] opacity-80">
                          {(formData.ownerCnicUrl || matchedVehicle?.ownerIdCardUrl)
                            ? '✓ Uploaded by Documentation Manager'
                            : '✕ Pending upload by Documentation Manager'}
                        </span>
                      </div>
                      {(formData.ownerCnicUrl || matchedVehicle?.ownerIdCardUrl) && (
                        <button
                          type="button"
                          onClick={() => setActivePdfPreview({
                            url: formData.ownerCnicUrl || matchedVehicle?.ownerIdCardUrl || '',
                            title: formData.ownerCnicName || matchedVehicle?.ownerIdCardName || 'Vehicle Owner ID Card'
                          })}
                          className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold"
                        >
                          View
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Driver Information, Mobile Number & Compulsory Dual-Sided CNIC (Entered in Step 4 by Documentation Manager) */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="font-bold text-white text-sm">Driver Details &amp; ID Card (Front &amp; Back)</label>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                        Documentation Manager
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 block mt-0.5">
                      Enter Driver Full Name, Mobile Number, ID Card Number, and upload ID Card Front &amp; Back during Vehicle Assignment. Typing CNIC auto-loads existing driver records from backup.
                    </span>
                  </div>
                </div>

                {driverBackupNotice && (
                  <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
                    <span>{driverBackupNotice}</span>
                  </div>
                )}
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-gray-300 text-xs font-semibold block mb-1">
                      Driver CNIC Number * <span className="text-emerald-400 font-normal">(Auto-fill)</span>
                    </label>
                    <input 
                      type="text"
                      disabled={isReadOnly}
                      value={formData.driverCnic || ''}
                      onChange={(e) => handleDriverCnicChange(e.target.value)}
                      placeholder="e.g. 42101-1234567-1"
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-gray-300 text-xs font-semibold block mb-1">Driver Full Name *</label>
                    <input 
                      type="text"
                      disabled={isReadOnly}
                      value={formData.driverName || ''}
                      onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                      placeholder="e.g. Muhammad Ramzan"
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-gray-300 text-xs font-semibold block mb-1">Driver Mobile Number *</label>
                    <input 
                      type="tel"
                      disabled={isReadOnly}
                      value={formData.driverContact || ''}
                      onChange={(e) => setFormData({ ...formData, driverContact: e.target.value })}
                      placeholder="e.g. 0300-1234567"
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-xs tabular-nums"
                    />
                  </div>
                </div>

                {/* Dual-Sided CNIC Compulsory Uploads */}
                <div className="space-y-3 pt-1">
                  <span className="text-gray-300 font-semibold block text-xs">
                    Driver ID Card Front &amp; Back (Mandatory in Step 4 Vehicle Assignment)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <WorkflowMultiUploader
                      label="Driver CNIC Front Side *"
                      sublabel="Upload or scan CNIC front (Image / Document Scan)"
                      urlField="driverCnicFrontUrl"
                      nameField="driverCnicFrontName"
                      required={true}
                      isPhotoOnly={true}
                      accept="image/*"
                      allowCamera={true}
                      compact={true}
                      formData={formData}
                      setFormData={setFormData}
                      onPreview={setActivePdfPreview}
                    />

                    <WorkflowMultiUploader
                      label="Driver CNIC Back Side *"
                      sublabel="Upload or scan CNIC back (Image / Document Scan)"
                      urlField="driverCnicBackUrl"
                      nameField="driverCnicBackName"
                      required={true}
                      isPhotoOnly={true}
                      accept="image/*"
                      allowCamera={true}
                      compact={true}
                      formData={formData}
                      setFormData={setFormData}
                      onPreview={setActivePdfPreview}
                    />
                  </div>
                </div>

                {/* Optional Driving License Document */}
                <div className="pt-1">
                  <WorkflowMultiUploader
                    label="Driving License Document (Optional)"
                    sublabel="Attach heavy vehicle license or capture with camera"
                    urlField="driverLicenseUrl"
                    nameField="driverLicenseName"
                    allowCamera={true}
                    formData={formData}
                    setFormData={setFormData}
                    onPreview={setActivePdfPreview}
                  />
                </div>
              </div>

              {/* Vehicle Rent & Arrangement */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">Vehicle Rent / Freight</span>
                  <div className="flex rounded-xl bg-slate-800 p-1 border border-white/10">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, vehicleRentArrangedBy: 'Client' })}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        formData.vehicleRentArrangedBy === 'Client' ? 'bg-brand-600 text-white shadow' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Arranged by Client
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, vehicleRentArrangedBy: 'DPL' })}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        formData.vehicleRentArrangedBy === 'DPL' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Arranged by DPL
                    </button>
                  </div>
                </div>

                {formData.vehicleRentArrangedBy === 'DPL' ? (
                  <div className="pt-1 animate-fade-in">
                    <label className="text-gray-400 block mb-1 text-xs">Rent Amount (PKR)</label>
                    <input 
                      type="number"
                      value={formData.vehicleRentAmount || ''}
                      onChange={(e) => setFormData({ ...formData, vehicleRentAmount: Number(e.target.value) })}
                      placeholder="e.g. 125000"
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-xs"
                    />
                    <span className="text-[10px] text-gray-500 mt-1 block">
                      Freight rent amount will be billed to client invoice.
                    </span>
                  </div>
                ) : (
                  <div className="pt-1 text-xs text-sky-400/80 flex items-center justify-between bg-black/20 p-2.5 rounded-xl border border-white/5">
                    <div className="flex items-center gap-1.5">
                      <User size={13} className="text-sky-400" />
                      <span className="text-sky-300 font-medium">Vehicle freight arranged & settled directly by client</span>
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium bg-white/5 px-2 py-0.5 rounded">
                      ⊘ Excluded from Invoice
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 5: LOADING PORT PROCESSING — SINGLE-PAGE COMPACT VIEW (STEP INDEX 4) */}
          {(stepIndex === 4 || stepStatus === CaseStatus.LOADING_PORT_PROCESSING) && (() => {
            const displayVehicleNo =
              formData.assignedVehicleNo ||
              targetCase.vehicleAssignment?.vehicleNo ||
              targetCase.containers?.[0]?.vehicleNo ||
              targetCase.vehicleNumber ||
              '—';
            const displayContainerNo =
              (targetCase.containers && targetCase.containers.length > 0
                ? targetCase.containers.map(c => c.number).filter(Boolean).join(', ')
                : '') ||
              targetCase.containerNumber ||
              targetCase.extractedData?.containerNo ||
              '—';
            const displayImporterName =
              (targetCase as any).importerName ||
              targetCase.consignee ||
              targetCase.extractedData?.consigneeName ||
              targetCase.clientName ||
              '—';
            const displayClientName = targetCase.clientName || '—';
            const recordedLoadingBillAmount = Number(
              (targetCase.loadingBills && targetCase.loadingBills.length > 0
                ? targetCase.loadingBills[targetCase.loadingBills.length - 1].totalAmount
                : formData.loadingChargesAmount) || 0
            );

            return (
              <div className="space-y-3">
                {/* 1. Top Strip: Vehicle Number, Container Number, Importer Name & Client Name */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-950/80 border border-white/10">
                  <div className="min-w-0">
                    <span className="text-[11px] text-gray-400 block">Vehicle Number</span>
                    <span className="text-sm font-mono font-bold text-white truncate block tabular-nums">
                      {displayVehicleNo}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] text-gray-400 block">Container Number</span>
                    <span className="text-sm font-mono font-bold text-cyan-300 truncate block tabular-nums">
                      {displayContainerNo}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] text-gray-400 block">Importer Name</span>
                    <span className="text-xs font-semibold text-white truncate block" title={displayImporterName}>
                      {displayImporterName}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] text-gray-400 block">Client Name</span>
                    <span className="text-xs font-semibold text-emerald-300 truncate block" title={displayClientName}>
                      {displayClientName}
                    </span>
                  </div>
                </div>

                {/* 2. Document Uploads: Port Weight Slip, Seal Slip & Port Gate Pass */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-white/10">
                  <WorkflowMultiUploader
                    label="Port Weight Slip"
                    urlField="weightSlipUrl"
                    nameField="weightSlipName"
                    allowCamera={true}
                    compact={true}
                    isReadOnly={isReadOnly}
                    formData={formData}
                    setFormData={setFormData}
                    onPreview={setActivePdfPreview}
                  />
                  <WorkflowMultiUploader
                    label="Seal Slip"
                    urlField="sealSlipUrl"
                    nameField="sealSlipName"
                    allowCamera={true}
                    compact={true}
                    isReadOnly={isReadOnly}
                    formData={formData}
                    setFormData={setFormData}
                    onPreview={setActivePdfPreview}
                  />
                  <WorkflowMultiUploader
                    label="Port Gate Pass *"
                    urlField="portGatePassUrl"
                    nameField="portGatePassName"
                    required={true}
                    allowCamera={true}
                    compact={true}
                    isReadOnly={isReadOnly}
                    formData={formData}
                    setFormData={setFormData}
                    onPreview={setActivePdfPreview}
                  />
                </div>

                {/* 4. Seal Number + Create Loading Bill */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-white/10 items-end">
                  <div>
                    <label className="text-gray-300 text-[11px] font-semibold block mb-1">Seal Number *</label>
                    <input
                      type="text"
                      disabled={isReadOnly}
                      value={formData.customsSealNumber || ''}
                      onChange={(e) => setFormData({ ...formData, customsSealNumber: e.target.value })}
                      placeholder="Enter Seal Number"
                      className="w-full bg-slate-800 border border-white/15 rounded-lg px-3 py-2 text-white font-mono font-bold uppercase text-xs focus:border-brand-400 focus:outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => {
                      setBillModalType('LOADING');
                      setShowLoadingBillModal(true);
                    }}
                    className="w-full px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <Receipt size={15} />
                    <span>
                      {recordedLoadingBillAmount > 0
                        ? `Create / Update Loading Bill (PKR ${recordedLoadingBillAmount.toLocaleString()})`
                        : 'Create Loading Bill'}
                    </span>
                  </button>
                </div>

                {/* 5. Bottom: Vehicle Gate Out Tick + Finish Button */}
                {!isReadOnly && (
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={Boolean(formData.gateOutToggled)}
                        onChange={(e) => {
                          setValidationError(null);
                          setFormData({ ...formData, gateOutToggled: e.target.checked });
                        }}
                        className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                      />
                      <span className="text-sm font-bold text-white">Vehicle Gate Out</span>
                    </label>

                    <button
                      type="button"
                      disabled={!formData.gateOutToggled}
                      onClick={() => {
                        const check = validateStepStrict();
                        if (!check.valid) {
                          setValidationError(check.error || 'Please complete all required fields before finishing.');
                          return;
                        }
                        setValidationError(null);
                        handleSave(true, true);
                      }}
                      className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <CheckCircle2 size={15} />
                      <span>Finish</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* STEP 6: IN TRANSIT & DESTINATION VEHICLE RECEPTION TRIGGER (STEP INDEX 5) */}
          {(stepIndex === 5 || stepStatus === CaseStatus.IN_TRANSIT) && (
            <div className="space-y-5">
              {/* Motion Feature: Animated Transport Carrier */}
              <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-blue-500/30 relative overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping"></div>
                    <span className="font-mono font-bold text-blue-400 uppercase tracking-wider text-xs">
                      Live Transit Telemetry Active
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 font-mono">Route: {targetCase.pol} ➔ {targetCase.pod}</span>
                </div>

                {/* Road & Truck Animation Container */}
                <div className="relative h-20 bg-slate-950/80 rounded-xl border border-white/10 overflow-hidden flex items-center px-4">
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 border-b border-dashed border-white/20"></div>
                  <div className="flex items-center gap-2 animate-[pulse_3s_ease-in-out_infinite] transform transition-transform">
                    <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-500 flex items-center justify-center text-blue-300 shadow-lg shadow-blue-500/20">
                      <Truck size={22} className="animate-bounce" />
                    </div>
                    <div className="bg-slate-900/90 border border-white/10 px-2.5 py-1 rounded-lg">
                      <p className="text-[11px] font-bold text-white font-mono">{formData.assignedVehicleNo || targetCase.containers?.[0]?.vehicleNo || 'CARRIER-FLEET'}</p>
                      <p className="text-[9px] text-emerald-400">GPS Signal Verified • Normal Speed</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Destination Staff Vehicle Reception Card: Receiving Vehicle Completes Transit & Starts Unloading */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/50 via-slate-900 to-teal-950/40 border border-emerald-500/30 space-y-3.5 shadow-lg">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 flex items-center justify-center shrink-0">
                      <Truck size={20} />
                    </div>
                    <div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Destination Staff Action
                      </span>
                      <h4 className="font-bold text-white text-sm mt-1">
                        Receive Vehicle at Destination Dry Port
                      </h4>
                      <p className="text-gray-300 text-[11px]">
                        Confirming vehicle reception at destination immediately completes Transit and starts the Destination Unloading workflow.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => handleDestinationArrivalPhotoUploaded()}
                    className="px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all active:scale-95 shrink-0 cursor-pointer"
                  >
                    <CheckCircle2 size={16} />
                    <span>Confirm Vehicle Received at Destination</span>
                  </button>
                </div>
              </div>

              {/* Emergency Exception Red Button */}
              <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center shrink-0">
                    <AlertTriangle size={22} />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Emergency Exception & Incident Vault</h4>
                    <p className="text-gray-300 text-[11px] mt-0.5 leading-relaxed">
                      If the carrier vehicle faces an accident, highway police stoppage, customs border seizure, or mechanical breakdown, report immediately to halt normal workflow and relocate this case to the Incident Vault.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowIncidentModal(true)}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl shadow-rose-600/30 transition-all active:scale-98"
                >
                  <AlertCircle size={18} />
                  <span>Report Incident / Accident / Stoppage</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 7: DESTINATION PORT ARRIVAL — SINGLE-PAGE COMPACT VIEW (STEP INDEX 6 / 7) */}
          {(stepIndex === 6 || stepIndex === 7 || stepStatus === CaseStatus.DESTINATION_PORT_ARRIVAL) && (() => {
            const displayVehicleNo =
              formData.assignedVehicleNo ||
              targetCase.vehicleAssignment?.vehicleNo ||
              targetCase.containers?.[0]?.vehicleNo ||
              targetCase.vehicleNumber ||
              '—';
            const displayContainerNo =
              (targetCase.containers && targetCase.containers.length > 0
                ? targetCase.containers.map(c => c.number).filter(Boolean).join(', ')
                : '') ||
              targetCase.containerNumber ||
              targetCase.extractedData?.containerNo ||
              '—';
            const displayImporterName =
              (targetCase as any).importerName ||
              targetCase.consignee ||
              targetCase.extractedData?.consigneeName ||
              targetCase.clientName ||
              '—';
            const displayClientName = targetCase.clientName || '—';
            const recordedDestBillAmount = Number(
              (targetCase.destinationBills && targetCase.destinationBills.length > 0
                ? targetCase.destinationBills[targetCase.destinationBills.length - 1].totalAmount
                : formData.destinationChargesAmount) || 0
            );

            return (
              <div className="space-y-3">
                {/* Top Strip: Vehicle Number, Container Number, Importer Name & Client Name */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-950/80 border border-white/10">
                  <div className="min-w-0">
                    <span className="text-[11px] text-gray-400 block">Vehicle Number</span>
                    <span className="text-sm font-mono font-bold text-white truncate block tabular-nums">
                      {displayVehicleNo}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] text-gray-400 block">Container Number</span>
                    <span className="text-sm font-mono font-bold text-cyan-300 truncate block tabular-nums">
                      {displayContainerNo}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] text-gray-400 block">Importer Name</span>
                    <span className="text-xs font-semibold text-white truncate block" title={displayImporterName}>
                      {displayImporterName}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] text-gray-400 block">Client Name</span>
                    <span className="text-xs font-semibold text-emerald-300 truncate block" title={displayClientName}>
                      {displayClientName}
                    </span>
                  </div>
                </div>

                {/* 1. Three Status Actions: Mark Vehicle Received, Mark Container Unloaded from Vehicle, Mark Vehicle Gate Out */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => {
                      setValidationError(null);
                      const nextState = !formData.destinationGateInToggled;
                      setFormData({ ...formData, destinationGateInToggled: nextState });
                      if (nextState) {
                        handleDestinationArrivalPhotoUploaded();
                      }
                    }}
                    className={`px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-2 ${
                      formData.destinationGateInToggled
                        ? 'bg-emerald-600/25 border-emerald-400 text-emerald-200'
                        : 'bg-slate-950/70 border-white/15 text-gray-200 hover:border-emerald-500/40'
                    }`}
                  >
                    <Check size={14} className={formData.destinationGateInToggled ? 'text-emerald-300' : 'text-gray-500'} />
                    <span>Mark Vehicle Received</span>
                  </button>

                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => {
                      setValidationError(null);
                      setFormData({ ...formData, containerUnloadedToggled: !formData.containerUnloadedToggled });
                    }}
                    className={`px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-2 ${
                      formData.containerUnloadedToggled
                        ? 'bg-emerald-600/25 border-emerald-400 text-emerald-200'
                        : 'bg-slate-950/70 border-white/15 text-gray-200 hover:border-emerald-500/40'
                    }`}
                  >
                    <Check size={14} className={formData.containerUnloadedToggled ? 'text-emerald-300' : 'text-gray-500'} />
                    <span>Mark Container Unloaded from Vehicle</span>
                  </button>

                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => {
                      setValidationError(null);
                      setFormData({ ...formData, vehicleGateOutToggled: !formData.vehicleGateOutToggled });
                    }}
                    className={`px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-2 ${
                      formData.vehicleGateOutToggled
                        ? 'bg-emerald-600/25 border-emerald-400 text-emerald-200'
                        : 'bg-slate-950/70 border-white/15 text-gray-200 hover:border-emerald-500/40'
                    }`}
                  >
                    <Check size={14} className={formData.vehicleGateOutToggled ? 'text-emerald-300' : 'text-gray-500'} />
                    <span>Mark Vehicle Gate Out</span>
                  </button>
                </div>

                {/* 2. Document Uploads: Port Weight Slip, Transport Note, Dry Port Gate Pass & Delivery Order */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-white/10">
                  <WorkflowMultiUploader
                    label="Port Weight Slip"
                    urlField="destinationWeightSlipUrl"
                    nameField="destinationWeightSlipName"
                    allowCamera={true}
                    compact={true}
                    isReadOnly={isReadOnly}
                    formData={formData}
                    setFormData={setFormData}
                    onPreview={setActivePdfPreview}
                  />

                  <WorkflowMultiUploader
                    label="Transport Note"
                    urlField="finalSignedTransportNoteUrl"
                    nameField="finalSignedTransportNoteName"
                    allowCamera={true}
                    compact={true}
                    isReadOnly={isReadOnly}
                    formData={formData}
                    setFormData={setFormData}
                    onPreview={setActivePdfPreview}
                  />

                  <WorkflowMultiUploader
                    label="Dry Port Gate Pass"
                    urlField="dryPortGatePassUrl"
                    nameField="dryPortGatePassName"
                    allowCamera={true}
                    compact={true}
                    isReadOnly={isReadOnly}
                    formData={formData}
                    setFormData={setFormData}
                    onPreview={setActivePdfPreview}
                  />

                  <WorkflowMultiUploader
                    label="Delivery Order"
                    urlField="destinationDoDocUrl"
                    nameField="destinationDoDocName"
                    allowCamera={true}
                    compact={true}
                    isReadOnly={isReadOnly}
                    formData={formData}
                    setFormData={setFormData}
                    onPreview={setActivePdfPreview}
                  />
                </div>

                {/* 3. Create Dry Port Bill + Finish */}
                {!isReadOnly && (
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-white/10 flex flex-wrap items-center justify-between gap-2.5">
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => {
                        setBillModalType('DESTINATION');
                        setShowLoadingBillModal(true);
                      }}
                      className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 transition-colors whitespace-nowrap"
                    >
                      <Receipt size={15} />
                      <span>
                        {recordedDestBillAmount > 0
                          ? `Create / Update Dry Port Bill (PKR ${recordedDestBillAmount.toLocaleString()})`
                          : 'Create Dry Port Bill'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={!formData.destinationGateInToggled || !formData.containerUnloadedToggled || !formData.vehicleGateOutToggled}
                      onClick={() => {
                        const check = validateStepStrict();
                        if (!check.valid) {
                          setValidationError(check.error || 'Please mark Vehicle Received, Container Unloaded, and Vehicle Gate Out.');
                          return;
                        }
                        setValidationError(null);
                        handleSave(true);
                      }}
                      className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <CheckCircle2 size={15} />
                      <span>Finish</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
            </div>
          )}

          {/* Live Transit Route Locations History (Shown strictly on Transit step so Loading & Destination stay single-screen) */}
          {(stepIndex === 5 || stepStatus === CaseStatus.IN_TRANSIT) && (
            <CaseTransitHistoryCard targetCase={targetCase} compact={true} />
          )}

        </div>

        {/* Validation Error Alert Banner */}
        {validationError && (
          <div className="mx-5 mb-2 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 flex items-start gap-2.5 animate-shake text-xs shrink-0">
            <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold block text-rose-300">Cannot Complete Step:</span>
              <span>{validationError}</span>
            </div>
            <button
              type="button"
              onClick={() => setValidationError(null)}
              className="text-gray-400 hover:text-white text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Footer */}
        {(() => {
          const isSinglePagePortModal =
            normCategory === 'Bonded Carrier' &&
            (stepIndex === 4 ||
              stepIndex === 6 ||
              stepIndex === 7 ||
              stepStatus === CaseStatus.LOADING_PORT_PROCESSING ||
              stepStatus === CaseStatus.DESTINATION_PORT_ARRIVAL);
          return (
            <div className="px-4 py-3 border-t border-white/10 bg-slate-950/70 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              <div>
                {!isSinglePagePortModal &&
                  (userRole === UserRole.UNLOADING_PORT_STAFF ||
                    userRole === UserRole.DESTINATION_PORT_STAFF ||
                    userRole === UserRole.ADMIN ||
                    userRole === UserRole.OPERATIONS_MANAGER) &&
                  (isDestinationUnloadedAndGateOut(targetCase) ? (
                    <button
                      type="button"
                      onClick={() => downloadCustomsDeliveryOrderPdf({ targetCase })}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 active:scale-95"
                      title="Download Official Customs Delivery Order (DO) PDF"
                    >
                      <Download size={15} />
                      <span>Download Bonded Carrier DO (PDF)</span>
                    </button>
                  ) : null)}
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  Close
                </button>

                {!isReadOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setValidationError(null);
                        handleSave(false);
                      }}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 hover:border-amber-500/50 shadow transition-all flex items-center gap-1.5 active:scale-95"
                      title="Save draft data without marking step completed"
                    >
                      <Save size={14} className="text-amber-400" />
                      <span>{isSinglePagePortModal ? 'Save' : 'Incomplete Save'}</span>
                    </button>

                    {!isSinglePagePortModal && (
                      <button
                        type="button"
                        onClick={() => {
                          const check = validateStepStrict();
                          if (!check.valid) {
                            setValidationError(check.error || 'Please fill all required fields and upload all required documents.');
                            return;
                          }
                          setValidationError(null);
                          handleSave(true);
                        }}
                        className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-1.5 active:scale-95"
                        title="Validate all fields & documents and mark step completed"
                      >
                        <CheckCircle2 size={15} />
                        <span>Completed</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Vehicle Validation Popup Modal */}
      {showVehicleValidateModal && vehicleValidationResult && (
        <div className="fixed inset-0 bg-black/80 z-[140] flex items-start justify-center pt-8 sm:pt-14 p-4 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-white/20 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Truck size={18} className="text-brand-400" />
                <h3 className="font-bold text-white text-sm">Vehicle Database Validation</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowVehicleValidateModal(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className={`p-4 rounded-xl border ${
              vehicleValidationResult.valid 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            } space-y-2`}>
              <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wide">
                {vehicleValidationResult.valid ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                <span>{vehicleValidationResult.valid ? 'Vehicle Valid & Active' : 'Validation Alert'}</span>
              </div>
              <p className="text-xs text-gray-200 leading-relaxed">
                {vehicleValidationResult.reason}
              </p>
            </div>

            {vehicleValidationResult.vehicle && (
              <div className="p-3.5 bg-black/40 border border-white/10 rounded-xl space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Registration Number:</span>
                  <span className="text-white font-mono font-bold">{vehicleValidationResult.vehicle.registrationNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Transporter:</span>
                  <span className="text-white font-semibold">{vehicleValidationResult.vehicle.transporterName || 'Self / Registered'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Make / Model:</span>
                  <span className="text-white">{vehicleValidationResult.vehicle.makeModel || 'Carrier'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Status:</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    vehicleValidationResult.valid ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                  }`}>
                    {vehicleValidationResult.vehicle.status || 'Active'}
                  </span>
                </div>
                {vehicleValidationResult.vehicle.validationExpiryDate && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Fitness / Tax Expiry:</span>
                    <span className="text-amber-300 font-mono">{vehicleValidationResult.vehicle.validationExpiryDate}</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowVehicleValidateModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Close
              </button>
              {vehicleValidationResult.valid && vehicleValidationResult.vehicle ? (
                <button
                  type="button"
                  onClick={() => handleApplyValidatedVehicle(vehicleValidationResult.vehicle!)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center gap-1.5"
                >
                  <Check size={14} />
                  <span>Confirm & Apply Vehicle</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowVehicleValidateModal(false);
                    setShowVehicleSearchModal(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center gap-1.5"
                >
                  <Search size={14} />
                  <span>Search Vehicle in List</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Vehicle Search from List Popup Modal */}
      {showVehicleSearchModal && (
        <div className="fixed inset-0 bg-black/85 z-[140] flex items-start justify-center pt-8 sm:pt-14 p-4 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-white/20 rounded-2xl max-w-xl w-full p-5 shadow-2xl space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Search size={18} className="text-brand-400" />
                <div>
                  <h3 className="font-bold text-white text-sm">Search Vehicle from Registered Fleet</h3>
                  <span className="text-[11px] text-gray-400">Search by Vehicle Registration Number or Transporter Name</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowVehicleSearchModal(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                value={vehicleSearchQuery}
                onChange={(e) => setVehicleSearchQuery(e.target.value)}
                placeholder="Type Registration No. (e.g. KLA-992) or Transporter Name..."
                className="w-full bg-black/50 border border-white/15 rounded-xl pl-10 pr-4 py-2.5 text-white text-xs placeholder-gray-500 focus:border-brand-500 outline-none"
                autoFocus
              />
            </div>

            <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-2">
              {filteredVehiclesList.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-xs bg-black/20 rounded-xl">
                  No matching registered vehicles found.
                </div>
              ) : (
                filteredVehiclesList.map((veh, vehIdx) => {
                  const stat = (veh.status || 'Active').toLowerCase();
                  const isInvalid = stat === 'expired' || stat === 'cancelled' || stat === 'suspended' || stat === 'inactive';
                  return (
                    <div
                      key={`wf_veh_${veh.id || vehIdx}_${vehIdx}`}
                      className="p-3 bg-black/30 border border-white/10 rounded-xl flex items-center justify-between gap-3 hover:border-white/20 transition-all"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white text-xs">{veh.registrationNumber}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isInvalid ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            {veh.status || 'Active'}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1 flex flex-wrap gap-x-3">
                          <span>Transporter: <strong className="text-gray-200">{veh.transporterName || 'Self / Registered'}</strong></span>
                          {veh.makeModel && <span>Model: {veh.makeModel}</span>}
                          {veh.category && <span>Category: {veh.category}</span>}
                        </div>
                      </div>

                      <div>
                        {isInvalid ? (
                          <span className="text-[11px] text-rose-400/80 italic">Cannot select</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSelectVehicleFromList(veh)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition-all active:scale-95"
                          >
                            Select
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowVehicleSearchModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading & Destination Bill Modal */}
      {showLoadingBillModal && (
        <LoadingBillModal
          isOpen={showLoadingBillModal}
          onClose={() => setShowLoadingBillModal(false)}
          targetCase={targetCase}
          isDestinationBill={billModalType === 'DESTINATION'}
          onSaveBill={(billData, newCharges, newDocs, ...rest: any[]) => {
            const generatedBill = rest[0];
            if (billModalType === 'DESTINATION') {
              setFormData(prev => ({
                ...prev,
                destinationChargesArrangedBy: billData.arrangedBy || prev.destinationChargesArrangedBy,
                destinationChargesAmount: billData.grandTotal || prev.destinationChargesAmount
              }));
            } else {
              setFormData(prev => ({
                ...prev,
                wharfageAmount: billData.wharfageAmount,
                wharfageReceiptUrl: billData.wharfageReceiptUrl,
                wharfageReceiptName: billData.wharfageReceiptName,
                trackerAmount: billData.trackerAmount,
                loadingChargesArrangedBy: billData.arrangedBy || prev.loadingChargesArrangedBy,
                loadingChargesAmount: billData.grandTotal || billData.deliveryCharges
              }));
            }
            const existingCharges = targetCase.charges || [];
            const updatedCharges = [...existingCharges];
            newCharges.forEach(chg => {
              if (!updatedCharges.some(c => c.description === chg.description)) {
                updatedCharges.push(chg);
              }
            });
            const existingDocs = targetCase.documents || [];
            const updatedDocs = [...existingDocs];
            newDocs.forEach((doc: any) => {
              if (!updatedDocs.some((d: any) => d.url === doc.url)) {
                updatedDocs.push(doc);
              }
            });
            onSaveCase({
              ...targetCase,
              charges: updatedCharges,
              documents: updatedDocs,
              ...(generatedBill
                ? billModalType === 'DESTINATION'
                  ? { destinationBills: [...(targetCase.destinationBills || []), generatedBill] }
                  : { loadingBills: [...(targetCase.loadingBills || []), generatedBill] }
                : {})
            });
            setShowLoadingBillModal(false);
          }}
        />
      )}

      {/* Incident / Stoppage Modal */}
      {showIncidentModal && (
        <div className="fixed inset-0 bg-black/85 z-[130] flex items-start justify-center pt-8 sm:pt-14 p-4 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-rose-500/40 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-fade-in">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertCircle size={28} />
              <div>
                <h3 className="text-lg font-black text-white">Report Transit Incident / Stoppage</h3>
                <p className="text-xs text-gray-400">Case will be moved immediately into the Incident Vault</p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-gray-300 block mb-1">Reason / Incident Description *</label>
                <textarea 
                  value={incidentForm.reason}
                  onChange={(e) => setIncidentForm({ ...incidentForm, reason: e.target.value })}
                  placeholder="e.g. Engine breakdown near Hyderabad, Highway Police seal verification hold, or container seal discrepancy..."
                  rows={3}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl p-3 text-white placeholder-gray-500 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-gray-300 block mb-1">Current Stoppage Location</label>
                  <input 
                    type="text"
                    value={incidentForm.location}
                    onChange={(e) => setIncidentForm({ ...incidentForm, location: e.target.value })}
                    placeholder="e.g. M-9 Motorway Milepost 74"
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="font-semibold text-gray-300 block mb-1">Incident Date</label>
                  <input 
                    type="date"
                    value={incidentForm.date}
                    onChange={(e) => setIncidentForm({ ...incidentForm, date: e.target.value })}
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-gray-300 block mb-1">Emergency On-Ground Contact</label>
                <input 
                  type="text"
                  value={incidentForm.contact}
                  onChange={(e) => setIncidentForm({ ...incidentForm, contact: e.target.value })}
                  placeholder="e.g. Driver Cell: 0300-1234567 / Highway Patrol Unit"
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowIncidentModal(false)}
                className="px-4 py-2.5 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTriggerIncident}
                className="bg-rose-600 hover:bg-rose-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg shadow-rose-600/30 flex items-center gap-1.5"
              >
                <AlertCircle size={15} />
                <span>Move Case to Incident Vault</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF / Document Viewer Modal */}
      {activePdfPreview && (
        <PdfViewerModal
          isOpen={!!activePdfPreview}
          pdfUrl={activePdfPreview.url}
          title={activePdfPreview.title}
          filename={activePdfPreview.title || 'document.pdf'}
          onClose={() => setActivePdfPreview(null)}
        />
      )}
    </div>
  );
};

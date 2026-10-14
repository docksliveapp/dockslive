import {
  Case,
  CaseStatus,
  CaseStepDetail,
  Driver,
  TransitLocationLogEntry,
  UserRole,
  Vehicle,
  AppUser,
  AppNotification
} from '../types';
import {
  saveCaseToFirestore,
  saveDriverToFirestore,
  updateVehicleInFirestore,
  saveUserToFirestore,
  saveNotificationToFirestore
} from './dbService';
import { safeAppStorage } from './storage';
import { getCategoryWorkflow } from './workflowConfig';

/**
 * Formats a raw reverse-geocoded address or GPS coordinate into a simple, easy-to-read
 * Road Name & Nearby Area Name (e.g. "National Highway N-5, Near Moro Bypass").
 */
export function formatSimpleRoadOrAreaLocation(
  rawAddress?: string,
  lat?: number,
  lng?: number
): string {
  if (rawAddress && rawAddress.trim()) {
    // Strip trailing coordinate parentheses if already appended
    const withoutCoords = rawAddress.replace(/\(\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\)/g, '').trim();
    const parts = withoutCoords
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !/^\d{4,6}$/.test(s) && s.toLowerCase() !== 'pakistan');

    if (parts.length >= 2) {
      return `${parts[0]}, ${parts[1]}`;
    }
    if (parts.length === 1 && parts[0]) {
      return parts[0];
    }
  }

  if (typeof lat === 'number' && typeof lng === 'number') {
    return `Highway Route Corridor (${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E)`;
  }

  return 'National Highway N-5 / Main Transit Corridor';
}

/**
 * Formats duration between two timestamps into a clear, readable string
 * (e.g., "3h 45m" or "1d 4h 20m").
 */
export function formatDurationBetween(
  startStr?: string,
  endStr?: string,
  defaultLabel = 'Recorded on Completion'
): string {
  if (!startStr || !endStr) return defaultLabel;

  const startMs = Date.parse(startStr);
  const endMs = Date.parse(endStr);

  if (isNaN(startMs) || isNaN(endMs)) {
    return `${startStr} → ${endStr}`;
  }

  const diffMs = Math.max(60000, Math.abs(endMs - startMs)); // At least 1 min
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(' ');
}

/**
 * Finds all transit workflow step keys for a given case (supports all 14+ categories,
 * Bonded, Afghan Transit, Home Consumption, Into-Bond, Ex-Bond, Private Cargo, Export, etc.)
 */
export function getTransitStepKeysForCase(caseItem: Case): string[] {
  const wfConfig = getCategoryWorkflow(caseItem.category || '');
  const categorySteps = (wfConfig?.steps || []).map(st => String(st.id));
  const transitSteps = categorySteps.filter(s => {
    const lower = s.toLowerCase();
    return (
      lower.includes('transit') ||
      lower.includes('en-route') ||
      lower.includes('dispatch') ||
      lower.includes('checkpost') ||
      lower.includes('haulage') ||
      s === CaseStatus.IN_TRANSIT
    );
  });

  if (!transitSteps.includes(CaseStatus.IN_TRANSIT)) {
    transitSteps.push(CaseStatus.IN_TRANSIT);
  }
  return transitSteps;
}

/**
 * Finds all loading / gate-out workflow step keys for a given case across all categories.
 */
export function isStepLoadingGateOut(stepName: string, stepDetail?: CaseStepDetail): boolean {
  const lower = (stepName || '').toLowerCase();
  return Boolean(
    lower.includes('loading') ||
    lower.includes('gate out') ||
    lower.includes('warehouse loading') ||
    lower.includes('terminal gate') ||
    stepName === CaseStatus.LOADING_PORT_PROCESSING ||
    stepDetail?.loadingCompleted ||
    stepDetail?.gateOutTime ||
    stepDetail?.gatePassDocUrl
  );
}

/**
 * Determines whether a workflow step or case status represents Destination Arrival,
 * Container Unloading from Truck, and Destination Gate Out across ANY category.
 */
export function isStepDestinationUnloadAndGateOut(
  stepName: string,
  stepDetail?: CaseStepDetail,
  newCaseStatus?: string
): boolean {
  const lower = (stepName || '').toLowerCase();
  const statusLower = (newCaseStatus || '').toLowerCase();

  if (
    statusLower === CaseStatus.COMPLETED.toLowerCase() ||
    statusLower.includes('completed')
  ) {
    return true;
  }

  if (
    stepDetail?.unloadingCompleted ||
    stepDetail?.gateOutConfirmed ||
    stepDetail?.destuffingComplete ||
    stepDetail?.borderClearanceStatus === 'Cleared & Crossed' ||
    stepDetail?.emptyReturnCompleted
  ) {
    return true;
  }

  const isDestStep =
    lower.includes('destination') ||
    lower.includes('unload') ||
    lower.includes('destuffing') ||
    lower.includes('delivery & gate-out') ||
    lower.includes('border clearance') ||
    lower.includes('final delivery') ||
    stepName === CaseStatus.DESTINATION_PORT_ARRIVAL;

  return Boolean(isDestStep && stepDetail?.completed);
}

/**
 * Called automatically when a Driver logs in and transmits their live GPS location.
 * 1. Formats location as a clean Road Name / Nearby Area Name.
 * 2. Appends the location to all matching active Cases (in `transitLocationsLog` and
 *    inside the Case's Transit workflow step) so it is visible in the Transit workflow
 *    and permanently saved in the Case history across all categories.
 */
export async function recordDriverTripLocationToActiveCases(params: {
  vehicleNo: string;
  driverName: string;
  driverId?: string;
  transporterName?: string;
  rawLocationText: string;
  lat?: number;
  lng?: number;
}): Promise<string> {
  const simpleRoadOrArea = formatSimpleRoadOrAreaLocation(
    params.rawLocationText,
    params.lat,
    params.lng
  );

  const now = new Date();
  const nowIso = now.toISOString();
  const formattedTime = now.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const cleanVeh = (params.vehicleNo || '').toUpperCase().trim();
  const cleanDrv = (params.driverName || '').toLowerCase().trim();

  const allCases = safeAppStorage.getJSON<Case[]>('dpl_cases_cache', []) || [];

  const logEntry: TransitLocationLogEntry = {
    id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: nowIso,
    formattedTime,
    roadOrAreaName: simpleRoadOrArea,
    vehicleNo: cleanVeh || 'Assigned Vehicle',
    driverName: params.driverName || 'Trip Driver',
    driverId: params.driverId,
    coordinates:
      typeof params.lat === 'number' && typeof params.lng === 'number'
        ? `${params.lat.toFixed(4)}, ${params.lng.toFixed(4)}`
        : undefined
  };

  for (const c of allCases) {
    // Match active cases where this vehicle or driver is assigned
    const isCompletedOrCancelled =
      String(c.status).toLowerCase().includes('completed') ||
      String(c.status).toLowerCase().includes('cancelled');
    if (isCompletedOrCancelled) continue;

    const matchesContainer = (c.containers || []).some(cntr => {
      const cVeh = (cntr.vehicleNo || '').toUpperCase().trim();
      const cDrv = (cntr.driverName || '').toLowerCase().trim();
      return (cleanVeh && cVeh === cleanVeh) || (cleanDrv && cDrv === cleanDrv);
    });

    const matchesWorkflow = Object.values(c.workflowDetails || {}).some(detail => {
      const wVeh = (detail?.assignedVehicleNo || '').toUpperCase().trim();
      const wDrv = (detail?.driverName || '').toLowerCase().trim();
      return (cleanVeh && wVeh === cleanVeh) || (cleanDrv && wDrv === cleanDrv);
    });

    if (!matchesContainer && !matchesWorkflow) continue;

    const existingLogs: TransitLocationLogEntry[] = Array.isArray(c.transitLocationsLog)
      ? [...c.transitLocationsLog]
      : [];
    const updatedLogs = [...existingLogs, logEntry];

    const updatedWorkflow: Record<string, CaseStepDetail> = {
      ...(c.workflowDetails || {})
    };

    const transitStepKeys = getTransitStepKeysForCase(c);
    for (const stepKey of transitStepKeys) {
      const existingStep: CaseStepDetail = updatedWorkflow[stepKey] || {
        stepName: stepKey,
        completed: false
      };
      const existingStepLocs = Array.isArray(existingStep.transitLocationsLog)
        ? existingStep.transitLocationsLog
        : Array.isArray(existingStep.transitLocationsHistory)
        ? existingStep.transitLocationsHistory
        : [];
      const locLine = `[${formattedTime}] ${cleanVeh ? `${cleanVeh} — ` : ''}${simpleRoadOrArea}`;
      const existingNotes = (existingStep.notes || '').trim();
      const mergedStepLocs = [...existingStepLocs, logEntry];

      updatedWorkflow[stepKey] = {
        ...existingStep,
        stepName: stepKey,
        currentTransitLocation: simpleRoadOrArea,
        transitLocationsLog: mergedStepLocs,
        transitLocationsHistory: mergedStepLocs,
        notes: existingNotes ? `${existingNotes}\n${locLine}` : locLine,
        updatedAt: nowIso
      };
    }

    const updatedCase: Case = {
      ...c,
      transitLocationsLog: updatedLogs,
      transitLocationsHistory: updatedLogs,
      workflowDetails: updatedWorkflow,
      updatedAt: nowIso
    };

    await saveCaseToFirestore(updatedCase);
  }

  return simpleRoadOrArea;
}

/**
 * Synchronous helper that enriches a Case with permanent Loading Port Gate-Out duration,
 * Transit Route Locations, Destination Unloading & Gate-Out duration, and Total Transit Duration
 * across ALL case categories (Bonded Carrier, Afghan Transit, Import/Export, TIR, Private Cargo, etc.).
 */
export function enrichCaseWithTripTimings(
  caseItem: Case,
  stepName: string,
  stepDetail: CaseStepDetail,
  nextStatus?: string
): Case {
  const nowIso = new Date().toISOString();
  const existingHistory = Array.isArray(caseItem.transitLocationsHistory)
    ? caseItem.transitLocationsHistory
    : Array.isArray(caseItem.transitLocationsLog)
    ? caseItem.transitLocationsLog
    : [];

  const updatedCase: Case = {
    ...caseItem,
    transitLocationsHistory: existingHistory,
    transitLocationsLog: existingHistory,
    workflowDetails: {
      ...(caseItem.workflowDetails || {}),
      [stepName]: stepDetail
    }
  };

  // 1. Check Loading Port / Loading Destination Gate-Out Timing
  if (
    isStepLoadingGateOut(stepName, stepDetail) ||
    stepDetail.gateOutToggled ||
    stepDetail.gateOutVehicle
  ) {
    const loadingStart =
      updatedCase.loadingPortArrivalTime ||
      updatedCase.registrationDate ||
      updatedCase.createdAt ||
      nowIso;
    const loadingGateOut =
      stepDetail.loadingGateOutAt ||
      stepDetail.gateOutTime ||
      stepDetail.completedAt ||
      nowIso;

    const loadingDuration = formatDurationBetween(
      loadingStart,
      loadingGateOut,
      stepDetail.gateOutTime ? `Gate Out at ${stepDetail.gateOutTime}` : '2h 30m (Port Gate-Out Completed)'
    );

    updatedCase.loadingPortArrivalTime = loadingStart;
    updatedCase.loadingPortGateOutTime = loadingGateOut;
    updatedCase.loadingGateOutAt = loadingGateOut;
    updatedCase.loadingPortDurationFormatted = loadingDuration;
    updatedCase.loadingGateOutDuration = loadingDuration;

    updatedCase.workflowDetails![stepName] = {
      ...updatedCase.workflowDetails![stepName],
      loadingGateOutAt: loadingGateOut,
      loadingGateOutDuration: loadingDuration,
      loadingPortDurationFormatted: loadingDuration
    };
  }

  // 2. Ensure Transit Locations History is synced into Transit workflow step
  const transitKeys = getTransitStepKeysForCase(updatedCase);
  if (transitKeys.includes(stepName) && existingHistory.length > 0) {
    updatedCase.workflowDetails![stepName] = {
      ...updatedCase.workflowDetails![stepName],
      transitLocationsLog: existingHistory,
      transitLocationsHistory: existingHistory,
      currentTransitLocation:
        updatedCase.workflowDetails![stepName]?.currentTransitLocation ||
        existingHistory[existingHistory.length - 1]?.roadOrAreaName
    };
  }

  // 3. Check Destination Unloading & Gate-Out Timing
  if (
    isStepDestinationUnloadAndGateOut(stepName, stepDetail, nextStatus || String(updatedCase.status)) ||
    stepDetail.vehicleGateOutToggled ||
    stepDetail.gateOutVehicle ||
    stepDetail.unloaded
  ) {
    const destArrival =
      stepDetail.destinationArrivalAt ||
      stepDetail.arrivalTime ||
      updatedCase.destinationPortArrivalTime ||
      updatedCase.loadingGateOutAt ||
      updatedCase.loadingPortGateOutTime ||
      updatedCase.createdAt ||
      nowIso;
    const destUnloadGateOut =
      stepDetail.destinationGateOutAt ||
      stepDetail.completedAt ||
      nowIso;

    const destDuration = formatDurationBetween(
      destArrival,
      destUnloadGateOut,
      stepDetail.arrivalTime
        ? `Arrived ${stepDetail.arrivalTime} → Unloaded & Gated Out`
        : '3h 15m (Unloaded & Gated Out)'
    );

    const transitStart =
      updatedCase.loadingGateOutAt ||
      updatedCase.loadingPortGateOutTime ||
      updatedCase.loadingPortArrivalTime ||
      updatedCase.createdAt ||
      destArrival;

    const totalTransitDuration = formatDurationBetween(
      transitStart,
      destUnloadGateOut,
      'Completed Transit'
    );

    updatedCase.destinationPortArrivalTime = destArrival;
    updatedCase.destinationUnloadAndGateOutTime = destUnloadGateOut;
    updatedCase.destinationGateOutAt = destUnloadGateOut;
    updatedCase.destinationUnloadedAt = destUnloadGateOut;
    updatedCase.destinationPortDurationFormatted = destDuration;
    updatedCase.destinationGateOutDuration = destDuration;
    updatedCase.destinationUnloadingDuration = destDuration;
    updatedCase.totalTransitDurationFormatted = totalTransitDuration;
    updatedCase.totalTransitDuration = totalTransitDuration;

    updatedCase.workflowDetails![stepName] = {
      ...updatedCase.workflowDetails![stepName],
      destinationArrivalAt: destArrival,
      destinationGateOutAt: destUnloadGateOut,
      destinationUnloadedAt: destUnloadGateOut,
      destinationGateOutDuration: destDuration,
      destinationUnloadingDuration: destDuration,
      destinationPortDurationFormatted: destDuration,
      totalTransitDurationFormatted: totalTransitDuration
    };
  }

  return updatedCase;
}

/**
 * Async wrapper that enriches Case timings and automatically expires Driver Trip credentials if destination gate-out is reached.
 */
export async function processCaseTimingsAndDriverLifecycle(
  caseItem: Case,
  stepName: string,
  stepDetail: CaseStepDetail,
  nextStatus?: string
): Promise<Case> {
  const updatedCase = enrichCaseWithTripTimings(caseItem, stepName, stepDetail, nextStatus);
  if (
    isStepDestinationUnloadAndGateOut(stepName, stepDetail, nextStatus || String(updatedCase.status)) ||
    stepDetail.vehicleGateOutToggled ||
    stepDetail.gateOutVehicle
  ) {
    updatedCase.driverTripIdAutoExpired = true;
    updatedCase.driverTripIdExpiredOnGateOut = true;
    updatedCase.driverTripIdExpiredAt = new Date().toISOString();
    await expireDriverTripCredentialsForCase(updatedCase);
  }
  return updatedCase;
}

/**
 * Alias for expireDriverTripCredentialsForCase for destination gate-out hooks.
 */
export async function expireDriverTripCredentialsOnGateOut(
  caseItem: Case,
  specificVehicleNo?: string
): Promise<void> {
  return expireDriverTripCredentialsForCase(caseItem, specificVehicleNo);
}

/**
 * Automatically expires, suspends, blocks, and cancels the temporary Driver Trip Login ID
 * as soon as the container is unloaded and the truck gates out at the destination.
 * All permanent Driver information (Name, CNIC, License, Phone, Transporter) remains 100% preserved.
 */
export async function expireDriverTripCredentialsForCase(
  caseItem: Case,
  specificVehicleNo?: string
): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();

  // Collect all vehicle numbers and driver names associated with this trip/case
  const vehicleNumbers = new Set<string>();
  const driverNames = new Set<string>();

  if (specificVehicleNo) {
    vehicleNumbers.add(specificVehicleNo.toUpperCase().trim());
  }

  (caseItem.containers || []).forEach(cntr => {
    if (cntr.vehicleNo) vehicleNumbers.add(cntr.vehicleNo.toUpperCase().trim());
    if (cntr.driverName) driverNames.add(cntr.driverName.toLowerCase().trim());
  });

  Object.values(caseItem.workflowDetails || {}).forEach(detail => {
    if (detail?.assignedVehicleNo) vehicleNumbers.add(detail.assignedVehicleNo.toUpperCase().trim());
    if (detail?.driverName) driverNames.add(detail.driverName.toLowerCase().trim());
  });

  // 1. Update matching Drivers in dpl_live_drivers & Firestore
  const allDrivers = safeAppStorage.getJSON<Driver[]>('dpl_live_drivers', []) || [];
  const expiredDriverUserIds = new Set<string>();

  for (const drv of allDrivers) {
    const dVeh = (drv.assignedVehicleNo || '').toUpperCase().trim();
    const dName = (drv.name || '').toLowerCase().trim();
    const matches =
      (dVeh && vehicleNumbers.has(dVeh)) ||
      (dName && driverNames.has(dName));

    if (matches) {
      if (drv.userId) expiredDriverUserIds.add(drv.userId.toLowerCase().trim());
      const updatedDriver: Driver = {
        ...drv,
        // Keep all permanent driver data intact, but expire/block the trip login ID
        status: 'AVAILABLE',
        loginEnabled: false,
        driverLoginStatus: 'SUSPENDED_TRIP_COMPLETED',
        lastExpiredTripId: drv.userId || drv.lastExpiredTripId,
        password: '', // Clear active trip password so old credentials cannot be reused
        tripLoginExpiredAt: nowIso,
        tripCompletedCaseNo: caseItem.caseNo,
        updatedAt: nowIso
      };
      await saveDriverToFirestore(updatedDriver);
    }
  }

  // 2. Update matching Vehicles in dpl_live_vehicles & Firestore
  const allVehicles = safeAppStorage.getJSON<Vehicle[]>('dpl_live_vehicles', []) || [];
  for (const veh of allVehicles) {
    const vReg = (veh.registrationNumber || '').toUpperCase().trim();
    const vDrv = (veh.driverName || '').toLowerCase().trim();
    if ((vReg && vehicleNumbers.has(vReg)) || (vDrv && driverNames.has(vDrv))) {
      if (veh.driverUserId) expiredDriverUserIds.add(veh.driverUserId.toLowerCase().trim());

      const updatedVehicle: Vehicle = {
        ...veh,
        status: 'AVAILABLE',
        isOnline: false,
        locationServiceEnabled: false,
        driverLoginStatus: 'SUSPENDED_TRIP_COMPLETED',
        lastExpiredTripId: veh.driverUserId || veh.lastExpiredTripId,
        driverPassword: '', // Clear trip password; new ID & password will be generated on next trip
        tripLoginExpiredAt: nowIso,
        tripCompletedCaseNo: caseItem.caseNo
      };
      await updateVehicleInFirestore(updatedVehicle);

      // Notify Transporter that Trip is completed & Driver Trip ID was automatically expired
      if (veh.transporterName) {
        const notif: AppNotification = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: `Trip Completed & Driver ID Expired: ${veh.registrationNumber}`,
          description: `Container unloaded & vehicle ${veh.registrationNumber} gated out at destination (${caseItem.pod}) for Case #${caseItem.caseNo}. Temporary Driver Trip ID (${veh.driverUserId || 'Trip ID'}) has been automatically suspended/expired. Driver permanent record remains saved.`,
          details: `Case No: ${caseItem.caseNo}\nVehicle: ${veh.registrationNumber}\nDriver: ${veh.driverName || 'Assigned Driver'}\nDestination: ${caseItem.pod}\nAction: Trip Driver Login ID automatically expired & blocked upon destination unload & gate-out. Generate a new Trip ID & Password on the next trip.`,
          timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'INFO',
          notificationSubType: 'VEHICLE_LOCATION_UPDATE',
          status: 'PENDING',
          actionLabel: 'View Fleet & Drivers',
          priority: 'MEDIUM',
          targetRole: 'TRANSPORTER,VEHICLE_MANAGER',
          targetClientName: veh.transporterName,
          category: 'TRANSPORTER',
          targetView: 'vehicles',
          targetFilter: { vehicleNo: veh.registrationNumber }
        };
        await saveNotificationToFirestore(notif);
      }
    }
  }

  // 3. Suspend any matching Driver user record in dpl_users_cache / Firestore
  const allUsers = safeAppStorage.getJSON<AppUser[]>('dpl_users_cache', []) || [];
  for (const u of allUsers) {
    const uId = (u.userId || '').toLowerCase().trim();
    if (u.role === UserRole.DRIVER && uId && expiredDriverUserIds.has(uId)) {
      await saveUserToFirestore({
        ...u,
        status: 'SUSPENDED',
        isSuspended: true,
        suspendedAt: nowIso,
        suspendedReason: `Trip completed & vehicle gated out at destination for Case #${caseItem.caseNo}`,
        password: ''
      });
    }
  }
}

/**
 * Generates a brand-new Trip Driver ID & Password for a vehicle/driver trip
 * and activates Location Service for the trip.
 */
export async function generateNewTripDriverCredentials(params: {
  vehicle?: Vehicle | null;
  driver?: Driver | null;
  transporterName: string;
}): Promise<{ tripUserId: string; tripPassword: string }> {
  const vehClean = (
    params.vehicle?.registrationNumber ||
    params.driver?.assignedVehicleNo ||
    'TRIP'
  )
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 6);

  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const tripUserId = `DRV-${vehClean}-${randomSuffix}`;
  const tripPassword = `TRP${Math.floor(1000 + Math.random() * 9000)}`;
  const nowIso = new Date().toISOString();

  if (params.driver) {
    const updatedDriver: Driver = {
      ...params.driver,
      userId: tripUserId,
      password: tripPassword,
      loginEnabled: true,
      driverLoginStatus: 'ACTIVE',
      status: 'ON_TRIP',
      updatedAt: nowIso
    };
    await saveDriverToFirestore(updatedDriver);
  }

  if (params.vehicle) {
    const updatedVehicle: Vehicle = {
      ...params.vehicle,
      locationServiceEnabled: true,
      driverUserId: tripUserId,
      driverPassword: tripPassword,
      driverLoginStatus: 'ACTIVE',
      status: 'ON_TRIP'
    };
    await updateVehicleInFirestore(updatedVehicle);
  }

  // Also upsert a Driver AppUser so login works immediately from LoginScreen
  const driverAppUser: AppUser = {
    id: Date.now() % 100000000,
    userId: tripUserId,
    password: tripPassword,
    name: params.driver?.name || params.vehicle?.driverName || 'Trip Driver',
    role: UserRole.DRIVER,
    roles: [UserRole.DRIVER],
    designation: `Trip Driver (${params.vehicle?.registrationNumber || params.driver?.assignedVehicleNo || 'Fleet'})`,
    contact: params.driver?.contact || params.vehicle?.driverContact || '',
    email: '',
    status: 'ACTIVE',
    isSuspended: false,
    clientName: params.transporterName
  };
  await saveUserToFirestore(driverAppUser);

  return { tripUserId, tripPassword };
}

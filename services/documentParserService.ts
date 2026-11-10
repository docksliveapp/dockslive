import * as XLSX from 'xlsx';
// @ts-ignore
import mammoth from 'mammoth';
import { Vehicle, VehicleCategory, VehicleType } from '../types';

export interface ParsedVehicleRow {
  registrationNumber: string;
  category: VehicleCategory;
  type: VehicleType;
  size: '20ft' | '40ft' | '45ft' | 'Loose';
  engineNo: string;
  chassisNo: string;
  maker?: string;
  make?: string;
  model?: string;
  makeModel?: string;
  transporterName: string;
  brokerName: string;
  driverName: string;
  driverCnic: string;
  driverContact: string;
  validationExpiryDate: string;
  registrationDate?: string;
  weightCapacity?: string;
  operatingCompany?: string;
  companyName?: string;
  status?: 'AVAILABLE' | 'EXPIRED';
}

/**
 * Normalizes a vehicle registration number / plate for strict deduplication across companies.
 * Example: "JT-9397", "jt 9397", "JT9397" -> "JT9397"
 */
export function normalizeVehiclePlate(reg?: string | null): string {
  return String(reg || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Generates a deterministic numeric ID for a vehicle based on its normalized registration plate.
 * Ensures the same vehicle never gets duplicated with multiple IDs in Firestore or LocalStorage.
 */
export function getDeterministicVehicleId(registrationNumber: string): number {
  const clean = normalizeVehiclePlate(registrationNumber);
  if (!clean) return Date.now();
  let hash = 5381;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) + hash) + clean.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) + 1000000;
}

/**
 * Resolves the operating company ID and display name from the Excel "COMPANY" column or sheet/file name.
 */
export function resolveVehicleCompany(
  rawCompany?: string | null,
  fallbackHint?: string | null
): { operatingCompany: string; companyName: string } {
  const primary = String(rawCompany || '').trim();
  const hint = String(fallbackHint || '').trim();
  const combined = (primary || hint).toLowerCase();

  if (combined.includes('truckit') || combined.includes('truck it') || combined.includes('trk')) {
    return {
      operatingCompany: 'truckit',
      companyName: primary ? primary.toUpperCase() : 'TRUCKIT PVT LTD'
    };
  }
  if (combined.includes('docks') || combined.includes('dpl')) {
    return {
      operatingCompany: 'docks',
      companyName: primary ? primary.toUpperCase() : 'DOCKS PVT LTD'
    };
  }
  if (combined.includes('muhib')) {
    return {
      operatingCompany: 'muhib',
      companyName: primary ? primary.toUpperCase() : 'MUHIB INTERNATIONAL'
    };
  }
  if (combined.includes('vantage') || combined.includes('vsl')) {
    return {
      operatingCompany: 'vantage',
      companyName: primary ? primary.toUpperCase() : 'VANTAGE SHIPPING LINE'
    };
  }
  if (primary) {
    return {
      operatingCompany: primary.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      companyName: primary.toUpperCase()
    };
  }
  return {
    operatingCompany: 'truckit',
    companyName: 'TRUCKIT PVT LTD'
  };
}

export function parseRobustDate(val: any): string | null {
  if (val === undefined || val === null || val === '') return null;

  if (val instanceof Date) {
    if (!isNaN(val.getTime())) {
      return val.toISOString().slice(0, 10);
    }
    return null;
  }

  const str = String(val).trim();
  if (!str || str.toLowerCase() === 'n/a' || str.toLowerCase() === 'nil' || str === '-') return null;

  // If Excel serial number (e.g. 44544 for 14/12/2021)
  if (!isNaN(Number(str)) && Number(str) > 20000 && Number(str) < 80000) {
    try {
      const dateObj = new Date(Math.round((Number(str) - 25569) * 86400 * 1000));
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString().slice(0, 10);
      }
    } catch (_) {}
  }

  // Try parsing direct Date string or South Asian/European format DD/MM/YYYY or D/M/YYYY
  const parts = str.split(/[-/.\s]+/);
  if (parts.length === 3) {
    // Check if it's YYYY-MM-DD
    if (parts[0].length === 4) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    // Check if it's DD/MM/YYYY or DD-MM-YY
    let y = parseInt(parts[2], 10);
    if (!isNaN(y) && parts[2].length === 2) {
      y += y >= 70 ? 1900 : 2000;
    }
    if (!isNaN(y) && y >= 1970 && y <= 2100) {
      let p0 = parseInt(parts[0], 10);
      let p1 = parseInt(parts[1], 10);

      // Handle word months like Dec/December
      if (isNaN(p1)) {
        const monthStr = parts[1].toLowerCase();
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const matchedIdx = months.findIndex(mon => monthStr.includes(mon));
        if (matchedIdx >= 0) p1 = matchedIdx + 1;
      }

      // In Pakistan (DD/MM/YYYY), first part is Day and second part is Month
      // Unless p1 > 12 (in which case p0 was Month and p1 was Day)
      let d = p0;
      let m = p1;
      if (m > 12 && d <= 12) {
        d = p1;
        m = p0;
      }

      if (!isNaN(d) && !isNaN(m) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  try {
    const parsed = Date.parse(str);
    if (!isNaN(parsed)) {
      return new Date(parsed).toISOString().slice(0, 10);
    }
  } catch (_) {}

  return null;
}

/**
 * Evaluates a vehicle's 6-month validity from its Registration Date (or latest Renewal Date):
 * - Empty / blank registrationDate (and no valid renewal) => EXPIRED
 * - registrationDate older than 6 months from today => EXPIRED
 * - registrationDate within the last 6 months => ACTIVE ('AVAILABLE')
 */
export function evaluateVehicleRegistrationValidity(
  registrationDate?: string | null,
  explicitValidationExpiryDate?: string | null,
  lastRenewalDate?: string | null
): {
  registrationDate: string;
  validationExpiryDate: string;
  expiryDate: string;
  isExpired: boolean;
  status: 'AVAILABLE' | 'EXPIRED';
} {
  const parsedReg = parseRobustDate(registrationDate);
  const parsedRenewal = parseRobustDate(lastRenewalDate);
  const effectiveStart = parsedRenewal && (!parsedReg || parsedRenewal > parsedReg)
    ? parsedRenewal
    : parsedReg;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (effectiveStart) {
    const startObj = new Date(`${effectiveStart}T00:00:00`);
    if (!isNaN(startObj.getTime())) {
      const expObj = new Date(startObj);
      expObj.setMonth(expObj.getMonth() + 6);
      const expStr = expObj.toISOString().slice(0, 10);
      const isExpired = expObj.getTime() < now.getTime();
      return {
        registrationDate: parsedReg || effectiveStart,
        validationExpiryDate: expStr,
        expiryDate: expStr,
        isExpired,
        status: isExpired ? 'EXPIRED' : 'AVAILABLE'
      };
    }
  }

  // If no registrationDate was provided, check if an explicit renewal expiry exists in the future ONLY if lastRenewalDate was set
  if (parsedRenewal && explicitValidationExpiryDate) {
    const parsedExp = parseRobustDate(explicitValidationExpiryDate);
    if (parsedExp) {
      const expObj = new Date(`${parsedExp}T00:00:00`);
      const isExpired = expObj.getTime() < now.getTime();
      return {
        registrationDate: parsedReg || parsedRenewal,
        validationExpiryDate: parsedExp,
        expiryDate: parsedExp,
        isExpired,
        status: isExpired ? 'EXPIRED' : 'AVAILABLE'
      };
    }
  }

  // Blank / empty registration date => EXPIRED
  return {
    registrationDate: '',
    validationExpiryDate: '',
    expiryDate: '',
    isExpired: true,
    status: 'EXPIRED'
  };
}

/**
 * Checks whether a vehicle has all mandatory details & uploaded documents required for Case Workflow completion:
 * 1. Registered in fleet list
 * 2. Active (not expired / registrationDate within 6 months or renewed)
 * 3. Vehicle Registration Book uploaded (registrationBook)
 * 4. Vehicle Owner ID Card / CNIC uploaded (ownerIdCardUrl)
 */
export interface VehicleWorkflowReadinessInput {
  vehicleNo?: string;
  registeredVehicles?: Vehicle[];
  caseRegistrationBookUrl?: string;
  caseOwnerCnicUrl?: string;
  driverName?: string;
  driverCnic?: string;
  driverCnicFrontUrl?: string;
  driverCnicBackUrl?: string;
}

export interface VehicleWorkflowReadinessResult {
  isReady: boolean;
  ready: boolean;
  isRegistered: boolean;
  isExpired: boolean;
  hasRegistrationBook: boolean;
  hasOwnerIdCard: boolean;
  hasDriverIdCard: boolean;
  missingItems: string[];
  errors: string[];
  vehicle?: Vehicle | null;
}

/**
 * Checks whether a vehicle has all mandatory details & uploaded documents required for Case Workflow completion:
 * 1. Registered in fleet list
 * 2. Active (not expired / registrationDate within 6 months or renewed)
 * 3. Vehicle Registration Book uploaded (registrationBook)
 * 4. Vehicle Owner ID Card / CNIC uploaded (ownerIdCardUrl)
 * 5. Driver ID Card (Front & Back) uploaded for the current trip
 */
export function checkVehicleWorkflowReadiness(
  arg1?: Vehicle | VehicleWorkflowReadinessInput | string | null,
  arg2?:
    | Vehicle[]
    | {
        registrationBookUrl?: string;
        ownerCnicUrl?: string;
        driverCnicFrontUrl?: string;
        driverCnicBackUrl?: string;
        driverCnic?: string;
      },
  hasDriverFrontFlag?: boolean,
  hasDriverBackFlag?: boolean
): VehicleWorkflowReadinessResult {
  let vehicle: Vehicle | null | undefined = null;
  let regBookOverride = '';
  let ownerCnicOverride = '';
  let driverFrontPresent = false;
  let driverBackPresent = false;
  let requireBothDriverSides = false;

  if (typeof arg1 === 'string') {
    // Signature: (assignedPlate, liveVehicles, hasDriverFront, hasDriverBack)
    const normPlate = normalizeVehiclePlate(arg1);
    const list = Array.isArray(arg2) ? arg2 : [];
    vehicle = normPlate
      ? list.find(v => normalizeVehiclePlate(v.registrationNumber) === normPlate) || null
      : null;
    driverFrontPresent = Boolean(hasDriverFrontFlag);
    driverBackPresent = Boolean(hasDriverBackFlag);
    requireBothDriverSides = hasDriverFrontFlag !== undefined || hasDriverBackFlag !== undefined;
  } else if (
    arg1 &&
    typeof arg1 === 'object' &&
    ('registeredVehicles' in arg1 || 'caseRegistrationBookUrl' in arg1 || 'vehicleNo' in arg1) &&
    !('registrationNumber' in arg1)
  ) {
    // Signature: ({ vehicleNo, registeredVehicles, caseRegistrationBookUrl, caseOwnerCnicUrl, driverCnicFrontUrl, driverCnicBackUrl })
    const input = arg1 as VehicleWorkflowReadinessInput;
    const normPlate = normalizeVehiclePlate(input.vehicleNo || '');
    const list = Array.isArray(input.registeredVehicles) ? input.registeredVehicles : [];
    vehicle = normPlate
      ? list.find(v => normalizeVehiclePlate(v.registrationNumber) === normPlate) || null
      : null;
    regBookOverride = input.caseRegistrationBookUrl || '';
    ownerCnicOverride = input.caseOwnerCnicUrl || '';
    driverFrontPresent = Boolean(input.driverCnicFrontUrl && input.driverCnicFrontUrl.trim());
    driverBackPresent = Boolean(input.driverCnicBackUrl && input.driverCnicBackUrl.trim());
    requireBothDriverSides = true;
  } else {
    // Signature: (vehicle, stepOverrides)
    vehicle = arg1 as Vehicle | null | undefined;
    const stepOverrides = (!Array.isArray(arg2) && arg2) ? arg2 : undefined;
    regBookOverride = stepOverrides?.registrationBookUrl || '';
    ownerCnicOverride = stepOverrides?.ownerCnicUrl || '';
    driverFrontPresent = Boolean(
      (stepOverrides?.driverCnicFrontUrl && stepOverrides.driverCnicFrontUrl.trim()) ||
      (vehicle?.licenseDoc && vehicle.licenseDoc.trim())
    );
    driverBackPresent = Boolean(
      (stepOverrides?.driverCnicBackUrl && stepOverrides.driverCnicBackUrl.trim()) ||
      (vehicle?.licenseDoc && vehicle.licenseDoc.trim())
    );
  }

  if (!vehicle) {
    const missing = ['Vehicle is not registered in the Fleet Vehicle List (Please register the vehicle in Fleet Management first)'];
    return {
      isReady: false,
      ready: false,
      isRegistered: false,
      isExpired: true,
      hasRegistrationBook: false,
      hasOwnerIdCard: false,
      hasDriverIdCard: false,
      missingItems: missing,
      errors: missing,
      vehicle: null
    };
  }

  const validity = evaluateVehicleRegistrationValidity(
    vehicle.registrationDate || vehicle.validationStartDate,
    vehicle.validationExpiryDate,
    vehicle.lastRenewalDate
  );

  const isStatusBlocked =
    vehicle.status === 'CANCELLED' ||
    vehicle.status === 'INACTIVE' ||
    vehicle.status === 'EXPIRED' ||
    validity.isExpired;

  const hasRegistrationBook = Boolean(
    (vehicle.registrationBook && vehicle.registrationBook.trim()) ||
    (vehicle.customsRegCertDoc && vehicle.customsRegCertDoc.trim()) ||
    (regBookOverride && regBookOverride.trim())
  );

  const hasOwnerIdCard = Boolean(
    (vehicle.ownerIdCardUrl && vehicle.ownerIdCardUrl.trim()) ||
    (ownerCnicOverride && ownerCnicOverride.trim())
  );

  const hasDriverIdCard = requireBothDriverSides
    ? driverFrontPresent && driverBackPresent
    : driverFrontPresent || driverBackPresent;

  const missingItems: string[] = [];
  if (isStatusBlocked) {
    missingItems.push(
      !vehicle.registrationDate && !vehicle.lastRenewalDate
        ? 'Vehicle Registration Date is blank (EXPIRED under Customs 6-Month Registration Rule)'
        : `Vehicle 6-Month Customs Registration is EXPIRED (${vehicle.registrationDate || vehicle.validationExpiryDate || 'Older than 6 months'}) — Please renew first`
    );
  }
  if (!hasRegistrationBook) {
    missingItems.push('Vehicle Registration Book is not uploaded (Uploaded by Vehicle Manager)');
  }
  if (!hasOwnerIdCard) {
    missingItems.push('Vehicle Owner ID Card (CNIC) is not uploaded (Uploaded by Vehicle Manager)');
  }
  if (requireBothDriverSides) {
    if (!driverFrontPresent) {
      missingItems.push('Driver ID Card (CNIC Front) is required (Uploaded by Loading Staff)');
    }
    if (!driverBackPresent) {
      missingItems.push('Driver ID Card (CNIC Back) is required (Uploaded by Loading Staff)');
    }
  } else if (!hasDriverIdCard) {
    missingItems.push('Driver ID Card (CNIC) is not uploaded (Uploaded by Loading Staff)');
  }

  const ready = missingItems.length === 0;
  return {
    isReady: ready,
    ready,
    isRegistered: true,
    isExpired: isStatusBlocked,
    hasRegistrationBook,
    hasOwnerIdCard,
    hasDriverIdCard,
    missingItems,
    errors: missingItems,
    vehicle
  };
}

export type DedupeVehiclesResult<T> = T[] & {
  merged: T[];
  removedIds: (string | number)[];
};

function attachDedupeMeta<T>(arr: T[], removedIds: (string | number)[]): DedupeVehiclesResult<T> {
  const result = arr as DedupeVehiclesResult<T>;
  Object.defineProperty(result, 'merged', {
    value: arr,
    enumerable: false,
    configurable: true,
    writable: true
  });
  Object.defineProperty(result, 'removedIds', {
    value: removedIds,
    enumerable: false,
    configurable: true,
    writable: true
  });
  return result;
}

/**
 * Deduplicates and merges vehicle records by normalized registrationNumber.
 * Enforces the user's strict rules:
 * 1. Vehicles MOVE between companies, they are NEVER copied/duplicated.
 * 2. If a vehicle appears in both Docks Private Limited and Truckit Private Limited,
 *    it is shifted to Truckit Private Limited ('truckit' / 'TRUCKIT PVT LTD') and removed from Docks.
 * 3. Transporter and Broker are always kept identical.
 */
export function dedupeAndMergeVehicles<T extends Partial<Vehicle>>(
  records: T[],
  options?: { preferIncomingCompany?: boolean }
): DedupeVehiclesResult<T> {
  if (!Array.isArray(records) || records.length === 0) {
    return attachDedupeMeta<T>([], []);
  }
  const map = new Map<string, T>();
  const removedIds: (string | number)[] = [];

  for (const item of records) {
    if (!item || !item.registrationNumber) continue;
    if (isCorruptedVehicleRecord(item)) continue;

    const plateKey = normalizeVehiclePlate(item.registrationNumber);
    if (!plateKey) continue;

    const cleanReg = String(item.registrationNumber).trim().toUpperCase();
    const transporter = String(item.transporterName || item.brokerName || 'DIRECT FLEET').trim();
    const broker = transporter; // Transporter and Broker are always identical per user mandate

    const maker = String(item.maker || item.make || '').trim().toUpperCase();
    const model = String(item.model || '').trim();
    const makeModel = item.makeModel || [maker, model].filter(Boolean).join(' ') || undefined;

    const compInfo = resolveVehicleCompany(item.companyName || item.operatingCompany);
    const validity = evaluateVehicleRegistrationValidity(
      item.registrationDate || item.validationStartDate,
      item.validationExpiryDate,
      item.lastRenewalDate
    );

    const existing = map.get(plateKey);
    if (!existing) {
      const normalizedItem: T = {
        ...item,
        id: item.id || getDeterministicVehicleId(cleanReg),
        registrationNumber: cleanReg,
        transporterName: transporter,
        brokerName: broker,
        maker: maker || item.maker,
        make: maker || item.make,
        model: model || item.model,
        makeModel: makeModel || item.makeModel,
        operatingCompany: compInfo.operatingCompany,
        companyName: compInfo.companyName,
        registrationDate: validity.registrationDate || undefined,
        validationExpiryDate: validity.validationExpiryDate,
        status: item.status === 'ON_TRIP' || item.status === 'CANCELLED'
          ? item.status
          : validity.status
      };
      map.set(plateKey, normalizedItem);
    } else {
      // Merge existing and incoming without duplicating!
      // Rule: If either record is Truckit and the other is Docks, it MUST be on Truckit (moved from Docks to Truckit).
      const existingComp = resolveVehicleCompany(existing.companyName || existing.operatingCompany);
      const incomingComp = compInfo;

      let finalOperatingCompany = incomingComp.operatingCompany;
      let finalCompanyName = incomingComp.companyName;

      if (
        (existingComp.operatingCompany === 'truckit' && incomingComp.operatingCompany === 'docks') ||
        (existingComp.operatingCompany === 'docks' && incomingComp.operatingCompany === 'truckit')
      ) {
        finalOperatingCompany = 'truckit';
        finalCompanyName = 'TRUCKIT PVT LTD';
      }

      // Track redundant ID so Firestore can delete duplicate document IDs
      const primaryId = existing.id || getDeterministicVehicleId(cleanReg);
      if (item.id && String(item.id) !== String(primaryId)) {
        removedIds.push(item.id);
      }
      const docIdRaw = (item as any)._docId;
      if (docIdRaw && String(docIdRaw) !== String(primaryId)) {
        removedIds.push(docIdRaw);
      }

      // Pick the best registration date (if one has a date and the other is empty, keep the date; if both have dates, keep the newer one)
      const existingRegDate = parseRobustDate(existing.registrationDate || existing.validationStartDate);
      const incomingRegDate = parseRobustDate(item.registrationDate || item.validationStartDate);
      let bestRegDate = incomingRegDate || existingRegDate || '';
      if (existingRegDate && incomingRegDate) {
        bestRegDate = incomingRegDate >= existingRegDate ? incomingRegDate : existingRegDate;
      }

      const bestRenewalDate = item.lastRenewalDate || existing.lastRenewalDate;
      const mergedValidity = evaluateVehicleRegistrationValidity(
        bestRegDate,
        item.validationExpiryDate || existing.validationExpiryDate,
        bestRenewalDate
      );

      const mergedTransporter =
        (item.transporterName && item.transporterName !== 'Direct Fleet' && item.transporterName !== 'Direct Broker')
          ? item.transporterName.trim()
          : (existing.transporterName || transporter);

      const mergedMaker = maker || existing.maker || existing.make || '';
      const mergedModel = model || existing.model || '';
      const mergedMakeModel = [mergedMaker, mergedModel].filter(Boolean).join(' ') || item.makeModel || existing.makeModel;

      // Merge tripsHistory so multi-trip history is never lost when a vehicle moves company
      const existingTrips = Array.isArray(existing.tripsHistory) ? existing.tripsHistory : [];
      const incomingTrips = Array.isArray(item.tripsHistory) ? item.tripsHistory : [];
      const combinedTripsMap = new Map<string, any>();
      [...incomingTrips, ...existingTrips].forEach((tr) => {
        if (!tr) return;
        const key = tr.id || `${tr.caseNo || ''}-${tr.date || ''}-${tr.containerNumber || ''}`;
        if (!combinedTripsMap.has(key)) {
          combinedTripsMap.set(key, tr);
        }
      });

      const merged: T = {
        ...existing,
        ...item,
        id: primaryId,
        registrationNumber: cleanReg,
        chassisNo: (item.chassisNo && item.chassisNo !== 'N/A') ? item.chassisNo : (existing.chassisNo || 'N/A'),
        engineNo: (item.engineNo && item.engineNo !== 'N/A') ? item.engineNo : (existing.engineNo || 'N/A'),
        maker: mergedMaker || undefined,
        make: mergedMaker || undefined,
        model: mergedModel || undefined,
        makeModel: mergedMakeModel || undefined,
        transporterName: mergedTransporter,
        brokerName: mergedTransporter, // Always keep broker identical to transporter
        operatingCompany: finalOperatingCompany,
        companyName: finalCompanyName,
        registrationDate: mergedValidity.registrationDate || undefined,
        validationExpiryDate: mergedValidity.validationExpiryDate,
        lastRenewalDate: bestRenewalDate,
        // Preserve uploaded documents and owner details across updates
        registrationBook: item.registrationBook || existing.registrationBook,
        registrationBookName: item.registrationBookName || existing.registrationBookName,
        customsRegCertDoc: item.customsRegCertDoc || existing.customsRegCertDoc,
        ownerIdCardUrl: item.ownerIdCardUrl || existing.ownerIdCardUrl,
        ownerIdCardName: item.ownerIdCardName || existing.ownerIdCardName,
        ownerName: item.ownerName || existing.ownerName,
        ownerCnic: item.ownerCnic || existing.ownerCnic,
        ownerAddress: item.ownerAddress || existing.ownerAddress,
        driverName: item.driverName || existing.driverName || '',
        driverCnic: item.driverCnic || existing.driverCnic || '',
        driverContact: item.driverContact || existing.driverContact || '',
        tripsHistory: Array.from(combinedTripsMap.values()),
        history: Array.isArray(existing.history) && existing.history.length > 0
          ? existing.history
          : (item.history || []),
        status: existing.status === 'ON_TRIP' || item.status === 'ON_TRIP'
          ? 'ON_TRIP'
          : (item.status === 'CANCELLED' ? 'CANCELLED' : mergedValidity.status)
      };

      map.set(plateKey, merged);
    }
  }

  return attachDedupeMeta(Array.from(map.values()), removedIds);
}

/**
 * Checks if a string or vehicle record looks like corrupted binary / zip data.
 * This prevents zip files (like raw xlsx read as text) from poisoning the database.
 */
export function isCorruptedVehicleRecord(record: { registrationNumber?: string; [key: string]: any }): boolean {
  const reg = String(record?.registrationNumber || '').trim();
  if (!reg) return true;

  // Check for common ZIP / XML / OOXML binary fragments
  if (
    reg.includes('_rels') ||
    reg.includes('workbook.xml') ||
    reg.includes('[Content_Types]') ||
    reg.includes('word/') ||
    reg.includes('xl/') ||
    reg.includes('PK\x03') ||
    reg.includes('PK\x01')
  ) {
    return true;
  }

  // Check for excessive non-printable ASCII or control characters
  let nonPrintableCount = 0;
  for (let i = 0; i < reg.length; i++) {
    const code = reg.charCodeAt(i);
    if (code < 32 || code > 126) {
      nonPrintableCount++;
    }
  }

  if (nonPrintableCount > 2) return true;

  const weirdSymbols = (reg.match(/[\\$%^&*@!~`+={}\[\]|;:"<>?]/g) || []).length;
  if (weirdSymbols >= 3) return true;

  return false;
}

/**
 * Normalizes text to standard vehicle category enum
 */
export function mapToVehicleCategory(val: string): VehicleCategory {
  const s = String(val || '').toLowerCase().trim();
  if (s.includes('afghan')) return VehicleCategory.AFGHAN_TRANSIT;
  if (s.includes('tir')) return VehicleCategory.TIR;
  if (s.includes('local') || s.includes('domestic')) return VehicleCategory.LOCAL_TRANSPORTATION;
  return VehicleCategory.BONDED_CARRIER;
}

/**
 * Normalizes text to standard vehicle type enum
 */
export function mapToVehicleType(val: string): VehicleType {
  const s = String(val || '').toLowerCase().trim();
  if (s.includes('low')) return VehicleType.LOWBED;
  if (s.includes('coil')) return VehicleType.COIL_LIFTER;
  if (s.includes('car')) return VehicleType.CAR_CARRIER;
  if (s.includes('mazda')) return VehicleType.MAZDA;
  if (s.includes('shehzore')) return VehicleType.SHEHZORE;
  if (s.includes('open')) return VehicleType.OPEN_TRUCK;
  if (s.includes('container')) return VehicleType.CONTAINER;
  return VehicleType.FLATBED;
}

/**
 * Normalizes vehicle size
 */
export function mapToVehicleSize(val: string): '20ft' | '40ft' | '45ft' | 'Loose' {
  const s = String(val || '').toLowerCase().trim();
  if (s.includes('20')) return '20ft';
  if (s.includes('45')) return '45ft';
  if (s.includes('loose')) return 'Loose';
  return '40ft';
}

/**
 * Parses an Excel (.xlsx / .xls) file buffer into structured vehicle records.
 * Supports multi-sheet workbooks (e.g. DOCKS and TRUCKIT sheets) and maps:
 * VEHICLE NO., CHASSIS NO., ENGINE NO., MAKER, MODEL, TRANSPORTER NAME, REGISTRATION DATE, COMPANY
 */
export function parseExcelVehicles(arrayBuffer: ArrayBuffer, fileNameHint?: string): ParsedVehicleRow[] {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  if (!wb.SheetNames || wb.SheetNames.length === 0) return [];

  const allSheetResults: ParsedVehicleRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // Use raw: false so formatted dates like 14/12/2021 or 6/12/2016 are read as strings cleanly
    const jsonData = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: false });
    if (!jsonData || jsonData.length === 0) continue;

    // Find header row or assume row 0
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(jsonData.length, 15); i++) {
      const row = jsonData[i];
      if (Array.isArray(row)) {
        const rowText = row.map(c => String(c).toLowerCase()).join(' ');
        if (
          rowText.includes('vehicle') ||
          rowText.includes('chassis') ||
          rowText.includes('engine') ||
          rowText.includes('registration') ||
          rowText.includes('transporter') ||
          rowText.includes('truck') ||
          rowText.includes('plate')
        ) {
          headerRowIndex = i;
          break;
        }
      }
    }

    const headers = (jsonData[headerRowIndex] || []).map(h =>
      String(h || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
    );

    // Helper to find column index with strict keyword prioritized matching and exclusions
    const findCol = (keywords: string[], exclusions: string[] = []): number => {
      // Stage 1: Exact matches first
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (!h) continue;
        const matchesExclusion = exclusions.some(ex => h.includes(ex));
        if (matchesExclusion) continue;

        const isExact = keywords.some(
          kw =>
            h === kw ||
            h === kw + '.' ||
            h.startsWith(kw + ' ') ||
            h.endsWith(' ' + kw) ||
            h.startsWith(kw + ':') ||
            h.startsWith(kw + '-')
        );
        if (isExact) return i;
      }

      // Stage 2: Substring inclusion matches
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (!h) continue;
        const matchesExclusion = exclusions.some(ex => h.includes(ex));
        if (matchesExclusion) continue;

        const matchesKeyword = keywords.some(kw => h.includes(kw));
        if (matchesKeyword) return i;
      }
      return -1;
    };

    const regCol = findCol(
      [
        'vehicle no.', 'vehicle no', 'vehicle number', 'vehicle #',
        'veh no', 'veh no.', 'veh #', 'veh number',
        'reg no', 'reg no.', 'reg #', 'registration no', 'registration no.', 'registration number', 'registration #',
        'truck no', 'truck no.', 'truck number', 'truck #', 'truck',
        'trailer no', 'trailer #', 'trailer', 'prime mover', 'fleet no', 'fleet #',
        'plate number', 'plate no', 'plate no.', 'plate #',
        'gadi number', 'gadi no', 'gari no', 'gari number',
        'vehicle', 'plate'
      ],
      ['date', 'expiry', 'valid', 'time', 'issue', 'day', 'driver', 'sr no', 's.no', 'sr.', 'serial', 'chassis', 'engine', 'company']
    );

    const chsCol = findCol(
      ['chassis no.', 'chassis no', 'chassis number', 'chassis #', 'chassis', 'chasis', 'chass', 'chs no'],
      ['date', 'vehicle', 'engine']
    );

    const engCol = findCol(
      ['engine no.', 'engine no', 'engine number', 'engine #', 'engine', 'eng no'],
      ['date', 'vehicle', 'chassis']
    );

    const makerCol = findCol(
      ['maker', 'make', 'brand', 'manufacturer'],
      ['model', 'date', 'company', 'transporter']
    );

    const modelCol = findCol(
      ['model', 'model year', 'year'],
      ['maker', 'make', 'date', 'company', 'transporter']
    );

    // IMPORTANT: Never include 'company' in transpCol so COMPANY and TRANSPORTER NAME stay strictly separate
    const transpCol = findCol(
      ['transporter name', 'transporter', 'fleet owner', 'vendor name'],
      ['company', 'date', 'vehicle', 'chassis', 'engine']
    );

    const brokerCol = findCol(
      ['broker name', 'broker'],
      ['company', 'date', 'vehicle']
    );

    const regDateCol = findCol(
      ['registration date', 'reg date', 'reg. date', 'registered date', 'date of registration', 'issue date', 'reg_date'],
      ['number', 'no', 'plate', 'vehicle']
    );

    const companyCol = findCol(
      ['company', 'company name', 'operating company', 'registered company', 'carrier company', 'entity'],
      ['transporter', 'broker', 'driver']
    );

    const catCol = findCol(['category', 'carrier', 'transit', 'bound'], ['company']);
    const typeCol = findCol(['type', 'body']);
    const sizeCol = findCol(['size', 'length', 'feet', 'ft']);
    const driverCol = findCol(
      ['driver name', 'driver_name', 'driver fullname', 'driver full name', 'driver', 'chalak'],
      ['transporter', 'broker', 'company', 'owner', 'father', 'vendor', 'client', 'customer', 'agent', 'contact', 'firm', 'group']
    );
    const cnicCol = findCol(
      ['driver cnic', 'driver nic', 'driver id', 'driver_cnic'],
      ['owner', 'broker', 'transporter', 'father']
    );
    const contactCol = findCol(
      ['driver contact', 'driver phone', 'driver mobile', 'driver cell', 'driver_phone'],
      ['broker', 'transporter', 'company', 'owner', 'office']
    );
    const expiryCol = findCol(
      ['expiry', 'valid', 'expire', 'exp', 'expiry date', 'validity'],
      ['registration', 'reg', 'start', 'issue']
    );
    const weightCol = findCol(['weight', 'capacity', 'ton', 'payload']);

    for (let r = headerRowIndex + 1; r < jsonData.length; r++) {
      const row = jsonData[r];
      if (!Array.isArray(row) || row.length === 0) continue;

      let rawReg = regCol >= 0 ? row[regCol] : row[0];
      if (!rawReg || String(rawReg).trim() === '' || /^\d{1,3}$/.test(String(rawReg).trim())) {
        for (let ci = 0; ci < Math.min(row.length, 4); ci++) {
          if (ci === regCol) continue;
          const cellVal = String(row[ci] || '').trim();
          if (/^\d{1,3}$/.test(cellVal)) continue;
          if (cellVal.toLowerCase().includes('date') || cellVal.toLowerCase().includes('exp')) continue;
          if (cellVal.length >= 3 && /[A-Za-z0-9]/.test(cellVal)) {
            rawReg = cellVal;
            break;
          }
        }
      }

      const cleanReg = String(rawReg || '').trim().toUpperCase();
      if (
        !cleanReg ||
        cleanReg.toLowerCase().includes('vehicle no') ||
        cleanReg.toLowerCase().includes('vehicle registration') ||
        cleanReg.toLowerCase().includes('registration no') ||
        cleanReg.toLowerCase().includes('truck no') ||
        cleanReg.toLowerCase() === 'sr no' ||
        cleanReg.toLowerCase() === 's.no' ||
        cleanReg.toLowerCase() === 'serial' ||
        /^\d{1,3}$/.test(cleanReg)
      ) {
        continue;
      }

      if (isCorruptedVehicleRecord({ registrationNumber: cleanReg })) {
        continue;
      }

      const category = mapToVehicleCategory(catCol >= 0 ? String(row[catCol]) : 'Bonded Carrier');
      const type = mapToVehicleType(typeCol >= 0 ? String(row[typeCol]) : 'Flatbed');
      const size = mapToVehicleSize(sizeCol >= 0 ? String(row[sizeCol]) : '40ft');

      const chassisNo = chsCol >= 0 ? String(row[chsCol] || '').trim() : 'N/A';
      const engineNo = engCol >= 0 ? String(row[engCol] || '').trim() : 'N/A';
      const maker = makerCol >= 0 ? String(row[makerCol] || '').trim().toUpperCase() : '';
      const model = modelCol >= 0 ? String(row[modelCol] || '').trim() : '';
      const makeModel = [maker, model].filter(Boolean).join(' ');

      const rawTransporter = transpCol >= 0 ? String(row[transpCol] || '').trim() : '';
      const rawBroker = brokerCol >= 0 ? String(row[brokerCol] || '').trim() : '';
      // User mandate: "Transporter aur broker same hoga. Yahan Jo likha hua hai transporter mein vahi broker mein bhi automatic aaega"
      const unifiedTransporterBroker = rawTransporter || rawBroker || 'DIRECT FLEET';

      const rawCompanyCell = companyCol >= 0 ? String(row[companyCol] || '').trim() : '';
      const resolvedCompany = resolveVehicleCompany(rawCompanyCell, `${sheetName || ''} ${fileNameHint || ''}`);

      const rawRegDateVal = regDateCol >= 0 ? row[regDateCol] : '';
      const rawExpiryVal = expiryCol >= 0 ? row[expiryCol] : '';
      // User mandate:
      // - Registration date > 6 months old => Expired
      // - Empty / blank Registration date ("Khali khane") => Expired
      // - Registration date within 6 months => Active ('AVAILABLE')
      const validity = evaluateVehicleRegistrationValidity(rawRegDateVal, rawExpiryVal, null);

      let rawDriver = driverCol >= 0 ? String(row[driverCol] || '').trim() : '';
      if (
        !rawDriver ||
        rawDriver.toLowerCase() === unifiedTransporterBroker.toLowerCase() ||
        rawDriver.toLowerCase() === 'n/a' ||
        rawDriver.toLowerCase() === 'none' ||
        rawDriver.toLowerCase() === 'direct fleet'
      ) {
        rawDriver = '';
      }

      let rawCnic = cnicCol >= 0 ? String(row[cnicCol] || '').trim() : '';
      if (rawCnic.toLowerCase() === 'n/a' || rawCnic.toLowerCase() === 'none') rawCnic = '';

      let rawContact = contactCol >= 0 ? String(row[contactCol] || '').trim() : '';
      if (rawContact.toLowerCase() === 'n/a' || rawContact.toLowerCase() === 'none') rawContact = '';

      const weightCapacity = weightCol >= 0 ? String(row[weightCol] || '').trim() : undefined;

      allSheetResults.push({
        registrationNumber: cleanReg,
        category,
        type,
        size,
        engineNo: engineNo || 'N/A',
        chassisNo: chassisNo || 'N/A',
        maker: maker || undefined,
        make: maker || undefined,
        model: model || undefined,
        makeModel: makeModel || undefined,
        transporterName: unifiedTransporterBroker,
        brokerName: unifiedTransporterBroker,
        driverName: rawDriver,
        driverCnic: rawCnic,
        driverContact: rawContact,
        validationExpiryDate: validity.validationExpiryDate,
        registrationDate: validity.registrationDate || undefined,
        weightCapacity,
        operatingCompany: resolvedCompany.operatingCompany,
        companyName: resolvedCompany.companyName,
        status: validity.status
      });
    }
  }

  // Deduplicate across sheets/rows (if a vehicle is in both Docks and Truckit, it moves to Truckit!)
  return dedupeAndMergeVehicles(allSheetResults);
}

/**
 * Parses Word (.docx) documents containing vehicle lists or tables using Mammoth
 */
export async function parseDocxVehicles(arrayBuffer: ArrayBuffer, fileNameHint?: string): Promise<ParsedVehicleRow[]> {
  try {
    const htmlResult = await mammoth.convertToHtml({ arrayBuffer });
    const html = htmlResult.value;

    if (html && html.includes('<table')) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const tables = doc.querySelectorAll('table');
      const tableRows: string[][] = [];

      tables.forEach(table => {
        const rows = table.querySelectorAll('tr');
        rows.forEach(tr => {
          const cells = tr.querySelectorAll('td, th');
          const rowData: string[] = [];
          cells.forEach(td => rowData.push(td.textContent?.trim() || ''));
          if (rowData.length > 0) {
            tableRows.push(rowData);
          }
        });
      });

      if (tableRows.length > 1) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(tableRows);
        XLSX.utils.book_append_sheet(wb, ws, 'DocxTable');
        const ab = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        return parseExcelVehicles(ab, fileNameHint);
      }
    }

    const textResult = await mammoth.extractRawText({ arrayBuffer });
    const text = textResult.value || '';
    return parseTextOrCsvVehicles(text, fileNameHint);
  } catch (err) {
    console.error('Error parsing DOCX file:', err);
    return [];
  }
}

/**
 * Parses plain text, CSV, or TSV vehicle data
 */
export function parseTextOrCsvVehicles(text: string, fileNameHint?: string): ParsedVehicleRow[] {
  if (!text || typeof text !== 'string') return [];

  if (text.startsWith('PK\x03\x04') || text.includes('_rels/.rels') || text.includes('xl/workbook.xml')) {
    console.warn('Blocked raw binary zip/docx/xlsx data from text parser.');
    return [];
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Convert CSV/TSV lines into an Excel sheet in memory so header detection works identically to Excel!
  const aoa: string[][] = lines.map(line => {
    let delimiter = ',';
    if (line.includes('\t')) delimiter = '\t';
    else if (line.includes('|')) delimiter = '|';
    else if (line.includes(';') && !line.includes(',')) delimiter = ';';
    return line.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
  });

  const firstRowText = (aoa[0] || []).join(' ').toLowerCase();
  const hasHeaders =
    firstRowText.includes('vehicle') ||
    firstRowText.includes('chassis') ||
    firstRowText.includes('engine') ||
    firstRowText.includes('registration') ||
    firstRowText.includes('transporter');

  if (hasHeaders) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'CSV');
    const ab = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return parseExcelVehicles(ab, fileNameHint);
  }

  const results: ParsedVehicleRow[] = [];
  for (const cols of aoa) {
    if (cols.length === 0 || !cols[0]) continue;
    const cleanReg = cols[0].toUpperCase();
    if (isCorruptedVehicleRecord({ registrationNumber: cleanReg })) continue;

    // Support 8-column layout: VEHICLE NO, CHASSIS NO, ENGINE NO, MAKER, MODEL, TRANSPORTER NAME, REGISTRATION DATE, COMPANY
    const chassisNo = cols[1] || 'N/A';
    const engineNo = cols[2] || 'N/A';
    const maker = (cols[3] || '').toUpperCase();
    const model = cols[4] || '';
    const transporter = cols[5] || 'DIRECT FLEET';
    const regDateRaw = cols[6] || '';
    const companyRaw = cols[7] || '';

    const validity = evaluateVehicleRegistrationValidity(regDateRaw, null, null);
    const compInfo = resolveVehicleCompany(companyRaw, fileNameHint);

    results.push({
      registrationNumber: cleanReg,
      category: VehicleCategory.BONDED_CARRIER,
      type: VehicleType.FLATBED,
      size: '40ft',
      chassisNo,
      engineNo,
      maker: maker || undefined,
      make: maker || undefined,
      model: model || undefined,
      makeModel: [maker, model].filter(Boolean).join(' ') || undefined,
      transporterName: transporter,
      brokerName: transporter,
      driverName: '',
      driverCnic: '',
      driverContact: '',
      registrationDate: validity.registrationDate || undefined,
      validationExpiryDate: validity.validationExpiryDate,
      operatingCompany: compInfo.operatingCompany,
      companyName: compInfo.companyName,
      status: validity.status
    });
  }

  return dedupeAndMergeVehicles(results);
}

/**
 * Universal Master File Parser for Vehicles
 * Automatically routes .xlsx, .xls, .docx, .csv, .txt to the correct parser
 */
export async function parseVehicleFile(file: File): Promise<{
  rows: ParsedVehicleRow[];
  fileType: 'EXCEL' | 'DOCX' | 'CSV_TEXT' | 'UNKNOWN';
  error?: string;
}> {
  const name = file.name.toLowerCase();

  try {
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm')) {
      const buffer = await file.arrayBuffer();
      const rows = parseExcelVehicles(buffer, file.name);
      return { rows, fileType: 'EXCEL' };
    }

    if (name.endsWith('.docx')) {
      const buffer = await file.arrayBuffer();
      const rows = await parseDocxVehicles(buffer, file.name);
      return { rows, fileType: 'DOCX' };
    }

    if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
      const text = await file.text();
      if (text.startsWith('PK\x03\x04')) {
        const buffer = await file.arrayBuffer();
        const rows = parseExcelVehicles(buffer, file.name);
        return { rows, fileType: 'EXCEL' };
      }
      const rows = parseTextOrCsvVehicles(text, file.name);
      return { rows, fileType: 'CSV_TEXT' };
    }

    const slice = await file.slice(0, 4).arrayBuffer();
    const bytes = new Uint8Array(slice);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

    if (isZip) {
      const buffer = await file.arrayBuffer();
      try {
        const rows = parseExcelVehicles(buffer, file.name);
        if (rows.length > 0) {
          return { rows, fileType: 'EXCEL' };
        }
      } catch (_) {}

      try {
        const rows = await parseDocxVehicles(buffer, file.name);
        if (rows.length > 0) {
          return { rows, fileType: 'DOCX' };
        }
      } catch (_) {}
    }

    const text = await file.text();
    const rows = parseTextOrCsvVehicles(text, file.name);
    return { rows, fileType: 'CSV_TEXT' };
  } catch (err: any) {
    console.error('Master file parser failed:', err);
    return {
      rows: [],
      fileType: 'UNKNOWN',
      error: err?.message || 'Failed to read document file'
    };
  }
}

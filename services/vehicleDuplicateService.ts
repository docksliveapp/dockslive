import { Vehicle, VehicleHistory } from '../types';

export type DuplicateMatchCategory =
  | 'EXACT_TRI_MATCH'
  | 'CROSS_COMPANY_CE_MATCH'
  | 'SAME_CHASSIS_AND_ENGINE'
  | 'SAME_CHASSIS_ONLY'
  | 'SAME_BASE_PLATE_DIFF_TECH';

export interface DuplicateVehicleGroup {
  groupId: string;
  category: DuplicateMatchCategory;
  categoryLabel: string;
  matchReason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'REVIEW';
  isCrossCompanyTruckitDocks: boolean;
  vehicles: Vehicle[];
  recommendedKeepId: number;
  chassisMatch: boolean;
  engineMatch: boolean;
  plateMatch: 'EXACT' | 'BASE_SUFFIX' | 'DIFFERENT';
}

const INVALID_TECH_TOKENS = new Set([
  '',
  'NA',
  'N/A',
  'NIL',
  'NONE',
  'NULL',
  'UNDEFINED',
  '0',
  '00',
  '000',
  '0000',
  'AF',
  'APPLIED',
  'APPLIEDFOR',
  'NOTAVAILABLE',
  'UNKNOWN',
]);

// Common Pakistani Excise / MRA province & district suffixes appended after plate digits
// e.g. TLC-880LS (Lasbela), TLQ-411QT (Quetta), AE-0227BD (Balochistan/Dera), TAL-865KP (KP), TLA-044BL, XA-082MD
const PAK_MRA_SUFFIXES = new Set([
  'LS',
  'LASBELA',
  'QT',
  'QTA',
  'QUETTA',
  'BD',
  'BL',
  'BAL',
  'KP',
  'KPK',
  'MD',
  'MARDAN',
  'PS',
  'PSH',
  'PESHAWAR',
  'LH',
  'LHR',
  'LAHORE',
  'KR',
  'KHI',
  'KARACHI',
  'SD',
  'SINDH',
  'PJ',
  'PUNJAB',
  'ISB',
  'ICT',
  'RWP',
  'AJK',
  'GB',
  'GLT',
  'SW',
  'SWT',
  'DIK',
  'BNN',
  'HZR',
  'HRP',
]);

export function normalizePlateStrict(reg?: string | null): string {
  return String(reg || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Extracts the core registration number without trailing city/MRA suffix letters.
 * Example:
 *  - "TLC-880LS" -> { base: "TLC880", suffix: "LS" }
 *  - "TLA-944-QT" -> { base: "TLA944", suffix: "QT" }
 *  - "AE-0227BD" -> { base: "AE0227", suffix: "BD" }
 *  - "TLC-880" -> { base: "TLC880", suffix: "" }
 */
export function extractVehicleBasePlate(reg?: string | null): {
  strict: string;
  base: string;
  suffix: string;
} {
  const strict = normalizePlateStrict(reg);
  if (!strict) return { strict: '', base: '', suffix: '' };

  const match = strict.match(/^([A-Z]{1,5})(\d{1,6})([A-Z]{1,8})$/);
  if (match) {
    const [, prefix, digits, tail] = match;
    if (PAK_MRA_SUFFIXES.has(tail) || tail.length <= 3) {
      return {
        strict,
        base: `${prefix}${digits}`,
        suffix: tail,
      };
    }
  }

  return { strict, base: strict, suffix: '' };
}

/**
 * Normalizes Chassis or Engine serial numbers for accurate matching:
 * - Removes dashes, spaces, slashes
 * - Converts letter 'O' adjacent to digits into '0' (e.g. HO7DA97360 -> H07DA97360)
 * - Strips leading zeros on purely numeric or zero-prefixed serials (e.g. 027776 -> 27776)
 * - Treats N/A, NIL, <4 chars as empty
 */
export function normalizeTechNumber(raw?: string | null): string {
  const upper = String(raw || '').trim().toUpperCase();
  if (!upper || INVALID_TECH_TOKENS.has(upper)) return '';

  const alnum = upper.replace(/[^A-Z0-9]/g, '');
  if (!alnum || INVALID_TECH_TOKENS.has(alnum) || alnum.length < 4) return '';

  // Fix common OCR / typing substitution: 'O' next to digits -> '0'
  const ocrFixed = alnum
    .replace(/O(?=\d)/g, '0')
    .replace(/(?<=\d)O/g, '0');

  const trimmedZeros = ocrFixed.replace(/^0+/, '');
  if (!trimmedZeros || trimmedZeros.length < 4) return '';
  return trimmedZeros;
}

export function matchTechNumbers(
  rawA?: string | null,
  rawB?: string | null
): 'EXACT' | 'PARTIAL' | 'NONE' {
  const a = normalizeTechNumber(rawA);
  const b = normalizeTechNumber(rawB);
  if (!a || !b) return 'NONE';

  if (a === b) return 'EXACT';

  // Suffix serial match when one list omitted maker prefix (e.g. "10357" vs "CM88WH10357" or "007695" vs "NE6007695")
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 5 && longer.endsWith(shorter)) {
    return 'PARTIAL';
  }

  // Single-character OCR difference on long serials (>= 6 chars) when one also matches suffix/prefix
  if (shorter.length >= 6 && longer.length >= 6) {
    const tailLen = Math.min(shorter.length, longer.length);
    const tailA = a.slice(-tailLen);
    const tailB = b.slice(-tailLen);
    let diffs = 0;
    for (let i = 0; i < tailLen; i++) {
      if (tailA[i] !== tailB[i]) {
        diffs++;
        if (diffs > 1) break;
      }
    }
    if (diffs === 1 && tailLen >= 7) {
      return 'PARTIAL';
    }
  }

  return 'NONE';
}

export function resolveCanonicalCompanyKey(
  v: Partial<Vehicle>
): 'truckit' | 'docks' | 'muhib' | 'vantage' | 'other' {
  const op = String(v.operatingCompany || '').trim().toLowerCase();
  const name = String(v.companyName || '').trim().toLowerCase();
  const combined = `${op} ${name}`;
  if (combined.includes('truckit') || combined.includes('truck it') || op === 'trk') return 'truckit';
  if (combined.includes('docks') || op === 'dpl') return 'docks';
  if (combined.includes('muhib')) return 'muhib';
  if (combined.includes('vantage') || op === 'vsl') return 'vantage';
  return 'docks';
}

/**
 * Checks if two records have explicitly conflicting (both valid & completely unrelated) Chassis AND Engine numbers.
 */
export function haveConflictingChassisAndEngine(
  a: Partial<Vehicle>,
  b: Partial<Vehicle>
): boolean {
  const chA = normalizeTechNumber(a.chassisNo);
  const chB = normalizeTechNumber(b.chassisNo);
  const enA = normalizeTechNumber(a.engineNo);
  const enB = normalizeTechNumber(b.engineNo);

  // Only consider a hard conflict if BOTH records have valid chassis & engine and NEITHER matches
  if (chA && chB && enA && enB) {
    const chMatch = matchTechNumbers(a.chassisNo, b.chassisNo);
    const enMatch = matchTechNumbers(a.engineNo, b.engineNo);
    return chMatch === 'NONE' && enMatch === 'NONE';
  }
  return false;
}

/**
 * Returns true if two records represent the SAME vehicle across Truckit & Docks with:
 * - Same Registration Number (exact OR base plate + MRA suffix like TLC-880 vs TLC-880LS)
 * - AND matching Chassis & Engine (exact or partial serial match)
 */
export function isSameRegChassisEngineTruckitDocksPair(
  a: Partial<Vehicle>,
  b: Partial<Vehicle>
): boolean {
  const compA = resolveCanonicalCompanyKey(a);
  const compB = resolveCanonicalCompanyKey(b);
  const isTruckitDocks =
    (compA === 'truckit' && compB === 'docks') ||
    (compA === 'docks' && compB === 'truckit');
  if (!isTruckitDocks) return false;

  const pA = extractVehicleBasePlate(a.registrationNumber);
  const pB = extractVehicleBasePlate(b.registrationNumber);
  if (!pA.base || pA.base !== pB.base) return false;

  const chMatch = matchTechNumbers(a.chassisNo, b.chassisNo);
  const enMatch = matchTechNumbers(a.engineNo, b.engineNo);

  if (pA.strict === pB.strict) {
    return !haveConflictingChassisAndEngine(a, b);
  }

  // When plates differ by province suffix (e.g. TLC-880LS vs TLC-880), require strong technical match:
  // Either both match (EXACT/PARTIAL), or one is EXACT and the other isn't conflicting
  if (chMatch !== 'NONE' && enMatch !== 'NONE') return true;
  if (chMatch === 'EXACT' && (!normalizeTechNumber(a.engineNo) || !normalizeTechNumber(b.engineNo))) return true;
  if (enMatch === 'EXACT' && (!normalizeTechNumber(a.chassisNo) || !normalizeTechNumber(b.chassisNo))) return true;

  return false;
}

/**
 * Scores a vehicle to pick the best default "Keep (Primary)" record in a duplicate group:
 * 1. Truckit Private Limited ALWAYS wins over Docks Private Limited per user rule
 * 2. Active / On-Trip status preferred
 * 3. Newer registrationDate / lastRenewalDate preferred (e.g. new Sindh plate over old plate)
 * 4. Uploaded compliance docs & trip history count
 * 5. Complete registration number & longer chassis/engine strings
 */
export function scoreVehicleForKeepPriority(v: Vehicle): number {
  let score = 0;
  const comp = resolveCanonicalCompanyKey(v);
  if (comp === 'truckit') score += 100000;
  else if (comp === 'muhib' || comp === 'vantage') score += 50000;
  else if (comp === 'docks') score += 10000;

  if (v.status === 'ON_TRIP') score += 5000;
  if (v.status === 'AVAILABLE' || v.status === 'CONFIRMED' || v.status === 'RENEWED') score += 3000;

  const dateStr = String(v.lastRenewalDate || v.registrationDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const yearNum = parseInt(dateStr.replace(/-/g, ''), 10);
    if (!isNaN(yearNum)) {
      // Adds ~2018..2027 scaled points (max ~4500) so it never overrides Truckit > Docks (90,000 delta)
      score += Math.max(0, Math.min(4500, Math.round((yearNum - 19900000) / 100)));
    }
  }

  if (v.registrationBook) score += 400;
  if (v.ownerIdCardUrl) score += 400;
  if (v.customsRegCertDoc) score += 300;
  if (Array.isArray(v.tripsHistory) && v.tripsHistory.length > 0) {
    score += Math.min(1500, v.tripsHistory.length * 150);
  }

  score += Math.min(40, normalizeTechNumber(v.chassisNo).length * 2);
  score += Math.min(40, normalizeTechNumber(v.engineNo).length * 2);
  score += Math.min(20, normalizePlateStrict(v.registrationNumber).length);

  return score;
}

function pickRicherTechValue(primaryVal?: string, secondaryVal?: string): string {
  const pClean = String(primaryVal || '').trim();
  const sClean = String(secondaryVal || '').trim();
  const pNorm = normalizeTechNumber(pClean);
  const sNorm = normalizeTechNumber(sClean);

  if (!pNorm && sNorm) return sClean;
  if (pNorm && !sNorm) return pClean;
  if (!pNorm && !sNorm) return pClean || sClean || 'N/A';

  // If secondary has the full manufacturer prefix while primary only had trailing digits (e.g. "10357" vs "CM88WH10357")
  if (sNorm.length > pNorm.length && sNorm.endsWith(pNorm)) {
    return sClean;
  }
  return pClean;
}

/**
 * Losslessly merges one or more duplicate vehicles into the chosen Primary ("Keep") vehicle.
 * Preserves the Primary vehicle's ID, registration plate, and company (or optional targetCompany override),
 * while carrying over any missing documents, full chassis/engine serials, owner/driver info, and trips history.
 */
export function mergeVehicleRecords(
  primary: Vehicle,
  duplicates: Vehicle[],
  options?: {
    targetCompany?: 'KEEP_PRIMARY' | 'truckit' | 'docks';
    recordAuditNote?: boolean;
  }
): Vehicle {
  let result: Vehicle = { ...primary };

  for (const dup of duplicates) {
    if (!dup || dup.id === primary.id) continue;

    const existingTrips = Array.isArray(result.tripsHistory) ? result.tripsHistory : [];
    const dupTrips = Array.isArray(dup.tripsHistory) ? dup.tripsHistory : [];
    const combinedTripsMap = new Map<string, NonNullable<Vehicle['tripsHistory']>[number]>();
    [...existingTrips, ...dupTrips].forEach((tr, idx) => {
      if (!tr) return;
      const key = tr.id || `${tr.caseNo || ''}-${tr.date || ''}-${tr.containerNumber || idx}`;
      if (!combinedTripsMap.has(key)) {
        combinedTripsMap.set(key, tr);
      }
    });

    const existingHistory: VehicleHistory[] = Array.isArray(result.history) ? result.history : [];
    const dupHistory: VehicleHistory[] = Array.isArray(dup.history) ? dup.history : [];
    const historyKeys = new Set(existingHistory.map((h) => `${h.date}_${h.description}`));
    const mergedHistory = [...existingHistory];
    dupHistory.forEach((h) => {
      const k = `${h.date}_${h.description}`;
      if (!historyKeys.has(k)) {
        historyKeys.add(k);
        mergedHistory.push(h);
      }
    });

    if (options?.recordAuditNote !== false) {
      mergedHistory.unshift({
        id: Date.now() + Math.floor(Math.random() * 1000),
        date: new Date().toISOString().slice(0, 10),
        description: `Merged duplicate record ${dup.registrationNumber} (${String(dup.companyName || dup.operatingCompany || 'Fleet').toUpperCase()}) into ${result.registrationNumber}`,
        type: 'STATUS_CHANGE',
      });
    }

    const bestTransporter =
      result.transporterName &&
      result.transporterName !== 'Direct Fleet' &&
      result.transporterName !== 'DIRECT FLEET' &&
      result.transporterName !== 'Direct'
        ? result.transporterName
        : dup.transporterName || result.transporterName || 'DIRECT FLEET';

    result = {
      ...result,
      chassisNo: pickRicherTechValue(result.chassisNo, dup.chassisNo),
      engineNo: pickRicherTechValue(result.engineNo, dup.engineNo),
      maker: result.maker || dup.maker,
      make: result.make || dup.make,
      model: result.model || dup.model,
      makeModel: result.makeModel || dup.makeModel,
      mra: result.mra || dup.mra,
      tareWeight: result.tareWeight || dup.tareWeight,
      weightCapacity: result.weightCapacity || dup.weightCapacity,
      transporterName: bestTransporter,
      brokerName: bestTransporter,
      registrationDate: result.registrationDate || dup.registrationDate,
      validationExpiryDate: result.validationExpiryDate || dup.validationExpiryDate,
      lastRenewalDate: result.lastRenewalDate || dup.lastRenewalDate,
      registrationBook: result.registrationBook || dup.registrationBook,
      registrationBookName: result.registrationBookName || dup.registrationBookName,
      customsRegCertDoc: result.customsRegCertDoc || dup.customsRegCertDoc,
      ownerIdCardUrl: result.ownerIdCardUrl || dup.ownerIdCardUrl,
      ownerIdCardName: result.ownerIdCardName || dup.ownerIdCardName,
      licenseDoc: result.licenseDoc || dup.licenseDoc,
      driverCnicDoc: result.driverCnicDoc || dup.driverCnicDoc,
      driverCnicDocName: result.driverCnicDocName || dup.driverCnicDocName,
      photo: result.photo || dup.photo,
      ownerName: result.ownerName || dup.ownerName,
      ownerFatherName: result.ownerFatherName || dup.ownerFatherName,
      ownerCnic: result.ownerCnic || dup.ownerCnic,
      ownerAddress: result.ownerAddress || dup.ownerAddress,
      driverName: result.driverName || dup.driverName || '',
      driverCnic: result.driverCnic || dup.driverCnic || '',
      driverContact: result.driverContact || dup.driverContact || '',
      tripsHistory: Array.from(combinedTripsMap.values()),
      history: mergedHistory,
    };
  }

  if (options?.targetCompany === 'truckit') {
    result.operatingCompany = 'truckit';
    result.companyName = 'TRUCKIT PVT LTD';
  } else if (options?.targetCompany === 'docks') {
    result.operatingCompany = 'docks';
    result.companyName = 'DOCKS PVT LTD';
  }

  return result;
}

/**
 * Scans the entire fleet list in O(N) using hash buckets + Disjoint Set (Union-Find)
 * to discover all exact, cross-company, re-registered (Chassis+Engine), and suffix-plate duplicate groups.
 */
export function detectDuplicateVehicleGroups(vehicles: Vehicle[]): DuplicateVehicleGroup[] {
  const n = vehicles.length;
  if (n < 2) return [];

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    let curr = x;
    while (curr !== root) {
      const nxt = parent[curr];
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  };

  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const strictPlates = new Array<string>(n);
  const basePlates = new Array<string>(n);
  const normChassis = new Array<string>(n);
  const normEngines = new Array<string>(n);

  const byStrictPlate = new Map<string, number[]>();
  const byBasePlate = new Map<string, number[]>();
  const byChassisAndEngine = new Map<string, number[]>();
  const byLongChassis = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const v = vehicles[i];
    const plateInfo = extractVehicleBasePlate(v.registrationNumber);
    const ch = normalizeTechNumber(v.chassisNo);
    const en = normalizeTechNumber(v.engineNo);

    strictPlates[i] = plateInfo.strict;
    basePlates[i] = plateInfo.base;
    normChassis[i] = ch;
    normEngines[i] = en;

    if (plateInfo.strict) {
      let arr = byStrictPlate.get(plateInfo.strict);
      if (!arr) {
        arr = [];
        byStrictPlate.set(plateInfo.strict, arr);
      }
      arr.push(i);
    }

    if (plateInfo.base) {
      let arr = byBasePlate.get(plateInfo.base);
      if (!arr) {
        arr = [];
        byBasePlate.set(plateInfo.base, arr);
      }
      arr.push(i);
    }

    if (ch && en) {
      const ceKey = `${ch}__${en}`;
      let arr = byChassisAndEngine.get(ceKey);
      if (!arr) {
        arr = [];
        byChassisAndEngine.set(ceKey, arr);
      }
      arr.push(i);
    }

    if (ch && ch.length >= 7) {
      let arr = byLongChassis.get(ch);
      if (!arr) {
        arr = [];
        byLongChassis.set(ch, arr);
      }
      arr.push(i);
    }
  }

  // 1. Exact registration number matches
  byStrictPlate.forEach((indices) => {
    for (let k = 1; k < indices.length; k++) {
      union(indices[0], indices[k]);
    }
  });

  // 2. Exact normalized Chassis + Engine matches (catches re-registered plates & cross-company duplicates)
  byChassisAndEngine.forEach((indices) => {
    if (indices.length > 1 && indices.length <= 10) {
      for (let k = 1; k < indices.length; k++) {
        union(indices[0], indices[k]);
      }
    }
  });

  // 3. Long Chassis (>= 7 chars) matches
  byLongChassis.forEach((indices) => {
    if (indices.length > 1 && indices.length <= 8) {
      for (let k = 1; k < indices.length; k++) {
        union(indices[0], indices[k]);
      }
    }
  });

  // 4. Same Base Plate (e.g. TLC-880 vs TLC-880LS)
  byBasePlate.forEach((indices) => {
    if (indices.length > 1 && indices.length <= 8) {
      for (let k = 1; k < indices.length; k++) {
        union(indices[0], indices[k]);
      }
    }
  });

  // Collect connected components of size >= 2
  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let comp = components.get(r);
    if (!comp) {
      comp = [];
      components.set(r, comp);
    }
    comp.push(i);
  }

  const categoryOrder: Record<DuplicateMatchCategory, number> = {
    EXACT_TRI_MATCH: 1,
    CROSS_COMPANY_CE_MATCH: 2,
    SAME_CHASSIS_AND_ENGINE: 3,
    SAME_CHASSIS_ONLY: 4,
    SAME_BASE_PLATE_DIFF_TECH: 5,
  };

  const groups: DuplicateVehicleGroup[] = [];

  components.forEach((indices) => {
    if (indices.length < 2) return;

    const groupVehicles = indices
      .map((idx) => vehicles[idx])
      .sort((a, b) => scoreVehicleForKeepPriority(b) - scoreVehicleForKeepPriority(a));

    const recommendedKeepId = groupVehicles[0].id;

    const companySet = new Set(groupVehicles.map((v) => resolveCanonicalCompanyKey(v)));
    const isCrossCompanyTruckitDocks = companySet.has('truckit') && companySet.has('docks');

    // Analyze pairwise similarity within the group
    let hasStrictPlateMatch = false;
    let hasBasePlateMatch = false;
    let hasChassisMatch = false;
    let hasEngineMatch = false;
    let hasBothTechMatch = false;

    for (let i = 0; i < groupVehicles.length; i++) {
      for (let j = i + 1; j < groupVehicles.length; j++) {
        const A = groupVehicles[i];
        const B = groupVehicles[j];
        const pA = extractVehicleBasePlate(A.registrationNumber);
        const pB = extractVehicleBasePlate(B.registrationNumber);
        const chM = matchTechNumbers(A.chassisNo, B.chassisNo);
        const enM = matchTechNumbers(A.engineNo, B.engineNo);

        if (pA.strict && pA.strict === pB.strict) hasStrictPlateMatch = true;
        if (pA.base && pA.base === pB.base) hasBasePlateMatch = true;
        if (chM !== 'NONE') hasChassisMatch = true;
        if (enM !== 'NONE') hasEngineMatch = true;
        if (chM !== 'NONE' && enM !== 'NONE') hasBothTechMatch = true;
      }
    }

    const plateMatch: 'EXACT' | 'BASE_SUFFIX' | 'DIFFERENT' = hasStrictPlateMatch
      ? 'EXACT'
      : hasBasePlateMatch
      ? 'BASE_SUFFIX'
      : 'DIFFERENT';

    let category: DuplicateMatchCategory;
    let categoryLabel: string;
    let matchReason: string;
    let confidence: 'HIGH' | 'MEDIUM' | 'REVIEW';

    if (hasBasePlateMatch && (hasBothTechMatch || (hasStrictPlateMatch && !haveConflictingChassisAndEngine(groupVehicles[0], groupVehicles[1])) || (hasChassisMatch && isCrossCompanyTruckitDocks))) {
      category = 'EXACT_TRI_MATCH';
      categoryLabel = 'Same Reg + Chassis + Engine';
      matchReason =
        plateMatch === 'EXACT'
          ? 'Exact same Registration No, Chassis & Engine'
          : 'Same Registration No (with City/MRA code) + Matching Chassis & Engine';
      confidence = 'HIGH';
    } else if (hasBothTechMatch && isCrossCompanyTruckitDocks) {
      category = 'CROSS_COMPANY_CE_MATCH';
      categoryLabel = 'Truckit vs Docks (Same Chassis & Engine)';
      matchReason = 'Identical Chassis & Engine in both Truckit and Docks (Re-registered / Updated Plate)';
      confidence = 'HIGH';
    } else if (hasBothTechMatch) {
      category = 'SAME_CHASSIS_AND_ENGINE';
      categoryLabel = 'Same Chassis & Engine (Re-Registered Plate)';
      matchReason = '100% Identical Chassis & Engine numbers under old & new registration plates';
      confidence = 'HIGH';
    } else if (hasChassisMatch) {
      category = 'SAME_CHASSIS_ONLY';
      categoryLabel = 'Same Chassis Number (Verify Engine)';
      matchReason = 'Identical Chassis number with different Engine number (possible engine swap or typo)';
      confidence = 'MEDIUM';
    } else {
      category = 'SAME_BASE_PLATE_DIFF_TECH';
      categoryLabel = 'Similar Plate Suffix (Different Chassis/Engine)';
      matchReason = 'Same base plate digits with city suffix, but different Chassis & Engine — verify before merging';
      confidence = 'REVIEW';
    }

    const stableIdsKey = groupVehicles
      .map((v) => v.id)
      .sort((a, b) => a - b)
      .join('_');

    groups.push({
      groupId: `dup_${stableIdsKey}`,
      category,
      categoryLabel,
      matchReason,
      confidence,
      isCrossCompanyTruckitDocks,
      vehicles: groupVehicles,
      recommendedKeepId,
      chassisMatch: hasChassisMatch,
      engineMatch: hasEngineMatch,
      plateMatch,
    });
  });

  return groups.sort((a, b) => {
    if (a.isCrossCompanyTruckitDocks !== b.isCrossCompanyTruckitDocks) {
      // Among HIGH confidence groups, surface Truckit-vs-Docks first
      if (a.confidence === 'HIGH' && b.confidence === 'HIGH') {
        return a.isCrossCompanyTruckitDocks ? -1 : 1;
      }
    }
    const orderDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (orderDiff !== 0) return orderDiff;
    return String(a.vehicles[0]?.registrationNumber || '').localeCompare(
      String(b.vehicles[0]?.registrationNumber || '')
    );
  });
}

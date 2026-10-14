import { CaseCharge, Client, ClientDefaultCharge } from '../types';
import { saveClientToFirestore } from './dbService';

export interface ServiceArrangementItem {
  label: string;
  arrangedBy: 'DPL' | 'Client';
  amount: number;
  category?: string;
  isDefaultDpl?: boolean;
}

/**
 * Category-specific Operational Service Arrangements & Default Tariffs.
 * Defined strictly according to company operational guidelines:
 * 
 * 1. Bonded Carrier: TP charges by default (DPL). Loading, dry port DO, unloading, seal, vehicle rent, vehicle detention as per requirement.
 * 2. Afghan Transit: Manifest, loading, seal, border clearance, convoy, service charges, sales tax SRB, NLC, insurance as per requirement.
 * 3. Import Export Services: Vessel, container, customs clearance, service charges, sales tax SRB, NLC, insurance as per requirement.
 * 4. Private Cargo: Loading charges & unloading charges by default (DPL).
 * 5. TIR: Zero default charges (all as per requirement).
 * 6. Customs Clearance: Service charges, loading charges, unloading charges by default (DPL).
 */
export const CATEGORY_SERVICE_ARRANGEMENTS: Record<string, Record<string, ServiceArrangementItem>> = {
  "Bonded Carrier": {
    loading_charges: { label: 'Loading / Labor Handling Charges', arrangedBy: 'Client', amount: 0 },
    do_charges: { label: 'Shipping Line Delivery Order (DO) Charges', arrangedBy: 'Client', amount: 0 },
    security_deposit: { label: 'DO Security Deposit / Guarantee', arrangedBy: 'Client', amount: 0 },
    dryport_do_charges: { label: 'Dry Port Delivery Order (DO) Charges', arrangedBy: 'Client', amount: 0 },
    unloading_charges: { label: 'Unloading / Offloading Charges', arrangedBy: 'Client', amount: 0 },
    seal_charges: { label: 'Customs Bullet Seal & E-Seal Tracking Fee', arrangedBy: 'Client', amount: 0 },
    vehicle_rent: { label: 'Vehicle Rent / Transporter Freight', arrangedBy: 'Client', amount: 0 },
    vehicle_detention: { label: 'Vehicle Detention / Waiting Surcharge', arrangedBy: 'Client', amount: 0 },
    wharfage_charges: { label: 'Wharfage Terminal & Port Dues', arrangedBy: 'Client', amount: 0 }
  },

  "Afghan Transit": {
    manifest_charges: { label: 'Transit Manifest Charges (AT-GD WeBOC)', arrangedBy: 'Client', amount: 0 },
    loading_charges: { label: 'Loading / Port Handling Charges', arrangedBy: 'Client', amount: 0 },
    seal_charges: { label: 'Customs Bullet Seal & Satellite Tracker Device', arrangedBy: 'Client', amount: 0 },
    border_clearance_charges: { label: 'Border Clearance Charges (Torkham / Chaman)', arrangedBy: 'Client', amount: 0 },
    convoy_charges: { label: 'Convoy Charges (Customs Armed Escort)', arrangedBy: 'Client', amount: 0 },
    service_charges: { label: 'Service Charges (Transit Agency & Formalities)', arrangedBy: 'Client', amount: 0 },
    sales_tax_srb: { label: 'Sales Tax / SRB Tax Assessment', arrangedBy: 'Client', amount: 0 },
    nlc_charges: { label: 'NLC Terminal & Weighbridge Charges', arrangedBy: 'Client', amount: 0 },
    insurance_charges: { label: 'Insurance Charges (Cross-Border Transit Policy)', arrangedBy: 'Client', amount: 0 },
    vehicle_rent: { label: 'Vehicle Rent / Cross-Border Heavy Freight', arrangedBy: 'Client', amount: 0 },
    vehicle_detention: { label: 'Vehicle Detention / Demurrage Charges', arrangedBy: 'Client', amount: 0 }
  },

  "Import & Export Services": {
    vessel_charges: { label: 'Vessel Charges (Ocean Freight / Slot Booking)', arrangedBy: 'Client', amount: 0 },
    container_charges: { label: 'Container Charges (CRO & Empty Allocation)', arrangedBy: 'Client', amount: 0 },
    customs_clearance_charges: { label: 'Customs Clearance Charges (GD Assessment & OOC)', arrangedBy: 'Client', amount: 0 },
    service_charges: { label: 'Service Charges (Agency & Documentation)', arrangedBy: 'Client', amount: 0 },
    sales_tax_srb: { label: 'Sales Tax / SRB Tax Assessment', arrangedBy: 'Client', amount: 0 },
    nlc_charges: { label: 'NLC / Terminal Staging Charges', arrangedBy: 'Client', amount: 0 },
    insurance_charges: { label: 'Insurance Charges (Marine Cargo Transit)', arrangedBy: 'Client', amount: 0 },
    vgm_charges: { label: 'SOLAS VGM Weighbridge & Terminal Staging', arrangedBy: 'Client', amount: 0 },
    delivery_order: { label: 'Shipping Line Delivery Order (DO) Fee', arrangedBy: 'Client', amount: 0 }
  },

  "Transportation of Private Cargo": {
    loading_charges: { label: 'Loading / Labor Handling Charges', arrangedBy: 'DPL', amount: 0, isDefaultDpl: true },
    unloading_charges: { label: 'Unloading / Offloading Charges', arrangedBy: 'DPL', amount: 0, isDefaultDpl: true },
    vehicle_rent: { label: 'Vehicle Rent / Inland Truck Freight', arrangedBy: 'Client', amount: 0 },
    builty_charges: { label: 'Builty / Consignment Note Documentation Fee', arrangedBy: 'Client', amount: 0 },
    transit_toll: { label: 'Transit Toll & Weigh Station Charges', arrangedBy: 'Client', amount: 0 },
    insurance_charges: { label: 'Cargo Transit Insurance Surcharge', arrangedBy: 'Client', amount: 0 },
    vehicle_detention: { label: 'Vehicle Detention / Waiting Charges', arrangedBy: 'Client', amount: 0 }
  },

  "TIR": {
    tir_carnet_charges: { label: 'TIR Carnet Administration Charges', arrangedBy: 'Client', amount: 0 },
    border_escort_charges: { label: 'Border Customs Escort & E-Seal Endorsement', arrangedBy: 'Client', amount: 0 },
    transit_toll_charges: { label: 'International Transit Tolls & Route Permits', arrangedBy: 'Client', amount: 0 },
    loading_charges: { label: 'Loading & Securing Charges', arrangedBy: 'Client', amount: 0 },
    unloading_charges: { label: 'Destination Unloading Charges', arrangedBy: 'Client', amount: 0 },
    freight_charges: { label: 'International Road Haulage / Freight', arrangedBy: 'Client', amount: 0 }
  },

  "Customs Clearance": {
    service_charges: { label: 'Customs Agency Service Charges / Commission', arrangedBy: 'DPL', amount: 0, isDefaultDpl: true },
    loading_charges: { label: 'Terminal / Port Loading Charges', arrangedBy: 'DPL', amount: 0, isDefaultDpl: true },
    unloading_charges: { label: 'Destuffing / Examination Unloading Charges', arrangedBy: 'DPL', amount: 0, isDefaultDpl: true },
    weboc_psw_charges: { label: 'WeBOC / PSW Electronic Declaration Fee', arrangedBy: 'Client', amount: 0 },
    customs_examination_charges: { label: 'Customs Examination Surcharge', arrangedBy: 'Client', amount: 0 },
    wharfage_charges: { label: 'Port Wharfage & Terminal Handling Dues', arrangedBy: 'Client', amount: 0 },
    delivery_order_charges: { label: 'Shipping Line Delivery Order (DO) Fee', arrangedBy: 'Client', amount: 0 },
    sindh_excise_cess: { label: 'Sindh Infrastructure Cess / Excise Challan', arrangedBy: 'Client', amount: 0 }
  },

  "ISO Tank Service": {
    iso_freight: { label: 'Specialized ISO Tank Haulage', arrangedBy: 'Client', amount: 0 },
    hazmat_safety: { label: 'IMO Hazmat Placarding & Emergency Response', arrangedBy: 'Client', amount: 0 },
    valve_inspection: { label: 'Pre-Trip Valve & Pressure Gauge Certification', arrangedBy: 'Client', amount: 0 },
    terminal_stevedoring: { label: 'Dangerous Goods Port Stevedoring', arrangedBy: 'Client', amount: 0 }
  },

  "Car Carrier": {
    vehicle_haulage: { label: 'Multi-Vehicle Auto Carrier Haulage', arrangedBy: 'Client', amount: 0 },
    condition_survey: { label: 'Pre-Loading Scratch & Condition Audit', arrangedBy: 'Client', amount: 0 },
    transit_insurance: { label: 'En-route Vehicle Transit Insurance', arrangedBy: 'Client', amount: 0 },
    ramp_handling: { label: 'Ramp Loading & Wheel Strapping Fee', arrangedBy: 'Client', amount: 0 }
  },

  "Liner & NVOCC": {
    ocean_freight: { label: 'Ocean Freight & Feeder Slot Allocation', arrangedBy: 'Client', amount: 0 },
    thc_charges: { label: 'Terminal Handling Charges (THC)', arrangedBy: 'Client', amount: 0 },
    line_do: { label: 'Shipping Line Delivery Order (DO) & Manifest Fee', arrangedBy: 'Client', amount: 0 },
    security_deposit: { label: 'Container Security Deposit Administration', arrangedBy: 'Client', amount: 0 }
  },

  "Breakbulk/Chartering Services": {
    heavy_haulage: { label: 'Hydraulic Multi-Axle Modular Haulage', arrangedBy: 'Client', amount: 0 },
    stevedoring_crane: { label: 'Port Stevedoring & Shore Crane Rigging', arrangedBy: 'Client', amount: 0 },
    nha_escort: { label: 'NHA Route Permit & Heavy Escort Surcharge', arrangedBy: 'Client', amount: 0 },
    marine_lashing: { label: 'Marine Lashing & Technical Survey', arrangedBy: 'Client', amount: 0 }
  },

  "Warehousing & Distribution": {
    bonded_storage: { label: 'Bonded Warehouse Storage Rental', arrangedBy: 'Client', amount: 0 },
    destuffing_pallet: { label: 'Container De-stuffing & Palletization', arrangedBy: 'Client', amount: 0 },
    gate_pass_admin: { label: 'Into-Bond / Ex-Bond Documentation Fee', arrangedBy: 'Client', amount: 0 },
    stock_insurance: { label: 'Warehouse Fire & Stock Insurance', arrangedBy: 'Client', amount: 0 }
  }
};

/**
 * Normalizes category name to key in CATEGORY_SERVICE_ARRANGEMENTS.
 */
export function normalizeCategoryKey(category: string): string {
  const norm = (category || '').toLowerCase();
  if (norm.includes('bonded')) return 'Bonded Carrier';
  if (norm.includes('afghan') || (norm.includes('transit') && !norm.includes('customs'))) return 'Afghan Transit';
  if (norm.includes('import') || norm.includes('export')) return 'Import & Export Services';
  if (norm.includes('private') || norm.includes('cargo') || norm.includes('domestic')) return 'Transportation of Private Cargo';
  if (norm.includes('tir')) return 'TIR';
  if (norm.includes('clearance')) return 'Customs Clearance';
  if (norm.includes('tank') || norm.includes('iso')) return 'ISO Tank Service';
  if (norm.includes('car')) return 'Car Carrier';
  if (norm.includes('liner') || norm.includes('nvocc')) return 'Liner & NVOCC';
  if (norm.includes('breakbulk')) return 'Breakbulk/Chartering Services';
  if (norm.includes('warehouse')) return 'Warehousing & Distribution';
  return 'Bonded Carrier';
}

/**
 * Checks whether a string is one of the 11 known Case Categories.
 */
export function isKnownCaseCategory(cat?: string): boolean {
  if (!cat) return false;
  const trimmed = cat.trim();
  if (Object.prototype.hasOwnProperty.call(CATEGORY_SERVICE_ARRANGEMENTS, trimmed)) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower.includes('bonded carrier') ||
    lower.includes('afghan transit') ||
    lower.includes('import & export') ||
    lower.includes('private cargo') ||
    lower === 'tir' ||
    lower.includes('customs clearance') ||
    lower.includes('iso tank') ||
    lower.includes('car carrier') ||
    lower.includes('liner & nvocc') ||
    lower.includes('breakbulk') ||
    lower.includes('warehousing')
  );
}

/**
 * Resolves the exact Case Category that a ClientDefaultCharge belongs to.
 * Supports explicit `caseCategory`, valid `category` values, or falls back to the client's primary category.
 */
export function getChargeCaseCategory(ch: ClientDefaultCharge, clientDefaultCategory?: string): string {
  if (ch.caseCategory && isKnownCaseCategory(ch.caseCategory)) {
    return normalizeCategoryKey(ch.caseCategory);
  }
  if (ch.category && isKnownCaseCategory(ch.category)) {
    return normalizeCategoryKey(ch.category);
  }
  return normalizeCategoryKey(clientDefaultCategory || 'Bonded Carrier');
}

/**
 * Smart matcher between a charge description/head and a service arrangement key/label.
 */
export function doesChargeMatchArrangement(chargeDesc: string, arrKey: string, arrLabel: string): boolean {
  const c = (chargeDesc || '').toLowerCase().trim();
  const k = (arrKey || '').toLowerCase().trim();
  const l = (arrLabel || '').toLowerCase().trim();
  if (!c) return false;
  if (c === l || c.includes(l) || l.includes(c)) return true;

  if ((k.includes('do_charges') || k === 'delivery_order' || k === 'delivery_order_charges' || k === 'line_do') &&
      (c.includes('delivery order') || c.includes('do charges') || c === 'do fee') && !c.includes('dry port') && !c.includes('deposit')) {
    return true;
  }
  if (k.includes('dryport_do') && c.includes('dry port') && (c.includes('do') || c.includes('delivery order'))) {
    return true;
  }
  if (k.includes('security_deposit') && (c.includes('do deposit') || c.includes('security deposit'))) {
    return true;
  }
  if ((k.includes('loading_charges') || k === 'loading_unloading') && c.includes('loading') && !c.includes('unloading')) {
    return true;
  }
  if (k.includes('unloading_charges') && c.includes('unloading')) {
    return true;
  }
  if (k.includes('seal_charges') && (c.includes('seal') || c.includes('tracker') || c.includes('tracking'))) {
    return true;
  }
  if ((k.includes('vehicle_rent') || k.includes('freight') || k.includes('haulage')) &&
      (c.includes('vehicle rent') || c.includes('freight') || c.includes('haulage'))) {
    return true;
  }
  if (k.includes('vehicle_detention') && (c.includes('detention') || c.includes('demurrage'))) {
    return true;
  }
  if ((k.includes('wharfage') || k.includes('thc')) && (c.includes('wharfage') || c.includes('thc'))) {
    return true;
  }
  if (k.includes('excise') && c.includes('excise')) {
    return true;
  }
  if (k.includes('manifest') && c.includes('manifest')) {
    return true;
  }
  if (k.includes('tir') && c.includes('tir')) {
    return true;
  }
  return false;
}

/**
 * Returns the default service arrangements structure for a category.
 */
export function getCategoryArrangements(category: string): Record<string, ServiceArrangementItem> {
  const key = normalizeCategoryKey(category);
  const found = CATEGORY_SERVICE_ARRANGEMENTS[key];
  if (found) {
    // Return a fresh deep clone
    return JSON.parse(JSON.stringify(found));
  }
  return JSON.parse(JSON.stringify(CATEGORY_SERVICE_ARRANGEMENTS['Bonded Carrier']));
}

/**
 * Generates CaseCharge array from service arrangements where arrangedBy === 'DPL' and amount > 0.
 */
export function getArrangementCharges(arrangements: Record<string, ServiceArrangementItem>): CaseCharge[] {
  return Object.entries(arrangements)
    .filter(([_, item]) => item.arrangedBy === 'DPL' && Number(item.amount) > 0)
    .map(([key, item]) => ({
      id: `ch_arr_${key}`,
      syncKey: key,
      description: item.label,
      amount: Number(item.amount),
      arrangedBy: 'DPL',
      taxable: true
    }));
}

/**
 * Core Category-Wise Client Default Charges Resolver:
 * - Default charges are stored per Client AND per Case Category.
 * - When a client is added, a Primary Case Category is selected (since most of that client's cases belong to that category)
 *   and default charges are saved with user-entered amounts for that category.
 * - When registering a case for that client in that category, those default charges automatically apply.
 * - If the Case Category is changed to another category, default charges from the previous category do NOT apply;
 *   only default charges saved specifically for the new category apply (or Nil/empty if none are saved yet for that category,
 *   requiring fresh entry — and any charge ticked as "Save as Default" in the new category is saved for that new category!).
 */
export function resolveCaseCharges(
  client: Client | undefined,
  category: string,
  existingArrangements?: Record<string, ServiceArrangementItem>
): {
  arrangements: Record<string, ServiceArrangementItem>;
  charges: CaseCharge[];
  isClientCustomDefault: boolean;
  clientName?: string;
} {
  const targetNormCat = normalizeCategoryKey(category || client?.defaultCaseCategory || 'Bonded Carrier');
  const clientPrimaryCat = normalizeCategoryKey(client?.defaultCaseCategory || 'Bonded Carrier');
  const baseArrangements = getCategoryArrangements(targetNormCat);
  const mergedArrangements: Record<string, ServiceArrangementItem> = {
    ...baseArrangements,
    ...(existingArrangements || {})
  };

  // Apply client's saved service arrangements for THIS specific category
  const catSavedArrangements =
    client?.categoryServiceArrangements?.[targetNormCat] ||
    (targetNormCat === clientPrimaryCat ? client?.defaultServiceArrangements : undefined);

  if (catSavedArrangements) {
    Object.entries(catSavedArrangements).forEach(([k, arrangedBy]) => {
      if (mergedArrangements[k]) {
        mergedArrangements[k].arrangedBy = arrangedBy;
      }
    });
  }

  // Filter client's defaultCharges strictly by the target Case Category and amount > 0
  const categorySpecificDefaults = (client?.defaultCharges || []).filter(ch => {
    const chCat = getChargeCaseCategory(ch, client?.defaultCaseCategory);
    return chCat === targetNormCat && (Number(ch.defaultAmount) || 0) > 0;
  });

  if (categorySpecificDefaults.length > 0) {
    const clientCharges: CaseCharge[] = categorySpecificDefaults.map((ch, idx) => ({
      id: ch.id || `ch_clt_${Date.now()}_${idx}`,
      category: targetNormCat,
      description: ch.description,
      amount: Number(ch.defaultAmount) || 0,
      taxable: ch.taxable ?? false,
      arrangedBy: 'DPL'
    }));

    // Synchronize matching operational service arrangement items for this category
    Object.keys(mergedArrangements).forEach((k) => {
      const arr = mergedArrangements[k];
      const match = clientCharges.find(c => doesChargeMatchArrangement(c.description, k, arr.label));
      if (match) {
        mergedArrangements[k].arrangedBy = 'DPL';
        mergedArrangements[k].amount = match.amount;
        (match as any).syncKey = k;
      }
    });

    return {
      arrangements: mergedArrangements,
      charges: clientCharges,
      isClientCustomDefault: true,
      clientName: client?.name
    };
  }

  // If no default charges exist for this client in this specific category, return Nil (empty charges)
  const categoryCharges = getArrangementCharges(mergedArrangements);

  return {
    arrangements: mergedArrangements,
    charges: categoryCharges,
    isClientCustomDefault: false,
    clientName: client?.name
  };
}

/**
 * Saves a charge permanently as a default charge for a client under the specified Case Category in Firestore.
 * Ensures that this charge & amount will automatically apply to all future cases of this specific category for this client.
 */
export async function saveChargeAsClientDefault(
  client: Client,
  charge: {
    description: string;
    amount: number;
    category?: string;
    caseCategory?: string;
    chargeHead?: string;
    taxable?: boolean;
  }
): Promise<Client> {
  const existingDefaults = client.defaultCharges ? [...client.defaultCharges] : [];
  const cleanDesc = charge.description.trim();
  const targetCaseCategory = normalizeCategoryKey(
    charge.caseCategory ||
    (isKnownCaseCategory(charge.category) ? charge.category! : (client.defaultCaseCategory || 'Bonded Carrier'))
  );

  // Match by BOTH description AND Case Category so each category maintains its own independent default tariff
  const existingIdx = existingDefaults.findIndex(d => {
    const dCat = getChargeCaseCategory(d, client.defaultCaseCategory);
    return d.description.toLowerCase() === cleanDesc.toLowerCase() && dCat === targetCaseCategory;
  });

  const newDefaultCharge: ClientDefaultCharge = {
    id: existingIdx >= 0 ? existingDefaults[existingIdx].id : `clt_def_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    category: targetCaseCategory,
    caseCategory: targetCaseCategory,
    chargeHead: charge.chargeHead || (!isKnownCaseCategory(charge.category) && charge.category ? charge.category : 'Customs / Transit'),
    description: cleanDesc,
    defaultAmount: Number(charge.amount) || 0,
    taxable: charge.taxable ?? false
  };

  if (existingIdx >= 0) {
    existingDefaults[existingIdx] = newDefaultCharge;
  } else {
    existingDefaults.push(newDefaultCharge);
  }

  const updatedClient: Client = {
    ...client,
    defaultCharges: existingDefaults
  };

  await saveClientToFirestore(updatedClient);
  return updatedClient;
}

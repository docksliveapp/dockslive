import { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { safeAppStorage } from './storage';
import { CompanyId, GROUP_COMPANIES, resolveCompanyIdFromRef } from './companyService';
import {
  saveDocumentToCloudChunks,
  saveDocumentToIndexedDB,
  resolveStoredDocumentDataUrl
} from './documentStorage';
import { Vehicle } from '../types';

export interface WitnessSignatory {
  slot: 1 | 2;
  name: string;
  fatherName: string;
  cnic: string;
  mobile: string;
  cnicFrontUrl?: string;
  cnicFrontName?: string;
  cnicBackUrl?: string;
  cnicBackName?: string;
}

export interface CompanyOwnerSignatory {
  companyId: CompanyId;
  name: string;
  fatherName: string;
  cnic: string;
  address: string;
  mobile: string;
  designation: string;
  cnicFrontUrl?: string;
  cnicFrontName?: string;
  cnicBackUrl?: string;
  cnicBackName?: string;
  updatedAt?: string;
}

export interface VehicleLegalSignatoriesState {
  witnesses: [WitnessSignatory, WitnessSignatory];
  companyOwners: Record<CompanyId, CompanyOwnerSignatory>;
  updatedAt?: string;
}

const STORAGE_KEY = 'mak_vehicle_legal_signatories_v1';
const LEGACY_COMPANY_OWNER_KEY = 'dpl_company_owner_id_docs_v1';
const LEGACY_WITNESSES_KEY = 'dpl_witnesses_id_docs_v1';
const SIGNATORIES_EVENT = 'mak_vehicle_legal_signatories_changed';
const INLINE_URL_MAX_CHARS = 120000; // Offload >120KB images to Firestore document_chunks

export const ALL_FOUR_COMPANY_IDS: CompanyId[] = ['docks', 'truckit', 'muhib', 'vantage'];

export const DEFAULT_WITNESSES: [WitnessSignatory, WitnessSignatory] = [
  {
    slot: 1,
    name: 'MUHAMMAD ARBAZ',
    fatherName: '',
    cnic: '42501-8622219-9',
    mobile: '',
    cnicFrontUrl: '',
    cnicBackUrl: ''
  },
  {
    slot: 2,
    name: 'SHAMS TABREZ BUKHARI',
    fatherName: '',
    cnic: '42301-1305414-3',
    mobile: '',
    cnicFrontUrl: '',
    cnicBackUrl: ''
  }
];

function createDefaultCompanyOwner(companyId: CompanyId): CompanyOwnerSignatory {
  const info = GROUP_COMPANIES[companyId];
  const defaultDirector =
    info?.directorName && info.directorName.toLowerCase() !== 'director'
      ? info.directorName
      : '';
  return {
    companyId,
    name: defaultDirector,
    fatherName: '',
    cnic: '',
    address: info?.address || 'Office No. 13, 1st Floor, State Life Building No. 7, G-Allana Road Tower, Karachi',
    mobile: info?.cell?.split(',')[0]?.trim() || '',
    designation: info?.directorTitle || 'Director',
    cnicFrontUrl: '',
    cnicBackUrl: ''
  };
}

function buildInitialState(): VehicleLegalSignatoriesState {
  const defaultState: VehicleLegalSignatoriesState = {
    witnesses: [{ ...DEFAULT_WITNESSES[0] }, { ...DEFAULT_WITNESSES[1] }],
    companyOwners: {
      docks: createDefaultCompanyOwner('docks'),
      truckit: createDefaultCompanyOwner('truckit'),
      muhib: createDefaultCompanyOwner('muhib'),
      vantage: createDefaultCompanyOwner('vantage')
    }
  };

  try {
    // Migrate legacy local entries if available
    const legacyOwners = safeAppStorage.getRawJSON<Record<string, any>>(LEGACY_COMPANY_OWNER_KEY, {});
    if (legacyOwners && typeof legacyOwners === 'object') {
      ALL_FOUR_COMPANY_IDS.forEach((cid) => {
        const leg = legacyOwners[cid];
        if (leg && typeof leg === 'object') {
          defaultState.companyOwners[cid] = {
            ...defaultState.companyOwners[cid],
            name: leg.ownerName || defaultState.companyOwners[cid].name,
            cnic: leg.ownerCnic || defaultState.companyOwners[cid].cnic,
            cnicFrontUrl: leg.frontUrl || defaultState.companyOwners[cid].cnicFrontUrl,
            cnicFrontName: leg.fileName || defaultState.companyOwners[cid].cnicFrontName
          };
        }
      });
    }

    const legacyWits = safeAppStorage.getRawJSON<any>(LEGACY_WITNESSES_KEY, {});
    if (legacyWits && typeof legacyWits === 'object') {
      if (legacyWits.w1Url) {
        defaultState.witnesses[0].cnicFrontUrl = legacyWits.w1Url;
        defaultState.witnesses[0].cnicFrontName = legacyWits.w1Name || 'Witness_1_CNIC';
      }
      if (legacyWits.w2Url) {
        defaultState.witnesses[1].cnicFrontUrl = legacyWits.w2Url;
        defaultState.witnesses[1].cnicFrontName = legacyWits.w2Name || 'Witness_2_CNIC';
      }
    }

    const stored = safeAppStorage.getRawJSON<Partial<VehicleLegalSignatoriesState>>(STORAGE_KEY, {});
    return normalizeSignatoriesState(stored, defaultState);
  } catch (err) {
    console.warn('Signatories state init warning:', err);
    return defaultState;
  }
}

function normalizeSignatoriesState(
  raw: Partial<VehicleLegalSignatoriesState> | undefined | null,
  fallbackBase?: VehicleLegalSignatoriesState
): VehicleLegalSignatoriesState {
  const base: VehicleLegalSignatoriesState = fallbackBase || {
    witnesses: [{ ...DEFAULT_WITNESSES[0] }, { ...DEFAULT_WITNESSES[1] }],
    companyOwners: {
      docks: createDefaultCompanyOwner('docks'),
      truckit: createDefaultCompanyOwner('truckit'),
      muhib: createDefaultCompanyOwner('muhib'),
      vantage: createDefaultCompanyOwner('vantage')
    }
  };

  if (!raw || typeof raw !== 'object') return base;

  const rawWits = Array.isArray(raw.witnesses) ? raw.witnesses : [];
  const w1: WitnessSignatory = {
    ...base.witnesses[0],
    ...(rawWits[0] || {}),
    slot: 1,
    name: String(rawWits[0]?.name ?? base.witnesses[0].name).trim(),
    fatherName: String(rawWits[0]?.fatherName ?? base.witnesses[0].fatherName).trim(),
    cnic: String(rawWits[0]?.cnic ?? base.witnesses[0].cnic).trim(),
    mobile: String(rawWits[0]?.mobile ?? base.witnesses[0].mobile).trim()
  };
  const w2: WitnessSignatory = {
    ...base.witnesses[1],
    ...(rawWits[1] || {}),
    slot: 2,
    name: String(rawWits[1]?.name ?? base.witnesses[1].name).trim(),
    fatherName: String(rawWits[1]?.fatherName ?? base.witnesses[1].fatherName).trim(),
    cnic: String(rawWits[1]?.cnic ?? base.witnesses[1].cnic).trim(),
    mobile: String(rawWits[1]?.mobile ?? base.witnesses[1].mobile).trim()
  };

  const rawOwners = (raw.companyOwners && typeof raw.companyOwners === 'object')
    ? raw.companyOwners
    : ({} as Record<string, any>);

  const mergedOwners: Record<CompanyId, CompanyOwnerSignatory> = {
    docks: { ...base.companyOwners.docks },
    truckit: { ...base.companyOwners.truckit },
    muhib: { ...base.companyOwners.muhib },
    vantage: { ...base.companyOwners.vantage }
  };

  ALL_FOUR_COMPANY_IDS.forEach((cid) => {
    const incoming = rawOwners[cid];
    if (incoming && typeof incoming === 'object') {
      mergedOwners[cid] = {
        ...mergedOwners[cid],
        ...incoming,
        companyId: cid,
        name: String(incoming.name ?? mergedOwners[cid].name).trim(),
        fatherName: String(incoming.fatherName ?? mergedOwners[cid].fatherName).trim(),
        cnic: String(incoming.cnic ?? mergedOwners[cid].cnic).trim(),
        address: String(incoming.address ?? mergedOwners[cid].address).trim(),
        mobile: String(incoming.mobile ?? mergedOwners[cid].mobile).trim(),
        designation: String(incoming.designation ?? mergedOwners[cid].designation).trim() || 'Director'
      };
    }
  });

  return {
    witnesses: [w1, w2],
    companyOwners: mergedOwners,
    updatedAt: raw.updatedAt || base.updatedAt
  };
}

let currentState: VehicleLegalSignatoriesState = buildInitialState();
const listeners = new Set<(state: VehicleLegalSignatoriesState) => void>();
let firestoreSyncInitialized = false;

function broadcastState(next: VehicleLegalSignatoriesState): void {
  currentState = next;
  try {
    // Store lightweight copy in localStorage (chunk:// refs or compact dataUrls)
    safeAppStorage.setRawJSON(STORAGE_KEY, next);
  } catch (e) {
    console.warn('Local signatories cache notice:', e);
  }
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch (e) {
      console.warn(e);
    }
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SIGNATORIES_EVENT, { detail: next }));
  }
}

export function initVehicleLegalSignatoriesSync(): void {
  if (firestoreSyncInitialized || typeof window === 'undefined') return;
  firestoreSyncInitialized = true;

  try {
    const ref = doc(db, 'settings', 'vehicle_legal_signatories');
    onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const incoming = snap.data() as Partial<VehicleLegalSignatoriesState>;
          const merged = normalizeSignatoriesState(incoming, currentState);
          broadcastState(merged);
        }
      },
      (err) => {
        console.warn('Firestore vehicle_legal_signatories sync notice:', err);
      }
    );
  } catch (err) {
    console.warn('Could not initialize vehicle_legal_signatories sync:', err);
  }
}

if (typeof window !== 'undefined') {
  setTimeout(() => {
    initVehicleLegalSignatoriesSync();
  }, 150);
}

export function getVehicleLegalSignatories(): VehicleLegalSignatoriesState {
  return currentState;
}

export function resolveVehicleCompanyId(vehicle?: Partial<Vehicle> | null): CompanyId {
  if (!vehicle) return 'truckit';
  const raw = `${vehicle.operatingCompany || ''} ${vehicle.companyName || ''}`.trim();
  if (!raw) return 'truckit';
  return resolveCompanyIdFromRef(vehicle.companyName, vehicle.operatingCompany);
}

export function getCompanyOwnerForVehicle(vehicle?: Partial<Vehicle> | null): CompanyOwnerSignatory {
  const cid = resolveVehicleCompanyId(vehicle);
  return currentState.companyOwners[cid] || createDefaultCompanyOwner(cid);
}

export function getCompanyOwnerByCompanyId(companyId: CompanyId | string): CompanyOwnerSignatory {
  const cid = resolveCompanyIdFromRef(String(companyId), String(companyId));
  return currentState.companyOwners[cid] || createDefaultCompanyOwner(cid);
}

async function prepareSignatoryImageForCloud(
  rawUrl: string | undefined,
  docKey: string,
  fileName?: string
): Promise<string> {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('chunk://')) return rawUrl;
  if (!rawUrl.startsWith('data:')) return rawUrl;

  await saveDocumentToIndexedDB({
    key: docKey,
    id: docKey,
    name: fileName || docKey,
    type: rawUrl.startsWith('data:application/pdf') ? 'application/pdf' : 'image/jpeg',
    size: rawUrl.length,
    dataUrl: rawUrl
  });

  if (rawUrl.length > INLINE_URL_MAX_CHARS) {
    try {
      return await saveDocumentToCloudChunks({
        docKey,
        name: fileName || docKey,
        mimeType: rawUrl.startsWith('data:application/pdf') ? 'application/pdf' : 'image/jpeg',
        size: rawUrl.length,
        dataUrl: rawUrl
      });
    } catch (err) {
      console.warn('Cloud chunk upload fallback for signatory ID card:', err);
    }
  }
  return rawUrl;
}

export async function savePermanentWitnesses(
  witnesses: [WitnessSignatory, WitnessSignatory]
): Promise<VehicleLegalSignatoriesState> {
  const [rawW1, rawW2] = witnesses;

  const [w1Front, w1Back, w2Front, w2Back] = await Promise.all([
    prepareSignatoryImageForCloud(rawW1.cnicFrontUrl, 'signatory_witness_1_front', rawW1.cnicFrontName),
    prepareSignatoryImageForCloud(rawW1.cnicBackUrl, 'signatory_witness_1_back', rawW1.cnicBackName),
    prepareSignatoryImageForCloud(rawW2.cnicFrontUrl, 'signatory_witness_2_front', rawW2.cnicFrontName),
    prepareSignatoryImageForCloud(rawW2.cnicBackUrl, 'signatory_witness_2_back', rawW2.cnicBackName)
  ]);

  const cleanW1: WitnessSignatory = {
    ...rawW1,
    slot: 1,
    name: (rawW1.name || '').trim().toUpperCase() || DEFAULT_WITNESSES[0].name,
    fatherName: (rawW1.fatherName || '').trim().toUpperCase(),
    cnic: (rawW1.cnic || '').trim() || DEFAULT_WITNESSES[0].cnic,
    mobile: (rawW1.mobile || '').trim(),
    cnicFrontUrl: w1Front,
    cnicBackUrl: w1Back
  };

  const cleanW2: WitnessSignatory = {
    ...rawW2,
    slot: 2,
    name: (rawW2.name || '').trim().toUpperCase() || DEFAULT_WITNESSES[1].name,
    fatherName: (rawW2.fatherName || '').trim().toUpperCase(),
    cnic: (rawW2.cnic || '').trim() || DEFAULT_WITNESSES[1].cnic,
    mobile: (rawW2.mobile || '').trim(),
    cnicFrontUrl: w2Front,
    cnicBackUrl: w2Back
  };

  const nextState: VehicleLegalSignatoriesState = {
    ...currentState,
    witnesses: [cleanW1, cleanW2],
    updatedAt: new Date().toISOString()
  };

  broadcastState(nextState);

  try {
    await setDoc(doc(db, 'settings', 'vehicle_legal_signatories'), nextState, { merge: true });
  } catch (err) {
    console.warn('Firestore savePermanentWitnesses warning:', err);
  }

  return nextState;
}

export async function saveCompanyOwnerDetail(
  companyId: CompanyId,
  owner: Omit<CompanyOwnerSignatory, 'companyId'>
): Promise<VehicleLegalSignatoriesState> {
  const [frontRef, backRef] = await Promise.all([
    prepareSignatoryImageForCloud(owner.cnicFrontUrl, `signatory_company_owner_${companyId}_front`, owner.cnicFrontName),
    prepareSignatoryImageForCloud(owner.cnicBackUrl, `signatory_company_owner_${companyId}_back`, owner.cnicBackName)
  ]);

  const cleanOwner: CompanyOwnerSignatory = {
    companyId,
    name: (owner.name || '').trim(),
    fatherName: (owner.fatherName || '').trim(),
    cnic: (owner.cnic || '').trim(),
    address: (owner.address || '').trim(),
    mobile: (owner.mobile || '').trim(),
    designation: (owner.designation || '').trim() || 'Director',
    cnicFrontUrl: frontRef,
    cnicFrontName: owner.cnicFrontName || '',
    cnicBackUrl: backRef,
    cnicBackName: owner.cnicBackName || '',
    updatedAt: new Date().toISOString()
  };

  const nextState: VehicleLegalSignatoriesState = {
    ...currentState,
    companyOwners: {
      ...currentState.companyOwners,
      [companyId]: cleanOwner
    },
    updatedAt: new Date().toISOString()
  };

  broadcastState(nextState);

  try {
    await setDoc(doc(db, 'settings', 'vehicle_legal_signatories'), nextState, { merge: true });
  } catch (err) {
    console.warn('Firestore saveCompanyOwnerDetail warning:', err);
  }

  return nextState;
}

/**
 * Resolves stored or chunked CNIC Front/Back image URLs for a single image slot.
 */
export async function resolveSignatoryImageDataUrl(
  rawUrl?: string,
  fallbackKey?: string
): Promise<string | undefined> {
  if (!rawUrl) return undefined;
  if (rawUrl.startsWith('data:')) return rawUrl;
  const resolved = await resolveStoredDocumentDataUrl({
    url: rawUrl,
    id: fallbackKey
  });
  return resolved || undefined;
}

/**
 * Resolves both Witnesses with full base64 data URLs ready for Word (.docx) embedding or preview.
 */
export async function resolveWitnessesWithImages(): Promise<[WitnessSignatory, WitnessSignatory]> {
  const [w1, w2] = currentState.witnesses;
  const [w1Front, w1Back, w2Front, w2Back] = await Promise.all([
    resolveSignatoryImageDataUrl(w1.cnicFrontUrl, 'signatory_witness_1_front'),
    resolveSignatoryImageDataUrl(w1.cnicBackUrl, 'signatory_witness_1_back'),
    resolveSignatoryImageDataUrl(w2.cnicFrontUrl, 'signatory_witness_2_front'),
    resolveSignatoryImageDataUrl(w2.cnicBackUrl, 'signatory_witness_2_back')
  ]);

  return [
    { ...w1, cnicFrontUrl: w1Front || '', cnicBackUrl: w1Back || '' },
    { ...w2, cnicFrontUrl: w2Front || '', cnicBackUrl: w2Back || '' }
  ];
}

/**
 * Resolves a Company's Owner record with full base64 data URLs ready for Word (.docx) embedding or preview.
 */
export async function resolveCompanyOwnerWithImages(
  vehicleOrCompanyId?: Partial<Vehicle> | CompanyId | string | null
): Promise<CompanyOwnerSignatory> {
  const cid: CompanyId =
    typeof vehicleOrCompanyId === 'string'
      ? resolveCompanyIdFromRef(vehicleOrCompanyId, vehicleOrCompanyId)
      : resolveVehicleCompanyId(vehicleOrCompanyId);

  const owner = currentState.companyOwners[cid] || createDefaultCompanyOwner(cid);
  const [frontUrl, backUrl] = await Promise.all([
    resolveSignatoryImageDataUrl(owner.cnicFrontUrl, `signatory_company_owner_${cid}_front`),
    resolveSignatoryImageDataUrl(owner.cnicBackUrl, `signatory_company_owner_${cid}_back`)
  ]);

  return {
    ...owner,
    cnicFrontUrl: frontUrl || '',
    cnicBackUrl: backUrl || ''
  };
}

export function subscribeToVehicleLegalSignatories(
  listener: (state: VehicleLegalSignatoriesState) => void
): () => void {
  initVehicleLegalSignatoriesSync();
  listener(currentState);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVehicleLegalSignatories() {
  const [signatories, setSignatories] = useState<VehicleLegalSignatoriesState>(() =>
    getVehicleLegalSignatories()
  );

  useEffect(() => {
    return subscribeToVehicleLegalSignatories((next) => {
      setSignatories(next);
    });
  }, []);

  return {
    signatories,
    witnesses: signatories.witnesses,
    companyOwners: signatories.companyOwners,
    saveWitnesses: savePermanentWitnesses,
    saveCompanyOwner: saveCompanyOwnerDetail,
    getOwnerForVehicle: (v?: Partial<Vehicle> | null) => {
      const cid = resolveVehicleCompanyId(v);
      return signatories.companyOwners[cid] || createDefaultCompanyOwner(cid);
    }
  };
}

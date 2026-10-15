import { Vehicle, VehicleCategory, VehicleType } from '../types';
import { safeAppStorage } from './storage';
import { restoreVehiclesFromIndexedDB } from './documentStorage';
import { db } from './firebase';
import { collection, getDocs } from 'firebase/firestore';

export interface VehicleTripRecord {
  id: string;
  caseNo: string;
  containerNumber?: string;
  clientName: string;
  route: string;
  date: string;
  driverName?: string;
  driverPhone?: string;
  status: string;
}

export interface VehicleRenewalRecord {
  id: number;
  renewalDate: string;
  extendedUntil: string;
  renewalCycle: string;
  authorizedBy?: string;
  notes?: string;
}

export const SEED_TRACKING_VEHICLES: Vehicle[] = [];

const VEHICLE_STORAGE_KEYS = [
  'dpl_live_vehicles',
  'dpl_cached_vehicles'
];

/**
 * Gathers all registered vehicles from live Firestore 'vehicles' collection.
 * Respects app reset state so no stale or dummy vehicles appear after reset.
 */
export async function fetchAllTrackingVehicles(): Promise<Vehicle[]> {
  const mergedMap = new Map<string, Vehicle>();

  // 1. Read directly from Firestore 'vehicles' collection as primary source of truth
  try {
    const snap = await getDocs(collection(db, 'vehicles'));
    if (snap.empty) {
      // Firestore is empty (e.g. after database reset) -> ensure local caches are also cleared
      if (typeof window !== 'undefined' && window.localStorage) {
        VEHICLE_STORAGE_KEYS.forEach((key) => {
          try {
            window.localStorage.setItem(key, '[]');
          } catch (_) {}
        });
      }
      return [];
    }

    snap.forEach((docSnap) => {
      const data = docSnap.data() as Vehicle;
      const reg = data.registrationNumber?.trim().toUpperCase();
      if (reg) {
        mergedMap.set(reg, { ...data, id: Number(docSnap.id) || data.id || Date.now() });
      }
    });
    return Array.from(mergedMap.values());
  } catch (_) {
    // Offline fallback: read from localStorage only if Firestore could not be reached
    if (typeof window !== 'undefined' && window.localStorage) {
      VEHICLE_STORAGE_KEYS.forEach((key) => {
        try {
          const raw = window.localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              parsed.forEach((v: Vehicle) => {
                const reg = v.registrationNumber?.trim().toUpperCase();
                if (reg) mergedMap.set(reg, v);
              });
            }
          }
        } catch (_) {}
      });
    }
  }

  return Array.from(mergedMap.values());
}

/**
 * Searches vehicles by registration number or plate digits.
 * User requirement: "Jo bhi vehicle number likha jaega use number se kitne ki vehicles hongi woh neeche a jaayengi"
 */
export function searchTrackingVehicles(query: string, allVehicles: Vehicle[]): Vehicle[] {
  if (!query) return [];
  const cleanQ = query.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim();
  if (!cleanQ) return [];

  return allVehicles.filter((v) => {
    // 1. Registration Plate match
    const reg = (v.registrationNumber || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (reg.includes(cleanQ) || cleanQ.includes(reg)) return true;

    // 2. DPL Serial match (e.g. MAK-V-0042)
    const serial = (v.dplSerial || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (serial.includes(cleanQ) || cleanQ.includes(serial)) return true;

    // 3. Engine / Chassis No match
    const eng = (v.engineNo || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const chs = (v.chassisNo || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (eng.includes(cleanQ) || chs.includes(cleanQ)) return true;

    // 4. Transporter Name match
    const transp = (v.transporterName || '').toLowerCase();
    if (transp.includes(query.toLowerCase().trim())) return true;

    return false;
  });
}

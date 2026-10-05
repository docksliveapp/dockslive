import { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { safeAppStorage } from './storage';

export type CompanyId = 'docks' | 'muhib' | 'vantage' | 'truckit';

export function isUploadedLogo(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  if (!s || s.length < 5) return false;
  if (s.startsWith('/logos/') || s.includes('docks_logo') || s.includes('mak_group_logo') || s.includes('muhib_logo') || s.includes('vantage_logo') || s.includes('truckit_logo')) {
    return false;
  }
  return true;
}

/**
 * Retrieves the custom logo uploaded in settings for any of the 4 companies.
 * Returns null if no custom logo has been uploaded.
 */
export function getCompanyUploadedLogo(companyId: CompanyId): string | null {
  try {
    const brandingKey = `dpl_company_branding_v1_${companyId}`;
    const stored = safeAppStorage.getJSON<any>(brandingKey, {});
    if (stored?.customLogo && isUploadedLogo(stored.customLogo)) {
      return stored.customLogo;
    }
    if (companyId === 'docks') {
      const docksLegacy = safeAppStorage.getJSON<any>('dpl_company_branding_v1', {});
      if (docksLegacy?.customLogo && isUploadedLogo(docksLegacy.customLogo)) {
        return docksLegacy.customLogo;
      }
    }
    const comp = GROUP_COMPANIES[companyId];
    if (comp?.logo && isUploadedLogo(comp.logo)) {
      return comp.logo;
    }
  } catch (e) {
    console.warn('Error reading uploaded logo for', companyId, e);
  }
  return null;
}

export interface CompanyInfo {
  id: CompanyId;
  name: string;
  shortName: string;
  prefix: string;
  legalTitle: string;
  category: string;
  tagline: string;
  logo: string;
  accentColor: string;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
  themeGradient: string;
  description: string;
  address: string;
  phone: string;
  cell: string;
  email: string;
  web: string;
  directorName: string;
  directorTitle: string;
  features: string[];
}

export interface ParentGroupInfo {
  id: string;
  name: string;
  title: string;
  tagline: string;
  subtitle: string;
  logo: string;
  address: string;
  phone: string;
  cell: string;
  email: string;
  web: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_PARENT_GROUP: ParentGroupInfo = {
  id: 'mak',
  name: 'MAK Group of Companies',
  title: 'MAK GROUP OF COMPANIES',
  tagline: 'Premier Multi-Entity Logistics, Customs & International Trade Conglomerate',
  subtitle: 'DOCKS • TRUCKIT • MUHIB • VANTAGE',
  logo: '',
  address: 'Office No. 14-B, First Floor, State Life Building No. 7, G-Allana Road Tower, Karachi.',
  phone: '+92-21-32330103, +92-21-32330104',
  cell: '+92-321-9222883, +92-321-8496006',
  email: 'info@makgroup.com.pk',
  web: 'www.makgroup.com.pk'
};

export const PARENT_GROUP_STORAGE_KEY = 'mak_parent_group_branding';
export const PARENT_GROUP_EVENT = 'mak_parent_group_updated';

export function getParentGroupInfo(): ParentGroupInfo {
  const stored = safeAppStorage.getJSON<Partial<ParentGroupInfo>>(PARENT_GROUP_STORAGE_KEY, {});
  const cleanLogo = isUploadedLogo(stored.logo) ? stored.logo! : '';
  return {
    ...DEFAULT_PARENT_GROUP,
    ...stored,
    logo: cleanLogo,
    name: stored.name || DEFAULT_PARENT_GROUP.name,
    title: stored.title || DEFAULT_PARENT_GROUP.title,
    tagline: stored.tagline || DEFAULT_PARENT_GROUP.tagline,
    subtitle: stored.subtitle || DEFAULT_PARENT_GROUP.subtitle,
    address: stored.address || DEFAULT_PARENT_GROUP.address,
    phone: stored.phone || DEFAULT_PARENT_GROUP.phone,
    cell: stored.cell || DEFAULT_PARENT_GROUP.cell,
    email: stored.email || DEFAULT_PARENT_GROUP.email,
    web: stored.web || DEFAULT_PARENT_GROUP.web,
  };
}

export let PARENT_GROUP: ParentGroupInfo = getParentGroupInfo();

const parentGroupListeners = new Set<(group: ParentGroupInfo) => void>();

export function subscribeToParentGroup(listener: (group: ParentGroupInfo) => void): () => void {
  listener(PARENT_GROUP);
  parentGroupListeners.add(listener);
  return () => {
    parentGroupListeners.delete(listener);
  };
}

export function broadcastParentGroupUpdate(newGroup: ParentGroupInfo): void {
  PARENT_GROUP = newGroup;
  safeAppStorage.setJSON(PARENT_GROUP_STORAGE_KEY, newGroup);
  parentGroupListeners.forEach(fn => {
    try { fn(newGroup); } catch (e) { console.warn(e); }
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PARENT_GROUP_EVENT, { detail: newGroup }));
  }
}

export async function saveParentGroupInfo(updates: Partial<ParentGroupInfo>, updatedBy?: string): Promise<ParentGroupInfo> {
  const current = getParentGroupInfo();
  const merged: ParentGroupInfo = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || 'System Administrator'
  };

  broadcastParentGroupUpdate(merged);

  try {
    const parentRef = doc(db, 'settings', 'parent_group');
    await setDoc(parentRef, merged, { merge: true });
  } catch (err) {
    console.warn('Firestore parent_group save warning:', err);
  }

  return merged;
}

export async function resetParentGroupInfo(): Promise<ParentGroupInfo> {
  return saveParentGroupInfo(DEFAULT_PARENT_GROUP);
}

let hasSubscribedParentGroup = false;
export function initParentGroupFirestoreSync() {
  if (hasSubscribedParentGroup) return;
  hasSubscribedParentGroup = true;
  try {
    const parentRef = doc(db, 'settings', 'parent_group');
    onSnapshot(parentRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const merged: ParentGroupInfo = {
          ...DEFAULT_PARENT_GROUP,
          ...data,
          logo: data.logo || DEFAULT_PARENT_GROUP.logo
        };
        broadcastParentGroupUpdate(merged);
      }
    }, (err) => {
      console.warn('Parent group Firestore sync notice:', err);
    });
  } catch (e) {
    console.warn('Parent group Firestore init error:', e);
  }
}

export function useParentGroup() {
  const [parentGroup, setParentGroup] = useState<ParentGroupInfo>(() => getParentGroupInfo());

  useEffect(() => {
    initParentGroupFirestoreSync();
    return subscribeToParentGroup((group) => {
      setParentGroup(group);
    });
  }, []);

  return {
    parentGroup,
    saveParentGroup: (updates: Partial<ParentGroupInfo>, updatedBy?: string) => saveParentGroupInfo(updates, updatedBy),
    resetParentGroup: () => resetParentGroupInfo()
  };
}

export const GROUP_COMPANIES: Record<CompanyId, CompanyInfo> = {
  docks: {
    id: 'docks',
    name: 'Docks (Pvt.) Ltd.',
    shortName: 'DPL',
    prefix: 'DPL',
    legalTitle: 'Docks (Pvt.) Ltd.',
    category: 'Customs Bonded Carrier & Port Logistics',
    tagline: 'Nationwide Bonded Carrier & Afghan Transit Logistics Specialist',
    logo: '',
    accentColor: '#F59E0B', // Amber / Gold
    borderColor: 'border-amber-500/40',
    badgeBg: 'bg-amber-500/20',
    badgeText: 'text-amber-300',
    themeGradient: 'from-amber-500/20 via-slate-900 to-black',
    description: 'Premier Customs Bonded Carrier operating safe containerized transit across all Pakistani ports, dry ports, customs borders & Afghan trade routes.',
    address: 'Office No. 14-B, First Floor, State Life Building No. 7, G-Allana Road Tower, Karachi.',
    phone: '+92-21-32330103, +92-21-32330104',
    cell: '+92-321-9222883, +92-321-8496006',
    email: 'info@dockspk.com',
    web: 'www.dockspk.com',
    directorName: 'Arbab Khan',
    directorTitle: 'Director',
    features: [
      'Customs Bonded Carrier Fleet',
      'Port to Dry Port Container Movement',
      'Afghan Transit Trade (ATT) Corridors',
      'Real-Time Gate-Pass & Tracking'
    ]
  },

  muhib: {
    id: 'muhib',
    name: 'Muhib International (SMC-Pvt.) Ltd.',
    shortName: 'MI',
    prefix: 'MI',
    legalTitle: 'Muhib International (SMC-Pvt.) Ltd.',
    category: 'International Freight Forwarding & Trade Logistics',
    tagline: 'Global Import, Export & Customs Clearance Facilitation',
    logo: '',
    accentColor: '#2563EB', // Royal Blue & Crimson
    borderColor: 'border-blue-500/40',
    badgeBg: 'bg-blue-500/20',
    badgeText: 'text-blue-300',
    themeGradient: 'from-blue-600/20 via-slate-900 to-black',
    description: 'End-to-end International Freight Forwarding, import/export cargo handling, and dedicated global shipping solutions.',
    address: 'Office No. 14-B, First Floor, State Life Building No. 7, G-Allana Road Tower, Karachi.',
    phone: '+92-21-32330103, +92-21-32330104',
    cell: '+92-321-9222883, +92-321-8496006',
    email: 'info@muhibinternational.com',
    web: 'www.muhibinternational.com',
    directorName: 'Director',
    directorTitle: 'Director',
    features: [
      'Air & Sea International Freight',
      'Import / Export Clearing & Forwarding',
      'Customs Tariff & Document Facilitation',
      'Worldwide Partner Cargo Network'
    ]
  },

  vantage: {
    id: 'vantage',
    name: 'Vintage Shipping Line',
    shortName: 'VSL',
    prefix: 'VSL',
    legalTitle: 'Vintage Shipping Line (Pvt.) Ltd.',
    category: 'Ocean Freight & Maritime Container Vessel Logistics',
    tagline: 'Worldwide Ocean Freight, Shipping Agency & Container Management',
    logo: '',
    accentColor: '#0EA5E9', // Sky / Cyan
    borderColor: 'border-cyan-500/40',
    badgeBg: 'bg-cyan-500/20',
    badgeText: 'text-cyan-300',
    themeGradient: 'from-cyan-600/20 via-slate-900 to-black',
    description: 'Full-service ocean container shipping line and vessel agency managing sea freight, chartering, and regional marine logistics.',
    address: 'Office No. 14-B, First Floor, State Life Building No. 7, G-Allana Road Tower, Karachi.',
    phone: '+92-21-32330103, +92-21-32330104',
    cell: '+92-321-9222883, +92-321-8496006',
    email: 'info@vantageshipping.com',
    web: 'www.vantageshipping.com',
    directorName: 'Director',
    directorTitle: 'Director',
    features: [
      'Ocean Container Vessel Lines',
      'Full Container Load (FCL) & LCL',
      'Terminal Handling & Port Operations',
      'Marine Shipping Documentation'
    ]
  },

  truckit: {
    id: 'truckit',
    name: 'Truckit (Pvt.) Ltd.',
    shortName: 'TRK',
    prefix: 'TRK',
    legalTitle: 'Truckit (Pvt.) Ltd.',
    category: 'Nationwide Fleet Haulage & Fast Cargo Trucking',
    tagline: 'High-Speed Cargo Haulage, Heavy Transport & Inter-City Fleet',
    logo: '',
    accentColor: '#EF4444', // Red
    borderColor: 'border-red-500/40',
    badgeBg: 'bg-red-500/20',
    badgeText: 'text-red-300',
    themeGradient: 'from-red-600/20 via-slate-900 to-black',
    description: 'Modern long-haul fleet and heavy cargo trucking network providing rapid, tracked road freight across all national transport corridors.',
    address: 'Office No. 14-B, First Floor, State Life Building No. 7, G-Allana Road Tower, Karachi.',
    phone: '+92-21-32330103, +92-21-32330104',
    cell: '+92-321-9222883, +92-321-8496006',
    email: 'info@truckitpk.com',
    web: 'www.truckitpk.com',
    directorName: 'Director',
    directorTitle: 'Director',
    features: [
      'Nationwide Heavy Haulage Fleet',
      'Flatbed & Low-Bed Trailers',
      '24/7 Road Cargo Dispatch',
      'Direct Factory & Mill Deliveries'
    ]
  }
};

export const COMPANIES_LIST: CompanyInfo[] = Object.values(GROUP_COMPANIES);

const ACTIVE_COMPANY_KEY = 'dpl_active_company_id';
const COMPANY_CHANGE_EVENT = 'mak_active_company_changed';

// In-memory cache
let currentActiveCompanyId: CompanyId = (() => {
  const stored = safeAppStorage.getItem(ACTIVE_COMPANY_KEY) as CompanyId;
  if (stored && GROUP_COMPANIES[stored]) return stored;
  return 'docks';
})();

const companyListeners = new Set<(company: CompanyInfo) => void>();

/**
 * Returns currently active company ID.
 */
export function getActiveCompanyId(): CompanyId {
  return currentActiveCompanyId;
}

/**
 * Returns currently active CompanyInfo object.
 */
export function getActiveCompany(): CompanyInfo {
  return GROUP_COMPANIES[currentActiveCompanyId] || GROUP_COMPANIES.docks;
}

/**
 * Returns the short prefix for serial numbers and codes for the active company:
 * - Docks -> 'DPL'
 * - Muhib -> 'MI'
 * - Vintage -> 'VSL'
 * - Truckit -> 'TRK'
 */
export function getActiveCompanyPrefix(companyId?: CompanyId): string {
  const active = companyId ? GROUP_COMPANIES[companyId] : getActiveCompany();
  if (!active) return 'DPL';
  return active.prefix || (active.id === 'muhib' ? 'MI' : active.id === 'vantage' ? 'VSL' : active.id === 'truckit' ? 'TRK' : 'DPL');
}

/**
 * Switches the active company, persists to storage, and notifies all subscribers.
 */
export function setActiveCompany(id: CompanyId): void {
  if (!GROUP_COMPANIES[id]) return;
  if (currentActiveCompanyId === id) return;

  currentActiveCompanyId = id;
  safeAppStorage.setItem(ACTIVE_COMPANY_KEY, id);

  const comp = GROUP_COMPANIES[id];
  companyListeners.forEach(fn => {
    try { fn(comp); } catch (e) { console.warn(e); }
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COMPANY_CHANGE_EVENT, { detail: comp }));
  }
}

/**
 * Scopes a storage key to the active company.
 * Note: 'docks' uses the base key for backward compatibility so no existing data is lost.
 */
export function getCompanyStorageKey(baseKey: string, companyId?: CompanyId): string {
  const active = companyId || currentActiveCompanyId;
  if (active === 'docks') {
    return baseKey;
  }
  return `${baseKey}_${active}`;
}

/**
 * Subscribes to company changes.
 */
export function subscribeToActiveCompany(listener: (company: CompanyInfo) => void): () => void {
  listener(getActiveCompany());
  companyListeners.add(listener);
  return () => {
    companyListeners.delete(listener);
  };
}

/**
 * React hook to get and switch active company anywhere.
 */
export function useActiveCompany() {
  const [activeCompany, setActiveCompanyState] = useState<CompanyInfo>(() => getActiveCompany());
  const [parentGroupState, setParentGroupState] = useState<ParentGroupInfo>(() => getParentGroupInfo());

  useEffect(() => {
    const unsubComp = subscribeToActiveCompany((comp) => {
      setActiveCompanyState(comp);
    });
    const unsubGroup = subscribeToParentGroup((group) => {
      setParentGroupState(group);
    });
    return () => {
      unsubComp();
      unsubGroup();
    };
  }, []);

  return {
    activeCompany,
    companyId: activeCompany.id,
    companies: COMPANIES_LIST,
    parentGroup: parentGroupState,
    setActiveCompany,
    isDocks: activeCompany.id === 'docks',
    isMuhib: activeCompany.id === 'muhib',
    isVantage: activeCompany.id === 'vantage',
    isTruckit: activeCompany.id === 'truckit'
  };
}

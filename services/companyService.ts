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
 * If the company has chosen "Use Main Group Logo as Official Document Logo",
 * it returns the parent conglomerate logo.
 * Returns null if no custom logo has been uploaded.
 */
export function getCompanyUploadedLogo(companyId: CompanyId): string | null {
  try {
    const brandingKey = `dpl_company_branding_v1_${companyId}`;
    const stored = safeAppStorage.getRawJSON<any>(brandingKey, {});

    // 1. Check if the company opted to use Main Admin Group Logo
    if (stored?.useMainLogoAsOfficial) {
      const parentGroup = getParentGroupInfo();
      if (parentGroup?.logo && isUploadedLogo(parentGroup.logo)) {
        return parentGroup.logo;
      }
    }

    // 2. Check company's directly uploaded custom logo
    if (stored?.customLogo && isUploadedLogo(stored.customLogo)) {
      return stored.customLogo;
    }

    // 3. Fallback to docksLegacy ONLY if the requested company is actually 'docks'
    if (companyId === 'docks') {
      const docksLegacy = safeAppStorage.getRawJSON<any>('dpl_company_branding_v1', {});
      if (docksLegacy?.useMainLogoAsOfficial) {
        const parentGroup = getParentGroupInfo();
        if (parentGroup?.logo && isUploadedLogo(parentGroup.logo)) {
          return parentGroup.logo;
        }
      }
      if (docksLegacy?.customLogo && isUploadedLogo(docksLegacy.customLogo)) {
        return docksLegacy.customLogo;
      }
    }

    // 4. Default company preset logo if custom
    const comp = GROUP_COMPANIES[companyId];
    if (comp?.logo && isUploadedLogo(comp.logo)) {
      return comp.logo;
    }
  } catch (e) {
    console.warn('Error reading uploaded logo for', companyId, e);
  }
  return null;
}

/**
 * Returns whether a company has enabled "Use Main Group Logo as Official Document Logo".
 */
export function isCompanyUsingMainLogo(companyId: CompanyId): boolean {
  try {
    const brandingKey = `dpl_company_branding_v1_${companyId}`;
    const stored = safeAppStorage.getRawJSON<any>(brandingKey, {});
    if (typeof stored?.useMainLogoAsOfficial === 'boolean') {
      return stored.useMainLogoAsOfficial;
    }
    if (companyId === 'docks') {
      const docksLegacy = safeAppStorage.getRawJSON<any>('dpl_company_branding_v1', {});
      if (typeof docksLegacy?.useMainLogoAsOfficial === 'boolean') {
        return docksLegacy.useMainLogoAsOfficial;
      }
    }
  } catch (e) {}
  return false;
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
  favicon?: string;
  address: string;
  phone: string;
  cell: string;
  email: string;
  web: string;
  updatedAt?: string;
  updatedBy?: string;
}

export function getCompanyLogoUrl(companyId?: CompanyId | null): string {
  if (!companyId) return '/logos/mak_group_logo.svg';
  const custom = getCompanyUploadedLogo(companyId);
  if (custom) return custom;
  
  const defaults: Record<CompanyId, string> = {
    docks: '/logos/docks_logo.svg',
    muhib: '/logos/muhib_logo.svg',
    vantage: '/logos/vantage_logo.svg',
    truckit: '/logos/truckit_logo.svg'
  };
  return defaults[companyId] || '/logos/mak_group_logo.svg';
}

export const DEFAULT_PARENT_GROUP: ParentGroupInfo = {
  id: 'mak',
  name: 'MAK Group of Companies',
  title: 'MAK GROUP OF COMPANIES',
  tagline: 'Premier Multi-Entity Logistics, Customs & International Trade Conglomerate',
  subtitle: 'DOCKS • TRUCKIT • MUHIB • VANTAGE',
  logo: '/logos/mak_group_logo.svg',
  favicon: '/favicon.svg',
  address: 'Office No 13 1st Floor State Life Building No 7 G-Allana Road Tower Karachi',
  phone: '+92-21-32330103, +92-21-32330104',
  cell: '+92-321-9222883, +92-321-8496006',
  email: 'info@makgroup.com.pk',
  web: 'www.makgroup.com.pk'
};

export const PARENT_GROUP_STORAGE_KEY = 'mak_parent_group_branding';
export const PARENT_GROUP_EVENT = 'mak_parent_group_updated';

let lastAppliedFaviconHref: string | null = null;
let dynamicManifestBlobUrl: string | null = null;

/**
 * Dynamically updates the browser tab favicon, shortcut icon, Apple touch icon,
 * and Web App Manifest icons whenever a custom Favicon SVG/image is uploaded in Admin Settings.
 */
export function applyDynamicFaviconToDOM(faviconUrl?: string | null): void {
  if (typeof document === 'undefined') return;
  try {
    const hasCustomFavicon = Boolean(faviconUrl && isUploadedLogo(faviconUrl));
    const effectiveHref = hasCustomFavicon ? faviconUrl!.trim() : '/favicon.svg';
    if (lastAppliedFaviconHref === effectiveHref) return;
    lastAppliedFaviconHref = effectiveHref;

    const isSvg = effectiveHref.startsWith('data:image/svg+xml') || effectiveHref.toLowerCase().endsWith('.svg');
    const mimeType = isSvg ? 'image/svg+xml' : 'image/png';

    // Update all existing icon & apple-touch-icon links in <head>
    const iconLinks = document.head.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]'
    );

    if (iconLinks.length > 0) {
      iconLinks.forEach((link) => {
        link.href = effectiveHref;
        if (link.rel === 'icon' || link.rel === 'shortcut icon') {
          link.type = mimeType;
        }
      });
    } else {
      const newLink = document.createElement('link');
      newLink.rel = 'icon';
      newLink.type = mimeType;
      newLink.href = effectiveHref;
      document.head.appendChild(newLink);
    }

    // If a custom favicon (e.g. SVG) was uploaded, also generate crisp PNGs on canvas
    // for browser install prompt & Apple Touch Icon compatibility
    if (hasCustomFavicon && typeof Image !== 'undefined') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const makePng = (size: number): string => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return effectiveHref;
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, 0, 0, size, size);
            return canvas.toDataURL('image/png');
          };

          const png192 = makePng(192);
          const png512 = makePng(512);

          // Update apple-touch-icon links with PNG data URL for iOS/Android
          document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').forEach((link) => {
            link.href = png192;
          });

          // Dynamically update Web App Manifest link so "Install App" uses the uploaded SVG/Favicon
          const manifestLink = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
          if (manifestLink && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
            const dynamicManifest = {
              id: '/?app=mak-group-erp',
              name: 'MAK Group of Companies - Logistics & Enterprise Portal',
              short_name: 'MAK Group',
              description: 'MAK Group of Companies — Multi-Subsidiary Customs Clearance, Bonded Carrier, Freight Forwarding & Fleet Tracking System.',
              start_url: `${window.location.origin}/?source=pwa`,
              scope: `${window.location.origin}/`,
              display: 'standalone',
              orientation: 'any',
              background_color: '#F8FAFC',
              theme_color: '#F8FAFC',
              icons: [
                {
                  src: effectiveHref,
                  sizes: 'any',
                  type: mimeType,
                  purpose: 'any'
                },
                {
                  src: png192,
                  sizes: '192x192',
                  type: 'image/png',
                  purpose: 'any'
                },
                {
                  src: png512,
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'any'
                },
                {
                  src: png512,
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable'
                }
              ]
            };
            if (dynamicManifestBlobUrl) {
              URL.revokeObjectURL(dynamicManifestBlobUrl);
            }
            const blob = new Blob([JSON.stringify(dynamicManifest)], { type: 'application/manifest+json' });
            dynamicManifestBlobUrl = URL.createObjectURL(blob);
            manifestLink.href = dynamicManifestBlobUrl;
          }
        } catch (err) {
          console.warn('Dynamic favicon canvas conversion notice:', err);
        }
      };
      img.src = effectiveHref;
    }
  } catch (e) {
    console.warn('Could not apply dynamic favicon to DOM:', e);
  }
}

export function getParentGroupInfo(): ParentGroupInfo {
  const stored = safeAppStorage.getJSON<Partial<ParentGroupInfo>>(PARENT_GROUP_STORAGE_KEY, {});
  const cleanLogo = isUploadedLogo(stored.logo) ? stored.logo! : '';
  const cleanFavicon = isUploadedLogo(stored.favicon) ? stored.favicon! : '';
  const result: ParentGroupInfo = {
    ...DEFAULT_PARENT_GROUP,
    ...stored,
    logo: cleanLogo,
    favicon: cleanFavicon,
    name: stored.name || DEFAULT_PARENT_GROUP.name,
    title: stored.title || DEFAULT_PARENT_GROUP.title,
    tagline: stored.tagline || DEFAULT_PARENT_GROUP.tagline,
    subtitle: stored.subtitle || DEFAULT_PARENT_GROUP.subtitle,
    address: (stored.address && !stored.address.includes('14-B')) ? stored.address : DEFAULT_PARENT_GROUP.address,
    phone: stored.phone || DEFAULT_PARENT_GROUP.phone,
    cell: stored.cell || DEFAULT_PARENT_GROUP.cell,
    email: stored.email || DEFAULT_PARENT_GROUP.email,
    web: stored.web || DEFAULT_PARENT_GROUP.web,
  };
  if (cleanFavicon) {
    applyDynamicFaviconToDOM(cleanFavicon);
  }
  return result;
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
  applyDynamicFaviconToDOM(newGroup.favicon);
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
  lastAppliedFaviconHref = null;
  applyDynamicFaviconToDOM(null);
  return saveParentGroupInfo({
    ...DEFAULT_PARENT_GROUP,
    logo: '',
    favicon: ''
  });
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
          address: (data.address && !String(data.address).includes('14-B')) ? data.address : DEFAULT_PARENT_GROUP.address,
          logo: data.logo || DEFAULT_PARENT_GROUP.logo,
          favicon: data.favicon || ''
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

const subscribedCompanies = new Set<CompanyId>();

/**
 * Initializes real-time Firestore sync for all 4 corporate entities.
 * Automatically synchronizes uploaded logos, useMainLogoAsOfficial flags,
 * and company titles across devices.
 */
export function initAllCompaniesFirestoreSync() {
  initParentGroupFirestoreSync();
  const allIds: CompanyId[] = ['docks', 'muhib', 'vantage', 'truckit'];
  allIds.forEach((cId) => {
    if (subscribedCompanies.has(cId)) return;
    subscribedCompanies.add(cId);

    try {
      const docId = cId === 'docks' ? 'branding' : `branding_${cId}`;
      const ref = doc(db, 'settings', docId);
      onSnapshot(ref, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const key = `dpl_company_branding_v1_${cId}`;
          const currentStored = safeAppStorage.getRawJSON<any>(key, {});
          const cleanCustomLogo = data.customLogo || data.logo || currentStored.customLogo || null;
          const updated = {
            ...currentStored,
            ...data,
            customLogo: cleanCustomLogo,
            useMainLogoAsOfficial: typeof data.useMainLogoAsOfficial === 'boolean' 
              ? data.useMainLogoAsOfficial 
              : currentStored.useMainLogoAsOfficial,
            companyName: data.companyName || currentStored.companyName,
            subtitle: data.subtitle || currentStored.subtitle,
          };
          safeAppStorage.setRawJSON(key, updated);
          if (cId === 'docks') {
            safeAppStorage.setRawJSON('dpl_company_branding_v1', updated);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('dpl_branding_changed', { detail: updated }));
          }
        }
      }, (err) => {
        console.warn(`Firestore sync notice for company ${cId}:`, err);
      });
    } catch (e) {
      console.warn(`Failed to initialize sync for company ${cId}:`, e);
    }
  });
}

// Auto-initialize real-time Firestore subscriptions for all companies
if (typeof window !== 'undefined') {
  setTimeout(() => {
    initAllCompaniesFirestoreSync();
  }, 100);
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
    logo: '/logos/docks_logo.svg',
    accentColor: '#F59E0B', // Amber / Gold
    borderColor: 'border-amber-500/40',
    badgeBg: 'bg-amber-500/20',
    badgeText: 'text-amber-300',
    themeGradient: 'from-amber-500/20 via-slate-900 to-black',
    description: 'Premier Customs Bonded Carrier operating safe containerized transit across all Pakistani ports, dry ports, customs borders & Afghan trade routes.',
    address: 'Office No 13 1st Floor State Life Building No 7 G-Allana Road Tower Karachi',
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
    logo: '/logos/muhib_logo.svg',
    accentColor: '#2563EB', // Royal Blue & Crimson
    borderColor: 'border-blue-500/40',
    badgeBg: 'bg-blue-500/20',
    badgeText: 'text-blue-300',
    themeGradient: 'from-blue-600/20 via-slate-900 to-black',
    description: 'End-to-end International Freight Forwarding, import/export cargo handling, and dedicated global shipping solutions.',
    address: 'Office No 13 1st Floor State Life Building No 7 G-Allana Road Tower Karachi',
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
    name: 'Vantage Shipping Line',
    shortName: 'VSL',
    prefix: 'VSL',
    legalTitle: 'Vantage Shipping Line (Pvt.) Ltd.',
    category: 'Ocean Freight & Maritime Container Vessel Logistics',
    tagline: 'Worldwide Ocean Freight, Shipping Agency & Container Management',
    logo: '/logos/vantage_logo.svg',
    accentColor: '#0EA5E9', // Sky / Cyan
    borderColor: 'border-cyan-500/40',
    badgeBg: 'bg-cyan-500/20',
    badgeText: 'text-cyan-300',
    themeGradient: 'from-cyan-600/20 via-slate-900 to-black',
    description: 'Full-service ocean container shipping line and vessel agency managing sea freight, chartering, and regional marine logistics.',
    address: 'Office No 13 1st Floor State Life Building No 7 G-Allana Road Tower Karachi',
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
    logo: '/logos/truckit_logo.svg',
    accentColor: '#EF4444', // Red
    borderColor: 'border-red-500/40',
    badgeBg: 'bg-red-500/20',
    badgeText: 'text-red-300',
    themeGradient: 'from-red-600/20 via-slate-900 to-black',
    description: 'Modern long-haul fleet and heavy cargo trucking network providing rapid, tracked road freight across all national transport corridors.',
    address: 'Office No 13 1st Floor State Life Building No 7 G-Allana Road Tower Karachi',
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
 * - Vantage -> 'VSL'
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

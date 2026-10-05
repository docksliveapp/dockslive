import { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { safeAppStorage } from './storage';
import { 
  getActiveCompany, 
  getActiveCompanyId, 
  subscribeToActiveCompany, 
  useActiveCompany, 
  CompanyInfo, 
  GROUP_COMPANIES,
  getParentGroupInfo,
  subscribeToParentGroup,
  isUploadedLogo,
  useParentGroup
} from './companyService';

export interface CompanyBranding {
  customLogo: string | null;
  useMainLogoAsOfficial?: boolean;
  companyName: string;
  subtitle: string;
  address: string;
  phone: string;
  cell: string;
  email: string;
  web: string;
  directorName?: string;
  directorTitle?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export function getDefaultBranding(comp: CompanyInfo = getActiveCompany()): CompanyBranding {
  return {
    customLogo: null,
    useMainLogoAsOfficial: false,
    companyName: comp.legalTitle || comp.name,
    subtitle: comp.tagline || comp.category,
    address: comp.address || 'Office No. 14-B, First Floor, State Life Building No. 7, G-Allana Road Tower, Karachi.',
    phone: comp.phone || '+92-21-32330103, +92-21-32330104',
    cell: comp.cell || '+92-321-9222883, +92-321-8496006',
    email: comp.email || 'info@dockspk.com',
    web: comp.web || 'www.dockspk.com',
    directorName: comp.directorName || 'Director',
    directorTitle: comp.directorTitle || 'Director',
  };
}

export const DEFAULT_BRANDING: CompanyBranding = getDefaultBranding(GROUP_COMPANIES.docks);

const STORAGE_KEY = 'dpl_company_branding_v1';
const BRANDING_EVENT = 'dpl_branding_changed';

/**
 * Returns current branding synchronously from cache/storage to prevent UI flickering.
 */
export function getStoredBranding(companyOverride?: CompanyInfo): CompanyBranding {
  const activeCompany = companyOverride || getActiveCompany();
  const defaultB = getDefaultBranding(activeCompany);
  const companyKey = `${STORAGE_KEY}_${activeCompany.id}`;
  const stored = safeAppStorage.getJSON<Partial<CompanyBranding>>(companyKey, {});
  const parentGroup = getParentGroupInfo();

  // Determine correct company name according to active subsidiary:
  let companyName = defaultB.companyName;
  if (stored.companyName) {
    if (activeCompany.id !== 'docks' && stored.companyName.toLowerCase().includes('docks')) {
      companyName = defaultB.companyName;
    } else {
      companyName = stored.companyName;
    }
  }

  // Determine effective logo:
  // If useMainLogoAsOfficial is checked, use Main Conglomerate Logo
  let companyLogo: string | null = null;
  const isUseMain = Boolean(stored.useMainLogoAsOfficial);
  if (isUseMain && parentGroup.logo && isUploadedLogo(parentGroup.logo)) {
    companyLogo = parentGroup.logo;
  } else if (stored.customLogo && isUploadedLogo(stored.customLogo)) {
    companyLogo = stored.customLogo;
  }

  const subtitle = stored.subtitle || defaultB.subtitle;

  return {
    ...defaultB,
    ...stored,
    useMainLogoAsOfficial: isUseMain,
    customLogo: companyLogo,
    companyName: companyName,
    subtitle: subtitle,
    address: stored.address || defaultB.address,
    phone: stored.phone || defaultB.phone,
    cell: stored.cell || defaultB.cell,
    email: stored.email || defaultB.email,
    web: stored.web || defaultB.web,
    directorName: stored.directorName || defaultB.directorName,
    directorTitle: stored.directorTitle || defaultB.directorTitle,
  };
}

// In-memory active branding cache
let activeBrandingCache: CompanyBranding = getStoredBranding();
const brandingListeners = new Set<(branding: CompanyBranding) => void>();
let firestoreUnsubscribe: (() => void) | null = null;
let currentSubscribedCompanyId: string | null = null;

// Recompute when active company changes
subscribeToActiveCompany((comp) => {
  ensureFirestoreSubscription();
  activeBrandingCache = getStoredBranding(comp);
  brandingListeners.forEach(fn => {
    try { fn(activeBrandingCache); } catch (_) {}
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BRANDING_EVENT, { detail: activeBrandingCache }));
  }
});

// Recompute if parent group updates and active company uses Main Group Logo
subscribeToParentGroup((pGroup) => {
  const current = getStoredBranding();
  if (current.useMainLogoAsOfficial) {
    activeBrandingCache = getStoredBranding();
    brandingListeners.forEach(fn => {
      try { fn(activeBrandingCache); } catch (_) {}
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(BRANDING_EVENT, { detail: activeBrandingCache }));
    }
  }
});

function ensureFirestoreSubscription() {
  const activeComp = getActiveCompany();
  if (firestoreUnsubscribe && currentSubscribedCompanyId === activeComp.id) return;

  if (firestoreUnsubscribe) {
    try { firestoreUnsubscribe(); } catch (_) {}
    firestoreUnsubscribe = null;
  }

  currentSubscribedCompanyId = activeComp.id;

  try {
    const docId = activeComp.id === 'docks' ? 'branding' : `branding_${activeComp.id}`;
    const brandingRef = doc(db, 'settings', docId);
    
    firestoreUnsubscribe = onSnapshot(
      brandingRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const parentGroup = getParentGroupInfo();
          const rawDocName = (data.companyName || '').trim();
          const defaultB = getDefaultBranding(activeComp);
          const normalizedDocName = rawDocName || defaultB.companyName;

          const isUseMain = Boolean(data.useMainLogoAsOfficial);
          const rawCustomLogo = data.customLogo || data.logo || null;
          let effectiveLogo: string | null = null;
          if (isUseMain && parentGroup.logo && isUploadedLogo(parentGroup.logo)) {
            effectiveLogo = parentGroup.logo;
          } else if (rawCustomLogo && isUploadedLogo(rawCustomLogo)) {
            effectiveLogo = rawCustomLogo;
          }

          const merged: CompanyBranding = {
            ...defaultB,
            ...data,
            useMainLogoAsOfficial: isUseMain,
            customLogo: effectiveLogo,
            companyName: normalizedDocName,
            subtitle: data.subtitle || activeComp.tagline || defaultB.subtitle,
            address: data.address || defaultB.address,
            phone: data.phone || defaultB.phone,
            cell: data.cell || defaultB.cell,
            email: data.email || defaultB.email,
            web: data.web || defaultB.web,
            directorName: data.directorName || defaultB.directorName,
            directorTitle: data.directorTitle || defaultB.directorTitle,
            updatedAt: data.updatedAt,
            updatedBy: data.updatedBy,
          };

          const companyKey = `${STORAGE_KEY}_${activeComp.id}`;
          safeAppStorage.setJSON(companyKey, merged);
          if (activeComp.id === 'docks') {
            safeAppStorage.setJSON(STORAGE_KEY, merged);
          }

          // Only broadcast if content actually differs from current cache
          if (JSON.stringify(merged) !== JSON.stringify(activeBrandingCache)) {
            activeBrandingCache = merged;
            brandingListeners.forEach(fn => {
              try { fn(merged); } catch (_) {}
            });
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent(BRANDING_EVENT, { detail: merged }));
            }
          }
        }
      },
      (error) => {
        console.warn('Firestore branding subscription warning (using local cache):', error);
      }
    );
  } catch (err) {
    console.warn('Could not establish Firestore branding listener:', err);
  }
}

/**
 * Broadcasts branding change across all subscribers without window event storming.
 */
function broadcastBranding(branding: CompanyBranding) {
  const activeCompany = getActiveCompany();
  const companyKey = `${STORAGE_KEY}_${activeCompany.id}`;
  activeBrandingCache = branding;
  safeAppStorage.setJSON(companyKey, branding);
  if (activeCompany.id === 'docks') {
    safeAppStorage.setJSON(STORAGE_KEY, branding);
  }
  brandingListeners.forEach(fn => {
    try { fn(branding); } catch (_) {}
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BRANDING_EVENT, { detail: branding }));
  }
}

/**
 * Subscribes to branding updates using a lightweight singleton listener.
 */
export function subscribeToBranding(onUpdate: (branding: CompanyBranding) => void): () => void {
  ensureFirestoreSubscription();
  onUpdate(activeBrandingCache);
  brandingListeners.add(onUpdate);
  return () => {
    brandingListeners.delete(onUpdate);
  };
}

/**
 * Compresses and scales an image to ensure it fits comfortably in Firestore document and localStorage.
 */
export async function optimizeLogoImage(file: File, maxWidth = 800, maxHeight = 400): Promise<string> {
  // If SVG (vector), preserve vector sharpness directly as Data URL
  const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
  if (isSvg) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Export as PNG to preserve transparent backgrounds
        const optimized = canvas.toDataURL('image/png', 0.95);
        resolve(optimized);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Persists updated branding to both Firestore and LocalStorage.
 */
export async function saveBranding(updates: Partial<CompanyBranding>): Promise<CompanyBranding> {
  const activeCompany = getActiveCompany();
  const companyKey = `${STORAGE_KEY}_${activeCompany.id}`;
  const currentStored = safeAppStorage.getJSON<Partial<CompanyBranding>>(companyKey, {});
  const current = getStoredBranding();
  
  const next: CompanyBranding = {
    ...current,
    ...currentStored,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // 1. Immediately cache locally
  broadcastBranding(next);

  // 2. Persist to Firestore scoped to current company
  try {
    const docId = activeCompany.id === 'docks' ? 'branding' : `branding_${activeCompany.id}`;
    const brandingRef = doc(db, 'settings', docId);
    await setDoc(brandingRef, {
      ...next,
      useMainLogoAsOfficial: Boolean(next.useMainLogoAsOfficial),
      customLogo: next.customLogo || null
    }, { merge: true });
  } catch (error) {
    console.error('Failed to persist branding to Firestore:', error);
  }

  return next;
}

/**
 * Resets custom logo back to default system branding for active company.
 */
export async function resetBrandingToDefault(): Promise<CompanyBranding> {
  const activeCompany = getActiveCompany();
  const defaultB = getDefaultBranding(activeCompany);
  const next: CompanyBranding = {
    ...defaultB,
    useMainLogoAsOfficial: false,
    customLogo: null,
    updatedAt: new Date().toISOString(),
  };

  // 1. Immediately cache locally
  broadcastBranding(next);

  // 2. Persist to Firestore
  try {
    const docId = activeCompany.id === 'docks' ? 'branding' : `branding_${activeCompany.id}`;
    const brandingRef = doc(db, 'settings', docId);
    await setDoc(brandingRef, { 
      customLogo: null, 
      useMainLogoAsOfficial: false,
      updatedAt: next.updatedAt 
    }, { merge: true });
  } catch (error) {
    console.error('Failed to reset branding in Firestore:', error);
  }

  return next;
}

/**
 * React Hook for consuming and updating branding anywhere in the app.
 */
export function useBranding() {
  const { activeCompany } = useActiveCompany();
  const { parentGroup } = useParentGroup();
  const [branding, setBranding] = useState<CompanyBranding>(() => getStoredBranding());

  useEffect(() => {
    ensureFirestoreSubscription();
    setBranding(getStoredBranding());
    return subscribeToBranding((data) => {
      setBranding(data);
    });
  }, [activeCompany.id]);

  const defaultB = getDefaultBranding(activeCompany);

  const finalCompanyName = (activeCompany.id !== 'docks' && branding.companyName?.toLowerCase().includes('docks'))
    ? defaultB.companyName
    : (branding.companyName || defaultB.companyName);

  // Determine effective logo:
  // If useMainLogoAsOfficial is checked, use Main Group Logo
  let finalLogo: string | null = null;
  const isUseMain = Boolean(branding.useMainLogoAsOfficial);
  if (isUseMain && parentGroup.logo && isUploadedLogo(parentGroup.logo)) {
    finalLogo = parentGroup.logo;
  } else if (branding.customLogo && isUploadedLogo(branding.customLogo)) {
    finalLogo = branding.customLogo;
  }

  const effectiveBranding: CompanyBranding = {
    ...branding,
    useMainLogoAsOfficial: isUseMain,
    companyName: finalCompanyName,
    customLogo: finalLogo,
    subtitle: branding.subtitle || defaultB.subtitle,
    address: branding.address || defaultB.address,
    phone: branding.phone || defaultB.phone,
    cell: branding.cell || defaultB.cell,
    email: branding.email || defaultB.email,
    web: branding.web || defaultB.web,
    directorName: branding.directorName || defaultB.directorName,
    directorTitle: branding.directorTitle || defaultB.directorTitle,
  };

  return {
    branding: effectiveBranding,
    customLogo: finalLogo,
    activeLogo: finalLogo,
    useMainLogoAsOfficial: isUseMain,
    mainGroupLogo: parentGroup.logo || null,
    companyName: finalCompanyName,
    subtitle: branding.subtitle || defaultB.subtitle,
    address: branding.address || defaultB.address,
    phone: branding.phone || defaultB.phone,
    cell: branding.cell || defaultB.cell,
    email: branding.email || defaultB.email,
    web: branding.web || defaultB.web,
    directorName: branding.directorName || defaultB.directorName,
    directorTitle: branding.directorTitle || defaultB.directorTitle,
    isCustomLogo: isUseMain || (!!branding.customLogo && isUploadedLogo(branding.customLogo)),
    saveBranding,
    resetBrandingToDefault,
  };
}

import { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { safeAppStorage } from './storage';
import { getActiveCompany, getActiveCompanyId, subscribeToActiveCompany, useActiveCompany, CompanyInfo, GROUP_COMPANIES } from './companyService';

export interface CompanyBranding {
  customLogo: string | null;
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
export function getStoredBranding(): CompanyBranding {
  const activeCompany = getActiveCompany();
  const defaultB = getDefaultBranding(activeCompany);
  const companyKey = `${STORAGE_KEY}_${activeCompany.id}`;
  // Read ONLY this company's custom branding if set, do NOT fallback to global DPL storage key!
  const stored = safeAppStorage.getJSON<Partial<CompanyBranding>>(companyKey, {});

  // Determine correct company name according to active subsidiary:
  let companyName = defaultB.companyName;
  if (stored.companyName) {
    if (activeCompany.id !== 'docks' && stored.companyName.toLowerCase().includes('docks')) {
      companyName = defaultB.companyName;
    } else {
      companyName = stored.companyName;
    }
  }

  // Only allow explicitly uploaded custom logos (no default SVG files)
  const isUploaded = (src?: string | null) => Boolean(src && !src.startsWith('/logos/') && !src.includes('docks_logo') && !src.includes('mak_group_logo'));
  let companyLogo = isUploaded(stored.customLogo) ? stored.customLogo! : null;
  const subtitle = stored.subtitle || defaultB.subtitle;

  return {
    ...defaultB,
    ...stored,
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

// Recompute when active company changes
subscribeToActiveCompany((comp) => {
  activeBrandingCache = getStoredBranding();
  brandingListeners.forEach(fn => {
    try { fn(activeBrandingCache); } catch (_) {}
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BRANDING_EVENT, { detail: activeBrandingCache }));
  }
});

function ensureFirestoreSubscription() {
  if (firestoreUnsubscribe) return;
  try {
    const brandingRef = doc(db, 'settings', 'branding');
    firestoreUnsubscribe = onSnapshot(
      brandingRef,
      (docSnap) => {
        // If current company is not docks, Firestore settings doc must not overwrite it!
        const activeComp = getActiveCompany();
        if (activeComp.id !== 'docks') {
          activeBrandingCache = getStoredBranding();
          brandingListeners.forEach(fn => {
            try { fn(activeBrandingCache); } catch (_) {}
          });
          return;
        }

        if (docSnap.exists()) {
          const data = docSnap.data();
          const rawDocName = (data.companyName || '').trim();
          const normalizedDocName = (!rawDocName || rawDocName.toLowerCase() === 'docks (pvt.) ltd' || rawDocName.toLowerCase() === 'docks (pvt) ltd' || rawDocName.toLowerCase() === 'docks (pvt) ltd.')
            ? 'DOCKS (PVT) LTD.'
            : (data.companyName || DEFAULT_BRANDING.companyName);

          const merged: CompanyBranding = {
            customLogo: activeComp.logo,
            companyName: normalizedDocName,
            subtitle: data.subtitle || activeComp.tagline,
            address: data.address || DEFAULT_BRANDING.address,
            phone: data.phone || DEFAULT_BRANDING.phone,
            cell: data.cell || DEFAULT_BRANDING.cell,
            email: data.email || DEFAULT_BRANDING.email,
            web: data.web || DEFAULT_BRANDING.web,
            directorName: data.directorName || DEFAULT_BRANDING.directorName,
            directorTitle: data.directorTitle || DEFAULT_BRANDING.directorTitle,
            updatedAt: data.updatedAt,
            updatedBy: data.updatedBy,
          };

          // Only broadcast if content actually differs from current cache
          if (JSON.stringify(merged) !== JSON.stringify(activeBrandingCache)) {
            activeBrandingCache = merged;
            safeAppStorage.setJSON(STORAGE_KEY, merged);
            brandingListeners.forEach(fn => {
              try { fn(merged); } catch (_) {}
            });
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
  const current = getStoredBranding();
  const next: CompanyBranding = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // 1. Immediately cache locally
  broadcastBranding(next);

  // 2. Persist to Firestore scoped to current company
  try {
    const docId = activeCompany.id === 'docks' ? 'branding' : `branding_${activeCompany.id}`;
    const brandingRef = doc(db, 'settings', docId);
    await setDoc(brandingRef, next, { merge: true });
  } catch (error) {
    console.error('Failed to persist branding to Firestore:', error);
    // Still saved locally via broadcastBranding
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
    updatedAt: new Date().toISOString(),
  };

  // 1. Immediately cache locally
  broadcastBranding(next);

  // 2. Persist to Firestore
  try {
    const docId = activeCompany.id === 'docks' ? 'branding' : `branding_${activeCompany.id}`;
    const brandingRef = doc(db, 'settings', docId);
    await setDoc(brandingRef, { customLogo: null, updatedAt: next.updatedAt }, { merge: true });
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
  const [branding, setBranding] = useState<CompanyBranding>(() => getStoredBranding());

  useEffect(() => {
    setBranding(getStoredBranding());
    return subscribeToBranding((data) => {
      setBranding(data);
    });
  }, [activeCompany.id]);

  const defaultB = getDefaultBranding(activeCompany);

  const finalCompanyName = (activeCompany.id !== 'docks' && branding.companyName?.toLowerCase().includes('docks'))
    ? defaultB.companyName
    : (branding.companyName || defaultB.companyName);

  let finalLogo = branding.customLogo || defaultB.customLogo;
  if (activeCompany.id !== 'docks' && finalLogo && finalLogo.includes('docks_logo')) {
    finalLogo = defaultB.customLogo;
  }

  const effectiveBranding: CompanyBranding = {
    ...branding,
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
    companyName: finalCompanyName,
    subtitle: branding.subtitle || defaultB.subtitle,
    address: branding.address || defaultB.address,
    phone: branding.phone || defaultB.phone,
    cell: branding.cell || defaultB.cell,
    email: branding.email || defaultB.email,
    web: branding.web || defaultB.web,
    directorName: branding.directorName || defaultB.directorName,
    directorTitle: branding.directorTitle || defaultB.directorTitle,
    isCustomLogo: !!branding.customLogo && branding.customLogo !== defaultB.customLogo,
    saveBranding,
    resetBrandingToDefault,
  };
}

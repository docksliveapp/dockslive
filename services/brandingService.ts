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
    address: comp.address || 'Office No 13 1st Floor State Life Building No 7 G-Allana Road Tower Karachi',
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
  const stored = safeAppStorage.getRawJSON<Partial<CompanyBranding>>(companyKey, {});
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
    address: (stored.address && !stored.address.includes('14-B')) ? stored.address : defaultB.address,
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
            address: (data.address && !String(data.address).includes('14-B')) ? data.address : defaultB.address,
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
  safeAppStorage.setRawJSON(companyKey, branding);
  if (activeCompany.id === 'docks') {
    safeAppStorage.setRawJSON(STORAGE_KEY, branding);
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
 * Removes opaque white or light-grey rectangular/square corner backgrounds around circular/irregular logos
 * using a 4-corner BFS flood fill, preserving all interior white/pearl details inside the emblem border.
 */
function stripLogoSquareBackgroundFromCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  if (width < 8 || height < 8) return false;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Check if corners are already transparent
  const cornerCoords = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  let opaqueUniformCorners = 0;
  let refR = 0, refG = 0, refB = 0;

  for (const [cx, cy] of cornerCoords) {
    const idx = (cy * width + cx) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const brightness = (r + g + b) / 3;
    // Detect white or light-grey neutral square background in corners
    if (a > 200 && brightness >= 180 && (maxC - minC) <= 30) {
      opaqueUniformCorners++;
      refR += r;
      refG += g;
      refB += b;
    }
  }

  if (opaqueUniformCorners < 3) {
    return false;
  }

  refR /= opaqueUniformCorners;
  refG /= opaqueUniformCorners;
  refB /= opaqueUniformCorners;

  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isBgPixel = (pIdx: number): boolean => {
    const i = pIdx * 4;
    const a = data[i + 3];
    if (a <= 12) return true;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    if ((maxC - minC) > 32) return false;
    const brightness = (r + g + b) / 3;
    if (brightness < 182) return false;
    const dist = Math.abs(r - refR) + Math.abs(g - refG) + Math.abs(b - refB);
    return dist <= 95 || brightness >= 235;
  };

  // Seed flood-fill from perimeter pixels matching the corner background
  const tryEnqueue = (x: number, y: number) => {
    const pIdx = y * width + x;
    if (visited[pIdx]) return;
    if (isBgPixel(pIdx)) {
      visited[pIdx] = 1;
      queue[tail++] = pIdx;
    }
  };

  for (let x = 0; x < width; x++) {
    tryEnqueue(x, 0);
    tryEnqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryEnqueue(0, y);
    tryEnqueue(width - 1, y);
  }

  while (head < tail) {
    const curr = queue[head++];
    const cx = curr % width;
    const cy = (curr - cx) / width;
    data[curr * 4 + 3] = 0;

    if (cx > 0) tryEnqueue(cx - 1, cy);
    if (cx + 1 < width) tryEnqueue(cx + 1, cy);
    if (cy > 0) tryEnqueue(cx, cy - 1);
    if (cy + 1 < height) tryEnqueue(cx, cy + 1);
  }

  // Soft 1px edge anti-aliasing along boundary between removed exterior background and emblem rim
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const pIdx = y * width + x;
      if (visited[pIdx]) continue;
      let removedNeighbors = 0;
      if (visited[pIdx - 1]) removedNeighbors++;
      if (visited[pIdx + 1]) removedNeighbors++;
      if (visited[pIdx - width]) removedNeighbors++;
      if (visited[pIdx + width]) removedNeighbors++;
      if (removedNeighbors > 0) {
        const aIdx = pIdx * 4 + 3;
        data[aIdx] = Math.round(data[aIdx] * (1 - removedNeighbors * 0.14));
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return true;
}

const transparentLogoCache = new Map<string, string>();

export function stripLogoSquareBackground(src: string): Promise<string> {
  if (!src || typeof document === 'undefined') return Promise.resolve(src);
  if (src.startsWith('data:image/svg+xml') || src.endsWith('.svg')) return Promise.resolve(src);
  const cached = transparentLogoCache.get(src);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) {
          transparentLogoCache.set(src, src);
          resolve(src);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          transparentLogoCache.set(src, src);
          resolve(src);
          return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const modified = stripLogoSquareBackgroundFromCanvas(ctx, width, height);
        const out = modified ? canvas.toDataURL('image/png') : src;
        transparentLogoCache.set(src, out);
        resolve(out);
      } catch (_) {
        transparentLogoCache.set(src, src);
        resolve(src);
      }
    };
    img.onerror = () => {
      resolve(src);
    };
    img.src = src;
  });
}

export function useTransparentLogo(logoSrc?: string | null): string | null {
  const [cleanSrc, setCleanSrc] = useState<string | null>(() => {
    if (!logoSrc) return null;
    return transparentLogoCache.get(logoSrc) || null;
  });

  useEffect(() => {
    if (!logoSrc) {
      setCleanSrc(null);
      return;
    }
    const cached = transparentLogoCache.get(logoSrc);
    if (cached) {
      setCleanSrc(cached);
      return;
    }
    let active = true;
    stripLogoSquareBackground(logoSrc).then((cleaned) => {
      if (active) setCleanSrc(cleaned);
    });
    return () => {
      active = false;
    };
  }, [logoSrc]);

  return cleanSrc;
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
        stripLogoSquareBackgroundFromCanvas(ctx, width, height);

        // Export as PNG to preserve transparent backgrounds
        const optimized = canvas.toDataURL('image/png', 0.95);
        transparentLogoCache.set(optimized, optimized);
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
  const currentStored = safeAppStorage.getRawJSON<Partial<CompanyBranding>>(companyKey, {});
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

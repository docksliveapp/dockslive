/**
 * Safe browser storage wrapper that handles sandboxed iframes,
 * private browsing, and quota limit errors without crashing.
 */

/**
 * Safe browser storage wrapper that handles sandboxed iframes,
 * private browsing, and quota limit errors without crashing.
 */

// In-memory memory cache for bulletproof resilience when multitasking
const memoryCache: Record<string, string> = {};

// Storage keys that are partitioned per company
const COMPANY_PARTITIONED_KEYS = new Set([
  'dpl_live_cases',
  'dpl_live_finance',
  'dpl_live_receivables',
  'dpl_live_payables',
  'dpl_live_vehicles',
  'dpl_cached_vehicles',
  'dpl_clients',
  'dpl_company_documents',
  'dpl_vendors',
  'dpl_recurring_templates',
  'dpl_personal_ledger_accounts',
  'dpl_personal_ledger_entries',
  'dpl_staff_ledgers',
  'dpl_destination_staff',
  'dpl_company_branding_v1',
  'dpl_reg_formdata',
  'dpl_live_notifications',
  'dpl_cashbook_transactions',
  'dpl_payment_vouchers',
  'dpl_general_ledger_entries',
  'dpl_staff_salaries',
  'dpl_staff_members',
  'dpl_activity_logs',
  'dpl_category_tariffs',
  'dpl_vehicle_management_draft',
  'dpl_case_registration_draft'
]);

function resolveScopedStorageKey(key: string): string {
  if (!COMPANY_PARTITIONED_KEYS.has(key)) {
    return key;
  }
  try {
    let companyId = 'docks';
    if (typeof window !== 'undefined' && window.localStorage) {
      companyId = window.localStorage.getItem('dpl_active_company_id') || 'docks';
    } else if (memoryCache['dpl_active_company_id']) {
      companyId = memoryCache['dpl_active_company_id'];
    }
    if (companyId === 'docks') {
      return key;
    }
    return `${key}_${companyId}`;
  } catch (_) {
    return key;
  }
}

export const safeSessionStorage = {
  getItem: (key: string): string | null => {
    const scopedKey = resolveScopedStorageKey(key);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem(scopedKey);
      }
    } catch (_) {}
    return memoryCache[scopedKey] ?? null;
  },
  setItem: (key: string, value: string): void => {
    const scopedKey = resolveScopedStorageKey(key);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(scopedKey, value);
      }
    } catch (_) {}
    memoryCache[scopedKey] = value;
  },
  removeItem: (key: string): void => {
    const scopedKey = resolveScopedStorageKey(key);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(scopedKey);
      }
    } catch (_) {}
    delete memoryCache[scopedKey];
  }
};

export const safeLocalStorage = {
  getItem: (key: string): string | null => {
    const scopedKey = resolveScopedStorageKey(key);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(scopedKey);
      }
    } catch (_) {}
    return memoryCache[scopedKey] ?? null;
  },
  setItem: (key: string, value: string): void => {
    const scopedKey = resolveScopedStorageKey(key);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(scopedKey, value);
      }
    } catch (_) {}
    memoryCache[scopedKey] = value;
  },
  removeItem: (key: string): void => {
    const scopedKey = resolveScopedStorageKey(key);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(scopedKey);
      }
    } catch (_) {}
    delete memoryCache[scopedKey];
  }
};

/**
 * Universal Unified Storage:
 * Reads from in-memory, localStorage, or sessionStorage.
 * Writes to BOTH localStorage and sessionStorage as well as memoryCache.
 * Ensures state is NEVER lost if user switches to gallery, another app,
 * or if OS freezes / restores the browser tab.
 */
export const safeAppStorage = {
  getItem: (key: string): string | null => {
    const scopedKey = resolveScopedStorageKey(key);
    if (memoryCache[scopedKey] !== undefined) {
      return memoryCache[scopedKey];
    }
    const fromLocal = safeLocalStorage.getItem(scopedKey);
    if (fromLocal !== null) {
      memoryCache[scopedKey] = fromLocal;
      return fromLocal;
    }
    const fromSession = safeSessionStorage.getItem(scopedKey);
    if (fromSession !== null) {
      memoryCache[scopedKey] = fromSession;
      return fromSession;
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    const scopedKey = resolveScopedStorageKey(key);
    memoryCache[scopedKey] = value;
    safeLocalStorage.setItem(scopedKey, value);
    safeSessionStorage.setItem(scopedKey, value);
  },
  removeItem: (key: string): void => {
    const scopedKey = resolveScopedStorageKey(key);
    delete memoryCache[scopedKey];
    safeLocalStorage.removeItem(scopedKey);
    safeSessionStorage.removeItem(scopedKey);
  },
  clear: (): void => {
    Object.keys(memoryCache).forEach((k) => delete memoryCache[k]);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.clear();
      }
    } catch (_) {}
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.clear();
      }
    } catch (_) {}
  },
  wipeAppOperationalData: (preserveAuth: boolean = true): void => {
    const authUser = preserveAuth ? safeAppStorage.getItem('dpl_auth_user') : null;
    const userRole = preserveAuth ? safeAppStorage.getItem('dpl_user_role') : null;

    // 1. Clear memory cache for all dpl keys
    Object.keys(memoryCache).forEach((k) => {
      if (k.startsWith('dpl_') || k.startsWith('dpl-')) {
        delete memoryCache[k];
      }
    });

    // 2. Clear localStorage keys
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && (key.startsWith('dpl_') || key.startsWith('dpl-'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => window.localStorage.removeItem(k));
      }
    } catch (_) {}

    // 3. Clear sessionStorage keys
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key && (key.startsWith('dpl_') || key.startsWith('dpl-'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
      }
    } catch (_) {}

    // 4. Restore auth session if requested
    if (preserveAuth) {
      if (authUser) safeAppStorage.setItem('dpl_auth_user', authUser);
      if (userRole) safeAppStorage.setItem('dpl_user_role', userRole);
    }
  },
  getJSON: <T>(key: string, fallback: T): T => {
    try {
      const val = safeAppStorage.getItem(key);
      if (val) return JSON.parse(val) as T;
    } catch (_) {}
    return fallback;
  },
  setJSON: <T>(key: string, value: T): void => {
    try {
      safeAppStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }
};


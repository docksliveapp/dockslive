import React, { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { safeAppStorage } from '../services/storage';

export type AppThemeMode = 'charcoal' | 'pearl';

const THEME_STORAGE_KEY = 'dpl_app_theme';
const THEME_EVENT_NAME = 'dpl_theme_changed';

const themeListeners = new Set<(theme: AppThemeMode) => void>();

export function normalizeThemeMode(val: any): AppThemeMode {
  if (val === 'charcoal' || val === 'dark') return 'charcoal';
  return 'pearl';
}

export function getSavedAppTheme(): AppThemeMode {
  try {
    const saved = safeAppStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(THEME_STORAGE_KEY);
    if (!saved) return 'pearl';
    return normalizeThemeMode(saved);
  } catch (_) {
    return 'pearl';
  }
}

let currentThemeMemory: AppThemeMode = getSavedAppTheme();

export function applyAppThemeToDOM(rawTheme: AppThemeMode) {
  const theme = normalizeThemeMode(rawTheme);
  currentThemeMemory = theme;

  try {
    safeAppStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_) {}

  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const body = document.body;

  html.setAttribute('data-theme', theme);
  body.setAttribute('data-theme', theme);

  // Remove any legacy hardcoded dark utility classes on body that could block Pearl White
  body.classList.remove('bg-[#0B0F17]', 'bg-[#0F1115]', 'bg-slate-950', 'text-slate-100');

  if (theme === 'pearl') {
    html.classList.remove('theme-charcoal', 'dark');
    html.classList.add('theme-pearl', 'light');
    body.classList.remove('theme-charcoal', 'dark');
    body.classList.add('theme-pearl', 'light');
    body.style.backgroundColor = '#F8FAFC';
    body.style.color = '#0F172A';
  } else {
    html.classList.remove('theme-pearl', 'light');
    html.classList.add('theme-charcoal', 'dark');
    body.classList.remove('theme-pearl', 'light');
    body.classList.add('theme-charcoal', 'dark');
    body.style.backgroundColor = '#0B0F17';
    body.style.color = '#F8FAFC';
  }
}

export function setGlobalAppTheme(rawTheme: AppThemeMode) {
  const theme = normalizeThemeMode(rawTheme);
  applyAppThemeToDOM(theme);
  themeListeners.forEach((listener) => {
    try {
      listener(theme);
    } catch (_) {}
  });
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(THEME_EVENT_NAME, { detail: theme }));
      window.dispatchEvent(new CustomEvent('mak-theme-changed', { detail: theme }));
    } catch (_) {}
  }
}

export function useAppTheme(): [AppThemeMode, (next: AppThemeMode | ((prev: AppThemeMode) => AppThemeMode)) => void] {
  const [theme, setThemeState] = useState<AppThemeMode>(() => currentThemeMemory || getSavedAppTheme());

  useEffect(() => {
    // Ensure DOM matches current state on mount
    applyAppThemeToDOM(currentThemeMemory);
    setThemeState(currentThemeMemory);

    const listener = (newTheme: AppThemeMode) => {
      setThemeState(newTheme);
    };
    themeListeners.add(listener);

    const handleThemeEvent = (e: Event) => {
      const customEvent = e as CustomEvent<AppThemeMode>;
      if (customEvent.detail) {
        const normalized = normalizeThemeMode(customEvent.detail);
        currentThemeMemory = normalized;
        setThemeState(normalized);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        const normalized = normalizeThemeMode(e.newValue);
        applyAppThemeToDOM(normalized);
        setThemeState(normalized);
      }
    };

    window.addEventListener(THEME_EVENT_NAME, handleThemeEvent);
    window.addEventListener('mak-theme-changed', handleThemeEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      themeListeners.delete(listener);
      window.removeEventListener(THEME_EVENT_NAME, handleThemeEvent);
      window.removeEventListener('mak-theme-changed', handleThemeEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const updateTheme = (next: AppThemeMode | ((prev: AppThemeMode) => AppThemeMode)) => {
    const prev = currentThemeMemory || getSavedAppTheme();
    const resolved = normalizeThemeMode(typeof next === 'function' ? next(prev) : next);
    setGlobalAppTheme(resolved);
  };

  return [theme, updateTheme];
}

interface ThemeToggleSwitchProps {
  theme?: AppThemeMode;
  onChange?: (theme: AppThemeMode) => void;
  compact?: boolean;
  className?: string;
}

/**
 * Single Unified Left/Right Luxury Sliding Switch:
 * - Left position  = Dark (Charcoal)
 * - Right position = Light (Pearl White)
 */
export const ThemeToggleSwitch: React.FC<ThemeToggleSwitchProps> = ({
  theme: controlledTheme,
  onChange,
  compact = false,
  className = ''
}) => {
  const [internalTheme, setInternalTheme] = useAppTheme();
  const activeTheme = controlledTheme ? normalizeThemeMode(controlledTheme) : internalTheme;
  const isPearl = activeTheme === 'pearl';

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next: AppThemeMode = isPearl ? 'charcoal' : 'pearl';
    setInternalTheme(next);
    if (onChange) onChange(next);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        className={`relative inline-flex items-center h-8 w-16 rounded-full p-1 transition-all duration-300 cursor-pointer select-none border shadow-sm ${
          isPearl
            ? 'bg-[#E2E8F0] border-[#CBD5E1] text-[#0F172A]'
            : 'bg-[#111827] border-[#334155] text-[#F8FAFC]'
        } ${className}`}
        title={isPearl ? 'Slide Left for Charcoal Dark Theme' : 'Slide Right for Pearl White Theme'}
        aria-label="Toggle Theme Left Charcoal Dark Right Pearl White"
      >
        <span className="sr-only">Toggle Theme</span>
        {/* Background Icons */}
        <span className="w-full flex items-center justify-between px-1.5 pointer-events-none">
          <Moon size={11} className={isPearl ? 'text-[#64748B]' : ' opacity-0'} />
          <Sun size={11} className={isPearl ? 'opacity-0' : 'text-[#94A3B8]'} />
        </span>
        {/* Sliding Thumb */}
        <span
          className={`absolute top-0.5 bottom-0.5 w-7 rounded-full flex items-center justify-center transition-transform duration-300 shadow-md ${
            isPearl
              ? 'translate-x-7 bg-[#1E293B] text-[#FFFFFF]'
              : 'translate-x-0 bg-[#334155] text-[#F8FAFC]'
          }`}
        >
          {isPearl ? <Sun size={12} /> : <Moon size={12} />}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`relative inline-flex items-center h-8 w-[148px] rounded-full p-1 transition-all duration-300 cursor-pointer select-none border shadow-sm ${
        isPearl
          ? 'bg-[#E2E8F0] border-[#CBD5E1]'
          : 'bg-[#0F172A] border-[#334155]'
      } ${className}`}
      title={isPearl ? 'Click to switch Left to Charcoal (Dark)' : 'Click to switch Right to Pearl White (Light)'}
      aria-label="Theme Switcher: Left is Charcoal Dark, Right is Pearl White"
    >
      {/* Sliding Luxury Pill Thumb */}
      <span
        className={`absolute top-1 bottom-1 w-[70px] rounded-full transition-all duration-300 ease-out shadow-md ${
          isPearl
            ? 'translate-x-[68px] bg-[#1E293B] border border-[#0F172A]'
            : 'translate-x-0 bg-[#2D3748] border border-[#475569]'
        }`}
      />

      {/* Left Option: Charcoal (Dark) */}
      <span
        className={`relative z-10 flex-1 flex items-center justify-center gap-1 text-[11px] font-bold tracking-wide transition-colors duration-200 ${
          !isPearl ? 'text-[#FFFFFF]' : 'text-[#475569]'
        }`}
      >
        <Moon size={12} className={!isPearl ? 'text-[#E2E8F0]' : 'text-[#64748B]'} />
        <span>Dark</span>
      </span>

      {/* Right Option: Pearl White (Light) */}
      <span
        className={`relative z-10 flex-1 flex items-center justify-center gap-1 text-[11px] font-bold tracking-wide transition-colors duration-200 ${
          isPearl ? 'text-[#FFFFFF]' : 'text-[#94A3B8]'
        }`}
      >
        <Sun size={12} className={isPearl ? 'text-[#FFFFFF]' : 'text-[#94A3B8]'} />
        <span>Pearl</span>
      </span>
    </button>
  );
};

export default ThemeToggleSwitch;

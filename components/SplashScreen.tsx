import React, { useEffect, useState, useRef } from 'react';
import { useParentGroup, getMainGroupLogoUrl } from '../services/companyService';
import { useTransparentLogo } from '../services/brandingService';
import { useAppTheme } from './ThemeToggleSwitch';

interface SplashScreenProps {
  onComplete: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const { parentGroup } = useParentGroup();
  const [appTheme] = useAppTheme();
  const isPearl = appTheme === 'pearl';
  const [fadingOut, setFadingOut] = useState(false);
  const [mounted, setMounted] = useState(false);
  const hasFinishedRef = useRef(false);

  const handleFinish = () => {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;
    setFadingOut(true);
    setTimeout(() => {
      onComplete();
    }, 340);
  };

  useEffect(() => {
    const enterTimer = requestAnimationFrame(() => {
      setMounted(true);
    });

    const exitTimer = setTimeout(() => {
      handleFinish();
    }, 1750);

    return () => {
      cancelAnimationFrame(enterTimer);
      clearTimeout(exitTimer);
    };
  }, []);

  const rawMainLogo = getMainGroupLogoUrl(parentGroup, appTheme);
  const cleanedMainLogo = useTransparentLogo(rawMainLogo);
  const displayMainLogo = cleanedMainLogo || rawMainLogo;

  return (
    <div
      onClick={handleFinish}
      onTouchStart={handleFinish}
      role="button"
      tabIndex={0}
      aria-label="Welcome screen - Click or tap to continue to login"
      className={`fixed inset-0 z-[100] flex items-center justify-center p-6 select-none transition-all duration-300 ease-out overflow-hidden cursor-pointer ${
        isPearl
          ? 'bg-gradient-to-b from-[#F9FBFE] via-[#F2F6FC] to-[#E8EFF8] text-slate-900'
          : 'bg-gradient-to-b from-[#090D16] via-[#0F172A] to-[#090D16] text-white'
      } ${fadingOut ? 'opacity-0 scale-[1.04] pointer-events-none' : 'opacity-100 scale-100'}`}
    >
      <style>{`
        @keyframes makEmblemEntrance {
          0% {
            opacity: 0;
            transform: scale(0.86) translateY(14px);
          }
          65% {
            opacity: 1;
            transform: scale(1.02) translateY(-2px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0px);
          }
        }
        @keyframes makEmblemLevitate {
          0%, 100% {
            transform: translateY(0px) scale(1);
          }
          50% {
            transform: translateY(-6px) scale(1.015);
          }
        }
        @keyframes makAuraBreathe {
          0%, 100% {
            opacity: 0.45;
            transform: scale(0.96);
          }
          50% {
            opacity: 0.85;
            transform: scale(1.06);
          }
        }
        @keyframes makSheenSweep {
          0% {
            transform: translateX(-140%) rotate(25deg);
            opacity: 0;
          }
          25% {
            opacity: 0.45;
          }
          65% {
            transform: translateX(140%) rotate(25deg);
            opacity: 0;
          }
          100% {
            transform: translateX(140%) rotate(25deg);
            opacity: 0;
          }
        }
        @keyframes makProgressBar {
          0% {
            width: 0%;
          }
          100% {
            width: 100%;
          }
        }
      `}</style>

      {/* Main MAK Group Logo Presentation — Preserves Full Wide Aspect Ratio (Zero Circle Crop) */}
      <div
        className={`relative flex flex-col items-center justify-center z-10 w-full max-w-[460px] ${
          mounted ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          animation: mounted
            ? 'makEmblemEntrance 0.72s cubic-bezier(0.22, 1, 0.36, 1) forwards'
            : undefined
        }}
      >
        {/* Soft Ambient Radial Aura */}
        <div
          className="absolute w-[320px] h-[200px] sm:w-[440px] sm:h-[260px] rounded-full blur-2xl pointer-events-none -z-10"
          style={{
            background: isPearl
              ? 'radial-gradient(ellipse, rgba(255,255,255,0.95) 0%, rgba(203,213,225,0.35) 60%, transparent 78%)'
              : 'radial-gradient(ellipse, rgba(56,189,248,0.16) 0%, rgba(15,23,42,0.25) 60%, transparent 78%)',
            animation: 'makAuraBreathe 2.8s ease-in-out infinite'
          }}
        />

        {/* Levitating Wide Logo Display — 100% Frameless & Transparent in Both Pearl & Dark Modes */}
        <div
          className="relative overflow-hidden flex items-center justify-center px-2 py-2 bg-transparent transition-all"
          style={{
            animation: mounted ? 'makEmblemLevitate 3.2s ease-in-out 0.72s infinite' : undefined
          }}
        >
          <img
            src={displayMainLogo}
            alt={parentGroup?.name || 'MAK Group of Companies'}
            className="w-72 sm:w-96 lg:w-[420px] h-auto max-h-56 object-contain bg-transparent drop-shadow-[0_14px_30px_rgba(15,23,42,0.16)] select-none"
          />

          {/* Subtle Diagonal Specular Light Sweep */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div
              className="w-1/2 h-[180%] -top-[40%] relative bg-gradient-to-r from-transparent via-white/45 to-transparent"
              style={{ animation: 'makSheenSweep 2.1s ease-in-out 0.25s infinite' }}
            />
          </div>
        </div>

        {/* Sleek Minimal Loading Progress Line */}
        <div className={`mt-6 w-40 sm:w-48 h-1 rounded-full overflow-hidden ${isPearl ? 'bg-slate-300/60' : 'bg-white/15'}`}>
          <div
            className={`h-full rounded-full ${isPearl ? 'bg-slate-800' : 'bg-amber-400'}`}
            style={{ animation: 'makProgressBar 1.55s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
          />
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;

import React, { useEffect, useState, useRef } from 'react';
import { useParentGroup, isUploadedLogo } from '../services/companyService';
import { useBranding, useTransparentLogo } from '../services/brandingService';
import { safeAppStorage } from '../services/storage';
import { useAppTheme } from './ThemeToggleSwitch';

interface SplashScreenProps {
  onComplete: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const { parentGroup } = useParentGroup();
  const { customLogo: brandingLogo } = useBranding();
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

  const storedParentLogo = safeAppStorage.getJSON<any>('mak_parent_group_branding', {})?.logo;
  const candidateLogo = parentGroup?.logo || brandingLogo || storedParentLogo;
  const adminUploadedLogo = isUploadedLogo(candidateLogo) ? candidateLogo : null;
  const cleanedUploadedLogo = useTransparentLogo(adminUploadedLogo);
  const displayRoundLogo = cleanedUploadedLogo || '/mak_pearl_grey_edge.png';

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
            transform: scale(0.72) translateY(14px);
          }
          65% {
            opacity: 1;
            transform: scale(1.04) translateY(-2px);
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
            transform: translateY(-8px) scale(1.022);
          }
        }
        @keyframes makOrbitCw {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes makOrbitCcw {
          from {
            transform: rotate(360deg);
          }
          to {
            transform: rotate(0deg);
          }
        }
        @keyframes makAuraBreathe {
          0%, 100% {
            opacity: 0.45;
            transform: scale(0.96);
          }
          50% {
            opacity: 0.85;
            transform: scale(1.08);
          }
        }
        @keyframes makSheenSweep {
          0% {
            transform: translateX(-140%) rotate(25deg);
            opacity: 0;
          }
          25% {
            opacity: 0.55;
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
        @keyframes makRingProgress {
          0% {
            stroke-dashoffset: 760;
          }
          100% {
            stroke-dashoffset: 0;
          }
        }
      `}</style>

      {/* Pure Circular Concentric Orbital Rings (No Square or Card Container) */}
      <div
        className={`absolute w-[290px] h-[290px] sm:w-[390px] sm:h-[390px] lg:w-[450px] lg:h-[450px] rounded-full border pointer-events-none ${
          isPearl ? 'border-slate-300/55' : 'border-white/10'
        }`}
        style={{ animation: 'makOrbitCw 36s linear infinite' }}
      />
      <div
        className={`absolute w-[248px] h-[248px] sm:w-[332px] sm:h-[332px] lg:w-[382px] lg:h-[382px] rounded-full border border-dashed pointer-events-none ${
          isPearl ? 'border-slate-400/45' : 'border-sky-400/20'
        }`}
        style={{ animation: 'makOrbitCcw 24s linear infinite' }}
      />

      {/* Pure Round Animated Logo Medallion — Zero Square Background */}
      <div
        className={`relative flex items-center justify-center z-10 ${
          mounted ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          animation: mounted
            ? 'makEmblemEntrance 0.72s cubic-bezier(0.22, 1, 0.36, 1) forwards'
            : undefined
        }}
      >
        {/* Soft Circular Radial Halo Behind Round Logo */}
        <div
          className="absolute w-56 h-56 sm:w-72 sm:h-72 lg:w-80 lg:h-80 rounded-full pointer-events-none -z-10"
          style={{
            background: isPearl
              ? 'radial-gradient(circle, rgba(255,255,255,0.92) 0%, rgba(203,213,225,0.38) 54%, transparent 74%)'
              : 'radial-gradient(circle, rgba(56,189,248,0.18) 0%, rgba(15,23,42,0.35) 58%, transparent 75%)',
            animation: 'makAuraBreathe 2.8s ease-in-out infinite'
          }}
        />

        {/* Circular SVG Progress Sweep Hugging the Round Emblem */}
        <svg
          viewBox="0 0 260 260"
          className="absolute w-56 h-56 sm:w-72 sm:h-72 lg:w-80 lg:h-80 -rotate-90 pointer-events-none"
          aria-hidden="true"
        >
          <circle
            cx="130"
            cy="130"
            r="121"
            fill="none"
            stroke={isPearl ? 'rgba(148, 163, 184, 0.22)' : 'rgba(255, 255, 255, 0.08)'}
            strokeWidth="2"
          />
          <circle
            cx="130"
            cy="130"
            r="121"
            fill="none"
            stroke={isPearl ? 'rgba(15, 23, 42, 0.65)' : 'rgba(56, 189, 248, 0.75)'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="760"
            strokeDashoffset="760"
            style={{ animation: 'makRingProgress 1.55s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
          />
        </svg>

        {/* Levitating Pure Round Emblem with Clipped Circular Glossy Sheen */}
        <div
          className="relative w-48 h-48 sm:w-60 sm:h-60 lg:w-68 lg:h-68 rounded-full flex items-center justify-center bg-transparent"
          style={{
            animation: mounted ? 'makEmblemLevitate 3.2s ease-in-out 0.72s infinite' : undefined
          }}
        >
          <img
            src={displayRoundLogo}
            alt={parentGroup?.name || 'MAK Group of Companies'}
            className="w-full h-full rounded-full object-contain bg-transparent drop-shadow-[0_18px_36px_rgba(15,23,42,0.22)] select-none"
          />

          {/* Circular-Clipped Specular Light Sweep */}
          <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
            <div
              className="w-1/2 h-[180%] -top-[40%] relative bg-gradient-to-r from-transparent via-white/55 to-transparent"
              style={{ animation: 'makSheenSweep 2.1s ease-in-out 0.25s infinite' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;

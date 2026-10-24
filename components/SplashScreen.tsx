import React, { useEffect, useState, useRef } from 'react';
import { useParentGroup, isUploadedLogo } from '../services/companyService';
import { useBranding } from '../services/brandingService';
import { safeAppStorage } from '../services/storage';

interface SplashScreenProps {
  onComplete: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const { parentGroup } = useParentGroup();
  const { customLogo: brandingLogo } = useBranding();
  const [fadingOut, setFadingOut] = useState(false);
  const [mounted, setMounted] = useState(false);
  const hasFinishedRef = useRef(false);

  const handleFinish = () => {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;
    setFadingOut(true);
    setTimeout(() => {
      onComplete();
    }, 320);
  };

  useEffect(() => {
    const enterTimer = requestAnimationFrame(() => {
      setMounted(true);
    });

    const exitTimer = setTimeout(() => {
      handleFinish();
    }, 1450);

    return () => {
      cancelAnimationFrame(enterTimer);
      clearTimeout(exitTimer);
    };
  }, []);

  const storedParentLogo = safeAppStorage.getJSON<any>('mak_parent_group_branding', {})?.logo;
  const candidateLogo = parentGroup?.logo || brandingLogo || storedParentLogo;
  const adminUploadedLogo = isUploadedLogo(candidateLogo) ? candidateLogo : null;

  return (
    <div
      onClick={handleFinish}
      onTouchStart={handleFinish}
      role="button"
      tabIndex={0}
      aria-label="Welcome screen - Click or tap to continue to login"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center p-6 select-none bg-gradient-to-b from-[#FAFBFD] via-[#F4F7FB] to-[#EDF2F8] text-slate-900 transition-all duration-300 ease-out overflow-hidden cursor-pointer ${
        fadingOut ? 'opacity-0 scale-[1.03] pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      <style>{`
        @keyframes dplFloat {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-6px);
          }
        }
        @keyframes dplPulsePearl {
          0%, 100% {
            opacity: 0.5;
            transform: scale(1);
          }
          50% {
            opacity: 0.85;
            transform: scale(1.06);
          }
        }
        @keyframes dplSpinSlow {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes dplReverseSpinSlow {
          from {
            transform: rotate(360deg);
          }
          to {
            transform: rotate(0deg);
          }
        }
        @keyframes dplProgressSweep {
          0% {
            width: 12%;
            opacity: 0.7;
          }
          100% {
            width: 100%;
            opacity: 1;
          }
        }
      `}</style>

      {/* ============================================================ */}
      {/* 1. LUXURY PEARL WHITE GLASSY AMBIENT CANVAS                   */}
      {/* ============================================================ */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 80% 55% at 50% 42%, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.94) 55%, rgba(237, 242, 248, 0.96) 100%)
          `
        }}
      />

      {/* Soft Architectural Pearl Glass Rings */}
      <div
        className="absolute w-[300px] h-[300px] sm:w-[440px] sm:h-[440px] lg:w-[520px] lg:h-[520px] rounded-full border border-slate-200/80 pointer-events-none"
        style={{ animation: 'dplSpinSlow 60s linear infinite' }}
      />
      <div
        className="absolute w-[230px] h-[230px] sm:w-[340px] sm:h-[340px] lg:w-[400px] lg:h-[400px] rounded-full border border-slate-300/50 border-dashed pointer-events-none"
        style={{ animation: 'dplReverseSpinSlow 45s linear infinite' }}
      />

      {/* ============================================================ */}
      {/* 2. CENTERED EXECUTIVE PEARL GLASS EMBLEM                      */}
      {/* ============================================================ */}
      <div className="relative flex flex-col items-center justify-center z-10 px-4 text-center">
        {/* Soft Pearl & Champagne Aura Behind Logo */}
        <div
          className="absolute w-64 sm:w-80 lg:w-96 h-64 sm:h-80 lg:h-96 rounded-full pointer-events-none -z-10"
          style={{
            background: 'radial-gradient(circle, rgba(255, 255, 255, 0.95) 0%, rgba(226, 232, 240, 0.45) 55%, transparent 75%)',
            animation: 'dplPulsePearl 3.5s ease-in-out infinite'
          }}
        />

        <div
          className={`relative p-6 sm:p-8 rounded-[2.25rem] bg-white/75 backdrop-blur-2xl border border-white/90 shadow-[0_24px_60px_-15px_rgba(15,23,42,0.08),inset_0_1px_0_0_rgba(255,255,255,0.95)] transition-all duration-700 ease-out transform ${
            mounted
              ? 'opacity-100 scale-100 translate-y-0'
              : 'opacity-0 scale-95 translate-y-3'
          }`}
          style={{
            animation: mounted ? 'dplFloat 4s ease-in-out infinite' : undefined
          }}
        >
          <img
            src={adminUploadedLogo || '/logos/mak_pearl_white_emblem.svg'}
            alt={parentGroup?.name || 'MAK Group of Companies'}
            className="w-44 sm:w-56 md:w-64 lg:w-72 max-h-48 sm:max-h-56 lg:max-h-64 object-contain drop-shadow-[0_12px_28px_rgba(15,23,42,0.10)] select-none mx-auto"
          />

          {/* Subtle Smooth Loading Progress Bar */}
          <div className="mt-5 w-36 sm:w-44 mx-auto h-1 rounded-full bg-slate-200/80 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-slate-700 via-slate-900 to-slate-700"
              style={{ animation: 'dplProgressSweep 1.35s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;

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
    }, 300);
  };

  useEffect(() => {
    const enterTimer = requestAnimationFrame(() => {
      setMounted(true);
    });

    const exitTimer = setTimeout(() => {
      handleFinish();
    }, 1400);

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
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center p-6 select-none bg-gradient-to-b from-[#FFFFFF] via-[#F8FAFC] to-[#F1F5F9] text-slate-900 transition-all duration-300 ease-out overflow-hidden cursor-pointer ${
        fadingOut ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'
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
            opacity: 0.45;
            transform: scale(1);
          }
          50% {
            opacity: 0.75;
            transform: scale(1.08);
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
      `}</style>

      {/* ============================================================ */}
      {/* 1. LUXURY PEARL WHITE AMBIENT CANVAS (NO DOTS OR CLUTTER)     */}
      {/* ============================================================ */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 85% 60% at 50% 45%, #FFFFFF 0%, rgba(248, 250, 252, 0.96) 55%, #F1F5F9 100%)
          `
        }}
      />

      {/* Soft Architectural Pearl Rings */}
      <div
        className="absolute w-[320px] h-[320px] sm:w-[460px] sm:h-[460px] lg:w-[540px] lg:h-[540px] rounded-full border border-slate-200/80 pointer-events-none"
        style={{ animation: 'dplSpinSlow 60s linear infinite' }}
      />
      <div
        className="absolute w-[250px] h-[250px] sm:w-[360px] sm:h-[360px] lg:w-[420px] lg:h-[420px] rounded-full border border-slate-200/60 border-dashed pointer-events-none"
        style={{ animation: 'dplReverseSpinSlow 45s linear infinite' }}
      />

      {/* ============================================================ */}
      {/* 2. CENTERED EXECUTIVE EMBLEM                                  */}
      {/* ============================================================ */}
      <div className="relative flex flex-col items-center justify-center z-10 px-4 text-center">
        {/* Soft Pearl & Champagne Aura Behind Logo */}
        <div
          className="absolute w-64 sm:w-80 lg:w-96 h-64 sm:h-80 lg:h-96 rounded-full pointer-events-none -z-10"
          style={{
            background: 'radial-gradient(circle, rgba(226, 232, 240, 0.65) 0%, rgba(241, 245, 249, 0.3) 55%, transparent 75%)',
            animation: 'dplPulsePearl 3.5s ease-in-out infinite'
          }}
        />

        <div
          className={`relative transition-all duration-700 ease-out transform ${
            mounted
              ? 'opacity-100 scale-100 translate-y-0'
              : 'opacity-0 scale-95 translate-y-2'
          }`}
          style={{
            animation: mounted ? 'dplFloat 4s ease-in-out infinite' : undefined
          }}
        >
          <img
            src={adminUploadedLogo || '/logos/mak_pearl_white_emblem.svg'}
            alt={parentGroup?.name || 'MAK Group'}
            className="w-48 sm:w-64 md:w-72 lg:w-80 max-h-56 sm:max-h-64 lg:max-h-72 object-contain drop-shadow-[0_14px_34px_rgba(15,23,42,0.12)] select-none mx-auto"
          />
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;

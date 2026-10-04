import React, { useState } from 'react';
import { useBranding } from '../services/brandingService';
import { useActiveCompany, isUploadedLogo } from '../services/companyService';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'icon';
  customSrc?: string | null;
}

const Logo: React.FC<LogoProps> = ({ className = "", variant = 'full', customSrc }) => {
  const { customLogo: globalLogo, companyName } = useBranding();
  const { activeCompany } = useActiveCompany();
  const [imgError, setImgError] = useState(false);

  const candidateLogo = customSrc !== undefined ? customSrc : (globalLogo || activeCompany?.logo);

  if (isUploadedLogo(candidateLogo) && !imgError) {
    return (
      <img 
        src={candidateLogo!} 
        alt={companyName || activeCompany?.name || "Company Logo"} 
        className={`${className} object-contain select-none transition-all duration-300`}
        onError={() => setImgError(true)}
      />
    );
  }

  // If no custom logo has been uploaded, render a clean, high-class corporate monogram badge
  const shortTitle = activeCompany?.shortName || (companyName ? companyName.substring(0, 3).toUpperCase() : 'MAK');

  return (
    <div 
      className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 via-slate-900 to-black border border-amber-500/40 text-amber-300 font-extrabold font-serif px-2.5 py-1 select-none shadow-md ${className}`}
      title={activeCompany?.name || companyName || "Company"}
    >
      <span className="tracking-wider text-xs sm:text-sm font-mono">{shortTitle}</span>
    </div>
  );
};

export default Logo;

import React, { useState } from 'react';
import { useBranding, useTransparentLogo } from '../services/brandingService';
import { useActiveCompany, isUploadedLogo } from '../services/companyService';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'icon';
  customSrc?: string | null;
}

const Logo: React.FC<LogoProps> = ({ className = "h-14 sm:h-16 w-auto", customSrc }) => {
  const { customLogo: globalLogo, companyName } = useBranding();
  const { activeCompany } = useActiveCompany();
  const [imgError, setImgError] = useState(false);

  const rawCandidate = customSrc !== undefined 
    ? customSrc 
    : (globalLogo || activeCompany?.logo || '');

  const isMainLogoAsset = typeof rawCandidate === 'string' && rawCandidate.includes('mak_main_logo');
  const candidateLogo = (isUploadedLogo(rawCandidate) || isMainLogoAsset) ? rawCandidate : null;
  const processedLogo = useTransparentLogo(isMainLogoAsset ? null : candidateLogo);
  const cleanLogo = isMainLogoAsset ? candidateLogo : (processedLogo || candidateLogo);

  if (cleanLogo && !imgError) {
    return (
      <img 
        src={cleanLogo} 
        alt={companyName || activeCompany?.name || "Company Logo"} 
        className={`${className} bg-transparent object-contain select-none transition-all duration-300 drop-shadow-sm`}
        onError={() => setImgError(true)}
      />
    );
  }

  // Strictly empty when no uploaded logo exists
  return null;
};

export default Logo;

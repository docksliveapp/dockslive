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

  // Official MAK Group Corporate Medallion Logo
  return (
    <img 
      src="/logos/mak_group_logo.svg" 
      alt="MAK Group of Companies" 
      className={`${className} object-contain select-none transition-all duration-300`}
      onError={() => setImgError(true)}
    />
  );
};

export default Logo;

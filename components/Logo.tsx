import React, { useState } from 'react';
import { useBranding } from '../services/brandingService';
import { useActiveCompany } from '../services/companyService';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'icon';
  customSrc?: string | null;
}

const Logo: React.FC<LogoProps> = ({ className = "", variant = 'full', customSrc }) => {
  const { customLogo: globalLogo, companyName } = useBranding();
  const { activeCompany } = useActiveCompany();
  const [imgError, setImgError] = useState(false);

  const defaultSrc = activeCompany?.logo || '/logos/docks_logo.svg';
  const fallbackSrc = activeCompany?.logo || '/logos/docks_logo.svg';
  const activeLogo = customSrc !== undefined ? (customSrc || defaultSrc) : (globalLogo || defaultSrc);

  if (activeLogo && !imgError) {
    return (
      <img 
        src={activeLogo} 
        alt={companyName || activeCompany?.name || "Company Logo"} 
        className={`${className} object-contain select-none transition-all duration-300`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <img 
      src={fallbackSrc} 
      alt={activeCompany?.name || "Company Logo"} 
      className={`${className} object-contain select-none`} 
    />
  );
};

export default Logo;

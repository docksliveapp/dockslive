import React, { useState } from 'react';
import { useBranding } from '../services/brandingService';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'icon';
  customSrc?: string | null;
}

const Logo: React.FC<LogoProps> = ({ className = "", variant = 'full', customSrc }) => {
  const { customLogo: globalLogo, companyName } = useBranding();
  const [imgError, setImgError] = useState(false);

  const defaultSrc = '/logo.svg';
  const fallbackSrc = '/logo.svg';
  const activeLogo = customSrc !== undefined ? (customSrc || defaultSrc) : (globalLogo || defaultSrc);

  if (activeLogo && !imgError) {
    return (
      <img 
        src={activeLogo} 
        alt={companyName || "DPL Logo"} 
        className={`${className} object-contain select-none transition-all duration-300`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <img 
      src={fallbackSrc} 
      alt="DPL Logo" 
      className={`${className} object-contain select-none`} 
    />
  );
};

export default Logo;

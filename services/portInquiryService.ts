import { safeAppStorage } from './storage';
import { PortItem } from '../types';

export const DEFAULT_PORT_INQUIRY_LINKS: Record<string, string> = {
  'KICT': 'https://www.kictl.com',
  'KARACHI INTERNATIONAL CONTAINER TERMINAL': 'https://www.kictl.com',
  'QICT': 'https://www.dpworld.com/karachi',
  'PORT QASIM': 'https://www.dpworld.com/karachi',
  'DP WORLD': 'https://www.dpworld.com/karachi',
  'SAPT': 'https://www.sapt.com.pk',
  'SOUTH ASIA PAKISTAN TERMINALS': 'https://www.sapt.com.pk',
  'KPT': 'https://kpt.gov.pk',
  'KARACHI PORT TRUST': 'https://kpt.gov.pk',
  'PICT': 'https://pict.com.pk',
  'PAKISTAN INTERNATIONAL CONTAINER TERMINAL': 'https://pict.com.pk'
};

export function getPortInquiryLink(portNameOrCode?: string): string {
  if (!portNameOrCode) {
    return 'https://www.kictl.com';
  }

  const query = portNameOrCode.trim().toUpperCase();

  // 1. Check in stored custom ports in safeAppStorage
  try {
    const savedPorts = safeAppStorage.getJSON<PortItem[]>('dpl_ports', []);
    if (Array.isArray(savedPorts) && savedPorts.length > 0) {
      const match = savedPorts.find(p => 
        (p.name && (p.name.toUpperCase() === query || p.name.toUpperCase().includes(query) || query.includes(p.name.toUpperCase()))) ||
        (p.code && (p.code.toUpperCase() === query || query.includes(p.code.toUpperCase())))
      );
      if (match?.containerInquiryLink && match.containerInquiryLink.trim()) {
        return match.containerInquiryLink.trim();
      }
    }
  } catch (err) {
    console.warn('Error reading ports from storage:', err);
  }

  // 2. Check in known defaults
  for (const [key, url] of Object.entries(DEFAULT_PORT_INQUIRY_LINKS)) {
    if (query.includes(key) || key.includes(query)) {
      return url;
    }
  }

  // Fallback to KICT official portal
  return 'https://www.kictl.com';
}

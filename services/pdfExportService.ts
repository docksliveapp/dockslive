import { jsPDF } from 'jspdf';
import { Case, Container, Vehicle, FinanceEntry, SalaryStaffMember, StaffSalaryHistoryRow, StaffAttendanceRecord } from '../types';
import { getStoredBranding, getDefaultBranding } from './brandingService';
import { 
  getActiveCompany, 
  getActiveCompanyPrefix, 
  isUploadedLogo,
  getCompanyUploadedLogo,
  getParentGroupInfo,
  getMainGroupLogoUrl,
  getMainGroupDocumentLogoUrl,
  MAIN_GROUP_LOGO_URL,
  DEFAULT_PARENT_GROUP,
  CompanyId,
  GROUP_COMPANIES
} from './companyService';

export interface PdfExportOptions {
  onlyInvoice?: boolean;
  withInvoice?: boolean;
  withAttachments?: boolean;
  includeAttachments?: boolean;
  previewOnly?: boolean;
  onlyCaseDetails?: boolean;
  accentColor?: [number, number, number];
}

export interface BrandingInfo {
  companyName?: string;
  subtitle?: string;
  customLogo?: string | null;
  address?: string;
  phone?: string;
  cell?: string;
  email?: string;
  web?: string;
  directorName?: string;
  directorTitle?: string;
}

export interface RenderedPdfLogo {
  dataUrl: string;
  aspectRatio: number;
  width: number;
  height: number;
}

let cachedMakLogoPngUrl: string | null = null;
const preservedLogoCache = new Map<string, RenderedPdfLogo>();

/**
 * Formats any date or ISO timestamp (e.g., "2026-10-26T11:42:23.511Z" or "2026-04-01")
 * into a clean Day-Month-Year ("DD-MM-YYYY") date string.
 */
export function formatPdfDate(dateInput?: string | null): string {
  const formatDmy = (d: Date) => {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  if (!dateInput) return formatDmy(new Date());
  const raw = String(dateInput).trim();
  if (!raw) return formatDmy(new Date());

  const datePart = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0];

  // Match YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = datePart.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymdMatch) {
    return `${ymdMatch[3].padStart(2, '0')}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[1]}`;
  }

  // Match DD-MM-YYYY or DD/MM/YYYY (or MM/DD/YYYY if second part > 12)
  const dmyMatch = datePart.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmyMatch) {
    const p1 = parseInt(dmyMatch[1], 10);
    const p2 = parseInt(dmyMatch[2], 10);
    if (p1 <= 12 && p2 > 12) {
      return `${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}-${dmyMatch[3]}`;
    }
    return `${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}-${dmyMatch[3]}`;
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return formatDmy(parsed);
  }

  return cleanPdfText(datePart).substring(0, 12);
}

/**
 * Ensures SVG data URLs have explicit width/height attributes before drawing to canvas
 * so HTMLImageElement never reports naturalWidth/naturalHeight as 0.
 */
function normalizeSvgDataUrlForCanvas(sourceUrl: string): string {
  try {
    if (!sourceUrl.startsWith('data:image/svg+xml')) return sourceUrl;
    const commaIdx = sourceUrl.indexOf(',');
    if (commaIdx === -1) return sourceUrl;
    const header = sourceUrl.slice(0, commaIdx);
    const payload = sourceUrl.slice(commaIdx + 1);
    const isBase64 = header.includes(';base64');
    let svgText = isBase64 ? atob(payload) : decodeURIComponent(payload);
    if (!/<svg[^>]*\bwidth=/i.test(svgText)) {
      svgText = svgText.replace(/<svg\b/i, '<svg width="480" height="480"');
    }
    return `data:image/svg+xml;base64,${btoa(svgText)}`;
  } catch {
    return sourceUrl;
  }
}

/**
 * Renders any logo image URL onto a 100% transparent canvas while preserving its exact natural
 * aspect ratio (e.g., wide horizontal banner or square emblem) with zero square padding or circle cropping.
 */
async function renderPreservedAspectLogoPng(sourceUrl: string): Promise<RenderedPdfLogo | null> {
  if (!sourceUrl || typeof window === 'undefined') return null;
  if (preservedLogoCache.has(sourceUrl)) {
    return preservedLogoCache.get(sourceUrl)!;
  }

  return new Promise((resolve) => {
    try {
      const normalizedSrc = normalizeSvgDataUrlForCanvas(sourceUrl);
      const img = new Image();
      if (
        !normalizedSrc.startsWith('data:') &&
        normalizedSrc.startsWith('http') &&
        !normalizedSrc.startsWith(window.location.origin)
      ) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => {
        try {
          const iw = img.naturalWidth || img.width || 480;
          const ih = img.naturalHeight || img.height || 480;
          const targetMax = Math.min(1000, Math.max(480, Math.max(iw, ih)));
          const scale = targetMax / Math.max(iw, ih);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(iw * scale));
          canvas.height = Math.max(1, Math.round(ih * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const dataUrl = canvas.toDataURL('image/png');
          const result: RenderedPdfLogo = {
            dataUrl,
            width: canvas.width,
            height: canvas.height,
            aspectRatio: canvas.width / canvas.height,
          };
          preservedLogoCache.set(sourceUrl, result);
          resolve(result);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = normalizedSrc;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Generates an ultra-crisp, high-DPI transparent PNG of the official MAK Group of Companies logo
 * (using the uploaded Main App Document Logo / Main Logo, or the default /logos/mak_main_logo.png).
 */
export async function getMakGroupLetterheadLogoPngUrl(): Promise<string> {
  const parentGroup = getParentGroupInfo();
  const preferredUrl = getMainGroupDocumentLogoUrl(parentGroup) || getMainGroupLogoUrl(parentGroup) || MAIN_GROUP_LOGO_URL;
  const preferredRendered = await renderPreservedAspectLogoPng(preferredUrl);
  if (preferredRendered?.dataUrl) return preferredRendered.dataUrl;

  if (preferredUrl !== MAIN_GROUP_LOGO_URL) {
    const defaultRendered = await renderPreservedAspectLogoPng(MAIN_GROUP_LOGO_URL);
    if (defaultRendered?.dataUrl) return defaultRendered.dataUrl;
  }

  if (cachedMakLogoPngUrl) return cachedMakLogoPngUrl;
  if (typeof window === 'undefined') return '';

  return new Promise((resolve) => {
    try {
      const size = 500;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve('');

      const cx = size / 2;
      const cy = size / 2;

      // Keep 100% transparent background (no circle border)
      ctx.clearRect(0, 0, size, size);

      // Scale original 1120x500 MAK emblem centered inside transparent square
      ctx.save();
      const scale = 0.42;
      ctx.translate(cx - (1120 * scale) / 2, cy - (500 * scale) / 2 + 6);
      ctx.scale(scale, scale);

      const grad = ctx.createLinearGradient(0, 0, 1120, 500);
      grad.addColorStop(0, '#1E293B');
      grad.addColorStop(0.5, '#0F172A');
      grad.addColorStop(1, '#020617');

      ctx.fillStyle = grad;

      // Letter "M"
      ctx.beginPath();
      ctx.moveTo(50, 50);
      ctx.lineTo(155, 50);
      ctx.lineTo(245, 215);
      ctx.lineTo(335, 50);
      ctx.lineTo(440, 50);
      ctx.lineTo(440, 340);
      ctx.lineTo(345, 340);
      ctx.lineTo(345, 175);
      ctx.lineTo(270, 305);
      ctx.lineTo(220, 305);
      ctx.lineTo(145, 175);
      ctx.lineTo(145, 340);
      ctx.lineTo(50, 340);
      ctx.closePath();
      ctx.fill();

      // Letter "A"
      ctx.beginPath();
      ctx.moveTo(465, 340);
      ctx.lineTo(465, 150);
      ctx.bezierCurveTo(465, 75, 515, 50, 595, 50);
      ctx.bezierCurveTo(675, 50, 725, 75, 725, 150);
      ctx.lineTo(725, 340);
      ctx.lineTo(630, 340);
      ctx.lineTo(630, 270);
      ctx.lineTo(560, 270);
      ctx.lineTo(560, 340);
      ctx.closePath();
      ctx.fill();

      // Counter cutout of "A"
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(560, 200);
      ctx.lineTo(630, 200);
      ctx.lineTo(630, 145);
      ctx.bezierCurveTo(630, 118, 618, 105, 595, 105);
      ctx.bezierCurveTo(572, 105, 560, 118, 560, 145);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Letter "K" Column
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(750, 50);
      ctx.lineTo(845, 50);
      ctx.lineTo(845, 340);
      ctx.lineTo(750, 340);
      ctx.closePath();
      ctx.fill();

      // Letter "K" Arms
      ctx.beginPath();
      ctx.moveTo(845, 215);
      ctx.lineTo(935, 50);
      ctx.lineTo(1060, 50);
      ctx.lineTo(940, 230);
      ctx.lineTo(1070, 340);
      ctx.lineTo(945, 340);
      ctx.lineTo(845, 225);
      ctx.closePath();
      ctx.fill();

      // Horizontal Divider Bar
      ctx.beginPath();
      ctx.roundRect(50, 375, 1020, 10, 5);
      ctx.fill();

      // Subtitle: "GROUP OF COMPANIES"
      ctx.fillStyle = grad;
      ctx.font = '900 44px "Montserrat", "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('GROUP OF COMPANIES', 560, 445);
      ctx.restore();

      const dataUrl = canvas.toDataURL('image/png');
      cachedMakLogoPngUrl = dataUrl;
      resolve(dataUrl);
    } catch {
      resolve('');
    }
  });
}

export async function getDefaultLogoPngUrl(): Promise<string> {
  return await getMakGroupLetterheadLogoPngUrl();
}

export async function getCompanyMonogramLogoPngUrl(companyId?: string): Promise<string> {
  return await getMakGroupLetterheadLogoPngUrl();
}

/**
 * Resolves the TOP letterhead logo strictly from the Main App (MAK Group of Companies) settings
 * along with its natural aspect ratio so wide horizontal logos are never squished into a square:
 * 1. Main App Document Logo (parentGroup.documentLogo) or Main Logo (parentGroup.logo) if v2 uploaded
 * 2. Official /logos/mak_main_logo.png
 * Note: Operating subsidiary company logos (DPL, TRK, MHB, VSL) are rendered strictly at the bottom stamp.
 */
export async function resolvePdfLogoWithMetrics(_customLogo?: string | null): Promise<RenderedPdfLogo | null> {
  const parentGroup = getParentGroupInfo();
  const preferredUrl = getMainGroupDocumentLogoUrl(parentGroup) || getMainGroupLogoUrl(parentGroup) || MAIN_GROUP_LOGO_URL;
  const rendered = await renderPreservedAspectLogoPng(preferredUrl);
  if (rendered?.dataUrl) return rendered;

  if (preferredUrl !== MAIN_GROUP_LOGO_URL) {
    const fallbackRendered = await renderPreservedAspectLogoPng(MAIN_GROUP_LOGO_URL);
    if (fallbackRendered?.dataUrl) return fallbackRendered;
  }

  const vectorUrl = await getMakGroupLetterheadLogoPngUrl();
  if (vectorUrl) {
    return { dataUrl: vectorUrl, aspectRatio: 1, width: 500, height: 500 };
  }
  return null;
}

export async function resolvePdfLogoUrl(_customLogo?: string | null): Promise<string> {
  const metrics = await resolvePdfLogoWithMetrics(_customLogo);
  return metrics?.dataUrl || '';
}

/**
 * Utility to strip non-ASCII characters that break standard PDF fonts (Helvetica)
 * causing corrupted characters or mojibake.
 */
export function cleanPdfText(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/[•·]/g, '|')
    .replace(/[—–]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

/**
 * Draws the unified MAK GROUP OF COMPANIES official letterhead header.
 * Uses a 1:1 circular logo emblem and dynamic line-height progression so text never overlaps.
 */
export async function drawPdfCorporateHeader(
  doc: jsPDF,
  options: {
    title: string;
    refNo?: string;
    date?: string;
    subRef?: string;
    branding?: BrandingInfo;
    accentColor?: [number, number, number];
    subject?: string;
  }
): Promise<number> {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const startY = 9.5;

  // 1. Top Luxury Executive Accent Bars
  doc.setFillColor(15, 23, 42); // Deep Slate-900
  doc.rect(0, 0, pageWidth, 4.5, 'F');
  const accent = options.accentColor || [217, 119, 6]; // Amber / Gold
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 4.5, pageWidth, 1.5, 'F');

  // 2. High-Res MAK Group of Companies Logo preserving natural aspect ratio (wide or square)
  const logoMetrics = await resolvePdfLogoWithMetrics(options.branding?.customLogo);
  const logoAspectRatio = logoMetrics?.aspectRatio || 1;
  const maxLogoH = 18;
  const maxLogoW = logoAspectRatio > 1.25 ? 36 : 20;
  let logoW = maxLogoH * logoAspectRatio;
  let logoH = maxLogoH;
  if (logoW > maxLogoW) {
    logoW = maxLogoW;
    logoH = logoW / logoAspectRatio;
  }
  let logoDrawn = false;

  if (logoMetrics?.dataUrl) {
    try {
      const format = logoMetrics.dataUrl.includes('image/jpeg') || logoMetrics.dataUrl.includes('image/jpg') ? 'JPEG' : 'PNG';
      doc.addImage(logoMetrics.dataUrl, format, margin, startY, logoW, logoH);
      logoDrawn = true;
    } catch (e) {
      console.warn('Could not draw MAK logo into PDF:', e);
    }
  }

  const textStartX = logoDrawn ? margin + logoW + 4.5 : margin;

  // 3. Clean and prepare right-aligned metadata
  const cleanTitle = cleanPdfText(options.title) || 'OFFICIAL DOCUMENT';
  const cleanRef = options.refNo ? cleanPdfText(options.refNo) : undefined;
  const cleanDate = options.date ? formatPdfDate(options.date) : undefined;
  const cleanSubRef = options.subRef ? cleanPdfText(options.subRef) : undefined;

  const rightColMaxWidth = 54;
  const maxLeftWidth = Math.max(76, (pageWidth - margin) - textStartX - rightColMaxWidth - 4);

  // 4. Left Column: Unified MAK Group Conglomerate Identity with dynamic Y tracking (zero overlap)
  let currLeftY = startY + 4.2;

  // Line 1: Conglomerate Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize('MAK GROUP OF COMPANIES', maxLeftWidth);
  doc.text(titleLines, textStartX, currLeftY);
  currLeftY += (titleLines.length * 4.2);

  // Line 2: Tagline / Category
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.0);
  doc.setTextColor(180, 83, 9);
  const taglineLines = doc.splitTextToSize('PREMIER MULTI-ENTITY LOGISTICS, CUSTOMS & TRADE CONGLOMERATE', maxLeftWidth);
  doc.text(taglineLines, textStartX, currLeftY);
  currLeftY += (taglineLines.length * 3.1) + 0.5;

  // Line 3: 4 Subsidiary Entities Bar
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.4);
  doc.setTextColor(71, 85, 105);
  const entitiesLine = 'DOCKS (PVT) LTD  |  TRUCKIT (PVT) LTD  |  MUHIB INTL  |  VANTAGE SHIPPING';
  const entityLines = doc.splitTextToSize(entitiesLine, maxLeftWidth);
  doc.text(entityLines, textStartX, currLeftY);
  currLeftY += (entityLines.length * 2.9) + 0.4;

  // Line 4: Customs Bonded & Intermodal Freight Operations note
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.0);
  doc.setTextColor(100, 116, 139);
  const opsLines = doc.splitTextToSize('Customs Bonded Carrier  |  Fleet Haulage  |  Ocean Freight  |  Forwarding', maxLeftWidth);
  doc.text(opsLines, textStartX, currLeftY);
  currLeftY += (opsLines.length * 2.6);

  // 5. Right Column: Document Classification & Identification (wrapped cleanly if long)
  let currRightY = startY + 4.0;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  const rightTitleLines = doc.splitTextToSize(cleanTitle.toUpperCase(), rightColMaxWidth);
  doc.text(rightTitleLines, pageWidth - margin, currRightY, { align: 'right' });
  currRightY += (rightTitleLines.length * 3.8);

  if (cleanRef) {
    currRightY += 0.6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    const refWrapped = doc.splitTextToSize(cleanRef, rightColMaxWidth);
    doc.text(refWrapped, pageWidth - margin, currRightY, { align: 'right' });
    currRightY += (refWrapped.length * 3.3);
  }

  if (cleanDate) {
    currRightY += 0.4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.0);
    doc.setTextColor(100, 116, 139);
    doc.text(`Date: ${cleanDate}`, pageWidth - margin, currRightY, { align: 'right' });
    currRightY += 3.3;
  }

  if (cleanSubRef) {
    currRightY += 0.3;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(100, 116, 139);
    const subRefWrapped = doc.splitTextToSize(cleanSubRef, rightColMaxWidth);
    doc.text(subRefWrapped, pageWidth - margin, currRightY, { align: 'right' });
    currRightY += (subRefWrapped.length * 3.0);
  }

  // 6. Horizontal Divider Line (strictly computed below both columns and logo)
  const dividerY = Math.max(currLeftY, currRightY, startY + (logoDrawn ? logoH : 0)) + 2.8;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.5);
  doc.line(margin, dividerY, pageWidth - margin, dividerY);

  // 7. Executive Business-Class Subject Line
  const subjectText = options.subject 
    ? cleanPdfText(options.subject).toUpperCase()
    : (options.title ? `OFFICIAL RECORD: ${cleanTitle.toUpperCase()}` : '');

  if (subjectText) {
    const subBoxY = dividerY + 2.2;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, subBoxY, pageWidth - (margin * 2), 6.6, 1, 1, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`SUBJECT: ${subjectText}`, margin + 4, subBoxY + 4.5);

    return subBoxY + 10.5;
  }

  return dividerY + 4.5;
}

/**
 * Draws the official corporate footer across all documents.
 * Always anchors the official Head Office Address and Contacts of MAK Group of Companies.
 */
export function drawPdfCorporateFooter(
  doc: jsPDF,
  rightText: string = '',
  branding?: BrandingInfo
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const parent = getParentGroupInfo();

  const address = cleanPdfText(parent.address) || DEFAULT_PARENT_GROUP.address;
  const phone = cleanPdfText(parent.phone) || DEFAULT_PARENT_GROUP.phone;
  const cell = cleanPdfText(parent.cell) || DEFAULT_PARENT_GROUP.cell;
  const email = cleanPdfText(parent.email) || DEFAULT_PARENT_GROUP.email;
  const web = cleanPdfText(parent.web) || DEFAULT_PARENT_GROUP.web;

  const cleanRight = cleanPdfText(rightText);
  const dividerY = pageHeight - 16;
  const centerX = pageWidth / 2;

  // Bottom footer divider line
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.line(margin, dividerY, pageWidth - margin, dividerY);

  // Line 1: Head Office Address of MAK Group of Companies
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.3);
  doc.setTextColor(51, 65, 85);
  const addrText = `Head Office: ${address}`;
  doc.text(addrText, centerX, dividerY + 4.2, { align: 'center', maxWidth: pageWidth - (margin * 2) });

  // Line 2: Phone, Cell, Email, Web
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.9);
  doc.setTextColor(100, 116, 139);
  const phonePart = phone ? `Tel: ${phone}` : '';
  const cellPart = cell ? `Cell: ${cell}` : '';
  const emailPart = email ? `Email: ${email}` : '';
  const webPart = web ? `Web: ${web}` : '';
  const contactText = [phonePart, cellPart, emailPart, webPart].filter(Boolean).join('  |  ');
  doc.text(contactText, centerX, dividerY + 7.8, { align: 'center', maxWidth: pageWidth - (margin * 2) });

  // Line 3: Group Entity Footer & Page Number
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(148, 163, 184);
  const isSinglePage = !cleanRight || cleanRight.toLowerCase() === 'page 1 of 1' || cleanRight.toLowerCase().endsWith('of 1');
  const pageNotice = isSinglePage 
    ? 'MAK Group of Companies  |  DOCKS - TRUCKIT - MUHIB - VANTAGE  |  Official ERP Record' 
    : `${cleanRight}  |  MAK Group of Companies Official ERP Record`;
  doc.text(pageNotice, centerX, dividerY + 11.2, { align: 'center' });
}

/**
 * Draws the official corporate stamp only for the active operating company.
 * Stamp dynamically features the active company (Docks, Truckit, Muhib, or Vantage Shipping Line).
 */
export function drawOfficialCompanyStampOnly(
  doc: jsPDF,
  x: number,
  y: number,
  title: string = 'OFFICIAL CARRIER SEAL',
  companyId?: CompanyId
): void {
  try {
    const active = companyId ? GROUP_COMPANIES[companyId] : getActiveCompany();
    const boxW = 58;
    const boxH = 22;

    // Outer border
    doc.setDrawColor(15, 23, 42); // Deep Slate
    doc.setLineWidth(0.6);
    doc.roundedRect(x, y, boxW, boxH, 2, 2, 'S');

    // Inner thin border
    doc.setDrawColor(217, 119, 6); // Amber / Gold
    doc.setLineWidth(0.25);
    doc.roundedRect(x + 1, y + 1, boxW - 2, boxH - 2, 1.5, 1.5, 'S');

    // Header: Active Company Name
    const stampTitle = cleanPdfText(active.legalTitle || active.name).toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(15, 23, 42);
    doc.text(stampTitle, x + (boxW / 2), y + 4.6, { align: 'center', maxWidth: boxW - 4 });

    // Category
    const stampCat = cleanPdfText(active.category).toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.6);
    doc.setTextColor(100, 116, 139);
    doc.text(stampCat, x + (boxW / 2), y + 8.0, { align: 'center', maxWidth: boxW - 4 });

    // Center Badge
    doc.setFillColor(15, 23, 42);
    doc.rect(x + 2, y + 9.5, boxW - 4, 5.2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), x + (boxW / 2), y + 13.1, { align: 'center' });

    // Footer notice
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.2);
    doc.setTextColor(180, 83, 9);
    doc.text('ERP DIGITALLY AUTHENTICATED', x + (boxW / 2), y + 17.2, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(3.8);
    doc.setTextColor(100, 116, 139);
    doc.text('OFFICIAL STAMP ONLY • NO SIGNATURE REQUIRED', x + (boxW / 2), y + 19.8, { align: 'center' });
  } catch (err) {
    console.warn('Error drawing official company stamp:', err);
  }
}

/**
 * Infers the operating subsidiary CompanyId from a case number, reference prefix, or explicit companyId.
 */
export function resolveOperatingCompanyFromRef(
  companyId?: CompanyId | string,
  refOrCaseNo?: string | null
): CompanyId {
  if (companyId && (companyId === 'docks' || companyId === 'truckit' || companyId === 'muhib' || companyId === 'vantage')) {
    return companyId;
  }
  const refUpper = String(refOrCaseNo || '').toUpperCase().trim();
  if (refUpper.startsWith('TRK-') || refUpper.includes('TRUCKIT')) return 'truckit';
  if (refUpper.startsWith('MHB-') || refUpper.includes('MUHIB')) return 'muhib';
  if (refUpper.startsWith('VSL-') || refUpper.includes('VANTAGE')) return 'vantage';
  if (refUpper.startsWith('DPL-') || refUpper.includes('DOCKS')) return 'docks';
  return getActiveCompany().id;
}

/**
 * Generates a transparent PNG with preserved natural aspect ratio for a specific operating
 * subsidiary company (Docks, Truckit, Muhib, Vantage) while keeping each subsidiary's own logo intact.
 */
async function getOperatingCompanyLogoWithMetrics(
  companyId: CompanyId,
  customLogoHint?: string | null
): Promise<RenderedPdfLogo | null> {
  const comp = GROUP_COMPANIES[companyId] || getActiveCompany();
  const activeComp = getActiveCompany();

  // 1. Check uploaded logo for this specific operating company in Company Settings
  const uploadedForComp = getCompanyUploadedLogo(companyId);
  if (uploadedForComp && (isUploadedLogo(uploadedForComp) || uploadedForComp.includes('mak_main_logo'))) {
    const rendered = await renderPreservedAspectLogoPng(uploadedForComp);
    if (rendered) return rendered;
  }

  // 2. Check stored branding for this specific company
  const compBranding = getStoredBranding(comp);
  if (compBranding?.useMainLogoAsOfficial) {
    return await resolvePdfLogoWithMetrics();
  }
  if (compBranding?.customLogo && isUploadedLogo(compBranding.customLogo)) {
    const rendered = await renderPreservedAspectLogoPng(compBranding.customLogo);
    if (rendered) return rendered;
  }

  // 3. Check customLogoHint passed from active view when matching this company
  if (customLogoHint && isUploadedLogo(customLogoHint) && companyId === activeComp.id) {
    const rendered = await renderPreservedAspectLogoPng(customLogoHint);
    if (rendered) return rendered;
  }

  // 4. Render this subsidiary company's own official SVG emblem cleanly
  if (comp.logo) {
    const svgRendered = await renderPreservedAspectLogoPng(comp.logo);
    if (svgRendered) return svgRendered;
  }

  return await resolvePdfLogoWithMetrics();
}

/**
 * Draws the Operating Subsidiary Company attribution block (Subsidiary Logo + Company Name + Official Stamp)
 * at the bottom of Client Ledgers, Invoices, and Case Dossiers so it is clear which company added the client
 * and managed the case.
 */
export async function drawIssuingCompanySignatureAndStamp(
  doc: jsPDF,
  y: number,
  title: string = 'OFFICIAL CARRIER SEAL',
  companyId?: CompanyId,
  refHint?: string,
  customLogoHint?: string | null
): Promise<void> {
  const resolvedId = resolveOperatingCompanyFromRef(companyId, refHint);
  const active = GROUP_COMPANIES[resolvedId] || getActiveCompany();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  // Draw subtle attribution box on the left for the handling company
  const leftBoxW = pageWidth - (margin * 2) - 64;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, leftBoxW, 22, 2, 2, 'FD');

  // Draw subsidiary company's own logo inside left attribution box preserving aspect ratio
  let textStartX = margin + 4;
  try {
    const subLogo = await getOperatingCompanyLogoWithMetrics(resolvedId, customLogoHint);
    if (subLogo?.dataUrl) {
      const boxMaxW = 24;
      const boxMaxH = 16;
      const ar = subLogo.aspectRatio || 1;
      let drawW = boxMaxH * ar;
      let drawH = boxMaxH;
      if (drawW > boxMaxW) {
        drawW = boxMaxW;
        drawH = drawW / ar;
      }
      const drawY = y + (22 - drawH) / 2;
      doc.addImage(subLogo.dataUrl, 'PNG', margin + 3, drawY, drawW, drawH);
      textStartX = margin + 3 + drawW + 3.5;
    }
  } catch (_) {}

  // Left Column: HANDLING / ISSUING COMPANY
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.3);
  doc.setTextColor(180, 83, 9);
  doc.text('CLIENT & CASE MANAGED BY (OPERATING COMPANY):', textStartX, y + 5.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  doc.setTextColor(15, 23, 42);
  doc.text(cleanPdfText(active.legalTitle || active.name).toUpperCase(), textStartX, y + 11.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(71, 85, 105);
  doc.text(`${cleanPdfText(active.category)}  |  Company Code: ${active.prefix}`, textStartX, y + 15.8);
  doc.text('A Subsidiary of MAK Group of Companies', textStartX, y + 19.6);

  // Right Column: Active Company Official Stamp
  const stampX = pageWidth - margin - 58;
  drawOfficialCompanyStampOnly(doc, stampX, y, title, resolvedId);
}

/**
 * Draws the Accountant's Signature & Stamp.
 * EXCLUSIVELY applied to Payment Receipts and Financial Vouchers per SRS Policy.
 * Dynamically reflects the active operating company for the financial department.
 */
export function drawAccountantStampAndSignature(
  doc: jsPDF,
  currentY: number,
  margin: number,
  pageWidth: number,
  isIncome?: boolean,
  companyId?: CompanyId
): void {
  const active = companyId ? GROUP_COMPANIES[companyId] : getActiveCompany();

  // Left: Signature of Receiver / Payee (or Payer if income)
  const leftX = margin + 4;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.line(leftX, currentY + 14, leftX + 50, currentY + 14);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(15, 23, 42);
  doc.text(isIncome ? "PAYER / DEPOSITOR SIGNATURE" : "RECEIVER / PAYEE SIGNATURE", leftX + 25, currentY + 17.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(100, 116, 139);
  doc.text(isIncome ? "Deposited By / Representative" : "Signature of Receiver / Payee", leftX + 25, currentY + 20.8, { align: 'center' });

  // Center: Active Company Official Stamp
  const stampX = (pageWidth / 2) - 29;
  drawOfficialCompanyStampOnly(doc, stampX, currentY - 2, isIncome ? 'PAYMENT RECEIVED' : 'PAYMENT DISBURSED', companyId);

  // Right: Accountant Signature & Stamp Line with Active Company Name
  const sigX = pageWidth - margin - 54;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.line(sigX, currentY + 14, sigX + 50, currentY + 14);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(15, 23, 42);
  doc.text("ACCOUNTANT'S SIGNATURE", sigX + 25, currentY + 17.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Finance & Accounts • ${active.shortName}`, sigX + 25, currentY + 20.8, { align: 'center' });
}

/**
 * Generates an official, beautifully formatted A4 PDF dossier or invoice
 * and automatically triggers a direct file download on mobile/desktop devices.
 */
export async function downloadCasePdf(
  targetCase: Case,
  brandingOrOptions?: BrandingInfo | PdfExportOptions,
  maybeOptions?: PdfExportOptions
): Promise<{ success: boolean; filename: string; blobUrl?: string }> {
  try {
    const isOptions = (obj: any): obj is PdfExportOptions => {
      return !!obj && (
        'onlyInvoice' in obj ||
        'onlyCaseDetails' in obj ||
        'includeAttachments' in obj ||
        'previewOnly' in obj ||
        'accentColor' in obj
      );
    };

    const branding: BrandingInfo = (!brandingOrOptions || isOptions(brandingOrOptions))
      ? getStoredBranding()
      : (brandingOrOptions as BrandingInfo);

    const options: PdfExportOptions = isOptions(brandingOrOptions)
      ? (brandingOrOptions as PdfExportOptions)
      : (maybeOptions || {});

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    let currentY = margin;

    const b = { ...getStoredBranding(), ...branding };
    const companyName = b.companyName || getDefaultBranding(getActiveCompany()).companyName;

    // Helper: Header block with corporate branding & logo
    const renderHeader = async (docTitle: string) => {
      currentY = await drawPdfCorporateHeader(doc, {
        title: docTitle,
        refNo: `Case: ${targetCase.caseNo}`,
        date: targetCase.createdAt || new Date().toLocaleDateString(),
        subRef: targetCase.clientName ? `Client: ${targetCase.clientName}` : undefined,
        branding: b,
        accentColor: [234, 179, 8]
      });
    };

    // Helper: Footer
    const renderFooter = (pageNo: number, totalPages: number) => {
      drawPdfCorporateFooter(doc, `Page ${pageNo} of ${totalPages}`, b);
    };

    // --- PAGE 1: CASE SUMMARY OR INVOICE ---
    if (!options.onlyInvoice) {
      await renderHeader('CASE DETAILS');

      // Thank you message before case detail section
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 6.5, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(180, 83, 9); // warm gold/amber
      doc.text('THANK YOU FOR DOING BUSINESS WITH US! WE SINCERELY APPRECIATE YOUR PARTNERSHIP.', pageWidth / 2, currentY + 4.4, { align: 'center' });
      currentY += 9.5;

      // Section 1: CASE DETAIL (Clean Form Format)
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(margin, currentY, pageWidth - (margin * 2), 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);
      doc.text('CASE DETAIL', margin + 4, currentY + 4.2);
      currentY += 6;

      const formBoxY = currentY;
      const formBoxHeight = 35;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, formBoxY, pageWidth - (margin * 2), formBoxHeight, 1.5, 1.5, 'FD');

      const col1X = margin + 4;
      const col2X = margin + ((pageWidth - margin * 2) / 2) + 2;
      const maxValWidth = ((pageWidth - margin * 2) / 2) - 42;

      const fieldsCol1 = [
        { label: 'CATEGORY:', value: targetCase.category || 'Bonded Carrier' },
        { label: 'SUB-CATEGORY:', value: targetCase.subCategory || 'Standard Container / General Cargo' },
        { label: 'PORT OF LOADING (POL):', value: targetCase.pol || targetCase.extractedData?.pol || 'N/A' },
        { label: 'PORT OF DESTINATION (POD):', value: targetCase.pod || targetCase.extractedData?.pod || targetCase.extractedData?.dropoffDestination || 'N/A' },
        { label: 'OPERATIONAL STATUS:', value: targetCase.status || 'Active' },
        { label: 'CONSIGNEE / IMPORTER:', value: targetCase.extractedData?.consigneeName || targetCase.importer || 'N/A' }
      ];

      const containerSummary = targetCase.containers && targetCase.containers.length > 0
        ? `${targetCase.containers.length} Unit(s) [${targetCase.containers.map(c => c.number || c.size || 'CNTR').join(', ')}]`
        : (targetCase.containerNumber || 'N/A');

      const weightSummary = targetCase.extractedData?.totalWeight 
        ? `${Number(targetCase.extractedData.totalWeight).toLocaleString()} KG` 
        : (targetCase.containers?.[0]?.weight ? `${Number(targetCase.containers[0].weight).toLocaleString()} KG` : 'N/A');

      const fieldsCol2 = [
        { label: 'BL / AWB NO:', value: targetCase.extractedData?.blNumber || targetCase.blNumber || 'N/A' },
        { label: 'GD NO (CUSTOMS):', value: targetCase.extractedData?.gdNo || targetCase.gdNumber || 'N/A' },
        { label: 'CONTAINERS:', value: containerSummary },
        { label: 'CONTAINER SIZE & TYPE:', value: targetCase.containers?.[0]?.size || '40ft Standard' },
        { label: 'TOTAL CARGO WEIGHT:', value: weightSummary },
        { label: 'SHIPPING LINE / AGENT:', value: targetCase.extractedData?.shippingLine || targetCase.shippingAgent || targetCase.shippingLine || 'N/A' }
      ];

      let rowY = formBoxY + 4;
      for (let i = 0; i < 6; i++) {
        // Column 1
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.2);
        doc.setTextColor(100, 116, 139);
        doc.text(fieldsCol1[i].label, col1X, rowY);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.setTextColor(15, 23, 42);
        const c1Val = doc.splitTextToSize(fieldsCol1[i].value, maxValWidth)[0] || 'N/A';
        doc.text(c1Val, col1X + 38, rowY);

        // Column 2
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.2);
        doc.setTextColor(100, 116, 139);
        doc.text(fieldsCol2[i].label, col2X, rowY);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.setTextColor(15, 23, 42);
        const c2Val = doc.splitTextToSize(fieldsCol2[i].value, maxValWidth)[0] || 'N/A';
        doc.text(c2Val, col2X + 38, rowY);

        rowY += 5.3;
      }

      currentY = formBoxY + formBoxHeight + 5;

      // Section 2: INVOICE (Render unless onlyCaseDetails is explicitly requested)
      if (!options.onlyCaseDetails) {
        doc.setFillColor(15, 23, 42); // slate-900
        doc.rect(margin, currentY, pageWidth - (margin * 2), 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text('INVOICE BREAKDOWN', margin + 4, currentY + 4.2);
        doc.text('AMOUNT (PKR)', pageWidth - margin - 4, currentY + 4.2, { align: 'right' });
        currentY += 6;

        const fallbackTotal = Number(targetCase.totalCost || (targetCase as any).amount || 0);
        const charges = targetCase.charges && targetCase.charges.length > 0
          ? targetCase.charges
          : fallbackTotal > 0
            ? [{ description: 'Logistics, Customs Clearance & Freight Charges', amount: fallbackTotal }]
            : [{ description: 'No charges billed yet', amount: 0 }];

        let totalAmount = 0;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.2);
        doc.setTextColor(30, 41, 59);

        charges.forEach((ch: any, idx: number) => {
          if (currentY > pageHeight - 38) {
            renderFooter(doc.getNumberOfPages(), doc.getNumberOfPages() + 1);
            doc.addPage();
            currentY = 20;
          }
          const amt = Number(ch.amount) || 0;
          totalAmount += amt;
          if (idx % 2 === 1) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, currentY, pageWidth - (margin * 2), 5.2, 'F');
          }
          doc.setTextColor(30, 41, 59);
          doc.text(String(idx + 1), margin + 3, currentY + 3.7);
          doc.text(cleanPdfText(ch.description || 'Logistics Service'), margin + 10, currentY + 3.7);
          doc.text(amt.toLocaleString(), pageWidth - margin - 4, currentY + 3.7, { align: 'right' });
          currentY += 5.2;
        });

        // Total Row (at bottom of invoice section)
        doc.setFillColor(241, 245, 249);
        doc.rect(margin, currentY, pageWidth - (margin * 2), 6.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(15, 23, 42);
        doc.text('TOTAL INVOICE AMOUNT DUE:', margin + 4, currentY + 4.5);
        doc.setTextColor(180, 83, 9); // gold / amber
        doc.text(`PKR ${totalAmount.toLocaleString()}`, pageWidth - margin - 4, currentY + 4.5, { align: 'right' });
        currentY += 9.5;

        // Invoice details & terms in short
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        doc.text(
          `Case / Invoice / Voucher No: ${cleanPdfText(targetCase.caseNo)}  |  Terms: Immediate upon receipt  |  Currency: PKR  |  Status: ${targetCase.status === 'Completed' ? 'Fully Settled' : 'Payment Due'}`,
          margin + 4,
          currentY
        );
        currentY += 3;
      }

      // Operating Company Attribution (Logo + Company Name + Stamp) at bottom
      const caseCompanyId = resolveOperatingCompanyFromRef((targetCase as any).companyId, targetCase.caseNo);
      await drawIssuingCompanySignatureAndStamp(doc, currentY, 'OFFICIAL RECORD STAMP', caseCompanyId, targetCase.caseNo, b.customLogo);

      renderFooter(1, 1);

      // Optional: Append Attached Document Scans if includeAttachments is true
      if ((options.includeAttachments || options.withAttachments) && Array.isArray(targetCase.documents) && targetCase.documents.length > 0) {
        for (const docItem of targetCase.documents) {
          const itemAny = docItem as any;
          const url = itemAny?.url || itemAny?.fileData || '';
          if (typeof url === 'string' && url.startsWith('data:image/')) {
            try {
              doc.addPage();
              let attY = await drawPdfCorporateHeader(doc, {
                title: 'ATTACHED DOCUMENT',
                refNo: `Case: ${targetCase.caseNo}`,
                date: itemAny.uploadedAt || targetCase.createdAt || new Date().toLocaleDateString(),
                subRef: cleanPdfText(itemAny.name || itemAny.type || 'Attachment'),
                branding: b,
                accentColor: [234, 179, 8]
              });
              const imgFormat = url.includes('image/png') ? 'PNG' : 'JPEG';
              doc.addImage(url, imgFormat, margin, attY + 2, pageWidth - margin * 2, pageHeight - attY - 26, undefined, 'FAST');
              drawPdfCorporateFooter(doc, `Attachment - ${cleanPdfText(itemAny.name || 'Document')}`, b);
            } catch (_) {}
          }
        }
      }
    }

    // --- STANDALONE INVOICE PAGE (Only when user explicitly requests standalone Commercial Invoice) ---
    if (options.onlyInvoice) {
      await renderHeader('INVOICE');

      // Invoice Details Header Box
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 22, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text(`INVOICE NO: ${cleanPdfText(targetCase.caseNo)}`, margin + 4, currentY + 6);
      doc.text(`BILL TO: ${cleanPdfText(targetCase.clientName || 'General Freight Client')}`, margin + 4, currentY + 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Associated Case: ${cleanPdfText(targetCase.caseNo)} (${cleanPdfText(targetCase.category || 'Customs Clearance')})`, margin + 4, currentY + 17);

      doc.text(`Issue Date: ${cleanPdfText(targetCase.createdAt || new Date().toLocaleDateString())}`, pageWidth - margin - 4, currentY + 6, { align: 'right' });
      doc.text('Payment Terms: Immediate upon receipt', pageWidth - margin - 4, currentY + 12, { align: 'right' });
      doc.text('Currency: PKR (Pakistani Rupee)', pageWidth - margin - 4, currentY + 17, { align: 'right' });

      currentY += 28;

      // Charges Table Header
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, currentY, pageWidth - (margin * 2), 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);

      doc.text('#', margin + 3, currentY + 4.8);
      doc.text('SERVICE / ITEM DESCRIPTION', margin + 12, currentY + 4.8);
      doc.text('AMOUNT (PKR)', pageWidth - margin - 4, currentY + 4.8, { align: 'right' });
      currentY += 7;

      // Charges Rows
      const fallbackTotal = Number(targetCase.totalCost || (targetCase as any).amount || 0);
      const charges = targetCase.charges && targetCase.charges.length > 0
        ? targetCase.charges
        : fallbackTotal > 0
          ? [{ description: 'Logistics, Customs Clearance & Freight Charges', amount: fallbackTotal }]
          : [{ description: 'No charges billed yet', amount: 0 }];

      let totalAmount = 0;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);

      charges.forEach((ch: any, idx: number) => {
        if (currentY > pageHeight - 38) {
          renderFooter(doc.getNumberOfPages(), doc.getNumberOfPages() + 1);
          doc.addPage();
          currentY = 20;
        }
        const amt = Number(ch.amount) || 0;
        totalAmount += amt;
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, currentY, pageWidth - (margin * 2), 6.5, 'F');
        }
        doc.setTextColor(30, 41, 59);
        doc.text(String(idx + 1), margin + 3, currentY + 4.5);
        doc.text(cleanPdfText(ch.description || 'Logistics Service'), margin + 12, currentY + 4.5);
        doc.text(amt.toLocaleString(), pageWidth - margin - 4, currentY + 4.5, { align: 'right' });
        currentY += 6.5;
      });

      // Total Row
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, currentY, pageWidth - (margin * 2), 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text('TOTAL AMOUNT DUE:', margin + 12, currentY + 5.5);
      doc.setTextColor(180, 83, 9); // gold / amber
      doc.text(`PKR ${totalAmount.toLocaleString()}`, pageWidth - margin - 4, currentY + 5.5, { align: 'right' });
      currentY += 16;

      // Operating Company Attribution (Logo + Company Name + Stamp) at bottom
      const invCompanyId = resolveOperatingCompanyFromRef((targetCase as any).companyId, targetCase.caseNo);
      await drawIssuingCompanySignatureAndStamp(doc, currentY, 'OFFICIAL INVOICE STAMP', invCompanyId, targetCase.caseNo, b.customLogo);

      renderFooter(1, 1);
    }

    // Generate output blob and trigger browser download
    const filename = options.onlyInvoice 
      ? `Invoice-${targetCase.caseNo}.pdf`
      : options.onlyCaseDetails
        ? `Case-Details-${targetCase.caseNo}.pdf`
        : `Dossier-${targetCase.caseNo}.pdf`;

    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);

    // Create invisible anchor element to trigger download across all browsers unless previewOnly is set
    if (!options.previewOnly) {
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = blobUrl;
      downloadAnchor.download = filename;
      downloadAnchor.rel = 'noopener noreferrer';
      downloadAnchor.style.display = 'none';
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();

      // Clean up anchor tag, retain blob for 60s for user fallback clicks
      setTimeout(() => {
        if (document.body.contains(downloadAnchor)) {
          document.body.removeChild(downloadAnchor);
        }
      }, 500);
    }

    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch (e) {
        // ignore
      }
    }, 60000);

    return { success: true, filename, blobUrl };
  } catch (error) {
    console.error('Failed to generate and download PDF:', error);
    throw error;
  }
}

export async function downloadContainerInvoicePdf(data: {
  invoiceNo: string;
  clientName: string;
  containerNo: string;
  size: string;
  weight?: number;
  sealNo?: string;
  route: string;
  rate: number;
  date: string;
  blNo?: string;
  companyName?: string;
  customLogo?: string | null;
  branding?: BrandingInfo;
}): Promise<{ success: boolean; filename: string; blobUrl?: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    let currentY = await drawPdfCorporateHeader(doc, {
      title: 'INVOICE',
      refNo: `Invoice: ${data.invoiceNo}`,
      date: data.date,
      subRef: `Container: ${data.containerNo}`,
      branding: {
        companyName: data.companyName,
        customLogo: data.customLogo,
        ...data.branding
      },
      accentColor: [234, 179, 8]
    });

    currentY += 4;

    // Client box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 22, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('BILLED TO (CLIENT):', margin + 4, currentY + 6);
    doc.text(data.clientName, margin + 4, currentY + 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`B/L Number: ${data.blNo || 'N/A'}`, margin + 4, currentY + 16);

    doc.text(`Route: ${data.route}`, pageWidth - margin - 4, currentY + 6, { align: 'right' });
    doc.text('Terms: Immediate upon delivery', pageWidth - margin - 4, currentY + 11, { align: 'right' });
    doc.text('Currency: PKR', pageWidth - margin - 4, currentY + 16, { align: 'right' });

    currentY += 28;

    // Charges table
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);

    doc.text('#', margin + 3, currentY + 4.8);
    doc.text('DESCRIPTION / CONTAINER PARTICULARS', margin + 12, currentY + 4.8);
    doc.text('AMOUNT (PKR)', pageWidth - margin - 4, currentY + 4.8, { align: 'right' });
    currentY += 7;

    // Line 1: Terminal Handling & Haulage
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);

    const desc1 = `Container ${data.containerNo} (${data.size}) - Route: ${data.route}`;
    doc.text('1', margin + 3, currentY + 4.5);
    doc.text(desc1, margin + 12, currentY + 4.5);
    doc.text(Number(data.rate).toLocaleString(), pageWidth - margin - 4, currentY + 4.5, { align: 'right' });
    currentY += 7;

    // Line 2: Port & Documentation EDI
    const docFee = 7500;
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 6.5, 'F');
    doc.text('2', margin + 3, currentY + 4.5);
    doc.text('Customs Port Documentation, EDI Clearance & Gate Pass', margin + 12, currentY + 4.5);
    doc.text(docFee.toLocaleString(), pageWidth - margin - 4, currentY + 4.5, { align: 'right' });
    currentY += 7;

    // Total
    const total = Number(data.rate) + docFee;
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('TOTAL AMOUNT DUE:', margin + 12, currentY + 5.5);
    doc.setTextColor(180, 83, 9);
    doc.text(`PKR ${total.toLocaleString()}`, pageWidth - margin - 4, currentY + 5.5, { align: 'right' });
    currentY += 18;

    // Official Company Stamp Only (Per SRS Policy: Only payment receipts carry accountant signature)
    const sigX = pageWidth - margin - 60;
    drawOfficialCompanyStampOnly(doc, sigX, currentY, 'OFFICIAL FREIGHT STAMP');

    // Footer with complete address & contacts
    drawPdfCorporateFooter(doc, 'ERP Verified Invoice', data.branding);

    // Trigger download
    const filename = `${data.invoiceNo}.pdf`;
    return triggerDirectDownload(doc, filename);
  } catch (err) {
    console.error('Failed to generate container invoice PDF:', err);
    throw err;
  }
}

/**
 * Converts numbers into English words (PKR format: Crores, Lakhs, Thousands, Rupees)
 */
export function numberToWordsRupees(num: number): string {
  if (!num || isNaN(num) || num === 0) return 'Rupees Zero Only';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertGroup(n: number): string {
    let str = '';
    if (n >= 100) {
      str += a[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      str += b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '') + ' ';
    } else if (n > 0) {
      str += a[n] + ' ';
    }
    return str.trim();
  }

  let n = Math.floor(Math.abs(num));
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const remainder = n;

  let result = '';
  if (crore > 0) result += convertGroup(crore) + ' Crore ';
  if (lakh > 0) result += convertGroup(lakh) + ' Lakh ';
  if (thousand > 0) result += convertGroup(thousand) + ' Thousand ';
  if (remainder > 0) result += convertGroup(remainder) + ' ';

  return `Rupees ${result.trim()} Only`;
}

function triggerDirectDownload(doc: jsPDF, filename: string): { success: boolean; filename: string; blobUrl: string } {
  const pdfBlob = doc.output('blob');
  const blobUrl = URL.createObjectURL(pdfBlob);

  try {
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = blobUrl;
    downloadAnchor.download = filename;
    downloadAnchor.style.display = 'none';
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();

    setTimeout(() => {
      if (document.body.contains(downloadAnchor)) {
        document.body.removeChild(downloadAnchor);
      }
    }, 1500);
  } catch (err) {
    console.warn('Anchor download fallback to doc.save:', err);
    try {
      doc.save(filename);
    } catch {
      // fallback
    }
  }

  setTimeout(() => {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      // ignore
    }
  }, 180000);

  return { success: true, filename, blobUrl };
}

/**
 * Native Web Share API helper for Mobile devices (iOS / Android)
 * Enables direct "Save to Files" or WhatsApp/Drive export on touch devices
 */
export async function sharePdfFile(blobUrl: string, filename: string, title?: string): Promise<boolean> {
  try {
    if (navigator.share) {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: title || filename,
          text: `Official PDF Document: ${filename}`
        });
        return true;
      }
    }
  } catch (err) {
    console.warn('Native share error or dismissed:', err);
  }
  return false;
}

// -------------------------------------------------------------
// 1. PAYMENT RECEIPT / VOUCHER
// -------------------------------------------------------------
export interface PaymentReceiptData {
  receiptNo: string;
  date: string;
  party: string;
  type: string; // 'INCOME' | 'EXPENSE' | 'RECEIVABLE' | 'PAYABLE'
  amount: number;
  paymentMethod?: string;
  bankName?: string;
  transactionId?: string;
  description: string;
  reference?: string;
  category?: string;
  caseNo?: string;
  receivedBy?: string;
  companyName?: string;
  customLogo?: string | null;
  branding?: BrandingInfo;
}

export async function downloadPaymentReceiptPdf(data: PaymentReceiptData): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const isIncome = data.type === 'INCOME' || data.type === 'RECEIVABLE';
    const accentColor: [number, number, number] = isIncome ? [16, 185, 129] : [220, 38, 38];
    const docTitle = isIncome ? 'PAYMENT RECEIPT' : 'PAYMENT VOUCHER';

    let currentY = await drawPdfCorporateHeader(doc, {
      title: docTitle,
      refNo: `Voucher: ${data.receiptNo}`,
      date: data.date,
      subRef: data.caseNo ? `Case Ref: ${data.caseNo}` : undefined,
      branding: {
        companyName: data.companyName,
        customLogo: data.customLogo,
        ...data.branding
      },
      accentColor
    });

    currentY += 4;

    // Party Information Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 24, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(isIncome ? 'RECEIVED WITH THANKS FROM (PARTY / CLIENT):' : 'PAID TO (BENEFICIARY / VENDOR):', margin + 4, currentY + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(data.party || 'Valued Customer', margin + 4, currentY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`Reference No: ${data.reference || data.caseNo || 'N/A'}`, margin + 4, currentY + 19);

    doc.text(`Account Head: ${data.category || 'General Ledger'}`, pageWidth - margin - 4, currentY + 6, { align: 'right' });
    doc.text(`Status: CLEARED / VERIFIED`, pageWidth - margin - 4, currentY + 13, { align: 'right' });
    doc.text(`Currency: PKR`, pageWidth - margin - 4, currentY + 19, { align: 'right' });

    currentY += 30;

    // Amount Box (Prominent display)
    doc.setFillColor(isIncome ? 240 : 254, isIncome ? 253 : 242, isIncome ? 244 : 242);
    doc.setDrawColor(isIncome ? 167 : 254, isIncome ? 243 : 202, isIncome ? 208 : 202);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 22, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(isIncome ? 6 : 153, isIncome ? 95 : 27, isIncome ? 70 : 27);
    doc.text('TOTAL AMOUNT RECEIVED / PAID:', margin + 5, currentY + 7);

    doc.setFontSize(14);
    doc.text(`PKR ${Number(data.amount).toLocaleString()}/-`, pageWidth - margin - 5, currentY + 8, { align: 'right' });

    // Amount in words
    const words = numberToWordsRupees(data.amount);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`In Words: ${words}`, margin + 5, currentY + 16);

    currentY += 28;

    // Payment Particulars Table
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('PARTICULARS / TRANSACTION SPECIFICATIONS', margin + 4, currentY + 4.8);
    doc.text('DETAILS', pageWidth - margin - 4, currentY + 4.8, { align: 'right' });

    currentY += 7;

    const rowDetails = [
      { label: 'Description / Purpose of Payment', value: data.description || 'Logistics & freight services payment' },
      { label: 'Payment Method', value: (data.paymentMethod || 'Cash').toUpperCase() },
      { label: 'Bank / Channel Name', value: data.bankName || 'Direct Terminal Counter / Cashier' },
      { label: 'Transaction / Cheque / Ref ID', value: data.transactionId || data.reference || 'SYS-AUTO-LOG' },
      { label: 'Associated Case / BL No', value: data.caseNo || data.reference || 'General Account' },
    ];

    rowDetails.forEach((row, idx) => {
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, currentY, pageWidth - (margin * 2), 6.5, 'F');
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(71, 85, 105);
      doc.text(row.label, margin + 4, currentY + 4.4);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(row.value, pageWidth - margin - 4, currentY + 4.4, { align: 'right' });

      currentY += 6.5;
    });

    currentY += 8;

    // Signatures & Stamp: Receiver/Payer signature line & Accountant Signature & Stamp
    drawAccountantStampAndSignature(doc, currentY, margin, pageWidth, isIncome);

    // Corporate footer with company address and contact numbers
    drawPdfCorporateFooter(doc, 'ERP Verified Receipt', data.branding);

    // Download trigger
    const cleanNo = data.receiptNo.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Receipt_${cleanNo}.pdf`;
    return triggerDirectDownload(doc, filename);
  } catch (error) {
    console.error('Failed to generate payment receipt PDF:', error);
    throw error;
  }
}

// -------------------------------------------------------------
// 2. RECEIVABLE INVOICE PDF
// -------------------------------------------------------------
export interface ReceivableInvoiceData {
  invoiceNo: string;
  date: string;
  dueDate?: string;
  clientName: string;
  clientAddress?: string;
  description: string;
  amount: number;
  reference?: string;
  category?: string;
  status?: string;
  companyName?: string;
  companyId?: CompanyId | string;
  customLogo?: string | null;
  branding?: BrandingInfo;
  lineItems?: Array<{ description: string; qty?: number; rate?: number; amount: number }>;
}

export async function downloadReceivableInvoicePdf(data: ReceivableInvoiceData): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    let currentY = await drawPdfCorporateHeader(doc, {
      title: 'INVOICE',
      refNo: `Invoice No: ${data.invoiceNo}`,
      date: data.date,
      subRef: data.dueDate ? `Due Date: ${data.dueDate}` : undefined,
      branding: {
        companyName: data.companyName,
        customLogo: data.customLogo,
        ...data.branding
      },
      accentColor: [234, 179, 8]
    });

    currentY += 4;

    // Client Info Card
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 22, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('INVOICE BILLED TO (CUSTOMER / CONSIGNEE):', margin + 4, currentY + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(data.clientName || 'Valued Client', margin + 4, currentY + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`Reference / B/L No: ${data.reference || 'N/A'}`, margin + 4, currentY + 17);

    doc.text(`Category: ${data.category || 'Freight Forwarding'}`, pageWidth - margin - 4, currentY + 6, { align: 'right' });
    doc.text(`Status: ${(data.status || 'UNPAID').toUpperCase()}`, pageWidth - margin - 4, currentY + 12, { align: 'right' });
    doc.text('Currency: PKR (Pak Rupees)', pageWidth - margin - 4, currentY + 17, { align: 'right' });

    currentY += 28;

    // Invoice Items Table
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);

    doc.text('#', margin + 3, currentY + 4.8);
    doc.text('DESCRIPTION / SERVICES PERFORMED', margin + 12, currentY + 4.8);
    doc.text('AMOUNT (PKR)', pageWidth - margin - 4, currentY + 4.8, { align: 'right' });
    currentY += 7;

    // Use customized line items or construct standard items
    const items = (data.lineItems && data.lineItems.length > 0) ? data.lineItems : [
      { description: data.description || 'Terminal Handling, Bonded Carrier & Freight Services', amount: data.amount }
    ];

    items.forEach((item, index) => {
      if (index % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, currentY, pageWidth - (margin * 2), 7, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);

      doc.text(String(index + 1), margin + 3, currentY + 4.8);
      doc.text(item.description, margin + 12, currentY + 4.8);
      doc.text(Number(item.amount).toLocaleString(), pageWidth - margin - 4, currentY + 4.8, { align: 'right' });

      currentY += 7;
    });

    // Total Highlight Box
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('TOTAL INVOICE AMOUNT DUE:', margin + 12, currentY + 5.5);
    doc.setTextColor(180, 83, 9);
    doc.text(`PKR ${Number(data.amount).toLocaleString()}`, pageWidth - margin - 4, currentY + 5.5, { align: 'right' });

    currentY += 12;

    // Amount in Words
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Amount in Words: ${numberToWordsRupees(data.amount)}`, margin, currentY);

    currentY += 18;

    // Operating Company Attribution (Circular Logo + Company Name + Official Stamp)
    const resolvedCompId = resolveOperatingCompanyFromRef(data.companyId, data.reference || data.invoiceNo);
    await drawIssuingCompanySignatureAndStamp(doc, currentY, 'OFFICIAL INVOICE STAMP', resolvedCompId, data.reference || data.invoiceNo, data.customLogo || data.branding?.customLogo);

    // Corporate footer with company address and contact numbers
    drawPdfCorporateFooter(doc, 'ERP Verified Invoice', data.branding);

    const cleanNo = data.invoiceNo.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Invoice_${cleanNo}.pdf`;
    return triggerDirectDownload(doc, filename);
  } catch (error) {
    console.error('Failed to generate receivable invoice PDF:', error);
    throw error;
  }
}

// -------------------------------------------------------------
// 3. CLIENT LEDGER STATEMENT
// -------------------------------------------------------------
export interface ClientLedgerExportData {
  clientName: string;
  statementDate: string;
  dateRange?: string;
  summary: {
    totalDebits: number;
    totalCredits: number;
    netBalance: number;
    totalCases?: number;
    totalContainers?: number;
  };
  entries: Array<{
    date: string;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  companyName?: string;
  companyId?: CompanyId | string;
  customLogo?: string | null;
  branding?: BrandingInfo;
  returnBase64Only?: boolean;
}

export async function downloadClientLedgerPdf(data: ClientLedgerExportData): Promise<{ success: boolean; filename: string; blobUrl: string; base64?: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    let currentY = 16;
    const b = { ...getStoredBranding(), ...data.branding };

    const drawHeader = async (pageNum: number) => {
      currentY = await drawPdfCorporateHeader(doc, {
        title: 'CLIENT STATEMENT OF ACCOUNT',
        refNo: `Client: ${data.clientName}`,
        date: data.statementDate,
        subRef: `Page ${pageNum}`,
        branding: {
          companyName: data.companyName,
          customLogo: data.customLogo,
          ...data.branding
        },
        accentColor: [37, 99, 235]
      });
      currentY += 4;
    };

    await drawHeader(1);

    // Client & Summary Header Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 26, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('ACCOUNT HOLDER / CLIENT:', margin + 4, currentY + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(data.clientName, margin + 4, currentY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`Total Active Cases: ${data.summary.totalCases || 0} | Containers: ${data.summary.totalContainers || 0}`, margin + 4, currentY + 20);

    // Summary Metric Pills on Right
    const col3X = pageWidth - margin - 75;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Total Debits (Billed):', col3X, currentY + 6);
    doc.text('Total Credits (Paid):', col3X, currentY + 12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Net Balance Due:', col3X, currentY + 19);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(185, 28, 28);
    doc.text(`PKR ${Number(data.summary.totalDebits).toLocaleString()}`, pageWidth - margin - 4, currentY + 6, { align: 'right' });

    doc.setTextColor(22, 163, 74);
    doc.text(`PKR ${Number(data.summary.totalCredits).toLocaleString()}`, pageWidth - margin - 4, currentY + 12, { align: 'right' });

    doc.setFontSize(9);
    doc.setTextColor(data.summary.netBalance > 0 ? 185 : 22, data.summary.netBalance > 0 ? 28 : 163, data.summary.netBalance > 0 ? 28 : 74);
    doc.text(`PKR ${Number(data.summary.netBalance).toLocaleString()}`, pageWidth - margin - 4, currentY + 19, { align: 'right' });

    currentY += 32;

    // Table Header
    const drawTableHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, currentY, pageWidth - (margin * 2), 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);

      doc.text('DATE', margin + 2, currentY + 4.8);
      doc.text('CASE NO', 38, currentY + 4.8);
      doc.text('DESCRIPTION / NARRATION', 74, currentY + 4.8);
      doc.text('DEBIT (PKR)', 150, currentY + 4.8, { align: 'right' });
      doc.text('CREDIT (PKR)', 173, currentY + 4.8, { align: 'right' });
      doc.text('BALANCE', pageWidth - margin - 2, currentY + 4.8, { align: 'right' });
      currentY += 7;
    };

    drawTableHeader();

    let pageNum = 1;

    for (let idx = 0; idx < data.entries.length; idx++) {
      const entry = data.entries[idx];
      const cleanDateStr = formatPdfDate(entry.date);

      // Format Case No and Description / Narration (strictly Container No & Vehicle No for case billings)
      let rawDesc = cleanPdfText(entry.description || '-');
      if (entry.debit > 0 && entry.reference !== 'OPN-BAL' && rawDesc.includes('Cntr No:')) {
        const cntrMatch = rawDesc.match(/Cntr No:\s*([^|]+)/i);
        const vehMatch = rawDesc.match(/Veh No:\s*([^|]+)/i);
        const extractedCntr = cntrMatch ? cntrMatch[1].trim() : 'N/A';
        const extractedVeh = vehMatch ? vehMatch[1].trim() : 'N/A';
        rawDesc = `Cntr No: ${extractedCntr} | Veh No: ${extractedVeh}`;
      }
      const refLines = doc.splitTextToSize(cleanPdfText(entry.reference || '-'), 34);
      const descLines = doc.splitTextToSize(rawDesc, 58);
      const lineCount = Math.min(3, Math.max(refLines.length, descLines.length));
      const rowHeight = lineCount === 1 ? 6.8 : lineCount === 2 ? 10.0 : 13.2;

      if (currentY + rowHeight > pageHeight - 25) {
        doc.addPage();
        pageNum++;
        await drawHeader(pageNum);
        drawTableHeader();
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, currentY, pageWidth - (margin * 2), rowHeight, 'F');
      }

      const numY = currentY + (lineCount === 1 ? 4.5 : lineCount === 2 ? 5.6 : 7.0);

      // DATE (Clean YYYY-MM-DD, never overflows into Case No column)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.3);
      doc.setTextColor(71, 85, 105);
      doc.text(cleanDateStr, margin + 2, numY);

      // CASE NO (Same for Case, Invoice & Voucher)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.1);
      doc.setTextColor(30, 41, 59);
      if (refLines.length > 1) {
        doc.text(refLines[0], 38, currentY + 3.8);
        doc.text(refLines[1], 38, currentY + 7.4);
      } else {
        doc.text(refLines[0] || '-', 38, numY);
      }

      // DESCRIPTION / NARRATION (Full Charge + Container No + Container Size + Container Quantity)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.1);
      doc.setTextColor(15, 23, 42);
      if (descLines.length === 1) {
        doc.text(descLines[0] || '-', 74, numY);
      } else {
        for (let l = 0; l < Math.min(3, descLines.length); l++) {
          doc.text(descLines[l], 74, currentY + 3.8 + (l * 3.5));
        }
      }

      // DEBIT
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(entry.debit > 0 ? 185 : 156, entry.debit > 0 ? 28 : 163, entry.debit > 0 ? 28 : 175);
      doc.text(entry.debit > 0 ? Number(entry.debit).toLocaleString() : '-', 150, numY, { align: 'right' });

      // CREDIT
      doc.setTextColor(entry.credit > 0 ? 22 : 156, entry.credit > 0 ? 163 : 163, entry.credit > 0 ? 74 : 175);
      doc.text(entry.credit > 0 ? Number(entry.credit).toLocaleString() : '-', 173, numY, { align: 'right' });

      // BALANCE
      doc.setTextColor(15, 23, 42);
      doc.text(Number(entry.balance).toLocaleString(), pageWidth - margin - 2, numY, { align: 'right' });

      currentY += rowHeight;
    }

    currentY += 6;
    if (currentY > pageHeight - 30) {
      doc.addPage();
      pageNum++;
      await drawHeader(pageNum);
      currentY += 4;
    }
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('OUTSTANDING CLOSING BALANCE:', margin + 4, currentY + 5.5);
    doc.setTextColor(data.summary.netBalance > 0 ? 185 : 22, data.summary.netBalance > 0 ? 28 : 163, data.summary.netBalance > 0 ? 28 : 74);
    doc.text(`PKR ${Number(data.summary.netBalance).toLocaleString()}`, pageWidth - margin - 2, currentY + 5.5, { align: 'right' });

    currentY += 12;
    if (currentY > pageHeight - 44) {
      doc.addPage();
      pageNum++;
      await drawHeader(pageNum);
      currentY += 4;
    }

    // Operating Company Attribution (Circular Logo + Company Name + Official Stamp) at bottom of Client Ledger
    const firstCaseRef = data.entries.find(e => e.reference && e.reference !== 'OPN-BAL')?.reference || '';
    const ledgerCompId = resolveOperatingCompanyFromRef(data.companyId, firstCaseRef);
    await drawIssuingCompanySignatureAndStamp(
      doc,
      currentY,
      'VERIFIED LEDGER STAMP',
      ledgerCompId,
      firstCaseRef,
      data.customLogo || data.branding?.customLogo
    );

    // Corporate footer with company address and contact numbers
    drawPdfCorporateFooter(doc, 'ERP Verified Client Statement', data.branding);

    const cleanClient = data.clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Client_Ledger_${cleanClient}_${new Date().toISOString().split('T')[0]}.pdf`;
    const dataUri = doc.output('datauristring');
    const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : '';

    if (data.returnBase64Only) {
      return { success: true, filename, blobUrl: '', base64 };
    }

    const dl = triggerDirectDownload(doc, filename);
    return { ...dl, base64 };
  } catch (error) {
    console.error('Failed to generate client ledger PDF:', error);
    throw error;
  }
}

// -------------------------------------------------------------
// 3.5. CASHBOOK LEDGER STATEMENT (STRICTLY CASH & BANK TRANSACTIONS)
// -------------------------------------------------------------
export interface CashbookLedgerExportData {
  dateRange?: string;
  generatedDate: string;
  totalInflow: number;
  totalOutflow: number;
  netBalance: number;
  entries: Array<{
    date: string;
    reference: string;
    party: string;
    description: string;
    paymentMethod?: string;
    bankName?: string;
    inflow: number;
    outflow: number;
    balance: number;
  }>;
  companyName?: string;
  customLogo?: string | null;
  branding?: BrandingInfo;
}

export async function downloadCashbookLedgerPdf(data: CashbookLedgerExportData): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    let currentY = 16;

    const drawHeader = async (pageNum: number) => {
      currentY = await drawPdfCorporateHeader(doc, {
        title: 'CASHBOOK LEDGER',
        refNo: data.dateRange ? `Period: ${data.dateRange}` : 'Official Cashbook Records',
        date: data.generatedDate,
        subRef: `Page ${pageNum}`,
        branding: {
          companyName: data.companyName,
          customLogo: data.customLogo,
          ...data.branding
        },
        accentColor: [15, 23, 42]
      });
      currentY += 4;
    };

    await drawHeader(1);

    // Summary Card
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 18, 2, 2, 'FD');

    const colWidth = (pageWidth - (margin * 2)) / 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL RECEIPTS (INFLOW)', margin + 6, currentY + 6);
    doc.text('TOTAL PAYMENTS (OUTFLOW)', margin + colWidth + 6, currentY + 6);
    doc.text('NET CASHBOOK BALANCE', margin + (colWidth * 2) + 6, currentY + 6);

    doc.setFontSize(10);
    doc.setTextColor(22, 163, 74);
    doc.text(`PKR ${Number(data.totalInflow).toLocaleString()}`, margin + 6, currentY + 13);

    doc.setTextColor(185, 28, 28);
    doc.text(`PKR ${Number(data.totalOutflow).toLocaleString()}`, margin + colWidth + 6, currentY + 13);

    doc.setTextColor(15, 23, 42);
    doc.text(`PKR ${Number(data.netBalance).toLocaleString()}`, margin + (colWidth * 2) + 6, currentY + 13);

    currentY += 24;

    const drawTableHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, currentY, pageWidth - (margin * 2), 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);

      doc.text('DATE', margin + 2, currentY + 4.8);
      doc.text('REF / SERIAL', margin + 23, currentY + 4.8);
      doc.text('PARTY / BENEFICIARY', margin + 47, currentY + 4.8);
      doc.text('DESCRIPTION & MODE', margin + 83, currentY + 4.8);
      doc.text('INFLOW (PKR)', pageWidth - margin - 52, currentY + 4.8, { align: 'right' });
      doc.text('OUTFLOW (PKR)', pageWidth - margin - 26, currentY + 4.8, { align: 'right' });
      doc.text('BALANCE', pageWidth - margin - 2, currentY + 4.8, { align: 'right' });
      currentY += 7;
    };

    drawTableHeader();

    let pageNum = 1;

    for (let idx = 0; idx < data.entries.length; idx++) {
      const entry = data.entries[idx];
      if (currentY > pageHeight - 38) {
        doc.addPage();
        pageNum++;
        await drawHeader(pageNum);
        drawTableHeader();
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, currentY, pageWidth - (margin * 2), 6.5, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(71, 85, 105);
      doc.text(formatPdfDate(entry.date), margin + 2, currentY + 4.4);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(37, 99, 235);
      doc.text(cleanPdfText(entry.reference || '-').substring(0, 12), margin + 23, currentY + 4.4);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      const partyStr = cleanPdfText(entry.party || '-').length > 20 ? cleanPdfText(entry.party || '-').substring(0, 18) + '..' : cleanPdfText(entry.party || '-');
      doc.text(partyStr, margin + 47, currentY + 4.4);

      const modeStr = entry.paymentMethod === 'BANK' ? (entry.bankName ? `[${entry.bankName}]` : '[Bank]') : '[Cash]';
      const descFull = `${cleanPdfText(entry.description || '-')} ${modeStr}`;
      const desc = descFull.length > 30 ? descFull.substring(0, 28) + '..' : descFull;
      doc.setTextColor(71, 85, 105);
      doc.text(desc, margin + 83, currentY + 4.4);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(entry.inflow > 0 ? 22 : 156, entry.inflow > 0 ? 163 : 163, entry.inflow > 0 ? 74 : 175);
      doc.text(entry.inflow > 0 ? Number(entry.inflow).toLocaleString() : '-', pageWidth - margin - 52, currentY + 4.4, { align: 'right' });

      doc.setTextColor(entry.outflow > 0 ? 185 : 156, entry.outflow > 0 ? 28 : 163, entry.outflow > 0 ? 28 : 175);
      doc.text(entry.outflow > 0 ? Number(entry.outflow).toLocaleString() : '-', pageWidth - margin - 26, currentY + 4.4, { align: 'right' });

      doc.setTextColor(15, 23, 42);
      doc.text(Number(entry.balance).toLocaleString(), pageWidth - margin - 2, currentY + 4.4, { align: 'right' });

      currentY += 6.5;
    }

    // Check if we have enough room for signatures & stamp, otherwise add page
    if (currentY > pageHeight - 40) {
      doc.addPage();
      pageNum++;
      await drawHeader(pageNum);
      currentY += 10;
    } else {
      currentY += 8;
    }

    // Stamp & Accountant Signature
    drawAccountantStampAndSignature(doc, currentY, margin, pageWidth);

    // Corporate footer
    drawPdfCorporateFooter(doc, 'ERP Verified Cashbook Ledger', data.branding);

    const filename = `Cashbook_Ledger_${new Date().toISOString().split('T')[0]}.pdf`;
    return triggerDirectDownload(doc, filename);
  } catch (error) {
    console.error('Failed to generate cashbook ledger PDF:', error);
    throw error;
  }
}

// -------------------------------------------------------------
// 4. GENERAL LEDGER STATEMENT
// -------------------------------------------------------------
export interface GeneralLedgerExportData {
  accountFilter: string;
  dateRange?: string;
  generatedDate: string;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  entries: Array<{
    date: string;
    party: string;
    category?: string;
    reference?: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  companyName?: string;
  customLogo?: string | null;
  branding?: BrandingInfo;
}

export async function downloadGeneralLedgerPdf(data: GeneralLedgerExportData): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    let currentY = 16;
    const b = { ...getStoredBranding(), ...data.branding };

    const drawHeader = async (pageNum: number) => {
      currentY = await drawPdfCorporateHeader(doc, {
        title: 'GENERAL LEDGER (GL)',
        refNo: `Account: ${data.accountFilter}`,
        date: data.generatedDate,
        subRef: `Page ${pageNum}`,
        branding: {
          companyName: data.companyName,
          customLogo: data.customLogo,
          ...data.branding
        },
        accentColor: [15, 23, 42]
      });
      currentY += 4;
    };

    await drawHeader(1);

    // Summary Card
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 18, 2, 2, 'FD');

    const colWidth = (pageWidth - (margin * 2)) / 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL DEBITS', margin + 6, currentY + 6);
    doc.text('TOTAL CREDITS', margin + colWidth + 6, currentY + 6);
    doc.text('NET CLOSING BALANCE', margin + (colWidth * 2) + 6, currentY + 6);

    doc.setFontSize(10);
    doc.setTextColor(185, 28, 28);
    doc.text(`PKR ${Number(data.totalDebits).toLocaleString()}`, margin + 6, currentY + 13);

    doc.setTextColor(22, 163, 74);
    doc.text(`PKR ${Number(data.totalCredits).toLocaleString()}`, margin + colWidth + 6, currentY + 13);

    doc.setTextColor(15, 23, 42);
    doc.text(`PKR ${Number(data.closingBalance).toLocaleString()}`, margin + (colWidth * 2) + 6, currentY + 13);

    currentY += 24;

    const drawTableHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, currentY, pageWidth - (margin * 2), 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);

      doc.text('DATE', margin + 2, currentY + 4.8);
      doc.text('PARTY / ACCOUNT', margin + 23, currentY + 4.8);
      doc.text('REF', margin + 56, currentY + 4.8);
      doc.text('DESCRIPTION', margin + 75, currentY + 4.8);
      doc.text('DEBIT (PKR)', pageWidth - margin - 52, currentY + 4.8, { align: 'right' });
      doc.text('CREDIT (PKR)', pageWidth - margin - 26, currentY + 4.8, { align: 'right' });
      doc.text('BALANCE', pageWidth - margin - 2, currentY + 4.8, { align: 'right' });
      currentY += 7;
    };

    drawTableHeader();

    let pageNum = 1;

    for (let idx = 0; idx < data.entries.length; idx++) {
      const entry = data.entries[idx];
      if (currentY > pageHeight - 25) {
        doc.addPage();
        pageNum++;
        await drawHeader(pageNum);
        drawTableHeader();
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, currentY, pageWidth - (margin * 2), 6.5, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(71, 85, 105);
      doc.text(formatPdfDate(entry.date), margin + 2, currentY + 4.4);

      const partyStr = cleanPdfText(entry.party || '-').length > 18 ? cleanPdfText(entry.party || '-').substring(0, 16) + '..' : cleanPdfText(entry.party || '-');
      doc.text(partyStr, margin + 23, currentY + 4.4);
      doc.text(cleanPdfText(entry.reference || '-').substring(0, 10), margin + 56, currentY + 4.4);

      const rawGlDesc = cleanPdfText(entry.description || '-');
      const desc = rawGlDesc.length > 36 ? rawGlDesc.substring(0, 34) + '..' : rawGlDesc;
      doc.setTextColor(15, 23, 42);
      doc.text(desc, margin + 75, currentY + 4.4);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(entry.debit > 0 ? 185 : 156, entry.debit > 0 ? 28 : 163, entry.debit > 0 ? 28 : 175);
      doc.text(entry.debit > 0 ? Number(entry.debit).toLocaleString() : '-', pageWidth - margin - 52, currentY + 4.4, { align: 'right' });

      doc.setTextColor(entry.credit > 0 ? 22 : 156, entry.credit > 0 ? 163 : 163, entry.credit > 0 ? 74 : 175);
      doc.text(entry.credit > 0 ? Number(entry.credit).toLocaleString() : '-', pageWidth - margin - 26, currentY + 4.4, { align: 'right' });

      doc.setTextColor(15, 23, 42);
      doc.text(Number(entry.balance).toLocaleString(), pageWidth - margin - 2, currentY + 4.4, { align: 'right' });

      currentY += 6.5;
    }

    // Corporate footer with company address and contact numbers
    drawPdfCorporateFooter(doc, 'ERP Verified General Ledger', data.branding);

    const cleanFilter = data.accountFilter.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `General_Ledger_${cleanFilter}_${new Date().toISOString().split('T')[0]}.pdf`;
    return triggerDirectDownload(doc, filename);
  } catch (error) {
    console.error('Failed to generate general ledger PDF:', error);
    throw error;
  }
}

// -------------------------------------------------------------
// 5. VEHICLE DETAILS & DISPATCH DOSSIER
// -------------------------------------------------------------
export interface VehicleExportData {
  registrationNumber: string;
  dplSerial: string;
  makeModel?: string;
  category: string;
  type: string;
  size?: string;
  engineNo?: string;
  chassisNo?: string;
  weightCapacity?: string;
  transporterName: string;
  driverName?: string;
  driverCnic?: string;
  driverContact?: string;
  status: string;
  validationStartDate?: string;
  validationExpiryDate?: string;
  tracker?: {
    id?: string;
    provider?: string;
    companyName?: string;
    status?: string;
    installationDate?: string;
    cost?: number;
  };
  ownerName?: string;
  ownerCnic?: string;
  ownerAddress?: string;
  createdAt?: string;
  registrationDate?: string;
  cancellationDate?: string;
  nocDate?: string;
  nocReference?: string;
  tripsHistory?: Array<{ date?: string; containerNumber?: string; driverName?: string; importerName?: string; clientName?: string }>;
  history?: Array<{ title?: string; date?: string; note?: string }>;
  companyName?: string;
  customLogo?: string | null;
  branding?: BrandingInfo;
}

export async function downloadVehicleDetailsPdf(data: VehicleExportData): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    let currentY = await drawPdfCorporateHeader(doc, {
      title: 'VEHICLE DOSSIER',
      refNo: `Reg: ${data.registrationNumber}`,
      date: new Date().toLocaleDateString(),
      subRef: `DPL Serial: ${data.dplSerial}`,
      branding: {
        companyName: data.companyName,
        customLogo: data.customLogo,
        ...data.branding
      },
      accentColor: [37, 99, 235]
    });

    currentY += 4;

    // Status & Category Overview Strip (without DPL Serial)
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 16, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`FLEET STATUS: ${data.status.replace(/_/g, ' ')}`, margin + 6, currentY + 6);
    doc.text(`CATEGORY: ${data.category}`, margin + 60, currentY + 6);
    doc.text(`BODY TYPE: ${data.type} (${data.size || 'Standard'})`, margin + 115, currentY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Transporter: ${data.transporterName}`, margin + 6, currentY + 12);
    doc.text(`Validation Expiry: ${data.validationExpiryDate || 'N/A'}`, margin + 115, currentY + 12);

    currentY += 22;

    // Unified Full-width VEHICLE DETAILS Section (Technical Specs + Driver + Owner details)
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 48, 2, 2, 'FD');

    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('VEHICLE DETAILS', margin + 4, currentY + 4.2);

    // Render 3 parallel columns for: Tech Specs, Driver & Tracker, Owner Details
    const colWidth = (pageWidth - (margin * 2) - 12) / 3;
    const col1X = margin + 4;
    const col2X = margin + colWidth + 6;
    const col3X = margin + (colWidth * 2) + 8;

    // Row definitions
    let rowY = currentY + 11;
    
    // Column 1: Specs
    const col1Specs = [
      { label: 'Registration No', val: data.registrationNumber },
      { label: 'Engine Number', val: data.engineNo || 'Verified' },
      { label: 'Chassis Number', val: data.chassisNo || 'Verified' },
      { label: 'Make & Model', val: data.makeModel || 'Heavy Haulage Truck' },
      { label: 'Weight Capacity', val: data.weightCapacity || '40-45 Ton' },
      { label: 'Body Category', val: `${data.category} • ${data.type}` }
    ];

    // Column 2: Driver & Tracker
    const col2Specs = [
      { label: 'Driver Name', val: data.driverName || 'Designated Driver' },
      { label: 'Driver CNIC', val: data.driverCnic || 'Registered' },
      { label: 'Driver Mobile', val: data.driverContact || 'On File' },
      { label: 'GPS Provider', val: data.tracker?.companyName || data.tracker?.provider || 'Active GPS' },
      { label: 'Tracker ID', val: data.tracker?.id || 'Tracking Active' },
      { label: 'Affiliation', val: data.transporterName }
    ];

    // Column 3: Owner Details
    const col3Specs = [
      { label: 'Owner Name', val: data.ownerName || data.transporterName || 'Verified Owner' },
      { label: 'Owner CNIC', val: data.ownerCnic || 'On Record' },
      { label: 'Address', val: (data.ownerAddress || 'Karachi Port, Pakistan').slice(0, 32) },
      { label: 'Reg Date', val: data.registrationDate || 'Enrolled' },
      { label: 'Status', val: data.status.replace(/_/g, ' ') },
      { label: 'NOC Issued', val: data.status === 'CANCELLED' ? 'Yes' : 'No' }
    ];

    for (let i = 0; i < 6; i++) {
      // Column 1 text
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(100, 116, 139);
      doc.text(col1Specs[i].label, col1X, rowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(col1Specs[i].val, col1X + colWidth - 2, rowY, { align: 'right' });

      // Column 2 text
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text(col2Specs[i].label, col2X, rowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(col2Specs[i].val, col2X + colWidth - 2, rowY, { align: 'right' });

      // Column 3 text
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text(col3Specs[i].label, col3X, rowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(col3Specs[i].val, col3X + colWidth - 2, rowY, { align: 'right' });

      rowY += 6;
    }

    currentY += 54;

    // REGISTRATION AND CANCELLATION HISTORY Section
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 26, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('REGISTRATION AND CANCELLATION HISTORY', margin + 4, currentY + 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(`Initial Fleet Enrollment: ${data.registrationDate || data.createdAt?.slice(0, 10) || 'Verified'}`, margin + 4, currentY + 11);
    doc.text(`Customs Bonded Permit Start: ${data.validationStartDate || '2024-01-01'}`, margin + 4, currentY + 16);
    doc.text(`Customs Bonded Expiry / Renewal: ${data.validationExpiryDate || 'Active'}`, margin + 4, currentY + 21);

    if (data.status === 'CANCELLED') {
      doc.setTextColor(220, 38, 38);
      doc.text(`Fleet Cancellation & NOC Issued: ${data.cancellationDate || data.nocDate || 'Cancelled'}`, pageWidth - margin - 4, currentY + 11, { align: 'right' });
      doc.text(`NOC Reference Code: ${data.nocReference || `NOC-${getActiveCompanyPrefix()}-VERIFIED`}`, pageWidth - margin - 4, currentY + 16, { align: 'right' });
      doc.text(`De-registration Status: CLOSED & CERTIFIED`, pageWidth - margin - 4, currentY + 21, { align: 'right' });
    } else {
      doc.setTextColor(22, 163, 74);
      doc.text(`Cancellation Status: NOT CANCELLED`, pageWidth - margin - 4, currentY + 11, { align: 'right' });
      doc.setTextColor(15, 23, 42);
      doc.text(`NOC Status: No NOC Requested`, pageWidth - margin - 4, currentY + 16, { align: 'right' });
      doc.text(`Clearance Integrity: VERIFIED ACTIVE`, pageWidth - margin - 4, currentY + 21, { align: 'right' });
    }

    currentY += 32;

    // VEHICLE TRIPS Table
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('VEHICLE TRIPS', margin + 4, currentY + 4.5);
    
    // Draw table headers
    currentY += 6.5;
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text('TRIP DATE', margin + 4, currentY + 4.2);
    doc.text('CONTAINER NUMBER', margin + 30, currentY + 4.2);
    doc.text('DRIVER NAME', margin + 70, currentY + 4.2);
    doc.text('IMPORTER NAME', margin + 110, currentY + 4.2);
    doc.text('CLIENT NAME', pageWidth - margin - 4, currentY + 4.2, { align: 'right' });

    currentY += 6;

    const tripsToRender = (data.tripsHistory && data.tripsHistory.length > 0) ? data.tripsHistory.slice(0, 4) : [
      { date: data.registrationDate || '2026-04-12', containerNumber: 'CON-49102-DPL', driverName: data.driverName || 'Primary Driver', importerName: 'Rafiullah & Sons Importers', clientName: 'Direct Client Group' }
    ];

    tripsToRender.forEach((trip, idx) => {
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, currentY, pageWidth - (margin * 2), 6.5, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(trip.date || '2026-04-01', margin + 4, currentY + 4.4);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(trip.containerNumber || 'N/A', margin + 30, currentY + 4.4);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(trip.driverName || data.driverName || 'Driver', margin + 70, currentY + 4.4);
      doc.text(trip.importerName || 'Importer', margin + 110, currentY + 4.4);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(trip.clientName || 'Direct Client', pageWidth - margin - 4, currentY + 4.4, { align: 'right' });

      currentY += 6.5;
    });

    currentY += 8;

    // Official Company Stamp Only (SRS: No personal signature required on dossier/NOC)
    const sigX = pageWidth - margin - 60;
    drawOfficialCompanyStampOnly(doc, sigX, currentY, 'FLEET VERIFICATION STAMP');

    // Corporate footer with company address and contact numbers
    drawPdfCorporateFooter(doc, 'ERP Verified Fleet Dossier', data.branding);

    const filename = `${data.registrationNumber}.pdf`;
    return triggerDirectDownload(doc, filename);
  } catch (error) {
    console.error('Failed to generate vehicle details PDF:', error);
    throw error;
  }
}

// -------------------------------------------------------------
// 7. VEHICLE CANCELLATION & DE-REGISTRATION NOC PDF
// -------------------------------------------------------------
export interface VehicleNocData {
  vehicle: Vehicle;
  nocNo?: string;
  reason?: string;
  date?: string;
  branding?: BrandingInfo;
}

/**
 * Generates an official No Objection Certificate (N.O.C) for vehicle de-registration.
 * Triggered automatically when a vehicle is cancelled or de-registered from the fleet.
 * Includes official company stamp only (in strict adherence to DOCKS SRS Policy).
 */
export async function downloadVehicleNocPdf(
  data: VehicleNocData
): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 18;
    const v = data.vehicle;

    // Format date as DD-MM-YYYY matching 10-11-2026 format
    const rawDate = data.date || v.cancellationDate || new Date().toISOString().slice(0, 10);
    let formattedDate = rawDate;
    const parts = String(rawDate).trim().split(/[/\-.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        formattedDate = `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
      } else {
        formattedDate = `${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[2]}`;
      }
    }

    // Resolve the specific company on whose panel this vehicle is registered
    const opRaw = String(v.operatingCompany || '').trim().toLowerCase();
    const nameRaw = String(v.companyName || '').trim().toUpperCase();
    let signoffCompany = 'DOCKS (PVT) LTD.';
    let resolvedCompId: CompanyId = 'docks';
    if (opRaw === 'truckit' || nameRaw.includes('TRUCKIT')) {
      signoffCompany = 'TRUCKIT (PVT) LTD.';
      resolvedCompId = 'truckit';
    } else if (opRaw === 'muhib' || nameRaw.includes('MUHIB')) {
      signoffCompany = 'MUHIB INTERNATIONAL';
      resolvedCompId = 'muhib';
    } else if (opRaw === 'vantage' || nameRaw.includes('VANTAGE')) {
      signoffCompany = 'VANTAGE SHIPPING LINE';
      resolvedCompId = 'vantage';
    } else if (opRaw === 'docks' || nameRaw.includes('DOCKS')) {
      signoffCompany = 'DOCKS (PVT) LTD.';
      resolvedCompId = 'docks';
    } else if (nameRaw) {
      signoffCompany = cleanPdfText(nameRaw);
    }

    // Leave clean top space for pre-printed company letterhead (55mm)
    let currentY = 56;

    // Right-aligned Date: DD-MM-YYYY (underlined)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    const datePrefix = 'Date: ';
    const dateVal = formattedDate;
    const dateValW = doc.getTextWidth(dateVal);
    const dateTotalW = doc.getTextWidth(datePrefix + dateVal);
    const dateStartX = pageWidth - margin - dateTotalW;
    doc.text(datePrefix + dateVal, dateStartX, currentY);
    doc.setLineWidth(0.35);
    doc.setDrawColor(0, 0, 0);
    doc.line(pageWidth - margin - dateValW, currentY + 1, pageWidth - margin, currentY + 1);

    currentY += 14;

    // Addressee Block
    const addrLines = [
      'The Deputy Director,',
      'Licensing of Bonded Carrier,',
      'Directorate of Transit Trade,',
      'Custom House,'
    ];
    addrLines.forEach((ln) => {
      doc.text(ln, margin, currentY);
      currentY += 5.5;
    });
    doc.text('Karachi.', margin, currentY);
    const khiW = doc.getTextWidth('Karachi.');
    doc.line(margin, currentY + 1, margin + khiW, currentY + 1);

    currentY += 12;

    // Subject Line
    doc.text('Subject:', margin, currentY);
    const subjX = margin + 22;
    const subjText = 'CANCELLATION OF REGISTERED VEHICLE FROM OUR PANEL';
    doc.text(subjText, subjX, currentY);
    const subjW = doc.getTextWidth(subjText);
    doc.line(subjX, currentY + 1, subjX + subjW, currentY + 1);

    currentY += 12;
    doc.text('Respected Sir,', margin, currentY);

    currentY += 9;
    const bodyText =
      'Reference to the above mentioned subject, this is to inform you that the contract agreement for the below mentioned vehicle gone cancelled. The details are listed as under';
    const wrappedBody = doc.splitTextToSize(bodyText, pageWidth - margin * 2);
    doc.text(wrappedBody, margin, currentY);
    currentY += wrappedBody.length * 5.5 + 6;

    // 8-Column Vehicle Table
    const makerVal = cleanPdfText((v.make || v.maker || (v.makeModel ? v.makeModel.split(/\s+/)[0] : '') || 'HINO').toUpperCase());
    const modelVal = cleanPdfText(String(v.model || (v.registrationDate ? v.registrationDate.slice(0, 4) : '-')));
    const mraVal = cleanPdfText((v.mra || 'KARACHI').toUpperCase());
    let leaseExpFormatted = formattedDate;
    if (v.validationExpiryDate) {
      const ep = String(v.validationExpiryDate).trim().split(/[/\-.]/);
      if (ep.length === 3) {
        leaseExpFormatted = ep[0].length === 4 ? `${ep[2]}-${ep[1]}-${ep[0]}` : `${ep[0]}-${ep[1]}-${ep[2]}`;
      }
    }

    const colWidths = [11, 23, 33, 31, 19, 16, 20, 21]; // Total = 174mm (= 210 - 36)
    const headers = ['Sr. #', 'Vehicle No.', 'Chassis No.', 'Engine No.', 'Maker', 'Model', 'MRA of\nVehicle', 'Lease Expiry\nDate'];
    const rowValues = [
      '1',
      cleanPdfText(v.registrationNumber || '-'),
      cleanPdfText(v.chassisNo || '-'),
      cleanPdfText(v.engineNo || '-'),
      makerVal,
      modelVal,
      mraVal,
      leaseExpFormatted
    ];

    const headerH = 11;
    const rowH = 9;
    doc.setFontSize(8.5);
    doc.setLineWidth(0.35);

    let xPos = margin;
    headers.forEach((h, idx) => {
      const cw = colWidths[idx];
      doc.rect(xPos, currentY, cw, headerH);
      const hLines = h.split('\n');
      if (hLines.length === 1) {
        doc.text(hLines[0], xPos + cw / 2, currentY + 6.5, { align: 'center' });
      } else {
        doc.text(hLines[0], xPos + cw / 2, currentY + 4.5, { align: 'center' });
        doc.text(hLines[1], xPos + cw / 2, currentY + 8.5, { align: 'center' });
      }
      xPos += cw;
    });

    currentY += headerH;
    xPos = margin;
    doc.setFontSize(8.2);
    rowValues.forEach((val, idx) => {
      const cw = colWidths[idx];
      doc.rect(xPos, currentY, cw, rowH);
      doc.text(val, xPos + cw / 2, currentY + 5.8, { align: 'center', maxWidth: cw - 1.5 });
      xPos += cw;
    });

    currentY += rowH + 16;

    doc.setFontSize(11);
    doc.text('Your usual cooperation in this regard would highly be appreciated.', margin, currentY);

    currentY += 14;
    doc.text('Yours Faithfully,', margin, currentY);

    currentY += 20;
    doc.text('_________________________', margin, currentY);
    currentY += 6.5;
    doc.text(`For: ${signoffCompany}`, margin, currentY);

    // Official Company Stamp on right side
    drawOfficialCompanyStampOnly(doc, pageWidth - margin - 58, currentY - 22, 'OFFICIAL NOC CARRIER SEAL', resolvedCompId);

    const nocSerial = data.nocNo || v.nocReference || `NOC-${Date.now().toString().slice(-6)}`;
    const cleanReg = v.registrationNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Cancellation_NOC_${cleanReg}_${nocSerial}.pdf`;
    return triggerDirectDownload(doc, filename);
  } catch (error) {
    console.error('Failed to generate vehicle NOC PDF:', error);
    throw error;
  }
}

export interface CaseDeliveryOrderData {
  targetCase: Case;
  branding?: BrandingInfo;
  officerName?: string;
}

export async function downloadCustomsDeliveryOrderPdf(
  data: CaseDeliveryOrderData
): Promise<{ success: boolean; filename: string; blobUrl: string; dataUrl?: string }> {
  try {
    const { targetCase } = data;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    let currentY = margin;

    const b = { ...getStoredBranding(), ...data.branding };
    const companyName = b.companyName || getDefaultBranding(getActiveCompany()).companyName;
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const doSerial = `DO-NOC-${targetCase.caseNo.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now().toString().slice(-4)}`;

    // Draw Corporate Header
    currentY = await drawPdfCorporateHeader(doc, {
      title: 'CUSTOMS BONDED CARRIER DELIVERY ORDER (DO / NOC)',
      refNo: `DO Ref: ${doSerial}`,
      date: today,
      subRef: `Case: ${targetCase.caseNo}`,
      branding: b,
      accentColor: [16, 185, 129] // Emerald accent
    });

    // Subtitle banner
    doc.setFillColor(16, 185, 129, 0.1);
    doc.setDrawColor(16, 185, 129, 0.3);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 8, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(5, 150, 105);
    doc.text('OFFICIAL CARRIER NO-OBJECTION CERTIFICATE (NOC) & FINAL CARGO RELEASE ORDER', pageWidth / 2, currentY + 5.2, { align: 'center' });
    currentY += 12;

    // Delivery Order Meta Block
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 26, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('CONSIGNMENT & CARRIER PARTICULARS', margin + 4, currentY + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);

    const c1 = margin + 4;
    const c2 = margin + 65;
    const c3 = margin + 125;

    doc.text(`Consignee / Client: ${targetCase.clientName || 'N/A'}`, c1, currentY + 11);
    doc.text(`B/L Number: ${targetCase.extractedData?.blNumber || 'N/A'}`, c1, currentY + 16);
    doc.text(`GD / TP Number: ${targetCase.extractedData?.tpNumber || targetCase.extractedData?.gdNo || targetCase.extractedData?.gdNumber || 'N/A'}`, c1, currentY + 21);

    doc.text(`Port of Loading (POL): ${targetCase.pol || 'N/A'}`, c2, currentY + 11);
    doc.text(`Port of Destination (POD): ${targetCase.pod || 'N/A'}`, c2, currentY + 16);
    doc.text(`Cargo Category: ${targetCase.category || 'Bonded Transit'}`, c2, currentY + 21);

    doc.text(`Carrier: ${companyName}`, c3, currentY + 11);
    doc.text(`Status: Workflow Completed`, c3, currentY + 16);
    doc.text(`Issued Date: ${today}`, c3, currentY + 21);

    currentY += 31;

    // Container Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('CONTAINERS & SEALS COVERED UNDER THIS DO / NOC:', margin, currentY);
    currentY += 3.5;

    // Table Header
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - (margin * 2), 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('SR', margin + 4, currentY + 4.2);
    doc.text('CONTAINER NO.', margin + 16, currentY + 4.2);
    doc.text('SIZE', margin + 60, currentY + 4.2);
    doc.text('WEIGHT (KG)', margin + 85, currentY + 4.2);
    doc.text('SEAL NO.', margin + 120, currentY + 4.2);
    doc.text('VEHICLE REG', margin + 155, currentY + 4.2);
    currentY += 6;

    const containers = targetCase.containers || [];
    if (containers.length === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, currentY, pageWidth - (margin * 2), 6, 'F');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text('General Consignment / Manifest Bulk (No individual container entries recorded)', margin + 4, currentY + 4.2);
      currentY += 6;
    } else {
      containers.forEach((cnt, idx) => {
        if (idx % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, currentY, pageWidth - (margin * 2), 5.5, 'F');
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(30, 41, 59);
        doc.text(String(idx + 1), margin + 4, currentY + 3.8);
        doc.setFont('helvetica', 'bold');
        doc.text(cnt.number || 'N/A', margin + 16, currentY + 3.8);
        doc.setFont('helvetica', 'normal');
        doc.text(cnt.size || 'N/A', margin + 60, currentY + 3.8);
        doc.text(cnt.weight ? `${cnt.weight.toLocaleString()} kg` : 'N/A', margin + 85, currentY + 3.8);
        doc.text(cnt.sealNo || 'CUSTOMS SEALED', margin + 120, currentY + 3.8);
        doc.text(cnt.vehicleNo || 'VERIFIED CARRIER', margin + 155, currentY + 3.8);
        currentY += 5.5;
      });
    }

    currentY += 6;

    // Customs Legal Release Declaration
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 26, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('OFFICIAL RELEASE DECLARATION & CARRIER ENDORSEMENT:', margin + 4, currentY + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    const releaseStatement = `This certifies that the bonded transit movement for the cargo referenced above has successfully arrived at the destination terminal (${targetCase.pod || 'Designated Dry Port / Terminal'}). All customs gate-in verification, seal integrity inspections, weight validations, and carrier documentation have been satisfactorily finalized. The cargo is hereby officially cleared for final discharge, delivery, and unstuffing in accordance with Pakistan Customs bonded carrier regulations.`;
    const splitStatement = doc.splitTextToSize(releaseStatement, pageWidth - (margin * 2) - 8);
    doc.text(splitStatement, margin + 4, currentY + 11);

    currentY += 34;

    // Official Stamp and Authorized Signatures
    const stampX = margin + 10;
    const signX = pageWidth - margin - 65;

    drawOfficialCompanyStampOnly(doc, stampX, currentY, 'CUSTOMS BONDED CARRIER SEAL');

    // Authorized signature line
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.4);
    doc.line(signX, currentY + 16, signX + 55, currentY + 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('Authorized Operations Officer', signX + 27.5, currentY + 20, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(data.officerName || companyName, signX + 27.5, currentY + 24, { align: 'center' });

    // Corporate Footer
    drawPdfCorporateFooter(doc, 'Official Customs Bonded Carrier Delivery Order', b);

    const cleanCaseNo = targetCase.caseNo.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Delivery_Order_${cleanCaseNo}.pdf`;
    let dataUrl: string | undefined = undefined;
    try {
      dataUrl = doc.output('datauristring');
    } catch (_) {}
    const result = await triggerDirectDownload(doc, filename);
    return { ...result, dataUrl };
  } catch (error) {
    console.error('Failed to generate delivery order PDF:', error);
    throw error;
  }
}

export interface TaxReportExportData {
  startDate: string;
  endDate: string;
  cases: Case[];
  finances: FinanceEntry[];
  branding?: any;
}

export async function downloadTaxReportPdf(data: TaxReportExportData): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    let currentY = 16;
    const b = { ...getStoredBranding(), ...data.branding };

    const drawHeader = async (pageNum: number) => {
      currentY = await drawPdfCorporateHeader(doc, {
        title: 'TAX & FINANCE STATEMENT',
        refNo: `Period: ${data.startDate} to ${data.endDate}`,
        date: new Date().toISOString().slice(0, 10),
        subRef: `Page ${pageNum}`,
        branding: b,
        accentColor: [15, 23, 42]
      });
      currentY += 4;
    };

    await drawHeader(1);

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    end.setHours(23, 59, 59, 999);

    const filteredFinances = data.finances.filter(f => {
      const d = new Date(f.date);
      return d >= start && d <= end;
    });

    const filteredCases = data.cases.filter(c => {
      const d = new Date(c.createdAt || c.date || Date.now());
      return d >= start && d <= end;
    });

    let totalIncome = 0;
    let totalExpense = 0;
    let outstandingReceivable = 0;
    let outstandingPayable = 0;

    filteredFinances.forEach(f => {
      if (f.type === 'INCOME') totalIncome += f.amount;
      else if (f.type === 'EXPENSE') totalExpense += f.amount;
      else if (f.type === 'RECEIVABLE' && f.status !== 'PAID') outstandingReceivable += (f.amount - (f.paidAmount || 0));
      else if (f.type === 'PAYABLE' && f.status !== 'PAID') outstandingPayable += (f.amount - (f.paidAmount || 0));
    });

    const netProfit = totalIncome - totalExpense;
    const provSalesTax = totalIncome * 0.13;
    const incomeTaxWithholding = totalIncome * 0.10;

    // Overview Cards
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - (margin * 2), 26, 2, 2, 'FD');

    const colWidth = (pageWidth - (margin * 2)) / 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL REVENUE', margin + 4, currentY + 6);
    doc.text('OPERATIONAL COST', margin + colWidth + 4, currentY + 6);
    doc.text('NET PROFIT/LOSS', margin + (colWidth * 2) + 4, currentY + 6);
    doc.text('EST. TAX WITHHELD (10%)', margin + (colWidth * 3) + 4, currentY + 6);

    doc.setFontSize(9.5);
    doc.setTextColor(22, 163, 74);
    doc.text(`PKR ${Math.round(totalIncome).toLocaleString()}`, margin + 4, currentY + 12);

    doc.setTextColor(185, 28, 28);
    doc.text(`PKR ${Math.round(totalExpense).toLocaleString()}`, margin + colWidth + 4, currentY + 12);

    doc.setTextColor(netProfit >= 0 ? 15 : 185, netProfit >= 0 ? 23 : 28, netProfit >= 0 ? 42 : 28);
    doc.text(`PKR ${Math.round(netProfit).toLocaleString()}`, margin + (colWidth * 2) + 4, currentY + 12);

    doc.setTextColor(15, 23, 42);
    doc.text(`PKR ${Math.round(incomeTaxWithholding).toLocaleString()}`, margin + (colWidth * 3) + 4, currentY + 12);

    // Second row in overview card
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('OUTSTANDING PAYABLES', margin + 4, currentY + 18);
    doc.text('OUTSTANDING RECEIVABLES', margin + colWidth + 4, currentY + 18);
    doc.text('EST. PROVINCIAL TAX (13%)', margin + (colWidth * 2) + 4, currentY + 18);
    doc.text('TOTAL ACTIVE CASES', margin + (colWidth * 3) + 4, currentY + 18);

    doc.setFontSize(9.5);
    doc.setTextColor(234, 88, 12);
    doc.text(`PKR ${Math.round(outstandingPayable).toLocaleString()}`, margin + 4, currentY + 24);

    doc.setTextColor(79, 70, 229);
    doc.text(`PKR ${Math.round(outstandingReceivable).toLocaleString()}`, margin + colWidth + 4, currentY + 24);

    doc.setTextColor(15, 23, 42);
    doc.text(`PKR ${Math.round(provSalesTax).toLocaleString()}`, margin + (colWidth * 2) + 4, currentY + 24);

    doc.setTextColor(15, 23, 42);
    doc.text(`${filteredCases.length} Cases`, margin + (colWidth * 3) + 4, currentY + 24);

    currentY += 32;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('FINANCIAL TRANSACTION SUMMARY', margin, currentY);
    currentY += 4;

    const drawFinanceHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, currentY, pageWidth - (margin * 2), 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);

      doc.text('DATE', margin + 2, currentY + 4.2);
      doc.text('REF / TR ID', margin + 22, currentY + 4.2);
      doc.text('DESCRIPTION / CATEGORY', margin + 46, currentY + 4.2);
      doc.text('PARTY / ASSOCIATED NO', margin + 110, currentY + 4.2);
      doc.text('TYPE', pageWidth - margin - 22, currentY + 4.2);
      doc.text('AMOUNT', pageWidth - margin - 2, currentY + 4.2, { align: 'right' });
      currentY += 6;
    };

    drawFinanceHeader();

    let pageNum = 1;
    if (filteredFinances.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('No financial transactions recorded within the selected period.', margin + 4, currentY + 5);
      currentY += 8;
    } else {
      for (let idx = 0; idx < filteredFinances.length; idx++) {
        const entry = filteredFinances[idx];
        if (currentY > pageHeight - 25) {
          doc.addPage();
          pageNum++;
          await drawHeader(pageNum);
          drawFinanceHeader();
        }

        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, currentY, pageWidth - (margin * 2), 5.5, 'F');
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(71, 85, 105);
        doc.text(entry.date, margin + 2, currentY + 3.8);
        doc.text(entry.reference || `REF-${entry.id}`, margin + 22, currentY + 3.8);

        const categoryAndDesc = `${entry.description} [${entry.category}]`;
        const truncatedDesc = categoryAndDesc.length > 44 ? categoryAndDesc.slice(0, 41) + '...' : categoryAndDesc;
        doc.setTextColor(15, 23, 42);
        doc.text(truncatedDesc, margin + 46, currentY + 3.8);

        const partyAndCase = `${entry.party || 'N/A'}${entry.caseNo ? ` (${entry.caseNo})` : ''}`;
        const truncatedParty = partyAndCase.length > 34 ? partyAndCase.slice(0, 31) + '...' : partyAndCase;
        doc.text(truncatedParty, margin + 110, currentY + 3.8);

        doc.setFont('helvetica', 'bold');
        if (entry.type === 'INCOME') {
          doc.setTextColor(22, 163, 74);
          doc.text('INCOME', pageWidth - margin - 22, currentY + 3.8);
        } else if (entry.type === 'EXPENSE') {
          doc.setTextColor(185, 28, 28);
          doc.text('EXPENSE', pageWidth - margin - 22, currentY + 3.8);
        } else if (entry.type === 'RECEIVABLE') {
          doc.setTextColor(79, 70, 229);
          doc.text('RECEIVABLE', pageWidth - margin - 22, currentY + 3.8);
        } else {
          doc.setTextColor(234, 88, 12);
          doc.text('PAYABLE', pageWidth - margin - 22, currentY + 3.8);
        }

        doc.setTextColor(15, 23, 42);
        doc.text(`PKR ${Math.round(entry.amount).toLocaleString()}`, pageWidth - margin - 2, currentY + 3.8, { align: 'right' });

        currentY += 5.5;
      }
    }

    currentY += 6;

    if (currentY > pageHeight - 35) {
      doc.addPage();
      pageNum++;
      await drawHeader(pageNum);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('ACTIVE OPERATIONS & LOGISTICS CASES', margin, currentY);
    currentY += 4;

    const drawCasesHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, currentY, pageWidth - (margin * 2), 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);

      doc.text('DATE', margin + 2, currentY + 4.2);
      doc.text('CASE NO', margin + 24, currentY + 4.2);
      doc.text('CLIENT', margin + 54, currentY + 4.2);
      doc.text('SERVICE TYPE', margin + 110, currentY + 4.2);
      doc.text('STATUS', pageWidth - margin - 2, currentY + 4.2, { align: 'right' });
      currentY += 6;
    };

    drawCasesHeader();

    if (filteredCases.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('No active operational cases logged within the selected period.', margin + 4, currentY + 5);
      currentY += 8;
    } else {
      for (let idx = 0; idx < filteredCases.length; idx++) {
        const caseItem = filteredCases[idx];
        if (currentY > pageHeight - 25) {
          doc.addPage();
          pageNum++;
          await drawHeader(pageNum);
          drawCasesHeader();
        }

        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, currentY, pageWidth - (margin * 2), 5.5, 'F');
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(71, 85, 105);
        doc.text(caseItem.createdAt || caseItem.date || '-', margin + 2, currentY + 3.8);
        
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(caseItem.caseNo, margin + 24, currentY + 3.8);

        doc.setFont('helvetica', 'normal');
        doc.text(caseItem.clientName || 'N/A', margin + 54, currentY + 3.8);
        doc.text(caseItem.category || 'Bonded Carrier', margin + 110, currentY + 3.8);

        if (caseItem.status === 'Case Completed' || caseItem.status === 'Completed') {
          doc.setTextColor(22, 163, 74);
        } else {
          doc.setTextColor(79, 70, 229);
        }
        doc.text(caseItem.status || 'Active', pageWidth - margin - 2, currentY + 3.8, { align: 'right' });

        currentY += 5.5;
      }
    }

    if (currentY > pageHeight - 35) {
      doc.addPage();
      pageNum++;
      await drawHeader(pageNum);
    }

    currentY += 10;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Disclaimer: This report is a digital consolidation of the ledger and case activities for tax recording and financial auditing.', margin, currentY);

    currentY += 8;
    const lineW = 55;
    const signCol1 = margin;
    const signCol2 = pageWidth - margin - lineW;

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(signCol1, currentY, signCol1 + lineW, currentY);
    doc.line(signCol2, currentY, signCol2 + lineW, currentY);

    currentY += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('Prepared By: Chief Financial Officer', signCol1, currentY);
    doc.text('Approved By: Director Operations / Admin', signCol2, currentY);

    for (let p = 1; p <= pageNum; p++) {
      doc.setPage(p);
      drawPdfCorporateFooter(doc, 'Confidential Logistics Tax & Finance Performance Statement', b);
    }

    const prefix = getActiveCompanyPrefix();
    const filename = `${prefix}_Tax_Finance_Report_${data.startDate}_to_${data.endDate}.pdf`;
    return triggerDirectDownload(doc, filename);
  } catch (error) {
    console.error('Failed to generate Tax & Finance PDF:', error);
    throw error;
  }
}

// ============================================================================
// OFFICIAL GOVERNMENT OF PAKISTAN CUSTOMS VEHICLE LIST (PDF EXPORT)
// Faithful reproduction of the official Customs House Karachi Directorate General
// of Transit Trade provisional vehicle permit letter & vehicle list table
// ============================================================================
export interface CustomsVehicleListPdfOptions {
  vehicles: Vehicle[];
  letterDate?: string;
  applicationDate?: string;
  permitNo?: string;
  periodMonths?: number;
}

export async function downloadCustomsVehicleListPdf(
  options: CustomsVehicleListPdfOptions
): Promise<{ filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - (margin * 2);

    const now = new Date();
    const formattedLetterDate = options.letterDate || `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
    const formattedAppDate = options.applicationDate || formattedLetterDate;
    const permitNo = options.permitNo || 'No. SI/Mics./01/2021–(Licensing)';
    const vehicleCount = options.vehicles.length;

    let currentY = 16;
    let pageNum = 1;

    // Helper: Draw official Customs Government header
    const drawGovtHeader = () => {
      doc.setFont('times', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(0, 0, 0);
      doc.text('Government of Pakistan', pageWidth / 2, currentY, { align: 'center' });
      currentY += 5;

      doc.setFontSize(12);
      doc.text('Directorate General of Transit Trade', pageWidth / 2, currentY, { align: 'center' });
      currentY += 4.5;

      doc.setFont('times', 'normal');
      doc.setFontSize(10.5);
      doc.text('Custom House', pageWidth / 2, currentY, { align: 'center' });
      currentY += 4.5;

      doc.setFont('times', 'bold');
      doc.setFontSize(11);
      doc.text('Karachi', pageWidth / 2, currentY, { align: 'center' });
      currentY += 4;

      doc.setFont('times', 'normal');
      doc.setFontSize(10);
      doc.text('****', pageWidth / 2, currentY, { align: 'center' });
      currentY += 7;
    };

    drawGovtHeader();

    // Reference & Date row
    doc.setFont('times', 'bold');
    doc.setFontSize(9.5);
    doc.text(permitNo, margin, currentY);
    doc.text(`Dated: ${formattedLetterDate}`, pageWidth - margin, currentY, { align: 'right' });
    currentY += 8;

    // Addressee Block
    const permitComp = getActiveCompany();
    const permitName = permitComp.legalTitle || permitComp.name;
    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    doc.text(`M/s. ${permitName}`, margin, currentY);
    currentY += 4.5;

    doc.setFont('times', 'normal');
    doc.setFontSize(9.5);
    doc.text('Office No. 13 First Floor State Life Building No. 7', margin, currentY);
    currentY += 4;
    doc.text('G-Allana Road Tower,', margin, currentY);
    currentY += 4;
    doc.setFont('times', 'bold');
    doc.text('Karachi.', margin, currentY);
    currentY += 7;

    // Subject Line
    doc.setFont('times', 'bold');
    doc.setFontSize(9.5);
    const subjectPrefix = 'Subject: - ';
    doc.text(subjectPrefix, margin, currentY);
    const subjX = margin + doc.getTextWidth(subjectPrefix);
    const subjText = 'PERMIT FOR RENEWAL / FRESH REGISTRATION OF VEHICLES IN THE SYSTEM AS PRIVATE BONDED CARRIER / TRANSPORT OPERATOR';
    const splitSubj = doc.splitTextToSize(subjText, contentWidth - doc.getTextWidth(subjectPrefix));
    doc.text(splitSubj, subjX, currentY);
    // Draw underline under subject
    const subjH = splitSubj.length * 4.2;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.line(subjX, currentY + 1, subjX + doc.getTextWidth(splitSubj[0]), currentY + 1);
    currentY += subjH + 3;

    // Reference clause
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    const refText = `Please refer to your application dated ${formattedAppDate} on the subject cited above.`;
    doc.text(refText, margin, currentY);
    currentY += 5.5;

    // Paragraph 2 Body Text
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    const para2Text = `2.  The request for renewal of vehicles and fresh registration of ${vehicleCount} vehicles in terms of Rule 329 (5) & (6) of Chapter XIV, Rule 478 (d) of Chapter XXI and Rule 639 (d) of Customs Rules, 2001 notified vide SRO 450(I)/2001 dated 18.06.2001 acceded to and total ${vehicleCount} vehicles, particulars of which indicated in the table below are hereby provisionally registered in the system with M/s. ${permitName} Karachi for providing transport facility to the transhipments to and from upcountry Customs Dry Ports as well as transit goods for a period of six months. The Customs House, however, reserves the right to revoke / suspend this provisional registration fully or partially at any time during the period of its validity without any prior notice.`;
    const splitPara2 = doc.splitTextToSize(para2Text, contentWidth);
    doc.text(splitPara2, margin, currentY);
    currentY += (splitPara2.length * 4.1) + 4;

    // Vehicle Table Header
    const colWidths = [10, 24, 40, 32, 28, 16, 18, 20]; // Total: 188mm
    const colX: number[] = [];
    let accX = margin;
    for (const w of colWidths) {
      colX.push(accX);
      accX += w;
    }

    const drawTableHeader = () => {
      doc.setFillColor(245, 245, 245);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.25);
      doc.rect(margin, currentY, contentWidth, 7, 'FD');

      doc.setFont('times', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);

      const headers = ['S #', 'Reg. No.', 'Chassis No.', 'Engine No.', 'Make', 'Model', 'MRA', 'Expiry'];
      headers.forEach((h, idx) => {
        const xPos = colX[idx] + (colWidths[idx] / 2);
        doc.text(h, xPos, currentY + 4.8, { align: 'center' });
        if (idx > 0) {
          doc.line(colX[idx], currentY, colX[idx], currentY + 7);
        }
      });
      currentY += 7;
    };

    drawTableHeader();

    // Table Data Rows
    options.vehicles.forEach((v, index) => {
      if (currentY > pageHeight - 35) {
        doc.addPage();
        pageNum++;
        currentY = 16;
        drawGovtHeader();
        drawTableHeader();
      }

      const rowHeight = 6.2;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.18);
      doc.rect(margin, currentY, contentWidth, rowHeight);

      doc.setFont('times', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);

      const makeStr = (v.maker || v.makeModel || '').trim();
      const modelStr = (v.model || '').trim();
      const mraStr = (v.mra || '').trim();
      const expStr = v.validationExpiryDate || '-';

      const cells = [
        String(index + 1),
        v.registrationNumber || '-',
        v.chassisNo || '-',
        v.engineNo || '-',
        makeStr || '-',
        modelStr || '-',
        mraStr || '-',
        expStr
      ];

      cells.forEach((text, cIdx) => {
        const xPos = colX[cIdx] + (colWidths[cIdx] / 2);
        doc.text(text, xPos, currentY + 4.2, { align: 'center' });
        if (cIdx > 0) {
          doc.line(colX[cIdx], currentY, colX[cIdx], currentY + rowHeight);
        }
      });

      currentY += rowHeight;
    });

    currentY += 5;

    // Check if space remains for closing and signature
    if (currentY > pageHeight - 55) {
      doc.addPage();
      pageNum++;
      currentY = 16;
      drawGovtHeader();
    }

    // Paragraph 3 Body Text
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    const para3Text = `3.  Appropriate Customs Officer assigned the job of issuing sealing certificate at exit point of Port / Airport must ensure the fulfilment of conditions in terms of Rule 327, 328 and 329 of Chapter XIV and Rule 477, 478 and 479 of Chapter XXI of Customs Rules, 2001 notified vide SRO 450(I)/2001 dated 18.06.2001 besides other conditions contained in the said rules. The Trackers in these vehicles may also be checked by the concerned Customs staff of tracking, sealing and monitoring at the time of exit of vehicles with goods from port.`;
    const splitPara3 = doc.splitTextToSize(para3Text, contentWidth);
    doc.text(splitPara3, margin, currentY);
    currentY += (splitPara3.length * 4.1) + 10;

    // Deputy Director Signature Block (Right aligned)
    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    doc.text('(Deputy Director)', pageWidth - margin - 8, currentY, { align: 'right' });
    currentY += 4.5;
    doc.text('(Licensing)', pageWidth - margin - 8, currentY, { align: 'right' });
    currentY += 10;

    // Distribution / Copy to block
    doc.setFont('times', 'bold');
    doc.setFontSize(8.5);
    doc.text('Copy to:', margin, currentY);
    currentY += 4;

    doc.setFont('times', 'normal');
    doc.setFontSize(8);
    const copies = [
      '1.  The Member (Customs), FBR, Islamabad.',
      '2.  The Director General, Directorate of Transit Trade, Karachi.',
      '3.  The Collector of Customs (Appraisement East / West / Port Qasim), Karachi.',
      '4.  Project Director, PRAL, Custom House, Karachi (for electronic system profiling).',
      '5.  Office Record.'
    ];
    copies.forEach(c => {
      doc.text(c, margin, currentY);
      currentY += 3.8;
    });

    const filename = `Customs_Vehicle_List_${formattedLetterDate.replace(/\./g, '_')}.pdf`;
    return triggerDirectDownload(doc, filename);
  } catch (error) {
    console.error('Failed to generate Customs Vehicle List PDF:', error);
    throw error;
  }
}

export interface LoadingBillItem {
  head: string;
  amount: number;
  receiptName?: string;
  receiptUrl?: string;
  remarks?: string;
}

export interface LoadingBillData {
  billNo: string;
  caseNo: string;
  clientName?: string;
  containerNo?: string;
  vehicleNo?: string;
  driverName?: string;
  portTerminal: string;
  date: string;
  items: LoadingBillItem[];
  totalAmount: number;
  remarks?: string;
  officerName?: string;
  branding?: BrandingInfo;
}

export async function downloadLoadingBillPdf(data: LoadingBillData): Promise<{ success: boolean; filename: string; blobUrl?: string; dataUrl?: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    let currentY = await drawPdfCorporateHeader(doc, {
      title: 'PORT LOADING BILL',
      refNo: `Bill No: ${data.billNo}`,
      date: data.date,
      subRef: `Case: ${data.caseNo}`,
      branding: data.branding,
      accentColor: [14, 165, 233] // Sky blue accent
    });

    currentY += 4;

    // Thank you / Notice line
    doc.setFillColor(240, 249, 255);
    doc.setDrawColor(186, 230, 253);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, currentY, pageWidth - margin * 2, 8, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(3, 105, 161);
    doc.text('OFFICIAL PORT TERMINAL LOADING & DISBURSEMENT BILL', margin + 4, currentY + 5.2);
    currentY += 12;

    // Case & Terminal Particulars Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - margin * 2, 28, 2, 2, 'FD');

    const colW = (pageWidth - margin * 2) / 3;

    // Col 1
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('CASE NUMBER', margin + 4, currentY + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(data.caseNo || 'N/A', margin + 4, currentY + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('CLIENT NAME', margin + 4, currentY + 17);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(data.clientName || 'Valued Client', margin + 4, currentY + 22);

    // Col 2
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('PORT / TERMINAL', margin + colW + 4, currentY + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(14, 165, 233);
    doc.text(data.portTerminal || 'Karachi Port Terminal', margin + colW + 4, currentY + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('CONTAINER NUMBER', margin + colW + 4, currentY + 17);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(data.containerNo || 'N/A', margin + colW + 4, currentY + 22);

    // Col 3
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('ASSIGNED VEHICLE', margin + colW * 2 + 4, currentY + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(data.vehicleNo || 'N/A', margin + colW * 2 + 4, currentY + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('DRIVER PARTICULAR', margin + colW * 2 + 4, currentY + 17);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(data.driverName || 'N/A', margin + colW * 2 + 4, currentY + 22);

    currentY += 34;

    // Itemized Charges Table Header
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - margin * 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('SR#', margin + 3, currentY + 4.8);
    doc.text('LOADING / TERMINAL CHARGE DESCRIPTION', margin + 18, currentY + 4.8);
    doc.text('SUPPORTING RECEIPT', margin + 115, currentY + 4.8);
    doc.text('AMOUNT (PKR)', pageWidth - margin - 4, currentY + 4.8, { align: 'right' });
    currentY += 7;

    // Table rows
    const items = data.items && data.items.length > 0 ? data.items : [
      { head: 'Terminal Wharfage Payment', amount: 0 },
      { head: 'Additional Wharfage Payment', amount: 0 },
      { head: 'Satellite GPS Tracker Fee', amount: 0 },
      { head: 'Port Gate Delivery Charges', amount: 0 }
    ];

    let rowIdx = 1;
    let runningTotal = 0;

    for (const item of items) {
      const isAlt = rowIdx % 2 === 0;
      doc.setFillColor(isAlt ? 248 : 255, isAlt ? 250 : 255, isAlt ? 252 : 255);
      doc.rect(margin, currentY, pageWidth - margin * 2, 7, 'F');
      doc.setDrawColor(241, 245, 249);
      doc.line(margin, currentY + 7, pageWidth - margin, currentY + 7);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(String(rowIdx).padStart(2, '0'), margin + 3, currentY + 4.8);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(item.head, margin + 18, currentY + 4.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      if (item.receiptName || item.receiptUrl) {
        doc.setTextColor(16, 185, 129);
        doc.text('Attached (Verified)', margin + 115, currentY + 4.8);
      } else {
        doc.setTextColor(148, 163, 184);
        doc.text('System Disbursed', margin + 115, currentY + 4.8);
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(Number(item.amount || 0).toLocaleString('en-PK'), pageWidth - margin - 4, currentY + 4.8, { align: 'right' });

      runningTotal += Number(item.amount || 0);
      currentY += 7;
      rowIdx++;
    }

    const finalTotal = data.totalAmount > 0 ? data.totalAmount : runningTotal;

    // Total Row
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, currentY, pageWidth - margin * 2, 8, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('TOTAL LOADING BILL AMOUNT DUE:', margin + 18, currentY + 5.5);
    doc.setFontSize(10.5);
    doc.setTextColor(14, 165, 233);
    doc.text(`PKR ${finalTotal.toLocaleString('en-PK')}`, pageWidth - margin - 4, currentY + 5.5, { align: 'right' });
    currentY += 14;

    // Remarks & Authorized Seal Stamp
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('OPERATIONAL REMARKS:', margin, currentY);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(data.remarks || 'All terminal handling, wharfage and vehicle gate out charges verified at port of loading.', margin, currentY + 4.5);

    // Official Stamp / Signature block
    const stampX = pageWidth - margin - 50;
    doc.setDrawColor(203, 213, 225);
    doc.line(stampX, currentY + 18, pageWidth - margin, currentY + 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('PORT OPERATIONS OFFICER', stampX + 25, currentY + 22, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(data.officerName || 'Karachi Port Terminal Desk', stampX + 25, currentY + 26, { align: 'center' });

    // Corporate Footer
    drawPdfCorporateFooter(doc, 'Page 1 of 1', data.branding);

    const cleanBillNo = (data.billNo || 'LB-' + Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Loading_Bill_${cleanBillNo}.pdf`;
    let dataUrl: string | undefined = undefined;
    try {
      dataUrl = doc.output('datauristring');
    } catch (_) {}
    const result = await triggerDirectDownload(doc, filename);
    return { ...result, dataUrl };
  } catch (error) {
    console.error('Failed to generate Loading Bill PDF:', error);
    throw error;
  }
}

export interface DriverIdCardPdfData {
  vehicleNo: string;
  caseNo?: string;
  date?: string;
  pol?: string;
  pod?: string;
  clientName?: string;
  importerName?: string;
  itemDescription?: string;
  driverName?: string;
  driverPhone?: string;
  driverCnic?: string;
  cnicFrontUrl?: string;
  cnicBackUrl?: string;
  branding?: BrandingInfo;
}

async function normalizeImageForJsPdf(src?: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!src || typeof window === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const normalizedSrc = normalizeSvgDataUrlForCanvas(src);
      const img = new Image();
      if (!normalizedSrc.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => {
        try {
          const nw = img.naturalWidth || img.width || 800;
          const nh = img.naturalHeight || img.height || 500;
          const maxDim = 1400;
          const scale = Math.min(1, maxDim / Math.max(nw, nh));
          const cw = Math.max(1, Math.round(nw * scale));
          const ch = Math.max(1, Math.round(nh * scale));
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          resolve({
            dataUrl: canvas.toDataURL('image/jpeg', 0.9),
            width: cw,
            height: ch
          });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = normalizedSrc;
    } catch {
      resolve(null);
    }
  });
}

export async function downloadDriverIdCardPdf(data: DriverIdCardPdfData) {
  const safeDriver = (data.driverName || 'Driver').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeVehicle = (data.vehicleNo || 'Vehicle').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeCase = data.caseNo ? `_${data.caseNo.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
  const filename = `Driver_ID_Card_${safeDriver}_${safeVehicle}${safeCase}.pdf`;

  // If user uploaded a single combined PDF (Front & Back together), download the exact untouched PDF As-It-Is!
  const singleUploadedUrl =
    data.cnicFrontUrl && !data.cnicBackUrl
      ? data.cnicFrontUrl
      : !data.cnicFrontUrl && data.cnicBackUrl
      ? data.cnicBackUrl
      : '';
  if (singleUploadedUrl && singleUploadedUrl.startsWith('data:application/pdf') && singleUploadedUrl.includes(',')) {
    try {
      const b64 = singleUploadedUrl.split(',')[1];
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return { success: true, filename, blobUrl: url };
    } catch (err) {
      console.warn('Direct Driver ID PDF download fallback:', err);
    }
  }

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  let currentY = await drawPdfCorporateHeader(doc, {
    title: 'DRIVER ID CARD & TRIP RECORD',
    refNo: data.caseNo ? `CASE: ${data.caseNo}` : `VEHICLE: ${data.vehicleNo}`,
    date: data.date || new Date().toISOString().split('T')[0],
    subRef: `Vehicle Plate: ${data.vehicleNo || 'N/A'}`,
    branding: data.branding,
    accentColor: [14, 165, 233]
  });

  currentY += 3;

  // Section 1: Driver Particulars & Trip Summary Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, currentY, contentWidth, 48, 2, 2, 'FD');

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, currentY, contentWidth, 7.5, 2, 2, 'F');
  doc.rect(margin, currentY + 4, contentWidth, 3.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('DRIVER IDENTIFICATION & CONSIGNMENT PARTICULARS', margin + 4, currentY + 5.2);

  const col1X = margin + 4;
  const col2X = margin + contentWidth / 2 + 2;
  let rowY = currentY + 13;

  const drawFieldPair = (x: number, y: number, label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    const maxValW = contentWidth / 2 - 34;
    const clipped = doc.splitTextToSize(cleanPdfText(value || 'Not Recorded'), maxValW)[0] || 'Not Recorded';
    doc.text(clipped, x + 30, y);
  };

  drawFieldPair(col1X, rowY, 'Driver Name:', data.driverName || 'Not Recorded');
  drawFieldPair(col2X, rowY, 'Vehicle Plate:', data.vehicleNo || 'N/A');
  rowY += 6.5;

  drawFieldPair(col1X, rowY, 'CNIC / ID No:', data.driverCnic || 'Not Recorded');
  drawFieldPair(col2X, rowY, 'Case Number:', data.caseNo || 'N/A');
  rowY += 6.5;

  drawFieldPair(col1X, rowY, 'Mobile Number:', data.driverPhone || 'Not Recorded');
  drawFieldPair(col2X, rowY, 'Trip Date:', data.date ? formatPdfDate(data.date) : 'N/A');
  rowY += 6.5;

  drawFieldPair(col1X, rowY, 'Loading Port:', data.pol || 'Karachi Port');
  drawFieldPair(col2X, rowY, 'Destination:', data.pod || 'Destination Port');
  rowY += 6.5;

  drawFieldPair(col1X, rowY, 'Client Name:', data.clientName || 'N/A');
  drawFieldPair(col2X, rowY, 'Importer / Item:', `${data.importerName || 'N/A'} (${data.itemDescription || 'Cargo'})`);

  currentY += 54;

  // Section 2: CNIC Scan Card(s)
  const drawCnicSlot = async (
    slotTitle: string,
    imgSrc?: string,
    slotY: number = currentY,
    boxH: number = 82
  ): Promise<number> => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, slotY, contentWidth, boxH, 2, 2, 'FD');

    doc.setFillColor(241, 245, 249);
    doc.rect(margin + 0.3, slotY + 0.3, contentWidth - 0.6, 7.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(slotTitle, margin + 4, slotY + 5.2);

    const parsedImg = await normalizeImageForJsPdf(imgSrc);
    if (parsedImg) {
      const availW = contentWidth - 16;
      const availH = boxH - 14;
      const scale = Math.min(availW / parsedImg.width, availH / parsedImg.height);
      const drawW = parsedImg.width * scale;
      const drawH = parsedImg.height * scale;
      const drawX = margin + (contentWidth - drawW) / 2;
      const drawY = slotY + 9.5 + (availH - drawH) / 2;
      doc.addImage(parsedImg.dataUrl, 'JPEG', drawX, drawY, drawW, drawH, undefined, 'FAST');
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        'Driver CNIC scan file not uploaded — verified via CNIC & mobile particulars above.',
        pageWidth / 2,
        slotY + boxH / 2 + 2,
        { align: 'center' }
      );
    }

    return slotY + boxH + 6;
  };

  if (data.cnicFrontUrl && data.cnicBackUrl) {
    currentY = await drawCnicSlot('1. DRIVER NATIONAL IDENTITY CARD (CNIC) — FRONT SIDE', data.cnicFrontUrl, currentY, 82);
    currentY = await drawCnicSlot('2. DRIVER NATIONAL IDENTITY CARD (CNIC) — BACK SIDE', data.cnicBackUrl, currentY, 82);
  } else {
    currentY = await drawCnicSlot(
      'DRIVER NATIONAL IDENTITY CARD (CNIC — FRONT & BACK)',
      data.cnicFrontUrl || data.cnicBackUrl,
      currentY,
      168
    );
  }

  drawPdfCorporateFooter(doc, 'Page 1 of 1', data.branding);

  return await triggerDirectDownload(doc, filename);
}

export interface SalaryStaffDirectoryExportData {
  companyName: string;
  customLogo?: string | null;
  generatedDate: string;
  staffList: SalaryStaffMember[];
  branding?: BrandingInfo;
}

export async function downloadSalaryStaffListPdf(
  data: SalaryStaffDirectoryExportData
): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;
    let currentY = 14;

    const drawHeader = async (pageNum: number) => {
      currentY = await drawPdfCorporateHeader(doc, {
        title: 'OFFICE SALARY STAFF DIRECTORY',
        refNo: cleanPdfText(data.companyName || 'Docks (Pvt.) Ltd.'),
        date: data.generatedDate,
        subRef: `Page ${pageNum}`,
        branding: {
          companyName: data.companyName,
          customLogo: data.customLogo,
          ...data.branding
        },
        accentColor: [88, 28, 135]
      });
      currentY += 3;
    };

    await drawHeader(1);

    const activeStaff = data.staffList.filter((s) => s.status !== 'SUSPENDED' && s.status !== 'INACTIVE');
    const suspendedStaff = data.staffList.filter((s) => s.status === 'SUSPENDED');
    const totalActivePayroll = activeStaff.reduce((sum, s) => sum + (Number(s.totalSalary) || 0), 0);

    // Summary Strip
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - margin * 2, 15, 2, 2, 'FD');

    const colW = (pageWidth - margin * 2) / 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL REGISTERED STAFF', margin + 5, currentY + 5.2);
    doc.text('ACTIVE PAYROLL STAFF', margin + colW + 5, currentY + 5.2);
    doc.text('SUSPENDED STAFF', margin + colW * 2 + 5, currentY + 5.2);
    doc.text('ACTIVE MONTHLY PAYROLL', margin + colW * 3 + 5, currentY + 5.2);

    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`${data.staffList.length} Staff`, margin + 5, currentY + 11.5);
    doc.setTextColor(22, 163, 74);
    doc.text(`${activeStaff.length} Active`, margin + colW + 5, currentY + 11.5);
    doc.setTextColor(180, 83, 9);
    doc.text(`${suspendedStaff.length} Suspended`, margin + colW * 2 + 5, currentY + 11.5);
    doc.setTextColor(88, 28, 135);
    doc.text(`PKR ${totalActivePayroll.toLocaleString()}`, margin + colW * 3 + 5, currentY + 11.5);

    currentY += 19;

    const drawTableHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, currentY, pageWidth - margin * 2, 7.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);
      doc.text('S.NO', margin + 2.5, currentY + 5);
      doc.text('FULL NAME', margin + 14, currentY + 5);
      doc.text('FATHER NAME', margin + 68, currentY + 5);
      doc.text('DESIGNATION', margin + 114, currentY + 5);
      doc.text('PRIMARY CONTACT', margin + 158, currentY + 5);
      doc.text('RESIDENTIAL CONTACT', margin + 194, currentY + 5);
      doc.text('MONTHLY SALARY', pageWidth - margin - 26, currentY + 5, { align: 'right' });
      doc.text('STATUS', pageWidth - margin - 3, currentY + 5, { align: 'right' });
      currentY += 7.5;
    };

    drawTableHeader();

    let pageNum = 1;
    for (let idx = 0; idx < data.staffList.length; idx++) {
      const s = data.staffList[idx];
      if (currentY > pageHeight - 26) {
        drawPdfCorporateFooter(doc, `Page ${pageNum}`, data.branding);
        doc.addPage();
        pageNum++;
        await drawHeader(pageNum);
        drawTableHeader();
      }

      const isSuspended = s.status === 'SUSPENDED';
      if (isSuspended) {
        doc.setFillColor(254, 243, 199);
        doc.rect(margin, currentY, pageWidth - margin * 2, 6.8, 'F');
      } else if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, currentY, pageWidth - margin * 2, 6.8, 'F');
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text(String(idx + 1), margin + 2.5, currentY + 4.7);

      doc.setTextColor(15, 23, 42);
      doc.text(cleanPdfText(s.name || '-').substring(0, 28), margin + 14, currentY + 4.7);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      doc.text(cleanPdfText(s.fatherName || '-').substring(0, 24), margin + 68, currentY + 4.7);
      doc.text(cleanPdfText(s.designation || '-').substring(0, 24), margin + 114, currentY + 4.7);
      doc.text(cleanPdfText(s.primaryContact || '-').substring(0, 18), margin + 158, currentY + 4.7);
      doc.text(cleanPdfText(s.residentialContact || '-').substring(0, 18), margin + 194, currentY + 4.7);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(isSuspended ? 148 : 22, isSuspended ? 163 : 163, isSuspended ? 184 : 74);
      doc.text(
        `PKR ${Number(s.totalSalary || 0).toLocaleString()}`,
        pageWidth - margin - 26,
        currentY + 4.7,
        { align: 'right' }
      );

      doc.setTextColor(isSuspended ? 180 : 22, isSuspended ? 83 : 163, isSuspended ? 9 : 74);
      doc.text(
        isSuspended ? 'SUSPENDED' : s.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        pageWidth - margin - 3,
        currentY + 4.7,
        { align: 'right' }
      );

      currentY += 6.8;
    }

    // Total Row
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, currentY, pageWidth - margin * 2, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Total Active Monthly Payroll Commitment (${activeStaff.length} Active · ${suspendedStaff.length} Suspended)`,
      margin + 3,
      currentY + 5.4
    );
    doc.setTextColor(22, 163, 74);
    doc.text(`PKR ${totalActivePayroll.toLocaleString()}/mo`, pageWidth - margin - 26, currentY + 5.4, {
      align: 'right'
    });

    drawPdfCorporateFooter(doc, `Page ${pageNum} of ${pageNum}`, data.branding);

    const safeCo = (data.companyName || 'Company').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const filename = `${safeCo}_Salary_Staff_List_${formatPdfDate(data.generatedDate)}.pdf`;
    return await triggerDirectDownload(doc, filename);
  } catch (err) {
    console.warn('downloadSalaryStaffListPdf error:', err);
    return { success: false, filename: 'Salary_Staff_List.pdf', blobUrl: '' };
  }
}

export interface StaffCompanyDetails {
  id?: CompanyId | string;
  name: string;
  legalTitle?: string;
  category?: string;
  address?: string;
  phone?: string;
  cell?: string;
  email?: string;
  web?: string;
  prefix?: string;
  directorName?: string;
  directorTitle?: string;
}

function resolveStaffCompanyDetails(companyId?: CompanyId | string, override?: StaffCompanyDetails): StaffCompanyDetails {
  const active = getActiveCompany();
  const matched =
    companyId && (companyId === 'docks' || companyId === 'truckit' || companyId === 'muhib' || companyId === 'vantage')
      ? GROUP_COMPANIES[companyId]
      : active;
  return {
    id: override?.id || matched.id,
    name: override?.name || matched.name,
    legalTitle: override?.legalTitle || matched.legalTitle || matched.name,
    category: override?.category || matched.category,
    address: override?.address || matched.address,
    phone: override?.phone || matched.phone,
    cell: override?.cell || matched.cell,
    email: override?.email || matched.email,
    web: override?.web || matched.web,
    prefix: override?.prefix || matched.prefix,
    directorName: override?.directorName || matched.directorName,
    directorTitle: override?.directorTitle || matched.directorTitle
  };
}

function drawEmployingCompanyBanner(doc: jsPDF, y: number, company: StaffCompanyDetails): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const width = pageWidth - margin * 2;
  const legalName = cleanPdfText(company.legalTitle || company.name).toUpperCase();
  const catText = cleanPdfText(company.category || '');
  const contactLine = [
    company.address ? cleanPdfText(company.address) : '',
    company.phone ? `Tel: ${cleanPdfText(company.phone)}` : '',
    company.email ? cleanPdfText(company.email) : ''
  ]
    .filter(Boolean)
    .join('  |  ');

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.roundedRect(margin, y, width, 13.5, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.4);
  doc.setTextColor(180, 83, 9);
  doc.text('EMPLOYING OPERATING COMPANY:', margin + 3.5, y + 4.3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  doc.setTextColor(15, 23, 42);
  doc.text(legalName, margin + 44, y + 4.3, { maxWidth: width - 48 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(71, 85, 105);
  const subInfo = catText ? `${catText}  |  ${contactLine}` : contactLine;
  const wrapped = doc.splitTextToSize(subInfo, width - 7);
  doc.text(wrapped.slice(0, 2), margin + 3.5, y + 8.3);

  return y + 16.5;
}

export interface StaffProfilePdfExportData {
  staff: SalaryStaffMember;
  companyId?: CompanyId | string;
  companyInfo?: StaffCompanyDetails;
  customLogo?: string | null;
  branding?: BrandingInfo;
  salaryHistory: StaffSalaryHistoryRow[];
  includeSalaryHistory: boolean;
  generatedDate?: string;
}

export async function downloadStaffProfilePdf(
  data: StaffProfilePdfExportData
): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentW = pageWidth - margin * 2;
    const company = resolveStaffCompanyDetails(data.companyId || data.staff.companyId, data.companyInfo);
    const resolvedCompId = resolveOperatingCompanyFromRef(company.id as CompanyId, company.prefix);
    const genDate = data.generatedDate || new Date().toISOString().slice(0, 10);
    const shortId = (data.staff.id || 'STAFF').slice(-6).toUpperCase();
    const refNo = `${company.prefix || 'MAK'}/HR/${shortId}`;

    const drawPageHeader = async (pageNum: number) => {
      let y = await drawPdfCorporateHeader(doc, {
        title: 'EMPLOYEE PROFILE & PAYROLL DOSSIER',
        refNo,
        date: genDate,
        subRef: `${cleanPdfText(company.legalTitle || company.name)} | Page ${pageNum}`,
        branding: {
          companyName: company.legalTitle || company.name,
          customLogo: data.customLogo,
          ...data.branding
        },
        accentColor: [88, 28, 135],
        subject: `OFFICIAL EMPLOYEE RECORD - ${cleanPdfText(data.staff.name || 'STAFF').toUpperCase()}`
      });
      y = drawEmployingCompanyBanner(doc, y, company);
      return y;
    };

    let currentY = await drawPageHeader(1);

    // 1. TOP LARGE ROW: PROFILE PHOTO + ID CARD FRONT + ID CARD BACK
    const rowHeight = 50;
    const gap = 3.5;
    const photoCardW = 46;
    const idCardW = (contentW - photoCardW - gap * 2) / 2;

    const [normPhoto, normFront, normBack] = await Promise.all([
      normalizeImageForJsPdf(data.staff.photoUrl),
      normalizeImageForJsPdf(data.staff.cnicFrontUrl),
      normalizeImageForJsPdf(data.staff.cnicBackUrl)
    ]);

    const drawMediaCard = (
      x: number,
      y: number,
      w: number,
      h: number,
      title: string,
      normImg: { dataUrl: string; width: number; height: number } | null,
      rawUrl?: string
    ) => {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.35);
      doc.roundedRect(x, y, w, h, 2, 2, 'FD');

      doc.setFillColor(15, 23, 42);
      doc.rect(x, y, w, 6.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(255, 255, 255);
      doc.text(title.toUpperCase(), x + w / 2, y + 4.3, { align: 'center' });

      const innerPad = 2.5;
      const boxX = x + innerPad;
      const boxY = y + 7.8;
      const boxW = w - innerPad * 2;
      const boxH = h - 10.2;

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.rect(boxX, boxY, boxW, boxH, 'FD');

      if (normImg?.dataUrl) {
        try {
          const ar = normImg.width / Math.max(1, normImg.height);
          let drawW = boxW - 1.5;
          let drawH = drawW / ar;
          if (drawH > boxH - 1.5) {
            drawH = boxH - 1.5;
            drawW = drawH * ar;
          }
          const imgX = boxX + (boxW - drawW) / 2;
          const imgY = boxY + (boxH - drawH) / 2;
          doc.addImage(normImg.dataUrl, 'JPEG', imgX, imgY, drawW, drawH);
          return;
        } catch (_) {}
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      const fallbackMsg = rawUrl?.startsWith('data:application/pdf')
        ? 'PDF Document Attached'
        : rawUrl
        ? 'Media Attached'
        : 'Not Uploaded';
      doc.text(fallbackMsg, x + w / 2, boxY + boxH / 2 + 1, { align: 'center' });
    };

    drawMediaCard(margin, currentY, photoCardW, rowHeight, 'Employee Photo', normPhoto, data.staff.photoUrl);
    drawMediaCard(
      margin + photoCardW + gap,
      currentY,
      idCardW,
      rowHeight,
      'ID Card Front',
      normFront,
      data.staff.cnicFrontUrl
    );
    drawMediaCard(
      margin + photoCardW + gap + idCardW + gap,
      currentY,
      idCardW,
      rowHeight,
      'ID Card Back',
      normBack,
      data.staff.cnicBackUrl
    );

    currentY += rowHeight + 5;

    // 2. CENTER SECTION: COMPLETE EMPLOYEE PROFILE DETAILS
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, contentW, 6.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('EMPLOYEE PROFILE PARTICULARS', margin + 3.5, currentY + 4.7);
    currentY += 8.5;

    const statusText =
      data.staff.status === 'SUSPENDED'
        ? 'SUSPENDED'
        : data.staff.status === 'INACTIVE'
        ? 'INACTIVE'
        : 'ACTIVE';
    const joiningFormatted = data.staff.joiningDate ? formatPdfDate(data.staff.joiningDate) : 'Not Specified';

    const detailRows: Array<[string, string, string, string]> = [
      ['1. Full Name', cleanPdfText(data.staff.name || '-'), '2. Father Name', cleanPdfText(data.staff.fatherName || '-')],
      ['3. Designation', cleanPdfText(data.staff.designation || '-'), '4. Job Start Date', joiningFormatted],
      ['5. Primary Contact', cleanPdfText(data.staff.primaryContact || '-'), '6. Residential Contact', cleanPdfText(data.staff.residentialContact || '-')],
      [
        '7. Monthly Salary',
        `PKR ${Number(data.staff.totalSalary || 0).toLocaleString()} / Month`,
        '8. Employment Status',
        statusText
      ]
    ];

    const halfW = (contentW - 3) / 2;
    for (const [l1, v1, l2, v2] of detailRows) {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, currentY, halfW, 11.5, 1.2, 1.2, 'FD');
      doc.roundedRect(margin + halfW + 3, currentY, halfW, 11.5, 1.2, 1.2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.2);
      doc.setTextColor(100, 116, 139);
      doc.text(l1.toUpperCase(), margin + 3, currentY + 4);
      doc.text(l2.toUpperCase(), margin + halfW + 6, currentY + 4);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(l1.includes('Salary') ? 4 : 15, l1.includes('Salary') ? 120 : 23, l1.includes('Salary') ? 87 : 42);
      doc.text(v1 || '-', margin + 3, currentY + 9, { maxWidth: halfW - 6 });

      if (l2.includes('Status')) {
        doc.setTextColor(
          statusText === 'SUSPENDED' ? 180 : 22,
          statusText === 'SUSPENDED' ? 83 : 163,
          statusText === 'SUSPENDED' ? 9 : 74
        );
      } else {
        doc.setTextColor(15, 23, 42);
      }
      doc.text(v2 || '-', margin + halfW + 6, currentY + 9, { maxWidth: halfW - 6 });

      currentY += 13;
    }

    // Residential Address (Full Width)
    const addrText = cleanPdfText(data.staff.residentialAddress || '-');
    const addrWrapped = doc.splitTextToSize(addrText, contentW - 6);
    const addrBoxH = addrWrapped.length > 1 ? 15.5 : 11.5;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, contentW, addrBoxH, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(100, 116, 139);
    doc.text('9. RESIDENTIAL ADDRESS', margin + 3, currentY + 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(addrWrapped.slice(0, 2), margin + 3, currentY + 8.8);
    currentY += addrBoxH + 5;

    let pageNum = 1;

    // 3. OPTIONAL BOTTOM SECTION: SALARY PAYMENT HISTORY TABLE
    if (data.includeSalaryHistory) {
      const historyRows = data.salaryHistory || [];
      const paidRows = historyRows.filter((r) => r.status === 'PAID');
      const totalDisbursed = paidRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

      if (currentY > pageHeight - 52) {
        drawPdfCorporateFooter(doc, `Page ${pageNum}`, data.branding);
        doc.addPage();
        pageNum++;
        currentY = await drawPageHeader(pageNum);
      }

      doc.setFillColor(88, 28, 135);
      doc.rect(margin, currentY, contentW, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(
        `SALARY PAYMENT HISTORY (${historyRows.length} RECORD${historyRows.length === 1 ? '' : 'S'})`,
        margin + 3.5,
        currentY + 4.8
      );
      doc.text(
        `Total Paid: PKR ${totalDisbursed.toLocaleString()}`,
        pageWidth - margin - 3.5,
        currentY + 4.8,
        { align: 'right' }
      );
      currentY += 8.2;

      const drawHistoryTableHeader = () => {
        doc.setFillColor(15, 23, 42);
        doc.rect(margin, currentY, contentW, 6.8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.1);
        doc.setTextColor(255, 255, 255);
        doc.text('S.NO', margin + 2.5, currentY + 4.6);
        doc.text('MONTH', margin + 15, currentY + 4.6);
        doc.text('PAYMENT DATE', margin + 48, currentY + 4.6);
        doc.text('AMOUNT (PKR)', margin + 105, currentY + 4.6, { align: 'right' });
        doc.text('PAYMENT MODE', margin + 112, currentY + 4.6);
        doc.text('STATUS', pageWidth - margin - 3, currentY + 4.6, { align: 'right' });
        currentY += 6.8;
      };

      if (historyRows.length === 0) {
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(margin, currentY, contentW, 11, 1.2, 1.2, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.8);
        doc.setTextColor(100, 116, 139);
        doc.text(
          'No salary payment history recorded yet. Enter Job Start Date to generate completed historical payments.',
          pageWidth / 2,
          currentY + 6.8,
          { align: 'center' }
        );
        currentY += 14;
      } else {
        drawHistoryTableHeader();

        for (let i = 0; i < historyRows.length; i++) {
          const r = historyRows[i];
          if (currentY > pageHeight - 28) {
            drawPdfCorporateFooter(doc, `Page ${pageNum}`, data.branding);
            doc.addPage();
            pageNum++;
            currentY = await drawPageHeader(pageNum);
            drawHistoryTableHeader();
          }

          if (i % 2 === 1) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, currentY, contentW, 6.4, 'F');
          }

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.2);
          doc.setTextColor(71, 85, 105);
          doc.text(String(r.serial), margin + 2.5, currentY + 4.4);

          doc.setTextColor(15, 23, 42);
          doc.text(cleanPdfText(r.monthLabel), margin + 15, currentY + 4.4);

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
          doc.text(cleanPdfText(r.paymentDate), margin + 48, currentY + 4.4);

          doc.setFont('helvetica', 'bold');
          doc.setTextColor(15, 23, 42);
          doc.text(`PKR ${Number(r.amount || 0).toLocaleString()}`, margin + 105, currentY + 4.4, {
            align: 'right'
          });

          const isOnline = r.paymentMode.toLowerCase().includes('online') || r.paymentMode.toLowerCase().includes('bank');
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(isOnline ? 37 : 22, isOnline ? 99 : 163, isOnline ? 235 : 74);
          doc.text(cleanPdfText(r.paymentMode).substring(0, 32), margin + 112, currentY + 4.4);

          doc.setTextColor(r.status === 'PAID' ? 22 : 180, r.status === 'PAID' ? 163 : 83, r.status === 'PAID' ? 74 : 9);
          doc.text(r.status, pageWidth - margin - 3, currentY + 4.4, { align: 'right' });

          currentY += 6.4;
        }

        // Summary Row
        doc.setFillColor(241, 245, 249);
        doc.rect(margin, currentY, contentW, 7.6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(15, 23, 42);
        doc.text(
          `Total Disbursed (${paidRows.length} Paid Month${paidRows.length === 1 ? '' : 's'})`,
          margin + 3,
          currentY + 5.1
        );
        doc.setTextColor(22, 163, 74);
        doc.text(`PKR ${totalDisbursed.toLocaleString()}`, margin + 105, currentY + 5.1, { align: 'right' });
        currentY += 11;
      }
    }

    // 4. BOTTOM SUBSIDIARY OPERATING COMPANY ATTRIBUTION + STAMP
    if (currentY > pageHeight - 44) {
      drawPdfCorporateFooter(doc, `Page ${pageNum}`, data.branding);
      doc.addPage();
      pageNum++;
      currentY = await drawPageHeader(pageNum);
    }

    await drawIssuingCompanySignatureAndStamp(
      doc,
      currentY,
      'OFFICIAL HR RECORD SEAL',
      resolvedCompId,
      company.prefix,
      data.customLogo || data.branding?.customLogo
    );
    drawPdfCorporateFooter(doc, `Page ${pageNum} of ${pageNum}`, data.branding);

    const safeCo = (company.name || 'Company').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const safeStaff = (data.staff.name || 'Staff').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const suffix = data.includeSalaryHistory ? 'Profile_With_Salary_History' : 'Profile_Only';
    const filename = `${safeCo}_${safeStaff}_${suffix}_${formatPdfDate(genDate)}.pdf`;
    return await triggerDirectDownload(doc, filename);
  } catch (err) {
    console.warn('downloadStaffProfilePdf error:', err);
    return { success: false, filename: 'Staff_Profile.pdf', blobUrl: '' };
  }
}

export interface StaffSalaryHistoryPdfData {
  staff: SalaryStaffMember;
  companyId?: CompanyId | string;
  companyInfo?: StaffCompanyDetails;
  customLogo?: string | null;
  branding?: BrandingInfo;
  salaryHistory: StaffSalaryHistoryRow[];
  generatedDate?: string;
}

export async function downloadStaffSalaryHistoryPdf(
  data: StaffSalaryHistoryPdfData
): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentW = pageWidth - margin * 2;
    const company = resolveStaffCompanyDetails(data.companyId || data.staff.companyId, data.companyInfo);
    const resolvedCompId = resolveOperatingCompanyFromRef(company.id as CompanyId, company.prefix);
    const genDate = data.generatedDate || new Date().toISOString().slice(0, 10);
    const shortId = (data.staff.id || 'STAFF').slice(-6).toUpperCase();

    const drawPageHeader = async (pageNum: number) => {
      let y = await drawPdfCorporateHeader(doc, {
        title: 'EMPLOYEE SALARY PAYMENT HISTORY',
        refNo: `${company.prefix || 'MAK'}/PAY/${shortId}`,
        date: genDate,
        subRef: `${cleanPdfText(company.legalTitle || company.name)} | Page ${pageNum}`,
        branding: {
          companyName: company.legalTitle || company.name,
          customLogo: data.customLogo,
          ...data.branding
        },
        accentColor: [4, 120, 87],
        subject: `PAYROLL DISBURSEMENT STATEMENT - ${cleanPdfText(data.staff.name || 'STAFF').toUpperCase()}`
      });
      y = drawEmployingCompanyBanner(doc, y, company);
      return y;
    };

    let currentY = await drawPageHeader(1);
    const historyRows = data.salaryHistory || [];
    const paidRows = historyRows.filter((r) => r.status === 'PAID');
    const totalDisbursed = paidRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    // Employee Summary Card
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, currentY, contentW, 20, 1.5, 1.5, 'FD');

    const cW = contentW / 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(100, 116, 139);
    doc.text('EMPLOYEE NAME', margin + 3.5, currentY + 4.5);
    doc.text('DESIGNATION / FATHER NAME', margin + cW + 3.5, currentY + 4.5);
    doc.text('MONTHLY RATE & JOINING DATE', margin + cW * 2 + 3.5, currentY + 4.5);

    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(cleanPdfText(data.staff.name || '-'), margin + 3.5, currentY + 9.5, { maxWidth: cW - 6 });
    doc.text(
      `${cleanPdfText(data.staff.designation || '-')}`,
      margin + cW + 3.5,
      currentY + 9.5,
      { maxWidth: cW - 6 }
    );
    doc.setTextColor(4, 120, 87);
    doc.text(
      `PKR ${Number(data.staff.totalSalary || 0).toLocaleString()}/mo`,
      margin + cW * 2 + 3.5,
      currentY + 9.5
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(`Contact: ${cleanPdfText(data.staff.primaryContact || '-')}`, margin + 3.5, currentY + 15.5);
    doc.text(`S/O: ${cleanPdfText(data.staff.fatherName || '-')}`, margin + cW + 3.5, currentY + 15.5);
    doc.text(
      `Joined: ${data.staff.joiningDate ? formatPdfDate(data.staff.joiningDate) : 'Not Set'}`,
      margin + cW * 2 + 3.5,
      currentY + 15.5
    );

    currentY += 24;

    const drawTableHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, currentY, contentW, 7.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(255, 255, 255);
      doc.text('S.NO', margin + 2.5, currentY + 4.9);
      doc.text('SALARY MONTH', margin + 15, currentY + 4.9);
      doc.text('PAYMENT DATE', margin + 50, currentY + 4.9);
      doc.text('AMOUNT (PKR)', margin + 106, currentY + 4.9, { align: 'right' });
      doc.text('PAYMENT MODE', margin + 114, currentY + 4.9);
      doc.text('STATUS', pageWidth - margin - 3, currentY + 4.9, { align: 'right' });
      currentY += 7.2;
    };

    let pageNum = 1;
    if (historyRows.length === 0) {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, currentY, contentW, 13, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'No completed salary payment records found yet. Set Job Start Date in Edit Staff Profile to populate past Cash Paid history.',
        pageWidth / 2,
        currentY + 8,
        { align: 'center' }
      );
      currentY += 17;
    } else {
      drawTableHeader();
      for (let i = 0; i < historyRows.length; i++) {
        const r = historyRows[i];
        if (currentY > pageHeight - 28) {
          drawPdfCorporateFooter(doc, `Page ${pageNum}`, data.branding);
          doc.addPage();
          pageNum++;
          currentY = await drawPageHeader(pageNum);
          drawTableHeader();
        }
        if (i % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, currentY, contentW, 6.6, 'F');
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.4);
        doc.setTextColor(71, 85, 105);
        doc.text(String(r.serial), margin + 2.5, currentY + 4.6);

        doc.setTextColor(15, 23, 42);
        doc.text(cleanPdfText(r.monthLabel), margin + 15, currentY + 4.6);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
        doc.text(cleanPdfText(r.paymentDate), margin + 50, currentY + 4.6);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(`PKR ${Number(r.amount || 0).toLocaleString()}`, margin + 106, currentY + 4.6, { align: 'right' });

        const isOnline = r.paymentMode.toLowerCase().includes('online') || r.paymentMode.toLowerCase().includes('bank');
        doc.setTextColor(isOnline ? 37 : 22, isOnline ? 99 : 163, isOnline ? 235 : 74);
        doc.text(cleanPdfText(r.paymentMode).substring(0, 32), margin + 114, currentY + 4.6);

        doc.setTextColor(r.status === 'PAID' ? 22 : 180, r.status === 'PAID' ? 163 : 83, r.status === 'PAID' ? 74 : 9);
        doc.text(r.status, pageWidth - margin - 3, currentY + 4.6, { align: 'right' });
        currentY += 6.6;
      }

      doc.setFillColor(241, 245, 249);
      doc.rect(margin, currentY, contentW, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `Total Paid Salary (${paidRows.length} Completed Month${paidRows.length === 1 ? '' : 's'})`,
        margin + 3,
        currentY + 5.4
      );
      doc.setTextColor(22, 163, 74);
      doc.text(`PKR ${totalDisbursed.toLocaleString()}`, margin + 106, currentY + 5.4, { align: 'right' });
      currentY += 12;
    }

    if (currentY > pageHeight - 44) {
      drawPdfCorporateFooter(doc, `Page ${pageNum}`, data.branding);
      doc.addPage();
      pageNum++;
      currentY = await drawPageHeader(pageNum);
    }

    await drawIssuingCompanySignatureAndStamp(
      doc,
      currentY,
      'PAYROLL VERIFIED SEAL',
      resolvedCompId,
      company.prefix,
      data.customLogo || data.branding?.customLogo
    );
    drawPdfCorporateFooter(doc, `Page ${pageNum} of ${pageNum}`, data.branding);

    const safeCo = (company.name || 'Company').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const safeStaff = (data.staff.name || 'Staff').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const filename = `${safeCo}_${safeStaff}_Salary_History_${formatPdfDate(genDate)}.pdf`;
    return await triggerDirectDownload(doc, filename);
  } catch (err) {
    console.warn('downloadStaffSalaryHistoryPdf error:', err);
    return { success: false, filename: 'Salary_History.pdf', blobUrl: '' };
  }
}

export interface StaffDailyTimeTablePdfData {
  staff: SalaryStaffMember;
  attendanceRecords: StaffAttendanceRecord[];
  companyId?: CompanyId | string;
  companyInfo?: StaffCompanyDetails;
  customLogo?: string | null;
  branding?: BrandingInfo;
  generatedDate?: string;
  fromMonth?: string; // YYYY-MM (defaults to current month)
  toMonth?: string;   // YYYY-MM (defaults to fromMonth)
}

function formatPdfClock12h(raw?: string): string {
  if (!raw) return '-';
  const s = cleanPdfText(raw).replace(/\u202f/g, ' ').trim();
  if (!s || s === '-') return '-';
  // Convert "09:15:20 AM" or "9:15:20 PM" -> "09:15 AM" / "09:15 PM"
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (m) {
    return `${m[1].padStart(2, '0')}:${m[2]} ${m[3].toUpperCase()}`;
  }
  return s;
}

function enumerateTimeTableMonths(fromYmInput?: string, toYmInput?: string): { year: number; monthIndex: number; ym: string }[] {
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const validYm = (v?: string) => (v && /^\d{4}-\d{2}$/.test(v.trim()) ? v.trim() : '');
  let startYm = validYm(fromYmInput) || currentYm;
  let endYm = validYm(toYmInput) || startYm;
  if (endYm < startYm) {
    const tmp = startYm;
    startYm = endYm;
    endYm = tmp;
  }

  const [sy, sm] = startYm.split('-').map((n) => parseInt(n, 10));
  const [ey, em] = endYm.split('-').map((n) => parseInt(n, 10));
  const result: { year: number; monthIndex: number; ym: string }[] = [];

  let cy = sy;
  let cm = sm;
  let guard = 0;
  while ((cy < ey || (cy === ey && cm <= em)) && guard < 36) {
    result.push({
      year: cy,
      monthIndex: cm - 1,
      ym: `${cy}-${String(cm).padStart(2, '0')}`
    });
    cm++;
    if (cm > 12) {
      cm = 1;
      cy++;
    }
    guard++;
  }
  return result;
}

export async function downloadStaffDailyTimeTablePdf(
  data: StaffDailyTimeTablePdfData
): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentW = pageWidth - margin * 2;
    const company = resolveStaffCompanyDetails(data.companyId || data.staff.companyId, data.companyInfo);
    const genDate = data.generatedDate || new Date().toISOString().slice(0, 10);
    const shortId = (data.staff.id || 'STAFF').slice(-6).toUpperCase();

    const monthsList = enumerateTimeTableMonths(data.fromMonth, data.toMonth);
    const totalPages = monthsList.length;

    // Index attendance records by YYYY-MM-DD for O(1) lookup per day row
    const recordByDate = new Map<string, StaffAttendanceRecord>();
    (data.attendanceRecords || []).forEach((rec) => {
      if (rec && rec.date) {
        recordByDate.set(rec.date, rec);
      }
    });

    // Strict 5 equal-balanced columns across contentW (182mm):
    // 1. DAYS (34mm) | 2. ENTRY TIME (37mm) | 3. LUNCH START (37mm) | 4. LUNCH END (37mm) | 5. EXIT (37mm)
    const colWidths = [34, 37, 37, 37, 37];
    const colStarts: number[] = [];
    let accX = margin;
    for (let c = 0; c < colWidths.length; c++) {
      colStarts.push(accX);
      accX += colWidths[c];
    }

    for (let mIdx = 0; mIdx < monthsList.length; mIdx++) {
      if (mIdx > 0) {
        doc.addPage();
      }
      const { year, monthIndex, ym } = monthsList[mIdx];
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      const monthTitle = new Date(year, monthIndex, 1)
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        .toUpperCase();

      // 1. Corporate Header + Employing Subsidiary Company Strip
      let currentY = await drawPdfCorporateHeader(doc, {
        title: 'EMPLOYEE MONTHLY TIME TABLE',
        refNo: `${company.prefix || 'MAK'}/TT/${shortId}`,
        date: genDate,
        subRef: `${cleanPdfText(company.legalTitle || company.name)} | ${monthTitle}`,
        branding: {
          companyName: company.legalTitle || company.name,
          customLogo: data.customLogo,
          ...data.branding
        },
        accentColor: [14, 116, 144]
      });

      currentY = drawEmployingCompanyBanner(doc, currentY, company);

      // 2. Centered Header Above Table: Month & Employee Name
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.35);
      doc.roundedRect(margin, currentY, contentW, 12.5, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(monthTitle, pageWidth / 2, currentY + 5.2, { align: 'center' });

      const empLine = `${cleanPdfText(data.staff.name || 'STAFF').toUpperCase()}${
        data.staff.designation ? `  —  ${cleanPdfText(data.staff.designation).toUpperCase()}` : ''
      }`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(14, 116, 144);
      doc.text(empLine, pageWidth / 2, currentY + 10.2, { align: 'center', maxWidth: contentW - 10 });

      currentY += 15;

      // 3. Five-Column Table Header
      const headerH = 6.6;
      doc.setFillColor(15, 23, 42);
      doc.setDrawColor(15, 23, 42);
      doc.rect(margin, currentY, contentW, headerH, 'FD');

      const colLabels = ['DAYS', 'ENTRY TIME', 'LUNCH START', 'LUNCH END', 'EXIT'];
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.4);
      doc.setTextColor(255, 255, 255);
      for (let c = 0; c < 5; c++) {
        const cx = colStarts[c] + colWidths[c] / 2;
        doc.text(colLabels[c], cx, currentY + 4.5, { align: 'center' });
      }
      currentY += headerH;

      // 4. All Days of the Month Rows (28 / 29 / 30 / 31 rows) - guaranteed 1 page per month
      const footerReserveY = pageHeight - 31; // Leaves room for attribution + footer
      const availableTableH = Math.max(120, footerReserveY - currentY);
      const rowH = Math.min(5.9, Math.floor((availableTableH / daysInMonth) * 100) / 100);
      const tableTopY = currentY;

      for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = String(day).padStart(2, '0');
        const dateKey = `${ym}-${dayStr}`;
        const dateObj = new Date(year, monthIndex, day);
        const weekdayShort = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
        const isSunday = dateObj.getDay() === 0;
        const rec = recordByDate.get(dateKey);

        if (isSunday) {
          doc.setFillColor(241, 245, 249);
          doc.rect(margin, currentY, contentW, rowH, 'F');
        } else if (day % 2 === 0) {
          doc.setFillColor(249, 250, 251);
          doc.rect(margin, currentY, contentW, rowH, 'F');
        }

        // Row bottom border
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.22);
        doc.line(margin, currentY + rowH, margin + contentW, currentY + rowH);

        const textY = currentY + rowH * 0.68;

        // Col 1: Days
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.1);
        doc.setTextColor(isSunday ? 180 : 15, isSunday ? 83 : 23, isSunday ? 9 : 42);
        doc.text(`${dayStr} (${weekdayShort})`, colStarts[0] + colWidths[0] / 2, textY, { align: 'center' });

        // Col 2: Entry Time
        const entryText = formatPdfClock12h(rec?.entryTime);
        doc.setFont('helvetica', entryText !== '-' ? 'bold' : 'normal');
        doc.setFontSize(7.1);
        doc.setTextColor(entryText !== '-' ? 22 : 148, entryText !== '-' ? 163 : 163, entryText !== '-' ? 74 : 184);
        doc.text(entryText, colStarts[1] + colWidths[1] / 2, textY, { align: 'center' });

        // Col 3: Lunch Start
        const lunchStartText = formatPdfClock12h(rec?.lunchStartTime);
        doc.setFont('helvetica', lunchStartText !== '-' ? 'bold' : 'normal');
        doc.setTextColor(lunchStartText !== '-' ? 180 : 148, lunchStartText !== '-' ? 83 : 163, lunchStartText !== '-' ? 9 : 184);
        doc.text(lunchStartText, colStarts[2] + colWidths[2] / 2, textY, { align: 'center' });

        // Col 4: Lunch End
        const lunchEndText = formatPdfClock12h(rec?.lunchEndTime);
        doc.setFont('helvetica', lunchEndText !== '-' ? 'bold' : 'normal');
        doc.setTextColor(lunchEndText !== '-' ? 14 : 148, lunchEndText !== '-' ? 116 : 163, lunchEndText !== '-' ? 144 : 184);
        doc.text(lunchEndText, colStarts[3] + colWidths[3] / 2, textY, { align: 'center' });

        // Col 5: Exit
        const exitText = formatPdfClock12h(rec?.exitTime);
        doc.setFont('helvetica', exitText !== '-' ? 'bold' : 'normal');
        doc.setTextColor(exitText !== '-' ? 37 : 148, exitText !== '-' ? 99 : 163, exitText !== '-' ? 235 : 184);
        doc.text(exitText, colStarts[4] + colWidths[4] / 2, textY, { align: 'center' });

        currentY += rowH;
      }

      // Draw crisp outer & column vertical gridlines around the 5-column table
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.32);
      doc.rect(margin, tableTopY - headerH, contentW, headerH + rowH * daysInMonth);
      for (let c = 1; c < 5; c++) {
        doc.line(colStarts[c], tableTopY - headerH, colStarts[c], tableTopY + rowH * daysInMonth);
      }

      // Compact Official Verification Strip below table (fits on exact same page)
      const stripY = Math.min(currentY + 3, pageHeight - 28);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.6);
      doc.setTextColor(51, 65, 85);
      doc.text(
        `Issued by Operating Company: ${cleanPdfText(company.legalTitle || company.name)}`,
        margin,
        stripY + 4
      );
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Total Days: ${daysInMonth}   |   Format: 12-Hour (AM/PM)   |   Verified Attendance Sheet`,
        pageWidth - margin,
        stripY + 4,
        { align: 'right' }
      );

      drawPdfCorporateFooter(doc, `Page ${mIdx + 1} of ${totalPages}`, data.branding);
    }

    const safeCo = (company.name || 'Company').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const safeStaff = (data.staff.name || 'Staff').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const rangeTag =
      monthsList.length === 1
        ? monthsList[0].ym
        : `${monthsList[0].ym}_to_${monthsList[monthsList.length - 1].ym}`;
    const filename = `${safeCo}_${safeStaff}_Time_Table_${rangeTag}.pdf`;
    return await triggerDirectDownload(doc, filename);
  } catch (err) {
    console.warn('downloadStaffDailyTimeTablePdf error:', err);
    return { success: false, filename: 'Daily_Time_Table.pdf', blobUrl: '' };
  }
}

export type StaffCertificateType = 'BANK' | 'EMPLOYMENT' | 'EXPERIENCE';

export interface StaffCertificatePdfExportData {
  staff: SalaryStaffMember;
  certificateType: StaffCertificateType;
  companyId?: CompanyId | string;
  companyInfo?: StaffCompanyDetails;
  customLogo?: string | null;
  branding?: BrandingInfo;
  issuedDate?: string;
}

export async function downloadStaffCertificatePdf(
  data: StaffCertificatePdfExportData
): Promise<{ success: boolean; filename: string; blobUrl: string }> {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentW = pageWidth - margin * 2;
    const company = resolveStaffCompanyDetails(data.companyId || data.staff.companyId, data.companyInfo);
    const resolvedCompId = resolveOperatingCompanyFromRef(company.id as CompanyId, company.prefix);
    const today = new Date();
    const todayYmd = data.issuedDate || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const longDate = today.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    const shortId = (data.staff.id || 'EMP').slice(-5).toUpperCase();
    const prefix = company.prefix || 'MAK';
    const yearStr = String(today.getFullYear());

    const certTitles: Record<StaffCertificateType, { header: string; subject: string; refTag: string; filenameTag: string }> = {
      BANK: {
        header: 'BANK ACCOUNT OPENING CERTIFICATE',
        subject: 'EMPLOYMENT & SALARY VERIFICATION FOR BANK ACCOUNT OPENING',
        refTag: 'BNK',
        filenameTag: 'Bank_Account_Certificate'
      },
      EMPLOYMENT: {
        header: 'EMPLOYMENT VERIFICATION CERTIFICATE',
        subject: 'BONAFIDE EMPLOYMENT & SERVICE CONFIRMATION LETTER',
        refTag: 'EMP',
        filenameTag: 'Employment_Certificate'
      },
      EXPERIENCE: {
        header: 'EXPERIENCE & RELIEVING CERTIFICATE',
        subject: 'CERTIFICATE OF SERVICE, CONDUCT & WORK EXPERIENCE',
        refTag: 'EXP',
        filenameTag: 'Experience_Certificate'
      }
    };

    const cfg = certTitles[data.certificateType] || certTitles.EMPLOYMENT;
    const refNo = `${prefix}/HR/${cfg.refTag}/${yearStr}/${shortId}`;

    let currentY = await drawPdfCorporateHeader(doc, {
      title: cfg.header,
      refNo,
      date: todayYmd,
      subRef: cleanPdfText(company.legalTitle || company.name),
      branding: {
        companyName: company.legalTitle || company.name,
        customLogo: data.customLogo,
        ...data.branding
      },
      accentColor: data.certificateType === 'BANK' ? [4, 120, 87] : data.certificateType === 'EXPERIENCE' ? [180, 83, 9] : [30, 64, 175],
      subject: cfg.subject
    });

    currentY = drawEmployingCompanyBanner(doc, currentY, company);
    currentY += 5;

    // Reference & Dated Row
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(`Ref No: ${refNo}`, margin, currentY);
    doc.text(`Dated: ${longDate}`, pageWidth - margin, currentY, { align: 'right' });
    currentY += 10;

    // Salutation
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    const addressee =
      data.certificateType === 'BANK'
        ? 'THE BRANCH MANAGER / TO WHOM IT MAY CONCERN'
        : 'TO WHOM IT MAY CONCERN';
    doc.text(addressee, margin, currentY);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.3);
    doc.line(margin, currentY + 1.5, margin + 88, currentY + 1.5);
    currentY += 11;

    const staffName = cleanPdfText(data.staff.name || 'Employee').toUpperCase();
    const fatherText = data.staff.fatherName ? `S/O ${cleanPdfText(data.staff.fatherName).toUpperCase()}` : '';
    const desigText = cleanPdfText(data.staff.designation || 'Staff Member');
    const compLegal = cleanPdfText(company.legalTitle || company.name);
    const joinFormatted = data.staff.joiningDate ? formatPdfDate(data.staff.joiningDate) : '';
    const salaryNum = Number(data.staff.totalSalary) || 0;
    const salaryWords = numberToWordsRupees(salaryNum);

    let paragraphs: string[] = [];
    if (data.certificateType === 'BANK') {
      paragraphs = [
        `This is to certify that Mr./Ms. ${staffName}${fatherText ? ` (${fatherText})` : ''} is a bonafide full-time employee of ${compLegal}, an operating subsidiary under MAK Group of Companies, holding the designation of "${desigText}"${joinFormatted ? ` since ${joinFormatted}` : ''}.`,
        `His/Her present gross monthly remuneration is PKR ${salaryNum.toLocaleString()} (${salaryWords}), disbursed regularly by the Finance & Accounts Department.`,
        `This certificate is issued at the specific request of the employee strictly to facilitate Bank Account Opening and banking KYC verification formalities. The company bears no financial guarantee or liability for personal banking facilities.`
      ];
    } else if (data.certificateType === 'EXPERIENCE') {
      paragraphs = [
        `This is to certify that Mr./Ms. ${staffName}${fatherText ? ` (${fatherText})` : ''} served with ${compLegal} (MAK Group of Companies) in the capacity of "${desigText}"${joinFormatted ? ` from ${joinFormatted} until ${formatPdfDate(todayYmd)}` : ` until ${formatPdfDate(todayYmd)}`}.`,
        `During the period of service, he/she performed assigned operational and administrative responsibilities diligently, maintained professional integrity, and upheld company standards.`,
        `He/She stands relieved of duties in good standing. We extend our best wishes for continued success in all future professional endeavors.`
      ];
    } else {
      paragraphs = [
        `This is to confirm that Mr./Ms. ${staffName}${fatherText ? ` (${fatherText})` : ''} is currently employed on the permanent payroll of ${compLegal}, a constituent entity of MAK Group of Companies, serving as "${desigText}"${joinFormatted ? ` since ${joinFormatted}` : ''}.`,
        `His/Her monthly salary package is PKR ${salaryNum.toLocaleString()} (${salaryWords}), and his/her employment status is active and in good standing as of ${longDate}.`,
        `This Employment Verification Certificate is issued upon the employee's request for submission to concerned authorities, institutions, or official verification purposes.`
      ];
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.8);
    doc.setTextColor(30, 41, 59);
    for (const para of paragraphs) {
      const wrapped = doc.splitTextToSize(para, contentW);
      doc.text(wrapped, margin, currentY, { lineHeightFactor: 1.45 });
      currentY += wrapped.length * 5.2 + 4.5;
    }

    currentY += 3;

    // Particulars Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, currentY, contentW, 38, 2, 2, 'FD');

    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, contentW, 6.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('CERTIFIED EMPLOYEE & COMPANY PARTICULARS', margin + 4, currentY + 4.7);

    const pRows: Array<[string, string]> = [
      ['Employee Name', `${staffName}${fatherText ? ` (${fatherText})` : ''}`],
      ['Designation', desigText],
      ['Date of Joining', joinFormatted || 'Verified on Payroll Record'],
      ['Monthly Salary', `PKR ${salaryNum.toLocaleString()} (${salaryWords})`],
      ['Issued Date / Entity', `${longDate}  |  ${compLegal}`]
    ];

    let pY = currentY + 12;
    for (const [label, val] of pRows) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(100, 116, 139);
      doc.text(`${label}:`, margin + 4, pY);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(cleanPdfText(val), margin + 44, pY, { maxWidth: contentW - 48 });
      pY += 5.4;
    }

    currentY += 46;

    // Authorized Signatory Area + Subsidiary Stamp
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`For and on behalf of ${compLegal},`, margin, currentY);
    currentY += 14;

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.4);
    doc.line(margin, currentY, margin + 56, currentY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('Authorized Signatory / HR & Finance', margin, currentY + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`${compLegal} | ${cleanPdfText(company.phone || '')}`, margin, currentY + 8.5);

    const stampY = Math.min(pageHeight - 44, currentY + 14);
    await drawIssuingCompanySignatureAndStamp(
      doc,
      stampY,
      'OFFICIAL COMPANY SEAL',
      resolvedCompId,
      company.prefix,
      data.customLogo || data.branding?.customLogo
    );
    drawPdfCorporateFooter(doc, `Issued ${formatPdfDate(todayYmd)} | Official Corporate Letterhead`, data.branding);

    const safeCo = (company.name || 'Company').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const safeStaff = (data.staff.name || 'Staff').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const filename = `${safeCo}_${safeStaff}_${cfg.filenameTag}_${formatPdfDate(todayYmd)}.pdf`;
    return await triggerDirectDownload(doc, filename);
  } catch (err) {
    console.warn('downloadStaffCertificatePdf error:', err);
    return { success: false, filename: 'Company_Certificate.pdf', blobUrl: '' };
  }
}



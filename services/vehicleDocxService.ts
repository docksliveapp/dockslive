import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  convertInchesToTwip
} from 'docx';
import { Vehicle } from '../types';
import { getActiveCompany } from './companyService';

// Standard company & witness registry (always consistent across Customs & Legal Word files; editable in Word anytime)
export const DOCKS_COMPANY = {
  name: 'Docks (Pvt) Ltd.',
  fullLegalName: 'M/s. Docks (Pvt.) Ltd.',
  address: 'Office No 13 1st Floor State Life Building No 7 G-Allana Road Tower Karachi',
  ntn: '5064083-8',
  customsNtn: '3997968',
  phone: '+92 21 3241 4500',
  email: 'operations@dockspvtltd.com',
  witnesses: {
    w1_arbaz: { name: 'Mr. MUHAMMAD ARBAZ', cnic: '42401-7400526-3' },
    w1_hasnain: { name: 'Mr. MUHAMMAD HASNAIN', cnic: '42401-7452960-7' },
    w2_shams: { name: 'Mr. SHAMS TABREZ BUKHARI', cnic: '42301-0618439-9' }
  }
};

export interface ResolvedVehicleDocxCompany {
  id: 'docks' | 'truckit' | 'muhib' | 'vantage';
  name: string;
  signoffName: string;       // e.g. TRUCKIT (PVT) LTD. / DOCKS (PVT) LTD.
  legalMixed: string;        // e.g. TRUCKIT (Pvt.) Ltd. / DOCKS (Pvt.) Ltd.
  legalCaps: string;         // e.g. TRUCKIT (PVT) LTD / DOCKS (PVT) LTD
  legalCapsDot: string;      // e.g. TRUCKIT (PVT.) LTD / DOCKS (PVT.) LTD
  fullLegalName: string;     // e.g. M/s. TRUCKIT (Pvt.) Ltd.
  ntn: string;               // e.g. 5064083-8
  customsNtn: string;        // e.g. 3997968
  address: string;
  addressUpper: string;
  addressLine1: string;
  addressLine2: string;
  witnesses: typeof DOCKS_COMPANY.witnesses;
}

/**
 * Resolves the exact operating company under which a specific vehicle is registered.
 * Ensures every document (Registration, Lease, Affidavit, Cancellation NOC, Lease Termination)
 * prints the company on whose panel THAT vehicle is registered.
 */
export function resolveVehicleDocxCompany(v?: Vehicle | null): ResolvedVehicleDocxCompany {
  const opRaw = String(v?.operatingCompany || '').trim().toLowerCase();
  const nameRaw = String(v?.companyName || '').trim().toUpperCase();
  const active = getActiveCompany();

  let id: 'docks' | 'truckit' | 'muhib' | 'vantage' = active.id;
  if (opRaw === 'truckit' || nameRaw.includes('TRUCKIT')) {
    id = 'truckit';
  } else if (opRaw === 'docks' || nameRaw.includes('DOCKS')) {
    id = 'docks';
  } else if (opRaw === 'muhib' || nameRaw.includes('MUHIB')) {
    id = 'muhib';
  } else if (opRaw === 'vantage' || nameRaw.includes('VANTAGE')) {
    id = 'vantage';
  }

  const address = 'Office No 13 1st Floor State Life Building No 7 G-Allana Road Tower Karachi';
  const addressUpper = 'OFFICE NO.13 FIRST FLOOR, STATE LIFE BUILDING NO. 7, G-ALLANA ROAD, TOWER, KARACHI';
  const addressLine1 = 'Office 13, 1st Floor, State Life Building # 7,';
  const addressLine2 = 'G.Allana Road, Tower, Karachi.';

  if (id === 'truckit') {
    return {
      id: 'truckit',
      name: 'TruckIt (Pvt.) Ltd.',
      signoffName: 'TRUCKIT (PVT) LTD.',
      legalMixed: 'TRUCKIT (Pvt.) Ltd.',
      legalCaps: 'TRUCKIT (PVT) LTD',
      legalCapsDot: 'TRUCKIT (PVT.) LTD',
      fullLegalName: 'M/s. TRUCKIT (Pvt.) Ltd.',
      ntn: '5064083-8',
      customsNtn: '3997968',
      address,
      addressUpper,
      addressLine1,
      addressLine2,
      witnesses: DOCKS_COMPANY.witnesses
    };
  }

  if (id === 'muhib') {
    return {
      id: 'muhib',
      name: 'Muhib International',
      signoffName: 'MUHIB INTERNATIONAL',
      legalMixed: 'MUHIB INTERNATIONAL',
      legalCaps: 'MUHIB INTERNATIONAL',
      legalCapsDot: 'MUHIB INTERNATIONAL',
      fullLegalName: 'M/s. MUHIB INTERNATIONAL',
      ntn: '5064083-9',
      customsNtn: '3997968',
      address,
      addressUpper,
      addressLine1,
      addressLine2,
      witnesses: DOCKS_COMPANY.witnesses
    };
  }

  if (id === 'vantage') {
    return {
      id: 'vantage',
      name: 'Vantage Shipping Line',
      signoffName: 'VANTAGE SHIPPING LINE',
      legalMixed: 'VANTAGE SHIPPING LINE',
      legalCaps: 'VANTAGE SHIPPING LINE',
      legalCapsDot: 'VANTAGE SHIPPING LINE',
      fullLegalName: 'M/s. VANTAGE SHIPPING LINE',
      ntn: '5064083-7',
      customsNtn: '3997968',
      address,
      addressUpper,
      addressLine1,
      addressLine2,
      witnesses: DOCKS_COMPANY.witnesses
    };
  }

  return {
    id: 'docks',
    name: 'Docks (Pvt) Ltd.',
    signoffName: 'DOCKS (PVT) LTD.',
    legalMixed: 'DOCKS (Pvt.) Ltd.',
    legalCaps: 'DOCKS (PVT) LTD',
    legalCapsDot: 'DOCKS (PVT.) LTD',
    fullLegalName: 'M/s. DOCKS (Pvt.) Ltd.',
    ntn: '5064083-8',
    customsNtn: '3997968',
    address,
    addressUpper,
    addressLine1,
    addressLine2,
    witnesses: DOCKS_COMPANY.witnesses
  };
}

export function getActiveCompanyDocxDetails() {
  const resolved = resolveVehicleDocxCompany(null);
  return {
    name: resolved.name,
    legalTitle: resolved.legalMixed,
    fullLegalName: resolved.fullLegalName,
    address: resolved.address,
    ntn: resolved.ntn,
    customsNtn: resolved.customsNtn,
    phone: '+92 21 3241 4500',
    email: 'operations@makgroup.com.pk',
    witnesses: DOCKS_COMPANY.witnesses
  };
}

// Date utilities
export function getCleanDate(dateInput?: string | Date): Date {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? new Date() : dateInput;
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) return new Date();
    const parts = trimmed.split(/[/\-.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (!isNaN(d.getTime())) return d;
      } else {
        const d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        if (!isNaN(d.getTime())) return d;
      }
    }
  }
  const parsed = new Date(dateInput);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function formatSlashDate(d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatDotDate(d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function formatDashDate(d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function getOrdinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

export function formatAgreementDate(d: Date = new Date()): string {
  const day = d.getDate();
  const dayStr = String(day).padStart(2, '0') + getOrdinalSuffix(day);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthStr = months[d.getMonth()];
  const year = d.getFullYear();
  return `${dayStr} ${monthStr}, ${year}`;
}

export function calculateSixMonthsExpiry(startDate: Date = new Date()): Date {
  const expiry = new Date(startDate);
  expiry.setMonth(expiry.getMonth() + 6);
  expiry.setDate(expiry.getDate() - 1);
  return expiry;
}

function cleanRealOwnerValue(val?: string): string {
  if (!val) return '';
  const trimmed = String(val).trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  if (
    upper === 'N/A' ||
    upper === 'NA' ||
    upper === 'NONE' ||
    upper === '-' ||
    upper === 'DOCKS (PVT) LTD' ||
    upper === 'DOCKS (PVT.) LTD.' ||
    upper === 'TRUCKIT (PVT) LTD' ||
    upper === 'TRUCKIT PVT LTD' ||
    upper === 'DOCKS PVT LTD'
  ) {
    return '';
  }
  return trimmed;
}

/**
 * Extracts exact vehicle technical and owner particulars from the vehicle record itself
 * without substituting unrelated hardcoded owner names.
 */
export function extractVehicleFields(v: Vehicle) {
  let maker = String(v.make || v.maker || '').trim().toUpperCase();
  let model = String(v.model || '').trim();

  if (!maker && v.makeModel) {
    const parts = v.makeModel.trim().split(/\s+/);
    maker = parts[0]?.toUpperCase() || '';
    if (!model && parts.length > 1) {
      model = parts.slice(1).join(' ');
    }
  }

  if (!maker) {
    const reg = (v.registrationNumber || '').toUpperCase();
    if (reg.includes('HINO')) maker = 'HINO';
    else if (reg.includes('NISSAN')) maker = 'NISSAN';
    else if (reg.includes('VOLVO')) maker = 'VOLVO';
    else if (reg.includes('FUSO')) maker = 'FUSO';
    else if (reg.includes('JAC')) maker = 'JAC';
    else maker = 'HINO';
  }

  if (!model) {
    model = v.registrationDate && v.registrationDate.length >= 4 ? v.registrationDate.slice(0, 4) : '-';
  }

  let mra = String(v.mra || '').trim().toUpperCase();
  if (!mra) {
    const reg = (v.registrationNumber || '').toUpperCase();
    if (
      reg.includes('LS') ||
      reg.includes('TLB') ||
      reg.includes('TLD') ||
      reg.includes('TLF') ||
      reg.includes('TLK') ||
      reg.includes('TMG') ||
      reg.includes('TLX') ||
      reg.includes('TMA') ||
      reg.includes('TMT')
    ) {
      mra = 'LASBELA';
    } else if (reg.includes('QTA') || reg.includes('Q-')) {
      mra = 'QUETTA';
    } else if (reg.includes('LES') || reg.includes('LPT') || reg.includes('LCA')) {
      mra = 'LAHORE';
    } else if (reg.includes('Z-') || reg.includes('P-') || reg.includes('PR-')) {
      mra = 'PESHAWAR';
    } else if (reg.includes('KP') || reg.includes('C-')) {
      mra = 'HARIPUR';
    } else {
      mra = 'KARACHI';
    }
  }

  const rawTare = String(v.tareWeight || '').trim();
  const tare = rawTare || '';
  const owner = cleanRealOwnerValue(v.ownerName);
  const ownerFather = cleanRealOwnerValue(v.ownerFatherName);
  const ownerCnic = cleanRealOwnerValue(v.ownerCnic);
  const ownerAddress = cleanRealOwnerValue(v.ownerAddress);

  return {
    maker,
    model,
    mra,
    tare,
    owner,
    ownerFather,
    ownerCnic,
    ownerAddress
  };
}

// Download & Blob utility
export async function generateDocxBlob(doc: Document): Promise<Blob> {
  return await Packer.toBlob(doc);
}

export async function downloadDocxBlob(doc: Document, filename: string): Promise<void> {
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const tableBorders = {
  top: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  left: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  right: { style: BorderStyle.SINGLE, size: 6, color: '000000' }
};

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
};

const calibriFont = 'Calibri';

// ============================================================================
// 1. REGISTRATION & RENEWAL APPLICATION LETTER (Company Letterhead)
// ============================================================================
export interface RegistrationLetterOptions {
  letterDate?: string | Date;
  referenceNo?: string;
  leaveLetterheadSpace?: boolean;
}

export async function generateRegistrationRenewalLetterDocx(
  vehicles: Vehicle[],
  options: RegistrationLetterOptions = {}
): Promise<Document> {
  const dateObj = getCleanDate(options.letterDate || vehicles[0]?.registrationDate);
  const formattedDate = formatSlashDate(dateObj);
  const topMargin = options.leaveLetterheadSpace !== false ? convertInchesToTwip(2.2) : convertInchesToTwip(1.0);
  const comp = resolveVehicleDocxCompany(vehicles[0]);

  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'REG-NO.', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 15, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'CHASSIS', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 18, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'ENGINE', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 16, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MAKER', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 12, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MODEL', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 10, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'M.R.A.', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 13, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'OWNER', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 16, type: WidthType.PERCENTAGE },
        borders: tableBorders
      })
    ]
  });

  const tableDataRows = vehicles.map((v) => {
    const { maker, model, mra, owner } = extractVehicleFields(v);
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.registrationNumber || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.chassisNo || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.engineNo || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: maker || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(model || '-'), bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: mra || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: owner ? owner.toUpperCase() : '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        })
      ]
    });
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: topMargin,
              bottom: convertInchesToTwip(1.0),
              left: convertInchesToTwip(1.0),
              right: convertInchesToTwip(1.0)
            }
          }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 280 },
            children: [
              new TextRun({ text: 'Date: ', bold: true, size: 22, font: calibriFont }),
              new TextRun({ text: formattedDate, bold: true, underline: {}, size: 22, font: calibriFont })
            ]
          }),
          new Paragraph({
            spacing: { line: 276, after: 300 },
            children: [
              new TextRun({ text: 'The Deputy / Assistant Director,', bold: true, size: 22, font: calibriFont }),
              new TextRun({ text: 'Licensing of Bonded Carrier,', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: 'Directorate of Transit Trade,', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: 'Custom House,', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: 'Karachi.', bold: true, underline: {}, size: 22, font: calibriFont, break: 1 })
            ]
          }),
          new Paragraph({
            spacing: { before: 180, after: 240 },
            children: [
              new TextRun({ text: 'Subject:\t', bold: true, size: 22, font: calibriFont }),
              new TextRun({
                text: 'REGISTRATION OF VEHICLES AS PRIVATE BONDED CARRIER',
                bold: true,
                underline: {},
                size: 22,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 300, after: 260 },
            children: [
              new TextRun({
                text: 'In terms of Rule 329 (5) of Chapter XIV of Customs Rules, 2001, ',
                bold: true,
                size: 21,
                font: calibriFont
              }),
              new TextRun({
                text: `(${vehicles.length})`,
                bold: true,
                underline: {},
                size: 21,
                font: calibriFont
              }),
              new TextRun({
                text: ' vehicles indicated below is hereby required to be registered with us for transshipment of imported goods to upcountry Customs Dry Ports / Customs Stations for a period of six months.',
                bold: true,
                size: 21,
                font: calibriFont
              })
            ]
          }),
          new Table({
            rows: [tableHeaderRow, ...tableDataRows],
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),
          new Paragraph({
            spacing: { before: 300, line: 280, after: 360 },
            children: [
              new TextRun({
                text: 'It is therefore, you are requested to register the aforementioned list and issue permit accordingly. Thanking for kind perusal.',
                bold: true,
                size: 21,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { before: 200, line: 276 },
            children: [
              new TextRun({ text: 'Yours Faithfully,', bold: true, size: 22, font: calibriFont }),
              new TextRun({ text: '', break: 2 }),
              new TextRun({ text: '_________________________', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: `For: ${comp.signoffName}`, bold: true, size: 22, font: calibriFont, break: 1 })
            ]
          })
        ]
      }
    ]
  });
}

// ============================================================================
// 2. CUSTOMS PERMIT FOR RENEWAL / FRESH REGISTRATION (Customs Office Format)
// ============================================================================
export interface CustomsPermitOptions {
  letterDate?: string | Date;
  applicationDate?: string | Date;
  permitNo?: string;
  leaveGovernmentHeaderSpace?: boolean;
}

export async function generateCustomsPermitLetterDocx(
  vehicles: Vehicle[],
  options: CustomsPermitOptions = {}
): Promise<Document> {
  const dateObj = getCleanDate(options.letterDate || vehicles[0]?.registrationDate);
  const formattedDated = formatDotDate(dateObj);
  const appDate = options.applicationDate ? formatDotDate(getCleanDate(options.applicationDate)) : formattedDated;
  const expiryDateObj = calculateSixMonthsExpiry(dateObj);
  const formattedExpiry = formatDotDate(expiryDateObj);
  const permitRef = options.permitNo || 'No. SI/Mics./01/2021–(Licensing)';
  const comp = resolveVehicleDocxCompany(vehicles[0]);

  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'S #', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 6, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Reg. No.', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 15, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Chassis No.', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 18, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Engine No.', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 17, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Make', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 12, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Model', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 10, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MRA', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 11, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Expiry', bold: true, size: 18, font: calibriFont })] })],
        width: { size: 11, type: WidthType.PERCENTAGE },
        borders: tableBorders
      })
    ]
  });

  const tableDataRows = vehicles.map((v, idx) => {
    const { maker, model, mra } = extractVehicleFields(v);
    const vExp = v.validationExpiryDate ? formatDotDate(getCleanDate(v.validationExpiryDate)) : formattedExpiry;
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(idx + 1), size: 17, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.registrationNumber || '-', size: 17, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.chassisNo || '-', size: 17, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.engineNo || '-', size: 17, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: maker || '-', size: 17, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(model || '-'), size: 17, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: mra || '-', size: 17, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: vExp, size: 17, font: calibriFont })] })],
          borders: tableBorders
        })
      ]
    });
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.9),
              bottom: convertInchesToTwip(0.9),
              left: convertInchesToTwip(0.9),
              right: convertInchesToTwip(0.9)
            }
          }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 260, after: 120 },
            children: [
              new TextRun({ text: 'Government of Pakistan', bold: true, size: 24, font: calibriFont }),
              new TextRun({ text: 'Directorate General of Transit Trade', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: 'Custom House', size: 21, font: calibriFont, break: 1 }),
              new TextRun({ text: 'Karachi', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: '****', size: 18, font: calibriFont, break: 1 })
            ]
          }),
          new Paragraph({
            spacing: { before: 140, after: 200 },
            children: [
              new TextRun({ text: `${permitRef}`, bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: `\t\t\t\tDated: ${formattedDated}`, bold: true, size: 20, font: calibriFont })
            ]
          }),
          new Paragraph({
            spacing: { line: 260, after: 220 },
            children: [
              new TextRun({ text: `${comp.fullLegalName}`, bold: true, size: 21, font: calibriFont }),
              new TextRun({ text: 'Office No.13 First Floor State Life Building No.7', size: 20, font: calibriFont, break: 1 }),
              new TextRun({ text: 'G-Allana Road Tower,', size: 20, font: calibriFont, break: 1 }),
              new TextRun({ text: 'Karachi.', bold: true, size: 20, font: calibriFont, break: 1 })
            ]
          }),
          new Paragraph({
            spacing: { before: 120, after: 160 },
            children: [
              new TextRun({ text: 'Subject: - \t', bold: true, size: 21, font: calibriFont }),
              new TextRun({
                text: 'PERMIT FOR RENEWAL / FRESH REGISTRATION OF VEHICLES IN THE SYSTEM AS PRIVATE BONDED CARRIER / TRANSPORT OPERATOR',
                bold: true,
                underline: {},
                size: 21,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { after: 180 },
            children: [
              new TextRun({ text: 'Please refer to your application dated ', size: 20, font: calibriFont }),
              new TextRun({ text: `${appDate}`, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({ text: ' on the subject cited above.', size: 20, font: calibriFont })
            ]
          }),
          new Paragraph({
            spacing: { line: 290, after: 200 },
            children: [
              new TextRun({ text: '2.\tThe request for renewal of vehicles and fresh registration of ', size: 20, font: calibriFont }),
              new TextRun({ text: `${vehicles.length} vehicles`, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({
                text: ' in terms of Rule 329 (5) & (6) of Chapter XIV, Rule 478 (d) of Chapter XXI and Rule 639 (d) of Customs Rules, 2001 notified vide SRO 450(I)/2001 dated 18.06.2001 acceded to and total ',
                size: 20,
                font: calibriFont
              }),
              new TextRun({ text: `${vehicles.length} vehicles`, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({
                text: ', particulars of which indicated in the table below are hereby provisionally registered in the system with ',
                size: 20,
                font: calibriFont
              }),
              new TextRun({ text: `${comp.fullLegalName} Karachi`, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({
                text: ' for providing transport facility to the transhipments to and from upcountry Customs Dry Ports as well as transit goods for a period of six months. The Customs House, However, reserves the right to revoke / suspend this provisional registration fully or partially at anytime during the period of its validity without any prior notice.',
                size: 20,
                font: calibriFont
              })
            ]
          }),
          new Table({
            rows: [tableHeaderRow, ...tableDataRows],
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),
          new Paragraph({
            spacing: { before: 240, line: 280, after: 380 },
            children: [
              new TextRun({
                text: '3.\tAppropriate Customs Officer assigned the job of issuing sealing certificate at exit point of Port / Airport must ensure the fulfilment of conditions in terms of Rule 327, 328 and 329 of Chapter XIV and Rule 477, 478 and 479 of Chapter XXI of Customs Rules, 2001 notified vide SRO 450(I)/2001 dated 18.06.2001 besides other conditions contained in the said rules. The Trackers in these vehicles may also be checked by the concerned Customs staff of tracking, sealing and monitoring at the time of exit of vehicles with goods from port.',
                size: 20,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 300 },
            children: [
              new TextRun({ text: '(Deputy Director)', bold: true, size: 22, font: calibriFont }),
              new TextRun({ text: '(Licensing)', bold: true, size: 21, font: calibriFont, break: 1 })
            ]
          })
        ]
      }
    ]
  });
}

// ============================================================================
// 3. VEHICLE LEASE AGREEMENT (Printed on Stamp Paper — 1:1 Official Format)
// ============================================================================
export interface LeaseAgreementOptions {
  agreementDate?: string | Date;
  leaveStampPaperSpace?: boolean;
  customLessorName?: string;
  customFatherName?: string;
  customCnic?: string;
  customAddress?: string;
  witness1Name?: string;
  witness1Cnic?: string;
  witness2Name?: string;
  witness2Cnic?: string;
}

export async function generateLeaseAgreementDocx(
  vehicles: Vehicle[],
  options: LeaseAgreementOptions = {}
): Promise<Document> {
  const firstV = vehicles[0] || ({} as Vehicle);
  const comp = resolveVehicleDocxCompany(firstV);
  const dateObj = getCleanDate(options.agreementDate || firstV.registrationDate);

  const dayNum = dateObj.getDate();
  const dayPadded = String(dayNum).padStart(2, '0');
  const dayOrdinal = getOrdinalSuffix(dayNum);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthStr = months[dateObj.getMonth()];
  const yearNum = dateObj.getFullYear();

  const leaseStartObj = new Date(dateObj);
  const leaseExpiryObj = firstV.validationExpiryDate
    ? getCleanDate(firstV.validationExpiryDate)
    : calculateSixMonthsExpiry(leaseStartObj);
  const startDateStr = formatDotDate(leaseStartObj);
  const endDateStr = formatDotDate(leaseExpiryObj);

  const topMargin = options.leaveStampPaperSpace !== false ? convertInchesToTwip(3.4) : convertInchesToTwip(0.9);

  const { owner, ownerFather, ownerCnic, ownerAddress } = extractVehicleFields(firstV);
  const rawLessorName = (options.customLessorName || owner || '').trim();
  const rawLessorFather = (options.customFatherName || ownerFather || '').trim();
  const rawLessorCnic = (options.customCnic || ownerCnic || '').trim();
  const rawLessorAddress = (options.customAddress || ownerAddress || '').trim();

  const lessorNameDisplay = rawLessorName ? rawLessorName.toUpperCase() : '______________________';
  const lessorFatherDisplay = rawLessorFather ? rawLessorFather.toUpperCase() : '____________________';
  const lessorCnicDisplay = rawLessorCnic || '___________________';
  const lessorAddressDisplay = rawLessorAddress ? rawLessorAddress.toUpperCase() : '___________________________________';

  const w1Name = options.witness1Name || DOCKS_COMPANY.witnesses.w1_arbaz.name;
  const w1Cnic = options.witness1Cnic || DOCKS_COMPANY.witnesses.w1_arbaz.cnic;
  const w2Name = options.witness2Name || DOCKS_COMPANY.witnesses.w2_shams.name;
  const w2Cnic = options.witness2Cnic || DOCKS_COMPANY.witnesses.w2_shams.cnic;

  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'VEHICLE NO.', bold: true, size: 18, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'CHASIS NUMBER', bold: true, size: 18, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'ENGINE NUMBER', bold: true, size: 18, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MAKER', bold: true, size: 18, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MODEL', bold: true, size: 18, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'TARE OF\nVEHICLE', bold: true, size: 18, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MRA OF\nVEHICLES', bold: true, size: 18, font: calibriFont })] })],
        borders: tableBorders
      })
    ]
  });

  const tableDataRows = vehicles.map((v) => {
    const { maker, model, mra, tare } = extractVehicleFields(v);
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.registrationNumber || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.chassisNo || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.engineNo || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: maker || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(model || '-'), bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: tare || '5100', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: mra || '-', bold: true, size: 18, font: calibriFont })] })],
          borders: tableBorders
        })
      ]
    });
  });

  const signaturesTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 54, type: WidthType.PERCENTAGE },
            borders: noBorders,
            children: [
              new Paragraph({
                spacing: { before: 140, after: 40 },
                children: [new TextRun({ text: 'LESSOR', bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { before: 220, after: 20 },
                children: [new TextRun({ text: '___________________________', bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: rawLessorName ? rawLessorName.toUpperCase() : '', bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { after: 140 },
                children: [new TextRun({ text: `CNIC:${rawLessorCnic ? ` ${rawLessorCnic}` : ''}`, bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { before: 80, after: 40 },
                children: [new TextRun({ text: 'Witness 1:', bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { before: 220, after: 20 },
                children: [new TextRun({ text: '___________________________', bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: w1Name, bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                children: [new TextRun({ text: `CNIC NO. ${w1Cnic}`, bold: true, size: 20, font: calibriFont })]
              })
            ]
          }),
          new TableCell({
            width: { size: 46, type: WidthType.PERCENTAGE },
            borders: noBorders,
            children: [
              new Paragraph({
                spacing: { before: 140, after: 40 },
                children: [new TextRun({ text: 'LEASEE', bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { before: 220, after: 20 },
                children: [new TextRun({ text: '___________________________', bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: comp.legalMixed, bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { after: 140 },
                children: [
                  new TextRun({ text: 'NTN No. ', bold: true, size: 20, font: calibriFont }),
                  new TextRun({ text: comp.ntn, bold: true, underline: {}, size: 20, font: calibriFont })
                ]
              }),
              new Paragraph({
                spacing: { before: 80, after: 40 },
                children: [new TextRun({ text: 'Witness 2:', bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { before: 220, after: 20 },
                children: [new TextRun({ text: '___________________________', bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: w2Name, bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                children: [new TextRun({ text: `CNIC NO. ${w2Cnic}`, bold: true, size: 20, font: calibriFont })]
              })
            ]
          })
        ]
      })
    ]
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: topMargin,
              bottom: convertInchesToTwip(0.65),
              left: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.75)
            }
          }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [
              new TextRun({
                text: 'LEASE AGREEMENT',
                bold: true,
                underline: {},
                size: 26,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            indent: { firstLine: convertInchesToTwip(1.1) },
            spacing: { after: 80 },
            children: [
              new TextRun({ text: `This agreement is made at Karachi on ${dayPadded}`, bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: dayOrdinal, bold: true, superScript: true, size: 20, font: calibriFont }),
              new TextRun({ text: ` ${monthStr}, ${yearNum}.`, bold: true, size: 20, font: calibriFont })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [new TextRun({ text: 'BETWEEN', bold: true, size: 20, font: calibriFont })]
          }),
          new Paragraph({
            indent: { firstLine: convertInchesToTwip(1.1) },
            spacing: { line: 255, after: 80 },
            children: [
              new TextRun({ text: `M/S  ${lessorNameDisplay}`, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({ text: ' S/O ', bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: lessorFatherDisplay, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({ text: ' holder of CNIC NO. ', bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: lessorCnicDisplay, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({ text: ' Resident of ', bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: `${lessorAddressDisplay} `, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({
                text: 'party of the first part here in after referred to as “Lessor” (which expression wherever the context so permits, shall mean and included their heirs, executors, administrators, successors, attorneys, representatives, nominees and assignee).',
                bold: true,
                size: 20,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [new TextRun({ text: 'AND', bold: true, size: 20, font: calibriFont })]
          }),
          new Paragraph({
            indent: { firstLine: convertInchesToTwip(1.1) },
            spacing: { line: 255, after: 120 },
            children: [
              new TextRun({ text: 'M/s.', bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: `${comp.legalMixed},`, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({ text: ' (bonded Carrier) having ', bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: comp.addressUpper, bold: true, size: 17, font: calibriFont }),
              new TextRun({
                text: ', to as “Lessee” (which expression whereas the context so permits, shall mean and include their heirs, executors, administrators, successors, attorneys, representatives, nominees and assignees). WHEREAS, the lessor is the lawful owner of the following vehicles:',
                bold: true,
                size: 20,
                font: calibriFont
              })
            ]
          }),
          new Table({
            rows: [tableHeaderRow, ...tableDataRows],
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),
          new Paragraph({
            indent: { firstLine: convertInchesToTwip(1.1) },
            spacing: { before: 100, line: 255, after: 120 },
            children: [
              new TextRun({
                text: 'AND WHEREAS, the lessor has agreed to hand over the above referred vehicle for a period of (Six months) on the lease basis on the following terms and conditions:',
                bold: true,
                size: 20,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 250, after: 40 },
            children: [
              new TextRun({
                text: 'a) The vehicle shall be indelibly painted on all four sides clearly indicating the name of “lessees” (Bonded Carrier) and shall be maintained an acceptable standard till the lease period and should not be registered on the other bonded carriers name within the agreement period i.e. ',
                bold: true,
                size: 19,
                font: calibriFont
              }),
              new TextRun({
                text: `(${startDateStr} to ${endDateStr}).`,
                bold: true,
                underline: {},
                size: 19,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 250, after: 40 },
            children: [
              new TextRun({
                text: 'b) The designated vehicle shall remain dedicated to M/s. ',
                bold: true,
                size: 19,
                font: calibriFont
              }),
              new TextRun({
                text: comp.legalMixed,
                bold: true,
                underline: {},
                size: 19,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 250, after: 40 },
            children: [
              new TextRun({
                text: 'c) Payments to the lessor for services rendered shall be made in accordance with agreed rates.',
                bold: true,
                size: 19,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 250, after: 40 },
            children: [
              new TextRun({
                text: 'd) This lease agreement is an irrevocable agreement and cannot be terminated by either party during its validity, except by mutual consideration of both parties.',
                bold: true,
                size: 19,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 250, after: 40 },
            children: [
              new TextRun({
                text: 'e) The vehicle under this lease agreement remained at the disposal of “lessee” and is not used for any unlawful purpose i.e. (vehicle will be used only for the transportation of bonded carrier goods).',
                bold: true,
                size: 19,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 250, after: 40 },
            children: [
              new TextRun({
                text: 'f) The payment to the lessor will be made on monthly basis.',
                bold: true,
                size: 19,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 250, after: 40 },
            children: [
              new TextRun({
                text: 'g) The “Lessee” remained responsible for all the Govt. dues, duty & taxes, charges etc. whatever accrued during the lease period and by usage of vehicle by the “Lessee”.',
                bold: true,
                size: 19,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 250, after: 100 },
            children: [
              new TextRun({
                text: 'h) It is stated that the lessor is also responsible for any liabilities that may arrives on the lessee during transportation / transshipment of the goods including responsibility of payment of loss of government revenue (if any).',
                bold: true,
                size: 19,
                font: calibriFont
              })
            ]
          }),
          signaturesTable
        ]
      }
    ]
  });
}

// ============================================================================
// 4. LEASE CANCELLATION AND TERMINATION AGREEMENT (Stamp Paper — 1:1 Format)
// ============================================================================
export interface LeaseTerminationOptions {
  terminationDate?: string | Date;
  originalAgreementDate?: string | Date;
  leaveStampPaperSpace?: boolean;
  customLessorName?: string;
  customCnic?: string;
  customAddress?: string;
  witness1Name?: string;
  witness1Cnic?: string;
  witness2Name?: string;
  witness2Cnic?: string;
}

export async function generateLeaseTerminationAgreementDocx(
  vehicle: Vehicle,
  options: LeaseTerminationOptions = {}
): Promise<Document> {
  const comp = resolveVehicleDocxCompany(vehicle);
  const dateObj = getCleanDate(options.terminationDate);
  const origDateSource = options.originalAgreementDate || vehicle.registrationDate || dateObj;
  const origDate = formatDashDate(getCleanDate(origDateSource));
  const topMargin = options.leaveStampPaperSpace !== false ? convertInchesToTwip(3.4) : convertInchesToTwip(0.9);

  const { maker, model, mra, tare, owner, ownerCnic, ownerAddress } = extractVehicleFields(vehicle);
  const realLessorName = (options.customLessorName || owner || '').trim();
  const realLessorCnic = (options.customCnic || ownerCnic || '').trim();
  const realLessorAddress = (options.customAddress || ownerAddress || '').trim();

  const w1Name = options.witness1Name || DOCKS_COMPANY.witnesses.w1_hasnain.name;
  const w1Cnic = options.witness1Cnic || DOCKS_COMPANY.witnesses.w1_hasnain.cnic;
  const w2Name = options.witness2Name || DOCKS_COMPANY.witnesses.w2_shams.name;
  const w2Cnic = options.witness2Cnic || DOCKS_COMPANY.witnesses.w2_shams.cnic;

  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Vehicle No.', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Chassis No.', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Engine No.', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Maker', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Model', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Tare of Vehicle', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MRA of Vehicle', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      })
    ]
  });

  const tableDataRow = new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: vehicle.registrationNumber || '-', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: vehicle.chassisNo || '-', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: vehicle.engineNo || '-', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: maker || '-', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(model || '-'), bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: tare || '15000 KG', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: mra || '-', bold: true, size: 19, font: calibriFont })] })],
        borders: tableBorders
      })
    ]
  });

  const witnessesTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 55, type: WidthType.PERCENTAGE },
            borders: noBorders,
            children: [
              new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: 'Witness 1 ', bold: true, underline: {}, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: w1Name, bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                children: [new TextRun({ text: `CNIC NO. ${w1Cnic}`, bold: true, size: 20, font: calibriFont })]
              })
            ]
          }),
          new TableCell({
            width: { size: 45, type: WidthType.PERCENTAGE },
            borders: noBorders,
            children: [
              new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: 'Witness-2', bold: true, underline: {}, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: w2Name, bold: true, size: 20, font: calibriFont })]
              }),
              new Paragraph({
                children: [new TextRun({ text: `CNIC NO. ${w2Cnic}`, bold: true, size: 20, font: calibriFont })]
              })
            ]
          })
        ]
      })
    ]
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: topMargin,
              bottom: convertInchesToTwip(0.75),
              left: convertInchesToTwip(0.85),
              right: convertInchesToTwip(0.85)
            }
          }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 180 },
            children: [
              new TextRun({
                text: 'LEASE CANCELLATION AND TERMINATION AGREEMENT',
                bold: true,
                size: 24,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 260, after: 100 },
            children: [
              new TextRun({ text: 'This LEASE CANCELLATION AND TERMINATION AGREEMENT is made by', bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: 'M/S. ', bold: true, size: 21, font: calibriFont, break: 1 }),
              new TextRun({
                text: realLessorName ? realLessorName.toUpperCase() : '____________________________',
                bold: true,
                underline: {},
                size: 21,
                font: calibriFont
              }),
              new TextRun({ text: '“Owner of Vehicle” hereafter referred to as the Lesser', bold: true, size: 20, font: calibriFont, break: 1 })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new TextRun({ text: 'AND', bold: true, size: 21, font: calibriFont })]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({ text: 'M/s. ', bold: true, size: 21, font: calibriFont }),
              new TextRun({ text: comp.legalCaps, bold: true, underline: {}, size: 21, font: calibriFont }),
              new TextRun({ text: ' hereafter referred to as “Lessee”.', bold: true, size: 21, font: calibriFont })
            ]
          }),
          new Paragraph({
            spacing: { line: 270, after: 180 },
            children: [
              new TextRun({
                text: `The Lease agreement dated ${origDate} made between the Lesser and the Lessee, pertaining to the following vehicles is hereby cancelled / terminated:`,
                bold: true,
                size: 20,
                font: calibriFont
              })
            ]
          }),
          new Table({
            rows: [tableHeaderRow, tableDataRow],
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),
          new Paragraph({
            indent: { firstLine: convertInchesToTwip(0.5) },
            spacing: { before: 200, line: 270, after: 240 },
            children: [
              new TextRun({
                text: 'The Lesser and Lessee have mutually agreed that the Lease shall be cancelled and terminated in consideration of the mutual covenants set forth and without any terms and conditions.',
                bold: true,
                size: 20,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 260, after: 200 },
            children: [
              new TextRun({ text: 'LESSOR', bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: 'SIGNATURE', bold: true, size: 20, font: calibriFont, break: 1 }),
              new TextRun({ text: '', break: 2 }),
              new TextRun({ text: `CNIC No${realLessorCnic ? `: ${realLessorCnic}` : ''}`, bold: true, size: 20, font: calibriFont, break: 1 }),
              new TextRun({ text: `Address:${realLessorAddress ? ` ${realLessorAddress}` : ''}`, bold: true, size: 20, font: calibriFont, break: 1 })
            ]
          }),
          new Paragraph({
            spacing: { line: 260, after: 260 },
            children: [
              new TextRun({ text: 'LESSES', bold: true, size: 20, font: calibriFont }),
              new TextRun({ text: 'SIGNATURE', bold: true, size: 20, font: calibriFont, break: 1 }),
              new TextRun({ text: '', break: 1 }),
              new TextRun({ text: 'M/S. ', bold: true, size: 21, font: calibriFont, break: 1 }),
              new TextRun({ text: comp.legalCapsDot, bold: true, underline: {}, size: 21, font: calibriFont }),
              new TextRun({ text: 'CNIC No. / NTN No. ', bold: true, size: 20, font: calibriFont, break: 1 }),
              new TextRun({ text: comp.customsNtn, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({ text: 'Address: ', bold: true, size: 20, font: calibriFont, break: 1 }),
              new TextRun({ text: comp.addressLine1, bold: true, underline: {}, size: 20, font: calibriFont }),
              new TextRun({ text: comp.addressLine2, bold: true, underline: {}, size: 20, font: calibriFont, break: 1 })
            ]
          }),
          witnessesTable
        ]
      }
    ]
  });
}

// ============================================================================
// 5. CANCELLATION OF REGISTERED VEHICLE FROM OUR PANEL (Company Letterhead)
// Exact 1:1 reproduction of 10-11-2026 "Noc on Letter head.docx"
// ============================================================================
export interface CancellationLetterOptions {
  letterDate?: string | Date;
  leaveLetterheadSpace?: boolean;
}

export async function generateCancellationLetterLetterheadDocx(
  vehicles: Vehicle | Vehicle[],
  options: CancellationLetterOptions = {}
): Promise<Document> {
  const vList = Array.isArray(vehicles) ? vehicles : [vehicles];
  const comp = resolveVehicleDocxCompany(vList[0]);
  const dateObj = getCleanDate(options.letterDate);
  const formattedDate = formatDashDate(dateObj);
  const topMargin = options.leaveLetterheadSpace !== false ? convertInchesToTwip(2.2) : convertInchesToTwip(1.0);

  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Sr. #', bold: true, size: 20, font: calibriFont })] })],
        width: { size: 7, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Vehicle No.', bold: true, size: 20, font: calibriFont })] })],
        width: { size: 14, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Chassis No.', bold: true, size: 20, font: calibriFont })] })],
        width: { size: 17, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Engine No.', bold: true, size: 20, font: calibriFont })] })],
        width: { size: 17, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Maker', bold: true, size: 20, font: calibriFont })] })],
        width: { size: 11, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Model', bold: true, size: 20, font: calibriFont })] })],
        width: { size: 10, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MRA of Vehicle', bold: true, size: 20, font: calibriFont })] })],
        width: { size: 12, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Lease Expiry Date', bold: true, size: 20, font: calibriFont })] })],
        width: { size: 12, type: WidthType.PERCENTAGE },
        borders: tableBorders
      })
    ]
  });

  const tableDataRows = vList.map((v, idx) => {
    const { maker, model, mra } = extractVehicleFields(v);
    const leaseExp = v.validationExpiryDate
      ? formatDashDate(getCleanDate(v.validationExpiryDate))
      : formatDashDate(dateObj);

    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(idx + 1), bold: true, size: 20, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.registrationNumber || '-', bold: true, size: 20, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.chassisNo || '-', bold: true, size: 20, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: v.engineNo || '-', bold: true, size: 20, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: maker || '-', bold: true, size: 20, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(model || '-'), bold: true, size: 20, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: mra || '-', bold: true, size: 20, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: leaseExp, bold: true, size: 20, font: calibriFont })] })],
          borders: tableBorders
        })
      ]
    });
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: topMargin,
              bottom: convertInchesToTwip(1.0),
              left: convertInchesToTwip(0.95),
              right: convertInchesToTwip(0.95)
            }
          }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 260 },
            children: [
              new TextRun({ text: 'Date: ', bold: true, size: 22, font: calibriFont }),
              new TextRun({ text: formattedDate, bold: true, underline: {}, size: 22, font: calibriFont })
            ]
          }),
          new Paragraph({
            spacing: { line: 270, after: 280 },
            children: [
              new TextRun({ text: 'The Deputy Director,', bold: true, size: 22, font: calibriFont }),
              new TextRun({ text: 'Licensing of Bonded Carrier,', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: 'Directorate of Transit Trade,', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: 'Custom House,', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: 'Karachi.', bold: true, underline: {}, size: 22, font: calibriFont, break: 1 })
            ]
          }),
          new Paragraph({
            spacing: { before: 140, after: 220 },
            children: [
              new TextRun({ text: 'Subject:\t', bold: true, size: 22, font: calibriFont }),
              new TextRun({
                text: 'CANCELLATION OF REGISTERED VEHICLE FROM OUR PANEL',
                bold: true,
                underline: {},
                size: 22,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { after: 180 },
            children: [new TextRun({ text: 'Respected Sir,', bold: true, size: 22, font: calibriFont })]
          }),
          new Paragraph({
            spacing: { line: 280, after: 240 },
            children: [
              new TextRun({
                text: 'Reference to the above mentioned subject, this is to inform you that the contract agreement for the below mentioned vehicle gone cancelled. The details are listed as under',
                bold: true,
                size: 22,
                font: calibriFont
              })
            ]
          }),
          new Table({
            rows: [tableHeaderRow, ...tableDataRows],
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),
          new Paragraph({
            spacing: { before: 300, after: 280 },
            children: [
              new TextRun({
                text: 'Your usual cooperation in this regard would highly be appreciated.',
                bold: true,
                size: 22,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 270, after: 240 },
            children: [
              new TextRun({ text: 'Yours Faithfully,', bold: true, size: 22, font: calibriFont }),
              new TextRun({ text: '', break: 2 }),
              new TextRun({ text: '_________________________', bold: true, size: 22, font: calibriFont, break: 1 }),
              new TextRun({ text: `For: ${comp.signoffName}`, bold: true, size: 22, font: calibriFont, break: 1 })
            ]
          })
        ]
      }
    ]
  });
}

// ============================================================================
// 6. OFFICIAL VEHICLE NOC (.DOCX) — Unified to Exact 10-11-2026 Letterhead Format
// ============================================================================
export interface VehicleNocOptions {
  nocReference?: string;
  nocDate?: string | Date;
  reason?: string;
  leaveLetterheadSpace?: boolean;
  useStampPaperSpace?: boolean;
}

export async function generateVehicleNocDocx(
  vehicle: Vehicle,
  options: VehicleNocOptions = {}
): Promise<Document> {
  return generateCancellationLetterLetterheadDocx([vehicle], {
    letterDate: options.nocDate || vehicle.nocDate || new Date(),
    leaveLetterheadSpace: options.leaveLetterheadSpace !== false
  });
}

// ============================================================================
// 7. AFFIDAVIT (STAMP PAPER — Exact 1:1 Reproduction of Uploaded Affidavit)
// ============================================================================
export interface AffidavitOptions {
  letterDate?: string | Date;
  leaveStampPaperSpace?: boolean;
}

export async function generateAffidavitDocx(
  vehicles: Vehicle | Vehicle[],
  options: AffidavitOptions = {}
): Promise<Document> {
  const vList = Array.isArray(vehicles) ? vehicles : [vehicles];
  const firstV = vList[0] || ({} as Vehicle);
  const comp = resolveVehicleDocxCompany(firstV);
  const { owner, ownerCnic } = extractVehicleFields(firstV);
  const topMargin = options.leaveStampPaperSpace !== false ? convertInchesToTwip(3.4) : convertInchesToTwip(0.95);

  const tableHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: 'Vehicles No.', bold: true, size: 22, font: calibriFont })] })],
        width: { size: 34, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: 'Chassis No.', bold: true, size: 22, font: calibriFont })] })],
        width: { size: 33, type: WidthType.PERCENTAGE },
        borders: tableBorders
      }),
      new TableCell({
        children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: 'Engine No.', bold: true, size: 22, font: calibriFont })] })],
        width: { size: 33, type: WidthType.PERCENTAGE },
        borders: tableBorders
      })
    ]
  });

  const tableDataRows = vList.map((v) => {
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 }, children: [new TextRun({ text: v.registrationNumber || '-', bold: true, size: 23, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 }, children: [new TextRun({ text: v.chassisNo || '-', bold: true, size: 23, font: calibriFont })] })],
          borders: tableBorders
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 }, children: [new TextRun({ text: v.engineNo || '-', bold: true, size: 23, font: calibriFont })] })],
          borders: tableBorders
        })
      ]
    });
  });

  const signWitnessTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 55, type: WidthType.PERCENTAGE },
            borders: noBorders,
            children: [
              new Paragraph({
                spacing: { before: 80, after: 40 },
                children: [new TextRun({ text: 'LESSOR ', bold: true, underline: {}, size: 21, font: calibriFont })]
              }),
              ...(owner || ownerCnic
                ? [
                    new Paragraph({
                      spacing: { after: 20 },
                      children: [new TextRun({ text: owner ? owner.toUpperCase() : '', bold: true, size: 19, font: calibriFont })]
                    }),
                    new Paragraph({
                      spacing: { after: 140 },
                      children: [new TextRun({ text: ownerCnic ? `CNIC: ${ownerCnic}` : '', bold: true, size: 19, font: calibriFont })]
                    })
                  ]
                : [
                    new Paragraph({
                      spacing: { after: 200 },
                      children: [new TextRun({ text: '', size: 20, font: calibriFont })]
                    })
                  ]),
              new Paragraph({
                spacing: { before: 80, after: 20 },
                children: [new TextRun({ text: '1.Witness_____________________', bold: true, size: 21, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { after: 160 },
                children: [
                  new TextRun({
                    text: `${DOCKS_COMPANY.witnesses.w1_arbaz.name} (${DOCKS_COMPANY.witnesses.w1_arbaz.cnic})`,
                    bold: true,
                    size: 18,
                    font: calibriFont
                  })
                ]
              }),
              new Paragraph({
                spacing: { before: 80, after: 20 },
                children: [new TextRun({ text: '2.Witness_____________________', bold: true, size: 21, font: calibriFont })]
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${DOCKS_COMPANY.witnesses.w2_shams.name} (${DOCKS_COMPANY.witnesses.w2_shams.cnic})`,
                    bold: true,
                    size: 18,
                    font: calibriFont
                  })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 45, type: WidthType.PERCENTAGE },
            borders: noBorders,
            children: [
              new Paragraph({
                spacing: { before: 80, after: 220 },
                children: [new TextRun({ text: 'LESSEES', bold: true, underline: {}, size: 21, font: calibriFont })]
              }),
              new Paragraph({
                spacing: { before: 100 },
                children: [new TextRun({ text: '_________________________', bold: true, size: 21, font: calibriFont })]
              })
            ]
          })
        ]
      })
    ]
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: topMargin,
              bottom: convertInchesToTwip(0.75),
              left: convertInchesToTwip(0.85),
              right: convertInchesToTwip(0.85)
            }
          }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 260 },
            children: [
              new TextRun({
                text: 'AFFIDAVIT',
                bold: true,
                underline: {},
                size: 28,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 280, after: 220 },
            children: [
              new TextRun({
                text: `In consideration of your allowing registration of vehicles for carrying transshipment of import bonded cargo to up country dry port as prescribe vide chapter XIV of SRO 450 (I) 201 dated 18.06.2011 as provided under sub-rule (5) of rule 329 read with Sub –rule (7) of Rule 328 of Customs Rule 2001. We M/S ${comp.legalCaps}, and do hereby undertake that vehicles registered in our name will not be used by another bonded carrier during registration period 5 Years and that all vehicles (Trailer not prime mover) leased, owned shall be indelibly painted from four sides with color and clearly indicating name of the carrier and further that We shall be responsible for any discrepancy which arises subsequently in this regard.`,
                bold: true,
                size: 21,
                font: calibriFont
              })
            ]
          }),
          new Paragraph({
            spacing: { line: 280, after: 240 },
            children: [
              new TextRun({
                text: 'Further more, it is also added that after dispatch of vehicle loaded with cargo from port, however the driver of vehicle is custodian of the loaded cargo as well as his employer i.e. owner of the vehicle will be responsible destined for delivery.',
                bold: true,
                size: 21,
                font: calibriFont
              })
            ]
          }),
          new Table({
            rows: [tableHeaderRow, ...tableDataRows],
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),
          new Paragraph({
            indent: { left: convertInchesToTwip(3.6) },
            spacing: { before: 300, after: 320 },
            children: [
              new TextRun({
                text: `FOR. ${comp.legalCaps}`,
                bold: true,
                size: 22,
                font: calibriFont
              })
            ]
          }),
          signWitnessTable
        ]
      }
    ]
  });
}

// ============================================================================
// 8. SUPPORTING REGISTRATION / RENEWAL COPY SHEETS (.DOCX):
//    - Vehicle Registration Book Copy
//    - Vehicle Owner ID Card (CNIC) Copy
//    - Company Owner / Director ID Card (CNIC) Copy
//    - Standard Witnesses ID Card (CNIC) Copy
// ============================================================================

async function convertDataUrlToPngImages(
  dataUrl: string,
  maxWidthPx: number = 560,
  maxHeightPx: number = 640
): Promise<Array<{ data: Uint8Array; width: number; height: number }>> {
  if (!dataUrl || !dataUrl.includes(',')) return [];

  // Handle PDF dataUrls by rendering pages to PNG via pdfjs-dist
  if (dataUrl.startsWith('data:application/pdf')) {
    try {
      const pdfjsLib: any = await import('pdfjs-dist');
      if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '3.11.174'}/pdf.worker.min.js`;
      }
      const b64 = dataUrl.split(',')[1];
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const pageCount = Math.min(pdf.numPages || 1, 3);
      const rendered: Array<{ data: Uint8Array; width: number; height: number }> = [];
      for (let p = 1; p <= pageCount; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1.8 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport }).promise;
          const pngDataUrl = canvas.toDataURL('image/png');
          const single = await convertSingleImageDataUrl(pngDataUrl, maxWidthPx, maxHeightPx);
          if (single) rendered.push(single);
        }
      }
      return rendered;
    } catch (err) {
      console.warn('PDF rasterization fallback in docx copy generator:', err);
      return [];
    }
  }

  const single = await convertSingleImageDataUrl(dataUrl, maxWidthPx, maxHeightPx);
  return single ? [single] : [];
}

async function convertSingleImageDataUrl(
  dataUrl: string,
  maxWidthPx: number,
  maxHeightPx: number
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const natW = img.naturalWidth || 800;
          const natH = img.naturalHeight || 600;
          const canvas = document.createElement('canvas');
          canvas.width = natW;
          canvas.height = natH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, natW, natH);
          ctx.drawImage(img, 0, 0, natW, natH);
          const pngUrl = canvas.toDataURL('image/png');
          const b64 = pngUrl.split(',')[1];
          const bin = atob(b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);

          const scale = Math.min(maxWidthPx / natW, maxHeightPx / natH, 1);
          resolve({
            data: arr,
            width: Math.max(120, Math.round(natW * scale)),
            height: Math.max(80, Math.round(natH * scale))
          });
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch (_) {
      resolve(null);
    }
  });
}

function buildVehicleAttachmentHeaderBlock(vehicle: Vehicle, docHeading: string, subTitle?: string): (Paragraph | Table)[] {
  const comp = resolveVehicleDocxCompany(vehicle);
  const { maker, model, mra, owner, ownerCnic } = extractVehicleFields(vehicle);

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: docHeading.toUpperCase(), bold: true, underline: {}, size: 26, font: calibriFont })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [
        new TextRun({
          text: subTitle || `Registered Panel Carrier: ${comp.signoffName} (NTN: ${comp.ntn})`,
          bold: true,
          size: 20,
          font: calibriFont
        })
      ]
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: tableBorders,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Vehicle No: ${vehicle.registrationNumber || '-'}`, bold: true, size: 19, font: calibriFont })] })]
            }),
            new TableCell({
              borders: tableBorders,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Chassis No: ${vehicle.chassisNo || '-'}`, bold: true, size: 19, font: calibriFont })] })]
            }),
            new TableCell({
              borders: tableBorders,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Engine No: ${vehicle.engineNo || '-'}`, bold: true, size: 19, font: calibriFont })] })]
            })
          ]
        }),
        new TableRow({
          children: [
            new TableCell({
              borders: tableBorders,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Make / Model: ${maker || '-'} ${model || ''}`, bold: true, size: 18, font: calibriFont })] })]
            }),
            new TableCell({
              borders: tableBorders,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `MRA: ${mra || '-'}`, bold: true, size: 18, font: calibriFont })] })]
            }),
            new TableCell({
              borders: tableBorders,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: `Owner: ${owner ? owner.toUpperCase() : '-'}${ownerCnic ? ` (${ownerCnic})` : ''}`,
                      bold: true,
                      size: 18,
                      font: calibriFont
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]
    }),
    new Paragraph({ spacing: { after: 180 }, children: [] })
  ];
}

export async function generateVehicleBookCopyDocx(vehicle: Vehicle): Promise<Document> {
  const images = vehicle.registrationBook ? await convertDataUrlToPngImages(vehicle.registrationBook, 580, 660) : [];

  const bodyChildren: (Paragraph | Table)[] = [
    ...buildVehicleAttachmentHeaderBlock(vehicle, 'COPY OF VEHICLE REGISTRATION BOOK')
  ];

  if (images.length > 0) {
    images.forEach((img) => {
      bodyChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 160 },
          children: [
            new ImageRun({
              type: 'png',
              data: img.data,
              transformation: { width: img.width, height: img.height }
            })
          ]
        })
      );
    });
  } else {
    bodyChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: tableBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 1400, after: 1400 },
                    children: [
                      new TextRun({
                        text: '[ ATTACH / PASTE VEHICLE REGISTRATION BOOK COPY HERE — OR UPLOAD IN VEHICLE FORM ]',
                        bold: true,
                        size: 20,
                        font: calibriFont
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    );
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.7),
              bottom: convertInchesToTwip(0.7),
              left: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.75)
            }
          }
        },
        children: bodyChildren
      }
    ]
  });
}

export async function generateVehicleOwnerIdCopyDocx(vehicle: Vehicle): Promise<Document> {
  const { owner, ownerFather, ownerCnic, ownerAddress } = extractVehicleFields(vehicle);
  const images = vehicle.ownerIdCardUrl ? await convertDataUrlToPngImages(vehicle.ownerIdCardUrl, 520, 560) : [];

  const bodyChildren: (Paragraph | Table)[] = [
    ...buildVehicleAttachmentHeaderBlock(
      vehicle,
      'COPY OF VEHICLE OWNER ID CARD (CNIC)',
      owner ? `Vehicle Owner (Lessor): ${owner.toUpperCase()}${ownerFather ? ` S/O ${ownerFather.toUpperCase()}` : ''}${ownerCnic ? ` — CNIC: ${ownerCnic}` : ''}` : undefined
    )
  ];

  if (ownerAddress) {
    bodyChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 140 },
        children: [new TextRun({ text: `Owner Address: ${ownerAddress.toUpperCase()}`, bold: true, size: 19, font: calibriFont })]
      })
    );
  }

  if (images.length > 0) {
    images.forEach((img) => {
      bodyChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 160 },
          children: [
            new ImageRun({
              type: 'png',
              data: img.data,
              transformation: { width: img.width, height: img.height }
            })
          ]
        })
      );
    });
  } else {
    bodyChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: tableBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 1100, after: 1100 },
                    children: [
                      new TextRun({
                        text: '[ ATTACH / PASTE VEHICLE OWNER CNIC (FRONT & BACK) COPY HERE — OR UPLOAD IN VEHICLE FORM ]',
                        bold: true,
                        size: 20,
                        font: calibriFont
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    );
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.7),
              bottom: convertInchesToTwip(0.7),
              left: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.75)
            }
          }
        },
        children: bodyChildren
      }
    ]
  });
}

export interface CompanyOwnerIdCopyOptions {
  companyOwnerName?: string;
  companyOwnerCnic?: string;
  frontImageUrl?: string;
  backImageUrl?: string;
}

export async function generateCompanyOwnerIdCopyDocx(
  vehicle: Vehicle,
  options: CompanyOwnerIdCopyOptions = {}
): Promise<Document> {
  const comp = resolveVehicleDocxCompany(vehicle);
  const frontImgs = options.frontImageUrl ? await convertDataUrlToPngImages(options.frontImageUrl, 480, 310) : [];
  const backImgs = options.backImageUrl ? await convertDataUrlToPngImages(options.backImageUrl, 480, 310) : [];

  const bodyChildren: (Paragraph | Table)[] = [
    ...buildVehicleAttachmentHeaderBlock(
      vehicle,
      'COPY OF COMPANY OWNER / DIRECTOR ID CARD (CNIC)',
      `${comp.signoffName} — NTN: ${comp.ntn} / Customs ID: ${comp.customsNtn}`
    )
  ];

  if (options.companyOwnerName || options.companyOwnerCnic) {
    bodyChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 140 },
        children: [
          new TextRun({
            text: `Director / Company Owner: ${(options.companyOwnerName || '').toUpperCase()}${options.companyOwnerCnic ? ` — CNIC: ${options.companyOwnerCnic}` : ''}`,
            bold: true,
            size: 20,
            font: calibriFont
          })
        ]
      })
    );
  }

  if (frontImgs.length > 0 || backImgs.length > 0) {
    [...frontImgs, ...backImgs].forEach((img) => {
      bodyChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 140 },
          children: [
            new ImageRun({
              type: 'png',
              data: img.data,
              transformation: { width: img.width, height: img.height }
            })
          ]
        })
      );
    });
  } else {
    bodyChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: tableBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 900, after: 900 },
                    children: [
                      new TextRun({
                        text: `[ COMPANY OWNER / DIRECTOR CNIC COPY FOR ${comp.signoffName} — UPLOAD ONCE IN REGISTRATION PACK OR PASTE HERE ]`,
                        bold: true,
                        size: 20,
                        font: calibriFont
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    );
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.7),
              bottom: convertInchesToTwip(0.7),
              left: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.75)
            }
          }
        },
        children: bodyChildren
      }
    ]
  });
}

export interface WitnessesIdCopyOptions {
  witness1ImageUrl?: string;
  witness2ImageUrl?: string;
  witness1Name?: string;
  witness1Cnic?: string;
  witness2Name?: string;
  witness2Cnic?: string;
}

export async function generateWitnessesIdCopyDocx(
  vehicle: Vehicle,
  options: WitnessesIdCopyOptions = {}
): Promise<Document> {
  const w1Name = options.witness1Name || DOCKS_COMPANY.witnesses.w1_arbaz.name;
  const w1Cnic = options.witness1Cnic || DOCKS_COMPANY.witnesses.w1_arbaz.cnic;
  const w2Name = options.witness2Name || DOCKS_COMPANY.witnesses.w2_shams.name;
  const w2Cnic = options.witness2Cnic || DOCKS_COMPANY.witnesses.w2_shams.cnic;

  const w1Imgs = options.witness1ImageUrl ? await convertDataUrlToPngImages(options.witness1ImageUrl, 470, 295) : [];
  const w2Imgs = options.witness2ImageUrl ? await convertDataUrlToPngImages(options.witness2ImageUrl, 470, 295) : [];

  const bodyChildren: (Paragraph | Table)[] = [
    ...buildVehicleAttachmentHeaderBlock(vehicle, 'COPIES OF WITNESSES ID CARDS (CNIC)'),
    new Paragraph({
      spacing: { before: 60, after: 80 },
      children: [
        new TextRun({
          text: `Witness 1: ${w1Name} — CNIC NO. ${w1Cnic}`,
          bold: true,
          underline: {},
          size: 21,
          font: calibriFont
        })
      ]
    })
  ];

  if (w1Imgs.length > 0) {
    w1Imgs.forEach((img) => {
      bodyChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 140 },
          children: [
            new ImageRun({
              type: 'png',
              data: img.data,
              transformation: { width: img.width, height: img.height }
            })
          ]
        })
      );
    });
  } else {
    bodyChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: tableBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 520, after: 520 },
                    children: [
                      new TextRun({
                        text: `[ WITNESS 1 CNIC COPY: ${w1Name} (${w1Cnic}) ]`,
                        bold: true,
                        size: 19,
                        font: calibriFont
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    );
  }

  bodyChildren.push(
    new Paragraph({
      spacing: { before: 180, after: 80 },
      children: [
        new TextRun({
          text: `Witness 2: ${w2Name} — CNIC NO. ${w2Cnic}`,
          bold: true,
          underline: {},
          size: 21,
          font: calibriFont
        })
      ]
    })
  );

  if (w2Imgs.length > 0) {
    w2Imgs.forEach((img) => {
      bodyChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [
            new ImageRun({
              type: 'png',
              data: img.data,
              transformation: { width: img.width, height: img.height }
            })
          ]
        })
      );
    });
  } else {
    bodyChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: tableBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 520, after: 520 },
                    children: [
                      new TextRun({
                        text: `[ WITNESS 2 CNIC COPY: ${w2Name} (${w2Cnic}) ]`,
                        bold: true,
                        size: 19,
                        font: calibriFont
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    );
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.65),
              bottom: convertInchesToTwip(0.65),
              left: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.75)
            }
          }
        },
        children: bodyChildren
      }
    ]
  });
}

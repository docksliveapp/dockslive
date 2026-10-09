import * as XLSX from 'xlsx';
import { Vehicle } from '../types';
import { getActiveCompany, getActiveCompanyPrefix } from './companyService';

export interface GeneralLedgerExportItem {
  date: string;
  party: string;
  category?: string;
  reference?: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface ClientLedgerExportItem {
  date: string;
  reference?: string;
  party: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

/**
 * Exports General Ledger into a professional Microsoft Excel (.xlsx) workbook
 */
export function exportGeneralLedgerToExcel(
  entries: GeneralLedgerExportItem[],
  summary: { totalDebits: number; totalCredits: number; netBalance: number },
  accountFilter: string = 'ALL'
) {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().split('T')[0];

  const activeComp = getActiveCompany();
  const prefix = getActiveCompanyPrefix();
  const compTitle = (activeComp.legalTitle || activeComp.name).toUpperCase();

  // Title and metadata block with luxury business-class executive layout
  const sheetData: any[][] = [
    [`${compTitle}`],
    [activeComp.tagline || 'Customs Bonded Carrier • Afghan Transit Trade • International Freight Forwarding'],
    [`Head Office: ${activeComp.address || 'Office No. 14-B, 1st Floor, State Life Bldg No. 7, G-Allana Road Tower, Karachi'}`],
    [`Tel: ${activeComp.phone || '+92-21-32330103, +92-21-32330104'} | Email: ${activeComp.email || 'info@dockspk.com'} | Web: ${activeComp.web || 'www.dockspk.com'}`],
    [`Customs NTN: ${activeComp.id === 'docks' ? '5064083-8' : '3997968'} | Customs Bonded License: Karachi Custom House`],
    [],
    ['OFFICIAL GENERAL LEDGER STATEMENT (AUDIT RECORD)'],
    [`Generated Date: ${today}`, `Filter Scope: ${accountFilter}`, `Classification: Official Reconciled Record`],
    [], // Blank separator
    [
      'Date',
      'Account / Party Name',
      'Account Category',
      'Reference / Voucher',
      'Transaction Description',
      'Debit Incurred (PKR)',
      'Credit Received (PKR)',
      'Cumulative Balance (PKR)'
    ]
  ];

  // Data rows
  entries.forEach((item) => {
    sheetData.push([
      item.date || '',
      item.party || '',
      item.category || '',
      item.reference || '',
      item.description || '',
      Number(item.debit || 0),
      Number(item.credit || 0),
      Number(item.balance || 0)
    ]);
  });

  // Summary Totals Row
  sheetData.push([]);
  sheetData.push([
    'TOTAL SUMMARY',
    '',
    '',
    '',
    'Cumulative Financial Position',
    Number(summary.totalDebits || 0),
    Number(summary.totalCredits || 0),
    Number(summary.netBalance || 0)
  ]);

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Set explicit, generous column widths so no text is truncated in Excel
  ws['!cols'] = [
    { wch: 14 }, // Date
    { wch: 34 }, // Account / Party Name
    { wch: 24 }, // Category
    { wch: 22 }, // Reference
    { wch: 42 }, // Description
    { wch: 20 }, // Debit
    { wch: 20 }, // Credit
    { wch: 24 }  // Balance
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'General Ledger');

  // Also create a Summary Sheet
  const summarySheetData: any[][] = [
    [`${compTitle} - FINANCIAL METRICS SUMMARY`],
    [`Statement Period as of: ${today}`],
    [],
    ['Metric Description', 'Amount (PKR)'],
    ['Total Debits (Receivables, Charges & Payables Outflow)', Number(summary.totalDebits || 0)],
    ['Total Credits (Direct Inflows & Payments Received)', Number(summary.totalCredits || 0)],
    ['Net Outstanding / Closing Balance', Number(summary.netBalance || 0)],
    ['Total Number of Transactions Logged', entries.length]
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summarySheetData);
  wsSummary['!cols'] = [
    { wch: 55 },
    { wch: 25 }
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ledger Overview');

  const cleanFilter = accountFilter.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `General_Ledger_${prefix}_${cleanFilter}_${today}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/**
 * Exports Client Statement / Ledger into a professional Microsoft Excel (.xlsx) workbook
 */
export function exportClientLedgerToExcel(
  clientName: string,
  entries: ClientLedgerExportItem[],
  summary: { totalDebits: number; totalCredits: number; netBalance: number }
) {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().split('T')[0];

  const activeComp = getActiveCompany();
  const prefix = getActiveCompanyPrefix();
  const compTitle = (activeComp.legalTitle || activeComp.name).toUpperCase();

  const sheetData: any[][] = [
    [`${compTitle}`],
    [activeComp.tagline || 'Customs Bonded Carrier • Afghan Transit Trade • International Freight Forwarding'],
    [`Registered Office: ${activeComp.address || 'Office No. 14-B, 1st Floor, State Life Bldg No. 7, G-Allana Road Tower, Karachi'}`],
    [`Contact: ${activeComp.phone || '+92-21-32330103'} | Web: ${activeComp.web || 'www.dockspk.com'} | Email: ${activeComp.email || 'info@dockspk.com'}`],
    [],
    [`OFFICIAL CLIENT STATEMENT OF ACCOUNT - ${clientName.toUpperCase()}`],
    [`Client / Account Name: ${clientName}`, `Statement Date: ${today}`, `Verification: Official Reconciled Balance`],
    [],
    [
      'Date',
      'Reference / Invoice / Case',
      'Client / Account',
      'Transaction Details',
      'Charges / Invoiced (Debit PKR)',
      'Paid / Received (Credit PKR)',
      'Current Ledger Balance (PKR)'
    ]
  ];

  entries.forEach((item) => {
    sheetData.push([
      item.date || '',
      item.reference || '',
      item.party || clientName,
      item.description || '',
      Number(item.debit || 0),
      Number(item.credit || 0),
      Number(item.balance || 0)
    ]);
  });

  sheetData.push([]);
  sheetData.push([
    'CLOSING TOTALS',
    '',
    '',
    'Reconciled Account Balance',
    Number(summary.totalDebits || 0),
    Number(summary.totalCredits || 0),
    Number(summary.netBalance || 0)
  ]);

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 14 }, // Date
    { wch: 28 }, // Reference
    { wch: 32 }, // Client
    { wch: 42 }, // Details
    { wch: 22 }, // Invoiced (Debit)
    { wch: 22 }, // Paid (Credit)
    { wch: 26 }  // Balance
  ];

  const safeClient = clientName.slice(0, 25).replace(/[^a-zA-Z0-9]/g, '_');
  XLSX.utils.book_append_sheet(wb, ws, `${safeClient} Statement`);

  const filename = `Client_Statement_${prefix}_${safeClient}_${today}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/**
 * Exports Vehicles Master List to native Excel (.xlsx)
 */
export function exportVehiclesToExcel(vehicles: Vehicle[]) {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().split('T')[0];
  const activeComp = getActiveCompany();
  const prefix = getActiveCompanyPrefix();
  const compTitle = (activeComp.legalTitle || activeComp.name).toUpperCase();

  const headers = [
    'Sr No',
    'Vehicle Registration Number',
    `${prefix} Serial No`,
    'Category',
    'Type',
    'Size',
    'Weight Capacity',
    'Engine Number',
    'Chassis Number',
    'Transporter / Fleet Owner',
    'Broker Name',
    'Driver Name',
    'Driver CNIC',
    'Driver Contact',
    'Registration Date',
    'Validity Expiry Date',
    'Tracking Status',
    'Current Trip Status'
  ];

  const sheetData: any[][] = [
    [`${compTitle}`],
    [activeComp.tagline || 'Customs Bonded Carrier • Bonded Fleet Registry • Directorate General of Transit Trade'],
    [`Operations: ${activeComp.address || 'Office No. 14-B, 1st Floor, State Life Bldg No. 7, G-Allana Road Tower, Karachi'}`],
    [`Contact: ${activeComp.phone || '+92-21-32330103'} | Web: ${activeComp.web || 'www.dockspk.com'}`],
    [],
    ['PAKISTAN CUSTOMS BONDED FLEET - MASTER VEHICLE REGISTRY'],
    [`Export Date: ${today}`, `Total Vehicles Active: ${vehicles.length}`, `Status: Customs Transit Approved Fleet`],
    [],
    headers
  ];

  vehicles.forEach((v, idx) => {
    sheetData.push([
      idx + 1,
      v.registrationNumber || '',
      v.dplSerial || '',
      v.category || '',
      v.type || '',
      v.size || '',
      v.weightCapacity || '',
      v.engineNo || '',
      v.chassisNo || '',
      v.transporterName || '',
      v.brokerName || v.transporterName || '',
      v.driverName || '',
      v.driverCnic || '',
      v.driverContact || '',
      v.createdAt || '',
      v.validationExpiryDate || '',
      v.isOnline ? 'Online At Station' : 'Offline',
      v.status || 'AVAILABLE'
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 8 },  // Sr
    { wch: 22 }, // Reg No
    { wch: 22 }, // DPL Serial
    { wch: 18 }, // Category
    { wch: 16 }, // Type
    { wch: 12 }, // Size
    { wch: 18 }, // Weight
    { wch: 20 }, // Engine
    { wch: 20 }, // Chassis
    { wch: 30 }, // Transporter
    { wch: 26 }, // Broker
    { wch: 24 }, // Driver
    { wch: 20 }, // Driver CNIC
    { wch: 18 }, // Driver Contact
    { wch: 16 }, // Reg Date
    { wch: 18 }, // Expiry Date
    { wch: 18 }, // Tracking
    { wch: 18 }  // Status
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Fleet Master');
  XLSX.writeFile(wb, `${prefix}_Master_Vehicles_Fleet_${today}.xlsx`);
}

/**
 * Generates the raw Excel (.xlsx) buffer and filename for read-only preview before downloading
 */
export function generateVehiclesExcelBuffer(vehicles: Vehicle[]): { buffer: ArrayBuffer; filename: string } {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().split('T')[0];
  const activeComp = getActiveCompany();
  const prefix = getActiveCompanyPrefix();
  const compTitle = (activeComp.legalTitle || activeComp.name).toUpperCase();

  const headers = [
    'Sr No',
    'Vehicle Registration Number',
    `${prefix} Serial No`,
    'Category',
    'Type',
    'Size',
    'Weight Capacity',
    'Engine Number',
    'Chassis Number',
    'Transporter / Fleet Owner',
    'Broker Name',
    'Driver Name',
    'Driver CNIC',
    'Driver Contact',
    'Registration Date',
    'Validity Expiry Date',
    'Tracking Status',
    'Current Trip Status'
  ];

  const sheetData: any[][] = [
    [`${compTitle}`],
    [activeComp.tagline || 'Customs Bonded Carrier • Bonded Fleet Registry • Directorate General of Transit Trade'],
    [`Operations: ${activeComp.address || 'Office No. 14-B, 1st Floor, State Life Bldg No. 7, G-Allana Road Tower, Karachi'}`],
    [`Contact: ${activeComp.phone || '+92-21-32330103'} | Web: ${activeComp.web || 'www.dockspk.com'}`],
    [],
    ['PAKISTAN CUSTOMS BONDED FLEET - MASTER VEHICLE REGISTRY'],
    [`Export Date: ${today}`, `Total Vehicles Active: ${vehicles.length}`, `Status: Customs Transit Approved Fleet`],
    [],
    headers
  ];

  vehicles.forEach((v, idx) => {
    sheetData.push([
      idx + 1,
      v.registrationNumber || '',
      v.dplSerial || '',
      v.category || '',
      v.type || '',
      v.size || '',
      v.weightCapacity || '',
      v.engineNo || '',
      v.chassisNo || '',
      v.transporterName || '',
      v.brokerName || '',
      v.driverName || '',
      v.driverCnic || '',
      v.driverContact || '',
      v.registrationDate || '',
      v.validationExpiryDate || '',
      v.tracker ? `${v.tracker.provider} (${v.tracker.paymentStatus})` : 'Unassigned',
      v.status || ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 8 },  // Sr
    { wch: 22 }, // Reg No
    { wch: 22 }, // DPL Serial
    { wch: 18 }, // Category
    { wch: 16 }, // Type
    { wch: 12 }, // Size
    { wch: 18 }, // Weight
    { wch: 20 }, // Engine
    { wch: 20 }, // Chassis
    { wch: 30 }, // Transporter
    { wch: 26 }, // Broker
    { wch: 24 }, // Driver
    { wch: 20 }, // Driver CNIC
    { wch: 18 }, // Driver Contact
    { wch: 16 }, // Reg Date
    { wch: 18 }, // Expiry Date
    { wch: 18 }, // Tracking
    { wch: 18 }  // Status
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Fleet Master');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const filename = `${prefix}_Master_Vehicles_Fleet_${today}.xlsx`;

  return { buffer, filename };
}

/**
 * Generates and downloads a clean Excel template (.xlsx) for Bulk Vehicle Import
 */
export function downloadBulkVehicleExcelTemplate() {
  const wb = XLSX.utils.book_new();

  const sampleRows: any[][] = [
    [
      'Vehicle Registration Number',
      'Category (Bonded Carrier / Afghan Transit / TIR / Local Fleet)',
      'Vehicle Type (Flatbed / Lowbed / Container Carrier / Box Truck)',
      'Vehicle Size (20ft / 40ft / 45ft / Loose)',
      'Weight Capacity (e.g. 35 Ton / 40 Ton)',
      'Engine Number',
      'Chassis Number',
      'Transporter / Company Name',
      'Broker Name',
      'Validity Expiry Date (YYYY-MM-DD)'
    ],
    [
      'TLP-101',
      'Bonded Carrier',
      'Flatbed',
      '40ft',
      '40 Ton',
      'ENG-99881',
      'CHS-44332',
      'Al-Madina Goods Transport',
      'Haji Aslam Broker',
      '2026-12-31'
    ],
    [
      'KBL-505',
      'Afghan Transit',
      'Lowbed',
      '45ft',
      '45 Ton',
      'ENG-55443',
      'CHS-88771',
      'Khyber Logistics',
      'Khyber Logistics',
      '2026-11-30'
    ],
    [
      'TIR-808',
      'TIR',
      'Container Carrier',
      '40ft',
      '38 Ton',
      'ENG-11223',
      'CHS-99001',
      'Indus International',
      'Direct Fleet',
      '2027-01-15'
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 26 },
    { wch: 22 },
    { wch: 20 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 30 },
    { wch: 26 },
    { wch: 24 }
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Vehicle Import Template');
  XLSX.writeFile(wb, 'DPL_Bulk_Vehicle_Registration_Template.xlsx');
}

/**
 * Generic function to export tabular data directly into a Microsoft Excel (.xlsx) file
 */
export function exportTableToExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: (string | number | undefined | null)[][],
  columnWidths?: number[]
): void {
  const wb = XLSX.utils.book_new();
  const cleanRows = rows.map(r => r.map(val => (val === undefined || val === null ? '' : val)));
  const data = [headers, ...cleanRows];
  const ws = XLSX.utils.aoa_to_sheet(data);

  if (columnWidths && columnWidths.length > 0) {
    ws['!cols'] = columnWidths.map(w => ({ wch: w }));
  } else {
    // Auto-compute column widths based on maximum cell lengths
    const colWidths = headers.map((header, colIdx) => {
      let maxLen = String(header).length;
      for (const row of cleanRows) {
        const cellLen = String(row[colIdx] || '').length;
        if (cellLen > maxLen) maxLen = cellLen;
      }
      return { wch: Math.min(Math.max(maxLen + 3, 12), 45) };
    });
    ws['!cols'] = colWidths;
  }

  const cleanSheetName = (sheetName || 'Data').slice(0, 31).replace(/[:\\\/\?\*\[\]]/g, '_');
  XLSX.utils.book_append_sheet(wb, ws, cleanSheetName);

  const cleanFilename = filename.toLowerCase().endsWith('.xlsx')
    ? filename
    : `${filename.replace(/\.csv$/i, '')}.xlsx`;

  XLSX.writeFile(wb, cleanFilename);
}

/**
 * Exports vehicle trips history to a formatted Microsoft Excel (.xlsx) file
 */
export function exportVehicleTripsToExcel(
  vehicleReg: string,
  trips: Array<{
    date: string;
    containerNumber: string;
    driverName: string;
    importerName: string;
    clientName: string;
    status: string;
  }>
): void {
  const headers = [
    'Trip Date',
    'Container Number',
    'Driver Name',
    'Importer / Consignee',
    'Client Name',
    'Trip Status'
  ];
  const rows = trips.map(t => [
    t.date || '',
    t.containerNumber || '',
    t.driverName || '',
    t.importerName || '',
    t.clientName || '',
    t.status || ''
  ]);
  const filename = `${vehicleReg.replace(/[^a-zA-Z0-9_-]/g, '_')}_trips_${new Date().toISOString().split('T')[0]}.xlsx`;
  exportTableToExcel(filename, 'Vehicle Trips', headers, rows, [15, 20, 22, 28, 25, 18]);
}

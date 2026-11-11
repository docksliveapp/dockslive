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
    'VEHICLE NO.',
    'CHASSIS NO.',
    'ENGINE NO.',
    'MAKER',
    'MODEL',
    'TRANSPORTER NAME',
    'BROKER NAME',
    'REGISTRATION DATE',
    'VALIDITY EXPIRY (6 MONTHS)',
    'COMPANY',
    'CUSTOMS 6M STATUS',
    'REG BOOK',
    'OWNER ID CARD',
    'DRIVER NAME',
    'DRIVER CNIC',
    'DRIVER CONTACT',
    'TRIPS COUNT'
  ];

  const sheetData: any[][] = [
    [`${compTitle}`],
    [activeComp.tagline || 'Customs Bonded Carrier • Bonded Fleet Registry • Directorate General of Transit Trade'],
    [`Operations: ${activeComp.address || 'Office No. 14-B, 1st Floor, State Life Bldg No. 7, G-Allana Road Tower, Karachi'}`],
    [`Contact: ${activeComp.phone || '+92-21-32330103'} | Web: ${activeComp.web || 'www.dockspk.com'}`],
    [],
    ['PAKISTAN CUSTOMS BONDED FLEET - MASTER VEHICLE REGISTRY (SHARED DATABASE)'],
    [`Export Date: ${today}`, `Total Vehicles: ${vehicles.length}`, `Customs Rule: 6-Month Registration Validity`],
    [],
    headers
  ];

  vehicles.forEach((v, idx) => {
    const transporter = v.transporterName || v.brokerName || '';
    const companyDisplay = v.companyName || (v.operatingCompany === 'truckit' ? 'TRUCKIT PVT LTD' : v.operatingCompany === 'docks' ? 'DOCKS PVT LTD' : (v.operatingCompany || 'TRUCKIT PVT LTD').toUpperCase());
    sheetData.push([
      idx + 1,
      v.registrationNumber || '',
      v.chassisNo || '',
      v.engineNo || '',
      v.make || '',
      v.model || '',
      transporter,
      transporter,
      v.registrationDate || '',
      v.validationExpiryDate || '',
      companyDisplay,
      v.status || 'AVAILABLE',
      v.registrationBook ? 'Uploaded' : 'Missing',
      v.ownerIdCardUrl ? 'Uploaded' : 'Missing',
      v.driverName || '',
      v.driverCnic || '',
      v.driverContact || '',
      (v.tripsHistory || []).length
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 8 },  // Sr
    { wch: 20 }, // VEHICLE NO.
    { wch: 24 }, // CHASSIS NO.
    { wch: 20 }, // ENGINE NO.
    { wch: 16 }, // MAKER
    { wch: 14 }, // MODEL
    { wch: 30 }, // TRANSPORTER NAME
    { wch: 30 }, // BROKER NAME
    { wch: 18 }, // REGISTRATION DATE
    { wch: 22 }, // VALIDITY EXPIRY
    { wch: 22 }, // COMPANY
    { wch: 18 }, // STATUS
    { wch: 14 }, // REG BOOK
    { wch: 16 }, // OWNER ID
    { wch: 22 }, // DRIVER NAME
    { wch: 20 }, // DRIVER CNIC
    { wch: 18 }, // DRIVER CONTACT
    { wch: 14 }  // TRIPS COUNT
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
    'VEHICLE NO.',
    'CHASSIS NO.',
    'ENGINE NO.',
    'MAKER',
    'MODEL',
    'TRANSPORTER NAME',
    'BROKER NAME',
    'REGISTRATION DATE',
    'VALIDITY EXPIRY (6 MONTHS)',
    'COMPANY',
    'CUSTOMS 6M STATUS',
    'REG BOOK',
    'OWNER ID CARD',
    'DRIVER NAME',
    'DRIVER CNIC',
    'DRIVER CONTACT',
    'TRIPS COUNT'
  ];

  const sheetData: any[][] = [
    [`${compTitle}`],
    [activeComp.tagline || 'Customs Bonded Carrier • Bonded Fleet Registry • Directorate General of Transit Trade'],
    [`Operations: ${activeComp.address || 'Office No. 14-B, 1st Floor, State Life Bldg No. 7, G-Allana Road Tower, Karachi'}`],
    [`Contact: ${activeComp.phone || '+92-21-32330103'} | Web: ${activeComp.web || 'www.dockspk.com'}`],
    [],
    ['PAKISTAN CUSTOMS BONDED FLEET - MASTER VEHICLE REGISTRY (SHARED DATABASE)'],
    [`Export Date: ${today}`, `Total Vehicles: ${vehicles.length}`, `Customs Rule: 6-Month Registration Validity`],
    [],
    headers
  ];

  vehicles.forEach((v, idx) => {
    const transporter = v.transporterName || v.brokerName || '';
    const companyDisplay = v.companyName || (v.operatingCompany === 'truckit' ? 'TRUCKIT PVT LTD' : v.operatingCompany === 'docks' ? 'DOCKS PVT LTD' : (v.operatingCompany || 'TRUCKIT PVT LTD').toUpperCase());
    sheetData.push([
      idx + 1,
      v.registrationNumber || '',
      v.chassisNo || '',
      v.engineNo || '',
      v.make || '',
      v.model || '',
      transporter,
      transporter,
      v.registrationDate || '',
      v.validationExpiryDate || '',
      companyDisplay,
      v.status || 'AVAILABLE',
      v.registrationBook ? 'Uploaded' : 'Missing',
      v.ownerIdCardUrl ? 'Uploaded' : 'Missing',
      v.driverName || '',
      v.driverCnic || '',
      v.driverContact || '',
      (v.tripsHistory || []).length
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 8 },  // Sr
    { wch: 20 }, // VEHICLE NO.
    { wch: 24 }, // CHASSIS NO.
    { wch: 20 }, // ENGINE NO.
    { wch: 16 }, // MAKER
    { wch: 14 }, // MODEL
    { wch: 30 }, // TRANSPORTER NAME
    { wch: 30 }, // BROKER NAME
    { wch: 18 }, // REGISTRATION DATE
    { wch: 22 }, // VALIDITY EXPIRY
    { wch: 22 }, // COMPANY
    { wch: 18 }, // STATUS
    { wch: 14 }, // REG BOOK
    { wch: 16 }, // OWNER ID
    { wch: 22 }, // DRIVER NAME
    { wch: 20 }, // DRIVER CNIC
    { wch: 18 }, // DRIVER CONTACT
    { wch: 14 }  // TRIPS COUNT
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Fleet Master');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const filename = `${prefix}_Master_Vehicles_Fleet_${today}.xlsx`;

  return { buffer, filename };
}

/**
 * Generates and downloads a clean Excel template (.xlsx) for Bulk Vehicle Import
 * matching the exact Truckit Pvt Ltd & Docks Pvt Ltd Customs sheet structure.
 */
export function downloadBulkVehicleExcelTemplate() {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().split('T')[0];

  const sampleRows: any[][] = [
    [
      'VEHICLE NO.',
      'CHASSIS NO.',
      'ENGINE NO.',
      'MAKER',
      'MODEL',
      'TRANSPORTER NAME',
      'REGISTRATION DATE',
      'COMPANY'
    ],
    [
      'TMA-133',
      'CV450BN-50039',
      'PE6-070941',
      'NISSAN',
      '1990',
      'TRUCKIT CARGO',
      today,
      'TRUCKIT PVT LTD'
    ],
    [
      'JU-1929',
      'KC-CW52AHN-10023',
      'RF8-106448',
      'NISSAN',
      '1995',
      'DOCKS LOGISTICS',
      '07/05/2025',
      'DOCKS PVT LTD'
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 20 },
    { wch: 24 },
    { wch: 20 },
    { wch: 16 },
    { wch: 14 },
    { wch: 30 },
    { wch: 22 },
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
    caseNo?: string;
    pol?: string;
    pod?: string;
    containerNumber: string;
    driverName: string;
    driverPhone?: string;
    driverCnic?: string;
    importerName: string;
    itemDescription?: string;
    clientName: string;
    status: string;
  }>
): void {
  const headers = [
    'Trip Date',
    'Case Number',
    'Loading Port (From)',
    'Destination Port (To)',
    'Client Name',
    'Importer Name',
    'Cargo Item',
    'Container Number',
    'Driver Name',
    'Driver Mobile',
    'Driver ID Card (CNIC)',
    'Trip Status'
  ];
  const rows = trips.map(t => [
    t.date || '',
    t.caseNo || '',
    t.pol || '',
    t.pod || '',
    t.clientName || '',
    t.importerName || '',
    t.itemDescription || '',
    t.containerNumber || '',
    t.driverName || '',
    t.driverPhone || '',
    t.driverCnic || '',
    t.status || ''
  ]);
  const filename = `${vehicleReg.replace(/[^a-zA-Z0-9_-]/g, '_')}_trips_${new Date().toISOString().split('T')[0]}.xlsx`;
  exportTableToExcel(filename, 'Vehicle Trips', headers, rows, [14, 18, 22, 22, 24, 24, 24, 20, 22, 18, 20, 18]);
}


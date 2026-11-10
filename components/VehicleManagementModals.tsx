import React, { useState } from 'react';
import { 
  X, 
  UploadCloud, 
  Download, 
  CheckCircle, 
  AlertTriangle, 
  FileText, 
  MapPin, 
  Calendar, 
  Truck, 
  ShieldCheck,
  Clock,
  FileSpreadsheet,
  Loader2
} from 'lucide-react';
import { Vehicle, Transporter } from '../types';
import { parseVehicleFile, parseTextOrCsvVehicles, dedupeAndMergeVehicles } from '../services/documentParserService';
import { downloadBulkVehicleExcelTemplate } from '../services/excelExportService';

// ==========================================
// 1. BULK VEHICLE IMPORT MODAL (Excel / Word / CSV)
// ==========================================

interface BulkVehicleImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (parsedList: Partial<Vehicle>[]) => void;
  transporters: Transporter[];
}

export const BulkVehicleImportModal: React.FC<BulkVehicleImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  transporters
}) => {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<Partial<Vehicle>[]>([]);
  const [shiftedToTruckitCount, setShiftedToTruckitCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [detectedFormat, setDetectedFormat] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDownloadExcelSample = () => {
    downloadBulkVehicleExcelTemplate();
  };

  const handleDownloadSample = () => {
    const sampleHeaders = 'VEHICLE NO.,CHASSIS NO.,ENGINE NO.,MAKER,MODEL,TRANSPORTER NAME,REGISTRATION DATE,COMPANY';
    const today = new Date().toISOString().split('T')[0];
    const sampleData = [
      sampleHeaders,
      `TMA-133,CV450BN-50039,PE6-070941,NISSAN,1990,TRUCKIT CARGO,${today},TRUCKIT PVT LTD`,
      'JU-1929,KC-CW52AHN-10023,RF8-106448,NISSAN,1995,DOCKS LOGISTICS,07/05/2025,DOCKS PVT LTD',
    ].join('\n');

    const blob = new Blob([sampleData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'DPL_Bulk_Vehicle_Registration_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const parseCsvContent = (content: string) => {
    setError(null);
    try {
      const rows = parseTextOrCsvVehicles(content);
      if (rows.length === 0) {
        setError('No valid vehicle records could be extracted.');
      } else {
        setDetectedFormat('CSV_TEXT');
        const combined = [...parsedRows, ...rows] as Vehicle[];
        const { merged } = dedupeAndMergeVehicles(combined);
        setShiftedToTruckitCount(Math.max(0, combined.length - merged.length));
        setParsedRows(merged);
      }
    } catch (err: any) {
      setError(`Failed to parse CSV: ${err.message || err}`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setFileName(files.map(f => f.name).join(' + '));
    setError(null);
    setIsParsing(true);

    try {
      let newlyParsed: Partial<Vehicle>[] = [];
      let lastType: string | null = null;

      for (const file of files) {
        const result = await parseVehicleFile(file);
        if (result.error) {
          setError(result.error);
        } else if (result.rows.length > 0) {
          lastType = result.fileType;
          newlyParsed = [...newlyParsed, ...result.rows];
        }
      }

      if (newlyParsed.length === 0) {
        setError(`No vehicle records could be identified in the uploaded file(s). Please ensure the sheet contains columns like VEHICLE NO., CHASSIS NO., ENGINE NO., MAKER, MODEL, TRANSPORTER NAME, REGISTRATION DATE, COMPANY.`);
      } else {
        setDetectedFormat(lastType);
        const combined = [...parsedRows, ...newlyParsed] as Vehicle[];
        const { merged } = dedupeAndMergeVehicles(combined);
        setShiftedToTruckitCount(prev => prev + Math.max(0, combined.length - merged.length));
        setParsedRows(merged);
      }
    } catch (err: any) {
      setError(`Failed to read file: ${err.message || err}`);
    } finally {
      setIsParsing(false);
      try { e.target.value = ''; } catch (_) {}
    }
  };

  const handleApply = () => {
    if (parsedRows.length === 0) {
      if (csvText.trim()) {
        parseCsvContent(csvText);
      } else {
        setError('Please upload an Excel (.xlsx), Word (.docx), or CSV file or paste vehicle rows.');
        return;
      }
    }
    if (parsedRows.length > 0) {
      onImport(parsedRows);
    }
  };

  const activeCount = parsedRows.filter(r => r.status !== 'EXPIRED').length;
  const expiredCount = parsedRows.filter(r => r.status === 'EXPIRED').length;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-start justify-center z-50 pt-3 sm:pt-6 pb-6 px-3 sm:px-4 overflow-y-auto animate-in fade-in">
      <div className="glass-card w-full max-w-5xl rounded-2xl border border-white/10 overflow-hidden shadow-2xl bg-slate-950/95 flex flex-col max-h-[92vh] mb-6">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Bulk Vehicle Fleet Import (Truckit & Docks Shared Database)</h3>
              <p className="text-xs text-gray-400">
                Supports VEHICLE NO., CHASSIS NO., ENGINE NO., MAKER, MODEL, TRANSPORTER NAME (= BROKER), REGISTRATION DATE (6M Customs Rule) & COMPANY
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
          {/* Action to download templates */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <div className="space-y-1">
              <span className="text-xs font-bold text-emerald-300 block">Customs 6-Month Registration & Docks-to-Truckit Auto-Move Rules</span>
              <p className="text-[11px] text-emerald-200/80">
                • Registration Date within 6 months = <strong>ACTIVE</strong> | Older than 6 months or blank = <strong>EXPIRED</strong>.<br />
                • Transporter Name automatically populates Broker Name.<br />
                • If a vehicle appears in both <strong>DOCKS PVT LTD</strong> and <strong>TRUCKIT PVT LTD</strong>, it automatically moves to <strong>TRUCKIT PVT LTD</strong> (no duplicates).
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleDownloadExcelSample}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <FileSpreadsheet size={14} />
                <span>Excel Template (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadSample}
                className="bg-white/10 hover:bg-white/15 text-gray-200 text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-white/10 transition-colors"
              >
                <Download size={13} />
                <span>CSV Template</span>
              </button>
            </div>
          </div>

          {/* File Upload Box */}
          <div className="border-2 border-dashed border-white/20 hover:border-emerald-500/50 rounded-2xl p-6 text-center transition-colors bg-white/[0.02]">
            <input
              type="file"
              multiple
              accept=".xlsx, .xls, .xlsm, .docx, .csv, .txt, .tsv"
              onChange={handleFileUpload}
              className="hidden"
              id="bulk-vehicle-file-input"
            />
            <label htmlFor="bulk-vehicle-file-input" className="cursor-pointer flex flex-col items-center gap-2.5">
              {isParsing ? (
                <Loader2 className="text-emerald-400 animate-spin" size={34} />
              ) : (
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="text-emerald-400" size={30} />
                  <FileText className="text-blue-400" size={30} />
                </div>
              )}
              <div>
                <span className="text-sm font-semibold text-white block">
                  {fileName ? `Loaded: ${fileName} (Click to add another sheet)` : 'Upload Truckit Pvt Ltd & Docks Pvt Ltd Excel (.xlsx) Files'}
                </span>
                <span className="text-xs text-gray-400 mt-1 block">
                  You can select both Truckit and Docks Excel files together or one after another — duplicates automatically move to Truckit Pvt Ltd
                </span>
              </div>
              {detectedFormat && (
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Format Detected: {detectedFormat === 'EXCEL' ? 'Excel Spreadsheet (.xlsx)' : detectedFormat === 'DOCX' ? 'Word Document (.docx)' : 'CSV / Text File'}
                </span>
              )}
            </label>
          </div>

          {/* Or Paste Raw Text */}
          <div className="space-y-2">
            <label className="text-xs text-gray-300 font-semibold block">Or Paste CSV / Tab-Delimited Vehicle Rows Directly:</label>
            <textarea
              rows={2}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                if (e.target.value.trim()) {
                  parseCsvContent(e.target.value);
                }
              }}
              placeholder="TMA-133,CV450BN-50039,PE6-070941,NISSAN,1990,TRUCKIT CARGO,07/05/2026,TRUCKIT PVT LTD"
              className="w-full glass-input rounded-xl p-3 text-xs font-mono outline-none border border-white/10"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Preview Table */}
          {parsedRows.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle size={14} /> Ready to Import: {parsedRows.length} Unique Vehicles
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                    Active (≤ 6 Months): {activeCount}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold">
                    Expired (&gt; 6 Months / Blank Date): {expiredCount}
                  </span>
                  {shiftedToTruckitCount > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold">
                      {shiftedToTruckitCount} Duplicate(s) Moved from Docks → Truckit
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setParsedRows([]);
                    setFileName('');
                    setShiftedToTruckitCount(0);
                  }}
                  className="text-[11px] text-gray-400 hover:text-rose-400 underline"
                >
                  Clear Loaded Rows
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto border border-white/10 rounded-xl custom-scrollbar">
                <table className="w-full text-left text-xs text-gray-300">
                  <thead className="bg-slate-900 uppercase text-[10px] text-gray-400 sticky top-0 z-10">
                    <tr>
                      <th className="p-2.5">Vehicle No.</th>
                      <th className="p-2.5">Chassis No. / Engine No.</th>
                      <th className="p-2.5">Maker / Model</th>
                      <th className="p-2.5">Transporter (= Broker)</th>
                      <th className="p-2.5">Reg Date → 6M Expiry</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Company</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {parsedRows.slice(0, 50).map((row, idx) => {
                      const isExpired = row.status === 'EXPIRED';
                      const isTruckit = row.operatingCompany === 'truckit' || (row.companyName || '').toUpperCase().includes('TRUCKIT');
                      return (
                        <tr key={idx} className="hover:bg-white/5">
                          <td className="p-2.5 font-mono font-bold text-white">{row.registrationNumber}</td>
                          <td className="p-2.5 font-mono text-[11px]">
                            <div className="text-gray-200">{row.chassisNo || '—'}</div>
                            <div className="text-gray-500">{row.engineNo || '—'}</div>
                          </td>
                          <td className="p-2.5">
                            <span className="font-semibold text-white">{row.make || '—'}</span>
                            {row.model ? <span className="text-gray-400 ml-1">({row.model})</span> : null}
                          </td>
                          <td className="p-2.5 text-gray-200">{row.transporterName || row.brokerName || '—'}</td>
                          <td className="p-2.5 font-mono text-[11px]">
                            {row.registrationDate ? (
                              <div>
                                <div className="text-gray-200">Reg: {row.registrationDate}</div>
                                <div className="text-gray-500">Exp: {row.validationExpiryDate || '—'}</div>
                              </div>
                            ) : (
                              <span className="text-rose-400 font-semibold">Blank Date (Expired)</span>
                            )}
                          </td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              isExpired
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}>
                              {isExpired ? 'EXPIRED' : 'ACTIVE'}
                            </span>
                          </td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              isTruckit
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}>
                              {row.companyName || (isTruckit ? 'TRUCKIT PVT LTD' : 'DOCKS PVT LTD')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > 50 && (
                <p className="text-[11px] text-gray-500 text-center">+ {parsedRows.length - 50} more vehicle records ready for import</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-white/5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={parsedRows.length === 0 || isParsing}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-1.5 transition-colors shadow-lg shadow-emerald-600/30"
          >
            <CheckCircle size={14} />
            <span>Confirm & Sync Global Fleet ({parsedRows.length} Vehicles)</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 2. VEHICLE ONLINE AT STATION MODAL
// ==========================================

interface VehicleOnlineModalProps {
  isOpen: boolean;
  vehicle: Vehicle | null;
  onClose: () => void;
  onConfirm: (vehicleId: number, station: string, destination: string) => void;
}

const TERMINAL_OPTIONS = [
  'Karachi Port Trust (KPT) - East Wharf',
  'Karachi Port Trust (KPT) - West Wharf',
  'Port Muhammad Bin Qasim (PQ) - QICT',
  'SAPT (South Asia Pakistan Terminals)',
  'Lahore Dry Port - Mughalpura',
  'Prem Nagar Dry Port (PNDP) - Lahore',
  'Faisalabad Dry Port',
  'Multan Dry Port',
  'Sialkot / Sambrial Dry Port',
  'Peshawar Dry Port (Aman Garh)',
  'Quetta NLC Dry Port',
  'Taftan Customs Station (Iran Border)',
  'Torkham Border Post (Afghan Transit)',
  'Chaman Border Post (Afghan Transit)'
];

export const VehicleOnlineModal: React.FC<VehicleOnlineModalProps> = ({
  isOpen,
  vehicle,
  onClose,
  onConfirm
}) => {
  const [station, setStation] = useState(TERMINAL_OPTIONS[0]);
  const [destination, setDestination] = useState('Lahore Dry Port');

  if (!isOpen || !vehicle) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-start justify-center z-50 pt-3 sm:pt-6 pb-6 px-3 sm:px-4 overflow-y-auto animate-in fade-in">
      <div className="glass-card w-full max-w-md rounded-2xl border border-white/10 overflow-hidden shadow-2xl bg-slate-950/95 space-y-5 p-6 mb-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <MapPin size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Mark Vehicle Online</h3>
              <p className="text-xs text-gray-400 font-mono">{vehicle.registrationNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-gray-300 font-semibold mb-1">Current Terminal / Station Availability:</label>
            <select
              value={station}
              onChange={(e) => setStation(e.target.value)}
              className="w-full glass-input rounded-xl p-2.5 text-xs text-white border border-white/10 bg-slate-900"
            >
              {TERMINAL_OPTIONS.map((term, i) => (
                <option key={i} value={term} className="bg-slate-900 text-white">{term}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-gray-300 font-semibold mb-1">Target Loading Route / Destination:</label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="e.g. Lahore Dry Port, Peshawar, Faisalabad"
              className="w-full glass-input rounded-xl p-2.5 text-xs text-white border border-white/10 bg-slate-900"
            />
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl text-emerald-300">
            <p>This vehicle will be visible to Dispatchers and Operations as <strong>ONLINE & READY</strong> for container case assignment at <strong>{station}</strong>.</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(vehicle.id, station, destination)}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-lg shadow-emerald-600/30"
          >
            <CheckCircle size={14} />
            <span>Mark Online Now</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 3. VEHICLE 6-MONTH RENEWAL REQUEST MODAL
// ==========================================

interface VehicleRenewalModalProps {
  isOpen: boolean;
  vehicle: Vehicle | null;
  onClose: () => void;
  onConfirmRenewal: (vehicleId: number, newExpiryDate: string, docUrl?: string) => void;
}

export const VehicleRenewalModal: React.FC<VehicleRenewalModalProps> = ({
  isOpen,
  vehicle,
  onClose,
  onConfirmRenewal
}) => {
  const [renewalDoc, setRenewalDoc] = useState('');
  const [docName, setDocName] = useState('');
  const [renewalMonths, setRenewalMonths] = useState(6);

  if (!isOpen || !vehicle) return null;

  // Calculate new expiry date
  const computeNewExpiry = () => {
    const baseDate = vehicle.validationExpiryDate && new Date(vehicle.validationExpiryDate).getTime() > Date.now()
      ? new Date(vehicle.validationExpiryDate)
      : new Date();
    baseDate.setMonth(baseDate.getMonth() + renewalMonths);
    return baseDate.toISOString().slice(0, 10);
  };

  const newExpiryDate = computeNewExpiry();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDocName(file.name);
      const reader = new FileReader();
      reader.onload = (evt) => {
        setRenewalDoc(evt.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-start justify-center z-50 pt-3 sm:pt-6 pb-6 px-3 sm:px-4 overflow-y-auto animate-in fade-in">
      <div className="glass-card w-full max-w-md rounded-2xl border border-white/10 overflow-hidden shadow-2xl bg-slate-950/95 space-y-5 p-6 mb-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
              <Clock size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Request Vehicle Renewal</h3>
              <p className="text-xs text-gray-400 font-mono">{vehicle.registrationNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <div className="bg-white/5 p-3 rounded-xl space-y-1.5 border border-white/10">
            <div className="flex justify-between">
              <span className="text-gray-400">Current Expiry:</span>
              <span className="font-mono text-yellow-400 font-bold">{vehicle.validationExpiryDate || 'Expired'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Extension Period:</span>
              <span className="text-white font-semibold">+6 Months</span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-1.5">
              <span className="text-emerald-400 font-bold">New Validity Expiry:</span>
              <span className="font-mono text-emerald-400 font-bold">{newExpiryDate}</span>
            </div>
          </div>

          <div>
            <label className="block text-gray-300 font-semibold mb-1">Attach Vehicle Fitness / Route Permit / Tax Token:</label>
            <div className="border border-dashed border-white/20 hover:border-purple-500/50 rounded-xl p-4 text-center cursor-pointer">
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="hidden"
                id="renewal-doc-upload"
              />
              <label htmlFor="renewal-doc-upload" className="cursor-pointer flex flex-col items-center gap-1">
                <UploadCloud className="text-purple-400" size={24} />
                <span className="text-xs text-white">{docName || 'Click to upload fitness / permit proof'}</span>
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirmRenewal(vehicle.id, newExpiryDate, renewalDoc)}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1.5 shadow-lg shadow-purple-600/30"
          >
            <ShieldCheck size={14} />
            <span>Approve & Extend 6 Months</span>
          </button>
        </div>
      </div>
    </div>
  );
};

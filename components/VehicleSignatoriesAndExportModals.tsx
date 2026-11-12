import React, { useState, useEffect } from 'react';
import {
  X,
  FileSpreadsheet,
  Download,
  CheckCircle,
  AlertTriangle,
  Clock,
  Layers,
  Users,
  Building2,
  UploadCloud,
  Loader2,
  ShieldCheck,
  CreditCard,
  Phone,
  MapPin,
  Briefcase,
  UserCheck
} from 'lucide-react';
import { Vehicle } from '../types';
import { CompanyId, GROUP_COMPANIES } from '../services/companyService';
import { exportVehiclesToExcel } from '../services/excelExportService';
import { compressAndPrepareFile } from '../services/fileUtils';
import {
  WitnessSignatory,
  CompanyOwnerSignatory,
  ALL_FOUR_COMPANY_IDS,
  useVehicleLegalSignatories,
  resolveSignatoryImageDataUrl,
  resolveVehicleCompanyId
} from '../services/vehicleLegalSignatoriesService';

// ============================================================================
// 1. FLEET EXCEL EXPORT POPUP MODAL (All / Valid / Expiry Soon / Expired)
// ============================================================================
export type FleetExcelScope = 'ALL' | 'VALID' | 'EXPIRY_SOON' | 'EXPIRED';

interface FleetExcelExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  allVehicles: Vehicle[];
  validVehicles: Vehicle[];
  expirySoonVehicles: Vehicle[];
  expiredVehicles: Vehicle[];
  tripCountsByPlate?: Map<string, number>;
}

export const FleetExcelExportModal: React.FC<FleetExcelExportModalProps> = ({
  isOpen,
  onClose,
  allVehicles,
  validVehicles,
  expirySoonVehicles,
  expiredVehicles,
  tripCountsByPlate
}) => {
  const [selectedScope, setSelectedScope] = useState<FleetExcelScope>('ALL');
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const scopeOptions: Array<{
    id: FleetExcelScope;
    title: string;
    subtitle: string;
    count: number;
    vehicles: Vehicle[];
    filterLabel: string;
    filterSlug: string;
    accentClass: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'ALL',
      title: 'All Vehicles',
      subtitle: 'Complete master fleet list across all registered companies with full owner & compliance details',
      count: allVehicles.length,
      vehicles: allVehicles,
      filterLabel: 'All Vehicles',
      filterSlug: 'All_Vehicles',
      accentClass: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
      icon: <Layers size={18} className="text-blue-400" />
    },
    {
      id: 'VALID',
      title: 'Valid Vehicles',
      subtitle: 'Active & valid vehicles within 6-month Pakistan Customs registration validity',
      count: validVehicles.length,
      vehicles: validVehicles,
      filterLabel: 'Valid Vehicles',
      filterSlug: 'Valid_Vehicles',
      accentClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      icon: <CheckCircle size={18} className="text-emerald-400" />
    },
    {
      id: 'EXPIRY_SOON',
      title: 'Expiry Soon Vehicles',
      subtitle: 'Vehicles whose 6-month Customs validity is expiring within the next 30 days',
      count: expirySoonVehicles.length,
      vehicles: expirySoonVehicles,
      filterLabel: 'Expiry Soon Vehicles',
      filterSlug: 'Expiry_Soon_Vehicles',
      accentClass: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      icon: <Clock size={18} className="text-amber-400" />
    },
    {
      id: 'EXPIRED',
      title: 'Expired Vehicles',
      subtitle: 'Vehicles past 6-month registration validity requiring Customs renewal',
      count: expiredVehicles.length,
      vehicles: expiredVehicles,
      filterLabel: 'Expired Vehicles',
      filterSlug: 'Expired_Vehicles',
      accentClass: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
      icon: <AlertTriangle size={18} className="text-rose-400" />
    }
  ];

  const currentOption = scopeOptions.find((o) => o.id === selectedScope) || scopeOptions[0];

  const handleDownloadScope = (opt = currentOption) => {
    setIsExporting(true);
    try {
      exportVehiclesToExcel(opt.vehicles, {
        filterLabel: opt.filterLabel,
        filterSlug: opt.filterSlug,
        tripCountsByPlate
      });
      setTimeout(() => {
        setIsExporting(false);
        onClose();
      }, 180);
    } catch (err) {
      console.error('Fleet Excel export error:', err);
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-8 sm:pt-14 p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="glass-card w-full max-w-xl rounded-2xl border border-white/15 bg-slate-950/95 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">Download Fleet Excel (.xlsx)</h3>
              <p className="text-xs text-gray-400">
                Select which vehicle category to export with complete technical, owner &amp; validity details
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mak-btn-secondary p-2 rounded-lg text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Options */}
        <div className="p-5 space-y-2.5">
          {scopeOptions.map((opt) => {
            const isSelected = selectedScope === opt.id;
            return (
              <div
                key={opt.id}
                onClick={() => setSelectedScope(opt.id)}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'border-blue-400 bg-blue-600/15 shadow-md shadow-blue-900/20'
                    : 'border-white/10 bg-slate-900/70 hover:bg-slate-800/80 hover:border-white/20'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 shrink-0">{opt.icon}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">{opt.title}</span>
                      <span
                        className={`text-[11px] font-mono tabular-nums font-bold px-2 py-0.5 rounded border ${opt.accentClass}`}
                      >
                        {opt.count.toLocaleString()} Vehicles
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{opt.subtitle}</p>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <input
                    type="radio"
                    checked={isSelected}
                    onChange={() => setSelectedScope(opt.id)}
                    className="w-4 h-4 accent-blue-500 cursor-pointer"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between gap-3">
          <span className="text-[11px] text-gray-400">
            Includes Make, Model, Chassis, Engine, MRA, Transporter, Owner, Company Director &amp; 6M Validity
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="mak-btn-secondary px-4 py-2 rounded-lg text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isExporting || currentOption.count === 0}
              onClick={() => handleDownloadScope(currentOption)}
              className="mak-btn px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
            >
              {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>
                Download {currentOption.title} ({currentOption.count.toLocaleString()}) .xlsx
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// HELPER: Dual Front/Back CNIC Uploader Card
// ============================================================================
interface IdCardSideUploaderProps {
  label: string;
  rawUrl?: string;
  fallbackChunkKey: string;
  fileName?: string;
  onUploaded: (dataUrl: string, name: string) => void;
  onClear: () => void;
}

const IdCardSideUploader: React.FC<IdCardSideUploaderProps> = ({
  label,
  rawUrl,
  fallbackChunkKey,
  fileName,
  onUploaded,
  onClear
}) => {
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!rawUrl) {
      setPreviewUrl('');
      return;
    }
    if (rawUrl.startsWith('data:')) {
      setPreviewUrl(rawUrl);
      return;
    }
    resolveSignatoryImageDataUrl(rawUrl, fallbackChunkKey).then((res) => {
      if (!cancelled) setPreviewUrl(res || '');
    });
    return () => {
      cancelled = true;
    };
  }, [rawUrl, fallbackChunkKey]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const processed = await compressAndPrepareFile(file);
      if (processed.dataUrl) {
        onUploaded(processed.dataUrl, file.name);
      } else {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            onUploaded(reader.result, file.name);
          }
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      console.warn('CNIC image processing warning:', err);
    } finally {
      setUploading(false);
      try {
        e.target.value = '';
      } catch (_) {}
    }
  };

  const hasImage = Boolean(rawUrl || previewUrl);

  return (
    <div className="bg-black/35 border border-white/10 rounded-xl p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-gray-200 flex items-center gap-1.5">
          <CreditCard size={12} className="text-blue-400" />
          <span>{label}</span>
        </span>
        {hasImage ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
            Uploaded
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-400 font-semibold">
            Pending
          </span>
        )}
      </div>

      {previewUrl && previewUrl.startsWith('data:image') && (
        <div className="relative rounded-lg overflow-hidden border border-white/15 bg-slate-900 h-24 flex items-center justify-center">
          <img src={previewUrl} alt={label} className="max-h-24 w-auto object-contain" />
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <label className="flex-1 cursor-pointer mak-btn-secondary py-1.5 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 text-center">
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleFile}
          />
          {uploading ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              <span>Uploading...</span>
            </>
          ) : (
            <>
              <UploadCloud size={12} />
              <span className="truncate">{hasImage ? fileName || 'Replace ID Side' : `Upload ${label}`}</span>
            </>
          )}
        </label>
        {hasImage && (
          <button
            type="button"
            onClick={onClear}
            className="mak-btn-secondary px-2 py-1.5 rounded-lg text-[10px] text-rose-300 hover:text-rose-200"
            title="Clear uploaded ID image"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 2. MANAGE 2 PERMANENT WITNESSES MODAL ("Add Witnesses")
// ============================================================================
interface ManageWitnessesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ManageWitnessesModal: React.FC<ManageWitnessesModalProps> = ({ isOpen, onClose }) => {
  const { witnesses, saveWitnesses } = useVehicleLegalSignatories();
  const [formW1, setFormW1] = useState<WitnessSignatory>(() => ({ ...witnesses[0] }));
  const [formW2, setFormW2] = useState<WitnessSignatory>(() => ({ ...witnesses[1] }));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormW1({ ...witnesses[0] });
      setFormW2({ ...witnesses[1] });
      setFeedback(null);
    }
  }, [isOpen, witnesses]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formW1.name.trim() || !formW1.cnic.trim() || !formW2.name.trim() || !formW2.cnic.trim()) {
      setFeedback({
        type: 'error',
        message: 'Please enter Name and ID Card (CNIC) Number for both Witness 1 and Witness 2.'
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await saveWitnesses([formW1, formW2]);
      setFeedback({
        type: 'success',
        message:
          'Permanent Witnesses (1 & 2) saved! All Registration, Renewal, Lease, Affidavit & Cancellation documents will automatically use these 2 witnesses.'
      });
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to save witnesses.'
      });
    } finally {
      setSaving(false);
    }
  };

  const renderWitnessCard = (
    slot: 1 | 2,
    data: WitnessSignatory,
    setData: React.Dispatch<React.SetStateAction<WitnessSignatory>>
  ) => (
    <div className="p-4 rounded-2xl border border-white/12 bg-slate-900/80 space-y-3">
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
          <UserCheck size={15} className="text-blue-400" />
          <span>Permanent Witness {slot}</span>
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 font-semibold">
          Auto-Printed on All Docs
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="text-[11px] text-gray-300 block mb-1 font-semibold">Witness Full Name *</label>
          <input
            type="text"
            placeholder="e.g. MUHAMMAD ARBAZ"
            className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white font-semibold uppercase"
            value={data.name}
            onChange={(e) => setData({ ...data, name: e.target.value.toUpperCase() })}
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-300 block mb-1 font-semibold">Father Name (S/O)</label>
          <input
            type="text"
            placeholder="e.g. MUHAMMAD ASLAM"
            className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white uppercase"
            value={data.fatherName}
            onChange={(e) => setData({ ...data, fatherName: e.target.value.toUpperCase() })}
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-300 block mb-1 font-semibold">ID Card Number (CNIC) *</label>
          <input
            type="text"
            placeholder="e.g. 42401-7400526-3"
            className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white font-mono tabular-nums"
            value={data.cnic}
            onChange={(e) => setData({ ...data, cnic: e.target.value })}
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-300 block mb-1 font-semibold">Mobile Number</label>
          <input
            type="tel"
            placeholder="e.g. 0300-1234567"
            className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white font-mono tabular-nums"
            value={data.mobile}
            onChange={(e) => setData({ ...data, mobile: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
        <IdCardSideUploader
          label={`Witness ${slot} ID Front`}
          rawUrl={data.cnicFrontUrl}
          fallbackChunkKey={`signatory_witness_${slot}_front`}
          fileName={data.cnicFrontName}
          onUploaded={(url, name) => setData({ ...data, cnicFrontUrl: url, cnicFrontName: name })}
          onClear={() => setData({ ...data, cnicFrontUrl: '', cnicFrontName: '' })}
        />
        <IdCardSideUploader
          label={`Witness ${slot} ID Back`}
          rawUrl={data.cnicBackUrl}
          fallbackChunkKey={`signatory_witness_${slot}_back`}
          fileName={data.cnicBackName}
          onUploaded={(url, name) => setData({ ...data, cnicBackUrl: url, cnicBackName: name })}
          onClear={() => setData({ ...data, cnicBackUrl: '', cnicBackName: '' })}
        />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-6 sm:pt-10 p-4 overflow-y-auto animate-in fade-in duration-150">
      <form
        onSubmit={handleSave}
        className="glass-card w-full max-w-4xl rounded-2xl border border-white/15 bg-slate-950/95 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
              <Users size={20} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                Add / Update Permanent Witnesses (2 Witnesses)
              </h3>
              <p className="text-xs text-gray-400">
                Saved permanently across all companies — automatically populated in every Registration, Renewal, Lease, Affidavit &amp; Cancellation document
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mak-btn-secondary p-2 rounded-lg text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 custom-scrollbar">
          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/35 text-rose-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle size={15} className="shrink-0" />
              ) : (
                <AlertTriangle size={15} className="shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {renderWitnessCard(1, formW1, setFormW1)}
            {renderWitnessCard(2, formW2, setFormW2)}
          </div>
        </div>

        <div className="p-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="mak-btn-secondary px-4 py-2 rounded-lg text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="mak-btn px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            <span>Save Both Permanent Witnesses</span>
          </button>
        </div>
      </form>
    </div>
  );
};

// ============================================================================
// 3. MANAGE 4-COMPANY OWNER DETAILS MODAL ("Add Company Owner Detail")
// ============================================================================
interface ManageCompanyOwnersModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCompanyId?: CompanyId;
}

export const ManageCompanyOwnersModal: React.FC<ManageCompanyOwnersModalProps> = ({
  isOpen,
  onClose,
  initialCompanyId = 'truckit'
}) => {
  const { companyOwners, saveCompanyOwner } = useVehicleLegalSignatories();
  const [selectedCompanyId, setSelectedCompanyId] = useState<CompanyId>(initialCompanyId);
  const [ownerForm, setOwnerForm] = useState<CompanyOwnerSignatory>(() => ({
    ...companyOwners[initialCompanyId]
  }));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const target = initialCompanyId || 'truckit';
      setSelectedCompanyId(target);
      setOwnerForm({ ...companyOwners[target] });
      setFeedback(null);
    }
  }, [isOpen, initialCompanyId]);

  const handleSelectCompany = (cid: CompanyId) => {
    setSelectedCompanyId(cid);
    setOwnerForm({ ...companyOwners[cid] });
    setFeedback(null);
  };

  if (!isOpen) return null;

  const selectedCompanyInfo = GROUP_COMPANIES[selectedCompanyId];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerForm.name.trim() || !ownerForm.cnic.trim()) {
      setFeedback({
        type: 'error',
        message: `Please enter the Company Owner's Name and ID Card (CNIC) Number for ${selectedCompanyInfo.legalTitle}.`
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await saveCompanyOwner(selectedCompanyId, ownerForm);
      setFeedback({
        type: 'success',
        message: `Company Owner saved for ${selectedCompanyInfo.legalTitle}! Whenever any ${selectedCompanyInfo.shortName} vehicle is added, renewed, or cancelled, this owner's details & CNIC will load automatically.`
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to save Company Owner details.'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-6 sm:pt-10 p-4 overflow-y-auto animate-in fade-in duration-150">
      <form
        onSubmit={handleSave}
        className="glass-card w-full max-w-4xl rounded-2xl border border-white/15 bg-slate-950/95 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shrink-0">
              <Building2 size={20} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                Add / Update Company Owner Detail (All 4 Companies)
              </h3>
              <p className="text-xs text-gray-400">
                Select a company below to configure its Director / Owner — auto-fills whenever a vehicle of that company is added, renewed, or cancelled
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mak-btn-secondary p-2 rounded-lg text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 custom-scrollbar">
          {/* Step 1: Select Which of the 4 Companies */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-cyan-300 uppercase tracking-wider block">
              Step 1 — Select Company (Charon Companies):
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {ALL_FOUR_COMPANY_IDS.map((cid) => {
                const comp = GROUP_COMPANIES[cid];
                const saved = companyOwners[cid];
                const isConfigured = Boolean(saved?.name && saved?.cnic);
                const isActive = selectedCompanyId === cid;

                return (
                  <button
                    key={cid}
                    type="button"
                    onClick={() => handleSelectCompany(cid)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                      isActive
                        ? 'border-blue-400 bg-blue-600/20 shadow-md shadow-blue-900/25'
                        : 'border-white/10 bg-slate-900/80 hover:bg-slate-800/80 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/10 text-white">
                        {comp.shortName}
                      </span>
                      {isConfigured ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                          ✓ Saved
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                          Not Set
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-bold text-white leading-snug">{comp.legalTitle}</div>
                    <div className="text-[10.5px] text-gray-400 truncate">
                      {saved?.name ? `${saved.name} (${saved.designation || 'Director'})` : 'Click to add owner'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/35 text-rose-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle size={15} className="shrink-0" />
              ) : (
                <AlertTriangle size={15} className="shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Step 2: Owner Form for Selected Company */}
          <div className="p-4 rounded-2xl border border-white/12 bg-slate-900/80 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
              <div>
                <span className="text-sm font-bold text-white block">
                  {selectedCompanyInfo.legalTitle} — Company Owner / Director Details
                </span>
                <span className="text-[11px] text-gray-400">
                  Printed automatically on {selectedCompanyInfo.shortName} Registration Letters, Lease Agreements, Affidavits, CNIC Copies &amp; Cancellation NOCs
                </span>
              </div>
              <span className="text-[11px] font-mono px-2.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold">
                {selectedCompanyInfo.shortName}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] text-gray-300 block mb-1 font-semibold">
                  Owner Full Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. ARBAB KHAN"
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white font-semibold uppercase"
                  value={ownerForm.name}
                  onChange={(e) => setOwnerForm({ ...ownerForm, name: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[11px] text-gray-300 block mb-1 font-semibold">
                  Father Name (S/O)
                </label>
                <input
                  type="text"
                  placeholder="e.g. ABDUL KARIM KHAN"
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white uppercase"
                  value={ownerForm.fatherName}
                  onChange={(e) => setOwnerForm({ ...ownerForm, fatherName: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[11px] text-gray-300 block mb-1 font-semibold flex items-center gap-1">
                  <Briefcase size={11} className="text-cyan-400" />
                  <span>Company Designation *</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Director / Chief Executive"
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white font-semibold"
                  value={ownerForm.designation}
                  onChange={(e) => setOwnerForm({ ...ownerForm, designation: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[11px] text-gray-300 block mb-1 font-semibold">
                  ID Card Number (CNIC) *
                </label>
                <input
                  type="text"
                  placeholder="e.g. 42101-1234567-1"
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white font-mono tabular-nums"
                  value={ownerForm.cnic}
                  onChange={(e) => setOwnerForm({ ...ownerForm, cnic: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[11px] text-gray-300 block mb-1 font-semibold flex items-center gap-1">
                  <Phone size={11} className="text-emerald-400" />
                  <span>Mobile Number</span>
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 0321-9222883"
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white font-mono tabular-nums"
                  value={ownerForm.mobile}
                  onChange={(e) => setOwnerForm({ ...ownerForm, mobile: e.target.value })}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-1">
                <label className="text-[11px] text-gray-300 block mb-1 font-semibold flex items-center gap-1">
                  <MapPin size={11} className="text-amber-400" />
                  <span>Address</span>
                </label>
                <input
                  type="text"
                  placeholder="Office / Residential Address"
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white"
                  value={ownerForm.address}
                  onChange={(e) => setOwnerForm({ ...ownerForm, address: e.target.value })}
                />
              </div>
            </div>

            {/* Front & Back CNIC Upload */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <IdCardSideUploader
                label={`${selectedCompanyInfo.shortName} Owner ID Card — Front`}
                rawUrl={ownerForm.cnicFrontUrl}
                fallbackChunkKey={`signatory_company_owner_${selectedCompanyId}_front`}
                fileName={ownerForm.cnicFrontName}
                onUploaded={(url, name) =>
                  setOwnerForm({ ...ownerForm, cnicFrontUrl: url, cnicFrontName: name })
                }
                onClear={() =>
                  setOwnerForm({ ...ownerForm, cnicFrontUrl: '', cnicFrontName: '' })
                }
              />
              <IdCardSideUploader
                label={`${selectedCompanyInfo.shortName} Owner ID Card — Back`}
                rawUrl={ownerForm.cnicBackUrl}
                fallbackChunkKey={`signatory_company_owner_${selectedCompanyId}_back`}
                fileName={ownerForm.cnicBackName}
                onUploaded={(url, name) =>
                  setOwnerForm({ ...ownerForm, cnicBackUrl: url, cnicBackName: name })
                }
                onClear={() =>
                  setOwnerForm({ ...ownerForm, cnicBackUrl: '', cnicBackName: '' })
                }
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between gap-2.5">
          <span className="text-[11px] text-gray-400">
            Tip: You can switch tabs above to save owners for all 4 companies one by one.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="mak-btn-secondary px-4 py-2 rounded-lg text-xs font-semibold"
            >
              Done
            </button>
            <button
              type="submit"
              disabled={saving}
              className="mak-btn px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              <span>Save {selectedCompanyInfo.shortName} Owner Detail</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

// ============================================================================
// 4. AUTO-POPULATED COMPANY OWNER & 2 WITNESSES BANNER (For Add / Renew / Cancel)
// ============================================================================
interface CompanySignatoriesAutoBannerProps {
  vehicle?: Partial<Vehicle> | null;
  compact?: boolean;
  onEditCompanyOwner?: (companyId: CompanyId) => void;
  onEditWitnesses?: () => void;
}

export const CompanySignatoriesAutoBanner: React.FC<CompanySignatoriesAutoBannerProps> = ({
  vehicle,
  compact = false,
  onEditCompanyOwner,
  onEditWitnesses
}) => {
  const { witnesses, companyOwners } = useVehicleLegalSignatories();
  const resolvedCompanyId = resolveVehicleCompanyId(vehicle);
  const compInfo = GROUP_COMPANIES[resolvedCompanyId];
  const owner = companyOwners[resolvedCompanyId];
  const [w1, w2] = witnesses;

  const hasOwnerFront = Boolean(owner?.cnicFrontUrl);
  const hasOwnerBack = Boolean(owner?.cnicBackUrl);
  const hasW1Front = Boolean(w1?.cnicFrontUrl);
  const hasW1Back = Boolean(w1?.cnicBackUrl);
  const hasW2Front = Boolean(w2?.cnicFrontUrl);
  const hasW2Back = Boolean(w2?.cnicBackUrl);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 bg-slate-950/75 border border-blue-500/25 rounded-xl p-3 text-xs">
      {/* Matched Company Owner */}
      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
            <Building2 size={13} className="text-cyan-400 shrink-0" />
            <span>{compInfo.legalTitle} — Owner Detail</span>
          </span>
          {onEditCompanyOwner && (
            <button
              type="button"
              onClick={() => onEditCompanyOwner(resolvedCompanyId)}
              className="mak-btn-secondary px-2 py-0.5 rounded text-[10px] font-semibold"
            >
              Edit Owner
            </button>
          )}
        </div>
        {owner?.name ? (
          <div className="space-y-0.5 text-[11px] text-gray-200 leading-snug">
            <div className="font-bold text-white">
              {owner.name.toUpperCase()}
              {owner.fatherName ? ` S/O ${owner.fatherName.toUpperCase()}` : ''}
              {owner.designation ? (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold">
                  {owner.designation}
                </span>
              ) : null}
            </div>
            <div className="font-mono tabular-nums text-gray-300">
              CNIC: <strong className="text-white">{owner.cnic || '—'}</strong>
              {owner.mobile ? ` • Mobile: ${owner.mobile}` : ''}
            </div>
            {!compact && owner.address && (
              <div className="text-[10.5px] text-gray-400 truncate">Address: {owner.address}</div>
            )}
            <div className="flex items-center gap-1.5 pt-0.5">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  hasOwnerFront
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-white/10 text-gray-400'
                }`}
              >
                {hasOwnerFront ? '✓ ID Front' : 'ID Front Pending'}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  hasOwnerBack
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-white/10 text-gray-400'
                }`}
              >
                {hasOwnerBack ? '✓ ID Back' : 'ID Back Pending'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-amber-300/90">
            No Company Owner saved for <strong>{compInfo.legalTitle}</strong> yet. Click &ldquo;Add Company Owner&rdquo; to configure once.
          </div>
        )}
      </div>

      {/* Permanent 2 Witnesses */}
      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-purple-300 flex items-center gap-1.5">
            <Users size={13} className="text-purple-400 shrink-0" />
            <span>Permanent Witnesses (Auto-Applied)</span>
          </span>
          {onEditWitnesses && (
            <button
              type="button"
              onClick={onEditWitnesses}
              className="mak-btn-secondary px-2 py-0.5 rounded text-[10px] font-semibold"
            >
              Edit Witnesses
            </button>
          )}
        </div>
        <div className="space-y-1 text-[11px] leading-snug">
          <div className="flex items-center justify-between gap-1 text-gray-200">
            <span className="truncate">
              <strong>W1:</strong> {w1.name}
              {w1.fatherName ? ` S/O ${w1.fatherName}` : ''}{' '}
              <span className="font-mono text-gray-400">({w1.cnic})</span>
            </span>
            <span className="text-[10px] shrink-0 text-emerald-300">
              {hasW1Front || hasW1Back ? '✓ ID' : ''}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 text-gray-200">
            <span className="truncate">
              <strong>W2:</strong> {w2.name}
              {w2.fatherName ? ` S/O ${w2.fatherName}` : ''}{' '}
              <span className="font-mono text-gray-400">({w2.cnic})</span>
            </span>
            <span className="text-[10px] shrink-0 text-emerald-300">
              {hasW2Front || hasW2Back ? '✓ ID' : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

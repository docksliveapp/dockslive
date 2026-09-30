import React, { useState } from 'react';
import { 
  X, Ship, FileText, Download, ShieldCheck, Truck, User, 
  MapPin, CheckCircle2, AlertCircle, FileCheck, Receipt, Layers,
  Eye, Calendar, Box, CheckCircle
} from 'lucide-react';
import { Case, Container, CaseStatus, UserRole } from '../types';
import { downloadCasePdf, downloadCustomsDeliveryOrderPdf, downloadLoadingBillPdf } from '../services/pdfExportService';
import { useBranding } from '../services/brandingService';
import { getCategoryWorkflow, getWorkflowStepIndex, isDestinationUnloadedAndGateOut } from '../services/workflowConfig';

interface FullCaseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetCase: Case | null;
  userRole?: UserRole;
  userRoles?: UserRole[];
  staffName?: string;
  onOpenWorkflowStep?: (stepId: CaseStatus, index: number, c: Case) => void;
}

export const FullCaseDetailModal: React.FC<FullCaseDetailModalProps> = ({
  isOpen,
  onClose,
  targetCase,
  userRole = UserRole.LOADING_PORT_STAFF,
  userRoles = [],
  staffName = 'Port Staff',
  onOpenWorkflowStep
}) => {
  const { customLogo, companyName } = useBranding();
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [downloadingDoc, setDownloadingDoc] = useState<string | null>(null);

  if (!isOpen || !targetCase) return null;

  const container: Container | undefined = targetCase.containers?.[0];
  const isDoneDO = isDestinationUnloadedAndGateOut(targetCase) || targetCase.status === CaseStatus.COMPLETED || targetCase.status === CaseStatus.DESTINATION_PORT_ARRIVAL;

  const handleDownloadDoc = (url: string, name: string) => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'Case_Document.pdf';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 400);
  };

  const handleDownloadSummaryPdf = async (options: { onlyCaseDetails?: boolean; onlyInvoice?: boolean; withAttachments?: boolean }) => {
    try {
      setDownloadingDoc('summary');
      await downloadCasePdf(
        targetCase,
        { companyName, customLogo },
        {
          onlyCaseDetails: options.onlyCaseDetails || false,
          onlyInvoice: options.onlyInvoice || false,
          withInvoice: !options.onlyCaseDetails,
          withAttachments: options.withAttachments || false
        }
      );
    } catch (err) {
      console.error('Failed to download PDF:', err);
      alert('Could not generate PDF. Please try again.');
    } finally {
      setDownloadingDoc(null);
    }
  };

  const handleDownloadDO = async () => {
    try {
      setDownloadingDoc('DO');
      await downloadCustomsDeliveryOrderPdf({
        targetCase,
        branding: { companyName, customLogo },
        officerName: staffName
      });
    } catch (err) {
      console.error('Failed to download DO:', err);
      alert('Could not generate Delivery Order PDF.');
    } finally {
      setDownloadingDoc(null);
    }
  };

  // Workflow info
  const categoryWorkflow = getCategoryWorkflow(targetCase.category);
  const activeIndex = getWorkflowStepIndex(targetCase.category, targetCase.status as string);
  const isCaseCompleted = targetCase.status === CaseStatus.COMPLETED;

  // Attached bills
  const attachedLoadingBills: any[] = [];
  if (Array.isArray((targetCase as any).loadingBills)) {
    (targetCase as any).loadingBills.forEach((b: any) => {
      attachedLoadingBills.push(b);
    });
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm pt-3 sm:pt-6 pb-6 px-3 sm:px-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-5xl bg-slate-900 border border-white/15 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] mb-6">
        
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center font-bold">
              <Ship size={20} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide font-mono">
                  {targetCase.caseNo}
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  targetCase.status === CaseStatus.COMPLETED ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' :
                  targetCase.status === CaseStatus.IN_TRANSIT ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' :
                  'bg-amber-500/15 text-amber-400 border-amber-500/30'
                }`}>
                  {targetCase.status}
                </span>
                <span className="text-[10px] text-brand-300 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20 font-semibold">
                  {targetCase.category}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Client: <span className="text-white font-medium">{targetCase.clientName}</span>
                {targetCase.pol && targetCase.pod && <span> • Route: <span className="text-gray-300 font-mono">{targetCase.pol} → {targetCase.pod}</span></span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isDoneDO && (
              <button
                type="button"
                onClick={handleDownloadDO}
                disabled={downloadingDoc === 'DO'}
                className="bg-teal-600 hover:bg-teal-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-teal-600/20 transition active:scale-95"
                title="Download Customs Delivery Order (DO)"
              >
                <FileCheck size={14} />
                <span>{downloadingDoc === 'DO' ? 'Generating DO...' : 'Print DO'}</span>
              </button>
            )}
            <button 
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white flex items-center justify-center transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar text-xs">
          
          {/* 3-Column Shipping, Cargo & Particulars Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* 1. General Particulars */}
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-white/5 space-y-2.5">
              <h4 className="text-brand-300 font-bold uppercase text-[11px] border-b border-white/10 pb-1.5 flex items-center gap-1.5">
                <Box size={13} />
                <span>Case Particulars</span>
              </h4>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Case No:</span>
                  <span className="text-white font-mono font-bold">{targetCase.caseNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Created Date:</span>
                  <span className="text-gray-200">{targetCase.createdAt || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Commodity:</span>
                  <span className="text-gray-200 truncate max-w-[150px]">{targetCase.extractedData?.itemDescription || targetCase.itemDescription || 'General Cargo'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Clearance Type:</span>
                  <span className="text-amber-400 font-medium">{targetCase.category}</span>
                </div>
              </div>
            </div>

            {/* 2. Shipping Details */}
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-white/5 space-y-2.5">
              <h4 className="text-brand-300 font-bold uppercase text-[11px] border-b border-white/10 pb-1.5 flex items-center gap-1.5">
                <Ship size={13} />
                <span>Shipping Details</span>
              </h4>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">B/L Number:</span>
                  <span className="text-white font-mono font-bold">{targetCase.extractedData?.blNumber || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Vessel Name:</span>
                  <span className="text-gray-200">{targetCase.extractedData?.vesselName || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Arrival Date:</span>
                  <span className="text-gray-200">{targetCase.extractedData?.arrivalDate || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Route:</span>
                  <span className="text-gray-300 font-mono text-[11px]">{targetCase.pol || '-'} ➔ {targetCase.pod || '-'}</span>
                </div>
              </div>
            </div>

            {/* 3. Cargo Specs */}
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-white/5 space-y-2.5">
              <h4 className="text-brand-300 font-bold uppercase text-[11px] border-b border-white/10 pb-1.5 flex items-center gap-1.5">
                <User size={13} />
                <span>Cargo Specs & Parties</span>
              </h4>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Shipper:</span>
                  <span className="text-gray-200 truncate max-w-[150px]">{targetCase.extractedData?.shipperName || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Consignee:</span>
                  <span className="text-gray-200 truncate max-w-[150px]">{targetCase.extractedData?.consigneeName || targetCase.clientName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Weight:</span>
                  <span className="text-white font-mono font-bold">
                    {targetCase.extractedData?.totalWeight ? `${Number(targetCase.extractedData.totalWeight).toLocaleString()} Kg` : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Packages:</span>
                  <span className="text-gray-200">{targetCase.extractedData?.packageCount || '-'}</span>
                </div>
              </div>
            </div>

          </div>

          {/* Containers Table */}
          <div className="bg-slate-950/60 rounded-2xl border border-white/5 overflow-hidden space-y-3 p-4">
            <h4 className="text-white font-bold text-xs uppercase tracking-wider flex items-center justify-between">
              <span>Assigned Containers ({targetCase.containers?.length || 0})</span>
              <span className="text-gray-400 text-[11px] font-normal">Physical freight tracking</span>
            </h4>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/5 text-gray-400 font-semibold uppercase text-[10px] border-b border-white/10">
                  <tr>
                    <th className="p-2.5">Container No</th>
                    <th className="p-2.5">Size / Type</th>
                    <th className="p-2.5">Weight (Kg)</th>
                    <th className="p-2.5">Assigned Vehicle</th>
                    <th className="p-2.5">Driver</th>
                    <th className="p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(!targetCase.containers || targetCase.containers.length === 0) ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-gray-500 italic">No containers assigned.</td>
                    </tr>
                  ) : (
                    targetCase.containers.map((c, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        <td className="p-2.5 font-mono font-bold text-white">{c.number}</td>
                        <td className="p-2.5 text-gray-300">{c.size || '40ft'}</td>
                        <td className="p-2.5 font-mono text-gray-300">{c.weight ? `${Number(c.weight).toLocaleString()} Kg` : '-'}</td>
                        <td className="p-2.5 font-mono text-amber-300 font-semibold">{c.vehicleNo || 'Awaiting'}</td>
                        <td className="p-2.5 text-gray-300">{c.driverName || '-'}</td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-500/10 text-brand-300 border border-brand-500/20">
                            {c.status || 'Active'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Itemized Billing & Service Charges Table */}
          <div className="bg-slate-950/60 rounded-2xl border border-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h4 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                <Receipt className="text-amber-400" size={15} />
                <span>Itemized Billing & Port Charges</span>
              </h4>
              <span className="text-emerald-400 font-mono font-bold text-sm">
                Total: PKR {(targetCase.charges || []).reduce((sum, ch) => sum + (Number(ch.amount) || 0), 0).toLocaleString()}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/5 text-gray-400 uppercase text-[10px] font-semibold border-b border-white/10">
                  <tr>
                    <th className="p-2.5">#</th>
                    <th className="p-2.5">Service Head / Description</th>
                    <th className="p-2.5">Category</th>
                    <th className="p-2.5 text-right">Amount (PKR)</th>
                    <th className="p-2.5 text-center">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(!targetCase.charges || targetCase.charges.length === 0) ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-gray-500 italic">No charges recorded yet.</td>
                    </tr>
                  ) : (
                    targetCase.charges.map((ch, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        <td className="p-2.5 text-gray-500 text-[10px]">{idx + 1}</td>
                        <td className="p-2.5 text-white font-medium">{ch.description}</td>
                        <td className="p-2.5 text-gray-400">{ch.category || '-'}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-emerald-400">
                          PKR {Number(ch.amount || 0).toLocaleString()}
                        </td>
                        <td className="p-2.5 text-center">
                          {ch.receiptUrl ? (
                            <button
                              type="button"
                              onClick={() => setLightboxImage(ch.receiptUrl!)}
                              className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-semibold hover:bg-emerald-500/20 transition inline-flex items-center gap-1"
                            >
                              <Eye size={11} /> View Receipt
                            </button>
                          ) : (
                            <span className="text-gray-600 text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ============================================================ */}
          {/* COMPLETE DOCUMENT DOWNLOAD SECTION (Requested by User) */}
          {/* ============================================================ */}
          <div className="bg-slate-950/80 rounded-2xl border border-white/10 p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div>
                <h4 className="text-white font-bold text-sm flex items-center gap-2">
                  <Download className="text-brand-400" size={17} />
                  <span>Complete Case Documents & Paperwork Downloads</span>
                </h4>
                <p className="text-[11px] text-gray-400">
                  Official downloadable single-page summaries, commercial invoices, loading bills, and uploaded paperwork
                </p>
              </div>
              <span className="text-[11px] font-mono text-gray-400 bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">
                {(targetCase.documents?.length || 0) + attachedLoadingBills.length + 2} Files Available
              </span>
            </div>

            <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden shadow-sm">
              
              {/* 1. Case Detail Summary PDF */}
              <div className="p-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-brand-500/15 text-brand-400 border border-brand-500/25 flex items-center justify-center shrink-0">
                    <FileText size={18} />
                  </div>
                  <div className="min-w-0">
                    <h5 className="text-xs font-bold text-white truncate">Case Detail Summary</h5>
                    <p className="text-[10px] text-gray-400 truncate">Official Single-Page Summary, Dropdowns Form & Clearance Breakdown</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownloadSummaryPdf({ onlyCaseDetails: true })}
                  className="bg-brand-600 hover:bg-brand-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-brand-600/20 transition active:scale-95 shrink-0"
                >
                  <Download size={13} />
                  <span>Download</span>
                </button>
              </div>

              {/* 2. Commercial Invoice PDF */}
              <div className="p-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/25 flex items-center justify-center shrink-0">
                    <Receipt size={18} />
                  </div>
                  <div className="min-w-0">
                    <h5 className="text-xs font-bold text-white truncate">Commercial Invoice</h5>
                    <p className="text-[10px] text-gray-400 truncate">Official Commercial Freight Terminal Invoice & Charges Breakdown</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownloadSummaryPdf({ onlyInvoice: true })}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-3.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition active:scale-95 shrink-0"
                >
                  <Download size={13} />
                  <span>Download</span>
                </button>
              </div>

              {/* 3. Customs Delivery Order (DO) if destination gate out */}
              {isDoneDO && (
                <div className="p-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition bg-teal-500/[0.03]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-teal-500/15 text-teal-300 border border-teal-500/25 flex items-center justify-center shrink-0">
                      <FileCheck size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h5 className="text-xs font-bold text-white truncate">Customs Delivery Order (DO / NOC)</h5>
                        <span className="text-[9px] font-mono font-bold bg-teal-500/20 text-teal-300 px-1.5 py-0.5 rounded">Official DO</span>
                      </div>
                      <p className="text-[10px] text-gray-400 truncate">Port Destination Container Release & Offloading NOC</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadDO}
                    className="bg-teal-600 hover:bg-teal-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-teal-600/20 transition active:scale-95 shrink-0"
                  >
                    <Download size={13} />
                    <span>Download</span>
                  </button>
                </div>
              )}

              {/* 4. Port Loading Bills (Every loading bill created for this case) */}
              {attachedLoadingBills.map((b: any, bIdx: number) => (
                <div key={b.id || b.billNo || bIdx} className="p-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition bg-amber-500/[0.02]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/25 flex items-center justify-center shrink-0">
                      <Receipt size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h5 className="text-xs font-bold text-white font-mono truncate">{b.billNo || `Loading Bill #${bIdx + 1}`}</h5>
                        <span className="text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">Port Loading Bill</span>
                      </div>
                      <p className="text-[10px] text-gray-400 truncate">
                        Date: {b.date || '-'} • Amount: <strong className="text-emerald-400 font-mono">PKR {Number(b.totalAmount || 0).toLocaleString()}</strong>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      downloadLoadingBillPdf({
                        billNo: b.billNo,
                        caseNo: targetCase.caseNo,
                        clientName: targetCase.clientName,
                        containerNo: b.containerNo || container?.number,
                        vehicleNo: b.vehicleNo || container?.vehicleNo,
                        driverName: b.driverName || container?.driverName,
                        portTerminal: b.portTerminal || targetCase.pol,
                        date: b.date,
                        items: (b.charges || b.items || []).map((ch: any) => ({
                          head: ch.head,
                          amount: ch.amount,
                          receiptName: ch.receiptName,
                          receiptUrl: ch.receiptUrl
                        })),
                        totalAmount: b.totalAmount,
                        remarks: b.remarks,
                        officerName: b.staffName || staffName,
                        branding: { companyName, customLogo }
                      }).catch(console.error);
                    }}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-3.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-amber-500/10 transition active:scale-95 shrink-0"
                  >
                    <Download size={13} />
                    <span>Download</span>
                  </button>
                </div>
              ))}

              {/* 5. All Uploaded Paperwork & Documents */}
              {targetCase.documents && targetCase.documents.map((doc: any, dIdx: number) => {
                const docName = doc.name || `Document ${dIdx + 1}`;
                const docCategory = doc.type || doc.docCategory || 'Customs Document';
                const docSrc = doc.url || (doc instanceof File ? URL.createObjectURL(doc) : '');

                return (
                  <div key={doc.id || dIdx} className="p-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 flex items-center justify-center shrink-0">
                        <FileCheck size={18} />
                      </div>
                      <div className="min-w-0">
                        <h5 className="text-xs font-bold text-white truncate" title={docName}>{docName}</h5>
                        <p className="text-[10px] text-gray-400 truncate">{docCategory}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {docSrc && (
                        <button
                          type="button"
                          onClick={() => setLightboxImage(docSrc)}
                          className="bg-white/5 hover:bg-white/10 text-gray-300 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold flex items-center gap-1 transition"
                        >
                          <Eye size={12} />
                          <span>View</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDownloadDoc(docSrc, docName)}
                        disabled={!docSrc}
                        className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-cyan-600/20 transition active:scale-95"
                      >
                        <Download size={13} />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>
                );
              })}

            </div>
          </div>

          {/* Workflow Timeline & Stages */}
          <div className="bg-slate-950/60 rounded-2xl border border-white/5 p-5 space-y-4">
            <h4 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 border-b border-white/10 pb-2">
              <Layers className="text-brand-400" size={16} />
              <span>Operational Workflow Steps</span>
            </h4>

            <div className="space-y-2.5">
              {categoryWorkflow.steps.map((stepConfig, index) => {
                const isStepCompleted = isCaseCompleted || index < activeIndex;
                const isCurrent = !isCaseCompleted && index === activeIndex;

                return (
                  <div
                    key={`fcd_step_${stepConfig.id || index}_${index}`}
                    onClick={() => {
                      if (onOpenWorkflowStep) {
                        onOpenWorkflowStep(stepConfig.id as CaseStatus, index, targetCase);
                      }
                    }}
                    className={`p-3 rounded-xl border flex items-center justify-between transition cursor-pointer ${
                      isCurrent
                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                        : isStepCompleted
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-gray-200'
                        : 'bg-white/[0.02] border-white/5 text-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        isStepCompleted ? 'bg-emerald-600 text-white' :
                        isCurrent ? 'bg-amber-500 text-slate-950 animate-pulse' :
                        'bg-slate-800 text-gray-500'
                      }`}>
                        {isStepCompleted ? '✓' : index + 1}
                      </div>
                      <span className="font-semibold text-xs">{stepConfig.title || stepConfig.shortTitle}</span>
                    </div>

                    <span className="text-[10px] font-mono">
                      {isStepCompleted ? 'Completed' : isCurrent ? 'Active In Progress' : 'Pending'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-slate-950/80 flex items-center justify-between text-xs text-gray-400 shrink-0">
          <span>Case ID: {targetCase.id}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold transition"
          >
            Close
          </button>
        </div>

      </div>

      {/* Lightbox Preview */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img 
              src={lightboxImage} 
              alt="Preview" 
              className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl" 
            />
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute top-4 right-4 bg-black/60 text-white p-2 rounded-full hover:bg-black/90 transition"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

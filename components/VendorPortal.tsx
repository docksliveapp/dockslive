import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Download, 
  Upload, 
  LogOut, 
  FileText, 
  CheckCircle2, 
  Clock, 
  DollarSign, 
  Calendar,
  AlertCircle,
  Eye,
  Paperclip,
  Check,
  Receipt,
  Wallet
} from 'lucide-react';
import Logo from './Logo';
import { useBranding } from '../services/brandingService';
import { useActiveCompany } from '../services/companyService';

interface VendorPortalProps {
  onSignOut: () => void;
  onSwitchMode?: (mode?: any) => void;
  vendorName?: string;
  vendorId?: string;
}

interface VendorInvoiceDoc {
  id: string;
  billNumber: string;
  date: string;
  description: string;
  amount: number;
  status: 'PAID' | 'PENDING' | 'APPROVED';
  receiptUrl?: string;
  slipName?: string;
  category: string;
}

export const VendorPortal: React.FC<VendorPortalProps> = ({
  onSignOut,
  vendorName = 'Al-Makkah Logistics & Equipment Services',
  vendorId = 'vendor'
}) => {
  const { customLogo, companyName } = useBranding();
  const { activeCompany } = useActiveCompany();

  // Invoices & Payment Slips
  const [invoices, setInvoices] = useState<VendorInvoiceDoc[]>([
    {
      id: 'inv_1',
      billNumber: 'INV-2026-089',
      date: '2026-09-25',
      description: 'Crane & Heavy Lift Machinery Rental (Karachi Port Wharf)',
      amount: 185000,
      status: 'PAID',
      receiptUrl: '#',
      slipName: 'bank_transfer_slip_89.pdf',
      category: 'Equipment Rental'
    },
    {
      id: 'inv_2',
      billNumber: 'INV-2026-094',
      date: '2026-09-28',
      description: 'Trailer Transport Fuel & Toll Expense Allocation',
      amount: 64000,
      status: 'APPROVED',
      receiptUrl: '#',
      category: 'Logistics / Haulage'
    },
    {
      id: 'inv_3',
      billNumber: 'INV-2026-102',
      date: '2026-09-30',
      description: 'Container Lashing, Packing & Bullet Seals Maintenance',
      amount: 42000,
      status: 'PENDING',
      category: 'Port Services'
    }
  ]);

  // Upload Modal / Form State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('Payment Slip / Bank Transfer');
  const [uploadBillNo, setUploadBillNo] = useState('');
  const [uploadAmount, setUploadAmount] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Totals
  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalPaid = invoices.filter(i => i.status === 'PAID').reduce((sum, inv) => sum + inv.amount, 0);
  const pendingAmount = totalInvoiced - totalPaid;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedFile({
        name: file.name,
        dataUrl: event.target?.result as string
      });
    };
    reader.readAsDataURL(file);
  };

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadAmount || Number(uploadAmount) <= 0) return;

    const newDoc: VendorInvoiceDoc = {
      id: `inv_${Date.now()}`,
      billNumber: uploadBillNo.trim() || `BILL-${Math.floor(1000 + Math.random() * 9000)}`,
      date: new Date().toISOString().split('T')[0],
      description: uploadDescription.trim() || 'Submitted Vendor Invoice / Payment Slip',
      amount: Number(uploadAmount),
      status: 'PENDING',
      slipName: selectedFile?.name || 'slip_document.pdf',
      receiptUrl: selectedFile?.dataUrl || '#',
      category: uploadCategory
    };

    setInvoices([newDoc, ...invoices]);
    setUploadSuccess(true);
    setTimeout(() => {
      setUploadSuccess(false);
      setShowUploadModal(false);
      setUploadBillNo('');
      setUploadAmount('');
      setUploadDescription('');
      setSelectedFile(null);
    }, 1200);
  };

  const handleDownloadStatement = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-gray-100 flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {customLogo ? (
            <img src={customLogo} alt="Logo" className="w-28 sm:w-32 h-auto object-contain" />
          ) : (
            <Logo className="w-28 sm:w-32 h-auto" />
          )}
          <div className="hidden sm:block border-l border-white/10 pl-3">
            <h1 className="text-sm font-extrabold text-amber-300 uppercase tracking-wider">
              {activeCompany?.legalTitle || activeCompany?.name || companyName || 'COMPANY OPERATIONS'}
            </h1>
            <p className="text-[10px] text-gray-400">Vendor & Supplier Portal</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-right hidden md:block">
            <div className="text-xs font-bold text-gray-200">{vendorName}</div>
            <div className="text-[10px] text-amber-400 font-mono">ID: {vendorId}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold border border-red-500/20 transition cursor-pointer"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Welcome Banner */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-slate-900 to-blue-500/10 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-semibold mb-2">
              <Building2 size={13} /> Official Vendor Portal
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-white">{vendorName}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Manage statements, track pending clearances, and upload payment slips / invoices.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadStatement}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/10 transition cursor-pointer"
            >
              <Download size={14} /> Download Statement
            </button>
            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-lg shadow-amber-500/20 transition cursor-pointer"
            >
              <Upload size={14} /> Upload Payment Slip / Bill
            </button>
          </div>
        </div>

        {/* Financial KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
            <div className="flex items-center justify-between text-gray-400 text-xs font-semibold mb-1">
              <span>Total Invoiced</span>
              <DollarSign size={15} className="text-blue-400" />
            </div>
            <div className="text-xl font-extrabold text-white font-mono">
              PKR {totalInvoiced.toLocaleString()}
            </div>
            <div className="text-[10px] text-gray-400 mt-1">{invoices.length} Invoices Submitted</div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30">
            <div className="flex items-center justify-between text-emerald-300 text-xs font-semibold mb-1">
              <span>Total Paid & Cleared</span>
              <CheckCircle2 size={15} className="text-emerald-400" />
            </div>
            <div className="text-xl font-extrabold text-emerald-300 font-mono">
              PKR {totalPaid.toLocaleString()}
            </div>
            <div className="text-[10px] text-emerald-400/80 mt-1">Disbursed to Bank Account</div>
          </div>

          <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30">
            <div className="flex items-center justify-between text-amber-300 text-xs font-semibold mb-1">
              <span>Pending Clearance</span>
              <Clock size={15} className="text-amber-400" />
            </div>
            <div className="text-xl font-extrabold text-amber-300 font-mono">
              PKR {pendingAmount.toLocaleString()}
            </div>
            <div className="text-[10px] text-amber-400/80 mt-1">Under verification / Processing</div>
          </div>
        </div>

        {/* Invoices & Payment Receipts Table */}
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt size={16} className="text-amber-400" />
              <h3 className="text-sm font-bold text-white">Invoices, Slips & Ledger History</h3>
            </div>
            <span className="text-xs text-gray-400">{invoices.length} records</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-white/5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                <tr>
                  <th className="p-3">Date & Bill #</th>
                  <th className="p-3">Description & Category</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Document / Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-white/5 transition">
                    <td className="p-3">
                      <div className="font-bold text-white">{inv.billNumber}</div>
                      <div className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                        <Calendar size={11} /> {inv.date}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="text-gray-200 font-medium">{inv.description}</div>
                      <div className="text-[10px] text-amber-400/80">{inv.category}</div>
                    </td>
                    <td className="p-3">
                      <span className="font-mono font-bold text-white text-xs">
                        PKR {inv.amount.toLocaleString()}
                      </span>
                    </td>
                    <td className="p-3">
                      {inv.status === 'PAID' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                          <CheckCircle2 size={11} /> PAID
                        </span>
                      )}
                      {inv.status === 'APPROVED' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold">
                          <Check size={11} /> APPROVED
                        </span>
                      )}
                      {inv.status === 'PENDING' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                          <Clock size={11} /> PENDING
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {inv.slipName ? (
                        <button
                          type="button"
                          onClick={() => alert(`Downloading document: ${inv.slipName}`)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200 text-[11px] font-semibold border border-white/10 transition cursor-pointer"
                        >
                          <Download size={12} /> {inv.slipName.length > 15 ? inv.slipName.slice(0, 15) + '...' : inv.slipName}
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-500">No Attachment</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Upload Payment Slip / Bill Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Upload size={18} className="text-amber-400" />
                <h3 className="text-sm font-bold text-white">Upload Payment Slip / Bill</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="text-gray-400 hover:text-white text-xs font-bold p-1"
              >
                ✕
              </button>
            </div>

            {uploadSuccess ? (
              <div className="py-8 text-center space-y-2">
                <CheckCircle2 size={40} className="text-emerald-400 mx-auto" />
                <h4 className="text-sm font-bold text-white">Slip Uploaded Successfully!</h4>
                <p className="text-xs text-gray-400">Finance department has been notified for clearance.</p>
              </div>
            ) : (
              <form onSubmit={handleUploadSubmit} className="space-y-3">
                <div>
                  <label className="text-[11px] text-gray-400 block mb-1">Document Category</label>
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="w-full rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-white"
                  >
                    <option value="Payment Slip / Bank Transfer">Payment Slip / Bank Transfer</option>
                    <option value="Vendor Invoice">Vendor Invoice / Tax Bill</option>
                    <option value="Delivery Challan">Delivery Challan / Proof of Service</option>
                    <option value="Expense Claim">Fuel / Toll / Repair Expense</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">Bill / Ref #</label>
                    <input
                      type="text"
                      value={uploadBillNo}
                      onChange={(e) => setUploadBillNo(e.target.value)}
                      placeholder="e.g. SLIP-9981"
                      className="w-full rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">Amount (PKR) *</label>
                    <input
                      type="number"
                      required
                      value={uploadAmount}
                      onChange={(e) => setUploadAmount(e.target.value)}
                      placeholder="e.g. 50000"
                      className="w-full rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-gray-400 block mb-1">Description / Notes</label>
                  <input
                    type="text"
                    value={uploadDescription}
                    onChange={(e) => setUploadDescription(e.target.value)}
                    placeholder="Details about this payment slip..."
                    className="w-full rounded-xl bg-black/40 border border-white/10 p-2 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-gray-400 block mb-1">Attach File / Slip (Image / PDF)</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileChange}
                    className="w-full text-xs text-gray-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-500/20 file:text-amber-300 hover:file:bg-amber-500/30 cursor-pointer"
                  />
                  {selectedFile && (
                    <div className="mt-1 text-[11px] text-emerald-400 flex items-center gap-1">
                      <Paperclip size={12} /> {selectedFile.name}
                    </div>
                  )}
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(false)}
                    className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md cursor-pointer"
                  >
                    Submit Slip
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorPortal;

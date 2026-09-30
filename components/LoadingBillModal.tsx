import React, { useState } from 'react';
import { X, Receipt, Plus, Trash2, Download, CheckCircle2, FileText, Camera, Upload, AlertCircle, ExternalLink } from 'lucide-react';
import { Case, CaseCharge } from '../types';
import { downloadLoadingBillPdf, LoadingBillData, LoadingBillItem } from '../services/pdfExportService';
import { WorkflowMultiUploader } from './WorkflowMultiUploader';
import { getPortInquiryLink } from '../services/portInquiryService';
import { saveStaffBillToFirestore, saveStaffPrivateLedgerEntryToFirestore } from '../services/dbService';
import { safeAppStorage } from '../services/storage';
import { convertImageToPdf } from '../services/fileUtils';

interface ExtraChargeItem {
  id: string;
  head: string;
  amount: number;
  receiptUrl?: string;
  receiptName?: string;
}

interface LoadingBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetCase: Case;
  onSaveBill?: (billData: any, newCharges: CaseCharge[], newDocs: any[]) => void;
  branding?: any;
}

export const LoadingBillModal: React.FC<LoadingBillModalProps> = ({
  isOpen,
  onClose,
  targetCase,
  onSaveBill,
  branding
}) => {
  if (!isOpen) return null;

  const initialWf: Record<string, any> = targetCase.workflowDetails || {};
  const loadingStepDetail: any = initialWf[targetCase.status] || initialWf['LOADING_PORT_PROCESSING'] || {};

  // Form states
  const [billNo, setBillNo] = useState(`LB-${targetCase.caseNo?.replace(/[^a-zA-Z0-9]/g, '') || 'PORT'}-${Date.now().toString().slice(-4)}`);
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [portTerminal, setPortTerminal] = useState(targetCase.pol || 'KICT Port Terminal, Karachi');
  const [containerNo, setContainerNo] = useState(targetCase.containers?.[0]?.number || targetCase.containerNumber || '');
  const [vehicleNo, setVehicleNo] = useState(targetCase.containers?.[0]?.vehicleNo || loadingStepDetail.assignedVehicleNo || '');
  const [driverName, setDriverName] = useState(targetCase.containers?.[0]?.driverName || loadingStepDetail.driverName || '');
  const [remarks, setRemarks] = useState('Terminal handling, wharfage, tracker and gate dispatch charges.');

  // Standard charges
  const [wharfageAmount, setWharfageAmount] = useState<number>(Number(loadingStepDetail.wharfageAmount) || 0);
  const [wharfageReceiptUrl, setWharfageReceiptUrl] = useState<string>(loadingStepDetail.wharfageReceiptUrl || '');
  const [wharfageReceiptName, setWharfageReceiptName] = useState<string>(loadingStepDetail.wharfageReceiptName || '');

  const [addnlWharfageAmount, setAddnlWharfageAmount] = useState<number>(0);
  const [addnlWharfageReceiptUrl, setAddnlWharfageReceiptUrl] = useState<string>('');
  const [addnlWharfageReceiptName, setAddnlWharfageReceiptName] = useState<string>('');

  const [trackerAmount, setTrackerAmount] = useState<number>(Number(loadingStepDetail.trackerAmount) || 0);
  const [trackerReceiptUrl, setTrackerReceiptUrl] = useState<string>('');
  const [trackerReceiptName, setTrackerReceiptName] = useState<string>('');

  const [deliveryCharges, setDeliveryCharges] = useState<number>(Number(loadingStepDetail.loadingChargesAmount) || 0);
  const [deliveryReceiptUrl, setDeliveryReceiptUrl] = useState<string>('');
  const [deliveryReceiptName, setDeliveryReceiptName] = useState<string>('');

  // Extra charges list
  const [extraCharges, setExtraCharges] = useState<ExtraChargeItem[]>([]);
  const [showAddExtraModal, setShowAddExtraModal] = useState(false);
  const [newExtraHead, setNewExtraHead] = useState('');
  const [newExtraAmount, setNewExtraAmount] = useState<number | ''>('');
  const [newExtraReceiptUrl, setNewExtraReceiptUrl] = useState('');
  const [newExtraReceiptName, setNewExtraReceiptName] = useState('');

  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Calculate live total
  const standardTotal = Number(wharfageAmount || 0) + Number(addnlWharfageAmount || 0) + Number(trackerAmount || 0) + Number(deliveryCharges || 0);
  const extraTotal = extraCharges.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const grandTotal = standardTotal + extraTotal;

  // Process receipt file upload or camera picture with scan enhancement into PDF
  const handleReceiptScanOrUpload = async (
    file: File | undefined,
    setUrl: (u: string) => void,
    setName: (n: string) => void,
    defaultLabel: string
  ) => {
    if (!file) return;
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        const converted = await convertImageToPdf(file, `${defaultLabel}_Receipt.pdf`, true);
        setUrl(converted.pdfDataUrl);
        setName(converted.name);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          setUrl((e.target?.result as string) || '');
          setName(file.name);
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      console.warn("Scan processing fallback:", err);
      const url = URL.createObjectURL(file);
      setUrl(url);
      setName(file.name);
    }
  };

  const handleAddExtraCharge = () => {
    if (!newExtraHead.trim()) {
      alert('Please enter a charge head title');
      return;
    }
    if (!newExtraAmount || Number(newExtraAmount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    const newItem: ExtraChargeItem = {
      id: `extra_${Date.now()}`,
      head: newExtraHead.trim(),
      amount: Number(newExtraAmount),
      receiptUrl: newExtraReceiptUrl,
      receiptName: newExtraReceiptName || `${newExtraHead.trim()}_Receipt.png`
    };

    setExtraCharges(prev => [...prev, newItem]);
    setNewExtraHead('');
    setNewExtraAmount('');
    setNewExtraReceiptUrl('');
    setNewExtraReceiptName('');
    setShowAddExtraModal(false);
  };

  const handleRemoveExtraCharge = (id: string) => {
    setExtraCharges(prev => prev.filter(item => item.id !== id));
  };

  const handleDownloadPdf = async () => {
    try {
      setIsGeneratingPdf(true);
      const items: LoadingBillItem[] = [];

      if (wharfageAmount > 0) {
        items.push({
          head: 'Wharfage Terminal Payment',
          amount: wharfageAmount,
          receiptUrl: wharfageReceiptUrl,
          receiptName: wharfageReceiptName
        });
      }
      if (addnlWharfageAmount > 0) {
        items.push({
          head: 'Additional Wharfage Payment',
          amount: addnlWharfageAmount,
          receiptUrl: addnlWharfageReceiptUrl,
          receiptName: addnlWharfageReceiptName
        });
      }
      if (trackerAmount > 0) {
        items.push({
          head: 'Satellite GPS Tracker Payment',
          amount: trackerAmount,
          receiptUrl: trackerReceiptUrl,
          receiptName: trackerReceiptName
        });
      }
      if (deliveryCharges > 0) {
        items.push({
          head: 'Port Delivery / Terminal Gate Charges',
          amount: deliveryCharges,
          receiptUrl: deliveryReceiptUrl,
          receiptName: deliveryReceiptName
        });
      }

      extraCharges.forEach(ex => {
        items.push({
          head: ex.head,
          amount: ex.amount,
          receiptUrl: ex.receiptUrl,
          receiptName: ex.receiptName
        });
      });

      const pdfData: LoadingBillData = {
        billNo,
        caseNo: targetCase.caseNo,
        clientName: targetCase.clientName,
        containerNo,
        vehicleNo,
        driverName,
        portTerminal,
        date: billDate,
        items,
        totalAmount: grandTotal,
        remarks,
        branding
      };

      await downloadLoadingBillPdf(pdfData);
    } catch (e) {
      console.error('Failed to generate Loading Bill PDF', e);
      alert('Error generating Loading Bill PDF');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleSaveAndSync = () => {
    const newCharges: CaseCharge[] = [];
    const newDocs: any[] = [];

    const now = Date.now();

    if (wharfageAmount > 0) {
      newCharges.push({
        id: `chg_wharfage_${now}`,
        description: 'Wharfage Terminal Payment',
        category: 'Port Terminal',
        amount: wharfageAmount,
        receiptUrl: wharfageReceiptUrl,
        receiptName: wharfageReceiptName || 'Wharfage_Receipt.png',
        taxable: false,
        arrangedBy: 'DPL'
      });
      if (wharfageReceiptUrl) {
        newDocs.push({
          id: `doc_wharfage_${now}`,
          name: wharfageReceiptName || 'Wharfage Payment Receipt',
          type: 'Payment Receipt',
          url: wharfageReceiptUrl,
          uploadedAt: new Date().toISOString()
        });
      }
    }

    if (addnlWharfageAmount > 0) {
      newCharges.push({
        id: `chg_addnl_wharfage_${now}`,
        description: 'Additional Wharfage Payment',
        category: 'Port Terminal',
        amount: addnlWharfageAmount,
        receiptUrl: addnlWharfageReceiptUrl,
        receiptName: addnlWharfageReceiptName || 'Addnl_Wharfage_Receipt.png',
        taxable: false,
        arrangedBy: 'DPL'
      });
      if (addnlWharfageReceiptUrl) {
        newDocs.push({
          id: `doc_addnl_wharfage_${now}`,
          name: addnlWharfageReceiptName || 'Additional Wharfage Receipt',
          type: 'Payment Receipt',
          url: addnlWharfageReceiptUrl,
          uploadedAt: new Date().toISOString()
        });
      }
    }

    if (trackerAmount > 0) {
      newCharges.push({
        id: `chg_tracker_${now}`,
        description: 'Tracker Payment',
        category: 'Tracker / Security',
        amount: trackerAmount,
        receiptUrl: trackerReceiptUrl,
        receiptName: trackerReceiptName || 'Tracker_Receipt.png',
        taxable: false,
        arrangedBy: 'DPL'
      });
      if (trackerReceiptUrl) {
        newDocs.push({
          id: `doc_tracker_${now}`,
          name: trackerReceiptName || 'GPS Tracker Payment Receipt',
          type: 'Payment Receipt',
          url: trackerReceiptUrl,
          uploadedAt: new Date().toISOString()
        });
      }
    }

    if (deliveryCharges > 0) {
      newCharges.push({
        id: `chg_delivery_${now}`,
        description: 'Delivery Charges (Port Terminal)',
        category: 'Port Terminal',
        amount: deliveryCharges,
        receiptUrl: deliveryReceiptUrl,
        receiptName: deliveryReceiptName || 'Delivery_Charges_Receipt.png',
        taxable: false,
        arrangedBy: 'DPL'
      });
      if (deliveryReceiptUrl) {
        newDocs.push({
          id: `doc_delivery_${now}`,
          name: deliveryReceiptName || 'Port Delivery Charges Receipt',
          type: 'Payment Receipt',
          url: deliveryReceiptUrl,
          uploadedAt: new Date().toISOString()
        });
      }
    }

    extraCharges.forEach((ex, idx) => {
      newCharges.push({
        id: `chg_extra_${now}_${idx}`,
        description: ex.head,
        category: 'Extra Port Charges',
        amount: ex.amount,
        receiptUrl: ex.receiptUrl,
        receiptName: ex.receiptName,
        taxable: false,
        arrangedBy: 'DPL'
      });
      if (ex.receiptUrl) {
        newDocs.push({
          id: `doc_extra_${now}_${idx}`,
          name: ex.receiptName || `${ex.head} Receipt`,
          type: 'Payment Receipt',
          url: ex.receiptUrl,
          uploadedAt: new Date().toISOString()
        });
      }
    });

    const billData = {
      billNo,
      date: billDate,
      totalAmount: grandTotal,
      portTerminal,
      containerNo,
      vehicleNo,
      driverName,
      remarks,
      items: [
        { head: 'Wharfage Payment', amount: wharfageAmount, receiptUrl: wharfageReceiptUrl, receiptName: wharfageReceiptName },
        { head: 'Additional Wharfage Payment', amount: addnlWharfageAmount, receiptUrl: addnlWharfageReceiptUrl, receiptName: addnlWharfageReceiptName },
        { head: 'Tracker Payment', amount: trackerAmount, receiptUrl: trackerReceiptUrl, receiptName: trackerReceiptName },
        { head: 'Delivery Charges', amount: deliveryCharges, receiptUrl: deliveryReceiptUrl, receiptName: deliveryReceiptName },
        ...extraCharges
      ]
    };

    // Also add the Loading Bill PDF document to the case's document downloads list
    newDocs.push({
      id: `doc_lb_${billNo}`,
      name: `Loading Bill - ${billNo}.pdf`,
      type: 'Port Loading Bill',
      billNo,
      totalAmount: grandTotal,
      url: '',
      uploadedAt: new Date().toISOString()
    });

    const staffId = safeAppStorage.getItem('dpl_current_user_id') || 'mohsin';
    const staffName = safeAppStorage.getItem('dpl_current_user_name') || 'Mohsin Khan';

    // Save to Staff Loading Bills repository
    saveStaffBillToFirestore({
      id: `bill_${billNo}`,
      billNo,
      caseId: targetCase.id,
      caseNo: targetCase.caseNo,
      containerNo: containerNo || '',
      clientName: targetCase.clientName || '',
      vehicleNo: vehicleNo || '',
      driverName: driverName || '',
      portTerminal: portTerminal || '',
      date: billDate,
      totalAmount: grandTotal,
      paidAmount: 0,
      balanceDue: grandTotal,
      status: 'PENDING',
      charges: billData.items,
      remarks,
      staffUserId: staffId,
      staffName,
      createdAt: new Date().toISOString()
    }).catch(err => console.warn('Could not save staff bill to db:', err));

    // Post to Client's dedicated Loading Ledger as a DEBIT
    if (targetCase.clientName && grandTotal > 0) {
      saveStaffPrivateLedgerEntryToFirestore({
        id: `ledger_${billNo}_${Date.now()}`,
        staffUserId: staffId,
        staffName,
        clientName: targetCase.clientName,
        date: billDate,
        reference: billNo,
        description: `Port Loading Bill - Case #${targetCase.caseNo} (${containerNo || 'Container'})`,
        type: 'DEBIT',
        debit: grandTotal,
        credit: 0,
        balance: grandTotal,
        caseNo: targetCase.caseNo,
        containerNo: containerNo || '',
        createdAt: new Date().toISOString()
      }).catch(err => console.warn('Could not save client loading ledger entry:', err));
    }

    if (onSaveBill) {
      onSaveBill(billData, newCharges, newDocs);
    }

    setSaveSuccessMsg(`Loading Bill saved successfully! Total PKR ${grandTotal.toLocaleString('en-PK')} added.`);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 z-[120] flex items-start justify-center pt-4 sm:pt-8 p-3 sm:p-5 backdrop-blur-md overflow-y-auto no-print"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-900 rounded-3xl overflow-hidden max-w-2xl w-full border border-sky-500/30 shadow-2xl animate-fade-in flex flex-col mb-10">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex justify-between items-center bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-500/40">
              <Receipt size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white">Make Loading Bill</h3>
                <span className="text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full font-semibold">
                  Port Terminal Invoice
                </span>
              </div>
              <p className="text-xs text-gray-400">
                Case: <span className="text-amber-300 font-mono font-semibold">{targetCase.caseNo}</span> • Container: <span className="text-white font-mono">{containerNo || 'N/A'}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-5 text-xs">
          {saveSuccessMsg && (
            <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-xl flex items-center gap-2 text-emerald-300">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}

          {/* Quick Particulars Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-2xl bg-white/[0.02] border border-white/10">
            <div>
              <span className="text-[10px] text-gray-400 block">Bill Number</span>
              <input 
                type="text"
                value={billNo}
                onChange={(e) => setBillNo(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-white font-mono text-[11px]"
              />
            </div>
            <div>
              <span className="text-[10px] text-gray-400 block">Bill Date</span>
              <input 
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-white text-[11px]"
              />
            </div>
            <div>
              <span className="text-[10px] text-gray-400 block">Vehicle Reg</span>
              <input 
                type="text"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
                placeholder="Vehicle No"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-white font-mono text-[11px] uppercase"
              />
            </div>
            <div>
              <span className="text-[10px] text-gray-400 block">Terminal / Port</span>
              <input 
                type="text"
                value={portTerminal}
                onChange={(e) => setPortTerminal(e.target.value)}
                placeholder="Port terminal"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-white text-[11px]"
              />
            </div>
          </div>

          {/* Standard Charges List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-xs uppercase tracking-wider">
                Standard Loading & Terminal Charges:
              </span>
              <span className="text-gray-400 text-[11px]">Attach official payment slips</span>
            </div>

            {/* 1. Wharfage Payment */}
            <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="font-bold text-white block">Wharfage Payment</span>
                <span className="text-[11px] text-gray-400">Terminal handling & port wharfage slip</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const inquiryLink = getPortInquiryLink(portTerminal || targetCase.pol);
                    window.open(inquiryLink, '_blank', 'noopener,noreferrer');
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-bold text-[11px] flex items-center gap-1.5 transition active:scale-95 shrink-0"
                  title="Check wharfage amount on official port terminal website"
                >
                  <ExternalLink size={12} />
                  <span>Check Wharfage Amount</span>
                </button>
                <div className="relative w-36">
                  <span className="absolute left-2.5 top-2 text-[10px] text-gray-400">PKR</span>
                  <input
                    type="number"
                    value={wharfageAmount || ''}
                    onChange={(e) => setWharfageAmount(Number(e.target.value))}
                    placeholder="0"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl pl-9 pr-2 py-1.5 text-white font-mono font-bold text-right outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Camera Snap & AI Scan Button */}
                  <label className="p-1.5 rounded-xl border border-amber-500/30 bg-amber-500/15 hover:bg-amber-500/25 active:bg-amber-500/35 text-amber-300 cursor-pointer flex items-center justify-center transition-colors shadow-sm" title="Scan receipt with Camera">
                    <Camera size={14} />
                    <input 
                      type="file" 
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setWharfageReceiptUrl, setWharfageReceiptName, 'Wharfage')}
                    />
                  </label>
                  {/* Upload File Button */}
                  <label className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold cursor-pointer flex items-center gap-1.5 transition-colors ${
                    wharfageReceiptUrl ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-900 text-gray-300 border-white/10 hover:bg-white/5'
                  }`}>
                    <Upload size={13} />
                    <span className="truncate max-w-[100px]">{wharfageReceiptUrl ? 'Receipt ✓' : 'Upload'}</span>
                    <input 
                      type="file" 
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setWharfageReceiptUrl, setWharfageReceiptName, 'Wharfage')}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* 2. Additional Wharfage Payment */}
            <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="font-bold text-white block">Additional Wharfage Payment</span>
                <span className="text-[11px] text-gray-400">Excess weight, late surcharge, or terminal extension</span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <div className="relative w-36">
                  <span className="absolute left-2.5 top-2 text-[10px] text-gray-400">PKR</span>
                  <input
                    type="number"
                    value={addnlWharfageAmount || ''}
                    onChange={(e) => setAddnlWharfageAmount(Number(e.target.value))}
                    placeholder="0"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl pl-9 pr-2 py-1.5 text-white font-mono font-bold text-right outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <label className="p-1.5 rounded-xl border border-amber-500/30 bg-amber-500/15 hover:bg-amber-500/25 active:bg-amber-500/35 text-amber-300 cursor-pointer flex items-center justify-center transition-colors shadow-sm" title="Scan receipt with Camera">
                    <Camera size={14} />
                    <input 
                      type="file" 
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setAddnlWharfageReceiptUrl, setAddnlWharfageReceiptName, 'Addnl_Wharfage')}
                    />
                  </label>
                  <label className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold cursor-pointer flex items-center gap-1.5 transition-colors ${
                    addnlWharfageReceiptUrl ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-900 text-gray-300 border-white/10 hover:bg-white/5'
                  }`}>
                    <Upload size={13} />
                    <span className="truncate max-w-[100px]">{addnlWharfageReceiptUrl ? 'Receipt ✓' : 'Upload'}</span>
                    <input 
                      type="file" 
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setAddnlWharfageReceiptUrl, setAddnlWharfageReceiptName, 'Addnl_Wharfage')}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* 3. Tracker Payment */}
            <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="font-bold text-white block">Tracker Payment</span>
                <span className="text-[11px] text-gray-400">Satellite GPS unit installation fee</span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <div className="relative w-36">
                  <span className="absolute left-2.5 top-2 text-[10px] text-gray-400">PKR</span>
                  <input
                    type="number"
                    value={trackerAmount || ''}
                    onChange={(e) => setTrackerAmount(Number(e.target.value))}
                    placeholder="0"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl pl-9 pr-2 py-1.5 text-white font-mono font-bold text-right outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <label className="p-1.5 rounded-xl border border-amber-500/30 bg-amber-500/15 hover:bg-amber-500/25 active:bg-amber-500/35 text-amber-300 cursor-pointer flex items-center justify-center transition-colors shadow-sm" title="Scan receipt with Camera">
                    <Camera size={14} />
                    <input 
                      type="file" 
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setTrackerReceiptUrl, setTrackerReceiptName, 'Tracker')}
                    />
                  </label>
                  <label className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold cursor-pointer flex items-center gap-1.5 transition-colors ${
                    trackerReceiptUrl ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-900 text-gray-300 border-white/10 hover:bg-white/5'
                  }`}>
                    <Upload size={13} />
                    <span className="truncate max-w-[100px]">{trackerReceiptUrl ? 'Receipt ✓' : 'Upload'}</span>
                    <input 
                      type="file" 
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setTrackerReceiptUrl, setTrackerReceiptName, 'Tracker')}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* 4. Delivery Charges */}
            <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="font-bold text-white block">Delivery Charges</span>
                <span className="text-[11px] text-gray-400">Port gate out, lifter or handling charges</span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <div className="relative w-36">
                  <span className="absolute left-2.5 top-2 text-[10px] text-gray-400">PKR</span>
                  <input
                    type="number"
                    value={deliveryCharges || ''}
                    onChange={(e) => setDeliveryCharges(Number(e.target.value))}
                    placeholder="0"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl pl-9 pr-2 py-1.5 text-white font-mono font-bold text-right outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <label className="p-1.5 rounded-xl border border-amber-500/30 bg-amber-500/15 hover:bg-amber-500/25 active:bg-amber-500/35 text-amber-300 cursor-pointer flex items-center justify-center transition-colors shadow-sm" title="Scan receipt with Camera">
                    <Camera size={14} />
                    <input 
                      type="file" 
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setDeliveryReceiptUrl, setDeliveryReceiptName, 'Delivery')}
                    />
                  </label>
                  <label className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold cursor-pointer flex items-center gap-1.5 transition-colors ${
                    deliveryReceiptUrl ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-900 text-gray-300 border-white/10 hover:bg-white/5'
                  }`}>
                    <Upload size={13} />
                    <span className="truncate max-w-[100px]">{deliveryReceiptUrl ? 'Receipt ✓' : 'Upload'}</span>
                    <input 
                      type="file" 
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setDeliveryReceiptUrl, setDeliveryReceiptName, 'Delivery')}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Extra Dynamic Charges List */}
          {extraCharges.length > 0 && (
            <div className="space-y-2 pt-2">
              <span className="font-bold text-sky-400 text-xs uppercase tracking-wider block">
                Additional / Extra Disbursed Charges:
              </span>
              {extraCharges.map((ex, idx) => (
                <div key={`extra_chg_${ex.id || idx}_${idx}`} className="p-3 rounded-2xl bg-sky-500/5 border border-sky-500/20 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-white block">{ex.head}</span>
                    <span className="text-[11px] text-emerald-400">
                      {ex.receiptUrl ? `✓ Receipt Attached: ${ex.receiptName || 'File'}` : 'No receipt attached'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono font-bold text-white text-sm">
                      PKR {ex.amount.toLocaleString('en-PK')}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveExtraCharge(ex.id)}
                      className="text-gray-400 hover:text-rose-400 p-1 rounded-lg"
                      title="Remove charge"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add Extra Charges Button */}
          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => setShowAddExtraModal(true)}
              className="bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Plus size={15} />
              <span>Add Extra Charges</span>
            </button>
          </div>

          {/* Total & Summary Box */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-sky-500/30 flex items-center justify-between">
            <div>
              <span className="text-gray-400 text-xs block">Total Loading Bill Due:</span>
              <span className="text-[11px] text-gray-500">{itemsCount(wharfageAmount, addnlWharfageAmount, trackerAmount, deliveryCharges, extraCharges.length)} items listed</span>
            </div>
            <div className="text-right">
              <span className="font-mono font-black text-xl text-sky-400">
                PKR {grandTotal.toLocaleString('en-PK')}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/10 bg-slate-950/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white hover:bg-white/10"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={isGeneratingPdf}
              onClick={handleDownloadPdf}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold border border-white/10 flex items-center gap-1.5 shadow transition-all active:scale-95"
            >
              <Download size={14} />
              <span>{isGeneratingPdf ? 'Generating...' : 'Download Loading Bill (PDF)'}</span>
            </button>

            <button
              type="button"
              onClick={handleSaveAndSync}
              className="bg-sky-600 hover:bg-sky-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-sky-600/30 flex items-center gap-1.5 transition-all active:scale-95"
            >
              <CheckCircle2 size={15} />
              <span>Save & Apply to Case</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Modal: Add Extra Charge */}
      {showAddExtraModal && (
        <div className="fixed inset-0 bg-black/85 z-[140] flex items-start justify-center pt-8 sm:pt-14 p-4 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-sky-500/40 rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-fade-in">
            <div className="flex items-center justify-between text-white">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <Plus size={16} className="text-sky-400" />
                <span>Add Extra Loading Charge</span>
              </h4>
              <button
                type="button"
                onClick={() => setShowAddExtraModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Charge Head / Description *</label>
                <input 
                  type="text"
                  value={newExtraHead}
                  onChange={(e) => setNewExtraHead(e.target.value)}
                  placeholder="e.g. Weighbridge slip, Terminal detention, Labor / Lifter extra"
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="text-gray-300 font-semibold block mb-1">Amount (PKR) *</label>
                <input 
                  type="number"
                  value={newExtraAmount}
                  onChange={(e) => setNewExtraAmount(e.target.value ? Number(e.target.value) : '')}
                  placeholder="e.g. 3500"
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-gray-300 font-semibold block mb-1">Receipt Attachment (PDF / Camera Scan)</label>
                <div className="flex items-center gap-2">
                  <label className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/15 hover:bg-amber-500/25 active:bg-amber-500/35 text-amber-300 cursor-pointer flex items-center justify-center transition-colors shadow-sm" title="Scan receipt with Camera">
                    <Camera size={16} />
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setNewExtraReceiptUrl, setNewExtraReceiptName, newExtraHead || 'Extra')}
                    />
                  </label>
                  <label className="flex-1 p-2.5 border border-dashed border-white/20 hover:border-amber-400/80 rounded-xl flex items-center justify-center gap-2 cursor-pointer bg-slate-800 hover:bg-slate-700 text-gray-300 transition-colors">
                    <Upload size={14} />
                    <span className="truncate text-xs">{newExtraReceiptUrl ? `Attached: ${newExtraReceiptName || 'File'}` : 'Upload receipt file or take photo'}</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => handleReceiptScanOrUpload(e.target.files?.[0], setNewExtraReceiptUrl, setNewExtraReceiptName, newExtraHead || 'Extra')}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddExtraModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddExtraCharge}
                className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-xl text-xs font-bold"
              >
                Add Charge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function itemsCount(w: number, a: number, t: number, d: number, extras: number): number {
  let count = extras;
  if (w > 0) count++;
  if (a > 0) count++;
  if (t > 0) count++;
  if (d > 0) count++;
  return count;
}

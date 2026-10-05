import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Coins, 
  Sparkles, 
  TrendingUp, 
  Wallet, 
  ArrowUpRight, 
  ArrowDownLeft, 
  X, 
  ChevronRight, 
  RefreshCw, 
  ShieldCheck,
  Building2,
  FileText
} from 'lucide-react';
import { subscribeToFinances } from '../services/dbService';
import { FinanceEntry } from '../types';
import { useActiveCompany } from '../services/companyService';

interface GoldenAmountWidgetProps {
  onOpenFinance?: (tab?: string) => void;
  variant?: 'header' | 'sidebar';
}

export const GoldenAmountWidget: React.FC<GoldenAmountWidgetProps> = ({ 
  onOpenFinance,
  variant = 'header'
}) => {
  const { activeCompany } = useActiveCompany();
  const [isOpen, setIsOpen] = useState(false);
  const [finances, setFinances] = useState<FinanceEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const unsub = subscribeToFinances(
      (items) => setFinances(items),
      () => {}
    );
    return () => unsub();
  }, []);

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Compute live amounts purely from Firestore finances (starts at 0 for fresh live app)
  const { totalRevenue, totalReceivables, cashBankBalance, pendingPayables } = React.useMemo(() => {
    let income = 0;
    let expense = 0;
    let receivables = 0;
    let payables = 0;

    finances.forEach(f => {
      const amt = Number(f.amount) || 0;
      if (f.type === 'INCOME') income += amt;
      else if (f.type === 'EXPENSE') expense += amt;
      else if (f.type === 'RECEIVABLE') receivables += amt;
      else if (f.type === 'PAYABLE') payables += amt;
    });

    return {
      totalRevenue: income,
      totalReceivables: receivables,
      cashBankBalance: Math.max(0, income - expense),
      pendingPayables: payables
    };
  }, [finances]);

  const formatPKR = (val: number) => {
    return `PKR ${val.toLocaleString('en-PK')}`;
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Modal Portal JSX (Mounted directly to document.body to prevent any backdrop or z-index clipping)
  const modalContent = isOpen && mounted ? createPortal(
    <div 
      className="fixed inset-0 z-[999999] flex items-start justify-center pt-3 sm:pt-6 pb-6 px-3 sm:px-6 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.88)' }}
      onClick={() => setIsOpen(false)}
    >
      {/* 100% Solid Opaque Modal Card */}
      <div 
        className="w-full max-w-md rounded-2xl border-2 border-amber-400 shadow-2xl shadow-black overflow-hidden relative mb-6 animate-scale-up select-none max-h-[92vh] flex flex-col"
        style={{ backgroundColor: '#0b1120' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Solid Golden Metallic Header */}
        <div className="bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 p-4 sm:p-5 text-amber-950 relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-950/25 flex items-center justify-center text-amber-950 font-black shadow-inner">
                <Coins size={22} className="text-amber-950" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black tracking-tight leading-tight">
                  {activeCompany?.shortName || 'MAK'} Treasury & Balance
                </h3>
                <p className="text-xs font-bold text-amber-950/80">
                  Treasury & Balance Summary
                </p>
              </div>
            </div>

            {/* Clear Close Button */}
            <button 
              type="button"
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 rounded-full bg-amber-950/20 hover:bg-amber-950/40 text-amber-950 flex items-center justify-center transition cursor-pointer font-bold"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Big Amount Card */}
          <div className="mt-4 pt-3 border-t border-amber-950/20">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-amber-950/80">
              Total Operating Volume
            </div>
            <div className="text-2xl sm:text-3xl font-black text-amber-950 font-mono tracking-tight mt-0.5">
              {formatPKR(totalRevenue)}
            </div>
          </div>
        </div>

        {/* Content Breakdown - Completely Solid Cards */}
        <div className="p-4 sm:p-5 space-y-3 overflow-y-auto flex-1 custom-scrollbar" style={{ backgroundColor: '#0b1120' }}>
          
          {/* Card 1: Cash in Hand & Bank */}
          <div 
            className="rounded-xl p-3.5 border border-emerald-500/30 flex items-center justify-between"
            style={{ backgroundColor: '#131d2e' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                <ArrowDownLeft size={20} />
              </div>
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Cash & Bank</span>
                </div>
                <div className="text-[11px] text-gray-400">Available Liquid Funds</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm sm:text-base font-bold text-emerald-400 font-mono">
                {formatPKR(cashBankBalance)}
              </div>
              <span className="text-[10px] text-emerald-500 font-semibold uppercase">Liquid</span>
            </div>
          </div>

          {/* Card 2: Client Receivables */}
          <div 
            className="rounded-xl p-3.5 border border-blue-500/30 flex items-center justify-between"
            style={{ backgroundColor: '#131d2e' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
                <TrendingUp size={20} />
              </div>
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Receivables</span>
                </div>
                <div className="text-[11px] text-gray-400">Invoiced & Pending Collections</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm sm:text-base font-bold text-blue-400 font-mono">
                {formatPKR(totalReceivables)}
              </div>
              <span className="text-[10px] text-blue-400 font-semibold uppercase">Pending</span>
            </div>
          </div>

          {/* Card 3: Pending Payables */}
          <div 
            className="rounded-xl p-3.5 border border-amber-500/30 flex items-center justify-between"
            style={{ backgroundColor: '#131d2e' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                <ArrowUpRight size={20} />
              </div>
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Payables</span>
                </div>
                <div className="text-[11px] text-gray-400">Port Wharfage & Vendor Dues</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm sm:text-base font-bold text-amber-400 font-mono">
                {formatPKR(pendingPayables)}
              </div>
              <span className="text-[10px] text-amber-400 font-semibold uppercase">Due</span>
            </div>
          </div>

          {/* Real-time sync bar */}
          <div className="pt-2 flex items-center justify-between text-xs px-1">
            <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
              <ShieldCheck size={15} />
              <span>Real-time Live Sync Active</span>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 font-semibold cursor-pointer"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Direct Button to open Full Finance Ledger */}
          {onOpenFinance && (
            <button
              type="button"
              id="open-full-finance-modal-btn"
              onClick={() => {
                setIsOpen(false);
                onOpenFinance('receivables');
              }}
              className="w-full mt-3 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-amber-950 font-black text-sm flex items-center justify-center gap-2 hover:brightness-105 shadow-xl shadow-amber-500/20 transition cursor-pointer"
            >
              <FileText size={17} />
              <span>Open Full Ledger</span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      {variant === 'sidebar' ? (
        /* Sidebar Amount Counter (Placed directly beside Finance in sidebar) */
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              setIsOpen(true);
            }
          }}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-amber-500/40 bg-gradient-to-r from-amber-500/20 via-yellow-500/15 to-amber-600/20 hover:from-amber-500/30 hover:to-amber-400/30 text-amber-300 hover:text-amber-200 transition-all duration-150 cursor-pointer shadow-sm active:scale-95 group/counter"
          title="Total Available Amount Counter & Treasury (Click for breakdown)"
        >
          <Coins size={11} className="text-amber-400 shrink-0 group-hover/counter:rotate-12 transition-transform" />
          <span className="text-[10px] font-mono font-black tracking-tight text-amber-300 whitespace-nowrap">
            {totalRevenue >= 1000000 
              ? `Rs ${(totalRevenue / 1000000).toFixed(1)}M` 
              : totalRevenue >= 1000 
                ? `Rs ${(totalRevenue / 1000).toFixed(0)}K` 
                : `PKR ${totalRevenue.toLocaleString('en-PK')}`}
          </span>
        </div>
      ) : (
        /* Top Header Sone se Amount Button (Fallback) */
        <button
          type="button"
          id="golden-amount-header-btn"
          onClick={() => setIsOpen(true)}
          className="relative group overflow-hidden flex items-center gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 h-8 sm:h-9 rounded-xl border transition-all duration-200 transform active:scale-95 cursor-pointer shadow-sm
            bg-slate-800/90 hover:bg-slate-700/90
            border-amber-500/40 hover:border-amber-400
            text-amber-300 hover:text-amber-200 shrink-0"
          title={`${activeCompany?.name || 'Company'} Treasury & Amount Balance`}
        >
          {/* Subtle Animated Glow Effect */}
          <div className="absolute inset-0 bg-amber-500/5 group-hover:bg-amber-500/10 transition-colors pointer-events-none" />

          {/* Small Golden Coin Icon */}
          <div className="flex items-center justify-center w-5 h-5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
            <Coins size={12} className="text-amber-400" />
          </div>

          {/* Amount Display with Compact Crisp Typography */}
          <span className="text-[11px] sm:text-xs font-extrabold font-mono text-amber-300 tracking-tight whitespace-nowrap">
            <span className="hidden md:inline">{formatPKR(totalRevenue)}</span>
            <span className="inline md:hidden">Rs {(totalRevenue / 1000000).toFixed(1)}M</span>
          </span>
        </button>
      )}

      {/* Render Portal Modal directly to document.body */}
      {modalContent}
    </>
  );
};

export default GoldenAmountWidget;

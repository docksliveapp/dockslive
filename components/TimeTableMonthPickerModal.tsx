import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Download, Loader2, X } from 'lucide-react';
import { SalaryStaffMember } from '../types';

interface TimeTableMonthPickerModalProps {
  isOpen: boolean;
  staff: SalaryStaffMember | null;
  onClose: () => void;
  onConfirmDownload: (fromMonth: string, toMonth: string) => Promise<void> | void;
  isDownloading?: boolean;
}

function getCurrentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function offsetYm(baseYm: string, monthsDelta: number): string {
  const [y, m] = baseYm.split('-').map((n) => parseInt(n, 10));
  const d = new Date(y, m - 1 + monthsDelta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function countMonthsBetween(fromYm: string, toYm: string): number {
  if (!/^\d{4}-\d{2}$/.test(fromYm) || !/^\d{4}-\d{2}$/.test(toYm)) return 1;
  const start = fromYm <= toYm ? fromYm : toYm;
  const end = fromYm <= toYm ? toYm : fromYm;
  const [sy, sm] = start.split('-').map((n) => parseInt(n, 10));
  const [ey, em] = end.split('-').map((n) => parseInt(n, 10));
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
}

export const TimeTableMonthPickerModal: React.FC<TimeTableMonthPickerModalProps> = ({
  isOpen,
  staff,
  onClose,
  onConfirmDownload,
  isDownloading = false
}) => {
  const currentYm = useMemo(() => getCurrentYm(), []);
  const [fromMonth, setFromMonth] = useState(currentYm);
  const [toMonth, setToMonth] = useState(currentYm);

  useEffect(() => {
    if (isOpen) {
      const nowYm = getCurrentYm();
      setFromMonth(nowYm);
      setToMonth(nowYm);
    }
  }, [isOpen, staff?.id]);

  if (!isOpen || !staff) return null;

  const pageCount = countMonthsBetween(fromMonth, toMonth);

  return (
    <div className="fixed inset-0 z-[10060] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-white/15 shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-slate-950/90">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shrink-0">
              <Calendar size={18} />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold block">
                Download Monthly Time Table PDF
              </span>
              <h4 className="text-sm font-bold text-white truncate">{staff.name}</h4>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-[11px] text-gray-300 leading-relaxed">
            Each month prints on its own dedicated page with all calendar days (28/29/30/31) and 5 columns:{' '}
            <strong className="text-white">Days, Entry Time, Lunch Start, Lunch End, Exit</strong> (12:00 AM/PM).
          </p>

          {/* Quick Month Range Presets */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setFromMonth(currentYm);
                setToMonth(currentYm);
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer transition ${
                fromMonth === currentYm && toMonth === currentYm
                  ? 'bg-cyan-600 text-white border-cyan-400'
                  : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
              }`}
            >
              Current Month
            </button>
            <button
              type="button"
              onClick={() => {
                const prev = offsetYm(currentYm, -1);
                setFromMonth(prev);
                setToMonth(prev);
              }}
              className="px-2.5 py-1.5 rounded-lg border bg-white/5 text-gray-300 border-white/10 hover:bg-white/10 text-[11px] font-semibold cursor-pointer transition"
            >
              Previous Month
            </button>
            <button
              type="button"
              onClick={() => {
                setFromMonth(offsetYm(currentYm, -2));
                setToMonth(currentYm);
              }}
              className="px-2.5 py-1.5 rounded-lg border bg-white/5 text-gray-300 border-white/10 hover:bg-white/10 text-[11px] font-semibold cursor-pointer transition"
            >
              Last 3 Months
            </button>
            <button
              type="button"
              onClick={() => {
                setFromMonth(offsetYm(currentYm, -5));
                setToMonth(currentYm);
              }}
              className="px-2.5 py-1.5 rounded-lg border bg-white/5 text-gray-300 border-white/10 hover:bg-white/10 text-[11px] font-semibold cursor-pointer transition"
            >
              Last 6 Months
            </button>
          </div>

          {/* Custom From Month -> To Month Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-300 font-semibold block mb-1">
                From Month
              </label>
              <input
                type="month"
                value={fromMonth}
                onChange={(e) => {
                  const val = e.target.value || currentYm;
                  setFromMonth(val);
                  if (toMonth < val) setToMonth(val);
                }}
                className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-300 font-semibold block mb-1">
                To Month
              </label>
              <input
                type="month"
                value={toMonth}
                onChange={(e) => {
                  const val = e.target.value || fromMonth;
                  setToMonth(val < fromMonth ? fromMonth : val);
                }}
                className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500 outline-none"
              />
            </div>
          </div>

          <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-[11px]">
            <span className="text-gray-400">PDF Pages to Generate:</span>
            <span className="font-mono font-bold text-cyan-300">
              {pageCount} Page{pageCount === 1 ? '' : 's'} (1 Month / Page)
            </span>
          </div>
        </div>

        <div className="p-4 border-t border-white/10 bg-slate-950/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isDownloading}
            onClick={() => onConfirmDownload(fromMonth, toMonth)}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg shadow-cyan-600/25"
          >
            {isDownloading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            <span>Download Time Table PDF</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TimeTableMonthPickerModal;

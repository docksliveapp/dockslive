import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  UtensilsCrossed,
  Search,
  X,
  LogOut as SignOutIcon,
  Calendar,
  Users,
  CheckCircle2,
  Building2,
  Loader2,
  Download
} from 'lucide-react';
import { SalaryStaffMember, StaffAttendanceRecord } from '../types';
import {
  formatLocalYmd,
  isDirectorDesignation,
  markStaffAttendanceEntry,
  markStaffAttendanceLunchStart,
  markStaffAttendanceLunchEnd,
  markStaffAttendanceExit,
  sortSalaryStaffByDesignation,
  subscribeToSalaryStaff,
  subscribeToStaffAttendance
} from '../services/dbService';
import {
  GROUP_COMPANIES,
  CompanyId,
  getMainGroupLogoUrl,
  useParentGroup
} from '../services/companyService';
import { useBranding, useTransparentLogo } from '../services/brandingService';
import { resolveStoredDocumentDataUrl } from '../services/documentStorage';
import { downloadStaffDailyTimeTablePdf } from '../services/pdfExportService';
import { TimeTableMonthPickerModal } from './TimeTableMonthPickerModal';
import { logActivity } from '../services/activityLogService';

interface TimeTableManagerPortalProps {
  onSignOut: () => void;
  staffUserId?: string;
  staffUserName?: string;
  allowedCompanies?: string[];
}

export const TimeTableManagerPortal: React.FC<TimeTableManagerPortalProps> = ({
  onSignOut,
  staffUserId = 'timetable',
  staffUserName = 'Time Table Manager',
  allowedCompanies = ['docks', 'truckit', 'muhib', 'vantage']
}) => {
  const { parentGroup } = useParentGroup();
  const branding = useBranding();
  const cleanGroupLogo = useTransparentLogo(getMainGroupLogoUrl(parentGroup, 'charcoal'));

  const normalizedAllowed = useMemo(() => {
    const validIds = Object.values(GROUP_COMPANIES).map((c) => c.id as string);
    const filtered = (allowedCompanies || []).filter((id) => validIds.includes(id));
    return filtered.length > 0 ? filtered : validIds;
  }, [allowedCompanies]);

  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState<string>(() =>
    normalizedAllowed.length === 1 ? normalizedAllowed[0] : 'ALL'
  );
  const [staffList, setStaffList] = useState<SalaryStaffMember[]>([]);
  const [attendanceList, setAttendanceList] = useState<StaffAttendanceRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pdfPickerStaff, setPdfPickerStaff] = useState<SalaryStaffMember | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [nowClock, setNowClock] = useState<Date>(() => new Date());
  const [resolvedPhotos, setResolvedPhotos] = useState<Record<string, string>>({});

  // Live 1-second digital clock
  useEffect(() => {
    const timer = setInterval(() => setNowClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to all company employees & attendance records
  useEffect(() => {
    const unsubStaff = subscribeToSalaryStaff(
      (items) => setStaffList(items || []),
      { allCompanies: true }
    );
    const unsubAtt = subscribeToStaffAttendance(
      (items) => setAttendanceList(items || []),
      { allCompanies: true }
    );
    return () => {
      unsubStaff();
      unsubAtt();
    };
  }, []);

  // Auto-resolve chunk:// thumbnails cleanly
  useEffect(() => {
    const missing = (staffList || [])
      .map((s) => s.photoUrl)
      .filter((u): u is string => Boolean(u && u.startsWith('chunk://') && !resolvedPhotos[u]));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        missing.map(async (uri) => {
          const dataUrl = await resolveStoredDocumentDataUrl({ url: uri });
          if (dataUrl && dataUrl.startsWith('data:')) {
            updates[uri] = dataUrl;
          }
        })
      );
      if (!cancelled && Object.keys(updates).length > 0) {
        setResolvedPhotos((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [staffList, resolvedPhotos]);

  // Clear banner after 4.5s
  useEffect(() => {
    if (!feedbackBanner) return;
    const t = setTimeout(() => setFeedbackBanner(null), 4500);
    return () => clearTimeout(t);
  }, [feedbackBanner]);

  const todayYmd = formatLocalYmd(nowClock);

  // Exclude Directors and Suspended/Inactive staff + enforce company rights
  const eligibleStaff = useMemo(() => {
    const scoped = (staffList || []).filter((s) => {
      if (!s || s.status === 'SUSPENDED' || s.status === 'INACTIVE') return false;
      if (isDirectorDesignation(s.designation)) return false;
      const compId = s.companyId || 'docks';
      if (!normalizedAllowed.includes(compId)) return false;
      if (selectedCompanyFilter !== 'ALL' && compId !== selectedCompanyFilter) return false;
      return true;
    });
    return sortSalaryStaffByDesignation(scoped);
  }, [staffList, normalizedAllowed, selectedCompanyFilter]);

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return eligibleStaff;
    return eligibleStaff.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.designation || '').toLowerCase().includes(q) ||
        (s.primaryContact || '').toLowerCase().includes(q) ||
        (s.fatherName || '').toLowerCase().includes(q)
    );
  }, [eligibleStaff, searchQuery]);

  const todayRecordByStaffId = useMemo(() => {
    const map = new Map<string, StaffAttendanceRecord>();
    (attendanceList || []).forEach((rec) => {
      if (rec.date === todayYmd) {
        map.set(rec.staffId, rec);
      }
    });
    return map;
  }, [attendanceList, todayYmd]);

  const summary = useMemo(() => {
    let entered = 0;
    let onLunch = 0;
    let exited = 0;
    eligibleStaff.forEach((s) => {
      const rec = todayRecordByStaffId.get(s.id);
      if (rec?.entryTime) entered++;
      if (rec?.lunchStartTime && !rec?.lunchEndTime && !rec?.exitTime) onLunch++;
      if (rec?.exitTime) exited++;
    });
    return {
      total: eligibleStaff.length,
      entered,
      onLunch,
      exited,
      awaiting: Math.max(0, eligibleStaff.length - entered)
    };
  }, [eligibleStaff, todayRecordByStaffId]);

  const actorLabel = staffUserName || staffUserId || 'Time Table Manager';

  const handleAction = async (
    staff: SalaryStaffMember,
    actionType: 'ENTRY' | 'LUNCH_START' | 'LUNCH_END' | 'EXIT'
  ) => {
    setBusyKey(`${staff.id}_${actionType}`);
    setFeedbackBanner(null);
    try {
      let updated: StaffAttendanceRecord;
      let actionTitle = '';
      if (actionType === 'ENTRY') {
        updated = await markStaffAttendanceEntry(staff, actorLabel);
        actionTitle = `Entry marked at ${updated.entryTime}`;
      } else if (actionType === 'LUNCH_START') {
        updated = await markStaffAttendanceLunchStart(staff, actorLabel);
        actionTitle = `Lunch started at ${updated.lunchStartTime}`;
      } else if (actionType === 'LUNCH_END') {
        updated = await markStaffAttendanceLunchEnd(staff, actorLabel);
        actionTitle = `Lunch ended at ${updated.lunchEndTime}`;
      } else {
        updated = await markStaffAttendanceExit(staff, actorLabel);
        actionTitle = `Exit marked at ${updated.exitTime}`;
      }

      setAttendanceList((prev) => [updated, ...prev.filter((r) => r.id !== updated.id)]);
      setFeedbackBanner({
        type: 'success',
        message: `${staff.name}: ${actionTitle}`
      });
      logActivity(
        `Time Table (${staff.name}): ${actionTitle} on ${updated.date} by ${actorLabel}`,
        'OFFICE'
      );
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err?.message || 'Unable to update live time record.'
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleConfirmDownloadPdf = async (fromMonth: string, toMonth: string) => {
    if (!pdfPickerStaff) return;
    const staff = pdfPickerStaff;
    setDownloadingId(staff.id);
    try {
      const compId = (staff.companyId || 'docks') as CompanyId;
      const compObj = GROUP_COMPANIES[compId] || GROUP_COMPANIES.docks;
      const records = (attendanceList || []).filter((r) => r.staffId === staff.id);
      await downloadStaffDailyTimeTablePdf({
        staff,
        attendanceRecords: records,
        companyId: compObj.id,
        companyInfo: {
          id: compObj.id,
          name: compObj.name,
          legalTitle: compObj.legalTitle,
          category: compObj.category,
          address: compObj.address,
          phone: compObj.phone,
          cell: compObj.cell,
          email: compObj.email,
          web: compObj.web,
          prefix: compObj.prefix
        },
        customLogo: compObj.logo || branding.customLogo,
        branding,
        generatedDate: todayYmd,
        fromMonth,
        toMonth
      });
      setPdfPickerStaff(null);
    } finally {
      setDownloadingId(null);
    }
  };

  const todayFormatted = nowClock.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const liveClockStr = nowClock
    .toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
    .replace(/\u202f/g, ' ');

  const formatBtnTime = (raw?: string, fallback: string = '') => {
    if (!raw) return fallback;
    const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
    return m ? `${m[1].padStart(2, '0')}:${m[2]} ${m[3].toUpperCase()}` : raw;
  };

  const companyNameById = (cid?: string) => {
    const key = (cid || 'docks') as CompanyId;
    const found = GROUP_COMPANIES[key];
    return found?.shortName || found?.name || 'MAK Group';
  };

  return (
    <div className="h-screen h-[100dvh] w-full bg-[#090D16] text-gray-100 flex flex-col overflow-hidden">
      {/* Top Corporate Header Bar */}
      <header className="shrink-0 bg-slate-950/95 border-b border-white/10 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center p-1 shrink-0">
            <img
              src={cleanGroupLogo || getMainGroupLogoUrl(parentGroup, 'charcoal')}
              alt="MAK Group"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-bold">
                Time Table Manager Portal
              </span>
              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline truncate">
                ID: {staffUserId}
              </span>
            </div>
            <h1 className="text-sm sm:text-base font-bold text-white truncate mt-0.5">
              {staffUserName} — Daily Employee Attendance Sheet
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Live Digital Clock */}
          <div className="px-3.5 py-1.5 rounded-xl bg-slate-900 border border-white/10 text-right">
            <span className="text-[10px] text-gray-400 flex items-center justify-end gap-1">
              <Calendar size={11} className="text-cyan-400" />
              {todayFormatted}
            </span>
            <span className="text-sm font-mono font-bold text-emerald-400 tabular-nums block leading-tight">
              {liveClockStr}
            </span>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="px-3.5 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <SignOutIcon size={15} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 sm:px-6 py-4 space-y-4 max-w-7xl w-full mx-auto">
        {/* Live Stats & Company Filter Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <div className="p-3 rounded-2xl bg-slate-900/90 border border-white/10">
            <span className="text-[11px] text-gray-400 block">Employees Listed</span>
            <span className="text-lg font-bold font-mono tabular-nums text-white mt-0.5 block">
              {summary.total}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25">
            <span className="text-[11px] text-emerald-300 block">Entered Today</span>
            <span className="text-lg font-bold font-mono tabular-nums text-emerald-400 mt-0.5 block">
              {summary.entered}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25">
            <span className="text-[11px] text-amber-300 block">On Lunch Now</span>
            <span className="text-lg font-bold font-mono tabular-nums text-amber-400 mt-0.5 block">
              {summary.onLunch}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-sky-500/10 border border-sky-500/25">
            <span className="text-[11px] text-sky-300 block">Exited Today</span>
            <span className="text-lg font-bold font-mono tabular-nums text-sky-400 mt-0.5 block">
              {summary.exited}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-slate-900/90 border border-white/10 col-span-2 sm:col-span-1">
            <span className="text-[11px] text-gray-400 block">Awaiting Entry</span>
            <span className="text-lg font-bold font-mono tabular-nums text-slate-300 mt-0.5 block">
              {summary.awaiting}
            </span>
          </div>
        </div>

        {/* Company Scope Tabs & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/80 border border-white/10 rounded-2xl p-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {normalizedAllowed.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedCompanyFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                  selectedCompanyFilter === 'ALL'
                    ? 'bg-cyan-600 text-white border-cyan-400 shadow'
                    : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                }`}
              >
                All Companies
              </button>
            )}
            {Object.values(GROUP_COMPANIES)
              .filter((c) => normalizedAllowed.includes(c.id))
              .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCompanyFilter(c.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition cursor-pointer ${
                  selectedCompanyFilter === c.id
                    ? 'bg-cyan-600 text-white border-cyan-400 shadow'
                    : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                }`}
              >
                <Building2 size={12} />
                <span>{c.shortName || c.name}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 bg-black/40 border border-white/15 rounded-xl px-3 py-2 w-full md:w-80">
            <Search size={15} className="text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="Search employee name or designation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none text-xs text-white focus:outline-none w-full placeholder-gray-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Live Action Feedback */}
        {feedbackBanner && (
          <div
            className={`px-4 py-3 rounded-2xl border text-xs font-semibold flex items-center justify-between gap-3 ${
              feedbackBanner.type === 'success'
                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-200'
                : 'bg-rose-500/15 border-rose-500/35 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="shrink-0" />
              <span>{feedbackBanner.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-current opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Employees List with 4 Live Buttons: Entry · Lunch Start · Lunch End · Exit */}
        <div className="space-y-2.5 pb-6">
          {filteredStaff.length === 0 ? (
            <div className="p-12 text-center rounded-3xl bg-slate-900/70 border border-white/10 text-gray-400 space-y-2">
              <Users size={34} className="mx-auto text-gray-500" />
              <p className="text-sm font-semibold text-white">No Employees Found</p>
              <p className="text-xs text-gray-400">
                Active non-director employees added under Finance &rarr; Salary Staff will appear here automatically.
              </p>
            </div>
          ) : (
            filteredStaff.map((staff, idx) => {
              const rec = todayRecordByStaffId.get(staff.id);
              const hasEntered = Boolean(rec?.entryTime);
              const hasLunchStarted = Boolean(rec?.lunchStartTime);
              const hasLunchEnded = Boolean(rec?.lunchEndTime);
              const hasExited = Boolean(rec?.exitTime);

              const photoSrc =
                staff.photoUrl?.startsWith('chunk://')
                  ? resolvedPhotos[staff.photoUrl] || ''
                  : staff.photoUrl || '';

              const canClickEntry = !hasEntered;
              const canClickLunchStart = hasEntered && !hasLunchStarted && !hasExited;
              const canClickLunchEnd = hasLunchStarted && !hasLunchEnded && !hasExited;
              const canClickExit = hasEntered && !hasExited;

              const statusLabel = hasExited
                ? `Completed (${rec?.workingDuration || '-'})`
                : hasLunchStarted && !hasLunchEnded
                ? 'On Lunch Break'
                : hasLunchEnded
                ? 'Back from Lunch'
                : hasEntered
                ? 'In Office'
                : 'Awaiting Entry';

              const statusClasses = hasExited
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : hasLunchStarted && !hasLunchEnded
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : hasLunchEnded
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                : hasEntered
                ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                : 'bg-white/5 text-gray-400 border-white/10';

              return (
                <div
                  key={staff.id}
                  className={`rounded-2xl border p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors ${
                    hasExited
                      ? 'bg-emerald-950/15 border-emerald-500/25'
                      : hasLunchStarted && !hasLunchEnded
                      ? 'bg-amber-950/15 border-amber-500/25'
                      : hasEntered
                      ? 'bg-cyan-950/15 border-cyan-500/25'
                      : 'bg-slate-900/80 border-white/10 hover:border-white/20'
                  }`}
                >
                  {/* Employee Identity */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-gray-500 w-6 shrink-0">
                      #{idx + 1}
                    </span>
                    <div className="w-11 h-11 rounded-xl bg-slate-800 border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
                      {photoSrc && photoSrc.startsWith('data:image/') ? (
                        <img
                          src={photoSrc}
                          alt={staff.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-bold text-gray-300">
                          {(staff.name || 'S').charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white truncate">
                          {staff.name}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-white/10 text-gray-300 border border-white/10">
                          {companyNameById(staff.companyId)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${statusClasses}`}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="text-cyan-300 font-medium">
                          {staff.designation || 'Staff'}
                        </span>
                        {staff.fatherName && <span>S/O: {staff.fatherName}</span>}
                        {staff.primaryContact && (
                          <span className="font-mono">{staff.primaryContact}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 4 Live Timestamp Buttons + PDF Print Icon */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                    {/* 1. ENTRY BUTTON */}
                    <button
                      type="button"
                      disabled={!canClickEntry || busyKey !== null}
                      onClick={() => handleAction(staff, 'ENTRY')}
                      className={`min-w-[110px] px-3 py-2 rounded-xl border text-left transition flex flex-col justify-center ${
                        hasEntered
                          ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300 cursor-not-allowed'
                          : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white shadow-md shadow-emerald-600/20 cursor-pointer active:scale-95'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-bold">
                        {busyKey === `${staff.id}_ENTRY` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <LogIn size={13} />
                        )}
                        <span>{hasEntered ? 'Entered' : 'Entry'}</span>
                      </span>
                      <span className="text-[10px] font-mono tabular-nums opacity-90 mt-0.5">
                        {formatBtnTime(rec?.entryTime, 'Click live time')}
                      </span>
                    </button>

                    {/* 2. LUNCH START BUTTON */}
                    <button
                      type="button"
                      disabled={!canClickLunchStart || busyKey !== null}
                      onClick={() => handleAction(staff, 'LUNCH_START')}
                      className={`min-w-[116px] px-3 py-2 rounded-xl border text-left transition flex flex-col justify-center ${
                        hasLunchStarted
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 cursor-not-allowed'
                          : !canClickLunchStart
                          ? 'bg-white/5 border-white/10 text-gray-500 opacity-50 cursor-not-allowed'
                          : 'bg-amber-600 hover:bg-amber-500 border-amber-400 text-white shadow-md shadow-amber-600/20 cursor-pointer active:scale-95'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-bold">
                        {busyKey === `${staff.id}_LUNCH_START` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Coffee size={13} />
                        )}
                        <span>Lunch Start</span>
                      </span>
                      <span className="text-[10px] font-mono tabular-nums opacity-90 mt-0.5">
                        {formatBtnTime(rec?.lunchStartTime, hasEntered ? 'Start break' : 'Locked')}
                      </span>
                    </button>

                    {/* 3. LUNCH END BUTTON */}
                    <button
                      type="button"
                      disabled={!canClickLunchEnd || busyKey !== null}
                      onClick={() => handleAction(staff, 'LUNCH_END')}
                      className={`min-w-[112px] px-3 py-2 rounded-xl border text-left transition flex flex-col justify-center ${
                        hasLunchEnded
                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 cursor-not-allowed'
                          : !canClickLunchEnd
                          ? 'bg-white/5 border-white/10 text-gray-500 opacity-50 cursor-not-allowed'
                          : 'bg-cyan-600 hover:bg-cyan-500 border-cyan-400 text-white shadow-md shadow-cyan-600/20 cursor-pointer active:scale-95'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-bold">
                        {busyKey === `${staff.id}_LUNCH_END` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <UtensilsCrossed size={13} />
                        )}
                        <span>Lunch End</span>
                      </span>
                      <span className="text-[10px] font-mono tabular-nums opacity-90 mt-0.5">
                        {formatBtnTime(rec?.lunchEndTime, hasLunchStarted ? 'End break' : 'Locked')}
                      </span>
                    </button>

                    {/* 4. EXIT BUTTON */}
                    <button
                      type="button"
                      disabled={!canClickExit || busyKey !== null}
                      onClick={() => handleAction(staff, 'EXIT')}
                      className={`min-w-[110px] px-3 py-2 rounded-xl border text-left transition flex flex-col justify-center ${
                        hasExited
                          ? 'bg-sky-500/20 border-sky-500/40 text-sky-300 cursor-not-allowed'
                          : !canClickExit
                          ? 'bg-white/5 border-white/10 text-gray-500 opacity-50 cursor-not-allowed'
                          : 'bg-rose-600 hover:bg-rose-500 border-rose-400 text-white shadow-md shadow-rose-600/20 cursor-pointer active:scale-95'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-bold">
                        {busyKey === `${staff.id}_EXIT` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <LogOut size={13} />
                        )}
                        <span>{hasExited ? 'Exited' : 'Exit'}</span>
                      </span>
                      <span className="text-[10px] font-mono tabular-nums opacity-90 mt-0.5">
                        {formatBtnTime(rec?.exitTime, hasEntered ? 'Click exit' : 'Locked')}
                      </span>
                    </button>

                    {/* Time Table PDF Quick Download */}
                    <button
                      type="button"
                      disabled={downloadingId === staff.id}
                      onClick={() => setPdfPickerStaff(staff)}
                      title="Download Employee Monthly Time Table PDF"
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/15 text-gray-300 hover:text-white transition cursor-pointer shrink-0 self-stretch flex items-center justify-center"
                    >
                      {downloadingId === staff.id ? (
                        <Loader2 size={16} className="animate-spin text-cyan-400" />
                      ) : (
                        <Download size={16} />
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      <TimeTableMonthPickerModal
        isOpen={Boolean(pdfPickerStaff)}
        staff={pdfPickerStaff}
        onClose={() => setPdfPickerStaff(null)}
        onConfirmDownload={handleConfirmDownloadPdf}
        isDownloading={Boolean(downloadingId)}
      />
    </div>
  );
};

export default TimeTableManagerPortal;

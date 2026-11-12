import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle,
  Layers,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { Vehicle } from '../types';
import {
  detectDuplicateVehicleGroups,
  DuplicateVehicleGroup,
  matchTechNumbers,
  mergeVehicleRecords,
  resolveCanonicalCompanyKey,
} from '../services/vehicleDuplicateService';
import { executeVehicleMergeAndDeleteBatch } from '../services/dbService';

interface VehicleDuplicateManagerModalProps {
  vehicles: Vehicle[];
  onClose: () => void;
  onApplyLocalUpdate: (params: {
    updatedVehicles: Vehicle[];
    deletedIds: number[];
  }) => void;
  getVehicleTripsCount?: (v: Vehicle) => number;
}

type ManagerMode = 'AUTO_DETECTED' | 'MANUAL_MATCH';
type FilterTab =
  | 'HIGH_CONFIDENCE'
  | 'TRUCKIT_VS_DOCKS'
  | 'SAME_CHASSIS_ENGINE'
  | 'SAME_CHASSIS_ONLY'
  | 'SIMILAR_PLATE_REVIEW'
  | 'ALL';

function formatCompanyShort(v: Vehicle): string {
  const key = resolveCanonicalCompanyKey(v);
  if (key === 'truckit') return 'TRUCKIT';
  if (key === 'docks') return 'DOCKS';
  if (key === 'muhib') return 'MUHIB';
  if (key === 'vantage') return 'VANTAGE';
  return String(v.companyName || v.operatingCompany || 'DOCKS').toUpperCase();
}

function countUploadedDocs(v: Vehicle): number {
  let count = 0;
  if (v.registrationBook) count++;
  if (v.ownerIdCardUrl) count++;
  if (v.customsRegCertDoc) count++;
  if (v.licenseDoc) count++;
  if (v.driverCnicDoc) count++;
  return count;
}

export const VehicleDuplicateManagerModal: React.FC<VehicleDuplicateManagerModalProps> = ({
  vehicles,
  onClose,
  onApplyLocalUpdate,
  getVehicleTripsCount,
}) => {
  const [mode, setMode] = useState<ManagerMode>('AUTO_DETECTED');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('HIGH_CONFIDENCE');
  const [searchQuery, setSearchQuery] = useState('');

  // Per-group user overrides: which vehicle ID to KEEP, and optional company override
  const [keepIdByGroup, setKeepIdByGroup] = useState<Record<string, number>>({});
  const [companyTargetByGroup, setCompanyTargetByGroup] = useState<
    Record<string, 'KEEP_PRIMARY' | 'truckit' | 'docks'>
  >({});
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  // Processing & feedback banner state (no window.alert / window.confirm)
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmBatchAction, setConfirmBatchAction] = useState<
    null | 'AUTO_TRUCKIT_DOCKS' | 'SELECTED_MERGE'
  >(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Manual Match Any 2 Vehicles state
  const [manualKeepSearch, setManualKeepSearch] = useState('');
  const [manualDropSearch, setManualDropSearch] = useState('');
  const [manualKeepId, setManualKeepId] = useState<number | null>(null);
  const [manualDropId, setManualDropId] = useState<number | null>(null);
  const [manualTargetCompany, setManualTargetCompany] = useState<
    'KEEP_PRIMARY' | 'truckit' | 'docks'
  >('KEEP_PRIMARY');

  const allGroups = useMemo(() => detectDuplicateVehicleGroups(vehicles), [vehicles]);

  const counts = useMemo(() => {
    let high = 0;
    let truckitDocks = 0;
    let sameCE = 0;
    let sameChassisOnly = 0;
    let reviewPlates = 0;

    for (const g of allGroups) {
      if (g.confidence === 'HIGH') high++;
      if (g.isCrossCompanyTruckitDocks && g.confidence !== 'REVIEW') truckitDocks++;
      if (
        g.category === 'EXACT_TRI_MATCH' ||
        g.category === 'CROSS_COMPANY_CE_MATCH' ||
        g.category === 'SAME_CHASSIS_AND_ENGINE'
      ) {
        sameCE++;
      }
      if (g.category === 'SAME_CHASSIS_ONLY') sameChassisOnly++;
      if (g.category === 'SAME_BASE_PLATE_DIFF_TECH') reviewPlates++;
    }

    return {
      all: allGroups.length,
      high,
      truckitDocks,
      sameCE,
      sameChassisOnly,
      reviewPlates,
    };
  }, [allGroups]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allGroups.filter((g) => {
      if (activeFilter === 'HIGH_CONFIDENCE' && g.confidence !== 'HIGH') return false;
      if (
        activeFilter === 'TRUCKIT_VS_DOCKS' &&
        !(g.isCrossCompanyTruckitDocks && g.confidence !== 'REVIEW')
      ) {
        return false;
      }
      if (
        activeFilter === 'SAME_CHASSIS_ENGINE' &&
        g.category !== 'EXACT_TRI_MATCH' &&
        g.category !== 'CROSS_COMPANY_CE_MATCH' &&
        g.category !== 'SAME_CHASSIS_AND_ENGINE'
      ) {
        return false;
      }
      if (activeFilter === 'SAME_CHASSIS_ONLY' && g.category !== 'SAME_CHASSIS_ONLY') {
        return false;
      }
      if (
        activeFilter === 'SIMILAR_PLATE_REVIEW' &&
        g.category !== 'SAME_BASE_PLATE_DIFF_TECH'
      ) {
        return false;
      }

      if (q) {
        const matchesSearch = g.vehicles.some((v) =>
          [
            v.registrationNumber,
            v.chassisNo,
            v.engineNo,
            v.transporterName,
            v.companyName,
            v.operatingCompany,
            v.make,
            v.model,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q)
        );
        if (!matchesSearch) return false;
      }

      return true;
    });
  }, [allGroups, activeFilter, searchQuery]);

  const getKeepIdForGroup = (group: DuplicateVehicleGroup): number => {
    const override = keepIdByGroup[group.groupId];
    if (override && group.vehicles.some((v) => v.id === override)) {
      return override;
    }
    return group.recommendedKeepId;
  };

  const toggleGroupSelection = (groupId: string) => {
    setConfirmBatchAction(null);
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const isAllVisibleSelected =
    filteredGroups.length > 0 &&
    filteredGroups.every((g) => selectedGroupIds.has(g.groupId));

  const toggleSelectAllVisible = () => {
    setConfirmBatchAction(null);
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (isAllVisibleSelected) {
        filteredGroups.forEach((g) => next.delete(g.groupId));
      } else {
        filteredGroups.forEach((g) => next.add(g.groupId));
      }
      return next;
    });
  };

  const runGroupOperations = async (
    targetGroups: DuplicateVehicleGroup[],
    actionMode: 'MERGE_AND_DELETE' | 'DELETE_ONLY',
    forceTruckitForCrossCompany = false
  ) => {
    if (targetGroups.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setFeedbackBanner(null);
    setConfirmBatchAction(null);

    try {
      const batchOps: Array<{
        updatedPrimary?: Vehicle;
        deleteVehicles: Vehicle[];
      }> = [];
      const updatedPrimaries: Vehicle[] = [];
      const deletedIds: number[] = [];

      for (const group of targetGroups) {
        let keepId = getKeepIdForGroup(group);
        if (forceTruckitForCrossCompany && group.isCrossCompanyTruckitDocks) {
          const truckitVeh = group.vehicles.find(
            (v) => resolveCanonicalCompanyKey(v) === 'truckit'
          );
          if (truckitVeh) keepId = truckitVeh.id;
        }

        const primary =
          group.vehicles.find((v) => v.id === keepId) || group.vehicles[0];
        const duplicates = group.vehicles.filter((v) => v.id !== primary.id);
        if (!primary || duplicates.length === 0) continue;

        const targetComp = forceTruckitForCrossCompany && group.isCrossCompanyTruckitDocks
          ? 'truckit'
          : companyTargetByGroup[group.groupId] || 'KEEP_PRIMARY';

        if (actionMode === 'MERGE_AND_DELETE') {
          const mergedPrimary = mergeVehicleRecords(primary, duplicates, {
            targetCompany: targetComp,
            recordAuditNote: true,
          });
          batchOps.push({
            updatedPrimary: mergedPrimary,
            deleteVehicles: duplicates,
          });
          updatedPrimaries.push(mergedPrimary);
        } else {
          let adjustedPrimary: Vehicle | undefined;
          if (targetComp === 'truckit') {
            adjustedPrimary = {
              ...primary,
              operatingCompany: 'truckit',
              companyName: 'TRUCKIT PVT LTD',
            };
          } else if (targetComp === 'docks') {
            adjustedPrimary = {
              ...primary,
              operatingCompany: 'docks',
              companyName: 'DOCKS PVT LTD',
            };
          }
          batchOps.push({
            updatedPrimary: adjustedPrimary,
            deleteVehicles: duplicates,
          });
          if (adjustedPrimary) updatedPrimaries.push(adjustedPrimary);
        }

        duplicates.forEach((d) => deletedIds.push(d.id));
      }

      if (batchOps.length === 0) {
        setIsProcessing(false);
        return;
      }

      // Apply instant optimistic state update in parent UI
      onApplyLocalUpdate({
        updatedVehicles: updatedPrimaries,
        deletedIds,
      });

      await executeVehicleMergeAndDeleteBatch(batchOps);

      setSelectedGroupIds((prev) => {
        const next = new Set(prev);
        targetGroups.forEach((g) => next.delete(g.groupId));
        return next;
      });

      setFeedbackBanner({
        type: 'success',
        message:
          actionMode === 'MERGE_AND_DELETE'
            ? `Successfully merged & deleted ${deletedIds.length} duplicate vehicle record(s) across ${batchOps.length} group(s).`
            : `Successfully deleted ${deletedIds.length} duplicate vehicle record(s).`,
      });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err?.message || 'Failed to update vehicle records in database.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Manual Match filtered candidates
  const manualKeepCandidates = useMemo(() => {
    const q = manualKeepSearch.trim().toLowerCase();
    const list = q
      ? vehicles.filter((v) =>
          `${v.registrationNumber} ${v.chassisNo || ''} ${v.engineNo || ''} ${v.transporterName || ''} ${v.companyName || ''}`
            .toLowerCase()
            .includes(q)
        )
      : vehicles;
    return list.slice(0, 60);
  }, [vehicles, manualKeepSearch]);

  const manualDropCandidates = useMemo(() => {
    const q = manualDropSearch.trim().toLowerCase();
    const list = q
      ? vehicles.filter((v) =>
          `${v.registrationNumber} ${v.chassisNo || ''} ${v.engineNo || ''} ${v.transporterName || ''} ${v.companyName || ''}`
            .toLowerCase()
            .includes(q)
        )
      : vehicles;
    return list.slice(0, 60);
  }, [vehicles, manualDropSearch]);

  const manualKeepVehicle = useMemo(
    () => (manualKeepId !== null ? vehicles.find((v) => v.id === manualKeepId) || null : null),
    [vehicles, manualKeepId]
  );

  const manualDropVehicle = useMemo(
    () => (manualDropId !== null ? vehicles.find((v) => v.id === manualDropId) || null : null),
    [vehicles, manualDropId]
  );

  const handleManualExecute = async (actionMode: 'MERGE_AND_DELETE' | 'DELETE_ONLY') => {
    if (!manualKeepVehicle || !manualDropVehicle || isProcessing) return;
    if (manualKeepVehicle.id === manualDropVehicle.id) {
      setFeedbackBanner({
        type: 'error',
        message: 'Keep vehicle and Duplicate vehicle cannot be the same record.',
      });
      return;
    }

    setIsProcessing(true);
    setFeedbackBanner(null);
    try {
      let updatedPrimary: Vehicle | undefined;
      if (actionMode === 'MERGE_AND_DELETE') {
        updatedPrimary = mergeVehicleRecords(manualKeepVehicle, [manualDropVehicle], {
          targetCompany: manualTargetCompany,
          recordAuditNote: true,
        });
      } else if (manualTargetCompany === 'truckit') {
        updatedPrimary = {
          ...manualKeepVehicle,
          operatingCompany: 'truckit',
          companyName: 'TRUCKIT PVT LTD',
        };
      } else if (manualTargetCompany === 'docks') {
        updatedPrimary = {
          ...manualKeepVehicle,
          operatingCompany: 'docks',
          companyName: 'DOCKS PVT LTD',
        };
      }

      onApplyLocalUpdate({
        updatedVehicles: updatedPrimary ? [updatedPrimary] : [],
        deletedIds: [manualDropVehicle.id],
      });

      await executeVehicleMergeAndDeleteBatch([
        {
          updatedPrimary,
          deleteVehicles: [manualDropVehicle],
        },
      ]);

      const keptReg = manualKeepVehicle.registrationNumber;
      const droppedReg = manualDropVehicle.registrationNumber;
      setManualDropId(null);
      setManualDropSearch('');

      setFeedbackBanner({
        type: 'success',
        message:
          actionMode === 'MERGE_AND_DELETE'
            ? `Merged ${droppedReg} into ${keptReg} and deleted duplicate ${droppedReg}.`
            : `Deleted duplicate ${droppedReg} and kept ${keptReg}.`,
      });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err?.message || 'Manual merge failed.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const truckitDocksHighGroups = useMemo(
    () =>
      allGroups.filter(
        (g) => g.isCrossCompanyTruckitDocks && g.confidence !== 'REVIEW'
      ),
    [allGroups]
  );

  const selectedGroupsArray = useMemo(
    () => allGroups.filter((g) => selectedGroupIds.has(g.groupId)),
    [allGroups, selectedGroupIds]
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2.5 sm:p-5">
      <div className="w-full max-w-6xl max-h-[92vh] bg-slate-950 border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-white/10 bg-slate-900 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400 shrink-0">
              <Layers size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-white truncate">
                Duplicate &amp; Doubling Vehicles Manager
              </h3>
              <p className="text-xs text-gray-400 truncate">
                Total Fleet: <span className="font-mono font-semibold text-white tabular-nums">{vehicles.length}</span>
                {' · '}Match by Registration No, Chassis No &amp; Engine No · Select which stays &amp; merge/delete duplicates
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setMode('AUTO_DETECTED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  mode === 'AUTO_DETECTED'
                    ? 'finance-type-btn finance-type-btn-active'
                    : 'finance-type-btn text-gray-300'
                }`}
              >
                <ShieldCheck size={13} />
                <span>Auto-Detected ({counts.high})</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('MANUAL_MATCH')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  mode === 'MANUAL_MATCH'
                    ? 'finance-type-btn finance-type-btn-active'
                    : 'finance-type-btn text-gray-300'
                }`}
              >
                <ArrowLeftRight size={13} />
                <span>Manual Match (Any 2)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mak-btn-secondary p-2 rounded-lg text-gray-300 hover:text-white"
              title="Close Window"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Status / Result Feedback Banner */}
        {feedbackBanner && (
          <div
            className={`px-4 sm:px-6 py-2.5 border-b text-xs flex items-center justify-between gap-3 shrink-0 ${
              feedbackBanner.type === 'success'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedbackBanner.type === 'success' ? (
                <CheckCircle size={15} className="shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle size={15} className="shrink-0 text-rose-400" />
              )}
              <span className="font-medium">{feedbackBanner.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-gray-400 hover:text-white p-1"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Main Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
          {mode === 'AUTO_DETECTED' ? (
            <>
              {/* 4-Column Metric Summary Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveFilter('HIGH_CONFIDENCE')}
                  data-custom-control="true"
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    activeFilter === 'HIGH_CONFIDENCE'
                      ? 'bg-sky-500/15 border-sky-400/50'
                      : 'bg-slate-900/80 border-white/10 hover:bg-slate-900'
                  }`}
                >
                  <div className="text-[11px] text-gray-400 font-medium">
                    Confirmed Doubling (Chassis + Engine)
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-xl font-bold font-mono tabular-nums text-sky-400">
                      {counts.high}
                    </span>
                    <span className="text-[11px] text-gray-400">Ready to Merge</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveFilter('TRUCKIT_VS_DOCKS')}
                  data-custom-control="true"
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    activeFilter === 'TRUCKIT_VS_DOCKS'
                      ? 'bg-cyan-500/15 border-cyan-400/50'
                      : 'bg-slate-900/80 border-white/10 hover:bg-slate-900'
                  }`}
                >
                  <div className="text-[11px] text-gray-400 font-medium">
                    Truckit vs Docks Doubling
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-xl font-bold font-mono tabular-nums text-cyan-400">
                      {counts.truckitDocks}
                    </span>
                    <span className="text-[11px] text-gray-400">Keep Truckit · Delete Docks</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveFilter('SAME_CHASSIS_ONLY')}
                  data-custom-control="true"
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    activeFilter === 'SAME_CHASSIS_ONLY'
                      ? 'bg-amber-500/15 border-amber-400/50'
                      : 'bg-slate-900/80 border-white/10 hover:bg-slate-900'
                  }`}
                >
                  <div className="text-[11px] text-gray-400 font-medium">
                    Same Chassis Only (Verify Engine)
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-xl font-bold font-mono tabular-nums text-amber-400">
                      {counts.sameChassisOnly}
                    </span>
                    <span className="text-[11px] text-gray-400">Manual Check</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveFilter('SIMILAR_PLATE_REVIEW')}
                  data-custom-control="true"
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    activeFilter === 'SIMILAR_PLATE_REVIEW'
                      ? 'bg-slate-800 border-white/30'
                      : 'bg-slate-900/80 border-white/10 hover:bg-slate-900'
                  }`}
                >
                  <div className="text-[11px] text-gray-400 font-medium">
                    Same Base Plate · Diff Chassis/Engine
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-xl font-bold font-mono tabular-nums text-gray-200">
                      {counts.reviewPlates}
                    </span>
                    <span className="text-[11px] text-gray-400">Review Only</span>
                  </div>
                </button>
              </div>

              {/* Filter Tabs + Search + Batch Action Bar */}
              <div className="bg-slate-900 border border-white/10 rounded-xl p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { id: 'HIGH_CONFIDENCE', label: `Confirmed Matches (${counts.high})` },
                        { id: 'TRUCKIT_VS_DOCKS', label: `Truckit vs Docks (${counts.truckitDocks})` },
                        { id: 'SAME_CHASSIS_ENGINE', label: `Same Chassis + Engine (${counts.sameCE})` },
                        { id: 'SAME_CHASSIS_ONLY', label: `Same Chassis (${counts.sameChassisOnly})` },
                        { id: 'SIMILAR_PLATE_REVIEW', label: `Plate Suffix Review (${counts.reviewPlates})` },
                        { id: 'ALL', label: `All (${counts.all})` },
                      ] as Array<{ id: FilterTab; label: string }>
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveFilter(tab.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                          activeFilter === tab.id
                            ? 'finance-type-btn finance-type-btn-active'
                            : 'finance-type-btn text-gray-300'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter plate, chassis, engine..."
                      className="glass-input rounded-lg pl-8 pr-7 py-1.5 text-xs outline-none w-full"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Batch Action Controls */}
                <div className="pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-xs text-gray-300 font-medium select-none">
                      <input
                        type="checkbox"
                        checked={isAllVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="w-3.5 h-3.5 rounded accent-sky-600"
                      />
                      <span>
                        Select All in View ({filteredGroups.length})
                      </span>
                    </label>
                    {selectedGroupIds.size > 0 && (
                      <span className="text-xs text-sky-400 font-mono tabular-nums">
                        · {selectedGroupIds.size} selected
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {truckitDocksHighGroups.length > 0 && (
                      <>
                        {confirmBatchAction === 'AUTO_TRUCKIT_DOCKS' ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() =>
                                runGroupOperations(
                                  truckitDocksHighGroups,
                                  'MERGE_AND_DELETE',
                                  true
                                )
                              }
                              className="mak-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              {isProcessing ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <CheckCircle size={13} />
                              )}
                              <span>
                                Confirm: Keep Truckit &amp; Delete {truckitDocksHighGroups.length} Docks Duplicate(s)
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmBatchAction(null)}
                              className="mak-btn-secondary px-2.5 py-1.5 rounded-lg text-xs font-medium"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => setConfirmBatchAction('AUTO_TRUCKIT_DOCKS')}
                            className="mak-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                          >
                            <Truck size={13} />
                            <span>
                              Clean Truckit vs Docks ({truckitDocksHighGroups.length}) — Keep Truckit
                            </span>
                          </button>
                        )}
                      </>
                    )}

                    {selectedGroupsArray.length > 0 && (
                      <>
                        {confirmBatchAction === 'SELECTED_MERGE' ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() =>
                                runGroupOperations(
                                  selectedGroupsArray,
                                  'MERGE_AND_DELETE',
                                  false
                                )
                              }
                              className="mak-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              {isProcessing ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <CheckCircle size={13} />
                              )}
                              <span>
                                Confirm Merge &amp; Delete ({selectedGroupsArray.length} Groups)
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmBatchAction(null)}
                              className="mak-btn-secondary px-2.5 py-1.5 rounded-lg text-xs font-medium"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => setConfirmBatchAction('SELECTED_MERGE')}
                            className="mak-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                          >
                            <Layers size={13} />
                            <span>Merge &amp; Clean Selected ({selectedGroupsArray.length})</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Duplicate Groups List */}
              {filteredGroups.length === 0 ? (
                <div className="p-10 text-center bg-slate-900/60 border border-white/10 rounded-xl space-y-2">
                  <CheckCircle size={28} className="mx-auto text-emerald-400" />
                  <div className="text-sm font-semibold text-white">
                    No duplicate vehicles in this filter
                  </div>
                  <p className="text-xs text-gray-400">
                    All Truckit vs Docks exact plate + chassis + engine duplicates have been consolidated cleanly.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredGroups.map((group, gIdx) => {
                    const currentKeepId = getKeepIdForGroup(group);
                    const currentCompanyTarget =
                      companyTargetByGroup[group.groupId] || 'KEEP_PRIMARY';
                    const isChecked = selectedGroupIds.has(group.groupId);

                    return (
                      <div
                        key={group.groupId}
                        className="bg-slate-900 border border-white/10 rounded-xl overflow-hidden"
                      >
                        {/* Group Header Bar */}
                        <div className="px-3.5 py-2.5 bg-slate-950/70 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleGroupSelection(group.groupId)}
                              className="w-3.5 h-3.5 rounded accent-sky-600 shrink-0"
                              aria-label={`Select duplicate group ${gIdx + 1}`}
                            />
                            <span className="font-mono text-xs font-bold text-sky-400 tabular-nums">
                              #{gIdx + 1}
                            </span>
                            <span className="text-xs font-semibold text-white">
                              {group.categoryLabel}
                            </span>
                            <span className="text-xs text-gray-400 hidden sm:inline">
                              · {group.matchReason}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <select
                              aria-label="Target Operating Company"
                              value={currentCompanyTarget}
                              onChange={(e) =>
                                setCompanyTargetByGroup((prev) => ({
                                  ...prev,
                                  [group.groupId]: e.target.value as
                                    | 'KEEP_PRIMARY'
                                    | 'truckit'
                                    | 'docks',
                                }))
                              }
                              className="glass-input rounded-lg px-2 py-1 text-[11px] font-medium text-gray-200 bg-slate-900 border border-white/15 outline-none"
                            >
                              <option value="KEEP_PRIMARY">
                                Company: Keep Selected Vehicle&apos;s Company
                              </option>
                              <option value="truckit">
                                Set Surviving Vehicle to TRUCKIT PVT LTD
                              </option>
                              <option value="docks">
                                Set Surviving Vehicle to DOCKS PVT LTD
                              </option>
                            </select>

                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() =>
                                runGroupOperations([group], 'MERGE_AND_DELETE', false)
                              }
                              className="mak-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                              title="Merge missing fields, trips & documents into the KEEP vehicle and delete the duplicate record(s)"
                            >
                              <Layers size={12} />
                              <span>Merge &amp; Delete Duplicate</span>
                            </button>

                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() =>
                                runGroupOperations([group], 'DELETE_ONLY', false)
                              }
                              className="mak-btn-secondary px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                              title="Delete the unselected duplicate record(s) without copying fields into the KEEP vehicle"
                            >
                              <Trash2 size={12} />
                              <span>Delete Duplicate Only</span>
                            </button>
                          </div>
                        </div>

                        {/* Group Vehicles Comparison Table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-white/10 text-[11px] text-gray-400 bg-slate-900/50">
                                <th className="py-2 px-3 font-semibold w-36">
                                  Decision (Click to Keep)
                                </th>
                                <th className="py-2 px-2.5 font-semibold">Vehicle Reg No</th>
                                <th className="py-2 px-2.5 font-semibold">Company</th>
                                <th className="py-2 px-2.5 font-semibold">Chassis No</th>
                                <th className="py-2 px-2.5 font-semibold">Engine No</th>
                                <th className="py-2 px-2.5 font-semibold">Make / Model</th>
                                <th className="py-2 px-2.5 font-semibold">Transporter</th>
                                <th className="py-2 px-2.5 font-semibold">Reg Date</th>
                                <th className="py-2 px-3 font-semibold text-right">
                                  Trips · Docs
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {group.vehicles.map((v) => {
                                const isKeep = v.id === currentKeepId;
                                const compShort = formatCompanyShort(v);
                                const isTruckit = compShort === 'TRUCKIT';
                                const trips = getVehicleTripsCount
                                  ? getVehicleTripsCount(v)
                                  : v.tripsHistory?.length || 0;
                                const docsCount = countUploadedDocs(v);

                                return (
                                  <tr
                                    key={v.id}
                                    onClick={() =>
                                      setKeepIdByGroup((prev) => ({
                                        ...prev,
                                        [group.groupId]: v.id,
                                      }))
                                    }
                                    className={`cursor-pointer ${
                                      isKeep
                                        ? 'bg-emerald-500/[0.08]'
                                        : 'hover:bg-white/[0.03]'
                                    }`}
                                  >
                                    <td className="py-2 px-3 whitespace-nowrap">
                                      <label className="inline-flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`keep_${group.groupId}`}
                                          checked={isKeep}
                                          onChange={() =>
                                            setKeepIdByGroup((prev) => ({
                                              ...prev,
                                              [group.groupId]: v.id,
                                            }))
                                          }
                                          className="w-3.5 h-3.5 accent-emerald-500"
                                        />
                                        <span
                                          className={`text-[11px] font-bold ${
                                            isKeep ? 'text-emerald-400' : 'text-rose-400'
                                          }`}
                                        >
                                          {isKeep ? 'KEEP (Rahegi)' : 'DELETE / MERGE'}
                                        </span>
                                      </label>
                                    </td>

                                    <td className="py-2 px-2.5 font-mono font-bold text-white tabular-nums whitespace-nowrap">
                                      {v.registrationNumber}
                                    </td>

                                    <td
                                      className={`py-2 px-2.5 font-semibold whitespace-nowrap ${
                                        isTruckit ? 'text-cyan-300' : 'text-amber-300'
                                      }`}
                                    >
                                      {compShort}
                                    </td>

                                    <td
                                      className={`py-2 px-2.5 font-mono tabular-nums whitespace-nowrap ${
                                        group.chassisMatch
                                          ? 'text-emerald-300 font-semibold'
                                          : 'text-gray-300'
                                      }`}
                                    >
                                      {v.chassisNo || 'N/A'}
                                    </td>

                                    <td
                                      className={`py-2 px-2.5 font-mono tabular-nums whitespace-nowrap ${
                                        group.engineMatch
                                          ? 'text-emerald-300 font-semibold'
                                          : 'text-gray-300'
                                      }`}
                                    >
                                      {v.engineNo || 'N/A'}
                                    </td>

                                    <td className="py-2 px-2.5 text-gray-300 whitespace-nowrap">
                                      {[v.make, v.model].filter(Boolean).join(' ') ||
                                        v.makeModel ||
                                        '-'}
                                    </td>

                                    <td className="py-2 px-2.5 text-gray-300 max-w-[180px] truncate">
                                      {v.transporterName || v.brokerName || 'Direct'}
                                    </td>

                                    <td className="py-2 px-2.5 font-mono tabular-nums text-gray-400 whitespace-nowrap">
                                      {v.registrationDate || '-'}
                                    </td>

                                    <td className="py-2 px-3 text-right font-mono tabular-nums text-gray-300 whitespace-nowrap">
                                      {trips} · {docsCount}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* MANUAL MATCH & MERGE ANY 2 VEHICLES */
            <div className="space-y-4">
              <div className="bg-slate-900 border border-white/10 rounded-xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      Manual Match, Compare &amp; Merge Any Two Vehicles
                    </h4>
                    <p className="text-xs text-gray-400">
                      Search by Registration No, Chassis No, or Engine No to choose which vehicle stays (Keep) and which duplicate gets merged or deleted.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const prevKeep = manualKeepId;
                      setManualKeepId(manualDropId);
                      setManualDropId(prevKeep);
                    }}
                    className="mak-btn-secondary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <ArrowLeftRight size={13} />
                    <span>Swap Keep &amp; Delete</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Column 1: Primary Vehicle to KEEP */}
                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-emerald-500/30 space-y-2.5">
                    <div className="text-xs font-bold text-emerald-400">
                      1. Primary Vehicle — KEEP (Ye Vehicle Rahegi)
                    </div>
                    <input
                      type="text"
                      value={manualKeepSearch}
                      onChange={(e) => setManualKeepSearch(e.target.value)}
                      placeholder="Search plate, chassis, engine to KEEP..."
                      className="glass-input rounded-lg px-3 py-2 text-xs w-full outline-none"
                    />
                    <select
                      aria-label="Select Primary Vehicle to Keep"
                      value={manualKeepId ?? ''}
                      onChange={(e) =>
                        setManualKeepId(e.target.value ? Number(e.target.value) : null)
                      }
                      className="glass-input rounded-lg px-3 py-2 text-xs w-full bg-slate-900 text-white border border-white/15 outline-none font-mono"
                    >
                      <option value="">-- Select Vehicle to KEEP ({manualKeepCandidates.length} shown) --</option>
                      {manualKeepCandidates.map((v) => (
                        <option key={`keep_opt_${v.id}`} value={v.id}>
                          {v.registrationNumber} [{formatCompanyShort(v)}] — Ch: {v.chassisNo || 'N/A'} | En: {v.engineNo || 'N/A'}
                        </option>
                      ))}
                    </select>

                    {manualKeepVehicle && (
                      <div className="pt-2 border-t border-white/10 space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Registration No:</span>
                          <span className="font-mono font-bold text-white">
                            {manualKeepVehicle.registrationNumber}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Company:</span>
                          <span className="font-semibold text-cyan-300">
                            {formatCompanyShort(manualKeepVehicle)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Chassis / Engine:</span>
                          <span className="font-mono text-gray-200">
                            {manualKeepVehicle.chassisNo || 'N/A'} / {manualKeepVehicle.engineNo || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Transporter:</span>
                          <span className="text-gray-200">
                            {manualKeepVehicle.transporterName || 'Direct'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Column 2: Duplicate Vehicle to MERGE & DELETE */}
                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-rose-500/30 space-y-2.5">
                    <div className="text-xs font-bold text-rose-400">
                      2. Duplicate Vehicle — DELETE / MERGE (Ye Vehicle Hata Di Jayegi)
                    </div>
                    <input
                      type="text"
                      value={manualDropSearch}
                      onChange={(e) => setManualDropSearch(e.target.value)}
                      placeholder="Search plate, chassis, engine to DELETE..."
                      className="glass-input rounded-lg px-3 py-2 text-xs w-full outline-none"
                    />
                    <select
                      aria-label="Select Duplicate Vehicle to Delete"
                      value={manualDropId ?? ''}
                      onChange={(e) =>
                        setManualDropId(e.target.value ? Number(e.target.value) : null)
                      }
                      className="glass-input rounded-lg px-3 py-2 text-xs w-full bg-slate-900 text-white border border-white/15 outline-none font-mono"
                    >
                      <option value="">-- Select Duplicate Vehicle to DELETE ({manualDropCandidates.length} shown) --</option>
                      {manualDropCandidates.map((v) => (
                        <option key={`drop_opt_${v.id}`} value={v.id}>
                          {v.registrationNumber} [{formatCompanyShort(v)}] — Ch: {v.chassisNo || 'N/A'} | En: {v.engineNo || 'N/A'}
                        </option>
                      ))}
                    </select>

                    {manualDropVehicle && (
                      <div className="pt-2 border-t border-white/10 space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Registration No:</span>
                          <span className="font-mono font-bold text-white">
                            {manualDropVehicle.registrationNumber}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Company:</span>
                          <span className="font-semibold text-amber-300">
                            {formatCompanyShort(manualDropVehicle)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Chassis / Engine:</span>
                          <span className="font-mono text-gray-200">
                            {manualDropVehicle.chassisNo || 'N/A'} / {manualDropVehicle.engineNo || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Transporter:</span>
                          <span className="text-gray-200">
                            {manualDropVehicle.transporterName || 'Direct'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Comparison & Action Footer */}
                {manualKeepVehicle && manualDropVehicle && (
                  <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-gray-300">
                      <span>Technical Check: </span>
                      <span className="font-mono">
                        Chassis:{' '}
                        {matchTechNumbers(
                          manualKeepVehicle.chassisNo,
                          manualDropVehicle.chassisNo
                        ) !== 'NONE'
                          ? 'MATCH'
                          : 'DIFFERENT'}
                        {' · '}Engine:{' '}
                        {matchTechNumbers(
                          manualKeepVehicle.engineNo,
                          manualDropVehicle.engineNo
                        ) !== 'NONE'
                          ? 'MATCH'
                          : 'DIFFERENT'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Manual Target Company"
                        value={manualTargetCompany}
                        onChange={(e) =>
                          setManualTargetCompany(
                            e.target.value as 'KEEP_PRIMARY' | 'truckit' | 'docks'
                          )
                        }
                        className="glass-input rounded-lg px-2.5 py-1.5 text-xs bg-slate-900 text-white border border-white/15 outline-none"
                      >
                        <option value="KEEP_PRIMARY">Keep Primary Company</option>
                        <option value="truckit">Set to TRUCKIT PVT LTD</option>
                        <option value="docks">Set to DOCKS PVT LTD</option>
                      </select>

                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleManualExecute('MERGE_AND_DELETE')}
                        className="mak-btn px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        {isProcessing ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Layers size={13} />
                        )}
                        <span>
                          Merge {manualDropVehicle.registrationNumber} into{' '}
                          {manualKeepVehicle.registrationNumber} &amp; Delete
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleManualExecute('DELETE_ONLY')}
                        className="mak-btn-secondary px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Trash2 size={13} />
                        <span>Delete {manualDropVehicle.registrationNumber} Only</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

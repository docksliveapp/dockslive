import React from 'react';
import { MapPin, Clock, Truck, CheckCircle2, ShieldAlert, Navigation, ArrowRight } from 'lucide-react';
import { Case, CaseStatus, TransitLocationLogEntry } from '../types';

interface CaseTransitHistoryCardProps {
  targetCase: Case;
  compact?: boolean;
}

export const CaseTransitHistoryCard: React.FC<CaseTransitHistoryCardProps> = ({
  targetCase,
  compact = false
}) => {
  if (!targetCase) return null;

  const wf = targetCase.workflowDetails || {};
  const loadingStep = wf[CaseStatus.LOADING_PORT_PROCESSING];
  const transitStep = wf[CaseStatus.IN_TRANSIT];
  const destStep = wf[CaseStatus.DESTINATION_PORT_ARRIVAL];

  // Collect all transit locations from both top-level permanent history and step logs
  const rawLocations: TransitLocationLogEntry[] = [
    ...(Array.isArray(targetCase.transitLocationsHistory) ? targetCase.transitLocationsHistory : []),
    ...(Array.isArray(transitStep?.transitLocationsLog) ? transitStep.transitLocationsLog : [])
  ];

  // Deduplicate by id or timestamp + roadOrAreaName
  const seen = new Set<string>();
  const locationsList: TransitLocationLogEntry[] = [];
  rawLocations.forEach(item => {
    if (!item || !item.roadOrAreaName) return;
    const key = item.id || `${item.formattedTime}_${item.roadOrAreaName}`;
    if (!seen.has(key)) {
      seen.add(key);
      locationsList.push(item);
    }
  });

  // Also check if any other category step has transitLocationsLog
  Object.values(wf).forEach(stepDetail => {
    if (Array.isArray(stepDetail?.transitLocationsLog)) {
      stepDetail.transitLocationsLog.forEach(item => {
        if (!item || !item.roadOrAreaName) return;
        const key = item.id || `${item.formattedTime}_${item.roadOrAreaName}`;
        if (!seen.has(key)) {
          seen.add(key);
          locationsList.push(item);
        }
      });
    }
  });

  const loadingDuration =
    targetCase.loadingGateOutDuration ||
    loadingStep?.loadingGateOutDuration ||
    (loadingStep?.gateOutToggled ? 'Gate Out Confirmed at Loading Port' : 'Pending Loading Gate-Out');

  const transitDuration =
    targetCase.totalTransitDuration ||
    (locationsList.length > 0 ? `${locationsList.length} Live Route Checkpoints Recorded` : 'Awaiting Transit Departure');

  const destDuration =
    targetCase.destinationGateOutDuration ||
    destStep?.destinationGateOutDuration ||
    targetCase.destinationUnloadingDuration ||
    destStep?.destinationUnloadingDuration ||
    (destStep?.vehicleGateOutToggled || targetCase.status === CaseStatus.COMPLETED
      ? 'Unloaded & Gate Out Confirmed at Destination'
      : 'Pending Destination Unloading & Gate-Out');

  const assignedVehicle =
    wf[CaseStatus.VEHICLE_ASSIGNMENT]?.assignedVehicleNo ||
    targetCase.containers?.find(c => c.vehicleNo)?.vehicleNo ||
    locationsList[locationsList.length - 1]?.vehicleNo ||
    'Assigned Carrier';

  return (
    <div className="rounded-2xl bg-slate-900/90 border border-cyan-500/30 p-4 sm:p-5 space-y-4 shadow-lg">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <Navigation size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">
                Transit Route Locations & Port Gate-Out / Unloading Duration History
              </h4>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                Permanent Case Record ({targetCase.category || 'All Categories'})
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Route: <span className="text-emerald-300 font-semibold">{targetCase.pol || 'Loading Point'}</span>{' '}
              <ArrowRight size={10} className="inline mx-1 text-gray-500" />{' '}
              <span className="text-amber-300 font-semibold">{targetCase.pod || 'Unloading Destination'}</span> • Vehicle:{' '}
              <span className="text-white font-mono font-bold">{assignedVehicle}</span>
            </p>
          </div>
        </div>

        {targetCase.driverTripIdExpiredOnGateOut && (
          <div className="px-2.5 py-1 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-bold flex items-center gap-1.5">
            <ShieldAlert size={13} className="text-rose-400 shrink-0" />
            <span>Trip Driver ID Auto-Expired & Blocked on Gate-Out</span>
          </div>
        )}
      </div>

      {/* 3-Column Timing Calculation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        {/* 1. Port of Loading Gate-Out Duration */}
        <div className="p-3 rounded-xl bg-slate-950/80 border border-emerald-500/25 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            <span className="flex items-center gap-1">
              <Clock size={12} /> 1. Loading Port Gate-Out Time
            </span>
            {targetCase.loadingGateOutDuration && <CheckCircle2 size={12} />}
          </div>
          <p className="text-white font-mono font-bold text-xs sm:text-sm leading-snug">
            {loadingDuration}
          </p>
          <p className="text-[10px] text-gray-400">
            Origin: <span className="text-gray-300">{targetCase.pol || 'Port of Loading'}</span>
          </p>
        </div>

        {/* 2. En-Route Transit Duration */}
        <div className="p-3 rounded-xl bg-slate-950/80 border border-cyan-500/25 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-cyan-400">
            <span className="flex items-center gap-1">
              <Truck size={12} /> 2. En-Route Transit Duration
            </span>
            <span className="font-mono">{locationsList.length} Locations</span>
          </div>
          <p className="text-white font-mono font-bold text-xs sm:text-sm leading-snug">
            {transitDuration}
          </p>
          <p className="text-[10px] text-gray-400">
            Live GPS road & nearby area logs saved in case
          </p>
        </div>

        {/* 3. Destination Port Unloading & Gate-Out Duration */}
        <div className="p-3 rounded-xl bg-slate-950/80 border border-amber-500/25 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-amber-400">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={12} /> 3. Destination Unload & Gate-Out
            </span>
            {targetCase.destinationGateOutDuration && <CheckCircle2 size={12} />}
          </div>
          <p className="text-white font-mono font-bold text-xs sm:text-sm leading-snug">
            {destDuration}
          </p>
          <p className="text-[10px] text-gray-400">
            Destination: <span className="text-gray-300">{targetCase.pod || 'Port of Destination'}</span>
          </p>
        </div>
      </div>

      {/* Transit Locations History List (Roads & Nearby Areas) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
            <MapPin size={13} className="text-cyan-400" />
            <span>Recorded Transit Locations (Road Name & Nearby Area Checkpoints)</span>
          </span>
          <span className="text-[10px] font-mono text-gray-400">
            {locationsList.length} {locationsList.length === 1 ? 'Location' : 'Locations'} Saved
          </span>
        </div>

        {locationsList.length === 0 ? (
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-white/5 text-center text-xs text-gray-400">
            When Location Service is turned ON for the assigned trip vehicle and the driver logs in with their Trip Driver ID, every road name / nearby area location sent is automatically recorded here and permanently saved in this case.
          </div>
        ) : (
          <div className={`space-y-1.5 ${compact ? 'max-h-48' : 'max-h-64'} overflow-y-auto pr-1 custom-scrollbar`}>
            {locationsList.map((loc, idx) => (
              <div
                key={loc.id || idx}
                className="p-2.5 rounded-xl bg-slate-950/80 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:border-cyan-500/30 transition-colors"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-white text-xs sm:text-sm truncate">
                      {loc.roadOrAreaName}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono">
                      Vehicle: <span className="text-emerald-300 font-semibold">{loc.vehicleNo}</span> • Driver:{' '}
                      <span className="text-gray-300">{loc.driverName}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                  <span className="px-2 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-mono text-[10px]">
                    {loc.formattedTime}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

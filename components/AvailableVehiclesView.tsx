import React, { useState, useEffect, useMemo } from 'react';
import { 
  Truck, MapPin, Calendar, DollarSign, Phone, Search, Filter, 
  CheckCircle2, Clock, AlertCircle, RefreshCw, X, ArrowRight, ShieldCheck, Tag,
  Building, Building2, User
} from 'lucide-react';
import { AvailableVehicle, Vehicle, Transporter } from '../types';
import { subscribeToAvailableVehicles, subscribeToVehicles } from '../services/dbService';
import { safeAppStorage } from '../services/storage';

interface AvailableVehiclesViewProps {
  onClose?: () => void;
  isModal?: boolean;
  onSelectVehicle?: (vehicle: AvailableVehicle) => void;
  userRole?: string;
}

export const AvailableVehiclesView: React.FC<AvailableVehiclesViewProps> = ({
  onClose,
  isModal = false,
  onSelectVehicle,
  userRole
}) => {
  const [availableVehicles, setAvailableVehicles] = useState<AvailableVehicle[]>([]);
  const [liveVehicles, setLiveVehicles] = useState<Vehicle[]>([]);
  const [searchVehicleQuery, setSearchVehicleQuery] = useState('');
  const [selectedTransporter, setSelectedTransporter] = useState('ALL');

  useEffect(() => {
    const unsubAvail = subscribeToAvailableVehicles((items) => {
      setAvailableVehicles(items || []);
    });
    const unsubVeh = subscribeToVehicles((items) => {
      setLiveVehicles(items || []);
    });
    return () => {
      unsubAvail();
      unsubVeh();
    };
  }, []);

  // Merge available_vehicles collection and any vehicles marked ready/online in vehicles collection
  const allReadyVehicles = useMemo(() => {
    const list: AvailableVehicle[] = [...availableVehicles];
    const existingVehicleNos = new Set(list.map(v => (v.vehicleNo || '').trim().toLowerCase()));

    // Check if any vehicle from fleet is marked ready for loading or online
    liveVehicles.forEach(v => {
      const reg = (v.registrationNumber || '').trim().toLowerCase();
      if (!reg) return;
      if (existingVehicleNos.has(reg)) return;

      if (v.isReadyForLoading || v.isOnline || (v.status === 'AVAILABLE' && v.isReadyForLoading)) {
        list.push({
          id: `fleet-${v.id}`,
          vehicleNo: v.registrationNumber,
          transporterId: v.transporterId || 1,
          transporterName: v.brokerName || v.transporterName || 'Registered Transporter',
          currentCity: v.onlineLocation || v.readyCity || 'Karachi',
          allowableDestinations: v.readyDestinations && v.readyDestinations.length > 0
            ? v.readyDestinations 
            : (v.onlineDestination ? [v.onlineDestination] : ['All Pakistan Dry Ports']),
          estimatedRent: v.estimatedRent || 150000,
          availableFromDate: v.readySince?.slice(0, 10) || v.registrationDate || new Date().toISOString().slice(0, 10),
          driverName: v.driverName || 'Designated Driver',
          driverContact: v.driverContact || 'N/A',
          vehicleType: v.type,
          readyStatus: 'READY',
          createdAt: v.createdAt || new Date().toISOString()
        });
        existingVehicleNos.add(reg);
      }
    });

    return list;
  }, [availableVehicles, liveVehicles]);

  // Dynamic Transporter List for the dropdown
  const transportersList = useMemo(() => {
    const names = new Set<string>();
    
    // 1. From all ready vehicles
    allReadyVehicles.forEach(v => {
      if (v.transporterName && v.transporterName.trim()) {
        names.add(v.transporterName.trim());
      }
    });

    // 2. From live fleet vehicles
    liveVehicles.forEach(v => {
      const name = v.brokerName || v.transporterName;
      if (name && name.trim()) {
        names.add(name.trim());
      }
    });

    // 3. From cached registered transporters
    const cachedTrans = safeAppStorage.getJSON<Transporter[]>('dpl_live_transporters', []);
    if (Array.isArray(cachedTrans)) {
      cachedTrans.forEach(t => {
        if (t.name && t.name.trim()) names.add(t.name.trim());
      });
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [allReadyVehicles, liveVehicles]);

  // Filtered Ready Vehicles by Selected Transporter and Vehicle Search Field
  const filteredVehicles = useMemo(() => {
    return allReadyVehicles.filter(v => {
      // Must be READY status (exclude booked or dispatched)
      if (v.readyStatus && v.readyStatus !== 'READY') return false;

      // 1. Filter by Transporter
      if (selectedTransporter !== 'ALL') {
        const transMatch = v.transporterName?.toLowerCase().trim() === selectedTransporter.toLowerCase().trim();
        if (!transMatch) return false;
      }

      // 2. Search vehicle by registration number, type, or driver
      if (searchVehicleQuery.trim()) {
        const q = searchVehicleQuery.toLowerCase().trim();
        const matchNum = v.vehicleNo?.toLowerCase().includes(q);
        const matchType = v.vehicleType?.toLowerCase().includes(q);
        const matchDriver = v.driverName?.toLowerCase().includes(q);
        const matchCity = v.currentCity?.toLowerCase().includes(q);
        if (!matchNum && !matchType && !matchDriver && !matchCity) return false;
      }

      return true;
    });
  }, [allReadyVehicles, selectedTransporter, searchVehicleQuery]);

  const content = (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-900/80 p-4 rounded-2xl border border-white/10 shadow-lg">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Truck className="text-amber-400" size={22} />
            <span>Available Fleet (Ready for Loading)</span>
            <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-semibold font-mono">
              {filteredVehicles.length} Ready
            </span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Active carrier fleet ready for immediate dispatch and container loading across Pakistan
          </p>
        </div>
        {isModal && onClose && (
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Filter Bar: Transporter Select Dropdown & Vehicle Search Field */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-slate-950/60 p-4 rounded-2xl border border-white/10 shadow-md">
        {/* 1. Transporter Select Dropdown */}
        <div>
          <label className="block text-[11px] font-semibold text-gray-300 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Building size={14} className="text-amber-400" />
              <span>Select Transporter / Broker</span>
            </span>
            {selectedTransporter !== 'ALL' && (
              <button 
                type="button"
                onClick={() => setSelectedTransporter('ALL')}
                className="text-[10px] text-amber-400 hover:underline cursor-pointer"
              >
                Reset All
              </button>
            )}
          </label>
          <div className="relative">
            <select
              value={selectedTransporter}
              onChange={(e) => setSelectedTransporter(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 hover:border-amber-500/40 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500 font-medium transition cursor-pointer appearance-none"
            >
              <option value="ALL">All Transporters ({transportersList.length})</option>
              {transportersList.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
              ▼
            </div>
          </div>
        </div>

        {/* 2. Vehicle Search Field */}
        <div>
          <label className="block text-[11px] font-semibold text-gray-300 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Search size={14} className="text-amber-400" />
              <span>Search Vehicle</span>
            </span>
            {searchVehicleQuery && (
              <button 
                type="button"
                onClick={() => setSearchVehicleQuery('')}
                className="text-[10px] text-gray-400 hover:text-white cursor-pointer"
              >
                Clear
              </button>
            )}
          </label>
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search vehicle number (e.g. TL-001, KHI-123, 40ft)..."
              value={searchVehicleQuery}
              onChange={(e) => setSearchVehicleQuery(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 hover:border-amber-500/40 rounded-xl pl-9 pr-9 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 font-medium transition"
            />
            {searchVehicleQuery && (
              <button
                type="button"
                onClick={() => setSearchVehicleQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5 rounded"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Vehicles Cards Grid - All Ready Vehicles */}
      {filteredVehicles.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-10 text-center text-gray-400 space-y-3">
          <Truck size={44} className="mx-auto text-gray-600 opacity-60" />
          <h4 className="text-white font-bold text-sm">No Ready Vehicles Found</h4>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            {selectedTransporter !== 'ALL' || searchVehicleQuery
              ? 'No ready vehicles match the selected transporter or search criteria. Try choosing "All Transporters" or clearing your search.'
              : 'Currently no vehicles are marked ready for loading. Transporters can mark their fleet ready from the Transporter Portal or Vehicle Management.'}
          </p>
          {(selectedTransporter !== 'ALL' || searchVehicleQuery) && (
            <button
              type="button"
              onClick={() => {
                setSelectedTransporter('ALL');
                setSearchVehicleQuery('');
              }}
              className="px-3.5 py-1.5 bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/30 rounded-lg text-xs font-semibold transition"
            >
              Reset All Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVehicles.map((v) => (
            <div 
              key={v.id}
              className="bg-slate-900/90 border border-white/10 hover:border-amber-500/40 rounded-2xl p-4 space-y-3.5 transition-all shadow-lg hover:shadow-amber-500/5 group flex flex-col justify-between"
            >
              <div className="space-y-3">
                {/* Top Row: Vehicle Reg & Status */}
                <div className="flex justify-between items-start border-b border-white/10 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-base text-white group-hover:text-amber-300 transition-colors">
                        {v.vehicleNo}
                      </span>
                      <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] px-2 py-0.5 rounded-full font-bold">
                        READY
                      </span>
                    </div>
                    <p className="text-xs text-gray-300 mt-0.5 font-medium flex items-center gap-1">
                      <Building size={12} className="text-amber-400 shrink-0" />
                      <span>{v.transporterName || 'Transporter'}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-gray-400 block">Est. Rent</span>
                    <span className="font-mono font-bold text-sm text-amber-400">
                      PKR {Number(v.estimatedRent || 0).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Location & Route Info */}
                <div className="bg-white/5 rounded-xl p-2.5 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-gray-300">
                    <MapPin size={14} className="text-emerald-400 shrink-0" />
                    <span>Current City: <strong className="text-white">{v.currentCity || 'Karachi'}</strong></span>
                  </div>
                  <div>
                    <span className="text-[11px] text-gray-400 block mb-1">Permitted Destination Routes:</span>
                    <div className="flex flex-wrap gap-1">
                      {(v.allowableDestinations || ['All Pakistan Dry Ports']).map((dest, dIdx) => (
                        <span key={dIdx} className="bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] px-2 py-0.5 rounded font-mono">
                          {dest}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Driver & Specs */}
                <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-400 pt-1">
                  <div>
                    <span className="block text-gray-500">Driver:</span>
                    <span className="text-gray-200 font-medium">{v.driverName || 'Designated Driver'}</span>
                  </div>
                  <div>
                    <span className="block text-gray-500">Contact:</span>
                    {v.driverContact && v.driverContact !== 'N/A' ? (
                      <a href={`tel:${v.driverContact}`} className="text-amber-300 font-mono hover:underline flex items-center gap-1">
                        <Phone size={11} />
                        <span>{v.driverContact}</span>
                      </a>
                    ) : (
                      <span className="text-gray-500 font-mono">N/A</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-white/10 flex justify-between items-center text-xs">
                <span className="text-[10px] text-gray-500">
                  Ready since {v.availableFromDate || v.createdAt?.slice(0, 10)}
                </span>
                {onSelectVehicle ? (
                  <button
                    type="button"
                    onClick={() => onSelectVehicle(v)}
                    className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-md"
                  >
                    <span>Assign / Select</span>
                    <ArrowRight size={13} />
                  </button>
                ) : (
                  v.driverContact && v.driverContact !== 'N/A' ? (
                    <a
                      href={`tel:${v.driverContact}`}
                      className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
                    >
                      <Phone size={12} className="text-emerald-400" />
                      <span>Contact Driver</span>
                    </a>
                  ) : (
                    <span className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-md font-medium">
                      Available for Dispatch
                    </span>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center pt-3 sm:pt-6 pb-6 px-3 sm:px-4 backdrop-blur-sm overflow-y-auto">
        <div className="bg-slate-900 rounded-3xl max-w-5xl w-full border border-white/10 shadow-2xl overflow-hidden p-6 mb-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
          {content}
        </div>
      </div>
    );
  }

  return content;
};

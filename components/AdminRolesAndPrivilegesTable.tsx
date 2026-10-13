import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, 
  Search, 
  Pencil, 
  Check, 
  ChevronDown, 
  Crown, 
  Building, 
  CheckCircle2, 
  X,
  SlidersHorizontal,
  Info
} from 'lucide-react';
import { UserRole } from '../types';

export interface RoleDefinition {
  id: UserRole;
  name: string;
  description: string;
  defaultScope: string;
  badge?: string;
}

export const SYSTEM_ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: UserRole.ADMIN,
    name: 'Services Admin (Super Administrator)',
    description: 'Full system control, cross-subsidiary governance, user permissions & approval rights across all modules.',
    defaultScope: 'All organizational units',
    badge: 'SUPER ADMIN'
  },
  {
    id: UserRole.OPERATIONS_MANAGER,
    name: 'Operations Manager',
    description: 'Cargo clearing, port logistics, workflow execution up to vehicle assignment, and operational reporting.',
    defaultScope: 'All organizational units',
    badge: 'OPERATIONS'
  },
  {
    id: UserRole.CASE_MANAGER,
    name: 'Case Manager',
    description: 'Case registration dossier review, step verification, workflow compliance, and document audit.',
    defaultScope: 'All organizational units',
    badge: 'CASE MGR'
  },
  {
    id: UserRole.FINANCE_MANAGER,
    name: 'Finance Manager',
    description: 'Customer ledgers, company cashbooks, bank transactions, tax invoices, vouchers & financial ledger.',
    defaultScope: 'All organizational units',
    badge: 'FINANCE'
  },
  {
    id: UserRole.VEHICLE_MANAGER,
    name: 'Fleet & Vehicle Manager',
    description: 'Carrier vehicles, driver compliance, fitness certificates, transport ledger, and fleet tracking.',
    defaultScope: 'All organizational units',
    badge: 'FLEET'
  },
  {
    id: UserRole.LOADING_PORT_STAFF,
    name: 'Loading Port Staff',
    description: 'Loading terminal operations, wharfage, stuffing, container seal numbers, and loading port dispatch.',
    defaultScope: 'All organizational units',
    badge: 'PORT DESK'
  },
  {
    id: UserRole.DESTINATION_PORT_STAFF,
    name: 'Destination Port Staff',
    description: 'Destination terminal arrival, clearing agent DO processing, customs release, and empty return.',
    defaultScope: 'All organizational units',
    badge: 'DESTINATION'
  },
  {
    id: UserRole.UNLOADING_PORT_STAFF,
    name: 'Unloading Port Staff',
    description: 'Unloading terminal coordination, arrival verification, delivery orders, and port handling.',
    defaultScope: 'All organizational units',
    badge: 'UNLOADING'
  },
  {
    id: UserRole.OFFICE_STAFF,
    name: 'Office Staff Coordinator',
    description: 'Head office administrative tasks, case registrations, documentation scanning, and staff desk.',
    defaultScope: 'All organizational units',
    badge: 'OFFICE'
  },
  {
    id: UserRole.TRANSPORTER,
    name: 'Transporter Portal Partner',
    description: 'Carrier vehicles, driver assignment, transport builty verification, and logistics freight portal.',
    defaultScope: 'All organizational units',
    badge: 'TRANSPORTER'
  },
  {
    id: UserRole.CLIENT,
    name: 'Client Portal Importer',
    description: 'Consignee tracking, in-transit containers, invoice downloads, and shipment requests.',
    defaultScope: 'All organizational units',
    badge: 'CLIENT'
  },
  {
    id: UserRole.VENDOR,
    name: 'Supplier / Service Vendor',
    description: 'Service & equipment supplier portal, invoice bill uploads, and payment receipts.',
    defaultScope: 'All organizational units',
    badge: 'VENDOR'
  }
];

interface AdminRolesAndPrivilegesTableProps {
  assignedRoles: UserRole[];
  onRolesChange: (roles: UserRole[], primaryRole: UserRole) => void;
  userName?: string;
  allowedCompanies?: string[];
  isGlobalAdmin?: boolean;
  onCompanyScopeChange?: (companies: string[], isGlobal: boolean) => void;
  readOnly?: boolean;
}

export const AdminRolesAndPrivilegesTable: React.FC<AdminRolesAndPrivilegesTableProps> = ({
  assignedRoles,
  onRolesChange,
  userName = 'this user',
  allowedCompanies = ['docks'],
  isGlobalAdmin = false,
  onCompanyScopeChange,
  readOnly = false
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeModalRole, setScopeModalRole] = useState<RoleDefinition | null>(null);
  const [customScopeMap, setCustomScopeMap] = useState<Record<string, string>>({});
  // Toggle role assignment
  const handleToggleRole = (roleDef: RoleDefinition) => {
    if (readOnly) return;
    const isAssigned = assignedRoles.includes(roleDef.id);
    let newRoles: UserRole[];

    if (isAssigned) {
      newRoles = assignedRoles.filter(r => r !== roleDef.id);
    } else {
      newRoles = [...assignedRoles, roleDef.id];
    }

    const primaryRole = newRoles[0] || UserRole.OPERATIONS_MANAGER;
    onRolesChange(newRoles, primaryRole);
  };

  const filteredRoles = useMemo(() => {
    if (!searchQuery.trim()) return SYSTEM_ROLE_DEFINITIONS;
    const q = searchQuery.toLowerCase();
    return SYSTEM_ROLE_DEFINITIONS.filter(r => 
      r.name.toLowerCase().includes(q) || 
      r.description.toLowerCase().includes(q) ||
      (r.badge && r.badge.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  const assignedCount = assignedRoles.length;

  return (
    <div className="w-full bg-[#131722] border border-white/10 rounded-2xl shadow-xl overflow-hidden font-sans text-slate-100">
      
      {/* 1. Header: Admin roles and privileges */}
      <div className="p-4 sm:p-5 border-b border-white/10 bg-[#161B26]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <ShieldCheck className="text-sky-400" size={20} />
              Admin roles and privileges
            </h3>
            <p className="text-xs text-slate-300 font-semibold mt-1">
              Roles
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
              Manage admin roles for <strong className="text-white">{userName}</strong>. Assign pre-built roles or configure specific operational privileges.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            <span className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-300">
              {assignedCount} {assignedCount === 1 ? 'role' : 'roles'} assigned
            </span>
          </div>
        </div>

        {/* Search Bar & Quick Filter */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter roles or privileges..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const allRoles = SYSTEM_ROLE_DEFINITIONS.map(r => r.id);
                  onRolesChange(allRoles, UserRole.ADMIN);
                }}
                className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 hover:underline cursor-pointer"
              >
                Assign All
              </button>
              <span className="text-slate-600">•</span>
              <button
                type="button"
                onClick={() => {
                  onRolesChange([], UserRole.OPERATIONS_MANAGER);
                }}
                className="text-[11px] font-semibold text-slate-400 hover:text-white hover:underline cursor-pointer"
              >
                Clear All
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. Google Workspace Console Style Table */}
      <div className="overflow-x-auto custom-scrollbar-x">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-[#10141D] text-slate-300 font-semibold select-none text-[11px]">
              <th className="py-3 px-4 w-[42%]">
                <span className="cursor-pointer hover:text-white">Role name</span>
              </th>
              <th className="py-3 px-4 w-[28%]">
                <span>Scope of role</span>
              </th>
              <th className="py-3 px-4 w-[20%]">
                <span className="inline-flex items-center gap-1 text-slate-200">
                  Assigned state
                  <span className="text-[10px] text-sky-400 font-bold">↑</span>
                </span>
              </th>
              <th className="py-3 px-3 text-center w-[5%] text-slate-500">
                Expiration
              </th>
              <th className="py-3 px-3 text-center w-[5%] text-slate-500">
                Condition
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredRoles.map((roleDef) => {
              const isAssigned = assignedRoles.includes(roleDef.id);
              const scopeText = customScopeMap[roleDef.id] || (isAssigned ? roleDef.defaultScope : '-');

              return (
                <tr 
                  key={roleDef.id}
                  className={`transition-colors ${
                    isAssigned 
                      ? 'bg-sky-950/15 hover:bg-sky-950/25' 
                      : 'hover:bg-white/[0.02]'
                  }`}
                >
                  {/* Role Name & Description */}
                  <td className="py-3.5 px-4 align-top">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleRole(roleDef)}
                          className="text-left font-semibold text-sky-400 hover:text-sky-300 hover:underline cursor-pointer text-xs sm:text-sm tracking-tight"
                        >
                          {roleDef.name}
                        </button>
                        {roleDef.badge && (
                          <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                            isAssigned 
                              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' 
                              : 'bg-white/5 text-slate-400 border border-white/5'
                          }`}>
                            {roleDef.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                        {roleDef.description}
                      </p>
                    </div>
                  </td>

                  {/* Scope of Role */}
                  <td className="py-3.5 px-4 align-middle text-xs">
                    {isAssigned ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">
                        <span className="truncate max-w-[170px]">{scopeText}</span>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => setScopeModalRole(roleDef)}
                            className="text-slate-400 hover:text-sky-300 transition-colors p-0.5 rounded cursor-pointer"
                            title="Edit organizational unit / company scope"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-500 font-mono">-</span>
                    )}
                  </td>

                  {/* Assigned state (Toggle Switch) */}
                  <td className="py-3.5 px-4 align-middle">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isAssigned}
                        disabled={readOnly}
                        onClick={() => handleToggleRole(roleDef)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-1 focus:ring-offset-slate-900 ${
                          isAssigned ? 'bg-sky-600' : 'bg-slate-700'
                        } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                            isAssigned ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>

                      <span 
                        onClick={() => handleToggleRole(roleDef)}
                        className={`text-xs select-none cursor-pointer font-medium ${
                          isAssigned ? 'text-white font-semibold' : 'text-slate-400'
                        }`}
                      >
                        {isAssigned ? 'Assigned' : 'Not assigned'}
                      </span>
                    </div>
                  </td>

                  {/* Expiration */}
                  <td className="py-3.5 px-3 align-middle text-center text-slate-500 font-mono text-xs">
                    -
                  </td>

                  {/* Condition */}
                  <td className="py-3.5 px-3 align-middle text-center text-slate-500 font-mono text-xs">
                    -
                  </td>
                </tr>
              );
            })}

            {filteredRoles.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                  No roles match your search query &quot;{searchQuery}&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 3. Role Summary Footer (Clean, No clumsy pagination) */}
      <div className="p-3.5 border-t border-white/10 bg-[#10141D] flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span>Available Roles:</span>
          <span className="font-semibold text-white bg-slate-800 px-2 py-0.5 rounded-md text-[11px]">
            {filteredRoles.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-400">Status:</span>
          <span className="px-2.5 py-0.5 rounded-md bg-sky-500/15 text-sky-300 font-semibold text-[11px] border border-sky-500/30">
            {assignedCount} {assignedCount === 1 ? 'Role Assigned' : 'Roles Assigned'}
          </span>
        </div>
      </div>

      {/* Scope Editor Sub-Modal */}
      {scopeModalRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-white/20 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Pencil size={14} className="text-sky-400" />
                  Edit Scope of Role
                </h4>
                <p className="text-xs text-sky-400 font-semibold mt-0.5">
                  {scopeModalRole.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScopeModalRole(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-300">
                Select the organizational unit or company scope for this role assignment:
              </p>

              <div className="space-y-2">
                {[
                  'All organizational units',
                  'All 4 Subsidiaries (MAK Group Central)',
                  'Docks (Pvt) Ltd Only',
                  'Truckit (Pvt) Ltd Only',
                  'Muhib Cargo Only',
                  'Vantage Shipping Only',
                  'Karachi Port Stations & Terminals'
                ].map((scopeOption) => {
                  const currentScope = customScopeMap[scopeModalRole.id] || scopeModalRole.defaultScope;
                  const isSelected = currentScope === scopeOption;

                  return (
                    <button
                      key={scopeOption}
                      type="button"
                      onClick={() => {
                        setCustomScopeMap(prev => ({
                          ...prev,
                          [scopeModalRole.id]: scopeOption
                        }));
                        setScopeModalRole(null);
                      }}
                      className={`w-full p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                        isSelected 
                          ? 'bg-sky-500/20 border-sky-400 text-white font-semibold' 
                          : 'bg-black/30 border-white/10 text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span>{scopeOption}</span>
                      {isSelected && <Check size={14} className="text-sky-400" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setScopeModalRole(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminRolesAndPrivilegesTable;

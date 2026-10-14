import React from 'react';
import { ShieldCheck, Check } from 'lucide-react';
import { UserRole } from '../types';

export interface RoleDefinition {
  id: UserRole;
  name: string;
  shortLabel: string;
  description: string;
  defaultScope: string;
  badge?: string;
}

export const SYSTEM_ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: UserRole.ADMIN,
    name: 'Admin (Super Administrator)',
    shortLabel: 'Admin',
    description: 'Full system control & approvals',
    defaultScope: 'All units',
    badge: 'ADMIN'
  },
  {
    id: UserRole.OPERATIONS_MANAGER,
    name: 'Operations Manager',
    shortLabel: 'Operations Manager',
    description: 'Cargo clearing & port operations',
    defaultScope: 'All units',
    badge: 'OPS'
  },
  {
    id: UserRole.CASE_MANAGER,
    name: 'Case Manager',
    shortLabel: 'Case Manager',
    description: 'Case registration & workflow',
    defaultScope: 'All units',
    badge: 'CASE'
  },
  {
    id: UserRole.FINANCE_MANAGER,
    name: 'Finance Manager',
    shortLabel: 'Finance Manager',
    description: 'Ledgers, cashbook & billing',
    defaultScope: 'All units',
    badge: 'FINANCE'
  },
  {
    id: UserRole.VEHICLE_MANAGER,
    name: 'Vehicle / Fleet Manager',
    shortLabel: 'Vehicle Manager',
    description: 'Vehicles, drivers & fleet',
    defaultScope: 'All units',
    badge: 'FLEET'
  },
  {
    id: UserRole.LOADING_PORT_STAFF,
    name: 'Loading Port Staff',
    shortLabel: 'Loading Port Staff',
    description: 'Loading terminal & gate out',
    defaultScope: 'All units',
    badge: 'LOADING'
  },
  {
    id: UserRole.DESTINATION_PORT_STAFF,
    name: 'Destination Port Staff',
    shortLabel: 'Destination Staff',
    description: 'Destination arrival & DO release',
    defaultScope: 'All units',
    badge: 'DEST'
  },
  {
    id: UserRole.UNLOADING_PORT_STAFF,
    name: 'Unloading Port Staff',
    shortLabel: 'Unloading Staff',
    description: 'Unloading terminal & gate out',
    defaultScope: 'All units',
    badge: 'UNLOAD'
  },
  {
    id: UserRole.OFFICE_STAFF,
    name: 'Office Staff',
    shortLabel: 'Office Staff',
    description: 'Office desk & documentation',
    defaultScope: 'All units',
    badge: 'OFFICE'
  },
  {
    id: UserRole.TRANSPORTER,
    name: 'Transporter',
    shortLabel: 'Transporter',
    description: 'Transporter portal & fleet',
    defaultScope: 'All units',
    badge: 'TRP'
  },
  {
    id: UserRole.CLIENT,
    name: 'Client / Importer',
    shortLabel: 'Client',
    description: 'Client portal & shipment tracking',
    defaultScope: 'All units',
    badge: 'CLIENT'
  },
  {
    id: UserRole.VENDOR,
    name: 'Vendor / Supplier',
    shortLabel: 'Vendor',
    description: 'Supplier bills & ledger',
    defaultScope: 'All units',
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
  readOnly = false
}) => {
  const handleToggleRole = (roleId: UserRole) => {
    if (readOnly) return;
    const isAssigned = assignedRoles.includes(roleId);
    let newRoles: UserRole[];

    if (isAssigned) {
      newRoles = assignedRoles.filter(r => r !== roleId);
    } else {
      newRoles = [...assignedRoles, roleId];
    }

    const primaryRole = newRoles[0] || UserRole.OPERATIONS_MANAGER;
    onRolesChange(newRoles, primaryRole);
  };

  const assignedCount = assignedRoles.length;

  return (
    <div className="w-full bg-slate-950/70 border border-white/15 rounded-2xl p-3.5 sm:p-4 space-y-3 font-sans">
      {/* Compact Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-sky-400 shrink-0" size={17} />
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-white leading-tight">
              Select Roles (Tick to Activate for this ID)
            </h4>
            <p className="text-[11px] text-slate-400">
              Tick one or multiple roles — all ticked roles will be active when saved
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 ml-auto">
          <span className="text-[11px] font-mono tabular-nums font-semibold text-sky-300 bg-sky-500/15 border border-sky-500/30 px-2.5 py-0.5 rounded-lg">
            {assignedCount} Selected
          </span>
          {!readOnly && (
            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  const allRoles = SYSTEM_ROLE_DEFINITIONS.map(r => r.id);
                  onRolesChange(allRoles, UserRole.ADMIN);
                }}
                className="font-semibold text-sky-400 hover:text-sky-300 underline cursor-pointer"
              >
                Select All
              </button>
              <span className="text-slate-600">·</span>
              <button
                type="button"
                onClick={() => {
                  onRolesChange([], UserRole.OPERATIONS_MANAGER);
                }}
                className="font-semibold text-slate-400 hover:text-white underline cursor-pointer"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Compact Grid of Small Tickable Role Checkboxes */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {SYSTEM_ROLE_DEFINITIONS.map((roleDef) => {
          const isChecked = assignedRoles.includes(roleDef.id);
          return (
            <button
              key={roleDef.id}
              type="button"
              disabled={readOnly}
              onClick={() => handleToggleRole(roleDef.id)}
              className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all cursor-pointer select-none ${
                isChecked
                  ? 'bg-sky-500/20 border-sky-400 text-white shadow-sm'
                  : 'bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.07] hover:border-white/20 hover:text-white'
              } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {/* Checkbox Square */}
              <div
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${
                  isChecked
                    ? 'bg-sky-500 border-sky-400 text-slate-950'
                    : 'bg-black/40 border-white/25 group-hover:border-white/50'
                }`}
              >
                {isChecked && <Check size={12} strokeWidth={3} />}
              </div>

              {/* Compact Role Label */}
              <div className="min-w-0 flex-1">
                <span className={`text-xs font-semibold block truncate leading-tight ${isChecked ? 'text-white font-bold' : 'text-slate-200'}`}>
                  {roleDef.shortLabel}
                </span>
                <span className="text-[10px] text-slate-400 block truncate leading-tight mt-0.5">
                  {roleDef.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AdminRolesAndPrivilegesTable;

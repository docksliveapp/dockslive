import React from 'react';
import { ShieldCheck, Check, Lock } from 'lucide-react';
import { UserRole } from '../types';

export interface RoleDefinition {
  id: UserRole;
  name: string;
  shortLabel: string;
  description: string;
  defaultScope: string;
  badge?: string;
  exclusive?: boolean;
}

/**
 * Standalone / Exclusive Roles:
 * Selecting ANY of these roles locks & disables all other roles,
 * and selecting any combinable manager role disables all of these roles.
 */
export const EXCLUSIVE_SYSTEM_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.LOADING_PORT_STAFF,
  UserRole.DESTINATION_PORT_STAFF,
  UserRole.UNLOADING_PORT_STAFF,
  UserRole.TRANSPORTER,
  UserRole.CLIENT,
  UserRole.VENDOR
];

export const SYSTEM_ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: UserRole.ADMIN,
    name: 'Admin (Super Administrator)',
    shortLabel: 'Admin',
    description: 'Full Admin system control & approvals',
    defaultScope: 'All units',
    badge: 'ADMIN',
    exclusive: true
  },
  {
    id: UserRole.OPERATIONS_MANAGER,
    name: 'Operations Manager',
    shortLabel: 'Operations Manager',
    description: 'Cargo clearing & port operations',
    defaultScope: 'All units',
    badge: 'OPS',
    exclusive: false
  },
  {
    id: UserRole.CASE_MANAGER,
    name: 'Case Manager',
    shortLabel: 'Case Manager',
    description: 'Case registration & workflow',
    defaultScope: 'All units',
    badge: 'CASE',
    exclusive: false
  },
  {
    id: UserRole.FINANCE_MANAGER,
    name: 'Finance Manager',
    shortLabel: 'Finance Manager',
    description: 'Ledgers, cashbook & billing',
    defaultScope: 'All units',
    badge: 'FINANCE',
    exclusive: false
  },
  {
    id: UserRole.DOCUMENTATION_MANAGER,
    name: 'Documentation Manager',
    shortLabel: 'Documentation Manager',
    description: 'DO, TP, Excise, Fleet & Company Docs',
    defaultScope: 'All units',
    badge: 'DOCS',
    exclusive: false
  },
  {
    id: UserRole.LOADING_PORT_STAFF,
    name: 'Loading Port Staff',
    shortLabel: 'Loading Port Staff',
    description: 'Loading terminal & gate out (Standalone)',
    defaultScope: 'All units',
    badge: 'LOADING',
    exclusive: true
  },
  {
    id: UserRole.DESTINATION_PORT_STAFF,
    name: 'Destination Port Staff',
    shortLabel: 'Destination Staff',
    description: 'Destination arrival & DO release (Standalone)',
    defaultScope: 'All units',
    badge: 'DEST',
    exclusive: true
  },
  {
    id: UserRole.UNLOADING_PORT_STAFF,
    name: 'Unloading Port Staff',
    shortLabel: 'Unloading Staff',
    description: 'Unloading terminal & gate out (Standalone)',
    defaultScope: 'All units',
    badge: 'UNLOAD',
    exclusive: true
  },
  {
    id: UserRole.TRANSPORTER,
    name: 'Transporter',
    shortLabel: 'Transporter',
    description: 'Transporter portal & fleet (Standalone)',
    defaultScope: 'All units',
    badge: 'TRP',
    exclusive: true
  },
  {
    id: UserRole.CLIENT,
    name: 'Client / Importer',
    shortLabel: 'Client',
    description: 'Client portal & shipment tracking (Standalone)',
    defaultScope: 'All units',
    badge: 'CLIENT',
    exclusive: true
  },
  {
    id: UserRole.VENDOR,
    name: 'Vendor / Supplier',
    shortLabel: 'Vendor',
    description: 'Vendor bills & ledger (Standalone)',
    defaultScope: 'All units',
    badge: 'VENDOR',
    exclusive: true
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
  // Normalize legacy roles and strip OFFICE_STAFF from active software role checkboxes
  const normalizedRaw: UserRole[] = assignedRoles
    .map(r => (r === UserRole.VEHICLE_MANAGER ? UserRole.DOCUMENTATION_MANAGER : r))
    .filter(r => r !== UserRole.OFFICE_STAFF);

  // Enforce exclusivity invariant even on pre-loaded legacy arrays
  const firstExclusive = normalizedRaw.find(r => EXCLUSIVE_SYSTEM_ROLES.includes(r));
  const normalizedAssignedRoles: UserRole[] = firstExclusive
    ? [firstExclusive]
    : Array.from(new Set(normalizedRaw));

  const selectedExclusiveRole = normalizedAssignedRoles.find(r => EXCLUSIVE_SYSTEM_ROLES.includes(r)) || null;
  const hasCombinableManagerSelected = !selectedExclusiveRole && normalizedAssignedRoles.length > 0;

  const isRoleDisabled = (roleId: UserRole): boolean => {
    if (readOnly) return true;
    const isChecked = normalizedAssignedRoles.includes(roleId);
    if (isChecked) return false; // Always allow unticking a currently ticked role
    if (selectedExclusiveRole) {
      // An exclusive role is active -> ALL other roles are locked
      return true;
    }
    if (hasCombinableManagerSelected && EXCLUSIVE_SYSTEM_ROLES.includes(roleId)) {
      // One or more combinable manager roles are active -> exclusive standalone roles are locked
      return true;
    }
    return false;
  };

  const handleToggleRole = (roleId: UserRole) => {
    if (isRoleDisabled(roleId)) return;

    const isAssigned = normalizedAssignedRoles.includes(roleId);
    let newRoles: UserRole[];

    if (isAssigned) {
      newRoles = normalizedAssignedRoles.filter(r => r !== roleId);
    } else if (EXCLUSIVE_SYSTEM_ROLES.includes(roleId)) {
      newRoles = [roleId];
    } else {
      newRoles = [...normalizedAssignedRoles.filter(r => !EXCLUSIVE_SYSTEM_ROLES.includes(r)), roleId];
    }

    const primaryRole = newRoles[0] || UserRole.OPERATIONS_MANAGER;
    onRolesChange(newRoles, primaryRole);
  };

  const assignedCount = normalizedAssignedRoles.length;

  return (
    <div className="w-full bg-slate-950/70 border border-white/15 rounded-2xl p-3.5 sm:p-4 space-y-3 font-sans">
      {/* Compact Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-sky-400 shrink-0" size={17} />
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-white leading-tight">
              Select Role(s) for this User ID
            </h4>
            <p className="text-[11px] text-slate-400">
              {selectedExclusiveRole
                ? 'Standalone role selected — untick or click Clear to switch role'
                : 'Admin, Port Staff, Transporter, Client & Vendor are standalone roles; Manager roles can be combined'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 ml-auto">
          <span className="text-[11px] font-mono tabular-nums font-semibold text-sky-300 bg-sky-500/15 border border-sky-500/30 px-2.5 py-0.5 rounded-lg">
            {assignedCount} Selected
          </span>
          {!readOnly && assignedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                onRolesChange([], UserRole.OPERATIONS_MANAGER);
              }}
              className="text-[11px] font-semibold text-slate-300 hover:text-white underline cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Compact Grid of Role Checkboxes */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {SYSTEM_ROLE_DEFINITIONS.map((roleDef) => {
          const isChecked = normalizedAssignedRoles.includes(roleDef.id);
          const disabled = isRoleDisabled(roleDef.id);
          return (
            <button
              key={roleDef.id}
              type="button"
              disabled={disabled}
              onClick={() => handleToggleRole(roleDef.id)}
              className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all select-none ${
                isChecked
                  ? 'bg-sky-500/20 border-sky-400 text-white shadow-sm cursor-pointer'
                  : disabled
                    ? 'bg-white/[0.015] border-white/5 text-slate-500 opacity-45 cursor-not-allowed'
                    : 'bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.07] hover:border-white/20 hover:text-white cursor-pointer'
              }`}
            >
              {/* Checkbox Square */}
              <div
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${
                  isChecked
                    ? 'bg-sky-500 border-sky-400 text-slate-950'
                    : disabled
                      ? 'bg-black/30 border-white/10 text-slate-600'
                      : 'bg-black/40 border-white/25 group-hover:border-white/50'
                }`}
              >
                {isChecked ? <Check size={12} strokeWidth={3} /> : disabled ? <Lock size={9} /> : null}
              </div>

              {/* Compact Role Label */}
              <div className="min-w-0 flex-1">
                <span className={`text-xs font-semibold block truncate leading-tight ${isChecked ? 'text-white font-bold' : disabled ? 'text-slate-500' : 'text-slate-200'}`}>
                  {roleDef.shortLabel}
                </span>
                <span className={`text-[10px] block truncate leading-tight mt-0.5 ${disabled ? 'text-slate-600' : 'text-slate-400'}`}>
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

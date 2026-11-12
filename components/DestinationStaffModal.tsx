import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X, MapPin, User, Save, AlertTriangle, Key, Building2
} from 'lucide-react';
import { DestinationStaff, UserRole, AppUser } from '../types';
import {
  saveDestinationStaffToFirestore,
  saveUserToFirestore,
  DEFAULT_USER_PASSWORD,
  generateUniqueUsernameFromFullName
} from '../services/dbService';
import { saveVendor } from '../services/vendorService';
import { AdminRolesAndPrivilegesTable } from './AdminRolesAndPrivilegesTable';

interface DestinationStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffToEdit?: DestinationStaff | null;
  onSaved?: (savedStaff?: DestinationStaff, savedUser?: AppUser) => void;
}

export const COMMON_STATIONS = [
  'Karachi Port (KPT)',
  'Port Qasim (PQA)',
  'Torkham Border',
  'Chaman Border',
  'Peshawar Dry Port',
  'Quetta Chaman Transit Office',
  'Lahore Dry Port (Prem Nagar)',
  'Faisalabad Dry Port',
  'Sialkot Dry Port',
  'Islamabad Dry Port',
  'Gwadar Port',
  'Kabul Destination Terminal',
  'Kandahar Destination Point',
  'Jalalabad Hub'
];

export const DESTINATION_ROLES = [
  'Station Supervisor',
  'Loading Agent',
  'Unloading Agent',
  'Customs Clearance Agent',
  'Border Representative',
  'Port Operations Officer'
];

export const DestinationStaffModal: React.FC<DestinationStaffModalProps> = ({
  isOpen,
  onClose,
  staffToEdit,
  onSaved
}) => {
  const [formData, setFormData] = useState<Partial<DestinationStaff>>({
    name: '',
    station: 'Karachi Port (KPT)',
    role: 'Loading Agent',
    phone: '',
    secondaryPhone: '',
    cnic: '',
    address: '',
    defaultPerContainerCharge: 0,
    status: 'ACTIVE',
    notes: ''
  });

  const [userId, setUserId] = useState('');
  const [isCustomUserIdEdited, setIsCustomUserIdEdited] = useState(false);
  const [password, setPassword] = useState(DEFAULT_USER_PASSWORD);
  const [loginEnabled, setLoginEnabled] = useState(true);
  const [assignedRoles, setAssignedRoles] = useState<UserRole[]>([UserRole.DESTINATION_PORT_STAFF]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (staffToEdit) {
      setFormData({
        ...staffToEdit,
        defaultPerContainerCharge: Number(staffToEdit.defaultPerContainerCharge) || 0
      });
      setUserId(
        staffToEdit.userId ||
          generateUniqueUsernameFromFullName(staffToEdit.name || '', undefined, {
            id: staffToEdit.id,
            currentUserId: staffToEdit.userId
          })
      );
      setIsCustomUserIdEdited(Boolean(staffToEdit.userId));
      setPassword(staffToEdit.password || DEFAULT_USER_PASSWORD);
      setLoginEnabled(staffToEdit.loginEnabled ?? true);
      const defaultRole = staffToEdit.role?.toLowerCase().includes('loading')
        ? UserRole.LOADING_PORT_STAFF
        : staffToEdit.role?.toLowerCase().includes('unloading')
        ? UserRole.UNLOADING_PORT_STAFF
        : UserRole.DESTINATION_PORT_STAFF;
      setAssignedRoles(
        staffToEdit.roles && staffToEdit.roles.length > 0 ? [staffToEdit.roles[0]] : [defaultRole]
      );
    } else {
      setFormData({
        name: '',
        station: 'Karachi Port (KPT)',
        role: 'Loading Agent',
        phone: '',
        secondaryPhone: '',
        cnic: '',
        address: '',
        defaultPerContainerCharge: 0,
        status: 'ACTIVE',
        notes: ''
      });
      setUserId('');
      setIsCustomUserIdEdited(false);
      setPassword(DEFAULT_USER_PASSWORD);
      setLoginEnabled(true);
      setAssignedRoles([UserRole.DESTINATION_PORT_STAFF]);
    }
    setErrorMsg('');
  }, [staffToEdit, isOpen]);

  if (!isOpen) return null;

  const handleNameChange = (newName: string) => {
    setFormData(prev => ({ ...prev, name: newName }));
    if (!staffToEdit && !isCustomUserIdEdited) {
      setUserId(generateUniqueUsernameFromFullName(newName));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      setErrorMsg('Please enter representative full name');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const trimmedName = formData.name.trim();
      const resolvedUserId =
        userId.trim() ||
        generateUniqueUsernameFromFullName(
          trimmedName,
          undefined,
          staffToEdit ? { id: staffToEdit.id, currentUserId: staffToEdit.userId } : undefined
        );
      const resolvedPassword = password.trim() || DEFAULT_USER_PASSWORD;
      const singleRole = assignedRoles[0] || UserRole.DESTINATION_PORT_STAFF;

      const payload: Partial<DestinationStaff> = {
        ...formData,
        id: staffToEdit?.id || `dest_${Date.now()}`,
        name: trimmedName,
        phone: (formData.phone || '').trim(),
        station: formData.station || 'Karachi Port (KPT)',
        role: formData.role || 'Loading Agent',
        status: formData.status || 'ACTIVE',
        baseRate: 0,
        defaultPerContainerCharge: Number(formData.defaultPerContainerCharge) || 0,
        userId: resolvedUserId,
        password: resolvedPassword,
        loginEnabled,
        roles: [singleRole],
        updatedAt: new Date().toISOString(),
        createdAt: staffToEdit?.createdAt || new Date().toISOString()
      };

      await saveDestinationStaffToFirestore(payload);

      // Automatically register Destination Staff as a Vendor in Finance Management
      await saveVendor({
        id: `VND-DEST-${String(payload.id).replace(/[^a-zA-Z0-9_-]/g, '')}`,
        name: trimmedName,
        companyTitle: `Destination Port Representative (${payload.station})`,
        contactNumber: (formData.phone || '').trim() || 'N/A',
        address: formData.address?.trim() || payload.station || 'Destination Station',
        category: 'Destination Port Staff (Per Container)',
        isRecurring: false,
        createdAt: staffToEdit?.createdAt || new Date().toISOString()
      });

      let createdAppUser: AppUser | undefined;
      if (loginEnabled && resolvedUserId && resolvedPassword) {
        createdAppUser = {
          id: Date.now() % 10000000,
          userId: resolvedUserId,
          password: resolvedPassword,
          name: trimmedName,
          role: singleRole,
          roles: [singleRole],
          designation: `${formData.role || 'Port Staff'} (${formData.station || 'Station'})`,
          assignedStation: formData.station || 'Karachi Port (KPT)',
          contact: (formData.phone || '').trim(),
          email: '',
          status: formData.status === 'INACTIVE' ? 'SUSPENDED' : 'ACTIVE',
          allowedCompanies: ['docks', 'truckit', 'muhib', 'vantage'],
          baseSalary: 0,
          defaultPerContainerCharge: Number(formData.defaultPerContainerCharge) || 0
        };
        await saveUserToFirestore(createdAppUser);
      }

      if (onSaved) onSaved(payload as DestinationStaff, createdAppUser);
      onClose();
    } catch (err: any) {
      console.error('Error saving destination staff:', err);
      setErrorMsg(err.message || 'Failed to save staff record');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-white/15 rounded-3xl shadow-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] my-auto flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-4 sm:p-5 border-b border-white/10 bg-slate-900/95 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <MapPin size={20} />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400 font-bold">
                Border &amp; Port Network
              </span>
              <h3 className="text-base sm:text-lg font-bold text-white">
                {staffToEdit ? 'Edit Destination Staff Profile' : 'Register Port & Station Staff'}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 rounded-xl bg-white/5 hover:bg-white/10 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {errorMsg && (
          <div className="mx-4 sm:mx-6 mt-3 p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-xs text-red-200 flex items-center gap-2 shrink-0">
            <AlertTriangle size={15} className="shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form Body with Fixed Footer */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden text-xs">
          <div className="p-4 sm:p-6 overflow-y-auto space-y-5 custom-scrollbar flex-1 min-h-0 overscroll-contain">
            {/* Section 1: Representative Particulars */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                <User size={14} className="text-brand-400" /> Representative Details
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="text-gray-300 font-medium block mb-1">
                    Full Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Haji Rehmatullah"
                    value={formData.name || ''}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className="w-full glass-input rounded-xl p-2.5 bg-black/40 border border-white/15 text-white outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="text-gray-300 font-medium block mb-1">
                    Assigned Terminal / Border Station
                  </label>
                  <select
                    value={formData.station}
                    onChange={(e) => setFormData({ ...formData, station: e.target.value })}
                    className="w-full glass-input rounded-xl p-2.5 bg-black/40 border border-white/15 text-white outline-none focus:border-amber-400"
                  >
                    {COMMON_STATIONS.map(st => (
                      <option key={st} value={st} className="bg-slate-900">{st}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-gray-300 font-medium block mb-1">
                    Primary Mobile Phone
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 0300-9876543"
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full glass-input rounded-xl p-2.5 bg-black/40 border border-white/15 text-white outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="text-gray-300 font-medium block mb-1">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full glass-input rounded-xl p-2.5 bg-black/40 border border-white/15 text-white outline-none focus:border-amber-400"
                  >
                    <option value="ACTIVE" className="bg-slate-900">Active Duty</option>
                    <option value="INACTIVE" className="bg-slate-900">Inactive / On Leave</option>
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-2.5 text-amber-200 text-[11px]">
                <Building2 size={15} className="shrink-0 mt-0.5 text-amber-400" />
                <span>
                  Destination Staff is automatically registered as a <strong>Vendor</strong> in <strong>Finance Management</strong>. All per-container charges and settlements are managed directly from Finance Management.
                </span>
              </div>
            </div>

            {/* Section 2: Portal Login Credentials & Roles Assignment Table */}
            <div className="space-y-3 pt-3 border-t border-white/10 bg-white/5 p-4 rounded-2xl border">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Key size={14} className="text-purple-400" />
                  Portal Login Credentials &amp; Role
                </h4>
                <div className="flex items-center gap-3 text-[11px] font-mono">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomUserIdEdited(false);
                      setUserId(
                        generateUniqueUsernameFromFullName(
                          formData.name || '',
                          undefined,
                          staffToEdit ? { id: staffToEdit.id, currentUserId: staffToEdit.userId } : undefined
                        )
                      );
                    }}
                    className="text-brand-400 hover:text-brand-300 underline cursor-pointer"
                  >
                    Auto ID from Name
                  </button>
                  <button
                    type="button"
                    onClick={() => setPassword(DEFAULT_USER_PASSWORD)}
                    className="text-purple-400 hover:text-purple-300 underline cursor-pointer"
                  >
                    Default ({DEFAULT_USER_PASSWORD})
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 font-mono">
                <div>
                  <label className="text-gray-400 text-[10px] block mb-1">
                    User ID (Auto FullName without spaces — Admin Editable):
                  </label>
                  <input
                    type="text"
                    value={userId}
                    placeholder="Auto-generated from Full Name"
                    onChange={(e) => {
                      setIsCustomUserIdEdited(true);
                      setUserId(e.target.value);
                    }}
                    className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-purple-300 text-xs font-bold outline-none focus:border-purple-400"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-[10px] block mb-1">
                    Login Password (Default {DEFAULT_USER_PASSWORD} — Admin Editable):
                  </label>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-white text-xs font-bold outline-none focus:border-purple-400"
                  />
                </div>
              </div>

              {/* Standardized Roles & Privileges Table */}
              <div className="pt-2">
                <AdminRolesAndPrivilegesTable
                  assignedRoles={assignedRoles}
                  userName={formData.name || 'this port representative'}
                  allowedCompanies={['docks', 'truckit', 'muhib', 'vantage']}
                  onRolesChange={(newRoles) => {
                    setAssignedRoles(newRoles.length > 0 ? newRoles : [UserRole.DESTINATION_PORT_STAFF]);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Sticky Footer Buttons */}
          <div className="flex justify-between items-center p-3.5 sm:p-4 border-t border-white/10 bg-slate-900/95 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="bg-white/10 hover:bg-white/15 text-gray-300 px-4 py-2.5 rounded-xl font-medium text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-semibold text-xs shadow-lg shadow-amber-600/30 transition flex items-center gap-2 cursor-pointer"
            >
              <Save size={15} />
              <span>{isSubmitting ? 'Saving...' : staffToEdit ? 'Update Profile' : 'Save Representative'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

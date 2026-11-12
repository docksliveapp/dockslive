import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Users, UserPlus, Briefcase, Truck, Edit, Trash2, Key, Save, X, CheckCircle,
  AlertTriangle, ChevronRight, Clock, Plus, Phone, MapPin, Building, Check,
  LayoutGrid, List, Search, MapPinned, Lock, Unlock, Crown
} from 'lucide-react';
import {
  AppUser, UserRole, Client, DestinationStaff
} from '../types';
import { safeAppStorage } from '../services/storage';
import {
  saveUserToFirestore,
  deleteUserFromFirestore,
  subscribeToUsers,
  subscribeToClients,
  updateClientInFirestore,
  deleteClientFromFirestore,
  subscribeToDestinationStaff,
  deleteDestinationStaffFromFirestore,
  DEFAULT_DATABASE_USERS,
  DEFAULT_USER_PASSWORD,
  generateUniqueUsernameFromFullName
} from '../services/dbService';
import { saveVendor } from '../services/vendorService';

import { ClientRegistrationModal } from './ClientRegistrationModal';
import { DestinationStaffModal } from './DestinationStaffModal';
import { AdminRolesAndPrivilegesTable } from './AdminRolesAndPrivilegesTable';
import { useActiveCompany } from '../services/companyService';

export const CASE_CATEGORIES = [
  "Afghan Transit",
  "Bonded Carrier",
  "Customs Clearance",
  "TIR",
  "Transportation of Private Cargo",
  "Warehousing & Distribution"
];

const UserManagement: React.FC = () => {
  const { activeCompany } = useActiveCompany();
  const [activeTab, setActiveTab] = useState<'office' | 'clients' | 'transporters' | 'destinations'>(() => {
    return (safeAppStorage.getItem('dpl_user_tab') as any) || 'office';
  });

  const [destSubTab, setDestSubTab] = useState<'agents' | 'users'>('agents');

  useEffect(() => {
    safeAppStorage.setItem('dpl_user_tab', activeTab);
  }, [activeTab]);

  // Live state from Firestore subscriptions
  const [users, setUsers] = useState<AppUser[]>(() => {
    const cached = safeAppStorage.getJSON<AppUser[]>('dpl_live_users', []);
    return cached && cached.length > 0 ? cached : DEFAULT_DATABASE_USERS;
  });
  const [clientsList, setClientsList] = useState<Client[]>([]);
  const [destinationStaffList, setDestinationStaffList] = useState<DestinationStaff[]>(() => {
    return safeAppStorage.getJSON<DestinationStaff[]>('dpl_destination_staff', []);
  });

  // Subscribe to real-time collections
  useEffect(() => {
    const unsubUsers = subscribeToUsers((data) => {
      if (data && data.length > 0) {
        setUsers(data);
      }
    });

    const unsubClients = subscribeToClients((data) => {
      setClientsList(data || []);
    });

    const unsubDest = subscribeToDestinationStaff((data) => {
      setDestinationStaffList(data || []);
    });

    return () => {
      unsubUsers();
      unsubClients();
      unsubDest();
    };
  }, []);

  // Search & View Mode (Default to clean sequential single-row table)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals Flow
  const [showRoleSelectorModal, setShowRoleSelectorModal] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedOnboardingRole, setSelectedOnboardingRole] = useState<'STAFF' | 'TRANSPORTER' | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [isCustomUserIdEdited, setIsCustomUserIdEdited] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [modalActionFeedback, setModalActionFeedback] = useState<string | null>(null);

  // Client modal
  const [showClientModal, setShowClientModal] = useState(false);
  const [clientToEdit, setClientToEdit] = useState<Client | null>(null);

  // Destination staff modal
  const [showDestinationModal, setShowDestinationModal] = useState(false);
  const [destinationStaffToEdit, setDestinationStaffToEdit] = useState<DestinationStaff | null>(null);

  // Delete Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'USER' | 'CLIENT' | 'DESTINATION';
    id: string | number;
    name: string;
    docId?: string;
    userLoginId?: string;
  } | null>(null);

  // Streamlined Form State for Software Login Users & Transporters
  const [formData, setFormData] = useState({
    name: '',
    contact: '',
    role: '' as UserRole | '',
    roles: [] as UserRole[],
    generatedId: '',
    generatedPass: DEFAULT_USER_PASSWORD,
    // Company Rights & Role Scopes
    allowedCompanies: ['docks'] as string[],
    allCompaniesAccess: false as boolean,
    isGlobalAdmin: false as boolean,
    // Transporter/Broker fields
    representativeName: '',
    preferredRoutes: 'Karachi - Lahore - Peshawar',
    whatsappNumber: '',
    status: 'ACTIVE' as 'ACTIVE' | 'SUSPENDED'
  });

  // Open primary create button
  const handleOpenAdd = () => {
    if (activeTab === 'clients') {
      setClientToEdit(null);
      setShowClientModal(true);
      return;
    }
    if (activeTab === 'destinations') {
      if (destSubTab === 'users') {
        handleSelectRoleType('STAFF', [UserRole.DESTINATION_PORT_STAFF]);
      } else {
        setDestinationStaffToEdit(null);
        setShowDestinationModal(true);
      }
      return;
    }
    if (activeTab === 'transporters') {
      handleSelectRoleType('TRANSPORTER');
      return;
    }
    handleSelectRoleType('STAFF');
  };

  const handleSelectRoleType = (roleType: 'STAFF' | 'TRANSPORTER', defaultRolesOverride?: UserRole[]) => {
    setSelectedOnboardingRole(roleType);
    setShowRoleSelectorModal(false);
    setIsEditing(false);
    setEditingId(null);
    setIsCustomUserIdEdited(false);
    setFormError(null);
    setModalActionFeedback(null);

    const finalRoles =
      defaultRolesOverride ||
      (roleType === 'TRANSPORTER' ? [UserRole.TRANSPORTER] : [UserRole.OPERATIONS_MANAGER]);
    const finalRole = finalRoles[0];

    setFormData({
      name: '',
      contact: '',
      role: finalRole,
      roles: finalRoles,
      generatedId: '',
      generatedPass: DEFAULT_USER_PASSWORD,
      allowedCompanies: ['docks', 'truckit', 'muhib', 'vantage'],
      allCompaniesAccess: true,
      isGlobalAdmin: false,
      representativeName: '',
      preferredRoutes: 'Karachi - Lahore - Peshawar',
      whatsappNumber: '',
      status: 'ACTIVE'
    });

    if (roleType === 'TRANSPORTER') setActiveTab('transporters');
    else if (
      defaultRolesOverride?.includes(UserRole.DESTINATION_PORT_STAFF) ||
      defaultRolesOverride?.includes(UserRole.UNLOADING_PORT_STAFF) ||
      defaultRolesOverride?.includes(UserRole.LOADING_PORT_STAFF)
    ) {
      setActiveTab('destinations');
    } else {
      setActiveTab('office');
    }

    setShowModal(true);
  };

  const handleEditUser = (user: AppUser) => {
    const isTransporter = user.role === UserRole.TRANSPORTER;
    const roleType = isTransporter ? 'TRANSPORTER' : 'STAFF';
    setSelectedOnboardingRole(roleType);

    const rawRoles =
      user.roles && user.roles.length > 0
        ? user.roles.filter((r) => r !== UserRole.OFFICE_STAFF)
        : user.role && user.role !== UserRole.OFFICE_STAFF
        ? [user.role]
        : [UserRole.OPERATIONS_MANAGER];
    const userRoles = rawRoles.length > 0 ? rawRoles : [UserRole.OPERATIONS_MANAGER];

    const userAllowed =
      user.allowedCompanies && user.allowedCompanies.length > 0
        ? user.allowedCompanies
        : [activeCompany?.id || 'docks'];
    const isAllComp = Boolean(user.isGlobalAdmin || userAllowed.length === 4);

    setFormData({
      name: user.name || '',
      contact: user.contact || '',
      role: userRoles[0],
      roles: userRoles,
      generatedId:
        user.userId ||
        generateUniqueUsernameFromFullName(user.name || '', users, {
          id: user.id,
          currentUserId: user.userId
        }),
      generatedPass: user.password || DEFAULT_USER_PASSWORD,
      allowedCompanies: userAllowed,
      allCompaniesAccess: isAllComp,
      isGlobalAdmin: Boolean(user.isGlobalAdmin),
      representativeName: (user as any).representativeName || '',
      preferredRoutes: (user as any).preferredRoutes || 'Karachi - Lahore - Peshawar',
      whatsappNumber: (user as any).whatsappNumber || '',
      status: (user.status as any) === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'
    });

    setIsCustomUserIdEdited(Boolean(user.userId));
    setFormError(null);
    setModalActionFeedback(null);
    setIsEditing(true);
    setEditingId(user.id);
    setShowModal(true);
  };

  const handleFullNameInputChange = (nextName: string) => {
    setFormData((prev) => {
      const shouldAutoUpdateId = !isEditing && !isCustomUserIdEdited;
      const autoId = shouldAutoUpdateId
        ? generateUniqueUsernameFromFullName(nextName, users)
        : prev.generatedId;
      return {
        ...prev,
        name: nextName,
        generatedId: autoId
      };
    });
  };

  const handleSaveUser = async () => {
    if (!formData.name.trim()) {
      setFormError('Please enter Full Name before saving.');
      return;
    }
    setFormError(null);

    const assignedRoles =
      formData.roles && formData.roles.length > 0
        ? formData.roles
        : selectedOnboardingRole === 'TRANSPORTER'
        ? [UserRole.TRANSPORTER]
        : [formData.role || UserRole.OPERATIONS_MANAGER];
    const primaryRole =
      assignedRoles[0] ||
      (selectedOnboardingRole === 'TRANSPORTER' ? UserRole.TRANSPORTER : UserRole.OPERATIONS_MANAGER);

    const effectiveAllowedCompanies = formData.allCompaniesAccess
      ? ['docks', 'truckit', 'muhib', 'vantage']
      : formData.allowedCompanies.length > 0
      ? formData.allowedCompanies
      : [activeCompany?.id || 'docks'];

    const effectiveIsGlobal = assignedRoles.includes(UserRole.ADMIN) && formData.isGlobalAdmin;

    const existingUser =
      isEditing && editingId ? users.find((u) => String(u.id) === String(editingId)) : undefined;

    const resolvedUserId =
      formData.generatedId.trim() ||
      generateUniqueUsernameFromFullName(
        formData.name.trim(),
        users,
        isEditing && editingId
          ? { id: editingId, currentUserId: existingUser?.userId }
          : undefined
      );
    const resolvedPassword = formData.generatedPass.trim() || DEFAULT_USER_PASSWORD;

    const savedRecordId = isEditing && editingId ? Number(editingId) || Date.now() : Date.now();

    const userPayload: AppUser = {
      ...(existingUser || {}),
      id: savedRecordId,
      ...((existingUser as any)?._docId ? { _docId: (existingUser as any)._docId } : {}),
      name: formData.name.trim(),
      email: existingUser?.email || '',
      contact: formData.contact.trim(),
      role: primaryRole as UserRole,
      roles: assignedRoles as UserRole[],
      designation: '',
      status: formData.status || 'ACTIVE',
      isSuspended: formData.status === 'SUSPENDED',
      isAdmin: assignedRoles.includes(UserRole.ADMIN),
      isGlobalAdmin: effectiveIsGlobal,
      allowedCompanies: effectiveAllowedCompanies,
      userId: resolvedUserId,
      password: resolvedPassword,
      baseSalary: 0,
      defaultPerContainerCharge: 0,
      ...(selectedOnboardingRole === 'TRANSPORTER'
        ? {
            representativeName: formData.representativeName,
            preferredRoutes: formData.preferredRoutes,
            whatsappNumber: formData.whatsappNumber
          }
        : {})
    } as any;

    const nextUsers =
      isEditing && editingId
        ? users.map((u) => (String(u.id) === String(editingId) ? userPayload : u))
        : [...users, userPayload];

    setUsers(nextUsers);
    try {
      await saveUserToFirestore(userPayload);

      // If Destination Staff or Vendor role is assigned, register them as a Vendor in Finance Management
      if (
        assignedRoles.includes(UserRole.DESTINATION_PORT_STAFF) ||
        assignedRoles.includes(UserRole.UNLOADING_PORT_STAFF) ||
        assignedRoles.includes(UserRole.VENDOR)
      ) {
        await saveVendor({
          id: `VND-USR-${savedRecordId}`,
          name: formData.name.trim(),
          companyTitle: assignedRoles.includes(UserRole.VENDOR)
            ? 'Registered Portal Vendor'
            : 'Destination Port Staff (Per Container)',
          contactNumber: formData.contact.trim() || 'N/A',
          address: 'Managed via Finance Management',
          category: assignedRoles.includes(UserRole.VENDOR)
            ? 'Miscellaneous Payments'
            : 'Destination Port Staff (Per Container)',
          isRecurring: false,
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn('Notice: User saved locally', err);
    }

    setShowModal(false);
  };

  const confirmDeleteTarget = async () => {
    if (!deleteTarget) return;

    try {
      if (deleteTarget.type === 'USER') {
        setUsers((prev) =>
          prev.filter((u) => {
            if (deleteTarget.docId && (u as any)._docId) {
              return String((u as any)._docId) !== String(deleteTarget.docId);
            }
            if (deleteTarget.userLoginId && u.userId) {
              return u.userId.toLowerCase() !== deleteTarget.userLoginId.toLowerCase();
            }
            return String(u.id) !== String(deleteTarget.id);
          })
        );
        if (isEditing && String(editingId) === String(deleteTarget.id)) {
          setShowModal(false);
          setIsEditing(false);
          setEditingId(null);
        }
        await deleteUserFromFirestore(deleteTarget.id, deleteTarget.docId, deleteTarget.userLoginId);
      } else if (deleteTarget.type === 'CLIENT') {
        setClientsList((prev) => prev.filter((c) => (c.id || c.name) !== deleteTarget.id));
        await deleteClientFromFirestore(String(deleteTarget.id));
      } else if (deleteTarget.type === 'DESTINATION') {
        setDestinationStaffList((prev) => prev.filter((d) => d.id !== deleteTarget.id));
        await deleteDestinationStaffFromFirestore(String(deleteTarget.id));
      }
    } catch (err) {
      console.warn('Notice deleting target:', err);
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleQuickSuspendToggleInModal = async () => {
    const nextStatus: 'ACTIVE' | 'SUSPENDED' = formData.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    setFormData((prev) => ({ ...prev, status: nextStatus }));

    if (isEditing && editingId) {
      const targetUser = users.find((u) => String(u.id) === String(editingId));
      if (targetUser) {
        const updatedUser: AppUser = {
          ...targetUser,
          status: nextStatus,
          isSuspended: nextStatus === 'SUSPENDED'
        } as AppUser;
        setUsers((prev) => prev.map((u) => (String(u.id) === String(editingId) ? updatedUser : u)));
        try {
          await saveUserToFirestore(updatedUser);
        } catch (err) {
          console.warn('Notice updating user suspend status:', err);
        }
      }
    }

    setModalActionFeedback(
      nextStatus === 'SUSPENDED'
        ? 'Account ID suspended — portal login access is now blocked.'
        : 'Account ID reactivated — portal login access is now active.'
    );
  };

  const formatRoleLabel = (r: UserRole | string, isGlobalAdmin?: boolean): string => {
    if (!r) return 'Manager';
    if (r === UserRole.ADMIN) return isGlobalAdmin ? 'Group Admin' : 'Company Admin';
    if (r === UserRole.DESTINATION_PORT_STAFF) return 'Destination Staff';
    if (r === UserRole.UNLOADING_PORT_STAFF) return 'Unloading Staff';
    if (r === UserRole.LOADING_PORT_STAFF) return 'Loading Port Staff';
    return String(r)
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  };

  const formatUserSingleLineRole = (user: AppUser): string => {
    const roleList =
      user.roles && user.roles.length > 0
        ? user.roles
        : user.role
        ? [user.role]
        : [UserRole.OPERATIONS_MANAGER];
    const primary = roleList.includes(UserRole.ADMIN) ? UserRole.ADMIN : roleList[0];
    const baseLabel = formatRoleLabel(primary, user.isGlobalAdmin);
    return roleList.length > 1 ? `${baseLabel} (+${roleList.length - 1})` : baseLabel;
  };

  const formatUserAllRolesTitle = (user: AppUser): string => {
    const roleList =
      user.roles && user.roles.length > 0
        ? user.roles
        : user.role
        ? [user.role]
        : [UserRole.OPERATIONS_MANAGER];
    return roleList.map((r) => formatRoleLabel(r, user.isGlobalAdmin)).join(', ');
  };

  const renderSingleRowUsersTable = (userList: AppUser[], keyPrefix: string) => (
    <div className="glass-card rounded-2xl overflow-hidden border border-white/10 shadow-xl">
      <div
        className="overflow-x-auto custom-scrollbar custom-scrollbar-x"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
      >
        <table className="w-full text-left text-xs sm:text-sm text-gray-200 min-w-[780px]">
          <thead className="bg-white/5 text-xs font-semibold text-gray-400 border-b border-white/10">
            <tr>
              <th className="py-3 px-3.5 whitespace-nowrap w-14">S.No</th>
              <th className="py-3 px-3.5 whitespace-nowrap">Name</th>
              <th className="py-3 px-3.5 whitespace-nowrap">Role</th>
              <th className="py-3 px-3.5 whitespace-nowrap">Username</th>
              <th className="py-3 px-3.5 whitespace-nowrap">Password</th>
              <th className="py-3 px-3.5 whitespace-nowrap">Status</th>
              <th className="py-3 px-3.5 whitespace-nowrap text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {userList.map((user, idx) => {
              const isSuspended = user.status === 'SUSPENDED';
              return (
                <tr
                  key={`${keyPrefix}_${user.id || idx}_${idx}`}
                  className="hover:bg-white/5 transition-colors h-11"
                >
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-gray-400 whitespace-nowrap">
                    {idx + 1}
                  </td>
                  <td
                    className="py-2.5 px-3.5 font-semibold text-white whitespace-nowrap max-w-[240px] truncate"
                    title={user.name}
                  >
                    {user.name || '-'}
                  </td>
                  <td
                    className="py-2.5 px-3.5 text-gray-200 whitespace-nowrap max-w-[220px] truncate"
                    title={formatUserAllRolesTitle(user)}
                  >
                    {formatUserSingleLineRole(user)}
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-brand-400 font-medium whitespace-nowrap">
                    {user.userId || '-'}
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-gray-200 whitespace-nowrap">
                    {user.password || '-'}
                  </td>
                  <td className="py-2.5 px-3.5 whitespace-nowrap">
                    <span
                      className={`text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap ${
                        isSuspended ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {isSuspended && <Lock size={12} className="shrink-0" />}
                      <span>{isSuspended ? 'Suspended' : 'Active'}</span>
                    </span>
                  </td>
                  <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleEditUser(user)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Edit size={13} />
                      <span>Edit</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // User Scope & Authority: Check whether current logged-in session is a Group Super Admin or Company Admin
  const isCurrentUserGlobalAdmin = safeAppStorage.getItem('dpl_is_global_admin') === 'true';
  const [showAllGroupStaff, setShowAllGroupStaff] = useState(true);

  const userBelongsToCompany = (u: AppUser, targetCompanyId: string) => {
    if (u.isGlobalAdmin) return true;
    if (u.allowedCompanies && Array.isArray(u.allowedCompanies) && u.allowedCompanies.length > 0) {
      return u.allowedCompanies.includes(targetCompanyId) || u.allowedCompanies.includes('all');
    }
    return true;
  };

  const baseOfficeUsers = users.filter(
    (u) => u.role !== UserRole.CLIENT && u.role !== UserRole.TRANSPORTER
  );
  const officeUsers =
    isCurrentUserGlobalAdmin && showAllGroupStaff
      ? baseOfficeUsers
      : baseOfficeUsers.filter((u) => userBelongsToCompany(u, activeCompany.id));

  const transporterUsers = users.filter((u) => u.role === UserRole.TRANSPORTER);

  const q = searchQuery.toLowerCase().trim();

  const filteredOfficeUsers = officeUsers.filter((u) => {
    if (!q) return true;
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.userId && u.userId.toLowerCase().includes(q)) ||
      (u.role && u.role.toLowerCase().includes(q))
    );
  });

  const filteredClients = clientsList.filter((c) => {
    if (!q) return true;
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.ownerName && c.ownerName.toLowerCase().includes(q)) ||
      (c.userId && c.userId.toLowerCase().includes(q)) ||
      (c.mobileNumber && c.mobileNumber.toLowerCase().includes(q)) ||
      (c.contact && c.contact.toLowerCase().includes(q)) ||
      (c.defaultCaseCategory && c.defaultCaseCategory.toLowerCase().includes(q)) ||
      (c.ntn && c.ntn.toLowerCase().includes(q))
    );
  });

  const filteredTransporters = transporterUsers.filter((u) => {
    if (!q) return true;
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.userId && u.userId.toLowerCase().includes(q)) ||
      (u.contact && u.contact.toLowerCase().includes(q))
    );
  });

  const filteredDestinationStaff = destinationStaffList.filter((d) => {
    if (!q) return true;
    return (
      (d.name && d.name.toLowerCase().includes(q)) ||
      (d.station && d.station.toLowerCase().includes(q)) ||
      (d.role && d.role.toLowerCase().includes(q)) ||
      (d.phone && d.phone.toLowerCase().includes(q))
    );
  });

  const baseDestinationUsers = users.filter(
    (u) =>
      u.role === UserRole.LOADING_PORT_STAFF ||
      u.role === UserRole.UNLOADING_PORT_STAFF ||
      u.role === UserRole.DESTINATION_PORT_STAFF ||
      (u.roles &&
        (u.roles.includes(UserRole.LOADING_PORT_STAFF) ||
          u.roles.includes(UserRole.UNLOADING_PORT_STAFF) ||
          u.roles.includes(UserRole.DESTINATION_PORT_STAFF)))
  );

  const destinationUsers =
    isCurrentUserGlobalAdmin && showAllGroupStaff
      ? baseDestinationUsers
      : baseDestinationUsers.filter((u) => userBelongsToCompany(u, activeCompany.id));

  const filteredDestinationUsers = destinationUsers.filter((u) => {
    if (!q) return true;
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.userId && u.userId.toLowerCase().includes(q))
    );
  });

  const getActiveCount = () => {
    if (activeTab === 'office') return filteredOfficeUsers.length;
    if (activeTab === 'clients') return filteredClients.length;
    if (activeTab === 'transporters') return filteredTransporters.length;
    return destSubTab === 'agents' ? filteredDestinationStaff.length : filteredDestinationUsers.length;
  };

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in pb-12 font-sans w-full max-w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 drop-shadow-md">
              <Users className="text-brand-400" /> {activeCompany.legalTitle || activeCompany.name} · Portal Users &amp; Entity Directory
            </h2>
            {isCurrentUserGlobalAdmin ? (
              <span className="px-2.5 py-0.5 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[11px] font-bold flex items-center gap-1 shadow-sm">
                <Crown size={12} /> Main Group Super Admin
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center gap-1 shadow-sm">
                <Building size={12} /> Company Administrator
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Software User IDs &amp; Portal Access. Non-login Office Salary Staff &amp; financial ledgers are managed in Finance Management.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {isCurrentUserGlobalAdmin && (
            <button
              type="button"
              onClick={() => setShowAllGroupStaff(!showAllGroupStaff)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0 cursor-pointer ${
                showAllGroupStaff
                  ? 'bg-purple-600/30 border-purple-400 text-purple-200'
                  : 'bg-white/5 border-white/10 text-gray-300 hover:text-white'
              }`}
              title="Toggle between active company users and all 4 group companies users"
            >
              <Crown size={13} className="text-purple-400" />
              <span>{showAllGroupStaff ? 'All 4 Companies View' : `${activeCompany.shortName || activeCompany.name} Only`}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenAdd}
            className="flex-1 sm:flex-initial bg-brand-600 hover:bg-brand-500 text-white px-4 sm:px-5 py-2 rounded-xl flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all whitespace-nowrap cursor-pointer"
          >
            <UserPlus size={17} />
            <span>
              {activeTab === 'clients'
                ? 'Register New Client'
                : activeTab === 'destinations'
                ? destSubTab === 'users'
                  ? 'Create Destination User ID'
                  : 'Add Destination Representative'
                : activeTab === 'transporters'
                ? 'Add Transporter / Broker'
                : 'Create User ID'}
            </span>
          </button>
        </div>
      </div>

      {/* Primary 4 Tabs */}
      <div className="flex flex-wrap gap-2 sm:gap-3 border-b border-white/10 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('office')}
          className={`flex items-center gap-2 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm font-semibold shrink-0 cursor-pointer ${
            activeTab === 'office'
              ? 'bg-brand-600/20 text-brand-300 border border-brand-500/40 shadow-md'
              : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
        >
          <Briefcase size={16} /> System Users ({officeUsers.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('clients')}
          className={`flex items-center gap-2 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm font-semibold shrink-0 cursor-pointer ${
            activeTab === 'clients'
              ? 'bg-brand-600/20 text-brand-300 border border-brand-500/40 shadow-md'
              : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
        >
          <Building size={16} /> Clients ({clientsList.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('transporters')}
          className={`flex items-center gap-2 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm font-semibold shrink-0 cursor-pointer ${
            activeTab === 'transporters'
              ? 'bg-brand-600/20 text-brand-300 border border-brand-500/40 shadow-md'
              : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
        >
          <Truck size={16} /> Transporters / Brokers ({transporterUsers.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('destinations')}
          className={`flex items-center gap-2 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm font-semibold shrink-0 cursor-pointer ${
            activeTab === 'destinations'
              ? 'bg-amber-600/20 text-amber-300 border border-amber-500/40 shadow-md'
              : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
        >
          <MapPin size={16} /> Destinations Staff ({destinationStaffList.length + destinationUsers.length})
        </button>
      </div>

      {/* Search & Layout View Mode Switcher */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-white/5 p-2 sm:p-2.5 rounded-2xl border border-white/10">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={
              activeTab === 'office'
                ? 'Search system users by name, username, role...'
                : activeTab === 'clients'
                ? 'Search clients by company, owner, username, NTN...'
                : activeTab === 'transporters'
                ? 'Search transporters / brokers by fleet name, username...'
                : destSubTab === 'users'
                ? 'Search destination staff login accounts by name, username...'
                : 'Search destination representatives by name, station, role...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-black/40 border border-white/10 rounded-xl text-xs sm:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs p-1"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
          <span className="text-xs text-gray-400 px-1 font-mono tabular-nums">
            {getActiveCount()} {getActiveCount() === 1 ? 'record' : 'records'}
          </span>

          <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <LayoutGrid size={14} />
              <span>Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <List size={14} />
              <span>Table</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. SYSTEM USERS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'office' &&
        (filteredOfficeUsers.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center border border-white/10 text-gray-400 space-y-2">
            <Users size={32} className="mx-auto text-gray-500 mb-2" />
            <p className="text-sm font-semibold text-white">No system users found</p>
            <p className="text-xs text-gray-500">Click &quot;Create User ID&quot; to assign portal login access.</p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredOfficeUsers.map((user, idx) => (
              <div
                key={`user_card_${user.id || idx}_${idx}`}
                className="glass-card rounded-2xl p-4 border border-white/10 hover:border-brand-500/30 transition-all shadow-lg space-y-3 relative overflow-hidden group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-sm font-bold text-white shrink-0">
                      {(user.name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-sm truncate">{user.name}</h4>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{formatUserSingleLineRole(user)}</p>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-semibold flex items-center gap-1 shrink-0 ${
                      user.status === 'SUSPENDED' ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {user.status === 'SUSPENDED' && <Lock size={11} />}
                    <span>{user.status === 'SUSPENDED' ? 'Suspended' : 'Active'}</span>
                  </span>
                </div>

                <div className="bg-white/5 rounded-xl p-2.5 border border-white/5 space-y-1.5 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 font-sans">Username:</span>
                    <span className="text-brand-400 font-semibold">{user.userId || '-'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 font-sans">Password:</span>
                    <span className="text-gray-200">{user.password || '-'}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-white/5">
                    <span className="text-gray-400 font-sans">Scope:</span>
                    <span className="text-amber-300 text-[11px]">
                      {user.isGlobalAdmin || user.allowedCompanies?.length === 4
                        ? 'All 4 Companies'
                        : user.allowedCompanies && user.allowedCompanies.length > 0
                        ? user.allowedCompanies.map((c) => c.toUpperCase()).join(', ')
                        : 'Single Company'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => handleEditUser(user)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Edit size={14} />
                    <span>Edit</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          renderSingleRowUsersTable(filteredOfficeUsers, 'user_row')
        ))}

      {/* ========================================================================= */}
      {/* 2. CLIENTS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'clients' &&
        (filteredClients.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center border border-white/10 text-gray-400 space-y-2">
            <Building size={32} className="mx-auto text-gray-500 mb-2" />
            <p className="text-sm font-semibold text-white">No registered clients found</p>
            <p className="text-xs text-gray-500">
              Click &quot;Register New Client&quot; to onboard a client company with automatic tariffs.
            </p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredClients.map((client, idx) => (
              <div
                key={`clt_card_${client.id || client.name || idx}_${idx}`}
                className="glass-card rounded-2xl p-4 border border-white/10 hover:border-emerald-500/30 transition-all shadow-lg space-y-3 relative overflow-hidden group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-sm font-bold text-emerald-400 shrink-0">
                      <Building size={18} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-sm truncate">{client.name}</h4>
                      <p className="text-xs text-gray-400 truncate">
                        {client.ownerName || client.contact || 'Owner N/A'}
                      </p>
                    </div>
                  </div>
                  {(client as any).status === 'PENDING_APPROVAL' ? (
                    <span className="text-[11px] text-amber-300 font-semibold flex items-center gap-1 shrink-0">
                      <Clock size={12} /> Pending
                    </span>
                  ) : (
                    <span className="text-[11px] text-emerald-300 font-medium shrink-0">
                      {client.defaultCaseCategory || 'Bonded Carrier'}
                    </span>
                  )}
                </div>

                <div className="bg-white/5 rounded-xl p-2.5 border border-white/5 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Username:</span>
                    <span className="text-brand-400 font-mono font-semibold">{client.userId || '-'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Password:</span>
                    <span className="text-gray-200 font-mono">{client.password || '-'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Phone:</span>
                    <a
                      href={`tel:${client.mobileNumber || client.phone}`}
                      className="text-white font-mono font-medium hover:text-brand-300"
                    >
                      {client.mobileNumber || client.phone || client.contact || 'N/A'}
                    </a>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                  {(client as any).status === 'PENDING_APPROVAL' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await updateClientInFirestore({
                          id: client.id,
                          loginEnabled: true,
                          status: 'ACTIVE' as any
                        });
                        setClientsList((prev) =>
                          prev.map((c) =>
                            c.id === client.id ? { ...c, loginEnabled: true, status: 'ACTIVE' as any } : c
                          )
                        );
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                    >
                      <Check size={14} /> Approve
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setClientToEdit(client);
                      setShowClientModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Edit size={14} /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteTarget({ type: 'CLIENT', id: client.id || client.name, name: client.name })
                    }
                    className="text-gray-400 hover:text-red-400 p-2 rounded-xl bg-white/5 hover:bg-red-500/10 transition-colors cursor-pointer"
                    title="Delete Client"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card rounded-2xl overflow-hidden border border-white/10 shadow-xl">
            <div
              className="overflow-x-auto custom-scrollbar custom-scrollbar-x"
              style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
            >
              <table className="w-full text-left text-xs sm:text-sm text-gray-200 min-w-[820px]">
                <thead className="bg-white/5 text-xs font-semibold text-gray-400 border-b border-white/10">
                  <tr>
                    <th className="py-3 px-3.5 whitespace-nowrap w-14">S.No</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Client Company</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Category</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Username</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Password</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Status</th>
                    <th className="py-3 px-3.5 whitespace-nowrap text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredClients.map((client, idx) => {
                    const isPending = (client as any).status === 'PENDING_APPROVAL';
                    return (
                      <tr
                        key={`clt_row_${client.id || client.name || idx}_${idx}`}
                        className="hover:bg-white/5 transition-colors h-11"
                      >
                        <td className="py-2.5 px-3.5 font-mono tabular-nums text-gray-400 whitespace-nowrap">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3.5 font-semibold text-white whitespace-nowrap max-w-[240px] truncate">
                          {client.name}
                        </td>
                        <td className="py-2.5 px-3.5 text-gray-300 whitespace-nowrap">
                          {client.defaultCaseCategory || 'Bonded Carrier'}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono tabular-nums text-brand-400 font-medium whitespace-nowrap">
                          {client.userId || '-'}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono tabular-nums text-gray-200 whitespace-nowrap">
                          {client.password || '-'}
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <span
                            className={`text-xs font-semibold ${
                              isPending ? 'text-amber-400' : 'text-emerald-400'
                            }`}
                          >
                            {isPending ? 'Pending Approval' : 'Active'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {isPending && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await updateClientInFirestore({
                                    id: client.id,
                                    loginEnabled: true,
                                    status: 'ACTIVE' as any
                                  });
                                  setClientsList((prev) =>
                                    prev.map((c) =>
                                      c.id === client.id
                                        ? { ...c, loginEnabled: true, status: 'ACTIVE' as any }
                                        : c
                                    )
                                  );
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                              >
                                <Check size={13} /> Approve
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setClientToEdit(client);
                                setShowClientModal(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Edit size={13} /> Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {/* ========================================================================= */}
      {/* 3. TRANSPORTERS / BROKERS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'transporters' &&
        (filteredTransporters.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center border border-white/10 text-gray-400 space-y-2">
            <Truck size={32} className="mx-auto text-gray-500 mb-2" />
            <p className="text-sm font-semibold text-white">No transporters / brokers found</p>
            <p className="text-xs text-gray-500">
              Click &quot;Add Transporter / Broker&quot; to onboard transport fleet partners.
            </p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredTransporters.map((trans, idx) => (
              <div
                key={`trans_card_${trans.id || idx}_${idx}`}
                className="glass-card rounded-2xl p-4 border border-white/10 hover:border-amber-500/30 transition-all shadow-lg space-y-3 relative overflow-hidden group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-sm font-bold text-amber-400 shrink-0">
                      <Truck size={18} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-sm truncate">{trans.name}</h4>
                      <p className="text-xs text-gray-400 font-mono truncate">
                        {trans.userId || '-'} · Transporter
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-semibold flex items-center gap-1 shrink-0 ${
                      trans.status === 'SUSPENDED' ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {trans.status === 'SUSPENDED' && <Lock size={11} />}
                    <span>{trans.status === 'SUSPENDED' ? 'Suspended' : 'Active'}</span>
                  </span>
                </div>

                <div className="bg-white/5 rounded-xl p-2.5 border border-white/5 space-y-1 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 font-sans">Username:</span>
                    <span className="text-amber-300 font-semibold">{trans.userId || '-'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 font-sans">Password:</span>
                    <span className="text-gray-200">{trans.password || '-'}</span>
                  </div>
                  {trans.contact && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 font-sans">Contact:</span>
                      <a href={`tel:${trans.contact}`} className="text-white hover:text-amber-300">
                        {trans.contact}
                      </a>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => handleEditUser(trans)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Edit size={14} />
                    <span>Edit</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          renderSingleRowUsersTable(filteredTransporters, 'trans_row')
        ))}

      {/* ========================================================================= */}
      {/* 4. DESTINATIONS STAFF TAB */}
      {/* ========================================================================= */}
      {activeTab === 'destinations' && (
        <div className="space-y-4">
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/5 self-start w-fit">
            <button
              type="button"
              onClick={() => setDestSubTab('agents')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                destSubTab === 'agents'
                  ? 'bg-amber-600 text-white shadow-md font-bold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <MapPin size={14} />
              <span>Field Representatives ({filteredDestinationStaff.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setDestSubTab('users')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                destSubTab === 'users'
                  ? 'bg-amber-600 text-white shadow-md font-bold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Users size={14} />
              <span>Staff Login Accounts ({filteredDestinationUsers.length})</span>
            </button>
          </div>

          {destSubTab === 'agents' ? (
            filteredDestinationStaff.length === 0 ? (
              <div className="glass-card rounded-2xl p-8 text-center border border-white/10 text-gray-400 space-y-2">
                <MapPin size={32} className="mx-auto text-amber-500 mb-2" />
                <p className="text-sm font-semibold text-white">
                  No destination staff representatives registered
                </p>
                <p className="text-xs text-gray-500">
                  Destination representatives are automatically added as Vendors in Finance Management.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDestinationStaffToEdit(null);
                    setShowDestinationModal(true);
                  }}
                  className="mt-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold px-4 py-2 rounded-xl inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus size={14} /> Add First Destination Representative
                </button>
              </div>
            ) : viewMode === 'cards' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredDestinationStaff.map((staff, idx) => (
                  <div
                    key={`dst_card_${staff.id || idx}_${idx}`}
                    className="glass-card rounded-2xl p-4 border border-white/10 hover:border-amber-500/30 transition-all shadow-lg space-y-3 relative overflow-hidden group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-sm font-bold text-amber-400 shrink-0">
                          <MapPin size={18} />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-white text-sm truncate">{staff.name}</h4>
                          <p className="text-xs text-amber-300 truncate">{staff.role}</p>
                        </div>
                      </div>
                      <span
                        className={`text-xs font-semibold ${
                          staff.status === 'ACTIVE' ? 'text-emerald-400' : 'text-gray-400'
                        }`}
                      >
                        {staff.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">Station:</span>
                        <span className="text-white font-semibold flex items-center gap-1">
                          <MapPinned size={12} className="text-amber-400" /> {staff.station}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">Username:</span>
                        <span className="text-brand-400 font-mono font-semibold">
                          {staff.userId || '-'}
                        </span>
                      </div>
                      {staff.phone && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400">Phone:</span>
                          <a href={`tel:${staff.phone}`} className="text-white font-mono">
                            {staff.phone}
                          </a>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-white/5">
                      <button
                        type="button"
                        onClick={() => {
                          setDestinationStaffToEdit(staff);
                          setShowDestinationModal(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Edit size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({ type: 'DESTINATION', id: staff.id, name: staff.name })
                        }
                        className="text-gray-400 hover:text-red-400 p-1.5 rounded-xl bg-white/5 hover:bg-red-500/10 transition-colors cursor-pointer"
                        title="Delete Representative"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-card rounded-2xl overflow-hidden border border-white/10 shadow-xl">
                <div
                  className="overflow-x-auto custom-scrollbar custom-scrollbar-x"
                  style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
                >
                  <table className="w-full text-left text-xs sm:text-sm text-gray-200 min-w-[780px]">
                    <thead className="bg-white/5 text-xs font-semibold text-gray-400 border-b border-white/10">
                      <tr>
                        <th className="py-3 px-3.5 whitespace-nowrap w-14">S.No</th>
                        <th className="py-3 px-3.5 whitespace-nowrap">Name</th>
                        <th className="py-3 px-3.5 whitespace-nowrap">Station</th>
                        <th className="py-3 px-3.5 whitespace-nowrap">Username</th>
                        <th className="py-3 px-3.5 whitespace-nowrap">Password</th>
                        <th className="py-3 px-3.5 whitespace-nowrap">Status</th>
                        <th className="py-3 px-3.5 whitespace-nowrap text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredDestinationStaff.map((staff, idx) => (
                        <tr
                          key={`dst_row_${staff.id || idx}_${idx}`}
                          className="hover:bg-white/5 transition-colors h-11"
                        >
                          <td className="py-2.5 px-3.5 font-mono tabular-nums text-gray-400 whitespace-nowrap">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-3.5 font-semibold text-white whitespace-nowrap">
                            {staff.name}
                          </td>
                          <td className="py-2.5 px-3.5 text-gray-300 whitespace-nowrap">
                            {staff.station}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono tabular-nums text-brand-400 font-medium whitespace-nowrap">
                            {staff.userId || '-'}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono tabular-nums text-gray-200 whitespace-nowrap">
                            {staff.password || '-'}
                          </td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <span
                              className={`text-xs font-semibold ${
                                staff.status === 'ACTIVE' ? 'text-emerald-400' : 'text-gray-400'
                              }`}
                            >
                              {staff.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                setDestinationStaffToEdit(staff);
                                setShowDestinationModal(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Edit size={13} /> Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          ) : filteredDestinationUsers.length === 0 ? (
            <div className="glass-card rounded-2xl p-8 text-center border border-white/10 text-gray-400 space-y-2">
              <Users size={32} className="mx-auto text-amber-500 mb-2" />
              <p className="text-sm font-semibold text-white">
                No destination staff login accounts registered
              </p>
              <button
                type="button"
                onClick={() => handleSelectRoleType('STAFF', [UserRole.DESTINATION_PORT_STAFF])}
                className="mt-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold px-4 py-2 rounded-xl inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus size={14} /> Create First Destination Staff User ID
              </button>
            </div>
          ) : viewMode === 'cards' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredDestinationUsers.map((user, idx) => (
                <div
                  key={`dusr_card_${user.id || idx}_${idx}`}
                  className="glass-card rounded-2xl p-4 border border-white/10 hover:border-amber-500/30 transition-all shadow-lg space-y-3 relative overflow-hidden group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-sm truncate">{user.name}</h4>
                      <p className="text-xs text-amber-300 truncate mt-0.5">
                        {formatUserSingleLineRole(user)}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        user.status === 'SUSPENDED' ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {user.status === 'SUSPENDED' ? 'Suspended' : 'Active'}
                    </span>
                  </div>

                  <div className="bg-white/5 rounded-xl p-2.5 border border-white/5 space-y-1 text-xs font-mono">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 font-sans">Username:</span>
                      <span className="text-brand-400 font-semibold">{user.userId || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 font-sans">Password:</span>
                      <span className="text-gray-200">{user.password || '-'}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end pt-2 border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => handleEditUser(user)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Edit size={14} /> Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            renderSingleRowUsersTable(filteredDestinationUsers, 'dusr_row')
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONBOARDING ROLE SELECTOR MODAL */}
      {/* ========================================================================= */}
      {showRoleSelectorModal &&
        createPortal(
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[9999] p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
            <div className="glass-card p-6 sm:p-8 rounded-3xl w-full max-w-xl border border-white/15 shadow-2xl space-y-5 bg-slate-900 my-auto">
              <div className="flex justify-between items-center border-b border-white/10 pb-3">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-brand-400 font-bold">
                    Directory Setup
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-white mt-0.5">
                    Select User Category to Add
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRoleSelectorModal(false)}
                  className="text-gray-400 hover:text-white p-1 rounded-full bg-white/5"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
                <button
                  type="button"
                  onClick={() => handleSelectRoleType('STAFF')}
                  className="group p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-brand-500/50 hover:bg-brand-500/10 transition-all text-left flex flex-col justify-between shadow-lg cursor-pointer"
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center">
                      <Briefcase size={20} />
                    </div>
                    <h4 className="text-sm font-bold text-white">System User / Manager ID</h4>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Admin, Operations, Case, Finance &amp; Documentation Managers.
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-xs text-brand-300 font-semibold">
                    <span>Create User ID</span>
                    <ChevronRight size={14} />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectRoleType('TRANSPORTER')}
                  className="group p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 hover:border-amber-500/50 hover:bg-amber-500/15 transition-all text-left flex flex-col justify-between shadow-lg cursor-pointer"
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                      <Truck size={20} />
                    </div>
                    <h4 className="text-sm font-bold text-white">Transporter / Broker</h4>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Fleet Partners, Goods Transport Agencies &amp; Transit Brokers.
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-xs text-amber-300 font-semibold">
                    <span>Add Transporter / Broker</span>
                    <ChevronRight size={14} />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectRoleType('STAFF', [UserRole.LOADING_PORT_STAFF])}
                  className="group p-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/20 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-all text-left flex flex-col justify-between shadow-lg cursor-pointer"
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                      <MapPinned size={20} />
                    </div>
                    <h4 className="text-sm font-bold text-white">Port &amp; Terminal Staff</h4>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Loading Port Staff, Destination Staff &amp; Unloading Staff.
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-xs text-cyan-300 font-semibold">
                    <span>Setup Port Staff User</span>
                    <ChevronRight size={14} />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowRoleSelectorModal(false);
                    setClientToEdit(null);
                    setShowClientModal(true);
                  }}
                  className="group p-4 rounded-2xl bg-purple-500/5 border border-purple-500/20 hover:border-purple-500/50 hover:bg-purple-500/15 transition-all text-left flex flex-col justify-between shadow-lg cursor-pointer"
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                      <Building size={20} />
                    </div>
                    <h4 className="text-sm font-bold text-white">Corporate Client / Importer</h4>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Consignees, Importers &amp; Shipping Lines with dedicated portal credentials.
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-xs text-purple-300 font-semibold">
                    <span>Register Client / Importer</span>
                    <ChevronRight size={14} />
                  </div>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* STREAMLINED USER ID & TRANSPORTER FORM MODAL */}
      {/* ========================================================================= */}
      {showModal &&
        createPortal(
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[9999] p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
            <div className="glass-card rounded-3xl w-full max-w-3xl border border-white/15 shadow-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] my-auto flex flex-col bg-slate-900 overflow-hidden">
              <div className="flex justify-between items-center p-4 sm:p-5 border-b border-white/10 bg-slate-900/95 shrink-0 sticky top-0 z-10">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-brand-400 font-bold">
                    {selectedOnboardingRole === 'TRANSPORTER'
                      ? 'Transporter / Broker Portal ID'
                      : 'System User Portal ID'}
                  </span>
                  <h3 className="text-base sm:text-lg font-bold text-white">
                    {isEditing ? 'Edit User Account' : 'Create New'}{' '}
                    {selectedOnboardingRole === 'TRANSPORTER' ? 'Transporter / Broker' : 'User ID'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-gray-300 hover:text-white p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors cursor-pointer shrink-0"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Scrollable Form Body */}
              <div className="p-4 sm:p-6 overflow-y-auto custom-scrollbar flex-1 min-h-0 space-y-4 overscroll-contain">
                {formError && (
                  <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                    <AlertTriangle size={15} className="shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {modalActionFeedback && (
                  <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle size={15} className="shrink-0" />
                      <span>{modalActionFeedback}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setModalActionFeedback(null)}
                      className="text-gray-400 hover:text-white p-0.5"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}

                {/* Edit Account Actions (Suspend / Delete ID) */}
                {isEditing &&
                  editingId &&
                  (() => {
                    const currentEditedUser =
                      users.find((u) => String(u.id) === String(editingId)) ||
                      ({
                        id: Number(editingId),
                        name: formData.name,
                        userId: formData.generatedId,
                        password: formData.generatedPass,
                        role: (formData.role || UserRole.OPERATIONS_MANAGER) as UserRole,
                        roles: formData.roles,
                        status: formData.status
                      } as AppUser);

                    const isProtectedRoot =
                      Number(editingId) === 1 ||
                      (formData.generatedId || '').toLowerCase() === 'arbabkhanboby';
                    const isCurrentlySuspended = formData.status === 'SUSPENDED';

                    return (
                      <div className="p-3.5 sm:p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-white block">
                            Account Status &amp; ID Controls
                          </span>
                          <span className="text-[11px] text-gray-400 block mt-0.5">
                            Username:{' '}
                            <strong className="font-mono text-brand-400">
                              {formData.generatedId || '-'}
                            </strong>{' '}
                            · Status:{' '}
                            <strong
                              className={
                                isCurrentlySuspended ? 'text-amber-400' : 'text-emerald-400'
                              }
                            >
                              {isCurrentlySuspended ? 'Suspended' : 'Active'}
                            </strong>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={handleQuickSuspendToggleInModal}
                            className={`px-3 py-1.5 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${
                              isCurrentlySuspended
                                ? 'bg-green-600 hover:bg-green-500'
                                : 'bg-amber-600 hover:bg-amber-500'
                            }`}
                          >
                            {isCurrentlySuspended ? <Unlock size={14} /> : <Lock size={14} />}
                            <span>{isCurrentlySuspended ? 'Reactivate ID' : 'Suspend ID'}</span>
                          </button>

                          {!isProtectedRoot && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  type: 'USER',
                                  id: currentEditedUser.id,
                                  name: formData.name || currentEditedUser.name,
                                  docId: (currentEditedUser as any)._docId,
                                  userLoginId: formData.generatedId || currentEditedUser.userId
                                })
                              }
                              className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer"
                            >
                              <Trash2 size={14} />
                              <span>Delete ID</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                {/* Form Body */}
                {selectedOnboardingRole === 'STAFF' ? (
                  <div className="space-y-4 text-xs">
                    {/* Full Name Only (Father Name, Designation, Primary Phone, Address, Salary, Per-Container Charges & Document Checklist Removed) */}
                    <div>
                      <label className="text-gray-200 font-semibold block mb-1.5">
                        Full Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Muhammad Ali"
                        value={formData.name}
                        onChange={(e) => handleFullNameInputChange(e.target.value)}
                        className="w-full bg-black/40 border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
                        autoFocus={!isEditing}
                      />
                    </div>

                    {/* System Role Selection Table */}
                    <AdminRolesAndPrivilegesTable
                      assignedRoles={formData.roles}
                      userName={formData.name || 'this user'}
                      allowedCompanies={formData.allowedCompanies}
                      isGlobalAdmin={formData.isGlobalAdmin}
                      onRolesChange={(newRoles, primaryRole) => {
                        setFormData((prev) => ({
                          ...prev,
                          roles: newRoles,
                          role: primaryRole,
                          isGlobalAdmin: newRoles.includes(UserRole.ADMIN)
                            ? prev.isGlobalAdmin
                            : false
                        }));
                      }}
                    />

                    {/* Admin Level Selection (Only when Admin role is active) */}
                    {formData.roles.includes(UserRole.ADMIN) && (
                      <div className="p-3 rounded-xl bg-purple-950/40 border border-purple-500/40 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-purple-200 flex items-center gap-1.5">
                            <Crown size={14} className="text-purple-400" />
                            Admin Authority Level *
                          </label>
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-lg bg-purple-500/20 text-purple-300">
                            {formData.isGlobalAdmin ? 'Group Super Admin' : 'Company Admin'}
                          </span>
                        </div>

                        {!isCurrentUserGlobalAdmin ? (
                          <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px]">
                            Company Admin for <strong>{activeCompany.name}</strong>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setFormData((prev) => ({
                                  ...prev,
                                  isGlobalAdmin: true,
                                  allCompaniesAccess: true,
                                  allowedCompanies: ['docks', 'truckit', 'muhib', 'vantage']
                                }));
                              }}
                              className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 cursor-pointer ${
                                formData.isGlobalAdmin
                                  ? 'bg-purple-600/30 border-purple-400 text-white shadow-sm'
                                  : 'bg-black/40 border-white/10 text-gray-400 hover:text-white'
                              }`}
                            >
                              <div
                                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                                  formData.isGlobalAdmin
                                    ? 'bg-purple-500 border-purple-300 text-white'
                                    : 'border-white/25 bg-black/40'
                                }`}
                              >
                                {formData.isGlobalAdmin && <Check size={11} strokeWidth={3} />}
                              </div>
                              <div>
                                <span className="text-xs font-bold block text-purple-200">
                                  Main Group Admin (All 4 Companies)
                                </span>
                                <span className="text-[10px] text-gray-300 block">
                                  Full access across all 4 group companies
                                </span>
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setFormData((prev) => ({
                                  ...prev,
                                  isGlobalAdmin: false,
                                  allCompaniesAccess: false,
                                  allowedCompanies:
                                    prev.allowedCompanies.length > 0
                                      ? prev.allowedCompanies
                                      : [activeCompany?.id || 'docks']
                                }));
                              }}
                              className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 cursor-pointer ${
                                !formData.isGlobalAdmin
                                  ? 'bg-amber-600/30 border-amber-400 text-white shadow-sm'
                                  : 'bg-black/40 border-white/10 text-gray-400 hover:text-white'
                              }`}
                            >
                              <div
                                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                                  !formData.isGlobalAdmin
                                    ? 'bg-amber-500 border-amber-300 text-slate-950'
                                    : 'border-white/25 bg-black/40'
                                }`}
                              >
                                {!formData.isGlobalAdmin && <Check size={11} strokeWidth={3} />}
                              </div>
                              <div>
                                <span className="text-xs font-bold block text-amber-200">
                                  Company Admin ({activeCompany.name} Only)
                                </span>
                                <span className="text-[10px] text-gray-300 block">
                                  Strictly for selected company scope
                                </span>
                              </div>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Company Access Scope (Tick 1 or All 4 Companies) */}
                    <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-white/15 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                        <div className="flex items-center gap-2">
                          <Building size={15} className="text-amber-400 shrink-0" />
                          <div>
                            <label className="text-xs font-bold text-white block leading-tight">
                              Company Access Scope (Tick 1 or All 4 Companies)
                            </label>
                            <p className="text-[10px] text-gray-400">
                              {!isCurrentUserGlobalAdmin
                                ? `Active for ${activeCompany.name}`
                                : 'Tick any single company or all 4 companies for this User ID'}
                            </p>
                          </div>
                        </div>

                        {isCurrentUserGlobalAdmin && (
                          <div className="flex items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => {
                                setFormData((prev) => ({
                                  ...prev,
                                  allCompaniesAccess: true,
                                  allowedCompanies: ['docks', 'truckit', 'muhib', 'vantage']
                                }));
                              }}
                              className="font-semibold text-amber-400 hover:text-amber-300 underline cursor-pointer"
                            >
                              Select All 4
                            </button>
                            <span className="text-gray-600">·</span>
                            <button
                              type="button"
                              onClick={() => {
                                setFormData((prev) => ({
                                  ...prev,
                                  allCompaniesAccess: false,
                                  allowedCompanies: [activeCompany?.id || 'docks']
                                }));
                              }}
                              className="font-semibold text-gray-400 hover:text-white underline cursor-pointer"
                            >
                              Current Only
                            </button>
                          </div>
                        )}
                      </div>

                      {!isCurrentUserGlobalAdmin ? (
                        <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between">
                          <span className="text-xs font-bold text-white">
                            {activeCompany.legalTitle || activeCompany.name}
                          </span>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                            Active Scope
                          </span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { id: 'docks', name: 'Docks (Pvt.) Ltd.', sub: 'Port Logistics' },
                            { id: 'truckit', name: 'Truckit (Pvt.) Ltd.', sub: 'Fleet Haulage' },
                            { id: 'muhib', name: 'Muhib International', sub: 'Transit Trade' },
                            { id: 'vantage', name: 'Vantage Shipping', sub: 'Marine Ops' }
                          ].map((comp) => {
                            const isChecked =
                              formData.allCompaniesAccess ||
                              formData.allowedCompanies.includes(comp.id);
                            return (
                              <button
                                key={comp.id}
                                type="button"
                                onClick={() => {
                                  setFormData((prev) => {
                                    const currentList = prev.allCompaniesAccess
                                      ? ['docks', 'truckit', 'muhib', 'vantage']
                                      : [...prev.allowedCompanies];
                                    let nextList: string[];
                                    if (currentList.includes(comp.id)) {
                                      nextList = currentList.filter((c) => c !== comp.id);
                                      if (nextList.length === 0) nextList = [comp.id];
                                    } else {
                                      nextList = [...currentList, comp.id];
                                    }
                                    return {
                                      ...prev,
                                      allCompaniesAccess: nextList.length === 4,
                                      allowedCompanies: nextList
                                    };
                                  });
                                }}
                                className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left transition-all cursor-pointer select-none ${
                                  isChecked
                                    ? 'bg-amber-500/20 border-amber-400 text-white'
                                    : 'bg-white/[0.03] border-white/10 text-gray-400 hover:bg-white/[0.07] hover:text-white'
                                }`}
                              >
                                <div
                                  className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                                    isChecked
                                      ? 'bg-amber-500 border-amber-300 text-slate-950'
                                      : 'bg-black/40 border-white/25'
                                  }`}
                                >
                                  {isChecked && <Check size={11} strokeWidth={3} />}
                                </div>
                                <div className="min-w-0">
                                  <span className="text-[11px] font-bold block truncate leading-tight">
                                    {comp.name}
                                  </span>
                                  <span className="text-[9px] text-gray-400 block truncate">
                                    {comp.sub}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* User ID & Password Assignment */}
                    <div className="bg-white/5 p-3.5 rounded-2xl border border-white/10 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                          <Key size={14} className="text-brand-400" />
                          Login Credentials (Auto-Generated · Admin Editable)
                        </h4>
                        <div className="flex items-center gap-3 text-[11px] font-mono">
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomUserIdEdited(false);
                              const existingUser =
                                isEditing && editingId
                                  ? users.find((u) => String(u.id) === String(editingId))
                                  : undefined;
                              setFormData((prev) => ({
                                ...prev,
                                generatedId: generateUniqueUsernameFromFullName(
                                  prev.name,
                                  users,
                                  isEditing && editingId
                                    ? { id: editingId, currentUserId: existingUser?.userId }
                                    : undefined
                                )
                              }));
                            }}
                            className="text-brand-400 hover:text-brand-300 underline cursor-pointer"
                          >
                            Auto ID from Full Name
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                generatedPass: DEFAULT_USER_PASSWORD
                              }))
                            }
                            className="text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                          >
                            Default ({DEFAULT_USER_PASSWORD})
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                        <div>
                          <label className="text-gray-400 text-[10px] block mb-1">
                            User ID (FullName without spaces, +01/02 if duplicate):
                          </label>
                          <input
                            type="text"
                            value={formData.generatedId}
                            placeholder="Auto-generated from Full Name"
                            onChange={(e) => {
                              setIsCustomUserIdEdited(true);
                              setFormData({ ...formData, generatedId: e.target.value });
                            }}
                            className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-brand-400 text-xs font-bold outline-none focus:border-brand-500"
                          />
                        </div>
                        <div>
                          <label className="text-gray-400 text-[10px] block mb-1">
                            Password (Default {DEFAULT_USER_PASSWORD}):
                          </label>
                          <input
                            type="text"
                            value={formData.generatedPass}
                            onChange={(e) =>
                              setFormData({ ...formData, generatedPass: e.target.value })
                            }
                            className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-white text-xs font-bold outline-none focus:border-brand-500"
                          />
                        </div>
                      </div>

                      {/* Account Login Status */}
                      <div className="pt-2.5 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <span className="text-gray-300 text-xs font-semibold block">
                            Account Login Status
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {formData.status === 'SUSPENDED'
                              ? 'Suspended: Portal login is blocked.'
                              : 'Active: User can sign in with User ID and Password.'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setFormData((prev) => ({ ...prev, status: 'ACTIVE' }))}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                              formData.status !== 'SUSPENDED'
                                ? 'bg-green-500/20 text-green-300 border border-green-500/40 shadow-sm'
                                : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                            }`}
                          >
                            <Check size={12} /> Active
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFormData((prev) => ({ ...prev, status: 'SUSPENDED' }))
                            }
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                              formData.status === 'SUSPENDED'
                                ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-sm'
                                : 'bg-white/5 text-gray-400 hover:text-amber-300 border border-white/10'
                            }`}
                          >
                            <Lock size={12} /> Suspend
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Transporter / Broker Form */
                  <div className="space-y-4 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div className="sm:col-span-2">
                        <label className="text-gray-200 font-semibold block mb-1">
                          Full Name / Transporter Entity Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Swift Goods Transport"
                          value={formData.name}
                          onChange={(e) => handleFullNameInputChange(e.target.value)}
                          className="w-full bg-black/40 border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
                        />
                      </div>
                      <div>
                        <label className="text-gray-300 font-medium block mb-1">
                          Representative Name
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Haji Nisar Ahmed"
                          value={formData.representativeName}
                          onChange={(e) =>
                            setFormData({ ...formData, representativeName: e.target.value })
                          }
                          className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-white outline-none focus:border-brand-500"
                        />
                      </div>
                      <div>
                        <label className="text-gray-300 font-medium block mb-1">
                          Mobile / WhatsApp Contact
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. 0300-9988776"
                          value={formData.contact}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              contact: e.target.value,
                              whatsappNumber: e.target.value
                            })
                          }
                          className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-white outline-none focus:border-brand-500"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-gray-300 font-medium block mb-1">
                          Transit Routes &amp; Operations
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Karachi Port to Lahore NLC, Karachi to Peshawar / Torkham"
                          value={formData.preferredRoutes}
                          onChange={(e) =>
                            setFormData({ ...formData, preferredRoutes: e.target.value })
                          }
                          className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-white outline-none focus:border-brand-500"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <AdminRolesAndPrivilegesTable
                          assignedRoles={formData.roles}
                          userName={formData.name || 'this transporter'}
                          allowedCompanies={formData.allowedCompanies}
                          isGlobalAdmin={formData.isGlobalAdmin}
                          onRolesChange={(newRoles, primaryRole) => {
                            setFormData((prev) => ({
                              ...prev,
                              roles: newRoles,
                              role: primaryRole
                            }));
                          }}
                        />
                      </div>
                    </div>

                    {/* Transporter User ID & Password */}
                    <div className="bg-white/5 p-3.5 rounded-2xl border border-white/10 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                          <Key size={14} className="text-amber-400" />
                          Transporter Portal Login (Admin Editable)
                        </h4>
                        <div className="flex items-center gap-3 text-[11px] font-mono">
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomUserIdEdited(false);
                              setFormData((prev) => ({
                                ...prev,
                                generatedId: generateUniqueUsernameFromFullName(prev.name, users)
                              }));
                            }}
                            className="text-amber-400 hover:text-amber-300 underline cursor-pointer"
                          >
                            Auto ID from Name
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                generatedPass: DEFAULT_USER_PASSWORD
                              }))
                            }
                            className="text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                          >
                            Default ({DEFAULT_USER_PASSWORD})
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                        <div>
                          <span className="text-gray-400 text-[10px] block mb-1">User ID:</span>
                          <input
                            type="text"
                            value={formData.generatedId}
                            placeholder="Auto-generated from Name"
                            onChange={(e) => {
                              setIsCustomUserIdEdited(true);
                              setFormData({ ...formData, generatedId: e.target.value });
                            }}
                            className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-amber-400 text-xs font-bold outline-none focus:border-amber-400"
                          />
                        </div>
                        <div>
                          <span className="text-gray-400 text-[10px] block mb-1">Password:</span>
                          <input
                            type="text"
                            value={formData.generatedPass}
                            onChange={(e) =>
                              setFormData({ ...formData, generatedPass: e.target.value })
                            }
                            className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-white text-xs font-bold outline-none focus:border-amber-400"
                          />
                        </div>
                      </div>

                      <div className="pt-2.5 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="text-gray-300 text-xs font-semibold">
                          Portal Login Status
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setFormData((prev) => ({ ...prev, status: 'ACTIVE' }))}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                              formData.status !== 'SUSPENDED'
                                ? 'bg-green-500/20 text-green-300 border border-green-500/40 shadow-sm'
                                : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                            }`}
                          >
                            <Check size={12} /> Active
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFormData((prev) => ({ ...prev, status: 'SUSPENDED' }))
                            }
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                              formData.status === 'SUSPENDED'
                                ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-sm'
                                : 'bg-white/5 text-gray-400 hover:text-amber-300 border border-white/10'
                            }`}
                          >
                            <Lock size={12} /> Suspend
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sticky Actions Footer */}
              <div className="flex justify-end gap-3 p-3.5 sm:p-4 border-t border-white/10 bg-slate-900/95 backdrop-blur-md shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveUser}
                  className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl shadow-lg shadow-brand-600/30 flex items-center gap-2 text-xs font-semibold transition-all cursor-pointer"
                >
                  <Save size={15} /> {isEditing ? 'Update Account' : 'Save User ID'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ========================================================================= */}
      {/* CLIENT REGISTRATION & DEFAULT TARIFF SETUP MODAL */}
      {/* ========================================================================= */}
      <ClientRegistrationModal
        isOpen={showClientModal}
        onClose={() => {
          setShowClientModal(false);
          setClientToEdit(null);
        }}
        initialClient={clientToEdit || undefined}
        onSave={(savedClient) => {
          const normSaved = (savedClient.name || '')
            .trim()
            .toUpperCase()
            .replace(/[.,\-_/()]/g, ' ')
            .replace(/\s+/g, ' ');
          setClientsList((prev) => [
            savedClient,
            ...prev.filter((c) => {
              const normC = (c.name || '')
                .trim()
                .toUpperCase()
                .replace(/[.,\-_/()]/g, ' ')
                .replace(/\s+/g, ' ');
              return (
                (c.id || c.name) !== (savedClient.id || savedClient.name) && normC !== normSaved
              );
            })
          ]);
          setShowClientModal(false);
          setClientToEdit(null);
        }}
      />

      {/* ========================================================================= */}
      {/* DESTINATION STAFF MODAL */}
      {/* ========================================================================= */}
      <DestinationStaffModal
        isOpen={showDestinationModal}
        onClose={() => {
          setShowDestinationModal(false);
          setDestinationStaffToEdit(null);
        }}
        staffToEdit={destinationStaffToEdit}
        onSaved={(savedStaff, savedUser) => {
          if (savedStaff) {
            setDestinationStaffList((prev) => [
              savedStaff,
              ...prev.filter((d) => String(d.id) !== String(savedStaff.id))
            ]);
          }
          if (savedUser) {
            setUsers((prev) => [
              ...prev.filter(
                (u) =>
                  String(u.id) !== String(savedUser.id) &&
                  (u.userId || '').toLowerCase() !== (savedUser.userId || '').toLowerCase()
              ),
              savedUser
            ]);
          }
          setShowDestinationModal(false);
          setDestinationStaffToEdit(null);
        }}
      />

      {/* ========================================================================= */}
      {/* DELETE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {deleteTarget &&
        createPortal(
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[10030] p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
            <div className="glass-card p-6 rounded-2xl w-full max-w-sm border border-white/10 text-center space-y-4 bg-slate-900 shadow-2xl my-auto">
              <div className="bg-red-500/20 w-12 h-12 rounded-full flex items-center justify-center mx-auto border border-red-500/30">
                <AlertTriangle size={24} className="text-red-500" />
              </div>
              <h3 className="text-base font-bold text-white">Confirm Removal</h3>
              <p className="text-xs text-gray-400">
                Are you sure you want to remove{' '}
                <strong className="text-white">&quot;{deleteTarget.name}&quot;</strong>? This action
                cannot be undone.
              </p>
              <div className="flex gap-2.5 justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteTarget}
                  className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-red-600/30 cursor-pointer"
                >
                  Yes, Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default UserManagement;

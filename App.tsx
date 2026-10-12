
import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, FolderKanban, Users, Truck, Settings, FileText, Bell, LogOut, Menu,
  X, Check, AlertCircle, AlertTriangle, Info, Trash2, Loader2, Maximize2, Minimize2, Upload,
  ShieldCheck, UserCircle, RefreshCw, HardDrive, MapPin, FolderArchive, Building2, ChevronDown, Package, ShieldAlert,
  Sparkles, Crown
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import CaseManagement from './components/CaseManagement';
import CompanyDocuments from './components/CompanyDocuments';
import AppSettings from './components/AppSettings';
import Finance from './components/Finance';
import VehicleManagement from './components/VehicleManagement';
import UserManagement from './components/UserManagement';
import GoogleDriveManager from './components/GoogleDriveManager';
import SplashScreen from './components/SplashScreen';
import LoginModeSelection, { SelectedModePayload } from './components/LoginModeSelection';
import CompanyWorkspaceSelector from './components/CompanyWorkspaceSelector';
import GroupAdminPortal from './components/GroupAdminPortal';
import { useActiveCompany, setActiveCompany, isUploadedLogo, getCompanyUploadedLogo, getCompanyLogoUrl, CompanyId } from './services/companyService';
import GoldenAmountWidget from './components/GoldenAmountWidget';
import ClientPortal from './components/ClientPortal';
import { LoadingPortStaffPortal } from './components/LoadingPortStaffPortal';
import TransporterPortal from './components/TransporterPortal';
import VendorPortal from './components/VendorPortal';
import { AvailableVehiclesView } from './components/AvailableVehiclesView';
import { ModeOption } from './components/TopModeSwitcher';
import { AppNotification, UserRole } from './types';
import NotificationModal from './components/NotificationModal';
import AuthModal from './components/AuthModal';
import Logo from './components/Logo';
import { LiveNotificationCenter } from './components/LiveNotificationCenter';
import { auth, onAuthStateChanged, testFirestoreConnection } from './services/firebase';
import { subscribeToNotifications } from './services/dbService';
import { approveActionRequest, rejectActionRequest } from './services/approvalService';
import { safeSessionStorage, safeLocalStorage, safeAppStorage } from './services/storage';
import ErrorBoundary from './components/ErrorBoundary';
import { appLifecycle } from './services/lifecycle';
import { useBranding } from './services/brandingService';
import { VirtualizedList } from './components/VirtualizedList';
import PublicContainerTrackingPortal from './components/PublicContainerTrackingPortal';
import PublicVehicleTrackingPortal from './components/PublicVehicleTrackingPortal';
import { initAuditSchedulerService } from './services/auditSchedulerService';

const isVehicleTrackingDomainOrRoute = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const host = (window.location.hostname || '').toLowerCase();
    const fullHost = (window.location.host || '').toLowerCase();
    const href = (window.location.href || '').toLowerCase();
    const path = (window.location.pathname || '').toLowerCase();
    const hash = (window.location.hash || '').toLowerCase();
    const search = window.location.search || '';
    const params = new URLSearchParams(search);

    // 1. Direct query parameters (works on ANY domain including status.makpk.online)
    if (
      params.get('mode') === 'vehicle' ||
      params.get('mode') === 'fleet' ||
      params.get('portal') === 'vehicle' ||
      params.get('portal') === 'fleet' ||
      params.get('view') === 'vehicle' ||
      params.get('vehicle') === '1' ||
      params.get('vehicle') === 'true' ||
      params.has('plate') ||
      params.has('reg')
    ) {
      return true;
    }

    // 2. Hash routing (e.g. #vehicle, #/vehicle, #fleet)
    if (hash.includes('vehicle') || hash.includes('fleet')) {
      return true;
    }

    // 3. Path routing (e.g. /vehicle, /fleet)
    if (path.startsWith('/vehicle') || path.startsWith('/vehicles') || path.startsWith('/fleet-status') || path.startsWith('/fleet')) {
      return true;
    }

    // 4. Subdomains dedicated to vehicle tracking
    if (
      host.includes('vehicle.makpk.online') ||
      host.includes('vehicles.makpk.online') ||
      host.includes('vehicle.mak-group.com') ||
      host.includes('vehicles.mak-group.com') ||
      host.includes('vehicle.mak-group.com.pk') ||
      host.includes('fleet.mak-group.com') ||
      host.startsWith('vehicle.') ||
      host.startsWith('vehicles.') ||
      host.startsWith('fleet.') ||
      fullHost.includes('vehicle.makpk.online') ||
      href.includes('vehicle.makpk.online')
    ) {
      return true;
    }
  } catch (_) {}
  return false;
};

const isContainerTrackingDomainOrRoute = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    if (isVehicleTrackingDomainOrRoute()) return false;
    const host = (window.location.hostname || '').toLowerCase();
    const fullHost = (window.location.host || '').toLowerCase();
    const href = (window.location.href || '').toLowerCase();
    const path = (window.location.pathname || '').toLowerCase();
    const hash = (window.location.hash || '').toLowerCase();
    const search = window.location.search || '';
    const params = new URLSearchParams(search);

    // 1. Direct query parameters
    if (
      params.get('mode') === 'status' ||
      params.get('mode') === 'sttatus' ||
      params.get('mode') === 'container' ||
      params.get('mode') === 'tracking' ||
      params.get('status') === '1' ||
      params.get('status') === 'true' ||
      params.get('portal') === 'status' ||
      params.get('portal') === 'sttatus' ||
      params.get('portal') === 'container' ||
      params.get('view') === 'status' ||
      params.has('container') ||
      params.has('bl') ||
      params.has('caseno') ||
      params.has('case')
    ) {
      return true;
    }

    // 2. Hash routing (e.g. #status, #container)
    if (hash.includes('status') || hash.includes('container') || hash.includes('tracking')) {
      return true;
    }

    // 3. Path routing
    if (path.startsWith('/status') || path.startsWith('/sttatus') || path.startsWith('/container') || path.startsWith('/tracking') || path.startsWith('/track')) {
      return true;
    }

    // 4. Subdomains dedicated to container tracking
    if (
      host.includes('status.makpk.online') ||
      host.includes('sttatus.makpk.online') ||
      host.includes('status.mak-group.com.pk') ||
      host.includes('status.mak-group.com') ||
      host.includes('container.mak-group.com') ||
      host.includes('tracking.mak-group.com') ||
      host.startsWith('status.') ||
      host.startsWith('sttatus.') ||
      host.startsWith('container.') ||
      host.startsWith('track.') ||
      host.startsWith('tracking.') ||
      fullHost.includes('status.makpk.online') ||
      href.includes('status.makpk.online')
    ) {
      return true;
    }
  } catch (_) {}
  return false;
};

const App: React.FC = () => {
  // Public Standalone Tracking Portals (No login required for general public):
  // Vehicle Portal: ?mode=vehicle or vehicle.makpk.online
  // Container Portal: ?mode=status or status.makpk.online
  const [isPublicVehicleTrackingOpen, setIsPublicVehicleTrackingOpen] = useState<boolean>(() => isVehicleTrackingDomainOrRoute());
  const [isPublicContainerTrackingOpen, setIsPublicContainerTrackingOpen] = useState<boolean>(() => {
    if (isVehicleTrackingDomainOrRoute()) return false;
    return isContainerTrackingDomainOrRoute();
  });
  const [selectedPublicVehiclePlate, setSelectedPublicVehiclePlate] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('plate') || params.get('reg') || (params.get('vehicle') !== '1' ? (params.get('vehicle') || '') : '') || '';
    } catch (_) {
      return '';
    }
  });
  const [openedFromInternalWorkspace, setOpenedFromInternalWorkspace] = useState<boolean>(false);

  const isDedicatedContainerSubdomain = typeof window !== 'undefined' && (
    window.location.hostname.toLowerCase().includes('status.makpk.online') ||
    window.location.hostname.toLowerCase().includes('sttatus.makpk.online') ||
    window.location.hostname.toLowerCase().includes('status.mak-group.com.pk') ||
    window.location.hostname.toLowerCase().includes('status.mak-group.com') ||
    window.location.hostname.toLowerCase().startsWith('status.')
  );
  const isDedicatedVehicleSubdomain = typeof window !== 'undefined' && (
    window.location.hostname.toLowerCase().includes('vehicle.makpk.online') ||
    window.location.hostname.toLowerCase().includes('vehicle.mak-group.com') ||
    window.location.hostname.toLowerCase().includes('vehicles.mak-group.com') ||
    window.location.hostname.toLowerCase().includes('vehicle.mak-group.com.pk') ||
    window.location.hostname.toLowerCase().startsWith('vehicle.')
  );

  // Synchronize browser address bar smoothly with pushState/replaceState
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = (window.location.hostname || '').toLowerCase();
    
    // When Vehicle Status portal is active, update URL cleanly without breaking navigation
    if (isPublicVehicleTrackingOpen) {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('mode') !== 'vehicle' && !host.startsWith('vehicle.')) {
          const target = selectedPublicVehiclePlate 
            ? `/?mode=vehicle&plate=${encodeURIComponent(selectedPublicVehiclePlate)}`
            : '/?mode=vehicle';
          window.history.replaceState({ mode: 'vehicle' }, '', target);
        }
      } catch (_) {}
    } else if (isPublicContainerTrackingOpen) {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('mode') !== 'status' && !host.startsWith('status.')) {
          window.history.replaceState({ mode: 'status' }, '', '/?mode=status');
        }
      } catch (_) {}
    }
  }, [isPublicVehicleTrackingOpen, isPublicContainerTrackingOpen, selectedPublicVehiclePlate]);

  // Splash Screen & Login Area State:
  // On every app start, reload, or browser refresh:
  // 1. Splash screen ALWAYS displays first
  // 2. Once splash finishes, the Login / Portal Selection screen ALWAYS appears
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [showModeSelection, setShowModeSelection] = useState<boolean>(false);
  const [showCompanySelection, setShowCompanySelection] = useState<boolean>(false);
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState<boolean>(false);
  const [isReplaySplashOnly, setIsReplaySplashOnly] = useState<boolean>(false);
  const { customLogo, companyName } = useBranding();
  const { activeCompany } = useActiveCompany();
  const activeUploadedLogo = (customLogo && isUploadedLogo(customLogo)) 
    ? customLogo 
    : getCompanyUploadedLogo(activeCompany.id);

  // Failsafe: Ensure splash screen never hangs the app under any browser condition
  useEffect(() => {
    if (showSplash) {
      const failsafe = setTimeout(() => {
        setShowSplash(false);
        if (!isReplaySplashOnly) {
          setShowModeSelection(true);
        }
      }, 2500);
      return () => clearTimeout(failsafe);
    }
  }, [showSplash, isReplaySplashOnly]);

  // Role State (Preserved across app switching and backgrounding)
  const [currentRole, setCurrentRole] = useState<UserRole>(() => {
    const saved = safeAppStorage.getItem('dpl_user_role');
    return (saved as UserRole) || UserRole.ADMIN;
  });
  const [currentRoles, setCurrentRoles] = useState<UserRole[]>(() => {
    const saved = safeAppStorage.getItem('dpl_user_roles');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.warn("Could not parse saved roles:", e);
      }
    }
    const single = safeAppStorage.getItem('dpl_user_role') as UserRole;
    return single ? [single] : [UserRole.ADMIN];
  });
  const [currentDesignation, setCurrentDesignation] = useState<string>(() => {
    return safeAppStorage.getItem('dpl_user_designation') || '';
  });
  const [currentClientName, setCurrentClientName] = useState(() => {
    return safeAppStorage.getItem('dpl_client_name') || '';
  });

  // Company Rights & Group Admin State
  const [isGlobalAdmin, setIsGlobalAdmin] = useState<boolean>(() => {
    return safeAppStorage.getItem('dpl_is_global_admin') === 'true';
  });
  const [isGroupAdminPortalOpen, setIsGroupAdminPortalOpen] = useState<boolean>(false);
  const effectiveIsGlobalAdmin = isGlobalAdmin || currentRole === UserRole.ADMIN;
  const [allowedCompanies, setAllowedCompanies] = useState<string[]>(() => {
    const saved = safeAppStorage.getItem('dpl_allowed_companies');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_) {}
    }
    return ['docks', 'muhib', 'vantage', 'truckit'];
  });

  // Luxury Business Class Theme: Pearl White vs Charcoal (matching MAK Logo)
  const [appTheme, setAppTheme] = useState<'pearl' | 'charcoal'>(() => {
    const saved = safeAppStorage.getItem('dpl_app_theme');
    return (saved === 'charcoal' || saved === 'pearl') ? saved : 'charcoal';
  });

  useEffect(() => {
    if (appTheme === 'charcoal') {
      document.body.classList.remove('theme-pearl');
      document.body.classList.add('theme-charcoal');
    } else {
      document.body.classList.remove('theme-charcoal');
      document.body.classList.add('theme-pearl');
    }
    safeAppStorage.setItem('dpl_app_theme', appTheme);
  }, [appTheme]);

  // Session Toast for workflow restoration feedback
  const [sessionToast, setSessionToast] = useState<string | null>(null);

  useEffect(() => {
    if (sessionToast) {
      const timer = setTimeout(() => setSessionToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [sessionToast]);

  useEffect(() => {
    safeAppStorage.setItem('dpl_user_role', currentRole);
  }, [currentRole]);

  useEffect(() => {
    safeAppStorage.setItem('dpl_client_name', currentClientName);
  }, [currentClientName]);

  // Layout State (Preserve activeView across tab backgrounding/reloads/multitasking)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(true);
  const [activeView, setActiveView] = useState(() => {
    return safeAppStorage.getItem('dpl_active_view') || 'dashboard';
  });
  const [navigationFilter, setNavigationFilter] = useState<any>(null);

  // Update storage whenever activeView changes
  useEffect(() => {
    safeAppStorage.setItem('dpl_active_view', activeView);
    safeAppStorage.setItem('dpl_last_location_view', activeView);
    safeAppStorage.setItem('dpl_last_location_role', currentRole);
  }, [activeView, currentRole]);

  // Listen to lifecycle events for multitasking stability
  useEffect(() => {
    const unsubscribe = appLifecycle.subscribe((lifecycleState) => {
      if (lifecycleState === 'background') {
        // Flush critical navigation states
        safeAppStorage.setItem('dpl_active_view', activeView);
        safeAppStorage.setItem('dpl_last_location_view', activeView);
        safeAppStorage.setItem('dpl_last_location_role', currentRole);
        safeAppStorage.setItem('dpl_user_role', currentRole);
        safeAppStorage.setItem('dpl_client_name', currentClientName);
      }
    });
    return () => unsubscribe();
  }, [activeView, currentRole, currentClientName]);

  // Action Center State
  const [isActionCenterOpen, setIsActionCenterOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<AppNotification | null>(null);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);

  // Firebase Auth & Cloud Sync State
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [firestoreConnected, setFirestoreConnected] = useState(true);
  
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Admin Navigation Items (Dashboard removed from sidebar; clicking Logo at top opens Dashboard)
  const adminNavItems = [
    { id: 'cases', label: 'Case Management', icon: FolderKanban },
    { id: 'company_documents', label: 'Company Documents', icon: FolderArchive },
    { id: 'finance', label: 'Finance', icon: FileText },
    { id: 'vehicles', label: 'Vehicles', icon: Truck },
    { id: 'available_vehicles', label: 'Available Fleet', icon: MapPin },
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  // Client Role Navigation Items (ONLY Cases and Finance as requested)
  const clientNavItems = [
    { id: 'cases', label: 'Cases & Shipments', icon: FolderKanban },
    { id: 'finance', label: 'Finance & Invoices', icon: FileText },
    { id: 'available_vehicles', label: 'Available Fleet', icon: MapPin },
  ];

  // Dynamic navigation items based on active portal mode & multi-roles
  const currentNavItems = (() => {
    const isAdminUser = currentRoles.includes(UserRole.ADMIN) || currentRole === UserRole.ADMIN;
    if (isAdminUser) {
      return adminNavItems;
    }
    if (currentRole === UserRole.CLIENT) {
      return clientNavItems;
    }
    if (currentRole === UserRole.TRANSPORTER) {
      return [
        { id: 'vehicles', label: 'Fleet & Vehicles', icon: Truck },
        { id: 'available_vehicles', label: 'Available Fleet', icon: MapPin },
        { id: 'cases', label: 'Assigned Shipments', icon: FolderKanban },
      ];
    }

    const items: Array<{ id: string; label: string; icon: any }> = [];

    const hasCasesAccess = currentRoles.includes(UserRole.OPERATIONS_MANAGER) || 
                           currentRoles.includes(UserRole.LOADING_PORT_STAFF) || 
                           currentRoles.includes(UserRole.UNLOADING_PORT_STAFF) ||
                           currentRoles.includes(UserRole.DESTINATION_PORT_STAFF) ||
                           currentRoles.includes(UserRole.OFFICE_STAFF);
    const hasFinanceAccess = currentRoles.includes(UserRole.FINANCE_MANAGER);
    const hasVehiclesAccess = currentRoles.includes(UserRole.VEHICLE_MANAGER);

    if (hasCasesAccess) {
      items.push({ id: 'cases', label: 'Case Management', icon: FolderKanban });
      items.push({ id: 'company_documents', label: 'Company Documents', icon: FolderArchive });
    }
    if (hasFinanceAccess) {
      items.push({ id: 'finance', label: 'Finance & Accounts', icon: FileText });
    }
    if (hasVehiclesAccess) {
      items.push({ id: 'vehicles', label: 'Fleet & Vehicles', icon: Truck });
      items.push({ id: 'available_vehicles', label: 'Available Fleet', icon: MapPin });
    }

    if (items.length === 0) {
      return [{ id: 'cases', label: 'Case Management', icon: FolderKanban }];
    }

    return items;
  })();

  const handleSwitchMode = (mode: ModeOption) => {
    setCurrentRole(mode.role);
    setActiveView(mode.targetView);
    setNavigationFilter(null);
    setMobileSidebarOpen(false);
  };

  const handleSignOut = () => {
    try {
      auth.signOut().catch(() => {});
    } catch (e) {}
    // Preserve current location before logging out so user can be restored on next login
    safeAppStorage.setItem('dpl_last_location_view', activeView);
    safeAppStorage.setItem('dpl_last_location_role', currentRole);
    safeAppStorage.removeItem('dpl_session_active');
    setShowSplash(false);
    setShowCompanySelection(false);
    setIsCompanyModalOpen(false);
    setShowModeSelection(true);
  };

  useEffect(() => {
    // Test Firestore database connection on boot
    testFirestoreConnection().then((connected) => {
      setFirestoreConnected(connected);
    }).catch(() => {
      setFirestoreConnected(false);
    });

    // Listen to Firebase Authentication State
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });

    // Listen to live notifications from Firestore
    const unsubNotifs = subscribeToNotifications((items) => {
      setNotifications(items || []);
    });

    // Initialize corporate compliance and midnight auditing scheduler
    initAuditSchedulerService();

    // Prevent accidental browser page navigation / app reload when dragging files into window
    const preventFileDropNavigation = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragenter', preventFileDropNavigation, false);
    window.addEventListener('dragover', preventFileDropNavigation, false);
    window.addEventListener('drop', preventFileDropNavigation, false);
    document.addEventListener('dragenter', preventFileDropNavigation, false);
    document.addEventListener('dragover', preventFileDropNavigation, false);
    document.addEventListener('drop', preventFileDropNavigation, false);

    return () => {
      window.removeEventListener('dragenter', preventFileDropNavigation);
      window.removeEventListener('dragover', preventFileDropNavigation);
      window.removeEventListener('drop', preventFileDropNavigation);
      document.removeEventListener('dragenter', preventFileDropNavigation);
      document.removeEventListener('dragover', preventFileDropNavigation);
      document.removeEventListener('drop', preventFileDropNavigation);
      unsubAuth();
      unsubNotifs();
    };
  }, []);

  const handleNavigate = (viewId: string, filterData: any) => {
    setActiveView(viewId);
    setNavigationFilter(filterData ? { ...filterData } : null);
  };

  const handleActionComplete = (notificationId: number) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
    if (notifications.length <= 1) setIsActionCenterOpen(false);
  };

  const handleNotificationClick = (notification: AppNotification) => {
    setSelectedNotification(notification);
    setIsNotificationModalOpen(true);
  };

  const handleNotificationAction = async (action: 'ACCEPT' | 'REJECT' | 'VIEW' | 'MARK_READ') => {
    if (!selectedNotification) return;

    if (action === 'VIEW') {
      if (selectedNotification.targetView) {
        handleNavigate(selectedNotification.targetView, { ...selectedNotification.targetFilter, notificationId: selectedNotification.id });
      }
      setIsNotificationModalOpen(false);
      setIsActionCenterOpen(false);
    } else if (action === 'ACCEPT') {
      try {
        await approveActionRequest(selectedNotification);
      } catch (err) {
        console.error("Failed to approve action request:", err);
      }
      handleActionComplete(selectedNotification.id);
      setIsNotificationModalOpen(false);
    } else if (action === 'REJECT') {
      try {
        await rejectActionRequest(selectedNotification);
      } catch (err) {
        console.error("Failed to reject action request:", err);
      }
      handleActionComplete(selectedNotification.id);
      setIsNotificationModalOpen(false);
    } else if (action === 'MARK_READ') {
      handleActionComplete(selectedNotification.id);
      setIsNotificationModalOpen(false);
    }
  };

  const renderContent = () => {
    // If in Client Role, directly render the dedicated Client Portal
    if (currentRole === UserRole.CLIENT) {
      return (
        <ClientPortal 
          customLogo={customLogo} 
          currentClientName={currentClientName}
          onSwitchMode={handleSwitchMode}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onSignOut={handleSignOut}
          onSwitchToAdmin={() => {
            setCurrentRole(UserRole.ADMIN);
            setActiveView('dashboard');
          }} 
        />
      );
    }

    // If in Transporter Role, directly render the Transporter Portal
    if (currentRole === UserRole.TRANSPORTER) {
      return (
        <TransporterPortal
          onSignOut={handleSignOut}
          onSwitchMode={handleSwitchMode}
          transporterName={safeAppStorage.getItem('dpl_current_user_name') || 'Bilal Goods Transport Co.'}
        />
      );
    }

    // If in Vendor Role, directly render the Vendor Portal
    if (currentRole === UserRole.VENDOR) {
      return (
        <VendorPortal
          onSignOut={handleSignOut}
          onSwitchMode={handleSwitchMode}
          vendorName={safeAppStorage.getItem('dpl_current_user_name') || 'Al-Makkah Logistics & Equipment Services'}
          vendorId={safeAppStorage.getItem('dpl_current_user_id') || 'vendor'}
        />
      );
    }

    // Route Loading Port Staff and Destination / Unloading Staff directly to their dedicated workspace
    if (
      currentRole === UserRole.LOADING_PORT_STAFF || 
      currentRole === UserRole.UNLOADING_PORT_STAFF || 
      currentRole === UserRole.DESTINATION_PORT_STAFF
    ) {
      return (
        <LoadingPortStaffPortal 
          onSignOut={handleSignOut}
          userRole={currentRole}
          userRoles={currentRoles}
          staffUserId={safeAppStorage.getItem('dpl_current_user_id') || 'mohsin'}
          staffUserName={safeAppStorage.getItem('dpl_current_user_name') || 'Mohsin Khan'}
        />
      );
    }

    switch(activeView) {
      case 'dashboard': return <Dashboard onNavigate={handleNavigate} />;
      case 'company_documents': return <CompanyDocuments />;
      case 'cases': return <CaseManagement initialFilter={navigationFilter} clearFilter={() => setNavigationFilter(null)} onActionComplete={handleActionComplete} customLogo={customLogo} userRole={currentRole} userRoles={currentRoles} currentClientName={currentClientName} />;
      case 'drive': return <GoogleDriveManager />;
      case 'finance': {
        const canAccessFinance = currentRoles.includes(UserRole.ADMIN) || currentRoles.includes(UserRole.FINANCE_MANAGER) || currentRole === UserRole.ADMIN || currentRole === UserRole.FINANCE_MANAGER;
        if (!canAccessFinance) {
          return (
            <div className="p-8 text-center bg-slate-900/60 rounded-2xl border border-white/10 m-6 max-w-lg mx-auto">
              <ShieldAlert className="w-12 h-12 text-amber-400 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">Access Restricted</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                You do not have authorization to view Company Financials. Company financials are strictly accessible to Finance Managers and Group Administrators.
              </p>
            </div>
          );
        }
        return <Finance initialFilter={navigationFilter} onActionComplete={handleActionComplete} customLogo={customLogo} />;
      }
      case 'vehicles': {
        const canAccessVehicles = currentRoles.includes(UserRole.ADMIN) || currentRole === UserRole.ADMIN || currentRoles.includes(UserRole.VEHICLE_MANAGER) || currentRole === UserRole.VEHICLE_MANAGER || (currentRole as any) === UserRole.TRANSPORTER;
        if (!canAccessVehicles) {
          return (
            <div className="p-8 text-center bg-slate-900/60 rounded-2xl border border-white/10 m-6 max-w-lg mx-auto">
              <ShieldAlert className="w-12 h-12 text-rose-400 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">Access Restricted</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Fleet management is restricted to Vehicle Managers and Fleet Coordinators.
              </p>
            </div>
          );
        }
        return (
          <VehicleManagement 
            initialFilter={navigationFilter} 
            clearFilter={() => setNavigationFilter(null)} 
            userRole={currentRole} 
            userRoles={currentRoles}
            onOpenPublicTracker={(plate) => {
              const host = (window.location.hostname || '').toLowerCase();
              if (host.includes('makpk.online') || host.includes('mak-group.com')) {
                window.location.href = plate 
                  ? `https://vehicle.makpk.online?vehicle=${encodeURIComponent(plate)}`
                  : 'https://vehicle.makpk.online';
                return;
              }
              if (plate) setSelectedPublicVehiclePlate(plate);
              setOpenedFromInternalWorkspace(true);
              setIsPublicVehicleTrackingOpen(true);
              try {
                const newUrl = plate ? `/?mode=vehicle&plate=${encodeURIComponent(plate)}` : '/?mode=vehicle';
                window.history.pushState({ mode: 'vehicle' }, '', newUrl);
              } catch (_) {}
            }}
          />
        );
      }
      case 'available_vehicles': return <AvailableVehiclesView userRole={currentRole} />;
      case 'users': {
        const canAccessUsers = currentRoles.includes(UserRole.ADMIN) || currentRole === UserRole.ADMIN;
        if (!canAccessUsers) {
          return (
            <div className="p-8 text-center bg-slate-900/60 rounded-2xl border border-white/10 m-6 max-w-lg mx-auto">
              <ShieldAlert className="w-12 h-12 text-purple-400 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">Access Restricted</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                User Management is restricted to Administrators only.
              </p>
            </div>
          );
        }
        return <UserManagement />;
      }
      case 'settings': return <AppSettings onReplaySplash={() => { setIsReplaySplashOnly(true); setShowSplash(true); }} />;
      default: return <Dashboard onNavigate={handleNavigate} />;
    }
  };

  // Dedicated Public Tracking Portals (Vehicle.makpk.online & Status.makpk.online - No Login Required)
  if (isPublicVehicleTrackingOpen) {
    return (
      <ErrorBoundary>
        <PublicVehicleTrackingPortal
          initialQuery={selectedPublicVehiclePlate}
          onExitPortal={openedFromInternalWorkspace ? () => {
            setIsPublicVehicleTrackingOpen(false);
            setOpenedFromInternalWorkspace(false);
          } : undefined}
          onSwitchToContainerTracker={() => {
            const host = (window.location.hostname || '').toLowerCase();
            if (host.includes('makpk.online') || host.includes('mak-group.com')) {
              window.location.href = 'https://status.makpk.online';
              return;
            }
            setIsPublicVehicleTrackingOpen(false);
            setIsPublicContainerTrackingOpen(true);
            try {
              window.history.pushState({ mode: 'status' }, '', '/?mode=status');
            } catch (_) {}
          }}
        />
      </ErrorBoundary>
    );
  }

  if (isPublicContainerTrackingOpen) {
    return (
      <ErrorBoundary>
        <PublicContainerTrackingPortal
          onExitPortal={openedFromInternalWorkspace ? () => {
            setIsPublicContainerTrackingOpen(false);
            setOpenedFromInternalWorkspace(false);
          } : undefined}
          onSwitchToVehicleTracker={() => {
            const host = (window.location.hostname || '').toLowerCase();
            if (host.includes('makpk.online') || host.includes('mak-group.com')) {
              window.location.href = 'https://vehicle.makpk.online';
              return;
            }
            setIsPublicContainerTrackingOpen(false);
            setIsPublicVehicleTrackingOpen(true);
            try {
              window.history.pushState({ mode: 'vehicle' }, '', '/?mode=vehicle');
            } catch (_) {}
          }}
        />
      </ErrorBoundary>
    );
  }

  if (showSplash) {
    return (
      <ErrorBoundary>
        <SplashScreen 
          onComplete={() => {
            setShowSplash(false);
            if (isReplaySplashOnly) {
              setIsReplaySplashOnly(false);
            } else {
              setShowModeSelection(true);
            }
          }} 
        />
      </ErrorBoundary>
    );
  }

  if (showModeSelection) {
    return (
      <ErrorBoundary>
        <LoginModeSelection 
          onOpenPublicTracker={() => {
            const host = (window.location.hostname || '').toLowerCase();
            if (host.includes('makpk.online') || host.includes('mak-group.com')) {
              window.location.href = 'https://status.makpk.online';
              return;
            }
            setIsPublicContainerTrackingOpen(true);
            try { window.history.pushState({ mode: 'status' }, '', '/?mode=status'); } catch (_) {}
          }}
          onOpenVehicleTracker={() => {
            const host = (window.location.hostname || '').toLowerCase();
            if (host.includes('makpk.online') || host.includes('mak-group.com')) {
              window.location.href = 'https://vehicle.makpk.online';
              return;
            }
            setIsPublicVehicleTrackingOpen(true);
            try { window.history.pushState({ mode: 'vehicle' }, '', '/?mode=vehicle'); } catch (_) {}
          }}
          onSelectMode={(payload: SelectedModePayload) => {
            setCurrentRole(payload.role);
            const roles = payload.roles && payload.roles.length > 0 ? payload.roles : [payload.role];
            setCurrentRoles(roles);
            if (payload.designation) {
              setCurrentDesignation(payload.designation);
              safeAppStorage.setItem('dpl_user_designation', payload.designation);
            }
            safeAppStorage.setItem('dpl_user_roles', JSON.stringify(roles));

            if (payload.clientName) {
              setCurrentClientName(payload.clientName);
              safeAppStorage.setItem('dpl_client_name', payload.clientName);
            }

            const lastLocationView = safeAppStorage.getItem('dpl_last_location_view');
            const lastLocationRole = safeAppStorage.getItem('dpl_last_location_role');

            let targetView = payload.targetView;
            if (payload.role !== UserRole.ADMIN && lastLocationView && lastLocationRole === payload.role && lastLocationView !== 'settings') {
              targetView = lastLocationView;
            }

            setActiveView(targetView);
            safeAppStorage.setItem('dpl_user_role', payload.role);
            safeAppStorage.setItem('dpl_active_view', targetView);
            safeAppStorage.setItem('dpl_last_location_view', targetView);
            safeAppStorage.setItem('dpl_last_location_role', payload.role);
            safeAppStorage.setItem('dpl_session_active', 'true');
            setShowModeSelection(false);

            const userAllowed = payload.allowedCompanies && payload.allowedCompanies.length > 0 
              ? payload.allowedCompanies 
              : (payload.isGlobalAdmin ? ['docks', 'truckit', 'muhib', 'vantage'] : ['docks']);
            const userIsGlobal = Boolean(payload.isGlobalAdmin);

            setAllowedCompanies(userAllowed);
            setIsGlobalAdmin(userIsGlobal);

            // If user has only 1 company assigned (e.g. Single Company Admin),
            // auto-set active company to that single company and skip selection!
            if (!userIsGlobal && userAllowed.length === 1) {
              setActiveCompany(userAllowed[0] as CompanyId);
              setShowCompanySelection(false);
            } else {
              const shouldPickCompany = !(
                payload.role === UserRole.TRANSPORTER || 
                payload.role === UserRole.CLIENT || 
                payload.role === UserRole.VENDOR ||
                payload.role === UserRole.LOADING_PORT_STAFF || 
                payload.role === UserRole.DESTINATION_PORT_STAFF || 
                payload.role === UserRole.UNLOADING_PORT_STAFF
              );
              setShowCompanySelection(shouldPickCompany);
            }
          }}
        />
      </ErrorBoundary>
    );
  }

  // Group Admin Executive Portal (Full dedicated portal for Main Admin with 4 companies live dashboards & total consolidated data)
  if (isGroupAdminPortalOpen) {
    return (
      <ErrorBoundary>
        <GroupAdminPortal 
          currentUserName={safeAppStorage.getItem('dpl_current_user_name') || firebaseUser?.displayName || 'Main Admin'}
          onExitPortal={() => setIsGroupAdminPortalOpen(false)}
          onSignOut={handleSignOut}
          onSelectCompanyWorkspace={(selectedId) => {
            setActiveCompany(selectedId);
            setIsGroupAdminPortalOpen(false);
            setShowCompanySelection(false);
          }}
        />
      </ErrorBoundary>
    );
  }

  if (showCompanySelection) {
    return (
      <ErrorBoundary>
        <CompanyWorkspaceSelector 
          userName={safeAppStorage.getItem('dpl_current_user_name') || 'Staff User'}
          userRoleTitle={currentDesignation || (currentRole as string)}
          onSignOut={handleSignOut}
          allowedCompanies={allowedCompanies}
          isGlobalAdmin={effectiveIsGlobalAdmin}
          currentRole={currentRole}
          onOpenGroupAdminPortal={() => setIsGroupAdminPortalOpen(true)}
          onSwitchPortal={(role, targetView) => {
            setCurrentRole(role);
            setActiveView(targetView);
            safeAppStorage.setItem('dpl_user_role', role);
            safeAppStorage.setItem('dpl_active_view', targetView);
            safeAppStorage.setItem('dpl_last_location_role', role);
            safeAppStorage.setItem('dpl_last_location_view', targetView);
            setShowCompanySelection(false);
          }}
          onSelectCompany={(selectedId, targetRole, targetView) => {
            setActiveCompany(selectedId);
            if (targetRole) {
              setCurrentRole(targetRole);
              safeAppStorage.setItem('dpl_user_role', targetRole);
            }
            if (targetView) {
              setActiveView(targetView);
              safeAppStorage.setItem('dpl_active_view', targetView);
              safeAppStorage.setItem('dpl_last_location_view', targetView);
            }
            setShowCompanySelection(false);
          }}
        />
      </ErrorBoundary>
    );
  }

  // Check if current active session is a dedicated full-page portal
  const isDedicatedPortal = 
    currentRole === UserRole.CLIENT || 
    currentRole === UserRole.TRANSPORTER || 
    currentRole === UserRole.LOADING_PORT_STAFF || 
    currentRole === UserRole.UNLOADING_PORT_STAFF || 
    currentRole === UserRole.DESTINATION_PORT_STAFF;

  if (isDedicatedPortal) {
    return (
      <ErrorBoundary>
        <div className={`h-screen h-[100dvh] min-h-[100dvh] max-h-[100dvh] w-full font-sans overflow-hidden relative transition-colors duration-300 ${appTheme === 'pearl' ? 'bg-transparent text-slate-900' : 'bg-slate-950 text-gray-100'}`}>
          {renderContent()}

          {/* Action Center Sidebar */}
          {isActionCenterOpen && (
            <div 
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" 
              onClick={() => setIsActionCenterOpen(false)}
            />
          )}

          {/* Action Center Modal / Notifications */}
          <NotificationModal 
            isOpen={isNotificationModalOpen}
            notification={selectedNotification}
            onClose={() => setIsNotificationModalOpen(false)}
            onAction={handleNotificationAction}
          />

          {/* Firebase Authentication Modal */}
          <AuthModal 
            isOpen={isAuthModalOpen}
            onClose={() => setIsAuthModalOpen(false)}
            currentUser={firebaseUser}
            currentRole={currentRole}
            onRoleChange={(role) => setCurrentRole(role)}
          />

          {/* Company Workspace Selector Modal */}
          {isCompanyModalOpen && (
            <CompanyWorkspaceSelector 
              isModal={true}
              onClose={() => setIsCompanyModalOpen(false)}
              userName={safeAppStorage.getItem('dpl_current_user_name') || 'Staff User'}
              userRoleTitle={currentDesignation || (currentRole as string)}
              allowedCompanies={allowedCompanies}
              isGlobalAdmin={effectiveIsGlobalAdmin}
              currentRole={currentRole}
              onOpenGroupAdminPortal={() => {
                setIsCompanyModalOpen(false);
                setIsGroupAdminPortalOpen(true);
              }}
              onSwitchPortal={(role, targetView) => {
                setCurrentRole(role);
                setActiveView(targetView);
                safeAppStorage.setItem('dpl_user_role', role);
                safeAppStorage.setItem('dpl_active_view', targetView);
                safeAppStorage.setItem('dpl_last_location_role', role);
                safeAppStorage.setItem('dpl_last_location_view', targetView);
                setIsCompanyModalOpen(false);
              }}
              onSelectCompany={(selectedId, targetRole, targetView) => {
                setActiveCompany(selectedId);
                if (targetRole) {
                  setCurrentRole(targetRole);
                  safeAppStorage.setItem('dpl_user_role', targetRole);
                }
                if (targetView) {
                  setActiveView(targetView);
                  safeAppStorage.setItem('dpl_active_view', targetView);
                  safeAppStorage.setItem('dpl_last_location_view', targetView);
                }
                setIsCompanyModalOpen(false);
              }}
            />
          )}

          {/* Session & Draft Restoration Toast Banner */}
          {sessionToast && (
            <div className="fixed bottom-6 right-6 z-50 max-w-md bg-slate-900/95 border border-amber-400/50 text-amber-200 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-xl flex items-center justify-between gap-3 animate-fade-in">
              <div className="flex items-center gap-2.5 text-xs font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping flex-shrink-0" />
                <span className="leading-snug">{sessionToast}</span>
              </div>
              <button 
                type="button"
                onClick={() => setSessionToast(null)} 
                className="text-gray-400 hover:text-white text-xs p-1 rounded-lg hover:bg-white/10 transition"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className={`flex h-screen h-[100dvh] min-h-[100dvh] max-h-[100dvh] w-full bg-transparent font-sans overflow-hidden relative transition-colors duration-300 ${appTheme === 'pearl' ? 'text-slate-900' : 'text-gray-100'}`}>
        
        {/* Sidebar Overlay for Mobile */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden" onClick={() => setMobileSidebarOpen(false)}></div>
      )}
      
      {/* Action Center Overlay */}
      {isActionCenterOpen && (
        <div 
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" 
            onClick={() => setIsActionCenterOpen(false)}
        ></div>
      )}

      {/* Notification Modal */}
      <NotificationModal 
        isOpen={isNotificationModalOpen}
        notification={selectedNotification}
        onClose={() => setIsNotificationModalOpen(false)}
        onAction={handleNotificationAction}
      />

      {/* Action Center Sidebar */}
      <div 
        className={`fixed top-0 right-0 h-full w-80 sm:w-96 bg-slate-900/95 backdrop-blur-xl border-l border-white/10 z-50 transform transition-transform duration-300 shadow-2xl flex flex-col ${isActionCenterOpen ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-900">
          <h3 className="font-semibold text-lg text-white flex items-center gap-2"><Bell size={20} className="text-brand-400" /> Action Center</h3>
          <button onClick={() => setIsActionCenterOpen(false)} className="text-gray-400 hover:text-white p-1 rounded-full hover:bg-white/10"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-hidden p-3 flex flex-col min-h-0">
          <VirtualizedList
            items={notifications}
            itemHeight={120}
            maxHeight={window.innerHeight ? window.innerHeight - 100 : 700}
            getItemKey={(n, idx) => `act_notif_${n.id || idx}_${idx}`}
            emptyPlaceholder={
              <div className="text-center text-gray-500 py-10">
                <Check size={48} className="mx-auto mb-2 opacity-50" />
                <p>All caught up!</p>
              </div>
            }
            renderItem={(n) => (
              <div 
                onClick={() => handleNotificationClick(n)}
                className="p-3.5 mb-2.5 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer group"
              >
                <h4 className="text-sm font-semibold text-gray-200 group-hover:text-brand-300 transition-colors truncate">{n.title}</h4>
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">{n.description}</p>
                {n.actionLabel && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNotificationClick(n);
                    }}
                    className="w-full mt-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium py-1.5 rounded-lg transition-colors shadow-lg shadow-brand-600/20"
                  >
                    {n.actionLabel}
                  </button>
                )}
              </div>
            )}
          />
        </div>
      </div>

      {/* Main Sidebar */}
      <aside className={`fixed top-0 left-0 h-full bg-slate-950/98 backdrop-blur-2xl border-r border-white/10 transition-all duration-300 flex flex-col z-40 shadow-2xl ${mobileSidebarOpen ? 'w-72 sm:w-80 translate-x-0' : 'w-72 sm:w-80 -translate-x-full'} lg:static lg:translate-x-0 lg:h-auto ${desktopSidebarExpanded ? 'lg:w-64' : 'lg:w-20'} overflow-hidden select-none`}>
        
        {/* Mobile Safe-Area Header with Close Button */}
        <div className="pt-3 pb-2.5 px-4 border-b border-white/10 flex items-center justify-between lg:hidden bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-300">
              MAK Enterprise Menu
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
            title="Close Menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Company Identity Header in Sidebar (Compact, Beautiful, Safe) */}
        <div 
          onClick={() => {
            setActiveView('dashboard');
            setNavigationFilter(null);
            setMobileSidebarOpen(false);
          }}
          className="p-3 mx-3 my-2.5 rounded-2xl bg-slate-900/90 border border-white/10 flex items-center gap-2.5 cursor-pointer hover:border-slate-300/40 transition-all group shadow-md shrink-0"
          title={`${activeCompany.name} Dashboard`}
        >
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-black/60 border border-white/15 flex items-center justify-center p-2 shrink-0 group-hover:scale-105 transition-transform shadow-lg">
            <Logo variant="icon" className="max-h-full max-w-full object-contain" customSrc={getCompanyLogoUrl(activeCompany.id)} />
          </div>
          <div className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} min-w-0 flex-1`}>
            <h3 className="font-extrabold text-xs sm:text-sm text-white group-hover:text-slate-100 transition-colors uppercase leading-tight truncate">
              {activeCompany.name}
            </h3>
            <p className="text-[10px] font-mono text-slate-400 tracking-wider uppercase truncate mt-0.5">
              {activeCompany.shortName} • {activeCompany.prefix}
            </p>
          </div>
        </div>

        {/* Switch Company Workspace Button in Sidebar */}
        <div className="w-full px-3 pb-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setMobileSidebarOpen(false);
              setIsCompanyModalOpen(true);
            }}
            className="w-full flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-white/15 text-slate-200 transition-all text-xs font-bold cursor-pointer group shadow-sm active:scale-95"
            title="Switch Subsidiary / Company Workspace"
          >
            <div className="flex items-center gap-2 truncate">
              <Building2 size={14} className="text-slate-300 shrink-0" />
              <span className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} truncate text-[11px]`}>
                Switch Company
              </span>
            </div>
            <span className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-bold uppercase font-mono`}>
              4 Entities
            </span>
          </button>
        </div>

        {/* Group Admin Executive Portal Button in Sidebar */}
        {effectiveIsGlobalAdmin && (
          <div className="w-full px-3 pb-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMobileSidebarOpen(false);
                setIsGroupAdminPortalOpen(true);
              }}
              className="w-full flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-950/40 via-amber-900/30 to-slate-900/90 hover:from-amber-900/50 hover:to-slate-800/90 border border-amber-500/30 text-amber-200 transition-all text-xs font-bold cursor-pointer group shadow-sm active:scale-95"
              title="Open Group Admin Executive Portal (Consolidated Total Data & Settings)"
            >
              <div className="flex items-center gap-2 truncate">
                <Crown size={14} className="text-amber-400 shrink-0" />
                <span className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} truncate text-[11px]`}>
                  Group Admin Portal
                </span>
              </div>
              <span className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase font-mono`}>
                Executive
              </span>
            </button>
          </div>
        )}

        {/* Navigation items (Strictly Cases & Finance only for Client) */}
        <nav className="flex-1 overflow-y-auto py-2 space-y-1 px-3 custom-scrollbar">
          {currentNavItems.map((item, idx) => (
            <button 
              key={`nav_item_${item.id}_${idx}`} 
              onClick={() => { 
                setActiveView(item.id); 
                setNavigationFilter(null); 
                setMobileSidebarOpen(false); 
              }} 
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl transition-all ${
                activeView === item.id 
                  ? 'bg-brand-600/20 text-white border border-brand-500/20 shadow-lg shadow-brand-500/10' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              } ${!desktopSidebarExpanded && 'lg:justify-center'}`}
            >
              <div className="flex items-center gap-3 min-w-0 truncate">
                <item.icon size={20} className={`${activeView === item.id ? 'text-brand-400' : 'text-gray-500'} group-hover:text-white shrink-0`} />
                <span className={`${!desktopSidebarExpanded && 'lg:hidden'} font-medium text-xs sm:text-sm truncate`}>{item.label}</span>
              </div>

              {/* Total Amount Available Counter directly beside Finance in sidebar */}
              {item.id === 'finance' && (
                <div className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} shrink-0 ml-1`}>
                  <GoldenAmountWidget 
                    variant="sidebar"
                    onOpenFinance={() => {
                      setActiveView('finance');
                      setMobileSidebarOpen(false);
                    }}
                  />
                </div>
              )}
            </button>
          ))}
        </nav>

        {/* Active Session Info */}
        <div className={`px-3 py-2 border-t border-white/5 shrink-0 ${!desktopSidebarExpanded && 'lg:hidden'}`}>
          <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <div className="min-w-0 flex-1">
              {currentDesignation && (
                <span className="text-[10px] text-brand-300 font-medium block truncate">
                  {currentDesignation}
                </span>
              )}
              <span className="text-[10px] text-amber-400 font-mono uppercase block truncate">
                {currentRoles && currentRoles.length > 1 
                  ? `${currentRoles.length} Roles Assigned` 
                  : `Role: ${currentRole}`}
              </span>
              <span className="text-[11px] text-gray-300 font-bold block truncate">
                {(currentRole as string) === UserRole.CLIENT ? currentClientName : 'Active User'}
              </span>
            </div>
          </div>
        </div>

        {/* Theme Toggle in Sidebar */}
        <div className="px-3 pb-2 shrink-0">
          <button
            type="button"
            onClick={() => setAppTheme(prev => prev === 'pearl' ? 'charcoal' : 'pearl')}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition shadow-sm active:scale-95 cursor-pointer ${
              appTheme === 'pearl'
                ? 'bg-gradient-to-r from-amber-100 via-white to-amber-50 text-slate-900 border-amber-300'
                : 'bg-white/10 hover:bg-white/15 text-slate-200 border-white/15'
            } ${!desktopSidebarExpanded ? 'lg:justify-center' : ''}`}
            title="Toggle Theme"
          >
            <div className="flex items-center gap-2 truncate">
              <Sparkles size={14} className={appTheme === 'pearl' ? "text-amber-600" : "text-amber-400"} />
              <span className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} text-[11px]`}>
                Theme: {appTheme === 'pearl' ? 'Pearl White' : 'Charcoal'}
              </span>
            </div>
            <span className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} text-[9px] px-1.5 py-0.5 rounded bg-black/10 font-bold uppercase font-mono`}>
              {appTheme === 'pearl' ? 'Light' : 'Dark'}
            </span>
          </button>
        </div>

        {/* Logout at Sidebar Bottom */}
        <div className="p-3 border-t border-white/5 shrink-0">
          <button 
            type="button"
            onClick={handleSignOut}
            className={`w-full flex items-center gap-3 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-xl transition text-xs cursor-pointer ${!desktopSidebarExpanded && 'lg:justify-center'}`}
            title="Sign Out"
          >
            <LogOut size={16} /> <span className={`${!desktopSidebarExpanded && 'lg:hidden'}`}>Logout</span>
          </button>
        </div>
      </aside>

      {/* Content Area */}
      <main className="flex-1 flex flex-col h-full min-h-0 min-w-0 overflow-hidden relative">
        {/* Top Header - Exact Clean Proportions:
            Left: Sidebar Menu Button
            Center: Company Logo Centered with clean boundaries
            Right: Notifications & LogOut (+ Desktop Quick Actions)
        */}
        <header className={`h-14 sm:h-16 md:h-20 border-b flex items-center justify-between px-2 sm:px-4 md:px-6 z-20 flex-shrink-0 sticky top-0 shadow-md gap-1.5 sm:gap-3 transition-colors duration-200 ${
          appTheme === 'pearl' 
            ? 'bg-white/95 border-amber-900/10 shadow-slate-200/50 text-slate-800' 
            : 'bg-slate-900/98 border-white/10 shadow-black/40 text-slate-100'
        }`}>
          {/* Left: Sidebar Menu Toggle & Active Entity Pill */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0">
            <button 
              type="button"
              onClick={() => window.innerWidth < 1024 ? setMobileSidebarOpen(!mobileSidebarOpen) : setDesktopSidebarExpanded(!desktopSidebarExpanded)} 
              className={`p-2 sm:p-2.5 rounded-xl border transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                appTheme === 'pearl'
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-gray-200 hover:text-white border-white/10'
              }`}
              title="Toggle Sidebar Menu"
            >
              <Menu size={18} className={appTheme === 'pearl' ? "text-slate-800" : "text-slate-200"} />
            </button>

            <span className={`px-2 py-1 rounded-lg border font-mono font-bold text-xs shrink-0 shadow-sm ${
              appTheme === 'pearl'
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-950'
                : 'bg-white/10 border-white/20 text-slate-200'
            }`}>
              {activeCompany.prefix || activeCompany.shortName}
            </span>

            <div className="hidden xl:flex items-center gap-1.5 min-w-0">
              <span className={`text-xs font-bold uppercase tracking-wider truncate ${
                appTheme === 'pearl' ? 'text-slate-600' : 'text-slate-300'
              }`}>
                {activeView === 'dashboard' ? 'Overview' : activeView.replace('-', ' ')}
              </span>
            </div>
          </div>

          {/* Center: Company Logo Centered with dedicated container and pristine background */}
          <div className="flex items-center justify-center min-w-0 flex-1 px-1 sm:px-2 overflow-hidden">
            <button
              type="button"
              id="header-center-company-logo-btn"
              onClick={() => setIsCompanyModalOpen(true)}
              className="flex items-center justify-center px-1.5 py-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 border border-transparent transition-all duration-200 cursor-pointer group shrink-0 max-w-full"
              title={`${activeCompany.name} (Click to switch company)`}
            >
              <img 
                src={getCompanyLogoUrl(activeCompany.id)} 
                alt={activeCompany.name} 
                className="h-8 sm:h-11 md:h-14 w-auto max-w-[120px] xs:max-w-[150px] sm:max-w-[220px] md:max-w-[320px] object-contain drop-shadow group-hover:scale-105 transition-transform duration-200" 
              />
            </button>
          </div>

          {/* Right: Actions, Notifications & Sign Out */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0 justify-end">
            {/* Quick Public Trackers Preview Buttons for Staff (Desktop) */}
            <div className="hidden 2xl:flex items-center gap-1.5 mr-1">
              <button
                type="button"
                onClick={() => {
                  const host = (window.location.hostname || '').toLowerCase();
                  if (host.includes('makpk.online') || host.includes('mak-group.com')) {
                    window.location.href = 'https://status.makpk.online';
                    return;
                  }
                  setIsPublicContainerTrackingOpen(true);
                  try { window.history.pushState({ mode: 'status' }, '', '/?mode=status'); } catch (_) {}
                }}
                className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer ${
                  appTheme === 'pearl'
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border-white/10'
                }`}
                title="Preview Public Container Tracker (Status.makpk.online)"
              >
                <Package size={13} />
                <span>status.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const host = (window.location.hostname || '').toLowerCase();
                  if (host.includes('makpk.online') || host.includes('mak-group.com')) {
                    window.location.href = 'https://vehicle.makpk.online';
                    return;
                  }
                  setIsPublicVehicleTrackingOpen(true);
                  try { window.history.pushState({ mode: 'vehicle' }, '', '/?mode=vehicle'); } catch (_) {}
                }}
                className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer ${
                  appTheme === 'pearl'
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border-white/10'
                }`}
                title="Preview Public Vehicle Tracker (vehicle.makpk.online)"
              >
                <Truck size={13} />
                <span>vehicle.</span>
              </button>
            </div>

            {/* Group Admin Executive Portal Button in Header */}
            {effectiveIsGlobalAdmin && (
              <button
                type="button"
                onClick={() => setIsGroupAdminPortalOpen(true)}
                className={`h-9 px-2 sm:px-2.5 md:px-3 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer shrink-0 ${
                  appTheme === 'pearl'
                    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 border-amber-400/60'
                    : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-400/40'
                }`}
                title="Open Group Admin Executive Portal"
              >
                <Crown size={14} className={appTheme === 'pearl' ? "text-amber-700" : "text-amber-400"} />
                <span className="font-mono uppercase text-[11px] tracking-wider font-bold hidden sm:inline">Admin</span>
              </button>
            )}

            {/* User Account Chip */}
            <div 
              className={`h-9 px-2 sm:px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 shrink-0 max-w-[130px] sm:max-w-[170px] ${
                appTheme === 'pearl'
                  ? 'bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-slate-800 text-slate-300 border-white/10'
              }`}
              title={`Active Account: ${safeAppStorage.getItem('dpl_current_user_name') || firebaseUser?.displayName || currentClientName || 'Admin'} (${currentRole})`}
            >
              <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="truncate text-[11px] font-medium hidden sm:inline">
                {safeAppStorage.getItem('dpl_current_user_name') || firebaseUser?.displayName || currentClientName || 'Admin'}
              </span>
            </div>

            {/* Luxury Theme Toggle Button */}
            <button
              type="button"
              onClick={() => setAppTheme(prev => prev === 'pearl' ? 'charcoal' : 'pearl')}
              className={`h-9 px-2 sm:px-2.5 md:px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                appTheme === 'pearl'
                  ? 'bg-amber-100 hover:bg-amber-200 text-slate-900 border-amber-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-white/15'
              }`}
              title={appTheme === 'pearl' ? "Switch to Charcoal Luxury" : "Switch to Pearl White"}
            >
              <Sparkles size={14} className={appTheme === 'pearl' ? "text-amber-600" : "text-amber-400"} />
              <span className="font-mono text-[11px] uppercase tracking-wider font-bold hidden md:inline">
                {appTheme === 'pearl' ? 'Pearl' : 'Charcoal'}
              </span>
            </button>

            {/* Live Real-time Notification Center */}
            <LiveNotificationCenter
              currentRole={currentRole}
              currentRoles={currentRoles}
              userIdentifier={currentClientName || firebaseUser?.displayName || firebaseUser?.email || 'Admin'}
              clientName={currentClientName}
              theme={appTheme}
              buttonClassName={`h-9 w-9 rounded-xl border transition active:scale-95 shrink-0 flex items-center justify-center cursor-pointer ${
                appTheme === 'pearl'
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-gray-200 hover:text-white border-white/10'
              }`}
              onNavigateToCase={(caseNoOrId, filterData) => {
                setActiveView('cases');
                setNavigationFilter(filterData || caseNoOrId);
              }}
              onNavigateToTab={(tabName) => {
                if (tabName === 'finance') setActiveView('finance');
                else if (tabName === 'cases') setActiveView('cases');
                else if (tabName === 'transporter') setActiveView('vehicles');
                else if (tabName === 'users') setActiveView('users');
              }}
            />

            {/* Sign Out Button */}
            <button
              type="button"
              id="header-signout-btn"
              onClick={handleSignOut}
              className="h-9 w-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/30 text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 flex items-center justify-center transition-all duration-200 shadow-sm active:scale-95 cursor-pointer shrink-0"
              title="Sign Out"
            >
              <LogOut size={15} className="text-red-400" />
            </button>
          </div>
        </header>

        <div 
          id="main-scroll-container"
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 sm:p-6 pb-32 sm:pb-12 custom-scrollbar overscroll-contain touch-pan-y"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {renderContent()}
        </div>

        {/* Session & Draft Restoration Toast Banner */}
        {sessionToast && (
          <div className="fixed bottom-6 right-6 z-50 max-w-md bg-slate-900/95 border border-amber-400/50 text-amber-200 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-xl flex items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-2.5 text-xs font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping flex-shrink-0" />
              <span className="leading-snug">{sessionToast}</span>
            </div>
            <button 
              type="button"
              onClick={() => setSessionToast(null)} 
              className="text-gray-400 hover:text-white text-xs p-1 rounded-lg hover:bg-white/10 transition"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Firebase Authentication Modal */}
        <AuthModal 
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          currentUser={firebaseUser}
          currentRole={currentRole}
          onRoleChange={(role) => setCurrentRole(role)}
        />

        {/* Company Workspace Selector Modal */}
        {isCompanyModalOpen && (
          <CompanyWorkspaceSelector 
            isModal={true}
            onClose={() => setIsCompanyModalOpen(false)}
            userName={safeAppStorage.getItem('dpl_current_user_name') || 'Staff User'}
            userRoleTitle={currentDesignation || (currentRole as string)}
            allowedCompanies={allowedCompanies}
            isGlobalAdmin={effectiveIsGlobalAdmin}
            currentRole={currentRole}
            onOpenGroupAdminPortal={() => {
              setIsCompanyModalOpen(false);
              setIsGroupAdminPortalOpen(true);
            }}
            onSwitchPortal={(role, targetView) => {
              setCurrentRole(role);
              setActiveView(targetView);
              safeAppStorage.setItem('dpl_user_role', role);
              safeAppStorage.setItem('dpl_active_view', targetView);
              safeAppStorage.setItem('dpl_last_location_role', role);
              safeAppStorage.setItem('dpl_last_location_view', targetView);
              setIsCompanyModalOpen(false);
            }}
            onSelectCompany={(selectedId, targetRole, targetView) => {
              setActiveCompany(selectedId);
              if (targetRole) {
                setCurrentRole(targetRole);
                safeAppStorage.setItem('dpl_user_role', targetRole);
              }
              if (targetView) {
                setActiveView(targetView);
                safeAppStorage.setItem('dpl_active_view', targetView);
                safeAppStorage.setItem('dpl_last_location_view', targetView);
              }
              setIsCompanyModalOpen(false);
            }}
          />
        )}
      </main>
    </div>
    </ErrorBoundary>
  );
};

export default App;


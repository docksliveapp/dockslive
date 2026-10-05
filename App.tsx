
import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, FolderKanban, Users, Truck, Settings, FileText, Bell, LogOut, Menu,
  X, Check, AlertCircle, AlertTriangle, Info, Trash2, Loader2, Maximize2, Minimize2, Upload,
  ShieldCheck, UserCircle, RefreshCw, HardDrive, MapPin, FolderArchive, Building2, ChevronDown
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
import { useActiveCompany, setActiveCompany, isUploadedLogo, getCompanyUploadedLogo } from './services/companyService';
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

const App: React.FC = () => {
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
      case 'finance': return <Finance initialFilter={navigationFilter} onActionComplete={handleActionComplete} customLogo={customLogo} />;
      case 'vehicles': return <VehicleManagement initialFilter={navigationFilter} clearFilter={() => setNavigationFilter(null)} userRole={currentRole} userRoles={currentRoles} />;
      case 'available_vehicles': return <AvailableVehiclesView userRole={currentRole} />;
      case 'users': return <UserManagement />;
      case 'settings': return <AppSettings onReplaySplash={() => { setIsReplaySplashOnly(true); setShowSplash(true); }} />;
      default: return <Dashboard onNavigate={handleNavigate} />;
    }
  };

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
            if (lastLocationView && (lastLocationRole === payload.role || payload.role === UserRole.ADMIN) && lastLocationView !== 'settings') {
              targetView = lastLocationView;
            }

            setActiveView(targetView);
            safeAppStorage.setItem('dpl_user_role', payload.role);
            safeAppStorage.setItem('dpl_active_view', targetView);
            safeAppStorage.setItem('dpl_last_location_view', targetView);
            safeAppStorage.setItem('dpl_last_location_role', payload.role);
            safeAppStorage.setItem('dpl_session_active', 'true');
            setShowModeSelection(false);
            setShowCompanySelection(true);
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
          onSelectCompany={(selectedId) => {
            setActiveCompany(selectedId);
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
        <div className="h-screen h-[100dvh] min-h-[100dvh] max-h-[100dvh] w-full bg-slate-950 text-gray-100 font-sans overflow-hidden relative">
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
              onSelectCompany={(selectedId) => {
                setActiveCompany(selectedId);
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
      <div className="flex h-screen h-[100dvh] min-h-[100dvh] max-h-[100dvh] w-full bg-transparent text-gray-100 font-sans overflow-hidden relative">
        
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
        <div className="pt-3 pb-2.5 px-4 border-b border-white/10 flex items-center justify-between lg:hidden bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-300">
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
          className="p-3 mx-3 my-2.5 rounded-2xl bg-gradient-to-br from-amber-500/10 via-slate-900 to-black border border-amber-500/25 flex items-center gap-2.5 cursor-pointer hover:border-amber-400/50 transition-all group shadow-md shrink-0"
          title={`${activeCompany.name} Dashboard`}
        >
          <div className="w-9 h-9 rounded-xl bg-black/60 border border-amber-500/30 flex items-center justify-center p-1.5 shrink-0 group-hover:scale-105 transition-transform">
            <Logo variant="icon" className="max-h-full max-w-full object-contain" />
          </div>
          <div className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} min-w-0 flex-1`}>
            <h3 className="font-extrabold text-xs text-white group-hover:text-amber-300 transition-colors uppercase leading-tight truncate">
              {activeCompany.name}
            </h3>
            <p className="text-[9px] font-mono text-amber-400/90 tracking-wider uppercase truncate mt-0.5">
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
            className="w-full flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 transition-all text-xs font-bold cursor-pointer group shadow-sm active:scale-95"
            title="Switch Subsidiary / Company Workspace"
          >
            <div className="flex items-center gap-2 truncate">
              <Building2 size={14} className="text-amber-400 shrink-0" />
              <span className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} truncate text-[11px]`}>
                Switch Company
              </span>
            </div>
            <span className={`${!desktopSidebarExpanded ? 'lg:hidden' : ''} text-[9px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 font-bold uppercase font-mono`}>
              4 Entities
            </span>
          </button>
        </div>

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
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                activeView === item.id 
                  ? 'bg-brand-600/20 text-white border border-brand-500/20 shadow-lg shadow-brand-500/10' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              } ${!desktopSidebarExpanded && 'lg:justify-center'}`}
            >
              <item.icon size={20} className={`${activeView === item.id ? 'text-brand-400' : 'text-gray-500'} group-hover:text-white`} />
              <span className={`${!desktopSidebarExpanded && 'lg:hidden'} font-medium text-xs sm:text-sm`}>{item.label}</span>
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
        {/* Top Header - Exact Layout Requested:
            Left: Sidebar Menu Button
            Center: Company Logo (Centered Prominently - Uploaded from settings)
            Right: Notifications & LogOut (+ Compact Treasury)
        */}
        <header className="h-14 sm:h-16 bg-slate-900 border-b border-white/10 flex items-center justify-between px-2.5 sm:px-6 z-20 flex-shrink-0 sticky top-0 shadow-md">
          {/* Left: Sidebar Menu Toggle & Active View Title */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1 justify-start">
            <button 
              type="button"
              onClick={() => window.innerWidth < 1024 ? setMobileSidebarOpen(!mobileSidebarOpen) : setDesktopSidebarExpanded(!desktopSidebarExpanded)} 
              className="p-2 sm:p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-gray-300 hover:text-white border border-white/10 hover:border-amber-400/40 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
              title="Toggle Sidebar Menu"
            >
              <Menu size={19} className="text-amber-400" />
            </button>

            <span className="hidden sm:inline-flex px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono font-black text-xs shrink-0 shadow-sm">
              {activeCompany.prefix || activeCompany.shortName}
            </span>

            <div className="hidden md:flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-wider truncate">
                {activeView === 'dashboard' ? 'Overview' : activeView.replace('-', ' ')}
              </span>
            </div>
          </div>

          {/* Center: Company Logo Centered (Strictly uploaded logo from company settings) */}
          <div className="flex items-center justify-center min-w-0 flex-shrink-0 px-1 sm:px-2">
            <button
              type="button"
              id="header-center-company-logo-btn"
              onClick={() => setIsCompanyModalOpen(true)}
              className="flex items-center justify-center p-1 sm:px-3 sm:py-1.5 rounded-2xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all duration-200 cursor-pointer group shrink-0"
              title={`${activeCompany.name} (Click to switch company)`}
            >
              {activeUploadedLogo ? (
                <img 
                  src={activeUploadedLogo} 
                  alt={activeCompany.name} 
                  className="h-8 sm:h-10 w-auto max-w-[140px] sm:max-w-[220px] object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] group-hover:scale-105 transition-transform duration-200" 
                />
              ) : (
                <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-slate-800/90 border border-amber-500/30 group-hover:border-amber-400 text-amber-200 group-hover:text-white transition-all shadow-sm">
                  <Building2 size={15} className="text-amber-400 group-hover:scale-110 transition-transform shrink-0" />
                  <span className="font-extrabold text-xs sm:text-sm tracking-wide text-white group-hover:text-amber-300 transition-colors truncate max-w-[120px] sm:max-w-[180px]">
                    {activeCompany.name}
                  </span>
                  <ChevronDown size={13} className="text-amber-400/80 group-hover:translate-y-0.5 transition-transform shrink-0" />
                </div>
              )}
            </button>
          </div>

          {/* Right: Treasury Gold Widget, Notifications & LogOut */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 justify-end shrink-0">
            {/* Compact Sone se Amount / Treasury Widget */}
            <GoldenAmountWidget 
              onOpenFinance={() => setActiveView('finance')}
            />

            {/* Live Real-time Notification Center */}
            <LiveNotificationCenter
              currentRole={currentRole}
              currentRoles={currentRoles}
              userIdentifier={currentClientName || firebaseUser?.displayName || firebaseUser?.email || 'Admin'}
              clientName={currentClientName}
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

            {/* Squircle Sign Out Button with LogOut Logo */}
            <button
              type="button"
              id="header-signout-btn"
              onClick={handleSignOut}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/30 text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 flex items-center justify-center transition-all duration-200 shadow-sm active:scale-95 cursor-pointer flex-shrink-0"
              title="Sign Out"
            >
              <LogOut size={15} className="text-red-400" />
            </button>
          </div>
        </header>

        <div 
          id="main-scroll-container"
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 sm:p-6 pb-32 sm:pb-12 custom-scrollbar overscroll-y-auto"
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
            onSelectCompany={(selectedId) => {
              setActiveCompany(selectedId);
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


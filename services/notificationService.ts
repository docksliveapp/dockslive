import { AppNotification, UserRole } from '../types';
import { saveNotificationToFirestore } from './dbService';
import { getActiveCompanyId } from './companyService';

export interface CreateNotificationPayload {
  title: string;
  description: string;
  details: string;
  type?: 'ALERT' | 'APPROVAL' | 'INFO' | 'ACTION' | 'SUCCESS';
  notificationSubType?: AppNotification['notificationSubType'];
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  actionLabel?: string;
  targetRole: UserRole | string | (UserRole | string)[];
  targetClientName?: string;
  category?: 'CASE' | 'FINANCE' | 'TRANSPORTER' | 'CLIENT_REG' | 'SYSTEM' | 'APPROVAL' | 'GENERAL' | string;
  targetView?: 'cases' | 'finance' | 'transporter' | 'users' | 'vehicles' | string;
  targetFilter?: {
    caseId?: number | string;
    caseNo?: string;
    invoiceNo?: string;
    vehicleId?: string | number;
    vehicleNo?: string;
    tab?: string;
    stepId?: string;
    [key: string]: any;
  };
  performedBy?: string;
  approvalData?: AppNotification['approvalData'];
}

/**
 * Triggers a native system / browser notification on Desktop (Windows/macOS) or Mobile APK/PWA
 * when Notification permission is granted.
 */
export async function triggerNativeBrowserNotification(title: string, body: string, url: string = '/'): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    if (Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: '/pwa-192x192-v3.png',
          badge: '/pwa-192x192-v3.png',
          data: { url },
        });
        return;
      }
    }
    new Notification(title, {
      body,
      icon: '/pwa-192x192-v3.png',
    });
  } catch (_) {}
}

/**
 * Sends a real-time notification to Firestore so the target role/user
 * receives it immediately in their Live Notification Center.
 */
export async function sendAppNotification(payload: CreateNotificationPayload): Promise<AppNotification> {
  const rolesArray = Array.isArray(payload.targetRole) 
    ? payload.targetRole.map(r => String(r)) 
    : [String(payload.targetRole)];
  
  const primaryTargetRole = rolesArray.join(',');

  // Automatically tag with active company unless it's a shared fleet/transporter notification
  const isSharedFleet = payload.category === 'TRANSPORTER' || payload.targetView === 'transporter';

  const newNotif: AppNotification & { targetRoles?: string[]; companyId?: string } = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    title: payload.title,
    description: payload.description,
    details: payload.details,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: payload.type || 'INFO',
    notificationSubType: payload.notificationSubType || 'GENERAL',
    status: 'PENDING',
    actionLabel: payload.actionLabel || 'Open & Take Action',
    priority: payload.priority || 'HIGH',
    targetRole: primaryTargetRole,
    targetRoles: rolesArray,
    targetClientName: payload.targetClientName,
    category: payload.category || 'CASE',
    targetView: payload.targetView || 'cases',
    targetFilter: payload.targetFilter,
    approvalData: payload.approvalData,
    companyId: isSharedFleet ? undefined : getActiveCompanyId(),
  };

  try {
    await saveNotificationToFirestore(newNotif);
  } catch (err) {
    console.warn("Could not save notification to Firestore, stored locally:", err);
  }

  return newNotif;
}

import { AppNotification, UserRole } from '../types';
import { saveNotificationToFirestore } from './dbService';
import { logActivity } from './activityLogService';

export interface SendNotificationOptions {
  title: string;
  description: string;
  details?: string;
  targetRole?: UserRole | string; // 'ALL' or specific role enum/string
  targetClientName?: string; // If targeting a specific transporter or client
  targetView?: 'cases' | 'finance' | 'vehicles' | 'users' | 'dashboard' | string;
  targetFilter?: any;
  type?: 'ACTION' | 'INFO' | 'ALERT';
  notificationSubType?: AppNotification['notificationSubType'];
  status?: 'PENDING' | 'RESOLVED' | 'REJECTED';
  approvalData?: AppNotification['approvalData'];
  actionLabel?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  performedBy?: string;
  performedByRole?: string;
  category?: 'CASE' | 'FINANCE' | 'APPROVAL' | 'TRANSPORTER' | 'GENERAL';
}

/**
 * Sends a real-time notification to the targeted role (and automatically to Admin/Super Admin),
 * and simultaneously records an audit record in the system activity log.
 */
export async function sendAppNotification(opts: SendNotificationOptions): Promise<AppNotification> {
  const numericId = Date.now() + Math.floor(Math.random() * 10000);
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const notif: AppNotification = {
    id: numericId,
    title: opts.title,
    description: opts.description,
    details: opts.details || opts.description,
    timestamp: timeStr,
    type: opts.type || 'INFO',
    notificationSubType: opts.notificationSubType || 'GENERAL',
    status: opts.status || 'PENDING',
    approvalData: opts.approvalData,
    actionLabel: opts.actionLabel,
    priority: opts.priority || 'MEDIUM',
    targetRole: opts.targetRole || 'ALL',
    targetClientName: opts.targetClientName,
    targetView: opts.targetView,
    targetFilter: opts.targetFilter,
    category: opts.category || 'GENERAL',
    read: false
  };

  // 1. Save to Firestore notifications collection for real-time Live Notification Center
  try {
    await saveNotificationToFirestore(notif);
  } catch (err) {
    console.warn('Could not save notification to Firestore:', err);
  }

  // 2. Also log to central Activity Logs for the Admin Dashboard & Audit Trail
  try {
    const roleForLog = opts.performedByRole || (opts.targetRole ? String(opts.targetRole) : 'SYSTEM');
    const userForLog = opts.performedBy || 'System';
    await logActivity(
      opts.title,
      opts.description,
      roleForLog,
      userForLog,
      {
        targetRole: opts.targetRole,
        targetClientName: opts.targetClientName,
        targetView: opts.targetView,
        targetFilter: opts.targetFilter,
        category: opts.category
      }
    );
  } catch (err) {
    console.warn('Could not log activity:', err);
  }

  return notif;
}

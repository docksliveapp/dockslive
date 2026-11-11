/**
 * Firebase Cloud Function (v2) — Automatic Web Push Sender for MAK Group of Companies
 *
 * Triggers whenever a new notification or scheduled reminder document is created in
 * Firestore (`notifications/{notificationId}` on database `ai-studio-dockspvtltd-b10bca58-7d6c-491a-bb63-0ad3204161ea`),
 * resolves all target User IDs / Roles / Clients, collects their `fcmTokens` across mobile (Android TWA/PWA)
 * and Windows Desktop, and dispatches native OS push notifications via Firebase Admin Messaging.
 *
 * Deploy with:
 *   cd functions && npm install && firebase deploy --only functions
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

admin.initializeApp();

const DATABASE_ID = 'ai-studio-dockspvtltd-b10bca58-7d6c-491a-bb63-0ad3204161ea';
const APP_URL = process.env.MAK_PUBLIC_APP_URL || 'https://makpk.online';

function normalizeRole(role) {
  return String(role || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function userMatchesNotificationTarget(userData, notif) {
  if (!userData || userData.status === 'INACTIVE' || userData.status === 'SUSPENDED' || userData.isSuspended) {
    return false;
  }

  const userRoles = new Set(
    [userData.role, ...(Array.isArray(userData.roles) ? userData.roles : [])]
      .filter(Boolean)
      .map(normalizeRole)
  );

  const isAdmin = userRoles.has('ADMIN') || Boolean(userData.isAdmin);
  const targetClient = String(notif.targetClientName || '').trim().toLowerCase();

  // Client / Transporter / Vendor specific notification
  if (targetClient) {
    const userClient = String(userData.clientName || userData.name || '').trim().toLowerCase();
    if (userClient && (userClient === targetClient || userClient.includes(targetClient) || targetClient.includes(userClient))) {
      return true;
    }
  }

  // Staff-specific notification
  const targetStaffId = notif.approvalData && notif.approvalData.staffUserId
    ? String(notif.approvalData.staffUserId).trim().toLowerCase()
    : '';
  if (targetStaffId) {
    const uid = String(userData.userId || userData.id || '').trim().toLowerCase();
    if (uid && uid === targetStaffId) return true;
  }

  const rawTargets = Array.isArray(notif.targetRoles)
    ? notif.targetRoles
    : notif.targetRole
      ? (Array.isArray(notif.targetRole) ? notif.targetRole : [notif.targetRole])
      : ['ALL'];

  const normalizedTargets = rawTargets.map(normalizeRole).filter(Boolean);
  if (normalizedTargets.includes('ALL')) {
    return !userRoles.has('CLIENT') && !userRoles.has('TRANSPORTER') && !userRoles.has('VENDOR') && !userRoles.has('DRIVER');
  }

  for (const t of normalizedTargets) {
    if (userRoles.has(t)) return true;
    if ((t === 'VEHICLEMANAGER' || t === 'FLEETANDVEHICLEMANAGER') && userRoles.has('DOCUMENTATIONMANAGER')) {
      return true;
    }
  }

  // Admins receive operational, finance, and approval alerts unless strictly targeted only to an external client
  if (isAdmin && !normalizedTargets.every((t) => t === 'CLIENT' || t === 'TRANSPORTER' || t === 'VENDOR')) {
    return true;
  }

  return false;
}

exports.sendPushOnNotificationCreated = onDocumentCreated(
  {
    document: 'notifications/{notificationId}',
    database: DATABASE_ID,
    region: 'us-central1'
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const notif = snap.data();
    if (!notif || notif.status === 'RESOLVED' || notif.pushDispatchedByServer === true) {
      return;
    }

    const db = getFirestore(admin.app(), DATABASE_ID);
    const tokenSet = new Set();
    const tokenOwners = new Map();

    // 1. Gather matching users' fcmTokens array
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach((docSnap) => {
      const user = docSnap.data();
      if (!Array.isArray(user.fcmTokens) || user.fcmTokens.length === 0) return;
      if (user.pushNotificationsEnabled === false) return;
      if (userMatchesNotificationTarget(user, notif)) {
        for (const tk of user.fcmTokens) {
          if (typeof tk === 'string' && tk.length >= 20 && !tk.startsWith('local-browser-perm-')) {
            tokenSet.add(tk);
            if (!tokenOwners.has(tk)) tokenOwners.set(tk, []);
            tokenOwners.get(tk).push(docSnap.ref);
          }
        }
      }
    });

    // 2. Also gather from fcm_devices subscriptions
    const devicesSnap = await db.collection('fcm_devices').where('enabled', '==', true).get();
    devicesSnap.forEach((docSnap) => {
      const dev = docSnap.data();
      if (!dev || !dev.token || typeof dev.token !== 'string' || dev.token.startsWith('local-browser-perm-')) return;
      if (
        userMatchesNotificationTarget(
          {
            userId: dev.userId,
            name: dev.userName,
            role: dev.role,
            roles: dev.roles,
            clientName: dev.clientName,
            status: 'ACTIVE'
          },
          notif
        )
      ) {
        tokenSet.add(dev.token);
      }
    });

    const tokens = Array.from(tokenSet).slice(0, 500);
    if (tokens.length === 0) return;

    const title = String(notif.title || 'MAK Group of Companies').slice(0, 140);
    const body = String(notif.description || 'You have a new logistics alert or workflow task.').slice(0, 400);
    const caseNo = (notif.targetFilter && notif.targetFilter.caseNo) ? String(notif.targetFilter.caseNo) : '';
    const targetView = notif.targetView ? String(notif.targetView) : (caseNo ? 'cases' : 'dashboard');
    const deepLinkPath = caseNo
      ? `/?view=cases&caseNo=${encodeURIComponent(caseNo)}`
      : `/?view=${encodeURIComponent(targetView)}`;

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title,
        body
      },
      data: {
        title,
        body,
        url: deepLinkPath,
        caseNo,
        targetView,
        notificationId: String(event.params.notificationId || notif.id || ''),
        priority: String(notif.priority || 'MEDIUM')
      },
      webpush: {
        notification: {
          title,
          body,
          icon: `${APP_URL}/pwa-192x192-v3.png`,
          badge: `${APP_URL}/pwa-192x192-v3.png`,
          renotify: true,
          tag: `mak-notif-${event.params.notificationId}`
        },
        fcm_options: {
          link: `${APP_URL}${deepLinkPath}`
        }
      }
    });

    // Clean up expired / unregistered tokens automatically
    const staleTokens = [];
    response.responses.forEach((resItem, idx) => {
      if (!resItem.success && resItem.error) {
        const code = resItem.error.code || '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          staleTokens.push(tokens[idx]);
        }
      }
    });

    if (staleTokens.length > 0) {
      for (const badToken of staleTokens) {
        const refs = tokenOwners.get(badToken) || [];
        for (const ref of refs) {
          await ref.update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(badToken)
          }).catch(() => {});
        }
      }
    }
  }
);

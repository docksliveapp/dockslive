const crypto = require('node:crypto');
const fs = require('node:fs');

const DEFAULT_FIREBASE_PROJECT_ID = 'gen-lang-client-0130190709';
const DEFAULT_VAPID_PUBLIC_KEY =
  'BD47zgOxbdSbVr4nx0j3HVIEnLhotWl2PaSxlQ8R-EsMzzcc9qUH1jH3nUvBbJKGhXxAiS60HdOs5nDm-npzyM0';
const DEFAULT_VAPID_SUBJECT = 'mailto:arbab@mak-group.com.pk';

let cachedAccessToken = null;
let cachedAccessTokenExpiryMs = 0;

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf-8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(str) {
  const clean = String(str || '')
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padLen = (4 - (clean.length % 4)) % 4;
  return Buffer.from(clean + '='.repeat(padLen), 'base64');
}

function loadServiceAccountConfig() {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id || DEFAULT_FIREBASE_PROJECT_ID,
          clientEmail: parsed.client_email,
          privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
          tokenUri: parsed.token_uri || 'https://oauth2.googleapis.com/token'
        };
      }
    } catch (err) {
      console.warn('[FCM Sender] Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', err && err.message);
    }
  }

  const credPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (credPath && fs.existsSync(credPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      if (parsed && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id || DEFAULT_FIREBASE_PROJECT_ID,
          clientEmail: parsed.client_email,
          privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
          tokenUri: parsed.token_uri || 'https://oauth2.googleapis.com/token'
        };
      }
    } catch (err) {
      console.warn('[FCM Sender] Unable to read GOOGLE_APPLICATION_CREDENTIALS:', err && err.message);
    }
  }

  return null;
}

function loadVapidConfig() {
  const privateKey = (
    process.env.VAPID_PRIVATE_KEY ||
    process.env.FIREBASE_VAPID_PRIVATE_KEY ||
    ''
  ).trim();
  if (!privateKey) return null;

  const publicKey = (
    process.env.VITE_FIREBASE_VAPID_KEY ||
    process.env.VAPID_PUBLIC_KEY ||
    DEFAULT_VAPID_PUBLIC_KEY
  ).trim();

  const subject = (
    process.env.VAPID_SUBJECT ||
    process.env.FIREBASE_VAPID_SUBJECT ||
    DEFAULT_VAPID_SUBJECT
  ).trim();

  return { publicKey, privateKey, subject };
}

function createVapidAuthHeader(endpoint, vapidConfig) {
  const parsedUrl = new URL(endpoint);
  const audience = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  const pubBytes = base64UrlDecode(vapidConfig.publicKey);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('Invalid uncompressed P-256 VAPID public key');
  }

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(pubBytes.subarray(1, 33)),
    y: base64UrlEncode(pubBytes.subarray(33, 65)),
    d: base64UrlEncode(base64UrlDecode(vapidConfig.privateKey))
  };

  const ecPrivateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const headerB64 = base64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payloadB64 = base64UrlEncode(
    JSON.stringify({
      aud: audience,
      exp,
      sub: vapidConfig.subject
    })
  );

  const unsignedToken = `${headerB64}.${payloadB64}`;
  const sig = crypto.sign('sha256', Buffer.from(unsignedToken, 'utf-8'), {
    key: ecPrivateKey,
    dsaEncoding: 'ieee-p1363'
  });

  const jwt = `${unsignedToken}.${base64UrlEncode(sig)}`;
  return `vapid t=${jwt}, k=${base64UrlEncode(pubBytes)}`;
}

function encryptWebPushAes128Gcm(subscription, payloadBuffer) {
  const uaPublic = base64UrlDecode(subscription.keys.p256dh);
  const authSecret = base64UrlDecode(subscription.keys.auth);

  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf-8'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf-8'), 16)
  );
  const nonce = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf-8'), 12)
  );

  const paddedPlaintext = Buffer.concat([payloadBuffer, Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(paddedPlaintext), cipher.final(), cipher.getAuthTag()]);

  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0);
  const idLenBuf = Buffer.from([asPublic.length]);

  return Buffer.concat([salt, rsBuf, idLenBuf, asPublic, encrypted]);
}

async function sendRfc8291WebPushBatch(vapidConfig, subscriptions, payloadData) {
  const title = String(payloadData.title || 'MAK Group of Companies').slice(0, 140);
  const body = String(payloadData.body || 'New logistics update requires your attention.').slice(0, 400);
  const targetUrl = String(payloadData.url || '/');
  const icon = '/pwa-192x192-v3.png';

  const messageJson = JSON.stringify({
    fcmMessageId: `mak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    notification: {
      title,
      body,
      icon
    },
    data: {
      title,
      body,
      url: targetUrl,
      icon,
      badge: icon,
      notificationId: String(payloadData.notificationId || ''),
      caseNo: String(payloadData.caseNo || ''),
      targetView: String(payloadData.targetView || ''),
      priority: String(payloadData.priority || 'MEDIUM'),
      category: String(payloadData.category || 'GENERAL')
    }
  });

  const payloadBuf = Buffer.from(messageJson, 'utf-8');
  let sent = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return;
        const encryptedBody = encryptWebPushAes128Gcm(sub, payloadBuf);
        const authHeader = createVapidAuthHeader(sub.endpoint, vapidConfig);

        const resp = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            TTL: '86400',
            Urgency: payloadData.priority === 'HIGH' ? 'high' : 'normal'
          },
          body: encryptedBody
        });

        if (resp.ok || resp.status === 201) {
          sent += 1;
        }
      } catch (_) {}
    })
  );

  return { sent, invalidTokens: [] };
}

async function getGoogleOAuthAccessToken(saConfig) {
  const nowMs = Date.now();
  if (cachedAccessToken && cachedAccessTokenExpiryMs - 60000 > nowMs) {
    return cachedAccessToken;
  }

  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: saConfig.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: saConfig.tokenUri,
      iat,
      exp
    })
  );

  const unsignedJwt = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = base64UrlEncode(signer.sign(saConfig.privateKey));
  const assertion = `${unsignedJwt}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  }).toString();

  const resp = await fetch(saConfig.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OAuth2 token exchange failed (${resp.status}): ${errText.slice(0, 200)}`);
  }

  const tokenData = await resp.json();
  cachedAccessToken = tokenData.access_token;
  cachedAccessTokenExpiryMs = nowMs + Number(tokenData.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

async function sendFcmV1Batch(saConfig, tokens, payloadData) {
  const accessToken = await getGoogleOAuthAccessToken(saConfig);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${saConfig.projectId}/messages:send`;

  const title = String(payloadData.title || 'MAK Group of Companies').slice(0, 140);
  const body = String(payloadData.body || 'New logistics update requires your attention.').slice(0, 400);
  const targetUrl = String(payloadData.url || '/');
  const icon = '/pwa-192x192-v3.png';

  const stringData = {
    title,
    body,
    url: targetUrl,
    icon,
    badge: icon,
    notificationId: String(payloadData.notificationId || ''),
    caseNo: String(payloadData.caseNo || ''),
    targetView: String(payloadData.targetView || ''),
    priority: String(payloadData.priority || 'MEDIUM'),
    category: String(payloadData.category || 'GENERAL')
  };

  let sent = 0;
  const invalidTokens = [];

  await Promise.all(
    tokens.map(async (token) => {
      try {
        const messagePayload = {
          message: {
            token,
            notification: {
              title,
              body
            },
            data: stringData,
            android: {
              priority: payloadData.priority === 'HIGH' ? 'high' : 'normal',
              notification: {
                sound: 'default',
                clickAction: 'FLUTTER_NOTIFICATION_CLICK'
              }
            },
            webpush: {
              headers: {
                Urgency: payloadData.priority === 'HIGH' ? 'high' : 'normal'
              },
              notification: {
                title,
                body,
                icon,
                badge: icon,
                tag: stringData.notificationId ? `mak-notif-${stringData.notificationId}` : undefined,
                renotify: true
              },
              fcm_options: {
                link: targetUrl
              }
            }
          }
        };

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(messagePayload)
        });

        if (resp.ok) {
          sent += 1;
        } else {
          const errJson = await resp.json().catch(() => ({}));
          const errCode =
            (errJson &&
              errJson.error &&
              Array.isArray(errJson.error.details) &&
              errJson.error.details[0] &&
              errJson.error.details[0].errorCode) ||
            (errJson && errJson.error && errJson.error.status) ||
            '';
          if (errCode === 'UNREGISTERED' || errCode === 'NOT_FOUND' || errCode === 'INVALID_ARGUMENT') {
            invalidTokens.push(token);
          }
        }
      } catch (_) {}
    })
  );

  return { sent, invalidTokens };
}

async function sendFcmLegacyBatch(legacyServerKey, tokens, payloadData) {
  const title = String(payloadData.title || 'MAK Group of Companies').slice(0, 140);
  const body = String(payloadData.body || 'New logistics update requires your attention.').slice(0, 400);
  const targetUrl = String(payloadData.url || '/');
  const icon = '/pwa-192x192-v3.png';

  const resp = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      Authorization: `key=${legacyServerKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      registration_ids: tokens,
      priority: payloadData.priority === 'HIGH' ? 'high' : 'normal',
      notification: {
        title,
        body,
        icon,
        badge: icon,
        click_action: targetUrl
      },
      data: {
        title,
        body,
        url: targetUrl,
        icon,
        notificationId: String(payloadData.notificationId || ''),
        caseNo: String(payloadData.caseNo || ''),
        targetView: String(payloadData.targetView || ''),
        priority: String(payloadData.priority || 'MEDIUM')
      }
    })
  });

  if (!resp.ok) {
    return { sent: 0, invalidTokens: [] };
  }

  const data = await resp.json().catch(() => ({}));
  const invalidTokens = [];
  if (Array.isArray(data.results)) {
    data.results.forEach((r, idx) => {
      if (r && (r.error === 'NotRegistered' || r.error === 'InvalidRegistration') && tokens[idx]) {
        invalidTokens.push(tokens[idx]);
      }
    });
  }

  return {
    sent: Number(data.success || 0),
    invalidTokens
  };
}

function handlePushSendRequest(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const chunks = [];
  let totalBytes = 0;
  const MAX_BYTES = 512 * 1024;

  req.on('data', (chunk) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buf.length;
    if (totalBytes <= MAX_BYTES) {
      chunks.push(buf);
    }
  });

  req.on('end', async () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = JSON.parse(raw || '{}');
      const rawTokens = Array.isArray(body.tokens) ? body.tokens : [];
      const uniqueTokens = Array.from(
        new Set(
          rawTokens
            .map((t) => String(t || '').trim())
            .filter((t) => t.length >= 20 && !t.startsWith('local-browser-perm-'))
        )
      ).slice(0, 250);

      const rawSubscriptions = Array.isArray(body.subscriptions) ? body.subscriptions : [];
      const seenEndpoints = new Set();
      const uniqueSubscriptions = rawSubscriptions
        .filter((s) => {
          if (!s || typeof s.endpoint !== 'string' || !s.keys || !s.keys.p256dh || !s.keys.auth) {
            return false;
          }
          if (seenEndpoints.has(s.endpoint)) return false;
          seenEndpoints.add(s.endpoint);
          return true;
        })
        .slice(0, 250);

      if (uniqueTokens.length === 0 && uniqueSubscriptions.length === 0) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, sent: 0, total: 0, invalidTokens: [] }));
        return;
      }

      const saConfig = loadServiceAccountConfig();
      if (saConfig && uniqueTokens.length > 0) {
        const result = await sendFcmV1Batch(saConfig, uniqueTokens, body);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            mode: 'fcm-v1',
            configured: true,
            sent: result.sent,
            total: uniqueTokens.length,
            invalidTokens: result.invalidTokens
          })
        );
        return;
      }

      const vapidConfig = loadVapidConfig();
      if (vapidConfig && uniqueSubscriptions.length > 0) {
        const result = await sendRfc8291WebPushBatch(vapidConfig, uniqueSubscriptions, body);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            mode: 'vapid-webpush',
            configured: true,
            sent: result.sent,
            total: uniqueSubscriptions.length,
            invalidTokens: []
          })
        );
        return;
      }

      const legacyKey = (process.env.FCM_SERVER_KEY || '').trim();
      if (legacyKey && uniqueTokens.length > 0) {
        const result = await sendFcmLegacyBatch(legacyKey, uniqueTokens, body);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            mode: 'fcm-legacy',
            configured: true,
            sent: result.sent,
            total: uniqueTokens.length,
            invalidTokens: result.invalidTokens
          })
        );
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          ok: true,
          mode: 'client-realtime-bridge',
          configured: false,
          sent: 0,
          total: uniqueTokens.length + uniqueSubscriptions.length,
          invalidTokens: []
        })
      );
    } catch (err) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          ok: false,
          error: (err && err.message) || 'Push dispatch warning',
          invalidTokens: []
        })
      );
    }
  });
}

module.exports = {
  handlePushSendRequest
};

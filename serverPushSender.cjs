const crypto = require('node:crypto');
const fs = require('node:fs');

const DEFAULT_FIREBASE_PROJECT_ID = 'gen-lang-client-0130190709';

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

      if (uniqueTokens.length === 0) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, sent: 0, total: 0, invalidTokens: [] }));
        return;
      }

      const saConfig = loadServiceAccountConfig();
      if (saConfig) {
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

      const legacyKey = (process.env.FCM_SERVER_KEY || '').trim();
      if (legacyKey) {
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
          total: uniqueTokens.length,
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

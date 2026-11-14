
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN;

    if (request.method === "OPTIONS") {
      if (origin !== allowedOrigin) {
        return new Response(null, { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin)
      });
    }

    if (origin && origin !== allowedOrigin) {
      return json({ error: "Origin not allowed." }, 403);
    }

    const url = new URL(request.url);

    try {
      // Health check
      if (url.pathname === "/api/health" && request.method === "GET") {
        return withCors(json({ ok: true }), allowedOrigin);
      }

      // Login
      if (url.pathname === "/api/login" && request.method === "POST") {
        const body = await readJson(request, 4096);

        if (
          !body ||
          typeof body.password !== "string" ||
          !constantTimeEqual(body.password, env.EDITOR_PASSWORD)
        ) {
          return withCors(
            json({ error: "Incorrect password." }, 401),
            allowedOrigin
          );
        }

        const token = await createSessionToken(env);

        return withCors(
          json({ token, expiresIn: 8 * 60 * 60 }),
          allowedOrigin
        );
      }

      // Protect all remaining endpoints
      if (!(await verifySession(request, env))) {
        return withCors(
          json({
            error: "Authentication required or session expired."
          }, 401),
          allowedOrigin
        );
      }

      // Read JSON file
      if (url.pathname === "/api/json" && request.method === "GET") {
        const file = await driveRequest(
          env,
          `/files/${encodeURIComponent(env.DRIVE_FILE_ID)}?alt=media`
        );

        if (!file.ok) {
          throw new Error(
            `Google Drive read failed (${file.status}): ${await file.text()}`
          );
        }

        const data = await file.json();

        const metadata = await driveRequest(
          env,
          `/files/${encodeURIComponent(env.DRIVE_FILE_ID)}?fields=id,name,mimeType,modifiedTime`
        );

        const meta = metadata.ok ? await metadata.json() : {};

        return withCors(
          json({
            data,
            modifiedTime: meta.modifiedTime || null
          }),
          allowedOrigin
        );
      }

      // Update JSON file
      if (url.pathname === "/api/json" && request.method === "PUT") {
        const body = await readJson(request, 1024 * 1024);

        if (
          !body ||
          !Object.prototype.hasOwnProperty.call(body, "data")
        ) {
          return withCors(
            json({
              error: "Request must contain a data property."
            }, 400),
            allowedOrigin
          );
        }

        const serialized = JSON.stringify(body.data);

        if (serialized === undefined) {
          return withCors(
            json({
              error: "Value cannot be serialized as JSON."
            }, 400),
            allowedOrigin
          );
        }

        if (
          new TextEncoder().encode(serialized).byteLength >
          900 * 1024
        ) {
          return withCors(
            json({
              error: "JSON document is too large (maximum 900 KB)."
            }, 413),
            allowedOrigin
          );
        }

        // 1. Create backup BEFORE modifying original file
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-");

        const backupName =
          `${env.BACKUP_PREFIX || "json-backup"}-${timestamp}.json`;

        const copyResponse = await driveRequest(
          env,
          `/files/${encodeURIComponent(env.DRIVE_FILE_ID)}/copy?fields=id,name`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: backupName
            })
          }
        );

        if (!copyResponse.ok) {
          throw new Error(
            `Backup creation failed (${copyResponse.status}): ${await copyResponse.text()}. Original file was not changed.`
          );
        }

        const backup = await copyResponse.json();

        // 2. Update original file ONLY after backup succeeds
        const accessToken = await getGoogleAccessToken(env);

        const updateResponse = await fetch(
          `${DRIVE_UPLOAD}/files/${encodeURIComponent(env.DRIVE_FILE_ID)}?uploadType=media`,
          {
            method: "PATCH",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json; charset=UTF-8"
            },
            body: serialized
          }
        );

        if (!updateResponse.ok) {
          throw new Error(
            `Backup ${backup.name} was created, but saving failed (${updateResponse.status}): ${await updateResponse.text()}`
          );
        }

        return withCors(
          json({
            ok: true,
            backupName: backup.name,
            backupId: backup.id
          }),
          allowedOrigin
        );
      }

      return withCors(
        json({ error: "Not found." }, 404),
        allowedOrigin
      );

    } catch (error) {
      return withCors(
        json({
          error: error.message || "Internal server error."
        }, 500),
        allowedOrigin
      );
    }
  }
};

// ------------------------------------
// CORS
// ------------------------------------

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    headers.set(key, value);
  }

  headers.set("Cache-Control", "no-store");

  return new Response(response.body, {
    status: response.status,
    headers
  });
}

// ------------------------------------
// JSON HELPERS
// ------------------------------------

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function readJson(request, maxBytes) {
  const raw = await request.text();

  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new Error("Request body is too large.");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

// ------------------------------------
// SECURITY / SESSION
// ------------------------------------

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

function b64url(bytes) {
  let binary = "";

  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  return crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
}

async function createSessionToken(env) {
  const expires =
    Math.floor(Date.now() / 1000) + 8 * 60 * 60;

  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({ exp: expires })
    )
  );

  const signature = b64url(
    await hmac(payload, env.SESSION_SECRET)
  );

  return `${payload}.${signature}`;
}

async function verifySession(request, env) {
  const header = request.headers.get("Authorization") || "";

  if (!header.startsWith("Bearer ")) {
    return false;
  }

  const token = header.slice(7);
  const parts = token.split(".");

  if (parts.length !== 2) {
    return false;
  }

  const expected = b64url(
    await hmac(parts[0], env.SESSION_SECRET)
  );

  if (!constantTimeEqual(parts[1], expected)) {
    return false;
  }

  try {
    const base64 = parts[0]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const payload = JSON.parse(atob(base64));

    return (
      Number.isInteger(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

// ------------------------------------
// GOOGLE OAUTH 2.0
// ------------------------------------

async function getGoogleAccessToken(env) {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN
  ) {
    throw new Error(
      "Missing Google OAuth secrets. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN."
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });

  const result = await response.json();

  if (!response.ok || !result.access_token) {
    throw new Error(
      `Google OAuth failed: ${
        result.error_description ||
        result.error ||
        response.status
      }`
    );
  }

  return result.access_token;
}

// ------------------------------------
// GOOGLE DRIVE API
// ------------------------------------

async function driveRequest(env, path, options = {}) {
  const accessToken = await getGoogleAccessToken(env);

  return fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Authorization": `Bearer ${accessToken}`
    }
  });
}

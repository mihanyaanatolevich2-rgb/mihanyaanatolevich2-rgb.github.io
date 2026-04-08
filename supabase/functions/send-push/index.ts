import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---- Web Push with Web Crypto (Deno-compatible) ----

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function createVapidAuthHeader(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  subject: string
) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud, exp, sub: subject };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import private key
  const privateKeyBytes = base64UrlDecode(vapidPrivateKey);
  const publicKeyBytes = base64UrlDecode(vapidPublicKey);

  // Build JWK for P-256
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(publicKeyBytes.slice(1, 33)),
    y: base64UrlEncode(publicKeyBytes.slice(33, 65)),
    d: base64UrlEncode(privateKeyBytes),
  };

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER-like WebCrypto signature (r||s raw) to base64url
  const sigB64 = base64UrlEncode(signature);
  const jwt = `${unsignedToken}.${sigB64}`;

  return {
    authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
  };
}

// Encrypt payload using WebCrypto (RFC 8291 + RFC 8188)
async function encryptPayload(
  p256dhKey: string,
  authSecret: string,
  payload: string
): Promise<{ body: Uint8Array; salt: Uint8Array; localPublicKey: Uint8Array }> {
  const userPublicKeyBytes = base64UrlDecode(p256dhKey);
  const userAuth = base64UrlDecode(authSecret);
  const payloadBytes = new TextEncoder().encode(payload);

  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const localPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeyPair.publicKey)
  );

  // Import user's public key
  const userKey = await crypto.subtle.importKey(
    "raw",
    userPublicKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Derive shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: userKey },
      localKeyPair.privateKey,
      256
    )
  );

  // Generate salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF helper
  async function hkdf(
    ikm: Uint8Array,
    saltBytes: Uint8Array,
    info: Uint8Array,
    length: number
  ): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", ikm, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const prk = new Uint8Array(await crypto.subtle.sign("HMAC", key, saltBytes));
    // Actually: PRK = HMAC(salt, IKM)
    const prkKey = await crypto.subtle.importKey("raw", saltBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const prkVal = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, ikm));

    const infoWithCounter = new Uint8Array(info.length + 1);
    infoWithCounter.set(info);
    infoWithCounter[info.length] = 1;
    const okm_key = await crypto.subtle.importKey("raw", prkVal, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const okm = new Uint8Array(await crypto.subtle.sign("HMAC", okm_key, infoWithCounter));
    return okm.slice(0, length);
  }

  // Build info strings per RFC 8291
  function createInfo(type: string, clientPublic: Uint8Array, serverPublic: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type);
    const len = 18 + typeBytes.length + 1 + 5 + 2 + clientPublic.length + 2 + serverPublic.length;
    const info = new Uint8Array(len);
    let offset = 0;
    const header = new TextEncoder().encode("WebPush: info\0");
    info.set(header, offset); offset += header.length;
    info.set(clientPublic, offset); offset += clientPublic.length;
    info.set(serverPublic, offset); offset += serverPublic.length;
    return info;
  }

  // IKM
  const authInfo = new TextEncoder().encode("WebPush: info\0");
  const authInfoFull = new Uint8Array(authInfo.length + userPublicKeyBytes.length + localPublicKeyRaw.length);
  authInfoFull.set(authInfo);
  authInfoFull.set(userPublicKeyBytes, authInfo.length);
  authInfoFull.set(localPublicKeyRaw, authInfo.length + userPublicKeyBytes.length);

  const ikm = await hkdf(sharedSecret, userAuth, authInfoFull, 32);

  // CEK and nonce info
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");

  const cek = await hkdf(ikm, salt, cekInfo, 16);
  const nonce = await hkdf(ikm, salt, nonceInfo, 12);

  // Pad payload (1 byte delimiter + optional padding)
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2; // delimiter

  // Encrypt with AES-128-GCM
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, paddedPayload)
  );

  // Build aes128gcm content coding header
  const recordSize = encrypted.length;
  const header2 = new Uint8Array(16 + 4 + 1 + localPublicKeyRaw.length);
  header2.set(salt, 0);
  new DataView(header2.buffer).setUint32(16, recordSize + 16 + 4 + 1 + localPublicKeyRaw.length, false);
  header2[20] = localPublicKeyRaw.length;
  header2.set(localPublicKeyRaw, 21);

  const body = new Uint8Array(header2.length + encrypted.length);
  body.set(header2);
  body.set(encrypted, header2.length);

  return { body, salt, localPublicKey: localPublicKeyRaw };
}

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string
) {
  const vapidHeaders = await createVapidAuthHeader(
    subscription.endpoint,
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject
  );

  const { body } = await encryptPayload(subscription.p256dh, subscription.auth, payload);

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      ...vapidHeaders,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Urgency: "high",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    const err: any = new Error(`Push failed: ${response.status} ${text}`);
    err.statusCode = response.status;
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, title, body, conversation_id } = await req.json();

    if (!user_id || !title) {
      return new Response(JSON.stringify({ error: "user_id and title required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", user_id);

    if (error) {
      console.error("Error fetching subscriptions:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payloadStr = JSON.stringify({
      title,
      body: body || "",
      data: { conversation_id: conversation_id || null },
    });

    let sent = 0;
    const errors: string[] = [];

    for (const sub of subscriptions) {
      try {
        await sendWebPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payloadStr,
          vapidPublicKey,
          vapidPrivateKey,
          "mailto:push@bridge-and-call.lovable.app"
        );
        sent++;
      } catch (err: any) {
        console.error("Push failed for endpoint:", sub.endpoint, err.message);
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
        errors.push(err.message);
      }
    }

    return new Response(JSON.stringify({ sent, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

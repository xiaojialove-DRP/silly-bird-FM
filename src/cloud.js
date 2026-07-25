// ---- cloud: the anonymous identity, and every read/write that leaves this browser ----
// Split out of main.js because this is infrastructure with a real boundary, and
// because it is the subtlest code in the project: the failure modes here are silent
// by nature (a write that returns 200 but never lands, an identity quietly swapped
// for a new one) and they cost days to track down once.
//
// Everything here is deliberately DOM-free. It reports problems by throwing tagged
// errors — err.noSession, err.blocked, err.httpStatus — and lets main.js decide what
// a person should be told, because the same failure reads differently depending on
// whether you were sharing, revoking or just sending a stamp.

import { t } from "./i18n.js";

// ---- cloud config lives in src/cloud-config.js (gitignored; copy cloud-config.example.js) ----
export const CLOUD = window.SBFM_CLOUD || { url: "", anonKey: "", bucket: "stations" };

// ---- anonymous auth: each browser gets its own silent, real (if anonymous)
// identity, so writes can be scoped to "whoever created this" instead of every
// visitor sharing one all-powerful key. Reads stay on the bare anon key always —
// listening must stay public and must never need an identity.
//
// This identity is load-bearing: it is the only proof a browser owns the stations
// it has shared. Lose it and those stations are readable forever but editable never
// again, which is why the paths below go out of their way not to throw one away.
// It is also claimed lazily, only when something actually needs to write — sign-ins
// are rate limited for the whole project, and spending them on listeners would
// starve the people trying to create.
let anonSessionPromise = null;
let anonRetryAfter = 0;
function loadCachedSession() {
  try { return JSON.parse(localStorage.getItem("sbfm-auth") || "null"); } catch { return null; }
}
function saveSession(session) {
  try { localStorage.setItem("sbfm-auth", JSON.stringify(session)); } catch {}
}
const sessionIsFresh = (s) => !!(s && s.access_token && s.expires_at && s.expires_at * 1000 > Date.now() + 60000);
async function signUpAnon() {
  const r = await fetch(`${CLOUD.url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: CLOUD.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const session = await r.json();
  if (!session.access_token) throw new Error("no access_token in response");
  saveSession(session);
  return session.access_token;
}
export function ensureAnonSession() {
  // storage is the source of truth and costs nothing to read, so consult it on
  // every call rather than resolving once at boot. An access token lasts about an
  // hour and this is a radio — the tab stays open far longer than that — so a
  // session settled at load time is routinely dead by the time anyone shares.
  const cached = loadCachedSession();
  if (sessionIsFresh(cached)) return Promise.resolve(cached.access_token);
  if (anonSessionPromise) return anonSessionPromise;   // one attempt in flight at a time
  // a failed attempt should not turn every later write into another round trip
  if (Date.now() < anonRetryAfter) return Promise.resolve(null);
  const attempt = (async () => {
    try {
      // no identity yet — nothing to protect, just take one
      if (!cached || !cached.refresh_token) return await signUpAnon();

      const r = await fetch(`${CLOUD.url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: CLOUD.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: cached.refresh_token }),
      });
      if (r.ok) { const session = await r.json(); saveSession(session); return session.access_token; }

      // a second tab racing this one would have rotated the refresh token out from
      // under us and written the winner to storage — that reads as a rejection here,
      // so re-check storage before concluding the identity is actually dead
      const latest = loadCachedSession();
      if (sessionIsFresh(latest) && latest.access_token !== cached.access_token) return latest.access_token;

      // the refresh token is genuinely dead, so this identity can never prove
      // ownership again no matter what we keep. Signing up is the only way back to a
      // usable state, but stash the old one first: everything this browser already
      // shared is owned by it, and that record is the only trace of why those
      // stations suddenly became read-only.
      try { localStorage.setItem("sbfm-auth-lost", JSON.stringify({ at: new Date().toISOString(), session: cached })); } catch {}
      return await signUpAnon();
    } catch (e) {
      // a network-level failure says nothing about whether the identity is still
      // good — replacing it here would silently orphan every station this browser
      // has ever shared, so keep it and let a later attempt retry the refresh
      console.warn("anonymous session unavailable right now, identity preserved:", e);
      anonRetryAfter = Date.now() + 60000;
      return null;
    }
  })();
  anonSessionPromise = attempt;
  // release the slot once settled, so a token that expires later in this same page
  // session can still be renewed instead of being stuck on the first result forever
  attempt.finally(() => { if (anonSessionPromise === attempt) anonSessionPromise = null; });
  return attempt;
}
export async function cloudPut(path, blob) {
  const token = await ensureAnonSession();
  // writing requires a real identity: the policies only grant insert/update to a
  // signed-in role, so retrying with the bare public key cannot succeed — it just
  // comes back as an RLS rejection, which reads as "this is not yours" and sends
  // everyone hunting for an ownership problem that does not exist
  if (!token) { const err = new Error("no anonymous session available"); err.noSession = true; throw err; }
  const r = await fetch(`${CLOUD.url}/storage/v1/object/${CLOUD.bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, apikey: CLOUD.anonKey,
      "x-upsert": "true",   // re-sharing reuses the same path on purpose — must overwrite, not conflict
      "Content-Type": blob.type || "application/octet-stream",
    },
    body: blob,
  });
  if (!r.ok) {
    // Supabase answers an RLS-blocked storage write with 400, and hides the real
    // reason in the body: {"statusCode":"403","message":"new row violates row-level
    // security policy"}. The status alone cannot tell "this is not yours" apart from
    // "this request was malformed", so read the body and tag the error accordingly —
    // throwing away that body is what made this failure unreadable for days.
    let detail = "";
    try { detail = await r.text(); } catch {}
    const err = new Error("HTTP " + r.status + (detail ? " · " + detail.slice(0, 200) : ""));
    err.httpStatus = r.status;
    err.blocked = /row-level security|Unauthorized/i.test(detail);
    throw err;
  }
}
// ---- lightweight, privacy-respecting error signal: no third-party analytics, no
// per-user identity, just enough to know something broke. Filed anonymously into
// the same bucket everything else already writes to — best-effort only, and must
// never itself become a source of user-visible failure. Shares the same
// require-a-session behavior as every other write, so a failure in establishing
// the session itself can't self-report — an accepted, narrow blind spot rather
// than a reason to give error reports their own more-open policy.
export function reportError(context, error) {
  console.warn(`[${context}]`, error);
  try {
    const payload = {
      context,
      message: (error && error.message) ? error.message : String(error),
      stack: (error && error.stack) ? String(error.stack).slice(0, 800) : "",
      at: new Date().toISOString(),
    };
    const fname = `${todayStr()}_${Math.random().toString(36).slice(2, 8)}.json`;
    cloudPut(`errors/${fname}`, new Blob([JSON.stringify(payload)], { type: "application/json" })).catch(() => {});
  } catch {}
}
window.addEventListener("error", (e) => reportError("uncaught", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => reportError("unhandledrejection", e.reason));

export function cloudList(prefix) {
  return fetch(`${CLOUD.url}/storage/v1/object/list/${CLOUD.bucket}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CLOUD.anonKey}`, apikey: CLOUD.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 100 }),
  }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
}
export async function cloudDelete(paths) {
  const token = await ensureAnonSession();
  // same as cloudPut: without an identity this is guaranteed to be refused, and the
  // refusal is indistinguishable from "someone else owns this"
  if (!token) { const err = new Error("no anonymous session available"); err.noSession = true; throw err; }
  return fetch(`${CLOUD.url}/storage/v1/object/${CLOUD.bucket}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, apikey: CLOUD.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  }).then(async (r) => {
    if (!r.ok) {
      const err = new Error("HTTP " + r.status);
      err.httpStatus = r.status;
      throw err;
    }
    const deleted = await r.json();
    // Supabase answers 200 with an empty array (not a 403) when RLS blocks a
    // delete — "asked to delete N, deleted 0" is the real failure signal here.
    // Tagged on the error object (not just baked into the translated message)
    // so callers can detect "blocked, not just broken" without matching text.
    if (paths.length && !deleted.length) {
      const err = new Error(t("cloudDeleteBlocked"));
      err.blocked = true;
      throw err;
    }
    return deleted;
  });
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

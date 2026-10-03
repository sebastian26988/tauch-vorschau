// Anbindung an das Tauchlogbuch (Supabase): Anmeldung und Tauchplätze lesen – nur lesend.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const SITES_CACHE_KEY = 'tbv.logbook.sites';

let clientPromise = null;

// SDK erst laden, wenn das Logbuch gebraucht wird – die App startet ohne diesen Umweg
function client() {
  clientPromise ??= import(SDK_URL)
    .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }))
    .catch((err) => {
      clientPromise = null;
      throw err;
    });
  return clientPromise;
}

// Gibt es eine gespeicherte Sitzung? Prüft ohne SDK, damit Nutzer ohne Logbuch nichts nachladen
export function hasStoredSession() {
  try {
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    return !!localStorage.getItem(`sb-${ref}-auth-token`);
  } catch {
    return false;
  }
}

export async function getUser() {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export async function sendCode(email) {
  const sb = await client();
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    // Das Logbuch hat genau einen Nutzer – hier werden keine Konten angelegt
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

export async function verifyCode(email, code) {
  const sb = await client();
  const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.replace(/\s/g, ''), type: 'email' });
  if (error) throw error;
}

export async function signInWithPassword(email, password) {
  const sb = await client();
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
  try {
    localStorage.removeItem(SITES_CACHE_KEY);
  } catch {
    // egal
  }
}

const SEE_BODIES = new Set(['lake', 'quarry', 'reservoir', 'river', 'cenote']);
const MEER_BODIES = new Set(['sea', 'ocean']);

// Meer oder See: Gewässertyp ist das verlässlichste Signal, sonst Wasserart/Platztyp
export function spotTypeFor(site) {
  const body = site.water_bodies?.body_type;
  if (MEER_BODIES.has(body)) return 'meer';
  if (SEE_BODIES.has(body)) return 'see';
  if (site.water_type === 'salt' || site.water_type === 'brackish') return 'meer';
  if (site.water_type === 'fresh') return 'see';
  return ['lake', 'quarry', 'river'].includes(site.site_type) ? 'see' : 'meer';
}

const isPool = (site) => site.site_type === 'pool' || site.water_bodies?.body_type === 'pool';

function normalizeSite(site) {
  return {
    id: site.id,
    name: site.name,
    lat: site.latitude,
    lon: site.longitude,
    type: spotTypeFor(site),
    country: site.country_code ?? '',
    region: [site.locality, site.region].filter(Boolean).join(', '),
    water: site.water_bodies?.name ?? site.water_body ?? '',
    maxDepth: site.max_depth_m ?? null,
  };
}

export function cachedSites() {
  try {
    return JSON.parse(localStorage.getItem(SITES_CACHE_KEY))?.sites ?? null;
  } catch {
    return null;
  }
}

/** Alle Tauchplätze mit Koordinaten, ohne Hallenbäder. Fällt offline auf den letzten Stand zurück. */
export async function fetchSites() {
  try {
    const sb = await client();
    const { data, error } = await sb
      .from('dive_sites')
      .select('id, name, country_code, region, locality, latitude, longitude, water_type, site_type, water_body, max_depth_m, water_bodies(name, body_type)')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('name');
    if (error) throw error;
    const sites = data.filter((s) => !isPool(s)).map(normalizeSite);
    try {
      localStorage.setItem(SITES_CACHE_KEY, JSON.stringify({ ts: Date.now(), sites }));
    } catch {
      // ohne Offline-Kopie weiter
    }
    return sites;
  } catch (err) {
    const cached = cachedSites();
    if (cached) return cached;
    throw err;
  }
}

/** Übernimmt Name, Position und Typ aus dem Logbuch in einen verknüpften Spot; lokale Einstellungen bleiben. */
export function applySite(spot, site) {
  return { ...spot, name: site.name, lat: site.lat, lon: site.lon, type: spot.typeLocked ? spot.type : site.type, source: 'logbuch', logbookId: site.id };
}

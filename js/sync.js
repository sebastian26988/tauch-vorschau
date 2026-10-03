// Plätze und Grenzwerte zwischen Geräten abgleichen – über die Tabelle vorschau_einstellungen im
// Logbuch-Projekt, mit dem Logbuch-Konto. Ohne Anmeldung bleibt alles wie bisher nur im Browser.
//
// Ein Dokument je Nutzer, zuletzt geschrieben gewinnt – mit einer Ausnahme: Haben seit dem letzten
// Abgleich beide Seiten geändert (Handy offline, PC online), werden die Plätze zusammengeführt
// statt einer Seite verworfen. Gleiche Plätze nimmt dieses Gerät, neue von beiden Seiten bleiben.

import { client, hasStoredSession } from './logbook.js';
import { CHANGED_AT_KEY } from './spots.js';

const TABLE = 'vorschau_einstellungen';
const SYNCED_AT_KEY = 'tbv.sync.syncedAt';

const isEmpty = (local) => !local.spots?.length && !Object.keys(local.settings?.thresholds ?? {}).length;

/** Zwei Platzlisten vereinen: lokal gewinnt bei gleicher ID oder gleichem Logbuch-Platz. */
export function mergeSpots(local, remote) {
  const ids = new Set(local.map((s) => s.id));
  const linked = new Set(local.filter((s) => s.logbookId).map((s) => s.logbookId));
  return local.concat(remote.filter((s) => !ids.has(s.id) && !(s.logbookId && linked.has(s.logbookId))));
}

/**
 * Was ist zu tun? Reine Entscheidung ohne Netz.
 * local: { spots, settings }, remote: { spots, settings, updated_at } | null
 * changedAt / syncedAt: Zeitstempel (ms) der letzten eigenen Änderung bzw. des letzten Abgleichs
 * Liefert { action: 'none'|'push'|'pull'|'merge', spots?, settings? }
 */
export function decide(local, remote, changedAt, syncedAt) {
  if (!remote) return isEmpty(local) ? { action: 'none' } : { action: 'push' };
  const remoteAt = Date.parse(remote.updated_at);
  const remoteNewer = syncedAt == null || remoteAt > syncedAt;
  // Noch nie abgeglichen: Was hier liegt, ist eine eigene Änderung, sofern überhaupt etwas da ist
  const localDirty = syncedAt == null ? !isEmpty(local) : changedAt != null && changedAt > syncedAt;
  if (!localDirty && !remoteNewer) return { action: 'none' };
  if (!localDirty) return { action: 'pull', spots: remote.spots, settings: remote.settings };
  if (!remoteNewer) return { action: 'push' };
  return { action: 'merge', spots: mergeSpots(local.spots ?? [], remote.spots ?? []), settings: local.settings };
}

function readNum(key) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeNum(key, v) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // ohne Merker – dann gleicht der nächste Start eben noch einmal ab
  }
}

// Fehlt die Tabelle (noch), ist der Abgleich schlicht aus – kein Fehler für den Nutzer
const tableMissing = (err) => err?.code === '42P01' || err?.code === 'PGRST205' || /does not exist|schema cache/i.test(err?.message ?? '');

/**
 * Startet den Abgleich. getLocal() liefert { spots, settings }, applyRemote({ spots, settings })
 * übernimmt einen fremden Stand, onStatus(text) meldet den Zustand für die Einstellungen.
 */
export function startSync({ getLocal, applyRemote, onStatus = () => {} }) {
  let timer = null;
  let running = null;
  let disabled = false;

  async function push(sb, userId, local) {
    const { data, error } = await sb.from(TABLE)
      .upsert({ user_id: userId, spots: local.spots, settings: local.settings }, { onConflict: 'user_id' })
      .select('updated_at')
      .single();
    if (error) throw error;
    writeNum(SYNCED_AT_KEY, Date.parse(data.updated_at));
  }

  async function run() {
    if (disabled || !hasStoredSession()) {
      onStatus(disabled ? null : 'aus – nicht beim Logbuch angemeldet');
      return;
    }
    try {
      const sb = await client();
      const { data: sess } = await sb.auth.getSession();
      const userId = sess.session?.user?.id;
      if (!userId) return onStatus('aus – nicht beim Logbuch angemeldet');
      const { data: remote, error } = await sb.from(TABLE).select('spots, settings, updated_at').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      const local = getLocal();
      const plan = decide(local, remote, readNum(CHANGED_AT_KEY), readNum(SYNCED_AT_KEY));
      if (plan.action === 'pull') {
        applyRemote({ spots: plan.spots, settings: plan.settings });
        writeNum(SYNCED_AT_KEY, Date.parse(remote.updated_at));
      } else if (plan.action === 'merge') {
        applyRemote({ spots: plan.spots, settings: plan.settings });
        await push(sb, userId, { spots: plan.spots, settings: plan.settings });
      } else if (plan.action === 'push') {
        await push(sb, userId, local);
      }
      onStatus(`an – zuletzt ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr abgeglichen`);
    } catch (err) {
      if (tableMissing(err)) {
        disabled = true;
        onStatus(null);
        return;
      }
      onStatus('gerade nicht möglich – offline? Wird beim nächsten Start nachgeholt.');
    }
  }

  // Nacheinander, nie zwei Läufe gleichzeitig
  function syncNow() {
    running = (running ?? Promise.resolve()).then(run, run);
    return running;
  }

  globalThis.addEventListener?.('tbv:changed', () => {
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  });
  globalThis.addEventListener?.('online', syncNow);
  document.addEventListener?.('visibilitychange', () => document.visibilityState === 'visible' && syncNow());

  syncNow();
  return { syncNow };
}

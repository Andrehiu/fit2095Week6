// Storage adapters: the same game runs against the Express API (local / deployed server)
// or, when hosted as a claude.ai Artifact, against the artifact's shared `db` store.

/** Built-in catalogue, replaced at build time for the standalone phone build. */
export const BUILTIN_CONTENT = globalThis.__OVERDUE_CATALOGUE__ || null;

const NAME_RE = /^[A-Za-z0-9 _-]{1,12}$/;

/** Express backend: /api/game/content and /api/scores (see routes/game.js). */
function httpBackend() {
  return {
    kind: 'server',
    async content() {
      const r = await fetch('/api/game/content');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    async top(limit = 10) {
      const r = await fetch(`/api/scores?limit=${limit}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    async submit(payload) {
      const r = await fetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Server said ${r.status}`);
      return { rank: data.rank, message: `Filed! You rank #${data.rank} in the Hall of Fame.` };
    },
  };
}

/**
 * Artifact backend: one document per player at scores/<viewer id> holding their personal best.
 * Rules (declared at publish): everyone reads `scores`, each viewer writes only their own doc.
 */
function artifactBackend() {
  let dbP = null, userP = null;
  const db = () => (dbP ||= window.claude.use('db'));
  const user = () => (userP ||= window.claude.use('user'));
  const scores = async () => {
    const d = await db();
    if (!d) throw new Error('Sign in to claude.ai to see the shared Hall of Fame.');
    return d.collection('scores');
  };
  const clean = (doc) => {
    const v = doc.data() || {};
    return { name: NAME_RE.test(String(v.name)) ? v.name : 'Anonymous', score: Number(v.score) || 0, wave: Number(v.wave) || 1, kills: Number(v.kills) || 0 };
  };
  return {
    kind: 'artifact',
    async content() { return null; },
    async top(limit = 10) {
      const snap = await (await scores()).orderBy('score', 'desc').limit(limit).get();
      return snap.docs.map(clean);
    },
    async submit(payload) {
      const col = await scores();
      const u = await user();
      const id = u && (await u.id());
      if (!id) throw new Error('Sign in to claude.ai to sign the shared logbook.');
      const ref = col.doc(id);
      const prev = await ref.get();
      const best = prev.exists ? Number(prev.data().score) || 0 : -1;
      let saved = false;
      if (payload.score > best) {
        try {
          await ref.set({ ...payload, at: Date.now() });
          saved = true;
        } catch (e) {
          const code = e && e.code;
          if (code === 'permission_denied' || code === 'not_granted') throw new Error('Only people with Contributor access can sign this logbook. Your best is saved on this device.');
          throw new Error((e && e.message) || 'The logbook could not be saved.');
        }
      }
      const mine = saved ? payload.score : best;
      const higher = await col.where('score', '>', mine).limit(1000).get();
      const rank = higher.size + 1;
      return { rank, message: saved ? `Filed! You rank #${rank} in the Hall of Fame.` : `Your best (${mine.toLocaleString()}) still stands at #${rank}.` };
    },
  };
}

export function createBackend() {
  return typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function' ? artifactBackend() : httpBackend();
}

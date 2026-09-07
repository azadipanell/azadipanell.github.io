// SHAHYAD · "پیشنهادات و انتقادات" API — Cloudflare Pages Function
// Storage: D1 (binding FEEDBACK_DB). Falls back to a read-only demo when the binding is missing,
// so the static site keeps working on GitHub Pages / local previews.
//
//   GET  /api/feedback?limit=30&cursor=<id>   → approved entries (newest first) + featured (top-liked)
//   POST /api/feedback  {name, kind, text, hp, t}   → creates a PENDING entry (moderated) — returns {ok, id}
//   POST /api/feedback?like=<id>                    → +1 like (one per visitor per entry, cookie-less: IP+UA hash, 24h)
//
// Moderation (no dashboard needed): entries with status='pending' become visible when an admin calls
//   POST /api/feedback?approve=<id>   with header  Authorization: Bearer <ADMIN_KEY>
//   POST /api/feedback?feature=<id>   (toggle "برگزیده" — pinned into the moving banner)
//   POST /api/feedback?reject=<id>
//   GET  /api/feedback?pending=1      (list pending — admin)
// ADMIN_KEY is a Pages env var (secret). AUTO_APPROVE=1 publishes instantly (default: on when ADMIN_KEY is unset).

const MAX_TEXT = 500, MIN_TEXT = 6, MAX_NAME = 40;
const KINDS = new Set(['idea', 'critique', 'bug', 'praise']);
const json = (data, status = 200, extra = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
    });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'fa',
  likes INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  ip_hash TEXT,
  ua TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fb_status_created ON feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fb_featured ON feedback(featured, likes DESC);
CREATE TABLE IF NOT EXISTS likes (
  entry_id TEXT NOT NULL,
  voter TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (entry_id, voter)
);
CREATE TABLE IF NOT EXISTS ratelimit (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);`;

let schemaReady = false;
async function ensureSchema(db) {
    if (schemaReady) return;
    for (const stmt of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
    schemaReady = true;
}

async function sha(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].slice(0, 16).map(x => x.toString(16).padStart(2, '0')).join('');
}
const clientIp = req => req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '0.0.0.0';
const uid = () => {
    const a = crypto.getRandomValues(new Uint8Array(9));
    return Date.now().toString(36) + [...a].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 10);
};

// normalise text: trim, collapse whitespace, strip control chars & zero-width spam, cap length
function clean(s, max) {
    return String(s || '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}
// naive spam heuristics: links, repeated chars, too many latin words in a Persian context
function looksSpammy(text) {
    if (/(https?:\/\/|www\.|\.(ru|cn|xyz|top)\b)/i.test(text)) return 'link';
    if (/(.)\1{9,}/.test(text)) return 'repeat';
    if ((text.match(/[A-Za-z]{3,}/g) || []).length > 40) return 'latin';
    return null;
}
const detectLang = t => (/[\u0600-\u06FF]/.test(t) ? 'fa' : 'en');

async function rateLimit(db, key, limit, windowSec) {
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare('SELECT hits, window_start FROM ratelimit WHERE key=?').bind(key).first();
    if (!row || now - row.window_start > windowSec) {
        await db.prepare('INSERT OR REPLACE INTO ratelimit(key,hits,window_start) VALUES(?,1,?)').bind(key, now).run();
        return true;
    }
    if (row.hits >= limit) return false;
    await db.prepare('UPDATE ratelimit SET hits=hits+1 WHERE key=?').bind(key).run();
    return true;
}

const publicRow = r => ({
    id: r.id, name: r.name, kind: r.kind, text: r.text, lang: r.lang,
    likes: r.likes, featured: !!r.featured, at: r.created_at
});

// Demo data when there is no database yet (local preview / GitHub Pages mirror)
const DEMO = [
    { id: 'demo1', name: 'مهدی', kind: 'idea', text: 'کاش پنل یک اسکنر Clean-IP داخلی داشت تا لازم نباشد دستی IP تست کنیم.', lang: 'fa', likes: 12, featured: true, at: Date.now() - 86400e3 * 2 },
    { id: 'demo2', name: 'Sara', kind: 'praise', text: 'The one-click Cloudflare deploy is the smoothest I have used. Great docs too.', lang: 'en', likes: 9, featured: true, at: Date.now() - 86400e3 * 4 },
    { id: 'demo3', name: 'نگار', kind: 'critique', text: 'صفحهٔ اشتراک روی موبایل کمی شلوغ است؛ QR باید بزرگ‌تر و بالاتر باشد.', lang: 'fa', likes: 7, featured: true, at: Date.now() - 86400e3 * 6 },
    { id: 'demo4', name: 'علی', kind: 'bug', text: 'بعد از چرخش مسیر پنل، لینک ذخیره‌شده در ربات تلگرام به‌روز نمی‌شود.', lang: 'fa', likes: 4, featured: false, at: Date.now() - 86400e3 * 8 }
];

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const db = env.FEEDBACK_DB;
    if (!db) return json({ ok: true, demo: true, featured: DEMO.filter(d => d.featured), items: DEMO, total: DEMO.length });
    await ensureSchema(db);

    if (url.searchParams.get('pending')) {
        if (!isAdmin(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
        const { results } = await db.prepare("SELECT * FROM feedback WHERE status='pending' ORDER BY created_at DESC LIMIT 200").all();
        return json({ ok: true, items: results.map(publicRow) });
    }

    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '24', 10)));
    const cursor = url.searchParams.get('cursor'); // created_at of last item
    const items = cursor
        ? await db.prepare("SELECT * FROM feedback WHERE status='approved' AND created_at<? ORDER BY created_at DESC LIMIT ?").bind(+cursor, limit).all()
        : await db.prepare("SELECT * FROM feedback WHERE status='approved' ORDER BY created_at DESC LIMIT ?").bind(limit).all();
    // featured = pinned by admin first, then most-liked approved entries (min 1 like) — up to 8
    const featured = await db.prepare(
        "SELECT * FROM feedback WHERE status='approved' AND (featured=1 OR likes>0) ORDER BY featured DESC, likes DESC, created_at DESC LIMIT 8"
    ).all();
    const total = await db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status='approved'").first();
    return json(
        { ok: true, items: items.results.map(publicRow), featured: featured.results.map(publicRow), total: total?.n || 0 },
        200,
        { 'cache-control': 'public, max-age=20, stale-while-revalidate=60' }
    );
}

function isAdmin(request, env) {
    const h = request.headers.get('authorization') || '';
    return !!env.ADMIN_KEY && h === `Bearer ${env.ADMIN_KEY}`;
}

export async function onRequestPost({ request, env }) {
    const url = new URL(request.url);
    const db = env.FEEDBACK_DB;
    if (!db) return json({ ok: false, error: 'no_db', message: 'پایگاه‌داده هنوز متصل نیست.' }, 503);
    await ensureSchema(db);
    const ip = clientIp(request), ua = (request.headers.get('user-agent') || '').slice(0, 160);
    const voter = await sha(ip + '|' + ua + '|' + new Date().toISOString().slice(0, 10)); // rotates daily

    // ── admin actions ──
    for (const action of ['approve', 'reject', 'feature']) {
        const id = url.searchParams.get(action);
        if (!id) continue;
        if (!isAdmin(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
        if (action === 'approve') await db.prepare("UPDATE feedback SET status='approved' WHERE id=?").bind(id).run();
        if (action === 'reject') await db.prepare("UPDATE feedback SET status='rejected' WHERE id=?").bind(id).run();
        if (action === 'feature') await db.prepare('UPDATE feedback SET featured=1-featured WHERE id=?').bind(id).run();
        const row = await db.prepare('SELECT * FROM feedback WHERE id=?').bind(id).first();
        return json({ ok: true, item: row ? { ...publicRow(row), status: row.status } : null });
    }

    // ── like ──
    const likeId = url.searchParams.get('like');
    if (likeId) {
        if (!(await rateLimit(db, 'like:' + voter, 60, 3600))) return json({ ok: false, error: 'rate' }, 429);
        const exists = await db.prepare("SELECT id FROM feedback WHERE id=? AND status='approved'").bind(likeId).first();
        if (!exists) return json({ ok: false, error: 'not_found' }, 404);
        const ins = await db.prepare('INSERT OR IGNORE INTO likes(entry_id,voter,created_at) VALUES(?,?,?)').bind(likeId, voter, Date.now()).run();
        if (ins.meta.changes) await db.prepare('UPDATE feedback SET likes=likes+1 WHERE id=?').bind(likeId).run();
        const row = await db.prepare('SELECT likes FROM feedback WHERE id=?').bind(likeId).first();
        return json({ ok: true, likes: row.likes, already: !ins.meta.changes });
    }

    // ── submit ──
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }
    if (body.hp) return json({ ok: true, id: 'ok' }); // honeypot filled → pretend success
    if (typeof body.t === 'number' && Date.now() - body.t < 2500) return json({ ok: false, error: 'too_fast' }, 400); // bots submit instantly

    const name = clean(body.name, MAX_NAME) || 'ناشناس';
    const kind = KINDS.has(body.kind) ? body.kind : 'idea';
    const text = clean(body.text, MAX_TEXT);
    if (text.length < MIN_TEXT) return json({ ok: false, error: 'short', message: 'متن خیلی کوتاه است.' }, 400);
    const spam = looksSpammy(text);
    if (spam) return json({ ok: false, error: 'spam', message: 'لطفاً لینک یا متن تکراری نفرستید.' }, 400);
    if (!(await rateLimit(db, 'post:' + (await sha(ip)), 5, 3600))) return json({ ok: false, error: 'rate', message: 'در هر ساعت حداکثر ۵ پیام؛ کمی بعد دوباره تلاش کنید.' }, 429);

    // duplicate guard (same text in last 24h)
    const dup = await db.prepare('SELECT id FROM feedback WHERE text=? AND created_at>?').bind(text, Date.now() - 86400e3).first();
    if (dup) return json({ ok: true, id: dup.id, duplicate: true });

    const autoApprove = env.AUTO_APPROVE === '1' || !env.ADMIN_KEY;
    const id = uid();
    await db.prepare(
        'INSERT INTO feedback(id,name,kind,text,lang,likes,featured,status,ip_hash,ua,created_at) VALUES(?,?,?,?,?,0,0,?,?,?,?)'
    ).bind(id, name, kind, text, detectLang(text), autoApprove ? 'approved' : 'pending', await sha(ip), ua, Date.now()).run();
    return json({ ok: true, id, status: autoApprove ? 'approved' : 'pending' }, 201);
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization' } });
}

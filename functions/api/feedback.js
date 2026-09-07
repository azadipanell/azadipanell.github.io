// SHAHYAD · «صندوق پیشنهادات و انتقادات» — Cloudflare Pages Function  →  /api/feedback
//
// Storage = GitHub Issues in a private repo (env.GH_REPO). One note = one Issue. No database to run,
// the GitHub UI / mobile app is the moderation panel:
//   labels  idea | critique | bug | praise → kind of note
//           pending  → hidden until you remove the label      featured → pinned onto the moving strip
//           spam     → hidden                                  closed   → archived (hidden)
// Likes = append-only ledger of comments "<!-- shahyad:like v=<voter> ip=<iphash> -->" on the issue,
//         plus a cached count inside the hidden meta block of the issue body.
// Anti-abuse: Cloudflare Turnstile (invisible; notes WITHOUT a valid token are accepted but go to
//   moderation), honeypot, minimum fill time, link/repeat heuristics, 5 notes per IP per hour,
//   duplicate collapse (24 h), likes: 1 per device, ≤5 per IP per note, ≤40 per IP per hour.
//
// Env (Pages → Settings → Variables): GH_TOKEN (secret) · GH_REPO "owner/repo" · HASH_SALT (secret)
//   TURNSTILE_SITEKEY · TURNSTILE_SECRET (secret) · MODERATE=1 (every note starts pending)
//   TG_BOT_TOKEN + TG_CHAT_ID (optional: Telegram ping for every new note)

const GH = 'https://api.github.com';
const KINDS = new Set(['idea', 'critique', 'bug', 'praise']);
const KIND_FA = { idea: '💡 پیشنهاد', critique: '✂️ انتقاد', bug: '🐞 باگ', praise: '🌟 تشکر' };
const META_OPEN = '<!-- shahyad:meta ', META_CLOSE = ' -->';
const LIKE_RE = /^<!-- shahyad:like v=(\w+) ip=(\w+) -->/;
const MAX_TEXT = 500, MIN_TEXT = 6, MAX_NAME = 40;
const LIST_TTL = 20;        // seconds the parsed issue list stays in the edge cache
const MAX_PAGES = 10;       // ≤ 1000 issues scanned per listing (one API call per 100)
const POSTS_PER_HOUR = 5, LIKES_PER_HOUR = 40, LIKES_PER_NOTE_PER_IP = 5;

const json = (data, status = 200, extra = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
    });
const fail = (error, message, status = 400) => json({ ok: false, error, message }, status);

// ── GitHub REST helper ──────────────────────────────────────────────────────────────────────
class GhError extends Error {
    constructor(status, body) { super('github ' + status); this.status = status; this.body = body; }
}
async function gh(env, path, init = {}) {
    const res = await fetch(GH + path, {
        ...init,
        headers: {
            authorization: `Bearer ${env.GH_TOKEN}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'shahyad-feedback/2.0 (+https://shahyad.dpdns.org)',
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...(init.headers || {})
        }
    });
    if (res.status === 204) return null;
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new GhError(res.status, body);
    return body;
}

// ── small utils ─────────────────────────────────────────────────────────────────────────────
async function sha(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const clientIp = req => req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '0.0.0.0';
function clean(s, max) {
    return String(s || '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}
function looksSpammy(text) {
    if (/(https?:\/\/|www\.|t\.me\/|\.(ru|cn|xyz|top)\b)/i.test(text)) return 'link';
    if (/(.)\1{9,}/.test(text)) return 'repeat';
    if ((text.match(/[A-Za-z]{3,}/g) || []).length > 60) return 'latin';
    return null;
}
const detectLang = t => (/[\u0600-\u06FF]/.test(t) ? 'fa' : 'en');
const stamp = ms => new Date(ms || Date.now()).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// ── issue ⇄ note mapping ────────────────────────────────────────────────────────────────────
function parseIssue(is) {
    const body = is.body || '';
    let text = body, meta = {};
    const i = body.indexOf(META_OPEN);
    if (i >= 0) {
        text = body.slice(0, i);
        const j = body.indexOf(META_CLOSE, i);
        try { meta = JSON.parse(body.slice(i + META_OPEN.length, j < 0 ? undefined : j)) || {}; } catch { meta = {}; }
    } else {
        const k = body.indexOf('\n---\n');
        if (k >= 0) text = body.slice(0, k);
    }
    text = text.trim();
    const labels = new Set((is.labels || []).map(l => (typeof l === 'string' ? l : l.name)));
    const kind = [...labels].find(l => KINDS.has(l)) || (KINDS.has(meta.kind) ? meta.kind : 'idea');
    const lang = meta.lang === 'en' || meta.lang === 'fa' ? meta.lang : detectLang(text);
    const status = is.state !== 'open' ? 'archived' : labels.has('spam') ? 'spam' : labels.has('pending') ? 'pending' : 'approved';
    return {
        id: is.number, text, kind, lang, status,
        name: clean(meta.name, MAX_NAME) || (lang === 'en' ? 'anonymous' : 'ناشناس'),
        likes: Math.max(0, parseInt(meta.likes, 10) || 0),
        featured: labels.has('featured'),
        at: +meta.at || Date.parse(is.created_at) || Date.now(),
        ip: meta.ip || '', meta
    };
}
const pub = r => ({ id: r.id, name: r.name, kind: r.kind, text: r.text, lang: r.lang, likes: r.likes, featured: r.featured, at: r.at });

function buildBody(text, meta) {
    const rows = [
        ['👤 نام', meta.name || 'ناشناس'],
        ['🏷 نوع', KIND_FA[meta.kind] || meta.kind || '–'],
        ['🌐 زبان', meta.lang || '–'],
        ['🕒 زمان', stamp(meta.at)],
        ['🌍 کشور', meta.cc || '–'],
        ['🔐 IP hash', meta.ip || '–'],
        ['🧭 مرورگر', meta.ua || '–'],
        ['🤖 Turnstile', meta.human === true ? '✅ تأیید شد' : meta.human === false ? '⚠️ بدون تأیید (به‌همین‌خاطر pending)' : '– غیرفعال'],
        ['❤️ لایک', String(meta.likes || 0)]
    ];
    return `${text}\n\n${META_OPEN}${JSON.stringify(meta)}${META_CLOSE}\n\n---\n| | |\n|---|---|\n` +
        rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '¦').replace(/\n/g, ' ')} |`).join('\n') +
        `\n\n<sub>مدیریت: برچسب <code>pending</code> را بردارید تا منتشر شود · <code>featured</code> = سنجاق روی نوار متحرک · <code>spam</code> یا بستن Issue = پنهان از سایت · متنِ بالای این خط را می‌توانید ویرایش کنید (بعد از ≤۲۰ ثانیه روی سایت اعمال می‌شود).</sub>`;
}

// ── listing + edge cache (per data-center) ─────────────────────────────────────────────────
// Issues are fetched sorted by `updated` so ANY change (new note, label, edit, like) changes page 1.
// Page 1's ETag is the validator: after LIST_TTL seconds we revalidate with If-None-Match — a 304 is
// free (does not count against GitHub's rate limit) and keeps the cached list alive.
const listKey = env => new Request(`https://feedback.internal/list/${env.GH_REPO}`);
const ISSUES = env => `/repos/${env.GH_REPO}/issues?state=all&per_page=100&sort=updated&direction=desc`;
async function fetchAll(env, etag) {
    const res = await fetch(GH + ISSUES(env) + '&page=1', {
        headers: {
            authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28', 'user-agent': 'shahyad-feedback/2.0 (+https://shahyad.dpdns.org)',
            ...(etag ? { 'if-none-match': etag } : {})
        }
    });
    if (res.status === 304) return null;
    const first = await res.json().catch(() => null);
    if (!res.ok) throw new GhError(res.status, first);
    const out = [];
    for (const is of first) if (!is.pull_request) out.push(parseIssue(is));
    if (first.length === 100) {
        for (let page = 2; page <= MAX_PAGES; page++) {
            const batch = await gh(env, ISSUES(env) + '&page=' + page);
            for (const is of batch) if (!is.pull_request) out.push(parseIssue(is));
            if (batch.length < 100) break;
        }
    }
    out.sort((a, b) => b.at - a.at);
    return { etag: res.headers.get('etag') || '', all: out, fetchedAt: Date.now() };
}
async function loadAll(env, ctx) {
    let cache = null, cached = null;
    try { cache = caches.default; } catch { }
    if (cache) {
        const hit = await cache.match(listKey(env)).catch(() => null);
        if (hit) cached = await hit.json().catch(() => null);
    }
    if (cached && Date.now() - cached.fetchedAt < LIST_TTL * 1000) { ctx.fbCache = 'hit'; return cached.all; }
    let fresh = null;
    try { fresh = await fetchAll(env, cached && cached.etag); }
    catch (e) { if (cached) { console.log('feedback: serving stale list', e.message); ctx.fbCache = 'stale'; return cached.all; } throw e; }
    ctx.fbCache = fresh ? (cached ? 'refresh' : 'miss') : 'revalidated';
    const entry = fresh || { ...cached, fetchedAt: Date.now() };
    if (cache) ctx.waitUntil(cache.put(listKey(env), new Response(JSON.stringify(entry), {
        headers: { 'content-type': 'application/json', 'cache-control': 'max-age=900' }
    })).catch(() => { }));
    return entry.all;
}
// mutate the cached list in place (new note / like) so this data-center reflects the change instantly;
// other data-centers pick it up through the ETag revalidation within LIST_TTL seconds.
async function patchCache(env, fn) {
    try {
        const cache = caches.default, hit = await cache.match(listKey(env));
        if (!hit) return;
        const entry = await hit.json();
        entry.all = fn(entry.all) || entry.all;
        entry.all.sort((a, b) => b.at - a.at);
        await cache.put(listKey(env), new Response(JSON.stringify(entry), {
            headers: { 'content-type': 'application/json', 'cache-control': 'max-age=900' }
        }));
    } catch { }
}
// soft sliding counter in the edge cache (per data-center; the hard limits live in GitHub itself)
async function bump(key, limit, ttl) {
    try {
        const cache = caches.default, req = new Request('https://feedback.internal/rl/' + key);
        const hit = await cache.match(req);
        const n = (hit ? parseInt(await hit.text(), 10) || 0 : 0) + 1;
        await cache.put(req, new Response(String(n), { headers: { 'cache-control': `max-age=${ttl}` } }));
        return n <= limit;
    } catch { return true; }
}

function computeStats(all) {
    const ap = all.filter(r => r.status === 'approved'), now = Date.now(), day = 864e5;
    const kinds = { idea: 0, critique: 0, bug: 0, praise: 0 }, days = new Array(14).fill(0);
    let likes = 0, week = 0, last = 0;
    for (const r of ap) {
        kinds[r.kind] = (kinds[r.kind] || 0) + 1; likes += r.likes;
        if (now - r.at < 7 * day) week++;
        const d = Math.floor((now - r.at) / day); if (d >= 0 && d < 14) days[13 - d]++;
        if (r.at > last) last = r.at;
    }
    return { total: ap.length, likes, kinds, week, days, pending: all.filter(r => r.status === 'pending').length, featured: ap.filter(r => r.featured).length, last_at: last || null };
}
function pickFeatured(ap) {
    const pinned = ap.filter(r => r.featured).sort((a, b) => b.likes - a.likes || b.at - a.at);
    const liked = ap.filter(r => !r.featured && r.likes > 0).sort((a, b) => b.likes - a.likes || b.at - a.at);
    const out = [...pinned, ...liked].slice(0, 8);
    for (const r of ap) { if (out.length >= 3) break; if (!out.includes(r)) out.push(r); } // young wall: fill with newest
    return out;
}
function storageError(e) {
    const s = e instanceof GhError ? e.status : 0;
    console.log('feedback storage error', s, e && e.message, e && e.body && e.body.message);
    return fail('storage', s === 401 || s === 403 ? 'دسترسی به انبار یادداشت‌ها قطع است (توکن GitHub).' : 'دیوار موقتاً در دسترس نیست.', 503);
}
const configured = env => !!(env.GH_TOKEN && env.GH_REPO);

// ── Turnstile ───────────────────────────────────────────────────────────────────────────────
async function verifyTurnstile(env, token, ip) {
    if (!env.TURNSTILE_SECRET) return null;            // not configured → not enforced
    if (!token || typeof token !== 'string') return false;
    try {
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token.slice(0, 2048), remoteip: ip })
        });
        const d = await r.json();
        return !!d.success;
    } catch { return false; }
}

// ── optional Telegram ping ──────────────────────────────────────────────────────────────────
async function notify(env, issue, meta, text, status) {
    if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return;
    const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const body = `📮 <b>یادداشت تازه</b> · ${KIND_FA[meta.kind]}${status === 'pending' ? ' · ⏳ در انتظار تأیید' : ''}\n👤 ${esc(meta.name)}\n\n${esc(text)}\n\n<a href="${issue.html_url}">مدیریت در GitHub</a>`;
    try {
        await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: body, parse_mode: 'HTML', disable_web_page_preview: true })
        });
    } catch { }
}

// ── GET: wall + featured strip + live stats ─────────────────────────────────────────────────
export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    if (!configured(env)) return fail('not_configured', 'صندوق هنوز پیکربندی نشده است.', 503);
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
    try {
        const all = await loadAll(env, ctx);
        const ap = all.filter(r => r.status === 'approved');           // newest first
        return json({
            ok: true,
            items: ap.slice((page - 1) * limit, page * limit).map(pub),
            featured: pickFeatured(ap).map(pub),
            total: ap.length, page, has_more: page * limit < ap.length,
            stats: computeStats(all),
            turnstile: env.TURNSTILE_SITEKEY || null
        }, 200, { 'x-fb-cache': ctx.fbCache || 'none' });
    } catch (e) { return storageError(e); }
}

// ── POST: new note  |  POST ?like=<id> ──────────────────────────────────────────────────────
export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    if (!configured(env)) return fail('not_configured', 'صندوق هنوز پیکربندی نشده است.', 503);
    const url = new URL(request.url);
    const ip = clientIp(request), ua = (request.headers.get('user-agent') || '').slice(0, 160);
    const salt = env.HASH_SALT || 'shahyad';
    const ipHash = (await sha(`${salt}|${ip}`)).slice(0, 12);
    const vid = (request.headers.get('x-fb-vid') || '').replace(/[^\w-]/g, '').slice(0, 40);
    const voter = (await sha(`${salt}|${ip}|${ua}|${vid}`)).slice(0, 16);
    try {
        const likeId = url.searchParams.get('like');
        if (likeId) return await like(env, ctx, likeId, ipHash, voter);
        return await submit(request, env, ctx, ip, ipHash, ua);
    } catch (e) { return storageError(e); }
}

async function like(env, ctx, rawId, ipHash, voter) {
    const id = parseInt(rawId, 10);
    if (!id || id < 1) return fail('bad_id', 'شناسه نامعتبر است.');
    if (!(await bump('like:' + ipHash, LIKES_PER_HOUR, 3600))) return fail('rate', 'کمی آهسته‌تر ❤', 429);
    let is, comments;
    try { [is, comments] = await Promise.all([gh(env, `/repos/${env.GH_REPO}/issues/${id}`), allComments(env, id)]); }
    catch (e) { if (e instanceof GhError && e.status === 404) return fail('not_found', 'یادداشت پیدا نشد.', 404); throw e; }
    if (!is || is.pull_request) return fail('not_found', 'یادداشت پیدا نشد.', 404);
    const r = parseIssue(is);
    if (r.status !== 'approved') return fail('not_found', 'این یادداشت روی دیوار نیست.', 404);
    const ledger = comments.map(c => LIKE_RE.exec(c.body || '')).filter(Boolean).map(m => ({ v: m[1], ip: m[2] }));
    if (ledger.some(l => l.v === voter)) return json({ ok: true, likes: ledger.length, already: true });
    if (ledger.filter(l => l.ip === ipHash).length >= LIKES_PER_NOTE_PER_IP) return fail('rate', 'سهم لایک این شبکه برای این یادداشت پر شده است.', 429);
    const n = ledger.length + 1;
    await gh(env, `/repos/${env.GH_REPO}/issues/${id}/comments`, {
        method: 'POST', body: JSON.stringify({ body: `<!-- shahyad:like v=${voter} ip=${ipHash} -->\n❤️ لایک شمارهٔ ${n} · ${stamp()}` })
    });
    const meta = { name: r.name, kind: r.kind, lang: r.lang, at: r.at, ip: r.ip, ...r.meta, likes: n };
    await gh(env, `/repos/${env.GH_REPO}/issues/${id}`, { method: 'PATCH', body: JSON.stringify({ body: buildBody(r.text, meta) }) });
    ctx.waitUntil(patchCache(env, all => all.map(x => (x.id === id ? { ...x, likes: n } : x))));
    return json({ ok: true, likes: n });
}
async function allComments(env, id) {
    const out = [];
    for (let page = 1; page <= 5; page++) {
        const batch = await gh(env, `/repos/${env.GH_REPO}/issues/${id}/comments?per_page=100&page=${page}`);
        out.push(...batch);
        if (batch.length < 100) break;
    }
    return out;
}

async function submit(request, env, ctx, ip, ipHash, ua) {
    let b;
    try { b = await request.json(); } catch { return fail('bad_json', 'درخواست نامعتبر است.'); }
    if (b.hp) return json({ ok: true, id: 0, status: 'approved' });                       // honeypot → pretend success
    if (typeof b.t === 'number' && Date.now() - b.t < 2500) return fail('too_fast', 'کمی صبر…');
    const name = clean(b.name, MAX_NAME).replace(/--/g, '–').replace(/https?:\/\/\S+/gi, '').trim();
    const kind = KINDS.has(b.kind) ? b.kind : 'idea';
    const text = clean(b.text, MAX_TEXT).replace(/<!--/g, '<\u200c!--');
    if (text.length < MIN_TEXT) return fail('short', 'متن خیلی کوتاه است.');
    const spam = looksSpammy(text);
    if (spam) return fail('spam', 'لطفاً لینک یا متن تکراری نفرستید.');
    if (!(await bump('post:' + ipHash, POSTS_PER_HOUR, 3600))) return fail('rate', 'در هر ساعت حداکثر ۵ پیام؛ کمی بعد دوباره تلاش کنید.', 429);

    // flood + duplicate guard against the store itself (cached list, merged live on every write)
    const all = await loadAll(env, ctx), hourAgo = Date.now() - 3600e3, dayAgo = Date.now() - 864e5;
    if (all.filter(r => r.ip === ipHash && r.at > hourAgo).length >= POSTS_PER_HOUR)
        return fail('rate', 'در هر ساعت حداکثر ۵ پیام؛ کمی بعد دوباره تلاش کنید.', 429);
    const dup = all.find(r => r.text === text && r.at > dayAgo && r.status !== 'archived');
    if (dup) return json({ ok: true, id: dup.id, status: dup.status === 'approved' ? 'approved' : 'pending', duplicate: true });
    const human = await verifyTurnstile(env, b.ts, ip);

    const status = env.MODERATE === '1' || human === false ? 'pending' : 'approved';
    const meta = {
        v: 1, name, kind, lang: detectLang(text), likes: 0, at: Date.now(), ip: ipHash,
        ua: ua.slice(0, 90), cc: request.headers.get('cf-ipcountry') || '', human
    };
    const title = `${KIND_FA[kind].split(' ')[0]} ${text.length > 64 ? text.slice(0, 64).trim() + '…' : text}`;
    const is = await gh(env, `/repos/${env.GH_REPO}/issues`, {
        method: 'POST',
        body: JSON.stringify({ title, body: buildBody(text, meta), labels: [kind, ...(status === 'pending' ? ['pending'] : [])] })
    });
    const note = parseIssue(is);
    ctx.waitUntil(patchCache(env, all => [note, ...all.filter(x => x.id !== note.id)]));
    ctx.waitUntil(notify(env, is, meta, text, status));
    return json({ ok: true, id: is.number, status }, 201);
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-fb-vid' } });
}

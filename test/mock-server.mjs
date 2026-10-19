// Local stand-in for Supabase (auth + PostgREST subset) backed by the local Postgres with real RLS.
// Also serves the static test build and runs the real api/users.js handler. Test use only.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const PORT = 8787;
const STATIC = process.argv[2];
const PSQL = ['-h', '/var/lib/pgkg', '-p', '5433', '-U', 'postgres', '-d', 't', '-At', '-v', 'ON_ERROR_STOP=1', '-q'];
const SECRET = 'sb_secret_test';
process.env.SUPABASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_SECRET_KEY = SECRET;
const passwords = new Map(); // email -> password
const banned = new Set(); const lastSign = new Map();
const tokens = new Map(); // token -> uid

function sql(q) {
  return new Promise((resolve) => execFile('psql', [...PSQL, '-c', q], { maxBuffer: 50e6 }, (err, out, errout) => resolve({ err: err ? errout : null, out })));
}
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad ident ' + s); return s; };
const dollar = (s) => { const tag = 'j' + randomUUID().replace(/-/g, ''); return `$${tag}$${s}$${tag}$`; };

async function wrap(uid, stmt) {
  const pre = uid === 'service' ? '' : `set local role authenticated; select set_config('request.jwt.claim.sub', ${lit(uid || '')}, true);`;
  const r = await sql(`begin; ${pre} ${stmt}; commit;`);
  if (r.err) {
    const msg = (r.err.match(/ERROR:\s+(.*)/) || [])[1] || r.err;
    const code = /row-level security|permission denied/.test(msg) ? 403 : 400;
    return { status: code, body: { message: msg, code: code === 403 ? '42501' : 'P0001' } };
  }
  const i = r.out.indexOf('@@');
  return { status: 200, body: i < 0 ? null : JSON.parse(r.out.slice(i + 2)) };
}

function where(params) {
  const w = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const m = v.match(/^eq\.(.*)$/); if (!m) throw new Error('unsupported filter ' + v);
    w.push(`${ident(k)} = ${lit(m[1])}`);
  }
  return w.length ? `where ${w.join(' and ')}` : '';
}

async function restHandler(req, res, url, body, uid) {
  const table = ident(url.pathname.split('/')[3]);
  const p = url.searchParams;
  const ret = (r, empty204) => {
    if (empty204 && r.status === 200) { res.writeHead(204); return res.end(); }
    res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.body));
  };
  const minimal = /return=minimal/.test(req.headers.prefer || '');
  if (req.method === 'GET') {
    const cols = (p.get('select') || '*') === '*' ? '*' : p.get('select').split(',').map(ident).join(',');
    const order = p.get('order') ? 'order by ' + p.get('order').split(',').map((o) => { const [c, d] = o.split('.'); return `${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(',') : '';
    const limit = p.get('limit') ? `limit ${Number(p.get('limit'))}` : '';
    return ret(await wrap(uid, `select '@@' || coalesce(json_agg(t), '[]')::text from (select ${cols} from public.${table} ${where(p)} ${order} ${limit}) t`));
  }
  if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const cols = Object.keys(rows[0]).map(ident).join(',');
    const r = await wrap(uid, `with x as (insert into public.${table} (${cols}) select ${cols} from json_populate_recordset(null::public.${table}, ${dollar(JSON.stringify(rows))}) returning *) select '@@' || coalesce(json_agg(x), '[]')::text from x`);
    if (r.status === 200 && minimal) { res.writeHead(201); return res.end(); }
    return ret(r.status === 200 ? { status: 201, body: r.body } : r);
  }
  if (req.method === 'PATCH') {
    const cols = Object.keys(body).map(ident);
    const r = await wrap(uid, `with x as (update public.${table} set (${cols.join(',')}) = (select ${cols.join(',')} from json_populate_record(null::public.${table}, ${dollar(JSON.stringify(body))})) ${where(p)} returning *) select '@@' || coalesce(json_agg(x), '[]')::text from x`);
    if (r.status === 200 && minimal) { res.writeHead(204); return res.end(); }
    return ret(r);
  }
  if (req.method === 'DELETE') return ret(await wrap(uid, `with x as (delete from public.${table} ${where(p)} returning 1) select '@@' || count(*) from x`), true);
}

async function emailToId(email) { const r = await sql(`select id from auth.users where email = ${lit(email)}`); return r.out.trim(); }

async function authHandler(req, res, url, body) {
  const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  const p = url.pathname.replace('/auth/v1/', '');
  const bearer = (req.headers.authorization || '').replace('Bearer ', '');
  const isService = req.headers.apikey === SECRET && !bearer.startsWith('tok_');
  if (p === 'token') {
    const gt = url.searchParams.get('grant_type');
    let uid;
    if (gt === 'password') {
      if (passwords.get(body.email) !== body.password) return send(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      uid = await emailToId(body.email);
    } else { uid = tokens.get(body.refresh_token); if (!uid) return send(400, { msg: 'Invalid Refresh Token' }); }
    if (banned.has(uid)) return send(400, { msg: 'User is banned' });
    const at = 'tok_' + randomUUID(); const rt = 'rt_' + randomUUID();
    tokens.set(at, uid); tokens.set(rt, uid); lastSign.set(uid, new Date().toISOString());
    return send(200, { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'bearer', user: { id: uid, email: body.email } });
  }
  if (p === 'logout') { tokens.delete(bearer); res.writeHead(204); return res.end(); }
  if (p === 'user' && req.method === 'GET') {
    const uid = tokens.get(bearer); if (!uid) return send(401, { msg: 'bad jwt' });
    const e = (await sql(`select email from auth.users where id = ${lit(uid)}`)).out.trim();
    return send(200, { id: uid, email: e });
  }
  if (p === 'user' && req.method === 'PUT') {
    const uid = tokens.get(bearer); if (!uid) return send(401, { msg: 'bad jwt' });
    const e = (await sql(`select email from auth.users where id = ${lit(uid)}`)).out.trim();
    passwords.set(e, body.password); return send(200, { id: uid });
  }
  if (p.startsWith('admin/users')) {
    if (!isService) return send(403, { msg: 'not admin' });
    const id = p.split('/')[2];
    if (req.method === 'GET' && !id) {
      const ids = (await sql('select id from auth.users')).out.trim().split('\n').filter(Boolean);
      return send(200, { users: ids.map((i) => ({ id: i, last_sign_in_at: lastSign.get(i) || null })) });
    }
    if (req.method === 'POST') {
      if (await emailToId(body.email)) return send(422, { msg: 'A user with this email address has already been registered' });
      const r = await sql(`insert into auth.users(email, raw_user_meta_data) values (${lit(body.email)}, ${dollar(JSON.stringify(body.user_metadata || {}))}::jsonb) returning id`);
      if (r.err) return send(500, { msg: r.err });
      passwords.set(body.email, body.password);
      return send(200, { id: r.out.trim().split('\n').pop(), email: body.email });
    }
    if (req.method === 'PUT' && id) {
      if (body.ban_duration && body.ban_duration !== 'none') banned.add(id); else banned.delete(id);
      if (body.password) { const e = (await sql(`select email from auth.users where id = ${lit(id)}`)).out.trim(); passwords.set(e, body.password); }
      return send(200, { id });
    }
  }
  send(404, { msg: 'not mocked: ' + p });
}

const { default: usersApi } = await import(path.resolve('api/users.js'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  try {
    if (url.pathname.startsWith('/auth/v1/')) return await authHandler(req, res, url, body);
    if (url.pathname.startsWith('/rest/v1/')) {
      const bearer = (req.headers.authorization || '').replace('Bearer ', '');
      const uid = req.headers.apikey === SECRET && !bearer.startsWith('tok_') ? 'service' : tokens.get(bearer);
      if (!uid && bearer) { res.writeHead(401); return res.end(JSON.stringify({ message: 'JWT expired' })); }
      return await restHandler(req, res, url, body, uid);
    }
    if (url.pathname === '/api/users') {
      const r = { status(c) { this.c = c; return this; }, json(o) { res.writeHead(this.c || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }, setHeader: (k, v) => res.setHeader(k, v) };
      return await usersApi({ method: req.method, headers: req.headers, body }, r);
    }
    const f = url.pathname === '/' ? '/index.html' : url.pathname;
    const data = await readFile(path.join(STATIC, f));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500); res.end(String(e.message));
  }
}).listen(PORT, () => console.log('mock on', PORT));

// seed test passwords for users created directly in SQL
for (const u of ['romy', 'admin', 'gizbar', 'wing', 'dept', 'viewer', 'intruder']) passwords.set(`${u}@demo.romy.co.il`, 'Test1234!');

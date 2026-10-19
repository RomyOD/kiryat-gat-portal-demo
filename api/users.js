// שרת ניהול משתמשים (Vercel Serverless Function)
// המפתח הסודי של Supabase שמור רק כאן, כמשתנה סביבה ב-Vercel, ולעולם אינו נשלח לדפדפן.
const URL_ = (process.env.SUPABASE_URL || '').trim().replace(/\/+(rest\/v1\/?)?$/, '');
const SECRET = (process.env.SUPABASE_SECRET_KEY || '').replace(/\s+/g, '');
const DOMAIN = process.env.EMAIL_DOMAIN || 'demo.romy.co.il';
const ROLES = ['admin', 'treasurer', 'wing', 'dept', 'viewer'];

const sHeaders = () => (SECRET.startsWith('eyJ')
  ? { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }
  : { apikey: SECRET, 'Content-Type': 'application/json' });

async function sb(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${URL_}${path}`, { method, headers: { ...sHeaders(), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `HTTP ${res.status}`;
    const e = new Error(msg); e.status = res.status; e.code = data?.error_code || data?.code; throw e;
  }
  return data;
}

async function caller(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  let r;
  try { r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SECRET, Authorization: auth } }); } catch (e) { console.error('auth check failed'); throw e; }
  if (!r.ok) return null;
  const user = await r.json();
  const prof = await sb(`/rest/v1/profiles?id=eq.${user.id}&select=*`);
  return prof[0] ? { ...prof[0], email: user.email } : null;
}

function audit(by, rowId, action, changes) {
  return sb('/rest/v1/audit_log', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: { user_id: by.id, username: by.username, table_name: 'profiles', row_id: rowId, action, changes } }).catch(() => {});
}

function clean(p) {
  const role = ROLES.includes(p.role) ? p.role : null;
  if (!role) throw Object.assign(new Error('תפקיד לא תקין'), { status: 400 });
  const out = { role, full_name: String(p.full_name || '').trim().slice(0, 80), active: !!p.active, division_id: null, department_id: null };
  if (role === 'wing') { out.division_id = Number(p.division_id) || null; if (!out.division_id) throw Object.assign(new Error('יש לבחור אגף'), { status: 400 }); }
  if (role === 'dept') { out.department_id = Number(p.department_id) || null; if (!out.department_id) throw Object.assign(new Error('יש לבחור מחלקה'), { status: 400 }); }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!URL_ || !SECRET) return res.status(500).json({ error: 'שרת הניהול לא הוגדר: חסרים משתני סביבה ב-Vercel' });
  const body0 = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })() : (req.body || {});
  if (body0.action === 'health') {
    // בדיקת תצורה בטוחה: לא מחזירה ערכים סודיים, רק את צורתם ואת תוצאת החיבור
    const out = {
      url_ok: /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(URL_),
      url_shape: URL_.replace(/[a-z0-9]{6,}(?=\.supabase)/, '****').slice(0, 60),
      key_type: SECRET.startsWith('sb_secret_') ? 'secret' : SECRET.startsWith('sb_publishable_') ? 'publishable (wrong key)' : SECRET.startsWith('eyJ') ? 'legacy jwt' : 'unknown',
      key_had_whitespace: /\s/.test(process.env.SUPABASE_SECRET_KEY || ''),
    };
    try { const d = await sb('/rest/v1/divisions?select=id&limit=1'); out.db = Array.isArray(d) ? 'ok' : 'unexpected'; } catch (e) { out.db = `fail ${e.status || 'network'}`; }
    try { await sb('/auth/v1/admin/users?per_page=1'); out.auth_admin = 'ok'; } catch (e) { out.auth_admin = `fail ${e.status || 'network'}`; }
    return res.json(out);
  }
  try {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'פג תוקף החיבור. יש להתחבר מחדש' });
    if (me.role !== 'admin' || !me.active) return res.status(403).json({ error: 'פעולה זו מותרת למנהל המערכת בלבד' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (body.action === 'list') {
      const [profiles, auth] = await Promise.all([
        sb('/rest/v1/profiles?select=*&order=username'),
        sb('/auth/v1/admin/users?per_page=500'),
      ]);
      const last = Object.fromEntries((auth.users || []).map((u) => [u.id, u.last_sign_in_at]));
      return res.json({ users: profiles.map((p) => ({ ...p, last_sign_in_at: last[p.id] || null })) });
    }

    if (body.action === 'create') {
      const username = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,32}$/.test(username)) return res.status(400).json({ error: 'שם משתמש לא תקין' });
      if (String(body.password || '').length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להכיל 8 תווים לפחות' });
      const fields = clean(body);
      let user;
      try {
        user = await sb('/auth/v1/admin/users', { method: 'POST',
          body: { email: `${username}@${DOMAIN}`, password: body.password, email_confirm: true, user_metadata: { full_name: fields.full_name } } });
      } catch (e) {
        if (e.status === 422 || /already/i.test(e.message)) return res.status(409).json({ error: 'שם המשתמש כבר קיים' });
        if (/password/i.test(e.message)) return res.status(400).json({ error: 'הסיסמה חלשה מדי' });
        throw e;
      }
      await sb(`/rest/v1/profiles?id=eq.${user.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: fields });
      if (!fields.active) await sb(`/auth/v1/admin/users/${user.id}`, { method: 'PUT', body: { ban_duration: '876000h' } });
      await audit(me, user.id, 'הוספה', { username, ...fields });
      return res.json({ ok: true, id: user.id });
    }

    if (body.action === 'update') {
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'מזהה לא תקין' });
      const fields = clean(body);
      if (id === me.id && (fields.role !== 'admin' || !fields.active)) return res.status(400).json({ error: 'לא ניתן להוריד הרשאות או להשבית את המשתמש שלך' });
      const before = (await sb(`/rest/v1/profiles?id=eq.${id}&select=*`))[0];
      if (!before) return res.status(404).json({ error: 'המשתמש לא נמצא' });
      await sb(`/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: fields });
      const authPatch = { ban_duration: fields.active ? 'none' : '876000h' };
      if (body.password) {
        if (String(body.password).length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להכיל 8 תווים לפחות' });
        authPatch.password = body.password;
      }
      await sb(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: authPatch });
      const changes = {};
      for (const k of Object.keys(fields)) if (before[k] !== fields[k]) changes[k] = [before[k], fields[k]];
      if (body.password) changes.password = ['', 'אופסה'];
      if (Object.keys(changes).length) await audit(me, id, 'עדכון', changes);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'פעולה לא מוכרת' });
  } catch (e) {
    console.error('users api error', e.status || 'network', String(e.message || '').replace(/sb_secret_\S+|eyJ\S+/g, '[redacted]').slice(0, 200));
    return res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.status === 400 ? e.message : 'שגיאה בשרת הניהול. נסה שוב' });
  }
}

import { SUPABASE_URL, SUPABASE_KEY, EMAIL_DOMAIN } from './config.js';

let session = null;
const RT_KEY = 'kg_demo_rt';

function store(s) {
  session = s;
  try {
    if (s) sessionStorage.setItem(RT_KEY, s.refresh_token);
    else sessionStorage.removeItem(RT_KEY);
  } catch { /* storage unavailable */ }
}

async function authCall(path, body, method = 'POST', bearer) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 429) throw new Error('בוצעו יותר מדי ניסיונות. נסה שוב בעוד כמה דקות');
    if (res.status === 400 || res.status === 401) throw new Error('שם משתמש או סיסמה שגויים');
    if (data.code === 'weak_password' || /password/i.test(data.msg || '')) throw new Error('הסיסמה חלשה מדי. יש לבחור סיסמה של 8 תווים לפחות');
    throw new Error(data.msg || data.error_description || 'שגיאה בהתחברות');
  }
  return data;
}

function withExpiry(d) {
  return { ...d, expires_at: Date.now() + (d.expires_in || 3600) * 1000 };
}

export const usernameToEmail = (u) => `${u.trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export async function signIn(username, password) {
  if (!/^[a-z0-9._-]{2,32}$/i.test(username.trim())) throw new Error('שם משתמש או סיסמה שגויים');
  const d = await authCall('token?grant_type=password', { email: usernameToEmail(username), password });
  store(withExpiry(d));
  return session;
}

async function refresh() {
  const rt = session?.refresh_token || (() => { try { return sessionStorage.getItem(RT_KEY); } catch { return null; } })();
  if (!rt) throw new Error('no session');
  const d = await authCall('token?grant_type=refresh_token', { refresh_token: rt });
  store(withExpiry(d));
  return session;
}

export async function restore() {
  try { return await refresh(); } catch { store(null); return null; }
}

export async function signOut() {
  const t = session?.access_token;
  store(null);
  if (t) { try { await authCall('logout', null, 'POST', t); } catch { /* ignore */ } }
}

export async function token() {
  if (!session) throw new Error('פג תוקף החיבור. יש להתחבר מחדש');
  if (Date.now() > session.expires_at - 60_000) await refresh();
  return session.access_token;
}

export const currentUserId = () => session?.user?.id;

export async function changePassword(password) {
  await authCall('user', { password }, 'PUT', await token());
}

function translate(err, status) {
  const m = err.message || '';
  if (status === 401 || /JWT/i.test(m)) return 'פג תוקף החיבור. יש להתחבר מחדש';
  if (/row-level security|permission denied/i.test(m) || status === 403) return 'אין לך הרשאה לבצע פעולה זו';
  if (/duplicate key/i.test(m) && /code/i.test(m + (err.details || ''))) return 'קוד הסעיף כבר קיים במערכת';
  if (/tasks_deadline_check/.test(m)) return 'תאריך היעד חייב להיות בשנת תוכנית העבודה';
  if (/violates check constraint|not-null/i.test(m)) return 'יש למלא את כל שדות החובה בערכים תקינים';
  if (/foreign key/i.test(m)) return 'לא ניתן למחוק: קיימים רשומות המקושרות לפריט זה';
  return m || 'שגיאה בשמירת הנתונים';
}

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('אין חיבור לשרת. השינויים לא נשמרו');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(translate(data || {}, res.status));
  return data;
}

export const db = {
  list: (table, query = '') => rest(`${table}?select=*${query}`),
  insert: (table, rows) => rest(table, { method: 'POST', body: rows, prefer: 'return=representation' }),
  update: (table, id, patch) => rest(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }),
  remove: (table, id) => rest(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export async function adminApi(action, payload = {}) {
  let res;
  try {
    res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error('אין חיבור לשרת הניהול');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה בשרת הניהול');
  return data;
}

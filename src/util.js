export const ROLE_LABEL = {
  admin: 'מנהל מערכת', treasurer: 'גזבר / תקציבן', wing: 'ראש אגף', dept: 'מנהל מחלקה', viewer: 'צפייה בלבד', none: 'ללא הרשאה',
};
export const STATUSES = ['בוצע', 'בתהליך', 'עיכוב', 'עצירה'];
export const STATUS_CLASS = { 'בוצע': 'st-done', 'בתהליך': 'st-prog', 'עיכוב': 'st-delay', 'עצירה': 'st-stop' };

const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
export const num = (v) => nf.format(Math.round(Number(v) || 0));
export const ils = (v) => `₪${num(v)}`;
export function mil(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `₪${(n / 1e6).toLocaleString('he-IL', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} מיליון`;
  if (Math.abs(n) >= 1e3) return `₪${(n / 1e3).toLocaleString('he-IL', { maximumFractionDigits: 0 })} אלף`;
  return ils(n);
}
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function fmtDate(d) {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}.${m}.${y}`;
}
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

export function quarterState(quarters, q, today = todayISO()) {
  const r = quarters.find((x) => x.q === q);
  if (!r) return { open: false, label: '' };
  if (today < r.opens_at) return { open: false, label: `ייפתח ב-${fmtDate(r.opens_at)}`, future: true, ...r };
  if (today > r.locks_at) return { open: false, label: `נעול מ-${fmtDate(r.locks_at)}`, locked: true, ...r };
  return { open: true, label: `פתוח עד ${fmtDate(r.locks_at)}`, daysLeft: daysBetween(today, r.locks_at), ...r };
}

export const used = (b) => Number(b.actual_2026 || 0) + Number(b.commit_2026 || 0);
export const isOver = (b) => b.kind === 'הוצאה' && Number(b.budget_2026) > 0 && used(b) > Number(b.budget_2026);

export function lastQuarterStatus(t) {
  for (const q of [4, 3, 2, 1]) if (t[`q${q}_status`]) return t[`q${q}_status`];
  return null;
}
export function isLate(t, today = todayISO()) {
  return t.deadline < today && lastQuarterStatus(t) !== 'בוצע';
}
export const isWeekend = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDay() === 5 || d.getDay() === 6; };

export const byName = (a, b) => a.name.localeCompare(b.name, 'he');
export const norm = (s) => String(s ?? '').trim().toLowerCase();

import React, { useEffect, useState } from 'react';
import { adminApi, db, rest, currentUserId } from '../api.js';
import { Modal, Field, Loading, useToast } from '../ui.jsx';
import { ROLE_LABEL, fmtDate, quarterState } from '../util.js';

const ROLE_HELP = {
  admin: 'גישה מלאה לכל המודולים, כולל ניהול משתמשים ופתיחת רבעונים נעולים',
  treasurer: 'צפייה בכל העירייה ועדכון סעיפי התקציב, ללא עריכת תוכניות עבודה',
  wing: 'צפייה ועריכה של תוכניות העבודה בכל מחלקות האגף; צפייה בתקציב האגף',
  dept: 'צפייה ועריכה של תוכנית העבודה של המחלקה בלבד; צפייה בתקציב המחלקה',
  viewer: 'צפייה בכל הנתונים ללא אפשרות עריכה (למשל הנהלה או ביקורת)',
};

function UserDialog({ ctx, user, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(user ? { ...user, password: '' } : { username: '', full_name: '', password: '', role: 'dept', division_id: '', department_id: '', active: true });
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setErr((x) => ({ ...x, [k]: undefined })); setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); };
  const self = user?.id === currentUserId();
  const save = async () => {
    const e = {};
    if (!user && !/^[a-z0-9._-]{2,32}$/.test(f.username)) e.username = 'אותיות באנגלית קטנות, ספרות, נקודה או מקף בלבד';
    if (!user && f.password.length < 8) e.password = '8 תווים לפחות';
    if (user && f.password && f.password.length < 8) e.password = '8 תווים לפחות';
    if (!f.full_name?.trim()) e.full_name = 'שדה חובה';
    if (f.role === 'wing' && !f.division_id) e.division_id = 'יש לבחור אגף';
    if (f.role === 'dept' && !f.department_id) e.department_id = 'יש לבחור מחלקה';
    setErr(e); if (Object.values(e).some(Boolean)) return;
    const payload = {
      id: user?.id, username: f.username, full_name: f.full_name.trim(), role: f.role, active: !!f.active,
      division_id: f.role === 'wing' ? Number(f.division_id) : null, department_id: f.role === 'dept' ? Number(f.department_id) : null,
      ...(f.password ? { password: f.password } : {}),
    };
    setBusy(true);
    try { await adminApi(user ? 'update' : 'create', payload); toast(user ? 'המשתמש עודכן' : 'המשתמש נוצר'); onSaved(); }
    catch (x) { toast(x.message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={user ? `עריכת משתמש ${user.username}` : 'הוספת משתמש'} onClose={onClose}
      footer={<><span className="grow" /><button className="btn ghost" onClick={onClose}>ביטול</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button></>}>
      <div className="form-grid">
        <Field label="שם משתמש" required error={err.username} hint={user ? undefined : 'באנגלית, למשל dana.c'}>
          <input value={f.username} onChange={set('username')} dir="ltr" disabled={!!user} autoComplete="off" />
        </Field>
        <Field label="שם מלא" required error={err.full_name}><input value={f.full_name || ''} onChange={set('full_name')} /></Field>
        <Field label={user ? 'סיסמה חדשה' : 'סיסמה ראשונית'} required={!user} error={err.password} hint={user ? 'השאר ריק כדי לא לשנות' : '8 תווים לפחות; יש למסור למשתמש בערוץ מאובטח'}>
          <input type="password" value={f.password} onChange={set('password')} dir="ltr" autoComplete="new-password" />
        </Field>
        <Field label="תפקיד" required hint={ROLE_HELP[f.role]}>
          <select value={f.role} onChange={set('role')} disabled={self}>
            {Object.entries(ROLE_LABEL).filter(([k]) => k !== 'none').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {f.role === 'wing' && (
          <Field label="אגף" required error={err.division_id}>
            <select value={f.division_id || ''} onChange={set('division_id')}><option value="">בחר אגף</option>{ctx.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </Field>
        )}
        {f.role === 'dept' && (
          <Field label="מחלקה" required error={err.department_id}>
            <select value={f.department_id || ''} onChange={set('department_id')}>
              <option value="">בחר מחלקה</option>
              {ctx.divisions.map((dv) => <optgroup key={dv.id} label={dv.name}>{ctx.departments.filter((d) => d.division_id === dv.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>)}
            </select>
          </Field>
        )}
        <label className="check"><input type="checkbox" checked={!!f.active} onChange={set('active')} disabled={self} /> משתמש פעיל</label>
      </div>
      {self && <p className="muted small">לא ניתן לשנות את התפקיד או להשבית את המשתמש שלך עצמך.</p>}
    </Modal>
  );
}

function Quarters({ ctx }) {
  const toast = useToast();
  const [rows, setRows] = useState(ctx.quarters.map((q) => ({ ...q })));
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async (r) => {
    if (r.opens_at > r.locks_at) { toast('תאריך הפתיחה חייב להיות לפני תאריך הנעילה', 'error'); return; }
    try {
      await rest(`quarters?q=eq.${r.q}`, { method: 'PATCH', body: { opens_at: r.opens_at, locks_at: r.locks_at }, prefer: 'return=minimal' });
      ctx.setQuarters(rows.map((x) => (x.q === r.q ? r : x))); toast(`חלון העדכון של רבעון ${r.q} נשמר`);
    } catch (x) { toast(x.message, 'error'); }
  };
  return (
    <section className="card">
      <div className="card-head"><h2>חלונות עדכון רבעוני</h2></div>
      <p className="muted small">מחוץ לחלון, מנהלי אגפים ומחלקות אינם יכולים לעדכן את סטטוס המשימות. הנעילה נאכפת במסד הנתונים עצמו.</p>
      <table className="mini">
        <thead><tr><th>רבעון</th><th>נפתח</th><th>ננעל</th><th>מצב</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => {
          const s = quarterState([r], r.q);
          return (
            <tr key={r.q}><td>רבעון {r.q}</td>
              <td><input type="date" value={r.opens_at} onChange={(e) => set(i, 'opens_at', e.target.value)} aria-label={`פתיחת רבעון ${r.q}`} /></td>
              <td><input type="date" value={r.locks_at} onChange={(e) => set(i, 'locks_at', e.target.value)} aria-label={`נעילת רבעון ${r.q}`} /></td>
              <td><span className={`pill ${s.open ? 'ok' : s.locked ? 'lock' : ''}`}>{s.open ? 'פתוח' : s.locked ? 'נעול' : 'טרם נפתח'}</span></td>
              <td><button className="btn small ghost" onClick={() => save(r)}>שמירה</button></td></tr>
          );
        })}</tbody>
      </table>
    </section>
  );
}

const FIELD_LABEL = { budget_2026: 'תקציב 2026', actual_2026: 'ביצוע 2026', commit_2026: 'שריון', actual_2025: 'ביצוע 2025', name: 'שם', task: 'משימה',
  deadline: 'תאריך יעד', success_metric: 'יעד הצלחה', est_cost: 'אומדן', goal_id: 'מטרה', budget_item_id: 'סעיף', activity: 'פעילות', notes: 'הערות',
  q1_status: 'ר1', q2_status: 'ר2', q3_status: 'ר3', q4_status: 'ר4', q1_note: 'הערה ר1', q2_note: 'הערה ר2', q3_note: 'הערה ר3', q4_note: 'הערה ר4',
  role: 'תפקיד', active: 'פעיל', department_id: 'מחלקה', division_id: 'אגף', full_name: 'שם מלא', password: 'סיסמה' };

function describe(a) {
  if (a.action !== 'עדכון' || !a.changes) return a.changes?.name || a.changes?.task || a.changes?.username || '';
  return Object.entries(a.changes).map(([k, v]) => (Array.isArray(v) ? `${FIELD_LABEL[k] || k}: ${v[0] ?? '—'} ← ${v[1] ?? '—'}` : `${FIELD_LABEL[k] || k}`)).join(' · ');
}

function Audit() {
  const [rows, setRows] = useState(null);
  useEffect(() => { db.list('audit_log', '&order=at.desc&limit=100').then(setRows).catch(() => setRows([])); }, []);
  const tbl = { budget_items: 'תקציב', tasks: 'משימה', profiles: 'משתמש' };
  return (
    <section className="card">
      <div className="card-head"><h2>יומן שינויים</h2><span className="muted small">100 הפעולות האחרונות · לא ניתן לעריכה או למחיקה</span></div>
      {!rows ? <Loading /> : rows.length === 0 ? <p className="muted">עדיין לא בוצעו שינויים במערכת.</p> : (
        <div className="table-wrap short"><table className="mini">
          <thead><tr><th>מועד</th><th>משתמש</th><th>פריט</th><th>פעולה</th><th>פירוט</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id}><td className="nowrap">{new Date(a.at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</td><td>{a.username}</td>
              <td>{tbl[a.table_name] || a.table_name} #{a.row_id?.slice(0, 8)}</td><td>{a.action}</td><td className="small">{describe(a)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

export default function Users({ ctx }) {
  const toast = useToast();
  const [users, setUsers] = useState(null); const [edit, setEdit] = useState(null);
  const load = () => adminApi('list').then((d) => setUsers(d.users)).catch((x) => { toast(x.message, 'error'); setUsers([]); });
  useEffect(() => { load(); }, []);
  if (!ctx.can.admin) return <p>אין הרשאה.</p>;
  const scope = (u) => (u.role === 'wing' ? ctx.divById[u.division_id]?.name : u.role === 'dept' ? ctx.deptById[u.department_id]?.name : u.role === 'none' ? '—' : 'כלל העירייה');
  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>משתמשים</h2><button className="btn primary" onClick={() => setEdit({})}>+ משתמש חדש</button></div>
        {!users ? <Loading /> : (
          <div className="table-wrap"><table className="grid">
            <thead><tr><th>שם משתמש</th><th>שם מלא</th><th>תפקיד</th><th>היקף הרשאה</th><th>סטטוס</th><th>כניסה אחרונה</th><th /></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'row-muted'}>
                <td className="code" dir="ltr">{u.username}</td><td>{u.full_name}</td><td>{ROLE_LABEL[u.role]}</td><td>{scope(u)}</td>
                <td><span className={`pill ${u.active ? 'ok' : 'lock'}`}>{u.active ? 'פעיל' : 'מושבת'}</span></td>
                <td className="small muted">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : 'טרם התחבר'}</td>
                <td><button className="btn small ghost" onClick={() => setEdit(u)}>עריכה</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <div className="grid-2">
        <Quarters ctx={ctx} />
        <section className="card">
          <div className="card-head"><h2>הרשאות לפי תפקיד</h2></div>
          <ul className="role-list">{Object.entries(ROLE_HELP).map(([k, v]) => <li key={k}><b>{ROLE_LABEL[k]}</b><span>{v}</span></li>)}</ul>
          <p className="muted small">ההרשאות נאכפות במסד הנתונים (Row Level Security), ולא רק בממשק. משתמש לא יכול לראות או לשנות נתונים שמחוץ להיקף שלו גם אם יפנה לשרת ישירות.</p>
        </section>
      </div>
      <Audit />
      {edit && <UserDialog ctx={ctx} user={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

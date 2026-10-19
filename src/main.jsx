import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { signIn, signOut, restore, db, changePassword, currentUserId } from './api.js';
import { IDLE_MINUTES } from './config.js';
import { ROLE_LABEL, quarterState, byName } from './util.js';
import { Modal, Field, ToastProvider, useToast, Loading, Icon } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Budget from './pages/Budget.jsx';
import WorkPlan from './pages/WorkPlan.jsx';
import Users from './pages/Users.jsx';

const ROUTES = [
  { id: 'dashboard', label: 'תמונת מצב', icon: '◔', desc: 'תקציב מול ביצוע ותוכנית העבודה במבט אחד' },
  { id: 'budget', label: 'סעיפי תקציב', icon: '₪', desc: 'הזנה, עדכון, ייבוא וייצוא של סעיפי התקציב' },
  { id: 'workplan', label: 'תוכנית עבודה 2026', icon: '☰', desc: 'משימות לפי מטרות העירייה ועדכון רבעוני' },
  { id: 'users', label: 'משתמשים והרשאות', icon: '⚙', desc: 'ניהול משתמשים, חלונות עדכון ויומן שינויים', admin: true },
];

function Login({ onDone, notice }) {
  const [u, setU] = useState(''); const [p, setP] = useState('');
  const [err, setErr] = useState(notice || ''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!u.trim() || !p) { setErr('יש להזין שם משתמש וסיסמה'); return; }
    setBusy(true);
    try { await signIn(u, p); onDone(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit} noValidate>
        <img src="/logo.svg" alt="עיריית קרית גת" className="login-logo" />
        <h1>פורטל תקציב ותוכניות עבודה</h1>
        <p className="login-sub">עיריית קרית גת</p>
        <div className="demo-tag">סביבת הדגמה · נתונים בדויים</div>
        <Field label="שם משתמש"><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" dir="ltr" autoCapitalize="none" spellCheck="false" /></Field>
        <Field label="סיסמה"><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" dir="ltr" /></Field>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'מתחבר…' : 'כניסה למערכת'}</button>
        <p className="login-foot">הכניסה מורשית למשתמשים שהוגדרו על ידי מנהל המערכת בלבד</p>
      </form>
    </div>
  );
}

function PasswordDialog({ onClose }) {
  const toast = useToast();
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (a.length < 8) return setErr('הסיסמה חייבת להכיל 8 תווים לפחות');
    if (a !== b) return setErr('הסיסמאות אינן תואמות');
    setBusy(true);
    try { await changePassword(a); toast('הסיסמה עודכנה'); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title="החלפת סיסמה" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>ביטול</button><button className="btn primary" onClick={save} disabled={busy}>שמירה</button></>}>
      <Field label="סיסמה חדשה" hint="8 תווים לפחות"><input type="password" value={a} onChange={(e) => setA(e.target.value)} dir="ltr" autoComplete="new-password" /></Field>
      <Field label="אימות סיסמה"><input type="password" value={b} onChange={(e) => setB(e.target.value)} dir="ltr" autoComplete="new-password" /></Field>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function useRoute() {
  const get = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
  const [r, setR] = useState(get());
  useEffect(() => { const f = () => setR(get()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}

function Shell({ onLogout }) {
  const route = useRoute();
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  const [nav, setNav] = useState(false);

  const load = async () => {
    try {
      const [profiles, divisions, departments, goals, quarters] = await Promise.all([
        db.list('profiles', `&id=eq.${currentUserId()}`), db.list('divisions', '&order=sort'), db.list('departments', '&order=sort'),
        db.list('goals', '&order=sort'), db.list('quarters', '&order=q'),
      ]);
      const profile = profiles[0];
      if (!profile || !profile.active || profile.role === 'none') { setError('המשתמש שלך עדיין לא הופעל. יש לפנות למנהל המערכת.'); return; }
      const deptById = Object.fromEntries(departments.map((d) => [d.id, d]));
      const divById = Object.fromEntries(divisions.map((d) => [d.id, d]));
      const myDivision = profile.division_id || deptById[profile.department_id]?.division_id || null;
      setCtx({
        profile, divisions, departments, goals, quarters, deptById, divById, myDivision,
        goalById: Object.fromEntries(goals.map((g) => [g.id, g])),
        can: {
          admin: profile.role === 'admin',
          editBudget: ['admin', 'treasurer'].includes(profile.role),
          editTasks: ['admin', 'wing', 'dept'].includes(profile.role),
          seeAll: ['admin', 'treasurer', 'viewer'].includes(profile.role),
        },
        setQuarters: (q) => setCtx((c) => ({ ...c, quarters: q })),
      });
    } catch (x) { setError(x.message); }
  };
  useEffect(() => { load(); }, []);

  if (error) return <div className="login-wrap"><div className="login"><img src="/logo.svg" alt="" className="login-logo" /><p className="form-error">{error}</p><button className="btn primary block" onClick={onLogout}>חזרה למסך הכניסה</button></div></div>;
  if (!ctx) return <Loading />;

  const routes = ROUTES.filter((r) => !r.admin || ctx.can.admin);
  const cur = routes.find((r) => r.id === route) || routes[0];
  const openQ = [1, 2, 3, 4].map((q) => quarterState(ctx.quarters, q)).find((s) => s.open);
  const scope = ctx.can.seeAll ? 'כלל העירייה'
    : ctx.profile.role === 'wing' ? ctx.divById[ctx.myDivision]?.name : ctx.deptById[ctx.profile.department_id]?.name;

  const Page = { dashboard: Dashboard, budget: Budget, workplan: WorkPlan, users: Users }[cur.id];

  return (
    <div className={`app ${nav ? 'nav-open' : ''}`}>
      <aside className="side" aria-label="תפריט ראשי">
        <div className="brand"><img src="/logo.svg" alt="" /><div><strong>עיריית קרית גת</strong><span>תקציב ותוכניות עבודה</span></div></div>
        <nav>{routes.map((r) => (
          <a key={r.id} href={`#/${r.id}`} className={r.id === cur.id ? 'active' : ''} onClick={() => setNav(false)}>
            <span className="nav-ico"><Icon name={r.id} /></span>{r.label}</a>
        ))}</nav>
        <div className="side-foot">
          {openQ && <div className="q-badge">עדכון רבעון {openQ.q} {openQ.label}</div>}
          <div className="demo-note">סביבת הדגמה · כל הנתונים בדויים</div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setNav(false)} />
      <div className="main">
        <header className="top">
          <button className="icon-btn burger" onClick={() => setNav(!nav)} aria-label="תפריט">☰</button>
          <div className="top-title"><h1>{cur.label}</h1><p>{cur.desc}</p></div>
          <div className="user-box">
            <button className="user-btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>
              <span className="avatar">{(ctx.profile.full_name || ctx.profile.username).slice(0, 1)}</span>
              <span className="user-meta"><strong>{ctx.profile.full_name || ctx.profile.username}</strong><span>{ROLE_LABEL[ctx.profile.role]} · {scope}</span></span>
            </button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => { setMenu(false); setPw(true); }}>החלפת סיסמה</button>
                <button onClick={onLogout}>יציאה</button>
              </div>
            )}
          </div>
        </header>
        <main className="content"><Page ctx={ctx} /></main>
      </div>
      {pw && <PasswordDialog onClose={() => setPw(false)} />}
    </div>
  );
}

function App() {
  const [state, setState] = useState('loading');
  const [notice, setNotice] = useState('');
  const last = useRef(Date.now());

  useEffect(() => { restore().then((s) => setState(s ? 'in' : 'out')); }, []);

  useEffect(() => {
    if (state !== 'in') return;
    const mark = () => { last.current = Date.now(); };
    const ev = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    ev.forEach((e) => addEventListener(e, mark, { passive: true }));
    const t = setInterval(async () => {
      if (Date.now() - last.current > IDLE_MINUTES * 60_000) {
        await signOut(); setNotice(`נותקת אוטומטית לאחר ${IDLE_MINUTES} דקות ללא פעילות`); setState('out');
      }
    }, 20_000);
    return () => { ev.forEach((e) => removeEventListener(e, mark)); clearInterval(t); };
  }, [state]);

  const logout = async () => { await signOut(); setNotice(''); setState('out'); location.hash = ''; };

  if (state === 'loading') return <Loading />;
  if (state === 'out') return <Login notice={notice} onDone={() => { last.current = Date.now(); setNotice(''); setState('in'); }} />;
  return <Shell onLogout={logout} />;
}

createRoot(document.getElementById('root')).render(<ToastProvider><App /></ToastProvider>);

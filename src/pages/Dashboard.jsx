import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../api.js';
import { Kpi, Meter, Loading, Empty } from '../ui.jsx';
import { mil, ils, pct, used, isOver, quarterState, isLate, STATUSES, STATUS_CLASS } from '../util.js';

function DivisionBars({ rows, onPick, picked }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.budget, r.used)));
  return (
    <div className="bars" role="list">
      {rows.map((r) => {
        const over = r.used > r.budget;
        return (
          <button key={r.key} role="listitem" className={`bar-row ${picked === r.key ? 'picked' : ''}`} onClick={() => onPick?.(r.key)}
            title={`${r.name}: תקציב ${ils(r.budget)}, ביצוע ${ils(r.actual)}, שריון ${ils(r.commit)}`}>
            <span className="bar-name">{r.name}</span>
            <span className="bar-track">
              <span className="bar-budget" style={{ width: `${(r.budget / max) * 100}%` }} />
              <span className="bar-actual" style={{ width: `${(r.actual / max) * 100}%` }} />
              <span className="bar-commit" style={{ insetInlineStart: `${(r.actual / max) * 100}%`, width: `${(r.commit / max) * 100}%` }} />
            </span>
            <span className={`bar-val ${over ? 'neg' : ''}`}>{pct(r.used, r.budget)}%</span>
          </button>
        );
      })}
    </div>
  );
}

function Donut({ parts, total, center }) {
  let acc = 0;
  const stops = parts.map((p) => { const a = acc; acc += total ? (p.v / total) * 100 : 0; return `var(${p.c}) ${a}% ${acc}%`; });
  if (acc < 100) stops.push(`var(--none) ${acc}% 100%`);
  return (
    <div className="donut" style={{ background: `conic-gradient(${stops.join(',')})` }} role="img"
      aria-label={parts.map((p) => `${p.l}: ${p.v}`).join(', ')}>
      <div className="donut-hole"><strong>{center}</strong><span>משימות</span></div>
    </div>
  );
}

export default function Dashboard({ ctx }) {
  const [items, setItems] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [div, setDiv] = useState('all');
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([db.list('budget_items', '&order=code'), db.list('tasks', '&order=id')])
      .then(([b, t]) => { setItems(b); setTasks(t); }).catch((x) => setErr(x.message));
  }, []);

  const openQ = [1, 2, 3, 4].map((q) => quarterState(ctx.quarters, q)).find((s) => s.open);
  const lastQ = openQ?.q || [4, 3, 2, 1].find((q) => quarterState(ctx.quarters, q).locked) || 1;

  const view = useMemo(() => {
    if (!items) return null;
    const scoped = div === 'all' ? items : items.filter((i) => String(i.division_id) === div);
    const scopedTasks = div === 'all' ? tasks : tasks.filter((t) => String(t.division_id) === div);
    const exp = scoped.filter((i) => i.kind === 'הוצאה');
    const inc = scoped.filter((i) => i.kind === 'הכנסה');
    const sum = (arr, f) => arr.reduce((a, x) => a + Number(x[f] || 0), 0);
    const e = { budget: sum(exp, 'budget_2026'), actual: sum(exp, 'actual_2026'), commit: sum(exp, 'commit_2026') };
    const i = { budget: sum(inc, 'budget_2026'), actual: sum(inc, 'actual_2026') };
    const groupKey = div === 'all' ? 'division_id' : 'department_id';
    const names = div === 'all' ? ctx.divById : ctx.deptById;
    const g = {};
    for (const x of exp) {
      const k = x[groupKey];
      g[k] ||= { key: String(k), name: names[k]?.name || '—', budget: 0, actual: 0, commit: 0 };
      g[k].budget += Number(x.budget_2026); g[k].actual += Number(x.actual_2026); g[k].commit += Number(x.commit_2026);
    }
    const groups = Object.values(g).map((r) => ({ ...r, used: r.actual + r.commit })).sort((a, b) => b.budget - a.budget);
    const overs = exp.filter(isOver).map((x) => ({ ...x, gap: used(x) - Number(x.budget_2026) })).sort((a, b) => b.gap - a.gap);
    const st = Object.fromEntries(STATUSES.map((s) => [s, 0])); let none = 0;
    for (const t of scopedTasks) { const s = t[`q${lastQ}_status`]; if (s) st[s]++; else none++; }
    const late = scopedTasks.filter((t) => isLate(t)).length;
    return { e, i, groups, overs, st, none, late, taskCount: scopedTasks.length, linked: scopedTasks.filter((t) => t.budget_item_id).length };
  }, [items, tasks, div]);

  if (err) return <div className="form-error">{err}</div>;
  if (!view) return <Loading />;
  const divOptions = ctx.divisions.filter((d) => items.some((i) => i.division_id === d.id));
  const usedE = view.e.actual + view.e.commit;

  return (
    <div className="stack">
      <div className="toolbar">
        {divOptions.length > 1 && (
          <label className="inline-field">הצג:
            <select value={div} onChange={(e) => setDiv(e.target.value)}>
              <option value="all">כל האגפים</option>
              {divOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        <span className="muted">נתוני ביצוע מעודכנים לסוף הרבעון השלישי של 2026 (בדויים)</span>
      </div>

      <section className="kpis">
        <Kpi label="תקציב הוצאות 2026" value={mil(view.e.budget)} sub={`${ctx.divisions.length && div === 'all' ? 'כלל העירייה' : ctx.divById[div]?.name}`} />
        <Kpi label="ביצוע ושריון" value={mil(usedE)} sub={`${pct(usedE, view.e.budget)}% מהתקציב · ביצוע ${mil(view.e.actual)}`}
          meter={<Meter value={usedE} max={view.e.budget} over={usedE > view.e.budget} />} />
        <Kpi label="יתרה לניצול" value={mil(view.e.budget - usedE)} tone={view.e.budget - usedE < 0 ? 'bad' : ''} sub="תקציב פחות ביצוע ושריון" />
        <Kpi label="הכנסות 2026" value={mil(view.i.actual)} sub={view.i.budget ? `${pct(view.i.actual, view.i.budget)}% מתוך ${mil(view.i.budget)}` : 'אין סעיפי הכנסה בהיקף זה'}
          meter={view.i.budget ? <Meter value={view.i.actual} max={view.i.budget} /> : null} />
        <Kpi label="סעיפים בחריגה" value={view.overs.length} tone={view.overs.length ? 'warn' : 'good'} sub="ביצוע ושריון מעל התקציב" />
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>{div === 'all' ? 'ניצול תקציב ההוצאות לפי אגף' : 'ניצול תקציב ההוצאות לפי מחלקה'}</h2>
            <div className="legend"><span><i className="lg-actual" />ביצוע</span><span><i className="lg-commit" />שריון</span><span><i className="lg-budget" />תקציב</span></div>
          </div>
          {view.groups.length ? <DivisionBars rows={view.groups} picked={null} onPick={div === 'all' ? (k) => setDiv(k) : undefined} />
            : <Empty title="אין סעיפי הוצאה בהיקף זה" />}
          {div === 'all' && view.groups.length > 1 && <p className="muted small">לחיצה על אגף תציג את הפירוט לפי מחלקות</p>}
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>תוכנית העבודה · רבעון {lastQ}</h2><a href="#/workplan" className="link">לתוכנית העבודה ←</a></div>
            <div className="donut-wrap">
              <Donut total={view.taskCount} center={view.taskCount}
                parts={[{ l: 'בוצע', v: view.st['בוצע'], c: '--done' }, { l: 'בתהליך', v: view.st['בתהליך'], c: '--prog' },
                  { l: 'עיכוב', v: view.st['עיכוב'], c: '--delay' }, { l: 'עצירה', v: view.st['עצירה'], c: '--stop' }]} />
              <ul className="donut-legend">
                {STATUSES.map((s) => <li key={s}><span className={`dot ${STATUS_CLASS[s]}`} />{s}<b>{view.st[s]}</b></li>)}
                <li><span className="dot st-none" />טרם עודכן<b>{view.none}</b></li>
              </ul>
            </div>
            <p className="muted small">{view.late} משימות עברו את תאריך היעד ללא סיום · {view.linked} מתוך {view.taskCount} משימות מקושרות לסעיף תקציבי</p>
          </section>

          <section className="card">
            <div className="card-head"><h2>החריגות הגדולות</h2><a href="#/budget?over=1" className="link">לכל החריגות ←</a></div>
            {view.overs.length ? (
              <table className="mini">
                <thead><tr><th>סעיף</th><th>מחלקה</th><th className="num">חריגה</th></tr></thead>
                <tbody>{view.overs.slice(0, 6).map((x) => (
                  <tr key={x.id}><td>{x.name}<div className="code">{x.code}</div></td><td>{ctx.deptById[x.department_id]?.name}</td><td className="num neg">{ils(x.gap)}</td></tr>
                ))}</tbody>
              </table>
            ) : <Empty title="אין סעיפים בחריגה" />}
          </section>
        </div>
      </div>
    </div>
  );
}

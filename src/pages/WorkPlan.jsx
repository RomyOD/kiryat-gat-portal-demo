import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../api.js';
import { PLAN_YEAR } from '../config.js';
import { Modal, Field, StatusChip, Loading, Empty, useToast, Confirm, scopeOptions } from '../ui.jsx';
import { STATUSES, STATUS_CLASS, fmtDate, quarterState, isLate, isWeekend, ils, num, norm, todayISO, byName } from '../util.js';
import { writeXlsx } from '../xlsx.js';

const blankTask = () => ({ task: '', deadline: '', success_metric: '', budget_item_id: '', est_cost: '', notes: '' });

function BudgetPicker({ items, deptId, value, onChange, ...rest }) {
  const own = items.filter((i) => i.department_id === Number(deptId) && i.kind === 'הוצאה');
  const other = items.filter((i) => i.department_id !== Number(deptId) && i.kind === 'הוצאה');
  return (
    <select {...rest} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">ללא סעיף תקציבי</option>
      {own.length > 0 && <optgroup label="סעיפי המחלקה">{own.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</optgroup>}
      {other.length > 0 && <optgroup label="סעיפים אחרים">{other.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</optgroup>}
    </select>
  );
}

function TaskDialog({ ctx, task, items, onClose, onSaved }) {
  const toast = useToast();
  const { divs, deps } = scopeOptions(ctx);
  const startDept = task?.department_id || (deps.length === 1 ? deps[0].id : '');
  const [head, setHead] = useState({
    division_id: task?.division_id || (startDept ? ctx.deptById[startDept].division_id : divs.length === 1 ? divs[0].id : ''),
    department_id: startDept, goal_id: task?.goal_id || '', activity: task?.activity || '',
  });
  const [list, setList] = useState(task ? [{ ...task, budget_item_id: task.budget_item_id || '', est_cost: task.est_cost ?? '' }] : [blankTask()]);
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false);
  const clearErr = (key) => setErr((x) => { if (!x[key]) return x; const y = { ...x }; delete y[key]; return y; });
  const setH = (k) => (e) => { clearErr(k); setHead({ ...head, [k]: e.target.value, ...(k === 'division_id' ? { department_id: '' } : {}) }); };
  const ERR_KEY = { task: 'task', deadline: 'deadline', success_metric: 'success', est_cost: 'cost' };
  const setT = (i, k, v) => { if (ERR_KEY[k]) clearErr(`${ERR_KEY[k]}${i}`); setList(list.map((t, j) => (j === i ? { ...t, [k]: v } : t))); };

  const save = async () => {
    const e = {};
    if (!head.department_id) e.department_id = 'יש לבחור מחלקה';
    if (!head.goal_id) e.goal_id = 'כל משימה חייבת להיות מקושרת למטרה עירונית';
    if (!head.activity.trim()) e.activity = 'שדה חובה';
    list.forEach((t, i) => {
      if (!t.task.trim()) e[`task${i}`] = 'שדה חובה';
      if (!t.deadline) e[`deadline${i}`] = 'שדה חובה';
      else if (!t.deadline.startsWith(String(PLAN_YEAR))) e[`deadline${i}`] = `תאריך היעד חייב להיות בשנת ${PLAN_YEAR}`;
      if (!t.success_metric.trim()) e[`success${i}`] = 'יש להגדיר כיצד תימדד ההצלחה';
      if (t.est_cost !== '' && !(Number(t.est_cost) >= 0)) e[`cost${i}`] = 'סכום לא תקין';
    });
    setErr(e); if (Object.keys(e).length) { toast('יש להשלים את השדות המסומנים', 'error'); return; }
    const rows = list.map((t) => ({
      department_id: Number(head.department_id), goal_id: Number(head.goal_id), activity: head.activity.trim(),
      task: t.task.trim(), deadline: t.deadline, success_metric: t.success_metric.trim(),
      budget_item_id: t.budget_item_id ? Number(t.budget_item_id) : null, est_cost: t.est_cost === '' ? null : Number(t.est_cost), notes: t.notes || null,
    }));
    setBusy(true);
    try {
      if (task) await db.update('tasks', task.id, rows[0]); else await db.insert('tasks', rows);
      toast(task ? 'המשימה עודכנה' : rows.length > 1 ? `${rows.length} משימות נשמרו` : 'המשימה נשמרה'); onSaved();
    } catch (x) { toast(x.message, 'error'); setBusy(false); }
  };

  return (
    <Modal title={task ? `עריכת משימה #${task.id}` : 'הוספת משימה לתוכנית העבודה'} onClose={onClose} wide
      footer={<><span className="grow" /><button className="btn ghost" onClick={onClose}>ביטול</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button></>}>
      <div className="form-grid">
        <Field label="אגף" required>
          <select value={head.division_id} onChange={setH('division_id')} disabled={divs.length === 1}>
            <option value="">בחר אגף</option>{divs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="מחלקה" required error={err.department_id}>
          <select value={head.department_id} onChange={setH('department_id')} disabled={deps.length === 1}>
            <option value="">בחר מחלקה</option>
            {deps.filter((d) => !head.division_id || d.division_id === Number(head.division_id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="מטרה עירונית" required error={err.goal_id}>
          <select value={head.goal_id} onChange={setH('goal_id')}>
            <option value="">בחר מטרה</option>{ctx.goals.map((g) => <option key={g.id} value={g.id}>{g.id}. {g.name}</option>)}
          </select>
        </Field>
        <Field label="פעילות" required error={err.activity} hint="שם הפעילות הרחבה, שתחתיה משימה אחת או יותר">
          <input value={head.activity} onChange={setH('activity')} />
        </Field>
      </div>
      {list.map((t, i) => (
        <div className="task-block" key={i}>
          <div className="task-block-head"><b>{task ? 'פרטי המשימה' : `משימה ${i + 1}`}</b>
            {list.length > 1 && <button className="btn ghost small" onClick={() => setList(list.filter((_, j) => j !== i))}>הסרה</button>}</div>
          <div className="form-grid">
            <Field label="תיאור המשימה" required error={err[`task${i}`]}><textarea rows={2} value={t.task} onChange={(e) => setT(i, 'task', e.target.value)} /></Field>
            <Field label="יעד הצלחה" required error={err[`success${i}`]} hint="מדד ברור: כמות, אחוז או תוצר"><textarea rows={2} value={t.success_metric} onChange={(e) => setT(i, 'success_metric', e.target.value)} /></Field>
            <Field label="תאריך יעד" required error={err[`deadline${i}`]} hint={t.deadline && isWeekend(t.deadline) ? 'שים לב: התאריך חל בסוף שבוע' : undefined}>
              <input type="date" value={t.deadline} min={`${PLAN_YEAR}-01-01`} max={`${PLAN_YEAR}-12-31`} onChange={(e) => setT(i, 'deadline', e.target.value)} />
            </Field>
            <Field label="סעיף תקציבי"><BudgetPicker items={items} deptId={head.department_id} value={t.budget_item_id} onChange={(v) => setT(i, 'budget_item_id', v)} /></Field>
            <Field label="אומדן עלות (₪)" error={err[`cost${i}`]}><input type="number" min="0" step="1000" dir="ltr" value={t.est_cost} onChange={(e) => setT(i, 'est_cost', e.target.value)} /></Field>
            <Field label="הערות וחסמים"><input value={t.notes || ''} onChange={(e) => setT(i, 'notes', e.target.value)} /></Field>
          </div>
        </div>
      ))}
      {!task && <button className="btn ghost" onClick={() => setList([...list, blankTask()])}>+ משימה נוספת לאותה פעילות</button>}
    </Modal>
  );
}

function QuarterDialog({ ctx, task, q, mine, onClose, onSaved }) {
  const toast = useToast();
  const st = quarterState(ctx.quarters, q);
  const canEdit = mine && (st.open || ctx.can.admin);
  const [s, setS] = useState(task[`q${q}_status`] || ''); const [note, setNote] = useState(task[`q${q}_note`] || ''); const [busy, setBusy] = useState(false);
  const prev = q > 1 ? task[`q${q - 1}_status`] : null;
  const save = async () => {
    if (!s) { toast('יש לבחור סטטוס', 'error'); return; }
    if ((s === 'עיכוב' || s === 'עצירה') && !note.trim()) { toast('בעיכוב או בעצירה יש לפרט את הסיבה', 'error'); return; }
    setBusy(true);
    try { await db.update('tasks', task.id, { [`q${q}_status`]: s, [`q${q}_note`]: note.trim() || null }); toast(`עדכון רבעון ${q} נשמר`); onSaved(); }
    catch (x) { toast(x.message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={`עדכון רבעון ${q} · משימה #${task.id}`} onClose={onClose}
      footer={<><span className="grow" /><button className="btn ghost" onClick={onClose}>{canEdit ? 'ביטול' : 'סגירה'}</button>{canEdit && <button className="btn primary" onClick={save} disabled={busy}>שמירה</button>}</>}>
      <div className="task-summary"><b>{task.task}</b><span>יעד: {task.success_metric} · עד {fmtDate(task.deadline)}</span></div>
      {mine && !st.open && <div className={`notice ${ctx.can.admin ? 'info' : 'warn'}`}>רבעון {q} {st.label}. {ctx.can.admin ? 'כמנהל מערכת באפשרותך לעדכן בכל זאת.' : 'לפתיחת העדכון יש לפנות למנהל המערכת.'}</div>}
      {prev && <p className="muted small">סטטוס ברבעון הקודם: {prev}</p>}
      <div className="status-pick" role="radiogroup" aria-label="סטטוס">
        {STATUSES.map((x) => (
          <button key={x} type="button" role="radio" aria-checked={s === x} disabled={!canEdit}
            className={`chip big ${STATUS_CLASS[x]} ${s === x ? 'selected' : ''}`} onClick={() => setS(x)}>{x}</button>
        ))}
      </div>
      <Field label="הערה" hint={s === 'עיכוב' || s === 'עצירה' ? 'חובה לפרט את הסיבה ואת הצעדים להמשך' : 'אופציונלי'}>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} />
      </Field>
    </Modal>
  );
}

export default function WorkPlan({ ctx }) {
  const toast = useToast();
  const [tasks, setTasks] = useState(null); const [items, setItems] = useState([]);
  const [q, setQ] = useState(''); const [div, setDiv] = useState(''); const [dep, setDep] = useState(''); const [goal, setGoal] = useState('');
  const openQ = [1, 2, 3, 4].map((x) => quarterState(ctx.quarters, x)).find((s) => s.open);
  const [viewQ, setViewQ] = useState(openQ?.q || 3);
  const [stFilter, setStFilter] = useState(''); const [lateOnly, setLateOnly] = useState(false);
  const [edit, setEdit] = useState(null); const [qd, setQd] = useState(null); const [del, setDel] = useState(null);

  const load = () => Promise.all([db.list('tasks', '&order=division_id,department_id,id'), db.list('budget_items', '&select=id,code,name,kind,department_id&order=code')])
    .then(([t, b]) => { setTasks(t); setItems(b); }).catch((x) => toast(x.message, 'error'));
  useEffect(() => { load(); }, []);

  const scoped = useMemo(() => (tasks || []).filter((t) => (!div || String(t.division_id) === div) && (!dep || String(t.department_id) === dep)), [tasks, div, dep]);
  const rows = useMemo(() => {
    const nq = norm(q);
    return scoped.filter((t) => (!goal || String(t.goal_id) === goal)
      && (!stFilter || (stFilter === 'none' ? !t[`q${viewQ}_status`] : t[`q${viewQ}_status`] === stFilter))
      && (!lateOnly || isLate(t))
      && (!nq || norm(t.task).includes(nq) || norm(t.activity).includes(nq) || String(t.id) === nq));
  }, [scoped, q, goal, stFilter, lateOnly, viewQ]);

  if (!tasks) return <Loading />;
  const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, scoped.filter((t) => t[`q${viewQ}_status`] === s).length]));
  const noneCount = scoped.filter((t) => !t[`q${viewQ}_status`]).length;
  const lateCount = scoped.filter((t) => isLate(t)).length;
  const byGoal = ctx.goals.map((g) => ({ g, n: scoped.filter((t) => t.goal_id === g.id).length }));
  const maxGoal = Math.max(1, ...byGoal.map((x) => x.n));
  const divOptions = ctx.divisions.filter((d) => tasks.some((t) => t.division_id === d.id));
  const depOptions = ctx.departments.filter((d) => (!div || String(d.division_id) === div) && tasks.some((t) => t.department_id === d.id));
  const myPending = openQ ? tasks.filter((t) => !t[`q${openQ.q}_status`]).length : 0;

  const canEditRow = (t) => ctx.can.admin || (ctx.profile.role === 'wing' && t.division_id === ctx.myDivision) || (ctx.profile.role === 'dept' && t.department_id === ctx.profile.department_id);
  const remove = async () => {
    try { await db.remove('tasks', del.id); toast('המשימה נמחקה'); setDel(null); load(); } catch (x) { toast(x.message, 'error'); setDel(null); }
  };
  const exportXlsx = () => writeXlsx(`workplan_${PLAN_YEAR}_kiryat_gat.xlsx`, `תוכנית עבודה ${PLAN_YEAR}`,
    ['מס"ד', 'אגף', 'מחלקה', 'מטרה עירונית', 'פעילות', 'משימה', 'יעד הצלחה', 'תאריך יעד', 'סעיף תקציבי', 'אומדן עלות',
      'ר1 סטטוס', 'ר1 הערה', 'ר2 סטטוס', 'ר2 הערה', 'ר3 סטטוס', 'ר3 הערה', 'ר4 סטטוס', 'ר4 הערה'],
    rows.map((t) => [t.id, ctx.divById[t.division_id]?.name, ctx.deptById[t.department_id]?.name, ctx.goalById[t.goal_id]?.name, t.activity, t.task,
      t.success_metric, fmtDate(t.deadline), itemById[t.budget_item_id] ? `${itemById[t.budget_item_id].code} ${itemById[t.budget_item_id].name}` : '',
      t.est_cost === null ? '' : Number(t.est_cost), ...[1, 2, 3, 4].flatMap((x) => [t[`q${x}_status`] || '', t[`q${x}_note`] || ''])]),
    [7, 24, 24, 26, 22, 40, 30, 11, 30, 12, 9, 22, 9, 22, 9, 22, 9, 22]);

  return (
    <div className="stack">
      {openQ && ctx.can.editTasks && (
        <div className={`notice ${openQ.daysLeft <= 7 ? 'warn' : 'info'}`}>
          <b>עדכון רבעון {openQ.q} פתוח עד {fmtDate(openQ.locks_at)}</b> · נותרו {openQ.daysLeft} ימים · {myPending} משימות בהיקף שלך טרם עודכנו
          {myPending > 0 && <button className="btn small ghost" onClick={() => { setViewQ(openQ.q); setStFilter('none'); }}>הצג משימות שטרם עודכנו</button>}
        </div>
      )}

      <div className="grid-2 narrow-side">
        <section className="card">
          <div className="card-head">
            <h2>סטטוס משימות</h2>
            <div className="seg" role="tablist" aria-label="רבעון">
              {[1, 2, 3, 4].map((x) => <button key={x} role="tab" aria-selected={viewQ === x} className={viewQ === x ? 'on' : ''} onClick={() => setViewQ(x)}>רבעון {x}</button>)}
            </div>
          </div>
          <div className="status-cards">
            {STATUSES.map((s) => (
              <button key={s} className={`status-card ${STATUS_CLASS[s]} ${stFilter === s ? 'selected' : ''}`} onClick={() => setStFilter(stFilter === s ? '' : s)}>
                <span>{s}</span><b>{counts[s]}</b></button>
            ))}
            <button className={`status-card st-none ${stFilter === 'none' ? 'selected' : ''}`} onClick={() => setStFilter(stFilter === 'none' ? '' : 'none')}><span>טרם עודכן</span><b>{noneCount}</b></button>
            <button className={`status-card st-late ${lateOnly ? 'selected' : ''}`} onClick={() => setLateOnly(!lateOnly)}><span>עבר תאריך היעד</span><b>{lateCount}</b></button>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>משימות לפי מטרה עירונית</h2></div>
          <div className="goal-bars">
            {byGoal.map(({ g, n }) => (
              <button key={g.id} className={`goal-row ${goal === String(g.id) ? 'picked' : ''}`} onClick={() => setGoal(goal === String(g.id) ? '' : String(g.id))} title={g.description}>
                <span className="goal-name">{g.name}</span><span className="goal-track"><span style={{ width: `${(n / maxGoal) * 100}%` }} /></span><b>{n}</b>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="toolbar wrap">
        <input className="search" placeholder="חיפוש משימה, פעילות או מספר" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש" />
        {divOptions.length > 1 && <select value={div} onChange={(e) => { setDiv(e.target.value); setDep(''); }} aria-label="אגף"><option value="">כל האגפים</option>{divOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        {depOptions.length > 1 && <select value={dep} onChange={(e) => setDep(e.target.value)} aria-label="מחלקה"><option value="">כל המחלקות</option>{depOptions.sort(byName).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        <select value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="מטרה"><option value="">כל המטרות</option>{ctx.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        {(stFilter || lateOnly || goal || q || div || dep) && <button className="btn ghost small" onClick={() => { setStFilter(''); setLateOnly(false); setGoal(''); setQ(''); setDiv(''); setDep(''); }}>ניקוי סינון</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={exportXlsx}>ייצוא ל-Excel</button>
        {ctx.can.editTasks && <button className="btn primary" onClick={() => setEdit({})}>+ משימה חדשה</button>}
      </div>
      <div className="summary-line"><span>מוצגות <b>{rows.length}</b> מתוך {scoped.length} משימות</span><span>אומדן עלות כולל: <b>{ils(rows.reduce((a, t) => a + Number(t.est_cost || 0), 0))}</b></span></div>

      {rows.length === 0 ? <Empty title="לא נמצאו משימות">שנה את הסינון, או הוסף משימה חדשה</Empty> : (
        <div className="table-wrap">
          <table className="grid tasks">
            <thead><tr><th>#</th><th>מחלקה</th><th>מטרה</th><th>פעילות ומשימה</th><th>יעד הצלחה</th><th>תאריך יעד</th><th>סעיף ואומדן</th>
              {[1, 2, 3, 4].map((x) => <th key={x} className={`qcol ${x === viewQ ? 'cur' : ''}`}>ר{x}</th>)}<th /></tr></thead>
            <tbody>{rows.map((t) => {
              const late = isLate(t); const bi = itemById[t.budget_item_id]; const mine = canEditRow(t);
              return (
                <tr key={t.id} className={late ? 'row-late' : ''}>
                  <td className="code">{t.id}</td>
                  <td><div>{ctx.deptById[t.department_id]?.name}</div><div className="muted small">{ctx.divById[t.division_id]?.name}</div></td>
                  <td><span className="goal-tag" title={ctx.goalById[t.goal_id]?.name}>{t.goal_id}</span></td>
                  <td className="wide-cell"><div className="muted small">{t.activity}</div><div>{t.task}</div>{t.notes && <div className="note-line">{t.notes}</div>}</td>
                  <td className="mid-cell">{t.success_metric}</td>
                  <td className={late ? 'neg nowrap' : 'nowrap'}>{fmtDate(t.deadline)}{late && <div className="small">באיחור</div>}</td>
                  <td className="small nowrap" title={bi ? `${bi.code} · ${bi.name}` : undefined}>{bi ? <div className="code">{bi.code}</div> : <span className="muted">ללא סעיף</span>}
                    {t.est_cost !== null && <div>{ils(t.est_cost)}</div>}</td>
                  {[1, 2, 3, 4].map((x) => (
                    <td key={x} className={`qcol ${x === viewQ ? 'cur' : ''}`}>
                      <StatusChip s={t[`q${x}_status`]} title={t[`q${x}_note`] || undefined} onClick={() => setQd({ t, q: x })} />
                    </td>
                  ))}
                  <td className="nowrap">{mine && <><button className="icon-btn" title="עריכה" aria-label="עריכה" onClick={() => setEdit(t)}>✎</button>
                    <button className="icon-btn" title="מחיקה" aria-label="מחיקה" onClick={() => setDel(t)}>🗑</button></>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <div className="goal-key small muted">{ctx.goals.map((g) => <span key={g.id}><span className="goal-tag">{g.id}</span> {g.name}</span>)}</div>

      {edit && <TaskDialog ctx={ctx} task={edit.id ? edit : null} items={items} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {qd && <QuarterDialog ctx={ctx} task={qd.t} q={qd.q} mine={canEditRow(qd.t)} onClose={() => setQd(null)} onSaved={() => { setQd(null); load(); }} />}
      {del && <Confirm danger yes="מחיקה" text={`למחוק את משימה #${del.id}: ${del.task}?`} onYes={remove} onNo={() => setDel(null)} />}
    </div>
  );
}

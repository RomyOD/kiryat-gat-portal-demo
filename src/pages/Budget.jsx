import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../api.js';
import { Modal, Field, Meter, Loading, Empty, useToast, Confirm } from '../ui.jsx';
import { ils, num, pct, used, isOver, norm, byName } from '../util.js';
import { writeXlsx, readTable, toNumber } from '../xlsx.js';

const NUMS = [
  ['actual_2025', 'ביצוע 2025'], ['budget_2026', 'תקציב 2026'], ['actual_2026', 'ביצוע 2026'], ['commit_2026', 'שריון 2026'],
];
const HEADERS = ['קוד סעיף', 'שם סעיף', 'סוג', 'אגף', 'מחלקה', 'ביצוע 2025', 'תקציב 2026', 'ביצוע 2026', 'שריון 2026', 'יתרה', 'אחוז ניצול'];
const ALIASES = {
  code: ['קוד סעיף', 'קוד', 'סעיף', 'מספר סעיף', 'code'], name: ['שם סעיף', 'שם', 'תיאור', 'name'], kind: ['סוג', 'הכנסה/הוצאה', 'kind'],
  dept: ['מחלקה', 'department'], actual_2025: ['ביצוע 2025'], budget_2026: ['תקציב 2026', 'תקציב'], actual_2026: ['ביצוע 2026', 'ביצוע'],
  commit_2026: ['שריון 2026', 'שריון', 'התחייבות'],
};

function ItemDialog({ ctx, item, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(item || { code: '', name: '', kind: 'הוצאה', department_id: '', actual_2025: 0, budget_2026: 0, actual_2026: 0, commit_2026: 0, notes: '' });
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false); const [del, setDel] = useState(false);
  const set = (k) => (e) => { setErr((x) => ({ ...x, [k]: undefined })); setF({ ...f, [k]: e.target.value }); };
  const divId = f.department_id ? ctx.deptById[f.department_id]?.division_id : f._div;
  const save = async () => {
    const e = {};
    if (!String(f.code).trim()) e.code = 'שדה חובה';
    if (!String(f.name).trim()) e.name = 'שדה חובה';
    if (!f.department_id) e.department_id = 'יש לבחור מחלקה';
    for (const [k] of NUMS) if (!Number.isFinite(Number(f[k]))) e[k] = 'מספר לא תקין';
    setErr(e); if (Object.values(e).some(Boolean)) return;
    const row = { code: String(f.code).trim(), name: f.name.trim(), kind: f.kind, department_id: Number(f.department_id), notes: f.notes || null,
      ...Object.fromEntries(NUMS.map(([k]) => [k, Number(f[k]) || 0])) };
    setBusy(true);
    try {
      if (item) await db.update('budget_items', item.id, row); else await db.insert('budget_items', row);
      toast(item ? 'הסעיף עודכן' : 'הסעיף נוסף'); onSaved();
    } catch (x) { toast(x.message, 'error'); setBusy(false); }
  };
  const remove = async () => {
    try { await db.remove('budget_items', item.id); toast('הסעיף נמחק'); onSaved(); } catch (x) { toast(x.message, 'error'); setDel(false); }
  };
  const ro = !ctx.can.editBudget;
  return (
    <Modal title={item ? `סעיף ${item.code}` : 'הוספת סעיף תקציב'} onClose={onClose} wide
      footer={<>
        {item && ctx.can.admin && <button className="btn danger ghost" onClick={() => setDel(true)}>מחיקה</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>{ro ? 'סגירה' : 'ביטול'}</button>
        {!ro && <button className="btn primary" onClick={save} disabled={busy}>שמירה</button>}
      </>}>
      <fieldset disabled={ro} className="form-grid">
        <Field label="קוד סעיף" required error={err.code}><input value={f.code} onChange={set('code')} dir="ltr" disabled={!!item} /></Field>
        <Field label="סוג" required>
          <select value={f.kind} onChange={set('kind')}><option>הוצאה</option><option>הכנסה</option></select>
        </Field>
        <Field label="שם סעיף" required error={err.name}><input value={f.name} onChange={set('name')} /></Field>
        <Field label="אגף">
          <select value={divId || ''} onChange={(e) => setF({ ...f, _div: Number(e.target.value), department_id: '' })}>
            <option value="">בחר אגף</option>
            {ctx.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="מחלקה" required error={err.department_id}>
          <select value={f.department_id || ''} onChange={set('department_id')}>
            <option value="">בחר מחלקה</option>
            {ctx.departments.filter((d) => !divId || d.division_id === divId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        {NUMS.map(([k, l]) => (
          <Field key={k} label={`${l} (₪)`} error={err[k]}><input type="number" inputMode="decimal" value={f[k]} onChange={set(k)} dir="ltr" step="1000" /></Field>
        ))}
        <Field label="הערות"><textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
      </fieldset>
      {item && <p className="muted small">יתרה: {ils(Number(f.budget_2026) - Number(f.actual_2026) - Number(f.commit_2026))} · ניצול {pct(Number(f.actual_2026) + Number(f.commit_2026), Number(f.budget_2026))}%</p>}
      {del && <Confirm danger yes="מחיקה" text={`למחוק את הסעיף ${item.code} ${item.name}? משימות המקושרות אליו יישארו ללא סעיף.`} onYes={remove} onNo={() => setDel(false)} />}
    </Modal>
  );
}

function ImportDialog({ ctx, items, onClose, onDone }) {
  const toast = useToast();
  const [plan, setPlan] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const pick = async (file) => {
    setErr(''); setPlan(null);
    try {
      const rows = await readTable(file);
      if (rows.length < 2) throw new Error('הקובץ ריק');
      const head = rows[0].map(norm);
      const col = {};
      for (const [k, al] of Object.entries(ALIASES)) { const i = head.findIndex((h) => al.map(norm).includes(h)); if (i >= 0) col[k] = i; }
      if (col.code === undefined) throw new Error('לא נמצאה עמודת "קוד סעיף" בשורת הכותרות');
      const byCode = Object.fromEntries(items.map((i) => [String(i.code), i]));
      const deptByName = {}; for (const d of ctx.departments) deptByName[norm(d.name)] = d;
      const updates = []; const inserts = []; const errors = []; let same = 0;
      rows.slice(1).forEach((r, idx) => {
        const line = idx + 2; const code = String(r[col.code] ?? '').trim();
        if (!code) return;
        const vals = {};
        for (const [k] of NUMS) if (col[k] !== undefined) {
          const n = toNumber(r[col[k]]);
          if (Number.isNaN(n)) { errors.push(`שורה ${line}: ערך לא מספרי בעמודה ${k.replace('_', ' ')}`); return; }
          if (n !== null) vals[k] = n;
        }
        const ex = byCode[code];
        if (ex) {
          const patch = {};
          for (const [k, v] of Object.entries(vals)) if (Number(ex[k]) !== v) patch[k] = v;
          if (col.name !== undefined && String(r[col.name]).trim() && String(r[col.name]).trim() !== ex.name) patch.name = String(r[col.name]).trim();
          if (Object.keys(patch).length) updates.push({ ex, patch }); else same++;
        } else {
          const dep = deptByName[norm(r[col.dept])];
          const kind = String(r[col.kind] ?? '').trim() || 'הוצאה';
          const name = String(r[col.name] ?? '').trim();
          if (!dep) errors.push(`שורה ${line}: סעיף חדש ${code} - מחלקה "${r[col.dept] ?? ''}" לא נמצאה`);
          else if (!name) errors.push(`שורה ${line}: סעיף חדש ${code} - חסר שם סעיף`);
          else if (!['הוצאה', 'הכנסה'].includes(kind)) errors.push(`שורה ${line}: סוג "${kind}" אינו הוצאה או הכנסה`);
          else inserts.push({ code, name, kind, department_id: dep.id, actual_2025: 0, budget_2026: 0, actual_2026: 0, commit_2026: 0, ...vals });
        }
      });
      setPlan({ updates, inserts, errors, same, file: file.name });
    } catch (x) { setErr(x.message); }
  };
  const apply = async () => {
    setBusy(true); let done = 0;
    try {
      const queue = [...plan.updates];
      const worker = async () => { while (queue.length) { const u = queue.shift(); await db.update('budget_items', u.ex.id, u.patch); setProgress(++done); } };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (plan.inserts.length) await db.insert('budget_items', plan.inserts);
      toast(`הייבוא הושלם: ${plan.updates.length} סעיפים עודכנו, ${plan.inserts.length} נוספו`); onDone();
    } catch (x) { toast(`הייבוא נעצר: ${x.message}`, 'error'); setBusy(false); onDone(true); }
  };
  return (
    <Modal title="ייבוא נתוני תקציב מקובץ" onClose={onClose} wide
      footer={<><button className="btn ghost" onClick={onClose}>ביטול</button>
        {plan && <button className="btn primary" disabled={busy || (!plan.updates.length && !plan.inserts.length)} onClick={apply}>
          {busy ? `מעדכן… ${progress}/${plan.updates.length}` : 'אישור ועדכון'}</button>}</>}>
      <p>יש לבחור קובץ Excel או CSV שיוצא ממערכת הכספים. העמודה <b>קוד סעיף</b> היא חובה; שאר העמודות מזוהות לפי שם הכותרת, כמו בקובץ הייצוא של המערכת.</p>
      <ul className="small muted">
        <li>סעיף קיים: עמודות הסכומים ושם הסעיף יעודכנו.</li>
        <li>סעיף חדש: נדרשים גם שם סעיף, סוג ושם מחלקה כפי שמופיע במערכת.</li>
        <li>לפני העדכון תוצג תצוגה מקדימה, ושום נתון לא ישתנה ללא אישור.</li>
      </ul>
      <input type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files[0] && pick(e.target.files[0])} />
      {err && <div className="form-error">{err}</div>}
      {plan && (
        <div className="import-plan">
          <div className="kpis compact">
            <div className="kpi"><div className="kpi-label">יעודכנו</div><div className="kpi-value">{plan.updates.length}</div></div>
            <div className="kpi"><div className="kpi-label">חדשים</div><div className="kpi-value">{plan.inserts.length}</div></div>
            <div className="kpi"><div className="kpi-label">ללא שינוי</div><div className="kpi-value">{plan.same}</div></div>
            <div className={`kpi ${plan.errors.length ? 'bad' : ''}`}><div className="kpi-label">שגיאות</div><div className="kpi-value">{plan.errors.length}</div></div>
          </div>
          {plan.errors.length > 0 && <div className="form-error"><b>שורות שלא ייקלטו:</b><ul>{plan.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul></div>}
          {plan.updates.length > 0 && (
            <div className="table-wrap short"><table className="mini">
              <thead><tr><th>קוד</th><th>סעיף</th><th>שדה</th><th className="num">ערך קודם</th><th className="num">ערך חדש</th></tr></thead>
              <tbody>{plan.updates.slice(0, 40).flatMap((u) => Object.entries(u.patch).map(([k, v]) => (
                <tr key={u.ex.id + k}><td className="code">{u.ex.code}</td><td>{u.ex.name}</td><td>{NUMS.find((n) => n[0] === k)?.[1] || 'שם סעיף'}</td>
                  <td className="num">{k === 'name' ? u.ex.name : num(u.ex[k])}</td><td className="num"><b>{k === 'name' ? v : num(v)}</b></td></tr>
              )))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function Budget({ ctx }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState(''); const [div, setDiv] = useState(''); const [dep, setDep] = useState(''); const [kind, setKind] = useState('');
  const [over, setOver] = useState(() => /over=1/.test(location.hash));
  const [edit, setEdit] = useState(null); const [imp, setImp] = useState(false);
  const [sort, setSort] = useState({ k: 'code', dir: 1 });
  const toast = useToast();
  const load = () => db.list('budget_items', '&order=code').then(setItems).catch((x) => toast(x.message, 'error'));
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!items) return [];
    const nq = norm(q);
    let r = items.filter((i) => (!div || String(i.division_id) === div) && (!dep || String(i.department_id) === dep) && (!kind || i.kind === kind)
      && (!over || isOver(i)) && (!nq || norm(i.name).includes(nq) || i.code.includes(nq) || norm(ctx.deptById[i.department_id]?.name).includes(nq)));
    const val = (i) => sort.k === 'left' ? Number(i.budget_2026) - used(i) : sort.k === 'pct' ? (Number(i.budget_2026) ? used(i) / Number(i.budget_2026) : 0)
      : sort.k === 'dept' ? ctx.deptById[i.department_id]?.name || '' : i[sort.k];
    return [...r].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y, 'he') : x - y) * sort.dir; });
  }, [items, q, div, dep, kind, over, sort]);

  if (!items) return <Loading />;
  const divOptions = ctx.divisions.filter((d) => items.some((i) => i.division_id === d.id));
  const depOptions = ctx.departments.filter((d) => (!div || String(d.division_id) === div) && items.some((i) => i.department_id === d.id));
  const exp = rows.filter((r) => r.kind === 'הוצאה'); const inc = rows.filter((r) => r.kind === 'הכנסה');
  const s = (arr, k) => arr.reduce((a, x) => a + Number(x[k] || 0), 0);
  const th = (k, l, cls = '') => (
    <th className={`${cls} sortable`} onClick={() => setSort({ k, dir: sort.k === k ? -sort.dir : 1 })} aria-sort={sort.k === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      {l}{sort.k === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>
  );
  const exportXlsx = () => writeXlsx(`budget_kiryat_gat_${new Date().toISOString().slice(0, 10)}.xlsx`, 'סעיפי תקציב', HEADERS,
    rows.map((i) => [i.code, i.name, i.kind, ctx.divById[i.division_id]?.name || '', ctx.deptById[i.department_id]?.name || '',
      Number(i.actual_2025), Number(i.budget_2026), Number(i.actual_2026), Number(i.commit_2026), Number(i.budget_2026) - used(i), pct(used(i), Number(i.budget_2026))]),
    [14, 36, 8, 28, 28, 14, 14, 14, 14, 14, 10]);

  return (
    <div className="stack">
      <div className="toolbar wrap">
        <input className="search" placeholder="חיפוש לפי שם, קוד או מחלקה" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש" />
        {divOptions.length > 1 && <select value={div} onChange={(e) => { setDiv(e.target.value); setDep(''); }} aria-label="אגף"><option value="">כל האגפים</option>{divOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        {depOptions.length > 1 && <select value={dep} onChange={(e) => setDep(e.target.value)} aria-label="מחלקה"><option value="">כל המחלקות</option>{depOptions.sort(byName).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="סוג"><option value="">הכנסות והוצאות</option><option>הוצאה</option><option>הכנסה</option></select>
        <label className="check"><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} /> חריגות בלבד</label>
        <span className="grow" />
        <button className="btn ghost" onClick={exportXlsx}>ייצוא ל-Excel</button>
        {ctx.can.editBudget && <button className="btn ghost" onClick={() => setImp(true)}>ייבוא מקובץ</button>}
        {ctx.can.editBudget && <button className="btn primary" onClick={() => setEdit({})}>+ סעיף חדש</button>}
      </div>

      <div className="summary-line">
        <span>מוצגים <b>{rows.length}</b> סעיפים</span>
        <span>הוצאות: תקציב <b>{ils(s(exp, 'budget_2026'))}</b> · ביצוע ושריון <b>{ils(s(exp, 'actual_2026') + s(exp, 'commit_2026'))}</b></span>
        <span>הכנסות: תקציב <b>{ils(s(inc, 'budget_2026'))}</b> · ביצוע <b>{ils(s(inc, 'actual_2026'))}</b></span>
        {!ctx.can.editBudget && <span className="muted">צפייה בלבד · עדכון התקציב מתבצע על ידי הגזברות</span>}
      </div>

      {rows.length === 0 ? <Empty title="לא נמצאו סעיפים">נסה לשנות את החיפוש או הסינון</Empty> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr>
              {th('code', 'קוד')}{th('name', 'שם סעיף')}{th('kind', 'סוג')}{th('dept', 'מחלקה')}
              {th('actual_2025', 'ביצוע 2025', 'num')}{th('budget_2026', 'תקציב 2026', 'num')}{th('actual_2026', 'ביצוע 2026', 'num')}
              {th('commit_2026', 'שריון', 'num')}{th('left', 'יתרה', 'num')}{th('pct', 'ניצול', 'num')}
            </tr></thead>
            <tbody>{rows.map((i) => {
              const o = isOver(i); const left = Number(i.budget_2026) - used(i);
              return (
                <tr key={i.id} className={`click ${o ? 'row-over' : ''}`} onClick={() => setEdit(i)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdit(i)}>
                  <td className="code">{i.code}</td><td>{i.name}</td>
                  <td><span className={`kind ${i.kind === 'הכנסה' ? 'inc' : 'exp'}`}>{i.kind}</span></td>
                  <td className="muted">{ctx.deptById[i.department_id]?.name}</td>
                  <td className="num">{num(i.actual_2025)}</td><td className="num"><b>{num(i.budget_2026)}</b></td>
                  <td className="num">{num(i.actual_2026)}</td><td className="num">{num(i.commit_2026)}</td>
                  <td className={`num ${left < 0 && i.kind === 'הוצאה' ? 'neg' : ''}`}>{num(left)}</td>
                  <td className="num pct-cell"><Meter value={used(i)} max={Number(i.budget_2026)} over={o} /><span>{pct(used(i), Number(i.budget_2026))}%</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {edit && <ItemDialog ctx={ctx} item={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {imp && <ImportDialog ctx={ctx} items={items} onClose={() => setImp(false)} onDone={(keep) => { if (!keep) setImp(false); load(); }} />}
    </div>
  );
}

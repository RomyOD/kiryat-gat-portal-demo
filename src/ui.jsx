import React, { useEffect, useRef, useState, useId, createContext, useContext } from 'react';
import { STATUS_CLASS } from './util.js';

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    ref.current?.querySelector('input,select,textarea')?.focus();
    return () => document.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="סגירת החלון">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, required, hint, error, children }) {
  const id = useId();
  const msgId = `${id}-msg`;
  const child = React.isValidElement(children)
    ? React.cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': hint || error ? msgId : undefined, 'aria-required': required || undefined })
    : children;
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label className="field-label" htmlFor={id}>{label}{required && <b className="req" aria-hidden="true"> *</b>}</label>
      {child}
      {hint && !error && <span className="field-hint" id={msgId}>{hint}</span>}
      {error && <span className="field-error" id={msgId} role="alert">{error}</span>}
    </div>
  );
}

export const StatusChip = ({ s, onClick, title, disabled }) => (
  <button type="button" className={`chip ${s ? STATUS_CLASS[s] : 'st-none'} ${onClick && !disabled ? 'clickable' : ''}`}
    onClick={onClick} disabled={!onClick || disabled} title={title}>{s || 'טרם עודכן'}</button>
);

export function Meter({ value, max, over }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <span className={`meter ${over ? 'over' : ''}`} aria-hidden="true"><span style={{ width: `${p}%` }} /></span>;
}

export function Kpi({ label, value, sub, tone, meter }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{typeof value === 'string' && value.endsWith(' מיליון') ? <>{value.slice(0, -7)}<small> מיליון</small></>
        : typeof value === 'string' && value.endsWith(' אלף') ? <>{value.slice(0, -4)}<small> אלף</small></> : value}</div>
      {meter}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children }) {
  return <div className="empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

export function Loading() { return <div className="loading" role="status"><span className="spinner" /> טוען נתונים…</div>; }

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = (text, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 6000 : 3000);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.slice(-3).map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export function Confirm({ text, onYes, onNo, yes = 'אישור', danger }) {
  return (
    <Modal title="אישור פעולה" onClose={onNo}
      footer={<><button className="btn ghost" onClick={onNo}>ביטול</button><button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onYes}>{yes}</button></>}>
      <p>{text}</p>
    </Modal>
  );
}

// בורר אגף ומחלקה בהתאם להיקף ההרשאה של המשתמש
export function scopeOptions(ctx) {
  const { profile, divisions, departments } = ctx;
  let divs = divisions; let deps = departments;
  if (profile.role === 'wing') { divs = divisions.filter((d) => d.id === ctx.myDivision); deps = departments.filter((d) => d.division_id === ctx.myDivision); }
  if (profile.role === 'dept') { deps = departments.filter((d) => d.id === profile.department_id); divs = divisions.filter((d) => deps.some((x) => x.division_id === d.id)); }
  return { divs, deps };
}

const ICONS = {
  dashboard: <><path d="M12 3v9h9" /><path d="M20.5 15A9 9 0 1 1 9 3.5" /></>,
  budget: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></>,
  workplan: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5" /></>,
};
export const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
);

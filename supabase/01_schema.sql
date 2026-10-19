-- =====================================================================
-- פורטל תקציב ותוכניות עבודה - עיריית קרית גת (סביבת הדגמה)
-- קובץ 1 מתוך 2: מבנה מסד הנתונים, הרשאות ואבטחה
-- להרצה פעם אחת ב-Supabase: SQL Editor > New query > הדבקה > Run
-- =====================================================================

-- ---------- טבלאות ----------
create table if not exists public.divisions (
  id serial primary key,
  name text not null unique,
  sort int not null default 0
);

create table if not exists public.departments (
  id serial primary key,
  division_id int not null references public.divisions(id) on delete cascade,
  name text not null,
  sort int not null default 0,
  unique (division_id, name)
);

create table if not exists public.goals (
  id serial primary key,
  name text not null unique,
  description text,
  sort int not null default 0
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text,
  role text not null default 'none'
    check (role in ('admin','treasurer','wing','dept','viewer','none')),
  division_id int references public.divisions(id),
  department_id int references public.departments(id),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.budget_items (
  id serial primary key,
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('הוצאה','הכנסה')),
  division_id int references public.divisions(id),
  department_id int not null references public.departments(id),
  actual_2025 numeric not null default 0,
  budget_2026 numeric not null default 0,
  actual_2026 numeric not null default 0,
  commit_2026 numeric not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.quarters (
  q int primary key check (q between 1 and 4),
  opens_at date not null,
  locks_at date not null
);

create table if not exists public.tasks (
  id serial primary key,
  division_id int references public.divisions(id),
  department_id int not null references public.departments(id),
  goal_id int not null references public.goals(id),
  activity text not null check (length(trim(activity)) > 0),
  task text not null check (length(trim(task)) > 0),
  deadline date not null check (extract(year from deadline) = 2026),
  success_metric text not null check (length(trim(success_metric)) > 0),
  budget_item_id int references public.budget_items(id) on delete set null,
  est_cost numeric,
  notes text,
  q1_status text check (q1_status in ('בוצע','בתהליך','עיכוב','עצירה')), q1_note text,
  q2_status text check (q2_status in ('בוצע','בתהליך','עיכוב','עצירה')), q2_note text,
  q3_status text check (q3_status in ('בוצע','בתהליך','עיכוב','עצירה')), q3_note text,
  q4_status text check (q4_status in ('בוצע','בתהליך','עיכוב','עצירה')), q4_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  username text,
  table_name text not null,
  row_id text,
  action text not null,
  changes jsonb
);

create index if not exists tasks_dept_idx on public.tasks(department_id);
create index if not exists budget_dept_idx on public.budget_items(department_id);
create index if not exists audit_at_idx on public.audit_log(at desc);

-- ---------- פונקציות עזר להרשאות ----------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.my_division() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(p.division_id, d.division_id)
  from public.profiles p left join public.departments d on d.id = p.department_id
  where p.id = auth.uid() and p.active
$$;

create or replace function public.my_department() returns int
language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_member() returns boolean
language sql stable as $$ select coalesce(public.my_role(), 'none') <> 'none' $$;

create or replace function public.can_see(div int, dept int) returns boolean
language sql stable as $$
  select case public.my_role()
    when 'admin' then true when 'treasurer' then true when 'viewer' then true
    when 'wing' then div = public.my_division()
    when 'dept' then dept = public.my_department()
    else false end
$$;

create or replace function public.can_edit_task(div int, dept int) returns boolean
language sql stable as $$
  select case public.my_role()
    when 'admin' then true
    when 'wing' then div = public.my_division()
    when 'dept' then dept = public.my_department()
    else false end
$$;

create or replace function public.can_edit_budget() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('admin','treasurer'), false) $$;

-- ---------- טריגרים ----------
-- משתמש חדש באימות מקבל פרופיל ללא הרשאות; מנהל המערכת מפעיל אותו
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name)
  values (new.id, split_part(new.email, '@', 1), new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- גזירת האגף מהמחלקה ורישום מי עדכן
create or replace function public.budget_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select division_id into new.division_id from public.departments where id = new.department_id;
  if new.division_id is null then raise exception 'המחלקה שנבחרה אינה קיימת'; end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists budget_guard on public.budget_items;
create trigger budget_guard before insert or update on public.budget_items
  for each row execute function public.budget_guard();

-- משימות: גזירת אגף, ונעילת עדכון רבעוני מחוץ לחלון העדכון (למעט מנהל מערכת)
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(); qr record; changed boolean;
begin
  select division_id into new.division_id from public.departments where id = new.department_id;
  if new.division_id is null then raise exception 'המחלקה שנבחרה אינה קיימת'; end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and r is distinct from 'admin' then
    for qr in select * from public.quarters order by q loop
      changed := case qr.q
        when 1 then (new.q1_status, new.q1_note) is distinct from (old.q1_status, old.q1_note)
        when 2 then (new.q2_status, new.q2_note) is distinct from (old.q2_status, old.q2_note)
        when 3 then (new.q3_status, new.q3_note) is distinct from (old.q3_status, old.q3_note)
        when 4 then (new.q4_status, new.q4_note) is distinct from (old.q4_status, old.q4_note)
      end;
      if changed and (current_date < qr.opens_at or current_date > qr.locks_at) then
        raise exception 'עדכון רבעון % נעול. לפתיחה יש לפנות למנהל המערכת', qr.q;
      end if;
    end loop;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard before insert or update on public.tasks
  for each row execute function public.tasks_guard();

-- יומן שינויים (לא נרשם בהרצה ישירה של SQL, למשל בטעינת נתוני ההדגמה)
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare ch jsonb; uname text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select username into uname from public.profiles where id = auth.uid();
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}'::jsonb) into ch
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at','updated_by');
    if ch = '{}'::jsonb then return new; end if;
    insert into public.audit_log(user_id, username, table_name, row_id, action, changes)
    values (auth.uid(), uname, tg_table_name, new.id::text, 'עדכון', ch);
    return new;
  elsif tg_op = 'INSERT' then
    insert into public.audit_log(user_id, username, table_name, row_id, action, changes)
    values (auth.uid(), uname, tg_table_name, new.id::text, 'הוספה', to_jsonb(new));
    return new;
  else
    insert into public.audit_log(user_id, username, table_name, row_id, action, changes)
    values (auth.uid(), uname, tg_table_name, old.id::text, 'מחיקה', to_jsonb(old));
    return old;
  end if;
end $$;

drop trigger if exists audit_budget on public.budget_items;
create trigger audit_budget after insert or update or delete on public.budget_items
  for each row execute function public.audit_row();
drop trigger if exists audit_tasks on public.tasks;
create trigger audit_tasks after insert or update or delete on public.tasks
  for each row execute function public.audit_row();

-- ---------- הרשאות גישה (Row Level Security) ----------
alter table public.divisions    enable row level security;
alter table public.departments  enable row level security;
alter table public.goals        enable row level security;
alter table public.profiles     enable row level security;
alter table public.budget_items enable row level security;
alter table public.quarters     enable row level security;
alter table public.tasks        enable row level security;
alter table public.audit_log    enable row level security;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- נתוני ייחוס: קריאה לכל משתמש פעיל, כתיבה למנהל מערכת
drop policy if exists ref_read on public.divisions;
create policy ref_read on public.divisions for select to authenticated using (public.is_member());
drop policy if exists ref_write on public.divisions;
create policy ref_write on public.divisions for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists ref_read on public.departments;
create policy ref_read on public.departments for select to authenticated using (public.is_member());
drop policy if exists ref_write on public.departments;
create policy ref_write on public.departments for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists ref_read on public.goals;
create policy ref_read on public.goals for select to authenticated using (public.is_member());
drop policy if exists ref_write on public.goals;
create policy ref_write on public.goals for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists ref_read on public.quarters;
create policy ref_read on public.quarters for select to authenticated using (public.is_member());
drop policy if exists ref_write on public.quarters;
create policy ref_write on public.quarters for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- פרופילים: כל משתמש רואה את עצמו; מנהל רואה את כולם. שינויים רק דרך שרת הניהול
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() = 'admin');

-- תקציב: קריאה לפי היקף ההרשאה, כתיבה לגזבר ולמנהל
drop policy if exists budget_read on public.budget_items;
create policy budget_read on public.budget_items for select to authenticated
  using (public.can_see(division_id, department_id));
drop policy if exists budget_ins on public.budget_items;
create policy budget_ins on public.budget_items for insert to authenticated
  with check (public.can_edit_budget());
drop policy if exists budget_upd on public.budget_items;
create policy budget_upd on public.budget_items for update to authenticated
  using (public.can_edit_budget()) with check (public.can_edit_budget());
drop policy if exists budget_del on public.budget_items;
create policy budget_del on public.budget_items for delete to authenticated
  using (public.my_role() = 'admin');

-- משימות: קריאה לפי היקף, כתיבה לבעלי ההרשאה באגף או במחלקה
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (public.can_see(division_id, department_id));
drop policy if exists tasks_ins on public.tasks;
create policy tasks_ins on public.tasks for insert to authenticated
  with check (public.can_edit_task((select division_id from public.departments where id = department_id), department_id));
drop policy if exists tasks_upd on public.tasks;
create policy tasks_upd on public.tasks for update to authenticated
  using (public.can_edit_task(division_id, department_id))
  with check (public.can_edit_task((select division_id from public.departments where id = department_id), department_id));
drop policy if exists tasks_del on public.tasks;
create policy tasks_del on public.tasks for delete to authenticated
  using (public.can_edit_task(division_id, department_id));

-- יומן שינויים: קריאה למנהל בלבד, ללא אפשרות עריכה או מחיקה
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated
  using (public.my_role() = 'admin');
revoke insert, update, delete on public.audit_log from authenticated;

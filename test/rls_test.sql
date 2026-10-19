\set ON_ERROR_STOP 0
-- users for each role
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','admin@demo.romy.co.il'),
 ('00000000-0000-0000-0000-00000000000b','gizbar@demo.romy.co.il'),
 ('00000000-0000-0000-0000-00000000000c','wing@demo.romy.co.il'),
 ('00000000-0000-0000-0000-00000000000d','dept@demo.romy.co.il'),
 ('00000000-0000-0000-0000-00000000000e','viewer@demo.romy.co.il'),
 ('00000000-0000-0000-0000-00000000000f','intruder@demo.romy.co.il')
on conflict do nothing;
update profiles set role='admin', active=true where username='admin';
update profiles set role='treasurer', active=true where username='gizbar';
update profiles set role='wing', active=true, division_id=2 where username='wing';
update profiles set role='dept', active=true, department_id=(select id from departments where name='חינוך יסודי') where username='dept';
update profiles set role='viewer', active=true where username='viewer';
select username, role, active from profiles order by username;

create or replace function t_as(u text) returns void language plpgsql security definer as $$
begin perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = u || '@demo.romy.co.il'), false); end $$;

set role authenticated;
\echo '--- visible rows per role: tasks / budget / profiles / audit'
select t_as('admin');    select 'admin' who, (select count(*) from tasks) t, (select count(*) from budget_items) b, (select count(*) from profiles) p, (select count(*) from audit_log) a;
select t_as('gizbar');   select 'gizbar' who, (select count(*) from tasks) t, (select count(*) from budget_items) b, (select count(*) from profiles) p, (select count(*) from audit_log) a;
select t_as('wing');     select 'wing' who, (select count(*) from tasks) t, (select count(*) from budget_items) b, (select count(*) from profiles) p, (select count(distinct division_id) from tasks) divs;
select t_as('dept');     select 'dept' who, (select count(*) from tasks) t, (select count(*) from budget_items) b, (select count(distinct department_id) from tasks) depts;
select t_as('viewer');   select 'viewer' who, (select count(*) from tasks) t, (select count(*) from budget_items) b;
select t_as('intruder'); select 'intruder' who, (select count(*) from tasks) t, (select count(*) from budget_items) b, (select count(*) from divisions) d;

\echo '--- EXPECT FAIL: intruder self-promotes'
select t_as('intruder'); update profiles set role='admin', active=true where username='intruder';
reset role; select role, active from profiles where username='intruder'; set role authenticated;

\echo '--- EXPECT FAIL/0 rows: dept edits budget'
select t_as('dept'); update budget_items set budget_2026 = 1 where id = 1;
\echo '--- EXPECT OK: treasurer edits budget'
select t_as('gizbar'); update budget_items set budget_2026 = budget_2026 + 1000 where id = 1;

\echo '--- EXPECT FAIL: dept inserts task in another department'
select t_as('dept'); insert into tasks(department_id,goal_id,activity,task,deadline,success_metric) values (1,1,'x','y','2026-12-01','z');
\echo '--- EXPECT OK: dept inserts task in own department'
insert into tasks(department_id,goal_id,activity,task,deadline,success_metric) values ((select department_id from profiles where username='dept'),1,'בדיקה','משימת בדיקה','2026-12-01','מדד') returning id, division_id;
\echo '--- EXPECT FAIL: task without goal / wrong year'
insert into tasks(department_id,activity,task,deadline,success_metric) values ((select department_id from profiles where username='dept'),'a','b','2026-12-01','c');
insert into tasks(department_id,goal_id,activity,task,deadline,success_metric) values ((select department_id from profiles where username='dept'),1,'a','b','2027-01-05','c');
\echo '--- EXPECT FAIL: dept moves own task to another department'
update tasks set department_id = 1 where id = (select max(id) from tasks);
\echo '--- quarter lock: Q2 locked (today outside window) -> FAIL for dept, OK for admin'
update tasks set q2_status='בוצע' where id = (select max(id) from tasks);
select t_as('admin'); update tasks set q2_status='בוצע' where id = (select max(id) from tasks);
\echo '--- open Q2 window and retry as dept -> OK'
update quarters set opens_at = current_date - 1, locks_at = current_date + 1 where q = 2;
select t_as('dept'); update tasks set q2_status='עיכוב', q2_note='בדיקה' where id = (select max(id) from tasks);
\echo '--- EXPECT FAIL: dept changes quarter windows'
update quarters set locks_at = '2030-01-01' where q = 1;
select t_as('admin'); select q, locks_at from quarters order by q;
\echo '--- EXPECT FAIL: dept deletes audit log'
select t_as('dept'); delete from audit_log;
select t_as('admin'); select username, table_name, action, changes from audit_log order by id;
\echo '--- anon sees nothing'
reset role; set role anon; select count(*) from tasks;
reset role;

-- הפיכת המשתמש romy למנהל המערכת (להריץ אחרי יצירת המשתמש ב-Authentication)
update public.profiles
set role = 'admin', active = true, full_name = 'רומי דר'
where username = 'romy';

select username, full_name, role, active from public.profiles;

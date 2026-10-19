#!/bin/bash
set -e
cd "$(dirname "$0")/.."
P="psql -h /var/lib/pgkg -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists t" -c "create database t" >/dev/null 2>&1
$P -d t -f test/supabase_shim.sql >/dev/null
$P -d t -f supabase/01_schema.sql 2>/dev/null
$P -d t -f supabase/02_seed.sql >/dev/null 2>&1
$P -d t -c "insert into auth.users(email) values ('romy@demo.romy.co.il'),('wing@demo.romy.co.il'),('dept@demo.romy.co.il'),('viewer@demo.romy.co.il'),('gizbar@demo.romy.co.il')" >/dev/null
$P -d t -f supabase/03_make_admin.sql >/dev/null
$P -d t -c "update profiles set role='wing',active=true,division_id=2,full_name='דנה כהן' where username='wing'; update profiles set role='dept',active=true,department_id=3,full_name='יוסי לוי' where username='dept'; update profiles set role='viewer',active=true,full_name='צופה' where username='viewer'; update profiles set role='treasurer',active=true,full_name='גזבר העירייה' where username='gizbar';" >/dev/null
echo "db reset ok"

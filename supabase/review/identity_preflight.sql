-- READ ONLY. Run in the existing project's SQL Editor as its owner for review.
-- No records, emails, keys, or message contents are selected.
begin transaction read only;

select current_database() as database_name, current_user as inspecting_role,
  to_regclass('supabase_migrations.schema_migrations') as migration_history_table;

select rolname, rolsuper, rolbypassrls, rolinherit from pg_roles
where rolname in ('anon','authenticated');
select parent.rolname as inherited_role, child.rolname as member_role
from pg_auth_members m join pg_roles parent on parent.oid=m.roleid
join pg_roles child on child.oid=m.member
where child.rolname in ('anon','authenticated');

select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and (
  table_name in ('junctions','participants','messages','reactions','reports','blocks')
  or table_name ilike '%profile%'
) order by table_name, ordinal_position;

select c.relname as table_name, c.relrowsecurity as rls_enabled,
  c.reltuples::bigint as estimated_rows
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and (
  c.relname in ('junctions','participants','messages','reactions','reports','blocks')
  or c.relname ilike '%profile%'
) order by c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public','realtime')
order by schemaname, tablename, policyname;

select c.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and (
  c.relname in ('junctions','participants','messages','reactions','reports','blocks')
  or c.relname ilike '%profile%'
) order by c.relname, con.conname;

select table_name, grantee, privilege_type from information_schema.table_privileges
where table_schema='public' and grantee in ('PUBLIC','anon','authenticated')
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
where table_schema='public' and grantee in ('PUBLIC','anon','authenticated')
order by table_name, column_name, grantee, privilege_type;

select event_object_table, trigger_name, event_manipulation, action_statement
from information_schema.triggers where trigger_schema='public'
order by event_object_table, trigger_name;

select tablename, indexname, indexdef from pg_indexes
where schemaname='public' and (
  tablename in ('junctions','participants','messages','reactions','reports','blocks')
  or tablename ilike '%profile%'
) order by tablename, indexname;

select pubname, schemaname, tablename from pg_publication_tables
where pubname='supabase_realtime' order by schemaname, tablename;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer, p.proconfig as function_settings, p.proacl as execute_grants
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' order by p.proname;

select c.relname as view_name, pg_get_userbyid(c.relowner) as owner, c.reloptions
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('v','m') order by c.relname;

commit;

-- Requires Supabase Auth anonymous sign-ins for guests. No historical messages
-- are deleted or assigned to an unverifiable account during this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Abort rather than create a duplicate profile store on a drifted deployment.
do $$
begin
  if current_setting('server_encoding') <> 'UTF8' then raise exception 'Junction requires a UTF8 database'; end if;
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'Application roles must not have superuser or BYPASSRLS attributes';
  end if;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('realtime.topic()') is null
    or to_regclass('realtime.messages') is null then
    raise exception 'Expected Supabase Auth and Realtime schema is missing';
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Expected supabase_realtime publication is missing';
  end if;
  if exists (select 1 from pg_policies where schemaname in ('public','realtime') and policyname in (
    'junction_profile_access','junction_profile_owner','junction_authenticated_access',
    'junction_channel_read','junction_channel_write','junction_channel_read_guard','junction_channel_write_guard'
  )) or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace
    and conname in ('junction_profile_display_name_valid','junction_profile_avatar_valid','junction_block_not_self','junction_block_verified_pair')) then
    raise exception 'Migration objects already exist: review migration history/drift; do not reapply this one-time migration';
  end if;
  if to_regclass('public.junction_profiles') is null and exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relname ilike '%profile%'
  ) then
    raise exception 'An existing profile table needs an explicit mapping; no changes were applied';
  end if;
end;
$$;

create table if not exists public.junction_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_emoji text not null default U&'\+01F43C',
  avatar_color text not null default '#7029D9',
  updated_at timestamptz not null default now()
);
do $$
declare owner_column smallint;
begin
  select attnum into owner_column from pg_attribute
    where attrelid = 'public.junction_profiles'::regclass and attname = 'user_id' and not attisdropped;
  if not exists (select 1 from pg_index where indrelid = 'public.junction_profiles'::regclass
    and indisprimary and indisvalid and indnkeyatts = 1 and indkey[0] = owner_column) then
    raise exception 'Existing junction_profiles needs user_id as its primary key; review the profile mapping';
  end if;
end;
$$;
-- NOT VALID preserves any pre-existing profile rows while enforcing all new
-- writes/edits. The owner can validate historical rows after the preflight review.
alter table public.junction_profiles add constraint junction_profile_display_name_valid
  check (display_name is not null and display_name = btrim(display_name)
    and length(display_name) between 2 and 24 and display_name !~ '[[:cntrl:]]') not valid;
alter table public.junction_profiles add constraint junction_profile_avatar_valid
  check (avatar_emoji is not null and length(avatar_emoji) between 1 and 16
    and avatar_color is not null and avatar_color ~ '^#[0-9A-Fa-f]{6}$') not valid;
alter table public.junction_profiles enable row level security;
alter table public.junctions enable row level security;
alter table public.participants enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;
-- Unicode escape keeps the panda default intact through non-UTF-8 SQL editors.
-- Change defaults only: never rewrite historical avatar values automatically.
alter table public.junction_profiles alter column avatar_emoji set default U&'\+01F43C';
alter table public.participants alter column avatar_emoji set default U&'\+01F43C';
alter table public.messages alter column avatar_emoji set default U&'\+01F43C';
revoke all on public.junction_profiles from public, anon, authenticated;
grant select, insert, update on public.junction_profiles to authenticated;
create policy junction_profile_access on public.junction_profiles
  for all to authenticated using (true) with check (true);
create policy junction_profile_owner on public.junction_profiles
  as restrictive for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy junction_profile_no_delete on public.junction_profiles
  as restrictive for delete to authenticated using (false);

alter table public.participants add column if not exists user_id uuid references auth.users(id);
alter table public.participants add column if not exists connection_id uuid default gen_random_uuid();
alter table public.participants add column if not exists connection_state text not null default 'connected';
alter table public.messages add column if not exists user_id uuid references auth.users(id);
alter table public.reactions add column if not exists user_id uuid references auth.users(id);
alter table public.reports add column if not exists reporter_user_id uuid references auth.users(id);
alter table public.blocks add column if not exists blocker_user_id uuid references auth.users(id);
alter table public.blocks add column if not exists blocked_user_id uuid references auth.users(id);
alter table public.junctions add column if not exists creator_user_id uuid references auth.users(id);
-- IF NOT EXISTS on a column does not guarantee its FK exists on a customized
-- deployment. Add missing Auth references without rewriting/deleting old rows.
do $$
declare target record; relation regclass; attribute smallint;
begin
  for target in select * from (values
    ('junction_profiles','user_id'), ('participants','user_id'),
    ('messages','user_id'), ('reactions','user_id'), ('reports','reporter_user_id'),
    ('blocks','blocker_user_id'), ('blocks','blocked_user_id'), ('junctions','creator_user_id')
  ) as targets(table_name, column_name) loop
    relation := to_regclass('public.' || target.table_name);
    select attnum into attribute from pg_attribute where attrelid = relation
      and attname = target.column_name and not attisdropped;
    if not exists (select 1 from pg_constraint where conrelid = relation
      and contype = 'f' and confrelid = 'auth.users'::regclass
      and conkey = array[attribute]) then
      execute format('alter table public.%I add constraint %I foreign key (%I) references auth.users(id) %s not valid',
        target.table_name, 'junction_verified_' || target.table_name || '_' || target.column_name,
        target.column_name, case when target.table_name = 'junction_profiles' then 'on delete cascade' else '' end);
    end if;
  end loop;
end;
$$;
-- Defaults affect only new writes. Never assign existing public records to the
-- administrator/session applying the migration.
alter table public.messages alter column user_id set default auth.uid();
alter table public.reactions alter column user_id set default auth.uid();
alter table public.reports alter column reporter_user_id set default auth.uid();
alter table public.blocks alter column blocker_user_id set default auth.uid();
alter table public.junctions alter column creator_user_id set default auth.uid();

create index if not exists idx_participants_owner on public.participants(user_id, session_id);
create unique index if not exists idx_blocks_verified_users on public.blocks(blocker_user_id, blocked_user_id);
-- A same-named but incompatible index must not be silently accepted. The block
-- RPC requires a real, non-partial unique arbiter for this exact account pair.
do $$
declare blocker_column smallint; blocked_column smallint;
begin
  select attnum into blocker_column from pg_attribute where attrelid = 'public.blocks'::regclass and attname = 'blocker_user_id';
  select attnum into blocked_column from pg_attribute where attrelid = 'public.blocks'::regclass and attname = 'blocked_user_id';
  if not exists (select 1 from pg_index where indrelid = 'public.blocks'::regclass
    and indisunique and indisvalid and indimmediate and indnkeyatts = 2
    and indpred is null and indexprs is null and (
      array[indkey[0], indkey[1]] = array[blocker_column, blocked_column]
      or array[indkey[0], indkey[1]] = array[blocked_column, blocker_column]
    )) then
    raise exception 'Verified block pair unique index is missing or incompatible; review index-name drift';
  end if;
end;
$$;
create index if not exists idx_messages_owner on public.messages(user_id);
create index if not exists idx_reactions_owner on public.reactions(user_id);
create index if not exists idx_reports_owner on public.reports(reporter_user_id);
create index if not exists idx_blocks_target on public.blocks(blocked_user_id);
create index if not exists idx_junctions_owner on public.junctions(creator_user_id);
create index if not exists idx_participants_room_owner on public.participants(junction_id, user_id, last_heartbeat) where left_at is null;
alter table public.blocks add constraint junction_block_not_self
  check (blocker_user_id is null or blocked_user_id is null or blocker_user_id <> blocked_user_id) not valid;
alter table public.blocks add constraint junction_block_verified_pair
  check ((blocker_user_id is null) = (blocked_user_id is null)) not valid;

create or replace function public.owns_junction_session(room_id uuid, tab_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.participants p
    where p.junction_id = room_id and p.session_id = tab_id
      and p.user_id = auth.uid() and p.left_at is null
      and p.last_heartbeat > now() - interval '90 seconds'
  );
$$;

create or replace function public.can_read_junction_message(room_id uuid, sender_id uuid, sender_tab text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and sender_id is not null
    and exists (
      select 1 from public.participants p
      where p.junction_id = room_id and p.user_id = auth.uid()
        and p.left_at is null and p.last_heartbeat > now() - interval '90 seconds'
    )
    and not exists (
      select 1 from public.blocks b
      where b.blocker_user_id = auth.uid()
        and (b.blocked_user_id = sender_id or b.blocked_session_id = sender_tab)
    );
$$;

-- Directed interactions respect blocks in both directions. Shared-room messages
-- remain available to other members while the SELECT policy excludes blockers.
create or replace function public.can_interact_junction_user(other_user uuid, other_tab text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and other_user is not null and not exists (
    select 1 from public.blocks b
    where (b.blocker_user_id = auth.uid() and
      (b.blocked_user_id = other_user or b.blocked_session_id = other_tab))
    or (b.blocker_user_id = other_user and b.blocked_user_id = auth.uid())
  );
$$;

-- Remove the original public, unconditional policies. Authenticated includes
-- Supabase anonymous Auth users and existing signed-in accounts.
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('participants','messages','reactions','reports','blocks','junctions')
      and policyname = any(array['pub_select_' || tablename, 'pub_insert_' || tablename,
        'pub_update_' || tablename, 'pub_delete_' || tablename])
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$$;

-- Restrictive policies remain effective even if a deployment has an additional
-- permissive policy. A minimal authenticated grant supplies the allow side.
do $$
declare table_name text;
begin
  foreach table_name in array array['junctions','participants','messages','reactions','reports','blocks'] loop
    execute format('create policy junction_authenticated_access on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end;
$$;

create policy junction_directory_read on public.junctions for select using (true);
create policy junction_create on public.junctions as restrictive for insert to authenticated
  with check (creator_user_id = auth.uid() and is_permanent = false);
create policy junction_edit on public.junctions as restrictive for update to authenticated
  using (creator_user_id = auth.uid() and not is_permanent)
  with check (creator_user_id = auth.uid() and not is_permanent);
create policy junction_delete on public.junctions as restrictive for delete to authenticated
  using (false);
create policy participant_read on public.participants as restrictive for select to authenticated
  using (user_id = auth.uid() or (left_at is null and last_heartbeat > now() - interval '90 seconds'));
create policy participant_create on public.participants as restrictive for insert to authenticated
  with check (false);
create policy participant_edit on public.participants as restrictive for update to authenticated
  using (user_id = auth.uid() and left_at is null and last_heartbeat > now() - interval '90 seconds')
  with check (user_id = auth.uid() and left_at is null);
create policy participant_delete on public.participants as restrictive for delete to authenticated
  using (false);
create policy message_read on public.messages as restrictive for select to authenticated
  using (public.can_read_junction_message(junction_id, user_id, session_id));
create policy message_create on public.messages as restrictive for insert to authenticated
  with check (
    user_id = auth.uid() and public.owns_junction_session(junction_id, session_id)
    and (reply_to is null or exists (
      select 1 from public.messages parent
      where parent.id = messages.reply_to and parent.junction_id = messages.junction_id
        and public.can_interact_junction_user(parent.user_id, parent.session_id)
    ))
  );
create policy message_delete on public.messages as restrictive for delete to authenticated using (user_id = auth.uid());
create policy message_immutable on public.messages as restrictive for update to authenticated using (false) with check (false);
create policy reaction_read on public.reactions as restrictive for select to authenticated
  using (
    public.can_read_junction_message(junction_id, user_id, session_id)
    and exists (select 1 from public.messages m where m.id = message_id and m.junction_id = reactions.junction_id)
  );
create policy reaction_create on public.reactions as restrictive for insert to authenticated
  with check (
    user_id = auth.uid() and public.owns_junction_session(junction_id, session_id)
    and exists (select 1 from public.messages m where m.id = message_id and m.junction_id = reactions.junction_id
      and public.can_interact_junction_user(m.user_id, m.session_id))
  );
create policy reaction_delete on public.reactions as restrictive for delete to authenticated using (user_id = auth.uid());
create policy reaction_immutable on public.reactions as restrictive for update to authenticated using (false) with check (false);
create policy report_read on public.reports as restrictive for select to authenticated using (reporter_user_id = auth.uid());
create policy report_create on public.reports as restrictive for insert to authenticated
  with check (reporter_user_id = auth.uid() and public.owns_junction_session(junction_id, reporter_session_id));
create policy report_immutable on public.reports as restrictive for update to authenticated using (false) with check (false);
create policy report_no_delete on public.reports as restrictive for delete to authenticated using (false);
create policy block_read on public.blocks as restrictive for select to authenticated using (blocker_user_id = auth.uid());
create policy block_delete on public.blocks as restrictive for delete to authenticated using (blocker_user_id = auth.uid());
create policy block_rpc_insert_only on public.blocks as restrictive for insert to authenticated with check (false);
create policy block_rpc_update_only on public.blocks as restrictive for update to authenticated using (false) with check (false);
-- Block insertion goes through the RPC so the target account is resolved from
-- its real room membership rather than accepting a caller-supplied account ID.
-- Reset inherited/default privileges too. RLS does not protect TRUNCATE, and
-- Supabase default grants may be wider than the original explicit CRUD grants.
revoke all on public.junctions, public.participants, public.messages,
  public.reactions, public.reports, public.blocks from public, anon, authenticated;
grant select on public.junctions to anon;
grant select, insert, update on public.junctions to authenticated;
grant select, insert, delete on public.messages, public.reactions to authenticated;
grant select, insert on public.reports to authenticated;
grant select, delete on public.blocks to authenticated;
grant select on public.participants to authenticated;
-- Room transport identity is managed only by the verified membership RPCs.
grant update(nickname, avatar_emoji, avatar_color, in_voice, mic_muted, is_speaking, hand_raised, last_heartbeat)
  on public.participants to authenticated;

-- REVOKE on a role cannot remove privileges inherited through another role.
-- Refuse deployment if role drift leaves an effective authorization bypass.
do $$
declare table_name text; role_name text; privilege_name text;
begin
  foreach table_name in array array['junction_profiles','junctions','participants','messages','reactions','reports','blocks'] loop
    foreach role_name in array array['anon','authenticated'] loop
      foreach privilege_name in array array['TRUNCATE','TRIGGER','REFERENCES'] loop
        if has_table_privilege(role_name, 'public.' || table_name, privilege_name) then
          raise exception 'Unexpected effective % privilege on % for %: review inherited role grants', privilege_name, table_name, role_name;
        end if;
      end loop;
    end loop;
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
      if not (table_name = 'junctions' and privilege_name = 'SELECT')
        and has_any_column_privilege('anon', 'public.' || table_name, privilege_name) then
        raise exception 'Unexpected anonymous column access on %: review inherited role grants', table_name;
      end if;
    end loop;
    if has_table_privilege('anon', 'public.' || table_name, 'DELETE') then
      raise exception 'Unexpected anonymous DELETE privilege on %: review inherited role grants', table_name;
    end if;
  end loop;
end;
$$;

-- Client updates cannot extend a lease into the future or forge profile data.
-- Membership RPCs run as their owner and manage transport fields separately.
create or replace function public.stamp_junction_participant_update()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare profile public.junction_profiles;
begin
  if current_user = 'authenticated' then
    select * into strict profile from public.junction_profiles where user_id = auth.uid();
    new.nickname := profile.display_name;
    new.avatar_emoji := profile.avatar_emoji;
    new.avatar_color := profile.avatar_color;
    new.last_heartbeat := now();
  end if;
  return new;
end;
$$;
create trigger verified_participant_update before update on public.participants
  for each row execute function public.stamp_junction_participant_update();

create or replace function public.stamp_junction_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare profile public.junction_profiles;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into strict profile from public.junction_profiles where user_id = auth.uid();
  new.user_id := auth.uid();
  new.nickname := profile.display_name;
  new.avatar_emoji := profile.avatar_emoji;
  new.avatar_color := profile.avatar_color;
  new.created_at := now();
  return new;
end;
$$;
create trigger verified_message_sender before insert on public.messages
  for each row execute function public.stamp_junction_message();

create or replace function public.block_junction_user(target_session text)
returns public.blocks language plpgsql security definer set search_path = ''
as $$
declare target_user uuid; target_users uuid[]; result public.blocks;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- A tab ID is public metadata, not a globally trusted account identifier.
  -- Resolve verified membership in a room the blocker currently occupies.
  -- Keep departed authors blockable from chat history; reject ambiguous accounts
  -- rather than choosing a more recently spoofed tab ID in another room.
  select array_agg(distinct target.user_id) into target_users
  from public.participants target
  where target.session_id = target_session and target.user_id is not null
    and exists (select 1 from public.participants own where own.junction_id = target.junction_id
      and own.user_id = auth.uid() and own.left_at is null
      and own.last_heartbeat > now() - interval '90 seconds');
  if coalesce(cardinality(target_users), 0) <> 1 then raise exception 'Invalid or ambiguous block target'; end if;
  target_user := target_users[1];
  if target_user is null or target_user = auth.uid() then raise exception 'Invalid block target'; end if;
  insert into public.blocks(blocker_session_id, blocked_session_id, blocker_user_id, blocked_user_id)
  values (auth.uid()::text, target_session, auth.uid(), target_user)
  on conflict (blocker_user_id, blocked_user_id)
    do update set blocked_session_id = excluded.blocked_session_id
  returning * into result;
  return result;
end;
$$;

create or replace function public.join_junction_session(room_id uuid, tab_id text, lease_id uuid)
returns public.participants language plpgsql security definer set search_path = ''
as $$
declare profile public.junction_profiles; result public.participants;
begin
  if auth.uid() is null or room_id is null or tab_id is null or length(tab_id) not between 1 and 64 or lease_id is null
    then raise exception 'Invalid room session'; end if;
  select * into strict profile from public.junction_profiles where user_id = auth.uid();
  perform pg_advisory_xact_lock(hashtextextended(room_id::text, 0));
  insert into public.participants(junction_id, session_id, user_id, connection_id, nickname, avatar_emoji, avatar_color)
    values (room_id, tab_id, auth.uid(), lease_id, profile.display_name, profile.avatar_emoji, profile.avatar_color)
  on conflict (junction_id, session_id) do update set
    connection_id = excluded.connection_id, nickname = excluded.nickname,
    avatar_emoji = excluded.avatar_emoji, avatar_color = excluded.avatar_color,
    last_heartbeat = now(), left_at = null, in_voice = false, mic_muted = true,
    is_speaking = false, connection_state = 'connected'
    where participants.user_id = auth.uid()
  returning * into result;
  if result.id is null then raise exception 'Room session belongs to another account'; end if;
  return result;
end;
$$;

create or replace function public.heartbeat_junction_session(room_id uuid, tab_id text, lease_id uuid)
returns setof public.participants language sql security definer set search_path = ''
as $$
  update public.participants set last_heartbeat = now(), connection_state = 'connected'
    where junction_id = room_id and session_id = tab_id and connection_id = lease_id
      and user_id = auth.uid() and left_at is null returning *;
$$;

create or replace function public.leave_junction_session(room_id uuid, tab_id text, lease_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(room_id::text, 0));
  update public.participants set left_at = now(), in_voice = false, mic_muted = true,
    is_speaking = false, connection_state = 'disconnected'
    where junction_id = room_id and session_id = tab_id and connection_id = lease_id and user_id = auth.uid();
end;
$$;

-- Keep the legacy RPC signature for old clients, but retire automatic deletion.
-- Joining/leaving, migration, and blocking must all preserve existing history.
create or replace function public.purge_junction_chat_if_empty(p_junction_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- Intentionally no deletion. The argument remains for API compatibility.
end;
$$;

create or replace function public.can_use_junction_channel(topic text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare room_id uuid;
begin
  if auth.uid() is null then return false; end if;
  if topic in ('junction-community', 'junctions-presence-overview') then return true; end if;
  if topic = 'blocks:' || auth.uid()::text then return true; end if;
  if array_length(string_to_array(topic, ':'), 1) <> 2 then return false; end if;
  if split_part(topic, ':', 1) not in ('voice','typing','room-reactions','room') then return false; end if;
  begin room_id := split_part(topic, ':', 2)::uuid;
  exception when invalid_text_representation then return false;
  end;
  return exists (select 1 from public.participants where junction_id = room_id
    and user_id = auth.uid() and left_at is null and last_heartbeat > now() - interval '90 seconds');
end;
$$;

create policy junction_channel_read on realtime.messages for select to authenticated
  using (public.can_use_junction_channel(realtime.topic()));
create policy junction_channel_write on realtime.messages for insert to authenticated
  with check (public.can_use_junction_channel(realtime.topic()));

-- Additional deployment-specific permissive policies must not open Junction's
-- private channels. Leave unrelated services' channel namespaces unaffected.
create policy junction_channel_read_guard on realtime.messages as restrictive for select to anon, authenticated
  using (
    not (realtime.topic() in ('junction-community','junctions-presence-overview')
      or split_part(realtime.topic(), ':', 1) in ('blocks','room','voice','typing','room-reactions'))
    or public.can_use_junction_channel(realtime.topic())
  );
create policy junction_channel_write_guard on realtime.messages as restrictive for insert to anon, authenticated
  with check (
    not (realtime.topic() in ('junction-community','junctions-presence-overview')
      or split_part(realtime.topic(), ':', 1) in ('blocks','room','voice','typing','room-reactions'))
    or public.can_use_junction_channel(realtime.topic())
  );

do $$
declare function_name text;
begin
  foreach function_name in array array[
    'owns_junction_session(uuid,text)', 'can_read_junction_message(uuid,uuid,text)',
    'can_interact_junction_user(uuid,text)',
    'block_junction_user(text)', 'join_junction_session(uuid,text,uuid)',
    'heartbeat_junction_session(uuid,text,uuid)', 'leave_junction_session(uuid,text,uuid)',
    'purge_junction_chat_if_empty(uuid)', 'can_use_junction_channel(text)'
  ] loop
    execute 'revoke all on function public.' || function_name || ' from public, anon';
    execute 'grant execute on function public.' || function_name || ' to authenticated';
  end loop;
end;
$$;
-- Anonymous policy evaluation may call this helper, but without auth.uid() it
-- returns false for every topic and exposes no membership/account information.
grant execute on function public.can_use_junction_channel(text) to anon;
revoke all on function public.stamp_junction_message() from public, anon, authenticated;
revoke all on function public.stamp_junction_participant_update() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'blocks') then
    alter publication supabase_realtime add table public.blocks;
  end if;
end;
$$;
commit;

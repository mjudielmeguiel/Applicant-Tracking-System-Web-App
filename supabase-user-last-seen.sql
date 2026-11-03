-- Include recorded activity in the existing workspace-scoped responses.
-- Account permissions and the four internal availability states are unchanged.
create or replace function public.ats_presence_list(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id integer;
  result jsonb;
begin
  owner_id := ats_private.require_admin(p_session_token);
  select coalesce(jsonb_object_agg(u."UserID"::text, jsonb_build_object(
    'status', coalesce(p.status, 'Active'),
    'presence', ats_private.effective_presence('user', u."UserID", u."Status"),
    'last_seen', p.last_seen,
    'server_now', now()
  )), '{}'::jsonb)
  into result
  from public.users u
  left join ats_private.account_presence p
    on p.account_type = 'user' and p.account_id = u."UserID"
  where u."AdminID" = owner_id;
  return result;
end;
$$;

create or replace function public.ats_presence(
  p_session_token text,
  p_status text default null,
  p_user_id integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account jsonb;
  kind text;
  identifier integer;
  owner_id integer;
  access text;
  current_status text;
  last_seen_at timestamptz;
begin
  account := ats_private.session_account(p_session_token);
  kind := account->>'accountType';
  identifier := (account->>'id')::integer;
  access := account->>'status';
  if p_status is not null and p_status not in ('Active', 'Busy', 'Offline', 'Inactive') then
    raise exception using errcode = '22023', message = 'Choose Active, Busy, Offline or Inactive.';
  end if;
  if p_user_id is not null then
    owner_id := ats_private.require_admin(p_session_token);
    select "Status" into access from public.users
    where "UserID" = p_user_id and "AdminID" = owner_id for update;
    if not found then
      raise exception using errcode = '42501', message = 'This user is unavailable in your workspace.';
    end if;
    kind := 'user';
    identifier := p_user_id;
  end if;
  insert into ats_private.account_presence(account_type, account_id, status, last_seen)
  values (kind, identifier, coalesce(p_status, 'Active'), now())
  on conflict(account_type, account_id) do update
  set status = coalesce(p_status, account_presence.status),
      last_seen = case when p_user_id is null then now() else account_presence.last_seen end;
  select status, last_seen into current_status, last_seen_at
  from ats_private.account_presence
  where account_type = kind and account_id = identifier;
  return jsonb_build_object(
    'status', current_status,
    'presence', ats_private.effective_presence(kind, identifier, access),
    'last_seen', last_seen_at,
    'server_now', now()
  );
end;
$$;

revoke all on function public.ats_presence_list(text), public.ats_presence(text, text, integer) from public;
grant execute on function public.ats_presence_list(text), public.ats_presence(text, text, integer) to anon, authenticated;
notify pgrst, 'reload schema';

create table ats_private.workspace_account_limits(admin_id integer primary key references public.admins("AdminID") on delete cascade,account_limit integer not null default 10 check(account_limit in(5,10)));
alter table ats_private.workspace_account_limits enable row level security;
revoke all on ats_private.workspace_account_limits from public,anon,authenticated;
create or replace function ats_private.enforce_account_limit() returns trigger language plpgsql set search_path='' as $$
declare capacity integer;used integer;
begin
 if tg_op='UPDATE' and new."AdminID" is not distinct from old."AdminID" then return new;end if;
 if new."AdminID" is null then raise exception 'A workspace is required to create an account.';end if;
 insert into ats_private.workspace_account_limits(admin_id) values(new."AdminID") on conflict do nothing;
 select account_limit into capacity from ats_private.workspace_account_limits where admin_id=new."AdminID" for update;
 select count(*) into used from public.users where "AdminID"=new."AdminID";
 if used>=capacity then raise exception using errcode='22023',message='This workspace has reached its '||capacity||'-user account limit. Delete an unused account or increase the limit to 10.';end if;
 return new;
end $$;
create trigger ats_workspace_account_limit before insert or update of "AdminID" on public.users for each row execute function ats_private.enforce_account_limit();
create or replace function public.ats_user_limit(p_session_token text,p_limit integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id integer;capacity integer;used integer;
begin
 owner_id:=ats_private.require_admin(p_session_token);
 insert into ats_private.workspace_account_limits(admin_id) values(owner_id) on conflict do nothing;
 select account_limit into capacity from ats_private.workspace_account_limits where admin_id=owner_id for update;
 select count(*) into used from public.users where "AdminID"=owner_id;
 if p_limit is not null then
 if p_limit not in(5,10) then raise exception 'Choose a maximum of 5 or 10 user accounts.';end if;
 if p_limit<used then raise exception 'This workspace already has % users. The limit cannot be lower than the existing account count.',used;end if;
 update ats_private.workspace_account_limits set account_limit=p_limit where admin_id=owner_id;capacity:=p_limit;
 end if;
 return jsonb_build_object('limit',capacity,'count',used,'remaining',greatest(capacity-used,0));
end $$;
-- Make presence available anywhere a job creator or recruiter profile is displayed.
create or replace function ats_private.creator_presence(p_type text,p_id integer,p_owner integer) returns text language sql stable set search_path='' as $$
select case when p_type='user' then (select ats_private.effective_presence('user',"UserID","Status") from public.users where "UserID"=p_id and "AdminID"=p_owner) when p_type='admin' then (select ats_private.effective_presence('admin',"AdminID","Status") from public.admins where "AdminID"=p_id and "AdminID"=p_owner) else 'Offline' end;$$;
do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('ats_private.job_rows(integer)'::regprocedure);
 definition:=replace(definition,'''creator_photo'',ats_private.profile_data','''creator_presence'',coalesce(ats_private.creator_presence(j.creator_type,j.creator_id,p_owner),''Offline''),''creator_photo'',ats_private.profile_data');execute definition;
 definition:=pg_get_functiondef('public.ats_public_jobs_open(text)'::regprocedure);
 definition:=replace(definition,'''creator_photo'',j->>''creator_photo''','''creator_photo'',j->>''creator_photo'',''creator_presence'',j->>''creator_presence''');execute definition;
 definition:=pg_get_functiondef('public.ats_application_open(text)'::regprocedure);
 definition:=replace(definition,'coalesce(inv.inviter,ats_private.application_inviter(''admin'',inv.admin_id,inv.admin_id))','coalesce(inv.inviter,ats_private.application_inviter(''admin'',inv.admin_id,inv.admin_id))||jsonb_build_object(''presence'',coalesce(ats_private.creator_presence(inv.creator_type,inv.creator_id,inv.admin_id),''Offline''))');execute definition;
end $patch$;
revoke all on function ats_private.enforce_account_limit(),ats_private.creator_presence(text,integer,integer),public.ats_user_limit(text,integer) from public;
grant execute on function public.ats_user_limit(text,integer) to anon,authenticated;
notify pgrst,'reload schema';

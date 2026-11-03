alter table public."Applicant_Masterlist" add column if not exists "AddedByName" text;
create or replace function ats_private.record_applicant_creator() returns trigger language plpgsql set search_path='' as $$
declare actor jsonb;inviter_name text;
begin
 if tg_op='UPDATE' then new."AddedByName":=old."AddedByName";return new;end if;
 if new."ApplicationInvitationID" is not null then select coalesce(nullif(inviter->>'name',''),nullif((select "FullName" from public.admins where "AdminID"=i.admin_id),'')) into inviter_name from ats_private.applicant_invitations i where id=new."ApplicationInvitationID" and admin_id=new."AdminID";end if;
 actor:=nullif(current_setting('ats.activity.actor',true),'')::jsonb;
 new."AddedByName":=coalesce(inviter_name,case when actor->>'type' in('user','admin') then nullif(actor->>'name','') end,'Recruitment team');return new;
end $$;
-- Backfill only from known invitation or creation-event attribution.
update public."Applicant_Masterlist" a set "AddedByName"=coalesce((select nullif(i.inviter->>'name','') from ats_private.applicant_invitations i where i.admin_id=a."AdminID" and (i.id=a."ApplicationInvitationID" or i.applicant_id=a."ApplicantID") order by i.created_at limit 1),(select nullif(t.actor_name,'') from ats_private.activity t where t.admin_id=a."AdminID" and t.entity_type='applicant' and t.entity_id in(a."ApplicantID"::text,'db-'||a."ApplicantID") and t.action='created' and t.actor_type in('admin','user') order by t.created_at limit 1),'Recruitment team') where "AddedByName" is null;
create trigger ats_applicant_creator before insert or update on public."Applicant_Masterlist" for each row execute function ats_private.record_applicant_creator();
create table ats_private.account_presence(account_type text not null check(account_type in('admin','user')),account_id integer not null,status text not null default 'Active' check(status in('Active','Busy','Offline','Inactive')),last_seen timestamptz not null default now(),primary key(account_type,account_id));
alter table ats_private.account_presence enable row level security;
revoke all on ats_private.account_presence from public,anon,authenticated;
create or replace function ats_private.effective_presence(p_type text,p_id integer,p_access text) returns text language sql stable set search_path='' as $$
select case when p_access is distinct from 'Active' then 'Inactive' else coalesce((select case when status in('Offline','Inactive') then status when last_seen<now()-interval '120 seconds' or not exists(select 1 from ats_private.login_sessions s where s.account_type=p_type and s.account_id=p_id and s.expires_at>now()) then 'Offline' else status end from ats_private.account_presence where account_type=p_type and account_id=p_id),'Offline') end;$$;
create or replace function public.ats_presence(p_session_token text,p_status text default null,p_user_id integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare account jsonb;kind text;identifier integer;owner_id integer;access text;current_status text;
begin
 account:=ats_private.session_account(p_session_token);kind:=account->>'accountType';identifier:=(account->>'id')::integer;access:=account->>'status';
 if p_status is not null and p_status not in('Active','Busy','Offline','Inactive') then raise exception using errcode='22023',message='Choose Active, Busy, Offline or Inactive.';end if;
 if p_user_id is not null then owner_id:=ats_private.require_admin(p_session_token);select "Status" into access from public.users where "UserID"=p_user_id and "AdminID"=owner_id for update;if not found then raise exception using errcode='42501',message='This user is unavailable in your workspace.';end if;kind:='user';identifier:=p_user_id;end if;
 insert into ats_private.account_presence(account_type,account_id,status,last_seen) values(kind,identifier,coalesce(p_status,'Active'),now()) on conflict(account_type,account_id) do update set status=coalesce(p_status,account_presence.status),last_seen=case when p_user_id is null then now() else account_presence.last_seen end;
 select status into current_status from ats_private.account_presence where account_type=kind and account_id=identifier;
 return jsonb_build_object('status',current_status,'presence',ats_private.effective_presence(kind,identifier,access));
end $$;
create or replace function public.ats_presence_list(p_session_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id integer;result jsonb;
begin owner_id:=ats_private.require_admin(p_session_token);select coalesce(jsonb_object_agg(u."UserID"::text,jsonb_build_object('status',coalesce(p.status,'Active'),'presence',ats_private.effective_presence('user',u."UserID",u."Status"))),'{}') into result from public.users u left join ats_private.account_presence p on p.account_type='user' and p.account_id=u."UserID" where u."AdminID"=owner_id;return result;end $$;
create or replace function ats_private.clear_account_presence() returns trigger language plpgsql set search_path='' as $$ begin delete from ats_private.account_presence where account_type=case when tg_table_name='admins' then 'admin' else 'user' end and account_id=case when tg_table_name='admins' then (to_jsonb(old)->>'AdminID')::integer else (to_jsonb(old)->>'UserID')::integer end;return old;end $$;
create trigger ats_clear_user_presence after delete on public.users for each row execute function ats_private.clear_account_presence();
create trigger ats_clear_admin_presence after delete on public.admins for each row execute function ats_private.clear_account_presence();
revoke all on function ats_private.record_applicant_creator(),ats_private.effective_presence(text,integer,text),ats_private.clear_account_presence(),public.ats_presence(text,text,integer),public.ats_presence_list(text) from public;
grant execute on function public.ats_presence(text,text,integer),public.ats_presence_list(text) to anon,authenticated;
notify pgrst,'reload schema';

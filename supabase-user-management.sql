-- USER and RECRUITER share workspace user access; neither grants admin privileges.
do $roles$
declare signature text; definition text;
begin
 foreach signature in array array['ats_private.account_details(text,integer)','public.ats_login(text,text)','public.ats_list_users(text,integer,integer)','public.ats_user_photos(text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(definition,'= ''USER''','in (''USER'',''RECRUITER'')');
  definition:=replace(definition,'=''USER''','in (''USER'',''RECRUITER'')');
  if signature='ats_private.account_details(text,integer)' then definition:=replace(definition,'''role'', ''USER''','''role'', u."Role"');end if;
  execute definition;
 end loop;
end $roles$;
create or replace function public.ats_user_manage(p_session_token text,p_user_id integer,p_action text,p_role text default null,p_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;target public.users%rowtype;
begin
 owner_id:=ats_private.require_admin(p_session_token);
 select * into target from public.users where "UserID"=p_user_id and "AdminID"=owner_id for update;
 if not found then raise exception using errcode='42501',message='This user is unavailable in your workspace.';end if;
 if p_action='update' then
  if p_role is null or p_role not in('USER','RECRUITER') or p_status is null or p_status not in('Active','Inactive') then raise exception using errcode='22023',message='Choose a supported role and status.';end if;
  update public.users set "Role"=p_role,"Status"=p_status,"UpdatedAt"=clock_timestamp() where "UserID"=p_user_id;
 elsif p_action='reset_password' then
  update public.users set "PasswordHash"=extensions.crypt('Password1*',extensions.gen_salt('bf',10)),"UpdatedAt"=clock_timestamp() where "UserID"=p_user_id;
 elsif p_action='delete' then
  delete from ats_private.user_invitations where user_id=p_user_id and admin_id=owner_id;
  delete from ats_private.activity_reads where account_type='user' and account_id=p_user_id;
  delete from public.users where "UserID"=p_user_id;
 else raise exception using errcode='22023',message='Unsupported user action.';
 end if;
 delete from ats_private.login_sessions where account_type='user' and account_id=p_user_id;
 return jsonb_build_object('saved',true,'action',p_action,'UserID',p_user_id,'AdminID',owner_id);
end $fn$;
revoke all on function public.ats_user_manage(text,integer,text,text,text) from public;
grant execute on function public.ats_user_manage(text,integer,text,text,text) to anon,authenticated;
notify pgrst,'reload schema';

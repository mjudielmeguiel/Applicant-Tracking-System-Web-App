-- Workspace-scoped destructive actions. No data is deleted when this file is installed.
create or replace function public.ats_workspace_delete(p_session_token text,p_action text,p_password text,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer; password_hash text; expected text; affected bigint;
begin
 owner_id:=ats_private.require_admin(p_session_token);
 select "PasswordHash" into password_hash from public.admins where "AdminID"=owner_id for update;
 if not ats_private.password_matches(p_password,password_hash) or p_password is null then
  raise exception using errcode='28000',message='The current admin password is incorrect.';
 end if;
 expected:=case p_action when 'applicants' then 'DELETE APPLICANTS' when 'records' then 'DELETE ALL RECORDS' when 'users' then 'DELETE USER ACCOUNTS' when 'workspace' then 'DELETE MY ADMIN ACCOUNT' else null end;
 if expected is null or p_confirmation is distinct from expected then
  raise exception using errcode='22023',message='Enter the exact confirmation phrase.';
 end if;
 if p_action in ('applicants','records','workspace') then
  delete from ats_private.job_post_applications where admin_id=owner_id;
  delete from ats_private.requirement_events where admin_id=owner_id;
  delete from public."Applicant_Masterlist" where "AdminID"=owner_id;
  get diagnostics affected=row_count;
  delete from ats_private.applicant_invitations where admin_id=owner_id;
  delete from ats_private.workbook_import_rows where import_id in(select id from ats_private.workbook_imports where admin_id=owner_id);
  delete from ats_private.workbook_imports where admin_id=owner_id;
  delete from ats_private.activity where admin_id=owner_id and entity_type='applicant';
 end if;
 if p_action in ('records','workspace') then
  delete from ats_private.job_posts where admin_id=owner_id;
  delete from public."Job_Opening" where admin_id=owner_id;
 end if;
 if p_action in ('users','workspace') then
  delete from ats_private.activity_reads where account_type='user' and account_id in(select "UserID" from public.users where "AdminID"=owner_id);
  delete from ats_private.login_sessions where account_type='user' and account_id in(select "UserID" from public.users where "AdminID"=owner_id);
  delete from ats_private.user_invitations where admin_id=owner_id or user_id in(select "UserID" from public.users where "AdminID"=owner_id);
  delete from ats_private.activity where admin_id=owner_id and entity_type='user';
  delete from public.users where "AdminID"=owner_id;
 end if;
 if p_action='workspace' then
  delete from ats_private.activity where admin_id=owner_id;
  delete from ats_private.activity_reads where account_type='admin' and account_id=owner_id;
  delete from ats_private.catalog_settings where admin_id=owner_id;
  delete from ats_private.invitation_policy where admin_id=owner_id;
  delete from ats_private.login_sessions where account_type='admin' and account_id=owner_id;
  delete from public.admins where "AdminID"=owner_id;
 end if;
 return jsonb_build_object('deleted',true,'action',p_action,'AdminID',owner_id,'applicantsDeleted',coalesce(affected,0));
end $fn$;
revoke all on function public.ats_workspace_delete(text,text,text,text) from public;
grant execute on function public.ats_workspace_delete(text,text,text,text) to anon,authenticated;
notify pgrst,'reload schema';

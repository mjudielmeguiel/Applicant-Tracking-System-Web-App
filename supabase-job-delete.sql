-- Deletes only an authorized, unused job listing; applicant history is preserved.
create or replace function public.ats_job_delete(p_session_token text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;job public."Job_Opening"%rowtype;counted jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);
 account:=ats_private.session_account(p_session_token);
 perform pg_advisory_xact_lock(1096045397,owner_id);
 select * into job from public."Job_Opening" where id=p_id and admin_id=owner_id for update;
 if not found or not(account->>'accountType'='admin' or job.creator_type=account->>'accountType' and job.creator_id=(account->>'id')::integer) then
  raise exception using errcode='42501',message='Only the posting HR user or your admin can delete this listing.';
 end if;
 select j into counted from jsonb_array_elements(ats_private.job_rows(owner_id)) j where j->>'id'=p_id::text;
 if coalesce((counted->>'applicant_count')::integer,0)>0 then
  raise exception using errcode='22023',message='This listing has applicant records and cannot be deleted. Edit its status to Occupied to close applications while preserving history.';
 end if;
 update ats_private.applicant_invitations set revoked_at=coalesce(revoked_at,clock_timestamp()),job_opening_id=null where admin_id=owner_id and job_opening_id=p_id;
 delete from public."Job_Opening" where id=p_id and admin_id=owner_id;
 return jsonb_build_object('deleted',true,'id',p_id,'AdminID',owner_id);
end $fn$;
revoke all on function public.ats_job_delete(text,uuid) from public;
grant execute on function public.ats_job_delete(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';

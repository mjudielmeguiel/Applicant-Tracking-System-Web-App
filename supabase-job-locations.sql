alter table ats_private.job_openings add column if not exists address text not null default '' check(length(address)<=1000);

-- Return occupant names only through the verified staff endpoint, never the
-- public invitation endpoint. Match the same records used by live slot counts.
create or replace function public.ats_jobs_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;data jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 select coalesce(jsonb_agg(j||jsonb_build_object(
 'can_edit',account->>'accountType'='admin' or j->>'creator_type'=account->>'accountType' and j->>'creator_id'=account->>'id',
 'occupied_applicants',(select coalesce(jsonb_agg(jsonb_build_object('id',a."ApplicantID",'name',coalesce(nullif(btrim(a."FullName"),''),nullif(btrim(a."Name"),''),'Applicant #'||a."ApplicantID"),'status',a."Status") order by a."ApplicantID"),'[]')
 from public."Applicant_Masterlist" a where a."AdminID"=owner_id and lower(btrim(a."Status")) in('hired','deployed') and
 (a."JobOpeningID"=(j->>'id')::uuid or a."JobOpeningID" is null and lower(btrim(coalesce(nullif(btrim(a."PositionApplied"),''),a."Position")))=lower(btrim(j->>'position_title')) and lower(btrim(a."Site"))=lower(btrim(j->>'site'))))
 ) order by j->>'position_title',j->>'site'),'[]') into data from jsonb_array_elements(ats_private.job_rows(owner_id)) j;
 return jsonb_build_object('AdminID',owner_id,'jobs',data);
end $fn$;

do $address$ declare definition text;
begin
 select pg_get_functiondef('public.ats_job_save(text,jsonb,uuid)'::regprocedure) into definition;
 if definition not like '%Unsupported job address%' then
 definition:=replace(definition,'owner_id:=ats_private.mrf_owner(p_session_token);',
 'if p_job ? ''address'' and (jsonb_typeof(p_job->''address'')<>''string'' or length(p_job->>''address'')>1000) then raise exception using errcode=''22023'',message=''Unsupported job address (maximum 1000 characters).'';end if;owner_id:=ats_private.mrf_owner(p_session_token);');
 definition:=replace(definition,'return jsonb_build_object(''saved'',true,''id'',target',
 'if p_job ? ''address'' then update ats_private.job_openings set address=btrim(p_job->>''address'') where id=target and admin_id=owner_id;end if;return jsonb_build_object(''saved'',true,''id'',target');
 execute definition;
 end if;
 select pg_get_functiondef('ats_private.application_finish(uuid)'::regprocedure) into definition;
 if definition not like '%''address'',job.address%' then
 definition:=replace(definition,'''description'',job.description,','''description'',job.description,''address'',job.address,');execute definition;
 end if;
 select pg_get_functiondef('public.ats_application_open(text)'::regprocedure) into definition;
 if definition not like '%''address'',j->>''address''%' then
 definition:=replace(definition,'''description'',j->>''description'',','''description'',j->>''description'',''address'',j->>''address'',');execute definition;
 end if;
end $address$;
revoke all on function public.ats_jobs_list(text) from public;
grant execute on function public.ats_jobs_list(text) to anon,authenticated;
notify pgrst,'reload schema';

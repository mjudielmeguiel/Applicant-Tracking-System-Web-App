CREATE OR REPLACE FUNCTION public.ats_applicant_save(p_session_token text, p_changes jsonb, p_applicant_id bigint DEFAULT NULL::bigint, p_client_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare owner_id integer;company_id uuid;payload jsonb;columns_sql text;field_name text;target_id bigint;result jsonb;account jsonb;is_new boolean; old_row jsonb; candidate jsonb; email_key text; phone_key text; date_field text;job public."Job_Opening"%rowtype;available integer;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 if p_changes is null or jsonb_typeof(p_changes)<>'object' or p_changes='{}'::jsonb then raise exception using errcode='22023',message='Enter the applicant details.';end if;
 -- Discard retired fields from an older open browser tab; none are stored.
 p_changes:=p_changes-array['Notes','ExcelSheet','ExcelRow','No.','LOCATION AND ACCOUNTS','DateApplied'];
 for field_name in select jsonb_object_keys(p_changes) loop if field_name='ExpectedStageVersion' then continue;end if;
  if field_name in('ApplicationInvitationID','StageVersion','FollowUpProcessedAt','WorkbookImportID','ApplicantID','AdminID','CompanyID','ExcelData','ClientRecordID','StatusChangedAt') or not exists(select 1 from pg_attribute where attrelid='public."Applicant_Masterlist"'::regclass and attname=field_name and attnum>0 and not attisdropped) then raise exception using errcode='42501',message='Unknown or read-only applicant field: '||field_name;end if;
 end loop;
 if p_client_id is not null and char_length(p_client_id)>100 then raise exception using errcode='22023',message='Invalid applicant client reference.';end if;
 select "CompanyID" into company_id from public.admins where "AdminID"=owner_id;
 perform pg_advisory_xact_lock(1096045397,owner_id);
 target_id:=p_applicant_id;
 if target_id is null and p_client_id is not null then select "ApplicantID" into target_id from public."Applicant_Masterlist" where "AdminID"=owner_id and "ClientRecordID"=p_client_id;end if;
 is_new:=target_id is null;
 if (is_new or p_changes?'Status') and (p_changes->>'Status' is null or p_changes->>'Status' not in('For Orientation','For Final Interview','Rejected','Backout','No Show','No Answer','For F2F Interview','Deployed','For Pooling','For Exam','For Job Offer','For Phone Interview','For Online Interview','Hired','RESIGNED')) then
 raise exception using errcode='22023',message='Choose one of the approved applicant statuses.';
 end if;
 if not is_new then perform 1 from public."Applicant_Masterlist" where "ApplicantID"=target_id and "AdminID"=owner_id for update;if not found then raise exception using errcode='42501',message='This applicant is unavailable for your AdminID.';end if;end if;
 
 if p_changes?'AutoOutcome' then perform ats_private.require_admin(p_session_token);end if;
 perform set_config('ats.followup.processing','false',true); perform set_config('ats.followup.policy_explicit',case when p_changes?'AutoOutcome' and p_changes->>'AutoOutcome' is not null then 'true' else 'false' end,true);
 payload:=(p_changes-'ExpectedStageVersion')||jsonb_build_object('AdminID',owner_id,'CompanyID',company_id);
 if p_client_id is not null then payload:=payload||jsonb_build_object('ClientRecordID',p_client_id);end if;
 -- Keep the workbook names and the normalized integration columns in sync.
 if payload?'Name' then payload:=payload||jsonb_build_object('FullName',payload->'Name');end if;
 if payload?'Position' then payload:=payload||jsonb_build_object('PositionApplied',payload->'Position');end if;
 if payload?'Contact Number' then payload:=payload||jsonb_build_object('ContactNumber',payload->'Contact Number');end if;
 if payload?'Email Address' then payload:=payload||jsonb_build_object('Email',payload->'Email Address');end if;
 if is_new then payload:=jsonb_build_object('Date',(clock_timestamp() at time zone 'Asia/Manila')::date)||payload;end if;
 if nullif(btrim(payload->>'Name'),'') is null and is_new then raise exception using errcode='22023',message='Applicant full name is required.';end if;
 if payload?'Email' and nullif(payload->>'Email','') is not null and (payload->>'Email')!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception using errcode='22023',message='Enter a valid applicant email.';end if;
 if not is_new then select to_jsonb(a) into old_row from public."Applicant_Masterlist" a where a."ApplicantID"=target_id and a."AdminID"=owner_id;end if;
 -- Older clients can still submit a valid existing position/site pair during rollout.
 if not payload?'JobOpeningID' and (is_new or (coalesce(payload->>'Position',old_row->>'Position'),coalesce(payload->>'Site',old_row->>'Site')) is distinct from (old_row->>'Position',old_row->>'Site')) then
 select j.* into job from public."Job_Opening" j where j.admin_id=owner_id and lower(btrim(j.position_title))=lower(btrim(payload->>'Position')) and lower(btrim(j.site))=lower(btrim(payload->>'Site')) and exists(select 1 from jsonb_array_elements(ats_private.job_rows(owner_id)) counts where counts->>'id'=j.id::text and (counts->>'remaining_slots')::integer>0) limit 1;
 if found then payload:=payload||jsonb_build_object('JobOpeningID',job.id);end if;
 end if;
 if payload?'Gender' and nullif(payload->>'Gender','') is not null and payload->>'Gender' not in('Male','Female') then raise exception using errcode='22023',message='Choose Male or Female for gender.';end if;
 if payload?'JobOpeningID' then
 if coalesce(payload->>'JobOpeningID','')!~'^[a-f0-9-]{36}$' then raise exception using errcode='22023',message='Choose an available job and site.';end if;
 select * into job from public."Job_Opening" where id=(payload->>'JobOpeningID')::uuid and admin_id=owner_id for update;
 if not found then raise exception using errcode='42501',message='This job belongs to another workspace or is unavailable.';end if;
 select (j->>'remaining_slots')::integer into available from jsonb_array_elements(ats_private.job_rows(owner_id)) j where j->>'id'=job.id::text;
 if coalesce(available,0)<=0 and (is_new or old_row->>'JobOpeningID' is distinct from job.id::text and (old_row->>'JobOpeningID' is not null or (old_row->>'Position',old_row->>'Site') is distinct from (job.position_title,job.site))) then raise exception using errcode='22023',message='Choose a job and site with available slots.';end if;
 payload:=payload||jsonb_build_object('Position',job.position_title,'PositionApplied',job.position_title,'Site',job.site);
 elsif is_new or (coalesce(payload->>'Position',old_row->>'Position'),coalesce(payload->>'Site',old_row->>'Site')) is distinct from (old_row->>'Position',old_row->>'Site') then
 raise exception using errcode='22023',message='Choose the job and site together from available openings.';
 elsif old_row->>'JobOpeningID' is not null then
 payload:=payload||jsonb_build_object('Position',old_row->>'Position','PositionApplied',old_row->>'Position','Site',old_row->>'Site');
 end if;

 
 if not is_new and (payload?'ScheduleDate' and payload->>'ScheduleDate' is distinct from old_row->>'ScheduleDate' or payload?'Status' and payload->>'Status' is distinct from old_row->>'Status') and not p_changes?'ScheduleResponse' then
 payload:=payload||jsonb_build_object('ScheduleResponse','Pending');
 end if;
 if not is_new and p_changes?'ExpectedStageVersion' and (p_changes->>'ExpectedStageVersion')::bigint is distinct from (old_row->>'StageVersion')::bigint then raise exception using errcode='40001',message='This applicant stage changed while the form was open. Close and refresh the record before saving.';end if;candidate:=coalesce(old_row,'{}'::jsonb)||payload;
 email_key:=nullif(lower(btrim(coalesce(nullif(btrim(candidate->>'Email'),''),candidate->>'Email Address'))),'');
 phone_key:=ats_private.contact_key(coalesce(nullif(btrim(candidate->>'ContactNumber'),''),candidate->>'Contact Number'));
 if email_key is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=owner_id and (target_id is null or a."ApplicantID"<>target_id) and nullif(lower(btrim(coalesce(nullif(btrim(a."Email"),''),a."Email Address"))),'')=email_key) then
  raise exception using errcode='23505',message='An applicant with this email address already exists in your AdminID.';
 end if;
 if phone_key is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=owner_id and (target_id is null or a."ApplicantID"<>target_id) and ats_private.contact_key(coalesce(nullif(btrim(a."ContactNumber"),''),a."Contact Number"))=phone_key) then
  raise exception using errcode='23505',message='An applicant with this contact number already exists in your AdminID.';
 end if;
 if is_new or candidate->>'Status' is distinct from old_row->>'Status' then
  payload:=payload||jsonb_build_object('StatusChangedAt',clock_timestamp());
  date_field:=case candidate->>'Status' when 'Screened' then 'DATE SCREENED' when 'Hired' then 'DATE HIRED' when 'Deployed' then 'Date of Deployment' when 'Rejected' then 'REJECTED DATE' when 'Backout' then 'BACKOUT DATE' else null end;
  if date_field is not null and nullif(candidate->>date_field,'') is null then payload:=payload||jsonb_build_object(date_field,(now() at time zone 'Asia/Manila')::date);end if;
 end if;

 select string_agg(quote_ident(key),',' order by key) into columns_sql from jsonb_object_keys(payload) as keys(key);
 if is_new then execute format('insert into public."Applicant_Masterlist" as a (%s) select %s from jsonb_populate_record(null::public."Applicant_Masterlist",$1) returning to_jsonb(a)',columns_sql,columns_sql) into result using payload;
 else execute format('update public."Applicant_Masterlist" as a set (%s)=(select %s from jsonb_populate_record(null::public."Applicant_Masterlist",$1)) where "ApplicantID"=$2 and "AdminID"=$3 returning to_jsonb(a)',columns_sql,columns_sql) into result using payload,target_id,owner_id;end if;
 if result is null then raise exception 'Supabase did not confirm saving the applicant.';end if;
 insert into ats_private.activity(admin_id,actor_type,actor_id,actor_name,action,entity_type,entity_id,entity_label) values(owner_id,account->>'accountType',(account->>'id')::integer,account->>'name',case when is_new then 'created' else 'updated' end,'applicant',result->>'ApplicantID',coalesce(result->>'FullName',result->>'Name','Applicant'));
 return result;
end $function$;


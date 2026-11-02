alter table ats_private.applicant_invitations add column if not exists requirements_confirmation boolean not null default true,add column if not exists requirements_submitted_at timestamptz;
update ats_private.applicant_invitations set requirements_confirmation=false where requirements_completed_at is not null;
CREATE OR REPLACE FUNCTION public.ats_application_open(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv ats_private.applicant_invitations%rowtype;brand jsonb;jobs jsonb;documents jsonb;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This application link is unavailable';end if;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not found or inv.revoked_at is not null then raise exception using errcode='28000',message='This application link is unavailable';end if;
 perform 1 from public.admins where "AdminID"=inv.admin_id and "Status"='Active' and "RoleID" in(1,2);if not found then raise exception using errcode='28000',message='This application link is unavailable';end if;
 brand:=ats_private.application_brand(inv.admin_id);
 if (not inv.requirements_confirmation or inv.requirements_submitted_at is not null) and inv.finished_at is not null and inv.applicant_id is not null and ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then
 update ats_private.applicant_invitations set requirements_completed_at=coalesce(requirements_completed_at,clock_timestamp()),requirements_expired_at=null where id=inv.id;
 return jsonb_build_object('closed',true,'companyInfo',brand);
 end if;
 if inv.requirements_started_at is null then
 update ats_private.applicant_invitations set started_at=coalesce(started_at,clock_timestamp()),deadline=null,requirements_started_at=clock_timestamp(),requirements_deadline=clock_timestamp()+make_interval(days=>requirements_days) where id=inv.id returning * into inv;
 end if;
 if ats_private.expire_requirements(inv.id) then
 return jsonb_build_object('closed',true,'expired',true,'company',brand->>'name','companyInfo',brand,'requirementsDays',inv.requirements_days,'requirementsDeadline',inv.requirements_deadline,'serverNow',clock_timestamp(),'inviter',coalesce(inv.inviter,ats_private.application_inviter('admin',inv.admin_id,inv.admin_id)));
 end if;
 if inv.finished_at is not null then
 documents:=ats_private.requirement_documents(inv.applicant_id,inv.admin_id);
 return jsonb_build_object('closed',false,'phase','requirements','company',brand->>'name','companyInfo',brand,'inviter',coalesce(inv.inviter,ats_private.application_inviter('admin',inv.admin_id,inv.admin_id)),'requiredDocuments',inv.required_documents,'documents',documents,'status',inv.result,'job',inv.job_snapshot,'requirementsDays',inv.requirements_days,'requirementsDeadline',inv.requirements_deadline,'serverNow',clock_timestamp());
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j->>'id','position_title',j->>'position_title','site',j->>'site','description',j->>'description','address',j->>'address','remaining_slots',(j->>'remaining_slots')::integer,'required_documents',j->'required_documents')),'[]') into jobs from jsonb_array_elements(ats_private.job_rows(inv.admin_id)) j where ((j->>'remaining_slots')::integer>0 or inv.linked_existing and j->>'id'=inv.job_opening_id::text) and (inv.job_opening_id is null or inv.job_opening_id::text=j->>'id');
 return jsonb_build_object('closed',false,'phase','application','existingApplicant',inv.linked_existing,'company',brand->>'name','companyInfo',brand,'inviter',coalesce(inv.inviter,ats_private.application_inviter('admin',inv.admin_id,inv.admin_id)),'jobs',jobs,'draft',inv.draft,'revision',inv.revision,'required',inv.required_fields,'choices',inv.choices,'instructions',inv.instructions,'fixedJob',inv.job_opening_id,'requirementsDays',inv.requirements_days,'requirementsDeadline',inv.requirements_deadline,'serverNow',clock_timestamp());
end $function$;
CREATE OR REPLACE FUNCTION ats_private.refresh_requirements(p_applicant bigint, p_owner integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare item record;ready boolean;rejected text;all_ready boolean:=true;has_inv boolean:=false;overdue boolean:=false;
begin
 for item in select * from ats_private.applicant_invitations where applicant_id=p_applicant and admin_id=p_owner and revoked_at is null for update loop
 has_inv:=true;ready:=ats_private.requirements_ready(p_applicant,p_owner,item.required_documents);all_ready:=all_ready and ready and (not item.requirements_confirmation or item.requirements_submitted_at is not null);
 update ats_private.applicant_invitations set requirements_submitted_at=case when ready then requirements_submitted_at else null end,requirements_completed_at=case when ready and (not requirements_confirmation or requirements_submitted_at is not null) then coalesce(requirements_completed_at,clock_timestamp()) else null end,requirements_expired_at=case when ready then null else requirements_expired_at end where id=item.id;
 if not ready and item.requirements_expired_at is not null then overdue:=true;end if;
 end loop;
 if not has_inv then all_ready:=ats_private.requirements_ready(p_applicant,p_owner,array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO']);end if;
 select string_agg(d->>'type',', ') into rejected from jsonb_array_elements(ats_private.requirement_documents(p_applicant,p_owner)) d where (d->>'latest')::boolean and d->>'review_status'='Rejected';
 update public."Applicant_Masterlist" set "Ongoing Requirements Status"=case when all_ready then 'All required documents submitted — pending review' when overdue then 'Requirements overdue — HR review' when rejected is not null then 'Rejected: '||rejected||' — upload replacements' when not all_ready and rejected is null and exists(select 1 from ats_private.applicant_invitations i where i.applicant_id=p_applicant and i.admin_id=p_owner and i.revoked_at is null and i.requirements_confirmation and i.requirements_submitted_at is null and ats_private.requirements_ready(p_applicant,p_owner,i.required_documents)) then 'Files uploaded — awaiting applicant submission' else 'Requirements in progress' end,
 "REQUIREMENTS COMPLETION DATE"=case when all_ready then coalesce("REQUIREMENTS COMPLETION DATE",(clock_timestamp() at time zone 'Asia/Manila')::date) else null end where "ApplicantID"=p_applicant and "AdminID"=p_owner;
end $function$;
CREATE OR REPLACE FUNCTION ats_private.expire_requirements(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare inv ats_private.applicant_invitations%rowtype;
begin
 select * into inv from ats_private.applicant_invitations where id=p_id for update;
 if not found or inv.revoked_at is not null or inv.requirements_deadline is null or inv.requirements_deadline>clock_timestamp() then return false;end if;
 if (not inv.requirements_confirmation or inv.requirements_submitted_at is not null) and inv.applicant_id is not null and ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then return false;end if;
 update ats_private.applicant_invitations set requirements_expired_at=coalesce(requirements_expired_at,clock_timestamp()),requirements_completed_at=null where id=inv.id;
 if inv.applicant_id is not null then update public."Applicant_Masterlist" set "Ongoing Requirements Status"='Requirements overdue — HR review',"REQUIREMENTS COMPLETION DATE"=null where "ApplicantID"=inv.applicant_id and "AdminID"=inv.admin_id;end if;
 insert into ats_private.requirement_events(admin_id,applicant_id,document_type,action,actor_name,applicant_name,source_key)
 values(inv.admin_id,inv.applicant_id,'Requirements','Overdue','System',coalesce(nullif(inv.draft->>'Name',''),inv.label),inv.id||':overdue:'||inv.requirements_deadline) on conflict(source_key) do nothing;
 return true;
end $function$;
create or replace function public.ats_requirements_submit(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv ats_private.applicant_invitations%rowtype;begin
if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This invitation is unavailable.';end if;
select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
if not found or inv.revoked_at is not null or inv.finished_at is null then raise exception using errcode='28000',message='This invitation is unavailable.';end if;
perform 1 from public.admins where "AdminID"=inv.admin_id and "Status"='Active' and "RoleID" in(1,2);if not found then raise exception using errcode='28000',message='This invitation is unavailable.';end if;
if inv.requirements_submitted_at is not null then return jsonb_build_object('saved',true,'closed',true);end if;
if ats_private.expire_requirements(inv.id) then return jsonb_build_object('closed',true,'expired',true);end if;
if not ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then raise exception using errcode='22023',message='Upload all required documents and replace rejected files before submitting.';end if;
update ats_private.applicant_invitations set requirements_submitted_at=clock_timestamp() where id=inv.id;
perform ats_private.refresh_requirements(inv.applicant_id,inv.admin_id);
insert into ats_private.requirement_events(admin_id,applicant_id,document_type,action,actor_name,applicant_name,source_key) values(inv.admin_id,inv.applicant_id,'Requirements','Submitted','Applicant',coalesce(inv.draft->>'Name',inv.label),inv.id||':final-submission') on conflict(source_key) do nothing;
return jsonb_build_object('saved',true,'closed',true);
end $$;
revoke all on function public.ats_requirements_submit(text) from public;
grant execute on function public.ats_requirements_submit(text) to anon,authenticated;
create or replace function public.ats_applicant_photos(p_session_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id integer;result jsonb;begin
owner_id:=ats_private.mrf_owner(p_session_token);
select coalesce(jsonb_agg(jsonb_build_object('applicantId',d.applicant_id,'documentId',d.id)),'[]') into result from
(select distinct on(applicant_id) id,applicant_id,storage_path from ats_private.applicant_documents where admin_id=owner_id and document_type='ID PHOTO' order by applicant_id,created_at desc,id desc)d
left join ats_private.document_reviews r on r.document_id=d.id where coalesce(r.status,'Submitted')<>'Rejected' and exists(select 1 from storage.objects o where o.bucket_id='applicant-documents' and o.name=d.storage_path);
return jsonb_build_object('AdminID',owner_id,'photos',result);end $$;
revoke all on function public.ats_applicant_photos(text) from public;
grant execute on function public.ats_applicant_photos(text) to anon,authenticated;

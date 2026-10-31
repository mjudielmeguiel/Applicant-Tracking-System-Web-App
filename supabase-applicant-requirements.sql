begin;
alter table public.admins add column if not exists "ContactNumber" text;
alter table public.users add column if not exists "ContactNumber" text;
alter table ats_private.applicant_invitations
 add column if not exists creator_type text,
 add column if not exists creator_id integer,
 add column if not exists inviter jsonb,
 add column if not exists requirements_completed_at timestamptz,
 add column if not exists required_documents text[] not null default array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME'];
alter table ats_private.applicant_invitations drop constraint if exists applicant_invitations_check;
alter table ats_private.applicant_invitations add constraint applicant_invitations_check check(deadline is null or started_at is not null);

create or replace function public.ats_profile_get(p_session_token text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare account jsonb;picture bytea;contact text;
begin
 account:=ats_private.session_account(p_session_token);
 if account->>'accountType'='admin' then select "ProfilePicture","ContactNumber" into picture,contact from public.admins where "AdminID"=(account->>'id')::integer;
 else select "ProfilePicture","ContactNumber" into picture,contact from public.users where "UserID"=(account->>'id')::integer;end if;
 return jsonb_build_object('name',account->>'name','email',account->>'email','contact',contact,'photo',ats_private.profile_data(picture));
end $fn$;
create or replace function public.ats_profile_update(p_session_token text,p_profile_picture bytea,p_contact text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare account jsonb;contact text:=nullif(btrim(p_contact),'');
begin
 account:=ats_private.session_account(p_session_token);perform ats_private.profile_data(p_profile_picture);
 if contact is not null and contact!~'^[+()0-9 .-]{7,25}$' then raise exception 'Use a contact number with 7–25 characters';end if;
 if account->>'accountType'='admin' then update public.admins set "ProfilePicture"=p_profile_picture,"ContactNumber"=contact,"UpdatedAt"=now() where "AdminID"=(account->>'id')::integer;
 else update public.users set "ProfilePicture"=p_profile_picture,"ContactNumber"=contact,"UpdatedAt"=now() where "UserID"=(account->>'id')::integer;end if;
 return public.ats_profile_get(p_session_token)||jsonb_build_object('saved',true);
end $fn$;
create or replace function ats_private.application_inviter(p_type text,p_id integer,p_owner integer)
returns jsonb language plpgsql set search_path='' as $fn$
declare result jsonb;picture bytea;photo text;
begin
 if p_type='user' then
 select jsonb_build_object('name',"FullName",'email',"Email",'contact',"ContactNumber",'role','Recruitment user'),"ProfilePicture" into result,picture from public.users where "UserID"=p_id and "AdminID"=p_owner;
 else
 select jsonb_build_object('name',"FullName",'email',"Email",'contact',"ContactNumber",'role','Administrator'),"ProfilePicture" into result,picture from public.admins where "AdminID"=p_id and "AdminID"=p_owner;
 end if;
 begin photo:=ats_private.profile_data(picture);exception when others then photo:=null;end;
 return coalesce(result,'{}')||jsonb_build_object('photo',photo);
end $fn$;
create or replace function ats_private.application_positions(p_owner integer) returns jsonb
language sql stable set search_path='' as $fn$
 with filled as(
 select lower(regexp_replace(btrim(coalesce(nullif(btrim("PositionApplied"),''),"Position")),'\s+',' ','g')) key,count(*)::integer n
 from public."Applicant_Masterlist" where "AdminID"=p_owner and lower(btrim("Status")) in('hired','deployed') group by 1
 ),available as(
 select p.position_title name,greatest(coalesce(s.slots_available,0)-coalesce(f.n,0),0) remaining_slots
 from public.positions p join ats_private.catalog_settings s on s.kind='position' and s.entry_id=p.position_id and s.admin_id=p_owner
 left join filled f on f.key=lower(regexp_replace(btrim(p.position_title),'\s+',' ','g'))
 ) select coalesce(jsonb_agg(to_jsonb(a) order by name),'[]') from available a where remaining_slots>0;
$fn$;
create or replace function public.ats_invitation_options(p_session_token text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;data jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);
 select to_jsonb(p) into data from ats_private.invitation_policy p where admin_id=owner_id;
 return coalesce(data,jsonb_build_object('applicant_minutes',60))||jsonb_build_object('applicant_mode','requirements');
end $fn$;

create or replace function public.ats_applicant_invite_create(p_session_token text,p_label text default null,p_minutes integer default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;policy ats_private.invitation_policy%rowtype;token text;inv ats_private.applicant_invitations%rowtype;catalog jsonb;choices jsonb;positions jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 insert into ats_private.invitation_policy(admin_id) values(owner_id) on conflict do nothing;
 select * into policy from ats_private.invitation_policy where admin_id=owner_id;
 if length(coalesce(p_label,''))>200 then raise exception 'Invitation label is too long';end if;
 catalog:=public.ats_catalog_list(p_session_token);positions:=ats_private.application_positions(owner_id);
 if jsonb_array_length(positions)=0 then raise exception 'No job positions have available slots. Ask your admin to update job slots in Settings.';end if;
 choices:=jsonb_build_object(
 'Position',(select jsonb_agg(v->>'name') from jsonb_array_elements(positions) v),
 'Source',(select coalesce(jsonb_agg(v->>'name'),'[]') from jsonb_array_elements(catalog->'sources') v),
 'Site',(select coalesce(jsonb_agg(v->>'name'),'[]') from jsonb_array_elements(catalog->'locations') v),
 'Gender',jsonb_build_array('Male','Female'));
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into ats_private.applicant_invitations(admin_id,token_hash,label,minutes,required_fields,instructions,choices,creator_type,creator_id,inviter)
 values(owner_id,ats_private.token_digest(token),coalesce(nullif(btrim(p_label),''),'Applicant invitation'),coalesce(p_minutes,policy.applicant_minutes),policy.required_fields,policy.instructions,choices,account->>'accountType',(account->>'id')::integer,ats_private.application_inviter(account->>'accountType',(account->>'id')::integer,owner_id)) returning * into inv;
 return jsonb_build_object('id',inv.id,'token',token,'AdminID',owner_id,'mode','requirements','inviter',inv.inviter);
end $fn$;

-- Retain existing validation and insert logic; change completion to a two-stage
-- application/requirements workflow. No background timeout may reject drafts.
do $upgrade$
declare definition text;
begin
 select pg_get_functiondef('ats_private.application_issues(ats_private.applicant_invitations,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'not (inv.choices->field)?value','(field=''Position'' and not exists(select 1 from jsonb_array_elements(ats_private.application_positions(inv.admin_id)) p where p->>''name''=data->>field) or field<>''Position'' and not (inv.choices->field)?value)');
 definition:=replace(definition,'where p->>''name''=value)','where p->>''name''=data->>field)');
 if definition not like '%Gender: choose Male or Female%' then
 definition:=replace(definition,' return issues;', E' if nullif(data->>''Position'','''') is not null and not exists(select 1 from jsonb_array_elements(ats_private.application_positions(inv.admin_id)) p where p->>''name''=data->>''Position'') then issues:=array_append(issues,''Position: no available slots; select another position'');end if;\n if nullif(data->>''Gender'','''') is not null and data->>''Gender'' not in(''Male'',''Female'') then issues:=array_append(issues,''Gender: choose Male or Female'');end if;\n return issues;');
 execute definition;
 end if;
 execute definition;
 select pg_get_functiondef('ats_private.application_finish(uuid)'::regprocedure) into definition;
 definition:=replace(definition,'not (inv.choices->''Position'')?position','not exists(select 1 from jsonb_array_elements(ats_private.application_positions(inv.admin_id)) p where p->>''name''=position)');
 if definition not like '%Correct the application information%' then
 definition:=replace(definition,'status:=case when cardinality(problems)>0 then ''Rejected'' else ''For Pooling'' end;', 'if cardinality(problems)>0 then raise exception using errcode=''22023'',message=''Correct the application information: ''||array_to_string(problems,''; '');end if;status:=''For Pooling'';');
 definition:=replace(definition,'''closed'',true,''saved'',true,''status'',status','''closed'',false,''phase'',''requirements'',''saved'',true,''status'',status');
 if definition not like '%Correct the application information%' then raise exception 'Unable to upgrade application completion';end if;
 execute definition;
 end if;
 execute definition;
 select pg_get_functiondef('public.ats_application_save(text,jsonb,integer,boolean)'::regprocedure) into definition;
 definition:=replace(definition,'if inv.finished_at is not null then return jsonb_build_object(''closed'',true);end if;','if inv.finished_at is not null then return public.ats_application_open(p_token);end if;');
 definition:=replace(definition,'if inv.deadline<=clock_timestamp() then return ats_private.application_finish(inv.id);end if;','');
 execute definition;
end $upgrade$;

create or replace function ats_private.process_application_deadlines() returns integer language plpgsql security definer set search_path='' as $fn$ begin return 0;end $fn$;
do $cron$ declare item record;begin
 for item in select jobid from cron.job where jobname='ats-application-invitation-deadlines' loop perform cron.unschedule(item.jobid);end loop;
end $cron$;

create or replace function public.ats_application_open(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype;company text;documents jsonb;positions jsonb;choices jsonb;complete boolean;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This application link is unavailable';end if;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not found or inv.revoked_at is not null then raise exception using errcode='28000',message='This application link is unavailable';end if;
 if inv.requirements_completed_at is not null then return jsonb_build_object('closed',true);end if;
 perform 1 from public.admins where "AdminID"=inv.admin_id and "Status"='Active' and "RoleID" in(1,2);
 if not found then raise exception using errcode='28000',message='This application link is unavailable';end if;
 if inv.started_at is null then update ats_private.applicant_invitations set started_at=clock_timestamp(),deadline=null where id=inv.id returning * into inv;end if;
 select details->>'name' into company from ats_private.company_branding where admin_id=inv.admin_id;
 if inv.finished_at is not null then
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'type',d.document_type,'filename',d.filename,'size',d.byte_size) order by d.created_at),'[]') into documents from ats_private.applicant_documents d where d.applicant_id=inv.applicant_id and d.admin_id=inv.admin_id;
 select not exists(select 1 from unnest(inv.required_documents) k where not exists(select 1 from ats_private.applicant_documents d where d.applicant_id=inv.applicant_id and d.admin_id=inv.admin_id and d.document_type=k)) into complete;
 if complete then update ats_private.applicant_invitations set requirements_completed_at=clock_timestamp() where id=inv.id;return jsonb_build_object('closed',true);end if;
 return jsonb_build_object('closed',false,'phase','requirements','company',coalesce(company,'Company'),'inviter',coalesce(inv.inviter,ats_private.application_inviter('admin',inv.admin_id,inv.admin_id)),'requiredDocuments',inv.required_documents,'documents',documents,'status',inv.result);
 end if;
 positions:=ats_private.application_positions(inv.admin_id);
 choices:=jsonb_set(inv.choices,'{Position}',coalesce((select jsonb_agg(p->>'name') from jsonb_array_elements(positions) p),'[]'))||jsonb_build_object('Gender',jsonb_build_array('Male','Female'));
 return jsonb_build_object('closed',false,'phase','application','company',coalesce(company,'Company'),'inviter',coalesce(inv.inviter,ats_private.application_inviter('admin',inv.admin_id,inv.admin_id)),'positions',positions,'draft',inv.draft,'revision',inv.revision,'required',inv.required_fields,'choices',choices,'instructions',inv.instructions);
end $fn$;

create or replace function public.ats_applicant_invite_list(p_session_token text,p_revoke uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;output jsonb;is_admin boolean;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);is_admin:=account->>'accountType'='admin';
 if p_revoke is not null then
 update ats_private.applicant_invitations set revoked_at=clock_timestamp() where id=p_revoke and admin_id=owner_id and requirements_completed_at is null and (is_admin or creator_type=account->>'accountType' and creator_id=(account->>'id')::integer);
 end if;
 select coalesce(jsonb_agg(to_jsonb(i) order by created_at desc),'[]') into output from
 (select id,label,created_at,started_at,finished_at,requirements_completed_at,applicant_id,result,issues,inviter,creator_type,creator_id,
 case when revoked_at is not null then 'Revoked' when requirements_completed_at is not null then 'Complete' when finished_at is not null then 'Requirements pending' when started_at is null then 'Not started' else 'In progress' end state
 from ats_private.applicant_invitations where admin_id=owner_id and (is_admin or creator_type=account->>'accountType' and creator_id=(account->>'id')::integer) order by created_at desc limit 100) i;
 return output;
end $fn$;
create or replace function public.ats_applicant_invite_detail(p_session_token text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;output jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 select jsonb_build_object('draft',i.draft,'issues',i.issues,'result',i.result,'label',i.label) into output from ats_private.applicant_invitations i where i.id=p_id and i.admin_id=owner_id and (account->>'accountType'='admin' or i.creator_type=account->>'accountType' and i.creator_id=(account->>'id')::integer);
 if output is null then raise exception using errcode='42501',message='This application is unavailable for your account';end if;return output;
end $fn$;

create or replace function public.ats_application_upload_access(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This application link is unavailable';end if;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not found or inv.revoked_at is not null or inv.requirements_completed_at is not null or inv.applicant_id is null or inv.finished_at is null then raise exception using errcode='28000',message='This requirements link is closed or the application form has not been submitted';end if;
 perform 1 from public.admins where "AdminID"=inv.admin_id and "Status"='Active' and "RoleID" in(1,2);
 if not found then raise exception using errcode='28000',message='This application link is unavailable';end if;
 return jsonb_build_object('admin_id',inv.admin_id,'applicant_id',inv.applicant_id,'required',inv.required_documents);
end $fn$;
create or replace function public.ats_application_document_register(p_token text,p_id uuid,p_document_type text,p_filename text,p_mime_type text,p_byte_size integer,p_storage_path text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare access jsonb;owner_id integer;applicant bigint;inv ats_private.applicant_invitations%rowtype;complete boolean;
begin
 access:=public.ats_application_upload_access(p_token);owner_id:=(access->>'admin_id')::integer;applicant:=(access->>'applicant_id')::bigint;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not p_document_type=any(inv.required_documents) then raise exception 'Unsupported requirement category';end if;
 if p_storage_path not like owner_id||'/'||applicant||'/'||p_id||'.%' then raise exception 'Invalid requirements storage path';end if;
 if p_byte_size not between 1 and 10485760 or not exists(select 1 from storage.objects where bucket_id='applicant-documents' and name=p_storage_path and (metadata->>'size')::bigint=p_byte_size and metadata->>'mimetype'=p_mime_type) then raise exception 'The uploaded file could not be verified';end if;
 insert into ats_private.applicant_documents(id,admin_id,applicant_id,document_type,filename,mime_type,byte_size,storage_path) values(p_id,owner_id,applicant,p_document_type,left(p_filename,180),p_mime_type,p_byte_size,p_storage_path);
 execute format('update public."Applicant_Masterlist" set %I=''Submitted'' where "ApplicantID"=$1 and "AdminID"=$2',p_document_type) using applicant,owner_id;
 select not exists(select 1 from unnest(inv.required_documents) k where not exists(select 1 from ats_private.applicant_documents d where d.applicant_id=applicant and d.admin_id=owner_id and d.document_type=k)) into complete;
 update public."Applicant_Masterlist" set "Ongoing Requirements Status"=case when complete then 'All documents submitted — pending review' else 'Requirements in progress' end,"REQUIREMENTS COMPLETION DATE"=case when complete then (clock_timestamp() at time zone 'Asia/Manila')::date else "REQUIREMENTS COMPLETION DATE" end where "ApplicantID"=applicant and "AdminID"=owner_id;
 if complete then update ats_private.applicant_invitations set requirements_completed_at=clock_timestamp() where id=inv.id;end if;
 insert into ats_private.activity(admin_id,actor_type,actor_name,action,entity_type,entity_id,entity_label) values(owner_id,'system','Applicant requirements portal','updated','applicant',applicant::text,p_document_type||' document uploaded');
 return jsonb_build_object('saved',true,'id',p_id,'closed',complete);
end $fn$;

-- Remove obsolete countdown/rejection instructions only when they are the old
-- built-in text. Custom instructions remain under the admin's control.
update ats_private.invitation_policy set instructions='Complete your accurate personal information and choose a job position with available slots. After submitting the application form, use this same link to upload all required documents. The link remains open until every required document is uploaded. Contact your recruiter if you need help.' where instructions like 'Enter your own accurate information. Complete every field marked required. Your countdown starts%';
update ats_private.applicant_invitations set instructions='Complete your accurate personal information and choose a job position with available slots. After submitting the application form, use this same link to upload all required documents. The link remains open until every required document is uploaded. Contact your recruiter if you need help.' where instructions like 'Enter your own accurate information. Complete every field marked required. Your countdown starts%';
alter table ats_private.invitation_policy alter column instructions set default 'Complete your accurate personal information and choose a job position with available slots. After submitting the application form, use this same link to upload all required documents. The link remains open until every required document is uploaded. Contact your recruiter if you need help.';

revoke all on function ats_private.application_inviter(text,integer,integer),ats_private.application_positions(integer) from public,anon,authenticated;
revoke all on function public.ats_application_upload_access(text),public.ats_application_document_register(text,uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.ats_application_upload_access(text),public.ats_application_document_register(text,uuid,text,text,text,integer,text) to service_role;
revoke all on function public.ats_invitation_options(text),public.ats_profile_update(text,bytea,text) from public,anon,authenticated;
grant execute on function public.ats_invitation_options(text),public.ats_profile_update(text,bytea,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;

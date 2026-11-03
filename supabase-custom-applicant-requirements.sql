create table if not exists ats_private.applicant_requirement_plans(
 applicant_id bigint primary key references public."Applicant_Masterlist"("ApplicantID") on delete cascade,
 admin_id integer not null references public.admins("AdminID"),required_documents text[] not null,statuses jsonb not null default '{}',updated_at timestamptz not null default now()
);
alter table ats_private.applicant_requirement_plans enable row level security;
revoke all on ats_private.applicant_requirement_plans from public,anon,authenticated;
create or replace function ats_private.applicant_required(p_applicant bigint,p_owner integer) returns text[] language sql stable set search_path='' as $$
select coalesce((select required_documents from ats_private.applicant_requirement_plans where applicant_id=p_applicant and admin_id=p_owner),(select required_documents from ats_private.applicant_invitations where applicant_id=p_applicant and admin_id=p_owner order by created_at desc limit 1),(select j.required_documents from public."Applicant_Masterlist" a join public."Job_Opening" j on j.id=a."JobOpeningID" and j.admin_id=p_owner where a."ApplicantID"=p_applicant and a."AdminID"=p_owner),array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO']);$$;
create or replace function ats_private.applicant_requirement_statuses(p_applicant bigint,p_owner integer) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_object_agg(kind,coalesce(nullif(p.statuses->>kind,''),nullif(to_jsonb(a)->>kind,''),(select coalesce(r.status,'Submitted') from ats_private.applicant_documents d left join ats_private.document_reviews r on r.document_id=d.id where d.applicant_id=p_applicant and d.admin_id=p_owner and d.document_type=kind order by d.created_at desc,d.id desc limit 1),'Pending')),'{}')
 from public."Applicant_Masterlist" a left join ats_private.applicant_requirement_plans p on p.applicant_id=a."ApplicantID" and p.admin_id=p_owner cross join unnest(ats_private.applicant_required(p_applicant,p_owner)) kind where a."ApplicantID"=p_applicant and a."AdminID"=p_owner;$$;
create or replace function ats_private.set_applicant_requirement_status(p_applicant bigint,p_owner integer,p_kind text,p_status text) returns void language plpgsql set search_path='' as $$
begin
 if p_kind=any(array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME']) then
 execute format('update public."Applicant_Masterlist" set %I=$1 where "ApplicantID"=$2 and "AdminID"=$3',p_kind) using p_status,p_applicant,p_owner;
 update ats_private.applicant_requirement_plans set statuses=statuses-p_kind where applicant_id=p_applicant and admin_id=p_owner;
 else
 insert into ats_private.applicant_requirement_plans(applicant_id,admin_id,required_documents,statuses) values(p_applicant,p_owner,ats_private.applicant_required(p_applicant,p_owner),jsonb_build_object(p_kind,p_status)) on conflict(applicant_id) do update set statuses=applicant_requirement_plans.statuses||excluded.statuses,updated_at=now();
 end if;
end $$;
create or replace function ats_private.requirements_ready(p_applicant bigint,p_owner integer,p_required text[]) returns boolean language sql stable set search_path='' as $$
 select not exists(select 1 from unnest(p_required) kind where not (lower(btrim(coalesce(ats_private.applicant_requirement_statuses(p_applicant,p_owner)->>kind,''))) in('submitted','verified','accepted','not required') or coalesce((select coalesce(r.status,'Submitted')<>'Rejected' and exists(select 1 from storage.objects o where o.bucket_id='applicant-documents' and o.name=d.storage_path and (o.metadata->>'size')::bigint=d.byte_size) from ats_private.applicant_documents d left join ats_private.document_reviews r on r.document_id=d.id where d.applicant_id=p_applicant and d.admin_id=p_owner and d.document_type=kind order by d.created_at desc,d.id desc limit 1),false)));$$;
create or replace function public.ats_applicant_requirements(p_session_token text,p_applicant_id bigint,p_required text[] default null,p_statuses jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id integer;kind text;value text;required text[];
begin
 owner_id:=ats_private.mrf_owner(p_session_token);perform public.ats_document_access(p_session_token,p_applicant_id,null);
 perform 1 from ats_private.applicant_invitations where applicant_id=p_applicant_id and admin_id=owner_id order by id for update;
 perform 1 from public."Applicant_Masterlist" where "ApplicantID"=p_applicant_id and "AdminID"=owner_id for update;
 if p_required is not null then
  if cardinality(p_required) not between 1 and 40 or exists(select 1 from unnest(p_required) k where k is null or length(btrim(k)) not between 1 and 80 or k~'[[:cntrl:]]') then raise exception 'Choose 1–40 requirements with names up to 80 characters.';end if;
  select array_agg(k order by n) into required from(select upper(btrim(k)) k,min(n) n from unnest(p_required) with ordinality x(k,n) group by upper(btrim(k))) names;
  insert into ats_private.applicant_requirement_plans(applicant_id,admin_id,required_documents) values(p_applicant_id,owner_id,required) on conflict(applicant_id) do update set required_documents=excluded.required_documents,updated_at=now();
  if p_statuses is not null then
   if jsonb_typeof(p_statuses)<>'object' then raise exception 'Invalid requirement statuses';end if;
   for kind,value in select e.key,e.value from jsonb_each_text(p_statuses) e loop
    if not kind=any(required) or value not in('Pending','Submitted','Verified','Accepted','Rejected','Not required') then raise exception 'Unsupported requirement status';end if;
    perform ats_private.set_applicant_requirement_status(p_applicant_id,owner_id,kind,value);
   end loop;
  end if;
  update ats_private.applicant_invitations set required_documents=required,job_snapshot=coalesce(job_snapshot,'{}')||jsonb_build_object('required_documents',required),requirements_completed_at=case when required_documents is distinct from required then null else requirements_completed_at end,requirements_submitted_at=case when required_documents is distinct from required then null else requirements_submitted_at end where applicant_id=p_applicant_id and admin_id=owner_id;
  perform ats_private.refresh_requirements(p_applicant_id,owner_id);
 end if;
 return jsonb_build_object('AdminID',owner_id,'applicantId',p_applicant_id,'requiredDocuments',ats_private.applicant_required(p_applicant_id,owner_id),'statuses',ats_private.applicant_requirement_statuses(p_applicant_id,owner_id));
end $$;
revoke all on function public.ats_applicant_requirements(text,bigint,text[],jsonb) from public;
grant execute on function public.ats_applicant_requirements(text,bigint,text[],jsonb) to anon,authenticated;
alter table ats_private.applicant_documents drop constraint if exists applicant_documents_document_type_check;
alter table ats_private.applicant_documents add constraint applicant_documents_document_type_check check(length(document_type) between 1 and 80 and document_type !~ '[[:cntrl:]]');
-- Extend existing authenticated upload/review paths without exposing private helpers.
do $patch$
declare definition text;old_text text;
begin
 definition:=pg_get_functiondef('public.ats_document_upload_record(text,text,bigint,uuid,text,text,text,integer,text,jsonb)'::regprocedure);
 old_text:='if p_document_type not in(''NBI'',''POLICE'',''SSS'',''PHILHEALTH'',''PAG IBIG'',''TIN'',''MEDICAL'',''DIPLOMA'',''TOR'',''RESUME'',''ID PHOTO'') then raise exception ''Invalid requirement category'';end if;';
 if position(old_text in definition)=0 then raise exception 'Upload category mapping changed';end if;
 definition:=replace(definition,old_text,'if not p_document_type=any(ats_private.applicant_required(applicant,owner_id)) then raise exception ''Invalid requirement category'';end if;');
 definition:=replace(definition,'else execute format(''update public."Applicant_Masterlist" set %I=$1 where "ApplicantID"=$2 and "AdminID"=$3'',p_document_type) using status,applicant,owner_id;end if;','else perform ats_private.set_applicant_requirement_status(applicant,owner_id,p_document_type,status);end if;');
 definition:=replace(definition,'perform ats_private.refresh_requirements(applicant,owner_id);','if p_document_type=''ID PHOTO'' then perform ats_private.set_applicant_requirement_status(applicant,owner_id,p_document_type,status);end if;perform ats_private.refresh_requirements(applicant,owner_id);');execute definition;
 definition:=pg_get_functiondef('public.ats_document_review(text,uuid,text,text)'::regprocedure);
 definition:=replace(definition,'if item->>''document_type''<>''ID PHOTO'' then execute format(''update public."Applicant_Masterlist" set %I=$1 where "ApplicantID"=$2 and "AdminID"=$3'',item->>''document_type'') using p_status,(item->>''applicant_id'')::bigint,owner_id;end if;','perform ats_private.set_applicant_requirement_status((item->>''applicant_id'')::bigint,owner_id,item->>''document_type'',p_status);');execute definition;
 definition:=pg_get_functiondef('public.ats_application_open(text)'::regprocedure);
 definition:=replace(definition,'brand:=ats_private.application_brand(inv.admin_id);','if inv.applicant_id is not null and exists(select 1 from ats_private.applicant_requirement_plans where applicant_id=inv.applicant_id and admin_id=inv.admin_id) then inv.required_documents:=ats_private.applicant_required(inv.applicant_id,inv.admin_id);end if;brand:=ats_private.application_brand(inv.admin_id);');
 definition:=replace(definition,'''requiredDocuments'',inv.required_documents,','''requirementStatuses'',ats_private.applicant_requirement_statuses(inv.applicant_id,inv.admin_id),''requiredDocuments'',inv.required_documents,');execute definition;
 definition:=pg_get_functiondef('public.ats_applicant_invite_existing(text,bigint,integer)'::regprocedure);
 definition:=replace(definition,'coalesce(job.required_documents,array[''NBI'',''POLICE'',''SSS'',''PHILHEALTH'',''PAG IBIG'',''TIN'',''MEDICAL'',''DIPLOMA'',''TOR'',''RESUME'',''ID PHOTO''])','ats_private.applicant_required(person."ApplicantID",owner_id)');execute definition;
 definition:=pg_get_functiondef('ats_private.application_finish(uuid)'::regprocedure);
 definition:=replace(definition,'required_documents=job.required_documents','required_documents=coalesce((select required_documents from ats_private.applicant_requirement_plans where applicant_id=target and admin_id=inv.admin_id),job.required_documents)');execute definition;
 definition:=pg_get_functiondef('ats_private.refresh_requirements(bigint,integer)'::regprocedure);
 definition:=replace(definition,'array[''NBI'',''POLICE'',''SSS'',''PHILHEALTH'',''PAG IBIG'',''TIN'',''MEDICAL'',''DIPLOMA'',''TOR'',''RESUME'',''ID PHOTO'']','ats_private.applicant_required(p_applicant,p_owner)');execute definition;
end $patch$;
create or replace function ats_private.automatic_requirement_completion() returns trigger language plpgsql set search_path='' as $$
declare payload jsonb:=to_jsonb(new);kind text;complete boolean:=true;value text;required text[];
begin
 required:=ats_private.applicant_required(new."ApplicantID",new."AdminID");
 foreach kind in array required loop
  value:=coalesce(payload->>kind,ats_private.applicant_requirement_statuses(new."ApplicantID",new."AdminID")->>kind,'Pending');
  if lower(btrim(value)) not in('submitted','verified','accepted','not required') then complete:=false;end if;
 end loop;
 if complete then new."REQUIREMENTS COMPLETION DATE":=case when tg_op='UPDATE' then coalesce(old."REQUIREMENTS COMPLETION DATE",(now() at time zone 'Asia/Manila')::date) else (now() at time zone 'Asia/Manila')::date end;else new."REQUIREMENTS COMPLETION DATE":=null;end if;
 return new;
end $$;
revoke all on function ats_private.applicant_required(bigint,integer),ats_private.applicant_requirement_statuses(bigint,integer),ats_private.set_applicant_requirement_status(bigint,integer,text,text) from public,anon,authenticated;
notify pgrst,'reload schema';
-- HR statuses are authoritative, including completion without an attached file.
create or replace function ats_private.requirements_ready(p_applicant bigint,p_owner integer,p_required text[]) returns boolean language sql stable set search_path='' as $$
select not exists(select 1 from unnest(p_required) kind where lower(btrim(coalesce(ats_private.applicant_requirement_statuses(p_applicant,p_owner)->>kind,''))) not in('submitted','verified','accepted','not required'));$$;
do $patch$
declare definition text;first_pos integer;last_pos integer;
begin
 definition:=pg_get_functiondef('public.ats_application_upload_access(text)'::regprocedure);
 first_pos:=strpos(definition,'select coalesce(jsonb_agg(k)');last_pos:=strpos(definition,'return jsonb_build_object(''admin_id''');
 if first_pos=0 or last_pos<=first_pos then raise exception 'Upload access definition changed';end if;
 definition:=substring(definition,1,first_pos-1)||'select coalesce(jsonb_agg(k),''[]'') into allowed from unnest(inv.required_documents) k where not ats_private.requirements_ready(inv.applicant_id,inv.admin_id,array[k]);'||substring(definition,last_pos);execute definition;
 definition:=pg_get_functiondef('public.ats_document_remove(text,uuid)'::regprocedure);
 definition:=replace(definition,'perform ats_private.refresh_requirements(', 'perform ats_private.set_applicant_requirement_status((item->>''applicant_id'')::bigint,(item->>''admin_id'')::integer,item->>''document_type'',coalesce((select coalesce(r.status,''Submitted'') from ats_private.applicant_documents d left join ats_private.document_reviews r on r.document_id=d.id where d.applicant_id=(item->>''applicant_id'')::bigint and d.admin_id=(item->>''admin_id'')::integer and d.document_type=item->>''document_type'' order by d.created_at desc,d.id desc limit 1),''Pending''));perform ats_private.refresh_requirements(');execute definition;
end $patch$;

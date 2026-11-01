create or replace function ats_private.automatic_requirement_completion()
returns trigger language plpgsql set search_path='' as $$
declare payload jsonb:=to_jsonb(new); kind text; complete boolean:=true;
begin
 foreach kind in array array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME'] loop
 if nullif(btrim(payload->>kind),'') is null or (payload->>kind) ~* 'pending|missing|rejected|not submitted|not yet|follow.?up' then complete:=false;end if;
 end loop;
 if complete then
 new."REQUIREMENTS COMPLETION DATE":=case when tg_op='UPDATE' then coalesce(old."REQUIREMENTS COMPLETION DATE",(now() at time zone 'Asia/Manila')::date) else (now() at time zone 'Asia/Manila')::date end;
 else new."REQUIREMENTS COMPLETION DATE":=null;
 end if;
 return new;
end $$;
revoke all on function ats_private.automatic_requirement_completion() from public,anon,authenticated;
drop trigger if exists ats_requirements_completion on public."Applicant_Masterlist";
create trigger ats_requirements_completion before insert or update on public."Applicant_Masterlist" for each row execute function ats_private.automatic_requirement_completion();

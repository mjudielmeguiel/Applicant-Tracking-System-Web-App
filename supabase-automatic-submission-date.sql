create or replace function ats_private.automatic_submission_date() returns trigger language plpgsql set search_path='' as $fn$
begin
 if tg_op='INSERT' then
  if new."WorkbookImportID" is null then new."Submission Date":=(clock_timestamp() at time zone 'Asia/Manila')::date;
  else new."Submission Date":=coalesce(new."Submission Date",(new."DateApplied" at time zone 'Asia/Manila')::date,new."Date",(clock_timestamp() at time zone 'Asia/Manila')::date);end if;
 else
  new."Submission Date":=coalesce(old."Submission Date",(old."DateApplied" at time zone 'Asia/Manila')::date,old."Date",(clock_timestamp() at time zone 'Asia/Manila')::date);
 end if;
 return new;
end $fn$;
revoke all on function ats_private.automatic_submission_date() from public,anon,authenticated;
drop trigger if exists ats_submission_date on public."Applicant_Masterlist";
create trigger ats_submission_date before insert or update on public."Applicant_Masterlist" for each row execute function ats_private.automatic_submission_date();

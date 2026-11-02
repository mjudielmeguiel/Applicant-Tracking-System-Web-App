alter table ats_private.applicant_invitations alter column requirements_confirmation set default false;
update ats_private.applicant_invitations set requirements_confirmation=false where requirements_submitted_at is null;
create or replace function public.ats_application_prepare(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv ats_private.applicant_invitations%rowtype;begin
if p_token is not null and p_token~'^[a-f0-9]{64}$' then
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if found and inv.revoked_at is null and inv.requirements_completed_at is null then update ats_private.applicant_invitations set requirements_confirmation=true where id=inv.id;end if;
end if;
return public.ats_application_open(p_token);end $$;
revoke all on function public.ats_application_prepare(text) from public;
grant execute on function public.ats_application_prepare(text) to anon,authenticated;

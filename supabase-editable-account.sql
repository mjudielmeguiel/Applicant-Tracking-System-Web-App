create or replace function public.ats_account_update(p_session_token text,p_name text,p_email text,p_contact text,p_profile_picture bytea) returns jsonb language plpgsql security definer set search_path='' as $$
declare account jsonb; full_name text:=btrim(p_name); email_address text:=lower(nullif(btrim(p_email),''));
begin
account:=ats_private.session_account(p_session_token);
if full_name is null or length(full_name)<2 or length(full_name)>120 then raise exception 'Enter a full name between 2 and 120 characters.';end if;
if email_address is not null and (length(email_address)>254 or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Enter a valid email address.';end if;
perform pg_advisory_xact_lock(hashtextextended('account-email:'||coalesce(email_address,''),0));
if email_address is not null and (exists(select 1 from public.admins where lower("Email")=email_address and not(account->>'accountType'='admin' and "AdminID"=(account->>'id')::integer)) or exists(select 1 from public.users where lower("Email")=email_address and not(account->>'accountType'='user' and "UserID"=(account->>'id')::integer))) then raise exception 'This email address is already used by another account.';end if;
perform public.ats_profile_update(p_session_token,p_profile_picture,p_contact);
if account->>'accountType'='admin' then update public.admins set "FullName"=full_name,"Email"=email_address,"UpdatedAt"=now() where "AdminID"=(account->>'id')::integer;
else update public.users set "FullName"=full_name,"Email"=email_address,"UpdatedAt"=now() where "UserID"=(account->>'id')::integer;end if;
return public.ats_profile_get(p_session_token)||jsonb_build_object('saved',true);
end $$;
revoke all on function public.ats_account_update(text,text,text,text,bytea) from public;
grant execute on function public.ats_account_update(text,text,text,text,bytea) to anon,authenticated;

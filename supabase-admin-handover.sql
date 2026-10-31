-- Add single-use, 30-minute admin handover invitations to the existing
-- private user invitation capability. Run after the user invitation setup.

alter table ats_private.user_invitations
  add column if not exists invite_type text not null default 'user',
  add column if not exists expected_admin_hash text;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'ats_private.user_invitations'::regclass
      and conname = 'user_invitations_invite_type_check'
  ) then
    alter table ats_private.user_invitations
      add constraint user_invitations_invite_type_check
      check (invite_type in ('user','admin_handover'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'ats_private.user_invitations'::regclass
      and conname = 'user_invitations_admin_handover_hash_check'
  ) then
    alter table ats_private.user_invitations
      add constraint user_invitations_admin_handover_hash_check
      check ((invite_type='user' and expected_admin_hash is null) or (invite_type='admin_handover' and (expected_admin_hash is not null or consumed_at is not null)));
  end if;
end
$constraint$;

-- Upgrade the earlier rule so a consumed handover can erase its old password hash.
alter table ats_private.user_invitations drop constraint user_invitations_admin_handover_hash_check;
alter table ats_private.user_invitations add constraint user_invitations_admin_handover_hash_check
  check ((invite_type='user' and expected_admin_hash is null) or (invite_type='admin_handover' and (expected_admin_hash is not null or consumed_at is not null)));

create or replace function public.ats_admin_handover_create(
  p_session_token text,
  p_current_password text,
  p_full_name text default null,
  p_username text default null,
  p_email text default null,
  p_profile_picture bytea default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  account jsonb;
  admin_row public.admins%rowtype;
  raw_token text;
  invitation ats_private.user_invitations%rowtype;
begin
  account := ats_private.session_account(p_session_token);
  if account->>'accountType' <> 'admin' then
    raise exception using errcode='42501', message='Only an admin can create an admin handover.';
  end if;
  select * into admin_row from public.admins
    where "AdminID"=(account->>'id')::integer and "Status"='Active' and "RoleID" in (1,2)
    for update;
  if not found or not ats_private.password_matches(p_current_password,admin_row."PasswordHash") then
    raise exception using errcode='28000', message='The current admin password is incorrect.';
  end if;
  if length(coalesce(btrim(p_full_name),''))>200 then raise exception using errcode='22023',message='Full name must be at most 200 characters.';end if;
  if nullif(btrim(p_username),'') is not null and btrim(p_username)!~'^[A-Za-z0-9_]{3,20}$' then raise exception using errcode='22023',message='Username must contain 3–20 letters, numbers or underscores.';end if;
  if nullif(btrim(p_email),'') is not null and (length(p_email)>254 or btrim(p_email)!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception using errcode='22023',message='Enter a valid recipient email.';end if;
  perform ats_private.profile_data(p_profile_picture);
  perform pg_advisory_xact_lock(1096045397,1);
  raw_token := encode(extensions.gen_random_bytes(32),'hex');
  insert into ats_private.user_invitations(admin_id,token_hash,full_name,username,email,photo,invite_type,expected_admin_hash)
  values(admin_row."AdminID",ats_private.token_digest(raw_token),nullif(btrim(p_full_name),''),nullif(btrim(p_username),''),nullif(lower(btrim(p_email)),''),p_profile_picture,'admin_handover',admin_row."PasswordHash")
  returning * into invitation;
  return jsonb_build_object('id',invitation.id,'token',raw_token,'AdminID',admin_row."AdminID",'expiresAt',invitation.expires_at,'serverNow',clock_timestamp(),'inviteType','admin_handover');
end
$function$;

create or replace function public.ats_invite_context(p_token text) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare invitation ats_private.user_invitations%rowtype; company_name text;
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This invitation is unavailable or expired.';end if;
  select i.* into invitation from ats_private.user_invitations i join public.admins a on a."AdminID"=i.admin_id
  where i.token_hash=ats_private.token_digest(p_token) and i.expires_at>clock_timestamp() and i.consumed_at is null and i.revoked_at is null and a."Status"='Active' and a."RoleID" in(1,2)
    and (i.invite_type='user' or a."PasswordHash"=i.expected_admin_hash);
  if not found then raise exception using errcode='28000',message='This invitation is unavailable or expired.';end if;
  select details->>'name' into company_name from ats_private.company_branding where admin_id=invitation.admin_id;
  return jsonb_build_object('AdminID',invitation.admin_id,'company',coalesce(company_name,'Company'),'fullName',invitation.full_name,'username',invitation.username,'email',invitation.email,'photo',ats_private.profile_data(invitation.photo),'expiresAt',invitation.expires_at,'serverNow',clock_timestamp(),'inviteType',invitation.invite_type);
end
$function$;

create or replace function public.ats_invite_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare owner_id integer; result jsonb;
begin
  owner_id:=ats_private.require_admin(p_session_token);
  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc),'[]') into result from (
    select id,full_name,username,email,invite_type,created_at,expires_at,
      case when consumed_at is not null then 'Used' when revoked_at is not null then 'Revoked' when expires_at<=clock_timestamp() then 'Expired' else 'Pending' end status
    from ats_private.user_invitations where admin_id=owner_id order by created_at desc limit 100
  ) i;
  return result;
end
$function$;

create or replace function public.ats_invite_accept(
  p_token text,p_full_name text,p_username text,p_email text,p_password text,p_profile_picture bytea default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  invitation ats_private.user_invitations%rowtype;
  owner_admin public.admins%rowtype;
  created_user public.users%rowtype;
  picture bytea;
  new_session_token text;
  account jsonb;
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This invitation is unavailable or expired.';end if;
  select * into invitation from ats_private.user_invitations where token_hash=ats_private.token_digest(p_token) for update;
  if not found or invitation.expires_at<=clock_timestamp() or invitation.consumed_at is not null or invitation.revoked_at is not null then raise exception using errcode='28000',message='This invitation is unavailable or expired.';end if;
  select * into owner_admin from public.admins where "AdminID"=invitation.admin_id and "Status"='Active' and "RoleID" in(1,2) for update;
  if not found or (invitation.invite_type='admin_handover' and owner_admin."PasswordHash" is distinct from invitation.expected_admin_hash) then raise exception using errcode='28000',message='This invitation is unavailable or expired.';end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 2 and 200 then raise exception using errcode='22023',message='Enter a full name between 2 and 200 characters.';end if;
  if p_username is null or btrim(p_username)!~'^[A-Za-z0-9_]{3,20}$' then raise exception using errcode='22023',message='Username must contain 3–20 letters, numbers or underscores.';end if;
  if p_email is null or length(btrim(p_email))>254 or btrim(p_email)!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception using errcode='22023',message='Enter a valid email address.';end if;
  if invitation.email is not null and lower(btrim(p_email))<>invitation.email then raise exception using errcode='22023',message='Use the recipient email specified by your administrator.';end if;
  if p_password is null or length(p_password)<8 or octet_length(p_password)>72 or p_password!~'[A-Za-z]' or p_password!~'[0-9]' then raise exception using errcode='22023',message='Use a password with letters and numbers, at least 8 characters and at most 72 UTF-8 bytes.';end if;
  picture:=coalesce(p_profile_picture,invitation.photo);perform ats_private.profile_data(picture);
  perform pg_advisory_xact_lock(1096045397,1);
  if exists(select 1 from public.users where lower(btrim("Username"))=lower(btrim(p_username))) or exists(select 1 from public.admins where lower(btrim("Username"))=lower(btrim(p_username)) and "AdminID"<>invitation.admin_id) then raise exception using errcode='23505',message='That username is already taken.';end if;
  if exists(select 1 from public.users where lower(btrim("Email"))=lower(btrim(p_email))) or exists(select 1 from public.admins where lower(btrim("Email"))=lower(btrim(p_email)) and "AdminID"<>invitation.admin_id) then raise exception using errcode='23505',message='That email is already registered.';end if;
  if invitation.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='This invitation is unavailable or expired.';end if;
  if invitation.invite_type='admin_handover' then
    perform set_config('ats.activity.actor',jsonb_build_object('type','system','name','Admin handover','AdminID',invitation.admin_id)::text,true);
    update public.admins set "FullName"=btrim(p_full_name),"Username"=btrim(p_username),"Email"=lower(btrim(p_email)),"PasswordHash"=extensions.crypt(p_password,extensions.gen_salt('bf',10)),"ProfilePicture"=picture,"LastLogin"=null,"UpdatedAt"=clock_timestamp()
      where "AdminID"=invitation.admin_id;
    delete from ats_private.login_sessions where account_type='admin' and account_id=invitation.admin_id;
    new_session_token:=ats_private.new_token();
    insert into ats_private.login_sessions(token_hash,account_type,account_id,expires_at)
      values(ats_private.token_digest(new_session_token),'admin',invitation.admin_id,clock_timestamp()+interval '8 hours');
    account:=ats_private.account_details('admin',invitation.admin_id);
    update ats_private.user_invitations set consumed_at=clock_timestamp(),photo=null,expected_admin_hash=null where id=invitation.id and expires_at>clock_timestamp() and consumed_at is null and revoked_at is null;
    if not found then raise exception using errcode='28000',message='This invitation expired before registration completed.';end if;
    return account||jsonb_build_object('saved',true,'AdminID',invitation.admin_id,'accountType','admin','sessionToken',new_session_token,'handover',true);
  end if;
  if invitation.invite_type<>'user' then raise exception using errcode='22023',message='Unsupported invitation type.';end if;
  perform set_config('ats.activity.actor',jsonb_build_object('type','system','name','Invitation registration','AdminID',invitation.admin_id)::text,true);
  insert into public.users("FullName","Username","Email","PasswordHash","ProfilePicture","Role","Status","AdminID")
  values(btrim(p_full_name),btrim(p_username),lower(btrim(p_email)),extensions.crypt(p_password,extensions.gen_salt('bf',10)),picture,'USER','Active',invitation.admin_id) returning * into created_user;
  update ats_private.user_invitations set consumed_at=clock_timestamp(),user_id=created_user."UserID",photo=null where id=invitation.id and expires_at>clock_timestamp() and consumed_at is null and revoked_at is null;
  if not found then raise exception using errcode='28000',message='This invitation expired before registration completed.';end if;
  return jsonb_build_object('saved',true,'UserID',created_user."UserID",'AdminID',created_user."AdminID",'handover',false);
end
$function$;

revoke all on function public.ats_admin_handover_create(text,text,text,text,text,bytea),public.ats_invite_context(text),public.ats_invite_accept(text,text,text,text,text,bytea) from public;
grant execute on function public.ats_admin_handover_create(text,text,text,text,text,bytea),public.ats_invite_context(text),public.ats_invite_accept(text,text,text,text,text,bytea) to anon,authenticated;
notify pgrst,'reload schema';

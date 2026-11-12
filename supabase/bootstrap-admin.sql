-- Run manually in the trusted Supabase SQL Editor AFTER creating your admin
-- account in Authentication > Users. Never expose this as a client RPC.
-- Replace the UUID with that account's Auth user ID.
insert into devicecare_private.admins (user_id)
values ('REPLACE_WITH_AUTH_USER_UUID'::uuid)
on conflict do nothing;

-- Remove admin access using the trusted SQL Editor when needed:
-- delete from devicecare_private.admins where user_id = 'AUTH_USER_UUID'::uuid;

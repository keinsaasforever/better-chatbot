-- A personal workspace that has been shared with other people is a team
-- workspace, and its billing has to follow.
--
-- Nothing stopped an owner renaming their auto-created personal workspace and
-- inviting colleagues into it: the invite guards deliberately skip personal
-- orgs (so a solo user can always be invited elsewhere), and no hook cleared
-- the flag on the way in. The stale `personal: true` then told billing to
-- charge every member to their own user id, so each burned their personal free
-- credits while the credits their admin had paid for sat unreachable on the
-- admin's own customer.
--
-- Clear the flag wherever a "personal" workspace has more than one member.
-- Deliberately leaves `userId` in place: it records who created the workspace
-- and nothing reads it for billing.
--
-- Data only, no DDL — `metadata` is a text column holding JSON.
--
-- The match is textual on purpose. `metadata` is unvalidated text, so a
-- `::jsonb` cast in the WHERE clause could be evaluated against a row holding
-- something that is not JSON and abort the whole migration; Postgres gives no
-- ordering guarantee between AND'ed conditions. Matching the literal that
-- `JSON.stringify` writes keeps the cast in SET, which only runs for rows that
-- already passed.
UPDATE organization AS o
SET metadata = (o.metadata::jsonb - 'personal')::text
WHERE o.metadata LIKE '{%"personal":%true%'
  AND (
    SELECT count(*) FROM member AS m WHERE m.organization_id = o.id
  ) > 1;

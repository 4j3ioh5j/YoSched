-- Drop the unused Staff.email column.
--
-- Added in 20260609170000_add_provider_email (as providers.email, renamed to
-- staff.email by 20260609180000_rename_provider_to_staff). It was never read by
-- anything: self-service confirmation mail goes to User.email, not Staff.email.
-- Decision: keep one email per person on the login (User), so this dead field is
-- removed along with its modal input and the now-unused normalizeOptionalEmail
-- helper. Verified 0 non-null values on staging before dropping (no data loss).

ALTER TABLE "staff" DROP COLUMN "email";

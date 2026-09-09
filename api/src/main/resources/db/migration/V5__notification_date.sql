-- V5 — Phase 2b: notifications carry the business date they were issued for
-- (the simulated/scheduled date), separate from the send timestamp. The
-- reminder dedup keys on this date.
ALTER TABLE notification_log ADD COLUMN notification_date date;

-- Adds the `record_details` boolean field to the `api_keys` table.
-- When FALSE, requests authenticated with the key do not store the detail
-- payload (request/response bodies and headers); main-table metadata
-- (tokens, cost, timing, status, model, etc.) is always recorded.
ALTER TABLE api_keys ADD COLUMN record_details BOOLEAN DEFAULT TRUE;

ALTER TABLE entities ADD COLUMN canonical_id TEXT REFERENCES entities(id);

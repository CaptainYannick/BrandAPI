CREATE TABLE store_counts (
  kind  TEXT NOT NULL,           -- 'slug' of 'custom'
  name  TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, name)
);

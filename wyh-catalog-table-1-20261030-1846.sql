CREATE TABLE IF NOT EXISTS wyh_catalog_metadata (
 product_id TEXT PRIMARY KEY REFERENCES products(id),
 category TEXT NOT NULL CHECK(category IN ('travel','wallet','shoes','jacket')),
 image_file TEXT NOT NULL DEFAULT '',
 colors_json TEXT NOT NULL DEFAULT '[]',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

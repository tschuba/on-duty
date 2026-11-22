-- Feste Kassen-Tags (meaning). Die Rechte cash:* an Standardrollen vergibt der Seed (APP_ROLES, nicht in derselben Transaktion wie ALTER TYPE ADD VALUE).
INSERT INTO "cash_tags" ("name", "direction", "meaning") VALUES
  ('Anfangsbestand', 'income', 'opening'),
  ('Kaution', 'both', 'deposit'),
  ('Spende', 'income', 'donation'),
  ('Verleih', 'income', 'lending')
ON CONFLICT DO NOTHING;

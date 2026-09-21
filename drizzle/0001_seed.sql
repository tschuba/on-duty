INSERT INTO member_roles (id, title, grants_active_status) VALUES
  ('erster-vorstand',           '1. Vorstand',                 false),
  ('zweiter-vorstand',          '2. Vorstand',                 false),
  ('schriftfuehrer',            'Schriftführer',               false),
  ('kassier',                   'Kassier',                     false),
  ('beisitzer',                 'Beisitzer',                   false),
  ('erster-kommandant',         '1. Kommandant',               true),
  ('zweiter-kommandant',        '2. Kommandant',               true),
  ('gruppenfuehrer',            'Gruppenführer',               true),
  ('maschinist',                'Maschinist',                  true),
  ('jugendfeuerwehrwart',       'Jugendfeuerwehrwart',         false),
  ('stellv-jugendfeuerwehrwart','Stellv. Jugendfeuerwehrwart', false),
  ('aktives-mitglied',          'Aktives Mitglied',            true),
  ('passives-mitglied',         'Passives Mitglied',           false),
  ('ehrenkommandant',           'Ehrenkommandant',             false),
  ('ehrenvorstand',             'Ehrenvorstand',               false),
  ('ehrenmitglied',             'Ehrenmitglied',               false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO anniversary_years (year) VALUES
  (25), (40), (50), (60), (65), (70), (75), (80), (85), (90), (95), (100)
ON CONFLICT (year) DO NOTHING;

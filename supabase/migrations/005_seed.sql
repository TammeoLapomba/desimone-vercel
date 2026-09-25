-- Collezioni De Simone
INSERT INTO collections (name, slug, channel, sort_order) VALUES
  ('Intreccio',         'intreccio',         'both', 1),
  ('Abbraccio',         'abbraccio',         'both', 2),
  ('Trame di Corallo',  'trame-di-corallo',  'both', 3),
  ('Cielo Stellato',    'cielo-stellato',    'both', 4);

-- Materiali — Corallo
INSERT INTO materials (name, code, type) VALUES
  ('Corallo Rosso del Mediterraneo', 'CR',  'coral'),
  ('Corallo Rosso Sciacca',          'CS',  'coral'),
  ('Corallo Rosa',                   'RP',  'coral'),
  ('Corallo Bianco',                 'RB',  'coral');

-- Materiali — Metallo
INSERT INTO materials (name, code, type) VALUES
  ('Oro Giallo 18k',     'AU',  'metal'),
  ('Argento 925',        'AG',  'metal'),
  ('Oro Bianco 18k',     'AUB', 'metal'),
  ('Oro Rosa 18k',       'AUR', 'metal');

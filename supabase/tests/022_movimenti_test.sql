-- ============================================================
-- 022_movimenti_test.sql — Prove delle migrazioni 022 e 023, una per requisito della BBA (v1.7) e della WBA (v0.5).
-- Si esegue dopo tutte le migrazioni con supabase/tests/run.sh. Le richieste partono come le manderebbe PostgREST:
-- ruolo "authenticated" e utente nel token (request.jwt.claims). Ogni riga stampa "ok" oppure si ferma.
-- ============================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

-- ------------------------------------------------------------
-- Strumenti di prova
-- ------------------------------------------------------------
CREATE SCHEMA prova;
GRANT USAGE ON SCHEMA prova TO anon, authenticated;

CREATE FUNCTION prova.ok(p_cond boolean, p_label text) RETURNS text AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FALLITO: %', p_label;
  END IF;
  RETURN 'ok   ' || p_label;
END $$ LANGUAGE plpgsql;

-- L'istruzione deve fallire con un messaggio che contiene p_expected; i suoi effetti si annullano
CREATE FUNCTION prova.fails(p_stmt text, p_expected text, p_label text) RETURNS text AS $$
BEGIN
  EXECUTE p_stmt;
  RAISE EXCEPTION 'FALLITO: % (nessun errore)', p_label;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FALLITO:%' THEN
    RAISE;
  END IF;
  IF position(lower(p_expected) IN lower(SQLERRM)) = 0 THEN
    RAISE EXCEPTION 'FALLITO: % (errore diverso: %)', p_label, SQLERRM;
  END IF;
  RETURN 'ok   ' || p_label || ' → ' || SQLERRM;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION prova.come(p_operator uuid) RETURNS void AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_operator, 'role', 'authenticated')::text, false);
$$ LANGUAGE sql;

-- register_movement con nomi al posto degli id
CREATE FUNCTION prova.mov(p_code text, p_type movement_type, p_reason text, p_device text,
                          p_article text DEFAULT NULL, p_raw text DEFAULT NULL,
                          p_from text DEFAULT NULL, p_to text DEFAULT NULL,
                          p_pieces integer DEFAULT NULL, p_grams numeric DEFAULT NULL,
                          p_source weight_source DEFAULT NULL, p_scale text DEFAULT NULL,
                          p_last boolean DEFAULT false, p_shown jsonb DEFAULT NULL,
                          p_when timestamptz DEFAULT now()) RETURNS jsonb AS $$
  SELECT register_movement(
    p_code             => p_code,
    p_movement_type    => p_type,
    p_reason_id        => (SELECT id FROM movement_reasons WHERE code = p_reason),
    p_device_id        => (SELECT id FROM devices WHERE code = p_device),
    p_occurred_at      => p_when,
    p_article_id       => (SELECT id FROM articles WHERE sku = p_article),
    p_raw_item_id      => (SELECT id FROM raw_items WHERE sku = p_raw),
    p_from_location_id => (SELECT id FROM locations WHERE name = p_from),
    p_to_location_id   => (SELECT id FROM locations WHERE name = p_to),
    p_pieces           => p_pieces,
    p_grams            => p_grams,
    p_weight_source    => p_source,
    p_scale_id         => (SELECT id FROM scales WHERE name = p_scale),
    p_last             => p_last,
    p_shown_stock      => p_shown)
$$ LANGUAGE sql;

CREATE FUNCTION prova.pz(p_article text, p_raw text, p_location text) RETURNS integer AS $$
  SELECT s.pieces FROM item_stock((SELECT id FROM articles WHERE sku = p_article),
                                  (SELECT id FROM raw_items WHERE sku = p_raw),
                                  (SELECT id FROM locations WHERE name = p_location)) s
$$ LANGUAGE sql;

CREATE FUNCTION prova.g(p_article text, p_raw text, p_location text) RETURNS numeric AS $$
  SELECT s.grams FROM item_stock((SELECT id FROM articles WHERE sku = p_article),
                                 (SELECT id FROM raw_items WHERE sku = p_raw),
                                 (SELECT id FROM locations WHERE name = p_location)) s
$$ LANGUAGE sql;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA prova TO anon, authenticated;

-- ------------------------------------------------------------
-- Dati di prova (come amministratore del database)
-- ------------------------------------------------------------
SELECT prova.ok((SELECT count(*) FROM operators) = 2
            AND (SELECT role FROM operators WHERE id = '00000000-0000-0000-0000-0000000000a1') = 'admin'
            AND (SELECT role FROM operators WHERE id = '00000000-0000-0000-0000-0000000000a2') = 'laboratorio',
                'gli utenti con un ruolo diventano operatori: admin resta admin, staff diventa laboratorio');

INSERT INTO operators (id, name, role, active) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Negozio di prova', 'negozio', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Fiere di prova',   'fiere',   true),
  ('00000000-0000-0000-0000-0000000000b3', 'Ex operatore',     'negozio', false);
INSERT INTO devices (code, name) VALUES ('PC1', 'PC server'), ('TAB1', 'Tablet con bilancia'), ('TAB2', 'Tablet da revocare');
INSERT INTO scales (name, model, device_id) SELECT 'Bilancia TAB1', 'Mettler Toledo SB16001', id FROM devices WHERE code = 'TAB1';
INSERT INTO locations (name, kind) VALUES ('Fiera di prova', 'fiera');
INSERT INTO collections (name, slug) VALUES ('Prova', 'prova');
INSERT INTO articles (collection_id, name, product_type_id, sku)
SELECT (SELECT id FROM collections WHERE slug = 'prova'), 'Anello di prova', (SELECT id FROM product_types ORDER BY sort_order LIMIT 1), 'PROVA-0001';

-- Tre semilavorati qualsiasi, uno per unità di misura
SELECT sku AS r1 FROM raw_items ORDER BY sku LIMIT 1 OFFSET 0 \gset
SELECT sku AS r2 FROM raw_items ORDER BY sku LIMIT 1 OFFSET 1 \gset
SELECT sku AS r3 FROM raw_items ORDER BY sku LIMIT 1 OFFSET 2 \gset
UPDATE raw_items SET unit = 'grammi' WHERE sku = :'r2';
UPDATE raw_items SET unit = 'pezzi'  WHERE sku = :'r3';

\set admin   '''00000000-0000-0000-0000-0000000000a1'''
\set lab     '''00000000-0000-0000-0000-0000000000a2'''
\set ospite  '''00000000-0000-0000-0000-0000000000a3'''
\set negozio '''00000000-0000-0000-0000-0000000000b1'''
\set fiere   '''00000000-0000-0000-0000-0000000000b2'''
\set ex      '''00000000-0000-0000-0000-0000000000b3'''

-- ------------------------------------------------------------
-- Senza accesso: nessun dato (REQ-002, P-03)
-- ------------------------------------------------------------
SET ROLE anon;
SELECT set_config('request.jwt.claims', '', false);
SELECT prova.fails('SELECT count(*) FROM movements', 'permission denied', 'senza accesso non si leggono i movimenti');
SELECT prova.fails('SELECT count(*) FROM stock_levels', 'permission denied', 'senza accesso non si leggono le giacenze');
SELECT prova.fails($$SELECT register_movement('X', 'C', NULL, NULL, now())$$, 'permission denied', 'senza accesso non si registra');
RESET ROLE;

SET ROLE authenticated;
SELECT prova.come(:ospite);
SELECT prova.ok((SELECT count(*) FROM locations) = 0, 'utente senza ruolo: non vede i luoghi');
SELECT prova.fails($$SELECT prova.mov('O-1', 'C', 'nuova_produzione', 'PC1', 'PROVA-0001', p_to => 'Laboratorio', p_pieces => 1)$$,
                   'Operatore non riconosciuto', 'utente senza ruolo: non registra');
SELECT prova.come(:ex);
SELECT prova.fails($$SELECT prova.mov('X-1', 'C', 'nuova_produzione', 'PC1', 'PROVA-0001', p_to => 'Laboratorio', p_pieces => 1)$$,
                   'Operatore non riconosciuto', 'operatore disattivato: non registra');

-- ------------------------------------------------------------
-- Carico, ripetizione, permessi (REQ-M-02, E-11, D-02, P-03, 001.1…001.4)
-- ------------------------------------------------------------
SELECT prova.come(:lab);
SELECT prova.fails($$SELECT prova.mov('L-0', 'C', 'nuova_produzione', 'PC1', 'PROVA-0001', p_to => 'Laboratorio', p_pieces => 5)$$,
                   'serve il peso', 'al primo carico di un gioiello serve il peso (REQ-U-14, migrazione 023)');
SELECT prova.ok((prova.mov('L-1', 'C', 'nuova_produzione', 'PC1', 'PROVA-0001', p_to => 'Laboratorio', p_pieces => 5,
                           p_grams => 24.5, p_source => 'calcolo', p_shown => '{"prima": 0, "dopo": 5}') -> 'to_stock' ->> 'pieces')::int = 5,
                'laboratorio carica 5 anelli in Laboratorio, con il peso calcolato dal peso di un pezzo (REQ-U-19, U-21)');
SELECT prova.ok((prova.mov('L-1', 'C', 'nuova_produzione', 'PC1', 'PROVA-0001', p_to => 'Laboratorio', p_pieces => 5) ->> 'duplicate')::boolean
                AND prova.pz('PROVA-0001', NULL, 'Laboratorio') = 5,
                'la stessa richiesta ripetuta si registra una volta sola');
SELECT prova.ok((SELECT operator_id = :lab AND device_id = (SELECT id FROM devices WHERE code = 'PC1')
                        AND shown_stock = '{"prima": 0, "dopo": 5}' AND recorded_at IS NOT NULL
                 FROM movements WHERE code = 'L-1'),
                'il movimento porta autore, dispositivo, momento e giacenza mostrata (REQ-001.3, M-19, M-21)');

SELECT prova.come(:negozio);
SELECT prova.fails($$SELECT prova.mov('N-0', 'C', 'nuova_produzione', 'PC1', 'PROVA-0001', p_to => 'Negozio', p_pieces => 1)$$,
                   'non può registrare', 'il negozio non carica produzione');
SELECT prova.fails($$SELECT prova.mov('N-00', 'S', 'nuova_produzione', 'PC1', 'PROVA-0001', p_from => 'Negozio', p_pieces => 1)$$,
                   'non è del tipo', 'la causale deve essere del tipo di movimento (REQ-M-15)');

-- ------------------------------------------------------------
-- Trasferimento, vendita, annullamento della vendita (REQ-M-03, B-01, P-04, P-05, B-07, F-03)
-- ------------------------------------------------------------
SELECT prova.ok((SELECT (r -> 'from_stock' ->> 'pieces')::int = 3 AND (r -> 'to_stock' ->> 'pieces')::int = 2
                 FROM prova.mov('N-1', 'T', 'trasferimento', 'PC1', 'PROVA-0001', p_from => 'Laboratorio', p_to => 'Negozio', p_pieces => 2) r),
                'trasferimento di 2 pezzi: un solo movimento, due giacenze aggiornate');
SELECT prova.fails($$SELECT prova.mov('N-2', 'S', 'vendita_banco', 'PC1', 'PROVA-0001', p_from => 'Negozio', p_pieces => 3)$$,
                   'oltre la giacenza', 'non si vende più di quanto c''è nel luogo');
SELECT prova.ok((prova.mov('N-3', 'S', 'vendita_banco', 'PC1', 'PROVA-0001', p_from => 'Negozio', p_pieces => 2) -> 'from_stock' ->> 'pieces')::int = 0,
                'vendita al banco di 2 pezzi');
SELECT prova.fails($$SELECT prova.mov('N-4', 'C', 'annullamento_vendita', 'PC1', 'PROVA-0001', p_to => 'Negozio', p_pieces => 3)$$,
                   'oltre il venduto', 'non si riaggiunge più del venduto');
SELECT prova.ok((prova.mov('N-5', 'C', 'annullamento_vendita', 'PC1', 'PROVA-0001', p_to => 'Negozio', p_pieces => 1) -> 'to_stock' ->> 'pieces')::int = 1,
                'si riaggiunge un pezzo venduto');
SELECT prova.fails($$SELECT prova.mov('N-6', 'C', 'annullamento_vendita', 'PC1', 'PROVA-0001', p_to => 'Negozio', p_pieces => 2)$$,
                   'oltre il venduto', 'il venduto tiene conto delle riaggiunte già fatte');
SELECT prova.fails($$SELECT prova.mov('N-7', 'S', 'rottura', 'PC1', 'PROVA-0001', p_from => 'Negozio', p_pieces => 1)$$,
                   'non può registrare', 'le perdite le scarica solo l''amministrazione (REQ-M-04)');

SELECT prova.come(:fiere);
SELECT prova.fails($$SELECT prova.mov('F-1', 'S', 'vendita_fiera', 'PC1', 'PROVA-0001', p_from => 'Negozio', p_pieces => 1)$$,
                   'da una fiera', 'la vendita in fiera si scarica da una fiera');

-- ------------------------------------------------------------
-- Semilavorato a pezzi e grammi: peso, bilance, differenza di pesatura
-- (REQ-U-04, U-05, U-09, U-10, U-11, U-12, U-25, U-26, I-09, I-11)
-- ------------------------------------------------------------
SELECT prova.come(:lab);
SELECT prova.fails(format($$SELECT prova.mov('L-09', 'C', 'nuova_produzione', 'PC1', p_raw => %L, p_to => 'Laboratorio', p_pieces => 10)$$, :'r1'),
                   'pezzi e peso', 'a pezzi e grammi anche il carico vuole il peso (REQ-U-04, migrazione 023)');
SELECT prova.ok((prova.mov('L-10', 'C', 'nuova_produzione', 'PC1', p_raw => :'r1', p_to => 'Laboratorio', p_pieces => 10,
                           p_grams => 50.0, p_source => 'bilancia', p_scale => 'SB16001 del PC server') -> 'to_stock' ->> 'grams')::numeric = 50.0,
                'carico di 10 pezzi e 50,0 g letti dalla bilancia della sede');
SELECT prova.fails(format($$SELECT prova.mov('L-11', 'T', 'trasferimento', 'PC1', p_raw => %L, p_from => 'Laboratorio', p_to => 'Negozio', p_pieces => 4, p_grams => 20.0, p_source => 'calcolo')$$, :'r1'),
                   'peso misurato', 'a pezzi e grammi ogni uscita vuole il peso misurato, non calcolato (REQ-U-10)');
SELECT prova.fails(format($$SELECT prova.mov('L-12', 'T', 'trasferimento', 'PC1', p_raw => %L, p_from => 'Laboratorio', p_to => 'Negozio', p_pieces => 4, p_grams => 20.05, p_source => 'mano')$$, :'r1'),
                   'più di un decimale', 'il peso si registra al decimo di grammo');
SELECT prova.fails(format($$SELECT prova.mov('L-13', 'T', 'trasferimento', 'PC1', p_raw => %L, p_from => 'Laboratorio', p_to => 'Negozio', p_pieces => 4, p_grams => 20.0)$$, :'r1'),
                   'da dove viene', 'ogni peso dice da dove viene (REQ-U-25)');
SELECT prova.ok((prova.mov('L-14', 'T', 'trasferimento', 'PC1', p_raw => :'r1', p_from => 'Laboratorio', p_to => 'Negozio', p_pieces => 4,
                           p_grams => 20.0, p_source => 'bilancia', p_scale => 'SB16001 del PC server') -> 'to_stock' ->> 'grams')::numeric = 20.0,
                'trasferimento di 4 pezzi e 20,0 g');

SELECT prova.fails(format($$SELECT prova.mov('T-1', 'C', 'nuova_produzione', 'TAB1', p_raw => %L, p_to => 'Laboratorio', p_pieces => 1, p_grams => 5.0, p_source => 'bilancia', p_scale => 'SB16001 del PC server')$$, :'r1'),
                   'sua bilancia', 'un tablet con la sua bilancia non usa quella della sede (REQ-I-11)');
-- Una sottoquery nella stessa istruzione non vede ciò che la funzione ha appena scritto: il controllo va a parte
SELECT prova.ok((prova.mov('T-2', 'C', 'nuova_produzione', 'TAB1', p_raw => :'r1', p_to => 'Laboratorio', p_pieces => 1,
                           p_grams => 5.0, p_source => 'bilancia', p_scale => 'Bilancia TAB1') ->> 'duplicate')::boolean = false,
                'il tablet pesa con la sua bilancia (REQ-I-09)');
SELECT prova.ok((SELECT s.name FROM movements m JOIN scales s ON s.id = m.scale_id WHERE m.code = 'T-2') = 'Bilancia TAB1',
                'il movimento registra la bilancia da cui viene il peso (REQ-U-26)');
SELECT prova.fails(format($$SELECT prova.mov('P-1', 'C', 'nuova_produzione', 'PC1', p_raw => %L, p_to => 'Laboratorio', p_pieces => 1, p_grams => 5.0, p_source => 'bilancia', p_scale => 'Bilancia TAB1')$$, :'r1'),
                   'altro dispositivo', 'il PC non usa la bilancia collegata a un tablet');

SELECT prova.come(:negozio);
SELECT prova.ok((SELECT (r ->> 'weighing_difference')::numeric = -0.5
                        AND (r -> 'from_stock' ->> 'pieces')::int = 0 AND (r -> 'from_stock' ->> 'grams')::numeric = 0
                 FROM prova.mov('N-10', 'S', 'vendita_banco', 'PC1', p_raw => :'r1', p_from => 'Negozio', p_pieces => 4,
                                p_grams => 20.5, p_source => 'mano') r),
                'ultimi 4 pezzi venduti a 20,5 g su 20,0 registrati: accettato, differenza di pesatura di 0,5 g e giacenza a zero');
SELECT prova.ok((SELECT movement_type = 'C' AND grams = 0.5 AND parent_id = (SELECT id FROM movements WHERE code = 'N-10')
                 FROM movements WHERE code = 'N-10-D'),
                'la differenza di pesatura è un movimento collegato a quello che l''ha generata');

-- ------------------------------------------------------------
-- Semilavorato solo a grammi: ultimo scarico (REQ-U-02, U-13, U-23, M-04)
-- ------------------------------------------------------------
SELECT prova.come(:lab);
SELECT prova.fails(format($$SELECT prova.mov('L-20', 'C', 'nuova_produzione', 'PC1', p_raw => %L, p_to => 'Laboratorio', p_pieces => 3)$$, :'r2'),
                   'solo a grammi', 'un semilavorato a grammi non si muove a pezzi');
SELECT prova.ok((prova.mov('L-21', 'C', 'nuova_produzione', 'PC1', p_raw => :'r2', p_to => 'Laboratorio', p_grams => 100.0, p_source => 'mano')
                 -> 'to_stock' ->> 'grams')::numeric = 100.0, 'carico di 100,0 g');
SELECT prova.come(:admin);
SELECT prova.ok((prova.mov('A-20', 'S', 'rottura', 'PC1', p_raw => :'r2', p_from => 'Laboratorio', p_grams => 30.0, p_source => 'mano')
                 -> 'from_stock' ->> 'grams')::numeric = 70.0, 'l''amministrazione scarica 30,0 g per rottura');
SELECT prova.fails(format($$SELECT prova.mov('A-21', 'S', 'rottura', 'PC1', p_raw => %L, p_from => 'Laboratorio', p_grams => 80.0, p_source => 'mano')$$, :'r2'),
                   'oltre la giacenza', 'a grammi non si scarica oltre il peso registrato');
SELECT prova.ok((SELECT (r ->> 'weighing_difference')::numeric = -10.0 AND (r -> 'from_stock' ->> 'grams')::numeric = 0
                 FROM prova.mov('A-22', 'S', 'rottura', 'PC1', p_raw => :'r2', p_from => 'Laboratorio', p_grams => 80.0,
                                p_source => 'mano', p_last => true) r),
                'segnato come ultimo, lo scarico oltre il peso passa e la differenza azzera la giacenza (REQ-U-13)');

-- ------------------------------------------------------------
-- Dispositivi revocati (REQ-S-01…S-03) e permessi sulle anagrafiche
-- ------------------------------------------------------------
SELECT prova.come(:negozio);
WITH u AS (UPDATE devices SET revoked_at = now() WHERE code = 'TAB2' RETURNING 1)
SELECT prova.ok((SELECT count(*) FROM u) = 0, 'il negozio non può revocare un dispositivo');
SELECT prova.fails($$INSERT INTO locations (name) VALUES ('Magazzino abusivo')$$, 'row-level security', 'il negozio non crea luoghi (REQ-M-07)');
SELECT prova.come(:admin);
WITH u AS (UPDATE devices SET revoked_at = now() WHERE code = 'TAB2' RETURNING 1)
SELECT prova.ok((SELECT count(*) FROM u) = 1, 'l''amministrazione revoca TAB2');
SELECT prova.fails($$SELECT prova.mov('R-1', 'C', 'nuova_produzione', 'TAB2', 'PROVA-0001', p_to => 'Laboratorio', p_pieces => 1)$$,
                   'revocato', 'un dispositivo revocato non registra');
SELECT prova.fails($$INSERT INTO movements (code, movement_type, article_id, to_location_id, pieces, reason_id, operator_id, device_id, occurred_at)
                     SELECT 'Z-1', 'C', (SELECT id FROM articles WHERE sku = 'PROVA-0001'), (SELECT id FROM locations WHERE name = 'Laboratorio'), 1,
                            (SELECT id FROM movement_reasons WHERE code = 'nuova_produzione'), current_operator_id(), (SELECT id FROM devices WHERE code = 'PC1'), now()$$,
                   'row-level security', 'il registro non si scrive direttamente, neanche dall''amministrazione');

-- ------------------------------------------------------------
-- Annullamento (REQ-M-06, M-13, M-14, F-09)
-- ------------------------------------------------------------
SELECT prova.come(:negozio);
SELECT prova.fails($$SELECT cancel_movement((SELECT id FROM movements WHERE code = 'N-5'), 'errore')$$,
                   'Solo l''amministrazione', 'solo l''amministrazione annulla');
SELECT prova.come(:admin);
SELECT prova.fails($$SELECT cancel_movement((SELECT id FROM movements WHERE code = 'N-1'), 'prova')$$,
                   'sotto zero', 'annullare il trasferimento porterebbe il Negozio sotto zero: rifiutato');
SELECT prova.fails($$SELECT cancel_movement((SELECT id FROM movements WHERE code = 'N-5'), '  ')$$,
                   'motivo', 'serve il motivo');
SELECT prova.ok((cancel_movement((SELECT id FROM movements WHERE code = 'N-5'), 'riaggiunto per errore') ->> 'cancelled') IS NOT NULL
                AND prova.pz('PROVA-0001', NULL, 'Negozio') = 0,
                'annullata la riaggiunta: il Negozio torna a 0');
SELECT prova.ok((SELECT cancelled_at IS NOT NULL AND cancel_reason = 'riaggiunto per errore' AND cancelled_by = :admin
                 FROM movements WHERE code = 'N-5'),
                'il movimento annullato resta nello storico, con motivo e autore (REQ-M-13)');
SELECT prova.fails($$SELECT cancel_movement((SELECT id FROM movements WHERE code = 'N-5'), 'di nuovo')$$,
                   'già annullato', 'non si annulla due volte');
SELECT prova.fails($$SELECT cancel_movement((SELECT id FROM movements WHERE code = 'N-10-D'), 'prova')$$,
                   'insieme al movimento', 'la differenza di pesatura non si annulla da sola');
SELECT prova.ok((cancel_movement((SELECT id FROM movements WHERE code = 'N-10'), 'vendita registrata due volte') ->> 'cancelled') IS NOT NULL
                AND prova.pz(NULL, :'r1', 'Negozio') = 4 AND prova.g(NULL, :'r1', 'Negozio') = 20.0,
                'annullata la vendita: il Negozio torna a 4 pezzi e 20,0 g');
SELECT prova.ok((SELECT cancelled_at IS NOT NULL FROM movements WHERE code = 'N-10-D'),
                'con la vendita si annulla anche la sua differenza di pesatura');

-- ------------------------------------------------------------
-- Storico e giacenza (REQ-001.1, M-01, M-22, E-03)
-- ------------------------------------------------------------
SELECT prova.come(:lab);
SELECT prova.ok((prova.mov('L-30', 'C', 'acquisto', 'TAB1', 'PROVA-0001', p_to => 'Laboratorio', p_pieces => 7,
                           p_when => now() - interval '30 days') ->> 'duplicate')::boolean = false,
                'arriva tardi un carico di 30 giorni fa (fatto senza collegamento)');
SELECT prova.ok((SELECT pieces_after FROM movement_history
                 WHERE code = 'L-30' AND location_id = (SELECT id FROM locations WHERE name = 'Laboratorio')) = 7
            AND (SELECT pieces_after FROM movement_history
                 WHERE code = 'L-1' AND location_id = (SELECT id FROM locations WHERE name = 'Laboratorio')) = 12,
                'nello storico la giacenza progressiva segue il momento in cui i movimenti sono avvenuti');
SELECT prova.ok((SELECT pieces FROM stock_levels
                 WHERE article_id = (SELECT id FROM articles WHERE sku = 'PROVA-0001')
                   AND location_id = (SELECT id FROM locations WHERE name = 'Laboratorio')) = prova.pz('PROVA-0001', NULL, 'Laboratorio')
            AND prova.pz('PROVA-0001', NULL, 'Laboratorio') = 10,
                'giacenza in Laboratorio: 5 + 7 − 2 = 10, uguale dalla vista e dalla funzione');
SELECT prova.ok((SELECT count(*) FROM movement_history WHERE code = 'N-5' AND cancelled) = 1,
                'lo storico mostra anche i movimenti annullati');
SELECT prova.ok((my_operator() ->> 'default_location_id')::uuid = (SELECT id FROM locations WHERE name = 'Laboratorio'),
                'il laboratorio si vede proposto il Laboratorio (REQ-B-05)');
RESET ROLE;

-- ------------------------------------------------------------
-- Unità di misura bloccata dopo i primi movimenti (BBA, Step 3)
-- ------------------------------------------------------------
SELECT prova.fails(format($$UPDATE raw_items SET unit = 'pezzi' WHERE sku = %L$$, :'r1'),
                   'non si cambia', 'l''unità di un semilavorato con movimenti non cambia');
WITH u AS (UPDATE raw_items SET unit = 'grammi' WHERE sku = :'r3' RETURNING 1)
SELECT prova.ok((SELECT count(*) FROM u) = 1, 'senza movimenti l''unità si può ancora cambiare');

SELECT 'tutte le prove superate';

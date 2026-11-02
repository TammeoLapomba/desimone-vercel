"""Banco SQLite: stessi dati e stesse operazioni del banco PostgreSQL.
uso: python3 sqlite_bench.py gen <file.db> <N>
     python3 sqlite_bench.py run <file.db> <N>
"""
import hashlib, multiprocessing as mp, os, random, sqlite3, statistics, sys, time, uuid

T = ['Anello', 'Bracciale', 'Collana', 'Orecchini', 'Ciondolo', 'Spilla', 'Girocollo', 'Charm']
M = ['corallo rosso', 'corallo rosa', 'corallo bianco', 'cammeo conchiglia', 'perla', 'turchese', 'onice', 'madreperla']
F = ['sfera', 'botte', 'goccia', 'ramo', 'cuore', 'fiore', 'foglia', 'stella', 'ovale', 'tondo']
ME = ['argento 925', 'oro giallo 18kt', 'oro rosa 18kt', 'oro bianco 18kt', 'argento dorato']
ST = ['attivo', 'attivo', 'attivo', 'bozza', 'venduto', 'archiviato']
NOW = time.time()


def code(g):
    return hashlib.md5(str(g).encode()).hexdigest()[:6].upper()


def sku(g):
    return 'DS%012d' % g


def connect(path):
    c = sqlite3.connect(path, timeout=10, isolation_level=None)
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('PRAGMA synchronous=NORMAL')
    c.execute('PRAGMA cache_size=-262144')  # 256 MB, come shared_buffers di PostgreSQL
    c.execute('PRAGMA busy_timeout=10000')
    c.execute('PRAGMA foreign_keys=ON')
    return c


def gen(path, n):
    if os.path.exists(path):
        os.remove(path)
    c = connect(path)
    c.executescript('''
    CREATE TABLE articles (
      id INTEGER PRIMARY KEY, uuid TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL,
      product_type TEXT NOT NULL, collection_id INT NOT NULL, coral TEXT, metal TEXT,
      price_retail REAL, price_wholesale REAL, stock_retail INT NOT NULL DEFAULT 0,
      stock_wholesale INT NOT NULL DEFAULT 0, status TEXT NOT NULL, description_it TEXT, tags TEXT,
      created_at REAL NOT NULL, updated_at REAL NOT NULL, deleted_at REAL);
    CREATE TABLE stock_movements (
      id INTEGER PRIMARY KEY, article_id INT NOT NULL REFERENCES articles(id),
      channel TEXT NOT NULL, delta INT NOT NULL, reason TEXT, created_at REAL NOT NULL);
    ''')
    rnd = random.Random(42)
    t0 = time.time()
    c.execute('BEGIN')
    batch, mov = [], []
    for g in range(1, n + 1):
        t, m, f, me = T[g % 8], M[(g // 8) % 8], F[(g // 64) % 10], ME[(g // 640) % 5]
        ts = NOW - rnd.random() * 10 * 365 * 86400
        batch.append((g, str(uuid.uuid4()), sku(g), f'{t} {m} {f} {me} mod. {code(g)}', t, 1 + g % 400, m, me,
                      round(20 + rnd.random() * 4000, 2), round(10 + rnd.random() * 2000, 2),
                      int(rnd.random() * 5 + .5), int(rnd.random() * 20 + .5), ST[g % 6],
                      f'Gioiello artigianale in {m} con montatura in {me}, lavorazione {f}, realizzato a mano a Torre del Greco.',
                      f'{t},{f}', ts, ts + rnd.random() * 400 * 86400))
        for k in (1, 2, 3):
            mov.append((g, 'negozio', 3 if k == 1 else -1, 'carico', ts + k * 30 * 86400))
        if len(batch) == 50000:
            c.executemany('INSERT INTO articles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)', batch)
            c.executemany('INSERT INTO stock_movements(article_id,channel,delta,reason,created_at) VALUES (?,?,?,?,?)', mov)
            batch, mov = [], []
    if batch:
        c.executemany('INSERT INTO articles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)', batch)
        c.executemany('INSERT INTO stock_movements(article_id,channel,delta,reason,created_at) VALUES (?,?,?,?,?)', mov)
    c.execute('COMMIT')
    t1 = time.time()
    c.executescript('''
    CREATE UNIQUE INDEX articles_sku ON articles(sku);
    CREATE INDEX articles_list ON articles(status, product_type, updated_at DESC);
    CREATE INDEX articles_coll ON articles(collection_id);
    CREATE INDEX mov_article ON stock_movements(article_id, created_at DESC);
    ''')
    t2 = time.time()
    size_no_fts = os.path.getsize(path)
    # indice testuale trigram, sincronizzato da trigger come farebbe l'app
    c.executescript('''
    CREATE VIRTUAL TABLE names_fts USING fts5(name, content='articles', content_rowid='id', tokenize='trigram');
    INSERT INTO names_fts(rowid, name) SELECT id, name FROM articles;
    CREATE TRIGGER art_ai AFTER INSERT ON articles BEGIN INSERT INTO names_fts(rowid, name) VALUES (new.id, new.name); END;
    CREATE TRIGGER art_au AFTER UPDATE OF name ON articles BEGIN
      INSERT INTO names_fts(names_fts, rowid, name) VALUES ('delete', old.id, old.name);
      INSERT INTO names_fts(rowid, name) VALUES (new.id, new.name); END;
    ANALYZE;
    ''')
    c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    t3 = time.time()
    print(f'insert {t1 - t0:.1f}s  indici {t2 - t1:.1f}s  fts {t3 - t2:.1f}s  '
          f'size_no_fts {size_no_fts / 2**20:.0f} MB  size_total {os.path.getsize(path) / 2**20:.0f} MB')


# ---- operazioni ---------------------------------------------------------------------------
def q_sku(c, n, r):
    return c.execute('SELECT uuid, sku, name, price_retail, stock_retail FROM articles WHERE sku=?', (sku(r.randint(1, n)),)).fetchall()

def q_list(c, n, r):
    return c.execute("SELECT sku, name, price_retail, stock_retail FROM articles WHERE status='attivo' AND product_type='Anello' "
                     'ORDER BY updated_at DESC LIMIT 50 OFFSET ?', (r.randint(0, 20) * 50,)).fetchall()

def q_mov(c, n, r):
    return c.execute('SELECT m.* FROM stock_movements m JOIN articles a ON a.id=m.article_id WHERE a.sku=? '
                     'ORDER BY m.created_at DESC LIMIT 20', (sku(r.randint(1, n)),)).fetchall()

def q_rare(c, n, r):
    return c.execute('SELECT a.sku, a.name FROM names_fts f JOIN articles a ON a.id=f.rowid WHERE names_fts MATCH ? LIMIT 50',
                     ('"%s"' % code(r.randint(1, n)),)).fetchall()

def q_count(c, n, r):
    return c.execute("SELECT count(*) FROM articles WHERE status='attivo' AND product_type='Anello'").fetchall()

def q_common(c, n, r):
    return c.execute("SELECT a.sku, a.name, a.price_retail FROM names_fts f JOIN articles a ON a.id=f.rowid "
                     "WHERE names_fts MATCH '\"corallo rosa\" AND \"goccia\"' AND a.status='attivo' "
                     'ORDER BY a.updated_at DESC LIMIT 50').fetchall()

def q_report(c, n, r):
    # NOT INDEXED: senza, il pianificatore di SQLite usa articles_list e impiega 188 s invece di 1,8 s (3 milioni)
    return c.execute("SELECT collection_id, sum(stock_retail*price_retail) s FROM articles NOT INDEXED WHERE status='attivo' "
                     'GROUP BY 1 ORDER BY 2 DESC LIMIT 10').fetchall()

def q_sale(c, n, r):
    s = sku(r.randint(1, n))
    c.execute('BEGIN IMMEDIATE')
    c.execute('UPDATE articles SET stock_retail=stock_retail-1, updated_at=? WHERE sku=?', (time.time(), s))
    c.execute("INSERT INTO stock_movements(article_id,channel,delta,reason,created_at) "
              "SELECT id,'negozio',-1,'vendita',? FROM articles WHERE sku=?", (time.time(), s))
    c.execute('COMMIT')

def q_edit(c, n, r):
    i = r.randint(1, n)
    c.execute('UPDATE articles SET description_it=?, price_retail=price_retail+1, updated_at=? WHERE sku=?',
              ('Descrizione corretta %d' % i, time.time(), sku(i)))

def q_ins(c, n, r):
    i = r.randint(1, 2_000_000_000)
    c.execute("INSERT INTO articles(uuid,sku,name,product_type,collection_id,status,price_retail,description_it,created_at,updated_at) "
              "VALUES (?,?,?,'Anello',7,'bozza',250,'Nuovo articolo',?,?)",
              (str(uuid.uuid4()), 'NW%d-%d-%s' % (os.getpid(), i, uuid.uuid4().hex[:8]),
               'Anello corallo rosso goccia oro giallo 18kt mod. N%d' % i, time.time(), time.time()))

def q_scan(c, n, r):  # ricerca "contiene" senza indice testuale
    return c.execute('SELECT sku FROM articles WHERE name LIKE ? LIMIT 50', ('%%%s%%' % code(r.randint(1, n)),)).fetchall()


OPS = dict(sku=q_sku, list=q_list, mov=q_mov, rare=q_rare, count=q_count, common=q_common, report=q_report,
           sale=q_sale, edit=q_edit, ins=q_ins, scan=q_scan)


def bench(c, n, name, secs):
    r, lat, end = random.Random(), [], time.time() + secs
    while time.time() < end:
        t = time.perf_counter(); OPS[name](c, n, r); lat.append((time.perf_counter() - t) * 1000)
    return lat


def worker(path, n, secs, q):
    c, r = connect(path), random.Random()
    mix = ['sku'] * 45 + ['list'] * 15 + ['rare'] * 10 + ['mov'] * 10 + ['sale'] * 15 + ['ins'] * 5
    lat, err, end = [], 0, time.time() + secs
    while time.time() < end:
        op = r.choice(mix); t = time.perf_counter()
        try:
            OPS[op](c, n, r)
        except sqlite3.OperationalError:
            err += 1
            if c.in_transaction: c.execute('ROLLBACK')
        lat.append((time.perf_counter() - t) * 1000)
    q.put((lat, err))


def run(path, n):
    c = connect(path)
    for name, secs in [('sku', 10), ('list', 10), ('mov', 10), ('rare', 10), ('count', 10), ('common', 20),
                       ('report', 20), ('sale', 10), ('edit', 10), ('ins', 10), ('scan', 20)]:
        lat = bench(c, n, name, secs)
        print(f'{name:<8} c=1  lat_ms={statistics.mean(lat):<9.3f} p95={sorted(lat)[int(len(lat) * .95)]:.3f}  ops/s={len(lat) / secs:.0f}')
    print('-- concorrenza: 8 utenti, mix realistico')
    q = mp.Queue(); ps = [mp.Process(target=worker, args=(path, n, 30, q)) for _ in range(8)]
    [p.start() for p in ps]; res = [q.get() for _ in ps]; [p.join() for p in ps]
    lat = [x for l, _ in res for x in l]; err = sum(e for _, e in res)
    print(f'mix8     lat_ms={statistics.mean(lat):.3f} p95={sorted(lat)[int(len(lat) * .95)]:.3f}  ops/s={len(lat) / 30:.0f}  errori_lock={err}')


if __name__ == '__main__':
    {'gen': gen, 'run': run}[sys.argv[1]](sys.argv[2], int(sys.argv[3]))

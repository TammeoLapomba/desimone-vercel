-- Enum types
CREATE TYPE channel_type AS ENUM ('retail', 'wholesale', 'both');
CREATE TYPE product_type AS ENUM ('bracciale', 'collana', 'anello', 'orecchini', 'spilla', 'ciondolo', 'altro');
CREATE TYPE material_type AS ENUM ('coral', 'metal');
CREATE TYPE article_status AS ENUM ('draft', 'processing', 'ready', 'published');
CREATE TYPE photo_type AS ENUM ('raw', 'processed', 'shooting');
CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'done', 'failed');
CREATE TYPE audit_action AS ENUM ('insert', 'update', 'delete');
CREATE TYPE stock_channel AS ENUM ('retail', 'wholesale');

-- collections
CREATE TABLE collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description_it text,
  description_en text,
  channel     channel_type NOT NULL DEFAULT 'both',
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- materials
CREATE TABLE materials (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL,
  code   text UNIQUE NOT NULL,
  type   material_type NOT NULL,
  active boolean NOT NULL DEFAULT true
);

-- articles
CREATE TABLE articles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id       uuid NOT NULL REFERENCES collections(id),
  name                text NOT NULL,
  product_type        product_type NOT NULL,
  coral_material_id   uuid REFERENCES materials(id),
  metal_material_id   uuid REFERENCES materials(id),
  sku                 text UNIQUE NOT NULL,
  price_retail        numeric(10,2),
  price_wholesale     numeric(10,2),
  stock_retail        integer NOT NULL DEFAULT 0,
  stock_wholesale     integer NOT NULL DEFAULT 0,
  channel             channel_type NOT NULL DEFAULT 'both',
  status              article_status NOT NULL DEFAULT 'draft',
  description_it      text,
  description_en      text,
  description_fr      text,
  measurements        jsonb,
  tags                text[],
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- photos
CREATE TABLE photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id        uuid NOT NULL REFERENCES articles(id),
  storage_path      text NOT NULL,
  public_url        text,
  photo_type        photo_type NOT NULL DEFAULT 'raw',
  is_cover          boolean NOT NULL DEFAULT false,
  sort_order        integer NOT NULL DEFAULT 0,
  processing_status processing_status NOT NULL DEFAULT 'pending',
  error_message     text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);

-- stock_movements
CREATE TABLE stock_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  uuid NOT NULL REFERENCES articles(id),
  channel     stock_channel NOT NULL,
  delta       integer NOT NULL,
  reason      text,
  order_ref   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id)
);

-- audit_log
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  text NOT NULL,
  record_id   uuid NOT NULL,
  action      audit_action NOT NULL,
  old_values  jsonb,
  new_values  jsonb,
  changed_by  uuid REFERENCES auth.users(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

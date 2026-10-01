-- Schema della base di dati — Dashboard CER
-- Richiede l'estensione PostGIS già attiva sul database

DROP TABLE IF EXISTS cer_mensile, cer_membro, cer, edificio, scenario CASCADE;

-- Scenari di ottimizzazione
CREATE TABLE scenario 
(
    id           SERIAL PRIMARY KEY,
    codice       TEXT NOT NULL UNIQUE,
    nome         TEXT NOT NULL,
    comune       TEXT NOT NULL,
    data_import  TIMESTAMP DEFAULT NOW()
);

-- Edifici (comuni a tutti gli scenari)
CREATE TABLE edificio 
(
    id                BIGSERIAL PRIMARY KEY,
    comune            TEXT NOT NULL,
    id_edificio       INTEGER NOT NULL,
    classe_energetica TEXT,
    domanda_annua     DOUBLE PRECISION,
    produzione_annua  DOUBLE PRECISION,
    num_pannelli      INTEGER,
    potenza_picco     DOUBLE PRECISION,
    ruolo             TEXT CHECK (ruolo IN ('PEB', 'NEB')),
    geom              geometry(MultiPolygon, 4326) NOT NULL,
    UNIQUE (comune, id_edificio)
);

-- Comunità energetiche (riuscite e fallite)
CREATE TABLE cer 
(
    id                  BIGSERIAL PRIMARY KEY,
    scenario_id         INTEGER NOT NULL REFERENCES scenario(id) ON DELETE CASCADE,
    codice              TEXT NOT NULL,
    esito               TEXT NOT NULL CHECK (esito IN ('riuscita', 'fallita')),
    n_membri            INTEGER NOT NULL,
    n_prosumer          INTEGER,
    n_consumer          INTEGER,
    ind_autosufficienza DOUBLE PRECISION,
    ind_ambientale      DOUBLE PRECISION,
    indice              DOUBLE PRECISION,
    iterazione          INTEGER,
    domanda_annua       DOUBLE PRECISION,
    autoconsumo_fisico  DOUBLE PRECISION,
    autoconsumo_diffuso DOUBLE PRECISION,
    eccedenza           DOUBLE PRECISION,
    UNIQUE (scenario_id, codice)
);

-- Composizione delle comunità (relazione uno-a-molti)
CREATE TABLE cer_membro 
(
    cer_id      BIGINT NOT NULL REFERENCES cer(id) ON DELETE CASCADE,
    edificio_id BIGINT NOT NULL REFERENCES edificio(id) ON DELETE CASCADE,
    PRIMARY KEY (cer_id, edificio_id)
);

-- Andamento mensile dell'autoconsumo (disponibile solo per alcune CER)
CREATE TABLE cer_mensile 
(
    cer_id              BIGINT NOT NULL REFERENCES cer(id) ON DELETE CASCADE,
    mese                SMALLINT NOT NULL CHECK (mese BETWEEN 1 AND 12),
    autoconsumo_fisico  DOUBLE PRECISION,
    autoconsumo_diffuso DOUBLE PRECISION,
    PRIMARY KEY (cer_id, mese)
);

-- Indici per velocizzare le interrogazioni
CREATE INDEX idx_edificio_geom   ON edificio USING GIST (geom);
CREATE INDEX idx_edificio_ruolo  ON edificio (ruolo);
CREATE INDEX idx_cer_scenario    ON cer (scenario_id, esito);
CREATE INDEX idx_membro_edificio ON cer_membro (edificio_id);
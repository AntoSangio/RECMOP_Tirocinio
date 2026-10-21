-- =====================================================================
-- Schema della base di dati — Piattaforma di consultazione degli output
-- del modello RECMOP sulle Comunità Energetiche Rinnovabili.
--
-- Richiede PostgreSQL con estensione PostGIS:
--     CREATE EXTENSION IF NOT EXISTS postgis;
--
-- Lo schema è indipendente dal territorio: più comuni possono coesistere,
-- ciascuno con uno o più scenari di ottimizzazione.
-- =====================================================================

DROP TABLE IF EXISTS cer_mensile, cer_membro, cer, edificio, scenario, comune CASCADE;


-- Comuni analizzati
CREATE TABLE comune (
    id        SERIAL PRIMARY KEY,
    codice    TEXT NOT NULL UNIQUE,          -- identificativo interno, es. 'avellino'
    nome      TEXT NOT NULL,
    provincia TEXT
);


-- Scenari di ottimizzazione: ogni comune può averne più d'uno
CREATE TABLE scenario (
    id          SERIAL PRIMARY KEY,
    comune_id   INTEGER NOT NULL REFERENCES comune(id) ON DELETE CASCADE,
    codice      TEXT NOT NULL,               -- 'ambientale', 'energetico', ...
    nome        TEXT NOT NULL,
    comune      TEXT,                        -- denominazione, per sola lettura
    data_import TIMESTAMP DEFAULT NOW(),
    UNIQUE (comune_id, codice)
);


-- Edifici: unica entità dotata di geometria propria.
-- Gli attributi sono indipendenti dallo scenario.
CREATE TABLE edificio (
    id                BIGSERIAL PRIMARY KEY,
    comune_id         INTEGER NOT NULL REFERENCES comune(id) ON DELETE CASCADE,
    comune            TEXT,                  -- denominazione, per sola lettura
    id_edificio       INTEGER NOT NULL,      -- identificativo assegnato dal modello
    classe_energetica TEXT,
    domanda_annua     DOUBLE PRECISION,      -- D_an2023, kWh
    produzione_annua  DOUBLE PRECISION,      -- O_an2023, kWh
    num_pannelli      INTEGER,
    potenza_picco     DOUBLE PRECISION,      -- kW
    ruolo             TEXT CHECK (ruolo IN ('PEB', 'NEB')),
    geom              geometry(MultiPolygon, 4326) NOT NULL,
    UNIQUE (comune_id, id_edificio)
);


-- Aggregazioni di edifici, riuscite e non riuscite.
-- Il codice contiene gli identificativi dei membri separati da '_'.
CREATE TABLE cer (
    id                  BIGSERIAL PRIMARY KEY,
    scenario_id         INTEGER NOT NULL REFERENCES scenario(id) ON DELETE CASCADE,
    codice              TEXT NOT NULL,
    esito               TEXT NOT NULL CHECK (esito IN ('riuscita', 'fallita')),
    n_membri            INTEGER NOT NULL,
    n_prosumer          INTEGER,
    n_consumer          INTEGER,
    ind_autosufficienza DOUBLE PRECISION,    -- Ind_aut_CER
    ind_ambientale      DOUBLE PRECISION,    -- Ind_amb_CER
    indice              DOUBLE PRECISION,    -- indice dello scenario, confrontato con la soglia
    iterazione          INTEGER,             -- passo in cui l'aggregazione è stata tentata
    domanda_annua       DOUBLE PRECISION,    -- D_an, kWh
    autoconsumo_fisico  DOUBLE PRECISION,    -- AF_an, kWh
    autoconsumo_diffuso DOUBLE PRECISION,    -- AD_an, kWh
    eccedenza           DOUBLE PRECISION,    -- Sto_an, kWh
    UNIQUE (scenario_id, codice)
);


-- Composizione delle aggregazioni: relazione fra comunità ed edifici.
-- Uno stesso edificio può comparire in più aggregazioni non riuscite.
CREATE TABLE cer_membro (
    cer_id      BIGINT NOT NULL REFERENCES cer(id) ON DELETE CASCADE,
    edificio_id BIGINT NOT NULL REFERENCES edificio(id) ON DELETE CASCADE,
    PRIMARY KEY (cer_id, edificio_id)
);


-- Andamento mensile dell'autoconsumo di ciascuna aggregazione
CREATE TABLE cer_mensile (
    cer_id              BIGINT NOT NULL REFERENCES cer(id) ON DELETE CASCADE,
    mese                SMALLINT NOT NULL CHECK (mese BETWEEN 1 AND 12),
    autoconsumo_fisico  DOUBLE PRECISION,    -- AF_ms1..12
    autoconsumo_diffuso DOUBLE PRECISION,    -- AD_ms1..12
    PRIMARY KEY (cer_id, mese)
);


-- Indici a supporto delle interrogazioni più frequenti
CREATE INDEX idx_edificio_geom    ON edificio USING GIST (geom);
CREATE INDEX idx_edificio_comune  ON edificio (comune_id);
CREATE INDEX idx_edificio_ruolo   ON edificio (ruolo);
CREATE INDEX idx_scenario_comune  ON scenario (comune_id);
CREATE INDEX idx_cer_scenario     ON cer (scenario_id, esito);
CREATE INDEX idx_membro_edificio  ON cer_membro (edificio_id);
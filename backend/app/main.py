"""
Server dell'applicazione: espone i dati del database tramite API.
Avvio:  uvicorn app.main:app --reload
"""

import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# --- Configurazione ---

RADICE = Path(__file__).resolve().parents[2]
load_dotenv(RADICE / ".env")

DB = {
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT"),
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
}

app = FastAPI(
    title="API Comunità Energetiche Rinnovabili",
    description="Consultazione degli output del modello RECMOP",
    version="0.1.0",
)

# Permette al browser di interrogare il server durante lo sviluppo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def interroga(sql, parametri=()):
    """Esegue una query e restituisce le righe come dizionari."""
    with psycopg.connect(**DB, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, parametri)
            return cur.fetchall()


# --- Endpoint ---

@app.get("/api/stato")
def stato():
    """Verifica che il server e il database rispondano."""
    righe = interroga("SELECT PostGIS_Version() AS postgis")
    return {"stato": "attivo", "postgis": righe[0]["postgis"]}


@app.get("/api/scenari")
def scenari():
    """Elenco degli scenari disponibili."""
    return interroga(
        """
        SELECT s.codice, s.nome, s.comune,
               COUNT(*) FILTER (WHERE c.esito = 'riuscita') AS cer_riuscite,
               COUNT(*) FILTER (WHERE c.esito = 'fallita')  AS cer_fallite
        FROM scenario s
        LEFT JOIN cer c ON c.scenario_id = s.id
        GROUP BY s.id, s.codice, s.nome, s.comune
        ORDER BY s.codice
        """
    )


@app.get("/api/kpi/{scenario}")
def kpi(scenario: str):
    """Indicatori d'insieme del territorio per uno scenario."""
    righe = interroga("SELECT id FROM scenario WHERE codice = %s", (scenario,))
    if not righe:
        raise HTTPException(status_code=404, detail="Scenario non trovato")
    scenario_id = righe[0]["id"]

    edifici = interroga(
        """
        SELECT COUNT(*) AS totale,
               COUNT(*) FILTER (WHERE ruolo = 'PEB') AS peb,
               COUNT(*) FILTER (WHERE ruolo = 'NEB') AS neb
        FROM edificio WHERE comune = %s
        """,
        ("Avellino",),
    )[0]

    comunita = interroga(
        """
        SELECT COUNT(*) FILTER (WHERE esito = 'riuscita') AS riuscite,
               COUNT(*) FILTER (WHERE esito = 'fallita')  AS fallite
        FROM cer WHERE scenario_id = %s
        """,
        (scenario_id,),
    )[0]

    coinvolti = interroga(
        """
        SELECT COUNT(DISTINCT m.edificio_id) AS edifici_in_cer
        FROM cer_membro m
        JOIN cer c ON c.id = m.cer_id
        WHERE c.scenario_id = %s AND c.esito = 'riuscita'
        """,
        (scenario_id,),
    )[0]

    copertura = round(
        100 * coinvolti["edifici_in_cer"] / edifici["totale"], 1
    ) if edifici["totale"] else 0

    return {
        "scenario": scenario,
        **edifici,
        **comunita,
        **coinvolti,
        "copertura_percentuale": copertura,
    }

@app.get("/api/edifici")
def edifici():
    """
    Tutti gli edifici in formato GeoJSON, pronti per la mappa.
    La geometria è convertita da PostGIS con ST_AsGeoJSON.
    """
    righe = interroga(
        """
        SELECT id_edificio, classe_energetica, domanda_annua, produzione_annua,
               num_pannelli, potenza_picco, ruolo,
               ST_AsGeoJSON(geom)::json AS geometria
        FROM edificio
        WHERE comune = %s
        """,
        ("Avellino",),
    )

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": r.pop("geometria"),
                "properties": r,
            }
            for r in righe
        ],
    }


@app.get("/api/cer/{scenario}")
def elenco_cer(scenario: str, esito: str = "riuscita"):
    """Elenco delle comunità di uno scenario (riuscite o fallite)."""
    return interroga(
        """
        SELECT c.codice, c.esito, c.n_membri, c.iterazione, c.indice,
               c.domanda_annua, c.autoconsumo_fisico,
               c.autoconsumo_diffuso, c.eccedenza
        FROM cer c
        JOIN scenario s ON s.id = c.scenario_id
        WHERE s.codice = %s AND c.esito = %s
        ORDER BY c.autoconsumo_diffuso DESC NULLS LAST
        """,
        (scenario, esito),
    )


@app.get("/api/cer/{scenario}/{codice}")
def dettaglio_cer(scenario: str, codice: str):
    """
    Dettaglio di una comunità: attributi, membri con il loro ruolo
    e andamento mensile dell'autoconsumo.
    """
    righe = interroga(
        """
        SELECT c.id, c.codice, c.esito, c.n_membri, c.iterazione, c.indice,
               c.domanda_annua, c.autoconsumo_fisico,
               c.autoconsumo_diffuso, c.eccedenza
        FROM cer c
        JOIN scenario s ON s.id = c.scenario_id
        WHERE s.codice = %s AND c.codice = %s
        """,
        (scenario, codice),
    )
    if not righe:
        raise HTTPException(status_code=404, detail="Comunità non trovata")

    comunita = righe[0]
    cer_id = comunita.pop("id")

    membri = interroga(
        """
        SELECT e.id_edificio, e.ruolo, e.classe_energetica,
               e.domanda_annua, e.produzione_annua, e.potenza_picco
        FROM cer_membro m
        JOIN edificio e ON e.id = m.edificio_id
        WHERE m.cer_id = %s
        ORDER BY e.ruolo, e.id_edificio
        """,
        (cer_id,),
    )

    mensili = interroga(
        """
        SELECT mese, autoconsumo_fisico, autoconsumo_diffuso
        FROM cer_mensile WHERE cer_id = %s ORDER BY mese
        """,
        (cer_id,),
    )

    # CO2 evitata: fattore di emissione 0,268 kgCO2/kWh
    produzione = sum(m["produzione_annua"] or 0 for m in membri)
    comunita["co2_evitata_kg"] = round(produzione * 0.268 / 1000, 2)

@app.get("/api/edificio-vicino")
def edificio_vicino(lat: float, lon: float):
    """
    Edificio più vicino a un punto geografico.
    Usa l'indice spaziale di PostGIS: la ricerca è immediata.
    """
    righe = interroga(
        """
        SELECT id_edificio, ruolo,
               ST_Distance(geom::geography, ST_SetSRID(ST_Point(%s, %s), 4326)::geography) AS distanza_m
        FROM edificio
        WHERE comune = %s
        ORDER BY geom <-> ST_SetSRID(ST_Point(%s, %s), 4326)
        LIMIT 1
        """,
        (lon, lat, "Avellino", lon, lat),
    )
    return righe[0] if righe else {"id_edificio": None}

@app.get("/api/distribuzioni/{scenario}")
def distribuzioni(scenario: str):
    """Distribuzioni utili ai grafici della vista territorio."""
    per_dimensione = interroga(
        """
        SELECT c.n_membri AS dimensione, COUNT(*) AS numero
        FROM cer c JOIN scenario s ON s.id = c.scenario_id
        WHERE s.codice = %s AND c.esito = 'riuscita'
        GROUP BY c.n_membri ORDER BY c.n_membri
        """,
        (scenario,),
    )

    per_iterazione = interroga(
        """
        SELECT c.iterazione,
               COUNT(*) FILTER (WHERE c.esito = 'riuscita') AS riuscite,
               COUNT(*) FILTER (WHERE c.esito = 'fallita')  AS fallite
        FROM cer c JOIN scenario s ON s.id = c.scenario_id
        WHERE s.codice = %s AND c.iterazione IS NOT NULL
        GROUP BY c.iterazione ORDER BY c.iterazione
        """,
        (scenario,),
    )

    per_classe = interroga(
        """
        SELECT classe_energetica AS classe, COUNT(*) AS numero
        FROM edificio WHERE comune = %s
        GROUP BY classe_energetica ORDER BY classe_energetica
        """,
        ("Avellino",),
    )

    return {
        "dimensione_cer": per_dimensione,
        "iterazioni": per_iterazione,
        "classi_energetiche": per_classe,
    }


@app.get("/api/confronto")
def confronto():
    """Indicatori dei due scenari affiancati."""
    return interroga(
        """
        SELECT s.codice AS scenario,
               COUNT(*) FILTER (WHERE c.esito = 'riuscita') AS riuscite,
               COUNT(*) FILTER (WHERE c.esito = 'fallita')  AS fallite,
               ROUND(AVG(c.n_membri) FILTER (WHERE c.esito = 'riuscita'), 1) AS membri_medi,
               ROUND(SUM(c.autoconsumo_diffuso) FILTER (WHERE c.esito = 'riuscita')::numeric) AS energia_condivisa
        FROM scenario s LEFT JOIN cer c ON c.scenario_id = s.id
        GROUP BY s.codice ORDER BY s.codice
        """
    )
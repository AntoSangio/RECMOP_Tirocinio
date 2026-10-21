"""
Server dell'applicazione: espone i dati del database tramite API.
Avvio:  uvicorn app.main:app --reload

Gli indirizzi sono organizzati per comune, in modo che l'applicazione
possa servire più comuni senza modifiche al codice.
"""

import os
import shutil
import tempfile
import zipfile
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.importazione import importa_pacchetto

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
    version="0.3.0",
)

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


def connessione():
    """Connessione da usare per le operazioni di scrittura."""
    return psycopg.connect(**DB, row_factory=dict_row)


# --- Stato e anagrafica ---

@app.get("/api/stato")
def stato():
    """Verifica che il server e il database rispondano."""
    righe = interroga("SELECT PostGIS_Version() AS postgis")
    return {"stato": "attivo", "postgis": righe[0]["postgis"]}


@app.get("/api/comuni")
def comuni():
    """
    Comuni disponibili, con i loro scenari e il centro della mappa.
    È la richiesta che alimenta la pagina iniziale.
    """
    elenco = interroga(
        """
        SELECT c.codice, c.nome, c.provincia,
               COUNT(DISTINCT e.id) AS edifici,
               ST_Y(ST_Centroid(ST_Extent(e.geom)::geometry)) AS lat,
               ST_X(ST_Centroid(ST_Extent(e.geom)::geometry)) AS lon
        FROM comune c
        LEFT JOIN edificio e ON e.comune_id = c.id
        GROUP BY c.id, c.codice, c.nome, c.provincia
        ORDER BY c.nome
        """
    )

    for comune in elenco:
        comune["scenari"] = interroga(
            """
            SELECT s.codice, s.nome,
                   COUNT(*) FILTER (WHERE cr.esito = 'riuscita') AS cer_riuscite,
                   COUNT(*) FILTER (WHERE cr.esito = 'fallita')  AS cer_fallite
            FROM scenario s
            JOIN comune c ON c.id = s.comune_id
            LEFT JOIN cer cr ON cr.scenario_id = s.id
            WHERE c.codice = %s
            GROUP BY s.id, s.codice, s.nome
            ORDER BY s.codice
            """,
            (comune["codice"],),
        )

    return elenco


# --- Consultazione ---

@app.get("/api/{comune}/kpi/{scenario}")
def kpi(comune: str, scenario: str):
    """Indicatori d'insieme del territorio per un comune e uno scenario."""
    righe = interroga(
        """
        SELECT s.id FROM scenario s JOIN comune c ON c.id = s.comune_id
        WHERE c.codice = %s AND s.codice = %s
        """,
        (comune, scenario),
    )
    if not righe:
        raise HTTPException(status_code=404, detail="Scenario non trovato")
    scenario_id = righe[0]["id"]

    edifici = interroga(
        """
        SELECT COUNT(*) AS totale,
               COUNT(*) FILTER (WHERE e.ruolo = 'PEB') AS peb,
               COUNT(*) FILTER (WHERE e.ruolo = 'NEB') AS neb
        FROM edificio e JOIN comune c ON c.id = e.comune_id
        WHERE c.codice = %s
        """,
        (comune,),
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
        FROM cer_membro m JOIN cer c ON c.id = m.cer_id
        WHERE c.scenario_id = %s AND c.esito = 'riuscita'
        """,
        (scenario_id,),
    )[0]

    copertura = round(
        100 * coinvolti["edifici_in_cer"] / edifici["totale"], 1
    ) if edifici["totale"] else 0

    return {
        "comune": comune, "scenario": scenario,
        **edifici, **comunita, **coinvolti,
        "copertura_percentuale": copertura,
    }


@app.get("/api/{comune}/edifici")
def edifici(comune: str, scenario: str = None):
    """
    Edifici di un comune in formato GeoJSON, pronti per la mappa.
    Se si indica uno scenario, ogni edificio riporta anche se rientra
    in una comunità riuscita o in un'aggregazione non riuscita.
    """
    if scenario:
        righe = interroga(
            """
            SELECT e.id_edificio, e.classe_energetica, e.domanda_annua, e.produzione_annua,
                   e.num_pannelli, e.potenza_picco, e.ruolo,
                   BOOL_OR(cr.esito = 'riuscita') AS in_riuscita,
                   BOOL_OR(cr.esito = 'fallita')  AS in_fallita,
                   ST_AsGeoJSON(e.geom)::json AS geometria
            FROM edificio e
            JOIN comune c ON c.id = e.comune_id
            LEFT JOIN cer_membro m ON m.edificio_id = e.id
            LEFT JOIN cer cr ON cr.id = m.cer_id
            LEFT JOIN scenario s ON s.id = cr.scenario_id AND s.codice = %s
            WHERE c.codice = %s AND (cr.id IS NULL OR s.id IS NOT NULL)
            GROUP BY e.id, e.id_edificio, e.classe_energetica, e.domanda_annua,
                     e.produzione_annua, e.num_pannelli, e.potenza_picco, e.ruolo, e.geom
            """,
            (scenario, comune),
        )
    else:
        righe = interroga(
            """
            SELECT e.id_edificio, e.classe_energetica, e.domanda_annua, e.produzione_annua,
                   e.num_pannelli, e.potenza_picco, e.ruolo,
                   NULL::boolean AS in_riuscita, NULL::boolean AS in_fallita,
                   ST_AsGeoJSON(e.geom)::json AS geometria
            FROM edificio e JOIN comune c ON c.id = e.comune_id
            WHERE c.codice = %s
            """,
            (comune,),
        )

    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "geometry": r.pop("geometria"), "properties": r}
            for r in righe
        ],
    }


@app.get("/api/{comune}/cer/{scenario}")
def elenco_cer(comune: str, scenario: str, esito: str = "riuscita"):
    """Elenco delle comunità di uno scenario."""
    return interroga(
        """
        SELECT cr.codice, cr.esito, cr.n_membri, cr.iterazione, cr.indice,
               cr.domanda_annua, cr.autoconsumo_fisico,
               cr.autoconsumo_diffuso, cr.eccedenza
        FROM cer cr
        JOIN scenario s ON s.id = cr.scenario_id
        JOIN comune c ON c.id = s.comune_id
        WHERE c.codice = %s AND s.codice = %s AND cr.esito = %s
        ORDER BY cr.autoconsumo_diffuso DESC NULLS LAST
        """,
        (comune, scenario, esito),
    )


@app.get("/api/{comune}/cer/{scenario}/{codice}")
def dettaglio_cer(comune: str, scenario: str, codice: str):
    """Dettaglio di una comunità: attributi, membri e andamento mensile."""
    righe = interroga(
        """
        SELECT cr.id, cr.codice, cr.esito, cr.n_membri, cr.iterazione, cr.indice,
               cr.domanda_annua, cr.autoconsumo_fisico,
               cr.autoconsumo_diffuso, cr.eccedenza
        FROM cer cr
        JOIN scenario s ON s.id = cr.scenario_id
        JOIN comune c ON c.id = s.comune_id
        WHERE c.codice = %s AND s.codice = %s AND cr.codice = %s
        """,
        (comune, scenario, codice),
    )
    if not righe:
        raise HTTPException(status_code=404, detail="Comunità non trovata")

    comunita = righe[0]
    cer_id = comunita.pop("id")

    membri = interroga(
        """
        SELECT e.id_edificio, e.ruolo, e.classe_energetica,
               e.domanda_annua, e.produzione_annua, e.potenza_picco,
               ST_X(ST_Centroid(e.geom)) AS lon,
               ST_Y(ST_Centroid(e.geom)) AS lat
        FROM cer_membro m JOIN edificio e ON e.id = m.edificio_id
        WHERE m.cer_id = %s ORDER BY e.ruolo, e.id_edificio
        """,
        (cer_id,),
    )

    # Estensione della comunità: distanza massima tra due membri
    estensione = interroga(
        """
        SELECT ROUND(MAX(ST_Distance(a.geom::geography, b.geom::geography))) AS distanza_max
        FROM cer_membro ma JOIN edificio a ON a.id = ma.edificio_id
        CROSS JOIN cer_membro mb JOIN edificio b ON b.id = mb.edificio_id
        WHERE ma.cer_id = %s AND mb.cer_id = %s
        """,
        (cer_id, cer_id),
    )[0]
    comunita["distanza_massima_m"] = estensione["distanza_max"]

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

    return {"comunita": comunita, "membri": membri, "mensili": mensili}


@app.get("/api/{comune}/edificio/{id_edificio}/cer/{scenario}")
def cer_di_edificio(comune: str, id_edificio: int, scenario: str):
    """La comunità a cui appartiene un edificio in un dato scenario."""
    edificio = interroga(
        """
        SELECT e.id_edificio, e.ruolo, e.classe_energetica,
               e.domanda_annua, e.produzione_annua, e.num_pannelli, e.potenza_picco
        FROM edificio e JOIN comune c ON c.id = e.comune_id
        WHERE c.codice = %s AND e.id_edificio = %s
        """,
        (comune, id_edificio),
    )
    if not edificio:
        raise HTTPException(status_code=404, detail="Edificio non trovato")

    appartenenza = interroga(
        """
        SELECT cr.codice
        FROM cer_membro m
        JOIN cer cr ON cr.id = m.cer_id
        JOIN scenario s ON s.id = cr.scenario_id
        JOIN comune c ON c.id = s.comune_id
        JOIN edificio e ON e.id = m.edificio_id
        WHERE c.codice = %s AND e.id_edificio = %s
          AND s.codice = %s AND cr.esito = 'riuscita'
        """,
        (comune, id_edificio, scenario),
    )

    risultato = {"edificio": edificio[0], "in_comunita": bool(appartenenza)}
    if appartenenza:
        risultato["comunita"] = dettaglio_cer(comune, scenario, appartenenza[0]["codice"])
    return risultato


@app.get("/api/{comune}/edificio/{id_edificio}/distanze")
def distanze_dai_membri(comune: str, id_edificio: int, scenario: str):
    """
    Distanza tra un edificio e gli altri membri della sua comunità.
    Il calcolo è eseguito da PostGIS sulle geometrie reali.
    """
    return interroga(
        """
        WITH scelto AS (
            SELECT e.id, e.geom
            FROM edificio e JOIN comune c ON c.id = e.comune_id
            WHERE c.codice = %s AND e.id_edificio = %s
        ),
        sua_cer AS (
            SELECT cr.id
            FROM cer_membro m
            JOIN cer cr ON cr.id = m.cer_id
            JOIN scenario s ON s.id = cr.scenario_id
            JOIN comune c ON c.id = s.comune_id
            JOIN scelto ON scelto.id = m.edificio_id
            WHERE c.codice = %s AND s.codice = %s AND cr.esito = 'riuscita'
        )
        SELECT e.id_edificio,
               ROUND(ST_Distance(e.geom::geography, scelto.geom::geography)) AS distanza_m
        FROM cer_membro m
        JOIN edificio e ON e.id = m.edificio_id
        JOIN sua_cer ON sua_cer.id = m.cer_id
        CROSS JOIN scelto
        WHERE e.id <> scelto.id
        ORDER BY distanza_m
        """,
        (comune, id_edificio, comune, scenario),
    )


@app.get("/api/{comune}/edificio-vicino")
def edificio_vicino(comune: str, lat: float, lon: float):
    """Edificio più vicino a un punto: usa l'indice spaziale di PostGIS."""
    righe = interroga(
        """
        SELECT e.id_edificio, e.ruolo,
               ST_Distance(e.geom::geography, ST_SetSRID(ST_Point(%s, %s), 4326)::geography) AS distanza_m
        FROM edificio e JOIN comune c ON c.id = e.comune_id
        WHERE c.codice = %s
        ORDER BY e.geom <-> ST_SetSRID(ST_Point(%s, %s), 4326)
        LIMIT 1
        """,
        (lon, lat, comune, lon, lat),
    )
    return righe[0] if righe else {"id_edificio": None}


# --- Analisi per l'amministrazione ---

@app.get("/api/{comune}/distribuzioni/{scenario}")
def distribuzioni(comune: str, scenario: str):
    """Distribuzioni per i grafici della vista territorio."""
    per_dimensione = interroga(
        """
        SELECT cr.n_membri AS dimensione, COUNT(*) AS numero
        FROM cer cr JOIN scenario s ON s.id = cr.scenario_id
        JOIN comune c ON c.id = s.comune_id
        WHERE c.codice = %s AND s.codice = %s AND cr.esito = 'riuscita'
        GROUP BY cr.n_membri ORDER BY cr.n_membri
        """,
        (comune, scenario),
    )

    per_iterazione = interroga(
        """
        SELECT cr.iterazione,
               COUNT(*) FILTER (WHERE cr.esito = 'riuscita') AS riuscite,
               COUNT(*) FILTER (WHERE cr.esito = 'fallita')  AS fallite
        FROM cer cr JOIN scenario s ON s.id = cr.scenario_id
        JOIN comune c ON c.id = s.comune_id
        WHERE c.codice = %s AND s.codice = %s AND cr.iterazione IS NOT NULL
        GROUP BY cr.iterazione ORDER BY cr.iterazione
        """,
        (comune, scenario),
    )

    per_classe = interroga(
        """
        SELECT e.classe_energetica AS classe, COUNT(*) AS numero
        FROM edificio e JOIN comune c ON c.id = e.comune_id
        WHERE c.codice = %s
        GROUP BY e.classe_energetica ORDER BY e.classe_energetica
        """,
        (comune,),
    )

    return {
        "dimensione_cer": per_dimensione,
        "iterazioni": per_iterazione,
        "classi_energetiche": per_classe,
    }


@app.get("/api/{comune}/confronto")
def confronto(comune: str):
    """Indicatori dei due scenari affiancati."""
    return interroga(
        """
        SELECT s.codice AS scenario,
               COUNT(*) FILTER (WHERE cr.esito = 'riuscita') AS riuscite,
               COUNT(*) FILTER (WHERE cr.esito = 'fallita')  AS fallite,
               ROUND(AVG(cr.n_membri) FILTER (WHERE cr.esito = 'riuscita'), 1) AS membri_medi,
               ROUND(SUM(cr.autoconsumo_diffuso) FILTER (WHERE cr.esito = 'riuscita')::numeric) AS energia_condivisa
        FROM scenario s
        JOIN comune c ON c.id = s.comune_id
        LEFT JOIN cer cr ON cr.scenario_id = s.id
        WHERE c.codice = %s
        GROUP BY s.codice ORDER BY s.codice
        """,
        (comune,),
    )


@app.get("/api/{comune}/criticita/{scenario}")
def criticita(comune: str, scenario: str):
    """
    Quadro delle aggregazioni non riuscite: quante sono, quali edifici
    coinvolgono e quali caratteristiche hanno. Serve all'amministrazione
    per individuare le aree su cui intervenire.
    """
    sintesi = interroga(
        """
        SELECT COUNT(*) AS tentativi,
               ROUND(AVG(cr.n_membri), 1) AS membri_medi,
               ROUND(AVG(cr.indice)::numeric, 2) AS indice_medio,
               MAX(cr.indice) AS indice_massimo
        FROM cer cr
        JOIN scenario s ON s.id = cr.scenario_id
        JOIN comune c ON c.id = s.comune_id
        WHERE c.codice = %s AND s.codice = %s AND cr.esito = 'fallita'
        """,
        (comune, scenario),
    )[0]

    esclusi = interroga(
        """
        WITH membri_falliti AS (
            SELECT DISTINCT m.edificio_id
            FROM cer_membro m
            JOIN cer cr ON cr.id = m.cer_id
            JOIN scenario s ON s.id = cr.scenario_id
            JOIN comune c ON c.id = s.comune_id
            WHERE c.codice = %s AND s.codice = %s AND cr.esito = 'fallita'
        ),
        membri_riusciti AS (
            SELECT DISTINCT m.edificio_id
            FROM cer_membro m
            JOIN cer cr ON cr.id = m.cer_id
            JOIN scenario s ON s.id = cr.scenario_id
            JOIN comune c ON c.id = s.comune_id
            WHERE c.codice = %s AND s.codice = %s AND cr.esito = 'riuscita'
        )
        SELECT COUNT(*) AS edifici_solo_falliti
        FROM membri_falliti f
        WHERE f.edificio_id NOT IN (SELECT edificio_id FROM membri_riusciti)
        """,
        (comune, scenario, comune, scenario),
    )[0]

    vicine = interroga(
        """
        SELECT cr.codice, cr.n_membri, cr.indice, cr.iterazione,
               cr.domanda_annua, cr.autoconsumo_diffuso
        FROM cer cr
        JOIN scenario s ON s.id = cr.scenario_id
        JOIN comune c ON c.id = s.comune_id
        WHERE c.codice = %s AND s.codice = %s AND cr.esito = 'fallita'
          AND cr.indice IS NOT NULL
        ORDER BY cr.indice DESC
        LIMIT 20
        """,
        (comune, scenario),
    )

    per_classe = interroga(
        """
        WITH falliti AS (
            SELECT DISTINCT m.edificio_id
            FROM cer_membro m
            JOIN cer cr ON cr.id = m.cer_id
            JOIN scenario s ON s.id = cr.scenario_id
            JOIN comune c ON c.id = s.comune_id
            WHERE c.codice = %s AND s.codice = %s AND cr.esito = 'fallita'
        )
        SELECT e.classe_energetica AS classe, COUNT(*) AS numero
        FROM falliti f JOIN edificio e ON e.id = f.edificio_id
        GROUP BY e.classe_energetica ORDER BY e.classe_energetica
        """,
        (comune, scenario),
    )

    return {
        "sintesi": {**sintesi, **esclusi},
        "piu_vicine": vicine,
        "classi": per_classe,
    }


# --- Gestione dei dati ---

@app.post("/api/gestione/importa")
async def importa(
    pacchetto: UploadFile = File(...),
    nome_comune: str = Form(None),
    provincia: str = Form(None),
):
    """
    Riceve un pacchetto RECMOP in formato zip, lo elabora e lo inserisce
    nella base di dati. Restituisce il resoconto dell'operazione.
    """
    if not pacchetto.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="È richiesto un file in formato zip.")

    with tempfile.TemporaryDirectory() as temporanea:
        temporanea = Path(temporanea)
        archivio = temporanea / pacchetto.filename

        with open(archivio, "wb") as f:
            shutil.copyfileobj(pacchetto.file, f)

        estratto = temporanea / "estratto"
        try:
            with zipfile.ZipFile(archivio) as z:
                z.extractall(estratto)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Il file non è un archivio zip valido.")

        cartella = None
        for candidata in [estratto, *estratto.rglob("*")]:
            if candidata.is_dir() and (candidata / "data").is_dir():
                cartella = candidata
                break

        if cartella is None:
            raise HTTPException(
                status_code=400,
                detail="Nell'archivio non è stata trovata la cartella di un pacchetto RECMOP.",
            )

        try:
            with connessione() as conn:
                return importa_pacchetto(conn, cartella, nome_comune, provincia)
        except ValueError as errore:
            raise HTTPException(status_code=400, detail=str(errore))


@app.delete("/api/gestione/comune/{codice}")
def elimina_comune(codice: str):
    """Rimuove un comune e tutti i suoi dati."""
    with connessione() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM comune WHERE codice = %s RETURNING nome", (codice,))
            riga = cur.fetchone()
        conn.commit()
    if not riga:
        raise HTTPException(status_code=404, detail="Comune non trovato")
    return {"eliminato": riga["nome"]}


@app.delete("/api/gestione/comune/{codice}/scenario/{scenario}")
def elimina_scenario(codice: str, scenario: str):
    """Rimuove un singolo scenario di un comune."""
    with connessione() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM scenario s USING comune c
                WHERE s.comune_id = c.id AND c.codice = %s AND s.codice = %s
                RETURNING s.nome
                """,
                (codice, scenario),
            )
            riga = cur.fetchone()
        conn.commit()
    if not riga:
        raise HTTPException(status_code=404, detail="Scenario non trovato")
    return {"eliminato": riga["nome"]}


@app.get("/api/{comune}/edificio/{id_edificio}/scenari")
def edificio_negli_scenari(comune: str, id_edificio: int):
    """
    Come cambia la situazione di un edificio nei diversi scenari:
    in quale comunità rientra e con quali risultati.
    """
    return interroga(
        """
        SELECT s.codice AS scenario,
               cr.codice AS cer,
               cr.n_membri,
               cr.autoconsumo_diffuso,
               cr.indice
        FROM scenario s
        JOIN comune c ON c.id = s.comune_id
        LEFT JOIN cer cr ON cr.scenario_id = s.id AND cr.esito = 'riuscita'
             AND cr.id IN (
                 SELECT m.cer_id FROM cer_membro m
                 JOIN edificio e ON e.id = m.edificio_id
                 WHERE e.comune_id = c.id AND e.id_edificio = %s
             )
        WHERE c.codice = %s
        ORDER BY s.codice
        """,
        (id_edificio, comune),
    )

@app.get("/api/{comune}/cer/{scenario}/{codice_a}/confronta/{codice_b}")
def confronta_comunita(comune: str, scenario: str, codice_a: str, codice_b: str):
    """Mette a confronto due comunità dello stesso scenario."""
    return {
        "prima": dettaglio_cer(comune, scenario, codice_a),
        "seconda": dettaglio_cer(comune, scenario, codice_b),
    }
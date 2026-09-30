"""
Caricamento degli output RECMOP nella base di dati.
Legge i pacchetti in input/ e popola le tabelle del database.
"""

import os
import json
import csv
from pathlib import Path

import psycopg
from dotenv import load_dotenv

# --- Configurazione ---

# Cartella principale del progetto (due livelli sopra questo file)
RADICE = Path(__file__).resolve().parents[2]
INPUT = Path(__file__).resolve().parent / "input"

load_dotenv(RADICE / ".env")

DB = {
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT"),
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
}

# Gli scenari da caricare: codice interno -> cartella del pacchetto
SCENARI = {
    "ambientale": "student_package_avellino_ambientale",
    "energetico": "student_package_avellino_energetico",
}

COMUNE = "Avellino"


def connetti():
    """Apre la connessione al database e verifica che risponda."""
    conn = psycopg.connect(**DB)
    with conn.cursor() as cur:
        cur.execute("SELECT version(), PostGIS_Version()")
        versione, postgis = cur.fetchone()
    print("Connesso al database")
    print("  PostgreSQL:", versione.split(",")[0])
    print("  PostGIS:", postgis)
    return conn


def verifica_input():
    """Controlla che i pacchetti siano presenti."""
    print("\nControllo dei pacchetti di input:")
    ok = True
    for codice, cartella in SCENARI.items():
        percorso = INPUT / cartella
        if percorso.exists():
            print(f"  [OK] {codice}: {cartella}")
        else:
            print(f"  [MANCANTE] {codice}: {percorso}")
            ok = False
    return ok


def carica_edifici(conn, cartella_scenario):
    """
    Carica gli edifici nella tabella 'edificio'.
    Gli edifici sono comuni a tutti gli scenari: si caricano una volta sola.
    Il ruolo PEB/NEB è letto dai layer peb_initial e neb_initial.
    """
    base = INPUT / cartella_scenario / "data" / "geojson"

    # 1. Leggo i ruoli dai due layer dedicati
    with open(base / "peb_initial.geojson", encoding="utf-8") as f:
        peb = {str(x["properties"]["ID_P"]) for x in json.load(f)["features"]}
    with open(base / "neb_initial.geojson", encoding="utf-8") as f:
        neb = {str(x["properties"]["ID_N"]) for x in json.load(f)["features"]}
    print(f"\nRuoli energetici: {len(peb)} PEB, {len(neb)} NEB")

    # 2. Leggo gli edifici con la loro geometria
    with open(base / "all_buildings_base.geojson", encoding="utf-8") as f:
        edifici = json.load(f)["features"]
    print(f"Edifici nel file: {len(edifici)}")

    # 3. Inserisco nel database
    senza_ruolo = 0
    with conn.cursor() as cur:
        cur.execute("DELETE FROM edificio WHERE comune = %s", (COMUNE,))

        for e in edifici:
            p = e["properties"]
            id_edificio = str(p["ID_Edificio"])

            if id_edificio in peb:
                ruolo = "PEB"
            elif id_edificio in neb:
                ruolo = "NEB"
            else:
                ruolo = None
                senza_ruolo += 1

            cur.execute(
                """
                INSERT INTO edificio (
                    comune, id_edificio, classe_energetica,
                    domanda_annua, produzione_annua,
                    num_pannelli, potenza_picco, ruolo, geom
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    ST_Multi(ST_GeomFromGeoJSON(%s))
                )
                """,
                (
                    COMUNE,
                    int(p["ID_Edificio"]),
                    p.get("classe_energetica"),
                    p.get("D_an2023"),
                    p.get("O_an2023"),
                    p.get("Num_Pannelli"),
                    p.get("Potenza_Picco"),
                    ruolo,
                    json.dumps(e["geometry"]),
                ),
            )

    conn.commit()

    # 4. Verifica di consistenza
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM edificio WHERE comune = %s", (COMUNE,))
        totale = cur.fetchone()[0]
        cur.execute(
            "SELECT ruolo, COUNT(*) FROM edificio WHERE comune = %s GROUP BY ruolo",
            (COMUNE,),
        )
        per_ruolo = dict(cur.fetchall())

    print(f"Inseriti: {totale} edifici  ->  {per_ruolo}")
    if senza_ruolo:
        print(f"  ATTENZIONE: {senza_ruolo} edifici senza ruolo assegnato")


if __name__ == "__main__":
    print("=== Caricamento dati RECMOP ===")

    if not verifica_input():
        print("\nInterrotto: pacchetti mancanti.")
        raise SystemExit(1)

    conn = connetti()

    # Gli edifici sono comuni ai due scenari: li carico dal primo
    carica_edifici(conn, SCENARI["ambientale"])

    conn.close()
    print("\nCaricamento completato.")
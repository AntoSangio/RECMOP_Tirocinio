"""
Importazione di un pacchetto RECMOP nella base di dati.

A differenza dello script di caricamento, qui l'importazione è una funzione
richiamabile dal server: riceve la cartella di un pacchetto già estratto,
ne riconosce comune e scenario, e restituisce il resoconto dell'operazione.
"""

import csv
import json
import re
from pathlib import Path


def riconosci_pacchetto(cartella: Path):
    """
    Ricava comune e scenario dal nome della cartella del pacchetto.
    Esempio: 'student_package_avellino_ambientale' -> ('avellino', 'ambientale')
    """
    nome = cartella.name.lower()
    corrispondenza = re.match(r"(?:student_)?package_(.+)_(ambientale|energetico|economico|sociale)$", nome)
    if not corrispondenza:
        return None, None
    return corrispondenza.group(1), corrispondenza.group(2)


def verifica_pacchetto(cartella: Path):
    """
    Controlla che il pacchetto contenga i file attesi.
    Restituisce la lista dei problemi riscontrati: vuota se è tutto a posto.
    """
    problemi = []
    attesi = [
        "data/geojson/all_buildings_base.geojson",
        "data/geojson/peb_initial.geojson",
        "data/geojson/neb_initial.geojson",
        "data/tables/successful_cer_configurations.csv",
        "data/tables/failed_cer_configurations.csv",
    ]
    for relativo in attesi:
        if not (cartella / relativo).exists():
            problemi.append(f"File mancante: {relativo}")
    return problemi


def _numero(valore):
    """Converte in numero, restituendo None se il campo è vuoto."""
    return float(valore) if valore not in (None, "") else None


def _carica_edifici(cur, comune_id, nome_comune, cartella):
    """Carica gli edifici del comune, con il ruolo PEB/NEB."""
    base = cartella / "data" / "geojson"

    with open(base / "peb_initial.geojson", encoding="utf-8") as f:
        peb = {str(x["properties"]["ID_P"]) for x in json.load(f)["features"]}
    with open(base / "neb_initial.geojson", encoding="utf-8") as f:
        neb = {str(x["properties"]["ID_N"]) for x in json.load(f)["features"]}
    with open(base / "all_buildings_base.geojson", encoding="utf-8") as f:
        edifici = json.load(f)["features"]

    cur.execute("DELETE FROM edificio WHERE comune_id = %s", (comune_id,))
    senza_ruolo = 0

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
                comune, comune_id, id_edificio, classe_energetica,
                domanda_annua, produzione_annua,
                num_pannelli, potenza_picco, ruolo, geom
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                      ST_Multi(ST_GeomFromGeoJSON(%s)))
            """,
            (
                nome_comune, comune_id, int(p["ID_Edificio"]),
                p.get("classe_energetica"), p.get("D_an2023"), p.get("O_an2023"),
                p.get("Num_Pannelli"), p.get("Potenza_Picco"), ruolo,
                json.dumps(e["geometry"]),
            ),
        )

    return {"edifici": len(edifici), "peb": len(peb), "neb": len(neb),
            "senza_ruolo": senza_ruolo}


def _carica_cer(cur, scenario_id, percorso_csv, esito, chiave_edificio):
    """Carica le CER di un file (riuscite o fallite) con membri e dati mensili."""
    with open(percorso_csv, newline="", encoding="utf-8") as f:
        righe = list(csv.DictReader(f))

    n_cer = n_membri = n_mensili = mancanti = 0

    for r in righe:
        codice_cer = r["ID_Edificio"]      # in questo file il campo contiene il codice CER
        membri = codice_cer.split("_")

        cur.execute(
            """
            INSERT INTO cer (
                scenario_id, codice, esito, n_membri, iterazione,
                domanda_annua, autoconsumo_fisico, autoconsumo_diffuso,
                eccedenza, indice
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                scenario_id, codice_cer, esito, len(membri),
                int(float(r["iterazione"])) if r.get("iterazione") else None,
                _numero(r.get("D_an")), _numero(r.get("AF_an")),
                _numero(r.get("AD_an")), _numero(r.get("Sto_an")),
                _numero(r.get("Indice")),
            ),
        )
        cer_id = cur.fetchone()["id"]
        n_cer += 1

        for m in membri:
            if m in chiave_edificio:
                cur.execute(
                    "INSERT INTO cer_membro (cer_id, edificio_id) VALUES (%s, %s)"
                    " ON CONFLICT DO NOTHING",
                    (cer_id, chiave_edificio[m]),
                )
                n_membri += 1
            else:
                mancanti += 1

        for mese in range(1, 13):
            af = _numero(r.get(f"AF_ms{mese}"))
            ad = _numero(r.get(f"AD_ms{mese}"))
            if af is None and ad is None:
                continue
            cur.execute(
                """
                INSERT INTO cer_mensile (cer_id, mese, autoconsumo_fisico, autoconsumo_diffuso)
                VALUES (%s, %s, %s, %s)
                """,
                (cer_id, mese, af, ad),
            )
            n_mensili += 1

    return {"cer": n_cer, "membri": n_membri, "mensili": n_mensili,
            "membri_sconosciuti": mancanti}


def importa_pacchetto(conn, cartella: Path, nome_comune=None, provincia=None):
    """
    Importa un pacchetto nella base di dati.
    Restituisce un resoconto con i conteggi e gli eventuali avvisi.
    """
    codice_comune, codice_scenario = riconosci_pacchetto(cartella)
    if not codice_comune:
        raise ValueError(
            "Nome del pacchetto non riconosciuto. "
            "Atteso un nome come 'package_<comune>_<scenario>'."
        )

    problemi = verifica_pacchetto(cartella)
    if problemi:
        raise ValueError("Pacchetto incompleto: " + "; ".join(problemi))

    nome_comune = nome_comune or codice_comune.capitalize()
    avvisi = []

    with conn.cursor() as cur:
        # Comune
        cur.execute(
            """
            INSERT INTO comune (codice, nome, provincia) VALUES (%s, %s, %s)
            ON CONFLICT (codice) DO UPDATE SET nome = EXCLUDED.nome
            RETURNING id
            """,
            (codice_comune, nome_comune, provincia),
        )
        comune_id = cur.fetchone()["id"]

        # Edifici: si caricano solo se il comune non ne ha già
        cur.execute("SELECT COUNT(*) AS n FROM edificio WHERE comune_id = %s", (comune_id,))
        gia_presenti = cur.fetchone()["n"]

        if gia_presenti:
            conteggi_edifici = {"edifici": gia_presenti, "nota": "già presenti"}
        else:
            conteggi_edifici = _carica_edifici(cur, comune_id, nome_comune, cartella)
            if conteggi_edifici["senza_ruolo"]:
                avvisi.append(
                    f"{conteggi_edifici['senza_ruolo']} edifici senza ruolo energetico assegnato"
                )

        # Scenario: sostituisce quello eventualmente già presente
        cur.execute(
            "DELETE FROM scenario WHERE codice = %s AND comune_id = %s",
            (codice_scenario, comune_id),
        )
        cur.execute(
            """
            INSERT INTO scenario (codice, nome, comune, comune_id)
            VALUES (%s, %s, %s, %s) RETURNING id
            """,
            (codice_scenario, f"Scenario {codice_scenario}", nome_comune, comune_id),
        )
        scenario_id = cur.fetchone()["id"]

        cur.execute(
            "SELECT id_edificio, id FROM edificio WHERE comune_id = %s", (comune_id,)
        )
        chiave_edificio = {str(r["id_edificio"]): r["id"] for r in cur.fetchall()}

        tabelle = cartella / "data" / "tables"
        riuscite = _carica_cer(cur, scenario_id, tabelle / "successful_cer_configurations.csv",
                               "riuscita", chiave_edificio)
        fallite = _carica_cer(cur, scenario_id, tabelle / "failed_cer_configurations.csv",
                              "fallita", chiave_edificio)

        sconosciuti = riuscite["membri_sconosciuti"] + fallite["membri_sconosciuti"]
        if sconosciuti:
            avvisi.append(f"{sconosciuti} riferimenti a edifici non presenti nel comune")

    conn.commit()

    return {
        "comune": {"codice": codice_comune, "nome": nome_comune},
        "scenario": codice_scenario,
        "edifici": conteggi_edifici,
        "cer_riuscite": riuscite,
        "cer_fallite": fallite,
        "avvisi": avvisi,
    }
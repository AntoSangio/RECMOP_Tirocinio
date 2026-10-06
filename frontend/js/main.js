/**
 * Avvio dell'applicazione: carica i dati dal server e collega i moduli.
 */

import { creaMappa, disegnaEdifici, evidenziaComunita } from "./mappa.js";

const API = "http://127.0.0.1:8000/api";
const SCENARIO = "ambientale";

const pannello = document.getElementById("pannello");

async function avvia() {
  creaMappa();

  try {
    const risposta = await fetch(`${API}/edifici`);
    const geojson = await risposta.json();

    disegnaEdifici(geojson, mostraEdificio);

    pannello.innerHTML = `
      <p class="messaggio">
        ${geojson.features.length} edifici caricati.<br>
        Clicca un edificio sulla mappa per vedere la sua comunità energetica.
      </p>`;
  } catch (errore) {
    pannello.innerHTML = `
      <p class="messaggio">
        Impossibile contattare il server.<br>
        Verifica che sia avviato su ${API}.
      </p>`;
    console.error(errore);
  }
}

async function mostraEdificio(idEdificio) {
  pannello.innerHTML = `<p class="messaggio">Caricamento…</p>`;

  const risposta = await fetch(`${API}/edificio/${idEdificio}/cer/${SCENARIO}`);
  const dati = await risposta.json();
  const e = dati.edificio;

  let html = `
    <h2 style="font-size:17px; margin:0 0 4px;">Edificio ${e.id_edificio}</h2>
    <p class="messaggio">
      Ruolo: <b>${e.ruolo}</b> · Classe ${e.classe_energetica}<br>
      Domanda annua: ${Math.round(e.domanda_annua).toLocaleString("it-IT")} kWh
    </p>`;

  if (!dati.in_comunita) {
    html += `<p class="messaggio">Questo edificio non fa parte di una comunità energetica costituita.</p>`;
    pannello.innerHTML = html;
    evidenziaComunita(idEdificio, []);
    return;
  }

  const c = dati.comunita.comunita;
  const membri = dati.comunita.membri;

  html += `
    <h3 style="font-size:15px; margin:16px 0 6px;">La sua comunità</h3>
    <p class="messaggio">
      ${c.n_membri} edifici · indice ${c.indice?.toFixed(2) ?? "n.d."}<br>
      Energia condivisa: ${Math.round(c.autoconsumo_diffuso).toLocaleString("it-IT")} kWh<br>
      CO₂ evitata: ${dati.comunita.comunita.co2_evitata_kg.toLocaleString("it-IT")} kg
    </p>
    <p class="messaggio"><b>Membri:</b><br>
      ${membri.map(m => `${m.id_edificio} (${m.ruolo})`).join(", ")}
    </p>`;

  pannello.innerHTML = html;
  evidenziaComunita(idEdificio, membri);
}

avvia();
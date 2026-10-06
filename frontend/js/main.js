/**
 * Avvio dell'applicazione e gestione delle interazioni.
 */

import { creaMappa, disegnaEdifici, evidenziaComunita, pulisci } from "./mappa.js";

const API = "http://127.0.0.1:8000/api";
const SCENARIO = "ambientale";

const scheda = document.getElementById("scheda");
const contenuto = document.getElementById("contenuto");
const avviso = document.getElementById("avviso");

const numero = (n) => Math.round(n ?? 0).toLocaleString("it-IT");

function mostraScheda(html) {
  contenuto.innerHTML = html;
  scheda.hidden = false;
  scheda.scrollTop = 0;
}

function dimmi(testo) {
  avviso.textContent = testo;
  avviso.hidden = false;
}

// --- Avvio ---

async function avvia() {
  creaMappa();

  try {
    const risposta = await fetch(`${API}/edifici`);
    const geojson = await risposta.json();
    disegnaEdifici(geojson, apriEdificio);
    dimmi(`${geojson.features.length.toLocaleString("it-IT")} edifici sulla mappa`);
    pannelloRicerca();
  } catch (errore) {
    dimmi("Server non raggiungibile. Avvia il backend e ricarica la pagina.");
    console.error(errore);
  }
}

// --- Ricerca ---

function pannelloRicerca() {
  mostraScheda(`
    <h1 class="intestazione">Trova la tua comunità</h1>
    <p class="occhiello">Comune di Avellino, scenario ambientale</p>

    <div class="ricerca">
      <label for="indirizzo">Indirizzo o numero dell'edificio</label>
      <div class="riga">
        <input id="indirizzo" type="text" placeholder="Corso Vittorio Emanuele">
        <button id="cerca">Cerca</button>
      </div>
      <p class="aiuto">
        Cerca il tuo indirizzo per scoprire se l'edificio fa parte di una comunità
        energetica e con quali altri edifici condivide l'energia.
      </p>
    </div>`);

  const campo = document.getElementById("indirizzo");
  document.getElementById("cerca").onclick = () => cerca(campo.value);
  campo.onkeydown = (e) => { if (e.key === "Enter") cerca(campo.value); };
  campo.focus();
}

async function cerca(testo) {
  testo = testo.trim();
  if (!testo) return;

  // Se è solo un numero, lo tratto come identificativo dell'edificio
  if (/^\d+$/.test(testo)) return apriEdificio(Number(testo));

  dimmi("Ricerca dell'indirizzo…");
  const query = encodeURIComponent(`${testo}, Avellino, Italia`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`;

  try {
    const risposta = await fetch(url);
    const trovati = await risposta.json();

    if (!trovati.length) {
      dimmi("Indirizzo non trovato. Prova a essere più preciso o cerca per numero.");
      return;
    }

    const lat = parseFloat(trovati[0].lat);
    const lon = parseFloat(trovati[0].lon);
    const vicino = await fetch(`${API}/edificio-vicino?lat=${lat}&lon=${lon}`).then(r => r.json());

    if (vicino.id_edificio == null) {
      dimmi("Nessun edificio trovato vicino a questo indirizzo.");
      return;
    }

    dimmi(`Edificio più vicino all'indirizzo: ${vicino.id_edificio} (${Math.round(vicino.distanza_m)} m)`);
    apriEdificio(vicino.id_edificio);
  } catch (errore) {
    dimmi("Ricerca non riuscita. Riprova.");
    console.error(errore);
  }
}

// --- Dettaglio di un edificio ---

async function apriEdificio(idEdificio) {
  const dati = await fetch(`${API}/edificio/${idEdificio}/cer/${SCENARIO}`).then(r => r.json());
  const e = dati.edificio;

  let html = `
    <h1 class="intestazione">Edificio ${e.id_edificio}</h1>
    <p class="occhiello">Classe energetica ${e.classe_energetica}</p>
    <span class="ruolo ${e.ruolo.toLowerCase()}">
      ${e.ruolo === "PEB" ? "Produce e consuma energia" : "Consuma energia"}
    </span>

    <div class="dati">
      <div class="dato"><span class="nome">Domanda annua</span>
        <span class="valore">${numero(e.domanda_annua)} kWh</span></div>
      <div class="dato"><span class="nome">Produzione annua</span>
        <span class="valore">${numero(e.produzione_annua)} kWh</span></div>
      <div class="dato"><span class="nome">Pannelli installati</span>
        <span class="valore">${e.num_pannelli ?? 0}</span></div>
    </div>`;

  if (!dati.in_comunita) {
    html += `
      <p class="titoletto">Comunità energetica</p>
      <p class="aiuto">
        Questo edificio non rientra in una comunità costituita in questo scenario.
        Il modello forma una comunità solo quando l'aggregazione supera la soglia di efficienza.
      </p>`;
    mostraScheda(html);
    pulisci();
    return;
  }

  const c = dati.comunita.comunita;
  const membri = dati.comunita.membri;

  html += `
    <p class="titoletto">La sua comunità energetica</p>
    <div class="dati" style="border-top:0; padding-top:0;">
      <div class="dato"><span class="nome">Edifici</span>
        <span class="valore">${c.n_membri}</span></div>
      <div class="dato"><span class="nome">Energia condivisa</span>
        <span class="valore">${numero(c.autoconsumo_diffuso)} kWh</span></div>
      <div class="dato"><span class="nome">Energia eccedente</span>
        <span class="valore">${numero(c.eccedenza)} kWh</span></div>
      <div class="dato"><span class="nome">Emissioni evitate</span>
        <span class="valore">${numero(c.co2_evitata_kg)} kg CO₂</span></div>
    </div>

    <p class="titoletto">Edifici che la compongono</p>
    <div class="membri">
      ${membri.map(m => `
        <span class="membro ${m.ruolo.toLowerCase()}" data-id="${m.id_edificio}">
          ${m.id_edificio}
        </span>`).join("")}
    </div>
    <p class="aiuto">Verde: produce energia. Rosso: la consuma.</p>`;

  mostraScheda(html);
  evidenziaComunita(idEdificio, membri);

  // Cliccando un membro si apre la sua scheda
  contenuto.querySelectorAll(".membro").forEach(el => {
    el.onclick = () => apriEdificio(Number(el.dataset.id));
  });
}

document.getElementById("chiudi").onclick = () => {
  scheda.hidden = true;
  pulisci();
};

avvia();
/**
 * Pagina della mappa: legge comune e scenario dall'indirizzo,
 * carica i dati e gestisce le interazioni.
 */

import { creaMappa, disegnaEdifici, evidenziaComunita, pulisci } from "./mappa.js";
import { contenutoTerritorio } from "./viste/territorio.js";

const API = "http://127.0.0.1:8000/api";

// Comune e scenario arrivano dalla pagina iniziale
const parametri = new URLSearchParams(location.search);
const comune = parametri.get("comune") || "avellino";
let scenario = parametri.get("scenario") || "ambientale";

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
  // Dati del comune: nome e centro della mappa
  const comuni = await fetch(`${API}/comuni`).then(r => r.json());
  const datiComune = comuni.find(c => c.codice === comune);

  if (!datiComune) {
    document.body.innerHTML = `<p style="padding:40px">Comune non trovato.</p>`;
    return;
  }

  document.title = `RECMOP — ${datiComune.nome}`;
  creaMappa([datiComune.lat, datiComune.lon]);
  costruisciSceltaScenario(datiComune.scenari);

  try {
    const geojson = await fetch(`${API}/${comune}/edifici`).then(r => r.json());
    disegnaEdifici(geojson, apriEdificio);
    dimmi(`${datiComune.nome}: ${numero(geojson.features.length)} edifici`);
    pannelloRicerca(datiComune.nome);
  } catch (errore) {
    dimmi("Server non raggiungibile. Avvia il backend e ricarica la pagina.");
    console.error(errore);
  }
}

function costruisciSceltaScenario(scenari) {
  const contenitore = document.getElementById("scelta-scenario");
  contenitore.innerHTML = `<span class="dicitura">Scenario</span>` +
    scenari.map(s => `
      <button class="scelta ${s.codice === scenario ? "attiva" : ""}" data-scenario="${s.codice}">
        ${s.codice.charAt(0).toUpperCase() + s.codice.slice(1)}
      </button>`).join("");

  contenitore.querySelectorAll(".scelta").forEach(pulsante => {
    pulsante.onclick = () => {
      contenitore.querySelectorAll(".scelta").forEach(p => p.classList.remove("attiva"));
      pulsante.classList.add("attiva");
      scenario = pulsante.dataset.scenario;
      dimmi(`Scenario ${scenario}: cambiano le comunità, gli edifici restano gli stessi.`);
      document.querySelector(".voce.attiva")?.click();
    };
  });
}

// --- Ricerca ---

function pannelloRicerca(nomeComune) {
  mostraScheda(`
    <h1 class="intestazione">Trova la tua comunità</h1>
    <p class="occhiello">${nomeComune}, scenario ${scenario}</p>

    <div class="ricerca">
      <label for="indirizzo">Indirizzo o numero dell'edificio</label>
      <div class="riga">
        <input id="indirizzo" type="text" placeholder="Via Roma">
        <button id="cerca">Cerca</button>
      </div>
      <p class="aiuto">
        Cerca il tuo indirizzo per scoprire se l'edificio fa parte di una comunità
        energetica e con quali altri edifici condivide l'energia.
      </p>
    </div>`);

  const campo = document.getElementById("indirizzo");
  document.getElementById("cerca").onclick = () => cerca(campo.value, nomeComune);
  campo.onkeydown = (e) => { if (e.key === "Enter") cerca(campo.value, nomeComune); };
  campo.focus();
}

async function cerca(testo, nomeComune) {
  testo = testo.trim();
  if (!testo) return;

  if (/^\d+$/.test(testo)) return apriEdificio(Number(testo));

  dimmi("Ricerca dell'indirizzo…");
  const query = encodeURIComponent(`${testo}, ${nomeComune}, Italia`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`;

  try {
    const trovati = await fetch(url).then(r => r.json());
    if (!trovati.length) {
      dimmi("Indirizzo non trovato. Prova a essere più preciso o cerca per numero.");
      return;
    }

    const lat = parseFloat(trovati[0].lat);
    const lon = parseFloat(trovati[0].lon);
    const vicino = await fetch(`${API}/${comune}/edificio-vicino?lat=${lat}&lon=${lon}`)
      .then(r => r.json());

    if (vicino.id_edificio == null) {
      dimmi("Nessun edificio trovato vicino a questo indirizzo.");
      return;
    }

    dimmi(`Edificio più vicino: ${vicino.id_edificio} (${Math.round(vicino.distanza_m)} m dall'indirizzo)`);
    apriEdificio(vicino.id_edificio);
  } catch (errore) {
    dimmi("Ricerca non riuscita. Riprova.");
    console.error(errore);
  }
}

// --- Dettaglio di un edificio ---

async function apriEdificio(idEdificio) {
  const dati = await fetch(`${API}/${comune}/edificio/${idEdificio}/cer/${scenario}`)
    .then(r => r.json());
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

  contenuto.querySelectorAll(".membro").forEach(el => {
    el.onclick = () => apriEdificio(Number(el.dataset.id));
  });
}

async function apriComunita(codice) {
  const dati = await fetch(`${API}/${comune}/cer/${scenario}/${codice}`).then(r => r.json());
  if (dati.membri?.length) {
    evidenziaComunita(dati.membri[0].id_edificio, dati.membri);
  }
}

// --- Navigazione tra le sezioni ---

document.querySelectorAll(".voce").forEach(voce => {
  voce.onclick = async () => {
    document.querySelectorAll(".voce").forEach(v => v.classList.remove("attiva"));
    voce.classList.add("attiva");

    const sezione = voce.dataset.sezione;
    const comuni = await fetch(`${API}/comuni`).then(r => r.json());
    const nomeComune = comuni.find(c => c.codice === comune)?.nome ?? comune;

    if (sezione === "cerca") {
      pulisci();
      pannelloRicerca(nomeComune);
    }

    if (sezione === "territorio") {
      mostraScheda(`<p class="aiuto">Caricamento…</p>`);
      pulisci();
      mostraScheda(await contenutoTerritorio(comune, scenario, nomeComune));
      contenuto.querySelectorAll(".tabella tbody tr").forEach(riga => {
        riga.onclick = () => apriComunita(riga.dataset.codice);
      });
    }

    if (sezione === "metodo") {
      pulisci();
      mostraScheda(`
        <h1 class="intestazione">Come nascono i dati</h1>
        <p class="occhiello">Modello RECMOP</p>
        <p class="aiuto">
          Il modello calcola per ogni edificio la domanda e la produzione di energia,
          classificandolo come produttore (PEB) o consumatore (NEB). Aggrega poi
          progressivamente gli edifici in comunità, accettando solo le aggregazioni
          che superano una soglia di efficienza; le altre vengono ricomposte e
          ritentate nelle iterazioni successive.
        </p>
        <p class="aiuto">
          Questa applicazione non esegue i calcoli: ne consulta i risultati.
        </p>`);
    }
  };
});

document.getElementById("chiudi").onclick = () => {
  scheda.hidden = true;
  pulisci();
};

avvia();
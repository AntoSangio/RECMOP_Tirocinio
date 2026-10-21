/**
 * Vista territorio: quadro d'insieme per l'amministrazione comunale,
 * con filtri sull'elenco delle comunità e confronto fra due di esse.
 */

import { graficoDimensioni, graficoIterazioni } from "../grafici.js";

const API = "http://127.0.0.1:8000/api";
const numero = (n) => Math.round(n ?? 0).toLocaleString("it-IT");

// Elenco completo delle comunità, usato dai filtri senza richiederlo di nuovo
let comunitaComplete = [];
let contestoAttuale = {};

export async function contenutoTerritorio(comune, scenario, nomeComune) {
  const [kpi, elenco, confronto, distribuzioni] = await Promise.all([
    fetch(`${API}/${comune}/kpi/${scenario}`).then(r => r.json()),
    fetch(`${API}/${comune}/cer/${scenario}`).then(r => r.json()),
    fetch(`${API}/${comune}/confronto`).then(r => r.json()),
    fetch(`${API}/${comune}/distribuzioni/${scenario}`).then(r => r.json()),
  ]);

  comunitaComplete = elenco;
  contestoAttuale = { comune, scenario };

  const dimensioni = [...new Set(elenco.map(c => c.n_membri))].sort((a, b) => a - b);

  const confrontoRighe = confronto.map(s => `
    <div class="dato">
      <span class="nome">${s.scenario}</span>
      <span class="valore">${s.riuscite} comunità · ${numero(s.energia_condivisa)} kWh</span>
    </div>`).join("");

  const html = `
    <h1 class="intestazione">Il territorio</h1>
    <p class="occhiello">${nomeComune}, scenario ${scenario}</p>

    <div class="cifre">
      <div class="cifra">
        <span class="grande">${numero(kpi.totale)}</span>
        <span class="minuta">edifici censiti</span>
      </div>
      <div class="cifra">
        <span class="grande">${numero(kpi.riuscite)}</span>
        <span class="minuta">comunità costituite</span>
      </div>
      <div class="cifra">
        <span class="grande">${kpi.copertura_percentuale}%</span>
        <span class="minuta">edifici coinvolti</span>
      </div>
      <div class="cifra">
        <span class="grande">${numero(kpi.fallite)}</span>
        <span class="minuta">aggregazioni non riuscite</span>
      </div>
    </div>

    <p class="titoletto">Produttori e consumatori</p>
    <div class="dati" style="border-top:0; padding-top:0;">
      <div class="dato"><span class="nome">Edifici che producono (PEB)</span>
        <span class="valore">${numero(kpi.peb)}</span></div>
      <div class="dato"><span class="nome">Edifici che consumano (NEB)</span>
        <span class="valore">${numero(kpi.neb)}</span></div>
    </div>

    <p class="titoletto">I due scenari a confronto</p>
    <div class="dati" style="border-top:0; padding-top:0;">${confrontoRighe}</div>

    <p class="titoletto">Quanto sono grandi le comunità</p>
    <div class="grafico"><canvas id="dimensioni"></canvas></div>
    <p class="didascalia">
      Numero di comunità per quantità di edifici che le compongono.
    </p>

    <p class="titoletto">Come procede l'aggregazione</p>
    <div class="grafico"><canvas id="iterazioni"></canvas></div>
    <p class="didascalia">
      A ogni iterazione il modello tenta nuove aggregazioni: le prime sono le più
      vantaggiose, poi restano edifici via via più difficili da combinare.
    </p>

    <p class="titoletto">Le comunità costituite</p>

    <div class="filtri">
      <div class="filtro">
        <label for="filtro-dimensione">Numero di edifici</label>
        <select id="filtro-dimensione">
          <option value="">tutte</option>
          ${dimensioni.map(d => `<option value="${d}">${d} edifici</option>`).join("")}
        </select>
      </div>
      <div class="filtro">
        <label for="filtro-ordine">Ordina per</label>
        <select id="filtro-ordine">
          <option value="energia">energia condivisa</option>
          <option value="membri">numero di edifici</option>
          <option value="indice">indice</option>
        </select>
      </div>
      <div class="filtro ampio">
        <label for="filtro-codice">Cerca una comunità</label>
        <input id="filtro-codice" type="text" placeholder="numero di un edificio">
      </div>
    </div>

    <table class="tabella tabella-cer">
      <thead>
        <tr>
          <th>Comunità</th>
          <th class="num">Edifici</th>
          <th class="num">kWh condivisi</th>
          <th class="num">Confronta</th>
        </tr>
      </thead>
      <tbody id="righe-cer"></tbody>
    </table>
    <p class="aiuto" id="conteggio-cer"></p>

    <div id="esito-confronto"></div>`;

  return { html, distribuzioni };
}


/** Disegna i grafici della vista: va chiamata dopo aver inserito l'HTML. */
export function graficiTerritorio(distribuzioni) {
  const d = document.getElementById("dimensioni");
  if (d) graficoDimensioni(d, distribuzioni.dimensione_cer);

  const i = document.getElementById("iterazioni");
  if (i) graficoIterazioni(i, distribuzioni.iterazioni);
}


/**
 * Attiva filtri, ordinamento e confronto sull'elenco delle comunità.
 * `alClick` apre una comunità sulla mappa.
 */
export function attivaTabellaCer(alClick) {
  const corpo = document.getElementById("righe-cer");
  const conteggio = document.getElementById("conteggio-cer");
  const perDimensione = document.getElementById("filtro-dimensione");
  const perOrdine = document.getElementById("filtro-ordine");
  const perCodice = document.getElementById("filtro-codice");
  const esito = document.getElementById("esito-confronto");
  if (!corpo) return;

  let selezionate = [];

  function filtra() {
    let righe = [...comunitaComplete];

    const dimensione = perDimensione.value;
    if (dimensione) righe = righe.filter(c => String(c.n_membri) === dimensione);

    const cercato = perCodice.value.trim();
    if (cercato) righe = righe.filter(c => c.codice.split("_").includes(cercato));

    const ordine = perOrdine.value;
    righe.sort((a, b) =>
      ordine === "membri" ? b.n_membri - a.n_membri
      : ordine === "indice" ? (b.indice ?? 0) - (a.indice ?? 0)
      : (b.autoconsumo_diffuso ?? 0) - (a.autoconsumo_diffuso ?? 0));

    disegna(righe);
  }

  function disegna(righe) {
    const mostrate = righe.slice(0, 60);
    corpo.innerHTML = mostrate.map(c => `
      <tr data-codice="${c.codice}">
        <td class="codice">${c.codice}</td>
        <td class="num">${c.n_membri}</td>
        <td class="num">${numero(c.autoconsumo_diffuso)}</td>
        <td class="num">
          <input type="checkbox" class="scegli" data-codice="${c.codice}"
                 ${selezionate.includes(c.codice) ? "checked" : ""}>
        </td>
      </tr>`).join("");

    conteggio.textContent = righe.length > 60
      ? `Mostrate 60 comunità su ${righe.length}. Restringi la ricerca per vederne altre.`
      : `${righe.length} comunità. Clicca una riga per vederla sulla mappa, o spunta due comunità per confrontarle.`;

    corpo.querySelectorAll("tr").forEach(riga => {
      riga.onclick = (evento) => {
        if (evento.target.classList.contains("scegli")) return;
        alClick(riga.dataset.codice);
      };
    });

    corpo.querySelectorAll(".scegli").forEach(casella => {
      casella.onchange = () => {
        const codice = casella.dataset.codice;
        if (casella.checked) {
          selezionate.push(codice);
          if (selezionate.length > 2) {
            const rimossa = selezionate.shift();
            const altra = corpo.querySelector(`.scegli[data-codice="${rimossa}"]`);
            if (altra) altra.checked = false;
          }
        } else {
          selezionate = selezionate.filter(c => c !== codice);
        }

        if (selezionate.length === 2) mostraConfronto(selezionate, esito);
        else esito.innerHTML = "";
      };
    });
  }

  perDimensione.onchange = filtra;
  perOrdine.onchange = filtra;
  perCodice.oninput = filtra;

  filtra();
}


async function mostraConfronto([codiceA, codiceB], contenitore) {
  const { comune, scenario } = contestoAttuale;
  contenitore.innerHTML = `<p class="aiuto">Confronto in corso…</p>`;

  const dati = await fetch(
    `${API}/${comune}/cer/${scenario}/${codiceA}/confronta/${codiceB}`
  ).then(r => r.json());

  const a = dati.prima.comunita;
  const b = dati.seconda.comunita;
  const membriA = dati.prima.membri;
  const membriB = dati.seconda.membri;

  const conta = (membri, ruolo) => membri.filter(m => m.ruolo === ruolo).length;

  const riga = (etichetta, valoreA, valoreB) => `
    <tr>
      <th>${etichetta}</th>
      <td class="${valoreA.grezzo > valoreB.grezzo ? "migliore" : ""}">${valoreA.testo}</td>
      <td class="${valoreB.grezzo > valoreA.grezzo ? "migliore" : ""}">${valoreB.testo}</td>
    </tr>`;

  const v = (n, suffisso = "") => ({ grezzo: n ?? 0, testo: numero(n) + suffisso });

  contenitore.innerHTML = `
    <p class="titoletto">Confronto</p>
    <table class="tabella confronto-cer">
      <thead>
        <tr><th></th><th>${codiceA}</th><th>${codiceB}</th></tr>
      </thead>
      <tbody>
        ${riga("Edifici", v(a.n_membri), v(b.n_membri))}
        ${riga("di cui producono", v(conta(membriA, "PEB")), v(conta(membriB, "PEB")))}
        ${riga("di cui consumano", v(conta(membriA, "NEB")), v(conta(membriB, "NEB")))}
        ${riga("Energia condivisa", v(a.autoconsumo_diffuso, " kWh"), v(b.autoconsumo_diffuso, " kWh"))}
        ${riga("Energia eccedente", v(a.eccedenza, " kWh"), v(b.eccedenza, " kWh"))}
        ${riga("Emissioni evitate", v(a.co2_evitata_kg, " kg"), v(b.co2_evitata_kg, " kg"))}
        ${riga("Estensione", v(a.distanza_massima_m, " m"), v(b.distanza_massima_m, " m"))}
      </tbody>
    </table>
    <p class="aiuto">In grassetto il valore più alto. Togli una spunta per confrontare altre comunità.</p>`;
}
/**
 * Gestione della mappa: inizializzazione, sfondi, livelli, stili,
 * rappresentazioni tematiche e flusso di energia.
 *
 * Lo stile di ciascun edificio dipende da tre fattori che si combinano:
 * il tema attivo, i filtri di visibilità e l'eventuale appartenenza alla
 * comunità selezionata. Per evitare che si sovrascrivano a vicenda, è
 * un'unica funzione (ridisegna) ad applicarli nell'ordine corretto.
 */

const ZOOM = 14;

const STILI = {
  normale: { color: "#2563eb", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.35 },
  peb:     { color: "#0b4f22", weight: 2.5, fillColor: "#16a34a", fillOpacity: 0.85 },
  neb:     { color: "#7a1010", weight: 2.5, fillColor: "#dc2626", fillOpacity: 0.85 },
};

const SFONDI = {
  standard: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap",
  },
  chiaro: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "© OpenStreetMap, © CARTO",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri, Maxar, Earthstar Geographics",
  },
};

// Scala per la classe energetica: riprende la convenzione delle etichette
const COLORI_CLASSE = {
  "A4": "#1a9850", "A3": "#3fab5a", "A2": "#66bd63", "A1": "#8bcf6a",
  "A":  "#66bd63", "B": "#a6d96a", "C": "#d9ef8b", "D": "#fee08b",
  "E":  "#fdae61", "F": "#f46d43", "G": "#d73027",
};

// Scala sequenziale per le grandezze continue
const SCALA = ["#dbe0f7", "#b6bfee", "#8e9be3", "#6b79d6", "#4f5dd8", "#343fa6"];
const SENZA_VALORE = "#d7dbe3";

let mappa;
let stratoEdifici;
let sfondoAttivo;
let stratoComunita;
let controlloLegenda;

const edificiPerId = {};
const disegni = [];           // linee e frecce del flusso di energia

let filtriAttivi = null;      // ultimi filtri applicati
let temaAttivo = "nessuno";
let soglie = null;            // limiti delle classi del tema attivo
let membriEvidenziati = [];   // membri della comunità selezionata
let idSelezionato = null;


export function creaMappa(centro) {
  mappa = L.map("mappa").setView(centro, ZOOM);
  cambiaSfondo("standard");
  aggiungiLegenda();
  return mappa;
}


/** Cambia la cartografia di sfondo. */
export function cambiaSfondo(nome) {
  const scelto = SFONDI[nome] ?? SFONDI.standard;
  if (sfondoAttivo) mappa.removeLayer(sfondoAttivo);
  sfondoAttivo = L.tileLayer(scelto.url, {
    attribution: scelto.attribution,
    maxZoom: 19,
  }).addTo(mappa);
  sfondoAttivo.bringToBack();
}


export function disegnaEdifici(geojson, alClick) {
  stratoEdifici = L.geoJSON(geojson, {
    style: STILI.normale,
    onEachFeature: (elemento, livello) => {
      const id = elemento.properties.id_edificio;
      edificiPerId[id] = livello;
      livello.on("click", () => alClick(id));
    },
  }).addTo(mappa);

  return stratoEdifici;
}


/* ------------------------------------------------------------------ */
/*  Disegno degli edifici                                             */
/* ------------------------------------------------------------------ */

/**
 * Applica a ogni edificio lo stile risultante da tema, filtri
 * ed eventuale appartenenza alla comunità selezionata.
 */
function ridisegna() {
  if (!stratoEdifici) return;

  const ruoloDi = {};
  for (const m of membriEvidenziati) ruoloDi[m.id_edificio] = m.ruolo;

  stratoEdifici.eachLayer(livello => {
    const p = livello.feature.properties;
    const visibile = edificioVisibile(p);

    let stile;

    if (ruoloDi[p.id_edificio]) {
      // I membri della comunità selezionata conservano il colore del ruolo
      stile = { ...(ruoloDi[p.id_edificio] === "PEB" ? STILI.peb : STILI.neb) };
    } else if (temaAttivo !== "nessuno") {
      stile = {
        color: "#8c93a1",
        weight: 0.6,
        fillColor: coloreTema(p),
        fillOpacity: 0.85,
      };
    } else {
      stile = { ...STILI.normale };
    }

    if (!visibile) {
      stile.opacity = 0;
      stile.fillOpacity = 0;
    } else if (stile.opacity === undefined) {
      stile.opacity = 1;
    }

    livello.setStyle(stile);
    if (livello._path) livello._path.style.pointerEvents = visibile ? "" : "none";
  });

  // L'edificio selezionato ha un bordo scuro che lo distingue
  if (idSelezionato && edificiPerId[idSelezionato]) {
    edificiPerId[idSelezionato].setStyle({ color: "#111", weight: 3 });
    edificiPerId[idSelezionato].bringToFront();
  }
}


function edificioVisibile(p) {
  if (!filtriAttivi) return true;

  const perRuolo = p.ruolo === "PEB" ? filtriAttivi.peb : filtriAttivi.neb;

  let perPartecipazione;
  if (p.in_riuscita) perPartecipazione = filtriAttivi.riuscita;
  else if (p.in_fallita) perPartecipazione = filtriAttivi.fallita;
  else perPartecipazione = filtriAttivi.esclusi;

  return perRuolo && perPartecipazione;
}


export function applicaFiltri(filtri) {
  filtriAttivi = filtri;
  ridisegna();
}


/* ------------------------------------------------------------------ */
/*  Rappresentazioni tematiche                                        */
/* ------------------------------------------------------------------ */

/**
 * Colora gli edifici secondo un attributo. Le classi delle grandezze
 * continue sono calcolate per quantili, così ogni classe contiene
 * all'incirca lo stesso numero di edifici.
 */
export function applicaTema(tema) {
  temaAttivo = tema;
  soglie = (tema === "nessuno" || tema === "classe") ? null : calcolaQuantili(tema);

  // Il tema riguarda l'intero territorio: la selezione di una comunità
  // verrebbe nascosta, quindi la rimuovo per chiarezza
  if (tema !== "nessuno") {
    membriEvidenziati = [];
    idSelezionato = null;
    while (disegni.length) mappa.removeLayer(disegni.pop());
  }

  ridisegna();
  aggiornaLegenda();
}


function valoreTema(p) {
  if (temaAttivo === "domanda") return p.domanda_annua ?? 0;
  if (temaAttivo === "produzione") return p.produzione_annua ?? 0;
  if (temaAttivo === "potenza") return p.potenza_picco ?? 0;
  return 0;
}


function coloreTema(p) {
  if (temaAttivo === "classe") {
    return COLORI_CLASSE[p.classe_energetica] ?? SENZA_VALORE;
  }

  const valore = valoreTema(p);
  if (valore <= 0) return SENZA_VALORE;
  if (!soglie) return SCALA[0];

  for (let i = 0; i < soglie.length; i++) {
    if (valore <= soglie[i]) return SCALA[i];
  }
  return SCALA[SCALA.length - 1];
}


function calcolaQuantili(tema) {
  const precedente = temaAttivo;
  temaAttivo = tema;

  const valori = [];
  stratoEdifici.eachLayer(l => {
    const v = valoreTema(l.feature.properties);
    if (v > 0) valori.push(v);
  });

  temaAttivo = precedente;
  if (!valori.length) return null;

  valori.sort((a, b) => a - b);
  const limiti = [];
  for (let i = 1; i <= SCALA.length; i++) {
    limiti.push(valori[Math.floor((valori.length - 1) * i / SCALA.length)]);
  }
  return limiti;
}


/* ------------------------------------------------------------------ */
/*  Selezione di una comunità                                         */
/* ------------------------------------------------------------------ */

export function evidenziaComunita(idSelezionatoNuovo, membri) {
  while (disegni.length) mappa.removeLayer(disegni.pop());

  membriEvidenziati = membri ?? [];
  idSelezionato = idSelezionatoNuovo;
  ridisegna();

  const livelli = membriEvidenziati
    .map(m => edificiPerId[m.id_edificio])
    .filter(Boolean);

  const produttori = membriEvidenziati
    .filter(m => m.ruolo === "PEB")
    .map(m => edificiPerId[m.id_edificio]).filter(Boolean);
  const consumatori = membriEvidenziati
    .filter(m => m.ruolo === "NEB")
    .map(m => edificiPerId[m.id_edificio]).filter(Boolean);

  disegnaFlusso(produttori, consumatori);

  if (livelli.length) {
    const gruppo = L.featureGroup(livelli);
    mappa.fitBounds(gruppo.getBounds(), { padding: [60, 60], maxZoom: 18 });
  }
}


/**
 * Evidenzia un singolo edificio, senza comunità: serve quando
 * l'edificio selezionato non appartiene ad alcun gruppo.
 */
export function evidenziaSingolo(idEdificio) {
  while (disegni.length) mappa.removeLayer(disegni.pop());
  membriEvidenziati = [];
  idSelezionato = idEdificio;
  ridisegna();

  const livello = edificiPerId[idEdificio];
  if (!livello) return;

  livello.setStyle({ color: "#111", weight: 3, fillColor: "#9aa1ad", fillOpacity: 0.85 });
  livello.bringToFront();
  mappa.setView(livello.getBounds().getCenter(), 17);
}


/**
 * Mette temporaneamente in risalto un edificio, per identificarlo
 * quando due membri della comunità sono vicini o sovrapposti.
 */
export function indicaEdificio(idEdificio, attivo) {
  const livello = edificiPerId[idEdificio];
  if (!livello) return;

  if (attivo) {
    livello.setStyle({ color: "#4f5dd8", weight: 4 });
    livello.bringToFront();
  } else {
    ridisegna();
  }
}


export function pulisci() {
  membriEvidenziati = [];
  idSelezionato = null;
  while (disegni.length) mappa.removeLayer(disegni.pop());
  ridisegna();
}


/**
 * Disegna il flusso di energia: una linea orientata da ogni produttore
 * verso ogni consumatore della comunità.
 */
function disegnaFlusso(produttori, consumatori) {
  if (!produttori.length || !consumatori.length) return;

  const linee = [];

  for (const p of produttori) {
    const partenza = p.getBounds().getCenter();
    for (const c of consumatori) {
      const arrivo = c.getBounds().getCenter();
      const linea = L.polyline([partenza, arrivo], {
        color: "#1c2230",
        weight: 1,
        opacity: 0.45,
        interactive: false,
      }).addTo(mappa);
      disegni.push(linea);
      linee.push(linea);
    }
  }

  // Le punte si disegnano dopo, così restano allineate anche dopo lo zoom
  setTimeout(() => {
    for (const linea of linee) {
      const freccia = L.polylineDecorator(linea, {
        patterns: [{
          offset: "100%",
          repeat: 0,
          symbol: L.Symbol.arrowHead({
            pixelSize: 7,
            polygon: false,
            pathOptions: { color: "#1c2230", weight: 1, opacity: 0.6 },
          }),
        }],
      }).addTo(mappa);
      disegni.push(freccia);
    }
  }, 300);
}


/* ------------------------------------------------------------------ */
/*  Panoramica delle comunità                                         */
/* ------------------------------------------------------------------ */

/**
 * Mostra tutte le comunità come indicatori posizionati al loro centro.
 * La dimensione è proporzionale all'energia condivisa, cioè al beneficio
 * prodotto dalla comunità, non al semplice numero di edifici.
 */
export function mostraComunita(posizioni, alClick) {
  nascondiComunita();
  if (!posizioni?.length) return;

  stratoComunita = L.layerGroup().addTo(mappa);

  const valori = posizioni.map(p => p.autoconsumo_diffuso ?? 0);
  const massimo = Math.max(...valori, 1);

  const formato = (n) => Math.round(n ?? 0).toLocaleString("it-IT");

  for (const p of posizioni) {
    if (p.lat == null || p.lon == null) continue;

    // La radice quadrata evita che poche comunità molto grandi
    // schiaccino tutte le altre
    const quota = Math.sqrt((p.autoconsumo_diffuso ?? 0) / massimo);
    const raggio = 5 + 16 * quota;

    const indicatore = L.circleMarker([p.lat, p.lon], {
      radius: raggio,
      color: "#0b4f22",
      weight: 1.5,
      fillColor: "#16a34a",
      fillOpacity: 0.5,
    }).addTo(stratoComunita);

    indicatore.bindTooltip(
      `${formato(p.autoconsumo_diffuso)} kWh condivisi · ${p.n_membri} edifici`,
      { direction: "top" }
    );
    indicatore.on("click", () => alClick(p.codice));
  }
}


export function nascondiComunita() {
  if (stratoComunita) {
    mappa.removeLayer(stratoComunita);
    stratoComunita = null;
  }
}


/* ------------------------------------------------------------------ */
/*  Legenda                                                           */
/* ------------------------------------------------------------------ */

function aggiungiLegenda() {
  controlloLegenda = L.control({ position: "bottomright" });
  controlloLegenda.onAdd = () => {
    const div = L.DomUtil.create("div", "legenda");
    div.innerHTML = legendaBase();
    return div;
  };
  controlloLegenda.addTo(mappa);
}


const UNITA = { domanda: "kWh", produzione: "kWh", potenza: "kW" };
const TITOLO = {
  classe: "Classe energetica",
  domanda: "Consumo annuo",
  produzione: "Produzione annua",
  potenza: "Potenza installata",
};


function aggiornaLegenda() {
  if (!controlloLegenda) return;
  const div = controlloLegenda.getContainer();

  if (temaAttivo === "nessuno") {
    div.innerHTML = legendaBase();
    return;
  }

  if (temaAttivo === "classe") {
    const presenti = new Set();
    stratoEdifici.eachLayer(l => presenti.add(l.feature.properties.classe_energetica));
    const voci = Object.keys(COLORI_CLASSE)
      .filter(c => presenti.has(c))
      .map(c => `<div class="voce-legenda">
                   <span class="campione" style="background:${COLORI_CLASSE[c]}"></span> ${c}
                 </div>`).join("");
    div.innerHTML = `<p class="titolo-legenda">${TITOLO.classe}</p>${voci}`;
    return;
  }

  const unita = UNITA[temaAttivo] ?? "";
  const arrotonda = (n) => Math.round(n).toLocaleString("it-IT");
  let precedente = 0;
  const voci = (soglie ?? []).map((limite, i) => {
    const testo = `${arrotonda(precedente)} – ${arrotonda(limite)}`;
    precedente = limite;
    return `<div class="voce-legenda">
              <span class="campione" style="background:${SCALA[i]}"></span> ${testo}
            </div>`;
  }).join("");

  div.innerHTML = `<p class="titolo-legenda">${TITOLO[temaAttivo]} (${unita})</p>${voci}
    <div class="voce-legenda">
      <span class="campione" style="background:${SENZA_VALORE}"></span> nessuno
    </div>`;
}


function legendaBase() {
  return `
    <div class="voce-legenda"><span class="campione" style="background:#3b82f6"></span> Edificio</div>
    <div class="voce-legenda"><span class="campione" style="background:#16a34a"></span> PEB · produce energia</div>
    <div class="voce-legenda"><span class="campione" style="background:#dc2626"></span> NEB · consuma energia</div>
    <div class="voce-legenda"><span class="filetto"></span> Flusso di energia</div>`;
}
/**
 * Gestione della mappa: inizializzazione, sfondi, livelli, stili
 * e rappresentazione del flusso di energia.
 * Il resto dell'applicazione non conosce i dettagli di Leaflet.
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

let mappa;
let stratoEdifici;
let sfondoAttivo;
const edificiPerId = {};
const disegni = [];      // linee e frecce disegnate sulla mappa
let filtriAttivi = null; // ultimi filtri applicati, per ripristinare la visibilità


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


/**
 * Mostra o nasconde gli edifici secondo i filtri attivi.
 * Un edificio resta visibile solo se soddisfa sia il filtro sul ruolo
 * sia quello sulla partecipazione a una comunità.
 */
export function applicaFiltri(filtri) {
  if (!stratoEdifici) return;
  filtriAttivi = filtri;

  stratoEdifici.eachLayer(livello => {
    const visibile = edificioVisibile(livello.feature.properties, filtri);
    livello.setStyle({ opacity: visibile ? 1 : 0, fillOpacity: visibile ? 0.35 : 0 });
    if (livello._path) livello._path.style.pointerEvents = visibile ? "" : "none";
  });
}


function edificioVisibile(p, filtri) {
  if (!filtri) return true;

  const perRuolo = p.ruolo === "PEB" ? filtri.peb : filtri.neb;

  let perPartecipazione;
  if (p.in_riuscita) perPartecipazione = filtri.riuscita;
  else if (p.in_fallita) perPartecipazione = filtri.fallita;
  else perPartecipazione = filtri.esclusi;

  return perRuolo && perPartecipazione;
}


export function evidenziaComunita(idSelezionato, membri) {
  pulisci();

  const daInquadrare = [];
  const produttori = [];
  const consumatori = [];

  // Coloro ogni membro secondo il ruolo energetico
  for (const m of membri) {
    const livello = edificiPerId[m.id_edificio];
    if (!livello) continue;

    livello.setStyle(m.ruolo === "PEB" ? STILI.peb : STILI.neb);
    livello.bringToFront();
    daInquadrare.push(livello);
    (m.ruolo === "PEB" ? produttori : consumatori).push(livello);
  }

  // L'edificio selezionato ha un bordo scuro per distinguerlo
  const selezionato = edificiPerId[idSelezionato];
  if (selezionato) {
    selezionato.setStyle({ color: "#111", weight: 3 });
    if (!daInquadrare.includes(selezionato)) daInquadrare.push(selezionato);
  }

  disegnaFlusso(produttori, consumatori);

  if (daInquadrare.length) {
    const gruppo = L.featureGroup(daInquadrare);
    mappa.fitBounds(gruppo.getBounds(), { padding: [60, 60], maxZoom: 18 });
  }
}


/**
 * Evidenzia un singolo edificio, senza comunità:
 * serve quando l'edificio selezionato non appartiene ad alcun gruppo.
 */
export function evidenziaSingolo(idEdificio) {
  pulisci();

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
    const colore = livello.options.fillColor === "#16a34a" ? "#0b4f22" : "#7a1010";
    livello.setStyle({ color: colore, weight: 2.5 });
  }
}


/**
 * Disegna il flusso di energia: una linea orientata da ogni produttore
 * verso ogni consumatore della comunità. Le linee sono sottili e poco
 * marcate perché in comunità numerose il loro numero cresce rapidamente.
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


export function pulisci() {
  if (stratoEdifici) {
    if (temaAttivo === "nessuno") {
      stratoEdifici.setStyle(STILI.normale);
    } else {
      applicaTema(temaAttivo);   // ridisegna il tema invece dello stile neutro
    }
    if (filtriAttivi) applicaFiltri(filtriAttivi);
  }
  while (disegni.length) mappa.removeLayer(disegni.pop());
}


function aggiungiLegenda() {
  controlloLegenda = L.control({ position: "bottomright" });
  controlloLegenda.onAdd = () => {
    const div = L.DomUtil.create("div", "legenda");
    div.innerHTML = legendaBase();
    return div;
  };
  controlloLegenda.addTo(mappa);
}

/* --- Rappresentazioni tematiche --- */

// Scala per la classe energetica: riprende la convenzione delle etichette
const COLORI_CLASSE = {
  "A4": "#1a9850", "A3": "#3fab5a", "A2": "#66bd63", "A1": "#8bcf6a",
  "A":  "#66bd63", "B": "#a6d96a", "C": "#d9ef8b", "D": "#fee08b",
  "E":  "#fdae61", "F": "#f46d43", "G": "#d73027",
};

// Scala sequenziale per le grandezze continue, dal chiaro allo scuro
const SCALA = ["#f1f3fb", "#c9cfee", "#9ba5e0", "#6e7bd3", "#4f5dd8", "#343fa6"];

let temaAttivo = "nessuno";
let soglie = null;

/**
 * Colora gli edifici secondo un attributo.
 * Le classi delle grandezze continue sono calcolate per quantili,
 * così ogni classe contiene all'incirca lo stesso numero di edifici
 * e la rappresentazione resta leggibile anche con valori estremi.
 */
export function applicaTema(tema) {
  if (!stratoEdifici) return;
  temaAttivo = tema;

  if (tema === "nessuno") {
    soglie = null;
    stratoEdifici.setStyle(STILI.normale);
    if (filtriAttivi) applicaFiltri(filtriAttivi);
    aggiornaLegenda();
    return;
  }

  if (tema !== "classe") {
    soglie = calcolaQuantili(tema);
  }

  stratoEdifici.eachLayer(livello => {
    const p = livello.feature.properties;
    livello.setStyle({
      fillColor: coloreTema(p, tema),
      color: "#9aa1ad",
      weight: 0.5,
      fillOpacity: 0.85,
    });
  });

  if (filtriAttivi) applicaFiltri(filtriAttivi);
  aggiornaLegenda();
}

function valoreTema(p, tema) {
  if (tema === "domanda") return p.domanda_annua ?? 0;
  if (tema === "produzione") return p.produzione_annua ?? 0;
  if (tema === "potenza") return p.potenza_picco ?? 0;
  return 0;
}

function coloreTema(p, tema) {
  if (tema === "classe") {
    return COLORI_CLASSE[p.classe_energetica] ?? "#cbd0da";
  }

  const valore = valoreTema(p, tema);
  if (valore <= 0) return "#e4e7ee";          // nessun impianto o nessun dato
  if (!soglie) return SCALA[0];

  for (let i = 0; i < soglie.length; i++) {
    if (valore <= soglie[i]) return SCALA[i];
  }
  return SCALA[SCALA.length - 1];
}

/** Divide i valori in classi di uguale numerosità. */
function calcolaQuantili(tema) {
  const valori = [];
  stratoEdifici.eachLayer(l => {
    const v = valoreTema(l.feature.properties, tema);
    if (v > 0) valori.push(v);
  });
  valori.sort((a, b) => a - b);
  if (!valori.length) return null;

  const classi = SCALA.length;
  const limiti = [];
  for (let i = 1; i <= classi; i++) {
    limiti.push(valori[Math.floor((valori.length - 1) * i / classi)]);
  }
  return limiti;
}

const UNITA = { domanda: "kWh", produzione: "kWh", potenza: "kW" };
const TITOLO = {
  classe: "Classe energetica",
  domanda: "Consumo annuo",
  produzione: "Produzione annua",
  potenza: "Potenza installata",
};

let controlloLegenda;

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
      <span class="campione" style="background:#e4e7ee"></span> nessuno
    </div>`;
}

function legendaBase() 
{
  return `
    <div class="voce-legenda"><span class="campione" style="background:#3b82f6"></span> Edificio</div>
    <div class="voce-legenda"><span class="campione" style="background:#16a34a"></span> PEB · produce energia</div>
    <div class="voce-legenda"><span class="campione" style="background:#dc2626"></span> NEB · consuma energia</div>
    <div class="voce-legenda"><span class="filetto"></span> Flusso di energia</div>`;
}

/* --- Panoramica delle comunità --- */

let stratoComunita;

/**
 * Mostra tutte le comunità come indicatori posizionati al loro centro.
 * Dà il colpo d'occhio sulla distribuzione territoriale, che la sola
 * colorazione degli edifici non permette a scala di comune.
 */
export function mostraComunita(posizioni, alClick) {
  nascondiComunita();

  stratoComunita = L.layerGroup().addTo(mappa);

  for (const p of posizioni) {
    if (p.lat == null || p.lon == null) continue;

    const indicatore = L.circleMarker([p.lat, p.lon], {
      radius: 6 + Math.min(p.n_membri, 12),
      color: "#0b4f22",
      weight: 1.5,
      fillColor: "#16a34a",
      fillOpacity: 0.55,
    }).addTo(stratoComunita);

    indicatore.bindTooltip(
      `Comunità di ${p.n_membri} edifici`,
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
/**
 * Gestione della mappa: inizializzazione, livelli, stili e flusso di energia.
 * Il resto dell'applicazione non conosce i dettagli di Leaflet.
 */

const ZOOM = 14;

const STILI = {
  normale: { color: "#2563eb", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.35 },
  peb:     { color: "#0b4f22", weight: 2.5, fillColor: "#16a34a", fillOpacity: 0.85 },
  neb:     { color: "#7a1010", weight: 2.5, fillColor: "#dc2626", fillOpacity: 0.85 },
};

let mappa;
let stratoEdifici;
const edificiPerId = {};
const disegni = [];   // linee e frecce disegnate sulla mappa


export function creaMappa(centro) {
  mappa = L.map("mappa").setView(centro, ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  }).addTo(mappa);

  aggiungiLegenda();
  return mappa;
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
    mappa.fitBounds(gruppo.getBounds(), { padding: [60, 60], maxZoom: 17 });
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
  if (stratoEdifici) stratoEdifici.setStyle(STILI.normale);
  while (disegni.length) mappa.removeLayer(disegni.pop());
}


function aggiungiLegenda() {
  const legenda = L.control({ position: "bottomright" });
  legenda.onAdd = () => {
    const div = L.DomUtil.create("div", "legenda");
    div.innerHTML = `
      <div class="voce-legenda"><span class="campione" style="background:#3b82f6"></span> Edificio</div>
      <div class="voce-legenda"><span class="campione" style="background:#16a34a"></span> PEB · produce energia</div>
      <div class="voce-legenda"><span class="campione" style="background:#dc2626"></span> NEB · consuma energia</div>
      <div class="voce-legenda"><span class="filetto"></span> Flusso di energia</div>`;
    return div;
  };
  legenda.addTo(mappa);
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
    // Ripristino il bordo del ruolo: il riempimento resta quello impostato
    const colore = livello.options.fillColor === "#16a34a" ? "#0b4f22" : "#7a1010";
    livello.setStyle({ color: colore, weight: 2.5 });
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
/**
 * Gestione della mappa: inizializzazione, livelli, stili.
 * Il resto dell'applicazione non conosce i dettagli di Leaflet.
 */

const ZOOM = 14;

const STILI = {
  normale: { color: "#2563eb", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.35 },
  peb:     { color: "#15803d", weight: 1.5, fillColor: "#16a34a", fillOpacity: 0.85 },
  neb:     { color: "#b91c1c", weight: 1.5, fillColor: "#dc2626", fillOpacity: 0.85 },
};

let mappa;
let stratoEdifici;
const edificiPerId = {};

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
  // Riporto tutti gli edifici allo stile normale
  stratoEdifici.setStyle(STILI.normale);

  const daInquadrare = [];
  for (const m of membri) {
    const livello = edificiPerId[m.id_edificio];
    if (!livello) continue;
    livello.setStyle(m.ruolo === "PEB" ? STILI.peb : STILI.neb);
    daInquadrare.push(livello);
  }

  // L'edificio selezionato ha un bordo scuro per distinguerlo
  const selezionato = edificiPerId[idSelezionato];
  if (selezionato) {
    selezionato.setStyle({ color: "#111", weight: 3 });
    if (!daInquadrare.includes(selezionato)) daInquadrare.push(selezionato);
  }

  if (daInquadrare.length) {
    const gruppo = L.featureGroup(daInquadrare);
    mappa.fitBounds(gruppo.getBounds(), { padding: [60, 60], maxZoom: 17 });
  }
}

export function pulisci() {
  if (stratoEdifici) stratoEdifici.setStyle(STILI.normale);
}

function aggiungiLegenda() {
  const legenda = L.control({ position: "bottomleft" });
  legenda.onAdd = () => {
    const div = L.DomUtil.create("div", "legenda");
    div.innerHTML = `
      <div class="voce"><span class="quadretto" style="background:#3b82f6"></span> Edificio</div>
      <div class="voce"><span class="quadretto" style="background:#16a34a"></span> PEB · produce energia</div>
      <div class="voce"><span class="quadretto" style="background:#dc2626"></span> NEB · consuma energia</div>`;
    return div;
  };
  legenda.addTo(mappa);
}
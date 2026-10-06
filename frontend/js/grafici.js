/**
 * Costruzione dei grafici con Chart.js.
 * Ogni funzione riceve l'elemento canvas e i dati già pronti.
 */

const MESI = ["gen", "feb", "mar", "apr", "mag", "giu",
              "lug", "ago", "set", "ott", "nov", "dic"];

const COLORI = {
  fisico:  "#4f5dd8",
  diffuso: "#16a34a",
  neutro:  "#2a3345",
  critico: "#dc2626",
  griglia: "#e4e7ee",
  testo:   "#6b7280",
};

// Impostazioni comuni a tutti i grafici
const BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom",
      labels: { boxWidth: 10, boxHeight: 10, font: { family: "Titillium Web", size: 12 } },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { family: "Titillium Web", size: 11 }, color: COLORI.testo },
    },
    y: {
      beginAtZero: true,
      grid: { color: COLORI.griglia },
      ticks: { font: { family: "Titillium Web", size: 11 }, color: COLORI.testo },
    },
  },
};

const attivi = [];

/** Distrugge i grafici esistenti: va chiamata prima di ridisegnare la scheda. */
export function pulisciGrafici() {
  while (attivi.length) attivi.pop().destroy();
}

function crea(canvas, configurazione) {
  const grafico = new Chart(canvas, configurazione);
  attivi.push(grafico);
  return grafico;
}

/** Andamento mensile dell'autoconsumo di una comunità. */
export function graficoMensile(canvas, mensili) {
  crea(canvas, {
    type: "bar",
    data: {
      labels: MESI,
      datasets: [
        {
          label: "Consumata sul posto",
          data: mensili.map(m => m.autoconsumo_fisico ?? 0),
          backgroundColor: COLORI.fisico,
        },
        {
          label: "Condivisa nella comunità",
          data: mensili.map(m => m.autoconsumo_diffuso ?? 0),
          backgroundColor: COLORI.diffuso,
        },
      ],
    },
    options: {
      ...BASE,
      scales: {
        ...BASE.scales,
        x: { ...BASE.scales.x, stacked: true },
        y: { ...BASE.scales.y, stacked: true },
      },
    },
  });
}

/** Quante comunità per numero di edifici che le compongono. */
export function graficoDimensioni(canvas, dati) {
  crea(canvas, {
    type: "bar",
    data: {
      labels: dati.map(d => `${d.dimensione}`),
      datasets: [{
        label: "Comunità",
        data: dati.map(d => d.numero),
        backgroundColor: COLORI.neutro,
      }],
    },
    options: {
      ...BASE,
      plugins: { legend: { display: false } },
      scales: {
        ...BASE.scales,
        x: { ...BASE.scales.x, title: { display: true, text: "edifici per comunità",
             font: { family: "Titillium Web", size: 11 }, color: COLORI.testo } },
      },
    },
  });
}

/** Andamento del processo iterativo: comunità costituite e tentativi falliti. */
export function graficoIterazioni(canvas, dati) {
  crea(canvas, {
    type: "line",
    data: {
      labels: dati.map(d => d.iterazione),
      datasets: [
        {
          label: "Costituite",
          data: dati.map(d => d.riuscite),
          borderColor: COLORI.diffuso,
          backgroundColor: COLORI.diffuso,
          tension: .25, pointRadius: 2,
        },
        {
          label: "Non riuscite",
          data: dati.map(d => d.fallite),
          borderColor: COLORI.critico,
          backgroundColor: COLORI.critico,
          tension: .25, pointRadius: 2,
        },
      ],
    },
    options: {
      ...BASE,
      scales: {
        ...BASE.scales,
        x: { ...BASE.scales.x, title: { display: true, text: "iterazione",
             font: { family: "Titillium Web", size: 11 }, color: COLORI.testo } },
      },
    },
  });
}
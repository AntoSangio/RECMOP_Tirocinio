/**
 * Pagina di riepilogo: documento stampabile con la situazione
 * di un edificio e della sua comunità energetica.
 */

const API = "http://127.0.0.1:8000/api";

const parametri = new URLSearchParams(location.search);
const comune = parametri.get("comune");
const scenario = parametri.get("scenario");
const idEdificio = parametri.get("edificio");

const documento = document.getElementById("documento");
const numero = (n) => Math.round(n ?? 0).toLocaleString("it-IT");

const MESI = ["gen", "feb", "mar", "apr", "mag", "giu",
              "lug", "ago", "set", "ott", "nov", "dic"];

document.getElementById("torna").href =
  `mappa.html?comune=${comune}&scenario=${scenario}&profilo=cittadino`;

async function avvia() {
  const [comuni, dati] = await Promise.all([
    fetch(`${API}/comuni`).then(r => r.json()),
    fetch(`${API}/${comune}/edificio/${idEdificio}/cer/${scenario}`).then(r => r.json()),
  ]);

  const nomeComune = comuni.find(c => c.codice === comune)?.nome ?? comune;
  const e = dati.edificio;
  const oggi = new Date().toLocaleDateString("it-IT",
    { day: "numeric", month: "long", year: "numeric" });

  if (!dati.in_comunita) {
    documento.innerHTML = `
      <header class="testata-foglio">
        <p class="ente">RECMOP · ${nomeComune}</p>
        <h1>Edificio ${e.id_edificio}</h1>
        <p class="data">Documento generato il ${oggi}</p>
      </header>
      <p>
        Questo edificio non rientra in una comunità energetica costituita
        nello scenario ${scenario}.
      </p>`;
    return;
  }

  const c = dati.comunita.comunita;
  const membri = dati.comunita.membri;
  const produttori = membri.filter(m => m.ruolo === "PEB");
  const consumatori = membri.filter(m => m.ruolo === "NEB");

  documento.innerHTML = `
    <header class="testata-foglio">
      <p class="ente">RECMOP · Comune di ${nomeComune}</p>
      <h1>La tua comunità energetica</h1>
      <p class="data">Edificio ${e.id_edificio} · scenario ${scenario} · documento generato il ${oggi}</p>
    </header>

    <section>
      <h2>Il tuo edificio</h2>
      <table class="scheda-dati">
        <tr><th>Identificativo</th><td>${e.id_edificio}</td></tr>
        <tr><th>Ruolo nella comunità</th>
            <td>${e.ruolo === "PEB" ? "produce e consuma energia" : "consuma energia"}</td></tr>
        <tr><th>Classe energetica</th><td>${e.classe_energetica ?? "non indicata"}</td></tr>
        <tr><th>Consumo annuo</th><td>${numero(e.domanda_annua)} kWh</td></tr>
        <tr><th>Produzione annua</th><td>${numero(e.produzione_annua)} kWh</td></tr>
        <tr><th>Pannelli installati</th><td>${e.num_pannelli ?? 0}</td></tr>
      </table>
    </section>

    <section>
      <h2>La comunità</h2>
      <p class="spiegazione-foglio">
        ${e.ruolo === "PEB"
          ? `Il tuo edificio produce più energia di quanta ne consumi: l'eccedenza
             viene condivisa con gli altri membri della comunità invece di essere
             immessa nella rete nazionale.`
          : `Il tuo edificio non produce energia: parte del suo fabbisogno è coperto
             dall'energia prodotta dagli altri membri della comunità, invece di
             essere prelevata interamente dalla rete nazionale.`}
      </p>
      <table class="scheda-dati">
        <tr><th>Codice</th><td>${c.codice}</td></tr>
        <tr><th>Edifici che la compongono</th><td>${c.n_membri}</td></tr>
        <tr><th>di cui producono energia</th><td>${produttori.length}</td></tr>
        <tr><th>di cui la consumano</th><td>${consumatori.length}</td></tr>
        <tr><th>Energia condivisa in un anno</th><td>${numero(c.autoconsumo_diffuso)} kWh</td></tr>
        <tr><th>Energia eccedente</th><td>${numero(c.eccedenza)} kWh</td></tr>
        <tr><th>Emissioni evitate</th><td>${numero(c.co2_evitata_kg)} kg di CO₂</td></tr>
        ${c.distanza_massima_m != null
          ? `<tr><th>Estensione</th><td>${numero(c.distanza_massima_m)} metri</td></tr>` : ""}
      </table>
    </section>

    <section class="evita-interruzione">
      <h2>L'energia nel corso dell'anno</h2>
      <div class="grafico-foglio"><canvas id="mensile"></canvas></div>
      <p class="nota-foglio">
        In blu l'energia consumata direttamente da chi la produce,
        in verde quella condivisa con gli altri edifici della comunità.
      </p>
    </section>

    <section class="evita-interruzione">
      <h2>Gli edifici della comunità</h2>
      <table class="scheda-dati elenco">
        <thead><tr><th>Edificio</th><th>Ruolo</th><th>Consumo annuo</th><th>Produzione annua</th></tr></thead>
        <tbody>
          ${membri.map(m => `
            <tr${m.id_edificio == idEdificio ? ' class="evidenziato"' : ""}>
              <td>${m.id_edificio}${m.id_edificio == idEdificio ? " (il tuo)" : ""}</td>
              <td>${m.ruolo === "PEB" ? "produce" : "consuma"}</td>
              <td>${numero(m.domanda_annua)} kWh</td>
              <td>${numero(m.produzione_annua)} kWh</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </section>

    <footer class="piede-foglio">
      <p>
        Dati elaborati dal modello RECMOP — LabGIS, Università degli Studi di Salerno.
        I valori sono il risultato di una simulazione e hanno finalità conoscitiva.
      </p>
    </footer>`;

  const mensili = dati.comunita.mensili ?? [];
  if (mensili.length) {
    new Chart(document.getElementById("mensile"), {
      type: "bar",
      data: {
        labels: MESI,
        datasets: [
          { label: "Consumata sul posto", data: mensili.map(m => m.autoconsumo_fisico ?? 0),
            backgroundColor: "#4f5dd8" },
          { label: "Condivisa", data: mensili.map(m => m.autoconsumo_diffuso ?? 0),
            backgroundColor: "#16a34a" },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { position: "bottom", labels: { font: { family: "Titillium Web" } } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true },
        },
      },
    });
  }
}

avvia();
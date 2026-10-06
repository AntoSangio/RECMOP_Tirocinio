/**
 * Pagina iniziale: scelta del comune e dello scenario da consultare.
 */

const API = "http://127.0.0.1:8000/api";
const contenitore = document.getElementById("elenco-comuni");
const numero = (n) => Math.round(n ?? 0).toLocaleString("it-IT");

const DESCRIZIONE = {
  ambientale: "Aggregazioni orientate al beneficio ambientale",
  energetico: "Aggregazioni orientate all'efficienza energetica",
};

async function avvia() {
  try {
    const comuni = await fetch(`${API}/comuni`).then(r => r.json());

    if (!comuni.length) {
      contenitore.innerHTML = `<p class="attesa">Nessun comune caricato nella base di dati.</p>`;
      return;
    }

    contenitore.innerHTML = comuni.map(c => `
      <article class="comune">
        <div class="testata">
          <h2>${c.nome}</h2>
          <span class="provincia">${c.provincia ?? ""}</span>
          <span class="conteggio">${numero(c.edifici)} edifici</span>
        </div>
        <div class="scenari">
          ${c.scenari.map(s => `
            <a class="scenario-scelta" href="mappa.html?comune=${c.codice}&scenario=${s.codice}">
              <span class="nome">Scenario ${s.codice}</span>
              <span class="dettaglio">${DESCRIZIONE[s.codice] ?? ""}</span>
              <span class="esiti">${s.cer_riuscite} comunità costituite · ${numero(s.cer_fallite)} tentativi non riusciti</span>
            </a>`).join("")}
        </div>
      </article>`).join("");

  } catch (errore) {
    contenitore.innerHTML = `
      <p class="attesa">
        Server non raggiungibile. Avvia il backend e ricarica la pagina.
      </p>`;
    console.error(errore);
  }
}

avvia();
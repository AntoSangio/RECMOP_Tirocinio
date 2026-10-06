/**
 * Pagina iniziale: consultazione dei comuni disponibili
 * e gestione dei dati caricati nel sistema.
 */

const API = "http://127.0.0.1:8000/api";

const contenitore = document.getElementById("elenco-comuni");
const presenti = document.getElementById("presenti");
const modulo = document.getElementById("modulo");
const esito = document.getElementById("esito");
const invia = document.getElementById("invia");

const numero = (n) => Math.round(n ?? 0).toLocaleString("it-IT");

const DESCRIZIONE = {
  ambientale: "Aggregazioni orientate al beneficio ambientale",
  energetico: "Aggregazioni orientate all'efficienza energetica",
  economico: "Aggregazioni orientate al ritorno economico",
  sociale: "Aggregazioni orientate al beneficio sociale",
};

// --- Elenco dei comuni ---

async function aggiorna() {
  try {
    const comuni = await fetch(`${API}/comuni`).then(r => r.json());
    disegnaConsultazione(comuni);
    disegnaPresenti(comuni);
  } catch (errore) {
    contenitore.innerHTML = `
      <div class="segnalazione">
        <h3>Server non raggiungibile</h3>
        <p>Avvia il backend e ricarica la pagina.</p>
      </div>`;
    presenti.innerHTML = "";
    console.error(errore);
  }
}

function disegnaConsultazione(comuni) {
  if (!comuni.length) {
    contenitore.innerHTML = `
      <div class="invito">
        <h3>Non c'è ancora nessun comune da consultare</h3>
        <p>
          Carica il pacchetto di uno scenario dalla sezione qui sotto:
          i dati diventeranno subito consultabili sulla mappa.
        </p>
        <a class="azione" href="#sezione-dati">Vai al caricamento</a>
      </div>`;
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
}

function disegnaPresenti(comuni) {
  if (!comuni.length) {
    presenti.innerHTML = "";
    return;
  }

  presenti.innerHTML = `
    <h3 class="sottotitolo-sezione">Dati presenti nel sistema</h3>
    ${comuni.map(c => `
      <article class="riepilogo">
        <div class="testata">
          <h2>${c.nome}</h2>
          <span class="conteggio">${numero(c.edifici)} edifici</span>
          <button class="rimuovi comune-intero" data-comune="${c.codice}" data-nome="${c.nome}">
            Rimuovi il comune
          </button>
        </div>
        <table class="tabella">
          <thead>
            <tr><th>Scenario</th><th class="num">Riuscite</th><th class="num">Non riuscite</th><th></th></tr>
          </thead>
          <tbody>
            ${c.scenari.map(s => `
              <tr>
                <td>${s.codice}</td>
                <td class="num">${numero(s.cer_riuscite)}</td>
                <td class="num">${numero(s.cer_fallite)}</td>
                <td class="num">
                  <button class="rimuovi" data-comune="${c.codice}" data-scenario="${s.codice}">Rimuovi</button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </article>`).join("")}`;

  collegaRimozioni();
}

function collegaRimozioni() {
  presenti.querySelectorAll(".rimuovi").forEach(pulsante => {
    pulsante.onclick = async () => {
      const comune = pulsante.dataset.comune;
      const scenario = pulsante.dataset.scenario;

      const domanda = scenario
        ? `Rimuovere lo scenario "${scenario}" di ${comune}?`
        : `Rimuovere ${pulsante.dataset.nome} e tutti i suoi dati?`;
      if (!confirm(domanda)) return;

      const indirizzo = scenario
        ? `${API}/gestione/comune/${comune}/scenario/${scenario}`
        : `${API}/gestione/comune/${comune}`;

      const risposta = await fetch(indirizzo, { method: "DELETE" });
      if (risposta.ok) {
        mostraEsito("buono", "Rimozione completata.");
        aggiorna();
      } else {
        const errore = await risposta.json();
        mostraEsito("problema", errore.detail ?? "Rimozione non riuscita.");
      }
    };
  });
}

// --- Caricamento di un pacchetto ---

function mostraEsito(tipo, titolo, dettaglio = "") {
  esito.className = `esito ${tipo}`;
  esito.innerHTML = `<strong>${titolo}</strong>${dettaglio}`;
}

modulo.onsubmit = async (evento) => {
  evento.preventDefault();

  const file = document.getElementById("file").files[0];
  if (!file) return;

  const dati = new FormData();
  dati.append("pacchetto", file);
  const nome = document.getElementById("nome").value.trim();
  const provincia = document.getElementById("provincia").value.trim();
  if (nome) dati.append("nome_comune", nome);
  if (provincia) dati.append("provincia", provincia);

  invia.disabled = true;
  invia.textContent = "Importazione in corso…";
  mostraEsito("attesa", "Elaborazione del pacchetto…",
    "<p>L'operazione può richiedere qualche secondo.</p>");

  try {
    const risposta = await fetch(`${API}/gestione/importa`, { method: "POST", body: dati });
    const risultato = await risposta.json();

    if (!risposta.ok) {
      mostraEsito("problema", "Importazione non riuscita",
        `<p>${risultato.detail ?? "Errore sconosciuto."}</p>`);
    } else {
      const avvisi = risultato.avvisi.length
        ? `<p class="avvisi">${risultato.avvisi.join("<br>")}</p>` : "";

      mostraEsito("buono",
        `${risultato.comune.nome} — scenario ${risultato.scenario} importato`,
        `<ul class="resoconto">
           <li>Edifici: ${numero(risultato.edifici.edifici)}${risultato.edifici.nota ? " (" + risultato.edifici.nota + ")" : ""}</li>
           <li>Comunità costituite: ${numero(risultato.cer_riuscite.cer)}, con ${numero(risultato.cer_riuscite.membri)} appartenenze</li>
           <li>Aggregazioni non riuscite: ${numero(risultato.cer_fallite.cer)}</li>
           <li>Valori mensili: ${numero(risultato.cer_riuscite.mensili + risultato.cer_fallite.mensili)}</li>
         </ul>${avvisi}`);

      modulo.reset();
      aggiorna();
    }
  } catch (errore) {
    mostraEsito("problema", "Server non raggiungibile",
      "<p>Verifica che il backend sia avviato.</p>");
    console.error(errore);
  } finally {
    invia.disabled = false;
    invia.textContent = "Carica e importa";
  }
};

aggiorna();
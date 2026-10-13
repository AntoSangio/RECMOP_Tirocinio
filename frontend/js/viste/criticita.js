/**
 * Vista criticità: le aggregazioni che non hanno superato la soglia.
 * Serve all'amministrazione per individuare dove il territorio
 * ha margini di miglioramento.
 */

const API = "http://127.0.0.1:8000/api";
const numero = (n) => Math.round(n ?? 0).toLocaleString("it-IT");

export async function contenutoCriticita(comune, scenario, nomeComune) {
  const dati = await fetch(`${API}/${comune}/criticita/${scenario}`).then(r => r.json());
  const s = dati.sintesi;

  const righe = dati.piu_vicine.map(c => `
    <tr data-codice="${c.codice}">
      <td class="codice">${c.codice}</td>
      <td class="num">${c.n_membri}</td>
      <td class="num">${Number(c.indice).toFixed(2)}</td>
    </tr>`).join("");

  const classi = dati.classi.map(c => `
    <div class="dato">
      <span class="nome">Classe ${c.classe ?? "non indicata"}</span>
      <span class="valore">${numero(c.numero)}</span>
    </div>`).join("");

  const html = `
    <h1 class="intestazione">Dove il territorio non arriva</h1>
    <p class="occhiello">${nomeComune}, scenario ${scenario}</p>

    <div class="racconto">
      <p>
        Il modello ha tentato <b>${numero(s.tentativi)} aggregazioni</b> che non
        hanno superato la soglia di efficienza. Gli edifici coinvolti restano
        fuori da ogni comunità: sono le situazioni su cui un intervento
        avrebbe l'effetto maggiore.
      </p>
    </div>

    <div class="cifre">
      <div class="cifra">
        <span class="grande">${numero(s.tentativi)}</span>
        <span class="minuta">tentativi non riusciti</span>
      </div>
      <div class="cifra">
        <span class="grande">${numero(s.edifici_solo_falliti)}</span>
        <span class="minuta">edifici mai entrati in una comunità</span>
      </div>
      <div class="cifra">
        <span class="grande">${s.membri_medi ?? "–"}</span>
        <span class="minuta">edifici per tentativo</span>
      </div>
      <div class="cifra">
        <span class="grande">${s.indice_medio ?? "–"}</span>
        <span class="minuta">indice medio</span>
      </div>
    </div>

    <p class="titoletto">Le aggregazioni più promettenti</p>
    <p class="didascalia">
      Tentativi non riusciti con l'indice più alto: sono quelli che si sono
      avvicinati di più al risultato. Clicca una riga per vederli sulla mappa.
    </p>
    <table class="tabella">
      <thead>
        <tr><th>Aggregazione</th><th class="num">Edifici</th><th class="num">Indice</th></tr>
      </thead>
      <tbody>${righe}</tbody>
    </table>

    <p class="titoletto">Classe energetica degli edifici coinvolti</p>
    <div class="dati" style="border-top:0; padding-top:0;">${classi}</div>
    <p class="didascalia">
      Un'alta presenza di classi basse indica che la riqualificazione degli edifici
      potrebbe rendere possibili nuove comunità.
    </p>`;

  return { html };
}
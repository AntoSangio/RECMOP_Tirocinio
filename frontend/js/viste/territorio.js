/**
 * Vista territorio: quadro d'insieme per l'amministrazione comunale.
 */

const API = "http://127.0.0.1:8000/api";
const numero = (n) => Math.round(n ?? 0).toLocaleString("it-IT");

export async function contenutoTerritorio(comune, scenario, nomeComune) {
  const [kpi, elenco, confronto] = await Promise.all([
    fetch(`${API}/${comune}/kpi/${scenario}`).then(r => r.json()),
    fetch(`${API}/${comune}/cer/${scenario}`).then(r => r.json()),
    fetch(`${API}/${comune}/confronto`).then(r => r.json()),
  ]);

  const righe = elenco.slice(0, 40).map(c => `
    <tr data-codice="${c.codice}">
      <td class="codice">${c.codice}</td>
      <td class="num">${c.n_membri}</td>
      <td class="num">${numero(c.autoconsumo_diffuso)}</td>
    </tr>`).join("");

  const confrontoRighe = confronto.map(s => `
    <div class="dato">
      <span class="nome">${s.scenario}</span>
      <span class="valore">${s.riuscite} comunità · ${numero(s.energia_condivisa)} kWh</span>
    </div>`).join("");

  return `
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

    <p class="titoletto">Comunità per energia condivisa</p>
    <table class="tabella">
      <thead>
        <tr><th>Comunità</th><th class="num">Edifici</th><th class="num">kWh condivisi</th></tr>
      </thead>
      <tbody>${righe}</tbody>
    </table>
    <p class="aiuto">Sono mostrate le prime 40 comunità su ${elenco.length}. Clicca una riga per vederla sulla mappa.</p>`;
}
/*=================================================
  FRETES — FASE 8 + EXPORTAÇÃO CSV + FILTRO GLOBAL
  + AGRUPAMENTO POR CONJUNTO DE VEÍCULOS
  Lógica: para cada mês, agrupa os lançamentos por
  Placa, Motorista, Empresa e Conjunto, calculando:
    Litros transportados (qtd carga)
    Frete = litros × taxa da empresa do lançamento
  A taxa é atributo da empresa contratante — vive em
  db.empresas[].taxaFrete e é editada no cadastro de
  Empresas. Não varia por combustível.
  FIX: garantirConjuntos() chamado antes de processar para
       garantir que db.conjuntosVeiculos existe
=================================================*/

let dadosFretesAtual = null;

/*=================================================
  TAXA DE FRETE — LEITURA
=================================================*/

/**
 * Empresa de um lançamento no cadastro: pelo nome e, se o nome não bater
 * (uma nota com o nome antigo), pelo id gravado na nota.
 */
function _empresaDoLancamentoFrete(l) {
    const id = typeof _empresaIdDoLancamento === 'function' ? _empresaIdDoLancamento(l) : null;
    return db.empresas.find(e => e.id === id) || db.empresas.find(e => e.nome === l.empresa) || null;
}

/**
 * Taxa de frete (R$/litro) de uma empresa, pelo nome.
 * Ponto único de leitura do módulo: nenhum cálculo deve ler
 * `taxaFrete` direto do registro.
 */
function _taxaFreteEmpresa(nomeEmpresa, iso) {
    const emp = db.empresas.find(e => e.nome === nomeEmpresa);
    // Com data, a taxa que VALIA naquele dia (vigência, 17/09/2026).
    return iso ? _taxaFreteDaEmpresaNaData(emp, iso) : _taxaFreteDaEmpresa(emp);
}

/**
 * Taxa a exibir para um agrupamento que pode reunir mais de uma empresa —
 * uma placa ou motorista que rodou para duas contratantes no mesmo mês.
 *
 * Retorna a taxa quando há uma única empresa envolvida e `null` quando há
 * mistura. Nesse caso a coluna vira "—", mas o frete somado permanece
 * exato: ele é acumulado lançamento a lançamento, cada um já com a taxa
 * da sua própria empresa.
 */
function _taxaFreteGrupo(grupo) {
    if (!grupo || !grupo.empresas || grupo.empresas.size !== 1) return null;
    // A taxa do MÊS exibido, não a de hoje: depois que a taxa passou a ter
    // vigência, mostrar a atual num mês antigo não descreveria o frete
    // somado ao lado (17/09/2026).
    const mesRef = dadosFretesAtual && dadosFretesAtual.mes ? dadosFretesAtual.mes + "-15" : null;
    return _taxaFreteEmpresa([...grupo.empresas][0], mesRef);
}

/** Taxa do grupo formatada para as tabelas da tela. */
function _fmtTaxaGrupo(grupo) {
    const taxa = _taxaFreteGrupo(grupo);
    return taxa > 0 ? fmtR4(taxa) : "—";
}

/** Taxa do grupo em texto puro, para Excel e CSV. */
function _taxaGrupoTexto(grupo) {
    const taxa = _taxaFreteGrupo(grupo);
    return taxa > 0 ? taxa.toFixed(4) : "";
}

/** Taxa do grupo como NÚMERO, para a célula da planilha somar e ordenar.
    Vazio quando o grupo mistura taxas diferentes. */
function _taxaGrupoNum(grupo) {
    const taxa = _taxaFreteGrupo(grupo);
    return taxa > 0 ? Number(taxa.toFixed(4)) : "";
}

/** Taxa do grupo com prefixo R$, para PDF e impressão. */
function _taxaGrupoMoeda(grupo) {
    const taxa = _taxaFreteGrupo(grupo);
    return taxa > 0 ? "R$ " + taxa.toFixed(4) : "—";
}

/*=================================================
  CARREGAR TELA DE FRETES
=================================================*/
function carregarFretes() {
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

    const sel = document.getElementById("fretesSelectMes");
    if (sel && !sel.value) sel.value = mesAtual;

    calcularEExibirFretes();
}

function calcularEExibirFretes() {
    const mes = document.getElementById("fretesSelectMes")?.value;
    if (!mes) return;

    // ── FIX: garante que db.conjuntosVeiculos existe antes de processar ──
    if (typeof garantirConjuntos === 'function') garantirConjuntos();

    // A conta mora em `calcularFretesDoMes` (utils.js), sem DOM e sem
    // global: é ela que os testes automatizados conferem (18/09/2026).
    dadosFretesAtual = calcularFretesDoMes({
        lancamentos: db.lancamentos,
        mes,
        empresaFiltro: empresaFiltroGlobal,
        empresaDoLancamento: _empresaDoLancamentoFrete,
        resolverConjunto: typeof resolverConjuntoEPeriodo === 'function' ? resolverConjuntoEPeriodo : null
    });

    renderFreteResumo();
    renderFreteHistorico();
    renderAbaPlacas();
    renderAbaMotoristasFrete();
    renderAbaEmpresasFrete();
    renderAbaConjuntosFretes();
}

function renderFreteResumo() {
    const resumo = document.getElementById("fretesResumoMes");
    if (!resumo || !dadosFretesAtual) return;

    if (dadosFretesAtual.totalNotas === 0) {
        resumo.innerHTML = `<span class="dica" style="margin:0">Nenhum lançamento encontrado para ${nomeMes(dadosFretesAtual.mes)}.</span>`;
    } else {
        resumo.innerHTML = `
            <strong>${dadosFretesAtual.totalNotas}</strong> nota(s)
            &nbsp;|&nbsp; Litros: <strong>${fmtL(dadosFretesAtual.totalLitros)}</strong>
            &nbsp;|&nbsp; Frete total: <strong>${fmtR(dadosFretesAtual.totalFrete)}</strong>
            ${dadosFretesAtual.semTaxa ? `<br><span style="color:var(--danger)">${dadosFretesAtual.semTaxa} nota(s) com empresa que não está no cadastro: entraram sem taxa (R$ 0,00). Corrija a empresa dessas notas.</span>` : ''}
            ${dadosFretesAtual.taxaZero ? `<br><span style="color:var(--danger)">${dadosFretesAtual.taxaZero} nota(s) de ${escapeHtml((dadosFretesAtual.empresasTaxaZero || []).join(', '))}: a empresa está cadastrada com taxa de frete zerada, então o frete saiu R$ 0,00. Informe a taxa em Cadastros › Empresas.</span>` : ''}
        `;
    }
}

/**
 * Sublinhas de quebra por combustível.
 *
 * A célula de taxa fica vazia de propósito: a taxa é da empresa e já
 * aparece na linha principal do grupo — repeti-la em cada combustível
 * daria a impressão falsa de que ela varia por produto.
 *
 * `colunasNome` é quantas colunas iniciais o rótulo ocupa, já que as
 * tabelas têm larguras diferentes (Por Placa tem a coluna Conjunto a
 * mais). Sem isso as sublinhas caem sob os cabeçalhos errados.
 */
function linhasDetalhes(detalhes, colunasNome = 2) {
    const estilo = 'color:var(--text-muted); font-size:0.85rem';
    return Object.entries(detalhes).map(([tipo, d]) => `
        <tr class="linha-detalhe-frete">
            <td colspan="${colunasNome}" style="padding-left:24px; ${estilo}">↳ ${escapeHtml(tipo)}</td>
            <td style="${estilo}">${fmtL3(d.litros)}</td>
            <td></td>
            <td style="${estilo}">${d.frete > 0 ? fmtR(d.frete) : "—"}</td>
        </tr>
    `).join("");
}

function renderAbaPlacas() {
    const tbody = document.getElementById("tabelaFretePlacas");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porPlaca;
    if (lista.length === 0) {
        tbody.innerHTML = linhaTabelaVazia(6, "Nenhuma descarga neste mês",
            "O frete conta pela data da descarga: nenhuma nota foi descarregada no mês escolhido.",
            { texto: "Ver os lançamentos", onclick: "mostrarTela('relatorios')" });
        return;
    }

    tbody.innerHTML = lista.map(p => `
        <tr class="linha-clicavel" onclick="_freteAbreRelatorio('placa', '${escapeJsAttr(p.nome)}')"
            title="Ver as notas desta placa no Relatório">
            <td><strong>${escapeHtml(p.nome)}</strong></td>
            <td style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(p.conjunto) || "—"}</td>
            <td>${p.viagens}</td>
            <td>${fmtL3(p.litros)}</td>
            <td>${_fmtTaxaGrupo(p)}</td>
            <td><strong>${fmtR(p.frete)}</strong></td>
        </tr>
        ${linhasDetalhes(p.detalhes, 3)}
    `).join("");
}

function renderAbaMotoristasFrete() {
    const tbody = document.getElementById("tabelaFreteMotoristas");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porMotorista;
    if (lista.length === 0) {
        tbody.innerHTML = linhaTabelaVazia(5, "Nenhuma descarga neste mês",
            "O frete conta pela data da descarga: nenhuma nota foi descarregada no mês escolhido.",
            { texto: "Ver os lançamentos", onclick: "mostrarTela('relatorios')" });
        return;
    }

    tbody.innerHTML = lista.map(m => `
        <tr class="linha-clicavel" onclick="_freteAbreRelatorio('motorista', '${escapeJsAttr(m.nome)}')"
            title="Ver as notas deste motorista no Relatório">
            <td><strong>${escapeHtml(m.nome)}</strong></td>
            <td>${m.viagens}</td>
            <td>${fmtL3(m.litros)}</td>
            <td>${_fmtTaxaGrupo(m)}</td>
            <td><strong>${fmtR(m.frete)}</strong></td>
        </tr>
        ${linhasDetalhes(m.detalhes)}
    `).join("");
}

function renderAbaEmpresasFrete() {
    const tbody = document.getElementById("tabelaFreteEmpresas");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porEmpresa;
    if (lista.length === 0) {
        tbody.innerHTML = linhaTabelaVazia(5, "Nenhuma descarga neste mês",
            "O frete conta pela data da descarga: nenhuma nota foi descarregada no mês escolhido.",
            { texto: "Ver os lançamentos", onclick: "mostrarTela('relatorios')" });
        return;
    }

    tbody.innerHTML = lista.map(e => `
        <tr>
            <td><strong>${escapeHtml(e.nome)}</strong></td>
            <td>${e.viagens}</td>
            <td>${fmtL3(e.litros)}</td>
            <td>${_fmtTaxaGrupo(e)}</td>
            <td><strong>${fmtR(e.frete)}</strong></td>
        </tr>
        ${linhasDetalhes(e.detalhes)}
    `).join("");
}

/*=================================================
  ABA: POR CONJUNTO
=================================================*/
function renderAbaConjuntosFretes() {
    const tbody = document.getElementById("tabelaFreteConjuntos");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porConjunto;
    if (!lista || lista.length === 0) {
        tbody.innerHTML = linhaTabelaVazia(5, "Nenhuma placa em conjunto neste mês",
            "As notas do mês são de placas que não estavam em nenhum conjunto de veículos na data da descarga.",
            { texto: "Abrir Cadastros › Conjuntos", onclick: "mostrarTela('cadastros')" });
        return;
    }

    tbody.innerHTML = lista.map(c => {
        const detalhesCombs = linhasDetalhes(c.detalhes);

        const detalhesPlacas = Object.entries(c.porPlacaInterna).map(([placa, d]) => `
            <tr class="linha-detalhe-frete">
                <td style="padding-left:24px; color:var(--text-muted); font-size:0.82rem">
                     ${escapeHtml(placa)}
                </td>
                <td style="color:var(--text-muted); font-size:0.82rem">${d.viagens}</td>
                <td style="color:var(--text-muted); font-size:0.82rem">${fmtL3(d.litros)}</td>
                <td></td>
                <td style="color:var(--text-muted); font-size:0.82rem">${d.frete > 0 ? fmtR(d.frete) : "—"}</td>
            </tr>
        `).join("");

        return `
            <tr style="background:var(--bg-secondary)">
                <td><strong> ${escapeHtml(c.nome)}</strong></td>
                <td><strong>${c.viagens}</strong></td>
                <td><strong>${fmtL3(c.litros)}</strong></td>
                <td>${_fmtTaxaGrupo(c)}</td>
                <td><strong>${fmtR(c.frete)}</strong></td>
            </tr>
            ${detalhesPlacas}
            ${detalhesCombs}
        `;
    }).join("");
}

function trocarAbaFretes(nomeAba, botao) {
    document.querySelectorAll("#fretes .aba-conteudo").forEach(a => a.style.display = "none");
    document.querySelectorAll("#fretesAbas .aba-btn").forEach(b => b.classList.remove("ativa"));
    document.getElementById("frete-aba-" + nomeAba).style.display = "block";
    botao.classList.add("ativa");
}

/* ── DA LINHA DE FRETE PARA AS NOTAS ────────────────────────────────
   O frete conta pela data da DESCARGA e o Relatório filtra pela EMISSÃO
   (rodada 11). O período vai como o mês da descarga, e o aviso diz que
   uma nota da virada do mês pode não aparecer — melhor dizer do que
   deixar o operador achar que os dois recortes são o mesmo. */
function _freteAbreRelatorio(campo, valor) {
    if (!dadosFretesAtual || !dadosFretesAtual.mes) return;
    const filtros = { ..._mesParaPeriodo(dadosFretesAtual.mes) };
    filtros[campo] = valor;
    irParaRelatorioFiltrado(filtros,
        `Relatório filtrado por ${campo} "${valor}", ${nomeMes(dadosFretesAtual.mes)}. `
        + `O frete conta pela descarga e o Relatório pela emissão: nota da virada do mês pode não aparecer.`);
}

/* ── FRETE MÊS A MÊS (17/09/2026) ───────────────────────────────────
   A tela respondia por um mês só: para saber se o frete de um
   transportador subiu, era abrir mês a mês. São seis meses terminando no
   mês escolhido, cada um com a taxa que valia nele. */
function renderFreteHistorico() {
    const alvo = document.getElementById("freteHistoricoContainer");
    if (!alvo || !dadosFretesAtual) return;
    const [ano, mes] = dadosFretesAtual.mes.split("-").map(Number);
    const meses = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(ano, mes - 1 - i, 1);
        meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const serie = meses.map(m => {
        const lancs = db.lancamentos.filter(l => lancamentoAtivo(l)
            && (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal)
            && dataDescargaDe(l).startsWith(m));
        let frete = 0, litros = 0;
        lancs.forEach(l => {
            const taxa = _taxaFreteDaEmpresaNaData(_empresaDoLancamentoFrete(l), dataDescargaDe(l));
            (l.itens || []).forEach(i => { const q = Number(i.qtd) || 0; litros += q; frete += q * taxa; });
        });
        return { mes: m, frete, litros, porLitro: litros > 0 ? frete / litros : 0 };
    });

    if (!serie.some(x => x.frete > 0)) {
        alvo.innerHTML = `<p class="grafico-vazio">Sem frete nos últimos seis meses.</p>`;
        return;
    }

    alvo.innerHTML = `
        <div class="grafico-wrapper" style="height:220px"><canvas id="graficoFreteMeses"></canvas></div>
        <div class="tabela-container" style="margin-top:10px">
            <table><thead><tr><th>Mês</th><th>Litros (carga)</th><th>Frete</th><th>R$/L</th></tr></thead>
            <tbody>${serie.map(x => `<tr class="linha-clicavel" onclick="_freteAbrirMes('${x.mes}')" title="Ver o detalhe deste mês">
                <td><strong>${nomeMes(x.mes)}</strong></td>
                <td>${fmtL3(x.litros)}</td>
                <td><strong>${fmtR(x.frete)}</strong></td>
                <td>${x.porLitro > 0 ? fmtR4(x.porLitro) : "—"}</td>
            </tr>`).join("")}</tbody></table>
        </div>`;

    if (typeof Chart === "undefined") return;
    const cores = getChartColors();
    if (window._chartFreteMeses) window._chartFreteMeses.destroy();
    window._chartFreteMeses = new Chart(document.getElementById("graficoFreteMeses").getContext("2d"), {
        type: "bar",
        data: {
            labels: serie.map(x => nomeMes(x.mes)),
            datasets: [{
                label: "Frete (R$)",
                data: serie.map(x => x.frete),
                backgroundColor: cores.primary + "80",
                borderColor: cores.primary,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: (evento, elementos) => {
                if (!elementos || !elementos.length) return;
                _freteAbrirMes(serie[elementos[0].index].mes);
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: {
                    label: ctx => `${fmtR(ctx.raw)} · ${fmtR4(serie[ctx.dataIndex].porLitro)}/L`,
                    afterLabel: () => "Clique para abrir este mês"
                } }
            },
            scales: {
                x: { ticks: { color: cores.text }, grid: { color: cores.grid } },
                y: { ticks: { color: cores.text, callback: v => fmtR(v) }, grid: { color: cores.grid } }
            }
        }
    });
}

/** Troca o mês do seletor e recalcula — usado pelo gráfico e pela tabela. */
function _freteAbrirMes(mes) {
    const sel = document.getElementById("fretesSelectMes");
    if (!sel) return;
    sel.value = mes;
    calcularEExibirFretes();
}

/* ── FRETE NOTA A NOTA (17/09/2026) ─────────────────────────────────
   As quatro abas somam por grupo, e o detalhe parava no tipo de
   combustível. Quando um transportador questiona um valor, o que resolve
   é a lista "nota, data, litros, taxa, R$" — que antes só saía cruzando
   Fretes com Relatórios à mão. */
function _freteNotaANota(mes) {
    const linhas = [];
    db.lancamentos
        .filter(l => lancamentoAtivo(l)
            && (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal)
            && dataDescargaDe(l).startsWith(mes))
        .sort((a, b) => dataDescargaDe(a).localeCompare(dataDescargaDe(b)))
        .forEach(l => {
            const emp  = _empresaDoLancamentoFrete(l);
            const taxa = _taxaFreteDaEmpresaNaData(emp, dataDescargaDe(l));
            const litros = (l.itens || []).reduce((s2, i) => s2 + (Number(i.qtd) || 0), 0);
            const conj = (typeof resolverConjuntoEPeriodo === 'function' && l.placa)
                ? (resolverConjuntoEPeriodo(l.placa, dataDescargaDe(l))?.conj?.nome || "")
                : "";
            linhas.push({
                descarga: dataDescargaDe(l),
                emissao:  dataEmissaoDe(l),
                nota:     l.numeroNota || "",
                empresa:  emp?.nome || l.empresa || "",
                motorista: l.motorista || "",
                placa:    l.placa || "",
                conjunto: conj,
                litros, taxa, frete: litros * taxa
            });
        });
    return linhas;
}

function abrirFreteNotaANota() {
    if (!dadosFretesAtual || !dadosFretesAtual.mes) return;
    const linhas = _freteNotaANota(dadosFretesAtual.mes);
    if (!linhas.length) return mostrarToast("Nenhuma nota descarregada neste mês.", "aviso", 4000);
    const totalFrete = linhas.reduce((s2, x) => s2 + x.frete, 0);
    const totalLitros = linhas.reduce((s2, x) => s2 + x.litros, 0);

    const modal = document.createElement("div");
    modal.id = "_modalFreteNotas";
    modal.className = "modal-overlay";
    modal.style.display = "flex";
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
        <div class="modal" style="max-width:min(1000px, 96vw)" onclick="event.stopPropagation()">
            <h3 style="margin:0 0 4px">Frete nota a nota — ${nomeMes(dadosFretesAtual.mes)}</h3>
            <p class="dica">Pela data da descarga, com a taxa que valia em cada data. É esta lista que responde a um transportador que questiona um valor.</p>
            <div class="tabela-container" style="max-height:52vh;overflow:auto">
                <table><thead><tr>
                    <th>Descarga</th><th>Emissão</th><th>Nota</th><th>Empresa</th>
                    <th>Motorista</th><th>Placa</th><th>Conjunto</th>
                    <th>Litros (carga)</th><th>Taxa</th><th>Frete</th>
                </tr></thead>
                <tbody>${linhas.map(x => `<tr>
                    <td>${formatarData(x.descarga)}</td>
                    <td>${formatarData(x.emissao)}</td>
                    <td>${escapeHtml(x.nota)}</td>
                    <td>${escapeHtml(x.empresa)}</td>
                    <td>${escapeHtml(x.motorista)}</td>
                    <td>${escapeHtml(x.placa)}</td>
                    <td>${escapeHtml(x.conjunto) || "—"}</td>
                    <td>${fmtL3(x.litros)}</td>
                    <td>${x.taxa > 0 ? fmtR4(x.taxa) : "—"}</td>
                    <td><strong>${fmtR(x.frete)}</strong></td>
                </tr>`).join("")}</tbody>
                <tfoot><tr>
                    <td colspan="7"><strong>TOTAL — ${linhas.length} nota(s)</strong></td>
                    <td><strong>${fmtL3(totalLitros)}</strong></td>
                    <td></td>
                    <td><strong>${fmtR(totalFrete)}</strong></td>
                </tr></tfoot>
                </table>
            </div>
            <div class="sistema-acoes" style="margin-top:14px;justify-content:flex-end">
                <button class="btn-secundario" onclick="exportarFreteNotaANota()">Excel desta lista</button>
                <button class="btn-secundario" onclick="document.getElementById('_modalFreteNotas').remove()">Fechar</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (typeof _modalAcessivel === "function") _modalAcessivel(modal, () => modal.remove());
}

function exportarFreteNotaANota() {
    if (adiarAteBibliotecas(["xlsx"], () => exportarFreteNotaANota())) return;
    if (!dadosFretesAtual || !dadosFretesAtual.mes) return;
    const linhas = _freteNotaANota(dadosFretesAtual.mes);
    if (!linhas.length) return mostrarToast("Nenhuma nota descarregada neste mês.", "aviso", 4000);
    const aoa = [
        [`FRETE NOTA A NOTA — ${nomeMes(dadosFretesAtual.mes)}`],
        [`${empresaFiltroGlobal || "Todas as empresas"} · pela data da descarga · gerado em ${formatarData(_hojeISO())}`],
        [],
        ["Descarga", "Emissão", "Nota", "Empresa", "Motorista", "Placa", "Conjunto", "Litros (carga)", "Taxa (R$/L)", "Frete (R$)"]
    ];
    linhas.forEach(x => aoa.push([
        formatarData(x.descarga), formatarData(x.emissao), x.nota, x.empresa,
        x.motorista, x.placa, x.conjunto, _num(x.litros, 3), _num(x.taxa, 4), _num(x.frete, 2)
    ]));
    aoa.push([]);
    aoa.push(["TOTAL", "", `${linhas.length} nota(s)`, "", "", "", "",
              _num(linhas.reduce((s2, x) => s2 + x.litros, 0), 3), "",
              _num(linhas.reduce((s2, x) => s2 + x.frete, 0), 2)]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Frete nota a nota");
    XLSX.writeFile(wb, `frete-nota-a-nota-${dadosFretesAtual.mes}.xlsx`);
}

/*=================================================
  EXPORTAÇÕES
=================================================*/

/* Número de verdade na célula: `toFixed` devolve string, e a planilha de
   quem recebe não somava nem ordenava a coluna (17/09/2026). */
function _num(v, casas) {
    return Number((Number(v) || 0).toFixed(casas));
}

/* Linha de fechamento de uma seção do resumo de fretes. `colunas` é 6 nas
   seções com a coluna Conjunto e 5 nas outras. */
function _totalSecao(lista, colunas) {
    const viagens = lista.reduce((s, x) => s + (x.viagens || 0), 0);
    const litros  = lista.reduce((s, x) => s + (x.litros  || 0), 0);
    const frete   = lista.reduce((s, x) => s + (x.frete   || 0), 0);
    return colunas === 6
        ? ["TOTAL", "", viagens, _num(litros, 3), "", _num(frete, 2)]
        : ["TOTAL", viagens, _num(litros, 3), "", _num(frete, 2)];
}

// ========== EXPORTAÇÃO EXCEL ==========
function exportarFretesExcel() {
    if (adiarAteBibliotecas(["xlsx"], () => exportarFretesExcel())) return;
    if (!dadosFretesAtual || dadosFretesAtual.totalNotas === 0) {
        mostrarToast("Não há dados para exportar.", "aviso", 4000);
        return;
    }
    const d = dadosFretesAtual;
    const mesLabel = nomeMes(d.mes);
    const linhas = [];

    linhas.push([`RESUMO DE FRETES — ${mesLabel}`]);
    linhas.push([`Notas: ${d.totalNotas}`, `Litros: ${d.totalLitros.toFixed(0)} L`, `Frete Total: R$ ${d.totalFrete.toFixed(2)}`]);
    linhas.push([]);

    linhas.push(["POR PLACA"]);
    linhas.push(["Placa", "Conjunto", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porPlaca.forEach(p => {
        linhas.push([p.nome, p.conjunto || "—", p.viagens, _num(p.litros, 3), _taxaGrupoNum(p), _num(p.frete, 2)]);
        Object.entries(p.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", "", _num(det.litros, 3), "", _num(det.frete, 2)]);
        });
    });
    linhas.push(_totalSecao(d.porPlaca, 6));
    linhas.push([]);

    linhas.push(["POR CONJUNTO"]);
    linhas.push(["Conjunto", "", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porConjunto.forEach(c => {
        linhas.push([c.nome, "", c.viagens, _num(c.litros, 3), _taxaGrupoNum(c), _num(c.frete, 2)]);
        Object.entries(c.porPlacaInterna).forEach(([placa, det]) => {
            linhas.push([`  ↳ ${placa}`, "", det.viagens, _num(det.litros, 3), "", _num(det.frete, 2)]);
        });
        Object.entries(c.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", "", _num(det.litros, 3), "", _num(det.frete, 2)]);
        });
    });
    linhas.push(_totalSecao(d.porConjunto, 6));
    linhas.push([]);

    linhas.push(["POR MOTORISTA"]);
    linhas.push(["Motorista", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porMotorista.forEach(m => {
        linhas.push([m.nome, m.viagens, _num(m.litros, 3), _taxaGrupoNum(m), _num(m.frete, 2)]);
        Object.entries(m.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", _num(det.litros, 3), "", _num(det.frete, 2)]);
        });
    });
    linhas.push(_totalSecao(d.porMotorista, 5));
    linhas.push([]);

    linhas.push(["POR EMPRESA"]);
    linhas.push(["Empresa", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porEmpresa.forEach(e => {
        linhas.push([e.nome, e.viagens, _num(e.litros, 3), _taxaGrupoNum(e), _num(e.frete, 2)]);
        Object.entries(e.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", _num(det.litros, 3), "", _num(det.frete, 2)]);
        });
    });
    linhas.push(_totalSecao(d.porEmpresa, 5));

    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fretes");
    XLSX.writeFile(wb, `fretes-${d.mes}.xlsx`);
}

// ========== EXPORTAÇÃO PDF ==========
function exportarFretesPDF() {
    if (adiarAteBibliotecas(["jspdf", "autotable"], () => exportarFretesPDF())) return;
    if (!dadosFretesAtual || dadosFretesAtual.totalNotas === 0) {
        mostrarToast("Não há dados para exportar.", "aviso", 4000);
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const d = dadosFretesAtual;
    const mesLabel = nomeMes(d.mes);
    // Mesma faixa, cor, logo e numeração de página dos outros PDFs
    // (18/09/2026). Antes este saía com texto solto e cor fixa.
    const estilo = typeof _pdfEstilo === "function" ? _pdfEstilo() : null;
    const cor = estilo ? estilo.cor : [26, 58, 92];
    let yCab = 28;
    if (estilo) {
        yCab = _pdfCabecalho(doc, estilo, `Resumo de Fretes — ${mesLabel}`,
            `${empresaFiltroGlobal || "Todas as empresas"} · pela data da descarga · gerado em ${new Date().toLocaleDateString("pt-BR")}`);
    }
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`Notas: ${d.totalNotas}  |  Litros (carga): ${fmtL3(d.totalLitros)}  |  Frete total: ${fmtR(d.totalFrete)}`, 14, yCab);

    const cabecalho = ["Nome", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"];

    const montarCorpo = (lista) => {
        const rows = [];
        lista.forEach(item => {
            rows.push([item.nome, item.viagens, item.litros.toFixed(3), _taxaGrupoMoeda(item), `R$ ${item.frete.toFixed(2)}`]);
            Object.entries(item.detalhes).forEach(([tipo, det]) => {
                rows.push([
                    `  ↳ ${tipo}`, "",
                    det.litros.toFixed(3),
                    "",
                    det.frete > 0 ? `R$ ${det.frete.toFixed(2)}` : "—"
                ]);
            });
        });
        return rows;
    };

    const montarCorpoConjuntos = (lista) => {
        const rows = [];
        lista.forEach(c => {
            rows.push([`${c.nome}`, c.viagens, c.litros.toFixed(3), _taxaGrupoMoeda(c), `R$ ${c.frete.toFixed(2)}`]);
            Object.entries(c.porPlacaInterna).forEach(([placa, det]) => {
                rows.push([`  ${placa}`, det.viagens, det.litros.toFixed(3), "", det.frete > 0 ? `R$ ${det.frete.toFixed(2)}` : "—"]);
            });
            Object.entries(c.detalhes).forEach(([tipo, det]) => {
                rows.push([`    ↳ ${tipo}`, "", det.litros.toFixed(3), "", det.frete > 0 ? `R$ ${det.frete.toFixed(2)}` : "—"]);
            });
        });
        return rows;
    };

    let startY = yCab + 4;

    const secoes = [
        { titulo: "Por Conjunto",   corpo: montarCorpoConjuntos(d.porConjunto) },
        { titulo: "Por Placa",      corpo: montarCorpo(d.porPlaca) },
        { titulo: "Por Motorista",  corpo: montarCorpo(d.porMotorista) },
        { titulo: "Por Empresa",    corpo: montarCorpo(d.porEmpresa) }
    ];

    secoes.forEach(s => {
        if (!s.corpo || s.corpo.length === 0) return;
        doc.setFontSize(11);
        doc.setTextColor(...cor);
        doc.text(s.titulo, 14, startY + 4);

        doc.autoTable({
            head: [cabecalho],
            body: s.corpo,
            startY: startY + 7,
            theme: "grid",
            headStyles: { fillColor: cor },
            margin: { left: 14, right: 14 },
            styles: { fontSize: 8 },
            didDrawPage: function(data) { data.settings.margin.top = 10; }
        });

        startY = doc.lastAutoTable.finalY + 10;
    });

    if (estilo) _pdfRodapes(doc, estilo, `Fretes — ${mesLabel}`);
    doc.save(`fretes-${d.mes}.pdf`);
}

// ========== EXPORTAÇÃO CSV ==========
function exportarFretesCSV() {
    if (!dadosFretesAtual || dadosFretesAtual.totalNotas === 0) {
        mostrarToast("Não há dados para exportar.", "aviso", 4000);
        return;
    }
    const d = dadosFretesAtual;
    const linhas = [];

    // Vírgula decimal: com ponto, o Excel em português lê a coluna como
    // texto e não soma (17/09/2026).
    const brTaxa = g => { const t = _taxaFreteGrupo(g); return t > 0 ? t.toFixed(4).replace('.', ',') : ''; };
    const br = (v, casas) => (Number(v) || 0).toFixed(casas).replace('.', ',');
    const totalCsv = (lista, colunas) => {
        const viagens = lista.reduce((s2, x) => s2 + (x.viagens || 0), 0);
        const litros  = lista.reduce((s2, x) => s2 + (x.litros  || 0), 0);
        const frete   = lista.reduce((s2, x) => s2 + (x.frete   || 0), 0);
        return colunas === 6
            ? ["TOTAL", "", viagens, br(litros, 3), "", br(frete, 2)]
            : ["TOTAL", viagens, br(litros, 3), "", br(frete, 2)];
    };

    linhas.push(['"RESUMO DE FRETES"', `"${nomeMes(d.mes)}"`, "", "", ""]);
    linhas.push([`"Notas: ${d.totalNotas}"`, `"Litros: ${br(d.totalLitros, 3)} L"`, `"Frete Total: R$ ${br(d.totalFrete, 2)}"`, "", ""]);
    linhas.push([]);

    linhas.push(["POR PLACA"]);
    linhas.push(["Placa", "Conjunto", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porPlaca.forEach(p => {
        linhas.push([p.nome, p.conjunto || "—", p.viagens, br(p.litros, 3), brTaxa(p), br(p.frete, 2)]);
        Object.entries(p.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", "", br(det.litros, 3), "", br(det.frete, 2)]);
        });
    });
    linhas.push(totalCsv(d.porPlaca, 6));
    linhas.push([]);

    linhas.push(["POR CONJUNTO"]);
    linhas.push(["Conjunto", "", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porConjunto.forEach(c => {
        linhas.push([c.nome, "", c.viagens, br(c.litros, 3), brTaxa(c), br(c.frete, 2)]);
        Object.entries(c.porPlacaInterna).forEach(([placa, det]) => {
            linhas.push([`  ↳ ${placa}`, "", det.viagens, br(det.litros, 3), "", br(det.frete, 2)]);
        });
    });
    linhas.push(totalCsv(d.porConjunto, 6));
    linhas.push([]);

    linhas.push(["POR MOTORISTA"]);
    linhas.push(["Motorista", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porMotorista.forEach(m => {
        linhas.push([m.nome, m.viagens, br(m.litros, 3), brTaxa(m), br(m.frete, 2)]);
        Object.entries(m.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", br(det.litros, 3), "", br(det.frete, 2)]);
        });
    });
    linhas.push(totalCsv(d.porMotorista, 5));
    linhas.push([]);

    linhas.push(["POR EMPRESA"]);
    linhas.push(["Empresa", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)"]);
    d.porEmpresa.forEach(e => {
        linhas.push([e.nome, e.viagens, br(e.litros, 3), brTaxa(e), br(e.frete, 2)]);
        Object.entries(e.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", br(det.litros, 3), "", br(det.frete, 2)]);
        });
    });
    linhas.push(totalCsv(d.porEmpresa, 5));

    const csv = linhas.map(row => row.map(_celulaCSV).join(';')).join('\n');
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fretes-${d.mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ========== IMPRESSÃO ==========
function imprimirFretes() {
    if (!dadosFretesAtual || dadosFretesAtual.totalNotas === 0) {
        mostrarToast("Não há dados para imprimir.", "aviso", 4000);
        return;
    }

    const d = dadosFretesAtual;
    const mesLabel = nomeMes(d.mes);
    const dataHoje = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });

    document.getElementById("impressaoTitulo").textContent = `Fretes — ${mesLabel}`;
    document.getElementById("impressaoData").textContent = `Impresso em: ${dataHoje} | ${d.totalNotas} nota(s) | ${d.totalLitros.toFixed(0)} L | Frete Total: R$ ${d.totalFrete.toFixed(2)}`;

    const montarTabela = (titulo, lista) => {
        const linhas = lista.map(item => `
            <tr>
                <td><strong>${escapeHtml(item.nome)}</strong></td>
                <td>${item.viagens}</td>
                <td>${item.litros.toFixed(3)} L</td>
                <td>${_taxaGrupoMoeda(item)}</td>
                <td><strong>R$ ${item.frete.toFixed(2)}</strong></td>
            </tr>
            ${Object.entries(item.detalhes).map(([tipo, det]) => `
                <tr style="color:#666; font-size:0.85em">
                    <td style="padding-left:20px">↳ ${escapeHtml(tipo)}</td>
                    <td></td>
                    <td>${det.litros.toFixed(3)} L</td>
                    <td></td>
                    <td>${det.frete > 0 ? "R$ " + det.frete.toFixed(2) : "—"}</td>
                </tr>
            `).join("")}
        `).join("");

        return `
            <h3 style="margin-top:20px">${titulo}</h3>
            <table>
                <thead><tr>
                    <th>Nome</th><th>Viagens</th><th>Litros</th><th>Taxa (R$/L)</th><th>Frete (R$)</th>
                </tr></thead>
                <tbody>${linhas}</tbody>
            </table>
        `;
    };

    const montarTabelaConjuntos = () => {
        if (!d.porConjunto || d.porConjunto.length === 0) return "";
        const linhas = d.porConjunto.map(c => `
            <tr style="background:#f0f0f0">
                <td><strong>${escapeHtml(c.nome)}</strong></td>
                <td><strong>${c.viagens}</strong></td>
                <td><strong>${c.litros.toFixed(3)} L</strong></td>
                <td>${_taxaGrupoMoeda(c)}</td>
                <td><strong>R$ ${c.frete.toFixed(2)}</strong></td>
            </tr>
            ${Object.entries(c.porPlacaInterna).map(([placa, det]) => `
                <tr style="color:#444; font-size:0.85em">
                    <td style="padding-left:16px">${escapeHtml(placa)}</td>
                    <td>${det.viagens}</td>
                    <td>${det.litros.toFixed(3)} L</td>
                    <td></td>
                    <td>${det.frete > 0 ? "R$ " + det.frete.toFixed(2) : "—"}</td>
                </tr>
            `).join("")}
        `).join("");
        return `
            <h3 style="margin-top:20px">Por Conjunto</h3>
            <table>
                <thead><tr><th>Conjunto / Placa</th><th>Viagens</th><th>Litros</th><th>Taxa</th><th>Frete (R$)</th></tr></thead>
                <tbody>${linhas}</tbody>
            </table>
        `;
    };

    document.getElementById("impressaoConteudo").innerHTML =
        montarTabelaConjuntos() +
        montarTabela("Por Placa",     d.porPlaca) +
        montarTabela("Por Motorista", d.porMotorista) +
        montarTabela("Por Empresa",   d.porEmpresa);

    window.print();
}
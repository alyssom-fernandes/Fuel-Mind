/*=================================================
  FRETES, FASE 8 + EXPORTAÇÃO CSV + FILTRO GLOBAL
  + AGRUPAMENTO POR CONJUNTO DE VEÍCULOS
  Lógica: para cada mês, agrupa os lançamentos por
  Placa, Motorista, Empresa e Conjunto, calculando:
    Litros transportados (qtd carga)
    Frete = litros × taxa da empresa do lançamento
  A taxa é atributo da empresa contratante: vive em
  db.empresas[].taxaFrete e é editada no cadastro de
  Empresas. Não varia por combustível.
  FIX: garantirConjuntos() chamado antes de processar para
       garantir que db.conjuntosVeiculos existe
=================================================*/

let dadosFretesAtual = null;

/*=================================================
  TAXA DE FRETE: LEITURA
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
 * Taxa a exibir para um agrupamento que pode reunir mais de uma empresa:
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
    return taxa > 0 ? fmtFreteL(taxa) : "—";
}

/** Taxa do grupo como NÚMERO, para a célula da planilha somar e ordenar.
    Vazio quando o grupo mistura taxas diferentes.
    Duas casas desde 22/09/2026, para a planilha dizer o mesmo que a tela. */
function _taxaGrupoNum(grupo) {
    const taxa = _taxaFreteGrupo(grupo);
    return taxa > 0 ? Number(taxa.toFixed(2)) : "";
}

/** Taxa do grupo com prefixo R$, para PDF e impressão. */
function _taxaGrupoMoeda(grupo) {
    const taxa = _taxaFreteGrupo(grupo);
    return taxa > 0 ? fmtFreteL(taxa) : "—";
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

/* ── O MÊS EM NÚMEROS (18/09/2026) ─────────────────────────────────
   Este resumo nunca apareceu: a classe `.resumo` nasce escondida e nada
   aqui a mostrava. O frete total do mês, o número que a tela existe para
   dar, ficava invisível. Agora são cartões no topo, cada um comparado ao
   mês anterior pela MESMA conta (`calcularFretesDoMes`). */
function renderFreteResumo() {
    const resumo = document.getElementById("fretesResumoMes");
    if (!resumo || !dadosFretesAtual) return;
    const d = dadosFretesAtual;

    // Mês sem descarga: um aviso de verdade, e a barra de exportar some.
    // Antes ela ficava ali para exportar um mês vazio.
    const barra = document.getElementById("fretesBarraExportacao");
    if (barra) barra.style.display = d.totalNotas === 0 ? "none" : "";
    if (d.totalNotas === 0) {
        resumo.innerHTML = `<div class="estado-vazio-cartao">
            <strong>Nenhuma nota descarregada em ${nomeMes(d.mes)}</strong>
            <span>O frete conta pela data da descarga. Escolha outro mês acima ou confira os lançamentos.</span>
        </div>`;
        return;
    }

    const [ano, mes] = d.mes.split("-").map(Number);
    const ref = new Date(ano, mes - 2, 1);
    const mesAnt = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
    const ant = calcularFretesDoMes({
        lancamentos: db.lancamentos,
        mes: mesAnt,
        empresaFiltro: empresaFiltroGlobal,
        empresaDoLancamento: _empresaDoLancamentoFrete,
        resolverConjunto: typeof resolverConjuntoEPeriodo === 'function' ? resolverConjuntoEPeriodo : null
    });
    const rot = nomeMes(mesAnt);
    const porLitro    = d.totalLitros > 0 ? d.totalFrete / d.totalLitros : 0;
    const porLitroAnt = ant.totalLitros > 0 ? ant.totalFrete / ant.totalLitros : 0;

    const avisos = [
        d.semTaxa ? `${d.semTaxa} nota(s) com empresa que não está no cadastro: entraram sem taxa (R$ 0,00). Corrija a empresa dessas notas.` : '',
        d.taxaZero ? `${d.taxaZero} nota(s) de ${(d.empresasTaxaZero || []).join(', ')}: a empresa está cadastrada com taxa de frete zerada, então o frete saiu R$ 0,00. Informe a taxa em Cadastros › Empresas.` : '',
    ].filter(Boolean);

    resumo.innerHTML = `
        <div class="kpi-container kpi-container--fretes">
            <div class="kpi-card">
                <div class="kpi-valor">${fmtR(d.totalFrete)}</div>
                <div class="kpi-label">Frete de ${escapeHtml(nomeMes(d.mes))}</div>
                <div class="kpi-base">pela data da descarga, com a taxa de cada data</div>
                ${htmlVariacao(d.totalFrete, ant.totalFrete, rot, true)}
            </div>
            <div class="kpi-card verde">
                <div class="kpi-valor">${fmtL(d.totalLitros)}</div>
                <div class="kpi-label">Litros transportados</div>
                <div class="kpi-base">a carga das notas</div>
                ${htmlVariacao(d.totalLitros, ant.totalLitros, rot, false)}
            </div>
            <div class="kpi-card laranja">
                <div class="kpi-valor">${d.totalNotas}</div>
                <div class="kpi-label">Notas descarregadas</div>
                <div class="kpi-base">no mês</div>
                ${htmlVariacao(d.totalNotas, ant.totalNotas, rot, false)}
            </div>
            <div class="kpi-card roxo">
                <div class="kpi-valor">${fmtFreteL(porLitro)}</div>
                <div class="kpi-label">Frete por litro</div>
                <div class="kpi-base">frete ÷ litros do mês</div>
                ${htmlVariacao(porLitro, porLitroAnt, rot, true)}
            </div>
        </div>
        ${avisos.map(t => `<div class="faixa-validacao faixa-bloqueio faixa-estado">${escapeHtml(t)}</div>`).join('')}`;
}

/**
 * Sublinhas de quebra por combustível.
 *
 * A célula de taxa fica vazia de propósito: a taxa é da empresa e já
 * aparece na linha principal do grupo. Repeti-la em cada combustível
 * daria a impressão falsa de que ela varia por produto.
 *
 * `colunasNome` é quantas colunas iniciais o rótulo ocupa, já que as
 * tabelas têm larguras diferentes (Por Placa tem a coluna Conjunto a
 * mais). Sem isso as sublinhas caem sob os cabeçalhos errados.
 */
function linhasDetalhes(detalhes, colunasNome = 2, comPagamento = false) {
    // Bolinha na cor do combustível (a mesma dos gráficos) no lugar do "↳",
    // e as células de número pela classe: na tabela Por Placa a 2ª coluna
    // é texto, e a célula de litros da sublinha (que é a 2ª dela, por causa
    // do colspan) saía à esquerda, desalinhada da linha de cima.
    return Object.entries(detalhes).map(([tipo, d]) => `
        <tr class="linha-detalhe-frete">
            <td colspan="${colunasNome}" class="celula-recuada"><span class="frete-sub-cor" style="background:${corDoCombustivel(tipo)}"></span>${escapeHtml(tipo)}</td>
            <td class="celula-num">${_fmtLitrosFrete(d.litros)}</td>
            <td class="celula-num"></td>
            <td class="celula-num">${d.frete > 0 ? fmtR(d.frete) : "—"}</td>
            ${comPagamento ? `<td class="celula-num">${d.pagamento > 0 ? fmtR(d.pagamento) : "—"}</td>` : ""}
        </tr>
    `).join("");
}

/** Litros nas tabelas de frete: sem as três casas quando o número é
 *  inteiro ("158.500 L"); com fração, as três da NF-e. */
function _fmtLitrosFrete(v) {
    const n = Number(v) || 0;
    return fmtL(n, Math.abs(n - Math.round(n)) < 0.0005 ? 0 : 3);
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
            title="Ver as notas desta placa no Histórico, pela data da descarga">
            <td><strong>${escapeHtml(p.nome)}</strong></td>
            <td class="celula-fraca">${escapeHtml(p.conjunto) || "—"}</td>
            <td>${p.viagens}</td>
            <td>${_fmtLitrosFrete(p.litros)}</td>
            <td>${_fmtTaxaGrupo(p)}</td>
            <td><strong>${fmtR(p.frete)}</strong></td>
        </tr>
        ${linhasDetalhes(p.detalhes, 3)}
    `).join("");
}

/* O `title` da célula: de onde saiu o número. Um motorista que rodou para
   as duas empresas no mês tem duas regras somadas, e sem isso a conta na
   calculadora não fecharia. */
function _explicacaoPagamento(grupo) {
    const pcts = [...(grupo.empresas || [])]
        .map(nome => db.empresas.find(e => e.nome === nome))
        .filter(Boolean)
        .map(e => `${e.nome}: ${fmtPct(_percentualMotoristaDaEmpresa(e), 2)} do frete`);
    return pcts.length ? "Pagamento ao motorista\n" + pcts.join("\n")
                       : "Pagamento ao motorista, percentual do frete";
}

function renderAbaMotoristasFrete() {
    const tbody = document.getElementById("tabelaFreteMotoristas");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porMotorista;
    if (lista.length === 0) {
        tbody.innerHTML = linhaTabelaVazia(6, "Nenhuma descarga neste mês",
            "O frete conta pela data da descarga: nenhuma nota foi descarregada no mês escolhido.",
            { texto: "Ver os lançamentos", onclick: "mostrarTela('relatorios')" });
        return;
    }

    tbody.innerHTML = lista.map(m => `
        <tr class="linha-clicavel" onclick="_freteAbreRelatorio('motorista', '${escapeJsAttr(m.nome)}')"
            title="Ver as notas deste motorista no Histórico, pela data da descarga">
            <td><strong>${escapeHtml(m.nome)}</strong></td>
            <td>${m.viagens}</td>
            <td>${_fmtLitrosFrete(m.litros)}</td>
            <td>${_fmtTaxaGrupo(m)}</td>
            <td><strong>${fmtR(m.frete)}</strong></td>
            <td title="${escapeHtml(_explicacaoPagamento(m))}">${m.pagamento > 0 ? fmtR(m.pagamento) : "—"}</td>
        </tr>
        ${linhasDetalhes(m.detalhes, 1, true)}
    `).join("");
}

function renderAbaEmpresasFrete() {
    const tbody = document.getElementById("tabelaFreteEmpresas");
    if (!tbody || !dadosFretesAtual) return;

    const lista = dadosFretesAtual.porEmpresa;
    if (lista.length === 0) {
        tbody.innerHTML = linhaTabelaVazia(6, "Nenhuma descarga neste mês",
            "O frete conta pela data da descarga: nenhuma nota foi descarregada no mês escolhido.",
            { texto: "Ver os lançamentos", onclick: "mostrarTela('relatorios')" });
        return;
    }

    tbody.innerHTML = lista.map(e => `
        <tr>
            <td><strong>${escapeHtml(e.nome)}</strong></td>
            <td>${e.viagens}</td>
            <td>${_fmtLitrosFrete(e.litros)}</td>
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
            <tr class="linha-detalhe-frete linha-detalhe-frete--placa">
                <td class="celula-recuada"><span class="frete-sub-placa">${escapeHtml(placa)}</span></td>
                <td class="celula-num">${d.viagens}</td>
                <td class="celula-num">${_fmtLitrosFrete(d.litros)}</td>
                <td class="celula-num"></td>
                <td class="celula-num">${d.frete > 0 ? fmtR(d.frete) : "—"}</td>
            </tr>
        `).join("");

        return `
            <tr>
                <td><strong>${escapeHtml(c.nome)}</strong></td>
                <td><strong>${c.viagens}</strong></td>
                <td><strong>${_fmtLitrosFrete(c.litros)}</strong></td>
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
   uma nota da virada do mês pode não aparecer, melhor dizer do que
   deixar o operador achar que os dois recortes são o mesmo. */
function _freteAbreRelatorio(campo, valor) {
    if (!dadosFretesAtual || !dadosFretesAtual.mes) return;
    /* O período vai no par da DESCARGA (22/09/2026), e isso apaga o aviso
       que existia aqui.

       Até ontem o Histórico só sabia recortar pela emissão, então este
       clique entregava um mês PARECIDO com o dos Fretes e a função tinha
       de avisar que a nota da virada podia não aparecer. Um aviso é o que
       sobra quando a ferramenta não faz o que se precisa. Com o par da
       descarga no Histórico, o recorte passa a ser o MESMO que gerou o
       número clicado, e a lista fecha com o total de onde se saiu. */
    const mes = dadosFretesAtual.mes;
    const periodo = _mesParaPeriodo(mes);
    const filtros = { descargaInicio: periodo.inicio, descargaFim: periodo.fim };
    filtros[campo] = valor;
    irParaRelatorioFiltrado(filtros,
        `Histórico de ${nomeMes(mes)} filtrado por ${campo} "${valor}", pela data da descarga: `
        + `o mesmo recorte que o frete conta.`);
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
        <div class="grafico-wrapper grafico-wrapper--220"><canvas id="graficoFreteMeses"></canvas></div>
        ${meses.includes(_hojeISO().slice(0, 7)) ? `<p class="dica dica--pequena dica--legenda">* ${nomeMes(_hojeISO().slice(0, 7))} vai só até hoje.</p>` : ''}
        <div class="tabela-container mt-2">
            <table class="tabela-numeros"><thead><tr><th>Mês</th><th>Litros (carga)</th><th>Frete</th><th>R$/L</th></tr></thead>
            <tbody>${serie.map(x => `<tr class="linha-clicavel" onclick="_freteAbrirMes('${x.mes}')" title="Ver o detalhe deste mês">
                <td><strong>${nomeMes(x.mes)}</strong></td>
                <td>${_fmtLitrosFrete(x.litros)}</td>
                <td><strong>${fmtR(x.frete)}</strong></td>
                <td>${x.porLitro > 0 ? fmtFreteL(x.porLitro) : "—"}</td>
            </tr>`).join("")}</tbody></table>
        </div>`;

    if (typeof Chart === "undefined") return;
    const cores = getChartColors();
    if (window._chartFreteMeses) window._chartFreteMeses.destroy();
    window._chartFreteMeses = new Chart(document.getElementById("graficoFreteMeses").getContext("2d"), {
        type: "bar",
        data: {
            // Mês em andamento com asterisco: a barra dele é menor só porque o
            // mês ainda não acabou.
            labels: serie.map(x => x.mes === _hojeISO().slice(0, 7) ? nomeMes(x.mes) + "*" : nomeMes(x.mes)),
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
                    label: ctx => `${fmtR(ctx.raw)} · ${fmtFreteL(serie[ctx.dataIndex].porLitro)}/L`,
                    afterLabel: () => "Clique para abrir este mês"
                } }
            },
            scales: {
                x: { ticks: { color: cores.text, maxRotation: 0, autoSkip: true }, grid: { color: cores.grid } },
                y: { ticks: { color: cores.text, callback: v => fmtEixoR(v) }, grid: { color: cores.grid } }
            }
        }
    });
}

/** Troca o mês do seletor e recalcula: usado pelo gráfico e pela tabela. */
function _freteAbrirMes(mes) {
    const sel = document.getElementById("fretesSelectMes");
    if (!sel) return;
    sel.value = mes;
    recalcularTela('fretes', calcularEExibirFretes);
}

/* ── FRETE NOTA A NOTA (17/09/2026) ─────────────────────────────────
   As quatro abas somam por grupo, e o detalhe parava no tipo de
   combustível. Quando um transportador questiona um valor, o que resolve
   é a lista "nota, data, litros, taxa, R$", que antes só saía cruzando
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
        <div class="modal modal--tabela" role="dialog" aria-label="Frete nota a nota" onclick="event.stopPropagation()">
            <div class="modal-cabecalho">
                <h3>Frete nota a nota de ${nomeMes(dadosFretesAtual.mes)} <span class="modal-titulo-apoio">${escapeHtml(empresaFiltroGlobal || '')}</span></h3>
                <button class="modal-fechar" aria-label="Fechar" title="Fechar" onclick="document.getElementById('_modalFreteNotas').remove()">✕</button>
            </div>
            <p class="dica mb-3">Pela data da descarga, com a taxa que valia em cada data. É esta lista que responde a um transportador que questiona um valor.</p>
            <div class="tabela-container tabela-container--rolagem">
                <!-- Sem a coluna Empresa: a lista é sempre da empresa ativa, que
                     está no título (o Excel continua com ela). -->
                <table class="tabela-frete-notas"><thead><tr>
                    <th>Descarga</th><th>Emissão</th><th>Nota</th>
                    <th>Motorista</th><th>Placa</th><th>Conjunto</th>
                    <th class="celula-num">Litros (carga)</th><th class="celula-num">Taxa</th><th class="celula-num">Frete</th>
                </tr></thead>
                <tbody>${linhas.map(x => `<tr>
                    <td>${formatarData(x.descarga)}</td>
                    <td>${formatarData(x.emissao)}</td>
                    <td>${escapeHtml(x.nota)}</td>
                    <td class="celula-texto-longo" title="${escapeHtml(x.motorista)}">${escapeHtml(x.motorista)}</td>
                    <td>${escapeHtml(x.placa)}</td>
                    <td class="celula-texto-longo" title="${escapeHtml(x.conjunto)}">${escapeHtml(x.conjunto) || "—"}</td>
                    <td class="celula-num">${fmtL(x.litros, Number.isInteger(x.litros) ? 0 : 3)}</td>
                    <td class="celula-num">${x.taxa > 0 ? fmtFreteL(x.taxa) : "—"}</td>
                    <td class="celula-num"><strong>${fmtR(x.frete)}</strong></td>
                </tr>`).join("")}</tbody>
                <tfoot><tr>
                    <td colspan="6"><strong>Total: ${linhas.length} nota(s)</strong></td>
                    <td class="celula-num"><strong>${fmtL(totalLitros, Number.isInteger(totalLitros) ? 0 : 3)}</strong></td>
                    <td></td>
                    <td class="celula-num"><strong>${fmtR(totalFrete)}</strong></td>
                </tr></tfoot>
                </table>
            </div>
            <div class="modal-acoes">
                <button class="btn-secundario" onclick="exportarFreteNotaANota()">Excel desta lista</button>
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
        [`FRETE NOTA A NOTA DE ${nomeMes(dadosFretesAtual.mes)}`],
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

    linhas.push([`RESUMO DE FRETES DE ${mesLabel}`]);
    linhas.push([`Notas: ${d.totalNotas}`, `Litros: ${fmtL(d.totalLitros)}`, `Frete total: ${fmtR(d.totalFrete)}`]);
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
    linhas.push(["Motorista", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)", "A pagar (R$)"]);
    d.porMotorista.forEach(m => {
        linhas.push([m.nome, m.viagens, _num(m.litros, 3), _taxaGrupoNum(m), _num(m.frete, 2), _num(m.pagamento, 2)]);
        Object.entries(m.detalhes).forEach(([tipo, det]) => {
            linhas.push([`  ↳ ${tipo}`, "", _num(det.litros, 3), "", _num(det.frete, 2), _num(det.pagamento, 2)]);
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

    if (_so_linhas_fretes) return linhas;
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fretes");
    XLSX.writeFile(wb, `fretes-${d.mes}.xlsx`);
}

/* ── FECHAMENTO DO MÊS, NUM ARQUIVO SÓ (18/09/2026) ────────────────
   O que a pesquisa de relatórios achou de mais elogiado, e que dá para
   fazer sem servidor: o "pacote pronto": tudo o que fecha o mês num
   clique, em vez de três exportações separadas. Um Excel com três abas:
   o resumo de fretes (por placa, conjunto, motorista e empresa), o frete
   nota a nota e as notas do mês pela emissão. Um arquivo só também evita
   o navegador bloquear vários downloads seguidos. */
let _so_linhas_fretes = false;

function exportarFechamentoDoMes() {
    if (adiarAteBibliotecas(["xlsx"], () => exportarFechamentoDoMes())) return;
    if (!dadosFretesAtual || !dadosFretesAtual.mes) return mostrarToast("Escolha o mês primeiro.", "aviso", 4000);
    const mes = dadosFretesAtual.mes;
    const wb = XLSX.utils.book_new();

    // 1) Resumo de fretes: as mesmas linhas do Excel de Fretes
    _so_linhas_fretes = true;
    let resumo;
    try { resumo = exportarFretesExcel(); } finally { _so_linhas_fretes = false; }
    if (Array.isArray(resumo)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), "Resumo de fretes");

    // 2) Frete nota a nota
    const notas = _freteNotaANota(mes);
    const aoaNotas = [
        [`FRETE NOTA A NOTA DE ${nomeMes(mes)}`],
        [`${empresaFiltroGlobal || "Todas as empresas"} · pela data da descarga`],
        [],
        ["Descarga", "Emissão", "Nota", "Empresa", "Motorista", "Placa", "Conjunto", "Litros (carga)", "Taxa (R$/L)", "Frete (R$)"]
    ];
    notas.forEach(x => aoaNotas.push([formatarData(x.descarga), formatarData(x.emissao), x.nota, x.empresa,
        x.motorista, x.placa, x.conjunto, _num(x.litros, 3), _num(x.taxa, 4), _num(x.frete, 2)]));
    aoaNotas.push([]);
    aoaNotas.push(["TOTAL", "", `${notas.length} nota(s)`, "", "", "", "",
        _num(notas.reduce((s2, x) => s2 + x.litros, 0), 3), "", _num(notas.reduce((s2, x) => s2 + x.frete, 0), 2)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoaNotas), "Frete nota a nota");

    // 3) Notas do mês pela emissão (a base do gasto e do preço)
    const doMes = db.lancamentos.filter(l => lancamentoAtivo(l)
        && (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal)
        && dataEmissaoDe(l).startsWith(mes))
        .sort((a, b) => dataEmissaoDe(a).localeCompare(dataEmissaoDe(b)));
    const m = metricasPreco(doMes.flatMap(l => l.itens || []));
    const aoaEntradas = [
        [`NOTAS DE ENTRADA DE ${nomeMes(mes)}, pela data de emissão`],
        [`Preço médio de compra: ${fmtRL(m.precoCompra)}/L sobre ${fmtL3(m.litrosNota)} faturados`],
        [],
        ["Emissão", "Descarga", "Nota", "Base", "Empresa", "Motorista", "Placa", "Litros (carga)", "Litros descarregados", "Total (R$)"]
    ];
    doMes.forEach(l => aoaEntradas.push([
        formatarData(dataEmissaoDe(l)), formatarData(dataDescargaDe(l)), l.numeroNota || "", l.base || "",
        l.empresa || "", l.motorista || "", l.placa || "",
        _num((l.itens || []).reduce((s2, i) => s2 + (Number(i.qtd) || 0), 0), 3),
        _num((l.itens || []).reduce((s2, i) => s2 + _litrosItem(i), 0), 3),
        _num(l.total || 0, 2)
    ]));
    aoaEntradas.push([]);
    aoaEntradas.push(["TOTAL", "", `${doMes.length} nota(s)`, "", "", "", "",
        _num(m.litrosNota, 3),
        _num(doMes.reduce((s2, l) => s2 + (l.itens || []).reduce((ss, i) => ss + _litrosItem(i), 0), 0), 3),
        _num(doMes.reduce((s2, l) => s2 + (l.total || 0), 0), 2)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoaEntradas), "Notas do mês");

    XLSX.writeFile(wb, `fechamento-${mes}${empresaFiltroGlobal ? "-" + normalizarTexto(empresaFiltroGlobal).replace(/\s+/g, "-") : ""}.xlsx`);
    mostrarToast(`Fechamento de ${nomeMes(mes)} gerado: resumo de fretes, frete nota a nota e notas do mês, num arquivo só.`, "sucesso", 5000);
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
        yCab = _pdfCabecalho(doc, estilo, `Resumo de fretes de ${mesLabel}`,
            `${empresaFiltroGlobal || "Todas as empresas"} · pela data da descarga · gerado em ${new Date().toLocaleDateString("pt-BR")}`);
    }
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`Notas: ${d.totalNotas}  |  Litros (carga): ${fmtL3(d.totalLitros)}  |  Frete total: ${fmtR(d.totalFrete)}`, _PDF_MARGEM, yCab);

    const cabecalho = ["Nome", "Viagens", "Litros", "Taxa (R$/L)", "Frete"];
    // Só a tabela de motoristas tem a coluna do pagamento: ela é a folha que
    // vai virar pagamento, e repetir o número nas outras três só somaria
    // ruído a uma página que já é densa (22/09/2026).
    const cabecalhoMotorista = [...cabecalho, "A pagar"];

    // Números em português ("158.500 L", "R$ 42.140,00"): com `toFixed` o
    // PDF saía "158500.000" e "R$ 42140.00". E as sublinhas usam "·": o
    // "↳" não existe na fonte padrão do PDF e virava lixo (18/09/2026).
    const sub = { fontSize: 7.5, textColor: [90, 90, 90] };
    const montarCorpo = (lista, comPagamento = false) => {
        const rows = [];
        lista.forEach(item => {
            const linha = [{ content: item.nome, styles: { fontStyle: "bold" } }, item.viagens, _fmtLitrosFrete(item.litros), _taxaGrupoMoeda(item), { content: fmtR(item.frete), styles: { fontStyle: "bold" } }];
            if (comPagamento) linha.push(item.pagamento > 0 ? fmtR(item.pagamento) : "—");
            rows.push(linha);
            Object.entries(item.detalhes).forEach(([tipo, det]) => {
                const sublinha = [
                    { content: `   · ${tipo}`, styles: sub }, "",
                    { content: _fmtLitrosFrete(det.litros), styles: sub },
                    "",
                    { content: det.frete > 0 ? fmtR(det.frete) : "—", styles: sub }
                ];
                if (comPagamento) sublinha.push({ content: det.pagamento > 0 ? fmtR(det.pagamento) : "—", styles: sub });
                rows.push(sublinha);
            });
        });
        return rows;
    };

    const montarCorpoConjuntos = (lista) => {
        const rows = [];
        lista.forEach(c => {
            rows.push([{ content: c.nome, styles: { fontStyle: "bold" } }, c.viagens, _fmtLitrosFrete(c.litros), _taxaGrupoMoeda(c), { content: fmtR(c.frete), styles: { fontStyle: "bold" } }]);
            Object.entries(c.porPlacaInterna).forEach(([placa, det]) => {
                rows.push([`   ${placa}`, det.viagens, _fmtLitrosFrete(det.litros), "", det.frete > 0 ? fmtR(det.frete) : "—"]);
            });
            Object.entries(c.detalhes).forEach(([tipo, det]) => {
                rows.push([{ content: `      · ${tipo}`, styles: sub }, "", { content: _fmtLitrosFrete(det.litros), styles: sub }, "", { content: det.frete > 0 ? fmtR(det.frete) : "—", styles: sub }]);
            });
        });
        return rows;
    };

    let startY = yCab + 4;

    const secoes = [
        { titulo: "Por conjunto",   corpo: montarCorpoConjuntos(d.porConjunto) },
        { titulo: "Por placa",      corpo: montarCorpo(d.porPlaca) },
        { titulo: "Por motorista",  corpo: montarCorpo(d.porMotorista, true), cabecalho: cabecalhoMotorista },
        { titulo: "Por empresa",    corpo: montarCorpo(d.porEmpresa) }
    ];

    secoes.forEach(s => {
        if (!s.corpo || s.corpo.length === 0) return;
        doc.setFontSize(11);
        doc.setTextColor(...cor);
        doc.text(s.titulo, _PDF_MARGEM, startY + 4);

        doc.autoTable({
            head: [s.cabecalho || cabecalho],
            body: s.corpo,
            startY: startY + 7,
            theme: "grid",
            headStyles: { fillColor: cor },
            margin: { left: _PDF_MARGEM, right: _PDF_MARGEM },
            styles: { fontSize: 8 },
            // Larguras fixas nas colunas de número: as quatro tabelas ficam
            // alinhadas umas com as outras na página.
            columnStyles: { 1: { halign: "right", cellWidth: 20 }, 2: { halign: "right", cellWidth: 32 }, 3: { halign: "right", cellWidth: 28 }, 4: { halign: "right", cellWidth: 34 }, 5: { halign: "right", cellWidth: 26 } },
            didParseCell: function(data) { if (data.section === "head" && data.column.index >= 1) data.cell.styles.halign = "right"; },
            didDrawPage: function(data) { data.settings.margin.top = 10; }
        });

        startY = doc.lastAutoTable.finalY + 10;
    });

    if (estilo) _pdfRodapes(doc, estilo, `Fretes de ${mesLabel}`);
    _pdfEntregar(doc, `fretes-${d.mes}.pdf`);
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
    const brTaxa = g => { const t = _taxaFreteGrupo(g); return t > 0 ? t.toFixed(2).replace('.', ',') : ''; };
    const br = (v, casas) => (Number(v) || 0).toFixed(casas).replace('.', ',');
    const totalCsv = (lista, colunas) => {
        const viagens = lista.reduce((s2, x) => s2 + (x.viagens || 0), 0);
        const litros  = lista.reduce((s2, x) => s2 + (x.litros  || 0), 0);
        const frete   = lista.reduce((s2, x) => s2 + (x.frete   || 0), 0);
        return colunas === 6
            ? ["TOTAL", "", viagens, br(litros, 3), "", br(frete, 2)]
            : ["TOTAL", viagens, br(litros, 3), "", br(frete, 2)];
    };

    // Sem aspas à mão: `_celulaCSV` já põe as aspas, e as duas juntas saíam
    // no Excel como texto "entre aspas" (18/09/2026).
    linhas.push(["RESUMO DE FRETES", nomeMes(d.mes), "", "", ""]);
    linhas.push([`Notas: ${d.totalNotas}`, `Litros: ${fmtL3(d.totalLitros)}`, `Frete total: ${fmtR(d.totalFrete)}`, "", ""]);
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
    linhas.push(["Motorista", "Viagens", "Litros (L)", "Taxa (R$/L)", "Frete (R$)", "A pagar (R$)"]);
    d.porMotorista.forEach(m => {
        linhas.push([m.nome, m.viagens, br(m.litros, 3), brTaxa(m), br(m.frete, 2), br(m.pagamento, 2)]);
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

    document.getElementById("impressaoTitulo").textContent = `Fretes de ${mesLabel}`;
    document.getElementById("impressaoData").textContent = `${empresaFiltroGlobal ? empresaFiltroGlobal + " | " : ""}Pela data da descarga | Impresso em: ${dataHoje} | ${d.totalNotas} nota(s) | ${fmtL(d.totalLitros)} | Frete total: ${fmtR(d.totalFrete)}`;

    const montarTabela = (titulo, lista) => {
        const linhas = lista.map(item => `
            <tr>
                <td><strong>${escapeHtml(item.nome)}</strong></td>
                <td>${item.viagens}</td>
                <td>${_fmtLitrosFrete(item.litros)}</td>
                <td>${_taxaGrupoMoeda(item)}</td>
                <td><strong>${fmtR(item.frete)}</strong></td>
            </tr>
            ${Object.entries(item.detalhes).map(([tipo, det]) => `
                <tr class="imp-subitem">
                    <td class="imp-recuo">· ${escapeHtml(tipo)}</td>
                    <td></td>
                    <td>${_fmtLitrosFrete(det.litros)}</td>
                    <td></td>
                    <td>${det.frete > 0 ? fmtR(det.frete) : "—"}</td>
                </tr>
            `).join("")}
        `).join("");

        return `
            <h3 class="imp-titulo">${titulo}</h3>
            <table class="imp-num-resto">
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
            <tr class="imp-grupo">
                <td><strong>${escapeHtml(c.nome)}</strong></td>
                <td><strong>${c.viagens}</strong></td>
                <td><strong>${_fmtLitrosFrete(c.litros)}</strong></td>
                <td>${_taxaGrupoMoeda(c)}</td>
                <td><strong>${fmtR(c.frete)}</strong></td>
            </tr>
            ${Object.entries(c.porPlacaInterna).map(([placa, det]) => `
                <tr class="imp-subitem imp-subitem--escuro">
                    <td class="imp-recuo">${escapeHtml(placa)}</td>

                    <td>${det.viagens}</td>
                    <td>${_fmtLitrosFrete(det.litros)}</td>
                    <td></td>
                    <td>${det.frete > 0 ? fmtR(det.frete) : "—"}</td>
                </tr>
            `).join("")}
        `).join("");
        return `
            <h3 class="imp-titulo">Por conjunto</h3>
            <table class="imp-num-resto">
                <thead><tr><th>Conjunto / Placa</th><th>Viagens</th><th>Litros</th><th>Taxa</th><th>Frete (R$)</th></tr></thead>
                <tbody>${linhas}</tbody>
            </table>
        `;
    };

    document.getElementById("impressaoConteudo").innerHTML =
        montarTabelaConjuntos() +
        montarTabela("Por placa",     d.porPlaca) +
        montarTabela("Por motorista", d.porMotorista) +
        montarTabela("Por empresa",   d.porEmpresa);

    imprimirAreaDeImpressao();
}
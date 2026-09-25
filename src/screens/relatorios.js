/*=================================================
  RELATORIOS.JS – com exportação CSV, layout melhorado,
  correção do filtro de datas, links diretos e filtro global por empresa
  FIX: alert() de exportação substituídos por mostrarToast
  v2: ordenação por litros e valor; detalhe inline colapsável;
      manter filtros após editar lançamento
  v3: exportarPDF expandido: logo, margens, cor, fonte,
      quebra por mês, rodapé customizável
=================================================*/

// ========== VARIÁVEIS GLOBAIS ==========
/* Dois conjuntos, e a diferença entre eles é o tema 11+19 inteiro.
   `dadosRelatorioAtual` é o que a TABELA mostra: inclui as notas
   canceladas, sempre, e as excluídas quando a caixa está marcada.
   `dadosRelatorioValidos` é o que CONTA: resumo, totais, preço médio,
   agrupamento por combustível, top de motoristas e os seis formatos de
   exportação leem daqui. Um registro que deixou de valer pode ser visto;
   não pode ser somado. */
let dadosRelatorioAtual   = [];
let dadosRelatorioValidos = [];

/* `_litrosItem()`, critério único de litros, vive em utils.js, para que
   Dashboard, Analítico e Relatórios compartilhem exatamente a mesma regra. */

// Paginação
const ITENS_POR_PAGINA = 50;
let paginaRelatorio = 1;

// Ordenação por clique nos cabeçalhos: { campo, dir }
// campo: 'dataNota' | 'dataDesc' | 'litros' | 'total'
// dir: 'desc' | 'asc'
// Padrão pela emissão, que é a data do período desta tela (rodada 11).
let _ordemClique = { campo: 'dataNota', dir: 'desc' };

// Controla qual linha está com detalhe inline aberto
// { contexto: string, id: string }
let _detalheInlineAberto = { contexto: null, id: null };

/*=================================================
  MANTER ESTADO DE FILTROS APÓS EDIÇÃO
=================================================*/
/* ── IR AO RELATÓRIO JÁ FILTRADO ────────────────────────────────────
   O padrão mais elogiado nas ferramentas de painel (o "drill-through" do
   Metabase, o clique no número do Stripe) é o mesmo: quem vê um total
   estranho clica nele e cai na lista que o formou. Aqui não havia nada
   clicável no Dashboard, no Analítico nem nos Fretes, era remontar o
   filtro à mão (17/09/2026).

   O período do Relatório é pela EMISSÃO (rodada 11). Quando o número
   clicado nasce da descarga (os litros do Dashboard, o mês dos Fretes)
   a função avisa, em vez de fingir que os dois recortes são o mesmo. */
function irParaRelatorioFiltrado(filtros, aviso) {
    const f = filtros || {};
    const por = (id, valor) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = valor == null ? "" : valor;
    };
    // Campos não citados voltam ao vazio: filtro pela metade engana mais
    // do que filtro nenhum.
    por("filtroDataInicio", f.inicio);
    por("filtroDataFim",    f.fim);
    // O par da descarga (22/09/2026). É o que faltava para o drill-through
    // ser honesto: os litros do Dashboard e o mês dos Fretes nascem da
    // DESCARGA, e até aqui só existia como filtrar pela emissão. Quem
    // clicava num total de frete caía num recorte diferente do que viu, e
    // a função só podia avisar disso num toast.
    por("filtroDescargaInicio", f.descargaInicio);
    por("filtroDescargaFim",    f.descargaFim);
    por("filtroMotorista",  f.motorista);
    por("filtroPlaca",      f.placa);
    por("filtroCombustivel", f.combustivel);
    por("filtroNota",       f.nota);
    por("filtroBase",       f.base);
    por("filtroBusca",      f.busca);
    const caixa = document.getElementById("filtroMostrarInativos");
    if (caixa) caixa.checked = false;
    mostrarTela("relatorios");
    carregarRelatorio();
    if (aviso) mostrarToast(aviso, "info", 6000);
}

/** Mês "YYYY-MM" para o par de datas do filtro. */
function _mesParaPeriodo(mes) {
    return { inicio: `${mes}-01`, fim: _ultimoDiaDoMesISO(`${mes}-01`) };
}

/* ── SETAS NA TABELA (18/09/2026) ───────────────────────────────────
   Linear e os sistemas de caixa são elogiados pela mesma coisa: andar
   pelas linhas sem tirar a mão do teclado. Com o foco na tabela do
   relatório (Tab até ela, ou clique numa linha), ↑ e ↓ andam de nota em
   nota e Enter abre ou fecha o detalhe, o mesmo que o clique faz. Nada
   é gravado por tecla. */
let _linhaRelAtiva = -1;
function _linhasRelatorioNavegaveis() {
    return [...document.querySelectorAll("#tabelaRelatorio > tr[data-id]")];
}
document.addEventListener("keydown", e => {
    const tabela = document.getElementById("tabelaRelatorio");
    if (!tabela || !tabela.contains(document.activeElement) && document.activeElement !== tabela) return;
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
    const linhas = _linhasRelatorioNavegaveis();
    if (!linhas.length) return;
    if (e.key === "Enter") {
        const tr = linhas[_linhaRelAtiva];
        if (!tr) return;
        e.preventDefault();
        const idx = _linhaRelAtiva;
        tr.querySelector(".btn-ver-inline")?.click();
        // A tabela é redesenhada ao abrir o detalhe: devolve o destaque e o
        // foco para a mesma linha, para as setas continuarem de onde estavam.
        setTimeout(() => {
            const novas = _linhasRelatorioNavegaveis();
            novas.forEach((l, i) => l.classList.toggle("linha-teclado-ativa", i === idx));
            document.getElementById("tabelaRelatorio")?.focus();
        }, 0);
        return;
    }
    e.preventDefault();
    const passo = e.key === "ArrowDown" ? 1 : -1;
    _linhaRelAtiva = _linhaRelAtiva < 0 ? (passo > 0 ? 0 : linhas.length - 1)
        : Math.min(linhas.length - 1, Math.max(0, _linhaRelAtiva + passo));
    linhas.forEach((tr, i) => tr.classList.toggle("linha-teclado-ativa", i === _linhaRelAtiva));
    linhas[_linhaRelAtiva].scrollIntoView({ block: "nearest" });
});

function recarregarRelatorioSemZerarFiltros() {
    _aplicarFiltroRelatorio();
}

function _ordenarPorColuna(campo) {
    if (_ordemClique.campo === campo) {
        _ordemClique.dir = _ordemClique.dir === 'desc' ? 'asc' : 'desc';
    } else {
        _ordemClique.campo = campo;
        _ordemClique.dir = 'desc';
    }
    _aplicarFiltroRelatorio();
}

function _iconeOrdem(campo) {
    if (_ordemClique.campo !== campo) return '<span class="th-sort-icon">↕</span>';
    return _ordemClique.dir === 'desc'
        ? '<span class="th-sort-icon ativo">↓</span>'
        : '<span class="th-sort-icon ativo">↑</span>';
}

/*=================================================
  RELATÓRIOS
=================================================*/
/* ── FILTRO DE TEXTO COM ATRASO ─────────────────────────────────────
   Nota, Base e Busca rápida chamavam carregarRelatorio() a cada tecla, e
   cada chamada varre o vetor de lançamentos duas vezes, ordena e remonta a
   tabela inteira. A busca global já usava 300 ms de atraso (ui.js); estes
   três não. Mesma régua para os dois lugares. */
let _timerFiltroTexto = null;

function carregarRelatorioComAtraso() {
    clearTimeout(_timerFiltroTexto);
    _timerFiltroTexto = setTimeout(() => carregarRelatorio(), 300);
}

function carregarRelatorio() {
    paginaRelatorio = 1;
    _aplicarFiltroRelatorio();
}

/**
 * Texto de um lançamento para a busca livre, em cache.
 *
 * Antes isto era `JSON.stringify(l)` executado sobre CADA lançamento a CADA
 * tecla digitada, reserializava a base inteira, incluindo logs e anexos, por
 * caractere. O cache é invalidado por identidade do objeto: qualquer edição
 * cria um objeto novo no fluxo de save, então um lançamento alterado
 * reindexará sozinho.
 */
const _cacheBusca = new WeakMap();
function _textoBuscavel(l) {
    // O cache também vale por versão dos dados: renomear um cadastro, a
    // correção em massa e a lápide da reimportação mudavam a nota no lugar,
    // e a busca continuava achando pelo valor velho.
    const guardado = _cacheBusca.get(l);
    let txt = guardado && guardado.v === (window._versaoDados || 0) ? guardado.txt : undefined;
    if (txt === undefined) {
        txt = [l.numeroNota, l.empresa, l.motorista, l.placa, l.base, l.observacoes,
               l.dataNota, l.dataDescarga,
               ...(l.itens || []).map(i => i.tipo),
               // Quem criou ou editou: a busca antiga alcançava isso porque
               // serializava o objeto inteiro, e é uso legítimo: "o que o
               // Fulano lançou". Só o nome entra, não a ação nem o timestamp.
               ...(l.logs || []).map(g => (typeof g === 'object' && g) ? g.usuario : g)]
              .filter(Boolean).join(" ");
        // Sem acento, como a busca do Ctrl+K: "jose" acha "José".
        txt = normalizarTexto(txt);
        _cacheBusca.set(l, { v: window._versaoDados || 0, txt });
    }
    return txt;
}

function _aplicarFiltroRelatorio() {
    const dataInicio  = document.getElementById("filtroDataInicio").value;
    const dataFim     = document.getElementById("filtroDataFim").value;
    const descIni     = document.getElementById("filtroDescargaInicio")?.value || "";
    const descFim     = document.getElementById("filtroDescargaFim")?.value || "";
    const motorista   = document.getElementById("filtroMotorista").value;
    const placa       = document.getElementById("filtroPlaca").value;
    const combustivel = document.getElementById("filtroCombustivel").value;
    const nota        = normalizarTexto(document.getElementById("filtroNota").value);
    const base        = normalizarTexto(document.getElementById("filtroBase").value);
    const busca       = normalizarTexto(document.getElementById("filtroBusca").value);

    const mostrarInativos = document.getElementById("filtroMostrarInativos")?.checked;

    const temPeriodo = !!(dataInicio || dataFim);
    const temDescarga = !!(descIni || descFim);
    // A regra dos dois pares mora em `_passaPeriodos` (utils.js), sem DOM,
    // para os testes a cobrirem: é ela que decide quais notas somam.
    const periodos = { emissaoInicio: dataInicio, emissaoFim: dataFim,
                       descargaInicio: descIni,   descargaFim: descFim };

    // Todos os filtros menos o de data. Serve à tabela e à conta das notas
    // da fronteira, logo abaixo.
    const passaSemData = l => {
        if (motorista   && l.motorista !== motorista) return false;
        if (placa       && l.placa !== placa)         return false;
        if (nota        && !normalizarTexto(l.numeroNota).includes(nota)) return false;
        if (base        && !normalizarTexto(l.base).includes(base)) return false;
        if (combustivel && !(l.itens || []).some(i => i.tipo === combustivel)) return false;
        if (busca       && !_textoBuscavel(l).includes(busca)) return false;
        return true;
    };

    dadosRelatorioAtual = db.lancamentos.filter(l => {
        // Os dois estados não têm a mesma visibilidade, e é de propósito.
        //
        // A CANCELADA aparece sempre: ela é um fato do mundo, e esconder
        // uma nota que o emissor cancelou é o caminho mais curto para
        // alguém lançá-la de novo. Ela entra na tabela riscada.
        //
        // A EXCLUÍDA some por padrão (foi um erro de digitação, não um
        // acontecimento) e volta com a caixa "Mostrar excluídas e
        // canceladas", no mesmo espírito do "Mostrar inativos" que as seis
        // abas de Cadastros já têm.
        //
        // Nenhuma das duas entra em conta nenhuma: `dadosRelatorioAtual` é
        // o que a TABELA mostra, e quem soma lê `dadosRelatorioValidos`,
        // logo abaixo.
        if (l.estado === 'excluido' && !mostrarInativos) return false;
        if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;

        // O período do Relatório é pela EMISSÃO (rodada 11, decisão do dono):
        // é um relatório de valores, e o valor é da compra na data em que a
        // nota foi emitida. Antes a nota entrava se QUALQUER das duas datas
        // caísse no intervalo, e uma nota emitida em 31/07 e descarregada em
        // 01/08 aparecia em julho e em agosto: consultados separadamente, os
        // dois meses somavam 29.500 L a mais que o intervalo inteiro no modo
        // demo. A intenção de não esconder nota ficou no resumo, que diz
        // quantas notas da fronteira ficaram de fora.
        //
        // Desde 22/09/2026 o par da DESCARGA vale junto, com E: os dois
        // preenchidos pedem a nota que satisfaz os dois recortes ao mesmo
        // tempo. Sozinho, o par da descarga faz desta tela o espelho exato
        // do que Fretes e Dashboard contam, que era o pedido do dono.
        if ((temPeriodo || temDescarga) && !_passaPeriodos(l, periodos)) return false;

        return passaSemData(l);
    });

    // As notas da fronteira: as que ficam de um lado do período por uma data
    // e do outro pela outra. Só as que valem.
    //
    // A contagem só roda com UM dos dois pares preenchido, e é de propósito:
    // ela existe para declarar a escolha que a tela fez sozinha entre as duas
    // datas. Com os dois pares preenchidos não há escolha a declarar, porque
    // o dono pediu os dois recortes de viva voz, e a etiqueta viraria ruído.
    let emitidasDescarregadasFora = 0, descarregadasEmitidasFora = 0;
    if (temPeriodo !== temDescarga) {
        // O intervalo que manda é o que está preenchido.
        const ini = temPeriodo ? dataInicio : descIni;
        const fim = temPeriodo ? dataFim    : descFim;
        const dentro = (d) => !!d && (!ini || d >= ini) && (!fim || d <= fim);
        db.lancamentos.forEach(l => {
            if (!lancamentoAtivo(l)) return;
            if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return;
            const emissaoDentro  = dentro(dataEmissaoDe(l));
            const descargaDentro = dentro(dataDescargaDe(l));
            if (emissaoDentro === descargaDentro || !passaSemData(l)) return;
            if (emissaoDentro) emitidasDescarregadasFora++;
            else descarregadasEmitidasFora++;
        });
    }

    // Ordenação: cabeçalhos clicáveis; padrão = data de emissão decrescente
    const campo = _ordemClique.campo || 'dataNota';
    const dir   = _ordemClique.dir   || 'desc';
    dadosRelatorioAtual.sort((a, b) => {
        let va, vb;
        if (campo === 'dataDesc') {
            va = a.dataDescarga || a.dataNota || '';
            vb = b.dataDescarga || b.dataNota || '';
            return dir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
        } else if (campo === 'dataNota') {
            va = a.dataNota || ''; vb = b.dataNota || '';
            return dir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
        } else if (campo === 'litros') {
            va = (a.itens || []).reduce((s, i) => s + _litrosItem(i), 0);
            vb = (b.itens || []).reduce((s, i) => s + _litrosItem(i), 0);
            return dir === 'desc' ? vb - va : va - vb;
        } else if (campo === 'total') {
            va = a.total || 0; vb = b.total || 0;
            return dir === 'desc' ? vb - va : va - vb;
        }
        return 0;
    });

    dadosRelatorioValidos = dadosRelatorioAtual.filter(lancamentoAtivo);

    renderTabelaLancamentos("tabelaRelatorio", dadosRelatorioAtual, paginaRelatorio, "relatorio");

    // Atualiza ícones de ordenação nos cabeçalhos clicáveis
    ['dataNota', 'dataDesc', 'litros', 'total'].forEach(campo => {
        const el = document.getElementById(`sort-${campo}`);
        if (!el) return;
        if (_ordemClique.campo === campo) {
            el.textContent = _ordemClique.dir === 'desc' ? '↓' : '↑';
            el.classList.add('ativo');
        } else {
            el.textContent = '↕';
            el.classList.remove('ativo');
        }
    });

    // `|| 0` porque um `total` ausente ou nulo contaminava a soma inteira:
    // o resumo passava a exibir "R$ NaN" e o preço médio junto, sem nada
    // indicando de onde veio.
    const totalGeral  = dadosRelatorioValidos.reduce((soma, l) => soma + (l.total || 0), 0);
    const totalLitros = dadosRelatorioValidos.reduce((soma, l) =>
        soma + l.itens.reduce((s, i) => s + _litrosItem(i), 0), 0);
    const resumo = document.getElementById("resumoRelatorio");
    const barra  = document.getElementById("barraExportacaoRelatorio");

    // O que está na tela e não conta: é isto que o resumo declara, para o
    // operador não precisar subtrair de cabeça a linha riscada que ele
    // está vendo.
    const foraDaConta = dadosRelatorioAtual.length - dadosRelatorioValidos.length;

    if (dadosRelatorioValidos.length === 0) {
        resumo.style.display = "none";
        if (barra) barra.style.display = "none";
    } else {
        // Agrupamento por combustível
        const porComb = {};
        dadosRelatorioValidos.forEach(l => {
            l.itens.forEach(i => {
                if (!i.tipo) return;
                if (!porComb[i.tipo]) porComb[i.tipo] = { litros: 0, litrosNota: 0, total: 0 };
                porComb[i.tipo].litros     += _litrosItem(i);   // volume: litros descarregados
                porComb[i.tipo].litrosNota += Number(i.qtd) || 0; // preço: litros faturados
                porComb[i.tipo].total      += i.total || 0;
            });
        });

        // Top 3 motoristas por litros
        const porMotorista = {};
        dadosRelatorioValidos.forEach(l => {
            if (!l.motorista) return;
            const litros = l.itens.reduce((s, i) => s + _litrosItem(i), 0);
            porMotorista[l.motorista] = (porMotorista[l.motorista] || 0) + litros;
        });
        const topMotoristas = Object.entries(porMotorista)
            .sort((a, b) => b[1] - a[1]).slice(0, 3);

        // Preço médio de compra: sobre os litros FATURADOS (decisão de
        // 17/09/2026, rodada 12). `totalLitros` continua sendo o volume
        // descarregado, que é o que a tela mostra como litros.
        const mPreco = metricasPreco(dadosRelatorioValidos.flatMap(l => l.itens || []));
        const precoMedio = mPreco.precoCompra;

        // Cards por combustível
        const cardsComb = Object.entries(porComb).map(([comb, d]) => {
            const pm = d.litrosNota > 0 ? d.total / d.litrosNota : 0;
            return `<div class="rel-card">
                <div class="rel-card-titulo">${escapeHtml(comb)}</div>
                <div class="rel-card-valor">${fmtL3(d.litros)}</div>
                <div class="rel-card-linha">${fmtR(d.total)}</div>
                <div class="rel-card-linha rel-card-linha--fraca">${fmtRL(pm)}/L</div>
            </div>`;
        }).join('');

        // Top motoristas
        const topMotHtml = topMotoristas.length ? `
            <div class="rel-card rel-card--lista">
                <div class="rel-card-titulo">Top Motoristas</div>
                ${topMotoristas.map(([nome, litros]) => `
                    <div class="rel-card-item">
                        <span class="rel-card-nome" title="${escapeHtml(nome)}">${escapeHtml(nome)}</span>
                        <span class="rel-card-num">${fmtL(litros, 0)}</span>
                    </div>`).join('')}
            </div>` : '';

        resumo.style.display = "block";
        resumo.innerHTML = `
            <!-- Os totais em destaque: rótulo pequeno em cima, número grande
                 embaixo (18/09/2026). Antes eram uma linha de texto miúdo. -->
            <div class="rel-kpis">
                <div class="rel-kpi">
                    <span class="rel-kpi-rotulo">Lançamentos</span>
                    <strong class="rel-kpi-valor">${dadosRelatorioValidos.length}</strong>
                    ${foraDaConta > 0 ? `<span class="rel-kpi-nota">+ ${foraDaConta} na tela fora dos totais</span>` : ''}
                </div>
                <div class="rel-kpi">
                    <span class="rel-kpi-rotulo">Total</span>
                    <strong class="rel-kpi-valor">${fmtR(totalGeral)}</strong>
                </div>
                <div class="rel-kpi">
                    <span class="rel-kpi-rotulo">Litros</span>
                    <strong class="rel-kpi-valor">${fmtL3(totalLitros)}</strong>
                </div>
                ${precoMedio > 0 ? `<div class="rel-kpi" title="${escapeHtml(explicacaoPrecoCompra(mPreco))}">
                    <span class="rel-kpi-rotulo">Preço médio de compra</span>
                    <strong class="rel-kpi-valor">${fmtRL(precoMedio)}/L</strong>
                    <span class="rel-kpi-nota">sobre ${fmtL3(mPreco.litrosNota)} faturados</span>
                </div>` : ''}
            </div>
            ${_chipsResumoRelatorio({ temPeriodo, temDescarga }, emitidasDescarregadasFora, descarregadasEmitidasFora, mPreco)}
            <div class="rel-cards">
                ${cardsComb}
                ${topMotHtml}
            </div>`;
        if (barra) barra.style.display = "flex";
    }
}

/** O que antes eram duas linhas de texto miúdo abaixo dos totais (de que
 *  data é o período, quem ficou na fronteira e o custo recebido) virou uma
 *  fila de etiquetas curtas; a explicação inteira abre com um clique
 *  (18/09/2026). `<details>` e não `title`: no celular não há mouse. */
function _chipsResumoRelatorio(quais, emitidasFora, descarregadasFora, mPreco) {
    const temPeriodo  = !!(quais && quais.temPeriodo);
    const temDescarga = !!(quais && quais.temDescarga);
    const chips = [];
    // A etiqueta diz de qual data é o período que está valendo. Com os dois
    // pares preenchidos ela diz os dois, porque aí a conta é o cruzamento e
    // não há base "escolhida" a declarar (22/09/2026).
    if (temPeriodo || temDescarga) {
        const base = temPeriodo && temDescarga ? "por emissão e por descarga, as duas ao mesmo tempo"
                   : temPeriodo ? "pela data de emissão"
                   : "pela data da descarga";
        chips.push(`<span class="rel-chip">Período ${base}</span>`);
    }
    // A fronteira só é contada com um dos pares preenchido, e a frase segue
    // a data que manda: com o recorte da descarga, quem entra e quem fica de
    // fora troca de lado.
    if (temPeriodo !== temDescarga) {
        const partes = [];
        const dentro = temPeriodo ? "emitida" : "descarregada";
        const fora   = temPeriodo ? "descarregada" : "emitida";
        if (emitidasFora) {
            const p = emitidasFora > 1 ? 's' : '';
            const incl = temPeriodo ? `<strong>incluída${p}</strong>` : `<strong>não incluída${p}</strong>`;
            partes.push(`${emitidasFora} emitida${p} no período e descarregada${p} fora dele, ${incl}`);
        }
        if (descarregadasFora) {
            const p = descarregadasFora > 1 ? 's' : '';
            const incl = temPeriodo ? `<strong>não incluída${p}</strong>` : `<strong>incluída${p}</strong>`;
            partes.push(`${descarregadasFora} descarregada${p} no período e emitida${p} fora dele, ${incl}`);
        }
        const n = emitidasFora + descarregadasFora;
        if (n) chips.push(`<details class="rel-chip-detalhe">
            <summary class="rel-chip rel-chip--aviso">${n} ${n > 1 ? 'notas' : 'nota'} na fronteira do período</summary>
            <p>O período conta pela data de ${escapeHtml(dentro === "emitida" ? "emissão" : "descarga")}; a de ${escapeHtml(fora === "descarregada" ? "descarga" : "emissão")} destas caiu do outro lado.<br>${partes.join('<br>')}.</p>
        </details>`);
    }
    if (mPreco.custoRecebido > 0) {
        chips.push(`<details class="rel-chip-detalhe">
            <summary class="rel-chip">Recebido ${escapeHtml(fmtRL(mPreco.custoRecebido))}/L</summary>
            <p>Valor das notas com descarga informada ÷ litros medidos: ${escapeHtml(textoCustoRecebido(mPreco))}.</p>
        </details>`);
    }
    return chips.length ? `<div class="rel-chips">${chips.join('')}</div>` : '';
}

function limparFiltros(contexto) {
    if (!contexto || contexto === "relatorio") {
        ["filtroDataInicio","filtroDataFim","filtroDescargaInicio","filtroDescargaFim",
         "filtroMotorista","filtroPlaca","filtroCombustivel","filtroNota","filtroBase","filtroBusca"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        // "Limpar" volta a tela ao padrão, e o padrão é não mostrar excluídas.
        const inativos = document.getElementById("filtroMostrarInativos");
        if (inativos) inativos.checked = false;
        // O alvo do período rápido também volta ao padrão: deixá-lo em
        // "Descarga" depois de limpar tudo faria o próximo "Este mês"
        // preencher um par que quem clicou em Limpar não está mais vendo.
        relatorioAlvoPeriodo("emissao");
        carregarRelatorio();
    }
}

/*=================================================
  RENDER TABELA COM PAGINAÇÃO E DETALHE INLINE
=================================================*/
/**
 * Renderiza a tabela de lançamentos com paginação e suporte a detalhe inline.
 *
 * Usada tanto pelo relatório de entradas quanto pelo histórico:
 * o `contexto` determina qual conjunto de dados e qual paginação usar.
 *
 * @param {string} idTabela  - ID do `<tbody>` onde renderizar as linhas
 * @param {Array}  dados     - Array de lançamentos já filtrados e ordenados
 * @param {number} [pagina=1] - Página atual (1-indexed)
 * @param {'relatorio'} [contexto='relatorio']
 */
function renderTabelaLancamentos(idTabela, dados, pagina = 1, contexto = "relatorio") {
    const tbody = document.getElementById(idTabela);
    const total = dados.length;

    if (total === 0) {
        // O vazio diz por que está vazio: filtro apertado ou empresa sem
        // nota nenhuma são coisas diferentes (17/09/2026).
        const semNotaNenhuma = !db.lancamentos.some(l => lancamentoAtivo(l)
            && (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal));
        tbody.innerHTML = semNotaNenhuma
            ? linhaTabelaVazia(10, "Nenhuma nota lançada ainda",
                `${empresaFiltroGlobal || "Esta empresa"} não tem nenhuma entrada registrada.`,
                { texto: "Lançar a primeira nota", onclick: "mostrarTela('lancamentos')" })
            : linhaTabelaVazia(10, "Nenhuma nota neste filtro",
                "Existem notas nesta empresa, mas nenhuma dentro do período e dos filtros escolhidos.",
                { texto: "Limpar filtros", onclick: "limparFiltros()" });
        _renderPaginacao(idTabela, 0, 0, 0, contexto);
        return;
    }

    const totalPaginas = Math.ceil(total / ITENS_POR_PAGINA);
    const paginaAtual  = Math.min(pagina, totalPaginas);
    const inicio       = (paginaAtual - 1) * ITENS_POR_PAGINA;
    const fim          = Math.min(inicio + ITENS_POR_PAGINA, total);
    const fatia        = dados.slice(inicio, fim);

    // Litros com TRÊS casas, como em todo o resto do sistema. Esta linha
    // declarava um `fmtL` local, sombreando o de utils.js, e arredondava
    // para inteiro (só aqui). A mesma nota lia 3.501 nesta tabela e
    // 3.500,700 no resumo acima dela, no detalhe que abre embaixo, no
    // Excel, no CSV e na impressão. É a tela onde o operador confere
    // antes de exportar, e era a única que mostrava outro número.
    const fmtL = n => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const idInlineAberto = _detalheInlineAberto.contexto === contexto ? _detalheInlineAberto.id : null;

    tbody.innerHTML = fatia.flatMap(l => {
        const totalLitros = (l.itens || []).reduce((s, item) => s + _litrosItem(item), 0);
        const estaAberto  = idInlineAberto === l.id;

        // A linha de um lançamento que não vale mais fica riscada, e o
        // estado vem colado no número da nota, não numa coluna própria.
        // Uma décima primeira coluna, vazia em 99% das linhas, empurrava a
        // de Ações para fora da área visível e cobrava uma rolagem lateral
        // em todo dia normal por causa de uma exceção rara.
        //
        // O badge é o mesmo que a tela de Usuários já usa no usuário
        // desativado: mesmo significado, nenhum vocabulário novo.
        const morto  = !lancamentoAtivo(l);
        const rotulo = l.estado === 'cancelado' ? 'cancelada' : 'excluída';

        // Uma nota por linha (18/09/2026). Antes a coluna de ações empilhava
        // quatro botões e cada linha tinha quase 100 px: cabiam cinco notas
        // na tela. Agora as ações são ícones lado a lado, texto longo é
        // cortado com reticências (o nome inteiro fica no `title`) e clicar
        // em qualquer ponto da linha abre o detalhe.
        const celTexto = v => v
            ? `<td class="celula-texto" title="${escapeHtml(v)}">${escapeHtml(v)}</td>`
            : '<td class="celula-texto">—</td>';
        const idJs  = escapeJsAttr(l.id);
        const ctxJs = escapeJsAttr(contexto);
        const linhaLanc = `
        <tr data-id="${escapeHtml(l.id)}" class="linha-nota${estaAberto ? ' linha-com-detalhe-aberto' : ''}${morto ? ' linha-inativo' : ''}"
            onclick="if (!event.target.closest('button')) toggleDetalheInline('${idJs}', '${ctxJs}')">
            <td class="celula-data">${formatarData(l.dataNota)}</td>
            <td class="celula-data">${formatarData(l.dataDescarga)}</td>
            <td class="celula-nota">${escapeHtml(l.numeroNota)}${morto
                ? ` <span class="badge-inativo-user">${rotulo}</span>` : ''}</td>
            ${celTexto(l.base)}
            ${celTexto(l.motorista)}
            <td class="celula-placa">${escapeHtml(l.placa) || '—'}</td>
            <td class="celula-num">${fmtL(totalLitros)}</td>
            <td class="celula-num celula-dinheiro">${fmtR(l.total).replace(/^R\$\s*/, '')}</td>
            <td class="no-print celula-acoes">
                ${morto ? '' : `
                <button class="btn-icone btn-icone--editar" title="Editar" aria-label="Editar a nota ${escapeHtml(l.numeroNota)}"
                        onclick="editarLancamento('${idJs}')">${_ICONE.editar}</button>
                <button class="btn-icone btn-icone--clonar" title="Clonar" aria-label="Clonar a nota ${escapeHtml(l.numeroNota)}"
                        onclick="clonarLancamento('${idJs}')">${_ICONE.clonar}</button>`}
                ${l.estado === 'excluido'
                    ? `<button class="btn-icone btn-icone--editar" title="Restaurar: devolve este lançamento aos relatórios" aria-label="Restaurar a nota ${escapeHtml(l.numeroNota)}"
                            onclick="restaurarLancamento('${idJs}', '${ctxJs}')">${_ICONE.restaurar}</button>`
                    : l.estado === 'cancelado'
                        ? ''
                        : `<button class="btn-icone btn-icone--excluir" title="Excluir" aria-label="Excluir a nota ${escapeHtml(l.numeroNota)}"
                            onclick="excluirLancamento('${idJs}', '${ctxJs}')">${_ICONE.excluir}</button>`}
                <button class="btn-icone btn-ver-inline${estaAberto ? ' btn-ver-ativo' : ''}" title="${estaAberto ? 'Fechar o detalhe' : 'Ver o detalhe'}"
                        aria-expanded="${estaAberto}" aria-label="${estaAberto ? 'Fechar' : 'Ver'} o detalhe da nota ${escapeHtml(l.numeroNota)}"
                        onclick="toggleDetalheInline('${idJs}', '${ctxJs}')">${_ICONE.abrir}</button>
            </td>
        </tr>`;

        const linhaDetalhe = estaAberto ? `
        <tr class="linha-detalhe-inline no-print">
            <td colspan="9" class="celula-detalhe">
                <div class="detalhe-inline-container" id="detalheInline_${l.id}">
                    ${_buildConteudoDetalhe(l)}
                </div>
            </td>
        </tr>` : '';

        return [linhaLanc, linhaDetalhe];
    }).join("");

    _renderPaginacao(idTabela, paginaAtual, totalPaginas, total, contexto);
}

/*=================================================
  DETALHE INLINE
=================================================*/
/* Ícones das ações da tabela: traço de 2 px, 24x24, os mesmos da barra lateral. */
const _ICONE = {
    editar:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    clonar:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    excluir:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    restaurar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    inativar:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
    reativar:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    abrir:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};

function toggleDetalheInline(id, contexto) {
    const jaAberto = _detalheInlineAberto.id === id && _detalheInlineAberto.contexto === contexto;
    _detalheInlineAberto = jaAberto ? { contexto: null, id: null } : { contexto, id };

    renderTabelaLancamentos("tabelaRelatorio", dadosRelatorioAtual, paginaRelatorio, "relatorio");

    if (!jaAberto) {
        setTimeout(() => {
            const el = document.getElementById(`detalheInline_${id}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 50);
    }
}

function _buildConteudoDetalhe(l) {
    // `data-rotulo`: no celular cada combustível vira uma lista de rótulo e
    // valor, em vez de uma tabela de seis colunas rolando para o lado.
    let htmlItens = (l.itens || []).map(item => `
        <tr>
            <td data-rotulo="Tipo">${escapeHtml(item.tipo)}</td>
            <td data-rotulo="Carga">${fmtL3(item.qtd)}</td>
            <td data-rotulo="Descarga">${item.qtdDescargada ? fmtL3(item.qtdDescargada) : "—"}</td>
            <td data-rotulo="Valor unit.">${fmtRL(item.valor)}</td>
            <td data-rotulo="Total">${fmtR(item.total)}</td>
            <td data-rotulo="Perda">${calcularPerdaBadge(item.tipo, item.qtd, item.qtdDescargada) || "—"}</td>
        </tr>
    `).join("");

    // A lista de anexos herdava a `ul li` das listas de Cadastros: cada
    // anexo virava uma faixa de ponta a ponta, com separador, e a miniatura
    // ficava sozinha numa linha larga e vazia. Agora são fichas lado a lado
    // (`anexo-item`), a imagem abre em aba nova e o arquivo que não é imagem
    // vira uma etiqueta clicável com o nome (21/09/2026).
    let anexosHtml = '';
    if (l.anexos && l.anexos.length > 0) {
        anexosHtml = '<ul class="lista-limpa lista-anexos mb-0">';
        l.anexos.forEach(a => {
            const href = escapeHtml(a.url || a.dados || '');
            const nome = escapeHtml(a.nome || 'anexo');
            const isImagem = a.tipo && a.tipo.startsWith('image/');
            if (isImagem) {
                anexosHtml += `<li class="anexo-item"><a class="anexo-imagem" href="${href}" target="_blank" rel="noopener" title="${nome}"><img src="${href}" class="preview-nf" alt="${nome}"></a></li>`;
            } else {
                anexosHtml += `<li class="anexo-item"><a class="anexo-arquivo" href="${href}" target="_blank" rel="noopener" title="${nome}">${nome}</a></li>`;
            }
        });
        anexosHtml += '</ul>';
    } else {
        anexosHtml = '<span class="rotulo-suave">—</span>';
    }

    // A faixa de estado, quando existe, é a primeira coisa do painel: o
    // detalhe é onde o operador vem entender por que aquela linha está
    // riscada. É também de onde sai o caminho de "cancelada na origem",
    // que é raro demais para virar um quarto botão na linha de todo dia.
    const ultimoEstado = [...(l.logs || [])].reverse().find(g =>
        typeof g === 'object' && g && ['Excluído', 'Cancelado na origem', 'Desfeito na sessão'].includes(g.acao));
    const quandoEstado = ultimoEstado
        ? `${new Date(ultimoEstado.ts).toLocaleString('pt-BR')}`
          + (ultimoEstado.usuario && ultimoEstado.usuario !== '—' ? ` por ${escapeHtml(ultimoEstado.usuario)}` : '')
        : '';

    let faixaEstado = '';
    if (l.estado === 'cancelado') {
        faixaEstado = `<div class="faixa-validacao faixa-bloqueio faixa-estado">
            <strong>Cancelada na origem.</strong> Fora dos litros, do custo médio e do frete.
            ${quandoEstado ? `<br><small>Marcada em ${quandoEstado}.</small>` : ''}
            ${ultimoEstado && ultimoEstado.motivo ? `<br><small>Motivo: ${escapeHtml(ultimoEstado.motivo)}</small>` : ''}
        </div>`;
    } else if (l.estado === 'excluido') {
        faixaEstado = `<div class="faixa-validacao faixa-alerta faixa-estado">
            <strong>Excluída.</strong> Fora dos relatórios e de todos os totais, e pode ser restaurada.
            ${quandoEstado ? `<br><small>Excluída em ${quandoEstado}.</small>` : ''}
        </div>`;
    }

    return `
        <div class="detalhe-inline-inner">
            ${faixaEstado}
            <div class="detalhe-info">
                <div><span>Data Nota</span><strong>${formatarData(l.dataNota)}</strong></div>
                <div><span>Data Descarga</span><strong>${l.dataDescarga ? formatarData(l.dataDescarga) : "—"}</strong></div>
                <div><span>Nota</span><strong>${escapeHtml(l.numeroNota)}</strong></div>
                <div><span>Base</span><strong>${escapeHtml(l.base) || "—"}</strong></div>
                <div><span>Empresa</span><strong>${escapeHtml(l.empresa) || "—"}</strong></div>
                <div><span>Motorista</span><strong>${escapeHtml(l.motorista) || "—"}</strong></div>
                <div><span>Placa</span><strong>${escapeHtml(l.placa) || "—"}</strong></div>
                <div><span>Total</span><strong>${fmtR(l.total)}</strong></div>
            </div>

            <h4 class="detalhe-subtitulo">Combustíveis</h4>
            <div class="detalhe-tabela-rolagem">
            <table class="detalhe-tabela">
                <thead><tr>
                    <th>Tipo</th><th>Carga</th><th>Descarga</th>
                    <th>Valor unit.</th><th>Total</th><th>Perda</th>
                </tr></thead>
                <tbody>${htmlItens}</tbody>
            </table>
            </div>

            ${l.observacoes ? `<div class="detalhe-obs"><strong>Observações</strong><br>${escapeHtml(l.observacoes)}</div>` : ''}

            ${l.anexos && l.anexos.length > 0 ? `
            <div class="detalhe-obs detalhe-obs--historico">
                <strong>Anexos (${l.anexos.length})</strong><br>${anexosHtml}
            </div>` : ''}

            ${l.logs && l.logs.length > 0 ? `
            <details class="detalhe-obs detalhe-obs--historico">
                <summary><strong>Histórico de alterações (${l.logs.length})</strong></summary>
                <ul class="log-list">${l.logs.map(log => {
                    // Suporta log novo (objeto {acao, ts, usuario}) e log antigo (string)
                    if (typeof log === 'object' && log !== null) {
                        const data = new Date(log.ts).toLocaleString('pt-BR');
                        const usuario = log.usuario && log.usuario !== '—' ? `, por ${escapeHtml(log.usuario)}` : '';
                        // O que mudou, e não só que mudou. Até aqui o log
                        // dizia "Editado" e ficava nisso: quem abrisse o
                        // histórico para entender uma divergência não
                        // encontrava nada.
                        const alteracoes = Array.isArray(log.alteracoes) && log.alteracoes.length
                            ? `<ul class="log-diff">${log.alteracoes.map(a =>
                                `<li>${escapeHtml(a.campo)}: <s>${escapeHtml(String(a.de ?? '—'))}</s> → <strong>${escapeHtml(String(a.para ?? '—'))}</strong></li>`
                              ).join('')}</ul>`
                            : '';
                        const motivo = log.motivo
                            ? `<div class="log-motivo">Motivo: ${escapeHtml(log.motivo)}</div>` : '';
                        const alertas = Array.isArray(log.alertas) && log.alertas.length
                            ? `<ul class="log-diff">${log.alertas.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
                            : '';
                        return `<li><strong>${escapeHtml(log.acao)}</strong> em ${data}${usuario}${motivo}${alteracoes}${alertas}</li>`;
                    }
                    return `<li>${escapeHtml(log)}</li>`;
                }).join('')}</ul>
            </details>` : ''}

            ${lancamentoAtivo(l) ? `
            <div class="detalhe-acoes-estado">
                <button class="btn-secundario"
                        onclick="cancelarNaOrigem('${escapeJsAttr(l.id)}')">
                    Marcar como cancelada na origem
                </button>
                <small>Use quando o emissor cancelou a NF-e depois de ela já ter sido lançada.</small>
            </div>` : ''}
        </div>
    `;
}

function fecharDetalhes(contexto) {
    if (_detalheInlineAberto.contexto === contexto) {
        _detalheInlineAberto = { contexto: null, id: null };
    }
}

/*=================================================
  PAGINAÇÃO
=================================================*/
function _renderPaginacao(idTabela, paginaAtual, totalPaginas, totalItens, contexto) {
    const idPag = `paginacao_${idTabela}`;
    let el = document.getElementById(idPag);

    if (!el) {
        el = document.createElement("div");
        el.id = idPag;
        el.className = "paginacao";
        const container = document.getElementById(idTabela).closest(".tabela-container");
        if (container) container.after(el);
    }

    if (totalPaginas <= 1) { el.innerHTML = ""; return; }

    const inicio = ((paginaAtual - 1) * ITENS_POR_PAGINA) + 1;
    const fim    = Math.min(paginaAtual * ITENS_POR_PAGINA, totalItens);

    let pagBtns = "";
    const JANELA = 2;
    for (let p = 1; p <= totalPaginas; p++) {
        if (p === 1 || p === totalPaginas || (p >= paginaAtual - JANELA && p <= paginaAtual + JANELA)) {
            const ativo = p === paginaAtual ? "ativo" : "";
            pagBtns += `<button class="pag-btn ${ativo}" onclick="_irParaPagina(${p}, '${contexto}')">${p}</button>`;
        } else if (p === paginaAtual - JANELA - 1 || p === paginaAtual + JANELA + 1) {
            pagBtns += `<span class="pag-ellipsis">…</span>`;
        }
    }

    el.innerHTML = `
        <div class="pag-info">Exibindo <strong>${inicio}–${fim}</strong> de <strong>${totalItens}</strong> registros</div>
        <div class="pag-controles">
            <button class="pag-btn" onclick="_irParaPagina(${paginaAtual - 1}, '${contexto}')" ${paginaAtual <= 1 ? "disabled" : ""}>‹</button>
            ${pagBtns}
            <button class="pag-btn" onclick="_irParaPagina(${paginaAtual + 1}, '${contexto}')" ${paginaAtual >= totalPaginas ? "disabled" : ""}>›</button>
        </div>
    `;
}

function _irParaPagina(pagina, contexto) {
    if (_detalheInlineAberto.contexto === contexto) {
        _detalheInlineAberto = { contexto: null, id: null };
    }
    paginaRelatorio = pagina;
    renderTabelaLancamentos("tabelaRelatorio", dadosRelatorioAtual, paginaRelatorio, "relatorio");
    document.getElementById("relatorios")
        .querySelector(".tabela-container")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/*=================================================
  EXPORTAÇÕES
=================================================*/

// ========== EXCEL ==========
/**
 * Exporta os dados filtrados do relatório para uma planilha Excel (.xlsx).
 * Usa a biblioteca SheetJS (XLSX) carregada globalmente.
 *
 * @param {'relatorio'} contexto - Rótulo usado no nome do arquivo
 */
/** O período do Histórico em texto, com a base: vai no cabeçalho do PDF, do
 *  Excel, do CSV e das mensagens de WhatsApp e e-mail.
 *
 *  Desde 22/09/2026 são dois pares de datas, e o texto diz os dois: um
 *  arquivo que não declara de qual data é o recorte é um arquivo em que
 *  ninguém pode conferir o total. */
function _trechoPeriodo(rotulo, ini, fim) {
    if (ini && fim) return `${rotulo} de ${formatarData(ini)} a ${formatarData(fim)}`;
    if (ini) return `${rotulo} a partir de ${formatarData(ini)}`;
    if (fim) return `${rotulo} até ${formatarData(fim)}`;
    return "";
}

function _descricaoPeriodoRelatorio() {
    const ini     = document.getElementById("filtroDataInicio")?.value || "";
    const fim     = document.getElementById("filtroDataFim")?.value || "";
    const descIni = document.getElementById("filtroDescargaInicio")?.value || "";
    const descFim = document.getElementById("filtroDescargaFim")?.value || "";
    const partes = [
        _trechoPeriodo("emissão", ini, fim),
        _trechoPeriodo("descarga", descIni, descFim)
    ].filter(Boolean);
    return partes.length ? partes.join(", e ") : "todas as datas";
}

/* ── O NOME DO ARQUIVO (22/09/2026) ─────────────────────────────────
   Os três formatos usavam a data de HOJE no nome, e isso passava porque
   montar o filtro de um mês à mão era trabalhoso o bastante para ninguém
   exportar dois no mesmo dia. A central desfez essa proteção acidental:
   tirar agosto, julho e junho agora são três cliques, e os três arquivos
   sairiam com o mesmo nome, um sobrescrevendo o outro na pasta de
   downloads. O nome passa a carregar o período, quando há um. */
function _nomeArquivoRelatorio(contexto, extensao) {
    const ini     = document.getElementById("filtroDataInicio")?.value || "";
    const fim     = document.getElementById("filtroDataFim")?.value || "";
    const descIni = document.getElementById("filtroDescargaInicio")?.value || "";
    const descFim = document.getElementById("filtroDescargaFim")?.value || "";
    const trecho = (rotulo, a, b) => {
        if (a && b) return a === b ? `${rotulo}-${a}` : `${rotulo}-${a}-a-${b}`;
        if (a) return `${rotulo}-desde-${a}`;
        if (b) return `${rotulo}-ate-${b}`;
        return "";
    };
    const partes = [trecho("emissao", ini, fim), trecho("descarga", descIni, descFim)].filter(Boolean);
    // Sem período o nome continua sendo o de sempre: a data em que se
    // exportou é a única referência que o arquivo tem.
    const miolo = partes.length ? partes.join("-") : _hojeISO();
    return `controle-combustivel-${contexto}-${miolo}.${extensao}`;
}

function exportarExcel(contexto) {
    if (adiarAteBibliotecas(["xlsx"], () => exportarExcel(contexto))) return;
    // Exportação leva só o que conta: um Excel não tem "riscado"
    // confiável, e uma linha morta numa planilha vira soma errada na
    // primeira vez que alguém arrastar o mouse por cima dela.
    const dados = dadosRelatorioValidos;
    if (!dados || dados.length === 0) { mostrarToast("Não há dados para exportar.", "aviso", 4000); return; }

    /* No padrão do PDF de entradas desde 25/09/2026 (pedido do dono): a
       faixa com o período e a empresa, os cartões e a tabela com o TOTAL.
       Continua com todas as colunas e a de combustíveis: as opções do
       Sistema são do PDF. */
    const litrosDe = l => l.itens.reduce((s, i) => s + _litrosItem(i), 0);
    const linhas = dados.map(l => {
        const combustiveis = l.itens.map(i => `${i.tipo}: ${_fmtLitrosFrete(_litrosItem(i))}`).join(" | ");
        return [
            formatarData(l.dataNota),
            l.dataDescarga ? formatarData(l.dataDescarga) : "",
            l.numeroNota, l.base || "", l.empresa || "", l.motorista || "", l.placa || "",
            // Número, não texto: `toFixed` devolve string e a planilha do
            // contador não somava nem ordenava a coluna (17/09/2026).
            combustiveis, Number(litrosDe(l).toFixed(3)), Number((l.total || 0).toFixed(2))
        ];
    });
    const somaLitros = dados.reduce((s, l) => s + litrosDe(l), 0);
    const somaTotal  = dados.reduce((s, l) => s + (l.total || 0), 0);
    const periodo = _descricaoPeriodoRelatorio();
    const ws = _planilhaPadrao({
        titulo: "Relatório de Entradas de Combustível",
        subtitulo: `${periodo.charAt(0).toUpperCase()}${periodo.slice(1)} · ${empresaFiltroGlobal || "Todas as empresas"}`,
        geradoEm: _pdfGeradoEm(),
        cartoes: [
            { rotulo: "Total das notas", valor: Number(somaTotal.toFixed(2)), f: "reais" },
            { rotulo: "Litros",          valor: Number(somaLitros.toFixed(3)), f: "litrosRedondo" },
            { rotulo: "Lançamentos",     valor: dados.length, f: "inteiro" }
        ],
        secoes: [{
            titulo: "Lançamentos",
            cabecalho: ["Emissão", "Descarga", "Nota", "Base", "Empresa", "Motorista", "Placa", "Combustíveis", "Litros", "Total"],
            formatos:  [null, null, null, null, null, null, null, null, "litros", "reais"],
            linhas,
            // Linha de fechamento dentro da própria tabela: quem confere a
            // planilha não precisa somar a coluna à mão.
            total: ["TOTAL", "", "", "", "", `${dados.length} lançamento(s)`, "", "",
                    Number(somaLitros.toFixed(3)), Number(somaTotal.toFixed(2))]
        }]
    });
    _gravarPlanilhaPadrao([{ nome: "Entradas", ws }], _nomeArquivoRelatorio(contexto, 'xlsx'));
}

/* ── UM CABEÇALHO SÓ PARA OS TRÊS PDFs (18/09/2026) ─────────────────
   Eram três geradores independentes: o de entradas lia a cor e a logo
   configuradas em Sistema › Layout do PDF; o Mensal Gerencial usava um
   azul fixo; o de Fretes nem cabeçalho de faixa, nem logo, nem número de
   página tinha. Quem recebia os três via três sistemas diferentes. Agora
   os três pegam a mesma cor, a mesma logo e o mesmo rodapé daqui. */
/* Cor, fonte e título do PDF deixaram de ser configuráveis em 21/09/2026,
   a pedido do dono: a aparência do documento passa a ser uma só. O que
   continua configurável em Sistema são as COLUNAS do PDF de entradas (a
   orientação saiu em 25/09/2026: todos os PDFs são em pé, no padrão do
   fechamento). Sem logo, a faixa do cabeçalho é a variante centrada. */
/* A COR DA FAIXA DOS PDFS: vinho fechado, e não o vermelho da tela
   (22/09/2026, segunda revisão).

   Ela era #a02828, o `--primary` do `style.css`, e o dono apontou dois
   problemas no papel: o vermelho saía claro demais, e a gota da logo
   sumia. O segundo tem número: a gota, depois de rasterizada, é
   #982331, e contra a faixa #a02828 o contraste era de 1,08. Abaixo de
   1,2 o olho não separa duas superfícies, então a gota não ficava
   "pouco visível", ela desaparecia.

   Com #5c1620 a gota sobe para 1,65 e o texto branco do cabeçalho vai de
   7,4:1 para 13,2:1. A tela continua com #a02828: papel e monitor não
   precisam da mesma cor, e no papel o tom fechado imprime melhor. */
const _PDF_COR   = [92, 22, 32];     // #5c1620, vinho fechado
const _PDF_FONTE = "helvetica";

/* A margem dos PDFs (`_PDF_MARGEM` e as de cima e de baixo) está em
   src/shared/pdf-padrao.js desde 25/09/2026, com o resto do padrão. */
/* ── A MARCA NO RODAPÉ, E NÃO UMA LOGO NO CABEÇALHO (22/09/2026) ───
   A logo do Fuel Mind saiu dos PDFs. Ela era SVG, o jsPDF só aceita
   bitmap, e por isso havia aqui um canvas que a rasterizava, um cache
   para não refazer isso a cada documento e uma guarda que adiava a
   exportação até a imagem ficar pronta. Três peças para pôr um desenho
   no topo da página.

   E ele não funcionava no papel: a gota da logo é #982331 e a faixa do
   cabeçalho é vinho, então a gota se dissolvia no fundo. Escurecer a
   faixa melhorou, não resolveu.

   No lugar entra a assinatura que o rodapé do site já usa, "AFN SYSTEMS",
   que é TEXTO. Texto não precisa de canvas, não precisa de cache, não
   adia exportação nenhuma, imprime nítido em qualquer resolução e sai em
   todas as páginas, não só na primeira. O cabeçalho fica com o título
   centrado, que é a variante que `_pdfCabecalho` já sabia desenhar para
   quando não houvesse logo.

   De quebra o documento emagrece: a logo rasterizada entrava como PNG em
   cada PDF. */
/* O "AFN" sai na MESMA cor da faixa do cabeçalho, e não num vermelho
   próprio: o documento passa a ter um vinho só, do topo ao rodapé. Ele é
   `_PDF_COR` e não uma cópia do valor, para os dois nunca divergirem se a
   cor mudar de novo. */
const _PDF_MARCA_SYS = [140, 140, 140];

/* Desenha `AFN SYSTEMS | Fuel Mind` e devolve onde ela termina, para quem
   chama continuar a linha.

   É a assinatura inteira do rodapé do site, e não só as duas primeiras
   palavras: "AFN SYSTEMS" sozinho diz quem fez a ferramenta, e quem recebe
   o documento precisa saber de qual sistema ele saiu.

   Cada pedaço é um `text` próprio porque as cores diferem, exatamente como
   as classes `pf-afn`, `pf-sys`, `pf-pipe` e `pf-info` fazem na tela. */
function _pdfMarca(doc, x, y, tamanho) {
    const antes = doc.getFontSize();
    doc.setFontSize(tamanho);
    doc.setFont("courier", "bold");
    let cursor = x;
    const escrever = (texto, cor, espacoAntes) => {
        cursor += espacoAntes;
        doc.setTextColor(...cor);
        doc.text(texto, cursor, y);
        cursor += doc.getTextWidth(texto);
    };
    escrever("AFN",      _PDF_COR,       0);
    escrever("SYSTEMS",  _PDF_MARCA_SYS, 1.4);
    escrever("|",        _PDF_MARCA_SYS, 2.2);
    escrever("Fuel Mind", _PDF_MARCA_SYS, 2.2);
    doc.setFontSize(antes);
    return cursor;
}

/* ── VER ANTES DE SALVAR (22/09/2026) ──────────────────────────────
   Os quatro PDFs terminavam em `doc.save()`: o arquivo caía na pasta de
   downloads e só ali a pessoa descobria o que tinha gerado. O dono pediu
   uma prévia, e ela resolve um problema que ele já teve: o fechamento saiu
   com uma empresa só e isso só apareceu depois de abrir o arquivo.

   O jsPDF entrega o documento como blob, e o navegador já sabe desenhar
   PDF: o `iframe` abaixo é o visualizador nativo, sem biblioteca nenhuma a
   mais. Daqui saem os dois caminhos que o dono pediu, imprimir e salvar.

   `revokeObjectURL` ao fechar não é zelo: cada PDF de fechamento tem
   centenas de KB, e um blob que ninguém libera fica na memória da aba até
   ela ser recarregada. Quem fecha um fechamento atrás do outro numa tarde
   acumularia todos.

   Imprimir chama o `print()` de DENTRO do iframe, e não o da página: o da
   página mandaria a tela do sistema para a impressora, não o documento.

   NO CELULAR E NO TABLET O IFRAME NÃO SERVE (23/09/2026). O Chrome do
   Android não desenha PDF dentro da página: o quadro fica em branco, ou
   com um botão de abrir. O Safari do iPhone mostra a primeira página e
   para. Nesses aparelhos as páginas são desenhadas como imagem pelo
   PDF.js, que só é baixado nessa hora. "Imprimir" vira "Compartilhar"
   onde o aparelho aceita compartilhar arquivo (Android e iPhone: WhatsApp,
   e-mail, e no iPhone também imprimir), e "Abrir o PDF" onde não aceita.
   O computador continua com o leitor nativo, que tem zoom, busca e
   impressão direta. */
function _pdfPreviaDesenhada() {
    const toque = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    return toque || navigator.pdfViewerEnabled === false;
}

/* O arquivo para o botão Compartilhar, ou `null` onde o aparelho não
   compartilha arquivo. No Android, abrir o blob numa aba nova costuma
   baixar um arquivo de nome sem sentido; compartilhar leva o nome certo. */
function _pdfArquivoCompartilhavel(doc, nomeArquivo) {
    if (typeof File !== "function" || !navigator.canShare) return null;
    try {
        const arquivo = new File([doc.output("blob")], nomeArquivo, { type: "application/pdf" });
        return navigator.canShare({ files: [arquivo] }) ? arquivo : null;
    } catch (_) {
        return null;
    }
}

function _pdfEntregar(doc, nomeArquivo) {
    let url;
    try {
        url = doc.output("bloburl");
    } catch (e) {
        // Sem prévia possível, o download direto continua valendo: é melhor
        // entregar o documento sem a tela do que não entregar.
        console.error("previa do PDF", e);
        doc.save(nomeArquivo);
        return;
    }

    const desenhada = _pdfPreviaDesenhada();
    const arquivo = desenhada ? _pdfArquivoCompartilhavel(doc, nomeArquivo) : null;
    const modal = document.createElement("div");
    modal.id = "_modalPdfPrevia";
    modal.className = "modal-overlay";
    modal.style.display = "flex";

    let aoRedimensionar = null;
    let abriuFora = false;
    let caixa = null;
    const fechar = () => {
        if (aoRedimensionar) window.removeEventListener("resize", aoRedimensionar);
        if (caixa && caixa._encerrar) caixa._encerrar();
        // Aberto numa aba nova, o documento ainda pode estar sendo lido por
        // ela: o blob só é solto um minuto depois.
        if (abriuFora) setTimeout(() => URL.revokeObjectURL(url), 60000);
        else URL.revokeObjectURL(url);
        modal.remove();
    };
    modal.onclick = e => { if (e.target === modal) fechar(); };
    const abrirFora = () => {
        abriuFora = true;
        window.open(url, "_blank");
    };

    const botaoPrincipal = !desenhada
        ? `<button class="btn-primario" data-acao="imprimir">Imprimir</button>`
        : arquivo
            ? `<button class="btn-primario" data-acao="compartilhar">Compartilhar</button>`
            : `<button class="btn-primario" data-acao="abrir">Abrir o PDF</button>`;

    // O nome inteiro fica no `title`: na tela ele é cortado numa linha só,
    // para não roubar altura da prévia.
    modal.innerHTML = `
        <div class="modal modal--pdf" role="dialog" aria-label="Prévia do documento" onclick="event.stopPropagation()">
            <div class="modal-cabecalho">
                <h3 title="${escapeHtml(nomeArquivo)}">Prévia · ${escapeHtml(nomeArquivo)}</h3>
                <button class="modal-fechar" aria-label="Fechar" title="Fechar">✕</button>
            </div>
            ${desenhada
                ? `<div class="pdf-previa pdf-previa--paginas" role="document" aria-label="Prévia do documento" tabindex="0">
                       <p class="pdf-previa-aviso">Preparando a prévia…</p>
                   </div>`
                : `<iframe class="pdf-previa" title="Prévia do documento" src="${url}"></iframe>`}
            <div class="modal-acoes">
                ${botaoPrincipal}
                <button class="btn-secundario" data-acao="salvar">${desenhada ? "Salvar" : "Salvar no computador"}</button>
                <button class="btn-cancelar" data-acao="fechar">Fechar</button>
            </div>
        </div>`;

    modal.querySelector(".modal-fechar").onclick = fechar;
    modal.querySelector('[data-acao="fechar"]').onclick = fechar;
    modal.querySelector('[data-acao="salvar"]').onclick = () => {
        doc.save(nomeArquivo);
        mostrarToast("Documento salvo.", "sucesso", 3000, { local: false });
    };
    const botao = acao => modal.querySelector(`[data-acao="${acao}"]`);
    if (botao("compartilhar")) {
        botao("compartilhar").onclick = () => {
            navigator.share({ files: [arquivo], title: nomeArquivo }).catch(e => {
                // Desistir da folha de compartilhar não é erro. Qualquer
                // outra falha cai no caminho antigo, para não deixar a
                // pessoa sem saída.
                if (e && e.name === "AbortError") return;
                console.error("compartilhar PDF", e);
                abrirFora();
            });
        };
    }
    if (botao("abrir")) botao("abrir").onclick = abrirFora;
    if (botao("imprimir")) {
        botao("imprimir").onclick = () => {
            const q = modal.querySelector(".pdf-previa");
            try {
                q.contentWindow.focus();
                q.contentWindow.print();
            } catch (e) {
                // Alguns navegadores bloqueiam o print de dentro do iframe.
                // Abrir numa aba deixa a pessoa imprimir de lá, em vez de
                // deixá-la sem caminho.
                console.error("imprimir PDF", e);
                abrirFora();
                mostrarToast("Abri o documento numa aba nova: imprima por lá.", "info", 6000);
            }
        };
    }

    document.body.appendChild(modal);
    if (typeof _modalAcessivel === "function") _modalAcessivel(modal, fechar);

    if (desenhada) {
        caixa = modal.querySelector(".pdf-previa--paginas");
        _pdfDesenharPaginas(doc, caixa);
        // Girar o celular muda a largura: as páginas foram desenhadas para
        // a largura antiga e ficariam borradas, então são refeitas. Sem
        // largura registrada, a primeira rodada ainda não mediu, e ela vai
        // medir a largura nova quando começar: nada a refazer.
        let espera = null;
        aoRedimensionar = () => {
            clearTimeout(espera);
            espera = setTimeout(() => {
                const antes = caixa._larguraDesenhada;
                if (caixa.isConnected && antes && Math.abs(caixa.clientWidth - antes) > antes * 0.15) {
                    _pdfDesenharPaginas(doc, caixa);
                }
            }, 250);
        };
        window.addEventListener("resize", aoRedimensionar);
    }
}

/* Desenha as páginas do PDF na largura da caixa, SÓ as que estão perto da
   vista (23/09/2026). Cada página vira primeiro uma folha vazia com a
   proporção certa, para a rolagem já ter o tamanho final; a imagem entra
   quando a folha chega a uma altura e meia da área visível, e sai quando
   se afasta. Desenhar todas de uma vez, a 2x, passava do teto de memória
   de canvas do Safari do iPad num fechamento com a lista nota a nota: o
   `getContext` devolve `null` e a prévia inteira caía.

   A resolução acompanha a tela até 2x: menos que isso borra o texto num
   celular de tela densa, e mais pesa sem ganho que se veja.

   Uma rodada nova (girar a tela) encerra a anterior antes de começar:
   cancela os desenhos em curso, solta as imagens e o documento. Toda
   espera termina conferindo se a rodada ainda é a atual, senão uma página
   velha entraria no meio das novas. `isEvalSupported: false` porque a
   3.11 é anterior à correção do CVE-2024-4367: o PDF é gerado aqui mesmo,
   mas desligar custa nada. */
async function _pdfDesenharPaginas(doc, caixa) {
    if (caixa._encerrar) caixa._encerrar();
    const rodada = (caixa._rodada || 0) + 1;
    caixa._rodada = rodada;
    const viva = () => caixa.isConnected && caixa._rodada === rodada;

    let pdf = null;
    const folhas = [];
    const soltar = folha => {
        if (folha._tarefa) { folha._tarefa.cancel(); folha._tarefa = null; }
        const c = folha.querySelector("canvas");
        // Zerar o canvas devolve a memória na hora, sem esperar o coletor.
        if (c) { c.width = 0; c.height = 0; }
        folha.replaceChildren();
        folha._desenhada = false;
    };
    let verificar = null;
    caixa._encerrar = () => {
        if (verificar) caixa.removeEventListener("scroll", verificar);
        folhas.forEach(soltar);
        if (pdf) pdf.destroy();
        caixa._encerrar = null;
    };

    try {
        await garantirBiblioteca("pdfjs");
        if (!viva()) return;
        const lib = window.pdfjsLib;
        if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = _BIBLIOTECAS.pdfjs.worker;

        const carregado = await lib.getDocument({
            data: new Uint8Array(doc.output("arraybuffer")),
            isEvalSupported: false
        }).promise;
        if (!viva()) { carregado.destroy(); return; }
        pdf = carregado;

        const estilo = getComputedStyle(caixa);
        const largura = caixa.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
        caixa._larguraDesenhada = caixa.clientWidth;
        const densidade = Math.min(window.devicePixelRatio || 1, 2);
        const primeira = (await pdf.getPage(1)).getViewport({ scale: 1 });
        if (!viva()) return;

        for (let n = 1; n <= pdf.numPages; n++) {
            const folha = document.createElement("div");
            folha.className = "pdf-pagina";
            folha.dataset.pagina = String(n);
            folha.style.aspectRatio = `${primeira.width} / ${primeira.height}`;
            folha.setAttribute("role", "img");
            folha.setAttribute("aria-label", `Página ${n} de ${pdf.numPages}`);
            folhas.push(folha);
        }
        caixa.replaceChildren(...folhas);

        const desenhar = async folha => {
            if (folha._desenhada || folha._tarefa) return;
            const n = Number(folha.dataset.pagina);
            try {
                const pagina = await pdf.getPage(n);
                if (!viva() || folha._desenhada || folha._tarefa) return;
                const base = pagina.getViewport({ scale: 1 });
                const vista = pagina.getViewport({ scale: (largura / base.width) * densidade });
                const canvas = document.createElement("canvas");
                canvas.width = Math.floor(vista.width);
                canvas.height = Math.floor(vista.height);
                const contexto = canvas.getContext("2d");
                if (!contexto) throw new Error("sem memória para a imagem da página");
                folha._tarefa = pagina.render({ canvasContext: contexto, viewport: vista });
                await folha._tarefa.promise;
                folha._tarefa = null;
                if (!viva()) { canvas.width = 0; canvas.height = 0; return; }
                folha.style.aspectRatio = `${base.width} / ${base.height}`;
                folha.replaceChildren(canvas);
                folha._desenhada = true;
            } catch (e) {
                folha._tarefa = null;
                if (e && e.name === "RenderingCancelledException") return;
                console.error("pagina da previa do PDF", n, e);
                if (viva()) {
                    folha.innerHTML = `<p class="pdf-previa-aviso">Não deu para mostrar a página ${n} aqui.
                        O documento está inteiro: use os botões abaixo.</p>`;
                }
            }
        };

        verificar = () => {
            if (!viva()) return;
            const area = caixa.getBoundingClientRect();
            const margem = area.height * 1.5;
            for (const folha of folhas) {
                const r = folha.getBoundingClientRect();
                const perto = r.bottom > area.top - margem && r.top < area.bottom + margem;
                if (perto) desenhar(folha);
                else if (folha._desenhada || folha._tarefa) soltar(folha);
            }
        };
        caixa.addEventListener("scroll", verificar, { passive: true });
        verificar();
    } catch (e) {
        console.error("previa desenhada do PDF", e);
        if (viva()) {
            if (caixa._encerrar) caixa._encerrar();
            caixa.innerHTML = `<p class="pdf-previa-aviso">Não deu para mostrar a prévia neste aparelho.
                O documento está pronto: use os botões abaixo.</p>`;
        }
    }
}

function _pdfEstilo() {
    const cfg = Object.assign({
        titulo: "Controle de Entradas de Combustível", rodapeTexto: ""
    }, db.configRelatorio || {});
    cfg.titulo = "Controle de Entradas de Combustível";
    cfg.rodapeTexto = "";
    return { cfg, cor: _PDF_COR, fonte: _PDF_FONTE };
}

/** Faixa de cabeçalho com logo, título e subtítulo. Devolve o Y livre. */
/* `compacto` (24/09/2026, pedido do dono para o fechamento): a faixa com
   a mesma folga em cima e embaixo do texto, sem o espaço vazio acima do
   título. Desde 25/09/2026 os quatro PDFs usam a compacta. */
function _pdfCabecalho(doc, estilo, titulo, subtitulo, compacto) {
    const W = doc.internal.pageSize.width;
    const alt = compacto ? 16 : 22;
    doc.setFillColor(...estilo.cor);
    doc.rect(0, 0, W, alt, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont(estilo.fonte, "bold"); doc.setFontSize(compacto ? 13 : 14);
    doc.text(titulo, W / 2, compacto ? 7.6 : 11, { align: "center" });
    doc.setFont(estilo.fonte, "normal"); doc.setFontSize(compacto ? 8.5 : 9);
    doc.text(subtitulo, W / 2, compacto ? 12.6 : 18, { align: "center" });
    doc.setTextColor(0, 0, 0);
    return alt + (compacto ? 5 : 6);
}

/** Rodapé com o texto configurado e "Página X de Y", em todas as páginas.
 *  `pe` (opcional): `margem` dos lados e `distancia` da linha do texto até o
 *  pé da folha; sem eles, as do padrão (src/shared/pdf-padrao.js), quase
 *  sem margem, porque os PDFs são feitos para ler na tela (24/09/2026,
 *  pedido do dono). `pe.direita` vai antes do número da página: todos os
 *  PDFs põem ali quando foram gerados (25/09/2026). */
function _pdfRodapes(doc, estilo, textoEsquerda, pe) {
    const W = doc.internal.pageSize.width, H = doc.internal.pageSize.height;
    const margem = (pe && pe.margem != null) ? pe.margem : _PDF_MARGEM;
    const linha = H - ((pe && pe.distancia != null) ? pe.distancia : _PDF_RODAPE);
    const total = doc.internal.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
        doc.setPage(p);
        /* A marca abre o rodapé de TODAS as páginas, e não o cabeçalho da
           primeira: quem recebe uma folha solta de um fechamento de quatro
           páginas continua sabendo de onde ela veio. */
        const fimMarca = _pdfMarca(doc, margem, linha, 7);
        doc.setFont(estilo.fonte, "normal"); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
        const direita = [pe && pe.direita, `Página ${p} de ${total}`].filter(Boolean).join("  ·  ");
        doc.text(direita, W - margem, linha, { align: "right" });
        // O da esquerda encurta com reticências se fosse encostar no da
        // direita (muitas empresas no mesmo documento, por exemplo).
        const limite = W - margem - doc.getTextWidth(direita) - 4 - (fimMarca + 3);
        let esquerda = [textoEsquerda, estilo.cfg.rodapeTexto].filter(Boolean).join("  ·  ");
        if (esquerda && doc.getTextWidth("·  " + esquerda) > limite) {
            while (esquerda.length > 1 && doc.getTextWidth("·  " + esquerda + "…") > limite) esquerda = esquerda.slice(0, -1);
            esquerda = esquerda.trimEnd() + "…";
        }
        if (esquerda) doc.text("·  " + esquerda, fimMarca + 3, linha);
    }
}

// ========== PDF DE ENTRADAS ==========
/**
 * Exporta para PDF os lançamentos filtrados na tela de Relatórios, no
 * padrão do fechamento (25/09/2026, pedido do dono: "o mesmo padrão de
 * design do fechamento aplicado em todos os relatórios do site"): folha em
 * pé, faixa compacta, cartões com os totais, a tabela com a linha de TOTAL
 * e a data de geração no rodapé de todas as páginas.
 *
 * Da configuração salva em Sistema só vêm as COLUNAS e a separação por
 * mês. Título, cor, fonte, margens, rodapé e logo deixaram de ser
 * configuráveis em 21/09/2026, e a orientação em 25/09/2026; uma
 * configuração antiga que ainda tenha esses campos é ignorada de propósito.
 *
 * @param {'relatorio'} contexto - Rótulo usado no nome do arquivo
 * @returns {Promise<void>}
 */
async function exportarPDF(contexto) {
    if (adiarAteBibliotecas(["jspdf", "autotable"], () => exportarPDF(contexto))) return;
    const dados = dadosRelatorioValidos;
    if (!dados || dados.length === 0) { mostrarToast("Não há dados para exportar.", "aviso", 4000); return; }

    const salvo = db.configRelatorio || {};
    const cfg = {
        mostrarBase:     salvo.mostrarBase     ?? true,
        mostrarEmpresa:  salvo.mostrarEmpresa  ?? true,
        mostrarMotorista:salvo.mostrarMotorista?? true,
        mostrarPlaca:    salvo.mostrarPlaca    ?? true,
        quebrarPorMes:   salvo.quebrarPorMes   ?? false
    };

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.width;
    const estilo = _pdfEstilo();
    const geradoEm = _pdfGeradoEm();

    // O cabeçalho diz o período e de que empresa ele é. Antes dizia só
    // "Relatório — Gerado em", e quem recebia o PDF (o contador) não sabia
    // se aquilo era o mês inteiro, parte dele ou tudo (rodada 11). A tela
    // filtra pela empresa ativa, e o subtítulo diz qual é.
    const periodo = _descricaoPeriodoRelatorio();
    const empresaTxt = empresaFiltroGlobal || "Todas as empresas";
    let y = _pdfCabecalho(doc, estilo, "Relatório de Entradas de Combustível",
        `${periodo.charAt(0).toUpperCase()}${periodo.slice(1)} · ${empresaTxt}`, true);

    // Os totais do período nos cartões, antes de qualquer tabela. Eles
    // também fecham a conta quando o documento sai separado por mês: antes
    // havia uma linha "TOTAL DO PERÍODO" no fim para isso (18/09/2026).
    const litrosDe = l => l.itens.reduce((s, i) => s + _litrosItem(i), 0);
    const totalGeral  = dados.reduce((s, l) => s + (l.total || 0), 0);
    const totalLitros = dados.reduce((s, l) => s + litrosDe(l), 0);
    y = _pdfCartoes(doc, estilo, y, [
        { rotulo: "Total das notas", valor: fmtR(totalGeral), destaque: true },
        // O cartão arredonda os litros, como no fechamento; a tabela
        // traz as casas quando há fração.
        { rotulo: "Litros",          valor: fmtL(totalLitros) },
        { rotulo: "Lançamentos",     valor: String(dados.length) }
    ]) + 6;

    // ── As colunas, conforme o Sistema ──
    // Os nomes do nota a nota do fechamento ("Emissão", "Descarga"), e os
    // litros no formato dele: "12.000 L", com casas só quando há fração.
    const cab = ["Emissão", "Descarga", "Nota"];
    if (cfg.mostrarBase)      cab.push("Base");
    if (cfg.mostrarEmpresa)   cab.push("Empresa");
    if (cfg.mostrarMotorista) cab.push("Motorista");
    if (cfg.mostrarPlaca)     cab.push("Placa");
    cab.push("Litros", "Total");
    const iLitros = cab.length - 2;
    // O texto longo, que fica com a sobra da largura: o motorista, ou a
    // coluna de texto que houver quando ele está desligado.
    const flex = ["Motorista", "Base", "Empresa", "Nota"].map(n => cab.indexOf(n)).find(i => i >= 0);

    function linhaDe(l) {
        const row = [formatarData(l.dataNota), l.dataDescarga ? formatarData(l.dataDescarga) : "", l.numeroNota];
        if (cfg.mostrarBase)      row.push(l.base || "");
        if (cfg.mostrarEmpresa)   row.push(l.empresa || "");
        if (cfg.mostrarMotorista) row.push(l.motorista || "");
        if (cfg.mostrarPlaca)     row.push(l.placa || "");
        row.push(_fmtLitrosFrete(litrosDe(l)), fmtR(l.total || 0));
        return row;
    }
    // A contagem vai na coluna larga, como no nota a nota: na do número da
    // nota ela quebrava em duas linhas.
    function linhaTotal(lans) {
        const t = cab.map(() => "");
        t[0] = "TOTAL";
        t[flex] = `${lans.length} lançamento(s)`;
        t[iLitros] = _fmtLitrosFrete(lans.reduce((s, l) => s + litrosDe(l), 0));
        t[iLitros + 1] = fmtR(lans.reduce((s, l) => s + (l.total || 0), 0));
        return t;
    }

    // ── As seções: uma só, ou uma por mês ──
    // Separado por mês, agrupa pela mesma data que filtrou: a emissão.
    // Agrupar pela descarga abria, no PDF de agosto, uma seção de setembro
    // com a nota emitida em 30/08 e descarregada em 01/09. As seções vêm
    // uma atrás da outra, e não uma página por mês (25/09/2026).
    let grupos = [{ titulo: "Lançamentos", lans: dados }];
    if (cfg.quebrarPorMes) {
        const porMes = {};
        dados.forEach(l => {
            const mes = dataEmissaoDe(l).slice(0, 7);
            (porMes[mes] = porMes[mes] || []).push(l);
        });
        // O título diz qual data define o mês (25/09/2026, revisão): com o
        // filtro só de descarga, a nota emitida em 30/08 e descarregada em
        // 01/09 cai em "agosto", e o documento precisa dizer por quê.
        grupos = Object.keys(porMes).sort().map(mes => ({ titulo: `Emissão em ${_pdfMesAno(mes)}`, lans: porMes[mes] }));
    }

    // As mesmas larguras em todas as seções, medidas em todas as linhas:
    // separado por mês, as tabelas ficam alinhadas umas com as outras.
    // Letra 7, a do nota a nota, que é o mesmo tipo de lista.
    const todas = grupos.flatMap(g => [...g.lans.map(linhaDe), linhaTotal(g.lans)]);
    const enc = _pdfEncaixar(doc, estilo, cab, todas, W - 2 * _PDF_MARGEM, flex, [7]);
    const estilos = {};
    cab.forEach((_, i) => {
        estilos[i] = { halign: i >= iLitros ? "right" : "left",
                       cellWidth: enc ? enc.larguras[i] : (i === flex ? "auto" : "wrap") };
    });

    grupos.forEach(g => {
        y = _pdfEspaco(doc, y, false);
        y = _pdfTitulo(doc, estilo, g.titulo, y);
        y = _pdfTabela(doc, estilo, {
            head: [cab], body: [...g.lans.map(linhaDe), linhaTotal(g.lans)], startY: y,
            columnStyles: estilos, fonte: enc ? enc.fonte : 7
        }) + 7;
    });

    _pdfRodapes(doc, estilo, `Relatório de entradas · ${periodo} · ${empresaTxt}`, { direita: `Gerado em ${geradoEm}` });
    _pdfEntregar(doc, _nomeArquivoRelatorio(contexto, 'pdf'));
    mostrarToast('PDF gerado com sucesso!', 'sucesso', 3000);
}

// ========== CSV ==========
/**
 * Exporta os dados filtrados para CSV com separador `;` e BOM UTF-8.
 * O BOM garante que Excel abra o arquivo com acentuação correta.
 *
 * @param {'relatorio'} contexto - Rótulo usado no nome do arquivo
 */
function exportarCSV(contexto) {
    const dados = dadosRelatorioValidos;
    if (!dados || dados.length === 0) { mostrarToast("Não há dados para exportar.", "aviso", 4000); return; }

    const linhas = dados.map(l => {
        const totalLitros = l.itens.reduce((s, i) => s + _litrosItem(i), 0);
        const combustiveis = l.itens.map(i => `${i.tipo}: ${_litrosItem(i).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} L`).join(" | ");
        return [
            formatarData(l.dataNota),
            l.dataDescarga ? formatarData(l.dataDescarga) : "",
            l.numeroNota, l.base || "", l.empresa || "", l.motorista || "", l.placa || "",
            combustiveis,
            totalLitros.toFixed(3).replace('.', ','),
            l.total.toFixed(2).replace('.', ',')
        ];
    });
    // Total e cabeçalho de período, como no Excel: sem eles o CSV não dizia
    // de que intervalo era nem fechava conta nenhuma (17/09/2026).
    const somaLitrosCsv = dados.reduce((s2, l) => s2 + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0);
    const somaTotalCsv  = dados.reduce((s2, l) => s2 + (l.total || 0), 0);
    linhas.push([]);
    linhas.push(["TOTAL", "", `${dados.length} nota(s)`, "", "", "", "", "",
                 somaLitrosCsv.toFixed(3).replace('.', ','), somaTotalCsv.toFixed(2).replace('.', ',')]);
    linhas.unshift(["Data Nota","Data Descarga","Nota","Base","Empresa","Motorista","Placa","Combustíveis","Total Litros (L)","Total (R$)"]);
    linhas.unshift(
        [`Relatório de ${_descricaoPeriodoRelatorio()}`],
        [`${empresaFiltroGlobal ? empresaFiltroGlobal + " · " : ""}Gerado em ${formatarData(_hojeISO())}`],
        []
    );
    const csv = linhas.map(row => row.map(_celulaCSV).join(';')).join('\n');
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = _nomeArquivoRelatorio(contexto, 'csv');
    a.click();
    URL.revokeObjectURL(url);
}

// ========== IMPRIMIR ==========
function imprimirRelatorio() {
    const dados  = dadosRelatorioValidos;
    const titulo = "Relatório de Entradas";

    if (!dados || dados.length === 0) { mostrarToast("Não há dados para imprimir.", "aviso", 4000); return; }

    const totalGeral  = dados.reduce((s, l) => s + (l.total || 0), 0);
    const totalLitros = dados.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0);
    const dataHoje    = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });

    document.getElementById("impressaoTitulo").textContent = titulo;
    // O papel também precisa dizer de que período é (17/09/2026).
    // A empresa vai no cabeçalho da folha, e não numa coluna repetida em
    // todas as linhas, como na tela (18/09/2026).
    document.getElementById("impressaoData").textContent   = `${empresaFiltroGlobal ? empresaFiltroGlobal + " | " : ""}${_descricaoPeriodoRelatorio()} | Impresso em: ${dataHoje} | ${dados.length} registros | Total: ${fmtR(totalGeral)} | Litros: ${fmtL3(totalLitros)}`;

    document.getElementById("impressaoConteudo").innerHTML = `
        <table class="imp-num-2">
            <thead><tr>
                <th>Emissão</th><th>Descarga</th><th>Nota</th><th>Base</th>
                <th>Motorista</th><th>Placa</th><th>Litros</th><th>Total</th>
            </tr></thead>
            <tbody>
                ${dados.map(l => {
                    const tl = l.itens.reduce((s, i) => s + _litrosItem(i), 0);
                    return `<tr>
                        <td>${formatarData(l.dataNota)}</td>
                        <td>${l.dataDescarga ? formatarData(l.dataDescarga) : ""}</td>
                        <td>${escapeHtml(l.numeroNota)}</td><td>${escapeHtml(l.base) || ""}</td>
                        <td>${escapeHtml(l.motorista) || ""}</td><td>${escapeHtml(l.placa) || ""}</td>
                        <td>${tl.toLocaleString("pt-BR", {minimumFractionDigits:3,maximumFractionDigits:3})}</td>
                        <td>R$ ${l.total.toLocaleString("pt-BR", {minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    </tr>`;
                }).join("")}
            </tbody>
            <tfoot><tr>
                <td colspan="6"><strong>Total</strong></td>
                <td><strong>${dados.reduce((s,l)=>s+l.itens.reduce((ss,i)=>ss+_litrosItem(i),0),0).toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3})} L</strong></td>
                <td><strong>${fmtR(totalGeral)}</strong></td>
            </tr></tfoot>
        </table>
    `;
    imprimirAreaDeImpressao();
}

// ========== WHATSAPP ==========
function compartilharWhatsApp(contexto) {
    const lista = dadosRelatorioValidos;
    if (!lista || lista.length === 0) { mostrarToast("Não há dados para compartilhar.", "aviso", 4000); return; }
    const totalGeral = lista.reduce((s, l) => s + (l.total || 0), 0);
    const totalLitros = lista.reduce((s, l) => s + (l.itens || []).reduce((ss, i) => ss + _litrosItem(i), 0), 0);
    // Empresa e período no alto (a mensagem é lida fora do sistema), e as
    // cinco notas do alto da tabela: `slice(-5)` mandava as cinco do fim,
    // que na ordem padrão são as mais antigas (18/09/2026).
    let mensagem = `⛽ *Controle de Combustível*${empresaFiltroGlobal ? ` · ${empresaFiltroGlobal}` : ""}\n`
        + `📅 ${_descricaoPeriodoRelatorio()}\n📋 ${lista.length} nota(s) · ${fmtL(totalLitros)}\n💰 Total: ${fmtR(totalGeral)}\n\n`;
    lista.slice(0, 5).forEach(l => {
        mensagem += `• ${formatarData(l.dataNota)} | ${l.numeroNota} | ${l.motorista || "—"} | ${fmtR(l.total)}\n`;
    });
    if (lista.length > 5) mensagem += `\n... e mais ${lista.length - 5} nota(s).`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, "_blank");
}

// ========== E-MAIL ==========
function compartilharEmail(contexto) {
    const lista = dadosRelatorioValidos;
    if (!lista || lista.length === 0) { mostrarToast("Não há dados para compartilhar.", "aviso", 4000); return; }
    const totalGeral = lista.reduce((s, l) => s + (l.total || 0), 0);
    const dataHoje   = new Date().toLocaleDateString("pt-BR");
    const assunto    = `Controle de Combustível · ${dataHoje}`;
    // Um `mailto:` não é canal de transporte: o Windows e o Chrome truncam
    // a URL na casa dos 2.000 caracteres, **sem erro nenhum**. Um filtro de
    // mês com algumas centenas de notas passava de 70 mil, e o cliente de
    // e-mail abria com a mensagem cortada no meio, ou não abria.
    //
    // O corte é por tamanho medido, não por contagem de notas: linha de
    // nota varia muito (nome de motorista, base, observação), e um número
    // fixo ora desperdiça espaço, ora estoura. Quem quer a lista inteira
    // tem Excel, PDF e CSV ao lado.
    const LIMITE_URL = 1900;

    const cabecalho = `Controle de Entradas de Combustível${empresaFiltroGlobal ? ` · ${empresaFiltroGlobal}` : ""}\n`
                    + `${_descricaoPeriodoRelatorio()}\nData: ${dataHoje}\n`
                    + `Registros: ${lista.length}\nTotal: ${fmtR(totalGeral)}\n\n${"=".repeat(60)}\n\n`;
    const rodape = n => n > 0
        ? `\n(+ ${n} nota(s) não cabem num e-mail. O total acima considera todas as `
          + `${lista.length}. Para a lista completa, use Excel, PDF ou CSV.)\n`
        : "";
    const montarURL = c => `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(c)}`;

    let corpo = cabecalho, cabem = 0;
    for (const l of lista) {
        const linha = `Data: ${formatarData(l.dataNota)}\nNota: ${l.numeroNota} | Base: ${l.base || "—"}\n`
                    + `Empresa: ${l.empresa || "—"} | Motorista: ${l.motorista || "—"} | Placa: ${l.placa || "—"}\n`
                    + `Total: ${fmtR(l.total)}\n${"-".repeat(40)}\n`;
        if (montarURL(corpo + linha + rodape(lista.length - cabem - 1)).length > LIMITE_URL) break;
        corpo += linha;
        cabem++;
    }

    const cortadas = lista.length - cabem;
    corpo += rodape(cortadas);
    if (cortadas > 0) {
        mostrarToast(
            `O e-mail leva ${cabem} de ${lista.length} notas, e o resto não cabe num link `
            + `de e-mail. Para mandar tudo, anexe o Excel ou o PDF.`, "aviso", 7000);
    }
    window.location.href = montarURL(corpo);
}

/*=================================================
  RELATÓRIO MENSAL GERENCIAL
=================================================*/
function gerarRelatorioMensalPDF() {
    if (typeof garantirBibliotecas === "function") garantirBibliotecas(["jspdf", "autotable"]).catch(() => {});
    const hoje = new Date();
    const modal = document.createElement('div');
    modal.id = '_modalRelMensal';
    // Usa o modal do projeto (classe, Escape e foco preso), como os outros:
    // este nascia com estilo próprio e sem Escape (17/09/2026).
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };

    const opcoes = [];
    for (let i = 0; i < 24; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        // O mês por extenso na lista ("Setembro de 2026"): "Set/26" é bom em
        // cabeçalho de tabela, não para escolher entre 24 opções.
        const porExtenso = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        opcoes.push(`<option value="${val}" ${i===0?'selected':''}>${porExtenso.charAt(0).toUpperCase() + porExtenso.slice(1)}</option>`);
    }

    modal.innerHTML = `
        <div class="modal modal--medio" onclick="event.stopPropagation()">
            <h3 class="mt-0 mb-2">Relatório mensal gerencial</h3>
            <p class="sistema-descricao mb-5">
                Gera um PDF formatado com resumo executivo, detalhamento por combustível e comparativo com o mês anterior.
                O mês é o da <strong>data de emissão</strong> das notas.
            </p>
            <div class="campo mb-2">
                <label for="_selMesRelMensal">Mês de referência</label>
                <select id="_selMesRelMensal" class="largura-total">
                    ${opcoes.join('')}
                </select>
            </div>
            <div class="campo">
                <label for="_nomeEmpresaRel">Nome do posto / empresa (cabeçalho)</label>
                <input id="_nomeEmpresaRel" type="text" class="largura-total" value="${escapeHtml(empresaFiltroNome || db.empresas?.[0]?.nome || '')}">
            </div>
            <!-- Os mesmos botões dos outros modais, em vez de dois desenhados à mão. -->
            <div class="modal-acoes">
                <button class="btn-primario" onclick="_executarRelatorioMensal()">Gerar PDF</button>
                <button class="btn-cancelar" onclick="document.getElementById('_modalRelMensal').remove()">Cancelar</button>
            </div>

        </div>
    `;
    document.body.appendChild(modal);
    if (typeof _modalAcessivel === 'function') _modalAcessivel(modal, () => modal.remove());
}

function _executarRelatorioMensal() {
    // O modal fica aberto enquanto a biblioteca chega: os campos dele são
    // lidos na segunda chamada, não perdidos.
    if (adiarAteBibliotecas(["jspdf", "autotable"], () => _executarRelatorioMensal())) return;
    const mes     = document.getElementById('_selMesRelMensal')?.value;
    const empresa = document.getElementById('_nomeEmpresaRel')?.value?.trim() || empresaFiltroNome || 'Controle de Combustível';
    document.getElementById('_modalRelMensal')?.remove();
    if (!mes) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.width;
    const estiloPdf = _pdfEstilo();

    const [ano, m] = mes.split('-').map(Number);
    const mesAnterior = m === 1 ? `${ano-1}-12` : `${ano}-${String(m-1).padStart(2,'0')}`;

    // O Relatório Mensal Gerencial monta o próprio conjunto e é o único
    // ponto desta tela que não passa por `dadosRelatorioAtual`, por isso
    // repete o teste de estado. É também onde vive o custo médio
    // (totalGasto/totalLitros, logo abaixo), que é o número que uma nota
    // sem validade mais distorce.
    const lancamentosFiltrados = db.lancamentos.filter(l => lancamentoAtivo(l)
        && (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal));
    // Pela emissão (rodada 11): é o relatório de gasto, custo médio e
    // variação de preço, e o valor é da compra na data em que a nota foi
    // emitida.
    const lansMes      = lancamentosFiltrados.filter(l => dataEmissaoDe(l).startsWith(mes));
    const lansAnterior = lancamentosFiltrados.filter(l => dataEmissaoDe(l).startsWith(mesAnterior));

    const totalNotas  = lansMes.length;
    const totalLitros = lansMes.reduce((s,l) => s + l.itens.reduce((ss,i) => ss+_litrosItem(i),0), 0);
    const totalGasto  = lansMes.reduce((s,l) => s + (l.total || 0), 0);
    // Preço de compra, sobre os litros faturados (17/09/2026).
    const mMes        = metricasPreco(lansMes.flatMap(l => l.itens || []));
    const custoMedio  = mMes.precoCompra;
    const totLitrosAnt = lansAnterior.reduce((s,l) => s + l.itens.reduce((ss,i) => ss+_litrosItem(i),0), 0);
    const totGastoAnt  = lansAnterior.reduce((s,l) => s + (l.total || 0), 0);

    // No padrão do fechamento desde 25/09/2026 (pedido do dono): a faixa
    // compacta, os números em cartões, as tabelas com a linha de TOTAL e a
    // data de geração no rodapé de todas as páginas. O mês como "09/2026".
    const mesLabel = _pdfMesAno(mes);
    const litrosDe = l => l.itens.reduce((s, i) => s + _litrosItem(i), 0);
    let y = _pdfCabecalho(doc, estiloPdf, `Relatório Mensal de Entradas - ${mesLabel}`,
        `${empresa} · pela data de emissão`, true);

    // A variação contra o mês anterior vai no próprio cartão, na linha de
    // apoio; antes era uma linha de texto solta abaixo deles. O gasto vem
    // primeiro e em destaque, como o valor principal do fechamento.
    const variacao = (atual, anterior) => anterior > 0
        ? `${atual >= anterior ? '+' : ''}${fmtPct((atual - anterior) / anterior * 100)} vs. ${_pdfMesAno(mesAnterior)}`
        : "";
    y = _pdfCartoes(doc, estiloPdf, y, [
        { rotulo: 'Total gasto',     valor: fmtR(totalGasto),              apoio: variacao(totalGasto, totGastoAnt), destaque: true },
        // O cartão arredonda os litros, como no fechamento.
        { rotulo: 'Litros',          valor: fmtL(totalLitros),             apoio: variacao(totalLitros, totLitrosAnt) },
        // Rótulo curto: "Preço médio de compra / L" passava da borda do cartão.
        { rotulo: 'Preço médio / L', valor: fmtRL(custoMedio) },
        { rotulo: 'Notas',           valor: String(totalNotas) }
    ]) + 6;

    // ── Por combustível ──
    // Todos os combustíveis que tiveram nota no mês, na ordem do cadastro,
    // inclusive o desativado depois (25/09/2026, revisão). Só os ativos, como
    // antes, escondia litros e gasto que os cartões contam.
    const ordem = (db.combustiveis || []).map(c => c.nome);
    const posicao = t => { const i = ordem.indexOf(t); return i < 0 ? ordem.length : i; };
    const tiposMes = [...new Set(lansMes.flatMap(l => (l.itens || []).map(i => i.tipo)))]
        .sort((a, b) => posicao(a) - posicao(b) || String(a).localeCompare(String(b)));
    const porComb = tiposMes.map(tipo => {
        const itens     = lansMes.flatMap(l => (l.itens || []).filter(i => i.tipo === tipo));
        const itensAnt  = lansAnterior.flatMap(l => (l.itens || []).filter(i => i.tipo === tipo));
        const mComb     = metricasPreco(itens);
        return {
            nome: tipo || '(sem combustível)',
            notas:     lansMes.filter(l => (l.itens || []).some(i => i.tipo === tipo)).length,
            litros:    itens.reduce((s, i) => s + _litrosItem(i), 0),
            litrosAnt: itensAnt.reduce((s, i) => s + _litrosItem(i), 0),
            gasto:     mComb.gasto,
            preco:     mComb.precoCompra
        };
    });
    const varLitros = (a, b) => b > 0 ? `${a >= b ? '+' : ''}${fmtPct((a - b) / b * 100)}` : '—';
    if (porComb.length) {
        const corpoComb = porComb.map(r => [
            r.nome, String(r.notas), _fmtLitrosFrete(r.litros), fmtRL(r.preco), fmtR(r.gasto), varLitros(r.litros, r.litrosAnt)
        ]);
        // O TOTAL são os números dos cartões, para a página não se
        // contradizer: as notas contam uma vez cada (a nota com dois
        // combustíveis aparece nas duas linhas), e a variação é a do mês
        // inteiro, inclusive o combustível que só houve no mês anterior.
        corpoComb.push([
            'TOTAL', String(totalNotas), _fmtLitrosFrete(totalLitros), fmtRL(custoMedio),
            fmtR(totalGasto), varLitros(totalLitros, totLitrosAnt)
        ]);
        y = _pdfEspaco(doc, y, false);
        y = _pdfTitulo(doc, estiloPdf, 'Por combustível', y);
        // Como a tabela por empresa do fechamento: o nome com 70 mm e os
        // números repartindo o resto.
        y = _pdfTabela(doc, estiloPdf, {
            head: [['Combustível', 'Notas', 'Litros', 'Preço médio/L', 'Total gasto', 'Var. litros']],
            body: corpoComb, startY: y,
            columnStyles: { 0: { halign: 'left', cellWidth: 70 }, 1: { halign: 'right' }, 2: { halign: 'right' },
                            3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }
        }) + 7;
    }

    // ── Lançamentos do período ──
    // Como o nota a nota do fechamento: letra 7, as colunas curtas com a
    // largura do conteúdo, o motorista com a sobra e a linha de TOTAL no
    // fim (antes era um rodapé da tabela, só na última página).
    if (lansMes.length > 0) {
        const sorted = [...lansMes].sort((a, b) => dataEmissaoDe(a).localeCompare(dataEmissaoDe(b)));
        const cabL = ['Emissão', 'Nota', 'Base', 'Empresa', 'Motorista', 'Placa', 'Litros', 'Total'];
        const corpoL = sorted.map(l => [
            formatarData(dataEmissaoDe(l)), l.numeroNota,
            l.base || '—', l.empresa || '—', l.motorista || '—', l.placa || '—',
            _fmtLitrosFrete(litrosDe(l)), fmtR(l.total || 0)
        ]);
        corpoL.push(['TOTAL', '', '', '', `${lansMes.length} nota(s)`, '', _fmtLitrosFrete(totalLitros), fmtR(totalGasto)]);
        const encL = _pdfEncaixar(doc, estiloPdf, cabL, corpoL, W - 2 * _PDF_MARGEM, 4, [7]);
        const estL = {};
        cabL.forEach((_, i) => {
            estL[i] = { halign: i >= 6 ? 'right' : 'left',
                        cellWidth: encL ? encL.larguras[i] : (i === 4 ? 'auto' : 'wrap') };
        });
        y = _pdfEspaco(doc, y, false);
        y = _pdfTitulo(doc, estiloPdf, 'Lançamentos do período', y);
        _pdfTabela(doc, estiloPdf, { head: [cabL], body: corpoL, startY: y, columnStyles: estL, fonte: encL ? encL.fonte : 7 });
    }

    _pdfRodapes(doc, estiloPdf, `Relatório mensal de ${mesLabel} · ${empresa}`, { direita: `Gerado em ${_pdfGeradoEm()}` });

    _pdfEntregar(doc, `relatorio-mensal-${mes}.pdf`);
    mostrarToast('Relatório mensal gerado com sucesso!', 'sucesso', 4000);
}

/*=================================================
  FILTRO RÁPIDO DE DATAS
=================================================*/
/**
 * Aplica um filtro rápido de período nos campos de data de um contexto
 * de relatório e dispara o recarregamento dos dados filtrados.
 *
 * Suporta chamada com um ou dois argumentos:
 *   filtroRapido('mes')                → contexto padrão 'relatorio'
 *   filtroRapido('relatorio', 'mes')   → contexto explícito
 *
 * Contextos válidos: 'relatorio' | 'analitico'
 *
 * Períodos válidos:
 *   'hoje'         → apenas o dia de hoje
 *   'semana'       → domingo da semana atual até hoje
 *   'mes'          → 1º do mês atual até hoje
 *   'mes_anterior' → 1º ao último dia do mês anterior
 *   '30dias'       → últimos 30 dias até hoje
 *   '90dias'       → últimos 90 dias até hoje
 *   'ano'          → 1º de janeiro do ano atual até hoje
 *
 * @param {string}  arg1  - Contexto OU período (quando chamado com 1 argumento).
 * @param {string} [arg2] - Período (quando arg1 é o contexto).
 * @returns {void}
 */
/**
 * Aplica um filtro rápido de período a um contexto de relatório.
 *
 * Aceita dois formatos de chamada:
 *   - `filtroRapido('mes')` → contexto padrão `'relatorio'`
 *   - `filtroRapido('relatorio', 'mes')` → contexto explícito
 *
 * @param {'relatorio'|'analitico'|string} arg1
 *   Período (se chamada de 1 argumento) ou contexto (se 2 argumentos)
 * @param {'hoje'|'semana'|'mes'|'mes_anterior'|'30dias'|'90dias'|'ano'} [arg2]
 *   Período (obrigatório se `arg1` for o contexto)
 */
/* ── O ALVO DO PERÍODO RÁPIDO (22/09/2026) ──────────────────────────
   Os quatro atalhos de período ("Hoje", "Este mês"...) preenchiam o único
   par de datas que existia. Com o par da descarga ao lado, eles precisam
   dizer em qual escrevem, e a resposta não pode ser adivinhada do estado
   dos campos: quem tem os dois preenchidos não tem como ser adivinhado, e
   um atalho que às vezes escreve num lugar e às vezes noutro é pior que
   atalho nenhum. Dois botões, sem estado escondido. */
let _relatorioAlvoPeriodo = 'emissao';

/* Só troca o alvo dos atalhos. Não mexe nos campos nem recarrega: apagar
   uma data que a pessoa acabou de digitar à mão não é o que o botão
   promete, e recarregar sem ter mudado filtro nenhum pisca a tela à toa. */
function relatorioAlvoPeriodo(qual) {
    _relatorioAlvoPeriodo = qual === 'descarga' ? 'descarga' : 'emissao';
    const emissao  = document.getElementById("btnAlvoEmissao");
    const descarga = document.getElementById("btnAlvoDescarga");
    if (emissao)  emissao.classList.toggle("ativo",  _relatorioAlvoPeriodo === 'emissao');
    if (descarga) descarga.classList.toggle("ativo", _relatorioAlvoPeriodo === 'descarga');
}

function filtroRapido(arg1, arg2) {
    let contexto, periodo;
    if (arg2 === undefined) { contexto = 'relatorio'; periodo = arg1; }
    else { contexto = arg1; periodo = arg2; }

    const hoje = new Date();
    const toISO = _isoLocal;   // relógio do computador; toISOString é UTC e vira o dia seguinte às 21h
    let inicio, fim = toISO(hoje);

    switch (periodo) {
        case 'hoje':   inicio = toISO(hoje); break;
        case 'semana': { const d = new Date(hoje); d.setDate(d.getDate() - d.getDay()); inicio = toISO(d); break; }
        case 'mes':    inicio = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`; break;
        case 'mes_anterior': {
            const d = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1);
            const df = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
            inicio = toISO(d); fim = toISO(df); break;
        }
        case '30dias': { const d = new Date(hoje); d.setDate(d.getDate()-30); inicio = toISO(d); break; }
        case '90dias': { const d = new Date(hoje); d.setDate(d.getDate()-90); inicio = toISO(d); break; }
        case 'ano':    inicio = `${hoje.getFullYear()}-01-01`; break;
        default: return;
    }

    if (contexto === 'relatorio') {
        // Com dois pares de datas, o atalho escreve no par que o segmentado
        // aponta, e limpa o outro. Preencher os dois de uma vez pareceria
        // gentileza e seria armadilha: o cruzamento dos dois recortes
        // esconde justamente a nota da fronteira, sem ninguém ter pedido.
        const alvoDescarga = _relatorioAlvoPeriodo === 'descarga';
        const idIni = alvoDescarga ? "filtroDescargaInicio" : "filtroDataInicio";
        const idFim = alvoDescarga ? "filtroDescargaFim"    : "filtroDataFim";
        const outros = alvoDescarga ? ["filtroDataInicio", "filtroDataFim"]
                                    : ["filtroDescargaInicio", "filtroDescargaFim"];
        const elI = document.getElementById(idIni);
        const elF = document.getElementById(idFim);
        if (elI) elI.value = inicio;
        if (elF) elF.value = fim;
        outros.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        _aplicarFiltroRelatorio();
    } else if (contexto === 'analitico') {
        const elI = document.getElementById("analiticoInicio");
        const elF = document.getElementById("analiticoFim");
        if (elI) elI.value = inicio;
        if (elF) elF.value = fim;
        if (typeof carregarAnalitico === 'function') recalcularTela('analitico', carregarAnalitico);
    }
}

/**
 * Aplica um filtro rápido de período no relatório de entradas e dispara exportação PDF.
 * @param {'mes'|'mes_anterior'} periodo
 */
function exportarPeriodoRapido(periodo) {
    filtroRapido('relatorio', periodo);
    // Aguarda o carregarRelatorio terminar de popular dadosRelatorioAtual
    setTimeout(() => {
        if (!dadosRelatorioValidos || dadosRelatorioValidos.length === 0) {
            mostrarToast('Nenhum lançamento no período para exportar.', 'aviso', 4000);
            return;
        }
        exportarPDF('relatorio');
    }, 300);
}

/** A linha da nota que acabou de ser editada ou restaurada pisca na tabela (18/09/2026). */
function destacarLinhaRelatorio(id) {
    const linha = document.querySelector(`#tabelaRelatorio > tr[data-id="${CSS.escape(String(id))}"]`);
    if (!linha) return;
    linha.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (typeof confirmarNoLocal === "function") confirmarNoLocal(linha);
}

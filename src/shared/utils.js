/*=================================================
  UTILS.JS – Funções utilitárias globais
  Centraliza formatação, spinners, cores, etc.
  Inclua este arquivo antes dos demais no index.html
=================================================*/

// ========== ESCAPE HTML (evita XSS ao inserir dados do usuário em innerHTML) ==========
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escapa um valor para uso seguro dentro de um argumento de string simples
 * em um atributo `onclick="fn('...')"`, o caso mais comum no projeto.
 *
 * Duas camadas são necessárias: primeiro escapar barra invertida e aspas
 * simples (para não fechar a string JS antes da hora), depois aplicar
 * escapeHtml (para não fechar o próprio atributo HTML, delimitado por
 * aspas duplas). Fazer só a primeira camada (como `str.replace(/'/g,"\\'")`,
 * padrão usado em vários pontos do projeto) não impede que um valor com `"`
 * quebre o atributo.
 */
function escapeJsAttr(str) {
    const paraJs = String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return escapeHtml(paraJs);
}

// ========== CRITÉRIO ÚNICO DE LITROS ==========
/**
 * Litros efetivos de um item de lançamento: usa a quantidade descarregada
 * quando informada (reflete perdas reais de descarga), senão a carga bruta
 * da nota.
 *
 * Vive em utils.js (carregado antes de todos os módulos) para que
 * Dashboard, Analítico, Relatórios, Histórico e a busca global nunca
 * divirjam no total de litros de um mesmo período.
 *
 * ATENÇÃO: use apenas para AGREGAR volume. Preço unitário (R$/L) continua
 * baseado na carga da nota (`item.qtd`), que é a quantidade efetivamente
 * faturada: dividir o valor pela quantidade descarregada inflaria o preço.
 */
function _litrosItem(i) {
    return (i.qtdDescargada > 0 ? i.qtdDescargada : i.qtd) || 0;
}

/* ── TELA VAZIA QUE ENSINA ──────────────────────────────────────────
   Até 17/09/2026 toda tabela sem dado dizia "Sem dados." em itálico
   cinza, e paravam aí. Para uma empresa nova, ou no primeiro dia de um
   operador, a primeira coisa que ele via era uma frase morta. Agora o
   vazio diz o motivo provável e oferece o próximo passo, que é o padrão
   que as ferramentas boas usam e que as pesquisas desta rodada apontaram
   como o mais elogiado em estado vazio.

   `acao` é opcional: `{ texto, onclick }`. */
function linhaTabelaVazia(colunas, titulo, motivo, acao) {
    const botao = acao
        ? `<div class="mt-2"><button class="btn-secundario" onclick="${escapeHtml(acao.onclick)}">${escapeHtml(acao.texto)}</button></div>`
        : "";
    return `<tr><td colspan="${colunas}" class="td-vazio td-vazio--ensina">
        <strong class="td-vazio-titulo">${escapeHtml(titulo)}</strong>
        <span>${escapeHtml(motivo)}</span>${botao}
    </td></tr>`;
}

// ========== CRITÉRIO ÚNICO DE LANÇAMENTO VÁLIDO ==========
/**
 * Um lançamento que deixou de valer continua no vetor e sai de toda conta.
 *
 * `estado` é opcional e a AUSÊNCIA dele significa ativo. Isso não é
 * detalhe de estilo: os lançamentos gravados antes desta mudança não têm
 * o campo, e escrever `l.estado === 'ativo'` faria a base histórica
 * inteira desaparecer dos relatórios de uma vez. É a mesma convenção
 * permissiva que o projeto já usa nos cadastros (`ativo !== false`) e que
 * as regras do Firestore repetem no servidor com `get('ativo', true)`.
 *
 * Valores: ausente (ativo), `'excluido'` (o operador apagou; reversível
 * pelo botão Restaurar) e `'cancelado'` (a NF-e foi cancelada na origem;
 * não é revertida pelo operador). Os dois saem de litros, custo médio,
 * frete, KPIs, referência de preço e exportações: a diferença está na
 * visibilidade e no caminho de volta, não na aritmética.
 *
 * Vive em utils.js, ao lado de `_litrosItem`, pelo mesmo motivo: é
 * carregado antes de todos os módulos, e nenhuma tela pode ter a sua
 * própria opinião sobre o que conta.
 */
function lancamentoAtivo(l) {
    return !!l && !l.estado;
}

/* ── O PREÇO POR LITRO, NUM LUGAR SÓ ────────────────────────────────
   Decisão do dono em 17/09/2026, depois da rodada 12 (cinco pesquisas
   lidas): o número principal das telas é o **preço médio de compra**:
   valor pago dividido pelos litros FATURADOS na nota. É o preço que o
   fornecedor cobrou, e é completo: entra toda nota.

   O custo por litro RECEBIDO (com a perda de trânsito embutida) é outra
   pergunta, e só existe onde alguém mediu a descarga. Ele vem ao lado,
   dizendo em quantos itens se apoia: na base de demonstração isso é um
   item em cada cinco, e uma métrica assim no lugar de destaque daria a
   impressão de cobrir tudo.

   Até aqui as três telas dividiam o valor pelos litros de `_litrosItem`
   (descarga quando informada, carga quando não), o que contrariava a
   regra escrita logo acima nesta mesma função e inflava o preço nas notas
   com perda. Agora a única conta é esta.

   `_litrosItem` continua sendo o critério de VOLUME: litros
   descarregados, que é o que o Dashboard, o Relatório e o Analítico
   mostram como litros. Preço é uma coisa, volume é outra. */
function metricasPreco(itens) {
    let gasto = 0, litrosNota = 0, itensTotal = 0;
    let gastoMedido = 0, litrosRecebidos = 0, itensMedidos = 0, litrosNotaMedidos = 0;
    (itens || []).forEach(i => {
        const qtd   = Number(i.qtd) || 0;
        const valor = i.total != null ? Number(i.total) : qtd * (Number(i.valor) || 0);
        gasto      += valor || 0;
        litrosNota += qtd;
        itensTotal++;
        if (Number(i.qtdDescargada) > 0) {
            gastoMedido       += valor || 0;
            litrosRecebidos   += Number(i.qtdDescargada);
            litrosNotaMedidos += qtd;
            itensMedidos++;
        }
    });
    return {
        gasto, litrosNota, itensTotal,
        litrosRecebidos, itensMedidos, litrosNotaMedidos,
        // O número principal: preço de compra, sobre a carga faturada.
        precoCompra:   litrosNota > 0 ? gasto / litrosNota : 0,
        // O de reconciliação: só os itens em que a descarga foi informada.
        custoRecebido: litrosRecebidos > 0 ? gastoMedido / litrosRecebidos : 0,
        // O preço do MESMO grupo pela carga, para a comparação ser honesta:
        // sem ele, o operador compararia 5 itens medidos com 34 faturados e
        // concluiria qualquer coisa.
        precoCompraMedido: litrosNotaMedidos > 0 ? gastoMedido / litrosNotaMedidos : 0
    };
}

/** Texto curto que explica a conta, para o `title` de um número na tela. */
function explicacaoPrecoCompra(m) {
    return `Preço médio de compra: valor das notas ÷ litros faturados nelas.\n`
         + `${fmtR(m.gasto)} ÷ ${fmtL3(m.litrosNota)} · ${m.itensTotal} item(ns)`;
}

/** Frase do custo por litro recebido, ou vazio quando ninguém mediu. */
function textoCustoRecebido(m) {
    if (!(m.custoRecebido > 0)) return "";
    // Os dois números do MESMO grupo: o que foi faturado e o que chegou.
    // A diferença entre eles é o efeito da perda de trânsito, e só existe
    // onde alguém mediu.
    return `nos ${m.itensMedidos} de ${m.itensTotal} item(ns) com descarga informada: `
         + `${fmtRL(m.custoRecebido)}/L recebido contra ${fmtRL(m.precoCompraMedido)}/L faturado`;
}

// ========== AS DUAS DATAS DE UM LANÇAMENTO ==========
/**
 * Uma nota tem duas datas, e cada uma responde a uma pergunta diferente.
 * Rodada 11, decisão do dono (16/09/2026): não dá para pôr uma só como base
 * de tudo: depende do contexto.
 *
 * - DESCARGA: quando o combustível entrou nos tanques. É a base de VOLUME:
 *   Fretes (pagos pelo que foi transportado na competência), Conferência com
 *   o tanque, e os blocos de litros do Dashboard.
 * - EMISSÃO: quando a compra foi faturada. É a base de VALOR: Relatórios e
 *   o PDF, o Relatório Mensal Gerencial, o Analítico, a referência de preço,
 *   a duplicidade, e os blocos de compra do Dashboard.
 *
 * A regra que organiza as telas: uma tela ou um bloco usa UMA base só, e diz
 * qual. Misturar as duas no mesmo número produz coisa que não é de nota
 * nenhuma: o custo médio de agosto com os reais da emissão e os litros da
 * descarga dava R$ 5,7232/L no modo demo, contra R$ 5,8102 e R$ 5,8256 das
 * bases puras.
 *
 * A descarga é obrigatória no lançamento desde a rodada 11. O recurso à data
 * da nota fica só como defesa para registro antigo que não a tenha.
 */
function dataDescargaDe(l) {
    return (l && (l.dataDescarga || l.dataNota)) || "";
}

function dataEmissaoDe(l) {
    return (l && l.dataNota) || "";
}

/**
 * A nota passa nos dois recortes de data ao mesmo tempo (22/09/2026).
 *
 * O Histórico ganhou o par de datas da DESCARGA além do par da EMISSÃO, a
 * pedido do dono: a operação dele gira em torno da descarga, e ela é a base
 * do frete. Os dois pares somam, não substituem, e a regra é E, nunca OU.
 *
 * O E é o ponto, e vale escrever por que: com OU, pedir "emitidas em agosto"
 * junto de "descarregadas em agosto" traria a nota emitida em 31/07 e
 * descarregada em 01/08 e a emitida em 31/08 e descarregada em 01/09, as
 * duas fora do que se pediu, e o total do mês passaria a somar litros que
 * não são dele. Foi esse mesmo erro, com uma data só, que em 16/09/2026
 * fazia julho e agosto somarem 29.500 L a mais que o intervalo inteiro.
 *
 * Com o E, preencher os dois pares é justamente o que isola a nota da
 * fronteira: "emitida em agosto E descarregada em setembro" é uma pergunta
 * que antes não tinha como fazer nesta tela.
 *
 * Par vazio não filtra nada. Data ausente na nota reprova quando o par
 * correspondente está preenchido: sem a data não há como afirmar que ela
 * está dentro.
 *
 * @param {object} l - o lançamento
 * @param {{emissaoInicio?:string, emissaoFim?:string, descargaInicio?:string, descargaFim?:string}} p
 * @returns {boolean}
 */
function _passaPeriodos(l, p) {
    const f = p || {};
    const dentro = (d, ini, fim) => {
        if (!ini && !fim) return true;
        if (!d) return false;
        return (!ini || d >= ini) && (!fim || d <= fim);
    };
    return dentro(dataEmissaoDe(l),  f.emissaoInicio,  f.emissaoFim)
        && dentro(dataDescargaDe(l), f.descargaInicio, f.descargaFim);
}

/** `"YYYY-MM-DD"` de uma data pelo relógio do computador.
 *  Nunca `toISOString().slice(0, 10)`: é a data em UTC, e no horário de
 *  Brasília ela já é o dia seguinte a partir das 21h. */
function _isoLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function _hojeISO() {
    return _isoLocal(new Date());
}

/** Soma dias a uma data `"YYYY-MM-DD"` e devolve outra, sem passar por UTC. */
function _somarDiasISO(iso, dias) {
    const [a, m, d] = iso.split("-").map(Number);
    return _isoLocal(new Date(a, m - 1, d + dias));
}

/** Último dia do mês de uma data `"YYYY-MM-DD"`. */
function _ultimoDiaDoMesISO(iso) {
    const [a, m] = iso.split("-").map(Number);
    return _isoLocal(new Date(a, m, 0));
}

/**
 * O período imediatamente anterior a [inicio, fim], para comparação.
 *
 * Se o período começa no dia 1, é o mesmo trecho do mês anterior: de 01/09 a
 * 16/09 compara com 01/08 a 16/08, e o mês inteiro com o mês inteiro (o dia
 * final é limitado ao tamanho do mês). Fora isso, o mesmo número de dias
 * logo antes do início. Antes, a variação dos blocos por combustível
 * comparava sempre com o mês anterior a HOJE: com agosto escolhido em
 * setembro, comparava agosto com agosto.
 */
function _periodoAnterior(inicio, fim) {
    const [ai, mi, di] = inicio.split("-").map(Number);
    const [af, mf, df] = fim.split("-").map(Number);
    if (di === 1 && ai === af && mi === mf) {
        const ini = _isoLocal(new Date(ai, mi - 2, 1));
        const ultimo = Number(_ultimoDiaDoMesISO(ini).slice(8, 10));
        const diaFim = fim === _ultimoDiaDoMesISO(fim) ? ultimo : Math.min(df, ultimo);
        return { inicio: ini, fim: _isoLocal(new Date(ai, mi - 2, diaFim)) };
    }
    const dias = Math.round((new Date(af, mf - 1, df) - new Date(ai, mi - 1, di)) / 86400000) + 1;
    return { inicio: _somarDiasISO(inicio, -dias), fim: _somarDiasISO(inicio, -1) };
}

// ========== TAXA DE FRETE DA EMPRESA ==========
/**
 * Taxa de frete (R$/litro) de um registro de empresa, normalizada.
 *
 * A taxa é atributo da empresa contratante, não do combustível
 * transportado. Valor ausente, inválido ou negativo vira 0, para que o
 * cálculo de frete nunca produza NaN nem valor negativo.
 *
 * `_taxaFreteDaEmpresa(empresa)` devolve a taxa DE HOJE. Para calcular
 * frete de um mês passado use `_taxaFreteDaEmpresaNaData(empresa, iso)`:
 * até 17/09/2026 a taxa era um valor único, e mudá-la reescrevia em
 * silêncio todos os meses já pagos: nada de frete é gravado, a tela
 * recalcula tudo a cada abertura. Agora cada mudança fecha a vigência
 * anterior e abre outra, do mesmo jeito que a composição de um conjunto
 * de veículos já fazia.
 */
function _taxaFreteDaEmpresaNaData(empresa, iso) {
    if (!empresa) return 0;
    const hist = Array.isArray(empresa.taxaHistorico) ? empresa.taxaHistorico : [];
    if (!hist.length || !iso) return _taxaFreteDaEmpresa(empresa);
    // Da vigência mais nova para a mais antiga: a primeira que contém a
    // data é a que valia naquele dia.
    const achada = [...hist]
        .sort((a, b) => String(b.vigenciaDe || "").localeCompare(String(a.vigenciaDe || "")))
        .find(v => String(v.vigenciaDe || "") <= iso && (!v.vigenciaAte || iso <= String(v.vigenciaAte)));
    if (achada) {
        const t = Number(achada.taxa);
        return isFinite(t) && t > 0 ? t : 0;
    }
    // Data anterior a toda vigência registrada: a mais antiga é a melhor
    // aproximação do que se cobrava então, e é o que o sistema mostrava
    // antes de existir histórico.
    const maisAntiga = [...hist].sort((a, b) => String(a.vigenciaDe || "").localeCompare(String(b.vigenciaDe || "")))[0];
    const t = Number(maisAntiga && maisAntiga.taxa);
    return isFinite(t) && t > 0 ? t : _taxaFreteDaEmpresa(empresa);
}

/* Um cadastro pelo nome ou por um dos apelidos (22/09/2026).

   O apelido existe porque a equipe escreve "BMAD" e "RICARDO R" há anos,
   enquanto o cadastro guarda "RAIZEN · S. F. CONDE" e "RICARDO RODRIGUES
   DA COSTA". O seletor da tela já achava pelos dois; esta função leva a
   mesma regra para a IMPORTAÇÃO de lançamentos, que casava só pelo nome e
   gravaria a nota com a base "BMAD" solta, fora do cadastro.

   Duas cautelas que não são detalhe:
   - Nome exato vence sempre. Um apelido nunca rouba de um nome de verdade.
   - Apelido repetido em dois cadastros devolve `null` em vez de sortear
     um. Quem importa vê a linha como não resolvida e decide; adivinhar
     aqui gravaria a nota no motorista errado sem nenhum rastro. */
function _cadastroPorNomeOuApelido(lista, texto) {
    const alvo = normalizarTexto(texto || "");
    if (!alvo) return null;
    const cadastros = (lista || []).filter(c => c && c.nome);
    const porNome = cadastros.find(c => normalizarTexto(c.nome) === alvo);
    if (porNome) return porNome;
    const porApelido = cadastros.filter(c =>
        String(c.apelidos || "").split("/").some(a => a.trim() && normalizarTexto(a) === alvo));
    return porApelido.length === 1 ? porApelido[0] : null;
}

/* Percentual do frete que vai para o motorista (22/09/2026).

   Veio da planilha do dono: em agosto ele pagou R$ 5.967,00 sobre
   R$ 596.700,00 de frete, que é 1% exato, e a conta dele era
   "(litros POSTO + litros TRR) ÷ 1.000", ou seja, R$ 1,00 por mil litros,
   que com a taxa de R$ 0,10/L dá no mesmo. Guardamos como PERCENTUAL do
   frete, não como valor fixo por mil litros: assim, no dia em que a taxa
   subir, o que o motorista recebe acompanha, que é o que ele confirmou
   querer.

   Padrão 1% quando a empresa não tem o campo. Zero digitado é zero de
   verdade: quem não paga percentual grava 0 e o campo respeita. */
function _percentualMotoristaDaEmpresa(empresa) {
    const p = parseFloat(empresa && empresa.percentualMotorista);
    return isFinite(p) && p >= 0 ? p : 1;
}

/* O percentual que VALIA numa data (23/09/2026). Ganhou vigência igual à
   da taxa, a pedido do dono, junto com o mês fechado: sem ela, mudar o %
   reescrevia o pagamento de todos os meses, inclusive os já fechados.
   Empresa sem `pctHistorico` usa o percentual único, como sempre usou; data
   anterior à primeira vigência usa a mais antiga, como a taxa. */
function _percentualMotoristaDaEmpresaNaData(empresa, iso) {
    const hist = Array.isArray(empresa && empresa.pctHistorico) ? empresa.pctHistorico : [];
    if (!hist.length || !iso) return _percentualMotoristaDaEmpresa(empresa);
    const valido = v => { const p = Number(v && v.pct); return isFinite(p) && p >= 0 ? p : null; };
    const achada = [...hist]
        .sort((a, b) => String(b.vigenciaDe || "").localeCompare(String(a.vigenciaDe || "")))
        .find(v => String(v.vigenciaDe || "") <= iso && (!v.vigenciaAte || iso <= String(v.vigenciaAte)));
    if (achada) { const p = valido(achada); return p === null ? _percentualMotoristaDaEmpresa(empresa) : p; }
    const maisAntiga = [...hist].sort((a, b) => String(a.vigenciaDe || "").localeCompare(String(b.vigenciaDe || "")))[0];
    const p = valido(maisAntiga);
    return p === null ? _percentualMotoristaDaEmpresa(empresa) : p;
}

function _taxaFreteDaEmpresa(empresa) {
    const taxa = parseFloat(empresa?.taxaFrete);
    return isNaN(taxa) || taxa < 0 ? 0 : taxa;
}

// ========== CORES PARA GRÁFICOS (CHART.JS) ==========
/* As cores das séries saem das variáveis do tema, como o resto do site.
   `success`, `warning` e `info` estavam escritas à mão com os valores do
   tema ESCURO, e ficavam assim também no claro, onde o CSS define tons
   mais escuros justamente porque os vivos não se leem sobre branco. A
   linha "Litros descarregados" do Dashboard saía no verde do tema escuro
   ao lado de ícones no verde do claro. (21/09/2026) */
function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const cs = getComputedStyle(document.documentElement);
    const v = (nome, reserva) => cs.getPropertyValue(nome).trim() || reserva;
    return {
        text: isDark ? '#e2e8f0' : '#1e293b',
        grid: isDark ? '#334155' : '#cbd5e1',
        primary: v('--primary', '#a02828'),
        success: v('--success', '#10b981'),
        warning: v('--warning', '#f59e0b'),
        info:    v('--info',    '#3b82f6'),
        background: isDark ? '#18181b' : '#ffffff'
    };
}

// ========== HISTÓRICO DE ALTERAÇÕES ==========
/* Um registro de log é sempre `{acao, ts, usuario, detalhe?}`. Os
   lançamentos já usavam esse formato; os cadastros gravavam texto puro, do
   tipo "Criado em 21/09/2026, 10:00", que dizia QUANDO mas não QUEM. Numa
   base com mais de uma pessoa lançando, um log que não diz quem mexeu não
   serve para o que o log existe. (21/09/2026)

   Os textos puros antigos continuam sendo lidos: `fmLogLinha` aceita os
   dois formatos, porque o que já está gravado não vai ser reescrito. */
function fmLogNovo(acao, detalhe) {
    const reg = {
        acao: acao,
        ts: new Date().toISOString(),
        usuario: (typeof window !== "undefined" && window._usuarioAtual?.nome) || "—"
    };
    if (detalhe) reg.detalhe = detalhe;
    return reg;
}

/** Uma linha do histórico, em HTML. Aceita o registro novo e o texto antigo. */
function fmLogLinha(log) {
    if (typeof log === "string") return `<li>${escapeHtml(log)}</li>`;
    if (!log || typeof log !== "object") return "";
    let quando = "";
    try { quando = new Date(log.ts).toLocaleString("pt-BR"); } catch (_) { quando = ""; }
    const quem = log.usuario && log.usuario !== "—" ? `, por ${escapeHtml(log.usuario)}` : "";
    const oQue = log.detalhe ? `: ${escapeHtml(log.detalhe)}` : "";
    return `<li><strong>${escapeHtml(log.acao || "Alterado")}</strong>`
         + (quando ? ` em ${quando}` : "") + quem + oQue + `</li>`;
}

/** O histórico inteiro, recolhido, com a contagem no título. */
function fmLogBloco(logs, titulo) {
    const lista = Array.isArray(logs) ? logs : [];
    if (!lista.length) return "";
    return `<details class="historico-cadastro">
        <summary class="historico-cadastro-titulo">${escapeHtml(titulo || "Histórico")} (${lista.length})</summary>
        <ul class="lista-limpa log-list">${lista.map(fmLogLinha).join("")}</ul>
    </details>`;
}

// ========== FORMATAÇÃO DE DATAS ==========
function formatarData(dataISO) {
    if (!dataISO) return "—";
    const [ano, mes, dia] = dataISO.split("-");
    return `${dia}/${mes}/${ano}`;
}

function nomeMes(anoMes) {
    const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    const [ano, mes] = anoMes.split("-");
    return `${meses[parseInt(mes,10)-1]}/${ano.slice(2)}`;
}

// ========== FORMATAÇÃO DE VALORES ==========
function fmtR(v) {
    return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function fmtL(v, decimais = 0) {
    return Number(v).toLocaleString("pt-BR", { minimumFractionDigits:decimais, maximumFractionDigits:decimais }) + " L";
}

function fmtL3(v) { return fmtL(v, 3); }

/* Eixo de gráfico: "R$ 4,5 mi", "600 mil L". O valor inteiro com centavos
   ("R$ 4.500.000,00") ocupava metade da largura do gráfico (18/09/2026).
   O número exato continua na dica ao passar o mouse. */
function _compacto(v) {
    const a = Math.abs(v);
    const f = (x, s) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + s;
    if (a >= 1e6) return f(v / 1e6, " mi");
    if (a >= 1e3) return f(v / 1e3, " mil");
    return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function fmtEixoR(v) { return "R$ " + _compacto(v); }
function fmtEixoL(v) { return _compacto(v) + " L"; }

/* Reais por litro do COMBUSTÍVEL: preço da nota, preço médio, régua de
   preço. Três casas, como a bomba mostra (R$ 5,899); valor em reais fica
   com duas (`fmtR`). Era `fmtR4`, com quatro, até 18/09/2026, a pedido do
   dono: "não precisam de tantos dígitos". A digitação do preço continua
   aceitando quatro, que é como a NF-e traz: arredondar na entrada mudaria
   o total da nota. */
function fmtRL(v) {
    return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits:3, maximumFractionDigits:3 });
}

/* Reais por litro do FRETE: a taxa contratada e o frete por litro que sai
   dela. Duas casas, decisão do dono em 22/09/2026.
   Por que é função separada de `fmtRL`, e não um parâmetro: são dois
   números de origens diferentes. O preço vem da NF-e, que traz até dez
   casas, e arredondá-lo esconde diferença real. A taxa vem de contrato, e
   os contratos do dono são redondos (R$ 0,10/L), e escrever "R$ 0,100" só
   sugeria uma precisão que não existe. Juntar os dois numa função só
   obrigaria cada chamador a lembrar qual é qual, e bastava errar um para o
   preço da nota perder uma casa em silêncio. */
function fmtFreteL(v) {
    return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits:2, maximumFractionDigits:2 });
}

/* Porcentagem em português: "2,4%". `toFixed(1) + "%"` escrevia "2.4%" nas
   variações e fatias do Analítico (18/09/2026). */
function fmtPct(v, casas = 1) {
    return Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%";
}

/** Imprime a folha montada em #areaImpressao (e não a tela aberta). */
function imprimirAreaDeImpressao() {
    document.body.classList.add("imprimindo");
    window.addEventListener("afterprint", () => document.body.classList.remove("imprimindo"), { once: true });
    window.print();
}

/* ══ NÚMERO EM PORTUGUÊS ═════════════════════════════════════════════
   Por que isto existe (tema 05 da pesquisa).

   Os campos numéricos usavam `<input type="number">`, e no Chrome em
   pt-BR isso falha em silêncio de três maneiras, todas verificadas no
   navegador antes de escrever este código:

   1. Digitar "1,5" deixa o campo VAZIO, e `checkValidity()` ainda
      responde `true`, porque campo vazio é válido quando não é
      obrigatório. Nenhuma borda vermelha, nenhum aviso.
   2. A roda do mouse sobre o campo focado altera o valor. Rolar cinco
      cliques sobre 10000 litros deixou 9999,999. Ninguém vê isso.
   3. `parseFloat("1,23") || 0` devolve 1, e `parseFloat("1.234,56")`
      devolve 1,234. O padrão antigo do código não zerava o que não
      entendia: ele TRUNCAVA, e truncar é pior, porque 1 litro passa por
      qualquer validação de "maior que zero" enquanto um zero chamaria
      atenção.

   A saída é tratar número como texto e fazer a conversão aqui, num só
   lugar. `parseFloat` cru não deve mais tocar em valor digitado.
   ────────────────────────────────────────────────────────────────── */

/**
 * Converte texto em número, entendendo a escrita brasileira.
 *
 * Aceita "1234,5", "1.234,56", "1234.5", "R$ 1.234,56" e "1 234,56".
 * Quando há vírgula, ela é o separador decimal e os pontos são milhar.
 * Quando só há pontos, decide por heurística de tamanho, a mesma que a
 * importação de planilha já usava desde antes deste tema.
 *
 * **Nunca devolve zero para entrada que não entendeu.** Devolve `null`,
 * para quem chama poder distinguir "vazio", "inválido" e "zero de
 * verdade". Era exatamente essa confusão que corrompia número em
 * silêncio.
 *
 * @param {string|number} valor
 * @returns {number|null} número, ou `null` se vazio ou irreconhecível
 */
function parseNumeroBR(valor) {
    if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

    let s = String(valor ?? "")
        .replace(/R\$/gi, "")
        // Tira espaço, espaço inquebrável e espaço fino, que aparecem como
        // separador de milhar. **Não** tira tabulação nem quebra de linha:
        // essas são separador de CÉLULA. Enquanto `\s` levava as duas
        // embora, colar duas células do Excel ("60000" + tab + "5,234")
        // virava "600005,234", passava no teste de número válido logo
        // abaixo e era escrito no campo já formatado como 600.005,234,
        // plausível e cem vezes errado.
        .replace(/[ \u00A0\u202F]/g, "")
        .trim();

    if (!s || s === "-") return null;
    // Só dígitos, separadores e um sinal na frente.
    if (!/^[+-]?[\d.,]+$/.test(s)) return null;

    const negativo = s.startsWith("-");
    s = s.replace(/^[+-]/, "");

    const virgulas = (s.match(/,/g) || []).length;
    const pontos   = (s.match(/\./g) || []).length;

    if (virgulas > 1) return null;              // "1,2,3" não é número

    if (virgulas === 1) {
        // Vírgula manda: ela é o decimal, todo ponto é milhar.
        s = s.replace(/\./g, "").replace(",", ".");
    } else if (pontos > 1) {
        // "1.234.567" só pode ser agrupamento de milhar.
        s = s.replace(/\./g, "");
    } else if (pontos === 1) {
        // O caso ambíguo: "1.234" tanto pode ser mil e duzentos e trinta
        // e quatro quanto um vírgula duzentos e trinta e quatro. A
        // heurística abaixo veio da importação de planilha, onde já era
        // usada, e só age quando há exatamente três casas depois do
        // ponto, que é o formato de milhar. O operador vê o resultado
        // formatado ao sair do campo, então uma interpretação errada
        // fica visível antes de virar lançamento.
        const [inteiro, decimal] = s.split(".");
        const semSinal = inteiro.replace("-", "");
        if (decimal.length === 3) {
            const vi = parseInt(semSinal, 10) || 0;
            if (semSinal.length >= 4 || vi >= 100 || decimal.endsWith("00")) {
                s = s.replace(".", "");
            }
        }
    }

    const n = Number((negativo ? "-" : "") + s);
    return Number.isFinite(n) ? n : null;
}

/**
 * Número no formato em que o operador o edita: vírgula decimal, sem
 * separador de milhar. Agrupar durante a edição faria o cursor pular a
 * cada tecla, que é a reclamação clássica de campo com máscara.
 */
function fmtNumeroEdicao(n, casas) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
    return Number(n).toLocaleString("pt-BR", {
        useGrouping: false,
        minimumFractionDigits: 0,
        maximumFractionDigits: casas
    });
}

/**
 * Número como fica depois de editado: com separador de milhar e casas
 * fixas. Sem unidade e sem cifrão: eles ficam no rótulo, nunca dentro
 * do campo, senão o próprio parser teria de removê-los depois.
 */
function fmtNumeroExibicao(n, casas) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
    return Number(n).toLocaleString("pt-BR", {
        minimumFractionDigits: casas,
        maximumFractionDigits: casas
    });
}

// ========== FORMATAÇÃO DE TOOLTIPS (CHART.JS) ==========
function formatarTooltipValor(valor, tipo = 'R$') {
    if (tipo === 'R$') {
        return 'R$ ' + valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
        return valor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' L';
    }
}

/*─────────────────────────────────────────────────
  NORMALIZAÇÃO DE TEXTO (remove diacríticos)
  Usa o range Unicode correto: U+0300–U+036F
─────────────────────────────────────────────────*/
function normalizarTexto(str) {
    return String(str)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

// ========== SPINNERS ==========
function mostrarSpinner(botao, textoOriginal = null) {
    if (!botao) return;
    botao.dataset.originalText = textoOriginal || botao.innerText;
    botao.classList.add('btn-spinner');
    botao.disabled = true;
}

function esconderSpinner(botao) {
    if (!botao) return;
    botao.classList.remove('btn-spinner');
    botao.disabled = false;
    if (botao.dataset.originalText) {
        botao.innerText = botao.dataset.originalText;
    }
}

// ========== PREENCHER SELECT ==========
function preencherSelect(idSelect, itens, textoPadrao) {
    const sel = document.getElementById(idSelect);
    if (!sel) return;
    sel.innerHTML = `<option value="">-- ${escapeHtml(textoPadrao)} --</option>` +
        itens.map(i => `<option value="${escapeHtml(i.valor)}">${escapeHtml(i.texto)}</option>`).join("");
}

// ========== CÉLULA DE CSV ==========
/* Uma célula de CSV exportado. Aspas internas são dobradas (antes um nome
   com aspas deslocava as colunas seguintes) e texto que começa com = + - @
   ganha um apóstrofo na frente, para o Excel não o executar como fórmula
   (um cadastro "=HYPERLINK(...)" virava link que vazava dado ao abrir o
   arquivo). Número continua número. */
function _celulaCSV(cell) {
    if (typeof cell === "number") return String(cell);
    let t = String(cell ?? "");
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
}

// ========== CONFIGURAÇÕES DE ALERTAS (compartilhado) ==========
/* A configuração é do sistema, igual para todos: vive em `db.configAlertas`,
   que vai para o documento compartilhado junto dos cadastros. Até 16/09/2026
   ela ficava no `localStorage` de cada navegador: duas pessoas olhando o
   mesmo Dashboard podiam ver alertas diferentes, e o lançamento nem a lia.
   Só admin e supremo alteram (a regra do Firestore garante no servidor). */
const ALERTAS_CONFIG_PADRAO = {
    precoAtivo:       true,
    precoDiferencaR$: 0.25,
    precoPeriodoDias: 7,
    volumeAtivo:      true,
    volumeAcimaPerc:  50,
    volumeAbaixoPerc: 50,
    dataAtivo:        true,
    dataTolerDias:    0,
    dataMaxDescNota:  30,
};

function configAlertas() {
    const salvo = (typeof db !== "undefined" && db && db.configAlertas) || {};
    return Object.assign({}, ALERTAS_CONFIG_PADRAO, salvo);
}

/** Grava a configuração inteira (todos os campos do modal). */
function salvarConfigAlertas(cfg) {
    db.configAlertas = Object.assign({}, cfg);
    // A cópia antiga, por navegador, não vale mais nada e não deve confundir.
    try { localStorage.removeItem("configAlertas"); } catch (_) {}
    salvarDB();
}

/* ── A RÉGUA DO PREÇO ───────────────────────────────────────────────
   Uma régua só, para o lançamento e para o Dashboard (decisão do dono,
   16/09/2026). Antes eram duas: o lançamento usava mediana de 7 dias com
   10 %, fixa no código; o Dashboard, média de 30 dias com R$ 0,10/L, no
   navegador. A mesma nota podia ser alerta numa tela e não na outra.

   - Mediana, não média: uma nota com preço fora puxaria a média para
     perto de si e calaria o alerta das vizinhas.
   - Janela de N dias (configurável, padrão 7) terminando em `fimISO`, pela
     data de emissão: preço é fato da compra (rodada 11). A nota julgada
     não entra na régua que a julga. "7 dias" é o dia da emissão e os 6
     anteriores.
   - Basta uma nota para haver referência (decisão do dono, tema 06).
   - Diferença em reais por litro, para cima ou para baixo (configurável,
     padrão R$ 0,25/L). Alerta quando a diferença é maior ou igual ao
     limite, comparada em quatro casas (a precisão do preço) para que
     R$ 6,25 contra R$ 6,00 seja 0,25 e não 0,2499999. */
function referenciaPrecoCombustivel(nomeCombustivel, fimISO, idIgnorar, empresa) {
    // A régua é sempre da empresa da nota; a ativa só serve de padrão.
    const empresaRegua = empresa || empresaFiltroGlobal;
    const cfg    = configAlertas();
    const dias   = cfg.precoPeriodoDias;
    const fim    = fimISO || _hojeISO();
    // "7 dias" são 7 dias de calendário: o dia da nota e os 6 anteriores.
    // A conta antiga incluía as duas pontas e cobria 8.
    const inicio = _somarDiasISO(fim, -(Math.max(1, dias) - 1));

    const precos = (db.lancamentos || [])
        .filter(l => {
            // Excluída não aconteceu; cancelada foi desfeita. Com uma nota
            // bastando, uma só nota morta viraria régua.
            if (!lancamentoAtivo(l)) return false;
            if (empresaRegua && l.empresa !== empresaRegua) return false;
            if (idIgnorar && l.id === idIgnorar) return false;
            const e = dataEmissaoDe(l);
            return e >= inicio && e <= fim;
        })
        .flatMap(l => (l.itens || [])
            .filter(i => i.tipo === nomeCombustivel && i.valor > 0)
            .map(i => i.valor))
        .sort((a, b) => a - b);

    if (precos.length === 0) return { mediana: 0, amostras: 0, dias, fim };
    const meio = Math.floor(precos.length / 2);
    const mediana = precos.length % 2
        ? precos[meio]
        : (precos[meio - 1] + precos[meio]) / 2;
    return { mediana, amostras: precos.length, dias, fim };
}

/** Julga um preço contra a referência. `null` quando não há alerta. */
function julgarPreco(valor, mediana) {
    const cfg = configAlertas();
    if (!cfg.precoAtivo || !(valor > 0) || !(mediana > 0)) return null;
    const diferenca = Math.round((valor - mediana) * 10000) / 10000;
    const limite    = Math.round(Number(cfg["precoDiferencaR$"]) * 10000) / 10000;
    if (Math.abs(diferenca) < limite) return null;
    return { diferenca, acima: diferenca > 0, limite };
}


/* ── MOTOR DE FRETE (extraído em 18/09/2026) ────────────────────────
   Até aqui a conta do frete morava dentro de `calcularEExibirFretes`,
   que lia o mês de um campo da tela, dependia das globais `db` e
   `empresaFiltroGlobal` e terminava desenhando quatro tabelas: não havia
   como chamá-la com dados e conferir o resultado. Agora a conta é esta
   função, sem DOM e sem global: recebe as notas e as duas funções de
   que depende (achar a empresa da nota e o conjunto da placa na data) e
   devolve o mesmo objeto que as abas sempre usaram.

   Regras, todas decisões do dono já registradas:
   - só nota válida (`lancamentoAtivo`) gera frete;
   - o mês é o da DESCARGA (rodada 11);
   - a quantidade é a da NOTA, a carga (08/09/2026);
   - a taxa é a que VALIA na data da descarga (vigência, 17/09/2026), e o
     % do motorista também (23/09/2026);
   - o conjunto é o que continha a placa NAQUELA data. */
function calcularFretesDoMes(opts) {
    const o = opts || {};
    const mes = o.mes;
    const empresaDe = o.empresaDoLancamento || (() => null);
    const resolver  = o.resolverConjunto || null;

    let semTaxa = 0, taxaZero = 0;
    const empresasTaxaZero = new Set();

    const lancamentosMes = (o.lancamentos || []).filter(l => {
        if (!lancamentoAtivo(l)) return false;
        if (o.empresaFiltro && l.empresa !== o.empresaFiltro) return false;
        const d = dataDescargaDe(l);
        return !!d && d.startsWith(mes);
    });

    const porPlaca = {}, porMotorista = {}, porEmpresa = {}, porConjunto = {};
    let totalLitros = 0, totalFrete = 0, totalPagamento = 0;

    /* `porEmpresa` dentro de cada grupo (22/09/2026): o fechamento que o
       dono entrega mostra, para cada conjunto, o volume e o frete
       separados por empresa: POSTO numa coluna, TRR na outra. Sem essa
       quebra só dava para somar o conjunto inteiro, e a planilha dele
       ficaria impossível de reproduzir. */
    const acumular = (grupo, tipo, litros, frete, pagamento, empresaNome) => {
        grupo.litros += litros;
        grupo.frete  += frete;
        grupo.pagamento = (grupo.pagamento || 0) + pagamento;
        if (!grupo.detalhes[tipo]) grupo.detalhes[tipo] = { litros: 0, frete: 0, pagamento: 0 };
        grupo.detalhes[tipo].litros += litros;
        grupo.detalhes[tipo].frete  += frete;
        grupo.detalhes[tipo].pagamento += pagamento;
        if (!grupo.porEmpresa) grupo.porEmpresa = {};
        if (!grupo.porEmpresa[empresaNome]) grupo.porEmpresa[empresaNome] = { litros: 0, frete: 0, pagamento: 0 };
        grupo.porEmpresa[empresaNome].litros += litros;
        grupo.porEmpresa[empresaNome].frete  += frete;
        grupo.porEmpresa[empresaNome].pagamento += pagamento;
    };

    lancamentosMes.forEach(l => {
        const placa      = l.placa     || "(sem placa)";
        const motorista  = l.motorista || "(sem motorista)";
        const cadEmpresa = empresaDe(l);
        const empresa    = (cadEmpresa && cadEmpresa.nome) || l.empresa || "(sem empresa)";
        const dataRef    = dataDescargaDe(l) || mes + "-01";
        const taxa       = _taxaFreteDaEmpresaNaData(cadEmpresa, dataRef);
        // O percentual é da empresa do lançamento: um motorista que rodou
        // para as duas no mês recebe cada parte pela regra da sua empresa.
        // E é o que valia na data da descarga, como a taxa (23/09/2026).
        const pctMot     = _percentualMotoristaDaEmpresaNaData(cadEmpresa, dataRef);
        if (!cadEmpresa) semTaxa++;
        else if (!(taxa > 0)) { taxaZero++; empresasTaxaZero.add(cadEmpresa.nome); }

        const resolvido     = resolver ? resolver(placa, dataRef) : null;
        const conjObj       = (resolvido && resolvido.conj) || null;
        const placasPeriodo = (resolvido && resolvido.periodo && resolvido.periodo.placas)
                           || (conjObj && conjObj.composicaoAtual) || [];
        const conjKey   = conjObj ? conjObj.id : null;
        const conjLabel = conjObj ? (conjObj.nome || `Conjunto ${placasPeriodo[0] || ""}`) : null;

        // `taxas`: as taxas que as notas do grupo usaram de fato (24/09/2026).
        // A coluna "Taxa (R$/L)" saía vazia para a placa que rodou para as
        // duas empresas, mesmo com as duas cobrando o mesmo valor.
        if (!porPlaca[placa])         porPlaca[placa]         = { nome: placa,     viagens: 0, litros: 0, frete: 0, pagamento: 0, detalhes: {}, empresas: new Set(), taxas: new Set(), conjunto: conjLabel };
        if (!porMotorista[motorista]) porMotorista[motorista] = { nome: motorista, viagens: 0, litros: 0, frete: 0, pagamento: 0, detalhes: {}, empresas: new Set(), taxas: new Set() };
        if (!porEmpresa[empresa])     porEmpresa[empresa]     = { nome: empresa,   viagens: 0, litros: 0, frete: 0, pagamento: 0, detalhes: {}, empresas: new Set(), taxas: new Set() };
        if (conjKey && !porConjunto[conjKey]) {
            porConjunto[conjKey] = {
                id: conjKey, nome: conjLabel, placas: placasPeriodo.slice(),
                viagens: 0, litros: 0, frete: 0, pagamento: 0, detalhes: {}, empresas: new Set(), taxas: new Set(), porPlacaInterna: {}
            };
        }

        // Uma viagem por nota, e não uma por combustível da nota.
        porPlaca[placa].viagens++;
        porMotorista[motorista].viagens++;
        porEmpresa[empresa].viagens++;
        porPlaca[placa].empresas.add(empresa);
        porMotorista[motorista].empresas.add(empresa);
        porEmpresa[empresa].empresas.add(empresa);
        porPlaca[placa].taxas.add(taxa);
        porMotorista[motorista].taxas.add(taxa);
        porEmpresa[empresa].taxas.add(taxa);
        if (conjKey) {
            const conj = porConjunto[conjKey];
            conj.viagens++;
            conj.empresas.add(empresa);
            conj.taxas.add(taxa);
            if (!conj.porPlacaInterna[placa]) conj.porPlacaInterna[placa] = { viagens: 0, litros: 0, frete: 0, pagamento: 0 };
            conj.porPlacaInterna[placa].viagens++;
        }

        (l.itens || []).forEach(item => {
            const litros = Number(item.qtd) || 0;
            const frete  = litros * taxa;
            const pagamento = frete * pctMot / 100;
            const tipo   = item.tipo || "Desconhecido";
            totalLitros += litros;
            totalFrete  += frete;
            totalPagamento += pagamento;
            acumular(porPlaca[placa], tipo, litros, frete, pagamento, empresa);
            acumular(porMotorista[motorista], tipo, litros, frete, pagamento, empresa);
            acumular(porEmpresa[empresa], tipo, litros, frete, pagamento, empresa);
            if (conjKey) {
                const conj = porConjunto[conjKey];
                acumular(conj, tipo, litros, frete, pagamento, empresa);
                conj.porPlacaInterna[placa].litros += litros;
                conj.porPlacaInterna[placa].frete  += frete;
                conj.porPlacaInterna[placa].pagamento += pagamento;
            }
        });
    });

    const porNome = obj => Object.values(obj).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return {
        mes,
        totalNotas: lancamentosMes.length,
        totalLitros,
        totalFrete,
        totalPagamento,
        // Os nomes das empresas do mês, na ordem em que sairão nas colunas
        // do fechamento. Ordenado para o relatório de dois meses seguidos
        // não trocar as colunas de lugar.
        empresasDoMes: Object.keys(porEmpresa).sort((a, b) => a.localeCompare(b, "pt-BR")),
        semTaxa,
        taxaZero,
        empresasTaxaZero: [...empresasTaxaZero],
        porPlaca:     porNome(porPlaca),
        porMotorista: porNome(porMotorista),
        porEmpresa:   porNome(porEmpresa),
        porConjunto:  porNome(porConjunto)
    };
}

/* ── UMA COR POR COMBUSTÍVEL, EM TODA TELA (18/09/2026) ─────────────
   Cada gráfico sorteava a própria cor: o Diesel S10 era vermelho numa
   pizza e azul na evolução de preços. O padrão que as ferramentas de
   painel elogiadas seguem (Tremor, por exemplo) é o contrário: a mesma
   categoria tem a mesma cor em todo lugar, e o olho aprende uma vez.

   A cor segue a ORDEM do cadastro de combustíveis, então não muda de um
   gráfico para outro nem de um dia para o outro enquanto o cadastro não
   mudar. Oito cores com contraste nos dois temas; "Outros" é sempre
   cinza. */
const PALETA_COMBUSTIVEIS = ["#a02828", "#2563eb", "#d97706", "#059669", "#7c3aed", "#db2777", "#0891b2", "#65a30d"];

function corDoCombustivel(nome) {
    if (!nome || nome === "Outros") return "#64748b";
    const lista = (typeof db !== "undefined" && db && db.combustiveis) ? db.combustiveis : [];
    let idx = lista.findIndex(c => c.nome === nome);
    if (idx === -1) {
        // Nome fora do cadastro: cor estável derivada do próprio nome.
        idx = [...String(nome)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    }
    return PALETA_COMBUSTIVEIS[idx % PALETA_COMBUSTIVEIS.length];
}

/* ── COMPARAÇÃO COM O PERÍODO ANTERIOR, NO PRÓPRIO NÚMERO ───────────
   "Isso é bom ou ruim?" é a pergunta de quem olha um total, e o Stripe
   responde no mesmo card: número, seta e variação. `inverter` é para os
   números em que subir é ruim (gasto, preço, frete): a cor segue o
   sentido do dinheiro, não da seta. */
function htmlVariacao(atual, anterior, rotuloAnterior, inverter) {
    if (!(anterior > 0) || !isFinite(atual)) return "";
    const pct = (atual - anterior) / anterior * 100;
    if (Math.abs(pct) < 0.05) return `<div class="kpi-variacao">= ${escapeHtml(rotuloAnterior)}</div>`;
    const sobe = pct > 0;
    const ruim = inverter ? sobe : !sobe;
    return `<div class="kpi-variacao ${ruim ? "kpi-variacao-ruim" : "kpi-variacao-boa"}"
        title="Período anterior (${escapeHtml(rotuloAnterior)}): ${escapeHtml(String(anterior.toLocaleString("pt-BR", { maximumFractionDigits: 3 })))}">
        ${sobe ? "▲" : "▼"} ${Math.abs(pct).toFixed(1).replace(".", ",")}% vs ${escapeHtml(rotuloAnterior)}</div>`;
}

/* ── BIBLIOTECAS SÓ QUANDO USADAS (18/09/2026) ──────────────────────
   A planilha (SheetJS) e o PDF (jsPDF e o plugin de tabela) vinham no
   <head> de toda abertura, inclusive para quem só lança nota, que é o
   uso de todo dia e não exporta nada. Agora elas são pedidas quando a
   pessoa entra numa tela que exporta ou lê planilha (Relatórios, Fretes,
   Grupo, Conferências, Sistema) e, por garantia, no próprio clique. O
   Chart.js continua no <head>: o Dashboard, que é a tela de entrada,
   usa gráfico. */
const _BIBLIOTECAS = {
    /* `xlsx-js-style` no lugar do SheetJS gratuito desde 25/09/2026 (pedido
       do dono: as planilhas no padrão dos PDFs, com cores e negrito). É o
       mesmo `XLSX`, com a mesma interface para ler e gravar, e grava o
       estilo de cada célula, que a versão gratuita ignorava. Não há no
       cdnjs; vem do jsDelivr.
       Antes dele, as tabelas de página de código (`cpexcel`), que o arquivo
       antigo trazia embutidas e este não traz: sem elas, um .xls de Excel 95
       (a importação e a conferência aceitam .xls) teria "€", aspas curvas e
       travessões lidos como caractere de controle (revisão de 25/09/2026). */
    cpexcel:   { src: "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/cpexcel.js",
                 pronta: () => typeof cptable !== "undefined" },
    xlsx:      { src: "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js", antes: "cpexcel",
                 pronta: () => typeof window !== "undefined" && !!window.XLSX },
    jspdf:     { src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
                 pronta: () => typeof window !== "undefined" && !!(window.jspdf && window.jspdf.jsPDF) },
    autotable: { src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
                 pronta: () => typeof window !== "undefined" && !!(window.jspdf && window.jspdf.jsPDF
                                && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable) },
    // Só para a prévia de PDF em celular e tablet, que não têm leitor de PDF
    // dentro da página (ver _pdfEntregar). A 3.11 é a última versão com
    // script comum; da 4 em diante ela só vem como módulo.
    pdfjs:     { src: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
                 worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
                 pronta: () => typeof window !== "undefined" && !!window.pdfjsLib }
};
const _bibliotecaPromessa = {};

function garantirBiblioteca(nome) {
    const b = _BIBLIOTECAS[nome];
    if (!b) return Promise.reject(new Error("Biblioteca desconhecida: " + nome));
    if (b.pronta()) return Promise.resolve();
    if (_bibliotecaPromessa[nome]) return _bibliotecaPromessa[nome];
    // `antes`: a que precisa estar carregada primeiro (as tabelas de página
    // de código, antes da planilha).
    if (b.antes && !_BIBLIOTECAS[b.antes].pronta()) {
        return (_bibliotecaPromessa[nome] = garantirBiblioteca(b.antes)
            .then(() => { delete _bibliotecaPromessa[nome]; return garantirBiblioteca(nome); })
            .catch(e => { delete _bibliotecaPromessa[nome]; throw e; }));
    }
    _bibliotecaPromessa[nome] = new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = b.src;
        el.async = false;
        el.onload = () => { if (nome === "xlsx") _prepararGravacaoPlanilha(); resolve(); };
        el.onerror = () => { delete _bibliotecaPromessa[nome]; reject(new Error("Falha ao carregar " + nome)); };
        document.head.appendChild(el);
    });
    return _bibliotecaPromessa[nome];
}

/* ── ACABAMENTO DAS PLANILHAS (18/09/2026) ─────────────────────────
   Toda planilha saía sem largura de coluna (nomes cortados, "####" nos
   valores) e sem formato de número (117460,2 em vez de 117.460,20). Em vez
   de mexer em cada uma das nove exportações, a gravação passa por aqui:
   cada aba ganha largura pelo conteúdo e formato pelo cabeçalho da coluna:
   reais com 2 casas, litros com 3 (inteiros sem casas), preço e taxa por
   litro com 3. A célula continua NÚMERO: soma e ordena no Excel. */
/* O formato de número de uma célula, decidido pelo cabeçalho da coluna
   (já em minúsculas). Função separada para caber nos testes: `XLSX` não
   existe fora do navegador e `ajustarPlanilha` sai na primeira linha.

   A ordem dos testes é a regra. "Frete (descarga)" é dinheiro, não litro;
   "Total litros (L)" é litro, não dinheiro. E o por-litro do FRETE vem
   antes do por-litro em geral (22/09/2026): "Taxa (R$/L)" e "Frete/L" têm
   duas casas, enquanto "Preço médio/L" continua com três. Sem esse
   primeiro teste o Excel escrevia "0,100" onde a tela já dizia "R$ 0,10". */
function _formatoPlanilhaPorCabecalho(h, valor) {
    if (/taxa|frete\s*\/\s*l/.test(h))                             return "#,##0.00";
    if (/\/l\b|pre[çc]o|unit/.test(h))                             return "#,##0.000";
    if (/r\$|frete|gasto|valor/.test(h))                           return "#,##0.00";
    if (/litro|\(l\)|carga|descarga|entrada|diferen/.test(h))      return Number.isInteger(valor) ? "#,##0" : "#,##0.000";
    if (/total/.test(h) || !Number.isInteger(valor))               return "#,##0.00";
    return "";
}

/* A aba montada por `_planilhaPadrao` (planilha-padrao.js) já traz os
   formatos, e com o "R$" e o "L" do PDF: aqui ela só ganha as larguras,
   contando esses símbolos. */
function ajustarPlanilha(ws) {
    if (!ws || !ws["!ref"] || typeof XLSX === "undefined") return;
    const padrao = !!ws["!padrao"];
    const faixa = XLSX.utils.decode_range(ws["!ref"]);
    const larguras = [];
    let cabecalho = [];
    for (let R = faixa.s.r; R <= faixa.e.r; R++) {
        const linha = [];
        for (let C = faixa.s.c; C <= faixa.e.c; C++) linha.push(ws[XLSX.utils.encode_cell({ r: R, c: C })]);
        const preenchidas = linha.filter(c => c && c.v !== "" && c.v != null);
        // Linha de cabeçalho: três ou mais textos e nenhum número. Planilhas
        // com várias seções (Fretes) trocam de cabeçalho no meio.
        const ehCabecalho = preenchidas.length >= 3 && preenchidas.every(c => c.t === "s");
        if (ehCabecalho) cabecalho = linha.map(c => (c ? String(c.v) : "").toLowerCase());
        linha.forEach((cel, i) => {
            if (!cel || cel.v === "" || cel.v == null) return;
            // Título de uma célula só (primeira coluna, linha sem mais nada)
            // não alarga a coluna: ele transborda para as vizinhas.
            if (i === 0 && preenchidas.length === 1 && cel.t === "s") return;
            if (cel.t === "n" && !ehCabecalho && !(padrao && cel.z)) {
                cel.z = _formatoPlanilhaPorCabecalho(cabecalho[i] || "", cel.v) || cel.z;
            }
            // As casas que o formato mostra: os "0" depois do ponto são fixos,
            // os "#" aparecem quando há.
            const decimais = (cel.z && cel.z.includes(".")) ? cel.z.split(".")[1].match(/^[0#]*/)[0] : "";
            const casas = (decimais.match(/0/g) || []).length;
            let texto = cel.t === "n"
                ? cel.v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: decimais.length })
                : String(cel.v);
            if (cel.t === "n" && cel.z && cel.z.includes('"R$"')) texto = "R$ " + texto;
            if (cel.t === "n" && cel.z && cel.z.includes('"L"')) texto += " L";
            // Letra maior ou em negrito ocupa mais: o valor dos cartões (12,
            // negrito) saía "####" numa coluna medida para a letra 10.
            const fonte = (cel.s && cel.s.font) || {};
            const escala = (fonte.sz ? fonte.sz / 10 : 1) * (fonte.bold ? 1.1 : 1);
            larguras[i] = Math.max(larguras[i] || 8, Math.min(Math.ceil(texto.length * escala) + 2, 48));
        });
    }
    ws["!cols"] = larguras.map(w => ({ wch: w || 8 }));
}

function _prepararGravacaoPlanilha() {
    if (typeof XLSX === "undefined" || XLSX.__acabamento) return;
    XLSX.__gravarOriginal = XLSX.writeFile;
    XLSX.writeFile = function (wb, nome, opcoes) {
        try { (wb.SheetNames || []).forEach(n => ajustarPlanilha(wb.Sheets[n])); }
        catch (e) { console.warn("Acabamento da planilha:", e); }
        return XLSX.__gravarOriginal(wb, nome, opcoes);
    };
    XLSX.__acabamento = true;
}

/** Em sequência: o plugin de tabela precisa do jsPDF antes dele. */
function garantirBibliotecas(nomes) {
    return (nomes || []).reduce((p, n) => p.then(() => garantirBiblioteca(n)), Promise.resolve());
}

/* Guarda de entrada: se as bibliotecas ainda não chegaram, busca e chama
   de novo a mesma ação quando chegarem. Devolve `true` quando adiou, e a
   função que chamou deve sair na hora. */
function adiarAteBibliotecas(nomes, acao) {
    if ((nomes || []).every(n => _BIBLIOTECAS[n] && _BIBLIOTECAS[n].pronta())) return false;
    mostrarToast("Preparando o arquivo…", "info", 1800);
    garantirBibliotecas(nomes).then(acao).catch(() =>
        mostrarToast("Não consegui carregar a biblioteca de exportação. Confira a internet e tente de novo.", "erro", 7000));
    return true;
}

// ========== ALERTAS IGNORADOS ==========
function alertasIgnorados() {
    try { return JSON.parse(localStorage.getItem("alertasIgnorados") || "{}"); }
    catch(_) { return {}; }
}

function ignorarAlerta(chave) {
    const ig = alertasIgnorados();
    ig[chave] = true;
    localStorage.setItem("alertasIgnorados", JSON.stringify(ig));
}

// ========== LINKS DIRETOS PARA LANÇAMENTOS ==========
// irParaLancamento: função canônica definida em ui.js.
// (removida daqui para evitar conflito de versões: a última declaração no HTML vencia)

// ========== TOAST (referência; implementação em navegacao.js) ==========
// A função mostrarToast está em navegacao.js para evitar duplicação.

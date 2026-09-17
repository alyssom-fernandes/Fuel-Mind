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
 * em um atributo `onclick="fn('...')"` — o caso mais comum no projeto.
 *
 * Duas camadas são necessárias: primeiro escapar barra invertida e aspas
 * simples (para não fechar a string JS antes da hora), depois aplicar
 * escapeHtml (para não fechar o próprio atributo HTML, delimitado por
 * aspas duplas). Fazer só a primeira camada — como `str.replace(/'/g,"\\'")`,
 * padrão usado em vários pontos do projeto — não impede que um valor com `"`
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
 * Vive em utils.js — carregado antes de todos os módulos — para que
 * Dashboard, Analítico, Relatórios, Histórico e a busca global nunca
 * divirjam no total de litros de um mesmo período.
 *
 * ATENÇÃO: use apenas para AGREGAR volume. Preço unitário (R$/L) continua
 * baseado na carga da nota (`item.qtd`), que é a quantidade efetivamente
 * faturada — dividir o valor pela quantidade descarregada inflaria o preço.
 */
function _litrosItem(i) {
    return (i.qtdDescargada > 0 ? i.qtdDescargada : i.qtd) || 0;
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
 * frete, KPIs, referência de preço e exportações — a diferença está na
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
   lidas): o número principal das telas é o **preço médio de compra** —
   valor pago dividido pelos litros FATURADOS na nota. É o preço que o
   fornecedor cobrou, e é completo: entra toda nota.

   O custo por litro RECEBIDO (com a perda de trânsito embutida) é outra
   pergunta, e só existe onde alguém mediu a descarga. Ele vem ao lado,
   dizendo em quantos itens se apoia — na base de demonstração isso é um
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
         + `${fmtR4(m.custoRecebido)}/L recebido contra ${fmtR4(m.precoCompraMedido)}/L faturado`;
}

// ========== AS DUAS DATAS DE UM LANÇAMENTO ==========
/**
 * Uma nota tem duas datas, e cada uma responde a uma pergunta diferente.
 * Rodada 11, decisão do dono (16/09/2026): não dá para pôr uma só como base
 * de tudo — depende do contexto.
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
 * nenhuma — o custo médio de agosto com os reais da emissão e os litros da
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
 * comparava sempre com o mês anterior a HOJE — com agosto escolhido em
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
 * A taxa é atributo da empresa contratante — não do combustível
 * transportado. Valor ausente, inválido ou negativo vira 0, para que o
 * cálculo de frete nunca produza NaN nem valor negativo.
 *
 * `_taxaFreteDaEmpresa(empresa)` devolve a taxa DE HOJE. Para calcular
 * frete de um mês passado use `_taxaFreteDaEmpresaNaData(empresa, iso)`:
 * até 17/09/2026 a taxa era um valor único, e mudá-la reescrevia em
 * silêncio todos os meses já pagos — nada de frete é gravado, a tela
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
    // aproximação do que se cobrava então — e é o que o sistema mostrava
    // antes de existir histórico.
    const maisAntiga = [...hist].sort((a, b) => String(a.vigenciaDe || "").localeCompare(String(b.vigenciaDe || "")))[0];
    const t = Number(maisAntiga && maisAntiga.taxa);
    return isFinite(t) && t > 0 ? t : _taxaFreteDaEmpresa(empresa);
}

function _taxaFreteDaEmpresa(empresa) {
    const taxa = parseFloat(empresa?.taxaFrete);
    return isNaN(taxa) || taxa < 0 ? 0 : taxa;
}

// ========== CORES PARA GRÁFICOS (CHART.JS) ==========
function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        text: isDark ? '#e2e8f0' : '#1e293b',
        grid: isDark ? '#334155' : '#cbd5e1',
        primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#a02828',
        success: '#10b981',
        warning: '#f59e0b',
        info: '#3b82f6',
        background: isDark ? '#18181b' : '#ffffff'
    };
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

function fmtR4(v) {
    return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits:4, maximumFractionDigits:4 });
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
 * Quando só há pontos, decide por heurística de tamanho — a mesma que a
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
        // Tira espaço, espaço inquebrável e espaço fino — que aparecem como
        // separador de milhar. **Não** tira tabulação nem quebra de linha:
        // essas são separador de CÉLULA. Enquanto `\s` levava as duas
        // embora, colar duas células do Excel ("60000" + tab + "5,234")
        // virava "600005,234", passava no teste de número válido logo
        // abaixo e era escrito no campo já formatado como 600.005,234 —
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
 * fixas. Sem unidade e sem cifrão — eles ficam no rótulo, nunca dentro
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
/* Uma célula de CSV exportado. Aspas internas são dobradas — antes um nome
   com aspas deslocava as colunas seguintes — e texto que começa com = + - @
   ganha um apóstrofo na frente, para o Excel não o executar como fórmula
   (um cadastro "=HYPERLINK(...)" virava link que vazava dado ao abrir o
   arquivo). Número continua número. */
function _celulaCSV(cell) {
    if (typeof cell === "number") return String(cell);
    let t = String(cell ?? "");
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
}

// ========== LOGO DO PDF POR EMPRESA ==========
/* A logo é guardada pelo id da empresa. Era pelo nome, e um rename fazia o
   PDF sair sem logo, com a imagem antiga ocupando espaço sem jeito de
   remover. Logos antigas, pelo nome, continuam sendo lidas. */
function _chaveLogoEmpresa(nome) {
    return (typeof db !== "undefined" && (db.empresas || []).find(e => e.nome === nome)?.id) || nome;
}

function logoDaEmpresa(nome) {
    const logos = (typeof db !== "undefined" && db.configRelatorio && db.configRelatorio.logos) || {};
    return logos[_chaveLogoEmpresa(nome)] || logos[nome] || null;
}

// ========== CONFIGURAÇÕES DE ALERTAS (compartilhado) ==========
/* A configuração é do sistema, igual para todos: vive em `db.configAlertas`,
   que vai para o documento compartilhado junto dos cadastros. Até 16/09/2026
   ela ficava no `localStorage` de cada navegador — duas pessoas olhando o
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
     limite, comparada em quatro casas — a precisão do preço — para que
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
// irParaLancamento — função canônica definida em ui.js.
// (removida daqui para evitar conflito de versões — a última declaração no HTML vencia)

// ========== TOAST (referência; implementação em app.js) ==========
// A função mostrarToast está em app.js para evitar duplicação.

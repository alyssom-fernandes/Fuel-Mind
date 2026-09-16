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
 */
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

// ========== CONFIGURAÇÕES DE ALERTAS (compartilhado) ==========
const ALERTAS_CONFIG_PADRAO = {
    precoAtivo:       true,
    precoDiferencaR$: 0.10,
    precoPeriodoDias: 30,
    volumeAtivo:      true,
    volumeAcimaPerc:  50,
    volumeAbaixoPerc: 50,
    dataAtivo:        true,
    dataTolerDias:    0,
    dataMaxDescNota:  30,
};

function configAlertas() {
    try {
        const salvo = JSON.parse(localStorage.getItem("configAlertas") || "{}");
        return Object.assign({}, ALERTAS_CONFIG_PADRAO, salvo);
    } catch(_) { return { ...ALERTAS_CONFIG_PADRAO }; }
}

function salvarConfigAlertas(cfg) {
    localStorage.setItem("configAlertas", JSON.stringify(cfg));
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

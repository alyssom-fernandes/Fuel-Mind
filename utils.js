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

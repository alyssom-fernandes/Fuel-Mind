/*=================================================
  ESTOQUE — v3.4
  Novidades v3.2:
    • Fechamento de mês (read-only + reabertura com log)
    • Ajuste de evaporação por dia (0.0%–0.6%)
    • Preenchimento de evaporação em intervalo
    • Debounce no save para evitar writes excessivos no Firestore
    • Alerta visual de capacidade de tanque ultrapassada (linha laranja)
  Novidades v3.3:
    • Log de auditoria por célula: saída, Veeder-Root e evapPct
      registram {campo, valorAnterior, valorNovo, usuario, ts} em _logs
    • Aba "Auditoria" na tela do estoque — tabela filtrável por data e campo
  Novidades v3.4:
    • FIX: filtros de data não são mais resetados pelo listener do Firestore.
      renderAbasEstoque() preserva valores já digitados no DOM.
    • Banner de capacidade dos tanques no topo de cada aba de combustível,
      mostrando capacidade total e detalhamento por tanque.
=================================================*/
let estoqueFiltros = { dataInicio:'', dataFim:'', empresa:'', combustivel:'Todos' };
let diasGerados = [];
let estoqueAbaAtiva = '';
const ESTOQUE_ITENS_POR_PAGINA = 50;
let estoquesPagina = 1;

// Controla sub-aba ativa: 'tabela' | 'auditoria'
let estoqueSubAbaAtiva = 'tabela';

// Debounce: evita salvar no Firestore a cada keystroke
let _estoqueSaveTimer = null;
/**
 * Versão debounced de `salvarDB` para o estoque.
 * Agrupa keystokes consecutivos em um único save após 800ms de inatividade,
 * evitando writes excessivos ao Firestore durante edição da tabela.
 */
function estoqueSalvarDB() {
    clearTimeout(_estoqueSaveTimer);
    _estoqueSaveTimer = setTimeout(() => salvarDB(), 800);
}

/* ─── HELPERS DE FECHAMENTO ─────────────────────── */
function _fechadosKey(empresa, comb) {
    if (!db.estoqueEmpresas) db.estoqueEmpresas = {};
    if (!db.estoqueEmpresas[empresa]) db.estoqueEmpresas[empresa] = {};
    if (!db.estoqueEmpresas[empresa][comb]) db.estoqueEmpresas[empresa][comb] = {};
    const obj = db.estoqueEmpresas[empresa][comb];
    if (!obj._fechados) obj._fechados = [];
    return obj._fechados;
}

/**
 * Verifica se um mês está fechado para edição.
 * @param {string} empresa - Nome da empresa
 * @param {string} comb    - Nome do combustível
 * @param {string} mes     - Mês no formato `"YYYY-MM"`
 * @returns {boolean}
 */
function mesFechado(empresa, comb, mes) {
    return _fechadosKey(empresa, comb).includes(mes);
}

/**
 * Fecha um mês para edição, impedindo alterações retroativas.
 * Rejeita meses futuros. Registra log de auditoria.
 * @param {string} empresa - Nome da empresa
 * @param {string} comb    - Nome do combustível
 * @param {string} mes     - Mês no formato `"YYYY-MM"`
 */
function fecharMes(empresa, comb, mes) {
    const mesAtual = new Date().toISOString().slice(0, 7);
    if (mes > mesAtual) {
        mostrarToast(`Não é possível fechar o mês ${mes} — ele ainda está no futuro.`, 'aviso'); return;
    }
    const lista = _fechadosKey(empresa, comb);
    if (lista.includes(mes)) return;
    lista.push(mes);
    _estoqueRegistrarLog(empresa, comb, null, { acao: 'fechamento', mes });
    salvarDB();
    renderConteudoAbaEstoque();
    mostrarToast(`Mês ${mes} fechado com sucesso.`, 'sucesso');
}

async function reabrirMes(empresa, comb, mes) {
    if (!await fmConfirm({ titulo: `Reabrir mês ${mes}?`, msg: "Esta ação ficará registrada no log de auditoria.", confirmTxt: "Reabrir", tipo: "aviso" })) return;
    const lista = _fechadosKey(empresa, comb);
    const idx = lista.indexOf(mes);
    if (idx !== -1) lista.splice(idx, 1);
    _estoqueRegistrarLog(empresa, comb, null, { acao: 'reabertura', mes });
    salvarDB();
    renderConteudoAbaEstoque();
    mostrarToast(`Mês ${mes} reaberto para edição.`, 'aviso');
}

/* ─── LOG DE AUDITORIA ──────────────────────────── */
/**
 * Registra uma entrada no log de auditoria do estoque.
 *
 * Função canônica para todos os logs de estoque — nunca fazer `push`
 * direto em `_logs`. Garante que a estrutura de `db.estoqueEmpresas`
 * exista antes de inserir.
 *
 * @param {string} empresa - Nome da empresa
 * @param {string} comb    - Nome do combustível
 * @param {string|null} data - Data no formato `"YYYY-MM-DD"`, ou `null`
 *   para logs de fechamento/reabertura de mês
 * @param {Object} extra   - Campos adicionais do log:
 *   - Para alterações de célula: `{ campo, valorAnterior, valorNovo }`
 *   - Para fechamento/reabertura: `{ acao: 'fechamento'|'reabertura', mes }`
 */
function _estoqueRegistrarLog(empresa, comb, data, extra) {
    if (!db.estoqueEmpresas) db.estoqueEmpresas = {};
    if (!db.estoqueEmpresas[empresa]) db.estoqueEmpresas[empresa] = {};
    if (!db.estoqueEmpresas[empresa][comb]) db.estoqueEmpresas[empresa][comb] = {};
    if (!db.estoqueEmpresas[empresa][comb]._logs) db.estoqueEmpresas[empresa][comb]._logs = [];
    const entrada = {
        ts: new Date().toISOString(),
        usuario: window._usuarioAtual?.nome || '—',
        ...extra
    };
    if (data) entrada.data = data;
    db.estoqueEmpresas[empresa][comb]._logs.push(entrada);
}

function verLogFechamentos(empresa, comb) {
    const logs = db.estoqueEmpresas?.[empresa]?.[comb]?._logs || [];
    if (!logs.length) { mostrarToast('Nenhum log registrado.', 'info'); return; }
    const linhas = logs.slice().reverse().map(l => {
        const ts    = new Date(l.ts).toLocaleString('pt-BR');
        let descr   = '';
        if (l.acao === 'fechamento') descr = `Fechamento — mês ${l.mes}`;
        else if (l.acao === 'reabertura') descr = `Reabertura — mês ${l.mes}`;
        else {
            const campo = l.campo === 'saida' ? 'Saída' : l.campo === 'veeder' ? 'Veeder-Root' : l.campo === 'evapLitros' ? 'Evap L' : 'Evap %';
            descr = `${campo} em ${l.data ? formatarData(l.data) : '—'}: ${_fmtLogVal(l.valorAnterior)} → ${_fmtLogVal(l.valorNovo)}`;
        }
        return `<tr>
            <td style="padding:8px 12px">${ts}</td>
            <td style="padding:8px 12px">${l.usuario}</td>
            <td style="padding:8px 12px">${descr}</td>
        </tr>`;
    }).join('');

    _fecharModalEstoque('_modalLogFechamentos');
    const div = document.createElement('div');
    div.id = '_modalLogFechamentos';
    div.className = 'modal-overlay';
    div.style.display = 'flex';
    div.innerHTML = `
        <div class="modal" style="max-width:720px;width:100%;">
            <h3>Log de Auditoria — ${comb} / ${empresa}</h3>
            <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.85rem">
                <thead><tr style="background:var(--thead-bg);color:var(--thead-color)">
                    <th style="padding:8px 12px;text-align:left">Data/Hora</th>
                    <th style="padding:8px 12px;text-align:left">Usuário</th>
                    <th style="padding:8px 12px;text-align:left">Descrição</th>
                </tr></thead>
                <tbody>${linhas}</tbody>
            </table></div>
            <div class="modal-acoes">
                <button class="btn-secundario" onclick="_fecharModalEstoque('_modalLogFechamentos')">Fechar</button>
            </div>
        </div>`;
    document.body.appendChild(div);
    div.addEventListener('click', e => { if (e.target === div) _fecharModalEstoque('_modalLogFechamentos'); });
    document.addEventListener('keydown', function _escLog(e) {
        if (e.key === 'Escape') { _fecharModalEstoque('_modalLogFechamentos'); document.removeEventListener('keydown', _escLog); }
    });
}

function _fmtLogVal(v) {
    if (v === null || v === undefined) return '—';
    const n = parseFloat(v);
    return isNaN(n) ? String(v) : n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/* ─── HELPERS DE EVAPORAÇÃO ─────────────────────── */
function getEvapDia(empresa, comb, data) {
    const med = db.estoqueEmpresas?.[empresa]?.[comb]?.[data];
    if (!med) return null;
    // Retorna objeto { pct, litros } — um ou ambos podem ser null
    const pct    = (med.evapPct    !== undefined && med.evapPct    !== null) ? med.evapPct    : null;
    const litros = (med.evapLitros !== undefined && med.evapLitros !== null) ? med.evapLitros : null;
    if (pct === null && litros === null) return null;
    return { pct, litros };
}

// Retorna só o pct para compatibilidade com calcularEstoqueAteData
function _getEvapPct(empresa, comb, data, perdaPctPadrao) {
    const ev = getEvapDia(empresa, comb, data);
    if (ev === null) return perdaPctPadrao;
    if (ev.litros !== null) return null; // sinaliza: usar litros direto
    return ev.pct !== null ? ev.pct : perdaPctPadrao;
}

/**
 * Salva o valor de evaporação de um dia específico no estoque.
 *
 * @param {string} empresa - Nome da empresa
 * @param {string} comb    - Nome do combustível
 * @param {string} data    - Data no formato `"YYYY-MM-DD"`
 * @param {number|null} valor - Valor da evaporação, ou `null` para limpar
 * @param {'pct'|'litros'|null} modo
 *   - `'pct'`: salva como percentual em `evapPct`, remove `evapLitros`
 *   - `'litros'`: salva como volume direto em `evapLitros`, remove `evapPct`
 *   - `null`: limpa ambos os campos
 */
function salvarEvapDia(empresa, comb, data, valor, modo) {
    // modo: 'pct' (percentual) | 'litros' (volume direto) | null (limpar tudo)
    if (!db.estoqueEmpresas) db.estoqueEmpresas = {};
    if (!db.estoqueEmpresas[empresa]) db.estoqueEmpresas[empresa] = {};
    if (!db.estoqueEmpresas[empresa][comb]) db.estoqueEmpresas[empresa][comb] = {};
    if (!db.estoqueEmpresas[empresa][comb][data]) db.estoqueEmpresas[empresa][comb][data] = {};
    const reg = db.estoqueEmpresas[empresa][comb][data];

    if (valor === null || valor === '') {
        // Limpar ambos
        const antPct    = reg.evapPct    ?? null;
        const antLitros = reg.evapLitros ?? null;
        delete reg.evapPct;
        delete reg.evapLitros;
        if (antPct    !== null) _estoqueRegistrarLog(empresa, comb, data, { campo: 'evapPct',    valorAnterior: antPct,    valorNovo: null });
        if (antLitros !== null) _estoqueRegistrarLog(empresa, comb, data, { campo: 'evapLitros', valorAnterior: antLitros, valorNovo: null });
    } else if (modo === 'litros') {
        const antLitros = reg.evapLitros ?? null;
        const novoLitros = parseFloat(valor);
        reg.evapLitros = novoLitros;
        delete reg.evapPct; // litros tem precedência — remove % se havia
        if (antLitros !== novoLitros) _estoqueRegistrarLog(empresa, comb, data, { campo: 'evapLitros', valorAnterior: antLitros, valorNovo: novoLitros });
    } else {
        // modo 'pct' (padrão)
        const antPct = reg.evapPct ?? null;
        const novoPct = parseFloat(valor);
        reg.evapPct = novoPct;
        delete reg.evapLitros; // % substitui litros
        if (antPct !== novoPct) _estoqueRegistrarLog(empresa, comb, data, { campo: 'evapPct', valorAnterior: antPct, valorNovo: novoPct });
    }
    estoqueSalvarDB();
    renderTabelaEstoque();
}

function _fecharModalEstoque(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function abrirPreencherEvapIntervalo() {
    const empresa = estoqueFiltros.empresa;
    const comb = estoqueAbaAtiva;
    if (!empresa || !comb) { mostrarToast('Selecione empresa e combustível.', 'aviso'); return; }

    _fecharModalEstoque('_modalEvapIntervalo');
    const div = document.createElement('div');
    div.id = '_modalEvapIntervalo';
    div.className = 'modal-overlay';
    div.style.display = 'flex';
    div.innerHTML = `
        <div class="modal" style="max-width:420px;">
            <h3>Preencher Evaporação em Intervalo</h3>
            <p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:18px">${comb} — ${empresa}</p>
            <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
                <div class="campo"><label>Data Inicial</label><input type="date" id="_evapIntDe" value="${estoqueFiltros.dataInicio}"></div>
                <div class="campo"><label>Data Final</label><input type="date" id="_evapIntAte" value="${estoqueFiltros.dataFim}"></div>
                <div class="campo" style="grid-column:span 2"><label>% Evaporação (0.0 a 0.6)</label>
                    <input type="number" id="_evapIntPct" min="0" max="0.6" step="0.01" placeholder="Ex: 0.3" value="0.3">
                </div>
            </div>
            <p class="dica" style="margin-bottom:16px">
                Preenche apenas dias que já existem no período atual do estoque.
                Dias de meses fechados serão ignorados.
            </p>
            <div class="modal-acoes">
                <button class="btn-primario" data-empresa="${empresa}" data-comb="${comb}" onclick="_confirmarEvapIntervalo(this.dataset.empresa,this.dataset.comb)">Aplicar</button>
                <button class="btn-cancelar" onclick="_fecharModalEstoque('_modalEvapIntervalo')">Cancelar</button>
            </div>
        </div>`;
    document.body.appendChild(div);
    div.addEventListener('click', e => { if (e.target === div) _fecharModalEstoque('_modalEvapIntervalo'); });
    document.addEventListener('keydown', function _escEvap(e) {
        if (e.key === 'Escape') { _fecharModalEstoque('_modalEvapIntervalo'); document.removeEventListener('keydown', _escEvap); }
    });
}

function _confirmarEvapIntervalo(empresa, comb) {
    const de  = document.getElementById('_evapIntDe')?.value;
    const ate = document.getElementById('_evapIntAte')?.value;
    const pct = document.getElementById('_evapIntPct')?.value;
    if (!de || !ate || pct === '') { mostrarToast('Preencha todos os campos.', 'aviso'); return; }
    if (de > ate) { mostrarToast('Data inicial maior que final.', 'aviso'); return; }
    const pctNum = parseFloat(pct);
    if (pctNum < 0 || pctNum > 0.6) { mostrarToast('% deve ser entre 0.0 e 0.6.', 'aviso'); return; }

    let aplicados = 0;
    diasGerados.forEach(data => {
        if (data < de || data > ate) return;
        const mes = data.slice(0,7);
        if (mesFechado(empresa, comb, mes)) return;
        if (!db.estoqueEmpresas) db.estoqueEmpresas = {};
        if (!db.estoqueEmpresas[empresa]) db.estoqueEmpresas[empresa] = {};
        if (!db.estoqueEmpresas[empresa][comb]) db.estoqueEmpresas[empresa][comb] = {};
        if (!db.estoqueEmpresas[empresa][comb][data]) db.estoqueEmpresas[empresa][comb][data] = {};
        const anterior = db.estoqueEmpresas[empresa][comb][data].evapPct ?? null;
        db.estoqueEmpresas[empresa][comb][data].evapPct = pctNum;
        delete db.estoqueEmpresas[empresa][comb][data].evapLitros; // % substitui litros
        if (anterior !== pctNum) {
            _estoqueRegistrarLog(empresa, comb, data, { campo: 'evapPct', valorAnterior: anterior, valorNovo: pctNum });
        }
        aplicados++;
    });

    if (aplicados === 0) { mostrarToast('Nenhum dia no intervalo para aplicar (verifique meses fechados).', 'aviso'); return; }
    salvarDB();
    _fecharModalEstoque('_modalEvapIntervalo');
    renderTabelaEstoque();
    mostrarToast(`Evaporação ${pct}% aplicada em ${aplicados} dia(s).`, 'sucesso');
}

/* ─── MIGRAÇÃO ──────────────────────────────────── */
async function migrarEstoqueAntigo() {
    if (db._estoqueV2Migrado) return;
    if (db.medicoes && Object.keys(db.medicoes).length > 0) {
        if (!db.estoqueEmpresas) db.estoqueEmpresas = {};
        const primeiraEmpresa = db.empresas.filter(e=>e.ativo!==false)[0]?.nome || '';
        if (primeiraEmpresa) {
            Object.entries(db.medicoes).forEach(([data, combs]) => {
                if (typeof combs !== 'object') return;
                Object.entries(combs).forEach(([comb, med]) => {
                    if (!db.estoqueEmpresas[primeiraEmpresa]) db.estoqueEmpresas[primeiraEmpresa]={};
                    if (!db.estoqueEmpresas[primeiraEmpresa][comb]) db.estoqueEmpresas[primeiraEmpresa][comb]={};
                    if (!db.estoqueEmpresas[primeiraEmpresa][comb][data])
                        db.estoqueEmpresas[primeiraEmpresa][comb][data] = { ...med };
                });
            });
        }
    }
    db._estoqueV2Migrado = true;
    salvarDB();
}

/* ─── CARREGAR / RENDER ABAS ────────────────────── */
async function carregarEstoque() {
    if (!db.estoqueEmpresas) db.estoqueEmpresas = {};
    if (!db.estoqueInicial)  db.estoqueInicial  = {};
    await migrarEstoqueAntigo();

    // Só inicializa filtros se ainda não tiverem sido definidos
    if (!estoqueFiltros.dataInicio || !estoqueFiltros.dataFim) {
        const hoje = new Date().toISOString().slice(0,10);
        const t = new Date(); t.setDate(t.getDate()-30);
        estoqueFiltros.dataInicio = t.toISOString().slice(0,10);
        estoqueFiltros.dataFim    = hoje;
    }
    estoqueFiltros.empresa = empresaFiltroGlobal || '';
    renderAbasEstoque();
}

function renderAbasEstoque() {
    const combustiveis = db.combustiveis.filter(c=>c.ativo!==false);
    const containerAbas    = document.getElementById('estoqueAbas');
    const containerFiltros = document.getElementById('estoqueFiltrosContainer');
    if (!containerAbas) return;

    if (combustiveis.length===0) {
        containerAbas.innerHTML='<p class="dica">Nenhum combustível cadastrado. Cadastre em <strong>Cadastros → Combustíveis</strong>.</p>';
        return;
    }

    const nomes = combustiveis.map(c=>c.nome);
    if (!estoqueAbaAtiva || !nomes.includes(estoqueAbaAtiva)) estoqueAbaAtiva = nomes[0];

    containerAbas.innerHTML = combustiveis.map(c=>`
        <button class="aba-btn ${c.nome===estoqueAbaAtiva?'ativa':''}" onclick="trocarAbaEstoque('${c.nome}',this)">${c.nome}</button>
    `).join('');

    // FIX v3.4: só renderiza os filtros se ainda não existirem no DOM.
    // Isso evita que o listener do Firestore (que chama renderAbasEstoque)
    // sobrescreva as datas que o usuário já digitou.
    if (containerFiltros && !document.getElementById('estoqueDataInicio')) {
        if (empresaFiltroGlobal) estoqueFiltros.empresa = empresaFiltroGlobal;

        const campoEmpresa = `<div class="campo"><label>Empresa</label>
                 <div style="padding:6px 10px;background:rgba(139,34,82,0.1);border:1px solid var(--primary);
                             border-radius:var(--radius-sm);color:var(--primary);font-size:0.85rem;font-weight:600;">
                     ${empresaFiltroGlobal || '—'}
                 </div>
                 <input type="hidden" id="estoqueFiltroEmpresa" value="${empresaFiltroGlobal || ''}">
               </div>`;

        containerFiltros.innerHTML = `
            <div class="filtros" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));">
                <div class="campo"><label>Data Inicial</label>
                    <input type="date" id="estoqueDataInicio" value="${estoqueFiltros.dataInicio}" onchange="aplicarFiltrosEstoque()"></div>
                <div class="campo"><label>Data Final</label>
                    <input type="date" id="estoqueDataFim" value="${estoqueFiltros.dataFim}" onchange="aplicarFiltrosEstoque()"></div>
                ${campoEmpresa}
                <div class="campo" style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;">
                    <button class="btn-primario" onclick="aplicarFiltrosEstoque()">Filtrar</button>
                    <button class="btn-secundario" onclick="estoqueAdicionarDia()">+ Dia</button>
                    <button class="btn-secundario" onclick="abrirPreencherEvapIntervalo()" title="Preencher % evaporação em intervalo de datas">Evap. Intervalo</button>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
                <input type="date" id="estoqueBuscaData"
                    style="padding:5px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-alt);color:var(--text);font-size:0.82rem;"
                    title="Ir para data"
                    onchange="estoquePularParaData(this.value)">
                <span style="font-size:0.75rem;color:var(--text-muted);">Ir para data</span>
            </div>`;
    }

    renderConteudoAbaEstoque();
}

function trocarAbaEstoque(nomeCombustivel, btn) {
    estoqueAbaAtiva=nomeCombustivel; estoquesPagina=1;
    document.querySelectorAll('#estoqueAbas .aba-btn').forEach(b=>b.classList.remove('ativa'));
    if (btn) btn.classList.add('ativa');
    renderConteudoAbaEstoque();
}

function renderConteudoAbaEstoque() {
    // Lê sempre os valores atuais do DOM (respeitando o que o usuário digitou)
    const iI=document.getElementById('estoqueDataInicio');
    const iF=document.getElementById('estoqueDataFim');
    const sE=document.getElementById('estoqueFiltroEmpresa');
    if(iI) estoqueFiltros.dataInicio=iI.value;
    if(iF) estoqueFiltros.dataFim=iF.value;
    if(sE) estoqueFiltros.empresa=sE.value;
    estoqueFiltros.combustivel=estoqueAbaAtiva;
    gerarDiasNoPeriodo();

    if (estoqueSubAbaAtiva === 'auditoria') {
        renderAbaAuditoria();
    } else {
        renderTabelaEstoque();
        // renderGraficoEstoque é chamado dentro de renderTabelaEstoque via requestAnimationFrame
    }
}

function aplicarFiltrosEstoque() { estoquesPagina=1; renderConteudoAbaEstoque(); }

function estoquePularParaData(data) {
    if (!data || !diasGerados.includes(data)) {
        mostrarToast('Data não encontrada no período atual.', 'aviso', 3000);
        return;
    }
    // Descobre em qual página está o dia (diasGerados está em ordem crescente, tabela exibe decrescente)
    const totalDias = diasGerados.length;
    const idxCrescente = diasGerados.indexOf(data);
    const idxDecrescente = totalDias - 1 - idxCrescente; // posição na ordem reversa
    const pagina = Math.floor(idxDecrescente / ESTOQUE_ITENS_POR_PAGINA) + 1;
    estoquesPagina = pagina;
    renderTabelaEstoque();
    // Após render, tenta fazer scroll até a linha
    setTimeout(() => {
        const linhas = document.querySelectorAll('#tabelaEstoque tbody tr');
        for (const tr of linhas) {
            const td = tr.querySelector('td:first-child strong');
            if (td && td.textContent.trim() === formatarData(data)) {
                tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                tr.style.outline = '2px solid var(--primary)';
                setTimeout(() => { tr.style.outline = ''; }, 2000);
                break;
            }
        }
    }, 100);
}

function gerarDiasNoPeriodo() {
    const _dataValida = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s+'T00:00:00'));
    if (!_dataValida(estoqueFiltros.dataInicio) || !_dataValida(estoqueFiltros.dataFim)) {
        const t=new Date(); t.setDate(t.getDate()-30);
        estoqueFiltros.dataInicio=t.toISOString().slice(0,10);
        estoqueFiltros.dataFim=new Date().toISOString().slice(0,10);
    }
    const inicio=new Date(estoqueFiltros.dataInicio+'T00:00:00');
    const fim=new Date(estoqueFiltros.dataFim+'T00:00:00');
    if (inicio>fim) { diasGerados=[]; return; }
    const diffDias=Math.round((fim-inicio)/(1000*60*60*24));
    if (diffDias>366) { diasGerados=[]; mostrarToast('Intervalo máximo: 366 dias.','aviso'); return; }
    const cur=new Date(inicio); const dias=[];
    while(cur<=fim){ dias.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }
    diasGerados=dias;
}

/* ─── BANNER DE CAPACIDADE DOS TANQUES ──────────── */
/**
 * Resolve o combustível ativo em um compartimento numa data,
 * sem depender de tanques.js estar carregado.
 */
function _combDoCompNaData(comp, ref) {
    if (!comp.historicoCombustivel || comp.historicoCombustivel.length === 0) return null;
    // Se ref estiver vazio/inválido, usa hoje
    const dataRef = (ref && ref.length === 10) ? ref : new Date().toISOString().slice(0,10);
    const entradas = comp.historicoCombustivel
        .filter(h => h.data && h.data <= dataRef)
        .sort((a, b) => b.data.localeCompare(a.data));
    return entradas[0]?.combustivel || null;
}

/**
 * Gera o HTML do banner de capacidade para o combustível ativo.
 * Lógica auto-contida — não depende de funções de tanques.js.
 */
function _renderBannerCapacidade(comb) {
    if (!comb) return '';
    if (!db.tanques || db.tanques.length === 0) return '';

    // Garante ref válido mesmo se filtros ainda não foram populados
    const ref = (estoqueFiltros.dataFim && estoqueFiltros.dataFim.length === 10)
        ? estoqueFiltros.dataFim
        : new Date().toISOString().slice(0,10);
    const tanquesAtivos = db.tanques.filter(t => t.ativo !== false);

    const detalhes = [];
    let totalCap = 0;

    tanquesAtivos.forEach(tanque => {
        if (!tanque.compartimentos) return;
        let capCompartimentos = 0;
        let temComb = false;

        tanque.compartimentos.forEach(comp => {
            const c = _combDoCompNaData(comp, ref);
            if (c === comb) {
                capCompartimentos += (comp.capacidade || 0);
                temComb = true;
            }
        });

        if (temComb) {
            const filtro = tanque.capacidadeFiltro || 0;
            const capTotal = capCompartimentos + filtro;
            totalCap += capTotal;
            detalhes.push({ nome: tanque.nome, cap: capTotal, filtro });
        }
    });

    if (totalCap === 0) return '';

    const detalheHTML = detalhes.map(d =>
        `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface-alt);
                      border:1px solid var(--border-light);border-radius:20px;
                      padding:2px 10px;font-size:0.75rem;color:var(--text-muted);">
            ${d.nome}: <strong>${fmtL(d.cap)}</strong>
            ${d.filtro > 0 ? `<em style="font-size:0.7rem;opacity:.7;">(incl. ${fmtL(d.filtro)} filtro)</em>` : ''}
        </span>`
    ).join('');

    return `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;
                    padding:9px 14px;margin-bottom:10px;
                    background:var(--surface);border:1px solid var(--border-light);
                    border-radius:var(--radius);">
            <span style="font-size:0.72rem;font-weight:700;text-transform:uppercase;
                         letter-spacing:.08em;color:var(--text-muted);white-space:nowrap;">
                Capacidade total
            </span>
            <strong style="font-size:0.95rem;color:var(--primary);white-space:nowrap;">
                ${fmtL(totalCap)}
            </strong>
            <span style="color:var(--border);font-size:0.8rem;">·</span>
            ${detalheHTML}
        </div>`;
}

/* ─── SUB-ABAS: TABELA / AUDITORIA ──────────────── */
function _renderSubAbas() {
    let bar = document.getElementById('_estoqueSubAbas');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = '_estoqueSubAbas';
        bar.className = 'analitico-abas';
        bar.style.marginBottom = '12px';
        const conteudo = document.getElementById('estoqueConteudoAba');
        if (conteudo) conteudo.before(bar);
    }
    bar.innerHTML = `
        <button class="aba-btn ${estoqueSubAbaAtiva==='tabela'?'ativa':''}"
            onclick="estoqueIrSubAba('tabela')">Estoque</button>
        <button class="aba-btn ${estoqueSubAbaAtiva==='auditoria'?'ativa':''}"
            onclick="estoqueIrSubAba('auditoria')">Auditoria</button>
    `;
}

function estoqueIrSubAba(aba) {
    estoqueSubAbaAtiva = aba;
    renderConteudoAbaEstoque();
}

/* ─── ABA AUDITORIA ─────────────────────────────── */
function renderAbaAuditoria() {
    const container = document.getElementById('estoqueConteudoAba');
    if (!container) return;
    _renderSubAbas();

    const empresa = estoqueFiltros.empresa;
    const comb    = estoqueAbaAtiva;

    if (!empresa || !comb) {
        container.innerHTML = '<p class="dica">Selecione empresa e combustível para ver a auditoria.</p>';
        return;
    }

    const todos = (db.estoqueEmpresas?.[empresa]?.[comb]?._logs || []).slice().reverse();

    const filtAuditDataDe  = document.getElementById('_auditDataDe')?.value  || '';
    const filtAuditDataAte = document.getElementById('_auditDataAte')?.value  || '';
    const filtAuditCampo   = document.getElementById('_auditCampo')?.value    || '';
    const filtAuditUser    = document.getElementById('_auditUser')?.value?.trim().toLowerCase() || '';

    const logs = todos.filter(l => {
        if (filtAuditDataDe  && l.data && l.data < filtAuditDataDe)  return false;
        if (filtAuditDataAte && l.data && l.data > filtAuditDataAte) return false;
        if (filtAuditCampo) {
            if (filtAuditCampo === 'fechamento' && l.acao !== 'fechamento') return false;
            if (filtAuditCampo === 'reabertura' && l.acao !== 'reabertura') return false;
            if (!['fechamento','reabertura'].includes(filtAuditCampo) && l.campo !== filtAuditCampo) return false;
        }
        if (filtAuditUser && !(l.usuario||'').toLowerCase().includes(filtAuditUser)) return false;
        return true;
    });

    const linhasHtml = logs.length ? logs.map(l => {
        const ts = new Date(l.ts).toLocaleString('pt-BR');
        let tipo = '', dataRef = '', detalhe = '';
        if (l.acao === 'fechamento') {
            tipo    = '<span style="background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:10px;font-size:0.75rem;font-weight:700">Fechamento</span>';
            dataRef = l.mes || '—';
            detalhe = `Mês ${l.mes} fechado`;
        } else if (l.acao === 'reabertura') {
            tipo    = '<span style="background:#fef9c3;color:#713f12;padding:2px 7px;border-radius:10px;font-size:0.75rem;font-weight:700">Reabertura</span>';
            dataRef = l.mes || '—';
            detalhe = `Mês ${l.mes} reaberto`;
        } else {
            const labelCampo = l.campo === 'saida' ? 'Saída' : l.campo === 'veeder' ? 'Veeder-Root' : l.campo === 'evapPct' ? 'Evap %' : l.campo;
            tipo    = `<span style="background:#dbeafe;color:#1e40af;padding:2px 7px;border-radius:10px;font-size:0.75rem;font-weight:700">${labelCampo}</span>`;
            dataRef = l.data ? formatarData(l.data) : '—';
            const ant = _fmtLogVal(l.valorAnterior);
            const nov = _fmtLogVal(l.valorNovo);
            detalhe = `${ant} → <strong>${nov}</strong>`;
        }
        return `<tr>
            <td style="font-size:0.8rem;color:var(--text-muted)">${ts}</td>
            <td>${dataRef}</td>
            <td>${tipo}</td>
            <td>${detalhe}</td>
            <td style="font-size:0.8rem;color:var(--text-muted)">${l.usuario || '—'}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="5" class="td-vazio">Nenhum registro encontrado.</td></tr>`;

    container.innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;
                    padding:12px 14px;background:var(--surface);border:1px solid var(--border-light);border-radius:var(--radius)">
            <div class="campo" style="min-width:130px">
                <label style="font-size:0.7rem">Data de</label>
                <input type="date" id="_auditDataDe" value="${filtAuditDataDe}" onchange="renderAbaAuditoria()">
            </div>
            <div class="campo" style="min-width:130px">
                <label style="font-size:0.7rem">Data até</label>
                <input type="date" id="_auditDataAte" value="${filtAuditDataAte}" onchange="renderAbaAuditoria()">
            </div>
            <div class="campo" style="min-width:140px">
                <label style="font-size:0.7rem">Campo</label>
                <select id="_auditCampo" onchange="renderAbaAuditoria()"
                    style="padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--surface-alt);color:var(--text)">
                    <option value="">Todos</option>
                    <option value="saida"      ${filtAuditCampo==='saida'     ?'selected':''}>Saída</option>
                    <option value="veeder"     ${filtAuditCampo==='veeder'    ?'selected':''}>Veeder-Root</option>
                    <option value="evapPct"    ${filtAuditCampo==='evapPct'   ?'selected':''}>Evap %</option>
                    <option value="evapLitros" ${filtAuditCampo==='evapLitros'?'selected':''}>Evap L</option>
                    <option value="fechamento" ${filtAuditCampo==='fechamento'?'selected':''}>Fechamento</option>
                    <option value="reabertura" ${filtAuditCampo==='reabertura'?'selected':''}>Reabertura</option>
                </select>
            </div>
            <div class="campo" style="min-width:140px">
                <label style="font-size:0.7rem">Usuário</label>
                <input type="text" id="_auditUser" value="${filtAuditUser}"
                    placeholder="Filtrar por usuário"
                    style="padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--surface-alt);color:var(--text)"
                    oninput="renderAbaAuditoria()">
            </div>
            <div style="display:flex;gap:8px;align-items:flex-end;padding-bottom:1px">
                <button class="btn-secundario" onclick="_limparFiltrosAuditoria()">Limpar filtros</button>
                ${todos.length > 0 ? `<button class="btn-secundario" onclick="_exportarAuditoriaCSV()">Exportar CSV</button>` : ''}
            </div>
            <span class="dica" style="font-size:0.75rem;margin:0;align-self:flex-end">
                ${logs.length} de ${todos.length} registro(s)
            </span>
        </div>
        <div class="tabela-container">
            <table>
                <thead><tr>
                    <th>Data/Hora</th>
                    <th>Data ref.</th>
                    <th>Campo</th>
                    <th>Alteração</th>
                    <th>Usuário</th>
                </tr></thead>
                <tbody>${linhasHtml}</tbody>
            </table>
        </div>`;

    _renderSubAbas();
}

function _limparFiltrosAuditoria() {
    ['_auditDataDe','_auditDataAte','_auditCampo','_auditUser'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    renderAbaAuditoria();
}

function _exportarAuditoriaCSV() {
    const empresa = estoqueFiltros.empresa;
    const comb    = estoqueAbaAtiva;
    const logs    = db.estoqueEmpresas?.[empresa]?.[comb]?._logs || [];
    if (!logs.length) { mostrarToast('Nenhum log para exportar.', 'aviso'); return; }

    const linhas = [['Data/Hora','Data ref.','Campo','Valor Anterior','Valor Novo','Usuário']];
    logs.slice().reverse().forEach(l => {
        const ts = new Date(l.ts).toLocaleString('pt-BR');
        const campo = l.acao || l.campo || '—';
        const dataRef = l.data || l.mes || '—';
        const ant = l.acao ? '—' : _fmtLogVal(l.valorAnterior);
        const nov = l.acao ? '—' : _fmtLogVal(l.valorNovo);
        linhas.push([ts, dataRef, campo, ant, nov, l.usuario||'—']);
    });
    const csv = linhas.map(r => r.map(c => `"${c}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `auditoria-estoque-${comb}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/* ─── RENDER TABELA ─────────────────────────────── */
/**
 * Gera tooltip customizado com leitura por tanque para o ⓘ do Veeder-Root.
 * @param {string} data - data no formato YYYY-MM-DD (usada como ID único)
 * @param {Object} tanques - { "Tank 1": 27374, "Tank 2": 15200 }
 */
function _estoqueVeederTip(data, tanques) {
    if (!tanques || !Object.keys(tanques).length) return '';
    const tipId = '_estTip' + data.replace(/-/g, '');
    const linhas = Object.entries(tanques).map(([t, v]) =>
        `<div style="display:flex;justify-content:space-between;gap:14px">
            <span style="opacity:0.7">${t}</span>
            <span style="font-family:'JetBrains Mono',monospace;font-weight:600">${fmtL3(v)}</span>
        </div>`
    ).join('');
    return `<span style="position:relative;display:inline-block;vertical-align:middle">
        <span style="cursor:help;margin-left:5px;color:var(--primary);opacity:0.7;display:inline-flex;align-items:center;"
            onmouseenter="document.getElementById('${tipId}').style.display='block'"
            onmouseleave="document.getElementById('${tipId}').style.display='none'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></span>
        <div id="${tipId}" style="display:none;position:absolute;top:calc(100% + 6px);left:0;
            background:var(--surface-raised);border:1px solid var(--border);
            border-radius:8px;padding:10px 14px;font-size:0.78rem;white-space:nowrap;z-index:600;
            box-shadow:0 6px 20px rgba(0,0,0,0.3);min-width:170px;pointer-events:none">
            <div style="font-weight:700;margin-bottom:8px;font-size:0.8rem">Leitura por tanque</div>
            ${linhas}
        </div>
    </span>`;
}

function renderTabelaEstoque() {
    const container=document.getElementById('estoqueConteudoAba');
    if(!container) return;
    _renderSubAbas();

    const comb=estoqueAbaAtiva;
    if(!comb){container.innerHTML='';return;}
    const perdaPctPadrao=db.combustiveis.find(c=>c.nome===comb)?.perda??0;
    const emps=[estoqueFiltros.empresa].filter(Boolean);

    let linhas=[];
    emps.forEach(empresa=>{
        const estoqueBase=calcularEstoqueAteData(empresa,comb,estoqueFiltros.dataInicio,perdaPctPadrao);
        let prev=estoqueBase;
        diasGerados.forEach(data=>{
            const entrada=calcularEntradaDia(empresa,comb,data);
            const med=db.estoqueEmpresas?.[empresa]?.[comb]?.[data]||{};
            const saida=med.saida??0;
            const veeder=med.veeder??null;
            const veederTanques=med.veederTanques??null;
            const evapDia    = getEvapDia(empresa, comb, data);
            const evapLitros = evapDia?.litros ?? null;
            const evapPct    = evapDia?.litros !== null && evapDia?.litros !== undefined
                                ? (prev > 0 ? evapDia.litros / prev * 100 : 0)  // pct efetivo para exibição
                                : (evapDia?.pct ?? perdaPctPadrao);
            const evap       = evapLitros !== null
                                ? evapLitros
                                : (prev > 0 ? prev * (evapPct / 100) : 0);
            const evapPctDia = evapDia !== null; // flag: tem valor personalizado
            const calc       = prev + entrada - saida - evap;

            const capacidadeTotal = (typeof capacidadeTotalCombustivel === 'function')
                ? capacidadeTotalCombustivel(comb, data) : 0;
            const ultrapassaCapacidade = capacidadeTotal > 0 && calc > capacidadeTotal;

            const fechado = mesFechado(empresa, comb, data.slice(0,7));
            linhas.push({data,empresa,comb,entrada,saida,veeder,veederTanques,evap,calc,evapPct,evapPctDia,
                         evapLitrosDia: evapLitros, // null ou número — valor literal salvo
                         fechado,capacidadeTotal,ultrapassaCapacidade});
            prev=calc;
        });
    });
    linhas.sort((a,b)=>b.data.localeCompare(a.data));

    const total=linhas.length;
    const totalPag=Math.max(1,Math.ceil(total/ESTOQUE_ITENS_POR_PAGINA));
    estoquesPagina=Math.min(estoquesPagina,totalPag);
    const ini=(estoquesPagina-1)*ESTOQUE_ITENS_POR_PAGINA;
    const fatia=linhas.slice(ini,ini+ESTOQUE_ITENS_POR_PAGINA);

    const mesesVisiveis = [...new Set(fatia.map(l=>l.data.slice(0,7)))].sort();

    let pagHTML='';
    if(totalPag>1){
        let btns='';
        for(let p=1;p<=totalPag;p++){
            if(p===1||p===totalPag||Math.abs(p-estoquesPagina)<=2)
                btns+=`<button class="pag-btn ${p===estoquesPagina?'ativo':''}" onclick="estoqueIrPagina(${p})">${p}</button>`;
            else if(Math.abs(p-estoquesPagina)===3) btns+=`<span class="pag-ellipsis">…</span>`;
        }
        pagHTML=`<div class="paginacao"><div class="pag-info">Exibindo <strong>${ini+1}–${Math.min(ini+ESTOQUE_ITENS_POR_PAGINA,total)}</strong> de <strong>${total}</strong></div>
            <div class="pag-controles">
                <button class="pag-btn" onclick="estoqueIrPagina(${estoquesPagina-1})" ${estoquesPagina<=1?'disabled':''}>‹</button>
                ${btns}
                <button class="pag-btn" onclick="estoqueIrPagina(${estoquesPagina+1})" ${estoquesPagina>=totalPag?'disabled':''}>›</button>
            </div></div>`;
    }

    const empresa0 = emps[0] || '';
    const baraMeses = mesesVisiveis.length ? `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;
                    background:var(--surface);border:1px solid var(--border-light);border-radius:var(--radius);">
            <span style="font-size:0.68rem;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.09em;margin-right:4px;">Meses no período:</span>
            ${mesesVisiveis.map(mes => {
                const fechado = mesFechado(empresa0, comb, mes);
                return `<span style="display:inline-flex;align-items:center;gap:5px;background:${fechado?'var(--danger-light)':'var(--surface-alt)'};
                            border:1px solid ${fechado?'var(--danger)':'var(--border)'};
                            border-radius:20px;padding:3px 10px;font-size:0.78rem;font-weight:600;">
                    ${mes}
                    ${fechado
                        ? `<button data-empresa="${empresa0}" data-comb="${comb}" data-mes="${mes}" onclick="reabrirMes(this.dataset.empresa,this.dataset.comb,this.dataset.mes)" style="background:none;border:none;cursor:pointer;padding:0;font-size:0.72rem;color:var(--danger);font-weight:700;margin-left:2px;" title="Reabrir mês">Reabrir</button>`
                        : `<button data-empresa="${empresa0}" data-comb="${comb}" data-mes="${mes}" onclick="fecharMes(this.dataset.empresa,this.dataset.comb,this.dataset.mes)" style="background:none;border:none;cursor:pointer;padding:0;font-size:0.72rem;color:var(--text-muted);font-weight:700;margin-left:2px;" title="Fechar mês">Fechar</button>`
                    }
                </span>`;
            }).join('')}
            <button class="btn-secundario" style="font-size:0.72rem;padding:3px 10px;" data-empresa="${empresa0}" data-comb="${comb}" onclick="verLogFechamentos(this.dataset.empresa,this.dataset.comb)">Log</button>
        </div>` : '';

    const linhasHTML=fatia.map(l=>{
        const dif=l.veeder!==null?l.calc-l.veeder:null;
        const difFmt = dif !== null
            ? (dif > 0 ? '+' : '') + dif.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' L'
            : null;
        const difHtml=dif!==null
            ?`<span class="${Math.abs(dif)>50?'badge-dif-alerta':'badge-dif-ok'}" style="animation:none">${difFmt}</span>`
            :'<span class="badge-pendente" style="animation:none">Pendente</span>';

        const isReadonly = l.fechado;

        let rowStyle = '';
        let rowClass = '';
        if (l.ultrapassaCapacidade) {
            rowStyle = 'background:rgba(251,146,60,0.12) !important;outline:2px solid rgba(251,146,60,0.4);outline-offset:-2px;';
        } else if (isReadonly) {
            rowStyle = 'background:rgba(239,68,68,0.04) !important;';
        } else if (l.veeder === null) {
            rowClass = 'linha-pendente';
        }

        const lockBadge = isReadonly ? `<span title="Mês fechado" style="font-size:0.7rem;opacity:0.5;margin-left:4px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:middle"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </span>` : '';
        const excedente = l.ultrapassaCapacidade ? l.calc - l.capacidadeTotal : 0;
        const capBadge = l.ultrapassaCapacidade
            ? `<span title="Estoque calculado (${fmtL3(l.calc)} L) ultrapassa a capacidade dos tanques (${fmtL3(l.capacidadeTotal)} L)."
                     style="display:inline-flex;align-items:center;gap:3px;background:#fed7aa;color:#9a3412;
                            border:1px solid #fb923c;border-radius:4px;font-size:0.68rem;font-weight:700;
                            padding:1px 6px;margin-left:5px;cursor:default;">
                  +${fmtL3(excedente)} acima cap.
               </span>`
            : '';

        const evapPctDisplay  = l.evapPct.toFixed(2);
        const evapPctOriginal = l.evapPctDia; // boolean
        const evapModoLitros  = l.evapLitrosDia !== null;
        const evapInputStyle = `width:70px;padding:4px 6px;font-size:0.75rem;border-radius:4px;text-align:right;font-family:'JetBrains Mono',monospace;border:1px solid ${evapPctOriginal?'var(--info)':'var(--border)'};background:${evapPctOriginal?'var(--info-light)':'var(--surface-alt)'};color:var(--text);`;
        const evapLitrosDisplay = l.evapLitrosDia !== null ? l.evapLitrosDia.toFixed(3) : '';

        return `<tr class="${rowClass}" style="${rowStyle}">
            <td><strong>${formatarData(l.data)}</strong>${lockBadge}</td>
            <td>${l.entrada>0?fmtL3(l.entrada):'—'}</td>
            <td>${isReadonly
                ? `<span style="font-family:'JetBrains Mono',monospace;font-size:0.85rem">${l.saida>0?fmtL3(l.saida):'—'}</span>`
                : `<input type="number" class="input-tabela" min="0" step="0.001"
                    value="${l.saida>0?l.saida:''}" placeholder="0"
                    data-empresa="${l.empresa}" data-comb="${l.comb}" data-data="${l.data}" data-campo="saida"
                    data-anterior="${l.saida}"
                    onchange="estoqueSalvarMedicao(this)">`
            }</td>
            <td>
                ${isReadonly
                    ? `<span style="font-size:0.82rem;color:var(--text-muted)">${evapModoLitros ? fmtL3(l.evapLitrosDia)+' L' : evapPctDisplay+'%'}</span>`
                    : evapModoLitros
                        ? `<span style="display:flex;align-items:center;gap:3px">
                            <input type="number" style="width:80px;padding:4px 6px;font-size:0.75rem;border-radius:4px;text-align:right;font-family:'JetBrains Mono',monospace;border:1px solid var(--info);background:var(--info-light);color:var(--text);"
                                min="0" step="0.001"
                                value="${evapLitrosDisplay}"
                                title="Evaporação em litros"
                                data-empresa="${l.empresa}" data-comb="${l.comb}" data-data="${l.data}"
                                onchange="estoqueSalvarEvapLitros(this)"
                                ondblclick="estoqueAlternarModoEvap(this, 'pct')">
                            <button
                                title="Modo litros — clique para usar percentual (%)"
                                data-empresa="${l.empresa}" data-comb="${l.comb}" data-data="${l.data}"
                                onclick="estoqueAlternarModoEvap(this, 'pct')"
                                style="font-size:0.62rem;font-weight:700;padding:2px 5px;border-radius:3px;cursor:pointer;
                                       border:1px solid var(--info);background:var(--info-light);color:var(--info);
                                       line-height:1;white-space:nowrap;flex-shrink:0">L→%</button>
                           </span>`
                        : `<span style="display:flex;align-items:center;gap:3px">
                            <input type="number" style="${evapInputStyle}" min="0" step="0.01"
                                value="${evapPctDisplay}"
                                placeholder="${(db.combustiveis.find(c=>c.nome===l.comb)?.perda??0).toFixed(2)}"
                                title="${evapPctOriginal?'Valor personalizado':'Valor padrão do cadastro'}"
                                data-empresa="${l.empresa}" data-comb="${l.comb}" data-data="${l.data}"
                                data-anterior="${evapPctDisplay}"
                                onchange="estoqueSalvarEvapDia(this)"
                                ondblclick="estoqueAlternarModoEvap(this, 'litros')">
                            <button
                                title="Modo percentual — clique para usar litros (L)"
                                data-empresa="${l.empresa}" data-comb="${l.comb}" data-data="${l.data}"
                                onclick="estoqueAlternarModoEvap(this, 'litros')"
                                style="font-size:0.62rem;font-weight:700;padding:2px 5px;border-radius:3px;cursor:pointer;
                                       border:1px solid var(--border);background:var(--surface-alt);color:var(--text-muted);
                                       line-height:1;white-space:nowrap;flex-shrink:0">%→L</button>
                           </span>`
                }
            </td>
            <td>${l.evap>0?fmtL3(l.evap):'—'}</td>
            <td><strong>${fmtL3(l.calc)}</strong>${capBadge}</td>
            <td>${isReadonly
                ? (() => {
                    const vStr = l.veeder!==null ? fmtL3(l.veeder) : '—';
                    const tip  = l.veederTanques && l.veeder!==null
                        ? _estoqueVeederTip(l.data, l.veederTanques) : '';
                    return `<span style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;white-space:nowrap">${vStr}${tip}</span>`;
                })()
                : `<input type="number" class="input-tabela" min="0" step="0.001"
                    value="${l.veeder!==null?l.veeder:''}" placeholder="Leitura"
                    data-empresa="${l.empresa}" data-comb="${l.comb}" data-data="${l.data}" data-campo="veeder"
                    data-anterior="${l.veeder!==null?l.veeder:''}"
                    onchange="estoqueSalvarMedicao(this)">${l.veederTanques&&l.veeder!==null ? _estoqueVeederTip(l.data, l.veederTanques) : ''}`
            }</td>
            <td>${difHtml}</td>
            <td class="no-print">${isReadonly ? '<span style="opacity:.35;font-size:.75rem">—</span>' : `<button class="btn-excluir"
                data-empresa="${l.empresa}" data-comb="${l.comb}" data-data="${l.data}"
                onclick="estoqueExcluirDia(this.dataset.empresa,this.dataset.comb,this.dataset.data)">Excluir</button>`}</td>
        </tr>`;
    }).join('');

    const temCapacidade = typeof capacidadeTotalCombustivel === 'function' && capacidadeTotalCombustivel(comb) > 0;

    container.innerHTML=`
        ${_renderBannerCapacidade(comb)}
        ${baraMeses}
        <p class="dica" style="font-size:0.78rem;margin-bottom:8px;">
            Coluna <strong>Evap %</strong>: edite para sobrescrever o padrão do cadastro.
            Use o botão <strong>%→L</strong> / <strong>L→%</strong> para alternar o modo de entrada. Azul = valor personalizado.
            ${temCapacidade ? ` &nbsp;·&nbsp; Laranja = estoque calculado acima da capacidade dos tanques.` : ''}
        </p>
        <div class="tabela-container"><table id="tabelaEstoque">
            <thead><tr>
                <th>Data</th>
                <th>Entrada (L)</th><th>Saída (L)</th>
                <th>Evap %</th>
                <th>Evaporação (L)</th>
                <th>Estoque Calc. (L)</th><th>Veeder-Root (L)</th><th>Diferença (L)</th>
                <th class="no-print">Ações</th>
            </tr></thead>
            <tbody>${linhasHTML}</tbody>
        </table></div>
        ${pagHTML}
        <div class="estoque-grafico-bloco" style="margin-top:24px">
            <div class="estoque-grafico-header">
                <span class="estoque-grafico-titulo">Evolução Mensal — ${comb}</span>
                <span class="estoque-grafico-sub">Estoque final calculado por mês</span>
            </div>
            <div class="grafico-wrapper" style="min-height:220px">
                <canvas id="canvasEstoqueEvolucao" height="220"></canvas>
            </div>
        </div>`;

    // Gráfico chamado após o browser processar o innerHTML e o canvas estar no DOM
    requestAnimationFrame(() => renderGraficoEstoque());
}

/* ─── SALVAR EVAPORAÇÃO DIA ──────────────────────── */
function estoqueSalvarEvapDia(input) {
    const {empresa, comb, data} = input.dataset;
    const val = input.value === '' ? null : parseFloat(input.value);
    salvarEvapDia(empresa, comb, data, val, 'pct');
}

function estoqueSalvarEvapLitros(input) {
    const {empresa, comb, data} = input.dataset;
    const val = input.value === '' ? null : parseFloat(input.value);
    salvarEvapDia(empresa, comb, data, val, 'litros');
}

function estoqueResetarEvapDia(input) {
    const {empresa, comb, data} = input.dataset;
    salvarEvapDia(empresa, comb, data, null, null);
    mostrarToast('Evaporação restaurada ao padrão do cadastro.', 'info');
}

function estoqueAlternarModoEvap(input, novoModo) {
    const {empresa, comb, data} = input.dataset;
    // Limpa o valor atual e salva sem nada — a renderização vai mostrar o input no novo modo
    // Para isso precisamos salvar temporariamente um valor mínimo no modo destino
    if (novoModo === 'litros') {
        salvarEvapDia(empresa, comb, data, 0, 'litros');
    } else {
        salvarEvapDia(empresa, comb, data, 0, 'pct');
    }
    mostrarToast(`Modo evaporação: ${novoModo === 'litros' ? 'litros (L)' : 'percentual (%)'}`, 'info', 2000);
}

/* ─── CÁLCULOS ──────────────────────────────────── */
/**
 * Calcula o estoque acumulado de um combustível para uma empresa até
 * uma data limite (exclusive), aplicando entradas, saídas e evaporação.
 *
 * Percorre todos os dias com lançamentos ou medições registradas antes
 * de `dataLimite`, em ordem cronológica, acumulando o saldo.
 *
 * A evaporação pode ser por percentual (`evapPct`) ou litros diretos
 * (`evapLitros`) — litros têm precedência sobre percentual quando ambos
 * estiverem presentes para o mesmo dia.
 *
 * @param {string} empresa          - Nome da empresa
 * @param {string} nomeCombustivel  - Nome do combustível
 * @param {string} dataLimite       - Data no formato `"YYYY-MM-DD"` (exclusive)
 * @param {number} perdaPct         - Percentual de evaporação padrão do cadastro
 * @returns {number} Saldo em litros até a data limite
 */
function calcularEstoqueAteData(empresa,nomeCombustivel,dataLimite,perdaPct){
    let estoque=db.estoqueInicial?.[empresa]?.[nomeCombustivel]??0;
    const diasSet=new Set();
    db.lancamentos.forEach(l=>{
        const dRef=l.dataDescarga||l.dataNota;
        if(l.empresa===empresa&&dRef&&dRef<dataLimite&&l.itens.some(i=>i.tipo===nomeCombustivel)) diasSet.add(dRef);
    });
    const medicoes=db.estoqueEmpresas?.[empresa]?.[nomeCombustivel]||{};
    Object.keys(medicoes).forEach(d=>{if(d<dataLimite&&!d.startsWith('_'))diasSet.add(d);});
    Array.from(diasSet).sort().forEach(data=>{
        const entrada=calcularEntradaDia(empresa,nomeCombustivel,data);
        const saida=medicoes[data]?.saida??0;
        const evapDia    = getEvapDia(empresa, nomeCombustivel, data);
        const evapLitros = evapDia?.litros ?? null;
        const pct        = evapLitros !== null ? null : (evapDia?.pct ?? perdaPct);
        const evap       = evapLitros !== null ? evapLitros : (estoque > 0 ? estoque * (pct / 100) : 0);
        estoque=estoque+entrada-saida-evap;
    });
    return estoque;
}

function calcularEntradaDia(empresa,nomeCombustivel,data){
    return db.lancamentos
        .filter(l=>l.empresa===empresa&&(l.dataDescarga||l.dataNota)===data)
        .flatMap(l=>l.itens.filter(i=>i.tipo===nomeCombustivel))
        .reduce((soma,i)=>{const litros=(i.qtdDescargada&&i.qtdDescargada>0)?i.qtdDescargada:i.qtd;return soma+(litros||0);},0);
}

/* ─── SALVAR MEDIÇÃO (com log de auditoria) ─────── */
/**
 * Salva uma medição de estoque (saída ou leitura Veeder-Root) a partir de
 * um input da tabela, registrando log de auditoria se o valor mudou.
 *
 * Lê o valor anterior via `data-anterior` no input (não do `db`) porque
 * o save é debounced — o `db` pode ainda não refletir o valor anterior
 * no momento da leitura.
 *
 * Rejeita silenciosamente se o mês estiver fechado (exibe toast de aviso).
 *
 * @param {HTMLInputElement} input - Input da tabela com os atributos:
 *   `data-empresa`, `data-comb`, `data-data`, `data-campo`, `data-anterior`
 */
function estoqueSalvarMedicao(input){
    const {empresa,comb,data,campo,anterior}=input.dataset;
    if(mesFechado(empresa, comb, data.slice(0,7))) {
        mostrarToast('Este mês está fechado. Reabra para editar.', 'aviso');
        renderTabelaEstoque();
        return;
    }
    const valor=input.value===''?null:parseFloat(input.value);
    if(!db.estoqueEmpresas)db.estoqueEmpresas={};
    if(!db.estoqueEmpresas[empresa])db.estoqueEmpresas[empresa]={};
    if(!db.estoqueEmpresas[empresa][comb])db.estoqueEmpresas[empresa][comb]={};
    if(!db.estoqueEmpresas[empresa][comb][data])db.estoqueEmpresas[empresa][comb][data]={};

    const valorAnterior = anterior === '' || anterior === undefined ? null : parseFloat(anterior);
    db.estoqueEmpresas[empresa][comb][data][campo]=valor;

    if (valorAnterior !== valor) {
        _estoqueRegistrarLog(empresa, comb, data, { campo, valorAnterior, valorNovo: valor });
    }

    estoqueSalvarDB();
    renderTabelaEstoque();
}

/* ─── EXCLUIR DIA ───────────────────────────────── */
async function estoqueExcluirDia(empresa,comb,data){
    if(mesFechado(empresa, comb, data.slice(0,7))) {
        mostrarToast('Este mês está fechado. Reabra para editar.', 'aviso'); return;
    }
    const temEntrada=calcularEntradaDia(empresa,comb,data)>0;
    const msg=temEntrada
        ?`O dia ${formatarData(data)} tem entradas vinculadas.\nSó as medições manuais serão removidas. Confirmar?`
        :`Remover o dia ${formatarData(data)} de ${comb} — ${empresa}?`;
    if(!await fmConfirm({ titulo: "Remover dia?", msg, confirmTxt: "Remover", tipo: "perigo" }))return;
    if(db.estoqueEmpresas?.[empresa]?.[comb]?.[data]){
        delete db.estoqueEmpresas[empresa][comb][data]; salvarDB(); renderTabelaEstoque();
    }
}

/* ─── ADICIONAR DIA ─────────────────────────────── */
function estoqueAdicionarDia(){
    _fecharModalEstoque('_modalAdicionarDia');
    const div = document.createElement('div');
    div.id = '_modalAdicionarDia';
    div.className = 'modal-overlay';
    div.style.display = 'flex';
    const hoje = new Date().toISOString().slice(0,10);
    div.innerHTML = `
        <div class="modal" style="max-width:340px;">
            <h3>Adicionar Dia ao Estoque</h3>
            <div class="campo" style="margin-bottom:16px">
                <label>Data (AAAA-MM-DD)</label>
                <input type="date" id="_inputAdicionarDia" value="${hoje}"
                    style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);box-sizing:border-box">
            </div>
            <div class="modal-acoes">
                <button class="btn-primario" onclick="_confirmarAdicionarDia()">Adicionar</button>
                <button class="btn-cancelar" onclick="_fecharModalEstoque('_modalAdicionarDia')">Cancelar</button>
            </div>
        </div>`;
    document.body.appendChild(div);
    div.addEventListener('click', e => { if(e.target === div) _fecharModalEstoque('_modalAdicionarDia'); });
    document.addEventListener('keydown', function _escAdd(e){
        if(e.key === 'Escape'){ _fecharModalEstoque('_modalAdicionarDia'); document.removeEventListener('keydown', _escAdd); }
        if(e.key === 'Enter'){ _confirmarAdicionarDia(); document.removeEventListener('keydown', _escAdd); }
    });
    setTimeout(() => document.getElementById('_inputAdicionarDia')?.focus(), 50);
}

function _confirmarAdicionarDia(){
    const data = document.getElementById('_inputAdicionarDia')?.value;
    if(!data){ mostrarToast('Selecione uma data.', 'aviso'); return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(data)){ mostrarToast('Formato inválido. Use AAAA-MM-DD.', 'aviso'); return; }
    if(diasGerados.includes(data)){ mostrarToast('Esta data já está no período exibido.', 'aviso'); return; }
    _fecharModalEstoque('_modalAdicionarDia');
    const novas=[...diasGerados,data].sort();
    const iI=document.getElementById('estoqueDataInicio'); const iF=document.getElementById('estoqueDataFim');
    if(iI)iI.value=novas[0]; if(iF)iF.value=novas[novas.length-1];
    aplicarFiltrosEstoque();
}

/* ─── GRÁFICO ───────────────────────────────────── */
function renderGraficoEstoque(){
    const canvas=document.getElementById('canvasEstoqueEvolucao');
    if(!canvas)return;
    const comb=estoqueAbaAtiva; if(!comb)return;
    const perdaPct=db.combustiveis.find(c=>c.nome===comb)?.perda??0;
    const emps=[estoqueFiltros.empresa].filter(Boolean);
    const mesesSet=new Set();
    emps.forEach(emp=>{
        db.lancamentos.forEach(l=>{
            if(l.empresa===emp&&l.dataNota&&l.dataNota>=estoqueFiltros.dataInicio&&l.dataNota<=estoqueFiltros.dataFim&&l.itens.some(i=>i.tipo===comb))
                mesesSet.add(l.dataNota.slice(0,7));
        });
        Object.keys(db.estoqueEmpresas?.[emp]?.[comb]||{}).forEach(d=>{
            if(!d.startsWith('_')&&d>=estoqueFiltros.dataInicio&&d<=estoqueFiltros.dataFim)mesesSet.add(d.slice(0,7));
        });
    });
    const meses=Array.from(mesesSet).sort();
    if(meses.length<2){const w=canvas.closest('.grafico-wrapper');if(w)w.innerHTML='<p class="grafico-vazio">Dados insuficientes para gráfico.</p>';return;}
    const valores=meses.map(mes=>{
        const[ano,m]=mes.split('-').map(Number);
        const dl=new Date(ano,m,1).toISOString().slice(0,10);
        return emps.reduce((t,emp)=>t+calcularEstoqueAteData(emp,comb,dl,perdaPct),0);
    });
    const colors=getChartColors();
    if(window.estoqueChart){window.estoqueChart.destroy();window.estoqueChart=null;}
    window.estoqueChart=new Chart(canvas.getContext('2d'),{
        type:'line',
        data:{labels:meses.map(nomeMes),datasets:[{label:`Estoque final — ${comb} (L)`,data:valores,
            borderColor:colors.primary,backgroundColor:colors.primary+'20',tension:0.1,fill:true,
            pointBackgroundColor:colors.primary,pointBorderColor:colors.background,pointRadius:4}]},
        options:{responsive:true,maintainAspectRatio:false,
            plugins:{tooltip:{callbacks:{label:c=>c.raw.toLocaleString('pt-BR',{maximumFractionDigits:0})+' L'}}},
            scales:{y:{ticks:{callback:v=>v.toLocaleString('pt-BR',{maximumFractionDigits:0})+' L',color:colors.text},grid:{color:colors.grid}},
                x:{ticks:{color:colors.text,maxRotation:45,minRotation:45}}}}
    });
}

/* ─── PAGINAÇÃO ─────────────────────────────────── */
function estoqueIrPagina(pagina){
    const emps=[estoqueFiltros.empresa].filter(Boolean);
    const totalPag=Math.max(1,Math.ceil(diasGerados.length*emps.length/ESTOQUE_ITENS_POR_PAGINA));
    estoquesPagina=Math.max(1,Math.min(pagina,totalPag));
    renderTabelaEstoque();
    document.getElementById('estoqueConteudoAba')?.querySelector('.tabela-container')?.scrollIntoView({behavior:'smooth',block:'start'});
}

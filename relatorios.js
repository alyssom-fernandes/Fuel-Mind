/*=================================================
  RELATORIOS.JS – com exportação CSV, layout melhorado,
  correção do filtro de datas, links diretos e filtro global por empresa
  FIX: alert() de exportação substituídos por mostrarToast
  v2: ordenação por litros e valor; detalhe inline colapsável;
      manter filtros após editar lançamento
  v3: exportarPDF expandido — logo, margens, cor, fonte,
      quebra por mês, rodapé customizável
=================================================*/

// ========== VARIÁVEIS GLOBAIS ==========
let dadosRelatorioAtual = [];

/* `_litrosItem()` — critério único de litros — vive em utils.js, para que
   Dashboard, Analítico e Relatórios compartilhem exatamente a mesma regra. */

// Paginação
const ITENS_POR_PAGINA = 50;
let paginaRelatorio = 1;

// Ordenação por clique nos cabeçalhos: { campo, dir }
// campo: 'dataNota' | 'dataDesc' | 'litros' | 'total'
// dir: 'desc' | 'asc'
let _ordemClique = { campo: 'dataDesc', dir: 'desc' };

// Controla qual linha está com detalhe inline aberto
// { contexto: string, id: string }
let _detalheInlineAberto = { contexto: null, id: null };

/*=================================================
  MANTER ESTADO DE FILTROS APÓS EDIÇÃO
=================================================*/
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
function carregarRelatorio() {
    paginaRelatorio = 1;
    _aplicarFiltroRelatorio();
}

function _aplicarFiltroRelatorio() {
    const dataInicio  = document.getElementById("filtroDataInicio").value;
    const dataFim     = document.getElementById("filtroDataFim").value;
    const motorista   = document.getElementById("filtroMotorista").value;
    const placa       = document.getElementById("filtroPlaca").value;
    const combustivel = document.getElementById("filtroCombustivel").value;
    const nota        = document.getElementById("filtroNota").value.trim().toLowerCase();
    const base        = document.getElementById("filtroBase").value.trim().toLowerCase();
    const busca       = document.getElementById("filtroBusca").value.trim().toLowerCase();

    dadosRelatorioAtual = db.lancamentos.filter(l => {
        if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return false;

        // Usa dataDescarga como referência principal, com fallback para dataNota.
        // Um lançamento passa no filtro se QUALQUER das duas datas estiver dentro do intervalo,
        // garantindo que registros com nota fora do período mas descarga dentro (ou vice-versa)
        // sejam exibidos corretamente.
        const dataRef  = l.dataDescarga || l.dataNota || "";
        const dataNota = l.dataNota || "";
        const dentroDoIntervalo = (d) => (!dataInicio || d >= dataInicio) && (!dataFim || d <= dataFim);

        if ((dataInicio || dataFim) && !dentroDoIntervalo(dataRef) && !dentroDoIntervalo(dataNota)) return false;

        if (motorista   && l.motorista !== motorista) return false;
        if (placa       && l.placa !== placa)         return false;
        if (nota        && !l.numeroNota.toLowerCase().includes(nota)) return false;
        if (base        && !(l.base || "").toLowerCase().includes(base)) return false;
        if (combustivel && !l.itens.some(i => i.tipo === combustivel)) return false;
        if (busca       && !JSON.stringify(l).toLowerCase().includes(busca)) return false;
        return true;
    });

    // Ordenação: cabeçalhos clicáveis; padrão = data de descarga decrescente
    const campo = _ordemClique.campo || 'dataDesc';
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

    const totalGeral  = dadosRelatorioAtual.reduce((soma, l) => soma + l.total, 0);
    const totalLitros = dadosRelatorioAtual.reduce((soma, l) =>
        soma + l.itens.reduce((s, i) => s + _litrosItem(i), 0), 0);
    const resumo = document.getElementById("resumoRelatorio");
    const barra  = document.getElementById("barraExportacaoRelatorio");

    if (dadosRelatorioAtual.length === 0) {
        resumo.style.display = "none";
        if (barra) barra.style.display = "none";
    } else {
        // Agrupamento por combustível
        const porComb = {};
        dadosRelatorioAtual.forEach(l => {
            l.itens.forEach(i => {
                if (!i.tipo) return;
                if (!porComb[i.tipo]) porComb[i.tipo] = { litros: 0, total: 0 };
                porComb[i.tipo].litros += _litrosItem(i);
                porComb[i.tipo].total  += i.total || 0;
            });
        });

        // Top 3 motoristas por litros
        const porMotorista = {};
        dadosRelatorioAtual.forEach(l => {
            if (!l.motorista) return;
            const litros = l.itens.reduce((s, i) => s + _litrosItem(i), 0);
            porMotorista[l.motorista] = (porMotorista[l.motorista] || 0) + litros;
        });
        const topMotoristas = Object.entries(porMotorista)
            .sort((a, b) => b[1] - a[1]).slice(0, 3);

        const precoMedio = totalLitros > 0 ? totalGeral / totalLitros : 0;

        // Cards por combustível
        const cardsComb = Object.entries(porComb).map(([comb, d]) => {
            const pm = d.litros > 0 ? d.total / d.litros : 0;
            return `<div style="background:var(--surface-alt);border:1px solid var(--border-light);
                        border-radius:var(--radius-sm);padding:10px 14px;min-width:160px;flex:1">
                <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;
                     letter-spacing:.07em;color:var(--text-muted);margin-bottom:6px">${comb}</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:1rem;font-weight:700;
                     color:var(--text)">${fmtL3(d.litros)}</div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">${fmtR(d.total)}</div>
                <div style="font-size:0.72rem;color:var(--text-light);margin-top:2px">${fmtR4(pm)}/L</div>
            </div>`;
        }).join('');

        // Top motoristas
        const topMotHtml = topMotoristas.length ? `
            <div style="background:var(--surface-alt);border:1px solid var(--border-light);
                        border-radius:var(--radius-sm);padding:10px 14px;min-width:180px;flex:1">
                <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;
                     letter-spacing:.07em;color:var(--text-muted);margin-bottom:8px">Top Motoristas</div>
                ${topMotoristas.map(([nome, litros], idx) => `
                    <div style="display:flex;justify-content:space-between;align-items:center;
                         ${idx > 0 ? 'margin-top:5px;padding-top:5px;border-top:1px solid var(--border-light)' : ''}">
                        <span style="font-size:0.8rem;color:var(--text);white-space:nowrap;
                              overflow:hidden;text-overflow:ellipsis;max-width:120px"
                              title="${nome}">${nome}</span>
                        <span style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;
                              color:var(--text-muted);margin-left:8px;white-space:nowrap">${fmtL(litros, 0)}</span>
                    </div>`).join('')}
            </div>` : '';

        resumo.style.display = "block";
        resumo.innerHTML = `
            <div style="margin-bottom:10px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                <span style="font-size:0.85rem;color:var(--text-muted)">
                    <strong style="color:var(--text)">${dadosRelatorioAtual.length}</strong> lançamento(s)
                </span>
                <span style="font-size:0.85rem;color:var(--text-muted)">
                    Total: <strong style="color:var(--text)">${fmtR(totalGeral)}</strong>
                </span>
                <span style="font-size:0.85rem;color:var(--text-muted)">
                    Litros: <strong style="color:var(--text)">${fmtL3(totalLitros)}</strong>
                </span>
                ${precoMedio > 0 ? `<span style="font-size:0.85rem;color:var(--text-muted)">
                    Preço médio: <strong style="color:var(--text)">${fmtR4(precoMedio)}/L</strong>
                </span>` : ''}
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
                ${cardsComb}
                ${topMotHtml}
            </div>`;
        if (barra) barra.style.display = "flex";
    }
}

function limparFiltros(contexto) {
    if (!contexto || contexto === "relatorio") {
        ["filtroDataInicio","filtroDataFim","filtroDataDescInicio","filtroDataDescFim",
         "filtroMotorista","filtroPlaca","filtroCombustivel","filtroNota","filtroBase","filtroBusca"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        carregarRelatorio();
    }
}

/*=================================================
  RENDER TABELA COM PAGINAÇÃO E DETALHE INLINE
=================================================*/
/**
 * Renderiza a tabela de lançamentos com paginação e suporte a detalhe inline.
 *
 * Usada tanto pelo relatório de entradas quanto pelo histórico —
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
        tbody.innerHTML = `<tr><td colspan="10" class="td-vazio">Nenhum lançamento encontrado.</td></tr>`;
        _renderPaginacao(idTabela, 0, 0, 0, contexto);
        return;
    }

    const totalPaginas = Math.ceil(total / ITENS_POR_PAGINA);
    const paginaAtual  = Math.min(pagina, totalPaginas);
    const inicio       = (paginaAtual - 1) * ITENS_POR_PAGINA;
    const fim          = Math.min(inicio + ITENS_POR_PAGINA, total);
    const fatia        = dados.slice(inicio, fim);

    const fmtL = n => n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const idInlineAberto = _detalheInlineAberto.contexto === contexto ? _detalheInlineAberto.id : null;

    tbody.innerHTML = fatia.flatMap(l => {
        const totalLitros = (l.itens || []).reduce((s, item) => s + _litrosItem(item), 0);
        const estaAberto  = idInlineAberto === l.id;

        const linhaLanc = `
        <tr class="${estaAberto ? 'linha-com-detalhe-aberto' : ''}">
            <td>${formatarData(l.dataNota)}</td>
            <td>${formatarData(l.dataDescarga)}</td>
            <td>${escapeHtml(l.numeroNota)}</td>
            <td>${escapeHtml(l.base) || '—'}</td>
            <td>${escapeHtml(l.empresa) || '—'}</td>
            <td>${escapeHtml(l.motorista) || '—'}</td>
            <td>${escapeHtml(l.placa) || '—'}</td>
            <td style="text-align:right">${fmtL(totalLitros)}</td>
            <td>${fmtR(l.total)}</td>
            <td class="no-print">
                <button class="btn-editar"    onclick="editarLancamento('${l.id}')">Editar</button>
                <button class="btn-clonar"    onclick="clonarLancamento('${l.id}')">Clonar</button>
                <button class="btn-excluir"   onclick="excluirLancamento('${l.id}', '${contexto}')">Excluir</button>
                <button class="btn-secundario btn-ver-inline ${estaAberto ? 'btn-ver-ativo' : ''}"
                        onclick="toggleDetalheInline('${l.id}', '${contexto}')">
                    ${estaAberto ? '▲ Fechar' : '▼ Ver'}
                </button>
            </td>
        </tr>`;

        const linhaDetalhe = estaAberto ? `
        <tr class="linha-detalhe-inline no-print">
            <td colspan="10" style="padding:0;border-top:none;">
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
    let htmlItens = (l.itens || []).map(item => `
        <tr>
            <td>${escapeHtml(item.tipo)}</td>
            <td>${fmtL3(item.qtd)}</td>
            <td>${item.qtdDescargada ? fmtL3(item.qtdDescargada) : "—"}</td>
            <td>${fmtR4(item.valor)}</td>
            <td>${fmtR(item.total)}</td>
            <td>${calcularPerdaBadge(item.tipo, item.qtd, item.qtdDescargada)}</td>
        </tr>
    `).join("");

    let anexosHtml = '';
    if (l.anexos && l.anexos.length > 0) {
        anexosHtml = '<ul style="list-style:none; padding-left:0; margin:0">';
        l.anexos.forEach(a => {
            const href = escapeHtml(a.url || a.dados || '');
            const isImagem = a.tipo && a.tipo.startsWith('image/');
            if (isImagem) {
                anexosHtml += `<li><a href="${href}" target="_blank"><img src="${href}" class="preview-nf" style="max-width:80px;max-height:80px;margin-right:8px;cursor:pointer;"></a></li>`;
            } else {
                anexosHtml += `<li><a href="${href}" target="_blank">${escapeHtml(a.nome)}</a></li>`;
            }
        });
        anexosHtml += '</ul>';
    } else {
        anexosHtml = '<span style="color:var(--text-muted)">—</span>';
    }

    return `
        <div class="detalhe-inline-inner">
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

            <h4 style="margin:12px 0 6px">Combustíveis</h4>
            <table class="detalhe-tabela">
                <thead><tr>
                    <th>Tipo</th><th>Qtd Carga</th><th>Qtd Descarga</th>
                    <th>Valor Unit.</th><th>Total</th><th>Perda</th>
                </tr></thead>
                <tbody>${htmlItens}</tbody>
            </table>

            ${l.observacoes ? `<div class="detalhe-obs"><strong>Observações</strong><br>${escapeHtml(l.observacoes)}</div>` : ''}

            <div class="detalhe-obs">
                <strong>Anexos (${l.anexos?.length || 0})</strong><br>${anexosHtml}
            </div>

            ${l.logs && l.logs.length > 0 ? `
            <div class="detalhe-obs">
                <strong>Histórico de Alterações</strong>
                <ul class="log-list">${l.logs.map(log => {
                    // Suporta log novo (objeto {acao, ts, usuario}) e log antigo (string)
                    if (typeof log === 'object' && log !== null) {
                        const data = new Date(log.ts).toLocaleString('pt-BR');
                        const usuario = log.usuario && log.usuario !== '—' ? ` — ${escapeHtml(log.usuario)}` : '';
                        return `<li><strong>${escapeHtml(log.acao)}</strong> em ${data}${usuario}</li>`;
                    }
                    return `<li>${escapeHtml(log)}</li>`;
                }).join('')}</ul>
            </div>` : ''}
        </div>
    `;
}

function mostrarDetalhes(id, contexto) { toggleDetalheInline(id, contexto); }

function fecharDetalhes(contexto) {
    if (_detalheInlineAberto.contexto === contexto) {
        _detalheInlineAberto = { contexto: null, id: null };
    }
    const el = document.getElementById(`painelDetalhes${contexto.charAt(0).toUpperCase() + contexto.slice(1)}`);
    if (el) el.style.display = "none";
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
function exportarExcel(contexto) {
    const dados = dadosRelatorioAtual;
    if (!dados || dados.length === 0) { mostrarToast("Não há dados para exportar.", "aviso", 4000); return; }

    const linhas = dados.map(l => {
        const totalLitros = l.itens.reduce((s, i) => s + _litrosItem(i), 0);
        const combustiveis = l.itens.map(i => `${i.tipo}: ${_litrosItem(i).toFixed(3)} L`).join(" | ");
        return [
            formatarData(l.dataNota),
            l.dataDescarga ? formatarData(l.dataDescarga) : "",
            l.numeroNota, l.base || "", l.empresa || "", l.motorista || "", l.placa || "",
            combustiveis, totalLitros.toFixed(3), l.total.toFixed(2)
        ];
    });
    linhas.unshift(["Data Nota","Data Descarga","Nota","Base","Empresa","Motorista","Placa","Combustíveis","Total Litros (L)","Total (R$)"]);
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatorio");
    XLSX.writeFile(wb, `controle-combustivel-${contexto}-${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ========== PDF EXPANDIDO ==========
/**
 * Exporta os dados filtrados para PDF usando jsPDF + autoTable.
 * Configurações visuais lidas de `db.configRelatorio` (margens, fonte,
 * cor de destaque, logo por empresa, quebra por mês, etc.).
 *
 * A logo da empresa ativa é resolvida na ordem:
 *   1. `db.configRelatorio.logos[empresaFiltroGlobal].url` (Storage URL → pré-carregada como base64)
 *   2. `db.configRelatorio.logo` (base64 legado)
 *   3. Sem logo
 *
 * @param {'relatorio'} contexto - Rótulo usado no nome do arquivo
 * @returns {Promise<void>}
 */
async function exportarPDF(contexto) {
    const dados = dadosRelatorioAtual;
    if (!dados || dados.length === 0) { mostrarToast("Não há dados para exportar.", "aviso", 4000); return; }

    const cfg = Object.assign({
        titulo: "Controle de Entradas de Combustível",
        logo: null,
        orientacao: "landscape",
        fonte: "helvetica",
        corDestaque: "#1a3a5c",
        margemEsq: 14,
        margemDir: 14,
        margemTopo: 14,
        margemRodape: 10,
        mostrarBase: true,
        mostrarEmpresa: true,
        mostrarMotorista: true,
        mostrarPlaca: true,
        quebrarPorMes: false,
        rodapeTexto: ""
    }, db.configRelatorio || {});

    // Converte cor hex → [r, g, b]
    // ── Resolve logo: Storage URL > base64 legado > sem logo ──
    // Se há uma URL do Storage para a empresa ativa, pré-carrega como base64
    // antes de criar o documento (jsPDF não aceita URLs remotas diretamente).
    const logoStorage = cfg.logos?.[empresaFiltroGlobal]?.url || null;
    if (logoStorage && logoStorage.startsWith('http')) {
        try {
            const resp = await fetch(logoStorage);
            const blob = await resp.blob();
            cfg.logo = await new Promise((res, rej) => {
                const reader = new FileReader();
                reader.onload  = () => res(reader.result);
                reader.onerror = rej;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn('[exportarPDF] Falha ao pré-carregar logo do Storage:', e);
            // mantém cfg.logo como base64 legado ou null
        }
    }

    function hexRgb(hex) {
        const h = hex.replace('#','');
        const r = parseInt(h.slice(0,2),16);
        const g = parseInt(h.slice(2,4),16);
        const b = parseInt(h.slice(4,6),16);
        return [r, g, b];
    }
    const corRGB = hexRgb(cfg.corDestaque || '#1a3a5c');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: cfg.orientacao, unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.width;
    const H = doc.internal.pageSize.height;
    const mL = cfg.margemEsq;
    const mR = cfg.margemDir;
    const mRod = cfg.margemRodape;

    // ── Função para desenhar cabeçalho numa nova página ──
    function desenharCabecalho(tituloSecao) {
        const altCab = cfg.logo ? 28 : 22;
        doc.setFillColor(...corRGB);
        doc.rect(0, 0, W, altCab, 'F');
        doc.setTextColor(255, 255, 255);

        // Logo (se existir)
        if (cfg.logo) {
            try {
                // Detecta formato da imagem pelo início do base64
                const match = cfg.logo.match(/^data:image\/(\w+);base64,/);
                const fmt   = match ? match[1].toUpperCase() : 'JPEG';
                const base64 = cfg.logo.split(',')[1] || cfg.logo;
                doc.addImage(base64, fmt, mL, 3, 22, 22);
            } catch(e) { /* ignora logo inválido */ }
        }

        const textX = cfg.logo ? mL + 26 : W / 2;
        const textAlign = cfg.logo ? 'left' : 'center';

        doc.setFontSize(14);
        doc.setFont(cfg.fonte, 'bold');
        doc.text(cfg.titulo, textX, cfg.logo ? 13 : 11, { align: textAlign });
        doc.setFontSize(9);
        doc.setFont(cfg.fonte, 'normal');
        const sub = `${tituloSecao} — Gerado em: ${new Date().toLocaleDateString("pt-BR")}`;
        doc.text(sub, textX, cfg.logo ? 22 : 19, { align: textAlign });

        return altCab + 4;
    }

    // ── Função para desenhar rodapé ──
    function desenharRodape(pageNum, totalPages) {
        doc.setFontSize(7.5);
        doc.setTextColor(120, 120, 120);
        if (cfg.rodapeTexto) {
            doc.text(cfg.rodapeTexto, mL, H - mRod);
        }
        doc.text(`Página ${pageNum} de ${totalPages}`, W - mR, H - mRod, { align: 'right' });
    }

    const tituloCtx = contexto === 'relatorio' ? 'Relatório' : 'Histórico';

    // ── Monta colunas dinamicamente ──
    const head = ["Data Nota", "Data Desc.", "Nota"];
    if (cfg.mostrarBase)      head.push("Base");
    if (cfg.mostrarEmpresa)   head.push("Empresa");
    if (cfg.mostrarMotorista) head.push("Motorista");
    if (cfg.mostrarPlaca)     head.push("Placa");
    head.push("Litros (L)", "Total (R$)");

    function buildRow(l) {
        const litros = l.itens.reduce((s, i) => s + _litrosItem(i), 0);
        const row = [formatarData(l.dataNota), l.dataDescarga ? formatarData(l.dataDescarga) : "", l.numeroNota];
        if (cfg.mostrarBase)      row.push(l.base || "");
        if (cfg.mostrarEmpresa)   row.push(l.empresa || "");
        if (cfg.mostrarMotorista) row.push(l.motorista || "");
        if (cfg.mostrarPlaca)     row.push(l.placa || "");
        row.push(
            litros.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
            `R$ ${l.total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        );
        return row;
    }

    const colStyles = {
        [head.length - 2]: { halign: 'right' },
        [head.length - 1]: { halign: 'right' }
    };

    const totalGeral  = dados.reduce((s, l) => s + l.total, 0);
    const totalLitros = dados.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0);

    if (!cfg.quebrarPorMes) {
        // ── Modo normal: uma única tabela ──
        let startY = desenharCabecalho(tituloCtx);

        doc.setTextColor(...corRGB);
        doc.setFontSize(9);
        doc.setFont(cfg.fonte, 'bold');
        doc.text(`Registros: ${dados.length}`, mL, startY);
        doc.text(`Litros: ${totalLitros.toLocaleString("pt-BR", {minimumFractionDigits:3,maximumFractionDigits:3})} L`, mL + 50, startY);
        doc.text(`Total: R$ ${totalGeral.toLocaleString("pt-BR", {minimumFractionDigits:2,maximumFractionDigits:2})}`, mL + 120, startY);
        startY += 6;

        doc.autoTable({
            head: [head],
            body: dados.map(buildRow),
            startY,
            theme: 'striped',
            headStyles: { fillColor: corRGB, fontSize: 9, font: cfg.fonte },
            bodyStyles: { fontSize: 8, font: cfg.fonte },
            columnStyles: colStyles,
            margin: { left: mL, right: mR, bottom: mRod + 8 },
            didDrawPage: (data) => {
                desenharRodape(doc.internal.getCurrentPageInfo().pageNumber, '?');
            }
        });

    } else {
        // ── Modo quebrar por mês ──
        // Agrupa sempre por dataDescarga (com fallback para dataNota)
        const _dataRef = l => l.dataDescarga || l.dataNota || '';
        const porMes = {};
        dados.forEach(l => {
            const mes = _dataRef(l).slice(0, 7);
            if (!porMes[mes]) porMes[mes] = [];
            porMes[mes].push(l);
        });

        const meses = Object.keys(porMes).sort();
        let primeiraSecao = true;

        meses.forEach(mes => {
            const lans = porMes[mes];
            if (!primeiraSecao) doc.addPage();
            primeiraSecao = false;

            let startY = desenharCabecalho(`${tituloCtx} — ${nomeMes(mes)}`);
            const subTotLitros = lans.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0);
            const subTotGeral  = lans.reduce((s, l) => s + l.total, 0);

            doc.setTextColor(...corRGB);
            doc.setFontSize(9);
            doc.setFont(cfg.fonte, 'bold');
            doc.text(`${nomeMes(mes)} — ${lans.length} lançamento(s)`, mL, startY);
            doc.text(`Litros: ${subTotLitros.toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3})} L`, mL + 70, startY);
            doc.text(`Total: R$ ${subTotGeral.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`, mL + 140, startY);
            startY += 5;

            doc.autoTable({
                head: [head],
                body: lans.map(buildRow),
                startY,
                theme: 'striped',
                headStyles: { fillColor: corRGB, fontSize: 9, font: cfg.fonte },
                bodyStyles: { fontSize: 8, font: cfg.fonte },
                columnStyles: colStyles,
                margin: { left: mL, right: mR, bottom: mRod + 8 },
                didDrawPage: (data) => {
                    desenharRodape(doc.internal.getCurrentPageInfo().pageNumber, '?');
                }
            });
        });
    }

    // Atualiza rodapé com total de páginas correto
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFontSize(7.5);
        doc.setTextColor(120, 120, 120);
        // Limpa área do rodapé e redesenha com total real
        doc.setFillColor(255, 255, 255);
        doc.rect(0, H - mRod - 4, W, mRod + 4, 'F');
        if (cfg.rodapeTexto) {
            doc.text(cfg.rodapeTexto, mL, H - mRod);
        }
        doc.text(`Página ${p} de ${totalPages}`, W - mR, H - mRod, { align: 'right' });
    }

    doc.save(`controle-combustivel-${contexto}-${new Date().toISOString().slice(0,10)}.pdf`);
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
    const dados = dadosRelatorioAtual;
    if (!dados || dados.length === 0) { mostrarToast("Não há dados para exportar.", "aviso", 4000); return; }

    const linhas = dados.map(l => {
        const totalLitros = l.itens.reduce((s, i) => s + _litrosItem(i), 0);
        const combustiveis = l.itens.map(i => `${i.tipo}: ${_litrosItem(i).toFixed(3)} L`).join(" | ");
        return [
            formatarData(l.dataNota),
            l.dataDescarga ? formatarData(l.dataDescarga) : "",
            l.numeroNota, l.base || "", l.empresa || "", l.motorista || "", l.placa || "",
            combustiveis,
            totalLitros.toFixed(3).replace('.', ','),
            l.total.toFixed(2).replace('.', ',')
        ];
    });
    linhas.unshift(["Data Nota","Data Descarga","Nota","Base","Empresa","Motorista","Placa","Combustíveis","Total Litros (L)","Total (R$)"]);
    const csv = linhas.map(row => row.map(cell => `"${cell}"`).join(';')).join('\n');
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `controle-combustivel-${contexto}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ========== IMPRIMIR ==========
function imprimirRelatorio() {
    const dados  = dadosRelatorioAtual;
    const titulo = "Relatório de Entradas";

    if (!dados || dados.length === 0) { mostrarToast("Não há dados para imprimir.", "aviso", 4000); return; }

    const totalGeral  = dados.reduce((s, l) => s + l.total, 0);
    const totalLitros = dados.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0);
    const dataHoje    = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });

    document.getElementById("impressaoTitulo").textContent = titulo;
    document.getElementById("impressaoData").textContent   = `Impresso em: ${dataHoje} | ${dados.length} registros | Total: ${fmtR(totalGeral)} | Litros: ${totalLitros.toFixed(3)} L`;

    document.getElementById("impressaoConteudo").innerHTML = `
        <table>
            <thead><tr>
                <th>Data Nota</th><th>Data Desc.</th><th>Nota</th><th>Base</th>
                <th>Empresa</th><th>Motorista</th><th>Placa</th><th>Litros (L)</th><th>Total (R$)</th>
            </tr></thead>
            <tbody>
                ${dados.map(l => {
                    const tl = l.itens.reduce((s, i) => s + _litrosItem(i), 0);
                    return `<tr>
                        <td>${formatarData(l.dataNota)}</td>
                        <td>${l.dataDescarga ? formatarData(l.dataDescarga) : ""}</td>
                        <td>${escapeHtml(l.numeroNota)}</td><td>${escapeHtml(l.base) || ""}</td>
                        <td>${escapeHtml(l.empresa) || ""}</td><td>${escapeHtml(l.motorista) || ""}</td><td>${escapeHtml(l.placa) || ""}</td>
                        <td>${tl.toLocaleString("pt-BR", {minimumFractionDigits:3,maximumFractionDigits:3})}</td>
                        <td>R$ ${l.total.toLocaleString("pt-BR", {minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    </tr>`;
                }).join("")}
            </tbody>
            <tfoot><tr>
                <td colspan="7"><strong>Total Geral</strong></td>
                <td><strong>${dados.reduce((s,l)=>s+l.itens.reduce((ss,i)=>ss+_litrosItem(i),0),0).toLocaleString("pt-BR",{minimumFractionDigits:3,maximumFractionDigits:3})} L</strong></td>
                <td><strong>${fmtR(totalGeral)}</strong></td>
            </tr></tfoot>
        </table>
    `;
    window.print();
}

// ========== WHATSAPP ==========
function compartilharWhatsApp(contexto) {
    const lista = dadosRelatorioAtual;
    if (!lista || lista.length === 0) { mostrarToast("Não há dados para compartilhar.", "aviso", 4000); return; }
    const totalGeral = lista.reduce((s, l) => s + l.total, 0);
    const dataHoje   = new Date().toLocaleDateString("pt-BR");
    let mensagem = `⛽ *Controle de Combustível*\n📅 ${dataHoje}\n📋 ${lista.length} lançamento(s)\n💰 Total: ${fmtR(totalGeral)}\n\n`;
    lista.slice(-5).forEach(l => {
        mensagem += `• ${formatarData(l.dataNota)} | ${l.numeroNota} | ${l.motorista || "—"} | ${fmtR(l.total)}\n`;
    });
    if (lista.length > 5) mensagem += `\n... e mais ${lista.length - 5} registro(s).`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, "_blank");
}

// ========== E-MAIL ==========
function compartilharEmail(contexto) {
    const lista = dadosRelatorioAtual;
    if (!lista || lista.length === 0) { mostrarToast("Não há dados para compartilhar.", "aviso", 4000); return; }
    const totalGeral = lista.reduce((s, l) => s + l.total, 0);
    const dataHoje   = new Date().toLocaleDateString("pt-BR");
    const assunto    = `Controle de Combustível — ${dataHoje}`;
    let corpo = `Controle de Entradas de Combustível\nData: ${dataHoje}\nRegistros: ${lista.length}\nTotal: ${fmtR(totalGeral)}\n\n${"=".repeat(60)}\n\n`;
    lista.forEach(l => {
        corpo += `Data: ${formatarData(l.dataNota)}\nNota: ${l.numeroNota} | Base: ${l.base || "—"}\nEmpresa: ${l.empresa || "—"} | Motorista: ${l.motorista || "—"} | Placa: ${l.placa || "—"}\nTotal: ${fmtR(l.total)}\n${"-".repeat(40)}\n`;
    });
    window.location.href = `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}

/*=================================================
  RELATÓRIO MENSAL GERENCIAL
=================================================*/
function gerarRelatorioMensalPDF() {
    const hoje = new Date();
    const modal = document.createElement('div');
    modal.id = '_modalRelMensal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999`;

    const opcoes = [];
    for (let i = 0; i < 24; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        opcoes.push(`<option value="${val}" ${i===0?'selected':''}>${nomeMes(val)}</option>`);
    }

    modal.innerHTML = `
        <div style="background:var(--surface);border-radius:12px;padding:28px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3)">
            <h3 style="margin:0 0 8px">Relatório Mensal Gerencial</h3>
            <p style="color:var(--text-muted);font-size:0.88rem;margin:0 0 20px">
                Gera um PDF formatado com resumo executivo, detalhamento por combustível e comparativo com o mês anterior.
            </p>
            <div class="campo" style="margin-bottom:8px">
                <label>Mês de referência</label>
                <select id="_selMesRelMensal" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)">
                    ${opcoes.join('')}
                </select>
            </div>
            <div class="campo" style="margin-bottom:20px">
                <label>Nome do posto / empresa (cabeçalho)</label>
                <input id="_nomeEmpresaRel" type="text" value="${empresaFiltroNome || db.empresas?.[0]?.nome || 'Posto Rosário'}"
                    style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);box-sizing:border-box">
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button onclick="document.getElementById('_modalRelMensal').remove()"
                    style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);cursor:pointer">
                    Cancelar
                </button>
                <button onclick="_executarRelatorioMensal()"
                    style="padding:8px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:600">
                    Gerar PDF
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function _executarRelatorioMensal() {
    const mes     = document.getElementById('_selMesRelMensal')?.value;
    const empresa = document.getElementById('_nomeEmpresaRel')?.value?.trim() || empresaFiltroNome || 'Controle de Combustível';
    document.getElementById('_modalRelMensal')?.remove();
    if (!mes) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.width;
    const azul = [26, 58, 92];
    const azulClaro = [41, 98, 155];
    const cinza = [120, 120, 120];

    const [ano, m] = mes.split('-').map(Number);
    const mesAnterior = m === 1 ? `${ano-1}-12` : `${ano}-${String(m-1).padStart(2,'0')}`;

    const lancamentosFiltrados = db.lancamentos.filter(l => (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal));
    const lansMes      = lancamentosFiltrados.filter(l => (l.dataDescarga||l.dataNota).startsWith(mes));
    const lansAnterior = lancamentosFiltrados.filter(l => (l.dataDescarga||l.dataNota).startsWith(mesAnterior));
    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);

    const totalNotas  = lansMes.length;
    const totalLitros = lansMes.reduce((s,l) => s + l.itens.reduce((ss,i) => ss+_litrosItem(i),0), 0);
    const totalGasto  = lansMes.reduce((s,l) => s + l.total, 0);
    const custoMedio  = totalLitros > 0 ? totalGasto/totalLitros : 0;
    const totLitrosAnt = lansAnterior.reduce((s,l) => s + l.itens.reduce((ss,i) => ss+_litrosItem(i),0), 0);
    const totGastoAnt  = lansAnterior.reduce((s,l) => s + l.total, 0);

    doc.setFillColor(...azul);
    doc.rect(0, 0, W, 28, 'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text(empresa, 14, 11);
    doc.setFontSize(10); doc.setFont('helvetica','normal');
    doc.text('Relatório Mensal de Entradas de Combustível', 14, 18);
    doc.setFontSize(9);
    doc.text(`Período: ${nomeMes(mes)}   |   Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, 24);

    let y = 36;
    doc.setTextColor(...azul); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('RESUMO EXECUTIVO', 14, y); y += 6;
    doc.setDrawColor(...azul); doc.line(14, y, W-14, y); y += 5;

    const kpis = [
        { label: 'Total de Notas',      valor: String(totalNotas) },
        { label: 'Total de Litros',     valor: totalLitros.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0}) + ' L' },
        { label: 'Total Gasto',         valor: 'R$ ' + totalGasto.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) },
        { label: 'Custo Médio / Litro', valor: 'R$ ' + custoMedio.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4}) },
    ];
    const colW = (W - 28) / 4;
    kpis.forEach((k, i) => {
        const x = 14 + i * colW;
        doc.setFillColor(245,247,250);
        doc.roundedRect(x, y, colW-3, 18, 2, 2, 'F');
        doc.setTextColor(...cinza); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
        doc.text(k.label.toUpperCase(), x+4, y+6);
        doc.setTextColor(...azul); doc.setFontSize(11); doc.setFont('helvetica','bold');
        doc.text(k.valor, x+4, y+14);
    });
    y += 24;

    if (totGastoAnt > 0 || totLitrosAnt > 0) {
        const varGasto  = totGastoAnt  > 0 ? ((totalGasto-totGastoAnt)/totGastoAnt*100)   : null;
        const varLitros = totLitrosAnt > 0 ? ((totalLitros-totLitrosAnt)/totLitrosAnt*100) : null;
        doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...cinza);
        const partes = [];
        if (varGasto  !== null) partes.push(`Gasto: ${varGasto>=0?'+':''}${varGasto.toFixed(1)}% vs. ${nomeMes(mesAnterior)}`);
        if (varLitros !== null) partes.push(`Litros: ${varLitros>=0?'+':''}${varLitros.toFixed(1)}% vs. ${nomeMes(mesAnterior)}`);
        doc.text('Variação: ' + partes.join('   |   '), 14, y); y += 8;
    }

    doc.setTextColor(...azul); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('DETALHAMENTO POR COMBUSTÍVEL', 14, y); y += 4;

    const combRows = combustiveis.map(c => {
        const itens    = lansMes.flatMap(l => l.itens.filter(i => i.tipo===c.nome));
        const litros   = itens.reduce((s,i) => s+_litrosItem(i),0);
        const gasto    = itens.reduce((s,i) => s+(i.total ?? i.qtd*i.valor),0);
        const custo    = litros > 0 ? gasto/litros : 0;
        const notas    = lansMes.filter(l=>l.itens.some(i=>i.tipo===c.nome)).length;
        const itensAnt = lansAnterior.flatMap(l => l.itens.filter(i => i.tipo===c.nome));
        const litrosAnt= itensAnt.reduce((s,i) => s+_litrosItem(i),0);
        const varL     = litrosAnt > 0 ? ((litros-litrosAnt)/litrosAnt*100) : null;
        return [
            c.nome, String(notas),
            litros.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0}) + ' L',
            'R$ ' + custo.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4}),
            'R$ ' + gasto.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),
            varL !== null ? `${varL>=0?'+':''}${varL.toFixed(1)}%` : '—',
        ];
    }).filter(r => r[1] !== '0');

    doc.autoTable({
        head: [['Combustível','Notas','Litros','Custo Médio/L','Total Gasto','Var. Litros']],
        body: combRows, startY: y + 2, theme: 'grid',
        headStyles: { fillColor: azul, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5 },
        columnStyles: { 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right',fontStyle:'bold'}, 5:{halign:'center'} },
        margin: { left: 14, right: 14 },
        didDrawPage: d => { d.settings.margin.top = 14; },
    });
    y = doc.lastAutoTable.finalY + 10;

    if (lansMes.length > 0) {
        doc.setTextColor(...azul); doc.setFontSize(11); doc.setFont('helvetica','bold');
        doc.text('LANÇAMENTOS DO PERÍODO', 14, y); y += 2;
        const sorted = [...lansMes].sort((a,b) => (a.dataDescarga||a.dataNota).localeCompare(b.dataDescarga||b.dataNota));
        doc.autoTable({
            head: [['Descarga','NF','Base','Empresa','Motorista','Placa','Litros','Total']],
            body: sorted.map(l => {
                const litros = l.itens.reduce((s,i) => s+_litrosItem(i), 0);
                return [
                    formatarData(l.dataDescarga||l.dataNota), l.numeroNota,
                    l.base||'—', l.empresa||'—', l.motorista||'—', l.placa||'—',
                    litros.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0}),
                    'R$ '+l.total.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),
                ];
            }),
            foot: [[
                {content:'TOTAL', colSpan:6, styles:{fontStyle:'bold',halign:'right'}},
                totalLitros.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0}),
                {content:'R$ '+totalGasto.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}), styles:{fontStyle:'bold'}},
            ]],
            startY: y + 2, theme: 'striped',
            headStyles: { fillColor: azulClaro, fontSize: 7.5 },
            bodyStyles: { fontSize: 7.5 },
            footStyles: { fillColor: [235,240,248], textColor: azul, fontSize: 8 },
            columnStyles: { 6:{halign:'right'}, 7:{halign:'right',fontStyle:'bold'} },
            margin: { left: 14, right: 14 },
            didDrawPage: d => { d.settings.margin.top = 14; },
        });
    }

    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setFontSize(7.5); doc.setTextColor(...cinza);
        doc.text(`${empresa} — ${nomeMes(mes)}`, 14, doc.internal.pageSize.height - 8);
        doc.text(`Página ${p} de ${pages}`, W-14, doc.internal.pageSize.height - 8, { align: 'right' });
    }

    doc.save(`relatorio-mensal-${mes}.pdf`);
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
function filtroRapido(arg1, arg2) {
    let contexto, periodo;
    if (arg2 === undefined) { contexto = 'relatorio'; periodo = arg1; }
    else { contexto = arg1; periodo = arg2; }

    const hoje = new Date();
    const toISO = d => d.toISOString().slice(0, 10);
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
        const elI = document.getElementById("filtroDataInicio");
        const elF = document.getElementById("filtroDataFim");
        if (elI) elI.value = inicio;
        if (elF) elF.value = fim;
        _aplicarFiltroRelatorio();
    } else if (contexto === 'analitico') {
        const elI = document.getElementById("analiticoInicio");
        const elF = document.getElementById("analiticoFim");
        if (elI) elI.value = inicio;
        if (elF) elF.value = fim;
        if (typeof carregarAnalitico === 'function') carregarAnalitico();
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
        if (!dadosRelatorioAtual || dadosRelatorioAtual.length === 0) {
            mostrarToast('Nenhum lançamento no período para exportar.', 'aviso', 4000);
            return;
        }
        exportarPDF('relatorio');
    }, 300);
}
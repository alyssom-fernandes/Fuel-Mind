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
/* Dois conjuntos, e a diferença entre eles é o tema 11+19 inteiro.
   `dadosRelatorioAtual` é o que a TABELA mostra — inclui as notas
   canceladas, sempre, e as excluídas quando a caixa está marcada.
   `dadosRelatorioValidos` é o que CONTA: resumo, totais, preço médio,
   agrupamento por combustível, top de motoristas e os seis formatos de
   exportação leem daqui. Um registro que deixou de valer pode ser visto;
   não pode ser somado. */
let dadosRelatorioAtual   = [];
let dadosRelatorioValidos = [];

/* `_litrosItem()` — critério único de litros — vive em utils.js, para que
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

/**
 * Texto de um lançamento para a busca livre, em cache.
 *
 * Antes isto era `JSON.stringify(l)` executado sobre CADA lançamento a CADA
 * tecla digitada — reserializava a base inteira, incluindo logs e anexos, por
 * caractere. O cache é invalidado por identidade do objeto: qualquer edição
 * cria um objeto novo no fluxo de save, então um lançamento alterado
 * reindexará sozinho.
 */
const _cacheBusca = new WeakMap();
function _textoBuscavel(l) {
    let txt = _cacheBusca.get(l);
    if (txt === undefined) {
        txt = [l.numeroNota, l.empresa, l.motorista, l.placa, l.base, l.observacoes,
               l.dataNota, l.dataDescarga,
               ...(l.itens || []).map(i => i.tipo),
               // Quem criou ou editou: a busca antiga alcançava isso porque
               // serializava o objeto inteiro, e é uso legítimo — "o que o
               // Fulano lançou". Só o nome entra, não a ação nem o timestamp.
               ...(l.logs || []).map(g => (typeof g === 'object' && g) ? g.usuario : g)]
              .filter(Boolean).join(" ").toLowerCase();
        _cacheBusca.set(l, txt);
    }
    return txt;
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

    const mostrarInativos = document.getElementById("filtroMostrarInativos")?.checked;

    const dentroDoIntervalo = (d) => !!d && (!dataInicio || d >= dataInicio) && (!dataFim || d <= dataFim);
    const temPeriodo = !!(dataInicio || dataFim);

    // Todos os filtros menos o de data. Serve à tabela e à conta das notas
    // da fronteira, logo abaixo.
    const passaSemData = l => {
        if (motorista   && l.motorista !== motorista) return false;
        if (placa       && l.placa !== placa)         return false;
        if (nota        && !l.numeroNota.toLowerCase().includes(nota)) return false;
        if (base        && !(l.base || "").toLowerCase().includes(base)) return false;
        if (combustivel && !l.itens.some(i => i.tipo === combustivel)) return false;
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
        // A EXCLUÍDA some por padrão — foi um erro de digitação, não um
        // acontecimento — e volta com a caixa "Mostrar excluídas e
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
        // caísse no intervalo — e uma nota emitida em 31/07 e descarregada em
        // 01/08 aparecia em julho e em agosto: consultados separadamente, os
        // dois meses somavam 29.500 L a mais que o intervalo inteiro no modo
        // demo. A intenção de não esconder nota ficou no resumo, que diz
        // quantas notas da fronteira ficaram de fora.
        if (temPeriodo && !dentroDoIntervalo(dataEmissaoDe(l))) return false;

        return passaSemData(l);
    });

    // As notas da fronteira: emitidas no período e descarregadas fora dele, e
    // descarregadas no período e emitidas fora dele. Só as que valem.
    let emitidasDescarregadasFora = 0, descarregadasEmitidasFora = 0;
    if (temPeriodo) {
        db.lancamentos.forEach(l => {
            if (!lancamentoAtivo(l)) return;
            if (empresaFiltroGlobal && l.empresa !== empresaFiltroGlobal) return;
            const emissaoDentro  = dentroDoIntervalo(dataEmissaoDe(l));
            const descargaDentro = dentroDoIntervalo(dataDescargaDe(l));
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
                if (!porComb[i.tipo]) porComb[i.tipo] = { litros: 0, total: 0 };
                porComb[i.tipo].litros += _litrosItem(i);
                porComb[i.tipo].total  += i.total || 0;
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
                    <strong style="color:var(--text)">${dadosRelatorioValidos.length}</strong> lançamento(s)
                </span>
                ${foraDaConta > 0 ? `<span style="font-size:0.8rem;color:var(--text-muted)">
                    · ${foraDaConta} na tela fora dos totais
                </span>` : ''}
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
            ${_textoFronteiraRelatorio(temPeriodo, emitidasDescarregadasFora, descarregadasEmitidasFora)}
            <div style="display:flex;gap:10px;flex-wrap:wrap">
                ${cardsComb}
                ${topMotHtml}
            </div>`;
        if (barra) barra.style.display = "flex";
    }
}

/** A linha do resumo que diz de que data é o período e quem ficou na fronteira. */
function _textoFronteiraRelatorio(temPeriodo, emitidasFora, descarregadasFora) {
    if (!temPeriodo) return '';
    const partes = [];
    if (emitidasFora) partes.push(`${emitidasFora} emitida${emitidasFora > 1 ? 's' : ''} no período e descarregada${emitidasFora > 1 ? 's' : ''} depois dele (incluída${emitidasFora > 1 ? 's' : ''})`);
    if (descarregadasFora) partes.push(`${descarregadasFora} descarregada${descarregadasFora > 1 ? 's' : ''} no período e emitida${descarregadasFora > 1 ? 's' : ''} fora dele (não incluída${descarregadasFora > 1 ? 's' : ''})`);
    return `<div class="dica" style="font-size:0.78rem;margin:-4px 0 10px">
        Período pela <strong>data de emissão</strong>.${partes.length ? ' Notas da fronteira: ' + partes.join(' · ') + '.' : ''}
    </div>`;
}

function limparFiltros(contexto) {
    if (!contexto || contexto === "relatorio") {
        ["filtroDataInicio","filtroDataFim",
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

    // Litros com TRÊS casas, como em todo o resto do sistema. Esta linha
    // declarava um `fmtL` local, sombreando o de utils.js, e arredondava
    // para inteiro — só aqui. A mesma nota lia 3.501 nesta tabela e
    // 3.500,700 no resumo acima dela, no detalhe que abre embaixo, no
    // Excel, no CSV e na impressão. É a tela onde o operador confere
    // antes de exportar, e era a única que mostrava outro número.
    const fmtL = n => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const idInlineAberto = _detalheInlineAberto.contexto === contexto ? _detalheInlineAberto.id : null;

    tbody.innerHTML = fatia.flatMap(l => {
        const totalLitros = (l.itens || []).reduce((s, item) => s + _litrosItem(item), 0);
        const estaAberto  = idInlineAberto === l.id;

        // A linha de um lançamento que não vale mais fica riscada, e o
        // estado vem colado no número da nota — não numa coluna própria.
        // Uma décima primeira coluna, vazia em 99% das linhas, empurrava a
        // de Ações para fora da área visível e cobrava uma rolagem lateral
        // em todo dia normal por causa de uma exceção rara.
        //
        // O badge é o mesmo que a tela de Usuários já usa no usuário
        // desativado: mesmo significado, nenhum vocabulário novo.
        const morto  = !lancamentoAtivo(l);
        const rotulo = l.estado === 'cancelado' ? 'cancelada' : 'excluída';

        const linhaLanc = `
        <tr class="${estaAberto ? 'linha-com-detalhe-aberto' : ''}${morto ? ' linha-inativo' : ''}">
            <td>${formatarData(l.dataNota)}</td>
            <td>${formatarData(l.dataDescarga)}</td>
            <td>${escapeHtml(l.numeroNota)}${morto
                ? ` <span class="badge-inativo-user">${rotulo}</span>` : ''}</td>
            <td>${escapeHtml(l.base) || '—'}</td>
            <td>${escapeHtml(l.empresa) || '—'}</td>
            <td>${escapeHtml(l.motorista) || '—'}</td>
            <td>${escapeHtml(l.placa) || '—'}</td>
            <td style="text-align:right">${fmtL(totalLitros)}</td>
            <td>${fmtR(l.total)}</td>
            <td class="no-print">
                ${morto ? '' : `
                <button class="btn-editar"    onclick="editarLancamento('${escapeJsAttr(l.id)}')">Editar</button>
                <button class="btn-clonar"    onclick="clonarLancamento('${escapeJsAttr(l.id)}')">Clonar</button>`}
                ${l.estado === 'excluido'
                    ? `<button class="btn-editar" title="Devolver este lançamento aos relatórios"
                            onclick="restaurarLancamento('${escapeJsAttr(l.id)}', '${escapeJsAttr(contexto)}')">Restaurar</button>`
                    : l.estado === 'cancelado'
                        ? ''
                        : `<button class="btn-excluir" onclick="excluirLancamento('${escapeJsAttr(l.id)}', '${escapeJsAttr(contexto)}')">Excluir</button>`}
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
        faixaEstado = `<div class="faixa-validacao faixa-bloqueio" style="margin:0 0 12px">
            <strong>Cancelada na origem.</strong> Fora dos litros, do custo médio e do frete.
            ${quandoEstado ? `<br><small>Marcada em ${quandoEstado}.</small>` : ''}
            ${ultimoEstado && ultimoEstado.motivo ? `<br><small>Motivo: ${escapeHtml(ultimoEstado.motivo)}</small>` : ''}
        </div>`;
    } else if (l.estado === 'excluido') {
        faixaEstado = `<div class="faixa-validacao faixa-alerta" style="margin:0 0 12px">
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

            <h4 style="margin:12px 0 6px">Combustíveis</h4>
            <table class="detalhe-tabela">
                <thead><tr>
                    <th>Tipo</th><th>Qtd Carga</th><th>Qtd Descarga</th>
                    <th>Valor Unit.</th><th>Total</th><th>Perda</th>
                </tr></thead>
                <tbody>${htmlItens}</tbody>
            </table>

            ${l.observacoes ? `<div class="detalhe-obs"><strong>Observações</strong><br>${escapeHtml(l.observacoes)}</div>` : ''}

            ${l.anexos && l.anexos.length > 0 ? `
            <div class="detalhe-obs">
                <strong>Anexos (${l.anexos.length})</strong><br>${anexosHtml}
            </div>` : ''}

            ${l.logs && l.logs.length > 0 ? `
            <div class="detalhe-obs">
                <strong>Histórico de Alterações</strong>
                <ul class="log-list">${l.logs.map(log => {
                    // Suporta log novo (objeto {acao, ts, usuario}) e log antigo (string)
                    if (typeof log === 'object' && log !== null) {
                        const data = new Date(log.ts).toLocaleString('pt-BR');
                        const usuario = log.usuario && log.usuario !== '—' ? ` — ${escapeHtml(log.usuario)}` : '';
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
            </div>` : ''}

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
/** O período do Relatório em texto, com a base: vai no cabeçalho do PDF e
 *  do Excel. O período desta tela é pela data de emissão (rodada 11). */
function _descricaoPeriodoRelatorio() {
    const ini = document.getElementById("filtroDataInicio")?.value || "";
    const fim = document.getElementById("filtroDataFim")?.value || "";
    return ini && fim ? `emissão de ${formatarData(ini)} a ${formatarData(fim)}`
         : ini ? `emissão a partir de ${formatarData(ini)}`
         : fim ? `emissão até ${formatarData(fim)}`
         : "todas as datas de emissão";
}

function exportarExcel(contexto) {
    // Exportação leva só o que conta: um Excel não tem "riscado"
    // confiável, e uma linha morta numa planilha vira soma errada na
    // primeira vez que alguém arrastar o mouse por cima dela.
    const dados = dadosRelatorioValidos;
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
    // Cabeçalho do período, como no PDF: sem ele, a planilha não dizia de
    // que intervalo nem de que data eram as notas (rodada 11).
    linhas.unshift(
        [`Relatório — ${_descricaoPeriodoRelatorio()}`],
        [`${empresaFiltroGlobal ? empresaFiltroGlobal + " · " : ""}Gerado em ${formatarData(_hojeISO())}`],
        []
    );
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatorio");
    XLSX.writeFile(wb, `controle-combustivel-${contexto}-${_hojeISO()}.xlsx`);
}

// ========== PDF EXPANDIDO ==========
/**
 * Exporta os dados filtrados para PDF usando jsPDF + autoTable.
 * Configurações visuais lidas de `db.configRelatorio` (margens, fonte,
 * cor de destaque, logo por empresa, quebra por mês, etc.).
 *
 * A logo da empresa ativa é resolvida na ordem:
 *   1. `db.configRelatorio.logos[empresaFiltroGlobal].url` (base64 reduzido)
 *   2. `db.configRelatorio.logo` (base64 legado)
 *   3. Sem logo
 *
 * @param {'relatorio'} contexto - Rótulo usado no nome do arquivo
 * @returns {Promise<void>}
 */
async function exportarPDF(contexto) {
    const dados = dadosRelatorioValidos;
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
    // ── Logo da empresa ativa ──
    // Sempre um data URI: o projeto não usa Firebase Storage, então a logo é
    // reduzida e gravada como base64 no próprio documento (ver sistema.js).
    // jsPDF não aceita URL remota, então isso também simplifica o desenho.
    cfg.logo = logoDaEmpresa(empresaFiltroGlobal)?.url || cfg.logo || null;

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

    // O cabeçalho diz o período e de que data ele é. Antes dizia só
    // "Relatório — Gerado em", e quem recebia o PDF — o contador — não sabia
    // se aquilo era o mês inteiro, parte dele ou tudo (rodada 11).
    const tituloCtx = `${contexto === 'relatorio' ? 'Relatório' : 'Histórico'} — ${_descricaoPeriodoRelatorio()}`;

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

    const totalGeral  = dados.reduce((s, l) => s + (l.total || 0), 0);
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
        // Agrupa pela mesma data que filtrou: a emissão. Agrupar pela descarga
        // abria, no PDF de agosto, uma seção de setembro com a nota emitida
        // em 30/08 e descarregada em 01/09.
        const _dataRef = dataEmissaoDe;
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

            let startY = desenharCabecalho(`${tituloCtx} — ${nomeMes(mes)}, pela emissão`);
            const subTotLitros = lans.reduce((s, l) => s + l.itens.reduce((ss, i) => ss + _litrosItem(i), 0), 0);
            const subTotGeral  = lans.reduce((s, l) => s + (l.total || 0), 0);

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

    doc.save(`controle-combustivel-${contexto}-${_hojeISO()}.pdf`);
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
    a.download = `controle-combustivel-${contexto}-${_hojeISO()}.csv`;
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
    const lista = dadosRelatorioValidos;
    if (!lista || lista.length === 0) { mostrarToast("Não há dados para compartilhar.", "aviso", 4000); return; }
    const totalGeral = lista.reduce((s, l) => s + (l.total || 0), 0);
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
    const lista = dadosRelatorioValidos;
    if (!lista || lista.length === 0) { mostrarToast("Não há dados para compartilhar.", "aviso", 4000); return; }
    const totalGeral = lista.reduce((s, l) => s + (l.total || 0), 0);
    const dataHoje   = new Date().toLocaleDateString("pt-BR");
    const assunto    = `Controle de Combustível — ${dataHoje}`;
    // Um `mailto:` não é canal de transporte: o Windows e o Chrome truncam
    // a URL na casa dos 2.000 caracteres, **sem erro nenhum**. Um filtro de
    // mês com algumas centenas de notas passava de 70 mil, e o cliente de
    // e-mail abria com a mensagem cortada no meio — ou não abria.
    //
    // O corte é por tamanho medido, não por contagem de notas: linha de
    // nota varia muito (nome de motorista, base, observação), e um número
    // fixo ora desperdiça espaço, ora estoura. Quem quer a lista inteira
    // tem Excel, PDF e CSV ao lado.
    const LIMITE_URL = 1900;

    const cabecalho = `Controle de Entradas de Combustível\nData: ${dataHoje}\n`
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
            `O e-mail leva ${cabem} de ${lista.length} notas — o resto não cabe num link `
            + `de e-mail. Para mandar tudo, anexe o Excel ou o PDF.`, "aviso", 7000);
    }
    window.location.href = montarURL(corpo);
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
                O mês é o da <strong>data de emissão</strong> das notas.
            </p>
            <div class="campo" style="margin-bottom:8px">
                <label for="_selMesRelMensal">Mês de referência</label>
                <select id="_selMesRelMensal" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)">
                    ${opcoes.join('')}
                </select>
            </div>
            <div class="campo" style="margin-bottom:20px">
                <label for="_nomeEmpresaRel">Nome do posto / empresa (cabeçalho)</label>
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

    // O Relatório Mensal Gerencial monta o próprio conjunto e é o único
    // ponto desta tela que não passa por `dadosRelatorioAtual` — por isso
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
    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);

    const totalNotas  = lansMes.length;
    const totalLitros = lansMes.reduce((s,l) => s + l.itens.reduce((ss,i) => ss+_litrosItem(i),0), 0);
    const totalGasto  = lansMes.reduce((s,l) => s + (l.total || 0), 0);
    const custoMedio  = totalLitros > 0 ? totalGasto/totalLitros : 0;
    const totLitrosAnt = lansAnterior.reduce((s,l) => s + l.itens.reduce((ss,i) => ss+_litrosItem(i),0), 0);
    const totGastoAnt  = lansAnterior.reduce((s,l) => s + (l.total || 0), 0);

    doc.setFillColor(...azul);
    doc.rect(0, 0, W, 28, 'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text(empresa, 14, 11);
    doc.setFontSize(10); doc.setFont('helvetica','normal');
    doc.text('Relatório Mensal de Entradas de Combustível', 14, 18);
    doc.setFontSize(9);
    doc.text(`Período: ${nomeMes(mes)}, pela data de emissão   |   Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, 24);

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
        const sorted = [...lansMes].sort((a,b) => dataEmissaoDe(a).localeCompare(dataEmissaoDe(b)));
        doc.autoTable({
            head: [['Emissão','NF','Base','Empresa','Motorista','Placa','Litros','Total']],
            body: sorted.map(l => {
                const litros = l.itens.reduce((s,i) => s+_litrosItem(i), 0);
                return [
                    formatarData(dataEmissaoDe(l)), l.numeroNota,
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
        if (!dadosRelatorioValidos || dadosRelatorioValidos.length === 0) {
            mostrarToast('Nenhum lançamento no período para exportar.', 'aviso', 4000);
            return;
        }
        exportarPDF('relatorio');
    }, 300);
}
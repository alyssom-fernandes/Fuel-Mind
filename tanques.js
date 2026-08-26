/*=================================================
  TANQUES.JS — Cadastro de Tanques com Histórico
  v1.1 — Fuel Mind
  FIX: alert() de validação substituídos por mostrarToast

  Estrutura em db.tanques[]:
  {
    id: "timestamp-hash",
    nome: "Tanque 1",
    capacidadeLitros: 80000,
    capacidadeFiltro: 1200,
    compartimentos: [
      {
        id: "comp-hash",
        nome: "Compartimento A",
        capacidade: 40000,
        historicoCombustivel: [
          { data: "YYYY-MM-DD", combustivel: "Diesel S-10" }
        ]
      }
    ],
    ativo: true,
    logs: ["Criado em ..."]
  }
=================================================*/

/* ─── GARANTIA DE ESTRUTURA ─── */
function garantirTanques() {
    if (!db.tanques) {
        db.tanques = [];
    }
}

/* ─── HELPERS ─── */

/**
 * Retorna o combustível ativo em um compartimento numa determinada data.
 * Se data não informada, usa hoje.
 */
function combustivelDoCompartimentoNaData(comp, dataConsulta) {
    if (!comp.historicoCombustivel || comp.historicoCombustivel.length === 0) return null;
    const ref = dataConsulta || new Date().toISOString().slice(0, 10);
    const entradas = comp.historicoCombustivel
        .filter(h => h.data <= ref)
        .sort((a, b) => b.data.localeCompare(a.data));
    return entradas[0]?.combustivel || null;
}

/**
 * Retorna a capacidade total (tanque + filtro) de um combustível em uma data.
 * Soma capacidades de todos os compartimentos de tanques ativos que tinham
 * aquele combustível na data informada.
 */
/**
 * Retorna a capacidade total (compartimentos + filtro) de todos os tanques
 * ativos que continham o combustível informado na data de consulta.
 *
 * Para cada tanque ativo, percorre seus compartimentos e chama
 * `combustivelDoCompartimentoNaData` para verificar qual combustível estava
 * ativo naquela data. Se o compartimento bater com `nomeCombustivel`, soma
 * sua capacidade. Se ao menos um compartimento do tanque bater, soma também
 * a `capacidadeFiltro` do tanque (rateada uma vez por tanque).
 *
 * @param {string} nomeCombustivel - Nome do combustível conforme cadastro
 *                                   (ex: "Diesel S-10")
 * @param {string} [dataConsulta]  - Data de consulta no formato "YYYY-MM-DD".
 *                                   Se omitida, usa a data de hoje.
 * @returns {number} Capacidade total em litros (0 se nenhum tanque ativo
 *                   tiver esse combustível na data)
 */
function capacidadeTotalCombustivel(nomeCombustivel, dataConsulta) {
    garantirTanques();
    const ref = dataConsulta || new Date().toISOString().slice(0, 10);
    let totalLitros = 0;
    db.tanques.filter(t => t.ativo !== false).forEach(tanque => {
        tanque.compartimentos.forEach(comp => {
            const comb = combustivelDoCompartimentoNaData(comp, ref);
            if (comb === nomeCombustivel) {
                totalLitros += (comp.capacidade || 0);
            }
        });
        const tanqueTempoComb = tanque.compartimentos.some(
            comp => combustivelDoCompartimentoNaData(comp, ref) === nomeCombustivel
        );
        if (tanqueTempoComb) {
            totalLitros += (tanque.capacidadeFiltro || 0);
        }
    });
    return totalLitros;
}

/* ─── RENDER PRINCIPAL ─── */
function carregarTanques() {
    garantirTanques();
    renderListaTanques();
}

function renderListaTanques() {
    garantirTanques();
    const container = document.getElementById('listaTanquesContainer');
    if (!container) return;

    const hoje = new Date().toISOString().slice(0, 10);
    const tanquesAtivos = db.tanques.filter(t => t.ativo !== false);
    const mostrarInativos = document.getElementById('mostrarInativosTanques')?.checked;
    const lista = mostrarInativos ? db.tanques : tanquesAtivos;

    if (lista.length === 0) {
        container.innerHTML = `<p class="dica">Nenhum tanque cadastrado ainda. Use o formulário acima para adicionar.</p>`;
        return;
    }

    container.innerHTML = lista.map(tanque => {
        const inatClass = tanque.ativo === false ? 'inativo' : '';
        const totalCapacidade = tanque.compartimentos.reduce((s, c) => s + (c.capacidade || 0), 0);

        const compsHTML = tanque.compartimentos.map((comp, idx) => {
            const combAtual = combustivelDoCompartimentoNaData(comp, hoje);
            const histHTML = (comp.historicoCombustivel || [])
                .slice().reverse()
                .map(h => `<li class="tanque-hist-item">
                    <span class="tanque-hist-data">${formatarData(h.data)}</span>
                    <span class="tanque-hist-comb">${h.combustivel}</span>
                </li>`).join('');

            return `
            <div class="tanque-compartimento ${inatClass}">
                <div class="tanque-comp-header">
                    <strong>${comp.nome || ('Compartimento ' + (idx + 1))}</strong>
                    <span class="badge-capacidade">${fmtL(comp.capacidade || 0)}</span>
                    <span class="badge-comb-atual ${combAtual ? '' : 'sem-comb'}">${combAtual || 'Sem combustível'}</span>
                    <div class="tanque-comp-acoes">
                        <button class="btn-secundario" onclick="abrirModalTrocarCombustivel('${tanque.id}','${comp.id}')">Trocar combustível</button>
                        ${tanque.compartimentos.length > 1
                            ? `<button class="btn-excluir" onclick="excluirCompartimento('${tanque.id}','${comp.id}')">Remover</button>`
                            : ''}
                    </div>
                </div>
                ${histHTML ? `<ul class="tanque-hist-list">${histHTML}</ul>` : '<p class="dica" style="margin:4px 0 0">Nenhum combustível atribuído ainda.</p>'}
            </div>`;
        }).join('');

        const filtroInfo = tanque.capacidadeFiltro > 0
            ? `<span class="badge-filtro">+ ${fmtL(tanque.capacidadeFiltro)} (filtro)</span>`
            : '';

        return `
        <div class="tanque-card ${inatClass}" id="tanque-card-${tanque.id}">
            <div class="tanque-card-header">
                <div class="tanque-card-titulo">
                    <strong>${tanque.nome}</strong>
                    ${tanque.ativo === false ? '<em class="tag-inativo">inativo</em>' : ''}
                    <span class="badge-capacidade-total">${fmtL(totalCapacidade)} total ${filtroInfo}</span>
                </div>
                <div class="tanque-card-acoes">
                    <button class="btn-secundario" onclick="abrirModalEditarTanque('${tanque.id}')">Editar</button>
                    <button class="btn-secundario" onclick="adicionarCompartimento('${tanque.id}')">+ Compartimento</button>
                    <button class="btn-inativar" onclick="toggleAtivoTanque('${tanque.id}')">${tanque.ativo !== false ? 'Inativar' : 'Reativar'}</button>
                    <button class="btn-excluir" onclick="excluirTanque('${tanque.id}')">Excluir</button>
                </div>
            </div>
            <div class="tanque-compartimentos">
                ${compsHTML}
            </div>
            ${tanque.logs && tanque.logs.length > 0 ? `
            <details class="tanque-logs">
                <summary>Histórico de alterações (${tanque.logs.length})</summary>
                <ul>${tanque.logs.map(l => `<li>${l}</li>`).join('')}</ul>
            </details>` : ''}
        </div>`;
    }).join('');
}

/* ─── FORMULÁRIO NOVO TANQUE ─── */
function renderFormNovoTanque() {
    const container = document.getElementById('formNovoTanqueContainer');
    if (!container) return;

    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);
    const hoje = new Date().toISOString().slice(0, 10);

    container.innerHTML = `
    <div class="form-novo-tanque">
        <h3>Novo Tanque</h3>
        <div class="filtros" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">
            <div class="campo">
                <label>Nome / Número do Tanque *</label>
                <input type="text" id="novoTanqueNome" placeholder="Ex: Tanque 1, TQ-01">
            </div>
            <div class="campo">
                <label>Capacidade do Filtro (L)</label>
                <input type="number" id="novoTanqueFiltro" placeholder="Ex: 1200" min="0" step="1" value="0">
            </div>
        </div>
        <div id="novoTanqueCompartimentos">
            <div class="tanque-comp-form" data-idx="0">
                <div class="filtros" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-top:12px;">
                    <div class="campo">
                        <label>Nome do Compartimento</label>
                        <input type="text" placeholder="Ex: A, Principal (opcional)" class="comp-nome">
                    </div>
                    <div class="campo">
                        <label>Capacidade (L) *</label>
                        <input type="number" placeholder="Ex: 80000" min="0" step="1" class="comp-capacidade">
                    </div>
                    <div class="campo">
                        <label>Combustível inicial</label>
                        <select class="comp-combustivel">
                            <option value="">-- Selecionar --</option>
                            ${combustiveis.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('')}
                        </select>
                    </div>
                    <div class="campo">
                        <label>Data início</label>
                        <input type="date" class="comp-data" value="${hoje}">
                    </div>
                </div>
            </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
            <button class="btn-secundario" onclick="adicionarLinhaCompartimentoForm()">+ Compartimento</button>
            <button class="btn-primario" onclick="salvarNovoTanque()">Salvar Tanque</button>
        </div>
    </div>`;
}

function adicionarLinhaCompartimentoForm() {
    const container = document.getElementById('novoTanqueCompartimentos');
    if (!container) return;
    const idx = container.querySelectorAll('.tanque-comp-form').length;
    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);
    const hoje = new Date().toISOString().slice(0, 10);

    const div = document.createElement('div');
    div.className = 'tanque-comp-form';
    div.dataset.idx = idx;
    div.innerHTML = `
        <div class="filtros" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-top:8px;">
            <div class="campo">
                <label>Nome do Compartimento</label>
                <input type="text" placeholder="Ex: B (opcional)" class="comp-nome">
            </div>
            <div class="campo">
                <label>Capacidade (L) *</label>
                <input type="number" placeholder="Ex: 40000" min="0" step="1" class="comp-capacidade">
            </div>
            <div class="campo">
                <label>Combustível inicial</label>
                <select class="comp-combustivel">
                    <option value="">-- Selecionar --</option>
                    ${combustiveis.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('')}
                </select>
            </div>
            <div class="campo">
                <label>Data início</label>
                <input type="date" class="comp-data" value="${hoje}">
            </div>
            <div class="campo" style="display:flex;align-items:flex-end;">
                <button class="btn-excluir" onclick="this.closest('.tanque-comp-form').remove()">Remover</button>
            </div>
        </div>`;
    container.appendChild(div);
}

function salvarNovoTanque() {
    garantirTanques();
    const nome = document.getElementById('novoTanqueNome')?.value.trim();
    const filtro = parseFloat(document.getElementById('novoTanqueFiltro')?.value) || 0;

    if (!nome) {
        mostrarToast('Digite o nome do tanque.', 'erro', 4000);
        return;
    }
    if (db.tanques.some(t => t.nome.toLowerCase() === nome.toLowerCase())) {
        mostrarToast('Já existe um tanque com esse nome.', 'erro', 4000);
        return;
    }

    const linhasComp = document.querySelectorAll('#novoTanqueCompartimentos .tanque-comp-form');
    const compartimentos = [];
    let erro = false;

    linhasComp.forEach((linha, idx) => {
        if (erro) return;
        const capStr = linha.querySelector('.comp-capacidade')?.value;
        const cap = parseFloat(capStr);
        if (!capStr || isNaN(cap) || cap <= 0) {
            mostrarToast(`Compartimento ${idx + 1}: informe a capacidade em litros.`, 'erro', 4000);
            erro = true;
            return;
        }
        const nomeComp = linha.querySelector('.comp-nome')?.value.trim() || '';
        const comb = linha.querySelector('.comp-combustivel')?.value || '';
        const data = linha.querySelector('.comp-data')?.value || new Date().toISOString().slice(0, 10);

        compartimentos.push({
            id: gerarId(),
            nome: nomeComp,
            capacidade: cap,
            historicoCombustivel: comb ? [{ data, combustivel: comb }] : []
        });
    });

    if (erro || compartimentos.length === 0) return;

    const novoTanque = {
        id: gerarId(),
        nome,
        capacidadeFiltro: filtro,
        compartimentos,
        ativo: true,
        logs: [`Criado em ${new Date().toLocaleString('pt-BR')}`]
    };

    db.tanques.push(novoTanque);
    salvarDB();
    mostrarToast(`Tanque "${nome}" cadastrado com sucesso!`, 'sucesso');
    renderFormNovoTanque();
    renderListaTanques();
}

/* ─── EDITAR TANQUE (nome, filtro e data inicial dos compartimentos) ─── */
function abrirModalEditarTanque(tanqueId) {
    garantirTanques();
    const tanque = db.tanques.find(t => t.id === tanqueId);
    if (!tanque) return;

    const overlay = document.getElementById('tanqueModalOverlay');
    if (!overlay) return;

    const compsHTML = tanque.compartimentos.map((comp, idx) => {
        const primeiroRegistro = comp.historicoCombustivel && comp.historicoCombustivel.length > 0
            ? [...comp.historicoCombustivel].sort((a, b) => a.data.localeCompare(b.data))[0]
            : null;
        const dataInicial = primeiroRegistro?.data || '';
        const combInicial = primeiroRegistro?.combustivel || '—';
        return `
        <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;background:var(--surface-alt);">
            <div style="font-size:0.78rem;font-weight:700;color:var(--text-light);margin-bottom:8px;">
                ${comp.nome ? `Compartimento: ${comp.nome}` : `Compartimento ${idx + 1}`}
                <span style="font-weight:400;color:var(--text-muted);"> — ${fmtL(comp.capacidade || 0)} — ${combInicial}</span>
            </div>
            <div class="campo">
                <label>Data de início do combustível</label>
                <input type="date" class="edit-comp-data" data-comp-id="${comp.id}" value="${dataInicial}"
                    title="Data em que ${combInicial} passou a estar neste compartimento">
            </div>
        </div>`;
    }).join('');

    overlay.innerHTML = `
    <div class="modal" style="max-width:500px;">
        <div class="modal-header"><h3>Editar Tanque</h3></div>
        <div class="modal-corpo">
            <div class="campo" style="margin-bottom:12px;">
                <label>Nome / Número</label>
                <input type="text" id="editTanqueNome" value="${tanque.nome}">
            </div>
            <div class="campo" style="margin-bottom:16px;">
                <label>Capacidade do Filtro (L)</label>
                <input type="number" id="editTanqueFiltro" value="${tanque.capacidadeFiltro || 0}" min="0" step="1">
            </div>
            ${tanque.compartimentos.length > 0 ? `
            <div style="font-size:0.8rem;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">
                Data inicial por compartimento
            </div>
            ${compsHTML}
            <p class="dica" style="margin-top:4px;">Alterar a data inicial afeta o cálculo de capacidade para datas anteriores.</p>` : ''}
        </div>
        <div class="modal-acoes">
            <button class="btn-primario" onclick="confirmarEditarTanque('${tanqueId}')">Salvar</button>
            <button class="btn-secundario" onclick="fecharTanqueModal()">Cancelar</button>
        </div>
    </div>`;
    overlay.style.display = 'flex';
}

function confirmarEditarTanque(tanqueId) {
    garantirTanques();
    const tanque = db.tanques.find(t => t.id === tanqueId);
    if (!tanque) return;

    const novoNome = document.getElementById('editTanqueNome')?.value.trim();
    const novoFiltro = parseFloat(document.getElementById('editTanqueFiltro')?.value) || 0;

    if (!novoNome) {
        mostrarToast('O nome não pode ficar vazio.', 'erro', 4000);
        return;
    }
    if (db.tanques.some(t => t.id !== tanqueId && t.nome.toLowerCase() === novoNome.toLowerCase())) {
        mostrarToast('Já existe outro tanque com esse nome.', 'erro', 4000);
        return;
    }

    if (tanque.nome !== novoNome) {
        if (!tanque.logs) tanque.logs = [];
        tanque.logs.push(`Nome alterado de "${tanque.nome}" para "${novoNome}" em ${new Date().toLocaleString('pt-BR')}`);
        tanque.nome = novoNome;
    }
    if (tanque.capacidadeFiltro !== novoFiltro) {
        if (!tanque.logs) tanque.logs = [];
        tanque.logs.push(`Filtro alterado de ${tanque.capacidadeFiltro || 0} L para ${novoFiltro} L em ${new Date().toLocaleString('pt-BR')}`);
        tanque.capacidadeFiltro = novoFiltro;
    }

    // Atualizar datas iniciais dos compartimentos
    document.querySelectorAll('.edit-comp-data').forEach(input => {
        const compId = input.dataset.compId;
        const novaData = input.value;
        if (!novaData) return;
        const comp = tanque.compartimentos.find(c => c.id === compId);
        if (!comp || !comp.historicoCombustivel || comp.historicoCombustivel.length === 0) return;
        const sorted = [...comp.historicoCombustivel].sort((a, b) => a.data.localeCompare(b.data));
        const primeiro = sorted[0];
        if (primeiro.data !== novaData) {
            if (!tanque.logs) tanque.logs = [];
            tanque.logs.push(`${comp.nome || 'Compartimento'}: data inicial alterada de ${formatarData(primeiro.data)} para ${formatarData(novaData)} em ${new Date().toLocaleString('pt-BR')}`);
            const idx = comp.historicoCombustivel.findIndex(h => h.data === primeiro.data && h.combustivel === primeiro.combustivel);
            if (idx !== -1) comp.historicoCombustivel[idx].data = novaData;
            comp.historicoCombustivel.sort((a, b) => a.data.localeCompare(b.data));
        }
    });

    fecharTanqueModal();
    salvarDB();
    renderListaTanques();
    mostrarToast('Tanque atualizado.', 'sucesso');
}

/* ─── ADICIONAR COMPARTIMENTO A TANQUE EXISTENTE ─── */
function adicionarCompartimento(tanqueId) {
    garantirTanques();
    const tanque = db.tanques.find(t => t.id === tanqueId);
    if (!tanque) return;
    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);
    const hoje = new Date().toISOString().slice(0, 10);

    const overlay = document.getElementById('tanqueModalOverlay');
    if (!overlay) return;

    overlay.innerHTML = `
    <div class="modal" style="max-width:480px;">
        <div class="modal-header"><h3>Adicionar Compartimento — ${tanque.nome}</h3></div>
        <div class="modal-corpo">
            <div class="campo" style="margin-bottom:12px;">
                <label>Nome do Compartimento (opcional)</label>
                <input type="text" id="novoCompNome" placeholder="Ex: B, Secundário">
            </div>
            <div class="campo" style="margin-bottom:12px;">
                <label>Capacidade (L) *</label>
                <input type="number" id="novoCompCapacidade" placeholder="Ex: 40000" min="0" step="1">
            </div>
            <div class="campo" style="margin-bottom:12px;">
                <label>Combustível inicial</label>
                <select id="novoCompCombustivel">
                    <option value="">-- Selecionar --</option>
                    ${combustiveis.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('')}
                </select>
            </div>
            <div class="campo" style="margin-bottom:12px;">
                <label>Data de início</label>
                <input type="date" id="novoCompData" value="${hoje}">
            </div>
        </div>
        <div class="modal-acoes">
            <button class="btn-primario" onclick="confirmarAdicionarCompartimento('${tanqueId}')">Adicionar</button>
            <button class="btn-secundario" onclick="fecharTanqueModal()">Cancelar</button>
        </div>
    </div>`;
    overlay.style.display = 'flex';
}

function confirmarAdicionarCompartimento(tanqueId) {
    garantirTanques();
    const tanque = db.tanques.find(t => t.id === tanqueId);
    if (!tanque) return;

    const nome = document.getElementById('novoCompNome')?.value.trim() || '';
    const capStr = document.getElementById('novoCompCapacidade')?.value;
    const cap = parseFloat(capStr);
    const comb = document.getElementById('novoCompCombustivel')?.value || '';
    const data = document.getElementById('novoCompData')?.value || new Date().toISOString().slice(0, 10);

    if (!capStr || isNaN(cap) || cap <= 0) {
        mostrarToast('Informe a capacidade do compartimento.', 'erro', 4000);
        return;
    }

    tanque.compartimentos.push({
        id: gerarId(),
        nome,
        capacidade: cap,
        historicoCombustivel: comb ? [{ data, combustivel: comb }] : []
    });
    if (!tanque.logs) tanque.logs = [];
    tanque.logs.push(`Compartimento "${nome || ('Compartimento ' + tanque.compartimentos.length)}" adicionado em ${new Date().toLocaleString('pt-BR')}`);

    fecharTanqueModal();
    salvarDB();
    renderListaTanques();
    mostrarToast('Compartimento adicionado.', 'sucesso');
}

/* ─── TROCAR COMBUSTÍVEL ─── */
function abrirModalTrocarCombustivel(tanqueId, compId) {
    garantirTanques();
    const tanque = db.tanques.find(t => t.id === tanqueId);
    if (!tanque) return;
    const comp = tanque.compartimentos.find(c => c.id === compId);
    if (!comp) return;

    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);
    const hoje = new Date().toISOString().slice(0, 10);
    const combAtual = combustivelDoCompartimentoNaData(comp, hoje);

    const overlay = document.getElementById('tanqueModalOverlay');
    if (!overlay) return;

    overlay.innerHTML = `
    <div class="modal" style="max-width:440px;">
        <div class="modal-header"><h3>Trocar Combustível — ${tanque.nome}${comp.nome ? ' / ' + comp.nome : ''}</h3></div>
        <div class="modal-corpo">
            ${combAtual ? `<p style="margin-bottom:12px;">Combustível atual: <strong>${combAtual}</strong></p>` : '<p style="margin-bottom:12px;color:var(--warning);">Nenhum combustível atribuído ainda.</p>'}
            <div class="campo" style="margin-bottom:12px;">
                <label>Novo Combustível *</label>
                <select id="trocaCombustivel">
                    <option value="">-- Selecionar --</option>
                    ${combustiveis.map(c => `<option value="${c.nome}" ${c.nome === combAtual ? 'selected' : ''}>${c.nome}</option>`).join('')}
                </select>
            </div>
            <div class="campo" style="margin-bottom:12px;">
                <label>Data da troca *</label>
                <input type="date" id="trocaData" value="${hoje}">
            </div>
            <p class="dica">O histórico anterior será preservado. A troca valerá a partir da data informada.</p>
        </div>
        <div class="modal-acoes">
            <button class="btn-primario" onclick="confirmarTrocarCombustivel('${tanqueId}','${compId}')">Confirmar Troca</button>
            <button class="btn-secundario" onclick="fecharTanqueModal()">Cancelar</button>
        </div>
    </div>`;
    overlay.style.display = 'flex';
}

async function confirmarTrocarCombustivel(tanqueId, compId) {
    garantirTanques();
    const tanque = db.tanques.find(t => t.id === tanqueId);
    if (!tanque) return;
    const comp = tanque.compartimentos.find(c => c.id === compId);
    if (!comp) return;

    const novoComb = document.getElementById('trocaCombustivel')?.value;
    const data = document.getElementById('trocaData')?.value;

    if (!novoComb) {
        mostrarToast('Selecione o novo combustível.', 'erro', 4000);
        return;
    }
    if (!data) {
        mostrarToast('Informe a data da troca.', 'erro', 4000);
        return;
    }

    const existente = comp.historicoCombustivel.find(h => h.data === data);
    if (existente) {
        if (!await fmConfirm({ titulo: `Já existe registro para ${formatarData(data)}`, msg: "Deseja substituir o registro existente?", confirmTxt: "Substituir", tipo: "aviso" })) return;
        existente.combustivel = novoComb;
    } else {
        comp.historicoCombustivel.push({ data, combustivel: novoComb });
        comp.historicoCombustivel.sort((a, b) => a.data.localeCompare(b.data));
    }

    if (!tanque.logs) tanque.logs = [];
    tanque.logs.push(`${comp.nome || 'Compartimento'}: combustível trocado para "${novoComb}" em ${formatarData(data)} (registrado em ${new Date().toLocaleString('pt-BR')})`);

    fecharTanqueModal();
    salvarDB();
    renderListaTanques();
    mostrarToast(`Combustível atualizado para "${novoComb}".`, 'sucesso');
}

/* ─── EXCLUIR COMPARTIMENTO ─── */
async function excluirCompartimento(tanqueId, compId) {
    garantirTanques();
    const tanque = db.tanques.find(t => t.id === tanqueId);
    if (!tanque) return;
    const comp = tanque.compartimentos.find(c => c.id === compId);
    if (!comp) return;
    if (!await fmConfirm({ titulo: `Remover compartimento "${comp.nome || 'sem nome'}"?`, msg: `Tanque: ${tanque.nome}\n\nO histórico deste compartimento será perdido.`, confirmTxt: "Remover", tipo: "perigo" })) return;
    tanque.compartimentos = tanque.compartimentos.filter(c => c.id !== compId);
    if (!tanque.logs) tanque.logs = [];
    tanque.logs.push(`Compartimento "${comp.nome || 'sem nome'}" removido em ${new Date().toLocaleString('pt-BR')}`);
    salvarDB();
    renderListaTanques();
    mostrarToast('Compartimento removido.', 'info');
}

/* ─── INATIVAR / REATIVAR TANQUE ─── */
async function toggleAtivoTanque(tanqueId) {
    garantirTanques();
    const tanque = db.tanques.find(t => t.id === tanqueId);
    if (!tanque) return;
    const acao = tanque.ativo !== false ? 'inativar' : 'reativar';
    if (!await fmConfirm({ titulo: `${acao.charAt(0).toUpperCase()+acao.slice(1)} tanque "${tanque.nome}"?`, confirmTxt: acao.charAt(0).toUpperCase()+acao.slice(1), tipo: "aviso" })) return;
    tanque.ativo = tanque.ativo !== false ? false : true;
    if (!tanque.logs) tanque.logs = [];
    tanque.logs.push(`${acao === 'inativar' ? 'Inativado' : 'Reativado'} em ${new Date().toLocaleString('pt-BR')}`);
    salvarDB();
    renderListaTanques();
    mostrarToast(`Tanque "${tanque.nome}" ${acao === 'inativar' ? 'inativado' : 'reativado'}.`, 'info');
}

/* ─── EXCLUIR TANQUE ─── */
async function excluirTanque(tanqueId) {
    garantirTanques();
    const tanque = db.tanques.find(t => t.id === tanqueId);
    if (!tanque) return;
    if (!await fmConfirm({ titulo: `Excluir tanque "${tanque.nome}"?`, msg: "Todo o histórico será perdido.\n\nEsta ação não pode ser desfeita.", confirmTxt: "Excluir", tipo: "perigo" })) return;
    db.tanques = db.tanques.filter(t => t.id !== tanqueId);
    salvarDB();
    renderListaTanques();
    mostrarToast(`Tanque "${tanque.nome}" excluído.`, 'info');
}

/* ─── MODAL UTILITÁRIO ─── */
function fecharTanqueModal() {
    const overlay = document.getElementById('tanqueModalOverlay');
    if (overlay) overlay.style.display = 'none';
}

document.addEventListener('click', function(e) {
    const overlay = document.getElementById('tanqueModalOverlay');
    if (overlay && e.target === overlay) fecharTanqueModal();
});

/* ─── RESUMO DE CAPACIDADE POR COMBUSTÍVEL (para uso no estoque) ─── */
function renderResumoCpacidadeTanques(dataConsulta) {
    const container = document.getElementById('resumoCapacidadeTanques');
    if (!container) return;
    garantirTanques();

    const ref = dataConsulta || new Date().toISOString().slice(0, 10);
    const combustiveis = db.combustiveis.filter(c => c.ativo !== false);

    const rows = combustiveis.map(c => {
        const cap = capacidadeTotalCombustivel(c.nome, ref);
        return cap > 0 ? `<tr><td>${c.nome}</td><td><strong>${fmtL(cap)}</strong></td></tr>` : '';
    }).filter(Boolean).join('');

    container.innerHTML = rows
        ? `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
               <thead><tr><th style="text-align:left;">Combustível</th><th style="text-align:left;">Capacidade Total (tanques + filtros)</th></tr></thead>
               <tbody>${rows}</tbody>
           </table>`
        : `<p class="dica">Nenhum tanque com combustível cadastrado para ${formatarData(ref)}.</p>`;
}
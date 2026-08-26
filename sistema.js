/*=================================================
  SISTEMA.JS – Backup, restauração, auditoria,
  correção em massa, tema, config PDF
  + Aba de Importação integrada
  + Aba de Conferência vs AutoSystem (item 3)
  v2: config PDF expandida — logo (upload base64),
      margens, cor de destaque, fonte, quebra por mês,
      rodapé customizável
=================================================*/

/* ========== ABAS DO SISTEMA ========== */
let sistemaAbaAtiva = 'backup';

function trocarAbaSistema(aba, btn) {
    sistemaAbaAtiva = aba;
    document.querySelectorAll('#sistemaAbas .aba-btn').forEach(b => b.classList.remove('ativa'));
    if (btn) btn.classList.add('ativa');
    document.querySelectorAll('.sistema-aba-conteudo').forEach(el => el.style.display = 'none');
    const conteudo = document.getElementById(`sistemaAba-${aba}`);
    if (conteudo) conteudo.style.display = 'block';
    if (aba === 'backup') { atualizarInfoSistema(); carregarConfiguracoesTela(); }
    if (aba === 'conferencia') { _conferenciaInicializar(); }
}

/* ========== BACKUP ========== */
function baixarBackup() {
    const json = JSON.stringify(db, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const data = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `backup-combustivel-${data}.json`;
    a.click(); URL.revokeObjectURL(url);
    mostrarToast("Backup baixado com sucesso!", "sucesso");
}

/* ========== RESTAURAR BACKUP ========== */
async function restaurarBackup(input) {
    const file = input.files[0];
    if (!file) return;

    try {
        const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });

        const dados = JSON.parse(text);
        if (!Array.isArray(dados.motoristas) || !Array.isArray(dados.veiculos) ||
            !Array.isArray(dados.empresas)   || !Array.isArray(dados.combustiveis) ||
            !Array.isArray(dados.lancamentos)) {
            throw new Error("Arquivo não é um backup válido deste sistema.");
        }

        if (!await fmConfirm({ 
            titulo: "Restaurar backup?", 
            msg: `• ${dados.motoristas.length} motoristas\n• ${dados.veiculos.length} veículos\n• ${dados.empresas.length} empresas\n• ${dados.combustiveis.length} combustíveis\n• ${dados.lancamentos.length} lançamentos\n\nOs dados atuais serão substituídos.`, 
            confirmTxt: "Restaurar", 
            tipo: "perigo" 
        })) return;

        if (typeof _unsubscribeListener !== 'undefined' && _unsubscribeListener) {
            _unsubscribeListener(); _unsubscribeListener = null;
        }
        db = _mesclarComPadrao(dados);
        salvarDB(); 
        migrarDados(); 
        atualizarListas(); 
        atualizarInfoSistema(); 
        carregarConfiguracoesTela();
        if (window._firestore && typeof _ligarListenerTempoReal === 'function') _ligarListenerTempoReal();
        mostrarToast("Backup restaurado com sucesso!", "sucesso");
    } catch (err) { 
        mostrarToast("Erro ao restaurar backup: " + err.message, "erro", 6000); 
    }
    input.value = "";
}

/* ========== RESET SEGURO ========== */
async function resetSeguro() {
    if (!await fmConfirm({ titulo: "Apagar todos os dados?", msg: "Esta ação apagará TODOS os dados permanentemente.\n\nRecomendamos fazer um backup antes de continuar.", confirmTxt: "Continuar", cancelTxt: "Cancelar", tipo: "perigo" })) return;
    if (!await fmConfirm({ titulo: "Última confirmação", msg: "Todos os lançamentos, motoristas, veículos, empresas e combustíveis serão apagados.\n\nTem CERTEZA que deseja apagar tudo?", confirmTxt: "Apagar tudo", cancelTxt: "Cancelar", tipo: "perigo" })) return;

    if (typeof _unsubscribeListener !== 'undefined' && _unsubscribeListener) {
        _unsubscribeListener(); _unsubscribeListener = null;
    }
    db = {
        motoristas: [], veiculos: [], empresas: [], combustiveis: [],
        lancamentos: [], bases: [], medicoes: {}, estoqueInicial: {},
        estoqueEmpresas: {}, taxasFrete: {}, configRelatorio: db.configRelatorio
    };
    salvarDB(); atualizarListas(); atualizarInfoSistema();
    if (window._firestore && typeof _ligarListenerTempoReal === 'function') _ligarListenerTempoReal();
    mostrarToast("Sistema resetado. Todos os dados foram apagados.", "aviso", 5000);
}

/* ========== BACKUPS AUTOMÁTICOS ========== */
function renderBackupsAuto() {
    const el = document.getElementById("listaBackupsAuto");
    if (!el) return;
    const lista = listarBackupsAutomaticos();
    if (lista.length === 0) {
        el.innerHTML = `<p class="dica" style="margin:0">Nenhum backup automático encontrado ainda. O próximo será criado em até 3 dias.</p>`;
        return;
    }
    el.innerHTML = `
        <table style="width:100%;font-size:0.84rem;border-collapse:collapse;margin-top:4px">
            <thead><tr style="background:var(--surface-alt)">
                <th style="padding:7px 12px;text-align:left;font-size:0.64rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-light)">Data</th>
                <th style="padding:7px 12px;text-align:left;font-size:0.64rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-light)">Tamanho</th>
                <th style="padding:7px 12px;text-align:left;font-size:0.64rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-light)">Ação</th>
            </tr></thead>
            <tbody>
                ${lista.map(b => `<tr style="border-bottom:1px solid var(--border-light)">
                    <td style="padding:8px 12px">${b.data}</td>
                    <td style="padding:8px 12px;color:var(--text-muted);font-family:monospace">${b.tamanhoKB} KB</td>
                    <td style="padding:8px 12px"><button class="btn-secundario" onclick="restaurarBackupAutomatico('${b.chave}')">Restaurar</button></td>
                </tr>`).join("")}
            </tbody>
        </table>`;
}

/* ========== INFORMAÇÕES DO SISTEMA ========== */
function atualizarInfoSistema() {
    const el = document.getElementById("infoSistema");
    if (!el) return;
    const tamanhoKB = (JSON.stringify(db).length / 1024).toFixed(1);
    el.innerHTML = `
        <div class="info-card"><div class="info-card-valor">${db.lancamentos.length}</div><div class="info-card-label">Lançamentos</div></div>
        <div class="info-card"><div class="info-card-valor">${db.motoristas.length}</div><div class="info-card-label">Motoristas</div></div>
        <div class="info-card"><div class="info-card-valor">${db.veiculos.length}</div><div class="info-card-label">Veículos</div></div>
        <div class="info-card"><div class="info-card-valor">${db.empresas.length}</div><div class="info-card-label">Empresas</div></div>
        <div class="info-card"><div class="info-card-valor">${db.combustiveis.length}</div><div class="info-card-label">Combustíveis</div></div>
        <div class="info-card"><div class="info-card-valor">${tamanhoKB} KB</div><div class="info-card-label">Tamanho dos Dados</div></div>
    `;
    renderBackupsAuto();
}

/* ========== AUDITORIA DE DATAS SUSPEITAS ========== */
function auditarDatas() {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const suspeitos = db.lancamentos.filter(l => {
        const dtNota = new Date(l.dataNota + 'T00:00:00');
        const dtDesc = l.dataDescarga ? new Date(l.dataDescarga + 'T00:00:00') : null;
        const diffDias = (dtDesc && dtNota) ? Math.round((dtDesc - dtNota) / 86400000) : 0;
        return dtNota > hoje || (dtDesc && dtDesc > hoje) || diffDias > 30;
    });

    if (suspeitos.length === 0) {
        mostrarToast('Nenhum lançamento com data suspeita encontrado.', 'sucesso', 4000); return;
    }

    const modal = document.createElement('div');
    modal.id = '_modalAuditoria';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px;`;
    modal.innerHTML = `
        <div style="background:var(--surface);border-radius:12px;width:90%;max-width:800px;max-height:90vh;overflow-y:auto;box-shadow:var(--shadow-lg);padding:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="margin:0">Lançamentos com datas suspeitas</h3>
                <button onclick="this.closest('#_modalAuditoria').remove()" style="border:none;background:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted)">✕</button>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                <thead><tr><th>Nota</th><th>Data Nota</th><th>Data Descarga</th><th>Problema</th><th></th></tr></thead>
                <tbody>
                    ${suspeitos.map(l => {
                        const dtNota = new Date(l.dataNota + 'T00:00:00');
                        const dtDesc = l.dataDescarga ? new Date(l.dataDescarga + 'T00:00:00') : null;
                        const diffDias = (dtDesc && dtNota) ? Math.round((dtDesc - dtNota) / 86400000) : 0;
                        const problema = [];
                        if (dtNota > hoje) problema.push('Nota futura');
                        if (dtDesc && dtDesc > hoje) problema.push('Descarga futura');
                        if (diffDias > 30) problema.push(`Descarga ${diffDias} dias após nota`);
                        return `<tr>
                            <td>${l.numeroNota}</td><td>${formatarData(l.dataNota)}</td>
                            <td>${l.dataDescarga ? formatarData(l.dataDescarga) : '—'}</td>
                            <td style="color:var(--danger);">${problema.join(', ')}</td>
                            <td><button class="btn-secundario" onclick="irParaLancamento('${l.id}');document.getElementById('_modalAuditoria').remove()">Ver</button></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
                <button class="btn-secundario" onclick="document.getElementById('_modalAuditoria').remove()">Fechar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

/* ========== CORREÇÃO EM MASSA ========== */
let campoCorrecaoAtual = '';
let modalCorrecaoMassa = null;

function corrigirCampoEmMassa(campo) {
    campoCorrecaoAtual = campo;
    let titulo, lista = [];
    switch(campo) {
        case 'empresa':    titulo = 'Corrigir Empresa';     lista = db.empresas.filter(e=>e.ativo!==false).map(e=>e.nome);     break;
        case 'motorista':  titulo = 'Corrigir Motorista';   lista = db.motoristas.filter(m=>m.ativo!==false).map(m=>m.nome);   break;
        case 'placa':      titulo = 'Corrigir Placa';       lista = db.veiculos.filter(v=>v.ativo!==false).map(v=>v.nome);     break;
        case 'base':       titulo = 'Corrigir Base';        lista = db.bases.filter(b=>b.ativo!==false).map(b=>b.nome);        break;
        case 'combustivel':titulo = 'Corrigir Combustível'; lista = db.combustiveis.filter(c=>c.ativo!==false).map(c=>c.nome); break;
        default: mostrarToast('Campo inválido para correção.', 'aviso'); return;
    }
    if (lista.length === 0) { mostrarToast(`Nenhum ${campo} cadastrado. Cadastre pelo menos um antes de corrigir.`, 'aviso', 5000); return; }

    const modal = document.createElement('div');
    modal.id = 'modalCorrecaoMassa';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;
    modal.innerHTML = `
        <div style="background:var(--surface);border-radius:12px;padding:28px;max-width:500px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3)">
            <h3 style="margin:0 0 8px">${titulo}</h3>
            <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:20px">
                Substituirá o campo <strong>${campo}</strong> em todos os lançamentos que corresponderem ao filtro.
            </p>
            <div class="campo" style="margin-bottom:16px">
                <label>Novo valor</label>
                <select id="correcaoMassaSelect" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)">
                    ${lista.map(val => `<option value="${val}">${val}</option>`).join('')}
                </select>
            </div>
            <div class="campo" style="margin-bottom:16px">
                <label>Substituir apenas lançamentos com este valor antigo (deixe vazio para todos)</label>
                <input type="text" id="correcaoMassaAntigo" placeholder="Ex: Posto Antigo"
                    style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);box-sizing:border-box">
            </div>
            <div id="correcaoMassaPreview" style="font-size:0.85rem;color:var(--text-muted);margin-bottom:16px;padding:8px;background:var(--surface-alt);border-radius:6px;"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button onclick="fecharModalCorrecaoMassa()" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);cursor:pointer">Cancelar</button>
                <button onclick="executarCorrecaoMassa()" style="padding:8px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:600">Aplicar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modalCorrecaoMassa = modal;
    atualizarPreviewCorrecao();
    document.getElementById('correcaoMassaSelect').addEventListener('change', atualizarPreviewCorrecao);
    document.getElementById('correcaoMassaAntigo').addEventListener('input', atualizarPreviewCorrecao);
}

function atualizarPreviewCorrecao() {
    const select  = document.getElementById('correcaoMassaSelect');
    const antigo  = document.getElementById('correcaoMassaAntigo')?.value.trim() || '';
    const preview = document.getElementById('correcaoMassaPreview');
    if (!select || !preview) return;
    const novo = select.value;
    let count = 0;
    if (campoCorrecaoAtual === 'combustivel') {
        db.lancamentos.forEach(l => { l.itens.forEach(i => { if ((!antigo || i.tipo === antigo) && i.tipo !== novo) count++; }); });
    } else {
        db.lancamentos.forEach(l => { const v = l[campoCorrecaoAtual]; if ((!antigo || v === antigo) && v !== novo) count++; });
    }
    preview.textContent = count > 0 ? `${count} lançamento(s) serão atualizados` : 'Nenhum lançamento corresponde ao filtro';
}

function fecharModalCorrecaoMassa() {
    if (modalCorrecaoMassa) { modalCorrecaoMassa.remove(); modalCorrecaoMassa = null; }
}

function executarCorrecaoMassa() {
    const select = document.getElementById('correcaoMassaSelect');
    const antigo = document.getElementById('correcaoMassaAntigo')?.value.trim() || '';
    if (!select) return;
    const novo = select.value;
    let count = 0;
    if (campoCorrecaoAtual === 'combustivel') {
        db.lancamentos.forEach(l => { l.itens.forEach(i => { if ((!antigo || i.tipo === antigo) && i.tipo !== novo) { i.tipo = novo; count++; } }); });
    } else {
        db.lancamentos.forEach(l => { const v = l[campoCorrecaoAtual]; if ((!antigo || v === antigo) && v !== novo) { l[campoCorrecaoAtual] = novo; count++; } });
    }
    salvarDB(); fecharModalCorrecaoMassa();
    mostrarToast(`${count} lançamento(s) atualizados com ${campoCorrecaoAtual} = "${novo}".`, 'sucesso', 6000);
}

/* ========================================
   CONFIGURAÇÕES DE PDF — EXPANDIDO
   Campos: titulo, logo (base64), orientacao, fonte,
           corDestaque, margemEsq, margemDir, margemTopo, margemRodape,
           mostrarBase, mostrarEmpresa, mostrarMotorista, mostrarPlaca,
           quebrarPorMes, rodapeTexto
======================================== */

/**
 * Retorna a empresa ativa para configuração de logo.
 * Usa empresaFiltroGlobal se disponível.
 */
function _pdfEmpresaAtiva() {
    return (typeof empresaFiltroGlobal !== 'undefined' && empresaFiltroGlobal)
        ? empresaFiltroGlobal
        : (db.empresas?.find(e => e.ativo !== false)?.nome || '_global');
}

/**
 * Chamado pelo input[type=file] do logo.
 * Faz upload para Firebase Storage e salva a URL em db.configRelatorio.logos[empresa].
 */
async function pdfCarregarLogo(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        mostrarToast('Selecione um arquivo de imagem (PNG, JPG, etc.).', 'aviso'); return;
    }
    if (file.size > 2 * 1024 * 1024) {
        mostrarToast('Imagem muito grande. Use uma imagem menor que 2 MB.', 'aviso'); return;
    }

    const btn = document.getElementById('pdfLogoBtnSelecionar');
    if (btn) mostrarSpinner(btn, 'Selecionar imagem');

    try {
        const empresa = _pdfEmpresaAtiva();

        // Excluir logo anterior do Storage se existir
        const logoAntigo = db.configRelatorio?.logos?.[empresa];
        if (logoAntigo?.caminho) {
            await window._firestore.storageExcluirLogo(logoAntigo.caminho).catch(() => {});
        }

        const resultado = await window._firestore.storageUploadLogo(file, empresa);

        if (!db.configRelatorio) db.configRelatorio = {};
        if (!db.configRelatorio.logos) db.configRelatorio.logos = {};
        db.configRelatorio.logos[empresa] = resultado;

        // Atualiza prévia
        _pdfAtualizarPrevia(resultado.url, empresa);
        salvarDB();
        mostrarToast('Logo salva com sucesso!', 'sucesso', 3000);
    } catch (e) {
        mostrarToast('Erro ao enviar logo: ' + e.message, 'erro', 6000);
    } finally {
        if (btn) esconderSpinner(btn);
        input.value = '';
    }
}

async function pdfRemoverLogo() {
    const empresa = _pdfEmpresaAtiva();
    const logo = db.configRelatorio?.logos?.[empresa];

    if (logo?.caminho) {
        await window._firestore.storageExcluirLogo(logo.caminho).catch(() => {});
    }

    if (!db.configRelatorio) db.configRelatorio = {};
    if (!db.configRelatorio.logos) db.configRelatorio.logos = {};
    delete db.configRelatorio.logos[empresa];

    _pdfAtualizarPrevia(null, empresa);
    salvarDB();
    mostrarToast('Logo removida.', 'info', 2000);
}

function _pdfAtualizarPrevia(urlOuBase64, empresa) {
    const preview     = document.getElementById('pdfLogoPreview');
    const placeholder = document.getElementById('pdfLogoPlaceholder');
    const btnRemover  = document.getElementById('pdfLogoBtnRemover');
    const labelEmpresa = document.getElementById('pdfLogoEmpresaLabel');

    if (labelEmpresa) labelEmpresa.textContent = empresa ? `Logo — ${empresa}` : 'Logo';

    if (urlOuBase64) {
        if (preview)     { preview.src = urlOuBase64; preview.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
        if (btnRemover)  btnRemover.style.display = 'inline-flex';
    } else {
        if (preview)     { preview.src = ''; preview.style.display = 'none'; }
        if (placeholder) placeholder.style.display = 'flex';
        if (btnRemover)  btnRemover.style.display = 'none';
    }
}

function salvarConfigPDF() {
    if (!db.configRelatorio) db.configRelatorio = {};

    db.configRelatorio.titulo           = document.getElementById('pdfTitulo')?.value || 'Controle de Entradas de Combustível';
    db.configRelatorio.orientacao       = document.getElementById('pdfOrientacao')?.value || 'landscape';
    db.configRelatorio.fonte            = document.getElementById('pdfFonte')?.value || 'helvetica';
    db.configRelatorio.corDestaque      = document.getElementById('pdfCorDestaque')?.value || '#1a3a5c';
    db.configRelatorio.margemEsq        = parseFloat(document.getElementById('pdfMargemEsq')?.value) || 14;
    db.configRelatorio.margemDir        = parseFloat(document.getElementById('pdfMargemDir')?.value) || 14;
    db.configRelatorio.margemTopo       = parseFloat(document.getElementById('pdfMargemTopo')?.value) || 14;
    db.configRelatorio.margemRodape     = parseFloat(document.getElementById('pdfMargemRodape')?.value) || 10;
    db.configRelatorio.mostrarBase      = document.getElementById('pdfMostrarBase')?.checked ?? true;
    db.configRelatorio.mostrarEmpresa   = document.getElementById('pdfMostrarEmpresa')?.checked ?? true;
    db.configRelatorio.mostrarMotorista = document.getElementById('pdfMostrarMotorista')?.checked ?? true;
    db.configRelatorio.mostrarPlaca     = document.getElementById('pdfMostrarPlaca')?.checked ?? true;
    db.configRelatorio.quebrarPorMes    = document.getElementById('pdfQuebrarPorMes')?.checked ?? false;
    db.configRelatorio.rodapeTexto      = document.getElementById('pdfRodapeTexto')?.value || '';
    // logo já salvo ao carregar via pdfCarregarLogo()

    salvarDB();
    mostrarToast('Configurações de PDF salvas!', 'sucesso', 3000);
}

function carregarConfiguracoesTela() {
    const cfg = Object.assign({
        titulo: "Controle de Entradas de Combustível",
        logo: null,
        orientacao: "landscape",
        fonte: "helvetica",
        corDestaque: "#1a3a5c",
        margemEsq: 14, margemDir: 14, margemTopo: 14, margemRodape: 10,
        mostrarBase: true, mostrarEmpresa: true, mostrarMotorista: true, mostrarPlaca: true,
        quebrarPorMes: false,
        rodapeTexto: ""
    }, db.configRelatorio || {});

    const f = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (typeof val === 'boolean') el.checked = val;
        else el.value = val;
    };

    f('pdfTitulo',           cfg.titulo);
    f('pdfOrientacao',       cfg.orientacao);
    f('pdfFonte',            cfg.fonte);
    f('pdfCorDestaque',      cfg.corDestaque);
    f('pdfMargemEsq',        cfg.margemEsq);
    f('pdfMargemDir',        cfg.margemDir);
    f('pdfMargemTopo',       cfg.margemTopo);
    f('pdfMargemRodape',     cfg.margemRodape);
    f('pdfMostrarBase',      cfg.mostrarBase);
    f('pdfMostrarEmpresa',   cfg.mostrarEmpresa);
    f('pdfMostrarMotorista', cfg.mostrarMotorista);
    f('pdfMostrarPlaca',     cfg.mostrarPlaca);
    f('pdfQuebrarPorMes',    cfg.quebrarPorMes);
    f('pdfRodapeTexto',      cfg.rodapeTexto);

    // Logo: atualiza prévia com logo da empresa ativa
    const empresa = _pdfEmpresaAtiva();
    const logoEmpresa = db.configRelatorio?.logos?.[empresa];
    // Fallback: logo global legada em base64
    const logoSrc = logoEmpresa?.url || cfg.logo || null;
    _pdfAtualizarPrevia(logoSrc, empresa);

    // Migração automática: se existe logo legada em base64 e ainda não há logos no Storage,
    // converte e faz upload silenciosamente para o Storage
    if (cfg.logo && !logoEmpresa && window._firestore?.storageUploadLogo) {
        _migrarLogoLegada(cfg.logo, empresa);
    }
}

/**
 * Migra a logo legada (base64) para o Firebase Storage silenciosamente.
 * Chamada automaticamente ao abrir configurações se necessário.
 */
async function _migrarLogoLegada(base64, empresa) {
    try {
        // Converte base64 para Blob
        const match    = base64.match(/^data:image\/(\w+);base64,/);
        const mimeType = match ? `image/${match[1]}` : 'image/jpeg';
        const ext      = match ? match[1] : 'jpg';
        const byteStr  = atob(base64.split(',')[1] || base64);
        const arr      = new Uint8Array(byteStr.length);
        for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
        const blob = new Blob([arr], { type: mimeType });
        const file = new File([blob], `logo-migrada.${ext}`, { type: mimeType });

        const resultado = await window._firestore.storageUploadLogo(file, empresa);

        if (!db.configRelatorio) db.configRelatorio = {};
        if (!db.configRelatorio.logos) db.configRelatorio.logos = {};
        db.configRelatorio.logos[empresa] = resultado;
        // Remove o base64 do Firestore após migração bem-sucedida
        db.configRelatorio.logo = null;
        salvarDB();

        // Atualiza a prévia com a URL do Storage
        _pdfAtualizarPrevia(resultado.url, empresa);
        console.info('[Logo] Logo legada migrada para Storage com sucesso.');
    } catch (e) {
        console.warn('[Logo] Falha ao migrar logo legada:', e.message);
        // Mantém o base64 como fallback — não quebra nada
    }
}

/*
  HTML esperado na aba de config PDF (sistemaAba-backup ou similar).
  Adicione este bloco ao index.html dentro da aba de configurações:

  <div class="config-bloco">
    <h4>Configurações de PDF</h4>

    <!-- Logo por empresa -->
    <div class="campo">
      <label id="pdfLogoEmpresaLabel">Logo (cabeçalho do PDF)</label>
      <p class="dica" style="margin-bottom:10px">A logo é salva por empresa. Troque de empresa no header para configurar cada uma.</p>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div id="pdfLogoPlaceholder" style="width:80px;height:80px;border:2px dashed var(--border);border-radius:8px;
             display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem;text-align:center;cursor:pointer"
             onclick="document.getElementById('pdfLogoInput').click()">
          Clique para<br>adicionar logo
        </div>
        <img id="pdfLogoPreview" src="" alt="Logo" style="display:none;max-height:80px;max-width:200px;border-radius:6px;border:1px solid var(--border)">
        <div style="display:flex;flex-direction:column;gap:6px">
          <button id="pdfLogoBtnSelecionar" class="btn-secundario" onclick="document.getElementById('pdfLogoInput').click()">Selecionar imagem</button>
          <button id="pdfLogoBtnRemover" class="btn-excluir" style="display:none" onclick="pdfRemoverLogo()">Remover logo</button>
          <input id="pdfLogoInput" type="file" accept="image/*" style="display:none" onchange="pdfCarregarLogo(this)">
        </div>
        <span class="dica" style="font-size:0.75rem;margin:0">PNG ou JPG, máx. 2 MB.<br>Aparece no canto esquerdo do cabeçalho.</span>
      </div>
    </div>

    <!-- Título e orientação -->
    <div class="form-grid" style="grid-template-columns:1fr auto auto;gap:12px;align-items:end">
      <div class="campo"><label>Título do relatório</label><input type="text" id="pdfTitulo"></div>
      <div class="campo"><label>Orientação</label>
        <select id="pdfOrientacao">
          <option value="landscape">Paisagem</option>
          <option value="portrait">Retrato</option>
        </select>
      </div>
      <div class="campo"><label>Fonte</label>
        <select id="pdfFonte">
          <option value="helvetica">Helvetica</option>
          <option value="courier">Courier</option>
          <option value="times">Times</option>
        </select>
      </div>
    </div>

    <!-- Cor e margens -->
    <div class="form-grid" style="grid-template-columns:auto 1fr 1fr 1fr 1fr;gap:12px;align-items:end">
      <div class="campo"><label>Cor de destaque</label>
        <input type="color" id="pdfCorDestaque" style="height:38px;width:60px;padding:2px;border-radius:6px;border:1px solid var(--border);cursor:pointer">
      </div>
      <div class="campo"><label>Margem esq. (mm)</label><input type="number" id="pdfMargemEsq" min="5" max="40" step="1"></div>
      <div class="campo"><label>Margem dir. (mm)</label><input type="number" id="pdfMargemDir" min="5" max="40" step="1"></div>
      <div class="campo"><label>Margem topo (mm)</label><input type="number" id="pdfMargemTopo" min="5" max="40" step="1"></div>
      <div class="campo"><label>Margem rodapé (mm)</label><input type="number" id="pdfMargemRodape" min="5" max="30" step="1"></div>
    </div>

    <!-- Colunas -->
    <div class="campo">
      <label>Colunas visíveis no PDF</label>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">
        <label class="checkbox-label"><input type="checkbox" id="pdfMostrarBase"> Base</label>
        <label class="checkbox-label"><input type="checkbox" id="pdfMostrarEmpresa"> Empresa</label>
        <label class="checkbox-label"><input type="checkbox" id="pdfMostrarMotorista"> Motorista</label>
        <label class="checkbox-label"><input type="checkbox" id="pdfMostrarPlaca"> Placa</label>
        <label class="checkbox-label"><input type="checkbox" id="pdfQuebrarPorMes"> Quebrar por mês</label>
      </div>
    </div>

    <!-- Rodapé -->
    <div class="campo">
      <label>Texto do rodapé (opcional)</label>
      <input type="text" id="pdfRodapeTexto" placeholder="Ex: Fuel Mind — Uso interno — Confidencial">
    </div>

    <button class="btn-primario" onclick="salvarConfigPDF()">Salvar configurações de PDF</button>
  </div>
*/

/* ========== NAVEGAÇÃO PARA LANÇAMENTO ==========
   irParaLancamento — função canônica definida em ui.js.
   (removida daqui para evitar conflito de versões — ui.js vence por ser carregado depois)
*/

/* ========================================
   CONFERÊNCIA — AUTOSYSTEM + VEEDER ROOT
======================================== */
let _confAbaAtiva = 'autosystem';

function _conferenciaInicializar() { _confMudarSubAba(_confAbaAtiva); }

function _confMudarSubAba(aba) {
    _confAbaAtiva = aba;
    document.querySelectorAll('._conf-sub-btn').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
    document.querySelectorAll('._conf-sub-conteudo').forEach(el => el.style.display = 'none');
    const el = document.getElementById(`_confSub-${aba}`);
    if (el) el.style.display = 'block';
}

/* ── AUTOSYSTEM ── */
let _autoLinhas = [];
let _autoCombustivel = '';

function autosystemLerArquivo(input) {
    const file = input.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx','xls','csv'].includes(ext)) { mostrarToast('Selecione um arquivo .xlsx, .xls ou .csv', 'aviso', 4000); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            let linhas = [];
            if (ext === 'csv') {
                linhas = e.target.result.split(/\r?\n/).filter(l => l.trim())
                    .map(l => { const sep = l.includes(';') ? ';' : ','; return l.split(sep).map(c => c.replace(/^"|"$/g,'').trim()); });
            } else {
                const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: false, raw: true });
                const ws = wb.Sheets[wb.SheetNames[0]];
                // raw:true preserva valores numéricos (litros) sem converter para data.
                // A conversão de serial de data é feita em _autosystemDetectarEProcessar,
                // apenas na coluna de data identificada pelo cabeçalho.
                linhas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
            }
            linhas = linhas.filter(l => l.some(c => String(c||'').trim()));
            if (linhas.length < 2) { mostrarToast('Arquivo vazio.', 'aviso', 4000); input.value = ''; return; }
            _autoLinhas = linhas;
            _autosystemDetectarEProcessar();
            mostrarToast(`"${file.name}" lido com sucesso`, 'sucesso');
        } catch(err) { mostrarToast('Erro ao ler o arquivo: ' + err.message, 'erro', 5000); }
        input.value = '';
    };
    if (ext === 'csv') reader.readAsText(file, 'UTF-8');
    else reader.readAsBinaryString(file);
}

function _autosystemDetectarEProcessar() {
    let idxData = 0, idxEntrada = 3, idxSaidaBombas = 7;
    let cabIdx = -1;
    for (let i = 0; i < Math.min(_autoLinhas.length, 15); i++) {
        const row = _autoLinhas[i];
        const txt = row.map(c => String(c||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''));
        if (txt.some(c => c.includes('entrada')) && txt.some(c => c.includes('data'))) {
            cabIdx = i;
            txt.forEach((c, idx) => {
                if (c === 'data')                            idxData        = idx;
                if (c === 'entrada')                         idxEntrada     = idx;
                if (c.includes('bomba') || c === 'bombas')  idxSaidaBombas = idx;
            });
            break;
        }
    }

    const linhasParaProcessar = cabIdx >= 0 ? _autoLinhas.slice(cabIdx + 1) : _autoLinhas.slice(1);
    const linhasDados = [];
    // Converte serial numérico de data SOMENTE na coluna de data (não afeta colunas de litros)
    const _serialParaData = (v) => {
        const n = typeof v === 'number' ? v : parseFloat(v);
        if (!isNaN(n) && n > 40000 && n < 50000) {
            const d = new Date(Math.round((n - 25569) * 86400000));
            return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
        }
        return String(v || '').trim();
    };
    linhasParaProcessar.forEach(row => {
        const dataRaw = _serialParaData(row[idxData]);
        if (!dataRaw || dataRaw.toLowerCase().includes('total')) return;
        const mData = dataRaw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if (!mData) return;
        const [,d,m,y] = mData;
        const ano = y.length === 2 ? '20'+y : y;
        const data = `${ano}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        const _n = (v) => parseFloat(String(v||'').replace(/\s/g,'').replace(',','.')) || 0;
        linhasDados.push({ data, entrada: _n(row[idxEntrada]), saidaBombas: _n(row[idxSaidaBombas]) });
    });

    if (!linhasDados.length) { mostrarToast('Nenhuma linha de dados encontrada no arquivo.', 'aviso'); return; }
    _autoLinhasDados = linhasDados;
    _autosystemRenderizarConferencia();
}

let _autoLinhasDados = [];

function _autosystemRenderizarConferencia() {
    const container = document.getElementById('_confAutoResultado');
    if (!container) return;
    const empresa = empresaFiltroGlobal || '';
    const combustiveis = db.combustiveis.filter(c => c.ativo !== false).map(c => c.nome);

    container.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">
            <div class="campo" style="min-width:180px">
                <label>Empresa</label>
                <div style="padding:6px 10px;background:rgba(139,34,82,0.08);border:1px solid var(--primary);border-radius:var(--radius-sm);color:var(--primary);font-size:0.85rem;font-weight:600">
                    ${empresa || '(nenhuma selecionada)'}
                </div>
            </div>
            <div class="campo" style="min-width:180px">
                <label>Combustível do relatório</label>
                <select id="_autoSelComb" onchange="_autosystemAtualizarTabela()">
                    <option value="">-- Selecione --</option>
                    ${combustiveis.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
            </div>
        </div>
        <div id="_autoTabelaContainer"></div>`;

    // Detecta o combustível nas primeiras linhas do cabeçalho do arquivo.
    // Ordena do mais específico para o mais genérico (mais palavras = mais específico)
    // para evitar que "Gasolina Comum" bata antes de "Gasolina VP" pelo prefixo "gasolina".
    const combustiveisPorEspecificidade = [...combustiveis].sort((a, b) => b.split(' ').length - a.split(' ').length);
    for (const row of _autoLinhas.slice(0, 10)) {
        const txt = row.join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        for (const c of combustiveisPorEspecificidade) {
            const cn = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
            // Testa cada palavra do nome do combustível (todas devem estar presentes)
            const palavras = cn.split(' ').filter(p => p.length > 2);
            if (palavras.length > 0 && palavras.every(p => txt.includes(p))) {
                const sel = document.getElementById('_autoSelComb');
                if (sel) { sel.value = c; _autosystemAtualizarTabela(); }
                break;
            }
        }
    }
}

function _autosystemAtualizarTabela() {
    const empresa = empresaFiltroGlobal || '';
    const comb    = document.getElementById('_autoSelComb')?.value || '';
    const container = document.getElementById('_autoTabelaContainer');
    if (!container || !comb || !empresa) return;

    const entradasSistema = {};
    db.lancamentos
        .filter(l => l.empresa === empresa && l.itens.some(i => i.tipo === comb))
        .forEach(l => {
            const dRef = l.dataDescarga || l.dataNota;
            if (!dRef) return;
            const litros = l.itens.filter(i => i.tipo === comb)
                .reduce((s,i) => s + ((i.qtdDescargada && i.qtdDescargada > 0) ? i.qtdDescargada : (i.qtd||0)), 0);
            entradasSistema[dRef] = (entradasSistema[dRef] || 0) + litros;
        });

    let totalAutoEntradas = 0, totalSistemaEntradas = 0, diasComDivergencia = 0;
    let totalAutoSaidas = 0, totalSistemaSaidas = 0;
    const linhasEntrada = _autoLinhasDados.map(d => {
        const sistemaVal = entradasSistema[d.data] || 0;
        const diff       = sistemaVal - d.entrada;
        const temDiv     = Math.abs(diff) > 1 && (d.entrada > 0 || sistemaVal > 0);
        if (temDiv) diasComDivergencia++;
        totalAutoEntradas    += d.entrada;
        totalSistemaEntradas += sistemaVal;
        totalAutoSaidas      += d.saidaBombas || 0;
        totalSistemaSaidas   += db.estoqueEmpresas?.[empresa]?.[comb]?.[d.data]?.saida || 0;
        return { ...d, sistemaVal, diff, temDiv };
    });
    const diffTotal      = totalSistemaEntradas - totalAutoEntradas;
    const diffTotalSaida = totalSistemaSaidas - totalAutoSaidas;

    const resumo = `
        <div style="margin-bottom:8px;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted)">Entradas</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px">
            <div class="info-card"><div class="info-card-valor">${fmtL3(totalAutoEntradas)}</div><div class="info-card-label">Entradas AutoSystem</div></div>
            <div class="info-card"><div class="info-card-valor">${fmtL3(totalSistemaEntradas)}</div><div class="info-card-label">Entradas Sistema</div></div>
            <div class="info-card" style="border-left:3px solid ${Math.abs(diffTotal)>1?'var(--danger)':'var(--success)'}">
                <div class="info-card-valor" style="color:${Math.abs(diffTotal)>1?'var(--danger)':'var(--success)'}">
                    ${diffTotal>0?'+':''}${fmtL3(diffTotal)}
                </div><div class="info-card-label">Diferença Entradas</div>
            </div>
            <div class="info-card" style="border-left:3px solid ${diasComDivergencia>0?'var(--warning)':'var(--success)'}">
                <div class="info-card-valor" style="color:${diasComDivergencia>0?'var(--warning)':'var(--success)'}">
                    ${diasComDivergencia}
                </div><div class="info-card-label">Dias com divergência</div>
            </div>
        </div>
        <div style="margin-bottom:8px;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted)">Saídas de Bombas</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px">
            <div class="info-card"><div class="info-card-valor">${fmtL3(totalAutoSaidas)}</div><div class="info-card-label">Saídas AutoSystem</div></div>
            <div class="info-card"><div class="info-card-valor">${fmtL3(totalSistemaSaidas)}</div><div class="info-card-label">Saídas Sistema</div></div>
            <div class="info-card" style="border-left:3px solid ${Math.abs(diffTotalSaida)>1?'var(--danger)':'var(--success)'}">
                <div class="info-card-valor" style="color:${Math.abs(diffTotalSaida)>1?'var(--danger)':'var(--success)'}">
                    ${diffTotalSaida>0?'+':''}${fmtL3(diffTotalSaida)}
                </div><div class="info-card-label">Diferença Saídas</div>
            </div>
        </div>`;

    container.innerHTML = `
        ${resumo}
        <div class="analitico-abas" style="margin-bottom:16px">
            <button class="aba-btn ativa" id="_btnAutoEntradas" onclick="_autoMudarAba('entradas')">Entradas</button>
            <button class="aba-btn" id="_btnAutoSaidas" onclick="_autoMudarAba('saidas')">Saídas de Bombas</button>
        </div>
        <div id="_autoAbaEntradas">
            <p class="dica" style="margin-bottom:10px">
                Comparação entre as entradas registradas no AutoSystem e os lançamentos do sistema.
                ${Math.abs(diffTotal)>1
                    ? `<strong style="color:var(--danger)">Divergência de ${fmtL3(Math.abs(diffTotal))} no total do período.</strong>`
                    : `<strong style="color:var(--success)">Total do período confere.</strong>`}
            </p>
            <div class="tabela-container"><table>
                <thead><tr><th>Data</th><th>Entrada AutoSystem (L)</th><th>Entrada Sistema (L)</th><th>Diferença (L)</th></tr></thead>
                <tbody>
                    ${linhasEntrada.map(l => `
                    <tr style="${l.temDiv?'background:rgba(239,68,68,0.06)':l.entrada===0&&l.sistemaVal===0?'opacity:0.5':''}">
                        <td><strong>${formatarData(l.data)}</strong></td>
                        <td>${l.entrada>0?fmtL3(l.entrada):'—'}</td>
                        <td>${l.sistemaVal>0?fmtL3(l.sistemaVal):'—'}</td>
                        <td>${l.temDiv
                            ? `<span style="color:${l.diff>0?'var(--success)':'var(--danger)'}">${l.diff>0?'+':''}${fmtL3(l.diff)}</span>`
                            : (l.entrada>0||l.sistemaVal>0)?'<span style="color:var(--success)">OK</span>':'—'
                        }</td>
                    </tr>`).join('')}
                    <tr style="font-weight:700;border-top:2px solid var(--border)">
                        <td>TOTAL</td><td>${fmtL3(totalAutoEntradas)}</td><td>${fmtL3(totalSistemaEntradas)}</td>
                        <td style="color:${Math.abs(diffTotal)>1?'var(--danger)':'var(--success)'}">${diffTotal>0?'+':''}${fmtL3(diffTotal)}</td>
                    </tr>
                </tbody>
            </table></div>
        </div>
        <div id="_autoAbaSaidas" style="display:none">
            <p class="dica" style="margin-bottom:10px">Saídas de bombas registradas no AutoSystem por dia.</p>
            <div class="tabela-container"><table>
                <thead><tr><th>Data</th><th>Saída Bombas AutoSystem (L)</th><th>Saída no Estoque do Sistema (L)</th><th>Ação</th></tr></thead>
                <tbody>
                    ${_autoLinhasDados.map(l => {
                        const saidaSistema = db.estoqueEmpresas?.[empresa]?.[comb]?.[l.data]?.saida || 0;
                        const temSaida = saidaSistema > 0;
                        return `<tr>
                            <td><strong>${formatarData(l.data)}</strong></td>
                            <td>${fmtL3(l.saidaBombas)}</td>
                            <td>${temSaida?fmtL3(saidaSistema):'<span style="color:var(--text-muted)">Não lançada</span>'}</td>
                            <td>${!temSaida&&l.saidaBombas>0
                                ?`<button class="btn-primario" style="font-size:0.75rem;padding:4px 10px" onclick="_autoLancarSaida('${empresa}','${comb}','${l.data}',${l.saidaBombas})">↓ Usar este valor</button>`
                                :temSaida?'<span style="color:var(--success);font-size:0.8rem">Lançada</span>':'—'
                            }</td>
                        </tr>`;
                    }).join('')}
                    <tr style="font-weight:700;border-top:2px solid var(--border)">
                        <td>TOTAL</td>
                        <td>${fmtL3(totalAutoSaidas)}</td>
                        <td>${fmtL3(totalSistemaSaidas)}</td>
                        <td style="color:${Math.abs(diffTotalSaida)>1?'var(--danger)':'var(--success)'}">
                            ${diffTotalSaida>0?'+':''}${fmtL3(diffTotalSaida)}
                            ${Math.abs(diffTotalSaida)<=1?'<span style="font-size:0.8rem"> OK</span>':''}
                        </td>
                    </tr>
                </tbody>
            </table></div>
            <div style="margin-top:14px">
                <button class="btn-primario" onclick="_autoLancarTodasSaidas('${empresa}','${comb}')">↓ Lançar todas as saídas não preenchidas</button>
                <span class="dica" style="margin-left:10px;font-size:0.8rem">Só preenche dias sem saída e com mês aberto.</span>
            </div>
        </div>
        <div class="barra-exportacao" style="margin-top:16px">
            <span class="exportacao-titulo">Exportar:</span>
            <button class="btn-export btn-xlsx" onclick="_autoExportarExcel('${comb}')">Excel</button>
        </div>`;

    window._autoMudarAba = (aba) => {
        document.getElementById('_autoAbaEntradas').style.display = aba==='entradas'?'block':'none';
        document.getElementById('_autoAbaSaidas').style.display   = aba==='saidas'?'block':'none';
        document.getElementById('_btnAutoEntradas').classList.toggle('ativa', aba==='entradas');
        document.getElementById('_btnAutoSaidas').classList.toggle('ativa', aba==='saidas');
    };
}

function _autoLancarSaida(empresa, comb, data, valor) {
    if (typeof mesFechado === 'function' && mesFechado(empresa, comb, data.slice(0,7))) {
        mostrarToast(`Mês ${data.slice(0,7)} fechado — não é possível lançar.`, 'aviso'); return;
    }
    if (!db.estoqueEmpresas) db.estoqueEmpresas = {};
    if (!db.estoqueEmpresas[empresa]) db.estoqueEmpresas[empresa] = {};
    if (!db.estoqueEmpresas[empresa][comb]) db.estoqueEmpresas[empresa][comb] = {};
    if (!db.estoqueEmpresas[empresa][comb][data]) db.estoqueEmpresas[empresa][comb][data] = {};
    db.estoqueEmpresas[empresa][comb][data].saida = valor;
    salvarDB(); _autosystemAtualizarTabela();
    mostrarToast(`Saída de ${fmtL3(valor)} L lançada para ${formatarData(data)}.`, 'sucesso');
}

async function _autoLancarTodasSaidas(empresa, comb) {
    if (!await fmConfirm({ titulo: `Lançar saídas Autosystem — ${comb}?`, msg: `Empresa: ${empresa}\n\nSó serão preenchidos dias sem saída e com mês aberto.`, confirmTxt: "Lançar", tipo: "aviso" })) return;
    let count = 0;
    _autoLinhasDados.forEach(l => {
        if (l.saidaBombas <= 0) return;
        if (typeof mesFechado === 'function' && mesFechado(empresa, comb, l.data.slice(0,7))) return;
        const atual = db.estoqueEmpresas?.[empresa]?.[comb]?.[l.data]?.saida || 0;
        if (atual > 0) return;
        if (!db.estoqueEmpresas) db.estoqueEmpresas = {};
        if (!db.estoqueEmpresas[empresa]) db.estoqueEmpresas[empresa] = {};
        if (!db.estoqueEmpresas[empresa][comb]) db.estoqueEmpresas[empresa][comb] = {};
        if (!db.estoqueEmpresas[empresa][comb][l.data]) db.estoqueEmpresas[empresa][comb][l.data] = {};
        db.estoqueEmpresas[empresa][comb][l.data].saida = l.saidaBombas;
        count++;
    });
    if (count === 0) { mostrarToast('Nenhuma saída nova para lançar.', 'info'); return; }
    salvarDB(); _autosystemAtualizarTabela();
    mostrarToast(`${count} saída(s) lançada(s) no estoque.`, 'sucesso');
}

function _autoExportarExcel(comb) {
    const empresa = empresaFiltroGlobal || '';
    const entradasSistema = {};
    db.lancamentos.filter(l => l.empresa===empresa && l.itens.some(i=>i.tipo===comb))
        .forEach(l => {
            const dRef = l.dataDescarga||l.dataNota;
            if (!dRef) return;
            const litros = l.itens.filter(i=>i.tipo===comb).reduce((s,i)=>s+((i.qtdDescargada&&i.qtdDescargada>0)?i.qtdDescargada:(i.qtd||0)),0);
            entradasSistema[dRef] = (entradasSistema[dRef]||0)+litros;
        });
    const wb = XLSX.utils.book_new();
    const rows = [
        ['Data','Entrada AutoSystem (L)','Entrada Sistema (L)','Diferença (L)','Saída Bombas (L)'],
        ..._autoLinhasDados.map(l => { const s=entradasSistema[l.data]||0; return [l.data,l.entrada,s,s-l.entrada,l.saidaBombas]; })
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'AutoSystem');
    XLSX.writeFile(wb, `conferencia-autosystem-${new Date().toISOString().slice(0,10)}.xlsx`);
    mostrarToast('Excel exportado!', 'sucesso');
}

/* ── VEEDER ROOT ── */
let _veederDados = {}; // { "Diesel S-10": [ { data, volume, tanque } ] }

function veederLerArquivo(input) {
    const file = input.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx','xls','csv','txt'].includes(ext)) {
        mostrarToast('Selecione um arquivo .xlsx, .xls, .csv ou .txt', 'aviso', 4000);
        input.value = ''; return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            if (['csv','txt'].includes(ext)) {
                const linhas = e.target.result.split(/\r?\n/).map(l => l.split(/\t|;/));
                _veederProcessar(linhas);
            } else {
                const wb = XLSX.read(e.target.result, { type: 'binary', raw: true });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
                _veederProcessar(linhas);
            }
            mostrarToast(`"${file.name}" lido com sucesso`, 'sucesso');
        } catch(err) {
            mostrarToast('Erro ao ler o arquivo: ' + err.message, 'erro', 5000);
        }
        input.value = '';
    };
    if (['csv','txt'].includes(ext)) reader.readAsText(file, 'UTF-8');
    else reader.readAsBinaryString(file);
}

function _veederNormalizarComb(raw) {
    const n = String(raw).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    if (n.includes('s 10') || n.includes('s-10') || n.includes('s10'))
        return db.combustiveis.find(c => /s.?10/i.test(c.nome))?.nome || 'Diesel S-10';
    if (n.includes('s 500') || n.includes('s-500') || n.includes('s500'))
        return db.combustiveis.find(c => /s.?500/i.test(c.nome))?.nome || 'Diesel S-500';
    if (n.includes('diesel'))
        return db.combustiveis.find(c => c.nome.toLowerCase().includes('diesel'))?.nome || 'Diesel';
    if (n.includes('gasolina') && (n.includes('v') || n.includes('premium') || n.includes('aditi')))
        return db.combustiveis.find(c => /v.?power|vpower|premium|aditi/i.test(c.nome))?.nome || 'Gasolina VP';
    if (n.includes('gasolina') && (n.includes('com') || n.includes('reg')))
        return db.combustiveis.find(c => /comum|regular/i.test(c.nome))?.nome || 'Gasolina Comum';
    if (n.includes('gasolina'))
        return db.combustiveis.find(c => c.nome.toLowerCase().includes('gasolina'))?.nome || 'Gasolina';
    if (n.includes('etanol') || n.includes('alcool') || n.includes('álcool'))
        return db.combustiveis.find(c => /etanol|alcool/i.test(c.nome))?.nome || 'Etanol';
    const match = db.combustiveis.find(c => {
        const cn = c.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        return n.split(' ').some(p => p.length > 2 && cn.includes(p));
    });
    return match?.nome || String(raw).trim();
}

/**
 * Processa linhas do arquivo Veeder-Root.
 * Formato esperado:
 *   "Tank N: NOME DO COMBUSTÍVEL"  →  cabeçalho de tanque
 *   linha de cabeçalho de colunas  →  ignorada (contém "Data", "Volume", "Nivel", "Temp"…)
 *   linhas de dados: col0=data, col1=volume
 */
function _veederLimpar() {
    _veederDados = {};
    const res = document.getElementById('_confVeederResultado');
    if (res) res.innerHTML = '';
    mostrarToast('Leituras Veeder-Root limpas.', 'info');
}

function _veederProcessar(linhas) {
    // NÃO zera _veederDados — acumula dados de múltiplos arquivos (tanque a tanque)
    let tanqueAtual   = '';
    let combAtual     = '';
    let aguardandoCab = false;

    const _serialParaISO = (v) => {
        const n = typeof v === 'number' ? v : parseFloat(v);
        if (!isNaN(n) && n > 40000 && n < 50000) {
            const d = new Date(Math.round((n - 25569) * 86400000));
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
        }
        return null;
    };

    const _parseData = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const iso = _serialParaISO(v);
        if (iso) return iso;
        const s = String(v).trim();
        const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (mISO) return `${mISO[1]}-${mISO[2]}-${mISO[3]}`;
        const mBR = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (mBR) {
            const y = mBR[3].length === 2 ? '20' + mBR[3] : mBR[3];
            return `${y}-${mBR[2].padStart(2,'0')}-${mBR[1].padStart(2,'0')}`;
        }
        return null;
    };

    for (const row of linhas) {
        const cel0 = String(row[0] || '').trim();
        if (!cel0) continue;

        // Detecta "Tank N: NOME DO COMBUSTÍVEL"
        const mTank = cel0.match(/^tank\s*(\d+)\s*:\s*(.+)/i);
        if (mTank) {
            tanqueAtual   = `Tank ${mTank[1]}`;
            combAtual     = _veederNormalizarComb(mTank[2]);
            aguardandoCab = true;
            if (!_veederDados[combAtual]) _veederDados[combAtual] = [];
            continue;
        }

        // Pula linha de cabeçalho de colunas (logo após o Tank)
        if (aguardandoCab) {
            const txt = cel0.toLowerCase();
            if (txt.includes('data') || txt.includes('volume') || txt.includes('nivel') ||
                txt.includes('nível') || txt.includes('temp')) {
                aguardandoCab = false;
                continue;
            }
        }

        if (!combAtual) continue;

        const data = _parseData(row[0]);
        if (!data) continue;

        const volume = parseFloat(String(row[1] || '').replace(/\s/g,'').replace(',','.'));
        if (isNaN(volume) || volume <= 0) continue;

        _veederDados[combAtual].push({ data, volume, tanque: tanqueAtual });
    }

    // Deduplica por tanque+data (mantém último)
    Object.keys(_veederDados).forEach(comb => {
        const visto = new Map();
        _veederDados[comb].forEach(d => visto.set(`${d.tanque}|${d.data}`, d));
        _veederDados[comb] = Array.from(visto.values())
            .sort((a, b) => b.data.localeCompare(a.data) || a.tanque.localeCompare(b.tanque));
    });

    const total = Object.values(_veederDados).reduce((s, v) => s + v.length, 0);
    if (!total) {
        mostrarToast('Nenhuma leitura encontrada. Verifique o formato do arquivo.', 'aviso');
        return;
    }
    _veederRenderizarResultado();
}

function _veederRenderizarResultado() {
    const container = document.getElementById('_confVeederResultado');
    if (!container) return;
    const combsVeeder = Object.keys(_veederDados).filter(c => _veederDados[c].length > 0);
    if (!combsVeeder.length) {
        container.innerHTML = '<p class="dica">Nenhum dado encontrado no arquivo.</p>';
        return;
    }
    const abas = combsVeeder.map((comb, i) => {
        const combEsc = comb.replace(/'/g, "\\'");
        return `<button class="aba-btn ${i===0?'ativa':''}" id="_vdrBtn-${i}" onclick="_vdrMudarAba(${i},'${combEsc}')">${comb}</button>`;
    }).join('');
    container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div class="analitico-abas" style="margin-bottom:0">${abas}</div>
            <button class="btn-secundario" style="font-size:0.78rem;padding:4px 10px;color:var(--danger);border-color:var(--danger)"
                onclick="_veederLimpar()">✕ Limpar leituras</button>
        </div>
        <div id="_vdrConteudo"></div>`;
    window._vdrMudarAba = (idx, comb) => {
        document.querySelectorAll('[id^="_vdrBtn-"]').forEach((b, i) => b.classList.toggle('ativa', i === idx));
        _veederRenderizarComb(comb);
    };
    _veederRenderizarComb(combsVeeder[0]);
}

function _veederRenderizarComb(comb) {
    const container = document.getElementById('_vdrConteudo');
    if (!container) return;
    const empresa  = empresaFiltroGlobal || '';
    const leituras = _veederDados[comb] || [];

    // Tanques presentes neste combustível, ordenados
    const tanques = [...new Set(leituras.map(l => l.tanque))].sort();

    // Total por data = soma de todos os tanques
    const totalPorData = {};
    leituras.forEach(l => { totalPorData[l.data] = (totalPorData[l.data] || 0) + l.volume; });

    // Datas únicas ordenadas descendente
    const datas = [...new Set(leituras.map(l => l.data))].sort((a, b) => b.localeCompare(a));

    const combEsc = comb.replace(/'/g, "\'");

    const semPreenchimento = datas.filter(data => {
        if (typeof mesFechado === 'function' && mesFechado(empresa, comb, data.slice(0, 7))) return false;
        const v = db.estoqueEmpresas?.[empresa]?.[comb]?.[data]?.veeder;
        if (v === null || v === undefined) return true;          // nunca preenchido
        return Math.abs(v - totalPorData[data]) > 0.001;         // preenchido mas diverge do Veeder
    }).length;

    // Totais gerais do período para o rodapé
    const totalGeralVeeder  = Object.values(totalPorData).reduce((s, v) => s + v, 0);
    const totalDiasPreench  = datas.filter(data => db.estoqueEmpresas?.[empresa]?.[comb]?.[data]?.veeder != null).length;
    const totalGeralEstoque = datas.reduce((s, data) => {
        const v = db.estoqueEmpresas?.[empresa]?.[comb]?.[data]?.veeder;
        return s + (v != null ? v : 0);
    }, 0);
    const totalGeralDiff    = totalDiasPreench > 0 ? totalGeralVeeder - totalGeralEstoque : null;

    // Totais por tanque para rodapé
    const totalPorTanque = Object.fromEntries(tanques.map(t => [t, 0]));
    leituras.forEach(l => { totalPorTanque[l.tanque] = (totalPorTanque[l.tanque] || 0) + l.volume; });

    const thTanques = tanques.map(t => `<th>${t}</th>`).join('');

    const linhasHTML = datas.map(data => {
        const veederTotal   = totalPorData[data];
        const veederEstoque = db.estoqueEmpresas?.[empresa]?.[comb]?.[data]?.veeder;
        const jaPreenchido  = veederEstoque !== null && veederEstoque !== undefined;
        const fechado       = typeof mesFechado === 'function' && mesFechado(empresa, comb, data.slice(0, 7));
        const diff          = jaPreenchido ? veederTotal - veederEstoque : null;

        const tdTanques = tanques.map(tanque => {
            const reg = leituras.find(l => l.data === data && l.tanque === tanque);
            return `<td style="font-family:'JetBrains Mono',monospace;font-size:0.82rem">${reg ? fmtL3(reg.volume) : '—'}</td>`;
        }).join('');

        // Tooltip customizado por tanque
        const tipId = `_vdrTip${data.replace(/-/g,'')}`;
        const tipLinhas = tanques.map(t => {
            const r = leituras.find(l => l.data === data && l.tanque === t);
            return `<div style="display:flex;justify-content:space-between;gap:14px">
                <span style="opacity:0.7">${t}</span>
                <span style="font-family:'JetBrains Mono',monospace;font-weight:600">${r ? fmtL3(r.volume) : '—'}</span>
            </div>`;
        }).join('');

        const tooltipHtml = tanques.length > 1 ? `<span style="position:relative;display:inline-block;vertical-align:middle">
            <span style="cursor:help;margin-left:5px;font-size:0.72rem;color:var(--primary);opacity:0.7"
                onmouseenter="document.getElementById('${tipId}').style.display='block'"
                onmouseleave="document.getElementById('${tipId}').style.display='none'">ⓘ</span>
            <div id="${tipId}" style="display:none;position:absolute;top:calc(100% + 6px);left:0;
                background:var(--surface-raised);border:1px solid var(--border);
                border-radius:8px;padding:10px 14px;font-size:0.78rem;white-space:nowrap;z-index:600;
                box-shadow:0 6px 20px rgba(0,0,0,0.3);min-width:170px;pointer-events:none">
                <div style="font-weight:700;margin-bottom:8px;font-size:0.8rem">Leitura por tanque</div>
                ${tipLinhas}
            </div>
        </span>` : '';

        // Estado do dia: sem valor | igual ao Veeder | diverge
        const diverge = jaPreenchido && Math.abs(veederTotal - veederEstoque) > 0.001;
        const igual   = jaPreenchido && !diverge;

        // Coluna "Veeder no Estoque": valor + indicador de estado
        const celulaEstoque = !jaPreenchido
            ? '<span style="color:var(--text-muted)">—</span>'
            : igual
                ? `<span style="font-family:'JetBrains Mono',monospace">${fmtL3(veederEstoque)} <span style="color:var(--success);font-size:0.75rem" title="Idêntico ao Veeder">✓</span></span>`
                : `<span style="font-family:'JetBrains Mono',monospace;color:var(--warning)">${fmtL3(veederEstoque)}</span>`;

        // Coluna "Ação"
        let btnAcao = '—';
        if (!fechado) {
            if (!jaPreenchido) {
                btnAcao = `<button class="btn-secundario" style="font-size:0.73rem;padding:3px 8px"
                    onclick="_veederPreencherUm('${empresa}','${combEsc}','${data}',${veederTotal},${JSON.stringify(Object.fromEntries(tanques.map(t => [t, leituras.find(l=>l.data===data&&l.tanque===t)?.volume||0])))})">↓ Usar total</button>`;
            } else if (diverge) {
                btnAcao = `<button class="btn-secundario" style="font-size:0.73rem;padding:3px 8px;border-color:var(--warning);color:var(--warning)"
                    onclick="_veederPreencherUm('${empresa}','${combEsc}','${data}',${veederTotal},${JSON.stringify(Object.fromEntries(tanques.map(t => [t, leituras.find(l=>l.data===data&&l.tanque===t)?.volume||0])))})">↺ Atualizar</button>`;
            }
            // igual: sem botão — já está correto
        }

        return `<tr style="${fechado ? 'opacity:0.6' : ''}">
            <td><strong>${formatarData(data)}</strong>${fechado ? '' : ''}</td>
            ${tdTanques}
            <td style="font-weight:600;font-family:'JetBrains Mono',monospace;white-space:nowrap">
                ${fmtL3(veederTotal)}${tooltipHtml}
            </td>
            <td>${celulaEstoque}</td>
            <td>${diff !== null
                ? `<span style="color:${Math.abs(diff) > 50 ? 'var(--danger)' : 'var(--success)'}">${diff > 0 ? '+' : ''}${fmtL3(diff)}</span>`
                : (!fechado ? '<span style="color:var(--warning);font-size:0.78rem">Pendente</span>' : '—')
            }</td>
            <td>${btnAcao}</td>
        </tr>`;
    }).join('');

    // Rodapé totais por tanque
    const tfootTanques = tanques.map(t =>
        `<td style="font-family:'JetBrains Mono',monospace;font-size:0.82rem;font-weight:700">${fmtL3(totalPorTanque[t])}</td>`
    ).join('');

    const tfootDiff = totalGeralDiff !== null
        ? `<span style="color:${Math.abs(totalGeralDiff) > 100 ? 'var(--danger)' : 'var(--success)'}">${totalGeralDiff > 0 ? '+' : ''}${fmtL3(totalGeralDiff)}</span>`
        : '<span style="color:var(--text-muted)">—</span>';

    const tfootEstoque = totalDiasPreench > 0
        ? `<span style="font-family:'JetBrains Mono',monospace">${fmtL3(totalGeralEstoque)}</span>`
        : '<span style="color:var(--text-muted)">—</span>';

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:16px">
            <div class="info-card"><div class="info-card-valor">${datas.length}</div><div class="info-card-label">Dias com leitura</div></div>
            <div class="info-card"><div class="info-card-valor">${tanques.length}</div><div class="info-card-label">Tanques</div></div>
            <div class="info-card" style="border-left:3px solid ${semPreenchimento > 0 ? 'var(--warning)' : 'var(--success)'}">
                <div class="info-card-valor" style="color:${semPreenchimento > 0 ? 'var(--warning)' : 'var(--success)'}">${semPreenchimento}</div>
                <div class="info-card-label">Dias pendentes</div>
            </div>
            <div class="info-card" style="border-left:3px solid var(--primary)">
                <div class="info-card-valor" style="font-size:1rem">${fmtL3(totalGeralVeeder)}</div>
                <div class="info-card-label">Total do período (L)</div>
            </div>
        </div>
        <p class="dica" style="margin-bottom:12px">
            Cada coluna mostra o volume por tanque. <strong>Total (L)</strong> = soma de todos os tanques na data — é esse valor que vai para o estoque.
        </p>
        <div style="margin-bottom:12px">
            ${semPreenchimento > 0
                ? `<button class="btn-primario" onclick="_veederPreencherTodos('${empresa}','${combEsc}')">↓ Aplicar Veeder nos pendentes (${semPreenchimento})</button>`
                : '<span style="color:var(--success);font-size:0.85rem">Estoque alinhado com Veeder-Root</span>'}
        </div>
        <div class="tabela-container"><table>
            <thead><tr>
                <th>Data</th>
                ${thTanques}
                <th>Total (L)</th>
                <th>Veeder no Estoque (L)</th>
                <th>Diferença</th>
                <th>Ação</th>
            </tr></thead>
            <tbody>${linhasHTML}</tbody>
            <tfoot><tr style="background:var(--surface-raised);font-weight:700;border-top:2px solid var(--border)">
                <td style="font-size:0.8rem;color:var(--text-muted)">TOTAL</td>
                ${tfootTanques}
                <td style="font-family:'JetBrains Mono',monospace">${fmtL3(totalGeralVeeder)}</td>
                <td>${tfootEstoque}</td>
                <td>${tfootDiff}</td>
                <td></td>
            </tr></tfoot>
        </table></div>`;
}

function _veederPreencherUm(empresa, comb, data, volume, tanques) {
    if (typeof mesFechado === 'function' && mesFechado(empresa, comb, data.slice(0, 7))) {
        mostrarToast(`Mês ${data.slice(0, 7)} está fechado.`, 'aviso'); return;
    }
    if (!db.estoqueEmpresas) db.estoqueEmpresas = {};
    if (!db.estoqueEmpresas[empresa]) db.estoqueEmpresas[empresa] = {};
    if (!db.estoqueEmpresas[empresa][comb]) db.estoqueEmpresas[empresa][comb] = {};
    if (!db.estoqueEmpresas[empresa][comb][data]) db.estoqueEmpresas[empresa][comb][data] = {};
    db.estoqueEmpresas[empresa][comb][data].veeder = volume;
    if (tanques && Object.keys(tanques).length) {
        db.estoqueEmpresas[empresa][comb][data].veederTanques = tanques;
    }
    salvarDB();
    _veederRenderizarComb(comb);
    mostrarToast(`Veeder-Root ${fmtL3(volume)} L preenchido para ${formatarData(data)}.`, 'sucesso');
}

async function _veederPreencherTodos(empresa, comb) {
    const leituras = _veederDados[comb] || [];
    const totalPorData = {};
    leituras.forEach(l => { totalPorData[l.data] = (totalPorData[l.data] || 0) + l.volume; });
    const semPreench = Object.keys(totalPorData).filter(data => {
        if (typeof mesFechado === 'function' && mesFechado(empresa, comb, data.slice(0, 7))) return false;
        const atual = db.estoqueEmpresas?.[empresa]?.[comb]?.[data]?.veeder;
        if (atual === null || atual === undefined) return true;   // sem valor
        return Math.abs(atual - totalPorData[data]) > 0.001;      // diverge do Veeder
    });
    if (!semPreench.length) { mostrarToast('Estoque já está alinhado com o Veeder-Root.', 'sucesso'); return; }
    const vazios    = semPreench.filter(data => db.estoqueEmpresas?.[empresa]?.[comb]?.[data]?.veeder == null).length;
    const divergentes = semPreench.length - vazios;
    const detalhe = [vazios ? `${vazios} sem valor` : '', divergentes ? `${divergentes} com divergência` : ''].filter(Boolean).join(', ');
    if (!await fmConfirm({ titulo: `Aplicar Veeder-Root — ${comb}?`, msg: `${semPreench.length} dia(s) pendentes (${detalhe}).\nEmpresa: ${empresa}\n\nDias com mês fechado são ignorados.`, confirmTxt: 'Aplicar', tipo: 'aviso' })) return;
    semPreench.forEach(data => {
        const tanquesData = Object.fromEntries(
            leituras.filter(l => l.data === data).map(l => [l.tanque, l.volume])
        );
        _veederPreencherUm(empresa, comb, data, totalPorData[data], tanquesData);
    });
    mostrarToast(`${semPreench.length} leitura(s) Veeder-Root preenchida(s) no estoque.`, 'sucesso');
}

function _conferenciaImprimir() { window.print(); }

/* ========== INICIALIZAÇÃO ========== */
document.addEventListener('DOMContentLoaded', () => {
    const telaSistema = document.getElementById('sistema');
    if (telaSistema) {
        const observer = new MutationObserver(() => {
            if (telaSistema.style.display === 'block') {
                const abaAtiva = document.querySelector('#sistemaAbas .aba-btn.ativa');
                const nomeAba  = abaAtiva?.dataset?.aba || 'backup';
                trocarAbaSistema(nomeAba, abaAtiva);
            }
        });
        observer.observe(telaSistema, { attributes: true, attributeFilter: ['style'] });
    }
});

/* ========== CONFIGURAÇÕES DE ALERTAS ========== */
function abrirConfigAlertas() {
    const cfg = configAlertas();
    const modal = document.createElement('div');
    modal.id = '_modalConfigAlertas';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px`;

    const periodOpts = [7,15,30,60,90].map(d=>`<option value="${d}" ${cfg.precoPeriodoDias==d?'selected':''}>${d} dias</option>`).join('');

    modal.innerHTML = `
        <div style="background:var(--surface);border-radius:12px;padding:28px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.3)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <h3 style="margin:0">Configurações de Alertas</h3>
                <button onclick="document.getElementById('_modalConfigAlertas').remove()" style="border:none;background:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>
            </div>

            <div class="_cfg-bloco">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                    <div><strong>Alerta de Preço Alto</strong>
                    <p style="margin:2px 0 0;font-size:0.8rem;color:var(--text-muted)">Avisa quando o preço/L está muito acima da média recente.</p></div>
                    <label class="_cfg-toggle"><input type="checkbox" id="_cfgPrecoAtivo" ${cfg.precoAtivo?'checked':''} onchange="_cfgPreview()"><span class="_cfg-slider"></span></label>
                </div>
                <div id="_cfgPrecoOpts" style="${cfg.precoAtivo?'':'opacity:0.4;pointer-events:none'}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                        <div class="campo"><label>Diferença mínima (R$/L)</label>
                        <input type="number" id="_cfgPrecoDif" value="${cfg['precoDiferencaR$']}" min="0.01" max="5" step="0.01" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                        <div class="campo"><label>Período de referência</label>
                        <select id="_cfgPrecoPer" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" onchange="_cfgPreview()">${periodOpts}</select></div>
                    </div>
                </div>
            </div>

            <div class="_cfg-bloco" style="margin-top:20px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                    <div><strong>Alerta de Volume Suspeito</strong>
                    <p style="margin:2px 0 0;font-size:0.8rem;color:var(--text-muted)">Avisa quando a quantidade está muito acima ou abaixo do habitual.</p></div>
                    <label class="_cfg-toggle"><input type="checkbox" id="_cfgVolAtivo" ${cfg.volumeAtivo?'checked':''} onchange="_cfgPreview()"><span class="_cfg-slider"></span></label>
                </div>
                <div id="_cfgVolOpts" style="${cfg.volumeAtivo?'':'opacity:0.4;pointer-events:none'}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                        <div class="campo"><label>% acima da média histórica</label>
                        <input type="number" id="_cfgVolAcima" value="${cfg.volumeAcimaPerc}" min="10" max="500" step="5" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                        <div class="campo"><label>% abaixo da média histórica</label>
                        <input type="number" id="_cfgVolAbaixo" value="${cfg.volumeAbaixoPerc}" min="10" max="99" step="5" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                    </div>
                </div>
            </div>

            <div class="_cfg-bloco" style="margin-top:20px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                    <div><strong>Alerta de Data Suspeita</strong>
                    <p style="margin:2px 0 0;font-size:0.8rem;color:var(--text-muted)">Avisa quando a data de descarga ou nota parece incorreta.</p></div>
                    <label class="_cfg-toggle"><input type="checkbox" id="_cfgDataAtivo" ${cfg.dataAtivo?'checked':''} onchange="_cfgPreview()"><span class="_cfg-slider"></span></label>
                </div>
                <div id="_cfgDataOpts" style="${cfg.dataAtivo?'':'opacity:0.4;pointer-events:none'}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                        <div class="campo"><label>Tolerância de data futura (dias)</label>
                        <input type="number" id="_cfgDataToler" value="${cfg.dataTolerDias}" min="0" max="30" step="1" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                        <div class="campo"><label>Máx. dias entre nota e descarga</label>
                        <input type="number" id="_cfgDataMaxDiff" value="${cfg.dataMaxDescNota}" min="1" max="90" step="1" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                    </div>
                </div>
            </div>

            <div id="_cfgPreviewTxt" style="margin-top:16px;padding:10px 14px;border-radius:8px;background:var(--surface-alt);font-size:0.82rem;color:var(--text-muted);min-height:36px"></div>

            <div style="display:flex;gap:10px;justify-content:space-between;margin-top:20px">
                <button onclick="_cfgRestaurarPadrao()" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text-muted);cursor:pointer;font-size:0.82rem">Restaurar padrões</button>
                <div style="display:flex;gap:10px">
                    <button onclick="document.getElementById('_modalConfigAlertas').remove()" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);cursor:pointer">Cancelar</button>
                    <button onclick="_cfgSalvar()" style="padding:8px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:600">Salvar configurações</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    ['Preco','Vol','Data'].forEach(nome => {
        const chk=document.getElementById(`_cfg${nome}Ativo`);
        const opts=document.getElementById(`_cfg${nome}Opts`);
        if(chk&&opts) chk.addEventListener('change',()=>{opts.style.opacity=chk.checked?'1':'0.4';opts.style.pointerEvents=chk.checked?'':'none';});
    });
    _cfgPreview();
}

function _cfgPreview() {
    const el=document.getElementById('_cfgPreviewTxt');
    if(!el)return;
    const partes=[];
    if(document.getElementById('_cfgPrecoAtivo')?.checked) {
        const dif=parseFloat(document.getElementById('_cfgPrecoDif')?.value)||0.10;
        const per=document.getElementById('_cfgPrecoPer')?.value||30;
        partes.push(`Preço: avisa se R$${dif.toFixed(2)}/L acima da média dos últimos ${per} dias`);
    }
    if(document.getElementById('_cfgVolAtivo')?.checked) {
        const ac=document.getElementById('_cfgVolAcima')?.value||50;
        const ab=document.getElementById('_cfgVolAbaixo')?.value||50;
        partes.push(`Volume: avisa se >${ac}% acima ou >${ab}% abaixo da média histórica`);
    }
    if(document.getElementById('_cfgDataAtivo')?.checked) {
        const tol=document.getElementById('_cfgDataToler')?.value||0;
        const mx=document.getElementById('_cfgDataMaxDiff')?.value||30;
        partes.push(`Data: avisa se futura (tolerância ${tol} dia(s)) ou descarga >${mx} dias após nota`);
    }
    el.innerHTML=partes.length>0?''+partes.join('<br>'):'Todos os alertas estão desativados.';
}

function _cfgRestaurarPadrao() {
    const p=ALERTAS_CONFIG_PADRAO;
    const f=(id,val)=>{const el=document.getElementById(id);if(el)el[typeof val==='boolean'?'checked':'value']=val;};
    f('_cfgPrecoAtivo',p.precoAtivo); f('_cfgPrecoDif',p['precoDiferencaR$']); f('_cfgPrecoPer',p.precoPeriodoDias);
    f('_cfgVolAtivo',p.volumeAtivo); f('_cfgVolAcima',p.volumeAcimaPerc); f('_cfgVolAbaixo',p.volumeAbaixoPerc);
    f('_cfgDataAtivo',p.dataAtivo); f('_cfgDataToler',p.dataTolerDias); f('_cfgDataMaxDiff',p.dataMaxDescNota);
    ['Preco','Vol','Data'].forEach(nome=>{
        const chk=document.getElementById(`_cfg${nome}Ativo`);
        const opts=document.getElementById(`_cfg${nome}Opts`);
        if(chk&&opts){opts.style.opacity=chk.checked?'1':'0.4';opts.style.pointerEvents=chk.checked?'':'none';}
    });
    _cfgPreview();
}

function _cfgSalvar() {
    const g=(id)=>document.getElementById(id);
    const cfg={
        precoAtivo:g('_cfgPrecoAtivo')?.checked??true,
        'precoDiferencaR$':parseFloat(g('_cfgPrecoDif')?.value)||0.10,
        precoPeriodoDias:parseInt(g('_cfgPrecoPer')?.value)||30,
        volumeAtivo:g('_cfgVolAtivo')?.checked??true,
        volumeAcimaPerc:parseInt(g('_cfgVolAcima')?.value)||50,
        volumeAbaixoPerc:parseInt(g('_cfgVolAbaixo')?.value)||50,
        dataAtivo:g('_cfgDataAtivo')?.checked??true,
        dataTolerDias:parseInt(g('_cfgDataToler')?.value)||0,
        dataMaxDescNota:parseInt(g('_cfgDataMaxDiff')?.value)||30,
    };
    salvarConfigAlertas(cfg);
    document.getElementById('_modalConfigAlertas')?.remove();
    if(typeof carregarDashboard==='function') carregarDashboard();
    mostrarToast('Configurações de alertas salvas!','sucesso',3000);
}

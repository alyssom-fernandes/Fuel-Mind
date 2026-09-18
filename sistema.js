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
    // A aba Backup não existe para o operador (decisão do dono, 17/09/2026).
    if (aba === 'backup' && typeof ehAdminOuSupremoAtual === 'function' && !ehAdminOuSupremoAtual()) {
        aba = 'importar';
        btn = document.querySelector('#sistemaAbas .aba-btn[data-aba="importar"]');
    }
    sistemaAbaAtiva = aba;
    document.querySelectorAll('#sistemaAbas .aba-btn').forEach(b => b.classList.remove('ativa'));
    if (btn) btn.classList.add('ativa');
    document.querySelectorAll('.sistema-aba-conteudo').forEach(el => el.style.display = 'none');
    const conteudo = document.getElementById(`sistemaAba-${aba}`);
    if (conteudo) conteudo.style.display = 'block';
    if (aba === 'backup') {
        atualizarInfoSistema();
        carregarConfiguracoesTela();
        // A migração é operação de supremo — some para os demais.
        const secao = document.getElementById("secaoMigracaoEmpresa");
        if (secao) secao.style.display = window._usuarioAtual?.role === "supremo" ? "block" : "none";
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   MIGRAÇÃO — ISOLAMENTO POR EMPRESA

   Reparte o documento único `dados/principal` em:

     dados/compartilhado   cadastros e configuração
     dados/lanc__{id}      lançamentos de cada empresa

   Por que: regra de segurança avalia o documento inteiro. Enquanto tudo
   morava junto, qualquer usuário autenticado lia os lançamentos de todas
   as empresas — o filtro por empresa na tela era conveniência, não
   barreira.

   O `dados/principal` NÃO é apagado por esta função. Ele permanece como
   rede de segurança; apagá-lo é passo manual, depois de dias estáveis.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Confere se todo lançamento aponta para uma empresa cadastrada.
 * @returns {{ok: boolean, orfaos: Array}}
 */
function _conferirEmpresasDosLancamentos(lancamentos, empresas) {
    const nomes = new Set(empresas.map(e => e.nome));
    const orfaos = lancamentos.filter(l => !l.empresa || !nomes.has(l.empresa));
    return { ok: orfaos.length === 0, orfaos };
}

/**
 * Executa a migração. Só o supremo, e só a partir do layout antigo.
 *
 * A migração recusa se encontrar lançamento sem empresa válida: em vez de
 * inventar um destino, ela lista o que está errado para correção manual.
 * Todo lançamento pertence à empresa selecionada no momento em que foi
 * criado, então órfão aqui significa dado inconsistente, não caso normal.
 */
async function migrarParaIsolamentoPorEmpresa() {
    if (window._usuarioAtual?.role !== "supremo") {
        return mostrarToast("Apenas o usuário supremo pode executar a migração.", "aviso", 5000);
    }
    if (!window._firestore) {
        return mostrarToast("Sem conexão com a nuvem.", "erro", 5000);
    }

    // A migração já feita não roda de novo. Rodá-la depois de dias de uso
    // regravava os documentos novos com o conteúdo antigo, apagando tudo o
    // que foi lançado e cadastrado desde a migração.
    const jaMigrado = await window._firestore.firestoreCarregarDoc("compartilhado").catch(() => "erro");
    if (jaMigrado === "erro") {
        return mostrarToast("Não consegui conferir se a migração já foi feita. Tente de novo.", "erro", 6000);
    }
    if (jaMigrado) {
        return mostrarToast("A migração já foi feita: os dados já estão repartidos por empresa. Nada a fazer.", "info", 7000);
    }

    const antigo = await window._firestore.firestoreCarregarDoc("principal");
    if (!antigo) {
        return mostrarToast("Não há dados no layout antigo — nada a migrar.", "info", 5000);
    }

    const lancamentos = antigo.lancamentos || [];
    const empresas    = antigo.empresas    || [];

    // ── Verificação ANTES de qualquer gravação ──
    const conferencia = _conferirEmpresasDosLancamentos(lancamentos, empresas);
    if (!conferencia.ok) {
        const amostra = conferencia.orfaos.slice(0, 8)
            .map(l => `• Nota ${l.numeroNota || "(sem número)"} — empresa: ${l.empresa || "(vazia)"}`)
            .join("\n");
        const resto = conferencia.orfaos.length > 8
            ? `\n… e mais ${conferencia.orfaos.length - 8}.` : "";
        await fmConfirm({
            titulo: "Migração interrompida",
            msg: `${conferencia.orfaos.length} lançamento(s) não apontam para uma empresa cadastrada. `
               + `Corrija cada um antes de migrar — o destino dele depende da empresa.\n\n${amostra}${resto}`,
            confirmTxt: "Entendi",
            cancelTxt: "Fechar",
            tipo: "aviso"
        });
        console.table(conferencia.orfaos.map(l => ({ nota: l.numeroNota, empresa: l.empresa, data: l.dataNota })));
        return;
    }

    // ── Agrupamento ──
    const porEmpresa = {};
    empresas.forEach(e => { porEmpresa[e.id] = []; });
    lancamentos.forEach(l => {
        const id = empresas.find(e => e.nome === l.empresa).id;
        porEmpresa[id].push(l);
    });

    const resumo = empresas
        .map(e => `• ${e.nome}: ${porEmpresa[e.id].length} lançamento(s)`)
        .join("\n");

    if (!await fmConfirm({
        titulo: "Migrar para isolamento por empresa?",
        msg: `${lancamentos.length} lançamento(s) serão repartidos em ${empresas.length} documento(s):\n\n${resumo}\n\n`
           + `Os cadastros vão para um documento compartilhado. O documento antigo NÃO será apagado.`,
        confirmTxt: "Migrar",
        tipo: "info"
    })) return;

    try {
        // Cadastros primeiro: é ele que dá sentido aos ids dos demais.
        await window._firestore.firestoreSalvarDoc("compartilhado", {
            motoristas:        antigo.motoristas   || [],
            veiculos:          antigo.veiculos     || [],
            empresas:          empresas,
            combustiveis:      antigo.combustiveis || [],
            bases:             antigo.bases        || [],
            conjuntosVeiculos: antigo.conjuntosVeiculos || [],
            configRelatorio:   antigo.configRelatorio  || {}
        });

        for (const e of empresas) {
            await window._firestore.firestoreSalvarDoc(
                window._firestore.docLancamentosNome(e.id),
                { lancamentos: porEmpresa[e.id] }
            );
        }

        // Perfis passam a carregar os ids que as regras vão consultar.
        const usuarios = await window._firestore.usuariosListar();
        let perfisAtualizados = 0;
        for (const u of usuarios) {
            if (u.role === "supremo") continue;
            const ids = (u.empresas || [])
                .map(nome => empresas.find(e => e.nome === nome)?.id)
                .filter(Boolean);
            await window._firestore.usuarioSalvar(u.uid, { empresaIds: ids });
            perfisAtualizados++;
        }

        await fmConfirm({
            titulo: "Migração concluída",
            msg: `${empresas.length} documento(s) de lançamentos criados e ${perfisAtualizados} perfil(is) atualizado(s).\n\n`
               + `Próximo passo: publicar as regras por empresa. Recarregue a página para o app passar a usar o layout novo.`,
            confirmTxt: "Recarregar agora",
            cancelTxt: "Depois",
            tipo: "info"
        }) && window.location.reload();

    } catch (e) {
        console.error("[Migração]", e);
        mostrarToast("Falha na migração: " + e.message + ". O documento antigo continua intacto.", "erro", 9000);
    }
}

/**
 * Confere se o layout novo bate com o antigo, sem gravar nada.
 * Use depois da migração, antes de publicar as regras.
 */
async function conferirMigracao() {
    if (!window._firestore) return mostrarToast("Sem conexão com a nuvem.", "erro", 4000);

    const antigo = await window._firestore.firestoreCarregarDoc("principal");
    if (!antigo) return mostrarToast("Documento antigo não existe mais.", "info", 5000);

    const empresas = antigo.empresas || [];
    const linhas = [];
    let totalNovo = 0;

    for (const e of empresas) {
        const doc = await window._firestore
            .firestoreCarregarDoc(window._firestore.docLancamentosNome(e.id))
            .catch(() => null);
        const n = (doc?.lancamentos || []).length;
        totalNovo += n;
        linhas.push(`• ${e.nome}: ${n}`);
    }

    const totalAntigo = (antigo.lancamentos || []).length;
    // Depois da migração o sistema continua sendo usado, e os documentos
    // novos crescem: ter MAIS notas que o antigo é o esperado. Só faltar
    // nota é problema — e rodar a migração de novo nunca é o remédio.
    const bate = totalNovo >= totalAntigo;

    await fmConfirm({
        titulo: bate ? "Conferência bateu" : "Faltam lançamentos nos documentos novos",
        msg: `Documento antigo: ${totalAntigo} lançamento(s)\n`
           + `Somando os novos: ${totalNovo}\n\n${linhas.join("\n")}\n\n`
           + (bate ? (totalNovo > totalAntigo
                      ? "Os documentos novos têm mais notas que o antigo, o que é normal depois de dias de uso."
                      : "Os números batem.")
                   : "Não rode a migração de novo: ela sobrescreveria o que foi lançado depois. Baixe um backup e peça ajuda para conferir nota por nota."),
        confirmTxt: "Fechar",
        cancelTxt: "Fechar",
        tipo: bate ? "info" : "perigo"
    });
}

/* ========== BACKUP ========== */
function baixarBackup() {
    if (!exigirPapel("admin", "Baixar backup")) return;
    const json = JSON.stringify(db, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const data = _hojeISO();
    a.href = url; a.download = `backup-combustivel-${data}.json`;
    a.click(); URL.revokeObjectURL(url);
    mostrarToast("Backup baixado com sucesso!", "sucesso");
}

/* ========== RESTAURAR BACKUP ========== */
async function restaurarBackup(input) {
    const file = input.files[0];
    if (!file) return;
    if (!exigirPapel("supremo", "Restaurar backup")) { input.value = ""; return; }

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
            msg: _resumoRestauracao(dados),
            confirmTxt: "Restaurar",
            cancelTxt: "Cancelar",
            tipo: "perigo"
        })) { input.value = ""; return; }

        _aplicarBackupNaMemoria(_mesclarComPadrao(dados));
        migrarDados();
        atualizarListas();
        if (typeof _reconciliarEmpresaAtiva === 'function') _reconciliarEmpresaAtiva();
        atualizarInfoSistema();
        carregarConfiguracoesTela();
        _rerenderTelaAtual();
        await _salvarEConfirmar("Backup restaurado");
    } catch (err) {
        mostrarToast("Erro ao restaurar backup: " + err.message, "erro", 6000);
    }
    input.value = "";
}

/* ========== APAGAR TODOS OS DADOS ==========
   Só o supremo (decisão do dono, 17/09/2026). E apaga de verdade: antes,
   os documentos de lançamentos ficavam no servidor, órfãos, porque só a
   lista de empresas era esvaziada — e a cópia local deste navegador era
   destruída mesmo quando a nuvem recusava. Agora os documentos de cada
   empresa são apagados primeiro; só depois os cadastros; e a memória só é
   limpa quando a nuvem confirmou. Os backups automáticos deste navegador
   ficam, como última saída. */
async function resetSeguro() {
    if (!exigirPapel("supremo", "Apagar todos os dados")) return;
    if (!await fmConfirm({ titulo: "Apagar todos os dados?", msg: "Esta ação apagará da nuvem TODOS os lançamentos de todas as empresas e todos os cadastros, permanentemente.\n\nBaixe um backup antes de continuar.", confirmTxt: "Continuar", cancelTxt: "Cancelar", tipo: "perigo" })) return;
    if (!await fmConfirm({ titulo: "Última confirmação", msg: "Todos os lançamentos, motoristas, veículos, empresas, combustíveis, bases e conjuntos serão apagados, para todos os usuários.\n\nTem CERTEZA que deseja apagar tudo?", confirmTxt: "Apagar tudo", cancelTxt: "Cancelar", tipo: "perigo" })) return;

    const limparMemoria = () => {
        db.lancamentos = [];
        _LISTAS_COMPARTILHADO.forEach(c => { db[c] = []; });
    };

    if (typeof demoAtivo === 'function' && demoAtivo()) {
        limparMemoria();
        salvarDB(); atualizarListas(); atualizarInfoSistema(); _rerenderTelaAtual();
        mostrarToast("Dados da demonstração apagados. \"Restaurar dados\" na faixa vermelha os traz de volta.", "aviso", 6000);
        return;
    }
    if (!window._firestore || !_cargaOk || !_layoutNovo) {
        mostrarToast("Sem uma carga confirmada da nuvem não dá para apagar com segurança. Recarregue a página e tente de novo.", "erro", 8000);
        return;
    }

    const ids = (db.empresas || []).map(e => e.id);
    try {
        // Os listeners dos documentos de lançamentos saem antes, para o
        // apagamento não voltar para a memória como "mudança do servidor".
        _desligarListeners();
        for (const id of ids) {
            await window._firestore.firestoreExcluirDoc(_nomeDocLanc(id));
            delete _base[_nomeDocLanc(id)];
        }
        limparMemoria();
        await window._firestore.firestoreGravarMesclando(_NOME_COMPARTILHADO, atual => {
            const d = Object.assign({}, atual || {});
            _LISTAS_COMPARTILHADO.forEach(c => { d[c] = []; });
            return d;
        });
        _base[_NOME_COMPARTILHADO] = _fotografar(_payloadDoc(_NOME_COMPARTILHADO));
        _pendentesLimpar();
        _pendentesSincronizacao = false;
        _gravarCopiaLocal();
        _ligarListenerTempoReal();
        atualizarListas(); atualizarInfoSistema(); _rerenderTelaAtual();
        mostrarToast("Todos os dados foram apagados da nuvem.", "aviso", 6000);
    } catch (e) {
        console.error("[Apagar tudo]", e);
        mostrarToast("Falha ao apagar: " + (e.code || e.message) + ". Recarregue a página para ver o que ficou.", "erro", 10000);
        _ligarListenerTempoReal();
    }
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
                    <td style="padding:8px 12px">${ehSupremoAtual()
                        ? `<button class="btn-secundario" onclick="restaurarBackupAutomatico('${escapeJsAttr(b.chave)}')">Restaurar</button>`
                        : '<span class="dica" style="margin:0">Só o supremo restaura</span>'}</td>
                </tr>`).join("")}
            </tbody>
        </table>`;
}

/* ========== INFORMAÇÕES DO SISTEMA ========== */
/* ── ESPAÇO: OS DOIS TETOS ──────────────────────────────────────────
   O sistema tem duas paredes, e nenhuma delas avisava que estava perto.

   A do Firestore: os lançamentos de cada empresa vivem num documento só,
   e documento não passa de 1 MiB. A ~440 bytes por nota, isso dá umas
   2.400 notas POR EMPRESA. Quando estourar, o salvamento passa a falhar
   para aquela empresa inteira.

   A do navegador: o `localStorage` guarda QUATRO cópias do banco —
   `db_backup` a cada salvamento, mais até três `backupAuto_*`. Os ~5 MB
   típicos acabam em torno de três mil notas SOMANDO todas as empresas,
   ou seja, essa parede chega primeiro.

   Medido em 08/09/2026 sobre a base do modo demonstração, com 717 notas.
   Enquanto o histórico não for repartido em um documento por lançamento,
   este bloco é o único aviso que existe.
   ────────────────────────────────────────────────────────────────── */
const _LIMITE_DOC_FIRESTORE = 1048576;   // 1 MiB
const _LIMITE_LOCALSTORAGE  = 5 * 1024 * 1024;
const _COPIAS_NO_NAVEGADOR  = 1 + BACKUP_AUTO_MAX;

function _ocupacaoEspaco() {
    const bytes = s => new TextEncoder().encode(s).length;

    // Maior documento de empresa: é ele que encosta no teto primeiro.
    const porEmpresa = {};
    (db.lancamentos || []).forEach(l => {
        (porEmpresa[l.empresa] = porEmpresa[l.empresa] || []).push(l);
    });
    let maiorNome = "", maiorBytes = 0, maiorNotas = 0;
    for (const [nome, lista] of Object.entries(porEmpresa)) {
        const b = bytes(JSON.stringify({ lancamentos: lista }));
        if (b > maiorBytes) { maiorBytes = b; maiorNome = nome; maiorNotas = lista.length; }
    }

    const bancoBytes = bytes(JSON.stringify(db));
    return {
        maiorNome, maiorNotas, maiorBytes,
        pctFirestore: Math.round(maiorBytes / _LIMITE_DOC_FIRESTORE * 100),
        navegadorBytes: bancoBytes * _COPIAS_NO_NAVEGADOR,
        pctNavegador: Math.round(bancoBytes * _COPIAS_NO_NAVEGADOR / _LIMITE_LOCALSTORAGE * 100)
    };
}

function _faixaEspaco() {
    const o = _ocupacaoEspaco();
    const pior = Math.max(o.pctFirestore, o.pctNavegador);
    if (pior < 60) return "";

    const grave = pior >= 85;
    const linhas = [];
    if (o.pctFirestore >= 60) {
        linhas.push(`<li><strong>${o.pctFirestore}%</strong> do limite do documento da empresa `
            + `<strong>${escapeHtml(o.maiorNome)}</strong> (${o.maiorNotas} lançamentos). `
            + `Ao chegar a 100%, essa empresa para de salvar na nuvem.</li>`);
    }
    if (o.pctNavegador >= 60) {
        linhas.push(`<li><strong>${o.pctNavegador}%</strong> do espaço do navegador, contando as `
            + `${_COPIAS_NO_NAVEGADOR} cópias do banco. Ao chegar a 100%, o backup local para.</li>`);
    }
    return `<div class="faixa-validacao ${grave ? 'faixa-bloqueio' : 'faixa-alerta'}" style="margin:0 0 16px">
        <strong>${grave ? 'O espaço está no fim' : 'O espaço está ficando curto'}</strong>
        <ul>${linhas.join("")}</ul>
        <small>É a hora de repartir o histórico em um documento por lançamento.
        Enquanto isso não acontece, baixe um backup em Sistema › Backup.</small>
    </div>`;
}

function atualizarInfoSistema() {
    const el = document.getElementById("infoSistema");
    if (!el) return;
    const tamanhoKB = (JSON.stringify(db).length / 1024).toFixed(1);
    const o = _ocupacaoEspaco();
    el.innerHTML = _faixaEspaco() + `
        <div class="info-card"><div class="info-card-valor">${db.lancamentos.filter(lancamentoAtivo).length}</div><div class="info-card-label">Lançamentos</div></div>
        <div class="info-card"><div class="info-card-valor">${db.motoristas.length}</div><div class="info-card-label">Motoristas</div></div>
        <div class="info-card"><div class="info-card-valor">${db.veiculos.length}</div><div class="info-card-label">Veículos</div></div>
        <div class="info-card"><div class="info-card-valor">${db.empresas.length}</div><div class="info-card-label">Empresas</div></div>
        <div class="info-card"><div class="info-card-valor">${db.combustiveis.length}</div><div class="info-card-label">Combustíveis</div></div>
        <div class="info-card"><div class="info-card-valor">${tamanhoKB} KB</div><div class="info-card-label">Tamanho dos Dados</div></div>
        <div class="info-card"><div class="info-card-valor">${o.pctFirestore}%</div><div class="info-card-label">Maior empresa, do limite de 1 MiB</div></div>
        <div class="info-card"><div class="info-card-valor">${o.pctNavegador}%</div><div class="info-card-label">Espaço usado no navegador</div></div>
    `;
    renderBackupsAuto();

    // ── Últimas falhas registradas neste navegador (17/09/2026) ──
    const erros = typeof errosRegistrados === "function" ? errosRegistrados() : [];
    const alvoErros = document.getElementById("infoErros");
    if (alvoErros) {
        if (!erros.length) {
            alvoErros.innerHTML = '<p class="dica" style="margin:0">Nenhuma falha registrada neste navegador.</p>';
        } else {
            alvoErros.innerHTML = `
                <p class="dica" style="margin:0 0 8px">
                    ${erros.length} ${erros.length === 1 ? 'falha' : 'falhas'} neste navegador, da mais recente para a mais antiga.
                    Mande este texto para quem mantém o sistema.
                </p>
                <div class="tabela-container" style="max-height:240px;overflow:auto">
                    <table><thead><tr><th>Quando</th><th>Tela</th><th>Usuário</th><th>Falha</th></tr></thead>
                    <tbody>${erros.map(e => `<tr>
                        <td>${escapeHtml(new Date(e.ts).toLocaleString('pt-BR'))}</td>
                        <td>${escapeHtml(e.tela || '—')}${e.demo ? ' <em class="tag-perda">demo</em>' : ''}</td>
                        <td>${escapeHtml(e.usuario || '—')}</td>
                        <td><code style="font-size:0.75rem">${escapeHtml(e.msg)}</code></td>
                    </tr>`).join('')}</tbody></table>
                </div>
                <div class="sistema-acoes" style="margin-top:10px">
                    <button class="btn-secundario" onclick="errosCopiar()">Copiar para enviar</button>
                    <button class="btn-secundario" onclick="errosLimpar()">Limpar registro</button>
                </div>`;
        }
    }
}

/* ========== AUDITORIA DE DATAS SUSPEITAS ========== */
function auditarDatas() {
    // Os mesmos limites do alerta de data do Dashboard (Sistema › Ajustar
    // Alertas). Antes eram 30 dias e tolerância zero fixos, e as duas telas
    // davam respostas diferentes para a mesma nota.
    const cfg = configAlertas();
    const hojeISO = _hojeISO();
    const limiteFuturo = _somarDiasISO(hojeISO, cfg.dataTolerDias || 0);
    const maxDias = cfg.dataMaxDescNota || 30;
    const diasEntre = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
    const problemasDe = l => {
        const p = [];
        if (l.dataNota && l.dataNota > limiteFuturo) p.push('Nota futura');
        if (l.dataDescarga && l.dataDescarga > limiteFuturo) p.push('Descarga futura');
        if (l.dataNota && l.dataDescarga && l.dataDescarga < l.dataNota) p.push('Descarga antes da nota');
        if (l.dataNota && l.dataDescarga && diasEntre(l.dataNota, l.dataDescarga) > maxDias) p.push(`Descarga ${diasEntre(l.dataNota, l.dataDescarga)} dias após nota`);
        return p;
    };
    const suspeitos = db.lancamentos.filter(l => lancamentoAtivo(l)
        && (!empresaFiltroGlobal || l.empresa === empresaFiltroGlobal)
        && problemasDe(l).length > 0);

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
                        const problema = problemasDe(l);
                        return `<tr>
                            <td>${escapeHtml(l.numeroNota)}</td><td>${formatarData(l.dataNota)}</td>
                            <td>${l.dataDescarga ? formatarData(l.dataDescarga) : '—'}</td>
                            <td style="color:var(--danger);">${problema.join(', ')}</td>
                            <td><button class="btn-secundario" onclick="irParaLancamento('${escapeJsAttr(l.id)}');document.getElementById('_modalAuditoria').remove()">Ver</button></td>
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
    _modalAcessivel(modal, () => modal.remove());
}

/* Modais montados aqui: foco dentro ao abrir e Escape fecha. Antes o Tab
   seguia para a tela de trás e o Escape não fazia nada. */
function _modalAcessivel(modal, fechar) {
    const focaveis = () => [...modal.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && el.offsetParent !== null);
    modal.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); fechar(); return; }
        if (e.key !== 'Tab') return;
        const f = focaveis(); if (!f.length) return;
        const primeiro = f[0], ultimo = f[f.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    });
    setTimeout(() => focaveis()[0]?.focus(), 0);
}

/* ========== CORREÇÃO EM MASSA ==========
   Só o supremo: é uma renomeação dentro das notas, e renomear cadastro é
   do supremo (decisão do dono, 17/09/2026). Também é o único perfil que
   carrega todas as empresas, então a correção não deixa metade do
   histórico com o nome velho.

   O valor antigo é OBRIGATÓRIO e escolhido da lista do que existe nas
   notas. Antes ele era texto livre e opcional: deixá-lo vazio trocava o
   campo em todas as notas de todas as empresas — todas as notas numa
   empresa só, ou todos os combustíveis num só — sem confirmação. */
let campoCorrecaoAtual = '';
let modalCorrecaoMassa = null;

const _CORRECAO_ROTULOS = {
    empresa: 'Empresa', motorista: 'Motorista', placa: 'Placa', base: 'Base', combustivel: 'Combustível'
};

/** Valores que aparecem hoje nas notas, com quantas notas cada um tem. */
function _valoresNasNotas(campo) {
    const cont = new Map();
    db.lancamentos.forEach(l => {
        const valores = campo === 'combustivel'
            ? [...new Set((l.itens || []).map(i => i.tipo))]
            : [l[campo]];
        valores.forEach(v => { if (v) cont.set(v, (cont.get(v) || 0) + 1); });
    });
    return [...cont.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
}

function corrigirCampoEmMassa(campo) {
    if (!exigirPapel("supremo", "Correção em massa")) return;
    campoCorrecaoAtual = campo;
    let lista = [];
    switch(campo) {
        case 'empresa':    lista = db.empresas.filter(e=>e.ativo!==false).map(e=>e.nome);     break;
        case 'motorista':  lista = db.motoristas.filter(m=>m.ativo!==false).map(m=>m.nome);   break;
        case 'placa':      lista = db.veiculos.filter(v=>v.ativo!==false).map(v=>v.nome);     break;
        case 'base':       lista = db.bases.filter(b=>b.ativo!==false).map(b=>b.nome);        break;
        case 'combustivel':lista = db.combustiveis.filter(c=>c.ativo!==false).map(c=>c.nome); break;
        default: mostrarToast('Campo inválido para correção.', 'aviso'); return;
    }
    const rotulo = _CORRECAO_ROTULOS[campo];
    if (lista.length === 0) { mostrarToast(`Nenhum cadastro de ${rotulo.toLowerCase()}. Cadastre pelo menos um antes de corrigir.`, 'aviso', 5000); return; }
    const antigos = _valoresNasNotas(campo);
    if (antigos.length === 0) { mostrarToast('Não há lançamentos para corrigir.', 'info', 4000); return; }

    const modal = document.createElement('div');
    modal.id = 'modalCorrecaoMassa';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;
    modal.innerHTML = `
        <div role="dialog" aria-modal="true" aria-labelledby="correcaoMassaTitulo" style="background:var(--surface);border-radius:12px;padding:28px;max-width:500px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3)">
            <h3 id="correcaoMassaTitulo" style="margin:0 0 8px">Corrigir ${escapeHtml(rotulo)}</h3>
            <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:20px">
                Troca o valor escolhido por outro em todos os lançamentos que o têm, inclusive os excluídos e cancelados.
            </p>
            <div class="campo" style="margin-bottom:16px">
                <label for="correcaoMassaAntigo">Valor que está errado nas notas</label>
                <select id="correcaoMassaAntigo" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)">
                    <option value="">Escolha…</option>
                    ${antigos.map(([val, n]) => `<option value="${escapeHtml(val)}">${escapeHtml(val)} (${n} ${n === 1 ? 'nota' : 'notas'})</option>`).join('')}
                </select>
            </div>
            <div class="campo" style="margin-bottom:16px">
                <label for="correcaoMassaSelect">Valor correto, do cadastro</label>
                <select id="correcaoMassaSelect" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)">
                    ${lista.map(val => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('')}
                </select>
            </div>
            <div id="correcaoMassaPreview" role="status" style="font-size:0.85rem;color:var(--text-muted);margin-bottom:16px;padding:8px;background:var(--surface-alt);border-radius:6px;"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button onclick="fecharModalCorrecaoMassa()" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);cursor:pointer">Cancelar</button>
                <button onclick="executarCorrecaoMassa()" style="padding:8px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:600">Aplicar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modalCorrecaoMassa = modal;
    _modalAcessivel(modal, fecharModalCorrecaoMassa);
    atualizarPreviewCorrecao();
    document.getElementById('correcaoMassaSelect').addEventListener('change', atualizarPreviewCorrecao);
    document.getElementById('correcaoMassaAntigo').addEventListener('change', atualizarPreviewCorrecao);
    document.getElementById('correcaoMassaAntigo').focus();
}

/** Quantas notas mudam, e em que empresas. */
function _alcanceCorrecao(antigo, novo) {
    const porEmpresa = new Map();
    let notas = 0;
    if (!antigo || antigo === novo) return { notas, porEmpresa };
    db.lancamentos.forEach(l => {
        const tem = campoCorrecaoAtual === 'combustivel'
            ? (l.itens || []).some(i => i.tipo === antigo)
            : l[campoCorrecaoAtual] === antigo;
        if (!tem) return;
        notas++;
        porEmpresa.set(l.empresa, (porEmpresa.get(l.empresa) || 0) + 1);
    });
    return { notas, porEmpresa };
}

function atualizarPreviewCorrecao() {
    const select  = document.getElementById('correcaoMassaSelect');
    const antigo  = document.getElementById('correcaoMassaAntigo')?.value || '';
    const preview = document.getElementById('correcaoMassaPreview');
    if (!select || !preview) return;
    if (!antigo) { preview.textContent = 'Escolha o valor que está errado.'; return; }
    if (antigo === select.value) { preview.textContent = 'O valor correto é igual ao errado: nada a trocar.'; return; }
    const { notas } = _alcanceCorrecao(antigo, select.value);
    preview.textContent = `${notas} lançamento(s) serão atualizados`;
}

function fecharModalCorrecaoMassa() {
    if (modalCorrecaoMassa) { modalCorrecaoMassa.remove(); modalCorrecaoMassa = null; }
}

/* Esta correção toca TODOS os lançamentos com o valor, inclusive os
   excluídos e os cancelados, e isso é de propósito: é uma renomeação, não
   uma conta. O número anunciado inclui registros que não aparecem no
   relatório, e por isso o texto diz "no histórico". */
async function executarCorrecaoMassa() {
    if (!exigirPapel("supremo", "Correção em massa")) return;
    const select = document.getElementById('correcaoMassaSelect');
    const antigo = document.getElementById('correcaoMassaAntigo')?.value || '';
    if (!select) return;
    const novo = select.value;
    if (!antigo) { mostrarToast('Escolha o valor que está errado nas notas.', 'aviso', 4000); return; }
    if (antigo === novo) { mostrarToast('O valor correto é igual ao errado: nada a trocar.', 'info', 4000); return; }

    const { notas, porEmpresa } = _alcanceCorrecao(antigo, novo);
    if (notas === 0) { mostrarToast('Nenhum lançamento tem esse valor.', 'info', 4000); return; }

    const rotulo = _CORRECAO_ROTULOS[campoCorrecaoAtual];
    const detalhe = [...porEmpresa.entries()].map(([emp, n]) => `• ${emp}: ${n}`).join('\n');
    const aviso = campoCorrecaoAtual === 'empresa'
        ? `\n\nAs notas MUDAM DE EMPRESA: saem de "${antigo}" e passam a contar em "${novo}".`
        : '';
    fecharModalCorrecaoMassa();
    if (!await fmConfirm({
        titulo: `Trocar ${rotulo.toLowerCase()} em ${notas} lançamento(s)?`,
        msg: `"${antigo}" → "${novo}"\n\n${detalhe}${aviso}`,
        confirmTxt: 'Trocar', cancelTxt: 'Cancelar', tipo: 'perigo'
    })) return;

    const usuario = window._usuarioAtual?.nome || 'Desconhecido';
    const ts = new Date().toISOString();
    let count = 0;
    db.lancamentos = db.lancamentos.map(l => {
        const tem = campoCorrecaoAtual === 'combustivel'
            ? (l.itens || []).some(i => i.tipo === antigo)
            : l[campoCorrecaoAtual] === antigo;
        if (!tem) return l;
        count++;
        // Objeto novo, e não mudança no lugar: o cache da busca rápida do
        // relatório é por objeto, e ficava com o valor velho.
        const c = Object.assign({}, l);
        if (campoCorrecaoAtual === 'combustivel') {
            c.itens = (l.itens || []).map(i => i.tipo === antigo ? Object.assign({}, i, { tipo: novo }) : i);
        } else {
            c[campoCorrecaoAtual] = novo;
            if (campoCorrecaoAtual === 'empresa') delete c.empresaId;
        }
        c.logs = (l.logs || []).concat([{ acao: 'Correção em massa', ts, usuario,
            alteracoes: [{ campo: campoCorrecaoAtual, de: antigo, para: novo }] }]);
        return c;
    });
    atualizarListas();
    _rerenderTelaAtual();
    await _salvarEConfirmar(`${count} lançamento(s) do histórico atualizados com ${rotulo.toLowerCase()} = "${novo}"`);
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
 * Reduz a imagem e grava como base64 em db.configRelatorio.logos[empresa].
 */
async function pdfCarregarLogo(input) {
    const file = input.files[0];
    if (!file) return;
    // Configuração de PDF é de todo mundo: só admin e supremo alteram. A
    // regra do servidor recusava a do operador, e enquanto a memória
    // guardava a mudança, NENHUM cadastro dele subia mais.
    if (!exigirPapel("admin", "Alterar a logo do PDF")) { input.value = ''; return; }
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
        // A imagem é reduzida antes de virar base64: ela mora dentro do
        // documento do Firestore, que tem teto de 1 MB compartilhado com
        // todos os cadastros. Um logo de cabeçalho de PDF não precisa de
        // mais que ~320px de largura.
        const dataUri = await _reduzirImagemParaDataUri(file, 320);

        if (!db.configRelatorio) db.configRelatorio = {};
        // Objeto novo: a sincronização compara com o que o servidor tinha.
        const logos = Object.assign({}, db.configRelatorio.logos || {});
        // Pelo id da empresa, que não muda num rename; a chave antiga, pelo
        // nome, sai junto.
        delete logos[empresa];
        logos[_chaveLogoEmpresa(empresa)] = { url: dataUri, nome: file.name };
        db.configRelatorio = Object.assign({}, db.configRelatorio, { logos });

        _pdfAtualizarPrevia(dataUri, empresa);
        const kb = Math.round(dataUri.length * 0.75 / 1024);
        await _salvarEConfirmar(`Logo salva (${kb} KB)`);
    } catch (e) {
        mostrarToast('Erro ao processar a logo: ' + e.message, 'erro', 6000);
    } finally {
        if (btn) esconderSpinner(btn);
        input.value = '';
    }
}

/**
 * Reduz uma imagem para no máximo `larguraMax` pixels de largura e devolve
 * um data URI. Mantém a proporção e não amplia imagens já pequenas.
 *
 * Existe porque o projeto não usa Firebase Storage: a logo vive dentro do
 * documento de dados, e uma imagem em tamanho original estouraria o limite
 * de 1 MB por documento sozinha.
 */
function _reduzirImagemParaDataUri(file, larguraMax) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onerror = () => reject(new Error('não foi possível ler o arquivo'));
        leitor.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('arquivo não é uma imagem válida'));
            img.onload = () => {
                const escala  = Math.min(1, larguraMax / img.width);
                const largura = Math.round(img.width  * escala);
                const altura  = Math.round(img.height * escala);

                const canvas = document.createElement('canvas');
                canvas.width = largura;
                canvas.height = altura;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, largura, altura);

                // PNG preserva transparência, que logo costuma ter; se ficar
                // grande demais, cai para JPEG com fundo branco.
                let saida = canvas.toDataURL('image/png');
                if (saida.length > 120 * 1024) {
                    ctx.globalCompositeOperation = 'destination-over';
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, largura, altura);
                    saida = canvas.toDataURL('image/jpeg', 0.85);
                }
                resolve(saida);
            };
            img.src = leitor.result;
        };
        leitor.readAsDataURL(file);
    });
}

async function pdfRemoverLogo() {
    if (!exigirPapel("admin", "Remover a logo do PDF")) return;
    const empresa = _pdfEmpresaAtiva();
    if (!db.configRelatorio) db.configRelatorio = {};
    const logos = Object.assign({}, db.configRelatorio.logos || {});
    delete logos[empresa];
    delete logos[_chaveLogoEmpresa(empresa)];
    db.configRelatorio = Object.assign({}, db.configRelatorio, { logos });

    _pdfAtualizarPrevia(null, empresa);
    await _salvarEConfirmar('Logo removida');
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

async function salvarConfigPDF() {
    if (!exigirPapel("admin", "Salvar as configurações de PDF")) return;
    db.configRelatorio = Object.assign({}, db.configRelatorio || {});

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

    await _salvarEConfirmar('Configurações de PDF salvas');
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
    const logoEmpresa = logoDaEmpresa(empresa);
    // Fallback: logo global legada em base64
    const logoSrc = logoEmpresa?.url || cfg.logo || null;
    _pdfAtualizarPrevia(logoSrc, empresa);

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
      <div class="campo"><label for="pdfTitulo">Título do relatório</label><input type="text" id="pdfTitulo"></div>
      <div class="campo"><label for="pdfOrientacao">Orientação</label>
        <select id="pdfOrientacao">
          <option value="landscape">Paisagem</option>
          <option value="portrait">Retrato</option>
        </select>
      </div>
      <div class="campo"><label for="pdfFonte">Fonte</label>
        <select id="pdfFonte">
          <option value="helvetica">Helvetica</option>
          <option value="courier">Courier</option>
          <option value="times">Times</option>
        </select>
      </div>
    </div>

    <!-- Cor e margens -->
    <div class="form-grid" style="grid-template-columns:auto 1fr 1fr 1fr 1fr;gap:12px;align-items:end">
      <div class="campo"><label for="pdfCorDestaque">Cor de destaque</label>
        <input type="color" id="pdfCorDestaque" style="height:38px;width:60px;padding:2px;border-radius:6px;border:1px solid var(--border);cursor:pointer">
      </div>
      <div class="campo"><label for="pdfMargemEsq">Margem esq. (mm)</label><input type="number" id="pdfMargemEsq" min="5" max="40" step="1"></div>
      <div class="campo"><label for="pdfMargemDir">Margem dir. (mm)</label><input type="number" id="pdfMargemDir" min="5" max="40" step="1"></div>
      <div class="campo"><label for="pdfMargemTopo">Margem topo (mm)</label><input type="number" id="pdfMargemTopo" min="5" max="40" step="1"></div>
      <div class="campo"><label for="pdfMargemRodape">Margem rodapé (mm)</label><input type="number" id="pdfMargemRodape" min="5" max="30" step="1"></div>
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
      <label for="pdfRodapeTexto">Texto do rodapé (opcional)</label>
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
   CONFERÊNCIA — AUTOSYSTEM
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
    if (adiarAteBibliotecas(["xlsx"], () => autosystemLerArquivo(input))) return;
    const file = input.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx','xls','csv'].includes(ext)) { mostrarToast('Selecione um arquivo .xlsx, .xls ou .csv', 'aviso', 4000); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            let linhas = [];
            if (ext === 'csv') {
                // Mesma leitura da importação: codificação do Excel e aspas.
                linhas = importacaoLerCSV(_decodificarTexto(e.target.result));
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
    if (ext === 'csv') reader.readAsArrayBuffer(file);
    else reader.readAsBinaryString(file);
}

/**
 * Acha a coluna do cabe\u00e7alho que corresponde a um r\u00f3tulo.
 *
 * Vai do mais espec\u00edfico para o mais frouxo: igual, come\u00e7a com, cont\u00e9m.
 * Antes s\u00f3 a igualdade exata valia, e um cabe\u00e7alho escrito "Data " com
 * espa\u00e7o, "DATA", "Entrada (L)" ou "Entrada Litros" n\u00e3o casava com nada.
 *
 * @returns {number} \u00edndice da coluna, ou `-1` se n\u00e3o achou
 */
function _autoAcharColuna(cabecalho, rotulo) {
    let i = cabecalho.indexOf(rotulo);
    if (i >= 0) return i;
    i = cabecalho.findIndex(c => c.startsWith(rotulo));
    if (i >= 0) return i;
    return cabecalho.findIndex(c => c.includes(rotulo));
}

/**
 * L\u00ea o arquivo de medi\u00e7\u00e3o do AutoSystem e monta as linhas de confer\u00eancia.
 *
 * **N\u00e3o adivinha coluna.** Antes, os \u00edndices nasciam em `0` e `3` e s\u00f3
 * eram substitu\u00eddos quando a c\u00e9lula do cabe\u00e7alho fosse exatamente `data` e
 * exatamente `entrada`. Com qualquer varia\u00e7\u00e3o de r\u00f3tulo, o sistema
 * comparava os lan\u00e7amentos contra a quarta coluna do arquivo sem nunca ter
 * confirmado que ela era a coluna de litros \u2014 e sem dizer nada. Agora,
 * quando n\u00e3o d\u00e1 para identificar as duas colunas, o processamento para e o
 * operador \u00e9 avisado.
 */
function _autosystemDetectarEProcessar() {
    let idxData = -1, idxEntrada = -1;
    let cabIdx = -1;
    let rotuloData = '', rotuloEntrada = '';
    for (let i = 0; i < Math.min(_autoLinhas.length, 15); i++) {
        const row = _autoLinhas[i];
        const txt = row.map(c => String(c||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''));
        if (txt.some(c => c.includes('entrada')) && txt.some(c => c.includes('data'))) {
            cabIdx = i;
            idxData    = _autoAcharColuna(txt, 'data');
            idxEntrada = _autoAcharColuna(txt, 'entrada');
            rotuloData    = String(row[idxData]    ?? '').trim();
            rotuloEntrada = String(row[idxEntrada] ?? '').trim();
            break;
        }
    }

    if (cabIdx < 0) {
        mostrarToast(
            'N\u00e3o achei o cabe\u00e7alho do arquivo. Ele precisa ter uma linha com uma '
            + 'coluna de data e uma de entrada, nas 15 primeiras linhas.', 'erro', 8000);
        return;
    }
    if (idxData < 0 || idxEntrada < 0) {
        const falta = idxData < 0 ? 'data' : 'entrada';
        mostrarToast(`Achei o cabe\u00e7alho, mas n\u00e3o a coluna de ${falta}. Confira o arquivo.`, 'erro', 8000);
        return;
    }
    if (idxData === idxEntrada) {
        mostrarToast('A mesma coluna casou com data e com entrada. Confira o arquivo.', 'erro', 8000);
        return;
    }
    _autoColunas = { data: rotuloData, entrada: rotuloEntrada };

    const linhasParaProcessar = _autoLinhas.slice(cabIdx + 1);
    const linhasDados = [];
    let ignoradas = 0;
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
        if (!dataRaw) return;
        if (dataRaw.toLowerCase().includes('total')) return;
        // Data com ou sem hora, no formato brasileiro ou ISO. Linha que não
        // é lida é CONTADA e avisada: antes ela sumia em silêncio.
        const data = importacaoNormalizarData(dataRaw);
        if (!data) { ignoradas++; return; }
        // Era um parser próprio que trocava a vírgula mas não removia o
        // milhar, então "1.234,56" saía como 1,234. Usa o do sistema.
        const _n = (v) => parseNumeroBR(v) ?? 0;
        linhasDados.push({ data, entrada: _n(row[idxEntrada]) });
    });

    if (!linhasDados.length) { mostrarToast('Nenhuma linha de dados encontrada no arquivo.', 'aviso'); return; }
    // O mesmo dia em duas linhas soma, em vez de a segunda ficar sem par.
    const porDia = new Map();
    linhasDados.forEach(l => porDia.set(l.data, (porDia.get(l.data) || 0) + l.entrada));
    _autoLinhasDados = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([data, entrada]) => ({ data, entrada }));
    _autoIgnoradas = ignoradas;
    _autosystemRenderizarConferencia();
}

let _autoLinhasDados = [];
let _autoIgnoradas = 0;

/**
 * Linhas da conferência: todo dia do arquivo e também todo dia, DENTRO do
 * período do arquivo, em que só o sistema tem entrada. Antes os totais
 * só olhavam os dias presentes no arquivo, e uma descarga de 30.000 L num
 * dia que o relatório não listava deixava a tela dizendo "confere".
 */
function _autoMontarLinhas(comb) {
    const empresa = empresaFiltroGlobal || '';
    const entradasSistema = {};
    db.lancamentos
        .filter(l => lancamentoAtivo(l) && l.empresa === empresa && (l.itens || []).some(i => i.tipo === comb))
        .forEach(l => {
            const dRef = dataDescargaDe(l);   // o tanque recebe na descarga (rodada 11)
            if (!dRef) return;
            const litros = l.itens.filter(i => i.tipo === comb).reduce((s, i) => s + _litrosItem(i), 0);
            entradasSistema[dRef] = (entradasSistema[dRef] || 0) + litros;
        });
    const doArquivo = new Map(_autoLinhasDados.map(d => [d.data, d.entrada]));
    const datas = _autoLinhasDados.map(d => d.data);
    const ini = datas[0], fim = datas[datas.length - 1];
    Object.keys(entradasSistema).forEach(d => { if (d >= ini && d <= fim && !doArquivo.has(d)) datas.push(d); });
    return [...new Set(datas)].sort().map(data => {
        const entrada    = doArquivo.get(data) || 0;
        const sistemaVal = entradasSistema[data] || 0;
        return { data, entrada, sistemaVal, diff: sistemaVal - entrada, soNoSistema: !doArquivo.has(data) };
    });
}

/* Chamada na troca de empresa. O relatório do AutoSystem é da medição de
   tanque de uma empresa, e a comparação é feita contra os lançamentos da
   ativa: depois de uma troca, a tela mostrava a empresa anterior e o Excel
   exportava a nova. Nada da conferência é gravado, então limpar não perde
   dado. (Sair da tela não a desfaz, ao contrário do que o prompt dizia.) */
function _limparConferenciaCarregada() {
    if (!_autoLinhasDados.length && !_autoLinhas.length) return;
    _autoLinhas = [];
    _autoLinhasDados = [];
    _autoCombustivel = '';
    const c = document.getElementById('_confAutoResultado');
    if (c) c.innerHTML = '';
    const inp = document.querySelector('input[onchange="autosystemLerArquivo(this)"]');
    if (inp) inp.value = '';
}
/** Rótulos das colunas que a leitura usou. Mostrados na tela: o operador
 *  precisa poder conferir contra que coluna o sistema comparou. */
let _autoColunas = { data: '', entrada: '' };

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
                    ${escapeHtml(empresa) || '(nenhuma selecionada)'}
                </div>
            </div>
            <div class="campo" style="min-width:180px">
                <label for="_autoSelComb">Combustível do relatório</label>
                <select id="_autoSelComb" onchange="_autosystemAtualizarTabela()">
                    <option value="">-- Selecione --</option>
                    ${combustiveis.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                </select>
            </div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin:-6px 0 14px">
            Lendo a data da coluna <strong>${escapeHtml(_autoColunas.data || '?')}</strong>
            e os litros da coluna <strong>${escapeHtml(_autoColunas.entrada || '?')}</strong>
            do arquivo — ${_autoLinhasDados.length} dia(s).
            ${_autoIgnoradas ? `<strong style="color:var(--warning)">${_autoIgnoradas} linha(s) com data ilegível ficaram de fora.</strong>` : ''}
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

    let totalAutoEntradas = 0, totalSistemaEntradas = 0, diasComDivergencia = 0;
    const linhasEntrada = _autoMontarLinhas(comb).map(d => {
        const temDiv = Math.abs(d.diff) > 1 && (d.entrada > 0 || d.sistemaVal > 0);
        if (temDiv) diasComDivergencia++;
        totalAutoEntradas    += d.entrada;
        totalSistemaEntradas += d.sistemaVal;
        return { ...d, temDiv };
    });
    const diffTotal = totalSistemaEntradas - totalAutoEntradas;

    const resumo = `
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
        </div>`;

    container.innerHTML = `
        ${resumo}
        <p class="dica" style="margin-bottom:10px">
            Confere as <strong>notas lançadas</strong> contra o que o AutoSystem mediu, dia a dia pela <strong>data da descarga</strong> e com os <strong>litros descarregados</strong>.
            Nota faltando ou lançada duas vezes aparece aqui — e nota a mais é frete pago a mais. O frete, esse, é calculado sobre a <strong>carga</strong> da nota.
            Clique num dia para ver as notas que o formam.
            ${Math.abs(diffTotal)>1
                ? `<strong style="color:var(--danger)">Divergência de ${fmtL3(Math.abs(diffTotal))} no total do período.</strong>`
                : `<strong style="color:var(--success)">Total do período confere.</strong>`}
        </p>
        <div class="tabela-container"><table>
            <thead><tr><th>Data</th><th>Entrada AutoSystem (L)</th><th>Entrada Sistema (L)</th><th>Diferença (L)</th></tr></thead>
            <tbody>
                ${linhasEntrada.map(l => `
                <tr class="${l.sistemaVal > 0 ? 'linha-clicavel' : ''}" style="${l.temDiv?'background:rgba(239,68,68,0.06)':l.entrada===0&&l.sistemaVal===0?'opacity:0.5':''}"
                    ${l.sistemaVal > 0 ? `onclick="_autoAlternarNotasDoDia(this, '${escapeJsAttr(l.data)}', '${escapeJsAttr(comb)}')" title="Ver as notas deste dia"` : ''}>
                    <td><strong>${formatarData(l.data)}</strong>${l.soNoSistema ? ' <small style="color:var(--warning)">só no sistema</small>' : ''}${l.temDiv && l.sistemaVal > 0 ? ' <small style="color:var(--text-muted)">▸ notas</small>' : ''}</td>
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
        <div class="barra-exportacao" style="margin-top:16px">
            <span class="exportacao-titulo">Exportar:</span>
            <button class="btn-export btn-xlsx" onclick="_autoExportarExcel('${escapeJsAttr(comb)}')">Excel</button>
        </div>`;
}

/* ── AS NOTAS DO DIA DIVERGENTE (18/09/2026) ───────────────────────
   A tela dizia "12/03: 340 L de diferença" e parava aí: quem conferia não
   sabia qual das notas do dia estava errada. Agora o dia abre a lista das
   notas que o formam, com placa, motorista, carga e descarga — o
   candidato a erro de digitação costuma saltar aos olhos. Nada é
   gravado: continua sendo conferência, não controle de estoque. */
function _autoAlternarNotasDoDia(tr, data, comb) {
    const prox = tr.nextElementSibling;
    if (prox && prox.classList.contains("linha-notas-dia")) { prox.remove(); return; }
    const empresa = empresaFiltroGlobal || "";
    const notas = db.lancamentos.filter(l => lancamentoAtivo(l) && l.empresa === empresa
        && dataDescargaDe(l) === data && (l.itens || []).some(i => i.tipo === comb));
    const linhas = notas.map(l => {
        const itens = l.itens.filter(i => i.tipo === comb);
        const carga = itens.reduce((s2, i) => s2 + (Number(i.qtd) || 0), 0);
        const desc  = itens.reduce((s2, i) => s2 + _litrosItem(i), 0);
        return `<tr>
            <td>${escapeHtml(l.numeroNota || "—")}</td>
            <td>${escapeHtml(l.placa || "—")}</td>
            <td>${escapeHtml(l.motorista || "—")}</td>
            <td>${fmtL3(carga)}</td>
            <td>${fmtL3(desc)}${desc !== carga ? "" : ' <small style="color:var(--text-muted)">(= carga)</small>'}</td>
            <td><button class="btn-secundario" onclick="event.stopPropagation(); editarLancamento('${escapeJsAttr(l.id)}')">Abrir</button></td>
        </tr>`;
    }).join("");
    const nova = document.createElement("tr");
    nova.className = "linha-notas-dia";
    nova.innerHTML = `<td colspan="4" style="padding:8px 12px;background:var(--surface-alt)">
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px">${notas.length} nota(s) de ${escapeHtml(comb)} descarregada(s) em ${formatarData(data)}</div>
        <table style="width:100%"><thead><tr><th>Nota</th><th>Placa</th><th>Motorista</th><th>Carga (L)</th><th>Descarga (L)</th><th></th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="6">Nenhuma nota.</td></tr>'}</tbody></table>
    </td>`;
    tr.after(nova);
}

function _autoExportarExcel(comb) {
    if (adiarAteBibliotecas(["xlsx"], () => _autoExportarExcel(comb))) return;
    const wb = XLSX.utils.book_new();
    const rows = [
        ['Data','Entrada AutoSystem (L)','Entrada Sistema (L)','Diferença (L)','Observação'],
        ..._autoMontarLinhas(comb).map(l => [formatarData(l.data), l.entrada, l.sistemaVal, l.diff, l.soNoSistema ? 'Só no sistema' : ''])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'AutoSystem');
    XLSX.writeFile(wb, `conferencia-autosystem-${_hojeISO()}.xlsx`);
    mostrarToast('Excel exportado!', 'sucesso');
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
/* Quem pode mudar a régua: admin e supremo (decisão de 16/09/2026). A
   configuração é do sistema e vale para todos; os demais veem os valores
   em vigor, sem poder salvar. A regra do Firestore confere o mesmo no
   servidor. */
const _CFG_PERIODOS_PRECO = [3, 5, 7, 10, 15, 30, 60, 90];

function abrirConfigAlertas() {
    const cfg = configAlertas();
    const podeAlterar = typeof podeGerenciarUsuarios === 'function' && podeGerenciarUsuarios();
    const modal = document.createElement('div');
    modal.id = '_modalConfigAlertas';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px`;

    const periodos = _CFG_PERIODOS_PRECO.includes(Number(cfg.precoPeriodoDias))
        ? _CFG_PERIODOS_PRECO
        : [..._CFG_PERIODOS_PRECO, Number(cfg.precoPeriodoDias)].sort((a, b) => a - b);
    const periodOpts = periodos.map(d=>`<option value="${d}" ${cfg.precoPeriodoDias==d?'selected':''}>${d} dias</option>`).join('');

    modal.innerHTML = `
        <div style="background:var(--surface);border-radius:12px;padding:28px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.3)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <h3 style="margin:0">Configurações de Alertas</h3>
                <button onclick="document.getElementById('_modalConfigAlertas').remove()" aria-label="Fechar" style="border:none;background:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted)">✕</button>
            </div>
            <p style="margin:-8px 0 18px;font-size:0.82rem;color:var(--text-muted)">Valem para todos os usuários. O alerta de preço vale no Dashboard e na tela de lançamento; os de volume e de data, só no Dashboard.${podeAlterar ? '' : ' <strong>Só administradores alteram.</strong>'}</p>

            <fieldset id="_cfgCampos" ${podeAlterar ? '' : 'disabled'} style="border:none;margin:0;padding:0;min-width:0">
            <div class="_cfg-bloco">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                    <div><strong>Alerta de Preço</strong>
                    <p style="margin:2px 0 0;font-size:0.8rem;color:var(--text-muted)">Compara o preço/L de cada nota com a mediana das notas emitidas nos dias anteriores. Avisa acima ou abaixo.</p></div>
                    <label class="_cfg-toggle"><input type="checkbox" aria-label="Ligar alerta de preço" id="_cfgPrecoAtivo" ${cfg.precoAtivo?'checked':''} onchange="_cfgPreview()"><span class="_cfg-slider"></span></label>
                </div>
                <div id="_cfgPrecoOpts" style="${cfg.precoAtivo?'':'opacity:0.4;pointer-events:none'}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                        <div class="campo"><label for="_cfgPrecoDif">Diferença mínima (R$/L)</label>
                        <input type="text" class="fm-numero" id="_cfgPrecoDif" value="${escapeHtml(fmtNumeroExibicao(cfg['precoDiferencaR$'], 2))}" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                        <div class="campo"><label for="_cfgPrecoPer">Período de referência</label>
                        <select id="_cfgPrecoPer" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" onchange="_cfgPreview()">${periodOpts}</select></div>
                    </div>
                </div>
            </div>

            <div class="_cfg-bloco" style="margin-top:20px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                    <div><strong>Alerta de Volume Suspeito</strong>
                    <p style="margin:2px 0 0;font-size:0.8rem;color:var(--text-muted)">Avisa quando a quantidade está muito acima ou abaixo do habitual.</p></div>
                    <label class="_cfg-toggle"><input type="checkbox" aria-label="Ligar alerta de volume suspeito" id="_cfgVolAtivo" ${cfg.volumeAtivo?'checked':''} onchange="_cfgPreview()"><span class="_cfg-slider"></span></label>
                </div>
                <div id="_cfgVolOpts" style="${cfg.volumeAtivo?'':'opacity:0.4;pointer-events:none'}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                        <div class="campo"><label for="_cfgVolAcima">% acima da média histórica</label>
                        <input type="number" id="_cfgVolAcima" value="${cfg.volumeAcimaPerc}" min="10" max="500" step="5" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                        <div class="campo"><label for="_cfgVolAbaixo">% abaixo da média histórica</label>
                        <input type="number" id="_cfgVolAbaixo" value="${cfg.volumeAbaixoPerc}" min="10" max="99" step="5" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                    </div>
                </div>
            </div>

            <div class="_cfg-bloco" style="margin-top:20px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                    <div><strong>Alerta de Data Suspeita</strong>
                    <p style="margin:2px 0 0;font-size:0.8rem;color:var(--text-muted)">Avisa quando a data de descarga ou nota parece incorreta.</p></div>
                    <label class="_cfg-toggle"><input type="checkbox" aria-label="Ligar alerta de data suspeita" id="_cfgDataAtivo" ${cfg.dataAtivo?'checked':''} onchange="_cfgPreview()"><span class="_cfg-slider"></span></label>
                </div>
                <div id="_cfgDataOpts" style="${cfg.dataAtivo?'':'opacity:0.4;pointer-events:none'}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                        <div class="campo"><label for="_cfgDataToler">Tolerância de data futura (dias)</label>
                        <input type="number" id="_cfgDataToler" value="${cfg.dataTolerDias}" min="0" max="30" step="1" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                        <div class="campo"><label for="_cfgDataMaxDiff">Máx. dias entre nota e descarga</label>
                        <input type="number" id="_cfgDataMaxDiff" value="${cfg.dataMaxDescNota}" min="1" max="90" step="1" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text)" oninput="_cfgPreview()"></div>
                    </div>
                </div>
            </div>

            </fieldset>

            <div id="_cfgPreviewTxt" style="margin-top:16px;padding:10px 14px;border-radius:8px;background:var(--surface-alt);font-size:0.82rem;color:var(--text-muted);min-height:36px"></div>

            ${podeAlterar ? `
            <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;margin-top:20px">
                <button onclick="_cfgRestaurarPadrao()" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text-muted);cursor:pointer;font-size:0.82rem">Restaurar padrões</button>
                <div style="display:flex;gap:10px">
                    <button onclick="document.getElementById('_modalConfigAlertas').remove()" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);cursor:pointer">Cancelar</button>
                    <button onclick="_cfgSalvar()" style="padding:8px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:600">Salvar configurações</button>
                </div>
            </div>` : `
            <div style="display:flex;justify-content:flex-end;margin-top:20px">
                <button onclick="document.getElementById('_modalConfigAlertas').remove()" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);cursor:pointer">Fechar</button>
            </div>`}
        </div>
    `;
    document.body.appendChild(modal);
    _modalAcessivel(modal, () => modal.remove());
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
        const dif=parseNumeroBR(document.getElementById('_cfgPrecoDif')?.value);
        const per=document.getElementById('_cfgPrecoPer')?.value||7;
        partes.push(dif !== null && dif > 0
            ? `Preço: avisa se o preço/L ficar ${escapeHtml(Math.round(dif*100) === dif*100 ? fmtR(dif) : fmtR4(dif))} ou mais acima ou abaixo da mediana dos ${escapeHtml(per)} dias anteriores à emissão da nota`
            : `Preço: informe uma diferença maior que zero, em reais por litro (ex.: 0,25)`);
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
    f('_cfgPrecoAtivo',p.precoAtivo); f('_cfgPrecoDif',fmtNumeroExibicao(p['precoDiferencaR$'],2)); f('_cfgPrecoPer',p.precoPeriodoDias);
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
    if (!(typeof podeGerenciarUsuarios === 'function' && podeGerenciarUsuarios())) {
        mostrarToast('Só administradores alteram as configurações de alertas.', 'aviso', 4000);
        return;
    }
    const g=(id)=>document.getElementById(id);
    // Diferença lida em pt-BR ("0,25"). Antes o campo era type="number", que
    // esvazia com vírgula, e o `|| 0.10` gravava o padrão em silêncio.
    const dif = parseNumeroBR(g('_cfgPrecoDif')?.value);
    if (dif === null || dif <= 0) {
        mostrarToast('Diferença mínima do alerta de preço: informe um valor maior que zero, em R$/L (ex.: 0,25).', 'aviso', 5000);
        g('_cfgPrecoDif')?.focus();
        return;
    }
    const cfg={
        precoAtivo:g('_cfgPrecoAtivo')?.checked??true,
        'precoDiferencaR$':Math.round(dif*10000)/10000,
        precoPeriodoDias:parseInt(g('_cfgPrecoPer')?.value)||ALERTAS_CONFIG_PADRAO.precoPeriodoDias,
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
    // Uma nota pela metade na tela de lançamento passa a ser julgada pela
    // régua nova já, e não só na próxima alteração de campo.
    if (typeof validarLancamento === 'function' && document.querySelector('#combustiveisNota .linha-combustivel')) {
        validarLancamento();
    }
    mostrarToast('Configurações de alertas salvas!','sucesso',3000);
}

/* Copia o registro de falhas em texto puro: é assim que o operador manda
   o que aconteceu, sem depender de print de tela nem de console. */
function errosCopiar() {
    const erros = typeof errosRegistrados === "function" ? errosRegistrados() : [];
    if (!erros.length) return mostrarToast("Nenhuma falha registrada.", "info", 2500);
    const texto = erros.map(e =>
        `[${new Date(e.ts).toLocaleString('pt-BR')}] ${e.tipo} · tela ${e.tela} · ${e.usuario}${e.demo ? ' · demo' : ''}\n`
        + `${e.msg}\n${e.detalhe || ''}`).join("\n---\n");
    navigator.clipboard?.writeText(texto)
        .then(() => mostrarToast("Registro copiado. Cole na mensagem para quem mantém o sistema.", "sucesso", 4000))
        .catch(() => mostrarToast("Não consegui copiar. Selecione o texto da tabela à mão.", "aviso", 5000));
}

/*=================================================
  BACKUP.JS: Fuel Mind
  Backups automáticos no navegador, por usuário, e a restauração deles.

  Parte do antigo app.js, quebrado em 18/09/2026 (programa 6.5).
=================================================*/
/* Diario, guardando uma semana. Era a cada 3 dias com 3 copias: pouco
   para quem lanca nota todo dia. Custa espaco no navegador (ver o bloco
   das duas paredes em sistema.js), e por isso a gravacao abaixo aceita
   falhar: quando a cota aperta, ela apaga a copia mais antiga e tenta de
   novo, guardando quantas couberem. (21/09/2026) */
const BACKUP_AUTO_INTERVALO_DIAS = 1;
const BACKUP_AUTO_MAX = 7;

/* Os backups automáticos são POR USUÁRIO. Antes eram uma lista só no
   navegador, com o banco de quem estava logado: o operador que entrava
   depois do supremo no mesmo computador podia restaurar o backup dele e
   passar a ver as notas de todas as empresas. */
function _prefixoBackupAuto() {
    const uid = window._usuarioAtual?.uid;
    return uid ? `backupAuto_${uid}_` : null;
}

function verificarBackupAutomatico() {
    const uid = window._usuarioAtual?.uid;
    if (!uid) return;
    const ultimo = localStorage.getItem("backupAutoData_" + uid);
    const dias = ultimo ? (Date.now() - parseInt(ultimo)) / 86400000 : Infinity;
    if (dias >= BACKUP_AUTO_INTERVALO_DIAS) fazerBackupAutomatico();
}

/**
 * Grava a cópia periódica do banco no `localStorage`.
 *
 * A falha aqui não pode ser silenciosa. O caminho que ela toma na prática
 * é a quota do navegador: são oito cópias do banco vivendo lá dentro
 * (a cópia local a cada salvamento, mais até sete backups automáticos), e
 * a ~440 bytes por lançamento os ~5 MB acabam em torno de mil e quatrocentas
 * notas somando todas as empresas.
 *
 * A tentativa de liberar espaço apagando a cópia mais antiga vem antes do
 * aviso: na maior parte das vezes ela resolve.
 */
function fazerBackupAutomatico() {
    const prefixo = _prefixoBackupAuto();
    if (!prefixo) return;
    const uid   = window._usuarioAtual.uid;
    const chave = prefixo + _hojeISO();
    const dados = JSON.stringify(db);

    // Backups do formato antigo, sem dono, só ocupavam espaço.
    Object.keys(localStorage)
        .filter(k => /^backupAuto_\d{4}-\d{2}-\d{2}$/.test(k))
        .forEach(k => localStorage.removeItem(k));

    const gravar = () => {
        const chaves = Object.keys(localStorage).filter(k => k.startsWith(prefixo)).sort();
        while (chaves.length >= BACKUP_AUTO_MAX) localStorage.removeItem(chaves.shift());
        localStorage.setItem(chave, dados);
        localStorage.setItem("backupAutoData_" + uid, Date.now().toString());
    };

    try {
        gravar();
        return;
    } catch (e) {
        console.warn("[Backup automático] Primeira tentativa falhou:", e.message);
    }

    try {
        const antigas = Object.keys(localStorage).filter(k => k.startsWith(prefixo)).sort();
        if (antigas.length) localStorage.removeItem(antigas[0]);
        gravar();
        return;
    } catch (e) {
        console.warn("[Backup automático] Falhou mesmo após liberar espaço:", e.message);
    }

    mostrarToast(
        "Não consegui gravar o backup automático: o armazenamento do navegador está cheio. "
        + "Baixe um backup em Sistema › Backup e avise o responsável.",
        "erro", 10000);
}

function listarBackupsAutomaticos() {
    const prefixo = _prefixoBackupAuto();
    if (!prefixo) return [];
    return Object.keys(localStorage)
        .filter(k => k.startsWith(prefixo)).sort().reverse()
        .map(chave => ({ chave, data: chave.slice(prefixo.length), tamanhoKB: (localStorage.getItem(chave).length/1024).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
}

/* ── RESTAURAR UM BACKUP ─────────────────────────────────────────────
   Antes a restauração trocava o `db` inteiro pelo arquivo. Três defeitos
   vinham disso: um backup que só tinha as notas de algumas empresas
   gravava as outras vazias; os cadastros criados depois do backup sumiam;
   e o listener religado antes da gravação desfazia a restauração, com a
   tela dizendo que tinha dado certo.

   Agora: os lançamentos são substituídos só nas empresas que o arquivo
   cobre (e que este usuário acessa); os cadastros do arquivo entram por
   cima dos atuais, sem apagar os que só existem hoje; e a mensagem de
   sucesso só aparece depois de a nuvem confirmar. */

/** Id, no cadastro atual, da empresa de uma nota do arquivo. */
function _idEmpresaNoBackup(dados, l) {
    const nome = (dados.empresas || []).find(e => e.id === l.empresaId)?.nome || l.empresa;
    const porId = l.empresaId && (db.empresas || []).some(e => e.id === l.empresaId) ? l.empresaId : null;
    const noArquivo = (dados.empresas || []).find(e => e.nome === l.empresa)?.id;
    return porId || noArquivo || (db.empresas || []).find(e => e.nome === nome)?.id || null;
}

/** Texto do que a restauração vai fazer, empresa por empresa. */
function _resumoRestauracao(dados) {
    const permitidos = new Set(_empresaIdsPermitidos());
    const noArquivo = {};
    let fora = 0;
    (dados.lancamentos || []).forEach(l => {
        const id = _idEmpresaNoBackup(dados, l);
        if (!id || !permitidos.has(id)) { fora++; return; }
        noArquivo[id] = (noArquivo[id] || 0) + 1;
    });
    const hoje = {};
    db.lancamentos.forEach(l => { const id = _empresaIdDoLancamento(l); if (id) hoje[id] = (hoje[id] || 0) + 1; });

    const nomeDe = id => (db.empresas || []).find(e => e.id === id)?.nome
        || (dados.empresas || []).find(e => e.id === id)?.nome || id;
    const linhas = Object.keys(noArquivo).map(id =>
        `• ${nomeDe(id)}: hoje ${hoje[id] || 0} → depois ${noArquivo[id]} lançamento(s)`);
    const intocadas = [...permitidos].filter(id => !noArquivo[id] && hoje[id])
        .map(id => `• ${nomeDe(id)}: fica como está (${hoje[id]} lançamento(s)), pois o arquivo não tem notas dela`);
    return [
        linhas.length ? linhas.join("\n") : "O arquivo não tem lançamentos de empresas que você acessa.",
        intocadas.length ? "\n" + intocadas.join("\n") : "",
        fora ? `\n${fora} lançamento(s) do arquivo são de empresas fora do cadastro ou do seu acesso e ficam de fora.` : "",
        "\nOs cadastros do arquivo entram por cima dos atuais; os que só existem hoje continuam."
    ].join("\n");
}

function _aplicarBackupNaMemoria(dados) {
    _LISTAS_COMPARTILHADO.forEach(campo => {
        // Os fechamentos ficam como estão hoje: o de um backup antigo
        // reabriria, sem motivo e sem histórico, o mês fechado depois dele.
        if (campo === 'fechamentosMes') return;
        const doBackup = Array.isArray(dados[campo]) ? dados[campo] : [];
        const chaves   = new Set(doBackup.map(_chaveItem));
        db[campo] = doBackup.concat((db[campo] || []).filter(i => !chaves.has(_chaveItem(i))));
    });
    if (dados.configRelatorio && typeof dados.configRelatorio === 'object') db.configRelatorio = dados.configRelatorio;
    if (dados.configAlertas && typeof dados.configAlertas === 'object')     db.configAlertas   = dados.configAlertas;

    const permitidos = new Set(_empresaIdsPermitidos());
    const cobertas = new Set();
    const notas = [];
    (dados.lancamentos || []).forEach(l => {
        const id = _idEmpresaNoBackup(dados, l);
        if (!id || !permitidos.has(id)) return;
        cobertas.add(id);
        const nome = (db.empresas || []).find(e => e.id === id)?.nome;
        notas.push(Object.assign({}, l, { empresaId: id }, nome ? { empresa: nome } : {}));
    });
    db.lancamentos = db.lancamentos
        .filter(l => !cobertas.has(_empresaIdDoLancamento(l)))
        .concat(notas);
}

/** Grava já e diz a verdade sobre o resultado. */
async function _salvarEConfirmar(rotulo) {
    if (typeof demoAtivo === 'function' && demoAtivo()) {
        salvarDB();
        mostrarToast(`${rotulo}.`, "sucesso", 5000);
        return true;
    }
    await salvarDB({ imediato: true });
    if (_cargaOk && !_pendentesSincronizacao) {
        mostrarToast(`${rotulo} e gravado na nuvem.`, "sucesso", 5000);
        return true;
    }
    mostrarToast(`${rotulo} neste navegador, mas a nuvem ainda não confirmou. `
        + `Não feche a aba até a pílula de sincronização sumir.`, "aviso", 10000);
    return false;
}

async function restaurarBackupAutomatico(chave) {
    if (!exigirPapel("supremo", "Restaurar backup")) return;
    const prefixo = _prefixoBackupAuto();
    if (!prefixo || !String(chave).startsWith(prefixo)) return mostrarToast("Backup não encontrado.", "erro", 4000);
    const bruto = localStorage.getItem(chave);
    if (!bruto) return mostrarToast("Backup não encontrado.", "erro", 4000);
    let dados;
    try { dados = JSON.parse(bruto); } catch (e) { return mostrarToast("Backup corrompido: " + e.message, "erro", 5000); }
    if (!await fmConfirm({
        titulo: "Restaurar backup?",
        msg: `Data: ${chave.slice(prefixo.length)}\n\n${_resumoRestauracao(dados)}`,
        confirmTxt: "Restaurar", cancelTxt: "Cancelar", tipo: "perigo" })) return;
    try {
        const foto = _travaFoto();
        _aplicarBackupNaMemoria(_mesclarComPadrao(dados));
        if (_travaBarrar(foto, "Restaurar backup")) return;
        migrarDados();
        atualizarListas();
        _reconciliarEmpresaAtiva();
        atualizarInfoSistema();
        _rerenderTelaAtual();
        await _salvarEConfirmar("Backup restaurado");
    } catch(e) { mostrarToast("Erro ao restaurar: " + e.message, "erro", 5000); }
}

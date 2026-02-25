/*=================================================
  BACKUP
=================================================*/
function baixarBackup() {
    const json = JSON.stringify(db, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const data = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `backup-combustivel-${data}.json`;
    a.click();
    URL.revokeObjectURL(url);
    mostrarToast("Backup baixado com sucesso!", "sucesso");
}

/*=================================================
  RESTAURAR BACKUP
=================================================*/
function restaurarBackup(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const dados = JSON.parse(e.target.result);

            if (
                !Array.isArray(dados.motoristas)  ||
                !Array.isArray(dados.veiculos)     ||
                !Array.isArray(dados.empresas)     ||
                !Array.isArray(dados.combustiveis) ||
                !Array.isArray(dados.lancamentos)
            ) {
                throw new Error("Arquivo não é um backup válido deste sistema.");
            }

            if (!confirm(
                `Restaurar backup?\n\n` +
                `• ${dados.motoristas.length} motoristas\n` +
                `• ${dados.veiculos.length} veículos\n` +
                `• ${dados.empresas.length} empresas\n` +
                `• ${dados.combustiveis.length} combustíveis\n` +
                `• ${dados.lancamentos.length} lançamentos\n\n` +
                `Os dados atuais serão substituídos. Continuar?`
            )) return;

            db = dados;
            salvarDB();
            migrarDados();
            atualizarListas();
            atualizarInfoSistema();
            mostrarToast("Backup restaurado com sucesso!", "sucesso");
        } catch (err) {
            alert("❌ Erro ao restaurar backup:\n" + err.message);
        }
    };
    reader.readAsText(file);
    input.value = "";
}

/*=================================================
  RESET SEGURO
=================================================*/
function resetSeguro() {
    if (!confirm(
        "⚠️ ATENÇÃO: Esta ação apagará TODOS os dados permanentemente.\n\n" +
        "Recomendamos fazer um backup antes de continuar.\n\n" +
        "Deseja prosseguir?"
    )) return;

    if (!confirm(
        "❗ Última confirmação.\n\n" +
        "Todos os lançamentos, motoristas, veículos, empresas e combustíveis serão apagados.\n\n" +
        "Tem CERTEZA que deseja apagar tudo?"
    )) return;

    db = { motoristas: [], veiculos: [], empresas: [], combustiveis: [], lancamentos: [] };
    salvarDB();
    atualizarListas();
    atualizarInfoSistema();
    mostrarToast("Sistema resetado. Todos os dados foram apagados.", "aviso", 5000);
}

/*=================================================
  BACKUPS AUTOMÁTICOS — exibe lista na tela Sistema
=================================================*/
function renderBackupsAuto() {
    const el = document.getElementById("listaBackupsAuto");
    if (!el) return;

    const lista = listarBackupsAutomaticos();

    if (lista.length === 0) {
        el.innerHTML = `<p class="dica" style="margin:0">Nenhum backup automático encontrado ainda. O próximo será criado em até 3 dias.</p>`;
        return;
    }

    el.innerHTML = `
        <table style="width:100%; font-size:0.84rem; border-collapse:collapse; margin-top:4px">
            <thead>
                <tr style="background:var(--surface-alt)">
                    <th style="padding:7px 12px; text-align:left; font-size:0.64rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-light)">Data</th>
                    <th style="padding:7px 12px; text-align:left; font-size:0.64rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-light)">Tamanho</th>
                    <th style="padding:7px 12px; text-align:left; font-size:0.64rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-light)">Ação</th>
                </tr>
            </thead>
            <tbody>
                ${lista.map(b => `
                    <tr style="border-bottom:1px solid var(--border-light)">
                        <td style="padding:8px 12px">${b.data}</td>
                        <td style="padding:8px 12px; color:var(--text-muted); font-family:monospace">${b.tamanhoKB} KB</td>
                        <td style="padding:8px 12px">
                            <button class="btn-secundario" onclick="restaurarBackupAutomatico('${b.chave}')">Restaurar</button>
                        </td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

/*=================================================
  INFORMAÇÕES DO SISTEMA
=================================================*/
function atualizarInfoSistema() {
    const tamanhoKB = (JSON.stringify(db).length / 1024).toFixed(1);

    document.getElementById("infoSistema").innerHTML = `
        <div class="info-card">
            <div class="info-card-valor">${db.lancamentos.length}</div>
            <div class="info-card-label">Lançamentos</div>
        </div>
        <div class="info-card">
            <div class="info-card-valor">${db.motoristas.length}</div>
            <div class="info-card-label">Motoristas</div>
        </div>
        <div class="info-card">
            <div class="info-card-valor">${db.veiculos.length}</div>
            <div class="info-card-label">Veículos</div>
        </div>
        <div class="info-card">
            <div class="info-card-valor">${db.empresas.length}</div>
            <div class="info-card-label">Empresas</div>
        </div>
        <div class="info-card">
            <div class="info-card-valor">${db.combustiveis.length}</div>
            <div class="info-card-label">Combustíveis</div>
        </div>
        <div class="info-card">
            <div class="info-card-valor">${tamanhoKB} KB</div>
            <div class="info-card-label">Tamanho dos Dados</div>
        </div>
    `;

    // Atualiza também a lista de backups automáticos
    renderBackupsAuto(); }
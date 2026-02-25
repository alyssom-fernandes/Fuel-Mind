/*=================================================
  BANCO DE DADOS LOCAL
=================================================*/
let db = {
    motoristas: [],
    veiculos: [],
    empresas: [],
    combustiveis: [],
    lancamentos: [],
    medicoes: {},       // { "S10": { "2025-01-15": { saida: 5000, veeder: 12500 } } }
    estoqueInicial: {}, // { "S10": 15000 }
    taxasFrete: {}      // { "S10": 0.05, "Gasolina": 0.06 }
};

function salvarDB() {
    localStorage.setItem("db", JSON.stringify(db));
}

function carregarDB() {
    const dados = localStorage.getItem("db");
    if (dados) db = JSON.parse(dados);
}

function migrarDados() {
    if (db.motoristas.length > 0 && typeof db.motoristas[0] === "string") {
        db.motoristas = db.motoristas.map(nome => ({
            id: Date.now() + Math.random(), nome: nome, ativo: true
        }));
        salvarDB();
    }
    if (db.veiculos.length > 0 && typeof db.veiculos[0] === "string") {
        db.veiculos = db.veiculos.map(placa => ({
            id: Date.now() + Math.random(), nome: placa, ativo: true
        }));
        salvarDB();
    }
    if (db.combustiveis.length > 0 && typeof db.combustiveis[0] === "string") {
        db.combustiveis = db.combustiveis.map(nome => ({
            id: Date.now() + Math.random(), nome: nome, perda: 0
        }));
        salvarDB();
    }
}

carregarDB();
migrarDados();

// Garante que campos novos existam em backups antigos
if (!db.medicoes)       { db.medicoes = {};       salvarDB(); }
if (!db.estoqueInicial) { db.estoqueInicial = {};  salvarDB(); }
if (!db.taxasFrete)     { db.taxasFrete = {};      salvarDB(); }

/*=================================================
  MODO ESCURO
=================================================*/
function toggleModoEscuro() {
    const html = document.documentElement;
    const novo = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", novo);
    document.getElementById("iconeTema").textContent = novo === "dark" ? "☀️" : "🌙";
    localStorage.setItem("tema", novo);
}

    // Re-renderiza o gráfico de estoque se estiver visível (cores mudam com o tema)
    requestAnimationFrame(() => {
        if (typeof estoqueAbaAtiva !== "undefined" && estoqueAbaAtiva &&
            document.getElementById("estoque")?.style.display !== "none") {
            estoqueRenderGrafico(estoqueAbaAtiva);
        }
    });


function aplicarTemasSalvo() {
    const temaSalvo = localStorage.getItem("tema");
    if (temaSalvo === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        const icone = document.getElementById("iconeTema");
        if (icone) icone.textContent = "☀️";
    }
}
aplicarTemasSalvo();

/*=================================================
  TOAST — notificação discreta de ação realizada
  Uso: mostrarToast("Lançamento salvo!", "sucesso")
  Tipos: "sucesso" | "erro" | "aviso" | "info"
=================================================*/
function mostrarToast(mensagem, tipo = "sucesso", duracao = 3000) {
    // Remove toast anterior se existir
    const anterior = document.getElementById("toastSistema");
    if (anterior) anterior.remove();

    const toast = document.createElement("div");
    toast.id = "toastSistema";
    toast.className = `toast toast-${tipo}`;

    const icones = { sucesso: "✓", erro: "✕", aviso: "⚠", info: "i" };
    toast.innerHTML = `<span class="toast-icone">${icones[tipo] || "i"}</span><span class="toast-msg">${mensagem}</span>`;

    document.body.appendChild(toast);

    // Anima entrada
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { toast.classList.add("toast-visivel"); });
    });

    // Remove após duração
    setTimeout(() => {
        toast.classList.remove("toast-visivel");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, duracao);
}

/*=================================================
  FORMULÁRIO SUJO — avisa sobre dados não salvos
  Marca o formulário como "sujo" quando editado.
  Limpa ao salvar ou cancelar.
=================================================*/
let _formularioSujo = false;

function marcarFormularioSujo() {
    _formularioSujo = true;
    // Mostra indicador visual discreto no título
    const titulo = document.getElementById("tituloLancamento");
    if (titulo && !titulo.textContent.includes("●")) {
        titulo.textContent = "● " + titulo.textContent;
    }
}

function limparFormularioSujo() {
    _formularioSujo = false;
    const titulo = document.getElementById("tituloLancamento");
    if (titulo) titulo.textContent = titulo.textContent.replace("● ", "");
}

// Intercepta navegação para outra tela com formulário sujo
function confirmarSaidaFormulario() {
    if (!_formularioSujo) return true;
    return confirm(
        "Você tem dados não salvos no formulário de Lançamento.\n\n" +
        "Sair agora vai descartar tudo que foi preenchido. Continuar?"
    );
}

/*=================================================
  CONTROLE DE TELAS
=================================================*/
function mostrarTela(id) {
    // Se está saindo de lançamentos com formulário sujo, confirma
    const telaAtual = document.querySelector(".tela[style*='block']");
    if (telaAtual?.id === "lancamentos" && id !== "lancamentos") {
        if (!confirmarSaidaFormulario()) return;
    }

    document.querySelectorAll(".tela").forEach(t => t.style.display = "none");
    document.getElementById(id).style.display = "block";

    if (id === "motoristas" || id === "veiculos" || id === "empresas" || id === "combustiveis") atualizarListas();
    if (id === "historico")  preencherSelectsHistorico();
    if (id === "analitico")  preencherSelectsAnalitico();
    if (id === "sistema")    atualizarInfoSistema();
    if (id === "dashboard")  carregarDashboard();
    if (id === "relatorios") carregarRelatorio();
    if (id === "estoque")    carregarEstoque();
    if (id === "fretes")     carregarFretes();

    // Limpa estado de sujo ao entrar em lançamentos (novo lançamento)
    if (id === "lancamentos") limparFormularioSujo();
}

/*=================================================
  BACKUP AUTOMÁTICO PERIÓDICO
  Salva uma cópia no localStorage a cada 3 dias.
  Mantém os últimos 3 backups automáticos.
  Não substitui o backup manual do usuário.
=================================================*/
const BACKUP_AUTO_INTERVALO_DIAS = 3;
const BACKUP_AUTO_MAX            = 3;

function verificarBackupAutomatico() {
    const ultimoBackup = localStorage.getItem("backupAutoData");
    const agora = Date.now();
    const diasPassados = ultimoBackup
        ? (agora - parseInt(ultimoBackup)) / (1000 * 60 * 60 * 24)
        : Infinity;

    if (diasPassados >= BACKUP_AUTO_INTERVALO_DIAS) {
        fazerBackupAutomatico();
    }
}

function fazerBackupAutomatico() {
    try {
        const agora = new Date();
        const chave = `backupAuto_${agora.toISOString().slice(0, 10)}`;
        const dados = JSON.stringify(db);

        // Rotaciona: remove os mais antigos se já tiver o máximo
        const chaves = Object.keys(localStorage)
            .filter(k => k.startsWith("backupAuto_"))
            .sort();

        while (chaves.length >= BACKUP_AUTO_MAX) {
            localStorage.removeItem(chaves.shift());
        }

        localStorage.setItem(chave, dados);
        localStorage.setItem("backupAutoData", Date.now().toString());

        console.info(`[Backup automático] Salvo em ${chave} (${(dados.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
        console.warn("[Backup automático] Falhou:", e.message);
    }
}

function listarBackupsAutomaticos() {
    return Object.keys(localStorage)
        .filter(k => k.startsWith("backupAuto_"))
        .sort()
        .reverse()
        .map(chave => {
            const data = chave.replace("backupAuto_", "");
            const tamanhoKB = (localStorage.getItem(chave).length / 1024).toFixed(1);
            return { chave, data, tamanhoKB };
        });
}

function restaurarBackupAutomatico(chave) {
    const dados = localStorage.getItem(chave);
    if (!dados) return alert("Backup não encontrado.");
    if (!confirm(`Restaurar o backup automático de ${chave.replace("backupAuto_", "")}?\n\nOs dados atuais serão substituídos.`)) return;
    try {
        db = JSON.parse(dados);
        salvarDB();
        migrarDados();
        atualizarListas();
        atualizarInfoSistema();
        mostrarToast("Backup automático restaurado com sucesso!", "sucesso");
    } catch (e) {
        alert("Erro ao restaurar: " + e.message);
    }
}

// Roda ao iniciar
verificarBackupAutomatico();

/*=================================================
  UTILITÁRIOS
=================================================*/
function formatarData(dataISO) {
    if (!dataISO) return "—";
    const [ano, mes, dia] = dataISO.split("-");
    return `${dia}/${mes}/${ano}`;
}

function nomeMes(anoMes) {
    const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    const [ano, mes] = anoMes.split("-");
    return `${meses[parseInt(mes, 10) - 1]}/${ano.slice(2)}`;
}

function fmtR(v) {
    // Formata em reais com ponto nos milhares e vírgula nos centavos: R$ 178.111,23
    return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtL(v, decimais = 0) {
    // Formata litros com ponto nos milhares e vírgula nos decimais: 33.123,000 L
    return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: decimais, maximumFractionDigits: decimais }) + " L";
}

// Formata litros com 3 casas decimais: 33.123,456 L
function fmtL3(v) { return fmtL(v, 3); }

// Formata R$ com 4 casas decimais (preço unitário): R$ 5,6789
function fmtR4(v) {
    return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function preencherSelect(idSelect, itens, textoPadrao) {
    const sel = document.getElementById(idSelect);
    if (!sel) return;
    sel.innerHTML = `<option value="">-- ${textoPadrao} --</option>` +
        itens.map(i => `<option value="${i.valor}">${i.texto}</option>`).join("");
}

/*=================================================
  FILTROS RÁPIDOS DE DATA — Melhoria 6
  Botões "Hoje", "Este mês", "Mês anterior", "Este ano"
  para preenchimento automático dos campos de filtro.
  Uso: filtroRapido("relatorio", "mes") etc.
=================================================*/
function filtroRapido(contexto, periodo) {
    const hoje = new Date();
    let inicio, fim;

    if (periodo === "hoje") {
        inicio = fim = hoje.toISOString().slice(0, 10);

    } else if (periodo === "mes") {
        inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
        fim    = hoje.toISOString().slice(0, 10);

    } else if (periodo === "mes_anterior") {
        const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        const ultimoDia   = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
        inicio = mesAnterior.toISOString().slice(0, 10);
        fim    = ultimoDia.toISOString().slice(0, 10);

    } else if (periodo === "ano") {
        inicio = `${hoje.getFullYear()}-01-01`;
        fim    = hoje.toISOString().slice(0, 10);
    }

    // Preenche os inputs corretos conforme o contexto
    if (contexto === "relatorio") {
        document.getElementById("filtroDataInicio").value = inicio;
        document.getElementById("filtroDataFim").value    = fim;
        carregarRelatorio();
    } else if (contexto === "historico") {
        document.getElementById("historicoDataInicio").value = inicio;
        document.getElementById("historicoDataFim").value    = fim;
        carregarHistorico();
    } else if (contexto === "analitico") {
        document.getElementById("analiticoInicio").value = inicio;
        document.getElementById("analiticoFim").value    = fim;
        carregarAnalitico();
    }
}

/*=================================================
  INICIALIZAÇÃO
=================================================*/
atualizarListas();
mostrarTela("dashboard");
db = {
    motoristas: [],
    veiculos: [],
    empresas: [],
    combustiveis: [],
    lancamentos: [],
    medicoes: {},       // { "S10": { "2025-01-15": { saida: 5000, veeder: 12500 } } }
    estoqueInicial: {}, // { "S10": 15000 }
    taxasFrete: {}      // { "S10": 0.05, "Gasolina": 0.06 }
};

function salvarDB() {
    localStorage.setItem("db", JSON.stringify(db));
}

function carregarDB() {
    const dados = localStorage.getItem("db");
    if (dados) db = JSON.parse(dados);
}

function migrarDados() {
    if (db.motoristas.length > 0 && typeof db.motoristas[0] === "string") {
        db.motoristas = db.motoristas.map(nome => ({
            id: Date.now() + Math.random(), nome: nome, ativo: true
        }));
        salvarDB();
    }
    if (db.veiculos.length > 0 && typeof db.veiculos[0] === "string") {
        db.veiculos = db.veiculos.map(placa => ({
            id: Date.now() + Math.random(), nome: placa, ativo: true
        }));
        salvarDB();
    }
    if (db.combustiveis.length > 0 && typeof db.combustiveis[0] === "string") {
        db.combustiveis = db.combustiveis.map(nome => ({
            id: Date.now() + Math.random(), nome: nome, perda: 0
        }));
        salvarDB();
    }
}

carregarDB();
migrarDados();

// Garante que campos novos existam em backups antigos
if (!db.medicoes)       { db.medicoes = {};       salvarDB(); }
if (!db.estoqueInicial) { db.estoqueInicial = {};  salvarDB(); }
if (!db.taxasFrete)     { db.taxasFrete = {};      salvarDB(); }
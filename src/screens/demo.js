/*=================================================
  DEMO.JS: Modo demonstração

  Um ambiente isolado, com dados fictícios, para
  explorar o sistema sem tocar na base real.

  REGRA INEGOCIÁVEL DESTE MÓDULO
  Em modo demo o Firestore NUNCA é acessado. A trava
  vive em `salvarDB` e `carregarDB` (sincronizacao.js), que
  consultam `demoAtivo()` antes de qualquer chamada de
  rede. Os dados vivem só no localStorage, sob uma
  chave própria, e são regenerados a cada dia.

  Serve para: demonstrar o sistema, treinar alguém,
  testar comportamento por papel e por empresa sem
  precisar de credencial. NÃO exercita as regras de
  segurança do servidor, essas só se verificam contra
  o Firestore de verdade.
=================================================*/

const DEMO_CHAVE      = "fuelmind_demo_dados";
const DEMO_CHAVE_DATA = "fuelmind_demo_gerado_em";
const DEMO_CHAVE_USER = "fuelmind_demo_usuario";

/* ─── PERFIS DE DEMONSTRAÇÃO ───────────────────────────────────────────
   Três papéis com alcances diferentes, para que dê para ver o
   isolamento por empresa funcionando ao alternar entre eles.
   ────────────────────────────────────────────────────────────────────*/
const DEMO_USUARIOS = [
    {
        uid: "demo-supremo",
        nome: "Ana Ribeiro",
        email: "ana@demo.local",
        username: "ana.demo",
        role: "supremo",
        empresas: [],
        empresaIds: [],
        ativo: true,
        descricao: "Acesso total: enxerga as três empresas"
    },
    {
        uid: "demo-admin",
        nome: "Bruno Tavares",
        email: "bruno@demo.local",
        username: "bruno.demo",
        role: "admin",
        empresas: ["Transportadora Aurora", "Rodoviário Bandeirante"],
        empresaIds: ["demo-emp-1", "demo-emp-2"],
        ativo: true,
        descricao: "Duas empresas: gerencia usuários delas"
    },
    {
        uid: "demo-usuario",
        nome: "Carla Menezes",
        email: "carla@demo.local",
        username: "carla.demo",
        role: "usuario",
        empresas: ["Rodoviário Bandeirante"],
        empresaIds: ["demo-emp-2"],
        ativo: true,
        descricao: "Uma empresa: só operação"
    }
];

/* ─── GERAÇÃO DETERMINÍSTICA ───────────────────────────────────────────
   Sem Math.random: um gerador com semente fixa produz sempre o mesmo
   conjunto. Assim o reset diário devolve exatamente a mesma base, e um
   problema encontrado hoje é reproduzível amanhã.
   ────────────────────────────────────────────────────────────────────*/
function _demoRand(semente) {
    let s = semente;
    return function () {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
    };
}

/* Taxas com duas casas desde 22/09/2026, acompanhando a digitação. Com
   0,3450 a tela escrevia "R$ 0,35/L" e o frete era calculado com 0,345:
   a demonstração reintroduziria justamente a divergência entre o que se lê
   e o que se soma que a mudança foi feita para tirar. */
const DEMO_EMPRESAS = [
    { id: "demo-emp-1", nome: "Transportadora Aurora",   municipio: "Campinas, SP",  taxaFrete: 0.28 },
    { id: "demo-emp-2", nome: "Rodoviário Bandeirante",  municipio: "Sorocaba, SP",  taxaFrete: 0.35 },
    { id: "demo-emp-3", nome: "Expresso Vale Verde",     municipio: "Ribeirão Preto, SP", taxaFrete: 0.31 }
];

const DEMO_MOTORISTAS = [
    "Adilson Barreto", "Benedito Farias", "Cleiton Andrade", "Douglas Prado",
    "Edmilson Rocha", "Fabiano Teles", "Gilmar Antunes", "Hélio Marques"
];

const DEMO_PLACAS = [
    "RQA2B34", "RQB5C67", "RQC8D90", "RQD1E23",
    "RQE4F56", "RQF7G89", "RQG0H12", "RQH3I45"
];

const DEMO_COMBUSTIVEIS = [
    { nome: "Diesel S10",  perda: 0.30, precoBase: 6.18 },
    { nome: "Diesel S500", perda: 0.30, precoBase: 5.94 },
    { nome: "Gasolina",    perda: 0.60, precoBase: 6.05 },
    { nome: "Etanol",      perda: 0.60, precoBase: 4.12 }
];

const DEMO_BASES = ["Base Paulínia", "Base Guarulhos", "Base Betim"];

/**
 * Monta a base fictícia inteira. Determinística: mesma semente, mesmo
 * resultado, sempre.
 */
function _demoGerarBase() {
    const rnd = _demoRand(20260831);
    const hoje = new Date();

    const empresas = DEMO_EMPRESAS.map(e => Object.assign({}, e, {
        ativo: true,
        logs: ["Criado na base de demonstração"]
    }));

    const motoristas = DEMO_MOTORISTAS.map((nome, i) => ({
        id: "demo-mot-" + i, nome, ativo: true, logs: []
    }));

    const veiculos = DEMO_PLACAS.map((nome, i) => ({
        id: "demo-vei-" + i, nome, ativo: true, logs: []
    }));

    const combustiveis = DEMO_COMBUSTIVEIS.map((c, i) => ({
        id: "demo-comb-" + i, nome: c.nome, perda: c.perda, ativo: true, logs: []
    }));

    const bases = DEMO_BASES.map((nome, i) => ({
        id: "demo-base-" + i, nome, ativo: true, logs: []
    }));

    const conjuntosVeiculos = [
        {
            id: "demo-conj-1", nome: "Bitrem Aurora 01",
            composicaoAtual: [DEMO_PLACAS[0], DEMO_PLACAS[1]],
            historico: [{ placas: [DEMO_PLACAS[0], DEMO_PLACAS[1]], vigenciaDe: "2024-01-01", vigenciaAte: null }],
            ativo: true, logs: []
        },
        {
            id: "demo-conj-2", nome: "Rodotrem Bandeirante 01",
            composicaoAtual: [DEMO_PLACAS[2], DEMO_PLACAS[3], DEMO_PLACAS[4]],
            historico: [{ placas: [DEMO_PLACAS[2], DEMO_PLACAS[3], DEMO_PLACAS[4]], vigenciaDe: "2024-01-01", vigenciaAte: null }],
            ativo: true, logs: []
        }
    ];

    // ── Lançamentos: 8 meses de histórico, para os gráficos terem curva ──
    //
    // O volume por mês é alto de propósito. Com a dúzia de notas que havia
    // antes, cada combinação de empresa e combustível ficava com uma ou duas
    // notas de histórico e a referência de preço não tinha o que mostrar. O
    // modo demo existe para mostrar o sistema inteiro, então precisa de
    // histórico que sustente os avisos. Cem notas por mês, divididas por três
    // empresas e quatro combustíveis, dão cerca de duas observações por
    // combinação na janela de sete dias da referência de preço. Também é mais
    // fiel à operação real, de 10 a 30 notas por dia.
    const lancamentos = [];
    let contador = 1000;

    for (let mesAtras = 7; mesAtras >= 0; mesAtras--) {
        const base = new Date(hoje.getFullYear(), hoje.getMonth() - mesAtras, 1);
        const diasNoMes = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        const quantidade = 84 + Math.floor(rnd() * 24);

        for (let n = 0; n < quantidade; n++) {
            const dia = 1 + Math.floor(rnd() * diasNoMes);
            const dataNota = new Date(base.getFullYear(), base.getMonth(), dia);
            if (dataNota > hoje) continue;

            const dataDescarga = new Date(dataNota);
            dataDescarga.setDate(dataDescarga.getDate() + Math.floor(rnd() * 3));

            // Empresa e combustível são distribuídos em ciclo, não sorteados.
            // Sorteio uniforme deixa combinações de fora por azar, e a
            // referência de preço filtra por empresa E combustível: bastava
            // uma combinação ficar com menos de cinco notas em trinta dias
            // para o alerta emudecer justamente na demonstração. O ciclo
            // garante cobertura pareja; motorista, placa, base e valores
            // continuam sorteados, então os relatórios não ficam robóticos.
            const par  = n % (empresas.length * DEMO_COMBUSTIVEIS.length);
            const emp  = empresas[par % empresas.length];
            const comb = DEMO_COMBUSTIVEIS[Math.floor(par / empresas.length)];

            // Preço oscila ±6% em torno da base, com leve alta ao longo do tempo
            const tendencia = 1 + (7 - mesAtras) * 0.004;
            const valor = +(comb.precoBase * tendencia * (0.97 + rnd() * 0.06)).toFixed(4);

            const qtd = Math.round((8000 + rnd() * 22000) / 500) * 500;
            // Descarga quase sempre igual à carga; perda pequena e ocasional
            const perdeu = rnd() < 0.18;
            const qtdDescargada = perdeu ? +(qtd * (0.996 + rnd() * 0.003)).toFixed(3) : 0;

            const total = +(qtd * valor).toFixed(2);

            lancamentos.push({
                id: "demo-lanc-" + (contador++),
                dataNota:     _demoISO(dataNota),
                dataDescarga: _demoISO(dataDescarga > hoje ? dataNota : dataDescarga),
                numeroNota:   String(100000 + contador),
                base:         DEMO_BASES[Math.floor(rnd() * DEMO_BASES.length)],
                empresa:      emp.nome,
                motorista:    DEMO_MOTORISTAS[Math.floor(rnd() * DEMO_MOTORISTAS.length)],
                placa:        DEMO_PLACAS[Math.floor(rnd() * DEMO_PLACAS.length)],
                itens: [{
                    tipo: comb.nome, qtd, qtdDescargada, valor, total
                }],
                total,
                observacoes: "",
                anexos: [],
                logs: [{ acao: "Criado", ts: dataNota.toISOString(), usuario: "Base de demonstração" }]
            });
        }
    }

    lancamentos.sort((a, b) => a.dataNota.localeCompare(b.dataNota));

    return {
        motoristas, veiculos, empresas, combustiveis, bases,
        conjuntosVeiculos, lancamentos,
        configRelatorio: {
            titulo: "Controle de Entradas de Combustível (Demonstração)",
            mostrarBase: true, mostrarEmpresa: true,
            mostrarMotorista: true, mostrarPlaca: true,
            orientacao: "landscape"
        }
    };
}

function _demoISO(d) {
    return d.getFullYear() + "-" +
           String(d.getMonth() + 1).padStart(2, "0") + "-" +
           String(d.getDate()).padStart(2, "0");
}

/* ─── ESTADO ─── */

/** true enquanto a sessão estiver em modo demonstração. */
function demoAtivo() {
    return window._demoAtivo === true;
}

/** Data de hoje como AAAA-MM-DD, usada para decidir o reset diário. */
function _demoHoje() {
    return _demoISO(new Date());
}

/**
 * Devolve a base demo, regenerando se for de outro dia.
 * O reset diário existe para que qualquer bagunça feita na demonstração
 * desapareça sozinha, sem ninguém precisar lembrar de limpar.
 */
function _demoCarregarOuGerar() {
    const gerado = localStorage.getItem(DEMO_CHAVE_DATA);
    const bruto  = localStorage.getItem(DEMO_CHAVE);

    if (bruto && gerado === _demoHoje()) {
        try { return JSON.parse(bruto); } catch (_) { /* regenera abaixo */ }
    }
    return demoResetarDados(true);
}

/**
 * Regenera a base fictícia a partir da semente.
 * @param {boolean} silencioso - sem toast, usado na carga automática
 */
function demoResetarDados(silencioso) {
    const base = _demoGerarBase();
    try {
        localStorage.setItem(DEMO_CHAVE, JSON.stringify(base));
        localStorage.setItem(DEMO_CHAVE_DATA, _demoHoje());
    } catch (e) {
        console.warn("[Demo] Não foi possível gravar no localStorage:", e.message);
    }
    if (!silencioso) {
        db = _mesclarComPadrao(JSON.parse(JSON.stringify(base)));
        _travaAtualizarAprovado();
        atualizarListas();
        mostrarTela("dashboard");
        carregarDashboard();
        mostrarToast("Dados de demonstração restaurados.", "sucesso", 4000);
    }
    return base;
}

/**
 * Grava o estado da demo: substitui salvarDB enquanto o modo está ativo.
 *
 * Preserva os lançamentos das empresas que o perfil atual NÃO enxerga.
 * Sem isso, um usuário restrito gravaria sua visão parcial por cima da
 * base inteira e apagaria as demais empresas, exatamente o que
 * `_montarPayloads` evita em produção, onde cada perfil só escreve nos
 * documentos das suas próprias empresas.
 */
function demoSalvar() {
    try {
        const perfil = window._usuarioAtual;
        let saida = db;

        if (perfil && perfil.role !== "supremo") {
            const bruto = localStorage.getItem(DEMO_CHAVE);
            const base  = bruto ? JSON.parse(bruto) : null;
            if (base) {
                const minhas  = perfil.empresas || [];
                const alheios = (base.lancamentos || []).filter(l => !minhas.includes(l.empresa));
                saida = Object.assign({}, db, { lancamentos: alheios.concat(db.lancamentos) });
            }
        }

        localStorage.setItem(DEMO_CHAVE, JSON.stringify(saida));
        localStorage.setItem(DEMO_CHAVE_DATA, _demoHoje());
    } catch (e) {
        console.warn("[Demo] Falha ao gravar:", e.message);
    }
}

/* ─── ENTRADA E SAÍDA ─── */

/** Abre o seletor de perfil de demonstração. */
function abrirModoDemo() {
    const overlay = document.getElementById("demoOverlay");
    const lista   = document.getElementById("demoListaUsuarios");
    if (!overlay || !lista) return;

    lista.innerHTML = DEMO_USUARIOS.map(u => `
        <button class="btn-empresa-troca btn-empresa-troca--perfil"
                onclick="entrarModoDemo('${escapeJsAttr(u.uid)}')">
            <span class="demo-perfil-nome">${escapeHtml(u.nome)}
                <em class="demo-perfil-papel">· ${escapeHtml((typeof ROLES !== 'undefined' && ROLES[u.role]?.label) || u.role)}</em>
            </span>
            <span class="demo-perfil-descricao">${escapeHtml(u.descricao)}</span>
        </button>`).join("");

    overlay.style.display = "flex";
}

function fecharModoDemo() {
    const overlay = document.getElementById("demoOverlay");
    if (overlay) overlay.style.display = "none";
}

/**
 * Entra no sistema como um perfil de demonstração.
 *
 * Nenhuma chamada de rede acontece daqui em diante: `_demoAtivo` faz
 * `salvarDB` e `carregarDB` operarem apenas sobre o localStorage.
 */
function entrarModoDemo(uid) {
    const perfil = DEMO_USUARIOS.find(u => u.uid === uid);
    if (!perfil) return;

    window._demoAtivo   = true;
    window._usuarioAtual = JSON.parse(JSON.stringify(perfil));
    localStorage.setItem(DEMO_CHAVE_USER, uid);

    db = _mesclarComPadrao(JSON.parse(JSON.stringify(_demoCarregarOuGerar())));

    fecharModoDemo();
    document.getElementById("loginOverlay").style.display = "none";
    _demoMostrarFaixa();

    // Empresas visíveis seguem exatamente a mesma regra do sistema real.
    const visiveis = perfil.role === "supremo"
        ? db.empresas.filter(e => e.ativo !== false).map(e => e.nome)
        : perfil.empresas.slice();

    // Em demo o recorte por empresa é aplicado na memória, já que não há
    // servidor para fazê-lo: o usuário não deve nem carregar o que não pode ver.
    if (perfil.role !== "supremo") {
        db.lancamentos = db.lancamentos.filter(l => perfil.empresas.includes(l.empresa));
    }
    // A base da demo é o ponto de partida da trava do mês fechado.
    _travaAtualizarAprovado();

    document.getElementById("appContainer").style.display = "block";
    _aplicarEmpresaAtiva(visiveis[0] || "");
    if (typeof aplicarPermissoesDaTela === "function") aplicarPermissoesDaTela();
    atualizarListas();
    mostrarTela("dashboard");
    carregarDashboard();
    verificarBackupAutomatico = function () {};   // demo não gera backup automático
}

/** Sai da demonstração e devolve a tela de login normal. */
function sairModoDemo() {
    window._demoAtivo = false;
    window._usuarioAtual = null;
    localStorage.removeItem(DEMO_CHAVE_USER);
    window.location.reload();
}

/** Faixa fixa no topo, para ninguém confundir demonstração com dado real. */
function _demoMostrarFaixa() {
    if (document.getElementById("demoFaixa")) return;
    const faixa = document.createElement("div");
    faixa.id = "demoFaixa";
    faixa.innerHTML = `
        <span><strong>Modo demonstração</strong><span class="demo-faixa-detalhe">: dados fictícios, restaurados todo dia. Nada aqui é gravado na nuvem.</span></span>
        <span class="demo-faixa-acoes">
            <button onclick="demoResetarDados(false)">Restaurar dados</button>
            <button onclick="sairModoDemo()">Sair da demo</button>
        </span>`;
    document.body.appendChild(faixa);
    document.body.classList.add("com-faixa-demo");

    _demoMedirFaixa();
    window.addEventListener("resize", _demoMedirFaixa);
}

/**
 * Dica do que experimentar, só no modo demonstração e só na tela de
 * lançamento.
 *
 * Três dos avisos do formulário só aparecem quando o operador digita algo
 * que os provoque: data no futuro, descarga antes da nota, preço fora da
 * referência. Numa demonstração, ninguém adivinha que eles existem. Esta
 * dica os torna visíveis sem precisar de dado plantado, e some com um
 * clique. Fica escondida fora da demo.
 */
function _demoDicaLancamento() {
    if (!demoAtivo()) return;
    if (sessionStorage.getItem("fm_demo_dica_lanc") === "fechada") return;
    if (document.getElementById("demoDicaLanc")) return;

    const banner = document.getElementById("bannerRascunho");
    if (!banner || !banner.parentNode) return;

    const dica = document.createElement("div");
    dica.id = "demoDicaLanc";
    dica.className = "demo-dica";
    dica.innerHTML = `
        <strong>Para ver os avisos em ação</strong>
        <ul>
            <li>Ponha uma <strong>data de descarga anterior à da nota</strong>: vira erro e impede salvar.</li>
            <li>Ponha uma <strong>data no futuro</strong>: vira alerta e deixa salvar.</li>
            <li>Digite um <strong>preço bem acima do normal</strong>, tipo o dobro: o sistema compara com a referência dos últimos 7 dias, que aparece ao lado da linha.</li>
            <li>Repita o <strong>número de uma nota já lançada</strong>, na mesma data e empresa: aparece o aviso de duplicidade.</li>
            <li>Digite um <strong>motorista que não existe</strong>: a lista oferece cadastrar na hora.</li>
        </ul>
        <button onclick="_demoFecharDicaLanc()">Entendi</button>`;
    banner.parentNode.insertBefore(dica, banner);
}

function _demoFecharDicaLanc() {
    sessionStorage.setItem("fm_demo_dica_lanc", "fechada");
    document.getElementById("demoDicaLanc")?.remove();
}

/**
 * Publica a altura real da faixa em `--faixa-demo-h`.
 *
 * A sidebar e o cabeçalho são posicionados a partir dessa variável, então
 * eles descem junto em vez de ficarem por baixo da faixa. Medir em vez de
 * fixar um valor importa porque o texto quebra em duas linhas em telas
 * estreitas: com altura fixa, a sidebar ficaria desalinhada no celular.
 */
function _demoMedirFaixa() {
    const faixa = document.getElementById("demoFaixa");
    if (!faixa) return;
    document.documentElement.style.setProperty("--faixa-demo-h", faixa.offsetHeight + "px");
}

/** Devolve o layout ao normal ao sair da demonstração. */
function _demoEsconderFaixa() {
    const faixa = document.getElementById("demoFaixa");
    if (faixa) faixa.remove();
    window.removeEventListener("resize", _demoMedirFaixa);
    document.body.classList.remove("com-faixa-demo");
    document.documentElement.style.removeProperty("--faixa-demo-h");
}

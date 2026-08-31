/*=================================================
  DEMO.JS — Modo demonstração

  Um ambiente isolado, com dados fictícios, para
  explorar o sistema sem tocar na base real.

  REGRA INEGOCIÁVEL DESTE MÓDULO
  Em modo demo o Firestore NUNCA é acessado. A trava
  vive em `salvarDB` e `carregarDB` (app.js), que
  consultam `demoAtivo()` antes de qualquer chamada de
  rede. Os dados vivem só no localStorage, sob uma
  chave própria, e são regenerados a cada dia.

  Serve para: demonstrar o sistema, treinar alguém,
  testar comportamento por papel e por empresa sem
  precisar de credencial. NÃO exercita as regras de
  segurança do servidor — essas só se verificam contra
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
        descricao: "Acesso total — enxerga as três empresas"
    },
    {
        uid: "demo-admin",
        nome: "BrunoTavares",
        email: "bruno@demo.local",
        username: "bruno.demo",
        role: "admin",
        empresas: ["Transportadora Aurora", "Rodoviário Bandeirante"],
        empresaIds: ["demo-emp-1", "demo-emp-2"],
        ativo: true,
        descricao: "Duas empresas — gerencia usuários delas"
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
        descricao: "Uma empresa — só operação"
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

const DEMO_EMPRESAS = [
    { id: "demo-emp-1", nome: "Transportadora Aurora",   municipio: "Campinas, SP",  taxaFrete: 0.2800 },
    { id: "demo-emp-2", nome: "Rodoviário Bandeirante",  municipio: "Sorocaba, SP",  taxaFrete: 0.3450 },
    { id: "demo-emp-3", nome: "Expresso Vale Verde",     municipio: "Ribeirão Preto, SP", taxaFrete: 0.3100 }
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
    const lancamentos = [];
    let contador = 1000;

    for (let mesAtras = 7; mesAtras >= 0; mesAtras--) {
        const base = new Date(hoje.getFullYear(), hoje.getMonth() - mesAtras, 1);
        const diasNoMes = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        const quantidade = 12 + Math.floor(rnd() * 8);

        for (let n = 0; n < quantidade; n++) {
            const dia = 1 + Math.floor(rnd() * diasNoMes);
            const dataNota = new Date(base.getFullYear(), base.getMonth(), dia);
            if (dataNota > hoje) continue;

            const dataDescarga = new Date(dataNota);
            dataDescarga.setDate(dataDescarga.getDate() + Math.floor(rnd() * 3));

            const emp  = empresas[Math.floor(rnd() * empresas.length)];
            const comb = DEMO_COMBUSTIVEIS[Math.floor(rnd() * DEMO_COMBUSTIVEIS.length)];

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
            titulo: "Controle de Entradas de Combustível — Demonstração",
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
        atualizarListas();
        mostrarTela("dashboard");
        carregarDashboard();
        mostrarToast("Dados de demonstração restaurados.", "sucesso", 4000);
    }
    return base;
}

/**
 * Grava o estado da demo — substitui salvarDB enquanto o modo está ativo.
 *
 * Preserva os lançamentos das empresas que o perfil atual NÃO enxerga.
 * Sem isso, um usuário restrito gravaria sua visão parcial por cima da
 * base inteira e apagaria as demais empresas — exatamente o que
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
        <button class="btn-empresa-troca" style="flex-direction:column;align-items:flex-start;gap:2px"
                onclick="entrarModoDemo('${escapeJsAttr(u.uid)}')">
            <span style="font-weight:600">${escapeHtml(u.nome)}
                <em style="font-style:normal;opacity:0.6;font-size:0.78rem">— ${escapeHtml(u.role)}</em>
            </span>
            <span style="font-size:0.76rem;color:var(--text-muted)">${escapeHtml(u.descricao)}</span>
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

    document.getElementById("appContainer").style.display = "block";
    _aplicarEmpresaAtiva(visiveis[0] || "");
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
        <span><strong>Modo demonstração</strong> — dados fictícios, restaurados todo dia. Nada aqui é gravado na nuvem.</span>
        <span style="display:flex;gap:8px">
            <button onclick="demoResetarDados(false)">Restaurar dados</button>
            <button onclick="sairModoDemo()">Sair da demo</button>
        </span>`;
    document.body.appendChild(faixa);
    document.body.classList.add("com-faixa-demo");
}

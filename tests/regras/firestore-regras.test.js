/*  TESTES DAS REGRAS DO FIRESTORE
 *  ===============================
 *  Rodar (precisa do Java 21 e do firebase-tools):
 *    firebase emulators:exec --only firestore --project demo-fuelmind \
 *      "node --test tests/regras/*.test.js"
 *
 *  As regras são a fronteira de segurança do sistema: a interface esconde
 *  botões, mas quem tem uma conta pode gravar direto pelo console do
 *  navegador. Estes testes falam com o emulador pela API REST, sem
 *  biblioteca nenhuma: `fetch` e `node:test` vêm com o Node. O emulador
 *  aceita tokens sem assinatura, então cada pessoa abaixo é só um uid com
 *  um perfil em `usuarios/{uid}`. O projeto `demo-fuelmind` não existe na
 *  nuvem: nada aqui sai da máquina.
 *
 *  Os cenários são os do cabeçalho de firestore.rules.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJETO = process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT.startsWith("demo-")
    ? process.env.GCLOUD_PROJECT : "demo-fuelmind";
const RAIZ = `http://${HOST}/v1/projects/${PROJETO}/databases/(default)/documents`;

if (!HOST) {
    test("regras do Firestore", { skip: "sem emulador: rode por firebase emulators:exec (ver o cabeçalho)" }, () => {});
    return;
}

// ── Firestore REST: valores ─────────────────────────────────────────────
function paraValor(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(paraValor) } };
    return { mapValue: { fields: paraCampos(v) } };
}
function paraCampos(obj) {
    const f = {};
    Object.keys(obj).forEach(k => { f[k] = paraValor(obj[k]); });
    return f;
}

// ── Quem está fazendo a chamada ──────────────────────────────────────────
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(uid, email) {
    const agora = Math.floor(Date.now() / 1000);
    return `${b64({ alg: "none", typ: "JWT" })}.${b64({
        iss: `https://securetoken.google.com/${PROJETO}`, aud: PROJETO,
        iat: agora, exp: agora + 3600, auth_time: agora,
        sub: uid, user_id: uid, email, email_verified: true,
        firebase: { sign_in_provider: "password", identities: {} }
    })}.`;
}
function cabecalho(quem) {
    const h = { "Content-Type": "application/json" };
    if (quem === "dono") h.Authorization = "Bearer owner"; // ignora as regras: só para montar o cenário
    else if (quem) h.Authorization = `Bearer ${token(quem, `${quem}@exemplo.test`)}`;
    return h;
}

async function gravar(quem, caminho, dados) {
    const r = await fetch(`${RAIZ}/${caminho}`, { method: "PATCH", headers: cabecalho(quem), body: JSON.stringify({ fields: paraCampos(dados) }) });
    await r.text();
    return r.status;
}
async function ler(quem, caminho) {
    const r = await fetch(`${RAIZ}/${caminho}`, { headers: cabecalho(quem) });
    await r.text();
    return r.status;
}
async function apagar(quem, caminho) {
    const r = await fetch(`${RAIZ}/${caminho}`, { method: "DELETE", headers: cabecalho(quem) });
    await r.text();
    return r.status;
}
async function consultar(quem, colecao, filtro) {
    const structuredQuery = { from: [{ collectionId: colecao }] };
    if (filtro) structuredQuery.where = { fieldFilter: filtro };
    const r = await fetch(`${RAIZ}:runQuery`, { method: "POST", headers: cabecalho(quem), body: JSON.stringify({ structuredQuery }) });
    await r.text();
    return r.status;
}

const PODE = 200;
const NAO_PODE = 403;

// ── O cenário: três empresas fictícias e uma pessoa de cada papel ───────
const PERFIS = {
    sup:    { nome: "Supremo",       role: "supremo", empresaIds: [] },
    admA:   { nome: "Admin A",       role: "admin",   empresaIds: ["e1"] },
    admA2:  { nome: "Outro admin A", role: "admin",   empresaIds: ["e1"] },
    admB:   { nome: "Admin B",       role: "admin",   empresaIds: ["e2"] },
    opA:    { nome: "Operador A",    role: "usuario", empresaIds: ["e1"] },
    opB:    { nome: "Operador B",    role: "usuario", empresaIds: ["e2"] },
    opInat: { nome: "Inativo",       role: "usuario", empresaIds: ["e1"], ativo: false }
};

const empresa = (id, nome) => ({ id, nome, municipio: "", taxaFrete: 0.1, ativo: true, logs: [] });
function compartilhado() {
    return {
        motoristas: [{ id: "m1", nome: "Motorista Um", ativo: true }],
        veiculos: [{ id: "v1", nome: "AAA1A11", ativo: true }],
        empresas: [empresa("e1", "Empresa A"), empresa("e2", "Empresa B"), empresa("e3", "Empresa C")],
        combustiveis: [{ id: "c1", nome: "S10", perda: 0.5, ativo: true }],
        bases: [{ id: "b1", nome: "Base Um", ativo: true }],
        conjuntosVeiculos: [{ id: "k1", nome: "Conjunto 1", composicaoAtual: ["AAA1A11"] }],
        fechamentosMes: [{ id: "e2_2026-09", empresaId: "e2", mes: "2026-09", fechado: true, logs: [] }],
        configRelatorio: { titulo: "Relatório" },
        configAlertas: {}
    };
}
const nota = id => ({ id, numero: id, empresaId: "e1", dataNota: "2026-10-01", itens: [{ tipo: "S10", qtd: 1000 }] });

test.beforeEach(async () => {
    const r = await fetch(`http://${HOST}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });
    await r.text();
    const escritas = Object.keys(PERFIS).map(uid => gravar("dono", `usuarios/${uid}`,
        Object.assign({ email: `${uid}@exemplo.test`, ativo: true, empresas: [] }, PERFIS[uid])));
    escritas.push(gravar("dono", "dados/compartilhado", compartilhado()));
    escritas.push(gravar("dono", "dados/lanc__e1", { lancamentos: [nota("n1"), nota("n2")] }));
    escritas.push(gravar("dono", "dados/lanc__e2", { lancamentos: [nota("n3")] }));
    ["opA", "opB", "admA2", "sup"].forEach(uid =>
        escritas.push(gravar("dono", `usernames/${uid.toLowerCase()}`, { email: `${uid}@exemplo.test`, uid })));
    const status = await Promise.all(escritas);
    assert.ok(status.every(s => s === PODE), "o cenário não foi montado: " + status.join(","));
});

/** O documento compartilhado depois de uma alteração. */
function com(alterar) {
    const d = compartilhado();
    alterar(d);
    return d;
}

// ── Leitura e conta inativa ───────────────────────────────────────────────
test("sem login ninguém lê os cadastros nem os lançamentos", async () => {
    assert.equal(await ler(null, "dados/compartilhado"), NAO_PODE);
    assert.equal(await ler(null, "dados/lanc__e1"), NAO_PODE);
});

test("conta inativa perde o acesso mesmo com sessão válida", async () => {
    assert.equal(await ler("opA", "dados/compartilhado"), PODE);
    assert.equal(await ler("opInat", "dados/compartilhado"), NAO_PODE);
    assert.equal(await ler("opInat", "dados/lanc__e1"), NAO_PODE);
});

// ── Lançamentos: um documento por empresa ─────────────────────────────────
test("cada um lê só os lançamentos das empresas do perfil", async () => {
    assert.equal(await ler("opA", "dados/lanc__e1"), PODE);
    assert.equal(await ler("opA", "dados/lanc__e2"), NAO_PODE);
    assert.equal(await ler("admA", "dados/lanc__e2"), NAO_PODE);
    assert.equal(await ler("sup", "dados/lanc__e2"), PODE);
});

test("operador acrescenta nota, mas não encolhe a lista nem apaga o documento", async () => {
    assert.equal(await gravar("opA", "dados/lanc__e1", { lancamentos: [nota("n1"), nota("n2"), nota("n9")] }), PODE);
    assert.equal(await gravar("opA", "dados/lanc__e1", { lancamentos: [nota("n1")] }), NAO_PODE);
    assert.equal(await apagar("opA", "dados/lanc__e1"), NAO_PODE);
    assert.equal(await gravar("opA", "dados/lanc__e2", { lancamentos: [nota("n3"), nota("n9")] }), NAO_PODE);
});

test("só o supremo encolhe a lista de lançamentos", async () => {
    assert.equal(await gravar("admA", "dados/lanc__e1", { lancamentos: [nota("n1")] }), NAO_PODE);
    assert.equal(await gravar("sup", "dados/lanc__e1", { lancamentos: [nota("n1")] }), PODE);
});

// ── Operador no documento compartilhado ───────────────────────────────────
test("operador não muda a taxa de frete nem inativa empresa", async () => {
    assert.equal(await gravar("opA", "dados/compartilhado", com(d => { d.empresas[0].taxaFrete = 0.5; })), NAO_PODE);
    assert.equal(await gravar("opA", "dados/compartilhado", com(d => { d.empresas[0].ativo = false; })), NAO_PODE);
});

// Cada teste parte do cenário montado no beforeEach; as gravações que
// passam ficam por último, para as recusas serem medidas contra o original.
test("operador não remove cadastro nem altera conjunto que já existe", async () => {
    assert.equal(await gravar("opA", "dados/compartilhado", com(d => { d.motoristas = []; })), NAO_PODE);
    assert.equal(await gravar("opA", "dados/compartilhado", com(d => { d.conjuntosVeiculos[0].composicaoAtual = ["ZZZ9Z99"]; })), NAO_PODE);
});

test("operador cadastra motorista e conjunto novos", async () => {
    assert.equal(await gravar("opA", "dados/compartilhado", com(d => {
        d.motoristas.push({ id: "m2", nome: "Motorista Dois" });
        d.conjuntosVeiculos.push({ id: "k2", nome: "Conjunto 2" });
    })), PODE);
});

test("operador não fecha nem reabre mês e não mexe na configuração", async () => {
    assert.equal(await gravar("opA", "dados/compartilhado", com(d => {
        d.fechamentosMes.push({ id: "e1_2026-09", empresaId: "e1", mes: "2026-09", fechado: true, logs: [] });
    })), NAO_PODE);
    assert.equal(await gravar("opA", "dados/compartilhado", com(d => { d.configRelatorio.titulo = "Outro"; })), NAO_PODE);
});

// ── Admin no documento compartilhado: só nas empresas dele ────────────────
test("admin altera a taxa e inativa empresa do perfil dele", async () => {
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => { d.empresas[0].taxaFrete = 0.12; })), PODE);
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => { d.empresas[0].ativo = false; })), PODE);
});

test("admin não muda taxa, nome nem situação de empresa fora do perfil", async () => {
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => { d.empresas[1].taxaFrete = 0.5; })), NAO_PODE);
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => { d.empresas[1].ativo = false; })), NAO_PODE);
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => { d.empresas[2].nome = "Outro nome"; })), NAO_PODE);
    // Trocar a empresa B por uma cópia com o id da A também não passa.
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => { d.empresas[1] = empresa("e1", "Empresa A"); })), NAO_PODE);
});

test("admin não cria empresa nova (nasceria fora do perfil dele)", async () => {
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => { d.empresas.push(empresa("e4", "Empresa D")); })), NAO_PODE);
    assert.equal(await gravar("sup", "dados/compartilhado", com(d => { d.empresas.push(empresa("e4", "Empresa D")); })), PODE);
});

test("admin fecha mês de empresa dele", async () => {
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => {
        d.fechamentosMes.push({ id: "e1_2026-09", empresaId: "e1", mes: "2026-09", fechado: true, logs: [] });
    })), PODE);
});

test("admin não fecha nem reabre mês de empresa fora do perfil", async () => {
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => {
        d.fechamentosMes.push({ id: "e3_2026-09", empresaId: "e3", mes: "2026-09", fechado: true, logs: [] });
    })), NAO_PODE);
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => { d.fechamentosMes[0].fechado = false; })), NAO_PODE);
});

test("admin reabre mês de empresa dele", async () => {
    assert.equal(await gravar("admB", "dados/compartilhado", com(d => { d.fechamentosMes[0].fechado = false; })), PODE);
});

test("admin não encolhe listas; nem o supremo encolhe os fechamentos", async () => {
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => { d.motoristas = []; })), NAO_PODE);
    assert.equal(await gravar("sup", "dados/compartilhado", com(d => { d.motoristas = []; })), PODE);
    assert.equal(await gravar("sup", "dados/compartilhado", com(d => { d.fechamentosMes = []; })), NAO_PODE);
});

test("admin continua mexendo nos cadastros que servem a todas as empresas", async () => {
    assert.equal(await gravar("admA", "dados/compartilhado", com(d => {
        d.motoristas.push({ id: "m2", nome: "Motorista Dois" });
        d.configRelatorio.titulo = "Fechamento";
    })), PODE);
});

// ── Perfis ────────────────────────────────────────────────────────────────
test("ninguém cria o próprio perfil", async () => {
    assert.equal(await gravar("novo", "usuarios/novo", { nome: "Novo", role: "admin", empresaIds: ["e1"], ativo: true }), NAO_PODE);
    assert.equal(await gravar("novo", "usuarios/novo", { nome: "Novo", role: "usuario", empresaIds: [], ativo: true }), NAO_PODE);
});

test("admin cria perfil só dentro das empresas dele e nunca supremo", async () => {
    assert.equal(await gravar("admA", "usuarios/novo1", { nome: "Novo", role: "usuario", empresaIds: ["e1"], ativo: true }), PODE);
    assert.equal(await gravar("admA", "usuarios/novo2", { nome: "Novo", role: "usuario", empresaIds: ["e2"], ativo: true }), NAO_PODE);
    assert.equal(await gravar("admA", "usuarios/novo3", { nome: "Novo", role: "supremo", empresaIds: [], ativo: true }), NAO_PODE);
});

test("ninguém promove o próprio papel nem se dá outra empresa", async () => {
    const opA = Object.assign({ email: "opA@exemplo.test", ativo: true, empresas: [] }, PERFIS.opA);
    assert.equal(await gravar("opA", "usuarios/opA", Object.assign({}, opA, { nome: "Novo nome" })), PODE);
    assert.equal(await gravar("opA", "usuarios/opA", Object.assign({}, opA, { role: "admin" })), NAO_PODE);
    assert.equal(await gravar("opA", "usuarios/opA", Object.assign({}, opA, { empresaIds: ["e1", "e2"] })), NAO_PODE);
    const admA = Object.assign({ email: "admA@exemplo.test", ativo: true, empresas: [] }, PERFIS.admA);
    assert.equal(await gravar("admA", "usuarios/admA", Object.assign({}, admA, { role: "supremo" })), NAO_PODE);
});

test("admin não edita perfil de outra empresa", async () => {
    const opB = Object.assign({ email: "opB@exemplo.test", ativo: true, empresas: [] }, PERFIS.opB);
    assert.equal(await gravar("admA", "usuarios/opB", Object.assign({}, opB, { ativo: false })), NAO_PODE);
    const opA = Object.assign({ email: "opA@exemplo.test", ativo: true, empresas: [] }, PERFIS.opA);
    assert.equal(await gravar("admA", "usuarios/opA", Object.assign({}, opA, { ativo: false })), PODE);
});

test("admin lista só os perfis que dividem empresa com ele", async () => {
    const recorte = ids => ({ field: { fieldPath: "empresaIds" }, op: "ARRAY_CONTAINS_ANY", value: paraValor(ids) });
    assert.equal(await consultar("admA", "usuarios", recorte(["e1"])), PODE);
    assert.equal(await consultar("admA", "usuarios", null), NAO_PODE);
    assert.equal(await consultar("admA", "usuarios", recorte(["e2"])), NAO_PODE);
    assert.equal(await consultar("sup", "usuarios", null), PODE);
    assert.equal(await consultar("opA", "usuarios", recorte(["e1"])), NAO_PODE);
});

// ── Índice de @usuário ───────────────────────────────────────────────────
test("o índice de @ se lê sem login, um por vez, e não se lista", async () => {
    assert.equal(await ler(null, "usernames/opa"), PODE);
    assert.equal(await consultar(null, "usernames", null), NAO_PODE);
});

test("ninguém toma o @ de outra pessoa", async () => {
    assert.equal(await gravar("opA", "usernames/opa.novo", { email: "opA@exemplo.test", uid: "opA" }), PODE);
    assert.equal(await gravar("opA", "usernames/outro", { email: "opA@exemplo.test", uid: "opB" }), NAO_PODE);
    assert.equal(await gravar("opA", "usernames/opb", { email: "opA@exemplo.test", uid: "opA" }), NAO_PODE);
    assert.equal(await apagar("opA", "usernames/opb"), NAO_PODE);
});

test("admin troca e apaga o @ só de operador das empresas dele", async () => {
    // Operador de outra empresa, outro admin e o supremo ficam de fora.
    assert.equal(await gravar("admA", "usernames/opb", { email: "opB@exemplo.test", uid: "opB" }), NAO_PODE);
    assert.equal(await apagar("admA", "usernames/opb"), NAO_PODE);
    assert.equal(await gravar("admA", "usernames/adma2", { email: "admA2@exemplo.test", uid: "admA2" }), NAO_PODE);
    assert.equal(await apagar("admA", "usernames/adma2"), NAO_PODE);
    assert.equal(await apagar("admA", "usernames/sup"), NAO_PODE);
    // Nem desvia o @ de um operador dele para outra conta.
    assert.equal(await gravar("admA", "usernames/opa", { email: "opB@exemplo.test", uid: "opB" }), NAO_PODE);
    assert.equal(await gravar("admA", "usernames/opa", { email: "opA@exemplo.test", uid: "opA" }), PODE);
    assert.equal(await apagar("admA", "usernames/opa"), PODE);
    assert.equal(await apagar("sup", "usernames/opb"), PODE);
});

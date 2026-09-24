/*  TESTES DA BASE DA NF-e
 *  ======================
 *  Rodar:  node --test tests/*.test.js
 *
 *  A base da nota sai do fornecedor e da cidade do emitente (item 10,
 *  decisão do dono em 23/09/2026), sem CNPJ cadastrado. O CNPJ só entra
 *  como memória de uma resposta dada na tela. Estes testes guardam os casos
 *  do cadastro real: as abreviações "S. F. CONDE" e "LEM", as duas
 *  unidades da mesma cidade numa base só, e o que NÃO pode casar.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

if (typeof globalThis.resolverBaseDaNFe !== "function") {
    globalThis.db = globalThis.db || { lancamentos: [], empresas: [], configAlertas: {} };
    globalThis.empresaFiltroGlobal = globalThis.empresaFiltroGlobal || "";
    globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {}, removeItem() {} };
    globalThis.salvarDB = globalThis.salvarDB || (() => {});
    if (typeof globalThis.normalizarTexto !== "function") {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src", "shared", "utils.js"), "utf8"), { filename: "utils.js" });
    }
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src", "shared", "base-nfe.js"), "utf8"), { filename: "base-nfe.js" });
}

const base = (id, nome, extra = {}) => ({ id, nome, ativo: true, ...extra });
const BASES = [
    base("b1", "RAIZEN · S. F. CONDE"),
    base("b2", "RAIZEN · RIO DE JANEIRO"),
    base("b3", "RAIZEN · LEM"),
    base("b4", "LARCO · CANDEIAS"),
    base("b5", "LARCO · SALVADOR"),
    base("b6", "PETROBAHIA · S. F. CONDE"),
    base("b7", "ROYAL FIC · BARREIRAS"),
    base("b8", "SP INDUSTRIA · S. F. CONDE"),
    base("b9", "VIBRA · GOIANIA"),
    base("b10", "IPIRANGA · BRASILIA"),
    base("b11", "RAIZEN · JEQUIE"),
    base("b12", "RAIZEN · SAO PAULO")
];

test("cidade: igual, sem acento e sem caixa", () => {
    assert.ok(cidadeDaNotaBate("JEQUIE", "Jequié"));
    assert.ok(cidadeDaNotaBate("GOIANIA", "GOIÂNIA"));
    assert.ok(cidadeDaNotaBate("RIO DE JANEIRO", "Rio de Janeiro"));
    assert.ok(!cidadeDaNotaBate("RIO DE JANEIRO", "Rio Verde"));
});

test("cidade: as abreviações do cadastro do dono", () => {
    assert.ok(cidadeDaNotaBate("S. F. CONDE", "SAO FRANCISCO DO CONDE"));
    assert.ok(cidadeDaNotaBate("S. F. CONDE", "São Francisco do Conde"));
    assert.ok(cidadeDaNotaBate("LEM", "LUIS EDUARDO MAGALHAES"));
    assert.ok(cidadeDaNotaBate("LEM", "Luís Eduardo Magalhães"));
});

test("cidade: o que NÃO pode casar", () => {
    // Uma letra solta não é cidade nenhuma.
    assert.ok(!cidadeDaNotaBate("S", "SALVADOR"));
    // Iniciais valem com a última palavra inteira.
    assert.ok(!cidadeDaNotaBate("S. F. CONDE", "SAO FELIX DO CORIBE"));
    assert.ok(!cidadeDaNotaBate("LEM", "LAURO DE FREITAS"));
    assert.ok(!cidadeDaNotaBate("CANDEIAS", "CANDEIAS DO JAMARI"));
    assert.ok(!cidadeDaNotaBate("", "SALVADOR"));
    assert.ok(!cidadeDaNotaBate("SALVADOR", ""));
});

test("fornecedor: o nome da base em palavras inteiras no emitente ou no fantasia", () => {
    assert.ok(fornecedorDaNotaBate("RAIZEN", ["RAIZEN S.A."]));
    assert.ok(fornecedorDaNotaBate("RAIZEN", ["RAÍZEN COMBUSTÍVEIS S.A."]));
    assert.ok(fornecedorDaNotaBate("ROYAL FIC", ["ROYAL FIC DISTRIBUIDORA DE DERIVADOS DE PETROLEO S.A"]));
    assert.ok(fornecedorDaNotaBate("SP INDUSTRIA", ["SP INDUSTRIA E DISTRIBUIDORA DE PETROLEO LTDA"]));
    assert.ok(fornecedorDaNotaBate("IPIRANGA", ["TEXACO BRASIL", "IPIRANGA"]));
    // Pedaço de palavra não conta.
    assert.ok(!fornecedorDaNotaBate("VIBRA", ["VIBRAX DISTRIBUIDORA LTDA"]));
    assert.ok(!fornecedorDaNotaBate("", ["RAIZEN S.A."]));
});

test("a nota da Raízen de São Francisco do Conde cai na base certa", () => {
    const r = resolverBaseDaNFe(BASES, { cnpj: "10000000000191", xNome: "RAIZEN S.A.", xMun: "SAO FRANCISCO DO CONDE", uf: "BA" });
    assert.equal(r.tipo, "fornecedorCidade");
    assert.equal(r.base.id, "b1");
});

test("mesmo fornecedor e cidade diferente não se confundem", () => {
    const petrobahia = resolverBaseDaNFe(BASES, { xNome: "PETROBAHIA S.A.", xMun: "Sao Francisco do Conde" });
    assert.equal(petrobahia.base.id, "b6");
    const lem = resolverBaseDaNFe(BASES, { xNome: "RAIZEN S.A.", xMun: "LUIS EDUARDO MAGALHAES" });
    assert.equal(lem.base.id, "b3");
});

test("as duas unidades de Candeias caem na mesma base, e a segunda Raízen do Rio também", () => {
    const u1 = resolverBaseDaNFe(BASES, { cnpj: "20000000000191", xNome: "LARCO COMERCIAL DE PRODUTOS DE PETROLEO LTDA", xMun: "CANDEIAS" });
    const u2 = resolverBaseDaNFe(BASES, { cnpj: "20000000000272", xNome: "LARCO COMERCIAL DE PRODUTOS DE PETROLEO LTDA", xMun: "CANDEIAS" });
    assert.equal(u1.base.id, "b4");
    assert.equal(u2.base.id, "b4");
    const rio2 = resolverBaseDaNFe(BASES, { cnpj: "10000000000272", xNome: "RAIZEN S.A.", xMun: "RIO DE JANEIRO" });
    assert.equal(rio2.base.id, "b2");
});

test("sem base com o fornecedor na cidade: nenhuma, com as do fornecedor para sugerir", () => {
    const r = resolverBaseDaNFe(BASES, { xNome: "RAIZEN S.A.", xMun: "CANOAS", uf: "RS" });
    assert.equal(r.tipo, "nenhuma");
    assert.equal(r.base, null);
    assert.deepEqual(r.mesmoFornecedor.map(b => b.id).sort(), ["b1", "b11", "b12", "b2", "b3"].sort());
});

test("o CNPJ ligado por uma resposta anterior vence o nome e a cidade", () => {
    const bases = BASES.map(b => b.id === "b10" ? Object.assign({}, b, { cnpjsNfe: ["30000000000191"] }) : b);
    // A Ipiranga de Brasília que emite com outro nome: a ligação resolve.
    const r = resolverBaseDaNFe(bases, { cnpj: "30.000.000/0001-91", xNome: "TEXACO BRASIL LTDA", xMun: "BRASILIA" });
    assert.equal(r.tipo, "vinculo");
    assert.equal(r.base.id, "b10");
});

test("base inativa não é escolhida, nem pela ligação", () => {
    const bases = [base("x1", "RAIZEN · S. F. CONDE", { ativo: false, cnpjsNfe: ["10000000000191"] })];
    const r = resolverBaseDaNFe(bases, { cnpj: "10000000000191", xNome: "RAIZEN S.A.", xMun: "SAO FRANCISCO DO CONDE" });
    assert.equal(r.tipo, "nenhuma");
});

test("duas bases que batem: a tela pergunta qual", () => {
    const bases = [base("a", "RAIZEN · S. F. CONDE"), base("b", "RAIZEN · SAO FRANCISCO DO CONDE")];
    const r = resolverBaseDaNFe(bases, { xNome: "RAIZEN S.A.", xMun: "SAO FRANCISCO DO CONDE" });
    assert.equal(r.tipo, "ambigua");
    assert.equal(r.candidatas.length, 2);
});

test("base sem cidade no nome ainda casa pelo nome inteiro, como antes", () => {
    const bases = [base("p", "Base Paulínia"), base("r", "RAIZEN")];
    const r = resolverBaseDaNFe(bases, { xNome: "RAIZEN S.A.", xMun: "PAULINIA" });
    assert.equal(r.tipo, "nome");
    assert.equal(r.base.id, "r");
});

test("nome sugerido para a base nova segue o padrão FORNECEDOR · CIDADE", () => {
    assert.equal(nomeSugeridoDaBase({ xNome: "RAIZEN COMBUSTIVEIS S.A.", xMun: "Canoas" }), "RAIZEN · CANOAS");
    assert.equal(nomeSugeridoDaBase({ xNome: "ROYAL FIC DISTRIBUIDORA DE DERIVADOS DE PETROLEO S.A", xMun: "Barreiras" }), "ROYAL FIC · BARREIRAS");
    assert.equal(nomeSugeridoDaBase({ xNome: "SP INDUSTRIA E DISTRIBUIDORA DE PETROLEO LTDA", xMun: "São Francisco do Conde" }), "SP INDUSTRIA · SAO FRANCISCO DO CONDE");
    assert.equal(nomeSugeridoDaBase({ xNome: "VIBRA ENERGIA S.A", xMun: "Goiânia" }), "VIBRA · GOIANIA");
});

test("CNPJ formatado", () => {
    assert.equal(formatarCnpj("10000000000191"), "10.000.000/0001-91");
    assert.equal(formatarCnpj("10.000.000/0001-91"), "10.000.000/0001-91");
    assert.equal(formatarCnpj("123"), "123");
});

/* ── Correções da revisão de 23/09/2026 ─────────────────────────────── */

test("fornecedor só de palavras genéricas não casa com nota nenhuma", () => {
    assert.ok(!fornecedorDaNotaBate("COMERCIAL", ["VIBRA COMERCIAL S.A."]));
    assert.ok(!fornecedorDaNotaBate("AUTO POSTO", ["AUTO POSTO IPIRANGA LTDA"]));
    assert.ok(!fornecedorDaNotaBate("DE", ["ACELEN DISTRIBUIDORA DE PETROLEO"]));
    const bases = [base("g", "COMERCIAL · CANDEIAS")];
    assert.equal(resolverBaseDaNFe(bases, { xNome: "VIBRA COMERCIAL S.A.", xMun: "CANDEIAS" }).tipo, "nenhuma");
});

test("nome sugerido pula as palavras genéricas do começo", () => {
    assert.equal(nomeSugeridoDaBase({ xNome: "COMERCIAL DE COMBUSTIVEIS BOA VIAGEM LTDA", xMun: "Candeias" }), "BOA VIAGEM · CANDEIAS");
    assert.equal(nomeSugeridoDaBase({ xNome: "AUTO POSTO IPIRANGA LTDA", xMun: "Brasilia" }), "IPIRANGA · BRASILIA");
    assert.equal(nomeSugeridoDaBase({ xNome: "COMERCIO DE COMBUSTIVEIS SP INDUSTRIA", xMun: "Sao Francisco do Conde" }), "SP INDUSTRIA · SAO FRANCISCO DO CONDE");
});

test("cidade com apóstrofo de qualquer tipo, ou colado", () => {
    assert.ok(cidadeDaNotaBate("SANTA BARBARA D'OESTE", "SANTA BARBARA D´OESTE"));
    assert.ok(cidadeDaNotaBate("SANTA BARBARA D'OESTE", "Santa Bárbara d’Oeste"));
    assert.ok(cidadeDaNotaBate("SANTA BARBARA D'OESTE", "SANTA BARBARA DOESTE"));
    assert.ok(cidadeDaNotaBate("EMBU-GUACU", "EMBU GUACU"));
});

test("CNPJ alfanumérico é guardado e reconhecido", () => {
    assert.equal(formatarCnpj("12abc34501de35"), "12.ABC.345/01DE-35");
    const bases = [base("a", "RAIZEN · CANOAS", { cnpjsNfe: ["12ABC34501DE35"] })];
    const r = resolverBaseDaNFe(bases, { cnpj: "12.ABC.345/01DE-35", xNome: "OUTRO NOME", xMun: "OUTRA" });
    assert.equal(r.tipo, "vinculo");
    assert.equal(r.base.id, "a");
});

test("CNPJ ligado a duas bases: fornecedor e cidade desempatam, senão a pergunta diz o motivo", () => {
    const bases = [
        base("a", "RAIZEN · S. F. CONDE", { cnpjsNfe: ["10000000000191"] }),
        base("b", "VIBRA · GOIANIA", { cnpjsNfe: ["10000000000191"] })
    ];
    const certa = resolverBaseDaNFe(bases, { cnpj: "10000000000191", xNome: "RAIZEN S.A.", xMun: "SAO FRANCISCO DO CONDE" });
    assert.equal(certa.tipo, "vinculo");
    assert.equal(certa.base.id, "a");
    const empate = resolverBaseDaNFe(bases, { cnpj: "10000000000191", xNome: "OUTRA S.A.", xMun: "CANOAS" });
    assert.equal(empate.tipo, "ambigua");
    assert.equal(empate.motivo, "cnpjEmVarias");
});

test("base nova: acha a do mesmo lugar mesmo inativa, pelo nome, apelido ou fornecedor e cidade", () => {
    const bases = [
        base("x", "RAIZEN · S. F. CONDE", { ativo: false }),
        base("y", "LARCO · CANDEIAS", { apelidos: "LARCO CAND" })
    ];
    const emit = { xNome: "RAIZEN S.A.", xMun: "SAO FRANCISCO DO CONDE" };
    assert.equal(baseJaCadastradaDoEmitente(bases, emit, "RAIZEN · SAO FRANCISCO DO CONDE").id, "x");
    assert.equal(baseJaCadastradaDoEmitente(bases, {}, "larco cand").id, "y");
    assert.equal(baseJaCadastradaDoEmitente(bases, { xNome: "VIBRA ENERGIA", xMun: "GOIANIA" }, "VIBRA · GOIANIA"), null);
});

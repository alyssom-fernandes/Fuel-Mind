/*  TESTES DA LEITURA DE UMA FALHA DE GRAVAÇÃO
 *  ===========================================
 *  Rodar:  node --test tests/*.test.js
 *
 *  O que decide se a gravação volta a ser tentada sozinha. O documento de
 *  lançamentos de uma empresa tem teto de 1 MiB no Firestore; passar dele
 *  devolve `invalid-argument`, e repetir a mesma gravação nunca passa.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

if (typeof globalThis.classificarFalhasDeGravacao !== "function") {
    globalThis.db = globalThis.db || { lancamentos: [], empresas: [], configAlertas: {} };
    globalThis.empresaFiltroGlobal = globalThis.empresaFiltroGlobal || "";
    globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {}, removeItem() {} };
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src", "shared", "utils.js"), "utf8"), { filename: "utils.js" });
}

const falha = (nome, code, message = "") => ({ nome, ok: false, erro: { code, message } });
const TAMANHO = "Document 'projects/x/databases/(default)/documents/dados/lanc__e1' cannot be written because its size (1,048,601 bytes) exceeds the maximum allowed size of 1,048,576 bytes.";

test("documento grande demais: recusado, com a causa, e sem nova tentativa", () => {
    const r = classificarFalhasDeGravacao([falha("lanc__e1", "invalid-argument", TAMANHO)], true);
    assert.equal(r.repetir, false);
    assert.equal(r.semRede, false);
    assert.equal(r.recusadas.length, 1);
    assert.equal(r.recusadas[0].nome, "lanc__e1");
    assert.equal(r.recusadas[0].grandeDemais, true);
});

test("outro conteúdo recusado também não entra em laço, mas não é chamado de tamanho", () => {
    const r = classificarFalhasDeGravacao([falha("compartilhado", "invalid-argument", "Unsupported field value: undefined")], true);
    assert.equal(r.repetir, false);
    assert.equal(r.recusadas[0].grandeDemais, false);
});

test("sem rede: espera e tenta de novo", () => {
    const r = classificarFalhasDeGravacao([falha("lanc__e1", "unavailable")], true);
    assert.equal(r.semRede, true);
    assert.equal(r.repetir, true);
    assert.deepEqual(r.recusadas, []);
    assert.equal(classificarFalhasDeGravacao([falha("lanc__e1", "internal")], false).semRede, true);
});

test("um documento recusado e outro sem rede: o segundo ainda é tentado de novo", () => {
    const r = classificarFalhasDeGravacao([
        falha("lanc__e1", "invalid-argument", TAMANHO),
        falha("lanc__e2", "deadline-exceeded")
    ], true);
    assert.equal(r.repetir, true);
    assert.equal(r.semRede, true);
    assert.equal(r.recusadas.length, 1);
});

test("erro sem código conhecido segue o caminho de antes (tenta de novo)", () => {
    const r = classificarFalhasDeGravacao([{ nome: "lanc__e1", ok: false, erro: new Error("falhou") }], true);
    assert.equal(r.repetir, true);
    assert.equal(r.semRede, false);
});

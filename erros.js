/*=================================================
  ERROS.JS — Fuel Mind
  Falha não tratada fica gravada no navegador e aparece em
  Sistema › Informações do Sistema.

  Parte do antigo app.js, quebrado em arquivos em 18/09/2026 (programa
  6.5). Carrega PRIMEIRO dos arquivos que eram o app.js, para que um erro
  na carga dos seguintes também fique registrado.
=================================================*/
/* ── ERRO QUE DEIXA RASTRO ──────────────────────────────────────────
   Até 17/09/2026 um erro de JavaScript na máquina do operador só existia
   no console dele: 16 `console.error` que ninguém abre. O defeito do
   Analítico (período sem nota antes de um com nota) viveu meses assim.

   Agora toda falha não tratada fica gravada no próprio navegador, com
   tela, usuário e hora, e aparece em Sistema › Informações do Sistema.
   Sem servidor, sem serviço pago, sem sair da máquina: é o operador que
   lê o texto no telefone quando pergunto "o que apareceu aí?".

   Nada aqui pode lançar erro por sua vez — daí o try/catch em volta de
   tudo e o limite de 20 registros. */
const _ERROS_CHAVE = "fm_erros";
const _ERROS_MAX   = 20;
let _erroAvisado   = false;

function errosRegistrados() {
    try { return JSON.parse(localStorage.getItem(_ERROS_CHAVE) || "[]"); }
    catch (_) { return []; }
}

function errosLimpar() {
    try { localStorage.removeItem(_ERROS_CHAVE); } catch (_) {}
    if (typeof atualizarInfoSistema === "function") atualizarInfoSistema();
    mostrarToast("Registro de erros apagado.", "sucesso", 2500);
}

function _registrarErro(tipo, msg, detalhe) {
    try {
        const lista = errosRegistrados();
        lista.unshift({
            ts: new Date().toISOString(),
            tipo,
            msg: String(msg || "").slice(0, 300),
            detalhe: String(detalhe || "").slice(0, 600),
            tela: document.querySelector(".tela[style*='block']")?.id || "—",
            usuario: window._usuarioAtual?.nome || window._usuarioAtual?.email || "—",
            demo: typeof demoAtivo === "function" && demoAtivo()
        });
        localStorage.setItem(_ERROS_CHAVE, JSON.stringify(lista.slice(0, _ERROS_MAX)));
        if (typeof atualizarInfoSistema === "function") atualizarInfoSistema();
        // Um aviso por sessão: o operador precisa saber que algo falhou,
        // mas um toast por erro em laço deixaria a tela inutilizável.
        if (!_erroAvisado) {
            _erroAvisado = true;
            mostrarToast("Algo falhou nesta tela e ficou registrado em Sistema › Informações do Sistema. "
                       + "Se um número parecer errado, recarregue a página (F5).", "erro", 9000);
        }
    } catch (_) { /* localStorage cheio ou bloqueado: não há o que fazer aqui */ }
}

window.addEventListener("error", e => {
    const onde = e.filename ? `${e.filename.split("/").pop()}:${e.lineno}:${e.colno}` : "";
    _registrarErro("erro", e.message, [onde, e.error && e.error.stack].filter(Boolean).join("\n"));
});

window.addEventListener("unhandledrejection", e => {
    const r = e.reason;
    _registrarErro("promessa", (r && (r.message || r.code)) || String(r), r && r.stack);
});

// filtroRapido — função canônica em relatorios.js
// (removida daqui para evitar duplicata e conflito de versões)

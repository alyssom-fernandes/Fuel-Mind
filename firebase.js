/*=================================================
  FIREBASE — Auth + Firestore
  Banco: controle-entradas-posto
  Documento de dados: dados/principal
  Coleção de usuários: usuarios/{uid}

  NOTA DE SEGURANÇA: O usuário supremo deve ser criado
  manualmente pelo console do Firebase Authentication
  (https://console.firebase.google.com) ou via script
  server-side. Nunca inclua credenciais fixas no código-fonte.
=================================================*/
import { initializeApp, getApps, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
    getFirestore, doc, getDoc, setDoc, onSnapshot,
    collection, getDocs, deleteDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updatePassword,
    sendPasswordResetEmail,
    deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
    apiKey:            "AIzaSyDn_n3_R_5sbde0HtFzUGAT2tXr2o8Ck8U",
    authDomain:        "controle-entradas-posto.firebaseapp.com",
    projectId:         "controle-entradas-posto",
    storageBucket:     "controle-entradas-posto.firebasestorage.app",
    messagingSenderId: "1013580210446",
    appId:             "1:1013580210446:web:761558e5b22eb84b1e775f",
    measurementId:     "G-G7XNW602TC"
};

const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const firestore = getFirestore(app);
const auth      = getAuth(app);

/* ─── DOCUMENTOS DE DADOS ──────────────────────────────────────────────
   Os dados operacionais moram na coleção `dados`, repartidos assim:

     dados/compartilhado   cadastros e configuração — visíveis a todos
     dados/lanc__{id}      lançamentos de UMA empresa, pelo id dela
     dados/principal       layout antigo, monolítico (só migração/rollback)

   A separação existe porque regra de segurança avalia o documento
   inteiro: enquanto tudo morava junto, quem podia ler os próprios
   lançamentos lia os de todas as empresas.

   O nome do documento usa o ID da empresa, nunca o nome: renomear uma
   empresa propaga o nome novo para os lançamentos, e se o documento
   fosse nomeado pelo nome seria preciso move-lo e refazer permissões a
   cada renomeação.
   ─────────────────────────────────────────────────────────────────────*/
const DOC_COMPARTILHADO = "compartilhado";
const DOC_LEGADO        = "principal";

/** Nome do documento de lançamentos de uma empresa. */
function docLancamentosNome(empresaId) {
    return "lanc__" + String(empresaId);
}

const _docDados = (nome) => doc(firestore, "dados", nome);

const DB_REF = _docDados(DOC_LEGADO);
const USUARIOS_COL = collection(firestore, "usuarios");
const USERNAMES_COL = collection(firestore, "usernames");

/* ─── DADOS (Firestore) ─── */

/**
 * Carrega o documento principal do Firestore (`dados/principal`) uma única vez.
 * @returns {Promise<Object|null>} Dados do documento, ou `null` se não existir ou falhar
 */
async function firestoreCarregar() {
    try {
        const snap = await getDoc(DB_REF);
        return snap.exists() ? snap.data() : null;
    } catch (e) { console.error("[Firestore] Erro ao carregar:", e); return null; }
}

/**
 * Sobrescreve o documento principal do Firestore com os dados fornecidos.
 * Lança exceção em caso de falha (para o caller tratar retry).
 * @param {Object} dados - Objeto completo a salvar (snapshot do `db`)
 * @returns {Promise<void>}
 */
async function firestoreSalvar(dados) {
    try { await setDoc(DB_REF, dados); }
    catch (e) { console.error("[Firestore] Erro ao salvar:", e); throw e; }
}

/**
 * Registra um listener em tempo real no documento principal.
 *
 * @param {function(Object): void} callback - Chamado com os dados do documento
 *   a cada alteração detectada pelo Firestore
 * @param {function(Error): void} [onErro] - Chamado em caso de erro do listener.
 *   Se omitido, loga no console. Em `app.js`, o handler relga automaticamente
 *   após 2s em caso de `permission-denied` transitório pós-login.
 * @returns {function} Função de unsubscribe — chame para cancelar o listener
 */
function firestoreEscutar(callback, onErro) {
    return onSnapshot(DB_REF, snap => {
        if (snap.exists()) callback(snap.data());
    }, e => {
        if (typeof onErro === 'function') onErro(e);
        else console.error("[Firestore] Erro listener:", e);
    });
}

/* ─── ACESSO POR DOCUMENTO ─── */

/**
 * Lê um documento da coleção `dados`.
 * @param {string} nome - "compartilhado", "lanc__{id}" ou "principal"
 * @returns {Promise<Object|null>} Dados, ou `null` se não existir
 */
async function firestoreCarregarDoc(nome) {
    const snap = await getDoc(_docDados(nome));
    return snap.exists() ? snap.data() : null;
}

/**
 * Sobrescreve um documento da coleção `dados`.
 * Lança exceção em caso de falha, para o caller decidir o retry.
 */
async function firestoreSalvarDoc(nome, dados) {
    await setDoc(_docDados(nome), dados);
}

/**
 * Listener de tempo real em um documento da coleção `dados`.
 * @returns {function} unsubscribe
 */
function firestoreEscutarDoc(nome, callback, onErro) {
    return onSnapshot(_docDados(nome), snap => {
        if (snap.exists()) callback(snap.data());
    }, e => {
        if (typeof onErro === 'function') onErro(e);
        else console.error("[Firestore] Erro listener em " + nome + ":", e);
    });
}

/** Remove um documento da coleção `dados` (usado no corte do layout antigo). */
async function firestoreExcluirDoc(nome) {
    await deleteDoc(_docDados(nome));
}

/* ─── USUÁRIOS (Firestore) ─── */

/**
 * Busca o perfil de um usuário pelo UID.
 * @param {string} uid
 * @returns {Promise<Object|null>} Perfil com `uid` incluído, ou `null` se não existir
 */
async function usuarioBuscar(uid) {
    try {
        const snap = await getDoc(doc(firestore, "usuarios", uid));
        return snap.exists() ? { uid, ...snap.data() } : null;
    } catch (e) { console.error("[Usuarios] Erro ao buscar:", e); return null; }
}

/**
 * Salva (merge) dados no perfil de um usuário no Firestore.
 * Usa `merge: true` — campos não presentes em `dados` são preservados.
 * @param {string} uid   - UID do usuário
 * @param {Object} dados - Campos a atualizar
 * @returns {Promise<void>}
 */
async function usuarioSalvar(uid, dados) {
    try { await setDoc(doc(firestore, "usuarios", uid), dados, { merge: true }); }
    catch (e) { console.error("[Usuarios] Erro ao salvar:", e); throw e; }
}

async function usuariosListar() {
    try {
        const snap = await getDocs(USUARIOS_COL);
        return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    } catch (e) { console.error("[Usuarios] Erro ao listar:", e); return []; }
}

/* ─── ÍNDICE PÚBLICO DE USERNAMES ─────────────────────────────────────
   O login por @usuario precisa descobrir o e-mail ANTES de autenticar,
   e regra de segurança não consegue restringir uma consulta a um campo
   específico. Liberar a coleção `usuarios` para leitura anônima exporia
   nome, e-mail, papel e empresas de todo mundo.

   Por isso o mapeamento vive em `usernames/{username}`, contendo apenas
   o e-mail necessário para o login. `usuarios` fica restrita a usuários
   autenticados.
   ────────────────────────────────────────────────────────────────────*/

/** Username utilizável como ID de documento no Firestore. */
function _usernameValido(username) {
    const u = String(username || "").toLowerCase().trim();
    return /^[a-z0-9._-]{3,}$/.test(u) && u !== "." && u !== ".." ? u : null;
}

/** Cria ou atualiza a entrada do índice. */
async function usernameMapaDefinir(username, email, uid) {
    const u = _usernameValido(username);
    if (!u) return;
    await setDoc(doc(firestore, "usernames", u), { email, uid });
}

/** Remove a entrada do índice (troca ou exclusão de usuário). */
async function usernameMapaRemover(username) {
    const u = _usernameValido(username);
    if (!u) return;
    try { await deleteDoc(doc(firestore, "usernames", u)); }
    catch (e) { console.warn("[Usernames] Falha ao remover:", e.message); }
}

/**
 * Busca um usuário pelo `username` (case-insensitive) para o login.
 *
 * Consulta primeiro o índice público `usernames/{username}`. O fallback
 * para a consulta antiga em `usuarios` cobre a janela entre publicar
 * este código e rodar a migração do índice — depois que as regras forem
 * publicadas ele passa a falhar e o índice vira o único caminho.
 *
 * @param {string} username - Username sem o `@`
 * @returns {Promise<Object|null>} `{ uid, email }` ou `null` se não encontrado
 */
async function usuarioBuscarPorUsername(username) {
    const u = _usernameValido(username);
    if (!u) return null;

    try {
        const snap = await getDoc(doc(firestore, "usernames", u));
        if (snap.exists()) return { uid: snap.data().uid, ...snap.data() };
    } catch (e) { console.warn("[Usernames] Índice indisponível:", e.message); }

    try {
        const q = query(USUARIOS_COL, where("username", "==", u));
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const d = snap.docs[0];
        return { uid: d.id, ...d.data() };
    } catch (e) { console.error("[Usuarios] Erro ao buscar por username:", e); return null; }
}

/**
 * Verifica se um username está disponível para uso.
 * @param {string} username    - Username a verificar (sem `@`)
 * @param {string|null} [uidIgnorar] - UID a ignorar na verificação (útil ao editar
 *   o próprio perfil, para não considerar o username atual como conflito)
 * @returns {Promise<boolean>} `true` se disponível, `false` se já em uso
 */
async function usuarioUsernameDisponivel(username, uidIgnorar = null) {
    const u = _usernameValido(username);
    if (!u) return false;
    const snap = await getDoc(doc(firestore, "usernames", u));
    if (!snap.exists()) return true;
    return snap.data().uid === uidIgnorar;
}

async function usuarioExcluirFirestore(uid) {
    try { await deleteDoc(doc(firestore, "usuarios", uid)); }
    catch (e) { console.error("[Usuarios] Erro ao excluir Firestore:", e); throw e; }
}

/* ─── AUTH ─── */

/**
 * Autentica um usuário com email e senha via Firebase Authentication.
 * @param {string} email
 * @param {string} senha
 * @returns {Promise<UserCredential>}
 */
async function authLogin(email, senha) {
    return signInWithEmailAndPassword(auth, email, senha);
}

async function authLogout() {
    return signOut(auth);
}

/**
 * Cria um novo usuário no Firebase Authentication SEM afetar a sessão atual.
 *
 * `createUserWithEmailAndPassword` normalmente autentica automaticamente como
 * o usuário recém-criado no app em que é chamado — o que derrubaria a sessão
 * do admin logado. Para evitar isso, a criação roda em uma instância
 * secundária e isolada do Firebase App, descartada logo em seguida; a sessão
 * principal (`auth`) nunca é tocada.
 *
 * @param {string} email
 * @param {string} senha
 * @returns {Promise<UserCredential>}
 */
async function authCriarUsuario(email, senha) {
    const nomeAppSecundario = "secundario-criar-usuario";
    const appExistente = getApps().find(a => a.name === nomeAppSecundario);
    const appSecundario = appExistente || initializeApp(firebaseConfig, nomeAppSecundario);
    const authSecundario = getAuth(appSecundario);
    try {
        return await createUserWithEmailAndPassword(authSecundario, email, senha);
    } finally {
        await deleteApp(appSecundario);
    }
}

/**
 * Altera a senha do usuário atualmente logado.
 * Pode falhar com `auth/requires-recent-login` se o login for antigo —
 * nesse caso, orientar o usuário a fazer logout e login novamente.
 * @param {string} novaSenha - Mínimo 6 caracteres
 * @returns {Promise<void>}
 */
async function authAlterarSenha(novaSenha) {
    if (!auth.currentUser) throw new Error("Sem usuário logado.");
    return updatePassword(auth.currentUser, novaSenha);
}

async function authEnviarResetSenha(email) {
    return sendPasswordResetEmail(auth, email);
}

function authEscutar(callback) {
    return onAuthStateChanged(auth, callback);
}

function authUsuarioAtual() {
    return auth.currentUser;
}

// Exporta tudo para uso global
window._firestore = {
    firestoreCarregar, firestoreSalvar, firestoreEscutar,
    firestoreCarregarDoc, firestoreSalvarDoc, firestoreEscutarDoc, firestoreExcluirDoc,
    docLancamentosNome, DOC_COMPARTILHADO, DOC_LEGADO,
    usuarioBuscar, usuarioSalvar, usuariosListar, usuarioExcluirFirestore,
    usuarioBuscarPorUsername, usuarioUsernameDisponivel,
    usernameMapaDefinir, usernameMapaRemover,
    authLogin, authLogout, authCriarUsuario, authAlterarSenha,
    authEnviarResetSenha, authEscutar, authUsuarioAtual
};

// Avisa que o Firebase está pronto
window.dispatchEvent(new Event("firebaseReady"));
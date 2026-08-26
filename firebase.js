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
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
    getFirestore, doc, getDoc, setDoc, onSnapshot,
    collection, getDocs, deleteDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
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
const storage   = getStorage(app);
const auth      = getAuth(app);

const DB_REF       = doc(firestore, "dados", "principal");
const USUARIOS_COL = collection(firestore, "usuarios");

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

/* ─── STORAGE (Firebase Storage) ─── */

/**
 * Faz upload de um File para Storage em anexos/{lancamentoId}/{nomeUnico}
 * Retorna { nome, tipo, url } — apenas a URL é salva no Firestore.
 */
async function storageUploadAnexo(file, lancamentoId) {
    const nomeUnico = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const caminho   = `anexos/${lancamentoId}/${nomeUnico}`;
    const storageRef = ref(storage, caminho);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    return { nome: file.name, tipo: file.type, url, caminho };
}

/**
 * Faz upload de uma imagem de logo para Storage em logos/{empresa}/{nomeUnico}
 * Retorna { url, caminho }
 */
async function storageUploadLogo(file, empresa) {
    const nomeUnico  = `${Date.now()}-logo${file.name.slice(file.name.lastIndexOf('.'))}`;
    const empresaSlug = empresa.replace(/[^a-zA-Z0-9_-]/g, '_');
    const caminho    = `logos/${empresaSlug}/${nomeUnico}`;
    const storageRef = ref(storage, caminho);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    return { url, caminho };
}

/**
 * Exclui um logo do Storage pelo caminho. Silencioso se não existir.
 */
async function storageExcluirLogo(caminho) {
    if (!caminho) return;
    try { await deleteObject(ref(storage, caminho)); }
    catch (e) { if (e.code !== 'storage/object-not-found') throw e; }
}


/**
 * Exclui um anexo do Storage pelo campo `caminho` salvo no lançamento.
 * Silencioso se o arquivo não existir (pode ter sido deletado manualmente).
 * @param {string} caminho - Path interno do Storage (ex: `"anexos/id/nome"`)
 * @returns {Promise<void>}
 */
async function storageExcluirAnexo(caminho) {
    if (!caminho) return;
    try {
        await deleteObject(ref(storage, caminho));
    } catch (e) {
        if (e.code !== 'storage/object-not-found') throw e;
    }
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

/**
 * Busca um usuário pelo campo `username` (case-insensitive).
 * Requer leitura pública da coleção `usuarios` (`allow read: if true`)
 * porque é chamada antes da autenticação no fluxo de login por username.
 * @param {string} username - Username sem o `@`
 * @returns {Promise<Object|null>} Perfil do usuário ou `null` se não encontrado
 */
async function usuarioBuscarPorUsername(username) {
    try {
        const q = query(USUARIOS_COL, where("username", "==", username.toLowerCase().trim()));
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
    try {
        const q = query(USUARIOS_COL, where("username", "==", username.toLowerCase().trim()));
        const snap = await getDocs(q);
        if (snap.empty) return true;
        return snap.docs.every(d => d.id === uidIgnorar);
    } catch (e) { return true; }
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
 * Cria um novo usuário no Firebase Authentication.
 *
 * ATENÇÃO: `createUserWithEmailAndPassword` faz login automático com o novo
 * usuário, deslogando o admin atual. Exibir mensagem orientativa após criar.
 *
 * @param {string} email
 * @param {string} senha
 * @returns {Promise<UserCredential>}
 */
async function authCriarUsuario(email, senha) {
    return createUserWithEmailAndPassword(auth, email, senha);
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
    storageUploadAnexo, storageExcluirAnexo,
    storageUploadLogo, storageExcluirLogo,
    usuarioBuscar, usuarioSalvar, usuariosListar, usuarioExcluirFirestore,
    usuarioBuscarPorUsername, usuarioUsernameDisponivel,
    authLogin, authLogout, authCriarUsuario, authAlterarSenha,
    authEnviarResetSenha, authEscutar, authUsuarioAtual
};

// Avisa que o Firebase está pronto
window.dispatchEvent(new Event("firebaseReady"));
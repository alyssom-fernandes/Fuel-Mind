/*=================================================
  COMBOBOX.JS: seletor de cadastro para o formulário
  de lançamento, no lugar do `<datalist>` nativo.

  Por que existe (tema 03 da pesquisa):
  o `<datalist>` não oferece gancho para "não encontrei, cadastrar",
  não permite ordenar por uso e não dá controle sobre o popup. Os três
  campos que apontam para cadastro (Motorista, Placa e Base) passam a
  usar este componente. Empresa continua no `<datalist>`: ela vem da
  empresa ativa e só é editável ao corrigir uma nota antiga.

  Decisões que vieram da pesquisa e NÃO devem ser revertidas sem motivo:
  - Busca sem acento, por qualquer palavra, nunca aproximada. Numa
    ferramenta fiscal, "ABC" não pode trazer "A1B2C".
  - O uso é só desempate. Relevância textual sempre vence: um cadastro
    usado 40 vezes não pode subir acima de um que casa melhor com o
    que foi digitado.
  - Sem seleção automática do primeiro resultado e sem confirmar ao
    sair do campo. A confirmação é sempre explícita, com Enter ou
    clique.
=================================================*/

/* ── CONTADOR DE USO ─────────────────────────────────────────────────
   Fica no localStorage, por usuário, e nunca no Firestore: o cadastro
   mora no documento compartilhado, então contar uso lá viraria uma
   escrita por seleção num documento que todos escutam.

   A chave é o nome normalizado, não o id, porque o lançamento guarda o
   nome. Renomear um cadastro zera o contador dele, o que é aceitável.

   Sobe apenas quando o lançamento é salvo, nunca quando o operador
   apenas passa pelo resultado: destacar um nome e escolher outro não
   pode virar sinal.
   ────────────────────────────────────────────────────────────────── */
const FM_USO_VERSAO = 1;
const FM_USO_TETO    = 100;   // acima disso o uso não pesa mais

function _fmChaveUso() {
    const uid = (window._usuarioAtual && window._usuarioAtual.uid) || 'anon';
    return 'fm_uso_' + uid;
}

function fmUsoLer() {
    try {
        const bruto = localStorage.getItem(_fmChaveUso());
        if (!bruto) return {};
        const dados = JSON.parse(bruto);
        if (dados.v !== FM_USO_VERSAO) return {};
        return dados.campos || {};
    } catch (_) {
        return {};
    }
}

function _fmUsoGravar(campos) {
    try {
        localStorage.setItem(_fmChaveUso(), JSON.stringify({ v: FM_USO_VERSAO, campos }));
    } catch (_) { /* quota: o combobox funciona sem ranking */ }
}

/**
 * Registra que um valor foi efetivamente usado num lançamento salvo.
 * @param {string} campo - 'motorista' | 'placa' | 'base'
 * @param {string} nome  - valor gravado no lançamento
 */
function fmUsoRegistrar(campo, nome) {
    if (!nome) return;
    const chave  = normalizarTexto(nome);
    if (!chave) return;
    const campos = fmUsoLer();
    if (!campos[campo]) campos[campo] = {};
    const atual = campos[campo][chave] || { uso: 0, ultimoUso: 0 };
    campos[campo][chave] = { uso: atual.uso + 1, ultimoUso: Date.now() };
    _fmUsoGravar(campos);
}

function _fmUsoDe(campo, nome) {
    const campos = fmUsoLer();
    const registro = campos[campo] && campos[campo][normalizarTexto(nome)];
    return registro || { uso: 0, ultimoUso: 0 };
}

/* ── PONTUAÇÃO ───────────────────────────────────────────────────────
   Hierarquia textual bem separada, e o uso somando no máximo 500:
   menos que a distância entre dois degraus de texto. É isso que impede
   o ranking de uso de transformar uma correspondência ruim em boa.
   ────────────────────────────────────────────────────────────────── */
function _fmPontuar(textoNorm, tokensItem, consultaNorm, tokensBusca, campo, nomeOriginal) {
    let score = 0;

    if (textoNorm === consultaNorm) score += 10000;

    for (const t of tokensBusca) {
        if (tokensItem.indexOf(t) !== -1)                       score += 3000;
        else if (tokensItem.some(ti => ti.startsWith(t)))       score += 2000;
        else if (tokensItem.some(ti => ti.indexOf(t) !== -1))   score += 1000;
        else return -Infinity;   // toda palavra digitada tem de casar
    }

    const { uso, ultimoUso } = _fmUsoDe(campo, nomeOriginal);
    score += Math.min(uso, FM_USO_TETO) * 5;
    if (ultimoUso) {
        const dias = (Date.now() - ultimoUso) / 86400000;
        score += Math.max(0, 100 - dias);   // recência decai sozinha
    }
    return score;
}

/* ── COMPONENTE ─────────────────────────────────────────────────────*/

const _fmCombos = {};   // inputId -> estado, para atualizar de fora

/**
 * Transforma um `<input>` existente em combobox acessível.
 *
 * @param {object} opts
 * @param {string}   opts.input        - id do input já presente no HTML
 * @param {string}   opts.campoUso     - chave do contador de uso
 * @param {Function} opts.fonte        - () => array de cadastros `{id, nome, ativo}`
 * @param {Function} opts.aoSelecionar - (nome) => void, escreve nos campos espelho
 * @param {string}   opts.rotulo       - "motorista", para as mensagens
 * @param {string}   [opts.listaCadastro] - chave em `db` para o cadastro rápido
 * @param {Function} [opts.normalizarValor] - normalização extra (placa)
 */
function fmComboboxInit(opts) {
    const input = document.getElementById(opts.input);
    if (!input || _fmCombos[opts.input]) return;

    // O input vive dentro de `.campo`; envolvemos apenas ele, para a lista
    // poder se posicionar em relação ao campo sem alterar o grid do form.
    const wrapper = document.createElement('div');
    wrapper.className = 'fm-combo';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const lista = document.createElement('ul');
    lista.className = 'fm-combo-lista';
    lista.id = opts.input + '-lista';
    lista.setAttribute('role', 'listbox');
    lista.hidden = true;
    wrapper.appendChild(lista);

    const status = document.createElement('span');
    status.className = 'fm-combo-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    wrapper.appendChild(status);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', lista.id);
    input.setAttribute('autocomplete', 'off');
    input.removeAttribute('list');   // o datalist sai de cena

    const est = { opts, input, lista, status, itens: [], ativo: -1, aberta: false };
    _fmCombos[opts.input] = est;

    input.addEventListener('input', () => {
        input.classList.remove('campo-sugerido');
        _fmAbrir(est);
    });
    input.addEventListener('focus', () => _fmAbrir(est));
    input.addEventListener('blur',  () => _fmFechar(est));
    input.addEventListener('keydown', e => _fmTeclado(est, e));
}

function _fmValoresFonte(est) {
    const bruto = est.opts.fonte() || [];
    return bruto.filter(i => i && i.nome && i.ativo !== false);
}

function _fmAbrir(est) {
    const consultaBruta = est.opts.normalizarValor
        ? est.opts.normalizarValor(est.input.value)
        : est.input.value;
    const consultaNorm = normalizarTexto(consultaBruta);
    const tokensBusca  = consultaNorm.split(/\s+/).filter(Boolean);
    const fonte        = _fmValoresFonte(est);

    let itens;
    let cabecalho = '';

    if (!tokensBusca.length) {
        // Campo vazio: os oito mais usados, com rótulo. Sem o rótulo, oito
        // nomes soltos parecem a lista inteira.
        itens = fonte
            .map(i => {
                const u = _fmUsoDe(est.opts.campoUso, i.nome);
                return { item: i, score: u.uso * 1000 + (u.ultimoUso || 0) / 1e10 };
            })
            .filter(r => r.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
            .map(r => r.item);
        if (itens.length) cabecalho = 'Mais usados';
        else itens = fonte.slice(0, 8);
    } else {
        itens = fonte
            .map(i => {
                const alvo = est.opts.normalizarValor
                    ? est.opts.normalizarValor(i.nome)
                    : i.nome;
                // Os apelidos entram na busca como palavras a mais do
                // próprio item (22/09/2026). A base da Raízen em Madre de
                // Deus é "BMAD" para quem lança a nota há anos; renomeá-la
                // pela cidade deixaria a equipe digitando um nome que o
                // sistema não conhece e, pior, oferecendo "+ Cadastrar
                // bmad", que vira base duplicada numa correria.
                // Só a BUSCA usa os apelidos; a lista continua mostrando o
                // nome, com o apelido em cinza ao lado.
                const textoNorm = normalizarTexto(alvo)
                    + (i.apelidos ? " " + normalizarTexto(i.apelidos) : "");
                const tokensItem = textoNorm.split(/\s+/).filter(Boolean);
                return {
                    item: i,
                    score: _fmPontuar(textoNorm, tokensItem, consultaNorm, tokensBusca,
                                      est.opts.campoUso, i.nome)
                };
            })
            .filter(r => r.score > -Infinity)
            .sort((a, b) => b.score - a.score)
            .map(r => r.item);
    }

    est.itens = itens.slice();
    est.ativo = -1;   // nunca destacar sozinho: seleção é sempre explícita

    // "Cadastrar X" aparece só quando a busca não achou nada. Oferecer o
    // atalho junto de resultados válidos convida a criar duplicata com uma
    // tecla, e cadastro duplicado é exatamente o que a checagem por acento
    // acabou de fechar. Quem quer um cadastro novo com nome parecido usa a
    // tela de Cadastros.
    // Um cadastro INATIVO com o mesmo nome não é oferecido para criar de
    // novo: a lista diz que ele existe e está inativo.
    const inativoIgual = (!itens.length && tokensBusca.length)
        ? (est.opts.fonte() || []).find(i => i && i.nome && i.ativo === false
            && normalizarTexto(est.opts.normalizarValor ? est.opts.normalizarValor(i.nome) : i.nome) === consultaNorm)
        : null;
    const podeCriar = !!est.opts.listaCadastro && tokensBusca.length > 0 && itens.length === 0 && !inativoIgual;

    let html = '';
    if (cabecalho) {
        html += `<li class="fm-combo-cabecalho" role="presentation">${escapeHtml(cabecalho)}</li>`;
    }
    html += itens.map((i, idx) => {
        // O texto secundário: município na empresa e, no veículo, a placa
        // antiga. Quem tem a nota na mão lê "OMQ 8276" e o cadastro guarda
        // "OMQ8C76", que é a Mercosul equivalente; sem essa segunda linha a
        // pessoa digita a placa certa, vê uma que não reconhece e hesita
        // (22/09/2026). A busca já casava os dois formatos.
        const segundo = i.municipio
            || (i.placaAntiga ? `antiga ${i.placaAntiga}` : '')
            || i.apelidos || '';
        const extra = segundo ? ` <span class="fm-combo-extra">${escapeHtml(segundo)}</span>` : '';
        // O nome num span próprio: solto, ele não tinha como encolher e um
        // nome longo de base ou transportadora criava rolagem lateral
        // dentro da lista, no celular.
        return `<li class="fm-combo-item" role="option" aria-selected="false"
                    id="${est.lista.id}-opt-${idx}" data-idx="${idx}"><span class="fm-combo-nome">${escapeHtml(i.nome)}</span>${extra}</li>`;
    }).join('');

    if (!itens.length && tokensBusca.length) {
        html += inativoIgual
            ? `<li class="fm-combo-vazio" role="presentation">"${escapeHtml(inativoIgual.nome)}" está cadastrado, mas inativo. Reative em Cadastros para usar.</li>`
            : `<li class="fm-combo-vazio" role="presentation">Nenhum ${escapeHtml(est.opts.rotulo)} encontrado</li>`;
    }
    if (podeCriar) {
        est.itens.push({ __novo: true, nome: est.input.value.trim() });
        const idx = est.itens.length - 1;
        html += `<li class="fm-combo-item fm-combo-novo" role="option" aria-selected="false"
                     id="${est.lista.id}-opt-${idx}" data-idx="${idx}">
                     + Cadastrar "${escapeHtml(est.input.value.trim())}"</li>`;
    }

    if (!html) { _fmFechar(est); return; }

    // A lista já aberta (a pessoa está digitando) mantém o lado em que
    // abriu: recalcular a cada tecla a fazia pular de baixo para cima
    // conforme sobravam mais ou menos resultados.
    const jaAberta = est.aberta;
    est.lista.innerHTML = html;
    est.lista.hidden = false;
    _fmPosicionar(est, jaAberta);
    est.aberta = true;
    if (!jaAberta) _fmAcompanharTela(est);
    est.input.setAttribute('aria-expanded', 'true');
    est.status.textContent = itens.length
        ? `${itens.length} ${itens.length === 1 ? 'resultado' : 'resultados'}`
        : `Nenhum ${est.opts.rotulo} encontrado`;

    // `mousedown` com preventDefault, e não `click`: sem isso o clique num
    // item (ou na barra de rolagem da lista) dispara o blur do input, que
    // fecha a lista antes de o clique chegar.
    est.lista.querySelectorAll('.fm-combo-item').forEach(li => {
        li.addEventListener('mousedown', e => {
            e.preventDefault();
            _fmSelecionar(est, parseInt(li.dataset.idx, 10));
        });
    });
}

/* Para cima ou para baixo, e com que altura (23/09/2026).
   A lista abria sempre embaixo do campo, com até 260 px. Num notebook com
   zoom de 125% sobram uns 530 px de janela, e no celular o teclado come
   metade da tela: o campo Base, no pé do formulário, abria a lista para
   fora da área visível. Agora ela abre para o lado que tem mais espaço, e
   nunca maior que esse espaço.

   O espaço de cima desconta o cabeçalho, que fica grudado no topo e passa
   por cima da lista (z-index 100 contra 60). O `visualViewport` é o que
   sobra de tela com o teclado aberto; sem ele, vale a janela.

   `manterLado`: só a altura é refeita, o lado fica. É o caso de quem está
   digitando ou rolando a página com a lista aberta. */
function _fmPosicionar(est, manterLado) {
    const r  = est.input.getBoundingClientRect();
    const vv = window.visualViewport;
    const topoVisivel = vv ? vv.offsetTop : 0;
    const fimVisivel  = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const cabecalho   = document.querySelector('.app-header');
    const topoUtil    = Math.max(topoVisivel, cabecalho ? cabecalho.getBoundingClientRect().bottom : 0);

    const folga   = 8;
    const abaixo  = fimVisivel - r.bottom - folga;
    const acima   = r.top - topoUtil - folga;
    est.lista.style.maxHeight = '';
    const desejada = Math.min(est.lista.scrollHeight, 260);
    const paraCima = manterLado
        ? est.lista.classList.contains('fm-combo-lista--acima')
        : abaixo < desejada && acima > abaixo;

    est.lista.classList.toggle('fm-combo-lista--acima', paraCima);
    const espaco = paraCima ? acima : abaixo;
    // Menos de 120 px não mostra nem três nomes: aí é melhor a lista passar
    // da borda e a página rolar do que virar uma fresta.
    if (espaco < desejada) est.lista.style.maxHeight = Math.max(120, Math.floor(espaco)) + 'px';
}

/* No celular a lista abre no `focus`, ANTES de o teclado subir: ela
   escolhia o lado com a tela inteira e o teclado a cobria em seguida,
   até a primeira tecla. Enquanto ela estiver aberta, a área visível
   mudando (teclado subindo ou descendo) faz escolher o lado de novo, e a
   página rolando refaz só a altura. `_fmFechar` solta os ouvintes. */
function _fmAcompanharTela(est) {
    const vv = window.visualViewport;
    est._aoMudarTela = () => { if (est.aberta) _fmPosicionar(est, false); };
    est._aoRolar     = () => { if (est.aberta) _fmPosicionar(est, true); };
    if (vv) {
        vv.addEventListener('resize', est._aoMudarTela);
        vv.addEventListener('scroll', est._aoRolar);
    }
    window.addEventListener('scroll', est._aoRolar, { passive: true });
}

function _fmFechar(est) {
    const vv = window.visualViewport;
    if (est._aoMudarTela) {
        if (vv) {
            vv.removeEventListener('resize', est._aoMudarTela);
            vv.removeEventListener('scroll', est._aoRolar);
        }
        window.removeEventListener('scroll', est._aoRolar);
        est._aoMudarTela = est._aoRolar = null;
    }
    est.lista.hidden = true;
    est.aberta = false;
    est.ativo = -1;
    est.input.setAttribute('aria-expanded', 'false');
    est.input.removeAttribute('aria-activedescendant');
    est.status.textContent = '';
}

function _fmDestacar(est, idx) {
    const lis = est.lista.querySelectorAll('.fm-combo-item');
    if (!lis.length) return;
    if (idx < 0) idx = lis.length - 1;
    if (idx >= lis.length) idx = 0;
    lis.forEach(l => { l.classList.remove('ativo'); l.setAttribute('aria-selected', 'false'); });
    const alvo = lis[idx];
    alvo.classList.add('ativo');
    alvo.setAttribute('aria-selected', 'true');
    // O foco do DOM não sai do input: quem anda é o `aria-activedescendant`.
    est.input.setAttribute('aria-activedescendant', alvo.id);
    alvo.scrollIntoView({ block: 'nearest' });
    est.ativo = parseInt(alvo.dataset.idx, 10);
}

function _fmSelecionar(est, idx) {
    const escolhido = est.itens[idx];
    if (!escolhido) return;

    if (escolhido.__novo) {
        _fmFechar(est);
        abrirModalCadastroRapido(est.opts.listaCadastro, escolhido.nome, nomeCriado => {
            est.input.value = nomeCriado;
            est.opts.aoSelecionar(nomeCriado);
            marcarFormularioSujo();
            est.input.focus();
        });
        return;
    }

    est.input.value = escolhido.nome;
    est.input.classList.remove('campo-sugerido');
    est.opts.aoSelecionar(escolhido.nome);
    marcarFormularioSujo();
    _fmFechar(est);
}

function _fmTeclado(est, e) {
    const tecla = e.key;

    if (tecla === 'ArrowDown') {
        e.preventDefault();   // sem isso a página rola junto com a lista
        if (!est.aberta) { _fmAbrir(est); _fmDestacar(est, 0); }
        else _fmDestacar(est, est.lista.querySelectorAll('.fm-combo-item.ativo').length
                              ? _fmIndiceVisual(est) + 1 : 0);
        return;
    }
    if (tecla === 'ArrowUp') {
        e.preventDefault();
        if (!est.aberta) { _fmAbrir(est); _fmDestacar(est, -1); }
        else _fmDestacar(est, _fmIndiceVisual(est) - 1);
        return;
    }
    if (tecla === 'Enter') {
        if (est.aberta && est.ativo >= 0) {
            e.preventDefault();
            _fmSelecionar(est, est.ativo);
        }
        // Sem item destacado o Enter não faz nada aqui: quem salva é
        // Ctrl+Enter, e um Enter solto não pode gravar nota.
        return;
    }
    if (tecla === 'Escape') {
        if (est.aberta) {
            // Sem `stopPropagation` o mesmo Escape que fecha a lista fecharia
            // o modal por trás, porque há dois ouvintes de Escape no document.
            e.preventDefault();
            e.stopPropagation();
            _fmFechar(est);
        }
        return;
    }
    if (tecla === 'Tab') {
        _fmFechar(est);   // sai sem selecionar; confirmar no blur é proibido
    }
    // Home, End, Backspace, Delete e setas laterais ficam com o navegador.
}

function _fmIndiceVisual(est) {
    const lis = [...est.lista.querySelectorAll('.fm-combo-item')];
    return lis.findIndex(l => l.classList.contains('ativo'));
}

/* ── LIGAÇÃO COM O FORMULÁRIO DE LANÇAMENTO ─────────────────────────*/

/**
 * Aplica o combobox aos três campos que apontam para cadastro.
 * Chamado uma vez, depois do DOM pronto.
 */
function fmComboboxAplicarLancamento() {
    fmComboboxInit({
        input: 'baseEntradaInput',
        campoUso: 'base',
        rotulo: 'base',
        listaCadastro: 'bases',
        fonte: () => db.bases || [],
        aoSelecionar: nome => setBase(nome)
    });

    fmComboboxInit({
        input: 'motoristaInput',
        campoUso: 'motorista',
        rotulo: 'motorista',
        listaCadastro: 'motoristas',
        fonte: () => db.motoristas || [],
        aoSelecionar: nome => {
            document.getElementById('motoristaSelect').value = nome;
            _sugerirPlacaPeloMotorista(nome);
        }
    });

    fmComboboxInit({
        input: 'placaInput',
        campoUso: 'placa',
        rotulo: 'placa',
        listaCadastro: 'veiculos',
        // Placa casa igual com hífen, espaço ou nada, e no formato antigo ou
        // no Mercosul: ABC-1234 acha ABC1C34. Sem isso o veículo cadastrado
        // no outro formato não aparecia, e "Cadastrar" falhava por duplicidade.
        normalizarValor: v => (typeof normalizarPlaca === 'function')
            ? normalizarPlaca(String(v || ''))
            : String(v || '').replace(/[-\s]/g, ''),
        fonte: () => db.veiculos || [],
        aoSelecionar: nome => {
            document.getElementById('placaSelect').value = nome;
            _sugerirMotoristaPelaPlaca(nome);
        }
    });
}

/* ── SUGESTÃO CRUZADA MOTORISTA ↔ PLACA ─────────────────────────────
   Motorista e Placa são limpos a cada nota, por decisão do dono: numa
   sequência de notas o caminhão às vezes muda, e herdar em silêncio
   produz nota com motorista errado. A sugestão devolve a velocidade
   sem herdar: escolhido o motorista, aparece a placa que ele mais
   rodou, marcada como sugestão e trocável com uma tecla.
   ────────────────────────────────────────────────────────────────── */
function _fmParMaisFrequente(campoBusca, valor, campoAlvo) {
    if (!valor || !Array.isArray(db.lancamentos)) return '';
    const alvoNorm = normalizarTexto(valor);
    const contagem = {};
    for (const l of db.lancamentos) {
        // Nota excluída ou cancelada não é evidência de que aquele
        // motorista rodou com aquela placa.
        if (!lancamentoAtivo(l)) continue;
        if (normalizarTexto(l[campoBusca] || '') !== alvoNorm) continue;
        const par = l[campoAlvo];
        if (!par) continue;
        // Lançamentos da empresa ativa pesam mais que os das outras.
        const peso = (empresaFiltroGlobal && l.empresa === empresaFiltroGlobal) ? 10 : 1;
        contagem[par] = (contagem[par] || 0) + peso;
    }
    let melhor = '', maior = 0;
    for (const k in contagem) if (contagem[k] > maior) { maior = contagem[k]; melhor = k; }
    return melhor;
}

function _sugerirPlacaPeloMotorista(motorista) {
    const placa = document.getElementById('placaInput');
    if (!placa || placa.value.trim()) return;
    const sugerida = _fmParMaisFrequente('motorista', motorista, 'placa');
    if (!sugerida) return;
    placa.value = sugerida;
    document.getElementById('placaSelect').value = sugerida;
    placa.classList.add('campo-sugerido');
    placa.title = 'Placa sugerida pelo histórico deste motorista. Digite para trocar.';
}

function _sugerirMotoristaPelaPlaca(placa) {
    const mot = document.getElementById('motoristaInput');
    if (!mot || mot.value.trim()) return;
    const sugerido = _fmParMaisFrequente('placa', placa, 'motorista');
    if (!sugerido) return;
    mot.value = sugerido;
    document.getElementById('motoristaSelect').value = sugerido;
    mot.classList.add('campo-sugerido');
    mot.title = 'Motorista sugerido pelo histórico desta placa. Digite para trocar.';
}

#!/usr/bin/env node
/* =====================================================================
   SERVIDOR.JS — atualização automática + servidor local
   Ibis Chapecó · Margem RBO

   O que este script faz, sozinho, sem instalar nada (só Node.js):
   1. Serve os arquivos desta pasta em http://localhost:8420 — precisa
      disso porque um HTML aberto direto (file://) não consegue buscar
      arquivo nenhum sozinho; servido por http, sim.
   2. Fica de olho na pasta "pms-inbox/": quando você (ou o export
      agendado do PMS) deixar um .xml/.html novo lá, ele lê, extrai os
      dados de histórico/forecast e grava em data/otb-data.json.
   3. Fica de olho na pasta "notas-inbox/": quando uma nota fiscal
      eletrônica (.xml, padrão NFe da SEFAZ) cair lá, ele extrai
      fornecedor, itens e valores e grava em data/notas-data.json.
   4. O painel (index.html), quando aberto via http://localhost:8420,
      busca esses dois JSONs sozinho a cada carregamento — por isso a
      "atualização diária": o script roda o dia todo, o painel só
      precisa ser aberto/atualizado pra mostrar o que tiver de mais
      novo nas pastas.
   5. O painel também SALVA sozinho o que você edita nele (mês fechado,
      meta, cenário do simulador, classificação de notas) em
      data/estado.json, chamando POST /api/estado alguns instantes
      depois de qualquer mudança. Fechar a aba e abrir de novo (com o
      servidor no ar) volta exatamente de onde parou.
   6. O servidor escuta em todos os endereços da máquina, não só
      localhost — por isso dá pra acessar de outro aparelho na mesma
      rede (ou via Tailscale) usando o IP que aparece no log ao
      iniciar. Ver LEIA-ME.md, seção "Acesso pelo celular".

   Como deixar rodando sozinho (sem precisar abrir o terminal todo dia):

   WINDOWS
     1. Crie um arquivo "iniciar.bat" nesta mesma pasta com o conteúdo:
          @echo off
          cd /d %~dp0
          node servidor.js
     2. Copie um atalho desse .bat pra pasta de Inicialização do Windows:
          Win+R, digite shell:startup, Enter, cole o atalho lá.
     3. Pronto — toda vez que o Windows liga, o servidor sobe sozinho.

   MAC
     1. Abra o app "Automator" > Novo Documento > Aplicativo.
     2. Adicione a ação "Executar Script do Shell", cole:
          cd "/caminho/completo/desta/pasta" && /usr/local/bin/node servidor.js
     3. Salve, e em Preferências do Sistema > Itens de Login, adicione
        esse aplicativo.

   Em qualquer um dos dois, você pode simplesmente rodar
   "node servidor.js" manualmente no terminal sempre que quiser — o
   script não precisa do passo de login automático pra funcionar, só
   pra não precisar lembrar de abrir todo dia.

   PROTEÇÃO POR SENHA (recomendado se o painel ficar acessível pela
   internet, ex: hospedado na nuvem — ver INSTALACAO_NUVEM.md)
     Defina a variável de ambiente SENHA_PAINEL antes de rodar o
     servidor. Com ela definida, todo acesso (painel, APIs, JSONs) pede
     usuário/senha (o usuário pode ser qualquer coisa, só a senha
     importa) via autenticação HTTP básica nativa do navegador — sem
     SENHA_PAINEL definida, o painel continua acessível sem senha, do
     jeito que sempre foi (uso 100% local, só quem está na rede vê).
       Linux/Mac:   SENHA_PAINEL="sua-senha-aqui" node servidor.js
       Windows (PowerShell): $env:SENHA_PAINEL="sua-senha-aqui"; node servidor.js
     Em hospedagem na nuvem, essa variável é configurada no painel do
     provedor (Railway/Render/etc.), não digitada na mão toda vez.

   ATUALIZAÇÃO AUTOMÁTICA (opcional — ver ESTADO_DO_PROJETO.md, seção
   "Atualização automática", pro passo a passo completo de configurar)
     Toda vez que o servidor inicia (e depois, a cada 6h enquanto fica
     ligado), ele confere sozinho — sem precisar de comando nenhum — se
     existe uma versão mais nova em REPOSITORIO_ATUALIZACAO (linha
     abaixo). Se existir: baixa os arquivos novos, guarda uma cópia dos
     antigos em data/backups-app/ (pra poder voltar atrás se algo der
     errado), substitui, e reinicia sozinho. Enquanto
     REPOSITORIO_ATUALIZACAO não for configurado (deixado como está,
     com "SEU-USUARIO/SEU-REPOSITORIO"), essa checagem simplesmente não
     encontra nada e não faz nada — nenhum comportamento existente
     muda. NUNCA mexe em data/ (seus dados reais) — só nos 2 arquivos
     do programa em si (servidor.js e painel-rbo.html).
   ===================================================================== */

const http = require('http');
const https = require('https'); // so pra atualizacao automatica (ver "ATUALIZAÇÃO AUTOMÁTICA" abaixo) — busca versao.json e os arquivos novos num repositorio publico
const fs = require('fs');
const path = require('path');
const zlib = require('zlib'); // usado so pra descomprimir o .xlsx do Lighthouse (deflate raw, sem lib externa)
const os = require('os'); // so pra mostrar o IP da maquina no log de start (util pra achar o endereco do Tailscale/rede local)
const crypto = require('crypto'); // so pra comparar a senha (ver autenticarRequisicao) sem vazar timing
const { spawn } = require('child_process'); // so pra reiniciar o proprio processo depois de uma atualizacao automatica aplicada

// hospedagem em nuvem manda a porta certa por variável de ambiente — local continua na 8420 de sempre.
const PORT = Number(process.env.PORT) || 8420;
const ROOT = __dirname;
const PMS_INBOX = path.join(ROOT, 'pms-inbox');
const NOTAS_INBOX = path.join(ROOT, 'notas-inbox');
const DATA_DIR = path.join(ROOT, 'data');
const OTB_JSON = path.join(DATA_DIR, 'otb-data.json');
const NOTAS_JSON = path.join(DATA_DIR, 'notas-data.json');
const HISTORICO_DIR = path.join(DATA_DIR, 'historico'); // um otb-AAAA-MM-DD.json por dia, pra montar o pace
const PRACA_INBOX = path.join(ROOT, 'praca-inbox');
const PRACA_JSON = path.join(DATA_DIR, 'praca-data.json');
const DRE_INBOX = path.join(ROOT, 'dre-inbox');
const ALLSTRATEGY_INBOX = path.join(ROOT, 'allstrategy-inbox');
const INBOX_UNIFICADO = path.join(ROOT, 'inbox'); // pasta unica: solta qualquer coisa aqui, o servidor identifica o tipo sozinho e roteia
const DRE_JSON = path.join(DATA_DIR, 'dre-data.json');
const ALLSTRATEGY_JSON = path.join(DATA_DIR, 'allstrategy-data.json');
const FOTOS_DIR = path.join(DATA_DIR, 'fotos'); // fotos de antes/depois dos projetos de melhoria (aba "Projetos")
const ANEXOS_DIR = path.join(DATA_DIR, 'anexos'); // planos de camareira escaneados/fotografados (aba "Governança") — só referência, não são processados
const RESCAN_INTERVAL_MS = 4 * 1000; // verifica a cada 4s — barato porque só reprocessa de verdade quando algo mudou (ver pastaMudou). fs.watch sozinho não é confiável em todo sistema de arquivos; isso virou a rede de segurança principal, não só um reforço.

// ---------- atualização automática (ver doc no topo do arquivo) ----------
const APP_BACKUPS_DIR = path.join(DATA_DIR, 'backups-app'); // cópia dos arquivos do PROGRAMA (não dos dados) antes de cada auto-atualização, pra dar pra voltar atrás
const MAX_BACKUPS_APP = 20; // bem menos que os 500 do estado.json — isso aqui só serve de rede de segurança contra uma atualização ruim, não histórico de edição
// versão publicada AGORA nestes 2 arquivos — sobe (formato AAAA.MM.DD ou
// AAAA.MM.DD.N se publicar mais de uma vez no mesmo dia) toda vez que uma
// atualização de verdade é publicada no repositório. Comparação é por
// string (funciona porque o formato é sempre zero-padded e cresce da
// esquerda pra direita, igual data ISO).
const VERSAO_ATUAL = '2026.08.14';
// troque pelo endereço RAW do seu repositório público no GitHub depois de
// seguir o passo a passo (ESTADO_DO_PROJETO.md → "Atualização automática").
// Pode ser sobrescrito por variável de ambiente também (útil se um dia
// hospedar na nuvem e quiser configurar por lá em vez de editar o arquivo).
const REPOSITORIO_ATUALIZACAO = process.env.URL_MANIFESTO_ATUALIZACAO
  || 'https://raw.githubusercontent.com/SEU-USUARIO/SEU-REPOSITORIO/main/versao.json';

function log(msg){
  const hora = new Date().toLocaleString('pt-BR');
  console.log(`[${hora}] ${msg}`);
}

function dataDeHoje(){
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function garantirPastas(){
  [PMS_INBOX, NOTAS_INBOX, DATA_DIR, HISTORICO_DIR, PRACA_INBOX, DRE_INBOX, ALLSTRATEGY_INBOX, INBOX_UNIFICADO, FOTOS_DIR, ANEXOS_DIR, BACKUPS_DIR, APP_BACKUPS_DIR].forEach(p => {
    if(!fs.existsSync(p)){ fs.mkdirSync(p, { recursive: true }); log(`Pasta criada: ${path.relative(ROOT, p)}/`); }
  });
}

// diz se o CONTEUDO de uma pasta mudou desde a ultima vez que essa mesma
// chave foi conferida (nome + tamanho + data de modificação de cada
// arquivo). Usado pra revarredura periódica não fazer trabalho (nem
// log) à toa quando nada mudou — só reprocessa de verdade quando
// realmente tem novidade na pasta.
const _assinaturasDePasta = {};
function pastaMudou(pasta, chave){
  let arquivos;
  try{ arquivos = fs.readdirSync(pasta); } catch(err){ return false; }
  const assinatura = arquivos.sort().map(f => {
    try{
      const st = fs.statSync(path.join(pasta, f));
      return `${f}:${st.size}:${st.mtimeMs}`;
    } catch(err){ return f; }
  }).join('|');
  const mudou = assinatura !== _assinaturasDePasta[chave];
  _assinaturasDePasta[chave] = assinatura;
  return mudou;
}

// pasta unica (inbox/): solta qualquer um dos 4 tipos de arquivo aqui —
// PMS (.xml ou .html), nota fiscal (.xml), Lighthouse (.xlsx) ou DRE
// (.xlsx) — e o servidor identifica pelo CONTEUDO (não só a extensão,
// já que nota fiscal e PMS são os dois .xml, e Lighthouse e DRE são os
// dois .xlsx) e move pra pasta certa. Dali pra frente é o mesmo
// pipeline de sempre — essa função só decide "pra onde vai".
function processarInboxUnificado(){
  garantirPastas();
  if(!pastaMudou(INBOX_UNIFICADO, 'unificado')) return;
  let arquivos;
  try{ arquivos = fs.readdirSync(INBOX_UNIFICADO); } catch(err){ return; }

  arquivos.forEach(nome => {
    const caminho = path.join(INBOX_UNIFICADO, nome);
    let stat;
    try{ stat = fs.statSync(caminho); } catch(err){ return; }
    if(!stat.isFile()) return;

    const ext = path.extname(nome).toLowerCase();
    let destino = null;
    try{
      if(ext === '.xml'){
        const conteudo = fs.readFileSync(caminho, 'utf-8');
        destino = /<(nfeProc|NFe)[\s>]/i.test(conteudo) ? NOTAS_INBOX : PMS_INBOX;
      } else if(ext === '.pdf'){
        // só usamos PDF pra uma coisa nesse sistema: nota fiscal em DANFE — vai direto pra notas-inbox/
        destino = NOTAS_INBOX;
      } else if(ext === '.html' || ext === '.htm'){
        destino = PMS_INBOX;
      } else if(ext === '.xlsx'){
        const buffer = fs.readFileSync(caminho);
        // .length, não truthy puro — os leitores de DRE devolvem [] (que é "verdadeiro"
        // em JS) quando não reconhecem o arquivo, não null. Checar só a presença do
        // valor de retorno roteava todo .xlsx pro DRE por engano, mesmo Lighthouse.
        if(parseDreXlsx(buffer).length) destino = DRE_INBOX;
        else if(parseAllStrategyDre(buffer).length) destino = ALLSTRATEGY_INBOX;
        else if(parseXlsxPraca(buffer)) destino = PRACA_INBOX;
      }
    } catch(err){
      log(`⚠ inbox/${nome}: erro tentando identificar o tipo (${err.message})`);
      return;
    }

    if(!destino){
      log(`⚠ inbox/${nome}: não reconheci o formato (esperado: PMS, nota fiscal, Lighthouse, DRE ou All Strategy) — deixei parado ali, confira o arquivo.`);
      return;
    }
    try{
      fs.renameSync(caminho, path.join(destino, nome));
      log(`inbox/${nome} → identificado e movido pra ${path.basename(destino)}/.`);
    } catch(err){
      log(`⚠ inbox/${nome}: identifiquei mas não consegui mover (${err.message})`);
    }
  });
}

/* ---------------------------------------------------------------------
   Extração de tags via regex — Node não tem DOMParser embutido, e pra
   este script ficar com zero dependências (não precisar de "npm
   install"), a extração é feita casando os blocos de tag conhecidos.
   Funciona bem porque os dois formatos (export do PMS e NFe) têm
   estrutura de tag previsível.
   --------------------------------------------------------------------- */
function extrairBlocos(xml, tag){
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const blocos = [];
  let m;
  while((m = re.exec(xml)) !== null) blocos.push(m[1]);
  return blocos;
}
function extrairTexto(xml, tag){
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null;
}

/* ---------- parser do export do PMS (histórico + forecast) ---------- */
function parseOtbXml(xml){
  const registros = [];
  extrairBlocos(xml, 'G_REC_TYPE').forEach(bloco => {
    const recType = extrairTexto(bloco, 'REC_TYPE');
    extrairBlocos(bloco, 'G_CONSIDERED_DATE').forEach(db => {
      const dateStr = extrairTexto(db, 'CONSIDERED_DATE');
      const revenue = parseFloat(extrairTexto(db, 'REVENUE')) || 0;
      if(dateStr) registros.push({ recType, dateStr, revenue });
    });
  });
  // formato antigo (G_REC_TYPE) nao encontrado — tenta o formato de tabela HTML
  // (export "history_forecast" do Oracle Reports: colunas Date/.../Total Revenue/...)
  if(!registros.length){
    return parseOtbHtmlTable(xml);
  }
  return registros;
}

// formato de tabela HTML do PMS (Oracle Reports) — sem tag de A_STAT/B_FORE
// explicita, entao infere real x forecast comparando a data da linha com hoje.
// Regex em vez de DOM parser pra manter zero dependencias no servidor.js.
function parseOtbHtmlTable(html){
  const registros = [];
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const mesesAbrev = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const linhasTr = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  linhasTr.forEach(trHtml => {
    const celulasHtml = trHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    const celulas = celulasHtml
      .map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim())
      .filter(c => c !== '');
    if(celulas.length < 11) return;
    const m = celulas[0].match(/^(\d{2})\/(\d{2})\/(\d{2})/);
    if(!m) return;
    const [, dd, mm, yy] = m;
    const mesIdx = Number(mm) - 1;
    if(mesIdx < 0 || mesIdx > 11) return;
    const dateStr = `${dd}-${mesesAbrev[mesIdx]}-${yy}`;
    const dataObj = new Date(2000 + Number(yy), mesIdx, Number(dd));
    const revenue = parseFloat((celulas[10] || '0').replace(/,/g, '')) || 0;
    const recType = dataObj < hoje ? 'A_STAT' : 'B_FORE';
    registros.push({ recType, dateStr, revenue });
  });
  return registros;
}

/* ---------- parser de Nota Fiscal Eletrônica (NFe padrão SEFAZ) ----------
   Assumido a partir do layout público/estável da NFe. Como ainda não
   recebi uma nota real de vocês pra conferir, se um arquivo não for
   reconhecido ele aparece separado no JSON (arquivo "nao_lido") em vez
   de travar o processamento dos outros. */
function parseNotaXml(xml){
  const infNFe = extrairTexto(xml, 'infNFe') || xml;
  const emit = extrairTexto(infNFe, 'emit') || '';
  const ide = extrairTexto(infNFe, 'ide') || '';
  const total = extrairTexto(infNFe, 'total') || '';

  const fornecedor = extrairTexto(emit, 'xNome') || 'Fornecedor não identificado';
  const cnpj = extrairTexto(emit, 'CNPJ') || extrairTexto(emit, 'CPF') || null;
  const numero = extrairTexto(ide, 'nNF') || null;
  const dataEmissao = extrairTexto(ide, 'dhEmi') || extrairTexto(ide, 'dEmi') || null;
  const valorTotal = parseFloat(extrairTexto(total, 'vNF')) || null;

  const itens = extrairBlocos(infNFe, 'det').map(det => {
    const prod = extrairTexto(det, 'prod') || det;
    return {
      descricao: extrairTexto(prod, 'xProd') || '',
      ncm: extrairTexto(prod, 'NCM') || null,
      cfop: extrairTexto(prod, 'CFOP') || null,
      quantidade: parseFloat(extrairTexto(prod, 'qCom')) || null,
      valorUnitario: parseFloat(extrairTexto(prod, 'vUnCom')) || null,
      valorTotal: parseFloat(extrairTexto(prod, 'vProd')) || null,
    };
  });

  return { fornecedor, cnpj, numero, dataEmissao, valorTotal, itens };
}

/* =====================================================================
   LEITOR DE NOTA FISCAL EM PDF (DANFE) — do zero, sem lib externa
   -----------------------------------------------------------------
   Pedido do usuário: "todas as minhas notas fiscais estão em PDF, dá
   pra ler assim mesmo?". Testado e validado (campo a campo, batendo
   100% contra o XML da mesma nota) com uma nota real de vocês antes de
   entrar aqui — arquivo gerado pelo JasperReports (comum em sistemas
   de faturamento/marketplace, ex.: notas de compra no Mercado Livre),
   com fontes Helvetica/Helvetica-Bold em WinAnsiEncoding (texto
   selecionável, não é imagem escaneada).

   Como funciona: um DANFE (Documento Auxiliar da Nota Fiscal
   Eletrônica) tem layout e rótulos FIXOS por lei — SEFAZ exige as
   mesmas etiquetas em português ("CHAVE DE ACESSO", "DATA DA EMISSÃO",
   "VALOR TOTAL DA NOTA", a frase do canhoto "RECEBEMOS DE ... OS
   PRODUTOS CONSTANTES...") não importa qual sistema emitiu a nota —
   isso é bem mais estável que um PDF de fatura comum, que cada empresa
   formata do seu jeito. Por isso dá pra usar regex nessas etiquetas em
   vez de precisar adivinhar o layout de cada gerador.

   Passos: 1) parse dos objetos do PDF (dicionários/arrays/streams,
   incluindo objetos compactados em ObjStm) só com zlib nativo do Node;
   2) acha a(s) página(s), decodifica o content stream; 3) tokeniza os
   operadores de texto (Tj/TJ/Td/TD/Tm/T*) reconstruindo a posição
   (x,y) aproximada de cada trecho de texto; 4) agrupa em "linhas" por
   Y e ordena por X — vira basicamente o mesmo que um "pdftotext
   -layout" faria, só que sem depender de nenhum programa instalado;
   5) por cima disso, acha os campos pelas etiquetas fixas do DANFE.

   A chave de acesso (44 dígitos, sempre impressa por extenso no DANFE)
   sozinha já decompõe em CNPJ do emitente + número + série da nota —
   isso é aritmética pura sobre um código de posição fixa, então é a
   fonte MAIS confiável (não depende de reconhecer texto ao redor).

   Cobre dois jeitos de fonte: a mais comum (WinAnsiEncoding, texto
   simples, 1 byte por caractere) e fontes compostas Type0/Identity-H
   com CIDFontType2 embutida + /ToUnicode (comum em relatório gerado
   por Oracle Reports, ex: Opera Cloud) — nesse segundo caso, cada
   caractere é 2 bytes (um CID) e o /ToUnicode do próprio PDF diz qual
   letra cada CID representa (ver resolverFontesDaPagina/
   parseToUnicodeCMap abaixo, validados byte a byte contra o
   "Task Sheet Report" real da aba Governança — zero diferença contra
   pdftotext). Se uma nota/relatório de um gerador ainda diferente não
   for lida corretamente, dá pra lançar manualmente (a aba Notas
   Fiscais e a aba Projetos aceitam os dois jeitos) — e mandando o
   arquivo de exemplo, dá pra estender o leitor de novo. */

const WINANSI_ALTOS_PDF = {
  0x80:'€',0x82:'‚',0x83:'ƒ',0x84:'„',0x85:'…',0x86:'†',0x87:'‡',
  0x88:'ˆ',0x89:'‰',0x8A:'Š',0x8B:'‹',0x8C:'Œ',0x8E:'Ž',
  0x91:'‘',0x92:'’',0x93:'“',0x94:'”',0x95:'•',0x96:'–',0x97:'—',
  0x98:'˜',0x99:'™',0x9A:'š',0x9B:'›',0x9C:'œ',0x9E:'ž',0x9F:'Ÿ',
};
function decodeWinAnsiBytePdf(b){
  if(b >= 0x80 && b <= 0x9F) return WINANSI_ALTOS_PDF[b] || '';
  return String.fromCharCode(b); // 0x20-0x7E ascii normal, 0xA0-0xFF = Latin-1 (igual Unicode)
}

function pularEspacosPdf(s, i){
  while(i < s.length){
    if(/\s/.test(s[i])){ i++; continue; }
    if(s[i] === '%'){ while(i < s.length && s[i] !== '\n') i++; continue; } // comentário PDF
    break;
  }
  return i;
}

// parser recursivo de um "valor" PDF: nome (/Foo), string literal ((...)), string
// hex (<...>), dicionário (<<...>>), array ([...]), referência indireta (N G R),
// número, booleano/null. Cobre o que a gente precisa ler de dentro de um PDF.
function parseValorPdf(s, i){
  i = pularEspacosPdf(s, i);
  if(s[i] === '/'){
    let j = i+1;
    while(j < s.length && !/[\s/\[\]<>()]/.test(s[j])) j++;
    return { valor: { __nome: s.slice(i+1, j) }, fim: j };
  }
  if(s[i] === '('){
    let j = i+1, depth = 1, out = '';
    while(j < s.length && depth > 0){
      if(s[j] === '\\'){ out += s[j+1]; j += 2; continue; }
      if(s[j] === '(') depth++;
      if(s[j] === ')'){ depth--; if(depth === 0) break; }
      out += s[j]; j++;
    }
    return { valor: out, fim: j+1 };
  }
  if(s.startsWith('<<', i)){
    let j = i+2;
    const dict = {};
    while(true){
      j = pularEspacosPdf(s, j);
      if(s.startsWith('>>', j)){ j += 2; break; }
      if(s[j] !== '/'){ j++; continue; }
      const chave = parseValorPdf(s, j);
      j = chave.fim;
      const val = parseValorPdf(s, j);
      j = val.fim;
      dict[chave.valor.__nome] = val.valor;
    }
    return { valor: dict, fim: j };
  }
  if(s[i] === '<'){
    let j = i+1;
    while(j < s.length && s[j] !== '>') j++;
    return { valor: { __hex: s.slice(i+1, j).replace(/\s/g,'') }, fim: j+1 };
  }
  if(s[i] === '['){
    let j = i+1;
    const arr = [];
    while(true){
      j = pularEspacosPdf(s, j);
      if(s[j] === ']'){ j++; break; }
      const item = parseValorPdf(s, j);
      arr.push(item.valor);
      j = item.fim;
    }
    return { valor: arr, fim: j };
  }
  const m = s.slice(i, i+5).match(/^(true|false|null)/);
  if(m) return { valor: m[1] === 'true' ? true : m[1] === 'false' ? false : null, fim: i + m[1].length };
  const refMatch = s.slice(i, i+40).match(/^(\d+)\s+(\d+)\s+R\b/);
  if(refMatch) return { valor: { __ref: Number(refMatch[1]) }, fim: i + refMatch[0].length };
  const numMatch = s.slice(i, i+40).match(/^[+-]?\d*\.?\d+/);
  if(numMatch) return { valor: Number(numMatch[0]), fim: i + numMatch[0].length };
  return { valor: null, fim: i+1 };
}

// varre o arquivo inteiro procurando todo "N G obj ... endobj" (objetos indiretos
// diretos). Usa latin1 (1 byte = 1 char) pra manter os offsets de byte corretos
// mesmo dentro de streams binários comprimidos.
function extrairObjetosDiretosPdf(bufferStr){
  const objetos = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while((m = re.exec(bufferStr)) !== null){
    const numObj = Number(m[1]);
    const inicioConteudo = m.index + m[0].length;
    const dictParse = parseValorPdf(bufferStr, inicioConteudo);
    const fimDict = dictParse.fim;
    const restante = bufferStr.slice(fimDict, fimDict + 20);
    const streamMatch = restante.match(/^\s*stream\r?\n/);
    let streamRange = null;
    if(streamMatch && dictParse.valor && typeof dictParse.valor === 'object'){
      const inicioStream = fimDict + streamMatch[0].length;
      const comprimento = typeof dictParse.valor.Length === 'number' ? dictParse.valor.Length : null;
      const fimStream = comprimento !== null ? inicioStream + comprimento : bufferStr.indexOf('endstream', inicioStream);
      streamRange = { inicio: inicioStream, fim: fimStream };
      re.lastIndex = fimStream; // pula o corpo binário do stream, pra não confundir bytes aleatórios com "N G obj"
    }
    objetos.set(numObj, { dict: dictParse.valor, streamRange });
  }
  return objetos;
}

// PDF 1.5+ pode compactar vários objetos pequenos dentro de um único stream
// (/Type/ObjStm) — expande isso pro mesmo Map, achatando tudo num só lugar.
function expandirObjStmPdf(buffer, objetos){
  for(const [, obj] of [...objetos]){
    if(!obj.dict || !obj.dict.Type || obj.dict.Type.__nome !== 'ObjStm' || !obj.streamRange) continue;
    let texto;
    try{ texto = zlib.inflateSync(buffer.slice(obj.streamRange.inicio, obj.streamRange.fim)).toString('latin1'); }
    catch(err){ continue; }
    const n = obj.dict.N, first = obj.dict.First;
    let i = 0;
    const pares = [];
    for(let k=0; k<n; k++){
      i = pularEspacosPdf(texto, i);
      const mNum = texto.slice(i).match(/^\d+/); const numObjInterno = Number(mNum[0]); i += mNum[0].length;
      i = pularEspacosPdf(texto, i);
      const mOff = texto.slice(i).match(/^\d+/); const offset = Number(mOff[0]); i += mOff[0].length;
      pares.push([numObjInterno, offset]);
    }
    pares.forEach(([numObjInterno, offset]) => {
      const valorParse = parseValorPdf(texto, first + offset);
      objetos.set(numObjInterno, { dict: valorParse.valor, streamRange: null });
    });
  }
}

function resolverRefPdf(objetos, val){
  if(val && typeof val === 'object' && typeof val.__ref === 'number'){
    const alvo = objetos.get(val.__ref);
    return alvo ? alvo.dict : null;
  }
  return val;
}

function lerObjetosPdf(buffer){
  const objetos = extrairObjetosDiretosPdf(buffer.toString('latin1'));
  expandirObjStmPdf(buffer, objetos);
  return objetos;
}

// desce a árvore /Pages > /Kids recursivamente coletando toda folha /Type/Page —
// notas com muitos itens podem vir em mais de uma página.
function acharTodasPaginasPdf(objetos){
  let catalogo = null;
  for(const [, obj] of objetos){
    if(obj.dict && obj.dict.Type && obj.dict.Type.__nome === 'Catalog'){ catalogo = obj.dict; break; }
  }
  if(!catalogo) throw new Error('Catálogo (/Type/Catalog) não encontrado no PDF.');
  const paginas = [];
  function coletar(node){
    if(!node) return;
    if(node.Type && node.Type.__nome === 'Page'){ paginas.push(node); return; }
    if(Array.isArray(node.Kids) && node.Kids.length) node.Kids.forEach(k => coletar(resolverRefPdf(objetos, k)));
  }
  coletar(resolverRefPdf(objetos, catalogo.Pages));
  if(!paginas.length) throw new Error('Nenhuma página (/Type/Page) encontrada.');
  return paginas;
}

function obterTextoConteudoPdf(buffer, objetos, pagina){
  const contents = pagina.Contents;
  const refs = Array.isArray(contents) ? contents : [contents];
  let textoTotal = '';
  refs.forEach(ref => {
    const obj = objetos.get(ref && ref.__ref);
    if(!obj || !obj.streamRange) return;
    const bytes = buffer.slice(obj.streamRange.inicio, obj.streamRange.fim);
    const filtro = obj.dict.Filter && obj.dict.Filter.__nome;
    const decompresso = filtro === 'FlateDecode' ? zlib.inflateSync(bytes) : bytes;
    textoTotal += decompresso.toString('latin1') + '\n';
  });
  return textoTotal;
}

// lê o stream /ToUnicode de uma fonte (um "CMap" no formato texto do PDF) e
// devolve um Map CID(número) -> texto Unicode. Cobre os dois formatos que o
// spec permite: beginbfchar/endbfchar (pares CID->texto um a um) e
// beginbfrange/endbfrange (faixas de CID, com destino em base única ou em
// array — um valor por CID da faixa).
function parseToUnicodeCMap(texto){
  const mapa = new Map();
  const blocosChar = texto.match(/beginbfchar([\s\S]*?)endbfchar/g) || [];
  blocosChar.forEach(bloco => {
    const pares = bloco.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || [];
    pares.forEach(par => {
      const m = par.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      const src = parseInt(m[1], 16);
      const dstHex = m[2];
      let dst = '';
      for(let k=0; k<dstHex.length; k+=4) dst += String.fromCharCode(parseInt(dstHex.slice(k,k+4), 16));
      mapa.set(src, dst);
    });
  });
  const blocosRange = texto.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
  blocosRange.forEach(bloco => {
    const linhas = bloco.match(/<[0-9A-Fa-f]+>\s*<[0-9A-Fa-f]+>\s*(?:<[0-9A-Fa-f]+>|\[[^\]]*\])/g) || [];
    linhas.forEach(linha => {
      const mArr = linha.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/);
      if(mArr){
        const lo = parseInt(mArr[1],16);
        const itens = mArr[3].match(/<([0-9A-Fa-f]+)>/g) || [];
        itens.forEach((it, idx) => {
          const hex = it.replace(/[<>]/g,'');
          let dst = '';
          for(let k=0; k<hex.length; k+=4) dst += String.fromCharCode(parseInt(hex.slice(k,k+4),16));
          mapa.set(lo+idx, dst);
        });
        return;
      }
      const m = linha.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      if(m){
        const lo = parseInt(m[1],16), hi = parseInt(m[2],16), dstBase = parseInt(m[3].slice(0,4),16);
        for(let cid=lo; cid<=hi; cid++) mapa.set(cid, String.fromCharCode(dstBase + (cid-lo)));
      }
    });
  });
  return mapa;
}

// resolve, pra uma página, o dicionário /Resources /Font: nome do recurso
// (o que aparece depois do operador Tf, ex "/F1") -> { cid: é fonte Type0
// composta?, toUnicode: Map do CMap acima, ou null se a fonte não tiver
// /ToUnicode (aí cai no WinAnsi de sempre). Sem isso não dá pra saber, ao
// tokenizar, se uma string hex é WinAnsi (1 byte/char) ou CID (2 bytes/char).
function resolverFontesDaPagina(buffer, objetos, pagina){
  const resources = resolverRefPdf(objetos, pagina.Resources) || pagina.Resources;
  const fontesDict = resources && resolverRefPdf(objetos, resources.Font);
  const mapa = {};
  if(!fontesDict) return mapa;
  Object.keys(fontesDict).forEach(nomeRecurso => {
    const fontObj = resolverRefPdf(objetos, fontesDict[nomeRecurso]);
    if(!fontObj) return;
    const ehCid = fontObj.Subtype && fontObj.Subtype.__nome === 'Type0';
    let toUnicode = null;
    if(fontObj.ToUnicode){
      const tuObj = objetos.get(fontObj.ToUnicode.__ref);
      if(tuObj && tuObj.streamRange){
        const bytes = buffer.slice(tuObj.streamRange.inicio, tuObj.streamRange.fim);
        const filtroRaw = tuObj.dict.Filter;
        const filtro = filtroRaw && (filtroRaw.__nome || (Array.isArray(filtroRaw) && filtroRaw[0] && filtroRaw[0].__nome));
        try{
          const texto = filtro === 'FlateDecode' ? zlib.inflateSync(bytes).toString('latin1') : bytes.toString('latin1');
          toUnicode = parseToUnicodeCMap(texto);
        } catch(err){ toUnicode = null; } // stream corrompido/formato inesperado — cai no fallback abaixo
      }
    }
    mapa[nomeRecurso] = { cid: ehCid, toUnicode };
  });
  return mapa;
}

// tokeniza os operadores de texto do content stream (BT/ET, Tf, Td/TD/Tm/T*,
// Tj/TJ/'/") e devolve cada trecho de texto mostrado com posição (x,y)
// aproximada — segue só a translação da matriz de texto, o que basta pra um
// documento sem rotação/escala como o DANFE ou o Task Sheet Report.
// `fontesMap` (opcional, formato de resolverFontesDaPagina) diz, fonte a
// fonte, se uma string hex é WinAnsi (1 byte/char, comportamento padrão,
// igual sempre foi) ou CID de fonte composta (2 bytes/char, decodificada via
// /ToUnicode) — sem fontesMap ou sem entrada pra fonte atual, cai sempre no
// caminho WinAnsi de sempre, então PDFs já lidos antes (DANFE) não mudam.
function tokenizarConteudoTextoPdf(conteudo, fontesMap){
  fontesMap = fontesMap || {};
  const runs = [];
  let tx = 0, ty = 0, leading = 0, linhaBaseX = 0, linhaBaseY = 0;
  let fonteAtual = null;
  const tokens = conteudo.match(/\/[A-Za-z0-9#+._-]+|\(([^\\)]|\\.)*\)|<[0-9A-Fa-f\s]*>|\[[^\]]*\]|[-+]?\d*\.?\d+|BT|ET|[A-Za-z'"]+/g) || [];
  let pilha = [];

  function decodificarStringLiteral(strTok){
    const inner = strTok.slice(1, -1);
    let out = '';
    for(let k=0; k<inner.length; k++){
      if(inner[k] === '\\'){
        const prox = inner[k+1];
        if(/[0-7]/.test(prox)){
          const oct = inner.slice(k+1, k+4).match(/^[0-7]{1,3}/)[0];
          out += String.fromCharCode(parseInt(oct, 8));
          k += oct.length;
        } else if(prox === 'n'){ out += '\n'; k++; }
        else if(prox === 'r'){ out += '\r'; k++; }
        else if(prox === 't'){ out += '\t'; k++; }
        else { out += prox; k++; }
      } else out += inner[k];
    }
    return out;
  }
  function bytesParaTextoWinAnsi(strBytes){
    let out = '';
    for(let k=0; k<strBytes.length; k++) out += decodeWinAnsiBytePdf(strBytes.charCodeAt(k));
    return out;
  }
  // string hex pode ser WinAnsi (1 byte/char, de sempre) ou, se a fonte atual
  // for CID (Type0/Identity-H), 2 bytes/char resolvidos pelo /ToUnicode.
  function decodificarHex(hex){
    const info = fonteAtual && fontesMap[fonteAtual];
    if(info && info.cid){
      let out = '';
      for(let k=0; k+4<=hex.length; k+=4){
        const cid = parseInt(hex.slice(k,k+4), 16);
        const uni = info.toUnicode ? info.toUnicode.get(cid) : undefined;
        out += (uni !== undefined) ? uni : '';
      }
      return out;
    }
    let bytes = '';
    for(let k=0; k+2<=hex.length; k+=2) bytes += String.fromCharCode(parseInt(hex.slice(k,k+2), 16));
    return bytesParaTextoWinAnsi(bytes);
  }
  function registrarTexto(strDecodificada){
    if(strDecodificada) runs.push({ texto: strDecodificada, x: tx, y: ty });
  }

  tokens.forEach(tok => {
    if(tok === 'BT'){ tx = 0; ty = 0; linhaBaseX = 0; linhaBaseY = 0; pilha = []; return; }
    if(tok === 'ET'){ pilha = []; return; }
    if(tok.startsWith('/')){ pilha.push({ nome: tok.slice(1) }); return; }
    if(tok.startsWith('(')){ pilha.push({ str: bytesParaTextoWinAnsi(decodificarStringLiteral(tok)) }); return; }
    if(tok.startsWith('<')){
      const hex = tok.slice(1,-1).replace(/\s/g,'');
      pilha.push({ str: decodificarHex(hex) });
      return;
    }
    if(tok.startsWith('[')){
      const partes = tok.slice(1,-1).match(/\(([^\\)]|\\.)*\)|<[0-9A-Fa-f\s]*>|[-+]?\d*\.?\d+/g) || [];
      let junto = '';
      partes.forEach(p => {
        if(p.startsWith('(')) junto += bytesParaTextoWinAnsi(decodificarStringLiteral(p));
        else if(p.startsWith('<')){
          const hex = p.slice(1,-1).replace(/\s/g,'');
          junto += decodificarHex(hex);
        }
      });
      pilha.push({ str: junto });
      return;
    }
    if(/^[-+]?\d*\.?\d+$/.test(tok)){ pilha.push({ num: Number(tok) }); return; }

    switch(tok){
      case 'Td': { const dy = pilha.pop().num, dx = pilha.pop().num; linhaBaseX += dx; linhaBaseY += dy; tx = linhaBaseX; ty = linhaBaseY; pilha = []; break; }
      case 'TD': { const dy = pilha.pop().num, dx = pilha.pop().num; leading = -dy; linhaBaseX += dx; linhaBaseY += dy; tx = linhaBaseX; ty = linhaBaseY; pilha = []; break; }
      case 'Tm': { const f = pilha.pop().num, e = pilha.pop().num; pilha.pop(); pilha.pop(); pilha.pop(); pilha.pop(); linhaBaseX = e; linhaBaseY = f; tx = e; ty = f; pilha = []; break; }
      case 'T*': linhaBaseY -= leading; tx = linhaBaseX; ty = linhaBaseY; pilha = []; break;
      case "'": linhaBaseY -= leading; tx = linhaBaseX; ty = linhaBaseY; pilha = []; break;
      case 'Tf': { pilha.pop(); const nomeF = pilha.pop(); fonteAtual = nomeF && nomeF.nome; pilha = []; break; } // guarda a fonte atual — precisa pra decidir WinAnsi x CID acima
      case 'Tj': { const item = pilha.pop(); registrarTexto(item && item.str); pilha = []; break; }
      case 'TJ': { const item = pilha.pop(); registrarTexto(item && item.str); pilha = []; break; }
      default: pilha = []; // Tc, Tw, TL, rg, w, re, f, etc. — não precisamos, só limpa a pilha
    }
  });
  return runs;
}

function parseMoedaBrPdf(txt){
  if(!txt) return 0;
  return parseFloat(String(txt).replace(/\./g,'').replace(',','.')) || 0;
}

// agrupa os runs de texto em "linhas" (mesma coordenada Y, tolerância de 3pt)
// ordenadas de cima pra baixo, cada uma com os itens ordenados da esquerda pra
// direita — reconstrói a leitura visual do documento.
function agruparEmLinhasPdf(runs){
  const ordenados = [...runs].sort((a,b) => b.y - a.y || a.x - b.x);
  const linhas = [];
  ordenados.forEach(r => {
    let linha = linhas.find(l => Math.abs(l.y - r.y) < 3);
    if(!linha){ linha = { y: r.y, itens: [] }; linhas.push(linha); }
    linha.itens.push(r);
  });
  linhas.sort((a,b) => b.y - a.y);
  linhas.forEach(l => l.itens.sort((a,b) => a.x - b.x));
  return linhas;
}

function extrairChaveDeAcessoPdf(linhas){
  for(const linha of linhas){
    for(const item of linha.itens){
      const digitos = item.texto.replace(/\s/g,'');
      if(/^\d{44}$/.test(digitos)) return digitos;
    }
  }
  return null;
}

// a chave de acesso tem posição fixa por especificação da SEFAZ — decompor
// aritmeticamente é mais confiável que tentar reconhecer texto ao redor.
function decomporChaveDeAcessoPdf(chave){
  return {
    cnpjEmit: chave.slice(6,20),
    serie: String(Number(chave.slice(22,25))),
    numero: String(Number(chave.slice(25,34))),
  };
}

function acharValorNaProximaLinhaPdf(linhas, idxLinhaRotulo, colunaIdx, regexValor){
  for(let k = idxLinhaRotulo+1; k < Math.min(idxLinhaRotulo+3, linhas.length); k++){
    const itens = linhas[k].itens;
    if(itens[colunaIdx] && regexValor.test(itens[colunaIdx].texto)) return itens[colunaIdx].texto;
    const achado = itens.find(i => regexValor.test(i.texto));
    if(achado) return achado.texto;
  }
  return null;
}

// tabela "DADOS DO PRODUTO / SERVIÇOS": qualquer linha com 2+ valores em
// formato monetário (99,99) entre esse cabeçalho e "CÁLCULO DO ISSQN" /
// "DADOS ADICIONAIS" é um item — cabeçalhos/sub-cabeçalhos não têm vírgula
// decimal, então não entram nessa contagem.
function extrairItensDaTabelaPdf(linhas){
  const inicio = linhas.findIndex(l => l.itens.some(i => /DADOS DO PRODUTO/i.test(i.texto)));
  if(inicio === -1) return [];
  let fim = linhas.findIndex(l => l.itens.some(i => /CÁLCULO DO ISSQN|DADOS ADICIONAIS|RESERVADO AO FISCO/i.test(i.texto)));
  if(fim === -1) fim = linhas.length;
  const itensNota = [];
  for(let k = inicio+1; k < fim; k++){
    const textos = linhas[k].itens.map(i => i.texto);
    const monetarios = textos.filter(t => /^\d{1,3}(\.\d{3})*,\d{2}$/.test(t));
    if(monetarios.length < 2) continue;
    const idxNcm = textos.findIndex((t,i) => i > 0 && /^\d{8}$/.test(t));
    const descricao = idxNcm > 1 ? textos.slice(1, idxNcm).join(' ') : (textos[1] || textos[0] || '');
    itensNota.push({ descricao: descricao.trim(), valorTotal: parseMoedaBrPdf(monetarios[1]) });
  }
  return itensNota;
}

// função principal: lê um DANFE em PDF e devolve o MESMO formato que parseNotaXml
// devolve pro XML — assim tudo que já existe (classificação CMV/Operacional/Fixo,
// vínculo com projeto de melhoria etc.) funciona sem precisar saber a origem.
function parseNotaPdf(buffer){
  const objetos = lerObjetosPdf(buffer);
  const paginas = acharTodasPaginasPdf(objetos);
  let linhas = [];
  paginas.forEach(pagina => {
    const fontesMap = resolverFontesDaPagina(buffer, objetos, pagina);
    const conteudo = obterTextoConteudoPdf(buffer, objetos, pagina);
    linhas = linhas.concat(agruparEmLinhasPdf(tokenizarConteudoTextoPdf(conteudo, fontesMap)));
  });

  let fornecedor = null;
  for(const linha of linhas){
    const item = linha.itens.find(i => /^RECEBEMOS DE /.test(i.texto));
    if(item){ fornecedor = item.texto.replace(/^RECEBEMOS DE /,'').replace(/\s*OS PRODUTOS CONSTANTES.*$/i,'').trim(); break; }
  }

  const chave = extrairChaveDeAcessoPdf(linhas);
  let cnpj = null, numero = null, serie = null;
  if(chave){
    const decomp = decomporChaveDeAcessoPdf(chave);
    cnpj = decomp.cnpjEmit; numero = decomp.numero; serie = decomp.serie;
  }
  if(!numero){ // fallback raro: chave só apareceu como imagem/código de barras, sem texto por baixo
    for(const linha of linhas){
      const idx = linha.itens.findIndex(i => /^Nº$/.test(i.texto));
      if(idx !== -1 && linha.itens[idx+1]){ numero = linha.itens[idx+1].texto.replace(/\D/g,'').replace(/^0+/,'') || linha.itens[idx+1].texto; break; }
    }
  }

  let dataEmissao = null;
  for(let k=0; k<linhas.length; k++){
    const idx = linhas[k].itens.findIndex(i => /^DATA DA EMISSÃO$/i.test(i.texto));
    if(idx !== -1){
      const bruta = acharValorNaProximaLinhaPdf(linhas, k, idx, /^\d{2}\/\d{2}\/\d{4}$/);
      if(bruta){ const m = bruta.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(m) dataEmissao = `${m[3]}-${m[2]}-${m[1]}`; }
      break;
    }
  }

  let valorTotal = null;
  for(let k=0; k<linhas.length; k++){
    const idx = linhas[k].itens.findIndex(i => /^VALOR TOTAL DA NOTA$/i.test(i.texto));
    if(idx !== -1){
      for(let j=k+1; j<Math.min(k+3, linhas.length); j++){
        const monetarios = linhas[j].itens.filter(i => /^\d{1,3}(\.\d{3})*,\d{2}$/.test(i.texto));
        if(monetarios.length){ valorTotal = parseMoedaBrPdf(monetarios[monetarios.length-1].texto); break; }
      }
      break;
    }
  }

  const itens = extrairItensDaTabelaPdf(linhas).map(it => ({ descricao: it.descricao, ncm: null, cfop: null, quantidade: null, valorUnitario: null, valorTotal: it.valorTotal }));
  if(valorTotal === null && itens.length) valorTotal = itens.reduce((s,i) => s + i.valorTotal, 0);

  return { fornecedor: fornecedor || 'Fornecedor não identificado', cnpj, numero, dataEmissao, valorTotal, itens };
}

/* =====================================================================
   LEITURA DO "TASK SHEET REPORT" DO OPERA CLOUD (PDF) — aba Governança
   =====================================================================
   Cada Task Sheet No. dentro do relatório é o plano de UMA camareira pro
   dia (confirmado pelo usuário) — um único PDF exportado do Opera pode
   trazer vários Task Sheet No. (várias camareiras) de uma vez, às vezes
   espalhados por mais de uma página cada. No fim ainda pode vir uma
   página "Report Summary" com o total oficial por Task Sheet No. — não
   usamos ela pros quartos (não tem o detalhe linha a linha), só como
   conferência cruzada (bate o que a gente extraiu contra o que o Opera
   soma sozinho).

   Esse relatório usa fonte Type0/Identity-H (texto em CID, 2 bytes por
   caractere) — por isso tokenizarConteudoTextoPdf recebe fontesMap aqui
   (o DANFE, mais simples, não precisa mas continua funcionando igual:
   sem fonte CID na página, cai no caminho WinAnsi de sempre).

   Validado campo a campo (zero diferença) contra pdftotext -layout no
   PDF de amostra fornecido — ver ESTADO_DO_PROJETO.md, seção Governança,
   pra detalhe de como foi validado.

   Cada linha de quarto sempre sai em exatamente 8 "itens" de texto
   posicionados (colunas fixas do relatório): Room No, Room Type, Room
   Status (DI/CL), FO Status (VAC/OCC), Reservation Status, Name,
   Arrival, Departure — por isso a extração usa POSIÇÃO DE COLUNA (mais
   confiável que regex em cima do texto todo junto, que quebraria com
   nome de hóspede com vírgula/asterisco ou "Reservation Status" de duas
   palavras como "Due Out").

   categoria ("saida" x "arrumacao") não usa o texto do Reservation
   Status diretamente (o Opera já viu esse relatório com "Departed",
   mas o usuário descreveu "Due Out"/"Checkout" — o texto exato varia
   conforme o horário de extração do relatório e a configuração do
   Opera). Em vez disso compara a DATA de partida do quarto com a data
   do próprio Task Sheet: se o quarto parte no mesmo dia do plano, é uma
   saída (troca completa); senão é arrumação (hóspede continua na casa).
   Essa regra é a mesma informação que "Due Out/Checkout" carregam, só
   que extraída de um campo mais estável (data) que de um rótulo de
   texto que pode variar. */
function converterDataBrCurtaPdf(str){
  // "13/08/26" -> "2026-08-13" (ano com 2 dígitos, sempre 20XX — relatório é sempre recente)
  const m = String(str || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if(!m) return null;
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

function parseTaskSheetReportPdf(buffer){
  const objetos = lerObjetosPdf(buffer);
  const paginas = acharTodasPaginasPdf(objetos);
  const planosMap = new Map(); // chave "data__taskSheetNo" -> {data, taskSheetNo, taskCode, quartos:[...]}
  const resumoOficial = new Map(); // mesma chave -> {totalRooms, dirtyRooms, cleanRooms, departureRooms, adults}, vindo da página "Report Summary"

  paginas.forEach(pagina => {
    const fontesMap = resolverFontesDaPagina(buffer, objetos, pagina);
    const conteudo = obterTextoConteudoPdf(buffer, objetos, pagina);
    const linhas = agruparEmLinhasPdf(tokenizarConteudoTextoPdf(conteudo, fontesMap));

    // página "Report Summary": tabela com Date / Task Sheet No. / Attendant / Total-Dirty-Clean-Departure Rooms / Adults —
    // a data só aparece na primeira linha de cada dia, as seguintes começam direto pelo número do Task Sheet.
    const ehPaginaResumo = linhas.some(l => l.itens[0] && l.itens[0].texto.trim() === 'Report Summary');
    if(ehPaginaResumo){
      let dataAtual = null;
      linhas.forEach(l => {
        const textos = l.itens.map(i => i.texto.trim());
        if(/^\d{2}\/\d{2}\/\d{2}$/.test(textos[0]) && textos.length >= 7){
          dataAtual = converterDataBrCurtaPdf(textos[0]);
          const [, tsNo, total, dirty, clean, depart, adults] = textos;
          if(dataAtual && /^\d+$/.test(tsNo)) resumoOficial.set(`${dataAtual}__${tsNo}`, { totalRooms:Number(total)||0, dirtyRooms:Number(dirty)||0, cleanRooms:Number(clean)||0, departureRooms:Number(depart)||0, adults:Number(adults)||0 });
        } else if(dataAtual && /^\d+$/.test(textos[0]) && textos.length >= 6){
          const [tsNo, total, dirty, clean, depart, adults] = textos;
          resumoOficial.set(`${dataAtual}__${tsNo}`, { totalRooms:Number(total)||0, dirtyRooms:Number(dirty)||0, cleanRooms:Number(clean)||0, departureRooms:Number(depart)||0, adults:Number(adults)||0 });
        }
      });
      return; // página de resumo não tem tabela de quarto — nada mais a fazer aqui
    }

    // cabeçalho "Task Sheet <data> / <código> / <número>" — identifica de qual plano é essa página
    const linhaCabecalho = linhas.find(l => l.itens[0] && l.itens[0].texto.trim() === 'Task Sheet' && l.itens.length >= 6);
    if(!linhaCabecalho) return; // página sem cabeçalho reconhecido (ex: capa) — pula sem travar o resto
    const dataRelatorio = converterDataBrCurtaPdf(linhaCabecalho.itens[1].texto);
    const taskCode = linhaCabecalho.itens[3].texto.trim();
    const taskSheetNo = linhaCabecalho.itens[5].texto.trim();
    if(!dataRelatorio || !taskSheetNo) return;

    const chave = `${dataRelatorio}__${taskSheetNo}`;
    if(!planosMap.has(chave)) planosMap.set(chave, { data: dataRelatorio, taskSheetNo, taskCode, quartos: [] });
    const plano = planosMap.get(chave);

    linhas.forEach(l => {
      const it = l.itens;
      if(it.length !== 8) return;
      const numero = it[0].texto.trim();
      const roomStatus = it[2].texto.trim();
      const foStatus = it[3].texto.trim();
      if(!/^\d{3,4}$/.test(numero) || !['DI','CL'].includes(roomStatus) || !['VAC','OCC'].includes(foStatus)) return;
      if(plano.quartos.some(q => q.numero === numero)) return; // defesa contra linha duplicada (tabela repetida entre páginas etc.)
      const chegada = converterDataBrCurtaPdf(it[6].texto);
      const partida = converterDataBrCurtaPdf(it[7].texto);
      plano.quartos.push({
        numero, tipo: it[1].texto.trim(), roomStatus, foStatus,
        reservationStatus: it[4].texto.trim(),
        hospede: it[5].texto.replace(/^\*\s*/,'').trim(),
        chegada, partida,
        categoria: (partida && partida === dataRelatorio) ? 'saida' : 'arrumacao',
      });
    });
  });

  return [...planosMap.values()].map(p => ({ ...p, totalQuartos: p.quartos.length, oficial: resumoOficial.get(`${p.data}__${p.taskSheetNo}`) || null }));
}

/* ---------- processa as duas pastas e grava os JSONs ---------- */
function processarPmsInbox(){
  garantirPastas();
  if(!pastaMudou(PMS_INBOX, 'pms')) return;
  const arquivos = fs.readdirSync(PMS_INBOX).filter(f => /\.(xml|html?)$/i.test(f));
  if(!arquivos.length){
    log('pms-inbox/ vazia — nada pra processar ainda.');
    return;
  }
  let todosRegistros = [];
  let processados = [];
  arquivos.forEach(f => {
    try{
      const xml = fs.readFileSync(path.join(PMS_INBOX, f), 'utf-8');
      const registros = parseOtbXml(xml);
      if(registros.length){
        todosRegistros = todosRegistros.concat(registros);
        processados.push({ arquivo: f, registros: registros.length });
      } else {
        log(`⚠ ${f}: nenhum registro reconhecido (formato inesperado?)`);
      }
    } catch(err){
      log(`⚠ erro lendo ${f}: ${err.message}`);
    }
  });
  const saida = {
    geradoEm: new Date().toISOString(),
    arquivosProcessados: processados,
    registros: todosRegistros,
  };
  fs.writeFileSync(OTB_JSON, JSON.stringify(saida));
  const snapshotPath = path.join(HISTORICO_DIR, `otb-${dataDeHoje()}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(saida)); // guarda/atualiza a foto de HOJE; dias anteriores ficam intocados
  log(`data/otb-data.json atualizado — ${todosRegistros.length} registros de ${processados.length} arquivo(s).`);
}

function processarNotasInbox(){
  garantirPastas();
  if(!pastaMudou(NOTAS_INBOX, 'notas')) return;
  const arquivos = fs.readdirSync(NOTAS_INBOX).filter(f => /\.(xml|pdf)$/i.test(f));
  if(!arquivos.length){
    log('notas-inbox/ vazia — nada pra processar ainda.');
    return;
  }
  const notas = [];
  const naoLidas = [];
  arquivos.forEach(f => {
    try{
      const ehPdf = /\.pdf$/i.test(f);
      const nota = ehPdf
        ? parseNotaPdf(fs.readFileSync(path.join(NOTAS_INBOX, f)))
        : parseNotaXml(fs.readFileSync(path.join(NOTAS_INBOX, f), 'utf-8'));
      if(nota.valorTotal || nota.itens.length){
        notas.push({ arquivo: f, ...nota });
      } else {
        naoLidas.push(f);
      }
    } catch(err){
      log(`⚠ erro lendo ${f}: ${err.message}`);
      naoLidas.push(f);
    }
  });
  const saida = {
    geradoEm: new Date().toISOString(),
    notas,
    naoLidas,
  };
  fs.writeFileSync(NOTAS_JSON, JSON.stringify(saida));
  log(`data/notas-data.json atualizado — ${notas.length} nota(s) lida(s)${naoLidas.length ? `, ${naoLidas.length} não reconhecida(s)` : ''}.`);
}

function processarTudo(){
  processarInboxUnificado();
  processarPmsInbox();
  processarNotasInbox();
  processarPracaInbox();
  processarDreInbox();
  processarAllStrategyInbox();
}

/* ---------- persistencia de estado (o que o usuario edita no painel) ---------- */
const ESTADO_JSON = path.join(DATA_DIR, 'estado.json');
const TAMANHO_MAX_BODY = 5 * 1024 * 1024; // 5MB, generoso o bastante e protege contra corpo absurdo

/* ---------- backup automático versionado (novo, 2026.08.14) ----------
   A cada save, a versão ANTERIOR de estado.json é copiada pra
   data/backups/ antes de ser sobrescrita — protege contra perda de dado
   por clique errado, corrupção, ou qualquer coisa que apague informação
   real por acidente. Rotação simples por contagem (mantém as
   MAX_BACKUPS cópias mais recentes) pra não deixar o disco crescer sem
   limite com o tempo. */
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 500; // debounce de save é ~1s de silêncio depois de editar, então isso cobre bastante tempo de uso real antes de começar a descartar os mais antigos

function fazerBackupEstado(){
  if(!fs.existsSync(ESTADO_JSON)) return; // nada ainda pra fazer backup (primeiro save de todos)
  try{
    garantirPastas();
    if(!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive:true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sufixo = Math.random().toString(36).slice(2,6); // evita colisão se dois saves caírem no mesmo milissegundo
    fs.copyFileSync(ESTADO_JSON, path.join(BACKUPS_DIR, `estado-${timestamp}-${sufixo}.json`));
    const arquivos = fs.readdirSync(BACKUPS_DIR).filter(n => n.startsWith('estado-') && n.endsWith('.json')).sort();
    if(arquivos.length > MAX_BACKUPS){
      arquivos.slice(0, arquivos.length - MAX_BACKUPS).forEach(nome => {
        try{ fs.unlinkSync(path.join(BACKUPS_DIR, nome)); } catch(err){ /* ignora — não é crítico */ }
      });
    }
  } catch(err){ log(`⚠ falha ao fazer backup do estado: ${err.message}`); }
}

function salvarEstado(req, res){
  let tamanho = 0;
  const pedacos = [];
  req.on('data', chunk => {
    tamanho += chunk.length;
    if(tamanho > TAMANHO_MAX_BODY){ req.destroy(); return; }
    pedacos.push(chunk);
  });
  req.on('end', () => {
    try{
      const texto = Buffer.concat(pedacos).toString('utf-8');
      const dados = JSON.parse(texto); // valida que é JSON antes de gravar

      // proteção contra sobrescrita concorrente (2 computadores salvando ao mesmo
      // tempo): cada save manda a versão que o navegador carregou por último
      // (versaoBase). Cada save manda o ESTADO INTEIRO (não só o campo que
      // mudou), então se outro dispositivo já salvou algo mais novo, aceitar
      // esse save aqui apagaria silenciosamente aquela mudança — em vez disso,
      // recusa (409) e deixa o painel avisar a pessoa a recarregar.
      let versaoAtual = 0;
      if(fs.existsSync(ESTADO_JSON)){
        try{ versaoAtual = JSON.parse(fs.readFileSync(ESTADO_JSON, 'utf-8')).versao || 0; } catch(err){ versaoAtual = 0; }
      }
      const versaoBase = typeof dados.versaoBase === 'number' ? dados.versaoBase : 0;
      if(versaoAtual > 0 && versaoBase > 0 && versaoBase < versaoAtual){
        log(`⚠ save recusado — conflito de versão (cliente tinha v${versaoBase}, atual é v${versaoAtual}); outro dispositivo salvou primeiro.`);
        res.writeHead(409, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ ok:false, conflito:true, erro:'Os dados foram atualizados por outro dispositivo. Recarregue a página antes de continuar.', versaoAtual }));
        return;
      }

      fazerBackupEstado(); // guarda a cópia anterior ANTES de sobrescrever

      delete dados.versaoBase; // era só metadado de controle dessa requisição, não é campo do estado de verdade
      dados.versao = versaoAtual + 1;
      dados.salvoEm = new Date().toISOString();
      garantirPastas();
      fs.writeFileSync(ESTADO_JSON, JSON.stringify(dados));
      log(`Estado salvo (data/estado.json) — v${dados.versao} · ${Math.round(texto.length/1024)}kb.`);
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:true, salvoEm: dados.salvoEm, versao: dados.versao }));
    } catch(err){
      log(`⚠ falha ao salvar estado: ${err.message}`);
      res.writeHead(400, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:false, erro: err.message }));
    }
  });
}

/* ---------- persistência de fotos (aba "Projetos" — antes/depois) ----------
   As fotos NÃO entram no data/estado.json (ficariam gigantes em base64
   ali dentro, e o /api/estado tem um limite de corpo de 5MB pensado pra
   dado financeiro, não imagem). Em vez disso, cada foto vira um arquivo
   próprio em data/fotos/, e o painel guarda só o CAMINHO do arquivo no
   estado — mesma ideia de "estado leve, arquivo pesado à parte" que o
   resto do projeto já usa pros uploads de PMS/DRE/notas. */
const TAMANHO_MAX_FOTO = 12 * 1024 * 1024; // 12MB por foto — generoso, cobre foto de celular sem compressão nenhuma

function salvarFoto(req, res){
  let tamanho = 0;
  const pedacos = [];
  req.on('data', chunk => {
    tamanho += chunk.length;
    if(tamanho > TAMANHO_MAX_FOTO){ req.destroy(); return; }
    pedacos.push(chunk);
  });
  req.on('end', () => {
    try{
      const texto = Buffer.concat(pedacos).toString('utf-8');
      const dados = JSON.parse(texto); // { dataUrl: "data:image/jpeg;base64,...." }
      const match = String(dados.dataUrl || '').match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
      if(!match) throw new Error('formato de imagem não reconhecido (esperado PNG/JPEG/WEBP em base64)');
      const extBruta = match[1].toLowerCase();
      const ext = extBruta === 'jpg' || extBruta === 'jpeg' ? 'jpg' : extBruta;
      const buffer = Buffer.from(match[2], 'base64');
      garantirPastas();
      const nome = `foto-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
      fs.writeFileSync(path.join(FOTOS_DIR, nome), buffer);
      log(`Foto salva: data/fotos/${nome} (${Math.round(buffer.length/1024)}kb).`);
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:true, caminho: `data/fotos/${nome}` }));
    } catch(err){
      log(`⚠ falha ao salvar foto: ${err.message}`);
      res.writeHead(400, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:false, erro: err.message }));
    }
  });
}

/* ---------- persistência do plano escaneado da camareira (aba "Governança") ----------
   Mesma ideia da foto acima: o PDF/foto escaneado do plano em papel NÃO é
   processado (é letra de mão — ver decisão registrada em ESTADO_DO_PROJETO.md,
   seção Governança) — fica só como referência visual pra quem for fazer a
   conferência manual dos quartos. Aceita PDF (o formato combinado) e também
   imagem, caso alguém suba a foto direto sem converter pra PDF. */
const TAMANHO_MAX_ANEXO = 20 * 1024 * 1024; // 20MB — PDF escaneado em boa resolução pode pesar mais que uma foto só

function salvarAnexo(req, res){
  let tamanho = 0;
  const pedacos = [];
  req.on('data', chunk => {
    tamanho += chunk.length;
    if(tamanho > TAMANHO_MAX_ANEXO){ req.destroy(); return; }
    pedacos.push(chunk);
  });
  req.on('end', () => {
    try{
      const texto = Buffer.concat(pedacos).toString('utf-8');
      const dados = JSON.parse(texto); // { dataUrl: "data:application/pdf;base64,...." ou "data:image/...;base64,...." }
      const match = String(dados.dataUrl || '').match(/^data:(application\/pdf|image\/(?:png|jpe?g|webp));base64,(.+)$/i);
      if(!match) throw new Error('formato de anexo não reconhecido (esperado PDF ou imagem em base64)');
      const tipo = match[1].toLowerCase();
      const ext = tipo === 'application/pdf' ? 'pdf' : (tipo.split('/')[1] === 'jpeg' ? 'jpg' : tipo.split('/')[1]);
      const buffer = Buffer.from(match[2], 'base64');
      garantirPastas();
      const nome = `anexo-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
      fs.writeFileSync(path.join(ANEXOS_DIR, nome), buffer);
      log(`Anexo salvo: data/anexos/${nome} (${Math.round(buffer.length/1024)}kb).`);
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:true, caminho: `data/anexos/${nome}`, nomeOriginal: dados.nomeOriginal || null }));
    } catch(err){
      log(`⚠ falha ao salvar anexo: ${err.message}`);
      res.writeHead(400, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:false, erro: err.message }));
    }
  });
}

/* ---------- leitor de .xlsx (Lighthouse Rate Insight) — zip + xml na mao ----------
   .xlsx é um zip com XML dentro. Em vez de trazer uma biblioteca (o
   servidor.js não depende de nenhuma até aqui), lê o zip manualmente:
   varre os cabeçalhos locais (todo .xlsx gerado por Excel/Lighthouse
   os tem completos, sem "data descriptor" de streaming) e descomprime
   com zlib, que já vem no Node. Testado e validado contra o export
   real do Lighthouse antes de entrar aqui. */
function lerZipEntradas(buffer, nomesDesejados){
  const entradas = {};
  const desejados = new Set(nomesDesejados);
  let pos = 0;
  while(pos < buffer.length - 4){
    const sig = buffer.readUInt32LE(pos);
    if(sig !== 0x04034b50) break; // fim das entradas locais
    const method = buffer.readUInt16LE(pos+8);
    const csize = buffer.readUInt32LE(pos+18);
    const nlen = buffer.readUInt16LE(pos+26);
    const elen = buffer.readUInt16LE(pos+28);
    const nome = buffer.toString('utf-8', pos+30, pos+30+nlen);
    const inicioDados = pos + 30 + nlen + elen;
    if(desejados.has(nome)){
      let conteudo;
      if(method === 0) conteudo = buffer.slice(inicioDados, inicioDados + csize);
      else if(method === 8) conteudo = zlib.inflateRawSync(buffer.slice(inicioDados, inicioDados + csize));
      else throw new Error(`.xlsx com compressão não suportada (método ${method})`);
      entradas[nome] = conteudo.toString('utf-8');
    }
    pos = inicioDados + csize;
  }
  return entradas;
}

function decodificarEntidadesXml(s){
  // entidades nomeadas + entidades numéricas (decimal &#231; e hex &#xE7;) —
  // acento em português (ç, ã, õ, é...) às vezes vem assim em vez de UTF-8
  // puro, dependendo da ferramenta que gerou o .xlsx (achado testando com
  // um arquivo sintético gerado pelo openpyxl; o export real da empresa usa
  // UTF-8 direto, mas built-in de qualquer forma — decodificação de
  // entidade numérica é parte padrão do XML, não custa nada ter). &amp;
  // sempre por último, senão desfaz as outras entidades por engano.
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}

function lerSharedStrings(xml){
  if(!xml) return [];
  const blocos = xml.match(/<si>[\s\S]*?<\/si>/g) || [];
  return blocos.map(bloco => {
    const partes = bloco.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    return partes.map(p => decodificarEntidadesXml(p.replace(/<[^>]+>/g,''))).join('');
  });
}

function excelSerialParaIso(serial){
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = dias entre a época do Excel e 1970-01-01
  return new Date(ms).toISOString().slice(0,10);
}

function colunaParaIndice(c){
  let n = 0;
  for(let i=0;i<c.length;i++) n = n*26 + (c.charCodeAt(i) - 64);
  return n - 1;
}

function numeroParaColuna(n){
  let s = '';
  while(n > 0){ const rem = (n-1) % 26; s = String.fromCharCode(65+rem) + s; n = Math.floor((n-1)/26); }
  return s;
}

// versao generica: aceita tag com ou sem prefixo de namespace (<row> ou <x:row>),
// string compartilhada (t="s") OU embutida (t="inlineStr"), com ou sem r="" explicito —
// cobre tanto o export do Lighthouse quanto o do DRE, que usam layouts internos diferentes.
function lerPlanilhaXlsx(xmlSheet, sharedStrings){
  const porLinha = {};
  const blocosRow = xmlSheet.match(/<(?:\w+:)?row\b[^>]*>[\s\S]*?<\/(?:\w+:)?row>|<(?:\w+:)?row\b[^>]*\/>/g) || [];
  blocosRow.forEach((rowXml, rowIdx0) => {
    const rNumMatch = rowXml.match(/ r="(\d+)"/);
    const rNum = rNumMatch ? Number(rNumMatch[1]) : (rowIdx0 + 1);
    const celulas = rowXml.match(/<(?:\w+:)?c\b[^>]*\/>|<(?:\w+:)?c\b[^>]*>[\s\S]*?<\/(?:\w+:)?c>/g) || [];
    const linha = {};
    celulas.forEach((c, colIdx0) => {
      const refMatch = c.match(/ r="([A-Z]+)\d+"/);
      const colLetra = refMatch ? refMatch[1] : numeroParaColuna(colIdx0 + 1);
      const tMatch = c.match(/ t="([^"]+)"/);
      const tipo = tMatch ? tMatch[1] : null;
      let valor = null;
      if(tipo === 'inlineStr'){
        const tTxt = c.match(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/);
        valor = tTxt ? decodificarEntidadesXml(tTxt[1]) : '';
      } else {
        const vMatch = c.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
        if(vMatch){
          if(tipo === 's') valor = sharedStrings[parseInt(vMatch[1])] || '';
          else valor = parseFloat(vMatch[1]);
        }
      }
      if(valor !== null) linha[colLetra] = valor;
    });
    porLinha[rNum] = linha;
  });
  return porLinha;
}

// converte a planilha (linhas por numero, celulas por coluna) pro MESMO formato
// {hoteis, registros} que o resto do painel ja usa (calcPraca no index.html) —
// assim a logica de calculo nao muda nadinha, so a origem do dado.
function parseXlsxPraca(buffer){
  const entradas = lerZipEntradas(buffer, ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']);
  if(!entradas['xl/worksheets/sheet1.xml']) return null;
  const sharedStrings = lerSharedStrings(entradas['xl/sharedStrings.xml']);
  const porLinha = lerPlanilhaXlsx(entradas['xl/worksheets/sheet1.xml'], sharedStrings);

  let headerRowNum = null, colData = null, colCanal = null;
  for(const [rowNum, celulas] of Object.entries(porLinha)){
    let cData = null, cCanal = null;
    for(const [col, val] of Object.entries(celulas)){
      if(val === 'Data') cData = col;
      if(val === 'Canal') cCanal = col;
    }
    if(cData && cCanal){ headerRowNum = Number(rowNum); colData = cData; colCanal = cCanal; break; }
  }
  if(!headerRowNum) return null;

  const headerCelulas = porLinha[headerRowNum];
  const idxCanal = colunaParaIndice(colCanal);
  const hoteisCols = Object.keys(headerCelulas)
    .filter(c => colunaParaIndice(c) > idxCanal)
    .sort((a,b) => colunaParaIndice(a) - colunaParaIndice(b));
  const hoteis = hoteisCols.map(c => headerCelulas[c]);
  if(!hoteis.length) return null;

  const registros = [];
  Object.entries(porLinha).forEach(([rowNumStr, celulas]) => {
    const rowNum = Number(rowNumStr);
    if(rowNum <= headerRowNum) return;
    const dataSerial = celulas[colData];
    const canal = celulas[colCanal];
    if(typeof dataSerial !== 'number' || !canal) return;
    const data = excelSerialParaIso(dataSerial);
    const valores = {};
    hoteisCols.forEach((col, i) => {
      const h = hoteis[i];
      const raw = celulas[col];
      if(raw === undefined || raw === '' || raw === '--') valores[h] = null;
      else if(typeof raw === 'string' && /esgotad/i.test(raw)) valores[h] = 'esgotado';
      else if(typeof raw === 'number') valores[h] = raw;
      else valores[h] = null; // outros textos (ex.: nota do Lighthouse tipo "Apenas tarifas de terceiros")
    });
    registros.push({ data, canal, valores });
  });
  if(!registros.length) return null;
  return { hoteis, registros };
}

function processarPracaInbox(){
  garantirPastas();
  if(!pastaMudou(PRACA_INBOX, 'praca')) return;
  const arquivos = fs.readdirSync(PRACA_INBOX).filter(f => /\.xlsx$/i.test(f));
  if(!arquivos.length){
    log('praca-inbox/ vazia — nada pra processar ainda.');
    return;
  }
  // usa o .xlsx mais recente (por data de modificacao) — o Lighthouse tende a
  // exportar um arquivo novo por dia, nao precisa somar varios como o PMS
  const comData = arquivos.map(f => ({ f, mtime: fs.statSync(path.join(PRACA_INBOX, f)).mtimeMs }));
  comData.sort((a,b) => b.mtime - a.mtime);
  const maisRecente = comData[0].f;
  try{
    const buffer = fs.readFileSync(path.join(PRACA_INBOX, maisRecente));
    const resultado = parseXlsxPraca(buffer);
    if(!resultado){
      log(`⚠ ${maisRecente}: não reconheci a estrutura (esperava colunas "Data"/"Canal").`);
      return;
    }
    const saida = { geradoEm: new Date().toISOString(), arquivo: maisRecente, ...resultado };
    fs.writeFileSync(PRACA_JSON, JSON.stringify(saida));
    log(`data/praca-data.json atualizado — ${resultado.registros.length} registros, ${resultado.hoteis.length} hotéis (${maisRecente}).`);
  } catch(err){
    log(`⚠ erro lendo ${maisRecente}: ${err.message}`);
  }
}

/* ---------- leitor de DRE (.xlsx exportado do dashboard interno da empresa) ----------
   Layout: linha 1 = ano (coluna C), linha 2 = nome do mês (coluna C), linha 3 =
   cabeçalho ("Estrutura" na coluna A), depois uma linha por conta, com a
   categoria (ex. "04 - IMPOSTOS") só preenchida na primeira linha de cada
   grupo. Os 6 agregados que o painel usa (receita/impostos/redução/custos/
   pessoal/despesas) são somados direto das linhas de detalhe de cada
   categoria — inclusive "28 - TOTAL DESPESAS", que testado contra o
   arquivo real bate exato com o Resultado Operacional I já conhecido. */
// detecta os grupos de mes na linha 2 (cada mes ocupa 3 colunas: Real,
// Budget, Var — e o rotulo do mes vem REPETIDO nas 3, não é celula
// mesclada de verdade). Um arquivo pode trazer 1 mes só ou o ano inteiro
// até o mes corrente — descoberto testando contra um export real que
// trouxe janeiro a julho no mesmo arquivo, coisa que a versão anterior
// deste leitor não previa (lia só o primeiro mes, ignorando o resto
// silenciosamente — ver BACKLOG.md).
function detectarGruposDeMes(porLinha){
  const linha2 = porLinha[2] || {};
  const colunas = Object.keys(linha2).sort((a,b) => colunaParaIndice(a) - colunaParaIndice(b));
  const grupos = [];
  let ultimoTexto = null;
  colunas.forEach(col => {
    const valor = linha2[col];
    if(typeof valor !== 'string') return;
    const texto = valor.trim();
    if(!texto || texto === ultimoTexto) return; // repeticao do mesmo rotulo nas 3 colunas do mes — nao e grupo novo
    ultimoTexto = texto;
    if(/^total$/i.test(texto) || /^nome\s*m[eê]s$/i.test(texto)) return; // "Total" e o proprio rotulo "Nome Mês" nao sao mes de calendario
    const colIdx0 = colunaParaIndice(col);
    grupos.push({ mes: texto.toLowerCase(), colReal: col, colBudget: numeroParaColuna(colIdx0 + 2) });
  });
  return grupos;
}

// le UM .xlsx de DRE e devolve um ARRAY de resultados, um por mes
// encontrado no arquivo (pode ser so 1, pode ser o ano inteiro até o
// mes corrente — o arquivo manda).
function parseDreXlsx(buffer){
  const entradas = lerZipEntradas(buffer, ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']);
  if(!entradas['xl/worksheets/sheet1.xml']) return [];
  const sharedStrings = lerSharedStrings(entradas['xl/sharedStrings.xml']);
  const porLinha = lerPlanilhaXlsx(entradas['xl/worksheets/sheet1.xml'], sharedStrings);
  const linhasOrdenadas = Object.keys(porLinha).map(Number).sort((a,b) => a-b);

  const ano = (porLinha[1] && typeof porLinha[1]['C'] === 'number') ? porLinha[1]['C'] : null;
  const grupos = detectarGruposDeMes(porLinha);
  if(!grupos.length) return [];

  let linhaCabecalho = null;
  for(const r of linhasOrdenadas){ if(porLinha[r]['A'] === 'Estrutura'){ linhaCabecalho = r; break; } }
  if(!linhaCabecalho) return [];

  // guarda-chuva contra exports que só trazem Realizado (achado num arquivo
  // real, 2026.08 — as 3 colunas do "mês" vinham TODAS rotuladas "Valor
  // Realizado" no cabeçalho, sem nenhuma coluna de orçado de verdade; a
  // posição colStart+2 apontava pra mais um Realizado, e o painel teria
  // mostrado orçado = realizado, silenciosamente errado). Confere se a
  // coluna candidata a orçado realmente tem cara de orçado pelo texto do
  // próprio cabeçalho antes de confiar nela — se não bater, null (o painel
  // já ignora orçado do DRE diário mesmo, então null aqui não muda nada
  // além de parar de mentir no dado bruto).
  const linhaCabecalhoCelulas = porLinha[linhaCabecalho] || {};
  grupos.forEach(g => {
    const rotulo = linhaCabecalhoCelulas[g.colBudget];
    const pareceOrcado = typeof rotulo === 'string' && /or[cç]a|budget/i.test(rotulo);
    if(!pareceOrcado) g.colBudget = null;
  });

  const gruposPorNome = {};
  let categoriaAtual = null;
  for(const r of linhasOrdenadas){
    if(r <= linhaCabecalho) continue;
    const a = porLinha[r]['A'];
    if(typeof a === 'string' && a.trim() !== ''){ categoriaAtual = a.trim(); gruposPorNome[categoriaAtual] = gruposPorNome[categoriaAtual] || []; }
    if(categoriaAtual) gruposPorNome[categoriaAtual].push(r);
  }

  function somaCategoria(nome, coluna){
    const linhas = gruposPorNome[nome];
    if(!linhas) return null;
    let soma = 0, achou = false;
    linhas.forEach(r => { const v = porLinha[r][coluna]; if(typeof v === 'number'){ soma += v; achou = true; } });
    return achou ? soma : null;
  }

  return grupos.map(g => {
    const linhasDetalhe = [];
    linhasOrdenadas.forEach(r => {
      if(r <= linhaCabecalho) return;
      const b = porLinha[r]['B'];
      if(typeof b === 'string'){
        const m = b.match(/^(\d{2}\.\d{2})\s*-\s*(.+)$/);
        if(m){
          const real = typeof porLinha[r][g.colReal] === 'number' ? porLinha[r][g.colReal] : null;
          const orcado = typeof porLinha[r][g.colBudget] === 'number' ? porLinha[r][g.colBudget] : null;
          linhasDetalhe.push({ codigo: m[1], descricao: m[2].trim(), real, orcado });
        }
      }
    });
    return {
      mes: g.mes, ano,
      receita:  { real: somaCategoria('03 - RECEITA BRUTA', g.colReal),            orcado: somaCategoria('03 - RECEITA BRUTA', g.colBudget) },
      impostos: { real: somaCategoria('04 - IMPOSTOS', g.colReal),                 orcado: somaCategoria('04 - IMPOSTOS', g.colBudget) },
      reducao:  { real: somaCategoria('05 - REDUÇÃO DE VENDAS', g.colReal),        orcado: somaCategoria('05 - REDUÇÃO DE VENDAS', g.colBudget) },
      custos:   { real: somaCategoria('08 - TOTAL CUSTOS', g.colReal),             orcado: somaCategoria('08 - TOTAL CUSTOS', g.colBudget) },
      pessoal:  { real: somaCategoria('09 - TOTAL GASTOS COM PESSOAL', g.colReal), orcado: somaCategoria('09 - TOTAL GASTOS COM PESSOAL', g.colBudget) },
      despesas: { real: somaCategoria('28 - TOTAL DESPESAS', g.colReal),           orcado: somaCategoria('28 - TOTAL DESPESAS', g.colBudget) },
      linhas: linhasDetalhe,
    };
  });
}

/* ---------- leitor do DRE anual (All Strategy) ----------
   Plataforma diferente do DRE diário — formato de arquivo diferente por
   dentro (shared strings + referência explícita, como o Lighthouse) e
   estrutura de linha diferente: mês na linha 1 (Jan/26, Fev/26...), 5
   colunas por mês (Realizado AA, V AA x R, Planejado, V P x R, Realizado),
   dado a partir da linha 3. Os CÓDIGOS de categoria são diferentes do
   outro DRE (aqui não existe categoria separada pra "Remuneração da
   Marca", então Custos é 07 em vez de 08) — por isso a categoria é
   casada pelo NOME (sem o código na frente), não pelo código, pra não
   quebrar se a numeração mudar de novo. Aqui a linha de cabeçalho da
   categoria (não indentada) já É o total — diferente do outro DRE, não
   soma os filhos (validado contra o "Resultado Operacional I" explícito
   em todos os 12 meses).
   Além de real/orçado, essa planilha também traz o REALIZADO DO ANO
   ANTERIOR — dado que não tínhamos antes, usado pra comparação ano a ano. */
function detectarMesesAllStrategy(porLinha){
  const linha1 = porLinha[1] || {};
  const colunas = Object.keys(linha1).filter(c => c !== 'A').sort((a,b) => colunaParaIndice(a) - colunaParaIndice(b));
  const grupos = [];
  colunas.forEach(col => {
    const valor = linha1[col];
    if(typeof valor !== 'string') return;
    const texto = valor.trim();
    if(!texto || /^total$/i.test(texto)) return;
    const colIdx0 = colunaParaIndice(col);
    grupos.push({
      rotulo: texto,
      colAnoAnterior: col,
      colPlanejado: numeroParaColuna(colIdx0 + 3),
      colRealizado: numeroParaColuna(colIdx0 + 5),
    });
  });
  return grupos;
}

function normalizarNomeCategoria(texto){
  const m = texto.trim().match(/^\d+(\.\d+)?\s*-\s*(.+)$/);
  return (m ? m[2] : texto).trim().toUpperCase();
}

const MESES_ABREV_MAP = { jan:'janeiro', fev:'fevereiro', mar:'março', abr:'abril', mai:'maio', jun:'junho',
  jul:'julho', ago:'agosto', set:'setembro', out:'outubro', nov:'novembro', dez:'dezembro' };

function parseAllStrategyDre(buffer){
  const entradas = lerZipEntradas(buffer, ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']);
  if(!entradas['xl/worksheets/sheet1.xml']) return [];
  const sharedStrings = lerSharedStrings(entradas['xl/sharedStrings.xml']);
  const porLinha = lerPlanilhaXlsx(entradas['xl/worksheets/sheet1.xml'], sharedStrings);
  const linhasOrdenadas = Object.keys(porLinha).map(Number).sort((a,b) => a-b);

  const grupos = detectarMesesAllStrategy(porLinha);
  if(!grupos.length) return [];

  const porNome = {};
  linhasOrdenadas.forEach(r => {
    const a = porLinha[r]['A'];
    if(typeof a === 'string' && !a.startsWith(' ') && a.trim() !== ''){
      porNome[normalizarNomeCategoria(a)] = r;
    }
  });
  // arquivo do outro DRE não tem essas 6 categorias com esses nomes exatos
  // OU o cabeçalho "Estrutura" que ele exige — mas pra garantir que não é
  // esse formato, confere se achou o essencial antes de seguir
  if(!porNome['RECEITA BRUTA'] || !porNome['TOTAL CUSTOS']) return [];

  function val(nome, col){
    const r = porNome[nome];
    if(r === undefined) return null;
    const v = porLinha[r][col];
    return typeof v === 'number' ? v : null;
  }

  return grupos.map(g => {
    const abrev = g.rotulo.slice(0,3).toLowerCase();
    const mes = MESES_ABREV_MAP[abrev] || g.rotulo.toLowerCase();
    const cat = nome => ({ real: val(nome, g.colRealizado), orcado: val(nome, g.colPlanejado), anoAnterior: val(nome, g.colAnoAnterior) });
    return {
      mes,
      receita: cat('RECEITA BRUTA'),
      impostos: cat('IMPOSTOS'),
      reducao: cat('REDUCAO DAS VENDAS'),
      custos: cat('TOTAL CUSTOS'),
      pessoal: cat('TOTAL GASTOS COM PESSOAL'),
      despesas: cat('TOTAL DESPESAS'),
    };
  });
}

function processarDreInbox(){
  garantirPastas();
  if(!pastaMudou(DRE_INBOX, 'dre')) return;
  const arquivos = fs.readdirSync(DRE_INBOX).filter(f => /\.xlsx$/i.test(f));
  if(!arquivos.length){
    log('dre-inbox/ vazia — nada pra processar ainda.');
    return;
  }
  // processa todos, nao so o mais recente — cada arquivo pode trazer 1 ou
  // vários meses; se dois arquivos trouxerem o MESMO mes, o modificado
  // por ultimo (mtime mais novo) vence, exatamente como uma atualizacao.
  const comData = arquivos.map(f => ({ f, mtime: fs.statSync(path.join(DRE_INBOX, f)).mtimeMs }));
  comData.sort((a,b) => a.mtime - b.mtime);

  const meses = {};
  let processados = 0;
  let totalMeses = 0;
  comData.forEach(({ f }) => {
    try{
      const buffer = fs.readFileSync(path.join(DRE_INBOX, f));
      const resultados = parseDreXlsx(buffer);
      if(!resultados.length){ log(`⚠ ${f}: não reconheci a estrutura do DRE (esperava "Estrutura" na coluna A e pelo menos um mês na linha 2).`); return; }
      resultados.forEach(resultado => {
        meses[resultado.mes] = { arquivo: f, ...resultado };
        totalMeses++;
      });
      processados++;
    } catch(err){
      log(`⚠ erro lendo ${f}: ${err.message}`);
    }
  });
  if(!processados) return;
  const saida = { geradoEm: new Date().toISOString(), meses };
  fs.writeFileSync(DRE_JSON, JSON.stringify(saida));
  log(`data/dre-data.json atualizado — ${processados} arquivo(s) processado(s), ${Object.keys(meses).length} mês(es) no total.`);
}

function processarAllStrategyInbox(){
  garantirPastas();
  if(!pastaMudou(ALLSTRATEGY_INBOX, 'allstrategy')) return;
  const arquivos = fs.readdirSync(ALLSTRATEGY_INBOX).filter(f => /\.xlsx$/i.test(f));
  if(!arquivos.length){
    log('allstrategy-inbox/ vazia — nada pra processar ainda.');
    return;
  }
  const comData = arquivos.map(f => ({ f, mtime: fs.statSync(path.join(ALLSTRATEGY_INBOX, f)).mtimeMs }));
  comData.sort((a,b) => a.mtime - b.mtime);

  const meses = {};
  let processados = 0;
  comData.forEach(({ f }) => {
    try{
      const buffer = fs.readFileSync(path.join(ALLSTRATEGY_INBOX, f));
      const resultados = parseAllStrategyDre(buffer);
      if(!resultados.length){ log(`⚠ ${f}: não reconheci a estrutura do DRE All Strategy (esperava meses na linha 1 e categorias como "RECEITA BRUTA"/"TOTAL CUSTOS" na coluna A).`); return; }
      resultados.forEach(resultado => { meses[resultado.mes] = { arquivo: f, ...resultado }; });
      processados++;
    } catch(err){
      log(`⚠ erro lendo ${f}: ${err.message}`);
    }
  });
  if(!processados) return;
  const saida = { geradoEm: new Date().toISOString(), meses };
  fs.writeFileSync(ALLSTRATEGY_JSON, JSON.stringify(saida));
  log(`data/allstrategy-data.json atualizado — ${processados} arquivo(s) processado(s), ${Object.keys(meses).length} mês(es) no total (inclui orçado do ano inteiro e comparativo com ano anterior).`);
}

/* ---------- pace: reconstroi a serie historica do livro pra um mes-alvo ---------- */
function calcularPace(mesNum, ano){
  garantirPastas();
  if(!fs.existsSync(HISTORICO_DIR)) return [];
  const arquivos = fs.readdirSync(HISTORICO_DIR).filter(f => /^otb-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const serie = [];
  arquivos.forEach(f => {
    const dataSnapshot = f.replace('otb-', '').replace('.json', '');
    try{
      const conteudo = JSON.parse(fs.readFileSync(path.join(HISTORICO_DIR, f), 'utf-8'));
      let receitaQuarto = 0, diasReais = 0, diasForecast = 0;
      (conteudo.registros || []).forEach(r => {
        const m = String(r.dateStr || '').match(/^(\d{2})-([A-Z]{3})-(\d{2})$/i);
        if(!m) return;
        const meses3 = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        const mIdx = meses3.indexOf(m[2].toUpperCase());
        const anoReg = 2000 + Number(m[3]);
        if(mIdx === mesNum - 1 && anoReg === ano){
          receitaQuarto += r.revenue || 0;
          if(r.recType === 'A_STAT') diasReais++;
          else if(r.recType === 'B_FORE') diasForecast++;
        }
      });
      serie.push({ data: dataSnapshot, receitaQuarto: Math.round(receitaQuarto * 100) / 100, diasReais, diasForecast });
    } catch(err){ /* snapshot corrompido ou ilegivel - ignora esse dia, segue com o resto */ }
  });
  return serie;
}

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.pdf':'application/pdf' };

/* ---------- autenticação (só ativa se SENHA_PAINEL estiver definida — ver comentário no topo do arquivo) ----------
   HTTP Basic Auth pura, sem lib externa: o navegador mostra um prompt nativo
   de usuário/senha, manda de volta em todo request (header Authorization),
   e some com o F5/fechar aba (não precisa de "logout" nem cookie de sessão
   pra cuidar). Comparação por hash (sha256 + timingSafeEqual) em vez de
   comparar a senha direto — evita tanto vazar timing quanto o
   timingSafeEqual reclamar de buffers de tamanho diferente. */
const SENHA_PAINEL = process.env.SENHA_PAINEL || null;
function senhaConfere(fornecida){
  const hashFornecida = crypto.createHash('sha256').update(fornecida).digest();
  const hashEsperada = crypto.createHash('sha256').update(SENHA_PAINEL).digest();
  return crypto.timingSafeEqual(hashFornecida, hashEsperada);
}
function autenticarRequisicao(req, res){
  if(!SENHA_PAINEL) return true; // sem senha configurada — comportamento de sempre, sem trava
  const cabecalho = req.headers['authorization'] || '';
  const partes = cabecalho.match(/^Basic\s+(.+)$/);
  if(partes){
    const decodificado = Buffer.from(partes[1], 'base64').toString('utf-8');
    const idx = decodificado.indexOf(':');
    const senhaFornecida = idx === -1 ? decodificado : decodificado.slice(idx + 1);
    if(senhaFornecida && senhaConfere(senhaFornecida)) return true;
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Painel Ibis Chapecó"', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Senha necessária.');
  return false;
}

/* =====================================================================
   ATUALIZAÇÃO AUTOMÁTICA — ver doc completa no topo do arquivo e o
   passo a passo de configuração em ESTADO_DO_PROJETO.md.
   Zero dependência externa: só https/fs/child_process, que já vêm com
   o Node. Nunca toca em data/ — só em servidor.js e painel-rbo.html.
   ===================================================================== */

// GET simples via http/https (escolhe pelo protocolo da própria URL — na
// prática sempre https, GitHub raw; aceitar http também só facilita testar
// contra um servidor local), com corpo de resposta inteiro em memória (os 2
// arquivos do programa são só algumas centenas de KB, sem problema) e
// alguns redirecionamentos seguidos (GitHub raw normalmente não redireciona,
// mas outros hosts estáticos podem) — sem lib externa, só módulos nativos.
function baixarTexto(url, redirecionamentosRestantes = 3){
  return new Promise((resolve, reject) => {
    const cliente = url.startsWith('http://') ? http : https;
    cliente.get(url, { headers: { 'User-Agent': 'painel-ibis-chapeco-auto-update' } }, resp => {
      if([301,302,303,307,308].includes(resp.statusCode) && resp.headers.location && redirecionamentosRestantes > 0){
        resp.resume();
        baixarTexto(resp.headers.location, redirecionamentosRestantes - 1).then(resolve, reject);
        return;
      }
      if(resp.statusCode !== 200){
        resp.resume();
        reject(new Error(`HTTP ${resp.statusCode} ao buscar ${url}`));
        return;
      }
      let corpo = '';
      resp.setEncoding('utf-8');
      resp.on('data', chunk => { corpo += chunk; });
      resp.on('end', () => resolve(corpo));
    }).on('error', reject);
  });
}

function fazerBackupArquivoApp(nomeArquivo){
  const caminho = path.join(ROOT, nomeArquivo);
  if(!fs.existsSync(caminho)) return;
  garantirPastas();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(caminho, path.join(APP_BACKUPS_DIR, `${nomeArquivo}.${timestamp}.bak`));
  // rotação — mantém só as MAX_BACKUPS_APP mais recentes DESSE arquivo específico
  const prefixo = `${nomeArquivo}.`;
  const arquivos = fs.readdirSync(APP_BACKUPS_DIR).filter(n => n.startsWith(prefixo) && n.endsWith('.bak')).sort();
  if(arquivos.length > MAX_BACKUPS_APP){
    arquivos.slice(0, arquivos.length - MAX_BACKUPS_APP).forEach(n => {
      try{ fs.unlinkSync(path.join(APP_BACKUPS_DIR, n)); } catch(err){ /* ignora */ }
    });
  }
}

function reiniciarProcesso(){
  log('Reiniciando com a versão nova...');
  const filho = spawn(process.argv[0], process.argv.slice(1), {
    detached: true, stdio: 'inherit', cwd: ROOT, env: process.env,
  });
  filho.unref();
  process.exit(0);
}

// baixa TODOS os arquivos listados no manifesto pra memória e só DEPOIS
// escreve tudo no disco (com backup antes de cada um) — assim, se o
// download de um arquivo falhar no meio, nada no disco foi alterado
// (evita ficar com painel-rbo.html novo e servidor.js velho, ou vice-versa,
// uma mistura que pode nem funcionar).
async function aplicarAtualizacao(manifesto){
  const nomesPermitidos = ['servidor.js', 'painel-rbo.html'];
  const entradas = Object.entries(manifesto.arquivos || {}).filter(([nome]) => nomesPermitidos.includes(nome));
  if(!entradas.length){
    log('⚠ manifesto de atualização não tem nenhum arquivo reconhecido (esperado: servidor.js e/ou painel-rbo.html) — ignorando.');
    return false;
  }
  const baixados = [];
  for(const [nome, url] of entradas){
    const conteudo = await baixarTexto(url); // deixa o erro subir — se um falhar, aplicarAtualizacao inteiro é abortado sem mexer em nada
    if(!conteudo || conteudo.length < 100) throw new Error(`${nome} baixado veio vazio/curto demais (${conteudo ? conteudo.length : 0} bytes) — arquivo suspeito, abortando por segurança`);
    baixados.push({ nome, conteudo });
  }
  baixados.forEach(({ nome, conteudo }) => {
    fazerBackupArquivoApp(nome);
    fs.writeFileSync(path.join(ROOT, nome), conteudo, 'utf-8');
    log(`  → ${nome} atualizado (backup do anterior em data/backups-app/).`);
  });
  return true;
}

async function verificarEAplicarAtualizacao(){
  if(REPOSITORIO_ATUALIZACAO.includes('SEU-USUARIO')){
    return false; // ainda não configurado — não tenta nada, não loga nada (silêncio = comportamento de sempre)
  }
  try{
    const manifestoTexto = await baixarTexto(REPOSITORIO_ATUALIZACAO);
    const manifesto = JSON.parse(manifestoTexto);
    if(!manifesto.versao || typeof manifesto.versao !== 'string'){
      log('⚠ versao.json do repositório de atualização não tem um campo "versao" válido — ignorando.');
      return false;
    }
    if(manifesto.versao <= VERSAO_ATUAL){
      return false; // já está na versão mais nova (ou o manifesto está desatualizado) — nada a fazer
    }
    log(`⬆ Nova versão disponível: ${manifesto.versao} (atual: ${VERSAO_ATUAL})${manifesto.notas ? ' — ' + manifesto.notas : ''}`);
    const aplicou = await aplicarAtualizacao(manifesto);
    if(aplicou){
      log(`✓ Atualizado de ${VERSAO_ATUAL} para ${manifesto.versao}.`);
      reiniciarProcesso();
      return true; // nunca chega a retornar de verdade — reiniciarProcesso() encerra o processo antes
    }
    return false;
  } catch(err){
    // sem internet, repositório fora do ar, ou manifesto malformado — a
    // regra do projeto vale aqui também: nunca quebra o uso normal por
    // causa de uma checagem que é, por definição, opcional.
    log(`⚠ checagem de atualização falhou (${err.message}) — seguindo com a versão atual.`);
    return false;
  }
}

const server = http.createServer((req, res) => {
  if(!autenticarRequisicao(req, res)) return; // corta aqui — nenhuma rota abaixo roda sem senha certa (quando configurada)
  if(req.method === 'POST' && req.url === '/api/estado'){ salvarEstado(req, res); return; }
  if(req.method === 'POST' && req.url === '/api/foto'){ salvarFoto(req, res); return; }
  if(req.method === 'POST' && req.url === '/api/anexo'){ salvarAnexo(req, res); return; }

  if(req.method === 'GET' && req.url.startsWith('/api/pace')){
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const mesNum = Number(params.get('mes'));
    const ano = Number(params.get('ano')) || new Date().getFullYear();
    if(!mesNum || mesNum < 1 || mesNum > 12){
      res.writeHead(400, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:false, erro:'parâmetro "mes" (1-12) obrigatório' }));
      return;
    }
    const serie = calcularPace(mesNum, ano);
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-cache' });
    res.end(JSON.stringify({ ok:true, mes: mesNum, ano, serie }));
    return;
  }

  if(req.method !== 'GET'){ res.writeHead(405); res.end('Método não permitido'); return; }
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if(urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if(!filePath.startsWith(ROOT)){ res.writeHead(403); res.end('Proibido'); return; }
  fs.readFile(filePath, (err, data) => {
    if(err){ res.writeHead(404); res.end('Não encontrado'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control':'no-cache' });
    res.end(data);
  });
});

/* ---------- start ---------- */
function debounce(fn, ms){
  let timer = null;
  return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
}
const processarPmsDebounced = debounce(processarPmsInbox, 600);
const processarNotasDebounced = debounce(processarNotasInbox, 600);
const processarPracaDebounced = debounce(processarPracaInbox, 600);
const processarDreDebounced = debounce(processarDreInbox, 600);
const processarAllStrategyDebounced = debounce(processarAllStrategyInbox, 600);
const processarUnificadoDebounced = debounce(processarInboxUnificado, 600);

function listarEnderecosDaRede(){
  const interfaces = os.networkInterfaces();
  const enderecos = [];
  Object.values(interfaces).forEach(lista => {
    (lista || []).forEach(info => {
      if(info.family === 'IPv4' && !info.internal) enderecos.push(info.address);
    });
  });
  return enderecos;
}

const SEIS_HORAS_MS = 6 * 60 * 60 * 1000;

// tudo isso precisava virar uma função async pra poder "esperar" a checagem
// de atualização terminar ANTES de abrir o servidor — se aplicar uma
// atualização, o processo reinicia sozinho (reiniciarProcesso corta aqui
// com process.exit) e o resto (processarTudo, fs.watch, server.listen) nem
// chega a rodar nessa execução; quem assume é o processo novo, já com o
// código atualizado.
(async function iniciar(){
  await verificarEAplicarAtualizacao();

  garantirPastas();
  processarTudo();

  fs.watch(PMS_INBOX, { persistent: true }, processarPmsDebounced);
  fs.watch(NOTAS_INBOX, { persistent: true }, processarNotasDebounced);
  fs.watch(PRACA_INBOX, { persistent: true }, processarPracaDebounced);
  fs.watch(DRE_INBOX, { persistent: true }, processarDreDebounced);
  fs.watch(ALLSTRATEGY_INBOX, { persistent: true }, processarAllStrategyDebounced);
  fs.watch(INBOX_UNIFICADO, { persistent: true }, processarUnificadoDebounced);
  setInterval(processarTudo, RESCAN_INTERVAL_MS);
  // confere de novo periodicamente — cobre quem deixa o servidor ligado por
  // dias sem reiniciar manualmente (ver ESTADO_DO_PROJETO.md, "Deixar
  // ligado sozinho"). Cada checagem é bem barata (1 requisição pequena).
  setInterval(verificarEAplicarAtualizacao, SEIS_HORAS_MS);

  server.listen(PORT, '0.0.0.0', () => {
    log(`Servidor no ar: http://localhost:${PORT}`);
    const enderecos = listarEnderecosDaRede();
    if(enderecos.length){
      log('Também acessível de outros aparelhos na mesma rede (ou via Tailscale) em:');
      enderecos.forEach(ip => log(`  → http://${ip}:${PORT}`));
    }
    log(SENHA_PAINEL ? '🔒 Protegido por senha (SENHA_PAINEL definida) — todo acesso vai pedir usuário/senha.' : '⚠ Sem senha configurada (SENHA_PAINEL não definida) — qualquer um com o endereço acessa. Ok pra uso 100% local; defina SENHA_PAINEL se isso ficar acessível pela internet.');
    log(REPOSITORIO_ATUALIZACAO.includes('SEU-USUARIO')
      ? 'ℹ Atualização automática não configurada ainda (ver ESTADO_DO_PROJETO.md, "Atualização automática") — versão atual: ' + VERSAO_ATUAL + '.'
      : `✓ Atualização automática ativa (versão atual: ${VERSAO_ATUAL}) — confere sozinho a cada 6h.`);
    log(`Deixe este terminal aberto. Mais simples: solte qualquer arquivo (PMS, nota fiscal, Lighthouse ou DRE) direto em inbox/ — o servidor identifica sozinho e distribui pras pastas certas.`);
  });
})();

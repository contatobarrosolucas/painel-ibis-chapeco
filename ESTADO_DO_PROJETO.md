# Painel Margem RBO — Ibis Chapecó — Estado completo do projeto

> Documento único, feito pra qualquer conversa nova (com o Claude ou não) entender o projeto inteiro sem precisar do histórico de chat. Junta o que antes estava em LEIA-ME.md + BACKLOG.md.

## O que é

Ferramenta de gestão financeira e de operação para o Ibis Chapecó (rede Atrio Hotéis): acompanha Margem RBO, faz a ponte de resultado (efeito volume x custo), simula quanto cada linha de custo "deveria" gastar dado o tanto que está vendendo, compara tarifa com o mercado, acompanha ritmo de reserva, junta tudo isso em recomendações automáticas, documenta os projetos de melhoria feitos na unidade (com notas fiscais e fotos de antes/depois) pra apresentação à diretoria, e agora também controla a operação do dia a dia da recepção (tarefas, follow-up de WhatsApp/e-mail, equipe, reservas organizadas à parte do PMS, apontamento de erro com ranking pra tratativa interna, e checklist de back office). Nasceu de uma análise pontual em planilha e virou um painel que lê sozinho os arquivos que a operação já gera todo dia.

## Arquitetura — 2 arquivos fazem o painel funcionar (+ 3 arquivos só pra hospedar na nuvem)

- **`painel-rbo.html`** — o painel inteiro: visual, dados e lógica num arquivo só (CSS embutido). Abre com duplo-clique, mas **sem o servidor rodando não salva nada, não sincroniza nada sozinho e não guarda fotos de projetos**.
- **`servidor.js`** — script Node.js separado (não dá pra embutir num HTML, é outro programa) que: serve o painel, observa pastas de entrada, processa os arquivos que chegam, guarda o que foi editado no painel, e guarda as fotos de antes/depois dos projetos de melhoria.
- **`package.json` / `Dockerfile` / `.dockerignore`** *(novos, 2026.08.14)* — só existem pra viabilizar hospedar `servidor.js` na nuvem (ver seção dedicada abaixo); pra uso 100% local, como sempre foi, esses 3 arquivos não importam e podem ser ignorados.
- **`versao.json`** *(novo, 2026.08.14)* — template pro repositório público que alimenta a atualização automática (ver seção dedicada abaixo); não faz parte do que o `servidor.js` local lê diretamente, é o arquivo que você sobe pro GitHub.

**Confusão comum, já esclarecida**: "servidor" aqui não significa obrigatoriamente internet nem nuvem — por padrão é um programa que roda 100% na própria máquina, sem precisar de rede nenhuma ("site local sem internet"). O que precisa, no uso local: `node servidor.js` rodando (num terminal aberto) e acessar por `http://localhost:8420` — **nunca abrindo o `.html` direto por duplo-clique**, porque aí não tem ninguém do outro lado pra receber o que precisa ser salvo. **Desde 2026.08.14** esse mesmo `servidor.js` também pode ser hospedado na nuvem (ver seção "Hospedagem na nuvem" abaixo) pra acesso de qualquer lugar, com senha — as duas formas de rodar coexistem, é uma escolha de onde o mesmo programa roda, não dois projetos diferentes.

### Instalação (uma vez)
1. Os 2 arquivos na mesma pasta.
2. [Node.js](https://nodejs.org) instalado (qualquer versão recente) — sem dependência externa, sem `npm install`.

### Uso diário
1. Terminal na pasta → `node servidor.js`. Cria sozinho `inbox/`, `pms-inbox/`, `notas-inbox/`, `praca-inbox/`, `dre-inbox/`, `allstrategy-inbox/`, `data/`, `data/fotos/`.
2. Deixe o terminal aberto. Solte qualquer arquivo em **`inbox/`** (pasta única — identifica o tipo pelo conteúdo, não precisa saber qual pasta específica usar). Verificação a cada poucos segundos (não depende do aviso automático do sistema operacional, que é conhecidamente pouco confiável no Node).
3. Acesse **http://localhost:8420** no navegador. A página busca o mais novo ao abrir, e continua conferindo sozinha a cada 20s (não precisa F5).

### Deixar ligado sozinho (sem abrir terminal todo dia)
Instruções completas de Windows e Mac como comentário no topo do `servidor.js`. Resumo: Windows = atalho na pasta de Inicialização (`shell:startup`); Mac = app do Automator em Itens de Login.

### Acesso remoto (celular, fora da unidade) — Tailscale
Servidor já aceita conexão de qualquer aparelho. Tailscale conecta o celular ao computador numa rede privada, de graça, sem expor nada publicamente: instala nos dois com a mesma conta, roda `node servidor.js`, usa o endereço que começa com `100.` que aparece no log. O computador precisa continuar ligado — Tailscale só conecta, não substitui o servidor rodando em algum lugar.

**Isso ainda funciona e continua documentado aqui** — é a opção mais simples se o painel só precisar ser acessado por quem está na rede do hotel (ou com Tailscale instalado). Pra acesso de qualquer lugar, sempre, sem depender de nenhum computador específico estar ligado, ver a seção "Hospedagem na nuvem" abaixo — é uma segunda forma de rodar o mesmo projeto, não substitui essa.

---

## Hospedagem na nuvem — acesso de qualquer lugar (novo, 2026.08.14)

Pedido do usuário: Lucas e a supervisora de operação precisam acessar e editar o painel ao mesmo tempo, de computadores diferentes, de qualquer lugar (não só de dentro do hotel) — e sem nunca perder informação. Isso é uma mudança de arquitetura real: até aqui o painel era pensado pra rodar 100% local (num computador do hotel, ou acessível via Tailscale); pra "acesso de qualquer lugar, sempre" sem depender de um computador específico ficar ligado, a opção é hospedar `servidor.js` num provedor de nuvem — o painel (`painel-rbo.html`) continua exatamente o mesmo, só passa a ser servido de outro lugar.

**O que mudou no código pra viabilizar isso** (tudo retrocompatível — quem continuar usando local, sem nenhuma dessas variáveis de ambiente definidas, não percebe diferença nenhuma):
- **Porta configurável**: `servidor.js` agora lê `process.env.PORT` (com `8420` como padrão) — provedores de nuvem definem a porta certa sozinhos via variável de ambiente, o código só precisa respeitar isso.
- **Senha de acesso** (`SENHA_PAINEL`): com o painel alcançável pela internet, "só quem sabe o link acessa" deixa de ser proteção suficiente (antes fazia sentido, era 100% local). Autenticação HTTP Basic nativa do navegador — sem `SENHA_PAINEL` definida, continua sem senha (comportamento de sempre); com ela definida, todo acesso (painel, APIs, arquivos) pede usuário/senha. Comparação por hash (`sha256` + `timingSafeEqual`), não por comparação direta de string, pra não vazar timing.
- **Backup automático versionado**: a cada salvamento, a versão anterior de `data/estado.json` é copiada pra `data/backups/` antes de ser sobrescrita (rotação mantendo as 500 mais recentes) — protege contra perda de dado por clique errado, corrupção ou qualquer acidente, hospedado na nuvem ou local.
- **Proteção contra sobrescrita concorrente**: cada save carrega uma versão (`versao`, número que só sobe). O navegador lembra a versão que carregou por último e manda junto (`versaoBase`) em todo save; se o servidor já tiver uma versão mais nova (porque outro dispositivo salvou primeiro), o save é recusado (HTTP 409) em vez de sobrescrever silenciosamente — o painel mostra um banner vermelho no topo avisando "outro dispositivo salvou uma alteração" com um botão "Recarregar agora". Isso existe porque cada save manda o estado INTEIRO (não só o campo que mudou) — sem essa trava, o último a salvar sempre apagaria silenciosamente o que o outro tivesse acabado de mudar.
  - **Limitação conhecida**: não é edição colaborativa em tempo real (tipo Google Docs) — é "avisa se colidir", não "funde as duas edições". Se os dois editarem exatamente ao mesmo tempo, um dos dois recebe o aviso pra recarregar e reaplicar o que tinha mudado. Suficiente pro uso real (duas pessoas, edições esparsas ao longo do dia), mas vale saber que não é sincronização instantânea entre abas abertas.

**Arquivos novos, só usados na hospedagem em nuvem** (não mudam nada do uso local):
- `package.json` — metadado mínimo (nome, versão, `"start": "node servidor.js"`), **sem nenhuma dependência** (`"dependencies": {}`) — mantém a regra do projeto de zero biblioteca externa. Existe porque a maioria dos provedores de nuvem precisa desse arquivo pra reconhecer "isso é um app Node.js".
- `Dockerfile` — imagem única baseada em `node:20-alpine`, copia os arquivos, declara `data/` como volume e expõe a porta. Não usa `npm install` (não tem o que instalar). Funciona em qualquer host que rode container Docker, não só no provedor recomendado abaixo.
- `.dockerignore` — evita empacotar `data/` (tem que vir de um volume de verdade, não da imagem), as pastas de inbox (recriadas sozinhas) e os arquivos de amostra usados só em desenvolvimento.

**Provedor recomendado: Railway** — escolhido por ter volume persistente (essencial — sem isso, os dados resetam a cada deploy novo), HTTPS automático (necessário pra Basic Auth não trafegar a senha em texto puro), deploy sem escrever infra (`railway up` a partir da pasta do projeto), e custo baixo pra um app pequeno sempre ligado (faixa de US$5/mês, cobrado por uso).

**Passo a passo do deploy**:
1. Criar conta em [railway.app](https://railway.app) (dá pra entrar com GitHub).
2. Instalar a CLI uma vez: `npm install -g @railway/cli`.
3. Na pasta do projeto: `railway login`, depois `railway init` (cria um projeto novo no Railway).
4. `railway up` — builda a partir do `Dockerfile` incluído e sobe.
5. No painel web do Railway → serviço criado → aba **Variables** → adicionar `SENHA_PAINEL` com a senha desejada (a mesma pra Lucas e a supervisora usarem).
6. Aba **Settings → Volumes** → criar um volume montado em `/app/data` — **esse passo é o que garante que os dados nunca se percam entre deploys**; sem ele, cada deploy novo apaga `data/` e volta pro zero.
7. Aba **Settings → Networking → Generate Domain** — gera uma URL pública HTTPS tipo `algumnome.up.railway.app` (dá pra trocar por domínio próprio depois, se quiser).
8. Acessar essa URL — vai pedir usuário/senha (usuário pode ser qualquer texto, só a senha importa) — pronto, acessível de qualquer lugar, pelos dois ao mesmo tempo.

**Pra mandar uma atualização depois** (nova versão do `painel-rbo.html`/`servidor.js`): repetir `railway up` na pasta atualizada. O volume `/app/data` não é afetado por um redeploy — os dados continuam intactos.

**Alternativas ao Railway**: o `Dockerfile` incluído funciona em qualquer host que rode Docker — Render, Fly.io, ou uma VPS qualquer (DigitalOcean, Hetzner) com Docker instalado. Em qualquer um deles, só duas coisas são obrigatórias: (1) um volume/disco persistente montado em `/app/data`, (2) a variável de ambiente `SENHA_PAINEL` configurada. Sem essas duas, ou os dados se perdem a cada deploy, ou o painel fica exposto sem senha.

### Versionamento de arquivo
Rodapé do painel mostra "versão AAAA.MM.DD". Se houver mais de uma cópia salva (`painel-rbo (1).html` etc.), usar a de data mais recente e apagar as outras.

---

## Atualização automática — o programa se atualiza sozinho (novo, 2026.08.14)

Pedido do usuário: "toda atualização no projeto que eu fizer, como vamos criar um programa executável que se auto atualiza? para podermos estar sempre atualizando os erros, programas, projetos e etc". Confirmado via pergunta direta: o painel **continua rodando local** (não foi pra nuvem ainda — isso é independente da seção "Hospedagem na nuvem" acima, que é uma opção separada, não um pré-requisito) e o formato escolhido foi **programa local que confere e aplica atualização sozinho** (não um instalador/.exe com ícone próprio — essa terceira opção foi apresentada e não escolhida, por ser bem mais trabalho de construir/manter e sair do "zero dependência" que o projeto segue desde o início).

**Como funciona**: toda vez que `servidor.js` inicia — e depois, a cada 6h, enquanto continuar ligado — ele confere sozinho um arquivo `versao.json` num repositório público (GitHub, gratuito). Se a versão de lá for mais nova que a versão atual, baixa os 2 arquivos do programa (`servidor.js` e `painel-rbo.html`), guarda uma cópia dos antigos em `data/backups-app/` (rotação das 20 mais recentes — só uma rede de segurança contra uma atualização ruim, não histórico de edição como o `data/backups/` dos dados), substitui os arquivos, e reinicia sozinho — sem precisar de comando nenhum, sem precisar reabrir nada na mão.

**Só toca nos 2 arquivos do programa, nunca em `data/`** — os dados reais (DRE lançado, projetos, governança, recepção, fotos, tudo) ficam sempre intactos, uma atualização de código não é uma atualização de dado.

**Enquanto não for configurado, não faz nada** — igual todo o resto do projeto (senha, hospedagem na nuvem), essa função é *opt-in*: com `REPOSITORIO_ATUALIZACAO` deixado no valor padrão (com "SEU-USUARIO/SEU-REPOSITORIO" dentro), a checagem nem tenta se conectar em lugar nenhum — comportamento idêntico a antes dessa mudança existir.

### Passo a passo pra ativar (uma vez só)

1. Criar uma conta gratuita em [github.com](https://github.com), se ainda não tiver.
2. Criar um repositório novo, **público** (não precisa ser privado — o código não tem senha nem dado nenhum dentro; a senha do painel, quando usada, é uma variável de ambiente separada, nunca fica no código). Botão "New" → dar um nome (ex: `painel-ibis-chapeco`) → Create repository.
3. Nesse repositório, usar o botão **"Add file" → "Upload files"** (funciona arrastando com o mouse, sem precisar saber usar linha de comando/git) pra subir 3 arquivos: `servidor.js`, `painel-rbo.html`, e `versao.json` (os dois primeiros são os mesmos da pasta do painel; o `versao.json` já vem pronto — só falta editar as 2 URLs dentro dele, trocando `SEU-USUARIO/SEU-REPOSITORIO` pelo usuário e nome do repositório que você acabou de criar. Dá pra editar direto no site do GitHub, sem baixar nada: abrir o arquivo lá → ícone de lápis "Edit").
4. Copiar a URL "raw" do `versao.json` que acabou de subir: no GitHub, abrir o arquivo → botão **"Raw"** → copiar o endereço da barra do navegador (algo como `https://raw.githubusercontent.com/SEU-USUARIO/SEU-REPOSITORIO/main/versao.json`).
5. Editar `servidor.js` (o de verdade, na pasta do painel no seu computador) e colar essa URL na constante `REPOSITORIO_ATUALIZACAO`, no lugar do valor padrão (procurar por "SEU-USUARIO" no arquivo — é fácil de achar).
6. Reiniciar o servidor (`node servidor.js`) — no log vai aparecer "✓ Atualização automática ativa" em vez do aviso de "não configurada".

### Como publicar uma atualização depois (toda vez que eu — Claude — te mandar arquivos novos)

1. No repositório do GitHub, subir os arquivos atualizados (`servidor.js` e/ou `painel-rbo.html`) — mesmo botão "Upload files", que sobrescreve os antigos.
2. Editar `versao.json` no repositório: aumentar o campo `"versao"` (formato `AAAA.MM.DD`, ou `AAAA.MM.DD.2` se publicar mais de uma vez no mesmo dia) pra um valor **maior** que o anterior, e (opcional) escrever em `"notas"` um resumo curto do que mudou.
3. Pronto — na próxima vez que o servidor checar (na inicialização, ou dentro de até 6h se já estiver ligado), ele baixa e aplica sozinho, em qualquer computador que estiver rodando com essa mesma configuração.

**Importante**: a constante `VERSAO_ATUAL` dentro do `servidor.js` que você sobe pro repositório precisa bater com o número que você colocar em `versao.json` — é o que evita o servidor entrar num loop tentando "atualizar" pra uma versão que, na prática, já é a que ele acabou de aplicar. Sempre que eu (Claude) preparar uma atualização nova, já vou deixar essa constante certa no arquivo — só falta você subir os 2 arquivos + editar o número em `versao.json`, como no passo acima.

**Como foi testado**: 4 cenários com um servidor HTTP local simulando o repositório (sem depender de internet de verdade no teste) — (1) versão nova disponível: baixou os 2 arquivos, fez backup dos antigos em `data/backups-app/`, aplicou e reiniciou sozinho, confirmado por marcador de conteúdo nos arquivos e pela nova versão aparecendo no log após o reinício; (2) mesma versão: não fez nada, seguiu direto pro resto da inicialização; (3) `versao.json` corrompido/inválido: logou o erro e seguiu normal, sem travar o servidor; (4) repositório fora do ar (conexão recusada): mesma coisa, log de aviso e segue normal. Testado também o estado padrão (não configurado): checagem nem tenta se conectar, log confirma "não configurada ainda".

## Fórmula validada — Resultado Operacional I

```
Receita Bruta + Impostos + Redução de Vendas + Total Custos + Total Pessoal + Total Despesas
```

`Total Despesas` **já vem com Remuneração da Marca embutida** — não somar essa categoria separada, senão duplica. Validado contra o valor explícito de "Resultado Operacional I" em ambas as plataformas de DRE, em todos os meses disponíveis, batendo exato.

## Fontes de dado — como cada uma funciona

Todas lidas nativamente (zip + XML por dentro, sem biblioteca externa — Node usa `zlib`, navegador usa `DecompressionStream`), tanto no servidor quanto no upload manual pelo navegador.

**PMS (Forecast/Histórico)** — `.xml` (tags `G_REC_TYPE`/`CONSIDERED_DATE`) ou `.html` (Oracle Reports, coluna Total Revenue). Servidor tenta XML primeiro, senão tenta HTML. Alimenta a "Receita Considerada" do simulador — **usa o valor de receita de quarto direto do relatório, sem multiplicar por nenhum fator** (decisão do usuário: a Receita Bruta do DRE inclui itens como café da manhã incluso e lavanderia que não aparecem no Forecast, então projetar um fator inflava a receita considerada além do que realmente está no livro).

**Notas Fiscais** — NFe padrão SEFAZ, lida em **dois formatos**: XML (`parseNotaFile`/`parseNotaXml`) e, desde 2026.07.28, **PDF do DANFE** (`parseNotaPdfNavegador`/`parseNotaPdf`) — ver seção dedicada abaixo. Classificação automática por palavra-chave (CMV/Operacional/Fixo), com **aprendizado**: cada correção manual é lembrada por descrição do item e aplicada sozinha em notas futuras parecidas (aparece marcado "aprendido"). As duas funções de leitura de nota (XML e PDF) são reaproveitadas na aba **Projetos** pra anexar notas de compra a cada projeto de melhoria.

**Praça (Lighthouse Rate Insight)** — `.xlsx`, compara tarifa com 6 concorrentes do compset. Cada canal (Booking.com, Brand.com, Hotels.com) tem horizonte de pesquisa diferente — o painel avisa até onde o canal escolhido enxerga com confiança.

**DRE diário** (export "DRE de Todas as Unidades") — `.xlsx`, pode trazer 1 mês ou vários meses no mesmo arquivo (detecta pelo rótulo repetido 3x na linha 2, um por coluna Real/Budget/Variação). Atualiza **só o realizado** (receita, custos, pessoal, despesas) e as linhas individuais do simulador (RAZAO) por código de conta — nunca mexe no orçado.

**DRE anual (All Strategy)** — `.xlsx`, plataforma diferente, estrutura diferente por dentro (categorias por nome, não por código — os códigos mudam entre as duas plataformas, ex.: Custos é "07" aqui e "08" no diário). Traz o **ano inteiro** (12 meses) de uma vez: Realizado, Planejado (orçado) e Realizado do Ano Anterior. É quem define o **orçado** — a matriz de cálculo do budget, que fica parada depois de definida. Único a trazer comparativo ano a ano.

**Precedência entre os dois DREs**: All Strategy aplicado primeiro (define orçado pro ano inteiro + ano anterior), DRE diário por cima só atualizando realizado nos meses que tiver. Orçado nunca muda por reimportação do diário. Comparativo com ano anterior nunca é apagado (só o All Strategy traz).

---

## Funcionalidades (visão completa)

- **Visão Geral**: dashboard KPI (receita YTD, margem YTD com gauge, resultado YTD, forecast do mês — todos com sparkline/delta), gráfico de área receita real x orçado x ano anterior, barras de margem mês a mês com linha de meta, barras horizontais de progresso receita por mês, banner de Flow Through/Flex (conceito de mercado: quanto da variação de receita virou variação de resultado, benchmark 35–60% saudável), resumo executivo (4 cards: meta/praça/pace/pendências), gauge de entrega vs meta, ponte de resultado (efeito volume x custo), simulador de proporcionalidade (139 linhas, fixo x variável), banner de padrão sazonal aprendido (usa ano anterior), banner de cruzamento Praça x Pace, tabela de Lançamento Mensal (12 meses, editável), upload de DRE diário e All Strategy.
- **Recepção** *(novo — 2026.08.13)*: operação do dia a dia — tarefas, follow-up manual de WhatsApp/e-mail, equipe, reservas organizadas à parte do PMS, apontamento de erro dos colaboradores com ranking pra tratativa interna, e checklist de back office. Ver seção dedicada abaixo.
- **Governança** *(novo — 2026.08.13)*: desempenho de camareiras a partir do "Task Sheet Report" do Opera Cloud (PDF) — upload do relatório, designação da camareira responsável por cada plano, e cálculo automático de saídas/arrumações do dia, quartos feitos e média mensal, com conferência de "feito" sempre manual. Ver seção dedicada abaixo.
- **Notas Fiscais**: upload de NFe (XML **ou** PDF do DANFE), classificação com aprendizado, reconciliação CMV/Operacional/Fixo.
- **Projetos** *(novo — 2026.07.28)*: registro dos projetos/melhorias feitos na unidade desde a chegada do usuário, pra apresentação à diretoria. Ver seção dedicada abaixo.
- **Pace**: histórico diário do on-the-books, hoje x ~7 dias atrás, por mês.
- **Praça**: comparativo de tarifa com compset, ranking, aviso de cobertura por canal.
- **Ações**: recomendações automáticas (junta ponte + simulador + notas + Praça x Pace + ano anterior + desvio histórico por linha), lista de "linhas fora do próprio padrão" (compara cada conta com a média dela mesma nos últimos meses fechados, não só com o orçado — precisa de 3+ meses de histórico por linha), lista de tarefas, agenda.

### Tabela do simulador (Visão Geral → "Quanto gastar por linha")
Colunas: Categoria, Composição (fixo/variável/misto), Orçado, Saudável, Ajuste vs. orçado, **Realizado**, **Real vs. saudável**. Selos automáticos: "#1/#2/#3 maior impacto" (maiores |ajuste| do mês) e "Estourado" (já gastou mais que o saudável permitiria, com o real disponível). Cor verde de verdade (`--bom: #3ECF8E`) para valores positivos/saudáveis — não usar `--accent-strong` pra isso, é visualmente idêntico à cor do texto normal.

### Resultado Saudável / Margem Saudável (definição)
Pra cada linha: se **fixa**, saudável = orçado (não muda com a receita). Se **variável**, saudável = `(orçado da linha ÷ receita orçada) × receita considerada` — preserva o % da receita que a linha representava no orçamento, aplicado na receita que está acontecendo agora. Resultado Saudável = soma de tudo isso + receita considerada. Margem Saudável = Resultado Saudável ÷ Receita Considerada.

### Persistência
Com o servidor rodando, tudo que é editado (mês fechado, meta, cenário, classificação de notas, RAZAO mutado por DRE, otbData de upload manual, to-do, agenda, projetos de melhoria e data de chegada, tudo da aba Recepção **e agora tudo da aba Governança**) salva sozinho em `data/estado.json` ~1s depois de qualquer mudança, sem botão de salvar. Indicador no topo mostra hora do último salvamento.

### Pace — detalhe
`data/historico/otb-AAAA-MM-DD.json`, uma cópia por dia, a partir de quando o servidor começou a rodar (não reconstrói dias anteriores). Só receita de quarto por enquanto.

---

## Aba Recepção — operação do dia a dia (novo, 2026.08.13)

Pedido do usuário (Lucas + a supervisora de operação, as duas únicas pessoas que usam essa aba): controlar a operação de recepção — tarefas, acompanhamento de follow-up de WhatsApp e e-mail, controle de equipe, reservas organizadas à parte, apontamento de erro dos colaboradores com ranking pra tratativas internas, e organização de back office/tarefas do cargo. Decisões tomadas via pergunta direta ao usuário: vira **nova aba** deste mesmo painel/servidor (não programa nem servidor separado); follow-up de WhatsApp/e-mail é **registro manual** (sem conectar em nenhuma conta de verdade — mesmo espírito "100% local, zero dependência externa" do resto do painel, evita depender de sessão/API que pode cair ou exigir aprovação da Meta); só duas pessoas usam o painel, então **não tem login** — qualquer campo de "colaborador/responsável" é texto livre com sugestão automática (um `<datalist>` alimentado pela aba Equipe), não uma conta de usuário.

- **Modelo de dados** — seis listas novas no estado (persistidas do mesmo jeito que `projetos`/`todoItems` já eram, cada uma como array de objetos com `id` via `gerarId()`):
  - `recTarefas`: título, responsável (texto), prioridade (alta/média/baixa), prazo, concluída. Lista sempre visível na sub-aba, sem precisar abrir formulário — igual ao padrão do to-do que já existia na aba Ações.
  - `recFollowups`: hóspede/contato, canal (WhatsApp/e-mail), responsável, assunto, prazo de retorno, status (aguardando resposta/respondido/resolvido) e um histórico de anotações com timestamp — pensado como uma linha do tempo da conversa, não só um status único.
  - `recEquipe`: nome, cargo, contato, turno (manhã/tarde/noite/comercial), status (ativo/férias/afastado/desligado), admissão. É a fonte do `<datalist>` de sugestão de nome usado em tarefas, follow-ups, apontamentos e back office.
  - `recReservas`: hóspede, quarto, check-in/check-out, canal, status (confirmada/pendente/cancelada), observações. **Não é o PMS** — é um registro próprio da recepção pra organizar o que foi combinado por telefone/WhatsApp antes de lançar no sistema oficial.
  - `recErros`: colaborador, data, tipo (atraso/erro de cadastro/erro de cobrança/atendimento/comunicação/outro), gravidade (leve/média/grave), descrição, status (pendente/tratado) e campo de tratativa interna.
  - `recBackoffice`: tarefa recorrente, periodicidade (diária/semanal/mensal), turno opcional, última execução (`{data, colaborador}`) e histórico das últimas execuções.
- **Ranking de apontamentos** (`renderRecRanking`): agrupa `recErros` por colaborador, soma pontuação ponderada por gravidade (leve=1, média=2, grave=3) e desenha uma barra proporcional ao maior score — pensado como ferramenta de acompanhamento pra conversa de desenvolvimento com a equipe, não pra expor publicamente; o texto de apoio na tela já deixa isso explícito ("use como base pras conversas de desenvolvimento, não isoladamente").
- **Status de back office calculado, não editado manualmente** (`statusBackoffice`): compara a última execução registrada com hoje conforme a periodicidade (diária = mesmo dia; semanal = menos de 7 dias; mensal = mesmo mês/ano) — decide sozinho se a tarefa está "feita neste período" ou "pendente", sem precisar de um campo de status separado que alguém esqueceria de atualizar.
- **Navegação**: a aba tem 6 sub-seções por pills internas (Tarefas / Follow-ups / Equipe / Reservas / Erros & ranking / Back office) — mesmo padrão visual do menu lateral, só que horizontal e dentro da aba, pra não precisar de 6 itens novos no menu principal.
- **Resumo no topo da aba**: 4 cards (tarefas abertas, follow-ups aguardando, apontamentos pendentes, back office pendente hoje) recalculados a cada render — visão rápida do que precisa de atenção sem entrar em cada sub-aba.
- **Padrão de UI**: listas em "linha expansível" (clicar na linha abre os campos de edição/detalhe embaixo, mesmo padrão já usado nas Notas Fiscais) pra Follow-ups/Equipe/Reservas/Erros/Back office; Tarefas fica sempre com todos os campos visíveis (mais rápido pro uso do dia a dia, que é o mais frequente). Edição é automática ao mudar o campo (`change`), sem botão "salvar" — mesmo padrão já usado no detalhe da aba Projetos.
- **Restauração no reset**: igual a `projetos`/`todoItems`/`agendaItems`, o botão "Restaurar dados originais" **não apaga** nada da Recepção — é operação real do dia a dia, não cenário financeiro derivado do orçamento.
- **Nada mudou em `servidor.js`** — reaproveita o mesmo `POST /api/estado` que já existia; o JSON salvo só ficou mais gordo com os 6 campos novos.
- **Como foi testado**: `node --check` no JS extraído do HTML, checagem de IDs duplicados no arquivo inteiro, e fluxo completo end-to-end num Chromium real via Playwright — cadastrar colaborador, criar tarefa e concluir, criar follow-up e adicionar anotação e resolver, criar reserva pra hoje, criar apontamento e marcar como tratado (conferindo o ranking aparecer certo), criar tarefa de back office e confirmar execução — todos os contadores de resumo conferidos antes/depois de cada ação. Persistência testada em duas sessões separadas (salvar → nova aba do zero → reabrir): tarefa, colaborador e ranking todos restaurados certinho. Testado também em largura de 390px (padrão do projeto pra qualquer mudança visual).

---

## Aba Governança — desempenho de camareiras (novo, 2026.08.13)

Pedido do usuário: "controle de rendimento das camareiras, onde eu consigo fazer o upload dos planos, designar a camareira responsável pelo plano e assim, conseguirmos calcular quantas saídas ela vai ter no dia, quantas arrumações ela fez no dia, qual a quantidade média mensal de quartos feitos e quantos quartos ela deixou de fazer" — tudo extraído do relatório do PMS Opera Cloud (o "Task Sheet Report", que classifica cada quarto como stayover/departure).

**Decisões tomadas via pergunta direta ao usuário** (nessa ordem):
1. O "plano" é **um arquivo por camareira** (não um arquivo único compartilhado).
2. Tanto o plano quanto o relatório do Opera são **PDF**.
3. A camareira marca "OK" **à mão, no papel**, nos quartos que terminou — deixa em branco o que não fez.
4. Esse plano em papel é **escaneado/fotografado depois** — ou seja, o "OK" é letra de mão dentro de uma imagem, não texto digital.
5. Diante disso, duas opções foram apresentadas: tentar OCR na letra de mão, ou conferência manual no painel. **O usuário escolheu conferência manual** — decisão alinhada com a regra deste projeto de nunca confiar em extração automática não confiável quando o resultado vira métrica de avaliação de gente. OCR de letra de mão erraria de vez em quando, e um erro aqui pode injustamente penalizar (ou favorecer) uma camareira.

**Como funciona, na prática**:
- O relatório do Opera (`Task Sheet Report.PDF`) é gerado digitalmente pelo sistema — esse sim é lido automaticamente, com confiança, porque é texto real dentro do PDF (não é imagem/letra de mão).
- O plano escaneado da camareira é só **anexado como referência** — abre numa aba nova pra quem for conferir olhar lado a lado com o painel, mas o conteúdo dele nunca é lido por código.
- Quem confere (Lucas ou a supervisora) marca manualmente, quarto a quarto, no painel, olhando o "OK" escrito à mão no anexo — cada clique é uma decisão humana, não uma leitura automática.

**Modelo de dados**:
- `govPlanos`: um item por Task Sheet No. do relatório (confirmado pelo usuário: cada Task Sheet No. = o plano de UMA camareira pra UM dia). Cada plano guarda `{id, data, taskSheetNo, taskCode, colaboradorId, anexo:{caminho, nome}|null, quartos:[...], totalQuartos, oficial}`. Cada quarto guarda o que veio do Opera (`numero, tipo, roomStatus, foStatus, reservationStatus, hospede, chegada, partida, categoria`) mais o único campo editado manualmente no painel: `feito` (boolean).
- `govCamareiras`: cadastro simples (`nome`, `status` ativo/inativo) — alimenta o `<datalist>` de sugestão no campo "camareira responsável" de cada plano, e é criado automaticamente na primeira vez que um nome novo é digitado ali (não precisa cadastrar antes).
- **Categoria do quarto** (`saida` x `arrumacao`) **não usa o texto do "Reservation Status" diretamente** — o usuário descreveu o Opera usando os rótulos "Due Out"/"Checkout" pra saída e "Stayover" pra arrumação, mas a amostra real (relatório puxado às 15:57, depois da maioria dos check-outs do dia) trazia "Departed" no lugar de "Due Out"/"Checkout" pros mesmos quartos — o texto exato varia conforme o horário de extração e a configuração do Opera. Em vez de tentar prever todo rótulo possível, a categoria é decidida comparando a **data de partida do quarto com a data do próprio Task Sheet**: se o quarto parte no mesmo dia do plano, é uma saída (troca completa); senão, é arrumação (hóspede continua na casa). É a mesma informação que os rótulos carregam, só que extraída de um campo mais estável.
- **Reimportar o mesmo Task Sheet** (mesma data + mesmo número) **atualiza os dados do Opera mas preserva** camareira designada, anexo e quartos já marcados como feito — reimportar um relatório (ex: versão mais atualizada do mesmo dia) não deveria apagar conferência que já foi feita.
- **Métricas calculadas, nenhuma digitada**: saídas do dia = quartos com categoria "saida" no(s) plano(s) da data selecionada; arrumações do dia = idem "arrumacao"; quartos feitos = `quartos.filter(feito)`; quartos deixados de fazer = total − feitos; média mensal por camareira (aba Desempenho) = soma de feitos ÷ número de dias com plano designado a ela no mês (dia sem plano não entra na conta).

**Extensão do motor de leitura de PDF (importante — também melhora a leitura de DANFE)**: o "Task Sheet Report" usa um tipo de fonte que o parser de PDF deste projeto nunca tinha encontrado — fonte composta Type0 com `/Encoding /Identity-H` (texto em CID, 2 bytes por caractere, mapeado por uma fonte TrueType incorporada) mais um stream `/ToUnicode` (CMap padrão do PDF que traduz CID → texto Unicode). O parser original só sabia ler WinAnsiEncoding (1 byte = 1 caractere, o caso do DANFE). Foi adicionado suporte aos dois formatos de CMap do spec (`beginbfchar`/`beginbfrange`) em `parseToUnicodeCMap`/`resolverFontesDaPagina`, e o tokenizador de texto (`tokenizarConteudoTextoPdf`) agora recebe um `fontesMap` opcional por página que diz, fonte a fonte, se uma string hex é WinAnsi ou CID — **sem fontesMap (ou sem entrada pra fonte atual), cai sempre no caminho WinAnsi de sempre**, então o leitor de DANFE não muda em nada (confirmado com teste automatizado comparando os 3 casos byte a byte, resultado idêntico). Mesma extensão espelhada no navegador (`parseToUnicodeCMapNav`/`resolverFontesDaPaginaNavegador`, assíncrona porque o stream `/ToUnicode` pode vir comprimido com FlateDecode).
- **Como foi validado**: usuário forneceu um `Task Sheet Report.PDF` real (9 páginas, 4 Task Sheets, 122 quartos). O parser foi comparado linha a linha contra `pdftotext -layout` (ferramenta externa, usada só como fonte de verdade pra validar a implementação própria, não como dependência do projeto) — **zero diferença** em todas as 294 linhas extraídas. Depois, o parser de alto nível (`parseTaskSheetReportPdf`/`parseTaskSheetReportPdfNavegador`) foi conferido contra a página "Report Summary" do próprio relatório (total oficial de quartos por Task Sheet, que o Opera calcula sozinho) — bateu 100% (30/31/31/30 quartos, 122 no total) nos dois lados (servidor e navegador produzem exatamente o mesmo JSON).
- **Extração linha a linha usa posição de coluna, não regex no texto todo junto**: cada linha de quarto sempre vem em exatamente 8 itens de texto posicionados (Room No, Room Type, Room Status, FO Status, Reservation Status, Name, Arrival, Departure) — mais confiável que regex, que quebraria com nome de hóspede com vírgula/asterisco ("* Gregorio, Vanderlei") ou "Reservation Status" de duas palavras.
- **Página "Report Summary"** (total oficial por Task Sheet, quando presente no PDF) é usada só como conferência cruzada — se o total lido bater diferente do que o Opera calculou sozinho, um aviso aparece no plano ("O Opera registra X quarto(s) ... foram lidos Y").

**Anexo do plano escaneado**: mesmo padrão já usado pras fotos de antes/depois da aba Projetos — não entra no `data/estado.json` (ficaria gigante em base64), vai pro servidor via `POST /api/anexo` (novo endpoint, mesma lógica de `/api/foto` mas aceita PDF além de imagem), que grava em `data/anexos/` e o estado só guarda o caminho. Sem servidor no ar, cai num fallback em memória (não persiste entre sessões — mesmo aviso já dado nas fotos de projeto).

- **Navegação**: 3 sub-seções por pills internas (Planos do dia / Camareiras / Desempenho) — mesmo padrão de sub-navegação já usado na Recepção. Nessa mudança, a sub-navegação foi generalizada (`data-prefix` na `.subnav` + escopo pelo `.tab-panel` mais próximo) pra funcionar em mais de uma aba ao mesmo tempo sem uma pill de uma aba ativar o painel errado da outra.
- **Restauração no reset**: igual a `recTarefas`/`projetos`/etc., o botão "Restaurar dados originais" **não apaga** `govPlanos` nem `govCamareiras` — são planos já conferidos manualmente e cadastro de equipe, dado operacional real.
- **Como foi testado**: engine de PDF comparado byte a byte contra `pdftotext` (zero diferença) e entre as duas implementações gêmeas (servidor x navegador, JSON idêntico); teste de regressão confirmando que o tokenizador sem `fontesMap` produz saída idêntica à versão anterior (protege a leitura de DANFE); fluxo completo end-to-end num Chromium real via Playwright — upload do PDF real, 4 planos reconhecidos, designar camareira (cria automaticamente na lista se for nova), marcar quartos como feito, conferir contador de pendentes, anexar um PDF de plano escaneado e abrir o link, aba Desempenho recalculando média/não-feitos, aba Camareiras listando quem foi criada. Persistência testada em duas sessões separadas (planos, camareira designada, quartos marcados e anexo todos restaurados certinho). Confirmado que "Restaurar dados originais" não apaga nada da Governança. Testado também em largura de 390px.

---

## Aba Projetos — melhorias da unidade (novo, 2026.07.28)

Pedido do usuário: relacionar as notas fiscais de compra com os projetos/melhorias feitos na unidade desde a sua chegada, pra apresentar à diretoria. Decisões tomadas via pergunta direta ao usuário: registro de nota tanto por **upload de XML/PDF quanto lançamento manual**; vira **nova aba** do painel existente (não ferramenta separada); inclui **fotos de antes/depois**; tem **botão de exportar PDF**.

- **Campo "data de chegada"** no topo da aba — usado só como referência visual/contexto pro board, não filtra nada automaticamente.
- **Cadastro de projeto**: nome, categoria (`Quartos`, `Áreas comuns`, `Fachada/Estrutura`, `Equipamentos`, `Segurança`, `Tecnologia`, `Outros`), status, data início/fim, descrição.
- **Notas fiscais por projeto**: aceita upload de XML de NFe **ou** PDF do DANFE (reaproveita as mesmas funções de leitura da aba Notas Fiscais) **ou** lançamento manual (fornecedor, descrição, valor, data) pra quem não tem o arquivo à mão. O total do projeto (`calcTotalProjeto`) soma essas notas.
- **Fotos antes/depois**: upload direto no navegador, redimensionado no cliente (`resizeImagemParaDataUrl`, máx. 1600px, JPEG qualidade 0.82) antes de subir — evita fotos de celular gigantes lotando o disco. Fotos **não ficam dentro do `data/estado.json`**: vão pro servidor via `POST /api/foto`, que decodifica o base64 e grava um arquivo de verdade em `data/fotos/`; o estado só guarda o caminho relativo do arquivo. Isso existe de propósito — o `estado.json` tem limite de 5MB no corpo do POST (`TAMANHO_MAX_BODY`), e base64 de fotos estouraria isso rápido.
  - **Sem servidor rodando**: upload de foto cai num fallback em memória (não persiste — se recarregar a página, a foto some). Isso é esperado e avisado ao usuário; fotos só persistem de verdade com `node servidor.js` no ar.
- **Exportar PDF**: botão que monta um HTML de relatório (`montarRelatorioProjetosHtml` — todos os projetos, fotos, tabela de notas) dentro de uma `<div id="relatorioImpressao">` escondida, e chama `window.print()`. Um bloco de CSS `@media print` esconde o resto da página e mostra só esse relatório — sem biblioteca externa de PDF, é o diálogo de impressão nativo do navegador ("Salvar como PDF").
- **Restauração no reset**: igual a `memoriaClassificacao`/`todoItems`/`agendaItems`, o botão "Restaurar dados originais" **não apaga** `projetos` nem `dataChegada` — é investimento real acontecido na unidade, não dado financeiro derivado que faça sentido resetar.

---

## Leitura de nota fiscal em PDF (DANFE) — novo, 2026.07.28

Pedido do usuário: "todas as notas fiscais estão em .pdf também, conseguimos fazer a leitura delas assim mesmo?" — nem toda nota que chega é XML; várias só existem como PDF do DANFE.

**Por que dá pra confiar num parser de PDF feito do zero, sem OCR**: o DANFE (Documento Auxiliar da Nota Fiscal Eletrônica) é um documento com **layout e rótulos fixados por lei** (padrão SEFAZ) — não importa qual sistema fiscal gerou o PDF, os rótulos em português e a frase do canhoto são sempre os mesmos. Isso torna extração por âncora de texto (regex) muito mais confiável do que tentar ler um PDF de fatura genérico. Dois âncoras principais:
- **Chave de acesso** (44 dígitos, sempre impressa por extenso no documento): não é texto livre, é uma codificação posicional fixa — dá pra decompor aritmeticamente em `cUF + AAMM + CNPJ emitente + modelo + série + número da nota + tpEmis + cNF + cDV`, sem ambiguidade de leitura.
- **Frase do canhoto** ("RECEBEMOS DE `<emitente>` OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO") — obrigatória por lei em todo DANFE, usada como âncora 100% confiável pro nome do fornecedor.

**Como foi validado**: usuário forneceu uma nota real nos dois formatos (PDF + XML) pra comparação. O parser de PDF foi construído e conferido campo a campo contra o XML da mesma nota (fonte da verdade) — fornecedor, CNPJ, número, série, data de emissão, valor total e item bateram 100%. Só depois disso o código foi incorporado ao `servidor.js` e ao `painel-rbo.html` (regra do projeto: nenhum parser sem arquivo real de exemplo primeiro).

**Implementação — zero dependência externa, do zero**: como todo o resto do projeto, sem nenhuma lib de PDF (nem `pdf-parse`, nem `pdf.js`). Implementação própria do necessário do formato PDF:
- Parser de objetos indiretos (`N G obj`/`endobj`), dicionários, arrays, nomes, strings.
- Suporte a *object streams* (`/Type/ObjStm`, PDF 1.5+) — comum em DANFEs gerados por sistemas fiscais modernos — descomprimidos com `zlib.inflateSync` no servidor e `DecompressionStream('deflate')` no navegador (mesmo padrão já usado pra ler `.xlsx`, mas com `'deflate'` em vez de `'deflate-raw'`, porque o PDF usa o formato zlib-wrapped e não o DEFLATE cru do ZIP).
- Localização de todas as páginas (`/Catalog` → `/Pages` → `/Kids`, recursivo — suporta nota com mais de uma página).
- Tokenizador do *content stream* da página (as instruções de desenho de texto: `BT`/`ET`, `Tf`, `Td`/`TD`/`Tm`/`T*`, `Tj`/`TJ`/`'`/`"`) — reconstrói cada trecho de texto com sua posição (x, y) na página, depois agrupa em "linhas" pela coordenada Y.
- Decodificação de fonte assumindo `WinAnsiEncoding` (a codificação declarada nas fontes Helvetica/Helvetica-Bold da amostra testada — fontes Type1 simples, sem fonte incorporada/CID).
- Duas implementações irmãs, seguindo o padrão já usado pro leitor de `.xlsx`: `parseNotaPdf` (Node, em `servidor.js`) e `parseNotaPdfNavegador` (navegador, em `painel-rbo.html`, com sufixo `Nav`/`Navegador` nas funções auxiliares). Mesmo formato de saída das duas (`{fornecedor, cnpj, numero, dataEmissao, valorTotal, itens}`) que o parser de XML, pra reaproveitar toda a lógica existente (classificação CMV/Operacional/Fixo, vínculo com projeto, totais) sem distinção de origem.

**Onde foi ligado**:
- Pasta única de entrada (`inbox/`): PDF agora é reconhecido pela extensão e roteado direto pra `notas-inbox/` (só serve pra uma coisa nesse sistema — nota fiscal em DANFE).
- Processamento de `notas-inbox/`: aceita `.xml` e `.pdf` misturados, escolhe o parser certo por extensão.
- Aba **Notas Fiscais** (upload manual): aceita `.xml,.pdf`, misturado, múltiplos arquivos de uma vez.
- Aba **Projetos** (upload de nota por projeto): mesma coisa, `.xml,.pdf` misturado.

**Limitação conhecida (documentada no próprio código)**: o parser assume fonte com `WinAnsiEncoding` (o caso da amostra testada, e o mais comum em DANFE gerado por sistema fiscal/JasperReports). Se um dia aparecer uma nota de um gerador diferente que não seja lida corretamente, a orientação é: lançar essa nota manualmente (sempre disponível como alternativa) e enviar o PDF de exemplo pra estender o parser — mesma regra de "nenhum parser sem amostra real" vale pra extensão futura.

**Como foi testado** (além da validação campo a campo contra o XML):
- Pipeline completo do servidor: PDF solto em `inbox/` → identificado e movido pra `notas-inbox/` → `data/notas-data.json` gerado corretamente.
- Parsing no navegador testado de verdade num Chromium real (via Playwright), não só `node --check` — porque depende de APIs só de navegador (`DecompressionStream`) que o Node não tem. Confirmado nos dois pontos de upload (aba Notas Fiscais e aba Projetos): fornecedor, número da nota, data, item e valor todos corretos e idênticos ao resultado do lado servidor.

---

## Investigação DRE diário x Orçado — 2026.08.03

Usuário reportou: "os valores da linha de budget e de realizados não estão batendo, o painel mostra um valor diferente da planilha". Anexou um export real (`DRE de Todas as Unidades 6.xlsx`, mês de julho) e pediu avaliação **linha a linha**, não só de uma conta específica.

**O que a investigação encontrou** (comparação campo a campo do parser contra a planilha real, com script Node isolado + Playwright pro lado navegador):

1. **Esse export específico não tem coluna de orçado nenhuma.** As 3 colunas de dado do mês (C/D/E) vêm **todas** rotuladas "Valor Realizado" no cabeçalho da própria planilha, e têm exatamente o mesmo valor em todas as 160 linhas conferidas. Não é uma amostra aleatória — é a estrutura inteira do arquivo. Esse formato de export aparentemente não inclui orçado (diferente do formato original com 3 colunas Real/Orçado/Variação que o parser foi validado contra).
2. **Bug real encontrado por causa disso**: como o parser antigo pegava a coluna de orçado só por *posição* (a 3ª coluna do bloco do mês), nesse arquivo ele acabava lendo a coluna "Valor Realizado" de novo e mostrando orçado = realizado — dado tecnicamente errado, mesmo que **não afete o painel hoje**, porque o orçado do DRE diário nunca é aplicado ao estado (só alimenta uma prévia interna) — ver ponto 4.
3. **Corrigido**: `detectarGruposDeMes`/`detectarGruposDeMesNavegador` agora conferem o **rótulo do cabeçalho** da coluna candidata a orçado (procura "orça"/"budget" no texto) antes de aceitar — se não bater (como nesse arquivo), orçado vira `null` em vez de duplicar o realizado. Testado contra o arquivo real (orçado → null, correto) **e** contra um arquivo sintético no formato antigo (Real/Orçado/Variação) pra garantir que não quebrou o caso que já funcionava (orçado ainda é lido certinho quando existe).
4. **Ponto importante, já existia mas vale reforçar**: o Orçado mostrado no painel **nunca** vem do DRE diário (mensagem própria do upload já avisa: "Orçado não é alterado por aqui") — vem só do **All Strategy** (arquivo anual). Se o Orçado no painel não bate com o que o usuário espera, o mais provável é que o All Strategy não foi (re)importado, e não um problema de leitura do DRE diário.
5. **Realizado conferido e validado**: os 6 agregados (receita/impostos/redução/custos/pessoal/despesas) calculados pelo parser a partir desse arquivo somam **exatamente** igual ao "Resultado Operacional I" explícito na própria planilha (R$ 140.766,57) — bate certinho, então a leitura do realizado está correta pra esse arquivo.
6. **Achado à parte, também corrigido**: o código de conta **"15.20 - MANUT MAT ELEVADORES"** existe nesse export mas não existia no RAZAO (a lista de ~139 contas do simulador) — foi adicionado (com histórico zerado, já que não tinha baseline antes). Sem isso, essa conta especificamente não aparecia na tabela "Quanto gastar por linha" nem no realizado por linha.
7. **Achado à parte, também corrigido**: o decodificador de entidade XML (`decodificarEntidadesXml`/Navegador) só tratava as 5 entidades nomeadas (`&lt; &gt; &amp; &quot; &apos;`), não entidades numéricas (`&#231;`, `&#xE7;`) — algumas ferramentas de export escrevem acento em português assim. Adicionado suporte a ambas (decimal e hex). O export real do usuário usa UTF-8 direto (não é afetado), mas é proteção padrão de XML que não custa ter.

**Pergunta em aberto pro usuário**: como não foi encontrado divergência no realizado nem no cálculo do Resultado Operacional I pra esse arquivo, se a diferença que o usuário viu for especificamente no **orçado**, o mais provável é que ele esteja comparando contra este mesmo arquivo (que não tem orçado) — nesse caso o comportamento already é o esperado (all-strategy é quem define orçado). Se for uma divergência **no realizado**, mês/linha específicos ajudariam a investigar mais.

## Aba Ações → Recuperação de resultado / relatório pra diretoria (novo, 2026.08.06)

Pedido do usuário: uma visão das linhas que mais impactam o resultado, como usar isso pra recuperar o resultado, com gráficos, justificativas pra diretoria e cenários. Decisões tomadas via pergunta direta ao usuário: vira um **relatório exportável separado** (não uma aba nova nem embutido dentro de "Ações" como conteúdo permanente — mas o *builder* interativo mora dentro da aba Ações, e o botão gera o relatório pra impressão/PDF a partir dali); os **cenários são simulação interativa** (usuário ajusta % de recuperação por linha, painel recalcula na hora); o **ranking usa desvio vs. orçado** (`real - orçado`, mais negativo primeiro).

- **`calcImpactoLinhas(mesIdx, topN=8)`**: varre o `RAZAO` (que só tem contas de custo/despesa, todas negativas) e pega as linhas com pior `real - orçado` num mês — mais negativo que o orçado = gastou (ou recebeu menos crédito) além do previsto, puxando o resultado pra baixo. Ignora linha sem movimento real no mês (mês ainda aberto ou conta sem lançamento).
- **UI interativa** (dentro da aba Ações, seção própria acima de Tarefas/Agenda): seletor de mês (só mostra meses fechados — precisa de realizado lançado pra fazer sentido), 4 KPIs (estouro total, recuperação projetada, resultado atual→projetado, margem atual→projetada), e uma lista das top linhas com barra proporcional ao tamanho do desvio, valores orçado/real, e um campo "meta de recuperação" (%) por linha — mexer nesse campo recalcula tudo na hora (`recResultMetas`, mapa código→%, default 50%).
- **`montarRelatorioResultadoHtml()` + botão "Gerar relatório pra diretoria"**: reaproveita o mesmo mecanismo já existente da aba Projetos (`#relatorioImpressao` escondido + `window.print()` + CSS `@media print`) — monta um HTML autocontido com os mesmos KPIs, uma tabela detalhada (orçado/real/desvio/peso visual/meta/recuperação por linha), um parágrafo de **justificativa automática por linha** (sugere ação diferente pra despesa fixa — revisão de contrato — vs. variável — renegociação/redução de consumo, baseado na composição F/V já existente no RAZAO) e um parágrafo de **cenário consolidado** (resultado e margem projetados, com a ressalva de que é simulação).
- **Não é persistido** — `recResultMesIdx`/`recResultMetas` são só estado de sessão (como outros cenários "e se" do painel), somem ao recarregar sem salvar. Resetado também pelo botão "Restaurar dados originais".
- **De quebra, corrigido**: um bug antigo de chave faltando fazia `renderDesvios()` rodar em toda troca de aba (não só na aba Ações) — inofensivo, mas corrigido junto por estar exatamente no bloco que precisava da chamada nova.
- **Testado**: end-to-end num Chromium real via Playwright — KPIs corretos matematicamente (recuperação = soma de |desvio| × meta%), recálculo ao vivo confirmado ajustando uma meta pra 100% e comparando o KPI antes/depois, relatório gerado contém tabela + justificativa, conferido visualmente por screenshot (tema escuro, barras, chips, tudo consistente com o resto do painel).

## Investigação "gasto x recomendado não bate" — 2026.08.06

Usuário anexou um terceiro export (`DRE de Todas as Unidades 9.xlsx`, julho) e reportou que o painel "não está fazendo a comparação correta do realizado x orçado x on the books" — usuário apontou exatamente: **"os números do gasto x recomendado, por categoria, os valores não estão batendo"** — ou seja, a tabela "Quanto gastar por linha" (coluna Saudável/Ajuste), não o realizado nem o orçado em si.

**O que a investigação encontrou** (conferência campo a campo do parser contra a planilha real + inspeção direta do estado interno num Chromium de verdade via Playwright, `calcProporcional()` chamado ao vivo):

1. **Não é bug de cálculo.** A fórmula do simulador (`saudavel = orçado` se fixa, `(orçado/receitaOrcada) × considerada` se variável) está correta e foi conferida linha a linha contra a planilha.
2. **É uma lacuna na cascata de escolha de fonte.** `calcProporcional()` escolhe a "receita considerada" automaticamente nessa ordem: OTB (PMS/Forecast, "No livro") → Realizado (só se o mês estiver marcado **fechado**) → Orçado (último recurso). Pra julho desse arquivo: não tinha OTB carregado, e o mês não estava marcado fechado — então mesmo com **R$ 562.444 de realizado já disponível** (vindo do próprio DRE que o usuário acabou de subir), o simulador caiu pro Orçado (R$ 678.460) como receita considerada.
3. **Consequência**: com `considerada === orçado`, toda linha variável dá `saudavel === orçado` e `ajuste === 0` — a tabela "Quanto gastar por linha" fica com a coluna Ajuste inteira zerada, parecendo travada ou errada, mesmo com o Realizado por linha mostrando valores bem diferentes do orçado.
4. **Por que não foi "corrigido" auto-marcando o mês como fechado**: essa regra é proposital (documentada desde antes) — não confiar em receita parcial de um mês ainda em andamento pra encolher a meta de gasto seria pior (mês fecha em alta no fim, e o painel já teria relaxado a meta no meio do mês). Antes de mexer nisso, faltava só **avisar** o usuário da situação e dar o caminho de resolver.
5. **Corrigido**: novo aviso em `renderFonteChips()` (aparece no card "Quanto gastar por linha", mesmo lugar do aviso já existente de fonte presa) — dispara quando a fonte automática caiu pro Orçado **apesar de já existir realizado relevante** (diferença de +1% entre real e orçado), explicando a causa e as duas saídas: fechar o mês na tabela de Lançamento Mensal, ou escolher manualmente "Realizado" como fonte.
6. **Testado end-to-end**: Playwright real, upload do `dre9.xlsx`, conferido que o aviso aparece com o texto certo (`"⚠ Já tem receita realizada pra julho..."`), e que ao simular fechar o mês (`state[mesIdx].fechado = true`) o aviso some sozinho e `calcProporcional()` passa a usar Realizado (`considerada` vira exatamente a receita real, `fonte: "Automático · via Realizado"`).

**Resumo pro usuário**: a tabela não estava calculando errado — ela estava, sem avisar, usando o Orçado como base porque julho não tinha sido fechado nem tinha dado de PMS. Como hoje (2026.08.06) julho já acabou há tempo, a recomendação é fechar julho na tabela de Lançamento Mensal (ou trocar a fonte pra "Realizado" manualmente) pra a coluna Ajuste passar a refletir a receita real. O painel agora avisa isso sozinho quando a situação se repetir em outro mês.

## Relatórios ilustrados exportáveis — Geral, Governança, Recepção e Consolidado (novo, 2026.08.14)

Pedido do usuário, junto com a hospedagem na nuvem: "gere relatórios gráficos para apresentação de cada painel disponível, como relatórios financeiros, relatório de rendimento individual de camareira, recepção e dos projetos, ilustrados, bem editados e com 100% de accuracy das informações" — e confirmado via pergunta direta que quer **os dois**: relatório individual por aba **e** um relatório consolidado juntando tudo.

**Regra de ouro seguida em todos os quatro** (a mesma já usada desde o relatório de Recuperação de Resultado, 2026.08.06): nenhum número é recalculado do zero dentro da função do relatório — cada um chama a **mesma função de cálculo que já alimenta a tela**, ou lê o `state` diretamente. Pra isso, quatro cálculos que antes viviam soltos dentro de funções de `render*` (misturados com a escrita no DOM) foram extraídos em funções próprias, hoje reaproveitadas tanto pela tela quanto pelo relatório:
- `calcKpiYtd()` — acumulados YTD (receita/resultado/margem real e orçado) — extraído de `renderKpiDashboard`.
- `calcResumoExecutivo()` — os 4 cards do resumo executivo (meta/praça/pace/pendências) — extraído de `renderResumoExecutivo` (assíncrona, porque `calcPaceMes` é assíncrona).
- `calcGovDesempenho(mes)` — desempenho por camareira num mês (dias, feitos, saídas, arrumações, não-feitos, média) — extraído de `renderGovDesempenho`, com dois campos novos (`saidas`, `arrumacoes`, `porDia`) que a tela não usava mas o relatório sim.
- `calcRecRanking()` — ranking de apontamentos por colaborador — extraído de `renderRecRanking`.

Nenhuma dessas extrações mudou o resultado do que já era exibido — é só mover as mesmas linhas de código pra um lugar reaproveitável, com `render*` agora chamando a função de cálculo e só cuidando de escrever no DOM.

**Os quatro relatórios novos** (mesmo padrão visual dos já existentes — `montarRelatorioResultadoHtml`/`montarRelatorioProjetosHtml`: HTML com CSS inline, tema claro/impressão, dentro de `#relatorioImpressao`, revelado só no `@media print`, gerado via `window.print()` nativo do navegador — sem nenhuma biblioteca de PDF):
- **`montarRelatorioGeralHtml()`** (botão "Exportar relatório financeiro", aba Geral) — 4 KPIs YTD (receita, margem, resultado, forecast do mês), os 4 cards do resumo executivo, e uma tabela mês a mês (receita real/orçada, resultado, margem) usando `calcResultadoReal(i)` — a mesma função que o relatório de Recuperação de Resultado já usava.
- **`montarRelatorioGovernancaHtml(mes)`** (botão "Exportar relatório de governança", aba Governança → Desempenho) — totais do mês (quartos feitos, saídas, arrumações, nº de camareiras) e uma tabela por camareira (dias trabalhados, feitos, saídas, arrumações, não-feitos, média/dia, barra proporcional).
- **`montarRelatorioRecepcaoHtml()`** (botão "Exportar relatório de recepção", aba Recepção) — retrato do momento atual (não um período fechado, já que Recepção é operação do dia a dia): 4 KPIs (tarefas abertas, follow-ups aguardando, apontamentos, back office pendente), tabela de tarefas abertas, tabela de follow-ups aguardando resposta, ranking de apontamentos por colaborador, e status de back office.
- **`montarRelatorioConsolidadoHtml()`** (botão "Relatório consolidado", sempre visível no topo, qualquer aba) — junta os quatro relatórios (Geral + Governança do mês selecionado na tela + Recepção + Projetos, reaproveitando `montarRelatorioProjetosHtml()` que já existia) num único documento, com quebra de página (`page-break-before`) entre cada seção.

**Ajuste de CSS de impressão encontrado ao revisar visualmente** (afetava também os dois relatórios que já existiam antes desta mudança, não só os novos): a regra global do tema escuro `h1,h2,h3{ color:var(--ink) }` é por elemento, então ela vencia a cor herdada (`#111`) que os relatórios passam no `<div>` que os envolve — títulos saíam esverdeados/apagados em vez de pretos no PDF. Corrigido com uma regra escopada `#relatorioImpressao h1,h2,h3,h4{ color:#111 !important; }`. Também corrigido: o fundo escuro do `body` (que `visibility:hidden` oculta mas não remove do fluxo/cor) sobrava atrás e abaixo do relatório — `html,body{ background:#fff !important; }` dentro do `@media print` resolve.

**Como foi testado**: `node --check` no JS extraído do HTML; checagem de IDs duplicados; fluxo completo num Chromium real via Playwright — os quatro botões clicados (mais o botão consolidado), conferindo que `#relatorioImpressao` recebe HTML não-vazio e sem erro de JS novo. Testado também com dado real: cadastrada uma camareira e um plano com um quarto marcado como feito, mais uma tarefa e um apontamento na Recepção — os números no relatório bateram exatamente com o que foi cadastrado (1 feito = 1 saída = 1 não-feito na tabela de Governança; 3 tarefas + 3 apontamentos de "Marina" refletidos certinho no ranking). Print preview (`emulateMedia('print')`) conferido por screenshot pros quatro relatórios, tema claro renderizando corretamente. **Nota sobre o dashboard KPI aparecer "—" nos testes automatizados**: é só limitação de rede do sandbox de teste (sem acesso ao CDN real do Chart.js) — chamando `renderKpiDashboard()` manualmente depois que o Chart carrega, o card mostra exatamente o mesmo valor que `calcKpiYtd()` retorna pro relatório, confirmando a consistência 100% entre tela e relatório num ambiente com internet normal (uso real do usuário).

## "Mês vigente" no topo da aba Geral + KPIs deixando de atualizar na hora (novo, 2026.08.14)

Usuário reportou: "não tem como finalizar o mês na aba principal, para poder trocar o mês vigente e fazer o comparativo de resultado". Investigando: **as duas funções já existiam** — a tabela "Lançamento mensal" (bem mais abaixo na aba Geral) já tinha um chip "aberto"/"fechado" clicável por mês, e o card "Quanto gastar por linha" (Simulador) já tinha um seletor "Mês" (`flexMesSelect`) pra escolher o mês de referência. Dois problemas reais explicam por que pareciam não funcionar:

1. **Bug de verdade**: fechar/abrir um mês pelo chip, ou trocar o mês no seletor do Simulador, **não atualizava os KPIs do topo da página** (Receita/Margem/Resultado YTD, Forecast do mês, banner de Flow Through) — só o `render()`/`renderProporcional()`/`renderExtras()` eram chamados, nunca `renderKpiDashboard()`. Só refletia no próximo F5 ou na reconferência automática de 20s. Um clique real que "não muda nada na tela na hora" é indistinguível de um botão quebrado. **Corrigido**: `renderKpiDashboard()` adicionado nos três lugares que mexem em mês/fechado — clique no chip da tabela, troca do `flexMesSelect`, e botão "Restaurar dados originais".
2. **Achado (não bug, mas dificuldade real de uso)**: os dois controles ficavam espalhados e escondidos — o chip "fechado" só aparece depois de rolar a página inteira até "Lançamento mensal" (a última seção da aba Geral), e o seletor "Mês" fica dentro do card do Simulador, sem nenhum rótulo tipo "mês vigente" que sinalizasse essa função.

**Solução**: novo atalho **"Mês vigente"** fixo no topo da aba Geral (ao lado do botão "Exportar relatório financeiro") — um seletor de mês + um botão "Fechar/Reabrir `<mês>`" (o texto do botão já diz o que vai acontecer ao clicar, e reflete o estado atual). Não duplica lógica: o seletor só espelha e dispara o `change` do `flexMesSelect` já existente, e o botão chama exatamente o mesmo código do clique no chip da tabela — os três controles (o novo atalho, o seletor do Simulador, o chip da tabela) ficam sempre sincronizados entre si, mudar um atualiza os outros dois.

**Como usar, na prática**: escolher o mês em "Mês vigente" (no topo da aba Geral) e clicar em "Fechar `<mês>`" assim que o resultado real desse mês estiver lançado (via upload de DRE) — isso faz esse mês passar a contar no Receita/Margem/Resultado YTD, habilita ele na tabela "Recuperação de resultado" (aba Ações) e no relatório financeiro exportável, e vira base de comparação real x orçado. O mesmo botão também serve pra reabrir um mês fechado por engano.

**Como foi testado**: Playwright com Chart.js real disponível (stub que preserva a estrutura `data.datasets` do config, diferente do stub simplista usado nos testes anteriores que zerava os datasets e mascarava esse fluxo) — fechar julho pelo novo botão do topo atualizou a Receita YTD na hora (de R$ 3.647.948 pra R$ 3.801.808, julho entrando na conta), o chip da tabela de Lançamento mensal mudou de "aberto" pra "fechado" junto, e o botão trocou de "Fechar julho" pra "Reabrir julho" sozinho. Trocar "Mês vigente" pra agosto sincronizou o seletor do Simulador e o card "Forecast do mês" (rótulo mudou pra "Receita prevista — agosto") na hora. Reabrir o mês de volta restaurou o estado original. Zero erro de página.

## Backlog pendente (priorizado)

1. **Alertas** — usuário confirmou querer, mas e-mail exige internet (conflita com uso "sem rede"). Alternativa 100% local: notificação do próprio sistema operacional (Windows/Mac), disparada pelo `servidor.js`. **Decisão pendente**: qual sistema operacional Lucas usa, pra saber qual comando implementar.
2. **Projeção via Lighthouse (Market Insight)** — aguardando confirmação de qual relatório e amostra de arquivo.
3. Decisão sobre as 2 planilhas Excel originais (congeladas desde o início, painel já foi muito além delas).
4. Extensão do Claude no site (Q&A sobre os dados) — precisa de API key própria do usuário + custo à parte; escopo realista é "responder pergunta sobre os dados atuais", não vigia autônomo.
5. **RevPAR, GOPPAR, CPOR** — KPIs padrão de mercado (achados em pesquisa). Precisa extrair "número de apartamentos" do DRE (já existe no arquivo, não é lido ainda) e "quartos vendidos" do PMS (já existe no XML, não é lido ainda).
6. Multi-propriedade — hoje o painel tem Ibis Chapecó "gravado" no código (categorias, RAZAO, valores). Se algum dia expandir pra outras unidades Atrio, precisa separar "o motor" (cálculos, leitores de arquivo) do "dado da unidade" — decisão de arquitetura grande, não decidida ainda.
7. ~~**PDF de nota com fonte fora de WinAnsiEncoding**~~ — **resolvido em 2026.08.13**: o motor de PDF agora também lê fontes compostas Type0/Identity-H com `/ToUnicode` (ver seção "Aba Governança"). Se ainda assim aparecer um PDF com uma fonte diferente dessas duas (WinAnsi ou Type0/Identity-H) que não seja lido, seguir enviando o arquivo de exemplo pra estender de novo.
8. ~~**Aba Recepção — exportar/imprimir apontamentos**~~ — **resolvido em 2026.08.14**: `montarRelatorioRecepcaoHtml()` (ver seção "Relatórios ilustrados exportáveis"). Ainda em aberto, não pedido: filtro por colaborador/período nas sub-abas quando o volume de dados crescer; notificação de prazo vencido (depende do item 1, alertas do SO).
9. ~~**Aba Governança — exportar/imprimir desempenho mensal**~~ — **resolvido em 2026.08.14**: `montarRelatorioGovernancaHtml(mes)` (ver seção "Relatórios ilustrados exportáveis"). Ainda em aberto, não pedido: gráfico de evolução mês a mês; suportar o vocabulário "Due Out"/"Checked Out" explicitamente na exibição (hoje a categoria "saída" é decidida por data, funciona igual, mas mostrar o rótulo exato do Opera na tela pode ajudar na conferência visual).

## Já feito (não repetir)
Cruzamento Praça x Pace · DRE mensal (multi-mês) · DRE anual All Strategy · Consolidação em HTML único · Resumo executivo · Pasta única com detecção automática · Correção de sincronização (polling rápido) · Auto-refresh da página sem F5 · Marca de versão · Precedência DRE diário x All Strategy · Aviso de fonte de receita presa (destaque visual no card) · Anotação rápida (to-do + agenda) · Desvio contra própria história por linha · Aprendizado de padrão sazonal · Flow Through/Flex · **Aba Projetos (melhorias da unidade, notas + fotos antes/depois + exportar PDF)** · **Exportar PDF via impressão do navegador** (implementado especificamente na aba Projetos — se um dia quiser PDF de outras abas/relatórios, o mesmo padrão `@media print` + `window.print()` pode ser reaproveitado) · **Leitura de nota fiscal em PDF do DANFE** (servidor + navegador, sem lib externa, validado contra XML real e testado em Chromium de verdade) · **Relatório de recuperação de resultado pra diretoria** (aba Ações → ranking de linhas por desvio vs. orçado, simulação interativa de meta de corte, justificativa automática, exportável via impressão/PDF) · **Aviso de fonte caindo pro Orçado com realizado disponível** (card "Quanto gastar por linha" avisa quando a fonte automática ainda usa Orçado apesar de já ter realizado relevante pro mês, e explica como resolver) · **Aba Recepção** (tarefas, follow-up manual de WhatsApp/e-mail com histórico, equipe, reservas próprias à parte do PMS, apontamento de erro com ranking ponderado por gravidade pra tratativa interna, checklist de back office com status calculado por periodicidade) · **Aba Governança** (upload do Task Sheet Report do Opera Cloud, designação de camareira por plano, conferência manual de quarto feito com anexo do plano escaneado só como referência, cálculo automático de saídas/arrumações/feitos/não-feitos e média mensal por camareira) · **Motor de PDF estendido pra fonte Type0/Identity-H + ToUnicode** (além do WinAnsi original — sem quebrar a leitura de DANFE existente) · **Hospedagem na nuvem** (senha via `SENHA_PAINEL`/HTTP Basic Auth, backup automático versionado de `data/estado.json`, proteção contra sobrescrita concorrente entre 2 dispositivos com aviso de conflito no painel, porta configurável via `PORT`, `Dockerfile`/`package.json` prontos, guia de deploy no Railway) · **Relatórios ilustrados exportáveis** (Geral/financeiro, Governança por camareira, Recepção e um Consolidado juntando os quatro incluindo Projetos — todos reaproveitando as mesmas funções de cálculo que a tela usa, via `calcKpiYtd`/`calcResumoExecutivo`/`calcGovDesempenho`/`calcRecRanking`/`calcResultadoReal`, pra garantir 100% de coerência entre tela e PDF) · **Atalho "Mês vigente" no topo da aba Geral** (fechar/reabrir mês e trocar o mês de referência num lugar só, sincronizado com o chip da tabela de Lançamento mensal e o seletor do Simulador; corrigido de quebra um bug em que fechar/trocar mês não atualizava os KPIs do topo na hora) · **Atualização automática** (servidor confere sozinho, na inicialização e a cada 6h, se tem versão nova num repositório público no GitHub; baixa, faz backup dos arquivos antigos em `data/backups-app/`, aplica e reinicia sozinho — sem afetar `data/`; opt-in, silencioso enquanto não configurado) · RevPAR/GOPPAR/CPOR ainda NÃO feito (só pesquisado).

---

## Como testamos (manter esse padrão)
- Nenhum parser é construído sem arquivo real de exemplo primeiro.
- Todo número exibido é conferido contra cálculo manual (Python) antes de considerar certo.
- Toda mudança de estrutura (JS/HTML) passa por `node --check` imediatamente.
- Persistência testada em duas sessões separadas (salvar → "fechar" → reabrir), não só salvar.
- Mobile testado à parte (largura 390px) toda vez que algo visual muda.
- Revisão de código periódica: IDs duplicados, funções nunca chamadas, referências quebradas.
- **Foto/servidor**: testado end-to-end antes de entregar — `node servidor.js` sobe, cria `data/fotos/` sozinho, `POST /api/estado` persiste `projetos`/`dataChegada`, `POST /api/foto` decodifica base64 e grava arquivo de verdade, e o arquivo salvo é servido de volta com `Content-Type` correto (`image/png`/`image/jpeg`/`image/webp`).
- **Código que só roda no navegador** (ex.: `DecompressionStream`, `DOMParser`): `node --check` só confere sintaxe, não comportamento — quando a lógica depende de API exclusiva de navegador, testar de verdade num Chromium real (Playwright) antes de considerar pronto, não só confiar no check de sintaxe.

## Bugs mais importantes já corrigidos (lições a não repetir)
- **Fator de conversão quarto→receita bruta**: removido a pedido do usuário — Receita Considerada usa Forecast puro agora.
- **Cor "positiva" invisível**: `--accent-strong` e `--ink` eram o mesmo hex — criada `--bom` de verdade.
- **RAZAO não sobrevivia a reset nem a F5**: agora tem snapshot original (pro reset) e é salvo (pra persistência).
- **`fs.watch` não confiável**: trocado por polling de 4s barato (só reprocessa se algo mudou de verdade).
- **Página aberta não pegava dado novo do servidor**: agora reconfere sozinha a cada 20s.
- **Roteador da pasta única mandava tudo pro DRE**: lista vazia `[]` é "verdadeira" em JS — trocado pra checar `.length`.
- **DRE só lia o primeiro mês do arquivo**: reescrito pra detectar todos os grupos de mês.
- **IDs duplicados** (`dreDrop` etc.): havia duas seções de upload iguais, uma delas nunca funcionava.
- Lista completa e detalhada de todos os ~22 bugs (com causa, como foi pego, correção) disponível se precisar — mas o resumo acima cobre os que mais importam pra não repetir erro.

---

## Recomendação de uso do Claude daqui pra frente
Esse arquivo + `painel-rbo.html` + `servidor.js` são suficientes pra qualquer conversa nova entender o projeto todo. Ideal: criar um **Project** no claude.ai, subir esses 3 arquivos como base de conhecimento — toda conversa nova dentro desse Project já nasce com o contexto, sem gastar tokens recarregando histórico de chat antigo.

# Vortex Collections — atualização da loja

Este pacote reúne o site e a API que trabalham juntos. Não contém senhas, tokens reais ou arquivos JAR. O visual novo usa azul e roxo, modo claro/escuro, animações suaves, cards preenchidos e uma área do cliente com perfil Minecraft. CNPJ informado no site: 66.004.874/0001-25.

## O que mudou

- VortexBedWars: R$ 150,00, incluído também no acesso do plano Premium.
- KitPvP: R$ 125,00; Feast: R$ 20,00; ThePIT: R$ 125,00. SkyWars permanece sob consulta se ainda não tiver preço configurado no banco.
- Catálogo com indicação de Minecraft 1.8–1.21 em todos os plugins. Esta atualização altera a indicação do site e do banco; não modifica nem comprova compatibilidade dos JARs. Confirme o arquivo de cada produto antes da venda/instalação.
- Login e cadastro em páginas próprias, opção de mostrar senha, sessão por aba ou opção de manter conectado.
- Cloudflare Turnstile no cadastro e login, com validação obrigatória na API quando ativado.
- Carrinho persistente, cálculo de preços na API e aplicação de cupons sobre o total. Uma compra gera uma licença por produto após confirmação.
- Perfil com nick editável, avatar Minecraft, ID da conta, produtos, chaves, um IP por licença, downloads, pedidos, assinatura e tickets.
- Administração restrita à conta principal. Equipe de suporte usa Atendimentos no painel do cliente; respostas da equipe aparecem à direita. Histórico mantido quando um ticket é finalizado.

## 1. Atualizar o GitHub e o Render

Extraia o ZIP. Envie o CONTEÚDO da pasta extraída para a raiz do mesmo repositório que você já usa. `server.js`, `package.json` e `index.html` devem ficar no primeiro nível do repositório.

O pacote inclui a pasta `public`, que contém apenas os arquivos do site. No Render:

| Serviço | Root Directory | Build Command | Start Command / Publish Directory |
| --- | --- | --- | --- |
| VortexCollections API — Web Service | deixe vazio | `npm ci --omit=dev` | Start Command: `npm start` |
| VortexCollections — Static Site | deixe vazio | deixe vazio | Publish Directory: `public` |

Atualize a API primeiro. Depois publique o Static Site. Use Manual Deploy → Deploy latest commit caso a publicação automática não comece.

A API prepara as novas tabelas e colunas do PostgreSQL ao iniciar. Ela reutiliza usuários, compras, licenças e cupons existentes; não é necessário recriar seu banco ou executar o antigo schema MySQL. O pacote contém o `schema.sql` PostgreSQL correto.

Mantenha os valores atuais de `DATABASE_URL`, `JWT_SECRET`, `LICENSE_SECRET`, `MP_ACCESS_TOKEN`, `ADMIN_USER_ID` e das URLs de download. A chave de criptografia das licenças depende de `LICENSE_SECRET`: reutilize o valor existente.

## 2. Configurar o CAPTCHA

No painel da Cloudflare, abra Turnstile e crie um widget do tipo Managed para o domínio da sua loja. Para a loja atual, adicione `vortexcollections.onrender.com`, sem `https://` e sem caminhos. Copie a Site Key e a Secret Key geradas.

No Render, abra **VortexCollections API → Environment**, adicione os valores abaixo e salve/publice novamente:

| Variável | Valor |
| --- | --- |
| `TURNSTILE_ENABLED` | `true` |
| `TURNSTILE_SITE_KEY` | Site Key do widget Turnstile |
| `TURNSTILE_SECRET_KEY` | Secret Key do mesmo widget |
| `TURNSTILE_HOSTNAMES` | `vortexcollections.onrender.com` |
| `CORS_ORIGIN` | `https://vortexcollections.onrender.com` |
| `PUBLIC_URL` | `https://vortexcollections-api.onrender.com` |

Para usar também um domínio próprio, cadastre-o no widget e inclua os hostnames separados por vírgula em `TURNSTILE_HOSTNAMES`; inclua as origens HTTPS completas em `CORS_ORIGIN`.

Essas chaves são da Cloudflare, não do Mercado Pago. Só a Site Key pública é enviada ao navegador. A Secret Key fica na API. Não publique chaves secretas no GitHub.

O CAPTCHA vem habilitado por padrão. Se as chaves ou os hostnames estiverem ausentes, o site explica que o acesso está sendo configurado e não libera login/cadastro. `TURNSTILE_ENABLED=false` desativa explicitamente essa proteção; não representa um CAPTCHA funcionando. Não há checkbox de segurança fictício.

Referência oficial: [Validação do Turnstile no servidor](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## 3. Liberar o download do BedWars

Adicione na API a variável `DOWNLOAD_BEDWARS_URL` com o endereço HTTPS do JAR disponibilizado por você. As outras continuam iguais:

- `DOWNLOAD_KITPVP_URL`
- `DOWNLOAD_FEAST_URL`
- `DOWNLOAD_THEPIT_URL`
- `DOWNLOAD_SKYWARS_URL`

O backend consulta essa origem e entrega o arquivo apenas ao titular de uma licença ativa. Sem o endereço configurado, o painel mostra que o arquivo ainda não está disponível. A compra não cria ou compila um JAR.

O identificador do novo produto para licenciamento é `vortex-bedwars`. A integração de licença dentro do JAR BedWars não foi feita neste pacote; ele deve consultar a mesma API de chave/IP usada pelos outros plugins.

## Entrar no painel

1. Abra `https://vortexcollections.onrender.com/login.html`.
2. Entre com sua conta existente ou cadastre uma nova conta.
3. Em Configurações, informe seu nick do Minecraft. O avatar é consultado pelo nick pelo serviço [MCHeads](https://mc-heads.net/). Se não houver imagem, aparece o símbolo da Vortex.
4. O número do ID aparece no perfil e nas configurações.
5. Administrar aparece somente quando `users.role` é `admin` e o ID é o configurado em `ADMIN_USER_ID`. O backend confere as duas condições em cada operação administrativa.

## Pagamentos e cupons

O token do Mercado Pago continua apenas na API. A notificação de compra é `/api/mercadopago/webhook`. A API consulta o pagamento autenticada no Mercado Pago e confere a referência, o valor e a moeda antes de liberar todos os plugins daquele carrinho.

As notificações repetidas não recriam licenças. Um reembolso ou estorno suspende as licenças vinculadas àquela compra. O carrinho permite um item por produto; novas licenças para outro servidor podem ser adquiridas em uma compra separada.

Cupons com limite reservam uma utilização enquanto o checkout está pendente, por até 30 minutos. O uso é contabilizado uma vez após aprovação. Cupons de 100% aprovam o pedido de valor zero na API, sem gerar um pagamento no Mercado Pago.

A assinatura mensal continua usando as configurações existentes `PLAN_BETA_PRICE_CENTS` e `PLAN_PREMIUM_PRICE_CENTS` e o webhook de assinatura existente. Não foram inventados preços para os planos.

## Arquivos e caminhos

- `public/`: apenas o site, para publicar no Static Site.
- Os mesmos HTML/CSS/JS da loja também estão na raiz para manter compatibilidade com o upload anterior.
- `server.js`, `auth-api.js`, `commerce-api.js`, `customer-api.js`, `license-vault.js`, `admin-support-api.js`: API Node.
- `schema.sql` e `commerce.sql`: estrutura e atualização PostgreSQL.
- `admin-support.js`: código do navegador. O `server.js` importa somente `admin-support-api.js`; isso evita o antigo erro de `localStorage` no servidor.
- `site-config.js`: endereço público da API. Se trocar de domínio da API, altere este arquivo na raiz e dentro de `public`.
- Nenhum login Google, recuperação de senha por e-mail ou autenticação de dois fatores foi incluído/rotulado como disponível nesta atualização.

## Validação realizada

19 testes automatizados passaram, incluindo integração local com PostgreSQL via PGlite: cadastro, perfil, carrinho, cupom, aprovação repetida, liberação de dois plugins, IP único, permissões administrativas, tickets, fechamento e suspensão após reembolso. Também foram validados os arquivos JavaScript e os links/recursos das dez páginas.

Os testes usam pagamentos e respostas de CAPTCHA simulados. O processamento real do Mercado Pago, o CAPTCHA no domínio e o download do seu JAR precisam ser conferidos após configurar e publicar. Os JARs não foram executados em Minecraft 1.21.

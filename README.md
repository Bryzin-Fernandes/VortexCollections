# Vortex Collections

Landing page profissional para venda do VortexKitPvP e VortexFeast.

## Próxima integração

- Backend deve criar preferência no Mercado Pago usando `MP_ACCESS_TOKEN` em variável de ambiente.
- O webhook do Mercado Pago deve aprovar o pedido, criar a licença e liberar o download na área do cliente.
- Após o webhook `approved`, gerar uma chave única por compra/produto, vincular ao usuário e mostrar na área do cliente. A chave também deve ser validada pelo plugin junto com o IP autorizado.
- `schema.sql` contém a base MySQL para usuários, produtos, compras, licenças, IPs autorizados e downloads.
- Nunca coloque o token do Mercado Pago em `index.html`, `app.js` ou qualquer arquivo enviado ao navegador.

## Rotas sugeridas

`POST /api/checkout` · `POST /api/mercadopago/webhook` · `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/me/licenses` · `GET /api/me/downloads` · `POST /api/licenses/:id/ip` · `GET /api/admin/orders`

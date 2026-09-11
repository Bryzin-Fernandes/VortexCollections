const ADMIN_API=window.Vortex.apiBase;
const token=window.Vortex.token();
const $=s=>document.querySelector(s);
const make=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n};
const req=(p,o={})=>window.Vortex.request(p,o);
const msg=t=>$('.portal-message').textContent=t;
function tableRow(title,meta,actions=[]){const row=make('article',undefined,'admin-row');const info=make('div');info.append(make('strong',title),make('small',meta));const buttons=make('div','', 'admin-row-actions');actions.forEach(a=>buttons.append(a));row.append(info,buttons);return row}
function button(text,callback,kind='btn-outline'){const b=make('button',text,'btn '+kind);b.type='button';b.addEventListener('click',callback);return b}
function activateTab(name){document.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===name));document.querySelectorAll('[data-admin-panel]').forEach(p=>p.classList.toggle('active',p.dataset.adminPanel===name));}
document.querySelectorAll('[data-admin-tab]').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.adminTab)));
document.querySelectorAll('[data-admin-jump]').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.adminJump)));

async function loadOverview(){const o=await req('/api/admin/overview');const box=$('#overview');box.replaceChildren();[['Usuários',o.users,'users'],['Licenças ativas',o.licenses,'licenses'],['Chamados abertos',o.tickets,'support'],['Cupons ativos',o.coupons,'commerce']].forEach(([label,value,tab])=>{const card=make('button',undefined,'admin-metric');card.type='button';card.addEventListener('click',()=>activateTab(tab));card.append(make('strong',String(value)),make('span',label));box.append(card)})}
async function loadUsers(){const list=await req('/api/admin/users');const box=$('#users');box.replaceChildren();if(!list.length){box.append(make('p','Nenhum usuário cadastrado.','admin-empty'));return}list.forEach(u=>{const edit=button('Editar',()=>{const f=$('#user-editor');f.elements.id.value=u.id;f.elements.display_id.value=u.id;f.elements.name.value=u.name;f.elements.email.value=u.email;f.elements.role.value=u.role;window.scrollTo({top:0,behavior:'smooth'})});const remove=button('Remover',async()=>{if(!confirm('Remover este usuário e todos os dados vinculados? Esta ação não pode ser desfeita.'))return;try{await req('/api/admin/users/'+u.id,{method:'DELETE'});msg('Usuário removido.');await Promise.all([loadUsers(),loadOverview()])}catch(e){msg(e.message)}},'btn-danger');box.append(tableRow('#'+u.id+' · '+u.name,u.email+' · '+u.role+' · '+u.licenses+' licença(s)',[edit,remove]))})}
async function loadLicenses(){const list=await req('/api/admin/licenses');const box=$('#licenses');box.replaceChildren();if(!list.length){box.append(make('p','Nenhuma licença cadastrada.','admin-empty'));return}list.forEach(l=>{const revoke=button('Revogar',async()=>{if(!confirm('Revogar esta licença?'))return;try{await req('/api/admin/licenses/'+l.id+'/revoke',{method:'POST'});msg('Licença revogada.');await Promise.all([loadLicenses(),loadOverview()])}catch(e){msg(e.message)}});const remove=button('Remover',async()=>{if(!confirm('Remover definitivamente esta licença? O pedido ficará cancelado no histórico.'))return;try{await req('/api/admin/licenses/'+l.id,{method:'DELETE'});msg('Licença removida.');await Promise.all([loadLicenses(),loadOverview()])}catch(e){msg(e.message)}},'btn-danger');box.append(tableRow('#'+l.id+' · '+l.product,l.email+' · cliente #'+l.user_id+' · '+l.status,[revoke,remove]))})}
async function loadCoupons(){const list=await req('/api/admin/coupons');const box=$('#coupons');box.replaceChildren();if(!list.length){box.append(make('p','Nenhum cupom cadastrado.','admin-empty'));return}list.forEach(c=>{const remove=button(c.active?'Desativar':'Desativado',async()=>{if(!c.active||!confirm('Desativar este cupom?'))return;try{await req('/api/admin/coupons/'+encodeURIComponent(c.code),{method:'DELETE'});msg('Cupom desativado.');await loadCoupons()}catch(e){msg(e.message)}},c.active?'btn-danger':'btn-outline');box.append(tableRow(c.code,(c.discount_type==='percent'?c.discount_value+'%':'R$ '+(c.discount_value/100).toFixed(2))+' · usos '+c.used_count+(c.active?' · ativo':' · inativo'),[remove]))})}
async function loadAgents(){const list=await req('/api/admin/support-agents');const box=$('#agents');box.replaceChildren();if(!list.length){box.append(make('p','Nenhum agente de suporte cadastrado.','admin-empty'));return}list.forEach(a=>{const remove=button('Remover',async()=>{if(!confirm('Remover este usuário da equipe de suporte?'))return;try{await req('/api/admin/support-agents/'+a.user_id,{method:'DELETE'});msg('Agente removido.');await loadAgents()}catch(e){msg(e.message)}},'btn-danger');box.append(tableRow(a.name,a.email+' · '+(a.active?'ativo':'inativo'),[remove]))})}

$('#grant').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const b=f.querySelector('button');b.disabled=true;try{await req('/api/admin/licenses',{method:'POST',body:JSON.stringify({user_id:Number(f.user_id.value),product:f.product.value})});f.reset();msg('Licença adicionada com sucesso.');await Promise.all([loadLicenses(),loadOverview()])}catch(x){msg(x.message)}finally{b.disabled=false}});
$('#coupon').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await req('/api/admin/coupons',{method:'POST',body:JSON.stringify({code:f.code.value,discount_type:f.discount_type.value,discount_value:Number(f.discount_value.value),max_uses:f.max_uses.value?Number(f.max_uses.value):null})});f.reset();msg('Cupom criado.');await Promise.all([loadCoupons(),loadOverview()])}catch(x){msg(x.message)}});
$('#agent').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await req('/api/admin/support-agents',{method:'POST',body:JSON.stringify({email:f.email.value})});f.reset();msg('Usuário adicionado à equipe.');await Promise.all([loadAgents(),loadOverview()])}catch(x){msg(x.message)}});
$('#user-editor').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;if(!f.elements.id.value)return msg('Clique em Editar em um usuário primeiro.');try{await req('/api/admin/users/'+f.elements.id.value,{method:'PATCH',body:JSON.stringify({name:f.elements.name.value,email:f.elements.email.value,role:f.elements.role.value})});msg('Usuário atualizado.');await loadUsers()}catch(x){msg(x.message)}});
$('#user-editor-clear').addEventListener('click',()=>$('#user-editor').reset());
$('#users-refresh').addEventListener('click',loadUsers);
window.loadVortexAdmin = () => Promise.all([loadOverview(),loadUsers(),loadLicenses(),loadCoupons(),loadAgents()]).catch(e=>msg(e.message));

(() => {
  const shell = document.querySelector('.admin-shell');
  const heading = shell?.querySelector('.admin-heading');
  if (!shell || !heading || shell.querySelector('[data-admin-status]')) return;
  const status = document.createElement('div');
  status.className = 'admin-statusbar';
  status.dataset.adminStatus = 'true';
  status.innerHTML = '<span class="admin-status-chip"><i></i>API protegida</span><span class="admin-status-chip">5 plugins ativos</span><span class="admin-status-chip">Minecraft 1.8–1.21</span><span class="admin-status-chip">CNPJ 66.004.874/0001-25</span>';
  heading.after(status);
  const overview = shell.querySelector('[data-admin-panel="overview"]');
  if (!overview || overview.querySelector('[data-admin-overview-info]')) return;
  const info = document.createElement('div');
  info.className = 'admin-overview-info';
  info.dataset.adminOverviewInfo = 'true';
  info.innerHTML = '<article class="admin-info-card">'+window.Vortex.icon('shield')+'<strong>Licenças protegidas</strong><span>Chave e IP único por produto.</span></article><article class="admin-info-card">'+window.Vortex.icon('cart')+'<strong>Mercado Pago</strong><span>Pedidos conferidos pela API.</span></article><article class="admin-info-card">'+window.Vortex.icon('settings')+'<strong>Catálogo atualizado</strong><span>Produtos de 1.8 até 1.21.</span></article><article class="admin-info-card">'+window.Vortex.icon('chat')+'<strong>Atendimento</strong><span>Tickets respondidos pela equipe.</span></article>';
  overview.append(info);
})();

(() => {
  const V=window.Vortex,form=document.getElementById('auth-form'),action=form.dataset.action,button=document.getElementById('auth-submit'),message=document.getElementById('auth-message');
  const rawNext=new URLSearchParams(location.search).get('next');
  const next=/^(cliente\.html(?:#[a-z]+)?|carrinho\.html|admin\.html|planos\.html)$/.test(rawNext || '')?rawNext:'cliente.html';
  document.querySelector('.auth-next-link').href+=( '?next='+encodeURIComponent(next));
  let config,widget,token='',busy=false;
  const status=(s,error=false)=>{message.textContent=s;message.className='message'+(error?' error':'');};
  const enable=()=>{button.disabled=busy || !config || !config.captcha_configured || (config.captcha_enabled && !token);};
  document.getElementById('show-password').onclick=e=>{const field=document.getElementById('password'),show=field.type==='password';field.type=show?'text':'password';e.currentTarget.textContent=show?'Ocultar':'Mostrar';e.currentTarget.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');};
  async function initialize(){
    try{
      config=await V.request('/api/auth/config');
      if(!config.captcha_configured){status('O acesso está sendo configurado. Entre em contato com a equipe pelo Discord.',true);return;}
      if(!config.captcha_enabled){document.getElementById('captcha-container').hidden=true;status('');enable();return;}
      await new Promise((resolve,reject)=>{if(window.turnstile)return resolve();const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.onload=resolve;s.onerror=reject;document.head.append(s);});
      widget=window.turnstile.render('#captcha-container',{sitekey:config.site_key,action,theme:document.documentElement.dataset.theme,size:'flexible',callback:value=>{token=value;status('');enable();},'expired-callback':()=>{token='';status('Verificação expirada. Aguarde uma nova validação.');enable();},'error-callback':()=>{token='';status('Não foi possível carregar o CAPTCHA. Recarregue a página.',true);enable();}});
      status('Conclua a verificação de segurança para continuar.');
    }catch(e){status(e.message || 'Não foi possível carregar a verificação. Recarregue a página.',true);}
  }
  form.onsubmit=async e=>{
    e.preventDefault();if(button.disabled)return;
    busy=true;enable();status('Conferindo seus dados…');
    const data=Object.fromEntries(new FormData(form));data.remember=form.elements.remember.checked;data.captcha_token=token;
    try{const result=await V.request('/api/auth/'+action,{method:'POST',body:JSON.stringify(data)});V.setSession(result.token,data.remember);location.href=next;}
    catch(e){status(e.message,true);token='';if(widget!==undefined)window.turnstile.reset(widget);busy=false;enable();}
  };
  initialize();
})();

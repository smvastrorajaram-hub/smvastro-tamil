(function(){
  const ta=document.documentElement.lang==='ta', t=(en,tamil)=>ta?tamil:en;
  document.addEventListener('input',event=>{if(event.target.closest?.('#dashboard,#admin'))event.target.setAttribute('data-smv-dirty','1');});
  document.addEventListener('change',event=>{if(event.target.closest?.('#dashboard,#admin'))event.target.setAttribute('data-smv-dirty','1');});
  const section=document.getElementById('smvInstallAppSection');
  const mode=window.matchMedia('(display-mode: standalone)');
  const full=window.matchMedia('(display-mode: fullscreen)');
  let installed=false;
  function syncInstall(){if(section)section.hidden=installed||mode.matches||full.matches||navigator.standalone===true;}
  syncInstall();mode.addEventListener?.('change',syncInstall);full.addEventListener?.('change',syncInstall);
  window.addEventListener('appinstalled',()=>{installed=true;syncInstall();});
  // Home owns the banner. Its parent visibility also hides it on internal routes.
  function addRefresh(rootId,id,action){
    const root=document.getElementById(rootId);if(!root||document.getElementById(id))return;
    const b=document.createElement('button');b.id=id;b.className='btn smv-refresh';b.type='button';b.textContent=t('Refresh','புதுப்பி');
    b.onclick=async()=>{b.disabled=true;try{await window[action]?.();}finally{b.disabled=false;b.textContent=t('Refresh','புதுப்பி');}};
    root.insertBefore(b,root.firstChild);
  }
  addRefresh('dashboard','smvRefreshDashboard','__smvRefreshDashboard');
  addRefresh('admin','smvRefreshAdmin','__smvRefreshAdmin');
  const admin=document.getElementById('admin');
  if(admin){
    const nav=document.createElement('nav');nav.className='smv-admin-nav';nav.setAttribute('aria-label',t('Admin sections','நிர்வாகப் பகுதிகள்'));
    for(const [id,en,tamil] of [['adminPendingQuestions','Questions & allocation','கேள்விகள் / ஒதுக்கீடு'],['adminAnswers','Answer approval','பதில் அங்கீகாரம்'],['adminRefunds','Refunds','பணத்திருப்பம்']]){
      const b=document.createElement('button');b.type='button';b.textContent=t(en,tamil);b.onclick=()=>document.getElementById(id)?.parentElement.scrollIntoView({behavior:'smooth',block:'start'});nav.append(b);
    }
    admin.insertBefore(nav,admin.firstChild);
  }
})();

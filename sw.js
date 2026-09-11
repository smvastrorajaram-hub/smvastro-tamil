const CACHE_NAME='smv-astro-ta-20260911c';
const APP_SHELL=['./index.html','./legacy.css?v=20260911c','./interface.css?v=20260911c','./interface.js?v=20260911c','./app.mjs?v=20260911c','./public-content.mjs?v=20260911c','./locale-ui.js?v=20260911c','./admin-workflows.mjs?v=20260911c','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('smv-astro-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(req.mode==='navigate'){
  event.respondWith(fetch(req,{cache:'no-cache'}).then(res=>{if(res.ok && (url.pathname.endsWith('/index.html')||url.pathname.endsWith('/'))){const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put('./index.html',copy));}return res;}).catch(()=>caches.match('./index.html')));return;
 }
 if(['image','style','script','font'].includes(req.destination)||url.pathname.endsWith('.webmanifest')){
  event.respondWith(fetch(req,{cache:'no-cache'}).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(req,copy));}return res;}).catch(()=>caches.match(req)));
 }
});

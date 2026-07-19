const CACHE='ebbinghaus-v11',URLS=['./','./index.html','./manifest.json','./icon.svg','./version.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(URLS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
// 导航请求（打开页面）永远拉最新 index.html（缓存破击 + no-store），
// 彻底避免「旧 SW 缓存 / CDN 旧缓存」导致 检测不一致 → 一直刷新 的死循环
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.mode==='navigate'){
    e.respondWith(fetch('./index.html?__sw='+Date.now(),{cache:'no-store'})
      .catch(()=>caches.match('./index.html').then(r=>r||caches.match('./'))));
    return;
  }
  // 其余资源：Network-First，离线回退缓存
  e.respondWith(fetch(req).then(res=>{if(res&&res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(req,c));}return res;}).catch(()=>caches.match(req)));
});

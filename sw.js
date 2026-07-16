const CACHE='ebbinghaus-v7',URLS=['./','./index.html','./manifest.json','./icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(URLS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))));self.clients.claim();});
// Network-First：网络优先，离线回退缓存
self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).then(res=>{if(res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(e.request,c));}return res;}).catch(()=>caches.match(e.request)));});

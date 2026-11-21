// 윤약국 약값 계산기 — 오프라인 캐시.
// 화면·계산 파일은 «네트워크 먼저, 안 되면 캐시»: 서버가 살아 있으면 항상 최신, 꺼져도 마지막 버전으로 열린다.
// 약 사진(pills/)은 복약지도 출력 때만 쓰므로 미리 받지 않고 본 것만 캐시한다.
const CACHE = 'yoon-calc-v2';
const CORE = [
  './', './index.html', './manifest.json', './css/prescription.css',
  './js/alpine.min.js', './js/fee_table.js', './js/calculator.js', './js/drug_db.js',
  './js/drug_db_hira.js', './js/eng2kor.js', './js/counseling_db.js', './js/pill_index.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});

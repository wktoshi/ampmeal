const CACHE_NAME = 'ampmeal-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// アプリからのSKIP_WAITINGメッセージを受信
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// インストール: キャッシュを作成（skipWaitingはメッセージ受信時に実行）
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// アクティベート: 古いキャッシュを削除して即座にコントロール取得
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // 開いているページを即座に新SWでコントロール
});

// フェッチ: ネットワークファースト（常に最新を取得、オフライン時のみキャッシュ）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Google API・OpenAI APIはキャッシュしない
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('maps.google.com') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // 静的アセットはネットワークファースト
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 正常なレスポンスはキャッシュに保存（次回オフライン時用）
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request) || caches.match('/index.html');
      })
  );
});

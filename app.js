'use strict';

// ===== 定数 =====
const STORAGE_KEY_APIKEY = 'ampmeal_api_key';
const NEARBY_RADIUS = 1000; // メートル
const MAX_RESULTS = 5;

// Places API タイプ → 日本語
const TYPE_LABEL = {
  japanese_restaurant: '和食',
  sushi_restaurant: '寿司',
  ramen_restaurant: 'ラーメン',
  chinese_restaurant: '中華',
  italian_restaurant: 'イタリアン',
  american_restaurant: 'アメリカン',
  indian_restaurant: 'インド料理',
  french_restaurant: 'フレンチ',
  korean_restaurant: '韓国料理',
  thai_restaurant: 'タイ料理',
  seafood_restaurant: '海鮮',
  steak_house: 'ステーキ',
  cafe: 'カフェ',
  bakery: 'ベーカリー',
  bar: 'バー',
  fast_food_restaurant: 'ファストフード',
  meal_takeaway: 'テイクアウト',
  restaurant: 'レストラン',
};

// ===== アプリ状態 =====
let userLocation = null;
let placesService = null;
let hiddenMap = null;
let visibleMap = null;
let mapMarkers = [];

// ===== DOM 参照 =====
const $ = (id) => document.getElementById(id);

const settingsBtn     = $('settingsBtn');
const settingsPanel   = $('settingsPanel');
const apiKeyInput     = $('apiKeyInput');
const saveApiKeyBtn   = $('saveApiKey');
const closeSettingsBtn = $('closeSettings');
const locationText    = $('locationText');
const searchBtn       = $('searchBtn');
const loading         = $('loading');
const errorBox        = $('errorBox');
const errorMsg        = $('errorMsg');
const retryBtn        = $('retryBtn');
const resultsEl       = $('results');
const resultsMap      = $('resultsMap');
const modalOverlay    = $('modalOverlay');
const modalClose      = $('modalClose');
const modalContent    = $('modalContent');

// ===== Service Worker 登録 =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.warn);
  });
}

// ===== API キー管理 =====
function getApiKey() {
  return localStorage.getItem(STORAGE_KEY_APIKEY) || '';
}

function saveApiKey(key) {
  localStorage.setItem(STORAGE_KEY_APIKEY, key.trim());
}

// ===== 設定パネル =====
settingsBtn.addEventListener('click', () => {
  apiKeyInput.value = getApiKey();
  settingsPanel.classList.remove('hidden');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

settingsPanel.addEventListener('click', (e) => {
  if (e.target === settingsPanel) settingsPanel.classList.add('hidden');
});

saveApiKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) { alert('API キーを入力してください。'); return; }
  saveApiKey(key);
  settingsPanel.classList.add('hidden');
  loadGoogleMapsAPI();
});

// ===== Google Maps API の動的読み込み =====
function loadGoogleMapsAPI() {
  const apiKey = getApiKey();
  if (!apiKey) return;

  const existing = document.querySelector('script[data-maps-api]');
  if (existing) existing.remove();

  const script = document.createElement('script');
  script.dataset.mapsApi = '1';
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=ja&callback=onMapsLoaded`;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

// Google Maps API ロード完了コールバック
window.onMapsLoaded = function () {
  const div = document.createElement('div');
  div.style.display = 'none';
  document.body.appendChild(div);
  hiddenMap = new google.maps.Map(div, { center: { lat: 0, lng: 0 }, zoom: 15 });
  placesService = new google.maps.places.PlacesService(hiddenMap);
};

// ===== 現在地取得 =====
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('このブラウザは位置情報に対応していません。'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const messages = {
          1: '位置情報の使用が拒否されました。設定から許可してください。',
          2: '位置情報を取得できませんでした。',
          3: '位置情報の取得がタイムアウトしました。',
        };
        reject(new Error(messages[err.code] || '位置情報の取得に失敗しました。'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// 逆ジオコーディング
function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng }, language: 'ja' }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const parts = [];
        for (const c of results[0].address_components) {
          if (c.types.includes('administrative_area_level_1')) parts.unshift(c.long_name);
          else if (c.types.includes('locality')) parts.push(c.long_name);
          else if (c.types.includes('sublocality_level_2')) parts.push(c.long_name);
        }
        resolve(parts.join(' ') || results[0].formatted_address);
      } else {
        resolve(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      }
    });
  });
}

// ===== 距離計算（Haversine）=====
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatDistance(m) {
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

// ===== 近くのレストランを検索 =====
function searchNearbyRestaurants(location) {
  return new Promise((resolve, reject) => {
    if (!placesService) {
      reject(new Error('Google Maps API が読み込まれていません。設定から API キーを確認してください。'));
      return;
    }
    placesService.nearbySearch(
      { location: new google.maps.LatLng(location.lat, location.lng), radius: NEARBY_RADIUS, type: 'restaurant', language: 'ja' },
      (places, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) resolve(places.slice(0, MAX_RESULTS));
        else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) resolve([]);
        else reject(new Error(`レストランの検索に失敗しました。(${status})`));
      }
    );
  });
}

// ===== Place Details 取得 =====
function getPlaceDetails(placeId) {
  return new Promise((resolve, reject) => {
    placesService.getDetails(
      {
        placeId,
        fields: ['name', 'opening_hours', 'formatted_phone_number', 'types', 'rating',
                 'user_ratings_total', 'geometry', 'price_level', 'editorial_summary',
                 'photos', 'vicinity'],
        language: 'ja',
      },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) resolve(place);
        else reject(new Error(`詳細情報の取得に失敗しました。(${status})`));
      }
    );
  });
}

// ===== 営業時間 =====
function formatOpeningHours(openingHours) {
  if (!openingHours?.weekday_text) return null;
  const today = new Date().getDay();
  return openingHours.weekday_text.map((text, i) => {
    const dayIndex = (i + 1) % 7;
    return { text, isToday: dayIndex === today };
  });
}

function getOpenStatus(openingHours) {
  if (!openingHours) return 'unknown';
  if (typeof openingHours.isOpen === 'function') return openingHours.isOpen() ? 'open' : 'closed';
  return 'unknown';
}

function getCuisineLabel(types) {
  for (const t of (types || [])) {
    if (TYPE_LABEL[t]) return TYPE_LABEL[t];
  }
  return 'レストラン';
}

// ===== 地図にピンを表示 =====
function showResultsMap(placesWithDist) {
  // 古いマーカーをクリア
  mapMarkers.forEach((m) => m.setMap(null));
  mapMarkers = [];

  resultsMap.classList.remove('hidden');

  visibleMap = new google.maps.Map(resultsMap, {
    center: { lat: userLocation.lat, lng: userLocation.lng },
    zoom: 15,
    disableDefaultUI: true,
    zoomControl: true,
    clickableIcons: false,
  });

  // 現在地マーカー（青い丸）
  new google.maps.Marker({
    position: { lat: userLocation.lat, lng: userLocation.lng },
    map: visibleMap,
    title: '現在地',
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: '#4A9FDB',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 3,
    },
    zIndex: 10,
  });

  // レストランマーカー
  placesWithDist.forEach(({ place, distance }, i) => {
    const lat = typeof place.geometry.location.lat === 'function'
      ? place.geometry.location.lat() : place.geometry.location.lat;
    const lng = typeof place.geometry.location.lng === 'function'
      ? place.geometry.location.lng() : place.geometry.location.lng;

    const marker = new google.maps.Marker({
      position: { lat, lng },
      map: visibleMap,
      title: place.name,
      label: { text: String(i + 1), color: '#fff', fontWeight: 'bold', fontSize: '13px' },
    });
    marker.addListener('click', () => showDetail(place, distance));
    mapMarkers.push(marker);
  });
}

// ===== UI ヘルパー =====
function showLoading(show) { loading.classList.toggle('hidden', !show); }
function showError(msg) { errorMsg.textContent = msg; errorBox.classList.remove('hidden'); }
function hideError() { errorBox.classList.add('hidden'); }
function clearResults() { resultsEl.innerHTML = ''; resultsMap.classList.add('hidden'); }

// ===== レストランカードを生成 =====
function createRestaurantCard(place, distance, index) {
  const openStatus = getOpenStatus(place.opening_hours);
  const cuisine = getCuisineLabel(place.types);
  const hoursData = formatOpeningHours(place.opening_hours);

  const card = document.createElement('div');
  card.className = 'restaurant-card';

  // 写真 URL
  const photoUrl = place.photos?.[0]?.getUrl({ maxWidth: 600, maxHeight: 200 });

  const statusBadge = openStatus === 'open'
    ? `<span class="badge badge-open">✅ 営業中</span>`
    : openStatus === 'closed'
      ? `<span class="badge badge-closed">🔴 営業時間外</span>`
      : `<span class="badge badge-unknown">⏰ 時間不明</span>`;

  let todayHours = '';
  if (hoursData) {
    const today = hoursData.find((h) => h.isToday);
    if (today) {
      const parts = today.text.split(': ');
      todayHours = parts[1] || today.text;
    }
  }

  card.innerHTML = `
    ${photoUrl
      ? `<img class="card-photo" src="${photoUrl}" alt="${escapeHtml(place.name)}" loading="lazy">`
      : `<div class="card-photo-placeholder">🍽️</div>`}
    <div class="card-number">${index + 1}</div>
    <div class="restaurant-card-header">
      <p class="restaurant-name">${escapeHtml(place.name)}</p>
      <div class="restaurant-meta">
        ${place.rating ? `<span class="badge badge-rating">⭐ ${place.rating}</span>` : ''}
        <span class="badge badge-distance">📍 ${formatDistance(distance)}</span>
        ${statusBadge}
        <span class="badge badge-unknown">${escapeHtml(cuisine)}</span>
      </div>
    </div>
    <div class="restaurant-card-body">
      <div class="info-row">
        <span class="info-icon">🕐</span>
        <span class="info-text">
          ${todayHours ? `<strong>本日：</strong>${escapeHtml(todayHours)}` : '営業時間情報なし'}
        </span>
      </div>
    </div>
    <div class="detail-btn">詳細・AI解説を見る →</div>
  `;

  card.addEventListener('click', () => showDetail(place, distance));
  return card;
}

// ===== 詳細モーダルを表示 =====
async function showDetail(place, distance) {
  modalContent.innerHTML = '<div class="loading"><div class="spinner"></div><p>詳細を読み込み中...</p></div>';
  $('modalOverlay').classList.remove('hidden');

  try {
    const detail = await getPlaceDetails(place.place_id);
    renderModalContent(detail, distance);
  } catch (e) {
    renderModalContent(place, distance);
  }
}

function renderModalContent(detail, distance) {
  const openStatus = getOpenStatus(detail.opening_hours);
  const cuisine = getCuisineLabel(detail.types);
  const hoursData = formatOpeningHours(detail.opening_hours);
  const lat = typeof detail.geometry?.location?.lat === 'function'
    ? detail.geometry.location.lat() : detail.geometry?.location?.lat;
  const lng = typeof detail.geometry?.location?.lng === 'function'
    ? detail.geometry.location.lng() : detail.geometry?.location?.lng;

  const statusLabel = openStatus === 'open' ? '✅ 営業中'
    : openStatus === 'closed' ? '🔴 営業時間外' : '⏰ 時間不明';

  const photoUrl = detail.photos?.[0]?.getUrl({ maxWidth: 800, maxHeight: 300 });

  let hoursHtml = '';
  if (hoursData?.length) {
    hoursHtml = `<ul class="hours-list">${hoursData.map((h) =>
      `<li class="${h.isToday ? 'today' : ''}">${escapeHtml(h.text)}</li>`
    ).join('')}</ul>`;
  } else {
    hoursHtml = '<p class="info-text">営業時間の情報がありません。</p>';
  }

  const mapUrl = lat && lng
    ? `https://maps.google.com/?q=${lat},${lng}`
    : `https://maps.google.com/?q=${encodeURIComponent(detail.name)}`;

  modalContent.innerHTML = `
    ${photoUrl ? `<img class="modal-photo" src="${photoUrl}" alt="${escapeHtml(detail.name)}" loading="lazy">` : ''}
    <h2>${escapeHtml(detail.name)}</h2>
    <div class="restaurant-meta" style="margin:8px 0 0">
      ${detail.rating ? `<span class="badge badge-rating">⭐ ${detail.rating}（${detail.user_ratings_total || '?'}件）</span>` : ''}
      <span class="badge badge-distance">📍 ${formatDistance(distance)}</span>
      <span class="badge badge-unknown">${escapeHtml(cuisine)}</span>
    </div>

    <div class="modal-section">
      <h3>✨ AI解説</h3>
      <div class="ai-box">
        <div id="aiRecommendSection" class="ai-loading">
          <div class="spinner"></div>
          <span>AIが解説を生成中...</span>
        </div>
      </div>
    </div>

    <div class="modal-section">
      <h3>⏰ 営業時間</h3>
      <p style="font-size:0.85rem;font-weight:600;margin-bottom:6px;">${statusLabel}</p>
      ${hoursHtml}
    </div>

    ${detail.formatted_phone_number
      ? `<div class="modal-section">
          <h3>📞 電話番号</h3>
          <a href="tel:${detail.formatted_phone_number}" style="color:var(--primary);font-size:0.9rem;">${escapeHtml(detail.formatted_phone_number)}</a>
        </div>`
      : ''}

    <a href="${mapUrl}" target="_blank" rel="noopener" class="map-btn">
      🗺️ Google マップで開く
    </a>
  `;

  // AI解説を非同期で取得
  fetchAIRecommendation(detail);
}

// ===== AI解説の取得 =====
async function fetchAIRecommendation(detail) {
  const section = $('aiRecommendSection');
  if (!section) return;

  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: detail.name,
        types: detail.types,
        rating: detail.rating,
        vicinity: detail.vicinity || '',
        priceLevel: detail.price_level,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.recommendation) {
      section.className = '';
      section.innerHTML = `<p class="ai-recommendation">${escapeHtml(data.recommendation)}</p>`;
    } else {
      throw new Error('empty');
    }
  } catch {
    if (section) {
      section.className = '';
      section.innerHTML = '<p class="info-text" style="font-size:0.85rem;">AI解説を取得できませんでした。</p>';
    }
  }
}

// モーダルを閉じる
$('modalClose').addEventListener('click', () => $('modalOverlay').classList.add('hidden'));
$('modalOverlay').addEventListener('click', (e) => {
  if (e.target === $('modalOverlay')) $('modalOverlay').classList.add('hidden');
});

// ===== メイン検索フロー =====
async function doSearch() {
  hideError();
  clearResults();

  if (!getApiKey()) {
    showError('API キーが設定されていません。右上の⚙️ボタンから設定してください。');
    return;
  }

  showLoading(true);
  searchBtn.disabled = true;

  try {
    locationText.textContent = '現在地を取得中...';
    userLocation = await getCurrentLocation();

    if (typeof google !== 'undefined') {
      locationText.textContent = await reverseGeocode(userLocation.lat, userLocation.lng);
    } else {
      locationText.textContent = `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
    }

    const places = await searchNearbyRestaurants(userLocation);
    showLoading(false);

    if (places.length === 0) {
      resultsEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🍽️</div>
          <p>半径${NEARBY_RADIUS}m以内にレストランが見つかりませんでした。<br>場所を変えてもう一度お試しください。</p>
        </div>`;
      return;
    }

    // 距離を計算
    const placesWithDist = places.map((place) => {
      const lat = typeof place.geometry.location.lat === 'function'
        ? place.geometry.location.lat() : place.geometry.location.lat;
      const lng = typeof place.geometry.location.lng === 'function'
        ? place.geometry.location.lng() : place.geometry.location.lng;
      return { place, distance: calcDistance(userLocation.lat, userLocation.lng, lat, lng) };
    });

    // 地図を表示
    showResultsMap(placesWithDist);

    // カードを生成
    placesWithDist.forEach(({ place, distance }, i) => {
      resultsEl.appendChild(createRestaurantCard(place, distance, i));
    });

  } catch (err) {
    showLoading(false);
    showError(err.message || '予期せぬエラーが発生しました。');
  } finally {
    searchBtn.disabled = false;
  }
}

searchBtn.addEventListener('click', doSearch);
retryBtn.addEventListener('click', doSearch);

// ===== XSS 対策 =====
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== 起動時処理 =====
(function init() {
  const key = getApiKey();
  if (key) loadGoogleMapsAPI();
  else locationText.textContent = '設定から API キーを入力してください';
})();

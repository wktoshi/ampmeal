'use strict';

// ===== 定数 =====
const STORAGE_KEY_APIKEY = 'ampmeal_api_key';
const NEARBY_RADIUS = 1000; // メートル
const MAX_RESULTS = 5;

// レストランの種類別おすすめメニュー（日本語ラベル）
const CUISINE_MENU_MAP = {
  japanese_restaurant: ['刺身盛り合わせ', '天ぷら定食', 'うな重', '懐石料理'],
  sushi_restaurant: ['おまかせにぎり', '特上寿司', '海鮮丼', 'ちらし寿司'],
  ramen_restaurant: ['濃厚醤油ラーメン', '豚骨ラーメン', '味噌ラーメン', 'つけ麺'],
  chinese_restaurant: ['麻婆豆腐', '北京ダック', '点心セット', '炒飯'],
  italian_restaurant: ['カルボナーラ', 'マルゲリータピザ', 'ボンゴレビアンコ', 'ティラミス'],
  american_restaurant: ['アンガスバーガー', 'BBQリブ', 'クラムチャウダー', 'NYチーズケーキ'],
  indian_restaurant: ['バターチキンカレー', 'ナン', 'タンドリーチキン', 'マサラチャイ'],
  french_restaurant: ['フォアグラのソテー', 'ブフブルギニョン', 'クレームブリュレ', 'エスカルゴ'],
  korean_restaurant: ['サムギョプサル', 'ビビンバ', 'チャプチェ', 'チヂミ'],
  thai_restaurant: ['パッタイ', 'トムヤムクン', 'グリーンカレー', 'カオマンガイ'],
  seafood_restaurant: ['活き造り', 'ロブスター', '魚介のグリル', 'ブイヤベース'],
  steak_house: ['サーロインステーキ', 'リブアイ', 'フィレミニョン', 'Tボーンステーキ'],
  cafe: ['シグネチャーラテ', 'アボカドトースト', 'スフレパンケーキ', 'クロワッサン'],
  bakery: ['クロワッサン', '食パン', 'デニッシュ', 'シュークリーム'],
  bar: ['クラフトビール', 'ハイボール', 'カクテル', 'おつまみ盛り合わせ'],
  fast_food_restaurant: ['ハンバーガーセット', 'フライドポテト', 'チキンナゲット', 'アップルパイ'],
  meal_takeaway: ['日替わり弁当', '唐揚げ弁当', 'のり弁当', 'サンドイッチ'],
  restaurant: ['本日のおすすめ', 'シェフズスペシャル', '季節の一品', 'デザートセット'],
};

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

// 曜日ラベル（日本語）
const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

// ===== アプリ状態 =====
let userLocation = null;
let placesService = null;
let map = null;

// ===== DOM 参照 =====
const $ = (id) => document.getElementById(id);

const settingsBtn = $('settingsBtn');
const settingsPanel = $('settingsPanel');
const apiKeyInput = $('apiKeyInput');
const saveApiKeyBtn = $('saveApiKey');
const closeSettingsBtn = $('closeSettings');
const locationText = $('locationText');
const searchBtn = $('searchBtn');
const loading = $('loading');
const errorBox = $('errorBox');
const errorMsg = $('errorMsg');
const retryBtn = $('retryBtn');
const results = $('results');
const modalOverlay = $('modalOverlay');
const modal = $('modal');
const modalClose = $('modalClose');
const modalContent = $('modalContent');

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
  if (!key) {
    alert('API キーを入力してください。');
    return;
  }
  saveApiKey(key);
  settingsPanel.classList.add('hidden');
  // Google Maps API を再読み込み
  loadGoogleMapsAPI();
});

// ===== Google Maps API の動的読み込み =====
function loadGoogleMapsAPI() {
  const apiKey = getApiKey();
  if (!apiKey) return;

  // 既存スクリプトを削除
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
  // 非表示の地図を作成（Places サービスに必要）
  const mapDiv = document.createElement('div');
  mapDiv.style.display = 'none';
  document.body.appendChild(mapDiv);
  map = new google.maps.Map(mapDiv, { center: { lat: 0, lng: 0 }, zoom: 15 });
  placesService = new google.maps.places.PlacesService(map);
  console.log('Google Maps API 読み込み完了');
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

// 座標から住所を取得（逆ジオコーディング）
function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng }, language: 'ja' }, (results, status) => {
      if (status === 'OK' && results[0]) {
        // 都道府県 + 市区町村 + 丁目まで
        const components = results[0].address_components;
        const parts = [];
        for (const c of components) {
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
    const request = {
      location: new google.maps.LatLng(location.lat, location.lng),
      radius: NEARBY_RADIUS,
      type: 'restaurant',
      language: 'ja',
    };
    placesService.nearbySearch(request, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK) {
        resolve(results.slice(0, MAX_RESULTS));
      } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        resolve([]);
      } else {
        reject(new Error(`レストランの検索に失敗しました。(${status})`));
      }
    });
  });
}

// ===== Place Details 取得 =====
function getPlaceDetails(placeId) {
  return new Promise((resolve, reject) => {
    const request = {
      placeId,
      fields: ['name', 'opening_hours', 'formatted_phone_number', 'website', 'reviews', 'types', 'rating', 'user_ratings_total', 'geometry', 'price_level', 'editorial_summary'],
      language: 'ja',
    };
    placesService.getDetails(request, (place, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK) {
        resolve(place);
      } else {
        reject(new Error(`詳細情報の取得に失敗しました。(${status})`));
      }
    });
  });
}

// ===== 営業時間フォーマット =====
function formatOpeningHours(openingHours) {
  if (!openingHours || !openingHours.weekday_text) return null;
  const today = new Date().getDay();
  return openingHours.weekday_text.map((text, i) => {
    // Google は月曜始まり（0=月）、JS は日曜始まり（0=日）
    const dayIndex = (i + 1) % 7; // 0=日, 1=月 ... 6=土
    return { text, isToday: dayIndex === today };
  });
}

function getOpenStatus(openingHours) {
  if (!openingHours) return 'unknown';
  if (typeof openingHours.isOpen === 'function') {
    return openingHours.isOpen() ? 'open' : 'closed';
  }
  return 'unknown';
}

// ===== おすすめメニュー取得 =====
function getRecommendedMenu(types) {
  for (const type of (types || [])) {
    if (CUISINE_MENU_MAP[type]) return CUISINE_MENU_MAP[type];
  }
  return CUISINE_MENU_MAP.restaurant;
}

function getCuisineLabel(types) {
  for (const type of (types || [])) {
    if (TYPE_LABEL[type]) return TYPE_LABEL[type];
  }
  return 'レストラン';
}

// ===== UI ヘルパー =====
function showLoading(show) {
  loading.classList.toggle('hidden', !show);
}

function showError(message) {
  errorMsg.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}

function clearResults() {
  results.innerHTML = '';
}

// ===== レストランカードを生成 =====
function createRestaurantCard(place, distance) {
  const openStatus = getOpenStatus(place.opening_hours);
  const menu = getRecommendedMenu(place.types);
  const cuisine = getCuisineLabel(place.types);
  const hoursData = formatOpeningHours(place.opening_hours);

  const card = document.createElement('div');
  card.className = 'restaurant-card';

  // 営業中バッジ
  const statusBadge = openStatus === 'open'
    ? `<span class="badge badge-open">✅ 営業中</span>`
    : openStatus === 'closed'
      ? `<span class="badge badge-closed">🔴 営業時間外</span>`
      : `<span class="badge badge-unknown">⏰ 時間不明</span>`;

  // 今日の営業時間
  let todayHours = '';
  if (hoursData) {
    const today = hoursData.find((h) => h.isToday);
    if (today) {
      const parts = today.text.split(': ');
      todayHours = parts[1] || today.text;
    }
  }

  card.innerHTML = `
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
      ${todayHours
        ? `<div class="info-row">
            <span class="info-icon">🕐</span>
            <span class="info-text"><strong>本日：</strong>${escapeHtml(todayHours)}</span>
          </div>`
        : `<div class="info-row">
            <span class="info-icon">🕐</span>
            <span class="info-text">営業時間情報なし</span>
          </div>`
      }
      <div class="info-row">
        <span class="info-icon">🍴</span>
        <span class="info-text"><strong>おすすめ：</strong></span>
      </div>
      <div class="menu-tags">
        ${menu.slice(0, 3).map((item) => `<span class="menu-tag">${escapeHtml(item)}</span>`).join('')}
      </div>
    </div>
    <div class="detail-btn">詳細を見る →</div>
  `;

  card.addEventListener('click', () => showDetail(place, distance));
  return card;
}

// ===== 詳細モーダルを表示 =====
async function showDetail(place, distance) {
  modalContent.innerHTML = '<div class="loading"><div class="spinner"></div><p>詳細を読み込み中...</p></div>';
  modalOverlay.classList.remove('hidden');

  try {
    const detail = await getPlaceDetails(place.place_id);
    renderModalContent(detail, distance);
  } catch (e) {
    // Nearby Search の情報でフォールバック
    renderModalContent(place, distance);
  }
}

function renderModalContent(detail, distance) {
  const openStatus = getOpenStatus(detail.opening_hours);
  const menu = getRecommendedMenu(detail.types);
  const cuisine = getCuisineLabel(detail.types);
  const hoursData = formatOpeningHours(detail.opening_hours);
  const lat = detail.geometry?.location?.lat?.() ?? detail.geometry?.location?.lat;
  const lng = detail.geometry?.location?.lng?.() ?? detail.geometry?.location?.lng;

  const statusLabel = openStatus === 'open' ? '✅ 営業中' : openStatus === 'closed' ? '🔴 営業時間外' : '⏰ 時間不明';

  let hoursHtml = '';
  if (hoursData && hoursData.length) {
    hoursHtml = `
      <ul class="hours-list">
        ${hoursData.map((h) => `<li class="${h.isToday ? 'today' : ''}">${escapeHtml(h.text)}</li>`).join('')}
      </ul>
    `;
  } else {
    hoursHtml = '<p class="info-text">営業時間の情報がありません。</p>';
  }

  const mapUrl = lat && lng
    ? `https://maps.google.com/?q=${lat},${lng}`
    : `https://maps.google.com/?q=${encodeURIComponent(detail.name)}`;

  modalContent.innerHTML = `
    <h2>${escapeHtml(detail.name)}</h2>
    <div class="restaurant-meta" style="margin:8px 0 0">
      ${detail.rating ? `<span class="badge badge-rating">⭐ ${detail.rating}（${detail.user_ratings_total || '?'}件）</span>` : ''}
      <span class="badge badge-distance">📍 ${formatDistance(distance)}</span>
      <span class="badge badge-unknown">${escapeHtml(cuisine)}</span>
    </div>
    ${detail.editorial_summary?.overview
      ? `<p style="margin-top:12px;font-size:0.875rem;color:#555;line-height:1.5;">${escapeHtml(detail.editorial_summary.overview)}</p>`
      : ''}

    <div class="modal-section">
      <h3>⏰ 営業時間</h3>
      <p style="font-size:0.85rem;font-weight:600;margin-bottom:6px;">${statusLabel}</p>
      ${hoursHtml}
    </div>

    <div class="modal-section">
      <h3>🍴 おすすめメニュー</h3>
      <div class="menu-tags">
        ${menu.map((item) => `<span class="menu-tag">${escapeHtml(item)}</span>`).join('')}
      </div>
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
}

// モーダルを閉じる
modalClose.addEventListener('click', () => modalOverlay.classList.add('hidden'));
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
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
    // 1. 現在地取得
    locationText.textContent = '現在地を取得中...';
    userLocation = await getCurrentLocation();

    // 2. 住所を逆ジオコーディング（Google Maps API が使えない場合は座標表示）
    if (typeof google !== 'undefined') {
      const addr = await reverseGeocode(userLocation.lat, userLocation.lng);
      locationText.textContent = addr;
    } else {
      locationText.textContent = `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
    }

    // 3. 近くのレストランを検索
    const places = await searchNearbyRestaurants(userLocation);

    showLoading(false);

    if (places.length === 0) {
      results.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🍽️</div>
          <p>半径${NEARBY_RADIUS}m以内にレストランが見つかりませんでした。<br>場所を変えてもう一度お試しください。</p>
        </div>
      `;
      return;
    }

    // 4. 距離を計算してカードを生成
    for (const place of places) {
      const lat = typeof place.geometry.location.lat === 'function'
        ? place.geometry.location.lat()
        : place.geometry.location.lat;
      const lng = typeof place.geometry.location.lng === 'function'
        ? place.geometry.location.lng()
        : place.geometry.location.lng;
      const dist = calcDistance(userLocation.lat, userLocation.lng, lat, lng);
      results.appendChild(createRestaurantCard(place, dist));
    }
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
  if (key) {
    loadGoogleMapsAPI();
  } else {
    locationText.textContent = '設定から API キーを入力してください';
  }
})();

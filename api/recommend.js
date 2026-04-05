export default async function handler(req, res) {
  // CORS ヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY が設定されていません' });
  }

  const { name, types, rating, vicinity, priceLevel } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'name は必須です' });
  }

  const cuisine = getCuisineLabel(types);
  const priceStr = priceLevel ? '¥'.repeat(Number(priceLevel)) : '';

  const prompt = `あなたはグルメガイドのライターです。以下のレストラン情報をもとに、訪問者へのおすすめポイントを自然な日本語で2〜3文（100文字以内）で書いてください。メニューの特徴、雰囲気、おすすめの利用シーンなどを含めてください。

レストラン名: ${name}
ジャンル: ${cuisine}
評価: ${rating ? `${rating}点` : '不明'}
価格帯: ${priceStr || '不明'}
場所: ${vicinity || '不明'}

返答は説明文のみ（箇条書きや見出しなし）でお願いします。`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'AI API error' });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    return res.json({ recommendation: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function getCuisineLabel(types) {
  const TYPE_LABEL = {
    japanese_restaurant: '和食', sushi_restaurant: '寿司',
    ramen_restaurant: 'ラーメン', chinese_restaurant: '中華',
    italian_restaurant: 'イタリアン', american_restaurant: 'アメリカン',
    indian_restaurant: 'インド料理', french_restaurant: 'フレンチ',
    korean_restaurant: '韓国料理', thai_restaurant: 'タイ料理',
    seafood_restaurant: '海鮮', steak_house: 'ステーキ',
    cafe: 'カフェ', bakery: 'ベーカリー', bar: 'バー',
    fast_food_restaurant: 'ファストフード', meal_takeaway: 'テイクアウト',
    restaurant: 'レストラン',
  };
  for (const t of (types || [])) {
    if (TYPE_LABEL[t]) return TYPE_LABEL[t];
  }
  return 'レストラン';
}

/**
 * 童年时光机 · Cloudflare Worker
 *
 * 部署方式：
 *   1. 注册 Cloudflare 账号 (free)
 *   2. 安装 wrangler: npm install -g wrangler
 *   3. 登录: wrangler login
 *   4. 设置环境变量: wrangler secret put HF_TOKEN
 *   5. 部署: wrangler deploy
 *
 * HF_TOKEN 从 https://huggingface.co/settings/tokens 获取（免费）
 *
 * 之后在 index.html 顶部修改 WORKER_URL 为你的 Worker 地址
 */

// 不同年代的风格化 prompt
const ERA_PROMPTS = {
  '1970': {
    prompt: 'A cute child portrait, turning this person into a 6-year-old version of themselves, big innocent eyes, smooth baby skin, round chubby cheeks, soft natural lighting, cute expression, childhood photo style, adorable',
    negative: 'old face, wrinkles, aged skin, blemishes, facial hair, makeup, adult features, sharp features, double chin, glasses',
  },
  '1980': {
    prompt: 'A cute child portrait, same person as a 7-year-old, big bright eyes, smooth youthful skin, round cheeks, warm nostalgic tones, childhood photo, adorable expression, soft focus, cute',
    negative: 'old face, wrinkles, aged skin, blemishes, adult, makeup, facial hair, sharp jawline, glasses, beard',
  },
  '1990': {
    prompt: 'A cute child portrait, make this person look like a happy 7-year-old child, big sparkling eyes, smooth baby skin, chubby cute cheeks, vibrant colors, childhood memory photo, adorable, innocent smile',
    negative: 'old, wrinkled, aged, adult features, makeup, facial hair, blemishes, dark circles, tired eyes, sharp features',
  },
  '2000': {
    prompt: 'A cute child portrait, transform this person into an adorable 6-year-old child, same face features but younger, big bright eyes, soft smooth skin, round face, cute smile, bright natural lighting, childhood photo',
    negative: 'old, aged, adult, wrinkles, makeup, facial hair, blemishes, tired, sharp features, long face',
  },
  '2010': {
    prompt: 'A cute child portrait, this person as a lovely 7-year-old child, big clear eyes, smooth baby-like skin, round cute cheeks, happy expression, bright colors, modern childhood photo, adorable',
    negative: 'old, aged, adult, wrinkles, makeup, facial hair, blemishes, tired eyes, sharp jawline, glasses',
  },
};

const DEFAULT_PROMPT = ERA_PROMPTS['1990'];

export default {
  async fetch(request, env) {
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Only POST allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    try {
      const { image, era } = await request.json();
      if (!image) {
        return new Response(JSON.stringify({ error: 'Missing image' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const eraData = ERA_PROMPTS[era] || DEFAULT_PROMPT;
      const hfToken = env.HF_TOKEN;

      if (!hfToken) {
        return new Response(JSON.stringify({ error: 'HF_TOKEN not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Convert base64 to binary
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

      // Call HuggingFace Inference API
      const formData = new FormData();
      formData.append('inputs', eraData.prompt);
      formData.append('image', new Blob([imageBytes], { type: 'image/jpeg' }), 'photo.jpg');
      formData.append('parameters', JSON.stringify({
        negative_prompt: eraData.negative,
        guidance_scale: 7.5,
        num_inference_steps: 30,
        strength: 0.78,
        seed: Math.floor(Math.random() * 2147483647),
      }));

      const hfResponse = await fetch(
        'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2-1',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
          },
          body: formData,
        }
      );

      if (!hfResponse.ok) {
        const errorText = await hfResponse.text();
        // Model might be loading - HF returns 503 with "loading" message
        if (hfResponse.status === 503 && errorText.includes('loading')) {
          return new Response(JSON.stringify({
            error: 'model_loading',
            message: '模型正在加载中，请稍后再试（首次使用需要约1分钟加载）',
            estimated_time: JSON.parse(errorText).estimated_time || 60,
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
        return new Response(JSON.stringify({ error: 'HF API error', detail: errorText }), {
          status: hfResponse.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Return the generated image
      const contentType = hfResponse.headers.get('content-type') || 'image/jpeg';
      return new Response(hfResponse.body, {
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};

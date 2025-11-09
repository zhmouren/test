import { checkRateLimit } from '../lib/security';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // 速率限制检查
  const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateLimitResult = await checkRateLimit(
    context.env.RATE_LIMIT_KV,
    `r2:${ip}`,
    context.env.RATE_LIMIT_REQUESTS || 50,
    context.env.RATE_LIMIT_WINDOW_MS || 60000
  );
  
  if (!rateLimitResult.allowed) {
    return new Response('请求过于频繁，请稍后再试', { status: 429 });
  }
  
  // key 形如 encodeURIComponent(a)___encodeURIComponent(b)___encodeURIComponent(c)
  let key = context.params.key as string;
  key = key.split('___').map(decodeURIComponent).join('/');
  
  // 防止路径遍历攻击 - 立即返回错误而不是继续处理
  if (key.includes('../') || key.includes('..\\') || key.startsWith('/')) {
    return new Response('无效的文件路径', { status: 400 });
  }
  
  const obj = await context.env.R2.get(key);
  if (!obj) return new Response('未找到', { status: 404 });

  // 获取查询参数
  const url = new URL(context.request.url);
  const width = url.searchParams.get('width');
  const height = url.searchParams.get('height');
  const quality = url.searchParams.get('quality') || '80';
  const isVideo = obj.httpMetadata?.contentType?.startsWith('video/');

  let responseInit = {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000'
    }
  };

  // 如果有尺寸参数且是图片，则使用 Cloudflare Image Resizing
  if ((width || height) && obj.httpMetadata?.contentType?.startsWith('image/')) {
    responseInit.headers['content-type'] = obj.httpMetadata.contentType;
    return new Response(obj.body, responseInit);
  }

  // 如果是视频请求缩略图但未提供，返回默认提示
  if ((width || height) && isVideo) {
    return new Response(
      JSON.stringify({
        error: '视频缩略图需要额外处理，当前系统不支持直接生成视频缩略图',
        suggestion: '请考虑使用第三方视频处理服务或在前端使用默认占位图'
      }),
      {
        status: 400,
        headers: {
          'content-type': 'application/json'
        }
      }
    );
  }

  return new Response(obj.body, responseInit);
};
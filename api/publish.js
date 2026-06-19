// api/publish.js
// Backend serverless para Vercel - Publica en Instagram y Facebook via Meta Graph API
// Este archivo resuelve el problema de CORS llamando a la API de Meta desde el servidor

export default async function handler(req, res) {
  // Permitir CORS desde tu app AutoPost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { action, mediaUrl, caption, accessToken, igAccountId, pageId, appId, appSecret } = req.body;

  try {
    // ── Acción: Publicar en Instagram ──
    if (action === 'publish_instagram') {
      const isVideo = /\.(mp4|mov|avi)$/i.test(mediaUrl);
      const mediaType = isVideo ? 'REELS' : 'IMAGE';
      const bodyParam = isVideo ? { video_url: mediaUrl } : { image_url: mediaUrl };

      // Paso 1: crear contenedor de media
      const createRes = await fetch(`https://graph.facebook.com/v21.0/${igAccountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bodyParam, caption, media_type: mediaType, access_token: accessToken })
      });
      const createData = await createRes.json();

      if (!createData.id) {
        return res.status(400).json({ success: false, error: createData.error?.message || 'Error creando contenedor' });
      }

      // Si es video, esperar a que Meta lo procese
      if (isVideo) {
        let status = 'IN_PROGRESS';
        let attempts = 0;
        while (status === 'IN_PROGRESS' && attempts < 20) {
          await new Promise(r => setTimeout(r, 3000));
          const statusRes = await fetch(`https://graph.facebook.com/v21.0/${createData.id}?fields=status_code&access_token=${accessToken}`);
          const statusData = await statusRes.json();
          status = statusData.status_code;
          attempts++;
        }
        if (status !== 'FINISHED') {
          return res.status(400).json({ success: false, error: 'El video no terminó de procesarse en Instagram' });
        }
      }

      // Paso 2: publicar el contenedor
      const publishRes = await fetch(`https://graph.facebook.com/v21.0/${igAccountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: createData.id, access_token: accessToken })
      });
      const publishData = await publishRes.json();

      if (publishData.id) {
        return res.status(200).json({ success: true, postId: publishData.id });
      } else {
        return res.status(400).json({ success: false, error: publishData.error?.message || 'Error publicando' });
      }
    }

    // ── Acción: Publicar en Facebook ──
    if (action === 'publish_facebook') {
      const isVideo = /\.(mp4|mov|avi)$/i.test(mediaUrl);
      const endpoint = isVideo ? 'videos' : 'photos';
      const bodyParam = isVideo ? { file_url: mediaUrl } : { url: mediaUrl };

      const fbRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bodyParam, description: caption, access_token: accessToken })
      });
      const fbData = await fbRes.json();

      if (fbData.id) {
        return res.status(200).json({ success: true, postId: fbData.id });
      } else {
        return res.status(400).json({ success: false, error: fbData.error?.message || 'Error publicando' });
      }
    }

    // ── Acción: Convertir token a larga duración ──
    if (action === 'exchange_token') {
      const url = `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${accessToken}`;
      const tokenRes = await fetch(url);
      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        return res.status(200).json({ success: true, accessToken: tokenData.access_token, expiresIn: tokenData.expires_in });
      } else {
        return res.status(400).json({ success: false, error: tokenData.error?.message || 'Error convirtiendo token' });
      }
    }

    // ── Acción: Obtener ID de Instagram desde la página ──
    if (action === 'get_ig_id') {
      const url = `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`;
      const igRes = await fetch(url);
      const igData = await igRes.json();

      if (igData.instagram_business_account?.id) {
        return res.status(200).json({ success: true, igAccountId: igData.instagram_business_account.id });
      } else {
        return res.status(400).json({ success: false, error: 'No se encontró cuenta de Instagram vinculada' });
      }
    }

    return res.status(400).json({ error: 'Acción no reconocida' });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

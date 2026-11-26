export interface VkPublishResult {
  ok: boolean;
  postId?: number;
  skipped?: boolean;
  error?: string;
}

export async function publishPostToVk(params: {
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<VkPublishResult> {
  const accessToken = (process.env.VK_ACCESS_TOKEN || '').trim();
  const rawGroupId = (process.env.VK_GROUP_ID || '').trim().replace(/^-/, '');

  if (!accessToken || !rawGroupId) {
    return {
      ok: false,
      skipped: true,
      error: 'VK_ACCESS_TOKEN или VK_GROUP_ID не заданы',
    };
  }

  const fetchFn = params.fetchImpl || fetch;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const formData = new FormData();
    formData.append('owner_id', `-${rawGroupId}`);
    formData.append('from_group', '1');
    formData.append('message', params.text);
    formData.append('access_token', accessToken);
    formData.append('v', '5.199');

    const response = await fetchFn('https://api.vk.ru/method/wall.post', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MELO_LOVE_Publisher/1.0',
      },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const rawText = await response.text();
    let data: {
      response?: { post_id?: number };
      error?: { error_code?: number; error_msg?: string };
    } = {};

    try {
      data = JSON.parse(rawText);
    } catch {
      const snippet = rawText.replace(/\s+/g, ' ').slice(0, 180);
      return {
        ok: false,
        error: `VK вернул не JSON (HTTP ${response.status}): ${snippet}`,
      };
    }

    if (!response.ok || data.error || !data.response?.post_id) {
      const errMsg = data.error
        ? `VK API (${data.error.error_code}): ${data.error.error_msg}`
        : `HTTP ${response.status} от VK API`;
      return { ok: false, error: errMsg };
    }

    return { ok: true, postId: data.response.post_id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Сетевой сбой VK API',
    };
  }
}

export async function publicRpc<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch('https://wqshrjlcjqbjqcophvfv.supabase.co/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: 'sb_publishable_2QWxapvC5t_KHq-0u35d1w_kK-ah1eN', 'Content-Type': 'application/json' },
    body: JSON.stringify(args), cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: true,
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message || 'Unable to save the application.'), { code: result.code });
  return result as T;
}

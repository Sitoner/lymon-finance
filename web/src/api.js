async function req(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: body instanceof ArrayBuffer || body instanceof Blob ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : body instanceof ArrayBuffer || body instanceof Blob ? body : JSON.stringify(body),
  });
  if (res.status === 401) location.href = '/login'; // sesión caducada
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  get: (url) => req('GET', url),
  post: (url, body) => req('POST', url, body),
  put: (url, body) => req('PUT', url, body),
  patch: (url, body) => req('PATCH', url, body),
  del: (url) => req('DELETE', url),
  subir: (url, file) => file.arrayBuffer().then((buf) => req('POST', url, buf, { 'Content-Type': 'application/octet-stream', 'x-archivo': encodeURIComponent(file.name) })),
};

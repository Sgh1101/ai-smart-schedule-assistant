let cachedFetch = null;

async function loadFetch() {
  if (cachedFetch) {
    return cachedFetch;
  }

  if (typeof globalThis.fetch === 'function') {
    cachedFetch = (...args) => globalThis.fetch(...args);
    return cachedFetch;
  }

  const mod = await import('node-fetch');
  cachedFetch = mod.default;
  return cachedFetch;
}

async function comciganFetch(url, options) {
  const fetchFn = await loadFetch();
  return fetchFn(url, options);
}

module.exports = {
  comciganFetch,
  loadFetch
};

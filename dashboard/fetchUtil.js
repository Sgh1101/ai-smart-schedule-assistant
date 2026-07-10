let cachedFetch = null;

async function resolveFetch() {
  if (cachedFetch) {
    return cachedFetch;
  }

  if (typeof globalThis.fetch === 'function') {
    cachedFetch = globalThis.fetch.bind(globalThis);
    return cachedFetch;
  }

  try {
    const nodeFetch = require('node-fetch');
    cachedFetch = typeof nodeFetch === 'function' ? nodeFetch : nodeFetch.default;
  } catch {
    const imported = await import('node-fetch');
    cachedFetch = imported.default;
  }

  if (typeof cachedFetch !== 'function') {
    throw new Error('fetch is not a function');
  }

  return cachedFetch;
}

async function fetch(...args) {
  const fetchFn = await resolveFetch();
  return fetchFn(...args);
}

module.exports = { fetch, resolveFetch };

/**
 * CertVoice — Service Worker
 *
 * Cache Strategy:
 *   - Static assets: Cache-first (install-time precache + runtime cache)
 *   - API requests (GET): Network-first, cache fallback
 *   - API requests (POST/PUT): Network-first, IndexedDB queue if offline
 *   - Background sync: Replays queued requests when connectivity restored
 *
 * Offline Support:
 *   - Certificate data captured offline is stored in IndexedDB
 *   - Queued requests are replayed via Background Sync API
 *   - User sees "will sync when online" feedback via useOffline hook
 *
 * @module public/sw
 */

// ============================================================
// CONFIGURATION
// ============================================================

const CACHE_NAME = 'certvoice-v1'
const OFFLINE_DB_NAME = 'certvoice-offline'
const OFFLINE_STORE_NAME = 'offline-requests'
const OFFLINE_DB_VERSION = 1

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
]

// Routes that should never be cached
const NO_CACHE_PATTERNS = [
  /\/api\/auth\//,
  /\/api\/stripe\//,
  /\/api\/email\//,
  /clerk\.accounts/,
]

// ============================================================
// INSTALL — Precache static assets
// ============================================================

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  )
})

// ============================================================
// ACTIVATE — Clean old caches, claim clients
// ============================================================

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

// ============================================================
// FETCH — Route-based strategy
// ============================================================

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET/POST/PUT requests
  if (!['GET', 'POST', 'PUT'].includes(request.method)) return

  // Skip cross-origin requests (Clerk, Stripe, Sentry, GA)
  if (url.origin !== self.location.origin) return

  // Skip no-cache routes (auth, payments, email)
  if (NO_CACHE_PATTERNS.some((pattern) => pattern.test(url.pathname))) return

  // --- API routes: network-first ---
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET') {
      event.respondWith(networkFirstWithCache(request))
    } else {
      // POST/PUT: network-first, queue if offline
      event.respondWith(networkFirstWithQueue(request))
    }
    return
  }

  // --- Static assets: cache-first ---
  event.respondWith(cacheFirstWithNetwork(request))
})

// ============================================================
// BACKGROUND SYNC
// ============================================================

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-requests') {
    event.waitUntil(processOfflineQueue())
  }
})

// ============================================================
// PUSH NOTIFICATIONS (future use)
// ============================================================

self.addEventListener('push', (event) => {
  if (!event.data) return

  try {
    const data = event.data.json()
    const options = {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: data.tag || 'certvoice-notification',
      data: { url: data.url || '/' },
    }

    event.waitUntil(self.registration.showNotification(data.title || 'CertVoice', options))
  } catch (err) {
    console.error('[SW] Push parse error:', err)
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url === targetUrl)
      if (existing) return existing.focus()
      return self.clients.openWindow(targetUrl)
    })
  )
})

// ============================================================
// CACHE STRATEGIES
// ============================================================

/**
 * Cache-first: Return cached version, fall back to network.
 * Cache network response for future use.
 */
async function cacheFirstWithNetwork(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok && response.status === 200) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    // Offline fallback for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html')
      if (fallback) return fallback
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

/**
 * Network-first: Try network, fall back to cache for GET requests.
 */
async function networkFirstWithCache(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached

    return new Response(
      JSON.stringify({ offline: true, message: 'You are offline. Showing cached data.' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

/**
 * Network-first with offline queue: Try network for POST/PUT,
 * queue to IndexedDB if offline for background sync.
 */
async function networkFirstWithQueue(request) {
  try {
    const response = await fetch(request.clone())
    return response
  } catch {
    // Offline: queue the request for later sync
    try {
      await saveToOfflineQueue(request)
      return new Response(
        JSON.stringify({
          queued: true,
          message: 'Saved offline. Will sync when connected.',
        }),
        {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (err) {
      console.error('[SW] Failed to queue offline request:', err)
      return new Response(
        JSON.stringify({ error: 'Failed to save offline. Please try again.' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  }
}

// ============================================================
// INDEXED-DB OFFLINE QUEUE
// ============================================================

/**
 * Open the offline IndexedDB database.
 */
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
        const store = db.createObjectStore(OFFLINE_STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('timestamp', 'timestamp', { unique: false })
        store.createIndex('type', 'type', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Save a failed request to IndexedDB for later replay.
 */
async function saveToOfflineQueue(request) {
  const db = await openOfflineDB()
  const body = await request.clone().text()
  const url = new URL(request.url)

  // Determine queue type from URL
  let type = 'unknown'
  if (url.pathname.includes('voice') || url.pathname.includes('extract')) {
    type = 'voice_extraction'
  } else if (url.pathname.includes('pdf') || url.pathname.includes('generate')) {
    type = 'pdf_generation'
  } else if (url.pathname.includes('upload') || url.pathname.includes('photo')) {
    type = 'photo_upload'
  } else if (url.pathname.includes('certificate') || url.pathname.includes('save')) {
    type = 'certificate_save'
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, 'readwrite')
    const store = tx.objectStore(OFFLINE_STORE_NAME)

    const entry = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(
        [...request.headers.entries()].filter(
          ([key]) => !['authorization', 'cookie'].includes(key.toLowerCase())
        )
      ),
      body,
      type,
      timestamp: Date.now(),
      retryCount: 0,
    }

    const addRequest = store.add(entry)
    addRequest.onsuccess = () => {
      // Register for background sync
      if (self.registration && 'sync' in self.registration) {
        self.registration.sync.register('sync-offline-requests').catch(() => {
          // Background Sync not supported — will retry on next online event
        })
      }
      resolve()
    }
    addRequest.onerror = () => reject(addRequest.error)
  })
}

/**
 * Process all queued offline requests. Called by background sync
 * or manually when connectivity is restored.
 */
async function processOfflineQueue() {
  const db = await openOfflineDB()

  const entries = await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, 'readonly')
    const store = tx.objectStore(OFFLINE_STORE_NAME)
    const index = store.index('timestamp')
    const getAll = index.getAll()
    getAll.onsuccess = () => resolve(getAll.result)
    getAll.onerror = () => reject(getAll.error)
  })

  if (!entries || entries.length === 0) return

  const MAX_RETRIES = 3
  let successCount = 0
  let failCount = 0

  for (const entry of entries) {
    if (entry.retryCount >= MAX_RETRIES) {
      // Max retries exceeded — remove from queue
      await removeFromQueue(db, entry.id)
      failCount++
      continue
    }

    try {
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
        credentials: 'include',
      })

      if (response.ok) {
        await removeFromQueue(db, entry.id)
        successCount++
      } else if (response.status >= 400 && response.status < 500) {
        // Client error — don't retry, remove
        await removeFromQueue(db, entry.id)
        failCount++
      } else {
        // Server error — increment retry count
        await incrementRetry(db, entry.id, entry.retryCount)
        failCount++
      }
    } catch {
      // Still offline — increment retry, stop processing
      await incrementRetry(db, entry.id, entry.retryCount)
      failCount++
      break
    }
  }

  // Notify clients of sync result
  const clients = await self.clients.matchAll({ type: 'window' })
  for (const client of clients) {
    client.postMessage({
      type: 'SYNC_COMPLETE',
      data: { successCount, failCount, remaining: entries.length - successCount },
    })
  }
}

/**
 * Remove an entry from the offline queue.
 */
function removeFromQueue(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, 'readwrite')
    const store = tx.objectStore(OFFLINE_STORE_NAME)
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Increment retry count for a queued entry.
 */
function incrementRetry(db, id, currentCount) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, 'readwrite')
    const store = tx.objectStore(OFFLINE_STORE_NAME)
    const getRequest = store.get(id)

    getRequest.onsuccess = () => {
      const entry = getRequest.result
      if (!entry) {
        resolve()
        return
      }
      entry.retryCount = currentCount + 1
      const putRequest = store.put(entry)
      putRequest.onsuccess = () => resolve()
      putRequest.onerror = () => reject(putRequest.error)
    }
    getRequest.onerror = () => reject(getRequest.error)
  })
}

/**
 * Get count of pending items in the offline queue.
 * Exposed for useOffline hook via postMessage.
 */
self.addEventListener('message', async (event) => {
  if (event.data?.type === 'GET_PENDING_COUNT') {
    try {
      const db = await openOfflineDB()
      const count = await new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE_NAME, 'readonly')
        const store = tx.objectStore(OFFLINE_STORE_NAME)
        const countRequest = store.count()
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
      })
      event.source?.postMessage({ type: 'PENDING_COUNT', data: { count } })
    } catch {
      event.source?.postMessage({ type: 'PENDING_COUNT', data: { count: 0 } })
    }
  }

  if (event.data?.type === 'TRIGGER_SYNC') {
    try {
      await processOfflineQueue()
    } catch (err) {
      console.error('[SW] Manual sync failed:', err)
    }
  }
})

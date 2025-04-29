// Define a unique cache name (change this when you update assets)
const CACHE_NAME = 'vision-ai-cache-v1.2'; // Increment version on updates

// List of assets (app shell) to cache on install
const urlsToCache = [
  '/', // The root HTML page served by Flask
  '/static/css/style.css',
  '/static/js/script.js',
  '/static/icons/icon-192x192.png', // Assuming you created these
  '/static/icons/icon-512x512.png', // Assuming you created these
  '/manifest.json', // Served from root by Flask
  // Add essential external resources if desired (check licenses/update strategy)
   'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
   'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap',
   // Add specific font files if needed, requires inspecting network tab
   // Example: 'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmSU5fCRc4EsA.woff2'
];

// Install event: Cache the app shell
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Opened cache:', CACHE_NAME);
        // Use { cache: 'reload' } for external resources during install
        const requests = urlsToCache.map(url => new Request(url, { cache: 'reload' }));
        return cache.addAll(requests);
      })
      .then(() => {
        console.log('[Service Worker] Cache populated successfully');
        return self.skipWaiting(); // Activate immediately
      })
      .catch(error => {
        console.error('[Service Worker] Cache addAll failed:', error);
      })
  );
});

// Activate event: Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate event');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
         console.log('[Service Worker] Claiming clients');
         return self.clients.claim(); // Take control immediately
    })
  );
});

// Fetch event: Serve cached assets first (Cache First Strategy for GET)
self.addEventListener('fetch', (event) => {
  // Only handle GET requests with Cache First
  if (event.request.method === 'GET') {
    // Check if the request is for navigation (HTML page)
    if (event.request.mode === 'navigate') {
        // Network falling back to cache for HTML page
         event.respondWith(
             fetch(event.request).catch(() => caches.match('/')) // Fallback to root if network fails
         );
         return; // Don't process further for navigation
    }

    // For other GET requests (CSS, JS, Images, etc.)
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          // Return cached response if found
          if (cachedResponse) {
            // Optional: Background update check (Stale-While-Revalidate style)
            // fetch(event.request).then(networkResponse => {
            //   if(networkResponse.ok) {
            //     caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
            //   }
            // });
            return cachedResponse;
          }

          // If not in cache, fetch from network
          return fetch(event.request).then(networkResponse => {
               // Optional: Cache newly fetched assets dynamically if needed
               // Only cache successful responses from your origin or known CDNs
               if (networkResponse.ok && (event.request.url.startsWith(self.location.origin) || event.request.url.includes('cdnjs') || event.request.url.includes('gstatic'))) {
                   const responseToCache = networkResponse.clone();
                   caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
               }
               return networkResponse;
          }).catch(error => {
              console.error('[Service Worker] Fetch failed for:', event.request.url, error);
              // Optional: Provide a specific offline fallback for assets
              // if (event.request.destination === 'image') {
              //   return caches.match('/static/icons/offline-placeholder.png');
              // }
          });
        })
    );
  } else {
       // For non-GET requests (POST), always use network
       event.respondWith(fetch(event.request));
  }
});

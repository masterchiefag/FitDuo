/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// App shell + bundled exercise media, injected at build time.
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('message', (event) => {
  // The UI sends this only when no workout session is in progress.
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

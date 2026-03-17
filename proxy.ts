import { NextRequest, NextResponse } from "next/server";

const EMPTY_JS = "export {};\n";
const CLEANUP_SW = `
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();

    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    for (const client of clients) {
      client.navigate(client.url);
    }
  })());
});
`.trim();

function jsResponse(body: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/service-worker.js") {
    return jsResponse(CLEANUP_SW);
  }

  if (pathname === "/@vite/client" || pathname === "/@react-refresh" || pathname === "/src/main.tsx") {
    return jsResponse(EMPTY_JS);
  }

  if (pathname === "/icons/icon-192x192.png") {
    return NextResponse.redirect(new URL("/logo.png", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/service-worker.js", "/@vite/client", "/@react-refresh", "/src/main.tsx", "/icons/icon-192x192.png"],
};

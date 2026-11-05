"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackedPage } from "../lib/analytics-policy";

export function PageViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!trackedPage(pathname) || navigator.webdriver || typeof globalThis.crypto?.randomUUID !== "function") return;
    let sent = false;
    const send = () => {
      if (sent || document.visibilityState !== "visible" || (document as Document & { prerendering?: boolean }).prerendering) return;
      sent = true;
      void fetch("/api/analytics/pageview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: crypto.randomUUID(), path: pathname }),
        keepalive: true, credentials: "same-origin", cache: "no-store",
      }).catch(() => {});
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { sent = false; send(); } };
    const timer = window.setTimeout(send, 100);
    document.addEventListener("visibilitychange", send);
    window.addEventListener("pageshow", restore);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", send); window.removeEventListener("pageshow", restore); };
  }, [pathname]);
  return null;
}

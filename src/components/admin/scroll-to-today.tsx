"use client";

import { useEffect } from "react";

/** Scrolls a horizontally-scrolling calendar so today's column is the first visible day (mobile). */
export default function ScrollToToday({ containerId }: { containerId: string }) {
  useEffect(() => {
    const box = document.getElementById(containerId);
    const today = box?.querySelector<HTMLElement>("[data-today]");
    const sticky = box?.querySelector<HTMLElement>("thead th");
    if (box && today) box.scrollLeft = Math.max(0, today.offsetLeft - (sticky?.offsetWidth ?? 0));
  }, [containerId]);
  return null;
}

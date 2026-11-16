"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";

type SectionLinkProps = ComponentProps<typeof Link> & { href: string };

/**
 * Link to a homepage section ("/#courses", "/#fees", "/#faq") that always
 * scrolls there. A plain <Link> does nothing when the URL already ends in
 * the same hash (Next.js sees no navigation), so CTA buttons appeared dead
 * after the first click or after arriving at "/#courses" from another page.
 * On the homepage this scrolls to the section and records the hash; on any
 * other page it navigates normally. Non-hash hrefs behave like <Link>.
 */
export function SectionLink({ href, onClick, ...props }: SectionLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const hashIndex = href.indexOf("#");
    if (hashIndex === -1) return;
    const path = href.slice(0, hashIndex) || window.location.pathname;
    if (path !== window.location.pathname) return;
    const target = document.getElementById(decodeURIComponent(href.slice(hashIndex + 1)));
    if (!target) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    const hash = href.slice(hashIndex);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  }

  return <Link href={href} onClick={handleClick} {...props} />;
}

// Visit measurement. Google Analytics 4 loads only when SITE.analyticsId is
// set; until then (and with "Do Not Track" or Global Privacy Control on)
// track() does nothing. Events carry no personal data: lot ids, views and
// which button was used, never names, phones or messages.
import { SITE } from '../config/site.js';

let ready = false;

export function initAnalytics() {
  const id = SITE.analyticsId;
  if (!id || !/^G-[A-Z0-9]{4,}$/.test(id) || typeof document === 'undefined') return false;
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments); // eslint-disable-line prefer-rest-params
  };
  window.gtag('js', new Date());
  window.gtag('config', id, { anonymize_ip: true });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(s);
  ready = true;
  return true;
}

/** Records an event (no-op without analytics). */
export function track(event, params = {}) {
  if (ready && typeof window.gtag === 'function') window.gtag('event', event, params);
}

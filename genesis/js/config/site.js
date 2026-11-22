// Launch settings. Each one stays null until Génesis supplies it; the page
// adapts on its own (nothing is shown or loaded for a null setting).
//   siteUrl:     public address once the domain is live, e.g. 'https://vivalago.com.py/'
//                (absolute URLs for link previews and search engines)
//   analyticsId: Google Analytics 4 measurement ID, e.g. 'G-XXXXXXXXXX'
//   brochureUrl: path or URL of the brochure PDF, e.g. 'assets/docs/viva-lago-brochure.pdf'
//   availabilityUrl: public read-only URL of Génesis' system that returns the
//                lot states as JSON (see docs/integracion-disponibilidad.md),
//                e.g. 'https://sistema.genesis.com.py/api/public/viva-lago/disponibilidad'.
//                While null, the page reads data/disponibilidad.json.
export const SITE = Object.freeze({
  siteUrl: null,
  analyticsId: null,
  brochureUrl: null,
  availabilityUrl: null,
});

export const AVAILABILITY_FALLBACK_URL = 'data/disponibilidad.json';

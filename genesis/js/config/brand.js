// Génesis brand configuration.
//
// The official logo artwork was not supplied with this repository. Until it is,
// the interface sets the company name in the site's text face; it does not try
// to imitate the logo. Drop the official files in assets/brand/ and point these
// paths at them (keep the original colour artwork for official applications).
export const BRAND = Object.freeze({
  name: 'Génesis',
  legalName: 'Génesis Negocios Inmobiliarios',
  city: 'Ciudad del Este, Paraguay',
  slogan: 'El comienzo de tu historia',
  logo: Object.freeze({
    color: null, // e.g. 'assets/brand/genesis-logo.svg' (lime wordmark on purple)
    mono: null, // e.g. 'assets/brand/genesis-logo-mono-ivory.svg'
  }),
});

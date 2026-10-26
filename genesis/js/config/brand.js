// Génesis brand configuration.
//
// Logo artwork is taken from Génesis' own sales brochure ("GENESIS LOTE",
// March 2026): the wordmark is the brochure's vector drawing, the Viva Lago
// Country mark is its embedded artwork. Colours are sampled from the same file.
export const BRAND = Object.freeze({
  name: 'Génesis',
  legalName: 'Génesis Negocios Inmobiliarios',
  city: 'Ciudad del Este, Paraguay',
  slogan: 'El comienzo de tu historia',
  colors: Object.freeze({ purple: '#7f4180', purpleDeep: '#5e0c72', green: '#81a941', lilac: '#bc82bf' }),
  logo: Object.freeze({
    // Full lockup with the slogan, for generous sizes.
    color: 'assets/brand/genesis-logo-color.svg',
    mono: 'assets/brand/genesis-logo-ivory.svg',
    // Wordmark alone, for the header and other small placements.
    wordmarkColor: 'assets/brand/genesis-wordmark-color.svg',
    wordmarkMono: 'assets/brand/genesis-wordmark-ivory.svg',
  }),
  development: Object.freeze({
    logo: 'assets/brand/viva-lago-logo.webp',
    logoMono: 'assets/brand/viva-lago-logo-ivory.webp',
  }),
});

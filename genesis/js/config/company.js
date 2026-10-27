// Génesis as a company: vision, office and team, shown on the home page.
//
// Only details Génesis supplied or approved belong here. Empty fields are not
// shown (no placeholder text reaches the page).
//   vision:  drafted from the approved mission; awaiting Génesis' approval
//   office:  address, opening hours and a Google Maps link of the office
//   TEAM:    name exactly as written by Génesis, role, photo (square, at
//            least 800 × 800, in assets/team/), optional short bio
export const COMPANY = Object.freeze({
  vision:
    'Ser la desarrolladora inmobiliaria de referencia del Alto Paraná, reconocida por crear barrios que unen naturaleza, diseño y seguridad jurídica, y por la confianza de cada familia que comienza su historia con nosotros.',
  office: Object.freeze({
    city: 'Ciudad del Este',
    region: 'Alto Paraná, Paraguay',
    address: null,
    hours: null,
    mapsUrl: null,
  }),
});

export const TEAM = Object.freeze([
  Object.freeze({ id: 'jinsu-annahas', name: 'Jinsu Annahas', role: null, photo: null, bio: null }),
]);

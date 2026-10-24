// Verified contact channels for inquiries.
//
// No verified Génesis contact details or inquiry integration existed in the
// repository, so every channel is null. The inquiry UI detects this and says
// plainly that nothing is sent. Fill these in only with official details:
//   whatsapp:        international number, digits only (e.g. '595XXXXXXXXX')
//   email:           official sales address
//   inquiryEndpoint: HTTPS URL that accepts a JSON POST and answers 2xx on success
export const CONTACT = Object.freeze({
  whatsapp: null,
  email: null,
  inquiryEndpoint: null,
});

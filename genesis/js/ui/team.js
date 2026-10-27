// "Nuestro equipo": a row of round portraits (or monograms until a photo is
// supplied); each opens a profile card — “Conocé a …” — with role and bio.
// Native <dialog>: focus is trapped and Escape closes it.
import { h } from './dom.js';
import { track } from '../core/track.js';

const FALLBACK_ROLE = 'Equipo Génesis';

export const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

function portrait(member, cls) {
  return member.photo
    ? h('span', { class: `${cls} has-photo` }, h('img', { src: member.photo, alt: '', loading: 'lazy', decoding: 'async' }))
    : h('span', { class: cls, 'aria-hidden': 'true' }, h('span', { class: 'portrait__initials' }, initials(member.name)));
}

export function mountTeam(host, members, { onContact } = {}) {
  if (!host || !members?.length) {
    host?.closest('section')?.setAttribute('hidden', '');
    return null;
  }

  const photo = h('div', { class: 'profile__photo' });
  const name = h('h3', { class: 'profile__name', id: 'profile-name' });
  const role = h('p', { class: 'profile__role' });
  const bio = h('p', { class: 'profile__bio' });
  const contact = h('a', { class: 'btn btn--brand', href: '#contacto' });
  const close = h('button', { class: 'profile__close', type: 'button', 'aria-label': 'Cerrar' }, '×');
  const dialog = h(
    'dialog',
    { class: 'profile', 'aria-labelledby': 'profile-name' },
    h('div', { class: 'profile__card' }, photo, h('div', { class: 'profile__body' }, h('p', { class: 'eyebrow' }, 'Nuestro equipo · Génesis'), name, role, bio, h('div', { class: 'profile__actions' }, contact))),
    close,
  );
  document.body.append(dialog);
  let opener = null;

  function open(member, button) {
    opener = button;
    const first = member.name.split(/\s+/)[0];
    photo.replaceChildren(portrait(member, 'portrait portrait--lg'));
    name.replaceChildren(h('span', {}, 'Conocé a'), h('em', {}, member.name));
    role.textContent = member.role || '';
    role.hidden = !member.role;
    bio.textContent = member.bio || 'Parte del equipo de Génesis Negocios Inmobiliarios que te acompaña en cada decisión, con información verificada y por escrito.';
    contact.replaceChildren(`Hablar con ${first}`, h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'));
    contact.onclick = () => {
      dialog.close();
      onContact?.(member);
    };
    dialog.showModal();
    document.body.classList.add('is-locked');
    track('team_profile', { member: member.id });
  }
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  dialog.addEventListener('close', () => {
    document.body.classList.remove('is-locked');
    opener?.focus();
  });

  host.replaceChildren(
    ...members.map((m) => {
      const b = h(
        'button',
        { class: 'member', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `Conocé a ${m.name}${m.role ? `, ${m.role}` : ''}` },
        portrait(m, 'portrait'),
        h('span', { class: 'member__name' }, m.name),
        h('span', { class: 'member__role' }, m.role || FALLBACK_ROLE),
      );
      b.addEventListener('click', () => open(m, b));
      return h('li', {}, b);
    }),
  );
  host.dataset.count = String(members.length);
  return { dialog, open };
}

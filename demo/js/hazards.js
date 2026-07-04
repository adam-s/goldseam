// Hazard behaviors — each block implements one catalog row's live bite.

// Portal tooltip: rendered far from its trigger, Popper/Material style.
const trigger = document.getElementById('tip-trigger');
trigger.addEventListener('mouseenter', () => {
  const tip = document.createElement('div');
  tip.id = 'portal-tip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = 'Teleported: I live at body end, not near my trigger';
  document.getElementById('portal-root').appendChild(tip);
});
trigger.addEventListener('mouseleave', () => {
  document.getElementById('portal-tip')?.remove();
});

// Delayed render: content exists only after the skeleton clears (3s —
// longer than a short cy.get timeout, the triage timing scenario).
setTimeout(() => {
  document.getElementById('slow-panel').innerHTML =
    '<button id="slow-loaded">Loaded action</button>';
}, 3000);

// Dynamic id: changes every load — any healed #coupon-XXXX is a trap;
// the stable hooks are the class and data-field attribute.
const coupon = document.querySelector('.coupon-input');
coupon.id = `coupon-${Math.random().toString(16).slice(2, 6)}`;

// Identical twins + split text + frame need no JS: markup is the hazard.

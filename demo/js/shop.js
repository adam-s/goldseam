// Demo shop logic. All state lives in localStorage — no backend, resets with
// the browser profile (Cypress clears it between tests).
// Selector-texture note: rendered markup mixes ids, classes, data-testid and
// hook-free elements on purpose; specs and mutation branches rely on that mix.

const PRODUCTS = [
  { id: 1, name: 'Aurora Lamp', price: 49.0, tag: 'lighting' },
  { id: 2, name: 'Birch Desk', price: 249.0, tag: 'furniture' },
  { id: 3, name: 'Cumulus Pillow', price: 29.0, tag: 'bedding' },
  { id: 4, name: 'Drift Kettle', price: 89.0, tag: 'kitchen' },
  { id: 5, name: 'Ember Mug', price: 19.0, tag: 'kitchen' },
  { id: 6, name: 'Fjord Chair', price: 179.0, tag: 'furniture' },
];

const REVIEWS = [
  'Sturdy and beautiful.', 'Arrived early!', 'The mug keeps coffee warm forever.',
  'Five stars, would drift again.', 'My cat approves of the pillow.',
  'Desk survived a toddler.', 'Lamp glows like an actual aurora.',
  'Kettle whistles in tune.', 'Chair is peak hygge.', 'Great gift for minimalists.',
  'Shipping was painless.', 'The last review you will ever need.',
];

const money = (n) => `$${n.toFixed(2)}`;

function getCart() {
  return JSON.parse(localStorage.getItem('cart') || '[]');
}

function setCart(items) {
  localStorage.setItem('cart', JSON.stringify(items));
  renderCartCount();
}

function addToCart(productId, qty = 1) {
  const cart = getCart();
  const line = cart.find((l) => l.id === productId);
  if (line) line.qty += qty;
  else cart.push({ id: productId, qty });
  setCart(cart);
}

function removeFromCart(productId) {
  setCart(getCart().filter((l) => l.id !== productId));
}

function cartCount() {
  return getCart().reduce((sum, l) => sum + l.qty, 0);
}

function cartTotal() {
  return getCart().reduce((sum, l) => {
    const p = PRODUCTS.find((p) => p.id === l.id);
    return sum + (p ? p.price * l.qty : 0);
  }, 0);
}

function renderCartCount() {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(cartCount());
}

// ── tooltips (inline + portal variants) ─────────────────────────────────────
// data-tooltip renders next to the trigger; data-tooltip-portal appends to
// document.body — the Material/AG-Grid pattern where the tooltip is NOT a
// descendant of its trigger.

function installTooltips() {
  document.querySelectorAll('[data-tooltip], [data-tooltip-portal]').forEach((trigger) => {
    const portal = trigger.hasAttribute('data-tooltip-portal');
    const text = trigger.getAttribute(portal ? 'data-tooltip-portal' : 'data-tooltip');
    let tip = null;
    trigger.addEventListener('mouseenter', () => {
      tip = document.createElement('div');
      tip.className = portal ? 'tooltip portal-tooltip' : 'tooltip';
      tip.setAttribute('role', 'tooltip');
      tip.textContent = text;
      if (portal) {
        const rect = trigger.getBoundingClientRect();
        tip.style.left = `${rect.left}px`;
        tip.style.top = `${rect.bottom + 4}px`;
        document.body.appendChild(tip);
      } else {
        trigger.insertAdjacentElement('afterend', tip);
      }
    });
    trigger.addEventListener('mouseleave', () => {
      tip?.remove();
      tip = null;
    });
  });
}

// ── shadow-DOM widget ───────────────────────────────────────────────────────
// Real apps render inside shadow roots (Material, AG-Grid, design systems);
// capture must pierce open roots to give the model evidence.

class SupportBadge extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .badge { border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem 1rem;
          display: inline-flex; gap: 0.75rem; align-items: center; }
        button { cursor: pointer; }
      </style>
      <div class="badge">
        <span class="support-status">Support is online</span>
        <button data-testid="support-ping">Ping support</button>
      </div>`;
    root.querySelector('button').addEventListener('click', () => {
      root.querySelector('.support-status').textContent = 'Ping received';
    });
  }
}
customElements.define('support-badge', SupportBadge);

// ── page renderers, keyed by <body data-page="..."> ────────────────────────

function productCard(p) {
  return `
    <article class="product-card" data-tag="${p.tag}">
      <h3 class="product-name"><a href="product.html?id=${p.id}">${p.name}</a></h3>
      <span class="price">${money(p.price)}</span>
      <button class="btn btn-primary" data-testid="add-to-cart-${p.id}">Add to cart</button>
    </article>`;
}

function applyFilters() {
  const checked = [...document.querySelectorAll('.filter-box input:checked')].map((c) => c.value);
  document.querySelectorAll('#product-grid .product-card').forEach((card) => {
    card.hidden = checked.length > 0 && !checked.includes(card.dataset.tag);
  });
}

function renderGrid() {
  const grid = document.getElementById('product-grid');
  grid.innerHTML = PRODUCTS.map(productCard).join('');

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-testid^="add-to-cart"]');
    if (!btn) return;
    addToCart(Number(btn.dataset.testid.split('-').pop()));
  });

  document.querySelectorAll('.filter-box input').forEach((box) =>
    box.addEventListener('change', applyFilters),
  );

  // XHR-backed action: extra products come from the "API".
  const loadMore = document.getElementById('load-more');
  loadMore.addEventListener('click', async () => {
    const res = await fetch('data/more-products.json');
    const extra = await res.json();
    extra.forEach((p) => {
      PRODUCTS.push(p);
      grid.insertAdjacentHTML('beforeend', productCard(p));
    });
    applyFilters();
    loadMore.disabled = true;
    loadMore.textContent = 'All products loaded';
  });

  const reviews = document.getElementById('reviews');
  reviews.innerHTML = REVIEWS.map(
    (text, i) => `<blockquote class="review" id="review-${i + 1}">${text}</blockquote>`,
  ).join('');
}

function renderProduct() {
  const id = Number(new URLSearchParams(location.search).get('id'));
  const p = PRODUCTS.find((p) => p.id === id);
  const el = document.getElementById('product-detail');
  if (!p) {
    el.innerHTML = '<p class="error">Product not found.</p>';
    return;
  }
  el.innerHTML = `
    <h2 class="product-name">${p.name}</h2>
    <p class="price">${money(p.price)}</p>
    <p>Category: <span class="tag">${p.tag}</span></p>
    <div class="qty-picker" aria-label="Quantity">
      <button class="qty-decrement" aria-label="Decrease quantity">−</button>
      <span id="qty-value">1</span>
      <button data-testid="qty-increment" aria-label="Increase quantity">+</button>
    </div>
    <button id="add-single" class="btn btn-primary">Add to cart</button>
    <a href="index.html">Continue shopping</a>`;

  const qtyEl = document.getElementById('qty-value');
  const qty = () => Number(qtyEl.textContent);
  el.querySelector('.qty-decrement').addEventListener('click', () => {
    qtyEl.textContent = String(Math.max(1, qty() - 1));
  });
  el.querySelector('[data-testid="qty-increment"]').addEventListener('click', () => {
    qtyEl.textContent = String(qty() + 1);
  });
  document.getElementById('add-single').addEventListener('click', () => addToCart(p.id, qty()));
}

function renderCart() {
  const cart = getCart();
  const wrap = document.getElementById('cart-contents');
  if (cart.length === 0) {
    wrap.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="cart-table">
      <thead><tr><th>Item</th><th>Qty</th><th>Line total</th><th></th></tr></thead>
      <tbody>
        ${cart
          .map((l) => {
            const p = PRODUCTS.find((p) => p.id === l.id);
            return `<tr>
              <td class="cart-item-name">${p.name}</td>
              <td>${l.qty}</td>
              <td>${money(p.price * l.qty)}</td>
              <td><button class="btn remove-line" data-id="${p.id}">Remove</button></td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    <p class="cart-total">Total: <strong id="cart-total">${money(cartTotal())}</strong></p>
    <a id="checkout-link" class="btn btn-primary" href="checkout.html">Proceed to checkout</a>`;

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button.remove-line');
    if (!btn) return;
    removeFromCart(Number(btn.dataset.id));
    renderCart();
  });
}

// ── modal (created on open, removed on close — both not.exist flavors) ─────

function openTermsModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-label="Terms and conditions">
      <h2>Terms &amp; conditions</h2>
      <p>All products are imaginary. No refunds on figments.</p>
      <button class="modal-close btn">Close</button>
    </div>`;
  backdrop.querySelector('.modal-close').addEventListener('click', () => backdrop.remove());
  document.body.appendChild(backdrop);
}

function renderCheckout() {
  const form = document.getElementById('checkout-form');
  const submit = form.querySelector('[data-testid="place-order"]');

  // Submit stays disabled until every field is valid.
  form.addEventListener('input', () => {
    submit.disabled = !form.checkValidity();
  });

  document.getElementById('terms-link').addEventListener('click', openTermsModal);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    form.hidden = true;
    const confirmation = document.getElementById('order-confirmation');
    confirmation.hidden = false;
    document.getElementById('order-number').textContent =
      'DS-' + String(cartCount()).padStart(2, '0') + '-' + String(Math.abs(cartTotal() * 100)).slice(0, 6);
    setCart([]);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderCartCount();
  installTooltips();
  const page = document.body.dataset.page;
  if (page === 'grid') renderGrid();
  if (page === 'product') renderProduct();
  if (page === 'cart') renderCart();
  if (page === 'checkout') renderCheckout();
});

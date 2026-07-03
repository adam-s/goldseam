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

const money = (n) => `$${n.toFixed(2)}`;

function getCart() {
  return JSON.parse(localStorage.getItem('cart') || '[]');
}

function setCart(items) {
  localStorage.setItem('cart', JSON.stringify(items));
  renderCartCount();
}

function addToCart(productId) {
  const cart = getCart();
  const line = cart.find((l) => l.id === productId);
  if (line) line.qty += 1;
  else cart.push({ id: productId, qty: 1 });
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
    return sum + p.price * l.qty;
  }, 0);
}

function renderCartCount() {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(cartCount());
}

// ── page renderers, keyed by <body data-page="..."> ────────────────────────

function renderGrid() {
  const grid = document.getElementById('product-grid');
  grid.innerHTML = PRODUCTS.map(
    (p) => `
    <article class="product-card" data-tag="${p.tag}">
      <h3 class="product-name"><a href="product.html?id=${p.id}">${p.name}</a></h3>
      <span class="price">${money(p.price)}</span>
      <button class="btn btn-primary" data-testid="add-to-cart-${p.id}">Add to cart</button>
    </article>`
  ).join('');

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-testid^="add-to-cart"]');
    if (!btn) return;
    addToCart(Number(btn.dataset.testid.split('-').pop()));
  });
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
    <button id="add-single" class="btn btn-primary">Add to cart</button>
    <a href="index.html">Continue shopping</a>`;
  document.getElementById('add-single').addEventListener('click', () => addToCart(p.id));
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

function renderCheckout() {
  const form = document.getElementById('checkout-form');
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
  const page = document.body.dataset.page;
  if (page === 'grid') renderGrid();
  if (page === 'product') renderProduct();
  if (page === 'cart') renderCart();
  if (page === 'checkout') renderCheckout();
});

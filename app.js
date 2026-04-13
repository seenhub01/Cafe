// =============================================
//   SEENHUB CAFE - CLOUD SYNC POS LOGIC
// =============================================

/* ---------- FIREBASE CONFIG ---------- */
// PASTE YOUR FIREBASE CONFIG HERE:
const firebaseConfig = {
  // apiKey: "...",
  // authDomain: "...", ...
};

// Initialize Firebase (if config is provided)
let db = null;
if (firebaseConfig.apiKey) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  // Enable offline persistence
  db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });
  db.enablePersistence().catch(err => console.error("Persistence failed", err));
}

/* ---------- STATE ---------- */
let state = {
  products: [],
  order: [],         // { productId, name, price, qty }
  orders: [],        // completed orders
  currentPage: 'pos',
  reportPeriod: 'daily',
  editingProductId: null,
  lastOrder: null,
  imageDataCache: {},  // productId -> base64 data URL
  html5QrCode: null,   // Scanner instance
  detectedItems: [],   // Items from AI Scan
};

/* ---------- PERSISTENCE (CLOUD + INDEXEDDB) ---------- */
// Initialize IndexedDB for large image storage
const dbRequest = indexedDB.open('CafeImageStore', 1);
dbRequest.onupgradeneeded = (e) => {
  e.target.result.createObjectStore('images');
};

dbRequest.onsuccess = (e) => {
  console.log('IndexedDB Ready');
};

async function saveImage(id, dataUrl) {
  return new Promise((resolve) => {
    const tx = dbRequest.result.transaction('images', 'readwrite');
    tx.objectStore('images').put(dataUrl, id);
    tx.oncomplete = () => resolve();
  });
}

async function loadImage(id) {
  return new Promise((resolve) => {
    const tx = dbRequest.result.transaction('images', 'readonly');
    const req = tx.objectStore('images').get(id);
    req.onsuccess = () => resolve(req.result);
  });
}

async function saveState() {
  // 1. Save products/orders locally
  localStorage.setItem('cafe_products', JSON.stringify(state.products));
  localStorage.setItem('cafe_orders', JSON.stringify(state.orders));

  // 2. Images are saved individually via saveImage() when products are created
  
  // 3. Save to Cloud (if DB is connected)
  if (db) {
    try {
      await db.collection('settings').doc('data').set({
        products: state.products,
        orders: state.orders.slice(0, 50),
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) { console.warn("Cloud Sync offline"); }
  }
}

async function loadState() {
  const CURRENT_VERSION = 'v5_smart_merge';
  const savedVersion = localStorage.getItem('cafe_app_version');

  try {
    state.products = JSON.parse(localStorage.getItem('cafe_products') || '[]');
    state.orders = JSON.parse(localStorage.getItem('cafe_orders') || '[]');
    
    // Load images for all products from IndexedDB
    for (let p of state.products) {
      if (dbRequest.readyState === 'done') {
        state.imageDataCache[p.id] = await loadImage(p.id);
      }
    }
  } catch (e) { console.error('Load state partially failed', e); }

  if (state.products.length === 0 || savedVersion !== CURRENT_VERSION) {
    loadSampleProducts();
    localStorage.setItem('cafe_app_version', CURRENT_VERSION);
  }

  if (db) {
    db.collection('settings').doc('data').onSnapshot((doc) => {
      if (doc.exists()) {
        const cloudData = doc.data();
        state.products = cloudData.products || state.products;
        if (cloudData.updatedAt > (state.lastSync || 0)) {
           state.orders = cloudData.orders || state.orders;
           state.lastSync = cloudData.updatedAt;
        }
        renderPOS(); 
      }
    });
  }
}

function loadSampleProducts() {
  const samples = [
    // Coffee
    { id: 'p1', name: 'Spanish Latte', category: 'Coffee', price: 24, emoji: '☕' },
    { id: 'p2', name: 'Flat White', category: 'Coffee', price: 21, emoji: '☕' },
    { id: 'p3', name: 'Cappuccino', category: 'Coffee', price: 21, emoji: '☕' },
    { id: 'p4', name: 'Coffee Latte', category: 'Coffee', price: 24, emoji: '🥛' },
    { id: 'p5', name: 'Americano', category: 'Coffee', price: 18, emoji: '☕' },
    { id: 'p6', name: 'Espresso', category: 'Coffee', price: 13, emoji: '☕' },
    
    // Food & Bakery
    { id: 'f1', name: 'Umm Ali', category: 'Food', price: 25, emoji: '🥣' },
    { id: 'f2', name: 'Creamy Cheese', category: 'Food', price: 25, emoji: '🧀' },
    { id: 'f3', name: 'Carrot Cake Slice', category: 'Food', price: 27, emoji: '🍰' },
    { id: 'f4', name: 'Vanilla Chiffon Cake', category: 'Food', price: 27, emoji: '🍰' },
    { id: 'f5', name: 'Peanut Butter Cookie', category: 'Bakery', price: 20, emoji: '🍪' },
    { id: 'f6', name: 'Cinnamon Muffin', category: 'Bakery', price: 9, emoji: '🧁' },
    { id: 'f7', name: 'Raspberry Muffin', category: 'Bakery', price: 9, emoji: '🧁' },
    { id: 'f8', name: 'Chicken Cheese Sandwich', category: 'Food', price: 18, emoji: '🥪' },
    { id: 'f9', name: 'Granola with Honey', category: 'Food', price: 21, emoji: '🍯' },
    
    // New Budget Items
    { id: 'f10', name: 'Cheese Samoon', category: 'Food', price: 5, emoji: '🍽️' },
    { id: 'f11', name: 'Cheese With Chips Oman', category: 'Food', price: 5, emoji: '🍽️' },
    { id: 'f12', name: 'Cheese With Chips Amwaj', category: 'Food', price: 5, emoji: '🍽️' },
    { id: 'f13', name: 'Vanilla Cake', category: 'Food', price: 4, emoji: '🍰' },
    { id: 'f14', name: 'Candy', category: 'Food', price: 8, emoji: '🍬' },
    
    // Drinks
    { id: 'd1', name: 'Sparkling Water', category: 'Drinks', price: 7, emoji: '🫧' },
    { id: 'd2', name: 'Aqua Panna Water', category: 'Drinks', price: 6, emoji: '💧' },
    { id: 'd3', name: 'Arwa Water 330ml', category: 'Drinks', price: 3, emoji: '🥤' },
    { id: 'd4', name: 'Soft Drink', category: 'Drinks', price: 4, emoji: '🥤' }
  ];

  // Smart Merge: Don't overwrite, just add missing items
  samples.forEach(sample => {
    const exists = state.products.some(p => p.id === sample.id || p.name === sample.name);
    if (!exists) {
      state.products.push(sample);
    }
  });

  saveState();
}

/* ---------- HELPERS ---------- */
function genId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}
function fmt(amount) {
  return 'AED ' + parseFloat(amount).toFixed(2);
}
function fmtDate(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}
function fmtTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function monthKey(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function dayKey(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getCategories() {
  const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))];
  return cats;
}

/* ---------- TOAST ---------- */
let toastTimeout;
function showToast(msg, type = '') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  clearTimeout(toastTimeout);
  setTimeout(() => toast.classList.add('show'), 10);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ---------- NAVIGATION ---------- */
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('nav-' + page).classList.add('active');
  state.currentPage = page;

  if (page === 'products') renderProductsList();
  if (page === 'orders') renderOrdersList();
  if (page === 'reports') renderReports();
}

/* ===================== POS PAGE ===================== */
function renderPOS() {
  updateHeaderDate();
  renderCategories();
  renderProductGrid();
  renderOrderItems();
}

function updateHeaderDate() {
  const el = document.getElementById('header-date');
  if (el) {
    el.textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }
}

function renderCategories() {
  const cats = getCategories();
  const tabs = document.getElementById('category-tabs');
  const search = document.getElementById('pos-search').value.toLowerCase();
  
  // Save current active
  const currentActive = tabs.querySelector('.cat-tab.active')?.dataset.cat || 'All';
  
  tabs.innerHTML = '';
  const allTab = document.createElement('button');
  allTab.className = 'cat-tab' + (currentActive === 'All' ? ' active' : '');
  allTab.dataset.cat = 'All';
  allTab.textContent = 'All';
  allTab.addEventListener('click', () => {
    tabs.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    allTab.classList.add('active');
    renderProductGrid();
  });
  tabs.appendChild(allTab);

  cats.forEach(cat => {
    const tab = document.createElement('button');
    tab.className = 'cat-tab' + (currentActive === cat ? ' active' : '');
    tab.dataset.cat = cat;
    tab.textContent = cat;
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderProductGrid();
    });
    tabs.appendChild(tab);
  });
}

function renderProductGrid() {
  const grid = document.getElementById('product-grid');
  const activeCat = document.querySelector('.cat-tab.active')?.dataset.cat || 'All';
  const searchInput = document.getElementById('pos-search');
  const search = searchInput ? searchInput.value.toLowerCase() : '';

  let filteredProducts = state.products;
  if (activeCat !== 'All') filteredProducts = filteredProducts.filter(p => p.category === activeCat);
  if (search) filteredProducts = filteredProducts.filter(p => p.name.toLowerCase().includes(search));

  if (filteredProducts.length === 0) {
    grid.innerHTML = `<div class="empty-grid"><span>🔍</span><p>No products found</p></div>`;
    return;
  }

  grid.innerHTML = '';
  filteredProducts.forEach(product => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.id = 'prod-card-' + product.id;

    const hasImage = state.imageDataCache && state.imageDataCache[product.id];
    const imgHtml = hasImage 
      ? `<img src="${state.imageDataCache[product.id]}" alt="${product.name}" />`
      : `<span>${product.emoji || '📦'}</span>`;

    card.innerHTML = `
      <div class="product-card-img">${imgHtml}</div>
      <div class="product-card-info">
        <div class="product-card-name">${product.name}</div>
        <div class="product-card-price">${fmt(product.price)}</div>
      </div>
      <button class="product-card-add" title="Add to order">+</button>
    `;
    
    // Use a clearer event listener
    const addBtn = card.querySelector('.product-card-add');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToOrder(product);
    });
    
    card.addEventListener('click', () => addToOrder(product));
    grid.appendChild(card);
  });
}

function addToOrder(product) {
  const existing = state.order.find(i => i.productId === product.id);
  if (existing) {
    existing.qty++;
  } else {
    state.order.push({ productId: product.id, name: product.name, price: product.price, qty: 1 });
  }
  renderOrderItems();
  showToast(`${product.name} added`, 'success');
}

function removeFromOrder(productId) {
  state.order = state.order.filter(i => i.productId !== productId);
  renderOrderItems();
}

function updateQty(productId, delta) {
  const item = state.order.find(i => i.productId === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) removeFromOrder(productId);
  else renderOrderItems();
}

function renderOrderItems() {
  const container = document.getElementById('order-items');
  const subtotalEl = document.getElementById('subtotal-val');
  const totalEl = document.getElementById('total-val');

  if (state.order.length === 0) {
    container.innerHTML = `<div class="empty-order"><span>🛒</span><p>No items yet</p></div>`;
    subtotalEl.textContent = 'AED 0.00';
    totalEl.textContent = 'AED 0.00';
    
    // Hide FAB
    const fab = document.getElementById('mobile-checkout-fab');
    if (fab) fab.classList.add('hidden');
    document.getElementById('order-panel').classList.remove('expanded');
    return;
  }

  container.innerHTML = '';
  let subtotal = 0;
  state.order.forEach(item => {
    subtotal += item.price * item.qty;
    const div = document.createElement('div');
    div.className = 'order-item';
    div.innerHTML = `
      <span class="order-item-name">${item.name}</span>
      <div class="qty-controls">
        <button class="qty-btn" data-pid="${item.productId}" data-action="dec">−</button>
        <span class="qty-val">${item.qty}</span>
        <button class="qty-btn" data-pid="${item.productId}" data-action="inc">+</button>
      </div>
      <span class="order-item-price">${fmt(item.price * item.qty)}</span>
    `;
    div.querySelectorAll('.qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid;
        const action = btn.dataset.action;
        updateQty(pid, action === 'inc' ? 1 : -1);
      });
    });
    container.appendChild(div);
  });

  const total = subtotal;
  subtotalEl.textContent = `AED ${subtotal.toFixed(2)}`;
  totalEl.textContent = `AED ${total.toFixed(2)}`;

  // Update FAB for mobile
  const fab = document.getElementById('mobile-checkout-fab');
  const count = state.order.reduce((sum, i) => sum + i.qty, 0);
  if (fab) {
    fab.classList.remove('hidden');
    document.getElementById('mobile-cart-count').innerText = count;
    document.getElementById('mobile-cart-total').innerText = `AED ${total.toFixed(2)}`;
  }
}

function clearOrder() {
  state.order = [];
  document.getElementById('customer-name').value = '';
  renderOrderItems();
}

function processPayment(method) {
  if (state.order.length === 0) {
    showToast('No items in order!', 'error');
    return;
  }

  const subtotal = state.order.reduce((sum, i) => sum + i.price * i.qty, 0);
  const total = subtotal;
  const customerName = document.getElementById('customer-name').value.trim();

  const order = {
    id: 'ORD-' + String(state.orders.length + 1).padStart(4, '0'),
    items: [...state.order],
    subtotal,
    total,
    method,
    customer: customerName || 'Guest',
    timestamp: Date.now(),
  };

  state.orders.unshift(order);
  state.lastOrder = order;
  state.order = [];
  document.getElementById('customer-name').value = '';
  saveState();
  renderOrderItems();

  // Show success modal
  document.getElementById('payment-modal-total').textContent = `Total: ${fmt(total)}`;
  document.getElementById('payment-modal-method').textContent = `Payment: ${method === 'cash' ? '💵 Cash' : '💳 Card'}`;
  openModal('payment-modal-overlay');
}

function resetOrder() {
  state.order = [];
  document.getElementById('customer-name').value = '';
  document.getElementById('order-panel').classList.remove('expanded');
  renderOrderItems();
  navigateTo('pos');
}

/* ===================== PRODUCTS PAGE ===================== */
function renderProductsList() {
  const list = document.getElementById('products-list');
  if (state.products.length === 0) {
    list.innerHTML = `<div class="empty-products"><span>📦</span><h3>No Products Yet</h3><p>Tap + Add to create your first product</p></div>`;
    return;
  }
  list.innerHTML = '';
  state.products.forEach(product => {
    const item = document.createElement('div');
    item.className = 'product-list-item';
    item.innerHTML = `
      <div class="product-list-img">
        ${state.imageDataCache[product.id]
          ? `<img src="${state.imageDataCache[product.id]}" alt="${product.name}" />`
          : `<span>${product.emoji || '📦'}</span>`
        }
      </div>
      <div class="product-list-info">
        <div class="product-list-name">${product.name}</div>
        <div class="product-list-cat">${product.category || '—'}</div>
        <div class="product-list-price">${fmt(product.price)}</div>
      </div>
      <div class="product-list-actions">
        <button class="edit-btn" data-id="${product.id}">✏️ Edit</button>
        <button class="delete-btn" data-id="${product.id}">🗑️ Delete</button>
      </div>
    `;
    item.querySelector('.edit-btn').addEventListener('click', () => openEditProduct(product.id));
    item.querySelector('.delete-btn').addEventListener('click', () => deleteProduct(product.id));
    list.appendChild(item);
  });
}

function openAddProduct() {
  state.editingProductId = null;
  document.getElementById('product-modal-title').textContent = 'Add Product';
  document.getElementById('product-name-input').value = '';
  document.getElementById('product-category-input').value = '';
  document.getElementById('product-price-input').value = '';
  document.getElementById('editing-product-id').value = '';
  document.getElementById('product-preview-img').src = '';
  document.getElementById('product-preview-img').classList.add('hidden');
  document.getElementById('image-placeholder').style.display = 'block';
  openModal('product-modal-overlay');
}

function openEditProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  state.editingProductId = id;
  document.getElementById('product-modal-title').textContent = 'Edit Product';
  document.getElementById('product-name-input').value = product.name;
  document.getElementById('product-category-input').value = product.category || '';
  document.getElementById('product-price-input').value = product.price;
  document.getElementById('product-barcode-input').value = product.barcode || '';
  document.getElementById('editing-product-id').value = id;

  const img = document.getElementById('product-preview-img');
  if (state.imageDataCache[id]) {
    img.src = state.imageDataCache[id];
    img.classList.remove('hidden');
    document.getElementById('image-placeholder').style.display = 'none';
  } else {
    img.src = '';
    img.classList.add('hidden');
    document.getElementById('image-placeholder').style.display = 'block';
  }
  openModal('product-modal-overlay');
}

function saveProduct() {
  const name = document.getElementById('product-name-input').value.trim();
  const category = document.getElementById('product-category-input').value.trim();
  const price = parseFloat(document.getElementById('product-price-input').value);
  const barcode = document.getElementById('product-barcode-input').value.trim();
  const editingId = document.getElementById('editing-product-id').value;

  if (!name) { showToast('Product name is required', 'error'); return; }
  if (isNaN(price) || price < 0) { showToast('Enter a valid price', 'error'); return; }

  if (editingId) {
    const idx = state.products.findIndex(p => p.id === editingId);
    if (idx !== -1) {
      state.products[idx] = { ...state.products[idx], name, category, price, barcode };
      showToast('Product updated!', 'success');
    }
  } else {
    const newProduct = { id: genId(), name, category, price, barcode, emoji: getCategoryEmoji(category) };
    state.products.push(newProduct);
    showToast('Product added!', 'success');
  }

  saveState();
  closeModal('product-modal-overlay');
  renderProductsList();
  renderCategories();
  renderProductGrid();
}

function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  state.products = state.products.filter(p => p.id !== id);
  delete state.imageDataCache[id];
  saveState();
  renderProductsList();
  renderCategories();
  renderProductGrid();
  showToast('Product deleted');
}

function getCategoryEmoji(cat) {
  const map = {
    coffee: '☕', drinks: '🥤', food: '🍽️', dessert: '🍰',
    snacks: '🍪', juice: '🍊', tea: '🍵'
  };
  return map[cat.toLowerCase()] || '📦';
}

/* ===================== ORDERS PAGE ===================== */
function renderOrdersList() {
  const list = document.getElementById('orders-list');
  const filter = document.getElementById('orders-filter').value;
  const now = Date.now();

  let filtered = state.orders.filter(o => {
    if (filter === 'today') return dayKey(o.timestamp) === todayStr();
    if (filter === 'week') {
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      return o.timestamp >= weekAgo;
    }
    if (filter === 'month') {
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
      return o.timestamp >= monthAgo;
    }
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-orders"><span>📋</span><p>No orders found for this period</p></div>`;
    return;
  }

  list.innerHTML = '';
  filtered.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card';
    const itemLines = order.items.map(i =>
      `<div class="order-card-item-line"><span>${i.name} x${i.qty}</span><span>${fmt(i.price * i.qty)}</span></div>`
    ).join('');
    card.innerHTML = `
      <div class="order-card-header">
        <div>
          <div class="order-card-id">${order.id}</div>
          <div class="order-card-time">${fmtDate(order.timestamp)} · ${order.customer}</div>
        </div>
        <span class="order-card-badge badge-${order.method}">${order.method === 'cash' ? '💵 Cash' : '💳 Card'}</span>
      </div>
      <div class="order-card-items">${itemLines}</div>
      <div class="order-card-footer">
        <div>
          <div class="order-card-total">${fmt(order.total)}</div>
        </div>
        <button class="order-print-btn" data-order-id="${order.id}">🖨️ Print</button>
      </div>
    `;
    card.querySelector('.order-print-btn').addEventListener('click', () => {
      const ord = state.orders.find(o => o.id === order.id);
      if (ord) printReceipt(ord);
    });
    list.appendChild(card);
  });
}

/* ===================== REPORTS PAGE ===================== */
function renderReports() {
  const period = state.reportPeriod;
  const content = document.getElementById('report-content');

  if (period === 'daily') renderDailyReport(content);
  else renderMonthlyReport(content);
}

function renderDailyReport(container) {
  const today = todayStr();
  const todayOrders = state.orders.filter(o => dayKey(o.timestamp) === today);
  const revenue = todayOrders.reduce((s, o) => s + o.total, 0);
  const avgOrder = todayOrders.length ? revenue / todayOrders.length : 0;

  // Top selling items today
  const itemSales = {};
  todayOrders.forEach(o => {
    o.items.forEach(i => {
      if (!itemSales[i.name]) itemSales[i.name] = { qty: 0, revenue: 0 };
      itemSales[i.name].qty += i.qty;
      itemSales[i.name].revenue += i.price * i.qty;
    });
  });
  const sortedItems = Object.entries(itemSales).sort((a, b) => b[1].revenue - a[1].revenue);
  const topItem = sortedItems[0]?.[0] || '—';
  const maxRev = sortedItems[0]?.[1].revenue || 1;

  container.innerHTML = `
    <div class="report-summary-cards">
      <div class="summary-card revenue">
        <div class="summary-card-value">${fmt(revenue)}</div>
        <div class="summary-card-label">Today's Revenue</div>
      </div>
      <div class="summary-card orders-count">
        <div class="summary-card-value">${todayOrders.length}</div>
        <div class="summary-card-label">Total Orders</div>
      </div>
      <div class="summary-card avg-order">
        <div class="summary-card-value">${fmt(avgOrder)}</div>
        <div class="summary-card-label">Avg. Order</div>
      </div>
      <div class="summary-card top-item">
        <div class="summary-card-value">${topItem}</div>
        <div class="summary-card-label">Top Item</div>
      </div>
    </div>

    <div class="report-section-title">Top Selling Items</div>
    <div class="report-bar-chart" id="daily-bar-chart">
      ${sortedItems.length === 0
        ? '<p style="text-align:center;color:var(--text-muted);padding:20px">No sales today yet</p>'
        : sortedItems.slice(0, 6).map(([name, data]) => {
          const pct = Math.max(10, Math.round((data.revenue / maxRev) * 100));
          return `
            <div class="bar-chart-item">
              <div class="bar-label" title="${name}">${name}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width:${pct}%">
                  <span class="bar-fill-val">x${data.qty}</span>
                </div>
              </div>
              <div class="bar-amount">${fmt(data.revenue)}</div>
            </div>
          `;
        }).join('')
      }
    </div>

    <div class="report-section-title">Today's Orders</div>
    <div class="monthly-table">
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Time</th>
            <th>Method</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${todayOrders.length === 0
            ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No orders today</td></tr>'
            : todayOrders.map(o => `
              <tr>
                <td>${o.id}</td>
                <td>${fmtTime(o.timestamp)}</td>
                <td>${o.method === 'cash' ? '💵' : '💳'}</td>
                <td>${fmt(o.total)}</td>
              </tr>
            `).join('')
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderMonthlyReport(container) {
  // Group by month
  const monthMap = {};
  state.orders.forEach(o => {
    const mk = monthKey(o.timestamp);
    if (!monthMap[mk]) monthMap[mk] = { orders: 0, revenue: 0 };
    monthMap[mk].orders++;
    monthMap[mk].revenue += o.total;
  });

  const months = Object.entries(monthMap).sort((a, b) => b[0].localeCompare(a[0]));
  const currentMonth = monthKey(Date.now());
  const thisMonthData = monthMap[currentMonth] || { orders: 0, revenue: 0 };
  const avgOrder = thisMonthData.orders ? thisMonthData.revenue / thisMonthData.orders : 0;

  // Item sales for this month
  const itemSales = {};
  state.orders.filter(o => monthKey(o.timestamp) === currentMonth).forEach(o => {
    o.items.forEach(i => {
      if (!itemSales[i.name]) itemSales[i.name] = { qty: 0, revenue: 0 };
      itemSales[i.name].qty += i.qty;
      itemSales[i.name].revenue += i.price * i.qty;
    });
  });
  const sortedItems = Object.entries(itemSales).sort((a, b) => b[1].revenue - a[1].revenue);
  const topItem = sortedItems[0]?.[0] || '—';
  const maxRev = sortedItems[0]?.[1].revenue || 1;

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtMonthKey(mk) {
    const [y, m] = mk.split('-');
    return monthNames[parseInt(m)-1] + ' ' + y;
  }

  container.innerHTML = `
    <div class="report-summary-cards">
      <div class="summary-card revenue">
        <div class="summary-card-value">${fmt(thisMonthData.revenue)}</div>
        <div class="summary-card-label">This Month</div>
      </div>
      <div class="summary-card orders-count">
        <div class="summary-card-value">${thisMonthData.orders}</div>
        <div class="summary-card-label">Total Orders</div>
      </div>
      <div class="summary-card avg-order">
        <div class="summary-card-value">${fmt(avgOrder)}</div>
        <div class="summary-card-label">Avg. Order</div>
      </div>
      <div class="summary-card top-item">
        <div class="summary-card-value">${topItem}</div>
        <div class="summary-card-label">Top Item</div>
      </div>
    </div>

    <div class="report-section-title">Top Selling Items This Month</div>
    <div class="report-bar-chart">
      ${sortedItems.length === 0
        ? '<p style="text-align:center;color:var(--text-muted);padding:20px">No sales this month yet</p>'
        : sortedItems.slice(0, 6).map(([name, data]) => {
            const pct = Math.max(10, Math.round((data.revenue / maxRev) * 100));
            return `
              <div class="bar-chart-item">
                <div class="bar-label" title="${name}">${name}</div>
                <div class="bar-track">
                  <div class="bar-fill" style="width:${pct}%">
                    <span class="bar-fill-val">x${data.qty}</span>
                  </div>
                </div>
                <div class="bar-amount">${fmt(data.revenue)}</div>
              </div>
            `;
          }).join('')
      }
    </div>

    <div class="report-section-title">Monthly Breakdown</div>
    <div class="monthly-table">
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>Orders</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${months.length === 0
            ? '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:20px">No data yet</td></tr>'
            : months.map(([mk, data]) => `
              <tr>
                <td>${fmtMonthKey(mk)}</td>
                <td>${data.orders}</td>
                <td>${fmt(data.revenue)}</td>
              </tr>
            `).join('')
          }
        </tbody>
      </table>
    </div>
  `;
}

/* ===================== RECEIPT PRINTING ===================== */
function printReceipt(order) {
  if (!order) {
    showToast('No order to print!', 'error');
    return;
  }

  const cafeInfo = {
    name: 'Seenhub Cafe',
    address: 'Al Ain, UAE',
    phone: '+971 50 911 9699',
  };

  const itemsHtml = order.items.map(i => `
    <tr>
      <td style="padding:4px 0; border-bottom: 0.5px solid #eee;">
        <div style="font-weight:bold">${i.name}</div>
        <div style="font-size:11px">x${i.qty} @ AED ${i.price.toFixed(2)}</div>
      </td>
      <td style="text-align:right; vertical-align:top; padding:4px 0">AED ${(i.price * i.qty).toFixed(2)}</td>
    </tr>
  `).join('');

  const receiptHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Receipt ${order.id}</title>
      <style>
        @page { size: 58mm auto; margin: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: 11px;
          line-height: 1.2;
          color: #000;
          width: 48mm; /* Standard printable width for 58mm paper */
          margin: 0 auto;
          padding: 8px 4px;
          background: #fff;
        }
        .center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 6px 0; }
        .cafe-name { font-size: 16px; font-weight: bold; margin-bottom: 2px; }
        .small { font-size: 10px; color: #444; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; }
        .total-row { font-size: 15px; font-weight: bold; }
        .thankyou { font-size: 14px; font-weight: bold; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="center">
        <div style="font-size: 24px; margin-bottom: 2px;">☕</div>
        <div class="cafe-name">${cafeInfo.name}</div>
        <div class="small">${cafeInfo.address}</div>
        <div class="small">${cafeInfo.phone}</div>
      </div>
      <div class="divider"></div>
      <div style="font-size:11px">
        <div><strong>Receipt:</strong> ${order.id}</div>
        <div><strong>Date:</strong> ${fmtDate(order.timestamp)}</div>
        <div><strong>Customer:</strong> ${order.customer || 'Guest'}</div>
        <div><strong>Pay:</strong> ${order.method === 'cash' ? 'Cash' : 'Card'}</div>
      </div>
      <div class="divider"></div>
      <table>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class="divider"></div>
      <table class="total-row">
        <tr>
          <td>TOTAL</td>
          <td style="text-align:right">AED ${order.total.toFixed(2)}</td>
        </tr>
      </table>
      <div class="divider"></div>
      <div class="center">
        <div class="thankyou">Thank You! 😊</div>
        <div class="small" style="margin-top:8px;">Powered by Seenhub Cafe</div>
      </div>
      <script>
        window.onload = function() {
          window.print();
          // Close is sometimes problematic in iframes/popups on certain browsers
        };
      </script>
    </body>
    </html>
  `;

  // Always use iframe for mobile PWA stability
  const frame = document.getElementById('print-frame');
  if (!frame) {
    const newFrame = document.createElement('iframe');
    newFrame.id = 'print-frame';
    newFrame.style.display = 'none';
    document.body.appendChild(newFrame);
    newFrame.srcdoc = receiptHtml;
  } else {
    frame.srcdoc = receiptHtml;
  }
  
  showToast('Opening print dialog...', 'success');
}

async function downloadReceipt(order) {
  if (!order) return;
  
  showToast('Generating image...', 'info');

  // We need to render the receipt HTML in a temporary visible-but-off-screen div
  // because html2canvas has trouble with hidden iframes
  const tempDiv = document.createElement('div');
  tempDiv.style.position = 'absolute';
  tempDiv.style.left = '-9999px';
  tempDiv.style.top = '0';
  tempDiv.innerHTML = generateReceiptHtml(order); // helper needed
  document.body.appendChild(tempDiv);

  try {
    const canvas = await html2canvas(tempDiv, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff'
    });
    
    const link = document.createElement('a');
    link.download = `receipt_${order.id}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Receipt saved to Gallery', 'success');
  } catch (err) {
    console.error("Download failed", err);
    showToast('Failed to save image', 'error');
  } finally {
    document.body.removeChild(tempDiv);
  }
}

// Helper to generate the raw HTML string (refactored from printReceipt)
function generateReceiptHtml(order) {
  const cafeInfo = {
    name: "Seenhub Cafe",
    address: "Premium Modern POS System",
    phone: "+971 XXX XXX XXXX"
  };

  const itemsHtml = order.items.map(i => `
    <tr>
      <td style="padding:4px 0">
        <div style="font-weight:bold">${i.name}</div>
        <div style="font-size:10px">x${i.qty} @ AED ${i.price.toFixed(2)}</div>
      </td>
      <td style="text-align:right; vertical-align:top; padding:4px 0">AED ${(i.price * i.qty).toFixed(2)}</td>
    </tr>
  `).join('');

  return `
    <div style="width: 48mm; padding: 10px; background: #fff; font-family: 'Segoe UI', sans-serif; font-size: 11px; line-height: 1.2; color: #000;">
      <div style="text-align: center;">
        <div style="font-size: 24px; margin-bottom: 2px;">☕</div>
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 2px;">${cafeInfo.name}</div>
        <div style="font-size: 10px; color: #444;">${cafeInfo.address}</div>
        <div style="font-size: 10px; color: #444;">${cafeInfo.phone}</div>
      </div>
      <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
      <div style="font-size:11px">
        <div><strong>Receipt:</strong> ${order.id}</div>
        <div><strong>Date:</strong> ${fmtDate(order.timestamp)}</div>
        <div><strong>Customer:</strong> ${order.customer || 'Guest'}</div>
        <div><strong>Pay:</strong> ${order.method === 'cash' ? 'Cash' : 'Card'}</div>
      </div>
      <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
      <table style="width: 100%; border-collapse: collapse;">
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
      <table style="width: 100%; border-collapse: collapse; font-size: 15px; font-weight: bold;">
        <tr>
          <td>TOTAL</td>
          <td style="text-align:right">AED ${order.total.toFixed(2)}</td>
        </tr>
      </table>
      <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
      <div style="text-align: center;">
        <div style="font-size: 14px; font-weight: bold; margin-top: 10px;">Thank You! 😊</div>
        <div style="font-size: 10px; color: #444; margin-top:8px;">Powered by Seenhub Cafe</div>
      </div>
    </div>
  `;
}

/* ===================== MODAL HELPERS ===================== */
function openModal(id) {
  document.getElementById(id).classList.add('active');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

/* ===================== IMAGE UPLOAD & COMPRESSION ===================== */
function handleImageUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Resize to max 300x300 for POS performance and storage
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      const MAX = 300;
      if (width > height) { if (width > MAX) { height *= MAX / width; width = MAX; } }
      else { if (height > MAX) { width *= MAX / height; height = MAX; } }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // 70% quality JPEG
      document.getElementById('product-preview-img').src = dataUrl;
      document.getElementById('product-preview-img').classList.remove('hidden');
      document.getElementById('image-placeholder').style.display = 'none';
      state.imageDataCache['__pending__'] = dataUrl;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ===================== EVENT LISTENERS ===================== */
function bindEvents() {
  // Bottom Nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // POS Search
  document.getElementById('pos-search').addEventListener('input', () => {
    renderProductGrid();
  });

  // Clear Order
  document.getElementById('clear-order-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    clearOrder();
  });

  // Toggle order panel on mobile
  document.querySelector('.order-panel-header').addEventListener('click', () => {
    if (window.innerWidth <= 600) {
      document.getElementById('order-panel').classList.toggle('expanded');
    }
  });

  // Pay buttons
  document.getElementById('pay-cash-btn').addEventListener('click', () => processPayment('cash'));
  document.getElementById('pay-card-btn').addEventListener('click', () => processPayment('card'));

  // Print last order (header)
  document.getElementById('btn-print-last').addEventListener('click', () => {
    if (state.lastOrder) printReceipt(state.lastOrder);
    else if (state.orders.length > 0) printReceipt(state.orders[0]);
    else showToast('No orders yet!', 'error');
  });

  // Print last order (orders page)
  document.getElementById('btn-print-last-order').addEventListener('click', () => {
    if (state.orders.length > 0) printReceipt(state.orders[0]);
    else showToast('No orders yet!', 'error');
  });

  // Products page: Add button
  document.getElementById('btn-add-product').addEventListener('click', openAddProduct);

  // Product modal: image upload
  document.getElementById('image-upload-area').addEventListener('click', () => {
    document.getElementById('product-image-input').click();
  });
  document.getElementById('product-image-input').addEventListener('change', (e) => {
    handleImageUpload(e.target.files[0]);
  });

  // Product modal: save/cancel/close
  document.getElementById('product-modal-save').addEventListener('click', async () => {
    const editingId = document.getElementById('editing-product-id').value;
    const pendingImg = state.imageDataCache['__pending__'];
    
    // Save product basic info
    saveProduct();
    
    // Handle image specifically via IndexedDB
    if (pendingImg) {
      let targetId = editingId;
      if (!targetId) {
        // new product (was pushed last in saveProduct)
        const lastProduct = state.products[state.products.length - 1];
        targetId = lastProduct ? lastProduct.id : null;
      }
      
      if (targetId) {
        state.imageDataCache[targetId] = pendingImg;
        await saveImage(targetId, pendingImg);
        delete state.imageDataCache['__pending__'];
        saveState();
      }
    }
    renderProductGrid();
  });
  document.getElementById('product-modal-cancel').addEventListener('click', () => {
    delete state.imageDataCache['__pending__'];
    closeModal('product-modal-overlay');
  });
  document.getElementById('product-modal-close').addEventListener('click', () => {
    delete state.imageDataCache['__pending__'];
    closeModal('product-modal-overlay');
  });
  document.getElementById('product-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      delete state.imageDataCache['__pending__'];
      closeModal('product-modal-overlay');
    }
  });

  // Payment modal
  document.getElementById('payment-modal-close').addEventListener('click', () => {
    closeModal('payment-modal-overlay');
    resetOrder();
  });
  document.getElementById('payment-modal-print').addEventListener('click', () => {
    printReceipt(state.lastOrder);
  });
  document.getElementById('payment-modal-download').addEventListener('click', () => {
    downloadReceipt(state.lastOrder);
  });

  // Orders filter
  document.getElementById('orders-filter').addEventListener('change', renderOrdersList);

  // Report tabs
  document.querySelectorAll('.report-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.report-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.reportPeriod = btn.dataset.period;
      renderReports();
    });
  });

  // Database Management
  document.getElementById('btn-export-db').addEventListener('click', exportDatabase);
  document.getElementById('btn-import-db').addEventListener('click', () => {
    document.getElementById('import-db-input').click();
  });
  document.getElementById('import-db-input').addEventListener('change', (e) => {
    importDatabase(e.target.files[0]);
  });

  // Scanner Events
  document.getElementById('btn-start-scanner').addEventListener('click', startScanner);
  document.getElementById('btn-stop-scanner').addEventListener('click', stopScanner);

  // POS Scanner Events
  document.getElementById('btn-header-scan').addEventListener('click', startPosScanner);
  document.getElementById('pos-scanner-close').addEventListener('click', stopPosScanner);

  // AI Vision Events
  document.getElementById('btn-ai-scan').addEventListener('click', () => {
    document.getElementById('ai-camera-input').click();
  });
  document.getElementById('ai-camera-input').addEventListener('change', (e) => {
    handleAiScan(e.target.files[0]);
  });
  document.getElementById('ai-review-close').addEventListener('click', () => closeModal('ai-review-modal-overlay'));
  document.getElementById('ai-review-cancel').addEventListener('click', () => closeModal('ai-review-modal-overlay'));
  document.getElementById('ai-import-btn').addEventListener('click', importAiItems);

  // Mobile FAB
  const fab = document.getElementById('mobile-checkout-fab');
  if (fab) {
    fab.addEventListener('click', () => {
      document.getElementById('order-panel').classList.toggle('expanded');
    });
  }

  // Also toggle via header
  document.querySelector('.order-panel-header').addEventListener('click', () => {
    if (window.innerWidth <= 900) {
      document.getElementById('order-panel').classList.toggle('expanded');
    }
  });
}

/* ===================== SCANNER LOGIC ===================== */
let posScannerInstance = null;
async function startPosScanner() {
  openModal('pos-scanner-overlay');
  
  if (!posScannerInstance) {
    posScannerInstance = new Html5Qrcode("pos-qr-reader");
  }

  const onScanSuccess = (decodedText) => {
    const product = state.products.find(p => p.barcode === decodedText);
    if (product) {
      addToOrder(product);
      showToast(`${product.name} added to cart!`, 'success');
      // We keep scanning for multi-item checkouts
    } else {
      showToast(`Unknown barcode: ${decodedText}`, 'error');
    }
  };

  const config = { fps: 15, qrbox: { width: 250, height: 150 } };
  try {
    await posScannerInstance.start({ facingMode: "environment" }, config, onScanSuccess);
  } catch (err) {
    showToast('Camera failed', 'error');
    closeModal('pos-scanner-overlay');
  }
}

function stopPosScanner() {
  closeModal('pos-scanner-overlay');
  if (posScannerInstance && posScannerInstance.isScanning) {
    posScannerInstance.stop();
  }
}

async function startScanner() {
  const scannerWrap = document.getElementById('product-scanner-wrap');
  const triggerWrap = document.getElementById('scan-trigger-wrap');
  
  scannerWrap.classList.remove('hidden');
  triggerWrap.classList.add('hidden');

  if (!state.html5QrCode) {
    state.html5QrCode = new Html5Qrcode("product-qr-reader");
  }

  const qrCodeSuccessCallback = (decodedText, decodedResult) => {
    stopScanner();
    document.getElementById('product-barcode-input').value = decodedText;
    showToast('Barcode scanned!', 'success');
    
    // Auto-fill logic if product exists
    const existing = state.products.find(p => p.barcode === decodedText);
    if (existing) {
      document.getElementById('product-name-input').value = existing.name;
      document.getElementById('product-price-input').value = existing.price;
      document.getElementById('product-category-input').value = existing.category || '';
    }
  };

  const config = { fps: 10, qrbox: { width: 250, height: 150 } };

  try {
    await state.html5QrCode.start({ facingMode: "environment" }, config, qrCodeSuccessCallback);
  } catch (err) {
    console.error("Scanner failed", err);
    showToast('Camera access denied', 'error');
    stopScanner();
  }
}

function stopScanner() {
  const scannerWrap = document.getElementById('product-scanner-wrap');
  const triggerWrap = document.getElementById('scan-trigger-wrap');
  
  scannerWrap.classList.add('hidden');
  triggerWrap.classList.remove('hidden');

  if (state.html5QrCode && state.html5QrCode.isScanning) {
    state.html5QrCode.stop().catch(err => console.warn("Stop failed", err));
  }
}

/* ===================== AI VISION LOGIC ===================== */
async function handleAiScan(file) {
  if (!file) return;
  
  openModal('ai-review-modal-overlay');
  document.getElementById('ai-loading').classList.remove('hidden');
  document.getElementById('ai-items-list').innerHTML = '';
  state.detectedItems = [];

  try {
    const worker = await Tesseract.createWorker('eng');
    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();

    parseAiText(text);
    renderDetectedItems();
  } catch (err) {
    console.error("AI Scan failed", err);
    showToast('AI analysis failed', 'error');
    // Don't close modal, show empty state
  } finally {
    document.getElementById('ai-loading').classList.add('hidden');
  }
}

function parseAiText(text) {
  const lines = text.split('\n');
  const items = [];

  lines.forEach(line => {
    line = line.trim();
    if (!line || line.length < 3) return;

    // Pattern: 1x Name Name 12.50
    // Try to find a numeric price at the end of the line
    const parts = line.split(/\s+/);
    if (parts.length < 2) return;

    let price = 0;
    let name = '';
    
    for (let i = parts.length - 1; i >= 0; i--) {
      // Look for something with digits and optional period
      const part = parts[i].replace(/[^\d.]/g, '');
      if (part && !isNaN(part) && part.length > 0) {
        price = parseFloat(part);
        name = parts.slice(0, i).join(' ');
        name = name.replace(/^\d+x\s+/i, '').trim(); // Remove "1x " prefix
        break;
      }
    }

    if (name && price > 0 && name.length > 1) {
      items.push({ id: genId(), name, price });
    }
  });

  state.detectedItems = items;
}

function renderDetectedItems() {
  const list = document.getElementById('ai-items-list');
  if (state.detectedItems.length === 0) {
    list.innerHTML = '<p style="text-align:center; padding:20px; color:var(--text-muted)">No items detected. Try a clearer photo.</p>';
    return;
  }

  list.innerHTML = state.detectedItems.map((item, idx) => `
    <div class="product-list-item" style="padding: 10px; gap: 10px; margin-bottom: 8px;">
      <input type="text" value="${item.name}" class="form-input" style="flex:2; padding:8px;" onchange="updateDetectedItem(${idx}, 'name', this.value)">
      <div style="display:flex; align-items:center; gap:4px; flex:1">
        <span style="font-size:12px; font-weight:bold">AED</span>
        <input type="number" value="${item.price}" class="form-input" style="padding:8px; width:100%" onchange="updateDetectedItem(${idx}, 'price', this.value)">
      </div>
      <button class="delete-btn" style="width:auto; padding:8px;" onclick="removeDetectedItem(${idx})">✕</button>
    </div>
  `).join('');
}

window.updateDetectedItem = (idx, field, val) => {
  if (field === 'price') state.detectedItems[idx].price = parseFloat(val) || 0;
  else state.detectedItems[idx][field] = val;
};

window.removeDetectedItem = (idx) => {
  state.detectedItems.splice(idx, 1);
  renderDetectedItems();
};

async function importAiItems() {
  if (state.detectedItems.length === 0) return;
  
  let count = 0;
  state.detectedItems.forEach(item => {
    const exists = state.products.find(p => p.name.toLowerCase() === item.name.toLowerCase());
    if (!exists) {
      state.products.push({
        id: item.id,
        name: item.name,
        price: item.price,
        category: 'Imported',
        emoji: '✨'
      });
      count++;
    }
  });

  await saveState();
  closeModal('ai-review-modal-overlay');
  renderProductsList();
  renderProductGrid();
  renderCategories();
  showToast(`${count} new items imported!`, 'success');
}

async function exportDatabase() {
  const data = {
    version: '1.0',
    timestamp: Date.now(),
    products: state.products,
    orders: state.orders,
    images: state.imageDataCache
  };
  
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seenhub_cafe_backup_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Database exported successfully', 'success');
}

async function importDatabase(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.products || !data.orders) throw new Error('Invalid backup file');
      
      if (confirm('This will replace your current data. Continue?')) {
        state.products = data.products;
        state.orders = data.orders;
        state.imageDataCache = data.images || {};
        
        // Save images to IndexedDB
        for (let id in state.imageDataCache) {
          await saveImage(id, state.imageDataCache[id]);
        }
        
        await saveState();
        showToast('Database restored successfully', 'success');
        location.reload(); // Refresh to apply all data
      }
    } catch (err) {
      showToast('Failed to import database: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

/* ===================== INIT ===================== */
function init() {
  loadState();
  bindEvents();
  renderPOS();

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('Service Worker Registered'))
      .catch(err => console.error('Service Worker Failed', err));
  }

  // Hide splash
  setTimeout(() => {
    document.getElementById('splash-screen').classList.add('hidden');
  }, 1800);
}

document.addEventListener('DOMContentLoaded', () => {
  dbRequest.onsuccess = () => {
    init();
  };
  // Fallback if already ready
  if (dbRequest.readyState === 'done') init();
});

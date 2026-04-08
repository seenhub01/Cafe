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
};

/* ---------- PERSISTENCE (CLOUD + INDEXEDDB) ---------- */
// Initialize IndexedDB for large image storage
const dbRequest = indexedDB.open('CafeImageStore', 1);
dbRequest.onupgradeneeded = (e) => {
  e.target.result.createObjectStore('images');
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
  const CURRENT_VERSION = 'v4_menu_expansion';
  const savedVersion = localStorage.getItem('cafe_app_version');

  try {
    state.products = JSON.parse(localStorage.getItem('cafe_products') || '[]');
    state.orders = JSON.parse(localStorage.getItem('cafe_orders') || '[]');
    
    // Load images for all products from IndexedDB
    for (let p of state.products) {
      state.imageDataCache[p.id] = await loadImage(p.id);
    }
  } catch (e) { console.error('Load failed'); }

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
  state.products = [
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
    
    // New Budget Items (Added from user)
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
  
  // Auto-expand on mobile
  const panel = document.getElementById('order-panel');
  if (window.innerWidth <= 600) {
    panel.classList.add('expanded');
  }
  
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
  const taxEl = document.getElementById('tax-val');
  const totalEl = document.getElementById('total-val');

  if (state.order.length === 0) {
    container.innerHTML = `<div class="empty-order"><span>🛒</span><p>No items yet</p></div>`;
    subtotalEl.textContent = 'AED 0.00';
    totalEl.textContent = 'AED 0.00';
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
  subtotalEl.textContent = fmt(subtotal);
  totalEl.textContent = fmt(total);
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
  const editingId = document.getElementById('editing-product-id').value;

  if (!name) { showToast('Product name is required', 'error'); return; }
  if (isNaN(price) || price < 0) { showToast('Enter a valid price', 'error'); return; }

  if (editingId) {
    const idx = state.products.findIndex(p => p.id === editingId);
    if (idx !== -1) {
      state.products[idx] = { ...state.products[idx], name, category, price };
      showToast('Product updated!', 'success');
    }
  } else {
    const newProduct = { id: genId(), name, category, price, emoji: getCategoryEmoji(category) };
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
          <div style="font-size:11px;color:var(--text-muted)">incl. ${fmt(order.tax)} tax</div>
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
      <td style="padding:3px 0">${i.name}</td>
      <td style="text-align:center;padding:3px 0">x${i.qty}</td>
      <td style="text-align:right;padding:3px 0">AED ${(i.price * i.qty).toFixed(2)}</td>
    </tr>
  `).join('');

  const receiptHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8"/>
      <title>Receipt ${order.id}</title>
      <style>
        @page { size: 80mm auto; margin: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Courier New', monospace;
          font-size: 13px;
          color: #000;
          width: 80mm;
          padding: 8px 10px;
          background: #fff;
        }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .divider { border-top: 1px dashed #000; margin: 6px 0; }
        .logo { font-size: 22px; margin-bottom: 4px; }
        .cafe-name { font-size: 18px; font-weight: bold; margin-bottom: 2px; }
        .small { font-size: 11px; color: #444; }
        table { width: 100%; border-collapse: collapse; }
        th { font-size: 11px; font-weight: bold; padding-bottom: 4px; }
        .total-row td { font-weight: bold; font-size: 15px; padding-top: 4px; }
        .thankyou { font-size: 15px; font-weight: bold; margin-top: 6px; }
      </style>
    </head>
    <body>
      <div class="center">
        <div class="logo">☕</div>
        <div class="cafe-name">${cafeInfo.name}</div>
        <div class="small">${cafeInfo.address}</div>
        <div class="small">${cafeInfo.phone}</div>
      </div>
      <div class="divider"></div>
      <div style="font-size:12px">
        <div><strong>Receipt:</strong> ${order.id}</div>
        <div><strong>Date:</strong> ${fmtDate(order.timestamp)}</div>
        <div><strong>Customer:</strong> ${order.customer || 'Guest'}</div>
        <div><strong>Payment:</strong> ${order.method === 'cash' ? 'Cash' : 'Card'}</div>
      </div>
      <div class="divider"></div>
      <table>
        <thead>
          <tr>
            <th style="text-align:left">Item</th>
            <th style="text-align:center">Qty</th>
            <th style="text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class="divider"></div>
      <table>
        <tr>
          <td>TOTAL</td>
          <td style="text-align:right">AED ${order.total.toFixed(2)}</td>
        </tr>
      </table>
      <div class="divider"></div>
      <div class="center">
        <div class="thankyou">Thank You! 😊</div>
        <div class="small" style="margin-top:6px;">Powered by Seenhub Cafe</div>
      </div>
    </body>
    </html>
  `;

  const printWin = window.open('', '_blank', 'width=320,height=600,toolbar=0,menubar=0,location=0');
  if (printWin) {
    printWin.document.write(receiptHtml);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => {
      printWin.print();
      printWin.close();
    }, 500);
  } else {
    // Fallback: use iframe
    const frame = document.getElementById('print-frame');
    frame.srcdoc = receiptHtml;
    frame.onload = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    };
    showToast('Opening print dialog...', 'success');
  }
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
    // Collapse order panel on mobile to "go back" to dashboard
    document.getElementById('order-panel').classList.remove('expanded');
    navigateTo('pos');
  });
  document.getElementById('payment-modal-print').addEventListener('click', () => {
    closeModal('payment-modal-overlay');
    if (state.lastOrder) printReceipt(state.lastOrder);
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

document.addEventListener('DOMContentLoaded', init);

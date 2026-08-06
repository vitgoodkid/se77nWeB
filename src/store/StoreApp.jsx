import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storeApi } from './api.js';
import './store.css';

const CART_KEY = 'se77n.store.cart.v2';
const ORDER_STATUS = [
  ['new', 'Đơn mới'],
  ['confirmed', 'Đã xác nhận'],
  ['shipping', 'Đang giao'],
  ['completed', 'Hoàn tất'],
  ['cancelled', 'Đã huỷ'],
];

function money(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('zh-TW')} TWD`;
}

function moneyRange(minValue, maxValue = minValue) {
  const min = Math.round(Number(minValue) || 0);
  const max = Math.round(Number(maxValue) || 0);
  if (min === max) return money(min);
  return `${min.toLocaleString('zh-TW')} ~ ${max.toLocaleString('zh-TW')} TWD`;
}
function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 25) : [];
  } catch { return []; }
}

function routeFromPath() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/store';
  if (path === '/store/admin') return { view: 'admin' };
  const match = path.match(/^\/store\/product\/([^/]+)$/);
  if (match) return { view: 'product', id: decodeURIComponent(match[1]) };
  return { view: 'catalog' };
}

function useStoreRoute() {
  const [route, setRoute] = useState(routeFromPath);
  useEffect(() => {
    const onPop = () => setRoute(routeFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((path) => {
    window.history.pushState(null, '', path);
    setRoute(routeFromPath());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  return [route, navigate];
}

function productUnitPrice(product, variant, size) {
  const base = Number(variant?.priceOverride ?? product.price) + Number(product.sizeAdjustments?.[size] || 0);
  return Math.max(0, Math.round(base * (1 - Number(product.discountPercent || 0) / 100)));
}

function totals(items, config) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0);
  const fee = Number(config?.shipping?.fee ?? 38);
  const threshold = Number(config?.shipping?.freeThreshold ?? 700);
  const shippingFee = subtotal >= threshold || items.some((item) => item.freeship) ? 0 : fee;
  return { subtotal, shippingFee, total: subtotal + shippingFee };
}

function ProductArt({ src, alt, className = '' }) {
  return (
    <div className={`ks-art ${className}`}>
      <span className="ks-art__mark" aria-hidden="true">K</span>
      {src && <img src={src} alt={alt} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
    </div>
  );
}

export default function StoreApp() {
  const [route, navigate] = useStoreRoute();
  const [config, setConfig] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cart, setCart] = useState(readCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(null);
  const [toast, setToast] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [quickPicker, setQuickPicker] = useState(null);

  const refreshProducts = useCallback(async () => {
    const payload = await storeApi.products();
    setProducts(payload.products || []);
    return payload.products || [];
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([storeApi.config(), storeApi.products()])
      .then(([configPayload, productsPayload]) => {
        if (!live) return;
        setConfig(configPayload);
        setProducts(productsPayload.products || []);
      })
      .catch((cause) => { if (live) setError(cause.message || 'Không thể tải Store.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const refreshAuth = () => {
      storeApi.config().then(setConfig).catch(() => {});
    };
    window.addEventListener('focus', refreshAuth);
    return () => window.removeEventListener('focus', refreshAuth);
  }, []);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    const oldTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const oldDescription = description?.getAttribute('content');
    const theme = document.querySelector('meta[name="theme-color"]');
    const oldTheme = theme?.getAttribute('content');
    document.title = route.view === 'admin' ? 'KataShop · Admin' : 'KataShop · se77n';
    description?.setAttribute('content', 'KataShop — những món đồ nhỏ cho nhịp sống hằng ngày.');
    theme?.setAttribute('content', '#f6f0e6');
    document.body.classList.add('ks-body');
    return () => {
      document.title = oldTitle;
      if (oldDescription) description?.setAttribute('content', oldDescription);
      if (oldTheme) theme?.setAttribute('content', oldTheme);
      document.body.classList.remove('ks-body');
    };
  }, [route.view]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function addToCart(product, variant, size, quantity = 1, open = true) {
    const key = `${product.id}:${variant.id}:${size}`;
    setCart((current) => {
      const found = current.find((item) => item.key === key);
      if (found) return current.map((item) => item.key === key ? { ...item, quantity: Math.min(99, item.quantity + quantity) } : item);
      return [...current, {
        key,
        productId: product.id,
        title: product.title,
        imageUrl: variant.imageUrl || product.imageUrl,
        variantId: variant.id,
        variantName: variant.name,
        size,
        quantity,
        unitPrice: productUnitPrice(product, variant, size),
        freeship: product.freeship,
      }];
    });
    setToast('Đã thêm vào giỏ');
    if (open) setCartOpen(true);
  }

  function quickCheckout(product, variant, size, quantity) {
    beginCheckout([{
      key: `${product.id}:${variant.id}:${size}`,
      productId: product.id,
      title: product.title,
      imageUrl: variant.imageUrl || product.imageUrl,
      variantId: variant.id,
      variantName: variant.name,
      size,
      quantity,
      unitPrice: productUnitPrice(product, variant, size),
      freeship: product.freeship,
    }], 'buy');
  }
  function changeQuantity(key, value) {
    const quantity = Math.max(0, Math.min(99, Number(value) || 0));
    setCart((current) => quantity === 0
      ? current.filter((item) => item.key !== key)
      : current.map((item) => item.key === key ? { ...item, quantity } : item));
  }

  function beginCheckout(items, source = 'cart') {
    if (!items.length) return setToast('Giỏ hàng đang trống');
    setCartOpen(false);
    setCheckout({ items, source });
  }

  function login(provider = 'discord') {
    if (authBusy) return;
    setAuthBusy(true);
    const popup = window.open(`/api/auth/${provider}/start`, 'katashop-login', 'popup=yes,width=520,height=720');
    if (!popup) {
      setAuthBusy(false);
      setToast('Trình duyệt đã chặn cửa sổ đăng nhập.');
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(async () => {
      if (popup.closed || Date.now() - started > 120000) {
        window.clearInterval(timer);
        setAuthBusy(false);
        return;
      }
      try {
        const next = await storeApi.config();
        if (next.admin?.signedIn) {
          popup.close();
          window.clearInterval(timer);
          setConfig(next);
          setAuthBusy(false);
          setToast('Đã đăng nhập');
        }
      } catch { /* OAuth is still in progress */ }
    }, 1200);
  }

  async function logout() {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Logout failed');
      const next = await storeApi.config();
      setConfig(next);
      if (route.view === 'admin') navigate('/store');
      setToast('Đã đăng xuất');
    } catch {
      setToast('Không thể đăng xuất. Vui lòng thử lại.');
    } finally {
      setAuthBusy(false);
    }
  }

  const selectedProduct = route.view === 'product'
    ? products.find((product) => product.id === route.id)
    : null;

  return (
    <div className="ks-shell">
      <StoreHeader
        route={route}
        navigate={navigate}
        cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)}
        onCart={() => setCartOpen(true)}
        config={config}
        authBusy={authBusy}
        onLogin={() => login('discord')}
        onLogout={logout}
      />

      {loading && <StoreLoading />}
      {!loading && error && <StoreError message={error} onRetry={() => window.location.reload()} />}
      {!loading && !error && route.view === 'catalog' && (
        <Catalog products={products} navigate={navigate} config={config} onQuickAction={(product, action) => setQuickPicker({ product, action })} />
      )}
      {!loading && !error && route.view === 'product' && (
        selectedProduct
          ? <ProductDetail key={selectedProduct.id} product={selectedProduct} navigate={navigate} addToCart={addToCart} beginCheckout={beginCheckout} />
          : <StoreError message="Sản phẩm này không còn tồn tại." onRetry={() => navigate('/store')} retryLabel="Về cửa hàng" />
      )}
      {!loading && !error && route.view === 'admin' && (
        <Admin config={config} setConfig={setConfig} refreshPublicProducts={refreshProducts} />
      )}

      {route.view !== 'admin' && (
        <StoreFooter config={config} navigate={navigate} />
      )}
      {route.view !== 'admin' && (
        <StoreFloatingActions cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)} onCart={() => setCartOpen(true)} />
      )}

      <CartDrawer
        open={cartOpen}
        items={cart}
        config={config}
        onClose={() => setCartOpen(false)}
        onQuantity={changeQuantity}
        onCheckout={() => beginCheckout(cart)}
      />
      {checkout && (
        <Checkout
          checkout={checkout}
          config={config}
          onClose={() => setCheckout(null)}
          onSuccess={() => { if (checkout.source === 'cart') setCart([]); }}
        />
      )}
      {quickPicker && <QuickProductPicker key={`${quickPicker.product.id}-${quickPicker.action}`} product={quickPicker.product} action={quickPicker.action} onClose={() => setQuickPicker(null)} onConfirm={(variant, size, quantity) => {
        const { product, action } = quickPicker;
        setQuickPicker(null);
        if (action === 'cart') addToCart(product, variant, size, quantity);
        else quickCheckout(product, variant, size, quantity);
      }} />}      {toast && <div className="ks-toast" role="status">{toast}</div>}
    </div>
  );
}

function StoreHeader({ route, navigate, cartCount, onCart, config, authBusy, onLogin, onLogout }) {
  const auth = config?.admin;
  return (
    <header className="ks-header">
      <button className="ks-brand" type="button" onClick={() => navigate('/store')} aria-label="KataShop home">
        <span className="ks-brand__seal">K</span>
        <span><strong>KataShop</strong><small>by se77n</small></span>
      </button>
      <nav className="ks-nav" aria-label="Điều hướng cửa hàng">
        <button className={route.view === 'catalog' ? 'is-active' : ''} type="button" onClick={() => navigate('/store')}>Cửa hàng</button>
        <a href="/">se77n</a>
        {auth?.allowed && (
          <button className={route.view === 'admin' ? 'is-active' : ''} type="button" onClick={() => navigate('/store/admin')}>Admin</button>
        )}
      </nav>
      <div className="ks-header__actions">
        {auth && (auth.signedIn ? (
          <button className="ks-auth-button" type="button" disabled={authBusy} onClick={onLogout}>
            {authBusy ? 'Đang xử lý…' : 'Logout'}
          </button>
        ) : (
          <button className="ks-auth-button" type="button" disabled={authBusy} onClick={onLogin}>
            {authBusy ? 'Đang đăng nhập…' : 'Login'}
          </button>
        ))}
        {route.view !== 'admin' ? (
          <button className="ks-cart-button" type="button" onClick={onCart}>
            <span>Giỏ hàng</span><strong>{cartCount}</strong>
          </button>
        ) : <span className="ks-admin-badge">CONTROL ROOM</span>}
      </div>
    </header>
  );
}

function Catalog({ products, navigate, config, onQuickAction }) {
  const [filter, setFilter] = useState('all');
  const catalogProducts = useMemo(() => {
    const shuffled = [...products];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }, [products]);
  const shown = catalogProducts.filter((product) => {
    if (filter === 'all') return true;
    const genders = Array.isArray(product.genders) ? product.genders : [];
    const hasExplicitGender = genders.some((gender) => gender === 'men' || gender === 'women');
    return genders.includes(filter) || (!hasExplicitGender && genders.includes('unisex'));
  });
  const featuredProducts = useMemo(() => products.filter((product) => product.featured && product.hasStock), [products]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  useEffect(() => {
    setFeaturedIndex(0);
    if (featuredProducts.length < 2) return undefined;
    const timer = window.setInterval(() => setFeaturedIndex((current) => (current + 1) % featuredProducts.length), 2000);
    return () => window.clearInterval(timer);
  }, [featuredProducts.length]);
  const featured = featuredProducts[featuredIndex] || null;
  return (
    <main className="ks-home">
      <section className="ks-hero ks-hero--closing">
        <div className="ks-hero__copy">
          <p className="ks-kicker">KATASHOP / DROP 01</p>
          <h1>Đồ mặc mỗi ngày.<br /><em>Một chút khác thường.</em></h1>
          <p className="ks-hero__lead">Những món đồ nhỏ được chọn cho ngày dài, đêm muộn và mọi đoạn ở giữa.</p>
          <div className="ks-hero__actions">
            <a href="#catalog" className="ks-button ks-button--dark">Xem bộ sưu tập</a>
            {config?.support?.url && <a href={config.support.url} target="_blank" rel="noreferrer" className="ks-text-link">Cần tư vấn? ↗</a>}
          </div>
        </div>
        <div className="ks-hero__visual" aria-hidden="true">
          {featured?.imageUrl && <img className="ks-hero__product-image" key={featured.id} src={featured.imageUrl} alt="" />}
          <div className="ks-hero__orbit ks-hero__orbit--one" />
          <div className="ks-hero__orbit ks-hero__orbit--two" />
          <p>MADE FOR<br />THE IN-BETWEEN</p>
        </div>
        {featured && (
          <button className="ks-featured-ticket" type="button" onClick={() => navigate(`/store/product/${encodeURIComponent(featured.id)}`)} aria-label={`Xem sản phẩm featured: ${featured.title}`}>
            <div className="ks-featured-ticket__content" key={`${featured.id}-${featuredIndex}`}>
              <div className="ks-featured-ticket__top"><span>FEATURED · ĐANG BÁN</span><small>{String(featuredIndex + 1).padStart(2, '0')} / {String(featuredProducts.length).padStart(2, '0')}</small></div>
              <strong>{featured.title}</strong>
              <em>{moneyRange(featured.minPrice, featured.maxPrice)}</em>
            </div>
            {featuredProducts.length > 1 && <div className="ks-featured-ticket__dots" aria-hidden="true">{featuredProducts.map((product, index) => <i className={index === featuredIndex ? 'is-active' : ''} key={product.id} />)}</div>}
          </button>
        )}
      </section>

      <section className="ks-catalog ks-catalog--first" id="catalog">
        <div className="ks-section-head">
          <div><p className="ks-kicker">THE CURRENT EDIT</p><h2>Chọn món hợp gu</h2></div>
          <div className="ks-filters" role="group" aria-label="Lọc sản phẩm">
            {[['all', 'Tất cả'], ['men', 'Nam'], ['women', 'Nữ']].map(([value, label]) => (
              <button type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)} key={value}>{label}</button>
            ))}
          </div>
        </div>
        {shown.length ? (
          <div className="ks-product-grid">
            {shown.map((product, index) => <ProductCard key={product.id} product={product} index={index} navigate={navigate} onQuickAction={onQuickAction} />)}
          </div>
        ) : <div className="ks-empty">Chưa có sản phẩm trong nhóm này.</div>}
      </section>

      <section className="ks-promise">
        <p className="ks-kicker">THE SMALL PRINT</p>
        <div><strong>38 TWD</strong><span>phí giao hàng tiêu chuẩn</span></div>
        <div><strong>{money(config?.shipping?.freeThreshold || 700)}</strong><span>mốc miễn phí vận chuyển</span></div>
        <div><strong>1:1</strong><span>hỗ trợ chọn size trước khi đặt</span></div>
      </section>
    </main>
  );
}

function ProductCard({ product, index, navigate, onQuickAction }) {
  const variant = product.variants.find((entry) => entry.hasStock) || product.variants[0];
  return (
    <article className={`ks-product-card ks-product-card--${index % 3}`}>
      <button className="ks-product-card__media" type="button" onClick={() => navigate(`/store/product/${encodeURIComponent(product.id)}`)} aria-label={`Xem ${product.title}`}>
        <ProductArt src={product.imageUrl} alt={product.title} />
        {product.discountPercent > 0 && <span className="ks-sale-tag">−{product.discountPercent}%</span>}
        {product.freeship && <span className="ks-ship-tag">FREE SHIP</span>}
      </button>
      <div className="ks-product-card__body">
        <div><p>{product.subtitle || 'KataShop edition'}</p><h3>{product.title}</h3></div>
        <div className="ks-product-card__price">
          <strong>{moneyRange(product.minPrice, product.maxPrice)}</strong>
          {product.discountPercent > 0 && product.minPrice === product.maxPrice && <del>{money(product.price)}</del>}
        </div>
        <div className="ks-product-card__foot">
          <div className="ks-swatches" aria-label="Màu sắc">
            {product.variants.slice(0, 5).map((entry) => <span key={entry.id} title={entry.name} style={{ background: entry.colorHex }} />)}
          </div>
          <button type="button" onClick={() => navigate(`/store/product/${encodeURIComponent(product.id)}`)}>Xem chi tiết →</button>
        </div>
        <div className="ks-product-card__quick-actions">
          <button className="ks-quick-cart" type="button" onClick={() => onQuickAction(product, 'cart')}>Giỏ hàng</button>
          <button className="ks-quick-buy" type="button" onClick={() => onQuickAction(product, 'buy')}>Mua ngay</button>
        </div>
      </div>
    </article>
  );
}

function QuickProductPicker({ product, action, onClose, onConfirm }) {
  const firstVariant = product.variants.find((variant) => variant.hasStock) || product.variants[0];
  const [variantId, setVariantId] = useState(firstVariant?.id || '');
  const variant = product.variants.find((entry) => entry.id === variantId) || firstVariant;
  const firstSize = product.sizes.find((size) => Number(variant?.stockBySize?.[size] || 0) > 0) || product.sizes[0];
  const [size, setSize] = useState(firstSize);
  const [quantity, setQuantity] = useState(1);
  const available = Number(variant?.stockBySize?.[size] || 0);
  const price = productUnitPrice(product, variant, size);

  function pickVariant(id) {
    setVariantId(id);
    const next = product.variants.find((entry) => entry.id === id);
    setSize(product.sizes.find((entry) => Number(next?.stockBySize?.[entry] || 0) > 0) || product.sizes[0]);
    setQuantity(1);
  }

  return (
    <div className="ks-modal" role="dialog" aria-modal="true" aria-label="Chọn mẫu và kích thước">
      <button className="ks-modal__backdrop" type="button" onClick={onClose} aria-label="Đóng" />
      <section className="ks-quick-picker">
        <header><div><p className="ks-kicker">QUICK ORDER</p><h2>Chọn mẫu trước khi mua</h2></div><button type="button" onClick={onClose} aria-label="Đóng">×</button></header>
        <div className="ks-quick-picker__product"><ProductArt src={variant?.imageUrl || product.imageUrl} alt={product.title} /><div><h3>{product.title}</h3><strong>{money(price)}</strong><p>{variant?.name}</p></div></div>
        <fieldset className="ks-option"><legend>Mẫu <span>{variant?.name}</span></legend><div className="ks-color-options">{product.variants.map((entry) => <button key={entry.id} type="button" className={entry.id === variant?.id ? 'is-active' : ''} onClick={() => pickVariant(entry.id)}><span style={{ background: entry.colorHex }} /><small>{entry.name}</small></button>)}</div></fieldset>
        <fieldset className="ks-option"><legend>Kích thước <span>{size}</span></legend><div className="ks-size-options">{product.sizes.map((entry) => { const count = Number(variant?.stockBySize?.[entry] || 0); return <button key={entry} type="button" disabled={!count} className={entry === size ? 'is-active' : ''} onClick={() => { setSize(entry); setQuantity(1); }}>{entry}<small>{count ? `${count} còn` : 'hết'}</small></button>; })}</div></fieldset>
        <div className="ks-quick-picker__footer"><div className="ks-stepper"><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button><strong>{quantity}</strong><button type="button" onClick={() => setQuantity((value) => Math.min(available, value + 1))}>+</button></div><button className={`ks-button ${action === 'buy' ? 'ks-button--rose' : 'ks-button--dark'} ks-quick-picker__confirm`} type="button" disabled={!available} onClick={() => onConfirm(variant, size, quantity)}>{action === 'buy' ? `Mua ngay · ${money(price * quantity)}` : 'Thêm vào giỏ'}</button></div>
      </section>
    </div>
  );
}
function ProductGallery({ product, variant }) {
  const images = useMemo(() => [...new Set([
    variant?.imageUrl,
    product.imageUrl,
    ...(product.galleryImages || []),
  ].filter(Boolean))], [product.galleryImages, product.imageUrl, variant?.imageUrl]);
  const [activeIndex, setActiveIndex] = useState(0);
  const swipeStart = useRef(null);

  useEffect(() => setActiveIndex(0), [variant?.id, product.id]);
  const move = (direction) => setActiveIndex((current) => (current + direction + images.length) % images.length);
  const onTouchStart = (event) => { swipeStart.current = event.touches[0]?.clientX ?? null; };
  const onTouchEnd = (event) => {
    const start = swipeStart.current;
    const end = event.changedTouches[0]?.clientX;
    swipeStart.current = null;
    if (start === null || end === undefined || Math.abs(end - start) < 42) return;
    move(end < start ? 1 : -1);
  };

  return (
    <div className="ks-product-gallery">
      <div className="ks-product-gallery__stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <ProductArt src={images[activeIndex]} alt={`${product.title} — ảnh ${activeIndex + 1}`} />
        {images.length > 1 && <><button className="ks-gallery-nav ks-gallery-nav--prev" type="button" onClick={() => move(-1)} aria-label="Ảnh trước">←</button><button className="ks-gallery-nav ks-gallery-nav--next" type="button" onClick={() => move(1)} aria-label="Ảnh sau">→</button><span className="ks-gallery-count">{activeIndex + 1} / {images.length}</span></>}
      </div>
      {images.length > 1 && <div className="ks-gallery-thumbs" aria-label="Chọn ảnh sản phẩm">{images.map((src, index) => <button className={index === activeIndex ? 'is-active' : ''} type="button" onClick={() => setActiveIndex(index)} key={src}><img src={src} alt={`Ảnh ${index + 1}`} /></button>)}</div>}
    </div>
  );
}
function ProductDetail({ product, navigate, addToCart, beginCheckout }) {
  const firstVariant = product.variants.find((variant) => variant.hasStock) || product.variants[0];
  const [variantId, setVariantId] = useState(firstVariant?.id || '');
  const variant = product.variants.find((entry) => entry.id === variantId) || firstVariant;
  const firstSize = product.sizes.find((size) => Number(variant?.stockBySize?.[size] || 0) > 0) || product.sizes[0];
  const [size, setSize] = useState(firstSize);
  const [quantity, setQuantity] = useState(1);
  const available = Number(variant?.stockBySize?.[size] || 0);
  const price = productUnitPrice(product, variant, size);

  function pickVariant(id) {
    setVariantId(id);
    const next = product.variants.find((entry) => entry.id === id);
    const nextSize = product.sizes.find((entry) => Number(next?.stockBySize?.[entry] || 0) > 0) || product.sizes[0];
    setSize(nextSize);
    setQuantity(1);
  }

  const lineItem = {
    key: `${product.id}:${variant.id}:${size}`,
    productId: product.id,
    title: product.title,
    imageUrl: variant.imageUrl || product.imageUrl,
    variantId: variant.id,
    variantName: variant.name,
    size,
    quantity,
    unitPrice: price,
    freeship: product.freeship,
  };

  return (
    <main className="ks-detail">
      <button className="ks-back" type="button" onClick={() => navigate('/store')}>← Trở lại bộ sưu tập</button>
      <div className="ks-detail__grid">
        <div className="ks-detail__media">
          <ProductGallery product={product} variant={variant} />
          <div className="ks-detail__stamp"><span>KATA</span><strong>{product.id.slice(0, 12).toUpperCase()}</strong></div>
        </div>
        <section className="ks-detail__info">
          <p className="ks-kicker">KATASHOP / {product.featured ? 'FEATURED' : 'CURRENT DROP'}</p>
          <h1>{product.title}</h1>
          <p className="ks-detail__subtitle">{product.subtitle}</p>
          <div className="ks-detail__price"><strong>{money(price)}</strong>{product.discountPercent > 0 && <><del>{money((variant?.priceOverride ?? product.price) + Number(product.sizeAdjustments?.[size] || 0))}</del><span>−{product.discountPercent}%</span></>}</div>
          <p className="ks-detail__description">{product.description}</p>

          <fieldset className="ks-option"><legend>Phối màu <span>{variant?.name}</span></legend><div className="ks-color-options">
            {product.variants.map((entry) => (
              <button key={entry.id} type="button" className={entry.id === variant?.id ? 'is-active' : ''} onClick={() => pickVariant(entry.id)} title={entry.name}>
                <span style={{ background: entry.colorHex }} /><small>{entry.name}</small>
              </button>
            ))}
          </div></fieldset>

          <fieldset className="ks-option"><legend>Kích thước <span>{size}</span></legend><div className="ks-size-options">
            {product.sizes.map((entry) => {
              const count = Number(variant?.stockBySize?.[entry] || 0);
              return <button key={entry} type="button" disabled={!count} className={entry === size ? 'is-active' : ''} onClick={() => { setSize(entry); setQuantity(1); }}>{entry}<small>{count ? `${count} còn` : 'hết'}</small></button>;
            })}
          </div></fieldset>

          <div className="ks-buy-row">
            <div className="ks-stepper"><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button><strong>{quantity}</strong><button type="button" onClick={() => setQuantity((value) => Math.min(available, value + 1))}>+</button></div>
            <button className="ks-button ks-button--dark" type="button" disabled={!available} onClick={() => addToCart(product, variant, size, quantity)}>Thêm vào giỏ</button>
            <button className="ks-button ks-button--rose" type="button" disabled={!available} onClick={() => beginCheckout([lineItem], 'buy')}>Mua ngay</button>
          </div>
          <div className="ks-detail__notes"><span>{product.freeship ? '✓ Sản phẩm được miễn phí giao hàng' : '✓ Phí giao hàng hiển thị trước khi đặt'}</span><span>✓ Tồn kho được kiểm tra lại khi gửi đơn</span></div>
        </section>
      </div>
    </main>
  );
}

function CartDrawer({ open, items, config, onClose, onQuantity, onCheckout }) {
  const summary = totals(items, config);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <div className={`ks-drawer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <button className="ks-drawer__backdrop" type="button" onClick={onClose} aria-label="Đóng giỏ hàng" />
      <aside className="ks-drawer__panel" aria-label="Giỏ hàng">
        <div className="ks-drawer__head"><div><p className="ks-kicker">YOUR SELECTION</p><h2>Giỏ hàng</h2></div><button type="button" onClick={onClose} aria-label="Đóng">×</button></div>
        <div className="ks-cart-list">
          {!items.length && <div className="ks-empty"><strong>Giỏ hàng còn trống.</strong><span>Chọn một món hợp gu rồi quay lại đây nhé.</span></div>}
          {items.map((item) => (
            <div className="ks-cart-item" key={item.key}>
              <ProductArt src={item.imageUrl} alt={item.title} />
              <div className="ks-cart-item__info">
                <h3>{item.title}</h3>
                <p>{item.variantName} · {item.size}</p>
                <strong>{money(item.unitPrice)}</strong>
              </div>
              <div className="ks-cart-item__controls">
                <div className="ks-cart-item__qty">
                  <button type="button" onClick={() => onQuantity(item.key, item.quantity - 1)} aria-label="Giảm số lượng">−</button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => onQuantity(item.key, item.quantity + 1)} aria-label="Tăng số lượng">+</button>
                </div>
                <button
                  className="ks-cart-item__remove"
                  type="button"
                  onClick={() => onQuantity(item.key, 0)}
                  aria-label={`Xoá ${item.title} khỏi giỏ`}
                >
                  Xoá
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="ks-drawer__foot">
          <div><span>Tạm tính</span><strong>{money(summary.subtotal)}</strong></div>
          <div><span>Phí giao hàng</span><strong>{summary.shippingFee ? money(summary.shippingFee) : 'Miễn phí'}</strong></div>
          <div className="ks-drawer__total"><span>Tổng cộng</span><strong>{money(summary.total)}</strong></div>
          <button className="ks-button ks-button--dark" type="button" disabled={!items.length} onClick={onCheckout}>Tiếp tục đặt hàng</button>
        </div>
      </aside>
    </div>
  );
}

function Checkout({ checkout, config, onClose, onSuccess }) {
  const [form, setForm] = useState({ fullName: '', phone: '', address: '', note: '' });
  const [mapImages, setMapImages] = useState([]);
  const mapImageLimit = 3;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const summary = totals(checkout.items, config);

  async function pickMaps(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const remaining = Math.max(0, mapImageLimit - mapImages.length);
    if (!remaining) { setError(`Chỉ có thể gửi tối đa ${mapImageLimit} ảnh vị trí.`); return; }
    const accepted = selected.slice(0, remaining).filter((file) => file.type.match(/^image\/(png|jpeg|webp)$/i) && file.size <= 1024 * 1024);
    if (!accepted.length) { setError('Mỗi ảnh vị trí phải là PNG, JPG hoặc WebP và nhỏ hơn 1 MB.'); return; }
    const images = await Promise.all(accepted.map(async (file) => ({ fileName: file.name, dataUrl: await fileToDataUrl(file) })));
    setMapImages((current) => [...current, ...images]);
    setError(accepted.length < selected.length ? `Đã thêm ${accepted.length} ảnh. Mỗi ảnh phải nhỏ hơn 1 MB, tối đa ${mapImageLimit} ảnh.` : '');
  }

  function removeMapImage(index) {
    setMapImages((current) => current.filter((_, imageIndex) => imageIndex !== index));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = await storeApi.createOrder({
        customer: form,
        mapImages,
        items: checkout.items.map(({ productId, variantId, size, quantity }) => ({ productId, variantId, size, quantity })),
      });
      setSuccess(payload.order);
      onSuccess();
    } catch (cause) { setError(cause.message || 'Không thể gửi đơn hàng.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="ks-modal" role="dialog" aria-modal="true" aria-label="Đặt hàng">
      <button className="ks-modal__backdrop" type="button" onClick={onClose} aria-label="Đóng" />
      <div className="ks-checkout">
        {success ? (
          <div className="ks-success">
            <span className="ks-success__seal">✓</span><p className="ks-kicker">ORDER RECEIVED</p><h2>Cảm ơn bạn.</h2>
            <p>Đơn <strong>{success.id}</strong> đã được ghi nhận. KataShop sẽ liên hệ qua số điện thoại để xác nhận.</p>
            <button className="ks-button ks-button--dark" type="button" onClick={onClose}>Tiếp tục xem Store</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="ks-checkout__head"><div><p className="ks-kicker">CHECKOUT</p><h2>Thông tin nhận hàng</h2></div><button type="button" onClick={onClose} aria-label="Đóng">×</button></div>
            <div className="ks-checkout__layout">
              <div className="ks-checkout__fields">
                <label><span>Họ và tên *</span><input required autoComplete="name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
                <label><span>Số điện thoại *</span><input required autoComplete="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
                <label><span>Địa chỉ nhận hàng</span><textarea rows="4" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Số nhà, đường, khu vực…" /></label>
                <label><span>Ghi chú cho cửa hàng</span><textarea rows="3" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Ví dụ: gọi trước khi giao, giờ nhận hàng…" /></label>
                <div className="ks-map-upload">
                  <label className="ks-file"><span>Ảnh map / vị trí (tối đa 3 ảnh)</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { pickMaps(event.target.files); event.target.value = ''; }} /><strong>{mapImages.length ? '+ Thêm ảnh vị trí' : 'Chọn ảnh (không bắt buộc nếu đã nhập địa chỉ)'}</strong></label>
                  {!!mapImages.length && <div className="ks-map-upload__list">{mapImages.map((image, index) => <div className="ks-map-upload__item" key={`${image.fileName}-${index}`}><img src={image.dataUrl} alt={`Ảnh vị trí ${index + 1}`} /><span>{image.fileName}</span><button type="button" onClick={() => removeMapImage(index)} aria-label={`Xoá ảnh ${index + 1}`}>×</button></div>)}</div>}
                </div>
              </div>
              <div className="ks-order-preview">
                <p className="ks-kicker">YOUR ORDER</p>
                {checkout.items.map((item) => <div className="ks-order-preview__item" key={item.key}><span>{item.title}<small>{item.variantName} · {item.size} · ×{item.quantity}</small></span><strong>{money(item.unitPrice * item.quantity)}</strong></div>)}
                <div className="ks-order-preview__line"><span>Tạm tính</span><strong>{money(summary.subtotal)}</strong></div>
                <div className="ks-order-preview__line"><span>Giao hàng</span><strong>{summary.shippingFee ? money(summary.shippingFee) : 'Miễn phí'}</strong></div>
                <div className="ks-order-preview__total"><span>Tổng cộng</span><strong>{money(summary.total)}</strong></div>
              </div>
            </div>
            {error && <p className="ks-form-error" role="alert">{error}</p>}
            <button className="ks-button ks-button--dark ks-checkout__submit" disabled={busy} type="submit">{busy ? 'Đang gửi đơn…' : `Xác nhận · ${money(summary.total)}`}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được ảnh.'));
    reader.readAsDataURL(file);
  });
}

function Admin({ config, setConfig, refreshPublicProducts }) {
  const [localConfig, setLocalConfig] = useState(config);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  useEffect(() => setLocalConfig(config), [config]);

  async function login(provider) {
    setLoginBusy(true); setLoginError('');
    const popup = window.open(`/api/auth/${provider}/start`, 'katashop-login', 'popup=yes,width=520,height=720');
    if (!popup) { setLoginBusy(false); setLoginError('Trình duyệt đã chặn cửa sổ đăng nhập.'); return; }
    const started = Date.now();
    const timer = window.setInterval(async () => {
      if (popup.closed || Date.now() - started > 120000) {
        window.clearInterval(timer); setLoginBusy(false); return;
      }
      try {
        const next = await storeApi.config();
        if (next.admin?.signedIn) {
          popup.close(); window.clearInterval(timer); setLoginBusy(false); setLocalConfig(next); setConfig(next);
        }
      } catch { /* OAuth is still in progress */ }
    }, 1200);
  }

  if (!localConfig?.admin?.signedIn) return <AdminLogin busy={loginBusy} error={loginError} login={login} />;
  if (!localConfig.admin.allowed) return <AdminDenied user={localConfig.admin.user} />;
  return <AdminWorkspace user={localConfig.admin.user} refreshPublicProducts={refreshPublicProducts} />;
}

function AdminLogin({ busy, error, login }) {
  return (
    <main className="ks-admin-gate">
      <div className="ks-admin-gate__card"><p className="ks-kicker">KATASHOP / CONTROL ROOM</p><h1>Đăng nhập để quản lý Store.</h1><p>Phiên đăng nhập dùng chung với se77n. Chỉ tài khoản owner mới xem được sản phẩm và đơn hàng.</p>
        <div><button className="ks-button ks-button--dark" disabled={busy} type="button" onClick={() => login('discord')}>Đăng nhập Discord</button><button className="ks-button ks-button--light" disabled={busy} type="button" onClick={() => login('google')}>Đăng nhập Google</button></div>
        {busy && <small>Đang chờ bạn hoàn tất đăng nhập ở cửa sổ mới…</small>}{error && <p className="ks-form-error">{error}</p>}
      </div>
    </main>
  );
}

function AdminDenied({ user }) {
  return <main className="ks-admin-gate"><div className="ks-admin-gate__card"><p className="ks-kicker">ACCESS DENIED</p><h1>Tài khoản chưa được cấp quyền.</h1><p>Đang đăng nhập với <strong>{user?.displayName || 'tài khoản hiện tại'}</strong>. Quyền quản trị được kiểm tra ở máy chủ.</p><a className="ks-button ks-button--dark" href="/">Quay lại se77n</a></div></main>;
}

function emptyProduct() {
  return {
    id: '', title: '', subtitle: '', description: '', price: 0, discountPercent: 0,
    imageUrl: '/og.svg', galleryImages: [], genders: ['unisex'], sizes: [], sizeAdjustments: {},
    freeship: false, featured: false, active: true,
    variants: [{ id: 'default', name: 'Default', colorHex: '#d36a79', imageUrl: '/og.svg', priceOverride: null, stockBySize: {} }],
  };
}

function AdminWorkspace({ user, refreshPublicProducts }) {
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [productPayload, orderPayload] = await Promise.all([storeApi.products(true), storeApi.orders()]);
      setProducts(productPayload.products || []); setOrders(orderPayload.orders || []);
    } catch (cause) { setError(cause.message || 'Không tải được dữ liệu quản trị.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function removeProduct(product) {
    if (!window.confirm(`Xoá “${product.title}”?`)) return;
    try { await storeApi.deleteProduct(product.id); await load(); await refreshPublicProducts(); }
    catch (cause) { setError(cause.message); }
  }

  async function updateStatus(id, status) {
    try {
      const payload = await storeApi.updateOrder(id, status);
      setOrders((current) => current.map((order) => order.id === id ? payload.order : order));
    } catch (cause) { setError(cause.message); }
  }

  async function removeOrder(order) {
    if (!window.confirm(`Xoá đơn ${order.id}?`)) return;
    try { await storeApi.deleteOrder(order.id); setOrders((current) => current.filter((entry) => entry.id !== order.id)); }
    catch (cause) { setError(cause.message); }
  }

  return (
    <main className="ks-admin">
      <section className="ks-admin__hero"><div><p className="ks-kicker">KATASHOP / CONTROL ROOM</p><h1>Chào, {user?.displayName || 'owner'}.</h1><p>Quản lý bộ sưu tập, tồn kho và đơn hàng trong cùng một nơi.</p></div><div className="ks-admin__stats"><span><strong>{products.length}</strong>sản phẩm</span><span><strong>{orders.filter((order) => order.status === 'new').length}</strong>đơn mới</span><span><strong>{money(orders.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + order.total, 0))}</strong>tổng giá trị</span></div></section>
      <div className="ks-admin__tabs"><button type="button" className={tab === 'products' ? 'is-active' : ''} onClick={() => setTab('products')}>Sản phẩm</button><button type="button" className={tab === 'orders' ? 'is-active' : ''} onClick={() => setTab('orders')}>Đơn hàng <span>{orders.filter((order) => order.status === 'new').length}</span></button><button type="button" onClick={load}>Làm mới ↻</button></div>
      {error && <p className="ks-form-error ks-admin__error">{error}</p>}
      {loading ? <StoreLoading compact /> : tab === 'products' ? (
        <section className="ks-admin-panel">
          <div className="ks-admin-panel__head"><div><p className="ks-kicker">CATALOG</p><h2>Bộ sưu tập hiện tại</h2></div><button className="ks-button ks-button--dark" type="button" onClick={() => setEditor(emptyProduct())}>+ Thêm sản phẩm</button></div>
          <div className="ks-admin-products">{products.map((product, index) => <AdminProductRow key={product.id} product={product} index={index} onEdit={() => setEditor(product)} onDelete={() => removeProduct(product)} />)}</div>
        </section>
      ) : <Orders orders={orders} onStatus={updateStatus} onDelete={removeOrder} />}
      {editor && <ProductEditor product={editor} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await load(); await refreshPublicProducts(); }} />}
    </main>
  );
}

function AdminProductRow({ product, index, onEdit, onDelete }) {
  const variants = product.variants?.length ? product.variants : [];
  return (
    <article className={`ks-product-card ks-admin-product-card ks-product-card--${index % 3}`}>
      <div className="ks-product-card__media">
        <ProductArt src={product.imageUrl} alt={product.title} />
        {product.discountPercent > 0 && <span className="ks-sale-tag">−{product.discountPercent}%</span>}
        {product.freeship && <span className="ks-ship-tag">FREE SHIP</span>}
      </div>
      <div className="ks-product-card__body">
        <div><p>{product.subtitle || 'KataShop edition'}</p><h3>{product.title}</h3></div>
        <div className="ks-product-card__price"><strong>{moneyRange(product.minPrice, product.maxPrice)}</strong>{product.discountPercent > 0 && product.minPrice === product.maxPrice && <del>{money(product.price)}</del>}</div>
        <div className="ks-product-card__foot">
          <div className="ks-swatches" aria-label="Màu sắc">{variants.slice(0, 5).map((variant) => <span key={variant.id} title={variant.name} style={{ background: variant.colorHex }} />)}</div>
          <span className={product.active ? 'is-live' : 'is-hidden'}>{product.active ? `${variants.length} mẫu · ${product.totalStock} còn` : 'Đang ẩn'}</span>
        </div>
        <div className="ks-product-card__quick-actions">
          <button className="ks-quick-cart ks-admin-product-card__delete" type="button" onClick={onDelete}>Xóa</button>
          <button className="ks-quick-buy" type="button" onClick={onEdit}>Chỉnh sửa</button>
        </div>
      </div>
    </article>
  );
}

function Orders({ orders, onStatus, onDelete }) {
  return (
    <section className="ks-admin-panel"><div className="ks-admin-panel__head"><div><p className="ks-kicker">ORDERS</p><h2>Đơn hàng gần đây</h2></div></div>
      {!orders.length ? <div className="ks-empty">Chưa có đơn hàng.</div> : <div className="ks-orders">{orders.map((order) => (
        <article className="ks-order" key={order.id}>
          <header><div><span className={`ks-status ks-status--${order.status}`}>{ORDER_STATUS.find(([value]) => value === order.status)?.[1] || order.status}</span><h3>{order.id}</h3><p>{new Date(order.createdAt).toLocaleString('vi-VN')}</p></div><strong>{money(order.total)}</strong></header>
          <div className="ks-order__body"><div><p className="ks-kicker">CUSTOMER</p><strong>{order.customer.fullName}</strong><span>{order.customer.phone}</span><span>{order.customer.address || 'Có ảnh map đính kèm'}</span>{order.mapImages?.length ? <small>{order.mapImages.length} ảnh vị trí đính kèm</small> : null}{order.customer.note ? <small>Ghi chú: {order.customer.note}</small> : null}</div><div><p className="ks-kicker">ITEMS</p>{order.items.map((item, index) => <span key={`${item.productId}-${index}`}>{item.title} ×{item.quantity}<small>{item.variantName} · {item.size}</small></span>)}</div></div>
          <footer><select value={order.status} onChange={(event) => onStatus(order.id, event.target.value)}>{ORDER_STATUS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="is-danger" type="button" onClick={() => onDelete(order)}>Xoá đơn</button></footer>
        </article>
      ))}</div>}
    </section>
  );
}

function ImageField({ label, value, onChange, onPick, uploadLabel }) {
  return (
    <div className="ks-image-field">
      <div className="ks-image-field__preview"><ProductArt src={value} alt={label} /></div>
      <div className="ks-image-field__controls">
        <label><span>{label} URL</span><input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder="https://..." /></label>
        <label className="ks-file ks-file--small"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onPick(event.target.files?.[0])} /><strong>{uploadLabel}</strong></label>
        {value && <a href={value} target="_blank" rel="noreferrer">Mở ảnh ↗</a>}
      </div>
    </div>
  );
}

function ProductEditor({ product, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => ({ ...product, variants: product.variants.map((variant) => ({ ...variant, stockBySize: { ...variant.stockBySize } })) }));
  const [sizeInputs, setSizeInputs] = useState(() => product.sizes.length ? [...product.sizes] : ['']);
  const [galleryImages, setGalleryImages] = useState(() => [...(product.galleryImages || [])]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sizes = useMemo(() => [...new Set(sizeInputs.map((entry) => entry.trim()).filter(Boolean))], [sizeInputs]);

  function patch(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  function patchVariant(index, key, value) { setDraft((current) => ({ ...current, variants: current.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, [key]: value } : variant) })); }
  function patchStock(index, size, value) { setDraft((current) => ({ ...current, variants: current.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, stockBySize: { ...variant.stockBySize, [size]: Math.max(0, Number(value) || 0) } } : variant) })); }
  function patchSize(index, value) { setSizeInputs((current) => current.map((size, sizeIndex) => sizeIndex === index ? value : size)); }
  function addSize() { setSizeInputs((current) => [...current, '']); }
  function removeSize(index) { setSizeInputs((current) => current.length === 1 ? [''] : current.filter((_, sizeIndex) => sizeIndex !== index)); }
  function patchGalleryImage(index, value) { setGalleryImages((current) => current.map((image, imageIndex) => imageIndex === index ? value : image)); }
  function addGalleryImage() { setGalleryImages((current) => [...current, '']); }
  function removeGalleryImage(index) { setGalleryImages((current) => current.filter((_, imageIndex) => imageIndex !== index)); }
  async function pickImage(file, variantIndex = null) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setError('Ảnh sản phẩm phải nhỏ hơn 2 MB.');
    const url = await fileToDataUrl(file);
    if (variantIndex === null) patch('imageUrl', url); else patchVariant(variantIndex, 'imageUrl', url);
  }
  async function pickGalleryImage(file, index) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setError('Ảnh sản phẩm phải nhỏ hơn 2 MB.');
    patchGalleryImage(index, await fileToDataUrl(file));
  }
  async function save(event) {
    event.preventDefault();
    if (!draft.title.trim()) return setError('Vui lòng nhập tên sản phẩm.');
    if (!sizes.length) return setError('Cần ít nhất một size.');
    setBusy(true); setError('');
    try {
      const uploaded = new Map();
      async function durableImage(value, fileName) {
        if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(value || '')) return value;
        if (uploaded.has(value)) return uploaded.get(value);
        const result = await storeApi.uploadImage({ dataUrl: value, fileName });
        uploaded.set(value, result.url);
        return result.url;
      }
      const imageUrl = await durableImage(draft.imageUrl, `${draft.title || 'product'}-main`);
      const durableGalleryImages = [];
      for (let index = 0; index < galleryImages.length; index += 1) {
        const image = galleryImages[index];
        if (image) durableGalleryImages.push(await durableImage(image, `${draft.title || 'product'}-gallery-${index + 1}`));
      }
      const variants = [];
      for (let index = 0; index < draft.variants.length; index += 1) {
        const variant = draft.variants[index];
        variants.push({
          ...variant,
          imageUrl: await durableImage(variant.imageUrl, `${draft.title || 'product'}-${variant.name || index + 1}`),
          priceOverride: variant.priceOverride === '' ? null : variant.priceOverride,
        });
      }
      const body = { ...draft, imageUrl, galleryImages: durableGalleryImages, sizes, price: Number(draft.price), discountPercent: Number(draft.discountPercent), variants };
      if (product.id) await storeApi.updateProduct(product.id, body); else await storeApi.createProduct(body);
      await onSaved();
    } catch (cause) { setError(cause.message || 'Không lưu được sản phẩm.'); }
    finally { setBusy(false); }
  }
  function addVariant() {
    const index = draft.variants.length + 1;
    setDraft((current) => ({ ...current, variants: [...current.variants, { id: `variant-${index}`, name: `Variant ${index}`, colorHex: '#d36a79', imageUrl: draft.imageUrl, priceOverride: null, stockBySize: Object.fromEntries(sizes.map((size) => [size, 0])) }] }));
  }
  return (
    <div className="ks-modal ks-modal--editor" role="dialog" aria-modal="true" aria-label="Sửa sản phẩm"><button className="ks-modal__backdrop" type="button" onClick={onClose} aria-label="Đóng" /><form className="ks-editor" onSubmit={save}>
      <div className="ks-editor__head"><div><p className="ks-kicker">PRODUCT EDITOR</p><h2>{product.id ? 'Chỉnh sửa sản phẩm' : 'Sản phẩm mới'}</h2></div><button type="button" onClick={onClose}>×</button></div>
      <div className="ks-editor__grid"><section>
        <label><span>Tên sản phẩm *</span><input value={draft.title} onChange={(event) => patch('title', event.target.value)} /></label>
        <label><span>Dòng mô tả ngắn</span><input value={draft.subtitle || ''} onChange={(event) => patch('subtitle', event.target.value)} /></label>
        <label><span>Mô tả</span><textarea rows="5" value={draft.description || ''} onChange={(event) => patch('description', event.target.value)} /></label>
        <div className="ks-editor__row"><label><span>Giá mặc định (TWD)</span><input type="number" min="0" value={draft.price} onChange={(event) => patch('price', event.target.value)} /></label><label><span>Giảm giá (%)</span><input type="number" min="0" max="95" value={draft.discountPercent} onChange={(event) => patch('discountPercent', event.target.value)} /></label></div>
        <div className="ks-size-editor"><div className="ks-size-editor__head"><span>Size sản phẩm</span><button type="button" onClick={addSize}>+ Thêm size</button></div><div className="ks-size-editor__entries">{sizeInputs.map((size, index) => <div className="ks-size-editor__entry" key={index}><input value={size} onChange={(event) => patchSize(index, event.target.value)} placeholder={index === 0 ? 'VD: Free size, 38, 2XL' : 'Nhập size'} /><button type="button" onClick={() => removeSize(index)} aria-label={`Xoá size ${index + 1}`}>×</button></div>)}</div><small>Tự gõ từng lựa chọn size. Có thể thêm bao nhiêu size tùy sản phẩm.</small></div>
        <ImageField label="Ảnh chính" value={draft.imageUrl} onChange={(value) => patch('imageUrl', value)} onPick={(file) => pickImage(file)} uploadLabel="Tải ảnh chính lên" />
        <div className="ks-gallery-editor"><div className="ks-gallery-editor__head"><div><span>Ảnh bổ sung</span><small>Khách có thể vuốt hoặc bấm để xem.</small></div><button type="button" onClick={addGalleryImage}>+ Thêm ảnh</button></div>{galleryImages.length ? <div className="ks-gallery-editor__items">{galleryImages.map((image, index) => <div className="ks-gallery-editor__item" key={index}><ImageField label={`Ảnh bổ sung ${index + 1}`} value={image} onChange={(value) => patchGalleryImage(index, value)} onPick={(file) => pickGalleryImage(file, index)} uploadLabel="Tải ảnh lên" /><button className="ks-gallery-editor__remove" type="button" onClick={() => removeGalleryImage(index)}>Xoá ảnh</button></div>)}</div> : <p className="ks-gallery-editor__empty">Chưa có ảnh bổ sung.</p>}</div>
        <div className="ks-editor__checks"><label><input type="checkbox" checked={draft.genders?.includes('men')} onChange={(event) => patch('genders', event.target.checked ? [...new Set([...(draft.genders || []).filter((entry) => entry !== 'unisex'), 'men'])] : draft.genders.filter((entry) => entry !== 'men'))} /> Nam</label><label><input type="checkbox" checked={draft.genders?.includes('women')} onChange={(event) => patch('genders', event.target.checked ? [...new Set([...(draft.genders || []).filter((entry) => entry !== 'unisex'), 'women'])] : draft.genders.filter((entry) => entry !== 'women'))} /> Nữ</label><label><input type="checkbox" checked={draft.freeship} onChange={(event) => patch('freeship', event.target.checked)} /> Free ship</label><label><input type="checkbox" checked={draft.featured} onChange={(event) => patch('featured', event.target.checked)} /> Featured</label><label><input type="checkbox" checked={draft.active} onChange={(event) => patch('active', event.target.checked)} /> Đang bán</label></div>
      </section><section className="ks-editor__variants"><div className="ks-editor__variants-head"><div><p className="ks-kicker">VARIANTS</p><h3>Phân loại và tồn kho</h3></div><button type="button" onClick={addVariant}>+ Thêm mẫu</button></div>
        {draft.variants.map((variant, index) => <div className="ks-variant-editor" key={`${variant.id}-${index}`}><div className="ks-variant-editor__head"><span style={{ background: variant.colorHex }} /><strong>Mẫu {index + 1}</strong>{draft.variants.length > 1 && <button type="button" onClick={() => setDraft((current) => ({ ...current, variants: current.variants.filter((_, variantIndex) => variantIndex !== index) }))}>Xoá</button>}</div><div className="ks-editor__row ks-editor__row--variant"><label><span>Tên mẫu</span><input value={variant.name} onChange={(event) => patchVariant(index, 'name', event.target.value)} /></label><label><span>Màu</span><input type="color" value={variant.colorHex} onChange={(event) => patchVariant(index, 'colorHex', event.target.value)} /></label><label><span>Giá mẫu (TWD)</span><input type="number" min="0" value={variant.priceOverride ?? ''} placeholder={`Mặc định: ${draft.price}`} onChange={(event) => patchVariant(index, 'priceOverride', event.target.value)} /></label></div><ImageField label={`Ảnh mẫu ${index + 1}`} value={variant.imageUrl} onChange={(value) => patchVariant(index, 'imageUrl', value)} onPick={(file) => pickImage(file, index)} uploadLabel="Tải ảnh mẫu lên" /><div className="ks-stock-grid">{sizes.map((size) => <label key={size}><span>{size}</span><input type="number" min="0" value={variant.stockBySize?.[size] || 0} onChange={(event) => patchStock(index, size, event.target.value)} /></label>)}</div></div>)}
      </section></div>
      {error && <p className="ks-form-error">{error}</p>}
      <div className="ks-editor__actions"><button className="ks-button ks-button--light" type="button" onClick={onClose}>Huỷ</button><button className="ks-button ks-button--dark" disabled={busy} type="submit">{busy ? 'Đang lưu…' : 'Lưu sản phẩm'}</button></div>
    </form></div>
  );
}

function StoreFooter({ config, navigate }) {
  return <footer className="ks-footer"><div><span className="ks-brand__seal">K</span><strong>KataShop</strong><p>Một nhánh nhỏ của se77n.</p></div><nav><button type="button" onClick={() => navigate('/store')}>Cửa hàng</button>{config?.admin?.allowed && <button type="button" onClick={() => navigate('/store/admin')}>Admin</button>}{config?.support?.url && <a href={config.support.url} target="_blank" rel="noreferrer">Hỗ trợ ↗</a>}</nav><small>© {new Date().getFullYear()} KATASHOP · TAIWAN</small></footer>;
}

function StoreFloatingActions({ cartCount, onCart }) {
  return (
    <div className="ks-floating-actions" aria-label="Thao tác nhanh">
      <button className="ks-floating-cart" type="button" onClick={onCart}><span aria-hidden="true">🛒</span><b>Giỏ hàng</b><strong>{cartCount}</strong></button>
      <a className="ks-floating-support" href="https://www.tiktok.com/@hoa197915" target="_blank" rel="noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.53 15.22V22l4.34-2.39A10 10 0 1 0 12 2Zm1.03 13.14-2.55-2.72-4.98 2.72 5.48-5.82 2.6 2.72 4.9-2.72-5.45 5.82Z" fill="currentColor" /></svg> Hỗ trợ</a>
    </div>
  );
}
function StoreLoading({ compact = false }) {
  return <main className={`ks-loading ${compact ? 'is-compact' : ''}`}><span /><p>Đang mở KataShop…</p></main>;
}

function StoreError({ message, onRetry, retryLabel = 'Thử lại' }) {
  return <main className="ks-error"><p className="ks-kicker">SOMETHING WENT WRONG</p><h1>Store chưa thể mở.</h1><p>{message}</p><button className="ks-button ks-button--dark" type="button" onClick={onRetry}>{retryLabel}</button></main>;
}

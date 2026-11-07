import { useEffect, useMemo, useState } from "react";
import "./CustomerDashboard.css";

const API_URL = "http://localhost:4000";

const STATUS_LABELS = {
  PENDING: "Onay bekliyor",
  APPROVED: "Onaylandı",
  PREPARING: "Hazırlanıyor",
  ON_THE_WAY: "Yola çıktı",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal edildi",
};

const DELIVERY_DAY_LABELS = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

function formatPrice(value) {
  return (
    Number(value || 0).toLocaleString("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " ₺"
  );
}

function formatDate(value) {
  if (!value) return "-";

  return new Date(value).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function CustomerDashboard({ session, onLogout }) {
  const [activePage, setActivePage] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);

  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [deliveryDays, setDeliveryDays] = useState([]);
  const [productQuantities, setProductQuantities] = useState({});

  // Her müşteri için ayrı sepet anahtarı
  const cartStorageKey = `customer_cart_${
    session?.user?.id ??
    session?.user?.user_id ??
    session?.user?.email ??
    "default"
  }`;

  // Sepeti localStorage üzerinden yükle
  const [cart, setCart] = useState(() => {
    try {
      const savedCart = localStorage.getItem(cartStorageKey);
      return savedCart ? JSON.parse(savedCart) : [];
    } catch (error) {
      console.error("Kayıtlı sepet yüklenemedi:", error);
      return [];
    }
  });

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const token = session?.token;

  // Sepetteki değişiklikleri otomatik kaydet
  useEffect(() => {
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    } catch (error) {
      console.error("Sepet kaydedilemedi:", error);
    }
  }, [cart, cartStorageKey]);

  async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "İşlem gerçekleştirilemedi.");
    }

    return data;
  }

  async function loadProducts() {
    const data = await apiRequest("/products");

    const productList = Array.isArray(data)
      ? data
      : data.products || [];

    setProducts(
      productList.filter(product => product.active === true)
    );
  }

  async function loadOrders() {
    const data = await apiRequest("/my-orders");

    setOrders(
      Array.isArray(data)
        ? data
        : data.orders || []
    );
  }

  async function loadDeliveryDays() {
    const data = await apiRequest("/orders/delivery-days");

    const days = Array.isArray(data)
      ? data
      : data.delivery_days || data.deliveryDays || [];

    setDeliveryDays(days);
  }

  // İlk açılışta verileri birbirinden bağımsız yükle
  useEffect(() => {
    async function loadInitialData() {
      if (!token) {
        setError("Oturum bilgisi bulunamadı. Lütfen tekrar giriş yapın.");
        return;
      }

      setLoading(true);
      setError("");

      const results = await Promise.allSettled([
        loadProducts(),
        loadOrders(),
        loadDeliveryDays(),
      ]);

      const errors = [];

      if (results[0].status === "rejected") {
        console.error(
          "Ürünler yüklenemedi:",
          results[0].reason
        );
        errors.push("Ürünler yüklenemedi.");
      }

      if (results[1].status === "rejected") {
        console.error(
          "Siparişler yüklenemedi:",
          results[1].reason
        );
        errors.push("Siparişler yüklenemedi.");
      }

      if (results[2].status === "rejected") {
        console.error(
          "Teslimat günleri yüklenemedi:",
          results[2].reason
        );
        errors.push("Teslimat günleri yüklenemedi.");
      }

      if (errors.length > 0) {
        setError(errors.join(" "));
      }

      setLoading(false);
    }

    loadInitialData();
  }, []);

  const categories = useMemo(() => {
    return [
      ...new Set(
        products
          .map(product => product.category_name)
          .filter(Boolean)
      ),
    ];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const productName = product.name || "";

      const matchesSearch = productName
        .toLocaleLowerCase("tr-TR")
        .includes(search.toLocaleLowerCase("tr-TR"));

      const matchesCategory =
        categoryFilter === "all" ||
        product.category_name === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [products, search, categoryFilter]);

  const cartTotal = useMemo(() => {
    return cart.reduce(
      (total, item) =>
        total + Number(item.price) * item.quantity,
      0
    );
  }, [cart]);

  function addToCart(product, requestedQuantity) {
    setError("");
    setSuccess("");

    const quantity = Number(requestedQuantity);

    if (!Number.isInteger(quantity) || quantity < 1) {
      setError("Lütfen geçerli bir ürün miktarı girin.");
      return;
    }

    const existing = cart.find(
      item => item.id === product.id
    );

    const currentQuantity = existing ? existing.quantity : 0;

    if (currentQuantity + quantity > Number(product.stock)) {
      setError(
        "Sepete eklemek istediğiniz miktar mevcut stoktan fazla."
      );
      return;
    }

    if (existing) {
      setCart(current =>
        current.map(item =>
          item.id === product.id
            ? {
                ...item,
                quantity: item.quantity + quantity,
              }
            : item
        )
      );
    } else {
      setCart(current => [
        ...current,
        {
          id: product.id,
          name: product.name,
          price: Number(product.price),
          stock: Number(product.stock),
          min_unit_label: product.min_unit_label,
          quantity,
        },
      ]);
    }

    setProductQuantities(current => ({
      ...current,
      [product.id]: 1,
    }));

    setSuccess(`${product.name} (${quantity}) sepete eklendi.`);
  }

  function updateCartQuantity(productId, quantity) {
    const item = cart.find(
      product => product.id === productId
    );

    if (!item) return;

    const newQuantity = Number(quantity);

    if (
      !Number.isInteger(newQuantity) ||
      newQuantity < 1
    ) {
      return;
    }

    if (newQuantity > item.stock) {
      setError("Stok miktarından fazla ürün seçemezsiniz.");
      return;
    }

    setError("");

    setCart(current =>
      current.map(product =>
        product.id === productId
          ? {
              ...product,
              quantity: newQuantity,
            }
          : product
      )
    );
  }

  function removeFromCart(productId) {
    setCart(current =>
      current.filter(
        product => product.id !== productId
      )
    );
  }

  function openCart() {
    setActivePage("cart");
    setError("");
    setSuccess("");
    setMenuOpen(false);
  }

  async function createOrder() {
    if (cart.length === 0) {
      setError("Sepetinizde ürün bulunmuyor.");
      return;
    }

    if (deliveryDays.length === 0) {
      setError("İlçeniz için henüz teslimat günü tanımlanmamış.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      await apiRequest("/orders", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map(item => ({
            product_id: item.id,
            quantity: item.quantity,
          })),
        }),
      });

      setCart([]);
      setProductQuantities({});
      setSuccess("Siparişiniz başarıyla oluşturuldu.");

      await loadOrders();
      setActivePage("orders");
      setMenuOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function showOrderDetails(order) {
    setSelectedOrder(order);
    setOrderItems([]);
    setError("");

    try {
      const data = await apiRequest(
        `/my-orders/${order.id}/items`
      );

      setOrderItems(
        Array.isArray(data)
          ? data
          : data.items || []
      );
    } catch (err) {
      setError(err.message);
    }
  }

  function navigate(page) {
    setActivePage(page);
    setError("");
    setSuccess("");
    setSelectedOrder(null);
    setMenuOpen(false);
  }

  return (
    <div className="customer-layout">
      {/* Mobil menü arka planı */}
      {menuOpen && (
        <div
          className="customer-menu-overlay"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* SOL MENÜ */}
      <aside
        className={`customer-sidebar ${menuOpen ? "open" : ""}`}
      >
        <div className="customer-brand">
          <div className="customer-brand-icon">K</div>

          <div>
            <h2>KİLCAROĞLU</h2>
            <span>Toptan Satış</span>
          </div>
        </div>

        <div className="customer-menu">
          <p className="customer-menu-title">MENÜ</p>

          <button
            className={activePage === "home" ? "active" : ""}
            onClick={() => navigate("home")}
          >
            <span>⌂</span>
            Ana Sayfa
          </button>

          <button
            className={activePage === "products" ? "active" : ""}
            onClick={() => navigate("products")}
          >
            <span>▦</span>
            Ürünler
          </button>

          <button
            className={activePage === "cart" ? "active" : ""}
            onClick={openCart}
          >
            <span>🛒</span>
            Sepetim

            {cart.length > 0 && (
              <small>{cart.length}</small>
            )}
          </button>

          <button
            className={activePage === "orders" ? "active" : ""}
            onClick={() => navigate("orders")}
          >
            <span>▤</span>
            Siparişlerim
          </button>
        </div>

        <div className="customer-sidebar-bottom">
          <div className="customer-user-info">
            <div className="customer-user-avatar">
              {(session?.user?.name || "M")
                .charAt(0)
                .toLocaleUpperCase("tr-TR")}
            </div>

            <div>
              <strong>
                {session?.user?.name || "Müşteri"}
              </strong>
              <span>Müşteri hesabı</span>
            </div>
          </div>

          <button
            className="customer-logout"
            onClick={onLogout}
          >
            ↪ Güvenli Çıkış
          </button>
        </div>
      </aside>

      {/* ANA İÇERİK */}
      <main className="customer-main">
        <header className="customer-header">
          {/* Mobil hamburger butonu */}
          <button
            className="customer-menu-toggle"
            onClick={() => setMenuOpen(current => !current)}
            aria-label="Menüyü aç veya kapat"
            aria-expanded={menuOpen}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>

          <div className="customer-header-title">
            <h1>
              {activePage === "home" && "Ana Sayfa"}
              {activePage === "products" && "Ürünler"}
              {activePage === "cart" && "Sepetim"}
              {activePage === "orders" && "Siparişlerim"}
            </h1>

            <p>
              KİLCAROĞLU Toptan Satış ve Dağıtım Yönetim Sistemi
            </p>
          </div>

          <button
            className="customer-header-cart"
            onClick={openCart}
          >
            🛒 Sepetim ({cart.length})
          </button>
        </header>

        {(error || success) && (
          <div
            className={`customer-message ${
              error ? "error" : "success"
            }`}
          >
            {error || success}

            <button
              onClick={() => {
                setError("");
                setSuccess("");
              }}
            >
              ×
            </button>
          </div>
        )}

        {loading && (
          <div className="customer-loading">
            İşlem yapılıyor...
          </div>
        )}

        {/* ANA SAYFA */}
        {activePage === "home" && (
          <section className="customer-content">
            <div className="customer-welcome">
              <div>
                <span>HOŞ GELDİNİZ</span>

                <h2>
                  {session?.user?.name || "Değerli Müşterimiz"}
                </h2>

                <p>
                  Ürünlerimizi inceleyebilir, sipariş oluşturabilir
                  ve siparişlerinizi buradan takip edebilirsiniz.
                </p>

                <button
                  onClick={() => navigate("products")}
                >
                  Ürünleri İncele
                </button>
              </div>

              <div className="customer-welcome-icon">
                ▦
              </div>
            </div>

            <div className="customer-delivery-info">
              <div>
                <h3>Teslimat Günleriniz</h3>
                <p>
                  İlçeniz için belirlenen haftalık teslimat günleri
                </p>
              </div>

              {deliveryDays.length > 0 ? (
                <div className="customer-delivery-days">
                  {deliveryDays.map((day, index) => {
                    const dayNumber = Number(
                      typeof day === "object"
                        ? day.delivery_day
                        : day
                    );

                    return (
                      <span key={`${dayNumber}-${index}`}>
                        {DELIVERY_DAY_LABELS[dayNumber] || "Gün bilgisi"}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span className="customer-delivery-empty">
                  Henüz teslimat günü tanımlanmamış.
                </span>
              )}
            </div>

            <div className="customer-summary">
              <div className="customer-summary-card">
                <span>Toplam Sipariş</span>
                <strong>{orders.length}</strong>
              </div>

              <div className="customer-summary-card">
                <span>Bekleyen Sipariş</span>
                <strong>
                  {
                    orders.filter(
                      order => order.status === "PENDING"
                    ).length
                  }
                </strong>
              </div>

              <div className="customer-summary-card">
                <span>Teslim Edilen</span>
                <strong>
                  {
                    orders.filter(
                      order => order.status === "DELIVERED"
                    ).length
                  }
                </strong>
              </div>

              <div className="customer-summary-card">
                <span>Sepetteki Ürün</span>
                <strong>{cart.length}</strong>
              </div>
            </div>

            <div className="customer-home-section">
              <div>
                <h3>Son Siparişlerim</h3>
                <p>Son oluşturduğunuz siparişler</p>
              </div>

              {orders.length === 0 ? (
                <div className="customer-empty">
                  Henüz siparişiniz bulunmuyor.
                </div>
              ) : (
                <div className="customer-table-wrapper">
                  <table className="customer-table">
                    <thead>
                      <tr>
                        <th>Sipariş No</th>
                        <th>Sipariş Tarihi</th>
                        <th>Tutar</th>
                        <th>Durum</th>
                      </tr>
                    </thead>

                    <tbody>
                      {orders.slice(0, 5).map(order => (
                        <tr key={order.id}>
                          <td>#{order.id}</td>
                          <td>{formatDate(order.created_at)}</td>
                          <td>{formatPrice(order.total_amount)}</td>
                          <td>
                            <span
                              className={`customer-status ${order.status}`}
                            >
                              {STATUS_LABELS[order.status] || order.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ÜRÜNLER */}
        {activePage === "products" && (
          <section className="customer-content">
            <div className="customer-section-heading">
              <div>
                <h2>Ürünlerimiz</h2>
                <p>
                  Sipariş vermek istediğiniz ürünleri sepetinize ekleyin.
                </p>
              </div>
            </div>

            <div className="customer-filters">
              <input
                type="text"
                placeholder="Ürün ara..."
                value={search}
                onChange={event => setSearch(event.target.value)}
              />

              <select
                value={categoryFilter}
                onChange={event =>
                  setCategoryFilter(event.target.value)
                }
              >
                <option value="all">Tüm kategoriler</option>

                {categories.map(category => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <div className="customer-product-list">
              <div className="customer-product-list-heading">
                <h3>Ürün Listesi</h3>
                <span>{filteredProducts.length} ürün</span>
              </div>

              {filteredProducts.length === 0 ? (
                <div className="customer-empty">
                  Gösterilecek ürün bulunamadı.
                </div>
              ) : (
                <div className="customer-table-wrapper">
                  <table className="customer-table">
                    <thead>
                      <tr>
                        <th>Ürün Adı</th>
                        <th>Kategori</th>
                        <th>Birim</th>
                        <th>Stok</th>
                        <th>Birim Fiyat</th>
                        <th>İşlem</th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredProducts.map(product => (
                        <tr key={product.id}>
                          <td>
                            <strong>{product.name}</strong>
                          </td>

                          <td>
                            {product.category_name || "-"}
                          </td>

                          <td>
                            {product.min_unit_label || "Adet"}
                          </td>

                          <td>{product.stock}</td>

                          <td>
                            <strong className="customer-product-price">
                              {formatPrice(product.price)}
                            </strong>
                          </td>

                          <td>
                            <div className="customer-product-actions">
                              <input
                                className="customer-product-quantity"
                                type="number"
                                min="1"
                                max={product.stock}
                                step="1"
                                value={productQuantities[product.id] ?? 1}
                                disabled={Number(product.stock) <= 0}
                                onChange={event =>
                                  setProductQuantities(current => ({
                                    ...current,
                                    [product.id]: event.target.value,
                                  }))
                                }
                              />

                              <button
                                className="customer-add-cart-button"
                                disabled={Number(product.stock) <= 0}
                                onClick={() =>
                                  addToCart(
                                    product,
                                    productQuantities[product.id] ?? 1
                                  )
                                }
                              >
                                {Number(product.stock) > 0
                                  ? "Sepete Ekle"
                                  : "Stokta Yok"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* SEPETİM */}
        {activePage === "cart" && (
          <section className="customer-content">
            <div className="customer-section-heading">
              <div>
                <h2>Alışveriş Sepetim</h2>
                <p>
                  Siparişinizi tamamlamadan önce ürünlerinizi kontrol edin.
                </p>
              </div>
            </div>

            {cart.length === 0 ? (
              <div className="customer-empty">
                <h3>Sepetiniz boş</h3>

                <p>
                  Sipariş vermek için ürünlerimizi inceleyebilirsiniz.
                </p>

                <button onClick={() => navigate("products")}>
                  Ürünlere Git
                </button>
              </div>
            ) : (
              <>
                <div className="customer-table-wrapper">
                  <table className="customer-table">
                    <thead>
                      <tr>
                        <th>Ürün</th>
                        <th>Birim Fiyat</th>
                        <th>Miktar</th>
                        <th>Toplam</th>
                        <th></th>
                      </tr>
                    </thead>

                    <tbody>
                      {cart.map(item => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.name}</strong>
                            <small className="customer-unit">
                              {item.min_unit_label || "Adet"}
                            </small>
                          </td>

                          <td>{formatPrice(item.price)}</td>

                          <td>
                            <input
                              className="customer-quantity-input"
                              type="number"
                              min="1"
                              max={item.stock}
                              value={item.quantity}
                              onChange={event =>
                                updateCartQuantity(
                                  item.id,
                                  event.target.value
                                )
                              }
                            />
                          </td>

                          <td>
                            {formatPrice(
                              item.price * item.quantity
                            )}
                          </td>

                          <td>
                            <button
                              className="customer-remove-button"
                              onClick={() =>
                                removeFromCart(item.id)
                              }
                            >
                              Kaldır
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="customer-checkout">
                  <div className="customer-shipment-select">
                    <h3>Teslimat Günleriniz</h3>
                    <p>
                      Siparişiniz, ilçeniz için belirlenen uygun teslimat
                      gününe göre otomatik planlanır.
                    </p>

                    {deliveryDays.length > 0 ? (
                      <div className="customer-delivery-days">
                        {deliveryDays.map((day, index) => {
                          const dayNumber = Number(
                            typeof day === "object"
                              ? day.delivery_day
                              : day
                          );

                          return (
                            <span key={`${dayNumber}-${index}`}>
                              {DELIVERY_DAY_LABELS[dayNumber] || "Gün bilgisi"}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <small>
                        İlçeniz için henüz teslimat günü tanımlanmamış.
                      </small>
                    )}
                  </div>

                  <div className="customer-cart-total">
                    <span>Genel Toplam</span>

                    <strong>{formatPrice(cartTotal)}</strong>

                    <button
                      disabled={loading || deliveryDays.length === 0}
                      onClick={createOrder}
                    >
                      Siparişi Tamamla
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {/* SİPARİŞLERİM */}
        {activePage === "orders" && (
          <section className="customer-content">
            <div className="customer-section-heading">
              <div>
                <h2>Siparişlerim</h2>
                <p>
                  Oluşturduğunuz siparişleri ve güncel durumlarını takip edin.
                </p>
              </div>
            </div>

            {orders.length === 0 ? (
              <div className="customer-empty">
                Henüz siparişiniz bulunmuyor.
              </div>
            ) : (
              <div className="customer-table-wrapper">
                <table className="customer-table">
                  <thead>
                    <tr>
                      <th>Sipariş No</th>
                      <th>Sipariş Tarihi</th>
                      <th>Toplam</th>
                      <th>Durum</th>
                      <th>Detay</th>
                    </tr>
                  </thead>

                  <tbody>
                    {orders.map(order => (
                      <tr key={order.id}>
                        <td>#{order.id}</td>
                        <td>{formatDate(order.created_at)}</td>
                        <td>{formatPrice(order.total_amount)}</td>

                        <td>
                          <span
                            className={`customer-status ${order.status}`}
                          >
                            {STATUS_LABELS[order.status] || order.status}
                          </span>
                        </td>

                        <td>
                          <button
                            className="customer-detail-button"
                            onClick={() => showOrderDetails(order)}
                          >
                            Detay
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedOrder && (
              <div className="customer-order-detail">
                <div className="customer-detail-heading">
                  <h3>
                    #{selectedOrder.id} Numaralı Sipariş
                  </h3>

                  <button
                    onClick={() => setSelectedOrder(null)}
                  >
                    ×
                  </button>
                </div>

                {orderItems.length === 0 ? (
                  <p>Sipariş kalemleri bulunamadı.</p>
                ) : (
                  <div className="customer-table-wrapper">
                    <table className="customer-table">
                      <thead>
                        <tr>
                          <th>Ürün</th>
                          <th>Miktar</th>
                          <th>Birim Fiyat</th>
                          <th>Toplam</th>
                        </tr>
                      </thead>

                      <tbody>
                        {orderItems.map((item, index) => (
                          <tr key={item.id || index}>
                            <td>
                              {item.product_name || item.name}
                            </td>
                            <td>{item.quantity}</td>
                            <td>{formatPrice(item.unit_price)}</td>
                            <td>{formatPrice(item.line_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default CustomerDashboard;
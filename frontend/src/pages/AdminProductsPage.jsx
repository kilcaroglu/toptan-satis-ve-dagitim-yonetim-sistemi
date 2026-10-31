
import { useCallback, useEffect, useMemo, useState } from "react";
import "./AdminProductsPage.css";

const API_URL = "http://localhost:4000";

const emptyForm = {
  name: "",
  category_id: "",
  min_unit_label: "",
  unit_weight_kg: "",
  stock: "",
  price: "",
};

const today = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const emptyPurchaseForm = {
  invoice_date: today(),
  invoice_number: "",
  quantity: "",
  unit_cost: "",
  supplier_name: "",
  purchase_date: today(),
  payment_method: "Havale",
  stock_added: true,
};

const money = (value) =>
  Number(value || 0).toLocaleString("tr-TR", {
    style: "currency",
    currency: "TRY",
  });

const dateText = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("tr-TR");
};

export default function AdminProductsPage({ session }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);

  // Alış kaydı
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [purchaseProduct, setPurchaseProduct] = useState(null);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);
  const [purchaseSaving, setPurchaseSaving] = useState(false);

  // Ürün künyesi ve alış geçmişi
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [purchaseHistory, setPurchaseHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const token = session?.token;

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  const loadData = useCallback(async () => {
    if (!token) {
      setError("Oturum bilgisi bulunamadı. Lütfen tekrar giriş yapın.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [productsResponse, categoriesResponse] = await Promise.all([
        fetch(`${API_URL}/products`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/categories`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const productsData = await productsResponse.json();
      const categoriesData = await categoriesResponse.json();

      if (!productsResponse.ok) {
        throw new Error(productsData.message || "Ürünler yüklenemedi.");
      }

      if (!categoriesResponse.ok) {
        throw new Error(categoriesData.message || "Kategoriler yüklenemedi.");
      }

      setProducts(productsData);
      setCategories(categoriesData);
    } catch (err) {
      setError(err.message || "Veriler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredProducts = useMemo(() => {
    return [...products]
      .filter((product) => {
        const matchesSearch = product.name
          .toLocaleLowerCase("tr-TR")
          .includes(search.trim().toLocaleLowerCase("tr-TR"));

        const matchesCategory =
          !categoryFilter || String(product.category_id) === categoryFilter;

        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" && product.active) ||
          (statusFilter === "passive" && !product.active);

        return matchesSearch && matchesCategory && matchesStatus;
      })
      .sort(
        (a, b) =>
          Number(Boolean(b.active)) - Number(Boolean(a.active)) ||
          String(a.name).localeCompare(String(b.name), "tr"),
      );
  }, [products, search, categoryFilter, statusFilter]);

  // Ürün ekleme ve düzenleme
  function openAddModal() {
    setEditingProduct(null);
    setForm(emptyForm);
    setNewCategoryName("");
    setMessage("");
    setModalOpen(true);
  }

  function openEditModal(product) {
    setEditingProduct(product);
    setForm({
      name: product.name || "",
      category_id: product.category_id ? String(product.category_id) : "",
      min_unit_label: product.min_unit_label || "",
      unit_weight_kg: product.unit_weight_kg ?? "",
      stock: product.stock ?? "",
      price: product.price ?? "",
    });
    setNewCategoryName("");
    setMessage("");
    setModalOpen(true);
  }

  function closeModal() {
    if (saving || addingCategory) return;

    setModalOpen(false);
    setEditingProduct(null);
    setForm(emptyForm);
    setNewCategoryName("");
    setMessage("");
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function handleAddCategory() {
    const name = newCategoryName.trim();

    if (!name) {
      setMessage("Lütfen kategori adı girin.");
      return;
    }

    setAddingCategory(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/categories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Kategori eklenemedi.");
      }

      setCategories((previous) => {
        const exists = previous.some((category) => category.id === data.id);

        if (exists) return previous;

        return [...previous, data].sort((a, b) =>
          a.name.localeCompare(b.name, "tr"),
        );
      });

      setForm((previous) => ({
        ...previous,
        category_id: String(data.id),
      }));

      setNewCategoryName("");
      setMessage("Kategori kaydedildi ve seçildi.");
    } catch (err) {
      setMessage(err.message || "Kategori eklenemedi.");
    } finally {
      setAddingCategory(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (!form.name.trim() || !form.category_id) {
      setMessage("Ürün adı ve kategori zorunludur.");
      return;
    }

    const unitWeight = Number(form.unit_weight_kg);
    const stock = Number(form.stock);
    const price = Number(form.price);

    if (
      !form.min_unit_label.trim() ||
      form.unit_weight_kg === "" ||
      form.stock === "" ||
      form.price === "" ||
      !Number.isFinite(unitWeight) ||
      !Number.isFinite(stock) ||
      !Number.isFinite(price) ||
      unitWeight <= 0 ||
      stock < 0 ||
      price < 0
    ) {
      setMessage("Birim, ağırlık, stok ve fiyat bilgilerini geçerli girin.");
      return;
    }

    const body = {
      name: form.name.trim(),
      category_id: Number(form.category_id),
      min_unit_label: form.min_unit_label.trim(),
      unit_weight_kg: unitWeight,
      stock,
      price,
    };

    setSaving(true);

    try {
      const isEditing = Boolean(editingProduct);

      const response = await fetch(
        isEditing
          ? `${API_URL}/products/${editingProduct.id}`
          : `${API_URL}/products`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(body),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Ürün kaydedilemedi.");
      }

      setModalOpen(false);
      setEditingProduct(null);
      setForm(emptyForm);
      setMessage(
        isEditing ? "Ürün başarıyla güncellendi." : "Ürün başarıyla eklendi.",
      );

      await loadData();
    } catch (err) {
      setMessage(err.message || "İşlem gerçekleştirilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(product) {
    const actionText = product.active ? "pasif" : "aktif";

    if (
      !window.confirm(
        `"${product.name}" ürününü ${actionText} yapmak istiyor musunuz?`,
      )
    ) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/products/${product.id}/active`, {
        method: "PATCH",
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Ürün durumu değiştirilemedi.");
      }

      setProducts((previous) =>
        previous.map((item) =>
          item.id === product.id ? { ...item, ...data } : item,
        ),
      );

      setMessage("Ürün durumu güncellendi.");
    } catch (err) {
      setError(err.message || "Ürün durumu değiştirilemedi.");
    }
  }

  // Alış kaydı penceresi
  function openPurchaseModal(product) {
    setPurchaseProduct(product);
    setPurchaseForm({
      ...emptyPurchaseForm,
      invoice_date: today(),
      purchase_date: today(),
    });
    setMessage("");
    setPurchaseModalOpen(true);
  }

  function closePurchaseModal() {
    if (purchaseSaving) return;

    setPurchaseModalOpen(false);
    setPurchaseProduct(null);
    setPurchaseForm(emptyPurchaseForm);
  }

  function handlePurchaseChange(event) {
    const { name, value, type, checked } = event.target;

    setPurchaseForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  const purchaseTotal =
    (Number(purchaseForm.quantity) || 0) *
    (Number(purchaseForm.unit_cost) || 0);

  async function handlePurchaseSubmit(event) {
    event.preventDefault();

    if (!purchaseProduct) return;

    if (
      !purchaseForm.invoice_date ||
      !purchaseForm.invoice_number.trim() ||
      !purchaseForm.supplier_name.trim() ||
      !purchaseForm.purchase_date ||
      !purchaseForm.payment_method.trim() ||
      !purchaseForm.quantity ||
      !purchaseForm.unit_cost ||
      Number(purchaseForm.quantity) <= 0 ||
      Number(purchaseForm.unit_cost) < 0
    ) {
      setMessage("Alış bilgilerini eksiksiz ve doğru girin.");
      return;
    }

    setPurchaseSaving(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/product-purchases`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          product_id: purchaseProduct.id,
          ...purchaseForm,
          quantity: Number(purchaseForm.quantity),
          unit_cost: Number(purchaseForm.unit_cost),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Alış kaydı yapılamadı.");
      }

      setPurchaseModalOpen(false);
      setPurchaseProduct(null);
      setPurchaseForm(emptyPurchaseForm);
      setMessage(data.message || "Alış kaydı başarıyla oluşturuldu.");

      await loadData();
    } catch (err) {
      setMessage(err.message || "Alış kaydı yapılamadı.");
    } finally {
      setPurchaseSaving(false);
    }
  }

  // Ürün künyesi ve alış geçmişi
  async function openHistoryModal(product) {
    setHistoryProduct(product);
    setHistoryModalOpen(true);
    setHistoryLoading(true);
    setPurchaseHistory([]);
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/products/${product.id}/purchases`,
        {
          headers,
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Ürün geçmişi alınamadı.");
      }

      setPurchaseHistory(data.purchases || []);

      setHistoryProduct({
        ...product,
        ...(data.product || {}),
      });
    } catch (err) {
      setMessage(err.message || "Ürün geçmişi alınamadı.");
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistoryModal() {
    setHistoryModalOpen(false);
    setHistoryProduct(null);
    setPurchaseHistory([]);
  }

  const latestPurchase = purchaseHistory[0];

  const grossDifference = latestPurchase
    ? Number(historyProduct?.price || 0) -
      Number(latestPurchase.unit_cost || 0)
    : null;

  const grossDifferencePercent =
    latestPurchase && Number(latestPurchase.unit_cost) > 0
      ? (grossDifference / Number(latestPurchase.unit_cost)) * 100
      : null;

  return (
    <div className="admin-products">
      <div className="products-heading">
        <div>
          <h2>Ürün Listesi</h2>
          <p>Ürünlerinizi, kategorilerinizi ve stoklarınızı yönetin.</p>
        </div>

        <button
          type="button"
          className="product-add-button"
          onClick={openAddModal}
        >
          + Yeni Ürün Ekle
        </button>
      </div>

      <div className="products-summary">
        <div>
          <span>Toplam Ürün</span>
          <strong>{products.length}</strong>
        </div>

        <div>
          <span>Aktif Ürün</span>
          <strong>{products.filter((p) => p.active).length}</strong>
        </div>

        <div>
          <span>Pasif Ürün</span>
          <strong>{products.filter((p) => !p.active).length}</strong>
        </div>
      </div>

      {message && <div className="product-success">{message}</div>}
      {error && <div className="product-error">{error}</div>}

      <div className="products-filters">
        <input
          type="search"
          placeholder="Ürün adına göre ara..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="">Tüm kategoriler</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">Tüm ürünler</option>
          <option value="active">Aktif ürünler</option>
          <option value="passive">Pasif ürünler</option>
        </select>

        <button
          type="button"
          className="product-cancel-button"
          onClick={() => {
            setSearch("");
            setCategoryFilter("");
            setStatusFilter("all");
          }}
        >
          Filtreleri Temizle
        </button>
      </div>

      {loading ? (
        <div className="products-empty">Ürünler yükleniyor...</div>
      ) : filteredProducts.length === 0 ? (
        <div className="products-empty">Aramanıza uygun ürün bulunamadı.</div>
      ) : (
        <>
          <p className="products-result-count">
            {filteredProducts.length} ürün gösteriliyor
          </p>

          <div className="products-table-wrapper">
            <table className="products-table">
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Kategori</th>
                  <th>Birim</th>
                  <th>Birim Ağırlığı</th>
                  <th>Stok</th>
                  <th>Fiyat</th>
                  <th>Durum</th>
                  <th>İşlemler</th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                    </td>
                    <td>{product.category_name || "Kategorisiz"}</td>
                    <td>{product.min_unit_label}</td>
                    <td>{product.unit_weight_kg} kg</td>
                    <td>{product.stock}</td>
                    <td>{money(product.price)}</td>

                    <td>
                      <span
                        className={
                          product.active
                            ? "product-status active"
                            : "product-status passive"
                        }
                      >
                        {product.active ? "Aktif" : "Pasif"}
                      </span>
                    </td>

                    <td>
                      <div className="product-row-actions">
                        <button
                          type="button"
                          className="product-edit-button"
                          onClick={() => openEditModal(product)}
                        >
                          Düzenle
                        </button>

                        <button
                          type="button"
                          className="product-edit-button"
                          onClick={() => openPurchaseModal(product)}
                        >
                          Alış Kaydı
                        </button>

                        <button
                          type="button"
                          className="product-edit-button"
                          onClick={() => openHistoryModal(product)}
                        >
                          Ürün Künyesi
                        </button>

                        <button
                          type="button"
                          className="product-toggle-button"
                          onClick={() => toggleActive(product)}
                        >
                          {product.active ? "Pasif Yap" : "Aktif Yap"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Ürün ekleme ve düzenleme penceresi */}
      {modalOpen && (
        <div className="product-modal-backdrop">
          <form className="product-modal" onSubmit={handleSubmit}>
            <button
              type="button"
              className="product-modal-close"
              onClick={closeModal}
              disabled={saving || addingCategory}
            >
              ×
            </button>

            <h2>{editingProduct ? "Ürünü Düzenle" : "Yeni Ürün Ekle"}</h2>

            <label htmlFor="product-name">Ürün adı</label>
            <input
              id="product-name"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Örn. Toz Şeker"
              required
            />

            <label htmlFor="product-category">Kategori</label>
            <select
              id="product-category"
              name="category_id"
              value={form.category_id}
              onChange={handleChange}
              required
            >
              <option value="">Kategori seçin</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>

            <div className="new-category-area">
              <label htmlFor="new-category-name">
                Listede yok mu? Yeni kategori ekle
              </label>

              <div className="new-category-row">
                <input
                  id="new-category-name"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="Yeni kategori adı"
                  disabled={addingCategory}
                />

                <button
                  type="button"
                  className="product-edit-button"
                  onClick={handleAddCategory}
                  disabled={addingCategory}
                >
                  {addingCategory ? "Ekleniyor..." : "+ Ekle"}
                </button>
              </div>
            </div>

            <label htmlFor="product-unit">Birim etiketi</label>
            <input
              id="product-unit"
              name="min_unit_label"
              value={form.min_unit_label}
              onChange={handleChange}
              placeholder="Örn. Koli, Paket, Adet"
              required
            />

            <label htmlFor="product-weight">Birim ağırlığı (kg)</label>
            <input
              id="product-weight"
              name="unit_weight_kg"
              type="number"
              min="0.001"
              step="any"
              value={form.unit_weight_kg}
              onChange={handleChange}
              required
            />

            <label htmlFor="product-stock">Stok miktarı</label>
            <input
              id="product-stock"
              name="stock"
              type="number"
              min="0"
              step="any"
              value={form.stock}
              onChange={handleChange}
              required
            />

            <label htmlFor="product-price">Birim satış fiyatı (TL)</label>
            <input
              id="product-price"
              name="price"
              type="number"
              min="0"
              step="any"
              value={form.price}
              onChange={handleChange}
              required
            />

            {message && <div className="product-error">{message}</div>}

            <div className="product-modal-actions">
              <button
                type="button"
                className="product-cancel-button"
                onClick={closeModal}
                disabled={saving || addingCategory}
              >
                Vazgeç
              </button>

              <button
                type="submit"
                className="product-save-button"
                disabled={saving || addingCategory}
              >
                {saving
                  ? "Kaydediliyor..."
                  : editingProduct
                    ? "Değişiklikleri Kaydet"
                    : "Ürünü Ekle"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Alış kaydı penceresi */}
      {purchaseModalOpen && purchaseProduct && (
        <div className="product-modal-backdrop">
          <form
            className="product-modal purchase-modal"
            onSubmit={handlePurchaseSubmit}
          >
            <button
              type="button"
              className="product-modal-close"
              onClick={closePurchaseModal}
              disabled={purchaseSaving}
            >
              ×
            </button>

            <h2>Alış Kaydı Oluştur</h2>
            <p>
              Ürün: <strong>{purchaseProduct.name}</strong>
            </p>

            <label htmlFor="purchase-supplier">Tedarikçi / Firma adı</label>
            <input
              id="purchase-supplier"
              name="supplier_name"
              value={purchaseForm.supplier_name}
              onChange={handlePurchaseChange}
              placeholder="Tedarikçi adı"
              required
            />

            <label htmlFor="purchase-invoice-number">Fatura numarası</label>
            <input
              id="purchase-invoice-number"
              name="invoice_number"
              value={purchaseForm.invoice_number}
              onChange={handlePurchaseChange}
              placeholder="Fatura numarası"
              required
            />

            <label htmlFor="purchase-invoice-date">Fatura tarihi</label>
            <input
              id="purchase-invoice-date"
              type="date"
              name="invoice_date"
              value={purchaseForm.invoice_date}
              onChange={handlePurchaseChange}
              required
            />

            <label htmlFor="purchase-date">Alış tarihi</label>
            <input
              id="purchase-date"
              type="date"
              name="purchase_date"
              value={purchaseForm.purchase_date}
              onChange={handlePurchaseChange}
              required
            />

            <label htmlFor="purchase-quantity">Alınan miktar</label>
            <input
              id="purchase-quantity"
              type="number"
              name="quantity"
              min="0.001"
              step="any"
              value={purchaseForm.quantity}
              onChange={handlePurchaseChange}
              placeholder="Örn. 50"
              required
            />

            <label htmlFor="purchase-unit-cost">Birim alış fiyatı (TL)</label>
            <input
              id="purchase-unit-cost"
              type="number"
              name="unit_cost"
              min="0"
              step="any"
              value={purchaseForm.unit_cost}
              onChange={handlePurchaseChange}
              placeholder="Örn. 450"
              required
            />

            <div className="purchase-total">
              <span>Toplam alış tutarı</span>
              <strong>{money(purchaseTotal)}</strong>
            </div>

            <label htmlFor="purchase-payment">Ödeme yöntemi</label>
            <select
              id="purchase-payment"
              name="payment_method"
              value={purchaseForm.payment_method}
              onChange={handlePurchaseChange}
              required
            >
              <option value="Havale">Havale / EFT</option>
              <option value="Nakit">Nakit</option>
              <option value="Kredi Kartı">Kredi Kartı</option>
              <option value="Çek">Çek</option>
              <option value="Vadeli">Vadeli</option>
              <option value="Diğer">Diğer</option>
            </select>

            <label className="purchase-stock-option">
              <input
                type="checkbox"
                name="stock_added"
                checked={purchaseForm.stock_added}
                onChange={handlePurchaseChange}
              />
              Bu alış miktarını mevcut stoğa ekle
            </label>

            {message && <div className="product-error">{message}</div>}

            <div className="product-modal-actions">
              <button
                type="button"
                className="product-cancel-button"
                onClick={closePurchaseModal}
                disabled={purchaseSaving}
              >
                Vazgeç
              </button>

              <button
                type="submit"
                className="product-save-button"
                disabled={purchaseSaving}
              >
                {purchaseSaving ? "Kaydediliyor..." : "Alışı Kaydet"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Ürün künyesi penceresi */}
      {historyModalOpen && historyProduct && (
        <div className="product-modal-backdrop">
          <div className="product-modal history-modal">
            <button
              type="button"
              className="product-modal-close"
              onClick={closeHistoryModal}
            >
              ×
            </button>

            <h2>Ürün Künyesi</h2>
            <h3>{historyProduct.name}</h3>

            <div className="history-summary">
              <div>
                <span>Kategori</span>
                <strong>
                  {historyProduct.category_name || "Kategorisiz"}
                </strong>
              </div>

              <div>
                <span>Mevcut stok</span>
                <strong>
                  {historyProduct.stock} x {historyProduct.min_unit_label}
                </strong>
              </div>

              <div>
                <span>Satış fiyatı</span>
                <strong>{money(historyProduct.price)}</strong>
              </div>

              <div>
                <span>Son alış fiyatı</span>
                <strong>
                  {latestPurchase
                    ? money(latestPurchase.unit_cost)
                    : "Alış kaydı yok"}
                </strong>
              </div>

              <div>
                <span>Birim brüt fiyat farkı</span>
                <strong
                  className={
                    grossDifference === null
                      ? ""
                      : grossDifference >= 0
                        ? "history-positive"
                        : "history-negative"
                  }
                >
                  {grossDifference === null
                    ? "-"
                    : money(grossDifference)}
                </strong>
              </div>

              <div>
                <span>Brüt fark oranı</span>
                <strong>
                  {grossDifferencePercent === null
                    ? "-"
                    : `%${grossDifferencePercent.toLocaleString("tr-TR", {
                        maximumFractionDigits: 2,
                      })}`}
                </strong>
              </div>
            </div>

            <h3>Alış Geçmişi</h3>

            {historyLoading ? (
              <div className="products-empty">
                Alış geçmişi yükleniyor...
              </div>
            ) : purchaseHistory.length === 0 ? (
              <div className="products-empty">
                Bu ürün için henüz alış kaydı bulunmuyor.
              </div>
            ) : (
              <div className="history-table-scroll">
                <div className="products-table-wrapper">
                  <table className="products-table">
                    <thead>
                      <tr>
                        <th>Alış Tarihi</th>
                        <th>Tedarikçi</th>
                        <th>Fatura No</th>
                        <th>Miktar</th>
                        <th>Birim Alış</th>
                        <th>Toplam</th>
                        <th>Ödeme</th>
                        <th>Stok</th>
                      </tr>
                    </thead>

                    <tbody>
                      {purchaseHistory.map((purchase) => (
                        <tr key={purchase.id}>
                          <td>{dateText(purchase.purchase_date)}</td>
                          <td>{purchase.supplier_name}</td>
                          <td>{purchase.invoice_number}</td>
                          <td>
                            {purchase.quantity} {historyProduct.min_unit_label}
                          </td>
                          <td>{money(purchase.unit_cost)}</td>
                          <td>{money(purchase.total_price)}</td>
                          <td>{purchase.payment_method}</td>
                          <td>
                            {purchase.stock_added ? "Eklendi" : "Eklenmedi"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="product-modal-actions">
              <button
                type="button"
                className="product-cancel-button"
                onClick={closeHistoryModal}
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


import { useCallback, useEffect, useMemo, useState } from "react";
import "./AdminCustomersPage.css";

const API_URL = "http://localhost:4000";

const emptyCustomer = {
  company_name: "",
  tax_number: "",
  contact_name: "",
  phone: "",
  address: "",
  district_id: "",
};

const money = (value) =>
  Number(value || 0).toLocaleString("tr-TR", {
    style: "currency",
    currency: "TRY",
  });

const dateText = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("tr-TR");
};

const getErrorMessage = (data, fallback) =>
  data?.message || fallback;

export default function AdminCustomersPage({ session }) {
  const token = session?.token;

  const [customers, setCustomers] = useState([]);
  const [districts, setDistricts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [modal, setModal] = useState("");
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState(emptyCustomer);

  const [transactionForm, setTransactionForm] = useState({
    amount: "",
    description: "",
  });

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token]
  );

  const loadCustomers = useCallback(async () => {
    if (!token) {
      setError("Oturum bilgisi bulunamadı. Lütfen tekrar giriş yapın.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [customerResponse, districtResponse] = await Promise.all([
        fetch(`${API_URL}/customers`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/districts`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const customerData = await customerResponse.json();
      const districtData = await districtResponse.json();

      if (!customerResponse.ok) {
        throw new Error(
          getErrorMessage(customerData, "Müşteriler yüklenemedi.")
        );
      }

      if (!districtResponse.ok) {
        throw new Error(
          getErrorMessage(districtData, "İlçeler yüklenemedi.")
        );
      }

      setCustomers(Array.isArray(customerData) ? customerData : []);

      const districtList = Array.isArray(districtData)
        ? districtData
        : districtData.districts || [];

      setDistricts(districtList);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const loadCustomerDetails = async (customer) => {
    setSelectedCustomer(customer);
    setTransactions([]);
    setDetailLoading(true);
    setMessage("");
    setModal("details");

    try {
      const response = await fetch(
        `${API_URL}/customers/${customer.id}/current-account/transactions`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, "Cari hareketler alınamadı.")
        );
      }

      setTransactions(data.transactions || []);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshSelectedCustomer = async () => {
    await loadCustomers();

    if (!selectedCustomer) return;

    try {
      const response = await fetch(
        `${API_URL}/customers/${selectedCustomer.id}/current-account/transactions`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, "Cari hareketler yenilenemedi.")
        );
      }

      setTransactions(data.transactions || []);

      const customerResponse = await fetch(`${API_URL}/customers`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const customerData = await customerResponse.json();

      if (customerResponse.ok && Array.isArray(customerData)) {
        const updated = customerData.find(
          (item) => item.id === selectedCustomer.id
        );

        if (updated) setSelectedCustomer(updated);
      }
    } catch (err) {
      setMessage(err.message);
    }
  };

  const filteredCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");

    return customers.filter((customer) => {
      const matchesSearch =
        !normalizedSearch ||
        [
          customer.company_name,
          customer.contact_name,
          customer.phone,
          customer.tax_number,
          customer.district_name,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value)
              .toLocaleLowerCase("tr-TR")
              .includes(normalizedSearch)
          );

      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && customer.active) ||
        (statusFilter === "PASSIVE" && !customer.active);

      return matchesSearch && matchesStatus;
    });
  }, [customers, search, statusFilter]);

  const totalBalance = customers.reduce(
    (sum, customer) => sum + Number(customer.balance || 0),
    0
  );

  const totalDebit = customers.reduce(
    (sum, customer) => sum + Number(customer.total_debit || 0),
    0
  );

  const totalPayment = customers.reduce(
    (sum, customer) => sum + Number(customer.total_payment || 0),
    0
  );


  const openEditCustomer = (customer) => {
    setEditingCustomer(customer);

    setCustomerForm({
      company_name: customer.company_name || "",
      tax_number: customer.tax_number || "",
      contact_name: customer.contact_name || "",
      phone: customer.phone || "",
      address: customer.address || "",
      district_id: customer.district_id
        ? String(customer.district_id)
        : "",
    });

    setMessage("");
    setModal("customer-form");
  };

  const closeModal = () => {
    if (saving) return;

    setModal("");
    setMessage("");
    setEditingCustomer(null);
    setTransactionForm({
      amount: "",
      description: "",
    });
  };

  const handleCustomerFormChange = (event) => {
    const { name, value } = event.target;

    setCustomerForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const saveCustomer = async (event) => {
    event.preventDefault();

    if (!customerForm.company_name.trim()) {
      setMessage("Firma adı zorunludur.");
      return;
    }

    if (!customerForm.tax_number.trim()) {
      setMessage("Vergi numarası zorunludur.");
      return;
    }

    setSaving(true);
    setMessage("");

    const body = {
      ...customerForm,
      company_name: customerForm.company_name.trim(),
      tax_number: customerForm.tax_number.trim(),
      contact_name: customerForm.contact_name.trim(),
      phone: customerForm.phone.trim(),
      address: customerForm.address.trim(),
      district_id: customerForm.district_id
        ? Number(customerForm.district_id)
        : null,
    };

    try {
      const isEditing = Boolean(editingCustomer);

      const response = await fetch(
        isEditing
          ? `${API_URL}/customers/${editingCustomer.id}`
          : `${API_URL}/customers`,
        {
          method: isEditing ? "PUT" : "POST",
          headers,
          body: JSON.stringify(body),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, "Müşteri kaydedilemedi.")
        );
      }

      setModal("");
      setEditingCustomer(null);
      await loadCustomers();

      if (isEditing && selectedCustomer) {
        const updatedCustomer = {
          ...selectedCustomer,
          ...data,
        };
        setSelectedCustomer(updatedCustomer);
      }

      alert(
        isEditing
          ? "Müşteri bilgileri güncellendi."
          : "Yeni müşteri başarıyla eklendi."
      );
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleCustomerStatus = async (customer) => {
    const actionText = customer.active ? "pasif" : "aktif";

    if (
      !window.confirm(
        `${customer.company_name} müşterisini ${actionText} yapmak istiyor musunuz?`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/customers/${customer.id}/active`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, "Müşteri durumu değiştirilemedi.")
        );
      }

      await loadCustomers();

      if (selectedCustomer?.id === customer.id) {
        setSelectedCustomer((previous) => ({
          ...previous,
          ...data,
        }));
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const openTransactionModal = (type) => {
    setTransactionForm({
      amount: "",
      description:
        type === "debit" ? "Manuel borç kaydı" : "Müşteri tahsilatı",
    });

    setMessage("");
    setModal(type);
  };

  const saveTransaction = async (event) => {
    event.preventDefault();

    if (!selectedCustomer) return;

    const amount = Number(
      String(transactionForm.amount).replace(",", ".")
    );

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Geçerli bir tutar girin.");
      return;
    }

    if (
      modal === "debit" &&
      !transactionForm.description.trim()
    ) {
      setMessage("Borç açıklaması zorunludur.");
      return;
    }

    setSaving(true);
    setMessage("");

    const isDebit = modal === "debit";

    const endpoint = isDebit
      ? `${API_URL}/customers/${selectedCustomer.id}/debits`
      : `${API_URL}/customers/${selectedCustomer.id}/payments`;

    const body = {
      amount,
      description:
        transactionForm.description.trim() ||
        (isDebit ? "Manuel borç kaydı" : "Müşteri tahsilatı"),
    };

    if (!isDebit) {
      body.idempotency_key =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `payment-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 12)}`;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, "Cari işlem kaydedilemedi.")
        );
      }

      setModal("details");
      setTransactionForm({
        amount: "",
        description: "",
      });

      await refreshSelectedCustomer();

      alert(
        data.message ||
          (isDebit
            ? "Borç kaydedildi."
            : "Tahsilat kaydedildi.")
      );
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedTotalDebit = transactions
    .filter((item) => item.transaction_type === "DEBIT")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const selectedTotalPayment = transactions
    .filter((item) => item.transaction_type === "PAYMENT")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const selectedBalance = selectedTotalDebit - selectedTotalPayment;

  return (
    <div className="customers-page">
      <div className="customers-heading">
        <div>
          <h2>Müşteri Yönetimi</h2>
          <p>Müşterilerinizi ve cari hesaplarını tek ekrandan yönetin.</p>
        </div>

        <div className="customers-heading-actions">
          <button
            type="button"
            className="customers-refresh-button"
            onClick={loadCustomers}
            disabled={loading}
          >
            ↻ Yenile
          </button>
        </div>
      </div>

      <div className="customers-summary">
        <div className="customer-summary-card">
          <span>Toplam Müşteri</span>
          <strong>{customers.length}</strong>
        </div>

        <div className="customer-summary-card">
          <span>Genel Cari Bakiye</span>
          <strong>{money(totalBalance)}</strong>
        </div>
      </div>

      <div className="customers-toolbar">
        <input
          type="search"
          placeholder="Firma, yetkili, telefon, vergi no veya ilçe ara..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="ALL">Tüm müşteriler</option>
          <option value="ACTIVE">Aktif müşteriler</option>
          <option value="PASSIVE">Pasif müşteriler</option>
        </select>
      </div>

      {error && (
        <div className="customers-error">{error}</div>
      )}

      {loading ? (
        <div className="customers-empty">Müşteriler yükleniyor...</div>
      ) : filteredCustomers.length === 0 ? (
        <div className="customers-empty">
          {customers.length === 0
            ? "Henüz müşteri kaydı bulunmuyor."
            : "Aramanıza uygun müşteri bulunamadı."}
        </div>
      ) : (
        <div className="customers-table-wrapper">
          <table className="customers-table">
            <thead>
              <tr>
                <th>Firma</th>
                <th>Yetkili</th>
                <th>Telefon</th>
                <th>İlçe</th>
                <th>Toplam Borç</th>
                <th>Toplam Tahsilat</th>
                <th>Cari Bakiye</th>
                <th>Durum</th>
                <th>İşlem</th>
              </tr>
            </thead>

            <tbody>
              {filteredCustomers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong>{customer.company_name}</strong>
                    <small>#{customer.id}</small>
                  </td>

                  <td>{customer.contact_name || "-"}</td>
                  <td>{customer.phone || "-"}</td>
                  <td>{customer.district_name || "-"}</td>
                  <td>{money(customer.total_debit)}</td>
                  <td>{money(customer.total_payment)}</td>
                  <td className="customer-balance-cell">
                    <strong>{money(customer.balance)}</strong>
                  </td>

                  <td>
                    <span
                      className={`customer-status ${
                        customer.active ? "active" : "passive"
                      }`}
                    >
                      {customer.active ? "Aktif" : "Pasif"}
                    </span>
                  </td>

                  <td>
                    <div className="customer-row-actions">
                      <button
                        type="button"
                        className="customer-detail-button"
                        onClick={() => loadCustomerDetails(customer)}
                      >
                        Künyeyi Aç
                      </button>

                      <button
                        type="button"
                        className="customer-edit-button"
                        onClick={() => openEditCustomer(customer)}
                      >
                        Düzenle
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Müşteri ekleme ve düzenleme */}
      {modal === "customer-form" && (
        <div className="customer-modal-backdrop">
          <form
            className="customer-modal customer-form-modal"
            onSubmit={saveCustomer}
          >
            <button
              type="button"
              className="customer-modal-close"
              onClick={closeModal}
              disabled={saving}
            >
              ×
            </button>

            <h2>
              {editingCustomer ? "Müşteri Bilgilerini Düzenle" : "Yeni Müşteri"}
            </h2>

            <div className="customer-form-grid">
              <label>
                Firma adı *
                <input
                  name="company_name"
                  value={customerForm.company_name}
                  onChange={handleCustomerFormChange}
                  required
                />
              </label>

              <label>
                Vergi numarası *
                <input
                  name="tax_number"
                  value={customerForm.tax_number}
                  onChange={handleCustomerFormChange}
                  required
                />
              </label>

              <label>
                Yetkili kişi
                <input
                  name="contact_name"
                  value={customerForm.contact_name}
                  onChange={handleCustomerFormChange}
                />
              </label>

              <label>
                Telefon
                <input
                  name="phone"
                  value={customerForm.phone}
                  onChange={handleCustomerFormChange}
                />
              </label>

              <label>
                İlçe
                <select
                  name="district_id"
                  value={customerForm.district_id}
                  onChange={handleCustomerFormChange}
                >
                  <option value="">İlçe seçin</option>
                  {districts.map((district) => (
                    <option key={district.id} value={district.id}>
                      {district.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="customer-full-width">
                Adres
                <textarea
                  name="address"
                  value={customerForm.address}
                  onChange={handleCustomerFormChange}
                  rows={3}
                />
              </label>
            </div>

            {message && (
              <div className="customers-error">{message}</div>
            )}

            <div className="customer-modal-actions">
              <button
                type="button"
                className="customer-secondary-button"
                onClick={closeModal}
                disabled={saving}
              >
                Vazgeç
              </button>

              <button
                type="submit"
                className="customers-primary-button"
                disabled={saving}
              >
                {saving
                  ? "Kaydediliyor..."
                  : editingCustomer
                    ? "Değişiklikleri Kaydet"
                    : "Müşteriyi Kaydet"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Müşteri künyesi */}
      {modal === "details" && selectedCustomer && (
        <div className="customer-modal-backdrop">
          <div className="customer-modal customer-detail-modal">
            <button
              type="button"
              className="customer-modal-close"
              onClick={closeModal}
            >
              ×
            </button>

            <div className="customer-detail-heading">
              <div>
                <span className="customer-detail-eyebrow">
                  MÜŞTERİ KÜNYESİ
                </span>
                <h2>{selectedCustomer.company_name}</h2>
                <p>
                  Müşteri No: #{selectedCustomer.id}
                  {" · "}
                  {selectedCustomer.district_name || "İlçe belirtilmemiş"}
                </p>
              </div>

              <span
                className={`customer-status ${
                  selectedCustomer.active ? "active" : "passive"
                }`}
              >
                {selectedCustomer.active ? "Aktif" : "Pasif"}
              </span>
            </div>

            <div className="customer-detail-info">
              <div>
                <span>Vergi numarası</span>
                <strong>{selectedCustomer.tax_number || "-"}</strong>
              </div>

              <div>
                <span>Yetkili kişi</span>
                <strong>{selectedCustomer.contact_name || "-"}</strong>
              </div>

              <div>
                <span>Telefon</span>
                <strong>{selectedCustomer.phone || "-"}</strong>
              </div>

              <div>
                <span>İlçe</span>
                <strong>{selectedCustomer.district_name || "-"}</strong>
              </div>

              <div className="customer-address-info">
                <span>Adres</span>
                <strong>{selectedCustomer.address || "-"}</strong>
              </div>
            </div>

            <div className="customer-detail-actions">
              <button
                type="button"
                className="customer-edit-button"
                onClick={() => openEditCustomer(selectedCustomer)}
              >
                Bilgileri Düzenle
              </button>

              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => toggleCustomerStatus(selectedCustomer)}
              >
                {selectedCustomer.active ? "Pasif Yap" : "Aktif Yap"}
              </button>

              <button
                type="button"
                className="customer-debit-button"
                onClick={() => openTransactionModal("debit")}
              >
                + Borç Ekle
              </button>

              <button
                type="button"
                className="customer-payment-button"
                onClick={() => openTransactionModal("payment")}
                disabled={!selectedCustomer.active}
              >
                + Tahsilat Al
              </button>
            </div>

            <h3 className="customer-section-title">Cari Hesap Özeti</h3>

            <div className="customer-account-summary">
              <div>
                <span>Toplam Borç</span>
                <strong>{money(selectedTotalDebit)}</strong>
              </div>

              <div>
                <span>Toplam Tahsilat</span>
                <strong>{money(selectedTotalPayment)}</strong>
              </div>

              <div>
                <span>Kalan Bakiye</span>
                <strong>{money(selectedBalance)}</strong>
              </div>
            </div>

            <div className="customer-history-heading">
              <h3 className="customer-section-title">Cari Hareket Geçmişi</h3>
              <span>{transactions.length} işlem</span>
            </div>

            {message && (
              <div className="customers-error">{message}</div>
            )}

            {detailLoading ? (
              <div className="customers-empty">
                Cari hareketler yükleniyor...
              </div>
            ) : transactions.length === 0 ? (
              <div className="customers-empty">
                Bu müşteriye ait henüz cari hareket bulunmuyor.
              </div>
            ) : (
              <div className="customer-transactions-wrapper">
                <table className="customer-transactions-table">
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>İşlem</th>
                      <th>Açıklama</th>
                      <th>Sipariş No</th>
                      <th>Tutar</th>
                    </tr>
                  </thead>

                  <tbody>
                    {transactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{dateText(transaction.created_at)}</td>

                        <td>
                          <span
                            className={`transaction-type ${
                              transaction.transaction_type === "DEBIT"
                                ? "debit"
                                : "payment"
                            }`}
                          >
                            {transaction.transaction_type === "DEBIT"
                              ? "Borç"
                              : "Tahsilat"}
                          </span>
                        </td>

                        <td>{transaction.description || "-"}</td>

                        <td>
                          {transaction.order_id
                            ? `#${transaction.order_id}`
                            : "-"}
                        </td>

                        <td
                          className={
                            transaction.transaction_type === "DEBIT"
                              ? "transaction-debit-amount"
                              : "transaction-payment-amount"
                          }
                        >
                          {transaction.transaction_type === "DEBIT"
                            ? "+"
                            : "-"}
                          {money(transaction.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="customer-modal-actions">
              <button
                type="button"
                className="customer-secondary-button"
                onClick={closeModal}
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Borç ve tahsilat penceresi */}
      {(modal === "debit" || modal === "payment") &&
        selectedCustomer && (
          <div className="customer-modal-backdrop">
            <form
              className="customer-modal customer-transaction-modal"
              onSubmit={saveTransaction}
            >
              <button
                type="button"
                className="customer-modal-close"
                onClick={closeModal}
                disabled={saving}
              >
                ×
              </button>

              <h2>
                {modal === "debit" ? "Manuel Borç Ekle" : "Tahsilat Al"}
              </h2>

              <p className="customer-transaction-customer">
                {selectedCustomer.company_name}
              </p>

              <div className="customer-current-balance">
                <span>Mevcut bakiye</span>
                <strong>{money(selectedBalance)}</strong>
              </div>

              <label>
                İşlem tutarı (₺) *
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={transactionForm.amount}
                  onChange={(event) =>
                    setTransactionForm((previous) => ({
                      ...previous,
                      amount: event.target.value,
                    }))
                  }
                  placeholder="0,00"
                  required
                />
              </label>

              <label>
                Açıklama
                <textarea
                  rows={3}
                  value={transactionForm.description}
                  onChange={(event) =>
                    setTransactionForm((previous) => ({
                      ...previous,
                      description: event.target.value,
                    }))
                  }
                  placeholder="İşlem açıklaması..."
                  required={modal === "debit"}
                />
              </label>

              {message && (
                <div className="customers-error">{message}</div>
              )}

              <div className="customer-modal-actions">
                <button
                  type="button"
                  className="customer-secondary-button"
                  onClick={() => {
                    setModal("details");
                    setMessage("");
                  }}
                  disabled={saving}
                >
                  Vazgeç
                </button>

                <button
                  type="submit"
                  className={
                    modal === "debit"
                      ? "customer-debit-button"
                      : "customer-payment-button"
                  }
                  disabled={saving}
                >
                  {saving
                    ? "Kaydediliyor..."
                    : modal === "debit"
                      ? "Borcu Kaydet"
                      : "Tahsilatı Kaydet"}
                </button>
              </div>
            </form>
          </div>
        )}
    </div>
  );
}

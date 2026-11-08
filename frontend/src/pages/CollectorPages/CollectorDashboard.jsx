import { useEffect, useMemo, useState } from "react";
import "./CollectorDashboard.css";

const API_URL = "http://localhost:4000";

function formatMoney(value) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

async function readResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Sunucudan beklenmeyen bir yanıt alındı. API adresini ve sunucuyu kontrol edin.");
  }
}

function CollectorDashboard({ session, onLogout }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const [search, setSearch] = useState("");
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const headers = {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };

  async function loadCustomers() {
    try {
      setLoading(true);
      setError("");
      const response = await fetch(`${API_URL}/customers`, { headers });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || "Müşteriler alınamadı.");
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCustomerDetails(customer) {
    setSelectedCustomer(customer);
    setTransactions([]);
    setShowTransactions(false);
    setShowPaymentForm(false);
    setError("");
    setSuccess("");
    setDetailLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/customers/${customer.id}/current-account`,
        { headers },
      );
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || "Cari bakiye alınamadı.");

      setSelectedCustomer((previous) => ({
        ...previous,
        ...customer,
        balance: Number(data.current_account?.balance ?? customer.balance ?? 0),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadTransactions(customer = selectedCustomer) {
    if (!customer) return;
    try {
      setTransactionsLoading(true);
      const response = await fetch(
        `${API_URL}/customers/${customer.id}/current-account/transactions`,
        { headers },
      );
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || "Hesap hareketleri alınamadı.");
      setTransactions(data.transactions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setTransactionsLoading(false);
    }
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const districts = useMemo(
    () => [...new Set(customers.map((c) => c.district_name).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "tr")),
    [customers],
  );

  const districtCustomers = useMemo(
    () => customers.filter((customer) => customer.district_name === selectedDistrict),
    [customers, selectedDistrict],
  );

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("tr");
    return districtCustomers.filter((customer) =>
      (customer.company_name || "").toLocaleLowerCase("tr").includes(term),
    );
  }, [districtCustomers, search]);

  const totalBalance = customers.reduce(
    (sum, customer) => sum + Number(customer.balance || 0),
    0,
  );

  function openDistrict(district) {
    setSelectedDistrict(district);
    setSearch("");
    setSelectedCustomer(null);
    setTransactions([]);
    setError("");
    setSuccess("");
  }

  function backToDistricts() {
    setSelectedDistrict("");
    setSelectedCustomer(null);
    setTransactions([]);
    setSearch("");
    setShowPaymentForm(false);
    setShowTransactions(false);
    setError("");
    setSuccess("");
  }

  function backToStores() {
    setSelectedCustomer(null);
    setTransactions([]);
    setShowPaymentForm(false);
    setShowTransactions(false);
    setError("");
    setSuccess("");
  }

  async function handlePayment(event) {
    event.preventDefault();
    if (!selectedCustomer) return;

    const paymentAmount = Number(amount);
    const currentBalance = Number(selectedCustomer.balance || 0);

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setError("Geçerli bir tahsilat tutarı girin.");
      return;
    }
    if (paymentAmount > currentBalance) {
      setError("Tahsilat tutarı mevcut borçtan fazla olamaz.");
      return;
    }

    try {
      setPaymentLoading(true);
      setError("");
      setSuccess("");

      const idempotencyKey = `payment-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      const response = await fetch(
        `${API_URL}/customers/${selectedCustomer.id}/payments`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            amount: paymentAmount,
            description: description.trim() || "Müşteri tahsilatı",
            idempotency_key: idempotencyKey,
          }),
        },
      );
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || "Tahsilat kaydedilemedi.");

      setSuccess(data.message || "Tahsilat başarıyla kaydedildi.");
      setAmount("");
      setDescription("");
      setShowPaymentForm(false);
      await loadCustomers();
      await loadCustomerDetails(selectedCustomer);

      if (showTransactions) await loadTransactions(selectedCustomer);
    } catch (err) {
      setError(err.message);
    } finally {
      setPaymentLoading(false);
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("Yeni şifre en az 8 karakter olmalıdır.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Yeni şifreler birbiriyle eşleşmiyor.");
      return;
    }

    try {
      setPasswordLoading(true);
      const response = await fetch(`${API_URL}/auth/change-password`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || "Şifre değiştirilemedi.");

      setSuccess(data.message || "Şifreniz başarıyla değiştirildi.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
      setMobileMenuOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setPasswordLoading(false);
    }
  }

  function openPasswordSection() {
    setShowPasswordForm(true);
    setSelectedCustomer(null);
    setSelectedDistrict("");
    setShowPaymentForm(false);
    setShowTransactions(false);
    setError("");
    setSuccess("");
    setMobileMenuOpen(false);
  }

  const pageTitle = showPasswordForm
    ? "Şifre Değiştir"
    : selectedCustomer
      ? selectedCustomer.company_name
      : selectedDistrict
        ? `${selectedDistrict} Mağazaları`
        : "İlçeler";

  return (
    <div className="collector-layout">
      {mobileMenuOpen && (
        <button
          type="button"
          className="collector-mobile-overlay"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Menüyü kapat"
        />
      )}

      <aside className={`collector-sidebar ${mobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="collector-brand">
          <div className="collector-brand-icon">K</div>
          <div className="collector-brand-text">
            <h2>KİLCAROĞLU</h2>
            <span>Toptan Satış ve Dağıtım</span>
          </div>
          <button
            type="button"
            className="collector-mobile-close"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Menüyü kapat"
          >×</button>
        </div>

        <nav className="collector-menu">
          <div className="collector-menu-title">HESAP</div>
          <button
            type="button"
            className={`collector-menu-item ${!showPasswordForm ? "active" : ""}`}
            onClick={() => {
              setShowPasswordForm(false);
              setSelectedCustomer(null);
              setSelectedDistrict("");
              setMobileMenuOpen(false);
            }}
          >
            <span>▦</span> Tahsilat İşlemleri
          </button>
          <button
            type="button"
            className={`collector-menu-item ${showPasswordForm ? "active" : ""}`}
            onClick={openPasswordSection}
          >
            <span>♙</span> Şifre Değiştir
          </button>
        </nav>

        <div className="collector-sidebar-bottom">
          <div className="collector-user">
            <div className="collector-user-avatar">
              {(session.user?.name || "T").charAt(0).toLocaleUpperCase("tr")}
            </div>
            <div className="collector-user-info">
              <strong>{session.user?.name || "Tahsildar"}</strong>
              <span>Tahsildar</span>
            </div>
          </div>
          <button className="collector-logout" onClick={onLogout}>
            <span>↪</span> Güvenli Çıkış
          </button>
        </div>
      </aside>

      <main className="collector-main">
        <header className="collector-header">
          <div className="collector-header-title">
            <button
              type="button"
              className="collector-mobile-menu-button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Menüyü aç"
            >☰</button>
            <div>
              <div className="collector-eyebrow">TAHSİLDAR PANELİ</div>
              <h1>{pageTitle}</h1>
              <p>Mağaza hesaplarını ve tahsilat işlemlerini yönetin.</p>
            </div>
          </div>
          {!showPasswordForm && (
            <button
              type="button"
              className="collector-refresh"
              onClick={loadCustomers}
              disabled={loading}
            >↻ Yenile</button>
          )}
        </header>

        {error && (
          <div className="collector-alert error">
            <span>{error}</span>
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {success && (
          <div className="collector-alert success">
            <span>{success}</span>
            <button onClick={() => setSuccess("")}>×</button>
          </div>
        )}

        {showPasswordForm ? (
          <section className="collector-password-card">
            <div className="collector-card-icon">⌑</div>
            <h2>Şifre Yenileme</h2>
            <p>Hesabınızın güvenliği için mevcut şifrenizi ve yeni şifrenizi girin.</p>
            <form onSubmit={handlePasswordChange}>
              <div className="collector-form-group">
                <label>Mevcut Şifre</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="collector-form-group">
                <label>Yeni Şifre</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength="8"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="En az 8 karakter"
                  required
                />
              </div>
              <div className="collector-form-group">
                <label>Yeni Şifre Tekrar</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <button className="collector-primary-button" type="submit" disabled={passwordLoading}>
                {passwordLoading ? "Kaydediliyor..." : "Şifreyi Güncelle"}
              </button>
            </form>
          </section>
        ) : (
          <>
            {!selectedDistrict && !selectedCustomer && (
              <>
                <section className="collector-overview">
                  <div className="collector-overview-card">
                    <span className="overview-icon">⌂</span>
                    <div><small>Kayıtlı Mağaza</small><strong>{customers.length}</strong></div>
                  </div>
                  <div className="collector-overview-card">
                    <span className="overview-icon money">₺</span>
                    <div><small>Toplam Açık Bakiye</small><strong>{formatMoney(totalBalance)}</strong></div>
                  </div>
                </section>
                <section className="collector-list-card">
                  <div className="collector-list-heading">
                    <div><h2>İlçe Seçin</h2><p>Mağazaları görüntülemek için bir ilçe seçin.</p></div>
                    <span className="collector-count">{districts.length} ilçe</span>
                  </div>
                  {loading ? (
                    <div className="collector-state">İlçeler yükleniyor...</div>
                  ) : districts.length === 0 ? (
                    <div className="collector-state">Kayıtlı ilçe bulunamadı.</div>
                  ) : (
                    <div className="collector-district-grid">
                      {districts.map((district) => {
                        const count = customers.filter((c) => c.district_name === district).length;
                        return (
                          <button
                            type="button"
                            className="collector-district-card"
                            key={district}
                            onClick={() => openDistrict(district)}
                          >
                            <span className="district-symbol">⌖</span>
                            <span className="district-card-text"><strong>{district}</strong><small>{count} mağaza</small></span>
                            <span className="district-arrow">›</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}

            {selectedDistrict && !selectedCustomer && (
              <section className="collector-list-card">
                <div className="collector-breadcrumb">
                  <button type="button" onClick={backToDistricts}>‹ İlçeler</button>
                  <span>/</span><strong>{selectedDistrict}</strong>
                </div>
                <div className="collector-list-heading">
                  <div><h2>{selectedDistrict} Mağazaları</h2><p>Tahsilat yapmak istediğiniz mağazayı seçin.</p></div>
                  <span className="collector-count">{filteredCustomers.length} mağaza</span>
                </div>
                <div className="collector-search">
                  <span>⌕</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Bu ilçede mağaza ara..."
                  />
                  {search && <button type="button" onClick={() => setSearch("")}>×</button>}
                </div>
                {loading ? (
                  <div className="collector-state">Mağazalar yükleniyor...</div>
                ) : filteredCustomers.length === 0 ? (
                  <div className="collector-state">Bu ilçede mağaza bulunamadı.</div>
                ) : (
                  <div className="collector-store-list">
                    {filteredCustomers.map((customer) => (
                      <button
                        type="button"
                        className="collector-store-card"
                        key={customer.id}
                        onClick={() => loadCustomerDetails(customer)}
                      >
                        <span className="store-avatar">{(customer.company_name || "M").charAt(0).toLocaleUpperCase("tr")}</span>
                        <span className="store-card-info">
                          <strong>{customer.company_name}</strong>
                          <small>{customer.phone || "Telefon bilgisi yok"}</small>
                        </span>
                        <span className="store-card-balance">
                          <strong>{formatMoney(customer.balance)}</strong>
                          <small>Güncel bakiye</small>
                        </span>
                        <span className="store-arrow">›</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {selectedCustomer && (
              <section className="collector-customer-detail">
                <div className="collector-breadcrumb">
                  <button type="button" onClick={backToDistricts}>İlçeler</button>
                  <span>/</span>
                  <button type="button" onClick={backToStores}>{selectedDistrict}</button>
                  <span>/</span><strong>Mağaza</strong>
                </div>

                <div className="collector-store-profile">
                  <span className="store-avatar large">{(selectedCustomer.company_name || "M").charAt(0).toLocaleUpperCase("tr")}</span>
                  <div><h2>{selectedCustomer.company_name}</h2><p>{selectedCustomer.phone || "Telefon belirtilmemiş"}</p></div>
                </div>

                <div className="collector-balance-card">
                  <span>GÜNCEL BORÇ BAKİYESİ</span>
                  <strong>{detailLoading ? "Hesaplanıyor..." : formatMoney(selectedCustomer.balance)}</strong>
                  <small>{selectedCustomer.district_name || selectedDistrict}</small>
                </div>

                <div className="collector-detail-actions">
                  <button
                    type="button"
                    className="collector-primary-button"
                    onClick={() => {
                      setShowPaymentForm((v) => !v);
                      setShowTransactions(false);
                      setError("");
                    }}
                    disabled={detailLoading || Number(selectedCustomer.balance) <= 0}
                  >{showPaymentForm ? "Tahsilat Formunu Kapat" : "₺ Tahsilat Yap"}</button>
                  <button
                    type="button"
                    className="collector-secondary-button"
                    onClick={async () => {
                      const next = !showTransactions;
                      setShowTransactions(next);
                      setShowPaymentForm(false);
                      if (next) await loadTransactions(selectedCustomer);
                    }}
                  >{showTransactions ? "İşlemleri Gizle" : "Önceki İşlemleri Gör"}</button>
                </div>

                {detailLoading && <div className="collector-state">Cari hesap bilgisi yükleniyor...</div>}

                {showPaymentForm && !detailLoading && (
                  <div className="collector-action-panel">
                    <div className="collector-panel-heading"><h3>Tahsilat Bilgileri</h3><span>₺</span></div>
                    <form onSubmit={handlePayment}>
                      <div className="collector-form-group">
                        <label>Tahsilat Tutarı (₺)</label>
                        <input
                          type="number"
                          min="0.01"
                          max={selectedCustomer.balance}
                          step="0.01"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="Örn. 1500"
                          required
                        />
                      </div>
                      <div className="collector-form-group">
                        <label>Açıklama (isteğe bağlı)</label>
                        <input
                          type="text"
                          maxLength="250"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Örn. Nakit tahsilat"
                        />
                      </div>
                      <button className="collector-primary-button" type="submit" disabled={paymentLoading}>
                        {paymentLoading ? "Kaydediliyor..." : "Tahsilatı Kaydet"}
                      </button>
                    </form>
                  </div>
                )}

                {showTransactions && (
                  <div className="collector-action-panel">
                    <div className="collector-panel-heading"><h3>Önceki Hesap Hareketleri</h3><button type="button" onClick={() => loadTransactions(selectedCustomer)}>↻ Yenile</button></div>
                    {transactionsLoading ? (
                      <div className="collector-state">Hesap hareketleri yükleniyor...</div>
                    ) : transactions.length === 0 ? (
                      <div className="collector-state">Henüz hesap hareketi bulunmuyor.</div>
                    ) : (
                      <div className="collector-transaction-list">
                        {transactions.map((transaction) => (
                          <div className="collector-transaction" key={transaction.id}>
                            <div className="transaction-info">
                              <strong>{transaction.transaction_type === "PAYMENT" ? "Tahsilat" : "Borç kaydı"}</strong>
                              <span>{transaction.description || "-"}</span>
                              <small>{formatDate(transaction.created_at)}</small>
                            </div>
                            <strong className={transaction.transaction_type === "PAYMENT" ? "transaction-payment" : "transaction-debit"}>
                              {transaction.transaction_type === "PAYMENT" ? "−" : "+"}{formatMoney(transaction.amount)}
                            </strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default CollectorDashboard;

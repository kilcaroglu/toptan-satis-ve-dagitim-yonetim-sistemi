
import { useCallback, useEffect, useState } from "react";
import "./AdminAccountsPage.css";

const API_URL = "http://localhost:4000";

function getArray(data, key) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  return [];
}

export default function AdminAccountsPage({ session }) {
  const token = session?.token;

  const [activeTab, setActiveTab] = useState("password");

  const [admins, setAdmins] = useState([]);
  const [customers, setCustomers] = useState([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerPassword, setCustomerPassword] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const request = useCallback(
    async (url, options = {}) => {
      const response = await fetch(`${API_URL}${url}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "İşlem gerçekleştirilemedi.");
      }

      return data;
    },
    [token]
  );

  const loadAdmins = useCallback(async () => {
    const data = await request("/admin/accounts/admins");
    setAdmins(getArray(data, "admins"));
  }, [request]);

  const loadCustomers = useCallback(async () => {
    const data = await request("/customers");
    setCustomers(getArray(data, "customers"));
  }, [request]);

  useEffect(() => {
    if (!token) {
      setError("Oturum bilgisi bulunamadı. Lütfen tekrar giriş yapın.");
      return;
    }

    async function loadData() {
      setLoading(true);
      setError("");

      try {
        await Promise.all([loadAdmins(), loadCustomers()]);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [token, loadAdmins, loadCustomers]);

  function showMessage(text) {
    setError("");
    setMessage(text);
  }

  async function changeMyPassword(event) {
    event.preventDefault();

    if (newPassword.length < 8) {
      setError("Yeni şifre en az 8 karakter olmalıdır.");
      return;
    }

    if (newPassword !== newPasswordAgain) {
      setError("Yeni şifreler birbiriyle eşleşmiyor.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const data = await request("/admin/accounts/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      showMessage(data.message || "Yönetici şifreniz değiştirildi.");

      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordAgain("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function resetCustomerPassword(event) {
    event.preventDefault();

    if (!selectedCustomerId) {
      setError("Şifresini değiştirmek istediğiniz müşteriyi seçin.");
      return;
    }

    if (customerPassword.length < 8) {
      setError("Yeni şifre en az 8 karakter olmalıdır.");
      return;
    }

    if (
      !window.confirm(
        "Seçilen müşterinin şifresini değiştirmek istediğinize emin misiniz?"
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const data = await request(
        `/admin/accounts/customers/${selectedCustomerId}/password`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_password: customerPassword }),
        }
      );

      showMessage(data.message || "Müşteri şifresi başarıyla değiştirildi.");
      setSelectedCustomerId("");
      setCustomerPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function createAdmin(event) {
    event.preventDefault();

    if (adminPassword.length < 8) {
      setError("Yönetici şifresi en az 8 karakter olmalıdır.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const data = await request("/admin/accounts/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: adminName.trim(),
          email: adminEmail.trim(),
          phone: adminPhone.trim(),
          password: adminPassword,
        }),
      });

      showMessage(data.message || "Yeni yönetici hesabı oluşturuldu.");

      setAdminName("");
      setAdminEmail("");
      setAdminPhone("");
      setAdminPassword("");

      await loadAdmins();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleAdmin(admin) {
    const nextActive = !admin.active;

    const action = nextActive ? "aktif" : "pasif";

    if (
      !window.confirm(
        `${admin.name} isimli yönetici hesabını ${action} yapmak istiyor musunuz?`
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const data = await request(
        `/admin/accounts/admins/${admin.id}/active`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: nextActive }),
        }
      );

      showMessage(
        data.message || "Yönetici hesabının durumu güncellendi."
      );

      await loadAdmins();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const filteredCustomers = customers.filter((customer) => {
    const search = customerSearch.trim().toLocaleLowerCase("tr-TR");

    if (!search) return true;

    return (
      String(customer.company_name || "")
        .toLocaleLowerCase("tr-TR")
        .includes(search) ||
      String(customer.contact_name || "")
        .toLocaleLowerCase("tr-TR")
        .includes(search) ||
      String(customer.email || "")
        .toLocaleLowerCase("tr-TR")
        .includes(search)
    );
  });

  return (
    <div className="admin-accounts">
      <div className="accounts-heading">
        <div>
          <h2>Hesap ve Yetki Yönetimi</h2>
          <p>
            Yönetici hesaplarını ve kullanıcı şifrelerini buradan yönetin.
          </p>
        </div>

        <button
          type="button"
          className="accounts-refresh"
          onClick={async () => {
            setLoading(true);
            setError("");
            try {
              await Promise.all([loadAdmins(), loadCustomers()]);
              showMessage("Hesap bilgileri yenilendi.");
            } catch (err) {
              setError(err.message);
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || saving}
        >
          ↻ Yenile
        </button>
      </div>

      {message && <div className="accounts-success">{message}</div>}
      {error && <div className="accounts-error">{error}</div>}

      <div className="accounts-tabs">
        <button
          type="button"
          className={activeTab === "password" ? "active" : ""}
          onClick={() => {
            setActiveTab("password");
            setError("");
            setMessage("");
          }}
        >
          Şifre İşlemleri
        </button>

        <button
          type="button"
          className={activeTab === "admins" ? "active" : ""}
          onClick={() => {
            setActiveTab("admins");
            setError("");
            setMessage("");
          }}
        >
          Yönetici Hesapları
        </button>

        <button
          type="button"
          className={activeTab === "create" ? "active" : ""}
          onClick={() => {
            setActiveTab("create");
            setError("");
            setMessage("");
          }}
        >
          + Yeni Yönetici
        </button>
      </div>

      {loading ? (
        <div className="accounts-empty">Hesap bilgileri yükleniyor...</div>
      ) : (
        <>
          {activeTab === "password" && (
            <div className="accounts-two-column">
              <section className="accounts-card">
                <div className="accounts-card-heading">
                  <span className="accounts-card-icon">🔐</span>
                  <div>
                    <h3>Kendi Şifremi Değiştir</h3>
                    <p>Yönetici hesabınızın giriş şifresini güncelleyin.</p>
                  </div>
                </div>

                <form onSubmit={changeMyPassword}>
                  <label>Mevcut şifre</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) =>
                      setCurrentPassword(event.target.value)
                    }
                    autoComplete="current-password"
                    required
                  />

                  <label>Yeni şifre</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />

                  <label>Yeni şifre tekrar</label>
                  <input
                    type="password"
                    value={newPasswordAgain}
                    onChange={(event) =>
                      setNewPasswordAgain(event.target.value)
                    }
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />

                  <button type="submit" disabled={saving}>
                    {saving ? "Kaydediliyor..." : "Şifremi Güncelle"}
                  </button>
                </form>
              </section>

              <section className="accounts-card">
                <div className="accounts-card-heading">
                  <span className="accounts-card-icon">👥</span>
                  <div>
                    <h3>Müşteri Şifresi Sıfırla</h3>
                    <p>Seçilen müşteriye yeni bir giriş şifresi belirleyin.</p>
                  </div>
                </div>

                <form onSubmit={resetCustomerPassword}>
                  <label>Müşteri ara</label>
                  <input
                    type="search"
                    placeholder="Firma veya yetkili adı..."
                    value={customerSearch}
                    onChange={(event) =>
                      setCustomerSearch(event.target.value)
                    }
                  />

                  <label>Müşteri seçin</label>
                  <select
                    value={selectedCustomerId}
                    onChange={(event) =>
                      setSelectedCustomerId(event.target.value)
                    }
                    required
                  >
                    <option value="">Müşteri seçin</option>
                    {filteredCustomers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.company_name ||
                          customer.contact_name ||
                          `Müşteri #${customer.id}`}
                      </option>
                    ))}
                  </select>

                  <label>Yeni müşteri şifresi</label>
                  <input
                    type="password"
                    value={customerPassword}
                    onChange={(event) =>
                      setCustomerPassword(event.target.value)
                    }
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />

                  <button type="submit" disabled={saving}>
                    {saving ? "İşleniyor..." : "Müşteri Şifresini Güncelle"}
                  </button>
                </form>
              </section>
            </div>
          )}

          {activeTab === "admins" && (
            <section className="accounts-card">
              <div className="accounts-card-heading">
                <div>
                  <h3>Kayıtlı Yönetici Hesapları</h3>
                  <p>
                    Sistemde {admins.length} yönetici hesabı bulunuyor.
                  </p>
                </div>
              </div>

              {admins.length === 0 ? (
                <div className="accounts-empty">
                  Yönetici hesabı bulunamadı.
                </div>
              ) : (
                <div className="accounts-table-wrapper">
                  <table className="accounts-table">
                    <thead>
                      <tr>
                        <th>Yönetici</th>
                        <th>E-posta</th>
                        <th>Telefon</th>
                        <th>Durum</th>
                        <th>İşlem</th>
                      </tr>
                    </thead>

                    <tbody>
                      {admins.map((admin) => (
                        <tr key={admin.id}>
                          <td>
                            <strong>{admin.name}</strong>
                            <small>#{admin.id}</small>
                          </td>
                          <td>{admin.email}</td>
                          <td>{admin.phone || "-"}</td>
                          <td>
                            <span
                              className={`accounts-status ${
                                admin.active ? "active" : "inactive"
                              }`}
                            >
                              {admin.active ? "Aktif" : "Pasif"}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={
                                admin.active
                                  ? "accounts-deactivate"
                                  : "accounts-activate"
                              }
                              onClick={() => toggleAdmin(admin)}
                              disabled={saving}
                            >
                              {admin.active ? "Pasif Yap" : "Aktif Yap"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="accounts-note">
                Güvenlik nedeniyle son aktif yönetici hesabı pasif yapılamaz.
                Kendi hesabınızı da pasif yapamazsınız.
              </p>
            </section>
          )}

          {activeTab === "create" && (
            <section className="accounts-card accounts-create-card">
              <div className="accounts-card-heading">
                <span className="accounts-card-icon">＋</span>
                <div>
                  <h3>Yeni Yönetici Hesabı Oluştur</h3>
                  <p>
                    Yeni kullanıcıya yönetici yetkisi vererek sisteme
                    ekleyebilirsiniz.
                  </p>
                </div>
              </div>

              <form onSubmit={createAdmin}>
                <div className="accounts-form-grid">
                  <div>
                    <label>Ad Soyad</label>
                    <input
                      type="text"
                      value={adminName}
                      onChange={(event) => setAdminName(event.target.value)}
                      placeholder="Ad Soyad"
                      required
                    />
                  </div>

                  <div>
                    <label>E-posta</label>
                    <input
                      type="email"
                      value={adminEmail}
                      onChange={(event) => setAdminEmail(event.target.value)}
                      placeholder="ornek@firma.com"
                      required
                    />
                  </div>

                  <div>
                    <label>Telefon</label>
                    <input
                      type="tel"
                      value={adminPhone}
                      onChange={(event) => setAdminPhone(event.target.value)}
                      placeholder="05XX XXX XX XX"
                    />
                  </div>

                  <div>
                    <label>İlk şifre</label>
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(event) =>
                        setAdminPassword(event.target.value)
                      }
                      placeholder="En az 8 karakter"
                      minLength={8}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>

                <div className="accounts-role-info">
                  <strong>Yetki:</strong> Yönetici (ADMIN)
                  <span>
                    Bu hesap yönetim paneline erişebilir ve yönetici
                    işlemlerini gerçekleştirebilir.
                  </span>
                </div>

                <button type="submit" disabled={saving}>
                  {saving ? "Oluşturuluyor..." : "Yönetici Hesabı Oluştur"}
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}

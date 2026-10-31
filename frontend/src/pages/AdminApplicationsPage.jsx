import { useCallback, useEffect, useState } from "react";
import "./AdminApplicationsPage.css";

const API_URL = "http://localhost:4000";

const statusLabels = {
  PENDING: "Onay bekliyor",
  WAITING_FOR_DELIVERY: "Sevkiyat bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
};

export default function AdminApplicationsPage({ session }) {
  const [applications, setApplications] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [action, setAction] = useState("");
  const [password, setPassword] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const token = session?.token;

  const loadApplications = useCallback(async () => {
    if (!token) {
      setError("Oturum bilgisi bulunamadı. Lütfen tekrar giriş yapın.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/admin/membership-applications`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Başvurular yüklenemedi.");
      }

      setApplications(data.applications || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  const markAsRead = async (application) => {
    try {
      const response = await fetch(
        `${API_URL}/admin/membership-applications/${application.id}/read`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Başvuru güncellenemedi.");
      }

      setApplications((previous) =>
        previous.map((item) =>
          item.id === application.id ? { ...item, is_read: true } : item,
        ),
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const openAction = (application, selectedAction) => {
    setSelectedApplication(application);
    setAction(selectedAction);
    setPassword("");
    setAdminNote("");
    setMessage("");
  };

  const closeAction = () => {
    if (saving) return;

    setSelectedApplication(null);
    setAction("");
    setPassword("");
    setAdminNote("");
  };

  const submitAction = async (event) => {
    event.preventDefault();

    if (!selectedApplication) return;

    if (action === "approve" && password.length < 8) {
      setMessage("Şifre en az 8 karakter olmalıdır.");
      return;
    }

    setSaving(true);
    setMessage("");

    const endpoint = action === "approve" ? "approve" : "reject";

    const body =
      action === "approve" ? { password } : { admin_note: adminNote };

    try {
      const response = await fetch(
        `${API_URL}/admin/membership-applications/${selectedApplication.id}/${endpoint}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "İşlem gerçekleştirilemedi.");
      }

      setSelectedApplication(null);
      setAction("");
      setPassword("");
      setAdminNote("");

      await loadApplications();

      alert(data.message || "İşlem başarılı.");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredApplications =
    filter === "ALL"
      ? applications
      : filter === "UNREAD"
        ? applications.filter((item) => !item.is_read)
        : applications.filter((item) => item.status === filter);

  const pendingCount = applications.filter(
    (item) => item.status === "PENDING",
  ).length;

  const unreadCount = applications.filter((item) => !item.is_read).length;

  return (
    <div className="applications-page">
      <div className="applications-heading">
        <div>
          <h1>Üyelik Başvuruları</h1>
          <p>Müşteri üyelik başvurularını buradan yönetebilirsiniz.</p>
        </div>

        <button
          className="applications-refresh"
          onClick={loadApplications}
          disabled={loading}
        >
          {loading ? "Yükleniyor..." : "↻ Yenile"}
        </button>
      </div>

      <div className="application-stats">
        <div className="application-stat">
          <span>Toplam Başvuru</span>
          <strong>{applications.length}</strong>
        </div>

        <div className="application-stat">
          <span>Onay Bekleyen</span>
          <strong>{pendingCount}</strong>
        </div>

        <div className="application-stat">
          <span>Okunmamış</span>
          <strong>{unreadCount}</strong>
        </div>
      </div>

      <div className="applications-toolbar">
        <label htmlFor="application-filter">Başvuruları filtrele</label>

        <select
          id="application-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="ALL">Tüm başvurular</option>
          <option value="UNREAD">Okunmamış başvurular</option>
          <option value="PENDING">Onay bekleyenler</option>
          <option value="WAITING_FOR_DELIVERY">Sevkiyat bekleyenler</option>
          <option value="APPROVED">Onaylananlar</option>
          <option value="REJECTED">Reddedilenler</option>
        </select>
      </div>

      {error && <div className="applications-error">{error}</div>}

      {loading ? (
        <div className="applications-empty">Başvurular yükleniyor...</div>
      ) : filteredApplications.length === 0 ? (
        <div className="applications-empty">
          Bu filtreye uygun başvuru bulunamadı.
        </div>
      ) : (
        <div className="applications-list">
          {filteredApplications.map((application) => (
            <article
              className={`application-card ${
                !application.is_read ? "unread" : ""
              }`}
              key={application.id}
            >
              <div className="application-card-top">
                <div>
                  <span className="application-number">
                    {application.application_number}
                  </span>
                  <h3>{application.company_name}</h3>
                  <p>{application.contact_name}</p>
                </div>

                <span
                  className={`application-status status-${application.status.toLowerCase()}`}
                >
                  {statusLabels[application.status] || application.status}
                </span>
              </div>

              <div className="application-details">
                <div>
                  <span>E-posta</span>
                  <strong>{application.email}</strong>
                </div>

                <div>
                  <span>Telefon</span>
                  <strong>{application.phone}</strong>
                </div>

                <div>
                  <span>İlçe</span>
                  <strong>{application.district_name}</strong>
                </div>

                <div>
                  <span>Başvuru Tarihi</span>
                  <strong>
                    {new Date(application.created_at).toLocaleString("tr-TR")}
                  </strong>
                </div>
              </div>

              <div className="application-card-bottom">
                <span
                  className={
                    application.is_read ? "read-label" : "unread-label"
                  }
                >
                  {application.is_read ? "Okundu" : "Yeni başvuru"}
                </span>

                <div className="application-actions">
                  {!application.is_read && (
                    <button
                      className="secondary-button"
                      onClick={() => markAsRead(application)}
                    >
                      Okundu işaretle
                    </button>
                  )}

                  {application.status === "PENDING" && (
                    <>
                      <button
                        className="reject-button"
                        onClick={() => openAction(application, "reject")}
                      >
                        Reddet
                      </button>

                      <button
                        className="approve-button"
                        onClick={() => openAction(application, "approve")}
                      >
                        Onayla
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedApplication && (
        <div className="application-modal-backdrop">
          <form className="application-modal" onSubmit={submitAction}>
            <button
              type="button"
              className="modal-close"
              onClick={closeAction}
              disabled={saving}
            >
              ×
            </button>

            <h2>
              {action === "approve" ? "Başvuruyu Onayla" : "Başvuruyu Reddet"}
            </h2>

            <p>
              <strong>{selectedApplication.company_name}</strong>
              <br />
              {selectedApplication.email}
            </p>

            {action === "approve" ? (
              <>
                <label htmlFor="customer-password">
                  Müşterinin başlangıç şifresi
                </label>

                <input
                  id="customer-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="En az 8 karakter"
                  minLength={8}
                  required
                />

                <small>
                  Onaylandığında bu e-posta adresiyle müşteri hesabı
                  oluşturulur.
                </small>
              </>
            ) : (
              <>
                <label htmlFor="admin-note">Ret açıklaması</label>

                <textarea
                  id="admin-note"
                  value={adminNote}
                  onChange={(event) => setAdminNote(event.target.value)}
                  placeholder="Müşteriye iletilecek açıklama..."
                  rows={4}
                />
              </>
            )}

            {message && <div className="applications-error">{message}</div>}

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={closeAction}
                disabled={saving}
              >
                Vazgeç
              </button>

              <button
                type="submit"
                className={
                  action === "approve" ? "approve-button" : "reject-button"
                }
                disabled={saving}
              >
                {saving
                  ? "İşleniyor..."
                  : action === "approve"
                    ? "Onayla ve Hesap Oluştur"
                    : "Başvuruyu Reddet"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

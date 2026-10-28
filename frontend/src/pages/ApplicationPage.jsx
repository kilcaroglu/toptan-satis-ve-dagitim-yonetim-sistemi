import { useEffect, useState } from "react";
import "./ApplicationPage.css";

const API_URL = "http://localhost:4000";

function ApplicationPage({ onBackToLogin, onOpenStatus }) {
  const [districts, setDistricts] = useState([]);
  const [loadingDistricts, setLoadingDistricts] = useState(true);
  const [districtError, setDistrictError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [applicationNumber, setApplicationNumber] = useState("");
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);

  const [form, setForm] = useState({
    company_name: "",
    tax_number: "",
    contact_name: "",
    phone: "",
    email: "",
    address: "",
    district_id: "",
  });

  useEffect(() => {
    async function loadDistricts() {
      try {
        const response = await fetch(`${API_URL}/districts`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "İlçeler yüklenemedi.");
        }

        setDistricts(data.districts || []);
      } catch (err) {
        setDistrictError(err.message || "İlçe listesine ulaşılamadı.");
      } finally {
        setLoadingDistricts(false);
      }
    }

    loadDistricts();
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
    setMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setApplicationNumber("");

    const selectedDistrict = districts.find(
      (district) => String(district.id) === form.district_id,
    );

    if (!selectedDistrict || !selectedDistrict.active) {
      setError("Lütfen başvuru yapılabilen aktif bir ilçe seçin.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/membership-applications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          district_id: Number(form.district_id),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Başvuru gönderilemedi.");
      }

      setMessage("");
      const number = data.application?.application_number || "";
      setApplicationNumber(number);
      setShowSuccessPopup(true);

      setForm({
        company_name: "",
        tax_number: "",
        contact_name: "",
        phone: "",
        email: "",
        address: "",
        district_id: "",
      });
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Sunucuya bağlanılamadı. Backend'in çalıştığını kontrol edin."
          : err.message || "Başvuru gönderilemedi.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="application-page">
      {showSuccessPopup && (
        <div className="popup-overlay">
          <section
            className="success-popup"
            role="dialog"
            aria-modal="true"
            aria-labelledby="success-popup-title"
          >
            <h2 id="success-popup-title">Başvurunuz Alındı!</h2>

            <p>
              Başvurunuzu takip ekranından başvuru numaranızla kontrol
              edebilirsiniz.
            </p>

            <p className="popup-application-number">
              Başvuru numaranız: <strong>{applicationNumber}</strong>
            </p>

            <button
              type="button"
              onClick={() => onOpenStatus(applicationNumber)}
            >
              Başvuru Takip Ekranına Git
            </button>

            <button
              type="button"
              className="popup-close"
              onClick={() => setShowSuccessPopup(false)}
            >
              Şimdilik Kapat
            </button>
          </section>
        </div>
      )}

      <header className="application-heading">
        <h1>KİLCAROĞLU</h1>
        <p>Toptan Satış ve Dağıtım Yönetim Sistemi</p>
      </header>

      <section className="application-card">
        <h2>Müşteri Başvurusu</h2>
        <p className="application-description">
          Müşterimiz olmak için aşağıdaki bilgileri doldurun.
        </p>

        {message && (
          <div className="application-success" role="status">
            <p>{message}</p>
            {applicationNumber && (
              <>
                <p>
                  Başvuru numaranız: <strong>{applicationNumber}</strong>
                </p>
                <button
                  className="application-submit"
                  type="button"
                  onClick={() => onOpenStatus(applicationNumber)}
                >
                  Başvuru Kontrol Ekranına Git
                </button>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="application-error" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <div className="application-fields">
            <div className="application-field">
              <label htmlFor="company_name">Firma unvanı</label>
              <input
                id="company_name"
                name="company_name"
                value={form.company_name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="application-field">
              <label htmlFor="tax_number">Vergi numarası</label>
              <input
                id="tax_number"
                name="tax_number"
                value={form.tax_number}
                onChange={handleChange}
                required
              />
            </div>

            <div className="application-field">
              <label htmlFor="contact_name">Yetkili adı soyadı</label>
              <input
                id="contact_name"
                name="contact_name"
                value={form.contact_name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="application-field">
              <label htmlFor="phone">Telefon</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                value={form.phone}
                onChange={handleChange}
                required
              />
            </div>

            <div className="application-field">
              <label htmlFor="application_email">E-posta adresi</label>
              <input
                id="application_email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                required
              />
            </div>

            <div className="application-field">
              <label htmlFor="district_id">İlçe</label>
              <select
                id="district_id"
                name="district_id"
                value={form.district_id}
                onChange={handleChange}
                required
                disabled={loadingDistricts || !!districtError}
              >
                <option value="">
                  {loadingDistricts ? "İlçeler yükleniyor..." : "İlçe seçin"}
                </option>

                {districts.map((district) => (
                  <option
                    key={district.id}
                    value={district.id}
                    disabled={!district.active}
                  >
                    {district.name}
                    {!district.active ? " (Başvuruya kapalı)" : ""}
                  </option>
                ))}
              </select>

              {districtError && (
                <small className="application-error">{districtError}</small>
              )}
            </div>

            <div className="application-field application-field-full">
              <label htmlFor="address">Açık adres</label>
              <textarea
                id="address"
                name="address"
                rows="3"
                value={form.address}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <button
            className="application-submit"
            type="submit"
            disabled={submitting || loadingDistricts || !!districtError}
          >
            {submitting ? "Başvuru gönderiliyor..." : "Başvuruyu Gönder"}
          </button>
        </form>

        <button
          className="application-back"
          type="button"
          onClick={onBackToLogin}
        >
          Giriş ekranına dön
        </button>
      </section>

      <footer className="application-footer">© 2026 KİLCAROĞLU</footer>
    </main>
  );
}

export default ApplicationPage;

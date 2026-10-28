
import { useState } from "react";
import "./ApplicationStatusPage.css";

const API_URL = "http://localhost:4000";

function ApplicationStatusPage({ initialNumber = "", onBack }) {
  const [applicationNumber, setApplicationNumber] = useState(initialNumber);
  const [application, setApplication] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setApplication(null);
    setLoading(true);

    try {
      const number = applicationNumber.trim();
      const response = await fetch(
        `${API_URL}/membership-applications/${encodeURIComponent(number)}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Başvuru bulunamadı.");
      }

      setApplication(data.application || data);
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Sunucuya bağlanılamadı. Backend'in çalıştığını kontrol edin."
          : err.message || "Başvuru sorgulanamadı."
      );
    } finally {
      setLoading(false);
    }
  }

  const status = application?.status;

  let statusExplanation = "";
  if (status === "PENDING") {
    statusExplanation =
      "Başvurunuz alındı. Başvurunuz değerlendirme sürecindedir.";
  } else if (status === "WAITING_FOR_DELIVERY") {
    statusExplanation =
      "Şu anda seçtiğiniz ilçeye sevkiyat yapamıyoruz. İlçenizde sevkiyat hizmetimiz başladığında başvurunuz değerlendirmeye alınacaktır.";
  } else if (status) {
    statusExplanation =
      application?.message ||
      "Başvurunuzun güncel durumunu aşağıda görebilirsiniz.";
  }

  return (
    <main className="status-page">
      <header className="status-heading">
        <h1>KİLCAROĞLU</h1>
        <p>Toptan Satış ve Dağıtım Yönetim Sistemi</p>
      </header>

      <section className="status-card">
        <h2>Başvuru Kontrolü</h2>
        <p>Başvurunuzun durumunu görmek için başvuru numaranızı girin.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="application-number">Başvuru numarası</label>
          <input
            id="application-number"
            value={applicationNumber}
            onChange={(event) => setApplicationNumber(event.target.value)}
            placeholder="Başvuru numaranızı girin"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Kontrol ediliyor..." : "Başvuruyu Kontrol Et"}
          </button>
        </form>

        {error && <p className="status-error" role="alert">{error}</p>}

        {application && (
          <div className="status-result" role="status">
            <h3>Başvuru Bilgileri</h3>
            <p>
              <strong>Başvuru numarası:</strong>{" "}
              {application.application_number || applicationNumber}
            </p>
            {application.status && (
              <p>
                <strong>Durum:</strong> {application.status}
              </p>
            )}
            <p>{statusExplanation}</p>
          </div>
        )}

        <button className="status-back" type="button" onClick={onBack}>
          Giriş Ekranına Dön
        </button>
      </section>
    </main>
  );
}

export default ApplicationStatusPage;

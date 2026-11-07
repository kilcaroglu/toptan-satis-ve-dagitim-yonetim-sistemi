import { useState } from "react";
import "./LoginPage.css";

const API_URL = "http://localhost:4000";

function LoginPage({ onLogin, onOpenApplication, onOpenStatus }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Giriş yapılamadı.");
      }

      onLogin(data);
    } catch (err) {
      if (err instanceof TypeError) {
        setError(
          "Sunucuya bağlanılamadı. Backend'in çalıştığını kontrol edin.",
        );
      } else {
        setError(err.message || "Bir hata oluştu.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <header className="heading">
        <h1>KİLCAROĞLU</h1>
        <p>Toptan Satış ve Dağıtım Yönetim Sistemi</p>
      </header>

      <section className="login-card">
        <h2>Giriş Yap</h2>
        <p className="description">Hesabınıza giriş yaparak devam edin.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">E-posta adresi</label>
          <input
            id="email"
            type="email"
            placeholder="ornek@sirket.com"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label htmlFor="password">Şifre</label>
          <input
            id="password"
            type="password"
            placeholder="Şifrenizi girin"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Giriş yapılıyor..." : "Giriş Yap →"}
          </button>
        </form>

        <div className="application-divider">
          <span>Henüz müşterimiz değil misiniz?</span>
        </div>

        <button
          className="application-button"
          type="button"
          onClick={onOpenApplication}
        >
          Müşteri Olmak İçin Başvur
        </button>
        <button
          className="application-button status-link-button"
          type="button"
          onClick={onOpenStatus}
        >
          Başvuru Takip
        </button>
      </section>

      <footer>© 2026 KİLCAROĞLU</footer>
    </main>
  );
}

export default LoginPage;


import { useState } from "react";
import LoginPage from "./pages/LoginPage";
import ApplicationPage from "./pages/ApplicationPage";
import ApplicationStatusPage from "./pages/ApplicationStatusPage";
import AdminDashboard from "./pages/AdminDashboard";

const SESSION_KEY = "session";

function getSavedSession() {
  try {
    const savedSession = localStorage.getItem(SESSION_KEY);

    if (!savedSession) {
      return null;
    }

    const parsedSession = JSON.parse(savedSession);

    if (!parsedSession?.token || !parsedSession?.user) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return parsedSession;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function App() {
  const [currentPage, setCurrentPage] = useState(() =>
    getSavedSession() ? "dashboard" : "login"
  );

  const [session, setSession] = useState(getSavedSession);
  const [applicationNumber, setApplicationNumber] = useState("");

  function handleLogin(data) {
    if (!data?.token || !data?.user) {
      console.error("Giriş yanıtında token veya kullanıcı bilgisi eksik.");
      return;
    }

    const newSession = {
      token: data.token,
      user: data.user,
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));

    setSession(newSession);
    setCurrentPage("dashboard");
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setCurrentPage("login");
  }

  if (currentPage === "application") {
    return (
      <ApplicationPage
        onBackToLogin={() => setCurrentPage("login")}
        onOpenStatus={(number) => {
          setApplicationNumber(number);
          setCurrentPage("application-status");
        }}
      />
    );
  }

  if (currentPage === "application-status") {
    return (
      <ApplicationStatusPage
        initialNumber={applicationNumber}
        onBack={() => setCurrentPage("login")}
      />
    );
  }

  if (currentPage === "dashboard" && session) {
    if (session.user?.role === "ADMIN") {
      return (
        <AdminDashboard
          session={session}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <main style={{ padding: "40px", textAlign: "center" }}>
        <h1>Giriş başarılı</h1>
        <p>Hoş geldin, {session.user?.name}!</p>
        <p>Rol: {session.user?.role}</p>
        <button onClick={handleLogout}>Çıkış yap</button>
      </main>
    );
  }

  return (
    <LoginPage
      onLogin={handleLogin}
      onOpenApplication={() => setCurrentPage("application")}
      onOpenStatus={() => {
        setApplicationNumber("");
        setCurrentPage("application-status");
      }}
    />
  );
}

export default App;

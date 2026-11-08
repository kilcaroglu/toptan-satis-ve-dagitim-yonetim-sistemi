
import { useEffect, useState } from "react";
import { NotificationProvider } from "./context/NotificationContext";

import LoginPage from "./pages/LoginPages/LoginPage";
import ApplicationPage from "./pages/AdminPages/ApplicationPage";
import ApplicationStatusPage from "./pages/AdminPages/ApplicationStatusPage";
import AdminDashboard from "./pages/AdminPages/AdminDashboard";
import CustomerDashboard from "./pages/CustomerPages/CustomerDashboard";
import PersonnelDashboard from "./pages/PersonnelPages/PersonnelDashboard";
import CollectorDashboard from "./pages/CollectorPages/CollectorDashboard";

const API_URL = "http://localhost:4000";
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

function AppContent() {
  const [session, setSession] = useState(getSavedSession);

  const [currentPage, setCurrentPage] = useState(() =>
    session ? "dashboard" : "login"
  );

  const [checkingSession, setCheckingSession] = useState(
    () => Boolean(session)
  );

  const [applicationNumber, setApplicationNumber] = useState("");

  useEffect(() => {
    async function validateSession() {
      const savedSession = getSavedSession();

      if (!savedSession) {
        setSession(null);
        setCurrentPage("login");
        setCheckingSession(false);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/auth/me`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${savedSession.token}`,
          },
        });

        if (response.status === 401) {
          localStorage.removeItem(SESSION_KEY);
          setSession(null);
          setCurrentPage("login");
          return;
        }

        if (!response.ok) {
          console.error("Oturum kontrolü başarısız:", response.status);
          return;
        }

        const data = await response.json();

        const validSession = {
          token: savedSession.token,
          user: data.user,
        };

        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify(validSession)
        );

        setSession(validSession);
        setCurrentPage("dashboard");
      } catch (error) {
        console.error("Oturum kontrolü yapılamadı:", error);
      } finally {
        setCheckingSession(false);
      }
    }

    validateSession();
  }, []);

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

  if (checkingSession) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Arial, sans-serif",
        }}
      >
        Oturum kontrol ediliyor...
      </main>
    );
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

    if (session.user?.role === "CUSTOMER") {
      return (
        <CustomerDashboard
          session={session}
          onLogout={handleLogout}
        />
      );
    }

    if (
      session.user?.role === "DRIVER" ||
      session.user?.role === "DISTRIBUTOR"
    ) {
      return (
        <PersonnelDashboard
          session={session}
          onLogout={handleLogout}
        />
      );
    }

    if (session.user?.role === "COLLECTOR") {
      return (
        <CollectorDashboard
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

function App() {
  return (
    <NotificationProvider>
      <AppContent />
    </NotificationProvider>
  );
}

export default App;

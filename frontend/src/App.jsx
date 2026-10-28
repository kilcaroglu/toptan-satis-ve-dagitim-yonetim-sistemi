import { useState } from "react";
import LoginPage from "./pages/LoginPage";
import ApplicationPage from "./pages/ApplicationPage";
import ApplicationStatusPage from "./pages/ApplicationStatusPage";

function App() {
  const [currentPage, setCurrentPage] = useState("login");
  const [session, setSession] = useState(null);
  const [applicationNumber, setApplicationNumber] = useState("");

  function handleLogin(data) {
    setSession({ token: data.token, user: data.user });
    setCurrentPage("dashboard");
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

  if (currentPage === "dashboard") {
    return (
      <main style={{ padding: "40px", textAlign: "center" }}>
        <h1>Giriş başarılı</h1>
        <p>Hoş geldin, {session.user.name}!</p>
        <p>Rol: {session.user.role}</p>
        <button
          onClick={() => {
            setSession(null);
            setCurrentPage("login");
          }}
        >
          Çıkış yap
        </button>
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

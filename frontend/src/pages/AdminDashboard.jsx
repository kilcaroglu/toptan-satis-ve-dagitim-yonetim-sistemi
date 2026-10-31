import { useState } from "react";
import "./AdminDashboard.css";
import AdminApplicationsPage from "./AdminApplicationsPage.jsx";
import AdminProductsPage from "./AdminProductsPage.jsx";
import AdminCustomersPage from "./AdminCustomersPage.jsx";

const menuGroups = [
  {
    title: "GENEL",
    items: [{ id: "home", label: "Ana Sayfa", icon: "⌂" }],
  },
  {
    title: "ÜRÜN VE STOK",
    items: [
      { id: "products", label: "Ürün Ekle / Yönet", icon: "▣" },
    ],
  },
  {
    title: "MÜŞTERİ VE SİPARİŞ",
    items: [
      { id: "applications", label: "Müşteri Başvuruları", icon: "♧" },
      { id: "customers", label: "Müşteri Hesapları", icon: "₺" },
      { id: "orders", label: "Siparişler", icon: "▧" },
    ],
  },
  {
    title: "DAĞITIM VE SEVKİYAT",
    items: [
      { id: "plan", label: "Sevkiyat Planla", icon: "⇢" },
      { id: "shipments", label: "Sevkiyatlar", icon: "▰" },
      { id: "distributors", label: "Distribütörler", icon: "♙" },
      { id: "routes", label: "Dağıtım Rotaları", icon: "⌖" },
      { id: "districts", label: "İlçe ve Sevkiyat Bölgeleri", icon: "◎" },
    ],
  },
];

const pageInfo = {
  home: {
    title: "Ana Sayfa",
    description: "İşletmenizin genel durumunu buradan takip edebilirsiniz.",
  },
  products: {
    title: "Ürün Ekle / Yönet",
    description: "Ürünleri ekleme, düzenleme ve yönetme alanı.",
  },
  applications: {
    title: "Müşteri Başvuruları",
    description: "Yeni müşteri üyelik başvurularını inceleyin.",
  },
  customers: {
    title: "Müşteri Hesapları",
    description:
      "Müşteri bilgileri, cari bakiyeler, borçlar ve tahsilat işlemleri.",
  },
  orders: {
    title: "Siparişler",
    description: "Müşteri siparişlerini görüntüleyin ve takip edin.",
  },
  plan: {
    title: "Sevkiyat Planla",
    description: "Siparişler için sevkiyat planı oluşturun.",
  },
  shipments: {
    title: "Sevkiyatlar",
    description: "Hazırlanan ve tamamlanan sevkiyatları takip edin.",
  },
  distributors: {
    title: "Distribütörler",
    description: "Distribütör bilgilerini ve sorumluluk alanlarını yönetin.",
  },
  routes: {
    title: "Dağıtım Rotaları",
    description: "Dağıtım rotalarını ve teslimat sıralarını düzenleyin.",
  },
  districts: {
    title: "İlçe ve Sevkiyat Bölgeleri",
    description: "İlçeleri ve teslimat yapılabilen bölgeleri yönetin.",
  },
};

export default function AdminDashboard({ session, onLogout }) {
  const [activePage, setActivePage] = useState("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const user = session?.user;
  const currentPage = pageInfo[activePage] || pageInfo.home;

  function selectPage(pageId) {
    setActivePage(pageId);
    setMobileMenuOpen(false);
  }

  return (
    <div className="admin-layout">
      {mobileMenuOpen && (
        <button
          type="button"
          className="admin-sidebar-overlay"
          aria-label="Menüyü kapat"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside
        className={`admin-sidebar ${
          mobileMenuOpen ? "mobile-menu-open" : ""
        }`}
      >
        <div className="admin-brand">
          <h2>KİLCAROĞLU</h2>
          <p>Toptan Satış ve Dağıtım Yönetim Sistemi</p>
        </div>

        <nav className="admin-navigation" aria-label="Yönetim menüsü">
          {menuGroups.map((group) => (
            <div className="admin-menu-group" key={group.title}>
              <div className="admin-menu-heading">{group.title}</div>

              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`admin-menu-item ${
                    activePage === item.id ? "active" : ""
                  }`}
                  onClick={() => selectPage(item.id)}
                  title={item.label}
                >
                  <span className="admin-menu-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="admin-menu-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-sidebar-user">
            <div className="admin-user-details">
              <strong>{user?.name || user?.username || "Yönetici"}</strong>
              <span>Yönetici hesabı</span>
            </div>
          </div>

          <button
            type="button"
            className="admin-logout"
            onClick={onLogout}
          >
            <span aria-hidden="true">↪</span>
            <span>Güvenli Çıkış</span>
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button
              type="button"
              className="admin-menu-toggle"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label={mobileMenuOpen ? "Menüyü kapat" : "Menüyü aç"}
              aria-expanded={mobileMenuOpen}
            >
              <span />
              <span />
              <span />
            </button>

            <div>
              <div className="admin-breadcrumb">YÖNETİM PANELİ</div>
              <h1>{currentPage.title}</h1>
            </div>
          </div>
        </header>

        <div className="admin-content">
          {activePage === "home" ? (
            <>
              <section className="admin-welcome-card">
                <div>
                  <span className="admin-eyebrow">YÖNETİM PANELİ</span>
                  <h2>Hoş geldiniz!</h2>
                </div>
              </section>

              <section className="admin-section">
                <div className="admin-section-heading">
                  <div>
                    <h2>İşlem menüsü</h2>
                    <p>Devam etmek istediğiniz bölümü seçin.</p>
                  </div>
                </div>

                {menuGroups
                  .flatMap((group) => group.items)
                  .filter((item) => item.id !== "home")
                  .reduce((groups, item, index) => {
                    if (index % 3 === 0) groups.push([]);
                    groups[groups.length - 1].push(item);
                    return groups;
                  }, [])
                  .map((group, index) => (
                    <div className="admin-quick-grid" key={index}>
                      {group.map((item) => (
                        <button
                          type="button"
                          className="admin-quick-card"
                          key={item.id}
                          onClick={() => selectPage(item.id)}
                        >
                          <span className="admin-quick-icon">
                            {item.icon}
                          </span>
                          <span className="admin-quick-title">
                            {item.label}
                          </span>
                          <span className="admin-quick-arrow">→</span>
                        </button>
                      ))}
                    </div>
                  ))}
              </section>
            </>
          ) : activePage === "applications" ? (
            <AdminApplicationsPage session={session} />
          ) : activePage === "products" ? (
            <AdminProductsPage session={session} />
          ) : activePage === "customers" ? (
            <AdminCustomersPage session={session} />
          ) : (
            <section className="admin-module">
              <div className="admin-module-icon" aria-hidden="true">
                {menuGroups
                  .flatMap((group) => group.items)
                  .find((item) => item.id === activePage)?.icon || "▦"}
              </div>

              <span className="admin-eyebrow">YÖNETİM MODÜLÜ</span>
              <h2>{currentPage.title}</h2>
              <p>{currentPage.description}</p>

              <div className="admin-coming-soon">
                <span className="admin-coming-dot" />
                Bu bölümün işlem ekranı bir sonraki aşamada hazırlanacak.
              </div>

              <button
                type="button"
                className="admin-primary-button"
                onClick={() => selectPage("home")}
              >
                ← Ana sayfaya dön
              </button>
            </section>
          )}

          <footer className="admin-footer">
            Toptan Satış ve Dağıtım Yönetim Sistemi
          </footer>
        </div>
      </main>
    </div>
  );
}

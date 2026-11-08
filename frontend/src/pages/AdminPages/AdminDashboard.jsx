
import { useState } from "react";
import "./AdminDashboard.css";

import AdminApplicationsPage from "./AdminApplicationsPage.jsx";
import AdminProductsPage from "./AdminProductsPage.jsx";
import AdminCustomersPage from "./AdminCustomersPage.jsx";
import AdminShipmentsPage from "./AdminShipmentsPage.jsx";
import AdminRoutesPage from "./AdminRoutesPage.jsx";
import AdminFleetPage from "./AdminFleetPage.jsx";
import AdminOrdersPage from "./AdminOrdersPage.jsx";
import AdminAccountsPage from "./AdminAccountsPage.jsx";

const menuGroups = [
  {
    title: "GENEL",
    items: [{ id: "home", label: "Ana Sayfa", icon: "home" }],
  },
  {
    title: "ÜRÜN VE STOK",
    items: [{ id: "products", label: "Ürün ve Stok Yönetimi", icon: "box" }],
  },
  {
    title: "MÜŞTERİ VE SİPARİŞ",
    items: [
      { id: "applications", label: "Müşteri Başvuruları", icon: "users" },
      { id: "customers", label: "Müşteri Hesapları", icon: "wallet" },
      { id: "orders", label: "Sipariş Yönetimi", icon: "clipboard" },
    ],
  },
  {
    title: "DAĞITIM VE LOJİSTİK",
    items: [
      { id: "shipments", label: "Sevkiyat Yönetimi", icon: "truck" },
      { id: "routes", label: "Rota ve Bölgeler", icon: "map" },
      { id: "fleet", label: "Araç ve Personel", icon: "users" },
    ],
  },
  {
    title: "SİSTEM",
    items: [{ id: "accounts", label: "Hesap ve Yetki Yönetimi", icon: "settings" }],
  },
];

const pageInfo = {
  home: {
    title: "Ana Sayfa",
    description: "İşletmenizin genel durumunu buradan takip edebilirsiniz.",
  },
  products: {
    title: "Ürün ve Stok Yönetimi",
    description: "Ürünleri, kategorileri, alışları ve stok durumlarını yönetin.",
  },
  applications: {
    title: "Müşteri Başvuruları",
    description: "Yeni müşteri üyelik başvurularını inceleyin ve sonuçlandırın.",
  },
  customers: {
    title: "Müşteri Hesapları",
    description: "Müşteri bilgileri, cari bakiyeler, borçlar ve tahsilat işlemleri.",
  },
  orders: {
    title: "Sipariş Yönetimi",
    description: "Müşteri siparişlerini inceleyin, düzenleyin ve sipariş durumlarını takip edin.",
  },
  shipments: {
    title: "Sevkiyat Yönetimi",
    description: "Sevkiyatları planlayın, araç ve personel atayın, teslimat süreçlerini takip edin.",
  },
  routes: {
    title: "Rota ve Bölgeler",
    description: "Dağıtım rotalarını, ilçeleri, teslimat günlerini ve sipariş son tarihlerini yönetin.",
  },
  fleet: {
    title: "Araç ve Personel",
    description: "Araçları, şoförleri ve dağıtım personelini tek yerden yönetin.",
  },
  accounts: {
    title: "Hesap ve Yetki Yönetimi",
    description: "Yönetici hesaplarını, kullanıcı şifrelerini ve sistem erişimlerini yönetin.",
  },
};

function MenuIcon({ name, size = 19 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  const paths = {
    home: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v12h14V9" />
        <path d="M9 21v-7h6v7" />
      </>
    ),
    box: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="M3 8v9l9 5 9-5V8" />
        <path d="M12 13v9" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="10" cy="7" r="4" />
        <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="2" />
        <path d="M3 9h18" />
        <path d="M16 14h2" />
        <path d="M7 5V3h10v2" />
      </>
    ),
    clipboard: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V2h6v2" />
        <path d="M9 11h6M9 15h6" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v12H3z" />
        <path d="M14 10h4l3 4v4h-7" />
        <circle cx="7.5" cy="18" r="2" />
        <circle cx="17.5" cy="18" r="2" />
      </>
    ),
    map: (
      <>
        <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
        <path d="M9 3v15M15 6v15" />
        <path d="M12 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.5.9L16 21h-3l-.3-2.1a8 8 0 0 1-1.5-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.5-.9L13 7h3l.3 2.1a8 8 0 0 1 1.5.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 2.1Z" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
      </>
    ),
  };

  return <svg {...common}>{paths[name] || paths.box}</svg>;
}

export default function AdminDashboard({ session, onLogout }) {
  const [activePage, setActivePage] = useState("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const user = session?.user;
  const currentPage = pageInfo[activePage] || pageInfo.home;

  function selectPage(pageId) {
    setActivePage(pageId);
    setMobileMenuOpen(false);
  }

  const allMenuItems = menuGroups
    .flatMap((group) => group.items)
    .filter((item) => item.id !== "home");

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

      <aside className={`admin-sidebar ${mobileMenuOpen ? "mobile-menu-open" : ""}`}>
        <div className="admin-brand">
          <div className="admin-brand-mark">K</div>
          <div className="admin-brand-text">
            <h2>KİLCAROĞLU</h2>
            <p>Toptan Satış ve Dağıtım</p>
          </div>
        </div>

        <div className="admin-nav-caption">ÇALIŞMA ALANI</div>

        <nav className="admin-navigation" aria-label="Yönetim menüsü">
          {menuGroups.map((group) => (
            <div className="admin-menu-group" key={group.title}>
              <div className="admin-menu-heading">{group.title}</div>

              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`admin-menu-item ${activePage === item.id ? "active" : ""}`}
                  onClick={() => selectPage(item.id)}
                  title={item.label}
                >
                  <span className="admin-menu-icon">
                    <MenuIcon name={item.icon} />
                  </span>
                  <span className="admin-menu-label">{item.label}</span>
                  {activePage === item.id && <span className="admin-active-dot" />}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-sidebar-user">
            <div className="admin-user-avatar">
              {(user?.name || user?.username || "Y").charAt(0).toUpperCase()}
            </div>
            <div className="admin-user-details">
              <strong>{user?.name || user?.username || "Yönetici"}</strong>
              <span>Yönetici hesabı</span>
            </div>
          </div>

          <button type="button" className="admin-logout" onClick={onLogout}>
            <MenuIcon name="logout" size={17} />
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
                  <p>
                    İşletmenizin ürün, müşteri, sipariş ve dağıtım süreçlerini
                    buradan yönetebilirsiniz.
                  </p>
                </div>
              </section>

              <section className="admin-section">
                <div className="admin-section-heading">
                  <div>
                    <h2>İşlem menüsü</h2>
                    <p>Devam etmek istediğiniz bölümü seçin.</p>
                  </div>
                </div>

                {allMenuItems.reduce((groups, item, index) => {
                  if (index % 3 === 0) groups.push([]);
                  groups[groups.length - 1].push(item);
                  return groups;
                }, []).map((group, index) => (
                  <div className="admin-quick-grid" key={index}>
                    {group.map((item) => (
                      <button
                        type="button"
                        className="admin-quick-card"
                        key={item.id}
                        onClick={() => selectPage(item.id)}
                      >
                        <span className="admin-quick-icon">
                          <MenuIcon name={item.icon} size={21} />
                        </span>
                        <span className="admin-quick-title">{item.label}</span>
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
          ) : activePage === "shipments" ? (
            <AdminShipmentsPage session={session} />
          ) : activePage === "routes" ? (
            <AdminRoutesPage session={session} />
          ) : activePage === "fleet" ? (
            <AdminFleetPage session={session} />
          ) : activePage === "orders" ? (
            <AdminOrdersPage session={session} />
          ) : activePage === "accounts" ? (
            <AdminAccountsPage session={session} />
          ) : (
            <section className="admin-module">
              <div className="admin-module-icon">
                <MenuIcon name="box" size={30} />
              </div>
              <span className="admin-eyebrow">YÖNETİM MODÜLÜ</span>
              <h2>{currentPage.title}</h2>
              <p>{currentPage.description}</p>
              <div className="admin-coming-soon">
                <span className="admin-coming-dot" />
                Bu bölümün işlem ekranı hazırlanacak.
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

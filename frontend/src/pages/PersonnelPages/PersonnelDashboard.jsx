
import { useEffect, useRef, useState } from "react";
import "./PersonnelDashboard.css";

const API_URL = "http://localhost:4000";

const STATUS_LABELS = {
  PLANNED: "Planlandı",
  PREPARING: "Hazırlanıyor",
  ON_THE_WAY: "Yola çıktı",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal edildi",
};

function normalizeStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function getOrderStatus(order) {
  return normalizeStatus(order.status ?? order.order_status);
}

function formatDate(date) {
  if (!date) return "-";

  const value = String(date).slice(0, 10);
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) return "-";

  return new Date(year, month - 1, day).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatAmount(amount) {
  return (
    Number(amount || 0).toLocaleString("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " ₺"
  );
}

function PersonnelDashboard({ session, onLogout }) {
  const [shipments, setShipments] = useState([]);
  const [selectedShipment, setSelectedShipment] = useState(null);
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);

  const [showDeliveredShipments, setShowDeliveredShipments] =
    useState(false);
  const [showCancelledShipments, setShowCancelledShipments] =
    useState(false);
  const [showHistoricalOrders, setShowHistoricalOrders] =
    useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedShipmentRef = useRef(null);
  const shipmentsRef = useRef([]);
  const ordersRef = useRef([]);

  const headers = {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };

  useEffect(() => {
    selectedShipmentRef.current = selectedShipment;
  }, [selectedShipment]);

  useEffect(() => {
    shipmentsRef.current = shipments;
  }, [shipments]);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  // Tarayıcının geri tuşunu panel içindeki gezinmeye bağla.
  useEffect(() => {
    window.history.pushState(
      { personnelPanel: true, view: "shipments" },
      "",
      window.location.href,
    );

    function handlePopState(event) {
      const state = event.state;

      if (!state?.personnelPanel) {
        window.history.pushState(
          { personnelPanel: true, view: "shipments" },
          "",
          window.location.href,
        );
        return;
      }

      if (state.view === "shipments") {
        setSelectedShipment(null);
        setSelectedOrder(null);
        setError("");
        setSuccess("");
        return;
      }

      if (state.view === "shipment") {
        const shipment =
          selectedShipmentRef.current?.id === state.shipmentId
            ? selectedShipmentRef.current
            : shipmentsRef.current.find(
                (item) => item.id === state.shipmentId,
              );

        if (shipment) {
          setSelectedShipment(shipment);
          setSelectedOrder(null);
          setError("");
          setSuccess("");
        }

        return;
      }

      if (state.view === "order") {
        const shipment =
          selectedShipmentRef.current?.id === state.shipmentId
            ? selectedShipmentRef.current
            : shipmentsRef.current.find(
                (item) => item.id === state.shipmentId,
              );

        const order = ordersRef.current.find(
          (item) => item.order_id === state.orderId,
        );

        if (shipment && order) {
          setSelectedShipment(shipment);
          setSelectedOrder(order);
          setError("");
          setSuccess("");
        }
      }
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  function pushPage(view, shipmentId = null, orderId = null) {
    window.history.pushState(
      {
        personnelPanel: true,
        view,
        shipmentId,
        orderId,
      },
      "",
      window.location.href,
    );
  }

  async function loadShipments() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_URL}/shipments`, {
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Sevkiyatlar alınamadı.");
      }

      const shipmentList = Array.isArray(data)
        ? data
        : data.shipments || [];

      shipmentList.sort(
        (a, b) =>
          new Date(b.shipment_date).getTime() -
          new Date(a.shipment_date).getTime(),
      );

      setShipments(shipmentList);
    } catch (err) {
      setError(err.message || "Sevkiyatlar yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  async function openShipment(shipment) {
    pushPage("shipment", shipment.id);

    try {
      setSelectedShipment(shipment);
      setSelectedOrder(null);
      setOrders([]);
      setShowHistoricalOrders(false);
      setDetailLoading(true);
      setError("");
      setSuccess("");

      const response = await fetch(
        `${API_URL}/distributor/shipments/${shipment.id}/orders`,
        { headers },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Sevkiyat detayları alınamadı.");
      }

      setSelectedShipment(data.shipment || shipment);
      setOrders(data.orders || []);
    } catch (err) {
      setError(err.message || "Sevkiyat detayları yüklenemedi.");
    } finally {
      setDetailLoading(false);
    }
  }

  function openOrder(order) {
    pushPage("order", selectedShipment?.id, order.order_id);
    setSelectedOrder(order);
    setError("");
    setSuccess("");
  }

  function goBackToShipments() {
    window.history.back();
  }

  function goBackToOrders() {
    window.history.back();
  }

  async function markOrderOnTheWay(order) {
    const confirmed = window.confirm(
      `${order.company_name} müşterisinin siparişini yola çıktı olarak işaretlemek istiyor musunuz?`,
    );

    if (!confirmed) return;

    try {
      setProcessing(true);
      setError("");
      setSuccess("");

      const response = await fetch(
        `${API_URL}/distributor/orders/${order.order_id}/on-the-way`,
        {
          method: "PATCH",
          headers,
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Sipariş durumu güncellenemedi.");
      }

      setOrders((currentOrders) =>
        currentOrders.map((item) =>
          item.order_id === order.order_id
            ? { ...item, status: "ON_THE_WAY" }
            : item,
        ),
      );

      setSelectedOrder((currentOrder) =>
        currentOrder?.order_id === order.order_id
          ? { ...currentOrder, status: "ON_THE_WAY" }
          : currentOrder,
      );

      setSuccess("Sipariş yola çıktı olarak işaretlendi.");
    } catch (err) {
      setError(err.message || "Sipariş durumu güncellenemedi.");
    } finally {
      setProcessing(false);
    }
  }

  async function completeOrder(order) {
    const confirmed = window.confirm(
      `${order.company_name} müşterisinin siparişini teslim edildi olarak işaretlemek istiyor musunuz?`,
    );

    if (!confirmed) return;

    try {
      setProcessing(true);
      setError("");
      setSuccess("");

      const response = await fetch(
        `${API_URL}/distributor/orders/${order.order_id}/deliver`,
        {
          method: "PATCH",
          headers,
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Teslimat işlemi tamamlanamadı.");
      }

      setOrders((currentOrders) =>
        currentOrders.map((item) =>
          item.order_id === order.order_id
            ? { ...item, status: "DELIVERED" }
            : item,
        ),
      );

      setSelectedOrder((currentOrder) =>
        currentOrder?.order_id === order.order_id
          ? { ...currentOrder, status: "DELIVERED" }
          : currentOrder,
      );

      setSuccess(
        data.alreadyDelivered
          ? "Bu sipariş daha önce teslim edilmiş."
          : "Sipariş teslim edildi ve müşteri cari hesabına borç kaydedildi.",
      );
    } catch (err) {
      setError(err.message || "Teslimat sırasında hata oluştu.");
    } finally {
      setProcessing(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("Yeni şifre en az 8 karakter olmalıdır.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Yeni şifreler birbiriyle eşleşmiyor.");
      return;
    }

    if (currentPassword === newPassword) {
      setError("Yeni şifreniz mevcut şifrenizden farklı olmalıdır.");
      return;
    }

    try {
      setPasswordLoading(true);

      const response = await fetch(`${API_URL}/auth/change-password`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Şifre değiştirilemedi.");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordModal(false);
      setSuccess("Şifreniz başarıyla değiştirildi.");
    } catch (err) {
      setError(err.message || "Şifre değiştirilirken hata oluştu.");
    } finally {
      setPasswordLoading(false);
    }
  }

  useEffect(() => {
    loadShipments();
  }, []);

  // Sevkiyatları üç ayrı gruba ayır.
  const activeShipments = shipments.filter((shipment) => {
    const status = normalizeStatus(shipment.status);

    return !["DELIVERED", "CANCELLED"].includes(status);
  });

  const deliveredShipments = shipments.filter(
    (shipment) => normalizeStatus(shipment.status) === "DELIVERED",
  );

  const cancelledShipments = shipments.filter(
    (shipment) => normalizeStatus(shipment.status) === "CANCELLED",
  );

  // Siparişleri aktif ve geçmiş olarak ayır.
  const activeOrders = orders.filter((order) => {
    const status = getOrderStatus(order);

    return !["DELIVERED", "CANCELLED"].includes(status);
  });

  const historicalOrders = orders.filter((order) => {
    const status = getOrderStatus(order);

    return ["DELIVERED", "CANCELLED"].includes(status);
  });

  function renderShipmentCard(shipment) {
    const status = normalizeStatus(shipment.status);

    return (
      <button
        className="personnel-shipment-card"
        key={shipment.id}
        onClick={() => openShipment(shipment)}
      >
        <div className="personnel-card-top">
          <strong>{shipment.route_name || "İsimsiz Rota"}</strong>

          <span className={`personnel-status ${status.toLowerCase()}`}>
            {STATUS_LABELS[status] || status}
          </span>
        </div>

        <div className="personnel-card-info">
          <span>Sevkiyat tarihi</span>
          <strong>{formatDate(shipment.shipment_date)}</strong>
        </div>

        <div className="personnel-card-info">
          <span>Araç</span>
          <strong>
            {shipment.assigned_vehicle_plate ||
              shipment.vehicle_plate ||
              "Araç atanmamış"}
          </strong>
        </div>

        <div className="personnel-card-bottom">
          <span>Sevkiyat detaylarını görüntüle</span>
          <span>›</span>
        </div>
      </button>
    );
  }

  function renderOrderCard(order) {
    const status = getOrderStatus(order);

    return (
      <button
        className="personnel-order-card"
        key={order.order_id}
        onClick={() => openOrder(order)}
      >
        <div className="personnel-card-top">
          <strong>{order.company_name}</strong>

          <span className={`personnel-status ${status.toLowerCase()}`}>
            {STATUS_LABELS[status] || status}
          </span>
        </div>

        <p>{order.contact_name || "Yetkili bilgisi yok"}</p>

        <div className="personnel-card-bottom">
          <strong>{formatAmount(order.total_amount)}</strong>
          <span>Sipariş detayları ›</span>
        </div>
      </button>
    );
  }

  return (
    <div className="personnel-page">
      <header className="personnel-header">
        <div>
          <h1>KİLCAROĞLU</h1>
          <span>Personel Paneli</span>
        </div>

        <div className="personnel-user">
          <span>{session.user?.name || "Personel"}</span>

          <button
            className="personnel-password-button"
            onClick={() => {
              setError("");
              setSuccess("");
              setShowPasswordModal(true);
            }}
          >
            Şifre Değiştir
          </button>

          <button onClick={onLogout}>Çıkış</button>
        </div>
      </header>

      <main className="personnel-content">
        {!selectedShipment && (
          <>
            <div className="personnel-page-heading">
              <div>
                <h2>Sevkiyatlarım</h2>
                <p>
                  Size atanmış sevkiyatları buradan takip edebilirsiniz.
                </p>
              </div>

              <button
                className="personnel-refresh-button"
                onClick={loadShipments}
                disabled={loading}
              >
                Yenile
              </button>
            </div>

            {error && (
              <div className="personnel-message error">{error}</div>
            )}

            {success && (
              <div className="personnel-message success">{success}</div>
            )}

            {loading ? (
              <p className="personnel-empty">Sevkiyatlar yükleniyor...</p>
            ) : (
              <>
                <h3 className="personnel-list-heading">
                  Aktif Sevkiyatlar
                </h3>

                {activeShipments.length === 0 ? (
                  <p className="personnel-empty">
                    Şu anda aktif sevkiyatınız bulunmuyor.
                  </p>
                ) : (
                  <div className="personnel-shipment-list">
                    {activeShipments.map(renderShipmentCard)}
                  </div>
                )}

                {deliveredShipments.length > 0 && (
                  <div className="personnel-delivered-section">
                    <button
                      className="personnel-refresh-button"
                      onClick={() =>
                        setShowDeliveredShipments((current) => !current)
                      }
                    >
                      {showDeliveredShipments
                        ? "Teslim Edilen Sevkiyatları Gizle"
                        : `Teslim Edilen Sevkiyatları Göster (${deliveredShipments.length})`}
                    </button>

                    {showDeliveredShipments && (
                      <div className="personnel-shipment-list">
                        {deliveredShipments.map(renderShipmentCard)}
                      </div>
                    )}
                  </div>
                )}

                {cancelledShipments.length > 0 && (
                  <div className="personnel-delivered-section">
                    <button
                      className="personnel-refresh-button"
                      onClick={() =>
                        setShowCancelledShipments((current) => !current)
                      }
                    >
                      {showCancelledShipments
                        ? "İptal Edilen Sevkiyatları Gizle"
                        : `İptal Edilen Sevkiyatları Göster (${cancelledShipments.length})`}
                    </button>

                    {showCancelledShipments && (
                      <div className="personnel-shipment-list">
                        {cancelledShipments.map(renderShipmentCard)}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {selectedShipment && !selectedOrder && (
          <>
            <button
              className="personnel-back-button"
              onClick={goBackToShipments}
            >
              ‹ Sevkiyatlarım
            </button>

            <div className="personnel-section-heading">
              <h2>{selectedShipment.route_name || "Sevkiyat Detayı"}</h2>
              <p>{formatDate(selectedShipment.shipment_date)}</p>
            </div>

            {error && (
              <div className="personnel-message error">{error}</div>
            )}

            {success && (
              <div className="personnel-message success">{success}</div>
            )}

            {detailLoading ? (
              <p className="personnel-empty">Siparişler yükleniyor...</p>
            ) : (
              <>
                <h3 className="personnel-list-heading">
                  Aktif Siparişler
                </h3>

                {activeOrders.length === 0 ? (
                  <p className="personnel-empty">
                    Bu sevkiyatta işlem bekleyen sipariş bulunmuyor.
                  </p>
                ) : (
                  <div className="personnel-order-list">
                    {activeOrders.map(renderOrderCard)}
                  </div>
                )}

                {historicalOrders.length > 0 && (
                  <div className="personnel-history-section">
                    <button
                      className="personnel-refresh-button"
                      onClick={() =>
                        setShowHistoricalOrders((current) => !current)
                      }
                    >
                      {showHistoricalOrders
                        ? "Geçmiş Siparişleri Gizle"
                        : `Geçmiş Siparişleri Göster (${historicalOrders.length})`}
                    </button>

                    {showHistoricalOrders && (
                      <div className="personnel-order-list">
                        {historicalOrders.map(renderOrderCard)}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {selectedShipment && selectedOrder && (
          <>
            <button
              className="personnel-back-button"
              onClick={goBackToOrders}
            >
              ‹ Müşteri listesine dön
            </button>

            <div className="personnel-section-heading">
              <h2>{selectedOrder.company_name}</h2>
              <p>Sipariş #{selectedOrder.order_id}</p>
            </div>

            {error && (
              <div className="personnel-message error">{error}</div>
            )}

            {success && (
              <div className="personnel-message success">{success}</div>
            )}

            <section className="personnel-detail-card">
              <h3>Müşteri Bilgileri</h3>

              <div className="personnel-detail-row">
                <span>Yetkili</span>
                <strong>{selectedOrder.contact_name || "-"}</strong>
              </div>

              <div className="personnel-detail-row">
                <span>Telefon</span>
                <strong>{selectedOrder.phone || "-"}</strong>
              </div>

              <div className="personnel-detail-row">
                <span>Adres</span>
                <strong>{selectedOrder.address || "-"}</strong>
              </div>
            </section>

            <section className="personnel-detail-card">
              <h3>Sipariş Ürünleri</h3>

              {selectedOrder.items?.length ? (
                <div className="personnel-product-list">
                  {selectedOrder.items.map((item) => (
                    <div className="personnel-product-row" key={item.id}>
                      <div>
                        <strong>{item.product_name}</strong>
                        <span>
                          {item.quantity} {item.min_unit_label || "adet"}
                        </span>
                      </div>

                      <strong>
                        {formatAmount(
                          Number(item.quantity) * Number(item.unit_price),
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p>Bu siparişte ürün bulunmuyor.</p>
              )}

              <div className="personnel-total">
                <span>Sipariş Toplamı</span>
                <strong>
                  {formatAmount(selectedOrder.total_amount)}
                </strong>
              </div>
            </section>

            {getOrderStatus(selectedOrder) === "DELIVERED" ? (
              <div className="personnel-delivered">
                Sipariş teslim edildi.
              </div>
            ) : getOrderStatus(selectedOrder) === "CANCELLED" ? (
              <div className="personnel-info">
                Bu sipariş iptal edilmiştir.
              </div>
            ) : getOrderStatus(selectedOrder) === "ON_THE_WAY" ? (
              <button
                className="personnel-complete-button"
                onClick={() => completeOrder(selectedOrder)}
                disabled={processing}
              >
                {processing ? "İşlem yapılıyor..." : "Siparişi Tamamla"}
              </button>
            ) : getOrderStatus(selectedOrder) === "PREPARING" ? (
              <button
                className="personnel-complete-button"
                onClick={() => markOrderOnTheWay(selectedOrder)}
                disabled={processing}
              >
                {processing
                  ? "İşlem yapılıyor..."
                  : "Yola Çıktı Olarak İşaretle"}
              </button>
            ) : (
              <div className="personnel-info">
                Bu sipariş henüz yola çıkarılabilecek durumda değil.
              </div>
            )}
          </>
        )}
      </main>

      {showPasswordModal && (
        <div
          className="personnel-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowPasswordModal(false);
            }
          }}
        >
          <div className="personnel-password-modal">
            <div className="personnel-modal-heading">
              <h2>Şifre Değiştir</h2>

              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={changePassword}>
              <label htmlFor="currentPassword">Mevcut şifre</label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(event) =>
                  setCurrentPassword(event.target.value)
                }
                required
                autoComplete="current-password"
              />

              <label htmlFor="newPassword">Yeni şifre</label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(event) =>
                  setNewPassword(event.target.value)
                }
                required
                minLength={8}
                autoComplete="new-password"
              />

              <label htmlFor="confirmPassword">Yeni şifre tekrar</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                required
                minLength={8}
                autoComplete="new-password"
              />

              {error && (
                <div className="personnel-message error">{error}</div>
              )}

              <button
                type="submit"
                className="personnel-complete-button"
                disabled={passwordLoading}
              >
                {passwordLoading ? "Kaydediliyor..." : "Şifreyi Güncelle"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default PersonnelDashboard;

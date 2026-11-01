
import { useCallback, useEffect, useMemo, useState } from "react";
import "./AdminShipmentsPage.css";

const API_URL = "http://localhost:4000";

const STATUS_OPTIONS = [
  { value: "PLANNED", label: "Planlandı" },
  { value: "PREPARING", label: "Hazırlanıyor" },
  { value: "ON_THE_WAY", label: "Yola çıktı" },
  { value: "DELIVERED", label: "Teslim edildi" },
  { value: "CANCELLED", label: "İptal edildi" }
];

const DAY_NAMES = [
  "Pazar", "Pazartesi", "Salı", "Çarşamba",
  "Perşembe", "Cuma", "Cumartesi"
];

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function getStatusLabel(status) {
  return STATUS_OPTIONS.find(item => item.value === status)?.label || status;
}

function getStatusClass(status) {
  return `shipment-status shipment-status-${String(status || "").toLowerCase()}`;
}

export default function AdminShipmentsPage({ session }) {
  const token = session?.token;

  const [shipments, setShipments] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [personnel, setPersonnel] = useState([]);
  const [routes, setRoutes] = useState([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [selectedShipment, setSelectedShipment] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [selectedPersonnel, setSelectedPersonnel] = useState([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newShipment, setNewShipment] = useState({
    route_id: "",
    shipment_date: ""
  });

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "İşlem gerçekleştirilemedi.");
    }

    return data;
  }, [token]);

  const loadData = useCallback(async () => {
    if (!token) {
      setError("Oturum anahtarı bulunamadı. Lütfen yeniden giriş yapın.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [shipmentData, vehicleData, personnelData, routeData] =
        await Promise.all([
          request("/shipments"),
          request("/vehicles"),
          request("/admin/distributors"),
          request("/routes")
        ]);

      setShipments(Array.isArray(shipmentData) ? shipmentData : []);
      setVehicles(Array.isArray(vehicleData) ? vehicleData : []);
      setPersonnel(Array.isArray(personnelData) ? personnelData : []);
      setRoutes(Array.isArray(routeData) ? routeData : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [request, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredShipments = useMemo(() => {
    return shipments.filter(shipment => {
      const shipmentDate = String(shipment.shipment_date || "").slice(0, 10);

      const matchesDate =
        !dateFilter || shipmentDate === dateFilter;

      const matchesStatus =
        statusFilter === "ALL" || shipment.status === statusFilter;

      return matchesDate && matchesStatus;
    });
  }, [shipments, dateFilter, statusFilter]);

  const activeVehicles = vehicles.filter(vehicle => vehicle.active);
  const activePersonnel = personnel.filter(person => person.active);

  const summary = useMemo(() => ({
    total: shipments.length,
    planned: shipments.filter(item => item.status === "PLANNED").length,
    preparing: shipments.filter(item => item.status === "PREPARING").length,
    onTheWay: shipments.filter(item => item.status === "ON_THE_WAY").length,
    delivered: shipments.filter(item => item.status === "DELIVERED").length
  }), [shipments]);

  function openAssignment(shipment) {
    setSelectedShipment(shipment);
    setSelectedVehicle(
      shipment.vehicle_id ? String(shipment.vehicle_id) : ""
    );

    const currentPersonnel = Array.isArray(shipment.personnel)
      ? shipment.personnel.map(person => person.id)
      : [];

    setSelectedPersonnel(currentPersonnel);
    setError("");
    setSuccess("");
  }

  function togglePersonnel(personId) {
    setSelectedPersonnel(current => {
      if (current.includes(personId)) {
        return current.filter(id => id !== personId);
      }

      return [...current, personId];
    });
  }

  async function generateWeek() {
    if (!window.confirm(
      "Aktif rotaların önümüzdeki 7 günlük sevkiyatları oluşturulsun mu?"
    )) {
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await request("/shipments/generate-week", {
        method: "POST"
      });

      setSuccess(
        `${result.created_count ?? 0} yeni sevkiyat oluşturuldu.`
      );

      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createShipment(event) {
    event.preventDefault();

    if (!newShipment.route_id || !newShipment.shipment_date) {
      setError("Rota ve sevkiyat tarihi seçmelisiniz.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request("/shipments", {
        method: "POST",
        body: JSON.stringify({
          route_id: Number(newShipment.route_id),
          shipment_date: newShipment.shipment_date
        })
      });

      setShowCreateModal(false);
      setNewShipment({ route_id: "", shipment_date: "" });
      setSuccess("Sevkiyat oluşturuldu.");
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAssignments() {
    if (!selectedShipment) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/shipments/${selectedShipment.id}/vehicle`, {
        method: "PATCH",
        body: JSON.stringify({
          vehicle_id: selectedVehicle ? Number(selectedVehicle) : null
        })
      });

      await request(`/shipments/${selectedShipment.id}/personnel`, {
        method: "PUT",
        body: JSON.stringify({
          driver_ids: selectedPersonnel
        })
      });

      setSelectedShipment(null);
      setSuccess("Araç ve personel atamaları kaydedildi.");
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(shipment, status) {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/shipments/${shipment.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });

      setSuccess("Sevkiyat durumu güncellendi.");
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function getVehicleName(shipment) {
    const vehicle = vehicles.find(
      item => Number(item.id) === Number(shipment.vehicle_id)
    );

    return vehicle?.plate || shipment.vehicle_plate || "Araç atanmadı";
  }

  function getPersonnelNames(shipment) {
    if (!Array.isArray(shipment.personnel) || !shipment.personnel.length) {
      return "Personel atanmadı";
    }

    return shipment.personnel
      .map(person => `${person.name} (${person.role === "DRIVER" ? "Şoför" : "Dağıtıcı"})`)
      .join(", ");
  }

  return (
    <div className="shipments-page">
      <div className="shipments-heading">
        <div>
          <span className="shipments-eyebrow">DAĞITIM VE LOJİSTİK</span>
          <h2>Sevkiyat Yönetimi</h2>
          <p>Sevkiyatları planlayın, araç ve personel atamalarını yönetin.</p>
        </div>

        <div className="shipments-heading-actions">
          <button
            className="shipment-button shipment-button-secondary"
            onClick={loadData}
            disabled={loading || busy}
          >
            ↻ Yenile
          </button>

          <button
            className="shipment-button shipment-button-secondary"
            onClick={() => setShowCreateModal(true)}
            disabled={busy}
          >
            + Sevkiyat Ekle
          </button>

          <button
            className="shipment-button shipment-button-primary"
            onClick={generateWeek}
            disabled={busy}
          >
            {busy ? "İşleniyor..." : "7 Günlük Plan Oluştur"}
          </button>
        </div>
      </div>

      {error && (
        <div className="shipment-alert shipment-alert-error">
          {error}
          <button onClick={() => setError("")}>×</button>
        </div>
      )}

      {success && (
        <div className="shipment-alert shipment-alert-success">
          {success}
          <button onClick={() => setSuccess("")}>×</button>
        </div>
      )}

      <div className="shipment-summary-grid">
        <div className="shipment-summary-card">
          <span>Toplam sevkiyat</span>
          <strong>{summary.total}</strong>
        </div>
        <div className="shipment-summary-card">
          <span>Planlandı</span>
          <strong>{summary.planned}</strong>
        </div>
        <div className="shipment-summary-card">
          <span>Hazırlanıyor</span>
          <strong>{summary.preparing}</strong>
        </div>
        <div className="shipment-summary-card">
          <span>Yola çıktı</span>
          <strong>{summary.onTheWay}</strong>
        </div>
        <div className="shipment-summary-card">
          <span>Teslim edildi</span>
          <strong>{summary.delivered}</strong>
        </div>
      </div>

      <div className="shipments-toolbar">
        <div>
          <h3>Sevkiyat Listesi</h3>
          <p>{filteredShipments.length} sevkiyat gösteriliyor</p>
        </div>

        <div className="shipment-filters">
          <label>
            <span>Tarih</span>
            <input
              type="date"
              value={dateFilter}
              onChange={event => setDateFilter(event.target.value)}
            />
          </label>

          <label>
            <span>Durum</span>
            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value)}
            >
              <option value="ALL">Tüm durumlar</option>
              {STATUS_OPTIONS.map(status => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>

          <button
            className="shipment-clear-filter"
            onClick={() => {
              setDateFilter("");
              setStatusFilter("ALL");
            }}
          >
            Filtreleri temizle
          </button>
        </div>
      </div>

      {loading ? (
        <div className="shipment-empty">Sevkiyatlar yükleniyor...</div>
      ) : filteredShipments.length === 0 ? (
        <div className="shipment-empty">
          <div>🚚</div>
          <strong>Sevkiyat bulunamadı</strong>
          <p>Seçilen filtrelere uygun sevkiyat yok.</p>
        </div>
      ) : (
        <div className="shipment-list">
          {filteredShipments.map(shipment => (
            <article className="shipment-card" key={shipment.id}>
              <div className="shipment-card-top">
                <div>
                  <span className="shipment-number">
                    SEVKİYAT #{shipment.id}
                  </span>
                  <h3>{shipment.route_name || "Rota bilgisi yok"}</h3>
                  <p>
                    {formatDate(shipment.shipment_date)}
                    {" · "}
                    {DAY_NAMES[new Date(
                      `${String(shipment.shipment_date).slice(0, 10)}T00:00:00`
                    ).getDay()]}
                  </p>
                </div>

                <span className={getStatusClass(shipment.status)}>
                  {getStatusLabel(shipment.status)}
                </span>
              </div>

              <div className="shipment-card-details">
                <div>
                  <span className="shipment-detail-label">Araç</span>
                  <strong>{getVehicleName(shipment)}</strong>
                </div>

                <div>
                  <span className="shipment-detail-label">Personel</span>
                  <strong>{getPersonnelNames(shipment)}</strong>
                </div>
              </div>

              <div className="shipment-card-actions">
                <button
                  className="shipment-button shipment-button-secondary"
                  onClick={() => openAssignment(shipment)}
                  disabled={busy || shipment.status === "CANCELLED"}
                >
                  Araç / Personel Ata
                </button>

                <label className="shipment-status-control">
                  <span>Durumu</span>
                  <select
                    value={shipment.status}
                    onChange={event =>
                      updateStatus(shipment, event.target.value)
                    }
                    disabled={busy}
                  >
                    {STATUS_OPTIONS.map(status => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </article>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div
          className="shipment-modal-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setShowCreateModal(false);
            }
          }}
        >
          <div className="shipment-modal">
            <button
              className="shipment-modal-close"
              onClick={() => setShowCreateModal(false)}
            >
              ×
            </button>

            <h3>Manuel Sevkiyat Oluştur</h3>
            <p>Seçilen rotanın teslimat günlerinden bir tarih seçin.</p>

            <form onSubmit={createShipment}>
              <label>
                Rota
                <select
                  value={newShipment.route_id}
                  onChange={event =>
                    setNewShipment(current => ({
                      ...current,
                      route_id: event.target.value
                    }))
                  }
                  required
                >
                  <option value="">Rota seçin</option>
                  {routes.filter(route => route.active).map(route => (
                    <option key={route.id} value={route.id}>
                      {route.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Sevkiyat tarihi
                <input
                  type="date"
                  value={newShipment.shipment_date}
                  onChange={event =>
                    setNewShipment(current => ({
                      ...current,
                      shipment_date: event.target.value
                    }))
                  }
                  required
                />
              </label>

              <div className="shipment-modal-actions">
                <button
                  type="button"
                  className="shipment-button shipment-button-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  className="shipment-button shipment-button-primary"
                  disabled={busy}
                >
                  {busy ? "Kaydediliyor..." : "Sevkiyat Oluştur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedShipment && (
        <div
          className="shipment-modal-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setSelectedShipment(null);
            }
          }}
        >
          <div className="shipment-modal shipment-assignment-modal">
            <button
              className="shipment-modal-close"
              onClick={() => setSelectedShipment(null)}
            >
              ×
            </button>

            <span className="shipment-eyebrow">SEVKİYAT #{selectedShipment.id}</span>
            <h3>Araç ve Personel Atama</h3>
            <p>
              {selectedShipment.route_name} · {formatDate(selectedShipment.shipment_date)}
            </p>

            <div className="shipment-form-section">
              <label>
                Araç seçin
                <select
                  value={selectedVehicle}
                  onChange={event => setSelectedVehicle(event.target.value)}
                >
                  <option value="">Araç atama / atamayı kaldır</option>
                  {activeVehicles.map(vehicle => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate} {vehicle.brand || ""} {vehicle.model || ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="shipment-form-section">
              <div className="shipment-personnel-heading">
                <strong>Personel seçin</strong>
                <span>{selectedPersonnel.length} kişi seçildi</span>
              </div>

              {activePersonnel.length === 0 ? (
                <p className="shipment-no-personnel">
                  Aktif şoför veya dağıtıcı bulunamadı.
                </p>
              ) : (
                <div className="shipment-personnel-list">
                  {activePersonnel.map(person => (
                    <label
                      className="shipment-personnel-option"
                      key={person.id}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPersonnel.includes(person.id)}
                        onChange={() => togglePersonnel(person.id)}
                      />

                      <span className="shipment-person-avatar">
                        {person.name?.charAt(0)?.toUpperCase() || "P"}
                      </span>

                      <span className="shipment-person-info">
                        <strong>{person.name}</strong>
                        <small>
                          {person.role === "DRIVER" ? "Şoför" : "Dağıtıcı"}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="shipment-modal-actions">
              <button
                className="shipment-button shipment-button-secondary"
                onClick={() => setSelectedShipment(null)}
              >
                Vazgeç
              </button>

              <button
                className="shipment-button shipment-button-primary"
                onClick={saveAssignments}
                disabled={busy || selectedPersonnel.length === 0}
              >
                {busy ? "Kaydediliyor..." : "Atamaları Kaydet"}
              </button>
            </div>

            <small className="shipment-assignment-note">
              En az bir aktif personel seçilmelidir. Araç ataması isteğe bağlıdır.
            </small>
          </div>
        </div>
      )}
    </div>
  );
}
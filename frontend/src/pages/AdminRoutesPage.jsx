import { useCallback, useEffect, useState } from "react";
import "./AdminRoutesPage.css";

const API_URL = "http://localhost:4000";

const DAYS = [
  { value: 1, label: "Pazartesi" },
  { value: 2, label: "Salı" },
  { value: 3, label: "Çarşamba" },
  { value: 4, label: "Perşembe" },
  { value: 5, label: "Cuma" },
  { value: 6, label: "Cumartesi" },
  { value: 7, label: "Pazar" },
];

function emptySchedule() {
  return {
    delivery_day: 1,
    order_deadline_day: 7,
    order_deadline_time: "18:00",
  };
}

export default function AdminRoutesPage({ session }) {
  const [routes, setRoutes] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [districtUpdatingId, setDistrictUpdatingId] = useState(null);

  const [form, setForm] = useState({
    id: null,
    name: "",
    active: true,
    district_ids: [],
    schedules: [emptySchedule()],
  });

  const token = session?.token;

  const request = useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...options.headers,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "İşlem gerçekleştirilemedi.");
      }

      return data;
    },
    [token],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [routeData, districtData] = await Promise.all([
        request("/routes"),
        request("/districts"),
      ]);

      setRoutes(Array.isArray(routeData) ? routeData : []);
      setDistricts(
        Array.isArray(districtData.districts) ? districtData.districts : [],
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // İlçeyi sevkiyata açma veya kapatma
  async function toggleDistrictDelivery(district) {
    const nextStatus = !district.delivery_available;

    const confirmed = window.confirm(
      `"${district.name}" ilçesini sevkiyata ${
        nextStatus ? "açmak" : "kapatmak"
      } istiyor musunuz?`,
    );

    if (!confirmed) return;

    setDistrictUpdatingId(district.id);
    setError("");
    setSuccess("");

    try {
      const result = await request(`/districts/${district.id}/delivery`, {
        method: "PATCH",
        body: JSON.stringify({
          delivery_available: nextStatus,
        }),
      });

      setDistricts((current) =>
        current.map((item) =>
          Number(item.id) === Number(district.id)
            ? {
                ...item,
                delivery_available:
                  result.district?.delivery_available ?? nextStatus,
              }
            : item,
        ),
      );

      setSuccess(
        result.message ||
          `${district.name} ilçesinin sevkiyat durumu güncellendi.`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setDistrictUpdatingId(null);
    }
  }

  function openNewRoute() {
    setForm({
      id: null,
      name: "",
      active: true,
      district_ids: [],
      schedules: [emptySchedule()],
    });
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function openEditRoute(route) {
    setForm({
      id: route.id,
      name: route.name || "",
      active: route.active,
      district_ids: (route.districts || []).map((district) =>
        Number(district.id),
      ),
      schedules:
        route.schedules?.map((schedule) => ({
          delivery_day: Number(schedule.delivery_day),
          order_deadline_day: Number(schedule.order_deadline_day),
          order_deadline_time: String(schedule.order_deadline_time).slice(0, 5),
        })) || [],
    });

    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function updateSchedule(index, field, value) {
    setForm((current) => ({
      ...current,
      schedules: current.schedules.map((schedule, i) =>
        i === index
          ? {
              ...schedule,
              [field]: field === "order_deadline_time" ? value : Number(value),
            }
          : schedule,
      ),
    }));
  }

  function addSchedule() {
    const usedDays = form.schedules.map((schedule) =>
      Number(schedule.delivery_day),
    );

    const availableDay = DAYS.find((day) => !usedDays.includes(day.value));

    if (!availableDay) {
      setError("Haftanın bütün günleri zaten eklenmiş.");
      return;
    }

    setForm((current) => ({
      ...current,
      schedules: [
        ...current.schedules,
        {
          ...emptySchedule(),
          delivery_day: availableDay.value,
        },
      ],
    }));
  }

  function removeSchedule(index) {
    setForm((current) => ({
      ...current,
      schedules: current.schedules.filter((_, i) => i !== index),
    }));
  }

  function toggleDistrict(districtId) {
    setForm((current) => {
      const exists = current.district_ids.includes(districtId);

      return {
        ...current,
        district_ids: exists
          ? current.district_ids.filter((id) => id !== districtId)
          : [...current.district_ids, districtId],
      };
    });
  }

  async function saveRoute(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.name.trim()) {
      setError("Rota adı zorunludur.");
      return;
    }

    if (form.schedules.length === 0) {
      setError("En az bir sevkiyat günü eklemelisiniz.");
      return;
    }

    const days = form.schedules.map((item) => Number(item.delivery_day));

    if (new Set(days).size !== days.length) {
      setError("Aynı sevkiyat günü birden fazla kez seçilemez.");
      return;
    }

    if (form.district_ids.length === 0) {
      setError("Rotaya en az bir ilçe bağlamalısınız.");
      return;
    }

    setSaving(true);

    try {
      let routeId = form.id;

      const routePayload = {
        name: form.name.trim(),
        active: form.active,
      };

      if (routeId) {
        await request(`/routes/${routeId}`, {
          method: "PUT",
          body: JSON.stringify(routePayload),
        });

        await request(`/routes/${routeId}/schedules`, {
          method: "PUT",
          body: JSON.stringify({
            schedules: form.schedules,
          }),
        });
      } else {
        const result = await request("/routes", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            schedules: form.schedules,
          }),
        });

        routeId = result.route.id;
      }

      await request(`/routes/${routeId}/districts`, {
        method: "PUT",
        body: JSON.stringify({
          district_ids: form.district_ids,
        }),
      });

      setModalOpen(false);
      setSuccess(
        form.id ? "Rota başarıyla güncellendi." : "Yeni rota oluşturuldu.",
      );

      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleRoute(route) {
    const confirmed = window.confirm(
      `"${route.name}" rotasını ${
        route.active ? "pasif" : "aktif"
      } yapmak istiyor musunuz?`,
    );

    if (!confirmed) return;

    try {
      await request(`/routes/${route.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: route.name,
          active: !route.active,
        }),
      });

      setSuccess("Rota durumu güncellendi.");
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  const filteredRoutes = routes.filter((route) =>
    route.name.toLowerCase().includes(search.toLowerCase()),
  );

  const assignedDistrictIds = new Set(
    routes
      .filter((route) => route.id !== form.id)
      .flatMap((route) =>
        (route.districts || []).map((district) => Number(district.id)),
      ),
  );

  // Yeni rotada yalnızca açık ilçeler görünür.
  // Düzenlenen rotanın kendi ilçeleri ise mevcut seçimleri korumak
  // için kapalı olsalar bile listede kalır.
  const availableDistricts = districts.filter((district) => {
    const districtId = Number(district.id);
    const alreadySelected = form.district_ids.includes(districtId);
    const availableForNewRoute = district.active && district.delivery_available;

    return (
      !assignedDistrictIds.has(districtId) &&
      (alreadySelected || availableForNewRoute)
    );
  });

  const openDistrictCount = districts.filter(
    (district) => district.active && district.delivery_available,
  ).length;

  const closedDistrictCount = districts.filter(
    (district) => !district.delivery_available,
  ).length;

  return (
    <div className="routes-page">
      <div className="routes-toolbar">
        <div>
          <h2>Rota yönetimi</h2>
          <p>
            İlçeleri rotalara bağlayın ve haftalık sevkiyat programlarını
            düzenleyin.
          </p>
        </div>

        <button
          type="button"
          className="routes-primary-button"
          onClick={openNewRoute}
        >
          + Yeni rota oluştur
        </button>
      </div>

      {error && <div className="routes-alert error">{error}</div>}
      {success && <div className="routes-alert success">{success}</div>}

      <div className="routes-summary">
        <div className="routes-summary-card">
          <span>Toplam rota</span>
          <strong>{routes.length}</strong>
        </div>

        <div className="routes-summary-card">
          <span>Aktif rota</span>
          <strong>{routes.filter((route) => route.active).length}</strong>
        </div>

        <div className="routes-summary-card">
          <span>Tanımlı ilçe</span>
          <strong>
            {
              new Set(
                routes.flatMap((route) =>
                  (route.districts || []).map((district) =>
                    Number(district.id),
                  ),
                ),
              ).size
            }
          </strong>
        </div>

        <div className="routes-summary-card">
          <span>Sevkiyata açık ilçe</span>
          <strong>{openDistrictCount}</strong>
        </div>
      </div>


      <div className="routes-list-toolbar">
        <input
          type="search"
          placeholder="Rota adına göre ara..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <button
          type="button"
          className="routes-secondary-button"
          onClick={loadData}
          disabled={loading}
        >
          Yenile
        </button>
      </div>

      {loading ? (
        <div className="routes-empty">Rotalar yükleniyor...</div>
      ) : filteredRoutes.length === 0 ? (
        <div className="routes-empty">
          Henüz rota bulunmuyor. Yeni rota oluşturarak başlayabilirsiniz.
        </div>
      ) : (
        <div className="routes-grid">
          {filteredRoutes.map((route) => (
            <article className="route-card" key={route.id}>
              <div className="route-card-heading">
                <div>
                  <span className="route-card-label">DAĞITIM ROTASI</span>
                  <h3>{route.name}</h3>
                </div>

                <span
                  className={`route-status ${
                    route.active ? "active" : "passive"
                  }`}
                >
                  {route.active ? "Aktif" : "Pasif"}
                </span>
              </div>

              <div className="route-card-section">
                <h4>Bağlı ilçeler</h4>

                <div className="route-chip-list">
                  {route.districts?.length ? (
                    route.districts.map((district) => (
                      <span className="route-chip" key={district.id}>
                        {district.name}
                      </span>
                    ))
                  ) : (
                    <span className="route-muted">İlçe bağlanmamış</span>
                  )}
                </div>
              </div>

              <div className="route-card-section">
                <h4>Haftalık sevkiyat programı</h4>

                {route.schedules?.length ? (
                  <div className="route-schedule-list">
                    {route.schedules.map((schedule) => (
                      <div className="route-schedule-row" key={schedule.id}>
                        <strong>
                          {DAYS.find(
                            (day) =>
                              day.value === Number(schedule.delivery_day),
                          )?.label || "Bilinmeyen gün"}
                        </strong>

                        <span>
                          Sipariş sonu:{" "}
                          {DAYS.find(
                            (day) =>
                              day.value === Number(schedule.order_deadline_day),
                          )?.label || "—"}{" "}
                          {String(schedule.order_deadline_time).slice(0, 5)}
                        </span>

                        {!schedule.active && (
                          <span className="route-muted">Pasif</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="route-muted">
                    Haftalık program tanımlanmamış
                  </span>
                )}
              </div>

              <div className="route-card-actions">
                <button
                  type="button"
                  className="routes-secondary-button"
                  onClick={() => openEditRoute(route)}
                >
                  Düzenle
                </button>

                <button
                  type="button"
                  className="routes-toggle-button"
                  onClick={() => toggleRoute(route)}
                >
                  {route.active ? "Pasife al" : "Aktifleştir"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* İlçe sevkiyat yönetimi */}

      <section className="district-management">
        <div className="district-management-header">
          <div>
            <h3>İlçe sevkiyat yönetimi</h3>
            <p>
              İlçeleri sevkiyata açıp kapatın. Açık ilçeler yeni rota oluşturma
              ekranında seçilebilir.
            </p>
          </div>

          <button
            type="button"
            className="routes-secondary-button"
            onClick={loadData}
            disabled={loading || districtUpdatingId !== null}
          >
            Yenile
          </button>
        </div>

        <div className="district-management-summary">
          <span className="district-count-open">
            Sevkiyata açık: {openDistrictCount}
          </span>
          <span className="district-count-closed">
            Sevkiyata kapalı: {closedDistrictCount}
          </span>
        </div>

        {loading ? (
          <div className="routes-empty">İlçeler yükleniyor...</div>
        ) : districts.length === 0 ? (
          <div className="routes-empty">Sistemde kayıtlı ilçe bulunamadı.</div>
        ) : (
          <div className="district-management-list">
            {districts.map((district) => {
              const isOpen = district.active && district.delivery_available;
              const isUpdating =
                Number(districtUpdatingId) === Number(district.id);

              return (
                <div className="district-management-item" key={district.id}>
                  <div className="district-management-info">
                    <strong>{district.name}</strong>

                    <span
                      className={`district-delivery-status ${
                        isOpen ? "open" : "closed"
                      }`}
                    >
                      {isOpen
                        ? "Sevkiyata açık"
                        : district.active
                          ? "Sevkiyata kapalı"
                          : "İlçe pasif"}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={`district-delivery-button ${
                      isOpen ? "close" : "open"
                    }`}
                    onClick={() => toggleDistrictDelivery(district)}
                    disabled={
                      isUpdating ||
                      loading ||
                      districtUpdatingId !== null ||
                      !district.active
                    }
                    title={
                      !district.active
                        ? "Önce ilçenin genel aktifliğini açmalısınız."
                        : ""
                    }
                  >
                    {isUpdating
                      ? "Kaydediliyor..."
                      : isOpen
                        ? "Sevkiyata kapat"
                        : "Sevkiyata aç"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <small className="district-management-note">
          Aktif bir rotaya bağlı ilçeler, o rotadan çıkarılmadan sevkiyata
          kapatılamaz. İlçeyi kapatmak geçmiş siparişleri veya sevkiyatları
          silmez.
        </small>
      </section>
      {modalOpen && (
        <div
          className="routes-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setModalOpen(false);
            }
          }}
        >
          <form className="routes-modal" onSubmit={saveRoute}>
            <div className="routes-modal-header">
              <div>
                <span className="route-card-label">ROTA TANIMLAMA</span>
                <h2>{form.id ? "Rotayı düzenle" : "Yeni rota oluştur"}</h2>
              </div>

              <button
                type="button"
                className="routes-modal-close"
                onClick={() => setModalOpen(false)}
                aria-label="Kapat"
              >
                ×
              </button>
            </div>

            {error && <div className="routes-alert error">{error}</div>}

            <div className="routes-form-group">
              <label>Rota adı</label>
              <input
                type="text"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Örn. Hafik-Zara Rotası"
                required
              />
            </div>

            {form.id && (
              <label className="route-active-checkbox">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      active: event.target.checked,
                    }))
                  }
                />
                Rota aktif
              </label>
            )}

            <div className="routes-form-group">
              <div className="routes-form-heading">
                <div>
                  <label>Rotaya bağlı ilçeler</label>
                  <p>
                    Sevkiyata açık ilçelerden bu rotaya dahil etmek
                    istediklerinizi seçin.
                  </p>
                </div>
              </div>

              <div className="route-district-options">
                {availableDistricts.length === 0 ? (
                  <p className="route-muted">
                    Seçilebilecek uygun ilçe bulunamadı.
                  </p>
                ) : (
                  availableDistricts.map((district) => {
                    const isSelected = form.district_ids.includes(
                      Number(district.id),
                    );

                    const isClosed =
                      !district.active || !district.delivery_available;

                    return (
                      <label
                        className={`route-district-option ${
                          isClosed ? "route-district-option-closed" : ""
                        }`}
                        key={district.id}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleDistrict(Number(district.id))}
                        />

                        <span>
                          {district.name}
                          {isClosed && (
                            <small> (Mevcut rotada, sevkiyata kapalı)</small>
                          )}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>

              <small>
                Başka bir rotaya bağlı ilçeler burada gösterilmez. Yeni rotalara
                yalnızca sevkiyata açık ilçeler eklenebilir. Mevcut rotanın
                ilçeleri düzenleme sırasında korunur.
              </small>
            </div>

            <div className="routes-form-group">
              <div className="routes-form-heading">
                <div>
                  <label>Haftalık sevkiyat günleri</label>
                  <p>
                    Her sevkiyat günü için sipariş son gününü ve saatini
                    belirleyin.
                  </p>
                </div>

                <button
                  type="button"
                  className="routes-add-day-button"
                  onClick={addSchedule}
                >
                  + Gün ekle
                </button>
              </div>

              <div className="routes-schedule-editor">
                {form.schedules.map((schedule, index) => (
                  <div className="routes-schedule-editor-row" key={index}>
                    <div>
                      <label>Sevkiyat günü</label>
                      <select
                        value={schedule.delivery_day}
                        onChange={(event) =>
                          updateSchedule(
                            index,
                            "delivery_day",
                            event.target.value,
                          )
                        }
                      >
                        {DAYS.map((day) => (
                          <option
                            value={day.value}
                            key={day.value}
                            disabled={form.schedules.some(
                              (other, otherIndex) =>
                                otherIndex !== index &&
                                Number(other.delivery_day) === day.value,
                            )}
                          >
                            {day.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label>Sipariş son günü</label>
                      <select
                        value={schedule.order_deadline_day}
                        onChange={(event) =>
                          updateSchedule(
                            index,
                            "order_deadline_day",
                            event.target.value,
                          )
                        }
                      >
                        {DAYS.map((day) => (
                          <option value={day.value} key={day.value}>
                            {day.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label>Son sipariş saati</label>
                      <input
                        type="time"
                        value={schedule.order_deadline_time}
                        onChange={(event) =>
                          updateSchedule(
                            index,
                            "order_deadline_time",
                            event.target.value,
                          )
                        }
                        required
                      />
                    </div>

                    <button
                      type="button"
                      className="routes-remove-day"
                      onClick={() => removeSchedule(index)}
                      title="Günü kaldır"
                      aria-label="Sevkiyat gününü kaldır"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="routes-modal-footer">
              <button
                type="button"
                className="routes-secondary-button"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                Vazgeç
              </button>

              <button
                type="submit"
                className="routes-primary-button"
                disabled={saving}
              >
                {saving
                  ? "Kaydediliyor..."
                  : form.id
                    ? "Değişiklikleri kaydet"
                    : "Rotayı oluştur"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

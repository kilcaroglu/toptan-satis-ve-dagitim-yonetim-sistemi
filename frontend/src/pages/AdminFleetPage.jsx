
import React, { useEffect, useState } from "react";
import "./AdminFleetPage.css";

const API_URL = "http://localhost:4000";

function AdminFleetPage({ session }) {
  const [activeTab, setActiveTab] = useState("vehicles");

  const [vehicles, setVehicles] = useState([]);
  const [personnel, setPersonnel] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [vehicleSearch, setVehicleSearch] = useState("");
  const [personnelSearch, setPersonnelSearch] = useState("");

  // Pasif kayıtları gösterme ayarları
  const [showInactiveVehicles, setShowInactiveVehicles] = useState(false);
  const [showInactivePersonnel, setShowInactivePersonnel] = useState(false);

  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showPersonnelModal, setShowPersonnelModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);

  const emptyVehicle = {
    plate: "",
    brand: "",
    model: "",
    vehicle_type: "",
    capacity: "",
    capacity_unit: "kg",
    notes: "",
  };

  const emptyPersonnel = {
    name: "",
    email: "",
    password: "",
    phone: "",
    role: "DRIVER",
  };

  const [vehicleForm, setVehicleForm] = useState(emptyVehicle);
  const [personnelForm, setPersonnelForm] = useState(emptyPersonnel);

  // API istekleri
  const request = async (endpoint, options = {}) => {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.token}`,
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "İşlem gerçekleştirilemedi.");
    }

    return data;
  };

  // Araç ve personel listesini getir
  const loadData = async () => {
    try {
      setLoading(true);
      setError("");

      const [vehicleData, personnelData] = await Promise.all([
        request("/vehicles"),
        request("/admin/distributors"),
      ]);

      setVehicles(Array.isArray(vehicleData) ? vehicleData : []);
      setPersonnel(Array.isArray(personnelData) ? personnelData : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Araç formu
  const openNewVehicle = () => {
    setEditingVehicle(null);
    setVehicleForm({ ...emptyVehicle });
    setShowVehicleModal(true);
  };

  const openEditVehicle = (vehicle) => {
    setEditingVehicle(vehicle);

    setVehicleForm({
      plate: vehicle.plate || "",
      brand: vehicle.brand || "",
      model: vehicle.model || "",
      vehicle_type: vehicle.vehicle_type || "",
      capacity: vehicle.capacity ?? "",
      capacity_unit: vehicle.capacity_unit || "kg",
      notes: vehicle.notes || "",
    });

    setShowVehicleModal(true);
  };

  const handleVehicleFormChange = (event) => {
    const { name, value } = event.target;

    setVehicleForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const saveVehicle = async (event) => {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");

      const body = {
        ...vehicleForm,
        plate: vehicleForm.plate.trim().toUpperCase(),
        capacity:
          vehicleForm.capacity === ""
            ? null
            : Number(vehicleForm.capacity),
      };

      if (editingVehicle) {
        await request(`/vehicles/${editingVehicle.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        await request("/vehicles", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }

      setShowVehicleModal(false);
      setVehicleForm({ ...emptyVehicle });
      setEditingVehicle(null);

      await loadData();

      alert(
        editingVehicle
          ? "Araç bilgileri güncellendi."
          : "Araç başarıyla eklendi."
      );
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Araç aktif / pasif
  const toggleVehicleActive = async (vehicle) => {
    const confirmed = window.confirm(
      vehicle.active
        ? "Bu aracı pasif yapmak istediğinize emin misiniz?"
        : "Bu aracı aktif yapmak istediğinize emin misiniz?"
    );

    if (!confirmed) return;

    try {
      await request(`/vehicles/${vehicle.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({
          active: !vehicle.active,
        }),
      });

      await loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Personel formu
  const openNewPersonnel = () => {
    setPersonnelForm({ ...emptyPersonnel });
    setShowPersonnelModal(true);
  };

  const handlePersonnelFormChange = (event) => {
    const { name, value } = event.target;

    setPersonnelForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const savePersonnel = async (event) => {
    event.preventDefault();

    try {
      setSaving(true);

      await request("/admin/distributors", {
        method: "POST",
        body: JSON.stringify({
          name: personnelForm.name.trim(),
          email: personnelForm.email.trim(),
          password: personnelForm.password,
          phone: personnelForm.phone.trim(),
          role: personnelForm.role,
        }),
      });

      setShowPersonnelModal(false);
      setPersonnelForm({ ...emptyPersonnel });

      await loadData();

      alert("Personel başarıyla eklendi.");
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Personel aktif / pasif
  const togglePersonnelActive = async (person) => {
    const confirmed = window.confirm(
      person.active
        ? `${person.name} isimli personeli pasif yapmak istiyor musunuz?`
        : `${person.name} isimli personeli aktif yapmak istiyor musunuz?`
    );

    if (!confirmed) return;

    try {
      await request(`/admin/distributors/${person.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({
          active: !person.active,
        }),
      });

      await loadData();

      alert(
        person.active
          ? "Personel pasif hale getirildi."
          : "Personel aktif hale getirildi."
      );
    } catch (err) {
      alert(err.message);
    }
  };

  // Arama ve aktif/pasif filtreleri
  const filteredVehicles = vehicles.filter((vehicle) => {
    if (!showInactiveVehicles && !vehicle.active) {
      return false;
    }

    const search = vehicleSearch.toLocaleLowerCase("tr");

    return (
      (vehicle.plate || "").toLocaleLowerCase("tr").includes(search) ||
      (vehicle.brand || "").toLocaleLowerCase("tr").includes(search) ||
      (vehicle.model || "").toLocaleLowerCase("tr").includes(search)
    );
  });

  const filteredPersonnel = personnel.filter((person) => {
    if (!showInactivePersonnel && !person.active) {
      return false;
    }

    const search = personnelSearch.toLocaleLowerCase("tr");

    return (
      (person.name || "").toLocaleLowerCase("tr").includes(search) ||
      (person.email || "").toLocaleLowerCase("tr").includes(search) ||
      (person.phone || "").toLocaleLowerCase("tr").includes(search)
    );
  });

  // Özet sayıları
  const activeVehicleCount = vehicles.filter(
    (vehicle) => vehicle.active
  ).length;

  const passiveVehicleCount = vehicles.length - activeVehicleCount;

  const driverCount = personnel.filter(
    (person) => person.role === "DRIVER"
  ).length;

  const distributorCount = personnel.filter(
    (person) => person.role === "DISTRIBUTOR"
  ).length;

  const activePersonnelCount = personnel.filter(
    (person) => person.active
  ).length;

  const passivePersonnelCount =
    personnel.length - activePersonnelCount;

  if (loading) {
    return (
      <div className="fleet-loading">
        Araç ve personel bilgileri yükleniyor...
      </div>
    );
  }

  return (
    <div className="fleet-page">
      <div className="fleet-page-header">
        <div>
          <h1>Araç ve Personel Yönetimi</h1>
          <p>
            Dağıtım araçlarını ve sevkiyat personellerini buradan
            yönetebilirsiniz.
          </p>
        </div>
      </div>

      {error && (
        <div className="fleet-error">
          {error}
          <button type="button" onClick={loadData}>
            Tekrar Dene
          </button>
        </div>
      )}

      {/* Sekmeler */}
      <div className="fleet-tabs">
        <button
          type="button"
          className={activeTab === "vehicles" ? "active" : ""}
          onClick={() => setActiveTab("vehicles")}
        >
          Araçlar ({vehicles.length})
        </button>

        <button
          type="button"
          className={activeTab === "personnel" ? "active" : ""}
          onClick={() => setActiveTab("personnel")}
        >
          Personeller ({personnel.length})
        </button>
      </div>

      {/* ARAÇLAR */}
      {activeTab === "vehicles" && (
        <div className="fleet-content">
          <div className="fleet-summary">
            <div className="fleet-summary-card">
              <span>Toplam Araç</span>
              <strong>{vehicles.length}</strong>
            </div>

            <div className="fleet-summary-card">
              <span>Aktif Araç</span>
              <strong>{activeVehicleCount}</strong>
            </div>

            <div className="fleet-summary-card">
              <span>Pasif Araç</span>
              <strong>{passiveVehicleCount}</strong>
            </div>
          </div>

          <div className="fleet-toolbar">
            <input
              type="text"
              placeholder="Plaka, marka veya model ara..."
              value={vehicleSearch}
              onChange={(event) => setVehicleSearch(event.target.value)}
            />

            <button
              type="button"
              className="fleet-filter-button"
              onClick={() =>
                setShowInactiveVehicles((previous) => !previous)
              }
            >
              {showInactiveVehicles
                ? "Pasifleri Gizle"
                : "Pasifleri Göster"}
            </button>

            <button
              type="button"
              className="fleet-primary-button"
              onClick={openNewVehicle}
            >
              + Yeni Araç Ekle
            </button>
          </div>

          <div className="fleet-result-count">
            {filteredVehicles.length} araç listeleniyor
            {!showInactiveVehicles && passiveVehicleCount > 0 &&
              ` · ${passiveVehicleCount} pasif araç gizli`}
          </div>

          <div className="fleet-table-wrapper">
            <table className="fleet-table">
              <thead>
                <tr>
                  <th>Plaka</th>
                  <th>Marka / Model</th>
                  <th>Araç Tipi</th>
                  <th>Kapasite</th>
                  <th>Durum</th>
                  <th>İşlemler</th>
                </tr>
              </thead>

              <tbody>
                {filteredVehicles.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td>
                      <strong>{vehicle.plate}</strong>
                    </td>

                    <td>
                      {vehicle.brand || "-"} {vehicle.model || ""}
                    </td>

                    <td>{vehicle.vehicle_type || "-"}</td>

                    <td>
                      {vehicle.capacity
                        ? `${vehicle.capacity} ${vehicle.capacity_unit || ""}`
                        : "-"}
                    </td>

                    <td>
                      <span
                        className={`fleet-status ${
                          vehicle.active ? "active" : "passive"
                        }`}
                      >
                        {vehicle.active ? "Aktif" : "Pasif"}
                      </span>
                    </td>

                    <td>
                      <div className="fleet-actions">
                        <button
                          type="button"
                          className="fleet-button fleet-button-edit"
                          onClick={() => openEditVehicle(vehicle)}
                        >
                          Düzenle
                        </button>

                        <button
                          type="button"
                          className={`fleet-button ${
                            vehicle.active
                              ? "fleet-button-danger"
                              : "fleet-button-success"
                          }`}
                          onClick={() => toggleVehicleActive(vehicle)}
                        >
                          {vehicle.active ? "Pasif Yap" : "Aktif Yap"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredVehicles.length === 0 && (
                  <tr>
                    <td colSpan="6" className="fleet-empty">
                      {vehicles.length === 0
                        ? "Henüz araç eklenmemiş."
                        : "Arama kriterlerine uygun araç bulunamadı."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PERSONELLER */}
      {activeTab === "personnel" && (
        <div className="fleet-content">
          <div className="fleet-summary">
            <div className="fleet-summary-card">
              <span>Toplam Personel</span>
              <strong>{personnel.length}</strong>
            </div>

            <div className="fleet-summary-card">
              <span>Sürücü</span>
              <strong>{driverCount}</strong>
            </div>

            <div className="fleet-summary-card">
              <span>Dağıtım Personeli</span>
              <strong>{distributorCount}</strong>
            </div>

            <div className="fleet-summary-card">
              <span>Aktif Personel</span>
              <strong>{activePersonnelCount}</strong>
            </div>

            <div className="fleet-summary-card">
              <span>Pasif Personel</span>
              <strong>{passivePersonnelCount}</strong>
            </div>
          </div>

          <div className="fleet-toolbar">
            <input
              type="text"
              placeholder="Ad, e-posta veya telefon ara..."
              value={personnelSearch}
              onChange={(event) => setPersonnelSearch(event.target.value)}
            />

            <button
              type="button"
              className="fleet-filter-button"
              onClick={() =>
                setShowInactivePersonnel((previous) => !previous)
              }
            >
              {showInactivePersonnel
                ? "Pasifleri Gizle"
                : "Pasifleri Göster"}
            </button>

            <button
              type="button"
              className="fleet-primary-button"
              onClick={openNewPersonnel}
            >
              + Yeni Personel Ekle
            </button>
          </div>

          <div className="fleet-result-count">
            {filteredPersonnel.length} personel listeleniyor
            {!showInactivePersonnel && passivePersonnelCount > 0 &&
              ` · ${passivePersonnelCount} pasif personel gizli`}
          </div>

          <div className="fleet-table-wrapper">
            <table className="fleet-table">
              <thead>
                <tr>
                  <th>Ad Soyad</th>
                  <th>E-posta</th>
                  <th>Telefon</th>
                  <th>Görev</th>
                  <th>Durum</th>
                  <th>İşlemler</th>
                </tr>
              </thead>

              <tbody>
                {filteredPersonnel.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <strong>{person.name}</strong>
                    </td>

                    <td>{person.email}</td>
                    <td>{person.phone || "-"}</td>

                    <td>
                      {person.role === "DRIVER"
                        ? "Sürücü"
                        : "Dağıtım Personeli"}
                    </td>

                    <td>
                      <span
                        className={`fleet-status ${
                          person.active ? "active" : "passive"
                        }`}
                      >
                        {person.active ? "Aktif" : "Pasif"}
                      </span>
                    </td>

                    <td>
                      <button
                        type="button"
                        className={`fleet-button ${
                          person.active
                            ? "fleet-button-danger"
                            : "fleet-button-success"
                        }`}
                        onClick={() => togglePersonnelActive(person)}
                      >
                        {person.active ? "Pasif Yap" : "Aktif Yap"}
                      </button>
                    </td>
                  </tr>
                ))}

                {filteredPersonnel.length === 0 && (
                  <tr>
                    <td colSpan="6" className="fleet-empty">
                      {personnel.length === 0
                        ? "Henüz personel eklenmemiş."
                        : "Arama kriterlerine uygun personel bulunamadı."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ARAÇ EKLE / DÜZENLE MODALI */}
      {showVehicleModal && (
        <div
          className="fleet-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowVehicleModal(false);
            }
          }}
        >
          <div className="fleet-modal">
            <button
              type="button"
              className="fleet-modal-close"
              onClick={() => setShowVehicleModal(false)}
            >
              ×
            </button>

            <h2>
              {editingVehicle ? "Araç Düzenle" : "Yeni Araç Ekle"}
            </h2>

            <form onSubmit={saveVehicle}>
              <label>
                Plaka *
                <input
                  name="plate"
                  value={vehicleForm.plate}
                  onChange={handleVehicleFormChange}
                  required
                  placeholder="Örn: 58 ABC 123"
                />
              </label>

              <label>
                Marka
                <input
                  name="brand"
                  value={vehicleForm.brand}
                  onChange={handleVehicleFormChange}
                  placeholder="Örn: Ford"
                />
              </label>

              <label>
                Model
                <input
                  name="model"
                  value={vehicleForm.model}
                  onChange={handleVehicleFormChange}
                  placeholder="Örn: Transit"
                />
              </label>

              <label>
                Araç Tipi
                <input
                  name="vehicle_type"
                  value={vehicleForm.vehicle_type}
                  onChange={handleVehicleFormChange}
                  placeholder="Örn: Kamyonet"
                />
              </label>

              <div className="fleet-form-row">
                <label>
                  Kapasite
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    name="capacity"
                    value={vehicleForm.capacity}
                    onChange={handleVehicleFormChange}
                  />
                </label>

                <label>
                  Birim
                  <select
                    name="capacity_unit"
                    value={vehicleForm.capacity_unit}
                    onChange={handleVehicleFormChange}
                  >
                    <option value="kg">kg</option>
                    <option value="ton">ton</option>
                    <option value="palet">palet</option>
                    <option value="m3">m³</option>
                  </select>
                </label>
              </div>

              <label>
                Açıklama
                <textarea
                  name="notes"
                  value={vehicleForm.notes}
                  onChange={handleVehicleFormChange}
                  rows="3"
                />
              </label>

              <div className="fleet-modal-actions">
                <button
                  type="button"
                  className="fleet-button fleet-button-cancel"
                  onClick={() => setShowVehicleModal(false)}
                >
                  Vazgeç
                </button>

                <button
                  type="submit"
                  className="fleet-primary-button"
                  disabled={saving}
                >
                  {saving ? "Kaydediliyor..." : "Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PERSONEL EKLE MODALI */}
      {showPersonnelModal && (
        <div
          className="fleet-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowPersonnelModal(false);
            }
          }}
        >
          <div className="fleet-modal">
            <button
              type="button"
              className="fleet-modal-close"
              onClick={() => setShowPersonnelModal(false)}
            >
              ×
            </button>

            <h2>Yeni Personel Ekle</h2>

            <form onSubmit={savePersonnel}>
              <label>
                Ad Soyad *
                <input
                  name="name"
                  value={personnelForm.name}
                  onChange={handlePersonnelFormChange}
                  required
                  placeholder="Personelin adı soyadı"
                />
              </label>

              <label>
                E-posta *
                <input
                  type="email"
                  name="email"
                  value={personnelForm.email}
                  onChange={handlePersonnelFormChange}
                  required
                  placeholder="ornek@mail.com"
                />
              </label>

              <label>
                Şifre *
                <input
                  type="password"
                  name="password"
                  value={personnelForm.password}
                  onChange={handlePersonnelFormChange}
                  required
                  minLength="8"
                  placeholder="En az 8 karakter"
                />
              </label>

              <label>
                Telefon
                <input
                  name="phone"
                  value={personnelForm.phone}
                  onChange={handlePersonnelFormChange}
                  placeholder="05XX XXX XX XX"
                />
              </label>

              <label>
                Personel Görevi *
                <select
                  name="role"
                  value={personnelForm.role}
                  onChange={handlePersonnelFormChange}
                >
                  <option value="DRIVER">Sürücü</option>
                  <option value="DISTRIBUTOR">Dağıtım Personeli</option>
                </select>
              </label>

              <div className="fleet-modal-actions">
                <button
                  type="button"
                  className="fleet-button fleet-button-cancel"
                  onClick={() => setShowPersonnelModal(false)}
                >
                  Vazgeç
                </button>

                <button
                  type="submit"
                  className="fleet-primary-button"
                  disabled={saving}
                >
                  {saving ? "Kaydediliyor..." : "Personel Ekle"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminFleetPage;
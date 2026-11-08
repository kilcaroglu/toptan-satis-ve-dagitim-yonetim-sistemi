
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNotification } from "../../context/NotificationContext";
import "./AdminOrdersPage.css";

const API_URL = "http://localhost:4000";

const statusLabels = {
  PENDING: "Onay Bekliyor",
  APPROVED: "Onaylandı",
  PREPARING: "Hazırlanıyor",
  ON_THE_WAY: "Yola Çıktı",
  DELIVERED: "Teslim Edildi",
  CANCELLED: "İptal Edildi",
};

const statusTransitions = {
  PENDING: ["APPROVED", "CANCELLED"],
  APPROVED: ["PREPARING", "CANCELLED"],
  PREPARING: ["ON_THE_WAY", "CANCELLED"],
  ON_THE_WAY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

const money = (value) =>
  Number(value || 0).toLocaleString("tr-TR", {
    style: "currency",
    currency: "TRY",
  });

function dateKey(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekStart(value) {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function formatWeekRange(start) {
  const end = addDays(start, 6);
  const options = { day: "numeric", month: "long" };
  return `${start.toLocaleDateString("tr-TR", options)} – ${end.toLocaleDateString("tr-TR", { ...options, year: "numeric" })}`;
}

function getDayLabel(date) {
  return date.toLocaleDateString("tr-TR", { weekday: "short" });
}

function dateText(value) {
  if (!value) return "-";

  const date = new Date(`${dateKey(value)}T12:00:00`);
  return date.toLocaleDateString("tr-TR");
}

function dateTimeText(value) {
  if (!value) return "-";

  return new Date(value).toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function getArray(data, key) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  return [];
}

function getRouteId(shipment) {
  return shipment.route_id ?? shipment.route?.id ?? null;
}

function routeContainsDistrict(route, districtId) {
  if (!route || !districtId) return false;

  const districts = Array.isArray(route.districts)
    ? route.districts
    : [];

  return districts.some(
    (district) =>
      Number(district.id ?? district.district_id) === Number(districtId)
  );
}

export default function AdminOrdersPage({ session }) {
  const { askConfirm } = useNotification();

  const token = session?.token;

  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [routes, setRoutes] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [selectedDay, setSelectedDay] = useState(() =>
    localDateKey(new Date())
  );

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [quantityValues, setQuantityValues] = useState({});
  const [addingProduct, setAddingProduct] = useState(false);
  const [newProductId, setNewProductId] = useState("");
  const [newProductQuantity, setNewProductQuantity] = useState("1");

  const [createOpen, setCreateOpen] = useState(false);
  const [createCustomerId, setCreateCustomerId] = useState("");
  const [createShipmentId, setCreateShipmentId] = useState("");
  const [createItems, setCreateItems] = useState([]);
  const [createProductId, setCreateProductId] = useState("");
  const [createQuantity, setCreateQuantity] = useState("1");

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  const request = useCallback(
    async (url, options = {}) => {
      const response = await fetch(`${API_URL}${url}`, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers || {}),
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "İşlem gerçekleştirilemedi.");
      }

      return data;
    },
    [token]
  );

  const loadData = useCallback(async () => {
    if (!token) {
      setError("Oturum bilgisi bulunamadı. Lütfen tekrar giriş yapın.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [
        ordersData,
        customersData,
        productsData,
        shipmentsData,
        routesData,
      ] = await Promise.all([
        request("/orders"),
        request("/customers"),
        request("/products"),
        request("/shipments"),
        request("/routes"),
      ]);

      setOrders(getArray(ordersData, "orders"));
      setCustomers(getArray(customersData, "customers"));
      setProducts(getArray(productsData, "products"));
      setShipments(getArray(shipmentsData, "shipments"));
      setRoutes(getArray(routesData, "routes"));
    } catch (err) {
      setError(err.message || "Sipariş verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [request, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart]
  );

  const weekOrders = useMemo(() => {
    const startKey = localDateKey(weekStart);
    const endKey = localDateKey(addDays(weekStart, 6));

    return orders.filter((order) => {
      const key = dateKey(order.shipment_date);
      return key >= startKey && key <= endKey;
    });
  }, [orders, weekStart]);

  const filteredOrders = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase("tr-TR");

    return [...orders]
      .filter((order) => {
        const matchesDay = dateKey(order.shipment_date) === selectedDay;

        const matchesSearch =
          !searchText ||
          String(order.id).includes(searchText) ||
          String(order.company_name || "")
            .toLocaleLowerCase("tr-TR")
            .includes(searchText) ||
          String(order.route_name || "")
            .toLocaleLowerCase("tr-TR")
            .includes(searchText);

        const matchesStatus =
          statusFilter === "all" || order.status === statusFilter;

        const matchesSource =
          sourceFilter === "all" ||
          (sourceFilter === "ADMIN" && order.order_source === "ADMIN") ||
          (sourceFilter === "CUSTOMER" &&
            (order.order_source || "CUSTOMER") === "CUSTOMER");

        return (
          matchesDay &&
          matchesSearch &&
          matchesStatus &&
          matchesSource
        );
      })
      .sort((a, b) => {
        const dateCompare = String(b.created_at || "").localeCompare(
          String(a.created_at || "")
        );

        return dateCompare || Number(b.id) - Number(a.id);
      });
  }, [orders, selectedDay, search, statusFilter, sourceFilter]);

  const routeGroups = useMemo(() => {
    const groups = new Map();

    filteredOrders.forEach((order) => {
      const routeName = order.route_name || "Rota Atanmamış";

      if (!groups.has(routeName)) groups.set(routeName, []);

      groups.get(routeName).push(order);
    });

    return [...groups.entries()]
      .map(([routeName, routeOrders]) => ({
        routeName,
        orders: routeOrders,
      }))
      .sort((a, b) => a.routeName.localeCompare(b.routeName, "tr"));
  }, [filteredOrders]);

  function changeWeek(offset) {
    const nextWeek = addDays(weekStart, offset * 7);
    setWeekStart(nextWeek);
    setSelectedDay(localDateKey(nextWeek));
  }

  const totalAmount = useMemo(
    () =>
      orders.reduce(
        (sum, order) => sum + Number(order.total_amount || 0),
        0
      ),
    [orders]
  );

  const pendingCount = orders.filter(
    (order) => order.status === "PENDING"
  ).length;

  const deliveredCount = orders.filter(
    (order) => order.status === "DELIVERED"
  ).length;

  const activeProducts = products.filter((product) => product.active);

  const selectedCustomer = customers.find(
    (customer) => Number(customer.id) === Number(createCustomerId)
  );

  const availableShipments = useMemo(() => {
    if (!selectedCustomer) return [];

    return shipments
      .filter((shipment) => {
        if (shipment.status !== "PLANNED") return false;

        const routeId = getRouteId(shipment);
        const route = routes.find(
          (item) => Number(item.id) === Number(routeId)
        );

        return routeContainsDistrict(route, selectedCustomer.district_id);
      })
      .sort((a, b) =>
        dateKey(a.shipment_date).localeCompare(dateKey(b.shipment_date))
      );
  }, [shipments, routes, selectedCustomer]);

  async function refreshOrderItems(orderId) {
    setItemsLoading(true);

    try {
      const data = await request(`/orders/${orderId}/items`);
      const items = getArray(data, "items");

      setOrderItems(items);
      setQuantityValues(
        Object.fromEntries(
          items.map((item) => [item.id, String(item.quantity)])
        )
      );
    } catch (err) {
      setError(err.message || "Sipariş ürünleri getirilemedi.");
    } finally {
      setItemsLoading(false);
    }
  }

  async function openDetails(order) {
    setSelectedOrder(order);
    setDetailOpen(true);
    setOrderItems([]);
    setQuantityValues({});
    setMessage("");
    setError("");

    await refreshOrderItems(order.id);
  }

  function closeDetails() {
    if (saving) return;

    setDetailOpen(false);
    setSelectedOrder(null);
    setOrderItems([]);
    setQuantityValues({});
    setAddingProduct(false);
    setNewProductId("");
    setNewProductQuantity("1");
  }

  async function changeStatus(order, nextStatus) {
    const label = statusLabels[nextStatus];

    const confirmed = await askConfirm({
      title: "Sipariş durumunu değiştir",
      message: `#${order.id} numaralı siparişin durumunu "${label}" yapmak istiyor musunuz?`,
      confirmText: "Durumu Değiştir",
      danger: nextStatus === "CANCELLED",
    });

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await request(`/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      setMessage(`Sipariş durumu "${label}" olarak güncellendi.`);
      await loadData();

      if (selectedOrder?.id === order.id) {
        setSelectedOrder({ ...order, status: nextStatus });
      }
    } catch (err) {
      setError(err.message || "Sipariş durumu değiştirilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function changeRouteOrdersStatus(routeOrders, nextStatus) {
    const eligibleOrders = routeOrders.filter((order) =>
      (statusTransitions[order.status] || []).includes(nextStatus)
    );

    if (!eligibleOrders.length) return;

    const label = statusLabels[nextStatus];
    const routeName = routeOrders[0]?.route_name || "Rota Atanmamış";
    const excludedCount = routeOrders.length - eligibleOrders.length;

    const detail = excludedCount
      ? `\n\nDurumu uygun olmadığı için ${excludedCount} sipariş değiştirilmeyecek.`
      : "";

    const confirmed = await askConfirm({
      title: "Toplu sipariş durumu değişikliği",
      message: `${routeName} rotasındaki ${eligibleOrders.length} siparişin durumunu "${label}" yapmak istiyor musunuz?${detail}`,
      confirmText: "Siparişleri Güncelle",
      danger: nextStatus === "CANCELLED",
    });

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");

    let successCount = 0;
    const failedOrders = [];

    try {
      for (const order of eligibleOrders) {
        try {
          await request(`/orders/${order.id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: nextStatus }),
          });

          successCount += 1;
        } catch (err) {
          failedOrders.push(`#${order.id}: ${err.message}`);
        }
      }

      await loadData();

      if (failedOrders.length) {
        setError(
          `${successCount} sipariş güncellendi. Güncellenemeyenler: ${failedOrders.join("; ")}`
        );
      } else {
        setMessage(
          `${routeName} rotasındaki ${successCount} sipariş "${label}" durumuna alındı.`
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function updateItemQuantity(item) {
    const quantity = Number(quantityValues[item.id]);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Ürün miktarı sıfırdan büyük olmalıdır.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await request(
        `/orders/${selectedOrder.id}/items/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity }),
        }
      );

      setMessage("Ürün miktarı güncellendi.");
      await refreshOrderItems(selectedOrder.id);
      await loadData();
    } catch (err) {
      setError(err.message || "Ürün miktarı güncellenemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrderItem(item) {
    const confirmed = await askConfirm({
      title: "Siparişten ürün sil",
      message: `"${item.product_name}" ürününü siparişten silmek istiyor musunuz?`,
      confirmText: "Ürünü Sil",
      danger: true,
    });

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await request(
        `/orders/${selectedOrder.id}/items/${item.id}`,
        { method: "DELETE" }
      );

      setMessage("Ürün siparişten silindi.");
      await refreshOrderItems(selectedOrder.id);
      await loadData();
    } catch (err) {
      setError(err.message || "Ürün silinemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function addProductToExistingOrder(event) {
    event.preventDefault();

    const productId = Number(newProductId);
    const quantity = Number(newProductQuantity);

    if (
      !Number.isInteger(productId) ||
      productId <= 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      setError("Ürün ve miktar bilgilerini kontrol edin.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await request(`/orders/${selectedOrder.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          quantity,
        }),
      });

      setMessage("Ürün siparişe eklendi.");
      setNewProductId("");
      setNewProductQuantity("1");
      setAddingProduct(false);

      await refreshOrderItems(selectedOrder.id);
      await loadData();
    } catch (err) {
      setError(err.message || "Ürün eklenemedi.");
    } finally {
      setSaving(false);
    }
  }

  function openCreateModal() {
    setCreateCustomerId("");
    setCreateShipmentId("");
    setCreateItems([]);
    setCreateProductId("");
    setCreateQuantity("1");
    setMessage("");
    setError("");
    setCreateOpen(true);
  }

  function closeCreateModal() {
    if (saving) return;

    setCreateOpen(false);
    setCreateCustomerId("");
    setCreateShipmentId("");
    setCreateItems([]);
  }

  function addProductToNewOrder() {
    const productId = Number(createProductId);
    const quantity = Number(createQuantity);

    if (
      !Number.isInteger(productId) ||
      productId <= 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      setError("Ürün ve miktar bilgilerini kontrol edin.");
      return;
    }

    const product = activeProducts.find(
      (item) => Number(item.id) === productId
    );

    if (!product) {
      setError("Seçilen ürün bulunamadı veya pasif.");
      return;
    }

    setCreateItems((previous) => {
      const existing = previous.find(
        (item) => Number(item.product_id) === productId
      );

      if (existing) {
        return previous.map((item) =>
          Number(item.product_id) === productId
            ? { ...item, quantity: Number(item.quantity) + quantity }
            : item
        );
      }

      return [
        ...previous,
        {
          product_id: productId,
          product_name: product.name,
          min_unit_label: product.min_unit_label,
          quantity,
          unit_price: Number(product.price),
        },
      ];
    });

    setCreateProductId("");
    setCreateQuantity("1");
    setError("");
  }

  function changeNewOrderQuantity(productId, value) {
    setCreateItems((previous) =>
      previous.map((item) =>
        Number(item.product_id) === Number(productId)
          ? { ...item, quantity: value }
          : item
      )
    );
  }

  function removeNewOrderItem(productId) {
    setCreateItems((previous) =>
      previous.filter(
        (item) => Number(item.product_id) !== Number(productId)
      )
    );
  }

  const createTotal = createItems.reduce(
    (sum, item) =>
      sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
    0
  );

  async function submitNewOrder(event) {
    event.preventDefault();

    if (!createCustomerId || !createShipmentId || createItems.length === 0) {
      setError("Müşteri, sevkiyat ve en az bir ürün seçmelisiniz.");
      return;
    }

    const invalidItem = createItems.some(
      (item) =>
        !Number.isFinite(Number(item.quantity)) ||
        Number(item.quantity) <= 0
    );

    if (invalidItem) {
      setError("Ürün miktarları sıfırdan büyük olmalıdır.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await request("/orders/admin-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: Number(createCustomerId),
          shipment_id: Number(createShipmentId),
          items: createItems.map((item) => ({
            product_id: Number(item.product_id),
            quantity: Number(item.quantity),
          })),
        }),
      });

      setCreateOpen(false);
      setMessage("Müşteri adına sipariş başarıyla oluşturuldu.");
      await loadData();
    } catch (err) {
      setError(err.message || "Sipariş oluşturulamadı.");
    } finally {
      setSaving(false);
    }
  }

  const selectedOrderTotal = orderItems.reduce(
    (sum, item) =>
      sum + Number(item.quantity) * Number(item.unit_price),
    0
  );

  const canEditSelectedOrder =
    selectedOrder &&
    !["DELIVERED", "CANCELLED"].includes(selectedOrder.status);

  return (
    <div className="admin-orders">
      <div className="orders-heading">
        <div>
          <h2>Sipariş Yönetimi</h2>
          <p>Müşteri siparişlerini, ürünleri ve teslimat durumlarını yönetin.</p>
        </div>

        <div className="orders-heading-actions">
          <button
            type="button"
            className="orders-refresh-button"
            onClick={loadData}
            disabled={loading}
          >
            Yenile
          </button>

          <button
            type="button"
            className="orders-add-button"
            onClick={openCreateModal}
          >
            + Müşteri Adına Sipariş
          </button>
        </div>
      </div>

      <div className="orders-summary">
        <div>
          <span>Toplam Sipariş</span>
          <strong>{orders.length}</strong>
        </div>

        <div>
          <span>Onay Bekleyen</span>
          <strong>{pendingCount}</strong>
        </div>

        <div>
          <span>Teslim Edilen</span>
          <strong>{deliveredCount}</strong>
        </div>

        <div>
          <span>Sipariş Toplamı</span>
          <strong>{money(totalAmount)}</strong>
        </div>
      </div>

      {message && <div className="orders-success">{message}</div>}
      {error && <div className="orders-error">{error}</div>}

      <div className="orders-week-navigation">
        <button type="button" onClick={() => changeWeek(-1)} aria-label="Önceki hafta">‹</button>
        <div className="orders-week-title">
          <span>HAFTALIK SİPARİŞ TAKVİMİ</span>
          <strong>{formatWeekRange(weekStart)}</strong>
          <small>{weekOrders.length} sipariş bu hafta</small>
        </div>
        <button type="button" onClick={() => changeWeek(1)} aria-label="Sonraki hafta">›</button>
        <button
          type="button"
          className="orders-current-week-button"
          onClick={() => {
            const currentWeek = getWeekStart(new Date());
            setWeekStart(currentWeek);
            setSelectedDay(localDateKey(new Date()));
          }}
        >
          Bu Hafta
        </button>
      </div>

      <div className="orders-day-tabs">
        {weekDays.map((day) => {
          const key = localDateKey(day);
          const count = weekOrders.filter(
            (order) => dateKey(order.shipment_date) === key
          ).length;

          return (
            <button
              type="button"
              key={key}
              className={selectedDay === key ? "active" : ""}
              onClick={() => setSelectedDay(key)}
            >
              <span>{getDayLabel(day)}</span>
              <strong>{day.getDate()}</strong>
              <small>{count} sipariş</small>
            </button>
          );
        })}
      </div>

      <div className="orders-selected-day-heading">
        <div>
          <h3>
            {new Date(`${selectedDay}T12:00:00`).toLocaleDateString("tr-TR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h3>
          <p>Siparişler teslimat rotalarına göre gruplandırılmıştır.</p>
        </div>
        <span>{filteredOrders.length} sipariş · {routeGroups.length} rota</span>
      </div>

      <div className="orders-filters">
        <input
          type="search"
          placeholder="Sipariş no, müşteri veya rota ara..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">Tüm durumlar</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
        >
          <option value="all">Tüm sipariş kaynakları</option>
          <option value="CUSTOMER">Müşteri siparişleri</option>
          <option value="ADMIN">Admin siparişleri</option>
        </select>

        <button
          type="button"
          className="orders-clear-button"
          onClick={() => {
            setSearch("");
            setStatusFilter("all");
            setSourceFilter("all");
          }}
        >
          Filtreleri Temizle
        </button>
      </div>

      {loading ? (
        <div className="orders-empty">Siparişler yükleniyor...</div>
      ) : filteredOrders.length === 0 ? (
        <div className="orders-empty">
          Seçilen gün ve filtreler için sipariş bulunamadı.
        </div>
      ) : (
        <div className="orders-route-list">
          {routeGroups.map((group) => {
            const routeTotal = group.orders.reduce(
              (sum, order) => sum + Number(order.total_amount || 0),
              0
            );

            const actionCounts = {};

            group.orders.forEach((order) => {
              (statusTransitions[order.status] || []).forEach((target) => {
                if (target !== "CANCELLED") {
                  actionCounts[target] = (actionCounts[target] || 0) + 1;
                }
              });
            });

            return (
              <section className="orders-route-card" key={group.routeName}>
                <div className="orders-route-card-heading">
                  <div>
                    <span className="orders-route-eyebrow">TESLİMAT ROTASI</span>
                    <h3>{group.routeName}</h3>
                  </div>

                  <div className="orders-route-totals">
                    <strong>{group.orders.length} sipariş</strong>
                    <span>{money(routeTotal)}</span>
                  </div>
                </div>

                {Object.keys(actionCounts).length > 0 && (
                  <div className="orders-route-bulk-actions">
                    <span>Toplu durum işlemi:</span>
                    {Object.entries(actionCounts).map(([target, count]) => (
                      <button
                        type="button"
                        key={target}
                        disabled={saving}
                        onClick={() =>
                          changeRouteOrdersStatus(group.orders, target)
                        }
                      >
                        {target === "APPROVED"
                          ? "Onayla"
                          : statusLabels[target]} ({count})
                      </button>
                    ))}
                  </div>
                )}

                <div className="orders-table-wrapper">
                  <table className="orders-table orders-route-table">
                    <thead>
                      <tr>
                        <th>Sipariş No</th>
                        <th>Müşteri</th>
                        <th>Oluşturulma</th>
                        <th>Kaynak</th>
                        <th>Tutar</th>
                        <th>Durum</th>
                        <th>İşlemler</th>
                      </tr>
                    </thead>

                    <tbody>
                      {group.orders.map((order) => (
                        <tr key={order.id}>
                          <td><strong>#{order.id}</strong></td>
                          <td>
                            <strong>{order.company_name || "-"}</strong>
                            {order.contact_name && (
                              <small className="orders-subtext">
                                {order.contact_name}
                              </small>
                            )}
                          </td>
                          <td>{dateTimeText(order.created_at)}</td>
                          <td>
                            <span
                              className={`orders-source ${
                                order.order_source === "ADMIN"
                                  ? "admin"
                                  : "customer"
                              }`}
                            >
                              {order.order_source === "ADMIN"
                                ? "Admin"
                                : "Müşteri"}
                            </span>
                          </td>
                          <td><strong>{money(order.total_amount)}</strong></td>
                          <td>
                            <span
                              className={`orders-status ${String(
                                order.status || ""
                              ).toLowerCase()}`}
                            >
                              {statusLabels[order.status] || order.status}
                            </span>
                          </td>
                          <td>
                            <div className="orders-row-actions">
                              <button
                                type="button"
                                onClick={() => openDetails(order)}
                              >
                                Detay
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* SİPARİŞ DETAYI */}
      {detailOpen && selectedOrder && (
        <div className="orders-modal-backdrop">
          <div className="orders-modal orders-detail-modal">
            <button
              type="button"
              className="orders-modal-close"
              onClick={closeDetails}
              disabled={saving}
            >
              ×
            </button>

            <div className="orders-modal-heading">
              <div>
                <h2>Sipariş #{selectedOrder.id}</h2>
                <p>{selectedOrder.company_name}</p>
              </div>

              <span
                className={`orders-status ${String(
                  selectedOrder.status || ""
                ).toLowerCase()}`}
              >
                {statusLabels[selectedOrder.status]}
              </span>
            </div>

            <div className="orders-detail-summary">
              <div>
                <span>Rota</span>
                <strong>{selectedOrder.route_name || "-"}</strong>
              </div>
              <div>
                <span>Sevkiyat tarihi</span>
                <strong>{dateText(selectedOrder.shipment_date)}</strong>
              </div>
              <div>
                <span>Sipariş kaynağı</span>
                <strong>
                  {selectedOrder.order_source === "ADMIN"
                    ? "Admin tarafından oluşturuldu"
                    : "Müşteri tarafından oluşturuldu"}
                </strong>
              </div>
              <div>
                <span>Oluşturulma zamanı</span>
                <strong>{dateTimeText(selectedOrder.created_at)}</strong>
              </div>
            </div>

            <div className="orders-detail-section-heading">
              <h3>Sipariş Ürünleri</h3>

              {canEditSelectedOrder && (
                <button
                  type="button"
                  className="orders-add-small-button"
                  onClick={() => setAddingProduct((value) => !value)}
                >
                  {addingProduct
                    ? "Ürün Ekleme Alanını Kapat"
                    : "+ Ürün Ekle"}
                </button>
              )}
            </div>

            {addingProduct && canEditSelectedOrder && (
              <form
                className="orders-add-product-form"
                onSubmit={addProductToExistingOrder}
              >
                <select
                  value={newProductId}
                  onChange={(event) => setNewProductId(event.target.value)}
                  required
                >
                  <option value="">Ürün seçin</option>
                  {activeProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} - {money(product.price)}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={newProductQuantity}
                  onChange={(event) =>
                    setNewProductQuantity(event.target.value)
                  }
                  placeholder="Miktar"
                  required
                />

                <button type="submit" disabled={saving}>
                  {saving ? "Ekleniyor..." : "Ekle"}
                </button>
              </form>
            )}

            {itemsLoading ? (
              <div className="orders-empty">Ürünler yükleniyor...</div>
            ) : orderItems.length === 0 ? (
              <div className="orders-empty">
                Bu siparişte ürün bulunmuyor.
              </div>
            ) : (
              <div className="orders-table-wrapper orders-detail-table-wrapper">
                <table className="orders-table orders-detail-table">
                  <thead>
                    <tr>
                      <th>Ürün</th>
                      <th>Birim</th>
                      <th>Birim Fiyat</th>
                      <th>Miktar</th>
                      <th>Toplam</th>
                      {canEditSelectedOrder && <th>İşlemler</th>}
                    </tr>
                  </thead>

                  <tbody>
                    {orderItems.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.product_name}</strong>
                        </td>
                        <td>{item.min_unit_label || "-"}</td>
                        <td>{money(item.unit_price)}</td>
                        <td>
                          {canEditSelectedOrder ? (
                            <input
                              className="orders-quantity-input"
                              type="number"
                              min="0.001"
                              step="any"
                              value={quantityValues[item.id] ?? item.quantity}
                              onChange={(event) =>
                                setQuantityValues((previous) => ({
                                  ...previous,
                                  [item.id]: event.target.value,
                                }))
                              }
                            />
                          ) : (
                            item.quantity
                          )}
                        </td>
                        <td>
                          {money(
                            Number(item.quantity) * Number(item.unit_price)
                          )}
                        </td>

                        {canEditSelectedOrder && (
                          <td>
                            <div className="orders-row-actions">
                              <button
                                type="button"
                                onClick={() => updateItemQuantity(item)}
                                disabled={saving}
                              >
                                Kaydet
                              </button>
                              <button
                                type="button"
                                className="orders-delete-button"
                                onClick={() => deleteOrderItem(item)}
                                disabled={saving}
                              >
                                Sil
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="orders-detail-total">
              <span>Sipariş Toplamı</span>
              <strong>{money(selectedOrderTotal)}</strong>
            </div>

            <div className="orders-status-management">
              <h3>Sipariş Durumu</h3>

              <div className="orders-status-actions">
                {(statusTransitions[selectedOrder.status] || []).map(
                  (nextStatus) => (
                    <button
                      type="button"
                      key={nextStatus}
                      className={
                        nextStatus === "CANCELLED"
                          ? "orders-cancel-status-button"
                          : "orders-next-status-button"
                      }
                      onClick={() => changeStatus(selectedOrder, nextStatus)}
                      disabled={saving}
                    >
                      {saving ? "İşleniyor..." : statusLabels[nextStatus]}
                    </button>
                  )
                )}
              </div>

              {statusTransitions[selectedOrder.status]?.length === 0 && (
                <p className="orders-locked-note">
                  Bu siparişin durumu artık değiştirilemez.
                </p>
              )}
            </div>

            <div className="orders-modal-footer">
              <button
                type="button"
                className="orders-clear-button"
                onClick={closeDetails}
                disabled={saving}
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADMİN MÜŞTERİ ADINA SİPARİŞ OLUŞTURMA */}
      {createOpen && (
        <div className="orders-modal-backdrop">
          <form
            className="orders-modal orders-create-modal"
            onSubmit={submitNewOrder}
          >
            <button
              type="button"
              className="orders-modal-close"
              onClick={closeCreateModal}
              disabled={saving}
            >
              ×
            </button>

            <h2>Müşteri Adına Sipariş Oluştur</h2>
            <p className="orders-modal-description">
              Bu sipariş admin tarafından oluşturulacak. Sipariş son saati
              geçmiş olsa da planlanmış ve müşterinin ilçesine uygun sevkiyat
              seçilebilir.
            </p>

            <label htmlFor="order-customer">Müşteri</label>
            <select
              id="order-customer"
              value={createCustomerId}
              onChange={(event) => {
                setCreateCustomerId(event.target.value);
                setCreateShipmentId("");
              }}
              required
            >
              <option value="">Müşteri seçin</option>
              {customers
                .filter((customer) => customer.active)
                .map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.company_name}
                  </option>
                ))}
            </select>

            <label htmlFor="order-shipment">Sevkiyat</label>
            <select
              id="order-shipment"
              value={createShipmentId}
              onChange={(event) => setCreateShipmentId(event.target.value)}
              disabled={!createCustomerId}
              required
            >
              <option value="">
                {!createCustomerId
                  ? "Önce müşteri seçin"
                  : availableShipments.length
                    ? "Sevkiyat seçin"
                    : "Uygun planlanmış sevkiyat bulunamadı"}
              </option>

              {availableShipments.map((shipment) => (
                <option key={shipment.id} value={shipment.id}>
                  #{shipment.id} - {shipment.route_name || "Sevkiyat"} -{" "}
                  {dateText(shipment.shipment_date)}
                </option>
              ))}
            </select>

            <div className="orders-create-product-heading">
              <h3>Ürün Ekle</h3>
            </div>

            <div className="orders-add-product-form">
              <select
                value={createProductId}
                onChange={(event) => setCreateProductId(event.target.value)}
              >
                <option value="">Ürün seçin</option>
                {activeProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} - {money(product.price)}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min="0.001"
                step="any"
                value={createQuantity}
                onChange={(event) => setCreateQuantity(event.target.value)}
                placeholder="Miktar"
              />

              <button type="button" onClick={addProductToNewOrder}>
                Ekle
              </button>
            </div>

            {createItems.length === 0 ? (
              <div className="orders-empty">
                Henüz siparişe ürün eklenmedi.
              </div>
            ) : (
              <div className="orders-create-items">
                {createItems.map((item) => (
                  <div
                    className="orders-create-item"
                    key={item.product_id}
                  >
                    <div>
                      <strong>{item.product_name}</strong>
                      <small>
                        {money(item.unit_price)} / {item.min_unit_label}
                      </small>
                    </div>

                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      value={item.quantity}
                      onChange={(event) =>
                        changeNewOrderQuantity(
                          item.product_id,
                          event.target.value
                        )
                      }
                    />

                    <strong>
                      {money(
                        Number(item.quantity) * Number(item.unit_price)
                      )}
                    </strong>

                    <button
                      type="button"
                      className="orders-delete-button"
                      onClick={() => removeNewOrderItem(item.product_id)}
                    >
                      Sil
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="orders-detail-total">
              <span>Yeni Sipariş Toplamı</span>
              <strong>{money(createTotal)}</strong>
            </div>

            {error && <div className="orders-error">{error}</div>}

            <div className="orders-modal-footer">
              <button
                type="button"
                className="orders-clear-button"
                onClick={closeCreateModal}
                disabled={saving}
              >
                Vazgeç
              </button>

              <button
                type="submit"
                className="orders-add-button"
                disabled={saving || createItems.length === 0}
              >
                {saving ? "Kaydediliyor..." : "Siparişi Oluştur"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

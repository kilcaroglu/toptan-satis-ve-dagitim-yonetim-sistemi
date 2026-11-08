
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import "./NotificationContext.css";

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [notification, setNotification] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const confirmResolver = useRef(null);
  const notificationTimer = useRef(null);

  const notify = useCallback((message, type = "success") => {
    if (notificationTimer.current) {
      clearTimeout(notificationTimer.current);
    }

    setNotification({ message, type });

    notificationTimer.current = setTimeout(() => {
      setNotification(null);
    }, 3500);
  }, []);

  const askConfirm = useCallback((options = {}) => {
    setConfirmDialog({
      title: options.title || "İşlemi Onayla",
      message: options.message || "Bu işlemi gerçekleştirmek istiyor musunuz?",
      confirmText: options.confirmText || "Onayla",
      cancelText: options.cancelText || "Vazgeç",
      danger: options.danger ?? false
    });

    return new Promise((resolve) => {
      confirmResolver.current = resolve;
    });
  }, []);

  const closeConfirm = (result) => {
    setConfirmDialog(null);

    if (confirmResolver.current) {
      confirmResolver.current(result);
      confirmResolver.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (notificationTimer.current) {
        clearTimeout(notificationTimer.current);
      }
    };
  }, []);

  return (
    <NotificationContext.Provider value={{ notify, askConfirm }}>
      {children}

      {notification && (
        <div className={`app-toast ${notification.type}`} role="status">
          <span className="app-toast-icon">
            {notification.type === "success"
              ? "✓"
              : notification.type === "warning"
                ? "!"
                : "×"}
          </span>

          <span>{notification.message}</span>

          <button
            className="app-toast-close"
            onClick={() => setNotification(null)}
            aria-label="Bildirimi kapat"
          >
            ×
          </button>
        </div>
      )}

      {confirmDialog && (
        <div
          className="app-confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeConfirm(false);
            }
          }}
        >
          <div
            className="app-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-confirm-title"
          >
            <div className="app-confirm-icon">
              {confirmDialog.danger ? "!" : "?"}
            </div>

            <h3 id="app-confirm-title">{confirmDialog.title}</h3>

            <p>{confirmDialog.message}</p>

            <div className="app-confirm-actions">
              <button
                className="app-confirm-cancel"
                onClick={() => closeConfirm(false)}
              >
                {confirmDialog.cancelText}
              </button>

              <button
                className={`app-confirm-submit ${
                  confirmDialog.danger ? "danger" : ""
                }`}
                onClick={() => closeConfirm(true)}
              >
                {confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error(
      "useNotification, NotificationProvider içerisinde kullanılmalıdır."
    );
  }

  return context;
}

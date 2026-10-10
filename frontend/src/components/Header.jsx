import { LogOut, Menu } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { ROLE_LABELS } from "../auth/roles.js";
import { SyncStatus } from "../offline/SyncStatus.jsx";

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Top bar: brand, the signed-in user (from the backend) and sign out. */
export default function Header({ onMenu, menuOpen }) {
  const { user, logout } = useAuth();

  return (
    <header className="erp-header">
      <div className="erp-header-left">
        <button
          type="button"
          className="erp-icon-btn mobile-menu-btn"
          onClick={onMenu}
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <Menu size={20} />
        </button>
        <div className="erp-brand-title">Everest Textile Mills</div>
      </div>

      <div className="erp-header-right">
        <SyncStatus />
        <div className="erp-user-profile-btn" style={{ cursor: "default" }}>
          <div className="erp-user-info">
            <span className="erp-user-code">{ROLE_LABELS[user.role]}</span>
            <span className="erp-user-name">{user.name}</span>
          </div>
          <div className="erp-user-avatar" aria-hidden="true">
            {initials(user.name)}
          </div>
        </div>
        <button
          type="button"
          className="erp-btn-outline"
          onClick={logout}
          title="Sign out"
        >
          <LogOut size={15} aria-hidden="true" />
          <span className="hide-sm">Sign out</span>
        </button>
      </div>
    </header>
  );
}

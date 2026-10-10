import { Search, Bell, Menu, HelpCircle } from 'lucide-react';

export default function Header({ onMenuClick }) {
  return (
    <header className="app-header">
      <div className="header-left">
        <button className="mobile-menu-btn" onClick={onMenuClick}>
          <Menu size={20} />
        </button>
        <div className="header-search">
          <Search />
          <input type="text" placeholder="Search orders, machines, materials..." />
          <kbd>⌘K</kbd>
        </div>
      </div>

      <div className="header-right">
        <button className="header-icon-btn" title="Help">
          <HelpCircle size={18} />
        </button>
        <button className="header-icon-btn" title="Notifications">
          <Bell size={18} />
          <span className="notification-dot" />
        </button>
        <div className="header-avatar" title="Suresh Kumar — Plant Manager">
          SK
        </div>
      </div>
    </header>
  );
}

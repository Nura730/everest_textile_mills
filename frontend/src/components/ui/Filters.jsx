import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

/** A row of filters in the existing toolbar style, with one "Clear filters" action when any is set. */
export function FilterBar({ active, onClear, children, label = 'Filters' }) {
  return (
    <div className="toolbar filter-bar" role="group" aria-label={label}>
      {children}
      {active && (
        <button type="button" className="erp-btn-outline erp-btn-sm" onClick={onClear}>
          <X size={13} aria-hidden="true" /> Clear filters
        </button>
      )}
    </div>
  );
}

/**
 * Free-text search that waits until the user pauses typing (300 ms) before filtering, so the
 * server is not asked once per keystroke. Clearing filters from outside resets the text.
 */
export function SearchInput({ id, value, onChange, placeholder }) {
  const [text, setText] = useState(value);
  // Follow outside changes (e.g. "Clear filters") during render, React's pattern for adjusting
  // state to a prop; a value that is just our own trimmed text leaves the typing untouched.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (value !== text.trim()) setText(value);
  }
  useEffect(() => {
    if (text.trim() === value) return undefined;
    const timer = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);

  return (
    <div className="filter-search">
      <Search size={14} aria-hidden="true" />
      <input
        id={id}
        type="search"
        className="erp-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={100}
      />
    </div>
  );
}

/** A labelled select inside a FilterBar. `options`: [{ value, label }]; '' means "All". */
export function FilterSelect({ id, label, value, onChange, options, allLabel = 'All' }) {
  return (
    <label className="filter-field" htmlFor={id}>
      <span className="erp-label">{label}</span>
      <select id={id} className="erp-input toolbar-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

/** A labelled calendar-date input inside a FilterBar. */
export function FilterDate({ id, label, value, onChange, min, max }) {
  return (
    <label className="filter-field" htmlFor={id}>
      <span className="erp-label">{label}</span>
      <input id={id} type="date" className="erp-input toolbar-select" value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** A checkbox filter inside a FilterBar. */
export function FilterCheckbox({ id, label, checked, onChange }) {
  return (
    <label className="filter-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}
    </label>
  );
}

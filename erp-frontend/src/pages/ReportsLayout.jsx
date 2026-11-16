import { Outlet, NavLink } from 'react-router-dom';

export default function ReportsLayout() {
  return (
    <>
      <div className="tabs">
        <NavLink className={({ isActive }) => 'tab' + (isActive ? ' on' : '')} to="/reports/sales" end>Sales &amp; profit</NavLink>
        <NavLink className={({ isActive }) => 'tab' + (isActive ? ' on' : '')} to="/reports/stock" end>Stock report (VAT split)</NavLink>
        <NavLink className={({ isActive }) => 'tab' + (isActive ? ' on' : '')} to="/reports/vat" end>VAT statement</NavLink>
      </div>
      <Outlet />
    </>
  );
}
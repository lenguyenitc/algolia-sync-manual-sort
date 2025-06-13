import { Link, Outlet } from "@remix-run/react";

export default function AppIndex() {
  return (
    <div>
      <Outlet />
    </div>
  );
}
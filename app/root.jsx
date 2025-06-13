import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import React from "react";
export function links() {
  return [{ rel: "stylesheet", href: polarisStyles }];
}
export default function App() {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider i18n={enTranslations}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

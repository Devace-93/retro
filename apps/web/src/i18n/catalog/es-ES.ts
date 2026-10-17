import type { PartialCatalog } from "./en";

/** Español (España) — overrides vs the Mexican base. */
const esES: PartialCatalog = {
  "early.bannerText":
    "Ahora mismo todas las cuentas tienen acceso completo sin coste. Los planes y límites se introducirán más adelante, con aviso antes de cualquier cambio.",
  "common.email": "Correo electrónico",
  "billing.notConfigured":
    "La facturación todavía no está configurada (falta VITE_REVENUECAT_PUBLIC_KEY). Añade tu clave pública de RevenueCat Web Billing a .env y vuelve a construir la imagen web.",
};
export default esES;

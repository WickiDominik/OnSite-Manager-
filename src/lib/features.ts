/**
 * Feature-Schalter.
 *
 * BimCollab-Anbindung (Login + Abgleich) ist vorübergehend abgeschaltet, bis eine
 * eigene OAuth-Client-ID vorliegt. Der Code bleibt vollständig erhalten.
 * Wieder einschalten: beim Build `VITE_BIMCOLLAB_ENABLED=true` setzen
 * (lokal in `.env`, in GitHub Actions als Repository-Variable).
 */
export const BIMCOLLAB_ENABLED = import.meta.env.VITE_BIMCOLLAB_ENABLED === 'true';

/** Public contact channels — override via VITE_* env when deploying. */
export const CONTACT_EMAIL = 'team@evaalo.com';

export const CONTACT_WHATSAPP_DISPLAY = '+964 778 073 9729';
export const CONTACT_WHATSAPP_WA_ME = '9647780739729';

export function getContactWhatsAppUrl() {
    if (import.meta.env.VITE_SOCIAL_WHATSAPP_URL) {
        return import.meta.env.VITE_SOCIAL_WHATSAPP_URL;
    }
    const phone =
        import.meta.env.VITE_CONTACT_WHATSAPP_PHONE?.replace(/\D/g, '') ||
        CONTACT_WHATSAPP_WA_ME;
    return `https://wa.me/${phone}`;
}

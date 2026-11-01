/** What a scanned or pasted vendor code can tell us: a name and/or phone, read client-side only. */
export interface VendorShare {
  name?: string;
  phone?: string;
}

const PHONE = /^\+?[\d\s-]{7,16}$/;

/** A UPI pay link (`pn` payee name, `pa` handle that is often the phone), a tel: link or a bare number. Else null. */
export function parseVendorShare(raw: string): VendorShare | null {
  const text = raw.trim();
  if (!text) return null;
  if (PHONE.test(text)) return { phone: text.replace(/[\s-]/g, '') };
  if (/^tel:/i.test(text))
    return { phone: decodeURIComponent(text.slice(4)).replace(/[\s-]/g, '') };
  if (!/^upi:\/\//i.test(text)) return null;
  const query = text.split('?')[1] ?? '';
  const get = (key: string): string => {
    const hit = query.split('&').find((p) => p.startsWith(`${key}=`));
    try {
      return hit ? decodeURIComponent(hit.slice(key.length + 1).replace(/\+/g, ' ')).trim() : '';
    } catch {
      return '';
    }
  };
  const name = get('pn');
  const phone = /^\d{10}@/.test(get('pa')) ? get('pa').slice(0, 10) : '';
  return name || phone ? { ...(name && { name }), ...(phone && { phone }) } : null;
}
